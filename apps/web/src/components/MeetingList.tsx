import { Link } from 'react-router-dom';
import type { ExtractionStatus, MeetingSummary, Mode } from '../api/types';
import { formatDate, formatDuration } from '../lib/format';
import { initials, speakerColor } from '../lib/speakers';
import { IconLock } from './icons';

function ExtractionLine({ status, mode }: { status: ExtractionStatus; mode: Mode | null }) {
  switch (status) {
    case 'done':
      return <span>Decisions and action items extracted</span>;
    case 'pending':
      return <span className="text-fg-2">Extracting&hellip;</span>;
    case 'failed':
      return <span className="text-danger">Extraction failed</span>;
    case 'skipped':
      return mode === 'retrieval-only' ? (
        <span className="flex items-center gap-1.5 text-fg-3">
          <IconLock size={12} />
          Extraction needs a key
        </span>
      ) : (
        <span className="text-fg-3">Not extracted yet</span>
      );
  }
}

export function MeetingList({ meetings, mode }: { meetings: readonly MeetingSummary[]; mode: Mode | null }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3 p-0">
      {meetings.map((m) => (
        <li key={m.id}>
          <Link
            to={`/meetings/${m.slug}`}
            className="flex h-full flex-col gap-3.5 rounded-lg border border-line bg-surface p-4 text-left text-fg no-underline shadow-card hover:border-line-strong hover:bg-surface-2 hover:text-fg"
          >
            <div className="flex w-full flex-col gap-1">
              <span className="min-w-0 text-[15px] font-semibold tracking-[-0.01em]">{m.title}</span>
              <span className="font-mono text-xs text-fg-3">
                {formatDate(m.createdAt)} · {formatDuration(m.durationSeconds)} · {m.turnCount} turns
              </span>
            </div>
            <div className="flex gap-1" aria-label={`Speakers: ${m.speakers.join(', ')}`}>
              {m.speakers.slice(0, 6).map((s) => (
                <span
                  key={s}
                  title={s}
                  className="grid size-[26px] place-items-center rounded-full border-[1.5px] bg-surface text-[10.5px] font-semibold"
                  style={{ borderColor: speakerColor(s, m.speakers), color: speakerColor(s, m.speakers) }}
                >
                  {initials(s)}
                </span>
              ))}
              {m.speakers.length > 6 && <span className="grid size-[26px] place-items-center text-[11px] text-fg-3">+{m.speakers.length - 6}</span>}
            </div>
            <div className="mt-auto flex w-full gap-3.5 border-t border-line pt-3 text-[12.5px] text-fg-2">
              <ExtractionLine status={m.extractionStatus} mode={mode} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
