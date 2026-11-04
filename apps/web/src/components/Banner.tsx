import type { ReactNode } from 'react';
import type { Health } from '../api/types';
import { IconInfo } from './icons';

function Bar({ role, tone, children }: { role: 'status' | 'alert'; tone: string; children: ReactNode }) {
  return (
    <div role={role} className={`flex flex-wrap items-center gap-3 border-b border-line px-5 py-[9px] text-[13px] ${tone}`}>
      <IconInfo size={14} />
      <span className="min-w-60 flex-1">{children}</span>
    </div>
  );
}

/** One banner at a time, most urgent first: API down, model warming, then the retrieval-only note. */
export function Banner({ health, unreachable, showModeNote }: { health: Health | null; unreachable: boolean; showModeNote: boolean }) {
  if (unreachable && !health) {
    return (
      <Bar role="alert" tone="bg-danger-soft text-danger">
        Can&rsquo;t reach the API. Retrying every few seconds.
      </Bar>
    );
  }
  if (health && (!health.embeddings.ready || !health.db)) {
    return (
      <Bar role="status" tone="bg-warn-soft text-warn">
        {health.db
          ? 'The embedding model is still loading. Uploads and questions will work in a moment.'
          : 'The API cannot reach its database. Retrying every few seconds.'}
      </Bar>
    );
  }
  if (health?.mode === 'retrieval-only' && showModeNote) {
    return (
      <Bar role="status" tone="bg-accent-soft text-accent-soft-fg">
        Showing the best-matching moments. This server has no Anthropic key, so there are no written answers or extraction.
      </Bar>
    );
  }
  return null;
}
