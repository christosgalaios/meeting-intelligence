import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAsk } from '../hooks/useAsk';

afterEach(() => vi.unstubAllGlobals());

describe('useAsk failures', () => {
  it('keeps the request id of a failure before the stream, so the error can be matched to a log line', async () => {
    const body = { error: { code: 'EMBEDDINGS_NOT_READY', message: 'The embedding model is still loading.', requestId: 'req-42' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 503 })));
    const { result } = renderHook(() => useAsk());
    act(() => {
      result.current.start('What was decided?', undefined, 3);
    });
    await waitFor(() => expect(result.current.exchanges[0]?.status).toBe('error'));
    expect(result.current.exchanges[0]?.error).toEqual({ code: 'EMBEDDINGS_NOT_READY', message: 'The embedding model is still loading.', ref: 'req-42' });
  });
});
