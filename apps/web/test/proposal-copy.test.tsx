import type { Proposal } from '@arcseal/sdk';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import NotFound from '@/app/not-found';
import { I18nProvider } from '@/components/i18n';
import { DescriptionLink } from '@/components/proposal/proposal-detail';
import { PaymentNote } from '@/components/proposal/reveal-panel';

const proposal = (sealedCount: number, memberSnapshot: number) =>
  ({ sealedCount, memberSnapshot, closeRound: 32_000_000n }) as Proposal;

describe('reveal payment note (audit F1: paid only when the proposal met quorum)', () => {
  it('states the payment per revealed vote when quorum is met', () => {
    render(<PaymentNote proposal={proposal(2, 4)} bounty={10_000n} quorumBps={5_000} />);
    expect(
      screen.getByText(/met quorum, so the treasury credits 0\.010000 USDC per revealed vote/),
    ).toBeInTheDocument();
  });

  it('says no payment is credited below quorum, in both languages', () => {
    const { unmount } = render(<PaymentNote proposal={proposal(1, 4)} bounty={10_000n} quorumBps={5_000} />);
    expect(screen.getByText(/did not meet quorum, so it cannot pass/)).toBeInTheDocument();
    unmount();
    render(
      <I18nProvider initialLocale="pt-BR">
        <PaymentNote proposal={proposal(1, 4)} bounty={10_000n} quorumBps={5_000} />
      </I18nProvider>,
    );
    expect(screen.getByText(/não atingiu o quórum/)).toBeInTheDocument();
  });

  it('renders nothing when the DAO pays no reveal payment', () => {
    const { container } = render(<PaymentNote proposal={proposal(4, 4)} bounty={0n} quorumBps={5_000} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('description link from chain data (audit F8)', () => {
  it('links https:// URIs', () => {
    render(<DescriptionLink uri="https://example.org/proposal-1" />);
    expect(screen.getByRole('link', { name: /Full description/ })).toHaveAttribute(
      'href',
      'https://example.org/proposal-1',
    );
  });

  it('shows any other scheme as inert text, never as a link', () => {
    render(<DescriptionLink uri="javascript:alert(document.domain)//" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('javascript:alert(document.domain)//')).toBeInTheDocument();
  });
});

describe('404 page and tab titles (P4 product review: PT-BR parity)', () => {
  it('follows the language, tab title included', () => {
    render(
      <I18nProvider initialLocale="pt-BR">
        <NotFound />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument();
    expect(document.title).toBe('Página não encontrada · ArcSeal');
    expect(screen.getByRole('link', { name: 'Todas as propostas' }).getAttribute('href')).toMatch(
      /^\/app\/proposals\/?$/,
    );
  });
});
