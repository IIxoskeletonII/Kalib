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

## Training surfaces (14 Oct 2026)

The training module was built, then audited against this file. Eight drifts; they are fixed and
the rules are here.

**A ghost is the suggestion; the mark confirms it.** Set cells carry last session's figures in
`muted`, and the tick accepts them. A ghost is never `ink` — the difference between a suggestion
and a logged figure has to be legible at a glance, mid-set, from arm's length.

**Say it once applies to columns too.** Hevy prefills the input and prints the same number in a
Previous column beside it. Showing it once freed the column that was truncating exercise names:
the fix for the ergonomics and the fix for the layout were the same fix.

**A meta line carries what the cells cannot.** When the ghosts already show last time, the line
under an exercise shows the rest interval, which is otherwise invisible until a set is ticked —
not a repeat of the figures sitting directly below it.

**Reuse the mark, including its open state.** The set tick is `DailyChecks`'s mark: 28 pt,
`border-2`, `border-surface-3` and **empty** when open, `accent` fill with a 3 px check when
done. A greyed check in an un-ticked row reads as half-finished. Completion carries `.pop`.

**One control per row, not four.** The routine editor had a superset toggle and two reorder
arrows per row, which truncated every name. Everything that can be changed about an item lives
in its sheet; the row is the name, a meta line and a chevron.

**`border-l-<tone>`, never `border-<tone>`, inside a `divide-y` card.** Tailwind's `divide-y`
draws separators as a top border on each child, so setting a border *colour* on a child recolours
the divider. The superset rule was tinting the row separators accent blue.

**Training has its own tone.** `accent-2` for superset rules and the rest countdown; `accent`
stays the app's confirmation colour and the worked muscle in the exercise art. Macro colours
remain macro identity and appear nowhere in this module.

**Exercise art is rendered, not borrowed.** The clips come out of
`scripts/render-exercise-media.py` in this file's palette — figure `ink-2`, ground `surface`,
worked muscle `accent`. A white panel behind a figure is decoration carrying no information,
which the Refuse list already forbids; the fact that it arrived inside an image did not exempt
it. The figure is rendered *below* `ink-2` brightness on purpose: at full text brightness it
becomes the loudest thing on the screen, which is the same fault wearing different clothes.

**Numbers sit on the page here as everywhere.** Train opens with the week — sessions, sets,
volume and seven day marks — on the background, then cards. It previously opened with a white
button over a stack of three equal cards, which is the page skeleton the Refuse list names.

**Weight hierarchy follows frequency, not drama.** Starting a routine is the act; "Empty
workout" is the exception and is a secondary button beside "New routine". A badge repeated on
every row of a list ("Start") distinguishes nothing and is not a badge.

## Energy and summary surfaces (15 Oct 2026)

**Celebration happens once, where the thing happened.** A record is a quiet mark during the set
and a summary afterwards; a history row read weeks later is neutral. Applause for something
already known is noise.

**A number that needs a caveat gets a screen, not a toast.** The session energy figure is only
safe beside the sentence explaining that the food budget has not moved. A toast cannot carry
that sentence, so the finish flow ends on a surface that can.

**Print the range, not the midpoint, when the midpoint is fiction.** Energy for lifting has no
accurate measurement, so it reads "305–525 kcal". A midpoint also collapses onto a bound on
sparse sessions and then looks like a bug.

**Seven bars, two labels.** The week-shape preview prints the training and rest figures once
each rather than labelling all seven columns, because five of the seven would repeat a number
already on screen. Bars scale against the span, not against zero: a few hundred kilocalories on
a couple of thousand is invisible from a zero baseline.

**A full radius needs a narrow element.** `rounded-full` on a bar as wide as its column is a
circle, not a capsule. Bars are narrow and centred in their column.

## Explaining things (15 Oct 2026)

**Progressive disclosure, never a tour.** Several behaviours here are principled and invisible
until they surprise you: a provisional target, a Monday budget larger than a Tuesday one, grey
numbers already in the set cells. Each gets its paragraph the first time, in the place it
happens, and a single line forever after (`components/Explainer.tsx`).

A coach-mark tour is refused outright. It fires before the question exists, covers the screen to
point at things, goes stale as the app moves, and its dimmed overlays and "3 of 7" dots are the
template register this file exists to keep out.

**The short form stays tappable.** An explanation shown once with no way back is how "I read
that and now I cannot find it" happens. Reopening offers *Close*; the first reading offers
*Got it*.

**The session screen is exempt.** It is used mid-set, standing at a rack, and prose does not
belong on it. Anything that needs explaining there is explained on the summary afterwards or in
Settings — never between someone and their next set.

**One page holds the premise.** Settings — How Kalib works: prose, no cards, nothing to tap,
reachable on demand and never interrupting. Everything surprising follows from the single idea
that the app measures expenditure rather than guessing it, so that idea is written down once in
full.

## Refuse

Eyebrow labels · tracked caps · `A · B · C` meta · identical cards as page structure · nested
cards · sparklines or rings as decoration · gradient text · glass · display fonts in UI · glyph
or emoji icons · load-in animations · gray-on-colour text · shadows without offset.
