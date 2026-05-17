/* =============================================================
   Beneos Creature Codex — ApplicationV2 window.
   Welle 1: skeleton with mock data. Welle 2 wires the real data
   adapter (codex-data-adapter.mjs). Tab switching, action handlers
   and HTML enrichment are already in place so the same surface
   serves both modes.
   ============================================================= */

import {
  isListSection,
  tryAcquireLock,
  releaseLock,
  persistSection,
  persistListSection,
  reseedBiographyHash
} from "./codex-edit-controller.mjs"
import { BeneosCodexEntryEditor } from "./codex-list-editor.mjs"
import { PLAYBOOK_PHASES } from "./codex-types.mjs"
import { wireRollableChips } from "./codex-chip-roller.mjs"
import { readAloud, ttsEnabled } from "./codex-theater-state.mjs"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

const TACTICAL_SUBS = [
  "main_mechanics",
  "start_turn",
  "movement",
  "bonus_actions",
  "actions",
  "reactions",
  "lair_actions",
  "recommended_allies",
  "se_tags"
]

// String concat helper used by source-chip.hbs and any other Codex
// partial that needs to build an i18n key from a fragment + variable.
// Beneos namespace prefix to avoid colliding with other modules.
Handlebars.registerHelper("bcConcat", function (...args) {
  // Handlebars passes an Options object as the last argument.
  return args.slice(0, -1).join("")
})

export class BeneosCreatureCodexWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-codex-window",
    classes: ["beneos-codex-app", "beneos_module"],
    tag: "section",
    window: {
      title: "BENEOS.CreatureCodex.WindowTitle",
      icon: "fa-solid fa-book-skull",
      resizable: true,
      minimizable: true
    },
    position: { width: 1240, height: 920 },
    actions: {
      switchTab:   BeneosCreatureCodexWindow._onSwitchTab,
      toggleEdit:  BeneosCreatureCodexWindow._onToggleEdit,
      addSection:  BeneosCreatureCodexWindow._onAddSection,
      saveSection: BeneosCreatureCodexWindow._onSaveSection,
      cancelEdit:  BeneosCreatureCodexWindow._onCancelEdit,
      openJournal: BeneosCreatureCodexWindow._onOpenJournal,
      openSheet:   BeneosCreatureCodexWindow._onOpenSheet,
      reseedMeta:  BeneosCreatureCodexWindow._onReseedMeta,
      openHero:    BeneosCreatureCodexWindow._onOpenHero,
      editEntry:   BeneosCreatureCodexWindow._onEditEntry,
      addEntry:    BeneosCreatureCodexWindow._onAddEntry,
      removeEntry: BeneosCreatureCodexWindow._onRemoveEntry,
      switchTacticalSub: BeneosCreatureCodexWindow._onSwitchTacticalSub,
      downloadPdf: BeneosCreatureCodexWindow._onDownloadPdf,
      // Welle 5c — combat-theater actions (real wiring in 5c)
      theaterRoundDec:       BeneosCreatureCodexWindow._onTheaterRoundDec,
      theaterRoundInc:       BeneosCreatureCodexWindow._onTheaterRoundInc,
      theaterReset:          BeneosCreatureCodexWindow._onTheaterReset,
      theaterReadFirst:      BeneosCreatureCodexWindow._onTheaterReadFirst,
      theaterToggleFirstRead:BeneosCreatureCodexWindow._onTheaterToggleFirstRead,
      theaterReadAbility:    BeneosCreatureCodexWindow._onTheaterReadAbility,
      theaterUseAbility:     BeneosCreatureCodexWindow._onTheaterUseAbility,
      triggerDeath:          BeneosCreatureCodexWindow._onTriggerDeath,
      addAllyToEncounter:    BeneosCreatureCodexWindow._onAddAllyToEncounter,
      // Welle 5h — Tactics mode + filter switching
      switchTacticsMode:     BeneosCreatureCodexWindow._onSwitchTacticsMode,
      filterTacticsCards:    BeneosCreatureCodexWindow._onFilterTacticsCards
    }
  }

  static PARTS = {
    main: { template: "modules/beneos-module/templates/codex/codex-window.hbs" }
  }

  // Welle 5: Master-Mock has 5 tabs. Player view shows the Overview only.
  static GM_TABS     = ["overview", "hooks", "foreshadow", "theater", "tactics"]
  static PLAYER_TABS = ["overview"]

  static TAB_LABELS = {
    overview:  "BENEOS.CreatureCodex.Tabs.overview",
    hooks:     "BENEOS.CreatureCodex.Tabs.hooks",
    foreshadow:"BENEOS.CreatureCodex.Tabs.foreshadowing",
    theater:   "BENEOS.CreatureCodex.Tabs.theater",
    tactics:   "BENEOS.CreatureCodex.Tabs.tactics"
  }
  static TAB_ICONS = {
    overview:  "fa-circle-info",
    hooks:     "fa-star",
    foreshadow:"fa-eye",
    theater:   "fa-mask",
    tactics:   "fa-chess-knight"
  }

  constructor({ actor = null, codexData = null, readonly = false } = {}, options = {}) {
    super(options)
    this.actor = actor
    this.codexData = codexData ?? BeneosCreatureCodexWindow.mockData()
    const syncSafe = typeof window?.BeneosUtility?.isWorkWorld === "function"
      ? window.BeneosUtility.isWorkWorld()
      : true
    this.readonly = readonly || !game.user.isGM || !syncSafe
    this.activeTab = "overview"
    this.editingSection = null
    this.activeTacticalSub = null   // legacy (Welle 4c); kept null in 5b
    this.activeTacticsMode = "playbook"   // Welle 5d / 5h: playbook | cards
    this.activeTacticsFilter = "All"      // Welle 5h: filter for Cards mode
    // Combat-Theater per-window state (Welle 5c). Lives on the
    // instance so closing + reopening the window resets it.
    this.theaterState = { round: 1, firstAppRead: false, usedAbilities: {} }
  }

  get title() {
    const base = game.i18n.localize("BENEOS.CreatureCodex.WindowTitle") || "Creature Codex"
    return this.codexData?.name ? `${base} — ${this.codexData.name}` : base
  }

  async _prepareContext(_options) {
    const allow = game.user.isGM
      ? BeneosCreatureCodexWindow.GM_TABS
      : BeneosCreatureCodexWindow.PLAYER_TABS

    // Player-safe slice (Welle 5: only overview is shared). The Master
    // mock doesn't strip identity fields for players, but we still drop
    // GM-only narrative slots so a PC opening the codex sees no spoilers.
    const data = game.user.isGM
      ? this.codexData
      : BeneosCreatureCodexWindow._sanitizeForPlayer(this.codexData)

    return {
      data,
      tabs: allow.map(id => ({
        id,
        label: BeneosCreatureCodexWindow.TAB_LABELS[id],
        icon:  BeneosCreatureCodexWindow.TAB_ICONS[id],
        active: id === this.activeTab,
        count: BeneosCreatureCodexWindow._tabCount(id, data)
      })),
      activeTab: this.activeTab,
      isGM: game.user.isGM,
      readonly: this.readonly,
      canDownloadPdf: !!data?.sourceMeta?.tokenKey && !!data?.pdfAvailable,
      // Welle 5c — theater state surfaced to template
      theater: this.theaterState,
      // Welle 5d — playbook tab key
      activeTacticsMode: this.activeTacticsMode,
      // Welle 5d — phases mapped onto codexData.tacticalGuide buckets
      playbookPhases: PLAYBOOK_PHASES.map(p => ({
        ...p,
        items: data?.tacticalGuide?.[p.key] ?? []
      })),
      // Welle 5h — Tactics Cards mode state
      activeTacticsFilter: this.activeTacticsFilter,
      tacticsCardsFiltered: BeneosCreatureCodexWindow._filterTacticsCards(
        data?.tacticsCards ?? [], this.activeTacticsFilter
      ),
      tacticsFilterTagsWithActive: (data?.tacticsFilterTags ?? []).map(t => ({
        tag: t, active: t === this.activeTacticsFilter
      }))
    }
  }

  /** Filter the tactics cards by tag. "All" passes through. */
  static _filterTacticsCards(cards, filterTag) {
    if (!filterTag || filterTag === "All") return cards
    return cards.filter(c => c.tags?.includes(filterTag))
  }

  /** Optional integer to render in a tab's count-bubble. */
  static _tabCount(id, data) {
    if (!data) return null
    switch (id) {
      case "hooks":      return data.storyPrompts?.length || null
      case "foreshadow": return data.foreshadowing?.length || null
      case "theater":    return data.abilityPrompts?.length || null
      default:           return null
    }
  }

  async _onRender(_context, _options) {
    // Edit-mode (legacy Welle 4) is disabled in Welle 5 — the new
    // five-tab layout has no .bc-rich-html panes to mount editors
    // into. Skip the edit branch entirely.
    this.editorElement = null

    // Welle 5f: attach click delegation for rollable chips. The Tactics
    // tab is the primary chip surface but Hooks/Foreshadow/Theater may
    // gain chips later, so we wire the whole body once.
    if (this._chipTeardown) { this._chipTeardown(); this._chipTeardown = null }
    const body = this.element.querySelector(".cdx-body")
    if (body) this._chipTeardown = wireRollableChips(body, this.actor)
  }

  /** Inject a fresh <prose-mirror> into the editing section's
   *  container. Editor state lives only for the duration of this edit;
   *  on Save/Cancel the window does a full re-render and the element
   *  is discarded. */
  _mountEditor(sectionPath) {
    const target = this._findEditTarget(sectionPath)
    if (!target) {
      console.warn("[beneos-codex] no edit target for section", sectionPath)
      return
    }
    const initialHtml = this._currentSectionHtml(sectionPath)
    target.innerHTML = ""
    const editor = document.createElement("prose-mirror")
    editor.setAttribute("name", `codex.${sectionPath}`)
    editor.setAttribute("value", initialHtml)
    // Stretch the editor to fill the pane so GMs aren't typing into a
    // 1-line slit. The custom element observes its host's height.
    editor.style.cssText = "display:block; min-height: 240px; width:100%;"
    target.appendChild(editor)
    this.editorElement = editor
  }

  /** Locate the DOM node that currently displays the given section's
   *  read-mode HTML — that's where the editor replaces content. For
   *  tactical sub-cards we resolve to the card's rich-html child. */
  _findEditTarget(sectionPath) {
    if (!this.element) return null
    if (sectionPath.startsWith("tactical.")) {
      const sub = sectionPath.split(".")[1]
      const card = this.element.querySelector(`.bc-tactical-card[data-sub="${sub}"]`)
      if (!card) return null
      return card.querySelector(".bc-rich-html") ?? card
    }
    const pane = this.element.querySelector(`.bc-pane-${this.activeTab}`)
    if (!pane) return null
    // Prefer the section card whose own data marker matches; for
    // combat the pane holds two cards (combatStarter + deathPrompt).
    const card = pane.querySelector(`[data-edit-section="${sectionPath}"]`)
    if (card) return card.querySelector(".bc-rich-html") ?? card
    return pane.querySelector(".bc-rich-html")
        ?? pane.querySelector(".bc-empty-state")
        ?? pane
  }

  /** Resolve the current HTML for the section: edited > parsed >
   *  legacy. Empty sections start the editor with "". */
  _currentSectionHtml(sectionPath) {
    if (sectionPath.startsWith("tactical.")) {
      const sub = sectionPath.split(".")[1]
      const card = this.codexData?.tactical?.cards?.find(c => c.key === sub)
      const v = card?.section?.value
      return typeof v === "string" ? v : ""
    }
    const slot = this.codexData?.[sectionPath]
    const v = slot?.value
    return typeof v === "string" ? v : ""
  }

  // -------------------- Action handlers --------------------

  static _onSwitchTab(event, target) {
    if (this.editingSection) {
      ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.FinishEdit"))
      return
    }
    const tab = target?.dataset?.tab
    if (!tab) return
    this.activeTab = tab
    this.render()
  }

  /** Footer "Edit" button. Maps the active tab to the section path
   *  the controller should lock + later persist. Tactical-tab editing
   *  happens per-card (own pen-icon, hits _onToggleEdit with explicit
   *  `data-section="tactical.<sub>"`), so the footer button only opens
   *  the simple HTML sections directly. */
  static _onToggleEdit(_event, target) {
    if (this.readonly) return
    const explicit = target?.dataset?.section
    let section = explicit ?? this._tabToSection(this.activeTab)
    if (!section) return
    // Welle 4b — list sections route to "add entry" instead of mounting
    // a single ProseMirror (which doesn't fit a list of structured rows).
    if (isListSection(section)) {
      this._addListEntry(section).catch(err =>
        console.error("[beneos-codex] add-entry failed", err))
      return
    }
    if (!tryAcquireLock(this.actor?.id, section)) {
      ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.SectionLocked")
                          ?? "This section is being edited in another window.")
      return
    }
    this.editingSection = section
    this.render()
  }

  static _onCancelEdit(_event, _target) {
    releaseLock(this.actor?.id, this.editingSection)
    this.editingSection = null
    this.editorElement = null
    this.render()
  }

  static async _onSaveSection(_event, _target) {
    const section = this.editingSection
    if (!section) return
    const editor = this.editorElement
                ?? this.element?.querySelector("prose-mirror")
    const html = typeof editor?.getEditorHtml === "function"
      ? editor.getEditorHtml()
      : (editor?.value ?? "")
    const ok = await persistSection(this.actor, section, html)
    if (!ok) return
    releaseLock(this.actor?.id, section)
    this.editingSection = null
    this.editorElement = null
    // Refresh the view-model so the Source chip flips to "edited" and
    // the section reflects the new HTML. Cheaper than re-importing the
    // whole adapter — we patch the local codexData slot directly.
    this._patchSectionLocally(section, html)
    this.render()
  }

  static _onAddSection(_event, target) {
    if (this.readonly) return
    const section = target?.dataset?.section
    if (!section) return
    if (isListSection(section)) {
      this._addListEntry(section).catch(err =>
        console.error("[beneos-codex] add-entry failed", err))
      return
    }
    if (!tryAcquireLock(this.actor?.id, section)) {
      ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.SectionLocked")
                          ?? "This section is being edited in another window.")
      return
    }
    this.editingSection = section
    this.render()
  }

  // -------------------- List section actions (Welle 4b) --------------------

  static async _onEditEntry(_event, target) {
    if (this.readonly) return
    const section = target?.dataset?.section
    const entryId = target?.dataset?.entryId
    if (!section || !entryId) return
    const entries = this._currentListEntries(section)
    const entry = entries.find(e => e.id === entryId)
    if (!entry) return
    const result = await BeneosCodexEntryEditor.open({ section, entry })
    if (!result) return
    const next = entries.map(e => e.id === entryId ? { ...e, ...result } : e)
    await this._persistList(section, next)
  }

  static async _onAddEntry(_event, target) {
    if (this.readonly) return
    const section = target?.dataset?.section
    if (!section) return
    return this._addListEntry(section)
  }

  static async _onRemoveEntry(_event, target) {
    if (this.readonly) return
    const section = target?.dataset?.section
    const entryId = target?.dataset?.entryId
    if (!section || !entryId) return
    const DialogV2 = foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2
    let confirmed = true
    if (DialogV2) {
      confirmed = await DialogV2.confirm({
        window: { title: game.i18n.localize("BENEOS.CreatureCodex.RemoveEntry") },
        content: `<p>${game.i18n.localize("BENEOS.CreatureCodex.ConfirmRemoveEntry")}</p>`
      })
    }
    if (!confirmed) return
    const entries = this._currentListEntries(section).filter(e => e.id !== entryId)
    await this._persistList(section, entries)
  }

  /** Open the entry editor with an empty draft and, if the user saves,
   *  append the result to the section's entry list. Used by both the
   *  "Add entry" button and the section-level toggle/add fallbacks. */
  async _addListEntry(section) {
    const result = await BeneosCodexEntryEditor.open({ section, entry: {} })
    if (!result) return
    const next = [...this._currentListEntries(section), result]
    await this._persistList(section, next)
  }

  /** Read the section's current entry list from codexData (already
   *  merged across the edited/parsed/legacy tiers). */
  _currentListEntries(section) {
    let slot
    switch (section) {
      case "hooks":         slot = this.codexData?.hooks; break
      case "foreshadowing": slot = this.codexData?.foreshadow; break
      case "abilities":     slot = this.codexData?.abilities; break
      default: return []
    }
    return Array.isArray(slot?.value) ? slot.value.map(e => ({ ...e })) : []
  }

  /** Persist a list, patch local codexData so the next render reflects
   *  the change immediately, then re-render. */
  async _persistList(section, entries) {
    const ok = await persistListSection(this.actor, section, entries)
    if (!ok) return
    this._patchListLocally(section, entries)
    this.render()
  }

  _patchListLocally(section, entries) {
    const value = entries
    const wrap = { source: "edited", value }
    if (!this.codexData) return
    switch (section) {
      case "hooks":         this.codexData.hooks = wrap; break
      case "foreshadowing": this.codexData.foreshadow = wrap; break
      case "abilities":     this.codexData.abilities = wrap; break
    }
  }

  /** Map the currently-active tab to a default editable section path.
   *  Combat and Tactical have multiple sections — the footer button is
   *  disabled there in the template, but if called returns the most
   *  obvious slot so we degrade gracefully. */
  _tabToSection(tab) {
    switch (tab) {
      case "lore":           return "lore"
      case "combat":         return "combatStarter"   // deathPrompt edited via its own card
      case "hooks":          return "hooks"           // list — caller will reject
      case "foreshadowing":  return "foreshadowing"   // list — caller will reject
      case "abilities":      return "abilities"      // list — caller will reject
      case "tactical":       return null              // edited per card, not as a whole
      default:               return null
    }
  }

  /** Apply the freshly-saved HTML to the local codexData so the next
   *  re-render shows it with the "edited" source chip without waiting
   *  on a full adapter refresh. */
  _patchSectionLocally(sectionPath, html) {
    if (!this.codexData) return
    if (sectionPath.startsWith("tactical.")) {
      const sub = sectionPath.split(".")[1]
      const card = this.codexData.tactical?.cards?.find(c => c.key === sub)
      if (card) card.section = { source: "edited", value: html }
      this.codexData.tactical.anyContent = !!this.codexData.tactical.cards?.some(
        c => c.section.source !== "empty"
      )
      return
    }
    if (this.codexData[sectionPath]) {
      this.codexData[sectionPath] = { source: "edited", value: html }
    }
  }

  // -------------------- Welle 4c: tactical sub-tab + PDF --------------------

  static _onSwitchTacticalSub(event, target) {
    if (this.editingSection) {
      ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.FinishEdit"))
      return
    }
    const sub = target?.dataset?.sub
    if (!sub) return
    this.activeTacticalSub = sub
    this.render()
  }

  /** PDF-Download via the 2-step signed-URL API (Welle 4d wires the
   *  actual fetch). Lives here so the template's Overview-tab button
   *  triggers it consistently with other actions. */
  static async _onDownloadPdf(_event, _target) {
    const tokenKey = this.codexData?.sourceMeta?.tokenKey
    if (!tokenKey) {
      ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.NoTokenKey")
                          ?? "No token key for PDF download.")
      return
    }
    try {
      const mod = await import("./codex-pdf-service.mjs")
      await mod.downloadCreaturePdf(tokenKey)
    } catch (err) {
      console.error("[beneos-codex] PDF download failed", err)
      ui.notifications.error(game.i18n.format(
        "BENEOS.CreatureCodex.Warning.PdfFailed",
        { reason: err.message ?? "unknown" }
      ))
    }
  }

  // -------------------- Welle 5c — Combat Theater stubs --------------------
  // Real TTS + chat-log + per-actor hooks land in Welle 5c.
  static _onTheaterRoundDec(_event, _target) {
    this.theaterState.round = Math.max(1, (this.theaterState.round ?? 1) - 1)
    this.render()
  }
  static _onTheaterRoundInc(_event, _target) {
    this.theaterState.round = (this.theaterState.round ?? 1) + 1
    this.render()
  }
  static _onTheaterReset(_event, _target) {
    this.theaterState = { round: 1, firstAppRead: false, usedAbilities: {} }
    this.render()
  }
  static async _onTheaterReadFirst(_event, _target) {
    const text = this.codexData?.firstAppearance
    if (!text) return
    await readAloud({
      actor: this.actor,
      label: game.i18n.localize("BENEOS.CreatureCodex.Theater.FirstAppearance"),
      text,
      useTTS: ttsEnabled()
    })
    this.theaterState.firstAppRead = true
    this.render()
  }
  static _onTheaterToggleFirstRead(_event, _target) {
    this.theaterState.firstAppRead = !this.theaterState.firstAppRead
    this.render()
  }
  static async _onTheaterReadAbility(_event, target) {
    const name = target?.dataset?.name
    const ability = this.codexData?.abilityPrompts?.find(a => a.name === name)
    if (!ability) return
    await readAloud({
      actor: this.actor,
      label: ability.name,
      text: ability.text,
      useTTS: ttsEnabled()
    })
  }
  static _onTheaterUseAbility(_event, target) {
    const name = target?.dataset?.name
    if (!name) return
    const used = this.theaterState.usedAbilities ?? (this.theaterState.usedAbilities = {})
    used[name] = (used[name] ?? 0) + 1
    this.render()
  }
  static async _onTriggerDeath(_event, _target) {
    if (!this.codexData?.deathPrompt) return
    const { BeneosCodexDeathPrompt } = await import("./codex-death-prompt.mjs")
    new BeneosCodexDeathPrompt({ codexData: this.codexData, actor: this.actor })
      .render({ force: true })
  }
  static _onAddAllyToEncounter(_event, target) {
    const ally = target?.dataset?.ally
    if (!ally) return
    ui.notifications.info(`Add ${ally} to encounter — wiring planned post-Welle-5.`)
  }

  // -------------------- Welle 5h — Tactics mode / filter --------------------

  static _onSwitchTacticsMode(_event, target) {
    const mode = target?.dataset?.mode
    if (!mode) return
    this.activeTacticsMode = mode
    this.render()
  }

  static _onFilterTacticsCards(_event, target) {
    const tag = target?.dataset?.tag
    if (!tag) return
    this.activeTacticsFilter = tag
    this.render()
  }

  /** Browser-TTS fallback. Welle 5c routes the same text through
   *  Foundry chat-log first; speechSynthesis stays as opt-in. */
  static _speakBrowser(text) {
    if (!text) return
    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.rate = 0.95; u.pitch = 0.9
        window.speechSynthesis.speak(u)
      }
    } catch (_) { /* TTS unavailable in this environment */ }
  }

  /** Release any held lock on window close (X button, ESC, etc.). */
  async close(options = {}) {
    if (this.editingSection) releaseLock(this.actor?.id, this.editingSection)
    if (this._chipTeardown) { this._chipTeardown(); this._chipTeardown = null }
    this.editingSection = null
    this.editorElement = null
    return super.close(options)
  }

  static async _onOpenJournal() {
    // Beneos creature journals live in the world.beneos_module_journal
    // compendium pack, not in game.journal. Prefer the cached UUID and
    // fall back to a pack-id lookup if the meta is missing.
    const uuid = this.codexData?.sourceMeta?.journalUuid
    const id   = this.codexData?.journalId
    let doc = null
    if (uuid) {
      try { doc = await fromUuid(uuid) } catch (_) { /* fall through */ }
    }
    if (!doc && id) {
      const pack = game.packs?.get("world.beneos_module_journal")
      if (pack) {
        try { doc = await pack.getDocument(id) } catch (_) { /* ignore */ }
      }
    }
    doc?.sheet?.render(true)
  }

  static _onOpenSheet() {
    this.actor?.sheet?.render(true)
  }

  static _onOpenHero() {
    // Pop the player-handout / hero image in full size. Foundry V13
    // exposes the ImagePopout under both the legacy global and the new
    // applications namespace — accept either.
    const src = this.codexData?.playerImg || this.codexData?.img
    if (!src) return
    const Popout = foundry?.applications?.apps?.ImagePopout ?? globalThis.ImagePopout
    if (!Popout) return
    new Popout({ src, window: { title: this.codexData?.name ?? "" } })
      .render({ force: true })
  }

  static async _onReseedMeta() {
    if (!await reseedBiographyHash(this.actor)) return
    const biography = this.actor.system?.details?.biography?.value ?? ""
    const { BeneosCreatureCodexParser } = await import("./codex-html-parser.mjs")
    const hash = BeneosCreatureCodexParser.fnv1aHash(biography)
    this.codexData.sourceMeta = { ...this.codexData.sourceMeta, biographyHash: hash }
    this.codexData.biographyDrift = false
    this.render()
    ui.notifications.info(game.i18n.localize("BENEOS.CreatureCodex.Reseed"))
  }

  // -------------------- Helpers --------------------

  /** Welle 5: master-mock schema. Players see hero + lore + tags,
   *  none of the GM-only narrative slots. */
  static _sanitizeForPlayer(d) {
    if (!d) return d
    return {
      ...d,
      storyPrompts:    [],
      foreshadowing:   [],
      firstAppearance: "",
      abilityPrompts:  [],
      deathPrompt:     "",
      tacticalGuide:   { startOfTurn: [], traits: [], movement: [], bonusActions: [], freeActions: [], actions: [] },
      sourceMeta: { tokenKey: d.sourceMeta?.tokenKey }
    }
  }

  /** Build a section in the shape the template expects. Welle 2 will move
      this into codex-data-adapter.mjs. */
  static _sec(source, value) {
    return { source, value }
  }

  /** Welle 5 mock data — mirrors `creature-codex-data.jsx` from the
   *  master-mock for the Cult Possessed reference. Lets developers
   *  F12-open the window and validate layout without an actor. */
  static mockData() {
    return {
      id: "tkn-cult-possessed",
      name: "Cult Possessed",
      type: "Medium Aberration",
      cr: 3,
      biome: "Urban",
      faction: "Cults",
      fightingStyle: ["Pack", "Melee"],
      purpose: ["Damage", "Gimmick", "Minion"],
      sizeTone: { primary: "#3a1a2a", secondary: "#1a0a14", glow: "#a8745a" },
      portraitInitial: "P",
      heroImageUrl: "icons/svg/mystery-man.svg",
      showcase: "A vessel of forbidden powers, the Cult Possessed is what remains when a mortal opens themselves to a patron beyond comprehension.",
      lore: "Not every cult is heard, and not every cultist is rewarded. Yet the gifts of the powers that reign over domains beyond mortal comprehension are rarely subtle, and they wreak havoc upon the human form.",
      storyPrompts: [
        { title: "Old Town", tier: 1, text: "Locals avoid an old tenement after several disappearances." },
        { title: "Noblesse Oblige", tier: 2, text: "A minor noble's heir exhibits violent outbursts and odd growths." },
        { title: "The Broken Chain", tier: 2, text: "A convoy carrying dangerous prisoners was ambushed." }
      ],
      foreshadowing: [
        { title: "Midnight Movements", text: "Robed figures move erratically through alleys.",
          check: { dc: 16, skills: ["Perception"], result: "These figures exhibit physical deformities." } },
        { title: "Unnatural Remains", text: "Morticians report grotesque corpses.",
          check: { dc: 15, skills: ["Medicine", "Arcana"], result: "Aberrant transmutations, forced upon victims." } }
      ],
      firstAppearance: "A disjointed figure emerges from the shadows, its movement twitching and irregular.",
      abilityPrompts: [
        { name: "Bountiful Gifts", text: "The creature convulses, new limbs tearing free." },
        { name: "Parasitic Protrusions", text: "Wet tendrils shoot out from its throat." },
        { name: "Living Shade", text: "Its shadow detaches and slithers toward you." }
      ],
      deathPrompt: "The Possessed stumbles, limbs locking in unnatural angles as it screeches in a voice that is not its own.",
      tacticalGuide: {
        startOfTurn: [
          { text: ["Roll ", { chip: "1d4", kind: "dice" }, " to determine which of the ", { chip: "Bountiful Gifts", kind: "feature" }, " effects becomes active."] }
        ],
        traits: [
          { text: [{ chip: "Plaything of the Gods", kind: "feature" }],
            children: [
              { text: [{ chip: "On 1-10", kind: "context" }, " The ", { chip: "Saving Throw", kind: "save" }, " fails."] },
              { text: [{ chip: "On 11-20", kind: "context" }, " Automatically succeeds."] }
            ] }
        ],
        movement: [
          { text: [{ chip: "MOVEMENT", kind: "action" }, " Get into melee range."] }
        ],
        bonusActions: [
          { text: [{ chip: "BONUS ACTION", kind: "action" }, " Parasitic Protrusions, ", { chip: "DC 15", kind: "dc" }, " ", { chip: "Strength Saving Throw", kind: "save" }, "."] }
        ],
        freeActions: [],
        actions: [
          { text: [{ chip: "Rake and Claw", kind: "feature" }],
            children: [
              { text: [{ chip: "Melee Weapon Attack", kind: "attack" }, " ", { chip: "+5 To Hit", kind: "tohit" }, ", reach ", { chip: "5 Ft.", kind: "range" }, "."] },
              { text: [{ chip: "On Hit", kind: "context" }, " ", { chip: "2d4+3", kind: "dice" }, " Slashing Damage."] }
            ] }
        ]
      },
      recommendedAllies: ["Cult Oracle", "Acolyte of Murder", "Witherflesh Ripper"],
      tags: ["Pack", "Melee", "Damage", "Gimmick", "Minion"],
      pdfAvailable: true,
      tacticsCards: [
        { id: "tac-0", title: "Bountiful Gifts", phase: "startOfTurn", tags: ["Start of Turn", "Damage"], summary: "Roll 1d4 to determine which gift activates." },
        { id: "tac-1", title: "Plaything of the Gods", phase: "traits", tags: ["Trait", "Save"], summary: "On 1-10 the Saving Throw fails; on 11-20 it succeeds." },
        { id: "tac-2", title: "MOVEMENT", phase: "movement", tags: ["Movement"], summary: "Get into melee range." },
        { id: "tac-3", title: "BONUS ACTION", phase: "bonusActions", tags: ["Bonus Action", "Save"], summary: "Parasitic Protrusions DC 15 Strength Saving Throw." },
        { id: "tac-4", title: "Rake and Claw", phase: "actions", tags: ["Action", "Attack", "Damage"], summary: "Melee Weapon Attack +5 To Hit, reach 5 Ft." }
      ],
      tacticsFilterTags: ["All", "Start of Turn", "Action", "Bonus Action", "Free Action", "Trait", "Movement", "Save", "Attack", "Damage", "Condition"],
      sourceMeta: { tokenKey: "tkn-cult-possessed", schemaVersion: 2 },
      actorId: null,
      journalId: null
    }
  }

  /** Legacy mock-data shape — kept for reference / fallback if older
   *  code paths still pass codexData in the Welle-2 envelope shape. */
  static _legacyMockData() {
    const mk = BeneosCreatureCodexWindow._sec
    const tacticalSamples = {
      main_mechanics: "<p><strong>Primordial Pact.</strong> The hag draws power from the bones beneath the lair.</p>",
      bonus_actions:  "<ul><li><strong>Spine Whip.</strong> Reach 15ft, 2d8 piercing.</li></ul>",
      actions:        "<ul><li><strong>Multiattack.</strong> Two attacks with Hexbone Knife.</li><li><strong>Bone Curse.</strong> Save vs disadvantage on next attack.</li></ul>",
      lair_actions:   "<ul><li><strong>Earthbone Effigy.</strong> Summon a minion from the ground.</li></ul>"
    }
    const tacticalCards = TACTICAL_SUBS.map(key => ({
      key,
      label: `BENEOS.CreatureCodex.Tactical.${key}`,
      section: tacticalSamples[key] ? mk("legacy", tacticalSamples[key]) : mk("empty", null)
    }))
    return {
      actorId: null,
      name: "Bone Hag (Mock)",
      img: "icons/svg/mystery-man.svg",
      playerImg: "icons/svg/mystery-man.svg",
      type: "Medium Fey (Hag)",
      variants: 4,
      free: false,
      tags: {
        biom: ["forest", "underground"],
        faction: ["fey", "primordial"],
        type: ["fey"],
        fightingstyle: ["debuff", "area"],
        movement: ["walk", "burrow"],
        purpose: ["boss"],
        source: ["beneos-monthly"],
        campaign: ["month_1"]
      },
      lore: mk("legacy", "<p>The Bone Hag is an ancient fey corrupted by centuries beneath the earth. Where she walks, the soil rises in defense, and the bones of the long-dead bend to her will.</p>"),
      hooks: mk("legacy", [
        { id: "h1", kind: "social",      title: "Whispered Names", body: "<p>A village elder mutters about a witch who 'speaks with the buried.' Anyone gathering local rumours rolls into this thread within a session.</p>" },
        { id: "h2", kind: "exploration", title: "Bone Cairn",      body: "<p>Travellers find a cairn of femurs marked with hex signs. Touching it breaks the seal.</p>" },
        { id: "h3", kind: "combat",      title: "Last Caravan",    body: "<p>A merchant survivor staggers into camp; her wagon is half-buried in a shifting bone-field.</p>" }
      ]),
      foreshadow: mk("legacy", [
        { id: "f1", dc: 13, skills: ["History", "Survival"], body: "<p>The locals avoid this hill at dusk; old maps mark it as a burial ground.</p>" },
        { id: "f2", dc: 15, skills: ["Arcana"],              body: "<p>The hex marks on the cairn are fey runes for binding and tribute.</p>" },
        { id: "f3", dc: 18, skills: ["Arcana", "History"],   body: "<p>This bloodline of hags is tied to a primordial pact that predates the kingdom.</p>" }
      ]),
      combatStarter: mk("legacy", "<blockquote><p>The earth shudders. A figure rises from the loam, bones knitting through her skin like a second armor. \"You should not have come here.\"</p></blockquote>"),
      abilities: mk("legacy", [
        { id: "a1", name: "Spine Whip",     type: "bonus",    description: "<p>Reach 15ft. On hit, the target makes a Strength save or is pulled prone.</p>" },
        { id: "a2", name: "Bone Curse",     type: "action",   description: "<p>Target rolls next attack with disadvantage. Save: WIS DC 16.</p>" },
        { id: "a3", name: "Earthen Maw",    type: "action",   description: "<p>Open a 10ft square pit, dragging creatures within into the bone field.</p>" },
        { id: "a4", name: "Bone Spurs",     type: "reaction", description: "<p>When struck in melee, retaliate with 1d6 piercing.</p>" }
      ]),
      deathPrompt: mk("legacy", "<blockquote><p>Her body crumbles into a heap of dust and bone fragments. A single moan rises from the soil and fades. Somewhere, far beneath the forest, another voice answers — and falls silent.</p></blockquote>"),
      tactical: {
        cards: tacticalCards,
        anyContent: tacticalCards.some(c => c.section.source !== "empty"),
        recommendedAlliesPreview: null
      },
      loreSnippet: "The Bone Hag is an ancient fey corrupted by centuries beneath the earth. Where she walks, the soil rises in defense, and the bones of the long-dead bend to her will.",
      sourceMeta: {
        journalUuid:     "JournalEntry.mock-bone-hag",
        tokenKey:        "month_1_bone_hag",
        analysisSource:  "mock",
        pipelineVersion: 1,
        lastSync:        Date.now(),
        biographyHash:   "sha1:mock"
      },
      journalId:      null,
      biographyDrift: false,
      isWipCreature:  false
    }
  }
}

// Expose globally so the F12 console can open the skeleton without an
// explicit dynamic import. Welle 1 ergonomic affordance only.
globalThis.BeneosCreatureCodexWindow = BeneosCreatureCodexWindow
