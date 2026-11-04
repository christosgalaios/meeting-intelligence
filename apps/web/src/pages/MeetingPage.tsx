import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { extractMeeting } from '../api/client';
import { useApp } from '../AppContext';
import { IconSearch } from '../components/icons';
import { MeetingSummaryCard } from '../components/MeetingSummaryCard';
import { TranscriptView, type TurnFocus } from '../components/TranscriptView';
import { btnSecondary } from '../components/ui';
import { useMeeting } from '../hooks/useMeeting';
import { formatDate, formatDuration, plural } from '../lib/format';
import { speakerColor } from '../lib/speakers';
import type { MeetingDetail } from '../api/types';

/** Share of words per speaker. Computed from the transcript, no model involved. */
export function talkShare(meeting: Pick<MeetingDetail, 'turns' | 'speakers'>): Array<{ name: string; words: number; pct: number }> {
  const words = new Map<string, number>();
  for (const t of meeting.turns) words.set(t.speaker, (words.get(t.speaker) ?? 0) + t.text.split(/\s+/).filter(Boolean).length);
  const total = [...words.values()].reduce((a, b) => a + b, 0) || 1;
  return [...words.entries()]
    .map(([name, w]) => ({ name, words: w, pct: Math.round((w / total) * 100) }))
    .sort((a, b) => b.words - a.words);
}

export function MeetingPage() {
  const { id = '' } = useParams();
  const { meeting, loading, error, notFound, set } = useMeeting(id);
  const { health, mode, reloadMeetings, setScope } = useApp();
  const navigate = useNavigate();
  const [focus, setFocus] = useState<TurnFocus | null>(null);

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
        <h1 className="m-0 text-[17px] font-semibold">Meeting not found</h1>
        <p className="m-0 text-fg-2">It may have been removed, or the link is wrong.</p>
        <Link to="/">Back to the library</Link>
      </div>
    );
  }
  if (!meeting) {
    return (
      <div className="flex-1 p-10 text-[13.5px] text-fg-2" role={error ? 'alert' : 'status'}>
        {error ?? (loading ? 'Loading meeting…' : '')}
      </div>
    );
  }

  const jump = (turnId: string) => setFocus((f) => ({ turnId, key: (f?.key ?? 0) + 1 }));
  const talk = talkShare(meeting);
  const extract = async () => {
    const pending = await extractMeeting(meeting.id);
    set(pending);
    reloadMeetings();
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-[clamp(20px,4vw,48px)] pb-[72px] pt-6">
        <div className="flex items-center gap-1.5 text-[13px] text-fg-3">
          <Link to="/" className="-ml-1 rounded-sm px-1 py-0.5 text-fg-2 no-underline hover:bg-surface-2 hover:text-fg">
            Library
          </Link>
          <span aria-hidden="true">/</span>
          <span>{meeting.title}</span>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">{meeting.title}</h1>
            <span className="font-mono text-xs text-fg-3">
              {formatDate(meeting.createdAt)} · {formatDuration(meeting.durationSeconds)} · {plural(meeting.speakers.length, 'speaker')} · {plural(meeting.turnCount, 'turn')}
            </span>
          </div>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => {
              setScope([meeting.id]);
              navigate('/ask');
            }}
          >
            <IconSearch size={14} />
            Ask about this meeting
          </button>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <MeetingSummaryCard meeting={meeting} mode={mode} extractionModel={health?.models.extraction ?? null} onExtract={extract} onJump={jump} />

          <section aria-label="Talk time" className="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5 rounded-lg border border-line bg-surface p-5 shadow-card">
            <div className="flex items-baseline justify-between">
              <h2 className="m-0 text-[13px] font-medium text-fg-2">Talk time</h2>
              <span className="font-mono text-[11px] text-fg-3">by words spoken</span>
            </div>
            <div role="img" aria-label={`Talk time: ${talk.map((t) => `${t.name} ${t.pct}%`).join(', ')}`} className="flex h-2.5 gap-0.5 overflow-hidden rounded-[3px]">
              {talk.map((t) => (
                <span key={t.name} style={{ width: `${t.pct}%`, background: speakerColor(t.name, meeting.speakers) }} />
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {talk.map((t) => (
                <div key={t.name} className="grid grid-cols-[10px_minmax(0,1fr)_64px_40px] items-center gap-2 text-[13px]">
                  <span className="size-2 rounded-full" style={{ background: speakerColor(t.name, meeting.speakers) }} />
                  <span className="truncate">{t.name}</span>
                  <span className="text-right font-mono text-xs text-fg-3">{t.words.toLocaleString('en-GB')} w</span>
                  <span className="text-right font-mono text-xs">{t.pct}%</span>
                </div>
              ))}
            </div>
            <span className="text-[11.5px] text-fg-3">Computed from the transcript. No AI call.</span>
          </section>
        </div>

        <section aria-label="Transcript" className="rounded-lg border border-line bg-surface shadow-card">
          <div className="flex items-baseline justify-between border-b border-line px-5 py-4">
            <h2 className="m-0 text-[13px] font-medium text-fg-2">Transcript</h2>
            <span className="font-mono text-[11.5px] text-fg-3">{plural(meeting.turnCount, 'turn')}</span>
          </div>
          <TranscriptView meeting={meeting} focus={focus} variant="wide" onSelectTurn={jump} />
        </section>
      </div>
    </div>
  );
}
