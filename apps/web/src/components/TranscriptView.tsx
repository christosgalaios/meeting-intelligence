import { useEffect, useRef } from 'react';
import type { MeetingDetail } from '../api/types';
import { cx } from '../lib/cx';
import { speakerColor } from '../lib/speakers';

export interface TurnFocus {
  turnId: string;
  /** Bumped on every request so clicking the same chip twice scrolls twice. */
  key: number;
}

interface Props {
  meeting: MeetingDetail;
  focus: TurnFocus | null;
  /** [n] badges next to turns an answer cited. */
  citedBadges?: ReadonlyMap<string, number>;
  onSelectTurn?: (turnId: string) => void;
  /** "compact" is the side panel in the ask workspace; "wide" is the meeting page. */
  variant: 'compact' | 'wide';
}

/** Turns with id="turn-<n>" anchors. `focus` scrolls to one and highlights it. */
export function TranscriptView({ meeting, focus, citedBadges, onSelectTurn, variant }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const wide = variant === 'wide';

  useEffect(() => {
    if (!focus) return;
    const n = focus.turnId.slice(focus.turnId.lastIndexOf('#') + 1);
    const el = root.current?.querySelector<HTMLElement>(`#turn-${n}`);
    // jsdom has no scrollIntoView.
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [focus]);

  return (
    <div ref={root} className={cx(wide ? 'px-2 pb-3 pt-2' : 'px-2 pb-10 pt-2')}>
      {meeting.turns.map((t) => {
        const active = focus?.turnId === t.id;
        const badge = citedBadges?.get(t.id);
        return (
          <div
            key={t.id}
            id={`turn-${t.n}`}
            data-turn-id={t.id}
            aria-current={active ? 'true' : undefined}
            className={cx(
              'grid gap-x-3 rounded-md px-3 py-2.5 transition-colors duration-500',
              wide ? 'grid-cols-[84px_128px_minmax(0,1fr)]' : 'grid-cols-[72px_minmax(0,1fr)] gap-x-2',
              active && 'bg-hl',
            )}
          >
            <button
              type="button"
              onClick={() => onSelectTurn?.(t.id)}
              aria-label={`Highlight ${t.timestampLabel}, ${t.speaker}`}
              className="self-start border-0 bg-transparent py-px text-left font-mono text-xs text-accent hover:underline"
            >
              {t.timestampLabel}
            </button>
            {wide ? (
              <>
                <span className="pt-px text-[13px] font-semibold" style={{ color: speakerColor(t.speaker, meeting.speakers) }}>
                  {t.speaker}
                </span>
                <p className="m-0 text-pretty text-sm leading-[1.6]">{t.text}</p>
              </>
            ) : (
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold" style={{ color: speakerColor(t.speaker, meeting.speakers) }}>
                    {t.speaker}
                  </span>
                  {badge !== undefined && (
                    <span className="rounded-[3px] bg-surface-3 px-[5px] py-px font-mono text-[10.5px] text-fg">[{badge}]</span>
                  )}
                </div>
                <p className="m-0 text-pretty text-[13.5px] leading-[1.6]">{t.text}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
