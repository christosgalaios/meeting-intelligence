import { useEffect, useRef, useState } from 'react';
import type { MeetingDetail, Transcription } from '../api/types';
import { useTranscription, type TranscriptionState } from '../hooks/useTranscription';
import { decodeToWav16k, AudioTooLong, AudioUndecodable, MAX_AUDIO_SECONDS } from '../lib/audio';
import { TranscriptReview } from './TranscriptReview';
import { btnGhost, btnSecondary, ErrorRef } from './ui';

export const VOICE_NOTE = `English audio, up to ${MAX_AUDIO_SECONDS / 60} minutes. It runs on your own API: the recording is not stored and nothing leaves your machine.`;

interface Props {
  file: File;
  onImported(meeting: MeetingDetail): void;
  onCancel(): void;
  /** Full mode only: the import triggers a paid extraction. */
  importHint?: string | null;
  /** Poll interval in ms; tests shorten it. */
  pollMs?: number;
}

function progressText(state: TranscriptionState): string | null {
  switch (state.phase) {
    case 'uploading':
      return 'Uploading the recording…';
    case 'queued':
      return state.position > 1 ? `Queued, ${state.position - 1} ahead` : 'Queued. Starting shortly.';
    case 'running':
      if (state.stage?.name === 'transcribing') return `Transcribing ${Math.min(state.stage.done + 1, state.stage.total)} of ${state.stage.total} segments`;
      if (state.stage?.name === 'diarizing') return 'Finding who is speaking…';
      return 'Starting. The first recording also loads the models, which takes a few seconds.';
    default:
      return null;
  }
}

/** Decode in the browser, upload, wait, then review. Owns everything between "audio chosen" and "imported". */
export function VoiceImport({ file, onImported, onCancel, importHint, pollMs }: Props) {
  const tx = useTranscription(pollMs);
  const [decoding, setDecoding] = useState(true);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  // The last finished draft stays on screen while a re-run is in flight, so edits are not lost.
  const [reviewing, setReviewing] = useState<Transcription | null>(null);
  const started = useRef(false);

  const { start } = tx;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    decodeToWav16k(file).then(
      ({ blob }) => {
        setDecoding(false);
        start(blob);
      },
      (err: unknown) => {
        setDecoding(false);
        setDecodeError(err instanceof AudioTooLong || err instanceof AudioUndecodable ? err.message : 'Could not read that audio file.');
      },
    );
  }, [file, start]);

  useEffect(() => {
    if (tx.state.phase === 'done') setReviewing(tx.state.transcription);
  }, [tx.state]);

  const text = decoding ? `Decoding ${file.name}…` : progressText(tx.state);
  const inFlight = text !== null;
  const failure = decodeError ?? (tx.state.phase === 'error' ? tx.state.message : null);
  const failureRef = tx.state.phase === 'error' ? tx.state.ref : null;

  return (
    <div className="flex flex-col gap-3">
      {inFlight && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg bg-accent-soft px-3.5 py-2.5 text-[13px] text-accent-soft-fg">
          <span className="flex-1">{text}</span>
          {!reviewing && (
            <button type="button" onClick={() => { tx.reset(); onCancel(); }} className={btnGhost}>
              Cancel
            </button>
          )}
        </div>
      )}

      {failure && (
        <div role="alert" className="flex flex-col overflow-hidden rounded-lg border border-danger bg-surface">
          <div className="flex flex-col gap-0.5 bg-danger-soft px-4 py-3.5">
            <div className="font-semibold text-danger">{file.name} could not be transcribed</div>
            <div className="text-[13px] text-fg-2">{failure}</div>
            <ErrorRef id={decodeError ? null : failureRef} />
          </div>
          <div className="flex gap-2 px-4 py-3">
            {!decodeError && (
              <button type="button" onClick={tx.retry} className={btnSecondary}>
                Try again
              </button>
            )}
            <button type="button" onClick={() => { tx.reset(); onCancel(); }} className={btnGhost}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {reviewing && (
        <TranscriptReview
          transcription={reviewing}
          busy={inFlight}
          importHint={importHint ?? null}
          onRerun={tx.rerun}
          onImported={(meeting) => {
            tx.reset();
            onImported(meeting);
          }}
          onDiscard={() => {
            tx.reset();
            onCancel();
          }}
        />
      )}

      {!reviewing && <p className="m-0 text-xs text-fg-3">{VOICE_NOTE}</p>}
    </div>
  );
}
