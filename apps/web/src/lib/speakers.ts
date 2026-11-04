/** Colour token for a speaker. In one meeting, order of appearance; across meetings, a stable hash of the name. */
export function speakerColor(name: string, speakers?: readonly string[]): string {
  const known = speakers?.indexOf(name) ?? -1;
  if (known >= 0) return `var(--spk-${(known % 6) + 1})`;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `var(--spk-${(h % 6) + 1})`;
}

export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase());
  return (letters.length > 1 ? letters[0]! + letters[letters.length - 1]! : letters[0] ?? '?').slice(0, 2);
}

export const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;
