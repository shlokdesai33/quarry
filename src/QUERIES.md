# The query builders and result shapes

This guide covers the four builders (select, insert, update, delete), what each method records, the **result shapes** that decide what `execute()` returns, and the errors they throw.

- Files: [select-query-builder.ts](select-query-builder.ts), [insert-query-builder.ts](insert-query-builder.ts), [update-query-builder.ts](update-query-builder.ts), [delete-query-builder.ts](delete-query-builder.ts), [write-query.ts](write-query.ts) (what the write builders share), [where-builder.ts](where-builder.ts), [row.ts](row.ts) (select lists), [nest.ts](nest.ts), [table.ts](table.ts), [shape.ts](shape.ts), [query.ts](query.ts), [sql.ts](sql.ts) (`db.sql`), [batch.ts](batch.ts) (`BatchError`), [executor.ts](executor.ts) (the result-shape error classes), [errors.ts](errors.ts).
- The type-level side of these builders (how the row type grows, how a builder knows it still needs a `where`) is in [TYPES.md](TYPES.md). The SQL they produce is in [COMPILER.md](COMPILER.md). Running them is in [EXECUTION.md](EXECUTION.md). Expressions (`eb.ref`, comparisons, arithmetic, `case`, functions, `sql` fragments) are in [EXPRESSIONS.md](EXPRESSIONS.md).

The builders cover everyday SQL: inner, outer and cross joins, `distinct`/`distinct on`, `group by`/`having`, `order by`, `limit`/`offset`, row locks, a joined table's columns as one object (`nest`), upserts, bulk updates (`setEach`), and anything written by hand with `sql` fragments or whole `db.sql` statements, plus keyset pagination ([PAGINATION.md](PAGINATION.md)) and streaming.

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

The three write builders extend `WriteQueryBuilder<O, M>` ([write-query.ts](write-query.ts)), which holds the executor and supplies everything that reads a result: `execute()`, the result shapes, `toSQL()` and `toQuery()`. `O` is the `returning` row (`undefined` without `returning`) and `M` is what the query still needs before it can run ([TYPES.md](TYPES.md#what-a-write-query-still-needs-m)). Each builder also has `tag(name)` and `when(condition, build)`.

**With or without a database.** `db.selectFrom(users)` (and `db.insertInto`, `db.update`, `db.deleteFrom`, and the same on a transaction's `tx`) passes the database's executor into the state. The standalone `selectFrom`, `insertInto`, `update` and `deleteFrom` pass `undefined`: such a query can be inspected (`toSQL()`), composed and run by a database's `db.batch([...])`, which runs every item on its own executor, but its `execute()` throws `The query has no database to run on`. `stream()`, `describe()` and the pagination methods throw the same.

### Nothing runs until `execute()`

A builder, a `Query` and a `db.sql` statement all end with the same line:

```ts
/** @deprecated A query runs with `execute()`; awaiting one rejects. */
readonly then = rejectAwait;
```

`await x` doesn't check whether `x` is a promise: it looks for a `then` method and, if there is one, calls `x.then(resolve, reject)`. Without this line, `await db.insertInto(users).values(row)` would just hand back the builder, and the insert would silently never happen. `rejectAwait` ([query.ts](query.ts)) calls `reject` with a `TypeError`: ``A query runs with execute(), not when awaited: `await q.expectOne().execute()`, or `await db.batch([...])` for several``. The same happens wherever a builder is treated as a promise: `return builder` from an `async` function, `Promise.all([builder])`, `Promise.resolve(builder)`.

At the type level, `rejectAwait`'s `resolve` parameter takes a `NotExecuted`, and TypeScript types `await x` from that parameter, so `const rows = await db.selectFrom(users)` gives `rows` the type `NotExecuted` and the first use of it as rows is a compile error carrying the hint ([TYPES.md](TYPES.md#notexecuted-awaiting-a-builder)). `@deprecated` makes editors strike `then` through and keep it out of autocomplete. The `oxlint-disable-next-line unicorn/no-thenable` above each `then` is deliberate: that rule exists to stop exactly this kind of object.

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
- **`selectAll` takes the name the table goes by** in the query (its alias, or its name when not aliased), and only that: not a table object, and no argument-less "every table" form (both existed before #42). It is the name every other reference uses (`'u.id'` after `selectFrom(users.as('u'))`); a table object names the table, not what it goes by once aliased; and "every table" changed meaning whenever a join was added, and was a duplicate-key error as soon as two tables had an `id`. `selectAll(users)`, `selectAll()` and `selectAll('users')` after `users.as('u')` are type errors (the parameter is `N extends T[number]['name']`); a name not in the query throws `selectAll: "posts" is not in the query` for code that casts around the types. Selecting every column of two tables takes two calls, and fails (`UniqueColumns`) if they share a column key.
- **Its list is made once per table.** `allSelections(table)` ([expression-builder.ts](expression-builder.ts)) is a frozen array of the table's shared selection nodes, cached per table object. When `selectAll` is the query's first selection, the builder keeps that array as its select list unchanged (its keys are the table's column keys, so they are unique), and the compiler renders a frozen list's SQL and result codecs once ([COMPILER.md](COMPILER.md#what-is-rendered-once)). Otherwise its entries are appended like any `select`. `returningAll()` on the write builders uses the same list.
- Over a left-joined table, `selectAll('posts')` types every column `| null`, since the scope holds the table's `NullableTable` ([below](#joins)).

### `nest`: a table's columns as one object

```ts
.select(({ nest }) => ['users.id', nest('bookings', ['id', 'name'])]) // { id: number; bookings: { id: number; name: string } | null }
.select(({ nest }) => [nest('bookings')])                              // every column of bookings
.select(({ nest }) => [nest('managers', ['name']).as('manager')])      // an aliased table, renamed in the row
```

A left join gives one flat row per match, with the joined table's columns NULL where it found none. `nest` gives those columns back as one object of the row, and makes the whole object `null` where the join found no row, rather than an object of nulls. "No booking" and "a booking whose `note` is NULL" stay distinguishable.

`nest` is a member of the `eb` a `select` callback gets (`SelectBuilder<T>` in [nest.ts](nest.ts): the expression builder plus `nest`). Every expression builder has it at run time (`nestOf(tables)` in [expression-builder.ts](expression-builder.ts)), but only the select list's type shows it, so it isn't offered in `where`, `orderBy` or `returning`. It takes the name a table goes by in the query (its alias, or its name when not aliased), and optionally a non-empty list of that table's column keys (every column otherwise), and returns a `Nested` entry keyed by that name; `.as()` re-keys it. For code that casts around the types, `nestOf` throws `nest: "x" is not in the query`, `nest: "bookings" has no column "email"`, `nest: list at least one column of "bookings", or none for every column` and `nest: "id" is listed twice`.

`selectionNodes` ([row.ts](row.ts) `nestedNodes`) expands a `Nested` into flat entries, so every column is still selected under its own codec, in binary where it can be, with no `json_build_object`. Real `toSQL()`:

```sql
select "users"."id" as "id",
       ("bookings".ctid is not null) as "bookings",   -- the marker
       "bookings"."id" as "bookings.id", "bookings"."name" as "bookings.name"
from "users" left join "bookings" on "bookings"."user_id" = "users"."id"
-- nested: [{ key: 'bookings', marker: 1, columns: [[2, 'id'], [3, 'name']] }]
```

Each entry carries `nest: { key, column }` on its `SelectionNode` (`column` is `undefined` on the marker). From those, `compile` builds `CompiledQuery.nested` (a getter, like `resultCodecs`; `nestedObjects` in [compile.ts](compile.ts)): per object, the position of its marker and of each column. The executor passes it to the driver as the query's `nested` option, and the generated row decoder writes the object directly: the marker's slot starts as `null`, a `true` marker stores a fresh `{ id: null, name: null }`, and each non-NULL column is stored into it. There is no second pass over the rows. That works for every shape (`execute`, `take…`, `expect…`, including `takeValue` on `array` rows), `stream`, `db.batch` and the pagination methods.

- **The marker is always `table.ctid is not null`**, never a join column: every row of a real table has a non-null `ctid` (its physical position), so the marker is false exactly when an outer join found no row, whatever the table's columns hold and whatever the `on` condition is ([DECISIONS.md](DECISIONS.md#nest-marks-a-joined-row-with-ctid)). Because of that, the table must be a real table: a view has no `ctid`, and Postgres rejects the query.
- **Whether the object can be `null` follows the join kind**, as the columns' nullability does ([TYPES.md](TYPES.md#nest-an-object-per-table)). Inside the object, each column has the type the table gives it in a row it has: a `not null` column stays non-null even on the outer side of a join.

  | The nested table is…                                        | Object type                                                       |
  | ----------------------------------------------------------- | ----------------------------------------------------------------- |
  | the `from` table, or joined with `innerJoin` or `crossJoin` | `{ … }`                                                           |
  | joined with `leftJoin`, or `fullJoin`                       | `{ … } \| null`                                                   |
  | joined **before** a `rightJoin` or `fullJoin`               | `{ … } \| null`                                                   |
  | selected before a later `rightJoin` or `fullJoin`           | `{ … } \| null` (through `NullableRow`, like any selected column) |

- **Its key is a top-level key**: it is checked against the row like any column (`UniqueKeys`, `checkUniqueKeys`), so `nest('bookings')` next to a column aliased `bookings`, or two `nest('bookings', …)` without `.as()`, are type and build-time errors. Its columns live in their own object, so `users.id` and a nested `bookings.id` don't clash, and a table can be nested twice under two keys.
- **The object's key is not a key to order, group or page by.** It holds no column, so `orderBy('booking')`, `groupBy(['booking'])`, `distinctOn(['booking'])` and a keyset `by` naming a column whose key the object took are type errors, wherever the object was selected (directly, in `when`, in a `pipe`d fragment, before a join): the builder records the object keys in its fourth type parameter `K` ([TYPES.md](TYPES.md#nest-an-object-per-table)). `orderBy`, `groupBy` and `distinctOn` also throw at run time (`"booking" is a nested object: name one of its columns as 'table.column'`). They take the object's columns instead, as `'bookings.id'`.

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

`when(condition, build)` calls `build(this)` only if `condition` is true, and otherwise returns the builder unchanged. It is how a query takes optional input without `if` statements and reassignments: `.when(value !== undefined, (qb) => qb.where('users.name', value))` is the way to write an optional filter, since `where('users.name', undefined)` throws ([EXPRESSIONS.md](EXPRESSIONS.md#undefined-is-refused)).

- `build` is typed as receiving a `Fragment<T>`: a builder over the same tables with **nothing selected**, so the row type it returns is only what it selected. At run time it gets the real builder (`this`, cast), so conditions and columns land on the query's state. `when` adds the selected columns back as **optional** (`email?: string`), since they may be missing (`WhenRow` in [TYPES.md](TYPES.md#when-columns-that-may-be-missing)).
- It keeps the tables, so it can't join: the callback must return a builder over exactly `T`, and a join changes that.
- A locking clause added inside closes the lock state: after `when`, `of`, `skipLocked` and `noWait` are type errors, because the latest clause may be the one before `when` ([Row locking](#the-lock-state-l)).
- On the write builders, `when` takes and returns the same `M`: a `where` (or `values`, or `set`) inside it doesn't count as the required one, since it may not run.

### `fragment` and `pipe`: reusable pieces

```ts
const active = fragment(users, (qb) => qb.where('users.status', 'active'));
const withContacts = fragment(users, (qb) =>
  qb.innerJoin(contacts).on('contacts.userId', 'users.id'),
);

db.selectFrom(users).pipe(withContacts).pipe(active).select(['contacts.email']);
```

A **fragment** is a reusable piece of a query (conditions, joins, columns, even a locking clause) written once and applied to any query its tables are in, in any position: "active users" or "with the primary contact" shared by every endpoint that needs it.

`fragment(tables, build)` returns `build` itself: at run time it is the identity. Its job is typing: it fixes the tables the piece needs, one table or several in an array (`fragment([users, contacts], (qb) => qb.where((eb) => eb.ref('contacts.email').eq(eb.ref('users.email'))))`), so `build` gets a `Fragment<T>` over exactly those tables and can reference nothing else. It must return a select builder (`fragment(users, () => 1)` is a type error).

`pipe(piece)` calls `piece(this)` and keeps the builder it returns, whose state now includes the piece's conditions, joins and columns, appended after the query's own. At the type level:

- **`InScope<T, P>`** checks that the piece's tables are in the query; if one is missing, `pipe` demands an extra argument named `missingTables` typed with the missing table's name ([TYPES.md](TYPES.md#inscope-an-impossible-extra-argument)). A table counts as in scope by its type, so a fragment over `users` doesn't apply to a query that has it as `users.as('u')`.
- **`JoinedBy<Q, P>`** reads the tables the piece joined beyond the ones it was declared over, and appends them to the query's tables, so later calls can reference them.
- The piece's selected columns join the row (`AddRow`), its `nest` keys join `K`, and a locking clause in it closes the lock state, as with `when`.

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

Outside a transaction, each statement is its own transaction, so the locks are released as soon as the select returns: useless. Hence `forUpdate()`'s doc comment tells you to run locking reads in `db.transaction` (on the transaction's `tx`, whose queries all run on the one connection the transaction holds, [EXECUTION.md](EXECUTION.md#transactions)). Nothing enforces it: a locking read outside a transaction is valid SQL, and occasionally what you want (a `noWait()` probe that fails if someone else holds the row).

### The four strengths

| Method             | SQL                 | Blocks others from                                                                           | Typical use                                                 |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `forUpdate()`      | `for update`        | updating, deleting, and taking any lock on the rows                                          | you'll update or delete the rows                            |
| `forNoKeyUpdate()` | `for no key update` | the same, except `for key share` (so inserts referencing the rows by foreign key don't wait) | you'll update non-key columns (what a plain `update` takes) |
| `forShare()`       | `for share`         | updating, deleting, `for update`                                                             | the rows must not change while you read related data        |
| `forKeyShare()`    | `for key share`     | deleting, key-changing updates, `for update`                                                 | what a foreign key check takes                              |

Each strength method appends a **locking clause**, a `LockNode` `{ strength, of: [], wait: undefined }`, to the state's `locks` (`#lock`). The modifiers below change the latest clause (`#modifyLock` replaces the last `LockNode`).

### `of`, `skipLocked`, `noWait`

- `of(...tables)` limits the latest clause to some tables of the query; the other tables' rows are read without a lock. Each argument is a table in scope or the name it goes by (`of(jobs)`, `of('jobs', 'workers')`; an aliased table only by its alias, `of(managers)` or `of('managers')`). It takes all its tables in one call, at least one.
- `skipLocked()`: rows another transaction has locked are skipped instead of waited for. Workers each claim a different job.
- `noWait()`: fail immediately with `LockNotAvailable` (SQLSTATE 55P03, a driver `PostgresError` class) instead of waiting.
- Without either, the query **waits** for the other transaction to commit or roll back (bounded by `timeout`, or the server's `lock_timeout` if set).
- A query can have several clauses, usually each `of` different tables (`.forUpdate().of(jobs).skipLocked().forShare().of(users).noWait()`); Postgres takes the strongest where they overlap.

Real `toSQL()` of a claim with two clauses (the clauses always render last, after `limit`, as SQL requires):

```sql
select "jobs"."id" as "id" from "jobs" inner join "users" on "users"."id" = "jobs"."id"
where "jobs"."status" = $1 limit $2 for update of "jobs" skip locked for share of "users"
```

### The lock state `L`

SQL fixes the order inside a clause: `for <strength> [of …] [skip locked | nowait]`. Getting it wrong is a syntax error from the server, so the select builder tracks, in its third type parameter `L` (`LockState`), what the latest clause still accepts:

| State        | Reached by                                                        | Then accepts                                          |
| ------------ | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `'none'`     | a new query                                                       | a strength                                            |
| `'strength'` | `forUpdate()`, `forNoKeyUpdate()`, `forShare()`, `forKeyShare()`  | `of(…)`, `skipLocked()`, `noWait()`, another strength |
| `'of'`       | `of(…)`                                                           | `skipLocked()`, `noWait()`, another strength          |
| `'done'`     | `skipLocked()`, `noWait()`; a `when` or `pipe` whose piece locked | another strength                                      |

`of`, `skipLocked` and `noWait` declare the states they accept with a `this` parameter, so calling them elsewhere is a type error: `skipLocked()` without a strength, `skipLocked().noWait()`, `skipLocked().skipLocked()`, `skipLocked().of(jobs)` (`of` comes before the wait policy), `of(a).of(b)`. A new strength starts a new clause in `'strength'`, whatever the state ([TYPES.md](TYPES.md#the-locking-clause-l)).

- **Other methods keep the state.** `where`, `select`, `tag`, joins and the like pass `L` through unchanged, so `.forUpdate().where(…).select(…).of(jobs)` is fine. A table joined **after** the strength can be named in `of`: `of` is typed by the tables in scope when it is called.
- **`when` and `pipe` close it.** If the piece added a clause, the latest clause may be the piece's or the one before it, depending on whether the piece ran, so the state becomes `'done'` (`LockAfter`); if the piece added none, the state is unchanged.
- **The same rules at run time.** For code that casts around the types, `#modifyLock` and its callers throw: `skipLocked() needs a locking clause first: forUpdate(), forNoKeyUpdate(), forShare() or forKeyShare()`, `of() comes right after forUpdate(), forNoKeyUpdate(), forShare() or forKeyShare()` (when the clause already has tables or a wait policy), `A locking clause takes one of skipLocked() and noWait()`.
- **No aggregates.** Postgres refuses a locking clause on a query that aggregates (a row of `count(*)` is no table row to lock); the compiler checks first and throws `A locking clause (forUpdate() and the like) cannot be used with aggregate functions` ([COMPILER.md](COMPILER.md#locking-clauses)).

### Locks, shapes, `limit` and pagination

- **Result shapes add no `limit`**, so **every row the query returns is locked**, even if `takeFirst()` decodes only one ([below](#shapes-never-change-the-sql)). `.limit(1)` locks one; that is why the claim above has `.limit(1)` before `.takeFirst()`.
- **`stream()`** inside `db.transaction` keeps each row's lock until the transaction ends, and the loop can update the rows between batches ([EXECUTION.md](EXECUTION.md#streaming)). Outside a transaction, the cursor runs in the implicit transaction of one Sync, which holds them until the stream ends ([driver/STREAMING.md](driver/STREAMING.md#cursors)).
- **`iterateChunks` and `paginateByCursor`** run one query per batch or page, each locking its own rows; run them in `db.transaction` to keep the locks of earlier batches. `paginateByOffset({ countTotal: true })` drops the locking clauses from its `count(*)` query, which aggregates ([PAGINATION.md](PAGINATION.md#offset-pages-and-counttotal)).

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

- `values(row | rows)` takes rows of `InferInsertType<T>` (required columns must be present, including nullable columns without a default; columns with a default may be; identity and generated columns may not). It **replaces** values given before. One row renders `values (…)`; an array asks for `unnest` (one array parameter per column) when possible ([COMPILER.md](COMPILER.md#insert)). Each value becomes a value node with its column's codec, or an expression's node. Rows are aligned on the union of their keys (`rowsNode`); a column a row lacks gets its default.
- A key whose value is `undefined` is skipped: the column gets its default. (In a type-correct program that only happens for optional columns.)
- `returning([...])` adds to the `returning` list, typed like a select list (columns and aliased expressions; `nest` is for selects). `returningAll()` adds every column, listed, never `*`. A key returned twice is rejected, as in a select.
- `when(condition, build)` applies `build` conditionally; it can't satisfy `values` (its `M` stays the same). `tag(name)` labels the query, as on a select.

### Upserts

```ts
.onConflict('email').doNothing()
.onConflict(['tenantId', 'slug']).merge(['title'])
.onConflict('email').doUpdate((excluded) => ({ name: excluded.name }))
.onConflict('email').where('users.deleted', false).doNothing()  // a partial unique index
.onConflict('email').merge(undefined, { where: (eb, excluded) => eb.ref('users.version').lt(excluded.version) })
```

An **upsert** inserts a row, or does something else when it conflicts with an existing row on a unique index. `onConflict(target)` takes the unique columns by their keys (one, or a non-empty array for a composite index; `ConflictTarget<T>`) and returns an `OnConflictBuilder` whose actions return the `InsertQueryBuilder` again:

- `where(…)` on the `OnConflictBuilder` names the predicate of a **partial** unique index (one with `where deleted = false`), in any form `where` takes, so Postgres can match the target to it.
- `doNothing()` keeps the existing row; the insert then affects 0 rows for it (`expectRows(1)` turns that into a `RowCountError`).
- `merge(columns?, options?)` sets the listed columns (by default, every inserted column) from the proposed row; read-only columns aren't offered.
- `doUpdate((excluded, eb) => values, options?)` sets what you return, typed like `update().set()`. `excluded` is an object with one typed expression per column, referencing the proposed row ([write-query.ts](write-query.ts) `excluded()`), so `excluded.name` compares and sets with the column's own types.
- `options.where` (on `merge` and `doUpdate`) limits the update to the conflicting rows for which a condition holds: a predicate, or `(eb, excluded) => predicate`. A row it excludes is left alone, and not counted.

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
- `when(condition, build)` and `tag(name)` work as on an insert: nothing inside `when` counts towards `M`.

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

1. **Checks** (`checkEachRows`), for what the types can't rule out, before anything is built: a second `setEach` (`An update takes one setEach`); an empty `key` or a key that isn't a column; `as` equal to the table's name; no rows; a row whose key is missing or null; two rows with the same key. The messages report row indexes, never values, so they can't leak data into logs.
2. **Rows as columns**: `rowsNode(table, rows, 'unnest')` aligns the rows on the union of their keys, key columns first. Each column becomes one array parameter, encoded with `arrayOf(column codec)` and its type pinned by the `$n::type[]` cast ([COMPILER.md](COMPILER.md#update-and-seteach)).
3. **Columns some rows leave out** get a boolean **flag column** `set:<name>` (sent as `bool[]`, in binary) and the assignment `case when row."set:col" then row.col else table.col end`: "use the row's value if this row gave one, else keep the current value". So `undefined` means "keep" and `null` means "set to NULL", exactly as in `set()`. An array can carry NULL but not "absent", which is why absence needs its own column. Columns every row sets are assigned directly, with no `case`.
4. **The key match is the `where`**: one `table.key = row.key` per key column, added to the `WhereBuilder`. That is why `setEach` satisfies both `'set'` and `'where'` at the type level (`Exclude<M, UpdateNeeds>`), and the update can run as is.
5. **The rows are in scope** as `row` (or the `as` name): a `Table` named `row` over the same schema is added to `scope`, and `eb` is rebuilt over it. So `set`, `where` and `returning` can reference `row.price`.

### The key

- `key` names the column, or columns, that identify a row: `{ key: 'id' }`, or a non-empty array for a composite key, `{ key: ['tenantId', 'sku'] }`. It should match a unique index: a row whose key matches several table rows updates all of them.
- Every row must have every key column, non-null: the row type makes them required and `NonNullable` (`SetEachRow<T, K>`), and `checkEachRows` throws `Each row of setEach needs its key columns: row 1 is missing "id"` for code that gets around the types (rows typed `{ id?: number }[]` are already a type error).
- A key column is only matched, never set, so it needn't be writable: an identity `id` can be the key. As a non-key column, the same `id` would be a type error, like `set({ id })`.
- **Duplicate keys are refused**: `Rows 0 and 1 of setEach have the same key (id): postgres would update "products"'s row from either`. With two source rows for one table row, Postgres updates it from whichever it meets first, so the result would depend on the plan. Keys are compared by their type and value (`keyString`: strings, numbers, bigints, booleans and `Date`s); a key value of another kind (a `Buffer`, a JSON object) isn't checked for duplicates.
- A row whose key matches no table row updates nothing. `expectRows(rows.length)` turns "some keys weren't found" into a `RowCountError` (inside a transaction, rolling the update back).

### The rows in scope

- The rows go by `row` unless `as` names them (`{ key: 'id', as: 'patch' }`); the name can't be the table's (it would make `products.id` ambiguous with the table).
- What is in scope is `SetEachRefs<T, K, A>` ([TYPES.md](TYPES.md#seteach-rows-in-scope)): the key columns, typed non-null, and every column an update can set, typed `T | null`, since a row may leave it out (where the `case` keeps the table's value, `row.col` is NULL). Read-only columns (identity, generated) other than the key aren't in the rows, so `returning(['row.search'])` is a type error. The rows can be read, never written.
- So `where` can filter on them (`.where((eb) => eb.ref('products.stock').gt(0))` adds `and "products"."stock" > $5` after the key match), and `returning` can return them (`returning(['products.id', 'row.price'])`).

### `set` before and after

`set` and `setEach` write the same list of assignments, keyed by column, so what wins is the later call:

- **`set` before `setEach`** gives every row the same value for a column the rows don't set: `update(products).set({ stock: 0 }).setEach([{ id: 1, price: '9.99' }], { key: 'id' })` renders `set "stock" = $1, "price" = "row"."price"`. For a column the rows do set, even only some of them, `setEach`'s assignment replaces it, and its `case` falls back to the **table's** current value, not the earlier `set`.
- **`set` after `setEach`** replaces the rows' assignment of that column, usually with an expression of `row.col`: `.set((eb) => ({ stock: eb.fn.coalesce('row.stock', 'products.stock') }))` renders `"stock" = coalesce("row"."stock", "products"."stock")`. The flag column is still sent, unused. Because a row may leave a column out, `row.stock` is nullable, so setting it directly into a non-null column (`set((eb) => ({ stock: eb.ref('row.stock') }))`) is a type error; `coalesce` with the table's column makes it non-null.

Array-typed columns can't be sent through `unnest` (it would flatten them), and the rows' values must be plain values (the row type takes each column's update type, not expressions); otherwise compiling throws `setEach sends its rows with unnest: …` ([COMPILER.md](COMPILER.md#errors-the-compiler-raises)). Zero rows throw at build time (`setEach needs at least one row`), so a job whose list may be empty checks `rows.length` first.

## Delete

```ts
db.deleteFrom(users).where('users.id', id).execute();
db.deleteFrom(sessions)
  .where((eb) => eb.ref('sessions.expiresAt').lt(now))
  .returning(['sessions.id'])
  .execute();
db.deleteFrom(logs).allRows().execute();
```

The same `where` / `allRows` rule as update: `deleteFrom(users).execute()` is a type error naming the missing `'where'`, and `toSQL()` on it throws `A delete needs where() or allRows()`. `returning`, `returningAll`, `when` and `tag` work as on an update.

## Whole statements: `db.sql`

```ts
const { rowCount } = await db.sql`vacuum analyze posts`.execute();
const n = await db.sql<{
  n: string;
}>`select count(*) as n from posts where author_id = ${id}`
  .expectValue()
  .execute();
```

`db.sql` (and `tx.sql`, on the transaction's connection) runs a whole statement written by hand, for anything the builders don't model: maintenance commands, a CTE, a set operation, `insert … select`, a statement you already have. It returns a `SqlQuery<R>` ([sql.ts](sql.ts)), built by the same `templateNode` as the `sql` fragment tag ([EXPRESSIONS.md](EXPRESSIONS.md#raw-sql-fragments)):

- An interpolated **value** becomes a parameter whose type Postgres infers from where it stands; `undefined` is refused (`A value interpolated into sql is undefined; for SQL NULL, pass null`).
- An **expression**, a **table** (written as `"posts"`, or `"posts" as "p"` when aliased), `sql.id(…)`, `sql.lit(…)` and `sql.join(…)` are written into the SQL. Real `toSQL()` of `` db.sql`select ${sql.id('posts', 'id')} from ${posts.as('p')} where author_id in (${sql.join(ids)}) and kind = ${sql.lit('x')}` ``: `select "posts"."id" from "posts" as "p" where author_id in ($1, $2) and kind = 'x'`, params `[1, 2]`.
- It must be called as a template literal; `db.sql(text)` with a built string throws, which keeps it injection-safe ([DECISIONS.md](DECISIONS.md#raw-sql-only-through-the-sql-template-tag)).

It is compiled once, when made. Like a builder, it runs with `execute()` or in `db.batch`, its `then` rejects, and it has `toSQL()` and `toQuery()`:

- `execute()` resolves to a `SqlResult<R>`: `{ rows: R[], rowCount }`, where `rowCount` is the rows returned or affected (from the command tag; 0 for a command without a count, such as `vacuum`).
- It has every result shape, typed by `R`: `takeFirst()`, `takeValue()`, `expectNonEmpty()`, `expectFirst()`, `expectOne()`, `expectAtMostOne()`, `expectValue()`, and `expectRows(n)`, which checks the rows returned **or** affected and resolves to the `SqlResult`.
- `R` is a promise you make (`db.sql<{ n: string }>`): nothing checks it against what the statement returns, and values are decoded by the types the server reports (the registry), so a `count(*)` arrives as a string. It defaults to `Record<string, unknown>`.
- Its errors have no table: `The query returned no row, where exactly one was expected`.

## Result shapes

A **result shape** says what `execute()` gives you from the rows a query returns. Every builder, and `db.sql`, can produce a `Query<R>` ([query.ts](query.ts)) through one of them. A `Query` has only `execute()`, `toSQL()` and `toQuery()`: no builder methods and no other shapes, so a shape is always the last call before `execute()` (`q.expectRows(1).returning(…)` and `q.expectOne().takeFirst()` are type errors).

### The shapes

For selects, writes with `returning`, and `db.sql` (whose rows are `R`):

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

For writes, by row count (and for `db.sql`, `expectRows`):

| Shape                                      | Resolves to                                                                                  | Throws                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `expectNonEmpty(err?)` without `returning` | `{ rowCount }`                                                                               | `NoRowError` ("affected no row") if it wrote none                                       |
| `expectRows(n, err?)`                      | as without a shape: `{ rowCount }`, the `returning` rows, or `db.sql`'s `{ rows, rowCount }` | `RowCountError` if it wrote (or, for `db.sql`, returned or affected) a different number |

`expectNonEmpty` on a write is one method with two results: with `returning`, the non-empty array of rows, as on a select; without, the row count (`NonEmptyOutput<O>` in [write-query.ts](write-query.ts)). `expectRows(n)` checks `n` when the shape is made: a negative or fractional `n` throws a `RangeError` at once. The row shapes (`takeFirst`, `expectOne`, …) on a write without `returning` are type errors: there are no rows to read.

`takeValue`/`expectValue` need a row of exactly one column: the row type doesn't record which column comes first, so with several it would be a guess, and with none there is nothing to read. `ValueArgs` makes the call a type error otherwise, by demanding an extra argument typed `'select exactly one column to read a value'` ([TYPES.md](TYPES.md#result-shapes)).

### Mapping the error: `err`

Every `expect…` takes an optional last argument `err`, typed `ErrorFor<E> = (error: E) => Error`, where `E` is the error that shape can throw: `NoRowError` for `expectNonEmpty`, `expectFirst` and `expectValue`; `NoRowError | TooManyRowsError` for `expectOne`; `TooManyRowsError` for `expectAtMostOne`; `RowCountError` for `expectRows`. When the check fails, the shape builds its own error and throws what `err` returns instead (`failure` in [shape.ts](shape.ts)), so the caller decides what "not found" means at the call site:

```ts
.expectOne((e) => (e instanceof NoRowError ? new HttpError(404) : e))
.expectNonEmpty(() => new HttpError(404, 'No posts'))
```

`err` only runs when the check fails, never for database errors, which reject `execute()` as they are. `expectValue`'s `err` goes through its `ValueArgs` rest parameter (`errorArg` picks it out).

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

and `Query.execute` passes `shape.rows` to the executor merged with your `RunOptions` (`{ ...options, ...rows }`), then calls `read` on the result. The SQL is compiled when the shape is made, so `execute()` doesn't compile again ([COMPILER.md](COMPILER.md#tosql-and-when-compiling-happens)).

A shape reads whatever rows it is given, so each is made once and shared by every query (`ALL_ROWS`, `TAKE_FIRST`, …; `shared` makes an `expect…` shape once for calls without `err`, and per call with one). The `ReadOptions` they ask for:

| Shapes                         | `rows`                              |
| ------------------------------ | ----------------------------------- |
| every row, `expectNonEmpty`    | none                                |
| `takeFirst`, `expectFirst`     | `{ keepRows: 1 }`                   |
| `takeValue`, `expectValue`     | `{ rowMode: 'array', keepRows: 1 }` |
| `expectOne`, `expectAtMostOne` | `{ keepRows: 2 }`                   |

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

These are what the `expect…` shapes throw when the rows aren't what they expect. They are plain `Error` subclasses made by quarry, not database errors: the statement itself succeeded.

| Class              | Properties                                      | Thrown by                                      | Message                                                               |
| ------------------ | ----------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `NoRowError`       | `table`, `query` (hidden)                       | `expectOne`                                    | The query on "users" returned no row, where exactly one was expected  |
|                    |                                                 | `expectFirst`, `expectValue`, `expectNonEmpty` | … returned no row, where at least one was expected                    |
|                    |                                                 | a write's `expectNonEmpty` without `returning` | The query on "users" affected no row, where at least one was expected |
| `TooManyRowsError` | `table`, `count`, `query` (hidden)              | `expectOne`                                    | The query on "users" returned 3 rows, where exactly one was expected  |
|                    |                                                 | `expectAtMostOne`                              | … returned 3 rows, where at most one was expected                     |
| `RowCountError`    | `expected`, `actual`, `table`, `query` (hidden) | `expectRows(n)`                                | The query on "docs" affected 0 rows, where 1 was expected             |

- `table` is the query's `from` table (or the written table) by its database name, so the message says which query failed without its SQL. A `db.sql` statement has none (`table` is `undefined`), and the message reads `The query returned no row, …`.
- `count` is every row the query returned, from the command tag, not "at least 2": the shapes add no `limit`, and `keepRows` decodes only two rows but the server still counts them all.
- `query` (the `CompiledQuery`) is set with `Object.defineProperty` and not enumerable (`hideQuery`), so logging the error or `JSON.stringify` doesn't print parameter values, which may be personal data or secrets. `error.query` still reads it, for debugging.
- An `err` mapper replaces the error with its own ([above](#mapping-the-error-err)).

A write that fails an `expect…` check has **already run**: the check reads the result. Inside a transaction, the thrown error rolls it back; outside one, the change stays. In a transactional `db.batch`, the check runs before COMMIT, so a failed check rolls the whole batch back ([EXECUTION.md](EXECUTION.md#transaction-true-or-transaction-options)).

### `BatchError` ([batch.ts](batch.ts))

A `db.batch` outside a transaction runs each query on its own: one failing doesn't stop the others, and what they wrote stays committed. So the batch can't reject with just one error. If any query fails, either in the database or in its shape's check (an `expectOne` finding no row), `valuesOf` collects every outcome and the batch rejects with a `BatchError`:

- it is an `AggregateError`, so `errors` holds the failures, in order;
- `results` holds every query's outcome by position, as `PromiseSettledResult`s: `{ status: 'fulfilled', value }` with the shaped result, or `{ status: 'rejected', reason }`;
- its message is `2 of the 5 queries in the batch failed; the others ran`.

A batch with `transaction: true` (or inside a transaction) is all or nothing, so it rejects with the error that failed it, not a `BatchError` ([EXECUTION.md](EXECUTION.md#batches)).

### Database errors

Errors from the server are the driver's `PostgresError` classes (`UniqueViolation`, `ForeignKeyViolation`, `SerializationFailure`, …, see [driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#errors)), re-exported from `quarry`. The executor attaches the query and your call site ([EXECUTION.md](EXECUTION.md#errors)).

### `violatedColumns(error, table)`

[errors.ts](errors.ts). A constraint error (any `IntegrityConstraintViolation`: a unique, foreign key or not-null violation, …) names database columns (`email_address`); your code knows TypeScript keys (`email`). `violatedColumns(error, users)` maps them back, using the error's `columns` (from its `column` field, or parsed from a `Key (a, b)=(…)` detail) and the table's `columnName`s. It compares the error's table with the table's database name (`_quarry.source`), so an aliased table works too. It returns `undefined` when the error is about another table, names no columns (most check constraints), or names something the table doesn't have (an expression in a unique index).

```ts
catch (error) {
  if (error instanceof UniqueViolation && violatedColumns(error, users)?.includes('email'))
    return reply.status(409).send({ field: 'email' });
  throw error;
}
```

## Inspecting a query

<a id="inspecting-a-query-tosql-tonode-toquery-describe"></a>

| Method          | On                          | Returns                                                                                                                                                   |
| --------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toSQL()`       | builders, `Query`, `db.sql` | the `CompiledQuery` that runs: `{ sql, params }` (+ codecs and `nested` as getters, `tag`)                                                                |
| `toNode()`      | builders                    | the node tree                                                                                                                                             |
| `toWhereNode()` | select builder              | the `where` clause's node, or `undefined`                                                                                                                 |
| `toQuery()`     | builders, `Query`, `db.sql` | the `Query` that `execute()` runs: the default shape (for `db.batch`); on a write that still needs a clause, typed `Missing<M>` so it can't go in a batch |
| `describe()`    | select builder              | the server's parameter and column types, without running                                                                                                  |

`toSQL()` on a builder compiles on each call; a `Query` and a `db.sql` statement return the `CompiledQuery` they hold. Whatever shape reads a query, `toSQL()` is the same.

## Decisions

Why the builders work this way. Each links to its full entry (what it is, why, the alternatives, the cost, measured impact) in [DECISIONS.md](DECISIONS.md):

- [Immutable builders](DECISIONS.md#immutable-builders): every method is a copy with one change, so a base query can be reused safely.
- [Reusable pieces are functions: `fragment`, `pipe` and `when`](DECISIONS.md#reusable-pieces-are-functions-fragment-pipe-and-when): a piece is declared over the tables it needs and applies to any query they are in.
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
- [`takeValue` needs a one-column row](DECISIONS.md#takevalue-needs-a-one-column-row): an object type has no column order.
- [`db.batch`: two modes with names](DECISIONS.md#dbbatch-two-modes-with-names): independent queries and a `BatchError`, or all or nothing.
- [Errors carry the query (hidden) and the code awaiting it](DECISIONS.md#errors-carry-the-query-hidden-and-the-code-awaiting-it): row-count errors name the table and keep parameters out of logs.
- [`setEach`: one method for the source, the assignments and the key match](DECISIONS.md#seteach-one-method-for-the-source-the-assignments-and-the-key-match): a bulk update whose key match is generated, so it can be the required `where`.
- [Rows that set different columns: flag columns and `case`](DECISIONS.md#rows-that-set-different-columns-flag-columns-and-case): `undefined` keeps a value, `null` sets NULL, in one statement.
- [`setEach` rows are typed by the table, and duplicate keys are refused](DECISIONS.md#seteach-rows-are-typed-by-the-table-and-duplicate-keys-are-refused): no misspelled or read-only columns, no ambiguous updates.
- [Outer joins make the joined side nullable: `NullableTable`](DECISIONS.md#outer-joins-make-the-joined-side-nullable-nullabletable): the row type says which columns can be NULL.
- [A table joined twice, or a key selected twice, is refused](DECISIONS.md#a-table-joined-twice-or-a-key-selected-twice-is-refused): both silently corrupted results.
- [`selectAll` lists the columns, never `*`](DECISIONS.md#selectall-lists-the-columns-never-): each column keeps its key and codec.
- [`selectAll` takes the name a table goes by](DECISIONS.md#selectall-takes-the-name-a-table-goes-by): one form, the name every other reference uses.
- [`nest` marks a joined row with `ctid`](DECISIONS.md#nest-marks-a-joined-row-with-ctid): flat columns plus one marker, so a missing row is `null` and a row of nulls is an object.
- [`nest`'s object keys in the builder's type: `K`](DECISIONS.md#nests-object-keys-in-the-builders-type-k): an object's key can't be ordered, grouped or paged by.
- [Ordering by a selected key uses the bare key](DECISIONS.md#ordering-by-a-selected-key-uses-the-bare-key): a dot always means a column.
- [Raw SQL only through the `sql` template tag](DECISIONS.md#raw-sql-only-through-the-sql-template-tag): `db.sql` and fragments stay injection-safe.

## Glossary

**Cursor**: a server-side position in a query's result, read a batch at a time.

**Flag column**: in a `setEach`, the extra boolean column `set:<name>` that says, per row, whether the row gave a value for that column.

**Fragment**: a reusable piece of a select query, declared over the tables it needs with `fragment` and applied with `pipe`.

**Inner join**: a join that keeps only rows with a match on both sides.

**Key** (of a `setEach`): the column, or columns, that match each given row to the table's row.

**Lock**: a server-side mark on rows that makes other transactions wait (or skip, or fail) before changing them.

**Locking clause**: `for <strength> [of …] [skip locked | nowait]` at the end of a select; one per strength method called.

**Marker**: the hidden `table.ctid is not null` column `nest` adds per object, false where an outer join found no row.

**Outer join**: a left, right or full join, which keeps rows with no match, with NULLs for the other side's columns.

**Result shape**: what `execute()` makes of a query's rows.

**`returning`**: the clause that makes a write return rows (`insert … returning id`).

**Row count**: how many rows a statement returned or changed.

**Strength**: how strongly a locking clause locks its rows: `update`, `no key update`, `share` or `key share`.

**Transaction**: statements that commit (take effect) together or not at all.

**Upsert**: an insert with `on conflict` handling.

**Wait policy**: what a locking clause does with rows another transaction has locked: wait (the default), `skip locked`, or `nowait`.
