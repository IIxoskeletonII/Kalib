// SPEC §7.2 — giving back to Open Food Facts.
//
// Kalib reads barcodes from Open Food Facts, which is a public database built by the people who
// use it. When §9.6 reads a label that OFF has never seen, the app is holding exactly the data
// OFF is missing, and sending it back costs nothing: writes are unmetered and the next person to
// scan that packet gets a hit instead of a dead end.
//
// Two rules make this safe to ship. It is entirely opt-in per product, because sending someone's
// data to another service is their decision and not the app's. And it is inert unless the
// operator has configured an Open Food Facts account, so a fork of this repo cannot write to the
// commons under someone else's name by accident.

export interface OffSubmitEnv {
  /** Open Food Facts account for contributions. Absent means the feature is switched off. */
  OFF_USER_ID?: string;
  OFF_PASSWORD?: string;
}

const OFF_WRITE_URL = 'https://world.openfoodfacts.org/cgi/product_jqm2.pl';

export function offSubmitEnabled(env: OffSubmitEnv): boolean {
  return Boolean(env.OFF_USER_ID && env.OFF_PASSWORD);
}

export interface OffSubmission {
  barcode?: string | undefined;
  name?: string | undefined;
  brand?: string | undefined;
  /** Per 100 g, as the label prints them. */
  kcal?: number | undefined;
  protein_g?: number | undefined;
  carb_g?: number | undefined;
  fat_g?: number | undefined;
  fiber_g?: number | undefined;
}

/** A barcode OFF will accept: 8, 12, 13 or 14 digits. */
export function isBarcode(code: string): boolean {
  return /^\d{8}$|^\d{12,14}$/.test(code);
}

const num = (v: unknown, hi: number): number | undefined => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= hi ? Math.round(n * 100) / 100 : undefined;
};

export interface CheckedSubmission {
  ok: true;
  fields: Record<string, string>;
}

/**
 * Validate a contribution. Refuses anything that would put a bad record into a public database:
 * no barcode, no name, or calories that the macros cannot account for.
 */
export function buildSubmission(
  s: OffSubmission,
  env: OffSubmitEnv,
): CheckedSubmission | { ok: false; status: number; error: string } {
  if (!offSubmitEnabled(env)) {
    return { ok: false, status: 503, error: 'Contributing is not set up on this server.' };
  }
  const barcode = (s.barcode ?? '').trim();
  if (!isBarcode(barcode)) return { ok: false, status: 400, error: 'That is not a barcode.' };
  const name = (s.name ?? '').trim().slice(0, 120);
  if (name.length < 2) return { ok: false, status: 400, error: 'A product needs a name.' };

  const kcal = num(s.kcal, 900);
  const protein = num(s.protein_g, 100);
  const carb = num(s.carb_g, 100);
  const fat = num(s.fat_g, 100);
  const fiber = num(s.fiber_g, 100);
  if (kcal == null || protein == null || carb == null || fat == null) {
    return { ok: false, status: 400, error: 'Per-100 g energy and macros are needed.' };
  }
  // The same 4/4/9 sanity check the client applies before showing a label reading. A record
  // that fails it is worse than no record at all.
  const fromMacros = protein * 4 + carb * 4 + fat * 9;
  if (Math.abs(fromMacros - kcal) > Math.max(30, kcal * 0.3)) {
    return { ok: false, status: 422, error: 'Those macros do not account for the calories.' };
  }

  const fields: Record<string, string> = {
    code: barcode,
    user_id: env.OFF_USER_ID!,
    password: env.OFF_PASSWORD!,
    product_name: name,
    nutrition_data_per: '100g',
    'nutriment_energy-kcal': String(kcal),
    'nutriment_energy-kcal_unit': 'kcal',
    nutriment_proteins: String(protein),
    nutriment_carbohydrates: String(carb),
    nutriment_fat: String(fat),
    // Credit where the data came from, as the OFF guidelines ask.
    comment: 'Added with Kalib from a nutrition-label photograph',
  };
  const brand = (s.brand ?? '').trim().slice(0, 80);
  if (brand) fields.brands = brand;
  if (fiber != null) fields.nutriment_fiber = String(fiber);
  return { ok: true, fields };
}

/** Send a validated contribution. Never throws; a failure here must not lose the user's food. */
export async function submitToOff(
  s: OffSubmission,
  env: OffSubmitEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; barcode: string } | { ok: false; status: number; error: string }> {
  const checked = buildSubmission(s, env);
  if (!checked.ok) return checked;
  let res: Response;
  try {
    res = await fetchImpl(OFF_WRITE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'Kalib/1.0 (+https://kalib.kalib.workers.dev)',
      },
      body: new URLSearchParams(checked.fields).toString(),
    });
  } catch {
    return { ok: false, status: 502, error: 'Could not reach Open Food Facts.' };
  }
  if (!res.ok) {
    return { ok: false, status: 502, error: `Open Food Facts answered ${res.status}.` };
  }
  const text = (await res.text()).slice(0, 400);
  // product_jqm2.pl answers with JSON carrying status 1 on success.
  try {
    const data = JSON.parse(text) as { status?: number; status_verbose?: string };
    if (data.status === 1) return { ok: true, barcode: checked.fields.code! };
    return {
      ok: false,
      status: 502,
      error: data.status_verbose ?? 'Open Food Facts rejected the product.',
    };
  } catch {
    return { ok: false, status: 502, error: 'Open Food Facts gave an unreadable answer.' };
  }
}
