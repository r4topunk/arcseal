// Local vote receipts: what a voter keeps after sealing so they can reveal their own vote without drand.
// JSON-safe: bigints are written as decimal strings and parsed back to bigint.
import { InvalidInputError } from './errors.js';
import { parseInput, type VoteReceipt, type VoteReceiptInput, voteReceiptSchema } from './schemas.js';
import { hashVote } from './seal.js';

/**
 * Validates a receipt (object or JSON string) and checks that `commitment` equals
 * `hashVote(proposalId, voter, choice, salt)`, so a corrupted or edited receipt is caught before a reveal.
 */
export function parseVoteReceipt(input: unknown): VoteReceipt {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (cause) {
      throw new InvalidInputError('vote receipt', ['not valid JSON'], { cause });
    }
  }
  const receipt = parseInput(voteReceiptSchema, data as VoteReceiptInput, 'vote receipt');
  const expected = hashVote(receipt);
  if (receipt.commitment !== expected) {
    throw new InvalidInputError('vote receipt', [
      `commitment ${receipt.commitment} does not match hashVote(proposalId, voter, choice, salt) = ${expected}`,
    ]);
  }
  return receipt;
}

/** Validates a receipt and writes it as pretty JSON with a fixed key order (bigints as decimal strings). */
export function serializeVoteReceipt(receipt: VoteReceiptInput): string {
  const r = parseVoteReceipt(receipt);
  return JSON.stringify(
    {
      version: r.version,
      chainId: r.chainId,
      dao: r.dao,
      proposalId: r.proposalId.toString(),
      voter: r.voter,
      choice: r.choice,
      salt: r.salt,
      commitment: r.commitment,
      closeRound: r.closeRound.toString(),
      ...(r.txHash === undefined ? {} : { txHash: r.txHash }),
      createdAt: r.createdAt,
    },
    null,
    2,
  );
}
