import pg from 'pg';
import type { CompiledQuery } from './types';

const { Pool } = pg;

export interface DatabaseConfig {
  readonly connectionString: string;
}

/**
 * Thin wrapper around a `pg` connection pool that executes the parameterized
 * queries produced by the query builders.
 */
export class Database {
  private readonly pool: pg.Pool;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({ connectionString: config.connectionString });
  }

  async run<Row = Record<string, unknown>>(query: CompiledQuery): Promise<Row[]> {
    const result = await this.pool.query({ text: query.text, values: [...query.values] });
    return result.rows as Row[];
  }

  async execute(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Connection string used for local development. Matches the database provisioned
 * by the Cloud Agent environment setup (see `.cursor/start.sh` and README.md).
 */
export const DEFAULT_CONNECTION_STRING = 'postgres://quarry:quarry@127.0.0.1:5432/quarry_dev';

export function resolveConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url !== undefined && url.length > 0) {
    return url;
  }
  return DEFAULT_CONNECTION_STRING;
}
