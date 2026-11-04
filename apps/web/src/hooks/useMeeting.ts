import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, getMeeting } from '../api/client';
import type { MeetingDetail } from '../api/types';
import { errorRef } from '../lib/friendly';

export const POLL_MS = 2000;

export interface MeetingState {
  meeting: MeetingDetail | null;
  loading: boolean;
  error: string | null;
  /** The API's request id for the failed load, to quote when reporting it. */
  errorRef: string | null;
  notFound: boolean;
  /** Replace the cached detail, e.g. with the pending meeting returned by the extract call. */
  set(detail: MeetingDetail): void;
}

/** Loads one meeting by id or slug and polls every 2 s while its extraction is pending. */
export function useMeeting(id: string | null): MeetingState {
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(id !== null);
  const [error, setError] = useState<string | null>(null);
  const [failureRef, setFailureRef] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setMeeting(null);
    setError(null);
    setFailureRef(null);
    setNotFound(false);
    setLoading(id !== null);
    if (id === null) return;
    const controller = new AbortController();
    getMeeting(id, controller.signal)
      .then(setMeeting)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiClientError && err.code === 'NOT_FOUND') setNotFound(true);
        else {
          setError(err instanceof Error ? err.message : 'Could not load the meeting.');
          setFailureRef(errorRef(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  const pending = meeting?.extractionStatus === 'pending';
  const meetingKey = meeting?.id ?? null;
  useEffect(() => {
    if (!pending || meetingKey === null) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      getMeeting(meetingKey, controller.signal)
        .then(setMeeting)
        .catch(() => undefined); // a missed poll is retried on the next tick
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [pending, meetingKey]);

  const set = useCallback((detail: MeetingDetail) => setMeeting(detail), []);
  return { meeting, loading, error, errorRef: failureRef, notFound, set };
}
