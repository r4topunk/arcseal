// "Reveal every sealed vote of proposal N" with the SDK (PRD D9): decrypt in this process, then one revealBatch per
// chunk of at most 256 items. Shared by the e2e flow and reveal-cli.ts (the optional reference relayer).
import {
  type BeaconSource,
  buildRevealBatch,
  type Logger,
  MAX_REVEAL_BATCH,
  type RevealBatch,
  revealBatch,
  sealedDaoAbi,
  type UnsealProposalResult,
  unsealProposal,
  type WriteClient,
} from '@arcseal/sdk';
import {
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  parseEventLogs,
  type TransactionReceipt,
} from 'viem';

export interface RevealPlan {
  unsealed: UnsealProposalResult;
  batches: RevealBatch[];
}

/**
 * Reads the proposal's `Sealed` logs from `fromBlock` (pass the proposal's block, or the DAO deploy block), gets the
 * close-round beacon once, decrypts every vote and keeps those whose hash matches the live commitment.
 */
export async function planReveal(params: {
  client: PublicClient;
  dao: Address;
  proposalId: bigint;
  fromBlock: bigint;
  beaconSource?: BeaconSource | undefined;
  logger?: Logger | undefined;
}): Promise<RevealPlan> {
  const unsealed = await unsealProposal(params);
  return { unsealed, batches: buildRevealBatch(unsealed.items) };
}

/** Never seals in a real DAO, so its reveal item has no commitment to match and is always skipped onchain. */
export const GARBAGE_VOTER: Address = '0x000000000000000000000000000000000000dEaD';
const GARBAGE_SALT: Hex = `0x${'ab'.repeat(32)}`;

/**
 * Appends one item that cannot match any commitment, for PRD 10.2's negative proof ("a revealBatch containing one
 * garbage item that gets skipped"). The contract emits RevealSkipped for it and still counts the valid items. Goes
 * into the last batch, or a new one when there is none or the last is full.
 */
export function withGarbageItem(batches: RevealBatch[]): RevealBatch[] {
  const last = batches.at(-1);
  if (!last || last.voters.length >= MAX_REVEAL_BATCH) {
    return [...batches, { voters: [GARBAGE_VOTER], choices: [0], salts: [GARBAGE_SALT] }];
  }
  return [
    ...batches.slice(0, -1),
    {
      voters: [...last.voters, GARBAGE_VOTER],
      choices: [...last.choices, 0],
      salts: [...last.salts, GARBAGE_SALT],
    },
  ];
}

/** Sends one planned batch. Items the contract cannot match are skipped onchain (RevealSkipped), never reverted. */
export function sendRevealBatch(
  wallet: WriteClient,
  params: { dao: Address; proposalId: bigint; batch: RevealBatch },
): Promise<Hash> {
  return revealBatch(wallet, { dao: params.dao, proposalId: params.proposalId, ...params.batch });
}

export interface RevealOutcome {
  revealed: number;
  skipped: Address[];
  bounty: bigint;
  bountySkipped: boolean;
}

/** What a revealBatch receipt did: votes counted, items skipped, bounty credited to the caller (or skipped). */
export function revealOutcome(receipt: TransactionReceipt): RevealOutcome {
  const events = parseEventLogs({ abi: sealedDaoAbi, logs: receipt.logs });
  let bounty = 0n;
  let bountySkipped = false;
  const skipped: Address[] = [];
  let revealed = 0;
  for (const e of events) {
    if (e.eventName === 'VoteRevealed') revealed++;
    else if (e.eventName === 'RevealSkipped') skipped.push(e.args.voter);
    else if (e.eventName === 'BountyCredited') bounty += e.args.amount;
    else if (e.eventName === 'BountySkipped') bountySkipped = true;
  }
  return { revealed, skipped, bounty, bountySkipped };
}

/**
 * The bounty part of a revealBatch summary. SealedDAO emits BountyCredited or BountySkipped only for a proposal that
 * met quorum; a call that revealed votes with neither event was below quorum (or the DAO pays no bounty).
 */
export function describeBounty(
  out: RevealOutcome,
  formatUsdc: (units: bigint) => string,
  credited: string,
): string {
  if (out.bountySkipped) return 'bounty skipped (treasury short)';
  if (out.bounty === 0n && out.revealed > 0) return 'no bounty (proposal below quorum, or no bounty set)';
  return `bounty ${formatUsdc(out.bounty)} ${credited}`;
}
