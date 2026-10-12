// Stands in for postgres.js's tests/test.js: runs tests one after another,
// as the original does, but records every outcome and carries on after a
// failure (the original skips everything after the first one).
import util from 'node:util';
import { describeError, record } from '../results.js';

const suite = process.env['QUARRY_COMPAT_SUITE'] ?? 'postgres';
const file = process.env['QUARRY_COMPAT_FILE'] ?? 'tests/index.js';

/** QUARRY_COMPAT_ONLY: run only the tests whose names match, to debug them in place. */
const only = process.env['QUARRY_COMPAT_ONLY']
	? new RegExp(process.env['QUARRY_COMPAT_ONLY'])
	: undefined;
let chain: Promise<void> = Promise.resolve();
let registered = 0;
let finished = 0;
const names = new Map<string, number>();

/** Names are unique per test (postgres.js has a few duplicates), so outcomes can be matched. */
function unique(name: string): string {
	const seen = names.get(name) ?? 0;
	names.set(name, seen + 1);
	return seen === 0 ? name : `${name} (${seen + 1})`;
}

function finish(): void {
	finished++;
	if (finished !== registered) return;
	// let late registrations (each test registers after `await 1`) land first
	setTimeout(() => {
		if (finished === registered) process.exit(0);
	}, 200);
}

async function test(
	name: string,
	options: any,
	fn?: () => unknown,
): Promise<void> {
	if (typeof options !== 'object') {
		fn = options;
		options = {};
	}
	// as the original: tests register a tick later
	await Promise.resolve();
	const label = unique(name);
	if (only !== undefined && !only.test(label)) return;
	registered++;
	chain = chain.then(async () => {
		record({ suite, file, name: label, outcome: 'start' });
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const x: any = await Promise.race([
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error('Timed out')),
						(options.timeout || t.timeout) * 1000,
					);
				}),
				(fn as () => unknown)(),
			]);
			if (!Array.isArray(x)) throw new Error('Test should return result array');
			const [expected, got] = await Promise.all(x);
			if (expected !== got)
				throw new Error(`${util.inspect(expected)} != ${util.inspect(got)}`);
			record({ suite, file, name: label, outcome: 'pass' });
		} catch (error) {
			record({
				suite,
				file,
				name: label,
				outcome: 'fail',
				error: describeError(error),
			});
		} finally {
			clearTimeout(timer);
			finish();
		}
	});
}

export const t: any = (...rest: [string, any, any?]) => test(...rest);
t.timeout = 5;
export const nt = (name: string) => {
	record({ suite, file, name: unique(name), outcome: 'skip' });
};
export const ot = t;
