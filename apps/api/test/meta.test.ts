import { readFileSync } from 'node:fs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { buildServer } from '../src/server.js';
import { ExtractionQueue } from '../src/services/queue.js';
import { seedTranscripts } from '../src/services/seed.js';
import { filenameMeta } from '../src/transcript/title.js';
import { MeetingDetail, MeetingSummary } from '../src/types.js';
import { NullLlmClient } from '../src/llm/client.js';
import { FakeLlm, createTestDb, fakeEmbedder, notReadyEmbedder, parseSse } from './helpers.js';

const PRICING = readFileSync(new URL('./fixtures/pricing.txt', import.meta.url), 'utf8');

describe('filenameMeta', () => {
  it('reads the date and prettifies the rest into a title', () => {
    expect(filenameMeta('2026-10-13-pricing-model-review.txt')).toEqual({ date: '2026-10-13', title: 'Pricing model review' });
    expect(filenameMeta('2026-10-13_Pricing Model.txt')).toEqual({ date: '2026-10-13', title: 'Pricing Model' });
    expect(filenameMeta('dir/2026-01-02-a_b.txt')).toEqual({ date: '2026-01-02', title: 'A b' });
  });

  it('keeps the base name when there is no usable prefix', () => {
    expect(filenameMeta('product-sync.txt')).toEqual({ date: null, title: 'product-sync' });
    expect(filenameMeta('2026-13-45-bad-date.txt')).toEqual({ date: null, title: '2026-13-45-bad-date' });
    expect(filenameMeta('2026-10-13.txt')).toEqual({ date: '2026-10-13', title: '2026-10-13' });
  });
});

describe('titles, dates and counts through the API', () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let llm: FakeLlm;
  let app: ReturnType<typeof buildServer>;
  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
    llm = new FakeLlm();
    app = buildServer({ pool, embedder: fakeEmbedder, llm, logLevel: 'silent' });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await drop();
  });
  const up = (filename: string, title?: string) =>
    app.inject({ method: 'POST', url: '/api/meetings', payload: { filename, text: PRICING, ...(title ? { title } : {}) } });

  it('an upload gets the derived title and the date from the filename', async () => {
    const d = MeetingDetail.parse((await up('2026-10-13-pricing-model-review.txt')).json());
    expect(d).toMatchObject({ title: 'Pricing model review', meetingDate: '2026-10-13' });
  });

  it('an explicit title wins, and a filename without a date has a null meetingDate', async () => {
    const a = MeetingDetail.parse((await up('2026-10-14-x.txt', 'My title')).json());
    expect(a).toMatchObject({ title: 'My title', meetingDate: '2026-10-14' });
    const b = MeetingDetail.parse((await up('plain.txt')).json());
    expect(b).toMatchObject({ title: 'plain', meetingDate: null });
  });

  it('the list carries decision and action counts once extracted', async () => {
    await app.extractionQueue.idle();
    const list = (await app.inject({ method: 'GET', url: '/api/meetings' })).json() as { meetings: unknown[] };
    const m = list.meetings.map((x) => MeetingSummary.parse(x)).find((x) => x.slug === '2026-10-13-pricing-model-review')!;
    expect(m).toMatchObject({ extractionStatus: 'done', decisionCount: 1, actionItemCount: 2 });
  });
});

describe('seeding never calls the model', () => {
  it('with a key set, seeded meetings are skipped and extract is never called', async () => {
    const { pool, drop } = await createTestDb();
    const llm = new FakeLlm();
    const queue = new ExtractionQueue();
    const res = await seedTranscripts({ pool, embedder: fakeEmbedder, llm, queue, log: pino({ level: 'silent' }) });
    await queue.idle();
    expect(res.added).toBeGreaterThan(0);
    expect(llm.extractCalls).toBe(0);
    const { rows } = await pool.query("SELECT DISTINCT extraction_status AS s, count(meeting_date)::int AS dated FROM meetings GROUP BY 1");
    expect(rows).toEqual([{ s: 'skipped', dated: res.added }]);
    await drop();
  });
});

describe('POST /api/seed', () => {
  it('loads the samples without calling the model, and is idempotent', async () => {
    const { pool, drop } = await createTestDb();
    const llm = new FakeLlm();
    const app = buildServer({ pool, embedder: fakeEmbedder, llm, logLevel: 'silent' });
    const first = await app.inject({ method: 'POST', url: '/api/seed' });
    expect(first.statusCode).toBe(200);
    const { added } = first.json() as { added: number; skipped: number };
    expect(added).toBeGreaterThan(0);
    await app.extractionQueue.idle();
    expect(llm.extractCalls).toBe(0);
    const again = await app.inject({ method: 'POST', url: '/api/seed' });
    expect(again.json()).toEqual({ added: 0, skipped: added });
    const { rows } = await pool.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE extraction_status = 'skipped')::int AS s FROM meetings");
    expect(rows[0]).toEqual({ n: added, s: added });
    await app.close();
    await drop();
  });

  it('two simultaneous requests add each sample once', async () => {
    const { pool, drop } = await createTestDb();
    const app = buildServer({ pool, embedder: fakeEmbedder, llm: new FakeLlm(), logLevel: 'silent' });
    const [a, b] = await Promise.all([app.inject({ method: 'POST', url: '/api/seed' }), app.inject({ method: 'POST', url: '/api/seed' })]);
    expect(a.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM meetings WHERE slug ~ '-[0-9]+$' AND slug ~ '-2$'");
    expect(rows[0].n).toBe(0);
    await app.close();
    await drop();
  });

  it('is a 503 while the embedder is not ready', async () => {
    const { pool, drop } = await createTestDb();
    const app = buildServer({ pool, embedder: notReadyEmbedder, llm: new FakeLlm(), logLevel: 'silent' });
    const res = await app.inject({ method: 'POST', url: '/api/seed' });
    expect(res.statusCode).toBe(503);
    await app.close();
    await drop();
  });
});

describe('turn scores', () => {
  it('rank and score each turn by its own similarity to the question, not its chunk', async () => {
    const { pool, drop } = await createTestDb();
    const app = buildServer({ pool, embedder: fakeEmbedder, llm: new NullLlmClient(), logLevel: 'silent' });
    await app.inject({ method: 'POST', url: '/api/meetings', payload: { filename: 'p.txt', text: PRICING } });
    const res = await app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'What price was agreed for the Starter plan?' } });
    const sourcesBlock = parseSse(res.payload).find((e) => e.event === 'sources')!;
    const turns = (sourcesBlock.data as { turns: Array<{ score: number; text: string }> }).turns;
    const scores = turns.map((t) => t.score);
    expect(new Set(scores).size).toBeGreaterThan(1); // not one shared chunk score
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores.every((s) => s >= -1 && s <= 1)).toBe(true); // cosine, not an RRF value
    await app.close();
    await drop();
  });
});
