# Wave B-5c — Implementation Summary for Code Review

> Status: 2026-04-29. Hotfix wave on top of B-5: closes two install-pipeline runtime errors, makes the Maps tab a real search (with a Moulinette hand-off at install time), and reskins the login dialog so it matches the V2 unified-window look.

## Issues fixed

### 1. `ReferenceError: spellKey is not defined` (and same shape for items)

`importItemToCompendium` and `importSpellToCompendium` called `BeneosSearchEngineLauncher.softRefresh("item"|"spell", key)` after the `for (let key in array)` loop had ended — at that point the loop variable was out of scope. Single-install always passes an object with one entry, so we now read it back from the function argument:

```js
const installedItemKey = Object.keys(itemArray)[0]
if (installedItemKey) BeneosSearchEngineLauncher.softRefresh("item", installedItemKey)
```

### 2. `TypeError: game.beneos.searchEngine.processSelectorSearch is not a function`

`BeneosSearchEngineLauncher.softRefresh` (Wave B-1c helper) calls `game.beneos.searchEngine.processSelectorSearch()` to rebuild the result list after a per-asset refresh. When V2 is active, that pointer is the V2 window — which had no such method. Added two compat shims to `BeneosCloudWindowV2`:

```js
processSelectorSearch() { this.render({ parts: ["results"] }) }
saveSearchFilters()    { /* no-op — V2 keeps state on the instance */ }
```

The legacy hardening from B-1b, B-1c, B-1d now flows through the V2 path unchanged.

### 3. Maps tab is a real search with Moulinette hand-off at install time

Before: clicking the Maps tab opened the Moulinette browser directly. The user could not browse Beneos battlemaps inside the Beneos Cloud window.

Now:
- Clicking the Maps tab switches `searchMode = "bmap"` (same as the other categories) and renders cards from `BeneosDatabaseHolder.getAll("bmap")`.
- A new `bmap` filter block appears in the sidebar (Biome / Brightness / Campaign / Grid / Type) plus a small info banner explaining the install hand-off.
- Clicking the install button on a battlemap card opens Moulinette and shows a notification with the map name so the user can find it there. The Beneos search experience stays in the Beneos Cloud window.
- This is the bridge until the cloud-battlemap pipeline is live; once it is, the install button can switch from the Moulinette hand-off to the regular `importBattlemapFromCloud(key)` call.

`V2_FILTER_DEFS` was extended with the bmap selectors (`bmap-bioms-selector`, `bmap-brightness`, `bmap-adventure`, `bmap-grid`, `kind-selector`) so the existing dropdown-filter pipeline picks them up automatically.

### 4. Login dialog matches V2 chrome

The Beneos Cloud login dialog (DialogV2) now carries the classes `beneos-cloud-app` + `beneos-cloud-login-dialog`. CSS scoped to `.beneos-cloud-login-dialog` overrides Foundry's default Dialog chrome with the design-token surfaces (dark panel, gold accent on the primary button, Inter typography, our input styling).

## Files touched

```
MODIFIED:
├─ scripts/beneos_cloud.js
│   ├─ importItemToCompendium  → installedItemKey lookup before softRefresh
│   ├─ importSpellToCompendium → installedSpellKey lookup before softRefresh
│   └─ BeneosCloudLogin.loginDialog → added beneos-cloud-app + beneos-cloud-login-dialog classes
├─ scripts/cloud-v2/cloud-window-v2.mjs
│   ├─ V2_FILTER_DEFS  → +5 bmap selectors
│   ├─ DEFAULT_OPTIONS.actions → openMoulinetteForMaps removed (no longer needed at tab-switch)
│   ├─ processSelectorSearch / saveSearchFilters → new compat shims
│   ├─ _onSwitchTab → no longer special-cases bmap
│   ├─ _onMoulinetteInstall → renamed handler, called from the bmap install button
│   └─ #wireResultListeners (install branch) → bmap path opens Moulinette with map name
├─ templates/cloud-v2/parts/header-tabs.hbs → Maps tab uses data-action="switchTab"
├─ templates/cloud-v2/parts/sidebar-form.hbs → new bmap filter block + info banner
├─ css/beneos-cloud.css
│   ├─ .bc-banner-info  → gold-accented info variant
│   └─ .beneos-cloud-login-dialog → scoped V2 styling for the login modal
└─ lang/{13 lang files}.json
    ├─ +BENEOS.Cloud.Filter.{Brightness, Campaign, Grid, Scenery, Battlemap}
    ├─ +BENEOS.Cloud.MapsBanner
    └─ +BENEOS.Cloud.Notification.MoulinetteSearch
```

## Inline comment anchors

Search for `Wave B-5c` in `scripts/beneos_cloud.js`, `scripts/cloud-v2/cloud-window-v2.mjs`, `templates/cloud-v2/parts/header-tabs.hbs`, `css/beneos-cloud.css`.

## Test sequence

1. **Smoke**: Foundry V13 reload, V2 active, search engine opens.
2. **Token install via click**: a token's install button → no console error, soft-refresh updates the badge.
3. **Item install via click**: same — was broken in B-5 with `itemKey is not defined`, fixed now.
4. **Spell install via click**: same — was broken in B-5 with `spellKey is not defined`, fixed now.
5. **Maps tab**: click → stays in the V2 window, shows battlemap cards and bmap-specific filters in the sidebar.
6. **Maps install button**: click on a map's install button → Moulinette opens, a notification shows the map name.
7. **Login dialog**: log out, click "Sign in" → dialog opens with the Beneos-Gold + dark theme styling instead of Foundry's default Dialog chrome.
8. **V1 mode** (toggle setting back to v1): legacy UI unchanged, no regressions.

## What is NOT in this hotfix

| Topic | Wave |
|---|---|
| Variant carousel inside the drawer | B-6 |
| Quick Picker (separate compact window) | B-7 |
| Theme switcher (parchment / neutral) | B-7 |
| Self-hosted Inter + Fraunces fonts | B-3b or with V2 polish |
| Battlemap cloud download pipeline (replaces the Moulinette hand-off) | B-8 (server coordination) |
| Releases / map clusters by campaign | B-8 |
| Storage quota in the status footer | B-8 |

## Related docs

- `docs/welle-B-5-summary.md` — the V2 cards + drawer wave this hotfix builds on
- `docs/welle-B-4-summary.md` — V2 unified window skeleton
- `docs/welle-B-3-summary.md` — design tokens
- `docs/welle-B-1-summary.md` — hardening waves
- `docs/cloud-ux-briefing.md` — strategic UX briefing
