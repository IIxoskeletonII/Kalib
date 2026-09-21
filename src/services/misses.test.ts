import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { clearMisses, forgetMiss, listMisses, recordMiss } from './misses';

describe('search misses', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('remembers what was not found, most recent first, counting repeats', async () => {
    await recordMiss('Cornetto  Integrale');
    await recordMiss('stracciatella');
    await recordMiss('cornetto integrale');
    const m = await listMisses();
    expect(m.map((x) => [x.q, x.count])).toEqual([
      ['cornetto integrale', 2],
      ['stracciatella', 1],
    ]);
  });

  it('ignores noise and can forget', async () => {
    await recordMiss('ab');
    await recordMiss('   ');
    await recordMiss('x'.repeat(61));
    expect(await listMisses()).toEqual([]);
    await recordMiss('taralli');
    await forgetMiss('taralli');
    expect(await listMisses()).toEqual([]);
    await recordMiss('taralli');
    await clearMisses();
    expect(await listMisses()).toEqual([]);
  });
});
