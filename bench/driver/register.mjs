// Lets Node run the TypeScript sources directly: they import siblings as
// `./x.js` (for the compiler's sake), which only exist as `./x.ts`.
import { register } from 'node:module';

register(
	`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
	try {
		return await next(specifier, context);
	} catch (error) {
		if (specifier.startsWith('.') && specifier.endsWith('.js')) {
			return next(specifier.slice(0, -3) + '.ts', context);
		}
		throw error;
	}
}`)}`,
);
