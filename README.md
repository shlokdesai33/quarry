# quarry

A type-safe SQL query builder for PostgreSQL.

`quarry` lets you describe your tables once and then build parameterized
`SELECT` and `INSERT` statements with full TypeScript inference — column names,
value types, and projected result shapes are all checked at compile time.

## Example

```ts
import { Database, resolveConnectionString } from './src/client';
import { insertInto, selectFrom } from './src/query-builder';
import { defineTable } from './src/table';

const users = defineTable('users', {
  id: 'integer',
  email: 'text',
  name: 'text',
  age: 'integer',
  is_active: 'boolean',
});

const query = selectFrom(users)
  .select('name', 'age')
  .where('is_active', '=', true) // value must be a boolean
  .orderBy('age', 'asc')
  .limit(10)
  .compile();

// query.text   -> SELECT "name", "age" FROM "users" WHERE "is_active" = $1 ORDER BY "age" ASC LIMIT $2
// query.values -> [true, 10]

const db = new Database({ connectionString: resolveConnectionString() });
const rows = await db.run<{ name: string; age: number }>(query);
await db.close();
```

## Development

This project uses [Bun](https://bun.sh) as its package manager and runtime,
TypeScript for types, [Biome](https://biomejs.dev) for linting/formatting, and a
local PostgreSQL instance for integration tests and the demo.

### Prerequisites

- Bun (`curl -fsSL https://bun.sh/install | bash`)
- A running PostgreSQL server with a `quarry_dev` database

The Cloud Agent environment is defined in `.cursor/environment.json`:

- `.cursor/install.sh` installs Bun and PostgreSQL, provisions the `quarry` role
  and `quarry_dev` database, and runs `bun install`.
- `.cursor/start.sh` brings the PostgreSQL cluster online on every boot.

By default the code connects to `postgres://quarry:quarry@127.0.0.1:5432/quarry_dev`;
override it with the `DATABASE_URL` environment variable.

To provision and start PostgreSQL manually (outside a Cloud Agent):

```bash
bash .cursor/install.sh   # one-time: install toolchain + create the dev database
bash .cursor/start.sh     # start PostgreSQL
```

### Commands

```bash
bun install       # install dependencies
bun run typecheck # type-check with tsc
bun run lint      # check formatting/lint with Biome
bun run lint:fix  # auto-fix formatting/lint
bun test          # run unit + integration tests
bun run build     # emit compiled output to dist/
bun start         # run the end-to-end demo against PostgreSQL
```
