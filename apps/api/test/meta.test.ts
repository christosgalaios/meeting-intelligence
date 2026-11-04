import { readFileSync } from 'node:fs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { buildServer } from '../src/server.js';
import { ExtractionQueue } from '../src/services/queue.js';
import { seedTranscripts } from '../src/services/seed.js';
import { filenameMeta } from '../src/transcript/title.js';
import { MeetingDetail, MeetingSummary } from '../src/types.js';
import { FakeLlm, createTestDb, fakeEmbedder } from './helpers.js';

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
