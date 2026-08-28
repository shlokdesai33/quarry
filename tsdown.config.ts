import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	platform: 'neutral',
	target: 'node22',
	dts: false,
	clean: true,
	sourcemap: true,
	treeshake: true,
});
