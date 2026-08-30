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
import { offlineGehalten, offlineHalten, offlineFreigeben } from "./stream-fetch.mjs"
import { streamAdressenVon } from "./stream-online.mjs"
import { loadStreamManifest } from "./stream-install.mjs"
import { BeneosInstallState } from "../cloud-v2/beneos-install-state.mjs"

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

/** Was die zugesagten Karten zusammen wiegen, und wie viele es sind. */
export function vorratsstand() {
  const liste = alleKarten()
  return { karten: liste.length, bytes: liste.reduce((s, e) => s + (Number(e.bytes) || 0), 0) }
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
export async function karteZusagen({ release, variant, karte, name, urls, bytes, onProgress }) {
  if (!streamEnabled()) return { ok: false, grund: "kein-streaming" }
  const liste = [...new Set((urls || []).filter(Boolean))]
  if (!liste.length) return { ok: false, grund: "keine-dateien" }

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
  const braucht = Number(bytes) || 0
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

  const alle = lies()
  alle[karteId(release, variant, karte)] = {
    release, variant, karte,
    name: String(name || karte),
    urls: liste,
    // Die Groesse aus dem Manifest hat Vorrang vor der gemessenen: sie ist
    // dieselbe Zahl, gegen die vorher geprueft wurde, und `content-length`
    // fehlt bei manchen Antworten ganz.
    bytes: braucht || Number(ergebnis.bytes) || 0,
    seit: Date.now(),
  }
  await schreib(alle)
  return { ok: true, ergebnis }
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
  const beimTor = await torFragen(kartenWeg(release, variant, karte) + "/release", "POST")
  return { ok: true, beimTor: beimTor.ok }
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
  const pfade = new Set(adressen.map(a => zerlegeAdresse(a)?.pfad).filter(Boolean))

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
  return {
    bekannt: true, karte, zugesagt,
    passt: zugesagt || karte.bytes <= frei,
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
    if (karten.has(id)) continue
    karten.set(id, { ...k, zugesagt: zustand.zugesagt })
  }

  const liste = [...karten.values()]
  const offen = liste.filter(k => !k.zugesagt)
  const bytes = offen.reduce((s, k) => s + (Number(k.bytes) || 0), 0)
  const frei = Math.max(0, kontingent() - vorratsstand().bytes)
  return {
    szenen: szenen.length,
    ohneKarte,
    karten: liste,
    schonDa: liste.length - offen.length,
    offen: offen.length,
    bytes,
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
  const key = variant ? `${releaseDir}_${variant}` : releaseDir
  const e = BeneosInstallState.getAll()?.[key]
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
export async function ordnerZusagen(folder, { onProgress } = {}) {
  const vor = await ordnerVorschau(folder)
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
  const vor = await ordnerVorschau(folder)
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
 */
export async function pruefeVorrat() {
  const liste = alleKarten()
  const fehlend = []
  for (const e of liste) {
    if (await offlineGehalten(e.urls || [])) continue
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
 * Die fehlenden Karten neu holen.
 *
 * Getrennt von der Pruefung, weil das Holen Zeit und Leitung kostet und der
 * Kunde es entscheiden soll. Wer offline ist, bekommt hier nichts, und das
 * ist richtig: dann ist ohnehin nichts zu holen.
 */
export async function vorratHeilen(fehlend, onProgress) {
  const summe = { geholt: 0, fehlgeschlagen: 0, karten: 0 }
  for (const e of fehlend || []) {
    const r = await offlineHalten(e.urls || [], onProgress)
    summe.geholt += r.geholt + r.gehalten
    summe.fehlgeschlagen += r.fehlgeschlagen
    if (!r.fehlgeschlagen) summe.karten++
  }
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
  if (!alleKarten().length) {
    // Nichts zugesagt, nichts zu pruefen. Die Uhr laeuft trotzdem mit, damit
    // sie nicht bei der ersten Zusage schon abgelaufen ist.
    if (berechtigt) await berechtigungGesehen()
    return { uebersprungen: "nichts-zugesagt" }
  }

  if (berechtigt) await berechtigungGesehen()

  const frist = verfallsstand()
  if (frist.abgelaufen) {
    const v = await vorratVerfallen()
    console.log(`Beneos Stream | Offline-Vorrat verfallen: ${v.gefallen} Karten, `
      + `seit ${VERFALL_TAGE} Tagen keine gueltige Berechtigung`)
    return { verfallen: v.gefallen, frist }
  }

  const stand = await pruefeVorrat()
  const vorrat = vorratsstand()
  console.log(`Beneos Stream | Offline-Vorrat: ${stand.vollstaendig} von ${stand.zugesagt} Karten `
    + `vollstaendig, ${Math.round(vorrat.bytes / 1048576)} MB zugesagt, `
    + (frist.nie ? "Frist laeuft noch nicht" : `noch ${frist.tageOffen} Tage`))

  return { stand, frist, vorrat }
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
 * Alle Zusagen fallen lassen, weil die Frist abgelaufen ist.
 *
 * Das Verzeichnis wird dabei GELEERT, nicht nur der Speicher freigegeben.
 * Sonst meldete die naechste Pruefung lauter fehlende Karten und behauptete
 * einen Schaden, wo eine Regel gegriffen hat.
 */
export async function vorratVerfallen() {
  const liste = alleKarten()
  for (const e of liste) {
    try { await offlineFreigeben(e.urls || []) } catch (_) { /* weiter */ }
  }
  await schreib({})
  return { gefallen: liste.length }
}
