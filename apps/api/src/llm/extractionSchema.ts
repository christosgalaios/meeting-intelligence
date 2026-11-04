import { z } from 'zod';

export const ExtractionSchema = z.object({
  decisions: z.array(z.object({
    text: z.string().min(1).max(500),
    turnId: z.string(), // id of the turn where the decision was made or confirmed
  })).max(30),
  actionItems: z.array(z.object({
    text: z.string().min(1).max(500),
    owner: z.string().nullable(), // a speaker name from the transcript, or null
    due: z.string().nullable(), // the due wording as said, or null
    turnId: z.string(),
  })).max(50),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/**
 * Keep every item, but unlink any turnId that is not a real turn of this meeting.
 * Owners are kept as given: names get abbreviated in speech.
 */
export function validateExtraction(
  extraction: Extraction,
  turnIds: ReadonlySet<string>,
): {
  decisions: { text: string; turnId: string | null }[];
  actionItems: { text: string; owner: string | null; due: string | null; turnId: string | null }[];
} {
  const link = (id: string) => (turnIds.has(id) ? id : null);
  return {
    decisions: extraction.decisions.map((d) => ({ text: d.text, turnId: link(d.turnId) })),
    actionItems: extraction.actionItems.map((a) => ({ text: a.text, owner: a.owner, due: a.due, turnId: link(a.turnId) })),
  };
}
