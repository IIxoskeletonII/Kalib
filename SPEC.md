# SPEC.md — Kalib

**Project:** Kalib — adaptive macro tracker
**Package / bundle id:** `com.eliya.kalib`
**Name chosen:** 19 Sep 2026, after App Store collision checks rejected *Tare*,
*Mizan* and *Tarra* (see §15). Domain and trademark not yet verified — see §13.7.
**Owner:** Eliya
**Written:** 19 Sep 2026
**Target v0 ship:** 28 Sep 2026
**Primary cut window:** 21 Sep – 23 Dec 2026
**Maintenance window:** 24 Dec 2026 – late Jan 2027 (travel)

> This document is the input to Claude Code plan mode. It states decisions already
> made, the reasoning behind them, and the questions still genuinely open. Do not
> re-litigate settled decisions without flagging the reason. Open questions are
> collected in §13.

---

## 1. Purpose

Kalib is a personal, self-hosted, effectively-free nutrition tracker that:

1. **Measures** the user's true maintenance calories from their own data rather than
   predicting them from a formula.
2. Makes logging fast enough that it survives three months of real life — including
   eating out, delivery, travel, and 8:30am lectures.
3. Tracks fiber and micronutrients as first-class citizens, not afterthoughts.
4. Generalises to any user from height, weight, age, sex and activity, so it can be
   shared later.

### Non-goals
Training logs (Hevy already covers this). Social features. App Store distribution in
v0–v3. Anything requiring a paid API.

---

## 2. Design principles

These are load-bearing. Every design decision should be traceable to one of them.

### 2.1 Consistency of method beats accuracy of method
The adaptive TDEE engine (§4) absorbs *systematic* error automatically. If the user
consistently under-counts restaurant meals by 20%, the engine measures a
correspondingly lower TDEE and issues a lower target — and the user still loses weight
at the requested rate. *Random* error is what breaks the system.

**Implication:** prefer an estimator that is biased but low-variance over one that is
unbiased but high-variance. Never silently change how a given food is estimated.

### 2.2 Friction is the binding constraint, not accuracy
The failure mode is not a mis-logged gyro. It is a user who stops logging. Every
feature is judged against a friction budget (§8). A feature that adds accuracy at the
cost of seconds is usually a net loss.

### 2.3 Local-first
IndexedDB is the source of truth for the client. Writes are instant and optimistic;
sync to the server happens in the background. The user must never wait on a network
round-trip to log food. This also delivers offline for free.

### 2.4 Never show a number more precise than the underlying data
If 60% of today's calories came from photo estimates, the day's vitamin D figure is
fiction. The UI must surface data provenance (§7.4), not hide it.

### 2.5 Show trends, not instants
Raw daily weight is noise (±1–2 kg from water, sodium, glycogen, gut contents). The
user sees the smoothed trend. Raw values are stored but displayed only on an explicit
"show raw" toggle.

---

## 3. User parameters and target derivation

All formulas are parameterised so the app calibrates to any user.

### 3.1 Inputs
`sex, age, height_cm, weight_kg, bodyfat_pct (optional), activity_level, goal_rate_kg_per_week`

### 3.1a Waist, and body fat without a scan (added 30 Sep 2026)

§14 records body fat as "30–40 % self-estimated — **low confidence**, verify by waist
measurement", and the project's third success criterion is judged on waist rather than scale
weight. That verification now exists. `core/body.ts` implements **Relative Fat Mass**
(Woolcott & Bergman, Nature Sci Rep 2018): `RFM = 64 − 20 × (height / waist) + 12 for women`,
validated against DXA at R² = 0.84 — better than BMI, comparable to a consumer impedance scale,
from a tape measure and no device-to-device bias.

- Stored as `weigh_ins.waist_cm`, entered in the weigh-in sheet behind a Weight/Waist segmented
  control, so the five-second weight path is untouched.
- The freshest evidence wins for §3.2: an entered body-fat reading, else RFM from the most recent
  waist, else the onboarding estimate. It therefore sharpens Katch-McArdle **and** the protein
  target, which is 2.0 g per kg of lean mass.
- Also shown: waist-to-height, where under 0.5 is the widely used low-risk screen.
- The trend screen carries waist as its own series (readings carried forward rather than
  smoothed — a weekly measurement has nothing to smooth), because it keeps moving when the scale
  stalls, which is the most common moment someone quits.

### 3.2 Baseline metabolic rate

```
if bodyfat_pct is known:
    LBM   = weight_kg * (1 - bodyfat_pct/100)
    BMR   = 370 + 21.6 * LBM                      # Katch-McArdle
else:
    BMR   = 10*weight_kg + 6.25*height_cm - 5*age + (5 if male else -161)   # Mifflin-St Jeor
```

When both are available and differ by >10%, store both and use the mean. Flag it in the
UI as "estimate uncertain — will be replaced after calibration."

### 3.3 Initial TDEE (placeholder only — superseded after §4 calibration)

```
TDEE_initial = BMR * activity_multiplier
  sedentary          1.20
  light (1-3 d/wk)   1.375
  moderate (3-5)     1.55
  heavy (6-7)        1.725
```

**This number is a scaffold with a scheduled demolition date.** It is used for the first
14 days only. The UI must label it as provisional.

### 3.4 Macro targets

```
deficit_pct     = clamp(goal_rate_kg_per_week * 7700 / (TDEE * 7), 0.10, 0.25)
kcal_target     = TDEE * (1 - deficit_pct)

# Safety floors — kcal_target may never fall below any of these
kcal_target    >= BMR * 1.10
kcal_target    >= 1500 (male) / 1200 (female)
kcal_target    >= protein_g*4 + fat_g*9 + 50

protein_g       = 2.0 * LBM_kg          if bodyfat known   (range 1.8-2.2, cap 2.5)
                = 1.8 * target_weight   otherwise
fat_g           = max(0.6 * weight_kg, 0.22 * kcal_target / 9)
carb_g          = (kcal_target - protein_g*4 - fat_g*9) / 4
fiber_g         = max(14 * kcal_target / 1000, 25)
water_ml        = 35 * weight_kg
```

Fiber is a **primary target displayed on the home screen alongside protein.** Rationale:
high-protein deficits displace fiber and cause GI problems that end diets. This is not
optional polish.

### 3.5 Modes
- `CUT` — deficit as above.
- `MAINTAIN` — deficit_pct = 0, protein held, targets otherwise relaxed.
- `RECOMP` — deficit_pct ≤ 0.10, protein at upper bound.
- `BULK` (added 22 Sep 2026) — a lean surplus: deficit_pct is negative, sized from the gain
  rate the same way and clamped to 5–15 % above TDEE. Protein and fat rules unchanged; the
  floors cannot bind. Coach and review read the trend direction from the mode.

Mode is switchable at any time and must be switchable **on a schedule** (the user needs
an automatic switch to MAINTAIN on 24 Dec 2026 and back to CUT on return).

---

### 3.5a Diet breaks (added 30 Sep 2026)

The MATADOR trial (Byrne et al., Int J Obesity 2018) ran two weeks of deficit against two weeks
at maintenance, repeatedly, against continuous restriction of the same total dose: the
intermittent group lost substantially more fat over the same time, with no extra fat-free mass
lost. A break needs no new concept here — it is two entries in the §3.5 mode schedule, so daily
targets, banking and the planner all follow it unchanged.

`core/dietBreak.ts` offers one after **eight weeks** of unbroken deficit, or after **four** when
the trend has produced less than a quarter of the expected loss. The offer appears on the weekly
review with its reasoning, can be declined for the week, and is never made while a maintenance
block is already within three weeks. A suggestion with its evidence, never an instruction.

---

## 4. The adaptive TDEE engine

This is the core of the product. Everything else is a data entry surface for it.

### 4.1 Trend weight
Exponentially weighted moving average over daily weigh-ins.

```
trend[0] = weight[0]
trend[n] = trend[n-1] + alpha * (weight[n] - trend[n-1])
alpha    = 0.15   (tune: lower = smoother, slower; 0.10-0.25 reasonable)
```

Gaps: carry the previous trend forward, but mark the day as un-weighed. Do not
interpolate fake weigh-ins into the estimator input.

### 4.2 TDEE estimation

```
window        = 21 days (min 14)
delta_trend   = trend[today] - trend[today - window]        # kg, negative when losing
mean_intake   = weighted_mean(logged_kcal over window)      # recency-weighted
TDEE_measured = mean_intake - (delta_trend * ENERGY_DENSITY / window_days)
```

`ENERGY_DENSITY = 7700 kcal/kg` for fat mass.

**Critical correction:** early weight change is dominated by water and glycogen
(~1000 kcal/kg), not fat. Applying 7700 to the first two weeks massively overestimates
TDEE. Therefore:

- Days 1–14 are a **calibration period**. No TDEE estimate is published.
- Days 1–10 are permanently excluded from the estimator window.
- First published estimate: day 15.

### 4.3 Guard rails
- Require ≥10 logged days and ≥10 weigh-ins in the window, else hold the previous estimate
  and show "not enough data."
- Cap target movement at ±150 kcal per weekly update. Prevents oscillation.
- Publish a confidence interval. Widen it as a function of logging gaps, weigh-in gaps,
  and the proportion of intake from low-confidence sources (§7.4).
- If measured TDEE differs from the formula estimate by >600 kcal, show an explanatory
  card rather than silently applying it — this is almost always an adherence signal, not
  a metabolic one.

### 4.4 Update cadence
Recompute daily; publish a revised `kcal_target` weekly (Sunday night). Daily target
churn is psychologically destabilising and statistically unjustified.

### 4.5 Implementation notes (added 20 Sep 2026)
- **First estimate is day 24, not day 15.** With days 1–10 excluded, a minimum 14-day
  window and ≥10 logged days / weigh-ins inside it, day 24 is the earliest every rule holds
  at once; "day 15" in §4.2 predates the guard rails. The UI counts calibration to day 24.
- Window `[start, today]` with `start = max(day 11, today − 27)` — **28 days, not 21**: on
  the synthetic benchmark a 21-day window's week-to-week noise (RMS ≈ 145 kcal) matched the
  ±150 publish cap, so targets would have bounced; 28 days halves the variance and TDEE
  drifts far too slowly (≈ 15 kcal per kg lost) for the extra week to matter. `delta_trend`
  is taken between the trend on `start` and on `today`, over `span = today − start` days.
- **Superseded 30 Sep 2026 — the estimator is now a Kalman filter** (`core/kalman.ts`). Two
  quantities are unknown and evolve together: true weight and TDEE. Energy balance links them
  (a day of eating I against a burn of E moves true weight by (I − E)/ρ) and the scale is a
  noisy look at weight alone. Written as a linear Gaussian system, a filter over **raw**
  weigh-ins uses every reading, needs no window, tolerates missing days, gates outliers, and
  returns a posterior variance rather than an error bar assembled by hand.
  Measured on the same ten synthetic people, filter against the old trend difference:

  | | trend difference | filter |
  |---|---|---|
  | bias, days ≤ 30 | +273 kcal | −81 kcal |
  | RMS error from day 45 | 108 kcal | **71 kcal** |
  | within ±150 on day 90 | 90 % | **100 %** |
  | interval coverage | 0.92 | **0.98** |
  | interval half-width, day 90 | ±248 | **±217** |

  The old note read: "the trend on day 11 still remembers days 1–10, so the first estimates run
  ≈ 200 kcal high… alternatives (regression on raw weigh-ins) remove the bias but are 2× noisier."
  The filter removes the bias *without* the noise, which is the whole reason for the change. It
  is deliberately **wider early** (±677 on day 24 against ±441) because fourteen days genuinely
  is that uncertain — and coverage rose, so the old interval was overconfident, not better.
- The filter reads the whole record after the excluded days, so **the interval keeps narrowing**
  instead of flooring near ±250. It passes ±200 at about eight weeks, which makes the §14
  criterion ("under ±200 by mid-October") reachable after all. The 28-day window survives only
  as the gate that decides whether there is enough data to speak at all.
- §7.4 confidence reaches the filter: a day's intake noise is its own 1σ (10 % of a weighed day,
  30 % of an estimated one), so a week of guesswork widens the interval rather than silently
  moving the estimate.
- The §4.2 trend difference remains as a fallback for a record with no raw readings (imported
  history), and `Estimate.method` says which produced a number.
- Realistic scale noise (σ ≈ 0.7 kg/day) bounds the 95 % interval near **±250 kcal** for a
  28-day window; the §14 "under ±200 by mid-October" criterion is not reachable by any
  estimator on 21–28 days of data and is read as "under ±300 with the truth inside".
- A day counts as **logged** when its intake is ≥ 60 % of that day's target (the §16 rule);
  half-logged days are gaps, not low-intake days. Gaps are neither interpolated nor counted;
  the mean is over logged days, recency-weighted with a half-life of one window.
- **Confidence interval** (95 %): intake noise (10 % of intake per high-confidence day,
  30 % per low-confidence day, √n), trend noise (raw weigh-in σ 0.7 kg through the EMA,
  inflated by gaps), and the energy density of the change (7,700 ± 1,000 kcal/kg — a cut
  with adequate protein and training is mostly fat). Coverage on the benchmark: 0.96.
  `data_quality` = logged share × weighed share × (1 − low-confidence share / 2).
- **Publishing**: the Monday view after each Sunday publishes the latest estimate, moved at
  most ±150 kcal from the previously published TDEE (the formula TDEE before the first
  publish). A measured value more than 600 kcal from the formula is not applied; the card
  explains why and offers to apply it deliberately.

---

### 4.1a Cycle-aware trend weight (added 30 Sep 2026)

Luteal-phase progesterone raises aldosterone and vasopressin, and the fluid it holds moves the
scale by roughly 0.5–2 kg, peaking around the first day of menses and resolving over the days
after. To an energy-balance engine that reads weight change as fat change that looks like a
stalled cut, and to the person reading the chart it looks like failure. The research sweep found
**no published algorithm** for correcting it and **no competitor that does it**.

`core/cycle.ts` takes the honest route rather than inventing one. It never alters a reading and
never subtracts a fabricated offset. It says how far into the retention window a day sits, and
the filter widens that reading's measurement variance accordingly — a Kalman gain that drops in
the window and recovers after it. Cycle length is the median of the person's own logged starts
(clamped to 21–35 days, outliers from a forgotten log discarded), predictions stop after two
cycles rather than guessing further, and the trend chart shades the affected days with a line
saying why.

Off by default and never inferred. Settings → Cycle turns it on; a "Period started today" row
then appears in the weigh-in sheet, where the daily ritual already is.

---

## 5. Weekly calorie banking

The user explicitly wants a weekly budget, not a rigid daily one.

```
weekly_budget   = kcal_target * 7
balance         = (kcal_target * days_elapsed) - kcal_consumed_to_date
```

### 5.1 Redistribution rules

| Situation | Behaviour |
|---|---|
| Overshoot ≤ 300 kcal | Absorb silently into tomorrow |
| Overshoot 301–1000 | Prompt: "spread across the week, or take it tomorrow?" |
| Overshoot > 1000 | Spread across remaining days automatically; explain, don't ask |
| Any redistribution | Per-day reduction capped at 300 kcal |
| Residual after cap | Roll into next week; **maximum one rollover**, then forgive |
| Undershoot | Rolls forward in full, but no single day may exceed `kcal_target + 700` |

No day's target may fall below the §3.4 safety floors, regardless of banking state.

### 5.2 Tone
Never punitive. The copy for an overshoot day is a redistribution, not a verdict. A
forgiven residual is stated plainly ("that one's written off, start fresh") — the whole
point of the cap is that the system cannot compound a bad day into an unsustainable week.

---

## 6. Data model

```
users(id, email, created_at)

profiles(user_id, sex, birth_date, height_cm, activity_level, mode,
         goal_rate_kg_per_week, created_at)              -- snapshotted, append-only

weigh_ins(id, user_id, date, weight_kg, bodyfat_pct?, source, created_at)
          -- UNIQUE(user_id, date)

foods(id, source, external_id, name, brand, barcode,
      per_100g JSONB,            -- {kcal, protein, carb, fat, fiber, sugar, sodium, ...}
      micros JSONB,              -- {vit_a, vit_c, vit_d, b12, folate, iron, calcium, ...}
      micro_coverage NUMERIC,    -- 0-1, fraction of tracked micros present
      density_g_per_ml?, verified BOOLEAN)
      -- source ENUM: usda_foundation | usda_sr | off | custom | photo

recipes(id, user_id, name, total_yield_g, default_portions, instructions TEXT)
recipe_items(recipe_id, food_id, grams)

batches(id, user_id, recipe_id, cooked_at, total_cooked_g, portions_total,
        portions_remaining)
        -- a batch is a cooked instance of a recipe; portions log in one tap

log_entries(id, user_id, logged_at, meal_slot, food_id?, batch_id?, recipe_id?,
            grams, servings,
            kcal, protein_g, carb_g, fat_g, fiber_g, micros JSONB,
            entry_method,      -- favourite|search|barcode|batch|photo|manual
            confidence,        -- high|medium|low
            photo_url?, photo_assumptions JSONB?,
            corrected_from_id?)

daily_targets(user_id, date, kcal, protein_g, carb_g, fat_g, fiber_g,
              banking_adjustment, source)   -- source: formula|measured

tdee_estimates(user_id, computed_on, tdee_kcal, ci_low, ci_high,
               window_days, logged_days, weighed_days, data_quality)

settings(user_id, key, value)
```

---

## 7. Food data sources

### 7.1 USDA FoodData Central — the micronutrient backbone
Free API key. Use the **Foundation Foods** dataset: a few hundred lab-analysed whole
foods with 13 vitamins and 11 minerals. This is the highest-quality free nutrient data
available and is what makes vitamin tracking meaningful.

**Seed it once via bulk download into Postgres, don't call the API live.** It's small,
static, and local lookup is instant — which matters for the friction budget.

Fall back to SR Legacy for foods absent from Foundation.

*Added 21 Sep 2026:* the offline set also carries **FNDDS** (USDA survey foods, ~5,300 items
"as eaten" — mixed dishes, takeaway, cooked variants, coffees) and SR Legacy's fast-food and
restaurant categories. FNDDS is what answers "latte", "lasagne" and "Big Mac", and what
describe-to-log (§9.4) grounds against. Ranking prefers the head noun of a name, treats
singular/plural as the same word, and demotes dried/powdered/baby forms; sources break ties
(own foods, Foundation, packaged, FNDDS, SR). 12.9 k foods index in ~300 ms on a phone.

### 7.1a European foods, and the vocabulary problem (added 1 Oct 2026)

USDA answers plain English well and European food badly. Measured with the real §8 search over
the real seed, on 88 terms of the vocabulary two people actually type:

| | USDA alone | after this change |
|---|---|---|
| Plain English staples | 95% | **100%** |
| Supermarket shorthand | 72% | **89%** |
| Italian everyday | 32% | **76%** |
| Gulf and Levantine | 24% | 24% |
| **Overall** | **52%** | **69%** |

Two changes produced that, in order of cost.

**The alternative names USDA already publishes.** FNDDS records carry an "Additional Description"
attribute nested in `foodAttributes` — a chickpea is also `garbanzos` and `ceci`. The seed script
read `description` and dropped the rest, so 8,068 alias strings across 3,536 foods were being
discarded from a file already downloaded. They are indexed now (searched, never displayed) at a
cost of 48 KB. On their own they took Italian from 32% to 52%.

**Ciqual 2025 (Anses).** The French national table: 3,484 foods against 74 constituents, lab
analysed, covering every micronutrient §7 tracks plus iodine, with English *and* French names for
every food. Published under the Licence Ouverte / Etalab 2.0, which permits redistribution with
attribution. 3,323 foods survive the macro filter, at 291 KB compressed. It carries pancetta,
bresaola, grana padano, pecorino, gorgonzola, mascarpone, mozzarella, polenta, pesto, burrata,
provolone, speck and passata — all of which USDA lacks entirely.

The English name is displayed and the French name is a search alias, so either finds the food.
Ciqual publishes no household portions, so those foods rely on grams and the §8.1 borrowing path.

**Values that are not numbers.** Ciqual writes `-` for not measured, `traces`, and `< 0,5` for
below the limit of quantification. For a macro, a trace is zero. For a micronutrient it is left
*absent* rather than recorded as zero, because §7.4 counts coverage and §16.1 refuses to diagnose
a gap from weak data; recording a fabricated zero would corrupt both.

**Why not an Italian table.** The authoritative ones are closed. IEO's BDA states data "can be
employed for commercial use only upon written authorization", under the Italian database right
(D.Lgs. 169/1999); CREA's tables state they "non possono essere copiati o in altro modo
riprodotti". A public repo under a permissive licence is inherently open to commercial use, so
neither can ship here. Asking IEO for a CC-BY subset is the only route to Italian-authoritative
data and has not been attempted.

**Why not Open Food Facts in the seed.** ODbL share-alike would put any bundled derivative under
ODbL, and the full export is gigabytes. OFF stays what it is: a live barcode and packaged-food
lookup whose results are cached per user (§7.2).

**The open gap: Gulf and Levantine food, still 24%.** No openly licensed source covers it. The
database holds zero entries for shawarma, kebab or doner. The Saudi SFDA tables (130 dishes) and
the Bahrain tables (82) are government PDFs with no stated licence; FAO's Near East table is from
1982 and non-commercial. The one clearly reusable source found is the Omani Foods 2024 paper
(CC BY, 221 packaged products, no dishes). The route for §14's Oman travel window is therefore a
small curated table whose dish values are derived from standard recipes over USDA (CC0)
ingredients — which is what §8.2 recipes already compute — with published values cited per row
where they exist.

### 7.1b Middle Eastern dishes (added 1 Oct 2026)

§7.1a left Gulf and Levantine food at 24%, with **zero** entries for shawarma, kebab or doner
under any name. §14 puts the owner in Oman from late December, so this was the gap that mattered
next. It is now **64%**, and the whole database answers 81% of the probe against 52% a day
earlier.

**There is no openly licensed Arabic food composition database.** Checked directly:

| Source | Content | Status |
|---|---|---|
| myfood24 Arabic FCDB | 2,016 items, 120 nutrients | Paper is CC BY; the **data is not published** — its supplementary holds a nutrient list and item counts |
| Omani Foods 2024 (PMC10930989) | 221 Omani packaged products | **CC BY**, redistributable, no dishes |
| SFDA Saudi Food Composition Tables (2026) | 130 dishes, 49 nutrients, ISO/IEC 17025 labs | Free access per FAO's catalogue; no licence stated |
| Lebanon FCT (2021) | 30 dishes, 37 sweets, 46 market foods | Lab-analysed; no licence stated |

FAO's *statistical* datasets are CC BY 4.0, not non-commercial as is often assumed; its INFOODS
tables are publications and carry no such grant.

**What ships, and on what basis.** 147 dishes transcribed into `data/mena-sources.json` — 30
from the Lebanon report, 117 from the Saudi tables — each row carrying a `source_ref` naming
the publisher, title, year and table it came from. Nutrient values are facts and facts are not
copyrightable; what a database right protects is the selection and arrangement of a whole table,
which is why this is a transcription of named rows rather than an import of either publication.

**The transcription is gated, because the Saudi PDF lies.** Its plain text layer sits one row out
of step with its visual table: parsed naively, Lamb Kabsa's ash becomes its fibre.
`pdftotext -table` reads it correctly, and three independent checks decide whether a dish is kept
at all:

- the energy identity, protein×4 + available carbohydrate×4 + fat×9 near the stated kcal;
- the table's own nitrogen figure, protein ≈ N × 6.25;
- the table's own kJ figure, kJ ≈ kcal × 4.184.

Six of 130 Saudi dishes failed and were dropped rather than guessed at (one claimed a nitrogen
figure implying 136 g of protein against 6 g stated). Seven more were dropped because the
extraction mangled their names, and a name that reads as nonsense is worse than a missing row.
The Lebanese rows were reconciled against that report's own independent per-serving table:
Shawarma lahma reads 179 kcal/100 g one way and 89.5 kcal per 50 g serving the other. All 147
rows satisfy the energy identity, and `seed-mena.ts` re-checks it at build time so a hand edit to
the committed source cannot quietly ship a wrong row.

**Micronutrients.** The Saudi tables carry nearly the whole §7 panel and 117 dishes ship with it,
each value dropped if it falls outside a plausible range. The Lebanese report reports vitamins
and minerals as traces throughout, so those 30 rows carry none and report coverage 0 — §16.1
then declines to diagnose a gap from them, which is the honest outcome.

**Aliases carry as much weight as the values.** Transliteration is not standardised, so kabsa
also answers to machboos, majboos and makbous; kibbeh to kebba and kubba; kunafa to knafeh and
kanafeh; and khubz, which simply means bread, surfaces every bread in the table for the person to
choose from.

**Still missing:** labneh, halloumi, shuwa, harees, luqaimat, mandi, camel milk, zaatar and
sumac. The Omani Foods 2024 set (CC BY) would add labneh and other Gulf dairy; the rest have no
source found yet.

### 7.2 Open Food Facts — barcodes
Free, ODbL-licensed, strong Italian and EU packaged-goods coverage. Two hard limits to
design around:

- **Packaged food only.** No produce. Open Food Facts itself directs you to national
  databases for unpackaged items.
- **Label-level nutrients only** — energy, fat, saturates, carbs, sugars, fiber,
  protein, salt. Vitamins are almost always absent.

Attribution required per ODbL. Cache every scanned product locally.

### 7.3 Italian produce — optional, v2+
CREA's BDA (Banca Dati di Composizione degli Alimenti) covers Italian foods properly.
No clean API; scrape once into a local table if USDA Foundation proves insufficient for
Italian ingredients.

### 7.4 Provenance and the coverage indicator

Every `log_entry` carries a `confidence` value. The daily view must show:

- **Calorie confidence:** % of today's kcal from high-confidence sources (weighed +
  database, barcode, batch portion).
- **Micronutrient coverage:** % of today's kcal that had *any* micronutrient data.

Without this, the vitamin panel is actively misleading — a gyro contributes 800 kcal and
zero vitamin data, and a naive UI would render the day as "deficient in everything."

*Implementation note (20 Sep 2026):* coverage is judged **per nutrient**, not per entry. A
Foundation food that carries 8 of the 22 tracked nutrients must not read as zero on the other
14; each nutrient's weekly average, and each coach gap, is computed only over full days whose
food carried that nutrient for ≥ 70 % of the day's calories. Nutrients with no such day are
shown as "no data yet", never as 0 %.

---

## 8. Logging paths and friction budgets

Six paths. Each has a hard latency target from app-open to logged.

| Path | Target | Notes |
|---|---|---|
| Favourite / recent | ≤ 3s, 2 taps | Home screen surfaces top 8 by frequency × recency |
| Batch portion | ≤ 3s | "Log 1 portion of Sunday's chicken & rice" |
| Barcode | ≤ 8s | Still capture → client-side decode → OFF lookup → grams |
| Weighed ingredient | ≤ 10s | Search → number pad (grams) → done |
| Photo estimate | ≤ 15s | Includes the mandatory description prompt (§9) |
| Weigh-in | ≤ 5s | Number pad on home screen, no navigation |

Amounts are entered in **g, ml, oz or fl oz**; everything is stored in grams (§6). Liquids
open in ml; ml converts through a density taken from the food's own fluid portion when the data
has one, a category heuristic otherwise, and 1 g/ml with the assumption shown as a last resort.

List rows **swipe**: left reveals Delete (a full swipe commits, with a five-second Undo), right
reveals one contextual action (on a logged entry: *Again* — the same thing, now). Back on every
sub-screen pops real history; tab switches never stack.

**The number pad must be custom**, not the iOS keyboard. Keyboard summon/dismiss alone
costs 1–2 seconds and is the single biggest avoidable latency in the whole app.

### 8.1 The repeat-meal mechanism (most important feature in the product)
Any log entry can be saved as a named custom food with one tap. Any photo estimate can be
corrected once and promoted to a custom food. Over ~3 weeks, the user's real rotation —
their gyro, their Deliveroo order, their batch lunches — becomes a set of one-tap,
high-confidence entries. **This, not the photo AI, is the actual solution to eating out.**

### 8.2 Recipes and batches (added 20 Sep 2026)
The meal-prep path from §8 ("log 1 portion of Sunday's chicken & rice", ≤ 3 s).

- A **recipe** is a named list of weighed ingredients (database foods, own foods or packaged
  products, in grams), a cooked weight (**yield**) and a portion count. Ingredients are stored
  on the recipe row (`items` JSON) rather than in a `recipe_items` table: they change together
  and sync together, like `portions` on a food. Deviation from §6, flagged.
- Every recipe is **materialised as a custom food** (`foods.recipe_id`) whose per-100 g values
  are the ingredient totals divided by the yield, with "1 portion = yield ÷ portions" as its
  first portion. Nothing else in the app knows about recipes: search, favourites, the coach
  and the amount sheet see a food. Editing the recipe rewrites the food; deleting soft-deletes both.
- Until a yield is entered, the raw ingredient weight stands in for it. Cooking changes weight
  (water lost or absorbed) but not nutrients, so weighing the finished pot is what makes the
  per-100 g figure honest; the editor asks for it and the last batch's weight becomes the default.
- A **batch** is one cooked instance: cooked weight, portions, portions remaining. Logging a
  portion is one tap from Today's "Log again" rail (batches with portions left come first),
  through the normal amount sheet prefilled with one portion; ½ and 2 portion chips are offered.
  `portions_remaining` falls by `grams ÷ portion grams` and is restored if the entry is deleted.
  Entries carry `batch_id`, `recipe_id`, `entry_method = batch`, confidence high.
- Ingredients are added through the ordinary search screen (so scan and packaged search work),
  which in recipe mode adds to the recipe instead of the log.

---

## 9. Photo estimation (v3)

### 9.1 Honest performance expectations
Published research on LLM-based nutritional estimation from food images finds roughly
40% mean error on weight and energy for frontier models, and macronutrient errors
spanning 42–110% — with every tested model exceeding 60% error on protein specifically.
Portion estimation, not food identification, is the bottleneck, and has been since 2015.

**Therefore: the photo path is a compliance tool, not an accuracy tool.** Its job is to
prevent a skipped log. A 30%-wrong entry beats no entry. It must never be presented as
precise, and it must never be the primary source of protein data.

### 9.2 The description prompt is mandatory, not optional
Adding a short user description of the ingredients has been measured to cut image-only
error from roughly 30% to roughly 14%. One text field, pre-focused, skippable but
prompted every time: *"Anything I can't see? Oil, butter, sauce, sugar?"*

This single field is worth more than any model upgrade.

### 9.3 Implementation
- Capture via `<input type="file" accept="image/*" capture="environment">`. **Do not use
  a live `getUserMedia` stream** — see §10.2.
- Client-side downscale to ~1024px longest edge before upload. Cuts tokens and latency.
- Vision model behind a provider-agnostic adapter (`VisionProvider` interface). Default
  to a cheap Qwen vision-flash tier (~$0.03/M in, ~$0.13/M out via OpenRouter; roughly
  1k tokens/image, so <$0.05/month at 3 photos/day). Must be swappable in one file.
- Structured JSON output, schema-validated:

```json
{
  "items": [
    {"name": "...", "grams_estimate": 0, "grams_range": [0,0],
     "kcal": 0, "protein_g": 0, "carb_g": 0, "fat_g": 0, "fiber_g": 0,
     "confidence": "low|medium|high"}
  ],
  "hidden_ingredients_assumed": ["~15ml olive oil", "..."],
  "total_kcal_range": [0, 0],
  "notes": "..."
}
```

- **Apply a deliberate +10% calorie bias to photo entries** (configurable). Justified by
  §2.1: a consistent upward bias is absorbed by the TDEE engine, whereas under-counting
  compounds into stalled progress the user can't diagnose.
- Display the range. Log the midpoint. Flag `confidence: low`.
- Every photo entry is editable and promotable to a custom food (§8.1).

### 9.4 Describe-to-log and grounding (added 21 Sep 2026)
§9.2's finding — one sentence of description is worth more than any model upgrade — makes
the description the primary input, not an add-on to the photo:

- **One screen, two inputs.** A text field, pre-focused, is always there; the photo is
  optional evidence attached to it. "2 eggs, toast with butter, a latte" with no photo is a
  valid estimate. With a photo the field is prompted as in §9.2 and may be left empty.
- **Grounding.** Each item the model names is searched in the offline database (the user's
  own foods and recipes first, then USDA). A confident match takes the database's per-100 g
  values at the model's gram estimate: the food is known, only the portion is estimated, so
  the entry is `confidence: medium` and carries micronutrients. Only unmatched items keep the
  model's macros, `confidence: low`, no micronutrients, and the +10 % bias.
- **The user sees both.** Matched items are labelled with their source; unmatched ones show
  a range. Every item's grams can be changed before logging; items can be removed.
- **Logging.** One tap logs all items into the chosen meal, `entry_method = photo` for both
  kinds so the provenance line (§7.4) and the engine's low-confidence share stay honest;
  `photo_assumptions` keeps the model's item, the description and the hidden ingredients
  it assumed. The image is discarded after estimation (§13.3 default).
- **Cost and keys.** `/api/estimate` on the Worker; the OpenRouter key is a Worker secret,
  the model id a Worker variable (default `google/gemini-3.1-flash-lite`, ≈ $0.001 per
  estimate). Requests must come from the app's own origin; images are capped at 1024 px.
- Classified as **differentiator #4** (§15); the grounding step is what no competitor does.

### 9.5 Retention pieces (added 21 Sep 2026)
Three small features whose only purpose is success criterion #1 (§14: still logging on
23 December):
- **Reminders.** Web Push from the Worker (RFC 8291/8292 in WebCrypto, subscriptions in KV, a
  10-minute cron). Two nudges, each at a time of the user's choosing and *only when the thing
  is still undone*: a weigh-in nudge and an evening "nothing logged" check. The app tells the
  Worker what has been done today; the Worker never sees the log itself.
- **Week in review** as a page and as shareable plain text (§2.5: trends, not instants).
- **Household recipe sharing.** A recipe travels as a self-contained code (seed foods by their
  deterministic id, own foods embedded) in a link or pasted; no server involvement.

---

## 10. Platform and stack

### 10.1 Decision: Progressive Web App
There is no legal route to a native iOS app without macOS in the loop. Xcode is
macOS-only; free-Apple-ID sideloading still requires a Mac to produce the signed IPA and
re-signs every 7 days; the paid route is $99/year plus a cloud Mac. All fail the cost and
simplicity requirements.

PWAs are confirmed viable in the EU: Apple announced removal of Home Screen web apps in
the EU under the DMA, then reversed before iOS 17.4 shipped. As of iOS 26, sites added
to the Home Screen default to opening as web apps. Push notifications have worked since
iOS 16.4 for installed PWAs. Service workers provide offline caching.

If the app proves itself, the same codebase wraps with Capacitor for the App Store later.

### 10.2 iOS PWA camera constraint — design around it
WebKit has long-standing bugs with camera access in standalone PWA mode, and camera
permission **is not persisted for PWAs**, so live-stream approaches produce repeated
permission prompts. This would destroy the friction budget.

**Mandate:** all camera use goes through the native file/camera picker; never a live video
scanner. Barcode scanning takes a still image and decodes it client-side (ZXing-js or
equivalent). Slightly less slick; dramatically more reliable. Note also that Safari does not
support the `BarcodeDetector` API — a JS decoder is required regardless.

**Two pickers, not one (amended 13 Oct 2026).** `capture="environment"` was originally applied
to every picker. It is the right default for a barcode, which has to be in front of the lens,
but on everything else it is a bug: iOS reads that attribute as *camera only* and never offers
the photo library, so a meal eaten an hour ago could not be logged from the photo already taken
of it. `src/platform/camera.ts` therefore exposes two:

| | `capture` | Used by |
|---|---|---|
| `captureImage()` | `environment` | barcode scanning (§10.2) |
| `pickImage()` | none | meal photo (§9.4), menu photo (§9.5), nutrition label (§9.6) |

Dropping the attribute is all that is needed: the OS then shows its own sheet offering the
library *and* the camera, which is fewer taps than a chooser of our own and the one iOS users
already know. The mandate above is unaffected — both are still the native picker, and neither
opens a stream.

**Consequence: images we cannot decode.** The library holds whatever the phone has put in it,
where the camera only ever handed us a JPEG. An iPhone photo is HEIC, and while Safari converts
it on the way out of the picker, other engines do not. `downscale()` therefore catches the
decode failure and reports which type failed and what to do about it, rather than surfacing the
browser's own "The source image could not be decoded", which names no cause and offers no way
out.

### 10.3 Stack

| Layer | Choice |
|---|---|
| Framework | React + Vite + TypeScript |
| PWA | `vite-plugin-pwa` (Workbox) |
| Local store | IndexedDB via Dexie — source of truth on client |
| State | TanStack Query over Dexie, background sync to server |
| Styling | Tailwind |
| Backend | Supabase (Postgres, auth, storage) — free tier |
| Hosting | Cloudflare Pages or Vercel Hobby — free tier |
| Vision | OpenRouter → Qwen vision-flash, behind an adapter |
| Charts | Recharts or uPlot |

**Cost ceiling: €1/month.** Any design that breaches it is wrong. If a decision forces
a paid tier, stop and flag it.

---

## 11. Phasing

The user asked where to draw the v1 line and didn't pick. **Decision made here, overrule
if you disagree.** The phasing is motivated, not arbitrary: the adaptive engine
*cannot function* before 14 days of data exist, so shipping it first is pointless, and
the photo path is the lowest-accuracy feature so it should not be in the version that
establishes the user's logging habit.

### v0 — ship by 28 Sep (one week)
Weigh-in + trend chart. Manual/search logging against the seeded USDA table. Formula-based
targets. Daily view with kcal/P/C/F/fiber. Favourites. Nothing else.

### v1 — weeks 2–3
Barcode scanning (OFF). Custom foods. Recipes + batches. Weekly banking logic.

### v2 — weeks 4–5 (data now exists)
Adaptive TDEE engine goes live. Micronutrient panel + coverage indicator. Weekly review
screen.

### v3 — November
Photo estimation. Promote-to-custom-food flow.

### v4 — post-travel, Feb 2027
Meal planner: swipe-to-select weekly meals, macro-scaled portions, consolidated shopping
list grouped by aisle, step-by-step recipe instructions.

### Explicitly out of scope, all versions
- **Grocery chain integration.** No Italian chain (Esselunga, Conad, Coop, Carrefour
  Italia, Lidl) publishes a product or price API. Scraping is fragile, gets IP-blocked,
  breaches terms of service, and would damage the project's value as a portfolio piece.
  The v4 planner delivers ~90% of the intended value without it; per-ingredient prices
  entered once by the user give a weekly budget estimate accurate to roughly ±15%.
- **Deliveroo integration.** No public API.
- **Training logs.** Hevy already works.

---

## 12. Non-functional requirements

- **Offline:** all logging works offline. Only barcode lookup (uncached) and photo
  estimation require network. Queue and replay on reconnect.
- **A push Topic must be valid base64url** (found 28 Sep 2026): Apple answers an invalid one
  with 400 BadWebPushTopic and never delivers. The tag "weigh" is five characters, a length no
  base64 string can have, so the morning nudge failed every day while "log" (three) and "test"
  (four) arrived. Topics are encoded now, and the failure is recorded on the subscription.
- **Reminders are about the day's checklist** (added 23 Sep 2026): the phone reports what the
  day still needs — weigh-in, food, supplements, water — and the evening nudge names what is
  left ("Nothing logged, 2 supplements and 1.4 L of water") instead of only asking whether
  anything was logged at all. The time zone travels with the phone, the next due time and the
  last send are visible in Settings, and a failed send is written to the record so a silent
  failure has somewhere to be seen.
- **Updates must never strand an install** (added 22 Sep 2026): a build's files are hashed and
  immutable, so a request for one a later deploy removed answers **404**, never the SPA
  fallback's `index.html` — a browser handed HTML where it expects JavaScript fails forever and
  no reload fixes it. The client treats that failure as a stale build: it clears its caches,
  unregisters the service worker and reloads once (IndexedDB untouched). Seed files carry the
  seed version in their URL so a bump is a new cache address.
- **Cold start:** interactive in <1.5s on a mid-range phone over 4G. *Measured 21 Sep 2026
  (Lighthouse 12, production build, returning visit): 0.84 s interactive under a regular-4G
  throttle (70 ms RTT, 10 Mbps, 2× CPU slowdown); 2.6 s under Lighthouse's "slow 4G" preset.
  The first-run food seed (~1.4 MB compressed, 16 k rows) waits for an idle moment and writes
  in 150-row chunks so it never blocks the first screen.*
- **Privacy:** this is health data. Single-user for now. **Before any multi-user
  release, GDPR Article 9 (special category data) obligations apply** — explicit consent,
  lawful basis, retention policy, export and erasure. Treat opening this up as a gated
  decision, not a feature flag. *Erasure exists since 21 Sep 2026 (Settings → Sign out →
  Delete my account; `0005_erasure.sql`). The server-side trust model — what is public, what
  needs a session, daily spending caps — is in `SECURITY.md`.*
- **Data export:** CSV export of all log entries and weigh-ins from v0. Non-negotiable —
  the user must never be locked into their own app.
- **Testing:** unit tests on every formula in §3, §4 and §5. These are the product. Seed
  a synthetic 90-day dataset with known ground-truth TDEE and assert the engine recovers
  it within the stated confidence interval.
- **A walkthrough after every change** (added 15 Oct 2026): `npm run check` — prettier,
  eslint, the unit tests, typecheck and build, then Playwright. The last of those includes
  `e2e/sweep.spec.ts`, which opens every screen the app declares and presses every control
  that is safe to press, checking what a person notices before they notice a feature: that
  the screen renders, that it starts at its top (§19.6), that nothing throws, that there is a
  way out, that nothing is wider than the phone, and that every control has a name. Its list
  of screens is derived from `App.tsx`, so a route added without being swept fails the suite;
  a screen may be excluded only with a written reason. This exists because §19.6 shipped
  wrong behind green unit tests, and the one-off harness that would have caught it lived in
  `.cache/` where nothing ever ran it again.

---

## 13. Open questions for plan mode

1. **Supabase vs Cloudflare D1 + Workers.** Supabase gives auth and storage free but
   pauses after a week of inactivity (irrelevant for daily use). D1 has no pause but you
   build auth yourself. Which fits better given the local-first architecture?
2. **Auth at all in v0?** Single user, single device. Is a magic-link login worth the
   week-one complexity, or does v0 ship with no auth and a device-scoped key?
3. **Photo storage and retention.** Keep images for correction/audit, or discard after
   estimation? Storage is free at this scale but retention creates a privacy surface.
4. **USDA seed scope.** Foundation Foods only (~few hundred items, highest quality) or
   Foundation + a filtered slice of SR Legacy? Trade-off is coverage vs search noise.
5. **Trend smoothing parameter.** EMA with α=0.15 is proposed. Is a Kalman filter or
   weighted linear regression worth the complexity for better responsiveness after a
   genuine step change (e.g. returning from travel)?
6. **Bootstrap data.** The user will log in Cronometer from 21 Sep. Can 14 days of daily
   totals + weights be imported to skip the app's own calibration period? Worth building
   a one-off importer?
7. **Name clearance.** `Kalib` has no exact App Store or Play Store collision, but the
   phonetic neighbourhood is busy (Kalibra, Kalibra Diet, Kaliber Fit, Kaliko). Domain
   availability and EUIPO/USPTO clearance are **unverified**. Nothing public ships until
   they are. Internal package id and repo name are safe to use immediately.

---

## 14. Eliya's starting parameters

| Parameter | Value |
|---|---|
| Age | 23 |
| Height | 186 cm |
| Weight | ~110 kg (start date 21 Sep 2026) |
| Body fat | 30–40% self-estimated — **low confidence**, verify by waist measurement |
| Training | Resistance training ≥3×/week from 21 Sep |
| Activity | Sedentary-to-light outside the gym |
| Goal | Visual/body-composition, not scale-number. Lift progression as secondary metric |
| Constraint | Meal prep required; 7:50am departure 2 days/week — batch cooking, not morning cooking |
| Known issue | Constipation at high protein intake → fiber and water are primary targets |
| Travel | Oman, 24 Dec 2026 – late Jan 2027 → auto-switch to MAINTAIN |

### Provisional targets (superseded on day 15)

| | Target |
|---|---|
| Estimated TDEE | 2,700 kcal |
| Calories | 2,150 kcal |
| Protein | 160 g |
| Fat | 75 g |
| Carbs | 190 g |
| Fiber | 35 g |
| Water | 3.8 L |
| Weekly budget | 15,050 kcal |

**Success criteria for the project, in priority order:**
1. The user is still logging on 23 December.
2. Measured TDEE is established with a confidence interval under ±200 kcal by mid-October.
3. Fat lost, lean mass retained — judged by trend weight plus waist measurement plus
   lift progression, not scale weight alone.

---

---

## 15. Competitive positioning — read this before building anything

A direct competitor exists and was found after §1–§14 were written. **Tare – Nutrition
Tracker** (App Store id6762007357) already ships most of the core of this spec:

- USDA + Open Food Facts as combined data sources (§7.1, §7.2)
- 25 vitamins and minerals tracked automatically (§7)
- Custom foods, recipes with cooked-weight adjustment, one-tap meal templates (§6, §8.1)
- Local-only storage, no account, iCloud sync (§2.3)
- **Adaptive TDEE learned from weight trends** (§4)
- Weekly check-ins where the user accepts or rejects a target adjustment (§4.4)
- Supplement tracking, fasting schedules, Apple Watch activity bonus
- One-time purchase, no subscription

**Consequence: adaptive TDEE is table stakes, not a differentiator.** Do not position
Kalib as "a tracker that learns your metabolism." Building §3, §4, §6 and §7 is still
necessary — they are the foundation — but they are not the pitch.

### Where Kalib is actually differentiated, in priority order

1. **Weekly calorie banking with bounded redistribution (§5).** No competitor found
   implements deliberate banking with capped per-day reductions, a single-rollover limit,
   and explicit forgiveness. This is the feature most tied to the user's actual failure
   mode.
2. **Scheduled mode switching (§3.5).** Automatic CUT → MAINTAIN → CUT around a known
   travel window. Trackers assume a continuous goal; real life does not.
3. **Data provenance and coverage indicators (§7.4).** Competitors display a vitamin
   panel without telling you what fraction of the day it was computed from. That panel
   is misleading by construction and nobody surfaces it.
4. **Photo estimation with a mandatory description prompt (§9.2).** Competitors treat
   the photo as the whole input. The measured error reduction from one short text field
   is the single largest accuracy lever in that path, and it is under-used.
5. **The v4 meal planner (§11).** Swipe-selection, macro-scaled portions, aisle-grouped
   shopping list. Nothing in the surveyed set does this well.
6. **Platform and ownership.** Web-based, cross-platform, zero running cost, fully
   exportable data, and modifiable by its owner. The competitor is iOS-only and closed.

### Instruction to plan mode
For every feature in v0–v3, classify it as *table stakes* or *differentiator* before
scheduling it. Table stakes get the minimum correct implementation. Differentiators get
the design attention. Do not spend week three polishing a micronutrient panel that three
shipped apps already do better.

---

## 16. Coach — gap-aware recommendations (added 19 Sep 2026)

Requested by the owner after v0: once a few days of logging exist, the app must see where
the diet is falling short and keep nudging — with concrete foods, not generic advice — until
every target is met. Classified as a **differentiator** (§15): competitors show a deficit
number; nobody names the three foods that would fix it.

### 16.1 Detection
- Window: trailing 7 days; only **complete** days count (logged kcal ≥ 60% of target).
  Needs ≥ 4 complete days before anything is shown.
- A **gap** exists when the 7-day average of a nutrient is below 85% of its target:
  protein, fiber (primary), then micronutrients against DRI. Micronutrient gaps are only
  judged on days whose micronutrient coverage (§7.4) is ≥ 70% — never diagnose from missing data.
- Gaps are ranked by shortfall ratio; the largest one leads. Calories over target is a
  separate banking concern (§5), not a coach message.

### 16.2 Recommendation
- Candidate foods are ranked by **nutrient density for the gap** (grams or %DRI per 100 kcal),
  filtered to plausible foods (20–600 kcal / 100 g, a meaningful amount per 100 g), with a
  boost for foods the user already logs (§8.1 — familiarity wins) and for Foundation data.
- Each suggestion states the effect of one realistic portion: *"Lentils, cooked — 100 g adds
  8 g fiber for 116 kcal."* Tapping logs it through the normal amount sheet.
- Three suggestions per gap, never more than one gap at a time on Today.

### 16.3 Nudging
- Recomputed daily; the message stays until the 7-day average reaches target, then a single
  "fiber is on target this week" confirmation, then silence.
- Tone follows §5.2: a direction, not a verdict.
- v2 weekly review shows all gaps and trends; Today shows only the leading one.

## 17. Water and supplements (added 20 Sep 2026)

Requested by the owner after the sync release. Water is already a primary target (§3.4, §14)
but was display-only; supplements were untracked. Both are **table stakes** (§15) — every
competitor has a water tap and a pill checklist — so the treatment is: minimal, one tap,
no screen of its own on the daily path. The one differentiating piece is §17.3: doses are
personalised from the profile and shown with their basis, and supplement micronutrients
count toward the coach's gap detection (§16).

### 17.1 Water
- Target: `daily_targets.water_ml` (35 ml/kg). Displayed as litres to one decimal (§2.4).
- Logging: one tap on `+` adds one glass (`settings.water_glass_ml`, default 250 ml) as a
  `water_logs` row; the card fills toward target. The card opens a sheet with preset amounts
  (200 / 250 / 330 / 500 / 750 ml), a custom amount, the day's list, and undo (soft delete).
- No reminders in v1. Going over target is not flagged.

### 17.2 Supplements
- `supplements`: the user's standing list — `name, dose, unit (g|mg|µg|IU|capsule|ml),
  timing (morning|with_food|evening|any), nutrient? (MicroKey), nutrient_amount?,
  catalogue_id?, sort_order, active`. `supplement_logs`: one row per take
  (`supplement_id, date, taken_at, dose, unit`).
- Today shows the list as a checklist under the water card: tap = taken (row created), tap
  again = untaken (soft delete). Header reads "2 of 3". When the list is empty, a single
  "Add supplements" row leads to the management screen. Nothing else on Today.
- Management screen (`/supplements`): reorder-free list, add from the catalogue (§17.3) or
  as a custom item, edit dose/unit/timing, remove. Exact amounts are always shown as logged
  on the label (elemental mineral, EPA+DHA, IU for vitamin D).
- Micronutrient supplements add `nutrient_amount` to the day's micronutrient totals for the
  coach (§16.1) only; they never touch calories or macros.

### 17.3 Personalised dose guidance
- The catalogue carries, per item, a `recommend(person)` function over `sex, age, weight_kg,
  height_cm` returning `{ dose, low, high, upper?, basis }`. Sources: NIH ODS DRI tables
  (RDA/AI and tolerable upper intake levels), EFSA for caffeine and omega-3, ISSN position
  stand for creatine. Only creatine, caffeine (and water) scale with body weight; vitamins
  and minerals are set by sex and age band — the UI says which, e.g. *"5 g — 0.03–0.05 g/kg
  at 110 kg (ISSN)"* or *"300 mg — RDA 400 mg for men 19–30; supplement cap 350 mg (NIH)"*.
  Height is not a factor in any of the references and is shown as such.
- Every recommendation is labelled general guidance from public reference intakes, not
  medical advice; iron in particular says "test ferritin first".
- The user's saved dose is theirs; the recommendation is shown beside it and never
  overwrites it.

## 18. Meal planner (v4, pulled forward 21 Sep 2026)

The §11 v4 item, built before Oman rather than after: swipe-to-select the week's meals,
macro-scaled portions, a shopping list by aisle with a budget, and a cooking mode.
Differentiator #5 (§15). Everything runs on the recipes the user already has (§8.2); the
planner never invents meals.

### 18.1 Choosing (the deck)
- One recipe card at a time: name, per-portion kcal / protein / fiber, cost per portion when
  prices are known, and how a portion sits against the day's targets. **Swipe right = in this
  week, swipe left = not this week**; buttons do the same. The deck is the user's recipes
  ordered by how recently they were logged (§8.1: the rotation wins), then the rest.
- A plan is a set of recipes with a **portion count** for the week; there is no day-by-day
  grid. Meal prep is "cook three pots on Sunday", not a calendar.

### 18.2 Scaling
- The week's budget is the daily target × days planned (default 7). The planner sets each
  chosen recipe's portions so the plan's kcal lands within ±5 % of the budget while keeping
  protein ≥ target; portion grams are then scaled uniformly (a recipe's own portion size is
  a starting point, not a fact). The user can pin a recipe's portion count; the rest re-scales.
- Fixed meals the user always eats (breakfast, snacks) are entered as a daily kcal/protein
  allowance the planner subtracts first.

### 18.3 Shopping list
- Ingredients across the plan, summed in grams, grouped by **aisle** derived from the source
  category (produce, meat & fish, dairy & eggs, bakery, grains & pasta, tins & jars, frozen,
  drinks, oils & spices, other). Lines check off; the list shares as plain text.
- **Prices**: entered once per ingredient (price per kg, or per pack with the pack weight);
  they persist across plans. The list shows a cost per line and a week total; ±15 % is the
  honest accuracy, and the total says so. No grocery-chain integration (§11).

### 18.4 Cooking
- Recipes carry optional **steps**. Cooking mode shows one step at a time in large type, the
  ingredient list scaled to the portions being cooked, and ends on *Cook batch* (§8.2) so the
  pot is weighed and its portions become one-tap logs.

### 18.4a Reading the plan (added 22 Sep 2026)
A row in *This week* expands in place: ingredients at the amounts the week needs, the numbered
steps with their times and temperatures, and *Cook it*. Swiping a row left takes the recipe out
of the week, with an undo. *Fit → Details* gives the week in the units a person thinks in —
portions a day, cooked weight, cost a day and a portion, each target as a bar, and the single
target the plan is furthest from as a share of itself, with what closes it.

### 18.5 Data
`week_plans (id, week_start, days, allowance_kcal, allowance_protein_g, budget?, items[{recipe_id,
portions, pinned}])`, `prices (id, food_id, price_per_kg, currency, estimated)`,
`recipes.steps[]`, `recipes.{blurb, tags, time_min, oven_c, source}`.
All synced like every other table (§6).

### 9.6 Reading a nutrition label (added 28 Sep 2026)
A barcode nothing recognises is a dead end no longer: one photograph of the nutrition table
fills the custom-food form. `/api/label` sends the image at full detail to the vision model
with a prompt that reads *what is printed* — in any language, from either the per-100 g or the
per-serving column, converting kJ where only kJ is given — and the client checks the reading
before showing it: the macros must account for the calories within a quarter, or the form says
so. Every field stays editable; nothing is saved until the user saves it. Same sign-in, rate
limit and daily cap as §9.4.

### 18.5a The budget is a constraint, not a wish (added 23 Sep 2026)
A recipe's facts carry what it costs at the prices on file, by the same arithmetic the shopping
list uses, so the planner and the list always agree. When a budget is set the scaler trims
portions — worst calories-per-euro first, never a pinned count — until the projected cost fits,
then puts back whatever still fits (best calories-per-euro first, never above the
calorie-optimal count). The week therefore never costs more than the budget, and when money is
what bound it, nothing more could be added without going over. Spending *less* is correct
whenever the calories are already covered, and the plan says so rather than padding the shop.
Unpriced ingredients count as zero, so the list says how many there are.

### 18.6 Discover — new recipes from a budget and preferences (added 22 Sep 2026)
The deck is not only the user's own recipes. From the planner the user sets a **weekly
budget**, ticks **preference cards** — fakeaway (takeaway favourites made to fit), trending
now, high protein, big plate, low calorie, high fiber, quick, air fryer, one pot, meal prep,
batch-friendly, vegetarian, low carb, cheap, Italian, Asian, Mexican, spicy — says how many
dinners they want and what to avoid, and asks for suggestions. A per-portion cost ceiling
derived from the budget goes with the request.

**Turning a card down changes what comes next.** The rejected suggestion is kept whole; the
next request carries the last eight rejections with the ingredients they were built on and is
told to move away from the protein, cuisine, format and method they have in common. Whatever
comes back is then filtered on the device: a suggestion sharing more than half its descriptive
terms (dish words plus the first four ingredients, stop-words removed) with something already
refused — or with another card in the same batch — never reaches the deck. A different sauce on
the same chicken and rice is the same recipe to the person looking at it. A text model (`/api/suggest`, same key, quota and
sign-in rule as §9) returns that many **new** recipes, each with a one-line blurb, tags, a time,
an oven temperature where relevant, ingredients as bought (grams for the whole recipe, a
database search term, per-100 g macros as a fallback, a typical local price per kg) and
numbered steps that carry their times and temperatures. Variety is a stated requirement of
the prompt (different proteins, cuisines, methods), as is landing each portion near the
per-portion calorie and protein targets and keeping the batch inside the budget.

The deck keeps itself stocked: after every decision, if fewer than the requested number have
been kept and none are waiting, another batch is fetched in the background (at most six batches
a week, so a long run of "no" cannot spend without end). Accepting shows the real work as it
happens — matching each ingredient, saving the recipe, putting it in the week — rather than an
indefinite spinner.

Suggestions are cards in the deck with a *New* badge. **Swipe right** grounds every
ingredient in the offline database exactly as §9.4 does (a match must agree on energy
density; the rest become unverified own foods with the model's macros), creates the recipe
with its steps, records the model's prices as *estimates* for ingredients the user has never
priced (an estimate never overwrites a real price and is labelled ≈ everywhere), and puts it
in the week — from there scaling (§18.2), the shopping list (§18.3) and cooking mode (§18.4)
apply unchanged. **Swipe left** discards it. The plan shows *≈ cost of budget* once a budget
is set. The model's numbers are estimates; the honest ±15 % of §18.3 widens to "rough" while
prices are estimated, and the list says how many are.

---

## 19. Where the market leaves gaps (added 30 Sep 2026)

A survey of twenty shipping trackers, the CGM/wearable frontier, the 2026 PWA platform limits and
the nutrition literature produced one clear finding: every differentiator §15 claims still holds.
Nothing surveyed does bounded weekly banking, scheduled mode switching, or coverage and
provenance indicators. Adaptive TDEE is table stakes as §15 says, but the most respected
algorithm in the category ships **no photo or voice logging at all**.

So this release does not add more of what exists. It closes the gaps that were real.

### 19.1 Reducing what logging costs

The retention evidence is lopsided: a median **70 % of users abandon a lifestyle app within 100
days**, and abandonment is driven by burden and friction rather than by the goal being met.
Everything here is judged against the daily loop first.

- **Dictation** (`platform/speech.ts`, §8). "Three eggs and toast with butter" is one sentence,
  and §9.4 already knows how to ground a sentence. A named premium feature elsewhere; here it is
  the browser's own recogniser, so no audio reaches this app or its Worker, and the control is
  simply absent where the engine is.
- **Recipe from a link** (§8.2, `/api/recipe`). Almost every recipe site publishes
  schema.org/Recipe as JSON-LD for search engines, so the common path costs nothing and invents
  nothing. `core/ingredientLine.ts` reads the published lines — weights, spoons, tins, bracketed
  weights, vulgar fractions, ranges (taking the lower bound) — and a bare count like "2 eggs" is
  answered by the *food's own portions*, because USDA already knows an egg is 50 g. Seasoning and
  amounts the page never stated are shown as left out, never rounded to zero.
- **Eating out** (§9.7, `/api/menu`). The market's most-cited unsolved problem. No database can
  hold an independent kitchen's recipes, so the honest error is about a fifth either way — and
  every app that hides that behind one tidy number is lying about the meal where the number
  matters least. This reads the *printed dish names*, which are real data, estimates a restaurant
  portion, grounds each dish against the FNDDS "as eaten" foods, and leads with the range.

### 19.2 Measuring what the scale cannot

- **Waist and RFM** (§3.1a) — the §14 verification that was specified and never built.
- **Cycle-aware trend** (§4.1a) — genuine whitespace: no published algorithm, no competitor.
- **A Kalman filter for TDEE** (§4.5) — the one place the engine could be made both less biased
  and less noisy at once, proven against the existing synthetic benchmark.

### 19.3 Saying the useful thing

- **Consistency, not streaks** (`core/adherence.ts`). Logging on most days predicts outcomes;
  logging every gram on the days you do log does not. And a hard streak reset raises the odds of
  abandoning the app, while habit-formation work finds a single missed occasion does not
  measurably slow automaticity. So the review counts days, forgives one miss inside a run, and
  says "1 day off, which is fine". Landmarks (Monday, the first of a month, new year) carry a
  fresh-start push after a real gap, and it never mentions the gap's length.
- **Diet breaks** (§3.5a).
- **Protein and satiety density** (`core/quality.ts`). Protein per 100 kcal, energy density, and
  an ordinal satiety score from the directions Holt et al. measured — protein, fibre and water up,
  fat down — calibrated so the landmark foods fall in the measured order (potato 50, white bread
  34, croissant 14). Labelled an estimate wherever it appears, with its weights stated in the
  source and asserted in the test, because the lesson of front-of-pack scoring is that an opaque
  score is worse than none.
- **Potassium against sodium** (`core/review.ts`). The DASH evidence is about the ratio, not
  about sodium alone; roughly 2:1 is the aim, and most diets have it inverted. Sodium is a
  `per_100g` field rather than a tracked micronutrient, so it is recomputed from the food behind
  each entry and the panel reports what share of the week it actually knew about.
- **Supplement interactions** (§17.3). Calcium and iron in the same dose cost 28–60 % of
  non-heme iron absorption; zinc above 25 mg long-term depresses copper; the fat-soluble vitamins
  need dietary fat. None of it is visible to someone reading four labels separately, and all of it
  is fixed by moving one dose. **Vitamin B6 now carries EFSA's 2023 upper level of 12 mg/day**,
  not the 25–100 mg still printed on many B-complex labels, because peripheral neuropathy is
  reported far below the old figure.
- **Contributing back to Open Food Facts** (§7.2). When §9.6 reads a label OFF has never seen,
  the app is holding exactly what OFF is missing. Strictly opt-in per product, and inert unless
  the operator configured an account, so a fork cannot write to the commons under someone else's
  name.

### 19.4 Considered and deliberately not built

- **A native wrapper for HealthKit or Health Connect.** Confirmed: no PWA can reach either in
  2026, by any path. Capacitor means App Store review and a yearly fee, which breaks the §12 cost
  ceiling and the zero-running-cost positioning. The cross-platform workaround, if automatic
  weigh-ins ever matter enough, is the Withings API — server-side OAuth, works on iOS.
- **CGM and glucose.** Hardware at ~€150/month, and the evidence for non-diabetics is contested;
  the category's own leader dropped measured glucose in 2025 and now estimates it.
- **A food-quality letter grade.** The best-known implementation is under sustained criticism
  from nutrition scientists for dose-blind additive penalties and a flat organic bonus. §7.4's
  provenance framing is the honest version of the same idea.
- **Gamification, leaderboards, social features.** Social comparison lowers intrinsic motivation
  over time, and this is an app for two people.
- **On-device OCR to cut AI cost.** A label read costs about €0.0007. Not a problem worth solving
  with worse accuracy.

## 19.5 Explaining the app to the person using it (added 15 Oct 2026)

Everything counterintuitive here follows from one idea — §4.5's measured expenditure — and is
explained in two places, neither of which is a tutorial.

**In place, once.** `components/Explainer.tsx`: the full paragraph the first time you meet a
behaviour, a line thereafter, recorded as `seen:<id>` in settings and therefore synced. The
short form reopens on tap, because an explanation with no way back is worse than none. Applied
to the calibrating window (§4.3), the energy bridge (§20.7) and workout energy (§20.6).

**On demand, in full.** Settings — How Kalib works: the premise, why the target is provisional,
why the first ten days never count, why the gym earns nothing, and where confidence comes from.
For the second person picking up a phone that is already set up.

Deliberately not built: a coach-mark tour. It arrives before the question, and the things worth
explaining here are only interesting at the moment they first bite.

## 19.6 Arriving on a screen (added 15 Oct 2026)

Forward goes to the top; back goes where you were. Every platform converged on this, and the
app had neither: it scrolls inside one `<main>` element rather than the window, so nothing —
not the browser, not the router — was managing the offset, and each screen simply inherited the
last one's. Opening *How Kalib works* from the foot of Settings landed 1,718 px down a page the
reader had never seen.

- **A new screen starts at its top.** Pushing, and swapping tabs, which is a replace.
- **Going back restores the offset you left**, keyed by history entry rather than by path —
  two visits to the same list are two different places you were. Restoring waits for the
  content, since most screens are lazily loaded, and gives up the instant you scroll yourself.
- **A query change on the same screen keeps its place.** Today rewrites `?d=` to change the
  day; that is the same screen, not a new one.

Policy in `core/scroll.ts`, timing in `hooks/useScrollRestore.ts`, guarded by `e2e/sweep.spec.ts`
on every screen rather than on the one that happened to show the fault.

## 20. Training (added 14 Oct 2026)

Kalib absorbs what Hevy was being used for. Everything Hevy charges for is free here, and the
reason it belongs in this app rather than beside it is §20.6: this is the only tracker that
*measures* expenditure, so it is the only one that can be honest about what training costs.

### 20.1 Shape

Five tabs, which is Apple's maximum: **Today — Train — + — Trend — Coach**. Doing on the left
of the action button, reviewing on the right. Settings moved to a gear in the Today header; it
is the destination you visit least and the tab bar had no room.

A **running workout is visible from every screen** as a slim bar above the tab bar, carrying the
routine, elapsed time, sets done and the live rest countdown. This is what lets one app hold
both halves of the day: mid-session you can log a shake and come straight back. MacroFactor
shipped training as a *separate app* rather than solve this.

### 20.2 The exercise library

1,394 exercises from [Open Exercise Figures](https://github.com/AbanoubAmir/open-exercise-figures),
**CC0 1.0** — "use, copy, change, share and sell any of this, for any purpose, without asking
and without giving credit". We credit it anyway, in the README and the About card.

Three things the source does not do, done in `core/`:

- **Muscles are normalised.** It names a primary target 19 ways and secondary muscles 75 ways,
  and the two vocabularies disagree: `delts`, `deltoids` and `shoulders` are three different
  things in it. Left alone, "shoulders this week" would count a third of the sets that trained
  them. Anything unrecognised is dropped rather than guessed; `core/muscles.test.ts` is the
  tripwire for a 20th target appearing.
- **Load type is inferred.** The source never says whether a set is weight and reps, reps alone,
  or seconds. A plank is held, a pull-up takes a belt, an assisted machine counts reps because
  the stack takes weight *off* you.
- **Names get the shorthand a gym types.** It calls the back squat "Barbell Full Squat". Derived
  aliases strip equipment words; a separate hand-written `shorthand` field in
  `data/exercise-aliases.json` is what makes a query *decisive*, because the derived ones would
  have four exercises each claiming to be "squat". Measured on a 60-term probe: **98% find a
  result, 100% put the right one first.**

**The clips are re-rendered in Kalib's palette.** The source draws them on near-white with the
worked muscle in red, which on a dark screen is the loudest thing on it and carries no
information. The repo ships its figures and its renderer, whose palette is module constants, so
`scripts/render-exercise-media.py` renders the figure in `ink-2` on `surface` with the muscle in
`accent`. No other tracker has exercise art in its own colours, because no other tracker has the
source art. The media is gitignored and regenerated; only the metadata is committed.

**Lists show a still; opening shows the movement (added 18 Oct 2026).** The clips average
47 KB, which is right for one exercise and wrong for thirty you are scrolling past — a search
for "bench" returns 33 results, and animating all of them would pull over a megabyte before you
had chosen anything. So `scripts/make-exercise-posters.py` takes the first frame of each clip at
160 px, about 4 KB, and that is what search results and routine rows carry. The two are cached
separately, stills far more generously than clips, or a browse would evict the animations.

In a list the picture is its own control: the row picks the exercise, the still shows it. That
separation is the point — eleven things are called bench press, and you must be able to look
without choosing.

Nothing downloads until an exercise is opened, and the service worker then keeps it. **Saving a
routine warms its own clips**, so a routine built at home works in a basement gym without ever
having opened its exercises one by one. It is not awaited and not required: building a routine
with no signal simply leaves the clips to arrive the first time they are opened, which is the
behaviour that existed before.

### 20.3 Logging a session

Numbers go on the docked `NumberPad`, never the OS keyboard (§8). The selected cell takes a ring;
Enter moves weight — reps.

**Cells carry a ghost figure.** Faint enough to read as a suggestion, real enough for the tick
to accept, so taking the suggestion is one tap rather than two numbers. Hevy prefills the input
*and* prints the same value in a Previous column beside it; showing it once frees the column
that was squeezing the exercise names.

Since §20.8 the ghost is **what to do, not what was done** — the prescription where there is
one, last session's figures where there is not. The two disagree exactly when it matters: the
session after you clear a rep range, repeating last week's weight is precisely the wrong move,
and a ghost still offering it would be arguing with the line above it. The line above carries
the reason rather than the figures, because the figures are already in the row.

- **Rest is arithmetic, not a clock.** No JS timer survives an iOS screen lock, and a
  tick-counting timer would be wrong by exactly the interval it is meant to measure. One
  absolute end instant is stored and every reading subtracts from it, so the number is right on
  return however long the phone slept.
- **Supersets are adjacency.** The letter is a label; `core/routines.ts` re-derives it after
  every reorder or delete, because moving an exercise between a pair silently left both ends
  claiming to be grouped.
- **Plate maths and a warm-up ramp**, both free: "Bar + 25 + 5 + 2.5 a side" under the pad, and
  a ramp to the working weight whose sets are excluded from volume and records. Hevy charges for
  the warm-up calculator.
- **A set can be spoken.** "eighty for eight", reusing the recogniser §9.4 already needed. The
  parser refuses rather than guesses — a misheard number written silently becomes next week's
  target — and reads back what it understood for the tick to confirm.
- Sets never ticked are dropped when the session ends. They were not performed.

### 20.4 What a set is worth

Volume is weight × reps, with bodyweight work priced at bodyweight (plus the belt). Where
bodyweight is unknown the answer is **undefined, not zero** — twelve pull-ups is not zero work —
and the count of unpriced sets is reported rather than hidden.

Estimated 1RM is the mean of Epley and Brzycki, which err in opposite directions, and is
**refused above 12 reps**, where they stop agreeing and Brzycki's denominator heads for zero. A
single needs no formula.

Storage is always kilograms; `lb` changes only what the pad asks for and what is printed.

### 20.5 Records

Derived from history, never stored — a stored record is a second source of truth that drifts
when a session is edited, and would need conflict resolution of its own. Heaviest, best
estimated 1RM, best single set, most reps at a weight, longest hold.

**An exercise's first outing sets no records.** Otherwise everything is a PR on day one, exactly
when someone first looks. More reps at a weight never used before is *new*, not an improvement.

### 20.5a The session summary (added 15 Oct 2026)

Finishing a workout lands on a summary rather than a toast: volume, sets and duration as figures
on the page, the muscles trained, any records, and the energy estimate.

Celebration lives here and only here. A record is a quiet mark during the set — the tick and a
short vibration — and the fuss happens once, afterwards. A history screen opened three weeks later
stays neutral, because applause for something you already know is noise.

It is also the only place the energy figure appears, and it never appears without the sentence
that makes it safe (§20.6). A toast could not carry that sentence, which is the real reason the
flow ends on a screen.

**The same screen reads a session back.** Recent workouts on Train opens the summary for any
session, which is where last Tuesday's records live — they were previously unreachable once the
screen had been dismissed. The two arrivals differ: finishing gives the full-height name and a
button to close the workout off, while opening a row gives a back arrow and no button, since
nothing was just done. Session passes `justFinished` in the navigation state to tell them apart,
and a reload lands on the quieter of the two.

### 20.6 What a session costs, and why it is never spent

**The energy figure is not added to the day's food budget.** Kalib's TDEE is measured from intake
against weight trend (§4.5), so the gym is already inside it; adding an estimate on top would
double-count and make the filter chase its own tail. Every other app gets this wrong because
none of them measure expenditure.

It is MET-based (3.5 light to 6.0 vigorous, chosen from how densely the session was worked) and
**shown as a range with no midpoint** — "305–525 kcal" — because a 2018 validation of seven
devices found **none met a 10% accuracy threshold for resistance training**, and leading with a
single figure would claim a precision nobody has. The midpoint exists only as the stored
value on the row and is deliberately not printed: on a sparse session it lands exactly on
the light-effort bound, so "305 kcal, likely 305–525" reads like a bug even though both numbers
are right.

### 20.7 The energy bridge (added 14 Oct 2026)

Training changes *when* the week's calories are eaten, never how many.

**Nothing is ever added.** §4.5's TDEE is measured from intake against weight trend, so the gym
is already inside it; adding an estimate of what a session burned would double-count and send
the filter chasing its own tail. Every other tracker adds it, and gets away with that only
because none of them measure expenditure in the first place.

So the same weekly budget is distributed unevenly: more on the days you lift, less on the days
you do not, summing to the identical total. `core/trainingDays.ts` enforces conservation by
construction — `t × gain = r × loss` — rather than by arithmetic afterwards, and the clamp
against the §3.5 floor is applied once to the whole week rather than per day, because clamping a
day in isolation is exactly how conservation would break.

**What it is, honestly.** The evidence says calorie cycling and flat intake produce the same
weight change at an equal weekly deficit; that carbohydrate intake has no independent effect on
hypertrophy; and that nutrient timing barely moves fat loss or lean-mass retention. This is
therefore an *adherence* feature and the interface says so in those words. You are hungrier on
training days, so it lets you eat more then without spending anything unbudgeted. Implying a
metabolic benefit would be the easy copy and the dishonest one.

- **Protein and fat hold every day; carbohydrate takes the whole swing.** The evidence for
  constant daily protein is far stronger than the evidence for anything above it.
- **Default 300 kcal** between a training day and a rest day, the top of the 200–300 range the
  literature describes. Off, 150, 300 and 500 are offered.
- **Training days are inferred, not configured**, from which weekdays were actually trained over
  the last four weeks — a weekday counts when it appears in at least half the weeks observed. A
  plan typed in once goes stale; behaviour cannot. A day with a session always counts on the day,
  whatever the pattern said.
- **Nothing moves until there is a pattern.** Under two weeks of history, or no rest days, or no
  training days, the budget stays flat. A sample of one is not a routine.
- Today names the shift on its own line — "Training day — 172 kcal borrowed from your rest
  days" — because *borrowed* is the accurate word and *earned* would not be.

### 20.8 What to do next (added 18 Oct 2026)

Logging what you lifted is a diary. Saying what to lift is the part people pay for, and it is
two questions, not one: what to do on *this* lift, and whether the *week* covers you.

**The lift — `core/progression.ts`.** The rule is double progression. Inside a rep range you add
reps until every working set reaches the top of it, and only then add load and drop back to the
bottom. One new thing is asked of you per session, never two.

It is automatable precisely because the evidence does not prefer either lever: trials comparing
load-increase against rep-increase find near-identical growth over eight weeks. The choice is
bookkeeping rather than physiology, which is the kind of choice a program should make for you.

- **Every working set, not the best one.** Clearing the range once and falling short twice has
  not earned the next load; that is how a stall gets built.
- **The working load is the modal weight, not the heaviest.** A top single followed by three
  back-offs is worked at the back-off weight, and judging the session on the single would call
  three successful sets a failure.
- **RIR separates two failures that look alike.** Falling short of the range having stopped four
  reps clear of failure is an effort problem; dropping the load would solve the wrong thing. The
  interface says which it is rather than silently prescribing the same weight again.
- **Default target is 2 reps in reserve** — inside the 0–3 band the hypertrophy evidence
  clusters in, and far enough from failure that the next set is not compromised. The default
  increment is **2.5 kg**, two 1.25 kg plates, and new loads are rounded to whole increments
  because half a plate does not exist.
- **Stalling is a state, not a feeling.** Three sessions at one load without ever clearing the
  range is a stall, and the answer is to back off 10% rather than to try the same weight a
  fourth time. A single session at a different load breaks the run — the lift moved, so it is
  not stuck.
- **Bodyweight work has no bar**, so the range is the only lever and the reps simply keep
  climbing past the top of it.
- **It refuses rather than guesses.** A plank has no load-and-reps to trade off; a session with
  no rep range has no top of the range to clear; an exercise never performed has nothing to
  progress from. Each says which of those it is, and the screen falls back to showing last time.

**The week — `core/trainingLoad.ts`.** Hard sets per muscle per week, because that is the dose
the hypertrophy literature actually measures. Not tonnage, which rewards squatting over pressing
for reasons of leverage, and not session count, which says nothing about what was trained.

- **Ten to twenty sets** is the band, spread over **at least two days**. Enough sets crammed
  into one day is reported as its own problem — a frequency gap, not a volume one.
- **An assisting muscle counts half a set.** A row trains the lats directly and the biceps
  incidentally, and counting both whole would make every pulling day read as a full arm session.
  This is a convention rather than a measurement, so the direct count is kept beside it.
- **Cardio is not a muscle with a weekly dose**, even though an exercise may declare it, or a
  rowing machine would turn up inside a coverage gap.
- **Nothing is reported as untrained unless the caller says what it expected** — normally the
  muscles the person's own routines target. Flagging all nineteen at someone who only ever meant
  to train five is noise, not advice.
- **Work that cannot be attributed is counted as unknown, never as zero**, exactly as §20.4 does
  with unpriced bodyweight sets.

### 20.9 Writing the week (added 18 Oct 2026)

§20.8 answers what to do on a lift you already train. This writes the week in the first place —
`core/program.ts`, from a number of days and whatever the gym has.

**Frequency decides the shape.** Most of a split is taste, but this part is not: a muscle
trained twice a week beats the same sets trained once. Every split here gives every programmed
muscle at least two sessions, which is why **three days is three full-body days rather than
push/pull/legs**. PPL on three days is the common default and gives each muscle exactly one
session a week. On six days it is right, because then it is twice.

| Days | Week |
| --- | --- |
| 2 | Full body × 2 |
| 3 | Full body × 3 |
| 4 | Upper, Lower, Upper, Lower |
| 5 | Upper, Lower, Push, Pull, Legs |
| 6 | Push, Pull, Legs × 2 |

**Eleven muscles are programmed, not nineteen.** Forearms, traps, lower back, obliques,
adductors and abductors are trained by movements that already appear — a row works the traps, a
squat works the lower back — and programming them directly is a choice someone makes rather
than a default to impose. Neck and cardio are not hypertrophy targets. The list matters because
it is what the frequency guarantee is made over, and a full-body day owing fourteen muscles
cannot honour that guarantee in a session anyone would finish.

**One movement per muscle per day**, taking whichever muscle is furthest behind for the week
first. Volume still owed afterwards becomes *sets on what is already there*, never a second
movement for the same muscle — the first version of this produced a leg day of back squat,
front squat, overhead squat and goblet squat with no hamstring curl in it.

**The staples are named, and that is the hard-won part.** The catalogue has 1,394 exercises and
no notion of which of them anyone programs. Difficulty does not separate a bench press from a
boxing uppercut; equipment does not separate a squat from a groin kick. Scored on muscles
covered alone the generator reliably picks the library's oddest entries, because an exercise
claiming six assisting muscles outscores one claiming two — the first honest output of this
module was a full-body day opening with a strongman car flip. So three or four movements per
muscle are named, all of them ones a lifter would recognise. They are a preference and not a
filter: restrict the equipment far enough and it falls back to scoring the rest of the
catalogue, which is right for a hotel gym and wrong as a default.

Two smaller consequences of the same problem. No exercise is paid for more than **two**
assisting muscles, because past that the list describes anatomy rather than training. And
**advanced movements are left out** unless asked for: a generated program is the one nobody
chose exercise by exercise, so it should not open with a muscle-up.

**It is a starting point and is built to be edited.** The output is ordinary routines, so
swapping a movement is two taps. What it will not do is pretend: muscles it could not cover
with the equipment allowed are named rather than quietly dropped, exactly as §20.4 reports
unpriced sets and §7.4 reports missing micronutrients.

**Three kits, not nine switches** (added 19 Oct 2026). The screen asks *where you train* —
Gym, Dumbbells (dumbbells, body weight, bands) or Body weight — rather than offering the nine
equipment toggles, which make 511 combinations of which nobody has read the output. Every day
count for Gym and Dumbbells is tested against the shipped library to come out entirely from
named movements.

**A second tier of staples for no gym.** With body weight alone the fallback scoring wrote "One
Arm Against Wall" in as the leg work and "Kick Out Sit" as the quads, so the home movements are
named too: push-ups, chin-ups, inverted rows, split squats, inverse leg curls, glute bridges.
They rank *below* the gym list, so in a full gym a body-weight squat never edges out a goblet
squat, and the gym weeks are byte-for-byte what they were before. The order of the ranking
matters and was got wrong first: with the tier ahead of neediness, a dumbbell week never reached
the lats, because their only staple there is a chin-up and every gym staple outranked it however
far behind the lats had fallen. So it is *named at all*, then *how far behind*, then *gym over
home* — the tiers only ever compete for the same muscle.

**What it cannot do, it says.** The library has no pike push-up and nothing body-weight-only
that trains shoulders or biceps as its own movement. Rather than name the least bad option as
though it were a staple, the program reports those muscles as **improvised** and the screen
says so above the list: their picks are stand-ins, swap them for something you can load.
Boxing drills, which the library files as strength with shoulders as the primary, are never
programmed — on a body-weight week a left hook had become the shoulder work.

**The screen** (`/train/build`, from *Build a week for me* on Train). Days and kit, a line on
what the week delivers ("every muscle at least 3× a week, 12–14 sets"), then every day in full.
The choices live in the URL, so watching an exercise and coming back keeps the week. Adding
writes one ordinary routine per day *alongside* whatever is there — a preview that replaced
your routines would be a strange thing for a button to do — numbering any name that clashes,
with Undo on the toast.

---

---

*Not medical advice. Targets are general-population formulas. If any medical condition
or medication applies, they should be reviewed by a clinician.*

---
