'use client';

import { ShieldCheck } from 'lucide-react';
import { formatInt } from '@/lib/format';
import { useI18n } from '../i18n';

/** D17, stated plainly next to the vote button: secret during voting, public per address after the reveal. */
export function PrivacyNote({ closeRound }: { closeRound: bigint }) {
  const { t } = useI18n();
  return (
    <aside aria-labelledby="privacy-title" className="flex gap-3 rounded-lg bg-accent-soft p-4 text-sm">
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="flex flex-col gap-1">
        <h3 id="privacy-title" className="font-semibold text-accent">
          {t('privacy.title')}
        </h3>
        <p className="text-foreground/85">{t('privacy.body', { round: formatInt(closeRound) })}</p>
      </div>
    </aside>
  );
}
