import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts', 'src/driver/index.ts'],
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
