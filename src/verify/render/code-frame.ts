import { readFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SourceLocation } from '../../call-site.js';
import { type Glyphs, link, type Paint, type Terminal } from './terminal.js';

/** Reads a source file, or `undefined` when it can't be read. */
export type ReadSource = (file: string) => string | undefined;

const cache = new Map<string, string | undefined>();

export const readSource: ReadSource = (file) => {
	if (!cache.has(file)) {
		try {
			cache.set(file, readFileSync(file, 'utf8'));
		} catch {
			cache.set(file, undefined);
		}
	}
	return cache.get(file);
};

/** A path as shown: relative to `cwd` when it is under it. */
export function displayPath(file: string, cwd: string): string {
	if (!isAbsolute(file)) return file;
	const path = relative(cwd, file);
	return path === '' || path.startsWith('..') || isAbsolute(path)
		? file
		: path.replaceAll('\\', '/');
}

/** `path:line:col`, linked to the file when the terminal shows links. */
export function locationText(
	location: SourceLocation,
	terminal: Terminal,
): string {
	const text = `${displayPath(location.file, terminal.cwd)}:${location.line}:${location.column}`;
	return isAbsolute(location.file)
		? link(terminal, pathToFileURL(location.file).href, text)
		: text;
}

const tabWidth = 4;

function expandTabs(line: string): string {
	return line.replaceAll('\t', ' '.repeat(tabWidth));
}

/** The visual column of the character at `index`, after expanding tabs. */
function visualColumn(line: string, index: number): number {
	return expandTabs(line.slice(0, index)).length;
}

/**
 * The part of `line` a diagnostic at `start` (a 0-based index) is about:
 * from a `key:` just before it, if any, to the end of the expression, which
 * ends at a `,` or `;` outside brackets. Without a key, as for a
 * `defineTable(...)` call, it also ends at the first argument's `,`.
 */
export function findSpan(
	line: string,
	start: number,
): { start: number; end: number } {
	const key = /(?:[\w$]+|'[^']*'|"[^"]*")\s*\??\s*:\s*$/.exec(
		line.slice(0, start),
	);
	const from = key ? key.index : start;
	const stopDepth = key ? 0 : 1;
	let depth = 0;
	let quote: string | undefined;
	let end = line.length;
	for (let i = start; i < line.length; i++) {
		const char = line[i];
		if (quote !== undefined) {
			if (char === '\\') i++;
			else if (char === quote) quote = undefined;
			continue;
		}
		if (char === "'" || char === '"' || char === '`') quote = char;
		else if (char === '(' || char === '[' || char === '{') depth++;
		else if (char === ')' || char === ']' || char === '}') {
			if (--depth < 0) {
				end = i;
				break;
			}
		} else if ((char === ',' || char === ';') && depth <= stopDepth) {
			end = i;
			break;
		} else if (char === '/' && line[i + 1] === '/') {
			end = i;
			break;
		}
	}
	while (end > from && /\s/.test(line[end - 1] ?? '')) end--;
	return { start: from, end: Math.max(end, from + 1) };
}

export interface FrameOptions {
	readonly location: SourceLocation;
	readonly label: string | undefined;
	/** The style of the underline and label. */
	readonly accent: Parameters<Paint>[0];
	readonly terminal: Terminal;
	readonly paint: Paint;
	readonly glyphs: Glyphs;
	readonly read: ReadSource;
}

/**
 * The lines of a code frame: the line `location` points at with one line of
 * context either side, a gutter of line numbers, and the expression there
 * underlined with `label`. `undefined` when the file can't be read.
 */
export function codeFrame(options: FrameOptions): string[] | undefined {
	const { location, label, accent, terminal, paint, glyphs } = options;
	const source = options.read(location.file);
	if (source === undefined) return undefined;
	const lines = source.split(/\r?\n/);
	const target = lines[location.line - 1];
	if (target === undefined) return undefined;

	const first = Math.max(1, location.line - 1);
	const last = Math.min(lines.length, location.line + 1);
	const shown: { number: number; text: string }[] = [];
	for (let number = first; number <= last; number++) {
		const text = lines[number - 1] ?? '';
		if (number !== location.line && text.trim() === '') continue;
		shown.push({ number, text: expandTabs(text) });
	}
	const indent = Math.min(
		...shown.map(({ text }) => text.length - text.trimStart().length),
	);

	const span = findSpan(target, Math.min(location.column - 1, target.length));
	const spanStart = visualColumn(target, span.start) - indent;
	const spanEnd = visualColumn(target, span.end) - indent;

	const gutter = String(last).length;
	const pad = ' '.repeat(gutter);
	const available = Math.max(20, terminal.width - gutter - 3);
	const clip = (text: string, room = available) =>
		text.length > room
			? `${text.slice(0, Math.max(0, room - glyphs.ellipsis.length))}${glyphs.ellipsis}`
			: text;
	const bar = paint('dim', glyphs.bar);
	const dots = paint('dim', glyphs.dots);

	const out = [
		`${pad} ${paint('dim', glyphs.frameStart)}${locationText(location, terminal)}${paint('dim', ']')}`,
	];
	for (const { number, text } of shown) {
		const numberText = String(number).padStart(gutter);
		out.push(
			`${paint('dim', numberText)} ${bar} ${clip(text.slice(indent)).trimEnd()}`,
		);
		if (number !== location.line) continue;

		const start = Math.min(spanStart, available - 1);
		const width = Math.max(1, Math.min(spanEnd, available) - start);
		if (label === undefined) {
			out.push(
				`${pad} ${dots} ${' '.repeat(start)}${paint(accent, glyphs.underline.repeat(width))}`,
			);
			continue;
		}
		const room = available - glyphs.labelStart.length - 1;
		let anchor = Math.floor((width - 1) / 2);
		if (start + anchor + label.length > room) anchor = 0;
		const underline =
			glyphs.underline.repeat(anchor) +
			glyphs.anchor +
			glyphs.underline.repeat(width - anchor - 1);
		const labelText = clip(
			`${glyphs.labelStart} ${label}`,
			available - start - anchor,
		);
		out.push(
			`${pad} ${dots} ${' '.repeat(start)}${paint(accent, underline)}`,
			`${pad} ${dots} ${' '.repeat(start + anchor)}${paint(accent, labelText)}`,
		);
	}
	out.push(`${pad} ${paint('dim', glyphs.frameEnd)}`);
	return out;
}
