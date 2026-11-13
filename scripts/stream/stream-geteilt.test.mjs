/**
 * stream-geteilt.test.mjs
 *
 * Gegenprobe zum geteilten Raum: eine Datei liegt einmal, unter ihrem Inhalt.
 * Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-geteilt.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ, `OP-PRJ-184` Punkt 3.
 *
 * Der Vorrat speichert nach `release|variante|pfad`. Damit haelt er dieselben
 * Bytes so oft, wie Releases sie fuehren: gemessen am 06.11.2026 ueber alle
 * 151 Manifeste sind 4.854,0 von 98.052,8 MB mehrfach gehalten, 72 Prozent
 * davon Ton, und `36-02_wizard_of_wines_2f.ogg` liegt mit 9,19 MB in NEUNZEHN
 * Releases. Das Tor zahlt das nicht, `belegteBytes()` zaehlt je Pruefsumme;
 * der Kunde zahlt es, und das Vorratsfenster zeigt ihm die Torzahl.
 *
 * DREI STELLEN TRAGEN DIE LOESUNG, UND JEDE KANN STILL FALSCH SEIN:
 *
 *   `assetUrl`          bildet die Adresse. Zu grosszuegig heisst eine Adresse,
 *                       die das Tor mit 400 abweist, und eine Abweisung kommt
 *                       als HTTP 200 mit 42 Byte: ein leeres Bild OHNE Meldung.
 *   `zerlegeAdresse`    liest sie zurueck. Zu grosszuegig heisst, eine fremde
 *                       Adresse wird angefasst; zu streng heisst, ein eigener
 *                       Vorratseintrag wird unlesbar.
 *   `vorratsSchluessel` entscheidet, WAS gespeichert wird. Ein Fehler hier
 *                       laesst jeden bestehenden Vorrat als fehlend erscheinen,
 *                       und der Kunde bekommt die Frage, ob er alles neu laden
 *                       will.
 *
 * DER SCHALTER IST DER WICHTIGSTE FALL DIESER DATEI. `GETEILTER_VORRAT_AN`
 * steht auf `false`, denn der geteilte Raum im Spiegel ist am 08.11.2026 LEER:
 * der serverseitige Durchgang ist gebaut (`eafb867`), handgefuehrt und nie
 * gefahren. Mit einem Schluessel, der auf einen leeren Raum zeigt, kommt eine
 * nachzuladende Datei nicht. Dieser Satz prueft deshalb BEIDE Lagen: dass bei
 * `false` alles bleibt wie vorher, und dass die Logik bei `true` stimmt.
 *
 * Der Lauf fasst nichts an: `game` wird gestellt und lebt nur fuer die Dauer
 * dieses Laufs.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import {
  assetUrl, zerlegeAdresse, istGeteilterRaum, istGeteilteDatei,
  GETEILT_RAUM, istBeute, istKreatur, SETTING, GATE_DEFAULT_BASE,
  platzhalterAdresse,
} from "./stream-settings.mjs"
import * as einstellungen from "./stream-settings.mjs"

// Ueber den Namensraum: fehlt die Funktion, wird der Satz ROT statt beim Laden abzubrechen.
const geteilteAdresse = (...a) =>
  typeof einstellungen.geteilteAdresse === "function" ? einstellungen.geteilteAdresse(...a) : "FEHLT"

/**
 * Code ohne Kommentare, und diese Zeilen sind die Lehre aus drei roten Proben.
 *
 * Dreimal in diesem Paket hat eine Probe eine Zeichenfolge in der GANZEN Datei
 * gesucht und wurde rot, weil der Kommentar daneben genau erklaerte, warum die
 * Sache dort NICHT passiert. **Eine Probe, die mehr zaehlt als ihre Frage,
 * wird bei richtiger Arbeit rot** und verliert damit ihren Wert.
 *
 * Der Trenner ist absichtlich einfach und kein Parser: er faellt auf ein `//`
 * in einer Zeichenkette herein. Das ist tragbar, weil er nur Proben speist und
 * nichts ausfuehrt, und weil die Gegenprobe unten ihn selbst prueft. Ein
 * echter Parser waere hier mehr Code als die Sache wert ist.
 */
function nurCode(js) {
  return String(js)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map(z => z.replace(/\/\/.*$/, "")).join("\n")
}

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

function wahr(name, bedingung) { gleich(name, !!bedingung, true) }

// ---------------------------------------------------------------------------
// Das gestellte Foundry. Nur so viel, wie `streamBase` und `streamKey` lesen.

const EINSTELLUNGEN = new Map([
  // `SETTING.base` und `SETTING.key`, nicht `gateBase` und `streamKey`: ein
  // erster Entwurf hat die Namen geraten, und `game.settings.get` gab
  // daraufhin die leere Zeichenkette zurueck. Die Adresse war dann
  // `/s//shared/...`, also ein leeres Schluesselsegment, und das faellt nur
  // auf, weil der Fall den Schluessel MITPRUEFT.
  [SETTING.base, GATE_DEFAULT_BASE],
  [SETTING.key, "pk_pruefsatz"],
])

globalThis.game = {
  settings: {
    get(_modul, name) { return EINSTELLUNGEN.get(name) ?? "" },
  },
  i18n: { localize: s => s, format: s => s },
}

const SHA = "a".repeat(64)
const SHA2 = "b1c2d3e4".repeat(8)

// ---------------------------------------------------------------------------
console.log("\nDer Raumname, und kein Release kann ihn tragen")

gleich("der Raum heisst shared", GETEILT_RAUM, "shared")
/*
 * EIN ZUSAMMENSTOSS IST AUSGESCHLOSSEN, und das ist gemessen und nicht
 * gehofft: jedes echte Release traegt ein Praefix. Ohne diesen Fall waere der
 * Raumname eine Annahme, und eine Annahme ueber Namen haelt genau bis zum
 * ersten Release, das anders heisst.
 */
wahr("kein Kreaturenrelease heisst shared", !istKreatur(GETEILT_RAUM))
wahr("kein Beuterelease heisst shared", !istBeute(GETEILT_RAUM))

// ---------------------------------------------------------------------------
console.log("\nistGeteilterRaum: beides wird geprueft, Name UND Form")

wahr("Raumname plus Pruefsumme", istGeteilterRaum(GETEILT_RAUM, SHA))
/*
 * DIE FORM IST DER EINZIGE RIEGEL, DEN DIESER RAUM HAT. Einen Releasenamen,
 * an dem ein Riegel greifen koennte, gibt es nicht. Eine Variante, die keine
 * Pruefsumme ist, ergaebe eine Adresse, die das Tor mit 400 abweist.
 */
wahr("Raumname ohne Pruefsumme faellt", !istGeteilterRaum(GETEILT_RAUM, "normal"))
wahr("Raumname mit 63 Zeichen faellt", !istGeteilterRaum(GETEILT_RAUM, "a".repeat(63)))
wahr("Raumname mit 65 Zeichen faellt", !istGeteilterRaum(GETEILT_RAUM, "a".repeat(65)))
wahr("Grossbuchstaben fallen", !istGeteilterRaum(GETEILT_RAUM, "A".repeat(64)))
wahr("Pruefsumme ohne Raumnamen faellt", !istGeteilterRaum("beneos_bm_0001", SHA))
wahr("leer faellt", !istGeteilterRaum("", ""))
wahr("undefined faellt", !istGeteilterRaum(undefined, undefined))

// ---------------------------------------------------------------------------
console.log("\nistGeteilteDatei: die Regel steht an EINER Stelle")

wahr("map_assets wird erkannt", istGeteilteDatei("https://x/a/k/r/v/map_assets/ui.webp"))
wahr("eine Kartendatei nicht", !istGeteilteDatei("https://x/a/k/r/v/scenes/karte.webm"))
wahr("leer nicht", !istGeteilteDatei(""))
wahr("undefined nicht", !istGeteilteDatei(undefined))
/*
 * SIE IST AM 08.11.2026 AUS `stream-offline.mjs` HIERHER UMGEZOGEN, wegen
 * eines Importzyklus: `vorratsSchluessel` in `stream-fetch.mjs` braucht sie,
 * und `stream-offline.mjs` importiert aus `stream-fetch.mjs`. Der Fall unten
 * haelt fest, dass sie nicht zweimal existiert; zwei Kopien gaeben frueher
 * oder spaeter zwei Antworten auf dieselbe Datei.
 */
const HIER = dirname(fileURLToPath(import.meta.url))
const lies = n => readFileSync(join(HIER, n), "utf8")
const settings = lies("stream-settings.mjs")
const offline = lies("stream-offline.mjs")
const fetchQ = lies("stream-fetch.mjs")

gleich("die Regel ist genau einmal definiert",
  (settings + offline + fetchQ).match(/function istGeteilteDatei\(/g).length, 1)
wahr("und sie steht in stream-settings.mjs",
  settings.includes("export function istGeteilteDatei("))
wahr("stream-offline.mjs importiert sie",
  /import \{[^}]*istGeteilteDatei[^}]*\} from "\.\/stream-settings\.mjs"/.test(offline))
/*
 * NUR DER CODE, NICHT DER KOMMENTAR. Ein erster Entwurf zaehlte sieben
 * Vorkommen und wurde rot: sechs davon stehen in Kommentaren, die genau
 * erklaeren, warum die Regel an EINER Stelle liegt.
 */
gleich("das Muster map_assets steht im Code nur an der einen Stelle",
  (nurCode(settings) + nurCode(offline) + nurCode(fetchQ)).match(/map_assets/g).length, 1)
// Gegenprobe auf den Trenner selbst: eine Suche, die nichts findet, ist von
// einer kaputten Suche nicht zu unterscheiden.
wahr("der Trenner laesst Code stehen",
  nurCode(settings).includes("export function istGeteilteDatei("))
wahr("und wirft Kommentare weg",
  settings.includes("UMGEZOGEN AM 2026-11-08")
    && !nurCode(settings).includes("UMGEZOGEN AM 2026-11-08"))

// ---------------------------------------------------------------------------
console.log("\nassetUrl: sieben Segmente, mit Traegerrelease, und die Variante traegt die Pruefsumme")

/*
 * DAS TOR KENNT SEIT stre-T-052 NUR NOCH DIE SIEBENTEILIGE FORM
 * `/s/<key>/<release>/<variante>/shared/<sha256>/<name>` und prueft das Recht
 * am Release im Pfad. Der Vorratsschluessel bleibt release-frei; das Release
 * in der Adresse ist der TRAEGER, ueber den das Tor das Recht prueft (T-056).
 */
const TRAEGER = { release: "beneos_bm_0113", variant: "4k" }
const TRAEGER_B = { release: "beneos_bm_0042", variant: "hd" }
const adr = assetUrl(GETEILT_RAUM, SHA, "foundry_bm_ui.webp", TRAEGER)
gleich("die Adresse hat die Form der Route",
  adr, `${GATE_DEFAULT_BASE}/s/pk_pruefsatz/beneos_bm_0113/4k/shared/${SHA}/foundry_bm_ui.webp`)
gleich("genau sieben Segmente nach dem Host",
  new URL(adr).pathname.replace(/^\/+/, "").split("/").length, 7)
wahr("der Schluessel steht drin", adr.includes("pk_pruefsatz"))

/*
 * OHNE TRAEGER KEINE ADRESSE. Die alte Form ohne Release beantwortet das Tor
 * mit 404 no-route; eine Adresse zu bauen, die es nicht gibt, waere schlechter
 * als keine.
 */
gleich("ohne Traeger: leere Zeichenkette", assetUrl(GETEILT_RAUM, SHA, "foundry_bm_ui.webp"), "")
gleich("Traeger ohne Variante: leer",
  assetUrl(GETEILT_RAUM, SHA, "a.webp", { release: "beneos_bm_0113", variant: "" }), "")
gleich("Kreatur als Traeger: leer",
  assetUrl(GETEILT_RAUM, SHA, "a.webp", { release: "beneos_ct_0001", variant: "4k" }), "")
gleich("Beute als Traeger: leer",
  assetUrl(GETEILT_RAUM, SHA, "a.webp", { release: "beneos_lt_0001", variant: "4k" }), "")
gleich("der Raumname als Traeger: leer",
  assetUrl(GETEILT_RAUM, SHA, "a.webp", { release: GETEILT_RAUM, variant: "4k" }), "")
gleich("ein Traeger mit Schraegstrich: leer",
  assetUrl(GETEILT_RAUM, SHA, "a.webp", { release: "beneos_bm_1/x", variant: "4k" }), "")
gleich("ohne Traeger auch keine Platzhalterform",
  platzhalterAdresse(GETEILT_RAUM, SHA, "a.webp"), "")

/*
 * DIE ZWEI-WERTE-PROBE. Ein anderer Traeger MUSS eine andere Adresse ergeben,
 * derselbe Traeger dieselbe, und beide denselben Vorratsschluessel: das Release
 * steht in der Adresse, nicht in der Ablage.
 */
const adrB = assetUrl(GETEILT_RAUM, SHA, "foundry_bm_ui.webp", TRAEGER_B)
wahr("anderer Traeger, andere Adresse", adrB !== adr)
gleich("derselbe Traeger, dieselbe Adresse",
  assetUrl(GETEILT_RAUM, SHA, "foundry_bm_ui.webp", { ...TRAEGER }), adr)
gleich("beide Traeger zerlegen sich zu derselben Kennung",
  [adr, adrB].map((a) => { const t = zerlegeAdresse(a); return `${t?.release}|${t?.variant}|${t?.pfad}` }).join(" "),
  `${GETEILT_RAUM}|${SHA}|foundry_bm_ui.webp ${GETEILT_RAUM}|${SHA}|foundry_bm_ui.webp`)

/*
 * DER TRAEGER AUS DEM SITZUNGSVERZEICHNIS (Betreiberentscheid 13.11.2026).
 * `geteilteAdresse` bekommt die Kartenadressen, unter denen diese Pruefsumme
 * bekannt ist, und nimmt die erste, die eine Karte ist.
 */
const KARTE_A = `${GATE_DEFAULT_BASE}/a/pk_pruefsatz/beneos_bm_0113/4k/map_assets/foundry_bm_ui.webp`
const KARTE_B = `${GATE_DEFAULT_BASE}/a/pk_pruefsatz/beneos_bm_0042/hd/map_assets/foundry_bm_ui.webp`
const KREATUR = `${GATE_DEFAULT_BASE}/c/pk_pruefsatz/beneos_ct_0001/a.webp`
gleich("geteilteAdresse: erste Kartenadresse ist der Traeger",
  geteilteAdresse(SHA, "foundry_bm_ui.webp", [KREATUR, KARTE_A, KARTE_B]), adr)
gleich("geteilteAdresse: andere erste Karte, anderer Traeger",
  geteilteAdresse(SHA, "foundry_bm_ui.webp", [KARTE_B, KARTE_A]), adrB)
gleich("geteilteAdresse: ohne Kartenadresse leer",
  geteilteAdresse(SHA, "foundry_bm_ui.webp", [KREATUR]), "")
gleich("geteilteAdresse: ohne Verzeichnis leer",
  geteilteAdresse(SHA, "foundry_bm_ui.webp", undefined), "")
{
  const a = nurCode(fetchQ)
  const s = a.indexOf("function adresseAusSchluessel(")
  const rumpf = s < 0 ? "" : a.slice(s, a.indexOf("\n}", s))
  wahr("adresseAusSchluessel fragt das Sitzungsverzeichnis",
    rumpf.includes("geteilteAdresse(") && rumpf.includes("adressenZuSha.get("))
}

/*
 * EINE VARIANTE, DIE KEINE PRUEFSUMME IST, FAELLT AUF DIE KARTENADRESSE
 * ZURUECK. Das ist die Richtung, in die ein Irrtum fallen soll: eine
 * Kartenadresse ist schlimmstenfalls zweimal gehalten, eine abgewiesene
 * Adresse ist ein leeres Bild beim Kunden.
 */
const zurueck = assetUrl(GETEILT_RAUM, "normal", "ui.webp", TRAEGER)
wahr("ohne Pruefsumme kommt die Kartenadresse", zurueck.includes("/a/"))
wahr("und nicht die geteilte", !zurueck.includes("/s/"))

// Die anderen Raeume bleiben unberuehrt. Ohne diese drei Faelle belegt der
// Satz nur, dass der neue Zweig trifft, und nicht, dass er nichts anderes
// kaputt macht.
wahr("eine Karte bleibt eine Karte",
  assetUrl("beneos_bm_0001", "4k", "scenes/a.webm").includes("/a/"))
wahr("eine Kreatur bleibt eine Kreatur",
  assetUrl("beneos_ct_0001", "", "a.webp").includes("/c/"))
wahr("ein Gegenstand bleibt ein Gegenstand",
  assetUrl("beneos_lt_0001", "", "a-front.webp").includes("/l/"))

// ---------------------------------------------------------------------------
console.log("\nzerlegeAdresse: genau sieben, Raumname und Traeger werden mitgeprueft")

const t = zerlegeAdresse(adr)
gleich("der Raum heisst geteilt", t?.raum, "geteilt")
gleich("release ist der Raumname", t?.release, GETEILT_RAUM)
gleich("variant ist die Pruefsumme", t?.variant, SHA)
gleich("pfad ist der Dateiname", t?.pfad, "foundry_bm_ui.webp")
gleich("der Traeger wird mitgegeben", JSON.stringify(t?.traeger), JSON.stringify(TRAEGER))

/*
 * `=== 7` UND NICHT `>= 7`, und das ist der einzige Raum, in dem das so ist.
 * Die Route am Tor laesst genau sieben Segmente zu.
 *
 * DIE ALTE FUENFTEILIGE FORM GILT ALS FREMD, wie am Tor (Betreiberentscheid
 * 13.11.2026). Kein Vorrat traegt sie: Vorratsschluessel stehen in der Form
 * `beneos-stream.invalid/a/...`.
 */
gleich("die alte Form ohne Release wird abgewiesen",
  zerlegeAdresse(`${GATE_DEFAULT_BASE}/s/k/shared/${SHA}/a.webp`), null)
gleich("acht Segmente werden abgewiesen",
  zerlegeAdresse(`${GATE_DEFAULT_BASE}/s/k/beneos_bm_1/4k/shared/${SHA}/unter/a.webp`), null)
gleich("sechs Segmente werden abgewiesen",
  zerlegeAdresse(`${GATE_DEFAULT_BASE}/s/k/beneos_bm_1/4k/shared/${SHA}`), null)
gleich("ein falscher Raumname wird abgewiesen",
  zerlegeAdresse(`${GATE_DEFAULT_BASE}/s/k/beneos_bm_1/4k/geteilt/${SHA}/a.webp`), null)
gleich("eine Variante ohne Pruefsummenform wird abgewiesen",
  zerlegeAdresse(`${GATE_DEFAULT_BASE}/s/k/beneos_bm_1/4k/shared/normal/a.webp`), null)
gleich("Grossbuchstaben in der Pruefsumme werden abgewiesen",
  zerlegeAdresse(`${GATE_DEFAULT_BASE}/s/k/beneos_bm_1/4k/shared/${"A".repeat(64)}/a.webp`), null)
gleich("eine Kreatur als Traeger wird abgewiesen",
  zerlegeAdresse(`${GATE_DEFAULT_BASE}/s/k/beneos_ct_1/4k/shared/${SHA}/a.webp`), null)
gleich("ein leerer Traeger wird abgewiesen",
  zerlegeAdresse(`${GATE_DEFAULT_BASE}/s/k//4k/shared/${SHA}/a.webp`), null)

// Das Paar muss in beide Richtungen schliessen, sonst ist einer der beiden
// Zweige fuer sich richtig und zusammen falsch.
const rund = zerlegeAdresse(assetUrl(GETEILT_RAUM, SHA2, "36-02_wizard_of_wines_2f.ogg", TRAEGER_B))
gleich("hin und zurueck ergibt dasselbe",
  `${rund?.release}|${rund?.variant}|${rund?.pfad}|${rund?.traeger?.release}|${rund?.traeger?.variant}`,
  `${GETEILT_RAUM}|${SHA2}|36-02_wizard_of_wines_2f.ogg|beneos_bm_0042|hd`)
gleich("und wieder zur selben Adresse",
  assetUrl(rund?.release, rund?.variant, rund?.pfad, rund?.traeger),
  assetUrl(GETEILT_RAUM, SHA2, "36-02_wizard_of_wines_2f.ogg", TRAEGER_B))

/*
 * LEGACY-SCHUTZ (Betreiberauflage 13.11.2026): die Wege, die heute Dateien
 * liefern, aendern sich nicht. Die Sollwerte sind die Adressen des Stands
 * ff830f8, ausgeschrieben und nicht neu berechnet.
 */
gleich("Kartenadresse byte-gleich",
  assetUrl("beneos_bm_0113", "4k", "map_assets/foundry_bm_ui.webp"),
  `${GATE_DEFAULT_BASE}/a/pk_pruefsatz/beneos_bm_0113/4k/map_assets/foundry_bm_ui.webp`)
gleich("Kreaturadresse byte-gleich",
  assetUrl("beneos_ct_0001", "", "a.webp"), `${GATE_DEFAULT_BASE}/c/pk_pruefsatz/beneos_ct_0001/a.webp`)
gleich("Beuteadresse byte-gleich",
  assetUrl("beneos_lt_0001", "", "a-front.webp"), `${GATE_DEFAULT_BASE}/l/pk_pruefsatz/beneos_lt_0001/a-front.webp`)
gleich("Kartenplatzhalter byte-gleich",
  platzhalterAdresse("beneos_bm_0113", "4k", "scenes/a.webm"), "beneos://a/beneos_bm_0113/4k/scenes/a.webm")

// Die anderen Raeume bleiben lesbar.
gleich("eine Kartenadresse bleibt eine Karte",
  zerlegeAdresse(assetUrl("beneos_bm_0001", "4k", "scenes/a.webm"))?.raum, "karte")
gleich("eine Kreaturenadresse bleibt eine Kreatur",
  zerlegeAdresse(assetUrl("beneos_ct_0001", "", "a.webp"))?.raum, "kreatur")
gleich("eine Beuteadresse bleibt Beute",
  zerlegeAdresse(assetUrl("beneos_lt_0001", "", "a-front.webp"))?.raum, "beute")
// Eine fremde Adresse bleibt unangetastet. Derselbe Fremdschutz wie bei den
// anderen Raeumen, und er haengt an der Exaktheit der Form.
gleich("eine fremde Adresse bekommt null",
  zerlegeAdresse("https://example.com/s/k/shared/x/y"), null)
gleich("eine fremde Adresse in der neuen Form ohne Pruefsumme bekommt null",
  zerlegeAdresse("https://example.com/s/k/r/v/shared/x/y"), null)

// ---------------------------------------------------------------------------
console.log("\nDer Schalter: bei AUS bleibt alles, wie es war")

/*
 * DAS IST DER WICHTIGSTE ABSCHNITT DIESER DATEI. Der geteilte Raum im Spiegel
 * ist am 08.11.2026 LEER, denn der serverseitige Durchgang ist handgefuehrt
 * und nie gefahren. Ein Schluessel, der auf einen leeren Raum zeigt, laesst
 * eine nachzuladende Datei nicht kommen. Solange der Schalter aus ist, DARF
 * sich am Vorratsschluessel nichts aendern.
 */
wahr("der Schalter steht im Quelltext auf false",
  /const GETEILTER_VORRAT_AN = false/.test(fetchQ))
wahr("er ist eine Konstante und keine Kundeneinstellung",
  !/SETTING\.\w*[gG]eteilt/.test(fetchQ) && !/geteilterVorrat/.test(JSON.stringify(SETTING)))

const { vorratsSchluessel } = await import("./stream-fetch.mjs")
const kartenAdresse = assetUrl("beneos_bm_0001", "4k", "map_assets/foundry_bm_ui.webp")
gleich("eine geteilte Datei behaelt bei AUS den Kartenschluessel",
  vorratsSchluessel(kartenAdresse),
  "https://beneos-stream.invalid/a/beneos_bm_0001/4k/map_assets/foundry_bm_ui.webp")
/*
 * IDEMPOTENZ, und sie ist keine Zierde: `vPut` und `vMatch` rufen diese
 * Funktion auf Adressen, die manchmal schon Schluessel sind. Eine zweite
 * Umrechnung ergaebe einen Schluessel, unter dem nie etwas lag.
 */
gleich("ein Schluessel bleibt ein Schluessel",
  vorratsSchluessel(vorratsSchluessel(kartenAdresse)),
  vorratsSchluessel(kartenAdresse))
// Eine geteilte Adresse ergibt auch bei AUS einen lesbaren Schluessel, denn
// `zerlegeAdresse` kennt sie. Sonst waere ein Eintrag, den ein spaeterer
// Modulstand angelegt hat, nach einem Rueckbau unlesbar.
gleich("eine geteilte Adresse ergibt den geteilten Schluessel",
  vorratsSchluessel(adr),
  `https://beneos-stream.invalid/a/shared/${SHA}/foundry_bm_ui.webp`)

// ---------------------------------------------------------------------------
console.log("\nQuelltextprobe: der Umrechner und seine Riegel")

const gStart = fetchQ.indexOf("function geteilterDreiklang(")
const gEnde = fetchQ.indexOf("\n}", gStart)
if (gStart < 0 || gEnde < 0) {
  rot += 1
  console.log("  ROT  geteilterDreiklang ist im Quelltext nicht zu finden")
  console.log("       NICHT PRUEFBAR: der Schnitt passt nicht mehr zum Bestand")
} else {
  const g = fetchQ.slice(gStart, gEnde + 2)
  wahr("er fragt zuerst den Schalter", g.indexOf("GETEILTER_VORRAT_AN") < g.indexOf("istGeteilteDatei"))
  wahr("er rechnet einen geteilten Dreiklang nicht zweimal um",
    g.includes('t.raum === "geteilt"'))
  wahr("er fragt, ob die Datei geteilt ist", g.includes("istGeteilteDatei(url)"))
  wahr("er nimmt die Pruefsumme aus dem Verzeichnis", g.includes("shaZuAdresse.get("))
  // Ohne diese Zeile waere der Name `map_assets/ui.webp`, also zwei Segmente,
  // und die Adresse haette sechs statt fuenf.
  wahr("er nimmt nur den Basisnamen", g.includes('.split("/").pop()'))
  wahr("er prueft die Form des Namens", g.includes("/^[A-Za-z0-9._-]+$/"))
  wahr("er weist einen fuehrenden Punkt ab", g.includes('name[0] === "."'))
  wahr("er nimmt den Raumnamen aus der einen Quelle", g.includes("release: GETEILT_RAUM"))
  // Auch hier nur der Code: der Kopf der Funktion nennt die Pruefsumme
  // mehrfach, weil er erklaert, woher sie kommt.
  wahr("er erfindet keine Pruefsumme", !/digest|createHash|subtle/i.test(nurCode(g)))
}

/*
 * DASS `vorratsSchluessel` DEN UMRECHNER UEBERHAUPT RUFT, und dieser Fall
 * verdankt sich einer Sabotage, die zuerst durchkam.
 *
 * Der Satz oben fuehrt den Schalter auf AUS, und bei AUS gibt
 * `geteilterDreiklang` immer `null`. Wer den Aufruf dann ganz entfernt, aendert
 * am Verhalten dieses Laufs nichts: jeder Fall bleibt gruen, und das Paket
 * waere wirkungslos ausgeliefert. **Eine Luecke, die nur in der anderen Lage
 * sichtbar ist, braucht einen Riegel in dieser.**
 *
 * Die andere Lage ist im Satz selbst nicht fahrbar, weil eine Konstante sich
 * von aussen nicht setzen laesst, und das ist Absicht. Also prueft dieser Fall
 * den Quelltext, und das ist hier nicht die zweitbeste Antwort, sondern die
 * einzige, die im Dauerlauf steht.
 */
const vStart = fetchQ.indexOf("export function vorratsSchluessel(")
const vEnde = fetchQ.indexOf("\n}", vStart)
if (vStart < 0 || vEnde < 0) {
  rot += 1
  console.log("  ROT  vorratsSchluessel ist im Quelltext nicht zu finden")
  console.log("       NICHT PRUEFBAR: der Schnitt passt nicht mehr zum Bestand")
} else {
  const v = fetchQ.slice(vStart, vEnde + 2)
  wahr("vorratsSchluessel ruft den Umrechner", v.includes("geteilterDreiklang(s, t)"))
  wahr("und benutzt sein Ergebnis mit Rueckfall auf den Kartendreiklang",
    /const quelle = g \|\| t/.test(v))
  // Ohne diese Zeile ist die Funktion nicht mehr idempotent, und `vPut` ruft
  // sie auf Adressen, die manchmal schon Schluessel sind.
  wahr("sie bleibt idempotent", v.includes("if (s.startsWith(VORRAT_URSPRUNG)) return s"))
}

// Der Raumname kommt aus EINER Quelle. Zwei Kopien in zwei Dateien gehen
// erfahrungsgemaess nicht zugleich mit, und dieselbe Begruendung steht schon
// bei `zerlegeAdresse`.
gleich("der Raumname ist genau einmal gesetzt",
  (settings + fetchQ + offline).match(/GETEILT_RAUM = /g).length, 1)
wahr("stream-fetch.mjs importiert ihn",
  /import \{[^}]*GETEILT_RAUM[^}]*\} from "\.\/stream-settings\.mjs"/.test(fetchQ))

// ---------------------------------------------------------------------------
console.log("\nDie Abrufschicht: Vorratsschluessel release-frei, Rueckweg mit Traeger (T-056)")
/*
 * Am echten `stream-fetch.mjs`, dynamisch geladen: fehlt etwas, wird es ROT
 * statt beim Laden abzubrechen.
 *
 * DER VORRATSSCHLUESSEL HAENGT AN KEINEM RELEASE. Zwei geteilte Adressen mit
 * verschiedenem Traeger muessen in denselben Eintrag fallen, sonst laege
 * dieselbe Datei wieder je Release im Vorrat, und genau das soll OP-PRJ-184
 * Punkt 3 beenden.
 */
{
  let abruf = null
  try {
    abruf = await import("./stream-fetch.mjs")
  } catch (f) {
    rot++
    console.log(`  ROT  stream-fetch.mjs laedt nicht: ${String(f?.message).slice(0, 120)}`)
  }
  if (abruf) {
    const v = abruf.vorratsSchluessel
    const ka = v(adr)
    const kb = v(adrB)
    gleich("zwei Traeger, ein Vorratsschluessel", ka, kb)
    gleich("und er nennt kein Release",
      ka, `https://beneos-stream.invalid/a/${GETEILT_RAUM}/${SHA}/foundry_bm_ui.webp`)
    gleich("eine Kartenadresse behaelt ihren Schluessel (Legacy, byte-gleich)",
      v(KARTE_A), "https://beneos-stream.invalid/a/beneos_bm_0113/4k/map_assets/foundry_bm_ui.webp")

    const rueck = abruf.adresseAusSchluessel
    if (typeof rueck !== "function") {
      rot++
      console.log("  ROT  adresseAusSchluessel ist nicht exportiert")
    } else {
      // Ohne bekanntes Manifest gibt es keinen Traeger: der Schluessel bleibt.
      gleich("ohne Manifest bleibt der geteilte Schluessel, wie er ist", rueck(ka), ka)
      // Ein Manifest wird geladen: die Kartenadresse traegt diese Pruefsumme.
      abruf.merkePruefsummen([[KARTE_A, SHA]])
      gleich("mit Manifest wird daraus die siebenteilige Adresse des Traegers", rueck(ka), adr)
      gleich("eine Karte kommt zurueck wie vorher (Legacy, byte-gleich)",
        rueck(v(KARTE_A)), KARTE_A)
    }

    // Abweisungen werden je Recht gesammelt, und das Recht haengt am Traeger.
    const sammel = abruf.sammelSchluessel
    gleich("eine geteilte Adresse sammelt unter ihrem Traeger", sammel(adr), "beneos_bm_0113/4k")
    gleich("eine Karte sammelt wie vorher (Legacy, byte-gleich)", sammel(KARTE_A), "beneos_bm_0113/4k")
  }
}

// ---------------------------------------------------------------------------
console.log("\nPunktsegmente sind kein Traeger (Kalt-Review 13.11.2026)")
/*
 * `.` und `..` passen auf die Segmentregel, aber die URL-Normalisierung von
 * Browser und fetch loest sie auf: aus `/s/<k>/beneos_bm_0113/../shared/...`
 * wird die alte fuenfteilige Form, die das Tor mit 404 no-route beantwortet.
 */
for (const punkt of [".", ".."]) {
  gleich(`Variante "${punkt}": keine Adresse`,
    einstellungen.assetUrl(GETEILT_RAUM, SHA, "a.webp", { release: "beneos_bm_0113", variant: punkt }), "")
  gleich(`Variante "${punkt}": der Platzhalter wird nicht zerlegt`,
    einstellungen.zerlegeAdresse(`beneos://s/beneos_bm_0113/${punkt}/shared/${SHA}/a.webp`), null)
}

// ---------------------------------------------------------------------------
console.log(`\n${gruen} bestanden, ${rot} gescheitert`)
console.log("\nNicht geprueft, ausdruecklich benannt:")
console.log("- Die Lage mit dem Schalter AN laeuft NICHT in diesem Satz, denn eine")
console.log("  Konstante laesst sich von aussen nicht setzen, und das ist Absicht:")
console.log("  ein setzbarer Schalter waere eine Kundenwahl, und das hier ist eine")
console.log("  Auslieferungsreihenfolge. Sie ist am 08.11.2026 gegen eine Probekopie")
console.log("  GEMESSEN, sechs Faelle gruen, darunter der, der das Ziel des Pakets")
console.log("  ist: zwei Releases ergeben denselben Schluessel. Was hier im")
console.log("  Dauerlauf steht, ist der Quelltextriegel darauf, dass der Umrechner")
console.log("  ueberhaupt gerufen wird.")
console.log("- Dass der geteilte Raum im Spiegel wirklich Bytes liefert. Der")
console.log("  Durchgang `_trigger-geteilt-mirror-fill.php` ist gebaut, handgefuehrt")
console.log("  und am 08.11.2026 nie gefahren. Entscheidet TC-PRJ-STR-284.")
console.log("- Der einmalige Preis des Umschaltens: jede geteilte Datei, die ein")
console.log("  Kunde heute haelt, gilt danach als fehlend und wird einmal neu")
console.log("  geholt. Gemessen sind das 5,0 Prozent der Bytes, nicht der ganze")
console.log("  Vorrat, aber gemessen ist es am Katalog und nicht an einem Kunden.")

process.exit(rot > 0 ? 1 : 0)
