import { describe, expect, test } from 'bun:test';
import { insertInto, selectFrom } from './query-builder';
import { defineTable } from './table';

const users = defineTable('users', {
  id: 'integer',
  email: 'text',
  name: 'text',
  is_active: 'boolean',
  created_at: 'timestamptz',
});

describe('selectFrom', () => {
  test('selects all columns by default', () => {
    const query = selectFrom(users).compile();
    expect(query.text).toBe('SELECT * FROM "users"');
    expect(query.values).toEqual([]);
  });

  test('projects a subset of columns', () => {
    const query = selectFrom(users).select('id', 'email').compile();
    expect(query.text).toBe('SELECT "id", "email" FROM "users"');
    expect(query.values).toEqual([]);
  });

  test('builds parameterized WHERE clauses', () => {
    const query = selectFrom(users)
      .select('id', 'name')
      .where('is_active', '=', true)
      .where('name', 'like', 'A%')
      .compile();
    expect(query.text).toBe(
      'SELECT "id", "name" FROM "users" WHERE "is_active" = $1 AND "name" LIKE $2'
    );
    expect(query.values).toEqual([true, 'A%']);
  });

  test('supports ordering, limit, and offset', () => {
    const query = selectFrom(users)
      .where('is_active', '=', true)
      .orderBy('created_at', 'desc')
      .limit(10)
      .offset(20)
      .compile();
    expect(query.text).toBe(
      'SELECT * FROM "users" WHERE "is_active" = $1 ORDER BY "created_at" DESC LIMIT $2 OFFSET $3'
    );
    expect(query.values).toEqual([true, 10, 20]);
  });

  test('is immutable across chained calls', () => {
    const base = selectFrom(users).select('id');
    const withFilter = base.where('id', '>', 5);
    expect(base.compile().text).toBe('SELECT "id" FROM "users"');
    expect(withFilter.compile().text).toBe('SELECT "id" FROM "users" WHERE "id" > $1');
  });
});

describe('insertInto', () => {
  test('builds a single-row insert with RETURNING', () => {
    const query = insertInto(users)
      .values({ email: 'ada@example.com', name: 'Ada', is_active: true })
      .returning('id')
      .compile();
    expect(query.text).toBe(
      'INSERT INTO "users" ("email", "name", "is_active") VALUES ($1, $2, $3) RETURNING "id"'
    );
    expect(query.values).toEqual(['ada@example.com', 'Ada', true]);
  });

  test('builds a multi-row insert', () => {
    const query = insertInto(users)
      .values({ email: 'a@example.com', name: 'A' }, { email: 'b@example.com', name: 'B' })
      .compile();
    expect(query.text).toBe('INSERT INTO "users" ("email", "name") VALUES ($1, $2), ($3, $4)');
    expect(query.values).toEqual(['a@example.com', 'A', 'b@example.com', 'B']);
  });

  test('throws when compiling without rows', () => {
    expect(() => insertInto(users).compile()).toThrow('Cannot compile an INSERT with no rows');
  });
});
