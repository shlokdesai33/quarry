import { inject } from 'vitest';
import type { ConnectionOptions } from '../../../src/driver/config.js';
import { connect } from '../../../src/driver/connect.js';
import type { Connection } from '../../../src/driver/connection.js';
import { nodeSockets } from '../../../src/driver/node-socket.js';
import type {
	DriverSocket,
	SocketFactory,
} from '../../../src/driver/socket.js';

export const pg = inject('pg');

/** Skip a suite when there is no PostgreSQL to test against. */
export const noPg = pg === null;

/** Whether the test server is at least this major version, for gating version-specific tests. */
export const pgAtLeast = (major: number): boolean =>
	pg !== null && pg.serverVersionNum >= major * 10000;

export function cluster() {
	if (pg === null) throw new Error('No test cluster');
	return pg;
}

/** Options for the SCRAM superuser over TCP without TLS, plus overrides. */
export function options(overrides: ConnectionOptions = {}): ConnectionOptions {
	const c = cluster();
	return {
		host: c.host,
		port: c.port,
		database: c.database,
		user: c.users.scram.user,
		password: c.users.scram.password,
		ssl: 'disable',
		env: {},
		...overrides,
	};
}

export function open(overrides: ConnectionOptions = {}): Promise<Connection> {
	return connect(options(overrides));
}

/** A socket factory that records everything written, to inspect the bytes sent. */
export function recordingSockets(): {
	factory: SocketFactory;
	sent: () => string;
} {
	const chunks: Uint8Array[] = [];
	const factory: SocketFactory = {
		async connect(o) {
			const socket = await nodeSockets.connect(o);
			const wrapped: DriverSocket = {
				get encrypted() {
					return socket.encrypted;
				},
				write: (data) => {
					chunks.push(data.slice());
					return socket.write(data);
				},
				startTls: (t) => socket.startTls(t),
				peerCertificate: () => socket.peerCertificate(),
				pause: () => socket.pause(),
				resume: () => socket.resume(),
				end: () => socket.end(),
				destroy: () => socket.destroy(),
				onData: (h) => socket.onData(h),
				onClose: (h) => socket.onClose(h),
				onError: (h) => socket.onError(h),
				onDrain: (h) => socket.onDrain(h),
			};
			return wrapped;
		},
	};
	return {
		factory,
		sent: () => Buffer.concat(chunks).toString('latin1'),
	};
}

/** A fresh table name, so tests don't collide. */
let tableCount = 0;
export const table = (prefix = 't') =>
	`${prefix}_${process.pid}_${Date.now().toString(36)}_${++tableCount}`;

/** Awaits a rejection and checks its class, returning the typed error. */
export async function rejection<E extends Error>(
	promise: Promise<unknown>,
	type: abstract new (...args: never[]) => E,
): Promise<E> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof type) return error;
		throw error;
	}
	throw new Error(`Expected a ${type.name} rejection`);
}
