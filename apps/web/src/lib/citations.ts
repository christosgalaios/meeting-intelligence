import type { Citation, SourceTurn } from '../api/types';

export type AnswerPart =
  | { kind: 'text'; text: string; bold?: true }
  | { kind: 'cite'; turnId: string; n: number; citation: Citation };

export interface AnswerBlock {
  listItem: boolean;
  parts: AnswerPart[];
}

// Same shape the API accepts: [slug#n].
const CITE = /\[([a-z0-9-]+#\d+)\]/g;
const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * Turns answer text into blocks of text and citation chips. An id that is not in `valid` stays plain text:
 * the API drops ids it did not retrieve, and the UI must not dress one up as a source.
 * While streaming, a trailing "[slug#1" with no closing bracket yet is hidden instead of flashing as raw text.
 */
export function splitAnswer(text: string, valid: ReadonlyMap<string, Citation>, streaming = false): AnswerBlock[] {
  const source = streaming ? text.replace(/\[[^\]\n]*$/, '') : text;
  const numbers = new Map<string, number>();
  const blocks: AnswerBlock[] = [];

  for (const rawLine of source.split('\n')) {
    if (rawLine.trim() === '') continue;
    const listItem = LIST_MARKER.test(rawLine);
    const line = listItem ? rawLine.replace(LIST_MARKER, '') : rawLine;
    const parts: AnswerPart[] = [];
    let last = 0;
    for (const m of line.matchAll(CITE)) {
      const id = m[1]!;
      const citation = valid.get(id);
      if (!citation) continue;
      if (m.index > last) parts.push({ kind: 'text', text: line.slice(last, m.index) });
      if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
      parts.push({ kind: 'cite', turnId: id, n: numbers.get(id)!, citation });
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) });
    blocks.push({ listItem, parts: applyBold(parts) });
  }
  return blocks;
}

/**
 * The model writes **bold** even though the prompt does not ask for markdown. Bold is the only markup rendered;
 * the state carries across chips so "**label [x#1] more**" stays bold, and an unclosed "**" mid-stream just stays open.
 */
function applyBold(parts: AnswerPart[]): AnswerPart[] {
  let bold = false;
  const out: AnswerPart[] = [];
  for (const p of parts) {
    if (p.kind === 'cite') {
      out.push(p);
      continue;
    }
    p.text.split('**').forEach((seg, i) => {
      if (i > 0) bold = !bold;
      if (seg !== '') out.push(bold ? { kind: 'text', text: seg, bold: true } : { kind: 'text', text: seg });
    });
  }
  return out;
}

export function citationLookup(turns: readonly SourceTurn[], done: readonly Citation[] | null): Map<string, Citation> {
  // After `done` only the ids the API validated are citations; before it, any retrieved turn can be one.
  if (done) return new Map(done.map((c) => [c.turnId, c]));
  return new Map(turns.map((t) => [t.id, { turnId: t.id, meetingId: t.meetingId, timestampLabel: t.timestampLabel, speaker: t.speaker }]));
}

/** "pricing#12" -> 12 */
export const turnNumber = (turnId: string): number => Number(turnId.slice(turnId.lastIndexOf('#') + 1));
