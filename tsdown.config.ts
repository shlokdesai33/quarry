import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: { index: 'src/index.ts', cli: 'src/cli/main.ts' },
	format: ['esm'],
	platform: 'neutral',
	target: 'node22',
	dts: false,
	clean: true,
	sourcemap: true,
	treeshake: true,
});
