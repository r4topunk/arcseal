import { type Address, getAddress, type Hex, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  buildRevealBatch,
  CHOICES,
  InvalidInputError,
  LOG_WINDOW_BLOCKS,
  MAX_REVEAL_BATCH,
  type RevealItemInput,
  splitBlockRange,
} from '../src/index.js';

const voter = (i: number): Address => getAddress(toHex(i + 1, { size: 20 }));
const salt = (i: number): Hex => toHex(i + 1, { size: 32 });
const items = (n: number): RevealItemInput[] =>
  Array.from({ length: n }, (_, i) => ({ voter: voter(i), choice: CHOICES[i % 3]!, salt: salt(i) }));

describe('buildRevealBatch', () => {
  it.each([
    [0, []],
    [1, [1]],
    [256, [256]],
    [257, [256, 1]],
    [600, [256, 256, 88]],
  ])('%i items -> batches of %j', (n, sizes) => {
    const batches = buildRevealBatch(items(n));
    expect(batches.map((b) => b.voters.length)).toEqual(sizes);
    for (const b of batches) {
      expect(b.choices).toHaveLength(b.voters.length);
      expect(b.salts).toHaveLength(b.voters.length);
    }
    // Order is kept across batches, and choices become the Solidity enum values.
    expect(batches.flatMap((b) => b.voters)).toEqual(items(n).map((x) => x.voter));
    expect(batches.flatMap((b) => b.choices)).toEqual(items(n).map((_, i) => i % 3));
    expect(batches.flatMap((b) => b.salts)).toEqual(items(n).map((x) => x.salt));
  });

  it('caps a batch at MAX_REVEAL_BATCH = 256 and honours a smaller size', () => {
    expect(MAX_REVEAL_BATCH).toBe(256);
    expect(buildRevealBatch(items(10), { size: 4 }).map((b) => b.voters.length)).toEqual([4, 4, 2]);
    for (const size of [0, 257, 1.5]) {
      expect(() => buildRevealBatch(items(1), { size })).toThrow(InvalidInputError);
    }
  });

  it('checksums voters, lowercases salts and accepts a zero salt (the contract checks the hash)', () => {
    const [batch] = buildRevealBatch([
      { voter: voter(0).toLowerCase() as Address, choice: 'against', salt: `0x${'AB'.repeat(32)}` },
      { voter: voter(1), choice: 'abstain', salt: `0x${'00'.repeat(32)}` },
    ]);
    expect(batch).toEqual({
      voters: [voter(0), voter(1)],
      choices: [2, 0],
      salts: [`0x${'ab'.repeat(32)}`, `0x${'00'.repeat(32)}`],
    });
  });

  it('refuses invalid items and a voter listed twice', () => {
    expect(() => buildRevealBatch([{ ...items(1)[0]!, salt: '0x1234' }])).toThrow(/reveal item 0.*32 bytes/);
    expect(() => buildRevealBatch([{ ...items(1)[0]!, choice: 'yes' as never }])).toThrow(InvalidInputError);
    const dup = [...items(2), { ...items(1)[0]!, choice: 'against' as const }];
    expect(() => buildRevealBatch(dup)).toThrow(/reveal item 2.*listed more than once/);
  });
});

describe('splitBlockRange', () => {
  it('splits an inclusive range into windows of at most 9,999 blocks', () => {
    expect(LOG_WINDOW_BLOCKS).toBe(9_999n);
    const windows = splitBlockRange(5n, 25_000n);
    expect(windows).toEqual([
      { fromBlock: 5n, toBlock: 10_003n },
      { fromBlock: 10_004n, toBlock: 20_002n },
      { fromBlock: 20_003n, toBlock: 25_000n },
    ]);
    for (const w of windows) expect(w.toBlock - w.fromBlock + 1n).toBeLessThanOrEqual(9_999n);
  });

  it('handles single-block, empty and custom-size ranges and refuses sizes above the cap', () => {
    expect(splitBlockRange(7n, 7n)).toEqual([{ fromBlock: 7n, toBlock: 7n }]);
    expect(splitBlockRange(8n, 7n)).toEqual([]);
    expect(splitBlockRange(0n, 4n, 2n)).toHaveLength(3);
    expect(() => splitBlockRange(0n, 1n, 10_000n)).toThrow(InvalidInputError);
    expect(() => splitBlockRange(0n, 1n, 0n)).toThrow(InvalidInputError);
    expect(() => splitBlockRange(-1n, 1n)).toThrow(InvalidInputError);
  });
});
