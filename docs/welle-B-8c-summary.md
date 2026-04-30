# Wave B-8c — Implementation Summary for Code Review

> Status: 2026-04-29. Six refinements to the B-8b filter sidebar after user testing. CR is now a dual-thumb range slider with discrete D&D-style fractional steps (1/8, 1/4, 1/2, 1, ..., 30); CR labels render as fractions everywhere; the broken Show-Installed dropdown is fixed; source filter switched to exclusion semantics with brand-correct labels (Patreon → "Beneos Originals") and tooltips; biome filter switched to a multi-checkbox cross-filter (AND semantics); Fighting Style and Purpose dropdowns surfaced in the token sidebar.

## Themes

### 1. CR shown as fractions everywhere

D&D 5e uses fractional CRs below 1 (1/8, 1/4, 1/2). The database stores them as decimals (0.125 / 0.25 / 0.5); GMs expect to see fractions on cards and in the drawer. New static helper:

```js
static #formatCR(n) {
  if (n == null || n === "") return null
  const x = Number(n)
  if (!Number.isFinite(x)) return String(n)
  if (x === 0)     return "0"
  if (x === 0.125) return "1/8"
  if (x === 0.25)  return "1/4"
  if (x === 0.5)   return "1/2"
  if (Number.isInteger(x)) return String(x)
  return x.toFixed(2).replace(/\.?0+$/, "")
}
```

`#enrichCard` now returns `crLabel` alongside the numeric `cr`. Card tag and drawer field use `crLabel`; the filter still operates on the numeric value so comparisons stay correct.

### 2. Show-Select-Filter bug fix

The B-8b "Show: Installed / Not installed" dropdown didn't actually filter. Two compounding mistakes:

- `V2_FILTER_DEFS` had `prop: "install"` — the data field is named `installed`. v1's `searchByProperty` does a top-level lookup at `item[propertyName]`, so the wrong key never matched.
- The template's `<option value="noninstalled">` didn't match the data value `"notinstalled"` (single word, no hyphen — set by v1's `processInstalledToken`).

Fixed both. The dropdown now correctly compares against the top-level `installed` field.

### 3. Source filter → exclusion model with brand-correct labels

User feedback: "default should be everything checked, user opts out". Use case is hiding SRD content to focus on Beneos originals — narrowing to a single source is rare. Changes:

- `this.sourceHidden` (Set) replaces `sourceFilters`. Empty Set = show everything; any key in the Set = hide entries with that source.
- All checkboxes start checked; user unchecks to add to `sourceHidden`, rechecks to remove.
- `BeneosCloudWindowV2.SOURCE_DEFS` carries display labels + tooltip i18n keys per source. Patreon's user-facing label is now "Beneos Originals" (the database key stays "Patreon" so the filter still matches).
- Each checkbox row carries a `data-tooltip` explaining the source: SRD = Wizards of the Coast SRD content, Beneos Originals = released through Patreon, Webshop = purchased from Beneos Webshop, Loyalty = long-term-supporter rewards.

### 4. CR dual-thumb range slider

Single Max-CR was too restrictive — GMs want to bracket "5–8" not just "≤8". Implementation: two `<input type="range">` overlapping in a `.bc-slider-dual` wrapper. The native tracks are made transparent; a single shared track is painted via `::before` on the wrapper, plus a `<div class="bc-slider-fill">` whose `left` / `right` are updated in JS to highlight the active range.

Steps are non-uniform (D&D fractions plus integers): `[0, 0.125, 0.25, 0.5, 1, 2, …, 30]`. The slider's `min`/`max`/`step` are kept uniform (0..33, step 1) so each notch is evenly distributed visually; the JS maps the slider value to `CR_STEPS[index]` for display and filtering.

`enforceOrder` keeps `crMin ≤ crMax` by pushing the other thumb when one is dragged past the other.

### 5. Biome multi-checkbox cross-filter (AND semantics)

The single-select biome dropdown couldn't express "Forest AND Civilization" cross-cuts that GMs actually want. Replaced with a checkbox group identical in style to the source group:

- `this.biomeFilters` (Set) holds the active biome keys.
- `#applyBiomeFilter` returns entries whose `properties.biom` array contains EVERY checked biome (intersection).
- `#buildBiomeCheckboxes` enumerates biomes by counting them across the unfiltered raw token data, sorted alphabetically, with per-biome counts.

`bioms-selector` removed from `V2_FILTER_DEFS` since the dropdown is gone.

### 6. Fighting Style + Purpose dropdowns

Both data sets (`fightingStyles`, `purposeList`) were already in `dbHolder.getData()` — v1 surfaced them, V2 hadn't. Added to the Refine section as plain dropdowns. Two new `V2_FILTER_DEFS` entries (`token-fight-style` / `prop: "fightingstyle"` and `token-purpose` / `prop: "purpose"`) so the existing `searchByProperty` pipeline picks them up.

## Files touched

```
MODIFIED:
├─ scripts/cloud-v2/cloud-window-v2.mjs
│   ├─ static #formatCR()                  → CR fraction helper (1/8 / 1/4 / 1/2 …)
│   ├─ static CR_STEPS                     → discrete step array including fractions
│   ├─ static SOURCE_DEFS                  → label + i18n tooltip per source (replaces KNOWN_SOURCES)
│   ├─ this.crMin / this.crMax             → range bounds (real values, not indices)
│   ├─ this.sourceHidden                   → exclusion-model Set (replaces sourceFilters)
│   ├─ this.biomeFilters                   → AND-semantics biome multi-select
│   ├─ V2_FILTER_DEFS                      → -bioms-selector, +installed (was install), +fightingstyle, +purpose
│   ├─ #enrichCard()                       → +crLabel
│   ├─ _preparePartContext("sidebar")      → +biomeCheckboxes, +crMinIndex/MaxIndex/StepsMax/RangeLabel
│   ├─ #applyCRFilter()                    → range filter (min..max inclusive)
│   ├─ #applyBiomeFilter()                 → AND-semantics on properties.biom array
│   ├─ #buildSourceCheckboxes()            → uses SOURCE_DEFS, returns checked/tooltip per source
│   ├─ #buildBiomeCheckboxes()             → counts + sort alphabetically
│   ├─ #wireSidebarListeners()             → dual-thumb listeners w/ enforceOrder + updateDisplay; biome listener
│   └─ #cleanFilters()                     → resets crMin/Max, sourceHidden, biomeFilters, all DOM controls
├─ templates/cloud-v2/parts/sidebar-form.hbs
│   ├─ Replaced single CR slider w/ dual-thumb #bc-cr-min + #bc-cr-max + .bc-slider-fill
│   ├─ Removed biome dropdown, added biome checkbox group (mirrors source group)
│   ├─ Added Fighting Style + Purpose dropdowns under Refine
│   ├─ Source rows: +data-tooltip="{{src.tooltip}}", checked={{src.checked}}
│   └─ install-state dropdown: option value="noninstalled" → "notinstalled" (matches data)
├─ templates/cloud-v2/parts/results-pane.hbs
│   ├─ Card CR tag uses card.crLabel
│   └─ Drawer CR field uses drawer.asset.crLabel
├─ css/beneos-cloud.css
│   └─ Replaced single-thumb slider rules with dual-thumb (.bc-slider-dual + .bc-slider-fill + ::before track,
│     transparent native tracks, pointer-events on thumbs, WebKit + Firefox thumb fallbacks)
└─ lang/en.json
    ├─ +BENEOS.Cloud.Filter.MinCR / MaxCR / CRRange
    ├─ +BENEOS.Cloud.Filter.FightingStyle / Purpose
    └─ +BENEOS.Cloud.Filter.Source* labels + tooltips (SRD / Patreon (= "Beneos Originals") / Webshop / Loyalty)

UNCHANGED:
├─ scripts/beneos_cloud.js                  ← cloud API untouched
├─ scripts/beneos_search_engine.js (V1)     ← legacy path untouched
└─ Server / cloud endpoints
```

> Note on localization: only `en.json` updated, per the user's directive (`feedback_localization_dev_phase.md`). The 12 other lang files stay frozen until the dedicated localization wave at the end of V2 dev.

## Inline comment anchors

Search for `Wave B-8c` in `scripts/cloud-v2/cloud-window-v2.mjs`, `templates/cloud-v2/parts/sidebar-form.hbs`, `css/beneos-cloud.css`.

## Test sequence

1. **Smoke**: Foundry V13 reload, V2 active, search engine opens with no console errors.
2. **CR fractions on cards**: A token with CR 0.5 displays as "CR 1/2"; CR 0.25 as "CR 1/4"; CR 5 as "CR 5".
3. **CR slider — single bound**: drag the right thumb to "8". Display shows "0 – 8". List narrows to CR ≤ 8 tokens. Drag back to 30 → all return.
4. **CR slider — range**: drag left thumb to "1/2", right thumb to "5". Display "1/2 – 5". List shows tokens between those bounds inclusive. Active fill bar between thumbs is gold.
5. **CR slider — order enforcement**: drag the left thumb past the right thumb's position. The right thumb pushes along so the bounds never cross.
6. **Show-Select-Filter**: pick "Installed only" from the Show dropdown. List shrinks to locally installed tokens only. Pick "Not installed" → only un-installed tokens. Pick "Any" → all return.
7. **Source — default & exclusion**: all four source boxes start checked. Uncheck "SRD" → list excludes SRD-sourced tokens. Recheck SRD → all return. Hover any checkbox → tooltip with the source description appears.
8. **Source — Beneos Originals label**: the Patreon checkbox is labeled "Beneos Originals" in the UI. Filter still works (DB key stays "Patreon").
9. **Biome cross-filter**: check "Forest" → list narrows to Forest-tagged tokens. Check "Civilization" too → list narrows further to tokens with BOTH biomes. Uncheck either → loosens.
10. **Fighting Style / Purpose**: pick "Tank" from Purpose → list narrows. Pick "Anti-Caster" combined with a CR range and a biome → multiple filters compound correctly.
11. **Reset**: click the Reset link. CR slider snaps to "0 – 30", source boxes all checked, biome boxes all unchecked, all dropdowns "Any".
12. **Tab switch + return**: switch to Maps then back to Tokens. CR range, source / biome state, dropdown selections persist.
13. **V14 smoke**: identical behavior in second Foundry instance.

## Known limits / next

| Topic | Wave |
|---|---|
| "Free Creatures" source filter | Needs a database-side flag (no existing field) — defer to B-8 server coordination |
| Biome counts narrowing with other active filters | Currently total over unfiltered dataset, matching source counts; switch to dynamic counts only if user reports confusion |
| Slider thumb keyboard nav (Tab to focus, arrow keys) | Native `<input type="range">` already supports this; verify with screen-reader tests |
| Per-language localization of new sidebar strings | Dedicated localization wave at end of V2 dev |
| Categories chip strip from mockup (Minion / Encounter / Boss / NPC / Critter) | Overlaps with Type dropdown; needs a curated chip mapping in DB |
| Grid view toggle (List ↔ Grid card layout) | B-9 (planned, user-confirmed wow-effect) |

## Related docs

- `docs/welle-B-8b-summary.md` — initial filter sidebar redesign (sectioned headings, single Max-CR slider, source checkboxes inclusion model, campaign block)
- `docs/welle-B-7-summary.md` — wider card thumbs, Moulinette pre-filter button, bmap sibling display
- `docs/welle-B-6-summary.md` — variant carousel
- `docs/welle-B-5e-summary.md` — install-feedback polish + infinite scroll
- `docs/welle-B-5d-summary.md` — login polish, no-reload login, install progress
- `docs/welle-B-5c-summary.md` — hotfixes (spellKey/itemKey, Maps tab, login dialog)
- `docs/welle-B-5-summary.md` — V2 cards + drawer
- `docs/welle-B-4-summary.md` — V2 unified window skeleton
- `docs/welle-B-3-summary.md` — design tokens
- `docs/welle-B-1-summary.md` — hardening waves
