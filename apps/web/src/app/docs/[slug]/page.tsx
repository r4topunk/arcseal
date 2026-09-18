import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocPage } from '@/components/docs';
import { config } from '@/lib/config';
import { docSlugs, loadAllDocs, loadDoc } from '@/lib/docs';

export const dynamicParams = false;

/** One static page per markdown file in content/en (the PT-BR file of the same name is its translation). */
export function generateStaticParams() {
  return docSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = loadDoc(slug);
  return doc ? { title: doc.versions.en.title, description: doc.versions.en.summary } : {};
}

export default async function DocRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = loadDoc(slug);
  if (!doc) notFound();
  const all = loadAllDocs().map((d) => ({
    slug: d.slug,
    titles: { en: d.versions.en.title, 'pt-BR': d.versions['pt-BR'].title },
  }));
  return <DocPage doc={doc} all={all} repoUrl={config.repoUrl} />;
}
