// SPEC §5 — assemble the week for the banking engine from targets, entries and choices.
import {
  computeBanking,
  weekDays,
  type BankingDay,
  type BankingResult,
  type OvershootChoice,
} from '@/core/banking';
import { addDays } from '@/core/dates';
import { sexFloor } from '@/core/targets';
import { listDailyTargets } from '@/db/repo/dailyTargets';
import { listEntriesSince } from '@/db/repo/logEntries';
import { getCurrentProfile } from '@/db/repo/profiles';
import { getSetting, setSetting } from '@/db/repo/settings';
import { currentTargets } from './targets';

const CHOICES_KEY = 'banking:choices';

export async function getChoices(): Promise<Record<string, OvershootChoice>> {
  return (await getSetting<Record<string, OvershootChoice>>(CHOICES_KEY)) ?? {};
}

export async function recordChoice(date: string, choice: OvershootChoice): Promise<void> {
  const all = await getChoices();
  await setSetting(CHOICES_KEY, { ...all, [date]: choice });
}

async function weekInput(
  date: string,
  today: string,
): Promise<{ days: BankingDay[]; floor: number } | null> {
  const days = weekDays(date);
  const [targets, entries, current, profile] = await Promise.all([
    listDailyTargets(),
    listEntriesSince(days[0]!),
    currentTargets(today),
    getCurrentProfile(),
  ]);
  if (!current || !profile) return null;
  const targetByDate = new Map(targets.map((t) => [t.date, t.kcal]));
  const consumedByDate = new Map<string, number>();
  for (const e of entries) {
    if (e.date > days[6]!) continue;
    consumedByDate.set(e.date, (consumedByDate.get(e.date) ?? 0) + e.kcal);
  }
  // Days the app never opened have no stored target; use the nearest earlier one, else today's.
  let last = Math.round(current.kcal);
  const filled = days.map((d) => {
    const stored = targetByDate.get(d);
    if (stored != null) last = stored;
    return { date: d, target: stored ?? last, consumed: consumedByDate.get(d) };
  });
  // §3.4 safety floors: no banked day may go below any of them.
  const floor = Math.max(
    current.bmr * 1.1,
    sexFloor(profile.sex),
    current.protein_g * 4 + current.fat_g * 9 + 50,
  );
  return { days: filled, floor };
}

/** The current week's banking state for `date`; null before onboarding. */
export async function computeWeekBanking(date: string): Promise<BankingResult | null> {
  const [thisWeek, choices] = await Promise.all([weekInput(date, date), getChoices()]);
  if (!thisWeek) return null;
  // Last week's residual rolls in once (§5.1). Its own carry-in is deliberately ignored.
  const lastDate = addDays(weekDays(date)[0]!, -1);
  const lastWeek = await weekInput(lastDate, date);
  const carryIn = lastWeek
    ? computeBanking({ ...lastWeek, today: addDays(lastDate, 1), choices }).carryOut
    : 0;
  return computeBanking({ ...thisWeek, today: date, choices, carryIn });
}
