import { ConnectionError } from '../errors.js';
import { utf8Decode, utf8Encode } from './encoding.js';

/** The SASL mechanism for OAuth bearer tokens (RFC 7628), offered by PostgreSQL 18+. */
export const OAUTHBEARER = 'OAUTHBEARER';

/** RFC 6750 `b64token`: the only characters a bearer token may contain. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;

/**
 * The client's initial response (RFC 7628 3.1): `n,,` then
 * `^Aauth=Bearer <token>^A^A`. Without a token it sends an empty `auth=`, asking the server for its
 * discovery information instead.
 */
export function oauthInitialResponse(token: string | undefined): Uint8Array {
	if (token === undefined) return utf8Encode('n,,\x01auth=\x01\x01');
	if (!B64TOKEN.test(token)) {
		throw new ConnectionError(
			'The OAuth token contains characters a bearer token cannot have',
		);
	}
	return utf8Encode(`n,,\x01auth=Bearer ${token}\x01\x01`);
}

/** The client's reply to a server error: a lone separator, after which the server fails the exchange. */
export const OAUTH_ERROR_ACK = new Uint8Array([0x01]);

/** The server's error response (RFC 7628 3.2.2), with PostgreSQL's discovery fields. */
export interface OAuthFailure {
	/** `invalid_token`, `insufficient_scope`, … */
	readonly status: string | undefined;
	/** The scope the server asks tokens to have. */
	readonly scope: string | undefined;
	/** The issuer's OpenID discovery document URL. */
	readonly openidConfiguration: string | undefined;
	/** The response as sent. */
	readonly raw: string;
}

export function parseOAuthFailure(data: Uint8Array): OAuthFailure {
	const raw = utf8Decode(data);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		parsed = undefined;
	}
	const field = (name: string): string | undefined => {
		if (typeof parsed !== 'object' || parsed === null) return undefined;
		const value: unknown = Reflect.get(parsed, name);
		return typeof value === 'string' ? value : undefined;
	};
	return {
		status: field('status'),
		scope: field('scope'),
		openidConfiguration: field('openid-configuration'),
		raw,
	};
}

/**
 * OAuth authentication failed, or the server needs a token and none was
 * given. Carries the server's discovery information so the caller can get a
 * token from the right issuer with the right scope.
 */
export class OAuthError extends ConnectionError {
	readonly status: string | undefined;
	readonly scope: string | undefined;
	/** The issuer's OpenID discovery document URL, as the server advertised it. */
	readonly openidConfiguration: string | undefined;

	constructor(
		message: string,
		failure: OAuthFailure | undefined,
		cause?: unknown,
	) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = 'OAuthError';
		this.status = failure?.status;
		this.scope = failure?.scope;
		this.openidConfiguration = failure?.openidConfiguration;
	}
}

export function describeFailure(failure: OAuthFailure | undefined): string {
	if (failure === undefined) return '';
	const parts = [
		failure.status && `status ${failure.status}`,
		failure.openidConfiguration &&
			`issuer discovery ${failure.openidConfiguration}`,
		failure.scope && `scope "${failure.scope}"`,
	].filter(Boolean);
	return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}
