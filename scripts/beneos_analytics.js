/********************************************************************************* */
// Beneos Analytics - client-side telemetry collector.
//
// Pseudonymous, GM-only, opt-out (default on). Events are queued in memory,
// flushed to https://beneos.cloud/api-analytics.php in batches every 5 minutes
// (or when the queue grows past 50 events, or on tab-unload via sendBeacon).
// A localStorage backup guards against hard world-closes. Every call path is
// wrapped so a telemetry failure can never break the world.
//
// Identity: each event carries the world-scoped `beneos-cloud-foundry-id`
// (a random pseudonym). The server resolves the cloud user_id when the GM is
// logged in, so several worlds of one person can be correlated without PII.
/********************************************************************************* */

import { BeneosUtility } from "./beneos_utility.js";

const ANALYTICS_ENDPOINT = "https://beneos.cloud/api-analytics.php";
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_SAMPLE_MS = 60 * 1000;
const QUEUE_FLUSH_THRESHOLD = 50;
const MAX_BATCH = 50;
const MAX_BACKUP = 200;
const ERROR_THROTTLE_MS = 60 * 1000;
const ACTOR_MODIFY_THROTTLE_MS = 30 * 1000;
const BACKUP_KEY = "beneos-analytics-queue-backup";

export class BeneosAnalytics {

  static queue = []
  static _started = false
  static _worldIdHash = ""
  static _flushTimer = null
  static _sessionSampler = null
  static _sessionStart = 0
  static _maxPlayerCount = 0
  static _distinctScenes = new Set()
  static _errorThrottle = new Map()       // fingerprint -> last emit ts
  static _actorModifyThrottle = new Map() // actorId -> last emit ts
  static _flushing = false

  /********************************************************************************** */
  static moduleId() { return BeneosUtility.moduleID() }

  static moduleVersion() {
    try { return game.modules.get(this.moduleId())?.version || "" } catch (_) { return "" }
  }

  static getFoundryId() {
    try { return game.settings.get(this.moduleId(), "beneos-cloud-foundry-id") || "" } catch (_) { return "" }
  }

  static isEnabled() {
    try {
      if (!game.user?.isGM) return false
      return !!game.settings.get(this.moduleId(), "beneos-analytics-enabled")
    } catch (_) { return false }
  }

  /********************************************************************************** */
  // Lifecycle. Called once from the module `ready` hook for the GM only.
  static async start() {
    if (this._started) return
    this._started = true
    try {
      const raw = window.localStorage?.getItem(BACKUP_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr) && arr.length) this.queue.unshift(...arr)
        window.localStorage.removeItem(BACKUP_KEY)
      }
    } catch (_) { /* corrupt backup, ignore */ }

    this._worldIdHash = await this._sha256(game.world?.id || "")
    this._sessionStart = Date.now()

    this._flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    this._sessionSampler = setInterval(() => this._sampleSession(), SESSION_SAMPLE_MS)
    this._sampleSession()

    window.addEventListener("beforeunload", () => this._onUnload())
    this._installErrorCapture()

    // Backlogged events from a previous session can flush now.
    if (this.queue.length) this.flush()
  }

  /********************************************************************************** */
  // Queue one event. `payload` may carry asset_id / asset_type / bytes which are
  // promoted to dedicated columns; everything else becomes the JSON payload.
  static track(eventType, payload = {}) {
    if (!this.isEnabled()) return
    try {
      this.queue.push(this._buildEvent(eventType, payload))
      if (this.queue.length >= QUEUE_FLUSH_THRESHOLD) this.flush()
    } catch (_) { /* telemetry must never throw into a hook */ }
  }

  static _buildEvent(eventType, payload) {
    const p = payload || {}
    const { asset_id = null, asset_type = null, bytes = null, ...rest } = p
    let data = rest
    try {
      if (JSON.stringify(rest).length > 1000) data = { _truncated: true }
    } catch (_) { data = {} }
    return {
      event_type: String(eventType).slice(0, 32),
      ts: Date.now(),
      asset_id: asset_id ? String(asset_id).slice(0, 32) : null,
      asset_type: asset_type ? String(asset_type).slice(0, 16) : null,
      bytes: (typeof bytes === "number" && isFinite(bytes)) ? Math.max(0, Math.round(bytes)) : null,
      payload: data,
      client_version: this.moduleVersion(),
      world_id_hash: this._worldIdHash
    }
  }

  /********************************************************************************** */
  // Flush up to MAX_BATCH events. On success they are removed from the queue;
  // on failure they stay queued for the next interval (no retry storm).
  static async flush(useBeacon = false) {
    if (!this.queue.length) return
    const foundryId = this.getFoundryId()
    if (!foundryId) return // cannot attribute yet, keep queued

    const url = `${ANALYTICS_ENDPOINT}?ingest=1&foundryId=${encodeURIComponent(foundryId)}`
    const batch = this.queue.slice(0, MAX_BATCH)
    const body = JSON.stringify({ events: batch })

    if (useBeacon && navigator.sendBeacon) {
      try {
        const ok = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))
        if (ok) this.queue.splice(0, batch.length)
      } catch (_) { /* keep queued */ }
      return
    }

    if (this._flushing) return
    this._flushing = true
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      })
      if (resp?.ok) {
        this.queue.splice(0, batch.length)
        if (this.queue.length) setTimeout(() => this.flush(), 250)
      }
    } catch (_) {
      /* network down: keep queue, retry on next interval */
    } finally {
      this._flushing = false
    }
  }

  /********************************************************************************** */
  // One-shot events emitted at world-open (GM session start).
  static emitSessionStartEvents() {
    if (!this.isEnabled()) return
    try {
      this.track("world_open", {
        foundry_version: String(game.version || game.data?.version || ""),
        system_id: game.system?.id || "",
        system_version: game.system?.version || "",
        module_version: this.moduleVersion()
      })
      this.track("hosting_environment", { hosting_type: this.detectHostingType() })
      this.track("companion_modules", {
        has_mlt: !!game.modules.get("multilevel-tokens")?.active,
        has_poi_teleport: !!game.modules.get("poi-teleport")?.active,
        has_tableplay: !!game.modules.get("beneos-tableplay")?.active,
        has_moulinette: !!game.modules.get("moulinette")?.active
      })
      const party = this._partySnapshot()
      if (party) this.track("world_party_snapshot", party)
    } catch (_) { /* swallow */ }
  }

  /********************************************************************************** */
  // Best-effort hosting heuristic, cached in a world setting.
  static detectHostingType() {
    try {
      const cached = game.settings.get(this.moduleId(), "beneos-analytics-hosting-type")
      if (cached) return cached
    } catch (_) { /* not registered yet */ }

    let type = "self"
    try {
      if (typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge) {
        type = "forge"
      } else {
        const host = String(window.location?.hostname || "")
        if (/forge-vtt\.com|forgevtt/i.test(host)) type = "forge"
        else if (/molten/i.test(host)) type = "molten"
        else if (/amazonaws\.com|digitalocean|linode|vultr|herokuapp/i.test(host)) type = "aws"
        else type = "self"
      }
    } catch (_) { type = "unknown" }

    try { game.settings.set(this.moduleId(), "beneos-analytics-hosting-type", type) } catch (_) {}
    return type
  }

  /********************************************************************************** */
  // Anonymous class/level composition of the party. No names, no IDs, no stats.
  static _partySnapshot() {
    try {
      const actors = (game.actors?.contents || []).filter(a => a.type === "character" && a.hasPlayerOwner)
      const sys = game.system?.id || ""
      if (!actors.length) return { system_id: sys, party_size: 0, party_avg_level: 0 }

      const classes = []
      const levels = []
      for (const a of actors) {
        let level = 0
        let classId = "unknown"
        if (sys === "dnd5e") {
          const keys = a.system?.classes ? Object.keys(a.system.classes) : []
          classId = keys[0] || "unknown"
          level = Number(a.system?.details?.level) || 0
        } else if (sys === "pf2e") {
          classId = a.system?.details?.class?.name
            || a.items?.find?.(i => i.type === "class")?.name
            || "unknown"
          level = Number(a.system?.details?.level?.value) || 0
        } else {
          level = Number(a.system?.details?.level?.value ?? a.system?.details?.level) || 0
        }
        levels.push(level)
        if (sys === "dnd5e" || sys === "pf2e") {
          classes.push({ class_id: this.sanitize(classId, 32), level })
        }
      }
      const avg = levels.length
        ? Math.round((levels.reduce((s, n) => s + n, 0) / levels.length) * 10) / 10
        : 0
      const snap = { system_id: sys, party_size: actors.length, party_avg_level: avg }
      if (classes.length) snap.party_classes = classes
      return snap
    } catch (_) { return null }
  }

  /********************************************************************************** */
  // Token-use helpers (called from beneos_module.js hooks).
  static beneosAssetId(doc) {
    try {
      const f = doc?.flags?.world?.beneos
            ?? doc?.actor?.flags?.world?.beneos
            ?? doc?.document?.flags?.world?.beneos
      // Prefer the cloud key (== assets.filename) so the server can resolve it
      // to the asset DB id and these events cross-reference with installs.
      return f?.tokenKey || f?.spellKey || f?.itemKey || f?.fullId || null
    } catch (_) { return null }
  }

  static shouldEmitActorModify(actorId) {
    const now = Date.now()
    const last = this._actorModifyThrottle.get(actorId) || 0
    if (now - last < ACTOR_MODIFY_THROTTLE_MS) return false
    this._actorModifyThrottle.set(actorId, now)
    return true
  }

  /********************************************************************************** */
  // Scene activation. Tracks distinct scenes per session (for maps/session)
  // and emits a one-time scene_activate per Beneos battlemap.
  static trackSceneActivate(scene) {
    try {
      if (!scene?.id) return
      const fresh = !this._distinctScenes.has(scene.id)
      this._distinctScenes.add(scene.id)
      if (fresh && this._isBeneosScene(scene)) {
        this._sha256(scene.id).then(hash => {
          this.track("scene_activate", {
            battlemap_key: this._beneosBattlemapKey(scene),
            scene_id_hash: hash
          })
        })
      }
    } catch (_) { /* swallow */ }
  }

  static _sceneBackgroundSrc(scene) {
    return scene?.firstLevel?.background?.src
        ?? scene?.background?.src
        ?? scene?.img
        ?? ""
  }

  static _isBeneosScene(scene) {
    try {
      if (scene?.flags?.world?.beneos) return true
      const src = String(this._sceneBackgroundSrc(scene))
      return /beneos[_-]?assets|beneos[_-]battlemaps|beneos-module/i.test(src)
    } catch (_) { return false }
  }

  static _beneosBattlemapKey(scene) {
    try {
      const src = String(this._sceneBackgroundSrc(scene))
      const file = src.split("?")[0].split("/").pop() || ""
      return this.sanitize(file, 64)
    } catch (_) { return "" }
  }

  // Emit a battlemap_error for a broken Beneos scene (canvas/texture/tile load
  // failure). Called explicitly from guarded Beneos scene paths and from the
  // global error capture's render-failure heuristic. Throttled per (scene,
  // stack) like beneos_error so a redraw loop cannot flood the queue.
  static trackBattlemapError(scene, err) {
    try {
      if (!scene || !this._isBeneosScene(scene)) return
      const stackTop = this._stackTopLine(err?.stack || "")
      const fp = `battlemap|${scene.id}|${stackTop}`
      const now = Date.now()
      if (now - (this._errorThrottle.get(fp) || 0) < ERROR_THROTTLE_MS) return
      this._errorThrottle.set(fp, now)
      this._sha256(scene.id).then(hash => {
        this.track("battlemap_error", {
          battlemap_key: this._beneosBattlemapKey(scene),
          scene_id_hash: hash,
          message: this.sanitize(err?.message || String(err || ""), 200),
          stack_top_line: stackTop,
          module_version: this.moduleVersion()
        })
      })
    } catch (_) { /* swallow */ }
  }

  static _looksLikeBattlemapError(message) {
    try {
      return /texture|canvas|pixi|tile|wall|spritesheet|sprite|loadTexture|draw|baseTexture|video|webm/i.test(String(message || ""))
    } catch (_) { return false }
  }

  /********************************************************************************** */
  // Session sampling: maximum simultaneously-connected players (anonymous count).
  static _sampleSession() {
    try {
      const players = (game.users?.contents || game.users || []).filter(u => u?.active && !u?.isGM).length
      if (players > this._maxPlayerCount) this._maxPlayerCount = players
    } catch (_) { /* swallow */ }
  }

  static _onUnload() {
    try {
      const durationMin = Math.max(0, Math.round((Date.now() - this._sessionStart) / 60000))
      this.track("session_player_count", {
        max_player_count: this._maxPlayerCount,
        session_duration_minutes: durationMin,
        distinct_scenes_loaded: this._distinctScenes.size,
        system_id: game.system?.id || "",
        hosting_type: this.detectHostingType(),
        module_version: this.moduleVersion()
      })
    } catch (_) { /* swallow */ }
    try { this.flush(true) } catch (_) {}
    try {
      if (this.queue.length && window.localStorage) {
        window.localStorage.setItem(BACKUP_KEY, JSON.stringify(this.queue.slice(0, MAX_BACKUP)))
      }
    } catch (_) {}
  }

  /********************************************************************************** */
  // Error capture (the "error cloud"). Only Beneos-originated errors are kept.
  static _installErrorCapture() {
    try {
      window.addEventListener("error", (event) => {
        try {
          const err = event?.error
          const stack = err?.stack || ""
          if (this._isBeneosStack(stack, event?.filename)) {
            this._captureError(err || { message: event?.message }, "window")
            return
          }
          // Render failures from Foundry core won't carry a beneos-module
          // stack frame, so a broken Beneos map is caught by heuristic: a
          // canvas/texture-flavoured error while a Beneos scene is active.
          if (this._looksLikeBattlemapError(err?.message || event?.message)) {
            this.trackBattlemapError(canvas?.scene, err || { message: event?.message })
          }
        } catch (_) {}
      })
      window.addEventListener("unhandledrejection", (event) => {
        try {
          const reason = event?.reason
          if (this._isBeneosStack(reason?.stack || "")) {
            this._captureError(reason, "promise")
            return
          }
          if (this._looksLikeBattlemapError(reason?.message)) {
            this.trackBattlemapError(canvas?.scene, reason)
          }
        } catch (_) {}
      })
      // Foundry routes Hooks.onError(...) through the "error" hook.
      Hooks.on("error", (location, err, data) => {
        try {
          const loc = String(location || "")
          if (!this._isBeneosStack(err?.stack || "") && !/beneos/i.test(loc)) return
          this._captureError(err, data?.context || loc || "hook", data?.asset_id)
        } catch (_) {}
      })
    } catch (_) { /* swallow */ }
  }

  static _isBeneosStack(stack, filename) {
    try {
      return /beneos-module/.test(String(stack || "")) || /beneos-module/.test(String(filename || ""))
    } catch (_) { return false }
  }

  static _captureError(err, context, assetId) {
    try {
      const errorClass = (err?.name || err?.constructor?.name || "Error").slice(0, 128)
      const message = this.sanitize(err?.message || String(err || ""), 200)
      const stackTop = this._stackTopLine(err?.stack || "")
      const fp = `${errorClass}|${stackTop}`
      const now = Date.now()
      if (now - (this._errorThrottle.get(fp) || 0) < ERROR_THROTTLE_MS) return
      this._errorThrottle.set(fp, now)
      this.track("beneos_error", {
        error_class: errorClass,
        message,
        stack_top_line: stackTop,
        context: context ? String(context).slice(0, 32) : null,
        asset_id: assetId || null,
        module_version: this.moduleVersion()
      })
    } catch (_) { /* swallow */ }
  }

  static _stackTopLine(stack) {
    try {
      const lines = String(stack || "").split("\n").map(l => l.trim()).filter(Boolean)
      let line = lines.find(l => l.includes("beneos-module")) || lines[1] || lines[0] || ""
      const idx = line.indexOf("modules/beneos-module")
      if (idx >= 0) line = line.slice(idx)
      return line.replace(/[)(]/g, "").slice(0, 255)
    } catch (_) { return "" }
  }

  /********************************************************************************** */
  // Trim to `max`, collapse whitespace, mask anything that looks like a long
  // token/secret/id pasted into a search box or surfaced in an error message.
  static sanitize(str, max = 200) {
    try {
      let s = String(str ?? "")
      s = s.replace(/[A-Za-z0-9_\-]{32,}/g, "<id>")
      s = s.replace(/\s+/g, " ").trim()
      return s.slice(0, max)
    } catch (_) { return "" }
  }

  /********************************************************************************** */
  // One-time, GM-only info banner (DSGVO transparency). Shown on the first
  // cloud-window open. Default is opt-out, so this informs rather than asks.
  static async maybeShowConsentBanner() {
    try {
      if (!game.user?.isGM) return
      if (game.settings.get(this.moduleId(), "beneos-analytics-banner-shown")) return
      // Persist immediately so a render race cannot show it twice.
      await game.settings.set(this.moduleId(), "beneos-analytics-banner-shown", true)

      const title = game.i18n.localize("BENEOS.Analytics.Banner.Title") || "Beneos anonymous usage data"
      const body = game.i18n.localize("BENEOS.Analytics.Banner.Body")
        || "Beneos collects anonymous, GM-only usage data (no player data, no names) to find broken content and improve releases. You can turn this off any time in the module settings."
        const settingsLabel = game.i18n.localize("BENEOS.Analytics.Banner.Settings") || "Open settings"
      const okLabel = game.i18n.localize("BENEOS.Analytics.Banner.Ok") || "Got it"

      const DialogV2 = foundry?.applications?.api?.DialogV2
      if (DialogV2) {
        await DialogV2.wait({
          window: { title },
          content: `<p style="margin:0 0 .5em 0">${body}</p>`,
          buttons: [
            {
              action: "settings",
              label: settingsLabel,
              callback: () => { try { game.settings.sheet.render(true) } catch (_) {} }
            },
            { action: "ok", label: okLabel, default: true }
          ]
        })
      } else {
        ui.notifications.info(body, { permanent: true })
      }
    } catch (_) { /* never block the window */ }
  }

  static async _sha256(text) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")))
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
    } catch (_) { return "" }
  }
}
