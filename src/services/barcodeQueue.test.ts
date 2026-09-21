import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { drainBarcodeQueue, listPending, queueBarcode } from './barcodeQueue';

const product = {
  code: '8076809513753',
  name: 'Penne Rigate',
  brand: 'Barilla',
  per_100g: { kcal: 359, protein: 12.5, carb: 71.2, fat: 2, fiber: 3 },
  serving_g: 80,
  portions: [{ label: '1 serving', grams: 80 }],
};

describe('offline barcode queue', () => {
  beforeEach(async () => {
    await db.settings.clear();
    await db.foods.clear();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it('queues once per code and day', async () => {
    await queueBarcode('8076809513753', '2026-09-21');
    await queueBarcode('8076809513753', '2026-09-21');
    await queueBarcode('8076809513753', '2026-09-22');
    expect((await listPending()).map((p) => p.date)).toEqual(['2026-09-21', '2026-09-22']);
  });

  it('replays when online: found products are cached, unknown ones dropped, failures kept', async () => {
    await queueBarcode('8076809513753', '2026-09-21');
    await queueBarcode('0000000000001', '2026-09-21');
    await queueBarcode('0000000000002', '2026-09-21');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/8076809513753')) return Response.json({ product });
      if (url.endsWith('/0000000000001')) return Response.json({ product: null }, { status: 404 });
      return new Response('down', { status: 502 });
    });
    const outcomes = await drainBarcodeQueue();
    expect(outcomes.map((o) => o.kind)).toEqual(['found', 'unknown']);
    const first = outcomes[0]!;
    expect(first.kind === 'found' && first.food.name).toContain('Penne');
    expect((await listPending()).map((p) => p.code)).toEqual(['0000000000002']);
    expect(await db.foods.count()).toBe(1);
  });

  it('does nothing offline', async () => {
    await queueBarcode('8076809513753', '2026-09-21');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await drainBarcodeQueue()).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(await listPending()).toHaveLength(1);
  });
});
