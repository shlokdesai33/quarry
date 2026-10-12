import type * as NodeCrypto from 'node:crypto';
import { ConnectionError } from '../errors.js';
import {
	base64Decode,
	base64Encode,
	utf8Decode,
	utf8Encode,
} from './encoding.js';

/** Channel binding data for SCRAM-SHA-256-PLUS (`tls-server-end-point`). */
export interface ChannelBinding {
	readonly type: 'tls-server-end-point';
	readonly data: Uint8Array;
}

type Hash = 'SHA-256' | 'SHA-384' | 'SHA-512';

/** The primitives SCRAM and channel binding need. */
export interface ScramCrypto {
	hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
	digest(hash: Hash, data: Uint8Array): Promise<Uint8Array>;
	/** PBKDF2-HMAC-SHA-256, 32 bytes. */
	pbkdf2(
		password: Uint8Array,
		salt: Uint8Array,
		iterations: number,
	): Promise<Uint8Array>;
	random(length: number): Uint8Array;
}

/** A copy backed by a plain ArrayBuffer, as WebCrypto's types require. */
const fresh = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
	new Uint8Array(bytes);

const subtle = (): SubtleCrypto => {
	const value = globalThis.crypto?.subtle;
	if (!value) {
		throw new ConnectionError(
			'SCRAM authentication needs WebCrypto (crypto.subtle)',
		);
	}
	return value;
};

/** WebCrypto, for runtimes without `node:crypto` (Workers without `nodejs_compat`). */
export const webScramCrypto: ScramCrypto = {
	async hmac(key, data) {
		const k = await subtle().importKey(
			'raw',
			fresh(key),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign'],
		);
		return new Uint8Array(await subtle().sign('HMAC', k, fresh(data)));
	},
	async digest(hash, data) {
		return new Uint8Array(await subtle().digest(hash, fresh(data)));
	},
	async pbkdf2(password, salt, iterations) {
		const key = await subtle().importKey(
			'raw',
			fresh(password),
			'PBKDF2',
			false,
			['deriveBits'],
		);
		const bits = await subtle().deriveBits(
			{ name: 'PBKDF2', hash: 'SHA-256', salt: fresh(salt), iterations },
			key,
			256,
		);
		return new Uint8Array(bits);
	},
	random: (length) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
};

/**
 * `node:crypto`: HMACs and digests are synchronous and take microseconds,
 * where each WebCrypto call is a round trip through Node's thread pool;
 * PBKDF2 still runs off the main thread.
 */
export function nodeScramCrypto(crypto: typeof NodeCrypto): ScramCrypto {
	const name = (hash: Hash) => hash.replace('-', '').toLowerCase();
	return {
		hmac: async (key, data) =>
			crypto.createHmac('sha256', key).update(data).digest(),
		digest: async (hash, data) =>
			crypto.createHash(name(hash)).update(data).digest(),
		pbkdf2: (password, salt, iterations) =>
			new Promise((resolve, reject) => {
				crypto.pbkdf2(password, salt, iterations, 32, 'sha256', (error, key) =>
					error ? reject(error) : resolve(key),
				);
			}),
		random: (length) => crypto.randomFillSync(new Uint8Array(length)),
	};
}

let selected: ScramCrypto | undefined;

/** `node:crypto` where the runtime has it (Node, Bun, Deno, Workers with `nodejs_compat`), else WebCrypto. */
export function scramCrypto(): ScramCrypto {
	if (selected === undefined) {
		let crypto: typeof NodeCrypto | undefined;
		try {
			crypto =
				typeof process === 'object' &&
				typeof process.getBuiltinModule === 'function'
					? process.getBuiltinModule('node:crypto')
					: undefined;
		} catch {
			// no Node compatibility
		}
		selected =
			crypto !== undefined &&
			typeof crypto.createHmac === 'function' &&
			typeof crypto.pbkdf2 === 'function'
				? nodeScramCrypto(crypto)
				: webScramCrypto;
	}
	return selected;
}

interface Keys {
	readonly clientKey: Uint8Array;
	readonly storedKey: Uint8Array;
	readonly serverKey: Uint8Array;
}

/**
 * Derived keys by iteration count, salt and password. The salt and count
 * only change when the role's password does, so new connections (a pool
 * warming up, reconnects) skip PBKDF2. The keys grant no more than the
 * password the configuration already holds.
 */
const keyCache = new Map<string, Promise<Keys>>();
const KEY_CACHE_SIZE = 16;

async function deriveKeys(
	crypto: ScramCrypto,
	password: string,
	salt: string,
	iterations: number,
): Promise<Keys> {
	const salted = await crypto.pbkdf2(
		utf8Encode(saslprep(password)),
		base64Decode(salt),
		iterations,
	);
	const clientKey = await crypto.hmac(salted, utf8Encode('Client Key'));
	return {
		clientKey,
		storedKey: await crypto.digest('SHA-256', clientKey),
		serverKey: await crypto.hmac(salted, utf8Encode('Server Key')),
	};
}

function cachedKeys(
	crypto: ScramCrypto,
	password: string,
	salt: string,
	iterations: number,
): Promise<Keys> {
	const id = `${iterations}:${salt}:${password}`;
	let keys = keyCache.get(id);
	if (keys === undefined) {
		const derived = deriveKeys(crypto, password, salt, iterations);
		derived.catch(() => {
			if (keyCache.get(id) === derived) keyCache.delete(id);
		});
		keys = derived;
		if (keyCache.size >= KEY_CACHE_SIZE) {
			const oldest = keyCache.keys().next();
			if (!oldest.done) keyCache.delete(oldest.value);
		}
	} else {
		keyCache.delete(id);
	}
	keyCache.set(id, keys);
	return keys;
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
	return a.map((byte, i) => byte ^ (b[i] ?? 0));
}

/** Equal-time comparison, so the server signature check leaks nothing by timing. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}

// RFC 3454 tables used by SASLprep (RFC 4013), by code point.
const isNonAsciiSpace = (cp: number) =>
	cp === 0xa0 ||
	cp === 0x1680 ||
	(cp >= 0x2000 && cp <= 0x200b) ||
	cp === 0x202f ||
	cp === 0x205f ||
	cp === 0x3000;
const isMappedToNothing = (cp: number) =>
	cp === 0xad ||
	cp === 0x34f ||
	cp === 0x1806 ||
	(cp >= 0x180b && cp <= 0x180d) ||
	(cp >= 0x200b && cp <= 0x200d) ||
	cp === 0x2060 ||
	(cp >= 0xfe00 && cp <= 0xfe0f) ||
	cp === 0xfeff;
// controls, private use, surrogates, non-characters, bidi and tagging characters
const isProhibited = (cp: number) =>
	cp <= 0x1f ||
	(cp >= 0x7f && cp <= 0x9f) ||
	cp === 0x340 ||
	cp === 0x341 ||
	cp === 0x200e ||
	cp === 0x200f ||
	(cp >= 0x202a && cp <= 0x202e) ||
	(cp >= 0x206a && cp <= 0x206f) ||
	(cp >= 0xd800 && cp <= 0xf8ff) ||
	(cp >= 0xfff9 && cp <= 0xffff) ||
	cp >= 0xf0000 ||
	(cp & 0xfffe) === 0xfffe;

/**
 * SASLprep, as the server applies it to passwords. Like the server, a
 * password that SASLprep rejects is used as it is.
 */
export function saslprep(password: string): string {
	let mapped = '';
	for (const ch of password) {
		const cp = ch.codePointAt(0) ?? 0;
		if (isMappedToNothing(cp)) continue;
		mapped += isNonAsciiSpace(cp) ? ' ' : ch;
	}
	mapped = mapped.normalize('NFKC');
	for (const ch of mapped) {
		if (isProhibited(ch.codePointAt(0) ?? 0)) return password;
	}
	return mapped;
}

function attributes(message: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const part of message.split(',')) {
		const eq = part.indexOf('=');
		if (eq === 1) out.set(part[0] ?? '', part.slice(2));
	}
	return out;
}

/**
 * The client side of SCRAM-SHA-256 (RFC 5802 / 7677), with optional
 * `tls-server-end-point` channel binding (SCRAM-SHA-256-PLUS).
 */
export class ScramClient {
	readonly mechanism: 'SCRAM-SHA-256' | 'SCRAM-SHA-256-PLUS';
	readonly #password: string;
	readonly #binding: ChannelBinding | undefined;
	readonly #gs2Header: string;
	readonly #nonce: string;
	readonly #firstBare: string;
	#expectedServerSignature: Uint8Array | undefined;

	/**
	 * @param binding channel binding data when using -PLUS.
	 * @param clientSupportsBinding whether binding was possible on this
	 *   connection; reported as `y` when the server didn't offer -PLUS, so a
	 *   downgrade by an attacker is detected.
	 */
	constructor(
		password: string,
		binding: ChannelBinding | undefined,
		clientSupportsBinding: boolean,
		nonce?: string,
		username = '*',
	) {
		this.#password = password;
		this.#binding = binding;
		this.mechanism = binding ? 'SCRAM-SHA-256-PLUS' : 'SCRAM-SHA-256';
		this.#gs2Header = binding
			? `p=${binding.type},,`
			: clientSupportsBinding
				? 'y,,'
				: 'n,,';
		this.#nonce = nonce ?? base64Encode(scramCrypto().random(18));
		// the server ignores the SCRAM user name in favour of the startup user
		this.#firstBare = `n=${username},r=${this.#nonce}`;
	}

	/** The client-first-message. */
	first(): Uint8Array {
		return utf8Encode(this.#gs2Header + this.#firstBare);
	}

	/** The client-final-message, given the server-first-message. */
	async final(serverFirstBytes: Uint8Array): Promise<Uint8Array> {
		const serverFirst = utf8Decode(serverFirstBytes);
		const attrs = attributes(serverFirst);
		const nonce = attrs.get('r');
		const salt = attrs.get('s');
		const iterations = Number(attrs.get('i'));
		if (
			!nonce?.startsWith(this.#nonce) ||
			nonce.length === this.#nonce.length
		) {
			throw new ConnectionError(
				'SCRAM: the server nonce does not extend the client nonce',
			);
		}
		if (salt === undefined || salt === '')
			throw new ConnectionError('SCRAM: the server sent no salt');
		if (!Number.isInteger(iterations) || iterations < 1) {
			throw new ConnectionError('SCRAM: invalid iteration count');
		}
		const header = utf8Encode(this.#gs2Header);
		const cbind = this.#binding
			? new Uint8Array([...header, ...this.#binding.data])
			: header;
		const finalWithoutProof = `c=${base64Encode(cbind)},r=${nonce}`;
		const authMessage = `${this.#firstBare},${serverFirst},${finalWithoutProof}`;

		const crypto = scramCrypto();
		const { clientKey, storedKey, serverKey } = await cachedKeys(
			crypto,
			this.#password,
			salt,
			iterations,
		);
		const message = utf8Encode(authMessage);
		const proof = xor(clientKey, await crypto.hmac(storedKey, message));
		this.#expectedServerSignature = await crypto.hmac(serverKey, message);
		return utf8Encode(`${finalWithoutProof},p=${base64Encode(proof)}`);
	}

	/** Checks the server-final-message, proving the server knows the password too. */
	verify(serverFinalBytes: Uint8Array): void {
		const attrs = attributes(utf8Decode(serverFinalBytes));
		const error = attrs.get('e');
		if (error !== undefined)
			throw new ConnectionError(`SCRAM: the server reported ${error}`);
		const signature = attrs.get('v');
		if (
			signature === undefined ||
			this.#expectedServerSignature === undefined ||
			!equal(base64Decode(signature), this.#expectedServerSignature)
		) {
			throw new ConnectionError('SCRAM: the server signature does not match');
		}
	}
}

// AlgorithmIdentifier OIDs (DER content bytes, hex) of certificate
// signatures, mapped to the hash tls-server-end-point uses (RFC 5929 4.1:
// MD5 and SHA-1 are replaced by SHA-256).
const SIGNATURE_HASHES: Readonly<
	Record<string, 'SHA-256' | 'SHA-384' | 'SHA-512'>
> = {
	'2a864886f70d010104': 'SHA-256', // md5WithRSAEncryption
	'2a864886f70d010105': 'SHA-256', // sha1WithRSAEncryption
	'2a864886f70d01010b': 'SHA-256', // sha256WithRSAEncryption
	'2a864886f70d01010c': 'SHA-384', // sha384WithRSAEncryption
	'2a864886f70d01010d': 'SHA-512', // sha512WithRSAEncryption
	'2a8648ce3d040301': 'SHA-256', // ecdsa-with-SHA1
	'2a8648ce3d040302': 'SHA-256', // ecdsa-with-SHA256
	'2a8648ce3d040303': 'SHA-384', // ecdsa-with-SHA384
	'2a8648ce3d040304': 'SHA-512', // ecdsa-with-SHA512
	'2a864886f70d01010a': 'SHA-256', // RSASSA-PSS (hash in parameters; SHA-256 is by far the most common)
};

/** Reads a DER tag-length header at `at`: the content's start and length. */
function derHeader(
	der: Uint8Array,
	at: number,
): { start: number; length: number } {
	let pos = at + 1;
	const first = der[pos++] ?? 0;
	if (first < 0x80) return { start: pos, length: first };
	const count = first & 0x7f;
	if (count === 0 || count > 4)
		throw new ConnectionError('Invalid certificate encoding');
	let length = 0;
	for (let i = 0; i < count; i++) length = length * 256 + (der[pos++] ?? 0);
	return { start: pos, length };
}

/**
 * The `tls-server-end-point` channel binding for a DER certificate, or
 * undefined when its signature algorithm has no defined hash (e.g. Ed25519).
 */
export async function serverEndPoint(
	der: Uint8Array,
): Promise<ChannelBinding | undefined> {
	const cert = derHeader(der, 0);
	const tbs = derHeader(der, cert.start);
	const algorithm = derHeader(der, tbs.start + tbs.length);
	const oid = derHeader(der, algorithm.start);
	let key = '';
	for (const byte of der.subarray(oid.start, oid.start + oid.length))
		key += byte.toString(16).padStart(2, '0');
	const hash = SIGNATURE_HASHES[key];
	if (hash === undefined) return undefined;
	const data = await scramCrypto().digest(hash, der);
	return { type: 'tls-server-end-point', data };
}
