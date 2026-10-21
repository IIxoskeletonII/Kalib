// SPEC §20.12 — the easier weeks you have taken, and the day an offer was last turned down.
//
// These are the only block facts kept; everything else is derived (core/block.ts). They live in
// settings, which already sync, as date ranges rather than as a flag on each session, so a
// session needs no new column and an easier week ended early stays exactly as long as it was.
import { endEasyWeek, easyWeekFrom, type EasyWeek } from '@/core/block';
import { todayKey } from '@/core/dates';
import { getSetting, setSetting } from '@/db/repo/settings';

export const EASY_WEEKS_KEY = 'easy_weeks';
export const BLOCK_RESET_KEY = 'block_reset_on';

/** A year of easier weeks is under ten; this keeps the setting from growing without end. */
const KEEP = 20;

export async function getEasyWeeks(): Promise<EasyWeek[]> {
  return (await getSetting<EasyWeek[]>(EASY_WEEKS_KEY)) ?? [];
}

export async function startEasyWeek(today = todayKey()): Promise<EasyWeek> {
  const week = easyWeekFrom(today);
  const kept = endEasyWeek(await getEasyWeeks(), today);
  await setSetting(EASY_WEEKS_KEY, [...kept, week].slice(-KEEP));
  return week;
}

export async function endEasyWeekNow(today = todayKey()): Promise<void> {
  await setSetting(EASY_WEEKS_KEY, endEasyWeek(await getEasyWeeks(), today));
}

/** "Not now": the block counts again from today, so the offer returns when the next is due. */
export async function declineEasyWeek(today = todayKey()): Promise<void> {
  await setSetting(BLOCK_RESET_KEY, today);
}

/** The state before a change, for its undo. */
export async function snapshotBlock(): Promise<[EasyWeek[], string | undefined]> {
  const [weeks, reset] = await Promise.all([
    getEasyWeeks(),
    getSetting<string | null>(BLOCK_RESET_KEY),
  ]);
  return [weeks, reset ?? undefined];
}

/** For an undo: put the previous answer back. */
export async function restoreBlock(weeks: EasyWeek[], resetOn: string | undefined): Promise<void> {
  await setSetting(EASY_WEEKS_KEY, weeks);
  await setSetting(BLOCK_RESET_KEY, resetOn ?? null);
}
