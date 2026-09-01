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
import { BeneosAnalytics } from "../beneos_analytics.js"
import { BeneosCloudLogin } from "../beneos_cloud.js"
import { BeneosStartSetupTour } from "../beneos_tours.js"
import { BeneosLootGenerator } from "./loot-generator.mjs"
import { BeneosMagicShopGenerator } from "./magic-shop-generator.mjs"
import { HomeController } from "./home/home-controller.mjs"
import { BeneosPatchlogWindow } from "./home/patchlog-window.mjs"
import { fetchNewsFeed, markNewsRead } from "./services/news-api.mjs"
import { BeneosInstallState, BeneosPreInstallDialog, beneosLogModuleInstall } from "./beneos-install-state.mjs"
import { getPoiIndex, peekPoiIndex, releaseInfo } from "./beneos-poi-index.mjs"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

// M8.3.40: Beneos descriptions use a proprietary `__phrase__` marker to
// highlight key terms (spell/feature names). Render it as a bold accent and
// strip the markers; multi-word phrases get each word capitalised
// ("__Speak with dead__" -> "Speak With Dead"). The same pass also surfaces
// dice mechanics so they stand out without becoming clickable: Foundry inline
// rolls (`[[/roll 2d6]]`, `[[/r 1d8+3]]`, `[[2d6]]`) are unwrapped to their
// bare formula and standalone dice notation (`2d6`, `1D8`, `3d10+5`) is wrapped
// in a roll chip. `escape` HTML-escapes the source first (use for plaintext
// sources like the installed item's description); pass false when the string
// is already trusted HTML.
function beneosFormatMarkup(str, { escape = false } = {}) {
  if (str == null) return str
  let out = String(str)
  if (escape) out = out.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
  // 1. Pull inline-roll expressions out first so the dice pass below cannot
  //    double-wrap the formula inside them. Strip a leading slash-command
  //    (/roll, /r, /damage, /save, ...) and any "# flavour" comment, keeping
  //    just the formula for display.
  const rolls = []
  out = out.replace(/\[\[\s*(?:\/[a-zA-Z]+\s+)?([^\]]+?)\s*\]\]/g, (_m, inner) => {
    const formula = String(inner).split("#")[0].trim()
    rolls.push(formula)
    return `\u0000R${rolls.length - 1}\u0000`
  })
  // 2. __phrase__ -> bold accent (multi-word title-cased).
  out = out.replace(/__(.+?)__/g, (_m, inner) => {
    const titled = String(inner).trim().split(/\s+/)
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ")
    return `<strong class="bc-md-em">${titled}</strong>`
  })
  // 3. Standalone dice notation (NdM with an optional flat modifier).
  out = out.replace(/\b(\d+[dD]\d+(?:[+-]\d+)?)\b/g,
    (m) => `<span class="bc-md-roll">${m}</span>`)
  // 4. Restore the inline-roll formulas as roll chips.
  out = out.replace(/\u0000R(\d+)\u0000/g,
    (_m, i) => `<span class="bc-md-roll">${rolls[Number(i)] ?? ""}</span>`)
  return out
}

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
  { types: ["token", "item", "spell"], selector: "installation-selector",  prop: "installed"     },
  { types: ["token"], selector: "token-fight-style",      prop: "fightingstyle" },
  { types: ["token"], selector: "token-purpose",          prop: "purpose"       },
  // Battlemaps
  // Wave B-8k-2: bmap-bioms-selector dropped — biome is now a chip-
  // dropdown shared with the token mode, filtered via #applyBiomeFilter.
  { types: ["bmap"],  selector: "bmap-brightness",        prop: "brightness"    },
  { types: ["bmap"],  selector: "bmap-adventure",         prop: "adventure"     },
  { types: ["bmap"],  selector: "bmap-grid",              prop: "grid"          },
  { types: ["bmap"],  selector: "kind-selector",          prop: "type"          },
  // Items
  { types: ["item"],  selector: "item-type",              prop: "item_type"     },
  // Rarity matches exactly (strict): the values "common"/"rare" are substrings of
  // "uncommon"/"very rare", so a substring match would over-select.
  { types: ["item"],  selector: "rarity-selector",        prop: "rarity", strict: true },
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
    classes: ["beneos-cloud-app", "beneos_module", "beneos_search_engine"],
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
      openSettings:            BeneosCloudWindowV2._onOpenSettings,
      retryCatalog:            BeneosCloudWindowV2._onRetryCatalog,
      openCodex:               BeneosCloudWindowV2._onOpenCodex,
      openLgc:                 BeneosCloudWindowV2._onOpenLgc,
      resetFilters:            BeneosCloudWindowV2._onResetFilters,
      clearShowFilter:         BeneosCloudWindowV2._onClearShowFilter,
      beneosResyncCatalog:     BeneosCloudWindowV2._onResyncCatalog,
      beneosCancelBulkInstall: BeneosCloudWindowV2._onCancelBulkInstall,
      switchView:              BeneosCloudWindowV2._onSwitchView,
      switchBmapRes:           BeneosCloudWindowV2._onSwitchBmapRes,
      switchBmapView:          BeneosCloudWindowV2._onSwitchBmapView,
      uninstallRelease:        BeneosCloudWindowV2._onCloudReleaseUninstall,
      installBundle:           BeneosCloudWindowV2._onCloudBundleInstall,
      installBundleMember:     BeneosCloudWindowV2._onCloudBundleMemberInstall,
      retryLoadReleases:       BeneosCloudWindowV2._onRetryLoadReleases,
      openExternal:            BeneosCloudWindowV2._onOpenExternal,
      openPatchlog:            BeneosCloudWindowV2._onOpenPatchlog,
      openNewsDetail:          BeneosCloudWindowV2._onOpenNewsDetail,
      openNewsCta:             BeneosCloudWindowV2._onOpenNewsCta,
      switchToCategory:        BeneosCloudWindowV2._onSwitchToCategory,
      openRailEntity:          BeneosCloudWindowV2._onOpenRailEntity
    }
  }

  static PARTS = {
    header:  { template: "modules/beneos-module/templates/cloud-v2/parts/header-tabs.hbs" },
    home:    { template: "modules/beneos-module/templates/cloud-v2/parts/home-feed.hbs" },
    sidebar: { template: "modules/beneos-module/templates/cloud-v2/parts/sidebar-form.hbs" },
    results: { template: "modules/beneos-module/templates/cloud-v2/parts/results-pane.hbs" },
    footer:  { template: "modules/beneos-module/templates/cloud-v2/parts/status-footer.hbs" }
  }

  get title() {
    return game.i18n.localize("BENEOS.Cloud.WindowTitle") || "Beneos Cloud"
  }

  // Total number of curated easter-egg quotes shipped in lang/en.json under
  // BENEOS.Cloud.Quotes.NNN. Translators may localize subsets — missing keys
  // gracefully fall through to English via Foundry's i18n fallback.
  static QUOTE_COUNT = 94

  // How often the title-bar quote rotates while the window is open.
  static QUOTE_CYCLE_MS = 20000

  // Pick a fresh random quote different from the last one shown. Returns null
  // if nothing localizes (no en.json keys → no easter egg, no error).
  #pickRandomQuote() {
    for (let attempt = 0; attempt < 6; attempt++) {
      const idx = Math.floor(Math.random() * BeneosCloudWindowV2.QUOTE_COUNT) + 1
      const key = `BENEOS.Cloud.Quotes.${String(idx).padStart(3, "0")}`
      const text = game.i18n.localize(key)
      if (text && text !== key && text !== this._lastQuoteText) {
        this._lastQuoteText = text
        return text
      }
    }
    return null
  }

  // Insert the quote into the window header next to the title text and start
  // the rotation. Foundry's ApplicationV2 renders <h1 class="window-title">
  // {this.title}</h1>; we append a wrapper span with overflow:hidden so the
  // inner text can animate vertically without disturbing the header layout.
  #injectTitleQuote() {
    const titleEl = this.element?.querySelector(".window-title")
    if (!titleEl) return
    if (titleEl.querySelector(".bc-window-quote")) return
    const first = this.#pickRandomQuote()
    if (!first) return
    const wrap = document.createElement("span")
    wrap.className = "bc-window-quote"
    const inner = document.createElement("span")
    inner.className = "bc-window-quote-text"
    inner.textContent = first
    wrap.appendChild(inner)
    titleEl.appendChild(wrap)
    this.#startQuoteCycle()
  }

  #startQuoteCycle() {
    if (this._quoteCycleHandle) clearInterval(this._quoteCycleHandle)
    this._quoteCycleHandle = setInterval(() => this.#cycleQuote(), BeneosCloudWindowV2.QUOTE_CYCLE_MS)
  }

  #stopQuoteCycle() {
    if (this._quoteCycleHandle) {
      clearInterval(this._quoteCycleHandle)
      this._quoteCycleHandle = null
    }
  }

  // Slide the current quote down out of the title-bar viewport, swap to the
  // next quote (positioned just above the viewport), and slide it down into
  // place. Reads as a slot-machine reel scrolling top→bottom.
  #cycleQuote() {
    const inner = this.element?.querySelector(".bc-window-quote .bc-window-quote-text")
    if (!inner) {
      this.#stopQuoteCycle()
      return
    }
    const next = this.#pickRandomQuote()
    if (!next) return
    inner.classList.add("is-leaving")
    setTimeout(() => {
      inner.textContent = next
      inner.classList.remove("is-leaving")
      inner.classList.add("is-entering")
      // Force layout flush so the transition runs from the entering-state
      // back to the default state in the next paint frame.
      void inner.offsetWidth
      inner.classList.remove("is-entering")
    }, 950)
  }

  /** @inheritdoc */
  constructor(options = {}) {
    super(options)
    const HOME_TAB_ENABLED = true
    const lastMode = game.beneosTokens?.lastFilterStack?.mode
    const safeMode = (!HOME_TAB_ENABLED && lastMode === "home") ? null : lastMode
    this.searchMode = safeMode || (HOME_TAB_ENABLED ? "home" : "token")
    this._newsCache = []
    this.selectedAssetKey = null     // currently open in detail drawer (null = closed)
    // Wave B-9-fix-46: multi-select set for Ctrl+click. Holds asset
    // keys highlighted in the result list. The drawer always shows the
    // last-clicked card (selectedAssetKey); the install button + drag
    // operate on every key in this set when size > 1. Plain click
    // resets the set to a single entry; Ctrl/Cmd+click toggles.
    this.selectedKeys = new Set()
    this._textFilter = ""

    // Plan §13 release index. Lazy-loaded the first time the bmap tab
    // renders. Map<release_dir, releaseObject> for O(1) lookup; the array
    // form lives next to it for ordered rendering. Cleared on cache refresh.
    this._releaseIndex     = null  // Map<release_dir, release>
    this._releaseList      = null  // Array<release>, sorted by release_num desc
    this._releaseLoading   = false
    this._releaseLoadError = null


    // Wave B-5d: per-asset install state for the 4-state install button.
    // Map<assetKey, "progress" | "done">. Idle is the absence of an entry.
    // - "progress" set by the install-click handler before the cloud roundtrip.
    // - "done" set by processSelectorSearch (called from softRefresh after a
    //   successful install), then cleared after a short flash.
    this.installState = new Map()

    // Cache for lazily-loaded compendium descriptions used by the drawer's
    // "Full Description" block. Keyed by `${assetType}:${beneosKey}`.
    // Values: plaintext string when found, null when not (no doc / empty
    // body / non-dnd5e). Populated by #ensureLocalFullDescriptionLoaded at
    // card-click time so the synchronous #enrichCard step can read it.
    // Lifetime: window-scoped — cleared on close via the ApplicationV2
    // default lifecycle.
    this.localFullDescriptionCache = new Map()

    // Show-filter persists across tab switches so the user's "Only Installed"
    // selection on the Loot tab carries over to Spells (etc.) without
    // desyncing from the dropdown UI. Other filters stay DOM-state because
    // they're tab-specific; only this one is cross-tab (see V2_FILTER_DEFS:
    // installation-selector covers token + item + spell).
    this.showFilter = "any"

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
    // The partly-installed marker needs the POI index, which is where each
    // release's scene count lives. Warm it once here and read it synchronously
    // from then on: the card build has no await to spare, and a badge that
    // appears only on the second open of the window is worse than no badge.
    // Only on the tab that shows it. A failure here is not an error: an index we
    // cannot read simply means every install keeps reading as complete.
    if (this.searchMode === "bmap") {
      try { await getPoiIndex() } catch (_e) { /* badge degrades to "complete" */ }
    }
    // Wave B-9-fix-36: surface the module version + tab-aware Patreon
    // URL to the footer template. Maps belongs to the BeneosBattlemaps
    // Patreon, everything else (creatures / loot / spells) to the
    // BeneosTokens Patreon. Hard-coded URLs match the user's spec.
    const moduleId = BeneosUtility?.moduleID?.() || "beneos-module"
    const moduleVersion = game.modules?.get?.(moduleId)?.version || ""
    const patreonUrl = this.searchMode === "bmap"
      ? "https://www.patreon.com/c/BeneosBattlemaps"
      : "https://www.patreon.com/c/BeneosTokens"
    // Patron-aware UI: which campaign this tab belongs to + whether
    // the active user has access. Tokens / items / spells share one
    // campaign ("tokens"), maps the other ("battlemaps"). The Locked-
    // CTA and Free-Section rendering both pivot on these flags.
    const currentTabCampaign = this.searchMode === "bmap" ? "battlemaps" : "tokens"
    const isTokenPatron     = !!cloud?.hasCampaignAccess?.("tokens")
    const isBattlemapPatron = !!cloud?.hasCampaignAccess?.("battlemaps")
    const isCurrentTabPatron = currentTabCampaign === "battlemaps"
      ? isBattlemapPatron
      : isTokenPatron
    return {
      ...dbData,
      searchMode: this.searchMode,
      isHome:    this.searchMode === "home",
      isCloudLoggedIn: cloud?.isLoggedIn() ?? false,
      patreonStatus:   cloud?.getPatreonStatus() ?? "",
      isOffline:       dbHolder?.getIsOffline?.() ?? false,
      // Stage 9: cloud-server reachability (separate from the asset-DB
      // offline state above). Top-priority chip in the footer template.
      isServerOffline: cloud?.serverOffline === true,
      moduleVersion,
      patreonUrl,
      joinPatreonUrl: patreonUrl,
      currentTabCampaign,
      isTokenPatron,
      isBattlemapPatron,
      isCurrentTabPatron,
      discordUrl: "https://discord.gg/R2yBH557Wk",
      webshopUrl: "https://beneos-battlemaps.com/",
      isGm: game.user?.isGM === true,
      lgcHasPings: (() => {
        try {
          const v = game.settings.get("beneos-module", "beneos-lgc-active-pings")
          return Array.isArray(v) && v.length > 0
        } catch (_) { return false }
      })(),
    }
  }

  /**
   * Per-part context — the results part needs the enriched card list and
   * drawer state. Other parts inherit the root context as-is.
   */
  async _preparePartContext(partId, context) {
    // Home tab: news feed + Recent rails + Hero rotation. Heavy work
    // (network fetch, db iteration) lives in HomeController so this
    // method stays focused on routing.
    if (partId === "home") {
      const isHome = this.searchMode === "home"
      if (!isHome) {
        return { ...context, isHome: false }
      }
      const home = await HomeController.prepare()
      // Stash raw news payload so openNewsDetail can resolve by id
      // without re-fetching (HomeController.prepare reuses the 5min
      // news-api cache anyway, but the lookup is cleaner this way).
      try {
        const { news } = await fetchNewsFeed()
        this._newsCache = news
      } catch (_e) {
        this._newsCache = []
      }
      return { ...context, isHome: true, home }
    }
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
      // Wave B-8i-3: item gold range slider, same dual-thumb pattern as CR.
      // The upper bound is computed from the dataset so it matches whatever is
      // actually available; min stays at 0.
      const goldMaxAvailable = this.#getMaxItemPrice()
      const effectiveGoldMax = this.goldMax ?? goldMaxAvailable
      const goldRangeLabel = `${this.#formatGold(this.goldMin)} - ${this.#formatGold(effectiveGoldMax)}`
      // The two inputs carry positions on the log track, not gold amounts.
      const goldMinPos = this.#goldValueToPos(this.goldMin, goldMaxAvailable)
      const goldMaxPos = this.#goldValueToPos(effectiveGoldMax, goldMaxAvailable)
      // Top-Down Stage 2: surface the persisted default install style
      // so the token-tab can render its radio in the correct state.
      let installStyle = "tokenized"
      try { installStyle = game.settings.get(BeneosUtility.moduleID(), "beneos-default-install-style") || "tokenized" }
      catch (e) { /* setting not yet registered (early init) */ }
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
      // Show-filter "Only new" / "Only updated" only render when the
      // dataset actually has anything flagged. For bmap, NEW is derived
      // from the highest release-number prefix in #buildCards (there is
      // always one), so the option is always available; UPDATED stays
      // out — battlemaps have no per-asset update channel.
      let hasNewAssets = false
      let hasUpdatedAssets = false
      let hasNewForUserAssets = false
      if (this.searchMode === "bmap") {
        hasNewAssets = true
        // A5: surface the "Only updated" option when at least one installed
        // release has a newer cloud version available.
        hasUpdatedAssets = this.#bmapHasUpdatedReleases()
      } else if (this.searchMode === "token" || this.searchMode === "item" || this.searchMode === "spell") {
        const dbHolder = game.beneos?.databaseHolder
        const all = dbHolder?.getAll?.(this.searchMode) || {}
        for (const data of Object.values(all)) {
          if (data?.isNew) hasNewAssets = true
          if (data?.isUpdate) hasUpdatedAssets = true
          if (data?.isNewForUser) hasNewForUserAssets = true
          if (hasNewAssets && hasUpdatedAssets && hasNewForUserAssets) break
        }
      }
      // Wave B-8k-4: capitalise every dropdown label and lift "Any" to
      // the top across all filter lists (token + bmap + item + spell).
      // Rarity already has its custom order so it skips this step.
      // Pass the field_map key per dropdown so labels localize via the
      // beneos_i18n matrix (active locale -> en -> capitalize fallback).
      // Non-matrix facets (faction, campaign, grid, tier, level) omit it.
      const orderList = (l, field) => this.#orderDropdownList(l, field)
      return {
        ...context,
        // Token-side
        tokenFactions:  orderList(context.tokenFactions),
        tokenTypes:     orderList(context.tokenTypes, "token.type"),
        fightingStyles: orderList(context.fightingStyles, "token.fightingstyle"),
        purposeList:    orderList(context.purposeList, "token.purpose"),
        tokenCampaigns: orderList(context.tokenCampaigns),
        // Bmap-side
        bmapBrightness: orderList(context.bmapBrightness, "battlemap.brightness"),
        adventureList:  orderList(context.adventureList, "battlemap.adventure"),
        gridList:       orderList(context.gridList),
        // Task 4: in Bundles view only the Campaign filter is offered (bundles
        // are module-specific); the template hides the other bmap filters.
        bmapViewIsBundles: this.searchMode === "bmap" && this._bmapActiveView() === "bundles",
        // A3: the Show dropdown is offered in the release view (where filtering
        // by New/Updated/installed at release granularity makes sense).
        bmapViewIsReleases: this.searchMode === "bmap" && this._bmapActiveView() === "releases",
        // Item-side
        // Wave B-8k-5: collapse "Light Armor +1/+2/…" into "Light Armor"
        // before sorting so the dropdown isn't cluttered with modded
        // variants. searchByProperty's substring match handles the
        // wide-net filter on the data side.
        itemType:       orderList(this.#dedupeItemTypes(context.itemType), "item.item_type"),
        origin:         orderList(context.origin, "item.origin"),
        tier:           orderList(context.tier),
        // Spell-side
        level:          orderList(context.level),
        school:         orderList(context.school, "spell.school"),
        spellClass:     orderList(context.spellClass, "spell.classes"),
        // Wave B-8e-fix-3: castingTime + spellType lists are already
        // built by BeneosDatabaseHolder.getData() (verified in
        // beneos_search_engine.js:848-849); just forward them here.
        castingTime:    orderList(context.castingTime, "spell.casting_time"),
        spellType:      orderList(context.spellType, "spell.spell_type"),
        rarity: rarityOrdered,
        sourceCheckboxes,
        biomeChips,
        biomeAvailable,
        // Pre-computed flag for the template, since Foundry's Handlebars
        // doesn't ship a guaranteed `or` helper.
        biomeHasAny: biomeChips.length > 0 || biomeAvailable.length > 0,
        hasNewAssets,
        hasUpdatedAssets,
        hasNewForUserAssets,
        // V7: pre-computed flags for the Show-dropdown's `selected` attribute.
        // Foundry's Handlebars doesn't ship a guaranteed `eq` helper, so we
        // surface the comparison result as a boolean per option. This pre-
        // selects the active value when the sidebar re-renders on tab switch.
        showFilterIsAny:          this.showFilter === "any",
        showFilterIsInstalled:    this.showFilter === "installed",
        showFilterIsNotInstalled: this.showFilter === "notinstalled",
        showFilterIsNew:          this.showFilter === "new",
        showFilterIsUpdated:      this.showFilter === "updated",
        crMinLabel, crMaxLabel, crRangeLabel,
        crMinIndex: crMinIndex >= 0 ? crMinIndex : 0,
        crMaxIndex: crMaxIndex >= 0 ? crMaxIndex : crStepsMax,
        crStepsMax,
        goldMaxAvailable,
        goldMin: this.goldMin,
        goldMax: effectiveGoldMax,
        goldMinPos,
        goldMaxPos,
        goldSliderSteps: BeneosCloudWindowV2.GOLD_SLIDER_STEPS,
        goldRangeLabel,
        installStyle
      }
    }
    if (partId === "results") {
      const { cards, totalMatches, hasMore, groupBulkKeys } = this.#buildCards()
      // Held for the search telemetry below. Without it we can count what was
      // searched for but never whether anything came back, which is exactly the
      // question the hit rate needs. Case C5 of the analysis catalogue was
      // blocked on this and on nothing else.
      this._lastMatchCount = Number(totalMatches) || 0
      this._lastCardCount = cards?.length || 0
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
      // #4: lazy per-release scene list + "what's included" checklist for the
      // release-card drawer. Scenes are fetched on first open and cached; the
      // fetch re-renders the drawer when it resolves.
      // Punkt 4: the same scene list also powers the Individual-Maps scene
      // drawer ("This Release also contains …"), keyed off the scene's
      // release_dir instead of its own key.
      let drawerScenes = null
      let drawerScenesLoading = false
      let drawerChecklist = null
      let drawerReleaseDir = null
      let drawerReleaseName = null
      if (drawerAsset && drawerAsset.isReleaseCard) {
        drawerChecklist = this.#buildReleaseChecklist(drawerAsset.releaseStats)
        drawerReleaseDir = drawerAsset.key
      } else if (drawerAsset && drawerAsset.isBmap && drawerAsset.releaseDir) {
        // Individual map scene: surface its parent release + sibling scenes.
        drawerReleaseDir  = drawerAsset.releaseDir
        drawerReleaseName = drawerAsset.releaseDisplayName || drawerAsset.releaseDir
      }
      // Remember which release the open drawer depends on so the async
      // scene-load callback knows whether to re-render (Punkt 5 scroll-safe).
      this._drawerReleaseDir = drawerReleaseDir
      if (drawerReleaseDir) {
        if (this._releaseScenesCache?.has?.(drawerReleaseDir)) {
          drawerScenes = this._releaseScenesCache.get(drawerReleaseDir)
        } else {
          drawerScenesLoading = true
          this.#ensureReleaseScenesLoaded(drawerReleaseDir, drawerAsset)
        }
      }
      // Wave B-5e-fix-2/4: pre-formatted hint so the template can stay simple
      // (Foundry's {{localize}} helper takes no inline params). When more
      // results are pending, the hint says "scroll for more"; when the user
      // has loaded everything, only the plain count shows.
      // Punkt 6: the count noun depends on what the active view actually
      // lists, so "Showing 100 of N" reads truthfully. Releases view counts
      // releases, Individual Maps counts maps, Bundles counts bundles, every
      // other tab keeps the generic "results".
      const _activeBmapView = this.searchMode === "bmap" ? this._bmapActiveView() : null
      const countNoun =
          _activeBmapView === "releases"   ? game.i18n.localize("BENEOS.Cloud.Results.NounReleases")
        : _activeBmapView === "individual" ? game.i18n.localize("BENEOS.Cloud.Results.NounMaps")
        : _activeBmapView === "bundles"    ? game.i18n.localize("BENEOS.Cloud.Results.NounBundles")
        : game.i18n.localize("BENEOS.Cloud.Results.Count")
      const partialHint = hasMore
        ? game.i18n.format("BENEOS.Cloud.Results.PartialNoun", {
            loaded: cards.length,
            total: totalMatches,
            noun: countNoun
          })
        : null
      // Track whether more pages exist so the scroll loader knows when to
      // stop firing.
      this._hasMoreResults = hasMore
      // Show-filter chip: when the global Show filter is anything other than
      // "Any", surface a compact "Show <option>" chip in the results header
      // so the user sees at a glance why the list looks smaller after a tab
      // switch. Label composes "<Show> <option>" via two i18n strings.
      const showOptionKey = {
        installed:    "BENEOS.Cloud.Filter.InstallInstalled",
        notinstalled: "BENEOS.Cloud.Filter.InstallNotInstalled",
        new:          "BENEOS.Cloud.Filter.InstallOnlyNew",
        updated:      "BENEOS.Cloud.Filter.InstallOnlyUpdated",
      }[this.showFilter]
      const showFilterActive = !!showOptionKey
      const showFilterLabel = showFilterActive
        ? `${game.i18n.localize("BENEOS.Cloud.Filter.Show")} ${game.i18n.localize(showOptionKey)}`
        : ""
      return {
        ...context,
        cards,
        totalMatches,
        hasMore,
        partialHint,
        countNoun,
        // Punkt 2: the bmap view tabs must stay reachable even when a view is
        // empty or still loading, so render the meta bar whenever we're on the
        // bmap tab OR there are cards. Without this the toolbar lived inside
        // the cards-length gate and vanished in an empty Bundles view, trapping
        // the user.
        showResultsMeta: (this.searchMode === "bmap") || cards.length > 0,
        showFilterActive,
        showFilterLabel,
        bulkOptions,
        hasBulkOptions,
        // Wave B-9: surface viewMode so the result list can apply the
        // .bc-view-grid modifier when the user picked grid mode.
        viewMode: this.viewMode,
        viewIsGrid: this.viewMode === "grid",
        // Plan §13: surface battlemap-specific toolbar state so the template
        // can render the resolution + Releases/Individual-Maps controls
        // above the existing Grid/List toggle, only when the active tab is
        // bmap. Resolution persists; view mode is session-only.
        isBmap: this.searchMode === "bmap",
        bmapRes4K: this._bmapActiveResolution() === "4K",
        bmapViewIsReleases: this._bmapActiveView() === "releases",
        bmapViewIsIndividual: this._bmapActiveView() === "individual",
        bmapViewIsBundles: this._bmapActiveView() === "bundles",
        bmapReleasesLoading: !!this._releaseLoading && this._releaseList === null,
        bmapReleasesError:   (!this._releaseLoading && this._releaseLoadError) ? String(this._releaseLoadError) : null,
        bmapReleasesNeedsLogin: this.searchMode === "bmap" && !!this._releaseNeedsLogin,
        drawer: {
          open: !!drawerAsset,
          asset: drawerAsset || null,
          // #4: release-drawer scene list + what's-included checklist.
          scenes: drawerScenes,
          scenesLoading: drawerScenesLoading,
          checklist: drawerChecklist,
          // Punkt 4: parent-release context for the Individual-Maps scene
          // drawer. isSceneDetail distinguishes "scene in a release" from the
          // release card itself so the template can show the right headings.
          releaseName: drawerReleaseName,
          isSceneDetail: !!(drawerAsset && drawerAsset.isBmap && !drawerAsset.isReleaseCard && drawerAsset.releaseDir),
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
  // is already in memory and thumbnails lazy-load via the shared observer
  // (#wireLazyImages).
  static RESULTS_PAGE = 100

  // Distance in px from the bottom of the result list at which the next page
  // starts loading.
  static SCROLL_LOAD_THRESHOLD = 200

  // ----- Virtualization (list mode) -----
  // Kill-switch: set false to fall back to rendering every card in the DOM.
  static VIRTUALIZE = true
  // Only window once the list is large enough to be worth it.
  static VIRTUALIZE_MIN_ROWS = 60
  // Extra px above and below the viewport kept rendered, so fast scrolling
  // never flashes blanks and the lazy observer still preloads.
  static VIRTUALIZE_OVERSCAN_PX = 800

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
  // Positions on the gold slider. The track is logarithmic (see
  // #goldPosToValue), so this is a resolution, not a range: 200 positions over
  // four orders of magnitude put roughly six percent between neighbours, fine
  // enough that dragging feels continuous and coarse enough that the rounded
  // numbers never repeat.
  static GOLD_SLIDER_STEPS = 200
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

  // Normalize raw asset data to a SOURCE_DEFS key string. User-Direktive:
  // SRD content for ALL three asset types (creatures / loot / spells) is
  // identified by `srd` in the key — creatures use `000-srd_<name>` (dash),
  // items + spells use `0000_srd_<name>` (underscore). The flexible regex
  // matches both. Anything starting with `0000_` (without `srd`) is the
  // Webshop bucket (release-zero Beneos content); everything else is a
  // Patreon "Beneos Original". Tokens fall back to properties.source when
  // the key doesn't carry the marker (some legacy creature keys).
  static SRD_KEY_RE = /(?:^|[-_])srd[-_]/i

  static #getNormalizedSource(data, assetType, key) {
    if (assetType === "bmap") {
      return data?.properties?.source || null
    }
    const k = typeof key === "string" ? key : ""
    const isKeySrd     = BeneosCloudWindowV2.SRD_KEY_RE.test(k)
    const isKeyWebshop = !isKeySrd && k.startsWith("0000_")

    if (assetType === "token") {
      // Prefer the explicit source field when present (covers Loyalty Tokens
      // and Webshop-only creatures whose keys don't carry the bucket).
      const explicit = data?.properties?.source
      if (explicit) return explicit
      if (isKeySrd) return "SRD"
      if (isKeyWebshop) return "Webshop"
      return "Patreon"
    }
    if (assetType === "item") {
      const o = String(data?.properties?.origin || "").toLowerCase()
      if (o === "srd" || isKeySrd) return "SRD"
      if (isKeyWebshop) return "Webshop"
      if (o) return "Patreon"
      return null
    }
    if (assetType === "spell") {
      if (isKeySrd)     return "SRD"
      if (isKeyWebshop) return "Webshop"
      return "Patreon"
    }
    return null
  }

  // Tier-3 self-heal trigger. Called from #buildCards when too many
  // cards land in the Out-of-Sync catch-all. Resets the delta cursor
  // and re-fetches a full catalog. Debounced (30s) so a server that
  // keeps returning a partial list can't trap us in a render-fetch loop.
  _triggerAutoHealCatalog(count) {
    const now = Date.now()
    if (this._lastAutoHealAt && (now - this._lastAutoHealAt) < 30000) return
    this._lastAutoHealAt = now
    console.warn(`[Beneos Cloud] ${count} out-of-sync cards detected → forcing full catalog re-sync`)
    setTimeout(async () => {
      try {
        await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-last-content-fetch-server-time", 0)
        await game.beneos.cloud.checkAvailableContent()
        try { this.render({ parts: ["results"] }) } catch (e) { /* render skipped */ }
      } catch (err) {
        console.warn("[Beneos Cloud] Auto-heal catalog re-sync failed", err)
      }
    }, 100)
  }

  #buildCards() {
    const dbHolder = game.beneos?.databaseHolder
    if (!dbHolder) return { cards: [], totalMatches: 0, hasMore: false }
    const type = this.searchMode
    const raw = dbHolder.getAll?.(type) || {}

    // Plan §15.1: when the bmap tab is active, fire-and-forget the lazy
    // release fetch (idempotent). First paint sees no release data yet
    // (loading=true); the fetch's finally re-renders with the populated
    // list. Releases mode reroutes the entire pipeline to release cards.
    if (type === "bmap") {
      const bmapView = this._bmapActiveView()
      // Self-heal: if we previously flagged "needs login" but a Foundry ID is
      // now present (the user logged in since), clear the flag so the next
      // fetch retries (it lazily (re)creates the manager) without a reload.
      if (this._releaseNeedsLogin) {
        let fid = ""
        try { fid = game.settings.get("beneos-module", "beneos-cloud-foundry-id") || "" } catch (_e) {}
        if (fid) this._releaseNeedsLogin = false
      }
      if (bmapView === "bundles") {
        this.#ensureBundlesLoaded()
        return this.#buildBundleCards()
      }
      this.#ensureReleasesLoaded()
      if (bmapView === "releases") {
        return this.#buildReleaseCards()
      }
    }

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

    // Published-gate: hide catalog entries not assigned to any tier yet (the
    // cloud allowlist via get_content), unless the user already owns/installed
    // them or they are free. Mirrors the storefront "Your Library" gate so
    // un-released drafts never surface in the search engine. bmap is gated by
    // its own campaign/free logic and is left untouched.
    if (type === "token" || type === "item" || type === "spell") {
      const cloud = game.beneos?.cloud
      if (cloud?.publishedSet) {
        entries = entries.filter(([k, data]) => {
          if (cloud.isFreeAsset?.(type, k) === true) return true
          if (data?.isInstalled || data?.isCloudAvailable) return true
          return cloud.isPublished(type, k)
        })
      }
    }

    // Battlemaps: a scene is "New" when its release was PUBLISHED within the
    // last NEW_WINDOW_DAYS days (release_date) AND the release is not installed,
    // mirroring the release-card rule in #buildReleaseCards. The old "highest
    // release-number cohort = NEW" logic ignored release_date and only ever set
    // isNew=true (never false), so a long-published or merely recently-UPDATED
    // release wrongly kept the NEW chip (a stale flag left on the cached
    // databaseHolder record). isNew is now ALWAYS assigned (true OR false), which
    // clears any stale/cohort/DB-baked true. Update is handled per card (installed
    // + newer updated_date), so an updated-but-not-installed release shows no chip.
    if (type === "bmap") {
      const NEW_WINDOW_DAYS = 30
      const now = Date.now()
      const installedByDir = new Map()
      const isInstalled = (relDir) => {
        if (!relDir) return false
        if (installedByDir.has(relDir)) return installedByDir.get(relDir)
        const v = (BeneosInstallState.findByReleaseDir(relDir)?.length || 0) > 0
        installedByDir.set(relDir, v); return v
      }
      for (const [, data] of entries) {
        const relDir = data?.properties?.release_dir || ""
        const rd = relDir ? (this.#releaseDateInfo(relDir)?.releaseDate || "") : ""
        let isNew = false
        if (rd && !isInstalled(relDir)) {
          const ageDays = (now - Date.parse(rd)) / 86400000
          isNew = Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= NEW_WINDOW_DAYS
        }
        data.isNew = isNew   // always set -> clears any stale true
      }
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
    // Source filter must also run for items and spells (the sidebar
    // checkboxes apply to all asset types now). Was previously gated to
    // tokens only — that's why unchecking SRD on the Loot/Spells tab did
    // nothing visible. CR + biome filters stay token-exclusive.
    if (type === "item" || type === "spell") {
      entries = this.#applySourceFilter(entries)
      afterSource = entries.length
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
      if (globalThis.BeneosUtility?.isDebug?.()) console.log(`[Beneos V2] filter pipeline (${type}):`,
        `raw=${initialCount} text=${afterText} dropdowns=${afterDropdowns}`,
        `cr=${afterCR} source=${afterSource} biome=${afterBiome}`,
        { crMin: this.crMin, crMax: this.crMax, sourceHidden: [...this.sourceHidden], biomeFilters: [...this.biomeFilters] })
    }

    const hasActiveFilter = this.#hasActiveFilter(type)
    const textActive = !!(this._textFilter && this._textFilter.trim())

    if (textActive) {
      // Free-text search: rank by relevance score from #scoreTextMatch,
      // alphabetic on ties. New/Update boost is suppressed so an exact
      // name match always wins over a NEW-flagged near-miss.
      entries.sort((a, b) => {
        const sa = a[1]?.__bcTextScore || 0
        const sb = b[1]?.__bcTextScore || 0
        if (sa !== sb) return sb - sa
        const na = (a[1]?.name || a[0]).toString()
        const nb = (b[1]?.name || b[0]).toString()
        return na.localeCompare(nb)
      })
    } else {
      // Patron-aware ranking. For non-patrons of the current tab's
      // campaign, Free assets float above New/Update/Regular and Locked
      // assets sink below — so the user sees what they can grab for
      // free first and the "Join Patreon to unlock" tier last. Patrons
      // keep the original three-tier order.
      const tabCampaign = type === "bmap" ? "battlemaps" : "tokens"
      const tabHasCampaign = !!game.beneos?.cloud?.hasCampaignAccess?.(tabCampaign)
      const groupRank = (data) => {
        if (!tabHasCampaign) {
          // Free status: token/item/spell from the cloud Free tier (data.free);
          // battlemaps from their own catalog free_content scene flag.
          const dFree = (type === "bmap")
            ? (data?.properties?.free_content === true)
            : (game.beneos?.cloud?.isFreeAsset?.(type, data?.key) === true)
          const dInstalled = type === "bmap" ? false : !!data?.isInstalled
          // Only NOT-installed free assets float to the top Free section. An
          // installed asset (even a free one) belongs in the "All Installed"
          // section, matching its groupKind (isFree && !isInstalled). Without the
          // !dInstalled guard the sort rank and groupKind disagreed, interleaving
          // installed-free and free cards and emitting a divider per card.
          if (dFree && !dInstalled) return -1
          const dAvail     = type === "bmap" ? true  : !!data?.isCloudAvailable
          if (!dAvail && !dInstalled) return 9999
        }
        if (data?.isNew) return 0
        if (!hasActiveFilter && data?.isUpdate) return 1
        return 2
      }
      // Pre-compute recency once per entry so the comparator stays O(1)
      // and the cloud-TS lookup doesn't fan out across O(n log n) calls.
      const recency = new Map()
      for (const [k, d] of entries) recency.set(k, this.#recencyOf(type, k, d))
      entries.sort((a, b) => {
        const ra = groupRank(a[1]); const rb = groupRank(b[1])
        if (ra !== rb) return ra - rb
        const recA = recency.get(a[0]) || 0
        const recB = recency.get(b[0]) || 0
        if (recA !== recB) return recB - recA
        const na = (a[1]?.name || a[0]).toString()
        const nb = (b[1]?.name || b[0]).toString()
        return na.localeCompare(nb)
      })
    }

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
    // When the GM has explicitly filtered to "Only New" or "Only Updated"
    // we WANT the matching group classification to survive — the user is
    // signalling "this is the slice I care about", and demoting update→
    // regular under that filter would (a) hide the group divider so the
    // header reads "ALL ASSETS" instead of "UPDATED", and (b) leave
    // groupBulkKeys.update empty so the bulk-install button can't surface.
    // V7: read from the persisted instance state instead of the DOM —
    // matches the same source #applyDropdownFilters uses, so the two
    // read points can never disagree mid tab-switch.
    const showFilterValue = this.showFilter || ""
    const keepUpdateGroup = showFilterValue === "updated"
    // Perf (Task D): #enrichCard does a sibling lookup that, unguarded, calls
    // databaseHolder.getAll("bmap") PER card. getAll deep-copies all ~1838
    // catalog entries (~13ms each), so 100 cards x 2 lookups was ~2.6s , the
    // entire scene-click lag. Reuse the single `raw` snapshot we already
    // fetched for the whole card loop; #bmapCatalog() reads it.
    this._bmapSnapshot = (type === "bmap") ? raw : null
    let enriched
    try {
      enriched = entries.map(([key, data]) => {
        const card = this.#enrichCard(type, key, data)
        if (hasActiveFilter && card.groupKind === "update" && !keepUpdateGroup) {
          card.groupKind = "regular"
        }
        return card
      })
    } finally {
      this._bmapSnapshot = null
    }
    // Wave B-8i-1 / B-8k-1: collect bulk-install candidate keys per group
    // plus the full "view" set (everything in the filtered view that's
    // either cloud-available-not-installed OR an installed-with-update)
    // plus the unfiltered "backlog" set (every installable in the entire
    // type, regardless of filter — used by the "Install entire backlog"
    // option below the menu divider). The kebab menu reads these to
    // decide which of the four options to render (only ones with > 0
    // keys show up).
    const groupBulkKeys = { new: [], update: [], view: [], backlog: [] }
    let outOfSyncCount = 0
    for (const card of enriched) {
      if (type !== "token" && type !== "item" && type !== "spell") continue
      if (card.isOutOfSync) outOfSyncCount++
      const isInstallableNow = (card.isCloudAvailable && !card.isInstalled)
      const isUpdatePending  = (card.isUpdate && card.isInstalled)
      if (card.groupKind === "new" && isInstallableNow) {
        groupBulkKeys.new.push(card.key)
      }
      // Update-Kandidaten unabhaengig vom groupKind sammeln: bei aktivem
      // Filter wird die "update"-Gruppe oben auf "regular" degradiert, und
      // damit verschwand der "Install all updates"-Eintrag aus dem Kebab-
      // Menue, obwohl Updates anstehen. Patron-gesperrte Updates bleiben
      // draussen.
      if (isUpdatePending && !card.updateLocked) {
        groupBulkKeys.update.push(card.key)
      }
      if (isInstallableNow || isUpdatePending) {
        groupBulkKeys.view.push(card.key)
      }
    }
    // Tier-3 self-heal: when too many cards land in the Out-of-Sync
    // catch-all the cloud catalog is almost certainly stale (delta
    // cursor stuck on a non-zero value). Reset the cursor and force a
    // full re-fetch in the background; the next render picks up the
    // fresh list. Debounced so it can't loop on a server that keeps
    // returning a partial response.
    if (outOfSyncCount > 5) this._triggerAutoHealCatalog(outOfSyncCount)
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
    // Y4-redo: the prominent "Install all N" bulk-action lives on the
    // group divider (right side of the heading row) — but ONLY when the
    // GM has explicitly filtered down to that group via the show-filter.
    // Mixing modes ("Any" filter shows New + Update + Regular sections,
    // each with its own bulk button) felt too eager — the user was seeing
    // a master button inviting "install all" without the filter context
    // making clear which slice it targets. Now the button only surfaces
    // when the filter and the group line up unambiguously.
    const out = []
    let lastGroup = null
    for (const card of enriched) {
      if (card.groupKind !== lastGroup) {
        card.divider = true
        card.dividerLabel = this.#groupHeading(card.groupKind)
        // The Free section gets an explanatory subline so non-patrons
        // understand they can install these without a paid membership.
        // Locked stays label-only — the per-card Join-Patreon CTA already
        // delivers the explanation in context.
        if (card.groupKind === "free") {
          card.dividerDescription = game.i18n.localize("BENEOS.Patreon.FreeSection.Description")
        }
        if (showFilterValue === "new" && card.groupKind === "new" && groupBulkKeys.new.length) {
          card.dividerBulkAction = {
            variant: "new",
            group: "new",
            count: groupBulkKeys.new.length,
            label: game.i18n.format("BENEOS.Cloud.Results.InstallAllNewN", { count: groupBulkKeys.new.length }),
            icon: "fa-solid fa-plus"
          }
        } else if (showFilterValue === "updated" && card.groupKind === "update" && groupBulkKeys.update.length) {
          card.dividerBulkAction = {
            variant: "update",
            group: "update",
            count: groupBulkKeys.update.length,
            label: game.i18n.format("BENEOS.Cloud.Results.InstallAllUpdateN", { count: groupBulkKeys.update.length }),
            icon: "fa-solid fa-rotate"
          }
        }
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
    if (kind === "free") {
      const mode = this.searchMode
      if (mode === "token") return game.i18n.localize("BENEOS.Patreon.FreeSection.Creatures")
      if (mode === "item")  return game.i18n.localize("BENEOS.Patreon.FreeSection.Loot")
      if (mode === "spell") return game.i18n.localize("BENEOS.Patreon.FreeSection.Spells")
      if (mode === "bmap")  return game.i18n.localize("BENEOS.Patreon.FreeSection.Maps")
      return game.i18n.localize("BENEOS.Patreon.FreeBadge")
    }
    if (kind === "locked") return game.i18n.localize("BENEOS.Patreon.LockedSectionHeader")
    if (kind === "new")    return game.i18n.localize("BENEOS.Cloud.Results.GroupNew")
    if (kind === "update") return game.i18n.localize("BENEOS.Cloud.Results.GroupUpdate")
    // Regular ("All assets") group: name it per type so it's meaningful. When
    // the user lacks campaign access the main group is only the INSTALLED
    // subset (the rest sit under the locked Patreon section below), so say
    // "All Installed <Type>" to avoid implying it's the full catalogue. Maps
    // are cloud-only (no local install tracking) -> always "All Maps".
    const mode = this.searchMode
    const has = !!game.beneos?.cloud?.hasCampaignAccess?.(mode === "bmap" ? "battlemaps" : "tokens")
    const regularKey = {
      token: has ? "AllCreatures" : "AllInstalledCreatures",
      item:  has ? "AllLoot"      : "AllInstalledLoot",
      spell: has ? "AllSpells"    : "AllInstalledSpells",
      bmap:  "AllMaps",
    }[mode]
    if (regularKey) return game.i18n.localize("BENEOS.Cloud.Results." + regularKey)
    return game.i18n.localize("BENEOS.Cloud.Results.GroupRegular")
  }

  // Strip HTML to plain text for the drawer's "Full Description" block.
  // Six-step pipeline. Each step exists because a specific symptom was
  // observed in the raw card-creator HTML:
  //   1. Beneos card-creator promo boilerplate must be cut entirely.
  //   2. Card-image labels ("Item Card", "FRONT CARD", "BACK CARD") must
  //      be cut — they only made sense beside their now-stripped <img>.
  //   3. <img> tags must be removed so labels don't end up adjacent to
  //      filename fragments.
  //   4. Block-level closing tags must be replaced with newlines BEFORE
  //      textContent runs — otherwise paragraphs/headers concatenate
  //      with no whitespace.
  //   5. DOM-based textContent strip handles inline tags safely.
  //   6. Final whitespace pass: collapse runs, trim lines, cap blank
  //      lines at one.
  // Pre-DOM regex steps run on the raw string deliberately — operating
  // on .innerHTML and then .textContent collapses too many boundaries
  // for the boilerplate patterns to match reliably.
  static stripHtmlToPlaintext(htmlString) {
    if (!htmlString || typeof htmlString !== "string") return ""

    let html = htmlString

    // --- Step 1: Strip the Beneos card-creator promo boilerplate ---
    // The promo is a fixed block appended by the Beneos card creator to
    // every Cloud-shipped item and spell. We've seen at least three
    // header variants — the strip anchors on any of them and cuts greedy
    // to end-of-string (the promo is always the final block).
    //
    // Known promo anchors (case-insensitive):
    //   - "Enhance Your Gaming Experience"             (older items)
    //   - "This item is available for VTTs"            (loot variant)
    //   - "This spell is available for VTTs"           (spell variant)
    //   - "available for VTTs and as printable cards"  (shared substring fallback)
    //
    // After the anchor pass, an extra stub-strip catches the patron-link
    // footer "FREE DOWNLOAD FOR PATRONS HERE" in case a yet-unknown
    // promo variant slips through.
    const promoAnchors = [
      /<[^>]*>\s*Enhance Your Gaming Experience[\s\S]*$/i,
      /Enhance Your Gaming Experience[\s\S]*$/i,
      /<[^>]*>\s*This (?:item|spell) is available for VTTs[\s\S]*$/i,
      /This (?:item|spell) is available for VTTs[\s\S]*$/i,
      /available for VTTs and as printable cards[\s\S]*$/i,
    ]
    for (const re of promoAnchors) {
      html = html.replace(re, "")
    }
    // Defense-in-depth: strip any leftover patron-link stub.
    html = html.replace(/>+\s*FREE DOWNLOAD FOR PATRONS HERE\s*<+/gi, "")

    // --- Step 2: Strip card-image labels ---
    // "Item Card", "FRONT CARD", "BACK CARD" appear as standalone labels
    // adjacent to the card-image <img>s.
    html = html.replace(
      /<[^>]+>\s*(?:Item Card|FRONT CARD|BACK CARD)\s*<\/[^>]+>/gi,
      ""
    )
    html = html.replace(/\b(?:Item Card|FRONT CARD|BACK CARD)\b/g, "")

    // --- Step 3: Remove <img> tags entirely ---
    html = html.replace(/<img\b[^>]*>/gi, "")

    // --- Step 4: Convert block-level tag boundaries to newlines ---
    // textContent collapses block boundaries to nothing. Pre-injecting
    // newlines preserves paragraph and header breaks.
    html = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|h[1-6]|li|tr|section|article|header|footer|blockquote|pre)\s*>/gi, "\n")
      .replace(/<hr\s*\/?>/gi, "\n")
    // Header *opening* tags get a leading newline too so the header
    // never butts into the trailing text of a previous block.
    html = html.replace(/<(?:h[1-6])\b[^>]*>/gi, "\n")

    // --- Step 5: DOM strip remaining tags ---
    const tmp = document.createElement("div")
    tmp.innerHTML = html
    let text = tmp.textContent ?? ""

    // --- Step 5b: Reduce Foundry enricher references to their display name ---
    // system.description.value is NOT pre-enriched by TextEditor.enrichHTML
    // (we read it raw from the compendium document), so V13-style enricher
    // tokens survive the DOM pass intact as plain text. Reduce them so the
    // reader sees just the human label:
    //   @UUID[Compendium.dnd5e.spells24.Item.phbsplMa]{Magic Missile}  → Magic Missile
    //   @UUID[Actor.abc123]{Some NPC}                                  → Some NPC
    //   @Damage[2d6]{2d6 piercing}                                     → 2d6 piercing
    //   @Check[wis]{Wisdom Check}                                      → Wisdom Check
    //   &Reference[abilityCheck]{Skill Check}                          → Skill Check
    // Both @Foo[…] (Foundry core) and &Foo[…] (dnd5e system) variants
    // are handled. Tokens without a display brace are dropped entirely
    // rather than left as raw bracket noise.
    text = text
      .replace(/[@&]\w+\[[^\]]+\]\{([^}]+)\}/g, "$1")
      .replace(/[@&]\w+\[[^\]]+\]/g, "")

    // --- Step 6: Whitespace normalisation ---
    text = text
      .replace(/ /g, " ")                  // nbsp → space
      .split("\n")
      .map(line => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")               // cap blank lines at one
      .trim()

    return text
  }

  // Loads the local item/spell description from the appropriate Beneos
  // world-scoped compendium pack and caches it. Idempotent: re-calls for
  // the same (assetType, key) return immediately from cache.
  //
  // The compendium is the single source of truth — world Items can be
  // deleted, moved, or renamed by the user, but compendium entries are
  // the install target and the update target. We do NOT fall back to
  // game.items, by design.
  //
  // Patron-gated: returns null silently for non-item/spell types, when
  // the asset is not installed (no cached docId), when the user's system
  // is not dnd5e (no packs created — see beneos_utility.js:614), or when
  // the compendium document is missing or empty.
  //
  // Called from the card-click handler BEFORE the drawer re-renders, so
  // the synchronous #enrichCard step can read the cached result.
  async #ensureLocalFullDescriptionLoaded(key, assetType) {
    if (!key) return null
    if (assetType !== "item" && assetType !== "spell") return null

    const cacheKey = `${assetType}:${key}`
    if (this.localFullDescriptionCache.has(cacheKey)) {
      return this.localFullDescriptionCache.get(cacheKey)
    }

    const docId = assetType === "spell"
      ? BeneosUtility.getSpellId?.(key)
      : BeneosUtility.getItemId?.(key)
    if (!docId) {
      // Don't cache: the asset may simply not be installed yet. When the
      // drawer is open BEFORE install, the first call lands here, gets
      // null, and a cached null would block the post-install re-render
      // from ever picking up the description (this is workflow B from
      // the bug repro). Pack absence below stays cached because that's
      // a permanent state (no compendium = no docs for the session).
      return null
    }

    const packName = assetType === "spell"
      ? "world.beneos_module_spells"
      : "world.beneos_module_items"
    const pack = game.packs?.get?.(packName)
    if (!pack) {
      this.localFullDescriptionCache.set(cacheKey, null)
      return null
    }

    try {
      const doc = await pack.getDocument(docId)
      const html = doc?.system?.description?.value
      const plaintext = BeneosCloudWindowV2.stripHtmlToPlaintext(html)
      // M8.3.40: escape + convert the proprietary __phrase__ markers to a bold
      // accent so the installed-item description reads cleanly in the drawer.
      const result = plaintext.length > 0 ? beneosFormatMarkup(plaintext, { escape: true }) : null
      // Only cache positive results. A null here typically means the
      // compendium doc wasn't fully populated yet (race with a fresh
      // cloud-install — the doc lands but its description.value can
      // arrive a few ticks later). Caching null would lock the empty
      // state in for the whole session; leaving null uncached lets the
      // next click retry and pick up the description once it's there.
      if (result !== null) {
        this.localFullDescriptionCache.set(cacheKey, result)
      }
      return result
    } catch (err) {
      console.warn("[Beneos] Failed to load local description from compendium:", err)
      // Same retry-on-failure policy: don't poison the cache.
      return null
    }
  }

  // Perf (Task D): return the bmap catalog reusing a per-build snapshot when
  // one is active (set in #buildCards), instead of a fresh getAll() deep-copy
  // on every call. getAll("bmap") copies ~1838 entries (~13ms) , calling it
  // per card was the dominant cost of the scene-click re-render.
  #bmapCatalog() {
    return this._bmapSnapshot || game.beneos?.databaseHolder?.getAll?.("bmap") || {}
  }

  #enrichCard(assetType, key, data) {
    const props = data?.properties ?? {}
    const thumbBase = THUMB_BASE[assetType] || ""
    const thumbFile = props.thumbnail || props.icon || data.thumbnail || data.icon
    const thumbUrl = thumbFile ? thumbBase + thumbFile : null

    const typeArr = Array.isArray(props.type) ? props.type : (props.type ? [props.type] : [])
    let typeLabel = null
    if (typeArr.length) {
      const typeRaw = String(typeArr[0])
      const typeField = assetType === "bmap" ? "battlemap.type" : "token.type"
      const t = game.beneos?.databaseHolder?.localizeTag?.(typeField, typeRaw)
      typeLabel = (t && t !== typeRaw) ? t : this.#capitalize(typeRaw)
    }

    // Drag-drop attributes — same shape the v1 dragstart handler reads.
    // Wave B-7-fix-1: V1's processInstalledBattlemap (mirrored at
    // beneos_search_engine.js:505) sets bmapData.isInstalled = true on every
    // entry as a side effect of the data scan. In V2 that bled through and
    // bmaps appeared with the green "Installed" pill even though we don't
    // track local battlemap installs at all — installs flow through
    // Moulinette (until the cloud-bmap pipeline ships in B-8). For V2,
    // bmaps are cloud-only previews; force the flags accordingly.
    const isInstalled = assetType === "bmap" ? false : !!data.isInstalled
    let dragMode = data.dragMode || "none"

    // Teil 3: battlemap installed-marker (green check + "Installed on" tooltip)
    // and update detection — MARKER ONLY, we never flip isInstalled (that would
    // reroute the card into the token-style installed branch and strip the
    // install/Moulinette buttons; an installed map must stay re-installable).
    // Foundry scene ids aren't in the catalog, so a scene counts as installed
    // when its release has a record (installing the release puts these scenes
    // in the world). Update = the install predates the online updated_date or
    // the content signature changed.
    // (Computed BEFORE isCloudAvailable below, which uses bmapInstalled.)
    // A single map card can only offer removal of its WHOLE release: the
    // uninstaller works off the pack manifest and has no per-scene view. The
    // release's own name travels with it so the confirmation names the release
    // and not the one map the card is titled after.
    const bmapInfo = (assetType === "bmap")
      ? this.#bmapInstallInfo(props.release_dir)
      : this.#bmapInstallInfo("")
    const bmapInstalled          = bmapInfo.installed
    const bmapInstalledOn        = bmapInfo.installedOn
    const bmapUpdate             = bmapInfo.update
    const bmapReleaseName        = bmapInfo.releaseName
    const bmapUninstallVariant   = bmapInfo.variant
    const bmapUninstallPackageId = bmapInfo.packageId
    // NO partial marker on a single-map card, deliberately. The completeness we
    // can measure is the RELEASE's, and this card is one scene out of it: a map
    // the user installed exactly as a single map is complete as far as they are
    // concerned, and "Partly installed: 1 of 14 scenes" on it would be a second
    // false statement rather than the end of one. The reason it cannot be
    // measured per map is two lines above: Foundry scene ids are not in the
    // catalog. The release card carries the marker.

    // Patron-aware per-card flags. isFree surfaces the green "FREE" badge
    // and groups the card into the Free section for non-patrons. isLocked
    // means the user lacks the campaign-specific Patreon membership AND
    // the asset isn't on their free list — the card then shows a
    // "Join Patreon" CTA instead of the install button and refuses drag.
    const cardCampaign = assetType === "bmap" ? "battlemaps" : "tokens"
    const hasCampaign = !!game.beneos?.cloud?.hasCampaignAccess?.(cardCampaign)
    // Free status, single source of truth: token/item/spell come SOLELY from the
    // cloud "Free" tier (data.free) — the catalog free_content flag is ignored for
    // them (stale/unmaintained, must have no effect). Battlemaps keep their own
    // catalog free_content, which IS kept current via the admin Free-Content checkbox.
    const isFree = (assetType === "bmap")
      ? (props.free_content === true)
      : (game.beneos?.cloud?.isFreeAsset?.(assetType, data.key) === true)
    // bmaps have no local install tracking, but they are NOT unconditionally
    // cloud-available: a map is only installable when the user actually has
    // access. Forcing this true made isLocked never fire for maps, so locked
    // maps wrongly showed an install button instead of the "Join Patreon" CTA.
    //
    // Access comes from the SERVER: list_releases carries can_install per
    // release, which already accounts for tier, shop purchase, gift and
    // loyalty. An individual map inherits its parent release's verdict. Asking
    // only hasCampaign here locked shop buyers out of maps they had paid for
    // (reported 2026-07-30). hasCampaign stays as the fallback for cards whose
    // release is not in the index yet.
    const bmapRelease = (assetType === "bmap" && props.release_dir)
      ? (this._releaseIndex?.get?.(props.release_dir) || null)
      : null
    const bmapReleaseCanInstall = bmapRelease ? (bmapRelease.can_install !== false) : false
    // An individual map inherits its parent release's shop product, so a locked
    // scene card can offer the same "Buy pack" route as the release card.
    const bmapShopUrl = bmapRelease?.shop_url || null
    const isCloudAvailable = assetType === "bmap"
      ? (bmapReleaseCanInstall || hasCampaign || isFree || bmapInstalled)
      : !!data.isCloudAvailable
    const isLocked = !isCloudAvailable && !isInstalled && !isFree
    if (isLocked) dragMode = "none"
    // Installed asset with a pending update the user is no longer entitled to
    // (Patreon access lost or downgraded, or it was installed under a paid
    // account and the user is now on Free). The update cannot be fetched, so the
    // update button shows a "patrons only" notice instead of running a download
    // that would fail silently. Only tokens/items/spells track a local install;
    // battlemaps have their own release-locked path.
    const updateLocked = assetType !== "bmap" && isInstalled && !!data.isUpdate && !hasCampaign && !isFree
    // Pre-compute the three state flags that feed both the card-object
    // and the isOutOfSync catch-all detection. Without these as named
    // consts, the catch-all condition has to re-evaluate the same
    // expressions inline, which is brittle when one of them changes.
    const cardIsIncompatible = !isInstalled && BeneosUtility.isHardBlockedKind(assetType)
    // Maps now install through the native cloud pipeline (login required), so
    // they are no longer exempt from the sign-in gate: logged out, a map card
    // shows "Sign In" (opens the login dialog) instead of a broken install
    // button that throws "manager missing".
    const cardNeedsLogin = !(game.beneos?.cloud?.isLoggedIn?.())
    // Feature 5: battlemaps now respect offline too (the bmap exemption is
    // gone). Offline -> the card shows the "Offline" state and drops its remote
    // thumbnail so the result list isn't flooded with broken images.
    // 14.4.8: an den echten Serverausfall gebunden statt an den Katalogzustand.
    // Die Pille sagt "offline" und das Weglassen des Vorschaubildes setzt voraus,
    // dass nichts geht. Bei einem bloss veralteten Suchindex geht aber alles:
    // Vorschaubilder und Downloads laufen ueber beneos.cloud, nicht ueber den
    // Katalog-Host. Vorher log die Karte den Nutzer an.
    const cardIsOffline = game.beneos?.cloud?.serverOffline === true
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
    let siblingKindLabel = null
    let siblingType = null
    if (assetType === "bmap" && props.sibling) {
      const sib = this.#bmapCatalog()[props.sibling]   // Task D: snapshot, no per-card getAll
      const sibThumb = sib?.properties?.thumbnail
      if (sibThumb) siblingThumbUrl = THUMB_BASE.bmap + sibThumb
      siblingType = sib?.properties?.type
      siblingKindLabel = this.#sceneKindLabel(siblingType)
    }
    // Drawer-pair corner chips: tell the user which image is the Battlemap and
    // which is the Scenery (replaces the old generic "Paired view" label).
    const heroKindLabel = assetType === "bmap" ? this.#sceneKindLabel(props.type) : null

    // The drawer pair always shows Scenery on top, Battlemap below , regardless
    // of which one the user clicked , for a consistent visual experience. Map
    // the clicked + sibling thumbnails onto fixed scenery/battlemap slots.
    let pairSceneryUrl = null, pairBattlemapUrl = null
    if (assetType === "bmap" && siblingThumbUrl && thumbUrl) {
      const clickedIsScenery = /scen/.test(String(Array.isArray(props.type) ? props.type[0] : (props.type || "")).toLowerCase())
      if (clickedIsScenery) { pairSceneryUrl = thumbUrl;        pairBattlemapUrl = siblingThumbUrl }
      else                  { pairSceneryUrl = siblingThumbUrl; pairBattlemapUrl = thumbUrl }
    }

    // True map aspect ratio from the grid dimensions (the preview thumbnails are
    // all 16:9 crops, but props.grid holds the real "W x H" in squares). The
    // drawer uses this so the battlemap box shows the correct shape instead of
    // a forced 16:9. Null when grid is missing/unparseable -> natural fallback.
    let mapAspect = null
    if (assetType === "bmap" && props.grid) {
      const m = String(props.grid).match(/(\d+)\s*x\s*(\d+)/i)
      if (m) {
        const w = parseInt(m[1], 10), h = parseInt(m[2], 10)
        if (w > 0 && h > 0) mapAspect = { w, h }
      }
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

    // Punkt 3: compatible-adventure chip. Catalog scenes carry the adventure
    // in props.adventure (slug or localized). We render a compact acronym
    // (Curse of Strahd -> CoS, Descent into Avernus -> DiA) with the full
    // name in the tooltip. Front-of-house chip parity for the cloud browser.
    let compatibleAdventure = null
    if (assetType === "bmap" && props.adventure) {
      const advRaw = String(Array.isArray(props.adventure) ? props.adventure[0] : props.adventure)
      const loc = game.beneos?.databaseHolder?.localizeTag?.("battlemap.adventure", advRaw)
      compatibleAdventure = this.#adventureChip((loc && loc !== advRaw) ? loc : advRaw)
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
    if (assetType === "token") {
      // Top-Down Stage 5: variant strip thumbnails always come from
      // the search-engine CDN (the same data source the result-card
      // avatar uses). 2 tiles per variant — 2.5D (-db-token.webp) and
      // Top-Down (-db-top.webp). Stage-4's local-path branch was
      // wrong; the user explicitly wants the online thumbnails. The
      // template's onload/onerror gate still removes tiles whose URL
      // 404s, so partial CDN uploads degrade gracefully. assetKey is
      // pre-computed for the uninstalled-drag flow (cloudPending).
      for (let i = 1; i <= nbVariants; i++) {
        const variantActorId = BeneosUtility.getActorIdVariant?.(key, i)
        const isInstalled = !!variantActorId
        const baseUrl = `${THUMB_BASE.token}${key}-${i}`
        variants.push({
          index: i,
          style: "tokenized",
          thumbUrl: `${baseUrl}-db-token.webp`,
          actorId: variantActorId || "",
          assetKey: key,
          isInstalled
        })
        variants.push({
          index: i,
          style: "topdown",
          thumbUrl: `${baseUrl}-db-top.webp`,
          actorId: variantActorId || "",
          assetKey: key,
          isInstalled
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
        const tOrigin = game.beneos?.databaseHolder?.localizeTag?.("item.origin", itemOrigin)
        itemOriginLabel = (tOrigin && tOrigin !== itemOrigin) ? tOrigin : this.#capitalize(itemOrigin)
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
      if (props.item_type) {
        const itRaw = String(props.item_type)
        const tIt = game.beneos?.databaseHolder?.localizeTag?.("item.item_type", itRaw)
        itemTypeLabel = (tIt && tIt !== itRaw) ? tIt : itRaw
      }
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

    // Build a single, ordered tag-descriptor array so the template can
    // render the chip row with one {{#each}} loop and a per-card visible
    // limit ("+X more" overflow indicator). Each descriptor carries the
    // display label, click-filter wiring, optional tooltip, and an
    // optional className for type-specific tag styling. Order mirrors
    // the original mode-specific layout (CR / rarity / origin / item type
    // / type / grid / level / school / faction / source) so the visible
    // first-N chips look identical to the previous design when there are
    // few tags.
    const tagDescriptors = []
    const pushTag = (descriptor) => {
      if (!descriptor) return
      // Coerce + trim so whitespace-only labels, accidental Array→String
      // joins ("a,b"), and stringified null/undefined ("null") all get
      // dropped instead of rendering as empty / weird chips. Array-typed
      // fields (faction, etc.) are exploded by their own callers below
      // BEFORE this helper sees them — by the time we hit pushTag, label
      // should already be a single primitive value.
      const lbl = String(descriptor.label ?? "").trim()
      if (!lbl || lbl === "null" || lbl === "undefined") return
      tagDescriptors.push({ ...descriptor, label: lbl })
    }
    const crLabelForTag = BeneosCloudWindowV2.#formatCR(props.cr)
    if (props.cr !== undefined && props.cr !== null) {
      pushTag({
        label: `CR ${crLabelForTag}`,
        className: "bc-tag-cr",
        filterType: "cr",
        filterValue: props.cr,
        tooltip: null
      })
    }
    if (props.rarity) {
      const tRar = game.beneos?.databaseHolder?.localizeTag?.("item.rarity", props.rarity)
      pushTag({
        label: (tRar && tRar !== String(props.rarity)) ? tRar : props.rarity,
        className: "bc-tag-rarity",
        filterType: "rarity",
        filterValue: props.rarity,
        tooltip: this.#getCardTagTooltip("rarity", props.rarity)
      })
    }
    if (itemOriginLabel) {
      pushTag({
        label: itemOriginLabel,
        className: "bc-tag-origin",
        filterType: "origin",
        filterValue: props.origin || null,
        tooltip: this.#getCardTagTooltip("origin", props.origin)
      })
    }
    if (itemTypeLabel) {
      pushTag({
        label: itemTypeLabel,
        className: null,
        filterType: "item_type",
        filterValue: props.item_type || null,
        tooltip: this.#getCardTagTooltip("item_type", props.item_type)
      })
    }
    if (typeLabel) {
      const typeFilterValueLocal = (Array.isArray(props.type) ? props.type[0] : props.type) || null
      pushTag({
        label: typeLabel,
        className: null,
        filterType: "type",
        filterValue: typeFilterValueLocal,
        tooltip: this.#getCardTagTooltip(
          assetType === "item" ? "item_type" : assetType === "spell" ? "spell_type" : null,
          typeFilterValueLocal
        )
      })
    }
    if (gridLabel) {
      pushTag({
        label: gridLabel,
        className: null,
        filterType: "grid",
        filterValue: props.grid || null,
        tooltip: null
      })
    }
    if (assetType === "spell" && props.level !== undefined && props.level !== null && props.level !== "") {
      pushTag({
        label: `${game.i18n.localize("BENEOS.Cloud.Card.LevelShort")} ${props.level}`,
        className: null,
        filterType: "level",
        filterValue: props.level,
        tooltip: null
      })
    }
    if (assetType === "spell" && props.school) {
      pushTag({
        label: props.school,
        className: null,
        filterType: "school",
        filterValue: props.school,
        tooltip: null
      })
    }
    // Faction can be a single string OR an array (multi-faction creatures).
    // Render one tag per entry so each is independently click-filterable
    // and gets its own commonData hover lookup — joining them into a
    // single "A,B,C" chip would block per-faction filtering and would
    // render as a comma-merged label instead of separate visual chips.
    const factionList = Array.isArray(props.faction)
      ? props.faction
      : (props.faction ? [props.faction] : [])
    for (const f of factionList) {
      const fStr = String(f ?? "").trim()
      if (!fStr) continue
      pushTag({
        label: fStr,
        className: null,
        filterType: "faction",
        filterValue: fStr,
        tooltip: this.#getCardTagTooltip("faction", fStr)
      })
    }
    // Source tag: only for tokens (legacy creature UX kept). For items
    // + spells we surface the bucket via the small "BENEOS" status chip
    // next to the title (see card.beneosChip below) instead of a wide
    // tag in the meta row — the wide tag overflowed the grid card and
    // doubled visual weight against the row-background highlight.
    if (assetType === "token") {
      const sourceLabel = BeneosCloudWindowV2.#getSourceLabel(props.source)
      if (sourceLabel) {
        pushTag({
          label: sourceLabel,
          className: "bc-tag-source",
          filterType: "source",
          filterValue: props.source || null,
          tooltip: null
        })
      }
    }

    // Static visible limit per card. Holds even on narrow windows because
    // the parent .bc-card-tags also caps height at 2 rows — anything that
    // doesn't fit visually still fits semantically through the "+X more"
    // chip's tooltip. Picked 4 because that's what fits in two rows for
    // the typical mid-length tag strings ("Beast", "Loyalty Tokens", etc.).
    const VISIBLE_TAG_LIMIT = 4
    const visibleTagDescriptors = tagDescriptors.slice(0, VISIBLE_TAG_LIMIT)
    const hiddenTagDescriptors  = tagDescriptors.slice(VISIBLE_TAG_LIMIT)
    const moreTagsCount   = hiddenTagDescriptors.length
    const moreTagsTooltip = moreTagsCount > 0
      ? hiddenTagDescriptors.map(t => t.label).join(" · ")
      : null
    const moreTagsLabel = moreTagsCount > 0
      ? game.i18n.format("BENEOS.Cloud.Card.MoreTags", { count: moreTagsCount })
      : null

    return {
      key,
      assetType,
      name: data.name || key,
      // Feature 5: drop the remote thumb for offline battlemaps so the gradient
      // placeholder + "Offline" overlay renders instead of a broken image.
      thumbUrl: (cardIsOffline && assetType === "bmap") ? null : thumbUrl,
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
      // Subtle highlight on non-SRD entries so Beneos Originals stand out
      // when scrolling. Tokens drive off properties.source; items use
      // properties.origin (lowercase "srd"); spells fall back to the
      // 0000_srd_ key prefix established by the migration.
      isBeneosOriginal: BeneosCloudWindowV2.#getNormalizedSource(data, assetType, key) !== "SRD",
      // Small status-chip beside the name (next to NEW / UPDATE chips).
      // Renders only for non-SRD cards. The label intentionally short so
      // it fits in the grid name-row without wrapping; "BENEOS" reads
      // unambiguously as "Beneos Original / Webshop / Loyalty".
      // Edit #4: never on battlemaps , every map is a Beneos original, so the
      // chip carries no information and just wastes space on the card.
      beneosChip: (assetType === "bmap" || BeneosCloudWindowV2.#getNormalizedSource(data, assetType, key) === "SRD")
        ? null
        : "BENEOS",
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
      description: data.description ? beneosFormatMarkup(data.description, { escape: false }) : null,
      // Patron-gated full description from the locally-installed compendium
      // document. The actual lookup runs asynchronously in the card-click
      // handler (#ensureLocalFullDescriptionLoaded) and writes the result
      // to localFullDescriptionCache; here we only read the cache so
      // #enrichCard stays synchronous. Null when not loaded yet, not
      // item/spell, not installed, or no body content.
      localFullDescription: (isInstalled && (assetType === "item" || assetType === "spell"))
        ? (this.localFullDescriptionCache.get(`${assetType}:${key}`) ?? null)
        : null,
      variantsCount: props.nb_variants || null,
      // Stage 3: pre-computed flag because Foundry's Handlebars helper
      // set ships with `eq` but not `gt` — single-variant counter
      // suppression is gated by this in the template.
      hasMultipleVariants: (props.nb_variants || 1) > 1,
      variants,
      isInstalled,
      // Installed creatures get a "Codex" button that opens the Creature Codex.
      showCodexButton: isInstalled && assetType === "token",
      // Installed items/spells get an "Open" button that opens the local sheet
      // so the user can jump straight to the imported document.
      showOpenButton: isInstalled && (assetType === "item" || assetType === "spell"),
      isCloudAvailable,
      // Hard-blocked kinds on non-dnd5e systems (Loot, Spells on Pathfinder
      // and friends). Used by the action-area renderer to swap the Install
      // button for a red "Not compatible" pill so the GM sees up front
      // what won't install. The cached BeneosUtility.isDnd5e check is a
      // single property read; cheap enough to evaluate per card.
      isIncompatible: cardIsIncompatible,
      isInstallable: !!data.isInstallable,
      // Wave B-9-fix-58 → fix-59: surface login + offline state to the
      // card so the install button can render a tailored label/tooltip
      // instead of the generic "Not Available" when the real reason
      // is the user being signed out or the server being unreachable.
      // Bmaps are NO LONGER exempt — they now install through the native
      // Beneos Cloud pipeline (login required), so logged out a map card
      // shows "Sign In" exactly like Creatures/Spells/Loot.
      needsLogin: cardNeedsLogin,
      isOfflineCard: cardIsOffline,
      // Catch-all sync flag: when none of the previous branches match
      // (not installing/installed/offline/needs-login/locked/incompatible/
      // cloud-available), the card used to fall through to a silent
      // catch-all in the template, leaving users with no button and no
      // status. This flag flips on for exactly that case so the template
      // can render a visible "Cloud catalog out of sync" pill instead.
      isOutOfSync: !isInstalling
                && !isInstalled
                && !cardIsOffline
                && !cardNeedsLogin
                && !isLocked
                && !cardIsIncompatible
                && !isCloudAvailable,
      isNew: !!data.isNew,
      isNewForUser: !!data.isNewForUser,
      isUpdate: assetType === "bmap" ? bmapUpdate : !!data.isUpdate,
      // Teil 3: marker-only installed state for battlemap scene cards.
      bmapInstalled,
      installedOnLabel: bmapInstalledOn,
      // Same uninstall affordance as the release card, aimed at the parent
      // release. Only a GM, and only when the pack dir could be resolved: with
      // no packageId the handler has nothing to describe and would refuse.
      canUninstall:         bmapInstalled && !!bmapUninstallPackageId && !!game.user?.isGM,
      uninstallVariant:     bmapUninstallVariant,
      uninstallPackageId:   bmapUninstallPackageId,
      uninstallReleaseDir:  String(props.release_dir || ""),
      uninstallReleaseName: bmapReleaseName,
      isFree,
      isLocked,
      updateLocked,
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
      // Plan §13: a battlemap catalog entry is "cloud-ready" when it carries
      // the three slugs the cloud install path needs (cloud_release_id +
      // release_dir + cloud_scene_slug). Otherwise the drawer falls back to
      // the Moulinette button. hasSibling drives the optional "Install pair"
      // CTA — only set when the partner entry actually has its own cloud
      // slug too (siblings without a slug cannot be paired-installed).
      cloudReady: assetType === "bmap"
        && !!(data?.properties?.cloud_release_id)
        && !!(data?.properties?.cloud_scene_slug)
        && !!(data?.properties?.release_dir),
      hasSibling: assetType === "bmap"
        && !!(data?.properties?.sibling)
        && !!(this.#bmapCatalog()[data.properties.sibling]?.properties?.cloud_scene_slug),
      siblingThumbUrl,
      siblingKindLabel,
      heroKindLabel,
      pairSceneryUrl,
      pairBattlemapUrl,
      mapAspect,
      gridLabel,
      releaseLabel,
      compatibleAdventure,
      // Punkt 4: parent-release link for the Individual-Maps scene drawer
      // ("This Scene Belongs to …" + the release's other scenes).
      releaseDir: assetType === "bmap" ? (props.release_dir || null) : null,
      releaseDisplayName: assetType === "bmap"
        ? (this._releaseIndex?.get?.(props.release_dir)?.display_name || null)
        : null,
      // Wave B-9-fix-32 → fix-46: any card in the multi-select set
      // gets the gold highlight. The drawer-open card is always in the
      // set (single click adds itself), so this also covers the
      // single-selection case.
      isSelected: this.selectedKeys?.has?.(key) || this.selectedAssetKey === key,
      // Wave B-8d: group classification for the New → Update → Rest sort.
      // For non-patrons, Free cards float to the top under their own
      // group, and Locked cards sink to the bottom; this is what drives
      // the Free-Section header + Locked-Section behaviour for the
      // patron-aware UX. Patrons see the original New/Update/Regular
      // partitioning so nothing changes for paying users.
      // An installed asset is never grouped/coloured as "free": it already owns
      // the green "installed" border + Installed pill + Codex button, so lumping
      // it into the green Free section (alongside not-installed free cards that
      // show a Sign-In button) made owned and not-yet-owned cards look identical.
      // isLocked already excludes installed cards; new/update stay intact.
      // isLocked now follows the server verdict, so it no longer needs the
      // !hasCampaign guard here: a bought or gifted map must never land in the
      // locked group just because the buyer holds no Patreon membership.
      groupKind: (!hasCampaign && isFree && !isInstalled) ? "free"
              :  (isLocked) ? "locked"
              :  (data?.isNew    ? "new"
              :  (data?.isUpdate ? "update" : "regular")),
      shopUrl: bmapShopUrl,
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
                             ? `${game.i18n.localize("BENEOS.Cloud.Card.LevelShort")} ${props.level}` : null,
      // Tag descriptor list + overflow indicator for the grid-card chip
      // row. The template iterates visibleTagDescriptors with a single
      // {{#each}} and renders the "+N more" chip when moreTagsCount > 0.
      // Hidden labels are joined into moreTagsTooltip so the overflowed
      // info stays one hover away.
      visibleTagDescriptors,
      moreTagsCount,
      moreTagsLabel,
      moreTagsTooltip
    }
  }

  #capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }

  // Drawer-pair chip: classify a bmap scene as Battlemap or Scenery from its
  // type property and return the localized label (reuses the sidebar filter
  // keys). Returns null when the type is unknown.
  #sceneKindLabel(type) {
    const raw = String(Array.isArray(type) ? type[0] : (type || "")).toLowerCase()
    if (!raw) return null
    return /scen/.test(raw)
      ? game.i18n.localize("BENEOS.Cloud.Drawer.KindScenery")
      : game.i18n.localize("BENEOS.Cloud.Drawer.KindBattlemap")
  }

  // Punkt 3: derive a compact adventure acronym + a clean full name from a
  // raw adventure value (slug "curse-of-strahd" or localized "Curse of
  // Strahd"). The acronym keeps the first letter of every word, lowercasing
  // connector words so it reads like the storefront chips: Curse of Strahd ->
  // "CoS", Descent into Avernus -> "DiA". Returns null when there's nothing
  // meaningful to show.
  #adventureChip(name) {
    const raw = String(name ?? "").trim()
    if (!raw) return null
    // Guard against junk values that would otherwise render as a chip with a
    // "Undefined" full name (and a "Compatible with undefined" tooltip) when the
    // catalog field is empty/placeholder. Treat these as "no adventure".
    if (/^(undefined|null|none|n\/?a|-+|nan)$/i.test(raw)) return null
    const connectors = new Set([
      "of", "the", "into", "in", "and", "to", "a", "an", "on", "at", "for",
      "from", "with", "by", "de", "le", "la", "des", "du", "von", "der"
    ])
    const words = raw.split(/[\s_\-]+/).filter(Boolean)
    if (!words.length) return null
    let acronym = ""
    const display = []
    for (const w of words) {
      const lower = w.toLowerCase()
      const isConn = connectors.has(lower)
      const first = w.charAt(0)
      acronym += isConn ? first.toLowerCase() : first.toUpperCase()
      display.push(isConn ? lower : (first.toUpperCase() + w.slice(1)))
    }
    if (!acronym) return null
    return { acronym, fullName: display.join(" ") }
  }

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
  #orderDropdownList(list, domainField) {
    if (!Array.isArray(list)) return list
    const dbHolder = game.beneos?.databaseHolder
    const label = (r) => {
      if (domainField && dbHolder?.localizeTag) {
        const t = dbHolder.localizeTag(domainField, r.key)
        if (t && t !== r.key) return t   // matrix hit (active locale -> en)
      }
      return this.#capitalize(r.value)    // fallback: existing capitalize
    }
    const anyEntry = list.find(r => r.key === "any")
    const rest = list
      .filter(r => r.key !== "any")
      .map(r => ({ key: r.key, value: label(r) }))
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
    const dbHolder = game.beneos?.databaseHolder
    for (const bucket of buckets) {
      const found = rawRarity.find(r => bucket.keys.includes(r.key))
      if (found) {
        const t = dbHolder?.localizeTag?.("item.rarity", found.key)
        const value = (t && t !== found.key) ? t : bucket.canonical
        // Emit the canonical lowercase rarity string as the option key/value so
        // it matches the item DB's `properties.rarity` ("Common", "Very Rare", …)
        // exactly. The raw list sometimes keys rarity numerically ("0".."5"),
        // which never matched the string the items actually store, so selecting a
        // rarity returned nothing.
        out.push({ key: bucket.canonical.toLowerCase(), value })
      }
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

  // Comparable "newness" per asset; higher = newer.
  //
  // Publication date, not the cloud updated_ts. The feed's timestamp moves on
  // every revision, so a creature from last year that got a quiet correction
  // sorted above the release that actually came out this week, and the list
  // headed "newest first" led with the oldest content in the catalog.
  //
  // Battlemaps keep the release-number prefix from the DB key: the content
  // pipeline assigns those in release order ("01-" before "02-"), which is the
  // same ordering their dates would give. Falls back to 0 when nothing is
  // known, which lets the alphabetic tie-breaker take over.
  #recencyOf(type, key, data) {
    if (type === "bmap") {
      const m = String(key || "").match(/^(\d+)/)
      return m ? parseInt(m[1], 10) || 0 : 0
    }
    const ms = Date.parse(data?.properties?.release_date || "")
    return Number.isFinite(ms) ? ms : 0
  }

  // Tiered relevance score for the free-text search. Returns 0 when
  // nothing matches (caller drops the entry). Searched fields:
  //   - data.name                       (primary)
  //   - data.properties.hidden_tags     (alias terms, e.g. "Beholder" on
  //                                      a licensing-safe Aberrant Tyrant;
  //                                      schema is normally an array but
  //                                      a few records store a string)
  //   - data.description                (low-weight fallback)
  #scoreTextMatch(data, key, q) {
    if (!q) return 0
    const tokens = q.split(/\s+/).filter(Boolean)
    const name = String(data?.name || key || "").toLowerCase()
    const ht = data?.properties?.hidden_tags
    const tagList = Array.isArray(ht)
      ? ht
      : (typeof ht === "string" && ht.trim() ? [ht] : [])
    const tagText = tagList.map(s => String(s).toLowerCase()).join(" ")
    const desc = String(data?.description || "").toLowerCase()

    if (name === q)             return 1_000_000
    if (name.startsWith(q))     return 900_000 + q.length
    if (name.includes(q))       return 800_000 + q.length
    if (tagText.includes(q))    return 700_000 + q.length

    if (tokens.length > 1 && tokens.every(t => name.includes(t))) {
      const matchedChars = tokens.reduce((s, t) => s + t.length, 0)
      return 600_000 + matchedChars
    }
    if (tokens.length > 1 && tokens.every(t => name.includes(t) || tagText.includes(t))) {
      const matchedChars = tokens.reduce((s, t) => s + t.length, 0)
      return 500_000 + matchedChars
    }

    let partial = 0
    for (const t of tokens) {
      if (name.includes(t))         partial += t.length * 3
      else if (tagText.includes(t)) partial += t.length * 2
    }
    if (partial > 0) return 100_000 + partial

    if (desc.includes(q)) return 10_000
    return 0
  }

  #applyTextFilter(entries, term) {
    const q = String(term || "").toLowerCase().trim()
    if (!q) return entries
    const out = []
    for (const [key, data] of entries) {
      const score = this.#scoreTextMatch(data, key, q)
      if (score > 0) {
        // Stash on the data object so the downstream sort picks it up
        // without re-scoring. #buildCards re-pulls entries from the DB
        // holder each render, so this transient marker doesn't persist.
        data.__bcTextScore = score
        out.push([key, data])
      }
    }
    return out
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

    // The Show filter for battlemaps, which the V2_FILTER_DEFS loop below
    // cannot serve: its installation-selector entry is registered for tokens,
    // items and spells only, because those carry an `installed` property in the
    // catalog. A map does not. Its state lives in the world's install record,
    // and a single map inherits it from its release. Without this branch
    // "Only installed" was a no-op in the Individual Maps view: the chip read
    // as active while the list still showed everything.
    if (type === "bmap") {
      const show = this.showFilter
      if (show && show.toLowerCase() !== "any") {
        const kept = {}
        for (const [k, v] of Object.entries(results)) {
          const releaseDir = String(v?.properties?.release_dir || v?.release_dir || "")
          const info = this.#bmapInstallInfo(releaseDir)
          let keep = true
          if (show === "installed")         keep = info.installed
          else if (show === "notinstalled") keep = !info.installed
          else if (show === "updated")      keep = info.update
          // `isNew` was just written onto every bmap entry by the caller, with
          // the same recency rule the release cards use. Read it rather than
          // deriving a second opinion here.
          else if (show === "new")          keep = !!v?.isNew
          if (keep) kept[k] = v
        }
        results = kept
      }
    }

    for (const def of V2_FILTER_DEFS) {
      // Wave B-8h-1: skip filters that don't apply to the current asset
      // type. Without this guard, stale values on the previous tab's
      // sidebar selectors (still in the DOM during the part-render
      // window) cross-contaminate the new tab's filter pipeline.
      if (def.types && !def.types.includes(type)) continue
      // V7: the Show filter persists on the instance (this.showFilter)
      // so it survives tab switches without depending on the DOM state
      // of the sidebar that's about to be re-rendered. All other filters
      // remain DOM-state — they're tab-scoped and the def.types guard
      // above already prevents cross-tab contamination.
      let value
      if (def.selector === "installation-selector") {
        value = this.showFilter
      } else {
        const sel = root.querySelector("#" + def.selector)
        if (!sel) continue
        value = sel.value
      }
      if (!value || value.toLowerCase() === "any") continue
      // Show-filter values "new" and "updated" don't map onto a property
      // value (data.installed only carries "installed"/"notinstalled").
      // Filter on the corresponding boolean flags that #enrichCard reads
      // from the dataset directly.
      if (def.selector === "installation-selector" && (value === "new" || value === "updated")) {
        const flag = value === "new" ? "isNew" : "isUpdate"
        const filtered = {}
        for (const [k, v] of Object.entries(results)) {
          if (v?.[flag]) filtered[k] = v
        }
        results = filtered
        continue
      }
      const beforeCount = Object.keys(results).length
      // Wave B-8d-fix-9: log every active filter so we can see why
      // searchByProperty isn't narrowing for the user's data shape.
      // Also peek at the first item's relevant property to verify the
      // data has the field we expect.
      const firstKey = Object.keys(results)[0]
      const firstItem = results[firstKey]
      const topLevel = firstItem?.[def.prop]
      const inProps  = firstItem?.properties?.[def.prop]
      if (globalThis.BeneosUtility?.isDebug?.()) console.log(`[Beneos V2] filter "${def.selector}" prop="${def.prop}" value="${value}"`,
        `before=${beforeCount}`,
        { firstItemTopLevel: topLevel, firstItemInProperties: inProps })
      // searchByProperty returns a filtered key→data map.
      // Wave B-8g-4: `dbHolder` IS the BeneosDatabaseHolder class itself
      // (assigned in beneos_module.js:43). `dbHolder.constructor` is
      // `Function` — its static-method properties are undefined, so the
      // optional-chained call quietly no-op'd and every dropdown filter
      // returned all entries. Bug had been latent since B-4. Call the
      // static directly on the class.
      const filtered = dbHolder.searchByProperty?.(type, def.prop, value, results, def.strict === true)
      if (filtered) results = filtered
      const afterCount = Object.keys(results).length
      if (globalThis.BeneosUtility?.isDebug?.()) console.log(`[Beneos V2] filter "${def.selector}" → after=${afterCount}`)
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
  /**
   * Slider position to gold, on a logarithmic scale.
   *
   * Item prices span four orders of magnitude: half the catalogue sits under
   * 2000 gp while a handful of pieces reach the high six figures. On a linear
   * track that puts 84 percent of the items into the first tenth of the slider
   * and leaves half the deciles with nothing in them at all, so the useful part
   * of the range is untouchable with a mouse. The log track spends its travel
   * where the items are.
   *
   * Both ends are exact: position 0 is 0 gold and the last position is the
   * dataset maximum, which is what keeps the "full range, filter off" check
   * from excluding the most expensive item. Everything between is rounded to
   * two significant digits, because a thumb that stops on 1873 reads as a
   * glitch where 1900 reads as a choice. The step of the scale is about six
   * percent, well above that rounding, so no two positions collapse onto the
   * same number.
   */
  #goldPosToValue(pos, maxPrice) {
    const steps = BeneosCloudWindowV2.GOLD_SLIDER_STEPS
    const p = Math.max(0, Math.min(steps, Number(pos) || 0))
    if (p <= 0) return 0
    if (p >= steps) return maxPrice
    const raw = Math.pow(maxPrice + 1, p / steps) - 1
    if (raw <= 10) return Math.round(raw)
    const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1)
    return Math.round(raw / mag) * mag
  }

  /** The inverse, for putting a stored filter back onto the track. */
  #goldValueToPos(value, maxPrice) {
    const steps = BeneosCloudWindowV2.GOLD_SLIDER_STEPS
    const v = Math.max(0, Math.min(maxPrice, Number(value) || 0))
    if (v <= 0) return 0
    if (v >= maxPrice) return steps
    return Math.round(Math.log(v + 1) / Math.log(maxPrice + 1) * steps)
  }

  /** Gold amount as the reader's locale writes it, so 360000 reads as 360,000. */
  #formatGold(value) {
    try { return Number(value).toLocaleString(game.i18n?.lang || undefined) }
    catch (_e) { return String(value) }
  }

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
      const t = dbHolder?.localizeTag?.("token.biom", k)   // common.biome (shared token+bmap)
      const label = (t && t !== k) ? t : this.#capitalize(k)
      const item = { key: k, label, count: counts[k] }
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
    const mode = this.searchMode
    return entries.filter(([key, data]) => {
      const src = BeneosCloudWindowV2.#getNormalizedSource(data, mode, key)
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
    const mode = this.searchMode
    for (const [key, data] of Object.entries(raw)) {
      const src = BeneosCloudWindowV2.#getNormalizedSource(data, mode, key)
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

  /**
   * Teil 3: after a native battlemap install records its state, rebuild the
   * results pane so the installed-marker (and update state, when the online
   * version is newer) appears immediately. A "results" part re-render reruns
   * buildReleaseCards, which reads BeneosInstallState fresh.
   */
  async #refreshAfterBmapInstall(_releaseDir) {
    try { this.render({ parts: ["results"] }) } catch (_) {}
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
      // Stage 14: if the freshly-installed asset is currently the one in
      // the drawer, refresh its detail pane so the full description (only
      // surfaced for installed assets) appears immediately. Without this,
      // the drawer stays in its pre-install state — cloud teaser only,
      // no body text — until the user F5s. User workflow this enables:
      // browse the backlog, click into a card to read the teaser, install,
      // read the full body in place, decide to keep wandering.
      if (key === this.selectedAssetKey) {
        this.#ensureLocalFullDescriptionLoaded(key, this.searchMode)
          .then(() => {
            if (key !== this.selectedAssetKey || !this.rendered) return
            this.render({ parts: ["results"] }).catch(err =>
              console.warn("[Beneos] post-install drawer refresh failed", err)
            )
          })
          .catch(err =>
            console.warn("[Beneos] post-install description preload failed", err)
          )
      }
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
      // button(s). The dragstart listener is on the outer .bc-result-card
      // and survives the inner-HTML swap. Plan §13.3.6 dual-button render
      // can emit two install buttons (cloud + legacy moulinette); listen on
      // both so either path stays clickable.
      actions.querySelectorAll(".bc-action-install").forEach(btn => {
        btn.addEventListener("click", (event) => this.#onInstallClick(event, btn))
      })
      // Re-bind the "Open" button (installed items/spells) after the in-place swap.
      actions.querySelectorAll(".bc-action-open").forEach(btn => {
        btn.addEventListener("click", (event) => this.#onOpenClick(event, btn))
      })
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
      if (card.showOpenButton) {
        html += `<button type="button" class="bc-card-button bc-action-open"`
          + ` data-asset-key="${card.key}" data-asset-type="${card.assetType}"`
          + ` data-tooltip="${localize("BENEOS.Cloud.Card.OpenTooltip")}">`
          + `<i class="fa-solid fa-up-right-from-square"></i>`
          + `<span>${localize("BENEOS.Cloud.Card.Open")}</span></button>`
      }
      return html
    }
    if (card.isIncompatible) {
      // Hard-blocked Loot/Spell on a non-dnd5e system. Mirror of the
      // results-pane.hbs branch. Click is intentionally still wired —
      // confirmSystemCompat surfaces the incompatible-asset info dialog
      // so the GM understands why this asset can't install.
      return `<button type="button" class="bc-card-button bc-action-install bc-action-incompatible"`
        + ` data-asset-key="${card.key}" data-asset-type="${card.assetType}"`
        + ` data-tooltip="${localize("BENEOS.Cloud.Card.NotCompatibleTooltip")}">`
        + `<i class="fa-solid fa-ban"></i> ${localize("BENEOS.Cloud.Card.NotCompatible")}</button>`
    }
    if (card.isCloudAvailable) {
      if (card.isBmap) {
        // Plan §18.7 release-card: Beneos Cloud button (native installer,
        // primary) + Moulinette-legacy fallback. The legacy button hands off
        // to Moulinette's cloud browser pre-filtered by creator + pack so the
        // user can grab the pack there during the parallel-run transition.
        if (card.isReleaseCard) {
          return `<button type="button" class="bc-card-button bc-card-button-primary bc-action-install"`
            + ` data-asset-key="${card.key}" data-asset-type="${card.assetType}"`
            + ` data-bmap-scope="release" data-bmap-release-card="true" data-bmap-native="true"`
            + ` data-tooltip="${localize("BENEOS.Cloud.Bmap.InstallNativeReleaseTooltip")}">`
            + `<i class="fa-solid fa-layer-group"></i></button>`
        }
        // Individual map: same native pipeline, scene scope. Routes through
        // #onInstallClick (data-bmap-native="true") to
        // BeneosNativeBattlemapInstaller.
        return `<button type="button" class="bc-card-button bc-card-button-primary bc-action-install"`
          + ` data-asset-key="${card.key}" data-asset-type="${card.assetType}"`
          + ` data-bmap-scope="scene" data-bmap-native="true"`
          + ` data-tooltip="${localize("BENEOS.Cloud.Bmap.InstallNativeSceneTooltip")}">`
          + `<i class="fa-solid fa-cloud-arrow-down"></i></button>`
      }
      return `<button type="button" class="bc-card-button bc-card-button-primary bc-action-install"`
        + ` data-asset-key="${card.key}" data-asset-type="${card.assetType}"`
        + ` data-tooltip="${localize("BENEOS.Cloud.Card.InstallTooltip")}">`
        + `<i class="fa-solid fa-cloud-arrow-down"></i> ${localize("BENEOS.Cloud.Card.Install")}</button>`
    }
    return `<span class="bc-state-pill bc-state-unavailable" data-tooltip="${localize("BENEOS.Cloud.Card.UnavailableTooltip")}">`
      + `<i class="fa-solid fa-circle-minus"></i> ${localize("BENEOS.Cloud.Card.NotAvailable")}</span>`
  }

  // During a bulk install, Foundry-core emits a per-asset "Updated 1
  // actor(s)…" info-toast from importFromCompendium → Document.create
  // that the module can't suppress via option. Patch ui.notifications.notify
  // for the duration of the loop: errors and warnings pass through, info-
  // toasts are dropped. try/finally restores the original method even if
  // an import throws.
  async #withSuppressedInfoToasts(fn) {
    const n = ui.notifications
    if (!n || typeof n.notify !== "function") return fn()
    const orig = n.notify.bind(n)
    n.notify = (message, type = "info", options = {}) => {
      if (type === "error" || type === "warning" || type === "warn") {
        return orig(message, type, options)
      }
      return null
    }
    try { return await fn() }
    finally { n.notify = orig }
  }

  // Footer progress band — shown only during a bulk install run. Replaces
  // the per-asset toast/chat noise the legacy pipeline produced. Single-
  // install paths intentionally don't touch this; their card pulse is the
  // feedback channel.
  #showInstallProgress(total) {
    const el = this.element?.querySelector?.(".bc-install-progress")
    if (!el) return
    this._bulkInstall = { total, done: 0 }
    el.dataset.state = "running"
    const fill = el.querySelector(".bc-install-progress-fill")
    if (fill) fill.style.width = "0%"
    const label = el.querySelector(".bc-install-progress-label")
    if (label) label.textContent =
      game.i18n.format("BENEOS.Cloud.Progress.InstallProgress", { done: 0, total })
  }
  #tickInstallProgress() {
    const el = this.element?.querySelector?.(".bc-install-progress")
    if (!el || !this._bulkInstall) return
    this._bulkInstall.done++
    const { done, total } = this._bulkInstall
    const pct = total > 0 ? Math.round((done / total) * 100) : 100
    const fill = el.querySelector(".bc-install-progress-fill")
    if (fill) fill.style.width = pct + "%"
    const label = el.querySelector(".bc-install-progress-label")
    if (label) label.textContent =
      game.i18n.format("BENEOS.Cloud.Progress.InstallProgress", { done, total })
  }
  #hideInstallProgress() {
    const el = this.element?.querySelector?.(".bc-install-progress")
    if (!el) return
    el.dataset.state = "done"
    this._bulkInstall = null
    setTimeout(() => { if (el.dataset.state === "done") el.dataset.state = "idle" }, 1500)
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

    // Pre-gate before the install-all confirm dialog. On dnd5e this is a
    // free property read; on other systems the GM gets the system-compat
    // warning (or hard-block info dialog) up front, so they don't first
    // wade through the install-all confirm only to be told nothing can be
    // installed.
    if (type !== "bmap") {
      const ok = await BeneosUtility.confirmSystemCompat(type);
      if (!ok) return;
    }

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
    // Stage 14: at scale, also offer the compendium-only option here. The
    // legacy Yes/No confirm only protected against accidental clicks; it
    // still pushed every asset into the world DB. For > 5 non-bmap assets
    // we now ask whether to add world copies, or just download.
    let deferWorldImport = false
    if (type !== "bmap" && keys.length > 5) {
      // Use DialogV2.wait so the Beneos theme classes actually take effect
      // (legacy `new Dialog()` ignores them, producing an off-theme grey box).
      const bulkBody = `<p class="bc-confirm-text">${game.i18n.format("BENEOS.Cloud.BulkInstall.ConfirmText", { count: keys.length })}</p>`
      let choice
      try {
        choice = await foundry.applications.api.DialogV2.wait({
          window: { title: game.i18n.localize(titleKey) },
          classes: ["dialog", "app", "window-app", "beneos-cloud-app", "beneos-confirm"],
          position: { width: 460 },
          content: `<div class="bc-confirm-content">${innerHtml}${bulkBody}</div>`,
          buttons: [
            { action: "world",    label: game.i18n.localize("BENEOS.Cloud.BulkInstall.WorldInstall"), default: true, callback: () => "world"    },
            { action: "download", label: game.i18n.localize("BENEOS.Cloud.BulkInstall.DownloadOnly"),                callback: () => "download" },
            { action: "cancel",   label: game.i18n.localize("BENEOS.Common.Cancel"),                                 callback: () => "cancel"   }
          ],
          rejectClose: false
        })
      } catch (err) {
        console.warn("[Beneos Cloud] Bulk-install confirm dialog failed", err)
        choice = "cancel"
      }
      if (!choice || choice === "cancel") return
      deferWorldImport = (choice === "download")
    } else {
      // ≤ 5 assets, or bmaps: keep the legacy Yes/No safety net.
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
    }
    this.#showInstallProgress(keys.length)
    // Stage 14: honour the user's "Download only" choice for the lifetime
    // of this bulk run. The loop already awaits each import (Wave B-9-fix-47),
    // so a simple try/finally around the loop suffices — by the time we
    // restore the flag, no in-flight import can still race.
    const prevNoWorldImport = cloud.noWorldImport
    cloud.noWorldImport = deferWorldImport || cloud.noWorldImport
    try {
      // Wave B-9-fix-47: await each pipeline so the compendium's
      // lock/unlock cycle completes before the next starts. The old
      // 250ms timer would race when imports outpaced their own lock
      // step, leading to "locked compendium" errors mid-batch.
      // Stage 14: cancel-check before each iteration — keeps in-flight
      // imports atomic but stops the queue cleanly.
      // Ein Lauf aus dem Cloud-Fenster ist EIN Vorgang, auch wenn der Nutzer
      // mehrere Treffer auf einmal installiert. `search` unterscheidet ihn vom
      // Drawer, wo die Kreatur ungefragt mitkommt.
      const vorgang = cloud.neuerErwerbsvorgang?.() ?? ""
      const kontext = { gated: true, surface: "search", interaction: vorgang }
      await this.#withSuppressedInfoToasts(async () => {
        for (const key of keys) {
          if (this._bulkInstall?.cancelled) break
          this.notifyInstallStarted?.(key)
          if (type === "token") await cloud.importTokenFromCloud?.(key, undefined, false, kontext)
          else if (type === "item")  await cloud.importItemFromCloud?.(key, undefined, false, kontext)
          else if (type === "spell") await cloud.importSpellsFromCloud?.(key, undefined, false, kontext)
          this.#tickInstallProgress()
        }
      })
    } finally {
      cloud.noWorldImport = prevNoWorldImport
    }
    // Stage 14: distinct end-of-run notification on cancel — read
    // counters before #hideInstallProgress() nulls _bulkInstall.
    const wasCancelled = !!this._bulkInstall?.cancelled
    const finalDone   = this._bulkInstall?.done  ?? 0
    const finalTotal  = this._bulkInstall?.total ?? 0
    this.#hideInstallProgress()
    if (wasCancelled) {
      ui.notifications?.info?.(
        game.i18n.format("BENEOS.Cloud.BulkInstall.CancelledNotification",
                         { done: finalDone, total: finalTotal })
      )
    }
  }

  // Extracted from the install-button click handler so the same logic runs
  // for the freshly inserted button after #patchCardState.
  async #onInstallClick(event, btn) {
    event.stopPropagation()
    const key = btn.dataset.assetKey
    const type = btn.dataset.assetType
    if (!key || !type) return
    const cloud = game.beneos?.cloud
    if (!cloud) return
    try {
      const drawer = this._analyticsDrawerOpen
      const sinceMs = (drawer?.key === key && drawer?.ts) ? (Date.now() - drawer.ts) : null
      BeneosAnalytics.track("install_initiated", {
        asset_id: key,
        asset_type: type,
        time_since_drawer_open_ms: sinceMs,
        ...(this.#analyticsSearchId() ? { search_id: this.#analyticsSearchId() } : {})
      })
    } catch (_) {}
    // Wave B-9-fix-46: if the user has Ctrl+click-built a multi-select
    // and clicks the drawer install button, kick off imports for every
    // key in the set instead of just the drawer card. Bmaps don't
    // participate (they go through Moulinette anyway).
    if (type !== "bmap" && this.selectedKeys?.size > 1 && this.selectedKeys.has(key)) {
      this.#installSelected(type)
      return
    }
    // Access gate: if the asset can't be fetched (offline / signed-out /
    // Patreon-locked) short-circuit with clear feedback instead of a phantom
    // progress bar + raw import error. Bmaps go through Moulinette, skip.
    if (type !== "bmap") {
      const reason = this.#installBlockReason(type, btn)
      if (reason) { this.#notifyInstallBlocked(reason, key); return }
    }
    // Pre-gate before any UI state change. Battlemaps go through Moulinette
    // and don't trigger Beneos's install pipeline, so they skip the gate.
    if (type !== "bmap") {
      const ok = await BeneosUtility.confirmSystemCompat(type);
      if (!ok) return;
      this.notifyInstallStarted(key)
    }
    if (type === "token") cloud.importTokenFromCloud(key, undefined, false, { gated: true })
    if (type === "item")  cloud.importItemFromCloud(key, undefined, false, { gated: true })
    if (type === "spell") cloud.importSpellsFromCloud(key, undefined, false, { gated: true })
    if (type === "bmap") {
      // Defensive: a bundle key must never reach the single-bmap path (it would
      // fall through to the Moulinette no-terms notice). Bundle cards open their
      // drawer instead; the drawer wires installBundle / installBundleMember.
      if (this._bundleList?.some(b => b.id === key)) return
      // Plan §13: cloud-migrated entries route through the new install
      // pipeline with a chosen scope. The drawer template emits three
      // buttons with data-bmap-scope="scene|pair|release"; the card-grid
      // emits a single button without that attr, which defaults to scene.
      // Plan §15.1 release-card path: release cards live outside the catalog,
      // so the cloud-ready check falls back to the release index.
      const dbHolder = game.beneos?.databaseHolder
      const bmapData = dbHolder?.getAll?.("bmap")?.[key]
      const props = bmapData?.properties || {}
      const isReleaseCardAttr = btn?.dataset?.bmapReleaseCard === "true"
      // Drawer paths can open for a release-card too — the drawer.asset is
      // synthesized without the data-bmap-release-card attr. Fall back to
      // the release-index so the click still routes through the cloud path.
      const inReleaseIndex = !!this._releaseIndex?.get?.(key)
      const isReleaseCard = isReleaseCardAttr || (inReleaseIndex && !props.cloud_release_id)
      // Plan §20 W4.2 - locked release short-circuit. When the cloud responded
      // can_install=false on this release we open the unlock-CTA URL (Patreon
      // join / shop purchase) instead of firing the install pipeline.
      if (isReleaseCard) {
        const rel = this._releaseIndex?.get?.(key)
        if (rel && rel.can_install === false) {
          const url = rel.unlock_hint?.url || "https://www.patreon.com/BeneosBattlemaps"
          try { console.log("[beneos-bm] release locked, opening unlock", key, url) } catch (_) {}
          window.open(url, "_blank", "noopener,noreferrer")
          return
        }
      }
      // Every catalog scene carries the three cloud fields (verified 2026-07-30:
      // 2071 of 2071), so this is effectively always true. Kept as a guard so a
      // malformed catalog entry fails with a clean notice instead of throwing
      // inside the installer.
      const cloudReady = isReleaseCard
        || inReleaseIndex
        || !!(props.cloud_release_id && props.cloud_scene_slug && props.release_dir)
      if (cloudReady) {
        // "Free without account" (2026-07-01): an allowlisted release
        // (public_download) installs without a Cloud session. The anonymous
        // scenepacker manager (sessionId='anonymous') mints its URLs and the
        // backend serves the allowlisted pack to anonymous callers, so skip the
        // sign-in gate for it. Every other release still needs a login: the
        // native installer would otherwise throw "manager missing", so we block
        // with a clean "please sign in" toast. Defense-in-depth: logged-out map
        // cards already render "Sign In" rather than Install, but the drawer /
        // other entry points could still reach here.
        const relForPublic = this._releaseIndex?.get?.(key)
        const isPublicRelease = !!(relForPublic?.public_download || props.public_download)
        if (!isPublicRelease && !game.beneos?.cloud?.isLoggedIn?.()) { this.#notifyInstallBlocked("login", key); return }
        const scope = btn?.dataset?.bmapScope || (isReleaseCard ? "release" : "scene")
        const idForLog = isReleaseCard ? key : (props.cloud_release_id || "(unknown)")
        try { console.log("[beneos-bm] native install", idForLog, scope, key) } catch (_) {}
        // Cloud install is ALWAYS the in-house native installer. Scene-packer
        // and the Moulinette marketplace hand-off were both retired in 14.4.4.
        BeneosCloudWindowV2._onCloudBattlemapInstallNative.call(this, event, key, scope)
      } else {
        try { console.warn("[beneos-bm] catalog entry lacks cloud fields", key) } catch (_) {}
        this.#notifyInstallBlocked("unavailable", key)
      }
    }
  }

  // Open button on an installed item/spell card → render the local sheet so the
  // user can jump straight to the imported document instead of hunting for it in
  // the Items directory / compendium. Prefer the world copy (default install
  // target); fall back to the compendium document via the cached id.
  async #onOpenClick(event, btn) {
    event.preventDefault()
    event.stopPropagation()
    const key = btn?.dataset?.assetKey
    const type = btn?.dataset?.assetType
    if (!key || (type !== "item" && type !== "spell")) return
    const flagKey = type === "spell" ? "spellKey" : "itemKey"
    let doc = game.items?.find?.(d => d.getFlag?.("world", "beneos")?.[flagKey] === key)
    if (!doc) {
      const packName = type === "spell" ? "world.beneos_module_spells" : "world.beneos_module_items"
      const id = type === "spell" ? BeneosUtility.getSpellId?.(key) : BeneosUtility.getItemId?.(key)
      if (id) { try { doc = await game.packs?.get?.(packName)?.getDocument?.(id) } catch (_) {} }
    }
    if (doc) { doc.sheet.render(true); return }
    ui.notifications?.warn?.(game.i18n.localize("BENEOS.Cloud.Card.OpenNotFound"))
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
    // Pre-gate once for the whole multi-select. Same kind for all keys, so
    // one prompt covers the entire selection. Cards stay idle until Yes.
    const ok = await BeneosUtility.confirmSystemCompat(type);
    if (!ok) return;
    const keys = [...this.selectedKeys]
    this.#showInstallProgress(keys.length)
    await this.#withSuppressedInfoToasts(async () => {
      for (const k of keys) {
        this.notifyInstallStarted(k)
        if (type === "token") await cloud.importTokenFromCloud?.(k, undefined, false, { gated: true })
        else if (type === "item")  await cloud.importItemFromCloud?.(k, undefined, false, { gated: true })
        else if (type === "spell") await cloud.importSpellsFromCloud?.(k, undefined, false, { gated: true })
        this.#tickInstallProgress()
      }
    })
    this.#hideInstallProgress()
  }

  /* ========== Render lifecycle ========== */

  _onRender(context, options) {
    super._onRender?.(context, options)
    // Mark the window with the active mode so CSS can rearrange the
    // grid (Home swaps sidebar+results for the full-width feed).
    if (this.element) this.element.dataset.bcMode = this.searchMode
    this.#wireSidebarListeners()
    this.#wireResultListeners()
    this.#wireScrollLoader()
    this.#wireLazyImages(this.element, { reset: true })
    this.#setupVirtualization()
    this.#wireVariantListeners()
    this.#refreshFilterInfoIcons()
    this.#injectSelectDividers()
    this.#updateTitleBadge(context)
    this.#injectTitleQuote()
    // Stage 11: tear down the open-splash injected in
    // beneos_module.js's toolbar handler. _onRender runs after the
    // V2 window is in DOM — clean handover with no flicker.
    document.getElementById("beneos-cloud-loading-splash")?.remove()
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
    // rAF-throttle: coalesce the burst of scroll events into one layout read
    // per frame instead of measuring scrollHeight/scrollTop/clientHeight (a
    // forced reflow) on every single scroll event.
    let rafPending = false
    list.addEventListener("scroll", () => {
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        if (this._loadingMore || !this._hasMoreResults) return
        const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
        if (distanceFromBottom < BeneosCloudWindowV2.SCROLL_LOAD_THRESHOLD) this.#loadMore(list)
      })
    }, { passive: true })
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
            catch (err) { console.warn("[Beneos]", err) }
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

  /**
   * Die Kennung der laufenden Suche, oder "" wenn sie zu alt ist.
   *
   * WARUM EINE FRIST
   *
   * Ohne sie klebt die Kennung der Vormittagssuche noch am Install um vier
   * Uhr nachmittags, und die Auswertung liest daraus einen Trichter, den es
   * nie gab. Die Frist ist grosszuegig genug fuer den ueblichen Weg
   * (suchen, stoebern, aufklappen, installieren) und kurz genug, dass eine
   * liegengebliebene Sitzung nichts mehr faelscht.
   *
   * Sie wird bewusst nicht bei jedem Klick verlaengert. Die Kennung soll die
   * SUCHE beschreiben, nicht die Anwesenheit im Fenster.
   */
  static ANALYTICS_SEARCH_TTL_MS = 10 * 60 * 1000

  #analyticsSearchId() {
    try {
      const s = this._analyticsSearch
      if (!s?.id || !s?.ts) return ""
      if (Date.now() - s.ts > BeneosCloudWindowV2.ANALYTICS_SEARCH_TTL_MS) return ""
      return s.id
    } catch (_) { return "" }
  }

  /* ========== Lazy thumbnails (perf) ========== */

  // One shared IntersectionObserver loads card/scene/rail thumbnails only as
  // they approach the viewport, then unobserves each image the moment its load
  // is triggered. This replaces native loading="lazy" on the (potentially
  // many hundreds of) result cards: native lazy keeps every pending image
  // registered and re-evaluates them on each layout pass, which showed up in
  // performance traces as multi-second IntersectionObserver::computeIntersections.
  // Here only not-yet-triggered, viewport-near images are ever observed.
  #ensureLazyObserver() {
    if (this._lazyObserver) return this._lazyObserver
    this._lazyObserver = new IntersectionObserver((entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const img = entry.target
        obs.unobserve(img)
        const src = img.dataset?.src
        if (src) img.src = src
        img.removeAttribute("data-bc-lazy")
      }
    }, { root: null, rootMargin: "300px" })
    return this._lazyObserver
  }

  // Observe every not-yet-loaded lazy image under `root`. Pass reset=true on a
  // full re-render to drop stale observations of replaced DOM nodes; pass
  // reset=false when appending new cards so existing observations stay intact.
  #wireLazyImages(root = this.element, { reset = false } = {}) {
    if (reset && this._lazyObserver) {
      this._lazyObserver.disconnect()
      this._lazyObserver = null
    }
    const scope = root || this.element
    if (!scope) return
    const obs = this.#ensureLazyObserver()
    for (const img of scope.querySelectorAll("img[data-bc-lazy]")) obs.observe(img)
  }

  /* ========== Virtualization / windowing (list mode, perf) ========== */

  // Keep only a window of cards (visible viewport + overscan) actually rendered;
  // every other card stays in the DOM but is display:none, so the browser does
  // no layout/style/intersection work for it. Off-window cards are NOT removed
  // from the DOM, so their per-card listeners, selection state, loaded images
  // and install-progress class toggles (which target nodes via
  // querySelector[data-asset-key]) all keep working untouched. Off-window space
  // is reserved with list padding (not spacer elements) so the flex row-gap math
  // stays exact and the scrollbar geometry is unchanged. List mode only; grid
  // mode renders every card as before.
  #teardownVirtualization() {
    const st = this._virt
    if (!st) return
    try {
      const list = st.list
      if (list) {
        list.style.position = st.origPosition ?? ""
        list.style.flex = st.origFlex ?? ""
        list.style.height = st.origHeight ?? ""
        for (const r of st.rows) r.el.style.display = ""
        st.topSpacer?.remove()
        st.bottomSpacer?.remove()
        if (st.onScroll) list.removeEventListener("scroll", st.onScroll)
      }
    } catch (e) { /* best-effort */ }
    this._virt = null
  }

  #setupVirtualization() {
    this.#teardownVirtualization()
    if (!BeneosCloudWindowV2.VIRTUALIZE) return
    const list = this.element?.querySelector(".bc-result-list")
    if (!list) return
    if (list.classList.contains("bc-view-grid")) return   // list mode only
    if (!list.clientHeight) return                          // not laid out yet
    const rowEls = [...list.querySelectorAll(".bc-result-card, .bc-result-divider")]
    if (rowEls.length < BeneosCloudWindowV2.VIRTUALIZE_MIN_ROWS) return
    // The list is `flex: 1 1 auto` with no definite height: in this app shell it
    // grows to its content height instead of being a fixed-height scroll
    // viewport, so a large reserve-padding would inflate it. Pin it to the real
    // available height (parent box bottom minus the list's own top, i.e. minus
    // the results-meta header) and take it out of flex so the height is
    // authoritative. The reserve-padding then only adds scrollable content.
    const parentRect = list.parentElement.getBoundingClientRect()
    const viewportH = Math.max(100, Math.round(parentRect.bottom - list.getBoundingClientRect().top))
    const origPosition = list.style.position
    if (getComputedStyle(list).position === "static") list.style.position = "relative"
    // Single read pass while every row is still visible -> one reflow.
    const rows = rowEls.map(el => ({ el, top: el.offsetTop, h: el.offsetHeight }))
    const total = list.scrollHeight
    const cs = getComputedStyle(list)
    const gap = parseFloat(cs.rowGap) || 0
    const padTop = parseFloat(cs.paddingTop) || 0
    const padBottom = parseFloat(cs.paddingBottom) || 0
    // Reserve off-window space with real child elements (NOT padding): padding
    // counts toward the element's own box height (box-sizing: border-box), so a
    // multi-thousand-px reserve-padding would inflate the viewport. Spacer
    // children add to scrollHeight only, keeping clientHeight = the pinned
    // viewport.
    const mkSpacer = () => { const d = document.createElement("div"); d.className = "bc-virt-spacer"; d.setAttribute("aria-hidden", "true"); d.style.flex = "0 0 auto"; d.style.width = "1px"; d.style.pointerEvents = "none"; d.style.display = "none"; return d }
    const topSpacer = mkSpacer()
    const bottomSpacer = mkSpacer()
    list.insertBefore(topSpacer, list.firstChild)
    list.appendChild(bottomSpacer)
    const st = {
      list, rows, total, gap, padTop, padBottom, topSpacer, bottomSpacer,
      origPosition, origFlex: list.style.flex, origHeight: list.style.height,
      firstShown: -1, lastShown: -1, rafPending: false, onScroll: null
    }
    list.style.flex = "none"
    list.style.height = viewportH + "px"
    this._virt = st
    st.onScroll = () => {
      if (st.rafPending) return
      st.rafPending = true
      requestAnimationFrame(() => { st.rafPending = false; this.#computeVirtualWindow() })
    }
    list.addEventListener("scroll", st.onScroll, { passive: true })
    this.#computeVirtualWindow()
  }

  #computeVirtualWindow() {
    const st = this._virt
    if (!st) return
    const { list, rows, total } = st
    const over = BeneosCloudWindowV2.VIRTUALIZE_OVERSCAN_PX
    const vTop = list.scrollTop - over
    const vBot = list.scrollTop + list.clientHeight + over
    let first = -1, last = -1
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.top + r.h >= vTop && r.top <= vBot) { if (first < 0) first = i; last = i }
    }
    if (first < 0) { first = 0; last = 0 }
    if (first === st.firstShown && last === st.lastShown) return
    st.firstShown = first; st.lastShown = last
    const obs = this._lazyObserver
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i].el
      const inWin = i >= first && i <= last
      if (inWin) {
        if (el.style.display === "none") {
          el.style.display = ""
          if (obs) for (const img of el.querySelectorAll("img[data-bc-lazy]")) obs.observe(img)
        }
      } else if (el.style.display !== "none") {
        if (obs) for (const img of el.querySelectorAll("img[data-bc-lazy]")) obs.unobserve(img)
        el.style.display = "none"
      }
    }
    // Reserve the off-window space with padding (offsetTop already accounts for
    // the list's own padding + row gaps, so this keeps content positions exact).
    // Reserve off-window space with the spacer children. offsetTop already
    // accounts for the list's padding and inter-row gaps; one extra flex gap
    // appears between a shown spacer and its adjacent visible row, so subtract
    // one gap. Spacers hide entirely at the list ends (no gap then).
    const { topSpacer, bottomSpacer, gap, padTop, padBottom } = st
    if (first > 0) {
      topSpacer.style.height = Math.max(0, rows[first].top - padTop - gap) + "px"
      topSpacer.style.display = ""
    } else {
      topSpacer.style.display = "none"
    }
    const lastRow = rows[last]
    if (last < rows.length - 1) {
      bottomSpacer.style.height = Math.max(0, total - padBottom - gap - (lastRow.top + lastRow.h)) + "px"
      bottomSpacer.style.display = ""
    } else {
      bottomSpacer.style.display = "none"
    }
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
        this.#onVariantClick(btn)
      })
    })
    region.querySelectorAll(".bc-variant-thumb[draggable='true']").forEach(btn => {
      btn.addEventListener("dragstart", (event) => this.#onVariantDragStart(event, btn))
    })
    // Async side-channel: probe whether each installed Top-Down variant has
    // its -top.webp on disk. The result is written back to the tile as a
    // data-bc-topdown-missing flag so the synchronous click + dragstart
    // handlers can decide between regular swap vs. reinstall path without
    // their own HEAD round-trip. Fire-and-forget; tiles whose probe is still
    // pending behave as "present" (the post-drop drain in beneos_cloud.js
    // does a final FS check anyway).
    this.#probeVariantTopAssets(region)
  }

  // Per-tile HEAD-probe for the -top.webp counterpart of every installed
  // Top-Down variant. Reads the canonical -token.webp path from the
  // BeneosUtility.beneosTokens cache (filled at startup); when the cache
  // has no entry for a variant (cloud-only / not installed) the tile is
  // skipped because the cloud-pending drop pipeline will fetch the asset
  // fresh anyway.
  async #probeVariantTopAssets(region) {
    const tiles = region.querySelectorAll(
      ".bc-variant-thumb[data-variant-style='topdown'][data-actor-id]:not([data-actor-id=''])"
    )
    if (!tiles.length) return
    const missingTooltip = game.i18n.localize("BENEOS.TokenMenu.TopDownAssetMissing")
      || "Top-Down asset missing — drag/click triggers a reinstall."
    await Promise.allSettled(Array.from(tiles).map(async (btn) => {
      const assetKey = btn.dataset.assetKey
      const variantIdx = btn.dataset.variantIndex
      if (!assetKey || !variantIdx) return
      const fullId = `${assetKey}_${variantIdx}`
      const cacheEntry = BeneosUtility.beneosTokens?.[fullId]
      const tokenPath = cacheEntry?.token
      if (!tokenPath || !tokenPath.includes("-token.webp")) return
      const topPath = tokenPath.replace("-token.webp", "-top.webp")
      try {
        const url = topPath.startsWith("/") ? topPath : `/${topPath}`
        const res = await fetch(url, { method: "HEAD" })
        if (!res.ok) {
          btn.dataset.bcTopdownMissing = "true"
          btn.dataset.tooltip = missingTooltip
        }
      } catch (e) {
        btn.dataset.bcTopdownMissing = "true"
        btn.dataset.tooltip = missingTooltip
      }
    }))
  }

  // Click-router: a Top-Down tile flagged as missing triggers a silent
  // reinstall of the whole token (the cloud refetches and writes the
  // -top.webp). Otherwise we keep the original behaviour (hero swap +
  // active-outline toggle).
  #onVariantClick(btn) {
    const style = btn.dataset.variantStyle || "tokenized"
    if (style === "topdown" && btn.dataset.bcTopdownMissing === "true") {
      const assetKey = btn.dataset.assetKey
      if (assetKey && game.beneos?.cloud?.importTokenFromCloud) {
        try {
          ui.notifications?.info?.(
            game.i18n.localize("BENEOS.TokenMenu.TopDownReinstallStarted")
            || "Beneos: reinstalling Top-Down variant from cloud…"
          )
        } catch (e) { /* notifications not ready */ }
        game.beneos.cloud.importTokenFromCloud(assetKey).catch(err =>
          console.warn("[Beneos] Top-Down reinstall failed", err))
        return
      }
    }
    this.#selectVariant(btn)
  }

  // Hero swap + active-outline toggle + counter update. All three are
  // direct DOM mutations — no re-render — so the drawer's scroll position
  // and other state stay put. The hero img is reused across variants by
  // simply swapping its src to the clicked thumbnail's URL.
  #selectVariant(btn) {
    const root = this.element
    if (!root) return
    const idx = btn.dataset.variantIndex
    const style = btn.dataset.variantStyle || "tokenized"
    const newImg = btn.querySelector("img")
    const heroImg = root.querySelector("[data-bc-drawer-hero] img")
    if (heroImg && newImg) heroImg.src = newImg.src
    root.querySelectorAll(".bc-variant-thumb").forEach(t => {
      t.classList.toggle("bc-variant-active", t === btn)
    })
    const counter = root.querySelector("[data-bc-variant-counter]")
    if (counter) {
      // Top-Down Stage 3: counter format adapts to single-variant
      // tokens (SRD creatures with nbVariants=1 just show the style
      // label since there's nothing to count). For multi-variant
      // tokens the format is "<i> · <Style> / <total>".
      const totalNum = parseInt(counter.dataset.bcVariantTotal, 10) || 1
      const styleLabel = style === "topdown" ? "TOP" : "2.5D"
      counter.textContent = (totalNum > 1)
        ? `${idx} · ${styleLabel} / ${totalNum}`
        : styleLabel
    }
  }

  // Drag a specific variant — same shape as the card-level local-drag in
  // #onCardDragStart, but pointed at the variant's actor instead of the
  // primary actor. Reuses the Wave B-5e-fix-3 pattern of setting a clean
  // 56×56 thumbnail as the drag image so the cursor carries something
  // recognizable instead of a snapshot of the button element.
  // Why a cloud download can't happen right now, or null if it can. "offline"
  // and "login" are universal blockers (no fetch is possible); "patreon" is
  // per-asset (the card/variant carries data-bc-locked). Free + already-cloud-
  // available assets are never locked, so this never false-blocks them.
  #installBlockReason(type, el) {
    const cloud = game.beneos?.cloud
    // 14.4.8: nur der Server blockt. Der Katalogzustand stand hier bis dahin
    // gleichberechtigt daneben und hat Installationen verhindert, die
    // funktioniert haetten: der Installer arbeitet aus packInfo von
    // api-scenepacker.php auf beneos.cloud und ruft den Katalog-Host
    // www.beneos-database.com an keiner Stelle auf. Ein veralteter Suchindex
    // ist damit kein Grund, einen Download zu verweigern.
    const offline = cloud?.serverOffline === true
    if (offline) return "offline"
    if (!cloud?.isLoggedIn?.()) return "login"
    // Installed asset whose pending update the user is no longer entitled to.
    // The update button carries data-update-locked; block the download and show
    // the patrons-only notice instead of letting it fail silently.
    if (el?.dataset?.updateLocked === "true") return "updatePatron"
    const locked = el?.dataset?.bcLocked === "true"
      || el?.classList?.contains?.("bc-card-locked")
      || el?.closest?.(".bc-result-card")?.classList?.contains?.("bc-card-locked")
    if (locked) return "patreon"
    return null
  }

  // User-facing block feedback: a concise warn notification (no raw red Foundry
  // error) plus a red flash on the related card so the failed download reads
  // visually. The card is matched by asset key.
  #notifyInstallBlocked(reason, assetKey) {
    const key = {
      offline:      "BENEOS.Cloud.Notification.BlockedOffline",
      login:        "BENEOS.Cloud.Notification.BlockedLogin",
      patreon:      "BENEOS.Cloud.Notification.BlockedPatreon",
      updatePatron: "BENEOS.Cloud.Notification.BlockedUpdatePatreon",
      unavailable:  "BENEOS.Cloud.Notification.BlockedUnavailable",
    }[reason] || "BENEOS.Cloud.Notification.BlockedPatreon"
    try { ui.notifications?.warn?.(game.i18n.localize(key)) } catch (_) {}
    this.#flashCardError(assetKey)
  }

  #flashCardError(assetKey) {
    if (!assetKey) return
    const card = this.element?.querySelector?.(`.bc-result-card[data-asset-key="${CSS.escape(assetKey)}"]`)
    if (!card) return
    card.classList.remove("bc-card-install-failed")
    void card.offsetWidth // restart the animation
    card.classList.add("bc-card-install-failed")
    setTimeout(() => card.classList.remove("bc-card-install-failed"), 1200)
  }

  #onVariantDragStart(event, btn) {
    const style = btn.dataset.variantStyle || "tokenized"
    const variantIdx = parseInt(btn.dataset.variantIndex, 10) || 1
    const assetKey = btn.dataset.assetKey
    const actorId = btn.dataset.actorId
    const topdownMissing = style === "topdown" && btn.dataset.bcTopdownMissing === "true"
    // Gate cloud fetches: an installed local variant (actorId, not top-down-
    // missing) always drags; any path that would refetch from the cloud is
    // blocked when offline / signed-out / Patreon-locked, with clear feedback
    // instead of a phantom progress bar + raw import error.
    const needsCloud = !actorId || topdownMissing
    if (needsCloud) {
      const reason = this.#installBlockReason("token", btn)
      if (reason) {
        event.preventDefault()
        this.#notifyInstallBlocked(reason, assetKey)
        return false
      }
    }

    let drag_data = null
    if (actorId && !topdownMissing) {
      // Variant is installed AND (for Top-Down) the -top.webp is on
      // disk — drag the variant's actor and let the preCreateToken
      // hook flip the texture src.
      const compendium = "world.beneos_module_actors"
      const worldActor = game.actors?.get?.(actorId) ||
                         game.actors?.find?.(a => {
                           const flag = a.getFlag?.("world", "beneos")
                           return flag?.actorId === actorId
                         })
      drag_data = worldActor
        ? { type: "Actor", uuid: worldActor.uuid }
        : { type: "Actor", pack: compendium, uuid: `Compendium.${compendium}.${actorId}` }
      if (style === "topdown") drag_data.beneosForceStyle = "topdown"
      BeneosUtility._pendingDropStyle = style
    } else if (assetKey && topdownMissing) {
      // Variant is installed but its -top.webp is missing from disk.
      // Route through the cloud-pending pipeline so the import refetches
      // the token (server should now ship `top.image64`) and the post-
      // import drain places the variant in Top-Down mode.
      drag_data = {
        type: "Actor",
        beneosCloudPending: true,
        beneosTokenKey: assetKey,
        beneosVariantIndex: variantIdx,
        beneosForceStyle: "topdown"
      }
      try {
        ui.notifications?.info?.(
          game.i18n.localize("BENEOS.TokenMenu.TopDownReinstallStarted")
          || "Beneos: reinstalling Top-Down variant from cloud…"
        )
      } catch (e) { /* notifications not ready */ }
    } else if (assetKey) {
      // Stage 5 path — variant is NOT installed yet. Fire the
      // beneosCloudPending drag-install pipeline (Wave B-1d/B-9)
      // with the chosen variant index + style; handlePendingCanvasDrop
      // and drainPendingCanvasDrops in beneos_cloud.js apply both
      // when the install completes.
      drag_data = {
        type: "Actor",
        beneosCloudPending: true,
        beneosTokenKey: assetKey,
        beneosVariantIndex: variantIdx,
        beneosForceStyle: style
      }
    } else {
      event.preventDefault()
      return false
    }
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
        this._textSearchTimer = setTimeout(async () => {
          this._textFilter = textInput.value || ""
          // Wave B-5e-fix-4: filter change -> back to first page.
          this.#resetPagination()
          const leftBundles = this.#maybeAutoSwitchBmapView("text")   // Task 4
          // AWAITED on purpose. The render is what computes the match count, and
          // the event below reports it; firing the event first reported the
          // count of the PREVIOUS search.
          await this.#renderResults(leftBundles ? ["sidebar", "results"] : ["results"])
          try {
            if (this._textFilter) {
              // Eine Kennung je Suche, damit Suche, Aufklappen und
              // Installieren als EIN Vorgang lesbar werden. Bisher waren das
              // drei unverbundene Ereignisse: man sah, dass gesucht wurde,
              // und man sah, dass installiert wurde, aber nie, ob das eine
              // aus dem anderen folgte. Die Frage "fuehrt unsere Suche zum
              // Fund" war damit nicht beantwortbar.
              //
              // Kein Personenbezug: eine Zufallskette, die mit dem Fenster
              // stirbt, und ausserdem der Grund fuer die Frist unten.
              this._analyticsSearch = {
                id: foundry.utils.randomID(10),
                ts: Date.now()
              }
              BeneosAnalytics.track("search_query", {
                search_id: this._analyticsSearch.id,
                query: BeneosAnalytics.sanitize(this._textFilter, 64),
                tab: this.searchMode,
                // Whether the search found anything. Zero is the interesting
                // value: it is a customer looking for something we do not have,
                // or do not have under the name they used.
                result_count: this._lastMatchCount ?? null,
                shown_count: this._lastCardCount ?? null
              })
            }
          } catch (_) {}
        }, 300)
      })
    }

    root.querySelectorAll(".beneos-selector").forEach(sel => {
      sel.addEventListener("change", () => {
        // V7: the Show filter (installation-selector) persists across tab
        // switches on the instance. Capture the new value before the
        // debounced re-render so #applyDropdownFilters reads consistent
        // state. Other dropdowns stay DOM-only and are read on render.
        if (sel.id === "installation-selector") {
          this.showFilter = sel.value || "any"
        }
        // Wave B-8i-2: update the info icon next to this dropdown
        // immediately so the tooltip reflects the new selection without
        // waiting for the debounced render.
        this.#refreshFilterInfoIcons()
        clearTimeout(this._dropdownTimer)
        this._dropdownTimer = setTimeout(() => {
          // Wave B-5e-fix-4: dropdown change -> back to first page.
          this.#resetPagination()
          this.#maybeAutoSwitchBmapView(sel.id || "")   // Task 4
          this.#renderResults(["results"])
          try {
            BeneosAnalytics.track("filter_applied", {
              filter_type: BeneosAnalytics.sanitize(sel.id || "", 32),
              filter_value: BeneosAnalytics.sanitize(sel.value || "", 48),
              tab: this.searchMode
            })
          } catch (_) {}
        }, 100)
      })
    })

    // Top-Down Stage 2: install-style radio in the token sidebar.
    // Persists the choice as a client-scope setting; no re-render
    // needed since the result-card list doesn't depend on it.
    root.querySelectorAll('input[name="beneos-install-style"]').forEach(input => {
      input.addEventListener("change", () => {
        if (!input.checked) return
        try {
          game.settings.set(BeneosUtility.moduleID(), "beneos-default-install-style", input.value)
        } catch (e) { /* setting not registered yet */ }
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
        if (globalThis.BeneosUtility?.isDebug?.()) console.log(`[Beneos V2] CR slider commit: min=${this.crMin} max=${this.crMax}`)
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
    // (input event + debounced commit + DOM-re-query in setTimeout), and like
    // CR the input value is a position, not the filtered number: the track is
    // logarithmic because item prices span four orders of magnitude.
    const goldMinEl = root.querySelector("#bc-gold-min")
    const goldMaxEl = root.querySelector("#bc-gold-max")
    const goldDisplay = root.querySelector("#bc-gold-display")
    const goldFill = root.querySelector("[data-bc-slider-fill='gold']")
    // Read once. Resolving it inside the handler would rescan the whole item
    // catalogue on every tick of the drag.
    const goldMaxAvailable = Number(goldMinEl?.dataset?.bcGoldMaxAvailable) || this.#getMaxItemPrice()
    const updateGoldDisplay = () => {
      if (!goldMinEl || !goldMaxEl) return
      const loPos = parseInt(goldMinEl.value, 10) || 0
      const hiPos = parseInt(goldMaxEl.value, 10) || 0
      if (goldDisplay) {
        goldDisplay.textContent = `${this.#formatGold(this.#goldPosToValue(loPos, goldMaxAvailable))} - ${this.#formatGold(this.#goldPosToValue(hiPos, goldMaxAvailable))}`
      }
      if (goldFill) {
        // The strip follows the positions, not the amounts, so it stays in
        // step with where the thumbs actually are.
        const steps = parseInt(goldMaxEl.max, 10) || 1
        goldFill.style.left = `${(loPos / steps) * 100}%`
        goldFill.style.right = `${100 - (hiPos / steps) * 100}%`
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
        // Positions in, gold out. The filter itself keeps comparing real
        // amounts, so nothing downstream needs to know about the track.
        this.goldMin = this.#goldPosToValue(parseInt(liveMin.value, 10) || 0, goldMaxAvailable)
        const hi = this.#goldPosToValue(parseInt(liveMax.value, 10) || 0, goldMaxAvailable)
        this.goldMax = hi > 0 ? hi : null
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
        this.#maybeAutoSwitchBmapView("bmap-biome")   // Task 4
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
    // Origin Set Bonuses: open the Beneos Codex on the item tab's Origins
    // sub-tab, where the per-origin set-bonus rules live (same pattern as the
    // Loot/Shop buttons below).
    const originBtn = root.querySelector("#bc-origin-set-bonuses")
    if (originBtn) originBtn.addEventListener("click", () => {
      game.beneos?.codex?.open?.("items", "origins")
    })
    const tierBtn = root.querySelector("#bc-tier-upgrade-mechanic")
    if (tierBtn) tierBtn.addEventListener("click", comingSoon)
    // Loot Generator: open the Beneos Codex on the item-codex Loot tab (which
    // embeds the generator) instead of a separate standalone window, so it
    // lives in one consistent place.
    const lootBtn = root.querySelector("#bc-loot-generator")
    if (lootBtn) lootBtn.addEventListener("click", () => {
      game.beneos?.codex?.open?.("items", "loot")
    })
    // Magic Shop Generator: same, opens the item-codex Shop tab.
    const shopBtn = root.querySelector("#bc-magic-shop")
    if (shopBtn) shopBtn.addEventListener("click", () => {
      game.beneos?.codex?.open?.("items", "shop")
    })
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

    // Punkt 5: keep a single source of truth for the result-list scroll
    // position. The list is recreated on every results re-render, so we record
    // the user's scroll here and restore from it in #renderResultsPreserveScroll
    // (used only by the drawer-open / close / scene-load renders). Tab, filter
    // and view switches use plain #renderResults and reset to the top, calling
    // resetResultScroll() to clear the saved value. The _restoringScroll guard
    // stops the programmatic restore's own scroll events from clobbering it.
    const scrollList = resultsRegion.querySelector(".bc-result-list")
    if (scrollList) {
      if (this._resultListScrollTop == null) this._resultListScrollTop = 0
      scrollList.addEventListener("scroll", () => {
        if (!this._restoringScroll) this._resultListScrollTop = scrollList.scrollTop
      }, { passive: true })
    }

    // Bulk-install kebab menu: close it when the user clicks anywhere outside
    // the menu (the native <details> element only auto-closes when the user
    // clicks the summary again, which is unintuitive). Attached once per
    // window instance via a flag, so subsequent re-renders don't pile up
    // listeners.
    if (!this._bulkOutsideWired) {
      this._bulkOutsideWired = true
      document.addEventListener("pointerdown", (ev) => {
        const ownRoot = this.element
        if (!ownRoot) return
        const open = ownRoot.querySelectorAll("details.bc-bulk-menu[open]")
        if (!open.length) return
        for (const menu of open) {
          if (!menu.contains(ev.target)) menu.open = false
        }
      }, true)
    }

    // 1) Card click → open detail drawer (unless click landed on an install
    //    button, which has its own action).
    // Wave B-8d-fix-10: opening the drawer for bmaps loads a much larger
    // hero image than the card thumbnail, which can show a brief lag.
    // Wrap the render in the same loading-spinner pattern as tab switch
    // so the user gets feedback for any "click that triggers a heavy
    // render" — not just navigation.
    resultsRegion.querySelectorAll(".bc-result-card").forEach(card => {
      // async because we await the compendium-description loader before the
      // drawer re-renders (see #ensureLocalFullDescriptionLoaded below).
      card.addEventListener("click", async (event) => {
        if (event.target.closest(".bc-action-install")) return
        if (event.target.closest(".bc-action-codex")) return
        if (event.target.closest(".bc-action-open")) return
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
        // Punkt 5: scroll preservation now lives in
        // #renderResultsPreserveScroll, which also covers the async
        // release-scene re-render that previously wiped the restore.
        this.selectedAssetKey = key
        try {
          this._analyticsDrawerOpen = { key, ts: Date.now() }
          BeneosAnalytics.track("result_drawer_open", {
            asset_id: key,
            asset_type: this.searchMode,
            ...(this.#analyticsSearchId() ? { search_id: this.#analyticsSearchId() } : {})
          })
        } catch (_) {}
        this.#showLoading()
        // Task C: yield one frame so the loading overlay actually PAINTS before
        // the (synchronous) re-render runs , otherwise the main thread is busy
        // and the spinner never shows, reading as a freeze.
        await new Promise(r => requestAnimationFrame(() => r()))

        // Lazy-load the full description from the appropriate Beneos
        // compendium pack BEFORE the drawer re-renders. The loader is
        // a no-op for tokens/bmaps and idempotent per (type, key), so
        // re-clicking the same card hits the cache instantly. We swallow
        // errors here — the loader itself logs and falls back to null,
        // and the template hides the block when the cache says null.
        await this.#ensureLocalFullDescriptionLoaded(key, this.searchMode)

        try {
          await this.#renderResultsPreserveScroll(["results"])
        } finally {
          this.#hideLoading()
        }
      })
    })

    // 2) Install / Update buttons.
    // Wave B-5e: handler is shared with #patchCardState (so freshly inserted
    // buttons after an in-place card update get the same behavior).
    resultsRegion.querySelectorAll(".bc-action-install").forEach(btn => {
      btn.addEventListener("click", (event) => this.#onInstallClick(event, btn))
    })

    // Codex button on installed creature cards → open the Creature Codex.
    resultsRegion.querySelectorAll(".bc-action-codex").forEach(btn => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault()
        event.stopPropagation()
        const key = btn.dataset.assetKey
        // Resolve world OR installed-compendium actor (same source as the green
        // "installed" frame), not just game.actors — a compendium-installed
        // creature has no world-directory actor but must still open its codex.
        const actor = (await game.beneos?.codex?.resolveCodexActor?.(key))
          ?? game.beneos?.codex?.findActorByTokenKey?.(key)
        if (!actor) {
          ui.notifications.warn(game.i18n.localize("BENEOS.Cloud.Card.CodexNotFound"))
          return
        }
        game.beneos?.codex?.openForActor?.(actor)
      })
    })

    // Open button on installed item/spell cards → open the local sheet.
    resultsRegion.querySelectorAll(".bc-action-open").forEach(btn => {
      btn.addEventListener("click", (event) => this.#onOpenClick(event, btn))
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
        const leftBundles = this.#maybeAutoSwitchBmapView(tagType === "adventure" ? "bmap-adventure" : "tag")   // Task 4
        let parts = result.parts || ["results"]
        if (leftBundles && !parts.includes("sidebar")) parts = ["sidebar", ...parts]
        if (this.#renderResults) this.#renderResults(parts)
        else this.render({ parts })
      })
    })

    // Wave B-8i-1 / Y4: bulk-install triggers can come from two places —
    // the consolidated kebab menu (.bc-bulk-menu-item) and the prominent
    // header button (.bc-bulk-prominent) that surfaces when the show
    // filter is set to "new" or "updated". Both carry data-bulk-group;
    // a single querySelectorAll handles them with no extra logic, and
    // the kebab-close branch only kicks in when the click came from the
    // menu (closest() returns null for the prominent button).
    resultsRegion.querySelectorAll("[data-bulk-group]").forEach(btn => {
      btn.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        const group = btn.dataset.bulkGroup
        if (!group) return
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
      btn.addEventListener("click", async (event) => {
        event.stopPropagation()
        // Punkt 5: scroll preserve centralized in #renderResultsPreserveScroll
        // so close returns the list to where the user was, not the top.
        this.selectedAssetKey = null
        // Wave B-9-fix-46: closing the drawer also clears multi-select
        // since there's no UI to operate on the set without a drawer.
        this.selectedKeys = new Set()
        this.#showLoading()
        try {
          await this.#renderResultsPreserveScroll(["results"])
        } finally {
          this.#hideLoading()
        }
      })
    })

    // Punkt 4: hover-preview for the drawer's scene thumbnails. They're small;
    // on hover we float a larger copy (already loaded) beside the cursor so the
    // user can judge a scene before installing. Appended to <body> so it
    // escapes the drawer's overflow/containment, and re-used via a fixed id so
    // only one ever exists.
    const bcZoomCleanup = () => { document.getElementById("bc-scene-zoom-preview")?.remove() }
    bcZoomCleanup()
    resultsRegion.querySelectorAll(".bc-scene-thumb[data-bc-zoom]").forEach(thumb => {
      thumb.addEventListener("mouseenter", () => {
        const src = thumb.dataset.bcZoom
        if (!src) return
        bcZoomCleanup()
        const img = document.createElement("img")
        img.id = "bc-scene-zoom-preview"
        img.className = "bc-scene-zoom-preview"
        img.src = src
        document.body.appendChild(img)
        const r = thumb.getBoundingClientRect()
        const W = 294   // Task B: keep in sync with .bc-scene-zoom-preview width
        // Prefer to the left of the drawer; fall back to the right if no room.
        let left = r.left - W - 14
        if (left < 8) left = r.right + 14
        const top = Math.min(window.innerHeight - 20, Math.max(20, r.top + r.height / 2))
        img.style.left = `${Math.max(8, left)}px`
        img.style.top  = `${top}px`
      })
      thumb.addEventListener("mouseleave", bcZoomCleanup)
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

    // Local mode (installed) — Punkt 1, Compendium-as-Truth.
    // BeneosUtility.resolveBeneosDragData prefers the world doc (so Foundry
    // doesn't clone a duplicate world copy on drop, Wave B-1d) and falls
    // back to a V12+ compendium UUID when the world copy was deleted. This
    // replaces the legacy "Compendium.<pack>.<id>" form (V11, unresolvable
    // in V13) and the broken "Item.<comp-id>" world UUID that previously
    // pointed at a non-existent world doc.
    //
    // V2 cards report card.dataset.type as "Actor" or "Item" (5e spells are
    // Item docs). Use this.searchMode to pick the right cache + pack: when
    // the user is on the spell tab, the real docType is "Spell".
    const logicalDocType = docType === "Actor" ? "Actor"
                          : this.searchMode === "spell" ? "Spell"
                          : "Item"
    const drag_data = tokenKey
      ? BeneosUtility.resolveBeneosDragData(logicalDocType, tokenKey)
      : null
    if (!drag_data) {
      ui.notifications?.warn?.(game.i18n.localize("BENEOS.Cloud.Notification.OrphanInstall") || "This Beneos asset is no longer available in the world or compendium — please reinstall it from the Search Engine.")
      event.preventDefault()
      return false
    }
    event.dataTransfer.setData("text/plain", JSON.stringify(drag_data))
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
          await this.render({ parts: ["header", "home", "sidebar", "results"] })
        } catch (err) {
          console.warn("[Beneos]", err)
        } finally {
          this.#hideLoading()
        }
      })
    })
  }

  /* ========== Home tab action handlers ========== */

  static _onOpenPatchlog(event, _target) {
    event.preventDefault()
    try { new BeneosPatchlogWindow().render({ force: true }) }
    catch (err) { console.warn("[Beneos Patchlog] Failed to open:", err) }
  }

  static async _onOpenNewsDetail(event, target) {
    event.preventDefault()
    const card = target.closest?.("[data-news-id]") || target
    const id = card?.dataset?.newsId
    if (id === undefined || id === null || id === "") return
    let news = this._newsCache?.find?.(n => String(n.id) === String(id))
    if (!news) {
      try {
        const fresh = await fetchNewsFeed({ force: true })
        this._newsCache = fresh.news || []
        news = this._newsCache.find(n => String(n.id) === String(id))
      } catch (_e) { /* ignored */ }
    }
    if (!news) return
    try { await markNewsRead(news.id) } catch (_e) { /* ignored */ }

    const formattedDate = (() => {
      try {
        const d = new Date(news.date)
        if (Number.isNaN(d.getTime())) return news.date
        return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      } catch (_e) { return news.date }
    })()

    const html = await foundry.applications.handlebars.renderTemplate(
      "modules/beneos-module/templates/cloud-v2/home/news-detail-modal.hbs",
      { news: { ...news, formattedDate } }
    )

    try {
      await foundry.applications.api.DialogV2.prompt({
        window: { title: news.title || game.i18n.localize("BENEOS.Cloud.Home.News.DetailTitle"), icon: "fas fa-newspaper" },
        content: html,
        classes: ["beneos-cloud-app", "beneos-news-detail-dialog"],
        ok: { label: game.i18n.localize("BENEOS.Cloud.Home.News.Close"), icon: "fas fa-check" },
        rejectClose: false
      })
    } catch (_e) { /* user dismissed */ }

    // Refresh the home tab so the unread highlight clears. Capture the home
    // scroll position before the re-render and restore it after, otherwise the
    // user jumps back to the top every time they close a news article.
    if (this.searchMode === "home") {
      const scroller = this.element?.querySelector?.('[data-bc-region="home"]')
      const savedScroll = scroller?.scrollTop ?? 0
      try {
        await this.render({ parts: ["home"] })
        const restored = this.element?.querySelector?.('[data-bc-region="home"]')
        if (restored && savedScroll > 0) restored.scrollTop = savedScroll
      } catch (err) {
        console.warn("[Beneos Home] Refresh failed:", err)
      }
    }
  }

  static _onSwitchToCategory(event, target) {
    event.preventDefault()
    const tab = target.dataset?.targetTab
    if (!tab) return
    this.searchMode = tab
    this.selectedAssetKey = null
    this.#resetPagination()
    this.#showLoading()
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        try { await this.render({ parts: ["header", "home", "sidebar", "results"] }) }
        catch (err) { console.warn("[Beneos]", err) }
        finally { this.#hideLoading() }
      })
    })
  }

  // Home rail entity tile click: switch to the destination tab AND seed the
  // text search with the entity's name so the user lands directly on the
  // matching card, ready to install. data-target-tab carries the tab, and the
  // tile's display name is read from data-target-name (or the visible label).
  static _onOpenRailEntity(event, target) {
    event.preventDefault()
    const tab = target.dataset?.targetTab
    if (!tab) return
    const name = target.dataset?.targetName
      || target.querySelector?.(".bc-rail-tile-name")?.textContent?.trim()
      || ""
    this.searchMode = tab
    this.selectedAssetKey = null
    this._textFilter = name
    this.#resetPagination()
    this.#showLoading()
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        try { await this.render({ parts: ["header", "home", "sidebar", "results"] }) }
        catch (err) { console.warn("[Beneos]", err) }
        finally { this.#hideLoading() }
      })
    })
  }

  // News CTA: opens the news item's cta_url in a new browser tab.
  // stopPropagation prevents the surrounding news-card data-action
  // (openNewsDetail) from firing as well when the user clicks the
  // inline CTA button inside the card.
  static _onOpenNewsCta(event, target) {
    event.preventDefault()
    event.stopPropagation?.()
    const url = target?.dataset?.newsCtaUrl
    if (!url) return
    try { window.open(url, "_blank", "noopener,noreferrer") }
    catch (err) { console.warn("[Beneos News CTA] Failed to open:", err) }
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
          } catch (err) {
            console.warn("[Beneos]", err)
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
  // Punkt 5: re-render the results part WITHOUT losing the user's scroll
  // position. The detail drawer lives inside the results part, so opening a
  // card (and the async release-scene lazy-load that follows) rebuilds the
  // `.bc-result-list` and would otherwise snap it back to the top. We capture
  // scrollTop before the render and restore it after, plus once more on the
  // next frame as a safety net against late layout. Plain render (no spinner)
  // so it composes with callers that manage their own loading overlay.
  async #renderResultsPreserveScroll(parts = ["results"]) {
    // Restore to the single source of truth (this._resultListScrollTop, kept
    // current by the scroll listener in #wireResultListeners) rather than a
    // per-call capture. Multiple re-renders can overlap (card-click + the
    // async release-scene load) — capturing per call raced and one of them
    // read the freshly-rendered 0, wiping the restore. A shared target +
    // a restoring guard makes every overlapping render converge on the same
    // position.
    const want = this._resultListScrollTop || 0
    try { await this.render({ parts }) }
    catch (err) { console.warn("[Beneos]", err) }
    this._restoringScroll = true
    const restore = () => {
      const list = this.element?.querySelector(".bc-result-list")
      if (list && want > 0) list.scrollTop = want
    }
    restore()
    requestAnimationFrame(() => { restore(); this._restoringScroll = false })
  }

  async #renderResults(parts) {
    // Punkt 5: tab / filter / view switches reset the scroll memory so the
    // next drawer-preserve render doesn't jump to a stale position. The
    // drawer-open/close/scene-load path uses #renderResultsPreserveScroll and
    // bypasses this reset.
    this._resultListScrollTop = 0
    if (this.searchMode === "bmap") {
      this.#showLoading()
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(async () => {
            try { await this.render({ parts }) }
            catch (err) { console.warn("[Beneos]", err) }
            finally { this.#hideLoading(); resolve() }
          })
        })
      })
    }
    return this.render({ parts })
  }

  /**
   * Wave B-8: Beneos Cloud battlemap install. Reads cloud_release_id +
   * release_dir + cloud_scene_slug from the catalog entry, constructs the
   * mini-pack id (release_dir + variant + scene_slug) and hands it to
   * BeneosScenePackerManager.importPackage which spins up Scene-Packer's
   * MoulinetteImporter against signed beneos.cloud URLs. Variant is chosen
   * from the beneos-module setting "battlemap-default-resolution", default
   * 4K when unset. The handler is dispatched from #onInstallClick when the
   * catalog entry has the cloud_* fields; legacy catalog entries still go
   * through Moulinette.
   */
  /**
   * Plan §13: install one battlemap with a chosen scope.
   *   installScope = "scene"   (default — just this mini-pack)
   *                | "pair"    (battlemap + its sibling scenery — two install calls)
   *                | "release" (the full <release_dir>_<variant> pack)
   *
   * Variant: read from setting battlemap-active-resolution when not pinned by
   * the catalog (single-variant releases ignore the setting and use no infix).
   */
  /**
   * Plan §18.7 — native install path. Resolves the same release_dir +
   * variant as _onCloudBattlemapInstall but hands off to
   * BeneosNativeBattlemapInstaller instead of MoulinetteImporter. The
   * native installer downloads + imports without scene-packer in the
   * loop, suppressing the toast spam and the gray wizard.
   */
  static async _onCloudBattlemapInstallNative(_event, bmapKey, installScope = "scene", opts = {}) {
    const dbHolder = game.beneos?.databaseHolder
    const bmapData = dbHolder?.getAll?.("bmap")?.[bmapKey]
    let props = bmapData?.properties || {}
    let releaseDir = String(props.release_dir || "").trim()
    let nbVariants = Number(props.cloud_nb_variants ?? props.nb_variants ?? 0) || 0
    let displayName = bmapData?.name || bmapKey

    // Release-card path: bmapKey === release_dir, no catalog row.
    if (!releaseDir && this._releaseIndex?.get) {
      const r = this._releaseIndex.get(bmapKey)
      if (r) {
        releaseDir = r.release_dir
        nbVariants = Number(r.nb_variants || 0) || 0
        displayName = r.display_name || bmapKey
        installScope = "release"
      }
    }
    // Bundle-member fallback: a bundle-exclusive release may be absent from both
    // the catalog and the release index, but the bundle member carries its own
    // variant_dirs / name / cover. Treat bmapKey as the release_dir directly.
    if (!releaseDir && opts.variantDirs) {
      releaseDir   = String(bmapKey)
      displayName  = opts.displayName || bmapKey
      installScope = "release"
    }
    if (!releaseDir) {
      ui.notifications.warn(`Catalog entry "${bmapKey}" is missing release_dir.`)
      return
    }

    const isSingle = nbVariants === 1
    let variant = ""
    if (!isSingle) {
      variant = "4K"
      try {
        const v = game.settings.get("beneos-module", "battlemap-active-resolution")
        if (v === "HD" || v === "4K") variant = v
      } catch (_) {}
    }
    const variantLabel = isSingle ? "" : ` (${variant})`

    // Resolve coverUrl from release index when available so the install
    // window's hero shows the manually-curated pack cover. Task 6: the release
    // cover is shown for scene installs too. If the release index isn't loaded
    // yet (e.g. user jumped straight to Individual Maps), pull it now, and fall
    // back to the scene's own catalog thumbnail so the hero always has an image.
    if (!this._releaseIndex && typeof this.#ensureReleasesLoaded === "function") {
      try { await this.#ensureReleasesLoaded() } catch (_) {}
    }
    const releaseEntry = this._releaseIndex?.get?.(releaseDir) || null
    let coverUrl = releaseEntry
      ? (variant === "HD" ? (releaseEntry.cover_url_hd || releaseEntry.cover_url_4k)
                          : (releaseEntry.cover_url_4k || releaseEntry.cover_url_hd))
      : null
    if (!coverUrl && opts.coverUrl) coverUrl = opts.coverUrl
    if (!coverUrl && props.thumbnail) {
      coverUrl = `https://www.beneos-database.com/data/battlemaps/thumbnails/${props.thumbnail}`
    }

    // packId = the ACTUAL on-disk pack dir (the WHOLE release). list_releases
    // returns variant_dirs (post-greenfield beneos_<pack_slug>_foundry_<variant_lc>);
    // use it instead of constructing <release_dir>_<VARIANT>, which no longer
    // exists on disk and threw "Package not found". Legacy construction stays
    // as a fallback.
    const vdirs = (releaseEntry && releaseEntry.variant_dirs) || props.variant_dirs || opts.variantDirs || null
    let packId = null
    if (vdirs && typeof vdirs === "object") {
      packId = isSingle
        ? (vdirs.SINGLE || vdirs["4K"] || vdirs["HD"] || Object.values(vdirs)[0])
        : (vdirs[variant] || vdirs["4K"] || vdirs["HD"] || vdirs.SINGLE || Object.values(vdirs)[0])
    }
    if (!packId) packId = isSingle ? releaseDir : `${releaseDir}_${variant}`

    // Punkt 7: scene scope. For an individual map ("Install") we install ONLY
    // the selected scene plus its sibling (battlemap + scenery), not the whole
    // release. We pass their cloud_scene_slugs to the installer, which reads
    // the pack's per-scene manifests (.scenes/<slug>.json) to fetch exactly
    // those scenes' assets + documents through the same robust pipeline. The
    // release card and the "Install entire release" button keep scope=release
    // (no slugs -> full pack).
    let sceneSlugs = null
    if (installScope === "scene") {
      const ownSlug = String(props.cloud_scene_slug || "").trim()
      const slugs = []
      if (ownSlug) slugs.push(ownSlug)
      const siblingKey = String(props.sibling || "").trim()
      if (siblingKey) {
        const sibSlug = String(dbHolder?.getAll?.("bmap")?.[siblingKey]?.properties?.cloud_scene_slug || "").trim()
        if (sibSlug) slugs.push(sibSlug)
      }
      if (slugs.length) sceneSlugs = slugs
    }

    const NativeInstaller = globalThis.BeneosNativeBattlemapInstaller
    if (!NativeInstaller) {
      ui.notifications.error("BeneosNativeBattlemapInstaller is not loaded")
      return
    }
    // Teil 2: hand the installer the release metadata it needs to (a) detect a
    // stale install vs the online updated_date/signature, (b) decide whether to
    // re-download the source files, and (c) persist the install record so the
    // installed-marker + update state render afterwards.
    const record = {
      releaseDir,
      variant:          isSingle ? "" : variant,
      assetId:          String(releaseEntry?.cloud_release_id || props.cloud_release_id || ""),
      contentSignature: String(releaseEntry?.content_signature || ""),
      updatedDate:      this.#releaseDateInfo(releaseDir)?.updatedDate || "",
    }
    let inst = null
    try {
      inst = await NativeInstaller.install({
        packageId: packId,
        label:     displayName + variantLabel,
        coverUrl,
        sceneSlugs,
        record,
        // Bundle "install entire bundle" pre-decides overwrite per release, so
        // it forces it here to skip the installer's own per-release dialog.
        overwrite: opts.overwrite === true,
      })
    } catch (err) {
      console.warn("BeneosCloudWindowV2 | native install failed", { packId, sceneSlugs, err })
      ui.notifications.error(`Native install failed for ${displayName}: ${err?.message || err}`)
      return null
    }
    // Teil 3: refresh the installed-marker + update state for this release.
    // Skip when the user cancelled the overwrite dialog (nothing changed).
    if (inst && !inst._cancelled) {
      try { await this.#refreshAfterBmapInstall?.(releaseDir) } catch (_) {}
      // Broadcast a generic release-installed signal so other systems (e.g. the
      // Getting Started tour's auto-start-after-install bridge) can react
      // without depending on Scene-Packer. Best-effort, never throws.
      try {
        Hooks.callAll("beneos.releaseInstalled", {
          releaseDir,
          displayName,
          scope: installScope,
          variant: isSingle ? "" : variant,
          // The scenes this run imported. releaseDir is the catalog key
          // ("bm_0113"), NOT the on-disk asset folder ("113_arasek_stockyard"),
          // so it cannot be matched against asset paths. The scene ids can, and
          // they let the static-switch probe cache refresh just this release.
          sceneIds: (inst._importedScenes || []).map(s => String(s.id)).filter(Boolean),
        })
      } catch (_) {}
    }
    return inst
  }

  /**
   * Trash button on an installed release card: the counter-move to the install
   * button next to it. Confirms, removes the release from this world, frees the
   * disk space, then refreshes the card through the same path an install uses so
   * the marker disappears immediately.
   */
  static async _onCloudReleaseUninstall(event, target) {
    event.preventDefault()
    event.stopPropagation()   // the card itself is clickable; do not open the drawer

    if (!game.user?.isGM) {
      ui.notifications?.warn?.(game.i18n.localize("BENEOS.Cloud.Uninstall.GmOnly")
        || "Only a Gamemaster can remove a release from the world.")
      return
    }

    const releaseDir  = String(target?.dataset?.releaseDir || "")
    const packageId   = String(target?.dataset?.packageId || "")
    const variant     = String(target?.dataset?.releaseVariant || "")
    const displayName = String(target?.dataset?.releaseName || releaseDir)
    if (!releaseDir || !packageId) {
      ui.notifications?.error?.(game.i18n.localize("BENEOS.Cloud.Uninstall.NoTarget")
        || "Could not work out which release to remove.")
      return
    }

    const Uninstaller = globalThis.BeneosNativeUninstaller
    if (!Uninstaller) {
      ui.notifications?.error?.("BeneosNativeUninstaller is not loaded")
      return
    }

    if (!(await Uninstaller.confirm({ name: displayName }))) return

    let inst = null
    try {
      inst = await Uninstaller.uninstall({ releaseDir, variant, packageId, label: displayName })
    } catch (err) {
      console.error("BeneosCloudWindowV2 | uninstall failed", err)
      ui.notifications?.error?.(game.i18n.localize("BENEOS.Cloud.Uninstall.Failed")
        || "Removing the release failed. See the browser console.")
      return
    }

    try { await this.#refreshAfterBmapInstall?.(releaseDir) } catch (_) {}
    try { Hooks.callAll("beneos.releaseUninstalled", { releaseDir, displayName, variant }) } catch (_) {}
    return inst
  }

  static _onOpenLogin(_event, _target) {
    const login = new BeneosCloudLogin("searchEngineV2")
    login.render()
  }

  static _onOpenCloudSettings(_event, _target) {
    BeneosUtility.openPostInNewTab?.("https://beneos.cloud/", {})
  }

  // Settings modal companion. Single instance per click — if one is
  // already open, just bring it to focus instead of stacking copies.
  // Holt den Katalog sofort neu, statt den Nutzer auf einen Neustart der Welt zu
  // verweisen. Bis 14.4.7 war das Neuladen der einzige Weg aus dem Zustand, weil
  // loadDatabaseFiles() nur im ready-Hook lief.
  static async _onRetryCatalog(_event, target) {
    const holder = game.beneos?.databaseHolder
    if (!holder?.erneutVersuchen) return
    if (target) target.disabled = true
    try {
      await holder.erneutVersuchen()
    } finally {
      if (target) target.disabled = false
    }
  }

  static _onOpenSettings(_event, _target) {
    const existing = Object.values(foundry.applications.instances ?? {})
      .find(a => a instanceof BeneosCloudSettingsV2)
    if (existing) {
      existing.bringToFront?.()
      return
    }
    new BeneosCloudSettingsV2().render(true)
  }

  static _onOpenLgc(_event, _target) {
    if (!game.user?.isGM) return
    const opener = game.beneos?.openLgc
    if (typeof opener === "function") opener()
    else console.warn("Beneos | LGC opener not yet ready (boot still in progress).")
  }

  // Opens the general Creature Codex hub (origins etc.) via the stable
  // game.beneos.codex.open() API published by beneos-codex-init.
  static _onOpenCodex(_event, _target) {
    const open = game.beneos?.codex?.open
    if (typeof open === "function") open()
    else console.warn("Beneos | Codex opener not yet ready (boot still in progress).")
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

  // X on the results "Show <filter>" chip: clear the global Show filter back to
  // "Any". Sync the sidebar dropdown's value directly (so the tab's select
  // updates too) WITHOUT re-rendering the whole sidebar, which would wipe the
  // other DOM-only filters. Only the results part re-renders.
  static _onClearShowFilter(event, _target) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    this.showFilter = "any"
    const sel = this.element?.querySelector?.("#installation-selector")
    if (sel) sel.value = "any"
    try { this.#refreshFilterInfoIcons() } catch (_e) {}
    this.#resetPagination()
    this.#renderResults(["results"])
  }

  // Stage 14: bulk install cancellation. Sets a flag on the active
  // _bulkInstall state object; the running loop in #onBulkInstallClick
  // reads it before each iteration and breaks cleanly. The currently
  // in-flight asset is allowed to finish (the import pipeline is atomic
  // per asset; aborting mid-pipeline would leave half-written compendium
  // entries / lock files). All assets that haven't started yet stay in
  // their "not installed" state and remain installable.
  static _onCancelBulkInstall(event, _target) {
    event.preventDefault()
    if (!this._bulkInstall || this._bulkInstall.cancelled) return
    this._bulkInstall.cancelled = true
    const el = this.element?.querySelector?.(".bc-install-progress")
    if (el) el.dataset.state = "cancelling"
    ui.notifications?.info?.(game.i18n.localize("BENEOS.Cloud.BulkInstall.Cancelling"))
  }

  // Manual escape hatch when the cloud catalog looks lopsided (Out-of-Sync
  // pills everywhere, missing categories, etc.). Resets the Tier-3 delta
  // cursor to zero, re-fetches the full content list, and re-renders the
  // results area. Same effect as the auto-heal in #buildCards, just user-
  // triggered.
  static async _onResyncCatalog(event, _target) {
    event.preventDefault()
    try {
      await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-last-content-fetch-server-time", 0)
    } catch (e) { /* setting not registered yet */ }
    try {
      ui.notifications?.info?.(game.i18n.localize("BENEOS.Cloud.Filter.ResyncStarted")
        || "Beneos: re-syncing the cloud catalog…")
    } catch (e) { /* notifications not ready */ }
    try {
      await game.beneos?.cloud?.checkAvailableContent?.()
      try { this.render({ parts: ["results"] }) } catch (e) { /* render skipped */ }
      ui.notifications?.info?.(game.i18n.localize("BENEOS.Cloud.Filter.ResyncDone")
        || "Beneos: cloud catalog re-synced.")
    } catch (err) {
      console.warn("[Beneos Cloud] Manual catalog re-sync failed", err)
      ui.notifications?.error?.(`Beneos: catalog re-sync failed — ${err?.message || "unknown"}`)
    }
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

  // Plan §13: read battlemap active resolution. Stored in client setting
  // so it persists across reload. Default 4K. Single-variant releases
  // ignore the value at install time; the toolbar control still toggles
  // for any dual-variant release the user may open next.
  _bmapActiveResolution() {
    try {
      const v = game.settings?.get?.(BeneosUtility.moduleID(), "battlemap-active-resolution")
      if (v === "HD" || v === "4K") return v
    } catch (_e) {}
    return "4K"
  }

  // Plan §13: read battlemap view mode (releases | individual). Session-
  // scoped via this._bmapViewMode (NOT persisted across reloads per spec
  // §13.7 — defaults to "releases" on every fresh window open).
  _bmapActiveView() {
    if (this._bmapViewMode === "individual") return "individual"
    if (this._bmapViewMode === "bundles") return "bundles"
    // Default to the grouped Releases view for EVERYONE. Logged out, releases +
    // bundles load anonymously from the cloud (view-only showcase: every row
    // comes back can_install=false + an unlock CTA), so there's no longer a
    // reason to fall back to Individual Maps. Individual stays one toggle away.
    return "releases"
  }

  // Task 4: when the user applies a filter while browsing Releases or Bundles,
  // auto-switch to Individual Maps, where scene-level results are far more
  // useful. Bundles are module-specific, so ONLY the Campaign/adventure filter
  // keeps you in the Bundles view; any other active filter (text, biome, type,
  // ...) flips to individual too. Call this BEFORE re-rendering the results.
  // `filterId` is the changed control's id (e.g. "bmap-adventure") or "" for
  // text/biome/tag filters.
  // Returns true if it switched AWAY from Bundles (so the caller knows the
  // sidebar must re-render to drop the bundles-only filter restriction).
  #maybeAutoSwitchBmapView(filterId = "") {
    if (this.searchMode !== "bmap") return false
    const view = this._bmapActiveView()
    if (view === "individual") return false
    if (view === "bundles" && filterId === "bmap-adventure") return false  // campaign filters bundles in place
    // Release view: the Campaign/adventure filter narrows releases IN PLACE
    // (release granularity is where it makes the most sense). Any OTHER active
    // filter flips to Individual Maps as before. So only keep the release view
    // when Campaign is the SOLE active bmap filter.
    if (view === "releases" && this.#bmapOnlyCampaignActive()) return false
    if (this.#hasActiveFilter("bmap")) {
      this._bmapViewMode = "individual"
      return view === "bundles"
    }
    return false
  }

  // True iff the Campaign/adventure dropdown is the ONLY active bmap filter
  // (no text, no biome chips, no other bmap dropdown). The Show dropdown
  // (installation-selector) is typed token/item/spell, so it is not counted
  // here and never forces a flip out of the release view.
  #bmapOnlyCampaignActive() {
    if (this._textFilter) return false
    if (this.bmapBiomeFilters?.size > 0) return false
    const root = this.element
    if (!root) return false
    let campaignActive = false
    for (const def of V2_FILTER_DEFS) {
      if (!def.types?.includes("bmap")) continue
      const sel = root.querySelector("#" + def.selector)
      if (!sel) continue
      const v = String(sel.value || "").toLowerCase()
      if (!v || v === "any") continue
      if (def.selector === "bmap-adventure") campaignActive = true
      else return false   // another bmap dropdown is active -> not campaign-only
    }
    return campaignActive
  }

  // Plan §13: resolution toggle handler. Persists, re-renders just the
  // results pane (the rest of the layout does not depend on resolution).
  static _onSwitchBmapRes(event, target) {
    event.preventDefault()
    const v = target.dataset.bmapRes
    if (v !== "4K" && v !== "HD") return
    if (this._bmapActiveResolution() === v) return
    try {
      game.settings?.set?.(BeneosUtility.moduleID(), "battlemap-active-resolution", v)
    } catch (_e) {}
    this.#renderResults(["results"])
  }

  // Plan §13: view-mode toggle (Releases | Individual Maps). Clicking a
  // tab pins the choice for the session; the auto-switch heuristic in
  // #applyDropdownFilters only flips while pinned=false.
  static _onSwitchBmapView(event, target) {
    event.preventDefault()
    const v = target.dataset.bmapView
    if (v !== "releases" && v !== "individual" && v !== "bundles") return
    const prev = this._bmapActiveView()
    if (prev === v) return
    this._bmapViewMode = v
    this._bmapViewPinned = true
    // Task 4: entering/leaving Bundles changes which sidebar filters are
    // offered (bundles = campaign only), so refresh the sidebar on those
    // transitions. Releases <-> Individual share the same filter set.
    const sidebarChanges = (v === "bundles" || prev === "bundles")
    this.#renderResults(sidebarChanges ? ["sidebar", "results"] : ["results"])
  }

  // Plan §23.1: invoked by the inline "Retry" button when the release
  // fetch failed after all 3 backoff attempts. Clears cached state so
  // #ensureReleasesLoaded runs from scratch.
  static _onRetryLoadReleases(event, target) {
    event.preventDefault()
    this._releaseLoadError  = null
    this._releaseNeedsLogin = false
    this._releaseList       = null
    this._releaseIndex      = null
    try {
      const mgr = window.BeneosScenePacker
      if (mgr) mgr._releasesCache = null   // drop the manager-side cache too
    } catch (_e) {}
    this.#renderResults(["results"])
    this.#ensureReleasesLoaded()
  }

  // Plan §15.1 — lazy fetch list_releases. Idempotent: subsequent calls
  // are no-ops until the first request completes (or fails). On success,
  // re-renders the results pane so the data shows up without a manual
  // toggle. Failures land on _releaseLoadError; the build helper uses
  // that to render an inline error placeholder.
  // Plan §23.1: 3 attempts (immediate + 2s + 8s delay) before giving up.
  // Beneos-Module had no retry pattern; this is the first one. Pulled
  // off into its own helper so #ensureReleasesLoaded keeps the same
  // shape (state-set + finally + re-render).
  async #fetchReleasesWithBackoff() {
    // Manager-missing is a hard structural error, not a transient
    // network blip — no point retrying it.
    let mgr = window.BeneosScenePacker
    // The manager is created lazily once a Foundry ID exists. A user who logged
    // in AFTER world load has no manager yet (the `ready` init ran while logged
    // out) -> ensure it on demand so logging in works without a full reload.
    if ((!mgr || typeof mgr.listReleases !== "function") && typeof window.ensureBeneosScenePacker === "function") {
      try { mgr = await window.ensureBeneosScenePacker() } catch (_e) {}
    }
    if (!mgr || typeof mgr.listReleases !== "function") {
      // Still no manager -> the user is not connected to Beneos Cloud. Surface a
      // dedicated "needs login" sentinel instead of a generic error, so the UI
      // shows a friendly prompt rather than an endless spinner.
      throw new Error("BENEOS_NEEDS_LOGIN")
    }
    const delays = [2000, 8000]   // gaps between attempts; final attempt is immediate
    let lastErr = null
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await mgr.listReleases({ refresh: attempt > 0 })
      } catch (e) {
        lastErr = e
        if (attempt === delays.length) break
        console.warn(`BeneosCloudWindowV2 | list_releases attempt ${attempt + 1} failed: ${e?.message}. Retrying in ${delays[attempt]}ms`)
        await new Promise(r => setTimeout(r, delays[attempt]))
      }
    }
    throw lastErr
  }

  async #ensureReleasesLoaded() {
    // Bail on ANY settled outcome (loaded, in-flight, errored, or needs-login).
    // Without the error/needs-login guards a failed fetch left _releaseIndex
    // null + _releaseLoading false, so every re-render re-attempted -> the fetch
    // threw again -> re-render -> ... an infinite loop that spammed the console
    // and froze the "Loading releases..." spinner when logged out.
    if (this._releaseIndex || this._releaseLoading || this._releaseLoadError || this._releaseNeedsLogin) return
    this._releaseLoading = true
    this._releaseLoadError = null
    this._releaseNeedsLogin = false
    try {
      const releases = await this.#fetchReleasesWithBackoff()
      const list = Array.isArray(releases) ? [...releases] : []
      // Task 1: newest first. Primary key is the catalog release_date (desc);
      // release_num (desc) and name break ties. While all release_dates are
      // identical (greenfield) this degrades cleanly to the previous
      // release_num/name ordering, and becomes a real recency sort the moment
      // the database carries diverse dates.
      list.sort((a, b) => {
        const da = this.#releaseDateInfo(a?.release_dir)?.releaseDate || ""
        const db = this.#releaseDateInfo(b?.release_dir)?.releaseDate || ""
        if (da !== db) return db.localeCompare(da)   // ISO dates: lexical desc = newest first
        const ra = parseInt(a?.release_num, 10) || 0
        const rb = parseInt(b?.release_num, 10) || 0
        if (ra !== rb) return rb - ra
        return String(a?.display_name || "").localeCompare(String(b?.display_name || ""))
      })
      this._releaseList  = list
      this._releaseIndex = new Map(list.map(r => [r.release_dir, r]))
    } catch (e) {
      if (e?.message === "BENEOS_NEEDS_LOGIN") {
        // Expected logged-out state, not an error: flag it so the template
        // shows a friendly "log in" prompt. No console noise.
        this._releaseNeedsLogin = true
      } else {
        this._releaseLoadError = e?.message || String(e)
        console.warn("BeneosCloudWindowV2 | listReleases failed after retries", e)
      }
    } finally {
      this._releaseLoading = false
    }
    // Re-render once the fetch resolves so the freshly loaded cards
    // appear without the operator having to flip the view-toggle again.
    try { this.#renderResults(["results"]) } catch (_e) {}
  }

  // Plan §15.1 — build release-cards from the lazy-loaded list_releases
  // payload. Each release becomes one card; the existing results-pane.hbs
  // grid/list template renders it because we mirror the asset-card shape
  // (key, name, thumbUrl, isBmap, etc.). Resolution toggle picks the
  // cover + byte label live. Debug filter is a no-op here — the backend
  // only returns cloud-ready releases by definition.
  #buildReleaseCards() {
    // Task 1: a release counts as "New" when its catalog release_date is within
    // this many days of the newest release in the catalog.
    const RELEASE_NEW_WINDOW_DAYS = 30
    const list = Array.isArray(this._releaseList) ? this._releaseList : []
    // Apply text-filter on display_name. The dropdown sidebar filters do
    // not apply to release-view (biome/brightness/grid live on the scene
    // catalog, not on releases — auto-switch heuristic in §13 already
    // flips back to individual when those are active).
    let filtered = list
    const q = (this._textFilter || "").trim().toLowerCase()
    if (q) {
      filtered = filtered.filter(r => String(r?.display_name || "").toLowerCase().includes(q))
    }
    // A2: in the release view the Campaign/adventure dropdown narrows releases
    // IN PLACE (every other bmap filter auto-switches to Individual Maps). Match
    // the selected adventure against each release's representative adventure.
    const advSel = String(this.element?.querySelector("#bmap-adventure")?.value || "").trim()
    if (advSel && advSel.toLowerCase() !== "any") {
      const want = advSel.toLowerCase()
      filtered = filtered.filter(r => this.#releaseAdventureRaw(r.release_dir).toLowerCase().includes(want))
    }
    const variant     = this._bmapActiveResolution() === "HD" ? "HD" : "4K"
    const variantHas  = (r) => Array.isArray(r?.variants_available) && r.variants_available.includes(variant)
    const limit        = this.loadedCount

    // Feature 4 (free maps): when the user lacks battlemaps-campaign access
    // (logged out / non-patron) we group like Creatures/Spells/Loot — Free
    // releases on top, everything else as a locked "Join Patreon" section
    // below. Patrons keep the flat newest-first list. Build every card first
    // (cheap, no remote calls), then group-sort + slice so the Free section is
    // never paged out before the locked one.
    const hasCampaign = !!game.beneos?.cloud?.hasCampaignAccess?.("battlemaps")
    // 14.4.8: wie bei den uebrigen Karten an den echten Serverausfall gebunden.
    // Releaselisten kommen aus api-scenepacker.php auf beneos.cloud und haben mit
    // dem Katalog-Host nichts zu tun; ein veralteter Suchindex darf sie nicht
    // als offline ausweisen.
    const isOffline   = game.beneos?.cloud?.serverOffline === true

    const cards = filtered.map(r => {
      const single   = Number(r?.nb_variants || 0) === 1
      const useV     = single ? (r.variants_available?.[0] || "4K") : variant
      const coverUrl = useV === "HD" ? (r?.cover_url_hd || r?.cover_url_4k || null)
                                     : (r?.cover_url_4k || r?.cover_url_hd || null)
      const bytes    = r?.bytes_per_variant?.[useV] || 0

      // Plan §33.6 — install-state for the green / gold badge. The world
      // setting "battlemap-installs" carries every installed release; we
      // check the active-variant first, then fall back to "any variant".
      // is_stale compares stored sourceSignature against the freshly
      // fetched content_signature on list_releases.
      // ONE reading per card, then passed around. Three separate calls not only
      // re-read the world setting each time, they can also straddle a cloud
      // index refresh and leave the name row and the tooltip of the SAME card
      // disagreeing about the scene count.
      const bmapInfo = this.#bmapInstallInfo(r.release_dir)
      const bmapCoverageLabel = this.#bmapCoverageLabel(bmapInfo)

      let installState = null
      const installs = BeneosInstallState.findByReleaseDir(r.release_dir)
      if (installs.length) {
        const wantVariant = single ? "" : useV
        const matchActive = installs.find(e => (e.variant || "") === wantVariant)
        const chosen = matchActive || installs[0]
        const currentSig = String(r?.content_signature || "")
        const stale = currentSig !== "" && chosen.sourceSignature !== "" && chosen.sourceSignature !== currentSig
        installState = {
          installed:        true,
          stale,
          variantInstalled: chosen.variant || "",
          variantMatch:     !!matchActive,
          installedAt:      chosen.installedAt || "",
          sceneCount:       chosen.sceneCount || (chosen.sceneIds?.length || 0),
          // Read through the shared funnel rather than counting here: the card
          // and the Show filter reaching different conclusions is exactly the
          // bug #bmapInstallInfo was introduced to end.
          partial:          bmapInfo.partial,
        }
      }

      // Plan §20 W4.2 - visibility matrix on release cards. Backend emits
      // can_install + unlock_hint on every list_releases row; we surface
      // locked releases as dimmed cards with a CTA-button that opens the
      // unlock URL (Patreon join / shop purchase / loyalty hint) instead
      // of firing the install pipeline.
      const canInstall = r?.can_install !== false   // default true if backend doesn't set
      const unlockHint = r?.unlock_hint || null
      // Logged out (anonymous showcase): every card shows a "Sign In" action
      // (download after sign-in) instead of an install button, exactly like the
      // Individual Maps tab. Install stays gated on isLoggedIn() at click time.
      const loggedOut = !(game.beneos?.cloud?.isLoggedIn?.())

      // Task 1: New / Updated chips (date + install-status combined).
      //  - Updated: the release is installed AND the cloud has a newer version
      //    (content_signature mismatch -> installState.stale).
      //  - New: not installed AND its release_date belongs to the newest cohort
      //    (within RELEASE_NEW_WINDOW_DAYS of the newest catalog date). Gated on
      //    date diversity so today's uniform greenfield dates produce no chip;
      //    it activates automatically once the DB carries real dates.
      const installed = !!installState
      // Teil 4: unified rule shared with token/item/spell.
      //  - New  = release_date within the window of TODAY (publication recency),
      //    regardless of catalog date diversity (the old distinct-date gate is
      //    gone now that the catalog carries real per-release dates).
      //  - Update = installed AND the install predates the catalog updated_date,
      //    with the stored content-signature mismatch as a fallback signal.
      const di = this.#releaseDateInfo(r.release_dir) || null
      let isNew = false
      if (!installed && di?.releaseDate) {
        const ageDays = (Date.now() - Date.parse(di.releaseDate)) / 86400000
        isNew = Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= RELEASE_NEW_WINDOW_DAYS
      }
      let isUpdate = false
      if (installed) {
        const instAt = installState.installedAt ? Date.parse(installState.installedAt) : NaN
        const updAt  = di?.updatedDate ? Date.parse(di.updatedDate) : NaN
        if (Number.isFinite(instAt) && Number.isFinite(updAt) && updAt > instAt) isUpdate = true
        if (!isUpdate && installState.stale) isUpdate = true
      }
      // Feature 4: free/locked grouping for non-patrons (logged out). A free
      // release floats to the top; everything else not installed is locked.
      // "Free without account" (2026-07-01): the backend marks an allowlisted
      // release public_download; it is installable even logged out, so it groups
      // like free (floats to top, never locked) AND drops the Sign-In requirement
      // below. Kept separate from isFree because a normal free release still needs
      // a Cloud account to download, whereas a public one does not.
      const isPublic = !!r?.public_download
      const isFree   = this.#releaseIsFree(r.release_dir)
      // The SERVER decides access, not the local Patreon flag. can_install
      // already covers every path that grants a release: an active tier, a shop
      // purchase, an admin gift, loyalty. Gating on hasCampaign instead made
      // every shop buyer without a Patreon membership see their own purchase as
      // locked with a Join-Patreon button (reported 2026-07-30). For anonymous
      // sessions the backend returns can_install=false, so the logged-out lock
      // still works.
      const isLocked = !canInstall && !isFree && !isPublic && !installed
      const groupKind = (!hasCampaign && (isFree || isPublic)) ? "free"
                      : isLocked ? "locked"
                      : isUpdate ? "update" : (isNew ? "new" : "regular")

      return {
        key:                  r.release_dir,
        name:                 r.display_name || r.release_dir,
        assetType:            "bmap",
        dragType:             "bmap",
        dragMode:             "noop",
        documentId:           "",
        isDraggable:          false,
        isBmap:               true,
        // Locked releases (logged-out non-free) route into the Join-Patreon
        // branch instead of the install buttons. Offline cards route into the
        // offline branch (both are checked before isCloudAvailable).
        isCloudAvailable:     (groupKind === "locked") ? false : canInstall,
        // Shop product for this release, resolved server-side in list_releases.
        // null when no ACTIVE product exists (extras, tour packs), which keeps
        // the "Buy pack" CTA from rendering a dead link.
        shopUrl:              r?.shop_url || null,
        isFree:               isFree || isPublic,
        // "Free without account": read by the install click-gate to bypass the
        // logged-in requirement for this one release.
        publicDownload:       isPublic,
        isLocked:             groupKind === "locked",
        isOfflineCard:        isOffline,
        cloudReady:           true,
        isReleaseCard:        true,
        releaseScope:         true,
        singleVariant:        single,
        // Feature 5: offline -> no remote cover request, the gradient
        // placeholder + "Offline" overlay renders instead.
        thumbUrl:             isOffline ? null : coverUrl,
        bytesLabel:           bytes ? this.#formatBytes(bytes) : "",
        sceneCount:           Number(r?.scene_count || 0),
        // Punkt 3: compatible-adventure chip on the release detail, derived
        // from a representative catalog scene of this release.
        compatibleAdventure:  this.#releaseAdventureChip(r.release_dir),
        // #4: surface release stats (what's-included checkmarks) + the resolved
        // on-disk variant dirs so the drawer can lazy-load this release's scenes.
        releaseStats:         r?.stats || null,
        variantDirs:          r?.variant_dirs || {},
        releaseNum:           r?.release_num || "",
        variantLabel:         single ? "" : useV,
        installDuration:      "0.6s",
        // Task 1: New / Updated surfacing (chips + group classification).
        isNew,
        isUpdate,
        // Teil 3: installed-marker (green check next to the title + "Installed
        // on" tooltip). A MARKER-ONLY flag — NOT `isInstalled`, which would
        // reroute the card into the token-style installed branch and strip the
        // install/Moulinette buttons (an installed map stays re-installable).
        bmapInstalled:        installed,
        installedOnLabel:     installState ? this.#formatInstallDate(installState.installedAt) : "",
        bmapPartial:          !!installState?.partial,
        bmapCoverageLabel,
        // Uninstall affordance: only for a GM, only on a release that really is
        // in this world, and always against the variant that was ACTUALLY
        // installed (which may differ from the resolution toggle the user is
        // currently looking at). The release-dir/name pair is spelled out even
        // though it equals key/name here, so the template's uninstall block is
        // literally the same markup on a release card and on a single map card,
        // where key/name describe the SCENE and would name the wrong thing.
        canUninstall:         installed && !!game.user?.isGM,
        uninstallVariant:     installState?.variantInstalled || "",
        uninstallReleaseDir:  r.release_dir,
        uninstallReleaseName: r.display_name || r.release_dir,
        uninstallPackageId:   installed
          ? ((r?.variant_dirs || {})[installState.variantInstalled] || Object.values(r?.variant_dirs || {})[0] || "")
          : "",
        groupKind,
        visibleTagDescriptors: [],
        moreTagsCount:        0,
        // Drawer is not used yet for release-cards (Plan §15.5 V2),
        // but the click-to-open path still goes through enrichCard for
        // the install button to fire correctly.
        installScope:         "release",
        // Plan §33.6 badge fields (consumed by results-pane.hbs). Teil 4:
        // keyed off the unified isUpdate so the thumb badge agrees with the
        // name-row marker + update chip (a date-based update with a matching
        // signature would otherwise still show the green "fresh" tick).
        // A partly installed release must not keep the green tick either, or the
        // thumb would go on claiming "done" while the name row says 3 of 14.
        // Same precedence as the name row: update beats partial beats complete.
        installState,
        dlBadgeFresh:         installed && !isUpdate && !installState?.partial,
        dlBadgeStale:         installed && isUpdate,
        dlBadgePartial:       installed && !isUpdate && !!installState?.partial,
        dlBadgeTooltip:       installState
          ? (isUpdate
              ? `Installed ${installState.variantInstalled || "single-variant"} on ${this.#formatInstallDate(installState.installedAt)} (${installState.sceneCount} scenes). Release updated since install.`
              : installState.partial
                ? bmapCoverageLabel
                : `Installed ${installState.variantInstalled || "single-variant"} on ${this.#formatInstallDate(installState.installedAt)} (${installState.sceneCount} scenes).`)
          : "",
        // Plan §20 W4.2 - locked-card fields. Locked == genuinely gated content
        // (non-free, not installed, no access). FREE releases are NEVER locked
        // (groupKind is "free"), so anonymous browsers see them with the FREE
        // badge, not a lock. Drives the small top-right lock badge on the thumb.
        isReleaseLocked:      groupKind === "locked",
        // Logged out -> "Sign In" action button (download after sign-in). A
        // public_download release is exempt: it installs without an account, so
        // it keeps the Install button even when logged out.
        needsLogin:           loggedOut && !isPublic,
        unlockUrl:            unlockHint?.url   || "https://www.patreon.com/BeneosBattlemaps",
        unlockLabel:          unlockHint?.label || "Unlock via Patreon",
        unlockType:           unlockHint?.type  || "generic",
      }
    })

    // A4: the Show dropdown (All / Installed / Not installed / New / Updated)
    // filters releases too, mirroring token/item/spell. Uses the per-card flags
    // computed above, so NEW and (most importantly) every UPDATED release is
    // selectable in the release view.
    const show = this.showFilter || "any"
    let shown = cards
    if (show && show !== "any") {
      shown = cards.filter(c =>
        show === "installed"    ? c.bmapInstalled :
        show === "notinstalled" ? !c.bmapInstalled :
        show === "new"          ? c.isNew :
        show === "updated"      ? c.isUpdate : true)
    }
    const totalMatches = shown.length

    // Feature 4: group-sort + section dividers, only when grouping is active
    // (user lacks campaign access). A STABLE sort preserves the newest-first
    // order within each group. Patrons keep the flat list with no dividers.
    let ordered = shown
    if (!hasCampaign) {
      const rank = (gk) => gk === "free" ? -1 : gk === "locked" ? 9999
                         : gk === "new" ? 0 : gk === "update" ? 1 : 2
      ordered = shown.slice().sort((a, b) => rank(a.groupKind) - rank(b.groupKind))
    }
    const hasMore = totalMatches > limit
    const visible = hasMore ? ordered.slice(0, limit) : ordered
    if (!hasCampaign) {
      let lastGroup = null
      for (const card of visible) {
        if (card.groupKind !== lastGroup) {
          card.divider = true
          card.dividerLabel = this.#groupHeading(card.groupKind)
          if (card.groupKind === "free") {
            card.dividerDescription = game.i18n.localize("BENEOS.Patreon.FreeSection.Description")
          }
          lastGroup = card.groupKind
        }
      }
    }
    return {
      cards: visible,
      totalMatches,
      hasMore,
      partialHint:    hasMore ? `${visible.length} / ${totalMatches}` : "",
      groupBulkKeys:  { new: [], update: [], view: [], backlog: [] },
      loadingReleases: !!this._releaseLoading,
      releasesError:   this._releaseLoadError || null,
    }
  }

  // Feature 4: a release is "free" when any of its catalog scenes carries
  // properties.free_content === true — the same per-asset flag tokens/items/
  // spells use. Memoized per session like the adventure/date maps.
  #releaseIsFree(releaseDir) {
    if (!releaseDir) return false
    if (!this._releaseFreeMap) {
      const map = new Map()
      const all = game.beneos?.databaseHolder?.getAll?.("bmap") || {}
      for (const v of Object.values(all)) {
        const rd = v?.properties?.release_dir
        if (rd && v?.properties?.free_content === true) map.set(rd, true)
      }
      this._releaseFreeMap = map
    }
    return this._releaseFreeMap.get(releaseDir) === true
  }

  // A2/A4: raw representative adventure of a release (for the in-place Campaign
  // filter on the release view). Reuses the memoized adventure map built by
  // #releaseAdventureChip.
  #releaseAdventureRaw(releaseDir) {
    if (!releaseDir) return ""
    if (!this._releaseAdventureMap) this.#releaseAdventureChip(releaseDir)
    return this._releaseAdventureMap?.get(releaseDir) || ""
  }

  // A5: does any installed release have a newer cloud version? Drives the
  // "Only updated" show-filter option on the battlemap tab.
  #bmapHasUpdatedReleases() {
    const list = Array.isArray(this._releaseList) ? this._releaseList : []
    for (const r of list) {
      const installs = BeneosInstallState.findByReleaseDir(r.release_dir)
      if (!installs.length) continue
      const chosen = installs[0]
      const di = this.#releaseDateInfo(r.release_dir) || null
      const instAt = chosen.installedAt ? Date.parse(chosen.installedAt) : NaN
      const updAt  = di?.updatedDate ? Date.parse(di.updatedDate) : NaN
      if (Number.isFinite(instAt) && Number.isFinite(updAt) && updAt > instAt) return true
      const curSig = String(r?.content_signature || "")
      if (curSig !== "" && chosen.sourceSignature !== "" && chosen.sourceSignature !== curSig) return true
    }
    return false
  }

  // Punkt 3: map a release_dir to its compatible-adventure chip by sampling a
  // representative catalog scene of that release. Memoized per session so the
  // 138-release card build stays O(1) per card after the first scan.
  #releaseAdventureChip(releaseDir) {
    if (!releaseDir) return null
    if (!this._releaseAdventureMap) {
      const map = new Map()
      const all = game.beneos?.databaseHolder?.getAll?.("bmap") || {}
      for (const v of Object.values(all)) {
        const rd  = v?.properties?.release_dir
        const adv = v?.properties?.adventure
        if (rd && adv && !map.has(rd)) {
          map.set(rd, String(Array.isArray(adv) ? adv[0] : adv))
        }
      }
      this._releaseAdventureMap = map
    }
    const advRaw = this._releaseAdventureMap.get(releaseDir)
    if (!advRaw) return null
    const loc = game.beneos?.databaseHolder?.localizeTag?.("battlemap.adventure", advRaw)
    return this.#adventureChip((loc && loc !== advRaw) ? loc : advRaw)
  }

  // Task 1: per-release recency dates from the bmap catalog (release_date +
  // updated_date), memoized. Also tracks how many DISTINCT release_dates exist
  // so we can suppress the "New" chip while the data has no diversity (today
  // every release shares the greenfield date; the chip activates automatically
  // once the database carries real per-release dates). Returns
  // { releaseDate, updatedDate } strings (YYYY-MM-DD) or null.
  #releaseDateInfo(releaseDir) {
    if (!this._releaseDateMap) {
      const map = new Map()
      const distinct = new Set()
      const all = game.beneos?.databaseHolder?.getAll?.("bmap") || {}
      for (const v of Object.values(all)) {
        const rd = v?.properties?.release_dir
        if (!rd || map.has(rd)) continue
        const releaseDate = String(v?.properties?.release_date || "").trim()
        const updatedDate = String(v?.properties?.updated_date || "").trim()
        map.set(rd, { releaseDate, updatedDate })
        if (releaseDate) distinct.add(releaseDate)
      }
      this._releaseDateMap = map
      this._releaseDistinctDateCount = distinct.size
      // Newest release_date across the catalog (lexical works for ISO dates).
      this._releaseNewestDate = [...distinct].sort().pop() || ""
    }
    return this._releaseDateMap.get(releaseDir) || null
  }

  // #4: lazy-load one release's scene list (BM + SC thumbnails) for the drawer.
  // Idempotent per release_dir; caches the result and re-renders the drawer once
  // the fetch resolves so the scenes appear without a second click.
  async #ensureReleaseScenesLoaded(releaseDir, card) {
    if (!this._releaseScenesCache)   this._releaseScenesCache = new Map()
    if (!this._releaseScenesInflight) this._releaseScenesInflight = new Set()
    if (this._releaseScenesCache.has(releaseDir) || this._releaseScenesInflight.has(releaseDir)) return
    this._releaseScenesInflight.add(releaseDir)
    const mgr = window.BeneosScenePacker
    if (!mgr || typeof mgr.listReleaseScenes !== "function") {
      this._releaseScenesInflight.delete(releaseDir)
      this._releaseScenesCache.set(releaseDir, [])
      return
    }
    try {
      const variant = card?.variantLabel === "HD" ? "HD" : (card?.variantLabel === "4K" ? "4K" : "")
      const scenes = await mgr.listReleaseScenes(releaseDir, variant)
      this._releaseScenesCache.set(releaseDir, Array.isArray(scenes) ? scenes : [])
    } catch (e) {
      console.warn("BeneosCloudWindowV2 | listReleaseScenes failed", releaseDir, e?.message || e)
      this._releaseScenesCache.set(releaseDir, [])
    } finally {
      this._releaseScenesInflight.delete(releaseDir)
    }
    // Re-render when the open drawer depends on this release — either a
    // release card (selectedAssetKey === releaseDir) or an individual scene
    // whose parent release is this one (tracked in _drawerReleaseDir, Punkt 4).
    if (this.rendered && (this.selectedAssetKey === releaseDir || this._drawerReleaseDir === releaseDir)) {
      // Punkt 5: preserve scroll — this re-render fires after the drawer is
      // already open, so a plain #renderResults would snap the list back to
      // the top once the scenes resolve.
      try { this.#renderResultsPreserveScroll(["results"]) } catch (_e) {}
    }
  }

  // #4: build the "what's included" checklist rows from a list_releases stats
  // object. Returns [{ count, label }] for the non-zero buckets, or null.
  #buildReleaseChecklist(stats) {
    if (!stats || typeof stats !== "object") return null
    const defs = [
      ["battlemaps",     "BENEOS.Cloud.Drawer.Stat.Battlemaps"],
      ["sceneries",      "BENEOS.Cloud.Drawer.Stat.Sceneries"],
      ["intros",         "BENEOS.Cloud.Drawer.Stat.Intros"],
      ["overview",       "BENEOS.Cloud.Drawer.Stat.Overview"],
      ["standalones",    "BENEOS.Cloud.Drawer.Stat.Standalones"],
      ["handouts",       "BENEOS.Cloud.Drawer.Stat.Handouts"],
      ["ambient_tracks", "BENEOS.Cloud.Drawer.Stat.Ambient"],
    ]
    const rows = []
    for (const [k, key] of defs) {
      const n = Number(stats[k] || 0)
      if (n > 0) rows.push({ count: n, label: game.i18n.localize(key) })
    }
    return rows.length ? rows : null
  }

  // #5: lazy-load install bundles for the Bundles view. Mirrors #ensureReleasesLoaded.
  async #ensureBundlesLoaded() {
    if (this._bundleList || this._bundlesLoading) return
    this._bundlesLoading = true
    this._bundlesLoadError = null
    // The bundle drawer shows per-release sizes + installed-checks, both of which
    // come from the release index (bytes_per_variant) — make sure it's loaded so
    // #buildBundleCards can enrich the members synchronously.
    try { await this.#ensureReleasesLoaded?.() } catch (_e) {}
    try {
      const mgr = window.BeneosScenePacker
      const bundles = (mgr && typeof mgr.listBundles === "function") ? await mgr.listBundles() : []
      this._bundleList = Array.isArray(bundles) ? bundles : []
    } catch (e) {
      this._bundlesLoadError = e?.message || String(e)
      this._bundleList = []
      console.warn("BeneosCloudWindowV2 | listBundles failed", e)
    } finally {
      this._bundlesLoading = false
    }
    try { this.#renderResults(["results"]) } catch (_e) {}
  }

  // #5: build bundle-cards from list_bundles. Mirrors the release-card shape so
  // the existing results grid/list renders them; the drawer shows the member
  // list + a single "Install Bundle" button.
  #buildBundleCards() {
    const list = Array.isArray(this._bundleList) ? this._bundleList : []
    let filtered = list
    const q = (this._textFilter || "").trim().toLowerCase()
    if (q) filtered = filtered.filter(b => String(b?.name || "").toLowerCase().includes(q))
    // The existing Campaign/adventure dropdown narrows the bundle list in place
    // (same control the release view uses). Match the selected campaign against
    // each bundle's own campaign field (admin-set "Compatible with").
    const advSel = String(this.element?.querySelector("#bmap-adventure")?.value || "").trim()
    if (advSel && advSel.toLowerCase() !== "any") {
      const want = advSel.toLowerCase()
      filtered = filtered.filter(b => String(b?.campaign || "").toLowerCase().includes(want))
    }
    const totalMatches = filtered.length
    const limit = this.loadedCount
    const hasMore = totalMatches > limit
    const sliced = hasMore ? filtered.slice(0, limit) : filtered
    const variant = this._bmapActiveResolution?.() === "HD" ? "HD" : "4K"
    const loggedOut = !(game.beneos?.cloud?.isLoggedIn?.())
    const cards = sliced.map(b => {
      const canInstall = b?.can_install !== false
      const rawMembers = Array.isArray(b?.members)
        ? [...b.members].sort((m1, m2) => (m1.sort_order || 0) - (m2.sort_order || 0))
        : []
      // Enrich every member with its on-disk size (release index bytes_per_variant)
      // + installed-state so the drawer can show a per-release size, a checkmark,
      // and wire a per-release install button. release_dir is the release index key.
      const members = rawMembers.map((m, i) => {
        const relDir = String(m.release_dir || "")
        const vdirs  = m.variant_dirs || {}
        const rel    = relDir ? this._releaseIndex?.get?.(relDir) : null
        const bpv    = rel?.bytes_per_variant || {}
        const sizeBytes = Number(bpv[variant] || bpv["4K"] || bpv["HD"] || 0) || 0
        const coverUrl  = rel ? (variant === "HD" ? (rel.cover_url_hd || rel.cover_url_4k)
                                                  : (rel.cover_url_4k || rel.cover_url_hd)) : null
        const memberInfo = this.#bmapInstallInfo(relDir)
        return {
          index:        i,
          name:         m.name || relDir,
          release_dir:  relDir,
          variant_dirs: vdirs,
          sizeLabel:    sizeBytes ? this.#formatBytes(sizeBytes) : "—",
          installed:    relDir ? memberInfo.installed : false,
          partial:      relDir ? memberInfo.partial : false,
          coverUrl,
          _sizeBytes:   sizeBytes,
        }
      })
      const totalBytes = members.reduce((s, m) => s + (m._sizeBytes || 0), 0)
      // Bundle counts as installed once every member release is present in this
      // world. Surfaces a green check on the card + drawer so the GM can walk a
      // campaign's bundles top-to-bottom and see at a glance what's done.
      //
      // COMPLETE, not merely present. A member the user took a single map out
      // of would otherwise tick the box for the whole campaign, which is the
      // one reading of this check nobody wants: the GM walks the bundle list to
      // find out what is still missing.
      const bundleInstalled = members.length > 0 && members.every(m => m.installed && !m.partial)
      // Compatible-with chip: the admin sets a campaign per bundle ("Curse of
      // Strahd"). Localize it via the shared i18n matrix (raw fallback) and show
      // the spelled-out full name (not the acronym the release cards use).
      let compatibleCampaign = ""
      const campRaw = String(b?.campaign || "").trim()
      if (campRaw) {
        const loc = game.beneos?.databaseHolder?.localizeTag?.("battlemap.adventure", campRaw)
        const chip = this.#adventureChip((loc && loc !== campRaw) ? loc : campRaw)
        compatibleCampaign = chip?.fullName || campRaw
      }
      return {
        key:              b.id,
        name:             b.name || b.id,
        compatibleCampaign,
        assetType:        "bmap",
        dragType:         "bmap",
        dragMode:         "noop",
        isDraggable:      false,
        isBmap:           true,
        isBundleCard:     true,
        bundleScope:      true,
        bundleInstalled,
        isCloudAvailable: canInstall,
        cloudReady:       true,
        thumbUrl:         b.cover_url || null,
        bytesLabel:       "",
        sceneCount:       0,
        memberCount:      Number(b.member_count || members.length),
        totalSizeLabel:   totalBytes ? this.#formatBytes(totalBytes) : "—",
        members,
        description:      b.description || "",
        variantLabel:     "",
        installScope:     "bundle",
        visibleTagDescriptors: [],
        moreTagsCount:    0,
        isReleaseLocked:  !canInstall,
        // Logged out -> "Sign In" action; logged-in non-patron locked bundle ->
        // "Join Patreon" (needsLogin is checked before isLocked in the template).
        needsLogin:       loggedOut,
        isLocked:         !canInstall,
        unlockUrl:        b?.unlock_hint?.url || "",
        unlockLabel:      b?.unlock_hint?.label || "Unlock via Patreon",
      }
    })
    return {
      cards,
      totalMatches,
      hasMore,
      partialHint:    hasMore ? `${cards.length} / ${totalMatches}` : "",
      groupBulkKeys:  { new: [], update: [], view: [], backlog: [] },
      loadingReleases: !!this._bundlesLoading,
      releasesError:   this._bundlesLoadError || null,
    }
  }

  // #5b: install ONE release of a bundle (the per-release button in the drawer).
  // Reuses the full native single-release pipeline (cover/record/overwrite dialog/
  // progress window/installed-marker refresh) via _onCloudBattlemapInstallNative,
  // with the member's own variant_dirs as a fallback when the release index lacks
  // the entry (a bundle-exclusive release).
  static async _onCloudBundleMemberInstall(event, target) {
    event.preventDefault()
    const bundleId = target?.dataset?.bundleId
    const idx      = Number(target?.dataset?.memberIndex)
    const bundle   = (this._bundleList || []).find(b => b.id === bundleId)
    const members  = Array.isArray(bundle?.members)
      ? [...bundle.members].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      : []
    const m = members[idx]
    if (!m) { ui.notifications.warn("This bundle release could not be resolved."); return }
    const relDir = String(m.release_dir || "")
    if (!relDir) { ui.notifications.warn(`"${m.name || "release"}" is missing release_dir.`); return }
    const rel     = this._releaseIndex?.get?.(relDir)
    const variant = this._bmapActiveResolution?.() === "HD" ? "HD" : "4K"
    const coverUrl = rel ? (variant === "HD" ? (rel.cover_url_hd || rel.cover_url_4k)
                                             : (rel.cover_url_4k || rel.cover_url_hd)) : null
    await BeneosCloudWindowV2._onCloudBattlemapInstallNative.call(
      this, event, relDir, "release",
      { variantDirs: m.variant_dirs || {}, displayName: m.name || relDir, coverUrl }
    )
  }

  // #5: install every release of a bundle sequentially (sort_order). Each install
  // opens its own native progress window. Already-installed releases raise a
  // per-release prompt (overwrite / skip / stop) so a single "already in your
  // world" never aborts the whole run; an "apply to all remaining" choice is
  // remembered for the rest of this run. A per-release failure is counted, not fatal.
  static async _onCloudBundleInstall(event, target) {
    event.preventDefault()
    const bundleId = target?.dataset?.bundleId
    const bundle = (this._bundleList || []).find(b => b.id === bundleId)
    if (!bundle || !Array.isArray(bundle.members) || !bundle.members.length) {
      ui.notifications.warn("This bundle has no installable releases.")
      return
    }
    if (!globalThis.BeneosNativeBattlemapInstaller) {
      ui.notifications.error("BeneosNativeBattlemapInstaller is not loaded")
      return
    }
    try { await this.#ensureReleasesLoaded?.() } catch (_) {}
    const variant = this._bmapActiveResolution?.() === "HD" ? "HD" : "4K"
    const members = [...bundle.members].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    const total = members.length
    let installed = 0, skipped = 0, failed = 0
    let remembered = null // "overwrite" | "skip" applied to all remaining installed releases
    for (let idx = 0; idx < members.length; idx++) {
      const m = members[idx]
      const relDir = String(m.release_dir || "")
      if (!relDir) { console.warn("BeneosCloudWindowV2 | bundle member has no release_dir", m); skipped++; continue }
      let overwrite = false
      if (BeneosInstallState.findByReleaseDir(relDir).length > 0) {
        let choice = remembered
        if (!choice) {
          const res = await BeneosPreInstallDialog.confirmBundleMemberOverwrite({
            name: m.name || relDir, index: idx + 1, total,
          })
          choice = res.choice
          if (res.applyAll && (choice === "overwrite" || choice === "skip")) remembered = choice
        }
        if (choice === "stop") break
        if (choice === "skip") { skipped++; continue }
        overwrite = true
      }
      ui.notifications.info(game.i18n.format("BENEOS.Cloud.Bmap.BundleInstalling", { current: idx + 1, total }))
      const rel = this._releaseIndex?.get?.(relDir)
      const coverUrl = rel ? (variant === "HD" ? (rel.cover_url_hd || rel.cover_url_4k)
                                               : (rel.cover_url_4k || rel.cover_url_hd)) : null
      try {
        const inst = await BeneosCloudWindowV2._onCloudBattlemapInstallNative.call(
          this, event, relDir, "release",
          { variantDirs: m.variant_dirs || {}, displayName: m.name || relDir, coverUrl, overwrite }
        )
        if (inst && inst._cancelled) skipped++
        else installed++
      } catch (e) {
        console.warn("BeneosCloudWindowV2 | bundle member install failed", m.name, e)
        ui.notifications.error(`Install failed for ${m.name || relDir}: ${e?.message || e}`)
        failed++
      }
    }
    ui.notifications.info(game.i18n.format("BENEOS.Cloud.Bmap.BundleSummary", {
      name: bundle.name, installed, skipped, failed,
    }))
    try { await this.#refreshAfterBmapInstall?.(null) } catch (_) {}
  }

  /**
   * Install state of a battlemap RELEASE, for any card that belongs to it.
   * A single map has no install record of its own: Foundry scene ids are not
   * in the catalog, so a map counts as installed when its release does.
   *
   * Shared by the card enrichment (green check, "Install Again", trash button)
   * and by the Show filter, which used to reach a different conclusion than
   * the cards it was filtering.
   *
   * PRESENT IS NOT THE SAME AS COMPLETE. A scene-scoped install writes the
   * whole release dir with a single scene id, so a release the user took one
   * map out of used to carry the same green check as one they installed in
   * full. `partial` separates the two by counting: the ids this world actually
   * recorded against the scene count the POI index read out of the pack.
   *
   * A release the index does not know (too new, or a namespace the index does
   * not cover) yields want = 0 and is reported as complete. Claiming
   * incompleteness on a release we cannot count would be the worse error.
   *
   * @param {string} releaseDir
   * @returns {{installed: boolean, installedOn: string, update: boolean,
   *            releaseName: string, variant: string, packageId: string,
   *            partial: boolean, sceneCoverage: {have: number, want: number}}}
   */
  #bmapInstallInfo(releaseDir) {
    const none = {
      installed: false, installedOn: "", update: false, releaseName: "", variant: "", packageId: "",
      partial: false, sceneCoverage: { have: 0, want: 0 },
    }
    if (!releaseDir) return none
    const installs = BeneosInstallState.findByReleaseDir(releaseDir)
    if (!installs.length) return none
    const chosen = installs[0]
    const have = BeneosInstallState.installedSceneIds(releaseDir).size
    const want = Number(releaseInfo(peekPoiIndex(), releaseDir)?.scenes || 0)
    const rel    = this._releaseIndex?.get?.(releaseDir) || null
    const curSig      = String(rel?.content_signature || "")
    const updatedDate = this.#releaseDateInfo(releaseDir)?.updatedDate || ""
    const sigStale    = !!(curSig && chosen.sourceSignature && chosen.sourceSignature !== curSig)
    let dateStale = false
    if (updatedDate && chosen.installedAt) {
      const i = Date.parse(chosen.installedAt), u = Date.parse(updatedDate)
      dateStale = Number.isFinite(i) && Number.isFinite(u) && i < u
    }
    return {
      installed:   true,
      installedOn: this.#formatInstallDate(chosen.installedAt),
      update:      sigStale || dateStale,
      releaseName: String(rel?.display_name || releaseDir),
      variant:     String(chosen.variant || ""),
      packageId:   String((rel?.variant_dirs || {})[chosen.variant]
        || Object.values(rel?.variant_dirs || {})[0] || ""),
      // have === 0 is "the record predates the id tracking", not "nothing is
      // installed". Claiming 0 of 14 on a world that installed the release in
      // full before this feature shipped would be the loudest false statement
      // of the lot, so an empty set stays undecided.
      partial:     want > 0 && have > 0 && have < want,
      sceneCoverage: { have, want },
    }
  }

  /**
   * Tooltip for the partly-installed marker. Empty for anything else, so the
   * template can use it as the sole carrier of the partial state's explanation
   * instead of assembling numbers in Handlebars.
   *
   * @param {object} info result of #bmapInstallInfo
   * @returns {string}
   */
  #bmapCoverageLabel(info) {
    if (!info?.partial) return ""
    const c = info.sceneCoverage || { have: 0, want: 0 }
    // No English literal as a fallback. The key is present in all thirteen
    // language files, so the fallback is unreachable, and an unreachable
    // English sentence still ships to every customer.
    try {
      const s = game.i18n.format("BENEOS.Cloud.Card.InstalledPartial", { have: c.have, want: c.want })
      if (s && s !== "BENEOS.Cloud.Card.InstalledPartial") return s
    } catch (_e) { /* fall through */ }
    return ""
  }

  // Plan §33.6 - render an install timestamp for the badge tooltip. Same
  // toLocaleDateString approach as the storefront; degrades to "earlier"
  // when the stored value can't be parsed (e.g. legacy install record).
  #formatInstallDate(iso) {
    if (!iso) return "earlier"
    try {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return "earlier"
      // Force US English (most patrons are US) so the install date reads the
      // same regardless of the client's locale, e.g. "June 25, 2026".
      return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    } catch (_e) { return "earlier" }
  }

  // Small inline byte-formatter for release-card labels. Foundry's
  // numberFormat helper is locale-aware but kicks in heavy when iterating
  // dozens of cards; the cheap inline path is fine here (no decimals for
  // values >= 1 GiB, one decimal otherwise).
  #formatBytes(b) {
    const n = Number(b) || 0
    if (n >= 1024 * 1024 * 1024) {
      const g = n / (1024 * 1024 * 1024)
      return `${(g >= 10 ? g.toFixed(0) : g.toFixed(1))} GB`
    }
    const m = n / (1024 * 1024)
    return `${m >= 100 ? m.toFixed(0) : m.toFixed(1)} MB`
  }

  /* ========== Cleanup ========== */

  async _onClose(options) {
    this.#stopQuoteCycle()
    this.#teardownVirtualization()
    if (this._lazyObserver) { this._lazyObserver.disconnect(); this._lazyObserver = null }
    if (game.beneos?.cloudWindowV2 === this) game.beneos.cloudWindowV2 = undefined
    if (game.beneos?.searchEngine === this) game.beneos.searchEngine = undefined
    if (game.beneosTokens?.searchEngine === this) game.beneosTokens.searchEngine = undefined
    // Defensive: ensure the toolbar-button onChange lock is clear after
    // any close path (X button, ESC, programmatic close). Without this
    // the toolbar can appear stuck "open" if the inner reset setTimeout
    // in beneos_module.js gets dropped (browser tab throttling, error
    // mid-open). Cleared unconditionally — no-op if already false.
    if (typeof Hooks !== "undefined") Hooks._beneosOpenCloudInProgress = false
    return super._onClose?.(options)
  }
}

/* ============================================================================
 * BeneosCloudSettingsV2 — companion settings modal for the Cloud V2 window.
 *
 * Surfaces the most-used module settings (death tokens, nav visibility) plus
 * action buttons (Setup Tour, world-wide asset check) in the same V2 design
 * language so users don't have to detour through Foundry's main settings
 * sheet for routine tasks. Built as a small ApplicationV2 with a single
 * Handlebars part — extending it later means adding a row to the template
 * and (if it's an action) a static handler below.
 * ========================================================================== */

const BENEOS_MODULE_ID = "beneos-module"

export class BeneosCloudSettingsV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "beneos-cloud-settings-v2",
    classes: ["beneos-cloud-app", "bc-settings-window"],
    tag: "section",
    window: {
      title: "BENEOS.Cloud.Settings.Title",
      icon: "fa-solid fa-sliders",
      resizable: false
    },
    position: {
      // Was 420 → 600 → 720. Second user feedback 2026-05-11: "Das
      // Fenster ist relativ breit, aber nur die Hälfte davon wird
      // wirklich genutzt für die Beschreibungstexte." Combined with
      // the CSS fix (flex: 1 1 0 on .bc-settings-row-meta + reduced
      // horizontal padding) this gives the description column ~540 px
      // of usable width — enough for single-line German/CJK hints.
      width: 720,
      height: "auto"
    },
    actions: {
      startSetupTour: BeneosCloudSettingsV2._onStartSetupTour,
      openDocumentation: BeneosCloudSettingsV2._onOpenDocumentation,
      openModuleSettings: BeneosCloudSettingsV2._onOpenModuleSettings,
      disconnectAccount: BeneosCloudSettingsV2._onDisconnectAccount,
      openLogin:         BeneosCloudSettingsV2._onOpenLoginFromSettings,
      openAccountOnline: BeneosCloudSettingsV2._onOpenAccountOnline
    }
  }

  static PARTS = {
    form: { template: "modules/beneos-module/templates/cloud-v2/cloud-settings-v2.hbs" }
  }

  async _prepareContext(_options) {
    const cloud = game.beneos?.cloud
    const isLoggedIn = !!cloud?.isLoggedIn?.()
    const patreonStatus = cloud?.getPatreonStatus?.() ?? ""
    return {
      isCloudLoggedIn:    isLoggedIn,
      patreonStatus
    }
  }

  _safeGetSetting(key) {
    try { return game.settings.get(BENEOS_MODULE_ID, key) }
    catch (err) {
      console.warn("[Beneos Cloud Settings] missing setting", key, err)
      return false
    }
  }

  _onRender(context, options) {
    super._onRender?.(context, options)
    // Live binding for the simple boolean toggles. ApplicationV2 actions
    // would work too, but a single change-listener per render keeps the
    // template free of action wiring per row — every toggle just needs
    // its data-setting-key attribute and the right initial check state.
    // After a successful write, briefly flash the row's "Saved ✓" pill
    // so the user gets confirmation feedback in our own visual language
    // instead of through Foundry's ui.notifications toast (which doesn't
    // match the V2 aesthetic).
    const root = this.element
    if (!root) return
    for (const input of root.querySelectorAll("input[data-setting-key]")) {
      input.addEventListener("change", async ev => {
        // Capture the element + values BEFORE the await — DOM Events 4
        // null out event.currentTarget once the synchronous portion of
        // the handler returns, so reading ev.currentTarget after `await
        // game.settings.set(...)` would crash on either branch (the
        // success path's _flashSavedFeedback closest()-walk OR the catch
        // branch's `.checked = ...` reset). Using the locally-bound
        // element reference keeps both paths safe.
        const inputEl = ev.currentTarget
        const key = inputEl?.dataset?.settingKey
        const val = !!inputEl?.checked
        if (!key) return
        try {
          await game.settings.set(BENEOS_MODULE_ID, key, val)
          this._flashSavedFeedback(inputEl)
        } catch (err) {
          console.warn("[Beneos Cloud Settings] could not write setting", key, err)
          if (inputEl) inputEl.checked = !!this._safeGetSetting(key)
        }
      })
    }
  }

  // Flash the .bc-settings-saved sibling on the same row by toggling a
  // CSS class for ~1.5s. The animation is purely CSS — JS just adds /
  // removes the class.
  _flashSavedFeedback(input) {
    const row = input?.closest?.(".bc-settings-row")
    const savedPill = row?.querySelector(".bc-settings-saved")
    if (!savedPill) return
    savedPill.classList.remove("bc-settings-saved-show")
    // Force reflow so the same class can re-trigger the animation when
    // the user toggles back and forth quickly.
    void savedPill.offsetWidth
    savedPill.classList.add("bc-settings-saved-show")
    if (this._savedTimeout) clearTimeout(this._savedTimeout)
    this._savedTimeout = setTimeout(() => {
      savedPill.classList.remove("bc-settings-saved-show")
    }, 1500)
  }

  /* -------- Actions (static — Foundry binds `this` to the app instance) -------- */

  static async _onStartSetupTour(_event, _target) {
    // Close both this settings modal AND the Cloud-V2 window so the GM
    // has a clean canvas while the tour runs (the tour itself opens
    // dialogs and overlays and benefits from no other Beneos surfaces
    // competing for attention). Both closes are best-effort; the tour
    // launches regardless.
    try { this.close() } catch (e) {}
    try { game.beneos?.cloudWindowV2?.close?.() } catch (e) {}
    try {
      new BeneosStartSetupTour().render(true)
    } catch (err) {
      console.warn("[Beneos Cloud Settings] setup-tour trigger failed", err)
    }
  }

  static async _onOpenDocumentation(_event, _target) {
    // Close this settings modal, then open the documentation wiki.
    try { this.close() } catch (e) {}
    try {
      game.beneos?.openWiki?.()
    } catch (err) {
      console.warn("[Beneos Cloud Settings] open-documentation failed", err)
    }
  }

  // Open Foundry's native module-settings panel, jumped straight to the
  // Beneos category. This is the single source of truth for every advanced
  // toggle (asset repair, death tokens, DM navigation, asset check, ...);
  // the V2 modal carries only fast-access options so nothing is duplicated.
  static async _onOpenModuleSettings(_event, _target) {
    // Close this modal so the Foundry settings window sits on a clean
    // surface — the Cloud-V2 window itself can stay open behind it.
    try { this.close() } catch (e) {}
    try {
      const sheet = game.settings.sheet
      await sheet.render(true)
      // Deep-link to the Beneos category. changeTab is the ApplicationV2
      // tabs API (V13/V14); fall back to clicking the category button if a
      // future core build renames it.
      const jump = () => {
        try { sheet.changeTab?.(BENEOS_MODULE_ID, "categories") }
        catch (e) {
          const btn = sheet.element?.querySelector?.(
            `[data-action="tab"][data-tab="${BENEOS_MODULE_ID}"]`)
          btn?.click?.()
        }
      }
      // render(true) resolves once the DOM exists, but give the tab group a
      // tick to wire up before switching.
      setTimeout(jump, 60)
    } catch (err) {
      console.warn("[Beneos Cloud Settings] open module settings failed", err)
    }
  }

  // Logout from the Cloud session via the settings modal. Always
  // wraps disconnect() in a Confirm dialog — public-Foundry workflows
  // need a fast logout path but should never logout by accident.
  static async _onDisconnectAccount(_event, _target) {
    const cloud = game.beneos?.cloud
    if (!cloud?.isLoggedIn?.()) return
    const DialogV2 = foundry?.applications?.api?.DialogV2
    let proceed = true
    if (DialogV2?.confirm) {
      try {
        proceed = await DialogV2.confirm({
          window: { title: game.i18n.localize("BENEOS.Cloud.Disconnect.ConfirmTitle") },
          content: `<p>${game.i18n.localize("BENEOS.Cloud.Disconnect.ConfirmContent")}</p>`,
          yes: { label: game.i18n.localize("BENEOS.Cloud.Disconnect.ConfirmYes") },
          no:  { label: game.i18n.localize("BENEOS.Cloud.Disconnect.ConfirmNo") },
          rejectClose: false
        })
      } catch (e) {
        proceed = false
      }
    }
    if (!proceed) return
    await cloud.disconnect()
    // Re-render this settings modal so the Account row flips to the
    // signed-out variant without the user having to close & reopen.
    try { this.render({ parts: ["form"] }) } catch (e) {}
  }

  static async _onOpenLoginFromSettings(_event, _target) {
    try {
      new BeneosCloudLogin("cloudSettingsV2").render()
    } catch (err) {
      console.warn("[Beneos Cloud Settings] login launch failed", err)
    }
  }

  // Opens the Beneos Cloud website in a new tab so the user can manage
  // their account online and sign in on the site. This is the action the
  // footer "Account" button used to carry before it moved in here.
  static _onOpenAccountOnline(_event, _target) {
    BeneosUtility.openPostInNewTab?.("https://beneos.cloud/", {})
  }
}
