# Design — CKLibrary

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre

editorial (austere voice — quiet, airy, restrained card-catalog)

## Macrostructure family

- Marketing/entry pages: Letter (12) — login-view opens as a short personal note, greeting first, no buttons in the fold except the single action
- App pages: Catalogue (11) — shelf is a uniform visual index of inventory; rhythm from alignment and rules, not card chrome
- Content pages: Long Document (02) — detail dialog reads as continuous prose with inline section heads; hero is typographic, cover is annotation

Pages within a family share the family's shape; they vary only in component archetypes.

## Theme

Palette reverted to the original hex colours on 2026-10-14 (user rejected the
OKLCH retint — same hues, visibly different rendering). Values below are the
pre-redesign originals, kept verbatim.

Light (default):

- `--paper`:        #ece3d0
- `--paper-raise`:  #f6efe0
- `--paper-recess`: #e2d7bf
- `--ink`:          #211b16
- `--ink-soft`:     #574c42
- `--ink-faint`:    #6b5e4f
- `--accent`:       #7c2d2c (oxblood)
- `--accent-deep`:  #5d1f1e
- `--accent-wash`:  #f0e0da
- `--line`:         #cabfa8
- `--line-soft`:    #ded3bb
- `--ok`:           #2c5e46

Dark (`:root[data-theme="dark"]`, same names):

- `--paper`:        #1c1713
- `--paper-raise`:  #262019
- `--paper-recess`: #14100c
- `--ink`:          #f1e8d8
- `--ink-soft`:     #d3c6b2
- `--ink-faint`:    #a99a85
- `--accent`:       #d9988a
- `--accent-deep`:  #f0c4b6
- `--accent-wash`:  #3d2a25
- `--line`:         #4e4438
- `--line-soft`:    #3a332b
- `--ok`:           #8fc2a4

Token names stay project-native (`--paper`, `--ink`, `--accent`, …).
New additive tokens live in `tokens.css`; `styles.css` stays append-only.

## Typography

- Display: Taviraj, weight 700, style normal (never italic in headings)
- Body: Public Sans, weight 400/600
- Display tracking: -0.015em; body letter-spacing 0.002em
- Type scale anchor: `--text-display` = clamp(2rem, 7vw, 3rem); hero headlines ≤7 words
- Section heads: stacked only — small uppercase label ABOVE, heading directly
  underneath in the same column. Hanging/tag-left layouts are banned.

## Spacing

4-point named scale, additive in `tokens.css`. Pages must use named tokens,
never raw values. Existing `--pad` and `--r` are kept as aliases.

- `--space-3xs: 0.25rem; --space-2xs: 0.5rem; --space-xs: 0.75rem`
- `--space-sm: 1rem; --space-md: 1.5rem; --space-lg: 2rem`
- `--space-xl: 3rem; --space-2xl: 4.5rem; --space-3xl: 7rem`
- `--radius-card: 3px; --radius-pill: 999px; --radius-input: 3px`

## Motion

- Easings: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (primary); `--ease-in-out` same curve reversed
- Durations: `--dur-short: 220ms`; dialogs crossfade ≤150ms
- Reveal pattern: none on shelf/detail (content is the page); fade-only where needed
- Reduced-motion fallback: opacity-only, ≤150ms, no transform
- Animate transform/opacity only; focus rings appear instantly, never animated

## Microinteractions stance

- silent success (inline status text, e.g. `.scan-status`); no celebratory toasts
- optimistic update + Undo where applicable; no confirmation dialogs for reversible acts
- hover delay 800ms · focus delay 0ms on tooltips
- `:focus-visible`: 2px solid accent-equivalent ring at ≥3:1, instant

## CTA voice

- Primary CTA: oxblood fill, uppercase Public Sans 600, letter-spacing 0.06em, radius 3px, min-height 44px
- Secondary CTA: ghost outline (`--line` border, `--ink-soft` text), same shape/rhythm
- Danger: accent-outline flipping to fill on hover (existing pattern kept)
- One primary per dialog; the repetition is the call to action

## Per-page allowances

- Login (Letter): typography only. No illustration, no grain lift.
- Shelf (Catalogue): typography only. Covers are content (real book art), not enrichment.
- Detail (Long Document): typography only. Cover is annotation at fixed small size.
- Form/scan/covers dialogs: typography only; function carries the page.
- App pages MUST NOT add enrichment — Tier-A/B reserved for nothing in this app.
- Cover-backend classes (`.cover-opts`, `.cover-opt`, `.cover-row`, `.cover-check`,
  `.cover-detail-row`, `#covers-body`) keep their names and JS hooks; restyle via CSS only.

## What pages MUST share

- The wordmark (Taviraj 700) and its quiet scale
- The oxblood accent and its placement (≤5% per viewport)
- The display + body fonts (no new faces, no new deps)
- The CTA voice (shape, radius, padding rhythm)
- Section heading rhythm (stacked label + heading, hairline `--line-soft` dividers)
- Cache-buster query strings on stylesheet/script tags (deploy hygiene — never revert)

## What pages MAY differ on

- Macrostructure within the page-type family (Letter / Catalogue / Long Document)
- Density (shelf grid columns per viewport; detail section padding)
- Dialog width per content (form narrow, covers wide)

## Exports

Drop-in formats for re-using this design system in other projects.

### tokens.css

```css
:root {
  --paper:         #ece3d0;
  --paper-raise:   #f6efe0;
  --paper-recess:  #e2d7bf;
  --ink:           #211b16;
  --ink-soft:      #574c42;
  --ink-faint:     #6b5e4f;
  --accent:        #7c2d2c;
  --accent-deep:   #5d1f1e;
  --accent-wash:   #f0e0da;
  --line:          #cabfa8;
  --line-soft:     #ded3bb;
  --ok:            #2c5e46;

  --font-display: "Taviraj", Georgia, "Times New Roman", serif;
  --font-body: "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif;

  --space-3xs: 0.25rem;  --space-2xs: 0.5rem;  --space-xs: 0.75rem;
  --space-sm:  1rem;     --space-md:  1.5rem;  --space-lg: 2rem;
  --space-xl:  3rem;     --space-2xl: 4.5rem;  --space-3xl: 7rem;

  --text-display: clamp(2rem, 7vw, 3rem);

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.3, 0, 0.16, 1);
  --dur-short: 220ms;
  --dur-dialog: 150ms;
  --radius-card: 3px; --radius-pill: 999px; --radius-input: 3px;
}
:root[data-theme="dark"] {
  --paper:         #1c1713;
  --paper-raise:   #262019;
  --paper-recess:  #14100c;
  --ink:           #f1e8d8;
  --ink-soft:      #d3c6b2;
  --ink-faint:     #a99a85;
  --accent:        #d9988a;
  --accent-deep:   #f0c4b6;
  --accent-wash:   #3d2a25;
  --line:          #4e4438;
  --line-soft:     #3a332b;
  --ok:            #8fc2a4;
}
```

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper:   #ece3d0;
  --color-ink:     #211b16;
  --color-accent:  #7c2d2c;
  --font-display:  "Taviraj", Georgia, serif;
  --font-body:     "Public Sans", system-ui, sans-serif;
  --spacing-md:    1.5rem;
  --ease-out:      cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper":  { "$value": "#ece3d0", "$type": "color" },
    "ink":    { "$value": "#211b16", "$type": "color" },
    "accent": { "$value": "#7c2d2c", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Taviraj", "$type": "fontFamily" },
    "body":    { "$value": "Public Sans", "$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1.5rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background:         #ece3d0;
  --foreground:         #211b16;
  --primary:            #7c2d2c;
  --primary-foreground: #f6efe0;
  --muted:              #cabfa8;
  --muted-foreground:   #574c42;
  --border:             #cabfa8;
  --input:              #cabfa8;
  --ring:               #7c2d2c;
  --radius:             3px;
}
```
