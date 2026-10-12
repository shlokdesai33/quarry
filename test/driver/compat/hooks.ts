// Module hooks for the compatibility runs (loaded with `node --import`, in
// every child process through NODE_OPTIONS):
// - quarry's sources import siblings as `./x.js`, which only exist as `./x.ts`;
// - upstream test files import their library, which is redirected to the
//   shim standing in for it (`QUARRY_COMPAT_REDIRECTS`: a JSON map from the
//   library file's absolute path to the shim's).
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const redirects: Record<string, string> = JSON.parse(
	process.env['QUARRY_COMPAT_REDIRECTS'] ?? '{}',
);

type Resolved = ReturnType<Parameters<typeof registerHooks>[0]['resolve'] & {}>;

registerHooks({
	resolve(specifier, context, next): Resolved {
		let resolved: Resolved;
		try {
			resolved = next(specifier, context);
		} catch (error) {
			if (!specifier.startsWith('.')) throw error;
			const candidates = specifier.endsWith('.js')
				? [`${specifier.slice(0, -3)}.ts`]
				: [`${specifier}.ts`, `${specifier}/index.ts`, `${specifier}/index.js`];
			let found: Resolved | undefined;
			for (const candidate of candidates) {
				try {
					found = next(candidate, context);
					break;
				} catch {
					// try the next candidate
				}
			}
			if (found === undefined) throw error;
			resolved = found;
		}
		if (resolved.url.startsWith('file:')) {
			const target = redirects[fileURLToPath(resolved.url)];
			if (target !== undefined)
				return { url: pathToFileURL(target).href, shortCircuit: true };
		}
		return resolved;
	},
});
