import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		typecheck: {
			enabled: true,
			include: ['test/types/**/*.test-d.ts'],
			tsconfig: './tsconfig.json',
		},
	},
});
