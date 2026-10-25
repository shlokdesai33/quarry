import { expect, test, vi } from 'vitest';
import { nodeSockets, socketErrorMessage } from '../../src/driver/node-socket.js';

function systemError(message: string, code: string) {
	return Object.assign(new Error(message), { code });
}

test('a socket error keeps its message', () => {
	expect(
		socketErrorMessage(
			systemError('connect ECONNREFUSED 127.0.0.1:1', 'ECONNREFUSED'),
		),
	).toBe('connect ECONNREFUSED 127.0.0.1:1');
});

test("an AggregateError, as connecting to localhost raises, uses its errors' messages", () => {
	const error = Object.assign(
		new AggregateError(
			[
				systemError('connect ECONNREFUSED ::1:1', 'ECONNREFUSED'),
				systemError('connect ECONNREFUSED 127.0.0.1:1', 'ECONNREFUSED'),
			],
			'',
		),
		{ code: 'ECONNREFUSED' },
	);
	expect(socketErrorMessage(error)).toBe(
		'connect ECONNREFUSED ::1:1; connect ECONNREFUSED 127.0.0.1:1',
	);
	expect(
		socketErrorMessage(
			Object.assign(new AggregateError([], ''), { code: 'EHOSTUNREACH' }),
		),
	).toBe('EHOSTUNREACH');
	expect(socketErrorMessage(new Error(''))).toBe('the connection failed');
});

test('TCP sockets are opened with NODELAY and keepalive in the connect options, before any handshake', async () => {
	const net = process.getBuiltinModule('node:net');
	const tls = process.getBuiltinModule('node:tls');
	const server = net.createServer((socket) => socket.destroy());
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('no port');
	const target = { kind: 'tcp', host: '127.0.0.1', port: address.port } as const;
	const netConnect = vi.spyOn(net, 'connect');
	const tlsConnect = vi.spyOn(tls, 'connect');
	try {
		const socket = await nodeSockets.connect({
			target,
			tls: undefined,
			keepAlive: true,
			keepAliveInitialDelay: 1000,
		});
		socket.destroy();
		expect(netConnect.mock.calls[0]?.[0]).toMatchObject({
			noDelay: true,
			keepAlive: true,
			keepAliveInitialDelay: 1000,
		});
		await nodeSockets
			.connect({
				target,
				keepAlive: false,
				keepAliveInitialDelay: 0,
				tls: {
					servername: undefined,
					ca: undefined,
					cert: undefined,
					key: undefined,
					passphrase: undefined,
					alpn: undefined,
					verifyChain: false,
					verifyHostname: false,
					host: '127.0.0.1',
				},
			})
			.catch(() => {});
		expect(tlsConnect.mock.calls[0]?.[0]).toMatchObject({ noDelay: true });
	} finally {
		netConnect.mockRestore();
		tlsConnect.mockRestore();
		server.close();
	}
});
