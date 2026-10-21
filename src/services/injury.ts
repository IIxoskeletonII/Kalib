// SPEC §20.16 — injury help: consent, the request, and applying a swap.
//
// The order is the point. The description is screened for red flags on the phone first, which
// needs no consent and no network because nothing leaves the device. Only then is consent
// checked, then the connection, and only then is anything sent: the description and the names
// of the exercises in question, never ids, history or body data (core/injury.ts).
import {
  cleanDescription,
  buildInjuryRequest,
  buildTargets,
  parseInjuryResponse,
  readAnswer,
} from '@/core/injury';
import type { InjuryAnswer, InjuryTarget } from '@/core/injury';
import type { ExerciseDoc } from '@/core/exerciseSearch';
import { screenRedFlags, type FlagLevel, type RedFlag } from '@/core/redFlags';
import type { Routine, RoutineItem } from '@/core/types';
import { getExercise, listExerciseDocs } from '@/db/repo/exercises';
import { getRoutine, updateRoutine } from '@/db/repo/workouts';
import { authHeaders } from './apiAuth';
import { getInjuryConsent, INJURY_CONSENT_VERSION } from './injuryConsent';

export {
  INJURY_CONSENT_KEY,
  INJURY_CONSENT_VERSION,
  getInjuryConsent,
  giveInjuryConsent,
  withdrawInjuryConsent,
  type InjuryConsent,
} from './injuryConsent';

export const INJURY_CONSENT_HEADER = 'x-kalib-consent';
export const INJURY_ENDPOINT = '/api/coach/injury';

export type InjuryProblem =
  'empty' | 'consent' | 'offline' | 'nothing' | 'signin' | 'quota' | 'server';

export class InjuryHelpError extends Error {
  constructor(
    message: string,
    readonly problem: InjuryProblem,
  ) {
    super(message);
    this.name = 'InjuryHelpError';
  }
}

export type InjuryResult = InjuryAnswer & { used?: number; cap?: number };

/** What the question is about: a routine (and so its swaps can be applied), or one exercise. */
export interface InjuryScope {
  routine?: Pick<Routine, 'id' | 'items'> | undefined;
  exercise_id?: string | undefined;
}

export interface InjuryDeps {
  fetch: typeof fetch;
  online: () => boolean;
  auth: () => Promise<Record<string, string>>;
}

const defaultDeps = (): InjuryDeps => ({
  fetch: (...a) => fetch(...a),
  online: () => navigator.onLine,
  auth: authHeaders,
});

export async function injuryTargets(
  scope: InjuryScope,
): Promise<{ targets: InjuryTarget[]; catalogue: ExerciseDoc[] }> {
  const catalogue = await listExerciseDocs();
  const items = scope.routine
    ? scope.routine.items.map((it, index) => ({ exercise_id: it.exercise_id, index }))
    : scope.exercise_id
      ? [{ exercise_id: scope.exercise_id }]
      : [];
  return { targets: buildTargets(items, catalogue), catalogue };
}

const LEVELS: readonly FlagLevel[] = ['emergency', 'urgent', 'soon'];

/** The Worker's own red-flag answer, copied into known fields. */
function serverFlags(raw: unknown): RedFlag[] {
  const out: RedFlag[] = [];
  for (const f of Array.isArray(raw) ? raw : []) {
    const r = (f ?? {}) as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.label !== 'string') continue;
    const level = LEVELS.includes(r.level as FlagLevel) ? (r.level as FlagLevel) : 'urgent';
    out.push({ id: r.id as RedFlag['id'], level, label: r.label.slice(0, 120) });
  }
  return out.length > 0
    ? out
    : [{ id: 'model', level: 'urgent', label: 'something only a doctor can judge' }];
}

export async function askInjuryHelp(
  description: string,
  scope: InjuryScope,
  deps: InjuryDeps = defaultDeps(),
): Promise<InjuryResult> {
  const text = cleanDescription(description);
  if (!text) throw new InjuryHelpError('Say what hurts first.', 'empty');

  // On the phone, before consent or connection matter: this sends nothing.
  const flags = screenRedFlags(text);
  if (flags.length > 0) return { kind: 'doctor', flags, source: 'description' };

  if (!(await getInjuryConsent())) {
    throw new InjuryHelpError('Injury help needs your agreement first.', 'consent');
  }
  if (!deps.online()) {
    throw new InjuryHelpError(
      'Injury help needs a connection. Your routines still work offline.',
      'offline',
    );
  }
  const { targets, catalogue } = await injuryTargets(scope);
  if (targets.length === 0) {
    throw new InjuryHelpError('Choose a routine or an exercise first.', 'nothing');
  }

  const request = buildInjuryRequest(text, targets);
  let res: Response;
  try {
    res = await deps.fetch(INJURY_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [INJURY_CONSENT_HEADER]: INJURY_CONSENT_VERSION,
        ...(await deps.auth()),
      },
      body: JSON.stringify(request),
    });
  } catch {
    throw new InjuryHelpError(
      'Injury help needs a connection. Your routines still work offline.',
      'offline',
    );
  }
  const data = (await res.json().catch(() => ({}))) as {
    result?: unknown;
    flags?: unknown;
    error?: string;
    used?: number;
    cap?: number;
  };
  if (!res.ok) {
    const problem: InjuryProblem =
      res.status === 401 ? 'signin' : res.status === 429 ? 'quota' : 'server';
    const message =
      typeof data.error === 'string' && data.error
        ? data.error
        : problem === 'signin'
          ? 'Sign in (Settings → Sync) to use injury help.'
          : `Injury help did not answer (${res.status}). Try again later.`;
    throw new InjuryHelpError(message, problem);
  }
  if (data.flags !== undefined) {
    return { kind: 'doctor', flags: serverFlags(data.flags), source: 'description' };
  }
  const parsed = parseInjuryResponse(data.result, new Set(targets.map((t) => t.ref)));
  const answer = readAnswer(parsed, targets, catalogue);
  return {
    ...answer,
    ...(typeof data.used === 'number' ? { used: data.used } : {}),
    ...(typeof data.cap === 'number' ? { cap: data.cap } : {}),
  };
}

/**
 * Puts `to` where the routine's `index`th exercise was, keeping its sets, rest, superset and
 * note. A rep range stays unless the new exercise is timed. Returns the undo.
 *
 * Refuses when the routine has changed since the advice was given — the exercise at that
 * position is no longer the one the advice was about.
 */
export async function applySwap(
  routine_id: string,
  index: number,
  from_exercise_id: string,
  to_exercise_id: string,
): Promise<() => Promise<void>> {
  const [routine, to] = await Promise.all([getRoutine(routine_id), getExercise(to_exercise_id)]);
  const item = routine?.items[index];
  if (!routine || !item || item.exercise_id !== from_exercise_id) {
    throw new Error('That routine has changed since. Open it to swap by hand.');
  }
  if (!to) throw new Error('That exercise is no longer in your library.');
  const previous = routine.items;
  const timed = to.load_type === 'time' || to.load_type === 'distance_time';
  const { rep_low, rep_high, ...rest } = item;
  const next: RoutineItem = {
    ...rest,
    ...(!timed && rep_low != null ? { rep_low } : {}),
    ...(!timed && rep_high != null ? { rep_high } : {}),
    exercise_id: to.id,
    name: to.name,
    load_type: to.load_type,
  };
  await updateRoutine(routine_id, { items: previous.map((it, i) => (i === index ? next : it)) });
  return async () => {
    await updateRoutine(routine_id, { items: previous });
  };
}
