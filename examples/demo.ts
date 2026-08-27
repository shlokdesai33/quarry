import { Database, resolveConnectionString } from '../src/client';
import { insertInto, selectFrom } from '../src/query-builder';
import { defineTable } from '../src/table';

const users = defineTable('quarry_demo_users', {
  id: 'integer',
  email: 'text',
  name: 'text',
  age: 'integer',
  is_active: 'boolean',
});

async function main(): Promise<void> {
  const db = new Database({ connectionString: resolveConnectionString() });

  try {
    console.log('→ Preparing demo table...');
    await db.execute('DROP TABLE IF EXISTS quarry_demo_users');
    await db.execute(
      `CREATE TABLE quarry_demo_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        age INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true
      )`
    );

    const insertQuery = insertInto(users)
      .values(
        { email: 'ada@example.com', name: 'Ada Lovelace', age: 36, is_active: true },
        { email: 'alan@example.com', name: 'Alan Turing', age: 41, is_active: false },
        { email: 'grace@example.com', name: 'Grace Hopper', age: 29, is_active: true }
      )
      .returning('id', 'email');

    console.log('\n→ Compiled INSERT:');
    console.log('  ', insertQuery.compile().text);
    console.log('   values:', insertQuery.compile().values);

    const inserted = await db.run<{ id: number; email: string }>(insertQuery.compile());
    console.log('   inserted rows:', inserted);

    const selectQuery = selectFrom(users)
      .select('name', 'age', 'email')
      .where('is_active', '=', true)
      .where('age', '<', 40)
      .orderBy('age', 'asc')
      .limit(10);

    console.log('\n→ Compiled SELECT:');
    console.log('  ', selectQuery.compile().text);
    console.log('   values:', selectQuery.compile().values);

    const active = await db.run<{ name: string; age: number; email: string }>(
      selectQuery.compile()
    );

    console.log('\n→ Active users under 40:');
    for (const row of active) {
      console.log(`   - ${row.name} (${row.age}) <${row.email}>`);
    }

    if (active.length !== 2) {
      throw new Error(`Expected 2 rows, received ${active.length}`);
    }

    await db.execute('DROP TABLE IF EXISTS quarry_demo_users');
    console.log('\n✓ Demo completed successfully.');
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error('✗ Demo failed:', error);
  process.exit(1);
});
