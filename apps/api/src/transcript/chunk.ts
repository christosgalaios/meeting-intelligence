import type { ParsedTurn } from './parse.js';

export const MAX_TURNS = 6;
export const MAX_WORDS = 180;
export const OVERLAP_TURNS = 2;

export interface ChunkDraft {
  firstTurnN: number;
  lastTurnN: number;
  startSeconds: number;
  endSeconds: number; // start_seconds of the last turn in the chunk
  speakers: string[];
  content: string; // "Speaker: text" per turn; no timestamps or ids
}

type ChunkTurn = Pick<ParsedTurn, 'n' | 'speaker' | 'startSeconds' | 'text'>;

const render = (t: ChunkTurn) => `${t.speaker}: ${t.text}`;
const words = (t: ChunkTurn) => render(t).split(/\s+/).filter(Boolean).length;

export function chunkTurns(turns: ChunkTurn[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let start = 0;

  while (start < turns.length) {
    let end = start; // inclusive
    let total = words(turns[start]!);
    // Always keep at least one turn, even a monologue over MAX_WORDS.
    while (end + 1 < turns.length && end + 1 - start + 1 <= MAX_TURNS) {
      const next = words(turns[end + 1]!);
      if (total + next > MAX_WORDS) break;
      total += next;
      end++;
    }

    const win = turns.slice(start, end + 1);
    chunks.push({
      firstTurnN: win[0]!.n,
      lastTurnN: win[win.length - 1]!.n,
      startSeconds: win[0]!.startSeconds,
      endSeconds: win[win.length - 1]!.startSeconds,
      speakers: [...new Set(win.map((t) => t.speaker))],
      content: win.map(render).join('\n'),
    });

    if (end >= turns.length - 1) break;
    // Overlap, but always move forward.
    start = Math.max(end - OVERLAP_TURNS + 1, start + 1);
  }
  return chunks;
}
