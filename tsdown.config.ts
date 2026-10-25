import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		'driver/index': 'src/driver/index.ts',
		cli: 'src/cli/main.ts',
	},
	format: ['esm'],
	platform: 'node',
	target: 'node24',
	fixedExtension: false,
	dts: false,
	clean: true,
	sourcemap: true,
	treeshake: true,
});
