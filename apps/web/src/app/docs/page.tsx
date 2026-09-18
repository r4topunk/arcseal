import type { Metadata } from 'next';
import { DocsIndex } from '@/components/docs';
import { loadAllDocs } from '@/lib/docs';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'ArcSeal integration guide, FAQ and specification summary, in English and Portuguese.',
};

export default function DocsIndexPage() {
  return <DocsIndex docs={loadAllDocs()} />;
}
