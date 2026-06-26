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

import { BeneosInstallState, BeneosPreInstallDialog, beneosLogModuleInstall } from "./beneos-install-state.mjs"

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

  constructor({ packageId, label = "", coverUrl = null, sceneSlugs = null, overwrite = false, record = null, source = null } = {}) {
    if (!packageId) throw new Error("BeneosNativeBattlemapInstaller: packageId is required")
    this.packageId = packageId
    this.label     = label || packageId
    this.coverUrl  = coverUrl
    // Pack source: cloud (default — signed URLs via BeneosScenePacker.getPackInfo)
    // or a local ZIP ({ kind:"zip", entries: Map<relPath, Uint8Array> }) for the
    // manual importer. Both feed the identical download/import pipeline, so the
    // unpack + storage are byte-identical regardless of source.
    this.source    = source || { kind: "cloud" }
    this._zipEntries = null   // set in #loadPackInfo when source.kind === "zip"
    // Teil 2: when true, every pack document (except folders) is replaced by
    // _id instead of skipped — set after the user confirms the world-overwrite
    // dialog. `record` carries the release metadata the installer needs to
    // detect staleness, decide source re-download, and persist the install.
    this.overwrite = !!overwrite
    this.record    = record || null
    // Punkt 7: optional scene scope. When set, only the named scenes (by
    // cloud_scene_slug) and their assets are installed from the release pack,
    // not the whole release. The pack ships a per-scene manifest at
    // `.scenes/<slug>.json` carrying that scene's Foundry document id + the
    // exact list of asset files, so we never have to guess. An empty/unknown
    // scope falls back to the full release so the user never gets nothing.
    this.sceneSlugs = (Array.isArray(sceneSlugs) && sceneSlugs.length) ? sceneSlugs.filter(Boolean) : null
    this.progress  = null
    this._manifestRefreshes = 0
    this._urlByTarget = new Map() // target/relPath -> current signed URL (refreshable)
    this._sceneScope  = null      // { assetRelPaths:Set, sceneIds:Set } when scene-scoped
  }

  /**
   * One-shot install + UI. Returns the installer instance so callers can read
   * the result (imported scenes, totals, whether the user cancelled) — used by
   * the cloud window to refresh the installed-marker after the run.
   */
  static async install({ packageId, label, coverUrl, sceneSlugs, overwrite = false, record = null, source = null } = {}) {
    const inst = new BeneosNativeBattlemapInstaller({ packageId, label, coverUrl, sceneSlugs, overwrite, record, source })
    await inst.run()
    return inst
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
    this._importedScenes = []   // Task E: {id,name} of imported scenes
    this._fp     = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker
    this._isForge = typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge === true
    this._source = this._isForge ? "forgevtt" : "data"

    try {
      // Phase: manifest
      this.progress.handleStatusMessage("Loading manifest and pack contents")
      const packInfo = await this.#loadPackInfo()
      const { assets, jsons } = this.#classifyPack(packInfo)

      // Punkt 7: narrow to a single scene (+ its sibling) when scene-scoped.
      // The same robustness layer applies — we just feed it a smaller, exact
      // asset list and remember which Scene documents to import.
      let installAssets = assets
      if (this.sceneSlugs) {
        const scope = await this.#resolveSceneScope(packInfo, assets)
        if (scope && scope.assets.length) {
          installAssets = scope.assets
          this._sceneScope = {
            assetRelPaths: scope.assetRelPaths, sceneIds: scope.sceneIds,
            journalIds: scope.journalIds, playlistIds: scope.playlistIds, actorIds: scope.actorIds,
            folderIds: scope.folderIds, primarySceneId: scope.primarySceneId,
          }
          this.progress.handleStatusMessage(`Preparing ${this.sceneSlugs.length} scene(s)`)
        } else {
          // Manifest missing / empty -> install the full release rather than
          // risk an empty install. Transparent: logged, and the user still
          // gets a working map.
          console.warn("BeneosNativeInstaller | scene scope resolved empty, installing full release", this.sceneSlugs)
          this._sceneScope = null
        }
      }

      // Teil 2: existence check. Work out which Scene documents this run will
      // create, then warn before overwriting scenes already in the world — a
      // re-install/variant-switch resets those scenes, so any placed tokens or
      // manual edits are lost. Confirm => overwrite mode; cancel => abort
      // cleanly (close the progress window, install nothing). This is what was
      // silently skipped before (bm_0011: scene already present -> no-op, green).
      const targetSceneIds = this._sceneScope?.sceneIds?.size
        ? [...this._sceneScope.sceneIds]
        : await this.#readReleaseSceneIds(jsons)
      this._targetSceneIds = targetSceneIds
      const presentIds = targetSceneIds.filter(id => game.scenes?.get?.(id))
      this._allPresent  = targetSceneIds.length > 0 && presentIds.length === targetSceneIds.length
      const prior = this.#priorRecord()
      this._stale = this.#isStale(prior)
      if (presentIds.length && !this.overwrite) {
        const ok = await BeneosPreInstallDialog.confirmWorldOverwrite({
          scope:        this._sceneScope ? "scene" : "release",
          name:         this.label,
          presentCount: presentIds.length,
          totalCount:   targetSceneIds.length,
          installedAt:  prior?.installedAt || "",
          stale:        this._stale,
        })
        if (!ok) {
          this._cancelled = true
          try { await this.progress.close?.() } catch (_) {}
          return this
        }
        this.overwrite = true
      }
      // Source-overwrite gating (user decision: release-signature gating). The
      // source files are byte-identical when the release is unchanged, so a
      // re-install of an up-to-date, fully-present release skips the download
      // and only resets the documents. A stale release (newer signature or
      // installed before the catalog's updated_date), a fresh install, or a
      // partially-present one re-downloads everything so map updates reach the
      // user. The verify pass re-fetches any locally-missing file regardless.
      this._skipSource = !!prior && !this._stale && this._allPresent

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

      // Task 6: compute ALL phase counts up front (assets length + folders
      // length + mtte.json document counts; scene-scope uses the scoped
      // subset). The progress window then shows every relevant phase greyed
      // out with "0 of N" from the start and fills to "N of N" as it runs ,
      // the user sees the full scope immediately. Phases with 0 stay hidden.
      this.progress.handleStatusMessage("Reading pack contents")
      const phasePlan = await this.#buildPhasePlan(packInfo, installAssets)
      if (typeof this.progress.setPhasePlan === "function") this.progress.setPhasePlan(phasePlan)
      else this.progress.beginNativeRun?.()

      // Phases: download -> import -> verify/repair (scene-scoped asset set
      // when applicable; #importDocuments reads this._sceneScope to filter).
      await this.#downloadAssets(installAssets)
      await this.#importDocuments(jsons)
      await this.#verifyAndRepair(installAssets)

      // Second install layer: the scenes' creatureInstaller flag references
      // Beneos creatures (cloud tokenKeys). Pull them from the cloud when the
      // user is an active token-patron; otherwise leave the standard import
      // untouched. Same for cloud + manual-ZIP installs.
      await this.#installBeneosCreatures(jsons)

      // Task E: tell the progress window which scene the "Open" button opens.
      const openSceneId = this.#pickOpenSceneId()
      if (openSceneId) this.progress.setOpenScene?.(openSceneId)

      // Teil 2/3: persist the install so the cloud window can render the
      // installed-marker + update-available state and future re-installs detect
      // presence. Only on a real install (>=1 scene imported).
      await this.#recordInstallIfAny()

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
        // Honest completion: if nothing was created or refreshed (everything was
        // already present), say so instead of "ready in the scene directory".
        const noChanges = (result.totals.docsCreated === 0 && result.totals.docsUpdated === 0)
        this.progress.markCompleted({ noChanges })
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

  /**
   * Task E: which scene the "Open" button should open. Single-scene install ->
   * the clicked (primary) scene; release -> the "Overview" scene if present,
   * else the first imported scene. The pack carries no active/initial-view flag.
   */
  #pickOpenSceneId() {
    if (this._sceneScope?.primarySceneId) return this._sceneScope.primarySceneId
    const scenes = this._importedScenes || []
    if (!scenes.length) return null
    const exact = scenes.find(s => /^\s*overview\s*$/i.test(s.name))
    const loose = scenes.find(s => /overview/i.test(s.name))
    return (exact || loose || scenes[0]).id
  }

  // ---- Teil 2: existence / overwrite / install-record helpers --------------

  /**
   * Release-scope target scene ids: read the pack's Scene.json and return every
   * scene _id. Used by the existence check when no scene scope narrows the run.
   * Best-effort — a fetch/parse failure returns [] (no false "already present").
   */
  async #readReleaseSceneIds(jsons) {
    const url = jsons?.["data/Scene.json"]
    if (!url) return []
    try {
      const raw = JSON.parse(await (await this.#fetchAsset(url, "data/Scene.json")).text())
      const arr = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : [])
      return arr.map(d => String(d?._id || "")).filter(Boolean)
    } catch (e) {
      console.warn("BeneosNativeInstaller | could not read Scene.json for existence check", e?.message || e)
      return []
    }
  }

  /** The stored install record for this release + variant, or null. */
  #priorRecord() {
    if (!this.record?.releaseDir) return null
    const variant = this.record.variant || ""
    const installs = BeneosInstallState.findByReleaseDir(this.record.releaseDir)
    return installs.find(e => (e.variant || "") === variant) || installs[0] || null
  }

  /**
   * Is the locally-installed release older than the online version? True when
   * the content signature changed, or the install predates the catalog's
   * updated_date. No prior record => treat as stale (download fresh).
   */
  #isStale(prior) {
    if (!prior) return true
    const sig = String(this.record?.contentSignature || "")
    if (sig && prior.sourceSignature && prior.sourceSignature !== sig) return true
    const upd = String(this.record?.updatedDate || "")
    if (upd && prior.installedAt) {
      const i = Date.parse(prior.installedAt), u = Date.parse(upd)
      if (Number.isFinite(i) && Number.isFinite(u) && i < u) return true
    }
    return false
  }

  /**
   * Persist the install + ping the download log, but only when at least one
   * scene was actually imported and the caller handed us release metadata.
   */
  async #recordInstallIfAny() {
    if (!this.record?.releaseDir) return
    const sceneIds = (this._importedScenes || []).map(s => String(s.id)).filter(Boolean)
    if (!sceneIds.length) return
    try {
      await BeneosInstallState.recordInstall({
        releaseDir:      this.record.releaseDir,
        variant:         this.record.variant || "",
        assetId:         this.record.assetId || "",
        sceneIds,
        sourceSignature: this.record.contentSignature || "",
        sceneCount:      sceneIds.length,
      })
    } catch (e) {
      console.warn("BeneosNativeInstaller | recordInstall failed", e)
    }
    try {
      const labelVariant = this.record.variant === "HD" ? "Foundry_HD"
                         : this.record.variant === "4K" ? "Foundry_4K" : ""
      beneosLogModuleInstall({ assetId: this.record.assetId || "", variant: labelVariant, sceneCount: sceneIds.length })
    } catch (_) {}
  }

  // ---- Beneos-Creatures (second install layer) -----------------------------

  /**
   * Collect the Beneos (cloud) creature tokenKeys referenced by the installed
   * scenes' `flags["beneos-module"].creatureInstaller.beneosCreatures[]`. SRD
   * creatures (no tokenKey) are already packed as Actors and ignored here.
   */
  async #collectBeneosCreatureKeys(jsons) {
    const url = jsons?.["data/Scene.json"]
    if (!url) return []
    let arr
    try {
      const raw = JSON.parse(await (await this.#fetchAsset(url, "data/Scene.json")).text())
      arr = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : [])
    } catch (_) { return [] }
    const want = (this._targetSceneIds?.length) ? new Set(this._targetSceneIds.map(String)) : null
    const keys = new Set()
    for (const sc of arr) {
      if (want && !want.has(String(sc?._id))) continue
      const ci = sc?.flags?.["beneos-module"]?.creatureInstaller
      const list = Array.isArray(ci?.beneosCreatures) ? ci.beneosCreatures : []
      for (const c of list) {
        const k = (c?.tokenKey != null) ? String(c.tokenKey).trim() : ""
        if (k) keys.add(k)
      }
    }
    return [...keys]
  }

  /**
   * Second install layer: import the scenes' referenced Beneos creatures from
   * the cloud when the user is an active token-patron. Non-patrons get the info
   * block (grey + red X) and the standard map import stands. Actors-only — the
   * Creature-Drawer handles placement when a scene is opened.
   */
  async #installBeneosCreatures(jsons) {
    let keys = []
    try { keys = await this.#collectBeneosCreatureKeys(jsons) } catch (_) {}
    if (!keys.length) return   // no creature block for releases without Beneos creatures

    const cloud = game.beneos?.cloud
    const isPatron = !!cloud?.hasCampaignAccess?.("tokens")
    this.progress.setCreatureBlock?.({ present: true, isPatron, count: keys.length, installed: 0,
      state: isPatron ? "active" : "skipped" })

    if (!isPatron || typeof cloud?.importTokenFromCloud !== "function") {
      this._result.creatures = { present: true, patron: isPatron, installed: 0, total: keys.length }
      return
    }

    this.progress.handleStatusMessage?.(`Adding ${keys.length} Beneos creature(s)`)
    let ok = 0
    for (const key of keys) {
      try {
        await cloud.importTokenFromCloud(key, undefined, false, { gated: true })
        ok += 1
      } catch (e) {
        console.warn("BeneosNativeInstaller | Beneos creature install failed", key, e?.message || e)
        this._result.docFailures.push({ type: "creature", id: key, error: String(e?.message || e) })
      }
      this.progress.setCreatureBlock?.({ present: true, isPatron: true, count: keys.length, installed: ok, state: "active" })
    }
    this._result.creatures = { present: true, patron: true, installed: ok, total: keys.length }
    this.progress.setCreatureBlock?.({ present: true, isPatron: true, count: keys.length, installed: ok, state: "done" })
  }

  // ---- Result + environment ------------------------------------------------

  #newResult() {
    return {
      packageId: this.packageId,
      label:     this.label,
      env:       this.#envFingerprint(),
      totals:    { assets: 0, ok: 0, repaired: 0, failed: 0, docsCreated: 0, docsUpdated: 0, docsSkippedExisting: 0, docsFailed: 0, skippedPackageOwned: 0 },
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
   * Resolve the packInfo map for the active source.
   *  - cloud: signed-URL map from BeneosScenePacker.getPackInfo (value = URL).
   *  - zip:   value === relPath (the ZIP entry key) so #fetchAsset reads bytes
   *           straight from `this._zipEntries`. The rest of the pipeline is the
   *           same, so unpack + storage stay byte-identical to a cloud install.
   */
  async #loadPackInfo() {
    if (this.source?.kind === "zip") {
      const entries = (this.source.entries instanceof Map)
        ? this.source.entries
        : new Map(Object.entries(this.source.entries || {}))
      this._zipEntries = entries
      const packInfo = {}
      for (const relPath of entries.keys()) packInfo[relPath] = relPath
      return packInfo
    }
    const mgr = window.BeneosScenePacker
    if (!mgr) throw new Error("BeneosScenePackerManager missing")
    return await mgr.getPackInfo(this.packageId)
  }

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
        // Package-owned paths (modules/<id>/…, systems/<id>/…) are provided by
        // the installed package itself — e.g. the pack bundles beneos-module's
        // own ability icons under modules/beneos-module/icons/. Re-uploading
        // them would (a) write into a module/system folder, which Foundry warns
        // is unsafe (a package update wipes them), and (b) be redundant. Skip
        // them: the imported docs reference the existing package files directly.
        if (/^(modules|systems)\//.test(target)) {
          this._result.totals.skippedPackageOwned = (this._result.totals.skippedPackageOwned || 0) + 1
          continue
        }
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

  /**
   * Punkt 7: resolve a scene scope from the pack's per-scene manifests
   * (`.scenes/<slug>.json`). Each manifest carries the scene's Foundry
   * document id (scene_id) and the exact asset files[] for that scene. We
   * union scene + sibling, restrict the install asset list to those files,
   * and remember the scene ids so #importDocuments imports only those scenes.
   * Returns null when no manifest could be read (caller falls back to full).
   */
  async #resolveSceneScope(packInfo, assets) {
    const wantPaths = new Set()
    const sceneIds  = new Set()
    let primarySceneId = null   // Task E: the clicked scene (first slug) , Open target
    for (let si = 0; si < this.sceneSlugs.length; si++) {
      const slug = this.sceneSlugs[si]
      const rel = `.scenes/${slug}.json`
      const url = packInfo[rel]
      if (!url) { console.warn("BeneosNativeInstaller | scene manifest missing", rel); continue }
      try {
        const blob = await this.#fetchAsset(url, rel)
        const man  = JSON.parse(await blob.text())
        if (man?.scene_id) {
          sceneIds.add(String(man.scene_id))
          if (si === 0) primarySceneId = String(man.scene_id)
        }
        for (const f of (Array.isArray(man?.files) ? man.files : [])) {
          if (f?.path) wantPaths.add(String(f.path))
        }
      } catch (e) {
        console.warn("BeneosNativeInstaller | scene manifest fetch failed", rel, e?.message || e)
      }
    }
    if (!wantPaths.size && !sceneIds.size) return null

    // ---- Task F: document DEPENDENCY CLOSURE -------------------------------
    // A scene is not self-contained on its own: its Note pin icons point at
    // JournalEntry documents (POI teleporters, handouts), it may link a journal
    // + an ambient playlist, and its tokens reference actors. Installing only
    // the Scene leaves those notes/handouts dangling , a real integrity bug.
    // So we pull the closure of referenced documents, their folder chains, and
    // the assets THEY reference (e.g. handout images), on top of the scene's
    // own manifest assets.
    const loadDocs = async (rel) => {
      const url = packInfo[rel]
      if (!url) return []
      try {
        const raw = JSON.parse(await (await this.#fetchAsset(url, rel)).text())
        return Array.isArray(raw) ? raw : Object.values(raw || {})
      } catch (e) { console.warn("BeneosNativeInstaller | could not read", rel, e?.message || e); return [] }
    }

    const sceneDocs = (await loadDocs("data/Scene.json")).filter(d => sceneIds.has(String(d?._id)))

    const journalIds = new Set(), playlistIds = new Set(), actorIds = new Set()
    for (const sc of sceneDocs) {
      for (const n of (Array.isArray(sc?.notes) ? sc.notes : [])) {
        if (n?.entryId) journalIds.add(String(n.entryId))
      }
      if (sc?.journal)  journalIds.add(String(sc.journal))
      if (sc?.playlist) playlistIds.add(String(sc.playlist))
      for (const t of (Array.isArray(sc?.tokens) ? sc.tokens : [])) {
        if (t?.actorId) actorIds.add(String(t.actorId))
      }
    }

    const journalDocs  = journalIds.size  ? (await loadDocs("data/JournalEntry.json")).filter(d => journalIds.has(String(d?._id)))  : []
    const playlistDocs = playlistIds.size ? (await loadDocs("data/Playlist.json")).filter(d => playlistIds.has(String(d?._id)))     : []
    const actorDocs    = actorIds.size    ? (await loadDocs("data/Actor.json")).filter(d => actorIds.has(String(d?._id)))           : []
    // Narrow id sets to docs that actually exist in the pack.
    const presentJournalIds  = new Set(journalDocs.map(d => String(d._id)))
    const presentPlaylistIds = new Set(playlistDocs.map(d => String(d._id)))
    const presentActorIds    = new Set(actorDocs.map(d => String(d._id)))

    // Asset closure: deep-walk every closure document for in-pack
    // beneos_battlemaps asset references (handout page images, note icons,
    // ambient sounds, …) and union with the scene's own manifest files.
    const closureDocs = [...sceneDocs, ...journalDocs, ...playlistDocs, ...actorDocs]
    for (const d of closureDocs) this.#collectAssetRefs(d, wantPaths)
    const scopedAssets = assets.filter(a => wantPaths.has(a.relPath))

    // Folder closure over EVERY imported document (scenes, journals, playlists,
    // actors), so only the folders that actually hold them are created.
    const folderIds = await this.#resolveFolderClosure(packInfo, closureDocs)

    return {
      assets: scopedAssets, assetRelPaths: wantPaths,
      sceneIds, journalIds: presentJournalIds, playlistIds: presentPlaylistIds, actorIds: presentActorIds,
      folderIds, primarySceneId,
    }
  }

  /** Task F: collect in-pack asset paths (beneos_battlemaps) from a document. */
  #collectAssetRefs(value, out) {
    if (typeof value === "string") {
      const i = value.indexOf(PACK_SOURCE_PREFIX)
      if (i >= 0) out.add("data/assets/" + value.substring(i))
      return
    }
    if (Array.isArray(value)) { for (const v of value) this.#collectAssetRefs(v, out); return }
    if (value && typeof value === "object") { for (const k of Object.keys(value)) this.#collectAssetRefs(value[k], out) }
  }

  /**
   * Task 5/F: resolve the folder ids needed to place a set of documents , each
   * document's own folder plus the chain of parent folders up to the root.
   * Folders are typed in folders.json (Scene/JournalEntry/…); closing over the
   * ids works across all types. Returns a Set of folder _ids.
   */
  async #resolveFolderClosure(packInfo, docs) {
    const ids = new Set()
    try {
      const fUrl = packInfo["data/folders.json"]
      if (!fUrl) return ids
      const folderArr = JSON.parse(await (await this.#fetchAsset(fUrl, "data/folders.json")).text())
      const folders = Array.isArray(folderArr) ? folderArr : Object.values(folderArr || {})
      const folderById = new Map(folders.map(f => [String(f?._id), f]))
      for (const d of docs) {
        let fid = d?.folder ? String(d.folder) : null
        let guard = 0
        while (fid && !ids.has(fid) && guard++ < 64) {
          ids.add(fid)
          const f = folderById.get(fid)
          fid = f?.folder ? String(f.folder) : null
        }
      }
    } catch (e) {
      console.warn("BeneosNativeInstaller | folder closure failed", e?.message || e)
    }
    return ids
  }

  /**
   * Task 6: pre-compute every phase's total BEFORE downloading, so the progress
   * window can show the full scope (all phases, greyed, "0 of N") immediately.
   * Document counts come from the pack's mtte.json `counts`; assets from the
   * (possibly scene-scoped) asset list; folders from data/folders.json. Scene
   * scope uses the scoped scene/folder counts and skips other doc types.
   * Returns [{ key, total }] for totals > 0.
   */
  async #buildPhasePlan(packInfo, installAssets) {
    const plan = []
    const add = (key, total) => { if (Number(total) > 0) plan.push({ key, total: Number(total) }) }
    add("assets", installAssets.length)
    if (this._sceneScope) {
      add("data",      this._sceneScope.folderIds?.size   || 0)
      add("scenes",    this._sceneScope.sceneIds?.size     || 0)
      add("journals",  this._sceneScope.journalIds?.size   || 0)
      add("playlists", this._sceneScope.playlistIds?.size  || 0)
      add("actors",    this._sceneScope.actorIds?.size     || 0)
      return plan
    }
    // Full release: folder count + document counts from mtte.json.
    try {
      const fUrl = packInfo["data/folders.json"]
      if (fUrl) {
        const arr = JSON.parse(await (await this.#fetchAsset(fUrl, "data/folders.json")).text())
        add("data", Array.isArray(arr) ? arr.length : Object.keys(arr || {}).length)
      }
    } catch (_) {}
    try {
      const mUrl = packInfo["mtte.json"]
      if (mUrl) {
        const counts = (JSON.parse(await (await this.#fetchAsset(mUrl, "mtte.json")).text()))?.counts || {}
        const MAP = { Scene: "scenes", Actor: "actors", JournalEntry: "journals", Item: "items", Macro: "macros", Playlist: "playlists", Cards: "cards", RollTable: "rolltables" }
        for (const [src, key] of Object.entries(MAP)) add(key, counts[src])
      }
    } catch (_) {}
    return plan
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
    // ZIP source: bytes come straight from the in-memory entry map (no network,
    // no signed-URL refresh). `initialUrl` is the relPath (= the entry key). The
    // value is a lazy factory (() => Uint8Array) so large packs decompress one
    // entry at a time; call it to get the bytes. Also accept a materialized
    // Uint8Array/Blob for robustness.
    if (this._zipEntries) {
      let v = this._zipEntries.get(String(initialUrl))
      if (typeof v === "function") v = await v()
      if (!v) throw new TransferError(`zip entry missing: ${initialUrl}`, INSTALL_ERROR.NOTFOUND, null)
      return (v instanceof Blob) ? v : new Blob([v])
    }
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
    const total = assets.length
    this._result.totals.assets = total
    // Teil 2 source-gating: an up-to-date, fully-present release has byte-
    // identical source files locally, so skip the download. The verify pass
    // still HEAD-checks and re-fetches anything actually missing, so a
    // partially-deleted install self-heals.
    if (this._skipSource) {
      this.progress.handleStatusMessage("Scene assets already up to date")
      this.progress.revealPhase?.("assets", { status: "done", current: total, total })
      this._result.totals.ok += total
      return
    }
    this.progress.handleStatusMessage("Downloading scene assets")
    this.progress.revealPhase?.("assets", { status: "active", current: 0, total })
    for (let i = 0; i < total; i++) {
      const a = assets[i]
      const res = await this.#transferOne(a)
      if (res.ok) this._result.totals.ok += 1
      else this.#recordAssetFailure(a.target, res.category, res.error)
      this.progress.handleAssetProgress("Assets", total, i + 1)
      this.progress.revealPhase?.("assets", { status: "active", current: i + 1, total })
    }
    this.progress.revealPhase?.("assets", { status: "done", current: total, total })
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
    // Punkt 7 + Task F: when scene-scoped, import the scene structure PLUS the
    // dependency closure of the selected scenes , the journals their note pins
    // reference (POI teleporters, handouts), the scene journal, the ambient
    // playlist, and token actors , so a single-scene install is self-contained.
    // Other release-level docs (items, macros, cards, rolltables) are skipped.
    const sceneScope = this._sceneScope
    const SCENE_SCOPE_ALLOWED = new Set([
      "data/folders.json", "data/Scene.json",
      "data/JournalEntry.json", "data/Playlist.json", "data/Actor.json",
    ])

    for (const relPath of ORDERED_PATHS) {
      if (sceneScope && !SCENE_SCOPE_ALLOWED.has(relPath)) continue
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
      // Scene-scope: keep only the documents in the dependency closure.
      if (sceneScope) {
        const FILTER_SET = {
          "data/Scene.json":        sceneScope.sceneIds,
          "data/JournalEntry.json": sceneScope.journalIds,
          "data/Playlist.json":     sceneScope.playlistIds,
          "data/Actor.json":        sceneScope.actorIds,
          "data/folders.json":      sceneScope.folderIds,
        }
        const want = FILTER_SET[relPath]
        if (want) arr = arr.filter(d => d?._id && want.has(String(d._id)))
      }
      // Task E: remember imported scenes (id + name) so we can offer an "Open"
      // button afterwards (Overview scene for a release, the scene itself for a
      // single-scene install).
      if (relPath === "data/Scene.json") {
        this._importedScenes = arr.map(d => ({ id: String(d?._id), name: String(d?.name || "") }))
      }
      if (arr.length === 0) continue
      // Punkt 8: reveal this phase with its real document count.
      this.progress.revealPhase?.(meta.phaseKey, { status: "active", current: 0, total: arr.length })
      for (let i = 0; i < arr.length; i++) arr[i] = rewriteDocAssetPaths(arr[i])

      // Playlists grow, they are never replaced: the export ships each release's
      // playlist with only the few sounds that release uses (same playlist _id +
      // sound _ids). On install we MERGE — add the pack's PlaylistSound(s) not
      // already present (by _id) into the existing playlist, leaving its other
      // sounds untouched; a brand-new playlist is created whole. Never delete a
      // playlist (even in overwrite mode) so ambiences accumulate across installs.
      if (relPath === "data/Playlist.json") {
        await this.#mergePlaylists(arr, docClass, meta)
        continue
      }

      // Idempotency: a re-install or a 4K<->HD variant switch reuses the SAME
      // document _ids (verified: 4K and HD packs share scene ids). The old code
      // skipped any doc whose _id already existed and still reported success ,
      // so re-installing or switching variant silently did nothing. Fix:
      // OVERWRITE the scene itself (delete + recreate from the pack) so new asset
      // paths + layout take effect; closure docs (folders, journals, playlists,
      // actors) stay create-if-missing so shared/edited docs , and folders that
      // hold other scenes , are never clobbered.
      const coll = game[meta.collection]
      const OVERWRITE_TYPES = new Set(["data/Scene.json"])
      // Teil 2: folders are structural grouping, not user content — never
      // delete+recreate them (that would orphan unrelated scenes to the root),
      // even in full-overwrite mode. Everything else is replaced by _id.
      const NO_OVERWRITE_TYPES = new Set(["data/folders.json"])
      const exists = d => !!(d?._id && coll?.get?.(d._id))
      let toCreate = arr.filter(d => !exists(d))
      let overwritten = 0
      if (this.overwrite && !NO_OVERWRITE_TYPES.has(relPath)) {
        // User confirmed the world-overwrite dialog: replace EVERY existing
        // pack doc of this type by _id (scenes + actors + journals + playlists
        // + items …). No name-guard — the overwrite was deliberate. Folders
        // stay create-if-missing (NO_OVERWRITE_TYPES above).
        const existing = arr.filter(exists)
        if (existing.length) {
          try {
            await docClass.deleteDocuments(existing.map(d => String(d._id)))
            overwritten = existing.length
            toCreate = arr.slice()   // all recreated fresh from the pack
          } catch (err) {
            console.warn(`BeneosNativeInstaller | overwrite delete failed for ${relPath}`, err)
            // fall through with create-if-missing only (toCreate unchanged)
          }
        }
      } else if (OVERWRITE_TYPES.has(relPath)) {
        // Same _id AND same name => the same scene (re-install or 4K<->HD switch)
        // => safe to overwrite (delete + recreate from the pack). Same _id but a
        // DIFFERENT name => a foreign scene happens to hold this id (cross-pack id
        // collision in relinked packs) => do NOT clobber it; record a conflict so
        // the report warns instead of destroying unrelated content.
        const sameScene = []
        for (const d of arr) {
          if (!exists(d)) continue
          const cur = coll.get(String(d._id))
          if (cur && String(cur.name || "") === String(d?.name || "")) {
            sameScene.push(d)
          } else {
            this._result.docFailures.push({
              type: meta.phaseKey, id: String(d?._id || "?"),
              error: `_id already used by a different scene "${cur?.name || "?"}", not overwritten (pack id collision)`,
            })
          }
        }
        if (sameScene.length) {
          try {
            await docClass.deleteDocuments(sameScene.map(d => String(d._id)))
            overwritten = sameScene.length
            // After deletion the same-scenes report as missing again, so this
            // recreates fresh + just-deleted scenes and still skips foreign-id docs.
            toCreate = arr.filter(d => !exists(d))
          } catch (err) {
            console.warn(`BeneosNativeInstaller | overwrite delete failed for ${relPath}`, err)
            // fall back to create-if-missing only (toCreate stays the fresh set)
          }
        }
      }
      this._result.totals.docsSkippedExisting += (arr.length - toCreate.length)

      if (toCreate.length === 0) {
        // Nothing to add: all docs of this type already present (closure docs we
        // intentionally do not overwrite). Honest no-op, not a failure.
        this.progress.handleAssetProgress(meta.phaseKey, arr.length, arr.length)
        this.progress.revealPhase?.(meta.phaseKey, { status: "done", current: arr.length, total: arr.length })
        continue
      }
      try {
        await docClass.createDocuments(toCreate, { keepId: true })
        this._result.totals.docsCreated += toCreate.length
        if (overwritten) this._result.totals.docsUpdated += overwritten
      } catch (err) {
        console.warn(`BeneosNativeInstaller | createDocuments failed for ${relPath}`, err)
        let ok = 0
        for (const d of toCreate) {
          try {
            await docClass.createDocuments([d], { keepId: true })
            ok += 1
            this._result.totals.docsCreated += 1
          } catch (e2) {
            console.warn(`BeneosNativeInstaller | doc create skipped (${d?._id})`, e2?.message || e2)
            this._result.docFailures.push({ type: meta.phaseKey, id: d?._id || "?", error: String(e2?.message || e2) })
          }
          this.progress.handleAssetProgress(meta.phaseKey, toCreate.length, ok)
        }
      }
      this.progress.handleAssetProgress(meta.phaseKey, arr.length, arr.length)
      this.progress.revealPhase?.(meta.phaseKey, { status: "done", current: arr.length, total: arr.length })
    }
  }

  /**
   * Merge playlists instead of replacing them. A new playlist is created whole
   * (with its sounds). An existing playlist (same _id) keeps its sounds and only
   * gains the pack's PlaylistSound(s) that aren't already present (matched by
   * _id), preserving the original sound _ids. So a release's ambiences are added
   * to the shared playlist, which grows with each install.
   */
  async #mergePlaylists(arr, docClass, meta) {
    const coll = game.playlists
    let created = 0, soundsAdded = 0, done = 0
    for (const pl of arr) {
      const id = String(pl?._id || "")
      const existing = id ? coll?.get?.(id) : null
      try {
        if (!existing) {
          await docClass.createDocuments([pl], { keepId: true })   // whole playlist + its sounds
          created += 1
        } else {
          const have = new Set((existing.sounds?.contents ?? existing.sounds ?? []).map(s => String(s?.id ?? s?._id)))
          const missing = (Array.isArray(pl.sounds) ? pl.sounds : []).filter(s => s?._id && !have.has(String(s._id)))
          if (missing.length) {
            await existing.createEmbeddedDocuments("PlaylistSound", missing, { keepId: true })
            soundsAdded += missing.length
          }
        }
      } catch (err) {
        console.warn("BeneosNativeInstaller | playlist merge failed", id, err?.message || err)
        this._result.docFailures.push({ type: meta.phaseKey, id: id || "?", error: String(err?.message || err) })
      }
      done += 1
      this.progress.handleAssetProgress?.(meta.phaseKey, arr.length, done)
    }
    this._result.totals.docsCreated += created
    // Count merged sounds as updates so completion isn't reported as "no changes".
    if (soundsAdded) this._result.totals.docsUpdated += soundsAdded
    this.progress.revealPhase?.(meta.phaseKey, { status: "done", current: arr.length, total: arr.length })
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
