import { describe, expect, it } from 'vitest';
import { fuse } from '../src/retrieval/rrf.js';

describe('fuse (RRF)', () => {
  it('ranks an item in both lists above an item in one list at the same rank', () => {
    const out = fuse([['a', 'b'], ['c', 'a']]);
    expect(out[0]!.id).toBe('a');
  });

  it('uses 1/(60+rank) with 1-based ranks', () => {
    const out = fuse([['a', 'b'], ['b']]);
    const score = Object.fromEntries(out.map((x) => [x.id, x.score]));
    expect(score.a).toBeCloseTo(1 / 61, 6);
    expect(score.b).toBeCloseTo(1 / 62 + 1 / 61, 6);
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('returns nothing for empty lists', () => {
    expect(fuse([])).toEqual([]);
    expect(fuse([[], []])).toEqual([]);
  });

  it('respects the limit', () => {
    expect(fuse([['a', 'b', 'c', 'd']], { limit: 2 }).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('breaks ties by the tie-break map, then by id, deterministically', () => {
    // a and b both rank 1 in separate lists: identical RRF scores.
    const tie = new Map([['a', 0.4], ['b', 0.9]]);
    expect(fuse([['a'], ['b']], { tieBreak: tie }).map((x) => x.id)).toEqual(['b', 'a']);
    expect(fuse([['b'], ['a']]).map((x) => x.id)).toEqual(['a', 'b']);
    expect(fuse([['a'], ['b']]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});
