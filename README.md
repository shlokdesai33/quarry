# quarry

A type-safe PostgreSQL query builder for TypeScript, with its own dependency-free driver.

- **`quarry`**: tables defined once in TypeScript give typed rows, inserts and updates, comparisons that only accept what Postgres accepts, and a `verify` command that checks the definitions against the live database.
- **`quarry/driver`**: a PostgreSQL driver written against the wire protocol, usable on its own. It pipelines concurrent queries, caches prepared statements, receives results in binary, and runs on Node, Bun, Deno and Cloudflare Workers.

## Requirements and building

Requires PostgreSQL 18+, Node 22.12+ (or Bun, Deno, Cloudflare Workers) and TypeScript with `strict`. From a checkout:

```sh
pnpm install
pnpm build # dist/: the quarry and quarry/driver entry points, and the quarry CLI (dist/cli.js)
```

## Quick start

```ts
import { database, defineTable, integer, text, timestamptz } from 'quarry';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text(),
		name: text().nullable(),
		createdAt: timestamptz().name('created_at').default(),
	},
});

const db = database({ connectionString: process.env.DATABASE_URL });

// { id: number; name: string | null }
const user = await db
	.selectFrom(users)
	.where('users.email', 'ada@example.com')
	.select(['users.id', 'users.name'])
	.expectOne()
	.execute();
```

## Contents

- [Schema](#schema): [column types](#column-types), [modifiers](#modifiers), [enums](#enums), [codecs and custom types](#codecs-and-custom-types), [row types](#row-types)
- [Opening a database](#opening-a-database)
- [Selecting](#selecting): [where](#where), [joins](#joins), [ordering](#ordering-limit-and-distinct), [grouping](#grouping-and-aggregates), [expressions](#expressions), [locking](#locking), [reusable pieces](#conditional-and-reusable-pieces), [pagination](#pagination), [streaming](#streaming)
- [Writing](#writing): [insert](#insert), [upsert](#upsert), [update](#update), [setEach](#updating-many-rows-with-seteach), [delete](#delete), [returning](#returning)
- [Result shapes](#result-shapes) · [Running queries](#running-queries) · [Batches](#batches) · [Transactions](#transactions) · [Raw SQL](#raw-sql) · [Errors](#errors)
- [Schema verification](#schema-verification)
- [The driver](#the-driver): [options](#connection-options), [pool options](#pool-options), [TLS and authentication](#tls-and-authentication), [codecs](#driver-codecs), [PgBouncer](#pgbouncer-and-other-poolers)
- [Benchmarks](#benchmarks)

## Schema

```ts
import {
	array,
	bigint,
	boolean,
	defineEnum,
	defineTable,
	integer,
	jsonb,
	text,
	timestamptz,
	varchar,
} from 'quarry';

export const role = defineEnum('user_role', ['admin', 'member', 'guest']);

export const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: varchar(320),
		name: text().nullable(),
		role: role().default(),
		tags: array(text()).default(),
		settings: jsonb<{ theme: 'light' | 'dark' }>().default(),
		createdAt: timestamptz().name('created_at').default(),
	},
});

export const posts = defineTable('posts', {
	columns: {
		id: bigint().identity(),
		authorId: integer().name('author_id'),
		title: text(),
		published: boolean().default(),
	},
});
```

Columns are keyed by their TypeScript name; `.name('created_at')` maps one to its database name. References are always qualified: `users.createdAt`. The examples below use these two tables.

`table.as('alias')` references a table under another name, e.g. for self-joins: `users.as('managers')`.

### Column types

| Factory             | SQL type            | TypeScript type   |
| ------------------- | ------------------- | ----------------- |
| `smallint()`        | `smallint`          | `number`          |
| `integer()`         | `integer`           | `number`          |
| `bigint()`          | `bigint`            | `string`          |
| `real()`            | `real`              | `number`          |
| `doublePrecision()` | `double precision`  | `number`          |
| `decimal(p?, s?)`   | `numeric(p, s)`     | `string`          |
| `boolean()`         | `boolean`           | `boolean`         |
| `text()`            | `text`              | `string`          |
| `varchar(n?)`       | `varchar(n)`        | `string`          |
| `uuid()`            | `uuid`              | `string`          |
| `bytea()`           | `bytea`             | `Uint8Array`      |
| `date()`            | `date`              | `string`          |
| `time()`            | `time`              | `string`          |
| `timestamp()`       | `timestamp`         | `string`          |
| `timestamptz()`     | `timestamptz`       | `Date`            |
| `interval()`        | `interval`          | `string`          |
| `jsonb<T>()`        | `jsonb`             | `T` (`JsonValue`) |
| `inet()`            | `inet`              | `string`          |
| `tsvector()`        | `tsvector`          | `string`          |
| `daterange()`       | `daterange`         | `Range<string>`   |
| `tstzrange()`       | `tstzrange`         | `Range<Date>`     |
| `vector()`          | `vector` (pgvector) | `number[]`        |
| `array(column)`     | `element[]`         | `element[]`       |
| `defineEnum(...)()` | the enum            | union of labels   |

A `Range<T>` is `{ empty: true }` or `{ empty: false, lower, upper, bounds }`, with `null` for an unbounded side and `bounds` one of `'[)'`, `'(]'`, `'[]'`, `'()'`.

Every factory but `bytea()` takes a type parameter that narrows its value, for branded ids and literal unions: `integer<UserId>()`, `text<'free' | 'pro'>()`.

### Modifiers

| Modifier            | Meaning                                     | Effect on types                    |
| ------------------- | ------------------------------------------- | ---------------------------------- |
| `.nullable()`       | allows `NULL`                               | adds `null` everywhere             |
| `.default()`        | the database has a default                  | optional on insert                 |
| `.generated()`      | `generated always as (…) stored`            | never written                      |
| `.identity()`       | `generated always as identity` (integers)   | never written                      |
| `.name(n)`          | the column's database name                  | none                               |
| `.typed<S, I, U>()` | narrows the select, insert and update types | e.g. `typed<string, never, never>` |
| `.useCodec(codec)`  | sends and reads the column with `codec`     | the codec's types                  |

Each modifier returns a column with only the modifiers Postgres still allows after it (e.g. `identity()` offers no `default()`).

### Enums

```ts
import { defineEnum, defineTable } from 'quarry';

const status = defineEnum('order_status', ['pending', 'paid', 'shipped']);

const orders = defineTable('orders', {
	columns: { status: status().default() },
});
```

Labels are ordered as declared, so `gt`/`lt` compare by position. An enum can back any number of columns, and `status<'paid'>()` narrows one column to some labels.

### Codecs and custom types

Each column type has a [driver codec](#driver-codecs) that encodes its parameters and decodes its results. `.useCodec` swaps it, along with the column's types; `defineType` declares a type that has no factory (an extension type, a domain):

```ts
import { bigint, codecs, defineTable, defineType, timestamptz } from 'quarry';

const citext = defineType({ sql: 'citext', codec: codecs.text });

const events = defineTable('events', {
	columns: {
		id: bigint().identity().useCodec(codecs.int8), // bigint instead of string
		at: timestamptz().useCodec(codecs.raw), // the server's text
		key: citext(),
	},
});
```

### Row types

```ts
import type { InferInsertType, InferSelectType, InferUpdateType } from 'quarry';

type User = InferSelectType<typeof users>; // every column, as selected
type NewUser = InferInsertType<typeof users>; // defaults optional; identity and generated absent
type UserPatch = InferUpdateType<typeof users>; // every writable column optional
```

## Opening a database

```ts
import { database } from 'quarry';

const db = database(
	{ connectionString: process.env.DATABASE_URL, max: 20 },
	{ onQuery: (event) => console.debug(event.sql, event.durationMs) },
);
```

`database()` takes a connection string, [driver](#connection-options) and [pool options](#pool-options) (it then owns the pool, which `db.close()` ends), or a `Pool`, `PoolClient` or `Connection` you manage. `await using db = database(...)` closes it at the end of the scope.

| Option      | Default | Description                                                                                         |
| ----------- | ------- | --------------------------------------------------------------------------------------------------- |
| `onQuery`   |         | Called when each query settles, with its SQL, parameters, tag, row count, error and timings.        |
| `callsites` | `true`  | Adds the stack of the code awaiting a failed query to its error.                                    |
| `codecs`    |         | Codecs for result columns of unknown type (raw SQL).                                                |
| `catalog`   | `true`  | Looks up the types codecs name (enums, pgvector, custom types) in `pg_type` before the first query. |
| `prepare`   |         | Uses cached prepared statements (the connection's setting by default).                              |

## Selecting

```ts
// { id: string; title: string; name: string | null }[]
const rows = await db
	.selectFrom(posts)
	.innerJoin(users)
	.on('users.id', 'posts.authorId')
	.where('posts.published', true)
	.select(['posts.id', 'posts.title', 'users.name'])
	.orderBy('posts.id', 'desc')
	.limit(20)
	.execute();
```

`select` takes columns (keyed by name) or a callback returning columns and aliased expressions; each call adds to the list. `selectAll()` selects every column, `selectAll(users)` every column of one table. Only tables in scope can be referenced.

```ts
const emails = await db
	.selectFrom(users)
	.select((eb) => ['users.id', eb.fn.lower('users.email').as('email')])
	.execute();
```

### Where

```ts
const admins = await db
	.selectFrom(users)
	.where('users.role', 'admin') // equality
	.where((eb) =>
		eb.or([eb.ref('users.name').isNull(), eb.ref('users.name').like('A%')]),
	)
	.select(['users.id'])
	.execute();
```

`where` takes `(column, value)`, a callback returning a condition, or a predicate built elsewhere. Several calls are joined with `and`.

### Joins

```ts
const rows = await db
	.selectFrom(users)
	.leftJoin(posts)
	.on('posts.authorId', 'users.id')
	.select(['users.email', 'posts.title']) // title: string | null
	.execute();
```

`innerJoin`, `leftJoin`, `rightJoin`, `fullJoin` and `crossJoin`. `on` takes two columns of comparable types (the joined table's first) or any `where` form. Outer joins make the columns of the optional side nullable.

### Ordering, limit and distinct

```ts
const page = await db
	.selectFrom(posts)
	.select(['posts.authorId', 'posts.title'])
	.distinctOn(['posts.authorId'])
	.orderBy('posts.authorId')
	.orderBy('posts.id', 'desc', { nulls: 'last' })
	.limit(20)
	.offset(40)
	.execute();
```

`orderBy` takes a column, a selected key or an expression callback; several calls add keys. `distinct()` and `distinctOn([...])` are available.

### Grouping and aggregates

```ts
// { id: number; postCount: string }[]
const authors = await db
	.selectFrom(users)
	.leftJoin(posts)
	.on('posts.authorId', 'users.id')
	.select((eb) => ['users.id', eb.fn.count('posts.id').as('postCount')])
	.groupBy(['users.id'])
	.having((eb) => eb.fn.count('posts.id').gte('5'))
	.orderBy('postCount', 'desc')
	.execute();
```

Aggregates have Postgres's types: `count` is a `bigint` (a string; `eb.fn.cast(eb.fn.count(), 'integer')` for a number), `sum` of an `integer` is a `bigint`, `avg` a `numeric`, and `min`/`max` keep their argument's type.

### Expressions

Callbacks receive an expression builder `eb` (destructurable; `expressionBuilder(...tables)` makes one outside a query):

| Member                                       | Builds                                         |
| -------------------------------------------- | ---------------------------------------------- |
| `eb.ref(column)`                             | a column, with the comparisons of its SQL type |
| `eb.val(value, codec?)`                      | a parameter                                    |
| `eb.and([...])`, `eb.or([...])`, `eb.not(p)` | combined predicates                            |
| `eb.fn`                                      | SQL functions and aggregates                   |
| `eb.json`                                    | jsonb accessors and tests                      |
| `eb.case()`                                  | `case when … then … else … end`                |

Comparisons, by SQL type. Each takes a value of the column's type or an expression of a type Postgres compares with it:

| Type              | Methods                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| every type        | `eq`, `ne`, `in`, `notIn`, `isNull`, `isNotNull`, `isDistinctFrom`, `isNotDistinctFrom`                                                 |
| ordered types     | `gt`, `gte`, `lt`, `lte`, `between`, `notBetween`                                                                                       |
| `text`, `varchar` | `like`, `notLike`, `ilike`, `notIlike`, `regex`, `notRegex`, `iregex`, `notIregex`, `startsWith`                                        |
| `boolean`         | `isTrue`, `isNotTrue`, `isFalse`, `isNotFalse`                                                                                          |
| arrays, `jsonb`   | `contains`, `containedBy`; arrays also `overlaps`                                                                                       |
| ranges            | `contains`, `containedBy`, `overlaps`, `strictlyLeftOf`, `strictlyRightOf`, `doesNotExtendRightOf`, `doesNotExtendLeftOf`, `adjacentTo` |
| `inet`            | `isSubnetOf`, `isSubnetOrEqual`, `isSupernetOf`, `isSupernetOrEqual`, `overlaps`                                                        |
| `tsvector`        | `matches(tsquery)`                                                                                                                      |
| `vector`          | `l2Distance`, `cosineDistance`, `innerProduct`                                                                                          |
| numbers           | `plus`, `minus`, `times`, `dividedBy`, `mod`                                                                                            |
| dates and times   | `plus(interval)`, `minus(interval)`, `minus(timestamp)`                                                                                 |

`in([...])` sends one array parameter (`= any($1)`) however long the list. `eb.fn.any(array)` and `eb.fn.all(array)` quantify any comparison.

Functions on `eb.fn`: `lower`, `upper`, `length`, `trim`, `ltrim`, `rtrim`, `substring`, `replace`, `strpos`, `left`, `right`, `splitPart`, `concat`, `coalesce`, `nullif`, `greatest`, `least`, `abs`, `round`, `ceil`, `floor`, `now`, `currentDate`, `dateTrunc`, `extract`, `toChar`, `cardinality`, `cast`, `jsonbBuildObject`, `any`, `all`, and the aggregates `count`, `countDistinct`, `sum`, `avg`, `min`, `max`, `arrayAgg`, `stringAgg`, `boolAnd`, `boolOr`, `jsonbAgg`.

jsonb on `eb.json`: `get` (`->`), `text` (`->>`), `hasKey`, `hasAnyKey`, `hasAllKeys`, `pathExists`, `pathMatches`, `typeOf`, `length`. Paths are checked against the column's document type.

```ts
const rows = await db
	.selectFrom(users)
	.where((eb) => eb.json.text('users.settings', 'theme').eq('dark'))
	.where((eb) => eb.ref('users.tags').contains(['beta']))
	.select((eb) => [
		eb.fn.coalesce('users.name', eb.val('anonymous')).as('name'),
		eb
			.case()
			.when(eb.ref('users.role').eq('admin'), 'staff')
			.else('customer')
			.end()
			.as('kind'),
	])
	.execute();
```

### Locking

```ts
await db.transaction(async (tx) => {
	const post = await tx
		.selectFrom(posts)
		.where('posts.published', false)
		.select(['posts.id'])
		.orderBy('posts.id')
		.limit(1)
		.forUpdate()
		.skipLocked()
		.takeFirst()
		.execute();
});
```

`forUpdate`, `forNoKeyUpdate`, `forShare` and `forKeyShare`, each optionally followed by `.of(...tables)` and then `.skipLocked()` or `.noWait()`.

### Conditional and reusable pieces

```ts
import { fragment } from 'quarry';

const published = fragment(posts, (qb) => qb.where('posts.published', true));

// { title: string; name?: string | null }[]
const rows = await db
	.selectFrom(posts)
	.innerJoin(users)
	.on('users.id', 'posts.authorId')
	.pipe(published)
	.select(['posts.title'])
	.when(withAuthor, (qb) => qb.select(['users.name']))
	.execute();
```

`when(condition, build)` applies `build` only when `condition` holds; columns it selects are optional in the row. `fragment(tables, build)` defines a piece that `pipe` applies to any query containing those tables, adding its joins and columns.

### Pagination

```ts
// keyset pagination, for APIs: { rows, nextCursor, hasMore }
const page = await db
	.selectFrom(posts)
	.select(['posts.id', 'posts.title'])
	.paginateByCursor({ perPage: 20, by: 'posts.id', after: cursor });

// numbered pages: { rows, page, perPage, hasMore, total }
const numbered = await db
	.selectFrom(users)
	.select(['users.id', 'users.email'])
	.paginateByOffset({ page: 2, perPage: 50, by: 'users.id', countTotal: true });

// every row, in keyset batches of 1000
for await (const batch of db
	.selectFrom(users)
	.select(['users.id'])
	.iterateChunks(1000, { by: 'users.id' })) {
	console.log(batch.length);
}
```

`by` is a unique, non-null, selected column or list of columns (`['posts.authorId', 'posts.id']`); `direction: 'desc'` reverses it. An altered or foreign cursor rejects with `InvalidCursorError`.

### Streaming

```ts
for await (const user of db
	.selectFrom(users)
	.select(['users.id', 'users.email'])
	.stream({ batchSize: 1000 })) {
	console.log(user.email);
}
```

`stream()` reads rows through a cursor, one batch at a time with backpressure, decoded as `execute()` decodes them. Leaving the loop (or aborting its `signal`) closes the cursor and frees its connection. Inside `db.transaction`, other queries of the transaction can run in the loop. A stream is an async iterable, so `Readable.from(stream)` and `ReadableStream.from(stream)` work.

## Writing

### Insert

```ts
// { id: number; createdAt: Date }
const user = await db
	.insertInto(users)
	.values({ email: 'ada@example.com', name: 'Ada' })
	.returning(['users.id', 'users.createdAt'])
	.expectOne()
	.execute();

await db
	.insertInto(users)
	.values([
		{ email: 'alan@example.com', name: 'Alan' },
		{ email: 'grace@example.com', name: null },
	])
	.execute();
```

`values` is typed by [`InferInsertType`](#row-types). An array of rows is sent as one array parameter per column through `unnest`, so the SQL is the same for any number of rows.

### Upsert

```ts
await db
	.insertInto(users)
	.values({ email: 'ada@example.com', name: 'Ada' })
	.onConflict('email')
	.doUpdate((excluded) => ({ name: excluded.name }))
	.execute();
```

`onConflict(column | columns)` then `doNothing()`, `merge(columns?)` (set each column to the proposed value) or `doUpdate((excluded, eb) => set)`. `.onConflict(...).where(...)` targets a partial unique index.

### Update

```ts
await db
	.update(users)
	.set((eb) => ({ name: 'Ada Lovelace', email: eb.fn.lower('users.email') }))
	.where('users.id', id)
	.expectRows(1)
	.execute();
```

`set` takes values or expressions for writable columns. An update runs only once it has a `where`, `.allRows()` or `setEach`; otherwise `execute()` is a type error. The same applies to deletes.

### Updating many rows with setEach

```ts
await db
	.update(users)
	.setEach(
		[
			{ id: 1, name: 'Ada' },
			{ id: 2, email: 'alan@example.com' },
		],
		{ key: 'id' },
	)
	.execute();
```

Each row is updated to its own values in one statement, matched by `key` (a column or a composite key). A column a row leaves out keeps its value; `null` sets it to null. The rows are in scope as `row` (or `as: 'name'`) in `set`, `where` and `returning`, e.g. `.where((eb) => eb.ref('users.name').ne(eb.ref('row.name')))`.

### Delete

```ts
await db.deleteFrom(posts).where('posts.published', false).execute(); // { rowCount }
```

### Returning

`insertInto`, `update` and `deleteFrom` take `returning([...])` (the same forms as `select`) and `returningAll()`, and every [result shape](#result-shapes). Without `returning`, `execute()` resolves to `{ rowCount }`.

## Result shapes

| Shape               | Resolves to          | Throws                           |
| ------------------- | -------------------- | -------------------------------- |
| `execute()`         | `Row[]`              |                                  |
| `takeFirst()`       | `Row \| undefined`   |                                  |
| `takeValue()`       | `Value \| undefined` |                                  |
| `expectFirst()`     | `Row`                | `NoRowError`                     |
| `expectOne()`       | `Row`                | `NoRowError`, `TooManyRowsError` |
| `expectAtMostOne()` | `Row \| undefined`   | `TooManyRowsError`               |
| `expectNonEmpty()`  | `[Row, ...Row[]]`    | `NoRowError`                     |
| `expectValue()`     | `Value`              | `NoRowError`                     |
| `expectRows(n)`     | the write's result   | `RowCountError` (writes only)    |

```ts
const email = await db
	.selectFrom(users)
	.where('users.id', id)
	.select(['users.email'])
	.expectValue((error) => new Error(`no user ${id}`, { cause: error }))
	.execute(); // string
```

The shape goes before `execute()` and leaves the SQL unchanged. `takeValue` and `expectValue` need exactly one selected column. Each `expect…` takes an optional function that maps its error to yours.

## Running queries

```ts
const controller = new AbortController();

const rows = await db
	.selectFrom(users)
	.select(['users.id'])
	.tag('users.list')
	.execute({ signal: controller.signal, timeout: '2s' });
```

| Option    | Description                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------ |
| `signal`  | An `AbortSignal` that cancels the query on the server.                                           |
| `timeout` | A server-side statement timeout for this query only, in milliseconds or as an interval (`'2s'`). |

- `.tag(name)` labels a query for `onQuery` and OpenTelemetry; it never appears in the SQL.
- `query.toSQL()` returns `{ sql, params }`; `await query.describe()` returns the parameter and column types as the server sees them.
- `selectFrom`, `insertInto`, `update` and `deleteFrom` are also exported standalone: such queries can be composed, inspected and run by `db.batch`.

## Batches

```ts
const [user, titles, { rowCount }] = await db.batch([
	db
		.selectFrom(users)
		.where('users.id', id)
		.select(['users.email'])
		.expectOne(),
	db.selectFrom(posts).where('posts.authorId', id).select(['posts.title']),
	db.update(users).set({ name: 'Ada' }).where('users.id', id),
]);
```

`db.batch` runs several queries in one round trip and resolves to their typed results by position. Without `transaction`, each query runs on its own, and if any fails the batch rejects with a `BatchError` holding every outcome. With `{ transaction: true }` (or transaction options), they run all or nothing.

## Transactions

```ts
const postId = await db.transaction(
	async (tx) => {
		const post = await tx
			.insertInto(posts)
			.values({ authorId: id, title: 'Hello' })
			.returning(['posts.id'])
			.expectOne()
			.execute();
		tx.afterCommit(() => console.log('created', post.id));
		return post.id;
	},
	{ isolation: 'serializable', retries: 3 },
);
```

The transaction commits when the callback resolves and rolls back when it throws. `tx` has the query methods of `db`, plus:

- `tx.transaction(fn)`: a savepoint.
- `tx.afterCommit(fn)`: runs once the outermost transaction commits.
- `tx.afterRollback(fn)`: runs if this transaction or savepoint rolls back.
- `tx.setLocal(name, value)`: a transaction-local setting, with a bound value.

Options: `isolation`, `readOnly`, `deferrable`, `retries` (re-runs on serialization failures and deadlocks), `settings` (transaction-local settings, e.g. for row-level security), `timeout`, and `durable` (throws if already inside a transaction).

## Raw SQL

```ts
import { sql } from 'quarry';

const rows = await db
	.selectFrom(users)
	.select((eb) => [
		sql<number>`extract(epoch from ${eb.ref('users.createdAt')})`.as('epoch'),
	])
	.where((eb) => sql<boolean>`${eb.ref('users.name')} % ${search}`)
	.execute();

const count = await db.sql<{ n: string }>`select count(*) as n from posts`
	.expectValue()
	.execute();
```

`sql` fragments work wherever an expression does; `db.sql` runs a whole statement with every result shape. Interpolated values are parameters; expressions, tables, `sql.id(...)` (identifiers), `sql.lit(...)` (literals) and `sql.join([...])` (lists) are written into the SQL.

## Errors

```ts
import { UniqueViolation, violatedColumns } from 'quarry';

try {
	await db
		.insertInto(users)
		.values({ email: 'ada@example.com', name: null })
		.execute();
} catch (error) {
	if (
		error instanceof UniqueViolation &&
		violatedColumns(error, users)?.includes('email')
	) {
		console.log('email taken');
	}
}
```

- Server errors are `PostgresError`s, with every field the server sends; common SQLSTATEs have subclasses: `UniqueViolation`, `ForeignKeyViolation`, `NotNullViolation`, `CheckViolation`, `ExclusionViolation` (all `IntegrityConstraintViolation`s, with `columns`), `SerializationFailure`, `DeadlockDetected`, `QueryCanceled`, `LockNotAvailable`, `ReadOnlyTransaction`, `IdleInTransactionTimeout`, `TransactionTimeout`, `UndefinedTable`, `UndefinedColumn`.
- Client errors: `ConnectionError`, `ProtocolError`, `AbortError`, `UndefinedParameterError`, `DecodeError`, `TransactionRolledBack`.
- Result shapes throw `NoRowError`, `TooManyRowsError` and `RowCountError`, with the table and the compiled query.
- `violatedColumns(error, table)` maps a constraint violation to the table's column keys.

## Schema verification

`verify` compares table definitions with the live schema in one read-only catalog query, and reports each difference with the line of code it concerns and the SQL that would fix it.

From code:

```ts
import { formatVerifyReport } from 'quarry';

const report = await db.verify([users, posts], { strict: true });
if (!report.ok) throw new Error(formatVerifyReport(report));
```

From the command line (the `quarry` CLI, built at `dist/cli.js`), with a `quarry.config.ts`:

```ts
import { database, defineConfig } from 'quarry';
import * as schema from './src/schema.ts';

export default defineConfig({
	db: database({ connectionString: process.env.DATABASE_URL }),
	schema,
});
```

```sh
quarry verify [--config <path>] [--format pretty|table|github|json] [--strict] [--schema <name>] [--ascii] [--no-color]
```

The exit code is `0` when the schema matches, `1` on errors and `2` when the command couldn't run. `--format github` annotates pull requests. `--strict` (or `{ strict: true }`) makes columns that only the database has errors.

It checks: missing tables and columns, SQL types (with modifiers and arrayness), nullability, defaults, identity and generated columns, enum labels and their order, and columns only the database has.

## The driver

```ts
import { connect, createPool } from 'quarry/driver';

const pool = createPool({
	connectionString: process.env.DATABASE_URL,
	max: 20,
});

const { rows, rowCount } = await pool.query(
	'select id, email from users where id = $1',
	[42],
);

await pool.transaction(
	async (tx) => {
		await tx.query('insert into posts (author_id, title) values ($1, $2)', [
			42,
			'Hi',
		]);
	},
	{ isolation: 'serializable', retries: 3 },
);

for await (const row of pool.stream('select * from posts')) {
	console.log(row);
}

await pool.copyRows('copy posts (author_id, title) from stdin', [[42, 'Hi']]);

const unlisten = await pool.listen('events', (n) => console.log(n.payload));

await using conn = await connect('postgres://app@localhost/app');
await conn.query('select 1');
```

- **Queries**: `query(sql, params, options)` returns `{ rows, rowCount, command, fields }`. Per-query options: `rowMode: 'array'`, `signal`, `timeout`, `statementTimeout`, `paramTypes`, `paramCodecs`, `resultCodecs`, `codecs`, `prepare`, `keepRows`, `tag`, `onTiming`. `simpleQuery(sql)` runs several statements; `describe(sql)` returns parameter and result types.
- **Parameters** are always sent separately from the SQL. `typed(value, codec)` encodes a parameter with a codec and declares its type; arrays declared with `arrayOf(codec)` go in binary.
- **Prepared statements** are cached per connection (100 by default); one made stale by a schema change is retried once, unnamed. Concurrent queries are pipelined on shared connections once the pool is busy.
- **Transactions** (`pool.transaction`, `conn.transaction`) take `isolation`, `readOnly`, `deferrable`, `retries`, `retryDelay`, `settings`, `timeout` and `durable`; `BEGIN` travels with the first statement. `tx.transaction` nests a savepoint; `tx.afterCommit`, `tx.afterRollback` and `tx.setLocal` work as in the [query builder](#transactions).
- **Streaming and COPY**: `conn.cursor(sql, params, { batchSize })` yields batches, `pool.stream` yields rows, `copyRows`, `copyFrom` and `copyTo` run `COPY`, all with backpressure.
- **LISTEN/NOTIFY**: `pool.listen(channel, handler)` resubscribes after reconnects; `conn.notify(channel, payload)` sends.
- **Cancellation**: `signal` and `timeout` cancel a query on the server; `statementTimeout` sets a server-side timeout for one query; `conn.cancel()` cancels the running query.
- **Pool**: `pool.acquire()` reserves a connection (`await using client = await pool.acquire()`), `pool.stats` reports `{ total, idle, busy, waiting }`, `pool.end({ timeout })` drains and closes.
- **Observability**: `telemetry: { tracer }` emits OpenTelemetry client spans, `onNotice` receives server notices, `captureStack` adds the caller's stack to errors.

### Connection options

Options resolve like libpq: the options object, then the connection string (`postgres://…` or `key=value`), then `PG*` environment variables, then the password file.

| Option               | Default                    | Description                                                                         |
| -------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| `connectionString`   |                            | A `postgres://` URL or a `key=value` string.                                        |
| `host`, `port`       | `localhost`, `5432`        | Comma-separated for failover; a host starting with `/` is a Unix socket directory.  |
| `user`, `database`   | the OS user, the user name |                                                                                     |
| `password`           |                            | A string, or a function returning one per connection (e.g. IAM tokens).             |
| `applicationName`    |                            | Shown in `pg_stat_activity`.                                                        |
| `ssl`                | see below                  | An `sslmode` string or an options object.                                           |
| `channelBinding`     | `'prefer'`                 | SCRAM channel binding: `'disable'`, `'prefer'` or `'require'`.                      |
| `requireAuth`        |                            | Accepted authentication methods, as libpq's `require_auth`.                         |
| `connectTimeout`     | `30000`                    | Milliseconds to connect and authenticate.                                           |
| `keepAlive`          | `true`                     | TCP keep-alive, with `keepAliveInitialDelay`.                                       |
| `targetSessionAttrs` | `'any'`                    | `'read-write'`, `'read-only'`, `'primary'`, `'standby'` or `'prefer-standby'`.      |
| `params`             |                            | Startup parameters, e.g. `{ search_path: 'app' }`.                                  |
| `options`            |                            | Server command-line options, as `PGOPTIONS`.                                        |
| `passfile`           | `~/.pgpass`                | A `.pgpass` file.                                                                   |
| `codecs`             | `defaultCodecs`            | Result codecs by type, over the defaults, or a registry.                            |
| `prepare`            | `true`                     | Use named prepared statements.                                                      |
| `statementCacheSize` | `100`                      | Prepared statements kept per connection.                                            |
| `preparePipelined`   | detected                   | Use named statements for pipelined queries too.                                     |
| `binaryResults`      | `true`                     | Receive columns in binary where their codec supports it.                            |
| `protocol`           | `'auto'`                   | `'auto'` (3.2, accepting 3.0), `'3.0'` or `'3.2'`; also `min`/`maxProtocolVersion`. |
| `telemetry`          |                            | An OpenTelemetry tracer, and whether to record query text.                          |
| `captureStack`       | `false`                    | Append the calling code's stack to query errors.                                    |
| `onNotice`           |                            | Receives `NOTICE`, `WARNING` and other server messages.                             |
| `onNotification`     |                            | Receives `NOTIFY` messages.                                                         |
| `maxMessageSize`     |                            | Refuse server messages larger than this many bytes.                                 |
| `socket`             | per runtime                | A custom `SocketFactory`.                                                           |
| `env`                | `process.env`              | Where `PG*` variables are read from.                                                |

### Pool options

| Option           | Default   | Description                                                           |
| ---------------- | --------- | --------------------------------------------------------------------- |
| `max`            | `10`      | Most open connections.                                                |
| `min`            | `0`       | Connections kept open when idle.                                      |
| `idleTimeout`    | `30000`   | Close connections idle this long (ms).                                |
| `maxLifetime`    | `3600000` | Replace connections older than this (ms), with jitter.                |
| `acquireTimeout` | `30000`   | How long `acquire` waits (ms).                                        |
| `maxWaiting`     | unlimited | Most waiting callers before `acquire` fails fast.                     |
| `pipeline`       | adaptive  | Pipelining depth on busy connections: adaptive, a number, or `false`. |
| `onConnect`      |           | Runs on each new connection before it is used.                        |

### TLS and authentication

`ssl` takes libpq's modes: `disable`, `allow`, `prefer`, `require`, `verify-ca`, `verify-full`. The default is `verify-full` for remote hosts and `prefer` for `localhost` and Unix sockets.

```ts
import { connect } from 'quarry/driver';

await using conn = await connect({
	host: 'db.example.com',
	ssl: { mode: 'verify-full', rootCertFile: 'system', negotiation: 'direct' },
	requireAuth: 'scram-sha-256',
});
```

- **Trust roots**: `ca` (PEM), `rootCertFile` (a path or `'system'`), `~/.postgresql/root.crt`, then the platform's store.
- **Direct TLS**: `negotiation: 'direct'` skips the `SSLRequest` round trip.
- **Authentication**: SCRAM-SHA-256 (with SCRAM-SHA-256-PLUS channel binding), md5, cleartext, and client certificates (`ssl: { cert, key }`, `certFile`/`keyFile`, or libpq's `sslcert`/`sslkey`).

### Driver codecs

A codec encodes one type's parameters and decodes its results. `defaultCodecs` decodes numbers, `int8` as `bigint`, booleans, JSON, `bytea` and arrays; `numeric`, dates and times stay text. `codecs` holds the built-in ones (e.g. `codecs.int8AsString`, `codecs.timestamptz`, `codecs.vector`, `codecs.raw`), `arrayOf(codec)` makes an array codec, and `defineCodec` defines your own; codecs with `oid: 0` are looked up by name in `pg_type`.

```ts
import { codecs, createPool, defineCodec } from 'quarry/driver';

const numericAsNumber = defineCodec({
	name: 'numeric',
	oid: 1700,
	arrayOid: 1231,
	encode: (value: number) => value.toFixed(2),
	decodeText: (text) => Number(text),
});

const pool = createPool({
	codecs: [codecs.int8AsString, codecs.timestamptz, numericAsNumber],
});
```

### PgBouncer and other poolers

- **Transaction mode** works with prepared statements from PgBouncer 1.21 with `max_prepared_statements` set; PgBouncer 1.26+ without it is detected at login and statements are sent unnamed. Set `prepare: false` for poolers without prepared-statement support, and `preparePipelined: false` for PgBouncer 1.21–1.25.
- **Cursors and streams** work in transaction mode, each holding one server connection while open.
- **The driver's own settings** (`statementTimeout`, transaction `settings` and `timeout`) use `set_config(…, true)` inside a transaction, so they work behind any transaction pooler.
- **Protocol 3.2** falls back to 3.0 with poolers that negotiate it down; `minProtocolVersion` and `maxProtocolVersion` override this.
- `connection.capabilities` reports the negotiated `protocol`, `serverVersion`, `pgbouncer` (when detected) and the server's `saslMechanisms`.

## Benchmarks

`quarry/driver` against `pg` (unnamed and named statements), `pg-native`, postgres.js and Bun.sql, at commit `c646f4b`: PostgreSQL 18.6 on an 8-vCPU VM (client, server and proxies on separate pinned cores), Node 24.22, Bun 1.4.3, Deno 2.9.7. Each cell ran 5 times in a fresh process in a shuffled order; figures are medians. quarry decodes like `pg` here (int8 and numeric as strings, timestamptz as `Date`), and all 608 result-equality checks across clients passed.

**Single queries, Node 24 (median latency)**

| Scenario                     |      quarry |      pg | pg (named) | pg-native | postgres.js |
| ---------------------------- | ----------: | ------: | ---------: | --------: | ----------: |
| `select 1`                   | **21.4 µs** | 26.2 µs |    26.5 µs |   31.3 µs |     28.9 µs |
| Point lookup by primary key  | **26.4 µs** | 46.4 µs |    34.6 µs |   50.0 µs |     32.9 µs |
| Range scan, 100 rows         | **87.9 µs** |  186 µs |     183 µs |    196 µs |      156 µs |
| Fetch 1,000 rows (6 columns) |  **313 µs** | 1.34 ms |    1.27 ms |   1.64 ms |      924 µs |
| Insert one row               | **26.3 µs** | 38.9 µs |    30.4 µs |   44.3 µs |     33.2 µs |
| `begin; insert; commit`      | **50.5 µs** | 81.1 µs |    72.5 µs |   99.8 µs |     87.5 µs |
| A failing query              | **33.9 µs** | 2.24 ms |    2.40 ms |   4.83 ms |     53.2 µs |

**Large results, Node 24 (time per fetch)**

| Scenario                                       |      quarry |       pg | pg-native | postgres.js |
| ---------------------------------------------- | ----------: | -------: | --------: | ----------: |
| Fetch 100,000 rows                             | **27.8 ms** |   120 ms |    146 ms |     91.9 ms |
| Fetch 1,000,000 rows                           |  **389 ms** | 1,242 ms |  1,482 ms |    1,044 ms |
| Stream 1,000,000 rows (cursor)                 |  **304 ms** | 1,267 ms |       n/a |    1,053 ms |
| Wide rows: 1,000 × 100 columns                 | **3.48 ms** | 14.37 ms |  21.27 ms |    14.11 ms |
| Arrays: 1,000 rows of `int4[100]` + `text[20]` | **3.23 ms** | 22.10 ms |  26.07 ms |     8.39 ms |
| 10 × 1 MB `bytea`                              | **3.45 ms** | 16.96 ms |  31.64 ms |    16.50 ms |

**Concurrency, Node 24 (point lookups/s)**

| Pool / callers |      quarry | quarry, `pipeline: false` |     pg | postgres.js |
| -------------- | ----------: | ------------------------: | -----: | ----------: |
| 1 / 1,000      | **116,338** |                    35,663 | 21,154 |     115,807 |
| 10 / 100       | **384,321** |                   101,850 | 61,156 |      42,676 |
| 10 / 500       | **495,571** |                    94,924 | 64,905 |     120,719 |
| 10 / 1,000     | **462,016** |                    95,496 | 64,827 |     143,063 |
| 50 / 1,000     | **417,023** |                   100,313 | 62,813 |      42,976 |

**Network latency, Node 24 (simulated round-trip time)**

| Scenario                                         | RTT   |       quarry |       pg | postgres.js |
| ------------------------------------------------ | ----- | -----------: | -------: | ----------: |
| `begin; insert; commit` (latency)                | 5 ms  | **11.78 ms** | 17.51 ms |    17.63 ms |
|                                                  | 20 ms | **41.67 ms** | 62.55 ms |    62.64 ms |
| Point lookups, 50 callers, pool 10 (ops/s)       | 5 ms  |    **8,333** |    1,651 |       7,022 |
|                                                  | 20 ms |    **2,359** |      475 |       2,005 |
| Point lookups, 500 callers, 1 connection (ops/s) | 5 ms  |   **88,450** |      169 |       7,941 |
|                                                  | 20 ms |   **23,503** |     47.8 |       2,340 |

A transaction takes two round trips (`BEGIN` travels with the first statement), and `db.batch` with `{ transaction: true }` takes one: three statements in a transaction at 5 ms RTT run at 165 ops/s with `db.batch`, against 56 with `Promise.all` and 42 one after another.

**Bun 1.4, against Bun.sql**

| Scenario                        |      quarry | Bun.sql | pg (named) |
| ------------------------------- | ----------: | ------: | ---------: |
| Point lookup (median latency)   | **24.2 µs** | 28.3 µs |    28.9 µs |
| Fetch 1,000,000 rows            |  **240 ms** |  344 ms |     893 ms |
| 50 concurrent inserts (ops/s)   | **261,286** | 148,955 |     98,692 |
| `begin; insert; commit` (ops/s) |  **20,616** |  10,909 |     15,240 |

**Through PgBouncer 1.26, transaction mode, Node 24 (ops/s)**

| Scenario                  |      quarry |     pg | pg (named) | postgres.js |
| ------------------------- | ----------: | -----: | ---------: | ----------: |
| Point lookups, 50 callers | **110,867** | 69,340 |     65,898 |      39,809 |
| Fetch 1,000 rows          |   **2,678** |    725 |        737 |         871 |
| `begin; insert; commit`   |   **9,396** |  6,698 |      7,055 |       6,136 |

**Connecting, Node 24 (connect + `select 1` + close)**

| Authentication           |      quarry |      pg | postgres.js |
| ------------------------ | ----------: | ------: | ----------: |
| trust, no TLS            | **2.29 ms** | 3.94 ms |     6.70 ms |
| SCRAM, no TLS            | **2.55 ms** | 5.29 ms |     7.77 ms |
| SCRAM, TLS `verify-full` | **5.19 ms** | 6.49 ms |     53.3 ms |

`pnpm bench:driver` runs a quick comparison against `pg` and postgres.js. The full suite behind these numbers (`bench/driver/suite`: setup, orchestration, analysis and charts) is in [#6](https://github.com/shlokdesai33/quarry/pull/6).

## Development

```sh
pnpm test # unit, type and integration tests
pnpm typecheck
pnpm lint
pnpm format
```

## License

[MIT](./LICENSE)
