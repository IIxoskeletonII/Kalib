// SPEC §4 — assemble the engine's input from the store, keep the daily estimate, and run the
// weekly publish with its guard rails. The maths lives in core/tdee.ts.
import { weekStart } from '@/core/banking';
import { COMPLETE_DAY_RATIO } from '@/core/coach';
import { todayKey } from '@/core/dates';
import {
  decidePublish,
  estimateTdee,
  type EngineDay,
  type EngineResult,
  type PublishDecision,
} from '@/core/tdee';
import { computeTrend } from '@/core/trend';
import type { LogEntry } from '@/core/types';
import { listDailyTargets } from '@/db/repo/dailyTargets';
import { firstActivityDate, listEntriesSince } from '@/db/repo/logEntries';
import { getSetting, setSetting } from '@/db/repo/settings';
import { upsertTdeeEstimate } from '@/db/repo/tdeeEstimates';
import { listWeighIns } from '@/db/repo/weighIns';
import {
  PUBLISHED_TDEE_KEY,
  formulaTargets,
  getPublishedTdee,
  refreshTargetForDate,
  type PublishedTdee,
} from './targets';

/** A measurement the guard rails refused to apply on their own (§4.3). */
export interface PendingTdee extends PublishDecision {
  formula: number;
  estimate_date: string;
  /** ISO week start the user chose to keep the formula for. */
  dismissed_week?: string;
}

export const PENDING_TDEE_KEY = 'tdee:pending';

export interface TdeeState {
  result: EngineResult;
  published: PublishedTdee | undefined;
  pending: PendingTdee | undefined;
  /** Formula TDEE today, for the divergence card. */
  formula: number | undefined;
}

/** The daily series from day 1 to `today`, as the engine wants it (§4.5 completeness rule). */
export async function buildEngineDays(today: string): Promise<{ day1: string; days: EngineDay[] }> {
  const day1 = (await firstActivityDate()) ?? today;
  const [weighIns, entries, targets] = await Promise.all([
    listWeighIns(),
    listEntriesSince(day1),
    listDailyTargets(),
  ]);
  const trend = new Map(computeTrend(weighIns, undefined, today).map((p) => [p.date, p]));
  const targetByDate = new Map(targets.map((t) => [t.date, t.kcal]));
  const byDate = new Map<string, LogEntry[]>();
  for (const e of entries) {
    if (e.date > today) continue;
    (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);
  }
  const days: EngineDay[] = [];
  const dates = new Set<string>([...trend.keys(), ...byDate.keys()]);
  for (const date of [...dates].sort()) {
    const list = byDate.get(date) ?? [];
    let kcal = 0;
    let low = 0;
    for (const e of list) {
      kcal += e.kcal;
      if (e.confidence !== 'high') low += e.kcal;
    }
    const target = targetByDate.get(date);
    const logged = list.length > 0 && (target == null || kcal >= COMPLETE_DAY_RATIO * target);
    const t = trend.get(date);
    days.push({
      date,
      kcal: logged ? kcal : undefined,
      low_confidence_share: logged && kcal > 0 ? low / kcal : undefined,
      trend: t?.trend,
      weighed: t?.weighed ?? false,
    });
  }
  return { day1, days };
}

/** Recompute today's estimate and store it. */
export async function computeTdee(today: string = todayKey()): Promise<EngineResult> {
  const { day1, days } = await buildEngineDays(today);
  const result = estimateTdee(days, day1, today);
  if (result.status === 'ok') {
    const e = result.estimate;
    await upsertTdeeEstimate({
      computed_on: e.computed_on,
      tdee_kcal: e.tdee_kcal,
      ci_low: e.ci_low,
      ci_high: e.ci_high,
      window_days: e.window_days,
      logged_days: e.logged_days,
      weighed_days: e.weighed_days,
      data_quality: e.data_quality,
    });
  }
  return result;
}

async function applyPublish(
  decision: PublishDecision,
  estimate_date: string,
  today: string,
): Promise<PublishedTdee> {
  const published: PublishedTdee = {
    tdee: decision.tdee,
    measured: decision.measured,
    since: today,
    estimate_date,
  };
  await setSetting(PUBLISHED_TDEE_KEY, published);
  await setSetting(PENDING_TDEE_KEY, null);
  await refreshTargetForDate(today);
  return published;
}

/**
 * §4.4 — once per ISO week, move the published TDEE toward the latest estimate (±150 cap).
 * A measurement >600 kcal from the formula is parked as `pending` for the card instead.
 */
export async function maybePublish(result: EngineResult, today: string = todayKey()) {
  if (result.status !== 'ok') return;
  const [published, formula, pending] = await Promise.all([
    getPublishedTdee(),
    formulaTargets(today),
    getSetting<PendingTdee | null>(PENDING_TDEE_KEY),
  ]);
  if (!formula) return;
  const week = weekStart(today);
  if (published && published.since >= week) return; // already this week
  if (pending?.dismissed_week === week) return; // user kept the formula this week
  const previous = published?.tdee ?? formula.tdee;
  const decision = decidePublish(result.estimate.tdee_kcal, previous, formula.tdee);
  if (decision.diverged) {
    await setSetting(PENDING_TDEE_KEY, {
      ...decision,
      formula: Math.round(formula.tdee),
      estimate_date: result.estimate.computed_on,
    } satisfies PendingTdee);
    return;
  }
  await applyPublish(decision, result.estimate.computed_on, today);
}

/** The card's "Apply anyway": publish the parked measurement, cap still applied. */
export async function acceptPendingTdee(today: string = todayKey()): Promise<void> {
  const pending = await getSetting<PendingTdee | null>(PENDING_TDEE_KEY);
  if (!pending) return;
  await applyPublish(pending, pending.estimate_date, today);
}

/** The card's "Keep the formula": no publish until next week. */
export async function dismissPendingTdee(today: string = todayKey()): Promise<void> {
  const pending = await getSetting<PendingTdee | null>(PENDING_TDEE_KEY);
  if (!pending) return;
  await setSetting(PENDING_TDEE_KEY, { ...pending, dismissed_week: weekStart(today) });
}

/** Everything the UI needs, after the daily recompute and a possible publish. */
export async function tdeeState(today: string = todayKey()): Promise<TdeeState> {
  const result = await computeTdee(today);
  await maybePublish(result, today);
  const [published, pending, formula] = await Promise.all([
    getPublishedTdee(),
    getSetting<PendingTdee | null>(PENDING_TDEE_KEY),
    formulaTargets(today),
  ]);
  return {
    result,
    published,
    pending: pending && pending.dismissed_week !== weekStart(today) ? pending : undefined,
    formula: formula ? Math.round(formula.tdee) : undefined,
  };
}
