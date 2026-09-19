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

Mode is switchable at any time and must be switchable **on a schedule** (the user needs
an automatic switch to MAINTAIN on 24 Dec 2026 and back to CUT on return).

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

**The number pad must be custom**, not the iOS keyboard. Keyboard summon/dismiss alone
costs 1–2 seconds and is the single biggest avoidable latency in the whole app.

### 8.1 The repeat-meal mechanism (most important feature in the product)
Any log entry can be saved as a named custom food with one tap. Any photo estimate can be
corrected once and promoted to a custom food. Over ~3 weeks, the user's real rotation —
their gyro, their Deliveroo order, their batch lunches — becomes a set of one-tap,
high-confidence entries. **This, not the photo AI, is the actual solution to eating out.**

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

**Mandate:** all camera use goes through the native file/camera picker
(`capture="environment"`). Barcode scanning takes a still image and decodes it
client-side (ZXing-js or equivalent) rather than running a live video scanner. Slightly
less slick; dramatically more reliable. Note also that Safari does not support the
`BarcodeDetector` API — a JS decoder is required regardless.

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
- **Cold start:** interactive in <1.5s on a mid-range phone over 4G.
- **Privacy:** this is health data. Single-user for now. **Before any multi-user
  release, GDPR Article 9 (special category data) obligations apply** — explicit consent,
  lawful basis, retention policy, export and erasure. Treat opening this up as a gated
  decision, not a feature flag.
- **Data export:** CSV export of all log entries and weigh-ins from v0. Non-negotiable —
  the user must never be locked into their own app.
- **Testing:** unit tests on every formula in §3, §4 and §5. These are the product. Seed
  a synthetic 90-day dataset with known ground-truth TDEE and assert the engine recovers
  it within the stated confidence interval.

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

*Not medical advice. Targets are general-population formulas. If any medical condition
or medication applies, they should be reviewed by a clinician.*

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
