# Wave B-7 — Implementation Summary for Code Review

> Status: 2026-04-29. Three concrete UX improvements driven by user testing of B-6: result-card thumbnails were too small to read for token portraits, the battlemap action button said "Install" but actually handed off to Moulinette without telling Moulinette what to look for, and the drawer showed only one image even though many Beneos maps ship as scenery + battlemap pairs. All three fixes stay client-side; no server change.

## Themes

### 1. Wider card thumbnails for tokens / items / spells

Cards used a `64×64` thumb in a `grid-template-columns: 64px 1fr auto` layout. Token portraits especially suffered — most of the visual identity comes from the rendered creature, which got compressed to a tiny circle. Now the default card grid is `96px 1fr auto` and the thumb is `96×64` (3:2-ish), with `object-fit: cover` so the portrait zooms in and crops top/bottom. Reads as a wider preview window without distorting the image.

Battlemap thumbnails stay square — they're scenery shots and look better square than cropped — via a scoped override:

```css
.beneos-cloud-app .bc-result-card[data-asset-type="bmap"] {
  grid-template-columns: 64px 1fr auto;
}
.beneos-cloud-app .bc-result-card[data-asset-type="bmap"] .bc-card-thumb {
  width: 64px;
  height: 64px;
}
```

The grid columns and thumb dimensions are switched together so the card stays balanced.

### 2. Maps card action: "Moulinette" with pre-filtered search

Until the cloud-bmap pipeline ships in B-8, battlemap installs flow through Moulinette. B-5c routed clicks to `_onMoulinetteInstall` which opened the generic Moulinette browser — the user then had to find the right map by hand. B-7 calls Moulinette's actual search API with the bmap's `download_pack` / `download_creator` / `download_terms` so Moulinette opens directly on the matching map. Mirrors v1's call at `beneos_search_engine.js:1158`:

```js
game.modules.get("moulinette").api.searchUI("mou-cloud", "Map", {
  terms:   props.download_terms   || "",
  creator: props.download_creator || "",
  pack:    props.download_pack    || ""
})
```

The button itself flips its label and icon for bmaps. `#enrichCard` now exposes `card.isBmap`; both the template and the JS patch path (`#buildCardActionsHTML`) render a Moulinette-branded button (`fa-cube` icon + `BENEOS.Cloud.Card.Moulinette` label) instead of the standard "Install" / `fa-cloud-arrow-down` for cloud-available bmaps. The `bc-action-moulinette` class is reserved for future Moulinette-specific styling.

If a bmap has no `download_*` fields registered (rare; mostly old database entries), the handler surfaces a notification instead of opening Moulinette with empty filters.

### 3. Bmap drawer shows the paired sibling

I had previously claimed the database didn't expose paired siblings. That was wrong — `properties.sibling` holds the partner key and v1's `getSiblingPicture` (`beneos_search_engine.js:666`) resolves the URL. Fixed in this wave.

`#enrichCard` looks the sibling up directly via `dbHolder.getAll("bmap")[props.sibling]` and exposes `siblingThumbUrl` on the card. The drawer template renders both images side-by-side in a `bc-drawer-pair` grid (`grid-template-columns: 1fr 1fr`) when a sibling exists, falling back to the single-hero view for everything else. The sibling image carries a small lower-left label ("Paired view") so it's clear which one is which.

Pure data-presentation change — no extra cloud calls, no install logic touched.

## Files touched

```
MODIFIED:
├─ scripts/cloud-v2/cloud-window-v2.mjs
│   ├─ #enrichCard()              → +siblingThumbUrl (bmap), +isBmap flag
│   ├─ #buildCardActionsHTML()    → bmap branch returns Moulinette button
│   ├─ #onInstallClick()          → bmap path passes asset key (not name) to handler
│   └─ static _onMoulinetteInstall() → calls Moulinette searchUI with download_* properties
├─ templates/cloud-v2/parts/results-pane.hbs
│   ├─ {{#if card.isBmap}}        → Moulinette button branch in card actions
│   └─ {{#if drawer.asset.siblingThumbUrl}} → bc-drawer-pair grid in drawer
├─ css/beneos-cloud.css
│   ├─ .bc-result-card grid       → 96px 1fr auto (default, wider thumb)
│   ├─ [data-asset-type="bmap"]   → 64px 1fr auto (square thumb override)
│   ├─ .bc-card-thumb              → 96×64 default, override 64×64 for bmaps
│   └─ .bc-drawer-pair / .bc-drawer-sibling / .bc-drawer-sibling-label → +30 lines
└─ lang/{13 lang files}.json
    ├─ +BENEOS.Cloud.Card.Moulinette
    ├─ +BENEOS.Cloud.Card.MoulinetteTooltip
    ├─ +BENEOS.Cloud.Drawer.Sibling
    └─ +BENEOS.Cloud.Notification.MoulinetteNoTerms

UNCHANGED:
├─ scripts/beneos_cloud.js                ← cloud API untouched
├─ scripts/beneos_search_engine.js (V1)   ← legacy path untouched
└─ Server / cloud endpoints
```

## Inline comment anchors

Search for `Wave B-7` in `scripts/cloud-v2/cloud-window-v2.mjs`, `templates/cloud-v2/parts/results-pane.hbs`, `css/beneos-cloud.css`.

## Test sequence

1. **Smoke**: Foundry V13 reload, V2 active, search engine opens with no console errors.
2. **Tokens tab**: cards have a clearly visible wider thumbnail (96×64), portraits read as proper preview windows, layout is consistent across the list.
3. **Items / Spells tabs**: same wider thumbnail; icons are still readable (object-fit: cover with center crop).
4. **Maps tab**: cards still use square 64×64 thumbnails, layout is unchanged from B-6.
5. **Maps card click**: action button reads "Moulinette" with a cube icon (instead of "Install"). Clicking it opens Moulinette pre-filtered to the matching map (verify Moulinette's search field/dropdowns reflect the bmap's pack/creator/terms).
6. **Maps card without download_***: clicking still tries Moulinette but surfaces "MoulinetteNoTerms" notification (rare, mostly legacy database entries).
7. **Bmap drawer with sibling**: open a battlemap that has a paired view (e.g. a scenery + battlemap combo). Drawer shows both images side-by-side with a "Paired view" label on the sibling.
8. **Bmap drawer without sibling**: open a battlemap that has no `properties.sibling`. Drawer shows the single hero image as before.
9. **Token / item / spell drawer**: hero image unchanged, no sibling section.
10. **Language switch** (de): "Moulinette" stays "Moulinette" (brand name); tooltip + sibling label localize.
11. **V1 mode** (toggle setting back to v1): legacy UI unchanged, no regressions.
12. **V14 smoke**: identical behavior in second Foundry instance.

## Known limits / next

| Topic | Wave |
|---|---|
| Cloud-side battlemap install pipeline (replaces the Moulinette hand-off) | B-8 (server coordination) |
| Filter sidebar redesign — sectioned headings, CR slider, SRD/Patreon checkboxes, Campaign block | B-8b (planned next) |
| Grid view toggle (List ↔ Grid card layout) | B-9 (planned, user requested for visual users) |
| Header bar polish (logo + sign-in chip + theme toggle layout from mockup) | Deferred — current header is acceptable |
| Variant carousel inside the result card (outside the drawer) | Out of scope — variants stay in the drawer |
| True-progress install events from the server | B-8 |

## Related docs

- `docs/welle-B-6-summary.md` — variant carousel in detail drawer
- `docs/welle-B-5e-summary.md` — install-feedback polish (drag visual, full-card sweep, in-place patching, infinite scroll)
- `docs/welle-B-5d-summary.md` — login polish, no-reload login, 4-state install button
- `docs/welle-B-5c-summary.md` — hotfix wave (spellKey/itemKey scope, Maps tab, login dialog classes)
- `docs/welle-B-5-summary.md` — V2 cards + detail drawer
- `docs/welle-B-4-summary.md` — V2 unified window skeleton
- `docs/welle-B-3-summary.md` — design tokens
- `docs/welle-B-1-summary.md` — hardening waves
