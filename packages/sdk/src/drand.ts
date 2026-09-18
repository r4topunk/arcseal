// drand quicknet beacons over HTTP (PRD 5). v1 API only: GET <relay>/<chainHash>/public/<round>, relays tried in
// order. Every response is Zod-validated and BLS-verified against the pinned quicknet key before it is returned,
// so a broken or hostile relay cannot make valid votes look undecryptable.
import { QUICKNET, verifyBeacon as verifyQuicknetSignature } from '@arcseal/tlock';
import type { Hex } from 'viem';
import { z } from 'zod';
import { type DrandAttempt, DrandFetchError } from './errors.js';
import type { Logger } from './logger.js';
import { roundTime } from './round.js';
import { type Beacon, parseInput, roundSchema } from './schemas.js';

/** drand HTTP relays serving quicknet, in the order `getBeacon` tries them. */
export const DRAND_URLS = [
  'https://api.drand.sh',
  'https://api2.drand.sh',
  'https://drand.cloudflare.com',
] as const;

/** Per-relay request timeout, in milliseconds. */
export const DRAND_TIMEOUT_MS = 5_000;

/** Shape of `GET /<chainHash>/public/<round>` (v1). Extra fields such as `randomness` are ignored. */
export const drandBeaconResponseSchema = z.object({
  round: z.number().int().positive(),
  signature: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{96}$/, 'signature must be 48 bytes of hex (a compressed G1 point)'),
});
export type DrandBeaconResponse = z.output<typeof drandBeaconResponseSchema>;

/** Anything with the `fetch` call shape. Tests and custom agents inject one; the default is `globalThis.fetch`. */
export type FetchLike = (
  input: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GetBeaconOptions {
  /** Relays tried in order. Default `DRAND_URLS`. */
  urls?: readonly string[] | undefined;
  /** Per-relay timeout in milliseconds. Default `DRAND_TIMEOUT_MS`. */
  timeoutMs?: number | undefined;
  /** Aborts the whole call; the abort reason is thrown as is. */
  signal?: AbortSignal | undefined;
  /** Injectable fetch. Default `globalThis.fetch`. */
  fetch?: FetchLike | undefined;
  /** Receives one debug line per failed relay. */
  logger?: Logger | undefined;
}

/**
 * Fetches quicknet's beacon for `round`, trying each relay in order until one returns a well-formed beacon for that
 * exact round whose BLS signature verifies. Throws `DrandFetchError` (with every attempt) when none does, which is
 * also what happens for a round that is not published yet (`error.early` is then true).
 */
export async function getBeacon(round: bigint | number, options: GetBeaconOptions = {}): Promise<Beacon> {
  const target = parseInput(roundSchema, round, 'round');
  const urls = options.urls && options.urls.length > 0 ? options.urls : DRAND_URLS;
  const timeoutMs = options.timeoutMs ?? DRAND_TIMEOUT_MS;
  // Called as a plain function (never as `options.fetch(...)`): browsers throw "Illegal invocation" otherwise.
  const doFetch: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const attempts: DrandAttempt[] = [];

  for (const base of urls) {
    options.signal?.throwIfAborted();
    const url = `${base.replace(/\/+$/, '')}/${QUICKNET.chainHash}/public/${target}`;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let error: string;
    try {
      const res = await doFetch(url, { signal, headers: { accept: 'application/json' } });
      if (!res.ok) error = `HTTP ${res.status}`;
      else {
        const checked = checkBeacon(await res.json(), target);
        if ('signature' in checked) return { round: target, signature: checked.signature };
        error = checked.error;
      }
    } catch (err) {
      if (options.signal?.aborted) throw options.signal.reason ?? err;
      error = timeout.aborted ? `timed out after ${timeoutMs} ms` : errorMessage(err);
    }
    attempts.push({ url, error });
    options.logger?.debug({ url, round: target.toString(), error }, 'drand relay failed');
  }
  throw new DrandFetchError(target, attempts, notPublishedYet(target));
}

export interface WaitForRoundOptions extends GetBeaconOptions {
  /** Pause between attempts once the round time has passed, in milliseconds. Default 3,000 (one quicknet period). */
  retryMs?: number | undefined;
  /** Clock in unix milliseconds. Default `Date.now`. */
  now?: (() => number) | undefined;
}

/**
 * Resolves with the beacon for `round` once it is published: sleeps until `roundTime(round)` by the local clock,
 * then calls `getBeacon` until it succeeds, pausing `retryMs` after each `DrandFetchError`. Never gives up on its
 * own: pass `signal` (for example `AbortSignal.timeout(ms)`) to bound it; the abort reason is thrown.
 */
export async function waitForRound(
  round: bigint | number,
  options: WaitForRoundOptions = {},
): Promise<Beacon> {
  const target = parseInput(roundSchema, round, 'round');
  const now = options.now ?? Date.now;
  const retryMs = options.retryMs ?? 3_000;
  const publishedAt = roundTime(target) * 1_000;
  for (;;) {
    options.signal?.throwIfAborted();
    const wait = publishedAt - now();
    if (wait > 0) {
      await sleep(wait, options.signal);
      continue;
    }
    try {
      return await getBeacon(target, options);
    } catch (err) {
      if (!(err instanceof DrandFetchError)) throw err;
      options.logger?.debug({ round: target.toString(), retryMs }, 'beacon not available yet, retrying');
      await sleep(retryMs, options.signal);
    }
  }
}

/** The signature when `body` is a well-formed beacon for `round` that verifies, otherwise why it is not. */
function checkBeacon(body: unknown, round: bigint): { signature: Hex } | { error: string } {
  const parsed = drandBeaconResponseSchema.safeParse(body);
  if (!parsed.success)
    return { error: `malformed response: ${parsed.error.issues[0]?.message ?? 'invalid body'}` };
  if (BigInt(parsed.data.round) !== round)
    return { error: `asked for round ${round}, got ${parsed.data.round}` };
  const signature: Hex = `0x${parsed.data.signature.replace(/^0x/, '').toLowerCase()}`;
  if (!verifyQuicknetSignature({ round, signature })) {
    return { error: 'signature does not verify against the quicknet public key' };
  }
  return { signature };
}

/** True when the local clock says `round` is still in the future (a round past 2^53 seconds is, by far). */
function notPublishedYet(round: bigint): boolean {
  try {
    return Date.now() / 1_000 < roundTime(round);
  } catch {
    return true;
  }
}

// setTimeout takes at most 2^31-1 ms (about 24.8 days); longer waits loop.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.min(Math.max(ms, 0), MAX_TIMEOUT_MS),
    );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
