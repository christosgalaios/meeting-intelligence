import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { prepareAsk } from '../services/ask.js';
import { AskRequest } from '../types.js';

export function registerAskRoutes(app: FastifyInstance): void {
  app.post('/api/ask', async (req, reply) => {
    const parsed = AskRequest.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    }
    const { pool, embedder, llm, retrievalMinScore } = app.deps;
    if (!embedder.isReady()) throw new AppError('EMBEDDINGS_NOT_READY', 'The embedding model is still loading. Try again shortly.');

    // Scope, embedding and retrieval errors are plain JSON responses because nothing has streamed yet.
    const prepared = await prepareAsk(
      { pool, embedder, llm, retrievalMinScore, log: req.log },
      { question: parsed.data.question, meetingIds: parsed.data.meetingIds, requestId: req.id },
    );

    // Taking over the socket skips Fastify's header handling, so copy x-request-id across.
    reply.hijack();
    const res = reply.raw;
    // A client that goes away before the answer is finished stops the upstream model stream too.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      res.writeHead(200, {
        ...reply.getHeaders(),
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
        connection: 'keep-alive',
      } as Record<string, string>);
      res.flushHeaders();

      await prepared.run((event) => {
        if (res.destroyed || res.writableEnded) return;
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }, controller.signal);
    } finally {
      if (!res.writableEnded) res.end();
    }
  });
}
