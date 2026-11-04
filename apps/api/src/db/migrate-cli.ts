import { loadConfig } from '../config.js';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const env = loadConfig();
const pool = createPool(env.DATABASE_URL);
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'applied: nothing (up to date)');
} finally {
  await pool.end();
}
