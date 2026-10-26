# Codecs: how values become bytes and bytes become values

Every value sent to PostgreSQL has to be turned into bytes, and every value received has to be turned back into a JavaScript value. A **codec** is the object that knows how to do both for one Postgres type. This guide explains codecs from scratch, then every piece of code involved: the `Codec` interface, the built-in codecs, arrays, the registry that picks a codec for a result column, how parameters are encoded and their types declared, how result columns are planned and decoded (including the switch to binary after a statement is described), and the catalog that resolves enums and extension types.

Files: [codec.ts](codec.ts), [codecs.ts](codecs.ts), [registry.ts](registry.ts), [params.ts](params.ts), [results.ts](results.ts), [rows.ts](rows.ts), [binary.ts](binary.ts), [array-params.ts](array-params.ts), [types.ts](types.ts), [parsers.ts](parsers.ts). How the query builder chooses codecs is in [../EXECUTION.md](../EXECUTION.md#how-the-builder-picks-codecs).

## Contents

- [First principles: types, OIDs, text and binary](#first-principles-types-oids-text-and-binary)
- [The `Codec` interface](#the-codec-interface)
- [The built-in codecs](#the-built-in-codecs)
- [Arrays: `arrayOf`](#arrays-arrayof)
- [Your own codecs: `defineCodec`](#your-own-codecs-definecodec)
- [Encoding a query's parameters](#encoding-a-querys-parameters)
- [Declaring parameter types](#declaring-parameter-types)
- [Reading results: plans](#reading-results-plans)
- [Binary after describe](#binary-after-describe)
- [Row decoders](#row-decoders)
  - [Nested objects](#nested-objects)
- [The registry](#the-registry)
- [Types looked up by name: the catalog](#types-looked-up-by-name-the-catalog)
- [Value formats worth knowing](#value-formats-worth-knowing)
- [Decisions](#decisions)
- [Glossary](#glossary)

## First principles: types, OIDs, text and binary

Postgres identifies every type by a number, its **OID** (object identifier): `int4` (a 4-byte integer, what SQL calls `integer`) is 23, `text` is 25, `timestamptz` is 1184, `int4[]` (an array of them) is 1007. Built-in types have fixed OIDs below 16384. Types created in a database (enums, domains, extension types like pgvector's `vector`) get an OID when they're created, different in every database.

The OIDs show up on the wire:

- **RowDescription** tells the client each result column's type OID.
- **Parse** may declare each parameter's type OID, or 0 to let the server infer it from where the parameter is used.

Each value travels in one of two **formats**:

|                 | Text                                  | Binary                                 |
| --------------- | ------------------------------------- | -------------------------------------- |
| `int4` 1        | `31` (`"1"`)                          | `00 00 00 01`                          |
| `timestamptz`   | `"2026-10-17 03:51:00+00"` (22 bytes) | microseconds since 2000-01-01, 8 bytes |
| `bool` true     | `"t"`                                 | `01`                                   |
| `bytea` 3 bytes | `"\x010203"`                          | `01 02 03`                             |
| `text` `"Ada"`  | `"Ada"`                               | `"Ada"` (the same UTF-8 bytes)         |

Text is what `psql` shows and is universal. Binary is the type's internal-ish representation: often smaller and much cheaper to decode (no number parsing, no date parsing), but every type has its own layout, and the client has to know it. The format is chosen **per parameter** (in Bind) and **per result column** (in Bind, for the portal's results).

## The `Codec` interface

[codec.ts](codec.ts):

```ts
interface Codec<In = unknown, Out = In> {
  readonly name: string; // SQL name: 'int4', 'user_status', 'vector'; '' for any type (codecs.raw)
  readonly oid: number; // the type's OID; 0 = look it up by name in the catalog
  readonly arrayOid?: number; // the OID of its array type, when fixed
  readonly paramFormat: 'text' | 'binary'; // what encode returns
  readonly resultFormat: 'text' | 'binary'; // the format results are asked for in
  readonly inferParamType?: boolean; // leave the parameter's type to the server (text-like types)
  readonly element?: Codec; // for an array codec, its elements' codec
  readonly delimiter?: string; // for an array codec, the element separator (',' or ';' for box)
  encode(value: In): string | Uint8Array; // a non-null value as the server reads it
  decodeText(text: string): Out; // from text output
  decodeBinary?(bytes: Uint8Array, start: number, end: number): Out; // from binary, bytes[start, end)
}
```

- `In` and `Out` are the TypeScript types it takes and returns. They can differ: `codecs.int8AsString` takes `string | bigint | number` and returns `string`. The query builder derives column types from them ([../column/README.md](../column/README.md#kindcodecs-the-codec-of-each-factory)).
- `encode` and the decoders never see NULL: NULL is handled around them (−1 length on the wire, `null` in JavaScript).
- `decodeBinary` takes the whole buffer and offsets rather than a slice, so decoding a value allocates nothing but the result.
- Codecs are frozen plain objects. Identity matters: caches are keyed by codec object (`arrayOf` returns the same array codec for the same element; plans compare codecs by `===`).

**Who owns codecs?** The driver. They are exported from `quarry/driver` (and re-exported by `quarry`), and the driver applies them. The query builder only chooses one per parameter and per column.

## The built-in codecs

[codecs.ts](codecs.ts) `codecs`:

| Codec                                                                                                                                                            | OID                    | Reads as             | Results asked in | Notes                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `bool`                                                                                                                                                           | 16                     | `boolean`            | binary           |                                                                                                                         |
| `int2`, `int4`                                                                                                                                                   | 21, 23                 | `number`             | binary           |                                                                                                                         |
| `oid`                                                                                                                                                            | 26                     | `number`             | binary           | unsigned                                                                                                                |
| `int8`                                                                                                                                                           | 20                     | `bigint`             | binary           |                                                                                                                         |
| `int8AsString`                                                                                                                                                   | 20                     | `string`             | text             | quarry's choice for `bigint()` columns                                                                                  |
| `float4`                                                                                                                                                         | 700                    | `number`             | text             | has a binary decoder, used if the column arrives in binary                                                              |
| `float8`                                                                                                                                                         | 701                    | `number`             | binary           |                                                                                                                         |
| `numeric`                                                                                                                                                        | 1700                   | `string`             | text             | exact digits; a binary decoder exists                                                                                   |
| `text`, `varchar`, `bpchar`, `name`, `char`                                                                                                                      | 25, 1043, 1042, 19, 18 | `string`             | text             | **text-like**: `inferParamType`, binary = text                                                                          |
| `uuid`                                                                                                                                                           | 2950                   | `string`             | text             | has a binary decoder, used if the column arrives in binary                                                              |
| `bytea`                                                                                                                                                          | 17                     | `Uint8Array`         | binary           | sent in binary too                                                                                                      |
| `json`, `jsonb`                                                                                                                                                  | 114, 3802              | parsed JSON          | text             | encode is `JSON.stringify`; binary decoders exist (`jsonb`: after its version byte), so their arrays are read in binary |
| `timestamptz`                                                                                                                                                    | 1184                   | `Date`               | binary           |                                                                                                                         |
| `timestamptzAsString`                                                                                                                                            | 1184                   | `string`             | text             |                                                                                                                         |
| `date`, `time`, `timetz`, `timestamp`, `interval`, `inet`, `cidr`, `macaddr`, `money`, `xml`, `bit`, `varbit`, `point`, `box`, `tsvector`, `tsquery`, `jsonpath` |                        | `string`             | text             | the server's text, as is                                                                                                |
| `daterange`                                                                                                                                                      | 3912                   | `RangeValue<string>` | text             | `daterangeAsString` keeps the text                                                                                      |
| `tstzrange`                                                                                                                                                      | 3910                   | `RangeValue<Date>`   | binary           | bounds through `timestamptz`'s binary decoder; `tstzrangeAsString` keeps the text                                       |
| `vector`                                                                                                                                                         | 0 (by name)            | `number[]`           | binary           | pgvector; float32 values                                                                                                |
| `raw`                                                                                                                                                            | 0, name `''`           | `string`             | text             | any type, as text both ways; `inferParamType`                                                                           |

Results are read in binary **where that builds the JavaScript value faster**: numbers, booleans, bytes, `Date`s, and arrays of those. Where the value is a string anyway (`numeric`, `uuid`, `text`), text is just as cheap and avoids work, so their own results stay text. Parameters are text, except `bytea` and arrays of fixed-size types (below).

**`defaultCodecs`** is what the driver uses when nobody chose: lossless conversions only. `bool`, `int2`, `int4`, `oid`, `int8` (as `bigint`), `float4`, `float8`, `json`, `jsonb` and `bytea` are registered, and through their `arrayOid` so are their arrays. Scalar `numeric`, dates, times, `uuid` and the character types aren't: those columns stay the server's text, which is what those codecs would return anyway. Arrays of them are registered explicitly, so they become JavaScript arrays of the server's text: `text[]`, `varchar[]`, `bpchar[]`, `char[]`, `name[]`, `uuid[]`, `numeric[]`, `date[]`, `time[]`, `timetz[]`, `timestamp[]`, `timestamptz[]` (as strings), `interval[]`, `inet[]`, `cidr[]`, `point[]`, `daterange[]` and `tstzrange[]` (as strings), and `box[]`. quarry layers its own choices on top ([../EXECUTION.md](../EXECUTION.md#how-the-builder-picks-codecs)).

Internal marks, kept in `WeakSet`s keyed by codec so they add no fields to the public objects:

| Mark                 | Set on                                                                                            | Effect                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `markTextLike`       | the character types                                                                               | their binary format **is** their UTF-8 text                                                  |
| `readArraysInBinary` | character types, `json`, `jsonb`                                                                  | their **arrays** are read in binary (one slice of the whole array beats parsing its literal) |
| `sendArraysInBinary` | `int2`, `int4`, `int8`, `int8AsString`, `float8`, `bool`, `timestamptz`, `uuid`, `jsonb`, `bytea` | their arrays are **sent** in binary when every element fits                                  |
| `markArrayValued`    | `json`, `jsonb`, `vector`                                                                         | a JavaScript array inside their array is a **value**, not a nested dimension                 |

`passThrough` (`(text) => text`) is the `decodeText` of every type read as its text; `decodesAsText(codec)` lets decoders skip calling it.

## Arrays: `arrayOf`

<a id="arrays-arrayof"></a>
Postgres arrays have their own types (`int4[]` is OID 1007) and their own formats:

- **Text** (an array **literal**): `{1,2,NULL}`, `{"a b","c\"d"}`, nested `{{1,2},{3,4}}`. Elements that are empty, `NULL`, or contain braces, quotes, backslashes, the delimiter or white space must be double-quoted with `\` escapes.
- **Binary**: a header (number of dimensions, a has-nulls flag, the element type OID, then per dimension its length and lower bound) followed by each element as a 4-byte length (−1 for NULL) and its binary bytes.

`arrayOf(element, delimiter?)` returns the codec of arrays of `element`, of any number of dimensions:

```ts
const ints = arrayOf(codecs.int4); // name 'int4[]', oid 1007, element codecs.int4
ints === arrayOf(codecs.int4); // true: memoised per element and delimiter
```

- **Memoised** in a `WeakMap` by element (and delimiter), so caches keyed by codec find it, and it costs nothing to call per query.
- **No arrays of arrays**: `arrayOf(arrayOf(x))` throws. Postgres has no such type: `int4[][]` **is** `int4[]` with two dimensions, which this codec already handles.
- **OID**: the element's `arrayOid`, or 0 (looked up through the catalog) for an element looked up by name. `inferParamType` is the element's, so an array of a text-like type leaves its type to the server too.
- **Encoding**: if the element is marked `sendArraysInBinary` and the array OID is known, `binaryArray(values, oid)` ([array-params.ts](array-params.ts)) tries to write the binary format; it returns `undefined` when an element doesn't fit (a nested array, a number out of range, a non-canonical uuid spelling, a value of another JavaScript type), and the codec falls back to a **literal** built by `arrayText` with each element through `element.encode` and the quoting rules above. A string is passed through as an already-written literal; any other non-array value throws a `DriverError`.
- **Decoding**: text through `parseArray(text, elementDecoder, delimiter)` ([types.ts](types.ts)); binary through `arrayDecoder(elementOid, element)` ([binary.ts](binary.ts)), which checks the element OID and the dimensions (at most 6, Postgres's `MAXDIM`), drops lower bounds, and decodes each element with the element's binary decoder. For text-like elements it slices strings from **one latin1 decode of the whole array** where they are ASCII: a substring is far cheaper than a native UTF-8 decode per element.
- **Result format**: binary when the element's own results are binary, or it's marked `readArraysInBinary`; otherwise text.
- The `box` type uses `;` as its delimiter (because a box's text contains commas), hence the `delimiter` parameter: it defaults to `;` for an element named `box` and `,` otherwise. Arrays looked up through the catalog use the type's own `typdelim`.

What `binaryArray` can encode (one dimension): `bool[]`, `int2[]`, `int4[]`, `int8[]` (numbers, bigints, or digit strings, range-checked), `float8[]`, `timestamptz[]` (`Date`s, as exact microsecond halves), `uuid[]` (canonical form only), `text[]`/`varchar[]`/`bpchar[]`, `jsonb[]` (with jsonb's version byte), `bytea[]`. Buffers are sized exactly before writing.

## Your own codecs: `defineCodec`

```ts
const point = defineCodec({
  name: 'point',
  oid: 600,
  encode: ({ x, y }: { x: number; y: number }) => `(${x},${y})`,
  decodeText: (text) => {
    const [x, y] = text.slice(1, -1).split(',').map(Number);
    return { x, y };
  },
});
```

`defineCodec(spec)` fills in defaults (`oid` 0, `paramFormat: 'text'`, `resultFormat` binary if a `decodeBinary` is given, else text), wraps the functions so a mutable spec object can't change the codec later, and freezes it. Without an `oid`, the type is resolved by `name` through the catalog ([below](#types-looked-up-by-name-the-catalog)), so the same codec works across databases where the type has different OIDs.

`typed(value, codec)` attaches a codec to one parameter of a raw query: `pool.query('select $1 @> $2', [typed(range, codecs.tstzrange), typed(now, codecs.timestamptz)])`. It makes a `TypedValue`, which `encodeParams` recognises.

## Encoding a query's parameters

<a id="encoding-a-querys-parameters"></a>
`encodeParams(sql, params, codecs, paramTypes)` ([params.ts](params.ts)) runs when a query is issued (before it is queued), producing one **wire value** per parameter: a `string` (sent as text), a `Uint8Array` (sent as binary), or `null`:

1. More than 65,535 parameters: refuse (the protocol counts them in 16 bits).
2. For each parameter:
   - unwrap a `TypedValue`;
   - `undefinedAt(value)`: `undefined`, or `undefined` anywhere inside an array (holes included), throws `UndefinedParameterError` with the position (`$2[3]`): never sent as NULL, which would make `= NULL` match nothing;
   - `null` → NULL;
   - with a codec (the `TypedValue`'s, or `paramCodecs[i]`): `codec.encode(value)`, once;
   - without one, by its JavaScript type (`encodeDefined` in [types.ts](types.ts)), or in binary if `paramTypes[i]` declares an array type `binaryArray` handles.

### Parameters without a codec

<a id="parameters-without-a-codec"></a>
`encodeDefined(value)`:

| JavaScript value                       | Sent as                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`                               | as is (this is how quarry sends values its codecs already turned into text)                                                                                                                                                                                                     |
| `Uint8Array` (or any typed array view) | binary bytes                                                                                                                                                                                                                                                                    |
| `number`                               | its text; integers of 1e21 and above without an exponent (`numberText`), so Postgres reads them as numbers                                                                                                                                                                      |
| `bigint`                               | its digits                                                                                                                                                                                                                                                                      |
| `boolean`                              | `t` / `f`                                                                                                                                                                                                                                                                       |
| `Date`                                 | a UTC timestamp (`formatTimestamp`: `2026-10-17 03:51:00.000+00`, with ` BC` for years before 1; not `toISOString`, whose expanded years Postgres rejects). A `timestamp without time zone` column therefore receives the UTC wall-clock time, whatever the process's time zone |
| array                                  | an array literal (`arrayLiteral`), every element quoted                                                                                                                                                                                                                         |
| other object                           | `JSON.stringify`                                                                                                                                                                                                                                                                |

With no codec and no declared type, the parameter's type is **inferred** by the server from context (`where id = $1` makes it the column's type).

## Declaring parameter types

<a id="declaring-parameter-types"></a>
`paramOids(params, codecs, paramTypes, catalog)` chooses the OIDs written into Parse:

- `paramTypes[i]` if given and non-zero;
- otherwise the codec's OID (`catalog.oidOf(codec)`, which resolves named types), **unless** the codec has `inferParamType`;
- otherwise 0 (infer).

It returns an empty array when every OID is 0 (most queries without codecs), so nothing is allocated.

Why not always declare? Because for **text-like** codecs, declaring `text` changes meaning: a `text` value compared with a `citext` column compares case-sensitively instead of insensitively; against an enum, `char(n)` or `varchar` column, Postgres may refuse ("column is of type X but expression is of type text") or apply different rules. Letting the server infer the type from the column does the right thing. Non-text types are declared exactly, which avoids ambiguity (`$1` in `select $1` has no context) and lets the server skip inference.

`declareParamType(codec)` returns a copy of a text-like codec that **does** declare its type, for parameters whose type the SQL pins anyway: quarry's `unnest($1::text[])` inserts use it. For arrays of text-like types, the copy also encodes them in binary (`binaryArray`).

The declared OIDs are part of the **statement cache key** ([ARCHITECTURE.md](ARCHITECTURE.md#the-prepared-statement-cache)): the same SQL with different declared types is a different prepared statement.

## Reading results: plans

When a result's columns are known (from RowDescription, or a cached statement), the op builds a **result plan** ([results.ts](results.ts)):

```ts
interface ResultPlan {
  formats: readonly number[] | 0; // per column as asked for at Bind (0 = all text)
  fields: readonly Field[]; // the columns, with those formats
  codecs: readonly (Codec | undefined)[]; // per column: what reads it (undefined = the server's text)
  unreadable: Field | undefined; // a binary column nothing can read
  decoders: Map<string, RowDecoder>; // by row mode and nested objects, built on first use
}
```

`planDecoder(plan, mode, nested)` builds a plan's row decoder once per key: the row mode alone, or the mode and the `nested` list (its JSON, made once per list object), so the same statement read as objects, as arrays, or with [nested objects](#nested-objects) keeps one decoder for each.

`columnCodec(spec, field, i)` decides each column's codec:

1. If the query **expects** a codec for this position (`resultCodecs[i]`, from the query builder): use it if its result OID (`catalog.resultOidOf(codec)`: the codec's type, or a domain's base type, since RowDescription reports a domain column as its base type) equals the column's type OID, or is 0 (a codec for any type, or a named type not resolved yet).
2. Otherwise the **registry**'s codec for the column's OID ([below](#the-registry)); none means the server's text.

The check in step 1 matters when the schema changes under a cached query (a column changed type), or when the query expected one type and got another: the column is then read by what it actually is, instead of by a codec that would misread it.

Then each column's format: when the plan is made **before** binding (`requested === undefined`), binary if the spec allows binary and the codec reads binary (`resultFormat === 'binary'` with a `decodeBinary`, and a known OID); otherwise what was requested. A column that came in binary without a binary decoder is fine for `text`, `varchar`, `bpchar` and `name` (`TEXT_LIKE` in [results.ts](results.ts); format 2: "sent in binary, read as text", since their binary is their text) and otherwise `unreadable`: the query fails with a `DecodeError` after running.

**Caching**: `cachedPlan(statement.plans, fields, spec)` keeps up to 8 plans per prepared statement, keyed by the columns array, the registry, the expected codecs, the binary flag and the catalog generation. A cached statement mostly sees one, so every later run reuses its plan **and its compiled row decoder**.

## Binary after describe

<a id="binary-after-describe"></a>
Binary results are asked for **only once the statement's columns have been described**, which in practice means from a cached statement's **second** run:

```
1st run:  Parse q1 · Describe q1 · Bind(q1, results: text) · Execute · Sync
          ← ParameterDescription · RowDescription [int4, text, timestamptz] · … rows in text
2nd run:  Bind(q1, results: [binary, text, binary]) · Execute · Sync
          ← rows: int4 and timestamptz in binary, text in text
```

(captured; [../WALKTHROUGH.md](../WALKTHROUGH.md#the-second-run-cached-statement-binary-results) shows the bytes.)

Why not ask for binary on the first run? Bind's result formats are sent **before** the server describes the columns, so the client would have to guess the types. A guess is wrong whenever an expression's type isn't what the builder thought, a column was altered, or raw SQL is used; a column received in binary that the client can't read is unrecoverable for that query. Waiting one run means a format is never asked for before the type is known, and binary and text decode to **identical values**, so the first run isn't different for your code, only slightly slower. `binaryResults: false` (connection option) or `binary: false` (per query) turns binary results off.

Unprepared queries (`prepare: false`) never know their columns before Bind, so their results are always text.

**Cursors are the exception** (since #34): a cursor whose statement's columns aren't cached sends Describe(S) + Flush **before** Bind, waits for the RowDescription, and then binds each column in its codec's format, so a stream is binary from its first run, prepared or not ([STREAMING.md](STREAMING.md#binary-from-the-first-run)). The extra round trip is paid once per statement and connection, and a streamed result is large by nature, so it pays for itself; on ordinary queries, most of which return a row or two, it would be a pure loss ([DECISIONS.md](DECISIONS.md#binary-only-after-describe)).

## Row decoders

<a id="row-decoders"></a>
[rows.ts](rows.ts) `rowDecoder(fields, codecs, mode)` returns a function that turns one DataRow body into a row (`{ id: 1, name: 'Ada' }`, or `[1, 'Ada']` with `rowMode: 'array'`). Each column is decoded one of four ways (`decodeOf`):

| Way      | When                                     | Code                                           |
| -------- | ---------------------------------------- | ---------------------------------------------- |
| `binary` | sent in binary, codec has `decodeBinary` | `codec.decodeBinary(b, pos, pos + length)`     |
| `copy`   | sent in binary, no decoder               | a copy of the bytes                            |
| `parse`  | text, codec decodes text                 | `codec.decodeText(utf8(b, pos, pos + length))` |
| `text`   | text, no codec or a pass-through codec   | `utf8(b, pos, pos + length)`                   |

The decoder is **generated JavaScript** (`new Function`) specialised for the column list: straight-line code that reads each value's length, decodes it, and assigns it into an object literal created with every key already present (`{"id": null, "name": null, …}`). Compared with a generic loop:

- no intermediate array of values per row;
- every row object has the same **hidden class** (V8's internal shape), so code reading rows stays fast;
- each column's codec is a constant in the generated code.

The generated source for a 3-column result is shown in [../WALKTHROUGH.md](../WALKTHROUGH.md#stage-10-reading-and-decoding). Details:

- Columns are split into functions of **8 columns** each: V8's optimizing compiler needs memory that grows faster than a function's size (one 100-column function cost ~70 MB of native memory on Node 24; 8-column pieces stay under 10 MB).
- Factories are cached **by source**, so decoders of the same shape on every connection share one compiled function. The cache is dropped once its sources exceed 4 million characters. A short key of the shape (row mode, decode kinds, names, nesting) finds a factory before its source is generated (`factoryOf`), which matters for unprepared statements: they get a RowDescription, and so a decoder lookup, on every run.
- Errors: a value whose codec throws becomes a `DecodeError(column, typeOid, cause)` (the `column` variable tracks which); a malformed row (wrong column count, bad length) is a `ProtocolError`.
- Duplicate column names: in object mode the last wins, and a later NULL still overwrites an earlier value of the same name.
- **Fallback** without generated code, where `new Function` is forbidden (`--disallow-code-generation-from-strings`) or a column (or a nested object or its key) is named `__proto__` (which can't be an object-literal key safely): a loop into an array, then `assignBuilder` defines `__proto__` as an own property, never as the prototype.

### Nested objects

<a id="nested-objects"></a>
A query's `nested` option (`QueryOptions.nested`, a list of `NestedObject`s from [rows.ts](rows.ts)) reads some columns into an object of the row rather than the row itself. quarry's `nest` uses it for the columns of a joined table ([../QUERIES.md](../QUERIES.md#nest-a-tables-columns-as-one-object)):

```ts
interface NestedObject {
  readonly key: string; // the object's key in the row
  readonly marker: number; // the column it replaces: true (or 't') where the joined row exists
  readonly columns: readonly (readonly [position: number, key: string])[]; // its columns, each under its own key
}
```

- The object takes the place of its **marker** column, under `key`; its columns aren't values of the row. In `array` mode it takes the marker's place in the array.
- Where the marker reads `true` (or `'t'`, when the column has no codec and stays the server's text), the object is built; where it is false or NULL, the object is `null`. quarry's builder writes the marker as `("bookings".ctid is not null) as "bookings"`, true exactly where the outer join found a row ([../DECISIONS.md](../DECISIONS.md#nest-marks-a-joined-row-with-ctid)).
- Its columns must be NULL wherever the marker isn't true (they are a missing joined row's): the generated decoder stores them into the object, so a non-NULL value there fails the query with a `DecodeError` naming that column.
- `checkNested` runs when the query is issued and throws a `DriverError` if a position isn't a non-negative integer, a column is in two objects (or is a marker too), or a column comes before its object's marker.

The generated decoder is the same straight-line code, with the marker storing a literal of its own. Captured from `rowDecoder` for columns `id int4` (binary), `title text`, `author bool` (the marker, binary), `author_id int4`, `author_name text`, with `nested: [{ key: 'author', marker: 2, columns: [[3, 'id'], [4, 'name']] }]` (one value's length checks shown, the others elided):

```js
// in columns0(b, pos, end, row):
column = 2;
{
  const m = c2.decodeBinary(b, pos, pos + length);
  if (m === true || m === 't') row['author'] = { id: null, name: null };
}
// …
column = 3;
row['author']['id'] = c3.decodeBinary(b, pos, pos + length);
// …
column = 4;
row['author']['name'] = utf8(b, pos, pos + length);

// in decodeRow:
const row = { id: null, title: null, author: null };
```

Two rows decode to `{"id":1,"title":"Hi","author":{"id":42,"name":"Ada"}}` and, with the marker false and both columns NULL, `{"id":2,"title":"Draft","author":null}`. A missing joined row allocates nothing beyond the row, and every nested object of one shape shares one hidden class, as rows do. Without generated code, `nestedBuilder` builds the same layout from the values array.

## The registry

<a id="the-registry"></a>
A `CodecRegistry` ([registry.ts](registry.ts)) answers "which codec reads result columns of type OID x?", for columns no query typed.

```ts
const registry = createCodecRegistry([codecs.int8AsString, codecs.timestamptz]); // over defaultRegistry
const bare = createCodecRegistry([codecs.int4], null); // only these
```

Construction (`new CodecRegistry(list, base)`):

- copies the base's maps, then adds each codec of `list` (later ones win): by OID if it has one, by normalised **name** if it has `oid: 0`;
- a codec with a fixed `arrayOid` also registers `arrayOf(codec)` for it, unless the list has an explicit codec for that array OID.

Lookup (`codecFor(oid, catalog)`), memoised per catalog **generation** (so a reloaded catalog starts over):

1. a codec registered for the OID;
2. else, if the catalog knows the type: for an **array** type, `arrayOf(the element's codec)` (or of a text codec if the element has none) with the type's delimiter; otherwise a codec registered by the type's `schema.name`, or by its bare name if the type is visible on the `search_path`;
3. else nothing: the value stays the server's text.

`needsCatalog` is true when some codec is registered by name: decoding then needs the catalog loaded.

Registries are layered:

- A connection (or pool) gets its registry from the `codecs` option: a `CodecRegistry` is used as is; a list becomes `createCodecRegistry(list)` over `defaultRegistry`, so it only needs the codecs that differ; no option (or an empty list) is `defaultRegistry` itself. It is made once, in the resolved config.
- A query can pass its own (`codecs` in `QueryOptions`): a registry is used as is; a list is layered over **the connection's** registry, made once per list object (a `WeakMap` in [connection.ts](connection.ts)), so a constant list costs a lookup per query.
- `createCodecRegistry(list, null)` starts from nothing, for a registry that reads every other column as the server's text.

## Types looked up by name: the catalog

<a id="types-looked-up-by-name-the-catalog"></a>
Codecs with `oid: 0` (enums, domains, `vector`, `defineCodec` without an OID) need their OID before they can declare parameters or be matched to result columns. `TypeCatalog` ([registry.ts](registry.ts)) holds that lookup, **one per pool** (it lives in the resolved config, shared by every connection):

```sql
-- catalogQuery: every non-built-in type except composites (one per table)
select t.oid, t.typname::text as name, n.nspname::text as schema, t.typelem as elem,
       t.typarray as array, t.typbasetype as base, t.typdelim::text as delim,
       pg_type_is_visible(t.oid) as visible
from pg_type t join pg_namespace n on n.oid = t.typnamespace
where t.oid >= 16384 and t.typtype <> 'c'
and not exists (select from pg_type e where e.oid = t.typelem and e.typtype = 'c')
```

- `load(run)` runs the query once (concurrent callers share the promise). A failed lookup is not an error: the promise still resolves, the catalog stays unloaded, and the next query that needs it tries again (meanwhile named types are inferred and read as text, as before the first load). `reloadTypes()` runs it again for types created since; it waits for a load in progress first. On a pool, both go through the shared path ([POOL.md](POOL.md#two-ways-to-use-a-connection)), and `loadTypes()` returns at once when the catalog is already loaded.
- `setTypes(rows)` indexes by OID and by `schema.name` (and by bare name when visible), clears the OID memo and bumps `generation`, which invalidates registry memos and cached result plans.
- `oidOf(codec)`: the fixed OID; for an array codec, its element's `arrayOid` or the catalog's array type of the element; for a named codec, the type found by name (names normalised as Postgres does: unquoted parts lower-cased, quoted parts kept). Memoised per codec once loaded.
- `resultOidOf(codec)`: follows a domain to its base type (up to 8 levels), since RowDescription reports base types.
- `unresolved(codec)`: a named codec before the catalog is loaded.

**When it loads.** `Connection.#loadTypesAfter` starts a load when a query needs it (its registry needs the catalog, or a parameter or expected result codec is unresolved), **queued behind that query**, so queries keep their order: the triggering query goes out with the named parameter's type inferred and its named columns read as text, and the next queries benefit. quarry's executor instead awaits `loadTypes()` before its first query ([../EXECUTION.md](../EXECUTION.md#the-type-catalog)). The load is skipped in a failed transaction (it would fail too).

## Value formats worth knowing

[binary.ts](binary.ts) and [parsers.ts](parsers.ts):

- **`int8`**: two 32-bit halves; when the high half is small the value fits a double exactly and is built without BigInt arithmetic (`int8BigInt`, `int8String`).
- **`timestamptz`** binary: signed 64-bit microseconds since 2000-01-01 UTC. Decoded as halves (the full number exceeds 2^53), floored to milliseconds (JavaScript `Date` precision); `infinity`/`-infinity` (the extreme 64-bit values) become the largest and smallest `Date`s (±8.64e15 ms). Text: `parseTimestamptz` has a hand-written fast path for `YYYY-MM-DD HH:MM:SS[.fff]±HH[:MM]` and a regular expression for the rest (BC years, years beyond 9999, second-precision offsets).
- **`numeric`** binary: base-10000 digit groups with a weight, a sign and a display scale; decoded straight to the same string `numeric_out` prints, including `NaN` and `±Infinity`.
- **`uuid`** binary: 16 bytes, printed as lowercase hyphenated hex.
- **`jsonb`** binary: a version byte (1) then the JSON text.
- **`vector`** (pgvector) binary: `Int16` dimensions, `Int16` unused, then `float32` values. Decoded values are the float32 values stored: `[0.1]` reads as `[0.10000000149011612]` in binary **and** text, because that is what pgvector holds.
- **`bytea`** text: `\x` hex or the old escape format (`parseBytea`); binary: the bytes, **copied** so a row never keeps the read buffer alive.
- **Ranges** (`parseRange`): `empty`, or `[lower,upper)` with each bound unquoted and parsed by the element parser, `null` when unbounded; `RangeValue<T>` is `{ empty: true } | { empty: false, lower, upper, bounds }`, with `bounds` one of `'[)'`, `'(]'`, `'[]'`, `'()'`.

## Decisions

Why codecs work this way. Each links to its full entry (what it is, why, the alternatives, the cost, measured impact) in [DECISIONS.md](DECISIONS.md):

- [Codecs owned by the driver, chosen by the caller](DECISIONS.md#codecs-owned-by-the-driver-chosen-by-the-caller): one object per type for both directions, so a type's encoding lives in one place.
- [Exact parameter OIDs, except for text-like types](DECISIONS.md#exact-parameter-oids-except-for-text-like-types): exact where it helps, permissive where Postgres's coercions are right.
- [Binary only after describe](DECISIONS.md#binary-only-after-describe): never a format before the type is known: safe against schema drift.
- [Cursors: describe first for binary from the first run](DECISIONS.md#cursors-describe-first-for-binary-from-the-first-run): the one exception, amortised over a large result.
- [Which types are binary and which stay text](DECISIONS.md#which-types-are-binary-and-which-stay-text): measured per type, not dogmatic.
- [Binary array parameters, with a per-array fallback](DECISIONS.md#binary-array-parameters-with-a-per-array-fallback): binary when every element fits, a literal otherwise.
- [Arrays of text read as one latin1 string](DECISIONS.md#arrays-of-text-read-as-one-latin1-string): faster than decoding each element.
- [Generated, monomorphic row decoders](DECISIONS.md#generated-monomorphic-row-decoders): straight-line code with no per-row garbage.
- [Decoder factories found by result shape, not by their source](DECISIONS.md#decoder-factories-found-by-result-shape-not-by-their-source): an unprepared statement finds its decoder without generating its source.
- [`nest` marks a joined row with `ctid`](../DECISIONS.md#nest-marks-a-joined-row-with-ctid) (quarry's decisions): why a nested object's marker is a `ctid` test, which is what the decoder's `true` check relies on.
- [Named types resolved once per pool through the catalog](DECISIONS.md#named-types-resolved-once-per-pool-through-the-catalog): enums and extension types work like built-ins.
- [`undefined` is refused, never sent as NULL](DECISIONS.md#undefined-is-refused-never-sent-as-null): a missing value is a bug, not NULL.

## Glossary

**Array literal**: an array's text format, `{1,2,NULL}`.

**Catalog** (`pg_type`): Postgres's table of types; `TypeCatalog` is the driver's lookup of it.

**Codec**: an object that encodes and decodes one Postgres type.

**Domain**: a type defined as another type plus constraints; reported in RowDescription as its base type.

**Format**: text (0) or binary (1), per parameter and per result column.

**Hidden class**: V8's internal description of an object's shape; objects created the same way share one.

**Marker**: the column a [nested object](#nested-objects) replaces; true where the object exists.

**Nested object**: columns of a result read into one object of the row (`nested`), `null` where its marker is false.

**OID**: a type's number in Postgres.

**Registry**: the map from type OID to codec for columns no query typed.

**Result plan**: per result shape, which codec and format reads each column.

**Text-like**: a type whose binary format is its UTF-8 text (`text`, `varchar`, `bpchar`, `name`, `char`).

**Wire value**: what Bind carries for a parameter: text, binary bytes, or NULL.
