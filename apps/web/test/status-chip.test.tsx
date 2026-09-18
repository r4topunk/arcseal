import { PROPOSAL_STATUSES, type ProposalStatus } from '@arcseal/sdk';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@/components/i18n';
import { StatusChip } from '@/components/status-chip';
import { STATUS_TONE } from '@/lib/proposal';

const LABELS: Record<ProposalStatus, { en: string; tone: string }> = {
  Voting: { en: 'Voting', tone: 'accent' },
  Revealing: { en: 'Revealing', tone: 'info' },
  Ready: { en: 'Ready to finalize', tone: 'warn' },
  Passed: { en: 'Passed', tone: 'ok' },
  Failed: { en: 'Failed', tone: 'danger' },
  Executed: { en: 'Executed', tone: 'ok' },
  Expired: { en: 'Expired', tone: 'muted' },
};

describe('StatusChip', () => {
  it('covers exactly the 7 statuses of SealedDAO.status', () => {
    expect([...PROPOSAL_STATUSES].sort()).toEqual(Object.keys(LABELS).sort());
  });

  it.each(PROPOSAL_STATUSES)('renders %s with its label, tone and meaning', (status) => {
    const { container } = render(<StatusChip status={status} />);
    const chip = container.querySelector(`[data-status="${status}"]`);
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute('data-tone', LABELS[status].tone);
    expect(chip).toHaveAttribute('data-tone', STATUS_TONE[status]);
    expect(chip?.textContent?.startsWith(LABELS[status].en)).toBe(true);
    // The meaning is announced to screen readers and shown as a tooltip.
    expect(chip).toHaveAttribute('title');
    expect(chip?.querySelector('.sr-only')?.textContent).toContain(chip?.getAttribute('title') ?? '');
  });

  it('renders the Portuguese label when the locale is PT-BR', () => {
    render(
      <I18nProvider initialLocale="pt-BR">
        <StatusChip status="Voting" />
        <StatusChip status="Ready" />
      </I18nProvider>,
    );
    expect(screen.getByText('Em votação')).toBeInTheDocument();
    expect(screen.getByText('Pronta para finalizar')).toBeInTheDocument();
  });
});
