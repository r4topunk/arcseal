'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount, useSwitchChain } from 'wagmi';
import { CHAIN_ID, config } from '@/lib/config';
import { useMounted } from '@/lib/hooks';
import type { MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ConnectButton } from './connect-button';
import { LocaleToggle, useI18n } from './i18n';
import { Button } from './ui/button';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="8" className="fill-accent" />
        <path d="M8 11.5h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 8 22.5z" fill="white" />
        <path d="M8 11.5 16 18l8-6.5" fill="none" stroke="#2f6bae" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="16" cy="18.5" r="3.4" fill="#121826" />
      </svg>
      <span className="font-semibold text-base tracking-tight">ArcSeal</span>
    </span>
  );
}

const NAV: { href: string; key: MessageKey; match: string }[] = [
  { href: '/app/proposals/', key: 'nav.proposals', match: '/app/proposal' },
  { href: '/app/new/', key: 'nav.new', match: '/app/new' },
  { href: '/app/treasury/', key: 'nav.treasury', match: '/app/treasury' },
  { href: '/docs/', key: 'nav.docs', match: '/docs' },
];

export function SiteHeader() {
  const { t } = useI18n();
  const pathname = usePathname() ?? '';
  const links = NAV.map((n) => {
    const active = pathname.startsWith(n.match);
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors',
          active ? 'bg-surface-2 font-medium text-foreground' : 'text-muted hover:text-foreground',
        )}
      >
        {t(n.key)}
      </Link>
    );
  });
  return (
    <header className="sticky top-0 z-40 border-hairline border-b bg-background/90 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:rounded focus:bg-foreground focus:px-3 focus:py-1 focus:text-background"
      >
        {t('nav.skip')}
      </a>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link href="/app/proposals/" aria-label={t('nav.home')} className="mr-3 shrink-0">
          <Logo />
        </Link>
        <nav aria-label={t('nav.main')} className="hidden items-center gap-1 md:flex">
          {links}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LocaleToggle />
          <ConnectButton />
        </div>
      </div>
      <nav
        aria-label={t('nav.main')}
        className="flex gap-1 overflow-x-auto border-hairline border-t px-3 py-1.5 md:hidden"
      >
        {links}
      </nav>
      <ConfigBanner />
      <NetworkBanner />
    </header>
  );
}

function ConfigBanner() {
  const { t } = useI18n();
  if (config.problems.length === 0) return null;
  return (
    <div role="status" className="border-hairline border-t bg-warn-soft text-warn">
      <div className="mx-auto flex max-w-6xl gap-2 px-4 py-2 text-sm sm:px-6">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-medium">{t('banner.config')}</span> {config.problems.join(' ')}
        </p>
      </div>
    </div>
  );
}

/** Shown when a wallet is connected on another chain. Reads keep working over the configured RPC. */
export function NetworkBanner() {
  const mounted = useMounted();
  const { t } = useI18n();
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  if (!mounted || !isConnected || chainId === CHAIN_ID) return null;
  return (
    <div role="alert" className="border-hairline border-t bg-danger-soft text-danger">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6">
        <p className="flex items-center gap-2">
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {t('banner.wrongNetwork', { current: chainId ?? '?', chain: config.chainLabel, chainId: CHAIN_ID })}
        </p>
        <Button
          size="sm"
          variant="danger"
          disabled={isPending}
          onClick={() => switchChain({ chainId: CHAIN_ID })}
        >
          {t('banner.switch')}
        </Button>
      </div>
    </div>
  );
}

export function SiteFooter() {
  const { t } = useI18n();
  const linkClass = 'text-muted hover:text-foreground';
  return (
    <footer className="mt-24 border-hairline border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-xs text-muted">{t('footer.tagline')}</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">{t('footer.product')}</span>
          <Link href="/app/proposals/" className={linkClass}>
            {t('nav.proposals')}
          </Link>
          <Link href="/app/new/" className={linkClass}>
            {t('nav.new')}
          </Link>
          <Link href="/app/treasury/" className={linkClass}>
            {t('nav.treasury')}
          </Link>
        </div>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">{t('footer.docs')}</span>
          <Link href="/docs/integration/" className={linkClass}>
            {t('docs.nav.integration')}
          </Link>
          <Link href="/docs/faq/" className={linkClass}>
            {t('docs.nav.faq')}
          </Link>
          <Link href="/docs/spec/" className={linkClass}>
            {t('docs.nav.spec')}
          </Link>
        </div>
        <div className="flex flex-col gap-2">
          <span className="eyebrow">{t('footer.open')}</span>
          <a href={`${config.siteUrl}/`} className={linkClass}>
            {t('nav.project')}
          </a>
          <a href={config.repoUrl} target="_blank" rel="noreferrer" className={linkClass}>
            {t('footer.source')}
          </a>
          <a
            href={`${config.repoUrl}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
          >
            {t('footer.license')}
          </a>
          <a href="https://docs.arc.io" target="_blank" rel="noreferrer" className={linkClass}>
            {t('footer.arcDocs')}
          </a>
        </div>
      </div>
      <div className="border-hairline border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 text-muted text-xs sm:px-6">
          <p>{t('dao.nonGoals')}</p>
          <p>{t('footer.noBackend')}</p>
        </div>
      </div>
    </footer>
  );
}
