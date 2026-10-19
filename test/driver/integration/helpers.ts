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

/**
 * A socket factory that measures what the driver hands the socket: the
 * largest single write, and the most bytes written between two drain
 * events (what can pile up in the socket's buffer when the driver ignores
 * backpressure).
 */
export function meteredSockets(): {
	factory: SocketFactory;
	largestWrite(): number;
	mostBetweenDrains(): number;
} {
	let largest = 0;
	let most = 0;
	const factory: SocketFactory = {
		async connect(o) {
			const socket = await nodeSockets.connect(o);
			let sinceDrain = 0;
			const wrapped: DriverSocket = {
				get encrypted() {
					return socket.encrypted;
				},
				write: (data) => {
					largest = Math.max(largest, data.length);
					sinceDrain += data.length;
					most = Math.max(most, sinceDrain);
					const ok = socket.write(data);
					if (ok) sinceDrain = 0;
					return ok;
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
				onDrain: (h) =>
					socket.onDrain(() => {
						sinceDrain = 0;
						h();
					}),
			};
			return wrapped;
		},
	};
	return {
		factory,
		largestWrite: () => largest,
		mostBetweenDrains: () => most,
	};
}

/**
 * A socket factory that counts round trips: writes that follow data from
 * the server. Writes with no answer in between are pipelined into one.
 * It counts the socket writes too.
 */
export function roundTripSockets(): {
	factory: SocketFactory;
	roundTrips(): number;
	writes(): number;
} {
	let count = 0;
	let writes = 0;
	const factory: SocketFactory = {
		async connect(o) {
			const socket = await nodeSockets.connect(o);
			let answered = true;
			const wrapped: DriverSocket = {
				get encrypted() {
					return socket.encrypted;
				},
				write: (data) => {
					if (answered) count++;
					writes++;
					answered = false;
					return socket.write(data);
				},
				startTls: (t) => socket.startTls(t),
				peerCertificate: () => socket.peerCertificate(),
				pause: () => socket.pause(),
				resume: () => socket.resume(),
				end: () => socket.end(),
				destroy: () => socket.destroy(),
				onData: (h) =>
					socket.onData((data) => {
						answered = true;
						h(data);
					}),
				onClose: (h) => socket.onClose(h),
				onError: (h) => socket.onError(h),
				onDrain: (h) => socket.onDrain(h),
			};
			return wrapped;
		},
	};
	return { factory, roundTrips: () => count, writes: () => writes };
}

/** Calls `visit` with the type of each complete message in `data` from `offset`; returns where the incomplete tail starts. */
function eachMessage(
	data: Uint8Array,
	visit: (type: number) => void,
	offset = 0,
): number {
	let i = offset;
	while (i + 5 <= data.length) {
		const length =
			((data[i + 1]! << 24) |
				(data[i + 2]! << 16) |
				(data[i + 3]! << 8) |
				data[i + 4]!) >>>
			0;
		if (i + 1 + length > data.length) break;
		visit(data[i]!);
		i += 1 + length;
	}
	return i;
}

/**
 * A socket factory that delays everything the server sends by `delay`
 * milliseconds (a simulated network round trip) and tracks how many
 * queries each connection has in flight: sent (Sync or Query) but not yet
 * answered (ReadyForQuery delivered to the driver).
 */
export function slowSockets(delay: number): {
	factory: SocketFactory;
	/** The most queries in flight on one connection since the last reset. */
	maxInFlight(): number;
	reset(): void;
} {
	let max = 0;
	const factory: SocketFactory = {
		async connect(o) {
			const socket = await nodeSockets.connect(o);
			let started = false;
			let ready = false;
			let inFlight = 0;
			let pending: Uint8Array = new Uint8Array(0);
			const wrapped: DriverSocket = {
				get encrypted() {
					return socket.encrypted;
				},
				write: (data) => {
					// the startup message has no type byte
					if (started)
						eachMessage(data, (type) => {
							if (type === 0x53 || type === 0x51) inFlight++;
						});
					started = true;
					max = Math.max(max, inFlight);
					return socket.write(data);
				},
				startTls: (t) => socket.startTls(t),
				peerCertificate: () => socket.peerCertificate(),
				pause: () => socket.pause(),
				resume: () => socket.resume(),
				end: () => socket.end(),
				destroy: () => socket.destroy(),
				onData: (h) =>
					socket.onData((data) => {
						const copy = data.slice();
						setTimeout(() => {
							const all = new Uint8Array(pending.length + copy.length);
							all.set(pending);
							all.set(copy, pending.length);
							const rest = eachMessage(all, (type) => {
								if (type !== 0x5a) return;
								// the first ReadyForQuery ends startup
								if (ready) inFlight--;
								ready = true;
							});
							pending = all.slice(rest);
							h(copy);
						}, delay);
					}),
				// after any data still being delayed
				onClose: (h) => socket.onClose(() => setTimeout(h, delay)),
				onError: (h) => socket.onError(h),
				onDrain: (h) => socket.onDrain(h),
			};
			return wrapped;
		},
	};
	return {
		factory,
		maxInFlight: () => max,
		reset: () => {
			max = 0;
		},
	};
}

/** A connection of `timeSlicedSockets`, as the simulated server sees it. */
interface Backend {
	held: Uint8Array[];
	/** When its oldest held reply arrived. */
	heldSince: number;
	deliver: (data: Uint8Array) => void;
	lastWrite: number;
}

/** Delivers a backend's held replies. */
function flush(backend: Backend): void {
	for (const data of backend.held.splice(0)) backend.deliver(data);
}

/**
 * A socket factory that makes the server look like one with `cpus` CPUs
 * time-slicing its backends: a connection's replies are delivered only
 * while it holds one of the CPUs, which rotate every `slice` milliseconds
 * among the connections with replies waiting. Also records when each
 * connection last sent something.
 */
export function timeSlicedSockets(
	cpus: number,
	slice: number,
): {
	factory: SocketFactory;
	/** How many connections sent something in the last `ms` milliseconds. */
	sending(ms: number): number;
	/** Stops time-slicing: every connection gets a CPU of its own. */
	stop(): void;
} {
	const backends: Backend[] = [];
	let running = new Set<Backend>();
	// the ones waiting longest run next
	const schedule = () => {
		running = new Set(
			backends
				.filter((b) => b.held.length > 0)
				.toSorted((a, b) => a.heldSince - b.heldSince)
				.slice(0, cpus),
		);
		for (const backend of running) flush(backend);
	};
	const timer = setInterval(schedule, slice);
	const factory: SocketFactory = {
		async connect(o) {
			const socket = await nodeSockets.connect(o);
			const backend: Backend = {
				held: [],
				heldSince: 0,
				deliver: () => {},
				lastWrite: 0,
			};
			const wrapped: DriverSocket = {
				get encrypted() {
					return socket.encrypted;
				},
				write: (data) => {
					backend.lastWrite = performance.now();
					return socket.write(data);
				},
				startTls: (t) => socket.startTls(t),
				peerCertificate: () => socket.peerCertificate(),
				pause: () => socket.pause(),
				resume: () => socket.resume(),
				end: () => socket.end(),
				destroy: () => socket.destroy(),
				onData: (h) => {
					backend.deliver = h;
					socket.onData((data) => {
						if (running.size < cpus) running.add(backend);
						if (running.has(backend)) h(data);
						else {
							if (backend.held.length === 0)
								backend.heldSince = performance.now();
							backend.held.push(data.slice());
						}
					});
				},
				onClose: (h) =>
					socket.onClose(() => {
						flush(backend);
						backends.splice(backends.indexOf(backend), 1);
						running.delete(backend);
						h();
					}),
				onError: (h) => socket.onError(h),
				onDrain: (h) => socket.onDrain(h),
			};
			backends.push(backend);
			return wrapped;
		},
	};
	return {
		factory,
		sending: (ms) => {
			const since = performance.now() - ms;
			return backends.filter((b) => b.lastWrite >= since).length;
		},
		stop: () => {
			clearInterval(timer);
			cpus = Number.POSITIVE_INFINITY;
			for (const backend of backends) flush(backend);
		},
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
