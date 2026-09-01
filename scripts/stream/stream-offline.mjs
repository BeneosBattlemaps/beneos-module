/**
 * Das Verzeichnis der offline zugesagten Karten, und die Pruefung, ob sie
 * wirklich noch da sind.
 *
 * WARUM ES DIESES VERZEICHNIS UEBERHAUPT GIBT
 *
 * Der Speicher des Browsers weiss, welche DATEIEN er haelt. Er weiss nicht,
 * welche KARTEN der Kunde zugesagt bekommen hat, wie sie heissen und was sie
 * gekostet haben. Genau diese Differenz ist der Schaden, wenn der Speicher
 * geraeumt wird, und ohne ein Verzeichnis waere sie nicht feststellbar: eine
 * verschwundene Datei hinterlaesst keine Spur, sie ist einfach nicht mehr da.
 *
 * DIE ENTSCHEIDUNG DAHINTER
 *
 * Der Browser raeumt selten, aber er raeumt. Chrome tut es nur, wenn alle
 * Urspruenge zusammen achtzig Prozent der Platte belegen oder die Platte knapp
 * wird, und dann nach Zuletzt-benutzt ueber ganze Urspruenge. Die
 * Chrome-Entwickler halten fest, dass Daten sehr selten geloescht werden.
 *
 * Das eigentliche Risiko ist nicht technisch: es ist der Kunde, der auf Rat
 * aus der Foundry-Gemeinde seine Websitedaten leert, ein Aufraeumprogramm, und
 * der Wechsel zwischen `localhost` und der Netzwerkadresse desselben Rechners,
 * die zwei getrennte Vorraete sind.
 *
 * Deshalb steht dieses Netz darunter, und ohne das Netz waere der
 * Browserspeicher als Ablage nicht vertretbar. Es verhindert den Verlust
 * nicht. Es sorgt dafuer, dass der Spielleiter ihn ZU HAUSE MIT VERBINDUNG
 * bemerkt, wo er zwei Klicks kostet, statt am Spieltisch ohne Verbindung, wo
 * er den Abend kostet.
 */

import { MODULE_ID, SETTING, streamEnabled, assetUrl, streamKey, streamBase } from "./stream-settings.mjs"
import { offlineGehalten, offlineHalten, offlineFreigeben,
         gehalteneAdressen, speicherAusfallStand } from "./stream-fetch.mjs"
import { streamAdressenVon } from "./stream-online.mjs"
import { loadStreamManifest } from "./stream-install.mjs"
import { BeneosInstallState, releaseKern } from "../cloud-v2/beneos-install-state.mjs"

/**
 * Vierzehn Tage ohne gueltige Berechtigung, dann fallen die Zusagen.
 *
 * Sieben waren erwogen und sind verworfen: eine Gruppe mit zweiwoechigem
 * Rhythmus, deren Spielleiter die Welt nur zum Spielen oeffnet, staende damit
 * an JEDEM Termin ohne Vorrat da, obwohl sie durchgehend zahlt. Dazu
 * Sommerpause, Krankheit, Reisewochen. Eine kurze Frist trifft treue Kunden
 * haerter als Abgreifer, denn wer wirklich abgreifen will, schaltet das Modul
 * ab und ist von keiner Frist erreichbar.
 *
 * Nach Ablauf laufen die Dateien in die gewoehnliche Frist von 72 Stunden,
 * werden also nicht sofort geloescht. Effektiv sind es siebzehn Tage.
 */
export const VERFALL_TAGE = 14
const TAG_MS = 24 * 60 * 60 * 1000

/**
 * Das Kontingent, solange das Tor keines nennt.
 *
 * Betreiberentscheidung vom 29.08.2026: drei Gigabyte zu Beginn, plus ein
 * halbes je vollem Monat Mitgliedschaft, gedeckelt bei sieben. Berechnet wird
 * das in der Cloud beim Bau des Berechtigungssatzes; bis das steht, gilt hier
 * der Startwert fuer alle.
 *
 * Sieben Gigabyte sind nicht willkuerlich: es ist der Anteil des gemessenen
 * Browserkontingents von rund zehn, den die Hausordnung in `stream-fetch.mjs`
 * fuer offline gehaltene Dateien reserviert.
 */
export const KONTINGENT_VORGABE = 3 * 1024 * 1024 * 1024
export const KONTINGENT_DECKEL = 7 * 1024 * 1024 * 1024

/**
 * Wie viel dieser Kunde offline halten darf.
 *
 * Liest den Wert aus dem Berechtigungssatz, sobald das Tor ihn mitliefert, und
 * faellt sonst auf den Startwert zurueck. Die Trennung steht hier und nicht
 * beim Aufrufer, damit spaeter genau eine Stelle zu aendern ist.
 */
export function kontingent() {
  try {
    const b = Number(globalThis.BeneosStream?._offlineBytes)
    if (b > 0) return Math.min(b, KONTINGENT_DECKEL)
  } catch (_) { }
  return KONTINGENT_VORGABE
}

/** Zwei Warnungen, bevor es soweit ist. */
const WARNUNG_AB_TAGEN = 3

// ---- Das Verzeichnis ---------------------------------------------------

function lies() {
  try { return game.settings.get(MODULE_ID, SETTING.offlineHeld) || {} }
  catch (_) { return {} }
}

async function schreib(alle) {
  try { await game.settings.set(MODULE_ID, SETTING.offlineHeld, alle) }
  catch (e) { console.warn("Beneos Stream | Offline-Verzeichnis nicht schreibbar", e) }
}

/** Die Kennung einer Karte, eindeutig ueber alle Releases und Varianten. */
export function karteId(release, variant, karte) {
  return `${release}|${variant}|${karte}`
}

/** Alle zugesagten Karten, als Liste. */
export function alleKarten() {
  return Object.values(lies()).filter(e => e && typeof e === "object")
}

// ---- Der Gemeinschaftsvorrat -------------------------------------------

function liesGeteilt() {
  try { return game.settings.get(MODULE_ID, SETTING.offlineGeteilt) || {} }
  catch (_) { return {} }
}

async function schreibGeteilt(alle) {
  try { await game.settings.set(MODULE_ID, SETTING.offlineGeteilt, alle) }
  catch (e) { console.warn("Beneos Stream | Gemeinschaftsvorrat nicht schreibbar", e) }
}

/**
 * Eine geteilte Datei erkennt man an ihrem Pfad.
 *
 * `map_assets/` ist der Ordner, in dem die Symbole und Hilfsbilder liegen, die
 * jede Beneos-Szene zieht: Kompass, Bedienleiste, Stop-Symbol. Sie gehoeren
 * keinem Ort im Manifest, deshalb kennt sie keine Karte.
 *
 * Die Regel steht bewusst an EINER Stelle. Wer sie an zwei Orten schreibt,
 * bekommt frueher oder spaeter zwei verschiedene Antworten auf dieselbe Datei,
 * und dann liegt etwas im Vorrat, das niemand mehr freigibt.
 */
export function istGeteilteDatei(url) {
  return /\/map_assets\//.test(String(url || ""))
}

/**
 * Die geteilten Adressen EINER Karte.
 *
 * Das Kartenverzeichnis fuehrt unter `urls` nur die eigenen Dateien; die
 * geteilten stehen im Gemeinschaftsvorrat, und die Zugehoerigkeit haengt dort
 * an der Besitzerliste `karten`. Wer die Vollstaendigkeit einer Karte prueft,
 * braucht beide Haelften, sonst prueft er zwei Fuenftel und nennt das ganz.
 */
function geteilteVonKarte(id, vorrat = liesGeteilt()) {
  const raus = []
  for (const [url, e] of Object.entries(vorrat)) {
    if (e && typeof e === "object" && (e.karten || []).includes(id)) raus.push(url)
  }
  return raus
}

/**
 * Ein Index von jeder eigenen Adresse auf die geteilten Dateien ihrer Szene.
 *
 * WARUM ES DEN INDEX BRAUCHT
 *
 * Das Verzeichnis des Gemeinschaftsvorrats fuehrt, was beim Zusagen bekannt
 * war. Das ist zu wenig, sobald das Modul lernt, eine bisher uebersehene Stelle
 * im Szenendokument zu lesen: die neuen Adressen stehen dort nicht, und eine
 * Pruefung, die nur das Verzeichnis fragt, meldet die Karte weiter als
 * vollstaendig, waehrend die Szenenwache sie ablehnt. GEMESSEN am 2026-09-01,
 * nachdem die Symbole der Kartenmarker dazukamen: Wache 14 von 17 Adressen und
 * "unvollstaendig", Pruefung "2 von 2 vollstaendig". Genau der Widerspruch, den
 * dieser Umbau beseitigen soll.
 *
 * DIE ZUORDNUNG LAEUFT UEBER DIE ADRESSEN, NICHT UEBER DEN INSTALLATIONSVERMERK.
 * Der fuehrt seit dem 30.08.2026 ein Feld `karten` mit den Szenen je Karte,
 * aber nur fuer Installationen seit diesem Tag. Gemessen im Pruefstand: 3 von
 * 18 Vermerken tragen es. Ausgerechnet die Altbestaende, um die es hier geht,
 * faenden sich darueber nie.
 *
 * Der Karteneintrag fuehrt seine eigenen Dateien in `urls`. Eine Szene gehoert
 * zur Karte, wenn eine dieser Adressen in ihr vorkommt. Das ist netzfrei,
 * braucht kein Manifest und benutzt in `streamAdressenVon` dieselbe Funktion
 * wie die Szenenwache; die beiden koennen damit nicht mehr auseinanderlaufen.
 *
 * Einmal je Pruefung gebaut, nicht je Karte: sonst liefe der Weltstart bei
 * dreissig Zusagen dreissigmal ueber alle Szenen der Welt.
 */
function geteilterIndex() {
  const index = new Map()
  for (const szene of game.scenes ?? []) {
    const adressen = streamAdressenVon(szene) || []
    const geteilt = adressen.filter(istGeteilteDatei)
    if (!geteilt.length) continue
    for (const u of adressen) {
      if (istGeteilteDatei(u)) continue
      let eintrag = index.get(u)
      if (!eintrag) { eintrag = { szenen: [], geteilt: new Set() }; index.set(u, eintrag) }
      eintrag.szenen.push(szene.id)
      for (const g of geteilt) eintrag.geteilt.add(g)
    }
  }
  return index
}

/**
 * Alle geteilten Adressen einer Karte, aus dem Verzeichnis UND aus ihren Szenen.
 *
 * Ohne Abkuerzung nach dem ersten Treffer. Eine Karte ist Battlemap und
 * Szenerie zusammen, also mindestens zwei Szenen, und dass beide dieselben
 * Symbole tragen ist eine plausible Annahme, keine gemessene. Die Vereinigung
 * kostet einen Durchlauf ueber zwei bis vier Adressen und macht die Annahme
 * ueberfluessig.
 */
function geteilteAdressenDerKarte(e, vorrat = liesGeteilt(), index = null) {
  const raus = new Set(geteilteVonKarte(karteId(e.release, e.variant, e.karte), vorrat))
  const idx = index || geteilterIndex()
  for (const u of (e.urls || [])) {
    const treffer = idx.get(u)
    if (!treffer) continue
    for (const g of treffer.geteilt) raus.add(g)
  }
  return [...raus]
}

/** Die Szenen einer Karte, ueber dieselbe Zuordnung wie ihre geteilten Dateien. */
function szenenDerKarte(e, index) {
  const raus = new Set()
  for (const u of (e.urls || [])) {
    for (const id of (index.get(u)?.szenen || [])) raus.add(id)
  }
  return [...raus]
}

/**
 * Was der Gemeinschaftsvorrat wiegt, und wie viele Dateien er fuehrt.
 *
 * Markierte Eintraege zaehlen nicht mit. Ein `fehlt`-Vermerk sagt, dass die
 * Datei nicht mehr im Speicher liegt; sie zu berechnen hiesse, dem Kunden
 * Kontingent fuer Bytes abzuziehen, die er gar nicht hat. Siehe
 * `geteilteLuecken`.
 */
export function geteilterStand() {
  const alle = Object.values(liesGeteilt()).filter(e => e && typeof e === "object" && !e.fehlt)
  return { dateien: alle.length, bytes: alle.reduce((s, e) => s + (Number(e.bytes) || 0), 0) }
}

/**
 * Was die zugesagten Karten zusammen wiegen, und wie viele es sind.
 *
 * Der Gemeinschaftsvorrat zaehlt MIT, aber nur einmal. Er liegt genauso im
 * Speicher des Kunden wie eine Karte, und ein Kontingent, das ihn nicht sieht,
 * waere um seine Groesse zu grosszuegig. `karten` bleibt die Zahl der Karten,
 * denn das ist die Einheit, in der der Kunde denkt.
 */
export function vorratsstand() {
  const liste = alleKarten()
  const geteilt = geteilterStand()
  return {
    karten: liste.length,
    bytes: liste.reduce((s, e) => s + (Number(e.bytes) || 0), 0) + geteilt.bytes,
    geteiltBytes: geteilt.bytes,
    geteiltDateien: geteilt.dateien,
  }
}

/** Ist diese Karte zugesagt? Reine Frage an das Verzeichnis, nicht an den Speicher. */
export function istZugesagt(release, variant, karte) {
  return Boolean(lies()[karteId(release, variant, karte)])
}

/**
 * Das Tor um eine Karte bitten, oder sie ihm zurueckgeben.
 *
 * WARUM DAS TOR UND NICHT DIESES MODUL ENTSCHEIDET
 *
 * Die Pruefung weiter unten kennt nur den Vorrat DIESER Welt. Das Kontingent
 * gilt aber je Konto, und ein Kunde kann sich in zehn Sekunden eine zweite
 * Welt anlegen. Nur das Tor sieht alle Welten eines Kontos zusammen.
 *
 * Ausserdem kennt nur das Tor die Groessen aus erster Hand. Eine Zahl, die der
 * Gezaehlte selbst liefert, ist keine Abrechnung: der Schluessel steht im
 * Klartext in jedem Szenendokument, wer ihn kennt, schickt Null.
 *
 * Die Pruefung im Modul bleibt trotzdem stehen. Sie erspart im Normalfall
 * einen Abruf und eine Wartezeit, und sie kann dem Kunden sofort sagen, warum
 * es nicht geht. Sie ist Komfort, nicht die Grenze.
 */
async function torFragen(weg, methode = "GET") {
  const schluessel = streamKey()
  if (!schluessel) return { ok: false, grund: "kein-schluessel" }
  const basis = streamBase().replace(/\/+$/, "")
  try {
    const r = await fetch(`${basis}/offline/${encodeURIComponent(schluessel)}${weg}`,
      { method: methode })
    let inhalt = null
    try { inhalt = await r.json() } catch (_) { inhalt = null }
    if (!r.ok && r.status !== 409) {
      return { ok: false, grund: "tor-fehler", status: r.status, inhalt }
    }
    return { ok: Boolean(inhalt && inhalt.ok), status: r.status, inhalt }
  } catch (e) {
    // Kein Netz. Eine Karte offline zu nehmen heisst, sie zu holen, und das
    // braucht ohnehin das Tor. Also ist das hier kein Sonderfall, sondern
    // derselbe Fall, nur frueher erkannt.
    return { ok: false, grund: "kein-netz" }
  }
}

const kartenWeg = (release, variant, karte) =>
  `/${encodeURIComponent(release)}/${encodeURIComponent(variant)}/${encodeURIComponent(karte)}`

/**
 * Eine Karte zusagen: erst das Tor fragen, dann holen, dann eintragen.
 *
 * Die Reihenfolge ist bindend. Ein Eintrag, dessen Dateien nicht liegen, waere
 * genau die Luege, die dieses Verzeichnis aufdecken soll. Und ein Holen ohne
 * Zusage des Tors waere ein Kontingent, das nur diese eine Welt kennt.
 */
export async function karteZusagen({ release, variant, karte, name, urls, bytes, geteilt, onProgress }) {
  if (!streamEnabled()) return { ok: false, grund: "kein-streaming" }
  const liste = [...new Set((urls || []).filter(Boolean))]
  if (!liste.length) return { ok: false, grund: "keine-dateien" }

  // ZWEI FRAGEN, ZWEI LISTEN.
  //
  // "Kostet Kontingent" und "muss geholt werden" sind nicht dasselbe, und sie
  // in einer Liste zu fuehren war der Fehler. Das Verzeichnis des
  // Gemeinschaftsvorrats und der Speicher koennen auseinanderlaufen: Chrome
  // raeumt unter Druck einen ganzen Ursprung, das Verzeichnis bleibt stehen.
  // Ein Filter, der nur das Verzeichnis fragt, ueberspringt dann genau die
  // Dateien, die fehlen, und die Luecke wird nie wieder geschlossen.
  //
  // GEMESSEN am 2026-09-01 im Pruefstand V14: eine zugesagte Karte brauchte
  // fuenf Adressen, zwei lagen im Speicher, die drei geteilten fehlten. Die
  // Szene wurde ohne Verbindung abgelehnt, obwohl der Kunde sie ausdruecklich
  // offline gestellt hatte.
  const geteiltVorrat = liesGeteilt()
  const geteiltListe = (geteilt || []).filter(g => g?.url)
  // Unbekannt heisst: das Verzeichnis kennt sie nicht, oder es fuehrt sie als
  // fehlend. Nur das kostet Kontingent, denn was das Verzeichnis ungemarkt
  // fuehrt, zaehlt `geteilterStand` bereits mit; beides zu zaehlen hiesse,
  // dieselbe Datei doppelt zu berechnen.
  const geteiltUnbekannt = geteiltListe.filter(g => !geteiltVorrat[g.url] || geteiltVorrat[g.url].fehlt)
  const geteiltNeuBytes = geteiltUnbekannt.reduce((s, g) => s + (Number(g.bytes) || 0), 0)
  // Die zweite Liste, "liegt nicht im Speicher", entsteht erst weiter unten.
  // Sie kostet einen Speicherzugriff je Datei, und den soll niemand bezahlen,
  // dessen Zusage gleich am Kontingent oder am Tor scheitert.

  // DAS KONTINGENT WIRD VOR DEM HOLEN GEPRUEFT, NICHT DANACH.
  //
  // Bis zum 29.08.2026 gab es diese Pruefung gar nicht. `offlineHalten` kennt
  // nur den Deckel des BROWSERS, also sieben Zehntel dessen, was der Browser
  // hergibt; gemessen waren das 7,3 GB statt der vereinbarten 3. Das
  // Kontingent stand in der Anzeige und wirkte nirgends.
  //
  // Geprueft wird vorher, weil eine Karte, die erst geholt und dann abgelehnt
  // wird, ihre Bytes bereits verbraucht hat. Die Groesse steht dafuer im
  // Manifest und kommt ueber `karteZuSzene` mit.
  //
  // Das ist Komfort, keine Sicherung: wer seinen Schluessel kennt, kann am
  // Modul vorbei holen. Die verbindliche Grenze zieht das Tor.
  const schon = vorratsstand().bytes
  const grenze = kontingent()
  // Die noch fehlenden geteilten Dateien zaehlen mit. Sie liegen sonst im
  // Speicher, ohne dass das Kontingent sie kennt.
  const braucht = (Number(bytes) || 0) + geteiltNeuBytes
  if (braucht > 0 && schon + braucht > grenze) {
    return {
      ok: false, grund: "kontingent",
      belegt: schon, grenze, braucht, frei: Math.max(0, grenze - schon),
    }
  }

  // Das Tor fragen, BEVOR ein Byte fliesst. Sagt es nein, wird nicht geholt.
  const zusage = await torFragen(kartenWeg(release, variant, karte))
  if (!zusage.ok) {
    if (zusage.status === 409 && zusage.inhalt?.reason === "quota") {
      return {
        ok: false, grund: "kontingent",
        belegt: zusage.inhalt.used, grenze: zusage.inhalt.quota,
        braucht: zusage.inhalt.needs, frei: zusage.inhalt.free,
      }
    }
    return { ok: false, grund: zusage.grund || "tor-abgelehnt", status: zusage.status }
  }

  const ergebnis = await offlineHalten(liste, onProgress)
  if (ergebnis.deckelErreicht) {
    // Nicht geholt heisst nicht gehalten: die Zusage sofort zurueckgeben,
    // sonst zaehlt das Tor Bytes, die nirgends liegen.
    await torFragen(kartenWeg(release, variant, karte) + "/release", "POST")
    return { ok: false, grund: "deckel", ergebnis }
  }
  if (ergebnis.fehlgeschlagen > 0) {
    // Halb gehalten ist schlechter als gar nicht: die Karte belegt Platz und
    // zeichnet trotzdem nicht. Also zuruecknehmen, was schon liegt, und die
    // Zusage gleich mit.
    await offlineFreigeben(liste)
    await torFragen(kartenWeg(release, variant, karte) + "/release", "POST")
    return { ok: false, grund: "unvollstaendig", ergebnis }
  }

  // DIE GETEILTEN DATEIEN NACH DER KARTE, NICHT VORHER.
  //
  // Scheitert die Karte, sind sie umsonst geholt. Scheitern SIE, ist die Karte
  // trotzdem etwas wert: sie zeichnet, nur ohne ihre Symbole. Deshalb bricht
  // ein Fehlschlag hier die Zusage nicht ab, er wird vermerkt.
  //
  // Eingetragen wird nur, was wirklich liegt. Ein Eintrag ohne Bytes waere
  // dieselbe Luege, die das Kartenverzeichnis vermeiden soll, nur eine Ebene
  // tiefer, und niemand wuerde ihn je wieder los.
  const meineId = karteId(release, variant, karte)
  let geteiltGeholt = 0, geteiltFehlt = 0
  if (geteiltListe.length) {
    const vorrat = liesGeteilt()
    // Zu holen heisst: liegt nicht im Speicher. Obermenge von `geteiltUnbekannt`,
    // denn ein Eintrag ohne Datei ist genau der Zustand, den `geteilteLuecken`
    // aufraeumt; er entsteht aber auch mitten in einer Sitzung, wenn der Browser
    // unter Speicherdruck den ganzen Ursprung raeumt.
    const geteiltZuHolen = []
    for (const g of geteiltListe) {
      if (!(await offlineGehalten([g.url]))) geteiltZuHolen.push(g)
    }
    if (geteiltZuHolen.length) {
      const erg = await offlineHalten(geteiltZuHolen.map(g => g.url))
      geteiltFehlt = Number(erg.fehlgeschlagen) || 0
      for (const g of geteiltZuHolen) {
        // `offlineGehalten` und nicht `alleImSpeicher`: Letzteres nickt auch
        // frische Wegwerfware ohne Dauerstempel ab, und die raeumt der naechste
        // `raumSchaffen` weg. Dann stuende wieder ein Eintrag im Verzeichnis
        // ohne Datei dahinter, also genau der Zustand, den dieser Umbau
        // beseitigt.
        if (!(await offlineGehalten([g.url]))) continue
        // Die Besitzerliste erhalten. `geteiltZuHolen` enthaelt auch Dateien,
        // die das Verzeichnis bereits fuehrt, deren Datei aber fehlte; sie
        // pauschal auf `[meineId]` zu setzen naehme allen anderen Karten ihren
        // Verweis, und die erste geloeste Karte risse ihnen die Symbole weg.
        vorrat[g.url] = { bytes: Number(g.bytes) || 0, karten: vorrat[g.url]?.karten || [] }
        geteiltGeholt++
      }
    }
    // Auch die schon liegenden bekommen diese Karte als Verweis, sonst gaebe
    // die erste geloeste Karte Dateien frei, die eine zweite noch braucht.
    for (const g of geteiltListe) {
      const e = vorrat[g.url]
      if (!e) continue
      e.karten = [...new Set([...(e.karten || []), meineId])]
    }
    await schreibGeteilt(vorrat)
  }

  const alle = lies()
  alle[meineId] = {
    release, variant, karte,
    name: String(name || karte),
    urls: liste,
    // Die Groesse aus dem Manifest hat Vorrang vor der gemessenen: sie ist
    // dieselbe Zahl, gegen die vorher geprueft wurde, und `content-length`
    // fehlt bei manchen Antworten ganz.
    //
    // NUR DIE EIGENEN BYTES. Die geteilten stehen im Gemeinschaftsvorrat und
    // werden von `vorratsstand` dort gezaehlt; sie hier mitzuschreiben hiesse,
    // sie doppelt zu zaehlen.
    bytes: (Number(bytes) || 0) || Number(ergebnis.bytes) || 0,
    // Gekauft oder gemietet, so wie das Tor es sieht. Es weiss es als
    // einziges, denn nur dort liegt der Berechtigungssatz mit seinem
    // `kind`. Ohne diese Zeile faellt die Auskunft auf den Boden und der
    // Verfall trifft auch, wer das Release besitzt.
    permanent: zusage.inhalt?.permanent === true,
    seit: Date.now(),
  }
  await schreib(alle)
  return { ok: true, ergebnis, geteiltGeholt, geteiltFehlt }
}

/**
 * Diese Karte aus dem Gemeinschaftsvorrat austragen.
 *
 * Eine geteilte Datei geht erst, wenn KEINE Karte sie mehr braucht. Wer sie
 * mit der ersten Karte freigaebe, risse den anderen ihre Symbole weg, und der
 * Kunde saehe seine uebrigen Offline-Karten wieder abgelehnt, ohne dass er
 * etwas an ihnen getan haette.
 *
 * @returns {{freigegeben: number, bytes: number}}
 */
async function geteiltAustragen(kartenIds) {
  const weg = new Set(kartenIds)
  const vorrat = liesGeteilt()
  const frei = []
  let bytes = 0
  for (const [url, e] of Object.entries(vorrat)) {
    if (!e || typeof e !== "object") { delete vorrat[url]; continue }
    const rest = (e.karten || []).filter(id => !weg.has(id))
    if (rest.length) { e.karten = rest; continue }
    frei.push(url)
    bytes += Number(e.bytes) || 0
    delete vorrat[url]
  }
  if (frei.length) {
    try { await offlineFreigeben(frei) }
    catch (err) { console.warn("Beneos Stream | geteilte Dateien nicht freigegeben", err) }
  }
  await schreibGeteilt(vorrat)
  return { freigegeben: frei.length, bytes }
}

/**
 * Eine Zusage zuruecknehmen. Die Bytes bleiben zunaechst liegen.
 *
 * Das Tor wird gefragt, sein Ergebnis aber nicht abgewartet in dem Sinn, dass
 * ein Fehlschlag die Ruecknahme verhinderte. Der Kunde hat die Karte im Modul
 * freigegeben; ihm das zu verweigern, weil das Tor gerade nicht antwortet,
 * hiesse, sein Kontingent zu sperren statt es zu fuehren. Beim naechsten
 * Weltstart laeuft der Abgleich ohnehin.
 */
export async function karteLoesen(release, variant, karte) {
  const alle = lies()
  const id = karteId(release, variant, karte)
  const eintrag = alle[id]
  if (!eintrag) return { ok: false, grund: "nicht-zugesagt" }
  await offlineFreigeben(eintrag.urls || [])
  delete alle[id]
  await schreib(alle)
  const geteilt = await geteiltAustragen([id])
  const beimTor = await torFragen(kartenWeg(release, variant, karte) + "/release", "POST")
  return { ok: true, beimTor: beimTor.ok, geteilt }
}

/**
 * Jede Zusage eines Release zuruecknehmen.
 *
 * DER DEINSTALLIERER MUSS DAS RUFEN, SONST ENTSTEHT EIN LECK, DAS DER KUNDE
 * NICHT SEHEN UND NICHT BEHEBEN KANN.
 *
 * `forget()` loescht den Installationsvermerk. Ohne ihn kennt
 * `releaseOfflineStand()` das Release nicht mehr, es verschwindet aus dem
 * Offline-Reiter, und seine Karten sind ueber die Oberflaeche nicht mehr
 * anzuklicken. Beim Tor bleiben sie trotzdem gebucht. Bei 3 GB Kontingent und
 * Karten zu rund 70 MB kostet jedes Entfernen-und-neu-Installieren also
 * dauerhaft Platz ohne sichtbare Ursache.
 *
 * ANDERS ALS BEIM VERFALL BLEIBEN GEKAUFTE KARTEN NICHT VERSCHONT. Der Verfall
 * nimmt einem Kunden etwas weg, deshalb schuetzt `permanent` dort. Hier hat er
 * selbst auf Entfernen geklickt und will die Dateien los sein; ihm ausgerechnet
 * das Gekaufte dazulassen, waere die falsche Freundlichkeit.
 *
 * Ohne Netz wird trotzdem lokal geloest, aus demselben Grund wie bei
 * `karteLoesen`: ein stummes Tor darf das Kontingent des Kunden nicht sperren.
 * Der Abgleich laeuft beim naechsten Weltstart.
 *
 * @param {string} release   Verzeichnisname des Release
 * @param {string} variant   Variante, Gross- und Kleinschreibung egal
 */
export async function releaseLoesen(release, variant) {
  const rel = String(release || "")
  const v = String(variant || "").toLowerCase()
  const alle = lies()
  const passt = (e) => e && typeof e === "object"
    && String(e.variant || "").toLowerCase() === v
  let treffer = Object.entries(alle).filter(([, e]) => passt(e) && String(e.release || "") === rel)

  // Der Deinstallierer kommt mit der Schreibweise des Katalogs, das
  // Verzeichnis kann die des Vermerks tragen. Ohne diesen Rueckfall blieben
  // genau die alten Eintraege gebucht, deren Release entfernt wird, und das
  // ist das Leck, das diese Funktion schliessen soll. Siehe `releaseKern`.
  if (!treffer.length) {
    const kern = releaseKern(rel)
    if (kern) {
      treffer = Object.entries(alle).filter(([, e]) =>
        passt(e) && releaseKern(String(e.release || "")) === kern)
    }
  }

  if (!treffer.length) return { ok: true, geloest: 0, bytes: 0, beimTor: 0 }

  let bytes = 0
  for (const [id, e] of treffer) {
    try { await offlineFreigeben(e.urls || []) }
    catch (err) { console.warn("Beneos Stream | Bytes einer Karte nicht freigegeben", id, err) }
    bytes += Number(e.bytes) || 0
    delete alle[id]
  }
  // Ein Schreibvorgang fuer alle: das Verzeichnis liegt in einer
  // Welteinstellung, und je Karte zu schreiben hiesse, bei einem Release mit
  // zwoelf Karten zwoelf Mal dieselbe Einstellung zu setzen.
  await schreib(alle)
  const geteilt = await geteiltAustragen(treffer.map(([id]) => id))

  let beimTor = 0
  for (const [, e] of treffer) {
    // `e.release`, nicht `rel`: gebucht wurde unter der Schreibweise des
    // Vermerks. Wer hier die des Katalogs schickte, loeste beim Tor eine
    // Karte, die es dort nicht gibt, und liesse die echte stehen.
    const antwort = await torFragen(kartenWeg(e.release, e.variant, e.karte) + "/release", "POST")
    if (antwort.ok) beimTor++
  }
  return { ok: true, geloest: treffer.length, bytes, beimTor, geteilt }
}

// ---- Von der Szene zur Karte ------------------------------------------

/**
 * Die Manifeste dieser Sitzung, damit ein Rechtsklick nicht jedes Mal das Tor
 * fragt. Ein Manifest ist wenige hundert Kilobyte, die Karte einer Szene
 * aendert sich nie.
 *
 * BEIDE FRISTEN SIND GEMESSEN, NICHT GERATEN.
 *
 * Der Vorrat hielt bis zum 29.08.2026 fuer die ganze Sitzung. Am selben Tag
 * wurden alle Manifeste des Bestands auf Schema 4 gehoben, und eine laufende
 * Welt fand danach fuer KEINE ihrer 187 Szenen eine Karte, obwohl die neuen
 * Manifeste am Tor lagen: sie hielt das alte, das noch keine kannte. Erst ein
 * Neuladen half. Zehn Minuten fangen genau diesen Fall, ohne den Rechtsklick
 * teuer zu machen.
 *
 * Ein Fehlschlag darf nicht so lange gelten. Ein Manifest, das einmal nicht
 * ankommt, weil das Tor kurz nicht antwortet, machte die Karte sonst fuer die
 * ganze Sitzung unbekannt, und der Kunde saehe seinen Rechtsklick-Eintrag
 * ohne Grund nicht mehr. Dreissig Sekunden lassen den naechsten Versuch zu,
 * ohne bei anhaltender Stoerung zu haemmern.
 */
const manifestCache = new Map()
const MANIFEST_FRIST_MS = 10 * 60 * 1000
const MANIFEST_FEHLER_MS = 30 * 1000

async function manifestVon(release, variant) {
  const id = `${release}|${variant}`
  const jetzt = Date.now()
  const gemerkt = manifestCache.get(id)
  if (gemerkt && jetzt < gemerkt.bis) return gemerkt.wert
  try {
    const m = await loadStreamManifest(release, variant)
    manifestCache.set(id, { wert: m, bis: jetzt + MANIFEST_FRIST_MS })
    return m
  } catch (_) {
    manifestCache.set(id, { wert: null, bis: jetzt + MANIFEST_FEHLER_MS })
    return null
  }
}

/**
 * Release, Variante und Dateipfad aus einer Toradresse zurueckgewinnen.
 *
 * Form: `<tor>/a/<schluessel>/<release>/<variante>/<pfad...>`. Der Pfad ist
 * beim Bauen je Abschnitt kodiert worden, also wird er je Abschnitt wieder
 * entschluesselt.
 */
function zerlegeAdresse(url) {
  try {
    const u = new URL(url)
    const teile = u.pathname.replace(/^\/+/, "").split("/")
    if (teile[0] !== "a" || teile.length < 5) return null
    return {
      release: decodeURIComponent(teile[2]),
      variant: decodeURIComponent(teile[3]),
      pfad: teile.slice(4).map(decodeURIComponent).join("/"),
    }
  } catch (_) { return null }
}

/**
 * Welche Karte gehoert zu dieser Szene?
 *
 * NICHT ueber die Szenen-Kennung aus dem Paket. Die steht zwar im Manifest,
 * aber ob sie den Import in eine Welt unveraendert uebersteht, haengt am
 * Packer und ist damit eine Annahme. Die Dateipfade dagegen stehen in den
 * Toradressen der Szene selbst und sind genau das, was ausgeliefert wurde.
 *
 * Gibt `null` zurueck, wenn die Szene nichts Gestreamtes traegt, wenn das
 * Manifest nicht erreichbar ist, oder wenn es noch kein `places` fuehrt. Der
 * dritte Fall ist waehrend der Umstellung der Normalfall: die ausgelieferten
 * Manifeste tragen das Feld erst nach ihrer Neuerzeugung.
 */
export async function karteZuSzene(scene) {
  const adressen = streamAdressenVon(scene)
  if (!adressen.length) return null
  const erste = zerlegeAdresse(adressen[0])
  if (!erste) return null

  // ERST DER INSTALLATIONSVERMERK, DANN DAS TOR.
  //
  // Der Vermerk fuehrt seit dem 30.08.2026 die Karten mit, die eine
  // Installation angelegt hat. Er liegt in der Welt und braucht keine
  // Verbindung, und genau das ist der Punkt: ohne ihn scheitert jeder
  // Rechtsklick ohne Netz, also gerade dann, wenn ein Spielleiter vorbereitet.
  //
  // Was er NICHT fuehrt, sind die Dateipfade; die machten drei Viertel seiner
  // Groesse aus. Sie werden hier aus dem Manifest nachgeholt, und wenn das
  // nicht geht, gibt es die Karte trotzdem, nur ohne `urls`. Der Aufrufer
  // erkennt das an der leeren Liste: Anzeigen geht, Holen nicht. Ein Holen
  // ohne Verbindung waere ohnehin aussichtslos.
  const ausVermerk = BeneosInstallState.findKarteByScene(String(scene?.id || ""))

  const m = await manifestVon(erste.release, erste.variant)
  if (!m?.places?.length) {
    if (!ausVermerk) return null
    return {
      release: ausVermerk.release || erste.release,
      variant: ausVermerk.variant || erste.variant,
      karte:   ausVermerk.karte,
      name:    ausVermerk.name,
      kind:    "",
      urls:    [],
      bytes:   ausVermerk.bytes,
      ausVermerk: true,
    }
  }

  // Die Pfade dieser Szene, damit der Vergleich nicht ueber ganze Adressen
  // laeuft: der Schluessel darin kann sich drehen, der Pfad nicht.
  //
  // OHNE die geteilten Dateien. Sie gehoeren zu keinem Ort, und wuerde je ein
  // Ort eine von ihnen fuehren, faende JEDE Szene mit demselben Symbol diesen
  // einen Ort. Gemessen am 2026-09-01 fuehrt kein Ort eine map_assets-Datei,
  // 0 von 28 Orten ueber 94 Dateien; die Zeile schuetzt also nicht gegen den
  // heutigen Bestand, sondern gegen ein spaeteres Manifest.
  const pfade = new Set(adressen.filter(a => !istGeteilteDatei(a))
    .map(a => zerlegeAdresse(a)?.pfad).filter(Boolean))

  // Die Groessen stehen je Datei in `entries`. Sie hier mitzugeben ist die
  // Bedingung dafuer, dass das Kontingent VOR dem Holen geprueft werden kann:
  // wer erst holt und dann rechnet, hat die Bytes bereits auf der Platte.
  const groesse = new Map()
  for (const e of m.entries || []) groesse.set(e.key, Number(e.bytes) || 0)

  for (const platz of m.places) {
    if (!(platz.files || []).some(f => pfade.has(f))) continue
    const dateien = platz.files || []
    return {
      release: erste.release,
      variant: erste.variant,
      karte: platz.id,
      name: platz.name || platz.id,
      kind: platz.kind || "",
      // Die vollen Adressen ALLER Dateien der Karte, nicht nur der dieser
      // Szene: eine Karte ist Battlemap und Szenerie zusammen, und wer nur die
      // eine haelt, hat beim Umschalten auf die andere doch wieder ein Loch.
      urls: dateien.map(f => assetUrl(erste.release, erste.variant, f)),
      bytes: dateien.reduce((s, f) => s + (groesse.get(f) || 0), 0),
      // DIE GETEILTEN DATEIEN DIESER SZENE, GETRENNT GEFUEHRT.
      //
      // Sie gehoeren zu keinem Ort im Manifest, werden aber gebraucht, damit
      // die Szene ohne Leitung vollstaendig zeichnet. Getrennt, weil sie
      // mehreren Karten gehoeren und deshalb nur einmal zaehlen duerfen.
      geteilt: adressen
        .filter(istGeteilteDatei)
        .map(u => ({ url: u, bytes: groesse.get(zerlegeAdresse(u)?.pfad) || 0 })),
    }
  }
  return null
}

/**
 * Der Zustand einer Szene fuer die Oberflaeche, in einem Aufruf.
 *
 * `passt` sagt, ob diese Karte ins verbleibende Kontingent geht. Es steht hier
 * und nicht erst im Klick, damit das Kontextmenue den Eintrag gleich als
 * untaetig zeigen kann, statt den Spielleiter klicken zu lassen und ihm dann
 * abzusagen.
 */
export async function szenenzustand(scene) {
  const karte = await karteZuSzene(scene)
  if (!karte) return { bekannt: false }
  const zugesagt = istZugesagt(karte.release, karte.variant, karte.karte)
  const frei = Math.max(0, kontingent() - vorratsstand().bytes)
  // Dieselbe Rechnung wie in `szenenVorschau`: was diese Karte wirklich kostet,
  // sind ihre eigenen Bytes plus die geteilten Dateien, die noch nicht liegen.
  const schonGeteilt = liesGeteilt()
  const geteiltBytes = (karte.geteilt || [])
    .filter(g => g?.url && !schonGeteilt[g.url])
    .reduce((s, g) => s + (Number(g.bytes) || 0), 0)
  const kostet = (Number(karte.bytes) || 0) + geteiltBytes
  return {
    bekannt: true, karte, zugesagt,
    kostet, geteiltBytes,
    passt: zugesagt || kostet <= frei,
    frei,
  }
}

/**
 * Alle Szenen eines Ordners, samt Unterordnern.
 *
 * Rekursiv, weil ein Spielleiter seine Kampagne gliedert und "alles hier
 * drunter" das ist, was er beim Rechtsklick auf einen Ordner meint. Foundrys
 * `getSubfolders(true)` liefert die Unterordner in beliebiger Tiefe.
 */
export function szenenImOrdner(folder) {
  if (!folder) return []
  const raus = []
  const gesehen = new Set()
  const sammle = f => {
    for (const s of (f?.contents ?? [])) {
      const id = String(s?.id || "")
      if (!id || gesehen.has(id)) continue
      gesehen.add(id)
      raus.push(s)
    }
  }
  sammle(folder)
  for (const unter of (folder.getSubfolders?.(true) ?? [])) sammle(unter)
  return raus
}

/**
 * Was ein Ordner offline kosten wuerde, und was davon schon liegt.
 *
 * DIE VORSCHAU IST NICHT SCHMUCK, SONDERN DIE BEDINGUNG.
 *
 * Ein Release wiegt zwischen 0,4 und 2,0 GB, das Kontingent beginnt bei 3.
 * Ein Fehlgriff raeumt damit das halbe Kontingent, und die Ruecknahme kostet
 * den Kunden zwar nichts, aber der erneute Griff kostet ihn die Bytes noch
 * einmal. Wer auf einen Ordner klickt, muss vorher sehen, worauf er klickt.
 *
 * Gezaehlt wird je KARTE, nicht je Szene: Battlemap und Szenerie sind zwei
 * Szenen und eine Karte, und ein Ordner mit zwoelf Szenen kostet oft nur sechs
 * Karten. Die Entdopplung laeuft ueber die Kartenkennung.
 *
 * `bytes` ist die Summe der noch NICHT zugesagten Karten. Was schon liegt,
 * kostet nichts mehr, und es als Kosten auszuweisen liesse den Ordner teurer
 * aussehen, als er ist.
 */
export async function ordnerVorschau(folder) {
  return szenenVorschau(szenenImOrdner(folder))
}

/**
 * Dieselbe Vorschau, aber ueber eine beliebige Szenenliste.
 *
 * Der Ordner war der erste Aufrufer, das Release im Cloud-Fenster ist der
 * zweite. Beide fragen dasselbe: was kostet diese Menge Szenen, und was davon
 * liegt schon. `ordnerVorschau` bleibt als Name stehen, weil die Oberflaeche
 * ihn kennt; er reicht jetzt nur durch.
 */
export async function szenenVorschau(szenen) {
  const karten = new Map()
  let ohneKarte = 0

  for (const scene of szenen) {
    const zustand = zustandAusCache(String(scene?.id || "")) || await szenenzustand(scene)
    if (!zustand?.bekannt) { ohneKarte++; continue }
    const k = zustand.karte
    const id = `${k.release}|${k.variant}|${k.karte}`
    if (karten.has(id)) {
      // Dieselbe Karte, zweite Szene. Ihre Kartendateien sind dieselben, ihre
      // GETEILTEN koennen sich unterscheiden: Battlemap und Szenerie eines
      // Ortes ziehen nicht zwangslaeufig dieselben Symbole. Vereinigen statt
      // ueberspringen, sonst fehlte der zweiten Szene offline ihr Kompass.
      const da = karten.get(id)
      const bekannt = new Set((da.geteilt || []).map(g => g.url))
      for (const g of k.geteilt || []) if (!bekannt.has(g.url)) (da.geteilt ||= []).push(g)
      continue
    }
    karten.set(id, { ...k, geteilt: [...(k.geteilt || [])], zugesagt: zustand.zugesagt })
  }

  const liste = [...karten.values()]
  const offen = liste.filter(k => !k.zugesagt)

  // DIE GETEILTEN DATEIEN GEHOEREN IN DIE VORSCHAU, SONST LUEGT SIE.
  //
  // Gemessen am 31.08.2026 auf 14.360: die Vorschau nannte 6.037.384 Bytes,
  // der Vorrat wuchs danach um 6.282.734. Die Differenz von 245.350 waren die
  // geteilten Dateien, die erst beim Holen dazukamen. Bei der ersten Karte
  // einer frischen Welt ist die Abweichung der ganze Symbolsatz.
  //
  // Das ist nicht nur eine schiefe Anzeige: `passt` entscheidet, ob der
  // Rechtsklick ueberhaupt angeboten wird. Eine zu kleine Zahl sagt dicht vor
  // der Grenze "geht noch" und laesst die Zusage danach am Kontingent
  // scheitern.
  //
  // Gezaehlt wird nur, was noch NICHT liegt, und jede Adresse nur einmal, auch
  // wenn mehrere Karten des Ordners sie brauchen.
  const schonGeteilt = liesGeteilt()
  const neueGeteilte = new Map()
  for (const k of offen) {
    for (const g of k.geteilt || []) {
      if (!g?.url || schonGeteilt[g.url] || neueGeteilte.has(g.url)) continue
      neueGeteilte.set(g.url, Number(g.bytes) || 0)
    }
  }
  const geteiltBytes = [...neueGeteilte.values()].reduce((s, n) => s + n, 0)

  const bytes = offen.reduce((s, k) => s + (Number(k.bytes) || 0), 0) + geteiltBytes
  const frei = Math.max(0, kontingent() - vorratsstand().bytes)
  return {
    szenen: szenen.length,
    ohneKarte,
    karten: liste,
    schonDa: liste.length - offen.length,
    offen: offen.length,
    bytes,
    // Getrennt ausgewiesen, damit eine Oberflaeche sagen kann, warum die Summe
    // groesser ist als die Summe der Karten.
    geteiltBytes,
    geteiltDateien: neueGeteilte.size,
    frei,
    passt: bytes <= frei,
  }
}

/**
 * Der Offline-Stand aller installierten Releases, fuer den Reiter im
 * Cloud-Fenster.
 *
 * WARUM DER INSTALLATIONSVERMERK UND NICHT DIE SZENENLISTE
 *
 * Die Szenen einer Welt sagen nicht, zu welchem Release sie gehoeren, ohne
 * dass jemand ihre Dateipfade gegen ein Manifest haelt. Der Vermerk weiss es
 * seit `9c86c93` selbst, mit Karten und Groessen, und er braucht dafuer keine
 * Verbindung. Genau das ist hier der Punkt: der Reiter soll auch ohne Netz
 * etwas zeigen.
 *
 * Ein Vermerk aus der Zeit vor jenem Feld traegt keine Karten. Sein Release
 * erscheint dann mit `unbekannt: true` statt mit einer erfundenen Null, denn
 * "wir wissen es nicht" und "nichts liegt offline" sind verschiedene Aussagen
 * und fuehren die Oberflaeche zu verschiedenen Farben.
 */
export function releaseOfflineStand() {
  const alle = BeneosInstallState.getAll()
  const raus = []

  for (const [, e] of Object.entries(alle)) {
    if (!e || typeof e !== "object" || !e.releaseDir) continue
    const variant = String(e.variant || "").toLowerCase()

    if (!Array.isArray(e.karten) || !e.karten.length) {
      raus.push({
        release: String(e.releaseDir), variant,
        unbekannt: true, gesamt: 0, offline: 0, bytes: 0, stand: "unbekannt",
      })
      continue
    }

    let offline = 0
    let bytes = 0
    for (const k of e.karten) {
      if (!istZugesagt(e.releaseDir, variant, k.id)) continue
      offline++
      bytes += Number(k.bytes) || 0
    }
    raus.push({
      release: String(e.releaseDir), variant,
      unbekannt: false,
      gesamt: e.karten.length,
      offline,
      bytes,
      // Drei Zustaende, nicht zwei: "teilweise" ist der haeufigste Fall, sobald
      // jemand einzelne Karten fuer einen Abend mitnimmt, und ihn mit "nichts"
      // zusammenzuwerfen naehme dem Reiter seinen Zweck.
      stand: offline === 0 ? "keine"
           : offline >= e.karten.length ? "voll"
           : "teil",
    })
  }
  return raus
}

/**
 * Wie der Betriebszustand oben im Cloud-Fenster heisst und aussieht.
 *
 * DAS WORT IST DER ZWECK, NICHT DER STATUS.
 *
 * Betreiberentscheidung vom 30.08.2026: der Kunde soll sehen, DASS gestreamt
 * wird, damit sich das Wort setzt. Deshalb steht "Streaming" da, solange
 * gestreamt wird, auch bei einer wackligen Verbindung. Nur wenn wirklich
 * nichts mehr fliesst, heisst es "Offline".
 *
 * Das Wort traegt drei von vier Zustaenden, die Farbe traegt die Wahrheit.
 * Beides zusammen widerspricht dem Verbindungspunkt am Beneos-Knopf nicht: er
 * liest dieselbe Quelle und benutzt genau diese vier Farben.
 *
 * Reine Rechnung: der Zustand kommt als Parameter herein, damit sie ohne
 * Foundry pruefbar bleibt.
 *
 * @param {"unbekannt"|"online"|"degraded"|"offline"} zustand
 */
export function betriebsanzeige(zustand) {
  const offline = zustand === "offline"
  return {
    zustand,
    offline,
    schluessel: offline ? "BENEOS.Stream.Mode.Offline" : "BENEOS.Stream.Mode.Streaming",
    ersatz:     offline ? "Offline Mode" : "Streaming Mode",
    tipp:       offline ? "BENEOS.Stream.Mode.OfflineTooltip" : "BENEOS.Stream.Mode.StreamingTooltip",
    farbe: zustand === "online"   ? "#5db075"
         : zustand === "degraded" ? "#e0a33a"
         : offline                ? "#c9503f"
         :                          "#8a8a8a",
  }
}

/**
 * Der Offline-Vorrat als Anzeigewerte: Balkenlaenge und zwei Zahlen.
 *
 * Reine Rechnung ueber zwei hereingereichte Werte, damit sie ohne Foundry
 * pruefbar bleibt. Die Werte selbst holt der Aufrufer aus `vorratsstand()`
 * und `kontingent()`, denselben Quellen, aus denen auch das Vorratsfenster
 * und der Punkt-Tooltip lesen. Eine zweite Rechnung waere eine zweite
 * Wahrheit.
 *
 * `knapp` ab neun Zehnteln: von da an ist die Frage nicht mehr "wie viel habe
 * ich noch", sondern "was muss weg", und die Farbe soll das sagen, bevor der
 * Balken voll ist.
 */
export function vorratsanzeige(belegt, grenze) {
  const b = Math.max(0, Number(belegt) || 0)
  const g = Math.max(1, Number(grenze) || 1)
  const gb = n => n >= 1073741824
    ? `${(n / 1073741824).toFixed(1)} GB`
    : `${Math.round(n / 1048576)} MB`
  return {
    belegt: b,
    grenze: g,
    // Gedeckelt: ein Balken, der aus seinem Kasten laeuft, ist keine Anzeige.
    // Ueberschreiten kann der Vorrat, wenn das Kontingent nachtraeglich sinkt.
    prozent: Math.min(100, Math.round((b / g) * 100)),
    knapp: b / g >= 0.9,
    belegtText: gb(b),
    grenzeText: gb(g),
  }
}

/** Die Szenen eines Release, aus dem Installationsvermerk. */
export function szenenZuRelease(releaseDir, variant) {
  const alle = BeneosInstallState.getAll() || {}
  const key = variant ? `${releaseDir}_${variant}` : releaseDir
  let e = alle[key]

  // DIE SCHREIBWEISE DES KATALOGS IST NICHT DIE DES VERMERKS.
  //
  // Der Aufrufer kommt aus dem Cloud-Fenster und kennt nur die Katalogform
  // `beneos_bm_0011_cos_barovia_village`. Aeltere Vermerke stehen kurz als
  // `bm_0011`. Der genaue Nachschlag verfehlte dann, und der Freigabeknopf im
  // Offline-Reiter meldete am 31.08.2026 "keine Szenen in dieser Welt",
  // obwohl die Karte offline lag.
  //
  // Derselbe Rueckfall wie in `findByReleaseDir`: erst genau, dann ueber den
  // Release-Kern. Die Variante zaehlt dabei ohne Ruecksicht auf Gross- und
  // Kleinschreibung, denn auch dort weichen Katalog und Vermerk voneinander ab.
  if (!e) {
    const kern = releaseKern(releaseDir)
    const v = String(variant || "").toLowerCase()
    if (kern) {
      for (const eintrag of Object.values(alle)) {
        if (!eintrag || typeof eintrag !== "object" || !eintrag.releaseDir) continue
        if (releaseKern(eintrag.releaseDir) !== kern) continue
        if (v && String(eintrag.variant || "").toLowerCase() !== v) continue
        e = eintrag
        break
      }
    }
  }

  const ids = Array.isArray(e?.sceneIds) ? e.sceneIds : []
  return ids.map(id => game.scenes?.get(String(id))).filter(Boolean)
}

/**
 * Der vorgewaermte Zustand je Szene, damit die Oberflaeche synchron antworten
 * kann.
 *
 * Foundrys Kontextmenue fragt seine `condition` synchron, und das Zeichnen der
 * Szenenliste wartet auf niemanden. Die Karte einer Szene zu ermitteln braucht
 * dagegen das Manifest, also einen Abruf. Beides geht nur zusammen, wenn der
 * Zustand vorher dasteht.
 *
 * Dasselbe Verfahren benutzt das Modul seit laengerem fuer die Umschaltung
 * zwischen statischer und animierter Karte (`warmStaticSwitchCache`), und aus
 * demselben Grund.
 */
const zustandCache = new Map()
let warmlaufLaeuft = false

/** Synchron, fuer Kontextmenue und Listenmarkierung. Unbekannt heisst: noch nicht gewaermt. */
export function zustandAusCache(sceneId) {
  return zustandCache.get(String(sceneId)) || null
}

/**
 * Den Zustand aller Szenen ermitteln, die etwas Gestreamtes tragen.
 *
 * Mehrere Aufrufe gleichzeitig werden zusammengefasst: das Zeichnen der
 * Seitenleiste feuert bei jeder Dokumentaenderung, und ein Warmlauf je
 * Tastendruck waere teurer als der Nutzen.
 */
export async function warmeZustaende() {
  if (warmlaufLaeuft) return { uebersprungen: true }
  if (!streamEnabled()) return { uebersprungen: "kein-streaming" }
  warmlaufLaeuft = true
  let gefunden = 0
  try {
    for (const scene of game.scenes ?? []) {
      const zustand = await szenenzustand(scene)
      if (!zustand.bekannt) { zustandCache.delete(String(scene.id)); continue }
      zustandCache.set(String(scene.id), zustand)
      gefunden++
    }
  } catch (err) {
    console.warn("Beneos Stream | Warmlauf der Offline-Zustaende abgebrochen", err)
  } finally {
    warmlaufLaeuft = false
  }
  return { gefunden, szenen: game.scenes?.size ?? 0 }
}

/**
 * Den Zustand einer einzelnen Szene nachziehen, nach einer Aenderung.
 *
 * Billiger als ein voller Warmlauf und genau das, was nach einem Zusagen oder
 * Loesen gebraucht wird.
 */
export async function ziehZustandNach(sceneId) {
  const scene = game.scenes?.get(String(sceneId))
  if (!scene) return null
  const zustand = await szenenzustand(scene)
  if (zustand.bekannt) zustandCache.set(String(sceneId), zustand)
  else zustandCache.delete(String(sceneId))
  return zustand
}

/**
 * Alle Szenen einer Karte nachziehen, nicht nur die angeklickte.
 *
 * Eine Karte ist Battlemap und Szenerie zusammen. Wer nur die angeklickte
 * Zeile nachzieht, laesst die Schwesterszene mit dem alten Zustand stehen, und
 * die Markierung in der Liste widerspricht sich selbst.
 */
export async function ziehKarteNach(karte) {
  const betroffen = []
  for (const [sceneId, z] of zustandCache) {
    if (z?.karte?.release === karte.release && z?.karte?.variant === karte.variant
      && z?.karte?.karte === karte.karte) betroffen.push(sceneId)
  }
  for (const id of betroffen) await ziehZustandNach(id)
  return betroffen.length
}

/**
 * Was der Rechtsklick auslöst: zusagen oder lösen, je nach Zustand.
 *
 * Alles, was danach stimmen muss, passiert hier und nicht beim Aufrufer:
 * der Zustand aller Szenen dieser Karte, die Szenenliste, die Navigationszeile.
 * Foundry zeichnet die Liste immer vollstaendig neu und kennt kein Zeichnen
 * einzelner Eintraege, also ist ein Neuzeichnen ohnehin unvermeidlich.
 */
export async function schalteKarte(sceneId) {
  const scene = game.scenes?.get(String(sceneId))
  if (!scene) return { ok: false, grund: "keine-szene" }
  const zustand = await szenenzustand(scene)
  if (!zustand.bekannt) return { ok: false, grund: "keine-karte" }
  const k = zustand.karte

  let ergebnis
  if (zustand.zugesagt) {
    ergebnis = await karteLoesen(k.release, k.variant, k.karte)
    if (ergebnis.ok) {
      ui.notifications?.info(game.i18n.format("BENEOS.Stream.Offline.Released", { name: k.name })
        || `"${k.name}" is streamed again.`)
    }
  } else {
    ui.notifications?.info(game.i18n.format("BENEOS.Stream.Offline.Fetching1", { name: k.name })
      || `Fetching "${k.name}" for offline use...`)
    ergebnis = await karteZusagen({ ...k, name: k.name })
    if (ergebnis.ok) {
      const mb = Math.round((ergebnis.ergebnis?.bytes || k.bytes || 0) / 1048576)
      ui.notifications?.info(game.i18n.format("BENEOS.Stream.Offline.Kept", { name: k.name, mb })
        || `"${k.name}" is available offline (${mb} MB).`)
    } else if (ergebnis.grund === "kontingent") {
      // Mit Zahlen, nicht nur mit einem Nein: der Spielleiter soll sehen, ob
      // eine einzige Karte freizugeben genuegt oder ob er umplanen muss.
      const mb = n => Math.round(n / 1048576)
      ui.notifications?.warn(game.i18n.format("BENEOS.Stream.Offline.QuotaExceeded",
        { name: k.name, needs: mb(ergebnis.braucht), free: mb(ergebnis.frei) })
        || `"${k.name}" needs ${mb(ergebnis.braucht)} MB, but only ${mb(ergebnis.frei)} MB of your `
         + `offline quota is free. Release another map first.`)
    } else if (ergebnis.grund === "deckel") {
      ui.notifications?.warn(game.i18n.localize("BENEOS.Stream.Offline.QuotaFull")
        || "Your offline storage is full. Release a map before keeping another one.")
    } else {
      ui.notifications?.error(game.i18n.format("BENEOS.Stream.Offline.KeepFailed", { name: k.name })
        || `"${k.name}" could not be fetched completely and was not kept.`)
    }
  }

  await ziehKarteNach(k)
  try { ui.scenes?.render(); ui.nav?.render() } catch (_) { /* Anzeige ist Beiwerk */ }
  return ergebnis
}

/**
 * Einen ganzen Ordner offline nehmen, Karte fuer Karte.
 *
 * WARUM NACHEINANDER UND NICHT ALLES AUF EINMAL
 *
 * Jede Karte fuehrt ihre eigene Zusage beim Tor, und das Kontingent kann
 * mitten im Lauf voll werden. Wer alles parallel losschickt, bekommt eine
 * unvorhersehbare Teilmenge und weiss hinterher nicht, welche. Nacheinander
 * heisst: die Reihenfolge ist die des Ordners, und beim ersten Nein ist
 * Schluss, mit einer Zahl statt einem Achselzucken.
 *
 * ABGEBROCHEN WIRD NICHT ZURUECKGEROLLT. Was schon liegt, bleibt liegen: es
 * ist vollstaendig, es ist gewollt, und es wegzuwerfen kostete den Kunden
 * dieselben Bytes noch einmal, wenn er es sich anders ueberlegt.
 */
export async function ordnerZusagen(folder, opts) {
  return szenenZusagen(szenenImOrdner(folder), opts)
}

/** Dieselbe Zusage, ueber eine beliebige Szenenliste. Siehe `szenenVorschau`. */
export async function szenenZusagen(szenen, { onProgress } = {}) {
  const vor = await szenenVorschau(szenen)
  const offen = vor.karten.filter(k => !k.zugesagt)
  const bericht = { gesamt: offen.length, geholt: 0, bytes: 0, abbruch: null, karten: [] }

  for (const [i, k] of offen.entries()) {
    onProgress?.({ index: i, gesamt: offen.length, name: k.name })
    const e = await karteZusagen({ ...k, name: k.name })
    if (e.ok) {
      bericht.geholt++
      bericht.bytes += Number(e.ergebnis?.bytes || k.bytes || 0)
      bericht.karten.push(k.name)
      await ziehKarteNach(k)
      continue
    }
    // Der erste Fehlschlag beendet den Lauf. Weiterzumachen hiesse, dem
    // Spielleiter eine Luecke mitten in seinem Ordner zu hinterlassen, die er
    // erst beim Spielen bemerkt.
    bericht.abbruch = { name: k.name, ...e }
    break
  }

  try { ui.scenes?.render(); ui.nav?.render() } catch (_) { }
  return bericht
}

/** Alle zugesagten Karten eines Ordners wieder freigeben. */
export async function ordnerLoesen(folder) {
  return szenenLoesen(szenenImOrdner(folder))
}

/** Dieselbe Freigabe, ueber eine beliebige Szenenliste. */
export async function szenenLoesen(szenen) {
  const vor = await szenenVorschau(szenen)
  const dran = vor.karten.filter(k => k.zugesagt)
  let geloest = 0
  for (const k of dran) {
    const e = await karteLoesen(k.release, k.variant, k.karte)
    if (e.ok) { geloest++; await ziehKarteNach(k) }
  }
  try { ui.scenes?.render(); ui.nav?.render() } catch (_) { }
  return { gesamt: dran.length, geloest }
}

// ---- Die Berechtigungsuhr ---------------------------------------------

/**
 * Festhalten, dass eine GUELTIGE Berechtigung gesehen wurde.
 *
 * Nicht "wir waren online": wer Verbindung hat, aber abgewiesen wird oder
 * keinen gueltigen Schluessel traegt, fuer den laeuft die Uhr weiter. Genau
 * das ist der Unterschied, an dem der Verfall haengt.
 */
export async function berechtigungGesehen() {
  try { await game.settings.set(MODULE_ID, SETTING.offlineSeen, Date.now()) }
  catch (_) { /* eine nicht schreibbare Einstellung darf den Start nicht anhalten */ }
}

/**
 * Wie es um die Frist steht.
 *
 * `nie` bedeutet, dass noch keine Berechtigung gesehen wurde. Das ist KEIN
 * Verfall: eine frisch eingeschaltete Welt hat noch keine gesehen, und ihr den
 * Vorrat zu nehmen, bevor sie einen hat, waere absurd.
 */
export function verfallsstand() {
  let zuletzt = 0
  try { zuletzt = Number(game.settings.get(MODULE_ID, SETTING.offlineSeen)) || 0 } catch (_) { }
  if (!zuletzt) return { nie: true, tageOffen: VERFALL_TAGE, abgelaufen: false, warnen: false }
  const vergangen = (Date.now() - zuletzt) / TAG_MS
  const tageOffen = Math.max(0, Math.ceil(VERFALL_TAGE - vergangen))
  return {
    nie: false, zuletzt, tageOffen,
    abgelaufen: vergangen >= VERFALL_TAGE,
    warnen: !!(tageOffen <= WARNUNG_AB_TAGEN && tageOffen > 0),
  }
}

// ---- Die Pruefung -----------------------------------------------------

/**
 * Was das Verzeichnis verspricht, gegen das, was der Speicher haelt.
 *
 * Bewusst streng je Karte: eine fehlende Datei macht die ganze Karte
 * unvollstaendig. Eine halb gezeichnete Karte ist schlechter als eine
 * ehrliche Ansage, denn sie sieht aus wie ein Fehler und nicht wie eine
 * Auskunft.
 *
 * DIE GETEILTEN DATEIEN ZAEHLEN MIT, und ohne sie war diese Pruefung wertlos.
 * Bis zum 2026-09-01 sah sie nur `urls`, also die eigenen Dateien der Karte.
 * Die Szenenwache fragt daneben `alleImSpeicher(streamAdressenVon(szene))` und
 * damit ueber ALLE Adressen der Szene. Gemessen im Pruefstand V14: die Pruefung
 * meldete zwei von zwei Dateien und damit "vollstaendig", die Wache fand drei
 * von fuenf fehlend und lehnte ab. Zwei Stellen, zwei Antworten, und der Kunde
 * sah nur die Ablehnung, ohne je eine Meldung ueber den fehlenden Vorrat
 * bekommen zu haben.
 */
export async function pruefeVorrat() {
  const liste = alleKarten()
  const vorrat = liesGeteilt()
  const fehlend = []
  // Der Index laeuft ueber alle Szenen der Welt. Ohne Zusagen gibt es nichts zu
  // pruefen, und dann soll er auch nicht gebaut werden.
  const index = liste.length ? geteilterIndex() : new Map()
  for (const e of liste) {
    if (await offlineGehalten([...(e.urls || []), ...geteilteAdressenDerKarte(e, vorrat, index)])) continue
    fehlend.push(e)
  }
  return {
    zugesagt: liste.length,
    vollstaendig: liste.length - fehlend.length,
    fehlend,
    bytesFehlend: fehlend.reduce((s, e) => s + (Number(e.bytes) || 0), 0),
  }
}

/**
 * Adressen vergleichbar machen.
 *
 * Der Speicher fuehrt die Adresse so, wie sie angefordert wurde, die
 * Zusagenliste so, wie sie im Manifest steht. Ein angehaengter Parameter
 * genuegt, damit dieselbe Datei zweimal verschieden aussieht, und ein
 * Abgleich, der das nicht abfaengt, haelt eine gedeckte Datei fuer verwaist.
 */
function adresseNormal(url) {
  try { const u = new URL(String(url)); u.search = ""; u.hash = ""; return u.href }
  catch (_) { return String(url) }
}

/**
 * Die Zusagenliste lesen, ohne Auffangnetz.
 *
 * `lies()` gibt bei jedem Fehler ein leeres Verzeichnis zurueck, und fuer die
 * Anzeige ist das richtig. Fuer den Abgleich unten waere es gefaehrlich: eine
 * momentan unlesbare Einstellung saehe aus wie "nichts zugesagt", und dann
 * loeste der Abgleich den gesamten Offline-Vorrat des Kunden.
 */
function zusagenStreng() {
  const roh = game.settings.get(MODULE_ID, SETTING.offlineHeld)
  if (roh === undefined || roh === null) throw new Error("Zusagenliste nicht lesbar")
  return roh
}

/**
 * Gehaltene Dateien loesen, zu denen keine Zusage mehr gehoert.
 *
 * WARUM ES DIESE FUNKTION BRAUCHT
 *
 * Der Dauerstempel liegt an der Datei, die Zusage steht in einer Einstellung
 * der Welt. Laufen beide auseinander, entsteht ein Block, den kein Weg mehr
 * freigibt: `raumSchaffen` laesst gehaltene Ware absichtlich stehen, und
 * `offlineFreigeben` wird ueber die Zusagenliste angestossen, in der die Datei
 * nicht mehr steht. Der Platz bleibt dann dauerhaft belegt und zaehlt gegen
 * das Kontingent des Kunden, das in der Grundausstattung drei Gigabyte betraegt.
 *
 * GEMESSEN am 2026-08-31 im Pruefstand V13: vier Dateien aus einem Release,
 * zusammen 16.279.444 Bytes, Alter 1,3 Tage, bei leerer Zusagenliste. Die
 * Entstehung ist mit `a358619` behoben, die Altlast blieb liegen. Ohne diesen
 * Abgleich traegt sie jeder Kunde weiter, der vor dem Update eine Karte offline
 * hatte und wieder entfernt hat.
 *
 * Geloest heisst nicht geloescht: der Dauerstempel faellt, die Bytes bleiben als
 * Wegwerfware liegen und werden geraeumt, wenn Platz gebraucht wird. Wer die
 * Karte gleich danach erneut zusagt, zahlt sie deshalb nicht noch einmal.
 *
 * Der Gemeinschaftsvorrat zaehlt als Deckung mit. Seine Dateien gehoeren keiner
 * einzelnen Karte, tragen aber zu Recht den Dauerstempel.
 */
export async function verwaisteLoesen() {
  const leer = { geprueft: 0, verwaist: 0, bytes: 0, geloest: 0 }
  let gedeckt
  try {
    gedeckt = new Set()
    for (const e of Object.values(zusagenStreng())) {
      if (!e || typeof e !== "object") continue
      for (const u of (e.urls || [])) gedeckt.add(adresseNormal(u))
    }
    for (const u of Object.keys(liesGeteilt())) gedeckt.add(adresseNormal(u))
  } catch (fehler) {
    // Im Zweifel nichts anfassen. Ein uebersehener Block kostet Platz, ein
    // faelschlich geloester Vorrat kostet den Kunden seine Offline-Karten.
    console.warn("Beneos Stream | Abgleich der gehaltenen Dateien uebersprungen, "
      + `Zusagenliste nicht sicher lesbar: ${fehler?.message || fehler}`)
    return { ...leer, uebersprungen: "zusagen-unlesbar" }
  }

  const gehalten = await gehalteneAdressen()
  if (!gehalten.length) return leer

  const verwaist = gehalten.filter(g => !gedeckt.has(adresseNormal(g.url)))
  if (!verwaist.length) return { ...leer, geprueft: gehalten.length }

  const bytes = verwaist.reduce((s, v) => s + (Number(v.bytes) || 0), 0)
  const erg = await offlineFreigeben(verwaist.map(v => v.url))
  console.log(`Beneos Stream | ${verwaist.length} gehaltene Datei(en) ohne Zusage geloest, `
    + `${Math.round(bytes / 1048576)} MB wieder raeumbar`)
  return { geprueft: gehalten.length, verwaist: verwaist.length, bytes, geloest: erg.geloest || 0 }
}

/**
 * Eintraege des Gemeinschaftsvorrats austragen, auf die keine Zusage mehr zeigt.
 *
 * WARUM DAS NICHT NUR AUFRAEUMEN IST
 *
 * `verwaisteLoesen` nimmt jeden Schluessel des Verzeichnisses als Deckung. Ein
 * Eintrag, dessen Karten alle geloest sind, schuetzt seine Datei damit
 * dauerhaft: `raumSchaffen` laesst gehaltene Ware absichtlich stehen, und
 * `offlineFreigeben` wird ueber die Zusagenliste angestossen, in der die Karte
 * nicht mehr steht. Der Platz bleibt belegt und zaehlt gegen das Kontingent.
 * Derselbe Block wie in `verwaisteLoesen`, nur eine Ebene hoeher.
 *
 * GEMESSEN am 2026-09-01 im Pruefstand V14: 3 von 6 Eintraegen fuehrten als
 * einzigen Besitzer ein Release, dessen Karte laengst geloest war.
 *
 * Deshalb steht dieser Schritt VOR `verwaisteLoesen`. Danach waere die Deckung
 * dieses Laufs bereits falsch berechnet.
 *
 * Die Freigabe uebernimmt `geteiltAustragen`: es kennt die Besitzerlogik und
 * gibt eine Datei erst frei, wenn wirklich keine Karte mehr auf sie zeigt.
 */
export async function geteilteWaisen() {
  const leer = { geprueft: 0, tot: 0, freigegeben: 0, bytes: 0 }
  let zugesagte
  try {
    // Streng lesen, ohne Auffangnetz. `lies()` gaebe bei einem Lesefehler ein
    // leeres Verzeichnis zurueck, und dann saehe JEDER Eintrag verwaist aus.
    zugesagte = new Set(Object.keys(zusagenStreng()))
  } catch (fehler) {
    console.warn("Beneos Stream | Abgleich des Gemeinschaftsvorrats uebersprungen, "
      + `Zusagenliste nicht sicher lesbar: ${fehler?.message || fehler}`)
    return { ...leer, uebersprungen: "zusagen-unlesbar" }
  }

  const vorrat = liesGeteilt()
  const eintraege = Object.entries(vorrat).filter(([, e]) => e && typeof e === "object")
  if (!eintraege.length) return leer

  const tote = new Set()
  for (const [, e] of eintraege) {
    for (const id of (e.karten || [])) if (!zugesagte.has(id)) tote.add(id)
  }
  if (!tote.size) return { ...leer, geprueft: eintraege.length }

  const erg = await geteiltAustragen([...tote])
  if (erg.freigegeben) {
    console.log(`Beneos Stream | Gemeinschaftsvorrat: ${erg.freigegeben} Datei(en) ohne zugesagte `
      + `Karte ausgetragen, ${Math.round(erg.bytes / 1048576)} MB wieder raeumbar`)
  }
  return { geprueft: eintraege.length, tot: tote.size, freigegeben: erg.freigegeben, bytes: erg.bytes }
}

/**
 * Eintraege des Gemeinschaftsvorrats vermerken, deren Datei nicht mehr liegt.
 *
 * WARUM ES DIESE FUNKTION BRAUCHT
 *
 * `verwaisteLoesen` deckt die eine Richtung ab: eine gehaltene Datei, zu der
 * keine Zusage mehr gehoert. Die Gegenrichtung fing bis zum 2026-09-01 niemand
 * ab. Der Gemeinschaftsvorrat hat zwei Haelften, die getrennt leben: das
 * Verzeichnis ist eine Einstellung der Welt, der Inhalt liegt im Speicher des
 * Browsers. Faellt der Inhalt weg, bleibt das Verzeichnis stehen und
 * behauptet weiter, die Datei sei da.
 *
 * Das machte die Luecke unheilbar, denn `karteZusagen` ueberspringt, was das
 * Verzeichnis fuehrt. GEMESSEN im Pruefstand V14: eine zugesagte Karte brauchte
 * fuenf Adressen, zwei lagen im Speicher, die drei geteilten fehlten, und die
 * Szene wurde ohne Verbindung abgelehnt.
 *
 * `clearStore` ist nur der schnellste Weg in diesen Zustand. Der Kunde kommt
 * ohne jedes Zutun hin: Chrome raeumt unter Speicherdruck einen ganzen
 * Ursprung, nicht einzelne Eintraege.
 *
 * VERMERKT, NICHT AUSGETRAGEN. Der Eintrag traegt die Besitzerliste, also
 * welche Karten diese Datei brauchen. Wer ihn austraegt, verliert genau die
 * Auskunft, die `vorratHeilen` braucht, um sie nachzuholen. Der Vermerk `fehlt`
 * nimmt die Datei aus der Kontingentrechnung und laesst die Zugehoerigkeit
 * stehen; das Holen loescht ihn, indem es den Eintrag neu schreibt.
 *
 * @returns {Promise<{geprueft:number, fehlend:number, bytes:number}>}
 */
export async function geteilteLuecken() {
  const leer = { geprueft: 0, fehlend: 0, bytes: 0 }

  // DAS SICHERHEITSNETZ IST PFLICHT.
  //
  // Bei ausgefallenem Speicher gibt `openStore` null zurueck, und dann
  // antwortet `offlineGehalten` auf JEDE Adresse mit falsch. Ohne diese Abfrage
  // saehe ein einziger Speicherausfall aus wie ein vollstaendig geraeumter
  // Vorrat, und der Kunde bekaeme fuer jede seiner Karten eine Meldung, die
  // nicht stimmt. Der Ausfall wird in `stream-fetch.mjs` festgehalten, sobald
  // ein Zugriff scheitert; `beimWeltstart` fasst den Speicher unmittelbar davor
  // ueber `verwaisteLoesen` an, der Stand ist also frisch.
  if (speicherAusfallStand()) return { ...leer, uebersprungen: "speicher-aus" }

  const vorrat = liesGeteilt()
  const eintraege = Object.entries(vorrat).filter(([, e]) => e && typeof e === "object")
  if (!eintraege.length) return leer

  // EIN Lauf ueber den Speicher, nicht einer je Datei. `offlineGehalten` oeffnet
  // den Speicher bei jedem Aufruf neu; bei einem Verzeichnis mit dreissig
  // Dateien waeren das dreissig Oeffnungen im Startpfad der Welt. `verwaisteLoesen`
  // benutzt dieselbe Quelle, und dass beide Abgleiche denselben Stand lesen,
  // ist mehr als eine Ersparnis: sonst koennten sie sich widersprechen.
  const gehalten = new Set((await gehalteneAdressen()).map(g => adresseNormal(g.url)))

  let fehlend = 0, bytes = 0, geaendert = 0
  for (const [url, e] of eintraege) {
    if (gehalten.has(adresseNormal(url))) {
      // Ein Vermerk, der sich erledigt hat. Er muss auch dann verschwinden,
      // wenn in diesem Lauf sonst nichts fehlt, sonst bliebe die Datei
      // dauerhaft aus der Kontingentrechnung heraus.
      if (e.fehlt) { delete e.fehlt; geaendert++ }
      continue
    }
    if (!e.fehlt) { e.fehlt = true; geaendert++ }
    fehlend++
    bytes += Number(e.bytes) || 0
  }
  if (geaendert) {
    await schreibGeteilt(vorrat)
    // Nur bei einer Aenderung. Ein Kunde, der die Meldung wegklickt und nicht
    // heilt, bekaeme diese Zeile sonst bei jedem Weltstart, und eine Zeile, die
    // immer dasteht, liest nach der dritten Woche niemand mehr.
    console.log(`Beneos Stream | Gemeinschaftsvorrat: ${fehlend} von ${eintraege.length} `
      + `Datei(en) nicht mehr im Speicher, ${Math.round(bytes / 1048576)} MB, als fehlend vermerkt`)
  }
  return { geprueft: eintraege.length, fehlend, bytes }
}

/**
 * Die fehlenden Karten neu holen.
 *
 * Getrennt von der Pruefung, weil das Holen Zeit und Leitung kostet und der
 * Kunde es entscheiden soll. Wer offline ist, bekommt hier nichts, und das
 * ist richtig: dann ist ohnehin nichts zu holen.
 *
 * Die geteilten Dateien werden mitgeholt. Ohne sie heilte der Lauf die Karte
 * nur zur Haelfte: sie zeichnete weiterhin nicht, und die naechste Pruefung
 * meldete sie erneut. Der Vermerk `fehlt` faellt dabei, aber nur fuer die
 * Dateien, die danach wirklich liegen.
 *
 * WOHER DIE ADRESSEN KOMMEN, und warum aus zwei Quellen. Das Verzeichnis
 * fuehrt, was beim Zusagen bekannt war. Kommt spaeter eine Datei dazu, weil
 * das Modul einen bisher uebersehenen Ort im Szenendokument liest, steht sie
 * dort nicht, und das Heilen faende sie nie. Genau das ist am 2026-09-01 mit
 * den Symbolen der Kartenmarker passiert: die Pruefung meldete die Karte
 * danach zu Recht als unvollstaendig, und der Knopf "Fetch now" haette sie
 * nicht reparieren koennen. Deshalb wird die Karte ueber ihre Szene frisch
 * aufgeloest, und die Vereinigung beider Listen geholt.
 */
export async function vorratHeilen(fehlend, onProgress) {
  const summe = { geholt: 0, fehlgeschlagen: 0, karten: 0, geteiltGeholt: 0 }
  const vorrat = liesGeteilt()
  const index = geteilterIndex()
  let geaendert = 0
  for (const e of fehlend || []) {
    const id = karteId(e.release, e.variant, e.karte)
    const r = await offlineHalten(e.urls || [], onProgress)
    summe.geholt += r.geholt + r.gehalten
    summe.fehlgeschlagen += r.fehlgeschlagen

    // Die frische Aufloesung ueber die Szene, wenn sie zu haben ist. Ohne Netz
    // gibt `karteZuSzene` keine Adressen her, dann bleibt es beim Verzeichnis;
    // das ist richtig, denn ohne Netz ist ohnehin nichts zu holen.
    // Die Groessen. `geteilteAdressenDerKarte` liefert die Adressen netzfrei,
    // aber nicht ihre Bytes; die stehen im Manifest. Ein Eintrag ohne Bytes
    // liesse das Kontingent mit null rechnen. Beim Heilen ist Verbindung da,
    // der Abruf ist also der richtige Ort dafuer. Scheitert er, wird trotzdem
    // geholt, nur mit einer Null in der Rechnung.
    const groessen = new Map()
    for (const szenenId of szenenDerKarte(e, index)) {
      const szene = game.scenes?.get(szenenId)
      if (!szene) continue
      let karte = null
      try { karte = await karteZuSzene(szene) } catch (_) { continue }
      for (const g of (karte?.geteilt || [])) if (g?.url) groessen.set(g.url, Number(g.bytes) || 0)
    }

    let geteiltFehlt = 0
    for (const url of geteilteAdressenDerKarte(e, vorrat, index)) {
      let liegt = await offlineGehalten([url])
      if (!liegt) {
        await offlineHalten([url], onProgress)
        // Nach dem Holen noch einmal fragen statt dem Rueckgabewert zu
        // glauben: der Deckel kann zugeschlagen haben, und ein Eintrag ohne
        // Datei ist genau die Luege, die dieser Umbau beseitigt.
        liegt = await offlineGehalten([url])
        if (liegt) summe.geteiltGeholt++
      }
      if (!liegt) { geteiltFehlt++; continue }
      // Eintragen, was noch nicht im Verzeichnis steht. Ohne diese Zeile fiele
      // eine frisch gefundene Datei beim naechsten Weltstart als verwaist auf
      // und verloere ihren Dauerstempel, obwohl eine Karte sie braucht.
      if (!vorrat[url]) {
        vorrat[url] = { bytes: groessen.get(url) || 0, karten: [id] }
        geaendert++
        continue
      }
      if (!(vorrat[url].karten || []).includes(id)) {
        vorrat[url].karten = [...new Set([...(vorrat[url].karten || []), id])]
        geaendert++
      }
      if (vorrat[url].fehlt) { delete vorrat[url].fehlt; geaendert++ }
    }
    summe.fehlgeschlagen += geteiltFehlt
    // Vollstaendig heisst beides: die eigenen Dateien UND die geteilten. Eine
    // Karte, die nur ihre eigenen bekommen hat, wird von der naechsten Pruefung
    // wieder als fehlend gemeldet, und sie hier zu zaehlen waere eine Zusage,
    // die der naechste Weltstart widerruft.
    if (!r.fehlgeschlagen && !geteiltFehlt) summe.karten++
  }
  if (geaendert) await schreibGeteilt(vorrat)
  return summe
}

/**
 * Der ganze Ablauf beim Weltstart, in der Reihenfolge, die er haben muss.
 *
 * Erst die Uhr, dann der Verfall, dann die Pruefung. Die Reihenfolge ist
 * nicht beliebig: wer erst prueft und dann verfallen laesst, meldet dem Kunden
 * einen Schaden, den anschliessend eine Regel erzeugt haette.
 *
 * Gemeldet wird nur, was den Kunden angeht. Ein vollstaendiger Vorrat
 * erscheint im Protokoll und sonst nirgends; eine Meldung bei jedem Weltstart
 * waere nach der dritten Woche Rauschen.
 */
export async function beimWeltstart({ berechtigt }) {
  if (!streamEnabled()) return { uebersprungen: "kein-streaming" }

  // Der Abgleich steht VOR jedem Abbruch, und das ist der ganze Punkt: eine
  // leere Zusagenliste ist genau die Lage, in der verwaiste Dauerstempel
  // liegenbleiben. Stuende er weiter unten, faende er sie nie.
  // Drei Abgleiche, und ihre Reihenfolge ist bindend.
  //
  // Zuerst die toten Eintraege des Gemeinschaftsvorrats: sie gelten sonst als
  // Deckung, und der zweite Schritt rechnete mit einer falschen.
  const waisen = await geteilteWaisen()
  // Dann die gehaltenen Dateien ohne Zusage.
  const verwaist = await verwaisteLoesen()
  // Zuletzt die Gegenrichtung, Eintrag ohne Datei. Er steht hinten, weil sein
  // Sicherheitsnetz darauf baut, dass der Speicher gerade angefasst wurde und
  // ein Ausfall deshalb bekannt ist. Siehe `geteilteLuecken`.
  const luecken = await geteilteLuecken()

  if (!alleKarten().length) {
    // Nichts zugesagt, nichts zu pruefen. Die Uhr laeuft trotzdem mit, damit
    // sie nicht bei der ersten Zusage schon abgelaufen ist.
    if (berechtigt) await berechtigungGesehen()
    return { uebersprungen: "nichts-zugesagt", waisen, verwaist, luecken }
  }

  if (berechtigt) await berechtigungGesehen()

  const frist = verfallsstand()
  if (frist.abgelaufen) {
    const v = await vorratVerfallen()
    // Zwei Saetze, weil sie zwei verschiedene Dinge melden. "verfallen: 0
    // Karten" liest sich wie ein Verfall und wuerde jede Fehlersuche in die
    // falsche Richtung schicken.
    console.log(v.gefallen > 0
      ? `Beneos Stream | Offline-Vorrat verfallen: ${v.gefallen} Karten, `
        + `${v.behalten} gekaufte behalten, `
        + `seit ${VERFALL_TAGE} Tagen keine gueltige Berechtigung`
      : `Beneos Stream | Frist abgelaufen, nichts verfallen: alle ${v.behalten} `
        + `Karten sind gekauft und haengen an keiner Mitgliedschaft`)
    // Nur abbrechen, wenn wirklich etwas gefallen ist. Wer ausschliesslich
    // Gekauftes haelt, verliert nichts und braucht trotzdem seine Pruefung;
    // ohne diese Bedingung bekaeme er sie nach Fristablauf nie wieder.
    if (v.gefallen > 0) return { verfallen: v.gefallen, behalten: v.behalten, frist, waisen, verwaist, luecken }
  }

  const stand = await pruefeVorrat()
  const vorrat = vorratsstand()
  console.log(`Beneos Stream | Offline-Vorrat: ${stand.vollstaendig} von ${stand.zugesagt} Karten `
    + `vollstaendig, ${Math.round(vorrat.bytes / 1048576)} MB zugesagt, `
    + (frist.nie ? "Frist laeuft noch nicht" : `noch ${frist.tageOffen} Tage`))

  return { stand, frist, vorrat, waisen, verwaist, luecken }
}

// ---- Was der Kunde davon sieht ----------------------------------------

const DialogV2 = () => foundry.applications?.api?.DialogV2

function localize(key, fallback) {
  try { const t = game.i18n.localize(key); return (t && t !== key) ? t : fallback }
  catch (_) { return fallback }
}

/**
 * Fehlende Karten melden, und zwar mit Namen.
 *
 * "Drei Karten fehlen" ist eine Auskunft, mit der niemand etwas anfangen kann.
 * Erst die Namen sagen dem Spielleiter, ob es die Karten des naechsten Abends
 * betrifft oder etwas, das er ohnehin nicht mehr braucht.
 */
export async function meldeFehlendenVorrat(bericht) {
  const fehlend = bericht?.stand?.fehlend || []
  if (!fehlend.length) return false
  const D = DialogV2()
  const namen = fehlend.slice(0, 8).map(e => foundry.utils.escapeHTML(String(e.name))).join(", ")
  const rest = fehlend.length > 8 ? ` and ${fehlend.length - 8} more` : ""
  const mb = Math.round((bericht.stand.bytesFehlend || 0) / 1048576)

  const text = `<p>${localize("BENEOS.Stream.Offline.MissingIntro",
      "Some of your offline maps are no longer in this browser's storage.")}</p>`
    + `<p><strong>${namen}${rest}</strong></p>`
    + `<p>${localize("BENEOS.Stream.Offline.MissingWhy",
      "This usually happens when browser data was cleared, or when the world is opened "
      + "from a different address than before. Your membership is unaffected.")}</p>`
    + `<p>${localize("BENEOS.Stream.Offline.MissingAsk",
      "Fetch them again now?")} (${mb} MB)</p>`

  if (!D) {
    ui.notifications?.warn(`Beneos: ${fehlend.length} offline map(s) missing from browser storage.`)
    return false
  }
  const ja = await D.confirm({
    window: { title: localize("BENEOS.Stream.Offline.MissingTitle", "Offline maps are missing") },
    content: text,
    yes: { label: localize("BENEOS.Stream.Offline.FetchNow", "Fetch now"), default: true },
    no: { label: localize("BENEOS.Stream.Offline.Later", "Later"), default: false },
    rejectClose: false,
  }).catch(() => false)
  if (ja !== true) return false

  ui.notifications?.info(localize("BENEOS.Stream.Offline.Fetching", "Fetching your offline maps..."))
  const summe = await vorratHeilen(fehlend)
  if (summe.fehlgeschlagen) {
    ui.notifications?.warn(`Beneos: ${summe.karten} of ${fehlend.length} map(s) restored, `
      + `${summe.fehlgeschlagen} file(s) could not be fetched.`)
  } else {
    ui.notifications?.info(`Beneos: ${summe.karten} offline map(s) restored.`)
  }
  return true
}

/** Der Verfall wird gemeldet, nicht stillschweigend vollzogen. */
export async function meldeVerfall(anzahl) {
  ui.notifications?.warn(game.i18n.format("BENEOS.Stream.Offline.Expired",
    { count: anzahl, days: VERFALL_TAGE })
    || `Beneos: ${anzahl} offline map(s) expired after ${VERFALL_TAGE} days without a `
     + `membership check. Open this world while online to keep them next time.`)
  return true
}

/**
 * Die Zusagen fallen lassen, weil die Frist abgelaufen ist.
 *
 * GEKAUFTES BLEIBT.
 *
 * Die Frist misst eine Mitgliedschaft, und ein Kauf haengt an keiner. Das Tor
 * sagt das bei jeder Zusage in einem Wort (`permanent`), und seit dieser
 * Auskunft wird sie im Verzeichnis mitgefuehrt. Ein Kaeufer, dem sein Vorrat
 * nach vierzehn Tagen ohne Verbindung wegbricht, hat dieselbe Karte zweimal
 * bezahlt: einmal mit Geld und einmal mit der Leitung.
 *
 * Bei den anderen wird das Verzeichnis GELEERT, nicht nur der Speicher
 * freigegeben. Sonst meldete die naechste Pruefung lauter fehlende Karten und
 * behauptete einen Schaden, wo eine Regel gegriffen hat.
 *
 * Alte Eintraege ohne das Feld gelten als gemietet und verfallen. Das ist die
 * vorsichtige Richtung: wer wirklich gekauft hat, holt die Karte beim
 * naechsten Mal wieder und traegt danach das Merkmal.
 */
export async function vorratVerfallen() {
  const liste = alleKarten()
  const bleibt = {}
  const gefalleneIds = []
  let gefallen = 0
  for (const e of liste) {
    const id = karteId(e.release, e.variant, e.karte)
    if (e.permanent === true) { bleibt[id] = e; continue }
    try { await offlineFreigeben(e.urls || []) } catch (_) { /* weiter */ }
    gefalleneIds.push(id)
    gefallen++
  }
  await schreib(bleibt)
  // Die verfallenen Karten aus dem Gemeinschaftsvorrat austragen. Bleibt eine
  // gekaufte Karte, bleiben auch ihre Symbole; erst wenn keine Karte mehr auf
  // eine geteilte Datei zeigt, geht sie. Ohne diesen Schritt lagen 13,85 MB
  // Symbole unbegrenzt im Speicher eines Kunden, der gar nichts mehr haelt.
  const geteilt = gefalleneIds.length ? await geteiltAustragen(gefalleneIds) : { freigegeben: 0, bytes: 0 }
  return { gefallen, behalten: liste.length - gefallen, geteilt }
}
