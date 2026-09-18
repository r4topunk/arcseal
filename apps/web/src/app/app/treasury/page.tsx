import type { Metadata } from 'next';
import { TreasuryView } from '@/components/treasury';

export const metadata: Metadata = {
  title: 'Treasury',
  description: 'SealedDAO treasury in USDC, what is owed to claimers, claim, fund, members and parameters.',
};

export default function TreasuryPage() {
  return <TreasuryView />;
}
