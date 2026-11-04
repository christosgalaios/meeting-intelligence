import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { seedTranscripts } from '../services/seed.js';

type SeedResult = { added: number; skipped: number };

export function registerSeedRoutes(app: FastifyInstance): void {
  // Two clicks at once share one run: ingest picks a fresh slug on a clash, so a race would add "x-2" duplicates.
  let running: Promise<SeedResult> | null = null;

  // Loads the bundled sample transcripts. Never calls the model: seeded meetings are stored as `skipped`. Idempotent.
  app.post('/api/seed', async (req) => {
    const { pool, embedder, llm } = app.deps;
    if (!embedder.isReady()) throw new AppError('EMBEDDINGS_NOT_READY', 'The embedding model is still loading. Try again shortly.');
    running ??= seedTranscripts({ pool, embedder, llm, queue: app.extractionQueue, log: req.log }).finally(() => {
      running = null;
    });
    return running;
  });
}
