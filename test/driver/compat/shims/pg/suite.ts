// Stands in for node-postgres's test/suite.js: runs a file's tests in
// order, like the original, but records every outcome and carries on after
// a failure instead of exiting. The tests' helper exits the process on any
// uncaught exception; while a test runs, that exit fails the test instead.
import { describeError, record } from '../results.js';

const suite = process.env['QUARRY_COMPAT_SUITE'] ?? 'pg';
const file = process.env['QUARRY_COMPAT_FILE'] ?? process.argv[1] ?? '';

type Action =
	| ((this: Test, done: (error?: unknown) => void) => unknown)
	| undefined;

let current: { fail: (error: unknown) => void } | undefined;
let uncaught: unknown;
// registered before the helper's own handler, which then calls process.exit
process.on('uncaughtException', (error) => {
	uncaught = error;
});
const exit = process.exit.bind(process);
process.exit = ((code?: number) => {
	if (current !== undefined && code === 255) {
		current.fail(uncaught ?? new Error('uncaught exception'));
		return undefined as never;
	}
	return exit(code);
}) as typeof process.exit;

class Test {
	timeout = 5000;
	readonly name: string;
	readonly action: Action;

	constructor(name: string, action: Action) {
		this.name = name;
		this.action = action;
	}

	run(): Promise<void> {
		const action = this.action;
		if (!action) return Promise.resolve();
		return new Promise<void>((resolve, reject) => {
			let settled = false;
			// a little longer than the helper's 5s assert.calls, so its failure lands on this test
			const timer = setTimeout(
				() => finish(new Error(`did not complete within ${this.timeout}ms`)),
				this.timeout + 1000,
			);
			const finish = (error?: unknown) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				current = undefined;
				if (error)
					reject(error instanceof Error ? error : new Error(String(error)));
				else resolve();
			};
			current = { fail: finish };
			try {
				if (action.length === 0) {
					const result: any = action.call(this, finish);
					if (result && typeof result.then === 'function') {
						result.then(
							() => finish(),
							(error: unknown) =>
								finish(error ?? new Error('Unhandled promise rejection')),
						);
					} else {
						finish();
					}
				} else {
					action.call(this, finish);
				}
			} catch (error) {
				finish(error);
			}
		});
	}
}

class Suite {
	#chain: Promise<void> = Promise.resolve();

	test(name: string, action: Action): void {
		const test = new Test(name, action);
		this.#chain = this.#chain.then(async () => {
			if (!test.action) {
				record({ suite, file, name, outcome: 'skip' });
				return;
			}
			record({ suite, file, name, outcome: 'start' });
			try {
				await test.run();
				record({ suite, file, name, outcome: 'pass' });
			} catch (error) {
				record({
					suite,
					file,
					name,
					outcome: 'fail',
					error: describeError(error),
				});
			}
		});
	}

	testAsync(name: string, action: Action): void {
		this.test(name, action);
	}
}

export default Suite;
export { Suite as 'module.exports' };
