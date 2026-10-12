// The cluster the compatibility runs use: the integration-test cluster
// plus the roles, databases and settings node-postgres's and postgres.js's
// CI set up, and a PgBouncer in transaction mode that serves every database.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { startCluster, type RunningCluster } from '../setup/cluster.js';

export interface CompatCluster {
	readonly running: RunningCluster;
	readonly host: string;
	readonly port: number;
	readonly socketDir: string;
	readonly bouncerPort: number | undefined;
	stop(): Promise<void>;
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

function portFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once('error', () => resolve(false));
		server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
	});
}

/** Each host line for 127.0.0.1, also for ::1 (clients may resolve `localhost` to either). */
function bothFamilies(lines: string[]): string[] {
	return lines.flatMap((line) =>
		line.includes('127.0.0.1/32')
			? [line, line.replace('127.0.0.1/32', '::1/128')]
			: [line],
	);
}

export async function startCompatCluster(
	binDir: string,
	options: { bouncer: boolean },
): Promise<CompatCluster> {
	process.env['QUARRY_SKIP_PGBOUNCER'] = '1';
	// node-postgres's and postgres.js's tests assume the default port in places
	if (process.env['QUARRY_PG_PORT'] === undefined && (await portFree(5432)))
		process.env['QUARRY_PG_PORT'] = '5432';
	const running = await startCluster(binDir);
	const { info } = running;
	const bin = (name: string) => join(info.binDir, name);
	const psql = (sql: string, user = 'postgres') =>
		execFileSync(
			bin('psql'),
			[
				'-h',
				info.socketDir,
				'-p',
				String(info.port),
				'-U',
				user,
				'-d',
				'postgres',
				'-v',
				'ON_ERROR_STOP=1',
				'-q',
				'-c',
				sql,
			],
			{ encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
		);

	const conf = join(info.dataDir, 'postgresql.conf');
	writeFileSync(
		conf,
		readFileSync(conf, 'utf8') +
			[
				`listen_addresses = 'localhost'`,
				// postgres.js's CI: logical replication and two-phase commit
				`wal_level = logical`,
				`max_prepared_transactions = 100`,
				'',
			].join('\n'),
	);
	writeFileSync(
		join(info.dataDir, 'pg_hba.conf'),
		bothFamilies([
			'local all scram_user scram-sha-256',
			'local all all trust',
			'host all postgres 127.0.0.1/32 trust',
			// postgres.js's tests/pg_hba.conf
			'host postgres_js_test postgres_js_test 127.0.0.1/32 trust',
			'host postgres_js_test postgres_js_test_md5 127.0.0.1/32 md5',
			'host postgres_js_test postgres_js_test_scram 127.0.0.1/32 scram-sha-256',
			// node-postgres's CI
			'host all scram_test 127.0.0.1/32 scram-sha-256',
			'host all scram_unicode_test 127.0.0.1/32 scram-sha-256',
			// quarry's own roles
			'hostssl all ssl_only 127.0.0.1/32 scram-sha-256',
			'hostnossl all ssl_only 127.0.0.1/32 reject',
			'host all trust_user 127.0.0.1/32 trust',
			'host all password_user 127.0.0.1/32 password',
			'host all md5_user 127.0.0.1/32 md5',
			'hostssl all cert_user 127.0.0.1/32 cert',
			'host all all 127.0.0.1/32 scram-sha-256',
			'',
		]).join('\n'),
	);
	execFileSync(
		bin('pg_ctl'),
		[
			'restart',
			'-w',
			'-D',
			info.dataDir,
			'-l',
			join(info.socketDir, 'postgres.log'),
		],
		{
			stdio: 'ignore',
		},
	);

	psql(
		[
			`set password_encryption = 'scram-sha-256'`,
			`create role scram_test login password 'test4scram'`,
			`create role scram_unicode_test login password U&'IX-\\2168'`,
			`create user postgres_js_test`,
			`create user postgres_js_test_scram password 'postgres_js_test_scram'`,
			`set password_encryption = 'md5'`,
			`create user postgres_js_test_md5 password 'postgres_js_test_md5'`,
		].join('; '),
	);
	psql('create database ci_db_test');
	psql('create database postgres_js_test owner postgres_js_test');
	psql('grant all on database postgres_js_test to postgres_js_test');

	let bouncer: ChildProcess | undefined;
	let bouncerPort: number | undefined;
	if (options.bouncer) {
		bouncerPort = await freePort();
		const dir = info.socketDir;
		writeFileSync(
			join(dir, 'compat-userlist.txt'),
			[
				'postgres',
				'postgres_js_test',
				'postgres_js_test_md5',
				'postgres_js_test_scram',
				'scram_test',
				'scram_user',
				'trust_user',
			]
				.map((u) => `"${u}" ""`)
				.join('\n') + '\n',
		);
		writeFileSync(
			join(dir, 'compat-pgbouncer.ini'),
			[
				'[databases]',
				`* = host=127.0.0.1 port=${info.port} user=postgres`,
				'[pgbouncer]',
				'listen_addr = 127.0.0.1',
				`listen_port = ${bouncerPort}`,
				'unix_socket_dir =',
				'auth_type = trust',
				`auth_file = ${join(dir, 'compat-userlist.txt')}`,
				'pool_mode = transaction',
				'max_prepared_statements = 500',
				'default_pool_size = 20',
				'max_client_conn = 500',
				'ignore_startup_parameters = extra_float_digits,options,statement_timeout,lock_timeout,idle_in_transaction_session_timeout',
				`logfile = ${join(dir, 'compat-pgbouncer.log')}`,
				'',
			].join('\n'),
		);
		bouncer = spawn(
			process.env['PGBOUNCER_BIN'] ?? '/usr/sbin/pgbouncer',
			[join(dir, 'compat-pgbouncer.ini')],
			{ stdio: 'ignore' },
		);
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	return {
		running,
		host: '127.0.0.1',
		port: info.port,
		socketDir: info.socketDir,
		bouncerPort,
		async stop() {
			bouncer?.kill('SIGTERM');
			await running.stop();
		},
	};
}
