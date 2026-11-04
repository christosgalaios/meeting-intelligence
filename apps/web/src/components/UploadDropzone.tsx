import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { uploadMeeting } from '../api/client';
import type { MeetingDetail } from '../api/types';
import { cx } from '../lib/cx';
import { errorRef, friendly } from '../lib/friendly';
import { btnGhost, btnPrimary, btnSecondary, ErrorRef } from './ui';
import { VoiceImport } from './VoiceImport';

export const MAX_BYTES = 2_000_000;
const PLACEHOLDER = '[00:00:12] Priya Raman: Okay, let’s start.';

type State =
  | { kind: 'idle' }
  | { kind: 'paste' }
  | { kind: 'parsing'; name: string }
  | { kind: 'voice'; file: File }
  | { kind: 'error'; title: string; message: string; ref: string | null }
  | { kind: 'done'; meeting: MeetingDetail };

/** Returns an error message when the file cannot be uploaded, otherwise null. Checked before any request. */
export function rejectFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') return 'Only plain-text .txt files can be imported.';
  if (file.size > MAX_BYTES) return 'That file is over 2 MB.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/** `voiceAvailable`: true shows the audio button, false shows a one-line hint, undefined (health not loaded yet) shows neither. */
export function UploadDropzone({ onUploaded, voiceAvailable, importHint }: { onUploaded: (meeting: MeetingDetail) => void; voiceAvailable?: boolean; importHint?: string | null }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [drag, setDrag] = useState(false);
  const [pasted, setPasted] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const send = async (filename: string, text: string, title: string) => {
    setState({ kind: 'parsing', name: title });
    try {
      const meeting = await uploadMeeting({ filename, text });
      setState({ kind: 'done', meeting });
      setPasted('');
      onUploaded(meeting);
    } catch (err) {
      setState({ kind: 'error', title, message: friendly(err), ref: errorRef(err) });
    }
  };

  const handleFile = async (file: File) => {
    if (voiceAvailable && file.type.startsWith('audio/')) {
      setState({ kind: 'voice', file });
      return;
    }
    const reason = rejectFile(file);
    if (reason) {
      setState({ kind: 'error', title: file.name, message: reason, ref: null });
      return;
    }
    await send(file.name, await file.text(), file.name);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const cancel = () => setState({ kind: 'idle' });
  const busy = state.kind === 'parsing' || state.kind === 'voice';

  return (
    <div className="flex flex-col gap-3">
      {(state.kind === 'idle' || state.kind === 'done' || state.kind === 'parsing' || state.kind === 'voice') && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!drag) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cx(
            'flex flex-wrap items-center justify-between gap-4 rounded-lg border border-dashed px-5 py-[18px]',
            drag ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2',
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <div className="font-medium">Add a transcript</div>
            <div className="text-[13px] text-fg-2">
              Drop a .txt file, paste text{voiceAvailable ? ', or transcribe audio' : ''}. One turn per line, like{' '}
              <code className="rounded-sm bg-surface-2 px-[5px] py-px font-mono text-xs text-fg">[00:12:04] Priya Raman: Then let&rsquo;s decide it.</code>
            </div>
            {importHint && <div className="text-xs text-fg-3">{importHint}</div>}
            {voiceAvailable === false && (
              <div className="text-xs text-fg-3">Audio transcription is not available on this API: it has no voice models installed.</div>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => setState({ kind: 'paste' })} className={btnSecondary}>
              Paste text
            </button>
            <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={btnSecondary}>
              Choose file
            </button>
            {voiceAvailable && (
              <>
                <button type="button" disabled={busy} onClick={() => audioInput.current?.click()} className={btnSecondary}>
                  Transcribe audio
                </button>
                <input
                  ref={audioInput}
                  type="file"
                  accept="audio/*"
                  aria-label="Audio file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) setState({ kind: 'voice', file: f });
                  }}
                />
              </>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".txt,text/plain"
              aria-label="Transcript file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handleFile(f);
              }}
            />
          </div>
        </div>
      )}

      {state.kind === 'paste' && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-line-strong bg-surface p-4">
          <label htmlFor="mi-paste" className="font-medium">
            Paste a transcript
          </label>
          <textarea
            id="mi-paste"
            rows={9}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={PLACEHOLDER}
            className="w-full resize-y rounded-md border border-line bg-surface-2 px-3 py-2.5 font-mono text-[12.5px] leading-[1.6]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pasted.trim() === ''} onClick={() => void send('pasted-transcript.txt', pasted, 'Pasted transcript')} className={btnPrimary}>
              Import
            </button>
            <button type="button" onClick={cancel} className={btnGhost}>
              Cancel
            </button>
            <span className="flex-1" />
            <span className="text-xs text-fg-3">Parsing runs on your own API. Nothing is sent to an AI model.</span>
          </div>
        </div>
      )}

      {state.kind === 'voice' && (
        <VoiceImport
          file={state.file}
          importHint={importHint ?? null}
          onCancel={cancel}
          onImported={(meeting) => {
            setState({ kind: 'done', meeting });
            onUploaded(meeting);
          }}
        />
      )}

      {state.kind === 'parsing' && (
        <div role="status" className="rounded-lg bg-accent-soft px-3.5 py-2.5 text-[13px] text-accent-soft-fg">
          Parsing and embedding &ldquo;{state.name}&rdquo;. A long transcript can take half a minute.
        </div>
      )}

      {state.kind === 'error' && (
        <div role="alert" className="flex flex-col overflow-hidden rounded-lg border border-danger bg-surface">
          <div className="flex flex-col gap-0.5 bg-danger-soft px-4 py-3.5">
            <div className="font-semibold text-danger">{state.title} could not be imported</div>
            <div className="text-[13px] text-fg-2">{state.message}</div>
            <ErrorRef id={state.ref} />
          </div>
          <div className="flex gap-2 px-4 py-3">
            <button type="button" onClick={() => setState({ kind: 'paste' })} className={btnSecondary}>
              Paste text instead
            </button>
            <button type="button" onClick={cancel} className={btnGhost}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {state.kind === 'done' && (
        <div role="status" className="flex items-center gap-3 rounded-lg bg-ok-soft px-3.5 py-2.5 text-[13px] text-ok">
          <span className="flex-1">
            Imported &ldquo;{state.meeting.title}&rdquo; &middot; {state.meeting.turnCount} turns.{' '}
            <Link to={`/meetings/${state.meeting.slug}`} className="font-medium text-ok underline">
              Open
            </Link>
          </span>
          <button type="button" onClick={cancel} className="h-[26px] rounded-md border border-current bg-transparent px-2.5 text-[12.5px]">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
