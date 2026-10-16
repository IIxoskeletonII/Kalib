import { describe, expect, it } from 'vitest';
import {
  borrowedFrom,
  decideMarket,
  deviceZone,
  isMarket,
  marketForZone,
  marketsFor,
  MARKETS,
  MARKET_NAME,
  REGION,
} from './market';

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

  it('gives each Gulf country its own market', () => {
    // Dubai used to fall through to Oman on the grounds that the Gulf menu is shared. That
    // was a guess standing in for missing data; both now have their own.
    expect(marketForZone('Asia/Dubai')).toBe('AE');
    expect(marketForZone('Asia/Riyadh')).toBe('SA');
    expect(marketForZone('Asia/Muscat')).toBe('OM');
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

describe('marketsFor', () => {
  it('answers an Omani question with Gulf menus, your own country first', () => {
    // Evidence, not assumption: of the 72 Domino's items published in both Oman and the UAE,
    // all 72 agree within 2%. The Emirati table is also the larger (128 rows to 74), so the
    // grouping adds items Oman never published rather than only avoiding an empty result.
    expect(marketsFor('OM')).toEqual(['OM', 'AE', 'SA']);
    expect(marketsFor('AE')).toEqual(['AE', 'OM', 'SA']);
    expect(marketsFor('SA')).toEqual(['SA', 'OM', 'AE']);
  });

  it('never reaches outside the region', () => {
    // An Italian Big Mac is a different sandwich from an Omani one. Standing in Muscat you
    // may be shown a Dubai figure; you are never shown a Milan one.
    expect(marketsFor('IT')).toEqual(['IT']);
    expect(marketsFor('US')).toEqual(['US']);
    for (const m of MARKETS) {
      for (const other of marketsFor(m)) expect(REGION[other]).toBe(REGION[m]);
    }
  });

  it('always puts your own market first', () => {
    for (const m of MARKETS) expect(marketsFor(m)[0]).toBe(m);
  });
});

describe('borrowedFrom', () => {
  it('says nothing when the figure is from where you are', () => {
    expect(borrowedFrom('OM', 'OM')).toBeUndefined();
  });

  it('names the country when the figure was borrowed', () => {
    expect(borrowedFrom('AE', 'OM')).toBe('United Arab Emirates');
    expect(borrowedFrom('SA', 'OM')).toBe('Saudi Arabia');
  });
});
