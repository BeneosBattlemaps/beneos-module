# Wave B-6 — Implementation Summary for Code Review

> Status: 2026-04-29. Adds a variant carousel to the V2 detail drawer for tokens shipped as multi-variant bundles. The Beneos catalog ships many tokens as packs (e.g. an Adult Dragon with 12 colored variants — Red, Blue, Green, Black, White, Brass, Copper, Bronze, Gold, Silver, Shadow). Pre-B-6 the drawer only showed the count ("Variants: 12") as a tag — users couldn't preview individual variants or drag a specific one onto canvas. The carousel makes both possible without touching the cloud API or the import pipeline.

## What changed

### Variant data on the card model

`#enrichCard` in `BeneosCloudWindowV2` builds a `variants[]` array for tokens with `nb_variants > 1`:

```js
const nbVariants = props.nb_variants || 1
const variants = []
if (assetType === "token" && nbVariants > 1) {
  for (let i = 1; i <= nbVariants; i++) {
    const variantActorId = BeneosUtility.getActorIdVariant?.(key, i)
    variants.push({
      index: i,
      thumbUrl: `${THUMB_BASE.token}${key}-${i}-db.webp`,
      actorId: variantActorId || "",
      isInstalled: !!variantActorId
    })
  }
}
```

Items, spells, and bmaps stay variantless (`variants: []`). The thumbnail URL pattern follows the v1 convention from `beneos_search_engine.js:484`.

### Drawer carousel section

`templates/cloud-v2/parts/results-pane.hbs` got a new `<section class="bc-variants">` between the hero image (`bc-drawer-hero`) and the details fields (`bc-drawer-fields`). It only renders when `drawer.asset.variants.length > 0`. Each thumbnail is a `<button>` with:

- `data-variant-index`, `data-asset-key`, `data-actor-id` — read by the listeners.
- `draggable="true"` only when the variant is locally installed (the parent token has been imported and the variant's actor exists).
- The first variant gets the `bc-variant-active` class for the initial selection state.
- Cloud-only variants (parent token not yet installed) get the `bc-variant-cloud` class which adds a small Font Awesome cloud icon in the bottom-right corner via CSS `::after`.
- Tooltip differs by state: installed variants say "Variant N", cloud-only ones say "Install token first to drag this variant".

The redundant `Variants: N` field in `bc-drawer-fields` was removed — the carousel header already shows "1 / N" as a counter.

### Click + drag listeners

Three new methods on `BeneosCloudWindowV2`:

- `#wireVariantListeners()` — runs in `_onRender`, binds click on every `.bc-variant-thumb` and dragstart on every draggable variant thumb.
- `#selectVariant(btn)` — pure DOM mutation, no re-render: swaps the hero img's `src` to the clicked thumbnail's URL, toggles the `bc-variant-active` outline across siblings, updates the counter text. The drawer's scroll position and other state stay put because nothing re-renders.
- `#onVariantDragStart(event, btn)` — same shape as the card-level local-drag in `#onCardDragStart` but points at the variant's actor instead of the primary one. Resolves via `game.actors?.get(actorId)` first, falls back to a compendium uuid. Reuses the Wave B-5e-fix-3 pattern with `event.dataTransfer.setDragImage(thumbImg, 28, 28)` so the cursor carries the variant thumbnail.

Cloud-only variants are filtered out at the dragstart binding (`querySelectorAll(".bc-variant-thumb[draggable='true']")`) so the drag is impossible — the user has to install the parent token first. This is intentional: a single Cloud install pulls down all variants together (the v1 import pipeline handles them as a bundle), so dragging one cloud-only variant would either silently install the whole bundle or fail to find an actor. Keeping the drag disabled until the parent is installed avoids both confusions; the cloud icon overlay + tooltip communicate the state.

### CSS

Roughly 60 lines added in `css/beneos-cloud.css` between the install-progress block and the drawer fields:

- `.bc-variants` — top-bordered section, vertical spacing.
- `.bc-variants-head` — flex row with title (uppercase, muted) + counter (dim).
- `.bc-variants-strip` — flex row with `overflow-x: auto` for horizontal scroll on long variant lists (12-variant Dragon fits fine on a 1100px wide window without scrolling, but smaller windows or 16+ variants get a scrollbar).
- `.bc-variant-thumb` — 56×56 button with rounded corners, hover lift, gold-accent active outline.
- `.bc-variant-thumb.bc-variant-cloud::after` — Font Awesome cloud unicode (`\f0c2`) in the corner with shadow for legibility.

## Files touched

```
MODIFIED:
├─ scripts/cloud-v2/cloud-window-v2.mjs
│   ├─ #enrichCard()              → +variants[] for tokens with nb_variants > 1
│   ├─ _onRender()                → +call to #wireVariantListeners
│   ├─ #wireVariantListeners()    → click + dragstart binding
│   ├─ #selectVariant(btn)        → DOM-only hero swap + active toggle + counter
│   └─ #onVariantDragStart(e, btn)→ drag data with variant actorId + custom drag image
├─ templates/cloud-v2/parts/results-pane.hbs
│   ├─ +<section class="bc-variants"> between hero and fields
│   ├─ data-bc-drawer-hero attribute on hero (so #selectVariant can find the img)
│   └─ removed redundant variantsCount field from bc-drawer-fields
├─ css/beneos-cloud.css
│   └─ +~60 lines for the carousel layout + thumbnail states
└─ lang/{13 lang files}.json
    ├─ +BENEOS.Cloud.Drawer.VariantTooltip
    └─ +BENEOS.Cloud.Drawer.VariantCloudOnly

UNCHANGED:
├─ scripts/beneos_cloud.js                ← cloud API untouched
├─ scripts/beneos_search_engine.js (V1)   ← legacy path untouched
├─ scripts/beneos_utility.js              ← getActorIdVariant reused 1:1
└─ Server / cloud endpoints
```

## Inline comment anchors

Search for `Wave B-6` in `scripts/cloud-v2/cloud-window-v2.mjs`, `templates/cloud-v2/parts/results-pane.hbs`, `css/beneos-cloud.css`.

## Test sequence

1. **Smoke**: Foundry V13 reload, V2 active, search engine opens with no console errors.
2. **Token with `nb_variants = 1`** (e.g. a unique creature): drawer shows hero + fields, no variants section.
3. **Token with `nb_variants > 1` but NOT installed** (e.g. Adult Dragon, 12 variants, all cloud-only): carousel shows 12 thumbnails with the cloud-icon overlay, counter "1 / 12", thumbnails have non-draggable cursor. Click on a thumbnail → hero image swaps to that variant's thumbnail, active outline moves, counter updates. Drag attempt does nothing (browser prevents).
4. **Token with `nb_variants > 1` and installed** (after click-installing the parent): carousel shows 12 thumbnails without the cloud overlay. Drag any thumbnail onto the scene canvas → exactly that variant's actor drops at the cursor position. Custom drag image (the variant thumbnail) follows the cursor.
5. **Mixed state** (some variants installed, others not — shouldn't happen in practice because cloud install bundles all variants, but defensive): cloud-only thumbnails show the cloud icon and aren't draggable, installed ones drag normally. Both can be clicked for hero preview.
6. **Counter update**: click variant 5 → counter shows "5 / 12", active outline on thumbnail 5.
7. **Drawer close + reopen**: hero starts on variant 1 again, counter resets to "1 / N".
8. **Language switch** (de, ja, zh-TW): "Variants" header localizes; tooltips localize.
9. **V1 mode** (toggle setting back to v1): no regression — variants only render in V2.
10. **V14 smoke**: identical behavior in second Foundry instance against the SYNC datapath.

## Known limits / next

| Topic | Wave |
|---|---|
| Drag a cloud-only variant to trigger a parent-token install | B-6b if user testing shows confusion; currently disabled |
| Variant carousel inside the result card (outside the drawer) | Mockup confines variants to the drawer; cards stay single-thumb |
| Items / spells / bmaps with variants | Data model has no variant field for these; nothing to do |
| Hero-image crossfade animation between variants | Optional polish, B-7 territory |
| Keyboard navigation for variant thumbs (←/→) | Optional, mouse + touch UX is sufficient for now |
| Hover-zoom on variant thumbnails | Optional, follow-up if user requests |
| True-progress install events from the server | B-8 (server coordination) |

## Related docs

- `docs/welle-B-5e-summary.md` — install-feedback polish (drag visual, full-card sweep, in-place patching, infinite scroll)
- `docs/welle-B-5d-summary.md` — login polish, no-reload login, 4-state install button
- `docs/welle-B-5c-summary.md` — hotfix wave (spellKey/itemKey scope, Maps tab, login dialog classes)
- `docs/welle-B-5-summary.md` — V2 cards + detail drawer (the drawer this wave extends)
- `docs/welle-B-4-summary.md` — V2 unified window skeleton
- `docs/welle-B-3-summary.md` — design tokens
- `docs/welle-B-1-summary.md` — hardening waves
