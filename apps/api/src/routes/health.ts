import type { FastifyInstance } from 'fastify';
import { EMBEDDING_MODEL } from '../embed/embedder.js';
import { VERSION } from '../server.js';
import { VOICE_MODELS_LABEL } from '../voice/models.js';
import type { Health } from '../types.js';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async (): Promise<Health> => {
    const { pool, embedder, llm } = app.deps;
    const db = await pool.query('SELECT 1').then(() => true, () => false);
    const ready = embedder.isReady();
    return {
      status: db && ready ? 'ok' : 'degraded',
      mode: llm.enabled ? 'full' : 'retrieval-only',
      db,
      embeddings: { model: EMBEDDING_MODEL, ready },
      models: { answer: llm.answerModel, extraction: llm.extractionModel },
      voice: { available: app.transcriptionJobs.available, models: app.transcriptionJobs.available ? VOICE_MODELS_LABEL : null },
      version: VERSION,
    };
  });
}
