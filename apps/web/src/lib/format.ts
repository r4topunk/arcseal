import type { Locale } from './i18n';

/** Decimals of the USDC ERC-20 view. Arc's native balance is an 18-decimal view of the same funds: never shown here. */
export const USDC_DECIMALS = 6;
const UNIT = 10n ** BigInt(USDC_DECIMALS);
/** 18-decimal native units per 6-decimal USDC unit. */
const NATIVE_PER_USDC_UNIT = 10n ** 12n;

/** 6-decimal USDC units to a string with exactly 6 decimals and comma thousands separators: 1234500000n -> "1,234.500000". */
export function formatUsdc(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const int = (abs / UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (abs % UNIT).toString().padStart(USDC_DECIMALS, '0');
  return `${negative ? '-' : ''}${int}.${frac}`;
}

export type UsdcParseError = 'empty' | 'format' | 'comma' | 'decimals' | 'tooLarge';
export type UsdcParseResult = { ok: true; value: bigint } | { ok: false; error: UsdcParseError };

/**
 * Parses a typed USDC amount into 6-decimal units. A dot is the only decimal separator (no locale guessing), more than
 * 6 decimals is an error rather than a silent truncation, and negative or non-numeric input is refused.
 */
export function parseUsdc(input: string): UsdcParseResult {
  const s = input.trim();
  if (s === '') return { ok: false, error: 'empty' };
  if (s.includes(',')) return { ok: false, error: 'comma' };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return { ok: false, error: 'format' };
  const int = m[1] || '0';
  const frac = m[2] ?? '';
  if (frac.length > USDC_DECIMALS) return { ok: false, error: 'decimals' };
  if (int.replace(/^0+/, '').length > 15) return { ok: false, error: 'tooLarge' };
  return { ok: true, value: BigInt(int) * UNIT + BigInt(frac.padEnd(USDC_DECIMALS, '0')) };
}

/**
 * Converts a network fee in native units (gas x gasPrice, 18 decimals on Arc) to 6-decimal USDC units, rounding up,
 * so fee estimates use the same view as every other amount on the page.
 */
export function nativeFeeToUsdcUnits(feeWei: bigint): bigint {
  return (feeWei + NATIVE_PER_USDC_UNIT - 1n) / NATIVE_PER_USDC_UNIT;
}

/** Spendable treasury: the USDC balance minus what is owed to claimers, never below zero (like SealedDAO._available). */
export function freeTreasury(balance: bigint, totalClaimable: bigint): bigint {
  return balance > totalClaimable ? balance - totalClaimable : 0n;
}

/** Basis points as a percentage: 5000 -> "50%", 3333 -> "33.33%". */
export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const rest = bps % 100;
  return rest === 0 ? `${whole}%` : `${whole}.${rest.toString().padStart(2, '0')}%`;
}

/** Integer with comma thousands separators (drand rounds, block numbers). */
export function formatInt(n: bigint | number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function shortHash(h: string): string {
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}

/** UTF-8 byte length: the contract limits `description` to 256 bytes, not characters. */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

const INTL_LOCALE: Record<Locale, string> = { en: 'en-US', 'pt-BR': 'pt-BR' };

/** Unix seconds to a local wall-clock date and time with the time zone name. */
export function formatDateTime(unixSeconds: number, locale: Locale, timeZone?: string): string {
  return new Date(unixSeconds * 1000).toLocaleString(INTL_LOCALE[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
}

/**
 * Remaining time as a compact countdown: "2d 03h", "5h 07m", "09:41". Zero or negative seconds give null (the
 * deadline has passed).
 */
export function formatCountdown(seconds: number): string | null {
  if (seconds <= 0) return null;
  const s = Math.ceil(seconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const secs = s % 60;
  const two = (n: number) => n.toString().padStart(2, '0');
  if (days > 0) return `${days}d ${two(hours)}h`;
  if (hours > 0) return `${hours}h ${two(minutes)}m`;
  return `${two(minutes)}:${two(secs)}`;
}

/** Stable JSON for query keys and comparisons: bigints become decimal strings. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}
