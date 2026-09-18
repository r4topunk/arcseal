// Markdown to HTML for the docs pages, run at build time. Pure (no fs) so it is unit-tested. Links are rewritten
// because the raw HTML bypasses next/link: internal paths get the basePath, links to other docs become /docs/<slug>/,
// and repo-relative files point at the repository.
import path from 'node:path';
import { Marked, type Tokens } from 'marked';

export interface Heading {
  id: string;
  text: string;
  depth: number;
}

export interface RenderOptions {
  /** Repo-relative path of the markdown file, e.g. apps/web/content/en/faq.md. */
  file: string;
  /** Doc slug for a repo-relative markdown path, if that file is a rendered doc. */
  slugForFile: (repoPath: string) => string | null;
  basePath: string;
  repoUrl: string;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Resolves one href from a doc. Returns the final URL and whether it leaves the site. */
export function resolveHref(href: string, opts: RenderOptions): { href: string; external: boolean } {
  if (/^(https?:|mailto:)/i.test(href)) return { href, external: true };
  if (href.startsWith('#')) return { href, external: false };
  if (href.startsWith('/')) return { href: `${opts.basePath}${href}`, external: false };
  const [target = '', hash] = href.split('#');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(opts.file), target));
  const suffix = hash ? `#${hash}` : '';
  const slug = opts.slugForFile(resolved);
  if (slug) return { href: `${opts.basePath}/docs/${slug}/${suffix}`, external: false };
  return { href: `${opts.repoUrl}/blob/main/${resolved.replace(/^\/+/, '')}${suffix}`, external: true };
}

type Parser = { parser: { parseInline: (t: Tokens.Generic[]) => string } };

/** Renders markdown (without its first H1, which the page shows) and collects h2/h3 headings for the table of contents. */
export function renderMarkdown(source: string, opts: RenderOptions): { html: string; headings: Heading[] } {
  const md = source.replace(/^\s*# .*(\r?\n|$)/, '');
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(this: Parser, token: Tokens.Heading) {
        const text = this.parser.parseInline(token.tokens);
        let id = slugify(token.text) || 'section';
        const count = seen.get(id) ?? 0;
        seen.set(id, count + 1);
        if (count) id = `${id}-${count}`;
        if (token.depth <= 3)
          headings.push({ id, text: token.text.replace(/[`*]/g, ''), depth: token.depth });
        return `<h${token.depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${token.depth}>\n`;
      },
      link(this: Parser, token: Tokens.Link) {
        const { href, external } = resolveHref(token.href, opts);
        const text = this.parser.parseInline(token.tokens);
        return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${text}</a>`;
      },
      table(this: Parser, token: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: 'th' | 'td') =>
          `<${tag}${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = token.header.map((c) => cell(c, 'th')).join('');
        const body = token.rows.map((row) => `<tr>${row.map((c) => cell(c, 'td')).join('')}</tr>`).join('');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
      },
      code(token: Tokens.Code) {
        const lang = token.lang ? escapeHtml(token.lang) : '';
        return `<pre${lang ? ` data-lang="${lang}"` : ''}><code>${escapeHtml(token.text)}</code></pre>`;
      },
    },
  });
  const html = marked.parse(md, { async: false }) as string;
  return { html, headings };
}

/** The first H1 of a markdown file, or null. */
export function markdownTitle(source: string): string | null {
  const m = /^\s*# (.+)$/m.exec(source);
  return m?.[1]?.replace(/[`*_]/g, '').trim() ?? null;
}

/** The first paragraph after the H1, as plain text, for doc cards. */
export function markdownSummary(source: string, max = 180): string {
  const lines = source.replace(/^\s*# .*(\r?\n|$)/, '').split(/\r?\n/);
  const para: string[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (l === '') {
      if (para.length) break;
      continue;
    }
    if (/^(#|>|\||```|- |\* |\d+\. |<)/.test(l)) {
      if (para.length) break;
      continue;
    }
    para.push(l);
  }
  const text = para
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_]/g, '');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
