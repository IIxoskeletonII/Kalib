import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { getSetting, setSetting } from '@/db/repo/settings';
import { dexieLocal } from './sync/local';
import { getRestAlert, REST_ALERT_KEY, setRestAlert } from './sessionAids';

beforeEach(async () => {
  await db.settings.clear();
});

describe('rest alert setting', () => {
  it('is on for someone who has never touched it', async () => {
    expect(await getRestAlert()).toBe(true);
  });

  it('turns off and back on', async () => {
    await setRestAlert(false);
    expect(await getRestAlert()).toBe(false);
    expect(await getSetting(REST_ALERT_KEY)).toBe(false);
    await setRestAlert(true);
    expect(await getRestAlert()).toBe(true);
  });

  it('reads a stored null, as a sync from an older client might write, as on', async () => {
    await setSetting(REST_ALERT_KEY, null);
    expect(await getRestAlert()).toBe(true);
  });

  it('is an account setting that syncs, not a device one', async () => {
    await setRestAlert(false);
    const outgoing = await dexieLocal.changedSince('settings', null);
    expect(outgoing.map((r) => r.key)).toContain(REST_ALERT_KEY);
  });
});
