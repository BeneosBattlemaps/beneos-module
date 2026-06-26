/**
 * Beneos manual ZIP importer.
 *
 * Installs a local release ZIP (a shop download) 1:1 like a cloud install: it
 * reads the ZIP in-browser (fflate), then runs the SAME native installer with a
 * zip pack-source, so the unpack + storage (folders, asset namespace, document
 * import, progress window, overwrite dialog) are byte-identical to the cloud
 * path. When the pack also exists in the cloud catalog, the install is recorded
 * under the catalog's release id so it lights the same green installed-marker in
 * the search engine (shop purchases advertised there then read as installed).
 *
 * fflate decompresses lazily, one entry at a time, so even large 4K packs never
 * hold the whole decompressed tree in memory (only the compressed bytes + the
 * single entry currently being read).
 */

import { unzipSync, strFromU8 } from "../lib/fflate.module.js"
import { BeneosNativeBattlemapInstaller } from "./beneos-native-installer.mjs"

export class BeneosZipImporter {

  /** Pick a ZIP via a local file dialog, then install it. GM-only entry point. */
  static async pickAndImport() {
    if (!game.user?.isGM) {
      ui.notifications?.warn?.("Only a GM can import a battlemap ZIP.")
      return
    }
    const file = await BeneosZipImporter.#pickZipFile()
    if (!file) return
    return BeneosZipImporter.importFile(file)
  }

  /** Open a hidden <input type=file> and resolve with the chosen File (or null). */
  static #pickZipFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = ".zip,application/zip"
      input.style.display = "none"
      let done = false
      const finish = (f) => { if (done) return; done = true; try { input.remove() } catch (_) {} resolve(f) }
      input.addEventListener("change", () => finish(input.files?.[0] || null), { once: true })
      // If the dialog is cancelled there is no reliable event; resolve null on
      // the next focus so we never hang. (Best-effort, harmless if it also fires
      // after a real pick — finish() is idempotent.)
      window.addEventListener("focus", () => setTimeout(() => finish(null), 500), { once: true })
      document.body.appendChild(input)
      input.click()
    })
  }

  /** Install an already-selected File. */
  static async importFile(file) {
    if (!file) return

    // 1. Read the compressed bytes.
    let zipData
    try {
      zipData = new Uint8Array(await file.arrayBuffer())
    } catch (e) {
      ui.notifications?.error?.(`Could not read "${file.name}": ${e?.message || e}`)
      return
    }

    // 2. List entry names without decompressing (filter returns false => no inflate).
    const names = []
    try {
      unzipSync(zipData, { filter: (f) => { names.push(f.name); return false } })
    } catch (e) {
      ui.notifications?.error?.(`"${file.name}" is not a valid ZIP archive.`)
      return
    }
    if (!names.includes("data/Scene.json")) {
      ui.notifications?.error?.(`"${file.name}" is not a Beneos battlemap release (no data/Scene.json).`)
      return
    }

    // 3. Lazy entry map: relPath -> () => Uint8Array (inflate on demand, one at a time).
    const entries = new Map()
    for (const name of names) {
      entries.set(name, () => {
        const out = unzipSync(zipData, { filter: (f) => f.name === name })
        return out[name]
      })
    }

    // 4. Pack manifest (display name + counts) from the in-ZIP manifest JSON.
    const manifest = BeneosZipImporter.#readManifest(entries, names)
    const stem  = String(file.name).replace(/\.zip$/i, "")
    const label = (manifest?.name && String(manifest.name).trim()) || stem

    // 5. Resolve against the cloud catalog so a manual install lights the same
    //    green marker as a cloud install (when the pack is in the catalog).
    const resolved = await BeneosZipImporter.#resolveCatalog(stem)
    let coverUrl = null
    let record = { releaseDir: stem, variant: "", assetId: "", contentSignature: "", updatedDate: "" }
    if (resolved) {
      record = {
        releaseDir:       resolved.release_dir || stem,
        variant:          resolved.variant || "",
        assetId:          String(resolved.cloud_release_id || ""),
        contentSignature: String(resolved.content_signature || ""),
        updatedDate:      String(resolved.updated_date || ""),
      }
      coverUrl = resolved.cover_url || null
    }

    // 6. Run the native installer with the ZIP source. Existence-check, overwrite
    //    dialog, creature auto-install and the install record all reuse the cloud
    //    pipeline unchanged.
    try {
      await BeneosNativeBattlemapInstaller.install({
        packageId: stem,
        label,
        coverUrl,
        source: { kind: "zip", entries },
        record,
      })
    } catch (e) {
      console.warn("BeneosZipImporter | install failed", e)
      ui.notifications?.error?.(`ZIP install failed: ${e?.message || e}`)
    }
  }

  /**
   * Read the pack manifest: prefer mtte.json / beneos-pack-manifest.json, else
   * the first top-level *.json (the slug manifest, e.g. cos03deathhouse-054k.json
   * which carries { name, cover_image, counts }).
   */
  static #readManifest(entries, names) {
    const candidates = []
    if (names.includes("mtte.json")) candidates.push("mtte.json")
    if (names.includes("beneos-pack-manifest.json")) candidates.push("beneos-pack-manifest.json")
    for (const n of names) {
      if (!n.includes("/") && n.toLowerCase().endsWith(".json")) candidates.push(n)
    }
    for (const n of candidates) {
      try {
        const fac = entries.get(n)
        if (!fac) continue
        const obj = JSON.parse(strFromU8(fac()))
        if (obj && (obj.name || obj.counts)) return obj
      } catch (_) {}
    }
    return null
  }

  /**
   * Match the ZIP filename stem against list_releases `variant_dirs` to recover
   * the cloud release id + signature. Returns null when offline / not connected
   * / pack not in the catalog (install proceeds, just without a search marker).
   */
  static async #resolveCatalog(stem) {
    try {
      const mgr = window.BeneosScenePacker
      if (!mgr?.listReleases) return null
      const list = await mgr.listReleases({})
      if (!Array.isArray(list)) return null
      const lc = String(stem).toLowerCase()
      for (const r of list) {
        const vdirs = r?.variant_dirs || {}
        for (const [variant, dir] of Object.entries(vdirs)) {
          if (String(dir).toLowerCase() !== lc) continue
          const v = (variant === "SINGLE") ? "" : variant
          const cover = (v === "HD") ? (r.cover_url_hd || r.cover_url_4k) : (r.cover_url_4k || r.cover_url_hd)
          return {
            release_dir:       r.release_dir,
            cloud_release_id:  r.cloud_release_id,
            content_signature: r.content_signature,
            updated_date:      r.updated_date,
            variant:           v,
            cover_url:         cover || null,
          }
        }
      }
    } catch (e) {
      console.warn("BeneosZipImporter | catalog resolve failed", e)
    }
    return null
  }
}

globalThis.BeneosZipImporter = BeneosZipImporter
