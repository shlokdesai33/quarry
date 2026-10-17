# The compiler: from nodes to SQL

[compile.ts](compile.ts) has one exported function, `compile(node)`, that turns a query's node tree into what the driver runs: SQL text, the parameter values, and the codec of each parameter and result column. This guide walks through it.

Background: builders produce nodes ([QUERIES.md](QUERIES.md)); expressions produce nodes ([EXPRESSIONS.md](EXPRESSIONS.md)); all node types are in [node.ts](node.ts).

## Contents

- [Input and output](#input-and-output)
- [The parameter list](#the-parameter-list)
- [Rendering expressions: `render()`](#rendering-expressions-render)
- [Identifiers and literals](#identifiers-and-literals)
- [`and`, `or` and precedence](#and-or-and-precedence)
- [Select](#select)
- [Locking clauses](#locking-clauses)
- [Insert](#insert)
- [Upserts: `on conflict`](#upserts-on-conflict)
- [Update and `updateMany`](#update-and-updatemany)
- [Delete](#delete)
- [`returning`](#returning)
- [Result codecs](#result-codecs)
- [Errors the compiler raises](#errors-the-compiler-raises)
- [`toSQL()` and when compiling happens](#tosql-and-when-compiling-happens)
- [Why it is built this way](#why-it-is-built-this-way)
- [Glossary](#glossary)

## Input and output

```ts
export function compile(node: StatementNode): CompiledQuery;

type StatementNode = OperationNode | InsertNode | UpdateNode | DeleteNode;

interface CompiledQuery {
	readonly sql: string;
	readonly params: readonly unknown[]; // values, as given (not encoded)
	readonly paramCodecs?: readonly (Codec | undefined)[]; // per parameter
	readonly resultCodecs?: readonly (Codec | null)[]; // per result column
	readonly tag?: string;
}
```

A `SelectNode` is an `OperationNode` (a select can appear inside expressions in principle), so `compile` dispatches on `node.kind`: `insert`, `update`, `delete`, or anything else through `render`.

The returned object is a `Compiled` instance whose codecs are **getters over private fields**, not own properties:

```ts
class Compiled implements CompiledQuery {
	readonly sql: string;
	readonly params: readonly unknown[];
	readonly #paramCodecs;
	readonly #resultCodecs;
	get paramCodecs() {
		return this.#paramCodecs;
	}
	get resultCodecs() {
		return this.#resultCodecs;
	}
}
```

So `console.log(query.toSQL())`, `JSON.stringify`, and `expect(compiled).toEqual({ sql, params })` in tests see only `sql`, `params` (and `tag`), not a wall of codec objects. A copy made with `{ ...compiled }` drops the codecs, and the driver falls back to encoding values by their JavaScript type. `tag` is set with `Object.assign` only when present, so it is absent rather than `undefined` in comparisons.

## The parameter list

```ts
interface Params {
	values: unknown[];
	codecs: (Codec | undefined)[];
	typed: boolean;
}

function param(params: Params, value: unknown, codec?: Codec): string {
	params.values.push(value);
	params.codecs.push(codec);
	if (codec !== undefined) params.typed = true;
	return `$${params.values.length}`;
}
```

Rendering is a single left-to-right walk, so parameters are numbered **in the order they appear in the SQL text**. A value node renders as its placeholder and records its value and codec at the same index. `paramCodecs` is only returned when at least one parameter has a codec (`typed`); a query whose parameters are all untyped has none.

Values are passed through **as given**. The compiler never encodes them: the driver encodes each one with its codec ([driver/CODECS.md](driver/CODECS.md)).

## Rendering expressions: `render()`

`render(node, params)` is a `switch` over the node kinds:

| Node         | Renders as                                                      | Example                                            |
| ------------ | --------------------------------------------------------------- | -------------------------------------------------- |
| `reference`  | `"table"."column"`                                              | `"users"."created_at"`                             |
| `value`      | `$n`, recording the value and codec                             | `$1`                                               |
| `value_list` | `(a, b, …)`                                                     | `($3, $4)`                                         |
| `literal`    | quoted string, or `String(value)`                               | `'theme'`, `true`, `null`, `0`                     |
| `binary`     | `left op right`, operands parenthesised if they are comparisons | `"users"."age" >= $1`                              |
| `and` / `or` | see [below](#and-or-and-precedence)                             | `(a and b)`                                        |
| `not`        | `not (operand)`                                                 | `not ("users"."admin" = $1)`                       |
| `function`   | `name(args, …)`                                                 | `lower("users"."email")`, `count(*)`               |
| `raw`        | fragments interleaved with rendered nodes                       | `cast(count(*) as integer)`, `x between $1 and $2` |
| `select`     | a whole select ([below](#select))                               |                                                    |

`raw` nodes are internal only: `fragments` has one more element than `nodes`, and they alternate starting with a fragment. The fragments are fixed strings from quarry's own code (`'cast('`, `' as integer)'`, `' and '`, `'*'`), never user input.

`renderOperand` wraps an operand in parentheses when it is itself a comparison (`rendersAsBinary`), so Postgres's operator precedence can't regroup it: `(a = b) = true`, `("users"."settings" -> 'beta') = $1`. A single-operand `and`/`or` renders as its operand, so it is treated as what it contains.

## Identifiers and literals

```ts
function identifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}
```

Every table and column name is double-quoted, with embedded quotes doubled. Quoting always is simpler than deciding when it's needed, and keeps names exactly as written: unquoted identifiers are folded to lower case by Postgres, so `createdAt` would become `createdat`. (The human-readable SQL that `db.verify` suggests uses a different function, [verify/sql.ts](verify/sql.ts) `quoteIdentifier`, which only quotes when necessary.)

### Literals

<a id="literals"></a>
A few values must be written into the SQL text because Postgres won't take a parameter there (`LiteralNode` in [node.ts](node.ts)):

- `is null`, `is true`, `is false` (and `is not …`): the keyword after `is` can't be a parameter;
- jsonb path keys (`-> 'theme'`), so a query matches an expression index written the same way;
- the result of an empty `in` (`false`/`true`).

Strings are escaped like Postgres's own `quote_literal`:

```ts
function stringLiteral(value: string): string {
	if (value.includes('\0'))
		throw new Error('A string literal cannot contain a NUL character');
	const quoted = value.replaceAll("'", "''");
	return value.includes('\\')
		? `E'${quoted.replaceAll('\\', '\\\\')}'`
		: `'${quoted}'`;
}
```

Single quotes are doubled. If the string contains a backslash, it is written as an `E'…'` string with backslashes doubled: in an `E` string a backslash is always an escape character, so this reads the same whatever the server's `standard_conforming_strings` setting is. NUL can't appear in Postgres text at all. Numbers must be finite (jsonb array indexes are checked to be integers in [json.ts](json.ts)).

## `and`, `or` and precedence

```ts
function renderLogical(operands, operator, empty, params) {
	const [first, ...rest] = operands;
	if (first === undefined) return empty; // 'true' for and, 'false' for or
	if (rest.length === 0) return render(first, params);
	return `(${operands.map((o) => render(o, params)).join(` ${operator} `)})`;
}
```

- An empty `and` is `true` (all of nothing holds); an empty `or` is `false`. Both are what you'd want from `eb.and(conditions)` with a computed, possibly empty list.
- One operand renders alone, unparenthesised.
- Several are joined and **always** parenthesised, so mixing `and` and `or` never depends on SQL's precedence (`and` binds tighter than `or`, which surprises people).

So `.where(a).where((eb) => eb.or([b, c]))` renders `where (a and (b or c))`.

## Select

`renderSelect` builds the clauses in SQL's required order:

```
select <expr> as "<alias>", …
from "<table>" [as "<alias>"]
[inner join "<table>" [as "<alias>"] on <condition>] …
[where <condition>]
[limit $n]
[for <strength> [of "<table>", …] [skip locked | nowait]] …
```

Every selected entry is aliased to its key in the result row, including plain columns (`"users"."created_at" as "createdAt"`), so the driver returns rows keyed the way your TypeScript names them. An empty select list renders `select from …`, which Postgres accepts (rows with no columns).

`limit` is a parameter without a codec: the driver sends the number as text and the server infers its type.

Example, from `toSQL()`:

```ts
selectFrom(posts)
	.innerJoin(users)
	.on('users.id', 'posts.authorId')
	.where('users.role', 'admin')
	.where((eb) =>
		eb.or([
			eb.ref('users.email').like('%@example.com'),
			eb.ref('users.name').isNull(),
		]),
	)
	.where((eb) => eb.ref('posts.id').in(['1', '2']))
	.select(['posts.title', 'users.email'])
	.limit(10);
```

```sql
select "posts"."title" as "title", "users"."email" as "email"
from "posts" inner join "users" on "users"."id" = "posts"."author_id"
where ("users"."role" = $1 and ("users"."email" like $2 or "users"."name" is null) and "posts"."id" in ($3, $4))
limit $5
-- params:      ['admin', '%@example.com', '1', '2', 10]
-- paramCodecs: [user_role, varchar, int8, int8, (none)]
-- resultCodecs: [text, varchar]
```

(The SQL is one line in reality; it is broken up here for reading.)

## Locking clauses

```ts
function renderLock(lock) {
	let sql = ` for ${lock.strength}`; // update | no key update | share | key share
	if (lock.of.length > 0) sql += ` of ${lock.of.map(identifier).join(', ')}`;
	if (lock.wait !== undefined) sql += ` ${lock.wait}`; // skip locked | nowait
	return sql;
}
```

`for update of "posts" skip locked` locks the matched rows of `posts` until the transaction ends, skipping rows another transaction already locked: the standard way for workers to claim jobs from a queue table without blocking each other. ([QUERIES.md](QUERIES.md#row-locking) explains the strengths.)

Postgres rejects a locking clause on a query with aggregates. The compiler checks first, so the error is clear: `hasAggregate` walks each selection's node looking for a `function` node named `count`, `min` or `max` (the aggregates `eb.fn` builds), and throws "A locking clause (forUpdate() and the like) cannot be used with aggregate functions".

## Insert

`renderInsert` chooses between three forms ([node.ts](node.ts) `RowsNode`):

**No columns** (every column has a default): `insert into "t" default values`. Only valid for one row.

**`values`**: one tuple per row; a value the row didn't give is the keyword `default`:

```sql
insert into "users" ("email", "name", "role") values ($1, $2, $3), ($4, $5, default)
```

The columns are the union of the keys the rows have, in the order they first appear (`rowsNode` in [write-query.ts](write-query.ts)).

**`unnest`**: one **array parameter per column**, for many rows:

```sql
insert into "users" ("email", "name") select * from unnest($1::varchar[], $2::text[])
-- params: [['a@x', 'b@x'], ['A', null]]
-- paramCodecs: [varchar[], text[]]
```

`values([...])` with an array asks for `unnest`; `renderInsert` uses it only when `unnestable(rows)`: every cell is a plain value (no expression, no `default` hole) and no column is itself an array type (`unnest` would flatten it). Otherwise it falls back to `values`.

Why `unnest`? With `values`, 1,000 rows of 5 columns is 5,000 parameters and a different SQL text for every row count, so every batch size is a new prepared statement and the protocol's 65,535-parameter limit caps the batch. With `unnest`, the SQL is the same for any number of rows (one cached statement), there are always as many parameters as columns, and each column travels as one array, in binary for the common types.

The casts (`$1::varchar[]`) pin each array's type, so the server knows it without inferring. They are written **without modifiers** (`varchar`, not `varchar(320)`): a cast to `varchar(3)` would silently truncate longer values, whereas assigning to the column rejects them. Since the cast pins the type, the array codec is passed through `declareParamType`, which declares its OID even for text-like types that normally let the server infer it, and lets arrays of text-like types go in binary ([driver/CODECS.md](driver/CODECS.md#declaring-parameter-types)).

## Upserts: `on conflict`

```sql
insert into "users" ("email", "name") values ($1, $2)
on conflict ("email") do update set "name" = "excluded"."name"
```

- `on conflict (target)` names the unique columns; `where …` after it names a partial unique index's predicate.
- `do nothing` keeps the existing row.
- `merge(columns?)` sets each listed column (by default, every inserted column) from `excluded`, the row the insert proposed: `"email" = excluded."email", "name" = excluded."name"`.
- `doUpdate((excluded) => ({ … }))` sets what you return; `excluded.name` is a reference node to table `excluded` (rendered `"excluded"."name"`).
- An upsert that would set nothing throws ("An upsert that merges needs columns to set").

## Update and `updateMany`

```sql
update "users" set "name" = $1 where "users"."id" = $2 returning "users"."id" as "id", "users"."name" as "name"
```

`renderUpdate` requires something to set and either a `where`, `allRows()`, or `updateMany` rows: an update of every row only happens if you say so (the types enforce this too, see [TYPES.md](TYPES.md#builder-state-in-type-parameters)).

`updateMany(table, rows, { by })` updates each row to its own values in one statement, joining the table with the rows sent as arrays:

```sql
update "users" set "name" = "quarry_rows"."name"
from unnest($1::integer[], $2::text[]) as "quarry_rows"("id", "name")
where "users"."id" = "quarry_rows"."id"
-- params: [[1, 2], ['A', 'B']]
```

The `by` columns match rows (`where "users"."id" = "quarry_rows"."id"`); the other columns are set from `quarry_rows`. Every row must set the same columns to plain values (`unnestable`), or it throws. A `where` added on top is and-ed with the match conditions, each parenthesised.

## Delete

```sql
delete from "users" where "users"."created_at" < $1
```

Like update, it requires `where` or `allRows()`.

## `returning`

Insert, update and delete can return rows. `renderReturning` renders the `returning` list exactly like a select list (`returning "users"."id" as "id"`), and its selections supply the result codecs.

## Result codecs

After rendering, `compile` collects the codec of each select-list (or `returning`) entry into `resultCodecs`, by position:

```ts
for (let i = 0; i < selections.length; i++) {
	const codec = selections[i]?.codec;
	if (codec === undefined) continue;
	resultCodecs ??= selections.map(() => null);
	resultCodecs[i] = codec;
}
```

A selection's codec comes from `selectionNodes` in [row.ts](row.ts): a column's `DataType.codec`, a typed expression's, a `Param`'s own codec, or none (`null` here) for an expression of unknown SQL type. The driver reads column _i_ with `resultCodecs[i]` as long as the column has that codec's type, and with its registry otherwise ([EXECUTION.md](EXECUTION.md#how-the-builder-picks-codecs)). `resultCodecs` is absent when no entry has a codec.

## Errors the compiler raises

| Message                                                                   | When                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| An insert needs at least one row                                          | `values([])`, or `toSQL()` before `values`                               |
| An insert of several rows needs at least one column to set                | several rows, all empty                                                  |
| An upsert that merges needs columns to set                                | `merge([])` with nothing inserted                                        |
| updateMany needs every row to set the same columns, each to a plain value | rows with different keys, or expressions                                 |
| An update needs columns to set                                            | no `set` and no `updateMany` columns                                     |
| An update needs where() or allRows()                                      | `toSQL()` on an update without either (`execute()` is a type error then) |
| A delete needs where() or allRows()                                       | the same, for a delete                                                   |
| A locking clause … cannot be used with aggregate functions                | `forUpdate()` with `count`/`min`/`max` selected                          |
| A string literal cannot contain a NUL character                           | a jsonb key with `\0`                                                    |

These are plain `Error`s: they are programming mistakes, not database errors.

## `toSQL()` and when compiling happens

Every builder and `Query` has `toSQL()`, which returns the same `CompiledQuery` that `execute()` sends. On a builder it compiles on each call. A **result shape** (`takeFirst()`, `expectOne()`, …, and `toQuery()`) compiles once, when the shape is applied, and the `Query` holds the result; `execute()` doesn't compile again. So a compile error surfaces when the shape is applied (or at `execute()` for a builder without a shape), not at the earlier builder calls.

## Why it is built this way

- **One renderer for every node**: quoting, numbering and parenthesising are written once. Builders and expressions only produce data.
- **References resolved before compiling**: nodes hold database names already, so `compile` needs no schema and can't get a name wrong.
- **Always quote identifiers**: no reserved-word list to keep in sync, and case is preserved.
- **Parameters in text order**: the placeholder numbering is the natural one, and identical queries produce identical SQL, so the driver's statement cache gets hits.
- **Values not encoded here**: encoding belongs to the codec, in the driver, so it happens once and in one place.
- **`unnest` for many rows**: constant SQL text and parameter count whatever the number of rows ([Insert](#insert)).
- **Codecs as getters**: compiled queries print and compare as `{ sql, params }`.

## Glossary

**Aggregate**: a function that combines many rows into one value (`count`, `min`, `max`).

**`excluded`**: in an upsert's `do update`, the row the insert proposed.

**Identifier**: a name of a table or column in SQL. Quoted identifiers (`"createdAt"`) keep their case.

**Literal**: a value written directly into SQL text (`'theme'`, `true`).

**Placeholder**: `$1`, `$2`, …: where a parameter goes in the SQL text.

**Upsert**: an insert that does something else (nothing, or an update) when the row conflicts with an existing one on a unique key.

**`unnest`**: a Postgres function that turns arrays into rows: `unnest(array[1,2], array['a','b'])` gives two rows of two columns.
