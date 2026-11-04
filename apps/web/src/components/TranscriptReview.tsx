import { useEffect, useState } from 'react';
import { deleteTranscription, uploadMeeting } from '../api/client';
import type { MeetingDetail, Transcription } from '../api/types';
import { friendly } from '../lib/friendly';
import { plural } from '../lib/format';
import { speakerColor } from '../lib/speakers';
import {
  draftFilename, hasClearedName, isoDate, mergeSpeakers, newDraft, renameSpeaker, renderTranscript, speakerLabel,
  speakerNumbers, timestampLabel, turnCount, withNewSegments, type Draft,
} from '../lib/transcriptDraft';
import { btnGhost, btnPrimary, btnSecondary } from './ui';

const field = 'h-8 w-full rounded-md border border-line bg-surface-2 px-2.5 text-[13px]';

interface Props {
  transcription: Transcription;
  /** True while a re-run is in flight: the draft stays visible but cannot be imported. */
  busy: boolean;
  onRerun(numSpeakers: number): void;
  onImported(meeting: MeetingDetail): void;
  onDiscard(): void;
}

/**
 * The review step. Nothing here reaches the library until Import is clicked: the draft lives in this component and
 * on the API's in-memory job, and the API's own transcript validator still runs on import.
 */
export function TranscriptReview({ transcription, busy, onRerun, onImported, onDiscard }: Props) {
  const [draft, setDraft] = useState<Draft>(() => {
    const date = isoDate(new Date());
    return newDraft(transcription, `Meeting ${date}`, date);
  });
  const [rerunCount, setRerunCount] = useState(String(Math.max(2, transcription.numSpeakers ?? 2)));
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A re-run arrives as a new transcription: new segments, but the title, date and surviving names stay.
  useEffect(() => {
    setDraft((prev) => withNewSegments(prev, transcription));
  }, [transcription]);

  const numbers = speakerNumbers(draft);
  const labels = numbers.map((n) => speakerLabel(draft, n));
  const turns = turnCount(draft);
  const count = Number(rerunCount);
  const countValid = Number.isInteger(count) && count >= 1 && count <= 20;

  const blocked = turns < 2 ? 'A transcript needs at least 2 turns.' : hasClearedName(draft) ? 'Give every speaker a name.' : null;

  const doImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const meeting = await uploadMeeting({
        filename: draftFilename(draft),
        ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
        text: renderTranscript(draft),
      });
      void deleteTranscription(transcription.id).catch(() => undefined);
      onImported(meeting);
    } catch (err) {
      setError(friendly(err));
      setImporting(false);
    }
  };

  const disabled = busy || importing;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line-strong bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="m-0 text-[15px] font-semibold">Review the transcript</h2>
        <span className="text-xs text-fg-3">Nothing is added to the library until you import it.</span>
      </div>

      {/* The preview is the main element: it comes first and gets the room. */}
      <ol aria-label="Transcript preview" className="m-0 max-h-[420px] list-none overflow-auto rounded-md border border-line bg-surface-2 p-1">
        {draft.segments.map((s, i) => (
          <li key={i} className="grid grid-cols-[72px_128px_minmax(0,1fr)] gap-x-3 px-3 py-2">
            <span className="font-mono text-xs text-accent">{timestampLabel(s.start)}</span>
            <span className="text-[13px] font-semibold" style={{ color: speakerColor(speakerLabel(draft, s.speaker), labels) }}>
              {speakerLabel(draft, s.speaker)}
            </span>
            <span className="text-pretty text-[13.5px] leading-[1.6]">{s.text}</span>
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <label className="flex flex-col gap-1 text-xs text-fg-2">
          Title
          <input value={draft.title} maxLength={200} disabled={disabled} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-2">
          Date
          <input type="date" value={draft.date ?? ''} disabled={disabled} onChange={(e) => setDraft({ ...draft, date: e.target.value || null })} className={field} />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs text-fg-2">Speakers</div>
        {numbers.map((n) => {
          const others = numbers.filter((m) => m !== n);
          return (
            <div key={n} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
              <input
                aria-label={`Name for speaker ${n}`}
                value={draft.speakerNames[n] ?? ''}
                placeholder={`Speaker ${n}`}
                disabled={disabled}
                onChange={(e) => setDraft(renameSpeaker(draft, n, e.target.value))}
                className={field}
              />
              {others.length > 0 && (
                <select
                  aria-label={`Merge speaker ${n} into`}
                  value=""
                  disabled={disabled}
                  onChange={(e) => e.target.value && setDraft(mergeSpeakers(draft, n, Number(e.target.value)))}
                  className={field}
                >
                  <option value="">Merge into…</option>
                  {others.map((m) => (
                    <option key={m} value={m}>
                      {speakerLabel(draft, m)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
        <label htmlFor="mi-rerun-count">Wrong number of speakers?</label>
        <input
          id="mi-rerun-count"
          type="number"
          min={1}
          max={20}
          value={rerunCount}
          disabled={disabled}
          onChange={(e) => setRerunCount(e.target.value)}
          className={`${field} !w-16`}
        />
        <button type="button" disabled={disabled || !countValid} onClick={() => onRerun(count)} className={btnSecondary}>
          Re-run with {countValid ? plural(count, 'speaker') : 'N speakers'}
        </button>
      </div>

      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled || blocked !== null} onClick={() => void doImport()} className={btnPrimary}>
          {importing ? 'Importing…' : 'Import'}
        </button>
        <button type="button" disabled={importing} onClick={onDiscard} className={btnGhost}>
          Discard
        </button>
        <span className="flex-1" />
        <span className="text-xs text-fg-3">
          {blocked ?? `${plural(turns, 'turn')} · ${plural(numbers.length, 'speaker')}`}
        </span>
      </div>
    </div>
  );
}
