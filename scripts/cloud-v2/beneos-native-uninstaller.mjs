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
import { releaseLoesen } from "../stream/stream-offline.mjs"

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
    // Gesetzt nur, wenn das Manifest ausblieb und der Installationsvermerk
    // einsprang. Null heisst: es gilt der gewoehnliche Weg ueber das Tor.
    this._docsAusVermerk = null
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
  static async confirm({ name = "", releaseDir = "", variant = "" } = {}) {
    const DialogV2 = foundry?.applications?.api?.DialogV2
    if (!DialogV2?.confirm) return false   // cannot ask -> never destroy anything
    const safeName = foundry.utils.escapeHTML(String(name || ""))
    const title = localize("BENEOS.Cloud.Uninstall.Title", "Remove this release from your world?")
    const intro = (localize("BENEOS.Cloud.Uninstall.Intro",
      "'%name%' and everything it installed will be deleted from this world.")
    ).replace("%name%", safeName)
    // A streamed release has almost nothing on disk to free, and promising the
    // space back would be a plain untruth on the button that deletes scenes.
    // Unknown installs keep the old sentence: they predate streaming, so their
    // files really are on disk.
    const warnFiles = this.#recordedMode(releaseDir, variant) === "stream"
      ? localize("BENEOS.Cloud.Uninstall.WarnFilesStream",
          "This release is streamed, so only a little disk space is freed.")
      : localize("BENEOS.Cloud.Uninstall.WarnFiles",
          "The downloaded files are emptied, so the disk space is freed.")
    const question = localize("BENEOS.Cloud.Uninstall.Question", "Continue?")

    try {
      const proceed = await DialogV2.confirm({
        window:  { title },
        // Scoping class only, no theme classes: this styles the Remove button
        // and nothing else, and cannot leak into other Foundry dialogs.
        classes: ["bc-uninstall-confirm"],
        content: `<p style="line-height:1.5">${intro}</p>`
               + `<p style="line-height:1.5">${warnFiles}</p>`
               + `<p style="line-height:1.5"><strong>${question}</strong></p>`,
        // The destructive choice carries a trash icon and danger colours. It
        // used to wear a checkmark and look exactly like Cancel next to it,
        // which is the wrong signal on the button that deletes scenes, actors
        // and journals. Cancel keeps the default focus.
        yes:     { label: localize("BENEOS.Cloud.Uninstall.Yes", "Remove"), default: false,
                   icon: "fa-solid fa-trash", class: "bc-danger-button" },
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

    // Wie wurde dieses Release installiert? Der Vermerk weiss es, der Schalter
    // von heute nicht. Siehe BeneosInstallState.recordInstall.
    const modus = BeneosNativeUninstaller.#recordedMode(this.releaseDir, this.variant)

    let target
    try {
      target = await BeneosNativeBattlemapInstaller.describePack({
        packageId: this.packageId, mode: modus,
      })
    } catch (err) {
      // DER VERMERK ALS ZWEITER WEG, SEIT DEM 30.08.2026.
      //
      // `describePack` holt das Manifest vom Tor. Ohne Verbindung gibt es das
      // nicht, und bis heute endete das Entfernen genau hier: mit einer
      // ehrlichen Meldung, aber ohne Ergebnis. Die Dateien liegen jedoch
      // lokal, und lokal wegzuraeumen braucht kein Tor.
      //
      // Eine Installation ab heute schreibt ihre Zielpfade in den Vermerk
      // mit. Sind sie da, wird daraus dieselbe Beschreibung gebaut, die
      // `describePack` geliefert haette. `jsons` bleibt leer: die
      // Dokumentsammlungen stehen laengst in der Welt und werden ueber die
      // Szenenkennungen des Vermerks entfernt, nicht ueber das Paket.
      //
      // Fuer aeltere Vermerke aendert sich nichts. `findTargets` gibt dann
      // null, und null ist NICHT dasselbe wie eine leere Liste: ein
      // gestreamtes Release hat legitim wenige lokale Dateien, und diese
      // Unterscheidung verhindert, dass ein unbekannter Vermerk als
      // "nichts zu raeumen" durchgeht.
      const gemerkt = BeneosInstallState.findTargets(this.releaseDir, this.variant)
      if (Array.isArray(gemerkt)) {
        // Die Dokumente kommen aus demselben Vermerk. Ohne sie gaebe dieser
        // Weg zwar die Dateien frei, liesse aber Szenen, Journale, Kreaturen
        // und Ordner in der Welt stehen, waehrend der Vermerk verschwindet:
        // eine halb entfernte Installation, die danach niemand mehr aufloesen
        // kann. Ein Vermerk aus der Zeit vor diesem Feld gibt null, und dann
        // wird das gesagt statt verschwiegen.
        this._docsAusVermerk = BeneosInstallState.findDocs(this.releaseDir, this.variant)
        if (!this._docsAusVermerk) {
          this.#fail("docsAusVermerk", new Error(
            "Der Installationsvermerk dieses Release stammt aus der Zeit vor der "
            + "Dokumentaufzeichnung. Ohne Verbindung lassen sich seine Szenen, Journale "
            + "und Ordner nicht bestimmen; sie bleiben stehen."))
        }
        console.warn("BeneosNativeUninstaller | describePack scheiterte, nehme den "
          + `Installationsvermerk: ${gemerkt.length} Zielpfade, `
          + `Dokumente ${this._docsAusVermerk ? "aus dem Vermerk" : "UNBEKANNT"}`, err)
        target = { assets: gemerkt.map(t => ({ target: t, url: "", relPath: t })), jsons: {}, packInfo: {} }
      } else {
        this.#fail("describePack", err)
        // Ein gestreamtes Release braucht das Manifest vom Tor, und ohne Netz
        // gibt es das nicht. Die Meldung sagt deshalb, was fehlt und was hilft,
        // statt nur festzustellen, dass nichts geschehen ist.
        ui_?.error?.(modus === "stream"
          ? localize("BENEOS.Cloud.Uninstall.ManifestFailedStream",
              "This release is streamed, so removing it needs a connection to Beneos. "
            + "Nothing was changed. Please try again when you are online.")
          : localize("BENEOS.Cloud.Uninstall.ManifestFailed",
              "Could not read the release manifest. Nothing was changed."))
        return this
      }
    }

    // Everything another installed release still needs stays untouched.
    const claimedByOthers = await this.#assetsClaimedByOtherInstalls()

    const docs = this._docsAusVermerk
      ? this.#docsAusVermerk(this._docsAusVermerk)
      : await this.#loadPackDocs(target.jsons)

    await this.#deleteDocuments(docs)
    await this.#removePlaylistTracks(docs.playlists)
    await this.#deleteFolders(docs.folders)
    await this.#clearAssetFiles(target.assets, claimedByOthers)

    // VOR `forget`, NICHT DANACH. Der Vermerk ist der einzige Weg zurueck zu
    // den Karten dieses Release: ist er weg, kennt `releaseOfflineStand()` das
    // Release nicht mehr, es verschwindet aus dem Offline-Reiter, und seine
    // Zusagen bleiben beim Tor gebucht, ohne dass der Kunde sie noch loesen
    // koennte. Das Kontingent verlaere bei jedem Entfernen still Platz.
    //
    // Ein Fehlschlag haelt das Entfernen nicht auf. Die Dokumente sind zu
    // diesem Zeitpunkt bereits weg; abzubrechen hinterliesse eine halb
    // entfernte Welt, um eine Buchung zu retten, die der naechste Weltstart
    // ohnehin abgleicht.
    try {
      const geloest = await releaseLoesen(this.releaseDir, this.variant)
      if (geloest.geloest > 0) {
        console.log(`BeneosNativeUninstaller | ${this.label}: ${geloest.geloest} Offline-Zusagen geloest, `
          + `${(geloest.bytes / 1048576).toFixed(1)} MB Kontingent frei, ${geloest.beimTor} beim Tor bestaetigt`)
      }
    } catch (err) { this.#fail("releaseLoesen", err) }

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
  /**
   * How a release was installed, from its own record.
   *
   * Returns "stream", "download", or "" for installs written before the field
   * existed. "" deliberately reaches describePack unchanged, where it means
   * "describe the whole release": the safe superset, because files that are
   * not on disk are skipped when clearing anyway.
   */
  static #recordedMode(releaseDir, variant) {
    try {
      const key = variant ? `${releaseDir}_${variant}` : releaseDir
      const entry = BeneosInstallState.getAll()?.[key]
      const m = String(entry?.mode || "")
      return m === "stream" || m === "download" ? m : ""
    } catch (_) { return "" }
  }

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
        // HIER STAND EIN NACKTES `continue`, UND ES MACHTE DEN RUECKFALL
        // WEITER UNTEN UNERREICHBAR.
        //
        // `#packageIdFor` ruft `listReleases()`, und das ist ein Netzaufruf.
        // Ohne Verbindung gibt er fuer JEDE fremde Installation null, der
        // Sprung setzte `_othersUnresolved`, und `#clearAssetFiles` liess das
        // Raeumen fuer den ganzen Lauf aus. Der Rueckfall auf den
        // Installationsvermerk, der genau fuer diesen Fall gebaut wurde, sass
        // im `catch` dahinter und lief nie.
        //
        // Der Vermerk beantwortet dieselbe Frage lokal und braucht kein
        // Verzeichnis. Erst wenn auch er nichts weiss, bleibt die Vorsicht
        // stehen: wer nicht weiss, was fremde Releases halten, darf nichts
        // loeschen.
        const gemerkt = BeneosInstallState.findTargets(entry.releaseDir, entry.variant)
        if (Array.isArray(gemerkt)) {
          for (const t of gemerkt) claimed.add(t)
        } else {
          this.#fail("resolveOtherRelease", new Error(`no pack dir for ${entry.releaseDir} (${entry.variant || "single"})`))
          this._othersUnresolved = true
        }
        continue
      }
      try {
        // Jedes fremde Release wird so beschrieben, wie es installiert wurde.
        // Mit dem Schalter von heute fielen bei eingeschaltetem Streaming die
        // heruntergeladenen Dateien der anderen Releases aus dieser Menge
        // heraus, obwohl sie auf der Platte liegen und gebraucht werden.
        const other = await BeneosNativeBattlemapInstaller.describePack({
          packageId: pkg, mode: String(entry.mode || ""),
        })
        for (const a of other.assets) claimed.add(a.target)
      } catch (err) {
        // OHNE DIESEN ZWEITEN RUECKFALL NUETZTE DER ERSTE NICHTS.
        //
        // Diese Schleife fragt, was die ANDEREN Installationen beanspruchen.
        // Scheitert auch nur eine davon, setzt `_othersUnresolved` das Raeumen
        // fuer den ganzen Lauf aus, und das zu Recht: wer nicht weiss, was
        // fremde Releases halten, darf nichts loeschen.
        //
        // Ohne Netz scheitert aber jede von ihnen, und das eigene Release
        // liesse sich dann zwar beschreiben, aber immer noch nicht raeumen.
        // Der Vermerk der fremden Installation beantwortet dieselbe Frage
        // lokal.
        const gemerkt = BeneosInstallState.findTargets(entry.releaseDir, entry.variant)
        if (Array.isArray(gemerkt)) {
          for (const t of gemerkt) claimed.add(t)
        } else {
          this.#fail("describeOtherPack", err)
          this._othersUnresolved = true
        }
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
  /**
   * Dieselbe Struktur wie `#loadPackDocs`, aber aus dem Installationsvermerk
   * und ohne einen einzigen Abruf.
   *
   * Der Deinstallierer liest von einem Dokument ohnehin nur seine Kennung, von
   * einer Playlist zusaetzlich die Kennungen ihrer Klaenge. Genau das steht im
   * Vermerk, und deshalb genuegen hier Attrappen mit `_id`.
   *
   * @param {{byPath: Object<string,string[]>, playlists: Array<{id:string,sounds:string[]}>}} vermerk
   */
  #docsAusVermerk(vermerk) {
    const alsDoc = (ids) => (Array.isArray(ids) ? ids : []).map(id => ({ _id: String(id) }))
    const out = { byKey: {}, folders: [], playlists: [] }
    for (const spec of DOC_PATHS) out.byKey[spec.key] = alsDoc(vermerk.byPath?.[spec.path])
    out.folders = alsDoc(vermerk.byPath?.["data/folders.json"])
    out.playlists = (vermerk.playlists || []).map(p => ({
      _id: String(p?.id || ""),
      sounds: alsDoc(p?.sounds),
    })).filter(p => p._id)
    return out
  }

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
