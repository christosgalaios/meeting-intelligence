import { randomUUID } from 'node:crypto';
import type { Pool } from '../db/pool.js';
import type { Citation, Mode, QueryTrace, RankedChunk } from '../types.js';

export interface TraceStart {
  requestId: string;
  question: string;
  meetingIds: string[] | null;
  mode: Mode;
  retrieval: RankedChunk[];
  embedMs: number;
  searchMs: number;
  totalMs: number;
}

export interface TraceFinish {
  refused?: boolean;
  refusalReason?: 'below_threshold' | 'model_declined' | null;
  answer?: string | null;
  citations?: Citation[] | null;
  droppedCitations?: string[];
  model?: string | null;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number } | null;
  llmMs?: number | null;
  totalMs: number;
  error?: string | null;
}

/** Inserted as soon as sources are known, so a crash later in the request still leaves a row. */
export async function insertTrace(pool: Pool, t: TraceStart): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO query_traces (id, request_id, question, meeting_ids, mode, retrieval, embed_ms, search_ms, total_ms)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [id, t.requestId, t.question, t.meetingIds, t.mode, JSON.stringify(t.retrieval), t.embedMs, t.searchMs, t.totalMs],
  );
  return id;
}

export async function finishTrace(pool: Pool, id: string, f: TraceFinish): Promise<void> {
  await pool.query(
    `UPDATE query_traces SET
       refused = $2, refusal_reason = $3, answer = $4, citations = $5::jsonb, dropped_citations = $6,
       model = $7, input_tokens = $8, output_tokens = $9, cache_read_tokens = $10,
       llm_ms = $11, total_ms = $12, error = $13
     WHERE id = $1`,
    [
      id,
      f.refused ?? false,
      f.refusalReason ?? null,
      f.answer ?? null,
      f.citations ? JSON.stringify(f.citations) : null,
      f.droppedCitations ?? [],
      f.model ?? null,
      f.usage?.inputTokens ?? null,
      f.usage?.outputTokens ?? null,
      f.usage?.cacheReadTokens ?? null,
      f.llmMs ?? null,
      f.totalMs,
      f.error ?? null,
    ],
  );
}

interface TraceRow {
  id: string;
  request_id: string;
  question: string;
  meeting_ids: string[] | null;
  mode: Mode;
  retrieval: RankedChunk[];
  refused: boolean;
  refusal_reason: 'below_threshold' | 'model_declined' | null;
  answer: string | null;
  citations: Citation[] | null;
  dropped_citations: string[] | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  embed_ms: number;
  search_ms: number;
  llm_ms: number | null;
  total_ms: number;
  error: string | null;
  created_at: Date;
}

export async function getTrace(pool: Pool, id: string): Promise<QueryTrace | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { rows } = await pool.query<TraceRow>('SELECT * FROM query_traces WHERE id = $1', [id]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    requestId: r.request_id,
    question: r.question,
    meetingIds: r.meeting_ids,
    mode: r.mode,
    retrieval: r.retrieval,
    refused: r.refused,
    refusalReason: r.refusal_reason,
    answer: r.answer,
    citations: r.citations,
    droppedCitations: r.dropped_citations ?? [],
    model: r.model,
    usage:
      r.input_tokens === null
        ? null
        : { inputTokens: r.input_tokens, outputTokens: r.output_tokens ?? 0, cacheReadTokens: r.cache_read_tokens ?? 0 },
    timings: { embedMs: r.embed_ms, searchMs: r.search_ms, llmMs: r.llm_ms, totalMs: r.total_ms },
    error: r.error,
    createdAt: r.created_at.toISOString(),
  };
}
