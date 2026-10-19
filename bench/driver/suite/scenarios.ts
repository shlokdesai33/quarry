/**
 * Benchmark scenarios. An "ops" scenario is one operation run in a closed
 * loop by `concurrency` workers; a "custom" scenario measures something that
 * isn't a loop of identical operations (connects, cancels, notifications).
 * Every scenario checks each result cheaply (row count, a value) and has a
 * `verify` used once per driver to compare full canonical results.
 */
import { canonRows } from './canon.ts';
import { connectOnce, type Driver, type Row, type Target } from './drivers.ts';

export interface Ctx {
	/** Scenario-specific prepared data. */
	data: Record<string, unknown>;
	target: Target;
	driverName: string;
}

export interface OpsScenario {
	readonly kind: 'ops';
	readonly id: string;
	readonly group: string;
	readonly title: string;
	readonly concurrency?: number;
	/** Rows (or values) one operation handles, for per-row figures. */
	readonly rowsPerOp?: number;
	readonly valuesPerOp?: number;
	readonly needs?: keyof Driver;
	readonly durationMs?: number;
	readonly warmupMs?: number;
	/** Operations to run before measuring, at least (default 3). */
	readonly warmupOps?: number;
	readonly minOps?: number;
	readonly maxOps?: number;
	/**
	 * Equal-work memory: peak RSS after exactly this many operations (and a
	 * fixed warm-up), measured in its own process. The time-window peak
	 * depends on how many operations fit in the window, so faster clients
	 * allocate more within it.
	 */
	readonly memOps?: number;
	setup?(d: Driver, ctx: Ctx): Promise<void>;
	op(d: Driver, i: number, ctx: Ctx): Promise<unknown>;
	check?(result: unknown, i: number): void;
	/** Canonical result for the cross-driver correctness check. */
	verify?(d: Driver, ctx: Ctx): Promise<unknown>;
}

export interface CustomResult {
	readonly latencies: readonly number[];
	readonly ops: number;
	readonly elapsedMs: number;
	readonly extra?: Record<string, unknown>;
}

export interface CustomScenario {
	readonly kind: 'custom';
	readonly id: string;
	readonly group: string;
	readonly title: string;
	readonly needs?: keyof Driver;
	/** Doesn't use the pool the worker opens. */
	readonly noPool?: boolean;
	run(
		d: Driver | undefined,
		ctx: Ctx,
		opts: { durationMs: number; stdin: AsyncIterator<string> | undefined },
	): Promise<CustomResult>;
}

export type Scenario = OpsScenario | CustomScenario;

export const USERS_ROWS = 1_000_000;
const pkId = (i: number) => ((i * 7919) % USERS_ROWS) + 1;

function expect(cond: boolean, message: string): asserts cond {
	if (!cond) throw new Error(`check failed: ${message}`);
}
const rows = (r: unknown) => r as readonly Row[];
const count = (n: number) => (r: unknown) =>
	expect(rows(r).length === n, `expected ${n} rows, got ${rows(r).length}`);

const readVerify =
	(sql: string, params: unknown[] = []) =>
	async (d: Driver) =>
		canonRows(await d.query(sql, params));

function read(
	id: string,
	title: string,
	sql: string,
	n: number,
	extra: Partial<OpsScenario> = {},
): OpsScenario {
	return {
		kind: 'ops',
		id,
		group: 'reads',
		title,
		rowsPerOp: n,
		op: (d) => d.query(sql),
		check: count(n),
		verify: readVerify(sql),
		...extra,
	};
}

const TYPE_COLUMNS = [
	'i4',
	'i8',
	'f8',
	'num',
	'txt',
	'b',
	'ts',
	'd',
	'u',
	'j',
	'i4a',
	'by',
] as const;
export const TYPE_NAMES: Record<(typeof TYPE_COLUMNS)[number], string> = {
	i4: 'int4',
	i8: 'int8',
	f8: 'float8',
	num: 'numeric',
	txt: 'text',
	b: 'bool',
	ts: 'timestamptz',
	d: 'date',
	u: 'uuid',
	j: 'jsonb (small object)',
	i4a: 'int4[5]',
	by: 'bytea (16 B)',
};

const INSERT1 =
	'insert into bench_writes (name, score, created) values ($1, $2, $3)';
const truncateWrites = async (d: Driver) => {
	await d.query('truncate bench_writes');
};
const writesContent = async (d: Driver) =>
	canonRows(
		await d.query('select name, score, created from bench_writes order by id'),
	);

const COPY_ROWS = 10_000;
function copyChunks(): string[] {
	const chunks: string[] = [];
	let chunk = '';
	for (let i = 0; i < COPY_ROWS; i++) {
		chunk += `copy row ${i}\t${i / 10}\t2024-01-01 00:00:00+00\n`;
		if (chunk.length > 65_536) {
			chunks.push(chunk);
			chunk = '';
		}
	}
	if (chunk) chunks.push(chunk);
	return chunks;
}

const UNNEST =
	'insert into bench_writes (name, score, created) select n, s, $3::timestamptz from unnest($1::text[], $2::float8[]) as t(n, s)';
function unnestParams(n: number): unknown[] {
	const names = Array.from({ length: n }, (_, i) => `"bulk row ${i}"`);
	const scores = Array.from({ length: n }, (_, i) => String(i / 10));
	return [
		`{${names.join(',')}}`,
		`{${scores.join(',')}}`,
		'2024-01-01 00:00:00+00',
	];
}

/** The same rows as `unnestParams`, as JS arrays: what quarry's query builder passes. */
function unnestJsParams(n: number): unknown[] {
	return [
		Array.from({ length: n }, (_, i) => `bulk row ${i}`),
		Array.from({ length: n }, (_, i) => i / 10),
		'2024-01-01 00:00:00+00',
	];
}
/** text[], float8[]: the types quarry's builder declares for these parameters. */
const UNNEST_TYPES = [1009, 1022, 0];
const typed = (d: Driver, sql: string, params: unknown[], types: number[]) =>
	d.queryTyped ? d.queryTyped(sql, params, types) : d.query(sql, params);
const ANY_SQL =
	'select id, name from bench_users where id = any($1) order by id';
const INT4_ARRAY = 1007;

const MULTI = 100;
const MULTI_SQL = `insert into bench_writes (name, score, created) values ${Array.from({ length: MULTI }, (_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ')}`;
const multiParams = () =>
	Array.from({ length: MULTI }, (_, i) => [
		`multi ${i}`,
		i / 4,
		'2024-01-01 00:00:00+00',
	]).flat();

const inList = (n: number) =>
	`select id, name from bench_users where id in (${Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', ')}) order by id`;
const inParams = (n: number, i: number) =>
	Array.from({ length: n }, (_, k) => pkId(i * n + k));

const DIVISION_BY_ZERO = '22012';
function errorCode(error: unknown): string | undefined {
	const e = error as Record<string, any>;
	for (const c of [
		e?.['code'],
		e?.['errno'],
		e?.['fields']?.['code'],
		e?.['sqlState'],
	])
		if (typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c)) return c;
	return undefined;
}

export const SCENARIOS: Scenario[] = [
	// ------------------------------------------------------------ reads
	{
		kind: 'ops',
		id: 'select1',
		group: 'reads',
		title: 'select 1',
		op: (d) => d.query('select 1 as x'),
		check: (r) => expect(Number(rows(r)[0]?.['x']) === 1, 'x = 1'),
		verify: readVerify('select 1 as x'),
	},
	{
		kind: 'ops',
		id: 'pk',
		group: 'reads',
		title: 'point lookup by primary key',
		rowsPerOp: 1,
		op: (d, i) => d.query('select * from bench_users where id = $1', [pkId(i)]),
		check: (r, i) =>
			expect(Number(rows(r)[0]?.['id']) === pkId(i), 'row by id'),
		verify: readVerify('select * from bench_users where id = $1', [4242]),
	},
	{
		kind: 'ops',
		id: 'range100',
		group: 'reads',
		title: 'range scan, 100 rows',
		rowsPerOp: 100,
		op: (d, i) =>
			d.query('select * from bench_users where id >= $1 and id < $2', [
				(pkId(i) % 999_000) + 1,
				(pkId(i) % 999_000) + 101,
			]),
		check: count(100),
		verify: readVerify(
			'select * from bench_users where id >= $1 and id < $2',
			[5000, 5100],
		),
	},
	read(
		'fetch1k',
		'fetch 1k rows (6 columns)',
		'select * from bench_users where id <= 1000',
		1000,
	),
	read(
		'fetch100k',
		'fetch 100k rows',
		'select * from bench_users where id <= 100000',
		100_000,
		{ durationMs: 2000, minOps: 5, memOps: 5 },
	),
	read(
		'fetch1m',
		'fetch 1M rows (one result)',
		'select * from bench_users',
		1_000_000,
		{ durationMs: 3000, minOps: 3, warmupMs: 0, warmupOps: 1, memOps: 3 },
	),
	read(
		'wide',
		'wide rows: 1k rows × 100 columns',
		'select * from bench_wide order by id',
		1000,
		{ valuesPerOp: 100_000, memOps: 50 },
	),
	read(
		'large-text',
		'large values: 10 × 1 MB text',
		`select id, t from bench_large where kind = 'text' order by id`,
		10,
		{ memOps: 20 },
	),
	read(
		'large-bytea',
		'large values: 10 × 1 MB bytea',
		`select id, b from bench_large where kind = 'bytea' order by id`,
		10,
		{ memOps: 20 },
	),
	read(
		'large-jsonb',
		'large values: 20 × 200 KB jsonb',
		`select id, j from bench_large where kind = 'jsonb' order by id`,
		20,
		{ memOps: 10 },
	),
	read(
		'arrays',
		'arrays: 1k rows of int4[100] + text[20]',
		'select ints, texts from bench_arrays order by id',
		1000,
		{ valuesPerOp: 120_000, memOps: 50 },
	),
	...TYPE_COLUMNS.map((col) =>
		read(
			`type-${col}`,
			`decode 100k × ${TYPE_NAMES[col]}`,
			`select ${col} from bench_types`,
			100_000,
			{ group: 'types', valuesPerOp: 100_000, durationMs: 1500, minOps: 5 },
		),
	),

	// ------------------------------------------------------------ prepared / parameters
	{
		kind: 'ops',
		id: 'params100',
		group: 'params',
		title: '100 parameters (id in (…)), 100 rows',
		rowsPerOp: 100,
		op: (d, i) => d.query(inList(100), inParams(100, i)),
		check: count(100),
		verify: (d) => d.query(inList(100), inParams(100, 7)).then(canonRows),
	},
	{
		kind: 'ops',
		id: 'params1000',
		group: 'params',
		title: '1000 parameters (id in (…)), 1000 rows',
		rowsPerOp: 1000,
		op: (d, i) => d.query(inList(1000), inParams(1000, i)),
		check: count(1000),
		verify: (d) => d.query(inList(1000), inParams(1000, 7)).then(canonRows),
	},

	// ------------------------------------------------------------ writes
	{
		kind: 'ops',
		id: 'insert1',
		group: 'writes',
		title: 'insert one row',
		setup: truncateWrites,
		op: (d, i) => d.query(INSERT1, [`n${i}`, i / 2, '2024-01-01 00:00:00+00']),
		verify: async (d) => {
			await truncateWrites(d);
			for (let i = 0; i < 5; i++)
				await d.query(INSERT1, [`n${i}`, i / 2, '2024-01-01 00:00:00+00']);
			return writesContent(d);
		},
	},
	{
		kind: 'ops',
		id: 'insert1-c50',
		group: 'writes',
		title: 'insert one row, concurrency 50',
		concurrency: 50,
		setup: truncateWrites,
		op: (d, i) => d.query(INSERT1, [`n${i}`, i / 2, '2024-01-01 00:00:00+00']),
	},
	{
		kind: 'ops',
		id: 'insert-multi100',
		group: 'writes',
		title: 'multi-row insert: 100 rows, 300 parameters',
		rowsPerOp: 100,
		setup: async (d, ctx) => {
			await truncateWrites(d);
			ctx.data['params'] = multiParams();
		},
		op: (d, _i, ctx) => d.query(MULTI_SQL, ctx.data['params'] as unknown[]),
		verify: async (d) => {
			await truncateWrites(d);
			await d.query(MULTI_SQL, multiParams());
			return writesContent(d);
		},
	},
	{
		kind: 'ops',
		id: 'bulk-unnest',
		group: 'writes',
		title: 'bulk insert 10k rows (unnest arrays)',
		rowsPerOp: 10_000,
		minOps: 5,
		setup: async (d, ctx) => {
			await truncateWrites(d);
			ctx.data['params'] = unnestParams(10_000);
		},
		op: (d, _i, ctx) => d.query(UNNEST, ctx.data['params'] as unknown[]),
		verify: async (d) => {
			await truncateWrites(d);
			await d.query(UNNEST, unnestParams(10_000));
			return writesContent(d);
		},
	},
	{
		kind: 'ops',
		id: 'bulk-unnest-js',
		group: 'writes',
		title: 'bulk insert 10k rows (unnest, JS array parameters)',
		rowsPerOp: 10_000,
		minOps: 5,
		setup: async (d, ctx) => {
			await truncateWrites(d);
			ctx.data['params'] = unnestJsParams(10_000);
		},
		op: (d, _i, ctx) =>
			typed(d, UNNEST, ctx.data['params'] as unknown[], UNNEST_TYPES),
		verify: async (d) => {
			await truncateWrites(d);
			await typed(d, UNNEST, unnestJsParams(10_000), UNNEST_TYPES);
			return writesContent(d);
		},
	},
	{
		kind: 'ops',
		id: 'bulk-unnest-js1k',
		group: 'writes',
		title: 'bulk insert 1k rows (unnest, JS array parameters)',
		rowsPerOp: 1_000,
		minOps: 5,
		setup: async (d, ctx) => {
			await truncateWrites(d);
			ctx.data['params'] = unnestJsParams(1_000);
		},
		op: (d, _i, ctx) =>
			typed(d, UNNEST, ctx.data['params'] as unknown[], UNNEST_TYPES),
		verify: async (d) => {
			await truncateWrites(d);
			await typed(d, UNNEST, unnestJsParams(1_000), UNNEST_TYPES);
			return writesContent(d);
		},
	},
	{
		kind: 'ops',
		id: 'any1000-js',
		group: 'params',
		title: 'id = any($1) with 1000 ids (JS array), 1000 rows',
		rowsPerOp: 1000,
		op: (d, i) => typed(d, ANY_SQL, [inParams(1000, i)], [INT4_ARRAY]),
		check: count(1000),
		verify: (d) =>
			typed(d, ANY_SQL, [inParams(1000, 7)], [INT4_ARRAY]).then(canonRows),
	},
	{
		kind: 'ops',
		id: 'bulk-copy',
		group: 'writes',
		title: 'bulk insert 10k rows (COPY FROM STDIN, text)',
		rowsPerOp: COPY_ROWS,
		minOps: 5,
		needs: 'copyFrom',
		setup: async (d, ctx) => {
			await truncateWrites(d);
			ctx.data['chunks'] = copyChunks();
		},
		op: (d, _i, ctx) =>
			d.copyFrom!(
				'copy bench_writes (name, score, created) from stdin',
				ctx.data['chunks'] as string[],
			),
		verify: async (d) => {
			await truncateWrites(d);
			await d.copyFrom!(
				'copy bench_writes (name, score, created) from stdin',
				copyChunks(),
			);
			const all = await writesContent(d);
			return [all.length, all.slice(0, 3), all.slice(-3)];
		},
	},
	{
		kind: 'ops',
		id: 'update',
		group: 'writes',
		title: 'update one row by primary key',
		op: (d, i) =>
			d.query('update bench_upd set score = score + 1 where id = $1', [
				((i * 7919) % 100_000) + 1,
			]),
	},
	{
		kind: 'ops',
		id: 'upsert',
		group: 'writes',
		title: 'upsert (insert … on conflict do update)',
		op: (d, i) =>
			d.query(
				'insert into bench_kv (k, v) values ($1, $2) on conflict (k) do update set v = excluded.v',
				[((i * 7919) % 100_000) + 1, `v${i}`],
			),
	},
	{
		kind: 'ops',
		id: 'delete',
		group: 'writes',
		title: 'delete one row by primary key',
		setup: async (d) => {
			await d.query('truncate bench_del');
			await d.query(
				'insert into bench_del select g from generate_series(1, 400000) g',
			);
		},
		op: (d, i) => d.query('delete from bench_del where id = $1', [i + 1]),
		maxOps: 400_000,
	},
	{
		kind: 'ops',
		id: 'tx-empty',
		group: 'transactions',
		title: 'transaction: begin; select 1; commit',
		op: (d) =>
			d.transaction(async (tx) => {
				await tx.query('select 1');
			}),
	},
	{
		kind: 'ops',
		id: 'tx-insert',
		group: 'transactions',
		title: 'transaction: begin; insert; commit',
		setup: truncateWrites,
		op: (d, i) =>
			d.transaction(async (tx) => {
				await tx.query(INSERT1, [`tx${i}`, 1, '2024-01-01 00:00:00+00']);
			}),
	},
	{
		kind: 'ops',
		id: 'savepoints',
		group: 'transactions',
		title: 'transaction with 5 savepoints (select 1 in each)',
		op: (d) =>
			d.transaction(async (tx) => {
				for (let k = 0; k < 5; k++)
					await tx.savepoint(async (sp) => {
						await sp.query('select 1');
					});
			}),
	},

	// ------------------------------------------------------------ query-builder batches (quarry only)
	{
		kind: 'ops',
		id: 'batch3-seq',
		group: 'batches',
		title: '3 statements (lookup, insert, update): one after another',
		needs: 'builderBatch',
		op: (d, i) => d.builderBatch!('seq', false, i),
	},
	{
		kind: 'ops',
		id: 'batch3-all',
		group: 'batches',
		title: '3 statements (lookup, insert, update): Promise.all',
		needs: 'builderBatch',
		op: (d, i) => d.builderBatch!('all', false, i),
	},
	{
		kind: 'ops',
		id: 'batch3-batch',
		group: 'batches',
		title: '3 statements (lookup, insert, update): db.batch',
		needs: 'builderBatch',
		op: (d, i) => d.builderBatch!('batch', false, i),
	},
	{
		kind: 'ops',
		id: 'batch3-tx-seq',
		group: 'batches',
		title:
			'3 statements (lookup, insert, update) in a transaction: one after another',
		needs: 'builderBatch',
		op: (d, i) => d.builderBatch!('seq', true, i),
	},
	{
		kind: 'ops',
		id: 'batch3-tx-all',
		group: 'batches',
		title:
			'3 statements (lookup, insert, update) in a transaction: Promise.all',
		needs: 'builderBatch',
		op: (d, i) => d.builderBatch!('all', true, i),
	},
	{
		kind: 'ops',
		id: 'batch3-tx-batch',
		group: 'batches',
		title: '3 statements (lookup, insert, update) in a transaction: db.batch',
		needs: 'builderBatch',
		op: (d, i) => d.builderBatch!('batch', true, i),
	},

	// ------------------------------------------------------------ query-builder statements (quarry only; pk, insert1, update through `db`)
	{
		kind: 'ops',
		id: 'db-pk',
		group: 'builder',
		title: 'builder: point lookup by primary key (selectAll().expectOne())',
		rowsPerOp: 1,
		needs: 'builderOp',
		op: (d, i) => d.builderOp!('pk', i),
		check: (r, i) => expect(Number((r as Row)['id']) === pkId(i), 'row by id'),
	},
	{
		kind: 'ops',
		id: 'db-pk-timed',
		group: 'builder',
		title:
			"builder: point lookup with a statement timeout (execute({ timeout: '2s' }))",
		rowsPerOp: 1,
		needs: 'builderOp',
		op: (d, i) => d.builderOp!('pk-timed', i),
		check: (r, i) => expect(Number((r as Row)['id']) === pkId(i), 'row by id'),
	},
	{
		kind: 'ops',
		id: 'db-insert',
		group: 'builder',
		title: 'builder: insert one row',
		needs: 'builderOp',
		op: (d, i) => d.builderOp!('insert', i),
	},
	{
		kind: 'ops',
		id: 'db-update',
		group: 'builder',
		title: 'builder: update one row by primary key (score + 1)',
		needs: 'builderOp',
		op: (d, i) => d.builderOp!('update', i),
	},

	// ------------------------------------------------------------ errors
	{
		kind: 'ops',
		id: 'error',
		group: 'errors',
		title: 'query that fails (division by zero), connection reused',
		op: (d) =>
			d.query('select 1/0').then(
				() => new Error('no error'),
				(error: unknown) => error,
			),
		check: (r) =>
			expect(
				errorCode(r) === DIVISION_BY_ZERO,
				`SQLSTATE 22012, got ${errorCode(r)} (${String(r)})`,
			),
	},

	// ------------------------------------------------------------ streaming
	{
		kind: 'ops',
		id: 'stream1m',
		group: 'streaming',
		title: 'stream 1M rows with a cursor (1000 per batch)',
		rowsPerOp: 1_000_000,
		needs: 'stream',
		durationMs: 3000,
		minOps: 3,
		warmupMs: 0,
		warmupOps: 1,
		memOps: 3,
		op: async (d) => {
			let n = 0;
			await d.stream!('select * from bench_users', [], 1000, (batch) => {
				n += batch.length;
			});
			return n;
		},
		check: (r) => expect(r === 1_000_000, `streamed ${String(r)} rows`),
	},
	{
		kind: 'ops',
		id: 'stream-slow',
		group: 'streaming',
		title:
			'backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch)',
		rowsPerOp: 200_000,
		needs: 'stream',
		durationMs: 0,
		minOps: 2,
		warmupMs: 0,
		warmupOps: 1,
		op: async (d) => {
			let n = 0;
			await d.stream!(
				'select * from bench_users where id <= 200000',
				[],
				1000,
				async (batch) => {
					n += batch.length;
					await new Promise((r) => setTimeout(r, 2));
				},
			);
			return n;
		},
		check: (r) => expect(r === 200_000, `streamed ${String(r)} rows`),
	},

	{
		kind: 'custom',
		id: 'stream-pause',
		group: 'streaming',
		needs: 'stream',
		title:
			'backpressure: consumer pauses 3 s after the first batch of a 1M-row stream; RSS growth during the pause',
		run: async (d) => {
			const growth: number[] = [];
			const latencies: number[] = [];
			const start = performance.now();
			for (let k = 0; k < 3; k++) {
				let n = 0;
				let first = true;
				const t = performance.now();
				await d!.stream!(
					'select * from bench_users',
					[],
					1000,
					async (batch) => {
						n += batch.length;
						if (first) {
							first = false;
							const before = process.memoryUsage().rss;
							await new Promise((r) => setTimeout(r, 3000));
							growth.push((process.memoryUsage().rss - before) / 1048576);
						}
					},
				);
				latencies.push(performance.now() - t);
				expect(n === 1_000_000, `streamed ${n} rows`);
			}
			growth.sort((a, b) => a - b);
			return {
				latencies,
				ops: 3,
				elapsedMs: performance.now() - start,
				extra: { rssGrowthMB: growth[1] },
			};
		},
	},

	// ------------------------------------------------------------ custom
	...(['plain', 'tls'] as const).flatMap((tls) =>
		(['trust', 'scram'] as const).map((auth): CustomScenario => ({
			kind: 'custom',
			id: `connect-${tls}-${auth}`,
			group: 'connections',
			noPool: true,
			title: `connect + select 1 + close (${tls === 'tls' ? 'TLS verify-full' : 'no TLS'}, ${auth === 'scram' ? 'SCRAM-SHA-256' : 'trust'})`,
			run: async (_d, ctx, { durationMs }) => {
				const target: Target = {
					...ctx.target,
					host: tls === 'tls' ? 'localhost' : ctx.target.host,
					...(auth === 'scram'
						? { user: 'bench_scram', password: 'bench-scram-pw' }
						: {}),
					caFile: tls === 'tls' ? (ctx.data['caFile'] as string) : undefined,
				};
				for (let i = 0; i < 3; i++) await connectOnce(ctx.driverName, target);
				return loop(durationMs, 20, () => connectOnce(ctx.driverName, target));
			},
		})),
	),
	{
		kind: 'custom',
		id: 'pool-warmup',
		group: 'connections',
		noPool: true,
		title: 'pool warm-up: new pool (max 10), 10 concurrent select 1',
		run: async (_d, ctx, { durationMs }) => {
			const make = ctx.data['make'] as (max: number) => Promise<Driver>;
			return loop(durationMs, 10, async () => {
				const d = await make(10);
				await Promise.all(
					Array.from({ length: 10 }, () => d.query('select 1')),
				);
				await d.end();
			});
		},
	},
	{
		kind: 'custom',
		id: 'cancel',
		group: 'cancellation',
		needs: 'cancellable',
		title: 'cancel a running query (pg_sleep), time until the promise rejects',
		run: async (d, _ctx, { durationMs }) => {
			const latencies: number[] = [];
			const start = performance.now();
			let ok = 0;
			// a client whose cancel doesn't reach the server waits out the 3 s sleep
			while (
				latencies.length < 5 ||
				(performance.now() - start < durationMs && latencies.length < 50)
			) {
				const running = await d!.cancellable!('select pg_sleep(3)');
				const done = running.done;
				const settled = done.then(
					() => 'resolved',
					() => 'rejected',
				);
				await new Promise((r) => setTimeout(r, 30));
				const t = performance.now();
				running.cancel();
				const how = await settled;
				latencies.push(performance.now() - t);
				if (how === 'rejected') ok++;
				expect(
					Number((await d!.query('select 1 as x'))[0]?.['x']) === 1,
					'usable after cancel',
				);
			}
			return {
				latencies,
				ops: latencies.length,
				elapsedMs: performance.now() - start,
				extra: { rejected: ok },
			};
		},
	},
	{
		kind: 'custom',
		id: 'notify-throughput',
		group: 'notifications',
		needs: 'listen',
		title: 'LISTEN/NOTIFY throughput: 20k notifications in one transaction',
		run: async (d, _ctx, { durationMs }) => {
			const N = 20_000;
			let received = 0;
			let resolve: (() => void) | undefined;
			const unlisten = await d!.listen!('bench_tp', () => {
				if (++received === N) resolve?.();
			});
			const result = await loop(Math.max(durationMs, 1), 3, async () => {
				received = 0;
				const all = new Promise<void>((r) => (resolve = r));
				await d!.query(
					`select pg_notify('bench_tp', g::text) from generate_series(1, ${N}) g`,
				);
				await all;
			});
			await unlisten();
			return { ...result, extra: { perOp: N } };
		},
	},
	{
		kind: 'custom',
		id: 'notify-latency',
		group: 'notifications',
		needs: 'listen',
		title: 'LISTEN/NOTIFY latency: notify on another connection → handler',
		run: async (d, _ctx, { durationMs }) => {
			let waiting: { payload: string; resolve: () => void } | undefined;
			const unlisten = await d!.listen!('bench_lat', (payload) => {
				if (waiting?.payload === payload) waiting.resolve();
			});
			let i = 0;
			const result = await loop(durationMs, 200, async () => {
				const payload = String(i++);
				const got = new Promise<void>(
					(resolve) => (waiting = { payload, resolve }),
				);
				await Promise.all([
					d!.query(`select pg_notify('bench_lat', $1)`, [payload]),
					got,
				]);
			});
			await unlisten();
			return result;
		},
	},
	{
		kind: 'custom',
		id: 'reconnect',
		group: 'connections',
		title:
			'server restart: time from server up to the pool serving queries again',
		run: async (d, _ctx, { stdin }) => {
			const events: { t: number; ok: boolean }[] = [];
			const start = performance.now();
			const state = { stop: false };
			const loopDone = (async () => {
				while (!state.stop) {
					const ok = await Promise.race([
						d!.query('select 1 as x').then(
							() => true,
							() => false,
						),
						new Promise<boolean>((r) => setTimeout(() => r(false), 2000)),
					]);
					events.push({ t: Date.now(), ok });
					await new Promise((r) => setTimeout(r, 5));
				}
			})();
			await new Promise((r) => setTimeout(r, 500));
			process.stdout.write('READY\n');
			const line = (await stdin!.next()).value as string; // "UP <down ms> <up ms>"
			const [, downAt, upAt] = line.trim().split(' ').map(Number) as [
				string,
				number,
				number,
			];
			await new Promise((r) => setTimeout(r, 8000));
			state.stop = true;
			await loopDone;
			const firstFail = events.find((e) => !e.ok && e.t >= downAt - 50);
			const recovered = events.find(
				(e) =>
					e.ok && e.t > upAt && (firstFail === undefined || e.t > firstFail.t),
			);
			const failures = events.filter((e) => !e.ok).length;
			const recovery = recovered ? recovered.t - upAt : Number.NaN;
			return {
				latencies: [recovery],
				ops: events.length,
				elapsedMs: performance.now() - start,
				extra: {
					failedQueries: failures,
					recoveredMsAfterUp: recovery,
					downtimeMs: upAt - downAt,
					recovered: recovered !== undefined,
				},
			};
		},
	},
];

async function loop(
	durationMs: number,
	minOps: number,
	fn: () => Promise<unknown>,
): Promise<CustomResult> {
	const latencies: number[] = [];
	const start = performance.now();
	while (latencies.length < minOps || performance.now() - start < durationMs) {
		const t = performance.now();
		await fn();
		latencies.push(performance.now() - t);
	}
	return {
		latencies,
		ops: latencies.length,
		elapsedMs: performance.now() - start,
	};
}

export const byId = new Map(SCENARIOS.map((s) => [s.id, s]));
