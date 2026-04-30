# Wave B-8b — Implementation Summary for Code Review

> Status: 2026-04-29. Filter sidebar redesign per the design mockup. Section-headed layout (CR / Refine / Source / Campaign / Show), CR is now a Max-CR slider instead of a dropdown, source filters are checkboxes with per-source dataset counts (replaces the source dropdown), Campaign gets its own block in token mode (was previously buried). Other modes get the same heading visual style for consistency. Plus two B-7 hotfixes ride along: bmap cards no longer show the "Installed" pill (V2 should treat bmaps as cloud-only previews), and drawer images now decode async so opening a bmap drawer no longer freezes the window.

## Themes

### B-7-fix-1 — Bmap cards never show "Installed" badge

V1's `processInstalledBattlemap` pipeline (mirrored from `beneos_search_engine.js:505`) sets `bmapData.isInstalled = true` on every entry as a side effect of the data scan. In V2 that bled through — bmaps appeared with the green "Installed" pill even though we don't track local battlemap installs at all. Bmap installs flow through Moulinette (until the cloud-bmap pipeline ships in B-8). Forced in `#enrichCard`:

```js
const isInstalled      = assetType === "bmap" ? false : !!data.isInstalled
const isCloudAvailable = assetType === "bmap" ? true  : !!data.isCloudAvailable
```

### B-7-fix-2 — Drawer images decode async

Clicking a bmap card to open the drawer froze the window for a noticeable moment. The bmap thumbnails are large; the browser was blocking the main thread to scale and decode the image into the 220 px hero box at the same moment as the part-render rebuilt the result list DOM. Fix: `decoding="async"` plus `fetchpriority="high"` plus `loading="eager"` on the drawer hero and sibling `<img>` elements. The image decode is now off the main thread; the click no longer feels like a freeze.

### B-8b — Filter sidebar V2

Restructured `templates/cloud-v2/parts/sidebar-form.hbs` from a flat list of `bc-sidebar-section` blocks into named `bc-sidebar-group` sections, each with a small accent-bar `.bc-sidebar-heading`. The visual hierarchy matches the mockup.

For the **token tab**, four real changes:

- **CR** is now a single Max-CR slider (`<input type="range">` 0–30, default 30 = no limit) with a live `<output>` display next to the heading. The slider's `change` event commits a debounced filter; the `input` event keeps the display in sync without firing the filter.
- **Refine** groups the surviving dropdowns (Biome, Faction, Type) under one heading.
- **Source** is now a checkbox column (SRD / Patreon / Webshop / Loyalty) with per-source dataset counts. Counts are computed once over the full unfiltered raw data for the assetType — they show "how many SRD tokens exist in total", not "after current filters", so the user can plan their narrowing.
- **Campaign** gets its own section using the existing `dbHolder.tokenCampaigns` map (which was already exposed via `getData()` but had no V2 surface).

`installation-selector` (the Show / Installed / Not installed dropdown) gets its own small "Show" section so power-users can still scope by install state.

Bmap / item / spell tabs keep their existing dropdown logic but use the same `bc-sidebar-group` wrapper so the look stays consistent.

The sidebar-state-restore pattern (carried over from B-5e-fix-4) is extended to the new inputs:

- `this.crMax` (instance state) restored into `#bc-cr-slider` value on every render.
- `this.sourceFilters` (Set) restored into the source checkboxes on every render.
- `#cleanFilters()` resets both alongside the existing dropdown / text-search reset.

V2_FILTER_DEFS also got cleaned up: `source-selector` and `token-cr` were removed (replaced by checkboxes and slider respectively), `campaign-selector` was added so the existing `searchByProperty(...)` pipeline picks up campaign as a regular dropdown filter.

## Files touched

```
MODIFIED:
├─ scripts/cloud-v2/cloud-window-v2.mjs
│   ├─ V2_FILTER_DEFS              → -source-selector, -token-cr, +campaign-selector
│   ├─ static CR_NO_LIMIT, KNOWN_SOURCES   → constants for the slider + checkbox set
│   ├─ this.crMax, this.sourceFilters       → instance state for filter restore
│   ├─ #enrichCard()                → bmap forced isInstalled=false + isCloudAvailable=true
│   ├─ _preparePartContext("sidebar") → +sourceCheckboxes (per-source counts)
│   ├─ #buildCards()                → +#applyCRFilter + #applySourceFilter (token-only)
│   ├─ #applyCRFilter()             → numeric Max-CR comparison
│   ├─ #applySourceFilter()         → Set-based multi-select
│   ├─ #buildSourceCheckboxes()     → counts source occurrences in raw data
│   ├─ #wireSidebarListeners()      → +slider input/change listeners, +checkbox listeners
│   └─ #cleanFilters()              → also resets crMax, sourceFilters, slider DOM, checkbox DOM
├─ templates/cloud-v2/parts/sidebar-form.hbs
│   ├─ Restructured into bc-sidebar-group sections with bc-sidebar-heading
│   ├─ Token CR section: bc-slider-wrap + Max-CR slider
│   ├─ Token Source section: bc-source-checkbox rows with counts
│   ├─ Token Campaign section: dropdown using tokenCampaigns
│   └─ Other modes: same heading style, dropdowns kept
├─ templates/cloud-v2/parts/results-pane.hbs
│   └─ Drawer hero + sibling <img> got decoding="async" / fetchpriority="high"
├─ css/beneos-cloud.css
│   ├─ +.bc-sidebar-search / .bc-sidebar-search-label
│   ├─ +.bc-sidebar-group + .bc-sidebar-heading (accent bar)
│   ├─ +.bc-sidebar-field
│   ├─ +.bc-slider-wrap / .bc-slider-row / .bc-slider-display / .bc-slider (incl. webkit + moz thumb)
│   └─ +.bc-checkbox-row / .bc-checkbox / .bc-checkbox-label / .bc-checkbox-count
└─ lang/en.json
    ├─ +BENEOS.Cloud.Filter.MaxCR
    ├─ +BENEOS.Cloud.Filter.Refine
    └─ +BENEOS.Cloud.Filter.Show

UNCHANGED:
├─ scripts/beneos_cloud.js                ← cloud API untouched
├─ scripts/beneos_search_engine.js (V1)   ← legacy path untouched
├─ scripts/beneos_utility.js              ← BeneosUtility methods reused 1:1
└─ Server / cloud endpoints
```

> Note on localization: this wave only updates `en.json`. The 12 other lang files stay untouched per the user's directive (memory `feedback_localization_dev_phase.md`) — the V2 development phase batches localization into a dedicated wave at the end. Foundry will display raw `BENEOS.X.Y` keys in non-English UIs for the new strings until that final pass runs.

## Inline comment anchors

Search for `Wave B-7-fix-1`, `Wave B-7-fix-2`, `Wave B-8b` in `scripts/cloud-v2/cloud-window-v2.mjs`, `templates/cloud-v2/parts/sidebar-form.hbs`, `templates/cloud-v2/parts/results-pane.hbs`, `css/beneos-cloud.css`.

## Test sequence

1. **Smoke**: Foundry V13 reload, V2 active, search engine opens with no console errors.
2. **Tokens tab — CR slider**: drag the Max-CR slider to 5. Result list narrows to CR ≤ 5 tokens, the count hint updates ("Showing X of Y matches"). Live display shows "5" beside the heading. Drag back to 30 → all tokens reappear.
3. **Tokens tab — Source checkboxes**: tick "SRD". List narrows to SRD-only tokens; count next to the checkbox stays at the dataset total (e.g. 284), the result count reflects the narrowed set. Tick "Patreon" too: list shows SRD ∪ Patreon tokens. Untick all: filter cleared.
4. **Tokens tab — Campaign dropdown**: pick a known campaign from the dropdown. List narrows to tokens tagged with that campaign. Pick "Any" → cleared.
5. **Tokens tab — Reset link**: click Reset (next to the Search heading). All filters clear: text empty, CR slider back to 30, all source checkboxes unticked, all dropdowns "Any".
6. **Tab switch**: switch to Maps, then back to Tokens. Filter state on Tokens persists (CR slider, source checkboxes, etc. stay where they were before the switch).
7. **Maps tab**: dropdown filters intact (Biome / Brightness / Grid / Type), Campaign block visible, info banner still there.
8. **Items / Spells tabs**: dropdowns all live under the "Refine" heading, no slider / checkboxes (they're token-specific).
9. **Bmap card list**: cards no longer show the green "Installed" pill — they show the Moulinette button instead.
10. **Bmap drawer click**: open a battlemap by clicking a card. Window does NOT freeze noticeably; image fades in once decoded. With sibling: both images appear without blocking the UI.
11. **V1 mode** (toggle setting back to v1): legacy UI unchanged, no regressions.

## Known limits / next

| Topic | Wave |
|---|---|
| Per-language localization of the new sidebar strings | dedicated localization wave at end of V2 dev |
| Min/max CR dual slider (mockup shows single Max-CR) | optional later — current single-slider matches mockup |
| Source checkbox counts narrowing with other filters | follow-up if user reports it; current "total over dataset" is the simpler / friendlier model |
| Categories chip strip (Minion / Encounter / Boss / NPC / Critter) at sidebar top | deferred — those overlap with the existing Type dropdown; needs a curated chip mapping in DB |
| Grid view toggle (List ↔ Grid card layout) | B-9 (planned, user-confirmed wow-effect) |
| Header bar polish (sign-in chip + theme toggle layout) | deferred — current is acceptable |
| Cloud-side battlemap install pipeline | B-8 (server coordination) |

## Related docs

- `docs/welle-B-7-summary.md` — wider card thumbs, Moulinette pre-filter button, bmap sibling display
- `docs/welle-B-6-summary.md` — variant carousel
- `docs/welle-B-5e-summary.md` — install-feedback polish + infinite scroll
- `docs/welle-B-5d-summary.md` — login polish, no-reload login, install progress
- `docs/welle-B-5c-summary.md` — hotfixes (spellKey/itemKey, Maps tab, login dialog)
- `docs/welle-B-5-summary.md` — V2 cards + drawer
- `docs/welle-B-4-summary.md` — V2 unified window skeleton
- `docs/welle-B-3-summary.md` — design tokens
- `docs/welle-B-1-summary.md` — hardening waves
