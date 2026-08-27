import type { Table, TableSchema } from './types';

export function defineTable<Name extends string, S extends TableSchema>(
  name: Name,
  columns: S
): Table<Name, S> {
  return { name, columns };
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
