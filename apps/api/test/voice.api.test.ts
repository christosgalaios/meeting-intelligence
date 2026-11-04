import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NullLlmClient } from '../src/llm/client.js';
import { buildServer } from '../src/server.js';
import { ApiError, Health, MeetingDetail } from '../src/types.js';
import { CRASH_MESSAGE, NO_SPEECH_MESSAGE, RunnerCrashedError, type TranscriptionRunner } from '../src/voice/jobs.js';
import type { Segment } from '../src/voice/segments.js';
import { Transcription } from '../src/voice/types.js';
import { encodeWav } from '../src/voice/wav.js';
import { createTestDb, fakeEmbedder } from './helpers.js';
import type { Pool } from '../src/db/pool.js';

// Diarizer ids skip numbers on purpose: the jobs layer must relabel them 1..N.
const RESULT: Segment[] = [
  { speaker: 0, start: 0, end: 5, text: 'Good morning everyone, shall we start with the roadmap?' },
  { speaker: 2, start: 5.5, end: 11, text: 'Yes, October looks realistic if we cut the export options.' },
  { speaker: 0, start: 11.5, end: 15, text: 'Agreed, then October it is.' },
];

class FakeRunner implements TranscriptionRunner {
  calls: Array<{ numSpeakers: number | null; samples: number }> = [];
  result: Segment[] = RESULT;
  failWith: Error | null = null;
  gated = false;
  private releases: Array<() => void> = [];

  run(samples: Float32Array, opts: { numSpeakers: number | null }, onStage: (s: { name: 'diarizing' | 'transcribing'; done: number; total: number }) => void): Promise<Segment[]> {
    this.calls.push({ numSpeakers: opts.numSpeakers, samples: samples.length });
    onStage({ name: 'diarizing', done: 0, total: 1 });
    onStage({ name: 'transcribing', done: 1, total: 3 });
    if (this.failWith) return Promise.reject(this.failWith);
    if (!this.gated) return Promise.resolve(this.result);
    return new Promise((resolve) => this.releases.push(() => resolve(this.result)));
  }

  releaseOne(): void {
    this.releases.shift()?.();
  }
}

const silence = (seconds: number) => encodeWav(new Int16Array(Math.round(seconds * 16000)));
const wavHeaders = { 'content-type': 'audio/wav' };

interface Env { app: FastifyInstance; runner: FakeRunner; pool: Pool; drop: () => Promise<void>; lines: string[] }

async function setup(opts: { runner?: FakeRunner | null; logLevel?: string } = {}): Promise<Env> {
  const { pool, drop } = await createTestDb();
  const runner = opts.runner === null ? null : (opts.runner ?? new FakeRunner());
  const lines: string[] = [];
  const app = buildServer({
    pool, embedder: fakeEmbedder, llm: new NullLlmClient(), voice: runner, logLevel: opts.logLevel ?? 'silent',
    logStream: { write: (l) => void lines.push(l) },
  });
  await app.ready();
  return { app, runner: runner as FakeRunner, pool, drop, lines };
}

const post = (app: FastifyInstance, payload: Buffer, url = '/api/transcriptions') =>
  app.inject({ method: 'POST', url, headers: wavHeaders, payload });

async function waitFor(app: FastifyInstance, id: string, want: Array<Transcription['status']>) {
  for (let i = 0; i < 200; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/transcriptions/${id}` });
    const body = Transcription.parse(res.json());
    if (want.includes(body.status)) return body;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`transcription ${id} never reached ${want.join('/')}`);
}

describe('voice API with a fake runner', () => {
  let env: Env;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await env.app.close();
    await env.drop();
  });

  it('accepts a WAV with 202 and a queued Transcription', async () => {
    const res = await post(env.app, silence(1));
    expect(res.statusCode).toBe(202);
    const body = Transcription.parse(res.json());
    expect(body).toMatchObject({ status: 'queued', durationSeconds: 1, queuePosition: 1, transcript: null });
  });

  it('runs the job to done, relabels speakers, and the draft is accepted by the real ingest path', async () => {
    const res = await post(env.app, silence(2));
    const id = Transcription.parse(res.json()).id;
    const done = await waitFor(env.app, id, ['done']);
    expect(done.speakers).toEqual(['Speaker 1', 'Speaker 2']);
    expect(done.numSpeakers).toBe(2);
    expect(done.segments.map((s) => s.speaker)).toEqual([1, 2, 1]);
    expect(done.transcript).toBe([
      '[00:00:00] Speaker 1: Good morning everyone, shall we start with the roadmap?',
      '[00:00:05] Speaker 2: Yes, October looks realistic if we cut the export options.',
      '[00:00:11] Speaker 1: Agreed, then October it is.',
    ].join('\n'));

    // The whole path: what the API drafts, the API's own validator ingests.
    const ingest = await env.app.inject({ method: 'POST', url: '/api/meetings', payload: { filename: 'draft.txt', text: done.transcript } });
    expect(ingest.statusCode).toBe(201);
    expect(MeetingDetail.parse(ingest.json()).turnCount).toBe(done.segments.length);
  });

  it('rejects a 44.1 kHz WAV with 422 and names the format', async () => {
    const res = await post(env.app, encodeWav(new Int16Array(44100), 44100));
    expect(res.statusCode).toBe(422);
    expect(ApiError.parse(res.json()).error.message).toMatch(/got 44100 Hz mono 16-bit/);
  });

  it('rejects random bytes with 422', async () => {
    expect((await post(env.app, Buffer.from('not a wav at all, just text'))).statusCode).toBe(422);
  });

  it('rejects audio shorter than half a second with 422', async () => {
    expect((await post(env.app, silence(0.2))).statusCode).toBe(422);
  });

  it('rejects a JSON body with 400', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/transcriptions', payload: { a: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects audio over the 30 minute cap with 413 TOO_LARGE', async () => {
    const res = await post(env.app, silence(31 * 60));
    expect(res.statusCode).toBe(413);
    const err = ApiError.parse(res.json()).error;
    expect(err.code).toBe('TOO_LARGE');
    expect(err.message).toMatch(/longer than 30 minutes/);
  });

  it('rejects a body over 64 MiB with 413 before any parsing', async () => {
    const res = await post(env.app, Buffer.alloc(65 * 1024 * 1024));
    expect(res.statusCode).toBe(413);
    expect(ApiError.parse(res.json()).error.code).toBe('TOO_LARGE');
  });

  it('passes ?numSpeakers to the runner', async () => {
    const before = env.runner.calls.length;
    const id = Transcription.parse((await post(env.app, silence(1), '/api/transcriptions?numSpeakers=3')).json()).id;
    await waitFor(env.app, id, ['done']);
    expect(env.runner.calls[before]!.numSpeakers).toBe(3);
  });

  it.each(['0', '21', 'abc', '2.5', '-1'])('rejects ?numSpeakers=%s with 400', async (v) => {
    expect((await post(env.app, silence(1), `/api/transcriptions?numSpeakers=${v}`)).statusCode).toBe(400);
  });

  it('answers 404 for an unknown id and explains the restart case', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/transcriptions/nope' });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.message).toMatch(/may have restarted/);
  });

  it('DELETE evicts a finished job and 404s afterwards', async () => {
    const id = Transcription.parse((await post(env.app, silence(1))).json()).id;
    await waitFor(env.app, id, ['done']);
    expect((await env.app.inject({ method: 'DELETE', url: `/api/transcriptions/${id}` })).statusCode).toBe(204);
    expect((await env.app.inject({ method: 'GET', url: `/api/transcriptions/${id}` })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'DELETE', url: `/api/transcriptions/${id}` })).statusCode).toBe(404);
  });

  it('health reports voice available with the model label', async () => {
    const body = Health.parse((await env.app.inject({ method: 'GET', url: '/api/health' })).json());
    expect(body.voice.available).toBe(true);
    expect(body.voice.models).toMatch(/whisper/);
  });
});

describe('voice queue and failure handling', () => {
  afterEach(() => vi.useRealTimers());

  it('refuses the fifth active job with 409 and accepts again once one finishes', async () => {
    const env = await setup({ runner: Object.assign(new FakeRunner(), { gated: true }) });
    try {
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await post(env.app, silence(1));
        expect(res.statusCode).toBe(202);
        ids.push(Transcription.parse(res.json()).id);
      }
      expect(Transcription.parse((await env.app.inject({ method: 'GET', url: `/api/transcriptions/${ids[3]}` })).json()).queuePosition).toBe(4);
      const fifth = await post(env.app, silence(1));
      expect(fifth.statusCode).toBe(409);
      expect(ApiError.parse(fifth.json()).error.code).toBe('CONFLICT');

      await waitFor(env.app, ids[0]!, ['running']);
      env.runner.releaseOne();
      await waitFor(env.app, ids[0]!, ['done']);
      expect((await post(env.app, silence(1))).statusCode).toBe(202);
    } finally {
      await env.app.close();
      await env.drop();
    }
  });

  it('runs one job at a time and shows the running stage', async () => {
    const env = await setup({ runner: Object.assign(new FakeRunner(), { gated: true }) });
    try {
      const a = Transcription.parse((await post(env.app, silence(1))).json()).id;
      const b = Transcription.parse((await post(env.app, silence(1))).json()).id;
      const running = await waitFor(env.app, a, ['running']);
      expect(running.stage).toEqual({ name: 'transcribing', done: 1, total: 3 });
      expect(running.queuePosition).toBeNull();
      expect((await waitFor(env.app, b, ['queued'])).queuePosition).toBe(2);
      expect(env.runner.calls).toHaveLength(1);
    } finally {
      await env.app.close();
      await env.drop();
    }
  });

  it('marks a job failed with the runner error handled, and keeps serving the next job', async () => {
    const runner = new FakeRunner();
    runner.failWith = new Error('onnx exploded with secret detail');
    const env = await setup({ runner });
    try {
      const id = Transcription.parse((await post(env.app, silence(1))).json()).id;
      const failed = await waitFor(env.app, id, ['failed']);
      expect(failed.error).toBe('Transcription failed. Check the API logs.');
      expect(failed.error).not.toContain('secret detail');
      runner.failWith = null;
      const next = Transcription.parse((await post(env.app, silence(1))).json()).id;
      expect((await waitFor(env.app, next, ['done'])).status).toBe('done');
    } finally {
      await env.app.close();
      await env.drop();
    }
  });

  it('turns a worker crash into the out-of-memory message', async () => {
    const runner = new FakeRunner();
    runner.failWith = new RunnerCrashedError();
    const env = await setup({ runner });
    try {
      const id = Transcription.parse((await post(env.app, silence(1))).json()).id;
      expect((await waitFor(env.app, id, ['failed'])).error).toBe(CRASH_MESSAGE);
    } finally {
      await env.app.close();
      await env.drop();
    }
  });

  it('fails with the no-speech message when every segment is empty', async () => {
    const runner = new FakeRunner();
    runner.result = [{ speaker: 0, start: 0, end: 3, text: '  ' }];
    const env = await setup({ runner });
    try {
      const id = Transcription.parse((await post(env.app, silence(1))).json()).id;
      expect((await waitFor(env.app, id, ['failed'])).error).toBe(NO_SPEECH_MESSAGE);
    } finally {
      await env.app.close();
      await env.drop();
    }
  });

  it('forgets a finished job after the 60 minute TTL (clock frozen, not the wall clock)', async () => {
    const env = await setup();
    try {
      const id = Transcription.parse((await post(env.app, silence(1))).json()).id;
      await waitFor(env.app, id, ['done']);
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
      vi.advanceTimersByTime(59 * 60 * 1000);
      expect((await env.app.inject({ method: 'GET', url: `/api/transcriptions/${id}` })).statusCode).toBe(200);
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect((await env.app.inject({ method: 'GET', url: `/api/transcriptions/${id}` })).statusCode).toBe(404);
    } finally {
      vi.useRealTimers();
      await env.app.close();
      await env.drop();
    }
  });
});

describe('voice when no runner is configured', () => {
  it('answers POST with 409 and health says unavailable', async () => {
    const env = await setup({ runner: null });
    try {
      const res = await post(env.app, silence(1));
      expect(res.statusCode).toBe(409);
      expect(ApiError.parse(res.json()).error.message).toMatch(/not available/);
      const health = Health.parse((await env.app.inject({ method: 'GET', url: '/api/health' })).json());
      expect(health.voice).toEqual({ available: false, models: null });
    } finally {
      await env.app.close();
      await env.drop();
    }
  });
});

describe('voice log hygiene', () => {
  it('never logs transcript text at info', async () => {
    const runner = new FakeRunner();
    runner.result = [
      { speaker: 0, start: 0, end: 3, text: 'unique-marker-alpha budget numbers' },
      { speaker: 1, start: 3.5, end: 6, text: 'unique-marker-beta hiring plan' },
    ];
    const env = await setup({ runner, logLevel: 'info' });
    try {
      const id = Transcription.parse((await post(env.app, silence(1))).json()).id;
      await waitFor(env.app, id, ['done']);
      await env.app.inject({ method: 'GET', url: `/api/transcriptions/${id}` });
      const text = env.lines.join('');
      expect(text).toContain('voice.queued');
      expect(text).toContain('voice.done');
      expect(text).not.toContain('unique-marker');
      expect(text).not.toContain('Speaker 1:');
    } finally {
      await env.app.close();
      await env.drop();
    }
  });
});
