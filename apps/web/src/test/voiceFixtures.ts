import type { Transcription } from '../api/types';

export const transcription = (over: Partial<Transcription> = {}): Transcription => ({
  id: 't1',
  status: 'done',
  queuePosition: null,
  stage: null,
  durationSeconds: 40,
  numSpeakers: 3,
  speakers: ['Speaker 1', 'Speaker 2', 'Speaker 3'],
  segments: [
    { start: 0, end: 10, speaker: 1, text: 'Good morning.' },
    { start: 12, end: 20, speaker: 2, text: 'Morning, shall we start?' },
    { start: 22, end: 30, speaker: 3, text: 'Yes please.' },
    { start: 32, end: 40, speaker: 1, text: 'Great.' },
  ],
  transcript: '[00:00:00] Speaker 1: Good morning.',
  error: null,
  createdAt: 'x',
  ...over,
});
