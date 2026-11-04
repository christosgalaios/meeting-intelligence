import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { NullLlmClient, type LlmClient } from '../src/llm/client.js';
import { buildServer } from '../src/server.js';
import {
  ApiError, AskEvent, Health, MeetingDetail, MeetingSummary, QueryTrace,
} from '../src/types.js';
import { z } from 'zod';
import { FAKE_ANSWER, FakeLlm, createTestDb, fakeEmbedder, notReadyEmbedder, parseSse } from './helpers.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const PRICING = fixture('pricing.txt');
const OFFSITE = fixture('offsite.txt');

interface Env {
  app: FastifyInstance;
  pool: Pool;
  drop: () => Promise<void>;
}

async function setup(llm: LlmClient): Promise<Env> {
  const { pool, drop } = await createTestDb();
  const app = buildServer({ pool, embedder: fakeEmbedder, llm, logLevel: 'silent' });
  await app.ready();
  return { app, pool, drop };
}

const upload = (app: FastifyInstance, filename: string, text: string) =>
  app.inject({ method: 'POST', url: '/api/meetings', payload: { filename, text } });

const ask = async (app: FastifyInstance, body: unknown) => {
  const res = await app.inject({ method: 'POST', url: '/api/ask', payload: body as object });
  return { res, events: parseSse(res.payload) };
};

describe('API in retrieval-only mode (no key)', () => {
  let env: Env;
  beforeAll(async () => {
    env = await setup(new NullLlmClient());
    expect((await upload(env.app, 'x.txt', PRICING)).statusCode).toBe(201);
  });
  afterAll(async () => {
    await env.app.close();
    await env.drop();
  });

  it('GET /api/health is ok and reports retrieval-only', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = Health.parse(res.json());
    expect(body).toMatchObject({ status: 'ok', mode: 'retrieval-only', db: true });
    expect(body.models).toEqual({ answer: null, extraction: null });
  });

  it('upload returns 201 with turns and extractionStatus skipped', async () => {
    const res = await upload(env.app, 'up.txt', PRICING);
    expect(res.statusCode).toBe(201);
    const m = MeetingDetail.parse(res.json());
    expect(m).toMatchObject({ slug: 'up', turnCount: 7, extractionStatus: 'skipped', speakers: ['Priya', 'Tomasz', 'Hui Min'] });
    expect(m.turns[0]).toMatchObject({ id: 'up#1', n: 1, timestampLabel: '00:00:03' });
    expect(m.decisions).toEqual([]);
  });

  it('uploading the same filename twice gives slugs dup and dup-2', async () => {
    const first = await upload(env.app, 'dup.txt', PRICING);
    const second = await upload(env.app, 'dup.txt', PRICING);
    expect(MeetingDetail.parse(first.json()).slug).toBe('dup');
    expect(second.statusCode).toBe(201);
    expect(MeetingDetail.parse(second.json()).slug).toBe('dup-2');
  });

  it('upload of an empty file gives 422 UNPROCESSABLE', async () => {
    const res = await upload(env.app, 'empty.txt', '   \n\n');
    expect(res.statusCode).toBe(422);
    expect(ApiError.parse(res.json()).error.code).toBe('UNPROCESSABLE');
  });

  it('upload with a missing field is a 400 VALIDATION', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/meetings', payload: { filename: 'a.txt' } });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe('VALIDATION');
  });

  it('upload over 2 MB gives 413 TOO_LARGE', async () => {
    const res = await upload(env.app, 'big.txt', `[00:00:01] A: ${'w'.repeat(2_000_001)}`);
    expect(res.statusCode).toBe(413);
    expect(ApiError.parse(res.json()).error.code).toBe('TOO_LARGE');
  });

  it('list is newest first and detail accepts uuid or slug', async () => {
    await upload(env.app, 'order-a.txt', PRICING);
    await upload(env.app, 'order-b.txt', PRICING);
    const list = await env.app.inject({ method: 'GET', url: '/api/meetings' });
    const meetings = MeetingSummary.array().parse(list.json().meetings);
    const slugs = meetings.map((m) => m.slug);
    expect(slugs.indexOf('order-b')).toBeLessThan(slugs.indexOf('order-a'));
    const x = meetings.find((m) => m.slug === 'x')!;
    const byId = await env.app.inject({ method: 'GET', url: `/api/meetings/${x.id}` });
    const bySlug = await env.app.inject({ method: 'GET', url: '/api/meetings/x' });
    expect(MeetingDetail.parse(byId.json()).slug).toBe('x');
    expect(MeetingDetail.parse(bySlug.json()).id).toBe(x.id);
    const missing = await env.app.inject({ method: 'GET', url: '/api/meetings/nope' });
    expect(missing.statusCode).toBe(404);
    expect(ApiError.parse(missing.json()).error.code).toBe('NOT_FOUND');
  });

  it('ask returns meta, sources, done with answer null and non-empty source turns', async () => {
    const { res, events } = await ask(env.app, { question: 'Starter plan seats per seat billing' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(events.map((e) => e.event)).toEqual(['meta', 'sources', 'done']);
    const parsed = events.map((e) => AskEvent.parse({ type: e.event, ...e.data }));
    const sources = parsed[1]!;
    expect(sources.type === 'sources' && sources.turns.length).toBeGreaterThan(0);
    expect(parsed[2]).toMatchObject({ type: 'done', answer: null, refusalReason: null, citations: [] });
    expect(parsed[0]).toMatchObject({ type: 'meta', mode: 'retrieval-only', model: null });
  });

  it('ask with an unrelated question refuses below threshold with no answer in this mode', async () => {
    const { events } = await ask(env.app, { question: 'zxqvk plorfnax wibblegarb' });
    expect(events.map((e) => e.event)).toEqual(['meta', 'sources', 'refusal', 'done']);
    expect(events[3]!.data).toMatchObject({ answer: null, refusalReason: 'below_threshold' });
  });

  it('ask validation and unknown meeting are JSON errors before the stream', async () => {
    const bad = await env.app.inject({ method: 'POST', url: '/api/ask', payload: { question: '' } });
    expect(bad.statusCode).toBe(400);
    expect(ApiError.parse(bad.json()).error.code).toBe('VALIDATION');
    const unknown = await env.app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'hello', meetingIds: ['nope'] } });
    expect(unknown.statusCode).toBe(404);
    expect(ApiError.parse(unknown.json()).error.code).toBe('NOT_FOUND');
  });

  it('unknown route gives ApiError NOT_FOUND', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/nothing-here' });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe('NOT_FOUND');
  });

  it('x-request-id is present on every response, including errors and streams', async () => {
    const responses = await Promise.all([
      env.app.inject({ method: 'GET', url: '/api/health' }),
      env.app.inject({ method: 'GET', url: '/api/meetings' }),
      env.app.inject({ method: 'GET', url: '/api/meetings/nope' }),
      env.app.inject({ method: 'GET', url: '/nothing' }),
      env.app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'Starter plan' } }),
      env.app.inject({ method: 'POST', url: '/api/ask', payload: {} }),
    ]);
    for (const r of responses) expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    // The error body carries the same id as the header.
    const miss = await env.app.inject({ method: 'GET', url: '/api/meetings/nope' });
    expect(ApiError.parse(miss.json()).error.requestId).toBe(miss.headers['x-request-id']);
  });

  it('malformed JSON is a 400 VALIDATION, not a 500', async () => {
    const res = await env.app.inject({
      method: 'POST', url: '/api/ask', payload: '{not json', headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe('VALIDATION');
  });
});

describe('API in full mode (fake LLM)', () => {
  let env: Env;
  let llm: FakeLlm;
  beforeAll(async () => {
    llm = new FakeLlm();
    env = await setup(llm);
    await upload(env.app, 'x.txt', PRICING);
    await upload(env.app, 'offsite.txt', OFFSITE);
    await env.app.extractionJobs.idle();
  });
  afterAll(async () => {
    await env.app.close();
    await env.drop();
  });

  it('GET /api/health is ok and reports full with model names', async () => {
    const body = Health.parse((await env.app.inject({ method: 'GET', url: '/api/health' })).json());
    expect(body).toMatchObject({ status: 'ok', mode: 'full', models: { answer: 'fake-answer-model', extraction: 'fake-extraction-model' } });
  });

  it('upload is pending, then done after the extraction jobs are idle', async () => {
    const res = await upload(env.app, 'ex.txt', PRICING);
    expect(res.statusCode).toBe(201);
    expect(MeetingDetail.parse(res.json()).extractionStatus).toBe('pending');
    await env.app.extractionJobs.idle();
    const detail = MeetingDetail.parse((await env.app.inject({ method: 'GET', url: '/api/meetings/ex' })).json());
    expect(detail.extractionStatus).toBe('done');
    expect(detail.decisions).toHaveLength(1);
    expect(detail.decisions[0]!.turnId).toBe('ex#1');
    expect(detail.actionItems.map((a) => a.turnId)).toEqual(['ex#1', null]); // unknown turn id is unlinked, item kept
    expect(detail.actionItems[0]).toMatchObject({ owner: 'Priya', due: 'next Friday' });
  });

  it('a failing extraction marks the meeting failed and keeps the message', async () => {
    const failing = new FakeLlm();
    failing.extract = () => Promise.reject(new Error('upstream 529'));
    const { pool, drop } = await createTestDb();
    const app = buildServer({ pool, embedder: fakeEmbedder, llm: failing, logLevel: 'silent' });
    await upload(app, 'f.txt', PRICING);
    await app.extractionJobs.idle();
    const detail = MeetingDetail.parse((await app.inject({ method: 'GET', url: '/api/meetings/f' })).json());
    expect(detail).toMatchObject({ extractionStatus: 'failed', extractionError: 'upstream 529' });
    await app.close();
    await drop();
  });

  it('ask streams tokens; done has the answer, the valid citation and the dropped one', async () => {
    const { events } = await ask(env.app, { question: 'Starter plan priced per seat' });
    const kinds = events.map((e) => e.event);
    expect(kinds.slice(0, 2)).toEqual(['meta', 'sources']);
    expect(kinds.filter((k) => k === 'token').length).toBeGreaterThan(3);
    expect(kinds.at(-1)).toBe('done');
    const streamed = events.filter((e) => e.event === 'token').map((e) => e.data.text).join('');
    const done = AskEvent.parse({ type: 'done', ...events.at(-1)!.data });
    expect(streamed).toBe(FAKE_ANSWER);
    expect(done).toMatchObject({ type: 'done', answer: FAKE_ANSWER, refusalReason: null, droppedCitations: ['ghost#99'] });
    expect(done.type === 'done' && done.citations.map((c) => c.turnId)).toEqual(['x#2']);
    expect(done.type === 'done' && done.usage).toEqual({ inputTokens: 120, outputTokens: 30, cacheReadTokens: 0 });
  });

  it('GET /api/traces/:id after an ask parses as QueryTrace and matches the events', async () => {
    const { events } = await ask(env.app, { question: 'Starter plan priced per seat' });
    const traceId = events[0]!.data.traceId as string;
    const res = await env.app.inject({ method: 'GET', url: `/api/traces/${traceId}` });
    expect(res.statusCode).toBe(200);
    const trace = QueryTrace.parse(res.json());
    expect(trace).toMatchObject({
      mode: 'full', refused: false, model: 'fake-answer-model', answer: FAKE_ANSWER, droppedCitations: ['ghost#99'], error: null,
    });
    expect(trace.retrieval.length).toBeGreaterThan(0);
    expect(trace.timings.llmMs).not.toBeNull();
    const missing = await env.app.inject({ method: 'GET', url: '/api/traces/not-a-uuid' });
    expect(missing.statusCode).toBe(404);
  });

  it('ask with a question that scores below threshold refuses without calling the model', async () => {
    const before = llm.answerCalls;
    const { events } = await ask(env.app, { question: 'zxqvk plorfnax wibblegarb' });
    expect(events.map((e) => e.event)).toEqual(['meta', 'sources', 'refusal', 'done']);
    expect(events[3]!.data).toMatchObject({ answer: 'Not discussed in these meetings.', refusalReason: 'below_threshold' });
    expect(llm.answerCalls).toBe(before);
    const trace = QueryTrace.parse((await env.app.inject({ method: 'GET', url: `/api/traces/${events[0]!.data.traceId}` })).json());
    expect(trace).toMatchObject({ refused: true, refusalReason: 'below_threshold', model: null });
  });

  it('a model that replies with the refusal string is recorded as model_declined', async () => {
    const declining = new FakeLlm('Not discussed in these meetings.');
    const { pool, drop } = await createTestDb();
    const app = buildServer({ pool, embedder: fakeEmbedder, llm: declining, logLevel: 'silent' });
    await upload(app, 'x.txt', PRICING);
    await app.extractionJobs.idle();
    const { events } = await ask(app, { question: 'Starter plan priced per seat' });
    expect(events.at(-1)!.data).toMatchObject({ refusalReason: 'model_declined', citations: [] });
    const trace = QueryTrace.parse((await app.inject({ method: 'GET', url: `/api/traces/${events[0]!.data.traceId}` })).json());
    expect(trace).toMatchObject({ refused: true, refusalReason: 'model_declined' });
    await app.close();
    await drop();
  });

  it('an LLM failure after the stream starts arrives as an error event and is traced', async () => {
    const broken = new FakeLlm();
    broken.streamAnswer = () => Promise.reject(new Error('secret upstream detail'));
    const { pool, drop } = await createTestDb();
    const app = buildServer({ pool, embedder: fakeEmbedder, llm: broken, logLevel: 'silent' });
    await upload(app, 'x.txt', PRICING);
    await app.extractionJobs.idle();
    const { res, events } = await ask(app, { question: 'Starter plan priced per seat' });
    expect(res.statusCode).toBe(200);
    expect(events.at(-1)).toEqual({ event: 'error', data: { type: 'error', code: 'LLM_ERROR', message: 'The answer could not be generated.' } });
    expect(res.payload).not.toContain('secret upstream detail');
    const trace = QueryTrace.parse((await app.inject({ method: 'GET', url: `/api/traces/${events[0]!.data.traceId}` })).json());
    expect(trace.error).toBe('The answer could not be generated.');
    await app.close();
    await drop();
  });

  it('ask with meetingIds restricts sources to that meeting (by slug or uuid)', async () => {
    const list = z.object({ meetings: MeetingSummary.array() }).parse((await env.app.inject({ method: 'GET', url: '/api/meetings' })).json());
    const offsite = list.meetings.find((m) => m.slug === 'offsite')!;
    for (const scope of ['offsite', offsite.id]) {
      const { events } = await ask(env.app, { question: 'venue catering parking Starter plan', meetingIds: [scope] });
      const sources = AskEvent.parse({ type: 'sources', ...events[1]!.data });
      expect(sources.type === 'sources' && sources.turns.length).toBeGreaterThan(0);
      expect(sources.type === 'sources' && sources.turns.every((t) => t.meetingId === offsite.id)).toBe(true);
      expect(sources.type === 'sources' && sources.chunks.every((c) => c.meetingSlug === 'offsite')).toBe(true);
    }
  });
});

describe('embeddings not ready', () => {
  it('upload and ask return 503 EMBEDDINGS_NOT_READY, health is degraded', async () => {
    const { pool, drop } = await createTestDb();
    const app = buildServer({ pool, embedder: notReadyEmbedder, llm: new NullLlmClient(), logLevel: 'silent' });
    const up = await upload(app, 'x.txt', PRICING);
    expect(up.statusCode).toBe(503);
    expect(ApiError.parse(up.json()).error.code).toBe('EMBEDDINGS_NOT_READY');
    const a = await app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'hello' } });
    expect(a.statusCode).toBe(503);
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(503); // a probe that checks only the status code must see this
    const h = Health.parse(health.json());
    expect(h).toMatchObject({ status: 'degraded', embeddings: { ready: false }, voice: { available: false } });
    await app.close();
    await drop();
  });
});

describe('POST /api/meetings/:id/extract', () => {
  const extract = (app: FastifyInstance, id: string) => app.inject({ method: 'POST', url: `/api/meetings/${id}/extract` });

  it('without a key it is 409 CONFLICT and the meeting stays skipped', async () => {
    const env = await setup(new NullLlmClient());
    await upload(env.app, 'nokey.txt', PRICING);
    const res = await extract(env.app, 'nokey');
    expect(res.statusCode).toBe(409);
    expect(ApiError.parse(res.json()).error.code).toBe('CONFLICT');
    const detail = MeetingDetail.parse((await env.app.inject({ method: 'GET', url: '/api/meetings/nokey' })).json());
    expect(detail.extractionStatus).toBe('skipped');
    await env.app.close();
    await env.drop();
  });

  it('with a key it starts one extraction on a skipped meeting, then refuses a second run', async () => {
    const llm = new FakeLlm();
    const env = await setup(llm);
    await upload(env.app, 'seeded.txt', PRICING);
    await env.app.extractionJobs.idle();
    // The state a meeting seeded without a key is in.
    await env.pool.query("UPDATE meetings SET extraction_status = 'skipped' WHERE slug = 'seeded'");
    llm.extractCalls = 0;

    const res = await extract(env.app, 'seeded');
    expect(res.statusCode).toBe(202);
    expect(MeetingDetail.parse(res.json()).extractionStatus).toBe('pending');
    await env.app.extractionJobs.idle();
    const detail = MeetingDetail.parse((await env.app.inject({ method: 'GET', url: '/api/meetings/seeded' })).json());
    expect(detail.extractionStatus).toBe('done');
    expect(detail.decisions).toHaveLength(1);
    expect(llm.extractCalls).toBe(1);

    const again = await extract(env.app, 'seeded');
    expect(again.statusCode).toBe(409);
    expect(llm.extractCalls).toBe(1); // no second paid call

    const unknown = await extract(env.app, 'no-such-meeting');
    expect(unknown.statusCode).toBe(404);
    expect(ApiError.parse(unknown.json()).error.code).toBe('NOT_FOUND');
    await env.app.close();
    await env.drop();
  });

  it('a failed extraction can be started again', async () => {
    const llm = new FakeLlm();
    const env = await setup(llm);
    await upload(env.app, 'retry.txt', PRICING);
    await env.app.extractionJobs.idle();
    await env.pool.query("UPDATE meetings SET extraction_status = 'failed', extraction_error = 'upstream 529' WHERE slug = 'retry'");
    const res = await extract(env.app, 'retry');
    expect(res.statusCode).toBe(202);
    await env.app.extractionJobs.idle();
    const detail = MeetingDetail.parse((await env.app.inject({ method: 'GET', url: '/api/meetings/retry' })).json());
    expect(detail).toMatchObject({ extractionStatus: 'done', extractionError: null });
    await env.app.close();
    await env.drop();
  });
});
