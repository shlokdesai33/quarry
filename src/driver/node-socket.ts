import type * as Net from 'node:net';
import type * as Tls from 'node:tls';
import { ConnectionError } from './errors.js';
import type {
	DriverSocket,
	SocketConnectOptions,
	SocketFactory,
	TlsConnectOptions,
} from './socket.js';

/**
 * Node's built-in module `id`, through `process.getBuiltinModule` where the
 * runtime has it: much cheaper than `import()` on a cold start.
 */
function builtin<const I extends 'node:net' | 'node:tls'>(id: I) {
	return typeof process === 'object' &&
		typeof process.getBuiltinModule === 'function'
		? process.getBuiltinModule(id)
		: undefined;
}

let netModule: typeof Net | Promise<typeof Net> | undefined;
let tlsModule: typeof Tls | Promise<typeof Tls> | undefined;

// Loaded on first use, so the core stays importable elsewhere. `node:tls`
// loads the whole crypto stack (~3 ms), so plain connections never load it.
const loadNet = () => (netModule ??= builtin('node:net') ?? import('node:net'));
const loadTls = () => (tlsModule ??= builtin('node:tls') ?? import('node:tls'));

function tlsOptions(
	tls: typeof Tls,
	options: TlsConnectOptions,
): Tls.ConnectionOptions {
	return {
		rejectUnauthorized: options.verifyChain,
		checkServerIdentity: options.verifyHostname
			? (_host, cert) => tls.checkServerIdentity(options.host, cert)
			: () => undefined,
		...(options.servername === undefined
			? {}
			: { servername: options.servername }),
		...(options.ca === undefined ? {} : { ca: [options.ca].flat() }),
		...(options.cert === undefined ? {} : { cert: options.cert }),
		...(options.key === undefined ? {} : { key: options.key }),
		...(options.passphrase === undefined
			? {}
			: { passphrase: options.passphrase }),
		...(options.alpn === undefined ? {} : { ALPNProtocols: [...options.alpn] }),
	};
}

/**
 * A socket error's message. Connecting to a name with several addresses,
 * such as `localhost`, fails with an `AggregateError` whose own message is
 * empty, so its errors' messages are used instead.
 */
export function socketErrorMessage(error: Error & { code?: string }): string {
	if (error.message !== '') return error.message;
	const messages =
		error instanceof AggregateError
			? error.errors
					.map((inner: unknown) =>
						inner instanceof Error ? inner.message : '',
					)
					.filter((message) => message !== '')
			: [];
	return messages.length > 0
		? messages.join('; ')
		: (error.code ?? 'the connection failed');
}

function connectionError(error: Error & { code?: string }): ConnectionError {
	return new ConnectionError(socketErrorMessage(error), {
		cause: error,
		...(error.code === undefined ? {} : { code: error.code }),
	});
}

class NodeSocket implements DriverSocket {
	#socket: Net.Socket;
	#onData: (chunk: Uint8Array) => void = () => {};
	#onClose: () => void = () => {};
	#onError: (error: Error) => void = () => {};
	#onDrain: () => void = () => {};

	constructor(socket: Net.Socket) {
		this.#socket = socket;
		this.#attach(socket);
	}

	#attach(socket: Net.Socket): void {
		socket.on('data', (chunk: Uint8Array) => this.#onData(chunk));
		socket.on('close', () => this.#onClose());
		socket.on('error', (error) => this.#onError(connectionError(error)));
		socket.on('drain', () => this.#onDrain());
	}

	get encrypted(): boolean {
		return 'encrypted' in this.#socket && this.#socket.encrypted === true;
	}

	write(data: Uint8Array): boolean {
		return this.#socket.write(data);
	}

	async startTls(options: TlsConnectOptions): Promise<void> {
		const tls = await loadTls();
		const raw = this.#socket;
		raw.removeAllListeners('data');
		raw.removeAllListeners('close');
		raw.removeAllListeners('error');
		raw.removeAllListeners('drain');
		let secure: Tls.TLSSocket;
		try {
			secure = tls.connect({
				...tlsOptions(tls, options),
				socket: raw,
			});
		} catch (error) {
			// e.g. an encrypted client key with the wrong passphrase
			raw.destroy();
			throw connectionError(
				error instanceof Error ? error : new Error(String(error)),
			);
		}
		await new Promise<void>((resolve, reject) => {
			const fail = (error: Error & { code?: string }) => {
				secure.destroy();
				reject(connectionError(error));
			};
			secure.once('secureConnect', () => {
				secure.off('error', fail);
				resolve();
			});
			secure.once('error', fail);
		});
		this.#socket = secure;
		this.#attach(secure);
	}

	peerCertificate(): Uint8Array | undefined {
		if (!this.encrypted) return undefined;
		const socket = this.#socket as Partial<Tls.TLSSocket>;
		// an X509Certificate is parsed lazily; getPeerCertificate() decodes every field
		const raw =
			socket.getPeerX509Certificate?.()?.raw ??
			socket.getPeerCertificate?.(false)?.raw;
		return raw === undefined ? undefined : new Uint8Array(raw);
	}

	pause(): void {
		this.#socket.pause();
	}

	resume(): void {
		this.#socket.resume();
	}

	end(): void {
		this.#socket.end();
	}

	destroy(): void {
		this.#socket.destroy();
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

/** Sockets from Node's `net` and `tls` modules. Also works on Bun and Deno's Node compatibility. */
export const nodeSockets: SocketFactory = {
	async connect(options: SocketConnectOptions): Promise<DriverSocket> {
		const { target } = options;
		const base =
			target.kind === 'unix'
				? { path: target.path }
				: { host: target.host, port: target.port };
		let open: () => Net.Socket;
		if (options.tls === undefined) {
			const net = await loadNet();
			open = () => net.connect(base);
		} else {
			const [tls, direct] = [await loadTls(), options.tls];
			open = () => tls.connect({ ...base, ...tlsOptions(tls, direct) });
		}
		const socket = await new Promise<Net.Socket>((resolve, reject) => {
			const event = options.tls ? 'secureConnect' : 'connect';
			let s: Net.Socket;
			try {
				s = open();
			} catch (error) {
				reject(
					connectionError(
						error instanceof Error ? error : new Error(String(error)),
					),
				);
				return;
			}
			const fail = (error: Error & { code?: string }) => {
				s.destroy();
				reject(connectionError(error));
			};
			s.once('error', fail);
			s.once(event, () => {
				s.off('error', fail);
				resolve(s);
			});
		});
		if (target.kind === 'tcp') {
			socket.setNoDelay(true);
			if (options.keepAlive) {
				socket.setKeepAlive(true, options.keepAliveInitialDelay);
			}
		}
		return new NodeSocket(socket);
	},
};
