export interface FilenameMeta {
  /** YYYY-MM-DD from a leading date on the filename, or null. */
  date: string | null;
  title: string;
}

const PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:[\s_-]+(.*))?$/;

function isRealDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** "2026-10-13-pricing-model-review.txt" -> { date: "2026-10-13", title: "Pricing model review" }. */
export function filenameMeta(filename: string): FilenameMeta {
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  const m = PREFIX.exec(base);
  if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) return { date: null, title: base };
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const rest = (m[4] ?? '').replace(/[-_\s]+/g, ' ').trim();
  if (rest === '') return { date, title: base };
  return { date, title: rest.charAt(0).toUpperCase() + rest.slice(1) };
}
