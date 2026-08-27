import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database, resolveConnectionString } from './client';
import { insertInto, selectFrom } from './query-builder';
import { defineTable } from './table';

const connectionString = resolveConnectionString();

const people = defineTable('quarry_test_people', {
  id: 'integer',
  name: 'text',
  age: 'integer',
  is_active: 'boolean',
});

interface Person {
  id: number;
  name: string;
  age: number;
  is_active: boolean;
}

describe('Database (integration)', () => {
  const db = new Database({ connectionString });

  beforeAll(async () => {
    await db.execute('DROP TABLE IF EXISTS quarry_test_people');
    await db.execute(
      `CREATE TABLE quarry_test_people (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        age INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true
      )`
    );
  });

  afterAll(async () => {
    await db.execute('DROP TABLE IF EXISTS quarry_test_people');
    await db.close();
  });

  test('inserts and reads back typed rows', async () => {
    const inserted = await db.run<{ id: number }>(
      insertInto(people)
        .values(
          { name: 'Ada', age: 36, is_active: true },
          { name: 'Alan', age: 41, is_active: false },
          { name: 'Grace', age: 29, is_active: true }
        )
        .returning('id')
        .compile()
    );
    expect(inserted).toHaveLength(3);

    const active = await db.run<Person>(
      selectFrom(people)
        .select('name', 'age')
        .where('is_active', '=', true)
        .orderBy('age', 'asc')
        .compile()
    );
    expect(active.map((row) => row.name)).toEqual(['Grace', 'Ada']);
  });
});
