/* =============================================================
   Beneos Cloud Window V2 — ApplicationV2 unified window.

   Wave B-4 introduced the unified window skeleton. Wave B-5 replaces the
   v1 result HTML mount with native V2 cards plus a slide-in detail drawer.

   The window coexists with the legacy `BeneosSearchEngine` /
   `BeneosSearchResults` Dialog windows; the world setting
   `beneos-search-engine-version` decides which one the launcher
   instantiates.

   Architecture summary:
   - Cloud calls (login, content list, imports) reuse `BeneosCloud`,
     `BeneosCloudLogin`, `BeneosDatabaseHolder` 1:1. No server change.
   - Tour selectors (#beneos-radio-token etc.) are mirrored on the V2
     header markup as id aliases so the existing tour script keeps
     working.
   - Cards keep the v1 `data-document-id`, `data-type`, `data-drag-mode`,
     `data-token-key` attributes so the dragstart/drop pipeline from
     Wave B-1d still applies — we register the dragstart handler here in
     the V2 class with the same logic as v1.
   - Performance: each card uses `content-visibility: auto` so offscreen
     cards are not painted; the results region is `contain: layout style
     paint` so window drag does not invalidate the Foundry canvas.

   See `docs/welle-B-5-summary.md` for the full review briefing.
   ============================================================= */

import { BeneosUtility } from "../beneos_utility.js"
import { BeneosCloudLogin } from "../beneos_cloud.js"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

// Property keys (mirrors a subset of the v1 __propertyDefList from
// beneos_search_engine.js). Keeping it local avoids exporting the v1
// internal — the V2 filter logic only needs the selector → property name
// mapping.
// Wave B-8h-1: each entry now declares which asset types it applies to.
// Without this, switching tabs (e.g. Maps → Creatures) crashed because
// the OLD bmap selectors (still in the DOM until the sidebar re-renders)
// had stale values and #applyDropdownFilters fired searchByProperty for
// "grid" on a token, where item.properties.grid is undefined and v1's
// helper does `item.properties.grid.match(...)` (beneos_search_engine.js:700).
const V2_FILTER_DEFS = [
  // Tokens
  { types: ["token"], selector: "faction-selector",       prop: "faction"       },
  { types: ["token"], selector: "campaign-selector",      prop: "campaign"      },
  { types: ["token"], selector: "token-types",            prop: "type"          },
  { types: ["token"], selector: "installation-selector",  prop: "installed"     },
  { types: ["token"], selector: "token-fight-style",      prop: "fightingstyle" },
  { types: ["token"], selector: "token-purpose",          prop: "purpose"       },
  // Battlemaps
  // Wave B-8k-2: bmap-bioms-selector dropped — biome is now a chip-
  // dropdown shared with the token mode, filtered via #applyBiomeFilter.
  { types: ["bmap"],  selector: "bmap-brightness",        prop: "brightness"    },
  { types: ["bmap"],  selector: "bmap-adventure",         prop: "adventure"     },
  { types: ["bmap"],  selector: "bmap-grid",              prop: "grid"          },
  { types: ["bmap"],  selector: "kind-selector",          prop: "type"          },
  // Wave B-9-fix-29: release filter — narrow bmap results to a single
  // release pack. The dropdown value is the full download_pack string
  // (e.g. "Crystal Cave - 01"); searchByProperty does a substring match
  // on the property, which works exactly for the unique pack names.
  { types: ["bmap"],  selector: "release-selector",       prop: "download_pack" },
  // Items
  { types: ["item"],  selector: "item-type",              prop: "item_type"     },
  { types: ["item"],  selector: "rarity-selector",        prop: "rarity"        },
  { types: ["item"],  selector: "origin-selector",        prop: "origin"        },
  // Wave B-8i-3: tier dropdown for items (was already in dbHolder.getData()
  // as `tier` but had no V2 surface).
  { types: ["item"],  selector: "tier-selector",          prop: "tier"          },
  // Spells
  { types: ["spell"], selector: "level-selector",         prop: "level"         },
  { types: ["spell"], selector: "school-selector",        prop: "school"        },
  { types: ["spell"], selector: "class-selector",         prop: "classes"       },
  // Wave B-8e-fix-3: spell DB exposes casting_time (Action / Bonus
  // Action / Reaction / 1 Minute / 10 Minutes / 1 Hour) and spell_type
  // (Area Damage / Buff / Curse / Debuff / Melee Damage / Mobility /
  // Protection / Ranged Damage / Regeneration / Restoration / Summon /
  // Utility / etc.) — both deserve their own dropdown.
  { types: ["spell"], selector: "casting-time-selector",  prop: "casting_time"  },
  { types: ["spell"], selector: "spell-type-selector",    prop: "spell_type"    }
]

// Thumbnail base URLs by asset type (CDN paths from beneos_search_engine.js:5–10).
const THUMB_BASE = {
  token: "https://www.beneos-database.com/data/tokens/thumbnails_v2/",
  bmap:  "https://www.beneos-database.com/data/battlemaps/thumbnails/",
  item:  "https://www.beneos-database.com/data/items/thumbnails/",
  spell: "https://www.beneos-database.com/data/spells/thumbnails/"
}

export class BeneosCloudWindowV2 extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-cloud-window-v2",
    classes: ["beneos-cloud-app", "beneos_module"],
    tag: "section",
    window: {
      title: "BENEOS.Cloud.WindowTitle",
      // Wave B-9-fix-44: Beneos logo SVG as the title icon. The
      // beneos-icon-logo CSS class renders the SVG via mask-image so
      // it picks up the title bar's text colour (gold accent).
      icon: "beneos-icon-logo",
      resizable: true,
      minimizable: true
    },
    position: { width: 1100, height: 720 },
    actions: {
      switchTab:               BeneosCloudWindowV2._onSwitchTab,
      openLogin:               BeneosCloudWindowV2._onOpenLogin,
      openCloudSettings:       BeneosCloudWindowV2._onOpenCloudSettings,
      resetFilters:            BeneosCloudWindowV2._onResetFilters,
      switchView:              BeneosCloudWindowV2._onSwitchView,
      openExternal:            BeneosCloudWindowV2._onOpenExternal
    }
  }

  static PARTS = {
    header:  { template: "modules/beneos-module/templates/cloud-v2/parts/header-tabs.hbs" },
    sidebar: { template: "modules/beneos-module/templates/cloud-v2/parts/sidebar-form.hbs" },
    results: { template: "modules/beneos-module/templates/cloud-v2/parts/results-pane.hbs" },
    footer:  { template: "modules/beneos-module/templates/cloud-v2/parts/status-footer.hbs" }
  }

  // Wave B-9-fix-45: title bar shows the module version next to the
  // app name so the system info has a stable home in the header
  // (footer is now reserved for connection state + brand links).
  get title() {
    const base = game.i18n.localize("BENEOS.Cloud.WindowTitle") || "Beneos Cloud"
    const moduleId = BeneosUtility?.moduleID?.() || "beneos-module"
    const version = game.modules?.get?.(moduleId)?.version
    return version ? `${base} · v${version}` : base
  }

  /** @inheritdoc */
  constructor(options = {}) {
    super(options)
    const lastMode = game.beneosTokens?.lastFilterStack?.mode
    this.searchMode = (lastMode && lastMode !== "bmap") ? lastMode : "token"
    this.selectedAssetKey = null     // currently open in detail drawer (null = closed)
    // Wave B-9-fix-46: multi-select set for Ctrl+click. Holds asset
    // keys highlighted in the result list. The drawer always shows the
    // last-clicked card (selectedAssetKey); the install button + drag
    // operate on every key in this set when size > 1. Plain click
    // resets the set to a single entry; Ctrl/Cmd+click toggles.
    this.selectedKeys = new Set()
    this._textFilter = ""

    // Wave B-5d: per-asset install state for the 4-state install button.
    // Map<assetKey, "progress" | "done">. Idle is the absence of an entry.
    // - "progress" set by the install-click handler before the cloud roundtrip.
    // - "done" set by processSelectorSearch (called from softRefresh after a
    //   successful install), then cleared after a short flash.
    this.installState = new Map()

    // Wave B-5e-fix-4: progressive loading. Initial 100 cards in the DOM,
    // scroll-near-bottom appends another 100 (full results re-render with
    // scroll position preserved). Reset to 100 on filter change, tab switch,
    // and reset-filters click — anything that changes the underlying entries
    // list so the user lands on a clean first page.
    this.loadedCount = BeneosCloudWindowV2.RESULTS_PAGE

    // Wave B-8b: token-only filter state that lives on the instance so it
    // survives re-renders (the sidebar DOM gets rebuilt on every render but
    // these inputs would otherwise lose their values).
    // Wave B-8c: dual-thumb CR slider — both bounds inclusive. Default
    // covers the full range so the filter is a no-op until the user moves
    // a thumb. Real values (not slider indices) so the filter is direct.
    this.crMin = 0
    this.crMax = BeneosCloudWindowV2.CR_NO_LIMIT
    // Wave B-8c: exclusion-model source filter — default "all visible" is
    // an empty Set; user unchecks a source and it gets added here. Made
    // the swap from inclusion-model because the practical use case is
    // "hide SRD content to focus on Beneos originals" rather than
    // "narrow to just one source".
    this.sourceHidden = new Set()
    // Wave B-8c: biome cross-filter — AND semantics. Empty Set = no
    // filter; any entries in the Set must ALL be present in a token's
    // properties.biom for it to pass.
    this.biomeFilters = new Set()
    // Wave B-8k-2: separate biome set for battlemaps so token + bmap
    // biome filters don't bleed into each other when switching tabs
    // (some biome names like "Forest" appear in both datasets).
    this.bmapBiomeFilters = new Set()
    // Wave B-8i-3: gold range slider for items. min defaults to 0; max
    // is null until the first item-tab render computes the dataset's
    // actual maximum (avoids hardcoding a value that might mismatch
    // server data).
    this.goldMin = 0
    this.goldMax = null
    // Wave B-9: list / grid view toggle. List is the dense horizontal
    // layout we've shipped since B-5; grid is the Pokémon-card style
    // for browsing-by-portrait. Persisted as a client setting (read
    // here at construction, saved on toggle).
    this.viewMode = game.settings?.get?.(BeneosUtility.moduleID(), "beneos-cloud-view-mode") || "list"

    // Globals shimmed so legacy helpers (softRefresh, drainPendingCanvasDrops)
    // resolve to this window when v2 is active.
    game.beneos = game.beneos || {}
    game.beneos.cloudWindowV2 = this
    game.beneos.searchEngine = this
    game.beneosTokens = game.beneosTokens || {}
    game.beneosTokens.searchEngine = this
  }

  /* ========== Context preparation ========== */

  async _prepareContext(_options) {
    const cloud = game.beneos?.cloud
    const dbHolder = game.beneos?.databaseHolder
    const dbData = dbHolder?.getData?.() ?? {}
    // Wave B-9-fix-36: surface the module version + tab-aware Patreon
    // URL to the footer template. Maps belongs to the BeneosBattlemaps
    // Patreon, everything else (creatures / loot / spells) to the
    // BeneosTokens Patreon. Hard-coded URLs match the user's spec.
    const moduleId = BeneosUtility?.moduleID?.() || "beneos-module"
    const moduleVersion = game.modules?.get?.(moduleId)?.version || ""
    const patreonUrl = this.searchMode === "bmap"
      ? "https://www.patreon.com/c/BeneosBattlemaps"
      : "https://www.patreon.com/c/BeneosTokens"
    return {
      ...dbData,
      searchMode: this.searchMode,
      isCloudLoggedIn: cloud?.isLoggedIn() ?? false,
      patreonStatus:   cloud?.getPatreonStatus() ?? "",
      isOffline:       dbHolder?.getIsOffline?.() ?? false,
      moduleVersion,
      patreonUrl,
      discordUrl: "https://discord.gg/R2yBH557Wk",
      webshopUrl: "https://beneos-battlemaps.com/"
    }
  }

  /**
   * Per-part context — the results part needs the enriched card list and
   * drawer state. Other parts inherit the root context as-is.
   */
  async _preparePartContext(partId, context) {
    // Wave B-8b: sidebar gets the source-checkbox list with per-source
    // counts. We count over the unfiltered raw dataset for the current
    // assetType so the numbers represent "how many SRD tokens exist in
    // total" rather than "after current filters" — matches the mockup.
    if (partId === "sidebar") {
      const sourceCheckboxes = this.#buildSourceCheckboxes()
      const { biomeChips, biomeAvailable } = this.#buildBiomeLists()
      // Wave B-8c: pre-formatted CR range label so the template can stay
      // simple. formatCR handles the fraction display for the bounds.
      const crMinLabel = BeneosCloudWindowV2.#formatCR(this.crMin)
      const crMaxLabel = BeneosCloudWindowV2.#formatCR(this.crMax)
      const crRangeLabel = `${crMinLabel} – ${crMaxLabel}`
      // Slider thumb indices into CR_STEPS (the slider uses uniform steps;
      // we map to actual CR values on change).
      const crMinIndex = BeneosCloudWindowV2.CR_STEPS.indexOf(this.crMin)
      const crMaxIndex = BeneosCloudWindowV2.CR_STEPS.indexOf(this.crMax)
      const crStepsMax = BeneosCloudWindowV2.CR_STEPS.length - 1
      // Wave B-8i-3: item gold range slider — same dual-thumb pattern as
      // CR. The slider's max is computed from the dataset so it matches
      // whatever's actually available; min stays at 0.
      const goldMaxAvailable = this.#getMaxItemPrice()
      const effectiveGoldMax = this.goldMax ?? goldMaxAvailable
      const goldRangeLabel = `${this.goldMin} – ${effectiveGoldMax}`
      // Wave B-8k-3: rebuild the rarity table for items so the dropdown
      // reads "Common → Uncommon → … → Legendary" in canonical D&D
      // order rather than alphabetically (which leaves "Common" between
      // "Artifact" and "Legendary").
      const rarityOrdered = this.searchMode === "item"
        ? this.#buildOrderedRarity(context.rarity)
        : context.rarity
      // Wave B-9-fix-29: build the bmap release list from the actual
      // dataset. download_pack is "<Name> - <Number>"; we split on the
      // last " - " so release names that themselves contain dashes
      // still parse correctly. Sort ascending by number — the user's
      // pack catalogue already runs from 1 to ~108 so numeric order
      // matches publication chronology.
      const releaseList = {}
      if (this.searchMode === "bmap") {
        const dbHolder = game.beneos?.databaseHolder
        const all = dbHolder?.getAll?.("bmap") || {}
        const seen = new Map()
        for (const data of Object.values(all)) {
          const pack = data?.properties?.download_pack
          if (!pack || typeof pack !== "string") continue
          if (seen.has(pack)) continue
          const idx = pack.lastIndexOf(" - ")
          if (idx < 0) continue
          const name = pack.slice(0, idx).trim()
          const numStr = pack.slice(idx + 3).trim()
          const num = parseInt(numStr, 10)
          if (!Number.isFinite(num)) continue
          seen.set(pack, { num, name, label: `${num} - ${name}`, key: pack })
        }
        const sorted = [...seen.values()].sort((a, b) => a.num - b.num)
        releaseList.any = { key: "any", value: "Any" }
        for (const r of sorted) releaseList[r.key] = { key: r.key, value: r.label }
      }
      // Wave B-8k-4: capitalise every dropdown label and lift "Any" to
      // the top across all filter lists (token + bmap + item + spell).
      // Rarity already has its custom order so it skips this step.
      const orderList = (l) => this.#orderDropdownList(l)
      return {
        ...context,
        // Token-side
        tokenFactions:  orderList(context.tokenFactions),
        tokenTypes:     orderList(context.tokenTypes),
        fightingStyles: orderList(context.fightingStyles),
        purposeList:    orderList(context.purposeList),
        tokenCampaigns: orderList(context.tokenCampaigns),
        // Bmap-side
        bmapBrightness: orderList(context.bmapBrightness),
        adventureList:  orderList(context.adventureList),
        gridList:       orderList(context.gridList),
        releaseList:    releaseList,
        // Item-side
        // Wave B-8k-5: collapse "Light Armor +1/+2/…" into "Light Armor"
        // before sorting so the dropdown isn't cluttered with modded
        // variants. searchByProperty's substring match handles the
        // wide-net filter on the data side.
        itemType:       orderList(this.#dedupeItemTypes(context.itemType)),
        origin:         orderList(context.origin),
        tier:           orderList(context.tier),
        // Spell-side
        level:          orderList(context.level),
        school:         orderList(context.school),
        spellClass:     orderList(context.spellClass),
        // Wave B-8e-fix-3: castingTime + spellType lists are already
        // built by BeneosDatabaseHolder.getData() (verified in
        // beneos_search_engine.js:848-849); just forward them here.
        castingTime:    orderList(context.castingTime),
        spellType:      orderList(context.spellType),
        rarity: rarityOrdered,
        sourceCheckboxes,
        biomeChips,
        biomeAvailable,
        // Pre-computed flag for the template, since Foundry's Handlebars
        // doesn't ship a guaranteed `or` helper.
        biomeHasAny: biomeChips.length > 0 || biomeAvailable.length > 0,
        crMinLabel, crMaxLabel, crRangeLabel,
        crMinIndex: crMinIndex >= 0 ? crMinIndex : 0,
        crMaxIndex: crMaxIndex >= 0 ? crMaxIndex : crStepsMax,
        crStepsMax,
        goldMaxAvailable,
        goldMin: this.goldMin,
        goldMax: effectiveGoldMax,
        goldRangeLabel
      }
    }
    if (partId === "results") {
      const { cards, totalMatches, hasMore, groupBulkKeys } = this.#buildCards()
      // Wave B-8g-3 / B-8i-1: cache the per-group keys on the instance
      // so the bulk-install click handler can read them back without
      // rebuilding the whole card list. `matching` is the full filtered
      // set of installable + update-pending items; `new` and `update`
      // are subsets within their respective groups.
      this._groupBulkKeys = groupBulkKeys || { new: [], update: [], view: [], backlog: [] }
      // Wave B-8k-1: 4 contextual options — only those with count > 0
      // render. The "view" entry (renamed from "matching" so it's clearer
      // that it targets what the user currently sees) handles the
      // filtered set; the "backlog" entry (below a visual divider) is
      // the explicit "install everything" action with a stronger
      // confirmation dialog. Per-tab type label so users see "Install
      // entire Creature backlog" / Loot / Maps / Spells.
      const typeLabel = this.searchMode === "token" ? game.i18n.localize("BENEOS.Cloud.Tab.Tokens")
                      : this.searchMode === "item"  ? game.i18n.localize("BENEOS.Cloud.Tab.Items")
                      : this.searchMode === "spell" ? game.i18n.localize("BENEOS.Cloud.Tab.Spells")
                      : game.i18n.localize("BENEOS.Cloud.Tab.Maps")
      const bulkOptions = {
        view: groupBulkKeys?.view?.length
          ? { count: groupBulkKeys.view.length,
              label: game.i18n.format("BENEOS.Cloud.Results.InstallAllView", { count: groupBulkKeys.view.length }) }
          : null,
        new: groupBulkKeys?.new?.length
          ? { count: groupBulkKeys.new.length,
              label: game.i18n.format("BENEOS.Cloud.Results.InstallAllNewN", { count: groupBulkKeys.new.length }) }
          : null,
        update: groupBulkKeys?.update?.length
          ? { count: groupBulkKeys.update.length,
              label: game.i18n.format("BENEOS.Cloud.Results.InstallAllUpdateN", { count: groupBulkKeys.update.length }) }
          : null,
        backlog: groupBulkKeys?.backlog?.length
          ? { count: groupBulkKeys.backlog.length,
              label: game.i18n.format("BENEOS.Cloud.Results.InstallAllBacklog", { type: typeLabel, count: groupBulkKeys.backlog.length }) }
          : null
      }
      const hasBulkOptions = !!(bulkOptions.view || bulkOptions.new || bulkOptions.update || bulkOptions.backlog)
      const drawerAsset = this.selectedAssetKey
        ? cards.find(c => c.key === this.selectedAssetKey)
        : null
      // Wave B-5e-fix-2/4: pre-formatted hint so the template can stay simple
      // (Foundry's {{localize}} helper takes no inline params). When more
      // results are pending, the hint says "scroll for more"; when the user
      // has loaded everything, only the plain count shows.
      const partialHint = hasMore
        ? game.i18n.format("BENEOS.Cloud.Results.Partial", {
            loaded: cards.length,
            total: totalMatches
          })
        : null
      // Track whether more pages exist so the scroll loader knows when to
      // stop firing.
      this._hasMoreResults = hasMore
      return {
        ...context,
        cards,
        totalMatches,
        hasMore,
        partialHint,
        bulkOptions,
        hasBulkOptions,
        // Wave B-9: surface viewMode so the result list can apply the
        // .bc-view-grid modifier when the user picked grid mode.
        viewMode: this.viewMode,
        viewIsGrid: this.viewMode === "grid",
        drawer: {
          open: !!drawerAsset,
          asset: drawerAsset || null,
          // Wave B-9-fix-46: surface the multi-select count so the
          // drawer install button can flip its label to "Install
          // Selected (N)" when more than one card is highlighted.
          selectedCount: this.selectedKeys?.size || 0,
          isMultiSelect: (this.selectedKeys?.size || 0) > 1
        }
      }
    }
    return context
  }

  /* ========== Card building ========== */

  // Wave B-5e-fix-2/4: progressive loading. Initial page is RESULTS_PAGE
  // entries; scrolling to the bottom of .bc-result-list adds another page.
  // Mirrors v1's relevance-first ordering by inheriting BeneosDatabaseHolder's
  // sort. The cap stays on the client — server is not hit; the database JSON
  // is already in memory and image thumbnails lazy-load via `loading="lazy"`.
  static RESULTS_PAGE = 100

  // Wave B-8b/c: CR steps are non-uniform — D&D 5e uses fractional CRs
  // below 1 (1/8, 1/4, 1/2). The slider runs 0..(STEPS.length-1) with
  // step=1; the displayed/filtered value is STEPS[index]. Default upper
  // bound is the last entry (30 = "no limit"). The dual-thumb min/max
  // sliders (Wave B-8c) read indices into this array, the filter compares
  // the resolved real values.
  static CR_STEPS = [0, 0.125, 0.25, 0.5,
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30]
  static CR_NO_LIMIT = 30
  // Wave B-8c: source group now uses inclusion semantics (default all
  // checked, user unchecks to exclude). Each entry has a display label
  // (Patreon shows as "Beneos Originals" because that's what users
  // recognize) and a tooltip explaining where the content comes from.
  // The DB key stays as-is so the filter against properties.source works.
  // Wave B-9-fix-34: SOURCE_DEFS keys must match the raw DB value in
  // properties.source so the count + filter both work. Loyalty tokens
  // ship with source: "Loyalty Token" (45 tokens at the time of writing,
  // detectable also via the "000-month_" key prefix), so the key here is
  // the full string. The display label adds the plural for readability.
  static SOURCE_DEFS = [
    { key: "SRD",            label: "SRD",              i18nLabel: "BENEOS.Cloud.Filter.SourceSRD",     i18nTooltip: "BENEOS.Cloud.Filter.SourceSRDTooltip"     },
    { key: "Patreon",        label: "Beneos Originals", i18nLabel: "BENEOS.Cloud.Filter.SourcePatreon", i18nTooltip: "BENEOS.Cloud.Filter.SourcePatreonTooltip" },
    { key: "Webshop",        label: "Webshop",          i18nLabel: "BENEOS.Cloud.Filter.SourceWebshop", i18nTooltip: "BENEOS.Cloud.Filter.SourceWebshopTooltip" },
    { key: "Loyalty Token",  label: "Loyalty Tokens",   i18nLabel: "BENEOS.Cloud.Filter.SourceLoyalty", i18nTooltip: "BENEOS.Cloud.Filter.SourceLoyaltyTooltip" }
  ]

  // Wave B-9-fix-34: helper so the drawer can map a raw source string
  // to the human-readable label ("Patreon" → "Beneos Originals"). Used
  // by #enrichCard. Falls back to the raw value if no def matches.
  static #getSourceLabel(rawSource) {
    if (!rawSource) return null
    const def = BeneosCloudWindowV2.SOURCE_DEFS.find(d => d.key === rawSource)
    if (!def) return rawSource
    return game.i18n.localize(def.i18nLabel) || def.label
  }

  #buildCards() {
    const dbHolder = game.beneos?.databaseHolder
    if (!dbHolder) return { cards: [], totalMatches: 0, hasMore: false }
    const type = this.searchMode
    const raw = dbHolder.getAll?.(type) || {}

    let entries = Object.entries(raw)
    const initialCount = entries.length

    // Wave B-8d-fix-9: process all entries FIRST so derived flags
    // (data.installed, isNew, isUpdate) exist before any filter step.
    // The "Show installed only" dropdown depends on data.installed being
    // set — which only processInstalled* does.
    //
    // Wave B-8g-4: `dbHolder` IS the class (`game.beneos.databaseHolder
    // = BeneosDatabaseHolder` in beneos_module.js:43), not an instance.
    // So `dbHolder.constructor` is `Function` and the static methods are
    // not on it — calls like `Holder.processInstalledToken?.(data)`
    // silently no-op'd. Same root cause as the dropdown-filter regression
    // below. Use `dbHolder` directly.
    for (const [_k, data] of entries) {
      if (type === "token") dbHolder.processInstalledToken?.(data)
      if (type === "item")  dbHolder.processInstalledItem?.(data)
      if (type === "spell") dbHolder.processInstalledSpell?.(data)
      if (type === "bmap")  dbHolder.processInstalledBattlemap?.(data)
    }

    // Apply text filter + dropdown filters from the sidebar DOM.
    if (this._textFilter) entries = this.#applyTextFilter(entries, this._textFilter)
    const afterText = entries.length
    entries = this.#applyDropdownFilters(type, entries)
    const afterDropdowns = entries.length
    // Wave B-8b/c: token-only slider + checkbox filters. Order doesn't
    // matter mathematically (intersection is commutative); kept after the
    // dropdowns so the dataset is already as small as possible.
    let afterCR = afterDropdowns, afterSource = afterDropdowns, afterBiome = afterDropdowns
    if (type === "token") {
      entries = this.#applyCRFilter(entries)
      afterCR = entries.length
      entries = this.#applySourceFilter(entries)
      afterSource = entries.length
      entries = this.#applyBiomeFilter(entries)
      afterBiome = entries.length
    }
    // Wave B-8k-2: bmap biome chip filter — same AND semantics.
    if (type === "bmap") {
      entries = this.#applyBiomeFilter(entries)
    }
    // Wave B-8i-3: item-only gold range filter.
    if (type === "item") {
      entries = this.#applyGoldFilter(entries)
    }

    // Wave B-8d-fix-9: filter pipeline diagnostic. Logs only when
    // something actually narrowed (skipped on an idle no-filter open).
    if (afterDropdowns < initialCount || afterCR < afterDropdowns ||
        afterSource < afterCR || afterBiome < afterSource) {
      console.log(`[Beneos V2] filter pipeline (${type}):`,
        `raw=${initialCount} text=${afterText} dropdowns=${afterDropdowns}`,
        `cr=${afterCR} source=${afterSource} biome=${afterBiome}`,
        { crMin: this.crMin, crMax: this.crMax, sourceHidden: [...this.sourceHidden], biomeFilters: [...this.biomeFilters] })
    }

    const hasActiveFilter = this.#hasActiveFilter(type)
    const groupRank = (data) => {
      if (data?.isNew) return 0
      if (!hasActiveFilter && data?.isUpdate) return 1
      return 2
    }
    entries.sort((a, b) => {
      const ra = groupRank(a[1]); const rb = groupRank(b[1])
      if (ra !== rb) return ra - rb
      const na = (a[1]?.name || a[0]).toString()
      const nb = (b[1]?.name || b[0]).toString()
      return na.localeCompare(nb)
    })

    const totalMatches = entries.length
    const limit = this.loadedCount
    const hasMore = totalMatches > limit
    if (hasMore) entries = entries.slice(0, limit)

    // Wave B-8d: enrich + tag first-of-group with divider info. Cards
    // arrive in the sorted order (New → Update → Rest); when the group
    // changes between consecutive cards we mark the new card as a
    // divider so the template renders a separator before it. With an
    // active filter, "update" cards are demoted to "regular" so they
    // don't get their own group/divider — they just blend into Rest.
    //
    // Wave B-8g-3: count actually-installable cards per group (cloud-
    // available not-yet-installed for "new"; isUpdate-installed for
    // "update") so we can render a discreet "Install all N" button on
    // the divider. The "regular" group never gets a bulk button — the
    // user shouldn't accidentally pull the entire backlog.
    const enriched = entries.map(([key, data]) => {
      const card = this.#enrichCard(type, key, data)
      if (hasActiveFilter && card.groupKind === "update") {
        card.groupKind = "regular"
      }
      return card
    })
    // Wave B-8i-1 / B-8k-1: collect bulk-install candidate keys per group
    // plus the full "view" set (everything in the filtered view that's
    // either cloud-available-not-installed OR an installed-with-update)
    // plus the unfiltered "backlog" set (every installable in the entire
    // type, regardless of filter — used by the "Install entire backlog"
    // option below the menu divider). The kebab menu reads these to
    // decide which of the four options to render (only ones with > 0
    // keys show up).
    const groupBulkKeys = { new: [], update: [], view: [], backlog: [] }
    for (const card of enriched) {
      if (type !== "token" && type !== "item" && type !== "spell") continue
      const isInstallableNow = (card.isCloudAvailable && !card.isInstalled)
      const isUpdatePending  = (card.isUpdate && card.isInstalled)
      if (card.groupKind === "new" && isInstallableNow) {
        groupBulkKeys.new.push(card.key)
      } else if (card.groupKind === "update" && isUpdatePending) {
        groupBulkKeys.update.push(card.key)
      }
      if (isInstallableNow || isUpdatePending) {
        groupBulkKeys.view.push(card.key)
      }
    }
    // Wave B-8k-1: the "entire backlog" option scans the FULL unfiltered
    // raw dataset (already enriched-with-installed-flags by the early
    // processInstalled* loop above). Includes every cloud-available
    // un-installed item plus every installed-but-update-pending item.
    if (type === "token" || type === "item" || type === "spell") {
      for (const [key, data] of Object.entries(raw)) {
        const isInstallableNow = (data.isCloudAvailable && !data.isInstalled)
        const isUpdatePending  = (data.isUpdate && data.isInstalled)
        if (isInstallableNow || isUpdatePending) {
          groupBulkKeys.backlog.push(key)
        }
      }
    }
    const out = []
    let lastGroup = null
    for (const card of enriched) {
      if (card.groupKind !== lastGroup) {
        card.divider = true
        card.dividerLabel = this.#groupHeading(card.groupKind)
        // Wave B-8i-1: divider no longer carries the bulk-install button —
        // the consolidated kebab menu in the results header handles all
        // three options ("matching", "new", "update") in one place. Keep
        // the divider purely as a section label.
        lastGroup = card.groupKind
      }
      out.push(card)
    }
    return { cards: out, totalMatches, hasMore, groupBulkKeys }
  }

  // Wave B-8d: any sidebar control narrowing the result set. Used by the
  // grouped sort to decide whether to keep "Update" as its own group
  // (idle list — we want to highlight what's new + recently updated) or
  // collapse it into Rest (filtered list — user is hunting something
  // specific, the New highlight stays useful but Update is noise).
  #hasActiveFilter(type) {
    if (this._textFilter) return true
    if (type === "token") {
      if (this.crMin > 0) return true
      if (this.crMax < BeneosCloudWindowV2.CR_NO_LIMIT) return true
      if (this.sourceHidden.size > 0) return true
      if (this.biomeFilters.size > 0) return true
    }
    // Wave B-8i-3: item gold range filter.
    if (type === "item") {
      if (this.goldMin > 0) return true
      if (this.goldMax != null && this.goldMax < this.#getMaxItemPrice()) return true
    }
    // Wave B-8k-2: bmap biome chip filter.
    if (type === "bmap") {
      if (this.bmapBiomeFilters.size > 0) return true
    }
    const root = this.element
    if (root) {
      for (const def of V2_FILTER_DEFS) {
        // Wave B-8h-1: same type guard as #applyDropdownFilters.
        if (def.types && !def.types.includes(type)) continue
        const sel = root.querySelector("#" + def.selector)
        if (!sel) continue
        const v = sel.value
        if (v && v.toLowerCase() !== "any") return true
      }
    }
    return false
  }

  #groupHeading(kind) {
    if (kind === "new")    return game.i18n.localize("BENEOS.Cloud.Results.GroupNew")
    if (kind === "update") return game.i18n.localize("BENEOS.Cloud.Results.GroupUpdate")
    return game.i18n.localize("BENEOS.Cloud.Results.GroupRegular")
  }

  #enrichCard(assetType, key, data) {
    const props = data?.properties ?? {}
    const thumbBase = THUMB_BASE[assetType] || ""
    const thumbFile = props.thumbnail || props.icon || data.thumbnail || data.icon
    const thumbUrl = thumbFile ? thumbBase + thumbFile : null

    const typeArr = Array.isArray(props.type) ? props.type : (props.type ? [props.type] : [])
    const typeLabel = typeArr.length ? this.#capitalize(String(typeArr[0])) : null

    // Drag-drop attributes — same shape the v1 dragstart handler reads.
    // Wave B-7-fix-1: V1's processInstalledBattlemap (mirrored at
    // beneos_search_engine.js:505) sets bmapData.isInstalled = true on every
    // entry as a side effect of the data scan. In V2 that bled through and
    // bmaps appeared with the green "Installed" pill even though we don't
    // track local battlemap installs at all — installs flow through
    // Moulinette (until the cloud-bmap pipeline ships in B-8). For V2,
    // bmaps are cloud-only previews; force the flags accordingly.
    const isInstalled      = assetType === "bmap" ? false : !!data.isInstalled
    const isCloudAvailable = assetType === "bmap" ? true  : !!data.isCloudAvailable
    const dragMode = data.dragMode || "none"
    const dragType = assetType === "spell" ? "Item" : (assetType === "item" ? "Item" : "Actor")
    const documentId = isInstalled
      ? (BeneosUtility.getActorId?.(key) || BeneosUtility.getItemId?.(key) || BeneosUtility.getSpellId?.(key) || "")
      : ""

    // Wave B-5d: install-progress state for the 4-state button.
    const installPhase = this.installState.get(key) || null
    const isInstalling   = installPhase === "progress"
    const justInstalled  = installPhase === "done"

    // Wave B-5d: cloud-drag with a pending canvas drop also shows progress.
    const isPendingDrop = !!game.beneos?.cloud?.pendingCanvasDrops?.has(key)

    // Wave B-5e: asset-type-specific animation duration for the card-fill
    // sweep. Tokens take longer (one fetch + multiple base64 image uploads +
    // compendium create), items / spells are quicker. Bmaps are routed via
    // Moulinette so the value here doesn't matter.
    const installDuration = assetType === "token" ? "4s" : "1.5s"

    // Wave B-7: paired sibling for battlemaps. Many Beneos maps ship in
    // pairs — a "scenery" view and a "battlemap" view of the same area —
    // and the database records the partner's key in properties.sibling
    // (mirrors v1's `getSiblingPicture` in beneos_search_engine.js:666).
    // The drawer renders both side-by-side so the user sees the full pair
    // before installing.
    let siblingThumbUrl = null
    if (assetType === "bmap" && props.sibling) {
      const dbHolder = game.beneos?.databaseHolder
      const sib = dbHolder?.getAll?.("bmap")?.[props.sibling]
      const sibThumb = sib?.properties?.thumbnail
      if (sibThumb) siblingThumbUrl = THUMB_BASE.bmap + sibThumb
    }

    // Wave B-9-fix-29: parse the bmap's release info from download_pack
    // so the drawer can show "Release: 96 - DiA 00 …" alongside the
    // other fields. Same lastIndexOf(" - ") split as the sidebar list
    // builder so multi-dash names still work.
    let releaseLabel = null
    if (assetType === "bmap" && props.download_pack) {
      const pack = String(props.download_pack)
      const idx = pack.lastIndexOf(" - ")
      if (idx >= 0) {
        const name = pack.slice(0, idx).trim()
        const numStr = pack.slice(idx + 3).trim()
        const num = parseInt(numStr, 10)
        if (Number.isFinite(num)) releaseLabel = `${num} - ${name}`
      }
    }

    // Wave B-8h-3: bmap resolution label rendered as a tag. The DB stores
    // grid as a string like "20 x 30"; we normalise it to "20 × 30" using
    // the proper multiplication sign so the visual reads cleanly.
    let gridLabel = null
    if (assetType === "bmap" && props.grid) {
      const m = String(props.grid).match(/(\d+)\s*x\s*(\d+)/i)
      if (m) gridLabel = `${m[1]} × ${m[2]}`
    }

    // Wave B-6: variant carousel data. Token bundles often ship as multi-
    // variant packs (Adult Dragon = 12 colored variants etc.). The CDN
    // serves variant thumbnails at <key>-<i>-db.webp; the local actor for
    // a specific variant resolves via getActorIdVariant — undefined when
    // the parent token isn't installed yet (those variants render in the
    // drawer with a cloud-icon overlay and are not draggable). Items,
    // spells, and bmaps stay variantless.
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

    // Wave B-9-fix-9: item-specific tags. Result cards for loot show
    // rarity + origin + type + tier + price as tags so the row reads
    // naturally ("Very Rare · Vampiric · Melee Weapon · T3 · 52800 gp").
    // Origin gets a small icon next to the label when the matching file
    // exists on the CDN (https://www.beneos-database.com/icons/<key>.webp);
    // loadError on <img> degrades to text-only without a broken icon.
    let itemOrigin = null
    let itemOriginIcon = null
    let itemOriginLabel = null
    let itemOriginDescription = null
    let itemTypeLabel = null
    let itemTier = null
    let itemTierLabel = null
    let itemPrice = null
    let itemPriceLabel = null
    if (assetType === "item") {
      if (props.origin) {
        itemOrigin = String(props.origin).toLowerCase()
        itemOriginIcon = `https://www.beneos-database.com/icons/${itemOrigin}.webp`
        itemOriginLabel = this.#capitalize(itemOrigin)
        // Wave B-9-fix-14: pull the origin description out of the
        // common database (commonData.hover.origin.<key>.message). The
        // helper is on BeneosDatabaseHolder; messages start with
        // "Capitalized: ..." so we strip the prefix to avoid showing
        // the origin name twice in the drawer.
        const dbHolder = game.beneos?.databaseHolder
        let desc = dbHolder?.getHover?.("origin", itemOrigin)
        if (desc && typeof desc === "string" && desc !== "No information") {
          desc = desc.replace(/^[A-Z][\w-]*:\s*/, "")
          itemOriginDescription = desc
        }
      }
      if (props.item_type) itemTypeLabel = String(props.item_type)
      if (props.tier !== undefined && props.tier !== null && props.tier !== "") {
        const tierNum = Number(props.tier)
        if (Number.isFinite(tierNum)) {
          itemTier = tierNum
          // Wave B-9-fix-13: spell out "Tier N" instead of "TN" so the
          // chip is unambiguous at a glance.
          itemTierLabel = `${game.i18n.localize("BENEOS.Cloud.Filter.Tier")} ${tierNum}`
        }
      }
      if (props.price !== undefined && props.price !== null && props.price !== "") {
        const priceNum = Number(props.price)
        if (Number.isFinite(priceNum) && priceNum > 0) {
          itemPrice = priceNum
          itemPriceLabel = `${priceNum.toLocaleString("en-US")} gp`
        }
      }
    }

    return {
      key,
      assetType,
      name: data.name || key,
      thumbUrl,
      typeLabel,
      cr: props.cr ?? null,
      crLabel: BeneosCloudWindowV2.#formatCR(props.cr),
      faction: props.faction || null,
      // Wave B-9-fix-35: faction tooltip pulls from the same hover-DB
      // entry that the sidebar info icon uses (commonData.hover.faction).
      // Strip the leading "Capitalized: " prefix so the tooltip doesn't
      // repeat the faction name. Token-only — items/spells don't carry
      // factions in the schema today.
      factionDescription: (() => {
        if (assetType !== "token" || !props.faction) return null
        const dbHolder = game.beneos?.databaseHolder
        let desc = dbHolder?.getHover?.("faction", String(props.faction).toLowerCase())
        if (!desc || typeof desc !== "string" || desc === "No information") return null
        return desc.replace(/^[A-Z][\w-]*:\s*/, "")
      })(),
      // Wave B-9-fix-34: map "Patreon" → "Beneos Originals" etc. so the
      // drawer matches the filter labels.
      source: BeneosCloudWindowV2.#getSourceLabel(props.source),
      rarity: props.rarity || null,
      level: props.level ?? null,
      school: props.school || null,
      itemOrigin,
      itemOriginIcon,
      itemOriginLabel,
      itemOriginDescription,
      itemTypeLabel,
      itemTier,
      itemTierLabel,
      itemPrice,
      itemPriceLabel,
      description: data.description || null,
      variantsCount: props.nb_variants || null,
      variants,
      isInstalled,
      isCloudAvailable,
      isInstallable: !!data.isInstallable,
      // Wave B-9-fix-58 → fix-59: surface login + offline state to the
      // card so the install button can render a tailored label/tooltip
      // instead of the generic "Not Available" when the real reason
      // is the user being signed out or the server being unreachable.
      // Bmaps stay exempt — they don't go through Beneos Cloud at all
      // (the install path is Moulinette), so neither sign-in nor cloud
      // reachability is relevant. The Moulinette button always renders.
      needsLogin: assetType !== "bmap" && !(game.beneos?.cloud?.isLoggedIn?.()),
      isOfflineCard: assetType !== "bmap" && !!(game.beneos?.databaseHolder?.getIsOffline?.()
                                              ?? game.beneos?.databaseHolder?.isOffline),
      isNew: !!data.isNew,
      isUpdate: !!data.isUpdate,
      dragMode,
      dragType,
      documentId,
      isDraggable: dragMode !== "none",
      isInstalling: isInstalling || isPendingDrop,
      justInstalled,
      installDuration,
      // Wave B-7: bmap cards show a Moulinette-branded action button instead
      // of "Install", because installs flow through Moulinette until the
      // cloud-bmap pipeline ships (B-8). The sibling URL is set above for
      // bmaps that have a paired view registered in the database.
      isBmap: assetType === "bmap",
      siblingThumbUrl,
      gridLabel,
      releaseLabel,
      // Wave B-9-fix-32 → fix-46: any card in the multi-select set
      // gets the gold highlight. The drawer-open card is always in the
      // set (single click adds itself), so this also covers the
      // single-selection case.
      isSelected: this.selectedKeys?.has?.(key) || this.selectedAssetKey === key,
      // Wave B-8d: group classification for the New → Update → Rest sort.
      // The actual "Update collapses into Rest when a filter is active"
      // logic happens in #buildCards before this is called; here we just
      // map the data flags to a group key the template can theme on.
      groupKind: data?.isNew ? "new" : (data?.isUpdate ? "update" : "regular"),
      // Wave B-8e: clickable tags. For every tag the template renders,
      // expose two parallel fields:
      //   - <tag>Tooltip  → string from commonData.hover or null
      //   - <tag>Filter   → raw filter value (lowercase / numeric / DB
      //                     shape) the click handler feeds into
      //                     #applyTagFilter. Display labels stay
      //                     unchanged (cr_label, faction, etc.).
      // The template wires data-filter-type/data-filter-value when
      // these fields are present; tags without a filter (Price, status
      // chips) render unchanged.
      crTooltip:        null,                                            // CR has no commonData hover; no tooltip.
      crFilter:         (props.cr ?? null),                              // numeric CR → #applyTagFilter clamps to nearest CR_STEP
      rarityTooltip:    this.#getCardTagTooltip("rarity", props.rarity),
      rarityFilter:     props.rarity || null,
      typeFilter:       (Array.isArray(props.type) ? props.type[0] : props.type) || null,
      typeTooltip:      this.#getCardTagTooltip(
                          assetType === "item" ? "item_type"
                            : assetType === "spell" ? "spell_type"
                            : null,
                          (Array.isArray(props.type) ? props.type[0] : props.type)
                        ),
      itemTypeTooltip:  this.#getCardTagTooltip("item_type", props.item_type),
      itemTypeFilter:   props.item_type || null,
      tierTooltip:      this.#getCardTagTooltip("tier", props.tier),
      tierFilter:       (props.tier !== undefined && props.tier !== null && props.tier !== "")
                          ? Number(props.tier) : null,
      originTooltip:    this.#getCardTagTooltip("origin", props.origin),
      originFilter:     props.origin || null,                            // already lowercase in DB
      factionTooltip:   this.#getCardTagTooltip("faction", props.faction),
      factionFilter:    props.faction || null,
      levelFilter:      props.level ?? null,
      schoolFilter:     props.school || null,
      gridFilter:       props.grid || null,                              // raw "20x18" — selectOptions binds key
      sourceFilter:     props.source || null,                            // raw "Patreon" / "SRD" / "Webshop" / "Loyalty Token"
      // Wave B-8e-fix-4: spell-card extras. Spell Type sits in the
      // main tag row alongside School (descriptive narrative pair —
      // "Necromancy · Area Damage"). Casting Time + Level move to
      // the stats row below as compact mechanical readouts, mirroring
      // the loot Tier+Price stats pattern. spellLevelLabel uses the
      // same "Lvl N" abbreviation we previously rendered as a tag.
      spellType:           assetType === "spell" ? (props.spell_type || null) : null,
      spellTypeFilter:     assetType === "spell" ? (props.spell_type || null) : null,
      spellTypeTooltip:    assetType === "spell" ? this.#getCardTagTooltip("spell_type", props.spell_type) : null,
      castingTimeLabel:    assetType === "spell" ? (props.casting_time || null) : null,
      castingTimeFilter:   assetType === "spell" ? (props.casting_time || null) : null,
      spellLevelLabel:     (assetType === "spell" && props.level !== undefined && props.level !== null && props.level !== "")
                             ? `${game.i18n.localize("BENEOS.Cloud.Card.LevelShort")} ${props.level}` : null
    }
  }

  #capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }

  // Wave B-8i-2 / B-8k-fix-2: tag descriptions live in
  // BeneosDatabaseHolder per data source (tokenData / itemData /
  // spellData each have their own tag_description map keyed by
  // lowercase tag name). The v1 helper only looks at tokenData; we walk
  // all three so item-side filters (Origin) and spell-side filters get
  // descriptions too. The optional context argument lets the lookup
  // fall back to hardcoded i18n descriptions for tags that aren't in
  // the DB but still deserve a tooltip — like Tier 1–4 which the user
  // wanted explained as "for player levels 1–4" / "5–9" / etc.
  #getTagDescription(value, context = null) {
    if (!value) return null
    const v = String(value).toLowerCase()
    if (v === "any") return null
    const dbHolder = game.beneos?.databaseHolder
    if (dbHolder) {
      for (const dataKey of ["tokenData", "itemData", "spellData"]) {
        const desc = dbHolder[dataKey]?.tag_description?.[v]?.description
        if (desc) return desc
      }
    }
    // Hardcoded fallbacks per context — only used when the DB has no
    // description for the tag, which today is the case for tiers.
    if (context === "tier") {
      const i18nKey = `BENEOS.Cloud.Tier.Description${v}`
      const localized = game.i18n.localize(i18nKey)
      if (localized && localized !== i18nKey) return localized
    }
    return null
  }

  // Wave B-8e: tooltip lookup for tags rendered on result cards (and
  // mirrored in the drawer fields). Wraps BeneosDatabaseHolder.getHover
  // (commonData.hover[category][term].message — verified categories:
  // origin, item_type, tier, spell_type, installed) plus the i18n
  // tier-description fallback that #getTagDescription already uses.
  // Returns null when the DB has no entry, which lets the template
  // skip the data-tooltip attribute entirely (no empty hover popup).
  #getCardTagTooltip(tagType, value) {
    if (!value && value !== 0) return null
    const dbHolder = game.beneos?.databaseHolder
    if (!dbHolder?.getHover) return null
    const lower = String(value).toLowerCase()
    let raw = null
    switch (tagType) {
      case "origin":     raw = dbHolder.getHover("origin", lower); break
      case "item_type":  raw = dbHolder.getHover("item_type", lower); break
      case "spell_type": raw = dbHolder.getHover("spell_type", lower); break
      case "tier": {
        raw = dbHolder.getHover("tier", String(value))
        if (!raw || raw === "No information") {
          const i18nKey = `BENEOS.Cloud.Tier.Description${value}`
          const localized = game.i18n.localize(i18nKey)
          if (localized && localized !== i18nKey) raw = localized
        }
        break
      }
      case "faction":    raw = dbHolder.getHover("faction", lower); break
      // CR / type / school / level / rarity / source have no commonData
      // hover entries; those tags render without a tooltip.
      default: return null
    }
    if (!raw || raw === "No information") return null
    // Strip the leading "Capitalized: " prefix that hover messages
    // typically include (mirrors the existing origin-description
    // sanitisation in #enrichCard).
    return String(raw).replace(/^[A-Z][\w-]*:\s*/, "")
  }

  // Wave B-8e: when the user clicks a clickable tag on a card or in
  // the drawer, dispatch to the right state mutator + DOM update so
  // the existing filter pipeline picks up the new value the same way
  // it would after a manual sidebar pick.
  //
  // Returns null when nothing changed, or { parts: [...] } indicating
  // which parts the caller should re-render. Wave B-8e-fix-1: dropdown
  // filters return ["results"] only — re-rendering the sidebar would
  // rebuild every <select> from the template (which doesn't pass a
  // `selected` to selectOptions), wiping our just-set value back to
  // "Any". State-based filters (CR slider, source checkboxes) DO need
  // the sidebar re-render because the slider thumb position and the
  // checkbox states are derived from instance state.
  //
  // tagType matches the data-filter-type attribute on the rendered
  // tag; value is the raw underlying key (lowercase / numeric / DB
  // shape, NOT the display label).
  #applyTagFilter(tagType, value) {
    const root = this.element
    if (!root) return null
    // Helper: set a sidebar <select> by id. Returns the parts to
    // re-render (results-only — the live <select> already shows the
    // new value, sidebar re-render would reset it).
    const setSelect = (id, val) => {
      const sel = root.querySelector(`#${id}`)
      if (!sel) return null
      const target = String(val)
      let opt = Array.from(sel.options).find(o => o.value === target)
      if (!opt) opt = Array.from(sel.options).find(o => o.value.toLowerCase() === target.toLowerCase())
      if (!opt) opt = Array.from(sel.options).find(o => (o.textContent || "").trim().toLowerCase() === target.toLowerCase())
      if (!opt) return null
      sel.value = opt.value
      return { parts: ["results"] }
    }
    switch (tagType) {
      case "cr": {
        // CR can be 1/8, 1/4, 1/2 or an integer. CR_STEPS holds the
        // valid filter values; clamp to nearest step.
        const num = (typeof value === "number") ? value : Number(value)
        if (!Number.isFinite(num)) return null
        const STEPS = BeneosCloudWindowV2.CR_STEPS
        let best = STEPS[0], bestDiff = Math.abs(STEPS[0] - num)
        for (const s of STEPS) {
          const d = Math.abs(s - num)
          if (d < bestDiff) { best = s; bestDiff = d }
        }
        this.crMin = best
        this.crMax = best
        const idx = STEPS.indexOf(best)
        const lo = root.querySelector("#bc-cr-min")
        const hi = root.querySelector("#bc-cr-max")
        if (lo) lo.value = String(idx >= 0 ? idx : 0)
        if (hi) hi.value = String(idx >= 0 ? idx : 0)
        // Slider thumb position is derived from instance state — the
        // sidebar re-render keeps it in sync.
        return { parts: ["sidebar", "results"] }
      }
      case "rarity":     return setSelect("rarity-selector", value)
      case "origin":     return setSelect("origin-selector", value)
      case "tier":       return setSelect("tier-selector", value)
      case "item_type":  return setSelect("item-type", value)
      case "type": {
        if (this.searchMode === "bmap") return setSelect("kind-selector", value)
        return setSelect("token-types", value)
      }
      case "faction":    return setSelect("faction-selector", value)
      case "level":      return setSelect("level-selector", value)
      case "school":     return setSelect("school-selector", value)
      case "casting_time": return setSelect("casting-time-selector", value)
      case "spell_type":   return setSelect("spell-type-selector", value)
      case "grid":       return setSelect("bmap-grid", value)
      case "source": {
        const raw = String(value)
        this.sourceHidden = new Set(
          BeneosCloudWindowV2.SOURCE_DEFS
            .map(d => d.key)
            .filter(k => k !== raw)
        )
        // Source checkboxes are derived from instance state; sidebar
        // re-render reflects the new sourceHidden set.
        return { parts: ["sidebar", "results"] }
      }
      default: return null
    }
  }

  // Wave B-8k-5: dedupe loot type entries so "Light Armor +1", "Light
  // Armor +2" etc. collapse into the single base "Light Armor". The
  // raw v1 itemType table has every modded variant as its own option,
  // which is noisy for filtering. searchByProperty already does
  // substring matching on item_type arrays (.toLowerCase().includes()),
  // so the user picks the base option and the filter still catches
  // every variant.
  #dedupeItemTypes(typeList) {
    if (!Array.isArray(typeList)) return typeList
    const stripMods = (s) => String(s).replace(/\s*\+\d+\s*$/, "").trim()
    const seen = new Set()
    const out = []
    for (const entry of typeList) {
      if (entry.key === "any") { out.push(entry); continue }
      const base = stripMods(entry.value || entry.key)
      const baseLower = base.toLowerCase()
      if (seen.has(baseLower)) continue
      seen.add(baseLower)
      out.push({ key: baseLower, value: base })
    }
    return out
  }

  // Wave B-8k-4: normalise a v1 toTable list for the V2 dropdowns.
  // Pulls "Any" to the top, capitalises every other label (Foundry's
  // raw data is sometimes lowercase), and sorts the rest alphabetically
  // by the capitalised label so the visible order matches the visual
  // appearance. The divider between Any and the rest is added in the
  // DOM by #injectSelectDividers since Foundry's selectOptions helper
  // can't emit a disabled `<option>`.
  #orderDropdownList(list) {
    if (!Array.isArray(list)) return list
    const anyEntry = list.find(r => r.key === "any")
    const rest = list
      .filter(r => r.key !== "any")
      .map(r => ({ key: r.key, value: this.#capitalize(r.value) }))
      .sort((a, b) => a.value.localeCompare(b.value))
    const out = []
    if (anyEntry) out.push({ key: "any", value: anyEntry.value || "Any" })
    out.push(...rest)
    return out
  }

  // Wave B-8k-3: post-process the v1 rarity table into the D&D 5e order
  // (Common → Uncommon → Rare → Very Rare → Legendary → Artifact). The
  // raw data sometimes has numeric keys ("0".."5") and sometimes named
  // strings ("common", "uncommon", …); we accept both and emit the
  // canonical English label as the option's text. Items with rarity
  // values outside the D&D bucket are dropped from the dropdown — they
  // would be confusing in a sidebar focused on the standard ladder.
  // The "Any" entry is always pushed first.
  #buildOrderedRarity(rawRarity) {
    if (!Array.isArray(rawRarity)) return rawRarity
    const buckets = [
      { canonical: "Common",    keys: ["common", "0"] },
      { canonical: "Uncommon",  keys: ["uncommon", "1"] },
      { canonical: "Rare",      keys: ["rare", "2"] },
      { canonical: "Very Rare", keys: ["very rare", "veryrare", "3"] },
      { canonical: "Legendary", keys: ["legendary", "4"] },
      { canonical: "Artifact",  keys: ["artifact", "5"] }
    ]
    const out = []
    const anyEntry = rawRarity.find(r => r.key === "any")
    if (anyEntry) out.push(anyEntry)
    for (const bucket of buckets) {
      const found = rawRarity.find(r => bucket.keys.includes(r.key))
      if (found) out.push({ key: found.key, value: bucket.canonical })
    }
    return out
  }

  // Wave B-8c: D&D-style CR labels — fractions for sub-1 challenge ratings,
  // integers otherwise. Database stores them as decimals (0.125 / 0.25 / 0.5);
  // GMs expect to see "1/8 / 1/4 / 1/2" on cards and in the drawer.
  static #formatCR(n) {
    if (n == null || n === "") return null
    const x = Number(n)
    if (!Number.isFinite(x)) return String(n)
    if (x === 0) return "0"
    if (x === 0.125) return "1/8"
    if (x === 0.25)  return "1/4"
    if (x === 0.5)   return "1/2"
    if (Number.isInteger(x)) return String(x)
    // Anything else (rare): show with one decimal as a defensive fallback.
    return x.toFixed(2).replace(/\.?0+$/, "")
  }

  /* ========== Filters ========== */

  #applyTextFilter(entries, term) {
    const t = term.toLowerCase()
    return entries.filter(([key, data]) => {
      const name = (data.name || key).toLowerCase()
      if (name.includes(t)) return true
      const desc = (data.description || "").toLowerCase()
      if (desc.includes(t)) return true
      return false
    })
  }

  #applyDropdownFilters(type, entries) {
    const dbHolder = game.beneos?.databaseHolder
    if (!dbHolder) {
      console.warn("[Beneos V2] applyDropdownFilters: no dbHolder")
      return entries
    }
    const root = this.element
    if (!root) {
      console.warn("[Beneos V2] applyDropdownFilters: no this.element")
      return entries
    }

    let results = Object.fromEntries(entries)
    for (const def of V2_FILTER_DEFS) {
      // Wave B-8h-1: skip filters that don't apply to the current asset
      // type. Without this guard, stale values on the previous tab's
      // sidebar selectors (still in the DOM during the part-render
      // window) cross-contaminate the new tab's filter pipeline.
      if (def.types && !def.types.includes(type)) continue
      const sel = root.querySelector("#" + def.selector)
      if (!sel) continue
      const value = sel.value
      if (!value || value.toLowerCase() === "any") continue
      const beforeCount = Object.keys(results).length
      // Wave B-8d-fix-9: log every active filter so we can see why
      // searchByProperty isn't narrowing for the user's data shape.
      // Also peek at the first item's relevant property to verify the
      // data has the field we expect.
      const firstKey = Object.keys(results)[0]
      const firstItem = results[firstKey]
      const topLevel = firstItem?.[def.prop]
      const inProps  = firstItem?.properties?.[def.prop]
      console.log(`[Beneos V2] filter "${def.selector}" prop="${def.prop}" value="${value}"`,
        `before=${beforeCount}`,
        { firstItemTopLevel: topLevel, firstItemInProperties: inProps })
      // searchByProperty returns a filtered key→data map.
      // Wave B-8g-4: `dbHolder` IS the BeneosDatabaseHolder class itself
      // (assigned in beneos_module.js:43). `dbHolder.constructor` is
      // `Function` — its static-method properties are undefined, so the
      // optional-chained call quietly no-op'd and every dropdown filter
      // returned all entries. Bug had been latent since B-4. Call the
      // static directly on the class.
      const filtered = dbHolder.searchByProperty?.(type, def.prop, value, results)
      if (filtered) results = filtered
      const afterCount = Object.keys(results).length
      console.log(`[Beneos V2] filter "${def.selector}" → after=${afterCount}`)
    }
    return Object.entries(results)
  }

  // Wave B-8c: numeric CR range filter — both bounds inclusive. Default
  // (crMin = 0, crMax = CR_NO_LIMIT) is a no-op so the filter only kicks
  // in when the user has narrowed the range. Tokens without a `cr`
  // property pass through unchanged.
  #applyCRFilter(entries) {
    const isFullRange = this.crMin <= 0 && this.crMax >= BeneosCloudWindowV2.CR_NO_LIMIT
    if (isFullRange) return entries
    return entries.filter(([_key, data]) => {
      const cr = data?.properties?.cr
      if (cr == null || cr === "") return true
      const n = Number(cr)
      if (!Number.isFinite(n)) return true
      return n >= this.crMin && n <= this.crMax
    })
  }

  // Wave B-8i-3: gold (price) range filter for items. Default crMin = 0,
  // crMax = null means "no upper limit" — only kicks in when the user
  // actually narrows. Items without a numeric `properties.price` pass
  // through unchanged so non-priced loot doesn't get hidden.
  #applyGoldFilter(entries) {
    const isFullRange = this.goldMin <= 0 && (this.goldMax == null || this.goldMax >= this.#getMaxItemPrice())
    if (isFullRange) return entries
    const max = this.goldMax ?? Number.POSITIVE_INFINITY
    return entries.filter(([_key, data]) => {
      const p = Number(data?.properties?.price)
      if (!Number.isFinite(p)) return true
      return p >= this.goldMin && p <= max
    })
  }

  // Wave B-8i-3: scan the unfiltered item dataset for the largest
  // `properties.price` so the slider's max bound matches what the DB
  // actually offers. Floored at 100 so the slider isn't degenerate
  // (some servers may not have prices yet).
  #getMaxItemPrice() {
    const dbHolder = game.beneos?.databaseHolder
    if (!dbHolder) return 1000
    const items = dbHolder.getAll?.("item") || {}
    let max = 0
    for (const data of Object.values(items)) {
      const p = Number(data?.properties?.price)
      if (Number.isFinite(p) && p > max) max = p
    }
    return Math.max(max, 100)
  }

  // Wave B-8c / B-8k-2: biome cross-filter with AND semantics. User
  // picks biomes via the chip-dropdown (one Set per mode so the token
  // and bmap filters don't collide on shared names like "Forest").
  // Each item must contain EVERY active biome to pass.
  #applyBiomeFilter(entries) {
    const set = this.searchMode === "bmap" ? this.bmapBiomeFilters : this.biomeFilters
    if (!set.size) return entries
    const required = Array.from(set)
    return entries.filter(([_key, data]) => {
      const biom = data?.properties?.biom
      if (!biom) return false
      const arr = Array.isArray(biom) ? biom : [biom]
      const lower = arr.map(b => String(b).toLowerCase())
      return required.every(b => lower.includes(b.toLowerCase()))
    })
  }

  // Wave B-8d / B-8k-2: split the biome list into two sub-lists for the
  // chip-dropdown UI — "available" goes into the dropdown options (only
  // the biomes the user hasn't picked yet), "chips" are the active
  // filter tags rendered below the dropdown with × buttons. Works for
  // both token and bmap mode by reading the right Set + raw dataset.
  // For other modes returns empty lists so the section just hides.
  #buildBiomeLists() {
    const dbHolder = game.beneos?.databaseHolder
    if (!dbHolder) return { biomeChips: [], biomeAvailable: [] }
    const type = this.searchMode
    if (type !== "token" && type !== "bmap") {
      return { biomeChips: [], biomeAvailable: [] }
    }
    const filterSet = type === "bmap" ? this.bmapBiomeFilters : this.biomeFilters
    const raw = dbHolder.getAll?.(type) || {}
    const counts = {}
    for (const data of Object.values(raw)) {
      const biom = data?.properties?.biom
      if (!biom) continue
      const arr = Array.isArray(biom) ? biom : [biom]
      for (const b of arr) {
        const k = String(b)
        counts[k] = (counts[k] || 0) + 1
      }
    }
    const all = Object.keys(counts).sort((a, b) => a.localeCompare(b))
    const biomeChips = []
    const biomeAvailable = []
    for (const k of all) {
      const item = { key: k, label: this.#capitalize(k), count: counts[k] }
      if (filterSet.has(k)) biomeChips.push(item)
      else                  biomeAvailable.push(item)
    }
    return { biomeChips, biomeAvailable }
  }

  // Wave B-8c: exclusion-model source filter. Empty `sourceHidden` means
  // "show everything"; each source key in the Set means "hide entries
  // tagged with this source". Items with no source field always pass
  // through (no source = unaffected by the filter).
  #applySourceFilter(entries) {
    if (!this.sourceHidden.size) return entries
    return entries.filter(([_key, data]) => {
      const src = data?.properties?.source
      if (!src) return true
      return !this.sourceHidden.has(src)
    })
  }

  // Wave B-8b/c: count entries per source over the full unfiltered dataset
  // for the current assetType. Used by _preparePartContext("sidebar") to
  // populate the checkbox row counts. Only sources with > 0 entries make
  // it into the rendered list, so the user never sees an empty row. Each
  // checkbox row carries i18n label + tooltip from SOURCE_DEFS so the
  // template can localize without hardcoding strings.
  #buildSourceCheckboxes() {
    const dbHolder = game.beneos?.databaseHolder
    if (!dbHolder) return []
    const raw = dbHolder.getAll?.(this.searchMode) || {}
    const counts = {}
    for (const data of Object.values(raw)) {
      const src = data?.properties?.source
      if (src) counts[src] = (counts[src] || 0) + 1
    }
    return BeneosCloudWindowV2.SOURCE_DEFS
      .map(def => ({
        key: def.key,
        label: game.i18n.localize(def.i18nLabel),
        tooltip: game.i18n.localize(def.i18nTooltip),
        count: counts[def.key] || 0,
        // Default-checked so the user sees an explicit "all included" UI;
        // unchecking adds the key to sourceHidden.
        checked: !this.sourceHidden.has(def.key)
      }))
      .filter(c => c.count > 0)
  }

  /* ========== V1-API compatibility shims ========== */

  // Fix #B-5c: legacy helpers (softRefresh on the Launcher, closeAndSave from
  // beneos_utility.js asset-removal paths) call these on whatever sits in
  // `game.beneos.searchEngine`. When v2 is active, that's this window. We
  // expose lightweight no-op / re-render compat methods so the existing
  // helpers keep working without a separate v2 branch in every caller.
  processSelectorSearch() {
    // Wave B-5e: legacy softRefresh expects the result list to rebuild after
    // a per-asset refresh has updated the in-memory installed flags. Instead
    // of a full part re-render (which would reset the scroll position and
    // be visually disruptive — installing a creature halfway down the list
    // suddenly snapping the view to a different one), we transition any
    // "progress" entries to "done" and patch only the affected cards in
    // place. The cards keep their position, the scroll stays put, and the
    // user sees the green flash exactly on the card that just installed.
    for (const [key, state] of this.installState) {
      if (state === "progress") {
        this.installState.set(key, "done")
        this.#patchCardState(key)
        setTimeout(() => {
          this.installState.delete(key)
          this.#patchCardState(key)
        }, 1500)
      }
    }
  }

  saveSearchFilters() {
    // V2 keeps its filter / scroll state on the instance and survives across
    // re-renders by itself, so save-before-close is a no-op. Kept as a method
    // because the legacy closeAndSave() static unconditionally calls it.
  }

  /* ========== Install-progress public API (Wave B-5e) ========== */

  // Both click-install and drag&drop go through this entry point so the
  // visual feedback is identical regardless of how the install was kicked
  // off. handlePendingCanvasDrop in beneos_cloud.js calls this when a cloud
  // token is dropped on the canvas; the click-install handler below calls
  // it directly. Setting installState then patching the single affected
  // card means we never repaint the whole list — the scroll position and
  // off-screen lazy-load state stay intact.
  notifyInstallStarted(key) {
    if (!key) return
    this.installState.set(key, "progress")
    this.#patchCardState(key)
  }

  // Called from the import-pipeline success branches (drainPendingCanvasDrops,
  // softRefresh -> processSelectorSearch chain) and the failure branch
  // (discardPendingCanvasDrops). On success the card transitions to the
  // "done" state for the green flash and then settles into the normal
  // "installed" view; on failure the in-progress state is cleared so the
  // card snaps back to "cloud available" and the user can try again.
  notifyInstallEnded(key, success) {
    if (!key) return
    if (success) {
      this.installState.set(key, "done")
      this.#patchCardState(key)
      setTimeout(() => {
        this.installState.delete(key)
        this.#patchCardState(key)
      }, 1500)
    } else {
      this.installState.delete(key)
      this.#patchCardState(key)
    }
  }

  // In-place DOM patcher for a single card. Avoids the scroll-jump and the
  // visible reflow that a full `render({ parts: ["results"] })` would cause.
  // Re-runs the same processInstalled* + #enrichCard pipeline as the initial
  // render so the card's new state (classes, drag attributes, action area)
  // matches a fresh render exactly. The card's outer position in the DOM
  // does not change.
  #patchCardState(key) {
    if (!key || !this.element) return
    const root = this.element
    const card = root.querySelector(`[data-asset-key="${CSS.escape(key)}"]`)
    if (!card) return  // card may be filtered out — nothing to patch

    const type = card.dataset.assetType
    const dbHolder = game.beneos?.databaseHolder
    if (!type || !dbHolder) return
    const data = dbHolder.getAll?.(type)?.[key]
    if (!data) return

    // Wave B-8g-4: same `dbHolder.constructor` → no-op bug as above.
    // Call the statics directly on dbHolder (which IS the class).
    if (type === "token") dbHolder.processInstalledToken?.(data)
    if (type === "item")  dbHolder.processInstalledItem?.(data)
    if (type === "spell") dbHolder.processInstalledSpell?.(data)
    if (type === "bmap")  dbHolder.processInstalledBattlemap?.(data)
    const enriched = this.#enrichCard(type, key, data)

    // Outer card classes — match the conditional set in results-pane.hbs.
    card.classList.toggle("bc-card-installed",      !!enriched.isInstalled)
    card.classList.toggle("bc-card-cloud",          !!enriched.isCloudAvailable)
    card.classList.toggle("bc-card-installing",     !!enriched.isInstalling)
    card.classList.toggle("bc-card-just-installed", !!enriched.justInstalled)

    // Inline custom property for the realistic-fill animation duration.
    card.style.setProperty("--bc-install-duration", enriched.installDuration)

    // Drag attributes can change when an asset transitions cloud → installed:
    // the local-drag world-actor uuid only exists once the actor is in the
    // world, so dragMode flips from "cloud" to "local" and documentId
    // becomes non-empty (Wave B-1d).
    card.dataset.dragMode  = enriched.dragMode
    card.dataset.documentId = enriched.documentId
    card.draggable = enriched.isDraggable

    // Action area — replace inner HTML based on the new state. The action
    // markup mirrors the {{#if}} chain in results-pane.hbs; we rebuild it
    // here in JS for the patch path so we don't need to render a partial.
    const actions = card.querySelector(".bc-card-actions")
    if (actions) {
      actions.innerHTML = this.#buildCardActionsHTML(enriched)
      // Re-bind the install-button click listener on the freshly inserted
      // button, if there is one. The dragstart listener is on the outer
      // .bc-result-card and survives the inner-HTML swap.
      const btn = actions.querySelector(".bc-action-install")
      if (btn) btn.addEventListener("click", (event) => this.#onInstallClick(event, btn))
    }
  }

  #buildCardActionsHTML(card) {
    const localize = (k) => game.i18n.localize(k)
    if (card.isInstalling) {
      return `<span class="bc-state-pill bc-state-installing" data-tooltip="${localize("BENEOS.Cloud.Card.InstallingTooltip")}">`
        + `<i class="fa-solid fa-circle-notch fa-spin"></i> ${localize("BENEOS.Cloud.Card.Installing")}</span>`
    }
    if (card.isInstalled) {
      let html = `<span class="bc-state-pill bc-state-installed" data-tooltip="${localize("BENEOS.Cloud.Card.InstalledTooltip")}">`
        + `<i class="fa-solid fa-circle-check"></i> ${localize("BENEOS.Cloud.Card.Installed")}</span>`
      if (card.isUpdate) {
        html += `<button type="button" class="bc-card-button bc-card-button-primary bc-action-install"`
          + ` data-asset-key="${card.key}" data-asset-type="${card.assetType}"`
          + ` data-tooltip="${localize("BENEOS.Cloud.Card.UpdateTooltip")}">`
          + `<i class="fa-solid fa-rotate"></i></button>`
      }
      return html
    }
    if (card.isCloudAvailable) {
      // Wave B-7: bmaps get a Moulinette-branded action button instead of
      // "Install" so the user understands the install flows through
      // Moulinette (until the cloud-bmap pipeline ships in B-8).
      if (card.isBmap) {
        return `<button type="button" class="bc-card-button bc-card-button-primary bc-action-install bc-action-moulinette"`
          + ` data-asset-key="${card.key}" data-asset-type="${card.assetType}"`
          + ` data-tooltip="${localize("BENEOS.Cloud.Card.MoulinetteTooltip")}">`
          + `<i class="fa-solid fa-cube"></i> ${localize("BENEOS.Cloud.Card.Moulinette")}</button>`
      }
      return `<button type="button" class="bc-card-button bc-card-button-primary bc-action-install"`
        + ` data-asset-key="${card.key}" data-asset-type="${card.assetType}"`
        + ` data-tooltip="${localize("BENEOS.Cloud.Card.InstallTooltip")}">`
        + `<i class="fa-solid fa-cloud-arrow-down"></i> ${localize("BENEOS.Cloud.Card.Install")}</button>`
    }
    return `<span class="bc-state-pill bc-state-unavailable" data-tooltip="${localize("BENEOS.Cloud.Card.UnavailableTooltip")}">`
      + `<i class="fa-solid fa-circle-minus"></i> ${localize("BENEOS.Cloud.Card.NotAvailable")}</span>`
  }

  // Wave B-8g-3: bulk install loop for the New / Update divider buttons.
  // Confirmation dialog before queuing — the user shouldn't accidentally
  // pull dozens of tokens. Sequential triggers (200ms apart) so the cloud
  // backend isn't hammered and the inflight-locks (B-1b) have a chance to
  // settle. Each token routes through the same notifyInstallStarted/
  // notifyInstallEnded pipeline as a single install — cards pulse one at
  // a time as the queue drains.
  async #onBulkInstallClick(group) {
    const keys = this._groupBulkKeys?.[group] || []
    if (!keys.length) return
    const cloud = game.beneos?.cloud
    if (!cloud) return
    const type = this.searchMode

    // Wave B-8k-1: per-group dialog title + body. The "backlog" branch
    // gets a stronger warning because it ignores the current filter and
    // the installs can stretch into the hour-range; the dialog default
    // button is "No" so the user has to consciously choose Yes.
    // Wave B-9-fix-39: wrap the content in our own centred container so
    // we have a class hook the V2 styles can reliably target — Foundry's
    // default dialog markup didn't pick up the V2 theme cleanly.
    let titleKey, innerHtml
    if (group === "backlog") {
      titleKey = "BENEOS.Cloud.Results.InstallAllBacklogTitle"
      innerHtml =
        `<p class="bc-confirm-text">${game.i18n.format("BENEOS.Cloud.Results.InstallAllBacklogConfirm", { count: keys.length })}</p>` +
        `<p class="bc-confirm-warning">${game.i18n.localize("BENEOS.Cloud.Results.InstallAllBacklogWarning")}</p>`
    } else {
      titleKey = group === "new"
        ? "BENEOS.Cloud.Results.InstallAllNewTitle"
        : group === "update"
          ? "BENEOS.Cloud.Results.InstallAllUpdateTitle"
          : "BENEOS.Cloud.Results.InstallAllViewTitle"
      innerHtml = `<p class="bc-confirm-text">${game.i18n.format("BENEOS.Cloud.Results.InstallAllConfirm", { count: keys.length })}</p>`
    }
    const contentHtml = `<div class="bc-confirm-content">${innerHtml}</div>`
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(titleKey) },
      classes: ["dialog", "app", "window-app", "beneos-cloud-app", "beneos-confirm"],
      position: { width: 460 },
      content: contentHtml,
      yes:  { default: false },
      no:   { default: true }
    })
    if (!confirmed) return
    ui.notifications.info(game.i18n.format("BENEOS.Cloud.Results.InstallAllStart", { count: keys.length }))
    // Wave B-9-fix-47: await each pipeline so the compendium's
    // lock/unlock cycle completes before the next starts. The old
    // 250ms timer would race when imports outpaced their own lock
    // step, leading to "locked compendium" errors mid-batch.
    for (const key of keys) {
      this.notifyInstallStarted?.(key)
      if (type === "token") await cloud.importTokenFromCloud?.(key)
      else if (type === "item")  await cloud.importItemFromCloud?.(key)
      else if (type === "spell") await cloud.importSpellsFromCloud?.(key)
    }
  }

  // Extracted from the install-button click handler so the same logic runs
  // for the freshly inserted button after #patchCardState.
  #onInstallClick(event, btn) {
    event.stopPropagation()
    const key = btn.dataset.assetKey
    const type = btn.dataset.assetType
    if (!key || !type) return
    const cloud = game.beneos?.cloud
    if (!cloud) return
    // Wave B-9-fix-46: if the user has Ctrl+click-built a multi-select
    // and clicks the drawer install button, kick off imports for every
    // key in the set instead of just the drawer card. Bmaps don't
    // participate (they go through Moulinette anyway).
    if (type !== "bmap" && this.selectedKeys?.size > 1 && this.selectedKeys.has(key)) {
      this.#installSelected(type)
      return
    }
    if (type !== "bmap") this.notifyInstallStarted(key)
    if (type === "token") cloud.importTokenFromCloud(key)
    if (type === "item")  cloud.importItemFromCloud(key)
    if (type === "spell") cloud.importSpellsFromCloud(key)
    if (type === "bmap") {
      // Wave B-7: pass the bmap key so the static handler can look up
      // download_pack/creator/terms and call Moulinette's searchUI with the
      // pre-filter — opens the user directly on the matching map.
      BeneosCloudWindowV2._onMoulinetteInstall(event, key)
    }
  }

  // Wave B-9-fix-46 → fix-47: sequentially fire imports for every key
  // in the multi-select. The 250ms pacing was added when imports were
  // fire-and-forget; with the imports now Promise-returning we await
  // each one so its full lock/unlock cycle on the compendium completes
  // before the next starts. Avoids the "locked compendium" race when
  // 7+ items hit the same pack in parallel.
  async #installSelected(type) {
    const cloud = game.beneos?.cloud
    if (!cloud) return
    const keys = [...this.selectedKeys]
    for (const k of keys) {
      this.notifyInstallStarted(k)
      if (type === "token") await cloud.importTokenFromCloud?.(k)
      else if (type === "item")  await cloud.importItemFromCloud?.(k)
      else if (type === "spell") await cloud.importSpellsFromCloud?.(k)
    }
  }

  /* ========== Render lifecycle ========== */

  _onRender(context, options) {
    super._onRender?.(context, options)
    this.#wireSidebarListeners()
    this.#wireResultListeners()
    this.#wireScrollLoader()
    this.#wireVariantListeners()
    this.#refreshFilterInfoIcons()
    this.#injectSelectDividers()
    this.#updateTitleBadge(context)
  }

  // Wave B-8k-4: insert a disabled "──────────" option after the Any
  // entry in every filter dropdown so the user sees a clear visual break
  // between the all-results choice and the actual filter values.
  // selectOptions can't emit disabled options on its own, so we patch
  // the DOM after Foundry has rendered the part. The data-bc-divider
  // flag stops re-inserting on subsequent renders.
  #injectSelectDividers() {
    const root = this.element
    if (!root) return
    root.querySelectorAll(".beneos-selector").forEach(sel => {
      if (sel.querySelector("option[data-bc-divider]")) return
      const anyOpt = sel.querySelector('option[value="any"]')
      if (!anyOpt) return
      const divider = document.createElement("option")
      divider.disabled = true
      divider.dataset.bcDivider = "true"
      divider.textContent = "──────────"
      anyOpt.insertAdjacentElement("afterend", divider)
    })
  }

  // Wave B-8i-2: keep the per-dropdown info icons in sync with the
  // selected value. Icon is visible only when the dropdown has a
  // non-Any selection AND the tag has a description in the DB. The
  // tooltip text is set via Foundry's data-tooltip attribute so hover
  // shows the description without extra JS.
  #refreshFilterInfoIcons() {
    const root = this.element
    if (!root) return
    root.querySelectorAll(".bc-filter-info[data-info-for]").forEach(icon => {
      const targetId = icon.dataset.infoFor
      const sel = root.querySelector("#" + targetId)
      const value = sel?.value
      // Wave B-8k-fix-2: optional context attribute on the icon (e.g.
      // data-info-context="tier") routes the lookup to hardcoded
      // fallbacks for tags that aren't in the DB.
      const context = icon.dataset.infoContext || null
      const desc = this.#getTagDescription(value, context)
      if (desc) {
        icon.dataset.tooltip = desc
        icon.style.display = ""
      } else {
        icon.removeAttribute("data-tooltip")
        icon.style.display = "none"
      }
    })
  }

  /* ========== Infinite scroll (Wave B-5e-fix-4) ========== */

  // Bind a scroll listener on the result list so reaching the bottom loads
  // the next page of cards. Foundry replaces the part DOM on each render,
  // so each new .bc-result-list element is unbound until we attach again
  // here. The flag on the element guards against double-binding within the
  // same render.
  #wireScrollLoader() {
    const list = this.element?.querySelector(".bc-result-list")
    if (!list || list._beneosScrollBound) return
    list._beneosScrollBound = true
    list.addEventListener("scroll", () => {
      if (this._loadingMore || !this._hasMoreResults) return
      const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
      if (distanceFromBottom < 200) this.#loadMore(list)
    })
  }

  // Capture scroll position, bump the page, re-render, restore scroll. The
  // re-render rebuilds the .bc-result-list inside the part — we re-locate
  // the new node and reapply scrollTop so the user lands exactly where they
  // were before the new page appeared.
  async #loadMore(list) {
    this._loadingMore = true
    const scrollTop = list.scrollTop
    this.loadedCount += BeneosCloudWindowV2.RESULTS_PAGE
    // Wave B-9-fix-11/15: bmap pagination is heavy because each card
    // pulls a full-resolution thumbnail. The first attempt (showLoading
    // + immediate render) didn't paint the spinner because the synchronous
    // render swallowed the frame. Same fix as #renderResults: double-rAF
    // wrap so the spinner has a paint frame before the heavy work
    // starts, plus a 350ms minimum display so the user reliably sees it
    // even when the network and decode happen to be quick.
    const isBmap = this.searchMode === "bmap"
    if (isBmap) {
      this.#showLoading()
      const minDisplay = new Promise(r => setTimeout(r, 350))
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(async () => {
            try { await this.render({ parts: ["results"] }) }
            finally { resolve() }
          })
        })
      })
      await minDisplay
      this.#hideLoading()
    } else {
      await this.render({ parts: ["results"] })
    }
    const newList = this.element?.querySelector(".bc-result-list")
    if (newList) newList.scrollTop = scrollTop
    this._loadingMore = false
  }

  // Reset the page counter back to one screen of results. Called whenever
  // the underlying entries list changes (filter / tab / reset), so the user
  // doesn't end up scrolled past the new shorter list's end.
  #resetPagination() {
    this.loadedCount = BeneosCloudWindowV2.RESULTS_PAGE
  }

  /* ========== Variant carousel (Wave B-6) ========== */

  // Bind click + dragstart on every variant thumb in the drawer. Click
  // swaps the hero image to the variant's thumbnail and updates the active
  // outline + counter — purely visual, no installation. Dragstart hands
  // the user the variant's specific actor as drag data, so dropping on
  // canvas places exactly that variant. Cloud-only variants are filtered
  // out of the dragstart binding (they have draggable="false" via the
  // template guard already; this is just defense-in-depth).
  #wireVariantListeners() {
    const region = this.element?.querySelector("[data-bc-variant-region]")
    if (!region) return
    region.querySelectorAll(".bc-variant-thumb").forEach(btn => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation()
        this.#selectVariant(btn)
      })
    })
    region.querySelectorAll(".bc-variant-thumb[draggable='true']").forEach(btn => {
      btn.addEventListener("dragstart", (event) => this.#onVariantDragStart(event, btn))
    })
  }

  // Hero swap + active-outline toggle + counter update. All three are
  // direct DOM mutations — no re-render — so the drawer's scroll position
  // and other state stay put. The hero img is reused across variants by
  // simply swapping its src to the clicked thumbnail's URL.
  #selectVariant(btn) {
    const root = this.element
    if (!root) return
    const idx = btn.dataset.variantIndex
    const newImg = btn.querySelector("img")
    const heroImg = root.querySelector("[data-bc-drawer-hero] img")
    if (heroImg && newImg) heroImg.src = newImg.src
    root.querySelectorAll(".bc-variant-thumb").forEach(t => {
      t.classList.toggle("bc-variant-active", t === btn)
    })
    const counter = root.querySelector("[data-bc-variant-counter]")
    if (counter) {
      const total = counter.textContent.split(" / ")[1]
      counter.textContent = `${idx} / ${total}`
    }
  }

  // Drag a specific variant — same shape as the card-level local-drag in
  // #onCardDragStart, but pointed at the variant's actor instead of the
  // primary actor. Reuses the Wave B-5e-fix-3 pattern of setting a clean
  // 56×56 thumbnail as the drag image so the cursor carries something
  // recognizable instead of a snapshot of the button element.
  #onVariantDragStart(event, btn) {
    const actorId = btn.dataset.actorId
    if (!actorId) { event.preventDefault(); return false }
    const compendium = "world.beneos_module_actors"
    const worldActor = game.actors?.get?.(actorId) ||
                       game.actors?.find?.(a => {
                         const flag = a.getFlag?.("world", "beneos")
                         return flag?.actorId === actorId
                       })
    const drag_data = worldActor
      ? { type: "Actor", uuid: worldActor.uuid }
      : { type: "Actor", pack: compendium, uuid: `Compendium.${compendium}.${actorId}` }
    event.dataTransfer.setData("text/plain", JSON.stringify(drag_data))
    const thumbImg = btn.querySelector("img")
    if (thumbImg && thumbImg.complete && thumbImg.naturalWidth > 0) {
      event.dataTransfer.setDragImage(thumbImg, 28, 28)
    }
  }

  /* ========== Sidebar listeners ========== */

  #wireSidebarListeners() {
    const root = this.element
    if (!root) return

    const textInput = root.querySelector("#beneos-search-text")
    if (textInput) {
      // Restore previous filter value across re-renders.
      if (this._textFilter) textInput.value = this._textFilter
      textInput.addEventListener("keyup", (event) => {
        if (event.key === "Enter") { event.preventDefault(); return }
        clearTimeout(this._textSearchTimer)
        this._textSearchTimer = setTimeout(() => {
          this._textFilter = textInput.value || ""
          // Wave B-5e-fix-4: filter change -> back to first page.
          this.#resetPagination()
          this.#renderResults(["results"])
        }, 300)
      })
    }

    root.querySelectorAll(".beneos-selector").forEach(sel => {
      sel.addEventListener("change", () => {
        // Wave B-8i-2: update the info icon next to this dropdown
        // immediately so the tooltip reflects the new selection without
        // waiting for the debounced render.
        this.#refreshFilterInfoIcons()
        clearTimeout(this._dropdownTimer)
        this._dropdownTimer = setTimeout(() => {
          // Wave B-5e-fix-4: dropdown change -> back to first page.
          this.#resetPagination()
          this.#renderResults(["results"])
        }, 100)
      })
    })

    // Wave B-8e-fix-7: dropped the manual click listener — the
    // data-action="resetFilters" attribute on the button already
    // routes through ApplicationV2's action dispatcher to
    // _onResetFilters, which does the same #cleanFilters +
    // #resetPagination + #renderResults work. The duplicate listener
    // ran the reset twice per click (idempotent so harmless), and the
    // <a href="#"> previously here let the click bubble out of our
    // window into Foundry's app-shell, where it ended up opening
    // localhost:30000/join in a new tab.

    // Wave B-8c: dual-thumb CR range slider. Two overlapping range
    // inputs, each addressing one bound. Steps are CR_STEPS indices
    // (uniform spacing on the slider, mapped to real CR values for the
    // filter). Live display shows the formatted fraction labels; commit
    // is debounced via _crTimer.
    const crMinEl = root.querySelector("#bc-cr-min")
    const crMaxEl = root.querySelector("#bc-cr-max")
    const crDisplay = root.querySelector("#bc-cr-display")
    const crFill = root.querySelector("[data-bc-slider-fill]")
    const STEPS = BeneosCloudWindowV2.CR_STEPS
    const updateDisplay = () => {
      if (!crMinEl || !crMaxEl) return
      const minVal = STEPS[parseInt(crMinEl.value, 10)] ?? 0
      const maxVal = STEPS[parseInt(crMaxEl.value, 10)] ?? BeneosCloudWindowV2.CR_NO_LIMIT
      if (crDisplay) {
        crDisplay.textContent =
          `${BeneosCloudWindowV2.#formatCR(minVal)} – ${BeneosCloudWindowV2.#formatCR(maxVal)}`
      }
      if (crFill) {
        const span = STEPS.length - 1
        const leftPct = (parseInt(crMinEl.value, 10) / span) * 100
        const rightPct = (parseInt(crMaxEl.value, 10) / span) * 100
        crFill.style.left = `${leftPct}%`
        crFill.style.right = `${100 - rightPct}%`
      }
    }
    const enforceOrder = (changed) => {
      if (!crMinEl || !crMaxEl) return
      const lo = parseInt(crMinEl.value, 10)
      const hi = parseInt(crMaxEl.value, 10)
      if (lo > hi) {
        // Push the other thumb so min ≤ max always.
        if (changed === "min") crMaxEl.value = String(lo)
        else crMinEl.value = String(hi)
      }
    }
    // Wave B-8g-1: commit on `input` with a 250ms debounce instead of
    // relying on `change`. The `change` event on range inputs is fired
    // by the browser only on release (and inconsistently in Electron
    // for dual-thumb setups). `input` fires continuously during drag —
    // with debounce it commits once the user stops moving the thumb,
    // which is what we want. Plus: re-query the live DOM inside the
    // setTimeout callback (closure-captured crMinEl could be a stale
    // reference if the sidebar was re-rendered between drag start and
    // timer fire). Logs the commit so we can verify in F12 that the
    // state actually updates.
    const commitCR = () => {
      clearTimeout(this._crTimer)
      this._crTimer = setTimeout(() => {
        const liveMin = this.element?.querySelector("#bc-cr-min")
        const liveMax = this.element?.querySelector("#bc-cr-max")
        if (!liveMin || !liveMax) return
        const newMin = STEPS[parseInt(liveMin.value, 10)] ?? 0
        const newMax = STEPS[parseInt(liveMax.value, 10)] ?? BeneosCloudWindowV2.CR_NO_LIMIT
        if (newMin === this.crMin && newMax === this.crMax) return
        this.crMin = newMin
        this.crMax = newMax
        console.log(`[Beneos V2] CR slider commit: min=${this.crMin} max=${this.crMax}`)
        this.#resetPagination()
        this.#renderResults(["results"])
      }, 250)
    }
    if (crMinEl) {
      crMinEl.addEventListener("input", () => {
        enforceOrder("min")
        updateDisplay()
        commitCR()
      })
    }
    if (crMaxEl) {
      crMaxEl.addEventListener("input", () => {
        enforceOrder("max")
        updateDisplay()
        commitCR()
      })
    }

    // Wave B-8i-3: gold dual-thumb slider for items. Same pattern as CR
    // (input event + debounced commit + DOM-re-query in setTimeout) but
    // uses the actual numeric value directly — no STEPS array since the
    // slider is linear from 0 to maxPrice.
    const goldMinEl = root.querySelector("#bc-gold-min")
    const goldMaxEl = root.querySelector("#bc-gold-max")
    const goldDisplay = root.querySelector("#bc-gold-display")
    const goldFill = root.querySelector("[data-bc-slider-fill='gold']")
    const updateGoldDisplay = () => {
      if (!goldMinEl || !goldMaxEl) return
      const lo = parseInt(goldMinEl.value, 10) || 0
      const hi = parseInt(goldMaxEl.value, 10) || 0
      if (goldDisplay) goldDisplay.textContent = `${lo} – ${hi}`
      if (goldFill) {
        const max = parseInt(goldMaxEl.max, 10) || 1
        goldFill.style.left = `${(lo / max) * 100}%`
        goldFill.style.right = `${100 - (hi / max) * 100}%`
      }
    }
    const enforceGoldOrder = (changed) => {
      if (!goldMinEl || !goldMaxEl) return
      const lo = parseInt(goldMinEl.value, 10)
      const hi = parseInt(goldMaxEl.value, 10)
      if (lo > hi) {
        if (changed === "min") goldMaxEl.value = String(lo)
        else                   goldMinEl.value = String(hi)
      }
    }
    const commitGold = () => {
      clearTimeout(this._goldTimer)
      this._goldTimer = setTimeout(() => {
        const liveMin = this.element?.querySelector("#bc-gold-min")
        const liveMax = this.element?.querySelector("#bc-gold-max")
        if (!liveMin || !liveMax) return
        this.goldMin = parseInt(liveMin.value, 10) || 0
        this.goldMax = parseInt(liveMax.value, 10) || null
        this.#resetPagination()
        this.#renderResults(["results"])
      }, 250)
    }
    if (goldMinEl) {
      goldMinEl.addEventListener("input", () => {
        enforceGoldOrder("min")
        updateGoldDisplay()
        commitGold()
      })
    }
    if (goldMaxEl) {
      goldMaxEl.addEventListener("input", () => {
        enforceGoldOrder("max")
        updateGoldDisplay()
        commitGold()
      })
    }
    updateGoldDisplay()
    // Initial fill paint for the active range strip.
    updateDisplay()

    // Wave B-8d: biome chip-dropdown. Picking from the dropdown adds the
    // biome to `this.biomeFilters` (becomes a chip below); clicking ×
    // on a chip removes it and the biome moves back into the dropdown
    // options. Both code paths go through the same render path so the
    // sidebar refreshes its lists and the results re-filter.
    // Wave B-8k-2: biome dropdown + chips work for both token and bmap
    // mode. The active filter Set is picked at click-time based on the
    // current searchMode, so the same DOM markup serves both tabs.
    const biomeAddEl = root.querySelector("#bc-biome-add")
    if (biomeAddEl) {
      biomeAddEl.addEventListener("change", () => {
        const v = biomeAddEl.value
        if (!v) return
        const set = this.searchMode === "bmap" ? this.bmapBiomeFilters : this.biomeFilters
        set.add(v)
        this.#resetPagination()
        this.#renderPreservingSidebarScroll(["sidebar", "results"])
      })
    }
    root.querySelectorAll(".bc-biome-chip").forEach(chip => {
      chip.addEventListener("click", (event) => {
        event.preventDefault()
        const biome = chip.dataset.biome
        if (!biome) return
        const set = this.searchMode === "bmap" ? this.bmapBiomeFilters : this.biomeFilters
        set.delete(biome)
        this.#resetPagination()
        this.#renderPreservingSidebarScroll(["sidebar", "results"])
      })
    })

    // Wave B-8c: source checkboxes — exclusion model. Default-checked
    // state is set in the template via {{#if src.checked}}; the listener
    // updates `this.sourceHidden` on toggle. Unchecked = source key in
    // sourceHidden; rechecked = removed from sourceHidden.
    root.querySelectorAll(".bc-source-checkbox").forEach(cb => {
      const src = cb.dataset.source
      cb.addEventListener("change", () => {
        if (cb.checked) this.sourceHidden.delete(src)
        else this.sourceHidden.add(src)
        this.#resetPagination()
        this.#renderResults(["results"])
      })
    })

    // Wave B-9-fix-4: design-only loot placeholder buttons. Mechanics
    // are TBD; clicking either button surfaces a "coming soon" toast so
    // the user knows the slot is a real future feature, not a dead
    // affordance. The buttons only render in the item sidebar block
    // (sidebar-form.hbs guards on searchMode "item").
    const comingSoon = () =>
      ui.notifications.info(game.i18n.localize("BENEOS.Cloud.Filter.ComingSoon"))
    const originBtn = root.querySelector("#bc-origin-set-bonuses")
    if (originBtn) originBtn.addEventListener("click", comingSoon)
    const tierBtn = root.querySelector("#bc-tier-upgrade-mechanic")
    if (tierBtn) tierBtn.addEventListener("click", comingSoon)
  }

  #cleanFilters() {
    const root = this.element
    if (!root) return
    root.querySelectorAll(".beneos-selector").forEach(sel => { sel.value = "any" })
    const t = root.querySelector("#beneos-search-text")
    if (t) t.value = ""
    this._textFilter = ""
    // Wave B-8b/c: also clear the slider + checkbox state. With the
    // exclusion model, "reset" means re-check all source boxes; biome
    // resets to no filter (no boxes checked).
    // Wave B-8k-2: clear bmap biome set too so a Reset on the maps tab
    // also drops chips.
    this.crMin = 0
    this.crMax = BeneosCloudWindowV2.CR_NO_LIMIT
    this.sourceHidden.clear()
    this.biomeFilters.clear()
    this.bmapBiomeFilters.clear()
    const STEPS = BeneosCloudWindowV2.CR_STEPS
    const crMinEl = root.querySelector("#bc-cr-min")
    const crMaxEl = root.querySelector("#bc-cr-max")
    if (crMinEl) crMinEl.value = "0"
    if (crMaxEl) crMaxEl.value = String(STEPS.length - 1)
    const crDisplay = root.querySelector("#bc-cr-display")
    if (crDisplay) {
      crDisplay.textContent =
        `${BeneosCloudWindowV2.#formatCR(0)} – ${BeneosCloudWindowV2.#formatCR(BeneosCloudWindowV2.CR_NO_LIMIT)}`
    }
    root.querySelectorAll(".bc-source-checkbox").forEach(cb => { cb.checked = true })
    // Wave B-8d: reset biome dropdown to placeholder. Chips disappear
    // automatically on next render because biomeFilters is now empty.
    const biomeAddEl = root.querySelector("#bc-biome-add")
    if (biomeAddEl) biomeAddEl.value = ""
    // Wave B-8i-3: reset gold range to full span.
    this.goldMin = 0
    this.goldMax = null
    const goldMinEl = root.querySelector("#bc-gold-min")
    const goldMaxEl = root.querySelector("#bc-gold-max")
    if (goldMinEl) goldMinEl.value = "0"
    if (goldMaxEl) goldMaxEl.value = String(goldMaxEl.max || 0)
  }

  /* ========== Result-card listeners (dragstart, click, install, drawer) ========== */

  #wireResultListeners() {
    const root = this.element
    if (!root) return
    const resultsRegion = root.querySelector("[data-bc-region='results']")
    if (!resultsRegion) return

    // 1) Card click → open detail drawer (unless click landed on an install
    //    button, which has its own action).
    // Wave B-8d-fix-10: opening the drawer for bmaps loads a much larger
    // hero image than the card thumbnail, which can show a brief lag.
    // Wrap the render in the same loading-spinner pattern as tab switch
    // so the user gets feedback for any "click that triggers a heavy
    // render" — not just navigation.
    resultsRegion.querySelectorAll(".bc-result-card").forEach(card => {
      card.addEventListener("click", (event) => {
        if (event.target.closest(".bc-action-install")) return
        // Wave B-8e: clickable tag inside the card — let the dedicated
        // tag listener handle it and stop the card from also opening
        // the drawer. The tag listener calls stopPropagation, but this
        // guard catches the case where event delegation order means
        // the card's click handler fires first.
        if (event.target.closest("[data-filter-type]")) return
        const key = card.dataset.assetKey
        if (!key) return
        // Wave B-9-fix-46: multi-select. Ctrl/Cmd+click toggles the
        // card in selectedKeys; plain click resets the set. Maps tab
        // is single-select-only because there's no batch install path
        // for bmaps. Drawer always shows the last-clicked card.
        const allowMulti = this.searchMode !== "bmap"
        if (allowMulti && (event.ctrlKey || event.metaKey)) {
          if (this.selectedKeys.has(key)) this.selectedKeys.delete(key)
          else this.selectedKeys.add(key)
        } else {
          this.selectedKeys = new Set([key])
        }
        // Wave B-9-fix-32: capture the result-list scroll position
        // before the part-render rebuilds the DOM, restore it after,
        // so the user's view doesn't jump when opening the drawer.
        const list = this.element?.querySelector(".bc-result-list")
        const scrollTop = list?.scrollTop || 0
        this.selectedAssetKey = key
        this.#showLoading()
        requestAnimationFrame(() => {
          requestAnimationFrame(async () => {
            try {
              await this.render({ parts: ["results"] })
            } finally {
              this.#hideLoading()
              const newList = this.element?.querySelector(".bc-result-list")
              if (newList) newList.scrollTop = scrollTop
            }
          })
        })
      })
    })

    // 2) Install / Update buttons.
    // Wave B-5e: handler is shared with #patchCardState (so freshly inserted
    // buttons after an in-place card update get the same behavior).
    resultsRegion.querySelectorAll(".bc-action-install").forEach(btn => {
      btn.addEventListener("click", (event) => this.#onInstallClick(event, btn))
    })

    // Wave B-8e: clickable result-card and drawer tags. data-filter-type
    // identifies which sidebar control to mutate; data-filter-value
    // carries the raw key (lowercase / numeric / DB-shape — NOT the
    // display label). #applyTagFilter dispatches; we then sync the
    // pagination + re-render sidebar+results so the new filter takes
    // effect everywhere. stopPropagation keeps the card-click drawer
    // logic from also firing.
    resultsRegion.querySelectorAll("[data-filter-type]").forEach(el => {
      el.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        const tagType = el.dataset.filterType
        const value = el.dataset.filterValue
        if (!tagType || value === undefined || value === "" || value === "null") return
        // Wave B-8e-fix-1: #applyTagFilter returns the parts to render
        // (dropdown filters: ["results"] only — re-rendering the sidebar
        // would wipe the just-set <select> value back to "Any" because
        // selectOptions doesn't carry our pick on rebuild).
        const result = this.#applyTagFilter(tagType, value)
        if (!result) return
        this.#resetPagination?.()
        const parts = result.parts || ["results"]
        if (this.#renderResults) this.#renderResults(parts)
        else this.render({ parts })
      })
    })

    // Wave B-8i-1: bulk-install items live in the consolidated kebab
    // menu above the result list now. Each item carries data-bulk-group
    // (matching | new | update); click triggers the confirmation dialog
    // and the sequential install loop.
    resultsRegion.querySelectorAll(".bc-bulk-menu-item").forEach(btn => {
      btn.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        const group = btn.dataset.bulkGroup
        if (!group) return
        // Close the <details> menu after click.
        const menu = btn.closest("details.bc-bulk-menu")
        if (menu) menu.open = false
        this.#onBulkInstallClick(group)
      })
    })

    // 3) Close drawer button.
    // Wave B-8h-4: drawer-close also re-renders 100 cards which feels
    // sluggish for bmap (the dropped-image teardown takes a beat). Wrap
    // with the same showLoading + double-rAF pattern as card-click and
    // tab-switch so the user gets the centered spinner while it finishes.
    resultsRegion.querySelectorAll(".bc-action-close-drawer").forEach(btn => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation()
        // Wave B-9-fix-32: same scroll-preserve pattern on close so the
        // result list returns to where the user was, not the top.
        const list = this.element?.querySelector(".bc-result-list")
        const scrollTop = list?.scrollTop || 0
        this.selectedAssetKey = null
        // Wave B-9-fix-46: closing the drawer also clears multi-select
        // since there's no UI to operate on the set without a drawer.
        this.selectedKeys = new Set()
        this.#showLoading()
        requestAnimationFrame(() => {
          requestAnimationFrame(async () => {
            try {
              await this.render({ parts: ["results"] })
            } finally {
              this.#hideLoading()
              const newList = this.element?.querySelector(".bc-result-list")
              if (newList) newList.scrollTop = scrollTop
            }
          })
        })
      })
    })

    // 4) Dragstart — same logic as v1's `.token-search-data` handler so the
    //    B-1d drag pipeline (local-drag world-actor uuid + cloud-drag phantom
    //    marker + dropCanvasData hook) works without changes.
    resultsRegion.querySelectorAll(".bc-result-card").forEach(card => {
      card.addEventListener("dragstart", (event) => this.#onCardDragStart(event, card))
    })

    // 5) Read-more toggle for the drawer description (Wave B-9-fix-23).
    //    Token grid drawer narrows the description into column 3, where
    //    long creature lore would balloon the drawer height. The clamp
    //    is CSS; this listener flips the .bc-expanded state and updates
    //    the button label. If the text fits without clamping (scrollHeight
    //    ≤ clientHeight on first paint), the button hides itself so we
    //    don't show a useless toggle on short descriptions.
    const desc = resultsRegion.querySelector("[data-bc-description]")
    const readBtn = resultsRegion.querySelector("[data-bc-readmore]")
    if (desc && readBtn) {
      // Defer measurement one frame so layout is settled.
      requestAnimationFrame(() => {
        if (desc.scrollHeight <= desc.clientHeight + 1) {
          readBtn.style.display = "none"
        }
      })
      readBtn.addEventListener("click", (event) => {
        event.stopPropagation()
        const expanded = desc.classList.toggle("bc-expanded")
        readBtn.textContent = expanded
          ? readBtn.dataset.labelLess
          : readBtn.dataset.labelMore
      })
    }
  }

  #onCardDragStart(event, card) {
    const dragMode = card.dataset.dragMode
    if (!dragMode || dragMode === "none") {
      event.preventDefault()
      return false
    }
    const id = card.dataset.documentId || ""
    const docType = card.dataset.type || "Actor"
    const tokenKey = card.dataset.tokenKey || card.dataset.assetKey

    // Wave B-5e-fix-3: nicer drag visual. Without setDragImage the browser
    // uses a snapshot of the whole card row under the cursor, which looks
    // like the user accidentally selected text in a webpage. Replacing it
    // with the 64x64 thumbnail centered on the cursor makes the action feel
    // like "I'm dragging a token" instead of "I'm dragging a UI element".
    // Falls back gracefully when the card has no loaded thumbnail (the
    // browser default kicks in).
    const thumbImg = card.querySelector(".bc-card-thumb img")
    if (thumbImg && thumbImg.complete && thumbImg.naturalWidth > 0) {
      event.dataTransfer.setDragImage(thumbImg, 32, 32)
    }

    // Cloud mode (not yet installed) — phantom marker for the dropCanvasData
    // hook, which then runs the cloud import and places the token at the
    // drop coordinates (Wave B-1d).
    if (!id) {
      if (docType === "Actor") {
        // Wave B-9-fix-49: multi-select token drag distributes the
        // dropped tokens around the drop point (handlePendingCanvasDrop
        // computes the offset positions). When only one token is in
        // the selection set, fall back to the single-key payload so
        // the existing path stays untouched.
        const isMulti = this.selectedKeys?.size > 1 && this.selectedKeys.has(tokenKey)
        const drag_data = isMulti
          ? {
              type: "Actor",
              beneosCloudPending: true,
              beneosTokenKeys: [...this.selectedKeys]
            }
          : {
              type: "Actor",
              beneosCloudPending: true,
              beneosTokenKey: tokenKey
            }
        event.dataTransfer.setData("text/plain", JSON.stringify(drag_data))
        return
      }
      if (docType === "Item") {
        // Wave B-9-fix-41: phantom-marker drag for cloud items / spells,
        // mirroring the token canvas pipeline (B-1d). The drag carries
        // a marker payload — when dropped on an actor sheet, the
        // dropActorSheetData hook in beneos_module.js detects it and
        // routes through cloud.handlePendingItemDrop → install →
        // drainPendingItemDrops adds the freshly-installed item to the
        // dropped-on actor. No preventDefault: drag must propagate to
        // the drop target so Foundry fires the hook.
        //
        // Wave B-9-fix-46: when the user has Ctrl+click-built a
        // multi-select and drags one of the selected cards, every key
        // in the set is forwarded as `beneosItemKeys` so a single drop
        // installs and adds all of them to the actor.
        const isMulti = this.selectedKeys?.size > 1 && this.selectedKeys.has(tokenKey)
        const drag_data = isMulti
          ? {
              type: "Item",
              beneosCloudPending: true,
              beneosItemKeys: [...this.selectedKeys],
              beneosAssetKind: this.searchMode
            }
          : {
              type: "Item",
              beneosCloudPending: true,
              beneosItemKey: tokenKey,
              beneosAssetKind: this.searchMode
            }
        event.dataTransfer.setData("text/plain", JSON.stringify(drag_data))
        return
      }
    }

    // Local mode (installed) — point the drag at the world actor (not the
    // compendium copy) so Foundry creates only a Token, no duplicate actor
    // (Wave B-1d local-drag fix).
    let drag_data = null
    if (docType === "Actor") {
      const worldActor = game.actors?.find(a => {
        const flag = a.getFlag?.("world", "beneos")
        return flag?.tokenKey === tokenKey
      })
      if (worldActor) {
        drag_data = { type: "Actor", uuid: worldActor.uuid }
      } else {
        const compendium = "world.beneos_module_actors"
        drag_data = { type: "Actor", pack: compendium, uuid: "Compendium." + compendium + "." + id }
      }
    } else if (docType === "Item") {
      // Wave B-9-fix-38: drag the world Item document, not a phantom
      // compendium reference. `id` here is the world doc id (resolved
      // via BeneosUtility.getItemId / getSpellId), so the canonical UUID
      // is "Item.<id>". Foundry's drop handlers on character sheets and
      // folders recognise this UUID and add the item directly.
      drag_data = { type: "Item", uuid: "Item." + id }
    }
    if (drag_data) event.dataTransfer.setData("text/plain", JSON.stringify(drag_data))
  }

  /* ========== Title-bar Patreon badge ========== */

  #updateTitleBadge(context) {
    const titleEl = this.element?.querySelector(".window-title")
    if (!titleEl) return
    if (context.isCloudLoggedIn) {
      const ok = context.patreonStatus === "active_patron"
      titleEl.classList.toggle("beneos-window-title-green", ok)
      titleEl.classList.toggle("beneos-window-title-orange", !ok)
    } else {
      titleEl.classList.remove("beneos-window-title-green", "beneos-window-title-orange")
    }
  }

  /* ========== Action handlers ========== */

  static _onSwitchTab(event, target) {
    event.preventDefault()
    const tab = target.dataset.bcTab
    if (!tab) return
    // Wave B-5c: Maps is now a real search tab. The Moulinette hand-off
    // happens at install time (per-map), not at tab-switch time.
    this.searchMode = tab
    this.selectedAssetKey = null    // close drawer when changing category
    // Wave B-5e-fix-4: tab switch -> back to first page.
    this.#resetPagination()
    // Wave B-8d-fix-4: a single requestAnimationFrame is not enough — the
    // sync render begins immediately within that frame's callback and the
    // browser never gets a chance to paint the spinner before the DOM
    // rebuild blocks the main thread. The double-rAF pattern guarantees
    // one full paint frame before the heavy work starts: first rAF lets
    // style recalc settle, second rAF runs after the browser has painted
    // (i.e. the spinner is now actually on screen).
    this.#showLoading()
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        try {
          await this.render({ parts: ["header", "sidebar", "results"] })
        } finally {
          this.#hideLoading()
        }
      })
    })
  }

  // Wave B-8d-fix-4: spinner overlay lives on the window root so it
  // survives the part-render DOM rebuild. Adds .bc-loading; CSS handles
  // the visual via root-level ::before / ::after pseudo-elements.
  #showLoading() { this.element?.classList?.add("bc-loading") }
  #hideLoading() { this.element?.classList?.remove("bc-loading") }

  // Wave B-8d-fix-5: sidebar scroll preservation across re-render. When
  // the user adds a biome chip or toggles a source checkbox we re-render
  // ["sidebar", "results"] which rebuilds the sidebar DOM and resets
  // its scrollTop. Same pattern fix as the result-list scroll loader
  // (Wave B-5e-fix-4). Capture before, restore after — Foundry's part
  // render returns a Promise so we await it cleanly.
  //
  // Wave B-8k-fix-1: also wrap with the showLoading + double-rAF +
  // hideLoading pattern. Bmap biome chip removal triggers a noticeable
  // UI freeze because the dataset's image teardown is heavy; the
  // spinner gives the user a "working on it" cue. Fast renders never
  // see the spinner thanks to the rAF chain.
  async #renderPreservingSidebarScroll(parts) {
    const oldSidebar = this.element?.querySelector(".bc-sidebar")
    const scrollTop = oldSidebar?.scrollTop || 0
    this.#showLoading()
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          try {
            await this.render({ parts })
            const newSidebar = this.element?.querySelector(".bc-sidebar")
            if (newSidebar) newSidebar.scrollTop = scrollTop
          } finally {
            this.#hideLoading()
            resolve()
          }
        })
      })
    })
  }

  // Wave B-9-fix-1: bmap renders are noticeably heavier than tokens or
  // items because of the larger thumbnails and bigger candidate set.
  // Wrap every results-touching render that fires from a user gesture
  // through this helper: in bmap mode it shows the spinner overlay
  // around a double-rAF, in any other mode it stays a plain render so
  // fast paths don't get a flicker frame.
  async #renderResults(parts) {
    if (this.searchMode === "bmap") {
      this.#showLoading()
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(async () => {
            try { await this.render({ parts }) }
            finally { this.#hideLoading(); resolve() }
          })
        })
      })
    }
    return this.render({ parts })
  }

  /**
   * Wave B-5c → Wave B-7: Battlemap install hand-off to Moulinette. Until
   * the cloud battlemap pipeline is live (Wave B-8 server side), clicking
   * the Moulinette button on a bmap card opens Moulinette's search UI
   * pre-filtered by the bmap's download_pack / download_creator /
   * download_terms — same call the v1 search engine uses
   * (`beneos_search_engine.js:1158`). The user lands on the matching map
   * directly instead of having to find it in Moulinette by hand.
   */
  static _onMoulinetteInstall(_event, bmapKey) {
    const dbHolder = game.beneos?.databaseHolder
    const bmapData = dbHolder?.getAll?.("bmap")?.[bmapKey]
    const props = bmapData?.properties || {}
    const mou = game.modules?.get?.("moulinette")
    if (!mou?.api?.searchUI) {
      ui.notifications.warn(game.i18n.localize("BENEOS.Cloud.Notification.MoulinetteUnavailable"))
      return
    }
    if (!props.download_terms && !props.download_pack && !props.download_creator) {
      ui.notifications.info(game.i18n.localize("BENEOS.Cloud.Notification.MoulinetteNoTerms"))
      return
    }
    try {
      mou.api.searchUI("mou-cloud", "Map", {
        terms:   props.download_terms   || "",
        creator: props.download_creator || "",
        pack:    props.download_pack    || ""
      })
    } catch (err) {
      console.warn("BeneosModule: Moulinette searchUI failed", err)
      ui.notifications.warn(game.i18n.localize("BENEOS.Cloud.Notification.MoulinetteUnavailable"))
      return
    }
    const mapName = bmapData?.name || bmapKey
    ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.MoulinetteSearch", { name: mapName }))
  }

  static _onOpenLogin(_event, _target) {
    const login = new BeneosCloudLogin("searchEngineV2")
    login.render()
  }

  static _onOpenCloudSettings(_event, _target) {
    BeneosUtility.openPostInNewTab?.("https://beneos.cloud/", {})
  }

  // Wave B-9-fix-36: opens an external URL in a new browser tab. URL
  // comes from data-href on the trigger so the same handler covers
  // Discord / Webshop / Patreon (and is tab-aware via the context-
  // injected patreonUrl that the template binds to the Patreon button).
  static _onOpenExternal(_event, target) {
    const url = target?.dataset?.href
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }

  static _onResetFilters(event, _target) {
    event.preventDefault()
    this.#cleanFilters()
    // Wave B-5e-fix-4: reset filters -> back to first page.
    this.#resetPagination()
    this.#renderResults(["sidebar", "results"])
  }

  // Wave B-9: list / grid view switch. Updates instance state, persists
  // to the client setting so it survives reload, then re-renders just
  // the results part — sidebar / header / footer don't change with the
  // view mode so no need to rebuild them.
  static _onSwitchView(event, target) {
    event.preventDefault()
    const view = target.dataset.view
    if (!view || (view !== "list" && view !== "grid")) return
    if (this.viewMode === view) return
    this.viewMode = view
    try {
      game.settings?.set?.(BeneosUtility.moduleID(), "beneos-cloud-view-mode", view)
    } catch (e) {}
    this.#renderResults(["results"])
  }

  /* ========== Cleanup ========== */

  async _onClose(options) {
    if (game.beneos?.cloudWindowV2 === this) game.beneos.cloudWindowV2 = undefined
    if (game.beneos?.searchEngine === this) game.beneos.searchEngine = undefined
    if (game.beneosTokens?.searchEngine === this) game.beneosTokens.searchEngine = undefined
    return super._onClose?.(options)
  }
}
