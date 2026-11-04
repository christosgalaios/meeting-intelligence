import type { MeetingDetail } from '../api/types';

// Price per million tokens, from spec 6.4. Cache reads are listed for Sonnet only; Haiku's is not on record.
interface Price {
  input: number;
  output: number;
  cacheRead?: number;
}
const SONNET: Price = { input: 2, output: 10, cacheRead: 0.2 };
const HAIKU: Price = { input: 0.1, output: 0.5 };

export function priceFor(model: string | null): Price | null {
  if (!model) return null;
  if (model.includes('sonnet')) return SONNET;
  if (model.includes('haiku')) return HAIKU;
  return null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** Actual cost of a finished call, or null when the model has no price on record. */
export function usageCost(model: string | null, usage: TokenUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  if (usage.cacheReadTokens > 0 && price.cacheRead === undefined) return null;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output + usage.cacheReadTokens * (price.cacheRead ?? 0)) / 1e6;
}

// Assumptions, not measurements: an ask sends about eight retrieved chunks and gets a short answer back.
// The real numbers replace this once the answer finishes ("Why this answer").
export const ASSUMED_ASK = { inputTokens: 4000, outputTokens: 300 };
// Extraction sends the whole transcript plus the instructions, and returns a short structured list.
const CHARS_PER_TOKEN = 4;
const EXTRACTION_PROMPT_TOKENS = 700;
const ASSUMED_EXTRACTION_OUTPUT_TOKENS = 800;

export function estimateAskCost(answerModel: string | null): number | null {
  const price = priceFor(answerModel);
  if (!price) return null;
  return (ASSUMED_ASK.inputTokens * price.input + ASSUMED_ASK.outputTokens * price.output) / 1e6;
}

export function estimateExtractionCost(extractionModel: string | null, meeting: Pick<MeetingDetail, 'turns'>): number | null {
  const price = priceFor(extractionModel);
  if (!price) return null;
  const chars = meeting.turns.reduce((n, t) => n + t.text.length + t.speaker.length + 12, 0);
  const input = Math.ceil(chars / CHARS_PER_TOKEN) + EXTRACTION_PROMPT_TOKENS;
  return (input * price.input + ASSUMED_EXTRACTION_OUTPUT_TOKENS * price.output) / 1e6;
}

/** "~$0.01" for cents, "~$0.001" below that. Never shows "$0.000": the floor is a tenth of a cent. */
export function formatHint(usd: number): string {
  if (usd >= 0.01) return `~$${usd.toFixed(2)}`;
  return `~$${Math.max(usd, 0.001).toFixed(3)}`;
}

/** Shown next to every import in full mode, where the upload triggers a paid extraction. Null in retrieval-only mode. */
export function extractionImportHint(mode: 'full' | 'retrieval-only' | null, extractionModel: string | null): string | null {
  if (mode !== 'full') return null;
  const usd = estimateExtractionCost(extractionModel, { turns: [] });
  return `Importing also extracts decisions and action items (${usd === null ? 'costs a few tenths of a cent' : formatHint(usd)})`;
}

export const formatUsd = (usd: number): string => `$${usd.toFixed(4)}`;
