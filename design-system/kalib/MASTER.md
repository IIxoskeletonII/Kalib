# Kalib design system — MASTER

Source of truth for every screen. Page files in `pages/` override this; none exist yet.

Skills consulted (installed under `.claude/skills/`): Anthropic `frontend-design` (avoid
templated defaults), `impeccable` (craft floor, Operate-mode rules), Vercel
`web-design-guidelines` (a11y/UX audit), `ui-ux-pro-max` (touch, motion, contrast rules).
Their verdict on the first pass, and what changed: tracked-caps eyebrow labels, middle-dot
meta strings, the identical-rounded-card kit, the sparkline-as-decoration and Inter were all
generic tells. They are gone.

## Mode and direction

**Operate**, with the owner's brief pinned on top (19 Sep, pass 3): *"incredibly aesthetic,
minimalist, professional, buttery smooth"* — the Dribbble health-app register. The brief wins
over the rulebooks' defaults where they conflict: soft elevated cards, a gradient ring with a
glow, tinted icon discs, a raised centre action button, count-up numbers and eased fills are
all deliberate here. What stays from the rulebooks: one typeface, one accent, no eyebrow caps,
no decoration that carries no information, ≥ 4.5:1 text, 44 pt targets, reduced-motion.

Direction: **soft precision**. Deep neutral dark (#0C0D10) or warm off-white (#F6F6F4); white
cards with a soft 30 px shadow; mint→sky gradient on the ring; pastel macro identities.

## Tokens (`src/index.css`)

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | #0C0D10 | #F6F6F4 | page |
| `surface` | #16181D | #FFFFFF | cards, sheets |
| `surface-2` | #1F2229 | #EEEEEA | controls, keys, tracks |
| `surface-3` | #2A2E37 | #E2E2DD | pressed |
| `line` | rgba(255,255,255,.07) | rgba(21,22,25,.08) | hairlines |
| `ink` / `ink-2` / `muted` | #F5F6F8 / #C9CDD4 / #8F95A0 | #151619 / #3D4147 / #5D6470 | text roles |
| `primary` / `on-primary` | #F5F6F8 / #0C0D10 | #151619 / #FFFFFF | primary buttons, selected day, centre action |
| `accent` → `accent-2` | #5EEAD4 → #38BDF8 | #0B7D6F → #1E63A8 | ring gradient, active states, sparkline; `accent-2` alone is water |
| `kcal` `protein` `fiber` `carb` `fat` | #F5B74A #7DB9FF #7EE0A4 #C4A7FF #FF9AA8 | #8F5A06 #1E63A8 #22753E #6B45C4 #C22D49 | macro identity only |
| `danger` | #FF7B74 | #B8312B | destructive |

Every text pair ≥ 4.7:1 (verified). Theme follows the system; Settings can pin dark or
light; `theme-color` follows `--bg` at runtime.

## Typography

**Plus Jakarta Sans** (variable 200–800, self-hosted latin subset, `tnum`). One family. Roles:

- Large title 34/1 800, tracking −0.03em, with a 14 muted line above (date / context)
- Display 48/1 700, tracking −0.03em — the hero number only
- Tile value 24 700 · Sheet title 22 700 · Section heading 17 700
- Body 16/1.45 400–500 · Secondary 14 · Meta 13 muted · never below 11 (week strip initials)

Numbers are always `tabular-nums`. Units get a thin space (`150 g`). No caps, no tracking on
labels, no eyebrows above headings, no middle dots in meta — commas and full words.

## Spacing, shape, depth

4-pt scale. Page gutter 16, section gap 28, card padding 16–24. Radii: card 24, key 12, every
control and chip a pill, sheet top 32. Depth: `.card` = one soft shadow (`--card-shadow`), FAB
and sheet shadows; nothing else. Icons sit in 32–40 px tinted discs (`bg-<tone>/15`).

## Page structure

Numbers sit on the page; cards are for things you tap. Today is: the day's numbers set
directly on the background (big figure, budget bar, four macro columns, two lines of small
print) → one row of three check tiles → food → context. One tier of cards in the first
viewport, never a stack of equal cards as the page skeleton, and no ring, sparkline or
metric card standing in for content.

## Touch, states, motion

Targets ≥ 44 pt; keys 60 pt. Press = scale .97 + surface step. Visible `focus-visible` ring.
Disabled = 40 % opacity. Motion: `--ease-out-soft` (0.22,1,0.36,1) for arrivals, `--ease-spring`
(0.32,0.72,0,1) for sheets (320 ms). Four authored moments, and only these: the hero figure
rolls like an odometer (each digit slides, 700 ms); the tab-bar pill morphs between tabs
through the View Transitions API (320 ms spring, root cross-fade switched off so it never
stacks with the 220 ms screen rise); list rows and rail tiles rise in staggered 35–40 ms
apart (`.rise-in`, 260 ms, capped at eight); a value changed by a tap pops (`.pop`, 360 ms
spring). Bars ease 700 ms. Reduced-motion zeroes all of it. Skeletons for loading, never
spinners.

Arrival animations use `animation-fill-mode: backwards`, never `both`: a transform that persists
after the animation makes that element the containing block for every `position: fixed` sheet
inside it, which then stops at the tab bar instead of covering it.

Checklists (supplements): a 28 pt circle, 2 pt `surface-3` ring when open, `accent` fill with a
3 px check when done; the row's text drops to `muted` but never strikes through. Quick-add
actions that repeat (water) are a 48 pt filled circle at the card's right edge; the rest of the
card opens the detail sheet.

"Log again" tiles are 156 pt cards in a horizontal rail; a batch tile leads with the chef-hat
glyph in `accent` and carries its portions-left line in `accent` — the only place a rail tile
uses colour, because it is a count that changes.

Swipe rows: 84 pt panes, `danger` on the trailing side with a drawn trash glyph, `accent` on the
leading side with its verb; a full swipe commits and the row collapses in 200 ms; an Undo toast
(`primary` pill above the tab bar, 5 s) replaces confirmation dialogs for everything that can be
restored. Cards clip their content so a swiped row keeps the corner radius.

The planner deck (§18): one card at a time, dragged with rotation (dx/18°); the verdict
stamps ("THIS WEEK" in `accent`, "NOT THIS WEEK" in `surface-3`) fade in with travel; commit
past 110 pt flies the card off in 220 ms. Two round buttons under it repeat the gesture for
thumbs that prefer taps: `surface` for no, `accent` for yes.

Provenance meters (§7.4) sit inside the ring card under the stats: label, percentage, a 4 pt
bar toned `accent` ≥ 85 %, `kcal` ≥ 60 %, `fat` below. Tone here is information, not decoration.

## Icons

Lucide, 2 px stroke, 22 px in icon buttons, 24 px in the tab bar, `aria-hidden` beside text,
`aria-label` on icon-only controls.

## v0.20 surfaces (30 Sep 2026)

Twelve features landed before this file was consulted, and the audit that followed found nine
drifts. They are fixed; the rules they broke are written down here so the next pass has them.

**Precision follows the instrument, not the component.** §2.4 is a UI rule, not only a data one.
The scale reads to 0.1 kg and its trend resolves hundredths of that; a tape measure reads to the
centimetre and nothing finer. A shared `signed()` helper hard-coded to two decimals printed
"−3.00 cm", which claims a precision no tape has. Any formatter shared across units takes its
decimals from the unit.

**A page header describes what is on the page.** The trend screen's eyebrow said "Smoothed
weight" while showing the waist series, which is explicitly not smoothed. Eyebrows, units and
empty-state copy all follow the selected series.

**Numbers first, then the decision.** The week in review opened with a full-height diet-break
card, pushing the week's own headline below the fold on a screen named for that week. Cards are
for things you tap and they sit *after* the figures they are about. This is the §"Page
structure" rule applied to a screen that is mostly prose.

**One row, one rhythm.** A list row's primary text never truncates to make room for a badge: the
badge moves to the meta line. If the meta line then cannot fit, the fix is to carry fewer
numbers, not to clip a value. The menu row dropped fiber for exactly this reason — calories are
already the right-hand column and protein is the other number that decides an order.

**Say it once.** The logging card printed the same count in two consecutive sentences because a
summary line and an explanatory line were written independently. Copy that sits together is read
together.

**No spec references in the interface.** "the §4 engine" reached a user-facing paragraph. Section
numbers are for SPEC.md and source comments.

**Reuse the mark.** A tick means one thing in this app: a 28 pt circle, 2 pt `surface-3` ring when
open, `accent` fill with a 3 px check when done (`DailyChecks`). Two new checkboxes had invented
their own square and their own fill colour; both now use the checklist mark.

**New lists arrive like old lists.** `.rise-in` staggered 40 ms apart, capped at eight, on any
list that appears after an async step — the menu dishes and the imported ingredient lines were
static while the identical list on the estimate screen animated.

Two conventions the audit confirmed rather than changed: `A · B` is a legitimate separator inside
a data line (the Refuse entry is about eyebrow meta, not compact figures), and a `Spinner` inside
a button is the busy state for a network call, distinct from the skeletons that stand in for
loading content.

## Refuse

Eyebrow labels · tracked caps · `A · B · C` meta · identical cards as page structure · nested
cards · sparklines or rings as decoration · gradient text · glass · display fonts in UI · glyph
or emoji icons · load-in animations · gray-on-colour text · shadows without offset.
