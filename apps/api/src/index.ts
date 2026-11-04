import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { BgeEmbedder } from './embed/bge.js';
import { createLlmClient } from './llm/client.js';
import { voiceModelsPresent } from './voice/models.js';
import { WorkerRunner } from './voice/runner.js';
import { buildServer } from './server.js';
import { failInterruptedExtractions } from './services/ingest.js';
import { seedTranscripts } from './services/seed.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const embedder = new BgeEmbedder();
const llm = createLlmClient(config.ANTHROPIC_API_KEY);

// Voice is on only when the models are on disk; otherwise health says so and the web hides the button.
const voice = config.VOICE_MODELS_DIR && voiceModelsPresent(config.VOICE_MODELS_DIR)
  ? new WorkerRunner({ modelsDir: config.VOICE_MODELS_DIR, threads: config.VOICE_THREADS })
  : null;

const app = buildServer({
  pool,
  voice,
  voiceMaxSeconds: config.VOICE_MAX_SECONDS,
  voiceMaxQueue: config.VOICE_MAX_QUEUE,
  embedder,
  llm,
  retrievalMinScore: config.RETRIEVAL_MIN_SCORE,
  logLevel: config.LOG_LEVEL,
  pretty: process.env.NODE_ENV === 'development',
});

const shutdown = async () => {
  await app.close();
  await app.extractionJobs.idle();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

try {
  const applied = await migrate(pool);
  app.log.info({ applied }, 'boot.migrated');
  const interrupted = await failInterruptedExtractions(pool);
  if (interrupted > 0) app.log.warn({ interrupted }, 'boot.extractions_interrupted');
  // Listen first so /health answers (as degraded) while the model loads.
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ mode: llm.enabled ? 'full' : 'retrieval-only' }, 'boot.listening');
  app.log.info({ available: voice !== null }, 'boot.voice');
  await embedder.warm();
  app.log.info('boot.embeddings_ready');
  if (config.SEED_ON_START) {
    await seedTranscripts({ pool, embedder, llm, jobs: app.extractionJobs, log: app.log });
  }
} catch (err) {
  app.log.error({ err }, 'boot.failed');
  process.exit(1);
}
