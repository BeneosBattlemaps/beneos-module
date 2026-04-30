# Wave B-5e — Implementation Summary for Code Review

> Status: 2026-04-29. Polish wave on top of B-5d. Three install-feedback issues, all in the V2 path: drag&drop installs had no visual progress indicator (only click-install did), the existing pulse on the small button area was too subtle, and the result list visibly jumped after a successful install because the whole results part was being re-rendered. All three converged on one architectural change — in-place card patching instead of full part re-render.

## Themes

### 1. Drag&drop now shows the same install-progress visual as click-install

Before: clicking the install button on a card flipped `installState` and triggered a re-render so the card showed the "installing" state. Dragging the same card onto the canvas only set `pendingCanvasDrops` and called the import pipeline — there was no `render()` call, so the card stayed in its idle "cloud available" look while the import ran underneath.

Now: `BeneosCloudWindowV2` exposes two public hooks — `notifyInstallStarted(key)` and `notifyInstallEnded(key, success)`. They're called from:

- `BeneosCloud.handlePendingCanvasDrop(...)` — drag-install starts.
- `BeneosCloud.drainPendingCanvasDrops(...)` — drag-install finished successfully.
- `BeneosCloud.discardPendingCanvasDrops(...)` — drag-install failed.

Each call is optional-chained (`game.beneos?.cloudWindowV2?.notifyInstallStarted?.(...)`), so v1 mode and a closed V2 window stay no-ops. The same notify API is also used by the click-install handler so the two paths produce identical visuals.

### 2. Full-card-row sweep replaces the button-area pulse

Before: `bc-card-installing` set a 1.6s ease-in-out pulse on the card's background color. The change was tiny relative to the card and easy to miss, especially when the install button was the only obvious affordance.

Now: a `::before` pseudo-element overlay grows from `width: 0%` to `width: 90%` over an asset-type-specific duration via the `bc-card-fill` keyframe animation. The card content sits at `z-index: 2` so the gold gradient sweeps behind it. The animation uses `animation-fill-mode: forwards` and intentionally tops out at 90% — JS triggers the snap-to-100% via the `bc-card-just-installed` class once the actual import pipeline finishes. Same pattern as Chrome's download bar: heuristic progress that matches reality without true pipeline instrumentation.

Asset-type-specific durations:
- Token: `4s` (one fetch + multiple base64 image uploads + compendium create)
- Item / Spell: `1.5s` (lighter)
- Bmap: `1.5s` (Moulinette bridge — value doesn't matter, no real install runs in-module)

The duration is set as an inline `--bc-install-duration` CSS variable on the `<article>` so each card animates at the correct speed.

### 3. In-place card patching instead of full part re-render

Before: `processSelectorSearch()` (the V1-API compat shim) called `render({ parts: ["results"] })` to rebuild the entire result list after a per-asset install update. The scroll position reset, the card list briefly disappeared, and `content-visibility: auto` re-evaluated lazy-load state for every card. Installing a creature halfway down the list snapped the view to a different one.

Now: a new private method `#patchCardState(key)` finds `[data-asset-key="<key>"]`, re-runs the same `processInstalled* + #enrichCard` pipeline as the initial render, and mutates only that card's DOM:

- Outer classes: `bc-card-installed`, `bc-card-cloud`, `bc-card-installing`, `bc-card-just-installed`.
- Inline `--bc-install-duration` for the sweep animation.
- `data-document-id`, `data-drag-mode`, `draggable` (these can flip when an asset transitions cloud → installed because the local-drag world-actor uuid only exists post-install — Wave B-1d).
- `.bc-card-actions` innerHTML — rebuilt via `#buildCardActionsHTML(card)` which mirrors the `{{#if}}` chain in `results-pane.hbs`.
- The newly inserted install button gets its click listener re-bound through the shared `#onInstallClick` handler. The dragstart listener sits on the outer `<article>` and survives the inner-HTML swap.

`processSelectorSearch()` now patches the affected cards instead of re-rendering. Card position in the DOM never changes, scroll position stays exactly put, and the green flash plays on the same card the user was looking at.

## Files touched

```
MODIFIED:
├─ scripts/cloud-v2/cloud-window-v2.mjs
│   ├─ #enrichCard()              → returns installDuration ("4s" / "1.5s")
│   ├─ processSelectorSearch()    → in-place patches, no render({parts:["results"]})
│   ├─ notifyInstallStarted(key)  → public, sets state + patches card
│   ├─ notifyInstallEnded(k, ok)  → public, transitions to done with flash, or clears on failure
│   ├─ #patchCardState(key)       → DOM patcher (outer classes, drag attrs, action HTML)
│   ├─ #buildCardActionsHTML(c)   → mirrors the .hbs {{#if}} chain in JS
│   ├─ #onInstallClick(e, btn)    → shared install-click handler (initial + patched buttons)
│   └─ #wireResultListeners       → uses #onInstallClick for the install buttons
├─ scripts/beneos_cloud.js
│   ├─ handlePendingCanvasDrop    → notifyInstallStarted(tokenKey)
│   ├─ drainPendingCanvasDrops    → notifyInstallEnded(tokenKey, true)
│   └─ discardPendingCanvasDrops  → notifyInstallEnded(tokenKey, false)
├─ templates/cloud-v2/parts/results-pane.hbs
│   └─ <article> outer            → +style="--bc-install-duration: {{card.installDuration}};"
└─ css/beneos-cloud.css           ← Wave B-5d animations replaced
    ├─ .bc-result-card.bc-card-installing       → sweep via ::before width 0→90%
    ├─ @keyframes bc-card-fill                  → 0% → 55% → 80% → 90% holds at 90%
    ├─ .bc-result-card.bc-card-just-installed   → green ::before width: 100%
    ├─ @keyframes bc-card-flash                 → opacity 1 → 0 over 1.5s
    └─ .bc-state-installing                     → unchanged
```

## Inline comment anchors

Search for `Wave B-5e` in `scripts/cloud-v2/cloud-window-v2.mjs`, `scripts/beneos_cloud.js`, `css/beneos-cloud.css`.

## Test sequence

1. **Smoke**: Foundry V13 reload, V2 active, search engine opens with no console errors.
2. **Click-install with scroll**: scroll ~60 % down the token list, click install on a "Cloud available" token. Card background fills left-to-right over ~4 s, scroll position stays exactly put, green flash, settled state with "Installed" pill.
3. **Click-install Item / Spell**: same — animation runs ~1.5 s.
4. **Drag&drop cloud token onto canvas**: original card pulses with the same sweep, token drops at the cursor position once the import finishes, card transitions to "Installed".
5. **Multi-drag**: drag the same cloud card three times in quick succession. Card keeps pulsing, all three tokens land at their respective drop positions (B-1d behavior preserved).
6. **Drag&drop install failure** (e.g., simulated server reject): card snaps out of the pulse back to "Cloud available", error notification, no token on canvas.
7. **Filter active + install**: set a filter (e.g., Forest + Beast), install a token in the filtered list. Filter stays applied, list position stays, only the one card animates.
8. **Very fast install** (item / small asset): if completion fires before the 1.5 s animation finishes, the green flash overrides the in-progress sweep — no awkward half-finished state.
9. **Very slow install** (large token / slow link): bar holds at 90 %, no auto-completion before the server actually finishes.
10. **V1 mode**: toggle `beneos-search-engine-version` back to v1 → legacy UI unchanged, no regressions.
11. **V14 smoke**: second Foundry instance against the SYNC datapath, identical behavior.

## Known limits / next

| Topic | Wave |
|---|---|
| True progress reporting (instrument the import pipeline with real % events) | B-8 (server coordination) |
| Animation in v1 path | Never — v1 is frozen, V2 is canonical |
| Detail drawer card sweep on install | Optional, B-6 (variant carousel wave) |
| Batch install progress (multiple cards at once) | B-7 territory (currently runs through the v1 batch path) |
| Variant carousel inside the drawer | B-6 |
| Quick Picker (separate compact window) | B-7 |
| Theme switcher (parchment / neutral activation) | B-7 |

## Hotfixes after the initial wave

Four follow-up fixes shipped on top of the initial B-5e implementation, all driven by user testing:

### fix-1c — Drop content-visibility / contain on result cards

The original card CSS combined `position: relative`, `overflow: hidden`, `content-visibility: auto`, `contain: layout style paint`, and `contain-intrinsic-size: 0 80px`. Toggling the `bc-card-installing` class on this stack triggered a layout re-evaluation that briefly used the intrinsic size, producing a partial-height progress bar (only the top ~10% of the row) and a perceptible card shrink. With the 100-cap from fix-2 (now infinite scroll under fix-4) the perf containment is no longer load-bearing — only `position: relative` remains on the base card, the `::before` carries `border-radius: var(--bc-radius)` so it stays inside rounded corners without the overflow clip, and the card height is fully content-driven again.

### fix-2 — 100-cap on V2 results (later evolved into fix-4 pagination)

V2 originally rendered all matching entries (~700 tokens on a fresh install). Mirrors v1's behavior at `beneos_search_engine.js:1463`. Implemented as `RESULTS_CAP = 100` in `BeneosCloudWindowV2` with a `cappedHint` string in the part context. Soon replaced by fix-4 (the cap was rigid; user wanted to browse beyond the first 100).

### fix-3 — Custom drag image (thumbnail instead of full row clone)

`#onCardDragStart` calls `event.dataTransfer.setDragImage(thumbImg, 32, 32)` so the cursor carries a 64×64 token thumbnail centered on the pointer. Falls back to the browser default when the thumbnail hasn't loaded yet (`thumbImg.complete && naturalWidth > 0` guard). Makes the drag feel like "I'm carrying a token", not "I selected a UI element".

### fix-4 — Infinite scroll: progressive loading

Replaced the rigid 100-cap with `loadedCount` instance state (initial 100, RESULTS_PAGE = 100):

- `#wireScrollLoader()` binds a scroll listener on the new `.bc-result-list` element after every render. Distance-from-bottom < 200px and `_hasMoreResults` triggers `#loadMore()`.
- `#loadMore()` captures `scrollTop`, increments `loadedCount`, awaits `render({ parts: ["results"] })`, then restores `scrollTop` on the freshly rebuilt list element. User lands exactly where they were before the new page appeared.
- `#resetPagination()` returns to page one on filter change (text + dropdown), tab switch, and reset-filters click.
- `_loadingMore` lock prevents parallel triggers during a re-render.
- i18n key renamed `BENEOS.Cloud.Results.Capped` → `BENEOS.Cloud.Results.Partial`. New text: "Showing {loaded} of {total} matches — scroll to load more." (de localized, remaining 11 languages English fallback per Beneos pattern).

## Related docs

- `docs/welle-B-5d-summary.md` — login polish + no-reload login + 4-state install button
- `docs/welle-B-5c-summary.md` — hotfix wave (spellKey/itemKey scope, Maps tab, login dialog classes)
- `docs/welle-B-5-summary.md` — V2 cards + detail drawer
- `docs/welle-B-4-summary.md` — V2 unified window skeleton
- `docs/welle-B-3-summary.md` — design tokens
- `docs/welle-B-1-summary.md` — hardening waves
