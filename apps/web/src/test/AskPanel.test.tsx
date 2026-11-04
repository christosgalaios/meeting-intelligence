import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AskPanel, type AskPanelProps } from '../components/AskPanel';
import type { Exchange } from '../hooks/useAsk';
import { fullExchange, refusedExchange, retrievalOnlyExchange, TURNS } from './fixtures';

function setup(exchanges: Exchange[], over: Partial<AskPanelProps> = {}) {
  const props: AskPanelProps = {
    exchanges,
    mode: exchanges[0]?.mode ?? 'full',
    busy: false,
    costHint: '~$0.01',
    scopeSummary: 'Searching all 3 meetings',
    whyId: null,
    activeTurnId: null,
    onAsk: vi.fn(),
    onCite: vi.fn(),
    onOpenWhy: vi.fn(),
    ...over,
  };
  render(<AskPanel {...props} />);
  return props;
}

describe('AskPanel', () => {
  it('renders a retrieval-only result as ranked turns with scores, and no written answer', () => {
    setup([retrievalOnlyExchange], { mode: 'retrieval-only', costHint: 'free' });
    const list = screen.getByRole('region', { name: 'Best-matching moments' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(TURNS.length);
    expect(rows[0]).toHaveTextContent('#1');
    expect(rows[0]).toHaveTextContent('Annual discount goes to 20% for Team.');
    expect(rows[0]).toHaveTextContent('0.040'); // best first, with its fused score
    expect(rows[2]).toHaveTextContent('#3');
    expect(screen.getByText(/retrieval only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Source \d/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Search/ })).toHaveTextContent('free');
  });

  it('renders a full result with citation chips, and leaves an unvalidated id as plain text', () => {
    setup([fullExchange]);
    const chips = screen.getAllByRole('button', { name: /^Source \d/ });
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('00:01:00 · Priya');
    expect(chips[1]).toHaveTextContent('00:02:00 · Marcus');
    expect(screen.getByText(/Also \[ghost#9\]/)).toBeInTheDocument();
    // 3,912 in at $2/M plus 286 out at $10/M
    expect(screen.getByRole('button', { name: /Why this answer/ })).toHaveTextContent('$0.0107');
  });

  it('calls the scroll handler with the turn id when a chip is clicked', async () => {
    const { onCite } = setup([fullExchange]);
    await userEvent.click(screen.getByRole('button', { name: 'Source 2: 00:02:00, Marcus Chen' }));
    expect(onCite).toHaveBeenCalledWith('pricing#2', 'm1');
  });

  it('shows the refusal copy with the near-misses underneath', () => {
    setup([refusedExchange]);
    expect(screen.getByText('Not discussed in these meetings')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Closest moments' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Source \d/ })).toBeNull();
  });

  it('shows the thinking state after sources and before the first token', () => {
    setup([{ ...fullExchange, status: 'thinking', answer: '', done: null }]);
    expect(screen.getByRole('status')).toHaveTextContent('Found 3 moments · writing answer');
  });

  it('shows the error card for an error event', () => {
    setup([{ ...fullExchange, status: 'error', answer: '', done: null, error: { code: 'LLM_ERROR', message: 'The model declined this request.' } }]);
    expect(screen.getByRole('alert')).toHaveTextContent('The model declined this request.');
  });

  it('asks on Enter, not on Shift+Enter', async () => {
    const user = userEvent.setup();
    const { onAsk } = setup([], { mode: 'full' });
    await user.type(screen.getByLabelText('Ask a question'), 'first{Shift>}{Enter}{/Shift}second');
    expect(onAsk).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onAsk).toHaveBeenCalledWith('first\nsecond');
  });

  it('disables the ask button while an answer is running', async () => {
    const user = userEvent.setup();
    setup([], { busy: true });
    await user.type(screen.getByLabelText('Ask a question'), 'hello');
    expect(screen.getByRole('button', { name: /Ask/ })).toBeDisabled();
  });

  it('shows the cost hint on the ask button in full mode', () => {
    setup([], { mode: 'full', costHint: '~$0.01' });
    expect(screen.getByRole('button', { name: /Ask/ })).toHaveTextContent('~$0.01');
  });
});
