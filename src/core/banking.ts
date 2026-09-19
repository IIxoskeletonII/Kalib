// SPEC §5 — weekly calorie banking with bounded redistribution. Pure and deterministic: the
// week is recomputed from its days every time, so the only stored state is the user's choice
// for a 301–1000 kcal overshoot.
import { addDays, fromDateKey, toDateKey } from './dates';

export const ABSORB_LIMIT = 300; // ≤ this: absorbed into tomorrow silently
export const PROMPT_LIMIT = 1000; // ≤ this (and > ABSORB_LIMIT): ask spread vs tomorrow
export const DAY_CUT_CAP = 300; // no day is reduced by more than this
export const DAY_BONUS_CAP = 700; // no day may exceed its target by more than this

export type OvershootChoice = 'spread' | 'tomorrow';

export interface BankingDay {
  date: string;
  /** Base target from the §3 formulas / §4 engine. */
  target: number;
  /** Logged kcal; undefined when nothing was logged (the day is skipped, not treated as zero). */
  consumed?: number | undefined;
}

export interface BankingInput {
  /** The seven days of the week, Monday first. */
  days: BankingDay[];
  today: string;
  /** §3.4 safety floor; no adjusted target goes below it. */
  floor: number;
  choices: Readonly<Record<string, OvershootChoice>>;
  /** Residual carried in from last week: negative = debt, positive = credit. Applied once. */
  carryIn?: number | undefined;
}

export interface BankingNotice {
  date: string;
  kind: 'absorbed' | 'spread' | 'tomorrow' | 'credit' | 'rollover' | 'forgiven' | 'carried';
  amount: number;
  text: string;
}

export interface BankingResult {
  /** Adjusted target per day, all seven. */
  adjusted: Record<string, number>;
  todayTarget: number;
  todayBase: number;
  weekBudget: number;
  consumedToDate: number;
  /** Σ(adjusted − consumed) over logged days before today: positive = banked, negative = over. */
  balance: number;
  daysLeft: number;
  /** An overshoot between the limits still waiting for the user's decision. */
  pending?: { date: string; overshoot: number; spreadPerDay: number; tomorrowCut: number };
  notices: BankingNotice[];
  /** Residual for next week: negative debt or positive credit. Zero when nothing rolls. */
  carryOut: number;
}

/** ISO week: Monday. */
export function weekStart(date: string): string {
  const d = fromDateKey(date);
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  return addDays(toDateKey(d), -dow);
}

export function weekDays(date: string): string[] {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function dayName(date: string): string {
  return fromDateKey(date).toLocaleDateString(undefined, { weekday: 'long' });
}

export function computeBanking(input: BankingInput): BankingResult {
  const { days, today, floor, choices } = input;
  const adjusted: Record<string, number> = {};
  const reduction: Record<string, number> = {};
  for (const d of days) {
    adjusted[d.date] = d.target;
    reduction[d.date] = 0;
  }
  const notices: BankingNotice[] = [];
  let carryOut = 0;
  let pending: BankingResult['pending'];

  /** Reduce the given days by `amount` in total, honouring the per-day cap and the floor. Returns what could not be placed. */
  const cut = (targets: string[], amount: number): number => {
    let left = amount;
    if (targets.length === 0) return left;
    const share = amount / targets.length;
    for (const t of targets) {
      const room = Math.max(0, Math.min(DAY_CUT_CAP - reduction[t]!, adjusted[t]! - floor));
      const take = Math.min(share, room, left);
      adjusted[t]! -= take;
      reduction[t]! += take;
      left -= take;
    }
    return left;
  };

  /** Add `amount` of credit to the given days in order, each up to its bonus cap. Returns the remainder. */
  const credit = (targets: string[], amount: number): number => {
    let left = amount;
    for (const t of targets) {
      const base = days.find((d) => d.date === t)!.target;
      const room = Math.max(0, base + DAY_BONUS_CAP - adjusted[t]!);
      const take = Math.min(room, left);
      adjusted[t]! += take;
      left -= take;
      if (left <= 0) break;
    }
    return left;
  };

  const dates = days.map((d) => d.date);
  const after = (date: string) => dates.filter((x) => x > date);

  // Last week's residual is applied once and never rolls again (§5.1: max one rollover).
  const carryIn = input.carryIn ?? 0;
  if (carryIn < -0.5) {
    const left = cut(dates, -carryIn);
    notices.push({
      date: dates[0]!,
      kind: 'carried',
      amount: -carryIn,
      text: `${Math.round(-carryIn).toLocaleString()} kcal carried over from last week, spread across this week.`,
    });
    if (left > 0.5)
      notices.push({
        date: dates[0]!,
        kind: 'forgiven',
        amount: left,
        text: `${Math.round(left).toLocaleString()} kcal of that is written off — start fresh.`,
      });
  } else if (carryIn > 0.5) {
    credit(dates, carryIn);
    notices.push({
      date: dates[0]!,
      kind: 'carried',
      amount: carryIn,
      text: `${Math.round(carryIn).toLocaleString()} kcal banked last week, added to this week.`,
    });
  }

  for (const d of days) {
    if (d.date >= today || d.consumed == null) continue;
    const delta = d.consumed - adjusted[d.date]!;
    const next = after(d.date);
    if (delta > 0.5) {
      const tomorrow = next.slice(0, 1);
      let mode: OvershootChoice;
      if (delta <= ABSORB_LIMIT) mode = 'tomorrow';
      else if (delta > PROMPT_LIMIT) mode = 'spread';
      else {
        const choice = choices[d.date];
        if (!choice && !pending) {
          pending = {
            date: d.date,
            overshoot: delta,
            spreadPerDay: next.length ? Math.min(DAY_CUT_CAP, delta / next.length) : 0,
            tomorrowCut: Math.min(DAY_CUT_CAP, delta),
          };
        }
        mode = choice ?? 'spread';
      }
      const left = mode === 'tomorrow' ? cut(tomorrow, delta) : cut(next, delta);
      const placed = delta - left;
      if (mode === 'tomorrow') {
        notices.push({
          date: d.date,
          kind: delta <= ABSORB_LIMIT ? 'absorbed' : 'tomorrow',
          amount: placed,
          text: `${dayName(d.date)} was ${Math.round(delta).toLocaleString()} kcal over; ${Math.round(placed).toLocaleString()} comes off ${tomorrow[0] === today ? 'today' : 'the next day'}.`,
        });
      } else if (placed > 0.5) {
        notices.push({
          date: d.date,
          kind: 'spread',
          amount: placed,
          text: `${dayName(d.date)} was ${Math.round(delta).toLocaleString()} kcal over; spread as −${Math.round(placed / Math.max(1, next.length)).toLocaleString()} a day over the rest of the week.`,
        });
      }
      if (left > 0.5) {
        carryOut -= left;
        notices.push({
          date: d.date,
          kind: 'rollover',
          amount: left,
          text: `${Math.round(left).toLocaleString()} kcal could not fit this week and rolls into next week.`,
        });
      }
    } else if (delta < -0.5) {
      const left = credit(next, -delta);
      notices.push({
        date: d.date,
        kind: 'credit',
        amount: -delta - left,
        text: `${dayName(d.date)} banked ${Math.round(-delta).toLocaleString()} kcal for the days ahead.`,
      });
      if (left > 0.5) carryOut += left;
    }
  }

  const todayBase = days.find((d) => d.date === today)?.target ?? days.at(-1)!.target;
  const todayTarget = adjusted[today] ?? todayBase;
  const weekBudget = days.reduce((a, d) => a + d.target, 0);
  const consumedToDate = days.reduce((a, d) => a + (d.date <= today ? (d.consumed ?? 0) : 0), 0);
  const balance = days.reduce(
    (a, d) => a + (d.date < today && d.consumed != null ? adjusted[d.date]! - d.consumed : 0),
    0,
  );
  const daysLeft = dates.filter((x) => x >= today).length;

  const result: BankingResult = {
    adjusted,
    todayTarget,
    todayBase,
    weekBudget,
    consumedToDate,
    balance,
    daysLeft,
    notices,
    carryOut: Math.abs(carryOut) > 0.5 ? carryOut : 0,
  };
  if (pending) result.pending = pending;
  return result;
}
