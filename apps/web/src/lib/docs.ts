// Docs pages (PRD 6 page 6): rendered at build time from apps/web/content/<locale>/<slug>.md. Server-only (node:fs).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { LOCALES, type Locale } from './i18n';
import { type Heading, markdownSummary, markdownTitle, renderMarkdown } from './markdown';

const CONTENT_DIR = path.join(process.cwd(), 'content');
const REPO_CONTENT = 'apps/web/content';
/** Known docs first, in this order; any other file in content/en follows alphabetically. */
const ORDER = ['integration', 'faq', 'spec'];

export interface RenderedDoc {
  locale: Locale;
  /** False when this locale has no file and the English text is shown instead. */
  translated: boolean;
  title: string;
  summary: string;
  html: string;
  headings: Heading[];
  file: string;
}

export interface DocEntry {
  slug: string;
  versions: Record<Locale, RenderedDoc>;
}

const fileFor = (locale: Locale, slug: string) => path.join(CONTENT_DIR, locale, `${slug}.md`);

/** Doc slugs: every .md file in content/en (the source language), known docs first. */
export function docSlugs(): string[] {
  const dir = path.join(CONTENT_DIR, 'en');
  const found = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(0, -3))
    : [];
  const known = ORDER.filter((s) => found.includes(s));
  const rest = found.filter((s) => !ORDER.includes(s)).sort();
  return [...known, ...rest];
}

function slugForFile(repoPath: string): string | null {
  const m = new RegExp(`^${REPO_CONTENT}/(?:en|pt-BR)/([a-z0-9-]+)\\.md$`).exec(repoPath);
  return m?.[1] && docSlugs().includes(m[1]) ? m[1] : null;
}

function render(slug: string, locale: Locale): RenderedDoc {
  const own = fileFor(locale, slug);
  const translated = existsSync(own);
  const source = readFileSync(translated ? own : fileFor('en', slug), 'utf8');
  const file = `${REPO_CONTENT}/${translated ? locale : 'en'}/${slug}.md`;
  const { html, headings } = renderMarkdown(source, {
    file,
    slugForFile,
    basePath: config.basePath,
    repoUrl: config.repoUrl,
  });
  return {
    locale,
    translated: locale === 'en' || translated,
    title: markdownTitle(source) ?? slug,
    summary: markdownSummary(source),
    html,
    headings,
    file,
  };
}

export function loadDoc(slug: string): DocEntry | null {
  if (!docSlugs().includes(slug)) return null;
  const versions = Object.fromEntries(LOCALES.map((l) => [l, render(slug, l)])) as Record<
    Locale,
    RenderedDoc
  >;
  return { slug, versions };
}

export function loadAllDocs(): DocEntry[] {
  return docSlugs()
    .map((s) => loadDoc(s))
    .filter((d): d is DocEntry => d !== null);
}
