import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../AppContext';
import type { MeetingSummary } from '../api/types';
import { SourcesList } from '../components/SourcesList';
import { WhyThisAnswer } from '../components/WhyThisAnswer';
import { LibraryPage } from '../pages/LibraryPage';
import { chunk, fullExchange, TURNS } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

describe('SourcesList scores', () => {
  it('shows each turn its own score and a bar that follows it', () => {
    const turns = [{ ...TURNS[0]!, score: 0.82 }, { ...TURNS[1]!, score: 0.41 }];
    render(<SourcesList turns={turns} label="Best-matching moments" onSelect={() => undefined} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('0.820');
    expect(rows[1]).toHaveTextContent('0.410');
    const widths = rows.map((r) => (r.querySelector('[style*="width"]') as HTMLElement).style.width);
    expect(widths).toEqual(['82%', '41%']);
  });
});

describe('WhyThisAnswer chunks', () => {
  it('names the meeting by title and gives overlapping chunks their own text and time span', () => {
    // chunk 1 covers turns 1-2, chunk 2 covers turns 2-3: they overlap on turn 2.
    const ex = { ...fullExchange, chunks: [chunk(1), chunk(2)] };
    render(<WhyThisAnswer exchange={ex} onSelectTurn={() => undefined} titleOf={() => 'Pricing model review'} />);
    const rows = screen.getAllByRole('button').filter((b) => b.textContent?.includes('turns '));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Pricing model review · turns 1–2');
    expect(rows[0]).toHaveTextContent('Annual discount goes to 20% for Team.');
    expect(rows[1]).toHaveTextContent('turns 2–3');
    expect(rows[1]).toHaveTextContent('I will write up the revenue model.');
    expect(rows[0]).toHaveTextContent('00:00:30–00:01:30');
    expect(rows[1]).toHaveTextContent('00:01:00–00:02:00');
    expect(within(rows[0]!).queryByText(/I will write up/)).toBeNull();
  });
});

describe('empty library', () => {
  it('Load sample meetings posts to /api/seed and then shows the meetings', async () => {
    const m: MeetingSummary = {
      id: 'u1', slug: 'kickoff', title: 'Pricing kickoff', sourceFilename: 'k.txt', turnCount: 3, durationSeconds: 60, speakers: ['A'],
      extractionStatus: 'skipped', createdAt: '2026-11-04T10:00:00Z', meetingDate: '2026-10-06', decisionCount: 0, actionItemCount: 0,
    };
    let seeded = false;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200 }));
      if (url === '/api/health') return json({ status: 'ok', mode: 'full', db: true, embeddings: { model: 'Xenova/bge-small-en-v1.5', ready: true }, models: { answer: 'claude-sonnet-5-5', extraction: 'claude-haiku-5-5' }, version: '0' });
      if (url === '/api/seed') { seeded = true; return json({ added: 1, skipped: 0 }); }
      return json({ meetings: seeded ? [m] : [] });
    }));
    render(<MemoryRouter><AppProvider><LibraryPage /></AppProvider></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Load sample meetings' }));
    expect(await screen.findByText('Pricing kickoff')).toBeInTheDocument();
    expect(calls).toContain('POST /api/seed');
    expect(screen.queryByText('No meetings yet')).toBeNull();
  });
});

describe('import cost hint', () => {
  const health = (mode: 'full' | 'retrieval-only') => ({
    status: 'ok', mode, db: true, embeddings: { model: 'Xenova/bge-small-en-v1.5', ready: true },
    models: mode === 'full' ? { answer: 'claude-sonnet-5-5', extraction: 'claude-haiku-5-5' } : { answer: null, extraction: null },
    voice: { available: true, models: 'x' }, version: '0',
  });
  const library = (mode: 'full' | 'retrieval-only') => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200 }));
      return json(url === '/api/health' ? health(mode) : { meetings: [] });
    }));
    render(<MemoryRouter><AppProvider><LibraryPage /></AppProvider></MemoryRouter>);
  };
  const HINT = /Importing also extracts decisions and action items \(~\$0\.001 for a typical meeting, more for a long one\)/;

  it('tells the user in full mode that an import makes a paid extraction call', async () => {
    library('full');
    expect(await screen.findByText(HINT)).toBeInTheDocument();
  });

  it('says nothing about it in retrieval-only mode', async () => {
    library('retrieval-only');
    await screen.findByRole('button', { name: 'Transcribe audio' }); // health has loaded
    expect(screen.queryByText(/Importing also extracts/)).toBeNull();
  });
});
