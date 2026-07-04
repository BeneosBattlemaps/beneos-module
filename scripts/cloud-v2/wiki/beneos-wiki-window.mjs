/* Beneos Wiki window.
 *
 * An in-module, customer-facing documentation browser. The visual design is
 * a faithful port of the Beneos Wiki design template (dark fantasy chrome,
 * Cinzel + Signika type, left search/nav rail, article pane with prev/next).
 * Unlike the standalone prototype, every string is resolved through the
 * module's i18n framework (game.i18n + lang/*.json), so the documentation is
 * translatable like the rest of the module. The in-window DE/EN toggle of the
 * prototype is intentionally dropped: the Foundry client language drives the
 * displayed language instead, keeping a single source of truth.
 *
 * Structure (which pages exist, their order, their category) comes from
 * wiki-manifest.mjs. Text (titles, bodies, search keywords, category labels,
 * UI chrome) comes from BENEOS.Wiki.* i18n keys. */

import { WIKI_CATEGORIES, WIKI_PAGES, WIKI_DEFAULT_PAGE } from "./wiki-manifest.mjs"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

const STATE_KEY = "beneosWikiState"

export class BeneosWikiWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-wiki-window",
    classes: ["beneos_module", "beneos-wiki"],
    tag: "section",
    window: {
      title: "BENEOS.Wiki.Title",
      icon: "fas fa-book-open",
      resizable: true,
      minimizable: true
    },
    position: { width: 1190, height: 910 },
    actions: {
      openPage: BeneosWikiWindow._onOpenPage,
      clearSearch: BeneosWikiWindow._onClearSearch,
      gotoPage: BeneosWikiWindow._onGotoPage
    }
  }

  static PARTS = {
    body: { template: "modules/beneos-module/templates/cloud-v2/wiki/beneos-wiki.hbs" }
  }

  constructor(options = {}) {
    super(options)
    this._query = ""
    const { key, anchor } = BeneosWikiWindow._parseTarget(options.startPage)
    this._activeKey = this._restoreActiveKey(key)
    // A section to scroll to once the article has rendered (from a
    // "pageKey#anchor" target), consumed in _onRender.
    this._pendingAnchor = anchor
    this._plainCache = {}
  }

  /* Split a "pageKey" or "pageKey#anchor" target into its parts. */
  static _parseTarget(target) {
    if (typeof target !== "string" || !target) return { key: null, anchor: null }
    const hash = target.indexOf("#")
    if (hash < 0) return { key: target, anchor: null }
    return { key: target.slice(0, hash), anchor: target.slice(hash + 1) || null }
  }

  get title() {
    return game.i18n.localize("BENEOS.Wiki.Title") || "Documentation"
  }

  /* ----------------------------------------------------------------- state */

  _restoreActiveKey(startPage) {
    const valid = (k) => WIKI_PAGES.some((p) => p.key === k)
    if (valid(startPage)) return startPage
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) || "{}")
      if (valid(s.activeKey)) return s.activeKey
    } catch (e) { /* ignore */ }
    return WIKI_DEFAULT_PAGE
  }

  _saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ activeKey: this._activeKey })) }
    catch (e) { /* ignore */ }
  }

  /* ----------------------------------------------------------- i18n helpers */

  _pageTitle(key) {
    const k = `BENEOS.Wiki.Page.${key}.Title`
    const v = game.i18n.localize(k)
    return v === k ? key : v
  }

  _pageBody(key) {
    const k = `BENEOS.Wiki.Page.${key}.Body`
    const v = game.i18n.localize(k)
    return v === k ? "" : v
  }

  _pageSearch(key) {
    const k = `BENEOS.Wiki.Page.${key}.Search`
    const v = game.i18n.localize(k)
    return v === k ? "" : v
  }

  _catLabel(catKey) {
    const k = `BENEOS.Wiki.Cat.${catKey}`
    const v = game.i18n.localize(k)
    return v === k ? catKey : v
  }

  _plainText(key) {
    const cacheKey = `${key}|${game.i18n.lang}`
    if (this._plainCache[cacheKey] != null) return this._plainCache[cacheKey]
    const div = document.createElement("div")
    div.innerHTML = this._pageBody(key)
    const t = (div.textContent || "").replace(/\s+/g, " ").trim()
    this._plainCache[cacheKey] = t
    return t
  }

  /* --------------------------------------------------------------- context */

  async _prepareContext() {
    const ui = {
      doc: game.i18n.localize("BENEOS.Wiki.Title"),
      search: game.i18n.localize("BENEOS.Wiki.Ui.SearchPlaceholder"),
      results: game.i18n.localize("BENEOS.Wiki.Ui.Results"),
      noResult: game.i18n.localize("BENEOS.Wiki.Ui.NoResult"),
      prev: game.i18n.localize("BENEOS.Wiki.Ui.Prev"),
      next: game.i18n.localize("BENEOS.Wiki.Ui.Next"),
      footer: game.i18n.localize("BENEOS.Wiki.Ui.Footer")
    }

    const q = (this._query || "").trim().toLowerCase()
    const searchMode = q.length > 0

    // Category-grouped navigation (only non-empty groups, in manifest order).
    const groups = WIKI_CATEGORIES.map((catKey) => ({
      key: catKey,
      label: this._catLabel(catKey),
      items: WIKI_PAGES.filter((p) => p.category === catKey).map((p) => ({
        key: p.key,
        title: this._pageTitle(p.key),
        active: p.key === this._activeKey
      }))
    })).filter((g) => g.items.length > 0)

    // Search results across every page (title + body + keyword match).
    let results = []
    if (searchMode) {
      for (const p of WIKI_PAGES) {
        const title = this._pageTitle(p.key)
        const text = this._plainText(p.key)
        const hay = `${title}\n${text}\n${this._pageSearch(p.key)}`.toLowerCase()
        if (hay.indexOf(q) < 0) continue
        const lc = text.toLowerCase()
        const i = lc.indexOf(q)
        let snip
        if (i >= 0) {
          const st = Math.max(0, i - 38)
          snip = (st > 0 ? "… " : "") + text.slice(st, i + q.length + 62).trim() + " …"
        } else {
          snip = text.slice(0, 96).trim() + " …"
        }
        results.push({ key: p.key, title, cat: this._catLabel(p.category), snippet: snip })
      }
    }

    // Current article + prev/next within the manifest order.
    const idx = WIKI_PAGES.findIndex((p) => p.key === this._activeKey)
    const page = WIKI_PAGES[idx] || WIKI_PAGES[0]
    const prev = idx > 0 ? WIKI_PAGES[idx - 1] : null
    const next = idx >= 0 && idx < WIKI_PAGES.length - 1 ? WIKI_PAGES[idx + 1] : null
    const isHome = page.key === WIKI_DEFAULT_PAGE

    return {
      ui,
      query: this._query,
      searchMode,
      navMode: !searchMode,
      groups,
      results,
      resultCount: results.length,
      noResults: searchMode && results.length === 0,
      isHome,
      homeKey: WIKI_DEFAULT_PAGE,
      homeTitle: this._pageTitle(WIKI_DEFAULT_PAGE),
      current: {
        title: this._pageTitle(page.key),
        cat: this._catLabel(page.category),
        bodyHtml: this._pageBody(page.key)
      },
      hasPrev: !!prev,
      prevKey: prev?.key || "",
      prevTitle: prev ? this._pageTitle(prev.key) : "",
      hasNext: !!next,
      nextKey: next?.key || "",
      nextTitle: next ? this._pageTitle(next.key) : ""
    }
  }

  /* --------------------------------------------------------------- render */

  _onRender(context, options) {
    const root = this.element

    // Brand the window title bar with the Beneos logo (once), to echo the
    // design template's header without a second, duplicate header bar.
    try {
      const header = root.closest(".application")?.querySelector(".window-header")
                  ?? root.parentElement?.querySelector(".window-header")
      if (header && !header.querySelector(".bw-header-logo")) {
        // The round Beneos logo, masked + gold-tinted via CSS (same SVG the
        // toolbar and Cloud window use), instead of the wide text logo.
        const logo = document.createElement("i")
        logo.className = "bw-header-logo"
        logo.setAttribute("aria-label", "Beneos")
        header.prepend(logo)
      }
    } catch (e) { /* branding is best-effort */ }

    // Live search field (input event, not a click action).
    const input = root.querySelector("[data-wiki-search]")
    if (input) {
      input.addEventListener("input", (ev) => {
        this._query = ev.target.value
        // Preserve caret + focus across the re-render.
        this._refocusSearch = true
        this.render()
      })
      if (this._refocusSearch) {
        this._refocusSearch = false
        const v = input.value
        input.focus()
        input.setSelectionRange(v.length, v.length)
      }
    }

    // In-body wiki links: <a class="wikilink" data-page="key">.
    root.querySelectorAll(".bn-body a.wikilink").forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault()
        const key = a.getAttribute("data-page")
        if (key && WIKI_PAGES.some((p) => p.key === key)) this._goto(key)
      })
    })

    // In-body jump links: <a data-wiki-jump="anchor-id"> smooth-scrolls the
    // article pane to the element carrying that id. This powers a page's own
    // table of contents and its "back to top" links (e.g. the FAQ). We use a
    // data attribute rather than href="#id" on purpose: a real hash href makes
    // the browser navigate (and pollutes the URL), whereas the data-attribute
    // pattern (the same one wikilinks use) keeps the click fully in our hands.
    const jumpPane = root.querySelector("[data-wiki-main]")
    root.querySelectorAll(".bn-body a[data-wiki-jump]").forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault()
        const id = a.getAttribute("data-wiki-jump")
        if (!id || !jumpPane) return
        const target = jumpPane.querySelector(`[id="${CSS.escape(id)}"]`)
        if (!target) return
        const top = jumpPane.scrollTop
          + (target.getBoundingClientRect().top - jumpPane.getBoundingClientRect().top) - 10
        jumpPane.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
      })
    })

    // In-body action buttons: <a data-wiki-launch="setup-tour|open-cloud">.
    // Lets the Welcome page carry working launchers for the Setup Tour and
    // the Cloud window without leaving the i18n-driven content model.
    root.querySelectorAll(".bn-body [data-wiki-launch]").forEach((b) => {
      b.addEventListener("click", (ev) => {
        ev.preventDefault()
        this._launch(b.getAttribute("data-wiki-launch"))
      })
    })

    // Hide images that fail to load (missing screenshots degrade gracefully).
    root.querySelectorAll(".bn-body img").forEach((img) => {
      img.loading = "lazy"
      img.addEventListener("error", () => { img.style.display = "none" })
    })

    // Scroll the article pane to top on page change.
    const main = root.querySelector("[data-wiki-main]")
    if (main && this._scrollTopPending) {
      this._scrollTopPending = false
      main.scrollTop = 0
    }

    // If we arrived via a "pageKey#anchor" target, scroll to that section once
    // layout has settled (the window flex heights are not final in _onRender,
    // so scroll after two paints, same guard the nav-restore uses above).
    if (main && this._pendingAnchor) {
      const anchor = this._pendingAnchor
      this._pendingAnchor = null
      requestAnimationFrame(() => requestAnimationFrame(() => this._scrollToAnchor(anchor)))
    }

    // Preserve the LEFT NAV scroll position across re-renders, so picking a
    // page (or opening an image / entering a section) does not jump the nav
    // back to the top. The article pane still resets to top on page change.
    const nav = root.querySelector(".bw-navscroll")
    if (nav) {
      nav.addEventListener("scroll", () => {
        if (this._restoringNav) return
        this._navScrollTop = nav.scrollTop
      }, { passive: true })
      // Restore after layout settles (the window flex heights are not final in
      // _onRender, so an immediate scrollTop clamps to 0). Guard so the
      // programmatic scroll does not overwrite the saved value.
      if (this._navScrollTop) {
        this._restoringNav = true
        requestAnimationFrame(() => {
          nav.scrollTop = this._navScrollTop
          requestAnimationFrame(() => { this._restoringNav = false })
        })
      }
    }
  }

  _goto(key, anchor = null) {
    // Already on this page (and not filtering by a search): no re-render, but
    // still honour an explicit section jump so a "same page, other section"
    // link works.
    if (key === this._activeKey && !this._query) {
      if (anchor) requestAnimationFrame(() => this._scrollToAnchor(anchor))
      return
    }
    this._activeKey = key
    this._query = ""
    this._scrollTopPending = true
    this._pendingAnchor = anchor
    this._saveState()
    this.render()
  }

  /* Smooth-scroll the article pane to the element carrying the given id.
   * Reuses the same maths as the in-body data-wiki-jump handler and never
   * touches the URL hash. */
  _scrollToAnchor(anchor) {
    const pane = this.element?.querySelector("[data-wiki-main]")
    if (!pane || !anchor) return
    const target = pane.querySelector(`[id="${CSS.escape(anchor)}"]`)
    if (!target) return
    const top = pane.scrollTop
      + (target.getBoundingClientRect().top - pane.getBoundingClientRect().top) - 10
    pane.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
  }

  /* Launch an in-Foundry action from a Welcome-page button. */
  _launch(what) {
    if (what === "setup-tour") {
      try { this.close() } catch (e) { /* ignore */ }
      setTimeout(async () => {
        try {
          const tour = game.tours?.get?.("beneos-module.setup")
          if (tour) { tour.reset?.(); await tour.start() }
          else ui.notifications?.warn(game.i18n.localize("BENEOS.Wiki.Ui.TourMissing") || "Setup Tour not available.")
        } catch (e) { console.error("Beneos | Setup Tour launch failed:", e) }
      }, 150)
    } else if (what === "open-cloud") {
      try { this.close() } catch (e) { /* ignore */ }
      setTimeout(() => {
        try { document.querySelector('[data-control="beneos"]')?.click() }
        catch (e) { console.warn("Beneos | open-cloud from wiki failed:", e) }
      }, 150)
    }
  }

  /* --------------------------------------------------------------- actions */

  static _onOpenPage(event, target) {
    event.preventDefault()
    const key = target.dataset.pageKey
    if (key) this._goto(key)
  }

  static _onGotoPage(event, target) {
    event.preventDefault()
    const key = target.dataset.pageKey
    if (key) this._goto(key)
  }

  static _onClearSearch(event) {
    event.preventDefault()
    this._query = ""
    this._refocusSearch = true
    this.render()
  }

  /* ---------------------------------------------------- link-target helpers */

  /* Enumerate every valid documentation-link target: each page, plus every
   * section anchor (an id on an h2/h3 heading in the article body). Powers
   * game.beneos.listDocTargets() and the Dev Tools hub. Restricting to h2/h3
   * ids skips the TOC container / back-to-top anchors, which are not sections. */
  static docTargets() {
    const parser = new DOMParser()
    return WIKI_PAGES.map((p) => {
      const titleKey = `BENEOS.Wiki.Page.${p.key}.Title`
      const title = game.i18n.localize(titleKey)
      const body = game.i18n.localize(`BENEOS.Wiki.Page.${p.key}.Body`)
      const sections = []
      try {
        const doc = parser.parseFromString(body || "", "text/html")
        for (const el of doc.querySelectorAll("h2[id], h3[id]")) {
          const anchor = el.getAttribute("id")
          if (!anchor) continue
          const label = (el.textContent || "").replace(/\s+/g, " ").trim()
          sections.push({ anchor, label, target: `${p.key}#${anchor}` })
        }
      } catch (e) { /* a malformed body just yields no sections */ }
      return { page: p.key, title: title === titleKey ? p.key : title, target: p.key, sections }
    })
  }

  /* True if "pageKey" or "pageKey#anchor" resolves to a real page (and, when an
   * anchor is given, a real id in that page's body). Used to validate the
   * @doc[...] markers authored into map-note labels. */
  static isValidDocTarget(target) {
    const { key, anchor } = BeneosWikiWindow._parseTarget(target)
    if (!key || !WIKI_PAGES.some((p) => p.key === key)) return false
    if (!anchor) return true
    const body = game.i18n.localize(`BENEOS.Wiki.Page.${key}.Body`)
    try {
      const doc = new DOMParser().parseFromString(body || "", "text/html")
      return !!doc.querySelector(`[id="${CSS.escape(anchor)}"]`)
    } catch (e) { return false }
  }

  /* ----------------------------------------------------------------- open */

  /* Singleton-ish opener: reuse an existing instance, optionally jump to a
   * specific page. Exposed via game.beneos.openWiki(pageKey). */
  static open(startPage = null) {
    const { key, anchor } = BeneosWikiWindow._parseTarget(startPage)
    let win = BeneosWikiWindow._instance
    if (win && win.rendered) {
      if (key) win._goto(key, anchor)
      win.bringToFront?.()
      return win
    }
    win = new BeneosWikiWindow(startPage ? { startPage } : {})
    BeneosWikiWindow._instance = win
    win.render({ force: true })
    return win
  }
}

/* --------------------------------------------------------------- wiring */

// Expose game.beneos.openWiki(pageKey?) for tours, macros and other modules.
Hooks.once("init", () => {
  game.beneos = game.beneos || {}
  game.beneos.openWiki = (pageKey = null) => BeneosWikiWindow.open(pageKey)
  // Discoverability helpers for the "@doc[pageKey#anchor]" note markers: list
  // every valid target and validate one. Also consumed by the beneos-dev hub.
  game.beneos.listDocTargets = () => BeneosWikiWindow.docTargets()
  game.beneos.isValidDocTarget = (target) => BeneosWikiWindow.isValidDocTarget(target)
})

// Add a "Documentation" tool to the Beneos scene-controls group created in
// beneos_module.js. A second getSceneControlButtons hook is fine: the first
// hook builds controls.beneos, this one appends the wiki tool to it.
Hooks.on("getSceneControlButtons", (controls) => {
  const group = controls?.beneos
  if (!group || !group.tools) return
  group.tools["open-wiki"] = {
    name: "open-wiki",
    title: game.i18n.localize("BENEOS.Toolbar.OpenWiki"),
    icon: "fas fa-book-open",
    order: 2,
    visible: true,
    button: true,
    onChange: () => {
      // Defer outside the scene-controls activation stack so the V2 window's
      // _updatePosition does not read a null parent offsetWidth (same race the
      // open-cloud tool guards against).
      setTimeout(() => {
        try { BeneosWikiWindow.open() }
        catch (e) { console.error("Beneos | open-wiki failed:", e) }
        setTimeout(() => {
          try { ui.controls?.activate?.({ control: "tokens", tool: "select" }) }
          catch (e) { /* ignore */ }
        }, 120)
      }, 0)
    }
  }
})
