import { readFileSync } from 'node:fs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { migrate } from '../src/db/migrate.js';
import type { Pool } from '../src/db/pool.js';
import { AnthropicLlmClient, NullLlmClient, type AnswerResult } from '../src/llm/client.js';
import { buildServer } from '../src/server.js';
import { failInterruptedExtractions } from '../src/services/ingest.js';
import { isBelowThreshold } from '../src/services/ask.js';
import { ExtractionQueue } from '../src/services/queue.js';
import { seedTranscripts } from '../src/services/seed.js';
import type { RankedChunk } from '../src/types.js';
import { FakeLlm, createTestDb, fakeEmbedder, parseSse } from './helpers.js';

const PRICING = readFileSync(new URL('./fixtures/pricing.txt', import.meta.url), 'utf8');
const ASK = { question: 'Starter plan priced per seat' };

describe('database lifecycle', () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => drop());

  it('running migrations a second time applies nothing', async () => {
    expect(await migrate(pool)).toEqual([]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0].n).toBe(2);
  });

  it('seeding is idempotent', async () => {
    const deps = { pool, embedder: fakeEmbedder, llm: new NullLlmClient(), queue: new ExtractionQueue(), log: pino({ level: 'silent' }) };
    const first = await seedTranscripts(deps);
    expect(first.added).toBeGreaterThan(0);
    expect(first.skipped).toBe(0);
    const second = await seedTranscripts(deps);
    expect(second).toEqual({ added: 0, skipped: first.added });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM meetings');
    expect(rows[0].n).toBe(first.added);
  });

  it('a pending extraction left over from a dead process is marked failed: interrupted', async () => {
    await pool.query("UPDATE meetings SET extraction_status = 'pending' WHERE id = (SELECT id FROM meetings LIMIT 1)");
    expect(await failInterruptedExtractions(pool)).toBe(1);
    const { rows } = await pool.query("SELECT extraction_status, extraction_error FROM meetings WHERE extraction_error = 'interrupted'");
    expect(rows).toEqual([{ extraction_status: 'failed', extraction_error: 'interrupted' }]);
    expect(await failInterruptedExtractions(pool)).toBe(0);
  });
});

describe('refusal rule', () => {
  const chunk = (vectorScore: number | null, textRank: number | null): RankedChunk => ({
    chunkId: 'c', meetingId: 'm', meetingSlug: 's', firstTurnN: 1, lastTurnN: 2, startSeconds: 0, endSeconds: 1,
    rrfScore: 0.01, vectorRank: vectorScore === null ? null : 1, vectorScore, textRank, textScore: textRank === null ? null : 0.1,
  });

  it('refuses when the vector score is low and there is no text hit', () => {
    expect(isBelowThreshold([chunk(0.3, null)], 0.5, false)).toEqual({ topVectorScore: 0.3, belowThreshold: true });
    expect(isBelowThreshold([], 0.5, false)).toEqual({ topVectorScore: null, belowThreshold: true });
  });

  it('a text hit overrides a low vector score', () => {
    expect(isBelowThreshold([chunk(0.3, null), chunk(null, 1)], 0.5, true).belowThreshold).toBe(false);
    // a text match that is not strict (one common word) does not override
    expect(isBelowThreshold([chunk(0.3, null), chunk(null, 1)], 0.5, false).belowThreshold).toBe(true);
  });

  it('a strong vector score passes without a text hit', () => {
    expect(isBelowThreshold([chunk(0.8, null)], 0.5, false).belowThreshold).toBe(false);
  });
});

describe('LLM stop reasons and disconnects', () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  const lines: string[] = [];
  const build = (llm: FakeLlm) =>
    buildServer({ pool, embedder: fakeEmbedder, llm, logLevel: 'warn', logStream: { write: (l) => void lines.push(l) } });
  const withText = (stopReason: string): FakeLlm => {
    const llm = new FakeLlm();
    llm.streamAnswer = async (): Promise<AnswerResult> => ({
      text: 'Partial answer [x#2].', stopReason, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
    });
    return llm;
  };

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
    const app = buildServer({ pool, embedder: fakeEmbedder, llm: new NullLlmClient(), logLevel: 'silent' });
    await app.inject({ method: 'POST', url: '/api/meetings', payload: { filename: 'x.txt', text: PRICING } });
    await app.close();
  });
  afterAll(async () => drop());

  it('stop_reason refusal becomes an LLM_ERROR event', async () => {
    const app = build(withText('refusal'));
    const res = await app.inject({ method: 'POST', url: '/api/ask', payload: ASK });
    const last = parseSse(res.payload).at(-1)!;
    expect(last).toEqual({ event: 'error', data: { type: 'error', code: 'LLM_ERROR', message: 'The model declined this request.' } });
    await app.close();
  });

  it('stop_reason max_tokens still returns the text and logs a warning', async () => {
    lines.length = 0;
    const app = build(withText('max_tokens'));
    const res = await app.inject({ method: 'POST', url: '/api/ask', payload: ASK });
    const last = parseSse(res.payload).at(-1)!;
    expect(last.event).toBe('done');
    expect(last.data.answer).toBe('Partial answer [x#2].');
    expect(lines.some((l) => (JSON.parse(l) as { msg: string }).msg === 'ask.truncated')).toBe(true);
    await app.close();
  });

  it('aborts the model stream when the client disconnects', async () => {
    const llm = new FakeLlm();
    let aborted = false;
    llm.streamAnswer = ({ onToken, signal }) =>
      new Promise<AnswerResult>((_, reject) => {
        onToken('thinking ');
        signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      });
    const app = build(llm);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const ctl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ASK), signal: ctl.signal,
    });
    const reader = res.body!.getReader();
    await reader.read(); // the stream is open and the model call is in flight
    ctl.abort();
    for (let i = 0; i < 50 && !aborted; i++) await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toBe(true);
    await app.close();
  });
});

describe('meeting scope ids', () => {
  it('accepts an upper-case uuid and slug', async () => {
    const { pool, drop } = await createTestDb();
    const app: FastifyInstance = buildServer({ pool, embedder: fakeEmbedder, llm: new NullLlmClient(), logLevel: 'silent' });
    const up = await app.inject({ method: 'POST', url: '/api/meetings', payload: { filename: 'x.txt', text: PRICING } });
    const id = (up.json() as { id: string }).id.toUpperCase();
    const res = await app.inject({ method: 'POST', url: '/api/ask', payload: { ...ASK, meetingIds: [id, 'X'] } });
    expect(res.statusCode).toBe(200);
    expect(parseSse(res.payload).map((e) => e.event)[0]).toBe('meta');
    await app.close();
    await drop();
  });
});

describe('AnthropicLlmClient request shape', () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const message = (text: string) => ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
  });
  const sse = (text: string) =>
    [
      ['message_start', { type: 'message_start', message: { ...message(''), content: [] } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
      ['message_stop', { type: 'message_stop' }],
    ].map(([e, d]) => `event: ${e as string}\ndata: ${JSON.stringify(d)}\n\n`).join('');

  const fakeFetch = ((url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    if (body.stream) return Promise.resolve(new Response(sse('Hello [x#1]'), { headers: { 'content-type': 'text/event-stream' } }));
    return Promise.resolve(Response.json(message(JSON.stringify({ decisions: [], actionItems: [] }))));
  }) as unknown as typeof fetch;

  const meeting = { slug: 'x', title: 'X', turns: [{ id: 'x#1', n: 1, speaker: 'A', timestampLabel: '00:00:01', text: 'hi' }] };

  it('streams the answer with no forbidden parameters, effort low, and a cached system block', async () => {
    calls.length = 0;
    const llm = new AnthropicLlmClient('test-key', { fetch: fakeFetch, maxRetries: 0 });
    const tokens: string[] = [];
    const result = await llm.streamAnswer({ meetings: [meeting], question: 'q?', onToken: (t) => tokens.push(t) });
    expect(tokens.join('')).toBe('Hello [x#1]');
    expect(result).toMatchObject({ text: 'Hello [x#1]', stopReason: 'end_turn' });

    const body = calls[0]!.body;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.stream).toBe(true);
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) expect(body).not.toHaveProperty(key);
    expect(body.output_config).toEqual({ effort: 'low' });
    expect((body.system as { cache_control: unknown }[])[0]!.cache_control).toEqual({ type: 'ephemeral' });
    const messages = body.messages as { role: string }[];
    expect(messages.at(-1)!.role).toBe('user'); // no assistant prefill
  });

  it('extracts with structured output, effort low and no forbidden parameters', async () => {
    calls.length = 0;
    const llm = new AnthropicLlmClient('test-key', { fetch: fakeFetch, maxRetries: 0 });
    const out = await llm.extract({ meeting });
    expect(out.output).toEqual({ decisions: [], actionItems: [] });
    const body = calls[0]!.body;
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.max_tokens).toBe(4096);
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) expect(body).not.toHaveProperty(key);
    expect(body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
  });
});
