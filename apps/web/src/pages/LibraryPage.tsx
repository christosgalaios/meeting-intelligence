import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { seedSamples } from '../api/client';
import { useApp } from '../AppContext';
import { IconSearch } from '../components/icons';
import { MeetingList } from '../components/MeetingList';
import { UploadDropzone } from '../components/UploadDropzone';
import { btnPrimary, ButtonHint } from '../components/ui';
import { cx } from '../lib/cx';
import { formatDuration, plural } from '../lib/format';

export function LibraryPage() {
  const { meetings, meetingsLoading, reloadMeetings, mode, ask, setScope, askCost } = useApp();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const empty = !meetingsLoading && meetings.length === 0;

  // The library asks across every meeting. The list refreshes while an extraction is still running.
  const anyPending = meetings.some((m) => m.extractionStatus === 'pending');
  useEffect(() => {
    if (!anyPending) return;
    const t = setInterval(reloadMeetings, 2000);
    return () => clearInterval(t);
  }, [anyPending, reloadMeetings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (e.key !== '/' || tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ask.busy || !question.trim()) return;
    setScope(null);
    if (ask.start(question, undefined, meetings.length)) {
      setQuestion('');
      navigate('/ask');
    }
  };

  const loadSamples = async () => {
    setLoadingSamples(true);
    setSampleError(null);
    try {
      await seedSamples();
      reloadMeetings();
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : 'Could not load the samples.');
    } finally {
      setLoadingSamples(false);
    }
  };

  const totalSeconds = meetings.reduce((n, m) => n + m.durationSeconds, 0);
  const summary = meetingsLoading
    ? 'Loading…'
    : empty
      ? 'Nothing here yet'
      : `${plural(meetings.length, 'meeting')} · ${formatDuration(totalSeconds)} of transcript`;

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-[clamp(20px,4vw,48px)] pb-16 pt-9">
        <div>
          <h1 className="m-0 text-[22px] font-semibold tracking-[-0.015em]">Library</h1>
          <p className="m-0 mt-1 text-[13.5px] text-fg-2">{summary}</p>
        </div>

        <form
          data-askbar=""
          onSubmit={submit}
          className={cx(
            'flex items-center gap-2.5 rounded-lg border border-line-strong bg-surface py-1.5 pl-3.5 pr-1.5 shadow-card',
            empty && 'opacity-60',
          )}
        >
          <span className="text-fg-3">
            <IconSearch />
          </span>
          <input
            ref={input}
            aria-label="Ask across all meetings"
            placeholder={empty ? 'Add a meeting to start asking' : `Ask across all ${meetings.length} meetings…`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={empty || meetingsLoading}
            className="min-w-0 flex-1 border-0 bg-transparent py-[9px] text-[15px]"
          />
          <kbd className="rounded-sm border border-line px-1.5 py-px font-mono text-[11px] text-fg-3">/</kbd>
          <button type="submit" disabled={empty || meetingsLoading || !question.trim() || ask.busy || mode === null} className={`${btnPrimary} h-[34px] text-[13.5px]`}>
            {mode === 'retrieval-only' ? 'Search' : 'Ask'}
            {askCost && <ButtonHint>{askCost}</ButtonHint>}
          </button>
        </form>

        <UploadDropzone onUploaded={reloadMeetings} />

        {empty && (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface-2 p-10">
            <h2 className="m-0 text-[17px] font-semibold">No meetings yet</h2>
            <p className="m-0 max-w-[520px] text-pretty text-fg-2">
              Upload a transcript to start. One speaker turn per line, each with a timestamp. Searching runs on your own API and costs nothing; a written answer
              needs an Anthropic key. Or explore with the sample meetings: no model is called to load them.
            </p>
            <button type="button" onClick={() => void loadSamples()} disabled={loadingSamples} className={btnPrimary}>
              {loadingSamples ? 'Loading samples…' : 'Load sample meetings'}
            </button>
            {sampleError && (
              <p role="alert" className="m-0 text-[13px] text-danger">
                {sampleError}
              </p>
            )}
          </div>
        )}

        {meetings.length > 0 && (
          <>
            <div className="mt-2 flex items-baseline justify-between">
              <h2 className="m-0 text-[13px] font-medium text-fg-2">Meetings</h2>
              <span className="text-xs text-fg-3">Newest first</span>
            </div>
            <div className="-mt-3">
              <MeetingList meetings={meetings} mode={mode} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
