import type { Metadata } from 'next';
import { NewProposalView } from '@/components/new-proposal';

export const metadata: Metadata = {
  title: 'New proposal',
  description: 'Create a SealedDAO proposal: transfer USDC from the treasury or add or remove a member.',
};

export default function NewProposalPage() {
  return <NewProposalView />;
}
