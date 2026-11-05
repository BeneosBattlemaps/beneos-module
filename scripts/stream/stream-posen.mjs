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

/**
 * Obergrenze je Karte, mit Verdraengung der aeltesten Eintraege.
 *
 * Ohne sie waechst der Zwischenspeicher ueber die Sitzung, und zwar nicht
 * theoretisch: Tokenpfade tragen im Bestand mitunter einen Cache-Brecher, also
 * bekaeme dieselbe Datei je Abruf einen neuen Eintrag. Deshalb faellt der
 * Abfrageteil zusaetzlich aus dem Schluessel.
 */
const KARTE_MAX = 400

const STILE = { tokenized: "tokenized", topdown: "topdown" }
const ENDUNG = { topdown: "-top.webp", tokenized: "-token.webp" }

/** release -> { stand, wert } ; `wert` ist die Liste, `null` heisst "keine". */
const listen = new Map()
/** pfad -> { stand, wert } ; Ergebnis der Plattenprobe, `null` heisst offen. */
const platte = new Map()
/** Laufende Abrufe, damit zehn Kacheln einer Kreatur EINEN Abruf teilen. */
const laufend = new Map()

function frisch(eintrag, frist) {
  return !!eintrag && (Date.now() - eintrag.stand) < frist
}

/** Setzen samt Abraeumen und Deckel. `frisch()` liest nur, es loescht nicht. */
function merken(karte, schluessel, wert, frist) {
  const jetzt = Date.now()
  for (const [k, e] of karte) {
    if ((jetzt - e.stand) >= frist) karte.delete(k)
  }
  while (karte.size >= KARTE_MAX) {
    const aeltester = karte.keys().next().value
    if (aeltester === undefined) break
    karte.delete(aeltester)
  }
  karte.set(schluessel, { stand: jetzt, wert })
  return wert
}

/**
 * Ein Abruf je Schluessel, auch wenn zehn Aufrufer gleichzeitig fragen.
 *
 * Der Zwischenspeicher legt das ERGEBNIS ab, nicht das Versprechen. Solange
 * noch keine Antwort liegt, wuerde jede Variantenkachel ihren eigenen Abruf
 * starten; `#probeVariantTopAssets()` faechert mit `Promise.allSettled` ueber
 * alle Kacheln einer Kreatur gleichzeitig auf, das waeren fuenf Abrufe
 * derselben Datei. Deshalb liegt das laufende Versprechen hier daneben.
 */
function einmal(schluessel, arbeit) {
  const schon = laufend.get(schluessel)
  if (schon) return schon
  const lauf = (async () => {
    try { return await arbeit() } finally { laufend.delete(schluessel) }
  })()
  laufend.set(schluessel, lauf)
  return lauf
}

/** Der Abfrageteil gehoert nicht zur Identitaet einer Datei. */
function ohneAbfrage(pfad) {
  return String(pfad || "").split("?")[0].split("#")[0]
}

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
 * @returns {Promise<{zustand: boolean|null, src: string|null}>}
 *          `zustand` ist `null`, wenn nicht geprueft werden konnte. `src` ist
 *          die Adresse, die geschrieben werden darf, und nur bei `true` gesetzt.
 */
export async function ansicht(pfad, stil) {
  const ziel = stil === STILE.topdown ? STILE.topdown : STILE.tokenized
  const offen = { zustand: null, src: null }
  const wer = kreaturAusPfad(pfad)
  if (!wer) return { zustand: false, src: null }

  // Die Adresse waehlt die Quelle, nicht die Einstellung. Begruendung im Kopf.
  if (wer.ueberTor) {
    const liste = await posenliste(wer.release)
    if (!liste) return offen
    const eintrag = liste.tokenbilder?.[wer.variante]?.[ziel]
    // `null` steht ausdruecklich drin und heisst "gibt es nicht". Und der
    // Dateiname kommt aus der Liste, damit niemand ihn bildet.
    if (!eintrag || !eintrag.pfad) return { zustand: false, src: null }
    return { zustand: true, src: assetUrl(wer.release, "", eintrag.pfad) }
  }

  // Oertlicher Pfad: die Platte entscheidet. Der Name entsteht hier weiter aus
  // dem Textersatz, und das ist kein Raten: GEPRUEFT wird genau der Name, der
  // danach geschrieben wird, und zwar an der Stelle, von der das Bild kommt.
  const rein = ohneAbfrage(pfad)
  const quelle = ENDUNG[ziel === STILE.topdown ? "tokenized" : "topdown"]
  const kandidat = rein.includes(ENDUNG[ziel])
    ? rein
    : (rein.includes(quelle) ? rein.replace(quelle, ENDUNG[ziel]) : null)
  if (!kandidat) return { zustand: false, src: null }
  const liegt = await liegtAufPlatte(kandidat)
  if (liegt === null) return offen
  return { zustand: liegt, src: liegt ? kandidat : null }
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
  if (!release) { listen.clear(); platte.clear(); return }
  const name = String(release)
  listen.delete(name)
  const kennung = name.startsWith(KREATUR_PRAEFIX) ? name.slice(KREATUR_PRAEFIX.length) : name
  if (!kennung) return
  for (const pfad of [...platte.keys()]) {
    if (pfad.includes(kennung)) platte.delete(pfad)
  }
}
