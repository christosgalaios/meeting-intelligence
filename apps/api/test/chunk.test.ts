import { describe, expect, it } from 'vitest';
import { MAX_TURNS, MAX_WORDS, chunkTurns } from '../src/transcript/chunk.js';

const turn = (n: number, text = `word${n} filler`) => ({ n, speaker: `S${n % 3}`, startSeconds: n * 10, text });
const turns = (count: number) => Array.from({ length: count }, (_, i) => turn(i + 1));

// Small deterministic PRNG so the property check is reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('chunkTurns', () => {
  it('gives 1 chunk for 1 turn', () => {
    expect(chunkTurns(turns(1))).toHaveLength(1);
  });

  it('gives 1 chunk of 6 for 6 short turns', () => {
    const c = chunkTurns(turns(MAX_TURNS));
    expect(c).toHaveLength(1);
    expect([c[0]!.firstTurnN, c[0]!.lastTurnN]).toEqual([1, 6]);
  });

  // Spec 3.2 stops once the last turn is in a chunk, so 10 turns are [1-6] and [5-10].
  // The spec's test list says "1, 5, 9", which would add a chunk wholly inside [5-10]; see report.
  it('slides with a 2-turn overlap and the last chunk includes turn 10', () => {
    const c = chunkTurns(turns(10));
    expect(c.map((x) => [x.firstTurnN, x.lastTurnN])).toEqual([[1, 6], [5, 10]]);
  });

  it('makes a single 400-word turn its own chunk', () => {
    const long = turn(2, Array.from({ length: 400 }, () => 'w').join(' '));
    const c = chunkTurns([turn(1), long, turn(3)]);
    const mid = c.find((x) => x.firstTurnN === 2 && x.lastTurnN === 2);
    expect(mid).toBeDefined();
  });

  it('splits before MAX_TURNS when turns are long', () => {
    const long = (n: number) => turn(n, Array.from({ length: 70 }, () => 'w').join(' '));
    const c = chunkTurns([1, 2, 3, 4, 5, 6].map(long));
    expect(c[0]!.lastTurnN - c[0]!.firstTurnN + 1).toBe(2);
    for (const x of c) {
      const words = x.content.split(/\s+/).length;
      if (x.lastTurnN > x.firstTurnN) expect(words).toBeLessThanOrEqual(MAX_WORDS);
    }
  });

  it('includes every turn in at least one chunk (50 random transcripts)', () => {
    const rand = mulberry32(42);
    for (let run = 0; run < 50; run++) {
      const count = 1 + Math.floor(rand() * 40);
      const ts = Array.from({ length: count }, (_, i) =>
        turn(i + 1, Array.from({ length: 1 + Math.floor(rand() * 120) }, () => 'w').join(' ')),
      );
      const seen = new Set<number>();
      let prevFirst = 0;
      for (const c of chunkTurns(ts)) {
        expect(c.firstTurnN).toBeGreaterThan(prevFirst); // always progresses
        prevFirst = c.firstTurnN;
        for (let n = c.firstTurnN; n <= c.lastTurnN; n++) seen.add(n);
      }
      expect(seen.size).toBe(count);
    }
  });

  it('keeps timestamps and ids out of chunk content', () => {
    const c = chunkTurns(turns(3));
    expect(c[0]!.content).toBe('S1: word1 filler\nS2: word2 filler\nS0: word3 filler');
    expect(c[0]!.content).not.toMatch(/\d{2}:\d{2}|#\d/);
  });
});
