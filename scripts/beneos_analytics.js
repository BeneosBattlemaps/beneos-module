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
const BREADCRUMB_MAX = 5;                         // last N event types kept for error context
const CODEX_THROTTLE_MS = 10 * 60 * 1000;         // same creature+section max once per 10 min
const SPELL_CAST_SESSION_CAP = 20;                // per spell key per session (macro-spam guard)
const ITEM_ADD_WINDOW_MS = 5 * 1000;              // bulk-import aggregation window
const SCENE_TIME_MIN_S = 60;                      // ignore sub-minute visits
const SCENE_TIME_CAP_S = 6 * 3600;                // idle/overnight cap per visit
// Actor types that count as a player character, lowercased. Not a guess: every
// entry beyond "character" was observed in the field on a player-owned actor in
// a world that reported party_size 0. See _partySnapshot.
const PC_ACTOR_TYPES = new Set([
  "character", "player", "playercharacter", "pc", "hero", "protagonist",
  "vampire", "mortal", "werewolf", "mage"
]);

const MODINV_INTERVAL_MS = 7 * 24 * 3600 * 1000;  // module inventory at most weekly
// Chunk budget for the module inventory.
//
// This said 1800 and the comment said "stay under the server payload cap",
// which was true of the SERVER cap (2000) and wrong about the CLIENT one
// (PAYLOAD_MAX, 1000). Every chunk that actually filled up was therefore
// discarded before it was ever sent. Measured on 2026-08-17: 476 of 751
// module_inventory events arrived empty, 63 percent.
const MODINV_CHUNK_JSON_MAX = 900;                // must stay under PAYLOAD_MAX
// Events suppressed while the getting-started tour auto-installs its creature,
// so the scripted install does not read as organic play.
const TOUR_SUPPRESSED_EVENTS = new Set([
  "canvas_drop_local", "canvas_drop_cloud", "combat_add", "combat_remove",
  "actor_modify_name", "actor_modify_stats", "install_initiated"
]);

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
  static _breadcrumbs = []                 // last N {t, ts} event types (error context)
  static _codexThrottle = new Map()        // "tokenKey|section" -> last emit ts
  static _spellCastCounts = new Map()      // spellKey -> casts this session
  static _itemAddBuffer = new Map()        // "slug|parentType" -> count (5s window)
  static _itemAddTimer = null
  static _combats = new Map()              // combatId -> { battlemapKey, roster: Map }
  static _currentScene = null              // { key, ts } for time-on-map deltas
  static suppressTourTracking = false      // set by the tour auto-install

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
    if (this.suppressTourTracking && TOUR_SUPPRESSED_EVENTS.has(String(eventType))) return
    try {
      // Breadcrumb ring buffer: event types only (no payload), attached to
      // beneos_error so we know what happened right before a failure.
      this._breadcrumbs.push({ t: String(eventType).slice(0, 32), ts: Date.now() })
      if (this._breadcrumbs.length > BREADCRUMB_MAX) this._breadcrumbs.shift()
      this.queue.push(this._buildEvent(eventType, payload))
      // Hard-cap the in-memory queue so a stalled endpoint cannot grow it without
      // bound (the localStorage backup is already capped at MAX_BACKUP).
      if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE)
      if (this.queue.length >= QUEUE_FLUSH_THRESHOLD) this.flush()
    } catch (_) { /* telemetry must never throw into a hook */ }
  }

  // The client-side payload cap. The server discards anything over 2000 bytes,
  // so staying under this keeps events intact end to end.
  static PAYLOAD_MAX = 1000

  static _buildEvent(eventType, payload) {
    const p = payload || {}
    const { asset_id = null, asset_type = null, bytes = null, ...rest } = p
    let data = rest
    try {
      if (JSON.stringify(rest).length > this.PAYLOAD_MAX) data = this._shrink(rest)
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

  // Shrink an oversized payload instead of throwing it away.
  //
  // WHY THIS EXISTS. The previous line was
  //     if (JSON.stringify(rest).length > 1000) data = { _truncated: true }
  // which replaced the ENTIRE payload with a flag. Measured in the data lake on
  // 2026-08-17: 229 of 13.561 world_party_snapshot events arrived carrying
  // nothing but `_truncated`, so their party size, classes and system were
  // gone; and 476 of 751 module_inventory chunks arrived empty, which is 63
  // percent of everything that event has ever reported.
  //
  // Scalars are what analysis needs and they are tiny. Arrays are what blows
  // the budget. So keep every scalar, then trim the arrays from the largest
  // down until it fits, and say per field how much was dropped. A short list
  // plus an honest count beats a flag that means "we had it and threw it out".
  static _shrink(rest) {
    try {
      const out = {}
      const arrays = []
      for (const [k, v] of Object.entries(rest)) {
        if (Array.isArray(v)) arrays.push([k, v])
        else out[k] = v
      }
      // Largest array first: trimming it frees the most room.
      arrays.sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)
      for (const [k, v] of arrays) {
        let keep = v.length
        while (keep > 0) {
          const probe = { ...out, [k]: v.slice(0, keep) }
          if (JSON.stringify(probe).length <= this.PAYLOAD_MAX - 40) break
          keep = keep > 8 ? Math.floor(keep / 2) : keep - 1
        }
        if (keep > 0) out[k] = v.slice(0, keep)
        if (keep < v.length) out[`${k}_dropped`] = v.length - keep
      }
      out._shrunk = true
      // Last resort: even the scalars do not fit. Then say so rather than lie.
      if (JSON.stringify(out).length > this.PAYLOAD_MAX) return { _truncated: true }
      return out
    } catch (_) { return { _truncated: true } }
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
      this._emitModuleInventory()
    } catch (_) { /* swallow */ }
  }

  // Full active-module list (minus Beneos modules and their required
  // dependencies), at most weekly per browser+world, chunked so no payload
  // exceeds the server cap.
  static _emitModuleInventory() {
    try {
      const stampKey = `beneos-analytics-modinv-ts:${game.world?.id || ""}`
      const last = Number(window.localStorage?.getItem(stampKey) || 0)
      if (Date.now() - last < MODINV_INTERVAL_MS) return

      // Beneos family + declared required dependencies: always present, so
      // they would only clutter the "what else do our users run" top list.
      const skip = new Set([
        "beneos-module", "beneos-tableplay", "beneos-dev",
        "multilevel-tokens", "poi-teleport", "moulinette",
        "monks-active-tiles", "fxmaster", "lib-wrapper"
      ])
      const mods = [...game.modules].filter(m => m?.active && !skip.has(m.id)).map(m => String(m.id).slice(0, 48))
      if (!mods.length) return

      // Chunk so each event's JSON stays under the server payload cap.
      const chunks = []
      let cur = []
      for (const id of mods) {
        cur.push(id)
        if (JSON.stringify(cur).length > MODINV_CHUNK_JSON_MAX - 100) { chunks.push(cur); cur = [] }
      }
      if (cur.length) chunks.push(cur)
      chunks.forEach((mds, i) => {
        this.track("module_inventory", { chunk: i + 1, chunks: chunks.length, mods: mds })
      })
      try { window.localStorage?.setItem(stampKey, String(Date.now())) } catch (_) {}
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

      // Player characters.
      //
      // THIS USED TO BE `a.type === "character"` AND IT UNDERCOUNTED. Measured
      // in the data lake on 2026-08-17: of 2.503 snapshots reporting party_size
      // 0, the 1.025 that carry the type diagnostic split into 947 worlds with
      // genuinely no player-owned actor (real empty worlds) and 78 that DO have
      // player-owned actors we simply failed to recognise. Their types read
      // `player`, `hero`, `vampire`, and `Player` with a capital P.
      //
      // So: compare case-insensitively and accept the type names other systems
      // use. `group` and `vehicle` are deliberately absent, they are not
      // characters. ownedActorTypes above still exposes whatever we miss next.
      const actors = owned.filter(a => PC_ACTOR_TYPES.has(String(a.type || "").toLowerCase()))
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
        // Was actually matched, not a hardcoded claim. Before this line said
        // "character" unconditionally, which hid exactly the mismatch above.
        pc_actor_type: [...new Set(actors.map(a => this.sanitize(String(a.type || "?"), 24)))].sort().join(","),
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
  // Combat encounter summaries: ONE combat_encounter event per fight, carrying
  // rounds-in-initiative per Beneos creature plus the full (capped) roster for
  // co-occurrence. Player characters are NEVER named: they enter the roster as
  // the literal "player-character". Foreign NPC names are sanitized.
  static _combatRosterKey(combatant) {
    try {
      const actor = combatant?.actor
      if (actor?.type === "character" || actor?.hasPlayerOwner) return "player-character"
      const token = BeneosUtility.getToken?.(combatant.tokenId) ?? combatant?.token
      const beneosKey = this.beneosAssetId(token) || this.beneosAssetId(actor)
      if (beneosKey) return { key: String(beneosKey).slice(0, 64), beneos: true }
      // Foreign NPC: lowercase, strip copy suffixes/digits, keep it short.
      let name = String(actor?.name || combatant?.name || "npc").toLowerCase()
      name = name.replace(/\(\d+\)\s*$/, "").replace(/\s+\d+\s*$/, "")
      name = name.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24)
      return { key: name || "npc", beneos: false }
    } catch (_) { return { key: "npc", beneos: false } }
  }

  static combatantAdded(combatant) {
    try {
      const combatId = combatant?.combat?.id || game.combat?.id
      if (!combatId) return
      let c = this._combats.get(combatId)
      if (!c) {
        c = { battlemapKey: this._isBeneosScene(canvas?.scene) ? this._beneosBattlemapKey(canvas.scene) : "", roster: new Map() }
        this._combats.set(combatId, c)
      }
      const round = Number(combatant?.combat?.round ?? game.combat?.round) || 0
      const rk = this._combatRosterKey(combatant)
      const key = typeof rk === "string" ? rk : rk.key
      const isBeneos = typeof rk === "string" ? false : rk.beneos
      c.roster.set(combatant.id || `${key}:${c.roster.size}`, { key, isBeneos, addRound: round, removeRound: null })
    } catch (_) { /* swallow */ }
  }

  static combatantRemoved(combatant) {
    try {
      const combatId = combatant?.combat?.id || game.combat?.id
      const c = combatId ? this._combats.get(combatId) : null
      if (!c) return
      const entry = c.roster.get(combatant.id)
      if (entry && entry.removeRound === null) {
        entry.removeRound = Number(combatant?.combat?.round ?? game.combat?.round) || entry.addRound
      }
    } catch (_) { /* swallow */ }
  }

  static combatEnded(combat) {
    try {
      const c = combat?.id ? this._combats.get(combat.id) : null
      if (combat?.id) this._combats.delete(combat.id)
      if (!c) return
      this._emitCombatEncounter(c, Number(combat?.round) || 0)
    } catch (_) { /* swallow */ }
  }

  static _emitCombatEncounter(c, finalRound) {
    try {
      const entries = [...c.roster.values()]
      if (entries.length < 2) return                       // misclick filter
      if (!entries.some(e => e.isBeneos)) return           // only fights with Beneos creatures
      const totalRounds = Math.max(1, finalRound || 1)

      const roundsOf = (e) => {
        const add = Math.max(1, e.addRound || 1)           // round 0 = setup counts as 1
        const rem = Math.max(add, e.removeRound ?? totalRounds)
        return Math.max(1, rem - add + 1)
      }

      // Beneos creatures: rounds per asset key (max over duplicate tokens).
      const beneos = new Map()
      for (const e of entries.filter(x => x.isBeneos)) {
        const r = roundsOf(e)
        const prev = beneos.get(e.key)
        if (!prev || r > prev.r) beneos.set(e.key, { a: e.key, r })
      }

      // Roster: merged per key with count + max rounds, capped at 20 entries.
      const roster = new Map()
      for (const e of entries) {
        const r = roundsOf(e)
        const prev = roster.get(e.key)
        if (prev) { prev.n++; if (r > prev.r) prev.r = r }
        else roster.set(e.key, { k: e.key, n: 1, r })
      }
      const rosterList = [...roster.values()].sort((x, y) => y.r - x.r).slice(0, 20)

      this.track("combat_encounter", {
        battlemap_key: c.battlemapKey || "",
        total_rounds: totalRounds,
        beneos: [...beneos.values()].slice(0, 15),
        roster: rosterList
      })
    } catch (_) { /* swallow */ }
  }

  /********************************************************************************** */
  // Codex engagement: one event per creature+section, throttled per session.
  static trackCodexSection(tokenKey, section) {
    try {
      if (!tokenKey || !section) return
      const key = `${tokenKey}|${section}`
      const now = Date.now()
      if (now - (this._codexThrottle.get(key) || 0) < CODEX_THROTTLE_MS) return
      this._codexThrottle.set(key, now)
      this.track("codex_section", {
        asset_id: String(tokenKey).slice(0, 32),
        token_key: this.sanitize(String(tokenKey), 64),
        section: this.sanitize(String(section), 32)
      })
    } catch (_) { /* swallow */ }
  }

  // Spell casts (dnd5e activity hooks), capped per spell per session.
  static trackSpellCast(spellKey, caster) {
    try {
      if (!spellKey) return
      const n = (this._spellCastCounts.get(spellKey) || 0) + 1
      this._spellCastCounts.set(spellKey, n)
      if (n > SPELL_CAST_SESSION_CAP) return
      this.track("spell_cast", {
        asset_id: String(spellKey).slice(0, 32),
        spell_key: this.sanitize(String(spellKey), 64),
        caster: caster === "pc" ? "pc" : "npc"
      })
    } catch (_) { /* swallow */ }
  }

  // Item-added events, aggregated over a short window so a generated shop's
  // bulk import produces one event per origin instead of dozens.
  static trackItemAdded(originSlug, parentType) {
    try {
      if (!originSlug) return
      const pt = parentType === "character" ? "character" : (parentType === "npc" ? "npc" : "other")
      const key = `${originSlug}|${pt}`
      this._itemAddBuffer.set(key, (this._itemAddBuffer.get(key) || 0) + 1)
      if (this._itemAddTimer) return
      this._itemAddTimer = setTimeout(() => {
        try {
          this._itemAddTimer = null
          const buf = this._itemAddBuffer
          this._itemAddBuffer = new Map()
          for (const [k, count] of buf) {
            const [origin_slug, parent_type] = k.split("|")
            this.track("item_added", { origin_slug: this.sanitize(origin_slug, 48), parent_type, count })
          }
        } catch (_) { /* swallow */ }
      }, ITEM_ADD_WINDOW_MS)
    } catch (_) { /* swallow */ }
  }

  // Delivery self-healing signals (asset repair, signature mismatch, retries).
  static trackSelfRepair(assetId, reason) {
    try {
      const fp = `self_repair|${reason || ""}`
      const now = Date.now()
      if (now - (this._errorThrottle.get(fp) || 0) < ERROR_THROTTLE_MS) return
      this._errorThrottle.set(fp, now)
      this.track("self_repair", {
        asset_id: assetId ? String(assetId).slice(0, 32) : null,
        reason: this.sanitize(String(reason || "unknown"), 32)
      })
    } catch (_) { /* swallow */ }
  }

  static trackDownloadRetry(assetId, attempt) {
    try {
      const fp = `download_retry|${assetId || ""}`
      const now = Date.now()
      if (now - (this._errorThrottle.get(fp) || 0) < ERROR_THROTTLE_MS) return
      this._errorThrottle.set(fp, now)
      this.track("download_retry", {
        asset_id: assetId ? String(assetId).slice(0, 32) : null,
        attempt: Math.max(1, Number(attempt) || 1)
      })
    } catch (_) { /* swallow */ }
  }

  // One summary event per failed install run (native battlemap installer).
  // Carries the classified failure picture (INSTALL_ERROR categories) so the
  // dashboard can separate our bugs (notfound/signature/server) from user
  // environments (permission/quota/network/timeout). One event per run, not
  // per asset: keeps well under the 50-event batch and 2000-byte payload caps.
  static trackInstallError(result) {
    try {
      if (!result) return
      const failures = Array.isArray(result.assetFailures) ? result.assetFailures : []
      const docFailed = Array.isArray(result.docFailures) ? result.docFailures.length : 0
      if (!result.fatalCategory && failures.length === 0 && docFailed === 0) return
      const fp = `install_error|${result.packageId || ""}`
      const now = Date.now()
      if (now - (this._errorThrottle.get(fp) || 0) < ERROR_THROTTLE_MS) return
      this._errorThrottle.set(fp, now)
      const categories = {}
      for (const f of failures) {
        const c = String(f?.category || "unknown")
        categories[c] = (categories[c] || 0) + 1
      }
      const sample = failures[0] || null
      this.track("install_error", {
        asset_id: result.packageId ? String(result.packageId).slice(0, 32) : null,
        asset_type: "battlemap",
        fatal_category: result.fatalCategory ? this.sanitize(String(result.fatalCategory), 32) : null,
        fatal_message: result.fatalError ? this.sanitize(String(result.fatalError), 200) : null,
        categories,
        assets_failed: failures.length,
        assets_ok: Number(result.totals?.ok) || 0,
        docs_failed: docFailed,
        sample_target: sample ? this.sanitize(String(sample.target || ""), 96) : null,
        sample_message: sample ? this.sanitize(String(sample.lastError || ""), 200) : null,
        system: this.sanitize(String(result.env?.system || ""), 32),
        foundry: this.sanitize(String(result.env?.foundry || ""), 16),
        forge: result.env?.forge === "yes"
      })
    } catch (_) { /* swallow */ }
  }

  /********************************************************************************** */
  // Scene activation. Tracks distinct scenes per session (for maps/session)
  // and emits a one-time scene_activate per Beneos battlemap.
  static trackSceneActivate(scene) {
    try {
      if (!scene?.id) return
      // Time-on-map: close the previous Beneos map's visit before switching.
      this._closeSceneTime()
      if (this._isBeneosScene(scene)) {
        this._currentScene = { key: this._beneosBattlemapKey(scene), ts: Date.now() }
      }
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

  // Emit the time spent on the previously active Beneos map. Visits under a
  // minute are noise; longer than the cap means an idle/overnight tab.
  static _closeSceneTime() {
    try {
      const cur = this._currentScene
      this._currentScene = null
      if (!cur?.key) return
      let seconds = Math.round((Date.now() - cur.ts) / 1000)
      if (seconds < SCENE_TIME_MIN_S) return
      if (seconds > SCENE_TIME_CAP_S) seconds = SCENE_TIME_CAP_S
      this.track("scene_time", { battlemap_key: cur.key, seconds })
    } catch (_) { /* swallow */ }
  }

  static _sceneBackgroundSrc(scene) {
    // V14 moved the background onto scene.firstLevel; reading the deprecated
    // top-level scene.background logs a warning on every canvas draw. Only touch
    // it on a V13-shaped scene (no firstLevel).
    if (scene?.firstLevel) return scene.firstLevel.background?.src ?? scene?.img ?? ""
    return scene?.background?.src ?? scene?.img ?? ""
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
          message: this.sanitize(this._splitStackPackages(err?.message || String(err || "")).message, 200),
          stack_packages: (() => {
            const p = this._splitStackPackages(err?.message || String(err || "")).packages
            return p ? this.sanitize(p, 180) : null
          })(),
          stack_top_line: stackTop,
          module_version: this.moduleVersion(),
          ...this._errorContext()
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
    // Close the open map visit and summarise still-running combats with the
    // rounds measured so far, so a hard world-close loses neither.
    try { this._closeSceneTime() } catch (_) {}
    try {
      for (const [id, c] of this._combats) {
        this._combats.delete(id)
        const combat = game.combats?.get?.(id)
        this._emitCombatEncounter(c, Number(combat?.round) || 0)
      }
    } catch (_) {}
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
      const geteilt = this._splitStackPackages(err?.message || String(err || ""))
      const message = this.sanitize(geteilt.message, 200)
      const stackTop = this._stackTopLine(err?.stack || "")
      const fp = `${errorClass}|${stackTop}`
      const now = Date.now()
      if (now - (this._errorThrottle.get(fp) || 0) < ERROR_THROTTLE_MS) return
      this._errorThrottle.set(fp, now)
      this.track("beneos_error", {
        error_class: errorClass,
        message,
        // Own field, so neither the 200-character cut nor the per-user
        // variation of the list can touch the message itself.
        stack_packages: geteilt.packages ? this.sanitize(geteilt.packages, 180) : null,
        stack_top_line: stackTop,
        context: context ? String(context).slice(0, 32) : null,
        asset_id: assetId || null,
        module_version: this.moduleVersion(),
        ...this._errorContext()
      })
    } catch (_) { /* swallow */ }
  }

  // Environment snapshot attached to every error: under which conditions did
  // it happen (Foundry/system versions, active Beneos map, hosting) plus the
  // last few event types as breadcrumbs. ~250 chars, stays under the payload cap.
  static _errorContext() {
    try {
      const scene = canvas?.scene
      return {
        foundry_version: String(game.version || game.data?.version || "").slice(0, 16),
        system: `${game.system?.id || ""}/${game.system?.version || ""}`.slice(0, 32),
        battlemap_key: this._isBeneosScene(scene) ? this._beneosBattlemapKey(scene) : "",
        hosting: this.detectHostingType(),
        breadcrumbs: this._breadcrumbs.map(b => b.t)
      }
    } catch (_) { return {} }
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
  // Split Foundry's own package attribution off the message.
  //
  // Foundry core appends "[Detected 2 packages: lib-wrapper(1.13.5.1),
  // beneos-module(14.4.6)]" to error messages: the packages whose code appears
  // in the stack. That is genuinely useful, and it was being destroyed twice.
  //
  // Measured in the data lake on 2026-08-17, over 2.158 error events carrying
  // such a list:
  //
  //   - The list sits at the END of the message, and sanitize() cuts at 200
  //     characters. 297 lists arrived cut in half, closing bracket and all.
  //   - The list varies with the user's stack, so the same bug produced a
  //     different message per user. 82 of 226 distinct messages were nothing
  //     but this variation, which fragments any grouping by message.
  //
  // Both go away if the list travels in its own field: the message keeps its
  // full 200 characters for the actual error, and the attribution arrives whole.
  static _splitStackPackages(message) {
    const s = String(message || "")
    // Closed form first, then the form that Foundry itself already truncated.
    const m = s.match(/\s*\[Detected [^\]]*\]/) || s.match(/\s*\[Detected .*$/)
    if (!m) return { message: s, packages: null }
    return {
      message: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim(),
      packages: m[0].trim()
    }
  }

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
