import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { getTrace } from '../trace/trace.js';

export function registerTraceRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>('/api/traces/:id', async (req) => {
    const trace = await getTrace(app.deps.pool, req.params.id);
    if (!trace) throw new AppError('NOT_FOUND', 'Trace not found');
    return trace;
  });
}
