/** TLS settings for one connection, already resolved from `sslmode`. */
export interface TlsConnectOptions {
	/** SNI and hostname to verify; omitted for IP addresses. */
	readonly servername: string | undefined;
	/** Trusted CA certificates (PEM); undefined uses the platform's store. */
	readonly ca: string | readonly string[] | undefined;
	/** Client certificate and key (PEM), for `cert` authentication. */
	readonly cert: string | undefined;
	readonly key: string | undefined;
	/** The passphrase of an encrypted `key`. */
	readonly passphrase: string | undefined;
	/** Verify the certificate chain. */
	readonly verifyChain: boolean;
	/** Verify the certificate matches the host name (needs `verifyChain`). */
	readonly verifyHostname: boolean;
	/** The host name to check the certificate against. */
	readonly host: string;
	/** ALPN protocols to offer; `['postgresql']` for direct TLS. */
	readonly alpn: readonly string[] | undefined;
}

/** Where to connect: TCP host and port, or a Unix-domain socket path. */
export type SocketTarget =
	| { readonly kind: 'tcp'; readonly host: string; readonly port: number }
	| { readonly kind: 'unix'; readonly path: string };

export interface SocketConnectOptions {
	readonly target: SocketTarget;
	/** Start TLS right away (direct TLS, `sslnegotiation=direct`). */
	readonly tls: TlsConnectOptions | undefined;
	readonly keepAlive: boolean;
	readonly keepAliveInitialDelay: number;
}

/**
 * A connected byte stream. The driver core only talks to this interface,
 * so runtimes other than Node (Bun, Deno, Workers) can supply their own.
 */
export interface DriverSocket {
	/** Whether TLS is active. */
	readonly encrypted: boolean;
	/**
	 * Queues bytes for sending. Returns false when the runtime's buffer is
	 * full; `onDrain` fires when it empties.
	 */
	write(data: Uint8Array): boolean;
	/** Upgrades the connection to TLS in place, after the server accepted an SSLRequest. */
	startTls(options: TlsConnectOptions): Promise<void>;
	/** The server certificate (DER), once TLS is active. */
	peerCertificate(): Uint8Array | undefined;
	/** Stops and resumes delivering data, for backpressure. */
	pause(): void;
	resume(): void;
	/**
	 * Half-closes after flushing queued bytes. A returned promise resolves
	 * once they are flushed; without one, closing waits for the socket to close.
	 */
	end(): void | Promise<void>;
	/** Closes immediately. */
	destroy(): void;
	/** Registers the single data, close, error and drain handlers. */
	onData(handler: (chunk: Uint8Array) => void): void;
	onClose(handler: () => void): void;
	onError(handler: (error: Error) => void): void;
	onDrain(handler: () => void): void;
}

/** Opens sockets. The default is Node's `net`/`tls`, loaded on first use. */
export interface SocketFactory {
	connect(options: SocketConnectOptions): Promise<DriverSocket>;
}
