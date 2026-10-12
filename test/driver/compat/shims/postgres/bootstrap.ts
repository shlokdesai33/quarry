// Stands in for postgres.js's tests/bootstrap.js. The compatibility
// cluster already has the roles; like the original, this recreates the
// test database, and provides `exec`, running psql (and friends) from the
// cluster's binaries against it directly, never through PgBouncer.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const bin = process.env['QUARRY_COMPAT_BIN'] ?? '';

export function exec(cmd: string, args: string[]): void {
	const { stderr } = spawnSync(join(bin, cmd), args, {
		stdio: 'pipe',
		encoding: 'utf8',
		env: {
			...process.env,
			PGHOST: process.env['PGSOCKET'],
			PGPORT: process.env['QUARRY_COMPAT_DIRECT_PORT'],
		},
	});
	if (
		stderr &&
		!stderr.includes('already exists') &&
		!stderr.includes('does not exist') &&
		!stderr.includes('WARNING:')
	)
		throw stderr;
}

exec('dropdb', ['--force', 'postgres_js_test']);
exec('createdb', [
	'-T',
	'template0',
	'-O',
	'postgres_js_test',
	'postgres_js_test',
]);
exec('psql', [
	'-c',
	'grant all on database postgres_js_test to postgres_js_test',
]);
