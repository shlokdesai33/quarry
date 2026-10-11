import { styleText } from 'node:util';

/** What the terminal a report is written to supports. */
export interface Terminal {
	/** ANSI colours and styles. */
	readonly color: boolean;
	/** Box-drawing characters and symbols; ASCII otherwise. */
	readonly unicode: boolean;
	/** OSC 8 links on file paths. */
	readonly hyperlinks: boolean;
	/** Columns to wrap and truncate at. */
	readonly width: number;
	/** Paths under this directory are shown relative to it. */
	readonly cwd: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** The output stream's properties `detectTerminal` reads. */
export interface OutputStream {
	readonly isTTY?: boolean | undefined;
	readonly columns?: number | undefined;
}

/**
 * What `stream` supports: colour only on a TTY, unless `FORCE_COLOR` is set
 * (`0` or `false` turns it off) or `NO_COLOR` is, which `FORCE_COLOR`
 * overrides as it does for Node itself; ASCII on terminals known to lack
 * the box-drawing glyphs; links when colour is on, unless
 * `FORCE_HYPERLINK=0`; and the stream's width, or `COLUMNS`.
 */
export function detectTerminal(
	stream: OutputStream,
	env: Env = process.env,
	platform: string = process.platform,
): Terminal {
	const tty = stream.isTTY === true && env['TERM'] !== 'dumb';
	const force = env['FORCE_COLOR'];
	const color =
		force !== undefined
			? force !== '0' && force !== 'false'
			: !env['NO_COLOR'] && tty;
	const hyperlink = env['FORCE_HYPERLINK'];
	const hyperlinks =
		hyperlink !== undefined
			? hyperlink !== '0' && hyperlink !== 'false'
			: color && tty && env['CI'] === undefined;
	const columns = Number(env['COLUMNS']);
	return {
		color,
		unicode: supportsUnicode(env, platform),
		hyperlinks,
		width:
			stream.columns ??
			(Number.isFinite(columns) && columns > 0 ? columns : 80),
		cwd: process.cwd(),
	};
}

function supportsUnicode(env: Env, platform: string): boolean {
	if (env['QUARRY_ASCII'] !== undefined) return env['QUARRY_ASCII'] === '0';
	if (platform !== 'win32') return env['TERM'] !== 'linux';
	return (
		env['WT_SESSION'] !== undefined ||
		env['TERM_PROGRAM'] === 'vscode' ||
		env['TERMINAL_EMULATOR'] === 'JetBrains-JediTerm' ||
		env['CI'] !== undefined
	);
}

type Format = Parameters<typeof styleText>[0];

/** Styles text when the terminal has colour. */
export type Paint = (format: Format & string, text: string) => string;

export function painter(terminal: Terminal): Paint {
	return terminal.color
		? (format, text) =>
				text === '' ? text : styleText(format, text, { validateStream: false })
		: (_, text) => text;
}

/** The glyphs of the frame, in Unicode or ASCII. */
export interface Glyphs {
	readonly error: string;
	readonly warning: string;
	readonly info: string;
	readonly ok: string;
	readonly failed: string;
	readonly frameStart: string;
	readonly frameEnd: string;
	readonly bar: string;
	readonly dots: string;
	readonly underline: string;
	readonly anchor: string;
	readonly labelStart: string;
	readonly ellipsis: string;
	readonly separator: string;
}

export function glyphs(terminal: Terminal): Glyphs {
	return terminal.unicode
		? {
				error: '×',
				warning: '⚠',
				info: 'ℹ',
				ok: '✔',
				failed: '✖',
				frameStart: '╭─[',
				frameEnd: '╰────',
				bar: '│',
				dots: '·',
				underline: '─',
				anchor: '┬',
				labelStart: '╰──',
				ellipsis: '…',
				separator: '·',
			}
		: {
				error: 'x',
				warning: '!',
				info: 'i',
				ok: 'v',
				failed: 'x',
				frameStart: ',-[',
				frameEnd: '`----',
				bar: '|',
				dots: ':',
				underline: '-',
				anchor: '+',
				labelStart: '`--',
				ellipsis: '...',
				separator: '-',
			};
}

/** `text` as an OSC 8 link to `url`, when the terminal shows links. */
export function link(terminal: Terminal, url: string, text: string): string {
	return terminal.hyperlinks
		? `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`
		: text;
}

/**
 * Wraps `text` at word boundaries to `width` columns, continuing lines with
 * `indent`; the first line has `first` columns, for text after a prefix.
 * Words longer than a line are left whole.
 */
export function wrap(
	text: string,
	width: number,
	indent = '',
	first = width,
): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(' ')) {
		const next = line === '' ? word : `${line} ${word}`;
		const limit = lines.length === 0 ? first : width - indent.length;
		if (next.length > limit && line !== '') {
			lines.push(line);
			line = word;
		} else {
			line = next;
		}
	}
	lines.push(line);
	return lines.map((part, i) => (i === 0 ? part : `${indent}${part}`));
}
