import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connect } from '../../../src/driver/connect.js';
import { ConnectionError, PostgresError } from '../../../src/driver/errors.js';
import { cluster, noPg, open, recordingSockets, rejection } from './helpers.js';

const ssl = () => cluster().users.sslOnly;

async function sslInUse(conn: Awaited<ReturnType<typeof open>>) {
	const { rows } = await conn.query<{ ssl: boolean }>(
		'select ssl from pg_stat_ssl where pid = pg_backend_pid()',
	);
	return rows[0]?.ssl;
}

describe.skipIf(noPg)('authentication', () => {
	it('trust', async () => {
		await using conn = await open({
			user: cluster().users.trust.user,
			password: undefined,
		});
		const { rows } = await conn.query('select current_user as u, 1 + 1 as two');
		expect(rows).toEqual([{ u: 'trust_user', two: 2 }]);
	});

	it('cleartext password', async () => {
		const { user, password } = cluster().users.password;
		await using conn = await open({ user, password });
		expect((await conn.query('select current_user as u')).rows[0]).toEqual({
			u: user,
		});
	});

	it('md5 password', async () => {
		const { user, password } = cluster().users.md5;
		await using conn = await open({ user, password });
		expect((await conn.query('select current_user as u')).rows[0]).toEqual({
			u: user,
		});
	});

	it('SCRAM-SHA-256 with a non-ASCII password (SASLprep)', async () => {
		const rec = recordingSockets();
		await using conn = await open({ socket: rec.factory });
		expect((await conn.query('select current_user as u')).rows[0]).toEqual({
			u: 'scram_user',
		});
		expect(rec.sent()).toContain('SCRAM-SHA-256\0');
		expect(rec.sent()).toContain('n,,n=*,r=');
	});

	it('a password from a function', async () => {
		await using conn = await open({
			password: async () => cluster().users.scram.password,
		});
		expect((await conn.query('select 1 as one')).rows).toEqual([{ one: 1 }]);
	});

	it('a password from a .pgpass file', async () => {
		const c = cluster();
		const dir = mkdtempSync(join(tmpdir(), 'pgpass-'));
		const file = join(dir, 'pgpass');
		writeFileSync(
			file,
			`# comment\nother:1:*:*:nope\n${c.host}:${c.port}:*:${c.users.password.user}:${c.users.password.password}\n`,
		);
		await using conn = await open({
			user: c.users.password.user,
			password: undefined,
			passfile: file,
		});
		expect((await conn.query('select 1 as one')).rows).toEqual([{ one: 1 }]);
	});

	it('rejects a wrong password with a typed error and no secret in the message', async () => {
		const error = await rejection(
			open({ password: 'wrong-secret' }),
			PostgresError,
		);
		expect(error.code).toBe('28P01');
		expect(error.message).not.toContain('wrong-secret');
		const md5 = await rejection(
			open({ user: cluster().users.md5.user, password: 'nope' }),
			PostgresError,
		);
		expect(md5.code).toBe('28P01');
	});

	it('fails clearly when a password is needed but missing', async () => {
		await expect(
			open({ password: undefined, passfile: '/nonexistent' }),
		).rejects.toThrow(/requested a password/);
	});

	it('reports a missing database', async () => {
		const error = await rejection(
			open({ database: 'no_such_db' }),
			PostgresError,
		);
		expect(error.code).toBe('3D000');
	});

	it('connects over a Unix-domain socket', async () => {
		await using conn = await open({ host: cluster().socketDir });
		expect((await conn.query('select 1 as one')).rows).toEqual([{ one: 1 }]);
	});
});

describe.skipIf(noPg)('TLS', () => {
	it('refuses an SSL-only user without TLS', async () => {
		const error = await rejection(
			open({ ...ssl(), ssl: 'disable' }),
			PostgresError,
		);
		expect(error.code).toBe('28000');
	});

	it('sslmode=require', async () => {
		await using conn = await open({ ...ssl(), ssl: 'require' });
		expect(await sslInUse(conn)).toBe(true);
	});

	it('sslmode=prefer uses TLS when offered', async () => {
		await using conn = await open({ ...ssl(), ssl: 'prefer' });
		expect(await sslInUse(conn)).toBe(true);
	});

	it('sslmode=allow retries with TLS when the server refuses plain', async () => {
		await using conn = await open({ ...ssl(), ssl: 'allow' });
		expect(await sslInUse(conn)).toBe(true);
	});

	it('verify-ca and verify-full with the right CA', async () => {
		const ca = cluster().ca;
		await using a = await open({ ...ssl(), ssl: { mode: 'verify-ca', ca } });
		expect(await sslInUse(a)).toBe(true);
		await using b = await open({
			...ssl(),
			host: 'localhost',
			ssl: { mode: 'verify-full', ca },
		});
		expect(await sslInUse(b)).toBe(true);
	});

	it('verify-full rejects a host name the certificate does not cover', async () => {
		await expect(
			open({
				...ssl(),
				host: '127.0.0.1',
				ssl: { mode: 'verify-full', ca: cluster().ca },
			}),
		).rejects.toThrow(ConnectionError);
	});

	it('verify-ca rejects an untrusted certificate', async () => {
		await expect(open({ ...ssl(), ssl: 'verify-ca' })).rejects.toThrow(
			ConnectionError,
		);
	});

	it('direct TLS (sslnegotiation=direct)', async () => {
		const rec = recordingSockets();
		await using conn = await open({
			...ssl(),
			ssl: { mode: 'require', negotiation: 'direct' },
			socket: rec.factory,
		});
		expect(await sslInUse(conn)).toBe(true);
		// no SSLRequest (length 8, code 80877103) was sent in the clear
		expect(rec.sent().startsWith('\0\0\0\x08\x04\xd2\x16\x2f')).toBe(false);
	});

	it('SCRAM-SHA-256-PLUS with channel binding over TLS', async () => {
		const rec = recordingSockets();
		await using conn = await open({
			ssl: 'require',
			channelBinding: 'require',
			socket: rec.factory,
		});
		expect(await sslInUse(conn)).toBe(true);
		// the SCRAM exchange itself is inside TLS; the binding was required, so success proves it was used
		expect(conn.processId).toBeGreaterThan(0);
	});

	it('channel_binding=require refuses connections that cannot bind', async () => {
		await expect(open({ channelBinding: 'require' })).rejects.toThrow(
			/channel_binding=require/,
		);
		await expect(
			open({
				user: cluster().users.password.user,
				password: cluster().users.password.password,
				ssl: 'require',
				channelBinding: 'require',
			}),
		).rejects.toThrow(/channel_binding=require/);
	});
});

describe.skipIf(noPg)('startup', () => {
	it('negotiates protocol 3.2 with a 32-byte cancel key', async () => {
		await using conn = await open();
		expect(conn.protocol).toBe('3.2');
		expect(conn.capabilities).toMatchObject({
			protocol: '3.2',
			longCancelKeys: true,
		});
		expect(conn.capabilities.serverVersion).toMatch(/^1[89]/);
		expect(conn.parameters.get('client_encoding')).toBe('UTF8');
		expect(conn.parameters.get('DateStyle')).toBe('ISO, MDY');
	});

	it('speaks 3.0 when asked', async () => {
		await using conn = await open({ protocol: '3.0' });
		expect(conn.protocol).toBe('3.0');
		expect((await conn.query('select 1 as one')).rows).toEqual([{ one: 1 }]);
	});

	it('sends startup parameters and application_name', async () => {
		await using conn = await open({
			applicationName: 'quarry-test',
			params: { search_path: 'pg_catalog' },
		});
		const { rows } = await conn.query(
			"select current_setting('application_name') as app, current_setting('search_path') as sp",
		);
		expect(rows[0]).toEqual({ app: 'quarry-test', sp: 'pg_catalog' });
	});

	it('times out against a server that never answers', async () => {
		const server = createServer(() => {});
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve),
		);
		const address = server.address();
		const port = typeof address === 'object' && address ? address.port : 0;
		const started = Date.now();
		const error = await rejection(
			open({ port, connectTimeout: 300 }),
			ConnectionError,
		);
		expect(error.code).toBe('ETIMEDOUT');
		expect(Date.now() - started).toBeLessThan(2000);
		server.close();
	});

	it('reports a refused connection', async () => {
		const error = await rejection(open({ port: 1 }), ConnectionError);
		expect(error.code).toBe('ECONNREFUSED');
	});

	it('fails over to the next host', async () => {
		const c = cluster();
		await using conn = await open({
			host: `${c.host},${c.host}`,
			port: `1,${c.port}`,
		});
		expect(conn.host.port).toBe(c.port);
	});

	it('honours target_session_attrs', async () => {
		await using primary = await open({ targetSessionAttrs: 'read-write' });
		expect(primary.processId).toBeGreaterThan(0);
		await expect(open({ targetSessionAttrs: 'standby' })).rejects.toThrow(
			/not a standby/,
		);
		await using fallback = await open({ targetSessionAttrs: 'prefer-standby' });
		expect(fallback.processId).toBeGreaterThan(0);
	});

	it('connects from a connection string', async () => {
		const c = cluster();
		const url = `postgres://${c.users.scram.user}:${encodeURIComponent(c.users.scram.password)}@${c.host}:${c.port}/${c.database}?sslmode=require&application_name=from-url`;
		await using conn = await connect({ connectionString: url, env: {} });
		const { rows } = await conn.query(
			"select current_setting('application_name') as app",
		);
		expect(rows[0]).toEqual({ app: 'from-url' });
	});

	it('reads PG* environment variables', async () => {
		const c = cluster();
		await using conn = await connect({
			env: {
				PGHOST: c.host,
				PGPORT: String(c.port),
				PGUSER: c.users.trust.user,
				PGDATABASE: c.database,
				PGSSLMODE: 'disable',
			},
		});
		expect((await conn.query('select current_user as u')).rows[0]).toEqual({
			u: 'trust_user',
		});
	});
});
