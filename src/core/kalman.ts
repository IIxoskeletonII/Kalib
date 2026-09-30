// SPEC §4.2/§4.5 — the state-space filter behind the TDEE estimate.
//
// The original estimator read the trend weight on two days and divided the difference by the
// span. That throws away every weigh-in in between, and it inherits the EMA's lag: §4.5 records
// the consequence, "the trend on day 11 still remembers days 1–10, so the first estimates run
// ≈200 kcal high", and notes that regressing on raw weigh-ins removes the bias but is twice as
// noisy.
//
// A filter is the way out of that trade-off. Two things are unknown and evolve: true weight and
// TDEE. Energy balance links them — a day of eating I kcal against a burn of E moves true weight
// by (I − E)/ρ — and the scale is a noisy look at weight alone. Writing that down as a linear
// Gaussian system and running a Kalman filter over raw readings uses every observation, needs no
// window, tolerates missing days, and returns a posterior variance instead of an error bar
// assembled by hand.
//
// State x = [weight_kg, tdee_kcal], covariance P = [[var_w, cov], [cov, var_e]].
// Predict:  w += (intake − tdee)/ρ,  tdee unchanged (a slow random walk).
// Update:   a scale reading corrects weight, and through the covariance, TDEE with it.
//
// Deliberately hand-rolled at 2×2 rather than pulled from a matrix library: every line here is
// checked against an arithmetic expectation in kalman.test.ts.

/** One day of evidence. Either field may be missing; a day with neither only adds uncertainty. */
export interface FilterDay {
  date: string;
  /** Logged intake, kcal. Missing means the day was not logged. */
  intake?: number | undefined;
  /**
   * 1σ of this day's intake, kcal. Lets §7.4 confidence reach the filter: a day of weighed
   * food is trusted more than a day of estimates. Falls back to `intake_sigma_kcal`.
   */
  intake_sigma?: number | undefined;
  /** Raw scale reading, kg — not the trend. Missing means no weigh-in. */
  raw?: number | undefined;
  /**
   * Multiplier on this reading's measurement noise, for days the scale is known to lie:
   * cycle-driven water retention (§4.1, `cycle.ts`). 1 means an ordinary day.
   */
  sigma_scale?: number | undefined;
}

export interface FilterOptions {
  /** kcal per kg of the change being measured (7,700 for fat). */
  energy_density: number;
  /** 1σ of a single raw weigh-in around true weight, kg. */
  weight_sigma_kg: number;
  /** 1σ of a logged day's intake, kcal — self-report error. */
  intake_sigma_kcal: number;
  /** 1σ when a day's intake is unknown and the running mean stands in for it, kcal. */
  unlogged_intake_sigma_kcal: number;
  /** 1σ of TDEE's own daily drift, kcal. Small: TDEE moves over months, not days. */
  tdee_drift_kcal: number;
  /** 1σ of daily mass change energy balance does not explain (gut content, glycogen), kg. */
  biological_sigma_kg: number;
  /** 1σ of the starting TDEE guess, kcal. Wide, so the data wins quickly. */
  prior_tdee_sigma: number;
  /** Residuals beyond this many σ are treated as suspect rather than trusted. */
  gate_sigma: number;
  /** Measurement variance multiplier applied to a gated reading. */
  gate_inflate: number;
}

export const DEFAULT_FILTER: FilterOptions = {
  energy_density: 7700,
  weight_sigma_kg: 0.7,
  intake_sigma_kcal: 220,
  unlogged_intake_sigma_kcal: 500,
  tdee_drift_kcal: 9,
  biological_sigma_kg: 0.05,
  prior_tdee_sigma: 600,
  gate_sigma: 4,
  gate_inflate: 9,
};

export interface FilterState {
  weight: number;
  tdee: number;
  var_weight: number;
  var_tdee: number;
  cov: number;
}

export interface FilterRun {
  state: FilterState;
  /** Readings folded in, gated ones included. */
  observations: number;
  /** Readings whose residual exceeded the gate. */
  gated: number;
  /** Days the filter stepped over. */
  steps: number;
}

/** A starting point: weight is anchored by the first reading, TDEE only loosely by the prior. */
export function initialState(weight: number, tdee: number, o: FilterOptions): FilterState {
  return {
    weight,
    tdee,
    var_weight: o.weight_sigma_kg ** 2,
    var_tdee: o.prior_tdee_sigma ** 2,
    cov: 0,
  };
}

/**
 * One day forward. `intake` is what was eaten; when it is unknown the caller passes its best
 * substitute and says so with `known: false`, which widens the step instead of pretending.
 */
export function predict(
  s: FilterState,
  intake: number,
  known: boolean,
  o: FilterOptions,
  dayIntakeSigma?: number | undefined,
): FilterState {
  const k = 1 / o.energy_density;
  const weight = s.weight + (intake - s.tdee) * k;
  // P' = F P Fᵀ + Q with F = [[1, −k], [0, 1]].
  const intakeSigma = known
    ? (dayIntakeSigma ?? o.intake_sigma_kcal)
    : o.unlogged_intake_sigma_kcal;
  const qw = (intakeSigma * k) ** 2 + o.biological_sigma_kg ** 2;
  const qe = o.tdee_drift_kcal ** 2;
  return {
    weight,
    tdee: s.tdee,
    var_weight: s.var_weight - 2 * k * s.cov + k * k * s.var_tdee + qw,
    cov: s.cov - k * s.var_tdee,
    var_tdee: s.var_tdee + qe,
  };
}

export interface UpdateResult {
  state: FilterState;
  /** True when the residual exceeded the gate and the reading was down-weighted. */
  gated: boolean;
}

/** Fold in a scale reading. H = [1, 0], so the residual is on weight alone. */
export function update(
  s: FilterState,
  raw: number,
  sigmaScale: number,
  o: FilterOptions,
): UpdateResult {
  const scale = sigmaScale > 0 ? sigmaScale : 1;
  const r0 = (o.weight_sigma_kg * scale) ** 2;
  const y = raw - s.weight;
  const gated = Math.abs(y) > o.gate_sigma * Math.sqrt(s.var_weight + r0);
  const r = gated ? r0 * o.gate_inflate : r0;
  const innovation = s.var_weight + r;
  const kw = s.var_weight / innovation;
  const ke = s.cov / innovation;
  return {
    gated,
    state: {
      weight: s.weight + kw * y,
      tdee: s.tdee + ke * y,
      var_weight: s.var_weight - kw * s.var_weight,
      cov: s.cov - kw * s.cov,
      var_tdee: s.var_tdee - (s.cov * s.cov) / innovation,
    },
  };
}

/**
 * Run the filter over `days` in order. `meanIntake` stands in for unlogged days; `priorTdee`
 * starts the TDEE estimate. Days before the first reading are skipped — there is nothing to
 * anchor weight to until the scale has spoken once.
 */
export function runFilter(
  days: readonly FilterDay[],
  meanIntake: number,
  priorTdee: number,
  o: FilterOptions = DEFAULT_FILTER,
): FilterRun | undefined {
  const firstWeighed = days.findIndex((d) => d.raw != null);
  if (firstWeighed < 0) return undefined;

  let s = initialState(days[firstWeighed]!.raw!, priorTdee, o);
  let observations = 1;
  let gated = 0;
  let steps = 0;

  for (let i = firstWeighed + 1; i < days.length; i++) {
    const d = days[i]!;
    const known = d.intake != null;
    s = predict(s, known ? d.intake! : meanIntake, known, o, d.intake_sigma);
    steps++;
    if (d.raw != null) {
      const u = update(s, d.raw, d.sigma_scale ?? 1, o);
      s = u.state;
      observations++;
      if (u.gated) gated++;
    }
  }
  return { state: s, observations, gated, steps };
}
