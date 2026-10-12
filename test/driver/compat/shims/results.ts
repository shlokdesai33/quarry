// Where upstream test runners (as replaced by the shims) record outcomes:
// one JSON object per line in QUARRY_COMPAT_RESULTS.
import { appendFileSync } from 'node:fs';
import { inspect } from 'node:util';

export type Outcome = 'start' | 'pass' | 'fail' | 'skip';

export interface ResultLine {
	readonly suite: string;
	readonly file: string;
	readonly name: string;
	readonly outcome: Outcome;
	readonly error?: string;
}

export function record(line: ResultLine): void {
	const out = process.env['QUARRY_COMPAT_RESULTS'];
	if (out) appendFileSync(out, `${JSON.stringify(line)}\n`);
}

export function describeError(error: unknown): string {
	if (error instanceof Error) {
		const lines = (error.stack ?? `${error.name}: ${error.message}`).split(
			'\n',
		);
		return lines.slice(0, 8).join('\n');
	}
	return inspect(error, { depth: 3 });
}
