/**
 * Eine Bestandswelt von lokalen Dateien aufs Tor umstellen, stre-T-064.
 *
 * Kunden mit lokal installierten Kreaturen und Karten bekommen einen Lauf, der
 * NUR UMSCHREIBT (E1): benannte Bildfelder ihrer Dokumente zeigen danach auf
 * die Toradresse, jede Datei bleibt liegen. Darum ist der Rueckweg ein
 * Zurueckschreiben ohne Netz.
 *
 * Dieser Kern kennt keine Welt. Er bekommt fertige Einheiten (eine Kreatur,
 * ein Kartenrelease) und eine Umgebung mit Fortschritt, Riegel, Kompendium,
 * Register und Abruf. Wer die Einheiten aus der Welt baut, steht in
 * stream-umstellung-plan.mjs.
 *
 * Einheit: { id, map: Map(lokaler Pfad -> Toradresse), proben: [{url, sha256?}],
 *            dokumente: [Foundry-Dokument], fullIds: [Registerschluessel] }
 *
 * Drei Regeln tragen den Entwurf:
 *
 *  1. NUR BENANNTE FELDER. Geschrieben wird ein Blatt nur, wenn sein Name in
 *     FELDNAMEN steht und sein Wert in der Map. `img` steht nicht darin (der
 *     Avatar bleibt lokal, Legacy-Regel 14.4.12), und die Teilbaeume in NIE
 *     werden gar nicht betreten: Deltas, Items, Effekte, Systemdaten, Flaggen.
 *     Ein Wert mit `<` ist HTML und bleibt.
 *  2. ERST PROBEN, DANN SCHREIBEN. Jede Zieladresse einer Einheit wird vorher
 *     gelesen. Eine einzige Absage, ein Stummel oder eine falsche Pruefsumme,
 *     und die Einheit bleibt ganz lokal. Ohne Netz endet der Lauf.
 *  3. DER RUECKWEG STEHT AM FELD. Je geschriebenem Feld eine Flagge mit dem
 *     alten Wert und dem Ziel OHNE Schluessel. Zurueckgeschrieben wird nur, wo
 *     der heutige Wert maskiert noch das Ziel ist; was der Spielleiter danach
 *     geaendert hat, bleibt.
 */

import { gateAdresseFuer } from "./stream-install.mjs"
import { ohneSchluessel } from "./stream-report.mjs"

/** Blattnamen, die ein Bildpfad sein duerfen. `img` fehlt mit Absicht. */
export const FELDNAMEN = new Set(["src", "path", "foreground", "thumb"])

/** Teilbaeume, die nie gelesen und nie geschrieben werden. */
export const NIE = new Set(["_id", "_stats", "flags", "delta", "items", "effects", "system", "img"])

export const FLAGGE_PFAD = "flags.beneos-module.umstellung.vorher"
const FLAGGE_LOESCHEN = "flags.beneos-module.umstellung.-=vorher"

function holen(obj, pfad) {
  return pfad.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

/**
 * Die Sammlungen eingebetteter Dokumente, als { Typ: Feldname }, ohne die in
 * NIE. Ein Actor bettet Items und ActiveEffects ein; die werden nie betreten.
 */
function eingebettet(doc) {
  const e = doc?.constructor?.metadata?.embedded
  if (!e || typeof e !== "object") return {}
  return Object.fromEntries(Object.entries(e).filter(([, feld]) => !NIE.has(feld)))
}

/**
 * Die Felder eines Objekts, die umgestellt werden. Liefert die Treffer und die
 * Zahl der Map-Treffer, die stehenbleiben, weil Feld oder Ort nicht erlaubt ist.
 */
function felderIn(obj, map, auslassen) {
  const felder = []
  let uebersprungen = 0
  const lauf = (o, praefix, inListe) => {
    for (const [k, v] of Object.entries(o || {})) {
      if (NIE.has(k) || (!praefix && auslassen.has(k))) continue
      const pfad = praefix ? `${praefix}.${k}` : k
      if (typeof v === "string") {
        if (v.includes("<")) continue
        const ziel = gateAdresseFuer(v, map)
        if (!ziel) continue
        if (inListe || !FELDNAMEN.has(k)) uebersprungen++
        else felder.push({ pfad, lokal: v, ziel })
      } else if (Array.isArray(v)) {
        lauf(Object.fromEntries(v.map((x, i) => [i, x])), pfad, true)
      } else if (v && typeof v === "object") {
        lauf(v, pfad, inListe)
      }
    }
  }
  lauf(obj, "", false)
  return { felder, uebersprungen }
}

/** Die Rueckwegflagge mit den neuen Feldern, alte Eintraege desselben Pfads ersetzt. */
function flaggeMit(obj, felder) {
  const alt = Array.isArray(holen(obj, FLAGGE_PFAD)) ? holen(obj, FLAGGE_PFAD) : []
  const neu = new Set(felder.map((f) => f.pfad))
  return [
    ...alt.filter((e) => !neu.has(e?.pfad)),
    ...felder.map((f) => ({ pfad: f.pfad, lokal: f.lokal, ziel: ohneSchluessel(f.ziel) })),
  ]
}

/**
 * Was an einem Dokument umgestellt wuerde, ohne zu schreiben.
 * @returns {{felder: Array, eingebettet: Array<{typ, updates}>, uebersprungen: number, stellen: number}}
 */
export function dokumentPlan(doc, map) {
  const obj = doc.toObject()
  const samml = eingebettet(doc)
  const oben = felderIn(obj, map, new Set(Object.values(samml)))
  const unten = []
  let uebersprungen = oben.uebersprungen
  let stellen = oben.felder.length
  for (const [typ, feld] of Object.entries(samml)) {
    const updates = []
    for (const kind of Array.isArray(obj[feld]) ? obj[feld] : []) {
      const r = felderIn(kind, map, new Set())
      uebersprungen += r.uebersprungen
      if (!r.felder.length) continue
      stellen += r.felder.length
      const u = { _id: kind._id, [FLAGGE_PFAD]: flaggeMit(kind, r.felder) }
      for (const f of r.felder) u[f.pfad] = f.ziel
      updates.push(u)
    }
    if (updates.length) unten.push({ typ, updates })
  }
  return { obj, felder: oben.felder, eingebettet: unten, uebersprungen, stellen }
}

async function dokumentSchreiben(doc, plan) {
  if (plan.felder.length) {
    const aenderung = { [FLAGGE_PFAD]: flaggeMit(plan.obj, plan.felder) }
    for (const f of plan.felder) aenderung[f.pfad] = f.ziel
    await doc.update(aenderung)
  }
  for (const e of plan.eingebettet) await doc.updateEmbeddedDocuments(e.typ, e.updates)
}

/**
 * Eine Zieladresse lesen, bevor sie geschrieben wird.
 * Ergebnis: "ok" | "abgewiesen" | "offline" | "stummel" | "falsch".
 *
 * Dieselben Kennzeichen wie `toStore` in stream-fetch.mjs: das Tor antwortet
 * einer Absage mit 200 und `x-beneos-denied`, der Ersatz ohne Netz mit
 * `x-beneos-offline`. Ein Koerper bis 8 Byte oder das 42-Byte-GIF ist ein
 * Platzhalter und keine Datei.
 */
export async function leseprobe(probe, abruf = globalThis.fetch) {
  let r
  try { r = await abruf(probe.url, { cache: "no-store" }) } catch (_) { return "offline" }
  if (r.headers.get("x-beneos-denied") || !r.ok) return "abgewiesen"
  if (r.headers.get("x-beneos-offline")) return "offline"
  let bytes
  try { bytes = new Uint8Array(await r.arrayBuffer()) } catch (_) { return "offline" }
  if (bytes.length <= 8) return "stummel"
  if (bytes.length === 42 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "stummel"
  if (probe.sha256) {
    const h = await globalThis.crypto.subtle.digest("SHA-256", bytes)
    const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("")
    if (hex !== probe.sha256) return "falsch"
  }
  return "ok"
}

const istKompendium = (doc) => Boolean(doc?.pack)

/** Registerfelder einer Einheit, die auf einen Map-Schluessel zeigen. */
function registerTreffer(reg, einheit) {
  const treffer = []
  for (const id of einheit.fullIds || []) {
    for (const feld of ["token", "topDown"]) {
      const alt = reg?.[id]?.[feld]
      const ziel = typeof alt === "string" ? gateAdresseFuer(alt, einheit.map) : null
      if (ziel) treffer.push({ id, feld, alt, ziel })
    }
  }
  return treffer
}

function leererStand(s) {
  return {
    erledigt: Array.isArray(s?.erledigt) ? s.erledigt : [],
    register: s?.register && typeof s.register === "object" ? s.register : {},
  }
}

/**
 * Der Lauf. `u` ist die Umgebung:
 *   fortschritt {lesen, schreiben}, riegel {nehmen, geben},
 *   paket {oeffnen, schliessen}, register {lesen, schreiben},
 *   abruf, signal, trocken, nachEinheit (optional, fuer Fortschrittsanzeige)
 *
 * @returns {Promise<{verweigert?, abgebrochen, offline, umgestellt, stellen, uebersprungen, gruende}>}
 */
export async function umstellen(einheiten, u) {
  const erg = { abgebrochen: false, offline: false, umgestellt: 0, stellen: 0, uebersprungen: 0, gruende: {} }
  if (u.trocken) {
    const reg = (await u.register.lesen()) || {}
    for (const e of einheiten) {
      for (const d of e.dokumente) {
        const p = dokumentPlan(d, e.map)
        erg.stellen += p.stellen
        erg.uebersprungen += p.uebersprungen
      }
      erg.stellen += registerTreffer(reg, e).length
    }
    return erg
  }

  if (!(await u.riegel.nehmen())) return { ...erg, verweigert: true }
  let paketOffen = false
  try {
    const stand = leererStand(await u.fortschritt.lesen())
    for (const e of einheiten) {
      if (u.signal?.aborted) { erg.abgebrochen = true; break }
      if (stand.erledigt.includes(e.id)) continue

      const plaene = e.dokumente.map((d) => ({ d, p: dokumentPlan(d, e.map) }))
      const reg = (await u.register.lesen()) || {}
      const regTreffer = registerTreffer(reg, e)
      const stellen = plaene.reduce((n, x) => n + x.p.stellen, 0) + regTreffer.length
      erg.uebersprungen += plaene.reduce((n, x) => n + x.p.uebersprungen, 0)
      if (!stellen) {
        stand.erledigt.push(e.id)
        await u.fortschritt.schreiben(stand)
        continue
      }

      let fehl = null
      for (const probe of e.proben || []) {
        const r = await leseprobe(probe, u.abruf)
        if (r !== "ok") { fehl = r; break }
      }
      if (fehl === "offline") { erg.offline = true; break }
      if (fehl) { erg.gruende[fehl] = (erg.gruende[fehl] || 0) + 1; await u.fortschritt.schreiben(stand); continue }

      if (!paketOffen && plaene.some((x) => istKompendium(x.d) && x.p.stellen)) {
        await u.paket.oeffnen()
        paketOffen = true
      }
      for (const { d, p } of plaene) await dokumentSchreiben(d, p)
      if (regTreffer.length) {
        // ERST DER RUECKWEG, DANN DAS REGISTER. Scheiterte das Sichern nach dem
        // Schreiben, stuende das Register auf dem Tor und kein Fortschritt
        // kennte den lokalen Wert. Dann frisch lesen und nur die eigenen Felder
        // setzen, und nur dort, wo noch der lokale Wert steht: zwischen dem
        // ersten Lesen und hier liefen Leseproben uebers Netz, und ein anderer
        // Schreiber (Installer, Nachzug) kann das Register geaendert haben.
        for (const t of regTreffer) stand.register[`${t.id}|${t.feld}`] = { lokal: t.alt, ziel: ohneSchluessel(t.ziel) }
        await u.fortschritt.schreiben(stand)
        const frisch = (await u.register.lesen()) || {}
        let geaendert = false
        for (const t of regTreffer) {
          if (frisch[t.id]?.[t.feld] !== t.alt) { delete stand.register[`${t.id}|${t.feld}`]; continue }
          frisch[t.id][t.feld] = t.ziel
          geaendert = true
        }
        if (geaendert) await u.register.schreiben(frisch)
      }
      stand.erledigt.push(e.id)
      await u.fortschritt.schreiben(stand)
      erg.umgestellt++
      erg.stellen += stellen
      u.nachEinheit?.(e, erg)
    }
  } finally {
    if (paketOffen) await u.paket.schliessen()
    await u.riegel.geben()
  }
  return erg
}

/** Die Felder eines Objekts, die laut Flagge zurueckgehen, und die belassenen. */
function rueckFelder(obj) {
  const eintraege = holen(obj, FLAGGE_PFAD)
  if (!Array.isArray(eintraege) || !eintraege.length) return null
  const aenderung = { [FLAGGE_LOESCHEN]: null }
  let belassen = 0
  for (const e of eintraege) {
    const heute = holen(obj, String(e?.pfad || ""))
    if (typeof heute === "string" && ohneSchluessel(heute) === e.ziel) aenderung[e.pfad] = e.lokal
    else belassen++
  }
  return { aenderung, belassen }
}

/**
 * Der Rueckweg (E3): ohne Netz, denn die Dateien liegen noch.
 *
 * ER BRAUCHT KEINE PLANUNG, nur Dokumente. Nach einer Umstellung zeigt das
 * Register aufs Tor, und die Planung faende die Kreatur nicht mehr als lokal.
 * Darum stehen Ruecksprung und Ziel an jedem Feld (Flagge) und im Fortschritt
 * (Register), beide mit maskiertem Ziel.
 *
 * @param {Array<object>} dokumente  alle Dokumente, die Flaggen tragen koennen
 * @returns {Promise<{verweigert?, zurueck: number, belassen: number}>}
 */
export async function zurueckstellen(dokumente, u) {
  const erg = { zurueck: 0, belassen: 0 }
  if (!(await u.riegel.nehmen())) return { ...erg, verweigert: true }
  let paketOffen = false
  try {
    const stand = leererStand(await u.fortschritt.lesen())
    for (const d of new Set(dokumente)) {
      const obj = d.toObject()
      const oben = rueckFelder(obj)
      const unten = []
      for (const [typ, feld] of Object.entries(eingebettet(d))) {
        const updates = []
        for (const kind of Array.isArray(obj[feld]) ? obj[feld] : []) {
          const r = rueckFelder(kind)
          if (!r) continue
          erg.belassen += r.belassen
          updates.push({ _id: kind._id, ...r.aenderung })
        }
        if (updates.length) unten.push({ typ, updates })
      }
      if (!oben && !unten.length) continue
      if (!paketOffen && istKompendium(d)) { await u.paket.oeffnen(); paketOffen = true }
      if (oben) { erg.belassen += oben.belassen; await d.update(oben.aenderung) }
      for (const x of unten) await d.updateEmbeddedDocuments(x.typ, x.updates)
      erg.zurueck++
    }
    const reg = (await u.register.lesen()) || {}
    let regGeaendert = false
    for (const [k, v] of Object.entries(stand.register)) {
      const [id, feld] = k.split("|")
      const heute = reg[id]?.[feld]
      if (typeof heute === "string" && ohneSchluessel(heute) === v?.ziel) { reg[id][feld] = v.lokal; regGeaendert = true }
      else erg.belassen++
    }
    if (regGeaendert) await u.register.schreiben(reg)
    await u.fortschritt.schreiben({ erledigt: [], register: {} })
  } finally {
    if (paketOffen) await u.paket.schliessen()
    await u.riegel.geben()
  }
  return erg
}
