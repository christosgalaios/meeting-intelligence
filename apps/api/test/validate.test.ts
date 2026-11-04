import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { SEED_DIR } from '../src/services/seed.js';
import { validateTranscript } from '../src/transcript/validate.js';
import { buildServer } from '../src/server.js';
import { ApiError, MeetingDetail } from '../src/types.js';
import { FakeLlm, createTestDb, fakeEmbedder } from './helpers.js';
import type { Embedder } from '../src/embed/embedder.js';

const GOOD = '[00:00:01] Priya: Hello there.\n[00:00:09] Marcus: Hi.\n[00:00:20] Priya: Let us start.';
const rejection = (text: string): AppError => {
  try {
    validateTranscript(text);
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('expected a rejection');
};

describe('validateTranscript', () => {
  it('accepts every seed transcript and a wrapped transcript', () => {
    for (const f of readdirSync(SEED_DIR).filter((n) => n.endsWith('.txt'))) {
      expect(() => validateTranscript(readFileSync(`${SEED_DIR}/${f}`, 'utf8')), f).not.toThrow();
    }
    // Every turn wrapped onto a second line is exactly 50% timestamped lines: allowed.
    const wrapped = '[00:01] A: one\ncontinues here\n[00:09] B: two\ncontinues too';
    expect(() => validateTranscript(wrapped)).not.toThrow();
  });

  it('rejects a NUL byte and mostly-control-character text as a 422 VALIDATION', () => {
    const nul = rejection(GOOD + '\0');
    expect(nul).toMatchObject({ code: 'VALIDATION', status: 422, message: "This doesn't look like a text transcript." });
    expect(rejection(GOOD + '\u0001'.repeat(40)).message).toBe("This doesn't look like a text transcript.");
    expect(() => validateTranscript(`${GOOD}\n`.repeat(10) + '\u0001\u0001')).not.toThrow(); // well under 1%
    expect(() => validateTranscript(GOOD.replace(/ /g, '\t'))).not.toThrow(); // tabs and newlines are fine
  });

  it('rejects fewer than 2 turns', () => {
    const e = rejection('[00:00:01] Priya: only one turn');
    expect(e).toMatchObject({ code: 'VALIDATION', status: 422 });
    expect(e.message).toContain('Only 1 of 1 lines');
  });

  it('rejects when under half of the non-empty lines are turns, naming the counts', () => {
    const junk = Array.from({ length: 117 }, (_, i) => `junk line ${i}`).join('\n');
    const e = rejection(`${GOOD}\n${junk}`);
    expect(e).toMatchObject({ code: 'VALIDATION', status: 422 });
    expect(e.message).toContain("Only 3 of 120 lines look like '[hh:mm:ss] Speaker: text'");
  });

  it('rejects a single turn longer than 2000 words', () => {
    const e = rejection(`[00:00:01] Priya: ${'word '.repeat(2001)}\n[00:00:09] Marcus: ok`);
    expect(e).toMatchObject({ code: 'VALIDATION', status: 422 });
    expect(e.message).toContain('Turn 1');
    expect(() => validateTranscript(`[00:00:01] Priya: ${'word '.repeat(2000)}\n[00:00:09] Marcus: ok`)).not.toThrow();
  });

  it('keeps the existing EMPTY_TRANSCRIPT error for text with no turns at all', () => {
    expect(rejection('just some words').code).toBe('EMPTY_TRANSCRIPT');
  });
});

describe('uploads are validated before any embedding or model call', () => {
  const bad: Array<[string, string, string]> = [
    ['NUL byte', GOOD + '\0', "This doesn't look like a text transcript."],
    ['one turn', '[00:00:01] Priya: alone', 'Only 1 of 1 lines'],
    ['mostly junk', `${GOOD}\n${'junk\n'.repeat(60)}`, "look like '[hh:mm:ss] Speaker: text'"],
    ['pasted document', `[00:00:01] Priya: ${'word '.repeat(2500)}\n[00:00:09] Marcus: ok`, 'longer than 2000 words'],
  ];

  for (const [name, text, message] of bad) {
    it(`${name}: 422 VALIDATION, and no embedder or LLM call`, async () => {
      const { pool, drop } = await createTestDb();
      let embeds = 0;
      const embedder: Embedder = { embed: (t) => { embeds++; return fakeEmbedder.embed(t); }, isReady: () => true };
      const llm = new FakeLlm();
      const app = buildServer({ pool, embedder, llm, logLevel: 'silent' });
      const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { filename: 'x.txt', text } });
      expect(res.statusCode).toBe(422);
      const err = ApiError.parse(res.json());
      expect(err.error.code).toBe('VALIDATION');
      expect(err.error.message).toContain(message);
      await app.extractionQueue.idle();
      expect(embeds).toBe(0);
      expect(llm.extractCalls).toBe(0);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM meetings');
      expect(rows[0].n).toBe(0);
      await app.close();
      await drop();
    });
  }

  it('a good transcript still uploads', async () => {
    const { pool, drop } = await createTestDb();
    const app = buildServer({ pool, embedder: fakeEmbedder, llm: new FakeLlm(), logLevel: 'silent' });
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { filename: 'g.txt', text: GOOD } });
    expect(res.statusCode).toBe(201);
    MeetingDetail.parse(res.json());
    await app.extractionQueue.idle();
    await app.close();
    await drop();
  });
});
