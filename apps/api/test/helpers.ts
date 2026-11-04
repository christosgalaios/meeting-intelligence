import { createHash, randomBytes } from 'node:crypto';
import { createPool, type Pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { EMBEDDING_DIM, QUERY_PREFIX, type Embedder } from '../src/embed/embedder.js';
import type { AnswerResult, ExtractResult, LlmClient } from '../src/llm/client.js';
import type { PromptMeeting } from '../src/llm/prompts.js';

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://meetings:meetings@localhost:5432/meetings';

/** Each test file gets its own schema, so files never see each other's rows. */
export async function createTestDb(): Promise<{ pool: Pool; drop: () => Promise<void> }> {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const admin = createPool(DATABASE_URL);
  await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(DATABASE_URL, schema);
  await migrate(pool);
  return {
    pool,
    drop: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

// A word's vector is a fixed pseudo-random unit-ish direction; a text is the normalised sum of its words.
// Texts that share words score high, texts that share none score near zero.
function wordVector(word: string): number[] {
  const out: number[] = [];
  for (let block = 0; out.length < EMBEDDING_DIM; block++) {
    const h = createHash('sha256').update(`${word}:${block}`).digest();
    for (let i = 0; i + 1 < h.length && out.length < EMBEDDING_DIM; i += 2) out.push((h.readUInt16BE(i) - 32768) / 32768);
  }
  return out;
}

export function fakeVector(text: string): number[] {
  const body = text.startsWith(QUERY_PREFIX) ? text.slice(QUERY_PREFIX.length) : text;
  const sum = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const w of body.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    wordVector(w).forEach((x, i) => (sum[i]! += x));
  }
  const norm = Math.sqrt(sum.reduce((s, x) => s + x * x, 0)) || 1;
  return sum.map((x) => x / norm);
}

export const fakeEmbedder: Embedder = {
  embed: (texts) => Promise.resolve(texts.map(fakeVector)),
  isReady: () => true,
};

export const notReadyEmbedder: Embedder = { embed: fakeEmbedder.embed, isReady: () => false };

export const FAKE_ANSWER = 'The Starter plan is priced per seat [x#2]. The mockup is late [ghost#99].';

export class FakeLlm implements LlmClient {
  readonly enabled = true;
  readonly answerModel = 'fake-answer-model';
  readonly extractionModel = 'fake-extraction-model';
  answerCalls = 0;
  extractCalls = 0;
  constructor(private readonly answerText = FAKE_ANSWER) {}

  async streamAnswer(args: { meetings: PromptMeeting[]; question: string; onToken: (t: string) => void }): Promise<AnswerResult> {
    this.answerCalls++;
    for (const piece of this.answerText.match(/\S+\s*/g) ?? []) args.onToken(piece);
    return { text: this.answerText, stopReason: 'end_turn', usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 0 } };
  }

  async extract(args: { meeting: PromptMeeting }): Promise<ExtractResult> {
    this.extractCalls++;
    const first = args.meeting.turns[0]!.id;
    return {
      output: {
        decisions: [{ text: 'Starter is priced per seat.', turnId: first }],
        actionItems: [
          { text: 'Collect competitor pricing.', owner: 'Priya', due: 'next Friday', turnId: first },
          { text: 'Unlinked item.', owner: null, due: null, turnId: 'nowhere#1' },
        ],
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 500, outputTokens: 80, cacheReadTokens: 0 },
    };
  }
}

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

export function parseSse(payload: string): SseEvent[] {
  return payload
    .split('\n\n')
    .filter((b) => b.trim() !== '')
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? '';
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? '{}';
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}
