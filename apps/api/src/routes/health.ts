import type { FastifyInstance } from 'fastify';
import { VERSION } from '../config.js';
import { EMBEDDING_MODEL } from '../embed/embedder.js';
import { VOICE_MODELS_LABEL } from '../voice/models.js';
import type { Health } from '../types.js';

export function registerHealthRoutes(app: FastifyInstance): void {
  // The compose healthcheck calls this every 10 s, so it logs at warn: probes would otherwise be most of the log.
  // 503 when degraded, so a probe that only checks the status code sees a database that is down or a model still loading.
  app.get('/api/health', { logLevel: 'warn' }, async (_req, reply): Promise<Health> => {
    const { pool, embedder, llm } = app.deps;
    const db = await pool.query('SELECT 1').then(() => true, () => false);
    const ready = embedder.isReady();
    const status = db && ready ? 'ok' : 'degraded';
    if (status === 'degraded') void reply.code(503);
    return {
      status,
      mode: llm.enabled ? 'full' : 'retrieval-only',
      db,
      embeddings: { model: EMBEDDING_MODEL, ready },
      models: { answer: llm.answerModel, extraction: llm.extractionModel },
      voice: { available: app.transcriptionJobs.available, models: app.transcriptionJobs.available ? VOICE_MODELS_LABEL : null },
      version: VERSION,
    };
  });
}
