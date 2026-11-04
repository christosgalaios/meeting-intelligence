import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { NullLlmClient } from '../src/llm/client.js';
import { buildServer } from '../src/server.js';
import { ApiError } from '../src/types.js';
import type { TranscriptionRunner } from '../src/voice/jobs.js';
import * as wav from '../src/voice/wav.js';
import { createTestDb, fakeEmbedder } from './helpers.js';

// parseWav is wrapped so the test can see whether the route decoded a body it should have refused.
vi.mock('../src/voice/wav.js', async (orig) => {
  const m = await orig<typeof import('../src/voice/wav.js')>();
  return { ...m, parseWav: vi.fn(m.parseWav) };
});

const never: TranscriptionRunner = { run: () => new Promise(() => undefined) };
const silence = (s: number) => wav.encodeWav(new Int16Array(s * 16000));

describe('voice queue gate', () => {
  let app: FastifyInstance;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    const db = await createTestDb();
    drop = db.drop;
    app = buildServer({ pool: db.pool, embedder: fakeEmbedder, llm: new NullLlmClient(), voice: never, voiceMaxQueue: 2, logLevel: 'silent' });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await drop();
  });

  it('refuses with 409 before parsing the body once the queue is full', async () => {
    const post = (payload: Buffer) => app.inject({ method: 'POST', url: '/api/transcriptions', headers: { 'content-type': 'audio/wav' }, payload });
    expect((await post(silence(1))).statusCode).toBe(202);
    expect((await post(silence(1))).statusCode).toBe(202);

    vi.mocked(wav.parseWav).mockClear();
    const res = await post(silence(1));
    expect(res.statusCode).toBe(409);
    expect(ApiError.parse(res.json()).error.code).toBe('CONFLICT');
    expect(wav.parseWav).not.toHaveBeenCalled();
  });
});
