import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		'driver/index': 'src/driver/index.ts',
		cli: 'src/cli/main.ts',
	},
	format: ['esm'],
	platform: 'neutral',
	target: 'node22',
	dts: false,
	clean: true,
	sourcemap: true,
	treeshake: true,
	// the driver loads Node built-ins lazily, only when running on Node
	deps: { neverBundle: [/^node:/] },
});
