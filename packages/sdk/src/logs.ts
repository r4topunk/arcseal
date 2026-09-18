// Block-range pagination for eth_getLogs. Arc's public RPC answers at most 10,000 blocks per call (PRD 9), so every
// log scan in the SDK walks the range in windows of at most 9,999 blocks, oldest first.
import { InvalidInputError } from './errors.js';

/** Blocks per eth_getLogs call (inclusive range size). One below Arc's cap, so either reading of the cap holds. */
export const LOG_WINDOW_BLOCKS = 9_999n;

/** An inclusive block range. */
export interface BlockWindow {
  fromBlock: bigint;
  toBlock: bigint;
}

/** Progress report after each window: its range and how many logs it returned. */
export type OnWindow = (window: BlockWindow & { logs: number }) => void;

/** Splits the inclusive range [fromBlock, toBlock] into consecutive windows of at most `size` blocks. */
export function splitBlockRange(
  fromBlock: bigint,
  toBlock: bigint,
  size: bigint = LOG_WINDOW_BLOCKS,
): BlockWindow[] {
  if (size < 1n || size > LOG_WINDOW_BLOCKS) {
    throw new InvalidInputError('window size', [`must be in 1..${LOG_WINDOW_BLOCKS}, got ${size}`]);
  }
  if (fromBlock < 0n)
    throw new InvalidInputError('block range', [`fromBlock must be >= 0, got ${fromBlock}`]);
  const windows: BlockWindow[] = [];
  for (let start = fromBlock; start <= toBlock; start += size) {
    const end = start + size - 1n;
    windows.push({ fromBlock: start, toBlock: end < toBlock ? end : toBlock });
  }
  return windows;
}

/**
 * Runs `fetchWindow` over every window of [fromBlock, toBlock] sequentially (so results stay in block order) and
 * concatenates the results. `onWindow` is called after each window.
 */
export async function scanWindows<T>(
  range: BlockWindow & { windowSize?: bigint | undefined; onWindow?: OnWindow | undefined },
  fetchWindow: (window: BlockWindow) => Promise<readonly T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (const window of splitBlockRange(range.fromBlock, range.toBlock, range.windowSize)) {
    const logs = await fetchWindow(window);
    out.push(...logs);
    range.onWindow?.({ ...window, logs: logs.length });
  }
  return out;
}
