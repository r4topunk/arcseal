import { roundTime } from '@arcseal/sdk';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoundDeadline } from '@/components/deadline';
import { I18nProvider } from '@/components/i18n';
import { formatDateTime } from '@/lib/format';

const ROUND = 32_000_000n;
const AT = roundTime(ROUND);

describe('RoundDeadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the drand round, the wall-clock time and a live countdown', () => {
    vi.setSystemTime((AT - 300) * 1000);
    render(<RoundDeadline round={ROUND} label="deadline.votingCloses" passedLabel="deadline.votingClosed" />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText('Voting closes')).toBeInTheDocument();
    expect(screen.getByText('drand round 32,000,000')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(AT, 'en'), { exact: false })).toBeInTheDocument();
    expect(screen.getByText('in 05:00')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('in 04:00')).toBeInTheDocument();
  });

  it('switches to the passed label and drops the countdown after the round', () => {
    vi.setSystemTime((AT + 1) * 1000);
    render(<RoundDeadline round={ROUND} label="deadline.revealEnds" passedLabel="deadline.revealEnded" />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText('Reveal window ended')).toBeInTheDocument();
    expect(screen.queryByText(/^in /)).toBeNull();
  });

  it('uses an explicit time (execution deadline) and Portuguese labels', () => {
    vi.setSystemTime(AT * 1000);
    render(
      <I18nProvider initialLocale="pt-BR">
        <RoundDeadline
          round={ROUND}
          at={AT + 7 * 86_400}
          label="deadline.executeBy"
          passedLabel="deadline.executeEnded"
        />
      </I18nProvider>,
    );
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText('Executar até')).toBeInTheDocument();
    expect(screen.getByText('rodada drand 32,000,000')).toBeInTheDocument();
    expect(screen.getByText('em 7d 00h')).toBeInTheDocument();
  });
});

describe('chain clock offset', () => {
  it('follows the chain only when it disagrees with the local clock by 10 s or more', async () => {
    const { clockOffset } = await import('@/components/chain-clock');
    expect(clockOffset(1_000, 999.6)).toBe(0);
    expect(clockOffset(1_000, 1_009)).toBe(0);
    expect(clockOffset(1_000, 4_600)).toBe(-3_600);
    expect(clockOffset(5_000, 1_000)).toBe(4_000);
  });

  it('shifts RoundDeadline countdowns by the offset', async () => {
    const { ClockOffsetContext } = await import('@/lib/hooks');
    vi.useFakeTimers();
    // Local clock is one hour ahead of the chain: without the offset the deadline would read as passed.
    vi.setSystemTime((AT + 3_600 - 120) * 1000);
    render(
      <ClockOffsetContext.Provider value={-3_600}>
        <RoundDeadline round={ROUND} label="deadline.votingCloses" passedLabel="deadline.votingClosed" />
      </ClockOffsetContext.Provider>,
    );
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText('Voting closes')).toBeInTheDocument();
    expect(screen.getByText('in 02:00')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
