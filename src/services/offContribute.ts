// SPEC §7.2 — offering a scanned product back to Open Food Facts.
//
// Strictly opt-in, one product at a time. Sending data to another service is the person's
// decision, so nothing here runs unless they tick the box, and the box only appears when the
// server has an Open Food Facts account configured.
import { authHeaders } from '@/services/apiAuth';

export interface Contribution {
  barcode: string;
  name: string;
  brand?: string | undefined;
  /** Per 100 g, exactly as the label printed them. */
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  fiber_g?: number | undefined;
}

let cached: boolean | undefined;

/** Whether this server can contribute at all. Asked once per session. */
export async function contributeEnabled(): Promise<boolean> {
  if (cached !== undefined) return cached;
  try {
    const res = await fetch('/api/off/contribute');
    if (!res.ok) {
      cached = false;
      return cached;
    }
    const data = (await res.json()) as { enabled?: boolean };
    cached = data.enabled === true;
  } catch {
    cached = false;
  }
  return cached;
}

/** Send one product. Never throws: a contribution failing must not cost the user their food. */
export async function contributeProduct(
  c: Contribution,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const auth = await authHeaders();
    if (!('authorization' in auth)) return { ok: false, error: 'Sign in to contribute products.' };
    const res = await fetch('/api/off/contribute', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify(c),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `Failed (${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach Open Food Facts.' };
  }
}
