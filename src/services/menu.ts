// SPEC §9.7 — reading a menu, so eating out stops being a black hole in the log.
//
// The Worker returns the same shape /api/estimate does, so everything after this point is the
// §9.4 machinery unchanged: the model's dishes are validated, matched against the offline
// database (FNDDS carries thousands of dishes "as eaten", which is exactly what a restaurant
// serves), and the ones that match take the database's macros instead of the model's.
//
// What is different is honesty about the error. A restaurant plate is worth about a fifth either
// way, and this flow keeps that band visible right up to the moment of logging rather than
// presenting one confident number.
import { authHeaders } from '@/services/apiAuth';
import {
  groundItems,
  matchItems,
  parseEstimate,
  type GroundedItem,
  type EstimateResult,
} from '@/core/estimate';
import { getFoods, listSearchDocs } from '@/db/repo/foods';
import { foodUsageCounts } from '@/db/repo/logEntries';
import { downscale } from './barcode';

/** The honest width of a restaurant estimate, either side. */
export const MENU_UNCERTAINTY = 0.2;

export interface MenuOutcome {
  result: EstimateResult;
  /** One per dish on the menu, grounded where the database could match it. */
  items: GroundedItem[];
  model: string;
}

async function toJpegDataUrl(file: File): Promise<string> {
  // Menus are dense small print, so they get more pixels than a plate does.
  const canvas = await downscale(file, 1600);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** Dev-only seam, matching the one `estimateMeal` uses, so the harness can run offline. */
type MockMenu = (body: { image: string; place?: string }) => unknown;
function mock(): MockMenu | undefined {
  if (!import.meta.env.DEV) return undefined;
  return (window as unknown as { __kalibMockMenu?: MockMenu }).__kalibMockMenu;
}

export async function readMenu(photo: File, place?: string): Promise<MenuOutcome> {
  const body: { image: string; place?: string } = { image: await toJpegDataUrl(photo) };
  const trimmed = place?.trim();
  if (trimmed) body.place = trimmed;

  let raw: unknown;
  let model = 'mock';
  const m = mock();
  if (m) raw = m(body);
  else {
    const auth = await authHeaders();
    if (!('authorization' in auth)) {
      throw new Error('Sign in first (Settings → Sync). Reading a menu runs on the server.');
    }
    const res = await fetch('/api/menu', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      result?: unknown;
      model?: string;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? `Could not read the menu (${res.status}).`);
    raw = data.result;
    model = data.model ?? 'unknown';
  }

  const result = parseEstimate(raw);
  const [docs, usage] = await Promise.all([listSearchDocs(), foodUsageCounts()]);
  const matches = matchItems(result.items, docs, usage);
  const foods = await getFoods(matches.filter((id): id is string => id != null));
  return { result, items: groundItems(result.items, matches, foods), model };
}

/**
 * The calorie band to show beside a dish. The grounding already works out a range from the
 * model's gram range (`kcal_range`); this only guarantees it is never narrower than the flat
 * fifth any restaurant plate deserves.
 */
export function dishRange(g: GroundedItem): { low: number; high: number } {
  const [lo, hi] = g.kcal_range;
  return {
    low: Math.max(0, Math.min(lo, g.kcal * (1 - MENU_UNCERTAINTY))),
    high: Math.max(hi, g.kcal * (1 + MENU_UNCERTAINTY)),
  };
}
