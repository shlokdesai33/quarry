/* oxlint-disable no-await-in-loop -- polling ports and loading data, one step at a time */
/**
 * The benchmark environment: a PostgreSQL 18 cluster tuned for client
 * benchmarking, PgBouncer (transaction mode), Toxiproxy (simulated network
 * round-trip time) and Neon's wsproxy (WebSocket → TCP, for
 * @neondatabase/serverless), each pinned to its own CPUs.
 *
 * The cluster lives in a persistent directory (`--dir`, default
 * `~/.cache/quarry-driver-bench`) so the data set is generated once.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CPUS = {
	/** The benchmarked client process. */
	client: process.env['BENCH_CLIENT_CPUS'] ?? '0-2',
	/** PgBouncer, Toxiproxy and wsproxy share one core. */
	proxies: process.env['BENCH_PROXY_CPUS'] ?? '3',
	/** PostgreSQL (postmaster and every backend). */
	server: process.env['BENCH_SERVER_CPUS'] ?? '4-7',
};

export const PORTS = {
	postgres: 55432,
	bouncer: 56432,
	toxiproxy: 57432,
	toxiproxyApi: 58474,
	wsproxy: 59432,
};

export const USERS = {
	trust: 'bench_trust',
	scram: 'bench_scram',
	scramPassword: 'bench-scram-pw',
	database: 'bench',
};

export interface BenchEnv {
	readonly dir: string;
	readonly binDir: string;
	readonly dataDir: string;
	readonly caFile: string;
	readonly urls: {
		/** Direct TCP, trust auth, no TLS: the default target. */
		readonly direct: string;
		/** Through PgBouncer in transaction mode. */
		readonly bouncer: string;
		/** Through Toxiproxy (latency set per cell). */
		readonly toxiproxy: string;
	};
	/** PostgreSQL's `postgresql.conf` additions, for the report. */
	readonly serverConfig: readonly string[];
	readonly bouncerConfig: readonly string[];
}

export const SERVER_CONFIG = [
	`listen_addresses = 'localhost'`,
	`port = ${PORTS.postgres}`,
	`max_connections = 400`,
	`shared_buffers = 2GB`,
	`work_mem = 64MB`,
	// client benchmark: keep the server's commit path off the disk
	`synchronous_commit = off`,
	`checkpoint_timeout = 1h`,
	`max_wal_size = 32GB`,
	// JIT compiles big scans unpredictably; off so every client sees the same server work
	`jit = off`,
	`autovacuum = off`,
	`ssl = on`,
	`password_encryption = 'scram-sha-256'`,
	`timezone = 'UTC'`,
	`max_prepared_transactions = 0`,
	`log_min_messages = warning`,
	`log_connections = off`,
];

function sh(cmd: string, args: string[], input?: string): string {
	return execFileSync(cmd, args, {
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'pipe'],
		...(input === undefined ? {} : { input }),
	});
}

export function findBinDir(): string {
	for (const v of [process.env['PG_VERSION'] ?? '18']) {
		const dir = process.env['PG_BIN'] ?? `/usr/lib/postgresql/${v}/bin`;
		if (existsSync(join(dir, 'postgres'))) return dir;
	}
	throw new Error('PostgreSQL 18 not found (set PG_BIN)');
}

export async function waitForPort(port: number, tries = 400): Promise<void> {
	for (let i = 0; i < tries; i++) {
		const ok = await new Promise<boolean>((resolve) => {
			const socket = connect(port, '127.0.0.1');
			socket.once('connect', () => {
				socket.destroy();
				resolve(true);
			});
			socket.once('error', () => resolve(false));
		});
		if (ok) return;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error(`Nothing listening on port ${port}`);
}

function certificates(dir: string): void {
	if (existsSync(join(dir, 'server.crt'))) return;
	const ssl = (args: string[]) =>
		execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
	ssl(
		['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30'].concat([
			'-subj',
			'/CN=bench-ca',
			'-keyout',
			'ca.key',
			'-out',
			'ca.crt',
		]),
	);
	ssl(
		['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost'].concat([
			'-keyout',
			'server.key',
			'-out',
			'server.csr',
		]),
	);
	writeFileSync(
		join(dir, 'server.ext'),
		'subjectAltName=DNS:localhost,IP:127.0.0.1\n',
	);
	ssl(
		[
			'x509',
			'-req',
			'-in',
			'server.csr',
			'-CA',
			'ca.crt',
			'-CAkey',
			'ca.key',
		].concat([
			'-CAcreateserial',
			'-days',
			'30',
			'-sha256',
			'-extfile',
			'server.ext',
			'-out',
			'server.crt',
		]),
	);
	execFileSync('chmod', ['600', join(dir, 'server.key')]);
}

export function psql(
	env: { binDir: string; dir: string },
	sql: string,
): string {
	return sh(join(env.binDir, 'psql'), [
		'-h',
		env.dir,
		'-p',
		String(PORTS.postgres),
		'-U',
		'postgres',
		'-d',
		USERS.database,
		'-v',
		'ON_ERROR_STOP=1',
		'-qAt',
		'-c',
		sql,
	]);
}

const children: ChildProcess[] = [];

function pinned(
	cpus: string,
	cmd: string,
	args: string[],
	env: NodeJS.ProcessEnv = {},
): ChildProcess {
	const child = spawn('taskset', ['-c', cpus, cmd, ...args], {
		stdio: 'ignore',
		env: { ...process.env, ...env },
	});
	children.push(child);
	return child;
}

export function startPostgres(
	binDir: string,
	dataDir: string,
	dir: string,
): void {
	sh('taskset', [
		'-c',
		CPUS.server,
		join(binDir, 'pg_ctl'),
		'start',
		'-w',
		'-D',
		dataDir,
		'-l',
		join(dir, 'postgres.log'),
		'-o',
		`-k ${dir}`,
	]);
}

export function stopPostgres(binDir: string, dataDir: string): void {
	try {
		sh(join(binDir, 'pg_ctl'), ['stop', '-w', '-m', 'fast', '-D', dataDir]);
	} catch {
		// not running
	}
}

/** Restarts the server (fast shutdown), returning when it accepts connections again. */
export function restartPostgres(env: BenchEnv): { down: number; up: number } {
	const down = Date.now();
	sh(join(env.binDir, 'pg_ctl'), [
		'stop',
		'-w',
		'-m',
		'fast',
		'-D',
		env.dataDir,
	]);
	startPostgres(env.binDir, env.dataDir, env.dir);
	return { down, up: Date.now() };
}

export async function startEnv(
	dir = join(homedir(), '.cache', 'quarry-driver-bench'),
): Promise<BenchEnv> {
	mkdirSync(dir, { recursive: true });
	const binDir = findBinDir();
	const dataDir = join(dir, 'data');
	certificates(dir);
	if (!existsSync(join(dataDir, 'PG_VERSION'))) {
		sh(join(binDir, 'initdb'), [
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
		const conf = join(dataDir, 'postgresql.conf');
		writeFileSync(
			conf,
			readFileSync(conf, 'utf8') +
				[
					...SERVER_CONFIG,
					`unix_socket_directories = '${dir}'`,
					`ssl_cert_file = '${join(dir, 'server.crt')}'`,
					`ssl_key_file = '${join(dir, 'server.key')}'`,
					'',
				].join('\n'),
		);
		writeFileSync(
			join(dataDir, 'pg_hba.conf'),
			[
				'local all all trust',
				`host all ${USERS.trust} 127.0.0.1/32 trust`,
				`host all ${USERS.trust} ::1/128 trust`,
				`host all postgres 127.0.0.1/32 trust`,
				`host all all 127.0.0.1/32 scram-sha-256`,
				`host all all ::1/128 scram-sha-256`,
				'',
			].join('\n'),
		);
	}
	stopPostgres(binDir, dataDir);
	startPostgres(binDir, dataDir, dir);
	const base = { binDir, dir };
	if (
		!sh(join(binDir, 'psql'), [
			'-h',
			dir,
			'-p',
			String(PORTS.postgres),
			'-U',
			'postgres',
			'-d',
			'postgres',
			'-qAt',
			'-c',
			`select 1 from pg_database where datname = '${USERS.database}'`,
		]).trim()
	) {
		sh(join(binDir, 'psql'), [
			'-h',
			dir,
			'-p',
			String(PORTS.postgres),
			'-U',
			'postgres',
			'-d',
			'postgres',
			'-q',
			'-c',
			`create user ${USERS.trust} superuser`,
			'-c',
			`create user ${USERS.scram} superuser password '${USERS.scramPassword}'`,
			'-c',
			`create database ${USERS.database} owner ${USERS.trust}`,
		]);
	}
	loadData(base);

	// PgBouncer, transaction mode, prepared statements on (1.21+)
	const bouncerConfig = [
		'pool_mode = transaction',
		'max_prepared_statements = 500',
		'default_pool_size = 20',
		'max_client_conn = 5000',
		'auth_type = trust',
		'ignore_startup_parameters = extra_float_digits,options',
	];
	writeFileSync(
		join(dir, 'userlist.txt'),
		`"${USERS.trust}" ""\n"postgres" ""\n`,
	);
	writeFileSync(
		join(dir, 'pgbouncer.ini'),
		[
			'[databases]',
			`${USERS.database} = host=127.0.0.1 port=${PORTS.postgres} dbname=${USERS.database} user=${USERS.trust}`,
			'[pgbouncer]',
			'listen_addr = 127.0.0.1',
			`listen_port = ${PORTS.bouncer}`,
			'unix_socket_dir =',
			`auth_file = ${join(dir, 'userlist.txt')}`,
			...bouncerConfig,
			`logfile = ${join(dir, 'pgbouncer.log')}`,
			'log_connections = 0',
			'log_disconnections = 0',
			'',
		].join('\n'),
	);
	await killPort(PORTS.bouncer);
	pinned(CPUS.proxies, '/usr/sbin/pgbouncer', [join(dir, 'pgbouncer.ini')]);

	const bin = process.env['BENCH_BIN'] ?? join(homedir(), 'benchbin');
	await killPort(PORTS.toxiproxyApi);
	pinned(CPUS.proxies, join(bin, 'toxiproxy-server'), [
		'-host',
		'127.0.0.1',
		'-port',
		String(PORTS.toxiproxyApi),
	]);
	await killPort(PORTS.wsproxy);
	pinned(CPUS.proxies, join(bin, 'wsproxy'), [], {
		LISTEN_PORT: `127.0.0.1:${PORTS.wsproxy}`,
		PROMETHEUS_BIND: '127.0.0.1:0',
		ALLOW_ADDR_REGEX: '',
		LOG_CONN_INFO: 'false',
	});
	await Promise.all([
		waitForPort(PORTS.bouncer),
		waitForPort(PORTS.toxiproxyApi),
		waitForPort(PORTS.wsproxy),
	]);
	await toxiproxy('POST', '/proxies', {
		name: 'pg',
		listen: `127.0.0.1:${PORTS.toxiproxy}`,
		upstream: `127.0.0.1:${PORTS.postgres}`,
		enabled: true,
	}).catch(() => {});
	await setLatency(0);
	await waitForPort(PORTS.toxiproxy);

	const url = (port: number) =>
		`postgres://${USERS.trust}@127.0.0.1:${port}/${USERS.database}`;
	return {
		dir,
		binDir,
		dataDir,
		caFile: join(dir, 'ca.crt'),
		urls: {
			direct: url(PORTS.postgres),
			bouncer: url(PORTS.bouncer),
			toxiproxy: url(PORTS.toxiproxy),
		},
		serverConfig: SERVER_CONFIG,
		bouncerConfig,
	};
}

async function killPort(port: number): Promise<void> {
	try {
		sh('fuser', ['-k', `${port}/tcp`]);
		await new Promise((r) => setTimeout(r, 200));
	} catch {
		// nothing there
	}
}

async function toxiproxy(
	method: string,
	path: string,
	body?: unknown,
): Promise<unknown> {
	const res = await fetch(`http://127.0.0.1:${PORTS.toxiproxyApi}${path}`, {
		method,
		headers: { 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	if (!res.ok && res.status !== 404)
		throw new Error(
			`toxiproxy ${method} ${path}: ${res.status} ${await res.text()}`,
		);
	return res.status === 204 ? undefined : res.json().catch(() => undefined);
}

let currentRtt = -1;
/**
 * Sets the simulated round-trip time. Toxiproxy takes whole milliseconds,
 * so the whole RTT goes on the server → client direction: every request
 * still waits one RTT for its response, and pipelined requests overlap.
 */
export async function setLatency(rttMs: number): Promise<void> {
	if (rttMs === currentRtt) return;
	await toxiproxy('DELETE', '/proxies/pg/toxics/rtt');
	if (rttMs > 0) {
		await toxiproxy('POST', '/proxies/pg/toxics', {
			name: 'rtt',
			type: 'latency',
			stream: 'downstream',
			toxicity: 1,
			attributes: { latency: rttMs, jitter: 0 },
		});
	}
	currentRtt = rttMs;
}

export function stopChildren(): void {
	for (const child of children) child.kill('SIGTERM');
}

const md5s = (n: number) =>
	`(select string_agg(md5(random()::text || g::text), '') from generate_series(1, ${n}) g)`;

/** Generates the data set once; a marker table records the version. */
function loadData(env: { binDir: string; dir: string }): void {
	const VERSION = '3';
	try {
		if (psql(env, 'select v from bench_meta').trim() === VERSION) return;
	} catch {
		// first run
	}
	console.error('loading benchmark data (once)…');
	psql(
		env,
		`
		drop table if exists bench_meta, bench_users, bench_wide, bench_large, bench_arrays, bench_types, bench_writes, bench_kv, bench_upd, bench_del cascade;
		select setseed(0.42);
		create table bench_users (id int primary key, name text not null, email text not null, score float8 not null, created timestamptz not null, active bool not null);
		insert into bench_users select i, 'user ' || i, 'user' || i || '@example.com', i / 7.0, '2024-01-01'::timestamptz + i * interval '1 minute', i % 2 = 0 from generate_series(1, 1000000) i;
		create table bench_wide (id int primary key, ${[
			...Array.from({ length: 25 }, (_, i) => `i${i} int4`),
			...Array.from({ length: 25 }, (_, i) => `t${i} text`),
			...Array.from({ length: 25 }, (_, i) => `f${i} float8`),
			...Array.from({ length: 14 }, (_, i) => `b${i} bool`),
			...Array.from({ length: 10 }, (_, i) => `ts${i} timestamptz`),
		].join(', ')});
		insert into bench_wide select g, ${[
			...Array.from({ length: 25 }, (_, i) => `g * ${i + 1}`),
			...Array.from({ length: 25 }, (_, i) => `'text value ${i} ' || g`),
			...Array.from({ length: 25 }, (_, i) => `g / ${i + 3}.0`),
			...Array.from({ length: 14 }, (_, i) => `(g + ${i}) % 3 = 0`),
			...Array.from(
				{ length: 10 },
				(_, i) =>
					`'2024-01-01'::timestamptz + (g * ${i + 1}) * interval '1 second'`,
			),
		].join(', ')} from generate_series(1, 1000) g;
		create table bench_large (id int primary key, kind text not null, t text, b bytea, j jsonb);
		alter table bench_large alter column t set storage external, alter column b set storage external, alter column j set storage external;
		insert into bench_large (id, kind, t) select g, 'text', ${md5s(32768)} from generate_series(1, 10) g;
		insert into bench_large (id, kind, b) select 100 + g, 'bytea', decode(${md5s(65536)}, 'hex') from generate_series(1, 10) g;
		insert into bench_large (id, kind, j) select 200 + g, 'jsonb', (select jsonb_agg(jsonb_build_object('id', x, 'name', 'item ' || x, 'tags', jsonb_build_array('a', 'b', 'c'), 'score', x / 3.0, 'ok', x % 2 = 0)) from generate_series(1, 2500) x) from generate_series(1, 20) g;
		create table bench_arrays (id int primary key, ints int4[] not null, texts text[] not null);
		insert into bench_arrays select g, (select array_agg(g * 100 + x) from generate_series(1, 100) x), (select array_agg(case x % 4 when 0 then 'plain' || x when 1 then 'with space ' || x when 2 then 'comma,' || x else 'quote"' || x end) from generate_series(1, 20) x) from generate_series(1, 1000) g;
		create table bench_types (id int primary key, i4 int4, i8 int8, f8 float8, num numeric(20, 6), txt text, b bool, ts timestamptz, d date, u uuid, j jsonb, i4a int4[], by bytea);
		insert into bench_types select g, g, g::int8 * 1000000007, g / 3.0, (g::numeric * 1234.567891)::numeric(20, 6), 'text value ' || lpad(g::text, 9, '0'), g % 2 = 0, '2024-01-01'::timestamptz + g * interval '1 second 1 millisecond', date '2000-01-01' + (g % 10000), md5(g::text)::uuid, jsonb_build_object('a', g, 'b', 'x' || g), array[g, g + 1, g + 2, g + 3, g + 4], decode(md5(g::text), 'hex') from generate_series(1, 100000) g;
		create table bench_writes (id bigint generated always as identity primary key, name text, score float8, created timestamptz);
		create table bench_kv (k int primary key, v text not null);
		insert into bench_kv select g, 'v' || g from generate_series(1, 100000) g;
		create table bench_upd (id int primary key, score float8 not null, name text not null);
		insert into bench_upd select g, 0, 'n' || g from generate_series(1, 100000) g;
		create table bench_del (id bigint primary key);
		create table bench_meta (v text);
		insert into bench_meta values ('${VERSION}');
	`,
	);
	psql(env, 'vacuum (analyze, freeze)');
	psql(env, 'checkpoint');
}
