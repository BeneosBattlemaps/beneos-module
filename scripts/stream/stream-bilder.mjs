/**
 * EIN BILD IN EINER OBERFLAECHE GEHT DENSELBEN WEG WIE EINES AUF DER LEINWAND.
 *
 * Ein `<img>` beruehrt `window.fetch` **nie**. Der Ersatz in `stream-fetch.mjs`
 * sieht es also nicht, und damit greift fuer diese Flaechen nichts von dem, was
 * fuer die Leinwand selbstverstaendlich ist: kein Zwischenspeicher, kein
 * Offline-Vorrat, kein Ersatzbild. Eine Abweisung des Tores ist HTTP 200 mit
 * einem durchsichtigen GIF von 42 Byte, also ein **gueltiges** Bild: der Browser
 * zeichnet es, nichts meldet einen Fehler, und der Kunde sieht eine leere
 * Flaeche.
 *
 * Dieser Helfer holt die Bytes durch den ersetzten Abruf und setzt das Ergebnis
 * als `blob:`-Adresse ein. Damit kommen Vorrat und Ersatzbild aus derselben
 * Quelle wie bei PIXI, und jede weitere Bildflaeche ist eine Zeile statt eines
 * neuen Mechanismus.
 *
 * **Die Messungen vom 05.11.2026 stehen im Wiki**, unter "Ein Bild in einer
 * Oberflaeche, und warum es einen eigenen Weg braucht" in
 * `projekte/beneos-stream/technik.md`. Hier steht nur, was beim Lesen DIESER
 * Datei gebraucht wird.
 *
 * DREI EIGENHEITEN, die ein Nachbau sonst teuer lernt:
 *
 * 1. **Foundry feuert die ganze Klassenkette**, ein Haken auf den Grundnamen
 *    genuegt. Die Namen aus Fassung 12 feuern aber nicht, also stehen unten
 *    gemessene Namen und keine erinnerten.
 * 2. **Foundry ersetzt den Inhalt bei JEDEM Render** (`_replaceHTML`). Ein
 *    einmaliges Setzen waere falsch; der Renderhaken feuert genauso oft.
 * 3. **Ein zweiter Durchlauf erkennt die eigene Arbeit nicht wieder**, denn das
 *    Bild traegt danach eine `blob:`-Adresse. Dagegen steht `blobZuAdresse`.
 *
 * DIE FREIGABE IST DIE EIGENTLICHE ARBEIT, denn eine Blob-Adresse haelt ihre
 * Bytes, bis jemand sie ausdruecklich freigibt, und ein Journal-Handout ist im
 * Median 1844 kB gross. **Die Reihenfolge ist bindend: erst die neue setzen,
 * dann die alte freigeben**, sonst stirbt ein noch sichtbares Bild. Und die
 * Buchfuehrung muss rennfest sein, siehe `allesLoslassen()`.
 *
 * WAS DIESER HELFER NICHT LOEST: er ersetzt die Adresse in der **Anzeige**. Das
 * Dokument traegt sie danach unveraendert, mitsamt dem Streamschluessel im Pfad.
 * Fuer Zwischenspeicher, Vorrat und Ersatzbild genuegt das, fuer `OP-PRJ-149`
 * nicht. Die schluesselfreie Adresse im Dokument ist `OP-PRJ-179`.
 *
 * VIER GRENZEN SIND ABSICHT.
 *
 * **Kein `<video>`:** ein Blob fuer ein Video laedt die ganze Datei, bevor das
 * erste Bild erscheint. Video geht weiter direkt.
 *
 * **Keine Listen**, auch keine Verzeichnisse der Seitenleiste, und das ist der
 * teuerste Befund des 05.11.2026. Foundry setzt an jedem Listenbild
 * `loading="lazy"` und holt deshalb nur das Sichtbare, gemessen 686 von 686.
 * Dieser Helfer muss die Bytes dagegen SOFORT holen, ein Haken auf ein
 * Verzeichnis verwandelt also null Abrufe in so viele, wie die Liste Zeilen hat:
 * fuer die Szenenliste rund 609 MB gegen das Offline-Kontingent des Kunden, als
 * `OP-PRJ-177` gefuehrt. Darum weist `installStreamBilder()` einen
 * Verzeichnisnamen von sich aus ab.
 *
 * **Klappkarten gehen seit dem 08.11.2026 mit, und die Grenze davor ist
 * gefallen, nicht vergessen.** Sie stand hier, solange diese Karten oertlich
 * lagen; mit `OP-PRJ-140` liegen sie am Tor, also deckt `FLAECHEN` sie jetzt.
 * Die beiden Haken dafuer sind unten gemessen und nicht erinnert.
 *
 * **Keine Bearbeitenflaeche**, siehe `imEditor()`. Im Editor zeigt seit
 * stre-T-116 statt dessen die Knotenansicht `bildAnsicht` das echte Bild, nur
 * in ihrem eigenen DOM; das Dokument behaelt Form (a).
 */

import { istPlatzhalter, assetUrl, streamKey, streamMode, zerlegeAdresse, leinwandAdresse } from "./stream-settings.mjs"
import { ours, sammelSchluessel } from "./stream-fetch.mjs"
import { reportFailure } from "./stream-report.mjs"
import { isOffline } from "./stream-online.mjs"
import { formAAdresse, MEDIEN_PAARE, srcsetTeile, srcsetTausch } from "./stream-html.mjs"
import { maskiere } from "./stream-tormaske.mjs"

/**
 * Blob-Adressen je Toradresse. **Kein Vorrat**: das Wort ist im Bestand fuer das
 * dauerhaft gehaltene Offline-Kontingent belegt, was hier liegt stirbt mit der
 * Sitzung. Zwischengelegt wird das VERSPRECHEN und nicht das Ergebnis, sonst
 * stuenden bei zwanzig gleichen Bildern zwanzig Abrufe derselben Datei
 * nebeneinander. Dasselbe Muster traegt das Ersatzbild in `stream-fetch.mjs`.
 */
const bildBlobs = new Map()   // toradresse -> { versprechen, blob|null, halter:Set }

/** Welche Toradressen haelt dieses Fenster gerade? */
const jeFenster = new WeakMap()   // Anwendung -> Set<toradresse>

/** Rueckweg von der Blob-Adresse zur Toradresse. Siehe Eigenheit 3 im Kopf. */
const blobZuAdresse = new Map()

/** Einmal je Release und Variante melden, nicht je Datei. Siehe `melde()`. */
const gemeldet = new Set()

/** Wie oft ein fertiger Abruf nicht mehr eingesetzt werden konnte. */
let verworfen = 0

/**
 * Welche Inhaltstypen eingesetzt werden, als **abgeschlossene Liste**.
 *
 * Ein Praefixtest auf `image/` waere der naheliegende Riegel und der falsche:
 * `image/svg+xml` passiert ihn. Eine `blob:`-Adresse erbt den Ursprung ihres
 * Erzeugers, also den Foundry-Ursprung; am Tor lag dieselbe Datei auf einem
 * fremden Ursprung. In einem `<img>` fuehrt ein SVG kein Skript aus, ueber
 * "Bild in neuem Tab oeffnen" aber doch, und dann mit den Sitzungsdaten von
 * Foundry. Alles ausserhalb dieser Liste geht in den Fehlerzweig und bekommt
 * damit das Ersatzbild. Pruefbefund vom 05.11.2026.
 */
const BILDARTEN = /^image\/(webp|png|jpe?g|gif|avif)$/i

/**
 * Gehoert diese Adresse uns, und duerfen wir sie anfassen?
 *
 * **Der Host entscheidet, nicht die Pfadform.** `zerlegeAdresse()` prueft keinen
 * Ursprung; damit gaelte `https://fremd.example/a/egal/bm_0113/hd/x.webp` als
 * unsere, und ein Fremdmodul mit so einem `<img>` erzeugte einen Abruf auf den
 * Fremdhost samt Eintrag im Meldekanal.
 */
function istUnsere(adresse) {
  if (typeof adresse !== "string" || !adresse) return false
  if (adresse.startsWith("blob:") || adresse.startsWith("data:")) return false
  /*
   * BEI DER PLATZHALTERFORM ENTSCHEIDET DAS SCHEMA, und das ist kein
   * Nachlassen gegenueber dem Absatz darueber.
   *
   * `beneos://` kann niemand auf einen fremden Host zeigen lassen, denn ein
   * Host steht in dieser Form gar nicht. Er entsteht erst beim Abruf, in
   * `blobFuer`, aus `streamBase()`, und das ist die Erlaubnisliste aus
   * `OP-PRJ-176`. Ein Fremdmodul mit `beneos://c/x/y.webp` erzeugt damit einen
   * Abruf auf UNSER Tor, das ihn nach Recht beantwortet oder abweist; es kann
   * keinen Abruf auf einen Fremdhost erzeugen.
   *
   * Beim `https`-Zweig darunter ist das anders, denn dort steht der Host in
   * der Adresse und wird uebernommen. Deshalb bleibt `ours()` dort stehen.
   */
  if (istPlatzhalter(adresse)) return !!zerlegeAdresse(adresse)
  return ours(adresse) && !!zerlegeAdresse(adresse)
}

/** Steht dieses Element in einer Flaeche, die der Kunde bearbeitet? */
function imEditor(el) {
  return !!el.closest("[contenteditable], prose-mirror, .editor-content, .ProseMirror, .editor")
}

/**
 * Die DOM-Wurzel eines Fensters, egal welcher Anwendungsfassung.
 *
 * **`element?.[0] ?? element` ist falsch, und zwar still.** Ein
 * `ApplicationV2`-Blatt rendert als `<form>`, und ein `HTMLFormElement` ist mit
 * Zahlen ansprechbar: `element[0]` liefert dort das erste Formularfeld, im
 * Journalfenster einen `<button>`. Der Durchlauf sah dann null Bilder in einem
 * Fenster mit einem Bild und gab die Bilder des vorigen Renders frei. Die alte
 * jQuery-Fassung braucht `[0]` aber wirklich, also wird unterschieden.
 */
function wurzelVon(app, element) {
  for (const k of [element, app?.element]) {
    if (!k) continue
    if (k.nodeType === 1) return k
    if (k.jquery && k[0]?.nodeType === 1) return k[0]
  }
  return null
}

/** Ist dieses Fenster gerade im Bearbeitenmodus? */
function bearbeitet(fenster) {
  try {
    const el = wurzelVon(fenster, null)
    // Ein offener ProseMirror im eigenen Element ist der verlaessliche Zeuge:
    // `isEditable` sagt nur, dass bearbeitet werden DARF, nicht dass es laeuft.
    return !!el?.querySelector?.("prose-mirror[editable], .ProseMirror[contenteditable='true']")
  } catch (_) { return false }
}

/** Die Blob-Adresse zu einer Toradresse, geholt oder wiederverwendet. */
async function blobFuer(adresse) {
  let vorhanden = bildBlobs.get(adresse)
  // stre-T-222: ein Ersatzbild wegen fehlender Verbindung wird nicht
  // wiederverwendet, sonst stuende es bis F5 im Journal, obwohl Notice.Offline
  // "until it is back" verspricht. Der naechste Render holt frisch; die alte
  // Blob-Adresse bleibt fuer ihre Halter gueltig. Solange die Sitzung offline
  // ist, bleibt es beim Ersatz: ein neuer Abruf braechte nur ein neues.
  if (vorhanden?.ersatz && !isOffline()) {
    loese(adresse, vorhanden)
    vorhanden = null
  }
  if (vorhanden) return vorhanden.versprechen

  let ersatz = false
  const versprechen = (async () => {
    /*
     * ABGERUFEN WIRD DIE TORADRESSE VON HEUTE, nicht die aus dem Dokument.
     *
     * Ein Dokument traegt seit `OP-PRJ-137` die schluesselfreie Form
     * `beneos://<raum>/...`, und die ist mit Absicht nicht abrufbar. Hier wird
     * sie zerlegt und mit dem Schluessel dieses Augenblicks neu gebaut.
     *
     * DER UMBAU GILT FUER BEIDE FORMEN, und das ist die stillere Haelfte des
     * Gewinns: eine Adresse, die noch den ALTEN Schluessel traegt, weil sie
     * vor einer Rotation ins Dokument geschrieben wurde, wird dadurch
     * geheilt. Vorher waere sie am Tor abgewiesen worden, und die Abweisung
     * ist ein HTTP 200 mit einem durchsichtigen GIF, also ein stiller
     * Fehlschlag.
     *
     * Der SCHLUESSEL DER ABLAGE bleibt die Dokumentadresse. Deshalb ueberlebt
     * ein Eintrag eine Rotation, und deshalb erkennt ein zweiter Render die
     * eigene Arbeit wieder: `blobZuAdresse` traegt dieselbe Zeichenkette, die
     * im `src` stand.
     */
    const t = zerlegeAdresse(adresse)
    const abrufen = t ? assetUrl(t.release, t.variant, t.pfad, t.traeger) : adresse
    // Durch den ersetzten Abruf, und das ist der ganze Zweck: Vorrat,
    // Zwischenspeicher und Ersatzbild haengen dort. Eine Abweisung kommt als
    // gueltiges Ersatzbild zurueck und nicht als Fehler.
    // `beneosOberflaeche`: dieses Bild liegt nicht in PIXI, ein Ersatzbild
    // hier wird nicht zum Verwerfen in PIXI gemerkt (stre-T-222).
    const antwort = await fetch(abrufen, { beneosOberflaeche: true })
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
    ersatz = !!antwort.headers?.get?.("x-beneos-offline")
    const blob = await antwort.blob()
    if (!blob.size) throw new Error("leere Antwort")
    if (!BILDARTEN.test(blob.type)) throw new Error(`unerlaubte Bildart: ${blob.type || "ohne Typ"}`)
    const blobAdresse = URL.createObjectURL(blob)
    blobZuAdresse.set(blobAdresse, adresse)
    return blobAdresse
  })()

  const eintrag = { versprechen, blob: null, halter: new Set() }
  bildBlobs.set(adresse, eintrag)
  try {
    eintrag.blob = await versprechen
    eintrag.ersatz = ersatz
  } catch (e) {
    // Der Eintrag muss weg, sonst merkt sich die Ablage einen Fehlschlag fuer
    // den Rest der Sitzung und ein spaeterer Versuch bekaeme ihn wieder.
    bildBlobs.delete(adresse)
    throw e
  }
  return eintrag.versprechen
}

/** Widerruft die Blob-Adresse eines Eintrags, den niemand mehr haelt. */
function widerrufe(eintrag) {
  if (!eintrag.blob) return
  blobZuAdresse.delete(eintrag.blob)
  try { URL.revokeObjectURL(eintrag.blob) } catch (_) { /* schon weg */ }
}

/**
 * Abgeloeste Ersatzbild-Eintraege, stre-T-222. `blobFuer` ersetzt einen
 * Ersatz durch einen frischen Abruf unter derselben Adresse; der alte Eintrag
 * haelt noch Fenster, deren Blob-Adresse bis zum Loslassen gueltig bleiben
 * muss. Hier wird er weitergefuehrt, bis sein letzter Halter weg ist, sonst
 * widerriefe ihn nie jemand.
 */
const abgeloest = new Set()   // { adresse, blob, halter:Set }

/** Ein Ersatz wird abgeloest: sofort widerrufen oder bis zum Loslassen fuehren. */
function loese(adresse, eintrag) {
  bildBlobs.delete(adresse)
  if (!eintrag.halter.size) { widerrufe(eintrag); return }
  eintrag.adresse = adresse
  abgeloest.add(eintrag)
}

/** Dieses Fenster laesst die genannten Adressen los. */
function loslassen(fenster, adressen) {
  for (const adresse of adressen) {
    for (const alt of abgeloest) {
      if (alt.adresse !== adresse) continue
      alt.halter.delete(fenster)
      if (alt.halter.size) continue
      widerrufe(alt)
      abgeloest.delete(alt)
    }
    const eintrag = bildBlobs.get(adresse)
    if (!eintrag) continue
    eintrag.halter.delete(fenster)
    if (eintrag.halter.size) continue
    if (eintrag.blob) {
      blobZuAdresse.delete(eintrag.blob)
      try { URL.revokeObjectURL(eintrag.blob) } catch (_) { /* schon weg */ }
    }
    bildBlobs.delete(adresse)
  }
}

/**
 * Alles loslassen, was dieses Fenster irgendwo haelt.
 *
 * **Ueber die fuehrende Liste, nicht ueber die Merkliste je Fenster.** Wird ein
 * Fenster geschlossen, waehrend ein Abruf laeuft, ist seine Merkliste noch leer;
 * und bei zwei ueberlappenden Renders ueberschreibt der langsamere die
 * Merkliste, waehrend die Adresse des schnelleren als Halter stehen bleibt.
 * Dieser Weg findet beide.
 */
function allesLoslassen(fenster) {
  const betroffen = []
  for (const [adresse, eintrag] of bildBlobs) {
    if (eintrag.halter.has(fenster)) betroffen.push(adresse)
  }
  for (const alt of abgeloest) {
    if (alt.halter.has(fenster) && !betroffen.includes(alt.adresse)) betroffen.push(alt.adresse)
  }
  if (betroffen.length) loslassen(fenster, betroffen)
  jeFenster.delete(fenster)
  return betroffen.length
}

/**
 * Was haelt das Fenster nach diesem Render, und was ist loszulassen? Reine
 * Rechnung, ohne DOM und ohne Foundry, damit genau der Teil pruefbar ist, in dem
 * die beiden schweren Befunde der ersten Fassung sassen.
 */
export function naechsterStand(vorher, jetzt) {
  const vorherSet = vorher instanceof Set ? vorher : new Set(vorher || [])
  const jetztSet = jetzt instanceof Set ? jetzt : new Set(jetzt || [])
  return {
    halten: jetztSet,
    weg: [...vorherSet].filter(a => !jetztSet.has(a)),
  }
}

/**
 * Was in dieser Flaeche zu tauschen ist, und was dort schon getauscht ist.
 *
 * Die Adresse wird **einmal** gelesen und mitgegeben. Ein zweiter Lesezugriff
 * spaeter gilt nach der Lesbaren Pruefung als ungeprueft, auch wenn hier beide
 * im selben synchronen Durchlauf lagen.
 */
function zuTauschende(wurzel, nurFormA = false) {
  const elemente = []
  const schonGesetzt = new Set()
  let uebersprungen = 0
  for (const el of wurzel.querySelectorAll("img")) {
    const src = el.getAttribute("src")
    const daten = el.hasAttribute?.("data-beneos-src") ? el.getAttribute("data-beneos-src") : null
    if (typeof src === "string" && src.startsWith("blob:")) {
      // Arbeit eines frueheren Durchlaufs, die noch sichtbar ist. Sie zaehlt als
      // weiter gehalten, sonst gibt dieser Durchlauf sie frei und das Bild im
      // offenen Fenster stirbt.
      const adresse = blobZuAdresse.get(src)
      if (adresse) { schonGesetzt.add(adresse); continue }
      // Ein fremdes blob: mit Attribut ist ein kopiertes Bild aus einer
      // anderen Anzeige; getauscht wird es unten nach dem Attribut.
      if (!daten) continue
    }
    // FORM (a), stre-T-116: im HTML steht der Platzhalter in `src` und die
    // schluesselfreie Adresse in `data-beneos-src`, als Rueckweg auch im
    // Fragment des Platzhalters (`formAAdresse`). Getauscht wird dann diese.
    // Das Attribut bleibt am Element; einen zweiten Render erkennt
    // `blobZuAdresse` oben.
    const formA = formAAdresse(src, daten)
    if (!formA && (typeof src !== "string" || !src)) continue
    // Bei Modus aus nur Form (a) und `beneos://`, etwa das `src` einer
    // Bildseite (Kalt-Review W1): beides laedt der Browser nicht. Eine alte
    // Toradresse lud dort schon vor stre-T-116 direkt, und dabei bleibt es.
    if (nurFormA && !formA && !istPlatzhalter(src)) continue
    const quelle = formA ?? src
    if (!istUnsere(quelle)) continue
    if (imEditor(el)) { uebersprungen++; continue }
    // Ein Bild mit `data-edit` ist ein Formularfeld: Foundry liest beim Absenden
    // sein `src`. Getauscht ginge `blob:` hinaus, und das Speichern scheiterte
    // an der Dateiendung (gemessen 16.11.2026, v14Stream, Akteurblatt im
    // Bearbeitungsmodus). Den Schluessel nimmt das Schreibnetz in
    // `stream-leinwand.mjs` wieder heraus.
    if (el.hasAttribute?.("data-edit")) { uebersprungen++; continue }
    // `formA` heisst hier: die Adresse ist schluesselfrei und laedt nicht
    // direkt; der Fehlerzweig braucht dann die Toradresse.
    elemente.push({ el, adresse: quelle, formA: !!formA || istPlatzhalter(quelle) })
  }
  return { elemente, schonGesetzt, uebersprungen }
}

/**
 * Einmal je Release und Variante, nicht je Datei. Dieselbe Sammlung wie
 * `meldeAbweisung` in `stream-fetch.mjs`, und aus demselben
 * Grund: gesperrt ist nie eine einzelne Datei, und zwanzig gelbe Zeilen liest
 * ein Nutzer als zwanzig Fehler seines Moduls.
 */
function melde(adresse, grund) {
  const schluessel = sammelSchluessel(adresse)
  if (gemeldet.has(schluessel)) return
  gemeldet.add(schluessel)
  console.warn(`Beneos Stream | Bild einer Oberflaeche nicht ueber den Abrufweg zu holen, `
    + `die Adresse bleibt direkt stehen. ${schluessel}: ${grund}. `
    + "Weitere Dateien derselben Variante werden nicht mehr einzeln gemeldet.")
  // Die Rohadresse geht hinein, der Schluessel faellt in `reportFailure`.
  // Vorher stand hier eine eigene Umformung; seit dem 05.11.2026 raeumt der
  // Melder selbst, und zwar fuer alle Aufrufstellen zugleich.
  reportFailure({ url: adresse, reason: "ui-image", detail: String(grund).slice(0, 200) })
}

/**
 * Jedes `<img>` unter `wurzel`, dessen Adresse eine Beneos-Toradresse ist,
 * bekommt stattdessen eine Blob-Adresse.
 *
 * `fenster` ist die Anwendung, die das Element haelt. Sie wird gebraucht, um die
 * Blob-Adressen beim naechsten Render und beim Schliessen wieder loszulassen.
 */
export async function beneosBildAusVorrat(wurzel, fenster) {
  const leer = { angefasst: 0, fehlgeschlagen: 0, uebersprungen: 0, imEditorFenster: false }
  // AM SCHLUESSEL, NICHT AM MODUS (stre-T-116). Seit das HTML Form (a) traegt,
  // zeigt ohne diesen Tausch auch eine Welt mit Schluessel und Modus aus nur
  // den Platzhalter. Bei Modus aus wird nur Form (a) getauscht, der Abruf geht
  // dann ueber das gewoehnliche `fetch`, denn der fetch-Ersatz haengt am Modus.
  if (!wurzel || !streamKey()) return leer
  const nurFormA = !streamMode()
  // Ein Fenster im Bearbeitenmodus wird gar nicht angefasst. Riegel vor dem
  // Riegel: auch ein `<img>` ausserhalb der Editorflaeche kann beim Speichern in
  // den Dokumentzustand geraten, wenn ein Fremdmodul anders serialisiert.
  if (bearbeitet(fenster)) return { ...leer, imEditorFenster: true }

  const { elemente, schonGesetzt, uebersprungen } = zuTauschende(wurzel, nurFormA)
  if (!elemente.length && !schonGesetzt.size) {
    // Ein Render ohne ein einziges Beneos-Bild heisst, dass die Bilder des
    // vorigen Renders niemand mehr ansieht.
    allesLoslassen(fenster)
    return { ...leer, uebersprungen }
  }

  const vorher = jeFenster.get(fenster) || new Set()
  const jetzt = new Set(schonGesetzt)
  for (const adresse of schonGesetzt) bildBlobs.get(adresse)?.halter.add(fenster)
  let angefasst = 0
  let fehlgeschlagen = 0

  await Promise.all(elemente.map(async ({ el, adresse, formA }) => {
    try {
      const blobAdresse = await blobFuer(adresse)
      const eintrag = bildBlobs.get(adresse)
      // Zwischenzeitlich freigegeben, Fenster zu, oder Element nicht mehr im
      // Dokument: nichts eintragen und nichts setzen, sonst bliebe ein Halter
      // stehen, den kein Schliessen mehr findet.
      //
      // Der Chat ist die Ausnahme: sein Haken feuert auf ein Element, das
      // Foundry erst nach dem ganzen Stapel einfuegt (v13 chat-message.mjs
      // :415-419, chat.mjs:267-282). Halter ist dort die Nachricht, und
      // solange sie in `game.messages` steht, laesst `deleteChatMessage` los.
      if (!eintrag || fenster?.rendered === false || (!el.isConnected && !lebendeNachricht(fenster))) {
        verworfen++
        if (eintrag && !eintrag.halter.size) loslassen(fenster, [adresse])
        return
      }
      eintrag.halter.add(fenster)
      jetzt.add(adresse)
      el.setAttribute("src", blobAdresse)   // erst setzen, Freigabe folgt unten
      angefasst++
    } catch (e) {
      fehlgeschlagen++
      // Die Toradresse bleibt stehen. Sie laedt dann direkt, also ohne Vorrat
      // und ohne Ersatzbild, und das ist der Zustand von vorher; ein leeres
      // Element waere schlechter.
      //
      // `e?.message ?? String(e)`, weil ein Abbruch mit Zeichenkettengrund das
      // Versprechen mit genau dieser Zeichenkette ablehnt und nicht mit einem
      // Fehlerobjekt. Sonst waere die Zeitueberschreitung, also der haeufigste
      // Fall, der einzige ohne Ursache im Bericht.
      melde(adresse, e?.message ?? String(e))
      // Form (a) traegt in `src` nur den Platzhalter. Damit der Zustand von
      // vorher bleibt, bekommt die ANZEIGE die Toradresse, nie die Daten:
      // gespeichert wird aus dem Dokument, und im Editor tauscht dieser Weg
      // gar nicht (`imEditor`).
      if (formA) {
        const tor = leinwandAdresse(adresse)
        if (tor !== adresse) el.setAttribute("src", tor)
      }
    }
  }))

  const stand = naechsterStand(vorher, jetzt)
  if (stand.weg.length) loslassen(fenster, stand.weg)
  if (stand.halten.size) jeFenster.set(fenster, stand.halten)
  else jeFenster.delete(fenster)

  return { angefasst, fehlgeschlagen, uebersprungen, imEditorFenster: false }
}

/** Nur fuer Prueffaelle: was die Oberflaechen gerade halten. */
export function bilderBlobStand() {
  return {
    eintraege: bildBlobs.size,
    halter: [...bildBlobs.values()].reduce((n, e) => n + e.halter.size, 0),
    gemeldet: gemeldet.size,
    verworfen,
  }
}

/**
 * Haken auf die Flaechen, paarweise und gemessen.
 *
 * Alle sechs Namen sind am 05.11.2026 gegen Foundry 13.351 mit dnd5e 5.3.3
 * gemessen, Render- wie Schliessseite. Ein fehlender Schliesshaken heisst, dass
 * das Fenster seine Bytes bis zum Neuladen der Seite haelt.
 */
const FLAECHEN = [
  // Das Journalfenster, also der haeufigere Fall.
  ["renderJournalEntrySheet", "closeJournalEntrySheet"],
  // Ein einzeln geoeffnetes Seitenblatt, Bild wie Text.
  ["renderJournalEntryPageSheet", "closeJournalEntryPageSheet"],
  // Das Blatt einer Kreatur. `renderActorSheet` und `closeActorSheet` sind die
  // Namen aus Fassung 12 und bleiben stumm; diese beiden feuern, gemessen an
  // `NPCActorSheet`. Die Flaeche ist nicht Vorsorge: sechs Felder `Actor.img` in
  // der Pruefwelt tragen heute eine Toradresse.
  ["renderActorSheetV2", "closeActorSheetV2"],
  /*
   * Das Blatt eines Gegenstands oder Zaubers, also die Klappkarte aus
   * `system.description.value`. DER NAHELIEGENDE NAME FEUERT NICHT: gemessen
   * am 08.11.2026 in der Welt `v13-streaming` (Foundry 13, dnd5e 5.3.3) ist
   * die Klassenkette des Item-Blattes `ItemSheet5e`, `PrimarySheet5e`,
   * `DragDropApplication`, `DocumentSheet5e`, `BaseApplication5e`,
   * `HandlebarsApplication`, `DocumentSheetV2`, `ApplicationV2`. Darin steht
   * `ItemSheetV2` NICHT, obwohl der Kern die Klasse fuehrt, und
   * `sheet instanceof ItemSheetV2` ergibt `false`. Beim Actor ist es
   * umgekehrt, dort ergibt `instanceof ActorSheetV2` `true`, und genau diese
   * Asymmetrie laedt dazu ein, den Namen aus der Zeile darueber abzuleiten.
   * Die naechste gemeinsame Basis waere `DocumentSheetV2`, und die traegt
   * auch Actor und Journal: ein Haken darauf doppelte die beiden Zeilen
   * darueber. Also der Systemname, und er ist gemessen.
   */
  ["renderItemSheet5e", "closeItemSheet5e"],
  /*
   * Die gross aufgezogene Karte aus `openImagePopout()` in
   * `codex2/creature-codex.mjs`. Der Ruf baut eine Unterklasse
   * `BeneosImagePopout extends ImagePopout`; der Haken steht trotzdem auf dem
   * Grundnamen, weil Foundry die ganze Kette feuert, und damit deckt diese
   * eine Zeile auch jedes kuenftige Popout eines anderen Fensters.
   * Gemessen am 08.11.2026: `renderImagePopout` und `closeImagePopout`
   * feuern, die Kette ist `ImagePopout`, `HandlebarsApplication`,
   * `ApplicationV2`.
   */
  ["renderImagePopout", "closeImagePopout"],
  /*
   * Der Chat, stre-T-116 (Vorgabe 4 aus P-04:01:17). Bestand 0, also Vorsorge:
   * mit Form (a) zeigte eine Chatkarte mit Beneos-Bild sonst nur den
   * Platzhalter. `renderChatMessageHTML` feuert in v13 und v14, gemessen am
   * 17.11.2026 (Spur `ChatMessage5e`). Es gibt kein Fenster, das sich
   * schliesst; Halter ist die Nachricht, und losgelassen wird, wenn sie
   * geloescht wird. Kein Listenhaken: jede Karte zeigt ihr Bild voll.
   */
  ["renderChatMessageHTML", "deleteChatMessage"],
]

/** Eine Chatnachricht, die noch in der Welt steht. */
function lebendeNachricht(halter) {
  return halter?.documentName === "ChatMessage" && !!globalThis.game?.messages?.has?.(halter.id)
}

/**
 * Ein Verzeichnis darf hier nie stehen, Begruendung im Kopf.
 *
 * Der Riegel steht als Riegel da, weil eine vierte Zeile in `FLAECHEN` keine
 * Funktion aendert und alle Pruefsaetze gruen liesse: `TC-PRJ-STR-246` misst das
 * Verzeichnis, an dem der Haken gestrichen wurde, nicht jedes.
 */
const VERBOTEN = /Directory|Sidebar|FilePicker/i

/** Faellt ein Hakenpaar unter den Riegel? Der eine Ort, an dem er greift. */
function flaechenRiegel(renderHaken, schliessHaken) {
  return VERBOTEN.test(renderHaken) || VERBOTEN.test(schliessHaken)
}

/*
 * NAHT FUER `stream-bilder.test.mjs` (stre-T-017, Betreiberentscheid vom
 * 14.11.2026). `FLAECHEN` traegt heute kein Verzeichnis, also greift der
 * Riegel beim Einbau nie, und ohne diese Naht waere er nur als Quelltext
 * pruefbar. Der Satz ruft denselben Riegel, den `installStreamBilder` ruft.
 */
export const flaechenRiegelFuerPruefsatz = flaechenRiegel

/**
 * DER LINKKLICK (stre-T-142 B3). Foundry verwirft `href="beneos://..."` beim
 * Speichern (`ALLOWED_URL_SCHEMES`, v13 constants.mjs:1809, v14 :1923,
 * gemessen am 18.11.2026 in v13Stream). Das Textnetz in `stream-html.mjs`
 * schreibt deshalb die Maske mit `-` in `href` und die schluesselfreie
 * Adresse in `data-beneos-href`. Hier bekommt der Link den Schluessel von
 * heute, und zwar erst im Moment des Klicks: "Link-Adresse kopieren" liefert
 * weiter die Maske, und die oeffnet am Tor nichts.
 *
 * Gefangen werden der Linksklick und der Mittelklick. Der Rechtsklick bleibt
 * beim Kontextmenue, ein Link im Editor beim Editor. Ohne Schluessel, bei einer
 * Adresse, die nicht `beneos://` ist, oder einem Ziel ausserhalb des eigenen
 * Tores geschieht nichts, und der Browser folgt `href` wie bisher.
 *
 * @returns {boolean} ob der Klick uebernommen wurde
 */
function linkKlick(ereignis) {
  try {
    if (!ereignis || ereignis.defaultPrevented) return false
    const knopf = ereignis.button ?? 0
    if (ereignis.type === "click" ? knopf !== 0 : knopf !== 1) return false
    const a = ereignis.target?.closest?.("a[data-beneos-href]")
    if (!a || imEditor(a) || !streamKey()) return false
    const roh = a.getAttribute("data-beneos-href")
    if (!istPlatzhalter(roh)) return false
    const ziel = leinwandAdresse(roh)
    if (typeof ziel !== "string" || ziel === roh || !/^https:\/\//i.test(ziel) || !ours(ziel)) return false
    ereignis.preventDefault()
    ereignis.stopPropagation?.()
    globalThis.open?.(ziel, "_blank", "noopener")
    return true
  } catch (_) { return false }
}
let linkKlickAn = false

/**
 * Medien im HTML, stre-T-147: `<video>`, `<audio>` und `<source>` tragen im
 * Dokument die Maske in `src` und die freie Form in `data-beneos-src`.
 * Hier bekommt das ELEMENT die Toradresse mit dem heutigen Schluessel, direkt
 * und ohne Blob (siehe die Grenze fuer Videos im Kopf). Das Dokument bleibt
 * unberuehrt, denn gelesen wird nur aus dem DOM der Anzeige. `poster` geht
 * denselben Weg mit `data-beneos-poster`.
 *
 * Die Waechter von `linkKlick` gelten auch hier (Kalt-Review F4): nur eine
 * `beneos://`-Form, nur ein Ziel unter `https` am eigenen Tor, und nur, wenn
 * die Adresse noch leer oder die passende Maske ist. Eine bewusst getauschte
 * Adresse bleibt. Ein Anhang ab `?` oder `#` an der Maske geht mit (F2).
 *
 * @returns {number} wie viele Adressen neu gesetzt wurden
 */
export function medienAnzeigen(wurzel, fenster) {
  if (!wurzel?.querySelectorAll || !streamKey() || bearbeitet(fenster)) return 0
  let zahl = 0
  const auswahl = "video[data-beneos-src], audio[data-beneos-src], source[data-beneos-src], video[data-beneos-poster], source[data-beneos-srcset]"
  for (const el of wurzel.querySelectorAll(auswahl)) {
    if (imEditor(el)) continue
    let neuGeladen = false
    for (const [haupt, datenName] of MEDIEN_PAARE) {
      const roh = el.getAttribute(datenName)
      if (!istPlatzhalter(roh)) continue
      const ziel = leinwandAdresse(roh)
      if (typeof ziel !== "string" || ziel === roh || !/^https:\/\//i.test(ziel) || !ours(ziel)) continue
      const maske = maskiere(ziel)
      const jetzt = el.getAttribute(haupt) ?? ""
      const anhang = jetzt.startsWith(maske) ? jetzt.slice(maske.length) : null
      if (jetzt !== "" && (anhang === null || (anhang !== "" && !/^[?#]/.test(anhang)))) continue
      const rest = anhang ?? ""
      el.setAttribute(haupt, ziel + (rest.startsWith("?") && ziel.includes("?") ? `&${rest.slice(1)}` : rest))
      zahl++
      if (haupt === "src") neuGeladen = true
    }
    if (srcsetAnzeigen(el)) zahl++
    if (!neuGeladen) continue
    // Ein geaendertes `<source>` liest das Medium erst beim naechsten `load`.
    const medium = String(el.tagName).toLowerCase() === "source" ? el.parentElement : el
    try { medium?.load?.() } catch (_) { /* das Bild der Seite geht vor */ }
  }
  return zahl
}

/**
 * `srcset` eines Medientags, stre-T-148: aus `data-beneos-srcset` je Eintrag
 * die Toradresse mit Schluessel, nur im DOM. Dieselben Waechter wie fuer
 * `src`: jede freie Form muss ans eigene Tor unter `https` fuehren, sonst
 * bleibt die Maske ganz. Gesetzt wird nur, wenn `srcset` leer ist oder genau
 * die passende Maskenliste traegt; ein getauschtes `srcset` bleibt. Ein
 * `<picture>` waehlt danach von selbst neu, ein `load` braucht es nicht.
 */
function srcsetAnzeigen(el) {
  const roh = el.getAttribute("data-beneos-srcset") ?? ""
  const ziele = new Map()
  for (const f of srcsetTeile(roh)) {
    if (!/^beneos:/i.test(f.adresse)) continue
    if (!istPlatzhalter(f.adresse)) return false
    const ziel = leinwandAdresse(f.adresse)
    if (typeof ziel !== "string" || ziel === f.adresse || !/^https:\/\//i.test(ziel) || !ours(ziel)) return false
    ziele.set(f.adresse, ziel)
  }
  if (!ziele.size) return false
  // Leer gilt als die Maskenliste. Je Eintrag: dieselbe Adresse, oder die Maske
  // ihres Ziels mit hoechstens einem Anhang ? oder # (Nachpruefung 19.11.2026,
  // Befund 6); der Anhang geht an die Adresse mit Schluessel wie bei `src`.
  const jetzt = el.getAttribute("srcset") || srcsetTausch(roh, (a) => (ziele.has(a) ? maskiere(ziele.get(a)) : a))
  const frei = srcsetTeile(roh)
  const teile = srcsetTeile(jetzt)
  if (teile.length !== frei.length) return false
  const neu = []
  for (let i = 0; i < teile.length; i++) {
    if (teile[i].rest !== frei[i].rest) return false
    const ziel = ziele.get(frei[i].adresse)
    if (!ziel) {
      if (teile[i].adresse !== frei[i].adresse) return false
      neu.push(teile[i].adresse)
      continue
    }
    const maske = maskiere(ziel)
    const anhang = teile[i].adresse.startsWith(maske) ? teile[i].adresse.slice(maske.length) : null
    if (anhang === null || (anhang !== "" && !/^[?#]/.test(anhang))) return false
    neu.push(ziel + (anhang.startsWith("?") && ziel.includes("?") ? `&${anhang.slice(1)}` : anhang))
  }
  let mitSchluessel = jetzt
  for (let i = teile.length - 1; i >= 0; i--) mitSchluessel = mitSchluessel.slice(0, teile[i].anfang) + neu[i] + mitSchluessel.slice(teile[i].ende)
  if (mitSchluessel === jetzt) return false
  el.setAttribute("srcset", mitSchluessel)
  return true
}

export function installStreamBilder() {
  // Vor den Flaechen: ein Haken, den der Riegel abweist, darf den Klick nicht
  // mitnehmen. Nur einmal, auch bei zweitem Einbau.
  if (!linkKlickAn && typeof globalThis.document?.addEventListener === "function") {
    linkKlickAn = true
    for (const typ of ["click", "auxclick"]) globalThis.document.addEventListener(typ, linkKlick, true)
  }
  for (const [renderHaken, schliessHaken] of FLAECHEN) {
    if (flaechenRiegel(renderHaken, schliessHaken)) {
      console.warn(`Beneos Stream | Haken ${renderHaken} abgewiesen: eine Liste holt je Zeile `
        + "ein volles Bild und hebt damit das Lazy-Loading von Foundry auf. Siehe OP-PRJ-177.")
      continue
    }
    Hooks.on(renderHaken, (app, element) => {
      const wurzel = wurzelVon(app, element)
      if (!wurzel) return
      beneosBildAusVorrat(wurzel, app).catch(() => { /* oben gemeldet */ })
      try { medienAnzeigen(wurzel, app) } catch (_) { /* die Bilder gehen vor */ }
    })
    Hooks.on(schliessHaken, (app) => { allesLoslassen(app) })
  }

  // Der Editor, stre-T-116 (Entscheid E3, Vorgabe 2 aus P-04:01:17). Foundry
  // ruft diesen Haken vor dem Bau der Ansicht (v13 prosemirror-editor.mjs:220,
  // v14 :222), und die Ansicht sammelt `nodeViews` auch aus Plugins
  // (`buildNodeViews` ueber `someProp`). Ohne Schluessel kein Plugin.
  Hooks.on("createProseMirrorEditor", (_uuid, plugins) => {
    if (!streamKey()) return
    const Plugin = globalThis.ProseMirror?.Plugin
    if (typeof Plugin !== "function" || !plugins || typeof plugins !== "object") return
    plugins.beneosBildAnsicht = new Plugin({ props: { nodeViews: { image: (node) => bildAnsicht(node) } } })
  })

  console.log("Beneos Stream | Bilder in Oberflaechen gehen ueber den Abrufweg")
}

/**
 * Die Ansicht eines Bildknotens im Editor: das echte Bild in der ANZEIGE, das
 * Dokument behaelt Form (a).
 *
 * Gebaut wird das Element aus dem wirksamen `toDOM` des Knotens, nicht aus
 * `ImageNode.toDOM`: Foundry legt eine Huelle darum, die die erhaltenen
 * Attribute (`class`, `style`, `data-*`) einsetzt, und die unterscheidet sich
 * zwischen v13 und v14 (`attribute-capture.mjs:48-60`). Danach wird nur `src`
 * des Elements gesetzt.
 *
 * WARUM DIE TORADRESSE SO NIE INS DOKUMENT GELANGT. Gespeichert wird aus
 * `state.doc`, nicht aus dem DOM, und eine Attributaenderung an der Ansicht
 * liest ProseMirror wegen `ignoreMutation` nicht zurueck. Der Knoten wird nie
 * angefasst. Halter des Blobs ist die Ansicht; `destroy` laesst los.
 *
 * Scheitert der Abruf, bleibt im Editor der Platzhalter stehen; die CSS-Regel
 * auf `img[data-beneos-src]` haelt die Flaeche sichtbar.
 */
function bildAnsicht(node) {
  const { dom } = globalThis.ProseMirror.DOMSerializer.renderSpec(globalThis.document, node.type.spec.toDOM(node))
  const halter = { weg: false }
  // Nach dem Bilddialog fehlt das Attribut; die Adresse steht dann nur noch im
  // Fragment des Platzhalters.
  const adresse = formAAdresse(dom?.getAttribute?.("src"), dom?.getAttribute?.("data-beneos-src"))
  let gehalten = false
  if (adresse && streamKey() && istUnsere(adresse)) {
    blobFuer(adresse).then((blobAdresse) => {
      const eintrag = bildBlobs.get(adresse)
      if (!eintrag || halter.weg) {
        verworfen++
        if (eintrag && !eintrag.halter.size) loslassen(halter, [adresse])
        return
      }
      eintrag.halter.add(halter)
      gehalten = true
      dom.setAttribute("src", blobAdresse)
    }).catch((e) => { melde(adresse, e?.message ?? String(e)) })
  }
  return {
    dom,
    ignoreMutation: (m) => m?.type === "attributes",
    destroy() {
      halter.weg = true
      if (gehalten) loslassen(halter, [adresse])
    },
  }
}
