import { describe, expect, it } from 'vitest';
import {
  formatBps,
  formatCountdown,
  formatInt,
  formatUsdc,
  freeTreasury,
  nativeFeeToUsdcUnits,
  parseUsdc,
  utf8Length,
} from '@/lib/format';

describe('formatUsdc (6-decimal ERC-20 view)', () => {
  it('always prints exactly 6 decimals', () => {
    expect(formatUsdc(0n)).toBe('0.000000');
    expect(formatUsdc(1n)).toBe('0.000001');
    expect(formatUsdc(10_000n)).toBe('0.010000');
    expect(formatUsdc(1_000_000n)).toBe('1.000000');
  });

  it('groups thousands and handles large and negative values', () => {
    expect(formatUsdc(1_234_500_000n)).toBe('1,234.500000');
    expect(formatUsdc(123_456_789_000_001n)).toBe('123,456,789.000001');
    expect(formatUsdc(-1_500_000n)).toBe('-1.500000');
  });
});

describe('parseUsdc', () => {
  it('parses integers, decimals and a leading or trailing dot', () => {
    expect(parseUsdc('1')).toEqual({ ok: true, value: 1_000_000n });
    expect(parseUsdc(' 1.5 ')).toEqual({ ok: true, value: 1_500_000n });
    expect(parseUsdc('.5')).toEqual({ ok: true, value: 500_000n });
    expect(parseUsdc('2.')).toEqual({ ok: true, value: 2_000_000n });
    expect(parseUsdc('0.000001')).toEqual({ ok: true, value: 1n });
    expect(parseUsdc('0')).toEqual({ ok: true, value: 0n });
  });

  it('refuses more than 6 decimals instead of truncating', () => {
    expect(parseUsdc('0.0000001')).toEqual({ ok: false, error: 'decimals' });
    expect(parseUsdc('1.1234567')).toEqual({ ok: false, error: 'decimals' });
  });

  it('refuses commas, signs, exponents, words and empty input', () => {
    expect(parseUsdc('1,5')).toEqual({ ok: false, error: 'comma' });
    expect(parseUsdc('1,000.00')).toEqual({ ok: false, error: 'comma' });
    expect(parseUsdc('-1')).toEqual({ ok: false, error: 'format' });
    expect(parseUsdc('+1')).toEqual({ ok: false, error: 'format' });
    expect(parseUsdc('1e6')).toEqual({ ok: false, error: 'format' });
    expect(parseUsdc('abc')).toEqual({ ok: false, error: 'format' });
    expect(parseUsdc('.')).toEqual({ ok: false, error: 'format' });
    expect(parseUsdc('   ')).toEqual({ ok: false, error: 'empty' });
    expect(parseUsdc('1234567890123456')).toEqual({ ok: false, error: 'tooLarge' });
  });

  it('round-trips with formatUsdc', () => {
    for (const units of [1n, 999_999n, 1_000_000n, 42_424_242n]) {
      const r = parseUsdc(formatUsdc(units).replace(/,/g, ''));
      expect(r).toEqual({ ok: true, value: units });
    }
  });
});

describe('fees and other numbers', () => {
  it('converts an 18-decimal native fee to 6-decimal USDC units, rounding up', () => {
    // 69,040 gas at the 20 gwei floor = 0.0013808 USDC
    expect(nativeFeeToUsdcUnits(69_040n * 20_000_000_000n)).toBe(1_381n);
    expect(formatUsdc(nativeFeeToUsdcUnits(69_040n * 20_000_000_000n))).toBe('0.001381');
    expect(nativeFeeToUsdcUnits(1n)).toBe(1n);
    expect(nativeFeeToUsdcUnits(0n)).toBe(0n);
    expect(nativeFeeToUsdcUnits(10n ** 12n)).toBe(1n);
  });

  it('formats basis points, integers, the free treasury and UTF-8 lengths', () => {
    expect(formatBps(5_000)).toBe('50%');
    expect(formatBps(3_333)).toBe('33.33%');
    expect(formatBps(1)).toBe('0.01%');
    expect(formatInt(32_000_000n)).toBe('32,000,000');
    expect(freeTreasury(2_000_000n, 500_000n)).toBe(1_500_000n);
    expect(freeTreasury(1n, 5n)).toBe(0n);
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('ação')).toBe(6);
  });
});

describe('formatCountdown', () => {
  it('uses mm:ss under an hour, h m under a day, d h above', () => {
    expect(formatCountdown(599)).toBe('09:59');
    expect(formatCountdown(3_600)).toBe('1h 00m');
    expect(formatCountdown(3_600 * 5 + 7 * 60)).toBe('5h 07m');
    expect(formatCountdown(86_400 * 2 + 3 * 3_600)).toBe('2d 03h');
  });

  it('returns null once the deadline has passed', () => {
    expect(formatCountdown(0)).toBeNull();
    expect(formatCountdown(-10)).toBeNull();
  });
});
