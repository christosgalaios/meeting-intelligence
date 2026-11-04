import { useEffect, useState } from 'react';
import { getHealth } from '../api/client';
import type { Health } from '../api/types';

export interface HealthState {
  health: Health | null;
  /** True when the last request failed: the API is down or still starting. */
  unreachable: boolean;
}

const RETRY_MS = 3000;

/** Fetched once at load, as the spec says. It keeps retrying only while the API is unreachable or still warming up. */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ health: null, unreachable: false });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      getHealth(controller.signal)
        .then((health) => {
          setState({ health, unreachable: false });
          if (health.status !== 'ok' || !health.embeddings.ready) timer = setTimeout(load, RETRY_MS);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setState((s) => ({ health: s.health, unreachable: true }));
          timer = setTimeout(load, RETRY_MS);
        });
    };
    load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return state;
}
