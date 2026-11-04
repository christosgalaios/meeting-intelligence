import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError, deleteTranscription, getTranscription, startTranscription } from '../api/client';
import type { Transcription } from '../api/types';
import { errorRef } from '../lib/friendly';

export type TranscriptionState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'queued'; position: number }
  | { phase: 'running'; stage: Transcription['stage'] }
  | { phase: 'done'; transcription: Transcription }
  | { phase: 'error'; message: string; ref: string | null };

export interface TranscriptionController {
  state: TranscriptionState;
  /** Uploads the decoded WAV and polls until the draft is ready or the job fails. */
  start(wav: Blob, numSpeakers?: number): void;
  /** Same audio, new speaker count. Uses the WAV the hook already holds, so nothing is decoded again. */
  rerun(numSpeakers: number): void;
  /** Same audio, same speaker count: the one-click retry after an error. */
  retry(): void;
  /** Stops polling and frees the finished draft on the API. */
  reset(): void;
}

const RESTARTED = 'The API restarted while transcribing. Try again.';

export function useTranscription(pollMs = 1500): TranscriptionController {
  const [state, setState] = useState<TranscriptionState>({ phase: 'idle' });
  const wav = useRef<{ blob: Blob; numSpeakers: number | undefined } | null>(null);
  const run = useRef(0); // bumped to abandon the previous poll loop
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const lastId = useRef<string | null>(null);

  const stop = useCallback(() => {
    run.current++;
    clearTimeout(timer.current);
    abort.current?.abort();
  }, []);

  const apply = useCallback((t: Transcription): boolean => {
    if (t.status === 'done') {
      lastId.current = t.id;
      setState({ phase: 'done', transcription: t });
      return true;
    }
    if (t.status === 'failed') {
      setState({ phase: 'error', message: t.error ?? 'Transcription failed.', ref: null });
      return true;
    }
    setState(t.status === 'queued' ? { phase: 'queued', position: t.queuePosition ?? 1 } : { phase: 'running', stage: t.stage });
    return false;
  }, []);

  const start = useCallback((blob: Blob, numSpeakers?: number) => {
    stop();
    const mine = run.current;
    wav.current = { blob, numSpeakers };
    setState({ phase: 'uploading' });

    const poll = (id: string) => {
      timer.current = setTimeout(() => {
        const controller = new AbortController();
        abort.current = controller;
        getTranscription(id, controller.signal)
          .then((t) => {
            if (run.current !== mine) return;
            if (!apply(t)) poll(id);
          })
          .catch((err: unknown) => {
            if (run.current !== mine || (err instanceof DOMException && err.name === 'AbortError')) return;
            setState({ phase: 'error', message: err instanceof ApiClientError && err.code === 'NOT_FOUND' ? RESTARTED : errorMessage(err), ref: errorRef(err) });
          });
      }, pollMs);
    };

    startTranscription(blob, numSpeakers)
      .then((t) => {
        if (run.current !== mine) return;
        if (!apply(t)) poll(t.id);
      })
      .catch((err: unknown) => {
        if (run.current !== mine) return;
        setState({ phase: 'error', message: errorMessage(err), ref: errorRef(err) });
      });
  }, [apply, pollMs, stop]);

  const rerun = useCallback((numSpeakers: number) => {
    if (wav.current) start(wav.current.blob, numSpeakers);
  }, [start]);

  const retry = useCallback(() => {
    if (wav.current) start(wav.current.blob, wav.current.numSpeakers);
  }, [start]);

  const reset = useCallback(() => {
    stop();
    if (lastId.current) void deleteTranscription(lastId.current).catch(() => undefined);
    lastId.current = null;
    wav.current = null;
    setState({ phase: 'idle' });
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { state, start, rerun, retry, reset };
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'TOO_LARGE') return 'That recording is too large. The limit is 30 minutes.';
    if (err.code === 'NETWORK') return 'Could not reach the API. Is it running?';
    return err.message;
  }
  return 'Something went wrong while transcribing.';
}
