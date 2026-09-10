// Prueft, wann eine Karte als verwaist gilt und was der blockierte Install
// meldet. Aus scripts/cloud-v2/cloud-window-v2.mjs und scripts/beneos_analytics.js.
//
// Hintergrund: die Suchdatenbank und die installierbaren Releases sind zwei
// unabhaengige Quellen, die nichts gegeneinander prueft. Am 27.08.2026 kamen
// zwei Eintraege in den Katalog, deren Release es serverseitig nicht gibt.
// Jeder Klick darauf scheiterte, und die Meldung schob es auf die Verbindung.
//
// Aufruf:
//   node bench.mjs          faehrt gegen den aktuellen Code
//   node bench.mjs --alt    faehrt gegen die Fassung vor dem Fix und muss
//                           rot werden
//
// Kein Foundry und kein Netz noetig.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { extractMethod, extractConst, buildProbe } from "../lib/extract-method.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const FENSTER = join(HERE, "..", "..", "scripts", "cloud-v2", "cloud-window-v2.mjs")
const ANALYTICS = join(HERE, "..", "..", "scripts", "beneos_analytics.js")
const ZUSTAND = join(HERE, "..", "..", "scripts", "cloud-v2", "beneos-install-state.mjs")
const fensterText = readFileSync(FENSTER, "utf8")
const analyticsText = readFileSync(ANALYTICS, "utf8")
const zustandText = readFileSync(ZUSTAND, "utf8")

// NACHBAU der Fassung vor dem Fix: es gab keine Waisenpruefung, jede Karte
// galt als zeigbar. Ausdruecklich Nachbau, kein Zitat.
const ALT_ORPHAN = `
  #releaseIsOrphan(props) {
    void props
    return false
  }
`

const useAlt = process.argv.includes("--alt")

// ABWEICHUNG ZU main: dieser Zweig schlaegt ueber #releaseFor nach, das nach
// dem exakten Treffer auf einen Kernindex zurueckfaellt. Beide werden
// geschnitten statt nachgebaut, sonst misst der Pruefstand eine andere
// Aufloesung als der Produktivcode.
const Fenster = buildProbe([
  useAlt ? ALT_ORPHAN : extractMethod(fensterText, "#releaseIsOrphan", { maxZeilen: 18 }),
  extractMethod(fensterText, "#releaseFor", { maxZeilen: 10 }),
  "  probe(props) { return this.#releaseIsOrphan(props) }",
], extractMethod(zustandText, "releaseKern", { maxZeilen: 10 }).replace(/^export\s+/, ""))

const Analytics = buildProbe(
  [
    extractMethod(analyticsText, "trackInstallBlocked", { maxZeilen: 45 }),
    extractMethod(analyticsText, "sanitize", { maxZeilen: 12 }),
    // Statt zu senden wird eingesammelt. Der Sendeweg selbst hat einen eigenen
    // Pruefstand, hier geht es um die Nutzlast.
    "  static gesendet = []",
    "  static track(name, payload) { this.gesendet.push({ name, payload }) }",
    "  static _errorThrottle = new Map()",
  ],
  extractConst(analyticsText, "ERROR_THROTTLE_MS")
)
globalThis.game = { system: { id: "dnd5e" }, version: "14.365" }

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? "OK  " : "FAIL"} ${name}` + (ok ? "" : `\n       erwartet ${JSON.stringify(want)}\n       gemessen ${JSON.stringify(got)}`))
}

// Der echte Katalogstand vom 10.09.2026: 145 bekannte Releases, und bm_0999
// ist keines davon.
const index = new Map([["bm_0115_arctic_landscape", {}], ["bm_single_map_0003", {}]])
// Der Kernindex dieses Zweigs. "bm_0115" ist der Kern von
// "bm_0115_arctic_landscape"; eine Karte, die nur so geschrieben ist, muss
// weiterhin sichtbar bleiben.
const kernIndex = new Map([["bm_0115", {}], ["bm_single_map_0003", {}]])
const mit = (dir) => ({ release_dir: dir })

// 1) DIE GEFAEHRLICHE PROBE. Ist der Index noch nicht geladen, darf NICHTS
//    als verwaist gelten. Er wird ohne await geholt, der erste Durchlauf sieht
//    also regelmaessig null. Ein Urteil an dieser Stelle wuerde die gesamte
//    Kartenliste leeren, und zwar genau bei den Kunden mit langsamer Leitung.
{
  const p = new Fenster()
  p._releaseIndex = null
  check("1 ohne geladenen Index gilt nichts als verwaist", p.probe(mit("bm_0999")), false)
  check("1 auch ein bekanntes Release nicht", p.probe(mit("bm_0115_arctic_landscape")), false)
  p._releaseIndex = undefined
  check("1 undefined verhaelt sich wie null", p.probe(mit("bm_0999")), false)
  // DIE FALLE. Eine leere Map ist wahrheitswertig und faellt durch einen
  // blossen Null-Schutz. Erreichbar ohne Fehler auf unserer Seite:
  // listReleases() liefert `data.releases || []` fuer eine Antwort, die ok
  // sagt und keine Liste traegt. Ohne diese Probe verschwindet die gesamte
  // Kartenliste statt zweier Kacheln.
  p._releaseIndex = new Map()
  check("1 eine LEERE Map gilt ebenfalls als kein Urteil", p.probe(mit("bm_0999")), false)
  check("1 und laesst echte Karten stehen", p.probe(mit("bm_0115_arctic_landscape")), false)
}

// 2) Mit geladenem Index wird unterschieden.
{
  const p = new Fenster()
  p._releaseIndex = index
  p._releaseKernIndex = kernIndex
  check("2 bekanntes Release ist nicht verwaist", p.probe(mit("bm_0115_arctic_landscape")), false)
  check("2 Einzelkarte ebenfalls nicht", p.probe(mit("bm_single_map_0003")), false)
  check("2 bm_0999 ist verwaist", p.probe(mit("bm_0999")), true)
  // Der Grund fuer die Abweichung zu main: nur ueber den Kern auffindbar.
  check("2 nur ueber den Kern gefunden bleibt sichtbar", p.probe(mit("bm_0115")), false)
}

// 3) Ohne release_dir gibt es nichts nachzuschlagen, also auch kein Urteil.
{
  const p = new Fenster()
  p._releaseIndex = index
  p._releaseKernIndex = kernIndex
  check("3 ohne release_dir kein Urteil", p.probe({}), false)
  check("3 leere Eigenschaften", p.probe(undefined), false)
  check("3 leerer release_dir", p.probe(mit("")), false)
  // Der Installweg liest denselben Wert getrimmt. Ohne dieselbe Normalisierung
  // hier gaelte eine installierbare Karte mit einem Leerzeichen am Rand als
  // verwaist und verschwaende.
  check("3 Leerzeichen am Rand aendern nichts", p.probe(mit(" bm_0115_arctic_landscape ")), false)
}

// 4) Der Ereignisname. Er ist eigen, und das kostet eine Vorbedingung:
//    api-analytics.php nimmt nur bekannte Namen an und verwirft den Rest
//    still, mit HTTP 200. Bis install_blocked in der Zulassungsliste steht,
//    kommt hier nichts an. Das ist harmlos und in dieser Reihenfolge gewollt,
//    Server zuerst.
{
  Analytics.gesendet = []
  Analytics._errorThrottle = new Map()
  Analytics.trackInstallBlocked({ release_dir: "bm_0999", variant: "4K", reason: "release_not_in_catalog" })
  check("4 genau ein Ereignis", Analytics.gesendet.length, 1)
  check("4 und es heisst install_blocked, nicht install_error", Analytics.gesendet[0]?.name, "install_blocked")
}

// 5) Der Name darf NICHT install_error sein. _trigger-install-health.php
//    zaehlt jede Zeile dieses Namens gegen einen 14-Tage-Mittelwert und mailt;
//    genau so hat trackAssetRefused am 26.08.2026 fuenfzig Laeufe Fehlalarm
//    erzeugt. Der Beschluss vom 30.08.2026 war ein eigener Name.
{
  const p = Analytics.gesendet[0] || {}
  check("5 kein Alarmname", p.name !== "install_error", true)
  check("5 und keine Fehlerkategorie im Rumpf", p.payload?.fatal_category, undefined)
}

// 6) Das Release steht drin. Ohne diesen Wert waere das Ereignis zaehlbar,
//    aber nicht auffindbar, und genau das Auffinden ist der Zweck.
{
  const p = Analytics.gesendet[0]?.payload || {}
  check("6 das Verzeichnis reist mit", p.release_dir, "bm_0999")
  check("6 der Grund auch", p.reason, "release_not_in_catalog")
  check("6 und die Fassung", p.variant, "4K")
}

// 7) Drosselung: derselbe Fall zaehlt nicht zweimal in derselben Minute, ein
//    anderes Release aber schon.
{
  Analytics.gesendet = []
  Analytics._errorThrottle = new Map()
  const arg = { release_dir: "bm_0999", variant: "4K", reason: "release_not_in_catalog" }
  Analytics.trackInstallBlocked(arg)
  Analytics.trackInstallBlocked(arg)
  check("7 zweimal derselbe Fall ergibt ein Ereignis", Analytics.gesendet.length, 1)
  Analytics.trackInstallBlocked({ ...arg, release_dir: "bm_0998" })
  check("7 ein anderes Release wird gezaehlt", Analytics.gesendet.length, 2)
}

// 8) Alle vier Gruende sind unterscheidbar. Einem abgemeldeten Kunden zu
//    sagen "gleich geht es weiter" waere derselbe Fehlertyp wie ihm die
//    Verbindung vorzuwerfen.
{
  for (const g of ["catalog_not_loaded", "needs_login", "catalog_load_failed"]) {
    Analytics.gesendet = []
    Analytics._errorThrottle = new Map()
    Analytics.trackInstallBlocked({ release_dir: "bm_0115", variant: "HD", reason: g })
    check("8 Grund " + g + " kommt unveraendert an", Analytics.gesendet[0]?.payload?.reason, g)
  }
}

console.log(fails ? `\n${fails} FEHLSCHLAEGE` : `\nalle Proben bestanden${useAlt ? " (das waere ein Befund, siehe README)" : ""}`)
process.exit(fails ? 1 : 0)
