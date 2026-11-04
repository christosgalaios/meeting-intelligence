import { useEffect, useRef, useState } from 'react';
import type { MeetingSummary } from '../api/types';
import { formatDate, plural } from '../lib/format';
import { cx } from '../lib/cx';
import { IconChevron } from './icons';

interface Props {
  meetings: readonly MeetingSummary[];
  /** null = all meetings. */
  scope: string[] | null;
  onChange: (scope: string[] | null) => void;
}

function Box({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid size-4 shrink-0 place-items-center rounded-[4px] border-[1.5px] text-[11px] text-on-accent',
        on ? 'border-accent bg-accent' : 'border-line-strong bg-transparent',
      )}
    >
      {on ? '✓' : ''}
    </span>
  );
}

/** Which meetings a question searches. All by default; at least one must stay selected. */
export function ScopePicker({ meetings, scope, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const allOn = scope === null;
  const label = allOn
    ? `All ${meetings.length}`
    : scope.length === 1
      ? (meetings.find((m) => m.id === scope[0])?.title ?? '1 meeting')
      : plural(scope.length, 'meeting');

  const toggle = (id: string) => {
    const current = scope ?? meetings.map((m) => m.id);
    const has = current.includes(id);
    if (has && current.length === 1) return;
    const next = has ? current.filter((x) => x !== id) : [...current, id];
    onChange(next.length === meetings.length ? null : next);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={meetings.length === 0}
        className="flex h-7 max-w-[260px] items-center gap-1.5 rounded-md border border-line bg-surface pl-2.5 pr-2 text-[13px] hover:border-line-strong disabled:opacity-55"
      >
        <span className="text-fg-3">Scope</span>
        <span className="truncate font-medium">{label}</span>
        <IconChevron size={12} />
      </button>
      {open && (
        <div role="menu" aria-label="Meetings to search" className="absolute left-0 top-9 z-20 flex w-[340px] max-w-[90vw] flex-col gap-0.5 rounded-lg border border-line-strong bg-surface p-1.5 shadow-pop">
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={allOn}
            onClick={() => onChange(null)}
            className="flex h-[34px] items-center gap-2.5 rounded-md border-0 bg-transparent px-2 text-left text-[13px] hover:bg-surface-2"
          >
            <Box on={allOn} />
            <span className="flex-1 font-medium">All meetings</span>
          </button>
          <div className="mx-1 my-0.5 h-px bg-line" />
          {meetings.map((m) => {
            const on = allOn || scope.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => toggle(m.id)}
                className="flex min-h-[38px] items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1 text-left text-[13px] hover:bg-surface-2"
              >
                <Box on={on} />
                <span className="min-w-0 flex-1 truncate">{m.title}</span>
                <span className="font-mono text-[11.5px] text-fg-3">{formatDate(m.createdAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
