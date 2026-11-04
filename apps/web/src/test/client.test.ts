import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, askStream, createSseParser } from '../api/client';
import type { AskEvent } from '../api/types';
import { meta, sources, timings } from './fixtures';

const frame = (e: AskEvent) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const done: AskEvent = { type: 'done', answer: 'Hi [pricing#1]', citations: [], droppedCitations: [], refusalReason: null, usage: null, timings };
const token = (text: string): AskEvent => ({ type: 'token', text });

/** A Response whose body arrives in the given pieces, so a test can split a frame across reads. */
function streamResponse(pieces: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of pieces) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(pieces: string[]): Promise<AskEvent[]> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(pieces)));
  const events: AskEvent[] = [];
  await askStream('q', undefined, { onEvent: (e) => events.push(e) });
  return events;
}

afterEach(() => vi.unstubAllGlobals());

describe('askStream', () => {
  it('parses a canned SSE byte stream into the expected event sequence', async () => {
    const payload = [meta('full'), sources, token('Hi '), token('[pricing#1]'), done].map(frame).join('');
    const events = await collect([payload]);
    expect(events.map((e) => e.type)).toEqual(['meta', 'sources', 'token', 'token', 'done']);
    expect(events[2]).toEqual({ type: 'token', text: 'Hi ' });
  });

  it('handles frames split across reads, including inside a JSON string and at the blank line', async () => {
    const payload = [meta('full'), token('split me'), done].map(frame).join('');
    const cut = payload.indexOf('split') + 3;
    const events = await collect([payload.slice(0, cut), payload.slice(cut, payload.length - 1), payload.slice(payload.length - 1)]);
    expect(events.map((e) => e.type)).toEqual(['meta', 'token', 'done']);
    expect(events[1]).toEqual({ type: 'token', text: 'split me' });
  });

  it('ignores unknown event types, malformed JSON and comment lines', async () => {
    const payload =
      frame(meta('retrieval-only')) +
      'event: ping\ndata: {"type":"ping"}\n\n' +
      'event: token\ndata: {not json\n\n' +
      ': keep-alive\n\n' +
      frame(done);
    const events = await collect([payload]);
    expect(events.map((e) => e.type)).toEqual(['meta', 'done']);
  });

  it('surfaces an error event and does not add a second one', async () => {
    const err: AskEvent = { type: 'error', code: 'LLM_ERROR', message: 'The answer could not be generated.' };
    const events = await collect([frame(meta('full')), frame(sources), frame(err)]);
    expect(events.map((e) => e.type)).toEqual(['meta', 'sources', 'error']);
    expect(events[2]).toEqual(err);
  });

  it('reports a stream that closes before done as an error event', async () => {
    const events = await collect([frame(meta('full')), frame(token('half an answer'))]);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'INTERNAL' });
  });

  it('rejects with the API error when the request fails before the stream starts', async () => {
    const body = { error: { code: 'EMBEDDINGS_NOT_READY', message: 'The embedding model is still loading.', requestId: 'r1' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 503 })));
    const onEvent = vi.fn();
    await expect(askStream('q', undefined, { onEvent })).rejects.toMatchObject({ code: 'EMBEDDINGS_NOT_READY', status: 503, requestId: 'r1' });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('maps a network failure to NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    const p = askStream('q', undefined, { onEvent: () => undefined });
    await expect(p).rejects.toBeInstanceOf(ApiClientError);
    await expect(p).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('posts the question and omits meetingIds when the scope is all meetings', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(streamResponse([frame(done)])));
    vi.stubGlobal('fetch', fetchMock);
    await askStream('what', undefined, { onEvent: () => undefined });
    await askStream('what', ['m1'], { onEvent: () => undefined });
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string) as unknown);
    expect(bodies).toEqual([{ question: 'what' }, { question: 'what', meetingIds: ['m1'] }]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/ask');
  });
});

describe('createSseParser', () => {
  it('accepts CRLF line endings', () => {
    const seen: string[] = [];
    const p = createSseParser((e) => seen.push(e.type));
    p.push(frame(meta('full')).replace(/\n/g, '\r\n'));
    expect(seen).toEqual(['meta']);
  });
});
