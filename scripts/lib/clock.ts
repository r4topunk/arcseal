// Waiting for a chain timestamp. The same flow runs on two clocks:
// - RealClock (testnet): sleeps until the latest block timestamp reaches the target. A wait longer than
//   `maxWaitSeconds` is not slept through: the run pauses (state is on disk) and the operator re-runs later.
// - AnvilClock (dry run): jumps chain time with anvil_setNextBlockTimestamp + evm_mine instead of waiting.
import type { PublicClient, TestClient } from 'viem';

export type WaitResult = { ready: true } | { ready: false; resumeAt: number };

export interface Clock {
  /** Latest block timestamp, in unix seconds. */
  chainNow(): Promise<number>;
  /** Resolves once a block with timestamp >= `unixSeconds` exists, or reports when to resume. */
  waitUntil(unixSeconds: number, what: string): Promise<WaitResult>;
  /** Dry run only: the next block gets exactly this timestamp (for example the propose transaction). */
  pinNextBlock?(unixSeconds: number): Promise<void>;
}

async function latestTimestamp(client: PublicClient): Promise<number> {
  const block = await client.getBlock({ blockTag: 'latest' });
  return Number(block.timestamp);
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Arc makes a block about every 0.5 s; five minutes without one means the RPC or the chain is stuck. */
const STALL_MS = 5 * 60_000;

export interface RealClockOptions {
  /** Longest wait slept through inline; longer waits pause the run. Infinity = always wait. */
  maxWaitSeconds: number;
  /** Progress line printer. */
  say?: (line: string) => void;
  /** Injectable for tests. */
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RealClock implements Clock {
  constructor(
    private readonly client: PublicClient,
    private readonly options: RealClockOptions,
  ) {}

  chainNow(): Promise<number> {
    return latestTimestamp(this.client);
  }

  async waitUntil(unixSeconds: number, what: string): Promise<WaitResult> {
    const nowMs = this.options.nowMs ?? Date.now;
    const sleep = this.options.sleep ?? realSleep;
    let chain = await this.chainNow();
    if (chain >= unixSeconds) return { ready: true };
    // The chain's own clock decides (the contract checks block.timestamp); on Arc it tracks the wall clock.
    if (unixSeconds - chain > this.options.maxWaitSeconds) return { ready: false, resumeAt: unixSeconds };

    this.options.say?.(
      `waiting ${formatDuration(unixSeconds - chain)} for ${what} (until ${formatTime(unixSeconds)})`,
    );
    let progressAt = nowMs();
    for (;;) {
      // Slices of at most a minute, so a long --wait keeps printing progress.
      await sleep(Math.min(Math.max(unixSeconds - chain, 1) * 1_000, 60_000));
      const next = await this.chainNow();
      if (next >= unixSeconds) return { ready: true };
      if (next > chain) progressAt = nowMs();
      else if (nowMs() - progressAt > STALL_MS) {
        throw new Error(
          `the chain produced no block for ${STALL_MS / 60_000} minutes while waiting for ${what}`,
        );
      }
      chain = next;
      if (unixSeconds - chain > 60) this.options.say?.(`  ${formatDuration(unixSeconds - chain)} left`);
    }
  }
}

export class AnvilClock implements Clock {
  constructor(
    private readonly client: PublicClient,
    private readonly test: TestClient,
  ) {}

  chainNow(): Promise<number> {
    return latestTimestamp(this.client);
  }

  async waitUntil(unixSeconds: number): Promise<WaitResult> {
    if ((await this.chainNow()) < unixSeconds) {
      await this.test.setNextBlockTimestamp({ timestamp: BigInt(unixSeconds) });
      await this.test.mine({ blocks: 1 });
    }
    return { ready: true };
  }

  async pinNextBlock(unixSeconds: number): Promise<void> {
    await this.test.setNextBlockTimestamp({ timestamp: BigInt(unixSeconds) });
  }
}

/** "2026-09-19 14:03:21 UTC". */
export function formatTime(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1_000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '')} UTC`;
}

/** "23 h 58 min", "9 min 30 s", "12 s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${sec} s`;
  return `${sec} s`;
}
