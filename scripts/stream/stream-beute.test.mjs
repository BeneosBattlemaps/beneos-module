/**
 * stream-beute.test.mjs
 *
 * Gegenprobe zum Beuteraum: das Adresspaar, die Kartenliste und die Regel
 * "niemals einen Dateinamen bilden". Laeuft ohne Foundry, ohne Browser, ohne
 * Netz:
 *
 *   node scripts/stream/stream-beute.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ. Gegenstaende und Zauber liegen seit `OP-PRJ-139` in
 * einem eigenen Spiegelordner und kommen seit `OP-PRJ-140` ueber eine eigene
 * Torroute. Beides ist wertlos, solange das Modul die Adresse nicht bilden
 * und die Antwort nicht lesen kann, und beide Richtungen koennen still
 * falsch sein:
 *
 *   zu grosszuegig   eine gebildete Adresse auf eine Datei, die im Spiegel
 *                    nicht liegt. Das Tor antwortet mit HTTP 200 und einem
 *                    durchsichtigen GIF von 42 Byte, der Kunde sieht eine
 *                    leere Karte, und nirgends erscheint eine Meldung.
 *   zu streng        eine vorhandene Karte wird nicht angeboten. Das ist ein
 *                    Ausfall bei einem zahlenden Kunden, und er ist genauso
 *                    teuer.
 *
 * DIE SECHS EINTRAEGE AUS DEM BESTAND SIND DER ANLASS, gemessen am
 * 07.11.2026: drei Zauber tragen GAR KEINE Rueckseite, drei weitere tragen
 * sie als PNG und damit unter einem Namen, den die Positivliste des Spiegels
 * nicht mitnimmt. Beide Lagen stehen hier als Fall.
 *
 * Der Lauf fasst nichts an: `game` wird gestellt, `fetch` wird gestellt, und
 * beide leben nur fuer die Dauer dieses Laufs.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import {
  assetUrl, zerlegeAdresse, istBeute, istKreatur, platzhalterAdresse,
  BEUTE_PRAEFIX, KREATUR_PRAEFIX, SETTING, GATE_DEFAULT_BASE,
} from "./stream-settings.mjs"
import {
  beuteAusPfad, kartenliste, karte, karteFuerBlatt, karteGibtEs,
  kartenVergessen, kartenStand, ROLLEN,
} from "./stream-karten.mjs"
import { KARTE_MAX } from "./stream-merker.mjs"
import { pruefstand, installiereFoundry } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, struktur, abschnitt, ende } = pruefstand("stream-beute, am echten Code und an seinen Rufstellen")

function wahr(name, bedingung) { gleich(name, Boolean(bedingung), true) }

// Der Abruf von Node, bevor ein Abschnitt ihn stellt. Der Installer liest seine
// Bilder als `data:`-Adresse ueber `fetch`, und die beantwortet nur er.
const echterAbruf = globalThis.fetch

/** Eine gestellte Welt mit Schluessel und Basisadresse. */
function stelleWelt({ schluessel = "pruefschluessel" } = {}) {
  const laden = {
    [SETTING.key]: schluessel,
    [SETTING.base]: GATE_DEFAULT_BASE,
  }
  globalThis.game = {
    settings: { get: (_modul, k) => laden[k] },
  }
  return laden
}

/**
 * Ein gestelltes `fetch`, das mitschreibt, welche Adressen gefragt wurden.
 *
 * Die Adressen sind der eigentliche Gegenstand mehrerer Faelle: ein Abruf
 * mehr je Blattrender ist genau die Last, gegen die diese Datei angetreten
 * ist, und eine Adresse auf eine nicht gelistete Datei ist der stille Fehler.
 */
function stelleAbruf(antwortFuer) {
  const gefragt = []
  globalThis.fetch = async (adresse) => {
    gefragt.push(String(adresse))
    const a = antwortFuer(String(adresse))
    if (!a) return { ok: false, status: 404, headers: new Map(), json: async () => null }
    return {
      ok: true,
      status: 200,
      headers: new Map(Object.entries(a.kopf || {})),
      json: async () => a.koerper,
    }
  }
  return gefragt
}

const KENNUNG = "0042_longsword_of_dawn"
const RELEASE = `${BEUTE_PRAEFIX}${KENNUNG}`

/** Eine Liste, wie der Spiegel sie schreibt. */
function liste({ front = true, back = true, icon = true } = {}) {
  const seite = (rolle, breite, hoehe) => ({
    pfad: `${KENNUNG}-${rolle}.webp`, breite, hoehe,
    bytes: 1000, sha256: "a".repeat(64),
  })
  return {
    karten: {
      front: front ? seite("front", 1024, 1434) : null,
      back: back ? seite("back", 1024, 1434) : null,
      icon: icon ? seite("icon", 500, 500) : null,
    },
  }
}

// ===========================================================================
console.log("\nDas Praefix selbst, damit eine Umbenennung auffaellt")
/*
 * Dieselbe Zeichenkette steht am Tor als `BEUTE_PRAEFIX` und in der Cloud als
 * `DatabaseManager::STREAM_BEUTE_PRAEFIX`. Weicht eine ab, weist das Tor den
 * Namen seinem Raum nicht mehr zu, und auf der meldenden Stufe des Riegels
 * waere er damit ueber die KARTENROUTE erreichbar. Diese zwei Zeilen sind der
 * Vertrag ueber drei Bestaende.
 */
gleich("Beutepraefix", BEUTE_PRAEFIX, "beneos_lt_")
gleich("Kreaturenpraefix unveraendert", KREATUR_PRAEFIX, "beneos_ct_")
// Die drei Praefixe unterscheiden sich im achten Zeichen, also kann kein Name
// in zwei Raeume fallen.
gleich("ein Beutename ist keine Kreatur", istKreatur(RELEASE), false)
gleich("ein Kreaturenname ist keine Beute", istBeute("beneos_ct_goblin"), false)
gleich("ein Kartenname ist keine Beute", istBeute("beneos_bm_0001_crystal"), false)
gleich("Praefix in der Mitte ist keine Beute", istBeute("fremd_beneos_lt_x"), false)
gleich("leer ist keine Beute", istBeute(""), false)
gleich("undefined ist keine Beute", istBeute(undefined), false)

// ===========================================================================
console.log("\nDie Adresse: vier Segmente, Buchstabe l, keine Variante")
{
  stelleWelt()
  const a = assetUrl(RELEASE, "", `${KENNUNG}-front.webp`)
  gleich("die Beuteadresse", a,
    `${GATE_DEFAULT_BASE}/l/pruefschluessel/${RELEASE}/${KENNUNG}-front.webp`)
  /*
   * EINE MITGEGEBENE VARIANTE DARF NICHT IN DIE ADRESSE GERATEN. Der
   * Beuteraum kennt keine; ein Aufrufer, der aus Gewohnheit `"4k"` mitgibt,
   * bekaeme sonst fuenf Segmente und am Tor eine Datei namens `4k/...`, also
   * 404 auf eine Datei, die liegt.
   */
  gleich("eine mitgegebene Variante faellt weg",
    assetUrl(RELEASE, "4k", `${KENNUNG}-front.webp`), a)
  // Die Gegenrichtung: eine Karte behaelt ihre fuenf Segmente.
  wahr("eine Battlemap behaelt ihre Variante",
    assetUrl("beneos_bm_0001_crystal", "4k", "x.webp").includes("/a/pruefschluessel/beneos_bm_0001_crystal/4k/"))
  // Und eine Kreatur bleibt auf ihrem Buchstaben.
  wahr("eine Kreatur bleibt auf /c/",
    assetUrl("beneos_ct_goblin", "", "y.webp").includes("/c/pruefschluessel/beneos_ct_goblin/"))
}

console.log("\nDie Umkehrung liest den Raum am Buchstaben")
{
  const z = zerlegeAdresse(`${GATE_DEFAULT_BASE}/l/geheim/${RELEASE}/${KENNUNG}-front.webp`)
  gleich("Raum", z?.raum, "beute")
  gleich("Release", z?.release, RELEASE)
  gleich("Variante ist die leere Aussage", z?.variant, "")
  gleich("Pfad", z?.pfad, `${KENNUNG}-front.webp`)
  /*
   * DER SCHLUESSEL KOMMT NICHT ZURUECK, und das ist keine Nachlaessigkeit. Er
   * ist die Eintrittskarte des Augenblicks und nicht Teil der Identitaet einer
   * Datei; wer ihn mitnimmt, baut die naechste Bindung an ihn, und ein
   * Schluesselwechsel liesse den ganzen Vorrat als fehlend erscheinen.
   */
  wahr("der Schluessel steht in keinem Feld",
    !Object.values(z || {}).some((v) => String(v).includes("geheim")))
  // Zu wenige Segmente sind keine Adresse dieses Raums.
  gleich("drei Segmente ergeben nichts",
    zerlegeAdresse(`${GATE_DEFAULT_BASE}/l/geheim/${RELEASE}`), null)
  // Ein fremder Buchstabe bleibt fremd. Das ist der Fremdschutz, und er haengt
  // an genau dieser Exaktheit.
  gleich("ein vierter Buchstabe ergibt nichts",
    zerlegeAdresse(`${GATE_DEFAULT_BASE}/x/geheim/${RELEASE}/f.webp`), null)
  // Hin und zurueck, damit die beiden Funktionen ein Paar bleiben.
  stelleWelt()
  const hin = assetUrl(RELEASE, "", `${KENNUNG}-back.webp`)
  const zurueck = zerlegeAdresse(hin)
  gleich("hin und zurueck, Release", zurueck?.release, RELEASE)
  gleich("hin und zurueck, Pfad", zurueck?.pfad, `${KENNUNG}-back.webp`)
}

// ===========================================================================
console.log("\nbeuteAusPfad: wer ist das, und ueber welchen Weg")
{
  stelleWelt()
  const oertlich = `beneos_assets/cloud/items/${KENNUNG}/${KENNUNG}-front.webp`
  const o = beuteAusPfad(oertlich)
  gleich("oertlich: Kennung", o?.kennung, KENNUNG)
  gleich("oertlich: Rolle", o?.rolle, "front")
  gleich("oertlich: Release wird gebildet", o?.release, RELEASE)
  gleich("oertlich: nicht ueber das Tor", o?.ueberTor, false)

  const tor = assetUrl(RELEASE, "", `${KENNUNG}-icon.webp`)
  const t = beuteAusPfad(tor)
  gleich("Tor: Rolle", t?.rolle, "icon")
  gleich("Tor: ueber das Tor", t?.ueberTor, true)
  /*
   * BEI EINER TORADRESSE KOMMT DER RELEASENAME AUS DEM PFAD und wird nicht
   * aus der Kennung gebildet. Derselbe Fehler ist in `kreaturAusPfad()` schon
   * einmal gebaut und korrigiert worden: stimmte die Bildung nicht, holte die
   * Liste unter einem Namen, den es nicht gibt, bekaeme "kein Recht" und
   * antwortete "gibt es nicht".
   */
  gleich("Tor: Release aus dem Pfad", t?.release, RELEASE)
  /*
   * UND DAS IST DER FALL, DER ES BEWEIST: ein Release, dessen Name NICHT aus
   * dem Dateinamen folgt. Im Bestand ist das kein Gedankenspiel. Die
   * Installation legt die Karten unter dem INSTALL-Schluessel ab, und
   * `beneosCloudCardPaths()` nennt die SRD-Eintraege ausdruecklich als die
   * Gruppe mit abweichender Schluesselkonvention. Wer den Releasenamen aus
   * dem Dateinamen bildet, holt die Liste unter einem Namen, den es nicht
   * gibt, bekaeme "kein Recht" und antwortete "gibt es nicht".
   *
   * Ohne diesen Fall kann der Pruefsatz die Bildung nicht von der Lesung
   * unterscheiden, denn im Normalfall ergeben beide dasselbe.
   */
  const anders = `${GATE_DEFAULT_BASE}/l/pruefschluessel/${BEUTE_PRAEFIX}srd_sammlung/${KENNUNG}-front.webp`
  gleich("Tor: ein abweichender Releasename wird GELESEN, nicht gebildet",
    beuteAusPfad(anders)?.release, `${BEUTE_PRAEFIX}srd_sammlung`)

  // Der Abfrageteil gehoert nicht zur Identitaet.
  gleich("ein Cache-Brecher stoert nicht",
    beuteAusPfad(`${oertlich}?v=7`)?.rolle, "front")

  /*
   * NUR `.webp`, UND DAS IST DER WICHTIGSTE FALL DIESER DATEI. Drei Zauber im
   * Bestand tragen ihre Rueckseite als PNG. Der Spiegel nimmt sie nicht mit,
   * seine Positivliste kennt nur `.webp`. Wuerde diese Funktion `.png`
   * annehmen, baute der Aufrufer eine Toradresse auf eine Datei, die im
   * Spiegel nicht liegt, und bekaeme das 42-Byte-GIF.
   */
  gleich("ein PNG ist keine gelistete Seite",
    beuteAusPfad(`beneos_assets/cloud/spells/${KENNUNG}/${KENNUNG}-back.png`), null)
  gleich("eine fremde Rolle ist keine Seite",
    beuteAusPfad(`x/${KENNUNG}-search.webp`), null)
  gleich("ein nackter Name ohne Rolle ist nichts",
    beuteAusPfad(`x/${KENNUNG}.webp`), null)
  // Die Rolle wird klein gelesen: ein Dateiname in Grossbuchstaben ist dieselbe Seite.
  gleich("eine grossgeschriebene Rolle wird klein gelesen",
    beuteAusPfad(`x/${KENNUNG}-FRONT.webp`)?.rolle, "front")
  // Eine Kreaturenadresse gehoert nicht hierher, auch wenn der Dateiname
  // passte. Der Raum entscheidet, und er steht in der Adresse.
  gleich("eine Kreaturenadresse wird abgewiesen",
    beuteAusPfad(`${GATE_DEFAULT_BASE}/c/k/beneos_ct_g/${KENNUNG}-front.webp`), null)
  gleich("eine Kartenadresse wird abgewiesen",
    beuteAusPfad(`${GATE_DEFAULT_BASE}/a/k/beneos_bm_1/4k/${KENNUNG}-front.webp`), null)
}

// ===========================================================================
console.log("\nDie Kartenliste wird geholt, und nur einmal je Frist")
{
  stelleWelt()
  kartenVergessen()
  const gefragt = stelleAbruf((a) => a.endsWith("_karten.json")
    ? { koerper: liste(), kopf: {} } : null)

  const eins = await kartenliste(RELEASE)
  wahr("die Liste kommt an", !!eins && !!eins.karten)
  gleich("ein Abruf", gefragt.length, 1)
  wahr("und zwar auf `_karten.json` im eigenen Raum",
    gefragt[0] === `${GATE_DEFAULT_BASE}/l/pruefschluessel/${RELEASE}/_karten.json`)

  await kartenliste(RELEASE)
  await kartenliste(RELEASE)
  gleich("drei Aufrufe, weiter ein Abruf", gefragt.length, 1)

  /*
   * ZEHN AUFRUFER GLEICHZEITIG TEILEN EINEN ABRUF. Das Blatt und das
   * Begleitfenster fragen beide, und beide fragen nach Vorder- und
   * Rueckseite; ohne diesen Zusammenschluss waeren das vier Abrufe derselben
   * Datei je Render.
   */
  kartenVergessen()
  const parallel = await Promise.all(
    Array.from({ length: 10 }, () => kartenliste(RELEASE)))
  gleich("zehn gleichzeitige Aufrufe, ein zusaetzlicher Abruf", gefragt.length, 2)
  wahr("alle zehn bekommen dieselbe Liste", parallel.every((p) => p === parallel[0]))
}

console.log("\nEine fremde Antwort ist keine Liste")
{
  stelleWelt()
  for (const [name, antwort] of [
    ["eine Abweisung am Tor", { koerper: liste(), kopf: { "x-beneos-denied": "1" } }],
    ["eine Antwort ohne Verbindung", { koerper: liste(), kopf: { "x-beneos-offline": "1" } }],
    // Die Fehlseite des Hosters ist gueltiges JSON und kommt mit 200. Ohne den
    // Zeugen `karten` gaelte sie als Liste, und jede Rolle waere dann
    // `undefined`, also "nicht geprueft" statt "gibt es nicht".
    ["eine Fehlseite als JSON", { koerper: { error: "not found" }, kopf: {} }],
    ["karten ist kein Objekt", { koerper: { karten: "front" }, kopf: {} }],
    ["gar kein JSON", null],
  ]) {
    kartenVergessen()
    stelleAbruf(() => antwort)
    gleich(name, await kartenliste(RELEASE), null)
  }
  // Ein Netzfehler ist derselbe Ausgang wie keine Antwort: keine Liste.
  kartenVergessen()
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch") }
  gleich("ein Netzfehler ist keine Liste", await kartenliste(RELEASE), null)

  // Ohne Schluessel gibt es am Tor nichts zu holen, und es wird auch nicht
  // versucht: der Schluessel ist Teil der Adresse.
  kartenVergessen()
  stelleWelt({ schluessel: "" })
  const ohne = stelleAbruf(() => ({ koerper: liste(), kopf: {} }))
  gleich("ohne Schluessel keine Liste", await kartenliste(RELEASE), null)
  gleich("ohne Schluessel auch kein Abruf", ohne.length, 0)

  // Ein Name, der nicht in diesen Raum gehoert, loest keinen Abruf aus.
  kartenVergessen()
  stelleWelt()
  const fremd = stelleAbruf(() => ({ koerper: liste(), kopf: {} }))
  gleich("eine Kreatur hat hier keine Liste",
    await kartenliste("beneos_ct_goblin"), null)
  gleich("und erzeugt keinen Abruf", fremd.length, 0)
}

// ===========================================================================
console.log("\nkarte(): der Name kommt aus der Liste und wird nicht gebildet")
{
  stelleWelt()
  kartenVergessen()
  stelleAbruf((a) => a.endsWith("_karten.json") ? { koerper: liste(), kopf: {} } : null)
  const tor = assetUrl(RELEASE, "", `${KENNUNG}-front.webp`)

  const vorn = await karte(tor, ROLLEN.front)
  gleich("Vorderseite: vorhanden", vorn.zustand, true)
  gleich("Vorderseite: Adresse", vorn.src,
    `${GATE_DEFAULT_BASE}/l/pruefschluessel/${RELEASE}/${KENNUNG}-front.webp`)
  /*
   * DIE MASSE REISEN MIT, und sie sind kein Zierwerk: das Ersatzbild soll im
   * Seitenverhaeltnis des Originals erscheinen (`OP-PRJ-128`). Eine Klappkarte
   * ist hochkant, ein Symbol quadratisch; geraten waere das Ersatzbild
   * quadratisch und die Karte sichtbar verzerrt.
   */
  gleich("Vorderseite: Breite", vorn.breite, 1024)
  gleich("Vorderseite: Hoehe", vorn.hoehe, 1434)

  const sym = await karte(tor, ROLLEN.icon)
  gleich("Symbol: quadratisch gelistet", `${sym.breite}x${sym.hoehe}`, "500x500")

  // Aus einem Pfad der Vorderseite nach der Rueckseite fragen: derselbe
  // Eintrag, andere Rolle. Das ist der Normalfall im Blatt.
  const hinten = await karte(tor, ROLLEN.back)
  gleich("Rueckseite aus dem Vorderseitenpfad gefragt", hinten.zustand, true)
  wahr("und ihre Adresse traegt die Rueckseite",
    hinten.src.endsWith(`${KENNUNG}-back.webp`))

  gleich("eine Rolle, die es nicht gibt, bleibt offen",
    (await karte(tor, "rueckseite")).zustand, null)
  gleich("eine grossgeschriebene Rolle ist dieselbe Rolle",
    (await karte(tor, "FRONT")).zustand, true)
}

console.log("\nEine fehlende Rolle steht als null drin, und das IST eine Antwort")
{
  stelleWelt()
  kartenVergessen()
  stelleAbruf(() => ({ koerper: liste({ back: false }), kopf: {} }))
  const tor = assetUrl(RELEASE, "", `${KENNUNG}-front.webp`)

  const hinten = await karte(tor, ROLLEN.back)
  /*
   * DREI ZAUBER IM BESTAND TRAGEN KEINE RUECKSEITE, gemessen am 07.11.2026:
   * `0000_srd_guidance`, `0000_srd_message`, `0000_srd_prestidigitation`. Wer
   * den Namen bildet, bekommt fuer sie das 42-Byte-GIF und zeigt eine leere
   * Karte. `false` ist deshalb die richtige Antwort, nicht `null`: `null`
   * heisst "nicht geprueft" und liesse den Aufrufer weiter raten.
   */
  gleich("Rueckseite: gibt es nicht", hinten.zustand, false)
  gleich("Rueckseite: keine Adresse", hinten.src, null)
  gleich("die Oberflaeche darf sie nicht anbieten",
    await karteGibtEs(tor, ROLLEN.back), false)
  // Die Gegenrichtung im selben Lauf: die Vorderseite bleibt unberuehrt.
  gleich("die Vorderseite gibt es weiter",
    await karteGibtEs(tor, ROLLEN.front), true)
}

console.log("\nOhne Liste oder mit kaputtem Eintrag bleibt die Seite offen")
{
  /*
   * OFFEN HEISST HIER: DER AUFRUFER MACHT WEITER WIE VORHER. Eine Abweisung am
   * Tor sagt nichts darueber, ob die Seite liegt, und ein Eintrag ohne Pfad ist
   * ein kaputter Stand des Spiegels. Beides darf nicht als "gibt es" und nicht
   * als "gibt es nicht" gelesen werden.
   */
  stelleWelt()
  const tor = assetUrl(RELEASE, "", `${KENNUNG}-front.webp`)
  kartenVergessen()
  stelleAbruf(() => ({ koerper: liste(), kopf: { "x-beneos-denied": "1" } }))
  gleich("ohne Liste: nicht geprueft statt gibt es nicht", (await karte(tor, ROLLEN.front)).zustand, null)
  kartenVergessen()
  stelleAbruf(() => ({ koerper: { karten: { front: { breite: 1024, hoehe: 1434 } } }, kopf: {} }))
  gleich("ein Eintrag ohne Pfad: nicht geprueft", (await karte(tor, ROLLEN.front)).zustand, null)
  kartenVergessen()
  stelleAbruf(() => ({ koerper: { karten: { front: `${KENNUNG}-front.webp` } }, kopf: {} }))
  gleich("ein Eintrag als blosse Zeichenkette: nicht geprueft", (await karte(tor, ROLLEN.front)).zustand, null)
  kartenVergessen()
}

console.log("\nEin oertlicher Pfad bleibt ausdruecklich offen")
{
  stelleWelt()
  kartenVergessen()
  const gefragt = stelleAbruf(() => ({ koerper: liste(), kopf: {} }))
  const oertlich = `beneos_assets/cloud/items/${KENNUNG}/${KENNUNG}-front.webp`

  const b = await karte(oertlich, ROLLEN.back)
  /*
   * DIE ADRESSE WAEHLT DIE QUELLE, NICHT DIE EINSTELLUNG. Eine Welt kann auf
   * `download` stehen, waehrend Streaming eingeschaltet ist; dann sagt die
   * Liste "die Rueckseite gibt es im Spiegel", die Datei liegt aber nicht auf
   * der Platte des Kunden. Und `null` heisst hier "nimm, was du ohne diese
   * Datei getan haettest", also das Verhalten von vor diesem Paket.
   */
  gleich("oertlich: nicht geprueft", b.zustand, null)
  gleich("oertlich: keine Adresse", b.src, null)
  gleich("oertlich: kein Abruf", gefragt.length, 0)
  gleich("die Oberflaeche bietet sie damit nicht an",
    await karteGibtEs(oertlich, ROLLEN.back), false)
}

console.log("\nVergessen und Bericht")
{
  stelleWelt()
  kartenVergessen()
  const gefragt = stelleAbruf(() => ({ koerper: liste({ back: false }), kopf: {} }))
  await kartenliste(RELEASE)
  const stand = kartenStand()
  gleich("eine Liste gemerkt", stand.listen, 1)
  gleich("der Bericht nennt das Release", stand.je[0]?.release, RELEASE)
  gleich("und welche Rollen liegen", JSON.stringify(stand.je[0]?.rollen),
    JSON.stringify({ front: true, back: false, icon: true }))
  /*
   * NACH EINER INSTALLATION MUSS DIE ANTWORT WEG. Dort aendert sich, WO die
   * Dateien liegen, und eine fuenf Minuten alte Antwort waere eine Antwort auf
   * die Welt von vorher.
   */
  kartenVergessen(RELEASE)
  gleich("vergessen heisst vergessen", kartenStand().listen, 0)
  await kartenliste(RELEASE)
  gleich("und danach wird neu geholt", gefragt.length, 2)
}

// ===========================================================================
// ===========================================================================
console.log("\nkarteFuerBlatt(): der Vorrang dreht sich nur bei einer Toradresse")
{
  /*
   * DER BEFUND, DER TEIL 2 AUSGELOEST HAT, gemessen am 08.11.2026.
   *
   * Zwei Oberflaechen bauten dieselben zwei Zeilen:
   *
   *   const cloudCards = beneosCloudCardPaths(item)
   *   const frontCard  = cloudCards.front || loot.render?.frontCardWebp
   *
   * `beneosCloudCardPaths()` bildet einen OERTLICHEN Pfad aus der Kennung und
   * liefert damit IMMER einen Wert. Eine Toradresse im gespeicherten Feld
   * wurde von diesem Vorrang verdraengt und NIE benutzt. Der Umbau ist
   * deshalb nicht "eine Adresse bilden", sondern "den Vorrang umdrehen, wo
   * eine Toradresse steht".
   */
  stelleWelt()
  kartenVergessen()
  const gefragt = stelleAbruf(() => ({ koerper: liste(), kopf: {} }))

  const tor = assetUrl(RELEASE, "", `${KENNUNG}-front.webp`)
  const oertlich = `beneos_assets/cloud/items/${KENNUNG}/${KENNUNG}-front.webp`

  const ueberTor = await karteFuerBlatt(tor, oertlich, "front")
  gleich("eine Toradresse schlaegt den oertlichen Pfad", ueberTor.src, tor)
  gleich("und die Masse kommen aus der Liste",
    `${ueberTor.breite}x${ueberTor.hoehe}`, "1024x1434")
  gleich("dafuer wurde die Liste geholt", gefragt.length, 1)

  /*
   * DER NORMALFALL IST DER DRITTE AUSGANG, und er ist die Bedingung dafuer,
   * dass hier gebaut werden durfte: eine oertlich installierte Welt verhaelt
   * sich Zeichen fuer Zeichen wie vor dieser Datei.
   */
  const nurOertlich = await karteFuerBlatt(
    `beneos_assets/beneos_items/${KENNUNG}/${KENNUNG}-front.webp`,
    oertlich, "front")
  gleich("ein oertlicher gespeicherter Pfad laesst den Vorrang wie er war",
    nurOertlich.src, oertlich)
  gleich("und die Masse bleiben offen, denn ueber eine Platte weiss diese "
    + "Datei nichts",
    `${nurOertlich.breite},${nurOertlich.hoehe}`, "null,null")
  gleich("und es wurde NICHTS geholt", gefragt.length, 1)

  // Gar kein gespeicherter Wert: auch dann der oertliche Pfad.
  const leer = await karteFuerBlatt(null, oertlich, "front")
  gleich("ohne gespeicherten Wert bleibt der oertliche Pfad", leer.src, oertlich)

  // Ohne oertlichen Pfad bleibt ein oertlich gespeicherter Wert stehen.
  const gespeichertOertlich = `beneos_assets/beneos_items/${KENNUNG}/${KENNUNG}-front.webp`
  gleich("ohne oertlichen Pfad bleibt der gespeicherte",
    (await karteFuerBlatt(gespeichertOertlich, null, "front")).src, gespeichertOertlich)

  // Weder noch: null, und keine gebildete Adresse.
  const nichts = await karteFuerBlatt(null, null, "front")
  gleich("ohne beides kommt null und keine gebildete Adresse", nichts.src, null)
}

console.log("\nkarteFuerBlatt(): eine fehlende Seite faellt weg statt leer zu erscheinen")
{
  /*
   * DAS IST DER EIGENTLICHE GEWINN DES PAKETS, und er ist am Bestand
   * gemessen. `OP-PRJ-139` hat am 07.11.2026 gezaehlt: drei Zauber tragen GAR
   * KEINE Rueckseite, drei weitere tragen sie als PNG und damit unter einem
   * Namen, den die Positivliste des Spiegels nicht mitnimmt.
   *
   * Wer `<kennung>-back.webp` BILDET, bekommt bei diesen sechs Eintraegen am
   * Tor ein durchsichtiges GIF von 42 Byte. Das ist ein GUELTIGES Bild: der
   * Browser zeichnet es, nichts meldet einen Fehler, und der Kunde sieht eine
   * leere Kachel.
   */
  stelleWelt()
  kartenVergessen()
  stelleAbruf(() => ({ koerper: liste({ back: false }), kopf: {} }))

  const torBack = assetUrl(RELEASE, "", `${KENNUNG}-back.webp`)
  const oertlichBack = `beneos_assets/cloud/items/${KENNUNG}/${KENNUNG}-back.webp`

  const fehlt = await karteFuerBlatt(torBack, oertlichBack, "back")
  gleich("die Liste sagt nein, also kommt null", fehlt.src, null)

  /*
   * UND DER OERTLICHE PFAD DARF HIER NICHT EINSPRINGEN. Das ist der Fall, der
   * ohne eigenen Satz durchfiele: ein Rueckfall auf `oertlich` sieht wie
   * Vorsicht aus und waere genau der Fehler, denn die Datei liegt dort nicht.
   */
  wahr("der oertliche Pfad springt NICHT ein", fehlt.src !== oertlichBack)

  // Die Vorderseite derselben Liste kommt weiter.
  const vorne = await karteFuerBlatt(
    assetUrl(RELEASE, "", `${KENNUNG}-front.webp`), null, "front")
  wahr("die Vorderseite derselben Liste kommt weiter", !!vorne.src)
}

console.log("\nkarteFuerBlatt(): eine unbekannte Rolle gibt nichts aus")
{
  stelleWelt()
  kartenVergessen()
  const gefragt = stelleAbruf(() => ({ koerper: liste(), kopf: {} }))
  const tor = assetUrl(RELEASE, "", `${KENNUNG}-front.webp`)
  const krims = await karteFuerBlatt(tor, "oertlich.webp", "krims")
  /*
   * Eine Rolle, die `ROLLEN` nicht kennt, ist ein Fehler im Aufrufer. `karte()`
   * gibt dafuer `zustand: null`, also faellt sie in den dritten Ausgang und
   * bekommt den oertlichen Pfad. Das ist richtig: diese Datei entscheidet
   * nichts, was sie nicht weiss, und der Aufrufer verhaelt sich wie vorher.
   */
  gleich("eine unbekannte Rolle faellt in den dritten Ausgang",
    krims.src, "oertlich.webp")
  gleich("und loest keinen Abruf aus", gefragt.length, 0)
}

// ===========================================================================
abschnitt("Die zwei Oberflaechen zeigen, was karteFuerBlatt liefert, vorne und hinten")
/*
 * WARUM AM KONTEXTBAUER. Das Blatt (`ItemSheetExtender._buildContext`) und
 * der Begleiter (`ItemCompanion#_context`) holen ihre Kartenbilder ueber
 * `karteFuerBlatt()`. Wer nur die Vorderseite umstellt, laesst die Rueckseite
 * den Namen bilden, und genau die Rueckseite ist die, die bei sechs
 * Eintraegen fehlt. Wer das `await` vergisst, reicht ein Versprechen statt
 * einer Adresse weiter. Und der oertliche Pfad muss als dritter Ausgang
 * weitergegeben werden, denn er heilt SRD-Eintraege.
 *
 * Bis zum 14.11.2026 stand das hier als Textsuche in den zwei Dateien
 * (Befund B6 der Stream-Inventur). Seit stre-T-017 werden beide Bauer
 * gerufen, mit einem gestellten Gegenstand und der gestellten Liste.
 */
installiereFoundry({
  einstellungen: { [SETTING.key]: "pruefschluessel", [SETTING.base]: GATE_DEFAULT_BASE, [SETTING.mode]: true },
})
const { ItemSheetExtender } = await import("../loot/item-sheet-extender.mjs")
const { ItemCompanion } = await import("../codex2/item-companion.mjs")
{
  const OERTLICH_VORN = `beneos_assets/cloud/items/${KENNUNG}/${KENNUNG}-front.webp`
  const OERTLICH_HINTEN = `beneos_assets/cloud/items/${KENNUNG}/${KENNUNG}-back.webp`
  const amTor = (rolle) => assetUrl(RELEASE, "", `${KENNUNG}-${rolle}.webp`)
  const platz = (rolle) => platzhalterAdresse(RELEASE, "", `${KENNUNG}-${rolle}.webp`)
  function stelleGegenstand(render) {
    const loot = { render, origin: {} }
    const item = { name: "Longsword", getFlag: (scope) => (scope === "world" ? { itemKey: KENNUNG } : loot) }
    return { loot, item }
  }
  const BAUER = [
    ["item-sheet-extender", ({ loot, item }) => ItemSheetExtender._buildContext(loot, item)],
    ["item-companion", ({ item }) => new ItemCompanion(null, item)._context()],
  ]
  for (const [name, baue] of BAUER) {
    kartenVergessen()
    stelleAbruf(() => ({ koerper: liste(), kopf: {} }))
    let k = await baue(stelleGegenstand({ frontCardWebp: platz("front"), backCardWebp: platz("back") }))
    gleich(`${name}: vorne die Toradresse aus der Liste`, k.frontCard, amTor("front"))
    gleich(`${name}: hinten die Toradresse aus der Liste`, k.backCard, amTor("back"))

    kartenVergessen()
    stelleAbruf(() => ({ koerper: liste({ back: false }), kopf: {} }))
    k = await baue(stelleGegenstand({ frontCardWebp: platz("front"), backCardWebp: platz("back") }))
    gleich(`${name}: die Liste kennt hinten nichts, also keine Rueckseite`, k.backCard, null)
    gleich(`${name}: die Vorderseite kommt weiter`, k.frontCard, amTor("front"))

    kartenVergessen()
    const gefragt = stelleAbruf(() => ({ koerper: liste(), kopf: {} }))
    k = await baue(stelleGegenstand({}))
    gleich(`${name}: ohne gespeicherte Adresse kommt vorne der oertliche Pfad`, k.frontCard, OERTLICH_VORN)
    gleich(`${name}: und hinten ebenso`, k.backCard, OERTLICH_HINTEN)
    gleich(`${name}: dafuer wird nichts geholt`, gefragt.length, 0)
  }

  /*
   * DIE RUFER WARTEN. Ein Bauer, der richtig rechnet, hilft nichts, wenn sein
   * Rufer das `await` vergisst: die Vorlage bekaeme ein Versprechen statt eines
   * Kontexts, und die Beneos-Flaeche bliebe leer (Fehlerklasse OP-PRJ-216).
   * Deshalb werden hier die Rufer gefahren, bis zur Vorlage, die mitschreibt
   * und anhaelt.
   */
  const VORLAGE_HALT = "Pruefsatz haelt an der Vorlage an"
  const gesehen = []
  foundry.applications.handlebars = {
    "renderTemplate": async (_pfad, ctx) => { gesehen.push(ctx); throw new Error(VORLAGE_HALT) },
  }
  globalThis.HTMLElement ??= class {}
  const wurzel = Object.assign(new globalThis.HTMLElement(), { querySelector: () => null })
  const RUFER = [
    ["item-sheet-extender", (g) => ItemSheetExtender._inject({ document: g.item }, wurzel)],
    ["item-companion", (g) => new ItemCompanion(null, g.item)._render(wurzel)],
  ]
  for (const [name, rufe] of RUFER) {
    kartenVergessen()
    stelleAbruf(() => ({ koerper: liste(), kopf: {} }))
    gesehen.length = 0
    let halt = null
    try {
      await rufe(stelleGegenstand({ frontCardWebp: platz("front"), backCardWebp: platz("back") }))
    } catch (fehler) {
      halt = String(fehler?.message || fehler)
    }
    gleich(`${name}: der Rufer erreicht die Vorlage`, halt, VORLAGE_HALT)
    gleich(`${name}: die Vorlage bekommt den fertigen Kontext mit der Toradresse`, gesehen[0]?.frontCard, amTor("front"))
  }
  kartenVergessen()
}

// ===========================================================================
console.log("\nDer Deckel des Merkers haelt, auch ueber eine lange Sitzung")
{
  stelleWelt()
  kartenVergessen()
  stelleAbruf(() => ({ koerper: liste(), kopf: {} }))
  /*
   * OHNE DECKEL WAECHST DER ZWISCHENSPEICHER UEBER DIE SITZUNG. Bei den
   * Kreaturen war das gemessen und nicht vermutet: Tokenpfade tragen im
   * Bestand mitunter einen Cache-Brecher, also bekam dieselbe Datei je Abruf
   * einen neuen Eintrag. Hier sind die Schluessel Releasenamen, also waechst
   * die Karte mit dem Bestand: 1240 veroeffentlichte Eintraege, und ein
   * Spielabend, der durch das Inventar blaettert, legt sie alle an.
   *
   * Der Deckel liegt im geteilten Merker, also prueft dieser Fall zugleich,
   * dass die Teilung traegt.
   */
  const viele = KARTE_MAX + 50
  for (let i = 0; i < viele; i++) {
    await kartenliste(`${BEUTE_PRAEFIX}fuellstand_${i}`)
  }
  const stand = kartenStand().listen
  wahr("viele Releases: gemerkt bleiben hoechstens KARTE_MAX", stand > 0 && stand <= KARTE_MAX)
  kartenVergessen()
}

// ===========================================================================
abschnitt("Strukturproben: die Regel steht nicht nur im Kommentar")
const hier = dirname(fileURLToPath(import.meta.url))
const karten = readFileSync(join(hier, "stream-karten.mjs"), "utf8")
const posen = readFileSync(join(hier, "stream-posen.mjs"), "utf8")

/*
 * WARUM DIESE PROBEN. Die Faelle oben messen das Verhalten der heutigen
 * Fassung. Sie faengen aber nicht den Rueckfall, bei dem jemand den Namen
 * wieder BILDET und dabei zufaellig dasselbe Ergebnis erzeugt, weil die
 * gestellte Liste denselben Namen traegt. Das ist eine Aussage ueber den Code
 * selbst, darum steht sie als Strukturprobe.
 */
const ausDerListe = (karten.match(/assetUrl\(wer\.release, "", eintrag\.pfad\)/g) || []).length
struktur("die Adresse entsteht aus `eintrag.pfad`", ausDerListe, 1)
// Nur Kommentarzeilen duerfen einen Rollennamen an eine Kennung haengen.
const codeZeilen = karten.split("\n").filter((z) => {
  const k = z.trimStart()
  return k !== "" && k[0] !== "*" && !k.startsWith("//") && !k.startsWith("/*")
})
const gebildet = codeZeilen.filter((z) => /-\$\{?(rolle|ziel)/.test(z)).length
struktur("kein Dateiname wird im Code zusammengesetzt", gebildet, 0)

/*
 * DER GETEILTE MERKER DARF NICHT WIEDER ZUR KOPIE WERDEN. Beide Dateien
 * fuehren Fristen und Deckel; abgeschrieben waere die Verdraengung zweimal
 * geschrieben und beim naechsten Fehler nur an einer Stelle behoben.
 */
struktur("stream-karten holt den Merker", karten.includes('from "./stream-merker.mjs"'), true)
struktur("stream-posen holt denselben Merker", posen.includes('from "./stream-merker.mjs"'), true)
const eigenerMerker = (karten + posen).match(/^function (merken|einmal|frisch)\(/gm) || []
struktur("keine der beiden Dateien hat einen eigenen Merker", eigenerMerker.length, 0)

/*
 * DER BEUTESCHALTER WIRD GENAU EINMAL GEFRAGT (stre-T-015, TC-313). Die
 * Faelle weiter unten messen, was der Schalter bewirkt, aber nicht, wie oft er
 * gelesen wird: ein gedoppelter Ruf gibt denselben Wert, und die Attrappe
 * zaehlt keine Lesezugriffe. Gezaehlt wird darum im Code, Kommentarzeilen
 * ausgenommen wie oben bei `codeZeilen`. Zwei heisst: die Definition und die
 * eine Rufstelle im Item-Installer.
 */
const cloudCode = readFileSync(join(hier, "..", "beneos_cloud.js"), "utf8").split(/\r?\n/).filter((z) => {
  const k = z.trimStart()
  return k !== "" && k[0] !== "*" && !k.startsWith("//") && !k.startsWith("/*")
}).join("\n")
const schalterRufe = (cloudCode.match(/_beneosBeuteStreamt\(\)/g) || []).length
struktur("der Beuteschalter steht genau zweimal im Code, Definition und eine Rufstelle", schalterRufe, 2)

// ===========================================================================
abschnitt("Die Streamweiche des Item-Installers, OP-PRJ-141 Teil 4, gefahren")
/*
 * DER WICHTIGSTE SATZ IST EIN SICHERHEITSSATZ. `flags.beneos-module.loot.render`
 * steht in einem Kundendokument, das exportiert, kopiert und weitergegeben
 * wird. Wer dort `assetUrl()` schreibt statt `_beneosBeutePlatzhalter()`,
 * legt den Streamschluessel in ein Feld, das jeder Mitspieler liest, und ein
 * Dritter koennte damit am Tor abrufen. Gemessen am 09.11.2026: ein Konto mit
 * `role: 1` liest die Welteinstellungen vollstaendig, siehe `TC-PRJ-STR-310`.
 *
 * Bis zum 14.11.2026 las dieser Abschnitt `beneos_cloud.js` als Text, weil der
 * Installer Foundry braucht. Seit stre-T-017 laeuft `importItemToCompendium`
 * gegen gestellte Teile: ein Pack, ein `FilePicker`, der Hochgeladenes
 * mitschreibt, und eine Dokumentklasse, die festhaelt, was ins Kompendium
 * gehen soll, und den Lauf dort anhaelt. Weiter als bis dahin faehrt der Satz
 * nicht; was danach kommt, steht unten unter "Nicht geprueft".
 */
const SCHLUESSEL_INSTALLER = "pruefschluessel"
const installer = { erfasst: [], hochgeladen: [], gewarnt: [] }
const HALT = "Pruefsatz haelt hier an"
function stelleInstaller({ streamt = true } = {}) {
  installiereFoundry({
    einstellungen: { [SETTING.key]: SCHLUESSEL_INSTALLER, [SETTING.base]: GATE_DEFAULT_BASE, [SETTING.mode]: streamt },
  })
  game.system = { id: "dnd5e" }
  game.beneos = { databaseHolder: {} }
  game.packs = new Map([["world.beneos_module_items", { getIndex: async () => [], configure: async () => {} }]])
  foundry.applications.apps = {
    "FilePicker": {
      implementation: {
        createDirectory: async () => {},
        upload: async (_quelle, ordner, datei) => { installer.hochgeladen.push(datei.name); return { path: `${ordner}/${datei.name}` } },
      },
    },
  }
  CONFIG.Item = {
    documentClass: class {
      constructor(daten) {
        installer.erfasst.push(JSON.parse(JSON.stringify(daten)))
        throw new Error(HALT)
      }
    },
  }
  installer.erfasst.length = 0
  installer.hochgeladen.length = 0
  installer.gewarnt.length = 0
}
const ALTPFAD = `beneos_assets/beneos_items/${KENNUNG}`
function eintrag({ mitRender = true, frontName = `${KENNUNG}-front.webp` } = {}) {
  const bild = (filename) => ({ filename, image64: "QUJD" })
  const itemJSON = {
    name: "Longsword of Dawn",
    type: "loot",
    img: "",
    system: { description: { value: "" } },
    effects: [],
    flags: mitRender
      ? { "beneos-module": { loot: { render: {
        frontCardWebp: `${ALTPFAD}/${KENNUNG}-front.webp`,
        backCardWebp: `${ALTPFAD}/${KENNUNG}-back.webp`,
        iconWebp: `${ALTPFAD}/${KENNUNG}-icon.webp`,
      } } } }
      : {},
  }
  return { [KENNUNG]: { itemJSON, itemImage: { front: bild(frontName), back: bild(`${KENNUNG}-back.webp`), icon: bild(`${KENNUNG}-icon.webp`) } } }
}
async function installiere(daten) {
  const warnVorher = console.warn
  console.warn = (...a) => { installer.gewarnt.push(a.map(String).join(" ")) }
  let halt = null
  try {
    await new BeneosCloud().importItemToCompendium(daten, null)
  } catch (fehler) {
    halt = String(fehler?.message || fehler)
  } finally {
    console.warn = warnVorher
  }
  const doc = installer.erfasst[0]
  return { halt, doc, render: doc?.flags?.["beneos-module"]?.loot?.render ?? null }
}
const NEU = `beneos_assets/cloud/items/${KENNUNG}`
const platzVon = (datei) => platzhalterAdresse(RELEASE, "", datei)
// Das Tor ist gestellt, `data:` geht an den echten Abruf.
function stelleTorAbruf(antwortFuer) {
  const gefragt = stelleAbruf(antwortFuer)
  const torAbruf = globalThis.fetch
  globalThis.fetch = async (adresse, o) => (String(adresse).startsWith("data:") ? echterAbruf(adresse, o) : torAbruf(adresse, o))
  return gefragt
}

stelleInstaller()
const { BeneosCloud } = await import("../beneos_cloud.js")

{
  // 1. Streamen an, die Liste nennt beide Seiten.
  stelleInstaller()
  kartenVergessen()
  const gefragt = stelleTorAbruf(() => ({ koerper: liste(), kopf: {} }))
  const r = await installiere(eintrag())
  gleich("der Lauf erreicht die Dokumentklasse", r.halt, HALT)
  gleich("Streamen an: vorne steht der Platzhalter", r.render?.frontCardWebp, platzVon(`${KENNUNG}-front.webp`))
  gleich("Streamen an: hinten steht der Platzhalter", r.render?.backCardWebp, platzVon(`${KENNUNG}-back.webp`))
  gleich("kein Kartenfeld traegt den Schluessel",
    JSON.stringify(r.render || {}).includes(SCHLUESSEL_INSTALLER), false)
  gleich("das Symbolfeld bekommt keine Adresse, nur den neuen Ordner",
    r.render?.iconWebp, `${NEU}/${KENNUNG}-icon.webp`)
  gleich("das Bild des Gegenstands bleibt der oertliche Pfad", r.doc?.img, `${NEU}/${KENNUNG}-icon.webp`)
  gleich("hochgeladen wird nur das Symbol", installer.hochgeladen.join(), `${KENNUNG}-icon.webp`)
  gleich("die Liste wurde am Tor gefragt", gefragt.filter((a) => a.endsWith("/_karten.json")).length > 0, true)
  gleich("danach ist der Kartenmerker geleert", kartenStand().listen, 0)
}
{
  // 2. Die Liste kennt die Rueckseite nicht: jede Seite hat ihre eigene Frage.
  stelleInstaller()
  kartenVergessen()
  stelleTorAbruf(() => ({ koerper: liste({ back: false }), kopf: {} }))
  const r = await installiere(eintrag())
  gleich("ohne Rueckseite am Tor: vorne der Platzhalter", r.render?.frontCardWebp, platzVon(`${KENNUNG}-front.webp`))
  gleich("ohne Rueckseite am Tor: hinten der oertliche Pfad", r.render?.backCardWebp, `${NEU}/${KENNUNG}-back.webp`)
  gleich("ohne Rueckseite am Tor: die Rueckseite wird hochgeladen",
    installer.hochgeladen.join(), `${KENNUNG}-back.webp,${KENNUNG}-icon.webp`)
}
{
  // 3. Ohne Vorderseite am Tor: dieselbe Frage fuer die andere Seite.
  stelleInstaller()
  kartenVergessen()
  stelleTorAbruf(() => ({ koerper: liste({ front: false }), kopf: {} }))
  const r = await installiere(eintrag())
  gleich("ohne Vorderseite am Tor: vorne der oertliche Pfad", r.render?.frontCardWebp, `${NEU}/${KENNUNG}-front.webp`)
  gleich("ohne Vorderseite am Tor: hinten der Platzhalter", r.render?.backCardWebp, platzVon(`${KENNUNG}-back.webp`))
  gleich("ohne Vorderseite am Tor: die Vorderseite wird hochgeladen",
    installer.hochgeladen.join(), `${KENNUNG}-front.webp,${KENNUNG}-icon.webp`)
}
{
  // 4. Streamen aus: alles wird heruntergeladen, das Tor wird nicht gefragt.
  stelleInstaller({ streamt: false })
  kartenVergessen()
  const gefragt = stelleTorAbruf(() => ({ koerper: liste(), kopf: {} }))
  const r = await installiere(eintrag())
  gleich("Streamen aus: vorne der oertliche Pfad", r.render?.frontCardWebp, `${NEU}/${KENNUNG}-front.webp`)
  gleich("Streamen aus: hinten der oertliche Pfad", r.render?.backCardWebp, `${NEU}/${KENNUNG}-back.webp`)
  gleich("Streamen aus: alle drei Bilder werden hochgeladen",
    installer.hochgeladen.join(), `${KENNUNG}-front.webp,${KENNUNG}-back.webp,${KENNUNG}-icon.webp`)
  gleich("Streamen aus: das Tor wird nicht gefragt", gefragt.length, 0)
}
{
  // 5. Ein Eintrag ohne Kartenfelder: es gibt kein Feld fuer die Adresse,
  //    also wird heruntergeladen. Einen Nachholzweig gibt es nicht.
  stelleInstaller()
  kartenVergessen()
  stelleTorAbruf(() => ({ koerper: liste(), kopf: {} }))
  await installiere(eintrag({ mitRender: false }))
  gleich("ohne Kartenfelder: alle drei Bilder werden hochgeladen",
    installer.hochgeladen.join(), `${KENNUNG}-front.webp,${KENNUNG}-back.webp,${KENNUNG}-icon.webp`)
  gleich("ohne Kartenfelder: es wird gewarnt", installer.gewarnt.some((w) => w.includes("loot.render")), true)
}
{
  // 6. Ein Dateiname, der in keine Adresse passt, geht auf die Platte. Das ist
  //    derselbe Riegel, den die Kreaturen tragen.
  stelleInstaller()
  kartenVergessen()
  stelleTorAbruf(() => ({ koerper: liste(), kopf: {} }))
  const r = await installiere(eintrag({ frontName: "longsword front.webp" }))
  gleich("ein Name mit Leerzeichen: vorne der oertliche Pfad", r.render?.frontCardWebp, `${NEU}/${KENNUNG}-front.webp`)
  gleich("ein Name mit Leerzeichen: hinten weiter der Platzhalter", r.render?.backCardWebp, platzVon(`${KENNUNG}-back.webp`))
  gleich("ein Name mit Leerzeichen: er wird hochgeladen",
    installer.hochgeladen.join(), "longsword front.webp,0042_longsword_of_dawn-icon.webp")
}
{
  /*
   * DER RIEGEL AM DATEINAMEN. Ein Leerzeichen mit Rollenendung erreicht die
   * Liste und wuerde dort gefunden; erst `_beneosBeuteDateiOk()` haelt es
   * von der Adresse fern. Der Fall oben ohne Rollenendung trifft diesen
   * Riegel nicht, denn ihn haelt schon `beuteAusPfad()` auf.
   */
  stelleInstaller()
  kartenVergessen()
  stelleTorAbruf(() => ({ koerper: liste(), kopf: {} }))
  const r = await installiere(eintrag({ frontName: `${KENNUNG} copy-front.webp` }))
  gleich("ein Zeichen ausserhalb der Liste: vorne der oertliche Pfad", r.render?.frontCardWebp, `${NEU}/${KENNUNG}-front.webp`)
}
{
  // 7. Scheitert die Frage am Tor mit einer Ausnahme, geht die Karte auf die Platte.
  stelleInstaller()
  kartenVergessen()
  globalThis.fetch = async (adresse, o) => {
    if (String(adresse).startsWith("data:")) return echterAbruf(adresse, o)
    throw new TypeError("Failed to fetch")
  }
  const r = await installiere(eintrag())
  gleich("Tor wirft: vorne der oertliche Pfad", r.render?.frontCardWebp, `${NEU}/${KENNUNG}-front.webp`)
  gleich("Tor wirft: hinten der oertliche Pfad", r.render?.backCardWebp, `${NEU}/${KENNUNG}-back.webp`)
}
kartenVergessen()

// ---------------------------------------------------------------------------
console.log("\nNicht geprueft, ausdruecklich benannt:")
console.log("- Das lebende Tor. Hier laeuft kein Netz, `fetch` ist gestellt. Dass")
console.log("  `/l/` Bytes liefert, entscheidet TC-PRJ-STR-281.")
console.log("- Ob im Spiegel unter `beute/` wirklich etwas liegt. Der Fuelltakt stand")
console.log("  am 08.11.2026 in keinem Cron und ist nie gelaufen.")
console.log("- Dass das Blatt nach dem Kontextbau eine Karte ZEIGT. Das braucht ein")
console.log("  Foundry und ist TC-PRJ-STR-296.")
console.log("- Der Installer nach der Dokumentklasse: Ordner, Import ins Kompendium,")
console.log("  Weltkopie. Der Satz haelt dort an.")
console.log("- Die Masse im Ersatzbild. Dass sie ankommen, steht hier; dass das")
console.log("  Ersatzbild sie benutzt, ist OP-PRJ-128.")
ende()
