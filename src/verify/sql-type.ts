import type { DataType } from '../data-type/data-type.js';
import { ArrayType } from '../data-type/array.js';
import { CustomType } from '../data-type/custom.js';
import { EnumType } from '../data-type/enum.js';
import type { Kind } from '../operators.js';
import { quoteIdentifier } from './sql.js';

/**
 * A SQL type as both sides are compared in: the code's `DataType` and the
 * database's `pg_type`, after resolving domains to their base type.
 */
export interface SqlType {
	/**
	 * The canonical name of the element type, as it is written in DDL:
	 * `integer`, `varchar`, `numeric`, `timestamptz`, an enum's name, or the
	 * server's `format_type` for types quarry doesn't know.
	 */
	readonly name: string;
	/** Whether it is an enum, so `name` is the enum's. */
	readonly isEnum: boolean;
	/**
	 * The modifiers, e.g. `[255]` for `varchar(255)`, or `undefined` for
	 * none; in the code, none means any is accepted.
	 */
	readonly modifiers: readonly number[] | undefined;
	readonly array: boolean;
}

/** The DDL names of the kinds that aren't spelled the same in DDL. */
const kindNames: Partial<Record<Kind, string>> = { decimal: 'numeric' };

/** The type a `DataType` declares. */
export function codeType(dataType: DataType): SqlType {
	if (dataType instanceof ArrayType) {
		return { ...codeType(dataType.element), array: true };
	}
	if (dataType instanceof CustomType) {
		return {
			name: dataType.sqlName,
			isEnum: false,
			modifiers: dataType.modifiers,
			array: false,
		};
	}
	if (dataType instanceof EnumType) {
		return {
			name: dataType.enumName,
			isEnum: true,
			modifiers: undefined,
			array: false,
		};
	}
	const name = kindNames[dataType.kind] ?? dataType.kind;
	const modifiers =
		// numeric(p) is numeric(p, 0), as postgres records it
		name === 'numeric' && dataType.modifiers?.length === 1
			? [...dataType.modifiers, 0]
			: dataType.modifiers;
	return { name, isEnum: false, modifiers, array: false };
}

/**
 * The DDL names of the `pg_catalog` types, keyed by `typname`. Types not
 * listed keep the server's `format_type`.
 */
const catalogNames: Record<string, string> = {
	int2: 'smallint',
	int4: 'integer',
	int8: 'bigint',
	float4: 'real',
	float8: 'double precision',
	numeric: 'numeric',
	bool: 'boolean',
	text: 'text',
	varchar: 'varchar',
	bpchar: 'char',
	uuid: 'uuid',
	bytea: 'bytea',
	date: 'date',
	time: 'time',
	timetz: 'timetz',
	timestamp: 'timestamp',
	timestamptz: 'timestamptz',
	interval: 'interval',
	json: 'json',
	jsonb: 'jsonb',
	inet: 'inet',
	cidr: 'cidr',
	tsvector: 'tsvector',
	tsquery: 'tsquery',
	daterange: 'daterange',
	tstzrange: 'tstzrange',
	tsrange: 'tsrange',
	int4range: 'int4range',
	int8range: 'int8range',
	numrange: 'numrange',
};

/** Extension types quarry knows, whatever schema they are installed in. */
const extensionNames = new Set(['vector']);

/** What the catalog query reports about a column's element type. */
export interface CatalogType {
	/** `pg_type.typname`. */
	readonly typname: string;
	/** The schema of the type. */
	readonly schema: string;
	/** `format_type(oid, null)`: the name qualified when not on the search path. */
	readonly formatted: string;
	readonly isEnum: boolean;
	readonly array: boolean;
	/** `atttypmod`, or the domain's `typtypmod`; -1 for none. */
	readonly typmod: number;
}

/** The type the catalog reports for a column. */
export function catalogType(type: CatalogType): SqlType {
	const name =
		type.isEnum || extensionNames.has(type.typname)
			? type.typname
			: type.schema === 'pg_catalog'
				? (catalogNames[type.typname] ?? type.formatted)
				: type.formatted;
	return {
		name,
		isEnum: type.isEnum,
		modifiers: decodeTypmod(name, type.typmod),
		array: type.array,
	};
}

/**
 * The modifiers encoded in a `typmod`, for the types whose modifiers quarry
 * can declare or display; see postgres's `*typmodout` functions.
 */
export function decodeTypmod(
	name: string,
	typmod: number,
): readonly number[] | undefined {
	if (typmod < 0) return undefined;
	switch (name) {
		case 'varchar':
		case 'char':
			return typmod >= 4 ? [typmod - 4] : undefined;
		case 'numeric': {
			if (typmod < 4) return undefined;
			const value = typmod - 4;
			// the scale is an 11-bit signed number since postgres 15
			const scale = ((value & 0x7ff) ^ 0x400) - 0x400;
			return [(value >> 16) & 0xffff, scale];
		}
		case 'time':
		case 'timetz':
		case 'timestamp':
		case 'timestamptz':
		case 'vector':
			return [typmod];
		default:
			return undefined;
	}
}

/** The type as DDL writes it, e.g. `varchar(32)[]` or `numeric(10,2)`. */
export function renderType(type: SqlType): string {
	const name = type.isEnum ? quoteIdentifier(type.name) : type.name;
	const modifiers = type.modifiers ? `(${type.modifiers.join(',')})` : '';
	return `${name}${modifiers}${type.array ? '[]' : ''}`;
}

/**
 * Whether a column of the database's type `actual` holds what the code
 * declares as `expected`. Modifiers the code leaves out match any.
 */
export function sameType(expected: SqlType, actual: SqlType): boolean {
	return (
		expected.name === actual.name &&
		expected.isEnum === actual.isEnum &&
		expected.array === actual.array &&
		(expected.modifiers === undefined ||
			(actual.modifiers !== undefined &&
				expected.modifiers.length === actual.modifiers.length &&
				expected.modifiers.every(
					(modifier, i) => modifier === actual.modifiers?.[i],
				)))
	);
}
