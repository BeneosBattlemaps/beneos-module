/**
 * Beneos Native Battlemap Installer (in-house, no scene-packer/moulinette).
 *
 * Engine that owns the entire download + import pipeline. Drives a
 * BeneosBattlemapInstallProgress window for the user-facing UI and opens a
 * BeneosInstallReport dialog when anything fails.
 *
 * Pipeline:
 *   1. get_packinfo: list of every file in the pack with signed URLs (2h TTL)
 *   2. Pre-flight: probe-write into beneos_assets/cloud/battlemaps/ so a host
 *      that blocks writes fails fast with a clear message (not 195 errors)
 *   3. Asset download: every "data/assets/<path>" file is fetched and uploaded
 *      to beneos_assets/cloud/battlemaps/<path> (Forge: forgevtt source)
 *   4. Document create: parse "data/<Type>.json", call <Type>.createDocuments()
 *      in Foundry order (Folders, Scene, Actor, JournalEntry, Item, Macro,
 *      Playlist, Cards, RollTable), relocating asset refs into the cloud namespace
 *   5. Verify + auto-repair: HEAD-check every written asset, re-fetch misses
 *
 * Robustness (extraordinary-robustness brief): every network transfer goes
 * through #fetchAsset (inactivity-timeout + exponential backoff + signed-URL
 * refresh on 403) and #safeUpload (catches throws AND silent no-path failures,
 * which is also the Forge success signal). Failures are classified
 * (permission/quota/timeout/network/signature/notfound/server) and surfaced in
 * a transparent report instead of a silent miss.
 */

// ---- Transfer config -------------------------------------------------------
const FETCH_MAX_ATTEMPTS  = 3            // transient retries per asset
const FETCH_BACKOFF_MS    = [500, 1500, 4000]
const FETCH_INACTIVITY_MS = 30000       // abort if no bytes received for 30s
const FETCH_TOTAL_MS      = 300000      // hard per-attempt safety cap (5 min)
const MANIFEST_MAX_REFRESH = 2          // signed-URL refreshes per install

// Failure categories. Kept as plain strings so the report module can map them
// to headlines/guidance without importing this module (avoids a load cycle).
export const INSTALL_ERROR = {
  PERMISSION: "permission",
  QUOTA:      "quota",
  TIMEOUT:    "timeout",
  NETWORK:    "network",
  SIGNATURE:  "signature",
  NOTFOUND:   "notfound",
  SERVER:     "server",
  UNKNOWN:    "unknown",
}

/** Carries a classified category + optional HTTP status through the transfer layer. */
class TransferError extends Error {
  constructor(message, category, status = null) {
    super(message)
    this.name = "TransferError"
    this.category = category
    this.status = status
  }
}

/** Map an error + optional HTTP status to a failure category. */
export function classifyTransferError(err, status = null) {
  if (status === 404) return INSTALL_ERROR.NOTFOUND
  if (status === 401 || status === 403) return INSTALL_ERROR.SIGNATURE
  if (status === 429) return INSTALL_ERROR.SERVER
  if (typeof status === "number" && status >= 500) return INSTALL_ERROR.SERVER
  const msg = String(err?.message || err || "").toLowerCase()
  if (/permission|forbidden|not allowed|eacces|read-?only|erofs|denied/.test(msg)) return INSTALL_ERROR.PERMISSION
  if (/quota|enospc|no space|disk full|insufficient storage|\b507\b/.test(msg))    return INSTALL_ERROR.QUOTA
  if (/abort|timed out|timeout/.test(msg))                                         return INSTALL_ERROR.TIMEOUT
  if (/network|failed to fetch|networkerror|err_|load failed|connection/.test(msg)) return INSTALL_ERROR.NETWORK
  return INSTALL_ERROR.UNKNOWN
}

// Beneos cloud-install namespace. Battlemap packs are authored against
// `beneos_assets/beneos_battlemaps/...`; on cloud install we relocate them
// into the isolated `beneos_assets/cloud/battlemaps/...` namespace, mirroring
// the model items/spells already use (beneos_cloud.js rewrites
// `beneos_assets/beneos_items/` -> `beneos_assets/cloud/items/`). The prefix is
// deliberately narrow so tokens/spells/items refs are never touched.
const PACK_SOURCE_PREFIX   = "beneos_assets/beneos_battlemaps/"
const CLOUD_INSTALL_PREFIX = "beneos_assets/cloud/battlemaps/"

/** Swap the pack-source asset prefix for the cloud-install prefix in a string. */
function toCloudAssetPath(p) {
  return (typeof p === "string" && p.includes(PACK_SOURCE_PREFIX))
    ? p.split(PACK_SOURCE_PREFIX).join(CLOUD_INSTALL_PREFIX)
    : p
}

/**
 * Deep-walk a parsed document and relocate every
 * `beneos_assets/beneos_battlemaps/` reference into the cloud namespace so the
 * document's asset paths match where #downloadAssets wrote the files. Mutates
 * in place. Scoped to the narrow prefix above -> tokens/spells/items untouched.
 */
function rewriteDocAssetPaths(value) {
  if (typeof value === "string") return toCloudAssetPath(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = rewriteDocAssetPaths(value[i])
    return value
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = rewriteDocAssetPaths(value[k])
    return value
  }
  return value
}

const JSON_FILE_TO_PHASE = {
  "data/folders.json":      { phaseKey: "data",       collection: "folders",   docClass: () => globalThis.Folder },
  "data/Scene.json":        { phaseKey: "scenes",     collection: "scenes",    docClass: () => globalThis.Scene },
  "data/Actor.json":        { phaseKey: "actors",     collection: "actors",    docClass: () => globalThis.Actor },
  "data/JournalEntry.json": { phaseKey: "journals",   collection: "journal",   docClass: () => globalThis.JournalEntry },
  "data/Item.json":         { phaseKey: "items",      collection: "items",     docClass: () => globalThis.Item },
  "data/Macro.json":        { phaseKey: "macros",     collection: "macros",    docClass: () => globalThis.Macro },
  "data/Playlist.json":     { phaseKey: "playlists",  collection: "playlists", docClass: () => globalThis.Playlist },
  "data/Cards.json":        { phaseKey: "cards",      collection: "cards",     docClass: () => globalThis.Cards },
  "data/RollTable.json":    { phaseKey: "rolltables", collection: "tables",    docClass: () => globalThis.RollTable },
}

export class BeneosNativeBattlemapInstaller {

  constructor({ packageId, label = "", coverUrl = null } = {}) {
    if (!packageId) throw new Error("BeneosNativeBattlemapInstaller: packageId is required")
    this.packageId = packageId
    this.label     = label || packageId
    this.coverUrl  = coverUrl
    this.progress  = null
    this._manifestRefreshes = 0
    this._urlByTarget = new Map() // target/relPath -> current signed URL (refreshable)
  }

  /** One-shot install + UI. Returns the progress window so callers can wait if needed. */
  static async install({ packageId, label, coverUrl } = {}) {
    const inst = new BeneosNativeBattlemapInstaller({ packageId, label, coverUrl })
    return inst.run()
  }

  async run() {
    const ProgressWindow = globalThis.BeneosBattlemapInstallProgress
    if (!ProgressWindow) throw new Error("BeneosBattlemapInstallProgress not loaded")

    this.progress = await ProgressWindow.open({
      label:     this.label,
      coverUrl:  this.coverUrl,
      packageId: this.packageId,
    })

    const result = this.#newResult()
    this._result = result
    this._fp     = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker
    this._isForge = typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge === true
    this._source = this._isForge ? "forgevtt" : "data"

    try {
      // Phase: manifest
      this.progress.handleStatusMessage("Loading manifest and pack contents")
      const mgr = window.BeneosScenePacker
      if (!mgr) throw new Error("BeneosScenePackerManager missing")
      const packInfo = await mgr.getPackInfo(this.packageId)
      const { assets, jsons } = this.#classifyPack(packInfo)

      // Phase: pre-flight write check — fail fast + clearly if the host blocks writes
      this.progress.handleStatusMessage("Checking write access")
      const pre = await this.#preflightWriteCheck()
      if (!pre.ok) {
        result.preflight = { ok: false, category: pre.category, error: String(pre.error?.message || pre.error || "") }
        result.fatalCategory = pre.category
        this.progress.markFailed(this.#preflightMessage(pre.category))
        await this.#showReport(result)
        return this.progress
      }
      result.preflight = { ok: true }

      // Phases: download -> import -> verify/repair
      await this.#downloadAssets(assets)
      await this.#importDocuments(jsons)
      await this.#verifyAndRepair(assets)

      result.totals.failed = result.assetFailures.length
      const failureCount = result.assetFailures.length + result.docFailures.length
      if (failureCount > 0) {
        if (typeof this.progress.markCompletedWithIssues === "function") {
          this.progress.markCompletedWithIssues({ failed: failureCount })
        } else {
          this.progress.markCompleted()
        }
        await this.#showReport(result)
      } else {
        this.progress.markCompleted()
      }
    } catch (err) {
      console.error("BeneosNativeBattlemapInstaller | failure", err)
      this.progress.markFailed(err?.message || String(err))
      result.fatalError = String(err?.message || err)
      result.fatalCategory = result.fatalCategory || classifyTransferError(err, err?.status ?? null)
      await this.#showReport(result)
      throw err
    }
    return this.progress
  }

  // ---- Result + environment ------------------------------------------------

  #newResult() {
    return {
      packageId: this.packageId,
      label:     this.label,
      env:       this.#envFingerprint(),
      totals:    { assets: 0, ok: 0, repaired: 0, failed: 0, docsCreated: 0, docsFailed: 0 },
      assetFailures: [], // {target, category, attempts, lastError}
      docFailures:   [], // {type, id, error}
      preflight:     null,
      fatalCategory: null,
      fatalError:    null,
    }
  }

  #envFingerprint() {
    const forge = (typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge) ? "yes" : "no"
    return {
      foundry: game.version ?? "?",
      system:  `${game.system?.id ?? "?"}@${game.system?.version ?? "?"}`,
      module:  game.modules?.get("beneos-module")?.version ?? "?",
      forge,
      world:   game.world?.id ?? "?",
    }
  }

  #recordAssetFailure(target, category, error) {
    let e = this._result.assetFailures.find(f => f.target === target)
    if (!e) { e = { target, category, attempts: 0, lastError: "" }; this._result.assetFailures.push(e) }
    e.category  = category
    e.attempts += 1
    e.lastError = String(error?.message || error || "")
    this.progress.handleFailureCount?.(this._result.assetFailures.length)
  }

  #clearAssetFailure(target) {
    const i = this._result.assetFailures.findIndex(f => f.target === target)
    if (i >= 0) this._result.assetFailures.splice(i, 1)
    this.progress.handleFailureCount?.(this._result.assetFailures.length)
  }

  // ---- Manifest classification + refresh -----------------------------------

  /**
   * Split the packInfo URL map into assets[] (binary uploads) and jsons{}
   * (document collections). Also index every URL by its target/relPath so a
   * signed-URL refresh (#refreshManifestFor) can hand back a fresh URL.
   */
  #classifyPack(packInfo) {
    const assets = []
    const jsons  = {}
    this._urlByTarget = new Map()
    for (const [relPath, url] of Object.entries(packInfo)) {
      if (relPath === "mtte.json" || relPath === "beneos-pack-manifest.json") continue
      if (relPath.startsWith("data/assets/")) {
        const target = toCloudAssetPath(relPath.substring("data/assets/".length))
        assets.push({ url, target, relPath })
        this._urlByTarget.set(target, url)
        continue
      }
      if (relPath.startsWith("data/") && relPath.endsWith(".json")) {
        jsons[relPath] = url
        this._urlByTarget.set(relPath, url)
        continue
      }
      // thumbs/cover/other -> skipped (Foundry regenerates thumbs; cover shown by hero)
    }
    return { assets, jsons }
  }

  /** Re-mint signed URLs (signatures expire after ~2h; slow installs outrun them). */
  async #refreshManifest() {
    if (this._manifestRefreshes >= MANIFEST_MAX_REFRESH) return false
    this._manifestRefreshes += 1
    try {
      const mgr = window.BeneosScenePacker
      const fresh = await mgr.getPackInfo(this.packageId)
      for (const [relPath, url] of Object.entries(fresh)) {
        if (relPath.startsWith("data/assets/")) {
          this._urlByTarget.set(toCloudAssetPath(relPath.substring("data/assets/".length)), url)
        } else {
          this._urlByTarget.set(relPath, url)
        }
      }
      return true
    } catch (e) {
      console.warn("BeneosNativeInstaller | manifest refresh failed", e)
      return false
    }
  }

  async #refreshManifestFor(targetOrRelPath) {
    if (!(await this.#refreshManifest())) return null
    return this._urlByTarget.get(targetOrRelPath) || null
  }

  // ---- Transfer layer ------------------------------------------------------

  #sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  /**
   * Single fetch attempt with an INACTIVITY timeout: the request is aborted
   * only if no bytes arrive for FETCH_INACTIVITY_MS, so a genuinely slow but
   * progressing download (Raspberry Pi / slow line) is never killed. A total
   * cap (FETCH_TOTAL_MS) is the last-resort safety net. Returns a Blob.
   */
  async #fetchOnce(url) {
    const controller = new AbortController()
    let inactivity = null
    const armInactivity = () => {
      if (inactivity) clearTimeout(inactivity)
      inactivity = setTimeout(() => controller.abort(new DOMException("inactivity timeout", "AbortError")), FETCH_INACTIVITY_MS)
    }
    const total = setTimeout(() => controller.abort(new DOMException("total timeout", "AbortError")), FETCH_TOTAL_MS)
    try {
      armInactivity()
      const resp = await fetch(url, { signal: controller.signal })
      if (!resp.ok) throw new TransferError(`HTTP ${resp.status}`, classifyTransferError(null, resp.status), resp.status)
      const type = resp.headers.get("content-type") || "application/octet-stream"
      if (!resp.body || typeof resp.body.getReader !== "function") {
        return await resp.blob() // environment without streaming
      }
      const reader = resp.body.getReader()
      const chunks = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) { chunks.push(value); armInactivity() }
      }
      return new Blob(chunks, { type })
    } catch (err) {
      if (err instanceof TransferError) throw err
      const cat = err?.name === "AbortError" ? INSTALL_ERROR.TIMEOUT : classifyTransferError(err, null)
      throw new TransferError(err?.message || String(err), cat, null)
    } finally {
      if (inactivity) clearTimeout(inactivity)
      clearTimeout(total)
    }
  }

  /**
   * Robust asset/JSON fetch: transient failures (network/timeout/server) retry
   * with exponential backoff; a 403 (expired signed URL) triggers one manifest
   * refresh and an immediate retry with the fresh URL; 404 is permanent.
   * Returns a Blob or throws a TransferError carrying the final category.
   */
  async #fetchAsset(initialUrl, targetOrRelPath) {
    let url = initialUrl
    let transient = 0
    for (let guard = 0; guard < 8; guard++) {
      try {
        return await this.#fetchOnce(url)
      } catch (err) {
        const cat = err.category || INSTALL_ERROR.UNKNOWN
        if (cat === INSTALL_ERROR.NOTFOUND) throw err
        if (cat === INSTALL_ERROR.SIGNATURE) {
          const fresh = await this.#refreshManifestFor(targetOrRelPath)
          if (fresh) { url = fresh; continue }
          throw err
        }
        transient += 1
        if (transient >= FETCH_MAX_ATTEMPTS) throw err
        await this.#sleep(FETCH_BACKOFF_MS[transient - 1] || 4000)
      }
    }
    throw new TransferError("too many transfer attempts", INSTALL_ERROR.UNKNOWN, null)
  }

  /**
   * Upload wrapper (mirrors beneos_cloud.js::_beneosSafeUpload): catches thrown
   * errors AND silent failures (FilePicker.upload resolving without a path,
   * a known Foundry quirk). The returned path is also the Forge success signal
   * since HEAD-checks don't work against the Forge Assets Library.
   */
  async #safeUpload(dir, file) {
    let result
    try {
      result = await this._fp.upload(this._source, dir, file, {}, { notify: false })
    } catch (err) {
      return { ok: false, category: classifyTransferError(err, err?.status ?? null), error: err }
    }
    if (!result?.path) return { ok: false, category: INSTALL_ERROR.UNKNOWN, error: new Error("upload returned no path") }
    return { ok: true, path: result.path }
  }

  /**
   * Recursive mkdir-p. Idempotent on "exists". A real failure (permission/
   * quota) is returned (not thrown) so the caller can classify it.
   */
  async #ensureDir(dir) {
    if (!dir) return { ok: true }
    const parts = dir.split("/").filter(Boolean)
    let path = ""
    for (const p of parts) {
      path = path ? `${path}/${p}` : p
      try {
        await this._fp.createDirectory(this._source, path, {})
      } catch (e) {
        const msg = String(e?.message || e)
        if (/exists/i.test(msg) || /eexist/i.test(msg)) continue
        console.debug("BeneosNativeInstaller | createDirectory", path, msg)
        return { ok: false, category: classifyTransferError(e, null), error: e }
      }
    }
    return { ok: true }
  }

  /** Download + upload one asset. Returns {ok} or {ok:false, category, error}. */
  async #transferOne(a) {
    const dir  = a.target.includes("/") ? a.target.substring(0, a.target.lastIndexOf("/")) : ""
    const file = a.target.substring(a.target.lastIndexOf("/") + 1)
    if (dir) {
      const d = await this.#ensureDir(dir)
      if (!d.ok) return { ok: false, category: d.category, error: d.error }
    }
    let blob
    try {
      blob = await this.#fetchAsset(a.url, a.target)
    } catch (err) {
      return { ok: false, category: err.category || INSTALL_ERROR.UNKNOWN, error: err }
    }
    const up = await this.#safeUpload(dir, new File([blob], file, { type: blob.type }))
    if (!up.ok) return { ok: false, category: up.category, error: up.error }
    return { ok: true }
  }

  /** Probe-write into the cloud namespace so a write-blocking host fails fast. */
  async #preflightWriteCheck() {
    const dir = CLOUD_INSTALL_PREFIX.replace(/\/+$/, "")
    const d = await this.#ensureDir(dir)
    if (!d.ok) return { ok: false, category: d.category, error: d.error }
    // Filename must use a Foundry-whitelisted extension (.txt) and must not
    // start with a dot, or FilePicker.upload rejects it as a disallowed type ,
    // which would be a false-positive write failure on every host.
    const probe = new File([new Blob(["beneos write ok"], { type: "text/plain" })], "beneos-write-test.txt", { type: "text/plain" })
    const up = await this.#safeUpload(dir, probe)
    if (!up.ok) return { ok: false, category: up.category, error: up.error }
    return { ok: true }
  }

  #preflightMessage(category) {
    const key = `BENEOS.Cloud.Install.PreflightFailed.${category}`
    try {
      const s = game.i18n.localize(key)
      if (s && s !== key) return s
    } catch (_) {}
    return "Beneos Cloud could not write files to this server. Check write permissions or hosting policy."
  }

  // ---- Phases --------------------------------------------------------------

  async #downloadAssets(assets) {
    this.progress.handleStatusMessage("Downloading scene assets")
    const total = assets.length
    this._result.totals.assets = total
    for (let i = 0; i < total; i++) {
      const a = assets[i]
      const res = await this.#transferOne(a)
      if (res.ok) this._result.totals.ok += 1
      else this.#recordAssetFailure(a.target, res.category, res.error)
      this.progress.handleAssetProgress("Assets", total, i + 1)
    }
  }

  /**
   * Parse each document-collection JSON and createDocuments() in Foundry order
   * (Folders first). Asset refs are relocated into the cloud namespace before
   * create. Failures (whole-type fetch or per-doc create) are recorded.
   */
  async #importDocuments(jsons) {
    const ORDERED_PATHS = [
      "data/folders.json", "data/Scene.json", "data/Actor.json", "data/JournalEntry.json",
      "data/Item.json", "data/Macro.json", "data/Playlist.json", "data/Cards.json", "data/RollTable.json",
    ]
    for (const relPath of ORDERED_PATHS) {
      const url = jsons[relPath]
      if (!url) continue
      const meta = JSON_FILE_TO_PHASE[relPath]
      if (!meta) continue
      const docClass = meta.docClass()
      if (!docClass || typeof docClass.createDocuments !== "function") {
        console.warn("BeneosNativeInstaller | doc class missing for", relPath)
        continue
      }
      this.progress.handleStatusMessage(`Importing ${meta.phaseKey}`)

      let raw
      try {
        const blob = await this.#fetchAsset(url, relPath)
        raw = JSON.parse(await blob.text())
      } catch (err) {
        console.warn(`BeneosNativeInstaller | could not fetch ${relPath}`, err)
        this._result.docFailures.push({ type: meta.phaseKey, id: "(all)", error: String(err?.message || err) })
        continue
      }

      let arr = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : [])
      if (arr.length === 0) continue
      for (let i = 0; i < arr.length; i++) arr[i] = rewriteDocAssetPaths(arr[i])

      const coll = game[meta.collection]
      const filtered = arr.filter(d => (d?._id ? !coll?.get?.(d._id) : true))
      if (filtered.length === 0) {
        this.progress.handleAssetProgress(meta.phaseKey, arr.length, arr.length)
        continue
      }
      try {
        await docClass.createDocuments(filtered, { keepId: true })
        this._result.totals.docsCreated += filtered.length
      } catch (err) {
        console.warn(`BeneosNativeInstaller | createDocuments failed for ${relPath}`, err)
        let ok = 0
        for (const d of filtered) {
          try {
            await docClass.createDocuments([d], { keepId: true })
            ok += 1
            this._result.totals.docsCreated += 1
          } catch (e2) {
            console.warn(`BeneosNativeInstaller | doc create skipped (${d?._id})`, e2?.message || e2)
            this._result.docFailures.push({ type: meta.phaseKey, id: d?._id || "?", error: String(e2?.message || e2) })
          }
          this.progress.handleAssetProgress(meta.phaseKey, filtered.length, ok)
        }
      }
      this.progress.handleAssetProgress(meta.phaseKey, arr.length, arr.length)
    }
  }

  /**
   * Post-install integrity pass. HEAD-checks every asset (non-Forge) plus the
   * known failures, and re-fetches misses through the robust transfer layer.
   * On Forge the upload's returned path is the success signal (no HEAD).
   */
  async #verifyAndRepair(assets) {
    this.progress.handleStatusMessage("Verifying installed assets")
    const byTarget = new Map()
    for (const f of this._result.assetFailures) {
      const a = assets.find(x => x.target === f.target)
      if (a) byTarget.set(a.target, a)
    }
    if (!this._isForge) {
      for (const a of assets) {
        if (byTarget.has(a.target)) continue
        if (!(await this.#headCheck(a.target))) byTarget.set(a.target, a)
      }
    }
    const candidates = [...byTarget.values()]
    if (candidates.length === 0) return

    this.progress.handleStatusMessage(`Repairing ${candidates.length} asset(s)`)
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i]
      const res = await this.#transferOne(a)
      let ok = res.ok
      if (ok && !this._isForge) ok = await this.#headCheck(a.target) // confirm on disk
      if (ok) {
        this.#clearAssetFailure(a.target)
        this._result.totals.repaired += 1
      } else {
        this.#recordAssetFailure(a.target, res.category || INSTALL_ERROR.UNKNOWN, res.error || new Error("still missing after repair"))
      }
      this.progress.handleAssetProgress("Repair", candidates.length, i + 1)
    }
  }

  /**
   * Robust existence check against the data store: cache-busted HEAD that also
   * rejects hosts which answer 200 with an HTML error page for missing files.
   */
  async #headCheck(target) {
    try {
      const url = "/" + String(target).replace(/^\/+/, "") + "?_b=" + Date.now()
      const r = await fetch(url, { method: "HEAD" })
      if (!r.ok) return false
      if (/text\/html/i.test(r.headers.get("content-type") || "")) return false
      return true
    } catch (_) {
      return false
    }
  }

  // ---- Reporting -----------------------------------------------------------

  async #showReport(result) {
    try {
      const mod = await import("./beneos-install-report.mjs")
      const open = () => mod.BeneosInstallReport.show(result, {
        onRetry: () => BeneosNativeBattlemapInstaller.install({
          packageId: this.packageId, label: this.label, coverUrl: this.coverUrl,
        }),
      })
      // Let the progress window re-open this report via its "Show report" button.
      this.progress.setReportOpener?.(open)
      open()
    } catch (e) {
      console.warn("BeneosNativeInstaller | report dialog failed", e)
      const n = (result.assetFailures.length + result.docFailures.length) || 0
      try { ui.notifications.warn(game.i18n.format("BENEOS.Cloud.Install.AssetsMissing", { count: n })) }
      catch (_) { ui.notifications.warn(`${n} asset(s) could not be installed. See console.`) }
    }
  }
}

// Expose globally so the cloud-window handler can route to it without an
// import cycle (cloud-window-v2.mjs loads ESM-only too).
globalThis.BeneosNativeBattlemapInstaller = BeneosNativeBattlemapInstaller
