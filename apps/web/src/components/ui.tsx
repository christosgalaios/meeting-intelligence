import { cx } from '../lib/cx';

const btn =
  'inline-flex items-center justify-center gap-2 h-8 px-3 rounded-md text-[13px] whitespace-nowrap transition-colors disabled:opacity-55';
export const btnPrimary = cx(btn, 'border-0 bg-accent font-medium text-on-accent hover:bg-accent-hover disabled:hover:bg-accent');
export const btnSecondary = cx(btn, 'border border-line-strong bg-surface font-medium hover:bg-surface-2');
export const btnGhost = cx(btn, 'border-0 bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg');
export const card = 'rounded-lg border border-line bg-surface shadow-card';

/** The cost or "free" tag inside a button, set off by a divider as in the design system. */
export function ButtonHint({ children }: { children: string }) {
  return <span className="border-l border-current pl-2 font-mono text-xs">{children}</span>;
}

/** The id that ties an error on screen to a line in the API log. Renders nothing when there is none. */
export function ErrorRef({ id }: { id: string | null | undefined }) {
  return id ? <span className="font-mono text-xs text-fg-3">Ref: {id}</span> : null;
}

export function Dots() {
  return (
    <span aria-hidden="true" className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-[5px] rounded-full bg-fg-2"
          style={{ animation: `mi-pulse 1.2s ${i * 0.16}s infinite ease-in-out` }}
        />
      ))}
    </span>
  );
}

export function Caret() {
  return (
    <span
      aria-hidden="true"
      className="ml-px inline-block h-[15px] w-[7px] bg-accent align-[-2px]"
      style={{ animation: 'mi-blink 1s steps(1) infinite' }}
    />
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2.5 text-[13.5px] text-fg-2">
      <Dots />
      {label}
    </span>
  );
}
