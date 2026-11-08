/**
 * DIE KARTENLISTE: WELCHE SEITEN EIN GEGENSTAND ODER ZAUBER HAT, UND WIE SIE
 * HEISSEN.
 *
 * WARUM ES DIESE DATEI GIBT
 *
 * Zwei Stellen im Modul bilden heute den Namen einer Klappkarte, und beide
 * tun es mit Textersatz aus der Kennung: `beneosCloudCardPaths()` in
 * `../loot/loot-schema.mjs`, gerufen vom Blatt des Gegenstands und vom
 * Begleitfenster. Oertlich ist das eine kaputte Bildkachel, wenn die Datei
 * fehlt, also ein sichtbarer Fehler.
 *
 * Am Tor ist es kein sichtbarer Fehler mehr. Eine Abweisung ist HTTP 200 mit
 * einem durchsichtigen GIF von 42 Byte, ein geratener Name wird damit zur
 * leeren Karte, und nirgends erscheint eine Meldung. Dieselbe Regel, die der
 * Browser-Client teuer gelernt hat, gilt deshalb auch hier:
 *
 *   Niemals einen Dateinamen bilden, nur unter genannten Dateien waehlen.
 *
 * UND SIE IST HIER NICHT THEORETISCH, sondern am Bestand gemessen
 * (`OP-PRJ-139`, 07.11.2026): drei Zauber tragen GAR KEINE Rueckseite, und
 * drei weitere tragen sie als PNG und damit unter einem Namen, den die
 * Positivliste des Spiegels nicht mitnimmt. Wer `<kennung>-back.webp` bildet,
 * bekommt bei sechs Eintraegen eine leere Rueckseite ohne Fehler.
 *
 * `_karten.json` liegt je Release im Spiegel unter `beute/<release>/` und wird
 * von dem geschrieben, der die Dateien hochlaedt (`beute_mirror_kartenliste()`
 * in `beneos-cloud-server/lib/beute-mirror-gate.php`). Sie nennt jede der drei
 * Rollen einzeln, mit Namen, Massen, Bytes und Pruefsumme, und eine fehlende
 * Rolle steht als `null` ausdruecklich DRIN:
 *
 *   {"karten": {"front": {"pfad": "<kennung>-front.webp", "breite": 1024,
 *                         "hoehe": 1434, "bytes": 213000, "sha256": "..."},
 *               "back":  null,
 *               "icon":  {...}}}
 *
 * DIE MASSE SIND DER GRUND, WARUM MEHR ALS DER NAME DRINSTEHT. Das Ersatzbild
 * soll im Seitenverhaeltnis des Originals erscheinen (`OP-PRJ-128`), und eine
 * Klappkarte ist hochkant, waehrend ein Symbol quadratisch ist. Geraten waere
 * das Ersatzbild quadratisch und die Karte sichtbar verzerrt.
 *
 * ZWEI QUELLEN, UND DIE ADRESSE WAEHLT, NICHT DIE EINSTELLUNG
 *
 * Wortgleich zur Entscheidung in `stream-posen.mjs`, und aus demselben Grund:
 * eine Welt kann auf `download` stehen, waehrend Streaming eingeschaltet ist.
 * Dann sagt die Liste "die Rueckseite gibt es im Spiegel", die Datei liegt
 * aber nicht auf der Platte des Kunden.
 *
 *   Toradresse (`/l/...`)   die Kartenliste entscheidet
 *   oertlicher Pfad         DIESE DATEI ENTSCHEIDET NICHT
 *
 * DER ZWEITE FALL IST ABSICHTLICH OFFEN, und das ist der Unterschied zu
 * `stream-posen.mjs`. Dort gibt es eine Plattenprobe, weil dort ein KNOPF
 * davon abhaengt: ein Stilumschalter, der eine Textur schreibt, die es nicht
 * gibt. Hier haengt nichts daran. Ein oertlicher Pfad verhaelt sich Zeichen
 * fuer Zeichen wie vor dieser Datei, naemlich als Bildkachel, die Foundry
 * entweder zeichnet oder nicht. Eine Plattenprobe waere hier eine Anfrage je
 * Blattrender fuer eine Frage, die niemand stellt.
 *
 * Deshalb drei Antworten und nicht zwei: `true`, `false` und `null` fuer
 * "nicht geprueft". `null` heisst hier immer "nimm, was du ohne mich getan
 * haettest", und es ist der Normalfall fuer jede oertlich installierte Welt.
 *
 * DAS SYMBOL STEHT IN DER LISTE UND WIRD TROTZDEM NICHT GESTREAMT.
 * Betreiberlage: Gegenstandssymbol 9352 Byte, Zaubersymbol 6708 Byte, ueber
 * den ganzen Bestand rund 10 MB, und es steht in `Item.img`, einem Feld, das
 * jeder Spieler liest. Es bleibt oertlich. Dass die Liste es dennoch nennt,
 * kostet nichts und haelt die Entscheidung umkehrbar: wird es eines Tages
 * gestreamt, ist hier keine Zeile zu aendern.
 */

import {
  assetUrl, BEUTE_PRAEFIX, istBeute, streamKey, zerlegeAdresse,
} from "./stream-settings.mjs"
import { einmal, frisch, merken, ohneAbfrage } from "./stream-merker.mjs"

/**
 * Wie lange eine Antwort gilt.
 *
 * Dieselben fuenf Minuten wie bei der Posenliste, und aus demselben Grund: die
 * Frist haengt am ERGEBNIS und nicht am Vorhandensein der Liste. Eine Liste
 * mit `"back": null` ist ein gueltiges Ergebnis, und wird die Rueckseite
 * nachgeliefert, bleibt die Karte hoechstens fuenf Minuten einseitig.
 */
const FRIST_LISTE_MS = 5 * 60 * 1000

/** Die drei Rollen, und genau diese. Dieselbe Menge wie `beute_mirror_rollen()`. */
export const ROLLEN = { front: "front", back: "back", icon: "icon" }

/** release -> { stand, wert } ; `wert` ist die Liste, `null` heisst "keine". */
const listen = new Map()

/**
 * Aus einem Bildpfad den Gegenstand lesen.
 *
 * Bei einer Toradresse steht der Releasename IM PFAD, und dann wird er von
 * dort genommen und nicht aus der Kennung gebildet. Dieselbe Korrektur wie in
 * `kreaturAusPfad()`: `beneos_lt_` plus Kennung zusammenzusetzen waere
 * dieselbe Namensbildung, gegen die diese Datei angetreten ist, nur eine
 * Ebene hoeher.
 *
 * NUR `.webp`, UND DAS IST DER WICHTIGSTE TEIL DIESER FUNKTION. Im Bestand
 * tragen drei Zauber ihre Rueckseite als PNG. Der Spiegel nimmt sie nicht mit,
 * seine Positivliste kennt nur `.webp`, und in `_karten.json` steht fuer sie
 * `"back": null`. Wuerde diese Funktion `.png` annehmen, baute der Aufrufer
 * eine Toradresse auf eine Datei, die im Spiegel nicht liegt, und bekaeme das
 * 42-Byte-GIF. Ein PNG-Pfad ergibt deshalb `null`, also "nicht geprueft", und
 * damit bleibt es bei dem oertlichen Verhalten von heute.
 *
 * @returns {{kennung: string, rolle: string, release: string,
 *            ueberTor: boolean}|null}
 */
export function beuteAusPfad(pfad) {
  const rein = ohneAbfrage(pfad)
  const name = rein.split("/").pop()
  const treffer = /^(.+)-(front|back|icon)\.webp$/i.exec(name)
  if (!treffer) return null
  const tor = zerlegeAdresse(pfad)
  if (tor && tor.raum !== "beute") return null
  return {
    kennung: treffer[1],
    rolle: treffer[2].toLowerCase(),
    release: tor ? tor.release : `${BEUTE_PRAEFIX}${treffer[1]}`,
    ueberTor: !!tor,
  }
}

/**
 * Die Liste eines Release, hoechstens einmal je Frist geholt.
 *
 * Ohne Streamschluessel gibt es am Tor nichts zu holen, denn er ist Teil der
 * Adresse. Aufgerufen wird die Funktion nur fuer Toradressen, siehe `karte`.
 */
export async function kartenliste(release) {
  const schluessel = String(release || "")
  if (!istBeute(schluessel)) return null
  const da = listen.get(schluessel)
  if (frisch(da, FRIST_LISTE_MS)) return da.wert
  if (!streamKey()) return merken(listen, schluessel, null, FRIST_LISTE_MS)

  return await einmal(`karten:${schluessel}`, async () => {
    const nochmal = listen.get(schluessel)
    if (frisch(nochmal, FRIST_LISTE_MS)) return nochmal.wert
    let wert = null
    try {
      // Durch den gepatchten Abruf, mit Absicht: so gelten Vorrat, Frist,
      // Verbindungswaechter und Ersatzantwort auch fuer die Liste. Sie ist
      // eine gestreamte Datei wie jede andere.
      const antwort = await fetch(assetUrl(schluessel, "", "_karten.json"))
      if (antwort.ok && !antwort.headers.get("x-beneos-denied")
          && !antwort.headers.get("x-beneos-offline")) {
        const gelesen = await antwort.json()
        // `karten` ist der Zeuge. Eine Antwort ohne dieses Feld ist keine
        // Kartenliste, auch wenn sie gueltiges JSON ist: genau das liefert
        // eine Fehlseite des Hosters, und sie kaeme hier mit 200 an.
        if (gelesen && typeof gelesen === "object"
            && gelesen.karten && typeof gelesen.karten === "object") {
          wert = gelesen
        }
      }
    } catch (_) {
      // Kein Netz, kein Recht, kaputtes JSON: alles derselbe Ausgang, naemlich
      // keine Liste. Der Aufrufer bekommt dann "nicht geprueft".
      wert = null
    }
    return merken(listen, schluessel, wert, FRIST_LISTE_MS)
  })
}

/**
 * Gibt es diese Seite, und wie heisst sie? Die eine Stelle, die das weiss.
 *
 * @param {string} pfad   Ein bekannter Bildpfad DESSELBEN Eintrags, oertlich
 *                        oder als Toradresse. Welche Rolle er traegt, ist
 *                        gleichgueltig; gefragt wird nach `rolle`.
 * @param {string} rolle  `front`, `back` oder `icon`.
 * @returns {Promise<{zustand: boolean|null, src: string|null,
 *                    breite: number|null, hoehe: number|null}>}
 *          `zustand` ist `null`, wenn nicht geprueft werden konnte, und das
 *          ist bei jedem oertlichen Pfad so. `src` ist nur bei `true` gesetzt.
 */
export async function karte(pfad, rolle) {
  const ziel = ROLLEN[String(rolle || "").toLowerCase()]
  const offen = { zustand: null, src: null, breite: null, hoehe: null }
  if (!ziel) return offen

  const wer = beuteAusPfad(pfad)
  if (!wer) return offen

  // Die Adresse waehlt die Quelle, nicht die Einstellung. Begruendung im Kopf.
  // Ein oertlicher Pfad bleibt ausdruecklich offen: diese Datei entscheidet
  // dort nichts und laesst den Aufrufer bei seinem bisherigen Verhalten.
  if (!wer.ueberTor) return offen

  const liste = await kartenliste(wer.release)
  if (!liste) return offen

  const eintrag = liste.karten[ziel]
  // `null` IST eine Antwort und nicht eine fehlende. Der Spiegel schreibt
  // jede der drei Rollen, eine abwesende ausdruecklich als `null`; damit ist
  // "es gibt sie nicht" von "ich habe nicht nachgesehen" unterscheidbar.
  if (eintrag === null) return { zustand: false, src: null, breite: null, hoehe: null }
  if (!eintrag || typeof eintrag !== "object" || typeof eintrag.pfad !== "string"
      || !eintrag.pfad) {
    // Ein Feld, das es gibt, aber nicht in der vereinbarten Form: das ist eine
    // andere Lage als `null` und darf nicht als "gibt es nicht" gelten, sonst
    // verschwindet eine vorhandene Karte wegen eines Schreibfehlers im Spiegel.
    return offen
  }

  // DER NAME KOMMT AUS DER LISTE UND WIRD NICHT GEBILDET. Das ist der ganze
  // Zweck dieser Datei.
  return {
    zustand: true,
    src: assetUrl(wer.release, "", eintrag.pfad),
    breite: Number.isFinite(eintrag.breite) ? eintrag.breite : null,
    hoehe: Number.isFinite(eintrag.hoehe) ? eintrag.hoehe : null,
  }
}

/**
 * Die Adresse einer Kartenseite fuer eine Oberflaeche, `OP-PRJ-141` Teil 2.
 *
 * ─── WARUM ES DIESE FUNKTION BRAUCHT, und zwar hier und nicht dort ──────────
 *
 * Zwei Stellen zeigen die Klappkarten: das Blatt des Gegenstands
 * (`../loot/item-sheet-extender.mjs`) und das Begleitfenster
 * (`../codex2/item-companion.mjs`). Beide bauen heute dieselben zwei Zeilen:
 *
 *   const cloudCards = beneosCloudCardPaths(item)
 *   const frontCard  = cloudCards.front || loot.render?.frontCardWebp || null
 *
 * GEMESSEN AM 08.11.2026 IST DER VORRANG FALSCH, sobald das Streaming traegt.
 * `beneosCloudCardPaths()` bildet einen OERTLICHEN Pfad aus der Kennung und
 * liefert damit IMMER einen Wert. Steht in `loot.render.frontCardWebp` nach
 * einer Streaming-Installation eine Toradresse, wird sie von diesem Vorrang
 * verdraengt und NIE benutzt. Der Umbau ist deshalb nicht "eine Adresse
 * bilden", sondern "den Vorrang umdrehen, wenn eine Toradresse da ist".
 *
 * ─── DREI AUSGAENGE, UND DER DRITTE IST DER NORMALFALL ──────────────────────
 *
 *   die Liste kennt die Seite       Adresse AUS DER LISTE, mit Massen
 *   die Liste sagt: gibt es nicht   `null`, und die Kachel faellt weg
 *   nicht geprueft                  der oertliche Pfad, wie vor dieser Datei
 *
 * Der dritte Fall ist jede oertlich installierte Welt, und dort verhaelt sich
 * die Oberflaeche Zeichen fuer Zeichen wie vorher. Das ist die Bedingung
 * dafuer, dass hier ueberhaupt gebaut werden darf: ein Kunde auf `download`
 * merkt von dieser Funktion nichts.
 *
 * ─── DER ZWEITE FALL IST DER GEWINN, und er ist am Bestand gemessen ─────────
 *
 * `OP-PRJ-139` hat am 07.11.2026 gezaehlt: drei Zauber tragen GAR KEINE
 * Rueckseite, und drei weitere tragen sie als PNG und damit unter einem Namen,
 * den die Positivliste des Spiegels nicht mitnimmt. Wer `<kennung>-back.webp`
 * bildet, bekommt bei sechs Eintraegen eine Kachel, die am Tor ein
 * durchsichtiges GIF von 42 Byte zeigt: ein gueltiges Bild, kein Fehler,
 * nirgends eine Meldung.
 *
 * Mit dieser Funktion faellt die Kachel weg, statt leer zu erscheinen.
 *
 * ─── DIE MASSE GEHEN MIT, und das ist nicht Zierwerk ────────────────────────
 *
 * Das Ersatzbild soll im Seitenverhaeltnis des Originals erscheinen
 * (`OP-PRJ-128`), und eine Klappkarte ist hochkant, waehrend ein Symbol
 * quadratisch ist. Geraten waere das Ersatzbild quadratisch und die Karte
 * sichtbar verzerrt. Im dritten Fall stehen die Masse auf `null`, denn ueber
 * eine oertliche Datei weiss diese Datei nichts.
 */
export async function karteFuerBlatt(gespeichert, oertlich, rolle) {
  const befund = await karte(gespeichert, rolle)

  if (befund.zustand === true) {
    return { src: befund.src, breite: befund.breite, hoehe: befund.hoehe }
  }
  if (befund.zustand === false) {
    // DIE LISTE SAGT NEIN, und das ist eine Antwort und keine fehlende. Hier
    // `null`, damit die Kachel wegfaellt; eine gebildete Adresse waere am Tor
    // ein durchsichtiges GIF ohne Fehlermeldung.
    return { src: null, breite: null, hoehe: null }
  }

  // NICHT GEPRUEFT. Die alte Reihenfolge, Zeichen fuer Zeichen: zuerst der
  // oertliche Pfad aus der Kennung, dann der gespeicherte Wert. Sie heilt
  // SRD-Eintraege, deren gespeicherte Pfade ins Leere zeigen, und genau dafuer
  // ist sie 2026 entstanden.
  return {
    src: oertlich || gespeichert || null,
    breite: null,
    hoehe: null,
  }
}

/**
 * Darf die Oberflaeche diese Seite anbieten? Bewusst streng.
 *
 * `null` heisst "nicht geprueft" und zaehlt hier NICHT als ja. Wer eine
 * Adresse schreiben will, nimmt `karte()` und liest `src`; wer nur eine
 * Kachel ausgrauen will, nimmt diese Funktion.
 */
export async function karteGibtEs(pfad, rolle) {
  const befund = await karte(pfad, rolle)
  return befund.zustand === true
}

/**
 * Die gemerkte Liste eines Release vergessen.
 *
 * Gebraucht nach einer Installation oder einer Deinstallation: dort aendert
 * sich, wo die Dateien liegen, und eine fuenf Minuten alte Antwort waere dann
 * eine Antwort auf die Welt von vorher.
 */
export function kartenVergessen(release) {
  if (release === undefined || release === null) { listen.clear(); return }
  listen.delete(String(release))
}

/** Was gerade gemerkt ist, fuer den Bericht. Fasst nichts an. */
export function kartenStand() {
  const je = []
  for (const [release, e] of listen) {
    const rollen = {}
    if (e.wert && e.wert.karten) {
      for (const r of Object.keys(ROLLEN)) rollen[r] = !!e.wert.karten[r]
    }
    je.push({ release, liste: !!e.wert, rollen, alter_ms: Date.now() - e.stand })
  }
  return { listen: listen.size, je }
}
