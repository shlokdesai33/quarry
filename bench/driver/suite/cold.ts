/**
 * Cold start of one client in a fresh process: module import time and the
 * time from process start to the first query's result (import + connect +
 * query). Prints one JSON line. Used by footprint.ts.
 *
 *   node cold.ts <driver> <port>
 */
const [driver = 'quarry', portArg = '55432'] = process.argv
	.slice(2)
	.filter((a) => !a.startsWith('-'))
	.slice(-2);
const port = Number(portArg);
const url = `postgres://bench_trust@127.0.0.1:${port}/bench`;

const t0 = performance.now();
let query: () => Promise<unknown>;
let end: () => Promise<unknown>;
switch (driver) {
	case 'quarry': {
		const dist =
			process.env['QUARRY_DIST'] ??
			new URL('../../../dist/driver/index.js', import.meta.url).href;
		const { createPool } = await import(dist);
		const pool = createPool({
			connectionString: url,
			ssl: 'disable',
			env: {},
			max: 1,
		});
		query = () => pool.query('select 1');
		end = () => pool.end();
		break;
	}
	case 'pg': {
		const pg = (await import('pg')).default;
		const pool = new pg.Pool({ connectionString: url, max: 1 });
		query = () => pool.query('select 1');
		end = () => pool.end();
		break;
	}
	case 'pg-native': {
		const pg = (await import('pg')).default;
		const pool = new pg.native!.Pool({ connectionString: url, max: 1 });
		query = () => pool.query('select 1');
		end = () => pool.end();
		break;
	}
	case 'postgres.js': {
		const postgres = (await import('postgres')).default;
		const sql = postgres(url, { max: 1 });
		query = () => sql`select 1`;
		end = () => sql.end();
		break;
	}
	case 'neon': {
		const { Pool, neonConfig } = await import('@neondatabase/serverless');
		neonConfig.webSocketConstructor = (await import('ws')).default;
		neonConfig.wsProxy = (host: string, p: number | string) =>
			`127.0.0.1:59432/v1?address=${host}:${p}`;
		neonConfig.useSecureWebSocket = false;
		neonConfig.coalesceWrites = false;
		neonConfig.pipelineConnect = false;
		neonConfig.forceDisablePgSSL = true;
		const pool = new Pool({ connectionString: url, max: 1 });
		query = () => pool.query('select 1');
		end = () => pool.end();
		break;
	}
	default:
		query = async () => {};
		end = async () => {};
}
const imported = performance.now();
await query();
const firstQuery = performance.now();
console.log(
	JSON.stringify({
		driver,
		importMs: imported - t0,
		firstQueryMs: firstQuery - imported,
		sinceStartMs: firstQuery,
	}),
);
await end();
process.exit(0);
