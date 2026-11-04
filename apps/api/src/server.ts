import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { DEFAULT_RETRIEVAL_MIN_SCORE } from './config.js';
import type { Pool } from './db/pool.js';
import type { Embedder } from './embed/embedder.js';
import { AppError, type ErrorCode } from './errors.js';
import type { LlmClient } from './llm/client.js';
import { registerAskRoutes } from './routes/ask.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMeetingRoutes } from './routes/meetings.js';
import { registerTraceRoutes } from './routes/traces.js';
import { ExtractionQueue } from './services/queue.js';
import type { ApiError } from './types.js';

export interface ServerDeps {
  pool: Pool;
  embedder: Embedder;
  llm: LlmClient;
  retrievalMinScore?: number;
  logLevel?: string;
  pretty?: boolean;
  /** Tests capture log output here. */
  logStream?: { write(line: string): void };
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Required<Pick<ServerDeps, 'retrievalMinScore'>> & Pick<ServerDeps, 'pool' | 'embedder' | 'llm'>;
    extractionQueue: ExtractionQueue;
  }
}

export const VERSION = '0.1.0';

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.logLevel ?? 'info',
      // Never logged: the API key, transcript text, chunk content, full answers.
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
      ...(deps.pretty ? { transport: { target: 'pino-pretty' } } : {}),
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    // The 2 MB transcript limit is enforced on text in the route; JSON escaping needs headroom.
    bodyLimit: 8 * 1024 * 1024,
  });

  app.decorate('deps', {
    pool: deps.pool,
    embedder: deps.embedder,
    llm: deps.llm,
    retrievalMinScore: deps.retrievalMinScore ?? DEFAULT_RETRIEVAL_MIN_SCORE,
  });
  app.decorate('extractionQueue', new ExtractionQueue());

  app.addHook('onRequest', (req, reply, done) => {
    void reply.header('x-request-id', req.id);
    // Every line carries reqId (Fastify adds it), route and method.
    req.log = req.log.child({ route: req.routeOptions.url ?? req.url, method: req.method });
    reply.log = req.log; // so Fastify's own 'request completed' line carries the same fields
    done();
  });

  const body = (code: ErrorCode, message: string, requestId: string): ApiError => ({ error: { code, message, requestId } });

  app.setNotFoundHandler((req, reply) => {
    void reply.code(404).send(body('NOT_FOUND', 'Not found', req.id));
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      void reply.code(err.status).send(body(err.code, err.message, req.id));
      return;
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413) {
      void reply.code(413).send(body('TOO_LARGE', 'Request body is too large', req.id));
      return;
    }
    // Malformed JSON, wrong content type and similar client mistakes.
    if (status !== undefined && status >= 400 && status < 500) {
      void reply.code(400).send(body('VALIDATION', err instanceof Error ? err.message : 'Invalid request', req.id));
      return;
    }
    req.log.error({ err }, 'unhandled');
    void reply.code(500).send(body('INTERNAL', 'Internal error', req.id));
  });

  registerHealthRoutes(app);
  registerMeetingRoutes(app);
  registerAskRoutes(app);
  registerTraceRoutes(app);

  return app;
}
