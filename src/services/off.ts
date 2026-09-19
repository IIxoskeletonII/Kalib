// Open Food Facts via our Worker (SPEC §7.2). Products the user picks are cached locally as
// `source: 'off'` foods so they work offline and can become favourites.
import type { OffProduct } from '../../worker/off';
import type { Food } from '@/core/types';
import { addFood, getFood } from '@/db/repo/foods';

export type { OffProduct };

export async function searchPackaged(q: string, signal?: AbortSignal): Promise<OffProduct[]> {
  const res = await fetch(
    `/api/off/search?q=${encodeURIComponent(q)}`,
    signal ? { signal } : undefined,
  );
  if (!res.ok)
    throw new Error(
      res.status === 502 ? 'Open Food Facts is unavailable' : `Search failed (${res.status})`,
    );
  const body = (await res.json()) as { products: OffProduct[] };
  return body.products;
}

export async function lookupBarcode(code: string): Promise<OffProduct | null> {
  const res = await fetch(`/api/off/product/${encodeURIComponent(code)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
  return ((await res.json()) as { product: OffProduct | null }).product;
}

export function offFoodId(code: string): string {
  return `off:${code}`;
}

/** Insert (or return the existing) local food for an OFF product. */
export async function cacheOffProduct(p: OffProduct): Promise<Food> {
  const id = offFoodId(p.code);
  const existing = await getFood(id);
  if (existing) return existing;
  const portions: Food['portions'] = [];
  if (p.serving_g) portions.push({ label: '1 serving', grams: p.serving_g });
  const pack = p.quantity?.match(/^(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
  if (pack) {
    const g = Number(pack[1]!.replace(',', '.'));
    if (g > 0 && g <= 3000) portions.push({ label: 'whole pack', grams: g });
  }
  const food: Omit<Food, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
    source: 'off',
    external_id: p.code,
    name: p.name,
    barcode: p.code,
    per_100g: p.per_100g,
    micros: {},
    micro_coverage: 0,
    portions,
    verified: false,
  };
  if (p.brand) food.brand = p.brand;
  return addFood(food, id);
}
