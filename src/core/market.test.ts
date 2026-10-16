import { describe, expect, it } from 'vitest';
import { decideMarket, deviceZone, isMarket, marketForZone, MARKETS, MARKET_NAME } from './market';

describe('marketForZone', () => {
  it('reads the markets we carry off the phone', () => {
    expect(marketForZone('Europe/Rome')).toBe('IT');
    expect(marketForZone('Asia/Muscat')).toBe('OM');
    expect(marketForZone('America/New_York')).toBe('US');
  });

  it('matches American zones by region rather than by city', () => {
    for (const z of ['America/Detroit', 'America/Los_Angeles', 'America/Anchorage']) {
      expect(marketForZone(z), z).toBe('US');
    }
    expect(marketForZone('Pacific/Honolulu')).toBe('US');
  });

  it('treats the Gulf zone as Oman, which is the nearest menu we hold', () => {
    expect(marketForZone('Asia/Dubai')).toBe('OM');
  });

  it('says nothing for somewhere we have no data for', () => {
    // Most of the world. The caller must not fall back to a country you are not in.
    for (const z of ['Europe/Paris', 'Asia/Tokyo', 'Africa/Cairo', 'Australia/Sydney', '']) {
      expect(marketForZone(z), z).toBeUndefined();
    }
    expect(marketForZone(undefined)).toBeUndefined();
  });

  it('does not mistake the rest of the Americas for the United States', () => {
    // `America/` is a region, not a country. Matching on the prefix handed Brazil, Mexico and
    // Canada an American menu, which is the mixing this module exists to prevent.
    for (const z of [
      'America/Sao_Paulo',
      'America/Mexico_City',
      'America/Toronto',
      'America/Bogota',
      'America/Argentina/Buenos_Aires',
    ]) {
      expect(marketForZone(z), z).toBeUndefined();
    }
  });
});

describe('decideMarket', () => {
  it('adopts the phone on a first run, with nothing to disturb', () => {
    expect(decideMarket(undefined, 'Europe/Rome')).toEqual({ action: 'adopt', market: 'IT' });
  });

  it('keeps quiet when the phone agrees with the choice', () => {
    expect(decideMarket('IT', 'Europe/Rome')).toEqual({ action: 'keep', market: 'IT' });
  });

  it('offers rather than switches when you have travelled', () => {
    // The Oman trip. Changing the macros under someone mid-log is worse than showing the
    // wrong country's menu until they say so.
    expect(decideMarket('IT', 'Asia/Muscat')).toEqual({
      action: 'offer',
      market: 'OM',
      from: 'IT',
    });
  });

  it('keeps the choice when the phone is somewhere we have no menus for', () => {
    expect(decideMarket('IT', 'Asia/Tokyo')).toEqual({ action: 'keep', market: 'IT' });
  });

  it('has nothing to say on a first run in an uncovered country', () => {
    expect(decideMarket(undefined, 'Asia/Tokyo')).toEqual({ action: 'keep', market: undefined });
  });

  it('ignores a stored value that is not a market', () => {
    expect(decideMarket('XX', 'Europe/Rome')).toEqual({ action: 'adopt', market: 'IT' });
    expect(decideMarket(42, 'Europe/Rome')).toEqual({ action: 'adopt', market: 'IT' });
  });
});

describe('the market list', () => {
  it('names every market it carries', () => {
    for (const m of MARKETS) expect(MARKET_NAME[m]).toBeTruthy();
  });

  it('recognises its own members and nothing else', () => {
    for (const m of MARKETS) expect(isMarket(m)).toBe(true);
    for (const v of ['it', 'FR', '', null, undefined, 3]) expect(isMarket(v)).toBe(false);
  });
});

describe('deviceZone', () => {
  it('returns a zone or nothing, never a throw', () => {
    const z = deviceZone();
    expect(z === undefined || typeof z === 'string').toBe(true);
  });
});
