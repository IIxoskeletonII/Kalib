// SPEC §20.15 — the streak and the milestones, assembled from what is stored.
//
// Two things are kept, both in settings (which already sync): the weekly aim, when you set
// one, and which milestones you have been shown. Everything else is derived on read.
import {
  achievements,
  unseen,
  type Achievement,
  type AchievementReport,
} from '@/core/achievements';
import { todayKey } from '@/core/dates';
import {
  aimSetFor,
  MAX_AIM,
  MIN_AIM,
  mondayOf,
  trainingStreak,
  type TrainingStreak,
  type WeeklyAim,
} from '@/core/streak';
import type { WeightUnit } from '@/core/types';
import { getSetting, setSetting } from '@/db/repo/settings';
import { listWeighIns } from '@/db/repo/weighIns';
import { listSessions } from '@/db/repo/workouts';
import { getEasyWeeks } from './block';
import { WEIGHT_UNIT_KEY } from './workouts';

export const WEEKLY_AIM_KEY = 'training:weekly_aim';
export const ACHIEVEMENTS_SEEN_KEY = 'achievements:seen';

/** Years of changing your mind are a few dozen entries; this only stops unbounded growth. */
const KEEP_AIMS = 100;

export async function getAims(): Promise<WeeklyAim[]> {
  const v = await getSetting<WeeklyAim[]>(WEEKLY_AIM_KEY);
  return Array.isArray(v) ? v : [];
}

/**
 * Set the aim from this week on, or hand it back to the app with null. Changing it twice in a
 * week keeps the last answer; weeks already over keep the aim they had.
 */
export async function setAim(sessions: number | null, today = todayKey()): Promise<void> {
  const from = mondayOf(today);
  const value =
    sessions == null ? null : Math.max(MIN_AIM, Math.min(MAX_AIM, Math.round(sessions)));
  const kept = (await getAims()).filter((a) => a.from !== from);
  const next = [...kept, { from, sessions: value }].sort((a, b) => (a.from < b.from ? -1 : 1));
  await setSetting(WEEKLY_AIM_KEY, next.slice(-KEEP_AIMS));
}

export async function getSeen(): Promise<string[]> {
  const v = await getSetting<string[]>(ACHIEVEMENTS_SEEN_KEY);
  return Array.isArray(v) ? v : [];
}

/** Mark milestones as shown, so each is surfaced once and only once. */
export async function markSeen(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const seen = new Set(await getSeen());
  const before = seen.size;
  for (const id of ids) seen.add(id);
  if (seen.size !== before) await setSetting(ACHIEVEMENTS_SEEN_KEY, [...seen].sort());
}

export interface Momentum {
  streak: TrainingStreak;
  report: AchievementReport;
  /** Earned and not yet shown, newest first. */
  fresh: Achievement[];
  /** What you set for this week, or null when the aim is read from your weeks. */
  aim_setting: number | null;
}

export async function momentum(today = todayKey()): Promise<Momentum> {
  const [sessions, easyWeeks, aims, weighIns, unit, seen] = await Promise.all([
    listSessions(),
    getEasyWeeks(),
    getAims(),
    listWeighIns(),
    getSetting<WeightUnit>(WEIGHT_UNIT_KEY),
    getSeen(),
  ]);
  const streak = trainingStreak(sessions, today, { aims, easyWeeks });
  const report = achievements(sessions, {
    weighIns,
    history: streak.history,
    unit: unit === 'lb' ? 'lb' : 'kg',
  });
  return {
    streak,
    report,
    fresh: unseen(report.items, seen),
    aim_setting: aimSetFor(mondayOf(today), aims) ?? null,
  };
}
