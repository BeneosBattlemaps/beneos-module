/**
 * Die Einheiten einer Bestandswelt fuer die Umstellung aufs Tor, stre-T-064.
 *
 * Baut aus Register, Kompendium, Welt und Kartenvermerk die Einheiten, die
 * stream-umstellung.mjs umschreibt. Alles, was Foundry oder das Netz braucht,
 * kommt als Dienst herein; die Verdrahtung mit der echten Welt steht in
 * stream-umstellung-window.mjs.
 *
 * KREATUREN (E5, Ergebnis wie eine Neuinstallation): je tokenKey eine Einheit.
 * Die Map nennt BEIDE Ansichten einer Variante, die 2.5D- und die
 * Draufsichtdatei, denn im Draufsicht-Stil traegt das Register token ==
 * topDown, und ein 2.5D-Token derselben Variante stuende sonst nirgends. Die
 * Gegenansicht kommt nur hinein, wenn die Posenliste sie nennt. Ziel ist die
 * Adresse aus `kreaturBildZiel`, derselben Regel wie im Installer. Eine Kreatur
 * mit einem Namen, der kein gewoehnlicher Dateiname ist, oder mit einer Datei,
 * die laut Posenliste am Tor fehlt, bleibt ganz lokal.
 *
 * KARTEN: je Vermerk mit Modus "download" oder "" eine Einheit, mit der Map aus
 * `buildStreamPack`, genau den Zielen einer Streaminstallation. Ganz lokal
 * bleibt ein Release mit einem geteilten Eintrag (E6), mit einem Video an der
 * Toradresse (G2), mit einem nicht ladbaren Manifest, und eines, dessen
 * Dokumente oder Szenen der Vermerk nicht kennt. Der Vermerk selbst bleibt bei
 * "download": die Dateien liegen ja noch.
 */

import { kreaturBildZiel, kreaturDateiOk, kreaturOrdner } from "./kreatur-ziele.mjs"
import { dokumentPlan, FLAGGE_PFAD } from "./stream-umstellung.mjs"
import { releaseFromPackage } from "./stream-install.mjs"
import { KREATUR_PRAEFIX, VIDEO_EXT } from "./stream-settings.mjs"

function gegenansicht(name) {
  if (/-token\.webp$/i.test(name)) return name.replace(/-token\.webp$/i, "-top.webp")
  if (/-top\.webp$/i.test(name)) return name.replace(/-top\.webp$/i, "-token.webp")
  return null
}

const tokenKeyVon = (doc) => doc?.toObject?.()?.flags?.world?.beneos?.tokenKey

/**
 * @param {object} d
 *   register            { fullId: { tokenKey, token, topDown, ... } }
 *   packActors          Actors aus world.beneos_module_actors
 *   weltActors, szenen  alle Actors und Szenen der Welt
 *   posenliste(release), tokenbildImSpiegel(liste, pfad)   aus stream-posen.mjs
 *   adresse(tokenKey, datei)   die Toradresse, wie `_beneosKreaturAdresse`
 */
export async function planeKreaturen(d) {
  const lokal = { untauglich: 0, nichtAmTor: 0, schonStream: 0 }
  const gruppen = new Map()
  for (const [fullId, e] of Object.entries(d.register || {})) {
    const key = e?.tokenKey
    if (!key) continue
    if (!gruppen.has(key)) gruppen.set(key, { fullIds: [], werte: [] })
    const g = gruppen.get(key)
    g.fullIds.push(fullId)
    g.werte.push(e.token, e.topDown)
  }

  const einheiten = []
  for (const [key, g] of gruppen) {
    const ordner = kreaturOrdner(key)
    const pack = (d.packActors || []).filter((a) => tokenKeyVon(a) === key)
    for (const a of pack) g.werte.push(a.toObject()?.prototypeToken?.texture?.src)
    const namen = new Set(g.werte
      .filter((w) => typeof w === "string" && w.startsWith(`${ordner}/`))
      .map((w) => w.slice(ordner.length + 1)))
    if (!namen.size) { lokal.schonStream++; continue }
    if ([...namen].some((n) => !kreaturDateiOk(n))) { lokal.untauglich++; continue }

    let liste = null
    try { liste = await d.posenliste(`${KREATUR_PRAEFIX}${key}`) } catch (_) { liste = null }

    const map = new Map()
    const proben = []
    let fehlt = false
    const aufnehmen = (name, s) => {
      const url = kreaturBildZiel({ tokenKey: key, name, streamt: true, adresse: d.adresse })
      map.set(`${ordner}/${name}`, url)
      proben.push(s?.sha256 ? { url, sha256: s.sha256 } : { url })
    }
    for (const name of namen) {
      const s = d.tokenbildImSpiegel(liste, `${ordner}/${name}`)
      if (s?.zustand === false) { fehlt = true; break }
      aufnehmen(name, s)
      const gegen = gegenansicht(name)
      if (!liste || !gegen || namen.has(gegen) || !kreaturDateiOk(gegen)) continue
      const sg = d.tokenbildImSpiegel(liste, `${ordner}/${gegen}`)
      if (sg?.zustand === true) aufnehmen(gegen, sg)
    }
    if (fehlt) { lokal.nichtAmTor++; continue }

    einheiten.push({
      id: `kreatur:${key}`, art: "kreatur", map, proben, fullIds: g.fullIds,
      dokumente: [...pack, ...(d.weltActors || []), ...(d.szenen || [])],
    })
  }
  return { einheiten, lokal }
}

/** Die Toradressen, die ein Dokumentplan schreiben wuerde. */
function zieleImPlan(plan) {
  const ziele = plan.felder.map((f) => f.ziel)
  for (const e of plan.eingebettet) {
    for (const u of e.updates) {
      for (const [k, v] of Object.entries(u)) if (k !== "_id" && k !== FLAGGE_PFAD) ziele.push(v)
    }
  }
  return ziele
}

/**
 * @param {object} d
 *   vermerke                     BeneosInstallState.getAll()
 *   paketFuer(releaseDir, var)   Paketkennung aus dem Katalog, oder null
 *   ladeManifest(release, var), baueStreamPack(manifest, release, var)
 *   findDocs(releaseDir, var), sceneIds(releaseDir)   aus dem Vermerk
 *   dokument(art, id)            "Scene" | "Playlist"
 */
export async function planeKarten(d) {
  const lokal = { shared: 0, video: 0, manifest: 0, unbekannt: 0, schonStream: 0 }
  const einheiten = []
  for (const [vkey, v] of Object.entries(d.vermerke || {})) {
    const modus = String(v?.mode || "")
    if (modus === "stream") { lokal.schonStream++; continue }
    if (modus !== "download" && modus !== "") continue
    const releaseDir = v?.releaseDir
    if (!releaseDir) { lokal.unbekannt++; continue }

    const pkg = await d.paketFuer(releaseDir, v.variant)
    if (!pkg) { lokal.unbekannt++; continue }
    const { release, variant } = releaseFromPackage(pkg)
    let manifest
    try { manifest = await d.ladeManifest(release, variant) } catch (_) { lokal.manifest++; continue }
    if ((manifest?.entries || []).some((e) => e?.role === "shared")) { lokal.shared++; continue }
    const map = d.baueStreamPack(manifest, release, variant).streamTargets
    if ([...map].some(([k, ziel]) => VIDEO_EXT.test(k) || VIDEO_EXT.test(ziel))) { lokal.video++; continue }

    const docs = d.findDocs(releaseDir, v.variant)
    const szenenIds = d.sceneIds(releaseDir)
    if (!docs || !szenenIds?.size) { lokal.unbekannt++; continue }
    const ids = new Set([...szenenIds, ...(docs.byPath?.["data/Scene.json"] || [])])
    const dokumente = [
      ...[...ids].map((id) => d.dokument("Scene", id)),
      ...(docs.playlists || []).map((p) => d.dokument("Playlist", p?.id)),
    ].filter(Boolean)

    const urls = new Set()
    for (const doc of dokumente) for (const z of zieleImPlan(dokumentPlan(doc, map))) urls.add(z)
    einheiten.push({
      id: `karte:${vkey}`, art: "karte", map, fullIds: [], dokumente,
      proben: [...urls].map((url) => ({ url })),
    })
  }
  return { einheiten, lokal }
}
