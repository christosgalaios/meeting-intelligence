import type { Citation } from '../api/types';
import { cx } from '../lib/cx';
import { firstName } from '../lib/speakers';

interface Props {
  n: number;
  citation: Citation;
  active?: boolean;
  onClick: (turnId: string, meetingId: string) => void;
}

/** "[slug#12]" in the answer text, shown as `hh:mm:ss Speaker`. Click scrolls to the turn and highlights it. */
export function CitationChip({ n, citation, active = false, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={() => onClick(citation.turnId, citation.meetingId)}
      aria-label={`Source ${n}: ${citation.timestampLabel}, ${citation.speaker}`}
      data-turn-id={citation.turnId}
      className={cx(
        'mr-[3px] inline-flex h-[21px] items-center gap-[5px] rounded-[5px] border py-0 pl-[3px] pr-[7px] align-[1px] font-mono text-[11.5px] leading-none text-fg-2 hover:border-accent hover:text-fg',
        active ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface',
      )}
    >
      <span className="inline-grid h-[15px] min-w-[15px] place-items-center rounded-[3px] bg-surface-3 px-[3px] text-[10.5px] font-medium text-fg">{n}</span>
      {citation.timestampLabel} · {firstName(citation.speaker)}
    </button>
  );
}
