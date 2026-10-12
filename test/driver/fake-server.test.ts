import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
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
			longCancelKeys: true,
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
