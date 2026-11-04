import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from '../src/db/pool.js';
import { buildServer } from '../src/server.js';
import { FakeLlm, createTestDb, fakeEmbedder } from './helpers.js';

const PRICING = readFileSync(new URL('./fixtures/pricing.txt', import.meta.url), 'utf8');

describe('log hygiene (spec 7)', () => {
  const lines: string[] = [];
  let app: FastifyInstance;
  let pool: Pool;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
    app = buildServer({
      pool, embedder: fakeEmbedder, llm: new FakeLlm(), logLevel: 'info', logStream: { write: (l) => void lines.push(l) },
    });
    await app.ready();
    await app.inject({ method: 'POST', url: '/api/meetings', payload: { filename: 'x.txt', text: PRICING } });
    await app.extractionQueue.idle();
    await app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'Starter plan priced per seat secret-question-marker' } });
    await app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'zxqvk plorfnax wibblegarb' } });
  });
  afterAll(async () => {
    await app.close();
    await drop();
  });

  const all = () => lines.join('');

  it('logs the per-stage lines from spec 7 at info', () => {
    const msgs = lines.map((l) => (JSON.parse(l) as { msg: string }).msg);
    for (const m of ['ingest.done', 'extract.done', 'ask.retrieved', 'ask.answered']) expect(msgs).toContain(m);
  });

  it('puts reqId, route and method on every request-scoped line', () => {
    const scoped = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.reqId);
    expect(scoped.length).toBeGreaterThan(4);
    for (const l of scoped.filter((x) => x.msg !== 'incoming request')) {
      expect(l.route, String(l.msg)).toBeTypeOf('string');
      expect(l.method, String(l.msg)).toBeTypeOf('string');
    }
  });

  it('never logs transcript text, the question, answers or key-shaped strings at info', () => {
    const text = all();
    expect(text).not.toContain('competitor pricing sheet'); // transcript content
    expect(text).not.toContain('secret-question-marker'); // the question
    expect(text).not.toContain('priced per seat'); // answer and transcript content
    expect(text).not.toMatch(/sk-ant/);
  });
});
