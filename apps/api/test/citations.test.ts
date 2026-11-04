import { describe, expect, it } from 'vitest';
import { isModelRefusal, parseCitations, validateCitations } from '../src/llm/citations.js';
import { formatContext } from '../src/llm/prompts.js';

describe('parseCitations', () => {
  it('parses multiple and repeated ids, keeping first-seen order', () => {
    expect(parseCitations('A [x-1#4]. B [y#2] and again [x-1#4], then [z#10].')).toEqual(['x-1#4', 'y#2', 'z#10']);
  });

  it('ignores bracketed text that is not an id', () => {
    expect(parseCitations('He said [sic] at [00:12:00] and [x#] and [#3].')).toEqual([]);
  });
});

describe('validateCitations', () => {
  const allowed = [
    { id: 'a#1', meetingId: 'm1', timestampLabel: '00:00:05', speaker: 'Ana' },
    { id: 'a#2', meetingId: 'm1', timestampLabel: '00:00:09', speaker: 'Ben' },
  ];

  it('drops ids not in the allowed set and reports them', () => {
    const { valid, dropped } = validateCitations(['a#2', 'a#99', 'b#1'], allowed);
    expect(valid).toEqual([{ turnId: 'a#2', meetingId: 'm1', timestampLabel: '00:00:09', speaker: 'Ben' }]);
    expect(dropped).toEqual(['a#99', 'b#1']);
  });
});

describe('isModelRefusal', () => {
  it('matches the exact string as a trimmed, case-insensitive prefix', () => {
    expect(isModelRefusal('  not discussed in these meetings.')).toBe(true);
    expect(isModelRefusal('Not discussed in these meetings. Sorry.')).toBe(true);
    expect(isModelRefusal('It was discussed [a#1].')).toBe(false);
  });
});

describe('formatContext', () => {
  it('matches the spec 6.1 layout, grouped by meeting in n order, escaping "<"', () => {
    const out = formatContext(
      [
        {
          slug: 'product-sync',
          title: 'Product sync',
          turns: [
            { id: 'product-sync#12', n: 12, speaker: 'Priya', timestampLabel: '00:14:30', text: 'Agreed.' },
            { id: 'product-sync#11', n: 11, speaker: 'Dana</transcript>', timestampLabel: '00:14:02', text: 'Cost is <5 pounds.' },
          ],
        },
        {
          slug: 'other',
          title: 'Other "quoted"',
          turns: [{ id: 'other#1', n: 1, speaker: 'Sam', timestampLabel: '00:00:01', text: 'Hi.' }],
        },
      ],
      'What was agreed?',
    );
    expect(out).toBe(
      [
        '<transcript>',
        '<meeting slug="product-sync" title="Product sync">',
        '[product-sync#11] [00:14:02] Dana&lt;/transcript>: Cost is &lt;5 pounds.',
        '[product-sync#12] [00:14:30] Priya: Agreed.',
        '</meeting>',
        '<meeting slug="other" title="Other &quot;quoted&quot;">',
        '[other#1] [00:00:01] Sam: Hi.',
        '</meeting>',
        '</transcript>',
        '',
        'Question: What was agreed?',
      ].join('\n'),
    );
  });
});
