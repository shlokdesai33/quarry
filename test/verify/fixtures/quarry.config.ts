import { Pool } from 'pg';
import { database } from '../../../src/database.js';
import { defineConfig } from '../../../src/cli/config.js';
import * as schema from './schema.js';

// the CLI tests set QUARRY_VERIFY_CONFIG_POOL to the test database's pool
// options, and import this module once for several runs
let pool: Pool | undefined;

export default defineConfig({
	db: database({
		execute: async ({ sql, params }) => {
			pool ??= new Pool(
				JSON.parse(process.env['QUARRY_VERIFY_CONFIG_POOL'] ?? '{}'),
			);
			return { rows: (await pool.query(sql, [...params])).rows };
		},
	}),
	schema,
	close: async () => {
		await pool?.end();
		pool = undefined;
	},
});
