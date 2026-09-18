import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider, LOCALE_STORAGE_KEY, LocaleToggle, readStoredLocale, useI18n } from '@/components/i18n';
import { MESSAGES, type MessageKey, translate } from '@/lib/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dictionaries', () => {
  it('has every English key in Portuguese, and no extra ones', () => {
    const en = Object.keys(MESSAGES.en).sort();
    const pt = Object.keys(MESSAGES['pt-BR']).sort();
    expect(pt).toEqual(en);
  });

  it('has no empty strings and the same placeholders in both languages', () => {
    for (const key of Object.keys(MESSAGES.en) as MessageKey[]) {
      expect(MESSAGES.en[key].trim(), key).not.toBe('');
      expect(MESSAGES['pt-BR'][key].trim(), key).not.toBe('');
      expect(placeholders(MESSAGES['pt-BR'][key]), key).toEqual(placeholders(MESSAGES.en[key]));
    }
  });

  it('never frames the reveal payment as a reward or as earnings (PRD 2.3)', () => {
    const text = (s: string) => s.replace(/\{\w+\}/g, ''); // placeholder names are not copy
    for (const key of Object.keys(MESSAGES.en) as MessageKey[]) {
      expect(text(MESSAGES.en[key]), key).not.toMatch(
        /\b(earn|earns|earned|earning|reward|rewards|bounty)\b/i,
      );
      expect(text(MESSAGES['pt-BR'][key]), key).not.toMatch(/recompensa|ganh[ae]|prêmio por/i);
    }
  });

  it('fills placeholders and leaves unknown ones as written', () => {
    expect(translate('en', 'proposals.item', { id: 7 })).toBe('Proposal #7');
    expect(translate('pt-BR', 'proposals.item', { id: 7n })).toBe('Proposta #7');
    expect(translate('en', 'proposals.item')).toBe('Proposal #{id}');
  });
});

function Probe() {
  const { t } = useI18n();
  return <p>{t('nav.proposals')}</p>;
}

describe('locale toggle', () => {
  afterEach(() => window.localStorage.clear());

  it('switches the language and stores it under the key shared with the project page', () => {
    render(
      <I18nProvider>
        <LocaleToggle />
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText('Proposals')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PT-BR' }));
    expect(screen.getByText('Propostas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PT-BR' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pt');
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('reads the stored choice (site value "pt") and defaults to English', () => {
    expect(readStoredLocale()).toBe('en');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'pt');
    expect(readStoredLocale()).toBe('pt-BR');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'xx');
    expect(readStoredLocale()).toBe('en');
  });
});
