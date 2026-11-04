import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { NullLlmClient } from '../src/llm/client.js';
import { hybridSearch } from '../src/retrieval/search.js';
import { buildServer } from '../src/server.js';
import { createTestDb, fakeEmbedder } from './helpers.js';

const PRICING = readFileSync(new URL('./fixtures/pricing.txt', import.meta.url), 'utf8');

describe('full-text candidates', () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
    const app = buildServer({ pool, embedder: fakeEmbedder, llm: new NullLlmClient(), logLevel: 'silent' });
    await app.inject({ method: 'POST', url: '/api/meetings', payload: { filename: 'x.txt', text: PRICING } });
    await app.close();
  });
  afterAll(async () => drop());

  // One term ("zebra") is nowhere in the transcript, so requiring every term finds nothing.
  const question = 'Which competitor pricing did Tomasz gather for the zebra plan?';

  it('an AND query finds nothing when one term is missing', async () => {
    const r = await hybridSearch(pool, fakeEmbedder, { question, ftsMode: 'and' });
    expect(r.candidatesText).toBe(0);
  });

  it('the default OR query finds chunks that match any term, but not as a strict match', async () => {
    const r = await hybridSearch(pool, fakeEmbedder, { question });
    expect(r.candidatesText).toBeGreaterThan(0);
    expect(r.chunks.some((c) => c.textRank !== null)).toBe(true);
    expect(r.strictTextHit).toBe(false);
  });

  it('a question whose terms all appear in one chunk is a strict match', async () => {
    const r = await hybridSearch(pool, fakeEmbedder, { question: 'Starter plan per seat billing' });
    expect(r.strictTextHit).toBe(true);
  });

  it('an all-stop-word question yields no text candidates and no error', async () => {
    const r = await hybridSearch(pool, fakeEmbedder, { question: 'what is it to be' });
    expect(r.candidatesText).toBe(0);
  });
});
