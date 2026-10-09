/**
 * Editor-latency benchmark: times the TypeScript language server (the process
 * the editor talks to) answering completion, hover, signature help and
 * diagnostics requests with each variant's library (see `generate.ts`). Run
 * with:
 *
 *   node bench/types/lsp.ts [--tables 50,200] [--rounds 3] [--iterations 10]
 *     [--variants src,other=path/to/src]
 *
 * Each round starts a fresh server per variant and opens `probe.ts`: one
 * table's workload plus a few unfinished expressions to complete and hover.
 * The first request after opening it is cold, so it includes loading the
 * project. Every later request is preceded by an edit, so it pays the
 * re-check a keystroke causes rather than hitting the server's cache.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	columnOf,
	generate,
	KINDS,
	out,
	parseVariants,
	queryFile,
	root,
	type Variant,
} from './generate.ts';
import { arg, median, pct, percentile } from './util.ts';

const { default: getExePath } = (await import(
	pathToFileURL(
		join(root, 'node_modules', 'typescript', 'lib', 'getExePath.js'),
	).href
)) as { default: () => string };

// ---------------------------------------------------------------------------
// A minimal LSP client over stdio
// ---------------------------------------------------------------------------

interface Message {
	readonly id?: number;
	readonly method?: string;
	readonly params?: { readonly items?: readonly unknown[] };
	readonly result?: unknown;
	readonly error?: { readonly message: string };
}

interface Pending {
	resolve(result: unknown): void;
	reject(error: Error): void;
}

class Server {
	readonly #process: ChildProcess;
	readonly #pending = new Map<number, Pending>();
	#buffer = Buffer.alloc(0);
	#nextId = 1;

	constructor(cwd: string) {
		this.#process = spawn(getExePath(), ['--lsp', '--stdio'], {
			cwd,
			// stderr is the server's log; failures surface as error responses
			stdio: ['pipe', 'pipe', 'ignore'],
		});
		this.#process.stdout!.on('data', (chunk: Buffer) => this.#receive(chunk));
	}

	/** `params` is left out of the message when undefined: `shutdown` takes none. */
	request<T = unknown>(method: string, params?: unknown): Promise<T> {
		const id = this.#nextId++;
		this.#send({ jsonrpc: '2.0', id, method, params });
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`${method} timed out`)),
				120_000,
			);
			this.#pending.set(id, {
				resolve: (result) => {
					clearTimeout(timer);
					resolve(result as T);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
		});
	}

	notify(method: string, params?: unknown) {
		this.#send({ jsonrpc: '2.0', method, params });
	}

	async close() {
		const exited = new Promise((resolve) =>
			this.#process.once('exit', resolve),
		);
		await this.request('shutdown');
		this.notify('exit');
		const timer = setTimeout(() => this.#process.kill(), 5_000);
		await exited;
		clearTimeout(timer);
	}

	#send(message: object) {
		const body = JSON.stringify(message);
		this.#process.stdin!.write(
			`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
		);
	}

	#receive(chunk: Buffer) {
		this.#buffer = Buffer.concat([this.#buffer, chunk]);
		for (;;) {
			const end = this.#buffer.indexOf('\r\n\r\n');
			if (end === -1) {
				return;
			}
			const header = this.#buffer.subarray(0, end).toString();
			const length = Number(/Content-Length: (\d+)/i.exec(header)![1]);
			const start = end + 4;
			if (this.#buffer.length < start + length) {
				return;
			}
			const body = this.#buffer.subarray(start, start + length).toString();
			this.#buffer = this.#buffer.subarray(start + length);
			this.#handle(JSON.parse(body) as Message);
		}
	}

	#handle(message: Message) {
		if (message.id !== undefined && message.method !== undefined) {
			// a request from the server (configuration, registration, progress):
			// answer it, or the server waits
			const result =
				message.method === 'workspace/configuration'
					? (message.params?.items ?? []).map(() => null)
					: null;
			this.#send({ jsonrpc: '2.0', id: message.id, result });
			return;
		}
		if (message.id !== undefined) {
			const pending = this.#pending.get(message.id);
			this.#pending.delete(message.id);
			if (message.error) {
				pending?.reject(new Error(message.error.message));
			} else {
				pending?.resolve(message.result);
			}
		}
		// notifications (logs, progress, pushed diagnostics) are ignored
	}
}

// ---------------------------------------------------------------------------
// The probe file
// ---------------------------------------------------------------------------

/** Rewritten on every edit, so each request follows a change to the file. */
const revision = (n: number) => `// revision ${n}`;

/** `t0.c0` is a text column; `t1.c{n}` is `t1`'s text column. */
const joinedText = `t1.c${columnOf(1, KINDS[0]!)}`;

const PROBE = `
export const probe = [
	eb.ref('t0.c0').eq('x'),
	eb.fn.coalesce('t0.c0', eb.val('x')),
	eb.ref('t0.c0').like(),
	eb.ref('t0.c0').,
	eb.ref(''),
];

export const probeQuery = selectFrom(t0).where((q) => q.ref('t0.c0').);

export const probeJoin = selectFrom(t0).innerJoin(t1).on('${joinedText}', '');

export const probePipe = selectFrom(t0).pipe(join0).where('');
`;

interface Position {
	readonly line: number;
	readonly character: number;
}

function positionAt(text: string, offset: number): Position {
	const before = text.slice(0, offset);
	const line = before.split('\n').length - 1;
	return { line, character: offset - (before.lastIndexOf('\n') + 1) };
}

function probe(dir: string, tables: number) {
	const text = `${revision(0)}\n${queryFile(0, tables)}${PROBE}`;
	writeFileSync(join(dir, 'probe.ts'), text);
	const at = (needle: string, skip = 0) => {
		const offset = text.lastIndexOf(needle);
		if (offset === -1) {
			throw new Error(`"${needle}" not in probe`);
		}
		return positionAt(text, offset + skip);
	};
	const whereCall = "q.ref('t0.c0').)";
	const onCall = `.on('${joinedText}', '')`;
	const pipeWhere = ".pipe(join0).where('')";
	return {
		uri: pathToFileURL(join(dir, 'probe.ts')).href,
		text,
		method: at("eb.ref('t0.c0').,", "eb.ref('t0.c0').".length),
		argument: at("eb.ref('t0.c0').like()", "eb.ref('t0.c0').like(".length),
		column: at("eb.ref('')", "eb.ref('".length),
		comparison: at("eb.ref('t0.c0').eq('x')", "eb.ref('t0.c0').".length),
		coalesce: at('coalesce(', 1),
		whereMethod: at(whereCall, whereCall.length - 1),
		joinColumn: at(onCall, onCall.length - 2),
		pipeColumn: at(pipeWhere, pipeWhere.length - 2),
	};
}

type Probe = ReturnType<typeof probe>;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface CompletionList {
	readonly items: readonly { readonly label: string }[];
}

type Completions = CompletionList | CompletionList['items'] | null;

const labels = (result: Completions) =>
	(Array.isArray(result)
		? result
		: ((result as CompletionList | null)?.items ?? [])
	).map((item) => item.label);

interface Scenario {
	readonly name: string;
	run(server: Server, file: Probe): Promise<unknown>;
	/** Throws unless the response shows the request did what it's meant to. */
	check(result: unknown): void;
}

function expect(condition: boolean, message: string) {
	if (!condition) {
		throw new Error(message);
	}
}

const completion = (position: keyof Probe) => (server: Server, file: Probe) =>
	server.request('textDocument/completion', {
		textDocument: { uri: file.uri },
		position: file[position],
	});

const hover = (position: keyof Probe) => (server: Server, file: Probe) =>
	server.request('textDocument/hover', {
		textDocument: { uri: file.uri },
		position: file[position],
	});

const SCENARIOS: readonly Scenario[] = [
	{
		name: "method completion: eb.ref('t0.c0').‸",
		run: completion('method'),
		check: (result) => {
			const found = labels(result as Completions);
			expect(
				found.includes('like') && !found.includes('contains'),
				`method completion returned ${JSON.stringify(found)}`,
			);
		},
	},
	{
		name: "column completion: eb.ref('‸",
		run: completion('column'),
		check: (result) => {
			const found = labels(result as Completions);
			expect(
				found.includes('t0.c0') && found.includes('t1.id'),
				`column completion returned ${JSON.stringify(found.slice(0, 10))}`,
			);
		},
	},
	{
		name: "method completion: .where((q) => q.ref('t0.c0').‸",
		run: completion('whereMethod'),
		check: (result) => {
			const found = labels(result as Completions);
			expect(
				found.includes('like') && !found.includes('contains'),
				`where completion returned ${JSON.stringify(found)}`,
			);
		},
	},
	{
		name: `join column completion: .on('${joinedText}', '‸`,
		run: completion('joinColumn'),
		check: (result) => {
			const found = labels(result as Completions);
			expect(
				found.includes('t0.c0') && !found.includes('t0.id'),
				`join completion returned ${JSON.stringify(found.slice(0, 10))}`,
			);
		},
	},
	{
		name: "column completion after pipe: .pipe(join0).where('‸",
		run: completion('pipeColumn'),
		check: (result) => {
			const found = labels(result as Completions);
			expect(
				found.includes('t0.c0') && found.includes('t1.id'),
				`pipe completion returned ${JSON.stringify(found.slice(0, 10))}`,
			);
		},
	},
	{
		name: "hover: eb.ref('t0.c0').eq('x')",
		run: hover('comparison'),
		check: (result) => {
			const text = JSON.stringify(result);
			expect(text.includes('eq'), `hover returned ${text}`);
		},
	},
	{
		name: 'hover: eb.fn.coalesce(...)',
		run: hover('coalesce'),
		check: (result) => {
			const text = JSON.stringify(result);
			expect(text.includes('coalesce'), `hover returned ${text}`);
		},
	},
	{
		name: "signature help: eb.ref('t0.c0').like(‸",
		run: (server, file) =>
			server.request('textDocument/signatureHelp', {
				textDocument: { uri: file.uri },
				position: file.argument,
			}),
		check: (result) => {
			const signatures = (result as { signatures?: unknown[] } | null)
				?.signatures;
			expect(
				(signatures?.length ?? 0) > 0,
				`signature help returned ${JSON.stringify(result)}`,
			);
		},
	},
	{
		name: 'diagnostics for the file',
		run: (server, file) =>
			server.request('textDocument/diagnostic', {
				textDocument: { uri: file.uri },
			}),
		check: (result) => {
			// the unfinished probe expressions are errors
			const items = (result as { items?: unknown[] } | null)?.items ?? [];
			expect(
				items.length >= 4,
				`diagnostics returned ${JSON.stringify(result)}`,
			);
		},
	},
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface Session {
	/** the first request after opening the file, ms */
	readonly cold: number;
	/** per scenario, ms */
	readonly warm: readonly number[][];
}

async function time(run: () => Promise<unknown>) {
	const start = performance.now();
	const result = await run();
	return { ms: performance.now() - start, result };
}

async function session(
	dir: string,
	file: Probe,
	iterations: number,
): Promise<Session> {
	const server = new Server(dir);
	await server.request('initialize', {
		processId: process.pid,
		rootUri: pathToFileURL(dir).href,
		workspaceFolders: [{ uri: pathToFileURL(dir).href, name: 'bench' }],
		capabilities: {
			textDocument: {
				completion: { completionItem: { snippetSupport: false } },
				hover: { contentFormat: ['markdown', 'plaintext'] },
				signatureHelp: {},
				diagnostic: {},
			},
		},
	});
	server.notify('initialized', {});
	server.notify('textDocument/didOpen', {
		textDocument: {
			uri: file.uri,
			languageId: 'typescript',
			version: 1,
			text: file.text,
		},
	});

	const first = SCENARIOS[0]!;
	const cold = await time(() => first.run(server, file));
	first.check(cold.result);

	let version = 1;
	let previous = revision(0);
	const edit = () => {
		version++;
		const next = revision(version);
		server.notify('textDocument/didChange', {
			textDocument: { uri: file.uri, version },
			contentChanges: [
				{
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: previous.length },
					},
					text: next,
				},
			],
		});
		previous = next;
	};

	const warm = SCENARIOS.map(() => [] as number[]);
	for (let iteration = 0; iteration < iterations; iteration++) {
		for (const [index, scenario] of SCENARIOS.entries()) {
			edit();
			const { ms, result } = await time(() => scenario.run(server, file));
			if (iteration === 0) {
				scenario.check(result);
			}
			warm[index]!.push(ms);
		}
	}

	await server.close();
	return { cold: cold.ms, warm };
}

const sizes = arg('tables', '50,200').split(',').map(Number);
const rounds = Number(arg('rounds', '3'));
const iterations = Number(arg('iterations', '10'));
const variants = parseVariants(arg('variants', 'src'));
const baseline = variants[0]!;
const base = join(out, 'lsp');

rmSync(base, { recursive: true, force: true });

const format = (values: readonly number[]) =>
	`${median(values).toFixed(1)} ms (p95 ${percentile(values, 95).toFixed(1)})`;

for (const tables of sizes) {
	const setups = new Map(
		variants.map((variant) => {
			const dir = generate(variant, tables, base);
			return [variant, { dir, file: probe(dir, tables) }] as const;
		}),
	);
	const cold = new Map<Variant, number[]>(variants.map((v) => [v, []]));
	const warm = new Map<Variant, number[][]>(
		variants.map((v) => [v, SCENARIOS.map(() => [])]),
	);

	// interleaved, rotating the order, so drift affects every variant alike
	for (let round = 0; round < rounds; round++) {
		for (let n = 0; n < variants.length; n++) {
			const variant = variants[(round + n) % variants.length]!;
			const { dir, file } = setups.get(variant)!;
			const result = await session(dir, file, iterations);
			cold.get(variant)!.push(result.cold);
			result.warm.forEach((samples, index) =>
				warm.get(variant)![index]!.push(...samples),
			);
		}
	}

	console.log(
		`\n${tables} tables: median (p95) per request, ${rounds * iterations} edits + requests each, ${rounds} cold starts\n`,
	);
	console.log(`| request | ${variants.map((v) => v.name).join(' | ')} |`);
	console.log(`|---|${variants.map(() => '---').join('|')}|`);

	const row = (
		name: string,
		samples: (variant: Variant) => readonly number[],
	) => {
		const reference = median(samples(baseline));
		const cells = variants.map((variant) => {
			const values = samples(variant);
			const delta =
				variant === baseline ? '' : ` ${pct(median(values), reference)}`;
			return `${format(values)}${delta}`;
		});
		console.log(`| ${name} | ${cells.join(' | ')} |`);
	};

	row('cold: first completion after open', (variant) => cold.get(variant)!);
	SCENARIOS.forEach((scenario, index) =>
		row(
			`after edit, ${scenario.name}`,
			(variant) => warm.get(variant)![index]!,
		),
	);
}
