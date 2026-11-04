import { z } from 'zod';

export const Mode = z.enum(['retrieval-only', 'full']);
export type Mode = z.infer<typeof Mode>;

export const ExtractionStatus = z.enum(['pending', 'done', 'failed', 'skipped']);
export type ExtractionStatus = z.infer<typeof ExtractionStatus>;

export const ApiError = z.object({
  error: z.object({
    code: z.enum([
      'VALIDATION', 'NOT_FOUND', 'EMPTY_TRANSCRIPT', 'TOO_LARGE',
      'EMBEDDINGS_NOT_READY', 'LLM_ERROR', 'CONFLICT', 'INTERNAL',
    ]),
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const Health = z.object({
  status: z.enum(['ok', 'degraded']),
  mode: Mode,
  db: z.boolean(),
  embeddings: z.object({ model: z.literal('Xenova/bge-small-en-v1.5'), ready: z.boolean() }),
  models: z.object({ answer: z.string().nullable(), extraction: z.string().nullable() }),
  version: z.string(),
});
export type Health = z.infer<typeof Health>;

export const MeetingSummary = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  sourceFilename: z.string(),
  turnCount: z.number().int(),
  durationSeconds: z.number().int(),
  speakers: z.array(z.string()),
  extractionStatus: ExtractionStatus,
  createdAt: z.string(),
  meetingDate: z.string().nullable(), // YYYY-MM-DD from the filename prefix; null -> use createdAt
  decisionCount: z.number().int(),
  actionItemCount: z.number().int(),
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

export const Turn = z.object({
  id: z.string(), // "<slug>#<n>"
  meetingId: z.string(),
  n: z.number().int(),
  speaker: z.string(),
  startSeconds: z.number().int(),
  timestampLabel: z.string(), // "hh:mm:ss"
  text: z.string(),
});
export type Turn = z.infer<typeof Turn>;

export const Decision = z.object({
  id: z.string(), text: z.string(), turnId: z.string().nullable(),
});
export type Decision = z.infer<typeof Decision>;

export const ActionItem = z.object({
  id: z.string(), text: z.string(), owner: z.string().nullable(),
  due: z.string().nullable(), turnId: z.string().nullable(),
});
export type ActionItem = z.infer<typeof ActionItem>;

export const MeetingDetail = MeetingSummary.extend({
  turns: z.array(Turn),
  decisions: z.array(Decision),
  actionItems: z.array(ActionItem),
  extractionError: z.string().nullable(),
});
export type MeetingDetail = z.infer<typeof MeetingDetail>;

export const UploadRequest = z.object({
  filename: z.string().min(1).max(200),
  title: z.string().min(1).max(200).optional(), // defaults to filename without extension
  text: z.string().min(1).max(2_000_000),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

export const AskRequest = z.object({
  question: z.string().min(1).max(1000),
  meetingIds: z.array(z.string()).min(1).max(50).optional(), // omitted = all meetings
});
export type AskRequest = z.infer<typeof AskRequest>;

export const RankedChunk = z.object({
  chunkId: z.string(),
  meetingId: z.string(),
  meetingSlug: z.string(),
  firstTurnN: z.number().int(),
  lastTurnN: z.number().int(),
  startSeconds: z.number().int(),
  endSeconds: z.number().int(),
  rrfScore: z.number(),
  vectorRank: z.number().int().nullable(),
  vectorScore: z.number().nullable(), // cosine similarity
  textRank: z.number().int().nullable(),
  textScore: z.number().nullable(), // ts_rank_cd
});
export type RankedChunk = z.infer<typeof RankedChunk>;

export const SourceTurn = Turn.extend({ score: z.number() }); // best rrfScore of a containing chunk
export type SourceTurn = z.infer<typeof SourceTurn>;

export const Citation = z.object({
  turnId: z.string(),
  meetingId: z.string(),
  timestampLabel: z.string(),
  speaker: z.string(),
});
export type Citation = z.infer<typeof Citation>;

export const QueryTrace = z.object({
  id: z.string(),
  requestId: z.string(),
  question: z.string(),
  meetingIds: z.array(z.string()).nullable(),
  mode: Mode,
  retrieval: z.array(RankedChunk),
  refused: z.boolean(),
  refusalReason: z.enum(['below_threshold', 'model_declined']).nullable(),
  answer: z.string().nullable(),
  citations: z.array(Citation).nullable(),
  droppedCitations: z.array(z.string()),
  model: z.string().nullable(),
  usage: z.object({
    inputTokens: z.number().int(), outputTokens: z.number().int(), cacheReadTokens: z.number().int(),
  }).nullable(),
  timings: z.object({
    embedMs: z.number().int(), searchMs: z.number().int(),
    llmMs: z.number().int().nullable(), totalMs: z.number().int(),
  }),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type QueryTrace = z.infer<typeof QueryTrace>;

// SSE events for POST /api/ask. Each is sent as `event: <type>\ndata: <json>\n\n`.
export const AskEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('meta'), traceId: z.string(), mode: Mode, model: z.string().nullable() }),
  z.object({ type: z.literal('sources'), chunks: z.array(RankedChunk), turns: z.array(SourceTurn) }),
  z.object({ type: z.literal('refusal'), reason: z.enum(['below_threshold']), topVectorScore: z.number().nullable() }),
  z.object({ type: z.literal('token'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    answer: z.string().nullable(), // null in retrieval-only mode
    citations: z.array(Citation),
    droppedCitations: z.array(z.string()),
    refusalReason: z.enum(['below_threshold', 'model_declined']).nullable(),
    usage: QueryTrace.shape.usage,
    timings: QueryTrace.shape.timings,
  }),
  z.object({ type: z.literal('error'), code: ApiError.shape.error.shape.code, message: z.string() }),
]);
export type AskEvent = z.infer<typeof AskEvent>;
