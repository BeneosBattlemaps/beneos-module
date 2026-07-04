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
// 15 min instead of 5: the ingest is the most frequent recurring request per
// world and events are not time-critical (OVH DB budget, plan 2026-07-04).
const FLUSH_INTERVAL_MS = 15 * 60 * 1000;
const SESSION_SAMPLE_MS = 60 * 1000;
const QUEUE_FLUSH_THRESHOLD = 50;
const MAX_BATCH = 50;
const MAX_BACKUP = 200;
const MAX_QUEUE = 300;          // hard cap on the in-memory queue
const MAX_FLUSH_FAILURES = 3;   // consecutive failures before the session circuit-breaks
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
  static _consecutiveFailures = 0
  static _disabledForSession = false

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
      // Dev instances run the internal beneos-dev tools module (only developers
      // have it). Never send telemetry from such a world, so development noise and
      // deliberately provoked errors stay out of the production analytics.
      if (game.modules?.get("beneos-dev")?.active) return false
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
    if (!this.isEnabled() || this._disabledForSession) return
    try {
      this.queue.push(this._buildEvent(eventType, payload))
      // Hard-cap the in-memory queue so a stalled endpoint cannot grow it without
      // bound (the localStorage backup is already capped at MAX_BACKUP).
      if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE)
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
    if (this._disabledForSession) return
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
    let ok = false
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      })
      ok = !!resp?.ok
    } catch (_) {
      /* network/CORS down: counted as a failure below, queue kept */
    } finally {
      this._flushing = false
    }

    if (ok) {
      this._consecutiveFailures = 0
      this.queue.splice(0, batch.length)
      if (this.queue.length) setTimeout(() => this.flush(), 250)
      return
    }

    // Circuit-breaker: after MAX_FLUSH_FAILURES consecutive failures (unreachable
    // endpoint, CORS block, firewall) stop flushing for the rest of the session so
    // a dead endpoint can never flood the console or grow the queue. A reload
    // starts fresh and retries; if the endpoint is healthy again, it resumes.
    this._consecutiveFailures++
    if (this._consecutiveFailures >= MAX_FLUSH_FAILURES) this._disableForSession()
  }

  static _disableForSession() {
    this._disabledForSession = true
    try { if (this._flushTimer) clearInterval(this._flushTimer) } catch (_) {}
    this._flushTimer = null
    this.queue = []
    try { window.localStorage?.removeItem(BACKUP_KEY) } catch (_) {}
    try { console.warn("Beneos | analytics endpoint unreachable, telemetry paused for this session.") } catch (_) {}
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
      const sys = game.system?.id || ""
      const owned = (game.actors?.contents || []).filter(a => a.hasPlayerOwner)

      // Diagnostic: which actor types are player-owned in this system. Lets the
      // backend reveal what counts as a player character per system and surface
      // systems we do not yet detect (those show party_size 0 with a non-character
      // type here). Just type strings + counts, no names or IDs.
      const typeCounts = {}
      for (const a of owned) { const t = a.type || "?"; typeCounts[t] = (typeCounts[t] || 0) + 1 }
      const ownedActorTypes = Object.entries(typeCounts).map(([type, n]) => ({ type, n }))

      // Player characters: dnd5e, pf2e and daggerheart all use the "character"
      // actor type. ownedActorTypes above exposes systems that differ.
      const actors = owned.filter(a => a.type === "character")
      if (!actors.length) {
        return { system_id: sys, party_size: 0, party_avg_level: 0, owned_actor_types: ownedActorTypes }
      }

      let pcSheet = ""
      try { pcSheet = actors[0]?.sheet?.constructor?.name || "" } catch (_) {}

      const classes = []
      const levels = []
      for (const a of actors) {
        const { classId, level } = this._resolvePcClass(sys, a)
        if (level) levels.push(level)
        if (classId && classId !== "unknown") classes.push({ class_id: this.sanitize(classId, 32), level: level || 0 })
      }
      const avg = levels.length
        ? Math.round((levels.reduce((s, n) => s + n, 0) / levels.length) * 10) / 10
        : 0
      const snap = {
        system_id: sys,
        party_size: actors.length,
        party_avg_level: avg,
        pc_actor_type: "character",
        pc_sheet: this.sanitize(pcSheet, 48),
        owned_actor_types: ownedActorTypes
      }
      if (classes.length) snap.party_classes = classes
      return snap
    } catch (_) { return null }
  }

  // Per-system player-character class + level resolver. Returns { classId, level }.
  // Kept system-specific because each game system models classes differently.
  static _resolvePcClass(sys, a) {
    try {
      if (sys === "dnd5e") {
        // Modern dnd5e stores classes as embedded items of type "class"; the legacy
        // a.system.classes map no longer populates, which is why class previously
        // came through as "unknown". Prefer the class items, take the highest-level
        // one as the primary class.
        const items = a.items?.contents || a.items || []
        const classItems = items.filter(i => i.type === "class")
        let classId = "unknown"
        if (classItems.length) {
          const primary = classItems.slice().sort((x, y) => (Number(y.system?.levels) || 0) - (Number(x.system?.levels) || 0))[0]
          classId = primary?.name || "unknown"
        } else if (a.system?.classes) {
          classId = Object.keys(a.system.classes)[0] || "unknown"
        }
        return { classId, level: Number(a.system?.details?.level) || 0 }
      }
      if (sys === "pf2e") {
        // pf2e: class is an embedded item of type "class". Animal companions and
        // familiars are player-owned "character" actors without a real class item,
        // so they resolve to "unknown" and drop out of the class breakdown.
        const items = a.items?.contents || a.items || []
        const classItem = items.find(i => i.type === "class")
        const classId = classItem?.name || a.system?.details?.class?.name || "unknown"
        return { classId, level: Number(a.system?.details?.level?.value) || 0 }
      }
      if (sys === "daggerheart") {
        // VERIFY these paths against a live Daggerheart system before relying on the
        // numbers: this dev environment has no Daggerheart install. Best-effort: the
        // class is most likely an embedded item of type "class"; level lives under
        // system.level(.value).
        const items = a.items?.contents || a.items || []
        const classItem = items.find(i => i.type === "class")
        const classId = classItem?.name
          || a.system?.class?.name || a.system?.class?.value || a.system?.details?.class?.name
          || "unknown"
        const level = Number(a.system?.level?.value ?? a.system?.level ?? a.system?.details?.level?.value ?? a.system?.details?.level) || 0
        return { classId, level }
      }
      // Generic fallback: best-effort level only, no class breakdown.
      const level = Number(a.system?.details?.level?.value ?? a.system?.details?.level) || 0
      return { classId: "unknown", level }
    } catch (_) { return { classId: "unknown", level: 0 } }
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
      const segs = src.split("?")[0].split("/").filter(Boolean)
      const file = segs.pop() || ""
      // The containing folder carries the release + map name (e.g.
      // beneos_bm_0031_..._barovia), whereas the bare file is often a generic
      // variant name like 4k_bm.webm that collides across releases. Prefer the
      // folder for a meaningful key; fall back to the file when there is no folder.
      const folder = segs.pop() || ""
      return this.sanitize(folder || file, 96)
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

  static async _sha256(text) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")))
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
    } catch (_) { return "" }
  }
}
