import type { Pool } from '../db/pool.js';
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
