# Data types

This guide explains the classes in this directory, which describe **SQL types**: what Postgres calls `integer`, `varchar(12)`, `order_status` or `citext`. Every column and every typed expression holds one. It covers [data-type.ts](data-type.ts), [array.ts](array.ts), [enum.ts](enum.ts) and [custom.ts](custom.ts), and the places that read them: [kind-codecs.ts](../kind-codecs.ts), [verify/sql-type.ts](../verify/sql-type.ts), [write-query.ts](../write-query.ts) and [functions.ts](../functions.ts).

How you declare columns (the factories, modifiers, `useCodec`, `typed`) is in the companion guide, [column/README.md](../column/README.md). How a kind turns into comparison methods is in [EXPRESSIONS.md](../EXPRESSIONS.md), and the codecs themselves are in [driver/CODECS.md](../driver/CODECS.md).

## Contents

- [What a data type is](#what-a-data-type-is)
- [The four classes](#the-four-classes)
- [`DataType`: kind, modifiers, codec](#datatype-kind-modifiers-codec)
- [Kinds](#kinds)
- [The codec, and `withCodec`](#the-codec-and-withcodec)
- [`ArrayType`](#arraytype)
- [`EnumType`](#enumtype)
- [`CustomType`](#customtype)
- [SQL names and modifiers: `codeType` and `renderType`](#sql-names-and-modifiers-codetype-and-rendertype)
- [Where SQL type names are used](#where-sql-type-names-are-used)
- [Decisions](#decisions)
- [Glossary](#glossary)

## What a data type is

A column has two kinds of type. Its **TypeScript types** (what you read, insert and update) live on the column as phantom types ([column/README.md](../column/README.md#a-column-four-types-in-one-object)). Its **SQL type** is a `DataType` object in `column._quarry.dataType`. The SQL type says nothing about nullability or narrowing: `text()`, `text().nullable()` and `text<'free' | 'pro'>()` all hold a `DataType<'text'>`.

A `DataType` answers three questions:

1. **Which comparisons does a value of this type have?** Its `kind` picks them, at the type level, through `MethodsByKind` ([operators.ts](../operators.ts)).
2. **How are its values sent and read?** Its `codec`, a driver codec ([driver/CODECS.md](../driver/CODECS.md#the-codec-interface)).
3. **What is it called in SQL?** Its kind (or enum or type name) plus its **type modifiers**, the numbers in `varchar(12)` or `numeric(10,2)`. `db.verify` compares that name with the database, and `unnest` casts use it.

Expressions carry data types too. `eb.fn.max('orders.total')` reuses its argument's `DataType`, `eb.fn.lower('users.email')` makes a `DataType<'text'>`, and `eb.fn.cast(x, 'integer')` a `DataType<'integer'>`. A data type of a kind has that kind's codec, so a value compared with an expression is encoded exactly as one compared with a column of the same type.

## The four classes

| File                         | Class                                                          | Kind       | Holds, besides kind, modifiers and codec |
| ---------------------------- | -------------------------------------------------------------- | ---------- | ---------------------------------------- |
| [data-type.ts](data-type.ts) | `DataType<K>`: the base, used directly for every built-in type | any        |                                          |
| [array.ts](array.ts)         | `ArrayType<E>`: an array of `E`                                | `'array'`  | `element: E`                             |
| [enum.ts](enum.ts)           | `EnumType<N>`: a Postgres enum named `N`                       | `'enum'`   | `enumName: N`, `values`, `site`          |
| [custom.ts](custom.ts)       | `CustomType<N>`: a type `defineType` declares                  | `'custom'` | `sqlName: N`, `site`                     |

Who creates them:

- The built-in column factories (`integer()`, `varchar(12)`, …) each create a `new DataType(kind)` ([column/README.md](../column/README.md#every-column-factory)).
- `array(element)` creates an `ArrayType` around the element column's data type.
- `defineEnum(name, labels)` creates **one** `EnumType`, shared by every column its factory makes.
- `defineType({ sql, codec })` creates **one** `CustomType`, shared the same way.
- Expressions create plain `DataType`s for their result types (`new DataType('boolean')` for a comparison, `new DataType('bigint')` for `count`, the target kind for `cast`).

Here is what each holds for a real table (captured by running the code):

```ts
const status = defineEnum('order_status', ['pending', 'paid', 'shipped']);
const citext = defineType({ sql: 'citext', codec: codecs.text });
const orders = defineTable('orders', {
  columns: {
    id: integer().identity(),
    code: varchar(12),
    total: decimal(10, 2),
    status: status(),
    email: citext(),
    tags: array(text()),
  },
});
```

| Column   | Class        | `kind`      | `modifiers` | `codec.name`   | `codec.oid` | SQL name        |
| -------- | ------------ | ----------- | ----------- | -------------- | ----------- | --------------- |
| `id`     | `DataType`   | `'integer'` | `undefined` | `int4`         | 23          | `integer`       |
| `code`   | `DataType`   | `'varchar'` | `[12]`      | `varchar`      | 1043        | `varchar(12)`   |
| `total`  | `DataType`   | `'decimal'` | `[10, 2]`   | `numeric`      | 1700        | `numeric(10,2)` |
| `status` | `EnumType`   | `'enum'`    | `undefined` | `order_status` | 0           | `order_status`  |
| `email`  | `CustomType` | `'custom'`  | `undefined` | `text`         | 25          | `citext`        |
| `tags`   | `ArrayType`  | `'array'`   | `undefined` | `text[]`       | 1009        | `text[]`        |

The enum's OID is 0 because enums have no fixed type number; the driver looks it up by name ([below](#enumtype)). `email` is sent and read as `text` but is called `citext` in SQL: the codec and the SQL name are independent.

## `DataType`: kind, modifiers, codec

```ts
export class DataType<K extends Kind = Kind> {
  readonly kind: K;
  readonly modifiers: readonly number[] | undefined;
  readonly codec: Codec;

  constructor(kind: K, options: Options = {}) {
    this.kind = kind;
    this.modifiers = options.modifiers;
    this.codec = options.codec ?? kindCodec(kind);
  }

  withCodec(codec: Codec): this {
    const copy = Object.create(Object.getPrototypeOf(this)) as this;
    return Object.freeze(Object.assign(copy, this, { codec }));
  }
}
```

- **`kind`** is the SQL type's name as quarry knows it ([kinds](#kinds)).
- **`modifiers`** are the type modifiers, or `undefined` when none were given. Only `decimal(precision?, scale?)` and `varchar(length?)` take them; the `modifiers()` helper in [column-factories.ts](../column-factories.ts) keeps the arguments up to the first one left out, so `decimal()` has `undefined`, `decimal(10)` has `[10]` and `decimal(10, 2)` has `[10, 2]`. Only `db.verify` reads them. Values are not checked against them: a 20-character string is sent to a `varchar(12)` column, and the server rejects it.
- **`codec`** is the driver codec values of this type are sent and read with: the one passed in `options.codec`, otherwise the kind's built-in one.

Instances are immutable. Nothing assigns to a `DataType` after it is built; `withCodec` returns a new one.

## Kinds

`Kind` ([operators.ts](../operators.ts)) is the union of every SQL type quarry has a factory for, plus three that stand for a family:

| Kinds                                                                           | Made by                       |
| ------------------------------------------------------------------------------- | ----------------------------- |
| `smallint`, `integer`, `bigint`, `decimal`, `real`, `double precision`          | their factories, `eb.fn.cast` |
| `boolean`, `text`, `varchar`, `uuid`                                            | their factories, `eb.fn.cast` |
| `date`, `time`, `timestamp`, `timestamptz`, `interval`, `jsonb`                 | their factories, `eb.fn.cast` |
| `bytea`, `inet`, `tsvector`, `vector`, `daterange`, `tstzrange`                 | their factories               |
| `enum`: every enum, told apart by `EnumType<N>`'s name                          | `defineEnum`                  |
| `custom`: every `defineType` type, told apart by `CustomType<N>`'s name         | `defineType`                  |
| `array`: an array of any other kind, whose element type is `ArrayType<E>`'s `E` | `array()`                     |

Expressions also make data types of these kinds for their results (`boolean` for a comparison, `bigint` for `count`, `timestamptz` for `now`).

The kind does three jobs:

- **Methods.** `MethodsByKind[kind]` is the set of comparison methods an expression of the type has ([EXPRESSIONS.md](../EXPRESSIONS.md#comparison-methods)). Groups of kinds Postgres compares with each other (`TextKind`, `NumberKind`, `TimestampKind`) accept each other's expressions ([EXPRESSIONS.md](../EXPRESSIONS.md#which-types-compare-with-which)).
- **Keeping types apart.** `integer` and `real` admit the same comparisons, but they are different kinds, so their `DataType`s are different types to the checker.
- **The default codec.** `kindCodec(kind)` ([below](#the-codec-and-withcodec)).

A kind is spelled the way quarry's API spells it, which is the DDL name except for `decimal`: Postgres records `decimal` as `numeric`, so [verify/sql-type.ts](../verify/sql-type.ts) renames it (`kindNames = { decimal: 'numeric' }`) and `eb.fn.cast(x, 'numeric')` makes a `DataType<'decimal'>`.

## The codec, and `withCodec`

The constructor's default is `kindCodec(kind)` from [kind-codecs.ts](../kind-codecs.ts):

```ts
export function kindCodec(kind: Kind): Codec {
  return byKind[kind] ?? codecs.raw;
}
```

`kindCodecs` has one entry per built-in kind; the table is in [column/README.md](../column/README.md#kindcodecs-the-codec-of-each-factory). The three family kinds have no entry, because their subclasses always pass a codec: `ArrayType` passes `arrayOf(element.codec)`, `EnumType` its enum codec, `CustomType` the one you gave `defineType`. `kindCodec` still falls back to `codecs.raw` (the server's text, as a string) for them, as a safety net.

Every place a value of the type crosses the wire uses this one codec:

- A value compared with, or written to, an expression of the type is encoded with it ([EXPRESSIONS.md](../EXPRESSIONS.md#codecs-per-value-codecfor)), and the parameter is declared with its OID in the Parse message, except for text-like codecs, which leave the type for the server to infer ([EXECUTION.md](../EXECUTION.md#how-the-builder-picks-codecs)).
- A selected column or expression is read with it (`resultCodecs`, [EXECUTION.md](../EXECUTION.md#how-the-builder-picks-codecs)).
- A column's TypeScript types are derived from it at the type level (`Out<'integer'>` is `CodecOutput<typeof kindCodecs['integer']>`), so the declared type is what the codec returns ([DECISIONS.md](../DECISIONS.md#typescript-types-derived-from-codecs)).

**`withCodec(codec)`** returns the same type read and sent with another codec. `column.useCodec(codec)` calls it ([column/README.md](../column/README.md#swapping-a-columns-codec-usecodec)):

```ts
bigint().useCodec(codecs.int8); // DataType<'bigint'> with codecs.int8: a JS bigint
```

The copy is made with `Object.create(Object.getPrototypeOf(this))`, so it keeps the class: an `EnumType` stays an `EnumType`, with its `enumName`, `values` and `site`, and `db.verify` still checks it as an enum. `Object.assign` copies every own property and then overrides `codec`; `Object.freeze` keeps the copy immutable. The kind is unchanged, so the comparison methods and what `verify` checks stay the same: only the bytes on the wire change, and `useCodec` changes the column's TypeScript types to match.

## `ArrayType`

```ts
export class ArrayType<E extends DataType> extends DataType<'array'> {
  readonly element: E;

  constructor(element: E) {
    super('array', { codec: arrayOf(element.codec) });
    this.element = element;
  }
}
```

- **`element`** is the data type of the elements, kept whole: `array(varchar(12))` keeps `varchar`'s `[12]` on the element, so `verify` checks `varchar(12)[]`. The array itself has no modifiers.
- **The codec** is `arrayOf(element.codec)` ([driver/CODECS.md](../driver/CODECS.md#arrays-arrayof)): an array literal whose elements are written and read by the element's codec. Its `name` is the element's plus `[]` (`text[]`), and its OID is the element's array type (1009 for `text[]`).
- **No arrays of arrays.** Postgres treats `integer[][]` as the same type as `integer[]`, with the dimensions stored on each value, so `E` is never itself an array type. `array()` enforces it with the parameter type `DataType<Exclude<Kind, 'array'>>` ([column/README.md](../column/README.md#arrays)).

Expressions read `element` too: `any()`/`all()` of an array column compare against its elements, and a parameter on the left of one (`eb.val('admin').eq(eb.fn.any('users.tags'))`) is encoded with the element codec ([EXPRESSIONS.md](../EXPRESSIONS.md#any-and-all)).

## `EnumType`

```ts
export class EnumType<N extends string = string> extends DataType<'enum'> {
  readonly enumName: N; // 'order_status'
  readonly values: readonly string[]; // ['pending', 'paid', 'shipped'], in declaration order
  readonly site: CallSite | undefined; // where defineEnum was called

  constructor(enumName: N, values: readonly string[], site?: CallSite) {
    super('enum', { codec: enumCodec(enumName) });
    // …
  }
}
```

The enum codec sends and reads labels as text, unchanged:

```ts
function enumCodec(name: string): Codec<string> {
  return Object.freeze<Codec<string>>({
    name,
    oid: 0,
    paramFormat: 'text',
    resultFormat: 'text',
    encode: (value) => value,
    decodeText: passThrough,
  });
}
```

- **`oid: 0` and `name: enumName`.** An enum's OID is assigned when `create type` runs, so it differs between databases. The driver looks the name up in `pg_type` once per pool (the **catalog**, [driver/CODECS.md](../driver/CODECS.md#types-looked-up-by-name-the-catalog)), and from then on declares the real OID for parameters, so `where status = $1` is compared as an `order_status`, never as `text`.
- **`N` in the type.** Each enum is its own SQL type, which Postgres compares with no other. Because `EnumType<'order_status'>` and `EnumType<'user_status'>` are different TypeScript types, comparing two different enums is a type error ([DECISIONS.md](../DECISIONS.md#enums-and-custom-types-keyed-by-name-in-their-type)).
- **`values`** is what `db.verify` compares with the database's labels, in order. Labels are ordered as declared, so `lt`/`gt` compare by position, as in Postgres.
- **`site`** is where `defineEnum` was called, so a wrong label list is reported at that line ([column/README.md](../column/README.md#call-sites-remembering-where-things-were-declared)).

## `CustomType`

```ts
export class CustomType<N extends string = string> extends DataType<'custom'> {
  readonly sqlName: N; // 'citext', 'positive_int', …
  readonly site: CallSite | undefined; // where defineType was called

  constructor(sqlName: N, codec: Codec, site?: CallSite) {
    super('custom', { codec });
    // …
  }
}
```

`defineType({ sql, codec })` declares a type quarry has no factory for: an extension's type (`citext`), a **domain** (a named restriction of another type), or your own ([column/README.md](../column/README.md#custom-types-definetype)).

- **`sqlName`** is the name as DDL writes it. It is what `db.verify` checks and what `unnest` casts to. A domain passes when the column is declared with that domain, even though the catalog reports the domain's base type.
- **The codec** is yours. It decides the wire format and the TypeScript value type; it does not have to share the type's name. `citext` read with `codecs.text` is a common case: the codec's OID is 25 (`text`), but the SQL name is `citext`. A codec whose `oid` is 0 is looked up by its `name` in the catalog, like an enum's.
- **`N` in the type** keeps two custom types apart, as for enums.
- **Comparisons**: `MethodsByKind['custom']` offers every operator, taking a value of the codec's type or an expression of the same custom type; Postgres decides which ones the type really has.

## SQL names and modifiers: `codeType` and `renderType`

[verify/sql-type.ts](../verify/sql-type.ts) turns a `DataType` into an `SqlType`, a small record both `db.verify` and the insert compiler read:

```ts
export interface SqlType {
  readonly name: string; // 'integer', 'varchar', 'numeric', an enum's or custom type's name
  readonly isEnum: boolean;
  readonly modifiers: readonly number[] | undefined;
  readonly array: boolean;
}
```

`codeType(dataType)` builds it:

| Data type      | `name`                               | `modifiers`                                 | `isEnum` | `array` |
| -------------- | ------------------------------------ | ------------------------------------------- | -------- | ------- |
| `ArrayType`    | the element's                        | the element's                               | element  | `true`  |
| `CustomType`   | `sqlName`                            | `modifiers` (`undefined` from `defineType`) | `false`  | `false` |
| `EnumType`     | `enumName`                           | `undefined`                                 | `true`   | `false` |
| any other kind | the kind, with `decimal` → `numeric` | `modifiers`; `numeric(p)` becomes `[p, 0]`  | `false`  | `false` |

`numeric(p)` becomes `[p, 0]` because that is how Postgres records it: `numeric(10)` is stored as `numeric(10,0)`.

`renderType(type)` writes it as DDL does:

```ts
export function renderType(type: SqlType): string {
  const name = type.isEnum ? quoteIdentifier(type.name) : type.name;
  const modifiers = type.modifiers ? `(${type.modifiers.join(',')})` : '';
  return `${name}${modifiers}${type.array ? '[]' : ''}`;
}
```

So `varchar(12)` renders `varchar(12)`, `decimal(10, 2)` renders `numeric(10,2)`, `array(varchar(12))` renders `varchar(12)[]`, and an enum named `OrderStatus` renders `"OrderStatus"` (quoted, because it isn't all lowercase; `order_status` needs no quotes).

The database side goes through the same record: `catalogType` turns a row of the catalog query into an `SqlType`, mapping `pg_catalog` names to their DDL spelling (`int4` → `integer`, `bpchar` → `char`, …) and decoding the column's `atttypmod` into modifiers with `decodeTypmod` ([verify/README.md](../verify/README.md#step-3-one-type-language-for-both-sides-sql-typets)). `sameType(expected, actual)` then compares the two: names, enum-ness and array-ness must match, and modifiers match only if the code gives some. A `varchar()` in the code accepts any `varchar(n)` in the database; a `varchar(255)` accepts only `varchar(255)`.

## Where SQL type names are used

**`db.verify`.** [verify/spec.ts](../verify/spec.ts) calls `codeType` on every column, and also reads `EnumType`'s `enumName`, `values` and `site` (from the element, for an array of enums) to check labels. When the types differ, the diagnostic and its fix use `renderType` on both sides. From [the integration snapshot](../../test/verify/__snapshots__/integration.test.ts.snap):

```
× quarry(column-type-mismatch): orders.total is numeric(12,2) in the database, but numeric(10,2)
…
help: alter table orders alter column total type numeric(10,2) using total::numeric(10,2);
```

**`unnest` casts.** Several rows inserted at once are sent as one array parameter per column, and each array is cast to its column's type so Postgres knows the element type ([DECISIONS.md](../DECISIONS.md#many-rows-through-unnest-one-array-per-column)). [write-query.ts](../write-query.ts) computes the cast with the same functions, without modifiers, and caches it per `DataType` in a `WeakMap`:

```ts
function castType(dataType: DataType): string {
  let type = castTypes.get(dataType);
  if (type === undefined) {
    type = renderType({ ...codeType(dataType), modifiers: undefined });
    castTypes.set(dataType, type);
  }
  return type;
}
```

For two rows of the `orders` table above (without `tags`), the compiled SQL is:

```sql
insert into "orders" ("code", "total", "status", "email") select * from unnest($1::varchar[], $2::numeric[], $3::order_status[], $4::citext[])
```

The modifiers are left out because a cast to `varchar(12)` **truncates** a longer string silently; without the modifier the value reaches the column, which rejects it with error 22001, as a single-row insert does ([DECISIONS.md](../DECISIONS.md#unnest-casts-without-type-modifiers)). The enum and custom names come from `enumName` and `sqlName`. When a row includes an array column, its cast type ends in `]`, and the compiler sends the rows as a `values` list instead (`unnestable` in [compile.ts](../compile.ts)):

```sql
insert into "orders" ("code", "total", "status", "email", "tags") values ($1, $2, $3, $4, $5)
```

**`eb.fn.cast`.** `cast(value, type)` in [functions.ts](../functions.ts) takes a SQL type name from a fixed list (`CAST_KINDS`: `text`, `varchar`, `smallint`, `integer`, `bigint`, `numeric`, `real`, `double precision`, `boolean`, `uuid`, `date`, `timestamp`, `timestamptz`, `time`, `interval`, `jsonb`), renders `cast(x as type)` with that name, and gives the result `new DataType(kind)`, whose kind is the name except `numeric` → `decimal`. The result has that type's methods and codec, and its TypeScript type is the codec's (`CastValues`): `bigint` is a string, `timestamptz` a `Date`. A name outside the list throws `Unknown cast type "…"` when the expression is built.

```ts
selectFrom(orders).select((eb) => [
  eb.fn.cast('orders.total', 'integer').as('cents'),
]);
// select cast("orders"."total" as integer) as "cents" from "orders"
```

## Decisions

Why data types work this way. Each links to its full entry in [DECISIONS.md](../DECISIONS.md):

- [`DataType` separate from the column](../DECISIONS.md#datatype-separate-from-the-column): expressions and columns share the SQL type's rules and codec.
- [Enums and custom types keyed by name in their type](../DECISIONS.md#enums-and-custom-types-keyed-by-name-in-their-type): two enums never compare, as in Postgres.
- [TypeScript types derived from codecs](../DECISIONS.md#typescript-types-derived-from-codecs): a column's type can't drift from what the driver returns.
- [The driver owns the codecs; the builder only chooses them](../DECISIONS.md#the-driver-owns-the-codecs-the-builder-only-chooses-them): a `DataType` holds a driver codec rather than its own encoder.
- [Codecs chosen per column: `useCodec` and `defineType`, not a global type table](../DECISIONS.md#codecs-chosen-per-column-usecodec-and-definetype-not-a-global-type-table): why `withCodec` and `CustomType` exist.
- [The type catalog, loaded before the first query](../DECISIONS.md#the-type-catalog-loaded-before-the-first-query): why an enum's codec can have OID 0.
- [Many rows through `unnest`, one array per column](../DECISIONS.md#many-rows-through-unnest-one-array-per-column) and [`unnest` casts without type modifiers](../DECISIONS.md#unnest-casts-without-type-modifiers): where SQL type names end up in queries.

## Glossary

**Catalog**: here, the driver's lookup of type OIDs by name in `pg_type`, once per pool ([driver/CODECS.md](../driver/CODECS.md#types-looked-up-by-name-the-catalog)). (`db.verify` also reads the database's system catalog, `pg_catalog`.)

**Codec**: the driver object that encodes and decodes one Postgres type ([driver/CODECS.md](../driver/CODECS.md)).

**Domain**: a Postgres type defined as another type plus constraints (`create domain positive_int as int check (value > 0)`).

**Kind**: the SQL type's name as `DataType.kind` records it; `enum`, `custom` and `array` each stand for a family of types.

**OID**: Postgres's numeric identifier for a type (23 is `int4`). Built-in types have fixed OIDs; enums, domains and extension types don't.

**`SqlType`**: the record `codeType` and `catalogType` build, so the code's types and the database's are compared in one form.

**Type modifier**: the number(s) after a type name: the length in `varchar(12)`, the precision and scale in `numeric(10,2)`. Postgres stores them as one integer, the **typmod**.
