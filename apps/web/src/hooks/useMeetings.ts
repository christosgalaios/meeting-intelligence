import { useCallback, useEffect, useState } from 'react';
import { listMeetings } from '../api/client';
import type { MeetingSummary } from '../api/types';

export interface MeetingsState {
  meetings: MeetingSummary[];
  loading: boolean;
  error: string | null;
  reload(): void;
}

export function useMeetings(): MeetingsState {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listMeetings(controller.signal)
      .then((list) => {
        setMeetings(list);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load meetings.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { meetings, loading, error, reload };
}
