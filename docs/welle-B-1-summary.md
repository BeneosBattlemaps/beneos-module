# Wave B-1 — Implementation Summary for Code Review

> Status: 2026-04-29. All changes are on the current branch in the Foundry V13 datapath. No build step (ESM + Handlebars + hot-reload), no `module.json` schema changes outside the styles array, no server / backend touch. Manual tests in Foundry V13/V14 required (the module has no automated test suite).

## Wave overview (all four sub-waves shipped)

| Wave | Theme | Issue IDs |
|---|---|---|
| **B-1a** | Cloud-layer hardening — small bug fixes without UI changes | B1, B2, B5, C3, C5, E4, E7, F1 |
| **B-1b** | Idempotency lock — prevents parallel pipelines on multi-click | E3 |
| **B-1c** | Soft refresh instead of close+reopen — no flicker, no stacked welcome boxes | C2 |
| **B-1d** | Smooth drag & drop for tokens — local-drag without duplicate, cloud-drag-to-canvas in one shot | (UX enhancement, no vulnerability ID) |

Issue IDs reference the vulnerability catalogue (kept in Beneos's local notes) and the briefing in `docs/cloud-ux-briefing.md`.

## Thematic summary

### Cloud-layer stability (B-1a)
- Multi-hyphen item / spell keys now correctly resolve (`replaceAll`)
- `availableContent` starts as a clean object — no `undefined` errors during the first seconds after Foundry start
- `checkAvailableContent()` is async/await; login awaits it — UI sees populated data on first render
- Settings updates after asset import only happen if the compendium document was actually created
- `noWorldImport` flag is reset at every single-install entry (no more "leftover state" after a batch crash)
- FilePicker typo fixed in the battlemap upload path (was dead code today, but ready for a future cloud-battlemap integration)
- `encodeURIComponent` at every URL build site — asset keys with special characters work again
- 24 hardcoded English notifications → `game.i18n.localize/format()` with new `BENEOS.Cloud.Notification.*` keys (initial English text in all 13 lang files; translations can be filled in later without code changes)

### Idempotency (B-1b)
- New `inflightImports` set on `BeneosCloud` prevents double-clicks on "Install" from spawning parallel pipelines
- 4–5× clicking previously spawned 4–5 parallel imports → compendium duplicates, "Cannot delete journal: id does not exist" errors, multiple stacked search engines. Now: first click starts, further clicks show an "X is already being imported" notification

### Render smoothness (B-1c)
- `BeneosSearchEngineLauncher.softRefresh(typeAsset, key)` replaces `closeAndSave() + setTimeout(100) + new Launcher().render()` at three single-install paths
- Uses two pre-existing helpers (`refresh()` and `processSelectorSearch()`) that were not actively wired up — no new architecture
- The welcome-box flag in `showBattlemapNotice` was lifted from `this.battlemapNoticeShown` to `game.beneos.battlemapNoticeShownThisSession` — survives close+reopen, appears at most once per Foundry session
- Batch-install path deliberately unchanged — close+reopen at the end is acceptable UX there

### Drag & drop UX (B-1d)
- Local drag (installed token onto canvas): dragstart now sets the world-actor UUID instead of the compendium UUID, found via flag lookup. Foundry only places one token at the drop position; no duplicate world actor in the Actor browser anymore
- Cloud drag (not-installed token onto canvas): new pipeline using a phantom marker in dataTransfer + `dropCanvasData` hook + `pendingCanvasDrops` map on BeneosCloud + drain after successful import. Multi-drop capable (3 drags = 3 tokens at 3 positions). Install failure discards pending drops with a notification.
- Items / spells are unchanged (Foundry has no canvas-drop concept for them)

## Files touched

```
scripts/
├─ beneos_cloud.js              [B-1a: ~8 sites | B-1b: 4 functions + new lock | B-1c: 3 sites | B-1d: ~5 new methods + 2 cleanup sites]
├─ beneos_search_engine.js      [B-1c: new softRefresh method + welcome-box flag | B-1d: dragstart handler fully rewritten]
└─ beneos_module.js             [B-1d: new dropCanvasData hook at the bottom]

lang/{en,de,fr,es,it,pt-BR,pt-PT,pl,cs,ca,ja,ko,zh-TW}.json
                                [+25 new BENEOS.Cloud.Notification.* keys, 422 keys total]
```

## Inline comment anchors

Every edit carries an inline comment naming its issue ID — search the editor for `// Fix #` (or `/* Fix #`) to find every change:

- `// Fix #B1:` — initial-state shape (1×)
- `// Fix #B2:` — async checkAvailableContent (3×)
- `// Fix #B5:` — replaceAll handles multi-hyphen (5×)
- `// Fix #C2:` — soft refresh / welcome box flag (5×)
- `// Fix #C3:` — settings update only on success (4×)
- `// Fix #C5:` — noWorldImport reset (3×)
- `// Fix #E3:` — idempotency lock (5+×)
- `// Fix #E4:` — FilePicker.upload typo (1×)
- `// Fix #E7:` — encodeURIComponent (1× block comment)
- `// Fix #F1:` — chat HTML i18n (1×)
- `// Fix #B-1d` — drag & drop refactor (multiple)

## What was deliberately NOT touched

- **Templates** (`templates/*.html`) — UI layer; reserved for the V2 redesign (Wave B-3+)
- **CSS** (`css/beneos.css`) — likewise reserved for V2 (initial token migration shipped separately as Wave B-3 — see `welle-B-3-summary.md`)
- **`module.json`** — no manifest change needed for B-1 (Wave B-3 added the token CSS to `styles[]`)
- **Batch-install path** — close+reopen at the end deliberately kept; the long-running batch with progress chat already implies a "done" reset
- **Asset removal paths** in `beneos_utility.js` (3×) and `beneos_compendium.js` (1×) — rare flow, "engine closes" behavior acceptable there
- **`closeAndSave()` method itself** — still called from those asset-removal paths, deliberately kept
- **jQuery sites** (G2 — V14 risk) — handled in a dedicated V14-migration pass
- **POST login** (A10) — needs server coordination, scheduled later
- **Patreon live refresh** (A8) — discarded under the "in-dubio-pro-reo" directive

## Test sequence

Manual tests in the Foundry V13 WORK datapath. Recommended order:

1. **Smoke**: start Foundry, activate the module, check the console for errors
2. **Login + search engine**: log in; the welcome box appears once; click "Got it" — should stay gone for the session
3. **Single token install via click**: no flicker, token badge flips to "installed", welcome box does not reappear, scroll position holds
4. **Multi-click on a "New" token**: first click starts the install; further clicks show the "is already being imported" notification; NO compendium duplicates
5. **Drag & drop installed token onto canvas**: only ONE token at the drop position; NO duplicate actor in the Actor browser
6. **Drag & drop cloud token onto canvas**: notification "Importing… will appear at drop position", token appears at the dropped coordinates 3–5 s later
7. **Multi-drag of the same cloud token**: drop at 3 different positions → 3 tokens at 3 positions after install
8. **Switch Foundry language**: notifications now come from the lang file (English initial — translations can be filled in later)
9. **Tour**: the 16-step tour runs unchanged — no tour selectors were touched
10. **V14 smoke**: second Foundry instance in the SYNC datapath — identical behavior

## Architecture decisions worth knowing

1. **Welcome-box strategy**: appears only once per Foundry session (not after every install anymore). Permanent dismissal via the existing `beneos-bmap-notice-dismissed` setting. No new setting introduced.
2. **Cloud-drag hook**: only `dropCanvasData` is registered (not `preCreateToken` or other). Phantom marker in dataTransfer is `{ beneosCloudPending: true, beneosTokenKey: "..." }` — distinctive enough; no conflict with Foundry standard drops.
3. **Pending-drops map**: lives in-memory on the `BeneosCloud` singleton. Lost on Foundry reload — acceptable, since pending drops only exist for ~5 seconds at most.
4. **In-dubio-pro-reo directive** (user request): when status is uncertain (loading, race), show optimistically rather than locking down. Reflected in B1+B2 — the UI surfaces content as soon as remotely possible, never "not available" as a default.

## Related docs in the repo

- `docs/cloud-ux-briefing.md` — strategic briefing on user perception and the hardening roadmap
- `docs/design-2.0-mapping.md` — mapping of the planned V2 design to existing code locations (Wave B-3+ context)
- `docs/welle-B-3-summary.md` — first visual upgrade (CSS token system + Beneos gold)

If review questions come up about specific sites — the inline comments link to the issue catalogue with the rationale (kept in Beneos's local notes). For diagnostic questions: log file + screenshot is enough; punctual rollbacks per `// Fix #X:` anchor are easy.
