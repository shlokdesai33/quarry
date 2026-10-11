import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					include: ['test/**/*.test.ts'],
					exclude: ['test/driver/integration/**'],
					typecheck: {
						include: ['test/**/*.test-d.ts'],
						tsconfig: './tsconfig.json',
					},
				},
			},
			{
				// runs against a throwaway PostgreSQL cluster, skipped when
				// PostgreSQL isn't installed (or QUARRY_SKIP_PG is set)
				extends: true,
				test: {
					name: 'driver',
					include: ['test/driver/integration/**/*.test.ts'],
					globalSetup: ['test/driver/setup/global-setup.ts'],
					testTimeout: 30_000,
					hookTimeout: 30_000,
				},
			},
		],
	},
});
