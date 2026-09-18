import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProposalDetail } from '@/components/proposal/proposal-detail';
import { Skeleton } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Proposal',
  description:
    'One SealedDAO proposal: seal a vote, reveal all votes in the browser, finalize, execute, and its event timeline.',
};

// Static export cannot pre-render unknown proposal ids, so this one page reads ?id=N on the client.
export default function ProposalPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <ProposalDetail />
    </Suspense>
  );
}
