// SPEC §20.15 — milestones.
//
// Derived from history, never stored, like records (§20.5): what was earned and when is
// recomputed from sessions, so it cannot drift from them and cannot conflict in sync. Only
// which ones you have already been shown is kept.
//
// Three kinds, and only three, because each answers something a person actually wonders:
// how much have I moved in all, how often have I shown up, and how long have I kept it going.
// None of them rewards a single heroic session, which is the behaviour that gets people hurt.
import { addDays, toDateKey } from './dates';
import { sessionVolume } from './sets';
import { bodyweightOn } from './strength';
import { runsByWeek, trainedDays, type StreakWeek } from './streak';
import type { WeightUnit, WorkoutSession } from './types';
import { KG_PER_LB } from './weightUnit';

export type AchievementKind = 'volume' | 'sessions' | 'streak';

/**
 * Lifetime volume against things nobody would try to lift. Each mass is from the people who
 * would know, and the thing is named as precisely as its mass is, so the comparison is a fact.
 */
export const MASSES = [
  {
    id: 'piano',
    // Steinway & Sons, Model D concert grand: 480 kg net (manufacturer's specification).
    kg: 480,
    one: 'a concert grand piano',
    many: 'concert grand pianos',
    title: 'Concert grand',
  },
  {
    id: 'elephant',
    // National Geographic, African elephant: "2.5 to seven tons". A big bull is about six
    // tonnes, which sits inside that range rather than at its edge.
    kg: 6_000,
    one: 'a bull African elephant',
    many: 'bull African elephants',
    title: 'Elephant',
  },
  {
    id: 'whale',
    // NOAA Fisheries, blue whale: "up to 330,000 pounds" = 149,685 kg.
    kg: 330_000 * KG_PER_LB,
    one: 'a blue whale',
    many: 'blue whales',
    title: 'Blue whale',
  },
  {
    id: 'jumbo',
    // Boeing 747-8: maximum takeoff weight 987,000 lb = 447,696 kg.
    kg: 987_000 * KG_PER_LB,
    one: 'a fully loaded 747',
    many: 'fully loaded 747s',
    title: 'Jumbo jet',
  },
  {
    id: 'saturn',
    // NASA, Saturn V fully fuelled for liftoff: 2.8 million kg (6.2 million lb).
    kg: 2_800_000,
    one: 'a fuelled Saturn V',
    many: 'fuelled Saturn Vs',
    title: 'Saturn V',
  },
  {
    id: 'eiffel',
    // Société d'Exploitation de la Tour Eiffel: the metal structure weighs 7,300 tonnes.
    kg: 7_300_000,
    one: 'the iron of the Eiffel Tower',
    many: 'Eiffel Towers of iron',
    title: 'Eiffel Tower',
  },
] as const;

/** Sessions done. The first is the hardest; after that, round numbers people say out loud. */
export const SESSION_COUNTS = [1, 10, 25, 50, 100, 250, 500, 1000] as const;

/** Weeks running (§20.15's streak): a month, a quarter, half a year, a year, two. */
export const STREAK_WEEKS = [4, 12, 26, 52, 104] as const;

export interface Achievement {
  /** Stable: `volume:whale`, `sessions:100`, `streak:12`. What "seen" is keyed on. */
  id: string;
  kind: AchievementKind;
  title: string;
  /** What it takes, in a sentence. */
  detail: string;
  /** In the kind's own unit: kilograms, sessions, or weeks. */
  threshold: number;
  /** Where you are now, in the same unit. */
  value: number;
  /** Local day it was earned; absent until it is. */
  earned_on?: string;
}

export interface Lifetime {
  /** Kilograms moved in working sets, bodyweight work included where bodyweight was known. */
  kg: number;
  /** Bodyweight sets left out because no weigh-in could price them. */
  unknown_sets: number;
  sessions: number;
  /** The longest run in weeks, as it stood at the end of a week you trained in. */
  best_run: number;
}

export interface AchievementReport {
  lifetime: Lifetime;
  /** Every milestone, earned or not, in the order they are listed in. */
  items: Achievement[];
}

/** A session that did some work: the same test the streak uses (core/streak.ts). */
function counts(s: WorkoutSession): boolean {
  return trainedDays([s]).size === 1;
}

function sessionDay(s: WorkoutSession): string {
  return toDateKey(new Date(s.started_at));
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}

/**
 * Every milestone, and the day each was earned, from finished sessions of any age.
 *
 * Bodyweight work is priced at the weigh-in nearest before its session, as the progress line
 * is (§20.11); a set nothing can price is counted in `unknown_sets` and left out, never
 * guessed. Streak milestones read the weekly history `trainingStreak` already built.
 */
export function achievements(
  sessions: readonly WorkoutSession[],
  opts: {
    weighIns?: readonly { date: string; weight_kg: number }[];
    history?: readonly StreakWeek[];
    unit?: WeightUnit;
  } = {},
): AchievementReport {
  const weighIns = opts.weighIns ?? [];
  const unit = opts.unit ?? 'kg';
  const done = sessions
    .filter(counts)
    .slice()
    .sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0));

  // One pass in time order: the running totals say when each threshold was crossed.
  const volumeEarned = new Map<string, string>();
  const sessionEarned = new Map<number, string>();
  let kg = 0;
  let unknown_sets = 0;
  done.forEach((s, i) => {
    const day = sessionDay(s);
    const v = sessionVolume(s, bodyweightOn(weighIns, day));
    kg += v.kg;
    unknown_sets += v.unknown_sets;
    for (const m of MASSES) if (kg >= m.kg && !volumeEarned.has(m.id)) volumeEarned.set(m.id, day);
    for (const n of SESSION_COUNTS)
      if (i + 1 >= n && !sessionEarned.has(n)) sessionEarned.set(n, day);
  });

  const streakEarned = new Map<number, string>();
  let best_run = 0;
  const history = opts.history ?? [];
  const runs = runsByWeek(history);
  runs.forEach((r, i) => {
    // Earned in a week you trained: a forgiven gap keeps a run alive, but nobody should get a
    // milestone for a week they did nothing in. The progress shown follows the same rule, so
    // it never reads "4 of 4" on a milestone not yet earned.
    if (history[i]!.days === 0) return;
    const w = history[i]!;
    best_run = Math.max(best_run, r.weeks);
    for (const n of STREAK_WEEKS) {
      if (r.weeks >= n && !streakEarned.has(n)) streakEarned.set(n, weekDone(w));
    }
  });

  const items: Achievement[] = [
    ...MASSES.map((m) => ({
      id: `volume:${m.id}`,
      kind: 'volume' as const,
      title: m.title,
      detail: `Lift ${formatMass(m.kg, unit)} in all — ${m.one}`,
      threshold: m.kg,
      value: kg,
      ...(volumeEarned.has(m.id) ? { earned_on: volumeEarned.get(m.id)! } : {}),
    })),
    ...SESSION_COUNTS.map((n) => ({
      id: `sessions:${n}`,
      kind: 'sessions' as const,
      title: n === 1 ? 'First session' : `${n.toLocaleString('en-GB')} sessions`,
      detail: n === 1 ? 'Finish a workout' : `Finish ${plural(n, 'workout', 'workouts')}`,
      threshold: n,
      value: done.length,
      ...(sessionEarned.has(n) ? { earned_on: sessionEarned.get(n)! } : {}),
    })),
    ...STREAK_WEEKS.map((n) => ({
      id: `streak:${n}`,
      kind: 'streak' as const,
      title: `${n} weeks running`,
      detail: `Keep a run going for ${n} weeks`,
      threshold: n,
      value: best_run,
      ...(streakEarned.has(n) ? { earned_on: streakEarned.get(n)! } : {}),
    })),
  ];

  return { lifetime: { kg, unknown_sets, sessions: done.length, best_run }, items };
}

/** The day a week's milestone was earned: its last training day. */
function weekDone(w: StreakWeek): string {
  return w.last_day ?? addDays(w.monday, 6);
}

/**
 * Earned milestones not yet shown, newest first. Someone arriving with a year of history
 * should get one moment, not nineteen, so a screen shows the first of these and marks them all.
 */
export function unseen(items: readonly Achievement[], seen: readonly string[]): Achievement[] {
  const shown = new Set(seen);
  return items
    .filter((a) => a.earned_on != null && !shown.has(a.id))
    .sort((a, b) => (a.earned_on! < b.earned_on! ? 1 : a.earned_on! > b.earned_on! ? -1 : 0));
}

/** The next milestone of a kind not yet earned, for "what is coming". */
export function nextUp(
  items: readonly Achievement[],
  kind: AchievementKind,
): Achievement | undefined {
  return items.find((a) => a.kind === kind && a.earned_on == null);
}

/** What earning it means, said as done: "150 t lifted in all — a blue whale". */
export function earnedLine(a: Achievement, unit: WeightUnit): string {
  if (a.kind === 'volume') {
    const m = MASSES.find((x) => `volume:${x.id}` === a.id);
    const mass = `${formatMass(a.threshold, unit)} lifted in all`;
    return m ? `${mass} — ${m.one}` : mass;
  }
  if (a.kind === 'sessions') {
    return a.threshold === 1
      ? 'Your first workout, finished'
      : `${plural(a.threshold, 'workout', 'workouts')} finished`;
  }
  return `A run of ${a.threshold} weeks`;
}

/** How far along, 0–1. */
export function progressOf(a: Achievement): number {
  if (a.threshold <= 0) return 1;
  return Math.max(0, Math.min(1, a.value / a.threshold));
}

/**
 * A big mass, readably. Kilograms become tonnes from ten tonnes up, where the last three digits
 * stop meaning anything; pounds become millions from a million up. Never more precision than a
 * lifetime of self-reported sets deserves (§2.4).
 */
export function formatMass(kg: number, unit: WeightUnit): string {
  if (unit === 'lb') {
    const lb = kg / KG_PER_LB;
    if (Math.round(lb) >= 1_000_000) return `${trim(lb / 1_000_000)} million lb`;
    return `${Math.round(lb).toLocaleString('en-GB')} lb`;
  }
  if (kg >= 10_000) {
    const t = kg / 1000;
    return `${t >= 100 ? Math.round(t).toLocaleString('en-GB') : trim(t)} t`;
  }
  return `${Math.round(kg).toLocaleString('en-GB')} kg`;
}

/** One decimal, dropped when it is zero. */
function trim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? r.toLocaleString('en-GB') : r.toFixed(1);
}

/**
 * Lifetime volume as the biggest thing it beats: "1.4 blue whales". Below the smallest, a share
 * of it, so the first session already has a comparison. Undefined for nothing lifted.
 */
export function comparison(kg: number): string | undefined {
  if (!(kg > 0)) return undefined;
  let beaten: (typeof MASSES)[number] | undefined;
  for (const m of MASSES) if (kg >= m.kg) beaten = m;
  if (!beaten) {
    const first = MASSES[0];
    return `${Math.max(1, Math.round((kg / first.kg) * 100))}% of ${first.one}`;
  }
  const ratio = kg / beaten.kg;
  if (ratio < 1.05) return beaten.one;
  const n = ratio >= 10 ? Math.round(ratio).toLocaleString('en-GB') : trim(ratio);
  return `${n} ${beaten.many}`;
}
