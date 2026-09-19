# Kalib design system — MASTER

Source of truth for every screen. Page files in `pages/` override this; none exist yet.

Skills consulted (installed under `.claude/skills/`): Anthropic `frontend-design` (avoid
templated defaults), `impeccable` (craft floor, Operate-mode rules), Vercel
`web-design-guidelines` (a11y/UX audit), `ui-ux-pro-max` (touch, motion, contrast rules).
Their verdict on the first pass, and what changed: tracked-caps eyebrow labels, middle-dot
meta strings, the identical-rounded-card kit, the sparkline-as-decoration and Inter were all
generic tells. They are gone.

## Mode and direction

**Operate.** The visitor is in a task (logging, weighing). Familiarity is a feature: grouped
inset lists, a large title, a tab bar, sheets for focused tasks. Brand lives in precise
details — one family, one accent, tabular numerals — not in decoration.

Direction: **a calibrated instrument**. Graphite dark / warm paper light. The calorie ring is
the single memorable element; everything else recedes into typography and hairlines.

## Tokens (`src/index.css`)

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | #121417 | #F5F4F0 | page |
| `surface` | #1A1D21 | #FFFFFF | grouped lists, sheets |
| `surface-2` | #23272C | #ECEBE6 | controls, keys, tracks |
| `surface-3` | #2D3238 | #DFDED8 | pressed |
| `line` | rgba(255,255,255,.08) | rgba(20,22,18,.09) | hairlines |
| `ink` / `ink-2` / `muted` | #F2F3F4 / #C3C8CE / #8D949C | #1A1C1E / #3F4449 / #5C6762 | text roles |
| `accent` / `on-accent` | #3AD3C0 / #08211D | #0B7568 / #FFFFFF | primary action, ring, active tab |
| `kcal` `protein` `fiber` `carb` `fat` | #E9A63F #5AA9EE #5CCB84 #A993EE #EE7F8F | #8F5708 #1861A0 #1F7038 #6F4FC7 #BB2F4A | macro identity only |
| `danger` | #F0736E | #B5322C | destructive |

Every text pair ≥ 4.7:1 (verified). Theme follows the system; Settings can pin dark or
light; `theme-color` follows `--bg` at runtime.

## Typography

**Instrument Sans** (variable 400–700, self-hosted latin subset, `tnum`). One family. Roles:

- Large title 30/1 600, tracking −0.02em (screen titles)
- Display 48/1 500, tracking −0.025em — the hero number only (ring 30–32px)
- Title 20/1.2 600 (sheet titles) · Heading 15 600 (section headings, sentence case)
- Body 16/1.45 400 · Secondary 14 · Meta 13 muted · never below 12

Numbers are always `tabular-nums`. Units get a thin space (`150 g`). No caps, no tracking on
labels, no eyebrows above headings, no middle dots in meta — commas and full words.

## Spacing, shape, depth

4-pt scale. Page gutter 16, section gap 28, group padding 16. Radii: grouped list / tile 16,
control 12, key 12, chip full, sheet top 22, FAB full. Depth: none except the FAB shadow and
the sheet backdrop. Grouping by proximity and hairlines before containers; the calorie block
sits directly on the page.

## Touch, states, motion

Targets ≥ 44 pt; keys 60 pt. Press = surface step (+ scale .95–.98 on buttons). Visible
`focus-visible` ring. Disabled = 40 % opacity. Motion only answers an action: sheet 220 ms
ease-out, ring / bar 500 ms; nothing animates on load; reduced-motion zeroes all durations.
Skeletons for loading, never spinners.

## Icons

Lucide, 2 px stroke, 22 px in icon buttons, 24 px in the tab bar, `aria-hidden` beside text,
`aria-label` on icon-only controls.

## Refuse

Eyebrow labels · tracked caps · `A · B · C` meta · identical cards as page structure · nested
cards · sparklines or rings as decoration · gradient text · glass · display fonts in UI · glyph
or emoji icons · load-in animations · gray-on-colour text · shadows without offset.
