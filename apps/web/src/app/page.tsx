'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/components/i18n';
import { buttonVariants } from '@/components/ui/button';
import { config } from '@/lib/config';

/**
 * Local entry point only. On GitHub Pages the project page (site/index.html) is copied over this route's
 * index.html, so the app itself lives at /app/proposals/.
 */
export default function Home() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-24 sm:px-6">
      <span className="kicker">{t('app.tagline')}</span>
      <h1 className="font-semibold text-5xl tracking-tight">ArcSeal</h1>
      <p className="max-w-xl text-lg text-muted">{t('home.lead')}</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/app/proposals/" className={buttonVariants({ variant: 'accent', size: 'lg' })}>
          {t('home.openApp')} <ArrowRight />
        </Link>
        <Link href="/docs/" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          {t('home.docs')}
        </Link>
        <a href={`${config.siteUrl}/`} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
          {t('nav.project')}
        </a>
      </div>
    </div>
  );
}
