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

/*
 * STRUKTURPROBEN (stre-T-017). Eine Aussage wie "genau eine Definition" oder
 * "Datei X importiert Y" zeigt kein Aufruf; sie bleibt eine Textprobe, traegt
 * aber das Praefix `[Struktur] ` und wird getrennt gezaehlt. Alles andere in
 * diesem Satz ruft den echten Code.
 */
function struktur(name, bedingung) { gleich(`[Struktur] ${name}`, !!bedingung, true) }

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
wahr("der Raumname in Grossbuchstaben ist ein anderer Name", !istGeteilterRaum(GETEILT_RAUM.toUpperCase(), SHA))
wahr("Raumname mit 65 Zeichen faellt", !istGeteilterRaum(GETEILT_RAUM, "a".repeat(65)))
wahr("Grossbuchstaben fallen", !istGeteilterRaum(GETEILT_RAUM, "A".repeat(64)))
wahr("Pruefsumme ohne Raumnamen faellt", !istGeteilterRaum("beneos_bm_0001", SHA))
wahr("leer faellt", !istGeteilterRaum("", ""))
wahr("undefined faellt", !istGeteilterRaum(undefined, undefined))

// ---------------------------------------------------------------------------
console.log("\nistGeteilteDatei: die Regel steht an EINER Stelle")

wahr("map_assets wird erkannt", istGeteilteDatei("https://x/a/k/r/v/map_assets/ui.webp"))
wahr("eine Kartendatei nicht", !istGeteilteDatei("https://x/a/k/r/v/scenes/karte.webm"))
wahr("map_assets nur als ganzer Ordner, nicht im Dateinamen",
  !istGeteilteDatei("https://x/a/k/r/v/scenes/my_map_assets.webp"))
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

struktur("die Regel ist genau einmal definiert",
  ((settings + offline + fetchQ).match(/function istGeteilteDatei\(/g) || []).length === 1)
struktur("und sie steht in stream-settings.mjs",
  settings.includes("export function istGeteilteDatei("))
/*
 * DIE NAEHTE BLEIBEN IM PRUEFSATZ. Die Exporte `...FuerPruefsatz` fahren Code
 * mit einem Schalter, den kein Kunde hat (stre-T-017, E2). Ruft eine
 * Moduldatei sie, aendert sich beim Kunden der Vorratsschluessel, und kein
 * Verhaltenssatz wuerde rot. Deshalb: ausserhalb der Saetze steht ein solcher
 * Name nur auf seiner eigenen exportierenden Definitionszeile.
 */
{
  const { readdirSync } = await import("node:fs")
  const SKRIPTE = join(HIER, "..")
  const fremd = []
  for (const eintrag of readdirSync(SKRIPTE, { recursive: true })) {
    const datei = String(eintrag)
    if (!/\.(m?js)$/.test(datei) || datei.endsWith(".test.mjs")) continue
    const zeilen = readFileSync(join(SKRIPTE, datei), "utf8").split("\n")
    zeilen.forEach((z, i) => {
      if (/\w+FuerPruefsatz\b/.test(z) && !/^export (const|async function|function) \w+FuerPruefsatz\b/.test(z)) fremd.push(`${datei}:${i + 1}`)
    })
  }
  struktur("keine Moduldatei ruft eine Pruefsatznaht", fremd.length === 0)
}
struktur("stream-offline.mjs importiert sie",
  /import \{[^}]*istGeteilteDatei[^}]*\} from "\.\/stream-settings\.mjs"/.test(offline))
/*
 * NUR DER CODE, NICHT DER KOMMENTAR. Ein erster Entwurf zaehlte sieben
 * Vorkommen und wurde rot: sechs davon stehen in Kommentaren, die genau
 * erklaeren, warum die Regel an EINER Stelle liegt.
 */
struktur("das Muster map_assets steht im Code nur an der einen Stelle",
  ((nurCode(settings) + nurCode(offline) + nurCode(fetchQ)).match(/map_assets/g) || []).length === 1)
// Gegenprobe auf den Trenner selbst: eine Suche, die nichts findet, ist von
// einer kaputten Suche nicht zu unterscheiden.
struktur("der Trenner laesst Code stehen",
  nurCode(settings).includes("export function istGeteilteDatei("))
struktur("und wirft Kommentare weg",
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
// Eine Kartenadresse, deren Variante kein Traeger sein kann, wird
// uebersprungen und nicht als Ergebnis genommen.
gleich("geteilteAdresse: eine Karte mit unbrauchbarer Variante wird uebersprungen",
  geteilteAdresse(SHA, "foundry_bm_ui.webp",
    [`${GATE_DEFAULT_BASE}/a/pk_pruefsatz/beneos_bm_0113/a%20b/map_assets/foundry_bm_ui.webp`, KARTE_A]), adr)
gleich("geteilteAdresse: ohne Kartenadresse leer",
  geteilteAdresse(SHA, "foundry_bm_ui.webp", [KREATUR]), "")
gleich("geteilteAdresse: ohne Verzeichnis leer",
  geteilteAdresse(SHA, "foundry_bm_ui.webp", undefined), "")
// Dass `adresseAusSchluessel` das Sitzungsverzeichnis fragt, misst der
// Abschnitt "Die Abrufschicht" unten am Aufruf: ohne Manifest bleibt der
// Schluessel, mit Manifest kommt die Adresse des Traegers (stre-T-017; bis
// dahin eine Textprobe auf den Rumpf).

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
// Dass der Schalter AUS steht, misst der Abschnitt "Der Umrechner mit dem
// Schalter AN" unten: dieselbe Adresse mit bekannter Pruefsumme ergibt bei
// AUS den Kartenschluessel und ueber die Naht den geteilten.
wahr("keine Kundeneinstellung nennt den Vorrat",
  !/geteilterVorrat/.test(JSON.stringify(SETTING)))
// Ausgenommen ist der Gemeinschaftsvorrat selbst (`SETTING.offlineGeteilt`):
// seit stre-T-175 liest die Lesehuelle daraus die Pruefsumme einer gehaltenen
// Datei. Das sind Daten und kein Schalter; der Schalter bleibt die Konstante.
struktur("die Abrufschicht liest keine Einstellung zum Vorrat",
  !/SETTING\.(?!offlineGeteilt\b)\w*[gG]eteilt/.test(fetchQ))

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
console.log("\nDer Umrechner mit dem Schalter AN, gemessen ueber die Naht")

/*
 * BIS stre-T-017 STAND HIER EINE QUELLTEXTPROBE, und ihr Grund war richtig:
 * der Schalter ist eine Konstante, die Lage AN ist in diesem Satz nicht
 * fahrbar, und wer den Aufruf des Umrechners ganz entfernt, aenderte am
 * Verhalten bei AUS nichts. Eine Sabotage kam damals durch.
 *
 * Seit dem 14.11.2026 gibt es dafuer zwei Naehte in `stream-fetch.mjs`
 * (Betreiberentscheid): `geteilterDreiklangFuerPruefsatz` und
 * `vorratsSchluesselMitVorratFuerPruefsatz` fahren DENSELBEN Code mit dem
 * Schalter AN. Das Modul ruft sie nie. Damit misst dieser Abschnitt beide
 * Lagen an derselben Adresse mit derselben bekannten Pruefsumme: AUS ergibt
 * den Kartenschluessel, AN den geteilten. Faellt der Aufruf des Umrechners
 * weg, wird der zweite Wert rot; steht der Schalter AN, der erste.
 *
 * Eigene Adresse und eigene Pruefsumme (SHA2), damit das Verzeichnis, das
 * dieser Abschnitt fuellt, die Faelle "ohne Manifest" weiter unten nicht
 * beruehrt.
 */
{
  let f = null
  try {
    f = await import("./stream-fetch.mjs")
  } catch (fehler) {
    rot++
    console.log(`  ROT  stream-fetch.mjs laedt nicht: ${String(fehler?.message).slice(0, 120)}`)
  }
  const dreiklang = f?.geteilterDreiklangFuerPruefsatz
  const mitVorrat = f?.vorratsSchluesselMitVorratFuerPruefsatz
  if (f && (typeof dreiklang !== "function" || typeof mitVorrat !== "function")) {
    rot++
    console.log("  ROT  die Naehte fehlen in stream-fetch.mjs")
  } else if (f) {
    const KARTE_U = `${GATE_DEFAULT_BASE}/a/pk_pruefsatz/beneos_bm_0007/4k/map_assets/ui_rahmen.webp`
    const KARTENSCHLUESSEL = "https://beneos-stream.invalid/a/beneos_bm_0007/4k/map_assets/ui_rahmen.webp"
    const GETEILTER_SCHLUESSEL = `https://beneos-stream.invalid/a/${GETEILT_RAUM}/${SHA2}/ui_rahmen.webp`
    const tU = () => zerlegeAdresse(KARTE_U)

    // Vor dem Manifest: ohne Pruefsumme gibt es nichts umzurechnen.
    gleich("ohne bekannte Pruefsumme: kein Dreiklang, auch bei AN", dreiklang(KARTE_U, tU()), null)
    gleich("ohne bekannte Pruefsumme: der Kartenschluessel, auch bei AN",
      mitVorrat(KARTE_U), KARTENSCHLUESSEL)

    f.merkePruefsummen([[KARTE_U, SHA2]])

    // DIE ZWEI-WERTE-PROBE DES SCHALTERS: dieselbe Adresse, derselbe Stand.
    gleich("mit Pruefsumme, Schalter AUS (ausgeliefert): der Kartenschluessel bleibt",
      f.vorratsSchluessel(KARTE_U), KARTENSCHLUESSEL)
    gleich("mit Pruefsumme, Schalter AN: der geteilte Schluessel",
      mitVorrat(KARTE_U), GETEILTER_SCHLUESSEL)
    gleich("bei AN idempotent: ein Schluessel bleibt ein Schluessel",
      mitVorrat(mitVorrat(KARTE_U)), GETEILTER_SCHLUESSEL)
    gleich("bei AN haengt der Vergleich am Pfad, eine Abfrage stoert nicht",
      mitVorrat(`${KARTE_U}?v=2`), GETEILTER_SCHLUESSEL)

    gleich("der Dreiklang: Raum, Raumname, Pruefsumme und der Basisname",
      JSON.stringify(dreiklang(KARTE_U, tU())),
      JSON.stringify({ raum: "geteilt", release: GETEILT_RAUM, variant: SHA2, pfad: "ui_rahmen.webp" }))
    gleich("ein geteilter Dreiklang wird nicht zweimal umgerechnet",
      dreiklang(KARTE_U, { ...tU(), raum: "geteilt" }), null)

    // Nicht geteilt: eine Szenendatei, deren Pruefsumme ebenfalls bekannt ist.
    const SZENE = `${GATE_DEFAULT_BASE}/a/pk_pruefsatz/beneos_bm_0007/4k/scenes/karte.webm`
    f.merkePruefsummen([[SZENE, SHA2]])
    gleich("eine Szenendatei mit bekannter Pruefsumme ist nicht geteilt",
      dreiklang(SZENE, zerlegeAdresse(SZENE)), null)
    gleich("und behaelt bei AN ihren Kartenschluessel",
      mitVorrat(SZENE), "https://beneos-stream.invalid/a/beneos_bm_0007/4k/scenes/karte.webm")

    // Die Form des Namens. Bei einem Zweifel bleibt es beim Kartenschluessel.
    const mitPfad = (pfad) => dreiklang(KARTE_U, { ...tU(), pfad })
    gleich("ein Name mit Leerzeichen: kein Dreiklang", mitPfad("map_assets/ui rahmen.webp"), null)
    gleich("ein Name mit Nicht-ASCII-Zeichen: kein Dreiklang", mitPfad("map_assets/ui_rähmen.webp"), null)
    gleich("ein fuehrender Punkt: kein Dreiklang", mitPfad("map_assets/.ui.webp"), null)
    gleich("201 Zeichen: kein Dreiklang", mitPfad(`map_assets/${"x".repeat(201)}`), null)
    gleich("200 Zeichen gehen noch", mitPfad(`map_assets/${"x".repeat(200)}`)?.pfad, "x".repeat(200))
    gleich("aus Unterordnern bleibt nur der Basisname", mitPfad("map_assets/a/b/ui.webp")?.pfad, "ui.webp")
    gleich("ein Punkt mitten im Namen ist erlaubt", mitPfad("map_assets/ui.rahmen.webp")?.pfad, "ui.rahmen.webp")
    gleich("Bindestrich und Unterstrich sind erlaubt", mitPfad("map_assets/a-b_c.webp")?.pfad, "a-b_c.webp")
  }
}

// Der Raumname kommt aus EINER Quelle. Zwei Kopien in zwei Dateien gehen
// erfahrungsgemaess nicht zugleich mit, und dieselbe Begruendung steht schon
// bei `zerlegeAdresse`.
struktur("der Raumname ist genau einmal gesetzt",
  ((settings + fetchQ + offline).match(/GETEILT_RAUM = /g) || []).length === 1)
struktur("stream-fetch.mjs importiert ihn",
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
console.log("- Die Lage mit dem Schalter AN laeuft hier nur ueber die zwei Naehte in")
console.log("  stream-fetch.mjs. Die Konstante selbst bleibt von aussen nicht")
console.log("  setzbar, und das ist Absicht: ein setzbarer Schalter waere eine")
console.log("  Kundenwahl, und das hier ist eine Auslieferungsreihenfolge. Nicht")
console.log("  gemessen ist damit, was vPut, vMatch und vDelete im Browser-Cache")
console.log("  bei AN tun.")
console.log("- Dass der geteilte Raum im Spiegel wirklich Bytes liefert. Der")
console.log("  Durchgang `_trigger-geteilt-mirror-fill.php` ist gebaut, handgefuehrt")
console.log("  und am 08.11.2026 nie gefahren. Entscheidet TC-PRJ-STR-284.")
console.log("- Der einmalige Preis des Umschaltens: jede geteilte Datei, die ein")
console.log("  Kunde heute haelt, gilt danach als fehlend und wird einmal neu")
console.log("  geholt. Gemessen sind das 5,0 Prozent der Bytes, nicht der ganze")
console.log("  Vorrat, aber gemessen ist es am Katalog und nicht an einem Kunden.")

process.exit(rot > 0 ? 1 : 0)
