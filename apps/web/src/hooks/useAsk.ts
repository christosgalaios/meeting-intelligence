import { useCallback, useEffect, useReducer, useRef } from 'react';
import { ApiClientError, askStream } from '../api/client';
import type { AskEvent, Mode, RankedChunk, SourceTurn } from '../api/types';
import { errorRef } from '../lib/friendly';

export type ExchangeStatus = 'searching' | 'thinking' | 'streaming' | 'done' | 'error';
export type DoneEvent = Extract<AskEvent, { type: 'done' }>;

export interface Exchange {
  id: string;
  question: string;
  scopeCount: number;
  askedAt: string;
  status: ExchangeStatus;
  traceId: string | null;
  mode: Mode | null;
  model: string | null;
  chunks: RankedChunk[];
  turns: SourceTurn[];
  /** Streamed text so far; replaced by the final answer on `done`. */
  answer: string;
  refusal: { topVectorScore: number | null } | null;
  done: DoneEvent | null;
  /** `ref` is what to quote to find the log line: the request id for a failure before the stream, the trace id after it. */
  error: { code: string; message: string; ref: string | null } | null;
}

type Action =
  | { type: 'start'; exchange: Exchange }
  | { type: 'event'; id: string; event: AskEvent }
  | { type: 'failed'; id: string; code: string; message: string; ref: string | null }
  | { type: 'reset' };

export function applyEvent(ex: Exchange, event: AskEvent): Exchange {
  switch (event.type) {
    case 'meta':
      return { ...ex, traceId: event.traceId, mode: event.mode, model: event.model };
    case 'sources':
      // Full mode now waits on the model, which is silent while it thinks (spec 6.4).
      return { ...ex, chunks: event.chunks, turns: event.turns, status: ex.mode === 'full' ? 'thinking' : ex.status };
    case 'refusal':
      return { ...ex, refusal: { topVectorScore: event.topVectorScore } };
    case 'token':
      return { ...ex, answer: ex.answer + event.text, status: 'streaming' };
    case 'done':
      return { ...ex, done: event, answer: event.answer ?? ex.answer, status: 'done' };
    case 'error':
      return { ...ex, error: { code: event.code, message: event.message, ref: ex.traceId }, status: 'error' };
  }
}

function reducer(state: Exchange[], action: Action): Exchange[] {
  switch (action.type) {
    case 'start':
      return [...state, action.exchange];
    case 'event':
      return state.map((ex) => (ex.id === action.id ? applyEvent(ex, action.event) : ex));
    case 'failed':
      return state.map((ex) =>
        ex.id === action.id && ex.status !== 'done'
          ? { ...ex, status: 'error', error: { code: action.code, message: action.message, ref: action.ref } }
          : ex,
      );
    case 'reset':
      return [];
  }
}

export const isBusy = (ex: Exchange | undefined): boolean =>
  ex !== undefined && (ex.status === 'searching' || ex.status === 'thinking' || ex.status === 'streaming');

export interface AskController {
  exchanges: Exchange[];
  busy: boolean;
  /** meetingIds undefined = all meetings. Returns false when an ask is already running. */
  start(question: string, meetingIds: string[] | undefined, scopeCount: number): boolean;
  reset(): void;
}

let counter = 0;
const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function useAsk(): AskController {
  const [exchanges, dispatch] = useReducer(reducer, []);
  const controllerRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = useCallback((question: string, meetingIds: string[] | undefined, scopeCount: number) => {
    const q = question.trim();
    if (!q || busyRef.current) return false;
    busyRef.current = true;
    const id = `ask-${Date.now()}-${counter++}`;
    dispatch({
      type: 'start',
      exchange: {
        id, question: q, scopeCount, askedAt: clock(new Date()), status: 'searching', traceId: null, mode: null, model: null,
        chunks: [], turns: [], answer: '', refusal: null, done: null, error: null,
      },
    });
    const controller = new AbortController();
    controllerRef.current = controller;
    askStream(q, meetingIds, { onEvent: (event) => dispatch({ type: 'event', id, event }) }, controller.signal)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const code = err instanceof ApiClientError ? err.code : 'NETWORK';
        const message = err instanceof Error ? err.message : 'The question could not be sent.';
        dispatch({ type: 'failed', id, code, message, ref: errorRef(err) });
      })
      .finally(() => {
        busyRef.current = false;
      });
    return true;
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    busyRef.current = false;
    dispatch({ type: 'reset' });
  }, []);

  return { exchanges, busy: isBusy(exchanges[exchanges.length - 1]), start, reset };
}
