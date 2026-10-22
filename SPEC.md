# SPEC.md — Kalib

**Project:** Kalib — adaptive macro tracker
**Package / bundle id:** `com.eliya.kalib`
**Name chosen:** 19 Sep 2026, after App Store collision checks rejected *Tare*,
*Mizan* and *Tarra* (see §15). Domain and trademark: preliminary screen done 20 Oct 2026 — see §13.7.
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
fiction. The UI must surface data provenance (§7.4), not hide it. A change of unit is not
new data either: §22 sets how many decimals each measure keeps in pounds, inches and ounces.

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
- **The circle: the one cross-user exception** (added 21 Oct 2026). Until §21 every row was
  readable by its owner only. A circle lets people who invited each other see a few integers a
  week about each other — sessions planned and done, three scores, a count of left-out jumps,
  a hard-mode rating — and nothing else: no food, body, set, note or date. It is opt-in (nothing
  is published before joining a circle), invite-only, deleted on leaving the last circle, and
  served only through `security definer` functions over tables no client can touch. Under
  Article 9 these scores are derived from health data, so joining a circle is the explicit act
  of consent and the screen states what is shared before anything is. Details in §21.2 and
  §21.5; threat model in `SECURITY.md`.
- **Health data sent to a model** (added 21 Oct 2026): injury help (§20.16) is the first
  feature that sends health data — a description of an injury — to a third party, the
  OpenRouter model behind the Worker. It therefore has its own explicit, versioned, revocable
  consent (asked before the first request, shown and withdrawn in Settings), sends only the
  description and exercise names, keeps nothing (no storage, no logging, upstream errors
  reported by status only), and screens for red flags on the phone before anything is sent,
  so the most serious descriptions never leave the device at all. Meal estimates (§9.4) send a
  description or photo of food, which is not treated as special-category data; the injury flow
  is, and is held to the stricter rule. `SECURITY.md` has the server side.
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

   **Preliminary screen, 20 Oct 2026** (public databases via TMview; not a professional search
   and not legal advice):
   - **No exact KALIB mark** in classes 9, 41, 42 or 44 at EUIPO, UKIPO, USPTO or WIPO. The only
     exact KALIB marks are Chinese food and drink marks (Uyghur *kalib*, "heart").
   - **The one real risk is KALIBRA, owned by Nestlé** (EM 015600034, UK00915600034, WO 1484108)
     in classes 42 ("computer services related to dietary programs") and 44 ("dietary planning
     and weight loss supervision"). KALIB is its whole first part, so **using** the name is low
     risk but **registering** it in 9/42/44 could plausibly draw an opposition. Others found
     (Kalibra International, KALIBER, KALIBRATE, KALIBIOS, calib) are other fields or regions.
   - **Domains:** kalib.app, kalib.eu, kalib.io, kalib.fit, kalib.health, getkalib.com and
     kalibapp.com were unregistered on that date; kalib.com is parked by an investor since 2004.
   - **Similar products:** "Kalibra: TDEE & Calories" on Google Play (tiny, same category),
     Kalibra Diet (iOS, ketogenic programme), kalibra.ai, and Caliber (a large strength app with
     a sound-alike name).
   - **Languages:** *qālib*/*kalıp* mean mould or form (Arabic, Persian, Urdu, Turkish);
     nothing offensive found.
   - **Not checked:** the full EUIPO goods lists (the detail page refused access), USPTO's own
     search, and the WIPO Global Brand Database directly.

   Next steps, all the owner's call: register **kalib.app** (and kalib.eu as a cheap backup);
   keep the app described as a tracker, not a diet or weight-loss supervision service; and
   before any trademark filing, pay for a professional clearance opinion on KALIB against
   KALIBRA. An EUIPO filing would cost €850 for one class, plus €50 for the second and €150 for
   each after that (€1,050 for 9 + 42 + 44). That is optional and well above the €1/month cost
   ceiling.

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
  aliases strip equipment words; a separate hand-written `shorthand` field (now in
  `data/exercises-curated.json`, §20.19) is what makes a query *decisive*, because the derived
  ones would have four exercises each claiming to be "squat". Measured on a 60-term probe:
  **98% find a result, 100% put the right one first.**
- **The mainstream few hundred are renamed, and a few added** (§20.19): "Lever Seated Fly" is
  "Pec Deck (Machine)", and the face pull, which the library never had, now exists.

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

Estimated 1RM on bodyweight work is of **lifter plus belt**, so it needs bodyweight and is
absent without it (v0.38.0). Before that a chin-up with 10 kg on the belt reported a "12.5 kg"
best 1RM: a number about the belt. It is printed to the whole kilo or pound — two formulas that
disagree by a few percent do not support the half-kilo a loaded bar does (§2.4).

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

**Two corrections** (v0.36.1). Pull-Up and Hanging Leg Raise were named staples and marked
advanced in the library, and advanced movements are left out by default, so they could never be
chosen; they are now Chin-Up and Captain's Chair Leg Raise, and a test against the shipped
library holds every staple to *not advanced*. And core work is never given the heavy range: a
3/4 sit-up lists the quads and lower back, which made it a compound by the two-assisting-muscles
rule, and it was prescribed 6–10 reps at three minutes' rest, like a squat. It is now 10–15 at 90
seconds like any other isolation.

**Body weight is prescribed in reps, not load** (v0.36.2). A movement the library marks
`bodyweight_reps` cannot carry added weight, so reps are the only way to make it hard, and six
to ten bodyweight squats is a warm-up. Those now start at **10–20** (two minutes' rest) for
compounds and **12–20** (90 seconds) for single-muscle and core work. The bottom of each range
sits lower than it might because some of these are hard — an inverted row, a captain's chair
straight-leg raise — and §20.8 keeps adding reps past the top once it is cleared, so the range
only says where to begin. Push-ups, chin-ups and dips are `weighted_bodyweight`: they take a
vest or a belt, so they keep the loaded ranges.

### 20.10 Which routine is next (added 19 Oct 2026)

A week is a list of days meant to be done in order, and Train listed them side by side with
nothing saying which was today's. Every session already records the routine it came from, so
the app knows where you have got to (`core/rotation.ts`).

**Next is the routine after the one done most recently, in the list's own order, wrapping
round.** It is a rotation, not a calendar: missing Wednesday does not skip Wednesday's session,
it leaves it next. That is how a rotation-based program is run, and it is the only rule that
never asks for two sessions to catch up or drops one that has not been done. Reordering the list
reorders the rotation.

Empty workouts, sessions still running, and sessions from a routine since deleted say nothing
about the rotation and are skipped, so deleting a routine moves "next" on to what followed it
rather than back to the start.

On Train it is one card above the list: the routine, its size, and **what it is next after and
when** ("after Full body A yesterday"), because a suggestion that does not show its working
reads as the app having an opinion. Once today is trained it says **Next time** and its button
steps down, so it never reads as asking for a second session. It is absent with fewer than two
routines, where it would only repeat the list, and while a session is running, which already
says what is next.

### 20.11 Is it going up (added 20 Oct 2026)

Records say what the best ever was; they cannot say whether the lift is still climbing, because
a record from March reads the same in October whether everything since has crept up or slid
back. Each exercise's screen draws **one number per session over the last year**
(`core/strength.ts`), derived from history like everything else and stored nowhere.

The number depends on the exercise. A loaded lift is drawn by **estimated 1RM**, which puts a
set of five and a set of ten on one scale. Bodyweight work is drawn by **most reps in a set**,
and a hold by its **longest time**. Belted bodyweight work switches to estimated 1RM of lifter
plus belt once a belt has been used and bodyweight is known, priced at the **weigh-in nearest
before that session**, not today's: someone who has lost ten kilos would otherwise look weaker
on every pull-up they ever did. Distance work has no line, since "better" depends on whether
the goal was pace or distance, and the app does not know which.

Every session is a dot. The ones that beat everything before them are filled in the accent;
the first never is, as with records. Two points are the minimum, since one dot shows no
direction. Under the line is a single sentence, which is also the chart's accessible name:
*"93 kg last time, up from 85 kg on 3 Jun. Best 95 kg on 12 Sep."* The comparison is made on
the printed figures, so a rise too small to show reads as "the same", never as "up from" an
identical number.

### 20.12 Blocks, and the easier week (added 20 Oct 2026)

The evidence is thin, and the feature is sized to it. A randomized trial in trained lifters
(Coleman et al. 2024, PeerJ, n=39) took a whole week off mid-block and found **equal muscle
growth and somewhat less strength** than training straight through. A second, smaller one
(Pancar et al. 2026, Sci Rep) cut the volume for a week instead of stopping and found **no cost
and no gain**. Coaches (Bell et al. 2023 Delphi consensus) use lighter weeks for fatigue,
adherence and injury risk, about every 4–6 weeks, by cutting sets while keeping the lifts and
the days. So an easier week here is **offered, never imposed; lighter, never none; and sold as
staying fresh, not as growing more.**

**A block is derived, not stored** (`core/block.ts`). It starts at the latest of: the first
session; the first session after **a week or more off** (a break already, whatever it was
called); the day after an easier week; and the day an offer was turned down. Only the easier
weeks taken (date ranges) and the last "not now" are kept, in settings, which already sync.

**When it is offered:**
- **Scheduled:** from week **6** of a block (five ordinary weeks and an easier one).
- **Early, from week 3,** when **two or more lifts** say so at once: stalled by their own rule
  (§20.8), or **slipping** — two or more fewer reps at an unchanged weight than the session
  before. One lift is that lift's problem and has its own back-off; two is the week's. Only
  lifts trained in the last three weeks count.
- **Never scheduled for a beginner** — under 12 weeks of history, no stall yet, no easier week
  taken — who recovers faster than they tire. The early signals still apply.
- **Always on request:** "Take an easier week" on Train.
- **"Not now" starts a fresh block,** so the offer comes back when the next one is due rather
  than the next morning.

**What it is:** seven days. A routine started inside one runs at **half its sets, rounded up,
never none**, at **last time's working weight, to the bottom of the range**. Coaches agree on
keeping the weight and cutting the work; the bar stays familiar while the effort drops.

**What it does to the rest of the app.** Its sessions are **invisible to progression**, so a
week of deliberately short sets is not read as three stalls, and the week after resumes from
the training before it. A lift that was stalled takes its own 10% back-off then, at the start
of the new block. They are left off the progress line (§20.11), where they would read as a
decline. The week's coverage line says *fewer sets is the point* instead of listing muscles
short of the band. It can be ended early; ending it keeps the days already taken.

**Deliberately not built:** a reps-in-reserve ramp across the block (3 → 0), which a 2025
trial (Martikainen et al.) found no better than a steady target, and which beginners cannot
rate to within a rep; weekly set ramps toward a "maximum recoverable volume"; mandatory weeks
off, the one design shown to cost strength; and readiness questionnaires or fatigue scores,
none validated for this population. Block length is not tunable per person, because there are
no data to tune it with.

### 20.13 Where the training market leaves gaps (surveyed 20 Oct 2026)

A fresh pass over Hevy, Strong, Fitbod, MacroFactor Workouts, Alpha Progression, RP
Hypertrophy, JuggernautAI, Dr. Muscle, Boostcamp, Liftosaur, Caliber, Ladder, Gymshark,
StrongLifts, Jefit and the 2026 newcomers (Arvo, Whoop's Strength Trainer, Lyfta). App Store
pages and vendors' own help pages were read directly; Reddit could not be, so community
sentiment is second-hand.

**The finding that matters most:** MacroFactor launched a separate workouts app in January
2026, and its help centre says the two **deliberately do not adjust each other** — no training
from nutrition data, no nutrition targets from training data. The combination Kalib already has
(the energy bridge, §20.7; training-day banking) is still unoccupied, and is where the novel
work is.

**Gaps, ranked by value to a person ÷ cost to build here** (offline, no per-user paid service,
one developer):

1. **Import from Strong and Hevy, and a workout CSV export.** Years of history are what keep
   people on an app. Hevy imports only Strong; Strong imports nothing. Kalib exports food as CSV
   and everything as a JSON backup, but no workouts as CSV, and imports none.
2. **Bodyweight-aware load** — done for e1RM in v0.38–0.39 (§20.5, §20.11); volume already
   prices bodyweight (§20.4).
3. **Blocks and easier weeks** — done in v0.39.0 (§20.12). Competitors also offer selectable
   progression schemes (MacroFactor added four in Sep 2026); double progression stays the
   default here until there is a reason to add another.
4. **Gym profiles and equipment-aware swaps** — the kits of §20.9 are the start of this.
5. **Left/right logging, AMRAP, myo-reps, partials.** Kalib logs warm-up, drop and failure sets;
   none of these four.
6. **Known programs as data** (5/3/1, GZCLP, PPL), run by the existing progression engine.
7. **Logging a workout after the fact.** Strong's reviewers ask for it; Kalib starts every
   session at "now" and has no back-dating either.
8. **A rest timer that alerts with the screen locked.** Kalib vibrates only while open; Web
   Push from the Worker (already used for reminders) is the only route in an installed PWA.

**Novel, and only possible with both halves:**
- **Cut quality.** Strength on the staple lifts against the weight trend: when e1RM falls
  while weight drops fast, suggest a slower rate. Nobody does it; MacroFactor chose not to.
- **One calendar for diet breaks and easier weeks** (§20.12 with the diet-break feature), so
  the two land together, and a smaller set band during an aggressive deficit.
- **Performance against fuel** — each session's result against what progression expected,
  set beside the previous day's intake, shown only once there is enough data to say anything.

**What users dislike, and Kalib avoids:** paywalled history (Hevy shows three months of graphs
free; Strong caps routines at three); "AI" picks that experienced lifters ignore; blocks that
cannot be changed mid-way (the easier week here is always optional and can be ended); a
workout screen that traps you until you finish; and counting workout calories on top of a
TDEE that already contains them, which §20.6 already refuses.

### 20.14 What a session asks of the phone, and sharing it (added 21 Oct 2026)

The last pieces of the R1 plan. Each is small; each is the difference between a logger that
works on a desk and one that works on a bench.

**The screen stays on** (`platform/wakeLock.ts`) from the moment a session starts until it is
finished or discarded, on every screen — logging a shake mid-session keeps it too. The browser
drops the lock whenever the page is hidden and never returns it, so it is asked for again each
time the page becomes visible. Refusal (battery saver, policy) and absence are silent: the
screen simply sleeps as it did before. On iPhone it works in an installed app from iOS 18.4,
when WebKit fixed the home-screen bug; earlier versions sleep as before. There is no switch:
nobody propping a phone on a bench wants it to lock, and it lets go the moment the workout ends.

**The end of a rest sounds and buzzes** (`platform/chime.ts`), at most once per end instant:

- *When.* `core/restTimer.ts`'s `restAlertDue` decides, from the absolute end instant alone. It
  sounds if the rest has ended no more than **10 s** ago (`REST_ALERT_GRACE_SEC`) — enough for a
  throttled tick or a screen woken just after the end. A rest that ended minutes ago, while the
  phone was locked, is news about the past and stays quiet. A rest the person ended with "−15"
  is recorded as a rest of nothing and stays quiet too: they were looking at the screen. "+15"
  after a chime makes a new end, and earns a new one.
- *How.* One timeout aimed at the end instant, re-checked when the page becomes visible — not a
  ticking interval. Mounted from the workout bar, the one component present for the whole of a
  session on every screen, so a rest ends audibly while reading the trend too.
- *Sound.* Synthesised (two short sine notes a fifth apart, soft attack and decay), so there is
  no file to cache. Browsers only let audio start from a gesture, so the context is unlocked on
  the session's own taps (`pointerup`/`touchend`/`keydown`; `pointerdown` does not count for a
  finger). Web Audio on iPhone mixes with music rather than pausing it and follows the silent
  switch — both right for a gym. `navigator.audioSession` is left alone: its `transient` types
  are silent on iOS 17–18, and changing it would reach the microphone used for voice sets.
- *Buzz.* `navigator.vibrate` (120-80-220 ms), distinct from the 8 ms tick a set gives. Android
  only; no iPhone exposes vibration to the web.
- *Off switch.* "Sound when rest ends" in Settings → Training, key `rest_alert`, on by default,
  synced (a preference about the person, like the weight unit).
- *Not covered:* a locked phone. No web page can sound while the phone sleeps; the visible
  countdown and the chime on waking within the grace window are what a PWA can honestly do.
  Web Push from the Worker (§20.13 #8) would be the route, at ten-minute cron granularity — too
  coarse for a rest — so it is not attempted.

**A routine made available offline** (`services/exerciseMedia.ts`, the routine editor). Saving
a routine already warms its demonstrations quietly, but that only works when the service
worker controls the page, and it says nothing. The card under a routine's exercises says how
many of its demonstrations are actually on the phone (an exercise counts only when both its
still and its clip are), and "Make available offline" fetches the rest straight into the same
caches the worker reads (`kalib-exercise-posters`, `kalib-exercise-media` — a unit test reads
`vite.config.ts` to keep the names in step), with progress per exercise, four at a time.
Anything already cached is not fetched again; a 404 is never stored (the worker would serve it
back as the clip); and a partial result says exactly how many could not be saved and offers to
try again. Where a page can see no caches the card is not shown.

**Sharing a workout** (`core/workoutShare.ts`, the session summary) — plain text through the
phone's own share sheet, or the clipboard where there is none. Nothing is uploaded, no image
is drawn, no link needs a server:

```
Push A — Tuesday 21 October
52m · 18 sets · 6,240 kg lifted

Bench press — 3 sets, best 82.5 kg × 8
Pull-up — 3 sets, best 12 reps
Dip — 3 sets, best bodyweight + 15 kg × 6
Plank — 2 sets, best 1:30

A record
★ Bench press: heaviest ever

Logged with Kalib
```

One line per exercise: its working sets and the one set that says most — the heaviest for a
lift (reps break a tie), the most reps for bodyweight work, the belt for weighted bodyweight,
the longest hold, the furthest distance with its time. Warm-ups and unticked sets are not
work and are not counted. Weights follow the kg/lb setting; tonnage is left out when there is
none (a session of holds). Records are counted as the summary counts them but listed one line
per exercise, since one heavy set usually breaks two or three at once.
### 20.15 Keeping it going (added 21 Oct 2026)

**Weeks, not days.** A rest day is part of the program, so a daily streak would either punish
recovery or count it as success and mean nothing. And Kalib's week is a rotation, not a
calendar (§20.10): missing Wednesday leaves Wednesday's routine next. So the streak is not "did
you train on Wednesday" but **"did you train on as many days as you mean to this week"**
(`core/streak.ts`). Weeks run Monday to Sunday, as §5 and §20.5 do. Two sessions on one day are
one day, and a session with no working set in it is not a training day, so an empty workout
started and finished by accident counts for nothing.

**Why it forgives.** A broken streak costs more than an intact one earns: breaking one makes
people less likely to do the thing again at all, not just to rebuild the run (Silverman &
Barasch, *J. Consumer Research*, 2023), and missing a single occasion does not measurably slow
habit formation (Lally et al., 2010). `core/adherence.ts` already forgives a missed day of
logging; training gets the same courtesy, sized to a week:

- **Three skips a month.** Each training day short of the aim spends one; a week short by more
  than what is left ends the run. A week is charged to the month holding its Thursday, which is
  the ISO rule for which year a week is in, applied to months.
- **An easier week never breaks a run** (§20.12) — taking one is following the plan — and owes
  no skips. A week or more off with no easier week declared is still a shortfall and spends
  skips like any other: the way to take a break without spending them is to say so.
- **The week you are in is never judged.** It joins the run once it is met; until Sunday is
  over it is open, not missed.
- A run counts every week it survived, forgiven ones included, but never begins with a week
  you did not train in.

**The aim.** You can set it (1–6 days, from this week on; weeks already over keep the aim they
had, so changing your mind never rewrites a run). Left on *Auto*, it is the **lower median of
your last four closed weeks** — one holiday week does not lower the bar and one double week
does not raise it, and of the two middles the lower is taken, so the bar follows you down a
little sooner than it follows you up, which is the kinder error. Fewer than two weeks of
history asks for one day a week, Hevy's rule. The aim is stored as a list of
`{from: Monday, sessions | null}` in the setting `training:weekly_aim`.

**Milestones** (`core/achievements.ts`) are derived from history like records (§20.5), never
stored; only which have been shown is kept (`achievements:seen`). Three kinds, because each
answers something people actually wonder:

| Kind | Steps |
| --- | --- |
| Lifted in all | a concert grand piano (480 kg, Steinway Model D), a bull African elephant (6 t, National Geographic's 2.5–7 tons), a blue whale (330,000 lb, NOAA), a fully loaded 747-8 (987,000 lb MTOW, Boeing), a fuelled Saturn V (2.8 million kg, NASA), the Eiffel Tower's iron (7,300 t, SETE) |
| Workouts | 1, 10, 25, 50, 100, 250, 500, 1,000 |
| Weeks running | 4, 12, 26, 52, 104 |

None rewards a single heroic session, which is the behaviour that gets people hurt. Lifetime
volume counts working sets only; bodyweight work is priced at the weigh-in nearest before its
session, as the progress line is (§20.11), and a set nothing can price is left out and said
so, never guessed. A run milestone is earned in a week you trained: a forgiven gap keeps a run
alive, but nobody gets a milestone for a week they did nothing in.

**On screen.** Train carries one card — the run in weeks, what this week still needs, and the
month's skips — and never says a run ended; a new one simply starts. A milestone is celebrated
**once**: the newest unseen one, with "Plus N more" rather than a queue, so someone arriving with
a year of history gets one moment, not nineteen. *Got it*, *See all* or opening the list retires
them all. The list (`/train/achievements`) puts lifetime volume on the page with the biggest
thing it beats ("About 2.3 blue whales"), the last twelve weeks as marks (counted, forgiven or
easier, short), the aim, and the milestones with dates — only the next of each kind shows how
far there is to go. No locks, no confetti.

**The circle reads this too (§21):** `trainingStreak()` returns the full weekly history with
each week's days, aim and shortfall; the circle's planned sessions are these aims, and
`skipsCovered(history)` says how much of each short week the month's skips covered, which is what
hard mode charges by. One aim and one allowance for the whole app.
### 20.16 Something hurts: injury help (added 21 Oct 2026)

The last piece of the training coach (R4). An ache is the commonest reason a routine stops,
and the honest help is narrow: which of *these* exercises can stay, which need a change, which
should be swapped for something in your own library, and which left out until it settles. It
is not a diagnosis, a treatment, or a substitute for a doctor, and every part of it is built
so it cannot become one.

**Where it lives.** `/train/injury`, reached from "Something hurts?" on an exercise's screen
and from Settings. It asks about one routine (the one the exercise came from, or any other) or
about the single exercise when no routine has it.

**Red flags first, on the phone** (`core/redFlags.ts`). Before anything is sent — before
consent is even asked — the description is screened, deterministically, for the symptoms the
NHS and NICE say need a clinician: chest pain or pressure, trouble breathing, numbness around
the groin or changes in bladder or bowel control, symptoms in both legs, a blow to the head or
fainting, a sudden severe headache, skin turning blue, grey or cold, a joint out of shape, a
crack at the moment of injury (emergency); numbness, tingling or weakness, a possible break,
not being able to bear weight, a fall or accident, fever or a hot swollen joint, severe or
fast-worsening pain, heavy swelling, a pop or tear, a swollen hot calf, a racing heartbeat,
chest ache (today); pain at night or at rest, unexplained weight loss, a history of cancer,
osteoporosis (soon). English and Italian, accent- and typo-tolerant. Negation is honoured only
close to the symptom and inside the same clause ("no fever, but my foot is numb" is a numb
foot), and anything ambiguous counts: a false alarm costs a doctor's visit, a miss could cost
far more. A hit replaces the advice with what to do and how urgently, with emergency numbers
for Italy and the EU (112), the US (911) and Oman (9999). Nothing is sent.

**Consent, explicitly** (`services/injuryConsent.ts`). A description of an injury is health
data (GDPR Art. 9), and sending it to a model is a new flow, so it waits for an "I agree" that
says what goes where: the description and the names of the exercises asked about, to Kalib's
Worker and on to OpenRouter's model; nothing kept; history, weight and other data stay on the
phone. The agreement is versioned (`injury-v1`) — if what is sent ever changes, the person is
asked again — and withdrawn from Settings → Injury help. The Worker refuses a request without
the current version in an `x-kalib-consent` header.

**What is sent** (`core/injury.ts`). The description (≤ 400 characters) and, per exercise
(≤ 16): a short ref ("1", "2"), its name, its muscles, its equipment, and up to eight
alternatives from the person's own library — same main muscle, strength only, not already in
the routine, spread across equipment because the useful swap around a sore joint is usually
the same movement with a different implement. No ids, no history, no body data, no routine
name.

**What comes back, and what of it is believed.** A strict JSON schema: `needs_doctor`, a
one-line summary, and per ref one of keep / modify (with the change) / swap (with a name) /
skip. The answer is copied field by field; unknown refs, repeats and unknown actions are
dropped. A swap is believed only when it names an exercise in the library — exactly, or
near-exactly among the offered alternatives — and never the same lift or one already in the
routine ("Barbell Bench Press" may not quietly become the incline). An ungrounded swap becomes
"leave it out", still showing what was suggested. The whole answer is screened for red flags
again, plus the language of a diagnosis ("could be a tear", "seek urgent care", "call 112"),
with conditionals read as cautions ("if you feel numbness, stop" is fine). Any hit, or
`needs_doctor`, and the advice is withheld.

**Applying it.** "Swap" puts the new exercise where the old one was, keeping its sets, rest,
superset and note (a rep range is dropped for a timed exercise), with Undo. It refuses if the
routine changed since the advice was given.

**The Worker** (`worker/injury.ts`, `POST /api/coach/injury`). Order matters: method, origin,
session (401), the household allow-list, the consent header — all before the body is read —
then a per-user rate limit, a 20 KB cap, field-by-field validation, and the red-flag screen
again (an old client or a hand-made request still cannot get advice for an emergency, and a
red-flag answer is free: no quota, no model). Then its **own daily pool, 5 per person and 20
in total** (`INJURY_DAILY_USER`, `INJURY_DAILY_TOTAL`), apart from the estimate pool, and the
text model with `max_tokens` 1000 and temperature 0.2. The description is JSON-quoted in the
prompt so it cannot speak for itself, and the prompt forbids diagnosing, naming conditions,
medication, and training through sharp pain. Nothing is logged, nothing is stored (KV holds
two counters keyed by date and user id), and an upstream error is reported by status only,
because an error page may quote what it was sent. Worst case at the caps: about 600 calls a
month at roughly 2 k tokens in and 0.7 k out — a few tens of cents, inside the €1 ceiling.

**One helper for every paid call** (`worker/openrouter.ts`). The OpenRouter request was
written out five times (estimate, label, menu, suggestions, recipe links) and had begun to
drift — one copy parsed the reply unguarded, so a non-JSON body threw instead of answering
502. Each endpoint now owns its prompt, schema, budget and name; the call, the parsing and the
failures are one function.

*Not built, on purpose:* exercise prescription for rehabilitation, pain scores tracked over
time, and anything that would make the app the place an injury is managed rather than worked
around.

### 20.17 The week: training days, the cycle, and a routine read before it is started (added 22 Oct 2026)

Four things the owner found missing once routines existed: nowhere to say which days you train,
nothing that knew what each of those days was, a routine that started the moment it was
touched, and no swipe to delete one. And Train itself read as a list of lists.

**Two choices, everything else derived.** You choose **the days** (Monday, Wednesday, Friday —
or "three a week, any days", or Auto) and **the cycle** (your routines in the order they come
round). Both are synced settings, kept apart (`training:plan`, `training:cycle`) so a change of
days on one phone and a change of cycle on another both survive last-write-wins sync. From them
the app derives the routine on every upcoming day, where a missed day's routine goes, and —
because the days are the one number of the app's training — the streak's weekly aim (§20.15),
through it the circle's planned days (§21), and the weekdays the energy bridge leans toward
(§20.7). Choosing Monday, Wednesday and Friday sets the aim to three *from this week*; the aims
history keeps weeks already over as they were. With no fixed days the bridge goes back to
inferring weekdays from behaviour; Auto hands the aim back to §20.15's reading of your weeks.
Someone who set an aim before days existed has it read as a count, so nothing they chose is lost.

**The cycle is laid onto the days; the days do not own routines** (`core/schedule.ts`). Monday
is not "chest day". Monday is the next training day and gets whatever is next in the cycle, so
a missed Monday moves Chest & Tri to Wednesday rather than skipping it — §20.10's rotation rule,
which is the right one for training — and the calendar ahead simply follows. The schedule says
so when it happens: "Missed Monday? Chest & Tri moves to today."

**A routine may come round more than once.** The owner's own week is the test: four routines
(Chest & Tri, Back & Bi, Legs, Shoulders & Tri) meant as push, pull, legs with the push day
alternating, on Monday, Wednesday and Friday. In list order that runs push-pull-legs-push, the
second push straight after legs and pull once for every two pushes. What is meant is the
six-slot lap Chest & Tri, Back & Bi, Legs, Shoulders & Tri, Back & Bi, Legs, which lands as Mon
C&T, Wed B&B, Fri Legs, Mon S&T, Wed B&B, Fri Legs. So a cycle is a list of routine ids that may
repeat, and the rotation's position is read from the run of sessions before the last one (Back
& Bi after Shoulders & Tri is slot five, not slot two) — `cyclePosition` in `core/rotation.ts`,
a strict generalisation of §20.10 that gives the same answer whenever nothing repeats.

**The app offers that lap rather than making you build it.** Each routine is classed by where
its sets go (primary muscles, a 60% majority for push, pull or legs; upper and full body
otherwise). When one kind has more variants than the others and they line up into whole laps,
the schedule offers the alternating cycle ("Alternate your push days?") with one button. It
never applies it unasked, and offers nothing when routines cannot be classed or the variants
would not line up — a guess there is worse than the list.

**The cycle follows the list until edited, and edits follow the list's changes.** Never edited,
it is the routines in list order, each once. Edited, it keeps your slots minus any routine since
deleted (everywhere it appeared) plus any routine created since, at the end. A routine you took
out on purpose stays out: the stored cycle remembers which routines existed when it was last
edited, which is what tells "left out" from "new". The editor is one row per slot and a sheet
per row (MASTER: one control per row) — move earlier, move later, add again, take out — each
with Undo, and "List order" puts it back.

**A routine is read before it is started** (`/train/routines/:id`). Tapping one opens its page:
the size on the background (exercises, sets, an estimate to the nearest five minutes — work
40 s a set, the routine's rests, a superset resting once per round, a minute's changeover per
exercise), the muscles it works by sets, and each exercise with its target and rest, what to aim
for next time (§20.8, worded "Aim", because the page is read days before the routine comes
round), last time's sets as a lifter says them ("80 kg × 8, 8, 8") and its best. Start is at the
bottom where a thumb is; while a workout runs it says Carry on, or names the other workout that
is still running. Edit is a pencil in the corner. The Today card's Start still starts directly,
because pressing Start is the decision.

**Swipe left to delete a routine**, as everywhere else in the app, with Undo. The routine's
slots in the cycle come back with it.

**Train, laid out.** Figures on the background as before, now "1 of 3 training days" with fixed
days, and under them the seven days drawn as circles — done filled, training days ahead tinted
in training's blue, today ringed. A missed day is drawn as a plain training day and nothing
more: its routine has moved on, and a red mark would be the reckoning §20.15 refuses. Then one
card that answers what to do today — the routine, its muscles, its size, the first four
exercises' pictures, Start and View — reading Today, Done today or Rest day from the schedule
(Up next and Next time from the rotation without fixed days, unchanged from §20.10). Then the
days coming up, the plan in one row (or "Choose your training days"), three small doors — the
run, the body map, the circle — and the routines as rows worth reading: a picture, what they
work, how long they take, when they last ran, and a tag for the day they are next on.

*Not built, on purpose:* routines pinned to weekdays ("Monday is always chest"), which breaks
the moment a day is missed; and an automatic reshuffle of the cycle when routines change, beyond
dropping deleted ones and appending new ones — the app suggests, the person decides.

### 20.18 Balance: what the routines train, and the fix (added 22 Oct 2026)

§20.8's coverage reads the week you trained. This reads the week you **plan**: the routines
themselves, before a set is logged. Someone who has just written four routines wants to know
now that none of them trains a hamstring, not after a month of finding out. Screen:
`/train/balance`, reached from Train.

**Counted as coverage counts** (`core/balance.ts`). Planned working sets per muscle: once for the
muscle an exercise aims at, half for each that assists (`SECONDARY_WEIGHT`), the same 10–20
band (`MIN_SETS`/`MAX_SETS`), held only against the muscles Build-a-week programs on purpose
(`PROGRAMMED`). Forearms, traps, lower back, adductors, abductors, obliques and neck are shown
under *Also counted* and never chased. Each routine counts as often as it comes round
(`Frequency`, a map of routine id to times a week); until the week has days attached, that is
once each. Unknown exercises are reported, not dropped. A muscle in range but trained on one
day only says so ("All on one day"), since frequency is the part the evidence is clearest on
(§20.9).

**The shoulder's three heads.** The library files every shoulder movement as one muscle, which
hides the commonest imbalance there is: a week of pressing and no rear-delt work. The head is
read from the name (`deltHead`: reverse fly, face pull, rear lateral raise → rear; lateral raise,
upright row → side; press, front raise, push-up, dip → front). An unnamed movement goes by what
leads it: a chest or triceps lift is front-delt work, a back lift rear-delt work, anything else
is spread over all three rather than guessed.

**Pairs** (`PAIRS`), each with a loose threshold, because no trial has set an ideal ratio of
weekly sets between opposing muscles: push vs pull (pull ≥ 80 % of push, after Cools et al.,
*Br J Sports Med* 2014, on scapular balance), quads vs hamstrings (hamstrings ≥ half, after the
0.5–0.8 H:Q strength ratios in Coombs & Garbutt, *J Sports Sci Med* 2002), front vs rear delts
(rear ≥ half), chest vs upper back (≥ 70 %), biceps vs triceps (each ≥ half). They flag a week
that has plainly forgotten a side, not one that is a little lopsided.

**The fix — the part no tracker does.** Gaps are ranked: never trained, then a forgotten side of
a pair, then under the band, furthest first (`deficits`). Each gets one concrete edit to one
routine (`suggestFixes`, at most five):

- *Where:* the routine whose existing work is closest to the muscle (a leg curl goes on leg
  day; a rear-delt fly on back day, whatever the library files it under), else the shortest.
- *What:* a strength movement aimed at the muscle (or head), never one already in that routine
  or already suggested, from the kit the routines show you have (a barbell, cable or machine
  means a gym; otherwise only what is in use, plus the floor). Named staples first (§20.9's
  `STAPLES`, plus rear-delt staples), then one using equipment already in that routine, then
  the simplest. Advanced, boxing and non-strength movements are never offered.
- *Add or swap:* added, prescribed exactly as Build-a-week would (`prescriptionFor`), with sets
  sized to the gap and the routine's frequency (2–3). Swapped instead when the routine is full
  (`MAX_EXERCISES_PER_DAY` exercises or `MAX_ROUTINE_SETS` = 24 sets) or when an exercise in it
  is pure surplus — its muscle stays inside the band without it and is over the band with it.
  A swap keeps the slot's sets, rest, superset and note, and never takes a muscle out of the
  band; its assisting muscles may not fall out either.
- Each fix is planned against the routines as the earlier fixes leave them, so the "after"
  figures are what applying them in order really gives, and two fixes never fight over one
  routine's last slot.

Every fix shows why ("Rear delts under half your front-delt work."), what goes where, and the
before and after in sets a week — for a pair, of the short side ("Pulling 16 → 18"); for a
swap, also what the outgoing muscle keeps. *Apply* writes it to the routine with Undo
(`services/balance.ts`), and refuses if the routine has moved on since.

**The body map** (`components/bodyMap/`). Front and back, filled by planned sets in four steps —
none, 1–4, 5–9, 10+ — of `accent` mixed into the untrained grey, so "some" and "none" are two
different things rather than two dimnesses. Over the band is drawn as full, not louder. The
front view's shoulders show front and side heads, the back view's rear and side, so a pressing
week fills one and not the other. Abductors have no surface on the figure and are listed only.
The map is a picture, not a control (`role="img"` with a sentence naming what is trained, what
has some work, and what has none); tapping a muscle in the list outlines it on the body.
`BalanceCard` is the compact version for Train; `RoutineMuscles` draws one routine alone.

*Anatomy source:* the paths are from **react-native-body-highlighter** v3.2.0 (male figure),
MIT, © 2022 ELABBASSI Hicham — copied with its licence into `components/bodyMap/anatomy.ts`,
not added as a dependency (it targets React Native). One change: its back view draws the lats
and the shoulder-blade muscles as one "upper-back" part; they are split, the lat being the
longest shape on each side, because Kalib counts them as two muscles. wger's muscle images were
rejected for CC BY-SA, which would not sit inside this MIT repository.

*Not built, on purpose:* sets increased on an exercise already there (a fix is always a
movement, so it can be seen and undone as one), and any balance between the left and right
sides, which planned sets cannot see.
### 20.19 The exercises a gym actually does (added 21 Oct 2026)

**The complaint:** "pec deck" and "incline dumbbell press" seemed to be missing. Neither was.
The pec deck was in the library as "Lever Seated Fly", findable only by someone who already
knew to type that. The incline dumbbell press was there as "Dumbbell Incline Bench Press", and
the search for it was typed "incline dumbell press": one letter short, so the word matched
nothing, and a search that requires every word to land returned nothing at all. Both failures
were ours. A few movements really were missing — the face pull, the barbell hip thrust, the
pendulum squat, a rowing machine.

**The catalogue.** `data/exercises-curated.json` names the exercises people actually do —
276 of them — the way a gym names them, and `core/exerciseCatalogue.ts` lays it over the
library when the seed is built:

- **244 library rows curated, 211 of them renamed in place** (the rest, "Push-Up", "Plank",
  were already called what a gym calls them). The id never changes, so every routine and every
  logged session that points at one keeps working. The textbook name stays searchable: it is kept as an
  alias, and typed in full it still names the exercise outright. A rename may correct the
  library's muscles where they are wrong for counting volume — it files the back squat, the leg
  press and the hack squat under glutes; they are quads-first, glutes second.
- **32 added**, under ids of their own (`library:kalib-face-pull-cable`), with instructions
  written for Kalib. They have no demonstration yet and say so — "No demonstration for this one
  yet" — rather than showing an empty square. Media is a separate decision (the user finds the
  current animations below the bar, and a better source is being evaluated).
- **All 276 are `popular`.** Browsing the picker lists them (and anything you have used or made
  yourself) and nothing else until "Show N more variants". Search ranks them above an obscure
  variant that matches as well, by a fixed boost smaller than typing a name in full, so "fly"
  is the chest fly and not "Cable Incline Fly (on Stability Ball)", which is still found when
  asked for by name.

**Naming convention: movement first, implement in parentheses** — "Bench Press (Barbell)",
"Incline Bench Press (Dumbbell)", "Lat Pulldown (Cable)", "Pec Deck (Machine)". Movements of
the body alone take no parentheses: "Pull-Up", "Push-Up", "Plank". It is the convention Hevy and
Strong use, so a program read in either reads the same here, and it sorts a list by movement
rather than by equipment, which is how a lifter scans one. The library's other ~1,150 rows keep
their textbook names; they are variants, found by search.

**Shorthand has one owner.** Over 1,000 phrases ("rdl", "ohp", "pec deck", "skullcrusher",
"incline db press") each name exactly one exercise. The build fails on a phrase claimed twice,
on a phrase that is another exercise's whole name, on two exercises with one name, and on a
rename pointing at a row that is not there — all listed at once. A unit test runs every phrase
through the real search and requires its exercise first.

**Typos are corrected against the catalogue's own words**, not scored fuzzily per row. A word of
five letters or more that is not a word of the catalogue becomes the commonest word one letter
away (wrong, missing, extra or two swapped), so "incline dumbell press" *is* "incline dumbbell
press", decisive full-phrase match included. An earlier word that only starts a real word was
cut short ("barbel row" → "barbell row"); the last word is left as a prefix, because it may
still be being typed. Short words are never touched: "row" one letter off is "raw".

**Upgrading a phone.** The exercise seed goes to version 2. The library is replaced by id, the
user's own exercises are untouched, and routine rows that still carry an exercise's former name
are renamed to match — recognised by the former name being among the exercise's aliases, so it
needs no record of what the names were and is safe to re-run if the first launch was cut short.
A row someone named themselves keeps its name. **Logged sessions keep the names they were logged
under**: they are a record of what was done. Build-a-week's staples (§20.9) are named by display
name, and a test checks each one exists in the shipped library.

*Not done:* demonstrations for the 32 additions; the library's muscle filing beyond the clear
errors above; a "Popular" badge in search results.

---

## 21. The circle (added 21 Oct 2026)

R6 of the training plan: friends, a board, and hard mode. It is the first feature in which
anything of one person's reaches another, so most of this section is about what does not.

### 21.1 Shape

A **circle** is a private group of up to twelve people. There is no public board, no search,
no follower graph and no open sign-up to a circle: the only way in is a code from its owner.
A person may be in up to five circles and chooses a display name in each; the email is never
shown to anyone. Reached from Train → Circle (`/train/circle`).

### 21.2 What crosses between people

Per person per week, and nothing else:

| Field | What it is |
| --- | --- |
| `planned` | That week's aim in training days (1–7): the run's aim (§20.15), as it was then |
| `done` | Days that week with a finished session holding a working set (0–7) |
| `consistency` | `done` against `planned`, 0–100, capped at the plan |
| `progress` | Relative strength against their own month before, 0–100; absent without history |
| `score` | The week's score, 0–100 |
| `flagged` | How many session bests the honesty check left out |
| `hard`, `rating` | Whether hard mode was on, and the rating if so |

These are computed on the phone (`core/circle.ts`) and published as integers. No set, lift,
weight, food, note, session date or bodyweight leaves the phone, and the server functions have
no field to put one in: `circle_publish` refuses any key outside this list and every value is
range-checked by the table. Twelve weeks are kept; older ones are deleted on the next publish.

**Opt-in by construction.** Nothing is published until you are in a circle — the client does
not try and the server refuses. Leaving your last circle, being removed from it, or deleting
the account deletes everything you published.

### 21.3 The score, and why it cannot be won by being big or by lying

Every number in a training log is self-reported, so a board ranked on weight lifted rewards the
heaviest person and the least honest one. This one ranks on two things anyone can do well at
any size or level:

- **Showing up — 60%.** Days trained against your aim for the week. The aim is the run's
  (§20.15) — one number in the app, set or read by Auto on the run's screen, and never rewritten
  for a week already over — and days are counted exactly as the run counts them: two sessions on
  a day are one day, a session with no working set does not count at all, and going over the aim
  earns nothing extra. A rotation is not a calendar (§20.10), so the aim is a number per week,
  not named days. **An easier week (§20.12) short of the aim scores 100**: taking one is
  following the plan, which is why it never breaks a run either. The week in progress is shown
  against the whole week's aim.
- **Getting stronger than you were — 40%.** For each loaded lift trained in both windows, the
  best estimated 1RM of the last 28 days against the best of the 28 before; summed; each sum
  weighted by the **DOTS** coefficient for the bodyweight at the end of its window
  (`core/dots.ts`, constants from OpenPowerlifting, tested against its published results).
  Holding steady scores 50; +2.5% a month scores 100; −2.5% scores 0. DOTS is what makes a cut
  that holds strength count as the gain it is. Without a profile or weigh-ins the comparison is
  in raw kilograms, still against yourself. Easier-week sessions (§20.12) are left out.

A week with no progress figure scores on consistency alone, not consistency halved. The board
ranks the mean of the last four whole weeks; the week in progress is shown but not ranked (on a
Tuesday it would rank whoever trains on Mondays). **Weeks before your first session are not
published**, so someone who joins on day one is ranked from the week they started rather than on
a month of zeros before it. From then on every week is published each time, so a whole week with
nothing published counts as nothing done; ties share a rank.

**Honesty without accusation.** A session best more than 15% + 7.5 kg above the best accepted
before it, or above 500 kg, is left out of the score — not reported, not shown to anyone. If a
later session lands within 5% of it, both count: a real step up repeats, and a typo almost
never does. Only upward jumps are screened; a number too low hurts nobody's rank but its
owner's. The person sees "one session best is left out until a second session matches".

### 21.4 Hard mode

Off by default, per person. Each whole week from the first Monday on or after switching on is a
match against that week's aim, scored by the share of it you met, on an Elo curve:
`R ← R + 32·(outcome − 1/(1 + 10^((1000 − R)/400)))` from 1000. The better the record, the
less a full week adds and the more a miss costs — which is the whole of hard mode — and no week
moves the rating by more than 32. Switching off forgets the rating.

**The skips are the run's.** There is one allowance — three training days short a month, the
month being the one the week's Thursday falls in (the ISO rule, so a week is never split), not
rolling over — and it is charged in date order to every short week, hard mode or not. So
"2 of 3 skips left in October" on Train is exactly what hard mode has left, and days short
before hard mode came on that month were already spent. A week's outcome is
`min(1, (days + days covered) / aim)`, so a week short by more than what is left loses only the
uncovered part (`skipsCovered` in `core/streak.ts`).

**An easier week short of the aim is not judged**: it costs nothing, and since it was not a test
of keeping the aim it earns nothing either; the rating carries over it unchanged. One that met
the aim anyway counts like any met week. The week in progress is never judged. Hard mode starts
judging from the first week there is a session in; a week before anyone has trained at all has
no aim to be measured against.

**Settings.** The circle keeps one setting of its own, `hard_since`. The aim lives with the run
(`training:weekly_aim`); a `commitment` stored by the first build of the circle is ignored and
dropped on the next write.

### 21.5 Server

`supabase/migrations/0009_circle.sql`: five tables (`circles`, `circle_members`,
`circle_invites`, `circle_scores`, `circle_join_attempts`), none in `SYNC_TABLES`. Row-level
security is on with **no policies**, and every privilege is revoked from `anon` and
`authenticated`, so no client can read or write a table directly. The client surface is ten
`security definer` functions with `search_path` pinned, executable by signed-in users only:
`circle_mine`, `circle_create`, `circle_invite`, `circle_revoke_invites`, `circle_join`,
`circle_leave`, `circle_remove`, `circle_rename_me`, `circle_publish`, `circle_board`. Board
rows carry a per-circle member id, never an account id.

**Invites.** Ten characters from 31 that cannot be misread (no 0/O, 1/I/L), drawn by rejection
sampling from `gen_random_bytes`, ~50 bits; stored only as a SHA-256; seven days; one live code
per circle (making one retires the last); revocable; twenty joins at most. A failed join
returns null rather than raising, so the attempt is recorded — an exception would roll the
record back — and ten failures in an hour lock that account out of joining for the hour. The
error does not say whether a code expired, was revoked or never existed.

**Ownership** passes to the longest-standing member when the owner leaves or deletes their
account; an empty circle is deleted with its invites.

**Publishing** happens on opening the circle, after creating or joining one, and after a sync
at most every six hours (`publishInBackground`), never outside a circle.

**Tested** in `scripts/circle-sql.test.ts` against a private PostgreSQL started for the run
(`scripts/pg.ts`, with Supabase's `auth.uid()` and default grants shimmed): the migration runs
after 0001–0008 and twice over; catalogue checks for RLS, privileges and `search_path`; and the
attacks — direct table reads, anon calls, outsiders on the board, guessed, expired, revoked and
used-up codes, the throttle, smuggled fields, out-of-range values, partial batches, removal,
ownership hand-over and account deletion. The live part skips where PostgreSQL is not installed;
the static part runs everywhere.

**To turn it on:** run `0009_circle.sql` in the Supabase SQL editor. Nothing else is needed;
there is no new secret and no Worker change.

---

*Not medical advice. Targets are general-population formulas. If any medical condition
or medication applies, they should be reviewed by a clinician.*

---

## 22. Units: metric or US (added 21 Oct 2026)

One switch, **Settings → Units: Metric / US**, changes every measurement the app shows or
accepts. Onboarding asks it first, above the first number it asks for.

**Storage never changes.** Weigh-ins stay kilograms, waists and heights centimetres, water
millilitres and food grams, in Dexie and in Supabase alike. Only the display and the number pad
convert (`core/measure.ts`, the one module that knows both systems). The Kalman filter, the
TDEE, every target and every sync row are computed on numbers that have never changed unit.
The definitions are the exact legal ones: the international pound (0.45359237 kg), the inch
(2.54 cm), the avoirdupois ounce (a sixteenth of the pound) and the US customary fluid ounce
(231 in³ ÷ 128 = 29.5735… ml).

**What converts, and to what precision (§2.4):**

| Measure | Metric | US | Notes |
|---|---|---|---|
| Body weight, trend, goal | kg, 0.1 | lb, 0.1 | Stored unrounded: 180 lb is 81.6466266 kg, so it reads back as 180, not 179.9. |
| Weekly rate | kg/week chips | lb/week chips | US chips are ½, 1, 1½, 2 lb (bulk ¼–1 lb), not 0.25 kg shown as 0.55 lb. A stored rate that matches no chip says "Now 1.1 lb a week". |
| Waist | cm, whole | in, 0.1 | A centimetre tape is good to ±0.2 in; one decimal is the most it supports. |
| Height | cm | ft + in, whole inches | Typed as two fields; 71.9 in reads 6 ft 0 in, never 5 ft 12 in. |
| Water | ml / L to 0.1 | fl oz, whole | Presets 8/12/16/20/24 fl oz; the default glass is an 8 oz cup (237 ml). Logged in whole ml, so 8 oz reads back as 8. |
| Food amounts | g | oz, 0.1 below 100 | Diary, favourites, amount sheet (opens in oz / fl oz), recipes, cooking, batches, estimates, menus, the plan. |
| Shopping | g / kg, price per kg | oz / lb, price per lb | Pack weights typed in ounces. Prices stay stored per kilo to the cent; every per-pound price to the cent survives the round trip. |
| Gym loads | kg | lb | Follows the switch, with an override (below). |

**What stays metric in both:** energy (kcal) and macros and micros (grams) — US labels print
grams and so does every US macro tracker, because targets are written that way; the nutrition
label pages ("per 100 g", the per-serving column); supplement doses; the CSV export, whose
headers already name the unit (`weight_kg`, `ml`).

**Round trips.** Everything that opens on a stored value keeps that value until it is typed
over: the weigh-in pad, the profile's height and target, an entry reopened in ounces (250 g
shows as 8.8 oz, and saving it untouched writes 250 g, not 249.5 g), the recipe and cooking
pads. Moving a meal to dinner must not shave half a gram off it; resaving a profile must not turn
178 cm into 177.8. In grams the pads always meant what they showed, rounding included, and
still do.

**The default, and why it is written down.** Until it is chosen, the units follow the market
(§19's `chain_market`): the US market guesses US, every other market metric. The guess is
written to the setting on first run, because the market follows the phone abroad — a week in New
York must not quietly turn a metric person's weigh-ins into pounds.

**The gym's override.** Plates are physical: plenty of US gyms load kilo plates and plenty of
European ones have pound dumbbells. So Settings → Training keeps one control, *Gym weights: As
the app / kg / lb*. Before §22 the gym had its own kg/lb switch; someone who had set it to pounds
keeps pounds at the bar on update (the old `weight_unit: 'lb'` reads as the override), and their
body weight stays in kilos, so nothing they see changes. An old `kg` was the default anyone
could have tapped back to, so it follows the app.

**Reminders.** The phone's day report carries `us_units: true` when it shows US units, and
the Worker's evening nudge then says "47 fl oz of water" rather than "1.4 L". Only a literal
`true` is kept; an older phone that never sends it gets litres, as before.

**How others do it (surveyed 21 Oct 2026).** Hevy sets weight, distance and body measurements
separately under Settings → Units, and lets a single exercise override the weight unit — the
precedent for the gym override here. MacroFactor lets you favourite up to two weight and two
volume measurements for food logging. Cronometer remembers the last unit used for each
biometric and carries ounce servings on its foods. Kalib takes one switch for everything
(what a person actually wants: "I'm American"), plus the one exception the gym genuinely needs.
Per-measure overrides beyond that were left out: each one is a setting most people never
touch and a combination nobody tests.

