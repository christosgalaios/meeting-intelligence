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
  /** Full mode only: the import triggers a paid extraction. */
  importHint?: string | null;
  onRerun(numSpeakers: number): void;
  onImported(meeting: MeetingDetail): void;
  onDiscard(): void;
}

/**
 * The review step. Nothing here reaches the library until Import is clicked: the draft lives in this component and
 * on the API's in-memory job, and the API's own transcript validator still runs on import.
 */
export function TranscriptReview({ transcription, busy, importHint, onRerun, onImported, onDiscard }: Props) {
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
    <div className="flex flex-col gap-3 rounded-lg border border-line-strong bg-surface p-4">
      {/* One wrapping row of controls, then the text: reading the transcript is the point of this step. */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs text-fg-2">
          Title
          <input value={draft.title} maxLength={200} disabled={disabled} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={field} />
        </label>
        <label className="flex w-[150px] flex-col gap-1 text-xs text-fg-2">
          Date
          <input type="date" value={draft.date ?? ''} disabled={disabled} onChange={(e) => setDraft({ ...draft, date: e.target.value || null })} className={field} />
        </label>
        {numbers.map((n) => (
          <div key={n} className="flex items-end gap-1">
            <label className="flex w-[130px] flex-col gap-1 text-xs text-fg-2">
              <span style={{ color: speakerColor(speakerLabel(draft, n), labels) }}>Speaker {n}</span>
              <input
                aria-label={`Name for speaker ${n}`}
                value={draft.speakerNames[n] ?? ''}
                placeholder={`Speaker ${n}`}
                disabled={disabled}
                onChange={(e) => setDraft(renameSpeaker(draft, n, e.target.value))}
                className={field}
              />
            </label>
            {numbers.length > 1 && (
              <select
                aria-label={`Merge speaker ${n} into`}
                value=""
                disabled={disabled}
                onChange={(e) => e.target.value && setDraft(mergeSpeakers(draft, n, Number(e.target.value)))}
                className={`${field} !w-[110px]`}
              >
                <option value="">Merge into…</option>
                {numbers.filter((m) => m !== n).map((m) => (
                  <option key={m} value={m}>
                    {speakerLabel(draft, m)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
        <div className="flex items-end gap-2">
          <label htmlFor="mi-rerun-count" className="sr-only">
            Wrong number of speakers?
          </label>
          <input
            id="mi-rerun-count"
            aria-label="Wrong number of speakers?"
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
        <div className="flex items-end gap-2">
          <button type="button" disabled={disabled || blocked !== null} onClick={() => void doImport()} className={btnPrimary}>
            {importing ? 'Importing…' : 'Import'}
          </button>
          <button type="button" disabled={importing} onClick={onDiscard} className={btnGhost}>
            Discard
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 text-xs text-fg-3">
        <span>{blocked ?? `${plural(turns, 'turn')} · ${plural(numbers.length, 'speaker')}`}</span>
        <span>Nothing is added to the library until you import it.</span>
        {importHint && <span>{importHint}</span>}
      </div>

      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}

      <ol aria-label="Transcript preview" className="m-0 max-h-[65vh] min-h-[320px] list-none overflow-auto rounded-md border border-line bg-surface-2 p-1">
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
    </div>
  );
}
