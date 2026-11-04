import type { AskEvent, Citation, RankedChunk, SourceTurn } from '../api/types';
import type { Exchange } from '../hooks/useAsk';

export const chunk = (n: number, over: Partial<RankedChunk> = {}): RankedChunk => ({
  chunkId: `c${n}`,
  meetingId: 'm1',
  meetingSlug: 'pricing',
  firstTurnN: n,
  lastTurnN: n + 1,
  startSeconds: n * 30,
  endSeconds: n * 30 + 60,
  rrfScore: 0.04 - n * 0.005,
  vectorRank: n,
  vectorScore: 0.8 - n * 0.05,
  textRank: n,
  textScore: 0.4 - n * 0.05,
  ...over,
});

export const turn = (n: number, speaker: string, text: string, score = 0.03): SourceTurn => ({
  id: `pricing#${n}`,
  meetingId: 'm1',
  n,
  speaker,
  startSeconds: n * 60,
  timestampLabel: `00:0${n}:00`,
  text,
  score,
});

export const TURNS: SourceTurn[] = [
  turn(1, 'Priya Raman', 'Annual discount goes to 20% for Team.', 0.04),
  turn(2, 'Marcus Chen', 'I will write up the revenue model.', 0.03),
  turn(3, 'Dana Okafor', 'Seat minimum stays at three.', 0.02),
];

export const meta = (mode: 'full' | 'retrieval-only'): AskEvent => ({
  type: 'meta',
  traceId: '11111111-2222-3333-4444-555555555555',
  mode,
  model: mode === 'full' ? 'claude-sonnet-5-5' : null,
});

export const sources: AskEvent = { type: 'sources', chunks: [chunk(1), chunk(2)], turns: TURNS };

export const timings = { embedMs: 30, searchMs: 18, llmMs: 2400, totalMs: 2500 };

export const citation = (t: SourceTurn): Citation => ({
  turnId: t.id,
  meetingId: t.meetingId,
  timestampLabel: t.timestampLabel,
  speaker: t.speaker,
});

const base: Exchange = {
  id: 'ask-1',
  question: 'What did we decide about annual pricing?',
  scopeCount: 3,
  askedAt: '10:42',
  status: 'done',
  traceId: '11111111-2222-3333-4444-555555555555',
  mode: 'full',
  model: 'claude-sonnet-5-5',
  chunks: [chunk(1), chunk(2)],
  turns: TURNS,
  answer: '',
  refusal: null,
  done: null,
  error: null,
};

export const retrievalOnlyExchange: Exchange = {
  ...base,
  mode: 'retrieval-only',
  model: null,
  done: { type: 'done', answer: null, citations: [], droppedCitations: [], refusalReason: null, usage: null, timings: { ...timings, llmMs: null, totalMs: 60 } },
};

const FULL_ANSWER = 'The team raised the annual discount to 20% [pricing#1]. Marcus owns the revenue model [pricing#2]. Also [ghost#9].';

export const fullExchange: Exchange = {
  ...base,
  answer: FULL_ANSWER,
  done: {
    type: 'done',
    answer: FULL_ANSWER,
    citations: [citation(TURNS[0]!), citation(TURNS[1]!)],
    droppedCitations: ['ghost#9'],
    refusalReason: null,
    usage: { inputTokens: 3912, outputTokens: 286, cacheReadTokens: 0 },
    timings,
  },
};

export const refusedExchange: Exchange = {
  ...base,
  answer: 'Not discussed in these meetings.',
  refusal: { topVectorScore: 0.31 },
  done: {
    type: 'done',
    answer: 'Not discussed in these meetings.',
    citations: [],
    droppedCitations: [],
    refusalReason: 'below_threshold',
    usage: null,
    timings: { ...timings, llmMs: null, totalMs: 60 },
  },
};
