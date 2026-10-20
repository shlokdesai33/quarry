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
- [Update and `setEach`](#update-and-seteach)
- [Delete](#delete)
- [`returning`](#returning)
- [Result codecs](#result-codecs)
- [Errors the compiler raises](#errors-the-compiler-raises)
- [`toSQL()` and when compiling happens](#tosql-and-when-compiling-happens)
- [What is rendered once](#what-is-rendered-once)
- [Decisions](#decisions)
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

| Node         | Renders as                                                      | Example                                               |
| ------------ | --------------------------------------------------------------- | ----------------------------------------------------- |
| `reference`  | `"table"."column"`                                              | `"users"."created_at"`                                |
| `value`      | `$n`, recording the value and codec                             | `$1`                                                  |
| `value_list` | `(a, b, …)`                                                     | `($3, $4)`                                            |
| `literal`    | quoted string, or `String(value)`                               | `'theme'`, `true`, `null`, `0`                        |
| `binary`     | `left op right`, operands parenthesised if they are comparisons | `"users"."age" >= $1`                                 |
| `and` / `or` | see [below](#and-or-and-precedence)                             | `(a and b)`                                           |
| `not`        | `not (operand)`                                                 | `not ("users"."admin" = $1)`                          |
| `function`   | `name(args, …)`, or `name(distinct args)`                       | `lower("users"."email")`, `count(*)`                  |
| `case`       | `case when … then … [else …] end`                               | `case when "posts"."views" >= $1 then $2 else $3 end` |
| `raw`        | fragments interleaved with rendered nodes                       | `cast(count(*) as integer)`, `x between $1 and $2`    |
| `select`     | a whole select ([below](#select))                               |                                                       |

`raw` nodes are internal only: `fragments` has one more element than `nodes`, and they alternate starting with a fragment. The fragments are fixed strings from quarry's own code (`'cast('`, `' as integer)'`, `' and '`, `'*'`), never user input.

`renderOperand` wraps an operand in parentheses when it is itself an operation (`rendersAsOperation`: a `binary` node, which covers comparisons and arithmetic, or a `not`), so Postgres's operator precedence can't regroup it: `(a = b) = true`, `("users"."settings" -> 'beta') = $1`, `("posts"."views" + $1) * $2`, `(not (…)) is null`. The `not` case was a bug found by the SQL coverage audit (#32): `not` binds looser than `is`, so `not (a) is null` reads as `not ((a) is null)`. A single-operand `and`/`or` renders as its operand, so it is treated as what it contains.

## Identifiers and literals

```ts
function identifier(name: string): string {
  let quoted = identifiers.get(name); // memoised, bounded: see below
  if (quoted === undefined) {
    quoted = `"${name.replaceAll('"', '""')}"`;
    if (identifiers.size >= 4096) identifiers.clear();
    identifiers.set(name, quoted);
  }
  return quoted;
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
select [distinct | distinct on (<key>, …)] <expr> as "<alias>", …
from "<table>" [as "<alias>"]
[inner | left | right | full join "<table>" [as "<alias>"] on <condition> | cross join "<table>"] …
[where <condition>]
[group by <key>, …]
[having <condition>]
[order by <key> [asc | desc] [nulls first | nulls last], …]
[limit $n]
[offset $n]
[for <strength> [of "<table>", …] [skip locked | nowait]] …
```

A **key** of `distinct on`, `group by` or `order by` is an expression, or an `AliasNode` for a selected key of the row, rendered as the quoted alias (`order by "postCount" desc`), which Postgres resolves against the select list (`renderKey`). Direction and `nulls` are written only when given. `renderJoin` writes each join's kind and refuses a non-cross join without `on`.

Every selected entry is aliased to its key in the result row, including plain columns (`"users"."created_at" as "createdAt"`), so the driver returns rows keyed the way your TypeScript names them. An empty select list renders `select from …`, which Postgres accepts (rows with no columns).

`limit` and `offset` are parameters without a codec: the driver sends the numbers as text and the server infers their type.

With the clauses added in #32 (real `toSQL()`):

```sql
select "users"."id" as "id", "users"."name" as "name", count("posts"."id") as "postCount"
from "users" left join "posts" on "posts"."author_id" = "users"."id"
group by "users"."id" having count("posts"."id") >= $1
order by "postCount" desc, "users"."id" limit $2 offset $3
-- params: ['5', 20, 40]   paramCodecs: [int8, (none), (none)]
```

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

Postgres rejects a locking clause on a query with aggregates. The compiler checks first, so the error is clear: `hasAggregate` walks each selection's node (through functions, operations, lists, `case` branches and raw nodes) looking for a `function` node named `count`, `min`, `max`, `sum`, `avg`, `array_agg`, `string_agg`, `bool_and` or `bool_or` (the aggregates `eb.fn` builds), and throws "A locking clause (forUpdate() and the like) cannot be used with aggregate functions".

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

## Update and `setEach`

```sql
update "users" set "name" = $1 where "users"."id" = $2 returning "users"."id" as "id", "users"."name" as "name"
```

`renderUpdate` requires something to set and either a `where` or `allRows()`: an update of every row only happens if you say so (the types enforce this too, see [TYPES.md](TYPES.md#builder-state-in-type-parameters)).

An `UpdateNode` may also have a `from`: the rows of a `setEach` ([QUERIES.md](QUERIES.md#bulk-update-seteach)), `{ rows: RowsNode, alias }`. It renders as `from unnest($1::type[], …) as "alias"(columns)`, the same `renderUnnest` as multi-row inserts. The key match and the assignments are **ordinary** `SetNode`s and `where` conditions built by the builder (references to `"row"."col"`, and a `case` node for columns some rows leave out), so the compiler needs no special case for bulk updates:

```sql
update "products" set "price" = "row"."price"
from unnest($1::integer[], $2::numeric[]) as "row"("id", "price")
where ("products"."id" = "row"."id" and "products"."stock" > $3)
-- params: [[1, 2], ['9.99', '19.99'], 0]   paramCodecs: [int4[], numeric[], int4]
```

Every cell must be a plain value and no column an array type (`unnestable`), or it throws.

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

| Message                                                                                                    | When                                                                     |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| An insert needs at least one row                                                                           | `values([])`, or `toSQL()` before `values`                               |
| An insert of several rows needs at least one column to set                                                 | several rows, all empty                                                  |
| An upsert that merges needs columns to set                                                                 | `merge([])` with nothing inserted                                        |
| setEach sends its rows with unnest: every value must be a plain value, and array columns are not supported | a `setEach` with expression values or array columns                      |
| An update needs columns to set                                                                             | no `set` and no `setEach`                                                |
| A left join needs an on() condition                                                                        | (only reachable by casting around the types)                             |
| An update needs where() or allRows()                                                                       | `toSQL()` on an update without either (`execute()` is a type error then) |
| A delete needs where() or allRows()                                                                        | the same, for a delete                                                   |
| A locking clause … cannot be used with aggregate functions                                                 | `forUpdate()` with `count`/`min`/`max` selected                          |
| A string literal cannot contain a NUL character                                                            | a jsonb key with `\0`                                                    |

These are plain `Error`s: they are programming mistakes, not database errors.

## `toSQL()` and when compiling happens

Every builder and `Query` has `toSQL()`, which returns the same `CompiledQuery` that `execute()` sends. On a builder it compiles on each call. A **result shape** (`takeFirst()`, `expectOne()`, …, and `toQuery()`) compiles once, when the shape is applied, and the `Query` holds the result; `execute()` doesn't compile again. So a compile error surfaces when the shape is applied (or at `execute()` for a builder without a shape), not at the earlier builder calls.

## What is rendered once

A query is built and compiled from scratch each time it runs, but most of its SQL is the same every time: the quoted table and column names. Three caches keep that work out of the per-query path:

- **Shared column nodes.** `resolveColumn` ([expression-builder.ts](expression-builder.ts)) resolves each table's column once, into one `ReferenceNode`, one typed expression (what `eb.ref` returns) and one `SelectionNode` (what `select(['users.email'])` adds), kept per table object in a `WeakMap`. Every query over the table reuses them; nodes are immutable, so sharing is safe. A table of the same name (another `defineTable`, or `users.as('u')`) is another object, with its own nodes. `nameReference`, which records how a reference was written for the `undefined`-comparison error, now runs once per column instead of adding a `WeakMap` entry per reference per query.
- **Their SQL.** `shareColumn` renders a column's reference (`"users"."email"`) and selection (`"users"."email" as "email"`) when the column is first resolved, into the compiler's `shared` map; `render` and `renderSelection` look nodes up there before rendering them. Only these shared nodes go in: adding the nodes each query makes (values, comparisons, `.as()` selections) would cost a `WeakMap` entry per query, more than rendering them.
- **Quoted identifiers.** `identifier` memoises in a `Map`, cleared when it reaches 4,096 names, so aliases made at run time can't grow it without bound.

The builders also reuse a single table's expression builder (`expressionBuilder(users)` is made once and frozen; a scope of several tables is made per call), and the predicate `DataType`. Together with call sites captured only on failure ([EXECUTION.md](EXECUTION.md#errors)), a point lookup's build and compile went from 5.7 to 0.8 µs (in-process, mock executor), and its client CPU through the pool from 21 to under 5 µs ([DECISIONS.md](DECISIONS.md#columns-resolved-and-quoted-once-per-table)).

**Not cached: whole compiled queries.** A cache of SQL and parameter plans keyed by query shape was considered. Its key has to be computed from the query's own nodes, which are new on every call (the builder makes a fresh tree each time), so building the key is a walk of the same tree that rendering from cached fragments already is: it saves nothing measurable, and adds invalidation rules. What a reused SQL string would have saved in the driver (hashing the statement cache's key) is saved there instead: the cache is keyed by the SQL alone ([driver/DECISIONS.md](driver/DECISIONS.md#statements-keyed-by-their-sql-with-the-declared-types-compared)).

## Decisions

Why the compiler works this way. Each links to its full entry (what it is, why, the alternatives, the cost, measured impact) in [DECISIONS.md](DECISIONS.md):

- [A node tree, and one compiler](DECISIONS.md#a-node-tree-and-one-compiler): quoting, numbering and parenthesising are written once; builders only produce data.
- [References resolved before compiling](DECISIONS.md#references-resolved-before-compiling): `compile` needs no schema and can't get a name wrong.
- [Every identifier quoted](DECISIONS.md#every-identifier-quoted): no reserved-word list, and case is preserved.
- [Columns resolved and quoted once per table](DECISIONS.md#columns-resolved-and-quoted-once-per-table): shared, immutable column nodes whose SQL is rendered once; no whole-query cache.
- [Parameters everywhere, literals only where Postgres refuses a parameter](DECISIONS.md#parameters-everywhere-literals-only-where-postgres-refuses-a-parameter): injection-safe and cache-friendly, with checked exceptions.
- [Parameters numbered in text order, and `in` as `= any($1)`](DECISIONS.md#parameters-numbered-in-text-order-and-in-as--any1): identical queries give identical SQL, so the statement cache gets hits.
- [Every operation operand bracketed](DECISIONS.md#every-operation-operand-bracketed): no precedence table to get wrong.
- [Codecs as getters on the compiled query](DECISIONS.md#codecs-as-getters-on-the-compiled-query): compiled queries print and compare as `{ sql, params }`.
- [Many rows through `unnest`, one array per column](DECISIONS.md#many-rows-through-unnest-one-array-per-column): constant SQL text and parameter count whatever the number of rows.
- [`unnest` casts without type modifiers](DECISIONS.md#unnest-casts-without-type-modifiers): a too-long value is rejected, not truncated.
- [`setEach`: one method for the source, the assignments and the key match](DECISIONS.md#seteach-one-method-for-the-source-the-assignments-and-the-key-match): rendered with ordinary set and where nodes.
- [The driver owns the codecs; the builder only chooses them](DECISIONS.md#the-driver-owns-the-codecs-the-builder-only-chooses-them): values are not encoded here.

## Glossary

**Aggregate**: a function that combines many rows into one value (`count`, `sum`, `max`, …).

**`excluded`**: in an upsert's `do update`, the row the insert proposed.

**Identifier**: a name of a table or column in SQL. Quoted identifiers (`"createdAt"`) keep their case.

**Literal**: a value written directly into SQL text (`'theme'`, `true`).

**Placeholder**: `$1`, `$2`, …: where a parameter goes in the SQL text.

**Upsert**: an insert that does something else (nothing, or an update) when the row conflicts with an existing one on a unique key.

**`unnest`**: a Postgres function that turns arrays into rows: `unnest(array[1,2], array['a','b'])` gives two rows of two columns.
