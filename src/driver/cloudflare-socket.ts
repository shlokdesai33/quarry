import { ConnectionError } from './errors.js';
import type {
	DriverSocket,
	SocketConnectOptions,
	SocketFactory,
	TlsConnectOptions,
} from './socket.js';

/** The parts of a `cloudflare:sockets` Socket the driver uses. */
interface WorkersSocket {
	readonly readable: ReadableStream<Uint8Array>;
	readonly writable: WritableStream<Uint8Array>;
	readonly opened: Promise<unknown>;
	readonly closed: Promise<void>;
	close(): Promise<void>;
	startTls(options?: { expectedServerHostname?: string }): WorkersSocket;
}

type Connect = (
	address: { hostname: string; port: number },
	options: {
		secureTransport: 'off' | 'on' | 'starttls';
		allowHalfOpen: boolean;
	},
) => WorkersSocket;

/**
 * Bytes queued on the socket before `write` reports a full buffer, as
 * Node's default high-water mark. Workers' socket streams always report a
 * `desiredSize` of 1, however much is queued, so the driver counts the
 * bytes whose writes haven't completed itself.
 */
const HIGH_WATER_MARK = 65_536;

// a variable, so bundlers and the type checker leave the Workers-only module alone
const MODULE = 'cloudflare:sockets';

async function loadConnect(): Promise<Connect> {
	const mod: unknown = await import(/* @vite-ignore */ MODULE);
	const connect: unknown =
		typeof mod === 'object' && mod !== null
			? Reflect.get(mod, 'connect')
			: undefined;
	if (typeof connect !== 'function')
		throw new ConnectionError('cloudflare:sockets is not available here');
	return (address, options) =>
		Reflect.apply(connect, undefined, [address, options]);
}

/** What Workers' TLS can't do: it always verifies against the public CA store, with no client certificates or ALPN. */
function checkTls(
	options: TlsConnectOptions | undefined,
	direct: boolean,
): void {
	if (options === undefined) return;
	if (direct)
		throw new ConnectionError(
			'Direct TLS (sslnegotiation=direct) is not possible on Cloudflare Workers: it cannot set ALPN',
		);
	if (options.ca !== undefined)
		throw new ConnectionError(
			'Custom CA certificates are not supported on Cloudflare Workers, which verify against public CAs',
		);
	if (options.cert !== undefined)
		throw new ConnectionError(
			'Client certificates are not supported on Cloudflare Workers',
		);
	if (!options.verifyChain) {
		throw new ConnectionError(
			'Cloudflare Workers always verify TLS certificates; use sslmode=verify-full (or verify-ca)',
		);
	}
}

class CloudflareSocket implements DriverSocket {
	#socket: WorkersSocket;
	#writer: WritableStreamDefaultWriter<Uint8Array>;
	#reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	#encrypted: boolean;
	#closed = false;
	#paused: { promise: Promise<void>; resolve: () => void } | undefined;
	#onData: (chunk: Uint8Array) => void = () => {};
	#onClose: () => void = () => {};
	#onError: (error: Error) => void = () => {};
	#onDrain: () => void = () => {};
	/** Bytes written whose write hasn't completed yet. */
	#buffered = 0;
	/** `write` reported a full buffer: `onDrain` fires once it empties. */
	#needDrain = false;

	constructor(socket: WorkersSocket, encrypted: boolean) {
		this.#socket = socket;
		this.#encrypted = encrypted;
		this.#writer = socket.writable.getWriter();
		void this.#read();
	}

	/* oxlint-disable no-await-in-loop -- reading a stream, one chunk after another */
	async #read(): Promise<void> {
		const reader = this.#socket.readable.getReader();
		this.#reader = reader;
		try {
			for (;;) {
				if (this.#paused) await this.#paused.promise;
				const { done, value } = await reader.read();
				if (done) break;
				this.#onData(value);
			}
		} catch (error) {
			// a released reader (startTls) ends this loop quietly
			if (this.#reader !== reader) return;
			this.#onError(
				new ConnectionError(
					error instanceof Error ? error.message : 'Socket read failed',
					{ cause: error },
				),
			);
		}
		if (this.#reader === reader && !this.#closed) {
			this.#closed = true;
			this.#onClose();
		}
	}

	/* oxlint-enable no-await-in-loop */

	get encrypted(): boolean {
		return this.#encrypted;
	}

	write(data: Uint8Array): boolean {
		const size = data.length;
		this.#buffered += size;
		this.#writer.write(data).then(
			() => {
				this.#buffered -= size;
				if (this.#needDrain && this.#buffered === 0) {
					this.#needDrain = false;
					this.#onDrain();
				}
				return undefined;
			},
			(error: unknown) => {
				this.#onError(
					new ConnectionError(
						error instanceof Error ? error.message : 'Socket write failed',
						{ cause: error },
					),
				);
			},
		);
		if (this.#buffered < HIGH_WATER_MARK) return true;
		this.#needDrain = true;
		return false;
	}

	async startTls(options: TlsConnectOptions): Promise<void> {
		checkTls(options, false);
		const reader = this.#reader;
		this.#reader = undefined;
		await reader?.cancel().catch(() => {});
		reader?.releaseLock();
		this.#writer.releaseLock();
		const secure = this.#socket.startTls({
			expectedServerHostname: options.servername ?? options.host,
		});
		this.#socket = secure;
		this.#writer = secure.writable.getWriter();
		this.#encrypted = true;
		await secure.opened;
		void this.#read();
	}

	peerCertificate(): Uint8Array | undefined {
		// not exposed on Workers, so SCRAM runs without channel binding
		return undefined;
	}

	pause(): void {
		if (this.#paused) return;
		this.#paused = Promise.withResolvers<void>();
	}

	resume(): void {
		const paused = this.#paused;
		this.#paused = undefined;
		paused?.resolve();
	}

	end(): void {
		void this.#writer.close().catch(() => {});
	}

	destroy(): void {
		this.#closed = true;
		void this.#socket.close().catch(() => {});
	}

	onData(handler: (chunk: Uint8Array) => void): void {
		this.#onData = handler;
	}

	onClose(handler: () => void): void {
		this.#onClose = handler;
	}

	onError(handler: (error: Error) => void): void {
		this.#onError = handler;
	}

	onDrain(handler: () => void): void {
		this.#onDrain = handler;
	}
}

/**
 * Sockets from Cloudflare Workers' `cloudflare:sockets`. Used automatically
 * on Workers. TLS there always verifies against public CAs, and the server
 * certificate isn't exposed, so SCRAM runs without channel binding.
 */
export const cloudflareSockets: SocketFactory = {
	async connect(options: SocketConnectOptions): Promise<DriverSocket> {
		if (options.target.kind === 'unix')
			throw new ConnectionError(
				'Unix-domain sockets are not available on Cloudflare Workers',
			);
		checkTls(options.tls, options.tls !== undefined);
		const connect = await loadConnect();
		const socket = connect(
			{ hostname: options.target.host, port: options.target.port },
			{ secureTransport: 'starttls', allowHalfOpen: false },
		);
		try {
			await socket.opened;
		} catch (error) {
			throw new ConnectionError(
				error instanceof Error ? error.message : 'Could not connect',
				{ cause: error, code: 'ECONNREFUSED' },
			);
		}
		return new CloudflareSocket(socket, false);
	},
};

/** Whether this is a Cloudflare Workers runtime. */
export function isCloudflareWorkers(): boolean {
	const nav: unknown = Reflect.get(globalThis, 'navigator');
	return (
		typeof nav === 'object' &&
		nav !== null &&
		Reflect.get(nav, 'userAgent') === 'Cloudflare-Workers'
	);
}
