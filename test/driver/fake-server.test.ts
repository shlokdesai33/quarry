import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { statementNames } from '../../src/driver/capabilities.js';
import { connect } from '../../src/driver/connect.js';
import {
	ConnectionError,
	PostgresError,
	ProtocolError,
} from '../../src/driver/errors.js';
import type { BackendMessage } from '../../src/driver/protocol/messages.js';
import { encodeBackend } from './helpers/backend.js';

/** A scripted server: `onStartup` sees the protocol version and answers. */
type Script = (
	socket: Socket,
	version: number,
	send: (...messages: BackendMessage[]) => void,
) => void;

const servers: Server[] = [];
afterEach(() => {
	for (const server of servers.splice(0)) server.close();
});

async function fakeServer(script: Script): Promise<number> {
	const server = createServer((socket) => {
		let buffer = Buffer.alloc(0);
		let started = false;
		const send = (...messages: BackendMessage[]) => {
			for (const m of messages) socket.write(encodeBackend(m));
		};
		socket.on('error', () => {});
		socket.on('data', (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk]);
			if (started || buffer.length < 8) return;
			const length = buffer.readInt32BE(0);
			if (buffer.length < length) return;
			started = true;
			script(socket, buffer.readInt32BE(4), send);
		});
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	return typeof address === 'object' && address ? address.port : 0;
}

const ready: BackendMessage[] = [
	{ type: 'AuthenticationOk' },
	{ type: 'BackendKeyData', pid: 7, key: new Uint8Array([1, 2, 3, 4]) },
	{ type: 'ParameterStatus', name: 'server_version', value: '18.1' },
	{ type: 'ReadyForQuery', status: 'I' },
];

const options = (port: number) => ({
	host: '127.0.0.1',
	port,
	user: 'u',
	database: 'd',
	ssl: 'disable' as const,
	env: {},
});

describe('protocol negotiation with older servers and poolers', () => {
	it('accepts NegotiateProtocolVersion down to 3.0', async () => {
		const port = await fakeServer((_socket, version, send) => {
			expect(version).toBe(196610);
			send(
				{ type: 'NegotiateProtocolVersion', minor: 0, unrecognized: [] },
				...ready,
			);
		});
		await using conn = await connect(options(port));
		expect(conn.protocol).toBe('3.0');
		expect(conn.parameters.get('server_version')).toBe('18.1');
	});

	it('reconnects with 3.0 when a pooler rejects 3.2 outright', async () => {
		const versions: number[] = [];
		const port = await fakeServer((socket, version, send) => {
			versions.push(version);
			if (version === 196610) {
				send({
					type: 'ErrorResponse',
					fields: {
						S: 'FATAL',
						V: 'FATAL',
						C: '08P01',
						M: 'unsupported protocol version 3.2',
					},
				});
				socket.end();
			} else {
				send(...ready);
			}
		});
		await using conn = await connect(options(port));
		expect(versions).toEqual([196610, 196608]);
		expect(conn.protocol).toBe('3.0');
		// the host is remembered: the next connection asks for 3.0 at once
		await using again = await connect(options(port));
		expect(versions).toEqual([196610, 196608, 196608]);
		expect(again.protocol).toBe('3.0');
	});

	it('does not retry when the failure is not about the protocol', async () => {
		let attempts = 0;
		const port = await fakeServer((socket, _version, send) => {
			attempts++;
			send({
				type: 'ErrorResponse',
				fields: {
					S: 'FATAL',
					V: 'FATAL',
					C: '28P01',
					M: 'password authentication failed',
				},
			});
			socket.end();
		});
		await expect(connect(options(port))).rejects.toBeInstanceOf(PostgresError);
		expect(attempts).toBe(1);
	});

	it('rejects unsupported authentication methods clearly', async () => {
		const port = await fakeServer((_socket, _version, send) =>
			send({ type: 'AuthenticationUnsupported', code: 7 }),
		);
		await expect(connect(options(port))).rejects.toThrow(/GSSAPI/);
	});
});

describe('closing', () => {
	it('finishes once the Terminate is sent, without waiting for the server to close', async () => {
		let client: Socket | undefined;
		const received = Promise.withResolvers<Buffer>();
		const port = await fakeServer((socket, _version, send) => {
			client = socket;
			socket.on('data', (chunk: Buffer) => received.resolve(chunk));
			send(...ready);
		});
		const conn = await connect(options(port));
		const closeEvent = new Promise((resolve) => conn.onClose(resolve));
		// the server keeps its side open
		await conn.close();
		expect(conn.closed).toBe(true);
		expect([...(await received.promise)]).toEqual([0x58, 0, 0, 0, 4]);
		client?.end();
		await expect(closeEvent).resolves.toBeUndefined();
	});
});

describe('a misbehaving server', () => {
	it('closes the connection on garbage and fails pending queries', async () => {
		let client: Socket | undefined;
		const port = await fakeServer((socket, _version, send) => {
			client = socket;
			send(...ready);
		});
		const conn = await connect(options(port));
		const pending = conn.query('select 1');
		await new Promise((r) => setTimeout(r, 20));
		client?.write(Buffer.from([0x01, 0, 0, 0, 4]));
		await expect(pending).rejects.toBeInstanceOf(ProtocolError);
		expect(conn.closed).toBe(true);
	});

	it('fails pending queries when the server goes away', async () => {
		let client: Socket | undefined;
		const port = await fakeServer((socket, _version, send) => {
			client = socket;
			send(...ready);
		});
		const conn = await connect(options(port));
		const pending = conn.query('select 1');
		await new Promise((r) => setTimeout(r, 20));
		client?.destroy();
		await expect(pending).rejects.toBeInstanceOf(ConnectionError);
		await expect(conn.query('select 1')).rejects.toBeInstanceOf(
			ConnectionError,
		);
	});

	it('rejects bytes injected after the SSLRequest answer', async () => {
		const server = createServer((socket) => {
			socket.once('data', () => socket.write(Buffer.from('Sjunk')));
		});
		servers.push(server);
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve),
		);
		const address = server.address();
		const port = typeof address === 'object' && address ? address.port : 0;
		await expect(connect({ ...options(port), ssl: 'require' })).rejects.toThrow(
			/after the SSLRequest/,
		);
	});

	it('requires TLS when sslmode=require and the server says no', async () => {
		const server = createServer((socket) =>
			socket.once('data', () => socket.write('N')),
		);
		servers.push(server);
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve),
		);
		const address = server.address();
		const port = typeof address === 'object' && address ? address.port : 0;
		await expect(connect({ ...options(port), ssl: 'require' })).rejects.toThrow(
			/does not support TLS/,
		);
	});
});

describe('cancel requests', () => {
	const CANCEL_CODE = 80877102;

	/** A server that runs queries forever, answering their first messages when `answer`; counts cancel requests. */
	async function slowServer(answer: boolean) {
		const state = { cancels: 0, client: undefined as Socket | undefined };
		const port = await fakeServer((socket, version, send) => {
			if (version === CANCEL_CODE) {
				state.cancels++;
				socket.end();
				return;
			}
			state.client = socket;
			socket.on('data', () => {
				if (answer) send({ type: 'ParseComplete' }, { type: 'BindComplete' });
			});
			send(...ready);
		});
		return { state, port };
	}

	const aborted = async (port: number) => {
		const conn = await connect(options(port));
		const controller = new AbortController();
		const query = conn.query('select pg_sleep(60)', [], {
			prepare: false,
			signal: controller.signal,
		});
		query.catch(() => {});
		await new Promise((r) => setTimeout(r, 30));
		controller.abort();
		await new Promise((r) => setTimeout(r, 400));
		conn.destroy();
	};

	it('stops repeating the cancel once the server answered part of the query', async () => {
		const { state, port } = await slowServer(true);
		await aborted(port);
		expect(state.cancels).toBe(1);
	});

	it('repeats the cancel while the server has answered nothing of the query', async () => {
		const { state, port } = await slowServer(false);
		await aborted(port);
		expect(state.cancels).toBeGreaterThanOrEqual(3);
	});
});

describe('tolerating the unknown and refusing the unsafe', () => {
	it('accepts unrecognized _pq_ options and unknown parameters and error fields', async () => {
		let client: Socket | undefined;
		const port = await fakeServer((socket, _version, send) => {
			client = socket;
			send(
				{
					type: 'NegotiateProtocolVersion',
					minor: 2,
					unrecognized: ['_pq_.future_option'],
				},
				{ type: 'ParameterStatus', name: 'some_future_setting', value: 'x' },
				...ready,
			);
		});
		await using conn = await connect(options(port));
		expect(conn.protocol).toBe('3.2');
		expect(conn.unrecognizedProtocolOptions).toEqual(['_pq_.future_option']);
		expect(conn.parameters.get('some_future_setting')).toBe('x');
		expect(conn.capabilities).toMatchObject({
			serverVersion: '18.1',
			protocol: '3.2',
		});
		const pending = conn.query('select 1');
		await new Promise((r) => setTimeout(r, 20));
		client?.write(
			encodeBackend({
				type: 'ErrorResponse',
				fields: {
					S: 'ERROR',
					V: 'ERROR',
					C: 'XX999',
					M: 'future',
					Z: 'unknown field',
				},
			}),
		);
		client?.write(encodeBackend({ type: 'ReadyForQuery', status: 'I' }));
		const error = await pending.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(PostgresError);
		expect(error instanceof PostgresError && error.fields['Z']).toBe(
			'unknown field',
		);
	});

	it('refuses a server that negotiates below min_protocol_version', async () => {
		const port = await fakeServer((_socket, _version, send) =>
			send(
				{ type: 'NegotiateProtocolVersion', minor: 0, unrecognized: [] },
				...ready,
			),
		);
		await expect(
			connect({ ...options(port), minProtocolVersion: '3.2' }),
		).rejects.toThrow(/min_protocol_version is 3.2/);
	});

	it('reports unknown authentication request codes clearly', async () => {
		const port = await fakeServer((_socket, _version, send) =>
			send({ type: 'AuthenticationUnsupported', code: 42 }),
		);
		await expect(connect(options(port))).rejects.toThrow(
			/unknown authentication method \(request code 42\)/,
		);
	});

	it('refuses AuthenticationOk before SCRAM finished (a server skipping mutual authentication)', async () => {
		const port = await fakeServer((socket, _version, send) => {
			send({ type: 'AuthenticationSASL', mechanisms: ['SCRAM-SHA-256'] });
			socket.once('data', () =>
				send({ type: 'AuthenticationOk' }, ...ready.slice(1)),
			);
		});
		await expect(connect({ ...options(port), password: 'pw' })).rejects.toThrow(
			/without proving it knows the password/,
		);
	});

	it('refuses a server or pooler that offers only OAUTHBEARER, without answering it', async () => {
		const sent: number[] = [];
		const port = await fakeServer((socket, _version, send) => {
			send({ type: 'AuthenticationSASL', mechanisms: ['OAUTHBEARER'] });
			socket.on('data', (chunk: Buffer) => sent.push(chunk[0] ?? 0));
		});
		const error = await connect({ ...options(port), password: 'pw' }).catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(ConnectionError);
		expect(error).toMatchObject({ code: 'EAUTHMETHOD' });
		expect(error instanceof Error && error.message).toMatch(
			/SASL authentication with OAUTHBEARER, an authentication method this driver does not support/,
		);
		// no SASLInitialResponse ('p'): neither a token nor a SCRAM message went out
		expect(sent).not.toContain(0x70);
	});

	it('answers with SCRAM when OAUTHBEARER is offered alongside it', async () => {
		const received: string[] = [];
		const port = await fakeServer((socket, _version, send) => {
			send({
				type: 'AuthenticationSASL',
				mechanisms: ['OAUTHBEARER', 'SCRAM-SHA-256'],
			});
			socket.once('data', (chunk: Buffer) => {
				received.push(chunk.subarray(5).toString('latin1'));
				socket.end();
			});
		});
		await connect({ ...options(port), password: 'pw' }).catch(() => {});
		expect(received[0]).toMatch(/^SCRAM-SHA-256\0/);
	});
});

describe('server version', () => {
	const serving = (version: string | undefined) =>
		fakeServer((_socket, _version, send) =>
			send(
				{ type: 'AuthenticationOk' },
				...(version === undefined
					? []
					: [
							{
								type: 'ParameterStatus' as const,
								name: 'server_version',
								value: version,
							},
						]),
				{ type: 'ReadyForQuery', status: 'I' },
			),
		);

	it('refuses servers older than PostgreSQL 18', async () => {
		const error = await connect(
			options(await serving('17.6 (Debian 17.6-1)')),
		).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ConnectionError);
		expect(error).toMatchObject({
			code: 'EVERSION',
			message:
				'quarry requires PostgreSQL 18 or later; the server reports version 17.6 (Debian 17.6-1)',
		});
	});

	it('accepts 18, newer versions, and poolers that hide the version', async () => {
		for (const version of ['18.0', '19devel', '20.1', 'pooler', undefined]) {
			// oxlint-disable-next-line no-await-in-loop
			await using conn = await connect(options(await serving(version)));
			expect(conn.capabilities.serverVersion).toBe(version);
		}
	});
});

/** Splits client data into messages: type and, for Parse, the SQL. */
const messages = (data: Buffer) => {
	const out: { type: string; sql?: string }[] = [];
	for (let i = 0; i + 5 <= data.length;) {
		const type = String.fromCharCode(data[i] ?? 0);
		const end = i + 1 + data.readInt32BE(i + 1);
		if (type === 'P') {
			const name = data.indexOf(0, i + 5);
			out.push({
				type,
				sql: data.toString('utf8', name + 1, data.indexOf(0, name + 1)),
			});
		} else out.push({ type });
		i = end;
	}
	return out;
};

describe('transactions', () => {
	it('skips the first statement when the server rejects BEGIN, and sends nothing more', async () => {
		const segments: string[][] = [];
		const port = await fakeServer((socket, _version, send) => {
			send(...ready);
			let segment: string[] = [];
			socket.on('data', (chunk: Buffer) => {
				for (const m of messages(chunk)) {
					if (m.sql !== undefined) segment.push(m.sql);
					if (m.type !== 'S') continue;
					segments.push(segment);
					segment = [];
					send(
						{
							type: 'ErrorResponse',
							fields: {
								S: 'ERROR',
								V: 'ERROR',
								C: '25001',
								M: 'begin refused',
							},
						},
						{ type: 'ReadyForQuery', status: 'I' },
					);
				}
			});
		});
		await using conn = await connect(options(port));
		let first: unknown;
		let second: unknown;
		const error = await conn
			.transaction(async (tx) => {
				first = await tx
					.query('insert into t values (1)')
					.catch((e: unknown) => e);
				second = await tx
					.query('insert into t values (2)')
					.catch((e: unknown) => e);
			})
			.catch((e: unknown) => e);
		await new Promise((r) => setTimeout(r, 20));
		expect(error).toBeInstanceOf(PostgresError);
		expect(error).toMatchObject({ code: '25001', message: 'begin refused' });
		expect(first).toBe(error);
		expect(second).toBe(error);
		// one Sync for both, and neither the second insert, COMMIT nor ROLLBACK sent
		expect(segments).toEqual([['begin', 'insert into t values (1)']]);
	});
});

/** What PgBouncer 1.26+ reports at login. */
const pgbouncer = (poolMode: string, maxPreparedStatements: number) => ({
	'pgbouncer.version': '1.26.0',
	'pgbouncer.pool_mode': poolMode,
	'pgbouncer.max_prepared_statements': String(maxPreparedStatements),
});

describe('statement names behind a pooler', () => {
	/** A server that reports `parameters` and answers every statement as an insert, recording the statement each Parse and Bind names. */
	async function pooler(parameters: Record<string, string>) {
		const parsed: string[] = [];
		const bound: string[] = [];
		const port = await fakeServer((socket, _version, send) => {
			send(
				{ type: 'AuthenticationOk' },
				...Object.entries(parameters).map(([name, value]) => ({
					type: 'ParameterStatus' as const,
					name,
					value,
				})),
				{ type: 'ReadyForQuery', status: 'I' },
			);
			socket.on('data', (data: Buffer) => {
				const cstring = (start: number) =>
					data.toString('latin1', start, data.indexOf(0, start));
				for (
					let i = 0;
					i + 5 <= data.length;
					i += 1 + data.readInt32BE(i + 1)
				) {
					switch (String.fromCharCode(data[i] ?? 0)) {
						case 'P':
							parsed.push(cstring(i + 5));
							send({ type: 'ParseComplete' });
							break;
						case 'B':
							bound.push(cstring(data.indexOf(0, i + 5) + 1));
							send({ type: 'BindComplete' });
							break;
						case 'D':
							if (data[i + 5] === 0x53)
								send({ type: 'ParameterDescription', typeOids: [23] });
							send({ type: 'NoData' });
							break;
						case 'E':
							send({ type: 'CommandComplete', tag: 'INSERT 0 1' });
							break;
						case 'S':
							send({ type: 'ReadyForQuery', status: 'I' });
							break;
						default:
					}
				}
			});
		});
		return { port, parsed, bound };
	}

	/** One query alone, three pipelined, then one alone again. */
	async function run(port: number, preparePipelined?: boolean) {
		await using conn = await connect({
			...options(port),
			...(preparePipelined === undefined ? {} : { preparePipelined }),
		});
		const insert = () => conn.query('insert into t values ($1)', [1]);
		await insert();
		await Promise.all([insert(), insert(), insert()]);
		await insert();
		return conn.capabilities;
	}

	it('sends pipelined queries unnamed through PgBouncer in transaction mode', async () => {
		const { port, parsed, bound } = await pooler(pgbouncer('transaction', 200));
		const capabilities = await run(port);
		expect(capabilities.pgbouncer).toEqual({
			version: '1.26.0',
			poolMode: 'transaction',
			maxPreparedStatements: 200,
		});
		expect(statementNames(capabilities.pgbouncer)).toBe('rewritten');
		// unnamed on its first run, then pipelined; named once alone again
		expect(parsed).toEqual(['', '', '', '', 'q1']);
		expect(bound).toEqual(['', '', '', '', 'q1']);
	});

	it('names no statement when PgBouncer in transaction mode keeps none', async () => {
		const { port, parsed, bound } = await pooler(pgbouncer('transaction', 0));
		expect(statementNames((await run(port)).pgbouncer)).toBe('unsupported');
		expect(parsed).toEqual(['', '', '', '', '']);
		expect(bound).toEqual(['', '', '', '', '']);
	});

	it('names every statement directly, in session mode, or when asked to', async () => {
		for (const [parameters, preparePipelined] of [
			[{}, undefined],
			[pgbouncer('session', 0), undefined],
			[pgbouncer('transaction', 200), true],
		] as const) {
			// oxlint-disable-next-line no-await-in-loop
			const { port, parsed, bound } = await pooler(parameters);
			// oxlint-disable-next-line no-await-in-loop
			await run(port, preparePipelined);
			// unnamed on its first run, prepared on its second
			expect(parsed).toEqual(['', 'q1']);
			expect(bound).toEqual(['', 'q1', 'q1', 'q1', 'q1']);
		}
	});

	it('sends pipelined queries unnamed when asked to (PgBouncer before 1.26)', async () => {
		const { port, parsed, bound } = await pooler({});
		const capabilities = await run(port, false);
		expect(capabilities.pgbouncer).toBeUndefined();
		expect(parsed).toEqual(['', '', '', '', 'q1']);
		expect(bound).toEqual(['', '', '', '', 'q1']);
	});

	it('prepares SQL on its prepareThreshold-th successful run', async () => {
		for (const [threshold, names] of [
			[1, ['q1']],
			[3, ['', '', 'q1']],
		] as const) {
			// oxlint-disable-next-line no-await-in-loop
			const { port, parsed } = await pooler({});
			// oxlint-disable-next-line no-await-in-loop
			await using conn = await connect({
				...options(port),
				prepareThreshold: threshold,
			});
			for (let i = 0; i < 4; i++)
				// oxlint-disable-next-line no-await-in-loop
				await conn.query('insert into t values ($1)', [i]);
			expect(parsed).toEqual(names);
		}
	});

	it('keeps prepared statements cached when SQL run once fills the cache', async () => {
		const { port, parsed, bound } = await pooler({});
		await using conn = await connect({ ...options(port), statementCacheSize: 4 });
		const hot = ['a', 'b'].map((t) => `insert into ${t} values ($1)`);
		for (const sql of [...hot, ...hot]) await conn.query(sql, [1]);
		for (let i = 0; i < 20; i++)
			await conn.query(`insert into once${i} values ($1)`, [1]);
		for (const sql of hot) await conn.query(sql, [1]);
		// the hot statements were prepared once, and are still bound by name
		expect(parsed.filter((name) => name !== '')).toEqual(['q1', 'q2']);
		expect(bound.slice(-2)).toEqual(['q1', 'q2']);
	});
});
