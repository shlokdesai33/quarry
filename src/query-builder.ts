import { quoteIdentifier } from './table';
import type { CompiledQuery, RowOf, Table, TableSchema, TsTypeOf } from './types';

export type Operator = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like';
export type Direction = 'asc' | 'desc';

interface WhereCondition {
  readonly column: string;
  readonly operator: Operator;
  readonly value: unknown;
}

interface OrderByClause {
  readonly column: string;
  readonly direction: Direction;
}

/**
 * Immutable builder for `SELECT` statements. Every chained method returns a new
 * builder so a partially-built query can be safely reused.
 */
export class SelectQueryBuilder<S extends TableSchema, Selected extends keyof S = keyof S> {
  private constructor(
    private readonly tableName: string,
    private readonly selected: readonly (keyof S)[] | null,
    private readonly conditions: readonly WhereCondition[],
    private readonly orderings: readonly OrderByClause[],
    private readonly limitValue: number | null,
    private readonly offsetValue: number | null
  ) {}

  static from<Name extends string, Sch extends TableSchema>(
    table: Table<Name, Sch>
  ): SelectQueryBuilder<Sch, keyof Sch> {
    return new SelectQueryBuilder<Sch, keyof Sch>(table.name, null, [], [], null, null);
  }

  select<K extends keyof S>(...columns: K[]): SelectQueryBuilder<S, K> {
    return new SelectQueryBuilder<S, K>(
      this.tableName,
      columns,
      this.conditions,
      this.orderings,
      this.limitValue,
      this.offsetValue
    );
  }

  where<K extends keyof S>(
    column: K,
    operator: Operator,
    value: TsTypeOf<S[K]>
  ): SelectQueryBuilder<S, Selected> {
    return new SelectQueryBuilder<S, Selected>(
      this.tableName,
      this.selected,
      [...this.conditions, { column: column as string, operator, value }],
      this.orderings,
      this.limitValue,
      this.offsetValue
    );
  }

  orderBy(column: keyof S, direction: Direction = 'asc'): SelectQueryBuilder<S, Selected> {
    return new SelectQueryBuilder<S, Selected>(
      this.tableName,
      this.selected,
      this.conditions,
      [...this.orderings, { column: column as string, direction }],
      this.limitValue,
      this.offsetValue
    );
  }

  limit(count: number): SelectQueryBuilder<S, Selected> {
    return new SelectQueryBuilder<S, Selected>(
      this.tableName,
      this.selected,
      this.conditions,
      this.orderings,
      count,
      this.offsetValue
    );
  }

  offset(count: number): SelectQueryBuilder<S, Selected> {
    return new SelectQueryBuilder<S, Selected>(
      this.tableName,
      this.selected,
      this.conditions,
      this.orderings,
      this.limitValue,
      count
    );
  }

  compile(): CompiledQuery {
    const values: unknown[] = [];

    const columnList =
      this.selected && this.selected.length > 0
        ? this.selected.map((column) => quoteIdentifier(column as string)).join(', ')
        : '*';

    const parts = [`SELECT ${columnList} FROM ${quoteIdentifier(this.tableName)}`];

    if (this.conditions.length > 0) {
      const clauses = this.conditions.map((condition) => {
        values.push(condition.value);
        return `${quoteIdentifier(condition.column)} ${condition.operator.toUpperCase()} $${values.length}`;
      });
      parts.push(`WHERE ${clauses.join(' AND ')}`);
    }

    if (this.orderings.length > 0) {
      const ordering = this.orderings
        .map((clause) => `${quoteIdentifier(clause.column)} ${clause.direction.toUpperCase()}`)
        .join(', ');
      parts.push(`ORDER BY ${ordering}`);
    }

    if (this.limitValue !== null) {
      values.push(this.limitValue);
      parts.push(`LIMIT $${values.length}`);
    }

    if (this.offsetValue !== null) {
      values.push(this.offsetValue);
      parts.push(`OFFSET $${values.length}`);
    }

    return { text: parts.join(' '), values };
  }
}

/**
 * Immutable builder for `INSERT` statements with an optional `RETURNING` clause.
 */
export class InsertQueryBuilder<S extends TableSchema, Returned extends keyof S = never> {
  private constructor(
    private readonly tableName: string,
    private readonly rows: readonly Partial<RowOf<S>>[],
    private readonly returned: readonly (keyof S)[]
  ) {}

  static into<Name extends string, Sch extends TableSchema>(
    table: Table<Name, Sch>
  ): InsertQueryBuilder<Sch> {
    return new InsertQueryBuilder<Sch>(table.name, [], []);
  }

  values(...rows: Partial<RowOf<S>>[]): InsertQueryBuilder<S, Returned> {
    return new InsertQueryBuilder<S, Returned>(
      this.tableName,
      [...this.rows, ...rows],
      this.returned
    );
  }

  returning<K extends keyof S>(...columns: K[]): InsertQueryBuilder<S, K> {
    return new InsertQueryBuilder<S, K>(this.tableName, this.rows, columns);
  }

  compile(): CompiledQuery {
    if (this.rows.length === 0) {
      throw new Error('Cannot compile an INSERT with no rows. Call values() first.');
    }

    const firstRow = this.rows[0];
    if (firstRow === undefined) {
      throw new Error('Cannot compile an INSERT with no rows. Call values() first.');
    }

    const columns = Object.keys(firstRow) as (keyof S)[];
    if (columns.length === 0) {
      throw new Error('Cannot compile an INSERT without any columns.');
    }

    const values: unknown[] = [];
    const rowPlaceholders = this.rows.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(row[column]);
        return `$${values.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const columnList = columns.map((column) => quoteIdentifier(column as string)).join(', ');
    const parts = [
      `INSERT INTO ${quoteIdentifier(this.tableName)} (${columnList})`,
      `VALUES ${rowPlaceholders.join(', ')}`,
    ];

    if (this.returned.length > 0) {
      const returningList = this.returned
        .map((column) => quoteIdentifier(column as string))
        .join(', ');
      parts.push(`RETURNING ${returningList}`);
    }

    return { text: parts.join(' '), values };
  }
}

export function selectFrom<Name extends string, S extends TableSchema>(
  table: Table<Name, S>
): SelectQueryBuilder<S, keyof S> {
  return SelectQueryBuilder.from(table);
}

export function insertInto<Name extends string, S extends TableSchema>(
  table: Table<Name, S>
): InsertQueryBuilder<S> {
  return InsertQueryBuilder.into(table);
}
