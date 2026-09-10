// Prueft, wann eine Karte als verwaist gilt.
// Aus scripts/cloud-v2/cloud-window-v2.mjs.
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
import { extractMethod, buildProbe } from "../lib/extract-method.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const FENSTER = join(HERE, "..", "..", "scripts", "cloud-v2", "cloud-window-v2.mjs")
const fensterText = readFileSync(FENSTER, "utf8")

// NACHBAU der Fassung vor dem Fix: es gab keine Waisenpruefung, jede Karte
// galt als zeigbar. Ausdruecklich Nachbau, kein Zitat.
const ALT_ORPHAN = `
  #releaseIsOrphan(props) {
    void props
    return false
  }
`

const useAlt = process.argv.includes("--alt")

const Fenster = buildProbe([
  useAlt ? ALT_ORPHAN : extractMethod(fensterText, "#releaseIsOrphan", { maxZeilen: 10 }),
  "  probe(props) { return this.#releaseIsOrphan(props) }",
])


let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? "OK  " : "FAIL"} ${name}` + (ok ? "" : `\n       erwartet ${JSON.stringify(want)}\n       gemessen ${JSON.stringify(got)}`))
}

// Der echte Katalogstand vom 10.09.2026: 145 bekannte Releases, und bm_0999
// ist keines davon.
const index = new Map([["bm_0115_arctic_landscape", {}], ["bm_single_map_0003", {}]])
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
  check("2 bekanntes Release ist nicht verwaist", p.probe(mit("bm_0115_arctic_landscape")), false)
  check("2 Einzelkarte ebenfalls nicht", p.probe(mit("bm_single_map_0003")), false)
  check("2 bm_0999 ist verwaist", p.probe(mit("bm_0999")), true)
}

// 3) Ohne release_dir gibt es nichts nachzuschlagen, also auch kein Urteil.
{
  const p = new Fenster()
  p._releaseIndex = index
  check("3 ohne release_dir kein Urteil", p.probe({}), false)
  check("3 leere Eigenschaften", p.probe(undefined), false)
  check("3 leerer release_dir", p.probe(mit("")), false)
  // Der Installweg liest denselben Wert getrimmt. Ohne dieselbe Normalisierung
  // hier gaelte eine installierbare Karte mit einem Leerzeichen am Rand als
  // verwaist und verschwaende.
  check("3 Leerzeichen am Rand aendern nichts", p.probe(mit(" bm_0115_arctic_landscape ")), false)
}

console.log(fails ? `\n${fails} FEHLSCHLAEGE` : `\nalle Proben bestanden${useAlt ? " (das waere ein Befund, siehe README)" : ""}`)
process.exit(fails ? 1 : 0)
