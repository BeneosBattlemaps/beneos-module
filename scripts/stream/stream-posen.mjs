/**
 * DIE POSENLISTE: WELCHE ANSICHTEN EINER KREATUR ES GIBT, UND WIE SIE HEISSEN.
 *
 * WARUM ES DIESE DATEI GIBT
 *
 * Drei Stellen im Modul fragten bis zum 05.11.2026 per HEAD, ob die Draufsicht
 * einer Variante auf der Platte liegt: die Leiste im Token-HUD bei JEDEM
 * Render, also bei jedem Token-Klick, dazu jede Variantenkachel im
 * Cloud-Fenster und jeder Wurf auf die Leinwand. Alle drei bauten den Namen
 * durch Textersatz zwischen `-token.webp` und `-top.webp`, und alle drei
 * fragten mit einem nackten `/pfad` ohne Route.
 *
 * Daraus folgten drei Fehler, die wie drei verschiedene aussehen und einer
 * sind:
 *
 *   Unterpfad oder The Forge  jede Draufsicht gilt als fehlend
 *   Streambetrieb             dito, denn auf der Platte liegt dann nichts
 *   jeder Klick               eine Anfrage, ohne Zwischenspeicher
 *
 * Im Streambetrieb ist der Stilwechsel damit nicht langsam, sondern lautlos
 * kaputt: der Knopf gilt als nicht verfuegbar, die Kachel wird als fehlend
 * markiert und loest beim Klick eine erzwungene Neuinstallation aus, und der
 * Wurf auf die Leinwand faellt still auf 2.5D zurueck.
 *
 * DIE REGEL, DIE DER BROWSER-CLIENT TEUER GELERNT HAT
 *
 * Niemals einen Dateinamen bilden, nur unter genannten Dateien waehlen. Eine
 * Abweisung am Tor ist HTTP 200 mit einem durchsichtigen GIF von 42 Byte, ein
 * geratener Name wird also zum stillen Fehler: leeres Bild, nirgends eine
 * Meldung.
 *
 * Deshalb antwortet diese Datei auf ZWEI Fragen und nicht nur auf eine. Die
 * Existenzfrage allein hat am 05.11.2026 die Pruefung nicht bestanden: wer nur
 * "ja" zurueckgibt, laesst den Aufrufer den Namen weiter raten, und genau das
 * sollte verschwinden.
 *
 *   ansichtGibtEs(pfad, stil)   darf die Oberflaeche den Wechsel anbieten
 *   ansichtSrc(pfad, stil)      welche Adresse wird dann GESCHRIEBEN
 *
 * `_posen.json` liegt je Kreatur im Spiegel und wird von dem geschrieben, der
 * die Dateien hochlaedt. Sie nennt je Variante beide Stile einzeln, mit Namen
 * und Masse, und eine fehlende Ansicht steht als `null` ausdruecklich DRIN:
 *
 *   {"release": "...", "kennung": "...",
 *    "tokenbilder": {"1": {"tokenized": {"pfad": "...", "breite": 1800,
 *                                        "hoehe": 1800},
 *                          "topdown": {...} oder null}},
 *    "statblock": "...", "journal": "..."}
 *
 * ZWEI QUELLEN, UND DIE ADRESSE WAEHLT, NICHT DIE EINSTELLUNG
 *
 * Das ist die Korrektur eines ersten Entwurfs vom 05.11.2026, die eine Messung
 * erzwungen hat. Der Entwurf fragte die Liste, sobald Streaming eingeschaltet
 * war, und das war falsch: eine Welt kann auf `download` stehen, waehrend
 * Streaming eingeschaltet ist. Dann sagt die Liste "die Draufsicht gibt es im
 * Spiegel", die Datei liegt aber nicht auf der Platte des Kunden, und der
 * Stilwechsel liefert ein leeres Feld.
 *
 * Deshalb entscheidet, wo die Datei WIRKLICH liegt, und das steht in der
 * Adresse, die das Dokument traegt:
 *
 *   Toradresse (`/c/...`)   die Posenliste entscheidet, nie die Platte
 *   oertlicher Pfad         die Platte entscheidet, nie die Liste
 *
 * Damit traegt auch der gemischte Zustand, den der Plan als Normalfall nennt:
 * in derselben Welt koennen gestreamte und oertliche Kreaturen nebeneinander
 * liegen, und jede wird an ihrer eigenen Quelle gemessen.
 *
 * DREI ANTWORTEN, NICHT ZWEI
 *
 * `true`, `false` und `null` fuer "nicht geprueft". Der dritte Wert ist keine
 * Feinheit, sondern verhindert zwei entgegengesetzte Schaeden:
 *
 *   auf The Forge liegen die Dateien hinter einem fremden Praefix. Eine Probe
 *   antwortet dort immer "fehlt", und die Kachel loest beim Klick eine
 *   erzwungene Neuinstallation aus. Also "nicht geprueft" statt "fehlt".
 *
 *   ein "nicht geprueft" darf aber auch nicht als "vorhanden" gelten, denn
 *   dann schreibt der Stilwechsel eine Textur, die es nicht gibt. Jeder
 *   Aufrufer entscheidet selbst, und `ansichtGibtEs()` ist bewusst streng.
 *
 * Dasselbe Muster fuehrt `headCheck()` im Watcher seit dem 12.08.2026 mit
 * `status: -2`, und diese Datei ruft es auf statt eine vierte Plattenprobe
 * danebenzustellen.
 */

import { assetUrl, KREATUR_PRAEFIX, streamKey, zerlegeAdresse } from "./stream-settings.mjs"
import { headCheck } from "../beneos-asset-watcher.js"
// Seit 2026-11-08 geteilt mit `stream-karten.mjs`. Die Begruendung steht im
// Kopf von `stream-merker.mjs`: zwei Kopien gehen nicht zugleich mit.
import { einmal, frisch, merken, ohneAbfrage } from "./stream-merker.mjs"

/**
 * Wie lange eine Antwort gilt.
 *
 * Beide Fristen sind kurz, und das ist die Korrektur einer ersten Fassung, die
 * einen Treffer eine halbe Stunde halten liess. Die Frist hing dort am
 * Vorhandensein der Liste und nicht am Ergebnis der Frage, und damit galt eine
 * Liste mit `"topdown": null` als Treffer: wird die Draufsicht nachgeliefert,
 * bliebe der Knopf eine halbe Stunde aus. Auf der Platte ist es umgekehrt die
 * Deinstallation, die die Datei durch einen Stummel ersetzt, ohne dass die
 * gemerkte Antwort davon erfaehrt.
 *
 * Fuenf Minuten und eine Minute kosten im schlimmsten Fall einen Abruf je
 * Kreatur und fuenf Minuten. Die Last, gegen die dieses Paket angetreten ist,
 * war eine Anfrage je KLICK, und die ist damit weg.
 */
const FRIST_LISTE_MS = 5 * 60 * 1000
const FRIST_PLATTE_MS = 60 * 1000

/**
 * Der Stummel, mit dem die Deinstallation ueberschreibt statt zu loeschen.
 * Er antwortet mit 200, also braucht es die Groesse und nicht nur den Status.
 */
const STUMMEL_MAX_BYTES = 8

const STILE = { tokenized: "tokenized", topdown: "topdown" }
const ENDUNG = { topdown: "-top.webp", tokenized: "-token.webp" }

/** release -> { stand, wert } ; `wert` ist die Liste, `null` heisst "keine". */
const listen = new Map()
/** pfad -> { stand, wert } ; Ergebnis der Plattenprobe, `null` heisst offen. */
const platte = new Map()
/**
 * Aus einem Bildpfad die Kreatur lesen.
 *
 * Bei einer Toradresse steht der Releasename IM PFAD, und dann wird er von
 * dort genommen und nicht aus dem Dateinamen gebildet. Das ist die Korrektur
 * eines ersten Entwurfs: `beneos_ct_` plus Teiltreffer ist dieselbe
 * Namensbildung, gegen die dieses Paket angetreten ist, nur eine Ebene hoeher.
 * Stimmte sie nicht, holte `posenliste()` eine Liste unter einem Namen, den es
 * nicht gibt, bekaeme "kein Recht" und antwortete "gibt es nicht".
 *
 * Variante und Stil kommen weiter aus dem Dateinamen, denn dort stehen sie.
 * Der Vertrag ist die Namensregel `<kennung>-<n>-<rolle>.webp`, und sie gilt
 * fuer den oertlichen Pfad wie fuer die Toradresse.
 *
 * Die Endung bleibt bewusst auf `.webp` begrenzt, obwohl `BeneosUtility` den
 * Stil mit `/-top\.[a-z0-9]+/` erkennt, also jede Endung zulaesst. Gemessen am
 * 05.11.2026 im Datenbaum dieser Instanz: 234 von 234 `*-token.webp` tragen
 * die Variantennummer, null Dateien mit anderer Endung. Eine weitere Endung
 * waere also heute kein Fall, sondern eine Vermutung.
 */
export function kreaturAusPfad(pfad) {
  const rein = ohneAbfrage(pfad)
  const name = rein.split("/").pop()
  const treffer = /^(.+)-(\d+)-(token|top)\.webp$/i.exec(name)
  if (!treffer) return null
  const tor = zerlegeAdresse(pfad)
  if (tor && tor.raum !== "kreatur") return null
  return {
    kennung: treffer[1],
    variante: treffer[2],
    stil: treffer[3].toLowerCase() === "top" ? STILE.topdown : STILE.tokenized,
    release: tor ? tor.release : `${KREATUR_PRAEFIX}${treffer[1]}`,
    ueberTor: !!tor,
  }
}

/**
 * Die Liste einer Kreatur, hoechstens einmal je Frist geholt.
 *
 * Ohne Streamschluessel gibt es am Tor nichts zu holen, denn er ist Teil der
 * Adresse. Aufgerufen wird die Funktion nur fuer Toradressen, siehe `ansicht`.
 */
export async function posenliste(release) {
  const schluessel = String(release || "")
  if (!schluessel.startsWith(KREATUR_PRAEFIX)) return null
  const da = listen.get(schluessel)
  if (frisch(da, FRIST_LISTE_MS)) return da.wert
  if (!streamKey()) return merken(listen, schluessel, null, FRIST_LISTE_MS)

  return await einmal(`liste:${schluessel}`, async () => {
    const nochmal = listen.get(schluessel)
    if (frisch(nochmal, FRIST_LISTE_MS)) return nochmal.wert
    let wert = null
    try {
      // Durch den gepatchten Abruf, mit Absicht: so gelten Vorrat, Frist,
      // Verbindungswaechter und Ersatzantwort auch fuer die Liste. Sie ist
      // eine gestreamte Datei wie jede andere.
      const antwort = await fetch(assetUrl(schluessel, "", "_posen.json"))
      if (antwort.ok && !antwort.headers.get("x-beneos-denied")
          && !antwort.headers.get("x-beneos-offline")) {
        const gelesen = await antwort.json()
        if (gelesen && typeof gelesen === "object" && gelesen.tokenbilder) wert = gelesen
      }
    } catch (_) {
      // Kein Netz, kein Recht, kaputtes JSON: alles derselbe Ausgang, naemlich
      // keine Liste. Der Aufrufer bekommt dann "nicht geprueft".
      wert = null
    }
    return merken(listen, schluessel, wert, FRIST_LISTE_MS)
  })
}

function aufDerForge() {
  return typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge === true
}

/**
 * Die Plattenprobe, und sie ist die vorhandene.
 *
 * `headCheck()` im Watcher traegt, was eine selbst geschriebene Probe
 * vergessen haette: Kodierung je Pfadsegment, damit ein `#` im Dateinamen kein
 * Fragment wird; einen Abbruchzeitgeber, damit eine haengende Antwort keinen
 * Platz belegt; und die Abweisung absoluter Adressen mit `status: -2`. Letztes
 * ist hier mehr als Ordnung: eine Toradresse als relativer Pfad verschickt
 * waere der Streamschluessel in der Anfragezeile des eigenen Servers, also im
 * Zugriffsprotokoll und in der Netzwerkansicht des Kunden.
 *
 * Ergaenzt wird nur der Stummel-Schutz. Die Deinstallation loescht nicht,
 * sondern ueberschreibt mit wenigen Bytes, und das antwortet mit 200.
 *
 * Auf The Forge wird nicht geprobt. Dort liegen die Dateien hinter einem
 * fremden Praefix, eine Probe meldete also jede Ansicht als fehlend. Die
 * Antwort ist dann "nicht geprueft" und nicht "vorhanden": derselbe Grund,
 * aus dem `_beneosValidateInstalledAsset()` auf Forge die Pruefung
 * UEBERSPRINGT und keine Existenz behauptet.
 *
 * @returns {Promise<boolean|null>} `null` heisst "nicht geprueft".
 */
async function liegtAufPlatte(pfad) {
  if (!pfad) return false
  if (aufDerForge()) return null
  const schluessel = ohneAbfrage(pfad)
  const da = platte.get(schluessel)
  if (frisch(da, FRIST_PLATTE_MS)) return da.wert

  return await einmal(`platte:${schluessel}`, async () => {
    const nochmal = platte.get(schluessel)
    if (frisch(nochmal, FRIST_PLATTE_MS)) return nochmal.wert
    let wert = null
    try {
      const antwort = await headCheck(schluessel)
      if (antwort?.status === -2) {
        wert = null                       // absolute Adresse, nicht geprueft
      } else if (!antwort?.ok) {
        wert = false
      } else {
        const laenge = Number(antwort.laenge)
        wert = !(Number.isFinite(laenge) && laenge <= STUMMEL_MAX_BYTES)
      }
    } catch (_) { wert = null }
    return merken(platte, schluessel, wert, FRIST_PLATTE_MS)
  })
}

/**
 * Gibt es diese Ansicht, und wie heisst sie? Die eine Stelle, die das weiss.
 *
 * @param {string} pfad   Ein bekannter Bildpfad derselben Kreatur und
 *                        Variante, oertlich oder als Toradresse.
 * @param {string} stil   `tokenized` oder `topdown`, die GESUCHTE Ansicht.
 * @returns {Promise<{zustand: boolean|null, src: string|null, sha256: string|null}>}
 *          `zustand` ist `null`, wenn nicht geprueft werden konnte. `src` ist
 *          die Adresse, die geschrieben werden darf, und nur bei `true` gesetzt.
 *          `sha256` ist die Soll-Pruefsumme aus der Liste, oder `null`: bei
 *          einem oertlichen Pfad immer, und am Tor, solange der Durchgang die
 *          Listen noch nicht neu geschrieben hat.
 */
export async function ansicht(pfad, stil) {
  const ziel = stil === STILE.topdown ? STILE.topdown : STILE.tokenized
  const offen = { zustand: null, src: null, sha256: null }
  const wer = kreaturAusPfad(pfad)
  if (!wer) return { zustand: false, src: null, sha256: null }

  // Die Adresse waehlt die Quelle, nicht die Einstellung. Begruendung im Kopf.
  if (wer.ueberTor) {
    const liste = await posenliste(wer.release)
    if (!liste) return offen
    const eintrag = liste.tokenbilder?.[wer.variante]?.[ziel]
    // `null` steht ausdruecklich drin und heisst "gibt es nicht". Und der
    // Dateiname kommt aus der Liste, damit niemand ihn bildet.
    if (!eintrag || !eintrag.pfad) return { zustand: false, src: null, sha256: null }
    return {
      zustand: true,
      src: assetUrl(wer.release, "", eintrag.pfad),
      // Seit dem 07.11.2026 traegt die Liste je Ansicht eine `sha256`. Steht
      // sie nicht drin, ist das Feld `null`, und das ist der Normalfall,
      // solange der Volldurchgang die Listen nicht neu geschrieben hat.
      sha256: typeof eintrag.sha256 === "string" && /^[a-f0-9]{64}$/.test(eintrag.sha256)
        ? eintrag.sha256 : null,
    }
  }

  // Oertlicher Pfad: die Platte entscheidet. Der Name entsteht hier weiter aus
  // dem Textersatz, und das ist kein Raten: GEPRUEFT wird genau der Name, der
  // danach geschrieben wird, und zwar an der Stelle, von der das Bild kommt.
  const rein = ohneAbfrage(pfad)
  const quelle = ENDUNG[ziel === STILE.topdown ? "tokenized" : "topdown"]
  const kandidat = rein.includes(ENDUNG[ziel])
    ? rein
    : (rein.includes(quelle) ? rein.replace(quelle, ENDUNG[ziel]) : null)
  if (!kandidat) return { zustand: false, src: null, sha256: null }
  const liegt = await liegtAufPlatte(kandidat)
  if (liegt === null) return offen
  // Oertlich gibt es keine Soll-Pruefsumme. Die Liste beschreibt den SPIEGEL,
  // und was auf der Platte des Kunden liegt, hat sie nie gesehen.
  return { zustand: liegt, src: liegt ? kandidat : null, sha256: null }
}

/**
 * DIE GEGENPROBE AM INHALT, UND SIE HAT DREI ANTWORTEN.
 *
 * `OP-PRJ-172`, Betreiberentscheid vom 07.11.2026: es wird mit Pruefsummen
 * gearbeitet, je Ansicht. Die billigere Variante mit der blossen Bytezahl ist
 * ausdruecklich abgewaehlt.
 *
 * WAS SIE FAENGT. Die Posenliste ist eine Datendatei im Spiegel, ohne
 * Signatur. Wer sie schreibt, waehlt damit die ausgelieferte Datei, ohne dass
 * eine Zeile Code sich aendert. Haelt der Spiegel unter diesem Namen einen
 * ANDEREN Inhalt als die Platte, bekommt der Kunde ein fremdes oder ein
 * abgeschnittenes Bild, und zwar ohne Fehlermeldung: ein Bild mit falschem
 * Inhalt ist ein gueltiges Bild. Dazu steuern die Masse in der Liste
 * Skalierung und Ankerpunkt, ein getauschter Eintrag verzieht also auch die
 * Figur.
 *
 * WAS SIE NICHT FAENGT, und das gehoert in denselben Absatz: Pfad und Summe
 * entstehen auf dem Server in derselben Zeile aus derselben Datei. Gegen einen
 * falschen EINTRAG ist sie kein Schutz. Eine Signatur ueber die Liste waere
 * die dritte Fassung derselben Entscheidung und steht laut Bauplan
 * ausdruecklich nicht zur Debatte.
 *
 * WARUM DREI ANTWORTEN UND NICHT ZWEI, gemessen am 07.11.2026:
 * `crypto.subtle` liegt nur in einem SICHEREN KONTEXT. `http://localhost`
 * gilt als sicher, `http://192.168.x.x` nicht, und ein Foundry im LAN ist
 * genau das. Ein Kunde ohne HTTPS hat nichts falsch gemacht.
 *
 *   true    geprueft und gut
 *   false   geprueft und falsch, es wird NICHTS geschrieben
 *   null    nicht pruefbar, es laedt wie bisher und meldet sich EINMAL
 *
 * **Der Rueckfall prueft nicht mit der Bytezahl weiter.** Ein zweiter,
 * schwaecherer Pruefweg waere eine zweite Wahrheit, und dann steht im
 * Protokoll "geprueft", wo nur gezaehlt wurde.
 *
 * WARUM HIER UND NICHT IN DER ABRUFSCHICHT. `crypto.subtle.digest` hat keine
 * Streaming-Schnittstelle: sie braucht die ganze Datei als EIN Stueck, also
 * eine zweite Kopie im Speicher. Fuer eine Posenansicht ist das vertraeglich,
 * gemessen 0,447 MB fuer die Draufsicht und 0,117 MB fuer 2.5D. Fuer ein
 * Kartenvideo waere es es nicht, und `rumpfBeobachten()` in
 * `stream-fetch.mjs` zaehlt die Bytes gerade deshalb im Durchfluss, ohne sie
 * zu halten. Die Pruefung darf also nicht dorthin wandern, auch wenn sie
 * technisch hineinpasst.
 */
const geprueft = new Map()
let nichtPruefbarGemeldet = false

/**
 * Wie lange ein Prueferfolg gilt: fuer die Sitzung.
 *
 * Anders als bei `listen` und `platte` haengt hier keine Frist dran, und das
 * ist eine Entscheidung. Die beiden Fristen oben sind kurz, weil sich die
 * ANTWORT aendern kann: eine Draufsicht wird nachgeliefert, eine Datei wird
 * zum Stummel. Ein Inhalt, dessen Pruefsumme einmal gestimmt hat, aendert
 * sich dagegen nicht mehr unter demselben Namen, ohne dass auch die Liste neu
 * geschrieben wird, und dann traegt sie eine andere Soll-Summe und damit
 * einen anderen Schluessel.
 */
function pruefSchluessel(src, soll) {
  return `${ohneAbfrage(src)}|${soll}`
}

async function summeVon(blob) {
  const puffer = await blob.arrayBuffer()
  const buf = await crypto.subtle.digest("SHA-256", puffer)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

function meldeNichtPruefbar(grund) {
  if (nichtPruefbarGemeldet) return
  nichtPruefbarGemeldet = true
  console.warn("Beneos Stream | Die Pruefsumme einer Kreaturenansicht laesst sich in "
    + `diesem Browser nicht rechnen (${grund}). Die Bilder laden wie bisher, aber `
    + "sie sind ungeprueft. Haeufigste Ursache ist ein Foundry ohne HTTPS im "
    + "Heimnetz: `crypto.subtle` gibt es nur in einem sicheren Kontext. "
    + "Weitere Ansichten werden nicht mehr einzeln gemeldet.")
}

/**
 * Haelt die Datei hinter `src` ihre Soll-Pruefsumme?
 *
 * @param {string} src   Die Toradresse, die geschrieben werden soll.
 * @param {string} soll  Die `sha256` aus der Posenliste.
 * @returns {Promise<boolean|null>} `null` heisst "nicht pruefbar".
 */
export async function ansichtInhaltOk(src, soll) {
  if (!src || !soll) return null
  const schluessel = pruefSchluessel(src, soll)
  if (geprueft.has(schluessel)) return geprueft.get(schluessel)

  return await einmal(`inhalt:${schluessel}`, async () => {
    if (geprueft.has(schluessel)) return geprueft.get(schluessel)
    let wert = null
    try {
      // Ohne diese Abfrage waere der fehlende sichere Kontext ein Ausfall und
      // keine dritte Antwort. `stableId()` in `stream-scenes.mjs` hat genau
      // dieses `try` nicht, und dort ist es ein echter Mangel.
      if (typeof crypto === "undefined" || !crypto?.subtle?.digest) {
        meldeNichtPruefbar("crypto.subtle fehlt")
      } else {
        // Durch den gepatchten Abruf, mit Absicht: die Datei kommt dann aus
        // dem Vorrat, wenn sie dort liegt, und der Abruf kostet nichts
        // zweimal. Genau diese Datei wird gleich darauf gezeichnet.
        const antwort = await fetch(src)
        if (!antwort.ok || antwort.headers.get("x-beneos-denied")
            || antwort.headers.get("x-beneos-offline")) {
          // Kein Recht, kein Netz: das ist keine falsche Datei, sondern keine
          // Datei. Die Abrufschicht meldet das schon, und der Ersatzbildweg
          // gehoert ihr. Hier bleibt es "nicht pruefbar".
          meldeNichtPruefbar("die Datei kam nicht")
        } else {
          const ist = await summeVon(await antwort.blob())
          wert = ist === soll
          if (wert === false) {
            console.warn("Beneos Stream | Eine Kreaturenansicht traegt einen anderen "
              + `Inhalt als die Posenliste nennt. Sie wird NICHT geschrieben. `
              + `${ohneAbfrage(src).split("/").pop()}: Soll ${soll.slice(0, 12)}..., `
              + `Ist ${ist.slice(0, 12)}...`)
          }
        }
      }
    } catch (grund) {
      // Jede Ursache derselbe Ausgang. Die Pruefung darf nie der Grund sein,
      // aus dem ein Bild nicht erscheint.
      meldeNichtPruefbar(String(grund?.message || grund).slice(0, 120))
      wert = null
    }
    geprueft.set(schluessel, wert)
    return wert
  })
}

/**
 * Wie `ansicht()`, aber der Inhalt ist gegengeprueft.
 *
 * Diese Form ruft, wer die Adresse SCHREIBT. `ansicht()` bleibt fuer die
 * Anzeigefrage, und das ist kein Versehen: eine Kachelleiste mit zwanzig
 * Varianten wuerde sonst zwanzig Dateien holen, die sie nur zaehlen wollte.
 *
 * @returns {Promise<{zustand: boolean|null, src: string|null, pruefung: boolean|null}>}
 */
export async function ansichtGeprueft(pfad, stil) {
  const a = await ansicht(pfad, stil)
  if (!a.src || !a.sha256) return { zustand: a.zustand, src: a.src, pruefung: null }
  const ok = await ansichtInhaltOk(a.src, a.sha256)
  if (ok === false) return { zustand: false, src: null, pruefung: false }
  return { zustand: a.zustand, src: a.src, pruefung: ok }
}

/** Nur fuer Prueffaelle und `posenVergessen`: den Pruefspeicher leeren. */
export function pruefungenVergessen() {
  geprueft.clear()
  nichtPruefbarGemeldet = false
}

/**
 * Darf die Oberflaeche diese Ansicht anbieten?
 *
 * Streng mit Absicht: "nicht geprueft" gilt hier als nein, denn ein
 * angebotener Knopf, der ein leeres Feld liefert, ist der verbotene Ausgang.
 * Wer "nicht geprueft" anders behandeln will, ruft `ansicht()` und entscheidet
 * selbst.
 */
export async function ansichtGibtEs(pfad, stil) {
  return (await ansicht(pfad, stil)).zustand === true
}

/**
 * Welche Adresse wird geschrieben? `null`, wenn keine geschrieben werden darf.
 *
 * Das ist die Haelfte, die im ersten Entwurf fehlte: die Liste NENNT den
 * Dateinamen, und wer nur die Existenzfrage beantwortet, laesst den Aufrufer
 * den Namen weiter raten.
 */
export async function ansichtSrc(pfad, stil) {
  return (await ansicht(pfad, stil)).src
}

/**
 * Den Zwischenspeicher einer Kreatur wegwerfen.
 *
 * Gerufen am Abschluss der Kreaturen-Installation (`beneos_cloud.js`, nach dem
 * Schreiben von `beneos-json-tokenconfig`) und am Ende des Dateiaufraeumens der
 * Deinstallation (`beneos-native-uninstaller.mjs`). Beide rufen OHNE Argument,
 * weil dort kein Releasename vorliegt und ein gebildeter Name genau der Fehler
 * waere, den diese Datei beseitigt.
 *
 * Ein Wechsel von Schluessel oder Basisadresse wird NICHT eigens gemeldet; ihn
 * deckt die kurze Frist ab, nach hoechstens fuenf Minuten. Das ist eine
 * bewusste Begrenzung und keine Luecke, denn ein Schluesselwechsel ist selten
 * und sein Preis ist ein Abruf je Kreatur.
 */
export function posenVergessen(release) {
  // Ohne Argument ist ein vollstaendiger Neuanfang gemeint, und dann gehen die
  // Pruefungen mit. MIT Releasename bleiben sie stehen: ihr Schluessel traegt
  // die Soll-Summe, also kann eine neu geschriebene Liste keinen alten
  // Erfolg erben, und eine Deinstallation aendert die Platte und nicht den
  // Inhalt im Spiegel.
  if (!release) { listen.clear(); platte.clear(); pruefungenVergessen(); return }
  const name = String(release)
  listen.delete(name)
  const kennung = name.startsWith(KREATUR_PRAEFIX) ? name.slice(KREATUR_PRAEFIX.length) : name
  if (!kennung) return
  for (const pfad of [...platte.keys()]) {
    if (pfad.includes(kennung)) platte.delete(pfad)
  }
}
