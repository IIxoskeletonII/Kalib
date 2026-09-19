import { db, LOCAL_USER_ID, nowIso } from '../db';

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = await db.settings.get(key);
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, user_id: LOCAL_USER_ID, value, updated_at: nowIso() });
}
