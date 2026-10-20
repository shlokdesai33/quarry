# The query builders and result shapes

This guide covers the four builders (select, insert, update, delete), what each method records, the **result shapes** that decide what `execute()` returns, and the errors they throw.

- Files: [select-query-builder.ts](select-query-builder.ts), [insert-query-builder.ts](insert-query-builder.ts), [update-query-builder.ts](update-query-builder.ts), [delete-query-builder.ts](delete-query-builder.ts), [write-query.ts](write-query.ts), [row.ts](row.ts), [shape.ts](shape.ts), [query.ts](query.ts), [executor.ts](executor.ts) (the error classes), [errors.ts](errors.ts).
- The type-level side of these builders (how the row type grows, how a builder knows it still needs a `where`) is in [TYPES.md](TYPES.md). The SQL they produce is in [COMPILER.md](COMPILER.md). Running them is in [EXECUTION.md](EXECUTION.md).

The builders on `main` cover everyday SQL: inner, outer and cross joins, `distinct`/`distinct on`, `group by`/`having`, `order by`, `limit`/`offset`, row locks, `case`, arithmetic, aggregates and raw `sql` fragments, plus keyset pagination ([PAGINATION.md](PAGINATION.md)) and streaming. Subqueries, CTEs, set operations and `insert … select` are not built yet.

## Contents

- [How every builder is built](#how-every-builder-is-built)
- [Select](#select)
- [Row locking](#row-locking)
- [Insert](#insert)
- [Update](#update)
- [Bulk update: `setEach`](#bulk-update-seteach)
- [Delete](#delete)
- [Whole statements: `db.sql`](#whole-statements-dbsql)
- [Result shapes](#result-shapes)
- [Errors](#errors)
- [Inspecting a query: `toSQL`, `toNode`, `toQuery`, `describe`](#inspecting-a-query)
- [Decisions](#decisions)
- [Glossary](#glossary)

## How every builder is built

Each builder class holds an immutable `#state` and returns a new instance from every method ([ARCHITECTURE.md](ARCHITECTURE.md#builders-are-immutable)). Their states:

```ts
interface SelectState<T> {
  tables: T; // the from table, then each joined table
  from: TableNode;
  joins: readonly JoinNode[]; // { kind: 'inner' | 'left' | 'right' | 'full' | 'cross', table, on }
  where: WhereBuilder<RefsOf<T>>; // conditions, joined by and
  distinct: true | readonly (OperationNode | AliasNode)[] | undefined;
  selections: readonly SelectionNode[];
  groupBy: readonly (OperationNode | AliasNode)[];
  having: WhereBuilder<RefsOf<T>>;
  orderBy: readonly OrderNode[];
  limit: number | undefined;
  offset: number | undefined;
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
interface UpdateState<T, R> {
  table;
  scope: readonly AnyTable[]; // the table, plus the rows of a setEach
  eb: ExpressionBuilder<R>; // over that scope
  set: SetNode[];
  from: UpdateFromNode | undefined; // setEach's rows: unnest(...) as alias(columns)
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

`db.selectFrom(users)` (or the standalone `selectFrom(users)`, without an executor) calls `selectFromWith(table, executor)`, which creates the state: one table, `from` rendered from it, empty `WhereBuilder`s for `where` and `having` over an expression builder for that table, nothing selected.

### `where` and `having`

```ts
.where('users.role', 'admin')
.where((eb) => eb.ref('users.age').gte(18))
.where(predicate)
.having((eb) => eb.fn.count('posts.id').gte('5'))
```

Each call adds one condition to its `WhereBuilder`; they are joined with `and`. The three forms are explained in [EXPRESSIONS.md](EXPRESSIONS.md#where-and-on-the-three-forms). `having` takes the same forms and filters the groups of `groupBy` (or the single group of an aggregate query). Both are declared as **properties** holding an arrow function, not methods, so that they can have the `Condition` overloaded call signatures while still being generic in the builder's types.

### Joins

```ts
.innerJoin(contacts).on('contacts.userId', 'users.id')
.leftJoin(posts).on('posts.authorId', 'users.id')      // posts.* nullable in the row
.rightJoin(teams).on('teams.id', 'users.teamId')       // the earlier tables nullable
.fullJoin(archive).on('archive.postId', 'posts.id')    // both sides nullable
.crossJoin(regions)                                     // every pair of rows, no condition
```

Every join goes through `#joined(table)`: it refuses a table whose name is already in the query (a second `users` would make every `users.…` reference ambiguous; join it as `users.as('managers')`), appends the table to `tables`, and **rescopes** the `where` and `having` builders to the new list, so later conditions can reference the joined table. Except `crossJoin`, each returns a `JoinBuilder`, which has only `on`. Its `#conditionOf` turns `on`'s arguments into a node: the two-column shorthand becomes `joined = earlier` (both resolved with `eb.ref`), a callback gets an `eb` over every table including the joined one, a predicate is used as is.

- An **inner join** keeps only rows with a match on both sides.
- A **left join** also keeps the left rows with no match, with NULLs for the joined table's columns. So the joined table enters the scope as `NullableTable<J>` ([table.ts](table.ts)): the same table at run time, but at the type level every column's `$select` gains `| null`. Only the selected type changes; the SQL type, comparison methods and codec stay the column's ([TYPES.md](TYPES.md#outer-joins-nullabletable)).
- A **right join** keeps the joined table's unmatched rows, so the tables joined **before** become nullable, including columns already selected (the row type `O` becomes `NullableRow<O>`).
- A **full join** keeps unmatched rows on both sides: everything nullable.
- A **cross join** pairs every row with every row (`JoinNode.on` is `undefined`; the compiler refuses a non-cross join without one).

### `select` and `selectAll`

```ts
.select(['users.id', 'contacts.email'])                   // keyed by column key
.select((eb) => [eb.fn.lower('users.email').as('email')]) // expressions need an alias
.selectAll('users')                                       // every column of one table
.selectAll('u')                                           // by its alias, after selectFrom(users.as('u'))
```

`selectionNodes(eb, list)` ([row.ts](row.ts)) makes one `SelectionNode` per entry (a column's is made once per table and shared): the expression's node, the **alias** (the column key after the dot, or the expression's alias), and the **codec** to read it with (the column's or typed expression's `DataType.codec`). Each call appends; the row type grows with it ([TYPES.md](TYPES.md#part-6-result-row-types)).

- **Each key can be in the row once.** Selecting a second `id` is a type error (`UniqueKeys`, an impossible extra argument naming the duplicate) and a build-time error (`checkUniqueKeys`); `.as('managerId')` resolves it. Before #32, two `id`s were both rendered and the driver's object row silently kept the last.
- **`selectAll` lists the columns**, never `select *`: each column keeps its TypeScript key (`createdAt` from `created_at`) and its codec, and the SQL doesn't change meaning if the table gains a column.
- **`selectAll` takes the name the table goes by** in the query (its alias, or its name when not aliased), and only that: not a table object, and no argument-less "every table" form.

### `distinct`, `distinctOn`, `groupBy`, `orderBy`, `limit`, `offset`

```ts
.distinct()
.distinctOn(['posts.authorId']).orderBy('posts.authorId').orderBy('posts.createdAt', 'desc') // latest post per author
.groupBy(['users.id'])
.groupBy((eb) => [eb.fn.dateTrunc('month', 'orders.createdAt')])
.orderBy('postCount', 'desc')                          // a selected key of the row
.orderBy((eb) => eb.fn.lower('users.name'), 'asc', { nulls: 'last' })
.limit(20).offset(40)
```

- A **key** (for `groupBy`, `orderBy`, `distinctOn`) is a column reference (`'users.id'`), a **selected key** of the row (`'postCount'`, rendered as the quoted alias, an `AliasNode`), an expression, or a callback making one (`#keys`). A string with a dot is always read as a column reference.
- `orderBy` calls add keys; `direction` and `nulls` are left out of the SQL unless given, so Postgres's defaults apply (ascending; nulls last ascending, first descending).
- `distinct()` compares whole rows; `distinctOn(keys)` keeps the first row of each group of equal keys, by `orderBy`, whose leading keys must be the same (Postgres checks).
- `groupBy` doesn't check at the type level that every selected column is grouped or aggregated; Postgres does.
- `limit(count)` and `offset(count)` take non-negative integers (`RangeError` otherwise); a later call replaces the earlier. Both are parameters. No result shape adds either ([below](#shapes-never-change-the-sql)).

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

`fragment(tables, build)` returns `build` itself: at run time it is the identity. Its job is typing: it fixes the tables the piece needs, so `build` gets a builder over exactly those tables. `pipe(piece)` calls `piece(this)` and keeps the builder it returns, whose state now includes the piece's conditions, joins and columns. At the type level, `pipe` checks that the piece's tables are in the query (`InScope`) and adds the tables it joins (`JoinedBy`, which since #32 also carries the piece's row and lock types) ([TYPES.md](TYPES.md#part-8-tricks-for-better-errors)).

### `tag`

`tag(name)` labels the query for `onQuery`, telemetry spans and error messages. It is never rendered into the SQL, so tagging doesn't change the statement the driver caches.

### Running: `execute`, `stream`, `describe`, pagination

- `execute(options?)` runs the query and resolves to every row (`O[]`). It is `this.toQuery().execute(options)`: the default shape.
- `stream(options?)` returns a **`RowStream<O>`** ([driver/row-stream.ts](driver/row-stream.ts)): an async iterator over the rows, read through a **cursor** `batchSize` rows (default 1000) at a time, each batch fetched only when the rows before it have been taken. Nothing runs until the first row is asked for; a bad `batchSize` throws a `RangeError` at once. Leaving the loop early (`break`, `return`, a throw, `await using`) closes the cursor and frees its connection. Inside `db.transaction`, other queries of the transaction can run between batches. Only every-row reads stream: the `take…`/`expect…` shapes read a whole result and have no `stream` ([EXECUTION.md](EXECUTION.md#streaming), [driver/STREAMING.md](driver/STREAMING.md)).
- `iterateChunks(size, { by })`, `paginateByCursor({ perPage, by, after })` and `paginateByOffset({ page, perPage, by })` read the result batch by batch or page by page with keyset (or offset) pagination ([PAGINATION.md](PAGINATION.md)).
- `describe()` asks the server for the query's parameter types and result columns without running it.
- `options` (`RunOptions`): `signal` (an `AbortSignal` that cancels the query on the server) and `timeout` (a server-side statement timeout: milliseconds or an interval like `'2s'`; for a stream it bounds the whole stream, the loop's time included, and is refused inside a transaction).

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
db.update(posts)
  .set((eb) => ({ views: eb.ref('posts.views').plus(1) })) // an increment
  .where('posts.id', id)
  .execute();
```

- `set(values | (eb) => values)` takes columns of the update type, or expressions evaluating to it; read-only columns aren't offered. Calls **add up**: a column set again keeps its place and takes the new value (`setNodes` merges into a `Map` keyed by database name). An `undefined` value leaves its column out; if that leaves nothing, it throws (an update that sets nothing is almost always a bug).
- `where(…)` or `allRows()` is required before `execute()` (type-checked; `allRows()` exists so updating every row is a deliberate act).
- Increments and the like are arithmetic on the column ([EXPRESSIONS.md](EXPRESSIONS.md#arithmetic)): `"posts"."views" + $1` is computed by the server from the current value, so concurrent increments don't lose updates.
- `returning([...])` and `returningAll()` add to the `returning` list (the latter every column, listed, never `*`); a key returned twice is rejected, as in a select.

## Bulk update: `setEach`

"Update these N rows, each to its own values" is `setEach` on the regular update builder ([update-query-builder.ts](update-query-builder.ts)), added in #30 (it replaced `updateMany`):

```ts
await db
  .update(products)
  .setEach(
    [
      { id: 1, price: '9.99', stock: 12 },
      { id: 2, price: '19.99' }, // leaves stock as it is
    ],
    { key: 'id' }, // or { key: ['tenantId', 'sku'] }
  )
  .expectRows(2)
  .execute();
```

compiles to (real `toSQL()`):

```sql
update "products" set "price" = "row"."price",
  "stock" = case when "row"."set:stock" then "row"."stock" else "products"."stock" end
from unnest($1::integer[], $2::numeric[], $3::integer[], $4::boolean[]) as "row"("id", "price", "stock", "set:stock")
where "products"."id" = "row"."id"
-- params: [[1, 2], ['9.99', '19.99'], [12, null], [true, false]]
-- paramCodecs: [int4[], numeric[], int4[], bool[]]
```

How it is built, step by step (`setEach` in [update-query-builder.ts](update-query-builder.ts)):

1. **Checks** (`checkEachRows`), for what the types can't rule out: no rows; a row whose key is missing or null; two rows with the same key (Postgres would pick one of them at random; the error reports row indexes, never values); `as` equal to the table's name; a second `setEach`.
2. **Rows as columns**: `rowsNode(table, rows, 'unnest')` aligns the rows on the union of their keys, key columns first. Each column becomes one array parameter, encoded with `arrayOf(column codec)` and its type pinned by the `$n::type[]` cast ([COMPILER.md](COMPILER.md#update-and-seteach)).
3. **Columns some rows leave out** get a boolean **flag column** `set:<name>` (sent as `bool[]`, in binary) and the assignment `case when row."set:col" then row.col else table.col end`: "use the row's value if this row gave one, else keep the current value". So `undefined` means "keep" and `null` means "set to NULL", exactly as in `set()`. Columns every row sets are assigned directly, with no `case`.
4. **The key match is the `where`**: one `table.key = row.key` per key column, added to the `WhereBuilder`. That is why `setEach` satisfies both `'set'` and `'where'` at the type level (`Exclude<M, UpdateNeeds>`); a later `.where(…)` adds conditions with `and`.
5. **The rows are in scope** as `row` (or the `as` name): a `Table` named `row` over the same schema is added to `scope`, and `eb` is rebuilt over it. So `set`, `where` and `returning` can reference `row.price`; key columns are typed non-null, others `T | null` (a row may leave them out) (`SetEachRefs` in [TYPES.md](TYPES.md#seteach-rows-in-scope)).

A `set` before `setEach` gives every row the same value; a `set` after it can replace a row's value with an expression of it: `.set((eb) => ({ stock: eb.fn.coalesce('row.stock', 'products.stock') }))`.

Array-typed columns can't be sent through `unnest` (it would flatten them); such a `setEach` throws at compile time, as do expression values.

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

## Whole statements: `db.sql`

```ts
const { rowCount } = await db.sql`vacuum analyze posts`.execute();
const n = await db.sql<{
  n: string;
}>`select count(*) as n from posts where author_id = ${id}`
  .expectValue()
  .execute();
```

`db.sql` (and `tx.sql`, on the transaction's connection) runs a whole statement written by hand ([sql.ts](sql.ts) `SqlQuery`). Interpolated values become parameters; expressions, tables, `sql.id(…)`, `sql.lit(…)` and `sql.join(…)` are written into the SQL. It has every result shape, `expectRows`, and works in `db.batch`. The row type `R` is a promise you make: nothing checks it. The `sql` fragment tag for use inside builder queries is in [EXPRESSIONS.md](EXPRESSIONS.md#raw-sql-fragments).

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

## Decisions

Why the builders work this way. Each links to its full entry (what it is, why, the alternatives, the cost, measured impact) in [DECISIONS.md](DECISIONS.md):

- [Immutable builders](DECISIONS.md#immutable-builders): every method is a copy with one change, so a base query can be reused safely.
- [What a builder still needs, in its type: `M` and `this` gating](DECISIONS.md#what-a-builder-still-needs-in-its-type-m-and-this-gating): an update or delete without `where` is a type error; every row has to be written as `allRows()`.
- [The locking clause as a state machine: `L`](DECISIONS.md#the-locking-clause-as-a-state-machine-l): `of`, `skipLocked` and `noWait` only where SQL allows them.
- [No `orWhere`: precedence is always explicit](DECISIONS.md#no-orwhere-precedence-is-always-explicit): `or` is written with `eb.or`, so its grouping is visible.
- [`set` merges, `values` replaces](DECISIONS.md#set-merges-values-replaces): assignments accumulate; rows are stated in full.
- [Lazy result shapes, and `execute()` as the one way to run](DECISIONS.md#lazy-result-shapes-and-execute-as-the-one-way-to-run): a query is a value until `execute()`, so many can go in one `db.batch`.
- [Awaiting a builder rejects](DECISIONS.md#awaiting-a-builder-rejects): a forgotten `execute()` fails loudly instead of doing nothing.
- [Throwing is in the name: the `take…` and `expect…` split](DECISIONS.md#throwing-is-in-the-name-the-take-and-expect-split): you can tell from the call whether it can throw on the number of rows.
- [No implicit LIMIT in result shapes](DECISIONS.md#no-implicit-limit-in-result-shapes): the SQL you see is what runs, and locks cover exactly the rows returned.
- [`keepRows` instead of `limit`](DECISIONS.md#keeprows-instead-of-limit): the client decodes only the rows a shape reads, without changing the SQL.
- [A write's `execute()` with `returning` resolves to the rows](DECISIONS.md#a-writes-execute-with-returning-resolves-to-the-rows): like a select with no shape.
- [`setEach`: one method for the source, the assignments and the key match](DECISIONS.md#seteach-one-method-for-the-source-the-assignments-and-the-key-match): a bulk update whose key match is generated, so it can be the required `where`.
- [Rows that set different columns: flag columns and `case`](DECISIONS.md#rows-that-set-different-columns-flag-columns-and-case): `undefined` keeps a value, `null` sets NULL, in one statement.
- [`setEach` rows are typed by the table, and duplicate keys are refused](DECISIONS.md#seteach-rows-are-typed-by-the-table-and-duplicate-keys-are-refused): no misspelled or read-only columns, no ambiguous updates.
- [Outer joins make the joined side nullable: `NullableTable`](DECISIONS.md#outer-joins-make-the-joined-side-nullable-nullabletable): the row type says which columns can be NULL.
- [A table joined twice, or a key selected twice, is refused](DECISIONS.md#a-table-joined-twice-or-a-key-selected-twice-is-refused): both silently corrupted results.
- [`selectAll` lists the columns, never `*`](DECISIONS.md#selectall-lists-the-columns-never-): each column keeps its key and codec.
- [`selectAll` takes the name a table goes by](DECISIONS.md#selectall-takes-the-name-a-table-goes-by): one form, the name every other reference uses.
- [Ordering by a selected key uses the bare key](DECISIONS.md#ordering-by-a-selected-key-uses-the-bare-key): a dot always means a column.
- [Raw SQL only through the `sql` template tag](DECISIONS.md#raw-sql-only-through-the-sql-template-tag): `db.sql` and fragments stay injection-safe.

## Glossary

**Cursor**: a server-side position in a query's result, read a batch at a time.

**Inner join**: a join that keeps only rows with a match on both sides.

**Lock**: a server-side mark on rows that makes other transactions wait (or skip, or fail) before changing them.

**Result shape**: what `execute()` makes of a query's rows.

**`returning`**: the clause that makes a write return rows (`insert … returning id`).

**Row count**: how many rows a statement returned or changed.

**Transaction**: statements that commit (take effect) together or not at all.

**Upsert**: an insert with `on conflict` handling.
