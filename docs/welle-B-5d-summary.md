# Wave B-5d — Implementation Summary for Code Review

> Status: 2026-04-29. Polish wave on top of B-5c. Three themes, all in the V2 path only: (1) login modal looked plump, (2) login destroyed unsaved state in other modules via a full GUI reload, (3) the install button gave no visual feedback during the 3–5s cloud roundtrip. Server, settings layout and v1 path are untouched.

## Themes

### 1. Login modal polish

The DialogV2 login modal looked plump: e-mail and password fields read as a single block, the box was too wide, the header repeated the window title, a red top stripe leaked through from Foundry's default dialog chrome, and the close button rendered without an icon. Fixes:

- `templates/beneos-cloud-login.html` rewritten with the `bc-login-form` class set: a single hint paragraph, two clearly separated fields (`bc-login-form__field` flex-column with proper gap), no inner header, no decorative subtitle.
- `css/beneos-cloud.css` `.beneos-cloud-login-dialog` block:
  - `max-width: 360px` on the dialog window so the box stops feeling like a half-screen banner.
  - Foundry's `::before` red stripe killed via `display: none !important`.
  - Close button gets a Font Awesome unicode fallback (`content: "\f00d"`) so it always renders even if the icon font is still loading.
  - Submit / Cancel buttons clamped to `width: auto !important; min-width: 80px; flex: 0 0 auto !important` — no more 100% stretch.
  - Field labels use the design-token typography stack and inputs match the V2 sidebar inputs.

### 2. No-reload login (closes Issue A5 from the catalog, V2 path only)

Before: `BeneosCloudLogin.pollForAccess()` and `BeneosCloud.disconnect()` ended in `window.location.reload()`. Anything unsaved in other modules (open journal edits, unsaved sheet changes, combat-tracker positions) was wiped. Now:

- `pollForAccess()` on success awaits `BeneosCloud.checkAvailableContent()` (the Promise from B-1b) and then triggers a partial render on the V2 window:
  ```js
  if (game.beneos.cloudWindowV2)
    game.beneos.cloudWindowV2.render({ parts: ["sidebar", "results", "footer"] })
  else
    BeneosSearchEngineLauncher.closeAndSave()  // v1 fallback, kept for non-V2 mode
  ```
- `disconnect()` analogous: clears in-memory `availableContent`, fires the V2 partial render or v1 close, no reload.
- `BeneosCloudLogin.loginDialog()` button labels switched to i18n keys (`BENEOS.Cloud.Login.Submit` / `Cancel` / `WindowTitle`) so the modal localizes properly.

The v1 path was left as-is on purpose — it has no partial-render hook and the V2 path is now the canonical way forward.

### 3. Install progress indicator (4-state animated card)

Before: clicking install on a card gave no visible feedback during the 3–5s cloud roundtrip. The user did not know whether the click had registered. Mockup spec is a 4-state button: idle / in-progress / installed / update-available. Implementation in `BeneosCloudWindowV2`:

- New instance field `installState = new Map()` keyed by asset key, value `"progress"` or `"done"`.
- The install-click handler in `#wireResultListeners` does, before the existing async pipeline runs:
  ```js
  this.installState.set(key, "progress")
  this.render({ parts: ["results"] })
  ```
- `processSelectorSearch()` (the B-5c shim) reads the state map and, when an entry transitions to `"done"`, schedules a `setTimeout` that clears the state after 1500 ms — the card flashes green for that window and then settles into the normal installed state.
- `#enrichCard()` reads `installState` AND `pendingCanvasDrops` (so cloud-drag-to-canvas from B-1d also pulses) and exposes two flags on the card data: `isInstalling` and `justInstalled`.

UI side:

- `templates/cloud-v2/parts/results-pane.hbs`: card outer element gets the conditional classes `bc-card-installing` (while `progress`) and `bc-card-just-installed` (during the 1.5 s flash). The action area now has an `{{#if card.isInstalling}}` branch that swaps the install button for a `.bc-state-installing` spinner pill.
- `css/beneos-cloud.css`: `@keyframes bc-card-pulse` (slow gold border pulse), `@keyframes bc-card-flash` (single green flash), `.bc-state-installing` pill styled as info-colored chip with a spinning icon.

This makes both click-install and drag-to-canvas show a clear "we got your click, working on it" state, with a small celebratory flash on completion.

## Files touched

```
MODIFIED:
├─ templates/beneos-cloud-login.html              ← V2 layout, no inner header / subtitle
├─ scripts/beneos_cloud.js
│   ├─ pollForAccess()      → no window.location.reload(); V2 partial render or v1 close fallback
│   ├─ disconnect()         → no reload; clears availableContent; V2 partial render or v1 close
│   └─ BeneosCloudLogin.loginDialog → i18n labels for Submit / Cancel / WindowTitle
├─ scripts/cloud-v2/cloud-window-v2.mjs
│   ├─ installState = new Map()                  ← 4-state install button per asset
│   ├─ processSelectorSearch() shim             ← progress→done transition + 1.5 s flash
│   ├─ #enrichCard()                             ← isInstalling / justInstalled flags
│   └─ #wireResultListeners install branch       ← optimistic state set + render({parts:["results"]})
├─ templates/cloud-v2/parts/results-pane.hbs
│   ├─ Card outer adds bc-card-installing / bc-card-just-installed
│   └─ Action area adds card.isInstalling spinner-pill branch
├─ css/beneos-cloud.css
│   ├─ .beneos-cloud-login-dialog                ← max-width 360, red-stripe kill, FA unicode fallback, button widths fix, field spacing
│   ├─ @keyframes bc-card-pulse                  ← in-progress card pulse
│   ├─ @keyframes bc-card-flash                  ← just-installed flash
│   └─ .bc-state-installing                      ← spinner pill
└─ lang/{13 lang files}.json                     ← +8 keys, 493 keys total verified
    ├─ +BENEOS.Cloud.Login.WindowTitle
    ├─ +BENEOS.Cloud.Login.Description
    ├─ +BENEOS.Cloud.Login.EmailLabel
    ├─ +BENEOS.Cloud.Login.PasswordLabel
    ├─ +BENEOS.Cloud.Login.Submit
    ├─ +BENEOS.Cloud.Login.Cancel
    ├─ +BENEOS.Cloud.Card.Installing
    └─ +BENEOS.Cloud.Card.InstallingTooltip
```

## Inline comment anchors

Search for `Wave B-5d` in `scripts/beneos_cloud.js`, `scripts/cloud-v2/cloud-window-v2.mjs`, `templates/beneos-cloud-login.html`, `templates/cloud-v2/parts/results-pane.hbs`, `css/beneos-cloud.css`.

## Test sequence

1. **Login modal look** — log out, click "Sign in". Dialog max-width ~360 px, e-mail and password fields visually separated, no inner header repeat, no red stripe, close-X icon visible, submit/cancel buttons normal width with the gold accent on submit.
2. **No-reload login** — open a journal entry editor in another window and leave it dirty. Run the Beneos Cloud login flow. The journal editor stays open and dirty after login completes; only the V2 window's sidebar / results / footer re-render.
3. **No-reload disconnect** — same setup, click disconnect: V2 window updates, journal editor remains untouched.
4. **Install progress (click)** — click install on a cloud-available token card. Card pulses with the gold border during the cloud roundtrip, flashes green for ~1.5 s when the import completes, then settles into the normal installed state.
5. **Install progress (drag-to-canvas)** — drag a cloud token card onto the canvas. Same visual state on the original card while the import runs, same flash on completion.
6. **V1 mode** — toggle the `beneos-search-engine-version` setting back to v1, reload Foundry. Legacy UI unchanged, login still uses its old reload path (intentional — v1 has no partial-render hook).
7. **i18n** — switch Foundry language to `de`, then `pt-BR`, then `zh-TW`. Login modal labels and the new install-progress tooltip localize correctly with no English fallback bleed-through.
8. **V14 smoke** — second Foundry instance against the SYNC datapath, identical behavior to V13.

## Known limits / next

| Topic | Wave |
|---|---|
| Variant carousel inside the drawer (tokens with multiple skins) | B-6 |
| Quick Picker (separate compact window) | B-7 |
| Theme switcher (parchment / neutral activation) | B-7 |
| Self-hosted Inter + Fraunces fonts | B-3b or with V2 polish |
| Battlemap cloud download pipeline (replaces the Moulinette hand-off from B-5c) | B-8 (server coordination) |
| Releases / map clusters by campaign | B-8 |
| Storage quota in the status footer | B-8 |

## Related docs

- `docs/welle-B-5c-summary.md` — hotfix wave (spellKey/itemKey scope, Maps tab, login dialog classes)
- `docs/welle-B-5-summary.md` — V2 cards + detail drawer
- `docs/welle-B-4-summary.md` — V2 unified window skeleton
- `docs/welle-B-3-summary.md` — design tokens
- `docs/welle-B-1-summary.md` — hardening waves
- `docs/cloud-ux-briefing.md` — strategic UX briefing
