import { QUICKNET } from '@arcseal/tlock';
import { describe, expect, it, vi } from 'vitest';
import {
  DRAND_URLS,
  DrandFetchError,
  type FetchLike,
  getBeacon,
  InvalidInputError,
  roundTime,
  waitForRound,
} from '../src/index.js';
import { BEACONS, drandJson } from './fixtures.js';

const [A, B] = BEACONS as [(typeof BEACONS)[0], (typeof BEACONS)[0]];

type Reply = { ok: boolean; status: number; json(): Promise<unknown> };
const ok = (body: unknown): Reply => ({ ok: true, status: 200, json: async () => body });
const status = (code: number): Reply => ({ ok: false, status: code, json: async () => ({}) });

/** A fetch that answers from a script, one entry per call, and records the URLs it was called with. */
function scripted(...replies: (Reply | Error | 'hang')[]) {
  const urls: string[] = [];
  const fetch: FetchLike = (url, init) => {
    urls.push(url);
    const next = replies.shift();
    if (next === undefined) return Promise.reject(new Error('no scripted reply left'));
    if (next === 'hang') {
      return new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason)),
      );
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { fetch, urls };
}

const v1Url = (base: string, round: bigint) => `${base}/${QUICKNET.chainHash}/public/${round}`;

describe('getBeacon', () => {
  it('reads the v1 endpoint of the first relay and returns a verified { round, signature }', async () => {
    const { fetch, urls } = scripted(ok(drandJson(A.round)));
    expect(await getBeacon(A.round, { fetch })).toEqual(A);
    expect(urls).toEqual([v1Url('https://api.drand.sh', A.round)]);
    expect(urls[0]).not.toMatch(/\/v2\//);
  });

  it('tries api.drand.sh, api2.drand.sh, drand.cloudflare.com in that order', async () => {
    expect(DRAND_URLS).toEqual([
      'https://api.drand.sh',
      'https://api2.drand.sh',
      'https://drand.cloudflare.com',
    ]);
    const { fetch, urls } = scripted(status(500), new Error('ECONNRESET'), ok(drandJson(A.round)));
    expect(await getBeacon(Number(A.round), { fetch })).toEqual(A);
    expect(urls).toEqual(DRAND_URLS.map((base) => v1Url(base, A.round)));
  });

  it('falls back on malformed bodies, the wrong round and a signature that does not verify', async () => {
    const { fetch, urls } = scripted(
      ok({ hello: 'world' }),
      ok(drandJson(B.round)),
      ok({ ...drandJson(A.round), signature: drandJson(B.round).signature }),
      ok(drandJson(A.round)),
    );
    const relays = ['https://r1.example', 'https://r2.example/', 'https://r3.example', 'https://r4.example'];
    expect(await getBeacon(A.round, { fetch, urls: relays })).toEqual(A);
    expect(urls).toHaveLength(4);
    expect(urls[1]).toBe(v1Url('https://r2.example', A.round)); // trailing slash trimmed
  });

  it('accepts a 0x-prefixed or uppercase signature and ignores extra fields', async () => {
    const body = {
      ...drandJson(A.round),
      signature: `0x${drandJson(A.round).signature.toUpperCase()}`,
      x: 1,
    };
    const { fetch } = scripted(ok(body));
    expect(await getBeacon(A.round, { fetch })).toEqual(A);
  });

  it('times out a hanging relay and moves on', async () => {
    const { fetch, urls } = scripted('hang', ok(drandJson(A.round)));
    expect(await getBeacon(A.round, { fetch, timeoutMs: 20 })).toEqual(A);
    expect(urls).toHaveLength(2);
  });

  it('throws DrandFetchError with every attempt when all relays fail', async () => {
    const { fetch } = scripted(status(404), 'hang', ok({ round: 'x' }));
    const err = (await getBeacon(A.round, { fetch, timeoutMs: 20 }).catch(
      (e: unknown) => e,
    )) as DrandFetchError;
    expect(err).toBeInstanceOf(DrandFetchError);
    expect(err.code).toBe('DRAND_FETCH_FAILED');
    expect(err.round).toBe(A.round);
    expect(err.early).toBe(false);
    expect(err.attempts.map((a) => a.error)).toEqual([
      'HTTP 404',
      'timed out after 20 ms',
      expect.stringMatching(/^malformed response/),
    ]);
    expect(err.attempts.map((a) => a.url)).toEqual(DRAND_URLS.map((base) => v1Url(base, A.round)));
  });

  it('flags a round that is not published yet as early', async () => {
    const future = BigInt(Math.floor((Date.now() / 1000 - Number(QUICKNET.genesis)) / 3)) + 1_000_000n;
    const { fetch } = scripted(status(425), status(425), status(425));
    await expect(getBeacon(future, { fetch })).rejects.toMatchObject({
      code: 'DRAND_FETCH_FAILED',
      early: true,
    });
  });

  it('stops at once when the caller aborts, throwing the abort reason', async () => {
    const controller = new AbortController();
    const { fetch, urls } = scripted('hang', ok(drandJson(A.round)));
    const pending = getBeacon(A.round, { fetch, signal: controller.signal });
    controller.abort(new Error('user left the page'));
    await expect(pending).rejects.toThrow('user left the page');
    expect(urls).toHaveLength(1);
  });

  it('validates the round before any request', async () => {
    const { fetch, urls } = scripted();
    await expect(getBeacon(0n, { fetch })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(getBeacon(-1, { fetch })).rejects.toBeInstanceOf(InvalidInputError);
    expect(urls).toHaveLength(0);
  });
});

describe('waitForRound', () => {
  it('sleeps until the round time, then retries until a relay serves the beacon', async () => {
    let clock = roundTime(A.round) * 1000 - 30; // 30 ms before the round by the injected clock
    const now = vi.fn(() => clock);
    const { fetch, urls } = scripted(status(425), status(425), status(425), ok(drandJson(A.round)));
    const pending = waitForRound(A.round, { fetch, now, retryMs: 1 });
    clock += 30;
    expect(await pending).toEqual(A);
    // First attempt fails on all three relays, the retry succeeds on the first relay.
    expect(urls).toHaveLength(4);
    expect(now).toHaveBeenCalled();
  });

  it('is bounded only by the signal', async () => {
    const { fetch } = scripted(...Array.from({ length: 100 }, () => status(500)));
    const signal = AbortSignal.timeout(50);
    await expect(waitForRound(A.round, { fetch, retryMs: 5, signal })).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('aborts while sleeping before the round time', async () => {
    const controller = new AbortController();
    const pending = waitForRound(A.round, {
      now: () => roundTime(A.round) * 1000 - 60_000,
      signal: controller.signal,
    });
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('does not retry on errors other than DrandFetchError', async () => {
    await expect(waitForRound(0n)).rejects.toBeInstanceOf(InvalidInputError);
  });
});
