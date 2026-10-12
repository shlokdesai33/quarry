import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	base64Decode,
	base64Encode,
	utf8Decode,
	utf8Encode,
} from '../../src/driver/auth/encoding.js';
import { md5, md5Password } from '../../src/driver/auth/md5.js';
import { ScramClient, saslprep } from '../../src/driver/auth/scram.js';
import { parseServerVersion } from '../../src/driver/capabilities.js';
import {
	parseRequireAuth,
	findPgpassPassword,
	parseConnectionString,
	resolveConfig,
} from '../../src/driver/config.js';
import { prng } from './helpers/backend.js';

describe('parseConnectionString', () => {
	it('parses URLs', () => {
		expect(
			parseConnectionString(
				'postgres://us%40er:p%3Aw@db.example.com:6543/my%20db?sslmode=verify-full&application_name=a+b',
			),
		).toEqual({
			user: 'us@er',
			password: 'p:w',
			host: 'db.example.com',
			port: '6543',
			dbname: 'my db',
			sslmode: 'verify-full',
			application_name: 'a b',
		});
		expect(parseConnectionString('postgresql://')).toEqual({});
		expect(parseConnectionString('postgres://a,b:5433,[::1]:5434/db')).toEqual({
			host: 'a,b,::1',
			port: ',5433,5434',
			dbname: 'db',
		});
		expect(
			parseConnectionString('postgres://%2Fvar%2Frun%2Fpostgresql/db'),
		).toEqual({ host: '/var/run/postgresql', dbname: 'db' });
		expect(parseConnectionString('postgres:///db?host=/tmp')).toEqual({
			dbname: 'db',
			host: '/tmp',
		});
		expect(parseConnectionString('postgres://h/db?ssl=true')).toEqual({
			host: 'h',
			dbname: 'db',
			sslmode: 'require',
		});
	});

	it('parses key=value strings', () => {
		expect(
			parseConnectionString(
				`host=localhost port = 5433 dbname='my db' password='it\\'s' user=x\\ y`,
			),
		).toEqual({
			host: 'localhost',
			port: '5433',
			dbname: 'my db',
			password: "it's",
			user: 'x y',
		});
		expect(() => parseConnectionString('host')).toThrow(/Missing "="/);
		expect(() => parseConnectionString("host='x")).toThrow(/Unterminated/);
	});
});

describe('resolveConfig', () => {
	it('applies explicit options over the connection string over the environment', () => {
		const config = resolveConfig({
			connectionString: 'postgres://url-user@url-host/url-db',
			database: 'explicit-db',
			env: {
				PGHOST: 'env-host',
				PGUSER: 'env-user',
				PGPORT: '7777',
				PGAPPNAME: 'env-app',
			},
		});
		expect(config.hosts).toEqual([{ host: 'url-host', port: 7777 }]);
		expect(config.user).toBe('url-user');
		expect(config.database).toBe('explicit-db');
		expect(config.applicationName).toBe('env-app');
	});

	it('defaults the database to the user and the host to localhost', () => {
		const config = resolveConfig({ env: { USER: 'me' } });
		expect(config.hosts).toEqual([{ host: 'localhost', port: 5432 }]);
		expect(config.user).toBe('me');
		expect(config.database).toBe('me');
	});

	it('defaults sslmode to verify-full for remote hosts and prefer for local ones', () => {
		expect(resolveConfig({ host: 'db.example.com', env: {} }).ssl.mode).toBe(
			'verify-full',
		);
		expect(resolveConfig({ host: '10.0.0.5', env: {} }).ssl.mode).toBe(
			'verify-full',
		);
		expect(resolveConfig({ host: 'localhost', env: {} }).ssl.mode).toBe(
			'prefer',
		);
		expect(resolveConfig({ host: '127.0.0.1', env: {} }).ssl.mode).toBe(
			'prefer',
		);
		expect(
			resolveConfig({ host: '/var/run/postgresql', env: {} }).ssl.mode,
		).toBe('prefer');
		expect(
			resolveConfig({ host: 'localhost,db.example.com', env: {} }).ssl.mode,
		).toBe('verify-full');
		expect(
			resolveConfig({ host: 'db.example.com', env: { PGSSLMODE: 'disable' } })
				.ssl.mode,
		).toBe('disable');
	});

	it('handles sslrootcert=system, direct negotiation and protocol versions', () => {
		expect(
			resolveConfig({ host: 'localhost', env: { PGSSLROOTCERT: 'system' } }).ssl
				.mode,
		).toBe('verify-full');
		expect(() =>
			resolveConfig({ env: { PGSSLROOTCERT: 'system', PGSSLMODE: 'require' } }),
		).toThrow(/verify-full/);
		expect(() =>
			resolveConfig({
				ssl: { mode: 'prefer', negotiation: 'direct' },
				env: {},
			}),
		).toThrow(/direct/);
		expect(
			resolveConfig({ env: { PGMAXPROTOCOLVERSION: '3.0' } }).protocol,
		).toEqual({ min: 0, max: 0 });
		expect(
			resolveConfig({
				connectionString: 'postgres://h/d?min_protocol_version=3.2',
				env: {},
			}).protocol,
		).toEqual({ min: 2, max: 2 });
	});

	it('pairs hosts with ports and validates them', () => {
		expect(resolveConfig({ host: 'a,b', port: '1,2', env: {} }).hosts).toEqual([
			{ host: 'a', port: 1 },
			{ host: 'b', port: 2 },
		]);
		expect(
			resolveConfig({ host: 'a,b', port: 9, env: {} }).hosts.map((h) => h.port),
		).toEqual([9, 9]);
		expect(() =>
			resolveConfig({ host: 'a,b', port: '1,2,3', env: {} }),
		).toThrow(/3 ports given for 2 hosts/);
		expect(() => resolveConfig({ env: { PGSSLMODE: 'sometimes' } })).toThrow(
			/Invalid sslmode/,
		);
	});

	it('passes unknown keywords as startup parameters', () => {
		const config = resolveConfig({
			connectionString:
				'postgres://h/d?search_path=app&options=-c%20geqo%3Doff',
			env: {},
		});
		expect(config.params).toEqual({
			search_path: 'app',
			options: '-c geqo=off',
		});
	});

	it('reads connect_timeout in seconds, with libpq’s 2-second minimum', () => {
		expect(
			resolveConfig({ env: { PGCONNECT_TIMEOUT: '10' } }).connectTimeout,
		).toBe(10_000);
		expect(
			resolveConfig({ env: { PGCONNECT_TIMEOUT: '1' } }).connectTimeout,
		).toBe(2000);
		expect(
			resolveConfig({ env: { PGCONNECT_TIMEOUT: '0' } }).connectTimeout,
		).toBe(0);
		expect(resolveConfig({ env: {} }).connectTimeout).toBe(30_000);
	});
});

describe('.pgpass', () => {
	const file = [
		'# comment',
		'db:5432:app:alice:secret',
		'localhost:*:*:bob:pa\\:ss\\\\w',
		'*:*:*:*:fallback',
	].join('\n');
	it('matches fields with wildcards and escapes', () => {
		expect(
			findPgpassPassword(file, {
				host: 'db',
				port: 5432,
				database: 'app',
				user: 'alice',
			}),
		).toBe('secret');
		expect(
			findPgpassPassword(file, {
				host: '/tmp',
				port: 1,
				database: 'x',
				user: 'bob',
			}),
		).toBe('pa:ss\\w');
		expect(
			findPgpassPassword(file, {
				host: 'other',
				port: 1,
				database: 'x',
				user: 'carol',
			}),
		).toBe('fallback');
		expect(
			findPgpassPassword('db:5432:app:alice:secret', {
				host: 'db',
				port: 5433,
				database: 'app',
				user: 'alice',
			}),
		).toBeUndefined();
	});
});

describe('auth primitives', () => {
	it('MD5 matches node:crypto', () => {
		const rand = prng(7);
		for (let n = 0; n < 200; n++) {
			const input = new Uint8Array(n * 3).map(() => rand() * 256);
			expect(Buffer.from(md5(input)).toString('hex')).toBe(
				createHash('md5').update(input).digest('hex'),
			);
		}
	});

	it('builds the md5 password response', () => {
		const salt = new Uint8Array([1, 2, 3, 4]);
		const inner = createHash('md5').update('pwuser').digest('hex');
		const expected =
			'md5' +
			createHash('md5')
				.update(Buffer.concat([Buffer.from(inner), salt]))
				.digest('hex');
		expect(md5Password('user', 'pw', salt)).toBe(expected);
	});

	it('base64 round-trips and matches Buffer', () => {
		const rand = prng(3);
		for (let n = 0; n < 100; n++) {
			const bytes = new Uint8Array(n).map(() => rand() * 256);
			const text = base64Encode(bytes);
			expect(text).toBe(Buffer.from(bytes).toString('base64'));
			expect([...base64Decode(text)]).toEqual([...bytes]);
		}
		expect(() => base64Decode('a$==')).toThrow();
		expect(utf8Decode(utf8Encode('é😀'))).toBe('é😀');
	});

	it('SASLprep maps spaces, drops ignorable characters and normalizes', () => {
		expect(saslprep('I\u00ADX')).toBe('IX');
		expect(saslprep('a\u00A0b')).toBe('a b');
		expect(saslprep('\u00AA')).toBe('a');
		expect(saslprep('½')).toBe('1⁄2');
		// prohibited output: used as is, like the server does
		expect(saslprep('a\u0007b')).toBe('a\u0007b');
	});

	it('SCRAM-SHA-256 matches the RFC 7677 test vector', async () => {
		const client = new ScramClient(
			'pencil',
			undefined,
			false,
			'rOprNGfwEbeRWgbNEkqO',
			'user',
		);
		expect(utf8Decode(client.first())).toBe('n,,n=user,r=rOprNGfwEbeRWgbNEkqO');
		const final = await client.final(
			utf8Encode(
				'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
			),
		);
		expect(utf8Decode(final)).toBe(
			'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=',
		);
		expect(() =>
			client.verify(
				utf8Encode('v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4='),
			),
		).not.toThrow();
		expect(() =>
			client.verify(
				utf8Encode('v=AAAATRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4='),
			),
		).toThrow(/signature/);
		expect(() => client.verify(utf8Encode('e=invalid-proof'))).toThrow(
			/invalid-proof/,
		);
	});

	it('SCRAM rejects a server nonce that does not extend the client’s', async () => {
		const client = new ScramClient('pw', undefined, false, 'abc');
		await expect(
			client.final(utf8Encode('r=xyz123,s=AAAA,i=4096')),
		).rejects.toThrow(/nonce/);
		await expect(
			client.final(utf8Encode('r=abc123,s=AAAA,i=0')),
		).rejects.toThrow(/iteration/);
	});
});

describe('versions and policies', () => {
	it('parses server_version like server_version_num', () => {
		expect(parseServerVersion('18.6 (Ubuntu 18.6-1.pgdg24.04+2)')).toBe(180006);
		expect(parseServerVersion('16.4')).toBe(160004);
		expect(parseServerVersion('19devel')).toBe(190000);
		expect(parseServerVersion('19beta1')).toBe(190000);
		expect(parseServerVersion('9.6.24')).toBe(90624);
		expect(parseServerVersion('pgbouncer')).toBeUndefined();
		expect(parseServerVersion(undefined)).toBeUndefined();
	});

	it('resolves the protocol version range', () => {
		expect(resolveConfig({ env: {} }).protocol).toEqual({ min: 0, max: 2 });
		expect(resolveConfig({ protocol: '3.0', env: {} }).protocol).toEqual({
			min: 0,
			max: 0,
		});
		expect(
			resolveConfig({ minProtocolVersion: 'latest', env: {} }).protocol,
		).toEqual({ min: 2, max: 2 });
		expect(
			resolveConfig({ env: { PGMAXPROTOCOLVERSION: '3.0' } }).protocol,
		).toEqual({ min: 0, max: 0 });
		expect(() => resolveConfig({ protocol: '3.1', env: {} })).toThrow(
			/3.1 was never used/,
		);
		expect(() => resolveConfig({ protocol: '3.9', env: {} })).toThrow(
			/Unsupported/,
		);
		expect(() =>
			resolveConfig({
				minProtocolVersion: '3.2',
				maxProtocolVersion: '3.0',
				env: {},
			}),
		).toThrow(/above/);
	});

	it('parses require_auth lists and negations', () => {
		expect(parseRequireAuth(undefined)).toBeUndefined();
		expect([...(parseRequireAuth('scram-sha-256,none') ?? [])]).toEqual([
			'scram-sha-256',
			'none',
		]);
		expect([
			...(parseRequireAuth(['!password', '!md5', '!none']) ?? []),
		]).toEqual(['scram-sha-256', 'gss', 'sspi']);
		expect(() => parseRequireAuth('md5,!password')).toThrow(/cannot mix/);
		expect(() => parseRequireAuth('kerberos')).toThrow(
			/Invalid require_auth method/,
		);
	});

	it('rejects require_auth=oauth as unsupported, and accepts !oauth', () => {
		expect(() => parseRequireAuth('scram-sha-256,oauth')).toThrow(
			/require_auth method "oauth" is not supported/,
		);
		expect(() =>
			resolveConfig({
				connectionString: 'postgres://h/d?require_auth=oauth',
				env: {},
			}),
		).toThrow(/not supported/);
		expect(() => resolveConfig({ env: { PGREQUIREAUTH: 'oauth' } })).toThrow(
			/not supported/,
		);
		expect([...(parseRequireAuth('!oauth,!md5') ?? [])]).toEqual([
			'password',
			'scram-sha-256',
			'gss',
			'sspi',
			'none',
		]);
	});

	it('reads client certificate settings', () => {
		const config = resolveConfig({
			connectionString:
				'postgres://h/d?sslcert=/c.crt&sslkey=/c.key&sslpassword=pw',
			env: {},
		});
		expect(config.ssl).toMatchObject({
			certFile: '/c.crt',
			keyFile: '/c.key',
			passphrase: 'pw',
		});
		expect(
			resolveConfig({ env: { PGSSLCERT: '/e.crt', PGSSLKEY: '/e.key' } }).ssl,
		).toMatchObject({ certFile: '/e.crt', keyFile: '/e.key' });
	});
});

const configError = (text: string) => {
	try {
		resolveConfig({ connectionString: text, env: {} });
	} catch (error) {
		return error instanceof Error
			? `${error.message} ${error.stack ?? ''}`
			: String(error);
	}
	return '';
};

describe('no secrets in errors', () => {
	it('never echoes connection-string values that may hold the password', () => {
		expect(configError('postgres://user:sec%ZZret@host/db')).not.toContain(
			'sec',
		);
		expect(
			configError('postgres://user:secret@host/db?sslmode=sometimes'),
		).not.toContain('secret');
		expect(configError("host=h password='secret")).not.toContain('secret');
	});
});
