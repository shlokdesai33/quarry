/**
 * Generates the type benchmark's workload: `tables` tables with a column of
 * every kind, and per table a file of comparisons, functions and a query
 * built with `selectFrom`. Each variant is a source tree of the library
 * compiled against the same workload, so two designs are compared on
 * identical code.
 *
 * A variant is `src` (this repo's `src`) or `name=path` for another source
 * tree, e.g. a copy of `src` with a design change applied:
 *
 *   --variants src,single=bench/types/variants/single-data-type/src
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, '..', '..');
export const out = join(here, '.generated');

export interface Variant {
	readonly name: string;
	/** absolute path of the variant's source tree */
	readonly src: string;
}

/** The variants in a comma-separated list, e.g. from `--variants`. */
export function parseVariants(list: string): Variant[] {
	return list.split(',').map((entry) => {
		const [name, path = name] = entry.split('=') as [string, string?];
		return { name, src: isAbsolute(path) ? path : join(root, path) };
	});
}

// ---------------------------------------------------------------------------
// Column kinds
// ---------------------------------------------------------------------------

interface Kind {
	readonly name: string;
	/** how a table declares a column of this kind */
	readonly declare: string;
	/** a valid `=` operand; absent when the type has no `=` */
	readonly eq?: string;
	/** a type-specific comparison: operator and operand */
	readonly extra: readonly [string, string];
	/** has the text operators and functions */
	readonly text?: boolean;
	/** has an ordering, so `min`, `max`, `<` and `between` */
	readonly ordered?: boolean;
}

export const KINDS: readonly Kind[] = [
	{
		name: 'text',
		declare: 'text()',
		eq: "'x'",
		extra: ['like', "'%x%'"],
		text: true,
		ordered: true,
	},
	{
		name: 'varchar',
		declare: 'varchar()',
		eq: "'x'",
		extra: ['ilike', "'%x%'"],
		text: true,
		ordered: true,
	},
	{
		name: 'smallint',
		declare: 'smallint()',
		eq: '1',
		extra: ['>', '1'],
		ordered: true,
	},
	{
		name: 'integer',
		declare: 'integer()',
		eq: '1',
		extra: ['>', '1'],
		ordered: true,
	},
	{
		name: 'bigint',
		declare: 'bigint()',
		eq: "'1'",
		extra: ['>', "'1'"],
		ordered: true,
	},
	{
		name: 'real',
		declare: 'real()',
		eq: '1',
		extra: ['between', '[1, 2]'],
		ordered: true,
	},
	{
		name: 'doublePrecision',
		declare: 'doublePrecision()',
		eq: '1',
		extra: ['between', '[1, 2]'],
		ordered: true,
	},
	{
		name: 'decimal',
		declare: 'decimal()',
		eq: "'1.5'",
		extra: ['<', "'2'"],
		ordered: true,
	},
	{ name: 'boolean', declare: 'boolean()', eq: 'true', extra: ['is', 'false'] },
	{ name: 'uuid', declare: 'uuid()', eq: "'x'", extra: ['in', "['x', 'y']"] },
	{
		name: 'bytea',
		declare: 'bytea()',
		eq: 'new Uint8Array()',
		extra: ['<>', 'new Uint8Array()'],
	},
	{
		name: 'date',
		declare: 'date()',
		eq: "'2020-01-01'",
		extra: ['between', "['2020-01-01', '2020-12-31']"],
		ordered: true,
	},
	{
		name: 'time',
		declare: 'time()',
		eq: "'12:00'",
		extra: ['>=', "'09:00'"],
		ordered: true,
	},
	{
		name: 'timestamp',
		declare: 'timestamp()',
		eq: "'2020-01-01 00:00'",
		extra: ['<=', "'2021-01-01 00:00'"],
		ordered: true,
	},
	{
		name: 'timestamptz',
		declare: 'timestamptz()',
		eq: 'new Date()',
		extra: ['between', '[new Date(), new Date()]'],
		ordered: true,
	},
	{
		name: 'interval',
		declare: 'interval()',
		eq: "'1 day'",
		extra: ['<', "'2 days'"],
		ordered: true,
	},
	{
		name: 'jsonb',
		declare: 'jsonb<{ a: number }>()',
		eq: '{ a: 1 }',
		extra: ['@>', '{ a: 1 }'],
	},
	{
		name: 'inet',
		declare: 'inet()',
		eq: "'10.0.0.1'",
		extra: ['<<', "'10.0.0.0/8'"],
		ordered: true,
	},
	{ name: 'tsvector', declare: 'tsvector()', extra: ['@@', "'fat & rat'"] },
	{
		name: 'daterange',
		declare: 'daterange()',
		eq: '{ empty: true }',
		extra: ['@>', "'2020-01-01'"],
	},
	{
		name: 'tstzrange',
		declare: 'tstzrange()',
		eq: '{ empty: true }',
		extra: ['&&', '{ empty: true }'],
	},
	{ name: 'vector', declare: 'vector()', extra: ['is not', 'null'] },
	{ name: 'enum', declare: 'status()', eq: "'a'", extra: ['in', "['a', 'b']"] },
	{
		name: 'array',
		declare: 'array(text())',
		eq: "['x']",
		extra: ['&&', "['x']"],
	},
];

/** The factories the workload imports: every kind's, and `array`'s element. */
const FACTORIES = [
	...new Set([
		'integer',
		...KINDS.filter(
			(kind) => kind.name !== 'enum' && kind.name !== 'array',
		).map((kind) => kind.name),
		'array',
	]),
];

// ---------------------------------------------------------------------------
// Workload: identical for every variant
// ---------------------------------------------------------------------------

/** The kind of column `c{k}` of table `t{i}`: rotated so every kind appears. */
const kindAt = (i: number, k: number) => KINDS[(k + i) % KINDS.length]!;

/** The column of table `t{j}` with the given kind. */
export const columnOf = (j: number, kind: Kind) => {
	const index = KINDS.indexOf(kind);
	return (index - (j % KINDS.length) + KINDS.length) % KINDS.length;
};

const TEXT = KINDS[0]!;

function tableFile(i: number) {
	const columns = KINDS.map((_, k) => {
		let declaration = kindAt(i, k).declare;
		if (k % 5 === 0) {
			declaration += `.name('col_${k}')`;
		}
		if (k % 3 === 1) {
			declaration += '.nullable()';
		}
		if (k % 4 === 2) {
			declaration += '.default()';
		}
		return `\t\tc${k}: ${declaration},`;
	});
	return `import { defineTable, ${FACTORIES.join(', ')} } from './lib.js';
import { status } from './enums.js';

export const t${i} = defineTable('t${i}', {
	columns: {
		id: integer().identity(),
${columns.join('\n')}
	},
});
`;
}

/** Comparisons, functions and a `selectFrom` query over `t{i}` and `t{j}`. */
export function queryFile(i: number, tables: number) {
	const j = (i + 1) % tables;
	const comparisons: string[] = [];
	const conditions: string[] = [];

	KINDS.forEach((_, k) => {
		const kind = kindAt(i, k);
		const col = `'t${i}.c${k}'`;
		const other = `'t${j}.c${columnOf(j, kind)}'`;
		const [op, operand] = kind.extra;

		comparisons.push(
			`eb(${col}, '${op}', ${operand}),`,
			`eb(${col}, 'is', null),`,
		);
		if (kind.eq) {
			comparisons.push(`eb(${col}, '=', ${kind.eq}),`);
			if (k % 2 === 0) {
				comparisons.push(`eb(${col}, '=', eb.ref(${other})),`);
			} else {
				comparisons.push(`eb(eb.ref(${col}), '=', ${kind.eq}),`);
			}
			if (k % 3 === 0) {
				comparisons.push(
					`eb(eb.fn.coalesce(${col}, eb.val(${kind.eq})), '=', ${kind.eq}),`,
				);
			}
			if (k % 5 === 0) {
				comparisons.push(`eb(${col}, 'in', [${kind.eq}, eb.ref(${other})]),`);
			}
		}
		if (kind.text) {
			comparisons.push(
				`eb(eb.fn.lower(${col}), 'like', '%x%'),`,
				`eb(eb.fn.length(${col}), '>', 3),`,
			);
		}
		if (kind.ordered && kind.eq) {
			comparisons.push(`eb(eb.fn.max(${col}), '>', ${kind.eq}),`);
			if (k % 5 === 1) {
				comparisons.push(
					`eb(${col}, 'between', [eb.ref(${other}), ${kind.eq}]),`,
				);
			}
		}

		if (kind.eq && k < 8) {
			const method = k % 3 === 2 ? 'orWhere' : 'where';
			conditions.push(`.${method}(${col}, '=', ${kind.eq})`);
		}
	});

	const textOfI = `'t${i}.c${columnOf(i, TEXT)}'`;
	const textOfJ = `'t${j}.c${columnOf(j, TEXT)}'`;

	return `import { expressionBuilder, selectFrom } from './lib.js';
import { t${i} } from './t${i}.js';
import { t${j} } from './t${j}.js';

const eb = expressionBuilder(t${i}, t${j});

export const q${i} = [
	${comparisons.join('\n\t')}
	eb.and([eb('t${i}.id', '>', 1), eb('t${i}.c0', 'is', null)]),
	eb(eb.fn.count(), '>', '5'),
	// @ts-expect-error integers have no pattern operators
	eb('t${i}.id', 'like', '1%'),
	// @ts-expect-error lower takes text
	eb.fn.lower('t${i}.id'),
	// @ts-expect-error wrong value type
	eb('t${i}.id', '=', 'x'),
	// @ts-expect-error a text column is not an integer one
	eb('t${i}.id', '=', eb.ref(${textOfJ})),
];

export const s${i} = selectFrom(t${i})
	.innerJoin(t${j})
	.on(${textOfJ}, '=', ${textOfI})
	${conditions.join('\n\t')}
	.orWhere((q) =>
		q.where('t${j}.id', '>', q.ref('t${i}.id')).orWhere(${textOfJ}, 'is', null),
	)
	.select(['t${i}.id', ${textOfJ}]);

export const s${i}Bad = selectFrom(t${i})
	.innerJoin(t${j})
	// @ts-expect-error the left-hand side is a column of the joined table
	.on('t${i}.id', '=', 't${j}.id');
`;
}

const tsconfig = JSON.stringify(
	{
		compilerOptions: {
			module: 'nodenext',
			moduleResolution: 'nodenext',
			verbatimModuleSyntax: true,
			isolatedModules: true,
			erasableSyntaxOnly: true,
			target: 'es2024',
			lib: ['es2024'],
			types: [],
			strict: true,
			noEmit: true,
			noUncheckedIndexedAccess: true,
			exactOptionalPropertyTypes: true,
			noImplicitOverride: true,
			noImplicitReturns: true,
			skipLibCheck: true,
		},
		include: ['*.ts'],
	},
	null,
	'\t',
);

/** The variant's library, re-exported under the names the workload uses. */
function library(variant: Variant, dir: string) {
	const src = relative(dir, variant.src);
	return `export { ${FACTORIES.join(', ')} } from '${src}/column-factories.js';
export { defineEnum } from '${src}/define-enum.js';
export { defineTable } from '${src}/define-table.js';
export { expressionBuilder } from '${src}/expression-builder.js';
export { selectFrom } from '${src}/select-query-builder.js';
`;
}

/** Writes the variant with `tables` tables into `base`, returning its directory. */
export function generate(variant: Variant, tables: number, base = out) {
	const dir = join(base, `tables-${tables}`, variant.name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'tsconfig.json'), tsconfig);
	writeFileSync(join(dir, 'lib.ts'), library(variant, dir));
	writeFileSync(
		join(dir, 'enums.ts'),
		`import { defineEnum } from './lib.js';\n\nexport const status = defineEnum('status', ['a', 'b']);\n`,
	);
	for (let i = 0; i < tables; i++) {
		writeFileSync(join(dir, `t${i}.ts`), tableFile(i));
		writeFileSync(join(dir, `q${i}.ts`), queryFile(i, tables));
	}
	return dir;
}
