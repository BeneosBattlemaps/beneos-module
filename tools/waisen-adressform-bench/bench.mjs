/*
 * waisen-adressform-bench
 *
 * Haelt die Dateipruefung des Kreaturen-Installers (`scripts/beneos_cloud.js`)
 * fest. Laeuft ohne Foundry und ohne Netz:
 *
 *   node tools/waisen-adressform-bench/bench.mjs
 *
 * Rueckgabewert 0 heisst alle Saetze gruen, 1 heisst mindestens einer rot.
 *
 * WARUM ER ENTSTANDEN IST, am 08.11.2026 mit `OP-PRJ-170`. Die Waisenpruefung
 * hinter der Aufraeumfunktion probte bis zum 05.11.2026 jede Texturadresse mit
 * `fetch(url, { method: "HEAD" })` und baute die Adresse als
 * `protoSrc.startsWith("/") ? protoSrc : "/" + protoSrc`. Aus einer Toradresse
 * wurde dadurch `/https://gate...`, das antwortet 404, und JEDE gestreamte
 * Kreatur bekam die Markierung `missing_files`. Das Fenster legte dem
 * Spielleiter dann genau die Dokumente zum Loeschen vor, die in Ordnung sind.
 *
 * Dieselbe Zeile schickte den Streamschluessel in die Anfragezeile des eigenen
 * Foundry-Servers, also in das Zugriffsprotokoll des Kunden und als rote
 * 404-Zeile in seine Browserkonsole.
 *
 * Behoben ist das seit `7e96c69`. Gemessen am 08.11.2026 war daran nichts
 * geschuetzt: `scripts/beneos_cloud.js` loeste GAR KEINEN Pruefsatz des
 * Vorhakens aus, und kein Stand nannte `_beneosAdressForm`. Eine entfernte
 * Zeile und der Fehler waere zurueck, ohne dass irgendetwas rot wird.
 *
 * WAS ER AM VERHALTEN MISST und was nur am Quelltext. Die Formunterscheidung
 * `_beneosAdressForm()` wird aus der Datei GESCHNITTEN und wirklich gefahren,
 * mit der echten `zerlegeAdresse()` daneben. Die Weiche davor und die Form der
 * Probe sind Quelltextsaetze, denn beide liegen in einer Funktion, die ohne
 * Foundry nicht laeuft; sie pruefen gegen den Quelltext OHNE Kommentarzeilen,
 * weil ein Anker sonst den Erklaertext trifft, der die alte Zeile nennt.
 *
 * DER WICHTIGSTE SATZ PRUEFT EINE ANZAHL. Alles andere prueft die eine Probe,
 * die es heute gibt. Keiner dieser Saetze kann sehen, dass jemand eine ZWEITE
 * HEAD-Probe dazuschreibt, und genau so ist der Fehler entstanden: die gute
 * Probe lag schon in derselben Datei, die Waisenpruefung hat sie nur nicht
 * benutzt. Der Stand zaehlt deshalb roh, wie viele HEAD-Proben die Datei
 * fuehrt, und fordert, dass es genau eine ist und dass sie in
 * `_beneosProbeInstalledFile` steht. Eine zweite macht ihn rot, und wer sie
 * braucht, prueft dann von Hand, ob sie Route, Zwischenspeicherbruch und
 * Stummelschutz traegt.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { extractMethod } from "../lib/extract-method.mjs"
import { zerlegeAdresse, assetUrl, streamBase } from "../../scripts/stream/stream-settings.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const CLOUD = join(HIER, "..", "..", "scripts", "beneos_cloud.js")

let rot = 0
let gruen = 0

function gleich(name, ist, soll) {
  if (ist === soll) {
    gruen++
    console.log(`  ok   ${name}`)
  } else {
    rot++
    console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}`
      + `\n       ist  ${JSON.stringify(ist)}`)
  }
}

const quelle = readFileSync(CLOUD, "utf8")

/*
 * Der Quelltext OHNE Kommentarzeilen.
 *
 * Eine Probe, die auf eine ABWESENHEIT zielt, trifft sonst den Kommentar, der
 * die Abwesenheit erklaert. Dann waere jede gute Begruendung ein Fehlalarm, und
 * das Mittel dagegen waere, keine zu schreiben.
 */
function nurCode(text) {
  return text.split("\n").filter((z) => {
    const t = z.trim()
    return t !== "" && !t.startsWith("//") && !t.startsWith("*")
      && !t.startsWith("/*")
  }).join("\n")
}

const code = nurCode(quelle)

const B = streamBase()
const K = "sk_live_7f3a9c21d4e5b6a7"

console.log(`Quelle: scripts/beneos_cloud.js, ${quelle.split("\n").length} Zeilen`)
console.log(`davon Code ohne Kommentare: ${code.split("\n").length} Zeilen`)
console.log("")

// ================================================================= 1 ======

/*
 * Die Formunterscheidung wird AUS DER DATEI GESCHNITTEN und wirklich gefahren,
 * mit der echten `zerlegeAdresse()` daneben statt mit einer Attrappe. Eine
 * Attrappe wuerde genau die Frage beantworten, die hier offen ist.
 *
 * Sie steht auf oberster Ebene, weil zwei Satzgruppen sie brauchen.
 */
const adressForm = (function () {
  const schnitt = extractMethod(quelle, "_beneosAdressForm",
    { minZeilen: 1, maxZeilen: 6 })
  const bauen = new Function("zerlegeAdresse",
    `${schnitt.replace(/^function\s+/, "function ")}\nreturn _beneosAdressForm`)
  return bauen(zerlegeAdresse)
})()

console.log("Die Formunterscheidung, am geschnittenen echten Code gefahren")
{
  gleich("eine Kartenadresse ist eine Toradresse",
    adressForm(`${B}/a/${K}/beneos_bm_0042/night/map.webm`), "tor")
  gleich("eine Kreaturenadresse ist eine Toradresse",
    adressForm(`${B}/c/${K}/beneos_ct_goblin/goblin-1-top.webp`), "tor")
  gleich("eine Beuteadresse ist eine Toradresse",
    adressForm(`${B}/l/${K}/beneos_lt_sword/sword-front.webp`), "tor")
  gleich("eine geteilte Adresse ist eine Toradresse",
    adressForm(`${B}/s/${K}/shared/${"a".repeat(64)}/ui.webp`), "tor")
  gleich("ein oertlich installierter Pfad ist oertlich",
    adressForm("beneos_assets/cloud/tokens/000-goblin/000-goblin-1-top.webp"),
    "oertlich")
  gleich("ein oertlicher Pfad mit fuehrendem Schraegstrich ist oertlich",
    adressForm("/beneos_assets/cloud/tokens/x/y.webp"), "oertlich")
  gleich("eine leere Adresse ist oertlich",
    adressForm(""), "oertlich")
  gleich("eine Adresse ohne jede Form ist oertlich",
    adressForm(null), "oertlich")

  gleich("der Freiweg des Tors traegt keinen Schluessel und ist oertlich",
    adressForm(`${B}/free/beneos_bm_0042/night/map.webm`), "oertlich")

  // Dieselbe Frage von der Seite, aus der die Adressen wirklich kommen.
  gleich("eine von assetUrl gebaute Kreaturenadresse ist eine Toradresse",
    adressForm(assetUrl("beneos_ct_goblin", "", "goblin-1-top.webp")), "tor")
}

// ================================================================= 1b =====

console.log("")
console.log("Der Host wird hier NICHT geprueft, und das ist Absicht")
{
  /*
   * DIESE SAETZE HIELTEN ZUERST DAS GEGENTEIL FEST, und das Nachmessen am
   * 08.11.2026 hat sie widerlegt. Es sah nach einer Luecke aus: eine Adresse
   * auf FREMDEM Host mit derselben Pfadform gilt als Toradresse, wird also in
   * der Waisenpruefung nicht geprobt, und ein kaputter Fremdpfad erscheint
   * nicht als `missing_files`.
   *
   * Es ist aber keine Luecke, sondern eine begruendete Arbeitsteilung, und sie
   * steht im Quelltext beider Funktionen:
   *
   *   `zerlegeAdresse()`       prueft den Host NICHT. Sie heilt
   *                            Vorratseintraege, die unter einer FRUEHEREN
   *                            Basisadresse angelegt wurden. Mit Hostpruefung
   *                            waere jeder Eintrag aus einer alten Basis
   *                            unlesbar statt heilbar.
   *   `ohneSchluesselImText()` prueft den Host, und zwar als Teil des Musters.
   *                            Ohne ihn wuerde `/a/x/` in jedem fremden Text
   *                            getroffen, etwa in einem Dateipfad des Kunden.
   *
   * Zwei verschiedene Fragen, zwei verschiedene Antworten. Diese Saetze halten
   * das fest, damit die naechste Sitzung es nicht wieder als Fehler liest und
   * eine Hostpruefung einbaut, die Bestandsvorraete zerstoert.
   */
  const fremd = `https://example.test/a/${K}/r/v/f.webp`
  gleich("ein fremder Host mit Kartenform gilt hier als Toradresse",
    adressForm(fremd), "tor")
  gleich("in der Waisenpruefung heisst das: er wird nicht geprobt, also auch "
    + "nicht gemeldet", adressForm(fremd) === "tor", true)
  gleich("eine Adresse ohne gueltige Pfadform bleibt oertlich, auch auf "
    + "fremdem Host", adressForm("https://example.test/a/nur_zwei"), "oertlich")
}

// ================================================================= 2 ======

console.log("")
console.log("Die Weiche der Waisenpruefung steht und probt nur Oertliches")
{
  gleich("die Weiche fragt die Adressform, bevor sie probt",
    /_beneosAdressForm\(protoSrc\) !== "tor"/.test(code), true)
  gleich("eine fehlende Adresse gilt weiter als Fehler",
    /if \(!protoSrc\) \{\s*\n\s*issues\.push\("missing_files"\)/.test(code), true)
  gleich("die Probe im Waisenzweig ist die gute",
    /_beneosProbeInstalledFile\(protoSrc\)/.test(code), true)

  // DER ALTE FEHLER, WOERTLICH. Er darf im Code nicht mehr vorkommen.
  gleich("kein nacktes Anhaengen eines Schraegstrichs an die Texturadresse",
    /protoSrc\.startsWith\("\/"\)/.test(code), false)

  /*
   * WARUM DER KOMMENTARFILTER TROTZDEM NOETIG IST, auch wenn der alte Fehler
   * nicht woertlich im Erklaertext steht. Ein erster Entwurf dieses Standes
   * behauptete das und wurde rot: der Kommentar an der Waisenpruefung nennt
   * die Folge (`/https://gate...`) und nicht die Zeile. Gemessen ist aber,
   * dass der Erklaertext die PRUEFBAREN NAMEN sehr wohl nennt, und damit traegt
   * jeder Abwesenheitssatz, der auf einen Namen zielt, dasselbe Risiko. Der
   * Filter bleibt, und diese zwei Saetze belegen, dass er wirkt und dass es
   * ohne ihn einen Fehlalarm gaebe.
   */
  gleich("der Kommentarfilter nimmt wirklich etwas weg",
    code.length < quelle.length, true)
  gleich("ohne Filter traefe ein Abwesenheitssatz den Erklaertext",
    quelle.includes("missing_files") && /^\s*(\/\/|\*).*missing_files/m.test(quelle),
    true)
}

// ================================================================= 3 ======

console.log("")
console.log("Die Gesamtmenge: wie viele Dateiproben fuehrt diese Datei")
{
  // WARUM DIESER BLOCK DER WICHTIGSTE IST. Alles darueber prueft die eine
  // Probe, die es heute gibt. Eine ZWEITE, neu dazugeschriebene Probe faellt
  // keinem dieser Saetze auf, und genau das war der Fehler: die gute Probe lag
  // schon in derselben Datei, die Waisenpruefung hat sie nur nicht benutzt.
  const proben = [...code.matchAll(/method:\s*"HEAD"/g)]
  gleich("die rohe Zaehlung findet ueberhaupt eine Probe", proben.length > 0, true)
  gleich("die Datei fuehrt genau EINE HEAD-Probe", proben.length, 1)

  // Und sie steht in der Funktion, die Route, Zwischenspeicherbruch und
  // Stummelschutz traegt. Eine HEAD-Probe irgendwo sonst waere eine ohne diese
  // drei.
  const probe = extractMethod(quelle, "_beneosProbeInstalledFile",
    { minZeilen: 8, maxZeilen: 30 })
  gleich("die eine Probe liegt in _beneosProbeInstalledFile",
    /method:\s*"HEAD"/.test(probe), true)
  gleich("sie nimmt den Unterpfad der Installation mit",
    /foundry\.utils\?\.getRoute\?\.\(/.test(probe), true)
  gleich("sie bricht den Zwischenspeicher",
    /\?_b=/.test(probe), true)
  gleich("sie erkennt den Stummel des Deinstallierers",
    /BENEOS_STUB_MAX_BYTES/.test(probe), true)
  gleich("sie erkennt eine HTML-Fehlseite als Fehler",
    /text\\\/html/.test(probe) || /text\/html/.test(probe), true)

  /*
   * Die Forge-Ausnahme, und sie ist der Grund, warum eine Probe dort gar nicht
   * erst laeuft: Assets liegen hinter einem fremden Praefix, und eine Probe auf
   * `/beneos_assets/...` wuerde JEDE Ansicht als fehlend melden.
   *
   * GEZAEHLT WIRD DIE AUFRUFSTELLE UND NICHT DER NAME, und das ist die Lehre
   * aus einer Sabotage, die am 08.11.2026 durchkam. Der erste Entwurf dieses
   * Satzes prueft `/_beneosUsingTheForge/` ohne Wortgrenze; eine Umbenennung
   * auf `_beneosUsingTheForgeXX` enthaelt den alten Namen als Teilstring, und
   * der Satz blieb gruen, obwohl keine Ausnahme mehr griff. Ein Satz, der auf
   * einen NAMEN zielt, muss die Grenze mitnennen, und besser als der Name ist
   * die Zahl der Stellen, die ihn WIRKLICH aufrufen.
   */
  const forgeAufrufe = [...code.matchAll(/_beneosUsingTheForge\(\)/g)]
  gleich("die Forge-Ausnahme wird wirklich aufgerufen",
    forgeAufrufe.length >= 3, true)
  gleich("und sie ist als Funktion mit genau diesem Namen erklaert",
    /function\s+_beneosUsingTheForge\s*\(/.test(code), true)
}

// ================================================================= 4 ======

console.log("")
console.log("Gegenproben: der Stand misst wirklich DIESE Datei")
{
  // Eine Suche, die nichts findet, ist von einer kaputten Suche nicht zu
  // unterscheiden. Diese drei Saetze fallen aus, sobald der Pfad nicht mehr
  // stimmt oder die Datei leer gelesen wird, und dann waeren alle
  // Abwesenheitssaetze darueber still gruen.
  gleich("die Datei ist nicht leer gelesen", quelle.length > 10000, true)
  gleich("sie ist der Kreaturen-Installer",
    /importTokenToCompendium/.test(code), true)
  gleich("sie traegt die Waisenaufraeumung",
    /missing_files/.test(code), true)
}

console.log("")
console.log(`${gruen} gruen, ${rot} rot`)
if (rot === 0) {
  console.log("Gesamtmenge geprueft: genau 1 HEAD-Probe in der Datei, roh "
    + "nachgezaehlt. Eine zweite macht diesen Stand rot.")
  console.log("Gegenprobe bestanden: 5 Faelle MUSSTEN oertlich heissen, "
    + "darunter der Freiweg des Tors und eine Adresse ohne gueltige Pfadform.")
  console.log("Festgehalten, weil es wie ein Fehler aussieht: ein FREMDER Host "
    + "mit Kartenform gilt als Toradresse, und das ist begruendet.")
}
process.exit(rot === 0 ? 0 : 1)
