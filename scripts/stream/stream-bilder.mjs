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
 * **Keine Klappkarten, obwohl `OP-PRJ-136` sie nennt.** Sie erscheinen ueber
 * `openImagePopout()` und aus `system.description.value`; kein Haken unten deckt
 * sie. Heute kein Schaden, weil diese Karten oertlich liegen und `OP-PRJ-140`
 * offen ist. Sobald sie ans Tor gehen, gehoeren die Haken dazu.
 *
 * **Keine Bearbeitenflaeche**, siehe `imEditor()`.
 */

import { istPlatzhalter, assetUrl, streamEnabled, zerlegeAdresse } from "./stream-settings.mjs"
import { ours, sammelSchluessel } from "./stream-fetch.mjs"
import { reportFailure } from "./stream-report.mjs"

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
  const vorhanden = bildBlobs.get(adresse)
  if (vorhanden) return vorhanden.versprechen

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
    const abrufen = t ? assetUrl(t.release, t.variant, t.pfad) : adresse
    // Durch den ersetzten Abruf, und das ist der ganze Zweck: Vorrat,
    // Zwischenspeicher und Ersatzbild haengen dort. Eine Abweisung kommt als
    // gueltiges Ersatzbild zurueck und nicht als Fehler.
    const antwort = await fetch(abrufen)
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
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
  } catch (e) {
    // Der Eintrag muss weg, sonst merkt sich die Ablage einen Fehlschlag fuer
    // den Rest der Sitzung und ein spaeterer Versuch bekaeme ihn wieder.
    bildBlobs.delete(adresse)
    throw e
  }
  return eintrag.versprechen
}

/** Dieses Fenster laesst die genannten Adressen los. */
function loslassen(fenster, adressen) {
  for (const adresse of adressen) {
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
function zuTauschende(wurzel) {
  const elemente = []
  const schonGesetzt = new Set()
  let uebersprungen = 0
  for (const el of wurzel.querySelectorAll("img")) {
    const quelle = el.getAttribute("src")
    if (typeof quelle !== "string" || !quelle) continue
    if (quelle.startsWith("blob:")) {
      // Arbeit eines frueheren Durchlaufs, die noch sichtbar ist. Sie zaehlt als
      // weiter gehalten, sonst gibt dieser Durchlauf sie frei und das Bild im
      // offenen Fenster stirbt.
      const adresse = blobZuAdresse.get(quelle)
      if (adresse) schonGesetzt.add(adresse)
      continue
    }
    if (!istUnsere(quelle)) continue
    if (imEditor(el)) { uebersprungen++; continue }
    elemente.push({ el, adresse: quelle })
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
  if (!wurzel || !streamEnabled()) return leer
  // Ein Fenster im Bearbeitenmodus wird gar nicht angefasst. Riegel vor dem
  // Riegel: auch ein `<img>` ausserhalb der Editorflaeche kann beim Speichern in
  // den Dokumentzustand geraten, wenn ein Fremdmodul anders serialisiert.
  if (bearbeitet(fenster)) return { ...leer, imEditorFenster: true }

  const { elemente, schonGesetzt, uebersprungen } = zuTauschende(wurzel)
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

  await Promise.all(elemente.map(async ({ el, adresse }) => {
    try {
      const blobAdresse = await blobFuer(adresse)
      const eintrag = bildBlobs.get(adresse)
      // Zwischenzeitlich freigegeben, Fenster zu, oder Element nicht mehr im
      // Dokument: nichts eintragen und nichts setzen, sonst bliebe ein Halter
      // stehen, den kein Schliessen mehr findet.
      if (!eintrag || fenster?.rendered === false || !el.isConnected) {
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
]

/**
 * Ein Verzeichnis darf hier nie stehen, Begruendung im Kopf.
 *
 * Der Riegel steht als Riegel da, weil eine vierte Zeile in `FLAECHEN` keine
 * Funktion aendert und alle Pruefsaetze gruen liesse: `TC-PRJ-STR-246` misst das
 * Verzeichnis, an dem der Haken gestrichen wurde, nicht jedes.
 */
const VERBOTEN = /Directory|Sidebar|FilePicker/i

export function installStreamBilder() {
  for (const [renderHaken, schliessHaken] of FLAECHEN) {
    if (VERBOTEN.test(renderHaken) || VERBOTEN.test(schliessHaken)) {
      console.warn(`Beneos Stream | Haken ${renderHaken} abgewiesen: eine Liste holt je Zeile `
        + "ein volles Bild und hebt damit das Lazy-Loading von Foundry auf. Siehe OP-PRJ-177.")
      continue
    }
    Hooks.on(renderHaken, (app, element) => {
      const wurzel = wurzelVon(app, element)
      if (!wurzel) return
      beneosBildAusVorrat(wurzel, app).catch(() => { /* oben gemeldet */ })
    })
    Hooks.on(schliessHaken, (app) => { allesLoslassen(app) })
  }

  console.log("Beneos Stream | Bilder in Oberflaechen gehen ueber den Abrufweg")
}
