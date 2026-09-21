// Recipe sharing between accounts (household use). A recipe travels as a compact, self-
// contained code: seed foods by their deterministic id, own foods embedded in full. No server
// involved; the code rides in a link or is pasted.
import type { Food, Micros, Per100g, Recipe, RecipeItem } from './types';

export interface SharedIngredient {
  /** Display name at the sender's side. */
  n: string;
  /** Grams. */
  g: number;
  /** Seed food id (`usda_foundation:…` / `usda_sr:…`), resolvable on any device. */
  id?: string;
  /** Embedded food when it is the sender's own (custom / packaged); recreated on import. */
  f?: { name: string; brand?: string; per_100g: Per100g; micros?: Micros; barcode?: string };
}

export interface SharedRecipe {
  v: 1;
  name: string;
  portions: number;
  yield_g?: number;
  items: SharedIngredient[];
}

const SEED = new Set<Food['source']>(['usda_foundation', 'usda_sr']);

export function packRecipe(
  recipe: Pick<Recipe, 'name' | 'portions' | 'yield_g' | 'items'>,
  foods: ReadonlyMap<string, Food>,
): SharedRecipe {
  const items: SharedIngredient[] = recipe.items.map((it: RecipeItem) => {
    const food = foods.get(it.food_id);
    const base: SharedIngredient = { n: it.name, g: it.grams };
    if (!food) return base;
    if (SEED.has(food.source)) return { ...base, id: food.id };
    const f: NonNullable<SharedIngredient['f']> = { name: food.name, per_100g: food.per_100g };
    if (food.brand) f.brand = food.brand;
    if (food.barcode) f.barcode = food.barcode;
    if (Object.keys(food.micros).length > 0) f.micros = food.micros;
    return { ...base, f };
  });
  const out: SharedRecipe = { v: 1, name: recipe.name, portions: recipe.portions, items };
  if (recipe.yield_g) out.yield_g = recipe.yield_g;
  return out;
}

// base64url over UTF-8 JSON; short enough for a message, safe in a URL fragment.
export function encodeShare(r: SharedRecipe): string {
  const bytes = new TextEncoder().encode(JSON.stringify(r));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(code: string): SharedRecipe {
  const b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(pad);
  } catch {
    throw new Error('That is not a Kalib recipe code.');
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('That is not a Kalib recipe code.');
  }
  return validate(raw);
}

/** Pulls the code out of pasted text: a bare code, or a share link carrying it in the hash. */
export function extractShareCode(text: string): string | undefined {
  const t = text.trim();
  const hash = t.match(/#([A-Za-z0-9_-]{16,})/);
  if (hash) return hash[1];
  const bare = t.match(/^[A-Za-z0-9_-]{16,}$/);
  return bare ? bare[0] : undefined;
}

function validate(raw: unknown): SharedRecipe {
  if (!raw || typeof raw !== 'object') throw new Error('Recipe code is empty.');
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) throw new Error('This recipe code is from a newer Kalib.');
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Shared recipe';
  const portions = Math.max(1, Math.round(Number(r.portions) || 1));
  const items: SharedIngredient[] = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const g = Number(o.g);
    if (!(g > 0)) continue;
    const item: SharedIngredient = { n: typeof o.n === 'string' ? o.n : 'Ingredient', g };
    if (typeof o.id === 'string' && /^usda_(foundation|sr):/.test(o.id)) item.id = o.id;
    if (o.f && typeof o.f === 'object') {
      const f = o.f as Record<string, unknown>;
      const p = f.per_100g as Partial<Per100g> | undefined;
      if (p && typeof p.kcal === 'number') {
        item.f = {
          name: typeof f.name === 'string' ? f.name : item.n,
          per_100g: {
            kcal: p.kcal,
            protein: Number(p.protein) || 0,
            carb: Number(p.carb) || 0,
            fat: Number(p.fat) || 0,
            fiber: Number(p.fiber) || 0,
          },
        };
        if (typeof f.brand === 'string') item.f.brand = f.brand;
        if (typeof f.barcode === 'string') item.f.barcode = f.barcode;
        if (f.micros && typeof f.micros === 'object') item.f.micros = f.micros as Micros;
      }
    }
    items.push(item);
  }
  if (items.length === 0) throw new Error('The recipe code has no ingredients.');
  const out: SharedRecipe = { v: 1, name, portions, items };
  const y = Number(r.yield_g);
  if (y > 0) out.yield_g = y;
  return out;
}
