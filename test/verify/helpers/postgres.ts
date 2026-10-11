import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, Pool, type PoolConfig } from 'pg';
import type { Executor } from '../../../src/executor.js';

/**
 * A database for the integration tests: `QUARRY_TEST_DATABASE_URL` when set,
 * or else a throwaway cluster started with the PostgreSQL binaries found on
 * this machine. `undefined` when there is neither, and the tests skip.
 */
export interface TestDatabase {
	readonly pool: Pool;
	readonly executor: Executor;
	/** Runs SQL, with no parameters. */
	sql(text: string): Promise<void>;
	stop(): Promise<void>;
}

/** The server binaries: `PG_BIN`, the newest under /usr/lib/postgresql, or `pg_config --bindir`. */
function findBinDir(): string | undefined {
	const candidates: string[] = [];
	if (process.env['PG_BIN']) candidates.push(process.env['PG_BIN']);
	for (const version of ['18', '17', '16']) {
		candidates.push(`/usr/lib/postgresql/${version}/bin`);
	}
	try {
		candidates.push(
			execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(),
		);
	} catch {
		// no pg_config on PATH
	}
	return candidates.find((dir) => existsSync(join(dir, 'initdb')));
}

const url = process.env['QUARRY_TEST_DATABASE_URL'];
const binDir = url === undefined ? findBinDir() : undefined;

/** Whether the integration tests can run here. */
export const postgresAvailable =
	process.env['QUARRY_SKIP_PG'] === undefined &&
	(url !== undefined || binDir !== undefined);

function noop() {}

/** The schema the tests create their tables in, first on the search path. */
export const schema = 'quarry_verify';

export async function startDatabase(): Promise<TestDatabase> {
	let stopCluster: () => void = noop;
	let config: PoolConfig;
	if (url === undefined) {
		if (binDir === undefined) throw new Error('PostgreSQL is not installed');
		const dir = mkdtempSync(join(tmpdir(), 'quarry-verify-'));
		const data = join(dir, 'data');
		const bin = (name: string) => join(binDir, name);
		execFileSync(bin('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust'], {
			stdio: 'ignore',
		});
		execFileSync(
			bin('pg_ctl'),
			[
				'-D',
				data,
				'-o',
				`-k ${dir} -c listen_addresses='' -c fsync=off`,
				'-w',
				'start',
			],
			{ stdio: 'ignore' },
		);
		stopCluster = () => {
			execFileSync(bin('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], {
				stdio: 'ignore',
			});
			rmSync(dir, { recursive: true, force: true });
		};
		config = { host: dir, user: 'postgres', database: 'postgres' };
	} else {
		config = { connectionString: url };
	}
	const setup = new Client(config);
	await setup.connect();
	await setup.query(`drop schema if exists ${schema} cascade`);
	await setup.query(`create schema ${schema}`);
	await setup.end();
	const pool = new Pool({
		...config,
		max: 2,
		options: `-c search_path=${schema}`,
	});
	return {
		pool,
		executor: {
			execute: async ({ sql, params }) => ({
				rows: (await pool.query(sql, [...params])).rows,
			}),
		},
		sql: async (text) => {
			await pool.query(text);
		},
		stop: async () => {
			await pool.query(`drop schema if exists ${schema} cascade`);
			await pool.end();
			stopCluster();
		},
	};
}
