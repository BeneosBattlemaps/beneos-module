# Wave B-4 — Implementation Summary for Code Review

> Status: 2026-04-29. First architecture step toward the new Beneos Cloud design 2.0: a unified ApplicationV2 window that lives **alongside** the legacy two-window search engine. Coexists via a world setting; v1 stays the default and remains fully functional.

## What this wave delivers

- A new `BeneosCloudWindowV2` (ApplicationV2 + HandlebarsApplicationMixin) implementing the mockup layout: tab strip on top, filter sidebar on the left, results pane in the center, status footer at the bottom.
- A coexistence toggle: **world setting `beneos-search-engine-version`** (v1 default, v2 opt-in) routed through the existing `BeneosSearchEngineLauncher.render()` entry point.
- The Maps tab does not host a cloud feature yet (battlemaps are delivered through Moulinette today). It opens the Moulinette browser when clicked.
- The results pane is a **slot**: it is mounted with the legacy v1 result HTML so install buttons, drag&drop and click handlers keep working unchanged. Wave B-5 replaces only the slot's contents with V2-native cards and a detail drawer; the surrounding window lifecycle stays.

## Key user-visible changes when v2 is active

- Single window instead of the two-window form/results split.
- Sidebar filters with the new Beneos-Gold accent and the design-token typography.
- Account state is shown as a chip in the footer (logged-in / Patreon active / not connected / sign-in CTA).
- Tab strip uses the V2 active-state styling; legacy ids (`#beneos-radio-token` etc.) remain for tour compat.
- Maps tab: handing off to Moulinette with a notification fallback if Moulinette is missing.

## Files added / modified

```
NEW:
├─ scripts/cloud-v2/
│  └─ cloud-window-v2.mjs                  ← BeneosCloudWindowV2 class
├─ templates/cloud-v2/parts/
│  ├─ header-tabs.hbs
│  ├─ sidebar-form.hbs
│  ├─ results-pane.hbs                     ← container with [data-results-pane]
│  └─ status-footer.hbs
├─ css/beneos-cloud.css                    ← V2 layout grid, scoped under .beneos-cloud-app
└─ docs/welle-B-4-summary.md               ← this file

MODIFIED:
├─ module.json                             ← +esmodule, +style, ordering preserved
├─ scripts/beneos_search_engine.js         ← Launcher.render() v1/v2 switch (~10 lines)
├─ scripts/beneos_utility.js               ← register beneos-search-engine-version setting
└─ lang/{en,de,fr,es,it,pt-BR,pt-PT,pl,cs,ca,ja,ko,zh-TW}.json
                                            ← 35 new BENEOS.Cloud.* + BENEOS.Settings.SearchEngineVersion.* keys
                                              (English text in all 13; per existing standard)

UNCHANGED (deliberate):
├─ scripts/beneos_cloud.js                 ← all cloud calls (login, available content, imports)
├─ scripts/beneos_search_engine.js (rest)  ← BeneosSearchEngine + BeneosSearchResults Dialog classes
├─ scripts/beneos-scenepacker.js
├─ templates/beneossearchengine.html       ← v1 form template
├─ templates/beneos-search-results-*.html  ← v1 result templates (mounted into the V2 slot)
├─ css/beneos.css                          ← v1 styles
├─ css/beneos-cloud-tokens.css             ← Wave B-3 design tokens
└─ scripts/beneos_tours.js                 ← tour selectors preserved as id aliases on V2 markup
```

## Inline comment anchors

Search for `Wave B-4` in `scripts/cloud-v2/cloud-window-v2.mjs`, `scripts/beneos_search_engine.js`, `scripts/beneos_utility.js` and `module.json`. The new templates and CSS file each have a header comment that links back to this doc.

## Architecture decisions worth knowing

1. **No server change.** Every cloud call (`importTokenFromCloud`, `checkAvailableContent`, `BeneosCloudLogin`, `BeneosDatabaseHolder.*`) is reused unchanged. The V2 window is purely a frontend reorganization.
2. **No data-shape change.** `BeneosDatabaseHolder` provides the same per-asset data via `getAll(type)` and the same per-asset processors (`processInstalledToken/Item/Spell`). The V2 sidebar reads filters and triggers `getAll`; same as v1.
3. **Single coexistence point.** `BeneosSearchEngineLauncher.render()` is the only branch — it reads the world setting and instantiates either the legacy Dialog pair or `BeneosCloudWindowV2`. Other entry points (e.g. tour scripts that call `new BeneosSearchEngineLauncher().render()`) automatically inherit the routing.
4. **Tour compat by id alias.** Every selector the existing tour script targets (`#beneos-radio-token`, `#beneos-radio-bmap`, `.beneos-search-button`, `.beneos-search-text-input`, etc.) is present on the V2 markup as a parallel id/class. The tour runs against v2 without a tour script change. If individual steps look visually awkward in the V2 sidebar layout, that is a follow-up sub-wave (B-4b).
5. **Results pane is a slot, not a refactor.** The legacy v1 result HTML is mounted into `[data-results-pane]` so all install / drag&drop / click delegations from Waves B-1a–B-1d keep working. Wave B-5 will replace the slot's content (not the slot itself).
6. **Welcome-box (`showBattlemapNotice`) is not in V2.** It targets v1 markup and is not displayed when the V2 window is active. The Maps-tab tooltip carries the same information.
7. **Globals shimmed for legacy helpers.** `softRefresh`, `drainPendingCanvasDrops` etc. expect to find the search engine on `game.beneos.searchEngine` / `game.beneosTokens.searchEngine`. The V2 constructor sets those refs so the legacy hardening logic from B-1 keeps working when v2 is active.

## Test sequence

1. **Smoke**: launch Foundry V13 in the WORK datapath, activate the module, console clean.
2. **Default = v1**: open the search engine via the Actor Directory button → the legacy two-window UI opens, all B-1 hardening tests still pass.
3. **Switch to v2**: Settings → Module Settings → Beneos → "Beneos Cloud — Search Engine Version" → V2. Reopen the search engine.
   - Single window opens (Tab strip + Sidebar + Results + Footer).
   - Title bar shows "Beneos Cloud" with green/orange Patreon badge if logged in.
   - Tabs: Tokens / Maps / Items / Spells. Active tab has the gold accent.
4. **Tabs**: click Tokens → results populate (v1 markup). Switch to Items → result list re-renders for items. Spells → likewise.
5. **Maps tab**: click → Moulinette browser opens (if Moulinette is installed). If not: notification "Moulinette module not detected — please install Beneos battlemaps via Moulinette manually." appears.
6. **Filters**: type in the global text search → results filter. Change a sidebar dropdown (e.g. Biome) → results re-render after debounce.
7. **Reset**: click "Reset" → filters clear, results refresh.
8. **Install (click)**: click the install icon on a not-installed token → `importTokenFromCloud` runs (B-1b idempotency lock applies), badge flips to "installed" after the import completes. No window flicker (B-1c soft refresh applies).
9. **Drag&drop installed token onto canvas**: only one token appears at the drop position; no duplicate world actor (B-1d local-drag fix applies).
10. **Drag&drop cloud token onto canvas**: notification "Importing… will appear at the drop position once ready", token spawns at coordinates after import (B-1d cloud-drag pipeline).
11. **Login footer**: log out → footer chip becomes "Not connected to Beneos Cloud" + "Sign in" button. Click "Sign in" → existing `BeneosCloudLogin` dialog opens.
12. **Switch back to v1**: Settings → V1, reopen → legacy UI returns, no regressions.
13. **Tour**: setting v1 → tour runs as before. Setting v2 → tour runs against the alias selectors. If a step lands on a now-empty area, file as B-4b.
14. **V14 smoke**: second Foundry instance in the SYNC datapath, V13 toggle active → identical behavior.

## Things to verify by hand (and likely follow-up B-4b candidates)

- Moulinette API surface: the `_onMapsTabClick` handler tries `game.moulinette.cache.open()`, then `game.moulinette.openBrowser()`, then `Moulinette.cache.open()`, then notification fallback. The actually-correct call may differ across Moulinette versions; if the production Moulinette exposes a different entry, swap it in `cloud-window-v2.mjs::_onMapsTabClick`.
- Tour-step positions: the V2 layout puts filters in the sidebar instead of inline below the tab strip; some tour bubbles may need re-positioning (B-4b).
- Token-tab default filter dropdowns reference some `dbData.*` keys (`factionList`, `sourceList`, `tokenTypes`, `crList`, `itemTypes`, `itemRarities`, `itemOrigins`, `spellLevels`, `spellSchools`, `spellClasses`). If `BeneosDatabaseHolder.getData()` does not surface them all under those exact names, the corresponding sidebar dropdowns will render empty. Quick fix: rename in `sidebar-form.hbs` to whatever `getData()` actually returns. Spot-check after first open.

## What is NOT in this wave (by plan)

| Topic | When |
|---|---|
| V2-native result cards / list-grid toggle | Wave B-5 |
| Detail drawer (right slide-in on row click) | Wave B-5 |
| Quick Picker (separate compact window) | Wave B-7 |
| Theme switcher (parchment / neutral) | Wave B-7 (tokens already exist) |
| Self-hosted Inter + Fraunces fonts | Wave B-3b or with V2 maturation |
| Storage quota in the status footer | needs server enrichment, deferred |
| Releases (map clusters by campaign) | needs server enrichment, deferred |
| Paired maps (battlemap+scenery crossfade) | needs server enrichment, deferred |
| Tour-text repositioning for V2 layout | Wave B-4b (only if user feedback says so) |

## Related docs

- `docs/welle-B-1-summary.md` — hardening waves (B-1a/b/c/d)
- `docs/welle-B-3-summary.md` — design token CSS
- `docs/cloud-ux-briefing.md` — strategic UX briefing
- `docs/design-2.0-mapping.md` — map of the V2 mockup onto code locations
