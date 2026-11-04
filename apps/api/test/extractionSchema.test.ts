import { describe, expect, it } from 'vitest';
import { ExtractionSchema, validateExtraction } from '../src/llm/extractionSchema.js';
import haikuOutput from './fixtures/haiku-extraction.json' with { type: 'json' };

describe('ExtractionSchema', () => {
  it('parses a recorded Haiku output fixture', () => {
    const parsed = ExtractionSchema.parse(haikuOutput);
    expect(parsed.decisions).toHaveLength(2);
    expect(parsed.actionItems[0]).toMatchObject({ owner: 'Priya', due: 'by Friday' });
  });

  it('turns an unknown turnId into null but keeps the item', () => {
    const parsed = ExtractionSchema.parse(haikuOutput);
    const out = validateExtraction(parsed, new Set(['pricing#3', 'pricing#7']));
    expect(out.decisions.map((d) => d.turnId)).toEqual(['pricing#3', null]);
    expect(out.decisions).toHaveLength(2);
    expect(out.actionItems.map((a) => a.turnId)).toEqual(['pricing#7', null]);
  });

  it('rejects more than 30 decisions', () => {
    const decisions = Array.from({ length: 31 }, (_, i) => ({ text: `d${i}`, turnId: 'x#1' }));
    expect(ExtractionSchema.safeParse({ decisions, actionItems: [] }).success).toBe(false);
    expect(ExtractionSchema.safeParse({ decisions: decisions.slice(0, 30), actionItems: [] }).success).toBe(true);
  });
});
