import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { AskPanel } from '../components/AskPanel';
import { ScopePicker } from '../components/ScopePicker';
import { TranscriptView, type TurnFocus } from '../components/TranscriptView';
import { WhyThisAnswer } from '../components/WhyThisAnswer';
import { btnGhost } from '../components/ui';
import { useMeeting } from '../hooks/useMeeting';
import { cx } from '../lib/cx';
import { plural } from '../lib/format';

type Tab = 'transcript' | 'why';

export function AskPage() {
  const { meetings, scope, setScope, ask, mode, askCost, scopeSummary, submitAsk, titleOf } = useApp();
  const [tab, setTab] = useState<Tab>('transcript');
  const [whyId, setWhyId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false); // only matters below 1100 px, where the panel is an overlay
  const [focus, setFocus] = useState<TurnFocus | null>(null);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);

  const exchanges = ask.exchanges;
  const lastId = exchanges[exchanges.length - 1]?.id ?? null;
  // The panel follows the newest question until the user opens another one.
  useEffect(() => setWhyId(lastId), [lastId]);
  const whyEx = exchanges.find((e) => e.id === whyId) ?? null;

  const defaultMeeting = scope?.[0] ?? meetings[0]?.id ?? null;
  const shownId = transcriptId ?? defaultMeeting;
  const { meeting, loading } = useMeeting(shownId);

  const badges = useMemo(() => new Map((whyEx?.done?.citations ?? []).map((c, i) => [c.turnId, i + 1])), [whyEx]);

  const onCite = (turnId: string, meetingId: string) => {
    setTranscriptId(meetingId);
    setTab('transcript');
    setPanelOpen(true);
    setFocus((f) => ({ turnId, key: (f?.key ?? 0) + 1 }));
  };

  const openWhy = (id: string) => {
    setWhyId(id);
    setTab('why');
    setPanelOpen(true);
  };

  const meetingsInScope = scope ? meetings.filter((m) => scope.includes(m.id)) : meetings;
  const selectable = meeting && !meetingsInScope.some((m) => m.id === meeting.id) ? [meeting, ...meetingsInScope] : meetingsInScope;
  const lastExchange = exchanges[exchanges.length - 1];
  const activeTurnId = focus?.turnId ?? null;

  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line px-5">
          <h1 className="m-0 text-sm font-semibold">Ask</h1>
          <span aria-hidden="true" className="text-line-strong">
            /
          </span>
          <ScopePicker meetings={meetings} scope={scope} onChange={setScope} />
          <span className="flex-1" />
          <button
            type="button"
            className={`${btnGhost} h-7`}
            disabled={exchanges.length === 0}
            onClick={() => {
              ask.reset();
              setFocus(null);
            }}
          >
            New thread
          </button>
          <button
            type="button"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((o) => !o)}
            className="h-7 rounded-md border border-line bg-surface px-2.5 text-[13px] min-[1100px]:hidden"
          >
            Transcript
          </button>
        </header>

        {meetings.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
            <h2 className="m-0 text-[17px] font-semibold">No meetings to ask about</h2>
            <p className="m-0 max-w-[420px] text-fg-2">Add a transcript in the Library first.</p>
          </div>
        ) : (
          <AskPanel
            exchanges={exchanges}
            mode={mode}
            busy={ask.busy}
            costHint={askCost}
            scopeSummary={scopeSummary}
            whyId={whyId}
            activeTurnId={activeTurnId}
            titleOf={titleOf}
            onAsk={(q) => submitAsk(q)}
            onCite={onCite}
            onOpenWhy={openWhy}
          />
        )}
      </div>

      <aside
        aria-label="Sources"
        className={cx(
          'z-10 shrink-0 flex-col border-l border-line bg-bg',
          panelOpen ? 'flex' : 'hidden min-[1100px]:flex',
          'max-[1099px]:absolute max-[1099px]:inset-y-0 max-[1099px]:right-0 max-[1099px]:w-[min(480px,92%)] max-[1099px]:shadow-pop',
          'min-[1100px]:relative min-[1100px]:w-[clamp(400px,38%,540px)]',
        )}
      >
        <div role="tablist" aria-label="Source views" className="flex h-[52px] shrink-0 items-stretch gap-5 border-b border-line px-4">
          {(['transcript', 'why'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cx(
                'border-0 bg-transparent px-0.5 text-[13px] font-medium',
                tab === t ? 'text-fg shadow-[inset_0_-2px_0_var(--text)]' : 'text-fg-3',
              )}
            >
              {t === 'transcript' ? 'Transcript' : 'Why this answer'}
            </button>
          ))}
          <span className="flex-1" />
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setPanelOpen(false)}
            className="size-7 self-center rounded-md border-0 bg-transparent text-base text-fg-2 min-[1100px]:hidden"
          >
            ×
          </button>
        </div>

        {tab === 'transcript' ? (
          <>
            <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-2.5">
              <label htmlFor="mi-tm" className="sr-only">
                Meeting transcript
              </label>
              <select
                id="mi-tm"
                value={shownId ?? ''}
                disabled={selectable.length === 0}
                onChange={(e) => {
                  setTranscriptId(e.target.value);
                  setFocus(null);
                }}
                className="h-[30px] min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[13px] font-medium"
              >
                {selectable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
              {meeting && (
                <span className="whitespace-nowrap font-mono text-[11.5px] text-fg-3">
                  {plural(meeting.turnCount, 'turn')} · {plural(meeting.speakers.length, 'speaker')}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {meeting ? (
                <TranscriptView meeting={meeting} focus={focus} citedBadges={badges} variant="compact" onSelectTurn={(id) => setFocus((f) => ({ turnId: id, key: (f?.key ?? 0) + 1 }))} />
              ) : (
                <p className="m-0 p-4 text-[13.5px] text-fg-2">{loading ? 'Loading transcript…' : 'Pick a meeting to read its transcript.'}</p>
              )}
            </div>
          </>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-[22px] overflow-auto px-4 pb-8 pt-4">
            <WhyThisAnswer exchange={whyEx ?? (lastExchange && !whyId ? lastExchange : null)} onSelectTurn={onCite} />
          </div>
        )}
      </aside>
    </div>
  );
}
