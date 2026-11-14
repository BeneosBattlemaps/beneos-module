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
  assetUrl, zerlegeAdresse, istBeute, istKreatur,
  BEUTE_PRAEFIX, KREATUR_PRAEFIX, SETTING, GATE_DEFAULT_BASE,
} from "./stream-settings.mjs"
import {
  beuteAusPfad, kartenliste, karte, karteFuerBlatt, karteGibtEs,
  kartenVergessen, kartenStand, ROLLEN,
} from "./stream-karten.mjs"
import { KARTE_MAX } from "./stream-merker.mjs"

let rot = 0
let gruen = 0

function gleich(name, ist, soll) {
  if (ist === soll) { gruen++; console.log(`  ok   ${name}`) }
  else {
    rot++
    console.log(`  ROT  ${name}`)
    console.log(`       soll ${JSON.stringify(soll)}`)
    console.log(`       ist  ${JSON.stringify(ist)}`)
  }
}

function wahr(name, bedingung) { gleich(name, Boolean(bedingung), true) }

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
console.log("\nDie zwei Oberflaechen rufen den Helfer, und zwar mit await")
{
  /*
   * AM QUELLTEXT GEMESSEN UND NICHT GEFAHREN. Beide Dateien ziehen Foundry
   * und Handlebars herein; ein Lauf hier erreicht sie nicht.
   *
   * ZWEI DER DREI DATEIEN TRAGEN CRLF. Kein Muster unten traegt heute ein
   * `\n`, also schuetzt die Normalisierung im Moment nichts; sie steht als
   * Vorsorge fuer das erste Muster, das ueber eine Zeilengrenze geht. Dieselbe
   * Falle hat am 08.11.2026 ein Umbauskript abbrechen lassen, und ein Muster
   * mit `\n` haette hier still nichts gefunden und dabei wie ein bestandener
   * Satz ausgesehen.
   */
  const HIER = dirname(fileURLToPath(import.meta.url))
  const FLAECHEN = [
    ["item-sheet-extender.mjs",
      join(HIER, "..", "loot", "item-sheet-extender.mjs"), "_buildContext"],
    ["item-companion.mjs",
      join(HIER, "..", "codex2", "item-companion.mjs"), "_context"],
  ]

  for (const [name, pfad, bauer] of FLAECHEN) {
    const text = readFileSync(pfad, "utf8").replace(/\r\n/g, "\n")

    wahr(`${name} bindet karteFuerBlatt ein`,
      /import \{ karteFuerBlatt \} from "\.\.\/stream\/stream-karten\.mjs"/
        .test(text))

    // ZWEI Rufe, einer je Seite. Die ZAHL ist der Satz: wer nur die
    // Vorderseite umstellt, laesst die Rueckseite den Namen bilden, und
    // genau die Rueckseite ist die, die bei sechs Eintraegen fehlt.
    const rufe = (text.match(/await karteFuerBlatt\(/g) || []).length
    gleich(`${name} ruft ihn zweimal, vorne und hinten`, rufe, 2)

    // Und der alte Vorrang darf nicht daneben stehen bleiben.
    wahr(`${name} traegt den alten Vorrang nicht mehr`,
      !/cloudCards\.(front|back)\s*\|\|/.test(text))

    // Die Namensbildung selbst bleibt und wird weitergegeben: sie ist der
    // dritte Ausgang und heilt SRD-Eintraege.
    wahr(`${name} gibt den oertlichen Pfad weiter statt ihn wegzuwerfen`,
      /cloudCards\.front/.test(text) && /cloudCards\.back/.test(text))

    /*
     * DER RUFER MUSS WARTEN, und das ist der Fall, der am 08.11.2026 als
     * einziger durch alle Sabotagen hindurchkam.
     *
     * Der Bauer des Anzeigekontexts ist jetzt `async`. Verliert sein Rufer das
     * `await`, bekommt die Vorlage ein Promise statt eines Kontexts, und das
     * Blatt bleibt leer. Der Code ist dabei gueltig, also faengt es auch
     * `node --check` im Vorhaken nicht; es faellt erst im laufenden Foundry
     * auf, und dort als "zeigt nichts" ohne Fehlermeldung.
     *
     * Gezaehlt wird darum jedes Vorkommen des Namens: eines ist die
     * Festlegung, jedes weitere ist ein Ruf und MUSS `await` tragen. Die
     * Festlegung selbst wird an ihrem `async` erkannt, nicht an ihrer Zeile.
     */
    const stellen = [...text.matchAll(
      new RegExp(`(await\\s+)?[\\w.]*\\b${bauer}\\(`, "g"))]
    const feste = stellen.filter((m) => /async\s+[\w.]*$/.test(
      text.slice(Math.max(0, m.index - 20), m.index)))
    const bauerRufe = stellen.filter((m) => !feste.includes(m))
    gleich(`${name}: ${bauer} ist genau einmal festgelegt`, feste.length, 1)
    wahr(`${name}: ${bauer} wird mindestens einmal gerufen`, bauerRufe.length >= 1)
    gleich(`${name}: jeder Ruf von ${bauer} wartet`,
      bauerRufe.filter((m) => !m[1]).length, 0)

    // Und die Festlegung traegt `async`, sonst waere `await` davor sinnlos.
    wahr(`${name}: ${bauer} ist async festgelegt`,
      new RegExp(`async\\s+${bauer}\\(`).test(text))
  }

  // GEGENPROBE zu den Mustern. Ein Muster, das nichts findet, ist von einem
  // sauberen Bestand nicht zu unterscheiden.
  wahr("die Vorrangsuche findet den alten Vorrang, wenn er da ist",
    /cloudCards\.(front|back)\s*\|\|/.test(
      "const x = cloudCards.front || loot.render?.frontCardWebp"))
  gleich("die Rufzaehlung zaehlt in einem Probetext",
    ("a await karteFuerBlatt( b await karteFuerBlatt( c"
      .match(/await karteFuerBlatt\(/g) || []).length, 2)
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
  wahr(`${viele} Releases, gemerkt bleiben hoechstens ${KARTE_MAX}, es sind ${stand}`,
    stand > 0 && stand <= KARTE_MAX)
  kartenVergessen()
}

// ===========================================================================
console.log("\nQuelltextprobe: die Regel steht nicht nur im Kommentar")
const hier = dirname(fileURLToPath(import.meta.url))
const karten = readFileSync(join(hier, "stream-karten.mjs"), "utf8")
const posen = readFileSync(join(hier, "stream-posen.mjs"), "utf8")

/*
 * WARUM DIESE PROBEN. Die Faelle oben messen das Verhalten der heutigen
 * Fassung. Sie faengen aber nicht den Rueckfall, bei dem jemand den Namen
 * wieder BILDET und dabei zufaellig dasselbe Ergebnis erzeugt, weil die
 * gestellte Liste denselben Namen traegt. Diese zwei Zeilen faengen ihn.
 */
const ausDerListe = (karten.match(/assetUrl\(wer\.release, "", eintrag\.pfad\)/g) || []).length
gleich("die Adresse entsteht aus `eintrag.pfad`", ausDerListe, 1)
// Nur Kommentarzeilen duerfen einen Rollennamen an eine Kennung haengen.
const codeZeilen = karten.split("\n").filter((z) => {
  const k = z.trimStart()
  return k !== "" && k[0] !== "*" && !k.startsWith("//") && !k.startsWith("/*")
})
const gebildet = codeZeilen.filter((z) => /-\$\{?(rolle|ziel)/.test(z)).length
gleich("kein Dateiname wird im Code zusammengesetzt", gebildet, 0)

/*
 * DER GETEILTE MERKER DARF NICHT WIEDER ZUR KOPIE WERDEN. Beide Dateien
 * fuehren Fristen und Deckel; abgeschrieben waere die Verdraengung zweimal
 * geschrieben und beim naechsten Fehler nur an einer Stelle behoben.
 */
wahr("stream-karten holt den Merker", karten.includes('from "./stream-merker.mjs"'))
wahr("stream-posen holt denselben Merker", posen.includes('from "./stream-merker.mjs"'))
const eigenerMerker = (karten + posen).match(/^function (merken|einmal|frisch)\(/gm) || []
gleich("keine der beiden Dateien hat einen eigenen Merker", eigenerMerker.length, 0)

// ===========================================================================
console.log("\nDie Streamweiche des Item-Installers, OP-PRJ-141 Teil 4")

/*
 * WARUM DIESER ABSCHNITT, UND WARUM AM QUELLTEXT.
 *
 * `beneos_cloud.js` braucht Foundry: es ruft `FilePicker`, `CONFIG.Item` und
 * `game.settings`. Hier laeuft kein Foundry, also wird gelesen und nicht
 * gefahren. Was dadurch offen bleibt, steht unten in der Liste.
 *
 * DER WICHTIGSTE SATZ IST DER ERSTE, und er ist ein Sicherheitssatz.
 * `flags.beneos-module.loot.render` steht in einem Kundendokument, das
 * exportiert, kopiert und weitergegeben wird. Wer dort `assetUrl()` schreibt
 * statt `_beneosBeutePlatzhalter()`, legt den Streamschluessel in ein Feld,
 * das jeder Mitspieler liest, und ein Dritter koennte damit am Tor abrufen.
 * Gemessen am 09.11.2026: ein Konto mit `role: 1` liest die Welteinstellungen
 * vollstaendig, siehe `TC-PRJ-STR-310`. Der Fehler sieht dabei aus wie ein
 * funktionierender Streamweg.
 */
const cloudRoh = readFileSync(join(hier, "..", "beneos_cloud.js"), "utf8")
const cloudZeilen = cloudRoh.split("\n").filter((z) => {
  const k = z.trimStart()
  return k !== "" && k[0] !== "*" && !k.startsWith("//") && !k.startsWith("/*")
})
const cloudCode = cloudZeilen.join("\n")

// 1. Der Sicherheitssatz: die geschriebene Adresse ist die schluesselfreie.
const kartenfelder = cloudCode.match(
  /lootRender\.(front|back)CardWebp\s*=\s*([A-Za-z_$][\w$]*)\(/g) || []
gleich("beide Kartenfelder werden gesetzt", kartenfelder.length, 2)
for (const treffer of kartenfelder) {
  wahr(`${treffer.slice(11, 26).trim()} nimmt den Platzhalter`,
    treffer.includes("_beneosBeutePlatzhalter("))
}
// Die Gegenrichtung, und sie ist die eigentliche Wache: NIRGENDS darf
// `assetUrl` in ein Kartenfeld geschrieben werden.
const mitSchluessel = cloudCode.match(
  /lootRender\.\w+\s*=\s*(assetUrl|_beneosBeuteAdresse)\(/g) || []
gleich("kein Kartenfeld bekommt eine Adresse MIT Schluessel", mitSchluessel.length, 0)

/*
 * 2. ES GIBT KEINE FUNKTION FUER DIE FORM MIT SCHLUESSEL, und das ist
 * Absicht. Bei den Kreaturen gibt es beide, weil `prototypeToken.texture.src`
 * ein Leinwandfeld ist und die Adresse mit Schluessel braucht. Fuer die Beute
 * ist kein Feld dieser Art bekannt; waere eines noetig, muesste die Funktion
 * mit einer Begruendung entstehen und nicht beilaeufig.
 */
gleich("keine Beute-Adressfunktion mit Schluessel",
  (cloudCode.match(/function _beneosBeuteAdresse\b/g) || []).length, 0)

/*
 * 3. JE SEITE EINE EIGENE FRAGE. `OP-PRJ-139` hat sechs Eintraege gezaehlt,
 * deren Rueckseite es nicht oder nicht als WebP gibt, waehrend die
 * Vorderseite liegt. Eine gemeinsame Frage haette fuer diese sechs beide
 * Seiten gleich behandelt, und eine der beiden Antworten waere falsch.
 */
gleich("zwei getrennte Fragen am Tor",
  (cloudCode.match(/_beneosBeuteKarteAmTor\(/g) || []).length, 3)
wahr("die Vorderseite hat ihre eigene Bedingung",
  /_beneosBeuteDateiOk\(frontRoh\)[\s\S]{0,80}_beneosBeuteKarteAmTor\(itemKey, frontRoh, "front"\)/
    .test(cloudCode))
wahr("die Rueckseite hat ihre eigene Bedingung",
  /_beneosBeuteDateiOk\(backRoh\)[\s\S]{0,80}_beneosBeuteKarteAmTor\(itemKey, backRoh, "back"\)/
    .test(cloudCode))

/*
 * 4. DER STRENGE WEG AM TOR. `karteGibtEs()` zaehlt `null` NICHT als ja;
 * `karte()` liefert `null` als dritten Ausgang und liesse sich mit `?.src`
 * versehentlich als Treffer lesen. Antwortet das Tor nicht, muss oertlich
 * installiert werden, und das ist heute der Normalzustand, weil die Route
 * `/l/` noch nicht ausgeliefert ist.
 */
wahr("der Installer fragt ueber karteGibtEs",
  cloudCode.includes("karteGibtEs(") && cloudRoh.includes('from "./stream/stream-karten.mjs"'))
gleich("er benutzt nicht karte() unmittelbar",
  (cloudCode.match(/[^\w$.]karte\(/g) || []).length, 0)

/*
 * 5. DER UPLOAD FAELLT WEG, SONST SPART DAS STREAMEN KEIN BYTE. Das ist der
 * ganze Zweck: 0,213 MB vorn und 0,043 MB hinten je Gegenstand, ueber den
 * Bestand 0,47 GB.
 */
wahr("die Vorderseite wird nur ohne Streamen hochgeladen",
  /if \(!frontStreamt\) \{/.test(cloudCode))
wahr("die Rueckseite wird nur ohne Streamen hochgeladen",
  /if \(!backStreamt\) \{/.test(cloudCode))

/*
 * 6. DAS SYMBOL BLEIBT OERTLICH. Es steht in `Item.img`, einem Feld, das
 * jeder Mitspieler liest, es wird im Inventar auch ohne Netz gebraucht, und
 * alle Symbole des Bestandes sind zusammen rund 10 MB. Betreiberentscheid
 * offen, die Empfehlung lautet nein.
 */
gleich("iconWebp bekommt keine Adresse",
  (cloudCode.match(/lootRender\.iconWebp\s*=/g) || []).length, 0)
wahr("itemObjectData.img bleibt der oertliche Pfad",
  /itemObjectData\.img = `\$\{finalFolder\}/.test(cloudCode))

/*
 * 7. DIE GEMERKTE LISTE WIRD VERGESSEN. Nach einer Installation liegt die
 * Welt anders als vor fuenf Minuten. Dieselbe Begruendung wie bei
 * `posenVergessen()` fuer die Kreaturen.
 */
wahr("kartenVergessen wird gerufen", cloudCode.includes("kartenVergessen("))

/*
 * 8. DIE FELDFRAGE STEHT VOR DER STREAMENTSCHEIDUNG, und das ist der Teil,
 * den das Pruefstor erzwungen hat.
 *
 * Ohne `loot.render` liest die Flaeche allein den oertlichen Pfad aus
 * `beneosCloudCardPaths()`. Es gibt dann kein Feld, in das eine Adresse
 * passt, also darf nicht gestreamt werden.
 *
 * Der erste Entwurf am 09.11.2026 hat erst gestreamt und die Dateien danach
 * nachgeholt. `bildform-adresse-bench` C4 hat ihn abgewiesen, weil die Zahl
 * der `_beneosBildDatei(`-Schreibstellen von 13 auf 15 stieg. Der Befund war
 * nicht die Zahl, sondern die Bauart dahinter: ein zweiter Weg, doppelte
 * Aufrufe und ein Zustand mehr. Die Frage gehoert nach vorn, dann gibt es
 * keinen Nachholfall.
 */
wahr("die Feldfrage wird gestellt",
  /const hatKartenfelder = !!kartenfelder && typeof kartenfelder === "object"/.test(cloudCode))
gleich("beide Seiten haengen an der Feldfrage",
  (cloudCode.match(/Streamt = beuteStreamt && hatKartenfelder/g) || []).length, 2)
gleich("es gibt keinen Nachholzweig mehr",
  (cloudCode.match(/downloading the cards after all/g) || []).length, 0)

/*
 * 9. DIE WEICHE WIRD EINMAL JE GEGENSTAND GELESEN. Ein Schalter, der mitten
 * in einer Installation umgestellt wird, wuerde sonst einen halb gestreamten
 * Gegenstand hinterlassen. Dieselbe Bauart wie bei den Kreaturen.
 *
 * Gezaehlt werden die VORKOMMEN der Funktion und nicht die Zuweisung: eine
 * Sabotage am 09.11.2026 schrieb `_beneosBeuteStreamt() && _beneosBeuteStreamt()`
 * und kam durch, weil die Zuweisungszeile als Praefix unveraendert blieb. Zwei
 * ist die richtige Zahl, denn eines der beiden ist die Definition selbst.
 */
wahr("die Zuweisung steht einmal",
  (cloudCode.match(/const beuteStreamt = _beneosBeuteStreamt\(\)/g) || []).length === 1)
gleich("der Schalter kommt genau zweimal vor, Definition und eine Rufstelle",
  (cloudCode.match(/_beneosBeuteStreamt\(/g) || []).length, 2)

/*
 * 10. DER DATEINAMENRIEGEL IST DERSELBE WIE BEI DEN KREATUREN. Ein Name mit
 * `..` darin wird in `adressSegmente()` je Segment kodiert, also bleibt der
 * Schraegstrich stehen und die Adresse verlaesst ihren Raum.
 */
// Seit stre-T-064 steht der Kreaturenriegel in kreatur-ziele.mjs, und
// `_beneosKreaturDateiOk` reicht dorthin weiter. Gezaehlt wird darum je Datei.
const RIEGEL = /\/\^\[A-Za-z0-9\._-\]\+\\\.webp\$\//g
const kreaturZiele = readFileSync(join(hier, "kreatur-ziele.mjs"), "utf8")
wahr("Beute und Kreatur tragen denselben Riegel",
  /function _beneosBeuteDateiOk\(filename\) \{\s*return \/\^\[A-Za-z0-9\._-\]\+\\\.webp\$\//.test(cloudCode)
  && (kreaturZiele.match(RIEGEL) || []).length === 1
  && /function _beneosKreaturDateiOk\(filename\) \{\s*return kreaturDateiOk\(filename\)/.test(cloudCode))

// ---------------------------------------------------------------------------
console.log(`\n${gruen} bestanden, ${rot} gescheitert`)
console.log("\nNicht geprueft, ausdruecklich benannt:")
console.log("- Das lebende Tor. Hier laeuft kein Netz, `fetch` ist gestellt. Dass")
console.log("  `/l/` Bytes liefert, entscheidet TC-PRJ-STR-281.")
console.log("- Ob im Spiegel unter `beute/` wirklich etwas liegt. Der Fuelltakt stand")
console.log("  am 08.11.2026 in keinem Cron und ist nie gelaufen.")
console.log("- Die zwei Rufstellen im laufenden Foundry. Dass sie karteFuerBlatt()")
console.log("  rufen, ist oben am Quelltext gemessen; dass das Blatt danach eine")
console.log("  Karte ZEIGT, braucht ein Foundry und ist TC-PRJ-STR-296.")
console.log("- Die Masse im Ersatzbild. Dass sie ankommen, steht hier; dass das")
console.log("  Ersatzbild sie benutzt, ist OP-PRJ-128.")

process.exit(rot > 0 ? 1 : 0)
