import { describe, expect, it } from 'vitest';
import { parseTranscript } from '../src/transcript/parse.js';
import { fileSlug } from '../src/transcript/slug.js';

describe('parseTranscript', () => {
  it('parses [hh:mm:ss] Name: text into turns with n, seconds and label', () => {
    const { turns } = parseTranscript('[00:00:03] Ana: Hello there.\n[01:02:05] Ben: Hi.', 'x');
    expect(turns).toEqual([
      { id: 'x#1', n: 1, speaker: 'Ana', startSeconds: 3, timestampLabel: '00:00:03', text: 'Hello there.' },
      { id: 'x#2', n: 2, speaker: 'Ben', startSeconds: 3725, timestampLabel: '01:02:05', text: 'Hi.' },
    ]);
  });

  it('accepts [mm:ss] and zero-pads the label', () => {
    const { turns } = parseTranscript('[4:07] Ana: Short form.', 'x');
    expect(turns[0]).toMatchObject({ startSeconds: 4 * 60 + 7, timestampLabel: '00:04:07' });
  });

  it('ignores blank lines and CRLF', () => {
    const { turns } = parseTranscript('[00:00:01] A: one\r\n\r\n   \r\n[00:00:02] B: two\r\n', 'x');
    expect(turns.map((t) => t.text)).toEqual(['one', 'two']);
  });

  it('attaches a malformed line to the previous turn with a space', () => {
    const { turns, warnings } = parseTranscript('[00:00:01] A: first part\nand the rest\n[00:00:09] B: next', 'x');
    expect(turns).toHaveLength(2);
    expect(turns[0]!.text).toBe('first part and the rest');
    expect(warnings).toEqual([]);
  });

  it('drops a malformed line before the first turn and reports a warning', () => {
    const { turns, warnings } = parseTranscript('Meeting notes header\n[00:00:01] A: hi', 'x');
    expect(turns).toHaveLength(1);
    expect(warnings).toHaveLength(1);
  });

  it('parses a speaker with spaces and punctuation', () => {
    const { turns } = parseTranscript('[00:00:05] Dr. Ana Lopez: Ratio is 3:1, ok?', 'x');
    expect(turns[0]).toMatchObject({ speaker: 'Dr. Ana Lopez', text: 'Ratio is 3:1, ok?' });
  });

  it('throws EMPTY_TRANSCRIPT on empty input', () => {
    expect(() => parseTranscript('  \n\n', 'x')).toThrowError(expect.objectContaining({ code: 'EMPTY_TRANSCRIPT' }));
    expect(() => parseTranscript('no timestamps at all', 'x')).toThrowError(expect.objectContaining({ code: 'EMPTY_TRANSCRIPT' }));
  });

  it('strips a BOM', () => {
    const { turns } = parseTranscript('\uFEFF[00:00:01] A: hi', 'x');
    expect(turns).toHaveLength(1);
  });

  it('warns on out-of-order timestamps but keeps the turns', () => {
    const { turns, warnings } = parseTranscript('[00:00:10] A: a\n[00:00:05] B: b', 'x');
    expect(turns).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });
});

describe('fileSlug', () => {
  it('lower-cases, hyphenates and drops the extension', () => {
    expect(fileSlug('2026-03-04 Product Sync!.txt')).toBe('2026-03-04-product-sync');
  });
  it('falls back to "meeting" and caps length at 60', () => {
    expect(fileSlug('***.txt')).toBe('meeting');
    expect(fileSlug(`${'a'.repeat(100)}.txt`)).toHaveLength(60);
  });
});
