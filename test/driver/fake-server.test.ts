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
	{ type: 'ParameterStatus', name: 'server_version', value: '16.4' },
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
		expect(conn.parameters.get('server_version')).toBe('16.4');
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
