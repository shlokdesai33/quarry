import { describe, expect, it } from 'vitest';

describe('the package entry point', () => {
	it('imports without side effects and exports the public API', async () => {
		const quarry = await import('../src/index.js');
		for (const name of [
			'defineTable',
			'defineEnum',
			'database',
			'selectFrom',
			'fragment',
			'insertInto',
			'update',
			'updateMany',
			'deleteFrom',
			'compile',
			'expressionBuilder',
			'integer',
			'text',
			'array',
			'NoRowError',
			'TooManyRowsError',
		]) {
			expect(typeof Reflect.get(quarry, name), name).toBe('function');
		}
	});
});
