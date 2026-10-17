# The `quarry` command

The package installs one binary, `quarry` (`"bin": { "quarry": "./dist/cli.js" }` in [package.json](../../package.json)), with one command:

```sh
npx quarry verify [--config <path>] [--format pretty|table|github|json] [--strict] [--schema <name>] [--ascii] [--color|--no-color]
```

It loads your `quarry.config.ts`, runs [`db.verify`](../verify/README.md) on the tables it exports, prints the report, and exits with a code CI can act on.

## Contents

- [The config file](#the-config-file)
- [Files](#files)
- [What happens when you run it](#what-happens-when-you-run-it)
- [Exit codes](#exit-codes)
- [Why it is built this way](#why-it-is-built-this-way)

## The config file

```ts
// quarry.config.ts
import { database, defineConfig } from 'quarry';
import * as schema from './src/schema.ts';

export default defineConfig({ db: database(process.env.DATABASE_URL), schema });
```

`QuarryConfig` ([config.ts](config.ts)):

| Field    | Meaning                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `db`     | anything with a `verify` method: a quarry `Database`                                                                        |
| `schema` | the tables: an array, or an object such as a module namespace (`import * as schema`); values that aren't tables are ignored |
| `close?` | called when the command is done; defaults to `db.close()`                                                                   |

`defineConfig` returns its argument: it exists only so the editor types the object. The config can also use named exports (`export const db = …; export const schema = …`) instead of a default export.

## Files

| File                   | Role                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [main.ts](main.ts)     | The executable: finds the config, re-launches Node with TypeScript support if needed, runs `runCli`, exits.                       |
| [run.ts](run.ts)       | `runCli(argv, io)`: argument parsing, config loading, running verify, rendering; `findConfig`; the usage text.                    |
| [config.ts](config.ts) | `QuarryConfig`, `defineConfig`, `parseConfig` (validates a config module's exports), `schemaTables` (collects and orders tables). |

`runCli` takes an `Io` object (`stdout`, `stderr`, `cwd`, `env`, and an optional `load` to import the config) rather than using `process` directly, so [test/verify/cli.test.ts](../../test/verify/cli.test.ts) can run the whole command in memory.

## What happens when you run it

1. **Find the config** (`findConfig`): `--config <path>` (or `--config=<path>`), else the first of `quarry.config.ts`, `.mts`, `.js`, `.mjs` in the working directory.
2. **TypeScript support** ([main.ts](main.ts)): Node can run `.ts` files natively by stripping types (by default from Node 22.18 / 23.6). On an older Node, if the config is TypeScript and stripping isn't on, `main.ts` re-runs itself with `--experimental-strip-types` (`spawnSync` of the same Node with the same arguments) and exits with the child's code.
3. **Parse arguments** with `node:util`'s `parseArgs`. Anything other than `verify` with no extra positionals, or an unknown format, prints the usage and exits 2.
4. **Load the config**: `import(pathToFileURL(path))`. `parseConfig` checks the exports: a default export object, or the module itself; `db` must have a `verify` function and `schema` must be an object; otherwise a one-line explanation and exit 2. It wraps `db.verify` and the close function with `Reflect.apply`, so methods keep their `this`.
5. **Collect the tables** (`schemaTables`): from an array, the tables in it; from an object, its table values, **sorted by where they were defined** (their call site's file, line and column). A module namespace lists exports alphabetically; sorting by source order makes the report follow your schema file. Tables are recognised structurally (`_quarry.source` and `schema.columns`), not with `instanceof`, so a config importing a second copy of quarry still works.
6. **Verify**: `config.db.verify(tables, { strict, schema })`. A failure here (can't connect, bad credentials) prints `quarry verify: ConnectionError: …` as one line, with "set QUARRY_DEBUG=1 for the stack trace", and exits 2.
7. **Render**: `formatVerifyReport` with the detected terminal capabilities, overridden by `--color`/`--no-color` and `--ascii`; GitHub annotation paths are relative to `GITHUB_WORKSPACE` when set.
8. **Close** (`finally`): `config.close?.()`, so the pool ends even when verify failed.
9. **Exit** ([main.ts](main.ts)): after `stdout` has flushed, `process.exit(code)`. Exiting explicitly matters: a pool the config created but didn't close would keep the process alive forever.

## Exit codes

| Code | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| 0    | the schema matches (warnings and notes allowed), or `--help` |
| 1    | the report has errors                                        |
| 2    | the command, config or connection is wrong                   |

So a CI step `npx quarry verify --format github` fails the build on errors and shows each one as an annotation on the changed line.

## Why it is built this way

- **Config as code** (`quarry.config.ts` exporting a real `Database`): the CLI connects exactly as your application does, with no second way to configure a connection.
- **Dependency injection through `Io`**: the command is a function, testable without spawning processes.
- **Re-launching for TypeScript** instead of bundling a TypeScript loader: no dependency, and on current Node versions nothing happens at all.
- **Distinct exit codes** for "schema differs" and "couldn't check": CI can tell a drifted schema from a broken pipeline.
