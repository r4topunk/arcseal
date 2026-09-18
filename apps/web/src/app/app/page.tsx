import type { Metadata } from 'next';
import { ProposalsView } from '@/components/proposal/proposals-view';

// /app/ shows the proposal list too, so links to the app root never dead-end.
export const metadata: Metadata = { title: 'Proposals' };

export default function AppIndexPage() {
  return <ProposalsView />;
}
