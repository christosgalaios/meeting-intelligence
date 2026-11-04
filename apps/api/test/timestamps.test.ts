import { describe, expect, it } from 'vitest';
import { parseTranscript } from '../src/transcript/parse.js';

describe('timestamp range', () => {
  it('warns when minutes or seconds are 60 or more but keeps the turn', () => {
    const { turns, warnings } = parseTranscript('[00:75:00] A: bad minutes\n[02:00:61] B: bad seconds\n[03:00:00] C: fine', 'x');
    expect(turns).toHaveLength(3);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('turn 1');
    expect(warnings[1]).toContain('turn 2');
  });
});
