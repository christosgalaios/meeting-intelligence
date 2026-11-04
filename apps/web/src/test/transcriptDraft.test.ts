import { describe, expect, it } from 'vitest';
import {
  cleanName, draftFilename, hasClearedName, mergeSpeakers, newDraft, renameSpeaker, renderTranscript, speakerLabel,
  speakerNumbers, timestampLabel, turnCount, withNewSegments, type Draft,
} from '../lib/transcriptDraft';

// Same pattern as the API's LINE in transcript/parse.ts.
const LINE = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s+([^:]{1,80}):\s?(.*)$/;

const seg = (speaker: number, start: number, end: number, text: string) => ({ speaker, start, end, text });
const base = (): Draft => newDraft({
  segments: [
    seg(1, 0, 10, 'Good morning.'),
    seg(2, 12, 20, 'Morning, shall we start?'),
    seg(3, 22, 30, 'Yes please.'),
    seg(1, 32, 40, 'Great.'),
  ],
}, 'Weekly sync', '2031-03-09');

describe('renaming', () => {
  it('uses the new name in the label and the rendered line', () => {
    const d = renameSpeaker(base(), 2, 'Priya');
    expect(speakerLabel(d, 2)).toBe('Priya');
    expect(renderTranscript(d).split('\n')[1]).toBe('[00:00:12] Priya: Morning, shall we start?');
  });

  it('falls back to "Speaker N" for a cleared name and flags it so import can wait', () => {
    const d = renameSpeaker(base(), 2, '   ');
    expect(speakerLabel(d, 2)).toBe('Speaker 2');
    expect(hasClearedName(d)).toBe(true);
    expect(hasClearedName(renameSpeaker(d, 2, 'Priya'))).toBe(false);
  });

  it('keeps every rendered line valid for the API parser: no colons, at most 80 characters', () => {
    expect(cleanName('Priya: Raman')).toBe('Priya- Raman');
    expect(cleanName('x'.repeat(200))).toHaveLength(80);
    const d = renameSpeaker(base(), 1, 'Dr: Who '.repeat(20));
    for (const line of renderTranscript(d).split('\n')) expect(LINE.test(line), line).toBe(true);
  });
});

describe('mergeSpeakers', () => {
  it('merges 3 into 1, renumbers, and keeps each remaining name with its speaker', () => {
    const named = renameSpeaker(renameSpeaker(base(), 1, 'Ann'), 2, 'Bo');
    const d = mergeSpeakers(named, 3, 1);
    expect(speakerNumbers(d)).toEqual([1, 2]);
    expect(d.speakerNames).toEqual({ 1: 'Ann', 2: 'Bo' });
    expect(d.segments.map((s) => s.speaker)).toEqual([1, 2, 1, 1]);
  });

  it('keeps turns apart when their gap is over a second', () => {
    expect(turnCount(mergeSpeakers(base(), 3, 1))).toBe(4); // 22-30 then 32-40 is a 2 s gap
  });

  it('joins turns that become neighbours, with a space, using the API gap rule', () => {
    const d = newDraft({
      segments: [seg(1, 0, 10, 'One.'), seg(2, 10.2, 12, 'Two.'), seg(1, 12.5, 15, 'Three.'), seg(3, 30, 35, 'Four.')],
    }, 't', null);
    expect(mergeSpeakers(d, 2, 1).segments).toEqual([seg(1, 0, 15, 'One. Two. Three.'), seg(2, 30, 35, 'Four.')]);
  });

  it('never collapses the draft to a single turn, which the API would reject', () => {
    const d = newDraft({ segments: [seg(1, 0, 10, 'One.'), seg(2, 10.2, 12, 'Two.'), seg(1, 12.5, 15, 'Three.')] }, 't', null);
    expect(turnCount(mergeSpeakers(d, 2, 1))).toBe(3);
  });

  it('moves the merged speaker name away and renumbers the ones after it', () => {
    const named = renameSpeaker(base(), 3, 'Cy');
    const d = mergeSpeakers(named, 1, 2);
    expect(speakerNumbers(d)).toEqual([1, 2]);
    expect(d.speakerNames).toEqual({ 2: 'Cy' });
    expect(speakerLabel(d, 2)).toBe('Cy');
  });

  it('is a no-op for the same speaker', () => {
    const d = base();
    expect(mergeSpeakers(d, 2, 2)).toBe(d);
  });
});

describe('renderTranscript', () => {
  it('produces lines that all pass the API line pattern', () => {
    for (const line of renderTranscript(base()).split('\n')) expect(LINE.test(line), line).toBe(true);
  });

  it('floors timestamps and crosses the hour boundary', () => {
    expect(timestampLabel(3599.9)).toBe('00:59:59');
    expect(timestampLabel(3600)).toBe('01:00:00');
  });
});

describe('draftFilename', () => {
  it('puts the date first so the API reads the meeting date from the filename', () => {
    expect(draftFilename(base())).toBe('2031-03-09-weekly-sync.txt');
  });
  it('omits the date when there is none', () => {
    expect(draftFilename({ ...base(), date: null })).toBe('weekly-sync.txt');
  });
  it('falls back to "meeting" for a title with no usable characters', () => {
    expect(draftFilename({ ...base(), title: '?!' })).toBe('2031-03-09-meeting.txt');
  });
});

describe('withNewSegments (re-run)', () => {
  it('keeps the title, date and names whose speaker number still exists', () => {
    const named = renameSpeaker(renameSpeaker(base(), 1, 'Ann'), 3, 'Cy');
    const next = withNewSegments(named, { segments: [seg(1, 0, 5, 'a'), seg(2, 6, 9, 'b')] });
    expect(next.title).toBe('Weekly sync');
    expect(next.date).toBe('2031-03-09');
    expect(next.speakerNames).toEqual({ 1: 'Ann' });
    expect(turnCount(next)).toBe(2);
  });
});
