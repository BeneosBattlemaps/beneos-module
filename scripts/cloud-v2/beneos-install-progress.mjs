/**
 * Plan §18 Phase A — Beneos Battlemap Install Progress Window.
 *
 * Replaces the scene-packer wizard with a custom Beneos-V2-styled progress
 * window. The engine (MoulinetteImporter in Phase A, BeneosBattlemapInstaller
 * in Phase B) is engine-agnostic via attach(engine, progress):
 *
 *   const progress = await BeneosBattlemapInstallProgress.open({label, coverUrl})
 *   const cleanup = BeneosBattlemapInstallProgress.attach(importer, progress)
 *   try { await importer.process() } finally { cleanup() }
 *
 * Toast spam from scene-packer (8 phase toasts + 50+ asset toasts) is
 * suppressed by monkey-patching ScenePacker.logType during the install
 * window. Phase tracking comes from intercepting updateProcessStatus;
 * per-asset progress comes from intercepting displayProgressBar.
 *
 * Phase B (full in-house installer per Plan §7) will keep this class
 * unchanged — only the attach() wiring will hook to a different engine.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

// Phase order matches MoulinetteImporter.process() (line 219 of
// scene-packer/scripts/export-import/moulinette-importer.js). Each entry
// has a localize-able label key and an optional countSource (a path into
// scenePackerInfo.counts) so the phase row can display the document count.
const PHASE_DEFS = [
  { key: "manifest",   labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Manifest",  countSource: null,    weight: 0.5 },
  { key: "system",     labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.System",    countSource: null,    weight: 0.2 },
  // Punkt 8: the native installer's bulk phase — downloading + uploading every
  // asset. The scene-packer path never activates it (no matching status stem).
  { key: "assets",     labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Assets",    countSource: null,    weight: 4.0 },
  { key: "data",       labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Data",      countSource: null,    weight: 0.5 },
  { key: "scenes",     labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Scenes",    countSource: "Scene", weight: 2.5 },
  { key: "actors",     labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Actors",    countSource: "Actor", weight: 1.5 },
  { key: "journals",   labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Journals",  countSource: "JournalEntry", weight: 1.0 },
  { key: "items",      labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Items",     countSource: "Item",  weight: 0.8 },
  { key: "macros",     labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Macros",    countSource: "Macro", weight: 0.3 },
  { key: "playlists",  labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Playlists", countSource: "Playlist", weight: 1.0 },
  { key: "cards",      labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Cards",     countSource: "Cards", weight: 0.2 },
  { key: "rolltables", labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.RollTables", countSource: "RollTable", weight: 0.2 },
  { key: "unrelated",  labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Unrelated", countSource: null,    weight: 0.5 },
  // Der Nachlauf. Diese vier liefen frueher unsichtbar, waehrend die Leiste
  // schon auf 100 Prozent stand: die Pruefung der Dateien, die Vorschaubilder
  // und die Kreaturen aus der Cloud sind echte Netzarbeit, und `finalize` ist
  // der Abschluss. Erst mit ihnen im Nenner heisst "voll" auch "fertig".
  // Reihenfolge zaehlt: `_prepareContext` liest diese Liste von oben nach unten.
  { key: "verify",     labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Verify",    countSource: null,    weight: 0.8 },
  { key: "thumbs",     labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Thumbs",    countSource: null,    weight: 1.0 },
  { key: "creatures",  labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Creatures", countSource: null,    weight: 2.0 },
  { key: "finalize",   labelKey: "BENEOS.Cloud.Bmap.InstallProgress.Phase.Finalize",  countSource: null,    weight: 0.3 },
]

// Match scene-packer's i18n keys when updateProcessStatus fires so we know
// which phase just started. The keys come from
// SCENE-PACKER.importer.creating-documents-* in the scene-packer module.
// We map by stem since the localized strings may include counts/HTML.
const STATUS_KEY_TO_PHASE = new Map([
  ["scene",         "scenes"],
  ["actor",         "actors"],
  ["journal",       "journals"],
  ["item",          "items"],
  ["macro",         "macros"],
  ["playlist",      "playlists"],
  ["card",          "cards"],
  ["rolltable",     "rolltables"],
  ["roll table",    "rolltables"],
  ["unrelated",     "unrelated"],
])

export class BeneosBattlemapInstallProgress extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-bmap-install-progress",
    classes: ["beneos-cloud-app", "bc-install-progress-window"],
    tag: "section",
    window: {
      title: "BENEOS.Cloud.Bmap.InstallProgress.WindowTitle",
      resizable: false,
      minimizable: true,
    },
    position: { width: 480, height: "auto" },
    actions: {
      closeProgress:   BeneosBattlemapInstallProgress._onClose,
      openFirstScene:  BeneosBattlemapInstallProgress._onOpenFirstScene,
      showReport:      BeneosBattlemapInstallProgress._onShowReport,
    },
  }

  static PARTS = {
    body: { template: "modules/beneos-module/templates/cloud-v2/install-progress.hbs" },
  }

  /** Singleton open. Closes any existing instance and opens a fresh one. */
  static async open({ label, coverUrl = null, subtitle = "", packageId = "" } = {}) {
    const existing = Object.values(foundry.applications.instances ?? {})
      .find(a => a instanceof BeneosBattlemapInstallProgress)
    if (existing) await existing.close({ force: true })
    const win = new BeneosBattlemapInstallProgress({ label, coverUrl, subtitle, packageId })
    await win.render(true)
    // Bring the progress window to the foreground but leave the Beneos Cloud
    // window OPEN and interactive, so the user can keep searching/installing
    // while an install runs. The progress window simply floats on top.
    try { win.bringToFront?.() } catch (_e) {}
    return win
  }

  /**
   * Hook the engine into a progress window. Suppresses scene-packer toasts,
   * forwards phase + asset events. Returns a cleanup() to restore originals.
   */
  static attach(importer, progress) {
    const cleanups = []

    // Toast suppression: ScenePacker.logType(name, level, showToast, msg) is
    // the funnel for every scene-packer notification. Wrap it so info-level
    // toasts disappear; warnings and errors still pass through.
    const SP = globalThis.ScenePacker
    if (SP && typeof SP.logType === "function") {
      const orig = SP.logType.bind(SP)
      SP.logType = function (n, level, _show, msg) {
        if (level === "info") return orig(n, level, false, msg)
        return orig(n, level, _show, msg)
      }
      cleanups.push(() => { SP.logType = orig })
    }

    // Phase tracking via updateProcessStatus. scene-packer calls this with
    // an HTML/text snippet at the start of each entity-type phase. We sniff
    // the substring for known stems and advance our phase model.
    if (importer && typeof importer.updateProcessStatus === "function") {
      const orig = importer.updateProcessStatus.bind(importer)
      importer.updateProcessStatus = function (msg) {
        try { progress.handleStatusMessage(String(msg || "")) } catch (_) {}
        return orig(msg)
      }
      cleanups.push(() => { importer.updateProcessStatus = orig })
    }

    // Asset-download progress via displayProgressBar(name, total, current).
    // Fired once per asset download. We drive our current-label + asset
    // counter; the upstream Foundry notification is swallowed.
    if (importer && typeof importer.displayProgressBar === "function") {
      const orig = importer.displayProgressBar.bind(importer)
      importer.displayProgressBar = function (name, total, current) {
        try { progress.handleAssetProgress(name, total, current) } catch (_) {}
        // Do not call orig() — we own the UI now.
      }
      cleanups.push(() => { importer.displayProgressBar = orig })
    }

    // Completion hook — scene-packer fires this at the very end of process().
    // Single-fire so a second install doesn't trigger stale closures.
    const completeHook = Hooks.once("ScenePacker.importMoulinetteComplete", (info) => {
      try { progress.handleCompleteHook(info) } catch (_) {}
    })
    cleanups.push(() => Hooks.off("ScenePacker.importMoulinetteComplete", completeHook))

    return () => { for (const c of cleanups) { try { c() } catch (_) {} } }
  }

  constructor({ label = "", coverUrl = null, subtitle = "", packageId = "" } = {}, options = {}) {
    super(options)
    this._label    = label
    this._coverUrl = coverUrl
    this._subtitle = subtitle
    this._packageId = packageId

    // Phase model: per-key { status, count, current, total }. status adds
    // "hidden" (Punkt 8: native installer hides phases not in this release).
    // Task 6: start every phase HIDDEN except the manifest so the initial view
    // is just "Loading manifest" , no full static phase list flashing before
    // setPhasePlan narrows it to the real per-release scope. The legacy
    // scene-packer path reveals phases via handleStatusMessage as it matches.
    this._phases = new Map(PHASE_DEFS.map(p => [p.key, { status: "hidden", count: null, current: null, total: null }]))
    this._phases.get("manifest").status = "active"
    this._nativeMode = false   // Punkt 8: explicit phase plan instead of stem-sniffing
    this._startTime  = null    // Punkt 8: set on first asset progress, drives ETA

    this._state            = "running" // "running" | "completed" | "failed"
    this._errorMessage     = null
    this._completedMessage = null
    this._currentLabel     = null
    this._currentSpinner   = true
    this._assetCurrent     = 0
    this._assetTotal       = 0
    this._scenePackerInfo  = null
    this._firstSceneId     = null
    this._failedCount      = 0    // live failed-transfer count (robust installer)
    this._reportOpener     = null // () => void, set by the native installer

    // Getting Started Tour: this release auto-launches its first scene (the
    // "Start Here" welcome scene, whose canvasReady starts the tour) via a short
    // countdown once the install finishes. Detected by name so a normal
    // battlemap install keeps the plain "Open first scene" button.
    this._autoStartTour      = /getting[\s_-]*started/i.test(`${label} ${packageId}`)
    this._autoStartCountdown = null   // seconds remaining while the countdown runs
    this._autoStartTimer     = null

    // Buendellauf: EIN Fenster fuer den ganzen Schub.
    //
    // Bis zum 02.09.2026 oeffnete jedes Mitglied sein eigenes Fenster, und
    // `open()` schloss dabei das vorige. Bei neun Releases sah der Kunde neun
    // Fenster nacheinander aufblitzen und wusste an keiner Stelle, wie weit der
    // Schub insgesamt ist.
    //
    // `null` heisst Einzelinstallation, und dann verhaelt sich das Fenster
    // genau wie bisher. Der Buendelfall ist die Erweiterung, nicht der
    // Normalfall, damit die eine bewaehrte Ansicht nicht zwei Bedeutungen
    // bekommt.
    //
    // {name, coverUrl, laufend, teile: [{name, coverUrl, status}]}
    // status: "pending" | "active" | "done" | "skipped" | "error"
    this._buendel = null
  }

  /**
   * Den Buendellauf ankuendigen, bevor das erste Mitglied laeuft.
   *
   * Die Liste steht von Anfang an vollstaendig da, damit der Kunde den Umfang
   * sieht, bevor irgendetwas passiert. Eine Liste, die mitwaechst, beantwortet
   * die einzige Frage nicht, die er in diesem Moment hat: wie lange noch.
   */
  setBundlePlan({ name = "", coverUrl = null, teile = [] } = {}) {
    this._buendel = {
      name,
      coverUrl,
      laufend: -1,
      teile: teile.map(t => ({
        name: String(t?.name || ""),
        coverUrl: t?.coverUrl || null,
        status: "pending",
      })),
    }
    this.render(false)
  }

  /** Ein Mitglied auf einen Stand setzen. Ausserhalb eines Buendels folgenlos. */
  setBundleItem(index, status = "active") {
    if (!this._buendel) return
    const t = this._buendel.teile[index]
    if (!t) return
    t.status = status
    if (status === "active") {
      this._buendel.laufend = index
      // Die Kopfzeile nennt das laufende Release, damit die Phasenliste
      // darunter eine Ueberschrift hat. Ohne das steht dort der Buendelname
      // ueber den Phasen eines einzelnen Mitglieds.
      this._label = t.name || this._label
    }
    this.render(false)
  }

  /* ========== Engine event handlers (called from attach()) ========== */

  /**
   * Punkt 8: native-installer phase plan. Hides every phase row, then the
   * installer reveals only the phases that actually exist in this release via
   * revealPhase(), each with its real count. manifest + system are marked done
   * (they ran to reach this point). Replaces the scene-packer stem-sniffing so
   * absent types (no actors / no rolltables) never show.
   */
  beginNativeRun() {
    this._nativeMode = true
    for (const v of this._phases.values()) {
      v.status = "hidden"; v.current = null; v.total = null; v.count = null
    }
    const m = this._phases.get("manifest"); if (m) m.status = "done"
    const s = this._phases.get("system");   if (s) s.status = "done"
    this.render(false)
  }

  /**
   * Task 6: declare the FULL phase plan up front. Every phase that is part of
   * this install is shown immediately as "pending" (greyed out) with its known
   * total and a "0 of N" count; phases not in the plan are hidden. manifest +
   * system are marked done (we reached this point). revealPhase() then fills
   * each phase's `current` as it runs, so the user watches "0 of N" -> "N of N".
   * Supersedes beginNativeRun (which hid everything and revealed lazily).
   */
  setPhasePlan(plan) {
    this._nativeMode = true
    // `total: null` heisst "ein Schritt, keine Menge" (etwa `finalize`). Die
    // Phase zaehlt dann mit ihrem Gewicht, zeigt aber kein "0 von 0", was eine
    // Menge behaupten wuerde, die es nicht gibt.
    const present = new Map((Array.isArray(plan) ? plan : []).map(p => [p.key, p.total == null ? null : (Number(p.total) || 0)]))
    for (const [k, v] of this._phases) {
      if (k === "manifest" || k === "system") { v.status = "done"; v.current = null; v.total = null; v.count = null; continue }
      if (present.has(k)) {
        v.status = "pending"; v.total = present.get(k); v.current = (v.total == null) ? null : 0; v.count = null
      } else {
        v.status = "hidden"; v.current = null; v.total = null; v.count = null
      }
    }
    if (this._startTime == null) this._startTime = Date.now()
    this.render(false)
  }

  /** Punkt 8: reveal / update one native phase with its live count. */
  revealPhase(key, { status = "active", current = null, total = null } = {}) {
    const p = this._phases.get(key)
    if (!p) return
    if (status) p.status = status
    if (current != null) p.current = current
    if (total != null)   p.total = total
    if (current != null && total != null) { this._assetCurrent = current; this._assetTotal = total }
    if (this._startTime == null) this._startTime = Date.now()
    this.render(false)
  }

  handleStatusMessage(msg) {
    // Punkt 8: in native mode the phase model is driven explicitly by
    // revealPhase(); status messages only update the current-operation label.
    if (this._nativeMode) {
      this._currentLabel = String(msg || "").replace(/<[^>]*>/g, "").trim().slice(0, 80) || this._currentLabel
      this.render(false)
      return
    }
    // Mark the "prefix" phases done on the first status (we know manifest +
    // system + data passed by the time scene-packer emits its first
    // creating-documents call).
    for (const k of ["manifest", "system", "data"]) {
      const p = this._phases.get(k)
      if (p.status === "pending" || p.status === "active") p.status = "done"
    }
    const lower = msg.toLowerCase()
    let matched = null
    for (const [stem, phaseKey] of STATUS_KEY_TO_PHASE) {
      if (lower.includes(stem)) { matched = phaseKey; break }
    }
    if (matched) {
      // Mark previous active phase done, mark new one active.
      for (const [k, v] of this._phases) {
        if (v.status === "active") v.status = "done"
      }
      const next = this._phases.get(matched)
      if (next && next.status !== "done") next.status = "active"
      this._currentLabel = msg.replace(/<[^>]*>/g, "").trim().slice(0, 80)
    } else {
      // Fall-through: just update the current-label.
      this._currentLabel = msg.replace(/<[^>]*>/g, "").trim().slice(0, 80) || this._currentLabel
    }
    this.render(false)
  }

  handleAssetProgress(name, total, current) {
    if (this._startTime == null) this._startTime = Date.now()   // Punkt 8: ETA clock
    this._assetTotal   = Number(total) || 0
    this._assetCurrent = Number(current) || 0
    this._currentLabel = `${name} — ${this._assetCurrent} / ${this._assetTotal}`
    this.render(false)
  }

  handleCompleteHook(info) {
    this._scenePackerInfo = info?.info || null
    // Wire phase counts from info.counts now that the importer has finished
    // and the metadata is reliable.
    const counts = this._scenePackerInfo?.counts || {}
    for (const def of PHASE_DEFS) {
      if (!def.countSource) continue
      const c = counts[def.countSource]
      const p = this._phases.get(def.key)
      if (typeof c === "number") p.count = c
      // Skip rows with 0 count so the UI doesn't lie about pending work.
      if (p.status === "pending" && (c === 0 || c === undefined || c === null)) {
        p.status = "skipped"
      }
    }
    this._firstSceneId = this._scenePackerInfo?.scenes?.[0]?.id || null
  }

  /** Live count of failed transfers, surfaced during the run (native installer). */
  handleFailureCount(n) {
    this._failedCount = Number(n) || 0
    if (this._state === "running") this.render(false)
  }

  /**
   * Task E: the native installer tells us which scene the "Open" button should
   * open (the installed scene for a single-scene install, the Overview scene
   * for a release). Enables the Open button once a terminal state is reached.
   */
  setOpenScene(sceneId) {
    this._firstSceneId = sceneId || null
    if (this._state !== "running") this.render(false)
  }

  /**
   * Second-layer "Adding Beneos Creatures" block at the bottom of the window.
   * Gold + paw when the user is an active token-patron (the creatures are being
   * pulled from the cloud); grey + red X when not (info only, nothing installed).
   * Only shown when the release actually references Beneos creatures.
   */
  setCreatureBlock({ present = false, isPatron = false, count = 0, installed = 0, state = "pending" } = {}) {
    this._creatureBlock = present ? { isPatron: !!isPatron, count, installed, state } : null
    this.render(false)
  }

  /** Register a callback that re-opens the post-install report dialog. */
  setReportOpener(fn) {
    this._reportOpener = (typeof fn === "function") ? fn : null
    // Re-render so the "Show report" button appears once a terminal state is set.
    if (this._state !== "running") this.render(false)
  }

  /** Completed, but some assets/documents failed. Distinct from a hard failure. */
  markCompletedWithIssues({ failed = 0 } = {}) {
    this._state = "completed-with-issues"
    this._currentLabel   = null
    this._currentSpinner = false
    this._failedCount    = failed || this._failedCount
    let msg
    try { msg = game.i18n.format("BENEOS.Cloud.Bmap.InstallProgress.CompletedWithIssuesBody", { count: this._failedCount }) } catch (_) {}
    if (!msg || msg.includes("CompletedWithIssues")) {
      msg = `Install finished, but ${this._failedCount} item(s) could not be transferred. See the report for what failed and why.`
    }
    this._completedMessage = msg
    for (const v of this._phases.values()) {
      if (v.status === "active" || v.status === "pending") v.status = "done"
    }
    this.render(false)
    this.#maybeAutoLaunchTour()
  }

  markCompleted({ noChanges = false } = {}) {
    this._state = "completed"
    this._currentLabel   = null
    this._currentSpinner = false
    this._completedMessage = game.i18n.localize(noChanges
      ? "BENEOS.Cloud.Bmap.InstallProgress.CompletedNoChangesBody"
      : "BENEOS.Cloud.Bmap.InstallProgress.CompletedBody")
    // Any phase still active or pending => mark done (process() returned, so
    // we trust scene-packer's "everything ran" semantics).
    for (const v of this._phases.values()) {
      if (v.status === "active" || v.status === "pending") v.status = "done"
    }
    this.render(false)
    this.#maybeAutoLaunchTour()
  }

  markFailed(message) {
    this._state = "failed"
    this._currentLabel   = null
    this._currentSpinner = false
    this._errorMessage   = message || game.i18n.localize("BENEOS.Cloud.Bmap.InstallProgress.UnknownError")
    for (const v of this._phases.values()) {
      if (v.status === "active") v.status = "error"
    }
    this.render(false)
  }

  async close(options) {
    if (this._autoStartTimer) { clearInterval(this._autoStartTimer); this._autoStartTimer = null }
    return super.close(options)
  }

  /* ========== Getting Started auto-launch ========== */

  // Kick off the 3-second countdown that opens the first scene (the "Start Here"
  // welcome scene, whose canvasReady starts the Getting Started tour). Only for
  // the Getting Started release, and only once a first scene is known.
  #maybeAutoLaunchTour() {
    if (!this._autoStartTour || !this._firstSceneId) return
    if (this._autoStartTimer) return
    // Tell the tour orchestrator we own the post-install handoff so it does not
    // also pop its own "start the tutorial?" dialog on the releaseInstalled hook.
    try { globalThis.__beneosGsAutoStartOwned = true } catch (_e) {}
    this._autoStartCountdown = 3
    this.render(false)
    this._autoStartTimer = setInterval(() => {
      this._autoStartCountdown -= 1
      if (this._autoStartCountdown > 0) { this.render(false); return }
      clearInterval(this._autoStartTimer); this._autoStartTimer = null
      this._autoStartCountdown = null
      this.#launchFirstScene()
    }, 1000)
  }

  #launchFirstScene() {
    const scene = this._firstSceneId ? game.scenes?.get?.(this._firstSceneId) : null
    try { this.close({ force: true }) } catch (_e) {}
    // Open the scene a tick after the window closes so its canvasReady
    // auto-start (the Getting Started tour) is not covered by the closing window.
    setTimeout(() => {
      try {
        if (!scene) return
        if (typeof scene.view === "function") scene.view()
        else scene.activate?.()
      } catch (_e) {}
    }, 150)
  }

  /* ========== Render context ========== */

  async _prepareContext() {
    // Punkt 8: only render phases that are part of this install. Hidden phases
    // (absent doc types) are dropped; visible phases carry a "x / y" count.
    const phases = PHASE_DEFS
      .filter(def => this._phases.get(def.key).status !== "hidden")
      .map(def => {
        const cur = this._phases.get(def.key)
        return {
          key:        def.key,
          labelKey:   def.labelKey,
          status:     cur.status,
          count:      cur.count,
          countLabel: this.#phaseCountLabel(cur),
        }
      })

    // Total progress: phase weights + asset sub-fraction inside the active
    // phase. Hidden phases are excluded from the denominator so the bar
    // reflects the actual work for this install (Punkt 8).
    let totalWeight = 0
    let doneWeight  = 0
    for (const def of PHASE_DEFS) {
      const v = this._phases.get(def.key)
      if (v.status === "hidden") continue
      totalWeight += def.weight
      if (v.status === "done" || v.status === "skipped") doneWeight += def.weight
    }
    let assetFraction = 0
    if (this._assetTotal > 0) assetFraction = Math.min(1, this._assetCurrent / this._assetTotal)
    // Add the in-progress fraction of the currently-active phase so the bar
    // moves while it runs (use the phase's own current/total when available).
    for (const def of PHASE_DEFS) {
      const v = this._phases.get(def.key)
      if (v.status === "active") {
        let frac = assetFraction || 0.5
        if (v.total > 0 && v.current != null) frac = Math.min(1, v.current / v.total)
        doneWeight += def.weight * frac
        break
      }
    }
    const totalPct = totalWeight > 0 ? Math.min(100, Math.round((doneWeight / totalWeight) * 100)) : 0

    return {
      state:            this._state,
      label:            this._label,
      coverUrl:         this._coverUrl,
      subtitle:         this._subtitle,
      totalPct,
      buendel:          this.#buendelKontext(totalPct),
      etaLabel:         this.#etaLabel(totalPct),
      currentLabel:     this._currentLabel,
      currentSpinner:   this._currentSpinner && this._state === "running",
      phases,
      errorMessage:     this._errorMessage,
      completedMessage: this._completedMessage,
      closeDisabled:    this._state === "running",
      showOpenScenes:   (this._state === "completed" || this._state === "completed-with-issues") && !!this._firstSceneId,
      // Getting Started auto-launch: a hint while installing, then a live
      // countdown once complete. Distinct from the plain "Open first scene".
      autoStartTour:    this._autoStartTour,
      autoStartHint:    this._autoStartTour && this._state === "running",
      autoStartMessage: (this._autoStartTour && this._autoStartCountdown != null)
        ? game.i18n.format("BENEOS.Cloud.Bmap.InstallProgress.AutoStartCountdown", { seconds: this._autoStartCountdown })
        : null,
      hasIssues:        this._state === "completed-with-issues",
      failedCount:      this._failedCount,
      failedLabel:      this._failedCount ? this.#failedLabel(this._failedCount) : null,
      showReportButton: (this._state === "completed-with-issues" || this._state === "failed") && typeof this._reportOpener === "function",
      creatureBlock:    this._creatureBlock ? {
        isPatron:   this._creatureBlock.isPatron,
        state:      this._creatureBlock.state,
        countLabel: `${this._creatureBlock.installed}/${this._creatureBlock.count}`,
        // Schon waehrend des Laufs, nicht erst danach. Die Zahl erst am Ende zu
        // zeigen war die Stelle, an der das Fenster fertig aussah und nicht war.
        showCount:  this._creatureBlock.isPatron && this._creatureBlock.state !== "skipped",
      } : null,
    }
  }

  /**
   * "x of y" count chip for a phase row. Task 6: with a known total we always
   * show "current of total" (current = total once done) so the user watches the
   * fill from "0 of N" to "N of N". Falls back to a bare count when no total.
   */
  /**
   * Das Mosaik und die Releaseliste fuer den Buendellauf.
   *
   * Jedes Release bekommt eine Kachel gleicher Breite, nebeneinander auf die
   * Breite des Fensterbildes verteilt. Die Kachel traegt das Titelbild ihres
   * Release, grau, und faerbt sich, sobald dieses Release fertig ist. Die
   * laufende Kachel faerbt sich anteilig mit dem Fortschritt dieses einen
   * Release, damit sich ueberhaupt etwas bewegt, solange ein grosses Release
   * laeuft.
   *
   * Ohne Buendel: `null`, und die Vorlage zeichnet das bisherige Einzelbild.
   *
   * @param {number} totalPct Fortschritt des LAUFENDEN Release, 0 bis 100
   */
  #buendelKontext(totalPct) {
    const b = this._buendel
    if (!b || !b.teile.length) return null
    const n = b.teile.length
    const breite = 100 / n
    const kacheln = b.teile.map((t, i) => {
      // Fertig heisst voll. Uebersprungen zaehlt als fertig: es ist nichts mehr
      // zu tun, und eine graue Luecke mitten in der Reihe laese den Kunden
      // suchen, was dort fehlgeschlagen sei.
      let fuellung = 0
      if (t.status === "done" || t.status === "skipped") fuellung = 100
      else if (t.status === "active") fuellung = Math.max(0, Math.min(100, Number(totalPct) || 0))
      return {
        name:      t.name,
        coverUrl:  t.coverUrl,
        status:    t.status,
        breitePct: breite.toFixed(4),
        linksPct:  (i * breite).toFixed(4),
        // `inset` schneidet von rechts weg, deshalb der Gegenwert.
        restPct:   (100 - fuellung).toFixed(2),
        aktiv:     t.status === "active",
      }
    })
    const fertig = b.teile.filter(t => t.status === "done" || t.status === "skipped").length
    // Der Name des laufenden Release, und nur dann. Laeuft keines, stuende dort
    // sonst der Buendelname ein zweites Mal direkt unter sich selbst.
    const laufendes = b.teile[b.laufend]
    return {
      name:      b.name,
      laufendName: (laufendes && laufendes.status === "active") ? laufendes.name : "",
      coverUrl:  b.coverUrl,
      kacheln,
      teile:     b.teile,
      fertig,
      gesamt:    n,
      // Der Balken des Buendels: fertige Releases plus der Anteil des laufenden.
      gesamtPct: Math.round(((fertig + (b.laufend >= 0 && b.teile[b.laufend]?.status === "active"
        ? (Number(totalPct) || 0) / 100 : 0)) / n) * 100),
    }
  }

  #phaseCountLabel(cur) {
    if (cur.total == null) return (cur.count != null ? String(cur.count) : null)
    const current = (cur.status === "done") ? cur.total : (cur.current ?? 0)
    try { return game.i18n.format("BENEOS.Cloud.Bmap.InstallProgress.PhaseCount", { current, total: cur.total }) } catch (_) {}
    return `${current} of ${cur.total}`
  }

  /**
   * Punkt 8: estimated time remaining from elapsed time and the weighted
   * total-progress fraction. Only shown while running with enough signal to
   * be meaningful (>3% done and >1.5s elapsed) so it doesn't flicker wild
   * numbers at the very start.
   */
  #etaLabel(totalPct) {
    if (this._state !== "running" || this._startTime == null) return null
    const elapsed = Date.now() - this._startTime
    if (totalPct < 3 || elapsed < 1500) return null
    const frac = totalPct / 100
    const remainingMs = elapsed * (1 - frac) / frac
    if (!isFinite(remainingMs) || remainingMs <= 0) return null
    const secs = Math.round(remainingMs / 1000)
    const mm = Math.floor(secs / 60)
    const ss = secs % 60
    const time = mm > 0 ? `${mm}m ${String(ss).padStart(2, "0")}s` : `${ss}s`
    try { return game.i18n.format("BENEOS.Cloud.Bmap.InstallProgress.Eta", { time }) } catch (_) {}
    return `Est. ${time} remaining`
  }

  #failedLabel(n) {
    let s
    try { s = game.i18n.format("BENEOS.Cloud.Bmap.InstallProgress.FailedSoFar", { count: n }) } catch (_) {}
    if (!s || s.includes("FailedSoFar")) s = `${n} failed so far`
    return s
  }

  /* ========== Actions ========== */

  static _onClose(_event, _target) {
    this.close()
  }

  static _onOpenFirstScene(_event, _target) {
    // "Start now" during the Getting Started countdown: cancel the timer.
    if (this._autoStartTimer) {
      clearInterval(this._autoStartTimer); this._autoStartTimer = null; this._autoStartCountdown = null
    }
    const id = this._firstSceneId
    if (!id) return
    const scene = game.scenes?.get?.(id)
    if (!scene) return
    // For the Getting Started auto-launch, close the window first so the tour is
    // not covered, then open the scene (its canvasReady starts the tour).
    if (this._autoStartTour) {
      try { this.close({ force: true }) } catch (_e) {}
      setTimeout(() => {
        try { (typeof scene.view === "function" ? scene.view() : scene.activate?.()) } catch (_e) {}
      }, 150)
      return
    }
    // Task E: open the scene on the canvas (view) , the most useful action for
    // "the map is ready". Fall back to the sheet if view isn't available.
    if (typeof scene.view === "function") scene.view()
    else if (typeof scene.activate === "function") scene.activate()
    else scene.sheet?.render?.(true)
  }

  static _onShowReport(_event, _target) {
    try { this._reportOpener?.() } catch (e) { console.warn("BeneosInstallProgress | report open failed", e) }
  }
}

// Expose globally for the scenepacker wrapper to construct without an import
// cycle (beneos-scenepacker.js is a regular script loaded before this ESM).
globalThis.BeneosBattlemapInstallProgress = BeneosBattlemapInstallProgress
