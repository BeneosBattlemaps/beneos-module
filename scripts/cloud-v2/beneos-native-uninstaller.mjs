/**
 * Beneos native release uninstaller — the exact counter-move to
 * BeneosNativeBattlemapInstaller.
 *
 * Removes one whole release from the ACTIVE world: its scenes, actors,
 * journals, items, macros, cards, rolltables, its folders, and its tracks
 * inside shared playlists. Then it frees the disk space the release occupies.
 *
 * Two constraints shape the whole design:
 *
 * 1. Foundry exposes NO file-delete API to modules. The `manageFiles` socket
 *    knows only browseFiles / createDirectory / configurePath, and FilePicker
 *    offers only browse / upload / createDirectory / configurePath. So "delete
 *    the downloaded files" is impossible in the literal sense. What we can do
 *    is overwrite each asset with a 1-byte placeholder, which returns the disk
 *    space (178 MB becomes a few dozen bytes) and leaves an empty file tree
 *    behind that only the host's own file manager can remove. The confirmation
 *    dialog says so plainly rather than pretending otherwise.
 *
 * 2. Asset folders are SHARED between releases. The Getting Started tour pulls
 *    maps out of releases 93, 68, 08, 10 and 002, and every release draws on
 *    the generic pools under map_assets/icons, map_assets/sfx and
 *    map_assets/ambiences. Stubbing a release's asset list blindly would gut
 *    the releases that stay installed. So every other installed release is
 *    described too, and only files that nobody else claims are touched.
 *
 * The authoritative list of what belongs to a release is the pack manifest
 * itself: the installer creates documents with `keepId: true`, so the `_id`s in
 * the pack JSONs are the very ids sitting in the world.
 */

import { BeneosInstallState } from "./beneos-install-state.mjs"
import { BeneosNativeBattlemapInstaller } from "./beneos-native-installer.mjs"

/** Document collections to remove, children before the folders that hold them. */
const DOC_PATHS = [
  { path: "data/Scene.json",        cls: () => globalThis.Scene,        key: "scenes" },
  { path: "data/Actor.json",        cls: () => globalThis.Actor,        key: "actors" },
  { path: "data/JournalEntry.json", cls: () => globalThis.JournalEntry, key: "journals" },
  { path: "data/Item.json",         cls: () => globalThis.Item,         key: "items" },
  { path: "data/Macro.json",        cls: () => globalThis.Macro,        key: "macros" },
  { path: "data/Cards.json",        cls: () => globalThis.Cards,        key: "cards" },
  { path: "data/RollTable.json",    cls: () => globalThis.RollTable,    key: "rolltables" },
]

const localize = (k, d) => {
  try { const s = game.i18n.localize(k); if (s && s !== k) return s } catch (_) {}
  return d
}

export class BeneosNativeUninstaller {
  /**
   * @param {object}  opts
   * @param {string}  opts.releaseDir  registry key of the release (e.g. "bm_tour_0001")
   * @param {string}  opts.variant     "4K" | "HD" | ""
   * @param {string}  opts.packageId   on-disk pack dir for this variant
   * @param {string}  opts.label       display name, for progress + report
   */
  constructor({ releaseDir, variant = "", packageId, label = "" } = {}) {
    this.releaseDir = releaseDir
    this.variant    = variant || ""
    this.packageId  = packageId
    this.label      = label || releaseDir
    this._fp        = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker
    this.result = {
      docsDeleted: 0, foldersDeleted: 0, tracksRemoved: 0, playlistsDeleted: 0,
      filesCleared: 0, bytesFreed: 0, filesSkippedShared: 0, errors: [],
    }
  }

  static async uninstall(opts = {}) {
    const inst = new BeneosNativeUninstaller(opts)
    await inst.run()
    return inst
  }

  /**
   * Confirmation gate. Two sentences: what disappears, and what it buys. The
   * earlier version also spelled out that placed tokens go with the scenes,
   * that foreign playlist tracks survive, and that Foundry cannot delete the
   * emptied files themselves. All true, all noise at the moment of decision:
   * "everything it installed is deleted" already covers the first two, and the
   * third is module internals a GM never needs to act on. Cancel is default.
   * @returns {Promise<boolean>} true => proceed
   */
  static async confirm({ name = "" } = {}) {
    const DialogV2 = foundry?.applications?.api?.DialogV2
    if (!DialogV2?.confirm) return false   // cannot ask -> never destroy anything
    const safeName = foundry.utils.escapeHTML(String(name || ""))
    const title = localize("BENEOS.Cloud.Uninstall.Title", "Remove this release from your world?")
    const intro = (localize("BENEOS.Cloud.Uninstall.Intro",
      "'%name%' and everything it installed will be deleted from this world.")
    ).replace("%name%", safeName)
    const warnFiles = localize("BENEOS.Cloud.Uninstall.WarnFiles",
      "The downloaded files are emptied, so the disk space is freed.")
    const question = localize("BENEOS.Cloud.Uninstall.Question", "Continue?")

    try {
      const proceed = await DialogV2.confirm({
        window:  { title },
        content: `<p style="line-height:1.5">${intro}</p>`
               + `<p style="line-height:1.5">${warnFiles}</p>`
               + `<p style="line-height:1.5"><strong>${question}</strong></p>`,
        yes:     { label: localize("BENEOS.Cloud.Uninstall.Yes", "Remove"), default: false },
        no:      { label: localize("BENEOS.Cloud.Uninstall.Cancel", "Cancel"), default: true },
        rejectClose: false,
      })
      return proceed === true
    } catch (_e) {
      return false
    }
  }

  #fail(step, err) {
    const msg = String(err?.message || err || "unknown")
    console.warn(`BeneosNativeUninstaller | ${step} failed`, err)
    this.result.errors.push({ step, error: msg })
  }

  async run() {
    const ui_ = ui.notifications
    ui_?.info?.(localize("BENEOS.Cloud.Uninstall.Started", "Removing release from this world..."))

    let target
    try {
      target = await BeneosNativeBattlemapInstaller.describePack({ packageId: this.packageId })
    } catch (err) {
      this.#fail("describePack", err)
      ui_?.error?.(localize("BENEOS.Cloud.Uninstall.ManifestFailed",
        "Could not read the release manifest. Nothing was changed."))
      return this
    }

    // Everything another installed release still needs stays untouched.
    const claimedByOthers = await this.#assetsClaimedByOtherInstalls()

    const docs = await this.#loadPackDocs(target.jsons)

    await this.#deleteDocuments(docs)
    await this.#removePlaylistTracks(docs.playlists)
    await this.#deleteFolders(docs.folders)
    await this.#clearAssetFiles(target.assets, claimedByOthers)

    try { await BeneosInstallState.forget({ releaseDir: this.releaseDir, variant: this.variant }) }
    catch (err) { this.#fail("forget", err) }

    // The POI index deliberately needs no maintenance here: it catalogues which
    // PACKAGE provides a scene for a journal, not what is installed in this
    // world, so removing an install cannot invalidate it.

    const r = this.result
    const mb = (r.bytesFreed / 1048576).toFixed(1)
    console.log(`BeneosNativeUninstaller | ${this.label}: ${r.docsDeleted} documents, ${r.foldersDeleted} folders, `
      + `${r.tracksRemoved} playlist tracks, ${r.filesCleared} files (~${mb} MB freed), `
      + `${r.filesSkippedShared} files kept for other releases, ${r.errors.length} errors`)

    if (r.errors.length) {
      ui_?.warn?.(game.i18n.format("BENEOS.Cloud.Uninstall.DoneWithErrors", { name: this.label, count: r.errors.length })
        || `${this.label} removed, but ${r.errors.length} step(s) reported problems (see console).`)
    } else {
      ui_?.info?.(game.i18n.format("BENEOS.Cloud.Uninstall.Done", { name: this.label, mb })
        || `${this.label} removed. About ${mb} MB of disk space freed.`)
    }
    return this
  }

  // ---- discovery -----------------------------------------------------------

  /**
   * Union of every asset target still claimed by ANOTHER installed release.
   * A release we cannot describe (offline, revoked entitlement, pack gone) is
   * treated as claiming everything it might own: we skip file clearing for this
   * run rather than risk gutting an install we could not inspect.
   */
  async #assetsClaimedByOtherInstalls() {
    const claimed = new Set()
    const myKey = this.variant ? `${this.releaseDir}_${this.variant}` : this.releaseDir
    let entries = {}
    try { entries = BeneosInstallState.getAll() } catch (err) { this.#fail("readInstallState", err) }

    for (const [key, entry] of Object.entries(entries)) {
      if (key === myKey) continue
      if (!entry || typeof entry !== "object" || !entry.releaseDir) continue
      const pkg = await this.#packageIdFor(entry.releaseDir, entry.variant)
      if (!pkg) {
        // Unknown pack dir: assume it owns what we are about to clear.
        this.#fail("resolveOtherRelease", new Error(`no pack dir for ${entry.releaseDir} (${entry.variant || "single"})`))
        this._othersUnresolved = true
        continue
      }
      try {
        const other = await BeneosNativeBattlemapInstaller.describePack({ packageId: pkg })
        for (const a of other.assets) claimed.add(a.target)
      } catch (err) {
        this.#fail("describeOtherPack", err)
        this._othersUnresolved = true
      }
    }
    return claimed
  }

  /** Resolve a release registry key + variant to the on-disk pack dir. */
  async #packageIdFor(releaseDir, variant) {
    try {
      const mgr = window.BeneosScenePacker
      if (!mgr?.listReleases) return null
      const releases = await mgr.listReleases()
      const row = releases.find(r => String(r.release_dir || r.filename) === String(releaseDir))
      if (!row) return null
      const dirs = row.variant_dirs || {}
      if (variant && dirs[variant]) return dirs[variant]
      return dirs["4K"] || dirs["HD"] || Object.values(dirs)[0] || null
    } catch (_) {
      return null
    }
  }

  /** Fetch and parse the pack's document collections. Missing ones are simply absent. */
  async #loadPackDocs(jsons) {
    const out = { byKey: {}, folders: [], playlists: [] }
    const read = async (relPath) => {
      const url = jsons[relPath]
      if (!url) return []
      try {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = JSON.parse(await resp.text())
        // The collections ship as arrays, but folders.json is an id-keyed
        // OBJECT. Both are normalised here; anything else is reported rather
        // than silently treated as "this release owns nothing", which would
        // quietly leave the documents behind.
        if (Array.isArray(data)) return data
        if (data && typeof data === "object") return Object.values(data)
        throw new Error(`unexpected shape: ${typeof data}`)
      } catch (err) {
        this.#fail(`read ${relPath}`, err)
        return []
      }
    }
    for (const spec of DOC_PATHS) out.byKey[spec.key] = await read(spec.path)
    out.folders   = await read("data/folders.json")
    out.playlists = await read("data/Playlist.json")
    return out
  }

  // ---- world teardown ------------------------------------------------------

  async #deleteDocuments(docs) {
    for (const spec of DOC_PATHS) {
      const arr = docs.byKey[spec.key] || []
      if (!arr.length) continue
      const cls = spec.cls()
      const collection = game.collections?.get?.(cls?.documentName)
      if (!cls || !collection) continue
      // Only ids that actually exist here: the user may have deleted some by
      // hand, and Foundry throws on unknown ids.
      const ids = arr.map(d => String(d?._id)).filter(id => id && collection.get(id))
      if (!ids.length) continue
      try {
        const gone = await cls.deleteDocuments(ids)
        this.result.docsDeleted += (gone?.length ?? ids.length)
      } catch (err) {
        this.#fail(`delete ${spec.key}`, err)
      }
    }
  }

  /**
   * Mirror image of the installer's merge: it ADDS the pack's PlaylistSounds to
   * whatever playlist already exists and never replaces one, so removal takes
   * out exactly those sound ids and leaves every foreign track alone. A playlist
   * that ends up with no tracks at all is deleted; one that still holds other
   * releases' ambiences is kept untouched.
   */
  async #removePlaylistTracks(packPlaylists) {
    for (const p of packPlaylists) {
      const id = String(p?._id || "")
      if (!id) continue
      const live = game.playlists?.get?.(id)
      if (!live) continue
      const packSoundIds = (Array.isArray(p.sounds) ? p.sounds : []).map(s => String(s?._id)).filter(Boolean)
      const present = packSoundIds.filter(sid => live.sounds.get(sid))
      if (present.length) {
        try {
          await live.deleteEmbeddedDocuments("PlaylistSound", present)
          this.result.tracksRemoved += present.length
        } catch (err) {
          this.#fail(`remove tracks from playlist ${live.name}`, err)
          continue
        }
      }
      if (live.sounds.size === 0) {
        try { await live.delete(); this.result.playlistsDeleted += 1 }
        catch (err) { this.#fail(`delete empty playlist ${live.name}`, err) }
      }
    }
  }

  /**
   * Folders are shared: a release sits inside a parent chain that other
   * releases use too. Only delete a folder that is genuinely empty after the
   * documents are gone — no child folders, no contents. Deepest first, so
   * emptying a leaf can let its parent go in the same pass.
   */
  async #deleteFolders(packFolders) {
    const ids = packFolders.map(f => String(f?._id)).filter(Boolean)
    if (!ids.length) return
    const depth = (folder) => { let d = 0, f = folder; while (f?.folder) { d++; f = f.folder } return d }
    const live = ids.map(id => game.folders?.get?.(id)).filter(Boolean)
    live.sort((a, b) => depth(b) - depth(a))
    for (const folder of live) {
      try {
        const hasChildren = (folder.children?.length || 0) > 0
        const hasContents = (folder.contents?.length || 0) > 0
        if (hasChildren || hasContents) continue   // still in use by something else
        await folder.delete()
        this.result.foldersDeleted += 1
      } catch (err) {
        this.#fail(`delete folder ${folder?.name || folder?.id}`, err)
      }
    }
  }

  // ---- disk space ----------------------------------------------------------

  /**
   * Free the disk space. See the file header for why this overwrites instead of
   * deleting. Files another installed release still needs are skipped, and if
   * any other install could not be described we skip file clearing entirely
   * rather than gamble with someone else's content.
   */
  async #clearAssetFiles(assets, claimedByOthers) {
    if (this._othersUnresolved) {
      ui.notifications?.warn?.(localize("BENEOS.Cloud.Uninstall.SharedUnknown",
        "Could not check every other installed release, so the downloaded files were left alone. World documents were removed."))
      return
    }
    const targets = [...new Set(assets.map(a => a.target).filter(Boolean))]
    for (const target of targets) {
      if (claimedByOthers.has(target)) { this.result.filesSkippedShared += 1; continue }
      const size = await this.#sizeOf(target)
      if (size === null) continue          // already gone or unreachable
      if (size <= 8) continue              // already a stub
      const dir  = target.includes("/") ? target.substring(0, target.lastIndexOf("/")) : ""
      const name = target.substring(target.lastIndexOf("/") + 1)
      try {
        const stub = new File([new Uint8Array([0])], name, { type: "application/octet-stream" })
        const res = await this._fp.upload("data", dir, stub, {}, { notify: false })
        if (res?.path) { this.result.filesCleared += 1; this.result.bytesFreed += size }
        else this.#fail(`clear ${target}`, new Error("upload returned no path"))
      } catch (err) {
        this.#fail(`clear ${target}`, err)
      }
    }
  }

  /** Current size on disk, or null when the file is not there. */
  async #sizeOf(target) {
    try {
      const r = await fetch("/" + String(target).replace(/^\/+/, "") + "?_b=" + Date.now(), { method: "HEAD" })
      if (!r.ok) return null
      if (/text\/html/i.test(r.headers.get("content-type") || "")) return null
      const n = Number(r.headers.get("content-length"))
      return Number.isFinite(n) ? n : null
    } catch (_) {
      return null
    }
  }

}

globalThis.BeneosNativeUninstaller = BeneosNativeUninstaller
