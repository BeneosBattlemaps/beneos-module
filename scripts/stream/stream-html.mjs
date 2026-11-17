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

/**
 * Das `src` der Form (a): der Platzhalter, dahinter die schluesselfreie Adresse
 * als Fragment.
 *
 * WARUM DAS FRAGMENT. Zwei Editorwege bauen den Bildknoten neu und werfen
 * dabei die erhaltenen Attribute weg, `data-beneos-src` eingeschlossen: der
 * Bilddialog (`_insertImagePrompt`, v13 und v14) und das verlinkte Bild
 * (`image_link`, v13). Uebrig bleibt nur das `src`. Ein fuer alle Bilder
 * gleicher Platzhalter koennte danach nicht mehr sagen, welches Bild gemeint
 * war; mit dem Fragment setzt das Schreibnetz das Attribut beim Speichern
 * zurueck (Kalt-Review 17.11.2026, kritisch). Das Aussehen aendert das
 * Fragment nicht, ein Fragment einer `data:`-Adresse laedt nichts.
 */
export function platzhalterMit(frei) {
  return `${PLATZHALTER_BILD}#${frei}`
}

/**
 * Die schluesselfreie Adresse eines Bildes in Form (a), oder null.
 *
 * `data-beneos-src` geht vor, das Fragment des Platzhalters ist der Rueckweg,
 * wenn ein Editorweg das Attribut verloren hat. Ein kopiertes Bild aus einer
 * Anzeige traegt ein `blob:` oder gar kein `src` mehr; dann zaehlt nur das
 * Attribut. Jedes andere `src` ist nicht Form (a), auch wenn ein Attribut
 * daneben steht: dann hat jemand das Bild bewusst getauscht.
 */
export function formAAdresse(src, daten) {
  const s = typeof src === "string" ? src : ""
  const d = typeof daten === "string" && daten.startsWith("beneos://") ? daten : null
  if (s.startsWith(PLATZHALTER_BILD)) {
    if (d) return d
    const rest = s.slice(PLATZHALTER_BILD.length)
    return rest.startsWith("#beneos://") ? rest.slice(1) : null
  }
  if (!s || s.startsWith("blob:")) return d
  return null
}

// Ein ganzes Tag, Anfuehrungszeichen beachtet: ein `>` in einem Attributwert
// beendet es nicht (Kalt-Review W2).
const IMG_RE = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
const ANDERE_RE = /<(?:video|source|audio)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
// Ein Attribut: Name, wahlweise mit Wert in doppelten, einfachen oder ohne
// Anfuehrungszeichen. Gelesen wird nach Namen, nie nach Teilzeichenkette;
// sonst traefe `src` auch `data-src` oder `data-beneos-src`.
const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** Die Attribute eines Tags, mit Lage im Tag und entschluesseltem Wert. */
function attribute(tag) {
  const liste = []
  const ende = tag.length - 1
  // Hinter dem Tagnamen beginnen, sonst zaehlte er als Attribut.
  ATTR_RE.lastIndex = /^<[a-z]+/i.exec(tag)?.[0].length ?? ende
  let m
  while ((m = ATTR_RE.exec(tag)) && m.index < ende) {
    const roh = m[2] ?? m[3] ?? m[4] ?? ""
    liste.push({
      name: m[1].toLowerCase(),
      anfang: m.index,
      ende: m.index + m[0].length,
      anfuehrung: m[2] !== undefined ? '"' : m[3] !== undefined ? "'" : "",
      wert: entschluesseln(roh),
    })
  }
  return liste
}

const BENANNT = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" }
/** HTML-Entitaeten eines Attributwertes (Kalt-Review W3). */
function entschluesseln(s) {
  if (!s.includes("&")) return s
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt));/gi, (ganz, dez, hex, name) => {
    if (name) return BENANNT[name.toLowerCase()]
    const code = dez ? Number(dez) : parseInt(hex, 16)
    try { return String.fromCodePoint(code) } catch (_) { return ganz }
  })
}

/** Ein Attribut zum Schreiben, mit der Anfuehrung des Bestandes. */
function attributText(name, wert, anfuehrung) {
  const a = anfuehrung || '"'
  let w = wert.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  w = a === '"' ? w.replace(/"/g, "&quot;") : w.replace(/'/g, "&#39;")
  return `${name}=${a}${w}${a}`
}

/** Traegt ein `srcset` eine Toradresse, die sich wandeln liesse? */
function srcsetMitTor(wert) {
  return wert.split(",").some((teil) => {
    const adresse = teil.trim().split(/\s+/)[0]
    return !!adresse && schluesselfreiAdresse(adresse) !== adresse
  })
}

/**
 * Lohnt das Zerlegen? Haelt es von den gewoehnlichen Feldwerten fern, die nie
 * HTML mit einer Toradresse oder mit Form (a) sind.
 */
function kandidat(text) {
  // `src` ohne Ruecksicht auf Gross- und Kleinschreibung: `<IMG SRC=...>` ist
  // gueltiges HTML.
  if (typeof text !== "string" || !text.includes("<") || !/src/i.test(text)) return false
  const host = streamHost()
  return (!!host && text.includes(host)) || text.includes("data-beneos-src") || text.includes(PLATZHALTER_BILD)
}

/**
 * Ein Bild-Tag in Form (a). Rueckgabe ohne Aenderung, wenn nichts zu tun ist.
 *
 * Zwei Faelle: eine Toradresse mit Schluessel wird gewandelt; ein Bild, das
 * schon Form (a) ist, aber ein Editorweg beschaedigt hat, wird geheilt (Attribut
 * aus dem Fragment, Platzhalter statt `blob:` oder fehlendem `src`).
 */
function bildTag(tag) {
  const attr = attribute(tag)
  const src = attr.find((a) => a.name === "src")
  const daten = attr.find((a) => a.name === "data-beneos-src")
  let frei = null
  let geheilt = false
  // Wo eine Toradresse mit Schluessel stehen kann: im `src`, im Fragment eines
  // Platzhalters, in `data-beneos-src`. Jede davon wird frei; im Fragment und
  // im Attribut steht danach nie Schluessel oder Toradresse (Bedingung orch,
  // P-12:54:43), auch wenn jemand eine solche Form einfuegt.
  const fragment = src?.wert.startsWith(`${PLATZHALTER_BILD}#`) ? src.wert.slice(PLATZHALTER_BILD.length + 1) : null
  for (const adresse of [src?.wert, fragment, daten?.wert]) {
    if (frei || !adresse) continue
    const f = schluesselfreiAdresse(adresse)
    if (f !== adresse) frei = f
  }
  // Die uebrigen Attribute, unabhaengig vom src. Ein `srcset` mit Toradresse
  // zoege der Browser dem `src` vor, und der Schluessel bliebe im HTML; es
  // faellt weg (Kalt-Review W2). Jedes andere Attribut mit Toradresse, etwa
  // `data-src`, bekommt die freie Form (Nachpruefung 17.11.2026, Befund 4).
  const weitere = []
  for (const a of attr) {
    if (a.name === "src" || a.name === "data-beneos-src" || !a.wert) continue
    if (a.name === "srcset") {
      if (!srcsetMitTor(a.wert)) continue
      let anfang = a.anfang
      while (anfang > 0 && /\s/.test(tag[anfang - 1])) anfang--
      weitere.push([anfang, a.ende, ""])
      continue
    }
    const f = schluesselfreiAdresse(a.wert)
    if (f !== a.wert) weitere.push([a.anfang, a.ende, attributText(a.name, f, a.anfuehrung || '"')])
  }
  if (!frei) {
    frei = formAAdresse(src?.wert ?? null, daten?.wert ?? null)
    const schonFormA = !!frei && src?.wert === platzhalterMit(frei) && daten?.wert === frei
    if (!frei || schonFormA) {
      return weitere.length ? { tag: ersetze(tag, weitere), zahl: 1, heil: 0 } : { tag, zahl: 0, heil: 0 }
    }
    geheilt = true
  }
  const anfuehrung = src?.anfuehrung || daten?.anfuehrung || '"'
  const srcText = attributText("src", platzhalterMit(frei), anfuehrung)
  const datenText = attributText("data-beneos-src", frei, daten?.anfuehrung || anfuehrung)
  const tausch = [...weitere]
  if (daten) tausch.push([daten.anfang, daten.ende, datenText])
  if (src) tausch.push([src.anfang, src.ende, daten ? srcText : `${srcText} ${datenText}`])
  else tausch.push([4, 4, ` ${srcText}`])
  return { tag: ersetze(tag, tausch), zahl: 1, heil: geheilt ? 1 : 0 }
}

/*
 * Ersetzungen nach Lage im Tag, von hinten, damit die Lagen davor gelten. Bei
 * gleichem Anfang zuerst das laengere Stueck: ein Einfuegen an Stelle 4 und
 * ein Entfernen ab Stelle 4 zerschnitten sonst das Tag (Nachpruefung
 * 17.11.2026, Befund 2).
 */
function ersetze(tag, tausch) {
  let neu = tag
  for (const [anfang, ende, text] of [...tausch].sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
    neu = neu.slice(0, anfang) + text + neu.slice(ende)
  }
  return neu
}

/**
 * Auflage 1 (orch P-13:25): der Schreiblauf ueber Altseiten darf nachweislich
 * nur Bildadressen aendern. Wahr nur, wenn der Text nach der Wandlung bis auf
 * `src` und `data-beneos-src` der Bilder zeichengleich ist, jedes gewandelte
 * Bild die freie Form traegt und `src` deren Platzhalter ist.
 *
 * Bewusst unabhaengig vom Wandler geprueft: ein Fehler dort, der ein Zeichen
 * ausserhalb dieser beiden Werte aendert, wird hier abgelehnt, auch ein
 * entferntes `srcset` oder ein geaendertes `data-src`.
 */
export function nurBildadressenGetauscht(alt, neu) {
  if (typeof alt !== "string" || typeof neu !== "string") return false
  const ohneAdressen = (html) => html.replace(IMG_RE, (tag) => {
    let t = tag
    const weg = attribute(tag).filter((a) => a.name === "src" || a.name === "data-beneos-src")
    // Genau ein Trennzeichen davor geht mit, so wie der Wandler es setzt.
    // Mehr zu nehmen verdeckte ein zusaetzliches Leerzeichen im Tag.
    for (const a of weg.sort((x, y) => y.anfang - x.anfang)) {
      const anfang = a.anfang > 0 && /\s/.test(t[a.anfang - 1]) ? a.anfang - 1 : a.anfang
      t = t.slice(0, anfang) + t.slice(a.ende)
    }
    return t
  })
  if (ohneAdressen(alt) !== ohneAdressen(neu)) return false
  const host = streamHost()
  for (const tag of neu.match(IMG_RE) ?? []) {
    const attr = attribute(tag)
    const daten = attr.find((a) => a.name === "data-beneos-src")?.wert
    if (daten === undefined) continue
    if (!daten.startsWith("beneos://") || (host && daten.includes(host)) || schluesselfreiAdresse(daten) !== daten) return false
    if (attr.find((a) => a.name === "src")?.wert !== platzhalterMit(daten)) return false
  }
  return true
}

/**
 * Wandelt jede Bild-Toradresse mit Schluessel in Form (a) und heilt
 * beschaedigte Form (a). Rein bis auf das Lesen der Einstellungen.
 *
 * Alle anderen Attribute bleiben zeichengleich, auch `width` und `height`.
 * Eine fremde Adresse oder eine Adresse unter fremder Basis laesst
 * `schluesselfreiAdresse` stehen, und damit bleibt das Tag bytegleich.
 *
 * `<video>`, `<audio>` und `<source>` werden nicht gewandelt: ein Bild als
 * Platzhalter spielte dort nicht, und keines davon geht ueber den Blob-Weg.
 * Gefundene werden in `andere` gezaehlt (Bestand am 17.11.2026: 0). Ein
 * anderes Attribut eines Bildes mit Toradresse, etwa `data-src`, wird frei.
 *
 * @returns {{html: string, zahl: number, heil: number, andere: number}}
 *   zahl: geaenderte Bilder, heil: davon geheilte
 */
export function htmlSchluesselfrei(html) {
  if (!streamKey() || !kandidat(html)) return { html, zahl: 0, heil: 0, andere: 0 }
  let zahl = 0
  let heil = 0
  let andere = 0
  const neu = html.replace(IMG_RE, (tag) => {
    const r = bildTag(tag)
    zahl += r.zahl
    heil += r.heil
    return r.tag
  })
  for (const tag of html.match(ANDERE_RE) ?? []) {
    const src = attribute(tag).find((a) => a.name === "src")
    if (src && schluesselfreiAdresse(src.wert) !== src.wert) andere++
  }
  return { html: zahl ? neu : html, zahl, heil, andere }
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
export function htmlAenderung(quelle, { streng = false } = {}) {
  const zaehler = { zahl: 0, streng, abweichung: false }
  const d = differenz(quelle, zaehler, 0, true)
  return { aenderung: d === undefined ? null : d, zahl: zaehler.zahl, abweichung: zaehler.abweichung }
}

/*
 * `dokument`: der Wert ist ein Dokument (die Wurzel, oder ein Element einer
 * eingebetteten Sammlung) bzw. eine Liste direkt an einem Dokument.
 *
 * Teilaenderungen nach `_id` gibt es NUR fuer Listen direkt an einem Dokument,
 * denn nur dort stehen Foundrys eingebettete Sammlungen (`pages`, `items`,
 * `effects`, `results`, `cards`), die nach `_id` zusammenfuehren. Eine Liste
 * mit `_id` tiefer, etwa `system.advancement`, ist ein gewoehnliches Feld; ein
 * Teil davon ersetzte die ganze Liste (Kalt-Review W5).
 *
 * `seite`: der Wert ist ein Dokument oder ein Element einer Liste direkt an
 * einem Dokument; nur dort gilt `type` mit `src` als Seite. Das ist eine
 * eigene Rolle neben `dokument`: eine Bildseite in einem neuen Journal hat noch
 * keine `_id`, ihre Liste geht ganz hinaus, und sie ist trotzdem eine Seite
 * (Nachpruefung 17.11.2026, Befund 1).
 */
function differenz(wert, zaehler, tiefe, dokument, seite = dokument) {
  if (tiefe > 40) return undefined
  if (typeof wert === "string") {
    if (!kandidat(wert)) return undefined
    const r = htmlSchluesselfrei(wert)
    if (!r.zahl) return undefined
    if (zaehler.streng && !nurBildadressenGetauscht(wert, r.html)) zaehler.abweichung = true
    zaehler.zahl += r.zahl
    return r.html
  }
  if (Array.isArray(wert)) {
    const ids = wert.map((e) => e?._id)
    const eindeutig = dokument && ids.length > 0 && ids.every((id) => typeof id === "string" && id) && new Set(ids).size === ids.length
    // Nur die Elemente einer eingebetteten Sammlung sind Dokumente. Eine Liste,
    // die ganz hinausgeht, geht auch darunter ganz.
    const teile = wert.map((e) => differenz(e, zaehler, tiefe + 1, eindeutig, dokument))
    if (teile.every((t) => t === undefined)) return undefined
    if (eindeutig) return teile.flatMap((t, i) => (t === undefined ? [] : [{ ...t, _id: ids[i] }]))
    return wert.map((e, i) => (teile[i] === undefined ? kopie(e) : (isObj(e) ? zusammen(kopie(e), teile[i]) : teile[i])))
  }
  if (isObj(wert)) {
    const aus = {}
    for (const [k, v] of Object.entries(wert)) {
      const t = differenz(v, zaehler, tiefe + 1, dokument && Array.isArray(v))
      if (t !== undefined) aus[k] = t
    }
    if (seite) {
      const src = seitenSrc(wert.type, wert.src)
      if (src !== undefined) { aus.src = src; zaehler.zahl++ }
    }
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
 * Vorsorge (Bestand 0). Eingebettete Dokumente feuern beim eigenen Anlegen und
 * Aendern ihre eigenen Haken; deshalb stehen Tabellenergebnisse, Karten und
 * Effekte mit HTML-Feldern hier selbst (Kalt-Review W4). Der Altseiten-Lauf
 * nimmt sie ueber ihr Elterndokument mit.
 */
export const HTML_ARTEN = Object.freeze(["JournalEntry", "JournalEntryPage", "Actor", "Item", "ChatMessage", "RollTable",
  "TableResult", "Cards", "Card", "ActiveEffect"])

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
        // Auflage 1 (orch P-13:25): je Dokument und je eingebetteter Seite
        // geprueft, ob nur Bildadressen getauscht wurden. Sonst wird dieser
        // Teil nicht geschrieben, als Fehler gezaehlt und mit Kennung gemeldet.
        const abgewiesen = (wo) => {
          bericht.fehler++
          console.warn(`Beneos Stream | Altseiten: ${doc.documentName ?? "Dokument"} ${doc.id ?? "?"}${wo}`
            + " nicht geschrieben, der Text wich ausser den Bildadressen ab")
        }
        let { aenderung, zahl, abweichung } = htmlAenderung(eigen, { streng: true })
        if (aenderung && abweichung) { abgewiesen(""); aenderung = null; zahl = 0 }
        const kinder = []
        let kinderZahl = 0
        for (const [klasse, feld] of Object.entries(eingebettet)) {
          const teile = []
          for (const kind of Array.isArray(quelle[feld]) ? quelle[feld] : []) {
            const r = htmlAenderung(kind, { streng: true })
            if (!r.aenderung) continue
            if (r.abweichung || !kind?._id) { abgewiesen(` ${klasse} ${kind?._id ?? "?"}`); continue }
            kinderZahl += r.zahl
            teile.push({ ...r.aenderung, _id: kind._id })
          }
          if (teile.length) kinder.push([klasse, teile])
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
