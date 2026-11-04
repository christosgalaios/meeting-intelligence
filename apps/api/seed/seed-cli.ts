// `npm run seed`: loads every transcript in seed/transcripts that is not already present.
// With ANTHROPIC_API_KEY set this also runs one Haiku extraction per new transcript (cents, not free).
import pino from 'pino';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { BgeEmbedder } from '../src/embed/bge.js';
import { createLlmClient } from '../src/llm/client.js';
import { ExtractionQueue } from '../src/services/queue.js';
import { seedTranscripts } from '../src/services/seed.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const embedder = new BgeEmbedder();
const llm = createLlmClient(config.ANTHROPIC_API_KEY);
const queue = new ExtractionQueue();
const log = pino({ level: config.LOG_LEVEL });

try {
  await migrate(pool);
  await embedder.warm();
  const result = await seedTranscripts({ pool, embedder, llm, queue, log });
  await queue.idle();
  console.log(`seed: added ${result.added}, skipped ${result.skipped}`);
} finally {
  await pool.end();
}
