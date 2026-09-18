import type { Metadata } from 'next';
import { ProposalsView } from '@/components/proposal/proposals-view';

export const metadata: Metadata = {
  title: 'Proposals',
  description:
    'SealedDAO proposals: sealed voting status, drand close and reveal rounds, and the revealed tally.',
};

export default function ProposalsPage() {
  return <ProposalsView />;
}
