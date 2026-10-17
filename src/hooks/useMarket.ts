// Which country's menus you are looking at (SPEC §21).
//
// The market is derived from the phone's time zone and stored, so it survives a flight and
// syncs to a second phone. It is adopted silently on a first run, because there is nothing to
// disturb and no question worth asking — and never silently afterwards: `offer` is how a
// change reaches the person, and it is their tap that applies it.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';
import { decideMarket, deviceZone, marketsFor, MARKET_KEY, type Market } from '@/core/market';
import { getSetting, setSetting } from '@/db/repo/settings';

export interface MarketState {
  /** Where the app thinks you are, or undefined in a country whose menus it does not hold. */
  market: Market | undefined;
  /** The markets a search may answer from: yours first, then the ones sharing your menu. */
  markets: readonly Market[] | undefined;
  /** Set when the phone has moved somewhere else we hold menus for, and nothing has been said. */
  offer: Market | undefined;
}

export function useMarket(): MarketState {
  // Read through a wrapper rather than useSetting, which cannot tell "no market stored" from
  // "the read has not come back yet" — both are undefined. That difference matters: treated
  // as the former, every launch looked like a first run and silently adopted the phone's
  // answer, which would quietly undo a deliberate choice on the next reload. An absent
  // wrapper means still loading; a wrapper holding undefined means genuinely unset.
  const row = useLiveQuery(async () => ({ v: await getSetting<Market>(MARKET_KEY) }), []);
  const decision = useMemo(() => (row ? decideMarket(row.v, deviceZone()) : undefined), [row]);

  // A first run adopts the phone's own answer rather than asking a question it can answer.
  useEffect(() => {
    if (decision?.action === 'adopt') void setSetting(MARKET_KEY, decision.market);
  }, [decision]);

  return useMemo(() => {
    if (!decision) return { market: undefined, markets: undefined, offer: undefined };
    const market = decision.action === 'offer' ? decision.from : decision.market;
    return {
      market,
      markets: market ? marketsFor(market) : undefined,
      offer: decision.action === 'offer' ? decision.market : undefined,
    };
  }, [decision]);
}

/** Applies an offered change. Separate from the hook because it is an act, not a reading. */
export async function chooseMarket(market: Market): Promise<void> {
  await setSetting(MARKET_KEY, market);
}
