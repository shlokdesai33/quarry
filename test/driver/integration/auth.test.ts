import { describe, expect, it } from 'vitest';
import { OAuthError } from '../../../src/driver/auth/oauth.js';
import { connect } from '../../../src/driver/connect.js';
import { ConnectionError, PostgresError } from '../../../src/driver/errors.js';
import { createPool } from '../../../src/driver/pool.js';
import { cluster, noPg, open, options, pg, rejection } from './helpers.js';

const certUser = () => ({
	user: cluster().users.cert.user,
	password: undefined,
});
const oauthUser = () => ({
	user: cluster().users.oauth.user,
	password: undefined,
	ssl: 'require' as const,
});

describe.skipIf(noPg)('require_auth', () => {
	it('accepts an allowed method', async () => {
		await using conn = await open({ requireAuth: 'scram-sha-256' });
		expect(conn.processId).toBeGreaterThan(0);
		await using trust = await open({
			user: cluster().users.trust.user,
			password: undefined,
			requireAuth: ['none'],
		});
		expect(trust.processId).toBeGreaterThan(0);
	});

	it('refuses a downgrade to md5, cleartext or no authentication', async () => {
		const { md5, password, trust } = cluster().users;
		const toMd5 = await rejection(
			open({ ...md5, requireAuth: 'scram-sha-256' }),
			ConnectionError,
		);
		expect(toMd5.code).toBe('EAUTHMETHOD');
		expect(toMd5.message).toMatch(
			/requested an MD5 password authentication \(md5\), but require_auth allows only scram-sha-256/,
		);
		const toCleartext = await rejection(
			open({ ...password, requireAuth: '!password,!md5' }),
			ConnectionError,
		);
		expect(toCleartext.message).toMatch(/cleartext password/);
		const toNone = await rejection(
			open({ ...trust, password: undefined, requireAuth: '!none' }),
			ConnectionError,
		);
		expect(toNone.message).toMatch(/requested no authentication/);
	});

	it('reads require_auth from the connection string and environment', async () => {
		const c = cluster();
		const url = `postgres://${c.users.md5.user}:${c.users.md5.password}@${c.host}:${c.port}/${c.database}?sslmode=disable&require_auth=scram-sha-256`;
		await expect(connect({ connectionString: url, env: {} })).rejects.toThrow(
			/require_auth/,
		);
		await expect(
			connect({ ...options(), ...c.users.md5, env: { PGREQUIREAUTH: '!md5' } }),
		).rejects.toThrow(/require_auth/);
	});
});

describe.skipIf(noPg)('password providers', () => {
	it('calls the provider for every new connection and never reuses an old value', async () => {
		const c = cluster();
		await using admin = await open();
		await admin.query(`create role rotating login password 'v1'`);
		try {
			let current = 'v1';
			const calls: string[] = [];
			await using pool = createPool({
				...options(),
				user: 'rotating',
				max: 2,
				idleTimeout: 0,
				password: async () => {
					calls.push(current);
					return current;
				},
			});
			const [a, b] = await Promise.all([pool.acquire(), pool.acquire()]);
			expect(calls).toEqual(['v1', 'v1']);
			// rotate: existing sessions keep working, new ones need the new value
			current = 'v2';
			await admin.query(`alter role rotating password 'v2'`);
			expect((await a.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
			a.release(true);
			const c2 = await pool.acquire();
			expect(calls).toEqual(['v1', 'v1', 'v2']);
			expect((await c2.query('select current_user as u')).rows).toEqual([
				{ u: 'rotating' },
			]);
			c2.release();
			b.release();
			// a provider returning a stale value fails cleanly, and its value is not in the error
			current = 'stale-secret';
			b.release(true);
			const error = await rejection(
				connect({
					...options(),
					host: c.host,
					user: 'rotating',
					password: () => current,
				}),
				PostgresError,
			);
			expect(error.code).toBe('28P01');
			expect(
				JSON.stringify(error) + error.message + (error.stack ?? ''),
			).not.toContain('stale-secret');
		} finally {
			await admin.query('drop role if exists rotating');
		}
	});
});

describe.skipIf(noPg)('TLS client certificates', () => {
	it('authenticates with a certificate and key from files', async () => {
		const { client } = cluster();
		await using conn = await open({
			...certUser(),
			ssl: {
				mode: 'require',
				certFile: client.certFile,
				keyFile: client.keyFile,
			},
		});
		const { rows } = await conn.query<{ u: string; ssl: boolean }>(
			'select current_user as u, ssl from pg_stat_ssl where pid = pg_backend_pid()',
		);
		expect(rows[0]).toEqual({ u: 'cert_user', ssl: true });
	});

	it('authenticates with PEM strings and with an encrypted key and its passphrase', async () => {
		const { client, ca } = cluster();
		await using pem = await open({
			...certUser(),
			host: 'localhost',
			ssl: { mode: 'verify-full', ca, cert: client.cert, key: client.key },
		});
		expect(pem.processId).toBeGreaterThan(0);
		await using encrypted = await open({
			...certUser(),
			ssl: {
				mode: 'require',
				certFile: client.certFile,
				keyFile: client.encryptedKeyFile,
				passphrase: client.keyPassphrase,
			},
		});
		expect(encrypted.processId).toBeGreaterThan(0);
	});

	it('reads sslcert, sslkey and sslpassword from the environment and connection string', async () => {
		const c = cluster();
		await using fromEnv = await connect({
			...options(),
			...certUser(),
			ssl: undefined,
			env: {
				PGSSLMODE: 'require',
				PGSSLCERT: c.client.certFile,
				PGSSLKEY: c.client.keyFile,
			},
		});
		expect(fromEnv.processId).toBeGreaterThan(0);
		const url =
			`postgres://cert_user@${c.host}:${c.port}/${c.database}?sslmode=require` +
			`&sslcert=${encodeURIComponent(c.client.certFile)}&sslkey=${encodeURIComponent(c.client.encryptedKeyFile)}` +
			`&sslpassword=${encodeURIComponent(c.client.keyPassphrase)}`;
		await using fromUrl = await connect({ connectionString: url, env: {} });
		expect(fromUrl.processId).toBeGreaterThan(0);
	});

	it('fails without a certificate, or with a wrong passphrase', async () => {
		const { client } = cluster();
		const missing = await rejection(
			open({ ...certUser(), ssl: 'require' }),
			PostgresError,
		);
		expect(missing.code).toBe('28000');
		const wrong = await rejection(
			open({
				...certUser(),
				ssl: {
					mode: 'require',
					certFile: client.certFile,
					keyFile: client.encryptedKeyFile,
					passphrase: 'nope',
				},
			}),
			ConnectionError,
		);
		expect(wrong.message).not.toContain('nope');
		await expect(
			open({
				...certUser(),
				ssl: { mode: 'require', certFile: client.certFile },
			}),
		).rejects.toThrow(/both sslcert and sslkey/);
	});
});

describe.skipIf(!pg?.oauth)(
	'OAuth (OAUTHBEARER) against a test validator',
	() => {
		it('authenticates with a token from the hook, called once per connection', async () => {
			const contexts: unknown[] = [];
			const oauthToken = (context: unknown) => {
				contexts.push(context);
				return 'good.oauth_user';
			};
			await using conn = await open({
				...oauthUser(),
				oauthToken,
				requireAuth: 'oauth',
			});
			expect(
				(await conn.query('select current_user as u, system_user as s')).rows,
			).toEqual([{ u: 'oauth_user', s: 'oauth:oauth_user' }]);
			expect(conn.capabilities.saslMechanisms).toEqual(['OAUTHBEARER']);
			await using second = await open({ ...oauthUser(), oauthToken });
			expect(second.processId).toBeGreaterThan(0);
			expect(contexts).toEqual([
				{
					host: cluster().host,
					port: cluster().port,
					user: 'oauth_user',
					database: cluster().database,
				},
				{
					host: cluster().host,
					port: cluster().port,
					user: 'oauth_user',
					database: cluster().database,
				},
			]);
		});

		it('surfaces the server’s error and discovery information for a rejected token', async () => {
			const error = await rejection(
				open({ ...oauthUser(), oauthToken: () => 'bad.token' }),
				OAuthError,
			);
			expect(error.status).toBe('invalid_token');
			expect(error.openidConfiguration).toBe(
				'https://issuer.example.com/.well-known/openid-configuration',
			);
			expect(error.scope).toBe('openid postgres');
			expect(error.message).toMatch(
				/OAuth authentication failed .*issuer discovery https:\/\/issuer\.example\.com/,
			);
			expect(error.cause).toBeInstanceOf(PostgresError);
			expect(error.message).not.toContain('bad.token');
		});

		it('explains what the server needs when no token hook is given', async () => {
			const error = await rejection(open(oauthUser()), OAuthError);
			expect(error.message).toMatch(
				/requires an OAuth bearer token .*scope "openid postgres".*no oauthToken/,
			);
		});

		it('rejects tokens with characters a bearer token cannot contain', async () => {
			await expect(
				open({ ...oauthUser(), oauthToken: () => 'has\u0001separator' }),
			).rejects.toThrow(/characters a bearer token cannot have/);
		});

		it('refuses OAuth under require_auth or channel_binding=require', async () => {
			await expect(
				open({
					...oauthUser(),
					oauthToken: () => 'good.oauth_user',
					requireAuth: 'scram-sha-256',
				}),
			).rejects.toThrow(/require_auth/);
			await expect(
				open({
					...oauthUser(),
					oauthToken: () => 'good.oauth_user',
					channelBinding: 'require',
				}),
			).rejects.toThrow(/channel_binding/);
		});
	},
);

describe.skipIf(noPg)('capabilities', () => {
	it('reports what the connection supports', async () => {
		await using conn = await open();
		expect(conn.capabilities).toMatchObject({
			protocol: '3.2',
			longCancelKeys: true,
			reportsHotStandby: true,
		});
		expect(conn.capabilities.saslMechanisms).toContain('SCRAM-SHA-256');
		expect(conn.capabilities.serverVersion).toBe(
			conn.parameters.get('server_version'),
		);
	});
});
