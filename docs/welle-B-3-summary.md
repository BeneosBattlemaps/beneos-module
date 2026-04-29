# Wave B-3 — Implementation Summary for Code Review

> Status: 2026-04-29. First visual upgrade for the Beneos Cloud Search Engine. Pure colour-token substitution — no HTML, class, or layout changes. Drop-in.

## What changes (visually for the user)

- **Beneos accent is now Gold (`#f5c992`) instead of Orange (`#ff6400`)**: affects the WebKit scrollbar-thumb border and anything later referencing `var(--bc-accent)` from code
- **Patreon status indicators** (window title + "not installed" badge): now use `--bc-success` (#8bbf8b) and `--bc-danger` (#d88270) — slightly softer / warmer hues than the old `#1b9200` and `#d56b52`
- Otherwise: **identical layout, identical fonts, identical spacings** — the existing V1 look is deliberately untouched

## Files touched

| File | Change |
|---|---|
| `css/beneos-cloud-tokens.css` | **NEW** — single source of truth for `--bc-*` variables. Contains all three themes (dark default + parchment + neutral). Active is `:root`-dark; the others are wired via the `[data-bc-theme="..."]` attribute on a future root element (for the V2 theme switcher; not active yet). |
| `module.json` | Token file added to `styles[]` before `beneos.css` (cascade order). |
| `css/beneos.css` | 4 colour values switched to `var(--bc-...)` — each with a hex fallback (`var(--bc-accent, #ff6400)`) so the cascade degrades gracefully if the token file is missing. |

## Inline comment anchors

Search the editor for `// Fix #B-3:` or `/* Fix #B-3:` to find the four sites in `beneos.css`, plus the header comment in `beneos-cloud-tokens.css`.

## What was deliberately NOT touched

- **HTML templates**, Handlebars files, class names, selectors — V1 stays structurally identical
- **Other hex colours** in `beneos.css` (~73 structural backgrounds / borders / text colours) — only the four brand-relevant ones were swapped
- **`#782e22` Firefox scrollbar track**: very browser-specific, not a clean fit for the token system → kept as is
- **Fonts**: `--bc-font-ui` / `--bc-font-display` / `--bc-font-mono` are DECLARED as variables but NOT applied to existing selectors. No layout reflow. V2 will use the variables directly; self-hosted woff2 ships with V2 or as Wave B-3b.
- **Other Beneos CSS files** (`table-top.css`, `beneos-journal.css`) — no brand override needed there

## Token system at a glance

From `css/beneos-cloud-tokens.css`:

```
Brand accent:       --bc-accent (#f5c992 gold), --bc-accent-soft, --bc-accent-strong, --bc-accent-dim
Surfaces (dark):    --bc-bg, --bc-bg-panel, --bc-bg-elevated, --bc-card, --bc-card-hover
Borders:            --bc-border, --bc-border-strong, --bc-border-inset
Text:               --bc-text, --bc-text-muted, --bc-text-dim
Semantic:           --bc-danger, --bc-success, --bc-info
Per-category:       --bc-cat-{tokens|maps|items|spells}
Geometry:           --bc-radius, --bc-radius-lg, --bc-shadow-pop, --bc-shadow-inner
Spacing:            --bc-space-1..8 (4/8/12/16/20/24/32 px)
Type stacks:        --bc-font-ui, --bc-font-display, --bc-font-mono
Themes:             [data-bc-theme="parchment"], [data-bc-theme="neutral"]
```

The V2 UI (upcoming Waves B-4 / B-5) will use these variables wholesale.

## Test sequence

A short smoke test is enough — this wave only changes colours, no behaviour:

1. **Foundry V13** in the WORK datapath, activate module
2. **Open the search engine** → the accent stripe on the scrollbar thumb should be **gold** instead of orange
3. **Logged in with active Patreon** → the window title shows a green "Patreon OK" status (slightly softer green than before)
4. **Logged in without Patreon** → the window title shows an orange "Patreon NOK" status (slightly softer red/orange)
5. **Token list** with "not installed" badges → badge text is in the new success-green
6. **Otherwise**: nothing should have shifted (layout / spacing / fonts unchanged)

If the Foundry cache is stubborn: clear the browser cache or hit F5.

## What comes next

The plan calls for B-4 as the next wave: search-form as ApplicationV2 with the V2 lifecycle, a `v1|v2` setting toggle for rollback, a new HBS template, and a scoped block in a separate `beneos-cloud.css`. The tokens introduced here form the foundation layer for that.

Related docs in the repo:
- `docs/welle-B-1-summary.md` — Wave B-1a/b/c/d (hardening waves before this one)
- `docs/cloud-ux-briefing.md` — strategic briefing
- `docs/design-2.0-mapping.md` — V2 design mapped onto code locations
