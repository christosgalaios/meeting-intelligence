import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MeetingDetail } from '../api/types';
import { ApiClientError } from '../api/client';
import { MeetingSummaryCard } from '../components/MeetingSummaryCard';

const meeting = (status: MeetingDetail['extractionStatus']): MeetingDetail => ({
  id: 'u1',
  slug: 'pricing',
  title: 'Pricing',
  sourceFilename: 'pricing.txt',
  turnCount: 1,
  durationSeconds: 60,
  speakers: ['Priya Raman'],
  extractionStatus: status,
  createdAt: new Date(0).toISOString(),
  meetingDate: null,
  decisionCount: 0,
  actionItemCount: 0,
  turns: [{ id: 'pricing#1', meetingId: 'u1', n: 1, speaker: 'Priya Raman', startSeconds: 0, timestampLabel: '00:00:00', text: 'Annual discount goes to 20% for Team.' }],
  decisions: [],
  actionItems: [],
  extractionError: null,
});

const BUTTON = /Extract decisions and actions/;

describe('MeetingSummaryCard extract button', () => {
  it('shows the cost estimate, calls onExtract once, and is disabled while the request is pending', async () => {
    let release: () => void = () => undefined;
    const onExtract = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    render(<MeetingSummaryCard meeting={meeting('skipped')} mode="full" extractionModel="claude-haiku-5-5" onExtract={onExtract} onJump={vi.fn()} />);

    const button = screen.getByRole('button', { name: BUTTON });
    expect(button).toHaveTextContent(/~\$0\.00\d/); // the estimate is on the button before anything is spent
    expect(button).toBeEnabled();

    await userEvent.click(button);
    expect(onExtract).toHaveBeenCalledTimes(1);
    const pending = screen.getByRole('button', { name: /Starting/ });
    expect(pending).toBeDisabled();
    await userEvent.click(pending); // a second click while the first is in flight does nothing
    expect(onExtract).toHaveBeenCalledTimes(1);

    release();
    expect(await screen.findByRole('button', { name: BUTTON })).toBeEnabled();
  });

  it('shows the API message and its request id when starting fails', async () => {
    const onExtract = vi.fn().mockRejectedValue(new ApiClientError('CONFLICT', 'Extraction is already running for this meeting.', 409, 'req-9'));
    render(<MeetingSummaryCard meeting={meeting('skipped')} mode="full" extractionModel="claude-haiku-5-5" onExtract={onExtract} onJump={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Extraction is already running for this meeting.');
    expect(alert).toHaveTextContent('Ref: req-9');
  });

  it('offers no button without a key', () => {
    render(<MeetingSummaryCard meeting={meeting('skipped')} mode="retrieval-only" extractionModel={null} onExtract={vi.fn()} onJump={vi.fn()} />);
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });
});
