import type { Health } from '../api/types';

interface Props {
  health: Health | null;
  unreachable: boolean;
  /** Icon-only, for the narrow sidebar. */
  compact?: boolean;
}

/** Mode comes from /api/health, fetched at load. The dot is decoration; the words carry the meaning. */
export function ModeBadge({ health, unreachable, compact = false }: Props) {
  let title: string;
  let sub: string;
  let dot: string;
  if (!health) {
    title = unreachable ? 'API unreachable' : 'Connecting';
    sub = unreachable ? 'Retrying' : 'Checking the API';
    dot = unreachable ? 'bg-danger' : 'bg-fg-3';
  } else if (health.mode === 'full') {
    title = 'Full mode';
    sub = health.models.answer ?? 'Answers on';
    dot = 'bg-ok';
  } else {
    title = 'Retrieval only';
    sub = 'No Anthropic key on the API';
    dot = 'bg-fg-3';
  }

  return (
    <div className="flex min-h-8 items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px]" title={`${title}. ${sub}`} data-testid="mode-badge">
      <span aria-hidden="true" className={`mx-1 size-2 shrink-0 rounded-full ${dot}`} />
      <span className={compact ? 'sr-only' : 'flex min-w-0 flex-col max-[1099px]:sr-only'}>
        <span className="text-fg">{title}</span>
        <span className="truncate text-[11.5px] text-fg-3">{sub}</span>
      </span>
    </div>
  );
}
