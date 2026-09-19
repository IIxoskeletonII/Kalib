# Kalib design system — MASTER

Source of truth for every screen. Page files in `pages/` override this; none exist yet.
Derived with the `ui-ux-pro-max` rule set (accessibility, touch, motion, typography) and the
product's own principles (SPEC §2): numbers are the hero, trends over instants, never show
more precision than the data.

## Direction: precision instrument

Calm, dark-first, data-forward. One accent (cyan, matching the app icon). Colour is used only
where it carries meaning — the five macro identities and state (danger/success). Everything
else is a neutral scale. No gradients, no decorative shadows; depth comes from surface steps.

## Tokens (`src/index.css`, `@theme` + `:root` / `[data-theme]`)

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | #0A0E17 | #F4F6FA | page |
| `surface` | #121826 | #FFFFFF | cards, sheets |
| `surface-2` | #1A2234 | #EDF1F6 | chips, keys, bar tracks |
| `surface-3` | #232D42 | #E2E8F0 | pressed states |
| `line` | rgba(148,163,184,.14) | rgba(15,23,42,.08) | hairlines |
| `ink` | #F8FAFC | #0F172A | primary text |
| `ink-2` | #CBD5E1 | #334155 | secondary text |
| `muted` | #8A94A6 | #5B6B82 | labels (≥ 5.0:1 on every surface) |
| `accent` / `on-accent` | #22D3EE / #06222A | #0E7490 / #FFFFFF | primary actions, active states |
| `kcal` | #F5A524 | #A16207 | calories |
| `protein` | #38BDF8 | #0369A1 | protein |
| `fiber` | #4ADE80 | #166534 | fiber |
| `carb` | #A78BFA | #6D28D9 | carbs |
| `fat` | #FB7185 | #BE123C | fat |
| `danger` | #F87171 | #B91C1C | destructive |

All pairs verified ≥ 4.4:1 (body text pairs ≥ 5:1). Theme follows `prefers-color-scheme`,
overridable in Settings (`data-theme="dark|light"`), `theme-color` meta updated at runtime.

## Typography

Inter Variable, self-hosted latin subset (offline, no third-party request).
`font-variant-numeric: tabular-nums` on every number. Scale (px / line-height / weight):

- display 44/1 600, letter-spacing −0.02em — hero numbers only
- title 22/1.2 600 — screen titles
- headline 17/1.3 600 — card titles, food names
- body 16/1.5 400 — default
- label 13/1.3 500 — section labels, meta; never below 12

## Spacing, shape, elevation

4-pt scale: 4 / 8 / 12 / 16 / 20 / 24 / 32. Page gutter 16. Card padding 16–20.
Radius: card 20, button 14, key 14, chip full, sheet top 28. No shadows except the FAB
(0 8px 24px rgba(0,0,0,.35)) and sheets (backdrop only).

## Touch & feedback

Every target ≥ 44 × 44. Press feedback ≤ 100 ms: `active:scale-[.97]` + surface step
(`active:bg-surface-3`). Keys 64 px tall. Visible focus ring (`focus-visible:ring-2 ring-accent`)
on every control. `touch-action: manipulation` everywhere.

## Motion

150–250 ms, ease-out. Sheets slide up 240 ms + backdrop fade. Bars/rings transition width or
dash-offset 400 ms. Nothing animates width/height. `prefers-reduced-motion`: all durations → 0.

## Icons

Lucide (SVG), 20 px inline / 24 px in nav, `stroke-width 2`, `aria-hidden` next to text,
`aria-label` on icon-only buttons. Never glyph characters or emoji as icons.

## Components

- **Ring** — SVG progress ring (kcal); number + label in the centre; over-target shown as a
  thin second arc, never by turning the ring red.
- **MacroBar** — label, value / target unit, 6 px track. Fiber sits beside protein.
- **Sheet** — bottom sheet, drag handle, safe-area padding, backdrop closes.
- **NumberPad** — 3 × 4 keys 64 px, decimal optional, delete icon; functional updates.
- **Chip** — 40 px pill; `active` = accent fill with on-accent text.
- **SegmentedControl** — for 2–4 exclusive choices (meal slot, mode, range).
- **ListRow** — 56 px min, leading icon optional, trailing value tabular.
- **EmptyState** — icon + one sentence + one primary action.
- **Skeleton** — for async lists; never a bare spinner over 300 ms.

## Anti-patterns (from the rule set)

Text < 12 px · icon-only control without `aria-label` · hover-only affordances · instant
state changes · raw hex in components · glyph icons · disabled zoom (we allow pinch zoom
off for the standalone app only because it is a native-like PWA; text remains resizable).
