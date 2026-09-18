import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/components/i18n';
import { NewProposalForm } from '@/components/new-proposal';

function setup(locale: 'en' | 'pt-BR' = 'en') {
  const onSubmit = vi.fn();
  render(
    <I18nProvider initialLocale={locale}>
      <NewProposalForm onSubmit={onSubmit} freeUsdc={2_000_000n} />
    </I18nProvider>,
  );
  return onSubmit;
}

describe('NewProposalForm', () => {
  it('shows inline errors on submit and does not call onSubmit', () => {
    const onSubmit = setup();
    expect(screen.getByText('Free treasury now: 2.000000 USDC.', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create proposal/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(['Enter an address.', 'Enter an amount.', 'Describe the proposal.']);
    expect(screen.getByLabelText('Recipient address')).toHaveAttribute('aria-invalid', 'true');
  });

  it('counts description bytes live and flags more than 256', () => {
    setup();
    const description = screen.getByLabelText('Description');
    fireEvent.change(description, { target: { value: 'ã'.repeat(100) } });
    expect(screen.getByTestId('byte-counter')).toHaveTextContent('200 / 256 bytes');
    fireEvent.change(description, { target: { value: 'ã'.repeat(129) } });
    expect(screen.getByTestId('byte-counter')).toHaveTextContent('258 / 256 bytes');
    expect(screen.getByTestId('byte-counter').className).toContain('text-danger');
    fireEvent.click(screen.getByRole('button', { name: /create proposal/i }));
    expect(screen.getByText(/The description is 258 bytes and the limit is 256/)).toBeInTheDocument();
  });

  it('submits SetMember arguments without an amount', () => {
    const onSubmit = setup();
    fireEvent.click(screen.getByLabelText('Add or remove a member'));
    fireEvent.click(screen.getByLabelText('Remove from the members'));
    fireEvent.change(screen.getByLabelText('Member address'), {
      target: { value: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' },
    });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Remove a member' } });
    fireEvent.click(screen.getByLabelText('7 days'));
    fireEvent.click(screen.getByRole('button', { name: /create proposal/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'SetMember',
      target: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: 0n,
      flag: false,
      description: 'Remove a member',
      descriptionURI: '',
      votingSeconds: 604_800,
    });
  });

  it('renders labels and errors in Portuguese', () => {
    setup('pt-BR');
    fireEvent.click(screen.getByRole('button', { name: /criar proposta/i }));
    expect(screen.getByText('Informe um endereço.')).toBeInTheDocument();
    expect(screen.getByLabelText('Endereço do destinatário')).toBeInTheDocument();
  });
});
