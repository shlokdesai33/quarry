import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		// starts a throwaway PostgreSQL cluster for test/driver/integration;
		// those tests are skipped when PostgreSQL isn't installed (or
		// QUARRY_SKIP_PG is set)
		globalSetup: ['test/driver/setup/global-setup.ts'],
		testTimeout: 30_000,
		hookTimeout: 30_000,
		typecheck: {
			include: ['test/**/*.test-d.ts'],
			tsconfig: './tsconfig.json',
		},
	},
});
