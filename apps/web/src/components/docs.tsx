'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader } from './app-states';
import { useDocumentTitle, useI18n } from './i18n';

/** What the server passes to the client per doc and locale (plain JSON). */
export interface DocView {
  slug: string;
  versions: Record<
    Locale,
    {
      translated: boolean;
      title: string;
      summary: string;
      html: string;
      headings: { id: string; text: string; depth: number }[];
      file: string;
    }
  >;
}

export function DocsIndex({ docs }: { docs: DocView[] }) {
  const { t, locale } = useI18n();
  useDocumentTitle(t('nav.docs'));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeader eyebrow={t('docs.eyebrow')} title={t('docs.title')}>
        {t('docs.lead')}
      </PageHeader>
      <div className="grid gap-3 md:grid-cols-3">
        {docs.map((d) => {
          const v = d.versions[locale];
          return (
            <Link
              key={d.slug}
              href={`/docs/${d.slug}/`}
              className="group flex flex-col gap-2 rounded-xl border border-hairline-strong bg-surface p-5 transition-colors hover:border-foreground/40"
            >
              <span className="flex items-center justify-between gap-2 font-semibold">
                {v.title}
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                />
              </span>
              <span className="text-muted text-sm">{v.summary}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export interface DocLink {
  slug: string;
  titles: Record<Locale, string>;
}

/** One doc: both languages are rendered at build time; the locale toggle picks which one is shown. */
export function DocPage({ doc, all, repoUrl }: { doc: DocView; all: DocLink[]; repoUrl: string }) {
  const { t, locale } = useI18n();
  const v = doc.versions[locale];
  useDocumentTitle(v.title);
  const toc = v.headings.filter((h) => h.depth === 2);
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[190px_minmax(0,1fr)_190px]">
      <aside className="lg:sticky lg:top-20 lg:self-start" aria-label={t('docs.title')}>
        <nav className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
          <Link href="/docs/" className="eyebrow mb-2 hidden lg:block">
            {t('docs.title')}
          </Link>
          {all.map((d) => (
            <Link
              key={d.slug}
              href={`/docs/${d.slug}/`}
              aria-current={d.slug === doc.slug ? 'page' : undefined}
              className={cn(
                'shrink-0 rounded-lg px-3 py-1.5 text-sm',
                d.slug === doc.slug
                  ? 'bg-surface-2 font-medium text-foreground'
                  : 'text-muted hover:text-foreground',
              )}
            >
              {d.titles[locale]}
            </Link>
          ))}
        </nav>
      </aside>

      <article className="min-w-0" lang={v.translated ? locale : 'en'}>
        <header className="mb-8 flex flex-col gap-2 border-hairline border-b pb-6">
          <span className="kicker">{t('docs.eyebrow')}</span>
          <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">{v.title}</h1>
          {!v.translated ? <p className="text-muted text-sm">{t('docs.fallback')}</p> : null}
          <a
            href={`${repoUrl}/blob/main/${v.file}`}
            target="_blank"
            rel="noreferrer"
            className="w-fit font-mono text-muted text-xs underline underline-offset-2 hover:text-accent"
          >
            {t('docs.source', { file: v.file })}
          </a>
        </header>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: markdown from this repo, rendered at build time */}
        <div className="prose" dangerouslySetInnerHTML={{ __html: v.html }} />
      </article>

      {toc.length > 1 ? (
        <aside
          className="hidden lg:sticky lg:top-20 lg:block lg:self-start"
          aria-label={t('docs.onThisPage')}
        >
          <p className="eyebrow mb-3">{t('docs.onThisPage')}</p>
          <ul className="flex max-h-[calc(100dvh-8rem)] flex-col gap-1.5 overflow-y-auto text-sm">
            {toc.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`} className="text-muted hover:text-foreground">
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
