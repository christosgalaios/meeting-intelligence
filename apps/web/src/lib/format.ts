export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The date a meeting took place: the filename date when there is one (a calendar date, so no timezone shift), else the upload date. */
export function meetingDateLabel(m: { meetingDate: string | null; createdAt: string }): string {
  if (!m.meetingDate) return formatDate(m.createdAt);
  const d = new Date(`${m.meetingDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? formatDate(m.createdAt) : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export const formatScore = (n: number | null, digits = 3): string => (n === null ? '–' : n.toFixed(digits));
