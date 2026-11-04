import { describe, expect, it } from 'vitest';
import { applyEvent } from '../hooks/useAsk';
import { citationLookup, splitAnswer } from '../lib/citations';
import { estimateAskCost, estimateExtractionCost, formatHint, priceFor, usageCost } from '../lib/cost';
import { rejectFile, MAX_BYTES } from '../components/UploadDropzone';
import { talkShare } from '../pages/MeetingPage';
import { retrievalOnlyExchange, TURNS, citation, fullExchange, timings } from './fixtures';
import type { Exchange } from '../hooks/useAsk';

describe('cost', () => {
  it('prices sonnet and haiku from the spec and knows nothing else', () => {
    expect(priceFor('claude-sonnet-5-5')).toEqual({ input: 2, output: 10, cacheRead: 0.2 });
    expect(priceFor('claude-haiku-5-5')).toMatchObject({ input: 0.1, output: 0.5 });
    expect(priceFor('gpt-something')).toBeNull();
    expect(priceFor(null)).toBeNull();
  });

  it('computes the actual cost of a call from its token counts', () => {
    expect(usageCost('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 500_000 })).toBeCloseTo(2 + 1 + 0.1, 10);
    expect(usageCost('mystery', { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 })).toBeNull();
    // Haiku has no cache-read price on record, so a cached call is unknown, not free.
    expect(usageCost('claude-haiku-5-5', { inputTokens: 1, outputTokens: 1, cacheReadTokens: 10 })).toBeNull();
  });

  it('hints about a cent for a keyed ask and a fraction of a cent for extraction', () => {
    expect(formatHint(estimateAskCost('claude-sonnet-5-5')!)).toBe('~$0.01');
    const meeting = { turns: Array.from({ length: 40 }, (_, i) => ({ id: `x#${i}`, meetingId: 'm', n: i, speaker: 'Priya', startSeconds: i, timestampLabel: '', text: 'word '.repeat(40) })) };
    expect(formatHint(estimateExtractionCost('claude-haiku-5-5', meeting)!)).toBe('~$0.001');
    expect(estimateAskCost(null)).toBeNull();
  });

  it('never prints a zero hint', () => {
    expect(formatHint(0.00001)).toBe('~$0.001');
    expect(formatHint(0.0234)).toBe('~$0.02');
  });
});

describe('splitAnswer', () => {
  const lookup = citationLookup(TURNS, null);

  it('turns known ids into numbered chips in order of first appearance, and keeps unknown ids as text', () => {
    const blocks = splitAnswer('Raised to 20% [pricing#2]. Owner is Marcus [pricing#1][pricing#2]. Ghost [ghost#4].', lookup);
    expect(blocks).toHaveLength(1);
    const kinds = blocks[0]!.parts.map((p) => (p.kind === 'cite' ? `chip${p.n}:${p.turnId}` : 'text'));
    expect(kinds).toEqual(['text', 'chip1:pricing#2', 'text', 'chip2:pricing#1', 'chip1:pricing#2', 'text']);
    expect(blocks[0]!.parts.at(-1)).toMatchObject({ kind: 'text', text: '. Ghost [ghost#4].' });
  });

  it('after done, only validated citations become chips', () => {
    const validated = citationLookup(TURNS, [citation(TURNS[0]!)]);
    const parts = splitAnswer('A [pricing#1] B [pricing#2]', validated)[0]!.parts;
    expect(parts.filter((p) => p.kind === 'cite')).toHaveLength(1);
  });

  it('splits lines and detects list items', () => {
    const blocks = splitAnswer('Two follow-ups:\n- Marcus sends the model [pricing#2]\n- Priya writes copy', lookup);
    expect(blocks.map((b) => b.listItem)).toEqual([false, true, true]);
  });

  it('renders **bold**, keeps it open across a chip, and never shows the asterisks', () => {
    const [block] = splitAnswer('**Oct 6 kickoff [pricing#1] and more:** Priya proposed it', lookup);
    expect(block!.parts.map((p) => (p.kind === 'text' ? `${p.bold ? 'b' : 't'}:${p.text}` : 'chip'))).toEqual([
      'b:Oct 6 kickoff ',
      'chip',
      'b: and more:',
      't: Priya proposed it',
    ]);
    const [open] = splitAnswer('Normal **bold so far', lookup, true);
    expect(open!.parts).toEqual([{ kind: 'text', text: 'Normal ' }, { kind: 'text', text: 'bold so far', bold: true }]);
  });

  it('hides a half-typed citation at the end while streaming', () => {
    const [block] = splitAnswer('The discount is 20% [pricing#', lookup, true);
    expect(block!.parts).toEqual([{ kind: 'text', text: 'The discount is 20% ' }]);
    const [shown] = splitAnswer('The discount is 20% [pricing#', lookup, false);
    expect(shown!.parts).toEqual([{ kind: 'text', text: 'The discount is 20% [pricing#' }]);
  });
});

describe('applyEvent', () => {
  const fresh: Exchange = { ...retrievalOnlyExchange, status: 'searching', mode: null, model: null, chunks: [], turns: [], done: null };

  it('moves searching -> thinking -> streaming -> done in full mode', () => {
    let ex = applyEvent(fresh, { type: 'meta', traceId: 't', mode: 'full', model: 'claude-sonnet-5-5' });
    expect(ex.status).toBe('searching');
    ex = applyEvent(ex, { type: 'sources', chunks: [], turns: TURNS });
    expect(ex.status).toBe('thinking');
    ex = applyEvent(ex, { type: 'token', text: 'Hel' });
    ex = applyEvent(ex, { type: 'token', text: 'lo' });
    expect(ex).toMatchObject({ status: 'streaming', answer: 'Hello' });
    ex = applyEvent(ex, { type: 'done', answer: 'Hello.', citations: [], droppedCitations: [], refusalReason: null, usage: null, timings });
    expect(ex).toMatchObject({ status: 'done', answer: 'Hello.' });
  });

  it('does not enter a thinking state in retrieval-only mode', () => {
    let ex = applyEvent(fresh, { type: 'meta', traceId: 't', mode: 'retrieval-only', model: null });
    ex = applyEvent(ex, { type: 'sources', chunks: [], turns: TURNS });
    expect(ex.status).toBe('searching');
    ex = applyEvent(ex, { type: 'done', answer: null, citations: [], droppedCitations: [], refusalReason: null, usage: null, timings });
    expect(ex).toMatchObject({ status: 'done', answer: '' });
  });

  it('records a refusal and an error', () => {
    expect(applyEvent(fresh, { type: 'refusal', reason: 'below_threshold', topVectorScore: 0.3 }).refusal).toEqual({ topVectorScore: 0.3 });
    expect(applyEvent(fullExchange, { type: 'error', code: 'LLM_ERROR', message: 'x' })).toMatchObject({
      status: 'error',
      error: { code: 'LLM_ERROR', ref: fullExchange.traceId }, // the trace id from the meta event is what finds the log line
    });
  });
});

describe('rejectFile', () => {
  it('accepts .txt and text/plain up to 2 MB', () => {
    expect(rejectFile({ name: 'a.txt', size: 10, type: '' })).toBeNull();
    expect(rejectFile({ name: 'a', size: 10, type: 'text/plain' })).toBeNull();
    expect(rejectFile({ name: 'a.txt', size: MAX_BYTES, type: 'text/plain' })).toBeNull();
  });

  it('rejects other types, oversize and empty files with a friendly message, before any request', () => {
    expect(rejectFile({ name: 'a.pdf', size: 10, type: 'application/pdf' })).toMatch(/\.txt/);
    expect(rejectFile({ name: 'a.txt', size: MAX_BYTES + 1, type: 'text/plain' })).toMatch(/2 MB/);
    expect(rejectFile({ name: 'a.txt', size: 0, type: 'text/plain' })).toMatch(/empty/);
  });
});

describe('talkShare', () => {
  it('shares words per speaker, biggest first, summing to about 100', () => {
    const turns = [
      { speaker: 'A', text: 'one two three' },
      { speaker: 'B', text: 'one' },
      { speaker: 'A', text: 'four' },
    ].map((t, i) => ({ id: `s#${i}`, meetingId: 'm', n: i, startSeconds: 0, timestampLabel: '', ...t }));
    expect(talkShare({ turns, speakers: ['A', 'B'] })).toEqual([
      { name: 'A', words: 4, pct: 80 },
      { name: 'B', words: 1, pct: 20 },
    ]);
  });
});
