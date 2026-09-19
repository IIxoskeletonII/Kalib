import Dexie from 'dexie';
import type { Profile, SyncMeta } from '@/core/types';
import { db, LOCAL_USER_ID, newMeta } from '../db';

export type ProfileInput = Omit<Profile, keyof SyncMeta>;

/** Profiles are append-only snapshots (SPEC §6); the newest live row is current. */
export async function getCurrentProfile(): Promise<Profile | undefined> {
  const rows = await db.profiles
    .where('[user_id+created_at]')
    .between([LOCAL_USER_ID, Dexie.minKey], [LOCAL_USER_ID, Dexie.maxKey])
    .reverse()
    .toArray();
  return rows.find((p) => p.deleted_at == null);
}

export async function saveProfileSnapshot(input: ProfileInput): Promise<Profile> {
  const row: Profile = { ...newMeta(), ...input };
  await db.profiles.add(row);
  return row;
}
