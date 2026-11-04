import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ExtractionSchema, type Extraction } from './extractionSchema.js';
import {
  ANSWER_MODEL,
  ANSWER_SYSTEM_PROMPT,
  EXTRACTION_MODEL,
  EXTRACTION_SYSTEM_PROMPT,
  formatContext,
  formatTranscript,
  type PromptMeeting,
} from './prompts.js';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface AnswerResult {
  text: string;
  stopReason: string | null;
  usage: LlmUsage;
}

export interface ExtractResult {
  /** null when the model refused or produced nothing parseable. */
  output: Extraction | null;
  stopReason: string | null;
  usage: LlmUsage;
}

export interface LlmClient {
  /** False for the no-key client: the app runs in retrieval-only mode. */
  readonly enabled: boolean;
  readonly answerModel: string | null;
  readonly extractionModel: string | null;
  streamAnswer(args: { meetings: PromptMeeting[]; question: string; onToken: (text: string) => void }): Promise<AnswerResult>;
  extract(args: { meeting: PromptMeeting }): Promise<ExtractResult>;
}

/** Used when no key is set. Nothing calls it: callers check `enabled` first. */
export class NullLlmClient implements LlmClient {
  readonly enabled = false;
  readonly answerModel = null;
  readonly extractionModel = null;

  streamAnswer(): Promise<AnswerResult> {
    return Promise.reject(new Error('LLM is disabled: no ANTHROPIC_API_KEY is set'));
  }

  extract(): Promise<ExtractResult> {
    return Promise.reject(new Error('LLM is disabled: no ANTHROPIC_API_KEY is set'));
  }
}

const usageOf = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }): LlmUsage => ({
  inputTokens: u.input_tokens,
  outputTokens: u.output_tokens,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
});

export class AnthropicLlmClient implements LlmClient {
  readonly enabled = true;
  readonly answerModel = ANSWER_MODEL;
  readonly extractionModel = EXTRACTION_MODEL;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async streamAnswer(args: { meetings: PromptMeeting[]; question: string; onToken: (text: string) => void }): Promise<AnswerResult> {
    // No thinking, temperature, top_p, top_k, prefill or forced tools: all are 400s on these models (spec 6.4).
    // server-side fallbacks are a beta-only parameter in this SDK, so they are not used (spec 11.4).
    const stream = this.client.messages.stream({
      model: ANSWER_MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: ANSWER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: formatContext(args.meetings, args.question) }],
      output_config: { effort: 'low' },
    });
    stream.on('text', (delta) => args.onToken(delta));
    const message = await stream.finalMessage();
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return { text, stopReason: message.stop_reason, usage: usageOf(message.usage) };
  }

  async extract(args: { meeting: PromptMeeting }): Promise<ExtractResult> {
    const message = await this.client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 4096,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: formatTranscript([args.meeting]) }],
      output_config: { effort: 'low', format: zodOutputFormat(ExtractionSchema) },
    });
    return { output: message.parsed_output ?? null, stopReason: message.stop_reason, usage: usageOf(message.usage) };
  }
}

export function createLlmClient(apiKey: string | undefined): LlmClient {
  return apiKey ? new AnthropicLlmClient(apiKey) : new NullLlmClient();
}
