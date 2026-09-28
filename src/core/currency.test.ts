import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  QUICK_CURRENCIES,
  currencyDecimals,
  currencyOf,
  currencySymbol,
  formatMoney,
  localeCurrency,
} from './currency';

describe('currency', () => {
  it('reads a stored code, and still understands the bare symbol used before codes', () => {
    expect(currencyOf('OMR').symbol).toBe('ر.ع.');
    expect(currencyOf('omr').code).toBe('OMR');
    expect(currencyOf('€').code).toBe('EUR');
    expect(currencyOf(undefined).code).toBe('EUR');
    expect(currencySymbol('USD')).toBe('$');
  });

  it('uses the decimals the currency actually has', () => {
    expect(currencyDecimals('OMR')).toBe(3);
    expect(currencyDecimals('KWD')).toBe(3);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('EUR')).toBe(2);
    expect(formatMoney(4.75, 'OMR')).toBe('ر.ع.4.750');
    expect(formatMoney(12.3, 'EUR')).toBe('€12.30');
    expect(formatMoney(1240, 'JPY')).toBe('¥1,240');
  });

  it('offers the household’s three first and a full list behind them', () => {
    expect(QUICK_CURRENCIES).toEqual(['OMR', 'EUR', 'USD']);
    for (const code of QUICK_CURRENCIES) {
      expect(
        CURRENCIES.some((c) => c.code === code),
        code,
      ).toBe(true);
    }
    expect(CURRENCIES.length).toBeGreaterThan(40);
    // Sorted by code, unique, and every entry has a symbol.
    const codes = CURRENCIES.map((c) => c.code);
    expect(codes).toEqual([...codes].sort());
    expect(new Set(codes).size).toBe(codes.length);
    expect(CURRENCIES.every((c) => c.symbol.length > 0 && c.name.length > 0)).toBe(true);
  });

  it('guesses from the phone’s region', () => {
    expect(localeCurrency('ar-OM')).toBe('OMR');
    expect(localeCurrency('en-US')).toBe('USD');
    expect(localeCurrency('it-IT')).toBe('EUR');
    expect(localeCurrency('en')).toBe('EUR');
  });
});
