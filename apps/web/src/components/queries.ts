'use client';

// Chain reads, all through the public RPC client (read-only mode works without a wallet). Every query is disabled
// when no DAO is configured.
import {
  getProposal,
  getStatus,
  type Proposal,
  type ProposalStatus,
  readClaimable,
  readCommitmentOf,
  readIsMember,
  readMemberCount,
  readProposalCount,
  readQuorumBps,
  readRevealBounty,
  readTotalClaimable,
  readUsdc,
  sealedDaoAbi,
  splitBlockRange,
} from '@arcseal/sdk';
import { useQuery } from '@tanstack/react-query';
import { type Abi, type Address, erc20Abi, type Hash, parseEventLogs } from 'viem';
import { estimateContractGas, getBlockNumber, getGasPrice, getLogs, readContract } from 'viem/actions';
import { usePublicClient } from 'wagmi';
import { CHAIN_ID, config } from '@/lib/config';
import { stableJson } from '@/lib/format';

const DAO = config.dao;
const REFRESH_MS = 15_000;

export function useClient() {
  return usePublicClient({ chainId: CHAIN_ID });
}

export interface DaoInfo {
  quorumBps: number;
  revealBounty: bigint;
  memberCount: number;
  usdc: Address;
  proposalCount: bigint;
  totalClaimable: bigint;
}

export function useDaoInfo() {
  const client = useClient();
  return useQuery({
    queryKey: ['dao-info', CHAIN_ID, DAO],
    enabled: !!client && !!DAO,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<DaoInfo> => {
      const dao = DAO!;
      const [quorumBps, revealBounty, memberCount, usdc, proposalCount, totalClaimable] = await Promise.all([
        readQuorumBps(client!, { dao }),
        readRevealBounty(client!, { dao }),
        readMemberCount(client!, { dao }),
        readUsdc(client!, { dao }),
        readProposalCount(client!, { dao }),
        readTotalClaimable(client!, { dao }),
      ]);
      return { quorumBps, revealBounty, memberCount, usdc, proposalCount, totalClaimable };
    },
  });
}

export interface ProposalWithStatus {
  proposal: Proposal;
  status: ProposalStatus;
}

/** The latest `limit` proposals, newest first, each with its derived status. */
export function useProposalList(limit = 50) {
  const client = useClient();
  return useQuery({
    queryKey: ['proposals', CHAIN_ID, DAO, limit],
    enabled: !!client && !!DAO,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<{ total: bigint; items: ProposalWithStatus[] }> => {
      const dao = DAO!;
      const total = await readProposalCount(client!, { dao });
      const ids: bigint[] = [];
      for (let id = total; id >= 1n && ids.length < limit; id--) ids.push(id);
      const items = await Promise.all(
        ids.map(async (proposalId) => {
          const [proposal, status] = await Promise.all([
            getProposal(client!, { dao, proposalId }),
            getStatus(client!, { dao, proposalId }),
          ]);
          return { proposal, status };
        }),
      );
      return { total, items };
    },
  });
}

export function useProposalDetail(id: bigint | null) {
  const client = useClient();
  return useQuery({
    queryKey: ['proposal', CHAIN_ID, DAO, id?.toString()],
    enabled: !!client && !!DAO && id !== null,
    refetchInterval: REFRESH_MS,
    retry: (count, err) => (err as { code?: string }).code !== 'PROPOSAL_NOT_FOUND' && count < 1,
    queryFn: async (): Promise<ProposalWithStatus> => {
      const dao = DAO!;
      const proposal = await getProposal(client!, { dao, proposalId: id! });
      const status = await getStatus(client!, { dao, proposalId: id! });
      return { proposal, status };
    },
  });
}

export function useIsMember(account: Address | undefined) {
  const client = useClient();
  return useQuery({
    queryKey: ['is-member', CHAIN_ID, DAO, account],
    enabled: !!client && !!DAO && !!account,
    queryFn: () => readIsMember(client!, { dao: DAO!, account: account! }),
  });
}

export function useCommitment(id: bigint | null, voter: Address | undefined) {
  const client = useClient();
  return useQuery({
    queryKey: ['commitment', CHAIN_ID, DAO, id?.toString(), voter],
    enabled: !!client && !!DAO && id !== null && !!voter,
    queryFn: () => readCommitmentOf(client!, { dao: DAO!, proposalId: id!, voter: voter! }),
  });
}

export function useClaimable(account: Address | undefined) {
  const client = useClient();
  return useQuery({
    queryKey: ['claimable', CHAIN_ID, DAO, account],
    enabled: !!client && !!DAO && !!account,
    refetchInterval: REFRESH_MS,
    queryFn: () => readClaimable(client!, { dao: DAO!, account: account! }),
  });
}

/** USDC balance in the 6-decimal ERC-20 view. The 18-decimal native view of the same funds is never read. */
export function useUsdcBalance(token: Address | undefined, account: Address | null | undefined) {
  const client = useClient();
  return useQuery({
    queryKey: ['usdc-balance', CHAIN_ID, token, account],
    enabled: !!client && !!token && !!account,
    refetchInterval: REFRESH_MS,
    queryFn: () =>
      readContract(client!, { address: token!, abi: erc20Abi, functionName: 'balanceOf', args: [account!] }),
  });
}

export type DaoEvent = ReturnType<typeof parseEventLogs<typeof sealedDaoAbi>>[number];
type Client = NonNullable<ReturnType<typeof useClient>>;

// Logs already read, per DAO: later refetches only scan the blocks after `toBlock`.
const logCache = new Map<string, { toBlock: bigint; events: DaoEvent[] }>();

/**
 * Every SealedDAO log from the deploy block to the latest block, read in windows of at most 9,999 blocks (Arc's
 * eth_getLogs cap is 10,000), then incrementally on each refetch.
 */
async function scanDaoLogs(client: Client): Promise<DaoEvent[]> {
  const key = `${CHAIN_ID}:${DAO}`;
  const cached = logCache.get(key);
  const latest = await getBlockNumber(client, { cacheTime: 0 });
  const events = cached ? [...cached.events] : [];
  const from = cached ? cached.toBlock + 1n : config.deployBlock;
  if (from <= latest) {
    for (const w of splitBlockRange(from, latest)) {
      const logs = await getLogs(client, { address: DAO!, fromBlock: w.fromBlock, toBlock: w.toBlock });
      events.push(...parseEventLogs({ abi: sealedDaoAbi, logs, strict: true }));
    }
  }
  logCache.set(key, { toBlock: latest > (cached?.toBlock ?? -1n) ? latest : cached!.toBlock, events });
  return events;
}

/** One shared log scan for the timeline and the member list; each view derives its data with `select`. */
function useDaoLogs<T>(select: (events: DaoEvent[]) => T, enabled = true) {
  const client = useClient();
  return useQuery({
    queryKey: ['dao-logs', CHAIN_ID, DAO],
    enabled: !!client && !!DAO && enabled,
    refetchInterval: REFRESH_MS * 2,
    queryFn: () => scanDaoLogs(client!),
    select,
  });
}

export type TimelineEventName =
  | 'ProposalCreated'
  | 'Sealed'
  | 'VoteRevealed'
  | 'RevealSkipped'
  | 'BountyCredited'
  | 'BountySkipped'
  | 'Finalized'
  | 'Executed';

const TIMELINE_EVENTS: readonly string[] = [
  'ProposalCreated',
  'Sealed',
  'VoteRevealed',
  'RevealSkipped',
  'BountyCredited',
  'BountySkipped',
  'Finalized',
  'Executed',
];

export interface TimelineEntry {
  key: string;
  name: TimelineEventName;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hash;
}

/** Pure: the events of proposal `id`, oldest first. The module's `Sealed` log is keyed by `groupId` (= proposal id). */
export function timelineOf(events: readonly DaoEvent[], id: bigint): TimelineEntry[] {
  return events
    .filter((e) => TIMELINE_EVENTS.includes(e.eventName))
    .filter((e) => {
      const a = e.args as Record<string, unknown>;
      return (a.id ?? a.groupId) === id;
    })
    .map((e) => ({
      key: `${e.transactionHash}-${e.logIndex}`,
      name: e.eventName as TimelineEventName,
      args: e.args as Record<string, unknown>,
      blockNumber: e.blockNumber,
      transactionHash: e.transactionHash,
    }));
}

/** Pure: current members, folded from MemberSet events (the constructor emits one per initial member). */
export function membersOf(events: readonly DaoEvent[]): Address[] {
  const members = new Map<string, Address>();
  for (const e of events) {
    if (e.eventName !== 'MemberSet') continue;
    if (e.args.isMember) members.set(e.args.account.toLowerCase(), e.args.account);
    else members.delete(e.args.account.toLowerCase());
  }
  return [...members.values()];
}

export function useTimeline(id: bigint | null) {
  return useDaoLogs((events) => (id === null ? [] : timelineOf(events, id)), id !== null);
}

export function useMembers() {
  return useDaoLogs(membersOf);
}

export interface FeeRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  account: Address;
}

/** Gas x gas price for a call, in 18-decimal native units (convert with nativeFeeToUsdcUnits). Null if it would revert. */
export function useFeeEstimate(req: FeeRequest | null) {
  const client = useClient();
  return useQuery({
    queryKey: ['fee', CHAIN_ID, req ? stableJson({ ...req, abi: undefined }) : null],
    enabled: !!client && !!req,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<bigint | null> => {
      try {
        const [gas, gasPrice] = await Promise.all([
          estimateContractGas(client!, {
            address: req!.address,
            abi: req!.abi,
            functionName: req!.functionName,
            args: req!.args,
            account: req!.account,
          }),
          getGasPrice(client!),
        ]);
        return gas * gasPrice;
      } catch {
        return null;
      }
    },
  });
}
