import { AppError } from '../errors.js';

export interface ParsedTurn {
  id: string; // "<slug>#<n>"
  n: number;
  speaker: string;
  startSeconds: number;
  timestampLabel: string; // hh:mm:ss
  text: string;
}

export interface ParseResult {
  turns: ParsedTurn[];
  warnings: string[];
}

// [hh:mm:ss] Speaker: text, or the shorter [mm:ss] form.
const LINE = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s+([^:]{1,80}):\s?(.*)$/;

const pad = (n: number) => String(n).padStart(2, '0');

export function parseTranscript(input: string, slug: string): ParseResult {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const turns: ParsedTurn[] = [];
  const warnings: string[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;

    const m = LINE.exec(line);
    if (m) {
      const [, a, b, c, speaker, body] = m as unknown as [string, string, string, string | undefined, string, string];
      const [h, mi, s] = c === undefined ? [0, Number(a), Number(b)] : [Number(a), Number(b), Number(c)];
      const startSeconds = h * 3600 + mi * 60 + s;
      if (mi >= 60 || s >= 60) {
        warnings.push(`turn ${turns.length + 1}: timestamp ${pad(h)}:${pad(mi)}:${pad(s)} has minutes or seconds of 60 or more`);
      }
      const n = turns.length + 1;
      const prev = turns[turns.length - 1];
      if (prev && startSeconds < prev.startSeconds) {
        warnings.push(`turn ${n}: timestamp ${pad(h)}:${pad(mi)}:${pad(s)} is earlier than the previous turn`);
      }
      turns.push({
        id: `${slug}#${n}`,
        n,
        speaker: speaker.trim(),
        startSeconds,
        timestampLabel: `${pad(h)}:${pad(mi)}:${pad(s)}`,
        text: body.trim(),
      });
      continue;
    }

    const last = turns[turns.length - 1];
    if (last) {
      last.text = last.text === '' ? line : `${last.text} ${line}`;
    } else {
      warnings.push('dropped a line before the first timestamped turn');
    }
  }

  if (turns.length === 0) throw new AppError('EMPTY_TRANSCRIPT', 'No timestamped speaker turns found in the transcript.');
  return { turns, warnings };
}
