import { defineConfig } from '../../../src/cli/config.js';
import { database, type Database } from '../../../src/database.js';
import * as schema from './schema.js';

// the CLI tests set QUARRY_VERIFY_CONFIG_POOL to the test database's
// connection options, and import this module once for several runs
let db: Database | undefined;

export default defineConfig({
	get db() {
		db ??= database(
			JSON.parse(process.env['QUARRY_VERIFY_CONFIG_POOL'] ?? '{}'),
		);
		return db;
	},
	schema,
	close: async () => {
		await db?.close();
		db = undefined;
	},
});
