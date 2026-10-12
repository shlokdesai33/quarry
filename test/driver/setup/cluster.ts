/* oxlint-disable no-await-in-loop -- polling for a port, one attempt at a time */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Connection details of the throwaway cluster the integration tests run against. */
export interface TestCluster {
	readonly host: string;
	readonly port: number;
	/** Directory holding the Unix-domain socket. */
	readonly socketDir: string;
	readonly database: string;
	/** PgBouncer in transaction mode, in front of the cluster. */
	readonly bouncerPort: number | undefined;
	/** The CA that signed the server certificate (PEM). */
	readonly ca: string;
	readonly dataDir: string;
	readonly binDir: string;
	/** The server's version as `server_version_num`, e.g. 180006. */
	readonly serverVersionNum: number;
	/** Extensions the server can create (`pg_available_extensions`). */
	readonly extensions: readonly string[];
	/** PgBouncer's version, e.g. `1.26.0`, when it runs. */
	readonly bouncerVersion: string | undefined;
	/** A client certificate (CN=cert_user) signed by `ca`, its key, and the key encrypted with `keyPassphrase`. */
	readonly client: {
		readonly certFile: string;
		readonly keyFile: string;
		readonly encryptedKeyFile: string;
		readonly keyPassphrase: string;
		readonly cert: string;
		readonly key: string;
	};
	readonly users: {
		readonly superuser: { user: string; password: string };
		readonly trust: { user: string };
		readonly password: { user: string; password: string };
		readonly md5: { user: string; password: string };
		readonly scram: { user: string; password: string };
		readonly sslOnly: { user: string; password: string };
		readonly cert: { user: string };
	};
}

const USERS = {
	superuser: { user: 'postgres', password: 'postgres-pw' },
	trust: { user: 'trust_user' },
	password: { user: 'password_user', password: 'clear-pw' },
	md5: { user: 'md5_user', password: 'md5-pw' },
	scram: { user: 'scram_user', password: 'scram pässwörd ½' },
	sslOnly: { user: 'ssl_only', password: 'ssl-pw' },
	cert: { user: 'cert_user' },
} as const;

/** Finds the PostgreSQL server binaries: `PG_BIN`, `pg_config --bindir`, or the newest under /usr/lib/postgresql. */
export function findBinDir(): string | undefined {
	const candidates: string[] = [];
	if (process.env['PG_BIN']) candidates.push(process.env['PG_BIN']);
	// PG_VERSION picks an installed major version (18 or later; 18 is the tested one)
	const versions = process.env['PG_VERSION']
		? [process.env['PG_VERSION']]
		: ['18', '19', '20'];
	for (const v of versions) candidates.push(`/usr/lib/postgresql/${v}/bin`);
	if (!process.env['PG_VERSION']) {
		try {
			candidates.push(
				execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(),
			);
		} catch {
			// no pg_config on PATH
		}
	}
	return candidates.find(
		(dir) => existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'pg_ctl')),
	);
}

/** `postgres --version` as `server_version_num`. */
function serverVersionNum(binDir: string): number {
	const text = run(join(binDir, 'postgres'), ['--version']);
	const match = /(\d+)(?:\.(\d+))?/.exec(text);
	return Number(match?.[1] ?? 0) * 10000 + Number(match?.[2] ?? 0);
}

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

function run(
	cmd: string,
	args: string[],
	options: { cwd?: string; input?: string } = {},
) {
	return execFileSync(cmd, args, {
		stdio: ['pipe', 'pipe', 'pipe'],
		encoding: 'utf8',
		...options,
	});
}

function makeCertificates(dir: string): void {
	const ssl = (args: string[]) => run('openssl', args, { cwd: dir });
	ssl([
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-days',
		'3',
		'-subj',
		'/CN=quarry-test-ca',
		'-keyout',
		'ca.key',
		'-out',
		'ca.crt',
	]);
	ssl([
		'req',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-subj',
		'/CN=localhost',
		'-keyout',
		'server.key',
		'-out',
		'server.csr',
	]);
	writeFileSync(join(dir, 'server.ext'), 'subjectAltName=DNS:localhost\n');
	ssl([
		'x509',
		'-req',
		'-in',
		'server.csr',
		'-CA',
		'ca.crt',
		'-CAkey',
		'ca.key',
		'-CAcreateserial',
		'-days',
		'3',
		'-sha256',
		'-extfile',
		'server.ext',
		'-out',
		'server.crt',
	]);
	ssl([
		'req',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-subj',
		'/CN=cert_user',
		'-keyout',
		'client.key',
		'-out',
		'client.csr',
	]);
	ssl([
		'x509',
		'-req',
		'-in',
		'client.csr',
		'-CA',
		'ca.crt',
		'-CAkey',
		'ca.key',
		'-CAcreateserial',
		'-days',
		'3',
		'-sha256',
		'-out',
		'client.crt',
	]);
	ssl([
		'pkcs8',
		'-topk8',
		'-v2',
		'aes-256-cbc',
		'-in',
		'client.key',
		'-passout',
		`pass:${KEY_PASSPHRASE}`,
		'-out',
		'client-encrypted.key',
	]);
}

const KEY_PASSPHRASE = 'client key pässphrase';

export interface RunningCluster {
	readonly info: TestCluster;
	stop(): Promise<void>;
}

/**
 * Creates and starts a cluster in a temporary directory, with TLS, one
 * role per authentication method, and PgBouncer in transaction mode when
 * it is installed.
 */
export async function startCluster(binDir: string): Promise<RunningCluster> {
	const dir = mkdtempSync(join(tmpdir(), 'quarry-pg-'));
	const dataDir = join(dir, 'data');
	// QUARRY_PG_PORT pins the port (the compatibility suites expect 5432)
	const port = Number(process.env['QUARRY_PG_PORT'] ?? 0) || (await freePort());
	makeCertificates(dir);
	const versionNum = serverVersionNum(binDir);
	if (versionNum < 180000) {
		throw new Error(
			`The driver needs PostgreSQL 18 or later; ${binDir} is ${versionNum}`,
		);
	}

	run(join(binDir, 'initdb'), [
		'-D',
		dataDir,
		'-U',
		'postgres',
		'--auth=trust',
		'-E',
		'UTF8',
		'--locale=C.UTF-8',
		'--no-sync',
	]);
	writeFileSync(
		join(dataDir, 'postgresql.conf'),
		readFileSync(join(dataDir, 'postgresql.conf'), 'utf8') +
			[
				`port = ${port}`,
				`listen_addresses = '127.0.0.1'`,
				`unix_socket_directories = '${dir}'`,
				`ssl = on`,
				`ssl_cert_file = '${join(dir, 'server.crt')}'`,
				`ssl_key_file = '${join(dir, 'server.key')}'`,
				`ssl_ca_file = '${join(dir, 'ca.crt')}'`,
				`password_encryption = 'scram-sha-256'`,
				`max_connections = 300`,
				`fsync = off`,
				`synchronous_commit = off`,
				`full_page_writes = off`,
				`max_prepared_transactions = 10`,
				`timezone = 'UTC'`,
				'',
			].join('\n'),
	);
	writeFileSync(
		join(dataDir, 'pg_hba.conf'),
		[
			'local all postgres trust',
			'local all scram_user scram-sha-256',
			'host all postgres 127.0.0.1/32 trust',
			'hostssl all ssl_only 127.0.0.1/32 scram-sha-256',
			'hostnossl all ssl_only 127.0.0.1/32 reject',
			'host all trust_user 127.0.0.1/32 trust',
			'host all password_user 127.0.0.1/32 password',
			'host all md5_user 127.0.0.1/32 md5',
			'hostssl all cert_user 127.0.0.1/32 cert',
			'host all all 127.0.0.1/32 scram-sha-256',
			'',
		].join('\n'),
	);
	run(join(binDir, 'pg_ctl'), [
		'start',
		'-w',
		'-D',
		dataDir,
		'-l',
		join(dir, 'postgres.log'),
	]);

	const psql = (sql: string) =>
		run(join(binDir, 'psql'), [
			'-h',
			dir,
			'-p',
			String(port),
			'-U',
			'postgres',
			'-d',
			'postgres',
			'-v',
			'ON_ERROR_STOP=1',
			'-q',
			'-c',
			sql,
		]);
	psql(`alter user postgres password '${USERS.superuser.password}'`);
	psql(`create user trust_user superuser`);
	psql(`create user password_user password '${USERS.password.password}'`);
	psql(
		`set password_encryption = 'md5'; create user md5_user password '${USERS.md5.password}'`,
	);
	psql(`create user scram_user superuser password '${USERS.scram.password}'`);
	psql(`create user ssl_only password '${USERS.sslOnly.password}'`);
	psql(`create user cert_user`);
	psql(`create database quarry_test owner scram_user`);
	const extensions = run(join(binDir, 'psql'), [
		'-h',
		dir,
		'-p',
		String(port),
		'-U',
		'postgres',
		'-d',
		'postgres',
		'-At',
		'-c',
		'select name from pg_available_extensions',
	])
		.split('\n')
		.filter(Boolean);
	psql(`grant all on database quarry_test to public`);

	let bouncer: ChildProcess | undefined;
	let bouncerPort: number | undefined;
	let bouncerVersion: string | undefined;
	const bouncerBin = process.env['PGBOUNCER_BIN'] ?? '/usr/sbin/pgbouncer';
	if (!process.env['QUARRY_SKIP_PGBOUNCER'] && existsSync(bouncerBin)) {
		bouncerVersion = /(\d+\.\d+(?:\.\d+)?)/.exec(
			run(bouncerBin, ['--version']),
		)?.[1];
		bouncerPort = await freePort();
		writeFileSync(
			join(dir, 'userlist.txt'),
			['postgres', 'trust_user', 'scram_user']
				.map((u) => `"${u}" ""`)
				.join('\n') + '\n',
		);
		writeFileSync(
			join(dir, 'pgbouncer.ini'),
			[
				'[databases]',
				`quarry_test = host=127.0.0.1 port=${port} dbname=quarry_test user=postgres`,
				'[pgbouncer]',
				`listen_addr = 127.0.0.1`,
				`listen_port = ${bouncerPort}`,
				`unix_socket_dir =`,
				`auth_type = trust`,
				`auth_file = ${join(dir, 'userlist.txt')}`,
				`pool_mode = transaction`,
				// protocol-level prepared statements in transaction mode: PgBouncer 1.21+
				...(versionAtLeast(bouncerVersion, 1, 21)
					? ['max_prepared_statements = 200']
					: []),
				`default_pool_size = 4`,
				`max_client_conn = 200`,
				`ignore_startup_parameters = extra_float_digits,options`,
				`logfile = ${join(dir, 'pgbouncer.log')}`,
				'',
			].join('\n'),
		);
		bouncer = spawn(bouncerBin, [join(dir, 'pgbouncer.ini')], {
			stdio: 'ignore',
		});
		await waitForPort(bouncerPort);
	}

	return {
		info: {
			host: '127.0.0.1',
			port,
			socketDir: dir,
			database: 'quarry_test',
			bouncerPort,
			ca: readFileSync(join(dir, 'ca.crt'), 'utf8'),
			dataDir,
			binDir,
			serverVersionNum: versionNum,
			extensions,
			bouncerVersion,
			client: {
				certFile: join(dir, 'client.crt'),
				keyFile: join(dir, 'client.key'),
				encryptedKeyFile: join(dir, 'client-encrypted.key'),
				keyPassphrase: KEY_PASSPHRASE,
				cert: readFileSync(join(dir, 'client.crt'), 'utf8'),
				key: readFileSync(join(dir, 'client.key'), 'utf8'),
			},
			users: USERS,
		},
		async stop() {
			bouncer?.kill('SIGTERM');
			try {
				run(join(binDir, 'pg_ctl'), [
					'stop',
					'-w',
					'-m',
					'immediate',
					'-D',
					dataDir,
				]);
			} finally {
				if (!process.env['QUARRY_KEEP_CLUSTER'])
					rmSync(dir, { recursive: true, force: true });
			}
		},
	};
}

async function waitForPort(port: number): Promise<void> {
	const { connect } = await import('node:net');
	for (let i = 0; i < 100; i++) {
		const ok = await new Promise<boolean>((resolve) => {
			const socket = connect(port, '127.0.0.1');
			socket.once('connect', () => {
				socket.destroy();
				resolve(true);
			});
			socket.once('error', () => resolve(false));
		});
		if (ok) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`Nothing listening on port ${port}`);
}

/** Whether a dotted version such as `1.26.0` is at least major.minor. */
export function versionAtLeast(
	version: string | undefined,
	major: number,
	minor: number,
): boolean {
	const [a = 0, b = 0] = (version ?? '0').split('.').map(Number);
	return a > major || (a === major && b >= minor);
}
