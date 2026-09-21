// SPEC §9.4 — describe-to-log. Downscale the optional photo, call the Worker, validate,
// ground each item in the offline database, and log the result as `photo` entries.
import {
  groundItems,
  matchItems,
  parseEstimate,
  type EstimateResult,
  type GroundedItem,
} from '@/core/estimate';
import type { LogEntry, MealSlot } from '@/core/types';
import { getFoods, listSearchDocs } from '@/db/repo/foods';
import { addEntry, foodUsageCounts, type LogEntryInput } from '@/db/repo/logEntries';
import { downscale } from './barcode';
import { foodEntryInput } from './logging';

export interface EstimateOutcome {
  result: EstimateResult;
  items: GroundedItem[];
  model: string;
}

/** Dev-only seam so the screenshot harness can run without the Worker. */
type MockEstimate = (body: { description: string; image?: string }) => unknown;
function mock(): MockEstimate | undefined {
  if (!import.meta.env.DEV) return undefined;
  return (window as unknown as { __kalibMockEstimate?: MockEstimate }).__kalibMockEstimate;
}

async function toJpegDataUrl(file: File): Promise<string> {
  const canvas = await downscale(file, 1024);
  return canvas.toDataURL('image/jpeg', 0.8);
}

export async function estimateMeal(description: string, photo?: File | null) {
  const body: { description: string; image?: string } = { description: description.trim() };
  if (photo) body.image = await toJpegDataUrl(photo);

  let raw: unknown;
  let model = 'mock';
  const m = mock();
  if (m) raw = m(body);
  else {
    const res = await fetch('/api/estimate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      result?: unknown;
      model?: string;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? `Estimation failed (${res.status}).`);
    raw = data.result;
    model = data.model ?? 'unknown';
  }
  const result = parseEstimate(raw);
  const [docs, usage] = await Promise.all([listSearchDocs(), foodUsageCounts()]);
  const matches = matchItems(result.items, docs, usage);
  const foods = await getFoods(matches.filter((id): id is string => id != null));
  return {
    result,
    items: groundItems(result.items, matches, foods),
    model,
  } satisfies EstimateOutcome;
}

/** Logs every grounded item as a `photo` entry (§9.4); the image itself is not kept. */
export async function logEstimate(
  o: EstimateOutcome,
  items: readonly GroundedItem[],
  meal_slot: MealSlot,
  date: string,
  description: string,
): Promise<LogEntry[]> {
  const now = new Date();
  const out: LogEntry[] = [];
  for (const g of items) {
    const assumptions = {
      item: g.item,
      description,
      hidden_ingredients_assumed: o.result.hidden_ingredients_assumed,
      model: o.model,
      grounded: g.kind,
    };
    let input: LogEntryInput;
    if (g.food) {
      input = {
        ...foodEntryInput({
          food: g.food,
          grams: g.grams,
          meal_slot,
          date,
          entry_method: 'photo',
          now,
        }),
        confidence: 'medium',
        photo_assumptions: assumptions,
      };
    } else {
      input = {
        logged_at: now.toISOString(),
        date,
        meal_slot,
        name: g.item.name,
        grams: g.grams,
        servings: 1,
        kcal: g.kcal,
        protein_g: g.protein_g,
        carb_g: g.carb_g,
        fat_g: g.fat_g,
        fiber_g: g.fiber_g,
        micros: {},
        entry_method: 'photo',
        confidence: 'low',
        photo_assumptions: assumptions,
      };
    }
    out.push(await addEntry(input));
  }
  return out;
}
