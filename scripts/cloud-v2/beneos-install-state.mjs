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
import { beneosReleaseAlias } from "./beneos-release-aliases.mjs"

const SETTING_KEY = "battlemap-installs"

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
    for (const [, entry] of Object.entries(all)) {
      if (!entry || typeof entry !== "object") continue
      if (entry.releaseDir === releaseDir) out.push(entry)
    }
    if (out.length) return out

    // ERST WENN DIE GENAUE SCHREIBWEISE NICHTS FINDET, WIRD UEBER DEN ALIAS
    // GESUCHT.
    //
    // Dreizehn Legacy-Releases mit Buchstabensuffix wandern auf das Band ab
    // 9100. Waehrend dieser Wanderung stehen der Vermerk in der Welt und der
    // Name im Katalog voruebergehend auf verschiedenen Seiten: die Welt kennt
    // `bm_0093b`, der Katalog schon `bm_9113`, oder umgekehrt, je nachdem
    // welche Seite zuerst nachgezogen wurde.
    //
    // DER VERGLEICH LAEUFT DESHALB AUF BEIDEN SEITEN DURCH DEN ALIAS, NICHT NUR
    // AUF EINER. Nur so traegt er in BEIDE Richtungen:
    //
    //   Frage bm_9113  -> bm_9113 , Vermerk bm_0093b -> bm_9113   gefunden
    //   Frage bm_0093b -> bm_9113 , Vermerk bm_9113  -> bm_9113   gefunden
    //
    // Eine einseitige Aufloesung haette genau den ersten Fall verloren, und das
    // ist der haeufigere: der Katalog wird vor den Kundenwelten umgestellt.
    //
    // Der Durchlauf kostet nur dort, wo die genaue Schreibweise nichts fand.
    // Fuer jedes nicht umbenannte Release gibt der Alias seine Eingabe
    // unveraendert zurueck, der Vergleich ist dann der alte.
    const ziel = beneosReleaseAlias(releaseDir)
    for (const [, entry] of Object.entries(all)) {
      if (!entry || typeof entry !== "object" || !entry.releaseDir) continue
      if (beneosReleaseAlias(entry.releaseDir) === ziel) out.push(entry)
    }
    return out
  }

  /**
   * Every scene id this world installed from a release, across all variants.
   *
   * WHY THE UNION AND NOT THE FIRST ROW
   *
   * findByReleaseDir may legitimately return two rows for one release (4K and
   * HD side by side). Scene ids come out of the pack and are identical in both
   * variants, so the union deduplicates by itself and is the only reading that
   * survives a variant switch mid-campaign.
   *
   * WHY THIS EXISTS AT ALL
   *
   * A row in this registry says "this release was installed here". It does NOT
   * say the whole release arrived: a scene-scoped install writes the release
   * dir with a single scene id (beneos-native-installer #recordInstallIfAny).
   * Every caller that wants to know whether ONE PARTICULAR scene is present
   * has to look at the ids, not at the row count. Reading the row count alone
   * is what made the POI teleporter tell users a release was broken when they
   * had simply installed one map out of fourteen.
   *
   * Returns an empty Set for unknown releases and for worlds that installed
   * before this registry existed. That is "not known", never "not installed".
   */
  static installedSceneIds(releaseDir) {
    const out = new Set()
    for (const entry of this.findByReleaseDir(releaseDir)) {
      if (!Array.isArray(entry.sceneIds)) continue
      for (const id of entry.sceneIds) {
        const s = String(id || "")
        if (s) out.add(s)
      }
    }
    return out
  }

  /** Did any install of this release bring that particular scene? */
  static hasScene(releaseDir, sceneId) {
    if (!releaseDir || !sceneId) return false
    return this.installedSceneIds(releaseDir).has(String(sceneId))
  }

  /**
   * Die vermerkten Szenen, die es in dieser Welt WIRKLICH noch gibt.
   *
   * `installedSceneIds` beantwortet "was wurde damals angelegt". Das ist eine
   * Erinnerung. Diese Funktion beantwortet "was steht jetzt da", und nur die
   * zweite Antwort taugt fuer die Aussage "installiert".
   *
   * Der Unterschied entsteht in Sekunden: die Spielleitung loescht einen
   * Szenenordner, und das Modul behauptet weiter, das Release sei installiert.
   * Dass die Quelldateien noch im Cloud-Ordner auf der Platte liegen, aendert
   * daran nichts; installiert ist, was in der Welt steht.
   */
  static vorhandeneSceneIds(releaseDir) {
    const out = new Set()
    for (const id of this.installedSceneIds(releaseDir)) {
      try { if (game.scenes?.get?.(id)) out.add(id) } catch (_e) { /* Welt nicht bereit */ }
    }
    return out
  }

  /**
   * Das eine Urteil ueber ein Release, das alle Aufrufer teilen.
   *
   * Vorher hatten fuenf Stellen ihre eigene Meinung, und die meisten lauteten
   * `findByReleaseDir(dir).length > 0`, also "es gibt eine Zeile". Genau das
   * ist die Erinnerung und nicht die Gegenwart.
   *
   * Vier Zustaende, und der erste ist der wichtigste:
   *
   *   unbekannt     Die Zeile traegt KEINE Szenenkennungen. Welten, die vor der
   *                 Kennungsfuehrung installiert haben. Sie gelten weiter als
   *                 installiert, werden nie herabgestuft und nie geraeumt.
   *                 Diese Zeile ist die Bremse des ganzen Vorhabens: ohne sie
   *                 wuerde ein Altbestand schlagartig als nicht installiert
   *                 gelten. Siehe die Begruendung an `installedSceneIds`.
   *   verschwunden  Kennungen sind da, aber KEINE einzige loest auf.
   *   teilweise     Einige loesen auf, andere nicht.
   *   vollstaendig  Alle loesen auf.
   *
   * `keine` heisst: es gibt ueberhaupt keine Zeile zu diesem Release.
   *
   * @returns {{zustand: string, vermerkt: number, vorhanden: number, zeilen: number}}
   */
  static weltbefund(releaseDir) {
    const zeilen = this.findByReleaseDir(releaseDir)
    if (!zeilen.length) return { zustand: "keine", vermerkt: 0, vorhanden: 0, zeilen: 0 }
    const vermerkt = this.installedSceneIds(releaseDir)
    if (!vermerkt.size) {
      return { zustand: "unbekannt", vermerkt: 0, vorhanden: 0, zeilen: zeilen.length }
    }
    const vorhanden = this.vorhandeneSceneIds(releaseDir)
    let zustand = "teilweise"
    if (vorhanden.size === 0) zustand = "verschwunden"
    else if (vorhanden.size >= vermerkt.size) zustand = "vollstaendig"
    return { zustand, vermerkt: vermerkt.size, vorhanden: vorhanden.size, zeilen: zeilen.length }
  }

  /**
   * Gilt dieses Release als installiert?
   *
   * Die eine Frage, die die Oberflaeche wirklich stellt. `unbekannt` zaehlt
   * als installiert, `verschwunden` nicht.
   */
  static istInstalliert(releaseDir) {
    const b = this.weltbefund(releaseDir)
    return b.zustand === "vollstaendig" || b.zustand === "teilweise" || b.zustand === "unbekannt"
  }

  /**
   * Zeilen entfernen, deren Szenen es alle nicht mehr gibt.
   *
   * VIER BEDINGUNGEN, UND JEDE EINZELNE VERHINDERT EINEN DATENVERLUST.
   *
   * 1. Die Welt muss geladen sein. Eine halb geladene Welt hat noch keine
   *    Szenen und sieht deshalb aus wie eine leere. Ohne diese Bedingung
   *    raeumte der erste Blick nach dem Weltstart das ganze Register weg.
   * 2. Nur die Spielleitung. Das Register ist weltweit gespeichert; ein
   *    Spieler darf nicht schreiben und soll es nicht versuchen.
   * 3. Nur `verschwunden`. Eine Teilinstallation bleibt stehen, sie ist ja
   *    noch da, nur unvollstaendig.
   * 4. Nur Zeilen mit Kennungen. `unbekannt` ist kein Befund, sondern das
   *    Eingestaendnis, dass wir es nicht wissen.
   *
   * Betreiberentscheidung vom 02.09.2026: geraeumt wird, nicht nur angezeigt.
   * Der Preis steht dort ausdruecklich: eine zurueckgespielte Sicherung bringt
   * die Szenen wieder, aber nicht den Vermerk, und damit sind
   * Installationsdatum und Signatur verloren.
   *
   * @param {(releaseDir: string) => Promise<void>} [nachRaeumen]
   *        Wird je geraeumtem Release aufgerufen, bevor geschrieben wird.
   *        Der Streaming-Zweig loest darueber die Offline-Zusage.
   * @returns {Promise<{geprueft: number, geraeumt: string[], grund: string}>}
   */
  static async raeumeVerschwundene(nachRaeumen = null) {
    const nichts = (grund) => ({ geprueft: 0, geraeumt: [], grund })
    try {
      if (!game?.ready) return nichts("Welt nicht bereit")
      if (!game.scenes?.size) return nichts("keine Szenen geladen")
      if (!game.user?.isGM) return nichts("nicht die Spielleitung")
    } catch (_e) { return nichts("Spielzustand nicht lesbar") }

    const alle = this.getAll()
    const schluessel = Object.keys(alle)
    if (!schluessel.length) return nichts("Register leer")

    // Je Release EINMAL urteilen, nicht je Zeile: zwei Varianten desselben
    // Release teilen sich ihre Szenenkennungen, und ein Urteil je Zeile wuerde
    // dieselbe Frage doppelt stellen.
    const urteile = new Map()
    const weg = []
    for (const k of schluessel) {
      const dir = String(alle[k]?.releaseDir || "")
      if (!dir) continue
      if (!urteile.has(dir)) urteile.set(dir, this.weltbefund(dir))
      if (urteile.get(dir).zustand === "verschwunden") weg.push(k)
    }
    if (!weg.length) return { geprueft: urteile.size, geraeumt: [], grund: "nichts verschwunden" }

    const geraeumt = []
    for (const k of weg) {
      const dir = String(alle[k]?.releaseDir || "")
      if (typeof nachRaeumen === "function") {
        // Ein Fehler beim Freigeben darf das Raeumen nicht aufhalten, aber er
        // wird genannt. Stilles Verschlucken hiesse, ein Kontingent haengt und
        // niemand erfaehrt warum.
        try { await nachRaeumen(dir) }
        catch (e) { console.warn(`BeneosInstallState | Nacharbeit fuer ${dir} fehlgeschlagen`, e) }
      }
      delete alle[k]
      geraeumt.push(dir)
    }
    try {
      await game.settings.set(BeneosUtility.moduleID(), SETTING_KEY, alle)
    } catch (e) {
      console.warn("BeneosInstallState | Register nicht geschrieben", e)
      return { geprueft: urteile.size, geraeumt: [], grund: "Schreiben fehlgeschlagen" }
    }
    console.log(`BeneosInstallState | ${geraeumt.length} Zeile(n) geraeumt, deren Szenen es nicht mehr gibt: ${geraeumt.join(", ")}`)
    return { geprueft: urteile.size, geraeumt, grund: "" }
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
   * Der Schluessel, unter dem dieses Release in DIESER Welt wirklich vermerkt
   * ist, nicht der, den der Katalog erwarten liesse.
   *
   * WARUM DAS AUSEINANDERFAELLT
   *
   * Der Vermerk ist auf `<releaseDir>_<variant>` geschluesselt. Waehrend der
   * Wanderung der dreizehn Buchstabenreleases auf das Band ab 9100 heisst
   * dasselbe Release auf beiden Seiten verschieden: die Welt kennt noch
   * `bm_0093b_4K`, der Katalog schon `bm_9113`.
   *
   * `findByReleaseDir` loest das ueber den Alias auf und ist damit blind
   * gegenueber der Schreibweise. Drei Stellen arbeiten aber nicht mit der
   * Zeile, sondern mit ihrem SCHLUESSEL, und die brauchen diese Aufloesung:
   *
   *   forget                  loescht nach Schluessel
   *   recordInstall           schreibt nach Schluessel
   *   Deinstallierer          nimmt sich ueber den Schluessel selbst von den
   *                           "anderen Installationen" aus
   *
   * Der dritte ist der gefaehrlichste. Trifft er seinen eigenen Schluessel
   * nicht, haelt er sich fuer eine fremde Installation, beansprucht seine
   * eigenen Dateien und raeumt sie deshalb nicht weg.
   *
   * ES WIRD NICHTS UMGESCHRIEBEN, NUR NACHGESCHLAGEN. Eine einmalige Wanderung
   * der Weltvermerke waere der naheliegende Weg gewesen und ist verworfen: sie
   * liefe beim Weltstart, also lange bevor der Katalog den neuen Namen fuehrt,
   * und genau dann fiele der Deinstallierer in den eben beschriebenen Fall.
   *
   * Findet sich nichts, kommt die genaue Schreibweise zurueck. Ein Neueintrag
   * entsteht damit wie bisher.
   *
   * @returns {string} vorhandener Schluessel, sonst die genaue Schreibweise
   */
  static vermerkSchluessel(releaseDir, variant) {
    const v = String(variant || "")
    const genau = v ? `${releaseDir}_${v}` : String(releaseDir || "")
    if (!releaseDir) return genau
    const all = this.getAll()
    if (all[genau]) return genau
    const ziel = beneosReleaseAlias(releaseDir)
    for (const [key, entry] of Object.entries(all)) {
      if (!entry || typeof entry !== "object" || !entry.releaseDir) continue
      // Die Variante muss stimmen. 4K und HD desselben Release sind zwei
      // Zeilen, und die falsche zu treffen hiesse, dem Kunden die andere
      // Aufloesung wegzuraeumen.
      if (String(entry.variant || "") !== v) continue
      if (beneosReleaseAlias(entry.releaseDir) === ziel) return key
    }
    return genau
  }

  /**
   * Persist one install. Key format: `<releaseDir>_<variant>` (variant = ""
   * for single-variant releases). Timestamp and signature always describe the
   * latest run; the scene ids ACCUMULATE.
   *
   * WHY THE IDS ARE UNIONED AND NOT REPLACED
   *
   * A run reports only the scenes it imported itself. Replacing therefore
   * turned "installed map 3 of this pack, then map 7" into a record that knows
   * about map 7 alone, and the world would keep reporting one scene out of
   * fourteen no matter how many maps the user collected one by one. Since the
   * completeness of this record now drives what the customer is told, that
   * undercount is the same class of false statement the record exists to end.
   *
   * The cost is a stale id when a repack DROPS a scene: the union keeps it and
   * the release then looks more complete than it is. That is the direction we
   * want to err in. Over-reporting completeness costs a missing hint; under-
   * reporting it accuses the customer's install of being broken.
   */
  static async recordInstall({ releaseDir, variant, assetId, sceneIds, sourceSignature, sceneCount }) {
    if (!releaseDir) return
    const all = this.getAll()
    const key = variant ? `${releaseDir}_${variant}` : releaseDir
    // Der Vermerk kann unter dem alten Namen des Release liegen. Dann wandert
    // er JETZT auf den neuen, und nur jetzt: in diesem Augenblick hat der
    // Katalog den neuen Namen gerade selbst geliefert, er ist also belegt.
    // Eine Wanderung auf Verdacht beim Weltstart waere das Gegenteil davon.
    const alterKey = this.vermerkSchluessel(releaseDir, variant)
    const vereinigt = new Set(Array.isArray(all[key]?.sceneIds) ? all[key].sceneIds.map(String) : [])
    if (alterKey !== key) {
      for (const id of (Array.isArray(all[alterKey]?.sceneIds) ? all[alterKey].sceneIds : [])) {
        const s = String(id || "")
        if (s) vereinigt.add(s)
      }
    }
    for (const id of (Array.isArray(sceneIds) ? sceneIds : [])) {
      const s = String(id || "")
      if (s) vereinigt.add(s)
    }
    if (alterKey !== key) delete all[alterKey]
    all[key] = {
      releaseDir,
      variant:         variant || "",
      assetId:         String(assetId || ""),
      sceneIds:        [...vereinigt],
      // Was THIS run's size, not the record's. The two drifted apart the moment
      // the ids started accumulating, and the badge reads the ids. The passed
      // count only stands in for a run that reported no ids at all.
      sceneCount:      vereinigt.size || Number(sceneCount || 0),
      installedAt:     new Date().toISOString(),
      sourceSignature: String(sourceSignature || ""),
    }
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
    const key = this.vermerkSchluessel(releaseDir, variant)
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
   * worlds that imported a release before the registry existed.
   *
   * Three-way since 18.09.2026, because a re-install used to be all or nothing:
   *   "schonen" => merge, the user's own tokens/tiles/notes stay (the default),
   *   "neubau"  => the old behaviour, scenes are rebuilt from the pack,
   *   "abbruch" => install nothing.
   * Returns Promise<"schonen"|"neubau"|"abbruch">.
   */
  static async confirmWorldOverwrite({ scope, name, presentCount = 0, totalCount = 0, installedAt = "", stale = false }) {
    const DialogV2 = foundry?.applications?.api?.DialogV2
    // Too old to ask: never block an install, and take the option that cannot
    // destroy anything the user placed.
    if (!DialogV2?.wait) return "schonen"

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
    const keep = L("BENEOS.Cloud.Bmap.Overwrite.WarnKeep",
      "Your own tokens, tiles, notes and drawings on these scenes stay where they are. Only the Beneos content is updated.")
    const rebuild = L("BENEOS.Cloud.Bmap.Overwrite.WarnRebuild",
      "Rebuilding from scratch discards everything you placed on these scenes.")

    const body = (intro + " " + keep)
      .replace("%subject%", foundry.utils.escapeHTML(subject))
      .replace("%name%",    safeName)
      .replace("%date%",    foundry.utils.escapeHTML(dateStr))

    const keepLabel = stale
      ? L("BENEOS.Cloud.Bmap.Overwrite.YesUpdateKeep", "Update and keep my changes")
      : L("BENEOS.Cloud.Bmap.Overwrite.YesKeep", "Reinstall and keep my changes")
    const rebuildLabel = L("BENEOS.Cloud.Bmap.Overwrite.YesRebuild", "Rebuild from scratch")
    const noLabel = L("BENEOS.Cloud.Bmap.Overwrite.Cancel", "Cancel")

    const content =
      `<p style="line-height:1.5">${body}</p>` +
      `<p style="line-height:1.5;opacity:.75">${foundry.utils.escapeHTML(rebuild)}</p>`

    try {
      const wahl = await DialogV2.wait({
        window:  { title },
        content,
        buttons: [
          { action: "schonen", label: keepLabel,     default: true, callback: () => "schonen" },
          { action: "neubau",  label: rebuildLabel,                 callback: () => "neubau"  },
          { action: "abbruch", label: noLabel,                      callback: () => "abbruch" },
        ],
        rejectClose: false,
      })
      // Closing the window without choosing must not install anything.
      return (wahl === "schonen" || wahl === "neubau") ? wahl : "abbruch"
    } catch (_e) {
      return "abbruch"
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
