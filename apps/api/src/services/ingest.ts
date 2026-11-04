import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from '../db/pool.js';
import { toVectorLiteral, type Embedder } from '../embed/embedder.js';
import { AppError } from '../errors.js';
import type { LlmClient } from '../llm/client.js';
import { validateExtraction } from '../llm/extractionSchema.js';
import { chunkTurns } from '../transcript/chunk.js';
import { parseTranscript } from '../transcript/parse.js';
import { fileSlug } from '../transcript/slug.js';
import { filenameMeta } from '../transcript/title.js';
import type { MeetingDetail } from '../types.js';
import { getMeetingDetail } from './meetings.js';
import type { ExtractionQueue } from './queue.js';

export interface IngestDeps {
  pool: Pool;
  embedder: Embedder;
  llm: LlmClient;
  queue: ExtractionQueue;
  log: FastifyBaseLogger;
}

export const MAX_EXTRACTION_WORDS = 60_000;

/** x, x-2, x-3 ... : the first slug not already taken. */
async function pickSlug(pool: Pool, base: string): Promise<string> {
  const { rows } = await pool.query<{ slug: string }>(
    'SELECT slug FROM meetings WHERE slug = $1 OR slug LIKE $2',
    [base, `${base}-%`],
  );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

const isUniqueViolation = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';

export async function ingestTranscript(
  deps: IngestDeps,
  input: {
    filename: string;
    title?: string | undefined;
    text: string;
    /** Seeding: the transcript is stored as `skipped` and never calls the model. An upload leaves this off. */
    skipExtraction?: boolean;
  },
): Promise<MeetingDetail> {
  const { pool, embedder, llm, queue, log } = deps;
  const t0 = performance.now();

  for (let attempt = 0; ; attempt++) {
    const slug = await pickSlug(pool, fileSlug(input.filename));
    const { turns, warnings } = parseTranscript(input.text, slug);
    if (warnings.length) log.warn({ slug, warnings }, 'ingest.warnings');
    const chunks = chunkTurns(turns);

    const e0 = performance.now();
    const vectors = await embedder.embed(chunks.map((c) => c.content));
    const embedMs = Math.round(performance.now() - e0);
    if (vectors.length !== chunks.length) throw new Error('embedder returned the wrong number of vectors');

    const meta = filenameMeta(input.filename);
    const title = input.title ?? meta.title;
    const speakers = [...new Set(turns.map((t) => t.speaker))];
    const extract = llm.enabled && !input.skipExtraction;
    const status = extract ? 'pending' : 'skipped';

    const client = await pool.connect();
    let meetingId: string;
    try {
      await client.query('BEGIN');
      const m = await client.query<{ id: string }>(
        `INSERT INTO meetings (slug, title, source_filename, turn_count, duration_seconds, speakers, extraction_status, meeting_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [slug, title, input.filename, turns.length, turns[turns.length - 1]!.startSeconds, speakers, status, meta.date],
      );
      meetingId = m.rows[0]!.id;
      await client.query(
        `INSERT INTO turns (id, meeting_id, n, speaker, start_seconds, timestamp_label, text)
         SELECT x.id, $1::uuid, x.n, x.speaker, x.start_seconds, x.timestamp_label, x.text
           FROM jsonb_to_recordset($2::jsonb)
             AS x(id text, n int, speaker text, start_seconds int, timestamp_label text, text text)`,
        [
          meetingId,
          JSON.stringify(
            turns.map((t) => ({
              id: t.id, n: t.n, speaker: t.speaker, start_seconds: t.startSeconds, timestamp_label: t.timestampLabel, text: t.text,
            })),
          ),
        ],
      );
      await client.query(
        `INSERT INTO chunks (meeting_id, first_turn_n, last_turn_n, start_seconds, end_seconds, speakers, content, embedding)
         SELECT $1::uuid, x.first_turn_n, x.last_turn_n, x.start_seconds, x.end_seconds,
                ARRAY(SELECT jsonb_array_elements_text(x.speakers)), x.content, x.embedding::vector
           FROM jsonb_to_recordset($2::jsonb)
             AS x(first_turn_n int, last_turn_n int, start_seconds int, end_seconds int, speakers jsonb, content text, embedding text)`,
        [
          meetingId,
          JSON.stringify(
            chunks.map((c, i) => ({
              first_turn_n: c.firstTurnN,
              last_turn_n: c.lastTurnN,
              start_seconds: c.startSeconds,
              end_seconds: c.endSeconds,
              speakers: c.speakers,
              content: c.content,
              embedding: toVectorLiteral(vectors[i]!),
            })),
          ),
        ],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Another upload took the slug between pickSlug and the insert: pick again.
      if (isUniqueViolation(err) && attempt < 3) continue;
      throw err;
    } finally {
      client.release();
    }

    log.info(
      { meetingId, slug, turns: turns.length, chunks: chunks.length, embedMs, totalMs: Math.round(performance.now() - t0) },
      'ingest.done',
    );

    const detail = await getMeetingDetail(pool, meetingId);
    if (!detail) throw new AppError('INTERNAL', 'meeting vanished after insert');
    // Queued after the detail is read so the upload response always reports `pending`.
    if (extract) queue.add(() => runExtraction(deps, meetingId));
    return detail;
  }
}

/** At boot: an extraction that was pending when the process died will never finish. */
export async function failInterruptedExtractions(pool: Pool): Promise<number> {
  const r = await pool.query(
    "UPDATE meetings SET extraction_status = 'failed', extraction_error = 'interrupted' WHERE extraction_status = 'pending'",
  );
  return r.rowCount ?? 0;
}

/** Runs after the upload response. Failure is recorded on the meeting and never retried. */
export async function runExtraction(deps: Pick<IngestDeps, 'pool' | 'llm' | 'log'>, meetingId: string): Promise<void> {
  const { pool, llm, log } = deps;
  const t0 = performance.now();
  const fail = async (message: string) => {
    await pool.query("UPDATE meetings SET extraction_status = 'failed', extraction_error = $2 WHERE id = $1", [
      meetingId,
      message.slice(0, 500),
    ]);
    log.warn({ meetingId, model: llm.extractionModel, ms: Math.round(performance.now() - t0), error: message }, 'extract.failed');
  };

  try {
    const meeting = await getMeetingDetail(pool, meetingId);
    if (!meeting) return;
    const words = meeting.turns.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
    if (words > MAX_EXTRACTION_WORDS) {
      await fail('transcript too long for extraction');
      return;
    }

    const result = await llm.extract({ meeting: { slug: meeting.slug, title: meeting.title, turns: meeting.turns } });
    if (result.stopReason === 'refusal' || !result.output) {
      await fail(result.stopReason === 'refusal' ? 'The model declined this request.' : 'The model returned no usable extraction.');
      return;
    }

    const valid = validateExtraction(result.output, new Set(meeting.turns.map((t) => t.id)));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM decisions WHERE meeting_id = $1', [meetingId]);
      await client.query('DELETE FROM action_items WHERE meeting_id = $1', [meetingId]);
      for (const [i, d] of valid.decisions.entries()) {
        await client.query('INSERT INTO decisions (meeting_id, text, turn_id, position) VALUES ($1, $2, $3, $4)', [
          meetingId, d.text, d.turnId, i,
        ]);
      }
      for (const [i, a] of valid.actionItems.entries()) {
        await client.query(
          'INSERT INTO action_items (meeting_id, text, owner, due, turn_id, position) VALUES ($1, $2, $3, $4, $5, $6)',
          [meetingId, a.text, a.owner, a.due, a.turnId, i],
        );
      }
      await client.query("UPDATE meetings SET extraction_status = 'done', extraction_error = NULL WHERE id = $1", [meetingId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    log.info(
      {
        meetingId,
        model: llm.extractionModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        ms: Math.round(performance.now() - t0),
      },
      'extract.done',
    );
  } catch (err) {
    await fail(err instanceof Error ? err.message : 'extraction failed').catch((e) =>
      log.error({ meetingId, err: e instanceof Error ? e.message : String(e) }, 'extract.failed.record'),
    );
  }
}

/**
 * User-requested extraction for a meeting that has none (seeded without a key, or a failed run).
 * Marks it pending and queues the job; the caller polls the meeting like it does after an upload.
 */
export async function requestExtraction(deps: IngestDeps, idOrSlug: string): Promise<MeetingDetail> {
  const { pool, llm, queue } = deps;
  // Checked first: without a key there is nothing to run, whatever state the meeting is in.
  if (!llm.enabled) throw new AppError('CONFLICT', 'Extraction needs an Anthropic key set on the API.');
  const meeting = await getMeetingDetail(pool, idOrSlug);
  if (!meeting) throw new AppError('NOT_FOUND', 'Meeting not found');
  // `done` is refused too: re-running would spend money to replace a result the user already has.
  if (meeting.extractionStatus === 'pending') throw new AppError('CONFLICT', 'Extraction is already running for this meeting.');
  if (meeting.extractionStatus === 'done') throw new AppError('CONFLICT', 'This meeting has already been extracted.');

  // The status guard in the WHERE keeps two simultaneous clicks from queueing two paid calls.
  const claimed = await pool.query(
    "UPDATE meetings SET extraction_status = 'pending', extraction_error = NULL WHERE id = $1 AND extraction_status IN ('skipped', 'failed')",
    [meeting.id],
  );
  if (claimed.rowCount !== 1) throw new AppError('CONFLICT', 'Extraction is already running for this meeting.');
  queue.add(() => runExtraction(deps, meeting.id));
  const detail = await getMeetingDetail(pool, meeting.id);
  if (!detail) throw new AppError('INTERNAL', 'meeting vanished during extraction request');
  return detail;
}
