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
| `accent` → `accent-2` | #5EEAD4 → #38BDF8 | #0B7D6F → #1E63A8 | ring gradient, active states, sparkline |
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

## Touch, states, motion

Targets ≥ 44 pt; keys 60 pt. Press = scale .97 + surface step. Visible `focus-visible` ring.
Disabled = 40 % opacity. Motion: `--ease-out-soft` (0.22,1,0.36,1) for arrivals, `--ease-spring`
(0.32,0.72,0,1) for sheets (320 ms). The ring fills from empty on mount and eases on change
(900 ms); the hero number counts up (700 ms); screens rise in 220 ms; bars ease 700 ms.
Reduced-motion zeroes all of it. Skeletons for loading, never spinners.

## Icons

Lucide, 2 px stroke, 22 px in icon buttons, 24 px in the tab bar, `aria-hidden` beside text,
`aria-label` on icon-only controls.

## Refuse

Eyebrow labels · tracked caps · `A · B · C` meta · identical cards as page structure · nested
cards · sparklines or rings as decoration · gradient text · glass · display fonts in UI · glyph
or emoji icons · load-in animations · gray-on-colour text · shadows without offset.
