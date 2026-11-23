import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

export async function runMigrations() {
  await migrate(db, { migrationsFolder });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async () => {
      console.log('Database migrations applied successfully.');
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await pool.end();
      process.exit(1);
    });
}
