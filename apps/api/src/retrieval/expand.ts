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
export async function expandToTurns(pool: Pool, chunks: RankedChunk[]): Promise<SourceTurn[]> {
  if (chunks.length === 0) return [];
  const { rows } = await pool.query<TurnRow>(
    `SELECT t.id, t.meeting_id, t.n, t.speaker, t.start_seconds, t.timestamp_label, t.text
       FROM turns t
       JOIN unnest($1::uuid[], $2::int[], $3::int[]) AS r(meeting_id, first_n, last_n)
         ON t.meeting_id = r.meeting_id AND t.n BETWEEN r.first_n AND r.last_n`,
    [chunks.map((c) => c.meetingId), chunks.map((c) => c.firstTurnN), chunks.map((c) => c.lastTurnN)],
  );
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const best = new Map<string, number>();
  for (const c of chunks) {
    for (const r of rows) {
      if (r.meeting_id !== c.meetingId || r.n < c.firstTurnN || r.n > c.lastTurnN) continue;
      best.set(r.id, Math.max(best.get(r.id) ?? -Infinity, c.rrfScore));
    }
  }

  return [...best]
    .map(([id, score]): SourceTurn => {
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
    })
    .sort((a, b) => b.score - a.score || (a.meetingId < b.meetingId ? -1 : a.meetingId > b.meetingId ? 1 : 0) || a.n - b.n);
}
