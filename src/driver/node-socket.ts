import type * as Net from 'node:net';
import type * as Tls from 'node:tls';
import { ConnectionError } from './errors.js';
import type {
	DriverSocket,
	SocketConnectOptions,
	SocketFactory,
	TlsConnectOptions,
} from './socket.js';

interface NodeModules {
	readonly net: typeof Net;
	readonly tls: typeof Tls;
}

let modules: Promise<NodeModules> | undefined;

/** Loads `node:net` and `node:tls` on first use, so the core stays importable elsewhere. */
function load(): Promise<NodeModules> {
	modules ??= Promise.all([import('node:net'), import('node:tls')]).then(
		([net, tls]) => ({ net, tls }),
	);
	return modules;
}

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

function connectionError(error: Error & { code?: string }): ConnectionError {
	return new ConnectionError(error.message, {
		cause: error,
		...(error.code === undefined ? {} : { code: error.code }),
	});
}

class NodeSocket implements DriverSocket {
	#socket: Net.Socket;
	readonly #tls: typeof Tls;
	#onData: (chunk: Uint8Array) => void = () => {};
	#onClose: () => void = () => {};
	#onError: (error: Error) => void = () => {};
	#onDrain: () => void = () => {};

	constructor(socket: Net.Socket, tls: typeof Tls) {
		this.#socket = socket;
		this.#tls = tls;
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
		const raw = this.#socket;
		raw.removeAllListeners('data');
		raw.removeAllListeners('close');
		raw.removeAllListeners('error');
		raw.removeAllListeners('drain');
		let secure: Tls.TLSSocket;
		try {
			secure = this.#tls.connect({
				...tlsOptions(this.#tls, options),
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
		const socket = this.#socket;
		if (!(socket instanceof this.#tls.TLSSocket)) return undefined;
		const raw = socket.getPeerCertificate(false)?.raw;
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
		const { net, tls } = await load();
		const { target } = options;
		const socket = await new Promise<Net.Socket>((resolve, reject) => {
			const event = options.tls ? 'secureConnect' : 'connect';
			const base =
				target.kind === 'unix'
					? { path: target.path }
					: { host: target.host, port: target.port };
			let s: Net.Socket;
			try {
				s = options.tls
					? tls.connect({ ...base, ...tlsOptions(tls, options.tls) })
					: net.connect(base);
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
		return new NodeSocket(socket, tls);
	},
};
