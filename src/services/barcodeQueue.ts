// Barcodes scanned without a connection (SPEC §12: "queue and replay on reconnect"). The code
// is kept; when the network returns the product is looked up, cached as an `off` food, and a
// toast offers to log it.
import { getSetting, setSetting } from '@/db/repo/settings';
import type { Food } from '@/core/types';
import { cacheOffProduct, lookupBarcode } from '@/services/off';

export const PENDING_KEY = 'barcode:pending';

export interface PendingBarcode {
  code: string;
  /** The day the scan was for, so the log lands on the right date. */
  date: string;
  at: string;
}

export type DrainOutcome =
  { kind: 'found'; food: Food; date: string } | { kind: 'unknown'; code: string };

export async function listPending(): Promise<PendingBarcode[]> {
  return (await getSetting<PendingBarcode[]>(PENDING_KEY)) ?? [];
}

export async function queueBarcode(code: string, date: string): Promise<void> {
  const pending = await listPending();
  if (pending.some((p) => p.code === code && p.date === date)) return;
  await setSetting(PENDING_KEY, [...pending, { code, date, at: new Date().toISOString() }]);
}

let draining = false;
/**
 * Resolves what it can and reports each outcome. Unknown products are dropped; network
 * failures stay queued for the next reconnect.
 */
export async function drainBarcodeQueue(): Promise<DrainOutcome[]> {
  const out: DrainOutcome[] = [];
  if (draining || !navigator.onLine) return out;
  const pending = await listPending();
  if (pending.length === 0) return out;
  draining = true;
  try {
    const remaining: PendingBarcode[] = [];
    for (const p of pending) {
      let product;
      try {
        product = await lookupBarcode(p.code);
      } catch {
        remaining.push(p);
        continue;
      }
      if (!product) {
        out.push({ kind: 'unknown', code: p.code });
        continue;
      }
      out.push({ kind: 'found', food: await cacheOffProduct(product), date: p.date });
    }
    await setSetting(PENDING_KEY, remaining);
  } finally {
    draining = false;
  }
  return out;
}
