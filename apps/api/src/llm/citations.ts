import type { Citation, Turn } from '../types.js';

export const REFUSAL_TEXT = 'Not discussed in these meetings.';

/** Every [slug#n] in the text, deduplicated, in order of first appearance. */
export function parseCitations(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/\[([a-z0-9-]+#\d+)\]/g)) seen.add(m[1]!);
  return [...seen];
}

/**
 * A citation the server did not retrieve is never shown as one: it is dropped here and recorded
 * in the trace. The answer text itself is left untouched.
 */
export function validateCitations(
  cited: string[],
  allowed: Pick<Turn, 'id' | 'meetingId' | 'timestampLabel' | 'speaker'>[],
): { valid: Citation[]; dropped: string[] } {
  const byId = new Map(allowed.map((t) => [t.id, t]));
  const valid: Citation[] = [];
  const dropped: string[] = [];
  for (const id of cited) {
    const t = byId.get(id);
    if (t) valid.push({ turnId: t.id, meetingId: t.meetingId, timestampLabel: t.timestampLabel, speaker: t.speaker });
    else dropped.push(id);
  }
  return { valid, dropped };
}

/** The model signals "not in the excerpts" with the exact refusal string (trimmed, case-insensitive prefix). */
export function isModelRefusal(text: string): boolean {
  return text.trim().toLowerCase().startsWith(REFUSAL_TEXT.toLowerCase());
}
