import type { Pool } from '../db/pool.js';
import { QUERY_PREFIX, toVectorLiteral, type Embedder } from '../embed/embedder.js';
import type { RankedChunk } from '../types.js';
import { fuse } from './rrf.js';

export const CANDIDATES = 20;
export const DEFAULT_LIMIT = 8;

export interface SearchResult {
  chunks: RankedChunk[];
  embedMs: number;
  searchMs: number;
  candidatesVector: number;
  candidatesText: number;
}

interface ChunkRow {
  id: string;
  meeting_id: string;
  slug: string;
  first_turn_n: number;
  last_turn_n: number;
  start_seconds: number;
  end_seconds: number;
}

export async function hybridSearch(
  pool: Pool,
  embedder: Embedder,
  opts: { question: string; meetingIds?: string[] | null; limit?: number },
): Promise<SearchResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const meetingIds = opts.meetingIds && opts.meetingIds.length > 0 ? opts.meetingIds : null;

  const t0 = performance.now();
  const [queryVec] = await embedder.embed([QUERY_PREFIX + opts.question]);
  const embedMs = Math.round(performance.now() - t0);
  if (!queryVec) throw new Error('embedder returned no vector');

  const t1 = performance.now();
  const [vec, txt] = await Promise.all([
    pool.query<{ id: string; score: number }>(
      `SELECT id, 1 - (embedding <=> $1::vector) AS score
         FROM chunks WHERE ($2::uuid[] IS NULL OR meeting_id = ANY($2))
        ORDER BY embedding <=> $1::vector LIMIT ${CANDIDATES}`,
      [toVectorLiteral(queryVec), meetingIds],
    ),
    // An all-stop-word question yields an empty tsquery, which matches nothing rather than erroring.
    pool.query<{ id: string; score: number }>(
      `SELECT id, ts_rank_cd(tsv, q) AS score
         FROM chunks, websearch_to_tsquery('english', $1) q
        WHERE tsv @@ q AND ($2::uuid[] IS NULL OR meeting_id = ANY($2))
        ORDER BY score DESC LIMIT ${CANDIDATES}`,
      [opts.question, meetingIds],
    ),
  ]);

  const vecRank = new Map(vec.rows.map((r, i) => [r.id, { rank: i + 1, score: Number(r.score) }]));
  const txtRank = new Map(txt.rows.map((r, i) => [r.id, { rank: i + 1, score: Number(r.score) }]));
  const tieBreak = new Map([...vecRank].map(([id, v]) => [id, v.score]));
  const fused = fuse([vec.rows.map((r) => r.id), txt.rows.map((r) => r.id)], { limit, tieBreak });

  const rows = fused.length
    ? (
        await pool.query<ChunkRow>(
          `SELECT c.id, c.meeting_id, m.slug, c.first_turn_n, c.last_turn_n, c.start_seconds, c.end_seconds
             FROM chunks c JOIN meetings m ON m.id = c.meeting_id WHERE c.id = ANY($1::uuid[])`,
          [fused.map((f) => f.id)],
        )
      ).rows
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const searchMs = Math.round(performance.now() - t1);

  const chunks: RankedChunk[] = fused.flatMap((f) => {
    const r = byId.get(f.id);
    if (!r) return [];
    const v = vecRank.get(f.id);
    const t = txtRank.get(f.id);
    return [
      {
        chunkId: r.id,
        meetingId: r.meeting_id,
        meetingSlug: r.slug,
        firstTurnN: r.first_turn_n,
        lastTurnN: r.last_turn_n,
        startSeconds: r.start_seconds,
        endSeconds: r.end_seconds,
        rrfScore: f.score,
        vectorRank: v?.rank ?? null,
        vectorScore: v?.score ?? null,
        textRank: t?.rank ?? null,
        textScore: t?.score ?? null,
      },
    ];
  });

  return { chunks, embedMs, searchMs, candidatesVector: vec.rows.length, candidatesText: txt.rows.length };
}
