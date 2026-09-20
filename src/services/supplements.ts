// SPEC §17.2–17.3 — the user's supplement list, built from the catalogue or by hand.
import { ageOn, todayKey } from '@/core/dates';
import { catalogueItem, type CatalogueItem, type Person } from '@/core/supplements';
import type { Profile, Supplement, SupplementTiming, SupplementUnit } from '@/core/types';
import {
  addSupplement,
  addSupplementLog,
  removeSupplementLog,
  updateSupplement,
} from '@/db/repo/supplements';

export interface SupplementDraft {
  name: string;
  dose: number;
  unit: SupplementUnit;
  timing: SupplementTiming;
  catalogue_id?: string | undefined;
}

/** Who the doses are for: profile plus the latest weight. */
export function personFor(profile: Profile, weight_kg: number | undefined): Person {
  return {
    sex: profile.sex,
    age: ageOn(profile.birth_date, todayKey()),
    weight_kg,
    height_cm: profile.height_cm,
  };
}

/** Nutrient carried per dose, when the item maps to a tracked micronutrient. */
function nutrientFields(
  item: CatalogueItem | undefined,
  dose: number,
): Pick<Supplement, 'nutrient' | 'nutrient_amount'> {
  if (!item?.nutrient || !item.nutrientPerUnit) return {};
  return { nutrient: item.nutrient, nutrient_amount: dose * item.nutrientPerUnit };
}

export async function createSupplement(d: SupplementDraft): Promise<Supplement> {
  const item = catalogueItem(d.catalogue_id);
  return addSupplement({
    name: d.name.trim(),
    dose: d.dose,
    unit: d.unit,
    timing: d.timing,
    ...(d.catalogue_id ? { catalogue_id: d.catalogue_id } : {}),
    ...nutrientFields(item, d.dose),
  });
}

export async function editSupplement(id: string, d: SupplementDraft): Promise<void> {
  const item = catalogueItem(d.catalogue_id);
  await updateSupplement(id, {
    name: d.name.trim(),
    dose: d.dose,
    unit: d.unit,
    timing: d.timing,
    ...nutrientFields(item, d.dose),
  });
}

/** Tap on the checklist: take it, or untake the latest take. */
export async function setTaken(s: Supplement, date: string, taken: boolean): Promise<void> {
  if (taken) await addSupplementLog(s, date);
  else await removeSupplementLog(s.id, date);
}
