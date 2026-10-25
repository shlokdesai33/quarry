# The `quarry` command

The package declares one binary, `quarry` (`"bin": { "quarry": "./dist/cli.js" }` in [package.json](../../package.json); `dist/cli.js` is built from [main.ts](main.ts) by `pnpm build`), with one command:

```sh
quarry verify [--config <path>] [--format pretty|table|github|json] [--strict] [--schema <name>] [--ascii] [--color|--no-color]
```

It loads your `quarry.config.ts`, runs [`db.verify`](../verify/README.md) on the tables it exports, prints the report, and exits with a code CI can act on.

## Contents

- [The config file](#the-config-file)
- [Files](#files)
- [What happens when you run it](#what-happens-when-you-run-it)
- [Exit codes](#exit-codes)
- [Usage text](#usage-text)
- [Decisions](#decisions)

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
| `close?` | called when the command is done; defaults to `db.close()` when `db` has one                                                 |

`defineConfig` returns its argument: it exists only so the editor types the object. The config can also use named exports (`export const db = …; export const schema = …`) instead of a default export: `parseConfig` reads the default export when it is an object, and the module's own exports otherwise.

What `parseConfig` ([config.ts](config.ts)) answers for a config it can't use, printed as `<path>: <message>`:

| Problem                                    | Message                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| the module isn't an object                 | `the config module has no exports`                                 |
| `db` missing, or without a `verify` method | ``the config must export `db`, a quarry database (database(url))`` |
| `schema` missing or not an object          | ``the config must export `schema`, the tables to check``           |

## Files

| File                   | Role                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [main.ts](main.ts)     | The executable: finds the config, re-launches Node with TypeScript support if needed, runs `runCli`, exits.                       |
| [run.ts](run.ts)       | `runCli(argv, io)`: argument parsing, config loading, running verify, rendering; `findConfig`; the usage text.                    |
| [config.ts](config.ts) | `QuarryConfig`, `defineConfig`, `parseConfig` (validates a config module's exports), `schemaTables` (collects and orders tables). |

`runCli` takes an `Io` object (`stdout`, `stderr`, `cwd`, `env`, and an optional `load` to import the config) rather than using `process` directly, so [test/verify/cli.test.ts](../../test/verify/cli.test.ts) can run the whole command in memory.

## What happens when you run it

1. **Find the config** (`findConfig`): `--config <path>` (or `--config=<path>`), resolved against the working directory, else the first of `quarry.config.ts`, `.mts`, `.js`, `.mjs` there that exists. [main.ts](main.ts) does this once before anything else, to decide step 2; `runCli` does it again.
2. **TypeScript support** ([main.ts](main.ts)): Node strips TypeScript types by default on the Node versions quarry supports (`engines` requires `>=24.11`), so `process.features.typescript` is set and a `quarry.config.ts` is imported directly. Only if it isn't set, the config is `.ts`/`.mts`/`.cts` and `--experimental-strip-types` isn't already on does `main.ts` re-run itself with `--experimental-strip-types --no-warnings=ExperimentalWarning` (`spawnSync` of the same Node with the same arguments) and exit with the child's code.
3. **Parse arguments** with `node:util`'s `parseArgs` (`allowNegative`, so `--no-color` works). An unknown option prints the parser's message and the usage and exits 2. `-h`/`--help` prints the usage to stdout and exits 0. Anything other than `verify` with no extra positionals (`No command given`, `Unknown command: …`), or an unknown format (`Unknown format: …`), prints the usage and exits 2. A config path that doesn't exist (`No config at <path>`), or no config file in the directory (`No quarry.config.ts in <cwd>`), also exits 2.
4. **Load the config**: `import(pathToFileURL(path).href)` (or `io.load`). An error thrown while importing it (a syntax error, a failing top-level `await`) isn't caught by `runCli`: it reaches `main.ts`, which prints its stack trace and exits 2. `parseConfig` then checks the exports ([above](#the-config-file)); a problem prints one line and exits 2. It wraps `db.verify` and the close function with `Reflect.apply`, so methods keep their `this`.
5. **Collect the tables** (`schemaTables`): from an array, the tables in it; from an object, its table values, **sorted by where they were defined** (their call site's file, line and column). A module namespace lists exports alphabetically; sorting by source order makes the report follow your schema file. Tables are recognised structurally (`_quarry.source` and `schema.columns`), not with `instanceof`, so a config importing a second copy of quarry still works.
6. **Verify**: `config.db.verify(tables, { strict, schema })`. A failure here (can't connect, bad credentials) prints `quarry verify: ConnectionError: …` as one line, with "set QUARRY_DEBUG=1 for the stack trace", and exits 2.
7. **Render**: `formatVerifyReport` with the capabilities `detectTerminal(io.stdout, io.env)` finds ([verify/README.md](../verify/README.md#options-and-terminal-detection)), `cwd` set to `io.cwd`, overridden by `--color`/`--no-color` and `--ascii` (`unicode: false`); `root` is `GITHUB_WORKSPACE` when set, else the working directory, so GitHub annotation paths are relative to the checkout. The result is written to stdout; the exit code is 0 if `report.ok`, else 1.
8. **Close** (`finally`): `config.close?.()`, awaited, so the pool ends even when verify failed. It only runs once the config has loaded.
9. **Exit** ([main.ts](main.ts)): `process.stdout.write('', () => process.exit(code))`, so the exit waits for stdout to flush. Exiting explicitly matters: a pool the config created but didn't close would keep the process alive forever. Anything `runCli` throws (the config import, `close`) is caught here: its stack is printed to stderr and the code is 2.

## Exit codes

| Code | Meaning                                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | the schema matches (warnings and notes allowed), or `--help`                                                                                                   |
| 1    | the report has errors                                                                                                                                          |
| 2    | the command, config or connection is wrong: an unknown option, command or format; no config file; a config that fails to import or to parse; `verify` throwing |

So a CI step `quarry verify --format github` fails the build on errors and shows each one as an annotation on the changed line, and a broken setup (code 2) can be told apart from schema drift (code 1).

## Usage text

`usage` in [run.ts](run.ts), printed by `--help` and after every usage error:

```
Usage: quarry verify [options]

Checks the tables in quarry.config.ts against the database.

Options:
  --config <path>    the config file (default: quarry.config.{ts,mts,js,mjs})
  --format <format>  pretty (default), table, github or json
  --strict           treat columns only the database has as errors
  --schema <name>    look tables up in this schema instead of search_path
  --ascii            draw frames with ASCII characters
  --color, --no-color
  -h, --help
```

## Decisions

Why the CLI works this way. Each links to its full entry (what it is, why, the alternatives, the cost, measured impact) in [DECISIONS.md](../DECISIONS.md):

- [The CLI: config as code, re-launched for TypeScript, distinct exit codes](../DECISIONS.md#the-cli-config-as-code-re-launched-for-typescript-distinct-exit-codes): one way to configure a connection, no TypeScript loader dependency, CI can tell drift from breakage, and the command is a testable function.
