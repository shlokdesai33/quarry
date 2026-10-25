/** A position in a source file. `line` and `column` count from 1. */
export interface SourceLocation {
	/** A path, or a URL such as `file:///app/schema.ts`. */
	readonly file: string;
	readonly line: number;
	readonly column: number;
}

/**
 * A captured call site. Only the stack's frames are captured when it is
 * made; V8 formats them into `stack`, applying source maps when they are
 * enabled, the first time it is read.
 */
export type CallSite = { readonly stack?: unknown };

/**
 * Captures where `fn` was called from, for diagnostics that point at the
 * definition, or `undefined` on engines without `Error.captureStackTrace`.
 * A single frame is captured, so the cost is about a microsecond.
 */
export function captureCallSite(
	fn: (...args: never[]) => unknown,
): CallSite | undefined {
	if (typeof Error.captureStackTrace !== 'function') return undefined;
	const site = {};
	const limit = Error.stackTraceLimit;
	Error.stackTraceLimit = 1;
	try {
		Error.captureStackTrace(site, fn);
	} finally {
		Error.stackTraceLimit = limit;
	}
	return site;
}

/**
 * The location a call site points at, read from its first frame, e.g.
 * `at Object.<anonymous> (/app/schema.ts:3:9)` or `at file:///app/schema.ts:3:9`.
 * On Node, a `file:` URL becomes a path, and a position in a compiled file
 * with a source map Node has loaded is mapped back to its source.
 */
export function resolveCallSite(
	site: CallSite | undefined,
): SourceLocation | undefined {
	if (typeof site?.stack !== 'string') return undefined;
	for (const text of site.stack.split('\n')) {
		const frame = text.trim();
		if (!frame.startsWith('at ')) continue;
		const match =
			/\((.+):(\d+):(\d+)\)$/.exec(frame) ??
			/^at (?:async )?(.+):(\d+):(\d+)$/.exec(frame);
		if (!match) return undefined;
		const [, file = '', line = '0', column = '0'] = match;
		return toPath(
			mapSource({ file, line: Number(line), column: Number(column) }),
		);
	}
	return undefined;
}

function mapSource(location: SourceLocation): SourceLocation {
	const map = process
		.getBuiltinModule('node:module')
		.findSourceMap(location.file);
	if (map === undefined) return location;
	const origin = map.findOrigin(location.line, location.column);
	return 'fileName' in origin
		? {
				file: origin.fileName,
				line: origin.lineNumber,
				column: origin.columnNumber,
			}
		: location;
}

function toPath(location: SourceLocation): SourceLocation {
	if (!location.file.startsWith('file:')) return location;
	try {
		return {
			...location,
			file: process.getBuiltinModule('node:url').fileURLToPath(location.file),
		};
	} catch {
		return location;
	}
}
