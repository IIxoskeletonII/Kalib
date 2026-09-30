import { describe, expect, it, vi } from 'vitest';
import { buildSubmission, isBarcode, offSubmitEnabled, submitToOff } from './offSubmit';

const env = { OFF_USER_ID: 'kalib', OFF_PASSWORD: 'secret' };

const good = {
  barcode: '8001234567890',
  name: 'Lenticchie rosse',
  brand: 'Test',
  kcal: 340,
  protein_g: 24,
  carb_g: 55,
  fat_g: 1.5,
  fiber_g: 11,
};

describe('offSubmitEnabled', () => {
  it('is off until the operator configures an account', () => {
    expect(offSubmitEnabled({})).toBe(false);
    expect(offSubmitEnabled({ OFF_USER_ID: 'kalib' })).toBe(false);
    expect(offSubmitEnabled(env)).toBe(true);
  });
});

describe('isBarcode', () => {
  it('accepts the lengths Open Food Facts uses', () => {
    expect(isBarcode('8001234567890')).toBe(true); // EAN-13
    expect(isBarcode('12345670')).toBe(true); // EAN-8
    expect(isBarcode('012345678905')).toBe(true); // UPC-A
    expect(isBarcode('1234567890123')).toBe(true);
  });

  it('refuses anything else', () => {
    for (const c of ['', '123', 'abcdefgh', '800123456789012345', '800-1234']) {
      expect(isBarcode(c), c).toBe(false);
    }
  });
});

describe('buildSubmission', () => {
  it('builds the form Open Food Facts expects', () => {
    const out = buildSubmission(good, env);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.fields).toMatchObject({
      code: '8001234567890',
      product_name: 'Lenticchie rosse',
      brands: 'Test',
      nutrition_data_per: '100g',
      'nutriment_energy-kcal': '340',
      'nutriment_energy-kcal_unit': 'kcal',
      nutriment_proteins: '24',
      nutriment_carbohydrates: '55',
      nutriment_fat: '1.5',
      nutriment_fiber: '11',
    });
    expect(out.fields.comment).toContain('Kalib');
  });

  it('refuses to write anything at all without an account', () => {
    const out = buildSubmission(good, {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(503);
  });

  it('refuses a record that would pollute a public database', () => {
    expect(buildSubmission({ ...good, barcode: 'nope' }, env).ok).toBe(false);
    expect(buildSubmission({ ...good, name: '' }, env).ok).toBe(false);
    expect(buildSubmission({ ...good, kcal: undefined }, env).ok).toBe(false);
    expect(buildSubmission({ ...good, protein_g: undefined }, env).ok).toBe(false);
  });

  it('refuses macros that cannot account for the calories', () => {
    // 24/55/1.5 is 329 kcal; claiming 700 is a misread label, not a food.
    const out = buildSubmission({ ...good, kcal: 700 }, env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(422);
      expect(out.error).toContain('do not account');
    }
  });

  it('allows the slack a real label carries', () => {
    // Rounding on a packet routinely leaves a few percent unaccounted for.
    expect(buildSubmission({ ...good, kcal: 355 }, env).ok).toBe(true);
  });

  it('leaves fibre out when the label did not print it', () => {
    const out = buildSubmission({ ...good, fiber_g: undefined }, env);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fields.nutriment_fiber).toBeUndefined();
  });

  it('caps a runaway name and brand', () => {
    const out = buildSubmission({ ...good, name: 'x'.repeat(500), brand: 'y'.repeat(500) }, env);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fields.product_name!.length).toBeLessThanOrEqual(120);
      expect(out.fields.brands!.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('submitToOff', () => {
  it('posts a form and reports the success Open Food Facts declares', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ status: 1, status_verbose: 'fields saved' }));
    }) as unknown as typeof fetch;
    const out = await submitToOff(good, env, impl);
    expect(out.ok).toBe(true);
    expect(seen[0]!.url).toContain('openfoodfacts.org');
    expect((seen[0]!.init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(String(seen[0]!.init.body)).toContain('code=8001234567890');
  });

  it('reports the reason when Open Food Facts declines', async () => {
    const impl = (async () =>
      new Response(
        JSON.stringify({ status: 0, status_verbose: 'no data received' }),
      )) as unknown as typeof fetch;
    const out = await submitToOff(good, env, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('no data received');
  });

  it('never throws when the network fails', async () => {
    const impl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const out = await submitToOff(good, env, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(502);
  });

  it('does not call out at all when the submission is invalid', async () => {
    const impl = vi.fn(async () => new Response('')) as unknown as typeof fetch;
    await submitToOff({ ...good, barcode: 'x' }, env, impl);
    expect((impl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});
