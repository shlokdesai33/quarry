# The query builders and result shapes

This guide covers the four builders (select, insert, update, delete), what each method records, the **result shapes** that decide what `execute()` returns, and the errors they throw.

- Files: [select-query-builder.ts](select-query-builder.ts), [insert-query-builder.ts](insert-query-builder.ts), [update-query-builder.ts](update-query-builder.ts), [delete-query-builder.ts](delete-query-builder.ts), [write-query.ts](write-query.ts), [row.ts](row.ts), [shape.ts](shape.ts), [query.ts](query.ts), [executor.ts](executor.ts) (the error classes), [errors.ts](errors.ts).
- The type-level side of these builders (how the row type grows, how a builder knows it still needs a `where`) is in [TYPES.md](TYPES.md). The SQL they produce is in [COMPILER.md](COMPILER.md). Running them is in [EXECUTION.md](EXECUTION.md).

> **What exists on `main` today.** The [public README](../README.md#part-ii-the-query-builder) describes the query builder's intended 1.0 surface, and is ahead of the code in places. On `main`, the select builder has `where`, `innerJoin`, `select`, `when`, `pipe`, locking, `limit` and `tag`; there is no `orderBy`, `offset`, outer join, `groupBy`/`having`, `distinct`, subquery, CTE or raw-SQL helper yet. This guide documents what the code does now.

## Contents

- [How every builder is built](#how-every-builder-is-built)
- [Select](#select)
- [Row locking](#row-locking)
- [Insert](#insert)
- [Update](#update)
- [Delete](#delete)
- [Result shapes](#result-shapes)
- [Errors](#errors)
- [Inspecting a query: `toSQL`, `toNode`, `toQuery`, `describe`](#inspecting-a-query)
- [Why it is built this way](#why-it-is-built-this-way)
- [Glossary](#glossary)

## How every builder is built

Each builder class holds an immutable `#state` and returns a new instance from every method ([ARCHITECTURE.md](ARCHITECTURE.md#builders-are-immutable)). Their states:

```ts
interface SelectState<T> {
	tables: T; // the from table, then each joined table
	from: TableNode;
	joins: readonly JoinNode[];
	where: WhereBuilder<RefsOf<T>>; // conditions, joined by and
	selections: readonly SelectionNode[];
	limit: number | undefined;
	locks: readonly LockNode[];
	tag: string | undefined;
	executor: Executor | undefined; // undefined when built without a database
}
interface InsertState<T> {
	table;
	values: RowsNode;
	onConflict;
	returning;
	tag;
	executor;
}
interface UpdateState<T> {
	table;
	set: SetNode[];
	many;
	where;
	allRows: boolean;
	returning;
	tag;
	executor;
}
interface DeleteState<T> {
	table;
	where;
	allRows: boolean;
	returning;
	tag;
	executor;
}
```

`toNode()` turns a state into its node ([node.ts](node.ts)), which `compile()` renders. The `executor` never reaches the node: it is only used to run the query.

## Select

### Starting: `selectFrom`

`db.selectFrom(users)` (or the standalone `selectFrom(users)`, without an executor) calls `selectFromWith(table, executor)`, which creates the state: one table, `from` rendered from it, an empty `WhereBuilder` over an expression builder for that table, nothing selected.

### `where`

```ts
.where('users.role', 'admin')
.where((eb) => eb.ref('users.age').gte(18))
.where(predicate)
```

Each call adds one condition to the `WhereBuilder`; they are joined with `and`. The three forms are explained in [EXPRESSIONS.md](EXPRESSIONS.md#where-and-on-the-three-forms). `where` is declared as a **property** holding an arrow function, not a method, so that it can have the `Condition` overloaded call signatures while still being generic in the builder's types.

### Joins: `innerJoin(table).on(…)`

```ts
.innerJoin(contacts).on('contacts.userId', 'users.id')
.innerJoin(contacts).on((eb) => eb.and([eb.ref('contacts.userId').eq(eb.ref('users.id')), eb.ref('contacts.kind').eq('primary')]))
```

`innerJoin(table)` appends the table to `tables`, rescopes the `WhereBuilder` to the new list (so later `where`s can reference the joined table), and returns a `JoinBuilder`, which has only `on`. An **inner join** keeps only rows that have a match on both sides.

`JoinBuilder.#conditionOf` turns `on`'s arguments into a node: the two-column shorthand becomes `joined = earlier` (both resolved with `eb.ref`), a callback is called with an `eb` over every table including the joined one, a predicate is used as is. Self-joins need an alias (`users.as('managers')`), since two tables of the same name in scope would be ambiguous.

### `select`

```ts
.select(['users.id', 'contacts.email'])                   // keyed by column key
.select((eb) => [eb.fn.lower('users.email').as('email')]) // expressions need an alias
```

`selectionNodes(eb, list)` ([row.ts](row.ts)) makes one `SelectionNode` per entry: the expression's node, the **alias** (the column key after the dot, or the expression's alias), and the **codec** to read it with (the column's or typed expression's `DataType.codec`). Each `select` call appends; the row type grows with it ([TYPES.md](TYPES.md#part-6-result-row-types)).

Two selections with the same key are not merged: both are rendered, and the driver's object rows keep the last one.

### `when`: optional pieces

```ts
.when(onlyActive, (qb) => qb.where('users.status', 'active'))
.when(withEmail, (qb) => qb.select(['users.email']))   // email becomes optional in the row
```

`when(condition, build)` calls `build(this)` only if `condition` is true. It keeps the tables, so it can't join. Columns selected inside are optional in the row type, since they may be missing.

### `fragment` and `pipe`: reusable pieces

```ts
const active = fragment(users, (qb) => qb.where('users.status', 'active'));
const withContacts = fragment(users, (qb) =>
	qb.innerJoin(contacts).on('contacts.userId', 'users.id'),
);

db.selectFrom(users).pipe(withContacts).pipe(active).select(['contacts.email']);
```

`fragment(tables, build)` returns `build` itself: at run time it is the identity. Its job is typing: it fixes the tables the piece needs, so `build` gets a builder over exactly those tables. `pipe(piece)` calls `piece(this)` and keeps the builder it returns, whose state now includes the piece's conditions, joins and columns. At the type level, `pipe` checks that the piece's tables are in the query (`InScope`) and adds the tables it joins (`JoinedBy`) ([TYPES.md](TYPES.md#part-8-tricks-for-better-errors)).

### `limit` and `tag`

- `limit(count)` sets `limit $n` (a later call replaces it); it throws a `RangeError` unless `count` is a non-negative integer. No result shape adds a limit.
- `tag(name)` labels the query for `onQuery`, telemetry spans and error messages. It is never rendered into the SQL, so tagging doesn't change the statement the driver caches.

### Running: `execute`, `stream`, `describe`

- `execute(options?)` runs the query and resolves to every row (`O[]`). It is `this.toQuery().execute(options)`: the default shape.
- `stream(options?)` is an async generator over the rows, fetched through a **cursor** in batches of `batchSize` (default 1000), so a large result never sits in memory at once. Breaking out of the `for await` loop stops the query ([EXECUTION.md](EXECUTION.md#streaming)).
- `describe()` asks the server for the query's parameter types and result columns without running it.
- `options` (`RunOptions`): `signal` (an `AbortSignal` that cancels the query on the server) and `timeout` (a server-side statement timeout: milliseconds or an interval like `'2s'`).

## Row locking

### Why lock rows

When two programs change the same row at the same time, one can silently overwrite the other's change: both read a balance of 100, both add 10, both write 110. Databases prevent this with **transactions** (groups of statements that succeed or fail together, see [EXECUTION.md](EXECUTION.md#transactions)) and **locks**.

`select … for update` reads rows **and locks them** until the transaction ends: another transaction that tries to update, delete or lock the same rows waits. So "read, decide, write" inside one transaction is safe:

```ts
await db.transaction(async (tx) => {
	const job = await tx
		.selectFrom(jobs)
		.where('jobs.status', 'queued')
		.select(['jobs.id'])
		.forUpdate()
		.skipLocked()
		.limit(1)
		.takeFirst()
		.execute();
	if (job)
		await tx
			.update(jobs)
			.set({ status: 'running' })
			.where('jobs.id', job.id)
			.execute();
});
```

Outside a transaction, each statement is its own transaction, so the locks are released as soon as the select returns: useless. Hence the documentation's advice to run locking reads in `db.transaction`.

### The four strengths

| Method             | SQL                 | Blocks others from                                                                           | Typical use                                                 |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `forUpdate()`      | `for update`        | updating, deleting, and taking any lock on the rows                                          | you'll update or delete the rows                            |
| `forNoKeyUpdate()` | `for no key update` | the same, except `for key share` (so inserts referencing the rows by foreign key don't wait) | you'll update non-key columns (what a plain `update` takes) |
| `forShare()`       | `for share`         | updating, deleting, `for update`                                                             | the rows must not change while you read related data        |
| `forKeyShare()`    | `for key share`     | deleting, key-changing updates, `for update`                                                 | what a foreign key check takes                              |

### `of`, `skipLocked`, `noWait`

- `of(...tables)` limits the latest clause to some tables of the query (a table or its name/alias); the other tables' rows are read without a lock. It must come right after the strength.
- `skipLocked()`: rows another transaction has locked are skipped instead of waited for. Workers each claim a different job.
- `noWait()`: fail immediately with `LockNotAvailable` instead of waiting.
- A query can have several clauses, usually each `of` different tables (`.forUpdate().of(jobs).forShare().of(users)`); Postgres takes the strongest where they overlap.

The order rules are enforced by the `L` type parameter ([TYPES.md](TYPES.md#the-locking-clause-l)) and again at run time by `#modifyLock` (for code that casts around the types). The compiler rejects locking with aggregates ([COMPILER.md](COMPILER.md#locking-clauses)).

Result shapes add no `limit`, so **every row the query returns is locked**, even if `takeFirst()` decodes only one. Use `.limit(1)` to lock one.

## Insert

```ts
db.insertInto(users)
	.values({ email: 'ada@example.com', name: 'Ada' })
	.execute(); // { rowCount: 1 }
db.insertInto(users)
	.values([
		{ email: 'a@x', name: null },
		{ email: 'b@x', name: 'B' },
	])
	.execute();
db.insertInto(users).values(row).returning(['users.id']).expectOne().execute(); // { id: number }
```

- `values(row | rows)` takes rows of `InferInsertType<T>` (required columns must be present; columns with a default may be; identity and generated columns may not). It **replaces** values given before. One row renders `values (…)`; an array asks for `unnest` (one array parameter per column) when possible ([COMPILER.md](COMPILER.md#insert)). Each value becomes a value node with its column's codec, or an expression's node.
- A key whose value is `undefined` is skipped: the column gets its default. (In a type-correct program that only happens for optional columns.)
- `returning([...])` adds to the `returning` list, typed like a select list.
- `when(condition, build)` applies `build` conditionally; it can't satisfy `values` (its `M` stays the same).

### Upserts

```ts
.onConflict('email').doNothing()
.onConflict(['tenantId', 'slug']).merge(['title'])
.onConflict('email').doUpdate((excluded) => ({ name: excluded.name }))
.onConflict('email').where('users.deleted', false).doNothing()  // a partial unique index
.onConflict('email').merge(undefined, { where: (eb, excluded) => eb.ref('users.version').lt(excluded.version) })
```

`onConflict(target)` returns an `OnConflictBuilder` whose actions return the `InsertQueryBuilder` again. `excluded` is an object with one typed expression per column, referencing the proposed row ([write-query.ts](write-query.ts) `excluded()`), so `doUpdate` can set columns from it with the same types as `update().set()`.

## Update

```ts
db.update(users).set({ name: 'Ada' }).where('users.id', id).execute(); // { rowCount }
db.update(users)
	.set((eb) => ({ email: eb.fn.lower('users.email') }))
	.allRows()
	.execute();
db.updateMany(
	users,
	[
		{ id: 1, name: 'Ada' },
		{ id: 2, name: 'Alan' },
	],
	{ by: 'id' },
).execute();
```

- `set(values | (eb) => values)` takes columns of the update type, or expressions evaluating to it; read-only columns aren't offered. Calls **add up**: a column set again keeps its place and takes the new value (`setNodes` merges into a `Map` keyed by database name). An `undefined` value leaves its column out; if that leaves nothing, it throws (an update that sets nothing is almost always a bug).
- `where(…)` or `allRows()` is required before `execute()` (type-checked; `allRows()` exists so updating every row is a deliberate act).
- `updateMany(table, rows, { by })` updates many rows to different values in one statement ([COMPILER.md](COMPILER.md#update-and-updatemany)). Each row must have its `by` columns (checked at build time, with an error naming the missing ones) and may set any other writable columns.

## Delete

```ts
db.deleteFrom(users).where('users.id', id).execute();
db.deleteFrom(sessions)
	.where((eb) => eb.ref('sessions.expiresAt').lt(now))
	.returning(['sessions.id'])
	.execute();
db.deleteFrom(logs).allRows().execute();
```

The same `where` / `allRows` rule as update.

## Result shapes

A **result shape** says what `execute()` gives you from the rows a query returns. Every builder can produce a `Query<R>` ([query.ts](query.ts)) through one of them.

### The shapes

For selects (and for writes with `returning`):

| Shape                   | Resolves to                                        | Throws                                                             | Rows kept and decoded |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------ | --------------------- |
| (none) `execute()`      | `O[]` (writes without `returning`: `{ rowCount }`) | never for the row count                                            | all                   |
| `takeFirst()`           | `O \| undefined`                                   | never                                                              | 1                     |
| `takeValue()`           | the one column's value, or `undefined`             | never                                                              | 1, as an array row    |
| `expectNonEmpty(err?)`  | `[O, ...O[]]`                                      | `NoRowError` if no row                                             | all                   |
| `expectFirst(err?)`     | `O`                                                | `NoRowError` if no row                                             | 1                     |
| `expectOne(err?)`       | `O`                                                | `NoRowError` if none, `TooManyRowsError` (with `count`) if several | 2                     |
| `expectAtMostOne(err?)` | `O \| undefined`                                   | `TooManyRowsError` if several                                      | 2                     |
| `expectValue(err?)`     | the one column's value                             | `NoRowError` if no row                                             | 1, as an array row    |

For writes only:

| Shape                                      | Resolves to        | Throws                                            |
| ------------------------------------------ | ------------------ | ------------------------------------------------- |
| `expectNonEmpty(err?)` without `returning` | `{ rowCount }`     | `NoRowError` ("affected no row") if it wrote none |
| `expectRows(n, err?)`                      | as without a shape | `RowCountError` if it wrote a different number    |

Every `expect…` takes an optional `err` function that makes the error to throw instead: `.expectOne((e) => (e instanceof NoRowError ? new HttpError(404) : e))`.

`takeValue`/`expectValue` need a row of exactly one column: the row type doesn't record which column comes first, so with several it would be a guess. `ValueArgs` makes the call a type error otherwise ([TYPES.md](TYPES.md#part-8-tricks-for-better-errors)).

### How a shape works

A shape ([shape.ts](shape.ts)) is three things:

```ts
interface Shape<R> {
	read: (input: ShapeInput) => R; // rows → result, or throw
	checked: boolean; // can `read` throw? (expect… shapes)
	rows?: ReadOptions; // { keepRows?, rowMode? }: what the driver should return
}
```

`shapedQuery(executor, compiled, table, shape)` builds the `Query`:

```ts
return new Query({
	query,
	executor,
	checked: shape.checked,
	rows: shape.rows,
	read: ({ rows, rowCount }) =>
		shape.read({
			query,
			table,
			rows,
			count: Math.max(rowCount ?? 0, rows.length),
		}),
});
```

and `Query.execute` passes `shape.rows` to the executor along with your `RunOptions`, then calls `read` on the result.

- **`keepRows`**: the driver keeps only the first n rows, and **doesn't decode the rest** ([driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#keeprows)). The query still runs to completion and the row count still counts every row, so `expectOne` can report "returned 3 rows" while decoding only 2. Decoding is most of the client's work per row, so `takeFirst()` on a large result is cheap on the client (the server still produces every row; add `.limit(1)` to save that too).
- **`rowMode: 'array'`**: `takeValue` and `expectValue` ask for positional rows (`[value]` instead of `{ key: value }`), so reading the one value doesn't depend on its key.
- **`count`**: the row count from the server's command tag (`SELECT 3`), or the number of rows when that is larger.
- **`checked`**: tells `db.batch` whether reading the result can fail, which decides whether a transactional batch must wait for the results before committing ([EXECUTION.md](EXECUTION.md#batches)).

### Shapes never change the SQL

None of the shapes adds `limit 1` or `limit 2`. The SQL a query sends is the same whatever shape reads it:

- `toSQL()` shows exactly what runs;
- one statement per query in the driver's prepared-statement cache, whatever shape reads it;
- `forUpdate()` locks every row the query matches, not a number that depends on the shape;
- `expectOne()` can detect "several rows" honestly: it is not looking at a truncated result.

The cost, a query that returns many rows when you only read one, is mostly paid by the server; `keepRows` removes the client-side cost.

### Names that tell you whether they throw

`take…` never throws for the number of rows; `expect…` does. You can read `await q.takeFirst().execute()` and know it can't fail on an empty table, without reading any docs. This rule shaped the names (there is no `first()`, `one()` or `maybeOne()`).

## Errors

### Result-shape errors ([executor.ts](executor.ts))

| Class              | Properties                                      | Message                                                              |
| ------------------ | ----------------------------------------------- | -------------------------------------------------------------------- |
| `NoRowError`       | `table`, `query` (hidden)                       | The query on "users" returned no row, where exactly one was expected |
| `TooManyRowsError` | `table`, `count`, `query` (hidden)              | The query on "users" returned 3 rows, where exactly one was expected |
| `RowCountError`    | `expected`, `actual`, `table`, `query` (hidden) | The query on "docs" affected 0 rows, where 1 was expected            |

`table` is the query's `from` table (or the written table) by its database name. `query` (the `CompiledQuery`) is set with `Object.defineProperty` and not enumerable (`hideQuery`), so logging the error or `JSON.stringify` doesn't print parameter values, which may be personal data or secrets.

A write that fails an `expect…` check has **already run**: inside a transaction, the thrown error rolls it back; outside one, the change stays.

### `BatchError` ([batch.ts](batch.ts))

When queries of a non-transactional `db.batch` fail, the others have run and stay committed. The batch rejects with a `BatchError` (an `AggregateError`) whose `results` has every query's outcome by position and `errors` the failures ([EXECUTION.md](EXECUTION.md#batches)).

### Database errors

Errors from the server are the driver's `PostgresError` classes (`UniqueViolation`, `ForeignKeyViolation`, `SerializationFailure`, …, see [driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#errors)), re-exported from `quarry`. The executor attaches the query and your call site ([EXECUTION.md](EXECUTION.md#errors)).

### `violatedColumns(error, table)`

[errors.ts](errors.ts). A unique violation names database columns (`email_address`); your code knows TypeScript keys (`email`). `violatedColumns(error, users)` maps them back, using the error's `columns` (from its `column` field, or parsed from a `Key (a, b)=(…)` detail) and the table's `columnName`s. It returns `undefined` when the error is about another table or names something the table doesn't have (an expression in a unique index).

## Inspecting a query

<a id="inspecting-a-query-tosql-tonode-toquery-describe"></a>

| Method          | On                | Returns                                                                       |
| --------------- | ----------------- | ----------------------------------------------------------------------------- |
| `toSQL()`       | builders, `Query` | the `CompiledQuery` that runs: `{ sql, params }` (+ codecs as getters, `tag`) |
| `toNode()`      | builders          | the node tree                                                                 |
| `toWhereNode()` | select builder    | the `where` clause's node, or `undefined`                                     |
| `toQuery()`     | builders, `Query` | the `Query` that `execute()` runs: the default shape (for `db.batch`)         |
| `describe()`    | select builder    | the server's parameter and column types, without running                      |

## Why it is built this way

- **One immutable state object per builder**: every method is a copy-with-one-change, easy to read and impossible to mutate by accident.
- **Write builders refuse to run without their required clauses** (types, then compile-time checks): an `update` or `delete` of every row has to be written as `allRows()`.
- **Shapes separate from the SQL**, and **names that say whether they throw**: see [above](#shapes-never-change-the-sql).
- **`keepRows` instead of `limit`**: the client avoids decoding rows it won't use without changing what the server runs.
- **No `orWhere`**: precedence is always explicit through `eb.or`.
- **`set` merges, `values` replaces**: an update naturally accumulates assignments; inserting rows twice would be ambiguous.

## Glossary

**Cursor**: a server-side position in a query's result, read a batch at a time.

**Inner join**: a join that keeps only rows with a match on both sides.

**Lock**: a server-side mark on rows that makes other transactions wait (or skip, or fail) before changing them.

**Result shape**: what `execute()` makes of a query's rows.

**`returning`**: the clause that makes a write return rows (`insert … returning id`).

**Row count**: how many rows a statement returned or changed.

**Transaction**: statements that commit (take effect) together or not at all.

**Upsert**: an insert with `on conflict` handling.
