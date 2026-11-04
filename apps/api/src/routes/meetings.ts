import type { FastifyInstance } from 'fastify';
import { AppError, validationError } from '../errors.js';
import { requireEmbeddings } from './guards.js';
import { ingestTranscript, requestExtraction } from '../services/ingest.js';
import { getMeetingDetail, listMeetings } from '../services/meetings.js';
import { UploadRequest } from '../types.js';

const MAX_TEXT_BYTES = 2_000_000;

export function registerMeetingRoutes(app: FastifyInstance): void {
  app.post('/api/meetings', async (req, reply) => {
    const raw = req.body as { text?: unknown } | null;
    // Checked before schema validation so an oversized file is a 413, not a generic 400.
    if (typeof raw?.text === 'string' && Buffer.byteLength(raw.text, 'utf8') > MAX_TEXT_BYTES) {
      throw new AppError('TOO_LARGE', 'Transcript is larger than 2 MB.');
    }
    const parsed = UploadRequest.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues);
    }
    const { pool, embedder, llm } = app.deps;
    requireEmbeddings(embedder);

    const detail = await ingestTranscript(
      { pool, embedder, llm, jobs: app.extractionJobs, log: req.log },
      { filename: parsed.data.filename, title: parsed.data.title, text: parsed.data.text },
    );
    return reply.code(201).send(detail);
  });

  // User-clicked from the summary card. 202 because the work finishes after the response; poll GET /api/meetings/:id.
  app.post<{ Params: { id: string } }>('/api/meetings/:id/extract', async (req, reply) => {
    const { pool, embedder, llm } = app.deps;
    const detail = await requestExtraction({ pool, embedder, llm, jobs: app.extractionJobs, log: req.log }, req.params.id);
    return reply.code(202).send(detail);
  });

  app.get('/api/meetings', async () => ({ meetings: await listMeetings(app.deps.pool) }));

  app.get<{ Params: { id: string } }>('/api/meetings/:id', async (req) => {
    const detail = await getMeetingDetail(app.deps.pool, req.params.id);
    if (!detail) throw new AppError('NOT_FOUND', 'Meeting not found');
    return detail;
  });
}
