import { useState } from 'react';
import type { SourceTurn } from '../api/types';
import { cx } from '../lib/cx';
import { formatScore } from '../lib/format';
import { speakerColor } from '../lib/speakers';

interface Props {
  turns: readonly SourceTurn[];
  /** Label above the list, e.g. "Best-matching moments" or "Closest moments". */
  label: string;
  activeTurnId?: string | null;
  titleOf?: (meetingId: string) => string | undefined;
  onSelect: (turn: SourceTurn) => void;
  /** Rows shown before "Show all". */
  limit?: number;
  /** Dim the bars: these are near-misses, not matches. */
  weak?: boolean;
}

/** Ranked turns with their scores. The result in retrieval-only mode, and the near-misses under a refusal. */
export function SourcesList({ turns, label, activeTurnId = null, titleOf, onSelect, limit = 5, weak = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (turns.length === 0) return null;
  const shown = expanded ? turns : turns.slice(0, limit);
  const suffix = turns.length > shown.length ? ` · ${shown.length} of ${turns.length}` : '';

  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-medium text-fg-3">
        {label}
        {suffix}
      </h3>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {shown.map((t, i) => {
          const active = activeTurnId === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t)}
                className={cx(
                  'grid w-full grid-cols-[28px_minmax(0,1fr)_72px] items-start gap-3 rounded-lg border px-3.5 py-3 text-left hover:border-line-strong',
                  active ? 'border-hl-fg bg-hl' : 'border-line bg-surface',
                )}
              >
                <span className="pt-px font-mono text-xs text-fg-3">#{i + 1}</span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                    <span className="font-mono text-accent">{t.timestampLabel}</span>
                    <span className="font-semibold" style={{ color: speakerColor(t.speaker) }}>
                      {t.speaker}
                    </span>
                    <span className="text-fg-3">{titleOf?.(t.meetingId) ?? t.id.slice(0, t.id.lastIndexOf('#'))}</span>
                  </span>
                  <span className="text-pretty text-sm leading-[1.55]">{t.text}</span>
                </span>
                <span className="flex flex-col items-end gap-1.5 pt-0.5">
                  <span className="font-mono text-xs text-fg-2" title="Cosine similarity of this turn to the question">
                    {formatScore(t.score)}
                  </span>
                  <span aria-hidden="true" className="block h-1 w-14 overflow-hidden rounded-sm bg-surface-3">
                    <span className={cx('block h-full', weak ? 'bg-fg-3' : 'bg-accent')} style={{ width: `${Math.round(Math.min(Math.max(t.score, 0), 1) * 100)}%` }} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {turns.length > limit && (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="self-start border-0 bg-transparent px-0 text-[12.5px] text-fg-2 hover:text-fg">
          {expanded ? 'Show fewer' : `Show all ${turns.length}`}
        </button>
      )}
    </section>
  );
}
