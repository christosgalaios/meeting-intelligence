import type { Pool } from '../db/pool.js';
import { QUERY_PREFIX, type Embedder } from '../embed/embedder.js';
import type { RankedChunk, SourceTurn } from '../types.js';

interface TurnRow {
  id: string;
  meeting_id: string;
  n: number;
  speaker: string;
  start_seconds: number;
  timestamp_label: string;
  text: string;
}

/**
 * The distinct turns inside the ranked chunks, each carrying the best rrfScore of any chunk that
 * contains it. Ordered by that score (best first), then meeting, then turn number.
 */
export async function expandToTurns(pool: Pool, chunks: RankedChunk[], opts: { neighbours?: number } = {}): Promise<SourceTurn[]> {
  if (chunks.length === 0) return [];
  const nb = opts.neighbours ?? 0;
  const { rows } = await pool.query<TurnRow>(
    `SELECT t.id, t.meeting_id, t.n, t.speaker, t.start_seconds, t.timestamp_label, t.text
       FROM turns t
       JOIN unnest($1::uuid[], $2::int[], $3::int[]) AS r(meeting_id, first_n, last_n)
         ON t.meeting_id = r.meeting_id AND t.n BETWEEN r.first_n AND r.last_n`,
    [chunks.map((c) => c.meetingId), chunks.map((c) => c.firstTurnN - nb), chunks.map((c) => c.lastTurnN + nb)],
  );
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // A neighbour (a turn just outside a chunk) takes that chunk's score but sorts after turns inside a chunk.
  const best = new Map<string, { score: number; inside: boolean }>();
  for (const c of chunks) {
    for (const r of rows) {
      if (r.meeting_id !== c.meetingId || r.n < c.firstTurnN - nb || r.n > c.lastTurnN + nb) continue;
      const inside = r.n >= c.firstTurnN && r.n <= c.lastTurnN;
      const prev = best.get(r.id);
      if (!prev || (inside && !prev.inside) || (inside === prev.inside && c.rrfScore > prev.score)) {
        best.set(r.id, { score: c.rrfScore, inside });
      }
    }
  }

  return [...best]
    .map(([id, { score, inside }]) => ({ id, score, inside }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.inside) - Number(a.inside) ||
        (rowById.get(a.id)!.meeting_id < rowById.get(b.id)!.meeting_id ? -1 : rowById.get(a.id)!.meeting_id > rowById.get(b.id)!.meeting_id ? 1 : 0) ||
        rowById.get(a.id)!.n - rowById.get(b.id)!.n,
    )
    .map(({ id, score }): SourceTurn => {
      const r = rowById.get(id)!;
      return {
        id: r.id,
        meetingId: r.meeting_id,
        n: r.n,
        speaker: r.speaker,
        startSeconds: r.start_seconds,
        timestampLabel: r.timestamp_label,
        text: r.text,
        score,
      };
    });
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
const norm = (a: number[]) => Math.sqrt(dot(a, a)) || 1;

/**
 * Replaces each turn's inherited chunk score with its own: the cosine similarity between the turn text and the
 * question, from the same embedder. Overlapping chunks give every turn in them the same RRF score, which made the
 * results indistinguishable. Best first; ties by meeting then turn number. Chunk-level RRF scores stay on the chunks.
 */
export async function rescoreTurns(embedder: Embedder, question: string, turns: SourceTurn[]): Promise<SourceTurn[]> {
  if (turns.length === 0) return turns;
  const vectors = await embedder.embed([QUERY_PREFIX + question, ...turns.map((t) => t.text)]);
  const q = vectors[0];
  if (!q || vectors.length !== turns.length + 1) throw new Error('embedder returned the wrong number of vectors');
  const qn = norm(q);
  return turns
    .map((t, i) => ({ ...t, score: dot(q, vectors[i + 1]!) / (qn * norm(vectors[i + 1]!)) }))
    .sort((a, b) => b.score - a.score || (a.meetingId < b.meetingId ? -1 : a.meetingId > b.meetingId ? 1 : 0) || a.n - b.n);
}
