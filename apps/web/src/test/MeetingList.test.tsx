import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { MeetingSummary } from '../api/types';
import { MeetingList } from '../components/MeetingList';
import { meetingDateLabel } from '../lib/format';

const base: MeetingSummary = {
  id: 'u1', slug: 'pricing', title: 'Pricing model review', sourceFilename: 'x.txt', turnCount: 9, durationSeconds: 600,
  speakers: ['Priya Raman'], extractionStatus: 'done', createdAt: '2026-11-04T14:56:28.442Z', meetingDate: '2026-10-13',
  decisionCount: 4, actionItemCount: 1,
};

describe('MeetingList', () => {
  it('shows the meeting date from the filename, not the upload date, and the extraction counts', () => {
    render(<MemoryRouter><MeetingList meetings={[base]} mode="full" /></MemoryRouter>);
    expect(screen.getByText(/Tue 13 Oct/)).toBeInTheDocument();
    expect(screen.queryByText(/4 Nov/)).toBeNull();
    expect(screen.getByText('decisions').parentElement).toHaveTextContent('4 decisions');
    expect(screen.getByText('action item').parentElement).toHaveTextContent('1 action item');
  });

  it('shows no counts until extraction is done', () => {
    render(<MemoryRouter><MeetingList meetings={[{ ...base, extractionStatus: 'skipped', decisionCount: 0, actionItemCount: 0 }]} mode="full" /></MemoryRouter>);
    expect(screen.getByText('Not extracted yet')).toBeInTheDocument();
    expect(screen.queryByText(/decisions/)).toBeNull();
  });
});

describe('meetingDateLabel', () => {
  it('falls back to the upload date when the filename had none', () => {
    expect(meetingDateLabel({ meetingDate: null, createdAt: '2026-11-04T12:00:00Z' })).toMatch(/4 Nov/);
  });
});
