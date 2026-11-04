import type { Transcription } from '../api/types';

export interface DraftSegment { start: number; end: number; speaker: number; text: string }

/** The editable copy of a transcription. Nothing here reaches the library until the user imports it. */
export interface Draft {
  title: string;
  /** YYYY-MM-DD, or null for "no date in the filename". */
  date: string | null;
  /** Keyed by speaker number. Absent = the default "Speaker N"; '' = the user cleared the field. */
  speakerNames: Record<number, string>;
  segments: DraftSegment[];
}

// Same rule as the API (voice/segments.ts): the same speaker within a second of themselves is one turn.
const MERGE_GAP_SECONDS = 1.0;
const MAX_NAME = 80;

const pad = (n: number) => String(n).padStart(2, '0');

export function timestampLabel(seconds: number): string {
  const t = Math.floor(seconds);
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

export function newDraft(t: Pick<Transcription, 'segments'>, title: string, date: string | null): Draft {
  return { title, date, speakerNames: {}, segments: t.segments.map((s) => ({ ...s })) };
}

/** A re-run replaces the segments but keeps the title, date and any names whose speaker number still exists. */
export function withNewSegments(prev: Draft, t: Pick<Transcription, 'segments'>): Draft {
  const numbers = new Set(t.segments.map((s) => s.speaker));
  const kept = Object.fromEntries(Object.entries(prev.speakerNames).filter(([n]) => numbers.has(Number(n))));
  return { ...prev, speakerNames: kept, segments: t.segments.map((s) => ({ ...s })) };
}

export const speakerNumbers = (d: Draft): number[] => [...new Set(d.segments.map((s) => s.speaker))].sort((a, b) => a - b);

/** Names must fit the transcript line format: 1 to 80 characters and no colon. */
export function cleanName(name: string): string {
  return name.replace(/:/g, '-').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

export function speakerLabel(d: Draft, n: number): string {
  return cleanName(d.speakerNames[n] ?? '') || `Speaker ${n}`;
}

export const renameSpeaker = (d: Draft, n: number, name: string): Draft => ({ ...d, speakerNames: { ...d.speakerNames, [n]: name } });

/** True when a speaker's name field was cleared. The preview falls back to "Speaker N" but import waits for a real name. */
export const hasClearedName = (d: Draft): boolean => speakerNumbers(d).some((n) => d.speakerNames[n] !== undefined && cleanName(d.speakerNames[n]!) === '');

function mergeNeighbours(segs: DraftSegment[]): DraftSegment[] {
  const out: DraftSegment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end <= MERGE_GAP_SECONDS) {
      last.end = Math.max(last.end, s.end);
      last.text = `${last.text} ${s.text}`;
    } else out.push({ ...s });
  }
  return out;
}

/** Renumbers speakers 1..N by first appearance, moving each name with its speaker. */
function renumber(d: Draft): Draft {
  const ids = new Map<number, number>();
  for (const s of d.segments) if (!ids.has(s.speaker)) ids.set(s.speaker, ids.size + 1);
  const speakerNames: Record<number, string> = {};
  for (const [from, to] of ids) if (d.speakerNames[from] !== undefined) speakerNames[to] = d.speakerNames[from]!;
  return { ...d, speakerNames, segments: d.segments.map((s) => ({ ...s, speaker: ids.get(s.speaker)! })) };
}

/** Merges speaker `from` into `into`, then joins turns that are now neighbours. Never collapses the draft to one turn. */
export function mergeSpeakers(d: Draft, from: number, into: number): Draft {
  if (from === into) return d;
  const moved = d.segments.map((s) => (s.speaker === from ? { ...s, speaker: into } : s));
  const joined = mergeNeighbours(moved);
  // One turn fails the API's two-turn minimum, so keep the turns apart when joining would leave only one.
  const segments = joined.length === 1 && moved.length > 1 ? moved : joined;
  const { [from]: _gone, ...names } = d.speakerNames;
  void _gone;
  return renumber({ ...d, speakerNames: names, segments });
}

export const turnCount = (d: Draft): number => d.segments.length;

/** Exactly the text posted to /api/meetings. */
export function renderTranscript(d: Draft): string {
  return d.segments.map((s) => `[${timestampLabel(s.start)}] ${speakerLabel(d, s.speaker)}: ${s.text}`).join('\n');
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

/** `YYYY-MM-DD-<title>.txt`, so the API reads the meeting date from the filename prefix. */
export function draftFilename(d: Draft): string {
  const base = slug(d.title) || 'meeting';
  return d.date ? `${d.date}-${base}.txt` : `${base}.txt`;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
