export const RRF_K = 60;

export interface Fused {
  id: string;
  score: number;
}

/**
 * Reciprocal rank fusion. Each ranking is a list of ids, best first (rank is 1-based).
 * score(id) = sum over rankings containing id of 1 / (k + rank).
 * Ties break on `tieBreak` (higher first, e.g. vector score), then on id so output is deterministic.
 */
export function fuse(
  rankings: string[][],
  opts: { k?: number; limit?: number; tieBreak?: ReadonlyMap<string, number> } = {},
): Fused[] {
  const k = opts.k ?? RRF_K;
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  const fused = [...scores].map(([id, score]) => ({ id, score }));
  fused.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const tb = (opts.tieBreak?.get(b.id) ?? -Infinity) - (opts.tieBreak?.get(a.id) ?? -Infinity);
    if (tb !== 0 && !Number.isNaN(tb)) return tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return opts.limit === undefined ? fused : fused.slice(0, opts.limit);
}
