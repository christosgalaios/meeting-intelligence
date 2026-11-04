import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transcription } from '../api/types';
import { TranscriptReview } from '../components/TranscriptReview';
import { transcription } from './voiceFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const meeting = {
  id: 'm1', slug: 'weekly-sync', title: 'Weekly sync', sourceFilename: 'x.txt', turnCount: 4, durationSeconds: 40, speakers: [],
  extractionStatus: 'skipped', createdAt: 'x', meetingDate: null, decisionCount: 0, actionItemCount: 0, turns: [], decisions: [], actionItems: [], extractionError: null,
};

function stubFetch() {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response(JSON.stringify(meeting), { status: 201 });
  }));
  return calls;
}

function setup(t: Transcription = transcription()) {
  const props = { onRerun: vi.fn(), onImported: vi.fn(), onDiscard: vi.fn() };
  render(<TranscriptReview transcription={t} busy={false} {...props} />);
  return props;
}

const preview = () => screen.getByRole('list', { name: 'Transcript preview' });

describe('TranscriptReview', () => {
  it('shows the preview first, with the default title and date from the frozen clock', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2031, 2, 9, 12) });
    setup();
    expect(within(preview()).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByLabelText('Title')).toHaveValue('Meeting 2031-03-09');
    expect(screen.getByLabelText('Date')).toHaveValue('2031-03-09');
    expect(screen.getByText('4 turns · 3 speakers')).toBeInTheDocument();
  });

  it('renames a speaker and the preview follows', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Name for speaker 2'), 'Priya');
    expect(within(preview()).getByText('Priya')).toBeInTheDocument();
    expect(within(preview()).queryByText('Speaker 2')).not.toBeInTheDocument();
  });

  it('merges speaker 3 into speaker 1 and drops the row', async () => {
    setup();
    expect(screen.getAllByLabelText(/^Name for speaker/)).toHaveLength(3);
    await userEvent.selectOptions(screen.getByLabelText('Merge speaker 3 into'), '1');
    expect(screen.getAllByLabelText(/^Name for speaker/)).toHaveLength(2);
    expect(within(preview()).queryByText('Speaker 3')).not.toBeInTheDocument();
  });

  it('posts nothing to /api/meetings until Import is clicked, then posts the rendered draft', async () => {
    const calls = stubFetch();
    const props = setup();
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Weekly sync');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2031-03-09' } });
    await userEvent.type(screen.getByLabelText('Name for speaker 1'), 'Ann');
    expect(calls.filter((c) => c.url.includes('/meetings'))).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    const post = calls.find((c) => c.url === '/api/meetings')!;
    expect(post.method).toBe('POST');
    expect(post.body).toEqual({
      filename: '2031-03-09-weekly-sync.txt',
      title: 'Weekly sync',
      text: [
        '[00:00:00] Ann: Good morning.',
        '[00:00:12] Speaker 2: Morning, shall we start?',
        '[00:00:22] Speaker 3: Yes please.',
        '[00:00:32] Ann: Great.',
      ].join('\n'),
    });
    await vi.waitFor(() => expect(props.onImported).toHaveBeenCalledWith(meeting));
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/transcriptions/t1')).toBe(true);
  });

  it('disables Import with a reason when there is only one turn', () => {
    setup(transcription({ segments: [{ start: 0, end: 5, speaker: 1, text: 'Alone.' }] }));
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(screen.getByText('A transcript needs at least 2 turns.')).toBeInTheDocument();
  });

  it('disables Import while a speaker name is cleared', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Name for speaker 1'), 'A');
    await userEvent.clear(screen.getByLabelText('Name for speaker 1'));
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(screen.getByText('Give every speaker a name.')).toBeInTheDocument();
  });

  it('asks for a re-run with the chosen speaker count', async () => {
    const props = setup();
    const count = screen.getByLabelText('Wrong number of speakers?');
    await userEvent.clear(count);
    await userEvent.type(count, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Re-run with 2 speakers' }));
    expect(props.onRerun).toHaveBeenCalledWith(2);
  });

  it('shows the API message when the import is rejected and keeps the draft', async () => {
    const body = { error: { code: 'VALIDATION', message: 'Only 1 of 4 lines look like a turn.', requestId: 'r' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 422 })));
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 1 of 4 lines look like a turn.');
    expect(props.onImported).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });
});

describe('TranscriptReview import cost hint', () => {
  const HINT = 'Importing also extracts decisions and action items (~$0.001)';
  const renderWith = (importHint?: string | null) =>
    render(<TranscriptReview transcription={transcription()} busy={false} {...(importHint === undefined ? {} : { importHint })} onRerun={vi.fn()} onImported={vi.fn()} onDiscard={vi.fn()} />);

  it('shows the hint next to Import when given one', () => {
    renderWith(HINT);
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it('shows nothing without one', () => {
    renderWith(null);
    expect(screen.queryByText(/Importing also extracts/)).toBeNull();
  });
});
