import { MAX_WORDS_PER_TURN } from '../transcript/validate.js';

export interface RawSegment { start: number; end: number; speaker: number }
export interface Segment extends RawSegment { text: string }

export const MERGE_GAP_SECONDS = 1.0;
// Whisper's window is 30 s; 28 leaves room for segment-boundary rounding.
export const MAX_SEGMENT_SECONDS = 28;
// Documented guarantee: 28 s of speech is about 80 words, far under the validator's per-turn cap.
export const MAX_TURN_WORDS = MAX_WORDS_PER_TURN;

/** The diarizer's ids skip numbers (0, 1, 3). Renumber 1..N in order of first appearance. */
export function relabelSpeakers<T extends { speaker: number }>(segs: T[]): T[] {
  const ids = new Map<number, number>();
  return segs.map((s) => {
    if (!ids.has(s.speaker)) ids.set(s.speaker, ids.size + 1);
    return { ...s, speaker: ids.get(s.speaker)! };
  });
}

/** Joins same-speaker neighbours separated by at most MERGE_GAP_SECONDS, so Whisper sees whole sentences. */
export function mergeAdjacent(segs: RawSegment[]): RawSegment[] {
  const out: RawSegment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end <= MERGE_GAP_SECONDS) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Cuts any segment longer than `max` into equal pieces, none longer than `max`. */
export function splitLong(segs: RawSegment[], max = MAX_SEGMENT_SECONDS): RawSegment[] {
  const out: RawSegment[] = [];
  for (const s of segs) {
    const len = s.end - s.start;
    if (len <= max) {
      out.push({ ...s });
      continue;
    }
    const pieces = Math.ceil(len / max);
    const step = len / pieces;
    for (let i = 0; i < pieces; i++) {
      out.push({ speaker: s.speaker, start: s.start + i * step, end: i === pieces - 1 ? s.end : s.start + (i + 1) * step });
    }
  }
  return out;
}

/**
 * relabel -> merge -> split. If merging would leave one segment, keep the unmerged ones: the transcript validator
 * needs at least two turns, and a single-speaker recording is otherwise one long monologue.
 */
export function prepareForAsr(raw: RawSegment[]): RawSegment[] {
  const sorted = [...raw].sort((a, b) => a.start - b.start);
  const relabelled = relabelSpeakers(sorted);
  const merged = mergeAdjacent(relabelled);
  const chosen = merged.length === 1 && relabelled.length > 1 ? relabelled : merged;
  return splitLong(chosen);
}

/** Drops segments Whisper heard nothing in, then renumbers so a speaker who only produced silence leaves no gap. */
export function finalise(segs: Segment[]): Segment[] {
  return relabelSpeakers(segs.filter((s) => s.text.trim() !== '').map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim() })));
}

const pad = (n: number) => String(n).padStart(2, '0');

export function timestampLabel(seconds: number): string {
  const t = Math.floor(seconds);
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

export function speakerNames(segs: Segment[]): string[] {
  const nums = [...new Set(segs.map((s) => s.speaker))].sort((a, b) => a - b);
  return nums.map((n) => `Speaker ${n}`);
}

export function formatTranscript(segs: Segment[]): string {
  return segs.map((s) => `[${timestampLabel(s.start)}] Speaker ${s.speaker}: ${s.text}`).join('\n');
}
