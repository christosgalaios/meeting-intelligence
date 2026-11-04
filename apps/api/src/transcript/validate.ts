import { AppError } from '../errors.js';
import { LINE, parseTranscript, type ParsedTurn } from './parse.js';

export const MAX_CONTROL_RATIO = 0.01;
export const MIN_TURNS = 2;
export const MIN_TURN_LINE_RATIO = 0.5;
export const MAX_WORDS_PER_TURN = 2000;

const reject = (message: string) => new AppError('VALIDATION', message, 422);

/** Control characters other than \n, \r and \t. DEL counts. */
function controlCount(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 32 && c !== 10 && c !== 13 && c !== 9) || c === 127) n++;
  }
  return n;
}

/**
 * Cheap checks that run before anything is embedded or sent to a model, so junk never costs anything.
 * Measured on the sample transcripts: every non-empty line is a timestamped turn (ratio 1.0), the longest turn is 159 words.
 * Throws a 422 VALIDATION error; returns the parsed turns on success so the caller can reuse them.
 */
export function validateTranscript(text: string, slug = 'check'): ParsedTurn[] {
  if (text.includes('\0') || controlCount(text) > text.length * MAX_CONTROL_RATIO) {
    throw reject("This doesn't look like a text transcript.");
  }

  // 0 turns stays the existing EMPTY_TRANSCRIPT error from the parser.
  const { turns } = parseTranscript(text, slug);
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const turnLines = lines.filter((l) => LINE.test(l.trim())).length;

  if (turns.length < MIN_TURNS || turnLines < lines.length * MIN_TURN_LINE_RATIO) {
    throw reject(`Only ${turnLines} of ${lines.length} lines look like '[hh:mm:ss] Speaker: text'. Check the file is a transcript with one turn per line.`);
  }

  const long = turns.find((t) => t.text.split(/\s+/).filter(Boolean).length > MAX_WORDS_PER_TURN);
  if (long) {
    throw reject(`Turn ${long.n} is longer than ${MAX_WORDS_PER_TURN} words, which looks like a pasted document rather than speech.`);
  }
  return turns;
}
