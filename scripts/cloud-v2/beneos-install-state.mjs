/**
 * Plan §33.6 — world-scoped install-state for battlemap releases.
 *
 * The Foundry-module records every cloud-installed release in the world
 * setting "battlemap-installs". The cloud window reads it to surface the
 * green installed-badge and the gold update-available badge, and the
 * pre-install dialog uses it to detect re-install + variant-switch attempts.
 *
 * No auto-scan: a world that imported a release before this feature shipped
 * starts blank. Re-installing through the module fills the record. Plan §33.10
 * pins this as the V1 decision (auto-scan via scene.background.src is V2).
 */

import { BeneosUtility } from "../beneos_utility.js"

const SETTING_KEY = "battlemap-installs"

/**
 * Der Kern eines Release-Schluessels: alles bis einschliesslich seiner Nummer.
 *
 * WARUM ES DEN KERN BRAUCHT
 *
 * Der Vermerk traegt zwei Schreibweisen desselben Release. Aeltere Eintraege
 * stehen kurz als `bm_0006`, neuere lang als
 * `beneos_bm_0111_giant_turtle_island`. Der Katalog kennt nur die Langform.
 * Gemessen am 2026-08-30 in der V14-Pruefwelt: sechs von sechzehn Vermerken
 * fanden sich im Offline-Reiter nicht wieder, obwohl ihre Szenen in der Welt
 * lagen. Fuer den Kunden sieht das aus, als sei ein Release verschwunden.
 *
 * DIE NUMMER ALLEIN REICHT NICHT. `bm_extras_0002` und ein gedachtes `bm_0002`
 * traegen dieselbe Zahl und sind verschiedene Releases; ebenso trennt nur der
 * angehaengte Buchstabe die Varianten `0057`, `0057b` und `0057c`. Deshalb
 * bleibt alles vor der Nummer stehen und der Buchstabe dahinter gehoert dazu.
 *
 * `beneos_` faellt weg, weil genau dieses Wort die beiden Schreibweisen
 * unterscheidet.
 *
 * @param {string} releaseDir
 * @returns {string} etwa "bm_0111", "bm_extras_0002", oder "" ohne Nummer
 */
export function releaseKern(releaseDir) {
  const teile = String(releaseDir || "").toLowerCase().split("_").filter(Boolean)
  if (teile[0] === "beneos") teile.shift()
  const bis = teile.findIndex(t => /^\d+[a-z]?$/.test(t))
  if (bis < 0) return ""
  return teile.slice(0, bis + 1).join("_")
}

/**
 * Ein lesbarer Name aus dem Verzeichnisnamen, fuer Vermerke ohne eigenen.
 *
 * Nur ein Rueckfall. Der echte Name steht seit dieser Fassung im Vermerk; hier
 * geht es um die Eintraege, die vorher entstanden sind. Sie sonst mit
 * `beneos_bm_0113_arasek_stockyard` zu beschriften waere zwar ehrlich, aber
 * fuer den Kunden unbrauchbar.
 *
 * `beneos_bm_0113_arasek_stockyard` gibt "Arasek Stockyard (0113)".
 * `bm_0006` gibt "Release 0006", weil dort schlicht kein Titel steht.
 *
 * @param {string} releaseDir
 */
export function anzeigename(releaseDir) {
  const teile = String(releaseDir || "").split("_").filter(Boolean)
  if (teile[0]?.toLowerCase() === "beneos") teile.shift()
  const i = teile.findIndex(t => /^\d+[a-z]?$/.test(t))
  if (i < 0) return String(releaseDir || "")
  const nummer = teile[i]
  const rest = teile.slice(i + 1).filter(t => t.toLowerCase() !== "foundry")
  if (!rest.length) return `Release ${nummer}`
  const titel = rest.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(" ")
  return `${titel} (${nummer})`
}

/**
 * Static accessor — Foundry's settings storage is the source of truth; we
 * never cache to avoid stale reads across re-renders.
 */
export class BeneosInstallState {
  static getAll() {
    try {
      const v = game.settings.get(BeneosUtility.moduleID(), SETTING_KEY)
      return (v && typeof v === "object") ? v : {}
    } catch (_e) {
      return {}
    }
  }

  /**
   * Find any installed variants of a release. Returns an array because
   * V2 may legitimately have both 4K and HD installed in the same world
   * (the dialog warns against it but doesn't enforce); V1 we tolerate
   * the corner case so the badge logic stays honest.
   */
  static findByReleaseDir(releaseDir) {
    if (!releaseDir) return []
    const all = this.getAll()
    const out = []
    for (const [key, entry] of Object.entries(all)) {
      if (!entry || typeof entry !== "object") continue
      if (entry.releaseDir === releaseDir) out.push(entry)
    }
    if (out.length) return out

    // ERST WENN DIE GENAUE SCHREIBWEISE NICHTS FINDET, WIRD ueBER DIE NUMMER
    // GESUCHT, UND NIE DANEBEN.
    //
    // Der Vermerk traegt zwei Schreibweisen desselben Release, der Katalog nur
    // eine. Ein Eintrag aus der Kurzform faende sich sonst nie wieder, obwohl
    // seine Szenen in der Welt liegen; im Offline-Reiter fehlten dadurch sechs
    // von sechzehn Releases. Siehe `releaseKern` oben.
    //
    // Die Reihenfolge ist die Aussage: passt die Schreibweise, gilt sie. Der
    // Kern ist der Rueckfall, nicht die Regel, damit eine genaue Uebereinstimmung
    // nie von einer ungenauen verdraengt wird.
    const kern = releaseKern(releaseDir)
    if (!kern) return out
    for (const [, entry] of Object.entries(all)) {
      if (!entry || typeof entry !== "object" || !entry.releaseDir) continue
      if (releaseKern(entry.releaseDir) === kern) out.push(entry)
    }
    return out
  }

  /**
   * Resolve a Foundry scene id back to the asset it was installed from.
   *
   * WHY THIS EXISTS
   *
   * Analytics ships `battlemap_key` with every scene event, and that key is a
   * fragment cut out of the background path. Its meaning changed with the
   * client: up to 14.3.0 it was the file name, from 14.4.0 the folder name.
   * Old clients therefore send values like `4k_bm.webm`, which are identical
   * across releases and cannot be resolved. Measured in the Data Lake on
   * 2026-08-19: only 54 percent of scene activations carry a key that maps to
   * a release at all.
   *
   * The mapping was here the whole time. recordInstall already stores the
   * assetId next to the scene ids it created; nothing new has to be captured,
   * only read back.
   *
   * NO CACHE, ON PURPOSE. This class states at the top that settings storage
   * is the source of truth and that we never cache to avoid stale reads. A
   * scene switch happens a few times per session, and the scan walks a handful
   * of releases with a few dozen ids each. Caching would trade a cost nobody
   * can measure for a class of bug that is hard to see: a world that installs
   * a release mid-session would keep reporting the old mapping.
   *
   * Returns "" when the scene is unknown, which is the normal case for worlds
   * that imported a release before this feature shipped, and for battlemaps
   * copied in by hand. Callers must treat "" as "not known", never as "not a
   * Beneos scene".
   */
  static findAssetIdByScene(sceneId) {
    if (!sceneId) return ""
    const all = this.getAll()
    for (const entry of Object.values(all)) {
      if (!entry || typeof entry !== "object") continue
      if (!Array.isArray(entry.sceneIds)) continue
      if (entry.sceneIds.includes(sceneId)) return String(entry.assetId || "")
    }
    return ""
  }

  /**
   * The release a scene was installed from, in catalogue spelling, or "".
   *
   * WHY THIS EXISTS NEXT TO findAssetIdByScene
   *
   * The asset id is a cloud hash like `6a3a4c16ea600`. It is exact, but it
   * says nothing to anyone reading a report, and it does not join against the
   * catalogue, which is keyed on `bm_0113_arasek_stockyard`. Telemetry needs
   * the readable one.
   *
   * THE VARIANT IS THE RESOLUTION, NOT THE PRODUCT. DO NOT APPEND IT.
   *
   * This was written the other way round first, on the assumption that
   * `variant` might carry the product letter of `bm_0057b` vs `bm_0057c`.
   * Measured in a live world on 2026-08-24 across all eleven install records:
   * `variant` is "HD" or "4K" every single time. The product letter lives in
   * `releaseDir` itself (`bm_0078b`). Appending the variant would have turned
   * `bm_0078b` into `bm_0078b_4K`, which matches nothing in the catalogue.
   *
   * THE `beneos_` PREFIX IS OPTIONAL AND MUST GO
   *
   * The same world holds both spellings side by side, depending on how old
   * the install is: `bm_0112` and `beneos_bm_0048_dourcrag_castle_day`. The
   * catalogue keys on `bm_0048_dourcrag_castle_day`, so the prefix is
   * stripped. What remains matches the catalogue either exactly or as a
   * prefix (`bm_0112` -> `bm_0112_dia_mirror_of_mephistar`), and the special
   * namespaces `bm_tour_`, `bm_single_map_` and `bm_extras_` survive that
   * unharmed because nothing about them is rewritten.
   *
   * Returns "" for worlds that installed before the install-state existed and
   * for hand-copied battlemaps. Callers must treat "" as "not known", never
   * as "not a Beneos scene". There is deliberately no fallback: see
   * `_beneosBattlemapDir` in beneos_analytics.js for why the path cannot
   * stand in for this.
   */
  static findReleaseDirByScene(sceneId) {
    if (!sceneId) return ""
    const all = this.getAll()
    for (const entry of Object.values(all)) {
      if (!entry || typeof entry !== "object") continue
      if (!Array.isArray(entry.sceneIds)) continue
      if (!entry.sceneIds.includes(sceneId)) continue
      const dir = String(entry.releaseDir || "").replace(/^beneos_/, "")
      return dir
    }
    return ""
  }

  /**
   * Die Karte, zu der eine Szene gehoert, aus dem Vermerk statt vom Tor.
   *
   * WARUM DAS HIER STEHT UND NICHT IM MANIFEST
   *
   * `stream-offline.mjs` fragt fuer jeden Rechtsklick das Tor nach dem
   * Manifest, um von der Szene zur Karte zu kommen. Ohne Verbindung scheitert
   * das, und damit fehlt der Menueeintrag genau dann, wenn ein Spielleiter ihn
   * am ehesten sucht: beim Vorbereiten ohne Netz.
   *
   * Die Angabe stand beim Installieren ohnehin zur Verfuegung. Sie wird jetzt
   * mitgeschrieben, in einer bewusst schmalen Form: Kennung, Name, Groesse und
   * die Szenen, aus denen die Karte besteht. **Keine Dateipfade.** Die braucht
   * erst das Holen, und wer holt, ist ohnehin online. Gemessen ueber vier
   * Releases: die Pfade machen drei Viertel der Groesse aus, und der Vermerk
   * liegt in einer Welt-Einstellung, die bei jedem Start mitgelesen wird.
   *
   * Gibt `null` zurueck, wenn die Szene unbekannt ist ODER der Vermerk aus der
   * Zeit vor diesem Feld stammt. Beides heisst fuer den Aufrufer dasselbe:
   * frag das Tor. Ein leeres Ergebnis waere die falsche Antwort, weil es wie
   * "gehoert zu keiner Karte" aussaehe.
   */
  static findKarteByScene(sceneId) {
    if (!sceneId) return null
    const all = this.getAll()
    for (const [key, entry] of Object.entries(all)) {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.karten)) continue
      for (const k of entry.karten) {
        if (!k || !Array.isArray(k.scenes) || !k.scenes.includes(sceneId)) continue
        return {
          release: String(entry.releaseDir || ""),
          variant: String(entry.variant || "").toLowerCase(),
          karte:   String(k.id || ""),
          name:    String(k.name || k.id || ""),
          bytes:   Number(k.bytes) || 0,
          scenes:  k.scenes.slice(0),
        }
      }
    }
    return null
  }

  /**
   * Die lokalen Zielpfade eines Release, wie beim Installieren aufgezeichnet.
   *
   * Der Deinstallierer beschreibt ein Release sonst ueber `describePack`, und
   * das holt das Manifest vom Tor. Ohne Verbindung bricht das Entfernen
   * deshalb ab, obwohl die Dateien lokal liegen und lokal wegkoennen.
   *
   * Gibt `null` fuer Vermerke aus der Zeit vor diesem Feld. Der Aufrufer muss
   * das von einer leeren Liste unterscheiden: ein gestreamtes Release hat
   * legitim wenige oder gar keine schweren lokalen Dateien, und diese Null
   * bedeutet nicht "nichts zu tun", sondern "ich weiss es nicht".
   */
  static findTargets(releaseDir, variant) {
    if (!releaseDir) return null
    const key = variant ? `${releaseDir}_${variant}` : releaseDir
    const entry = this.getAll()?.[key]
    if (!entry || !Array.isArray(entry.targets)) return null
    return entry.targets.slice(0)
  }

  /**
   * Die Dokumente eines Release, wie beim Installieren aufgezeichnet.
   *
   * Gegenstueck zu `findTargets`, fuer denselben Zweck und mit derselben
   * Regel: `null` heisst "ich weiss es nicht", nicht "es gibt keine". Ein
   * Vermerk aus der Zeit vor diesem Feld gibt null, und der Aufrufer muss dann
   * sagen, dass er die Dokumente nicht raeumen konnte, statt es zu verschweigen.
   *
   * @returns {{byPath: Object<string,string[]>, playlists: Array<{id:string,sounds:string[]}>}|null}
   */
  static findDocs(releaseDir, variant) {
    if (!releaseDir) return null
    const key = variant ? `${releaseDir}_${variant}` : releaseDir
    const d = this.getAll()?.[key]?.docs
    if (!d || typeof d !== "object") return null
    return {
      byPath: (d.byPath && typeof d.byPath === "object") ? d.byPath : {},
      playlists: Array.isArray(d.playlists) ? d.playlists : [],
    }
  }

  /**
   * Persist one install. Key format: `<releaseDir>_<variant>` (variant = ""
   * for single-variant releases). Idempotent: replacing the same key
   * overwrites scene-ids + timestamp + signature for the new install.
   *
   * `mode` RECORDS HOW THIS RELEASE WAS INSTALLED, AND IT MATTERS AT REMOVAL.
   *
   * Until 2026-08-28 this record held no mode, and the uninstaller therefore
   * had to ask today's stream switch what a release installed weeks ago looks
   * like on disk. That is a different question, and it gave the wrong answer
   * in both directions: with streaming on, a downloaded release kept all its
   * heavy files while the dialog promised the space back; with streaming off,
   * a streamed release was described with a full path list that mostly does
   * not exist.
   *
   * Three values, and the third is not a defect:
   *   "download"  every file of the release lies on disk
   *   "stream"    the heavy files stay at Beneos, only light ones are local
   *   ""          unknown, written before this field existed. Callers MUST
   *               treat it as "describe the full release", never as
   *               "download", because the full list is the safe superset:
   *               files that are not there are skipped anyway.
   */
  static async recordInstall({ releaseDir, variant, assetId, sceneIds, sourceSignature, sceneCount, mode,
                               karten, targets, displayName, docs }) {
    if (!releaseDir) return
    const all = this.getAll()
    const key = variant ? `${releaseDir}_${variant}` : releaseDir
    all[key] = {
      releaseDir,
      variant:         variant || "",
      assetId:         String(assetId || ""),
      sceneIds:        Array.isArray(sceneIds) ? sceneIds.slice(0) : [],
      sceneCount:      Number(sceneCount || (Array.isArray(sceneIds) ? sceneIds.length : 0)),
      installedAt:     new Date().toISOString(),
      sourceSignature: String(sourceSignature || ""),
      mode:            mode === "stream" || mode === "download" ? mode : "",
    }
    // Die Leser unterscheiden "kenne ich nicht" von "ist leer", und nur das
    // Erste darf ins Netz ausweichen. Genau deshalb entscheidet bei `targets`
    // die ANWESENHEIT der Liste und nicht ihre Laenge.
    //
    // BIS ZUM 31.08.2026 STAND HIER `&& targets.length`, UND DAS MACHTE JEDES
    // VOLLSTAENDIG GESTREAMTE RELEASE OHNE NETZ UNENTFERNBAR.
    //
    // Ein gestreamtes Release legt fast nichts auf der Platte ab, und im
    // Grenzfall gar nichts. Die leere Liste wurde dann nicht geschrieben,
    // `findTargets` gab null, und der Deinstallierer las das als "ich weiss
    // nicht, was hier liegt" und brach mit "removing it needs a connection"
    // ab. Gemessen an `beneos_bm_single_map_0003_green_temple_boss_arena`:
    // frisch installiert, gesperrter Torhost, Entfernen abgebrochen, obwohl
    // der Vermerk alles wusste.
    //
    // Eine leere Liste ist hier eine AUSSAGE: dieses Release hat keine eigenen
    // Dateien auf der Platte. Sie gehoert aufgeschrieben.
    if (Array.isArray(karten) && karten.length) all[key].karten = karten
    if (Array.isArray(targets)) all[key].targets = targets.slice(0)
    // DER NAME GEHOERT IN DEN VERMERK, WEIL DER KATALOG OHNE NETZ NICHT KOMMT.
    //
    // Der Offline-Reiter baut seine Kacheln aus diesem Vermerk, sobald
    // `list_releases` scheitert. Alles Noetige stand schon hier, nur der Name
    // nicht, und ein Verzeichnisname ist kein Kachelname. Aeltere Vermerke
    // leiten ihn ueber `anzeigename()` aus `releaseDir` ab; das ist schlechter
    // als der echte, aber besser als eine Kachel ohne Beschriftung.
    if (displayName) all[key].displayName = String(displayName)
    // Die Dokumentkennungen des Pakets. Ohne sie kann das Entfernen ohne Netz
    // Dateien freigeben, aber keine Szene, kein Journal und keinen Ordner aus
    // der Welt nehmen; genau das waere die halb entfernte Installation.
    if (docs && typeof docs === "object") all[key].docs = docs
    try {
      await game.settings.set(BeneosUtility.moduleID(), SETTING_KEY, all)
    } catch (e) {
      console.warn("BeneosInstallState | recordInstall failed", e)
    }
  }

  /**
   * Drop an install record. Used when the dialog confirms a variant-switch
   * and we replace the old entry. Idempotent: missing key is a no-op.
   */
  static async forget({ releaseDir, variant }) {
    if (!releaseDir) return
    const all = this.getAll()
    const key = variant ? `${releaseDir}_${variant}` : releaseDir
    if (!(key in all)) return
    delete all[key]
    try {
      await game.settings.set(BeneosUtility.moduleID(), SETTING_KEY, all)
    } catch (e) {
      console.warn("BeneosInstallState | forget failed", e)
    }
  }
}

/**
 * Plan §33.6 — pre-install confirmation dialog.
 *
 * Three states:
 *   - new install: no dialog, install proceeds immediately.
 *   - same release + same variant: "already installed, overwriting".
 *   - same release + different variant: "switching from 4K to HD" etc.
 *
 * Returns a Promise<boolean>: true when the user confirms, false otherwise.
 * Caller aborts the install on false.
 */
export class BeneosPreInstallDialog {
  static async confirm({ existingInstalls, releaseDir, newVariant, releaseDisplayName }) {
    if (!Array.isArray(existingInstalls) || !existingInstalls.length) return true

    const DialogV2 = foundry?.applications?.api?.DialogV2
    if (!DialogV2?.confirm) {
      // Foundry too old for DialogV2.confirm — fall through, do not block.
      return true
    }

    const sameVariant = existingInstalls.find(e => (e.variant || "") === (newVariant || ""))
    const otherVariant = existingInstalls.find(e => (e.variant || "") !== (newVariant || ""))
    const name = releaseDisplayName || releaseDir

    let title, body, yesLabel
    if (sameVariant) {
      title = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.ReinstallTitle") || "Release already installed"
      const fmt = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.ReinstallBody")
        || "'%name%' (%variant%) is already installed (%count% scenes since %date%). A reinstall overwrites any manual edits on those scenes. Continue?"
      body = fmt
        .replace("%name%",    foundry.utils.escapeHTML(name))
        .replace("%variant%", foundry.utils.escapeHTML(sameVariant.variant || "single-variant"))
        .replace("%count%",   String(sameVariant.sceneCount || sameVariant.sceneIds?.length || 0))
        .replace("%date%",    this.#formatDate(sameVariant.installedAt))
      yesLabel = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.ReinstallYes") || "Reinstall"
    } else if (otherVariant) {
      title = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.SwitchTitle") || "Variant switch"
      const fmt = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.SwitchBody")
        || "'%name%' is installed as %old% (%count% scenes since %date%). You are about to install %new%. The quality changes from %old% to %new%, and the existing scenes will be overwritten. Continue?"
      body = fmt
        .replace(/%name%/g,  foundry.utils.escapeHTML(name))
        .replace(/%old%/g,   foundry.utils.escapeHTML(otherVariant.variant || "the other variant"))
        .replace(/%new%/g,   foundry.utils.escapeHTML(newVariant || "single-variant"))
        .replace("%count%",  String(otherVariant.sceneCount || otherVariant.sceneIds?.length || 0))
        .replace("%date%",   this.#formatDate(otherVariant.installedAt))
      yesLabel = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.SwitchYes") || "Switch variant"
    } else {
      return true
    }

    try {
      const proceed = await DialogV2.confirm({
        window:  { title },
        content: `<p style="line-height:1.5">${body}</p>`,
        yes:     { label: yesLabel, default: false },
        no:      { label: game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.Cancel") || "Cancel", default: true },
        rejectClose: false
      })
      return proceed === true
    } catch (_e) {
      return false
    }
  }

  /**
   * Teil 2 — world-presence overwrite confirmation. Driven by the ACTUAL
   * scenes in the world (not just the install registry), so it also fires for
   * worlds that imported a release before the registry existed. Returns
   * Promise<boolean>: true => proceed in overwrite mode, false => abort.
   */
  static async confirmWorldOverwrite({ scope, name, presentCount = 0, totalCount = 0, installedAt = "", stale = false }) {
    const DialogV2 = foundry?.applications?.api?.DialogV2
    if (!DialogV2?.confirm) return true   // too old to ask -> never block an install

    const L = (key, fallback) => {
      try { const s = game.i18n.localize(key); if (s && s !== key) return s } catch (_) {}
      return fallback
    }
    const safeName  = foundry.utils.escapeHTML(String(name || ""))
    const dateStr   = this.#formatDate(installedAt)
    const isRelease = scope === "release"

    const title = stale
      ? L("BENEOS.Cloud.Bmap.Overwrite.TitleUpdate", "Update available")
      : L("BENEOS.Cloud.Bmap.Overwrite.Title", "Already in your world")
    const subject = isRelease
      ? L("BENEOS.Cloud.Bmap.Overwrite.SubjectRelease", "This release")
      : L("BENEOS.Cloud.Bmap.Overwrite.SubjectScene", "This scene")
    const intro = stale
      ? L("BENEOS.Cloud.Bmap.Overwrite.IntroUpdate",
          "%subject% of '%name%' is already in your world (installed %date%), and a newer version is online.")
      : L("BENEOS.Cloud.Bmap.Overwrite.Intro",
          "%subject% of '%name%' is already in your world (installed %date%).")
    const warn = L("BENEOS.Cloud.Bmap.Overwrite.Warn",
      "Reinstalling rebuilds the scenes from the pack — any placed tokens or manual edits on them are lost. Continue?")

    const body = (intro + " " + warn)
      .replace("%subject%", foundry.utils.escapeHTML(subject))
      .replace("%name%",    safeName)
      .replace("%date%",    foundry.utils.escapeHTML(dateStr))

    const yesLabel = stale
      ? L("BENEOS.Cloud.Bmap.Overwrite.YesUpdate", "Update")
      : L("BENEOS.Cloud.Bmap.Overwrite.Yes", "Overwrite")
    const noLabel = L("BENEOS.Cloud.Bmap.Overwrite.Cancel", "Cancel")

    try {
      const proceed = await DialogV2.confirm({
        window:  { title },
        content: `<p style="line-height:1.5">${body}</p>`,
        yes:     { label: yesLabel, default: false },
        no:      { label: noLabel, default: true },
        rejectClose: false,
      })
      return proceed === true
    } catch (_e) {
      return false
    }
  }

  /**
   * Bundle "install entire bundle" per-release prompt. A release already in the
   * world raises this 3-way choice so a single one never aborts the whole run:
   *   overwrite -> reinstall it; skip -> leave it, continue with the next;
   *   stop -> stop the bundle run here. The "apply to all remaining" checkbox
   * lets the caller remember the choice for the rest of the run.
   * Returns Promise<{ choice:"overwrite"|"skip"|"stop", applyAll:boolean }>.
   */
  static async confirmBundleMemberOverwrite({ name } = {}) {
    const DialogV2 = foundry?.applications?.api?.DialogV2
    const L = (key, fallback) => {
      try { const s = game.i18n.localize(key); if (s && s !== key) return s } catch (_) {}
      return fallback
    }
    // Too old to ask -> default to skip (never destroys an existing install).
    if (!DialogV2?.wait) return { choice: "skip", applyAll: false }

    const safeName = foundry.utils.escapeHTML(String(name || ""))
    const title = L("BENEOS.Cloud.Bmap.MemberOverwrite.Title", "Already in your world")
    const body  = L("BENEOS.Cloud.Bmap.MemberOverwrite.Body",
      "'%name%' is already in your world. Overwrite it, skip it, or stop the bundle?")
      .replace("%name%", safeName)
    const applyAllLabel = L("BENEOS.Cloud.Bmap.MemberOverwrite.ApplyAll",
      "Apply to all remaining already-installed releases")
    const content =
      `<p style="line-height:1.5">${body}</p>` +
      `<label style="display:flex;gap:.4rem;align-items:center;margin-top:.5rem">` +
      `<input type="checkbox" name="applyAll"> ${foundry.utils.escapeHTML(applyAllLabel)}</label>`

    // The third callback arg is the dialog instance in some Foundry builds and the
    // rendered HTMLElement in others; the clicked button shares the dialog's form.
    // Try all three so the checkbox read works regardless of the build.
    const readApplyAll = (button, dialog) => {
      try {
        const fromBtn = button?.form?.elements?.applyAll
        if (fromBtn) return !!fromBtn.checked
        const root = dialog?.element ?? dialog
        return !!root?.querySelector?.('input[name="applyAll"]')?.checked
      } catch (_) { return false }
    }
    try {
      const r = await DialogV2.wait({
        window: { title },
        content,
        buttons: [
          { action: "overwrite", label: L("BENEOS.Cloud.Bmap.MemberOverwrite.Overwrite", "Overwrite"),
            callback: (_e, b, dialog) => ({ choice: "overwrite", applyAll: readApplyAll(b, dialog) }) },
          { action: "skip", label: L("BENEOS.Cloud.Bmap.MemberOverwrite.Skip", "Skip"), default: true,
            callback: (_e, b, dialog) => ({ choice: "skip", applyAll: readApplyAll(b, dialog) }) },
          { action: "stop", label: L("BENEOS.Cloud.Bmap.MemberOverwrite.Stop", "Stop bundle"),
            callback: () => ({ choice: "stop", applyAll: false }) },
        ],
        rejectClose: false,
      })
      return r || { choice: "stop", applyAll: false }
    } catch (_e) {
      return { choice: "stop", applyAll: false }
    }
  }

  static #formatDate(iso) {
    if (!iso) return "unknown"
    try {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return "unknown"
      // Force US English (most patrons are US), e.g. "June 25, 2026".
      return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    } catch (_e) { return "unknown" }
  }
}

/**
 * Plan §33.6 — fire-and-forget download-log POST to api-scenepacker.php.
 * Session-cookie carries auth; we just hand the asset_id + variant + source.
 * Errors are swallowed: tracking must never block an install or surface to
 * the user (the install itself already succeeded if we reached this point).
 */
export async function beneosLogModuleInstall({ assetId, variant, sceneCount, interaction }) {
  try {
    const mgr = window.BeneosScenePacker
    const sid = mgr?.sessionId
    if (!sid || !assetId) return
    const apiEndpoint = mgr.apiEndpoint
    if (!apiEndpoint) return
    const body = new URLSearchParams({
      s:        sid,
      a:        "log_download",
      asset_id: String(assetId),
      source:   "module",
      // Ein Release ist ein Paket, auch wenn zwanzig Karten darin liegen. Die
      // Vorgangskennung stammt vom Installationslauf und ist dieselbe wie bei
      // den Kreaturen, die mit diesem Release mitkommen; beides zusammen ist
      // EINE Handlung des Nutzers.
      surface:  "scene_install",
      scope:    "pack",
    })
    if (interaction)        body.set("interaction_id", String(interaction))
    if (variant)            body.set("variant",     String(variant))
    if (sceneCount != null) body.set("scene_count", String(sceneCount))
    await fetch(apiEndpoint, {
      method:      "POST",
      headers:     { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      // Auth runs through the s= body param, not a cookie, so we must NOT send
      // credentials: the server's CDN sends Access-Control-Allow-Origin: '*',
      // which the browser rejects for a credentialed cross-origin request
      // (the CORS error seen in the install logs). "omit" keeps this call clean.
      credentials: "omit",
    })
  } catch (_e) {
    // intentional swallow — tracking is best-effort
  }
}
