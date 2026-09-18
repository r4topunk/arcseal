import { describe, expect, it } from 'vitest';
import {
  markdownSummary,
  markdownTitle,
  type RenderOptions,
  renderMarkdown,
  resolveHref,
} from '@/lib/markdown';

const opts: RenderOptions = {
  file: 'apps/web/content/en/faq.md',
  slugForFile: (p) => (p === 'apps/web/content/en/spec.md' ? 'spec' : null),
  basePath: '/arcseal',
  repoUrl: 'https://github.com/r4topunk/arcseal',
};

describe('docs markdown', () => {
  it('prefixes site paths with the basePath and maps doc files to /docs/<slug>/', () => {
    expect(resolveHref('/docs/spec/#timing', opts)).toEqual({
      href: '/arcseal/docs/spec/#timing',
      external: false,
    });
    expect(resolveHref('./spec.md#timing', opts)).toEqual({
      href: '/arcseal/docs/spec/#timing',
      external: false,
    });
    expect(resolveHref('#top', opts)).toEqual({ href: '#top', external: false });
  });

  it('sends repo files and absolute URLs out of the site', () => {
    expect(resolveHref('../../../../docs/GAS.md', opts)).toEqual({
      href: 'https://github.com/r4topunk/arcseal/blob/main/docs/GAS.md',
      external: true,
    });
    expect(resolveHref('https://drand.love', opts)).toEqual({ href: 'https://drand.love', external: true });
  });

  it('drops the H1, collects headings, escapes code and wraps tables', () => {
    const md =
      '# FAQ\n\nIntro with a [link](/app/).\n\n## Até quando?\n\n```ts\nconst a = 1 < 2;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
    const { html, headings } = renderMarkdown(md, opts);
    expect(html).not.toContain('<h1');
    expect(headings).toEqual([{ id: 'ate-quando', text: 'Até quando?', depth: 2 }]);
    expect(html).toContain('href="/arcseal/app/"');
    expect(html).toContain('1 &lt; 2');
    expect(html).toContain('<div class="table-wrap">');
    expect(markdownTitle(md)).toBe('FAQ');
    expect(markdownSummary(md)).toBe('Intro with a link.');
  });
});
