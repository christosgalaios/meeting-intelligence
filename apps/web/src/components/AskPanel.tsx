import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Mode, SourceTurn } from '../api/types';
import type { Exchange } from '../hooks/useAsk';
import { citationLookup, splitAnswer } from '../lib/citations';
import { formatMs, plural } from '../lib/format';
import { usageCost, formatUsd } from '../lib/cost';
import { btnGhost, btnPrimary, ButtonHint, Caret, Dots, ErrorRef } from './ui';
import { CitationChip } from './CitationChip';
import { SourcesList } from './SourcesList';

export interface AskPanelProps {
  exchanges: readonly Exchange[];
  /** From /api/health. null until it has answered. */
  mode: Mode | null;
  busy: boolean;
  /** "~$0.01" in full mode, "free" in retrieval-only mode, null when unknown. */
  costHint: string | null;
  scopeSummary: string;
  /** The exchange whose "Why this answer" panel is showing. */
  whyId: string | null;
  activeTurnId: string | null;
  titleOf?: (meetingId: string) => string | undefined;
  onAsk: (question: string) => void;
  /** A citation chip or a ranked turn was clicked: show it in the transcript. */
  onCite: (turnId: string, meetingId: string) => void;
  onOpenWhy: (exchangeId: string) => void;
}

const SUGGESTIONS = ['What did we decide?', 'List every action item and who owns it', 'What is still open?'];

function useSlashFocus(ref: React.RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (e.key !== '/' || tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref]);
}

export function AskPanel(props: AskPanelProps) {
  const { exchanges, mode, busy, costHint, scopeSummary, whyId, activeTurnId, titleOf, onAsk, onCite, onOpenWhy } = props;
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useSlashFocus(input);

  // Keep the newest exchange in view as tokens arrive.
  const last = exchanges[exchanges.length - 1];
  const lastLen = last ? last.answer.length : 0;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [exchanges.length, last?.status, lastLen]);

  const canAsk = draft.trim().length > 0 && !busy && mode !== null;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canAsk) return;
    onAsk(draft.trim());
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-11 px-[clamp(20px,3vw,32px)] pb-6 pt-8">
          {exchanges.length === 0 && (
            <div className="flex flex-col gap-1.5 pt-[12vh]">
              <h2 className="m-0 text-xl font-semibold tracking-[-0.015em]">What do you want to know?</h2>
              <p className="m-0 text-fg-2">Ask about decisions, owners and dates. Every answer links to the moment it came from.</p>
            </div>
          )}
          {exchanges.map((ex) => (
            <ExchangeView
              key={ex.id}
              ex={ex}
              whyOpen={whyId === ex.id}
              activeTurnId={activeTurnId}
              {...(titleOf ? { titleOf } : {})}
              onCite={onCite}
              onOpenWhy={onOpenWhy}
            />
          ))}
        </div>
      </div>

      <div className="shrink-0 px-[clamp(20px,3vw,32px)] pb-[18px] pt-2.5">
        <div className="mx-auto flex max-w-[720px] flex-col gap-2.5">
          <form
            data-askbar=""
            onSubmit={submit}
            className="flex flex-col gap-2 rounded-lg border border-line-strong bg-surface py-2.5 pl-3.5 pr-2.5 shadow-card"
          >
            <label htmlFor="mi-ask" className="sr-only">
              Ask a question
            </label>
            <textarea
              id="mi-ask"
              ref={input}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about decisions, owners or dates…"
              className="resize-none border-0 bg-transparent px-0 py-0.5 text-[15px] leading-normal"
            />
            <div className="flex items-center gap-2.5">
              <span className="min-w-0 truncate font-mono text-[11.5px] text-fg-3">{scopeSummary}</span>
              <span className="flex-1" />
              <span className="hidden whitespace-nowrap text-[11.5px] text-fg-3 sm:inline">↵ to ask · ⇧↵ new line</span>
              <button type="submit" disabled={!canAsk} className={`${btnPrimary} h-8 text-[13.5px]`}>
                {mode === 'retrieval-only' ? 'Search' : 'Ask'}
                {costHint && <ButtonHint>{costHint}</ButtonHint>}
              </button>
            </div>
          </form>
          {exchanges.length === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setDraft(q);
                    input.current?.focus();
                  }}
                  className="h-7 rounded-full border border-line bg-surface px-2.5 text-[12.5px] text-fg-2 hover:border-line-strong hover:text-fg"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface ExchangeProps {
  ex: Exchange;
  whyOpen: boolean;
  activeTurnId: string | null;
  titleOf?: (meetingId: string) => string | undefined;
  onCite: (turnId: string, meetingId: string) => void;
  onOpenWhy: (exchangeId: string) => void;
}

function ExchangeView({ ex, whyOpen, activeTurnId, titleOf, onCite, onOpenWhy }: ExchangeProps) {
  const [copied, setCopied] = useState(false);
  const retrievalOnly = ex.mode === 'retrieval-only';
  const refused = ex.done?.refusalReason != null || ex.refusal !== null;
  const settled = ex.status === 'done';
  const generating = ex.status === 'searching' || ex.status === 'thinking' || ex.status === 'streaming';

  const lookup = citationLookup(ex.turns, ex.done ? ex.done.citations : null);
  const blocks = !refused && ex.mode === 'full' ? splitAnswer(ex.answer, lookup, ex.status === 'streaming') : [];
  const onSelectTurn = (t: SourceTurn) => onCite(t.id, t.meetingId);

  const thinkingText =
    ex.status === 'searching'
      ? `Searching ${plural(ex.scopeCount, 'meeting')}`
      : ex.mode === 'full'
        ? `Found ${plural(ex.turns.length, 'moment')} · writing answer`
        : `Found ${plural(ex.turns.length, 'moment')} · ranking`;

  const cost = ex.done?.usage ? usageCost(ex.model, ex.done.usage) : null;
  const whyMeta = ex.done
    ? ex.done.usage && ex.mode === 'full'
      ? `${plural(ex.chunks.length, 'chunk')} · ${formatMs(ex.done.timings.totalMs)}${cost !== null ? ` · ${formatUsd(cost)}` : ''}`
      : `${plural(ex.chunks.length, 'chunk')} · ${formatMs(ex.done.timings.totalMs)} · ${ex.mode === 'full' ? '$0.0000' : 'free'}`
    : '';

  return (
    <article aria-busy={generating} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-pretty text-[17px] font-semibold leading-[1.4] tracking-[-0.01em]">{ex.question}</h2>
        <span className="font-mono text-[11.5px] text-fg-3">
          {plural(ex.scopeCount, 'meeting')} · {ex.askedAt}
          {retrievalOnly ? ' · retrieval only' : ''}
        </span>
      </div>

      {generating && !ex.answer && (
        <div role="status" className="flex h-7 items-center gap-2.5 text-[13.5px] text-fg-2">
          <Dots />
          <span>{thinkingText}</span>
        </div>
      )}

      {blocks.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {blocks.map((b, i) => (
            <div key={i} className="flex gap-2.5">
              {b.listItem && <span aria-hidden="true" className="mt-[11px] size-[5px] shrink-0 rounded-full bg-fg-3" />}
              <p className="m-0 text-pretty text-[15px] leading-[1.72]">
                {b.parts.map((p, j) =>
                  p.kind === 'text' ? (
                    p.bold ? <strong key={j} className="font-semibold">{p.text}</strong> : <span key={j}>{p.text}</span>
                  ) : (
                    <CitationChip key={j} n={p.n} citation={p.citation} active={activeTurnId === p.turnId} onClick={onCite} />
                  ),
                )}
                {ex.status === 'streaming' && i === blocks.length - 1 && <Caret />}
              </p>
            </div>
          ))}
        </div>
      )}

      {settled && refused && (
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 px-4 py-3.5">
          <div className="text-[15px] font-semibold">Not discussed in these meetings</div>
          <div className="text-pretty text-[13.5px] text-fg-2">
            {ex.refusal
              ? `Nothing in the ${plural(ex.scopeCount, 'meeting')} in scope is close enough to this question to answer it. These are the nearest moments.`
              : 'The moments found do not answer this question. These are the nearest ones.'}
          </div>
        </div>
      )}

      {ex.status === 'error' && ex.error && (
        <div role="alert" className="flex flex-col gap-1 rounded-lg border border-danger bg-danger-soft px-4 py-3.5">
          <div className="text-[15px] font-semibold text-danger">This question could not be answered</div>
          <div className="text-[13.5px] text-fg-2">{ex.error.message}</div>
          <ErrorRef id={ex.error.ref} />
        </div>
      )}

      {settled && (retrievalOnly || refused) && ex.turns.length > 0 && (
        <SourcesList
          turns={ex.turns}
          label={refused ? 'Closest moments' : 'Best-matching moments'}
          activeTurnId={activeTurnId}
          {...(titleOf ? { titleOf } : {})}
          onSelect={onSelectTurn}
          weak={refused}
        />
      )}

      {settled && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpenWhy(ex.id)}
            aria-pressed={whyOpen}
            className={`inline-flex h-7 items-center gap-2 rounded-md border px-2.5 text-[12.5px] hover:border-line-strong ${whyOpen ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
          >
            {ex.mode === 'full' && !refused ? 'Why this answer' : 'Why these moments'}
            <span className="font-mono text-[11.5px] text-fg-3">{whyMeta}</span>
          </button>
          {ex.mode === 'full' && !refused && ex.answer && (
            <button
              type="button"
              className={`${btnGhost} h-7 text-[12.5px]`}
              onClick={() => {
                void navigator.clipboard?.writeText(ex.answer);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
