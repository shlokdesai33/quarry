import { describe, expect, it } from 'vitest';

describe('the package entry point', () => {
	it('imports without side effects and exports the public API', async () => {
		const quarry = await import('../src/index.js');
		for (const name of [
			'defineTable',
			'defineEnum',
			'database',
			'createPool',
			'RowCountError',
			'UniqueViolation',
			'QueryCanceled',
			'selectFrom',
			'fragment',
			'insertInto',
			'update',
			'deleteFrom',
			'inc',
			'dec',
			'formatVerifyReport',
			'defineConfig',
			'compile',
			'expressionBuilder',
			'integer',
			'text',
			'array',
			'NoRowError',
			'TooManyRowsError',
			'violatedColumns',
			'UndefinedParameterError',
			'DecodeError',
		]) {
			expect(typeof Reflect.get(quarry, name), name).toBe('function');
		}
	});
});
