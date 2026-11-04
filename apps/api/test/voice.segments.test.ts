import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LINE, parseTranscript } from '../src/transcript/parse.js';
import { MAX_WORDS_PER_TURN, validateTranscript } from '../src/transcript/validate.js';
import {
  finalise, formatTranscript, mergeAdjacent, prepareForAsr, relabelSpeakers, speakerNames, splitLong, timestampLabel,
  type RawSegment, type Segment,
} from '../src/voice/segments.js';

const seg = (speaker: number, start: number, end: number, text = 'hello there'): Segment => ({ speaker, start, end, text });

describe('relabelSpeakers', () => {
  it('renumbers skipped ids 0,1,3 as 1,2,3 in first-appearance order', () => {
    const out = relabelSpeakers([seg(3, 0, 1), seg(0, 1, 2), seg(1, 2, 3), seg(3, 3, 4)]);
    expect(out.map((s) => s.speaker)).toEqual([1, 2, 3, 1]);
  });
  it('is idempotent', () => {
    const once = relabelSpeakers([seg(5, 0, 1), seg(2, 1, 2)]);
    expect(relabelSpeakers(once)).toEqual(once);
  });
});

describe('mergeAdjacent', () => {
  it('merges the same speaker across a gap of 1.0 s, keeping first start and last end', () => {
    expect(mergeAdjacent([{ speaker: 1, start: 0, end: 2 }, { speaker: 1, start: 3, end: 5 }])).toEqual([{ speaker: 1, start: 0, end: 5 }]);
  });
  it('keeps a gap of 1.1 s', () => {
    expect(mergeAdjacent([{ speaker: 1, start: 0, end: 2 }, { speaker: 1, start: 3.1, end: 5 }])).toHaveLength(2);
  });
  it('never merges across a different speaker', () => {
    const out = mergeAdjacent([{ speaker: 1, start: 0, end: 2 }, { speaker: 2, start: 2, end: 3 }, { speaker: 1, start: 3, end: 4 }]);
    expect(out.map((s) => s.speaker)).toEqual([1, 2, 1]);
  });
  it('does not mutate its input', () => {
    const input: RawSegment[] = [{ speaker: 1, start: 0, end: 2 }, { speaker: 1, start: 2.5, end: 4 }];
    mergeAdjacent(input);
    expect(input[0]!.end).toBe(2);
  });
});

describe('splitLong', () => {
  it('cuts a 60 s segment into 3 contiguous pieces of at most 28 s', () => {
    const out = splitLong([{ speaker: 2, start: 10, end: 70 }]);
    expect(out).toHaveLength(3);
    expect(out[0]!.start).toBe(10);
    expect(out[2]!.end).toBe(70);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]!.end - out[i]!.start).toBeLessThanOrEqual(28);
      expect(out[i]!.speaker).toBe(2);
      if (i > 0) expect(out[i]!.start).toBeCloseTo(out[i - 1]!.end, 9);
    }
  });
  it('leaves a 28.0 s segment untouched', () => {
    expect(splitLong([{ speaker: 1, start: 0, end: 28 }])).toEqual([{ speaker: 1, start: 0, end: 28 }]);
  });
});

describe('prepareForAsr', () => {
  it('keeps one speaker as two or more turns when merging would leave a single segment', () => {
    const out = prepareForAsr([{ speaker: 0, start: 0, end: 3 }, { speaker: 0, start: 3.2, end: 6 }]);
    expect(out).toHaveLength(2);
  });
  it('merges normally when more than one segment survives the merge', () => {
    const out = prepareForAsr([
      { speaker: 4, start: 0, end: 3 }, { speaker: 4, start: 3.2, end: 6 }, { speaker: 7, start: 6.5, end: 9 },
    ]);
    expect(out).toEqual([{ speaker: 1, start: 0, end: 6 }, { speaker: 2, start: 6.5, end: 9 }]);
  });

  it('holds its invariants on seeded random input (200 cases)', () => {
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let c = 0; c < 200; c++) {
      const raw: RawSegment[] = [];
      let t = 0;
      for (let i = 0; i < 1 + Math.floor(rnd() * 12); i++) {
        t += rnd() * 2;
        const len = 0.3 + rnd() * 70;
        raw.push({ speaker: Math.floor(rnd() * 4) * 2, start: t, end: t + len });
        t += len;
      }
      const out = prepareForAsr(raw);
      expect(new Set(out.map((s) => s.speaker)).size).toBe(new Set(raw.map((s) => s.speaker)).size);
      for (let i = 0; i < out.length; i++) {
        expect(out[i]!.end - out[i]!.start).toBeLessThanOrEqual(28 + 1e-9);
        if (i > 0) expect(out[i]!.start).toBeGreaterThanOrEqual(out[i - 1]!.end - 1e-9);
      }
    }
  });

  it('handles the shape the diarizer returns for the spike clip (ids 0, 1, 3)', () => {
    const truth = JSON.parse(readFileSync(new URL('../../../evals/voice/truth.json', import.meta.url), 'utf8')) as Array<{ speaker: string; start: number; end: number }>;
    const order = [...new Set(truth.map((t) => t.speaker))];
    const idFor = [0, 1, 3];
    const raw = truth.map((t) => ({ speaker: idFor[order.indexOf(t.speaker)]!, start: t.start, end: t.end }));
    const out = prepareForAsr(raw);
    expect(new Set(out.map((s) => s.speaker))).toEqual(new Set([1, 2, 3]));
    expect(out[0]!.speaker).toBe(1);
  });
});

describe('finalise', () => {
  it('drops empty text and relabels so a vanished speaker leaves no gap', () => {
    const out = finalise([seg(1, 0, 1, 'hi'), seg(2, 1, 2, '   '), seg(3, 2, 3, 'bye')]);
    expect(out.map((s) => s.speaker)).toEqual([1, 2]);
    expect(speakerNames(out)).toEqual(['Speaker 1', 'Speaker 2']);
  });
  it('returns [] when every segment is empty', () => {
    expect(finalise([seg(1, 0, 1, ''), seg(2, 1, 2, ' ')])).toEqual([]);
  });
  it('collapses internal newlines so one segment stays one transcript line', () => {
    expect(finalise([seg(1, 0, 1, 'a\n b')])[0]!.text).toBe('a b');
  });
});

describe('formatTranscript', () => {
  const two = [seg(1, 0.4, 5, 'Good morning everyone.'), seg(2, 12.7, 20, 'I think October is realistic.'), seg(1, 3725, 3730, 'Closing.')];

  it('renders lines that all match the parser LINE', () => {
    for (const line of formatTranscript(two).split('\n')) expect(LINE.test(line)).toBe(true);
  });
  it('round-trips through parseTranscript with floor(start) seconds', () => {
    const turns = parseTranscript(formatTranscript(two), 'm').turns;
    expect(turns.map((t) => t.startSeconds)).toEqual([0, 12, 3725]);
    expect(turns.map((t) => t.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1']);
  });
  it('is accepted by validateTranscript', () => {
    expect(validateTranscript(formatTranscript(two))).toHaveLength(3);
  });
  it('keeps a 28 s turn at 10 words per second under the per-turn word cap', () => {
    const words = Array.from({ length: 280 }, () => 'word').join(' ');
    expect(words.split(' ').length).toBeLessThan(MAX_WORDS_PER_TURN);
    expect(validateTranscript(formatTranscript([seg(1, 0, 28, words), seg(2, 28, 30, 'ok')]))).toHaveLength(2);
  });
  it('formats timestamps across the hour boundary', () => {
    expect(timestampLabel(3599.9)).toBe('00:59:59');
    expect(timestampLabel(3600)).toBe('01:00:00');
  });
});
