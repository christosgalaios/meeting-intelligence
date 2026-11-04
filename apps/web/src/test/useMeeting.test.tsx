import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingDetail } from '../api/types';
import { POLL_MS, useMeeting } from '../hooks/useMeeting';

const detail = (status: MeetingDetail['extractionStatus']): MeetingDetail => ({
  id: 'u1',
  slug: 'pricing',
  title: 'Pricing',
  sourceFilename: 'pricing.txt',
  turnCount: 0,
  durationSeconds: 0,
  speakers: [],
  extractionStatus: status,
  createdAt: new Date(0).toISOString(),
  turns: [],
  decisions: [],
  actionItems: [],
  extractionError: null,
});

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('useMeeting', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('polls every 2 s while extraction is pending and stops once it is not', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => ok(detail('pending'))) // initial load
      .mockImplementationOnce(() => ok(detail('pending'))) // first poll
      .mockImplementation(() => ok(detail('done'))); // second poll, then anything
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMeeting('pricing'));
    await vi.waitFor(() => expect(result.current.meeting?.extractionStatus).toBe('pending'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.meeting?.extractionStatus).toBe('pending');

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await vi.waitFor(() => expect(result.current.meeting?.extractionStatus).toBe('done'));
    const callsWhenDone = fetchMock.mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(callsWhenDone); // no further polls
  });

  it('does not poll a meeting that is not pending', async () => {
    const fetchMock = vi.fn().mockImplementation(() => ok(detail('skipped')));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useMeeting('pricing'));
    await vi.waitFor(() => expect(result.current.meeting).not.toBeNull());
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a 404 as notFound rather than an error', async () => {
    const body = { error: { code: 'NOT_FOUND', message: 'Meeting not found', requestId: 'r' } };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status: 404 }))));
    const { result } = renderHook(() => useMeeting('nope'));
    await vi.waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.error).toBeNull();
  });
});
