# Wave B-5 — Implementation Summary for Code Review

> Status: 2026-04-29. Replaces the v1-result-HTML mount in the V2 unified window with native V2 cards plus a slide-in detail drawer. Solves both the "looks ugly" and the "performance stutters" problems reported on Wave B-4. Server unchanged, data shape unchanged.

## What changes for the user when v2 is active

- The result pane is now a clean list of **V2 cards**: thumbnail (left) — name + tags (middle) — install state / install button (right). No more legacy v1 markup leaking into the V2 container.
- Click anywhere on a card (except the install button) → a **detail drawer** slides in from the right with hero image, type-specific fields (CR / Faction / Level / School / Rarity / Variants / Source) and a description block. A close button or another card click closes it.
- Hover and active states use the Beneos-Gold accent (`--bc-accent`); installed cards have a green left edge, cloud-available cards have a gold left edge.
- "New" / "Update" badges sit on the thumbnail.
- Install / Update buttons inline on each row; clicking them does NOT open the drawer — they trigger the existing import pipeline (idempotency lock from B-1b applies).
- Drag and drop continues to work for tokens (B-1d local-drag and cloud-drag pipelines).

## Performance fixes folded in

- Each card uses CSS `content-visibility: auto` with `contain-intrinsic-size: 0 80px`. Browsers skip rendering for offscreen cards — the main reason a 500-token list and the Foundry canvas behind the window now stay smooth when the window is dragged.
- The result region uses `contain: layout style paint` so window drags do not invalidate Foundry's canvas paint tree.
- The detail drawer is itself a contained region with a CSS-only slide transform (`translateX`), no JS animation loop.

## Files touched

```
NEW:
└─ docs/welle-B-5-summary.md                        ← this file

MODIFIED:
├─ scripts/cloud-v2/cloud-window-v2.mjs             ← native render: _preparePartContext
│                                                     for "results" returns enriched
│                                                     cards[] + drawer state; new
│                                                     listeners for card click,
│                                                     install button, close drawer,
│                                                     dragstart (mirrors v1 logic for
│                                                     B-1d compat)
├─ templates/cloud-v2/parts/results-pane.hbs        ← V2 card list + embedded drawer
├─ css/beneos-cloud.css                             ← V2 card / drawer / performance
└─ lang/{en,de,fr,es,it,pt-BR,pt-PT,pl,cs,ca,ja,ko,zh-TW}.json
                                                    ← +21 BENEOS.Cloud.{Card,Drawer,Results}.* keys
                                                      (English text in all 13 files;
                                                      same convention as Waves B-1+)

UNCHANGED (deliberate):
├─ scripts/beneos_cloud.js                          ← all cloud calls reused 1:1
├─ scripts/beneos_search_engine.js                  ← v1 BeneosSearchEngine + Launcher
├─ scripts/beneos_module.js                         ← dropCanvasData hook unchanged
├─ scripts/beneos_utility.js                        ← settings unchanged
├─ templates/beneossearchengine.html                ← v1 template untouched
├─ templates/beneos-search-results-*.html           ← v1 result templates not used by v2 anymore
├─ css/beneos.css                                   ← v1 styles
├─ css/beneos-cloud-tokens.css                      ← B-3 design tokens
└─ module.json                                      ← no manifest change
```

## Inline comment anchors

Search for `Wave B-5` in `scripts/cloud-v2/cloud-window-v2.mjs` and `templates/cloud-v2/parts/results-pane.hbs`. The B-1d drag handlers are explicitly cross-referenced in the dragstart code with `Wave B-1d` comments.

## Architecture decisions worth knowing

1. **Native render through HandlebarsApplicationMixin parts** — `_preparePartContext("results", context)` returns `cards: [...]` and `drawer: { open, asset }`. A re-render of the `results` part is now the single mechanism for changing the result list (filter change, tab switch, drawer open/close, install completed). No more imperative DOM mounting via `innerHTML = ...`.
2. **Card data is enriched in JS, not in templates** — `#enrichCard()` builds `thumbUrl`, `typeLabel`, `dragMode`, `documentId`, `dragType`, `isInstalled`, `isCloudAvailable` etc. from the legacy per-asset processors (`processInstalledToken/Item/Spell`). The template is a pure rendering layer, no helper logic.
3. **Filter logic is duplicated, not shared** — `BeneosSearchEngine.processSelectorSearch` is an instance method tied to the v1 Dialog. V2 reimplements the equivalent with a small filter-def list `V2_FILTER_DEFS` at the top of the module. If the v1 filter list grows, this is the place to mirror it.
4. **Drag-drop selectors compatible with B-1d** — every card carries `data-document-id`, `data-type`, `data-drag-mode`, `data-token-key`. The dragstart listener in `#wireResultListeners()` re-implements v1's drag logic (compendium UUID for installed, phantom marker for cloud, `importItemFromCloud` / `importSpellsFromCloud` immediate trigger for items/spells). The B-1d `dropCanvasData` hook in `beneos_module.js` does not need to know about V2 vs v1.
5. **Drawer is part of the results template, not a separate Foundry part** — single template re-render covers both list and drawer state. Trade-off: drawer open/close re-renders the full card list; in practice negligible because content-visibility skips offscreen cards.
6. **Click delegation via direct listeners, not Foundry actions** — Foundry's `actions: {…}` declarative system did not fit cleanly because of the click-on-card-but-not-button distinction. Hand-wired listeners in `#wireResultListeners()` instead.

## Test sequence

1. **Setting v2 active** (Settings → Beneos → Beneos Cloud — Search Engine Version → V2). Reopen the search engine.
2. **Card list renders** — clean V2 cards with thumbnails, tags, action buttons. No more raw v1 layout.
3. **Performance**: drag the window over the canvas — should be smooth now. Move the mouse over the canvas behind the window — no stutter.
4. **Hover a card** — background lifts to `--bc-card-hover`, border becomes brighter.
5. **Click a card** — drawer slides in from the right, shows hero, type-specific fields, description.
6. **Click the same card again** (or a different one) — drawer updates to the new asset; no jank.
7. **Click the close-X in the drawer** — drawer slides out.
8. **Click the install button on a card** — does NOT open the drawer; existing import pipeline runs (`importTokenFromCloud` etc.); after completion the badge flips to "installed" via the soft refresh from B-1c.
9. **Drag a cloud-available card to the canvas** — B-1d cloud-drag pipeline runs (notification "Importing… will appear at drop position"), token spawns at coordinates after import.
10. **Drag an installed card to the canvas** — B-1d local-drag pipeline runs, single token at drop position, no duplicate world actor.
11. **Switch tabs** — drawer closes (intentional: drawer state is per-mode), filter sidebar updates, result list re-renders for the new mode.
12. **Filters in the sidebar** — text search and dropdowns update the result list with a small debounce; `V2_FILTER_DEFS` drives the dropdown filtering.
13. **Empty state** — search for something that yields no results → empty-state placeholder appears.
14. **Switch back to v1** — legacy UI unchanged, no regression.

## Things to verify by hand

- The `processInstalledToken/Item/Spell` calls inside `#buildCards` mutate the raw asset objects from `BeneosDatabaseHolder.getAll(type)`. These objects are shared with v1, so v1 sees the updated `isInstalled` flags too. Should be benign, but if v1 looks weird after a v2 session, that's the suspect.
- The `searchByProperty` call relies on the static method on `BeneosDatabaseHolder.constructor`. If it expects a different argument shape between versions, the V2 dropdown filter chain fails silently (returns the unfiltered list). Easy to spot at runtime.
- Drawer description rendering uses `{{{drawer.asset.description}}}` (triple-stache, raw HTML). The legacy database descriptions are trusted content from Beneos's CDN; if the schema ever embeds untrusted user HTML, switch to `{{drawer.asset.description}}` (escaped) and add a sanitizer.

## What is NOT in this wave (planned for later)

| Topic | When |
|---|---|
| Grid view toggle | Wave B-6 (or later) |
| Variant carousel inside the drawer (token sub-images) | Wave B-6 |
| Quick Picker (separate compact window) | Wave B-7 |
| Theme switcher (parchment / neutral) | Wave B-7 |
| Self-hosted Inter + Fraunces | Wave B-3b or with V2 polish |
| Storage quota in the status footer | server enrichment, deferred |
| Releases (map clusters by campaign) | server enrichment, deferred |
| Paired maps (battlemap+scenery crossfade) | server enrichment, deferred |

## Related docs

- `docs/welle-B-1-summary.md` — hardening waves (B-1a/b/c/d)
- `docs/welle-B-3-summary.md` — design token CSS
- `docs/welle-B-4-summary.md` — V2 unified window skeleton
- `docs/cloud-ux-briefing.md` — strategic UX briefing
- `docs/design-2.0-mapping.md` — V2 mockup mapped onto code locations
