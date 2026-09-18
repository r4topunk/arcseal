import type { PublicClient } from 'viem';
import { describe, expect, it } from 'vitest';
import { formatDuration, formatTime, RealClock } from '../lib/clock.js';
import { feeInUsdcBaseUnits, formatUsdc } from '../lib/format.js';

/** A fake chain whose latest block timestamp follows a fake wall clock (minus `lag` seconds). */
function fakeChain(startMs: number, lag = 0) {
  let now = startMs;
  const client = {
    getBlock: async () => ({ timestamp: BigInt(Math.floor(now / 1_000) - lag) }),
  } as unknown as PublicClient;
  const slept: number[] = [];
  return {
    client,
    nowMs: () => now,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    slept,
  };
}

describe('RealClock', () => {
  const T0 = 1_790_000_000;

  it('is ready at once when the chain is already past the target', async () => {
    const chain = fakeChain(T0 * 1_000);
    const clock = new RealClock(chain.client, {
      maxWaitSeconds: 900,
      nowMs: chain.nowMs,
      sleep: chain.sleep,
    });
    expect(await clock.waitUntil(T0 - 5, 'x')).toEqual({ ready: true });
    expect(chain.slept).toEqual([]);
  });

  it('pauses instead of waiting longer than maxWaitSeconds (the 24 h reveal window)', async () => {
    const chain = fakeChain(T0 * 1_000);
    const clock = new RealClock(chain.client, {
      maxWaitSeconds: 900,
      nowMs: chain.nowMs,
      sleep: chain.sleep,
    });
    const target = T0 + 86_400;
    expect(await clock.waitUntil(target, 'the end of the reveal window')).toEqual({
      ready: false,
      resumeAt: target,
    });
    expect(chain.slept).toEqual([]);
  });

  it('sleeps through a short wait in slices of at most a minute, then waits for a block', async () => {
    const chain = fakeChain(T0 * 1_000, 2);
    const lines: string[] = [];
    const clock = new RealClock(chain.client, {
      maxWaitSeconds: 900,
      nowMs: chain.nowMs,
      sleep: chain.sleep,
      say: (l) => lines.push(l),
    });
    expect(await clock.waitUntil(T0 + 600, 'the close round')).toEqual({ ready: true });
    expect(Math.max(...chain.slept)).toBeLessThanOrEqual(60_000);
    expect(chain.slept.reduce((a, b) => a + b, 0)).toBe(602_000); // the chain is 2 s behind the wall clock: 602 s of chain time to go
    expect(lines[0]).toMatch(/^waiting 10 min 2 s for the close round/);
  });

  it('waits any length with maxWaitSeconds = Infinity (--wait)', async () => {
    const chain = fakeChain(T0 * 1_000);
    const clock = new RealClock(chain.client, {
      maxWaitSeconds: Number.POSITIVE_INFINITY,
      nowMs: chain.nowMs,
      sleep: chain.sleep,
    });
    expect(await clock.waitUntil(T0 + 86_400, 'x')).toEqual({ ready: true });
  });
});

describe('RealClock on a stalled chain', () => {
  it('gives up after five minutes without a new block', async () => {
    let now = 1_790_000_000_000;
    const client = { getBlock: async () => ({ timestamp: 1_790_000_000n }) } as unknown as PublicClient;
    const clock = new RealClock(client, {
      maxWaitSeconds: 900,
      nowMs: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    await expect(clock.waitUntil(1_790_000_600, 'the close round')).rejects.toThrow(/no block for 5 minutes/);
  });
});

describe('formatting', () => {
  it('formats times, durations and USDC amounts (6 decimals)', () => {
    expect(formatTime(1_788_803_364)).toBe('2026-09-07 17:49:24 UTC');
    expect(formatDuration(86_399)).toBe('23 h 59 min');
    expect(formatDuration(570)).toBe('9 min 30 s');
    expect(formatDuration(-3)).toBe('0 s');
    expect(formatUsdc(1_000_000n)).toBe('1.000000 USDC');
    expect(formatUsdc(10_000n)).toBe('0.010000 USDC');
    expect(formatUsdc(0n)).toBe('0.000000 USDC');
  });

  it('converts a gas fee from the 18-decimal native view to 6-decimal USDC', () => {
    // 69,040 gas at the 20 gwei floor = 0.0013808 USDC
    expect(feeInUsdcBaseUnits(69_040n, 20_000_000_000n)).toBe(1_380n);
  });
});
