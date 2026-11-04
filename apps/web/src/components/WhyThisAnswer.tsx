import { useState } from 'react';
import type { RankedChunk, SourceTurn } from '../api/types';
import type { Exchange } from '../hooks/useAsk';
import { formatUsd, usageCost } from '../lib/cost';
import { formatMs, formatScore, plural } from '../lib/format';
import { speakerColor } from '../lib/speakers';
import { btnSecondary } from './ui';

interface Props {
  exchange: Exchange | null;
  onSelectTurn: (turnId: string, meetingId: string) => void;
}

const clockLabel = (seconds: number): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(seconds / 3600))}:${p(Math.floor((seconds % 3600) / 60))}:${p(seconds % 60)}`;
};

function Kicker({ children }: { children: string }) {
  return <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-fg-3">{children}</span>;
}

/** The first retrieved turn inside a chunk's range, so the row can show what the chunk says. */
function turnFor(chunk: RankedChunk, turns: readonly SourceTurn[]): SourceTurn | undefined {
  return turns.find((t) => t.meetingId === chunk.meetingId && t.n >= chunk.firstTurnN && t.n <= chunk.lastTurnN);
}

/** Everything here comes from the stream (meta, sources, done). GET /api/traces/:id serves the same data after a reload. */
export function WhyThisAnswer({ exchange: ex, onSelectTurn }: Props) {
  const [copied, setCopied] = useState(false);

  if (!ex || ex.status === 'searching' || ex.status === 'thinking' || ex.status === 'streaming') {
    return <p className="m-0 text-[13.5px] text-fg-2">Details appear when the answer finishes.</p>;
  }

  const full = ex.mode === 'full';
  const refused = ex.refusal !== null || ex.done?.refusalReason != null;
  const generated = full && !refused;
  const done = ex.done;
  const usage = done?.usage ?? null;
  const cost = usage ? usageCost(ex.model, usage) : null;
  const citedTurnIds = new Set(done?.citations.map((c) => c.turnId) ?? []);

  const cells: Array<{ label: string; value: string; sub: string }> = [
    {
      label: 'Tokens',
      value: usage ? `${usage.inputTokens.toLocaleString('en-GB')} in · ${usage.outputTokens.toLocaleString('en-GB')} out` : '0',
      sub: usage ? `${usage.cacheReadTokens.toLocaleString('en-GB')} cache read` : refused ? 'generation skipped' : 'no generation',
    },
    {
      label: 'Latency',
      value: done ? formatMs(done.timings.totalMs) : '–',
      sub: done?.timings.llmMs != null ? `${formatMs(done.timings.llmMs)} in the model` : 'retrieval only',
    },
    {
      label: 'Estimated cost',
      value: usage ? (cost !== null ? formatUsd(cost) : 'unknown model') : '$0.0000',
      sub: usage ? 'from the token counts' : 'local embeddings',
    },
    {
      label: 'Model',
      value: ex.model && usage ? ex.model : full ? 'Not called' : 'None',
      sub: refused && ex.refusal
        ? `top vector score ${formatScore(ex.refusal.topVectorScore, 2)}`
        : full
          ? 'mode: full'
          : 'mode: retrieval-only',
    },
  ];

  const note = ex.refusal
    ? `The top vector score ${formatScore(ex.refusal.topVectorScore, 3)} was below the relevance threshold, so no answer was generated.`
    : done?.refusalReason === 'model_declined'
      ? 'The model read the retrieved moments and found nothing that answers the question.'
      : !full
        ? 'No API key on the server, so these are ranked moments without a written answer.'
        : '';

  const t = done?.timings;
  const stages = t
    ? [
        { label: 'Embed query', ms: t.embedMs },
        { label: 'Hybrid search', ms: t.searchMs },
        ...(t.llmMs !== null ? [{ label: 'Generate', ms: t.llmMs }] : []),
      ]
    : [];
  const stageSum = stages.reduce((n, s) => n + s.ms, 0) || 1;
  let acc = 0;
  const stageBars = stages.map((s) => {
    const bar = { ...s, left: (acc / stageSum) * 100, width: Math.max((s.ms / stageSum) * 100, 1.2) };
    acc += s.ms;
    return bar;
  });

  const maxText = Math.max(...ex.chunks.map((c) => c.textScore ?? 0), Number.EPSILON);

  const copyJson = () => {
    const data = {
      traceId: ex.traceId,
      question: ex.question,
      mode: ex.mode,
      model: ex.model,
      chunks: ex.chunks,
      done: ex.done,
    };
    void navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <Kicker>{generated ? 'Why this answer' : 'Why these moments'}</Kicker>
        <span className="text-sm font-semibold leading-[1.4]">{ex.question}</span>
      </div>

      {ex.status === 'error' && ex.error && (
        <div role="alert" className="rounded-md bg-danger-soft px-2.5 py-2 font-mono text-[12.5px] text-danger">
          {ex.error.message}
        </div>
      )}
      {note && <div className="rounded-md bg-surface-2 px-2.5 py-2 font-mono text-[12.5px] text-fg-2">{note}</div>}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {cells.map((c) => (
          <div key={c.label} className="flex min-w-0 flex-col gap-[3px] bg-surface px-3 py-2.5">
            <span className="text-[11.5px] text-fg-3">{c.label}</span>
            <span className="break-words font-mono text-[13.5px] font-medium">{c.value}</span>
            <span className="font-mono text-[11px] text-fg-3">{c.sub}</span>
          </div>
        ))}
      </div>

      {stageBars.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-fg-2">Latency</span>
            <span className="font-mono text-[11.5px] text-fg-3">total {formatMs(t!.totalMs)}</span>
          </div>
          {stageBars.map((s) => (
            <div key={s.label} className="grid grid-cols-[108px_minmax(0,1fr)_56px] items-center gap-2.5 text-xs">
              <span className="text-fg-2">{s.label}</span>
              <span className="relative block h-1.5 rounded-[3px] bg-surface-3">
                <span className="absolute inset-y-0 rounded-[3px] bg-accent" style={{ left: `${s.left}%`, width: `${s.width}%` }} />
              </span>
              <span className="text-right font-mono text-[11.5px] text-fg-2">{formatMs(s.ms)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-fg-2">Retrieved chunks, by rank</span>
          <span className="font-mono text-[11px] text-fg-3">vector + full text, fused with RRF</span>
        </div>
        <div className="flex gap-3.5 text-[11.5px] text-fg-3">
          <span className="flex items-center gap-[5px]">
            <span className="h-1.5 w-2.5 rounded-sm bg-accent" />
            vector similarity
          </span>
          <span className="flex items-center gap-[5px]">
            <span className="h-1.5 w-2.5 rounded-sm bg-series-2" />
            full-text rank
          </span>
        </div>
        {ex.chunks.length === 0 && <p className="m-0 text-[13px] text-fg-3">No chunks matched.</p>}
        {ex.chunks.map((c, i) => {
          const turn = turnFor(c, ex.turns);
          const cited = generated && ex.turns.some((tt) => citedTurnIds.has(tt.id) && tt.meetingId === c.meetingId && tt.n >= c.firstTurnN && tt.n <= c.lastTurnN);
          const tag = generated ? (cited ? 'cited' : 'not cited') : refused ? 'near miss' : 'shown';
          const on = generated ? cited : !refused;
          return (
            <button
              key={c.chunkId}
              type="button"
              onClick={() => turn && onSelectTurn(turn.id, turn.meetingId)}
              className="flex flex-col gap-2 rounded-md border border-line bg-surface px-3 py-[11px] text-left hover:border-line-strong"
            >
              <span className="flex w-full items-center gap-2 text-xs">
                <span className="w-[22px] font-mono text-fg-3">#{i + 1}</span>
                <span className="font-mono text-accent">{clockLabel(c.startSeconds)}</span>
                {turn && (
                  <span className="font-semibold" style={{ color: speakerColor(turn.speaker) }}>
                    {turn.speaker}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-fg-3">
                  {c.meetingSlug} · turns {c.firstTurnN}–{c.lastTurnN}
                </span>
                <span className={`whitespace-nowrap rounded-[3px] px-1.5 py-0.5 font-mono text-[10.5px] ${on ? 'bg-accent-soft text-accent-soft-fg' : 'bg-surface-2 text-fg-3'}`}>{tag}</span>
              </span>
              {turn && (
                <span className="line-clamp-2 text-[13px] leading-normal text-fg-2">{turn.text}</span>
              )}
              <span className="grid w-full grid-cols-[minmax(0,1fr)_56px] items-center gap-2.5">
                <span className="flex flex-col gap-[3px]">
                  <span className="block h-1 rounded-sm bg-surface-3">
                    <span className="block h-full rounded-sm bg-accent" style={{ width: `${Math.round(Math.max(c.vectorScore ?? 0, 0) * 100)}%` }} />
                  </span>
                  <span className="block h-1 rounded-sm bg-surface-3">
                    <span className="block h-full rounded-sm bg-series-2" style={{ width: `${Math.round(((c.textScore ?? 0) / maxText) * 100)}%` }} />
                  </span>
                </span>
                <span className="text-right font-mono text-[12.5px] font-medium" title="RRF score">
                  {formatScore(c.rrfScore)}
                </span>
              </span>
              <span className="font-mono text-[11px] text-fg-3">
                vector {c.vectorRank ?? '–'} · {formatScore(c.vectorScore)} &nbsp; text {c.textRank ?? '–'} · {formatScore(c.textScore)}
              </span>
            </button>
          );
        })}
      </div>

      {done && done.droppedCitations.length > 0 && (
        <div className="rounded-md bg-warn-soft px-2.5 py-2 text-[12.5px] text-warn">
          {plural(done.droppedCitations.length, 'citation')} dropped because the turn was not in the retrieved moments:{' '}
          <span className="font-mono">{done.droppedCitations.join(', ')}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={copyJson} className={`${btnSecondary} h-7 text-[12.5px]`}>
          {copied ? 'Copied' : 'Copy as JSON'}
        </button>
        {ex.traceId && (
          <a href={`/api/traces/${ex.traceId}`} target="_blank" rel="noreferrer" className="font-mono text-[11.5px]">
            trace {ex.traceId.slice(0, 8)}
          </a>
        )}
        <span className="text-[11.5px] text-fg-3">Embeddings run locally, so search is free.</span>
      </div>
    </>
  );
}
