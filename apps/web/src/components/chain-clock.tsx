'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { getBlock } from 'viem/actions';
import { CHAIN_ID, config } from '@/lib/config';
import { ClockOffsetContext } from '@/lib/hooks';
import { useClient } from './queries';

/** Offsets below this are network latency and block time, not a clock disagreement. */
const MIN_OFFSET_SECONDS = 10;

/** Pure: the offset to apply, or 0 when the chain and local clocks agree within the tolerance. */
export function clockOffset(latestBlockTimestamp: number, localSeconds: number): number {
  const offset = Math.round(latestBlockTimestamp - localSeconds);
  return Math.abs(offset) < MIN_OFFSET_SECONDS ? 0 : offset;
}

/** Measures the chain clock once a minute (only when a DAO is configured) and shares the offset with useNow. */
export function ChainClockProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const { data } = useQuery({
    queryKey: ['chain-clock', CHAIN_ID],
    enabled: !!client && !!config.dao,
    refetchInterval: 60_000,
    queryFn: async () => {
      const block = await getBlock(client!, { blockTag: 'latest' });
      return clockOffset(Number(block.timestamp), Date.now() / 1000);
    },
  });
  return <ClockOffsetContext.Provider value={data ?? 0}>{children}</ClockOffsetContext.Provider>;
}
