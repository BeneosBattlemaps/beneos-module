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
import { packNeedsV14Migration, migrateSceneForV14 } from "./beneos-v14-scene-migration.mjs"

// ---- Transfer config -------------------------------------------------------
const FETCH_MAX_ATTEMPTS  = 3            // transient retries per asset
const FETCH_BACKOFF_MS    = [500, 1500, 4000]
const FETCH_INACTIVITY_MS = 30000       // abort if no bytes received for 30s
const FETCH_INACTIVITY_CHECK_MS = 5000  // how often the single inactivity watcher polls
const FETCH_TOTAL_MS      = 300000      // floor for the per-attempt safety cap (5 min)
const FETCH_HEADER_MS     = 60000       // budget until the response headers arrive
const FETCH_TOTAL_MAX_MS  = 1800000     // ceiling for the per-attempt safety cap (30 min)
const FETCH_MIN_RATE_BPS  = 5 * 1024    // slowest line we still wait out (5 KB/s)
const MANIFEST_MAX_REFRESH = 2          // signed-URL refreshes per install
const DOWNLOAD_CONCURRENCY = 6          // parallel asset transfers (moderate: gentle on the shared-hosting origin)
// Adaptive concurrency: six lanes split a thin pipe into six trickles, which
// keeps every single connection open for minutes and makes large files far more
// likely to die mid-body. We only ever reduce, never raise, so a healthy line
// behaves exactly as before.
const ADAPTIVE_MIN_BYTES  = 4 * 1024 * 1024  // judge throughput only after this much moved
const ADAPTIVE_SAMPLE_MIN = 512 * 1024       // ignore transfers this small: latency, not bandwidth, dominates them
const ADAPTIVE_SLOW_BPS   = 80 * 1024        // below this PER-LANE rate, thin the pool
const ADAPTIVE_MIN_LANES  = 2                // floor: never serialize a healthy install
// Uninstall stubs: Foundry exposes no file-delete API to modules, so the
// uninstaller reclaims disk space by overwriting assets with a 1-byte file.
// Anything this small is a stub (or a corpse), never a real asset.
export const STUB_MAX_BYTES = 8
// Content types a CDN compresses in transit. For these, Content-Length carries
// the ENCODED size while the body reader yields DECODED bytes, so the two must
// never be compared. Content-Encoding would state this outright, but it is not
// a CORS-safelisted response header: cross-origin it reads as empty even when
// the server compresses. Content-Type is safelisted, and it is also what
// decides whether a CDN compresses at all, so it is the only honest signal we
// have. Binary assets (webm/webp/ogg) are already compressed and pass through
// untouched, which is exactly where the size arithmetic stays trustworthy.
const COMPRESSIBLE_TYPE = /^(?:text\/|application\/(?:json|javascript|x-javascript|xml)|image\/svg\+xml)/i

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
// Self-contained packs bundle every local asset a document references, including
// module-owned icons (modules/...), the scene thumbnail (worlds/<author-world>/...)
// and other non-beneos content. Those are relocated under this packaged namespace
// on install so they survive the customer disabling beneos-module or migrating
// worlds. The per-asset original->packaged mapping is built in #classifyPack.
const PACKAGED_INSTALL_PREFIX = "beneos_assets/cloud/packaged/"

const stripLeadSlash = (p) => String(p).replace(/^\/+/, "")

/** Swap the pack-source asset prefix for the cloud-install prefix in a string. */
function toCloudAssetPath(p) {
  return (typeof p === "string" && p.includes(PACK_SOURCE_PREFIX))
    ? p.split(PACK_SOURCE_PREFIX).join(CLOUD_INSTALL_PREFIX)
    : p
}

/**
 * Map a single asset-reference string to where the file was actually installed:
 *  1. beneos_assets/beneos_battlemaps/ -> beneos_assets/cloud/battlemaps/ (prefix swap)
 *  2. any non-beneos path that was bundled+relocated -> its packaged target,
 *     via an EXACT lookup in `remap` (keyed by the decoded, slash-stripped path).
 *  3. either result -> its converted filename via `uploadRemap`, when a
 *     third-party upload converter (e.g. Media Optimizer turning .svg into
 *     .webp) wrote the file under a different name than we sent.
 * The exact lookups mean only strings whose file was packed get rewritten:
 * non-asset strings (journal HTML, flags) and the separate token/spell/item
 * refs under beneos_assets/ are never touched.
 */
function remapAssetString(s, remap, uploadRemap) {
  // Empty strings are never asset refs. Guard hard so a bogus remap entry
  // keyed "" (e.g. from a ZIP directory entry) can never rewrite empty fields.
  if (typeof s !== "string" || s === "") return s
  const swapped = toCloudAssetPath(s)
  if (swapped !== s) {
    const converted = (uploadRemap && uploadRemap.size) ? uploadRemap.get(stripLeadSlash(swapped)) : null
    if (!converted) return swapped
    return swapped.startsWith("/") ? "/" + converted : converted
  }
  if (remap && remap.size) {
    let key = stripLeadSlash(s)
    try { key = stripLeadSlash(decodeURIComponent(s)) } catch (_) { /* keep raw key */ }
    let target = remap.get(key)
    if (target) {
      if (uploadRemap && uploadRemap.size) target = uploadRemap.get(target) || target
      return s.startsWith("/") ? "/" + target : target
    }
  }
  return s
}

/**
 * Deep-walk a parsed document and relocate every bundled asset reference to its
 * installed location (battlemaps namespace + the packaged namespace via `remap`).
 * Mutates in place. Scoped so tokens/spells/items refs under beneos_assets/ and
 * non-asset strings stay untouched.
 */
function rewriteDocAssetPaths(value, remap, uploadRemap) {
  if (typeof value === "string") return remapAssetString(value, remap, uploadRemap)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = rewriteDocAssetPaths(value[i], remap, uploadRemap)
    return value
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = rewriteDocAssetPaths(value[k], remap, uploadRemap)
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
    // Rolling PER-CONNECTION download throughput, used to thin the transfer
    // pool on a slow line (see #maybeThrottleLanes). Counts only time a fetch
    // was actually streaming, so the upload half of the transfer never drags
    // the measurement down. Reset at the start of the asset phase.
    this._netBytes = 0
    this._netMs    = 0
    this._manifestRefreshes = 0
    this._urlByTarget = new Map() // target/relPath -> current signed URL (refreshable)
    this._packagedRemap = new Map() // original asset path -> packaged install target (self-contained relocation)
    this._uploadRemap = new Map()   // install target -> path actually written (third-party upload converters, e.g. Media Optimizer)
    this._dirPromises = new Map() // dir -> in-flight #ensureDir promise (dedupe under parallel transfers)
    this._refreshInFlight = null  // shared in-flight signed-URL refresh (dedupe concurrent 403s)
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

  /**
   * Read-only view of what a release consists of: every asset's install target
   * and the URL map for the document collections. Writes nothing, touches no
   * world document, opens no UI.
   *
   * The uninstaller needs exactly this to work out what belongs to a release,
   * and it must be the SAME derivation the installer uses, or the two would
   * drift apart and uninstall would start missing files. Hence a thin static
   * wrapper around the existing classification instead of a second copy of it.
   *
   * @returns {Promise<{assets: Array, jsons: Object, packInfo: Object}>}
   */
  static async describePack({ packageId, source = null } = {}) {
    const inst = new BeneosNativeBattlemapInstaller({ packageId, source })
    // #classifyPack counts packaged assets into _result, which run() normally
    // creates. Give it a throwaway so the read-only path does not depend on the
    // install lifecycle.
    inst._result = { totals: {} }
    const packInfo = await inst.#loadPackInfo()
    const { assets, jsons } = inst.#classifyPack(packInfo)
    return { assets, jsons, packInfo }
  }

  async run() {
    // Ohne Netz gar nicht erst anfangen.
    //
    // Jede Uebertragung hier laeuft durch #fetchAsset, und das ist auf
    // Ausdauer gebaut: drei Versuche, dazwischen Wartezeiten, und eine
    // Sicherheitsgrenze, die bei FETCH_TOTAL_MS beginnt, also bei fuenf
    // Minuten je Versuch. Das ist richtig fuer eine schwache Leitung und
    // falsch fuer gar keine.
    //
    // Gemessen am 27.08.2026 als TC-PRJ-STR-041 auf Foundry 13.351: eine
    // Installation ohne Netz lief **ueber drei Minuten** ohne Abbruch, ohne
    // eine einzige Meldung und ohne Wurf. Die Welt blieb dabei unversehrt,
    // 71 Szenen vorher wie nachher, aber der Kunde sass vor einem
    // Fortschrittsfenster, das nichts sagte.
    //
    // `navigator.onLine` ist nur in einer Richtung verlaesslich, und genau die
    // wird hier benutzt: sagt der Browser "kein Netz", dann stimmt das. Sagt er
    // "Netz", kann trotzdem die Route nach draussen fehlen; dafuer bleibt die
    // gewoehnliche Fehlerbehandlung zustaendig, die nach dem ersten
    // fehlgeschlagenen Abruf greift.
    if (navigator.onLine === false) {
      const satz = game.i18n?.localize?.("BENEOS.InstallNoNetwork")
      const text = (satz && satz !== "BENEOS.InstallNoNetwork")
        ? satz
        : `Beneos: "${this.label || this.packageId}" cannot be installed, there is `
          + "no network connection. Nothing was written to your world.";
      ui.notifications?.warn?.(text)
      console.debug(`Beneos Installer | ${this.packageId}: aborted before start, browser reports no network`)
      return this.#newResult()
    }

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
      // F1: a battlemap pack always ships scene documents. If the server
      // returned NO Scene.json at all (the entitlement gate keeps the binary
      // assets public+signed but withholds the scene documents for a caller
      // without access), the install would silently leave downloaded files with
      // zero scenes , exactly the "maps in the folder but no scenes" report.
      // Fail loudly with the existing membership message instead of half-installing.
      if (!this._importedScenes?.length && !jsons["data/Scene.json"]) {
        throw new Error(game.i18n.localize("BENEOS.Cloud.Bmap.PoiInstall.NoAccess"))
      }
      await this.#verifyAndRepair(installAssets)
      // F5: #importDocuments nulls the author-world scene.thumb path (it would
      // 404 here), so regenerate thumbnails from the now-uploaded backgrounds.
      await this.#regenerateSceneThumbs()

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

      // Third-party upload converters (e.g. Media Optimizer) are transparent to
      // the user; tell them their files were adapted, not silently renamed.
      if (this._uploadRemap.size) {
        try { ui.notifications.info(game.i18n.format("BENEOS.Cloud.Install.ConvertedUploads", { count: this._uploadRemap.size })) } catch (_) {}
      }

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
   * the clicked (primary) scene; release -> the "Start Here" welcome scene if
   * present (the Getting Started pack's intended entry point), else the
   * "Overview" scene, else the first imported scene. The pack carries no
   * active/initial-view flag, so we resolve it by scene name.
   */
  #pickOpenSceneId() {
    if (this._sceneScope?.primarySceneId) return this._sceneScope.primarySceneId
    const scenes = this._importedScenes || []
    if (!scenes.length) return null
    const startHere = scenes.find(s => /^\s*start\s*here\s*$/i.test(s.name))
    const exact = scenes.find(s => /^\s*overview\s*$/i.test(s.name))
    const loose = scenes.find(s => /overview/i.test(s.name))
    return (startHere || exact || loose || scenes[0]).id
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
    if (sig && prior.sourceSignature && prior.sourceSignature !== sig) {
      // Telemetry: local install no longer matches the online signature, the
      // module heals itself with a fresh download (throttled per reason).
      try { game.beneos?.analytics?.trackSelfRepair?.(this.record?.assetId || "", "signature_mismatch") } catch (_) {}
      return true
    }
    const upd = String(this.record?.updatedDate || "")
    if (upd && prior.installedAt) {
      const i = Date.parse(prior.installedAt), u = Date.parse(upd)
      if (Number.isFinite(i) && Number.isFinite(u) && i < u) return true
    }
    return false
  }

  /**
   * Regenerate scene thumbnails. Native packs strip the author-world `thumb`
   * path (it would 404 in the customer world), so imported scenes arrive with no
   * thumb; render a fresh one from the now-installed background. Best-effort and
   * non-fatal (e.g. a video background that won't snapshot just stays thumbless
   * until the GM opens the scene).
   */
  async #regenerateSceneThumbs() {
    const scenes = (this._importedScenes || [])
      .map(s => game.scenes?.get(String(s.id)))
      .filter(sc => sc && !sc.thumb)
    if (!scenes.length) return
    for (const scene of scenes) {
      try {
        const t = await scene.createThumbnail()
        if (t?.thumb) await scene.update({ thumb: t.thumb })
      } catch (e) {
        console.warn(`BeneosNativeInstaller | thumbnail regen failed for "${scene.name}"`, e?.message || e)
      }
    }
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

  // Pack-Actors sind dnd5e-authored. In fremden Systemen (pf2e, pf1, ...)
  // wirft das 1:1-Anlegen "Failed data preparation" beim Dokument-Init
  // (z.B. system.traits.size als String "med" im pf2e-DataModel). Deshalb
  // wird der Actor dort auf ein System-Geruest reduziert: fuer pf2e das
  // generic_npc_pf2.json aus dem Cloud-Token-Pfad, sonst ein leerer Actor
  // des system-eigenen npc-Typs (Schema-Defaults fuellen den Rest).
  // _id, Name, Bild, prototypeToken (Core-Schema, systemneutral), folder
  // und flags bleiben erhalten, damit Szenen-Referenzen und das
  // creatureInstaller-Flag weiter aufloesen.
  async #swapActorsForForeignSystem(arr) {
    let template = null
    if (game.system.id === "pf2e") {
      try {
        const r = await fetch("modules/beneos-module/scripts/generic_npc_pf2.json")
        template = await r.json()
      } catch (e) {
        console.warn("BeneosNativeInstaller | generic_npc_pf2.json unavailable, falling back to bare npc", e)
      }
    }
    const types = (game.documentTypes?.Actor || []).filter(t => t !== "base")
    const npcType = template?.type || (types.includes("npc") ? "npc" : (types[0] || "npc"))
    return arr.map(src => {
      if (!src || typeof src !== "object") return src
      const out = template ? foundry.utils.deepClone(template) : {}
      out._id = src._id
      out.name = src.name
      out.type = npcType
      if (src.img) out.img = src.img
      if (src.prototypeToken) out.prototypeToken = foundry.utils.deepClone(src.prototypeToken)
      if (src.folder !== undefined) out.folder = src.folder
      if (src.flags) out.flags = foundry.utils.deepClone(src.flags)
      if (src.ownership) out.ownership = src.ownership
      if (src.sort !== undefined) out.sort = src.sort
      return out
    })
  }

  // ---- Result + environment ------------------------------------------------

  #newResult() {
    return {
      packageId: this.packageId,
      label:     this.label,
      env:       this.#envFingerprint(),
      totals:    { assets: 0, ok: 0, repaired: 0, failed: 0, docsCreated: 0, docsUpdated: 0, docsSkippedExisting: 0, docsFailed: 0, packagedAssets: 0, convertedUploads: 0 },
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
    // Beta: Beneos Stream. The heavy files never enter packInfo, so nothing
    // downloads them; their addresses are applied to the documents further down
    // (#importDocuments). With the beta switch off this branch does not exist.
    // See scripts/stream/stream-install.mjs.
    const stream = globalThis.BeneosStream
    // mayRun(), not enabled(): the one-time confirmation that a backup exists
    // is the condition for writing into an existing world, and asking for it is
    // pointless if the install starts anyway when it is refused.
    if (stream?.mayRun?.() && this.source?.kind !== "zip") {
      const { release, variant } = stream.releaseFromPackage(this.packageId)
      const manifest = await stream.loadStreamManifest(release, variant)
      const built = stream.buildStreamPack(manifest, release, variant)
      this._streamTargets = built.streamTargets
      console.log(`Beneos Stream | ${release}/${variant} | mode ${built.download ? "download" : "stream"} | `
        + `${built.streamTargets.size} files stay remote `
        + `(${Math.round(built.edgeBytes / 1048576)} MB per release, `
        + `${Math.round((built.sharedBytes || 0) / 1048576)} MB shared), `
        + `${Math.round(built.localBytes / 1048576)} MB installed, ${built.skipped || 0} not shipped`)
      return built.packInfo
    }
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
    this._packagedRemap = new Map()
    for (const [relPath, url] of Object.entries(packInfo)) {
      if (relPath === "mtte.json" || relPath === "beneos-pack-manifest.json") continue
      // ZIP directory entries (name ends with "/") are folders, not files: no
      // bytes to install, and "data/assets/" itself would register the empty
      // string in _packagedRemap, which then rewrites EVERY empty document
      // field into a path (real-world case: all 123 CoS landing-page actors
      // rejected by dnd5e formula validation). 99 of 282 archive ZIPs carry
      // such entries (7-Zip style packing), so skip them outright.
      if (relPath.endsWith("/")) continue
      if (relPath.startsWith("data/assets/")) {
        const rawRel = relPath.substring("data/assets/".length)
        let target = toCloudAssetPath(rawRel)
        // Self-contained relocation: anything that did NOT land in a beneos_assets
        // namespace (modules/<id>/…, worlds/<author-world>/… scene thumbs,
        // icons/…, systems/…) is bundled by the pack. We must NOT write it back
        // into modules/ or systems/ (Foundry warns that's unsafe and a package
        // update would wipe it), so relocate it under the packaged namespace and
        // remember the original->packaged mapping so #importDocuments rewrites the
        // document references to match. Shared paths across releases map to the
        // same target, so re-installs dedupe (existing files are skipped).
        if (!/^beneos_assets\//i.test(target)) {
          target = PACKAGED_INSTALL_PREFIX + stripLeadSlash(target)
          this._packagedRemap.set(stripLeadSlash(rawRel), target)
          this._result.totals.packagedAssets = (this._result.totals.packagedAssets || 0) + 1
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
      // Drawer-Modell: Szenen liefern ihre Kreaturen nicht mehr als platzierte
      // Tokens, sondern im creatureInstaller-Flag. Die dort referenzierten
      // SRD-Actors gehoeren zur Szenen-Closure, sonst fehlen sie dem Drawer
      // nach einem Einzelszenen-Install.
      //
      // NUR srdCreatures. Beneos-Kreaturen gehoeren nicht ins Kartenpaket,
      // sie kommen ueber #installBeneosCreatures aus der Cloud und nur fuer
      // Unterstuetzer. Stand hier auch beneosCreatures, holte ein
      // Einzelszenen-Install einen faelschlich mitgepackten Premium-Actor in
      // die Welt - ohne Registry-Eintrag, also ohne HUD und ohne Aktualisierung.
      const ci = sc?.flags?.["beneos-module"]?.creatureInstaller
      for (const e of (Array.isArray(ci?.srdCreatures) ? ci.srdCreatures : [])) {
        if (e?.actorId) actorIds.add(String(e.actorId))
        for (const p of (Array.isArray(e?.positions) ? e.positions : [])) {
          if (p?.actorId) actorIds.add(String(p.actorId))
        }
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

  /**
   * Re-mint signed URLs (signatures expire after ~2h; slow installs outrun them).
   * Deduped: under parallel transfers many 403s arrive at once — they must share
   * ONE refresh (a single getPackInfo) instead of each burning the small
   * MANIFEST_MAX_REFRESH budget and stampeding the origin.
   */
  #refreshManifest() {
    if (this._refreshInFlight) return this._refreshInFlight
    this._refreshInFlight = this.#doRefreshManifest().finally(() => { this._refreshInFlight = null })
    return this._refreshInFlight
  }

  async #doRefreshManifest() {
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

  /** Parse a `Content-Range: bytes <start>-<end>/<total>` response header. */
  #parseContentRange(value) {
    const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(value || "").trim())
    if (!m) return null
    return { start: Number(m[1]), end: Number(m[2]), total: m[3] === "*" ? null : Number(m[3]) }
  }

  /**
   * Single fetch attempt with an INACTIVITY timeout: the request is aborted
   * only if no bytes arrive for FETCH_INACTIVITY_MS, so a genuinely slow but
   * progressing download (Raspberry Pi / slow line) is never killed.
   *
   * `carry` accumulates the bytes received across attempts: whatever arrived
   * before a mid-body failure is kept, and the next attempt asks for the rest
   * with a Range header instead of restarting at byte zero. Our delivery
   * endpoint answers those with a real 206 (scenepacker-files.php), so a
   * transfer that dies at 80% resumes at 80%.
   *
   * The total cap is armed in two stages: a short window until the headers
   * arrive, then a window derived from Content-Length. The old fixed 5 minutes
   * made large files on thin lines mathematically impossible to finish (a 24 MB
   * asset at 42 KB/s needs ~10 min), so they failed deterministically on every
   * attempt. Returns a Blob.
   */
  async #fetchOnce(url, carry) {
    const controller = new AbortController()
    // Per-attempt throughput sample (see #maybeThrottleLanes). Recorded in the
    // finally block so an aborted transfer still contributes: a lane crawling
    // at 40 KB/s until it dies is precisely the signal we want.
    let attemptBytes = 0
    let streamStart  = 0
    // Inactivity guard WITHOUT per-chunk timer churn: record the timestamp of
    // the last received bytes and let a single low-frequency watcher abort if
    // the gap exceeds FETCH_INACTIVITY_MS. The previous version re-armed a
    // clearTimeout/setTimeout pair on every streamed chunk, which dominated the
    // main thread on weak hardware during large downloads (thousands of timer
    // ops). One interval keeps the exact same behaviour (abort on a genuine
    // stall, never on a slow-but-progressing line) at a fraction of the cost.
    let lastByteAt = performance.now()
    const inactivityWatch = setInterval(() => {
      if (performance.now() - lastByteAt > FETCH_INACTIVITY_MS) {
        controller.abort(new DOMException("inactivity timeout", "AbortError"))
      }
    }, FETCH_INACTIVITY_CHECK_MS)
    let total = setTimeout(() => controller.abort(new DOMException("header timeout", "AbortError")), FETCH_HEADER_MS)
    try {
      // A body known to arrive compressed cannot be resumed (see carry.noResume
      // below): drop what we hold and take it from the top.
      if (carry.noResume && carry.bytes > 0) {
        carry.chunks = []
        carry.bytes = 0
        carry.total = null
      }
      const resumeFrom = carry.bytes > 0 ? carry.bytes : 0
      const init = { signal: controller.signal }
      if (resumeFrom > 0) init.headers = { Range: `bytes=${resumeFrom}-` }
      const resp = await fetch(url, init)
      // 416 on a resume means the requested range starts past the end. That is
      // only good news if we actually hold the whole file, so confirm against
      // the total size the server reports in its Content-Range before believing
      // it. Without that check a spurious 416 would pass a partial file as done.
      if (resumeFrom > 0 && resp.status === 416) {
        const totalOnly = /\/\s*(\d+)\s*$/.exec(String(resp.headers.get("content-range") || ""))
        const knownTotal = totalOnly ? Number(totalOnly[1]) : null
        if (knownTotal == null || knownTotal === carry.bytes) {
          return new Blob(carry.chunks, { type: carry.type || "application/octet-stream" })
        }
        carry.chunks = []
        carry.bytes = 0
        throw new TransferError(`range rejected at ${resumeFrom}/${knownTotal}, restarting`, INSTALL_ERROR.NETWORK, 416)
      }
      if (!resp.ok) throw new TransferError(`HTTP ${resp.status}`, classifyTransferError(null, resp.status), resp.status)

      // Range safety. A server or proxy that ignores Range answers 200 with the
      // FULL body; appending that to the bytes we already hold would silently
      // produce a corrupt file that passes every later check.
      //
      // Content-Range would be the natural thing to verify against, but it is
      // NOT a CORS-safelisted response header, so cross-origin it reads as null
      // even though the server sends it (measured against beneos.cloud). Only
      // Content-Length is exposed, so the fallback check is arithmetic: what is
      // still coming plus what we already hold must equal the size the first
      // response advertised. Same-origin (ZIP-less dev setups, proxies) the
      // real header is there and takes precedence.
      if (resumeFrom > 0) {
        let sane = false
        if (resp.status === 206) {
          const cr = this.#parseContentRange(resp.headers.get("content-range"))
          if (cr) {
            sane = cr.start === resumeFrom
            if (cr.total != null) carry.total = cr.total
          } else if (carry.total != null) {
            const remaining = Number(resp.headers.get("content-length"))
            sane = Number.isFinite(remaining) && remaining > 0 && (carry.bytes + remaining === carry.total)
          }
        }
        if (!sane) {
          // Drop the partial buffer. A 200 here means the peer ignored Range and
          // is about to send the whole file, which we can simply take. A 206 we
          // could not validate must not be consumed at all, because its body is
          // a fragment: restart the asset from byte zero instead.
          carry.chunks = []
          carry.bytes = 0
          if (resp.status === 206) {
            throw new TransferError("unverifiable partial response, restarting", INSTALL_ERROR.NETWORK, 206)
          }
        }
      }

      const type = resp.headers.get("content-type") || carry.type || "application/octet-stream"
      carry.type = type

      // Was this body compressed in transit? Content-Encoding answers that
      // directly but is invisible cross-origin (see COMPRESSIBLE_TYPE), so the
      // content type has to stand in for it. Both are consulted: same-origin
      // and behind a proxy that exposes the header, the real answer wins.
      const enc = (resp.headers.get("content-encoding") || "").toLowerCase()
      const encoded = (!!enc && enc !== "identity") || COMPRESSIBLE_TYPE.test(type)

      // A Range request against a compressed body returns a fragment of the
      // gzip stream with no header, which no browser can decode: the fetch dies
      // with ERR_CONTENT_DECODING_FAILED. Such bodies are only ever taken
      // whole, so a retry restarts at zero instead of resuming.
      if (encoded) carry.noResume = true

      // Expected total size, used both for the time budget and as a truncation
      // guard. Only meaningful when the advertised length and the bytes we
      // count are measured in the same units, i.e. on an uncompressed body.
      let expected = null
      if (!encoded) {
        const cl = Number(resp.headers.get("content-length"))
        if (resp.status === 206) {
          // On a validated 206 the total is either already known from the first
          // attempt or derivable from what we hold plus what is still coming.
          expected = carry.total ?? (Number.isFinite(cl) && cl > 0 ? carry.bytes + cl : null)
        } else if (Number.isFinite(cl) && cl > 0) {
          expected = cl
          carry.total = cl   // remembered so a later resume can validate itself
        }
      }

      // Re-arm the safety cap now that the size is known: enough time to finish
      // the remaining bytes at a very slow but real rate, floored at the old
      // value and ceilinged so a wedged connection still ends eventually. The
      // inactivity watcher above remains the actual hang guard.
      clearTimeout(total)
      const budgetMs = expected != null
        ? Math.min(FETCH_TOTAL_MAX_MS, Math.max(FETCH_TOTAL_MS, ((expected - carry.bytes) / FETCH_MIN_RATE_BPS) * 1000))
        : FETCH_TOTAL_MS
      total = setTimeout(() => controller.abort(new DOMException("total timeout", "AbortError")), budgetMs)

      lastByteAt = performance.now()
      streamStart = lastByteAt
      if (!resp.body || typeof resp.body.getReader !== "function") {
        // Environment without streaming: take the whole body in one piece.
        const buf = new Uint8Array(await resp.arrayBuffer())
        carry.chunks.push(buf)
        carry.bytes += buf.length
        attemptBytes += buf.length
      } else {
        const reader = resp.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            carry.chunks.push(value)
            carry.bytes += value.length
            attemptBytes += value.length
            lastByteAt = performance.now()
          }
        }
      }

      // Truncation guard: a body that ends cleanly but short used to pass as a
      // success and left a broken asset on disk. Treated as transient so the
      // retry resumes from where it stopped.
      //
      // Only a SHORT body counts. Receiving MORE than Content-Length advertised
      // means the response was compressed in transit: the header carries the
      // encoded size while the reader yields the decoded bytes. Content-Encoding
      // is not reliably visible to us cross-origin, so the byte counts are the
      // only honest signal. Measured against beneos.cloud: folders.json arrives
      // as 5609 bytes against a Content-Length of 1017, while binary assets
      // (webp/webm/ogg) match exactly. Flagging that as truncation made every
      // compressed JSON retry until its budget ran out.
      if (expected != null && carry.bytes > expected) {
        carry.total = null   // the advertised size was the encoded one: useless for resume arithmetic
      } else if (expected != null && carry.bytes < expected) {
        throw new TransferError(`incomplete body: ${carry.bytes}/${expected} bytes`, INSTALL_ERROR.NETWORK, null)
      }
      return new Blob(carry.chunks, { type })
    } catch (err) {
      if (err instanceof TransferError) throw err
      const cat = err?.name === "AbortError" ? INSTALL_ERROR.TIMEOUT : classifyTransferError(err, null)
      throw new TransferError(err?.message || String(err), cat, null)
    } finally {
      clearInterval(inactivityWatch)
      clearTimeout(total)
      // Only samples big enough to be bandwidth-bound count. A burst of tiny
      // files is dominated by round-trip latency and would make a perfectly
      // healthy connection look slow.
      if (streamStart && attemptBytes >= ADAPTIVE_SAMPLE_MIN) {
        this._netBytes += attemptBytes
        this._netMs    += Math.max(1, performance.now() - streamStart)
      }
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
    // Bytes received so far, kept ACROSS attempts so a failure mid-body resumes
    // with a Range request instead of restarting at zero. Survives a signed-URL
    // refresh too: same file, same offset, only the URL changes.
    const carry = { chunks: [], bytes: 0, type: null, total: null }
    // `guard` is the hard upper bound on loop turns: transient failures are
    // capped by FETCH_MAX_ATTEMPTS, but a SIGNATURE refresh and a partial-body
    // resume both `continue` without bumping `transient`, so guard backstops a
    // pathological loop. Refreshes are separately capped by MANIFEST_MAX_REFRESH.
    for (let guard = 0; guard < 32; guard++) {
      const bytesBefore = carry.bytes
      try {
        return await this.#fetchOnce(url, carry)
      } catch (err) {
        const cat = err.category || INSTALL_ERROR.UNKNOWN
        if (cat === INSTALL_ERROR.NOTFOUND) throw err
        if (cat === INSTALL_ERROR.SIGNATURE) {
          const fresh = await this.#refreshManifestFor(targetOrRelPath)
          if (fresh) { url = fresh; continue }
          throw err
        }
        // An attempt that moved bytes forward is progress, not a failed try: on
        // a thin line a large asset may well need several resumes, and burning
        // the retry budget on them would reintroduce the very failure this
        // fixes. Only attempts that gained nothing count against the limit.
        //
        // A body that cannot be resumed (carry.noResume) is exempt: it restarts
        // at zero every time, so bytes received are repeated work, not ground
        // gained, and crediting them would let a dying line loop until the
        // guard runs out instead of failing after FETCH_MAX_ATTEMPTS.
        if (carry.bytes > bytesBefore && !carry.noResume) {
          // Still a real delivery interruption, so it stays in the telemetry:
          // otherwise resuming would hide exactly the per-country error rate
          // this signal exists to surface.
          try { game.beneos?.analytics?.trackDownloadRetry?.(this.record?.assetId || "", transient + 1) } catch (_) {}
          continue
        }
        transient += 1
        if (transient >= FETCH_MAX_ATTEMPTS) throw err
        // Telemetry: a transient transfer failure with an actual retry ahead
        // (feeds the per-country delivery error rate; throttled per asset).
        try { game.beneos?.analytics?.trackDownloadRetry?.(this.record?.assetId || "", transient) } catch (_) {}
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

  /**
   * Memoized #ensureDir: under parallel transfers, many files target the same
   * directory; ensure each path's mkdir-p runs ONCE (shared promise) instead of
   * firing hundreds of concurrent createDirectory calls. A failed ensure is
   * evicted so a later (sequential repair) pass can retry it.
   */
  #ensureDirOnce(dir) {
    if (!dir) return Promise.resolve({ ok: true })
    let p = this._dirPromises.get(dir)
    if (!p) {
      p = this.#ensureDir(dir).then(r => {
        if (!r.ok) this._dirPromises.delete(dir)
        return r
      })
      this._dirPromises.set(dir, p)
    }
    return p
  }

  /** Download + upload one asset. Returns {ok} or {ok:false, category, error}. */
  async #transferOne(a) {
    const dir  = a.target.includes("/") ? a.target.substring(0, a.target.lastIndexOf("/")) : ""
    const file = a.target.substring(a.target.lastIndexOf("/") + 1)
    if (dir) {
      const d = await this.#ensureDirOnce(dir)
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
    this.#noteUploadRename(a, file, up.path)
    return { ok: true }
  }

  /**
   * Detect a third-party upload converter: modules like Media Optimizer wrap
   * FilePicker.upload and write a CONVERTED file (e.g. every .svg becomes a
   * rasterized .webp), so the name we sent never exists on the server and the
   * verify pass would fail every such asset (real case: Sqyre user, 11 svg map
   * icons, 2026-07-14). The upload response carries the path actually written;
   * when its basename differs from what we sent, record target -> actual so
   * document refs and the verify pass follow the converted file. Compared by
   * basename only: The Forge answers with a foreign URL prefix for every
   * upload, and that must not register as a rename.
   */
  #noteUploadRename(a, sentName, returnedPath) {
    if (!returnedPath) return
    let base = String(returnedPath).split("?")[0].split("/").pop()
    try { base = decodeURIComponent(base) } catch (_) { /* keep raw */ }
    if (!base || base === sentName) { this._uploadRemap.delete(a.target); return }
    const dir = a.target.includes("/") ? a.target.substring(0, a.target.lastIndexOf("/")) : ""
    const actual = dir ? `${dir}/${base}` : base
    if (this._uploadRemap.get(a.target) !== actual) {
      this._uploadRemap.set(a.target, actual)
      console.warn(`BeneosNativeInstaller | upload converted by another module: ${a.target} -> ${actual}`)
    }
    this._result.totals.convertedUploads = this._uploadRemap.size
  }

  /** Where an asset actually lives on the server (converted name when a third-party module renamed it). */
  #installedPath(a) {
    return this._uploadRemap.get(a.target) || a.target
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

  /**
   * Run `worker(item, index)` over `items` with at most `concurrency` in flight.
   * Workers pull from a shared cursor; resolves when every item is processed.
   * Single-threaded JS -> shared-counter mutations inside the worker are safe.
   * A worker must not throw (handle per-item errors itself).
   *
   * Optional `budget` ({ lanes }) lets a caller shrink the pool while it runs:
   * a lane retires itself between items once the pool exceeds the budget. It
   * retires rather than aborts, so in-flight transfers always finish.
   */
  async #runPool(items, concurrency, worker, budget = null) {
    const n = items.length
    if (n === 0) return
    let next = 0
    const lanes = Math.max(1, Math.min(concurrency, n))
    let active = lanes
    const runLane = async () => {
      for (let i = next++; i < n; i = next++) {
        await worker(items[i], i)
        if (budget && active > Math.max(1, budget.lanes)) { active -= 1; return }
      }
    }
    await Promise.all(Array.from({ length: lanes }, runLane))
  }

  /**
   * Thin the pool once when the measured PER-LANE rate shows the line cannot
   * carry six streams. Six lanes on a 250 KB/s link give each file ~42 KB/s,
   * which holds a single connection open for minutes and is what makes large
   * assets die mid-body. Two lanes on the same link move each file 3x faster.
   *
   * Per-lane rather than aggregate on purpose: aggregate over wall-clock would
   * also count the upload half of each transfer, where no download bytes
   * arrive, and would therefore understate a healthy line by roughly half.
   *
   * Deliberately one-way (never raises past DOWNLOAD_CONCURRENCY) and only
   * judged once enough bandwidth-bound bytes have moved, so a fast connection
   * is never mistaken for a slow one.
   */
  #maybeThrottleLanes(budget) {
    if (this._zipEntries) return                              // ZIP source: no network to measure
    if (!budget || budget.lanes <= ADAPTIVE_MIN_LANES) return // already thinned
    if (this._netBytes < ADAPTIVE_MIN_BYTES) return           // too little data to judge
    if (this._netMs < 1000) return
    const bps = (this._netBytes / this._netMs) * 1000
    if (bps >= ADAPTIVE_SLOW_BPS) return
    budget.lanes = ADAPTIVE_MIN_LANES
    console.warn(`BeneosNativeInstaller | thin line (~${Math.round(bps / 1024)} KB/s per stream), reducing to ${budget.lanes} parallel transfers`)
  }

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
    // Fast first pass: download up to DOWNLOAD_CONCURRENCY assets in parallel.
    // Anything that fails here is re-fetched ONE AT A TIME in #verifyAndRepair
    // (the hardened single-stream fallback for a bad/saturated connection).
    this.progress.handleStatusMessage("Downloading scene assets")
    this.progress.revealPhase?.("assets", { status: "active", current: 0, total })
    let done = 0
    const budget = { lanes: DOWNLOAD_CONCURRENCY }
    this._netBytes = 0
    this._netMs    = 0
    await this.#runPool(assets, DOWNLOAD_CONCURRENCY, async (a) => {
      const res = await this.#transferOne(a)
      if (res.ok) this._result.totals.ok += 1
      else this.#recordAssetFailure(a.target, res.category, res.error)
      done += 1
      this.progress.handleAssetProgress("Assets", total, done)
      this.progress.revealPhase?.("assets", { status: "active", current: done, total })
      this.#maybeThrottleLanes(budget)
    }, budget)
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
        // Keep the category the transfer layer already worked out. Without it
        // the report has nothing to reason about and falls back to "unknown"
        // for every document failure, which is the one verdict that helps
        // nobody reading it.
        this._result.docFailures.push({
          type: meta.phaseKey, id: "(all)",
          category: err?.category || INSTALL_ERROR.UNKNOWN,
          error: String(err?.message || err),
        })
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
        // V13 -> V14 import bridge. Foundry migrates worlds across core versions,
        // but raw createDocuments() bypasses that migration, so a V13-authored
        // pack installed into a V14 world needs the conversions applied here:
        // scene background/foreground/backgroundColor -> scene.levels[0], tile
        // occlusion.mode -> occlusion.modes, and tile top-left -> anchor-point
        // coordinates. Gated per scene on the pack origin (_stats.coreVersion), so
        // V13 installs and future V14-authored packs are byte-identical. Runs
        // BEFORE rewriteDocAssetPaths so the relocated background src (now under
        // levels[0].background.src) still gets remapped into the cloud namespace.
        // Full analysis: J:\Beneos_programming\_testing\v13_v14_scene_differential_2026-07-07.md.
        for (const d of arr) {
          if (!d || typeof d !== "object") continue
          // F5: drop the author-world `thumb` path (a <id>-thumb.webp that 404s in
          // the customer world). #regenerateSceneThumbs renders a fresh one after.
          d.thumb = null
          if (packNeedsV14Migration(d)) migrateSceneForV14(d)
        }
        this._importedScenes = arr.map(d => ({ id: String(d?._id), name: String(d?.name || "") }))
      }
      // A journal page whose name is an empty string costs the WHOLE journal.
      // JournalEntryPage#name is a StringField({required: true, blank: false}),
      // so Foundry's clean() turns "" into undefined and the create then fails
      // with "name: may not be undefined" , a message that points away from the
      // real cause. createDocuments() throws for the entire batch, the per-doc
      // retry below re-throws for this one, and the release installs with a note
      // pin that leads nowhere. Give the page a name instead of losing it, and
      // warn so the pack stays findable rather than being silently patched.
      if (relPath === "data/JournalEntry.json") {
        for (const d of arr) {
          if (!Array.isArray(d?.pages)) continue
          d.pages.forEach((page, idx) => {
            if (!page || typeof page !== "object") return
            if (String(page.name ?? "").trim()) return
            page.name = game.i18n.format("BENEOS.Cloud.Bmap.Install.UntitledPage", { n: idx + 1 })
            console.warn(`BeneosNativeInstaller | journal page without a name, renamed to "${page.name}"`,
              { journal: d.name, journalId: d._id, pageId: page._id, pack: this.packageId })
          })
        }
      }
      // System-Bruecke fuer Nicht-dnd5e-Welten (siehe #swapActorsForForeignSystem).
      if (relPath === "data/Actor.json" && game.system.id !== "dnd5e") {
        arr = await this.#swapActorsForForeignSystem(arr)
      }
      if (arr.length === 0) continue
      // Punkt 8: reveal this phase with its real document count.
      this.progress.revealPhase?.(meta.phaseKey, { status: "active", current: 0, total: arr.length })
      for (let i = 0; i < arr.length; i++) arr[i] = rewriteDocAssetPaths(arr[i], this._packagedRemap, this._uploadRemap)

      // Beta: Beneos Stream. Second pass over the paths the line above just
      // produced, swapping the ones that stay at the edge for their gate
      // address. Deliberately after the fact and not inside remapAssetString:
      // that function returns early after its prefix swap, so a battlemap path
      // never reaches its exact-match table, and bending it would put a beta
      // concern into the middle of the live install path.
      // Beta: Beneos Stream. The scene rebuild, seit dem 2026-08-23 hier statt
      // im Paket. Das Video verlaesst das Dokument und seine Adresse zieht in
      // eine Markierung, weil ein Video in `texture.src` in der Ladeschranke
      // der Szene haengt und Foundry dort nirgends eine Frist kennt.
      //
      // Reihenfolge ist Absicht: NACH dem Pfadumschreiben, damit hier
      // Installationspfade stehen, und VOR dem Adressenpass darunter, der
      // Standbild und geparkte Videoadresse dann gemeinsam auf das Gate zieht.
      //
      // Nur im Streaming-Modus. Ein heruntergeladenes Video liegt auf der
      // eigenen Platte, laedt in Ortsgeschwindigkeit und gehoert ins Dokument,
      // wo jede andere Foundry-Funktion es sieht. Frueher stand hier deshalb
      // ein Rueckbau; der wird nicht mehr gebraucht, weil gar nichts mehr
      // umgebaut ankommt.
      //
      // `_streamTargets` wird mitgegeben, und zwar nicht als Beiwerk: seine
      // Schluessel sind genau die Dateien, die dieses Release mitbringt. Der
      // Umbau leitete den Namen des Standbilds bis zum 2026-08-24 aus dem Video
      // ab und schrieb ihn ungeprueft ins Dokument. 337 Videos im Bestand haben
      // keins, und fuer jedes davon forderte Foundry bei JEDEM Oeffnen der
      // Szene eine Datei an, die es nicht gibt, mit einer roten Zeile im
      // Konsolenlog des Kunden. Mit der Liste faellt das weg: was nicht
      // drinsteht, wird nicht angefordert.
      if (relPath === "data/Scene.json" && this._streamTargets?.size) {
        const rebuild = globalThis.BeneosStream?.rebuildScenesForStream
        if (rebuild) await rebuild(arr, new Set(this._streamTargets.keys()))
      }

      if (this._streamTargets?.size) {
        const apply = globalThis.BeneosStream?.applyStreamAddresses
        if (apply) for (let i = 0; i < arr.length; i++) arr[i] = apply(arr[i], this._streamTargets)
      }

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
      // Foundry does NOT throw on per-document validation failures inside
      // createDocuments: invalid docs are logged to the console, silently
      // dropped, and only the valid rest is created. Count against what
      // actually came back so rejected docs land in docFailures (and the
      // report) instead of being reported as created.
      const recordRejected = (requested, created) => {
        const okIds = new Set((created || []).map(x => String(x.id)))
        for (const d of requested) {
          if (!okIds.has(String(d?._id))) {
            this._result.docFailures.push({ type: meta.phaseKey, id: d?._id || "?", name: d?.name || "", error: "Rejected during document validation (see browser console)" })
          }
        }
      }
      try {
        const created = await docClass.createDocuments(toCreate, { keepId: true })
        this._result.totals.docsCreated += created.length
        recordRejected(toCreate, created)
        if (overwritten) this._result.totals.docsUpdated += overwritten
      } catch (err) {
        console.warn(`BeneosNativeInstaller | createDocuments failed for ${relPath}`, err)
        let ok = 0
        for (const d of toCreate) {
          try {
            const cr = await docClass.createDocuments([d], { keepId: true })
            if (cr.length) {
              ok += 1
              this._result.totals.docsCreated += 1
            } else {
              recordRejected([d], cr)
            }
          } catch (e2) {
            console.warn(`BeneosNativeInstaller | doc create skipped (${d?._id})`, e2?.message || e2)
            this._result.docFailures.push({ type: meta.phaseKey, id: d?._id || "?", name: d?.name || "", error: String(e2?.message || e2) })
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
      // HEAD-checks are cheap + read-only -> run them in parallel.
      await this.#runPool(assets, DOWNLOAD_CONCURRENCY, async (a) => {
        if (byTarget.has(a.target)) return
        if (!(await this.#headCheck(this.#installedPath(a)))) byTarget.set(a.target, a)
      })
    }
    const candidates = [...byTarget.values()]
    if (candidates.length === 0) return

    // Hardened fallback: re-fetch failed/missing assets ONE AT A TIME. A single
    // stream is gentler on a bad/saturated connection than the parallel first
    // pass, so flaky transfers are far more likely to complete on this retry
    // (slower, but robust).
    this.progress.handleStatusMessage(`Retrying ${candidates.length} asset(s) one at a time`)
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i]
      const res = await this.#transferOne(a)
      let ok = res.ok
      if (ok && !this._isForge) ok = await this.#headCheck(this.#installedPath(a)) // confirm on disk
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
   * rejects hosts which answer 200 with an HTML error page for missing files,
   * and rejects uninstall stubs.
   *
   * Foundry gives modules no way to delete a file, so the uninstaller frees
   * space by overwriting each asset with a 1-byte placeholder. Such a file
   * answers 200 and would otherwise pass as a healthy asset, which would let the
   * repair pass wave a broken file through on a later reinstall. Anything at or
   * below STUB_MAX_BYTES counts as missing; no real asset is that small.
   */
  async #headCheck(target) {
    try {
      const url = "/" + String(target).replace(/^\/+/, "") + "?_b=" + Date.now()
      const r = await fetch(url, { method: "HEAD" })
      if (!r.ok) return false
      if (/text\/html/i.test(r.headers.get("content-type") || "")) return false
      const len = Number(r.headers.get("content-length"))
      if (Number.isFinite(len) && len <= STUB_MAX_BYTES) return false
      return true
    } catch (_) {
      return false
    }
  }

  // ---- Reporting -----------------------------------------------------------

  async #showReport(result) {
    // Telemetrie: ein Summary-Event pro fehlgeschlagenem Install-Lauf, damit
    // Installationsfehler (permission/quota/notfound/...) im Analytics-
    // Dashboard sichtbar werden und nicht nur im Client-Report-Dialog.
    try { game.beneos?.analytics?.trackInstallError?.(result) } catch (_) { /* swallow */ }
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
