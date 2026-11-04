import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Health, MeetingSummary } from './api/types';
import { useAsk, type AskController } from './hooks/useAsk';
import { useHealth } from './hooks/useHealth';
import { useMeetings } from './hooks/useMeetings';
import { estimateAskCost, formatHint } from './lib/cost';
import { plural } from './lib/format';

export interface AppState {
  health: Health | null;
  unreachable: boolean;
  /** retrieval-only until the API says otherwise is wrong in both directions, so null until /health has answered. */
  mode: Health['mode'] | null;
  meetings: MeetingSummary[];
  meetingsLoading: boolean;
  reloadMeetings(): void;
  titleOf(meetingId: string): string | undefined;
  ask: AskController;
  /** Meetings an ask searches. null = all. */
  scope: string[] | null;
  setScope(scope: string[] | null): void;
  /** The text to show next to the ask button: "~$0.01" in full mode, "free" in retrieval-only mode. */
  askCost: string | null;
  scopeSummary: string;
  /** Run an ask over the current scope. */
  submitAsk(question: string): boolean;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { health, unreachable } = useHealth();
  const { meetings, loading, reload } = useMeetings();
  const ask = useAsk();
  const [scope, setScope] = useState<string[] | null>(null);

  // A meeting that no longer exists cannot stay in the scope.
  useEffect(() => {
    if (scope === null) return;
    const ids = new Set(meetings.map((m) => m.id));
    const kept = scope.filter((id) => ids.has(id));
    if (kept.length !== scope.length) setScope(kept.length > 0 && kept.length < meetings.length ? kept : null);
  }, [meetings, scope]);

  const titles = useMemo(() => new Map(meetings.map((m) => [m.id, m.title])), [meetings]);
  const titleOf = useCallback((id: string) => titles.get(id), [titles]);

  const mode = health?.mode ?? null;
  const scopeCount = scope?.length ?? meetings.length;
  const cost = mode === 'full' ? estimateAskCost(health?.models.answer ?? null) : null;
  const askCost = mode === 'retrieval-only' ? 'free' : cost !== null ? formatHint(cost) : null;
  const scopeSummary = `Searching ${scope === null && meetings.length > 1 ? 'all ' : ''}${plural(scopeCount, 'meeting')}${
    mode === 'retrieval-only' ? ' · no key, moments only' : ''
  }`;

  const submitAsk = useCallback(
    (question: string) => ask.start(question, scope ?? undefined, scopeCount),
    [ask.start, scope, scopeCount],
  );

  const value: AppState = {
    health, unreachable, mode, meetings, meetingsLoading: loading, reloadMeetings: reload, titleOf,
    ask, scope, setScope, askCost, scopeSummary, submitAsk,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
