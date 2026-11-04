import { useState } from 'react';
import type { MeetingDetail, Mode } from '../api/types';
import { ApiClientError } from '../api/client';
import { estimateExtractionCost, formatHint } from '../lib/cost';
import { speakerColor } from '../lib/speakers';
import { btnPrimary, ButtonHint, Spinner } from './ui';
import { IconLock } from './icons';

interface Props {
  meeting: MeetingDetail;
  mode: Mode | null;
  extractionModel: string | null;
  /** Starts the user-requested extraction. Resolves with the pending meeting. */
  onExtract: () => Promise<void>;
  onJump: (turnId: string) => void;
}

function SourceButton({ meeting, turnId, onJump, task }: { meeting: MeetingDetail; turnId: string | null; onJump: (id: string) => void; task: string }) {
  const turn = turnId ? meeting.turns.find((t) => t.id === turnId) : undefined;
  if (!turn) return <span className="font-mono text-xs text-fg-3">–</span>;
  return (
    <button
      type="button"
      onClick={() => onJump(turn.id)}
      aria-label={`Source for ${task}: ${turn.timestampLabel}`}
      className="h-[22px] rounded-[5px] border border-line-strong bg-surface px-[7px] font-mono text-[11.5px] text-accent hover:border-accent"
    >
      {turn.timestampLabel}
    </button>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-start gap-2.5 px-6 py-7">{children}</div>;
}

export function MeetingSummaryCard({ meeting, mode, extractionModel, onExtract, onJump }: Props) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const status = meeting.extractionStatus;
  const hint = (() => {
    const usd = estimateExtractionCost(extractionModel, meeting);
    return usd === null ? null : formatHint(usd);
  })();

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      await onExtract();
    } catch (err) {
      setStartError(err instanceof ApiClientError ? err.message : 'Extraction could not be started.');
    } finally {
      setStarting(false);
    }
  };

  const extractButton = (label: string) => (
    <button type="button" onClick={() => void start()} disabled={starting} className={`${btnPrimary} mt-1`}>
      {starting ? 'Starting…' : label}
      {hint && <ButtonHint>{hint}</ButtonHint>}
    </button>
  );

  let body: React.ReactNode;

  if (status === 'pending') {
    body = (
      <Frame>
        <h2 className="m-0 text-base font-semibold">Extracting decisions and action items</h2>
        <p className="m-0 max-w-[480px] text-[13.5px] text-fg-2">This takes a few seconds. The page updates when it finishes.</p>
        <Spinner label="Reading the transcript" />
      </Frame>
    );
  } else if (status === 'failed') {
    body = (
      <Frame>
        <h2 className="m-0 text-base font-semibold text-danger">Extraction failed</h2>
        <p role="alert" className="m-0 max-w-[480px] text-[13.5px] text-fg-2">
          {meeting.extractionError ?? 'The model did not return a usable result.'}
        </p>
        {mode === 'full' && extractButton('Try again')}
        {startError && <p role="alert" className="m-0 text-[13px] text-danger">{startError}</p>}
      </Frame>
    );
  } else if (status === 'skipped') {
    body =
      mode === 'full' ? (
        <Frame>
          <h2 className="m-0 text-base font-semibold">Not extracted yet</h2>
          <p className="m-0 max-w-[480px] text-[13.5px] text-fg-2">
            Pull out the decisions and action items, each linked to its source moment. It runs once, when you start it.
          </p>
          {extractButton('Extract decisions and actions')}
          {startError && <p role="alert" className="m-0 text-[13px] text-danger">{startError}</p>}
        </Frame>
      ) : (
        <Frame>
          <span className="flex items-center gap-2 text-xs font-medium text-fg-3">
            <IconLock size={13} />
            Decisions and action items
          </span>
          <h2 className="m-0 text-base font-semibold">Extraction requires an Anthropic key</h2>
          <p className="m-0 max-w-[480px] text-pretty text-[13.5px] text-fg-2">
            This server is running without one, so only retrieval works. Set ANTHROPIC_API_KEY on the API and restart it to turn extraction on.
            The transcript below works without a key.
          </p>
        </Frame>
      );
  } else {
    body = (
      <>
        <div className="flex flex-col gap-2.5 border-b border-line px-6 py-[18px]">
          <h2 className="m-0 text-[13px] font-medium text-fg-2">
            Decisions <span className="font-mono text-fg-3">{meeting.decisions.length}</span>
          </h2>
          {meeting.decisions.length === 0 && <p className="m-0 text-[13.5px] text-fg-3">No decisions found.</p>}
          {meeting.decisions.map((d) => (
            <div key={d.id} className="flex items-baseline gap-3">
              <span aria-hidden="true" className="size-1.5 shrink-0 -translate-y-0.5 rotate-45 rounded-[1px] bg-fg" />
              <span className="flex-1 text-pretty text-sm leading-[1.55]">{d.text}</span>
              <SourceButton meeting={meeting} turnId={d.turnId} onJump={onJump} task={d.text} />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 px-6 pb-5 pt-[18px]">
          <h2 className="m-0 mb-1 text-[13px] font-medium text-fg-2">
            Action items <span className="font-mono text-fg-3">{meeting.actionItems.length}</span>
          </h2>
          {meeting.actionItems.length === 0 && <p className="m-0 text-[13.5px] text-fg-3">No action items found.</p>}
          {meeting.actionItems.length > 0 && (
            <div role="table" aria-label="Action items" className="flex flex-col">
              <div role="row" className="grid grid-cols-[minmax(0,1fr)_132px_140px_88px] gap-3 border-b border-line py-1.5 text-[11.5px] text-fg-3">
                <span role="columnheader">Task</span>
                <span role="columnheader">Owner</span>
                <span role="columnheader">Due</span>
                <span role="columnheader">Source</span>
              </div>
              {meeting.actionItems.map((a) => (
                <div key={a.id} role="row" className="grid grid-cols-[minmax(0,1fr)_132px_140px_88px] items-center gap-3 border-b border-line py-[9px] text-[13.5px]">
                  <span role="cell" className="text-pretty">{a.text}</span>
                  <span role="cell" className="flex min-w-0 items-center gap-[7px]">
                    <span
                      aria-hidden="true"
                      className="size-[7px] shrink-0 rounded-full"
                      style={{ background: a.owner ? speakerColor(a.owner, meeting.speakers) : 'var(--text-3)' }}
                    />
                    <span className="truncate">{a.owner ?? 'Unassigned'}</span>
                  </span>
                  <span role="cell" className="font-mono text-xs text-fg-2">{a.due ?? '–'}</span>
                  <span role="cell">
                    <SourceButton meeting={meeting} turnId={a.turnId} onJump={onJump} task={a.text} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <section aria-label="Summary" aria-busy={status === 'pending'} className="min-w-0 flex-[2_1_520px] rounded-lg border border-line bg-surface shadow-card">
      {body}
    </section>
  );
}
