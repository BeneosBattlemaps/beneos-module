/**
 * stream-html.mjs
 *
 * Kein Streamschluessel im HTML der Kundendokumente (stre-T-116).
 *
 * WARUM. Seit stre-T-102 stehen Kacheln, Szenen, Klaenge und Akteure
 * schluesselfrei (`beneos://`) auf der Platte. Im HTML der Journalseiten stand
 * aber weiter die Toradresse MIT Schluessel, weil Foundrys Bereinigung ein
 * `src` mit dem Schema `beneos://` verwirft. Ein exportiertes Journal gab damit
 * den Schluessel weiter.
 *
 * WIE. Ein Bild im HTML bekommt die Form (a):
 *
 *   <img src="PLATZHALTER_BILD" data-beneos-src="beneos://a/...">
 *
 * `data-*` und das Schema `data:` laesst die Bereinigung stehen, gemessen am
 * 17.11.2026 in v13 13.351 und v14 14.367 (Anlegen, Update, Editor-Speichern,
 * Export, Import). Das echte Bild setzt erst die Anzeige ein, ueber
 * `blobFuer` in `stream-bilder.mjs`, und nur im DOM.
 *
 * DAS AUSSEHEN VOR DEM TAUSCH KOMMT NIE AUS DEN DATEN. Der Platzhalter ist fuer
 * alle Bilder derselbe neutrale Wert; wie die Flaeche vor dem Tausch aussieht,
 * sagt allein die CSS-Regel auf `img[data-beneos-src]` (Auftrag P-04:01:17,
 * Vorgabe 1). Eine spaetere Entscheidung zum Aussehen tauscht nur die Regel.
 *
 * AM SCHLUESSEL, NICHT AM MODUS. Ohne Schluessel tut nichts hier etwas: die
 * Pruefung steckt in `schluesselfreiAdresse`, und jeder Einstieg fragt
 * zusaetzlich `streamKey()` vorab. Ein Bestandskunde der Download-Wege merkt
 * nichts.
 */

import { schluesselfreiAdresse, streamKey, streamHost } from "./stream-settings.mjs"

/**
 * Der Platzhalter: ein durchsichtiges SVG von einem Pixel, als `data:`-Adresse
 * OHNE `;base64`.
 *
 * Nicht base64, weil der Editor beim Einfuegen jede Adresse
 * `data:<bild>;base64,` als eingefuegtes Bild hochlaedt (Foundry
 * `common/prosemirror/image-plugin.mjs`, `_extractBase64Images`, v13 :154).
 * Jedes Kopieren eines Bildes legte sonst eine Datei `pasted-image.png` in der
 * Kundenwelt ab. Ohne Anfuehrungszeichen im Wert, damit er in einfach wie
 * doppelt gefasste Attribute passt.
 */
export const PLATZHALTER_BILD =
  "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%221%22%20height=%221%22/%3E"

// Ein ganzes Bild-Tag. `src` wird danach IM Tag gesucht, und zwar nur als
// eigenes Attribut: ein `\bsrc` traefe auch das `src` in `data-beneos-src`,
// und die gierige Form `[^>]*\bsrc` aus `stream-install.mjs` faengt das
// LETZTE der beiden.
const IMG_RE = /<img\b[^>]*>/gi
const SRC_RE = /(?<![\w-])src\s*=\s*(["'])([^"']*)\1/i
const DATA_RE = /(?<![\w-])data-beneos-src\s*=\s*(["'])([^"']*)\1/i
const ANDERE_RE = /<(?:video|source|audio)\b[^>]*>/gi

/**
 * Lohnt die Regex? Haelt sie von den gewoehnlichen Feldwerten fern, die nie
 * HTML mit einer Toradresse sind.
 */
function kandidat(text) {
  if (typeof text !== "string" || !text.includes("<") || !text.includes("src")) return false
  const host = streamHost()
  return !!host && text.includes(host)
}

/**
 * Wandelt jede Bild-Toradresse mit Schluessel in Form (a). Rein bis auf das
 * Lesen der Einstellungen.
 *
 * Alle anderen Attribute bleiben zeichengleich, auch `width` und `height`;
 * getauscht wird nur der Wert von `src`, und `data-beneos-src` kommt dazu oder
 * wird nachgezogen. Eine fremde Adresse oder eine Adresse unter fremder Basis
 * laesst `schluesselfreiAdresse` stehen, und damit bleibt das Tag bytegleich.
 *
 * `<video>`, `<audio>` und `<source>` werden nicht gewandelt: ein Bild als
 * Platzhalter spielte dort nicht, und keines davon geht ueber den Blob-Weg.
 * Gefundene werden in `andere` gezaehlt, damit sie sichtbar bleiben (Bestand
 * am 17.11.2026: 0).
 *
 * @returns {{html: string, zahl: number, andere: number}}
 */
export function htmlSchluesselfrei(html) {
  if (!streamKey() || !kandidat(html)) return { html, zahl: 0, andere: 0 }
  let zahl = 0
  let andere = 0
  const neu = html.replace(IMG_RE, (tag) => {
    const src = SRC_RE.exec(tag)
    if (!src) return tag
    const [attribut, anfuehrung, adresse] = src
    const frei = schluesselfreiAdresse(adresse)
    if (frei === adresse) return tag
    zahl++
    const neuesSrc = `src=${anfuehrung}${PLATZHALTER_BILD}${anfuehrung}`
    const daten = `data-beneos-src=${anfuehrung}${frei}${anfuehrung}`
    let ergebnis = tag.replace(attribut, neuesSrc)
    if (DATA_RE.test(ergebnis)) return ergebnis.replace(DATA_RE, daten)
    // Direkt hinter dem neuen `src`, damit beide zusammen lesbar bleiben.
    return ergebnis.replace(neuesSrc, `${neuesSrc} ${daten}`)
  })
  for (const tag of html.match(ANDERE_RE) ?? []) {
    const src = SRC_RE.exec(tag)
    if (src && schluesselfreiAdresse(src[2]) !== src[2]) andere++
  }
  return { html: zahl ? neu : html, zahl, andere }
}

/**
 * Die Bildadresse einer Journalseite (`pages[].src`), nur bei Seiten vom Typ
 * `image`. Video- und PDF-Seiten gehen nie ueber den Blob-Weg und laden ihre
 * Adresse direkt; eine schluesselfreie Form zeigte dort nichts.
 *
 * @returns {string|undefined} die neue Adresse, oder undefined ohne Aenderung
 */
export function seitenSrc(typ, src) {
  if (typ !== "image" || typeof src !== "string" || !streamKey()) return undefined
  const frei = schluesselfreiAdresse(src)
  return frei === src ? undefined : frei
}

/**
 * Wandelt alle HTML-Strings eines Wertes AN ORT UND STELLE, tief ueber Objekte
 * und Listen. Deckt damit jedes HTML-Feld ohne Feldliste ab, auch flache
 * Pfade wie `{"text.content": "..."}` aus einem Update.
 *
 * @returns {number} wie viele Adressen gewandelt wurden
 */
export function htmlTiefSchluesselfrei(wert, _tiefe = 0) {
  if (_tiefe > 40 || !wert || typeof wert !== "object") return 0
  let zahl = 0
  for (const k of Object.keys(wert)) {
    const v = wert[k]
    if (typeof v === "string") {
      if (!kandidat(v)) continue
      const r = htmlSchluesselfrei(v)
      if (r.zahl) { wert[k] = r.html; zahl += r.zahl }
    } else if (v && typeof v === "object") {
      zahl += htmlTiefSchluesselfrei(v, _tiefe + 1)
    }
  }
  return zahl
}

/**
 * Die kleinste Aenderung, die einen Quellwert schluesselfrei macht, fuer
 * `updateSource` oder `update`. Der Quellwert selbst bleibt unberuehrt.
 *
 * Listen aus Elementen mit eindeutiger `_id` (eingebettete Dokumente) gehen als
 * Teilaenderungen `{_id, ...}` hinaus, nur die geaenderten. Eine andere Liste
 * geht ganz hinaus, als Kopie mit den gewandelten Werten. Dieselbe Regel wie
 * beim Anlegen in `stream-leinwand.mjs`.
 *
 * Eine Seite (`type` und `src` im selben Objekt) bekommt dazu `seitenSrc`.
 *
 * @returns {{aenderung: object|null, zahl: number}}
 */
export function htmlAenderung(quelle) {
  const zaehler = { zahl: 0 }
  const d = differenz(quelle, zaehler, 0)
  return { aenderung: d === undefined ? null : d, zahl: zaehler.zahl }
}

function differenz(wert, zaehler, tiefe) {
  if (tiefe > 40) return undefined
  if (typeof wert === "string") {
    if (!kandidat(wert)) return undefined
    const r = htmlSchluesselfrei(wert)
    if (!r.zahl) return undefined
    zaehler.zahl += r.zahl
    return r.html
  }
  if (Array.isArray(wert)) {
    const teile = wert.map((e) => differenz(e, zaehler, tiefe + 1))
    if (teile.every((t) => t === undefined)) return undefined
    const ids = wert.map((e) => e?._id)
    const eindeutig = ids.length > 0 && ids.every((id) => typeof id === "string" && id) && new Set(ids).size === ids.length
    if (eindeutig) return teile.flatMap((t, i) => (t === undefined ? [] : [{ ...t, _id: ids[i] }]))
    return wert.map((e, i) => (teile[i] === undefined ? kopie(e) : (isObj(e) ? zusammen(kopie(e), teile[i]) : teile[i])))
  }
  if (isObj(wert)) {
    const aus = {}
    for (const [k, v] of Object.entries(wert)) {
      const t = differenz(v, zaehler, tiefe + 1)
      if (t !== undefined) aus[k] = t
    }
    const src = seitenSrc(wert.type, wert.src)
    if (src !== undefined) { aus.src = src; zaehler.zahl++ }
    return Object.keys(aus).length ? aus : undefined
  }
  return undefined
}

function isObj(w) { return !!w && typeof w === "object" && !Array.isArray(w) }
function kopie(w) { return w && typeof w === "object" ? JSON.parse(JSON.stringify(w)) : w }
function zusammen(ziel, teil) {
  for (const [k, v] of Object.entries(teil)) {
    ziel[k] = isObj(v) && isObj(ziel[k]) ? zusammen(ziel[k], v) : v
  }
  return ziel
}

/**
 * Die Arten, deren HTML das Schreibnetz und der Altseiten-Lauf pruefen: jede
 * Art mit HTML-Feldern, die der Installer schreibt, dazu der Chat als
 * Vorsorge (Bestand 0). Eingebettete Seiten, Gegenstaende und Effekte laufen
 * ueber ihr Elterndokument mit.
 */
export const HTML_ARTEN = Object.freeze(["JournalEntry", "JournalEntryPage", "Actor", "Item", "ChatMessage", "RollTable", "Cards"])

/**
 * Das Schreibnetz fuer HTML (Messung M5 vom 17.11.2026 war rot: eine
 * eingefuegte Toradresse mit Schluessel stand nach dem Speichern so auf der
 * Platte). Jede Schluessel-Toradresse in HTML wird beim Schreiben in Form (a)
 * gewandelt, auch wenn der Editor sie liefert.
 *
 * Gleiches Muster wie das Netz in `stream-leinwand.mjs`: beim Update an Ort und
 * Stelle im Aenderungsobjekt, beim Anlegen ueber `updateSource`, ohne
 * Schluessel ein Fruehausstieg, und ein Fehler haelt das Speichern nie auf.
 * Eigene Funktion statt Eintraege in `SCHREIB_FELDER`: jenes Netz arbeitet mit
 * Feldlisten und verlangt je Art einen Eintrag in `LEINWAND_FELDER`; ein
 * Eintrag ohne diesen warf im `init` (Kalt-Review des Plans, 17.11.2026).
 *
 * Unbedingt eingebaut, am Schluessel geprueft, wie die Leinwand.
 */
let netzGesetzt = false
export function installHtmlNetz() {
  if (netzGesetzt) return
  netzGesetzt = true
  for (const art of HTML_ARTEN) {
    Hooks.on(`preUpdate${art}`, (doc, aenderung) => {
      if (!streamKey()) return
      try { htmlTiefSchluesselfrei(aenderung) } catch (_) { /* das Speichern geht vor */ }
      try { seitenImUpdate(art, doc, aenderung) } catch (_) { /* das Speichern geht vor */ }
    })
    Hooks.on(`preCreate${art}`, (doc) => {
      if (!streamKey()) return
      try {
        const { aenderung } = htmlAenderung(doc?._source)
        if (aenderung) doc.updateSource(aenderung)
      } catch (_) { /* das Anlegen geht vor */ }
    })
  }
}

/**
 * `src` einer Bildseite im Update. Der Typ steht im Update nur, wenn er sich
 * aendert; sonst gilt der des Dokuments bzw. der eingebetteten Seite.
 */
function seitenImUpdate(art, doc, aenderung) {
  if (art === "JournalEntryPage") {
    const typ = aenderung.type ?? doc?.type
    const neu = seitenSrc(typ, aenderung.src)
    if (neu !== undefined) aenderung.src = neu
    return
  }
  if (art === "JournalEntry" && Array.isArray(aenderung.pages)) {
    for (const seite of aenderung.pages) {
      if (!isObj(seite)) continue
      const typ = seite.type ?? doc?.pages?.get?.(seite._id)?.type
      const neu = seitenSrc(typ, seite.src)
      if (neu !== undefined) seite.src = neu
    }
  }
}

/**
 * Altseiten beim Start (Entscheid E4): stellt Dokumente um, die vor stre-T-116
 * eine Toradresse mit Schluessel ins HTML bekommen haben.
 *
 * Nur fuer den GM und nur mit Schluessel. Schreibt je Dokument nur die
 * geaenderten Felder, eingebettete Dokumente gebuendelt ueber
 * `updateEmbeddedDocuments`. Nach dem ersten Lauf findet er nichts mehr und
 * kostet einen Durchlauf ueber die Sammlungen.
 *
 * Nur die Weltsammlungen, keine Kompendien.
 *
 * @param {{trocken?: boolean}} optionen trocken: nur zaehlen, nichts schreiben
 * @returns {Promise<{dokumente:number, adressen:number, fehler:number, trocken:boolean}>}
 */
export async function altseitenUmstellen({ trocken = false } = {}) {
  const bericht = { dokumente: 0, adressen: 0, fehler: 0, trocken }
  if (!streamKey() || !globalThis.game?.user?.isGM) return bericht
  const g = globalThis.game
  for (const sammlung of [g.journal, g.actors, g.items, g.tables, g.cards, g.messages]) {
    for (const doc of sammlung ?? []) {
      try {
        const quelle = doc.toObject()
        const eingebettet = doc.constructor?.metadata?.embedded ?? {}
        const eigen = { ...quelle }
        for (const feld of Object.values(eingebettet)) delete eigen[feld]
        const { aenderung, zahl } = htmlAenderung(eigen)
        const kinder = []
        let kinderZahl = 0
        for (const [klasse, feld] of Object.entries(eingebettet)) {
          const liste = Array.isArray(quelle[feld]) ? quelle[feld] : []
          const r = htmlAenderung(liste)
          if (!r.aenderung) continue
          kinderZahl += r.zahl
          kinder.push([klasse, r.aenderung])
        }
        if (!aenderung && !kinder.length) continue
        bericht.dokumente++
        bericht.adressen += zahl + kinderZahl
        if (trocken) continue
        if (aenderung) await doc.update(aenderung)
        for (const [klasse, teile] of kinder) await doc.updateEmbeddedDocuments(klasse, teile)
      } catch (_) {
        bericht.fehler++
      }
    }
  }
  console.log(`Beneos Stream | Altseiten${trocken ? " (trocken)" : ""}: ${bericht.dokumente} Dokumente, `
    + `${bericht.adressen} Adressen, ${bericht.fehler} Fehler`)
  return bericht
}
