import { z } from 'zod';

export const TranscriptionStage = z.object({
  name: z.enum(['diarizing', 'transcribing']),
  done: z.number().int(),
  total: z.number().int(),
});
export type TranscriptionStage = z.infer<typeof TranscriptionStage>;

export const TranscriptionSegment = z.object({
  start: z.number(),
  end: z.number(),
  speaker: z.number().int(), // 1..N in first-appearance order
  text: z.string(),
});

/** A draft: nothing here is stored in the database, and nothing is ingested until the user confirms. */
export const Transcription = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  queuePosition: z.number().int().nullable(), // 1-based among active jobs (the running one counts); null once running
  stage: TranscriptionStage.nullable(),
  durationSeconds: z.number().int(),
  numSpeakers: z.number().int().nullable(), // speakers found; null until done
  speakers: z.array(z.string()),
  segments: z.array(TranscriptionSegment),
  transcript: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type Transcription = z.infer<typeof Transcription>;
