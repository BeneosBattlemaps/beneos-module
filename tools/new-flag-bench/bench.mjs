// Prueft, welche Katalogeintraege das NEU-Abzeichen bekommen, aus
// scripts/cloud-v2/home/home-controller.mjs.
//
// Hintergrund: die alte Regel nahm das MAXIMUM aller Zahlenpraefixe im
// Schluessel. Am 27.08.2026 kamen zwei vorlaeufige Eintraege mit dem Praefix
// 999 in den veroeffentlichten Katalog. Damit war das Maximum 999, das
// Abzeichen sass auf diesen zwei, und die 28 echten Eintraege aus Release 115
// verloren es. Zwei Wochen lang, bei jedem Kunden.
//
// Aufruf:
//   node bench.mjs          faehrt gegen den aktuellen Code
//   node bench.mjs --alt    faehrt gegen die alte Regel und muss rot werden
//
// Kein Foundry und KEIN Netz noetig. Die Proben laufen gegen echte Werte aus
// der Live-Suchdatenbank, gezogen am 10.09.2026, siehe katalog-auszug.json.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { extractMethod } from "../lib/extract-method.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, "..", "..", "scripts", "cloud-v2", "home", "home-controller.mjs")
const SUCHE = join(HERE, "..", "..", "scripts", "beneos_search_engine.js")
const text = readFileSync(SOURCE, "utf8")
const sucheText = readFileSync(SUCHE, "utf8")
const AUSZUG = JSON.parse(readFileSync(join(HERE, "katalog-auszug.json"), "utf8"))

// NACHBAU der Regel vor dem Fix. Ausdruecklich Nachbau, kein Zitat.
const ALT = `
function isProvisionalEntry() { return false }
function releaseDayOf() { return "" }
function ensureBattlemapNewFlags() {
  const all = game.beneos.databaseHolder.getAll("bmap") || {}
  const entries = Object.entries(all)
  if (!entries.length) return
  for (const [, data] of entries) { if (data) data.isNew = false }
  let maxRelease = 0
  for (const [k] of entries) {
    const m = String(k || "").match(/^(\\d+)/)
    const r = m ? (parseInt(m[1], 10) || 0) : 0
    if (r > maxRelease) maxRelease = r
  }
  if (maxRelease <= 0) return
  for (const [k, data] of entries) {
    if (!data) continue
    const m = String(k || "").match(/^(\\d+)/)
    const r = m ? (parseInt(m[1], 10) || 0) : 0
    if (r === maxRelease) data.isNew = true
  }
}
`

const useAlt = process.argv.includes("--alt")

// Die Erkennung vorlaeufiger Eintraege steht auf der Klasse, die den Katalog
// besitzt. Sie wird von dort geschnitten, damit der Pruefstand die eine echte
// Definition misst und nicht eine Abschrift davon.
const holderKlasse = `class BeneosDatabaseHolder {\n${extractMethod(sucheText, "beneosIsProvisional", { maxZeilen: 8 })}\n}`

const schnitt = useAlt ? ALT : [
  holderKlasse,
  extractMethod(text, "isProvisionalEntry", { maxZeilen: 10 }),
  extractMethod(text, "releaseDayOf", { maxZeilen: 16 }),
  extractMethod(text, "newestDayOf", { maxZeilen: 16 }),
  extractMethod(text, "ensureBattlemapNewFlags", { maxZeilen: 40 }),
].join("\n").replace(/^export\s+/gm, "")

// Zweite Stelle, gleicher Fehler: die Kacheln der Kartenliste. Sie geht schon
// ueber das Datum, filterte vorlaeufige Eintraege aber nicht.
const Suche = new Function(`class Holder {
${extractMethod(sucheText, "beneosIsProvisional", { maxZeilen: 8 })}
${extractMethod(sucheText, "beneosParseDateMs", { maxZeilen: 20 })}
${extractMethod(sucheText, "beneosNewestReleaseMs", { maxZeilen: 26 })}
${extractMethod(sucheText, "beneosComputeNewUpdate", { maxZeilen: 32 })}
}
return Holder`)()

// Die Funktionen liegen im Modulscope, nicht in einer Klasse. buildProbe baut
// eine Klasse und passt hier nicht; der Rahmen ist deshalb dieselbe Technik
// eine Ebene tiefer, mit demselben Schnitt aus derselben Quelle.
const Probe = new Function(`${schnitt}\nreturn { ensureBattlemapNewFlags, isProvisionalEntry, releaseDayOf, newestDayOf: typeof newestDayOf === "function" ? newestDayOf : null }`)()

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? "OK  " : "FAIL"} ${name}` + (ok ? "" : `\n       erwartet ${JSON.stringify(want)}\n       gemessen ${JSON.stringify(got)}`))
}

// Der Katalog, wie das Modul ihn sieht. Tiefe Kopie je Lauf, weil die Funktion
// die Eintraege in place markiert.
const lauf = (eintraege) => {
  const daten = JSON.parse(JSON.stringify(eintraege))
  globalThis.game = { beneos: { databaseHolder: { getAll: () => daten } } }
  Probe.ensureBattlemapNewFlags()
  return Object.entries(daten).filter(([, d]) => d?.isNew).map(([k]) => k).sort()
}
const praefix = (k) => { const m = String(k).match(/^(\d+)/); return m ? parseInt(m[1], 10) : null }

// 1) DER KUNDENFALL, mit den echten Werten aus der Live-Datei.
{
  const neu = lauf(AUSZUG.content)
  const sonden = neu.filter(k => praefix(k) === 999)
  const echte = neu.filter(k => praefix(k) === 115)
  check("1 keine der zwei Sonden traegt NEU", sonden, [])
  check("1 stattdessen die echte Welle 115", echte.length, 6)
  check("1 und sonst nichts", neu.length, echte.length)
}

// 2) Das Datum entscheidet, nicht die Nummer. Die Sonden tragen die HOECHSTE
//    Nummer und ein AELTERES Datum. Genau daran ist die alte Regel gescheitert.
{
  const p = AUSZUG.content
  const sondenDatum = Object.entries(p).find(([k]) => praefix(k) === 999)[1].properties.release_date
  const welleDatum = Object.entries(p).find(([k]) => praefix(k) === 115)[1].properties.release_date
  check("2 Vorbedingung: Sonde hat die hoehere Nummer", 999 > 115, true)
  check("2 Vorbedingung: Sonde hat das aeltere Datum", sondenDatum < welleDatum, true)
}

// 3) Das Kennzeichen allein reicht nicht, das Datum allein auch nicht. Eine
//    Sonde mit dem JUENGSTEN Datum darf trotzdem kein NEU bekommen, sonst
//    wandert das Abzeichen beim naechsten Fehleintrag sofort wieder weg.
{
  const daten = JSON.parse(JSON.stringify(AUSZUG.content))
  for (const [k, d] of Object.entries(daten)) if (praefix(k) === 999) d.properties.release_date = "2099-01-01"
  const neu = lauf(daten)
  check("3 Sonde mit juengstem Datum bekommt trotzdem kein NEU", neu.filter(k => praefix(k) === 999), [])
  check("3 die echte Welle behaelt es", neu.filter(k => praefix(k) === 115).length, 6)
}

// 4) provisional ueber match_source, ohne needs_tagging. Der Katalog kennt
//    beide Kennzeichen, und wir lesen beide.
{
  const daten = JSON.parse(JSON.stringify(AUSZUG.content))
  for (const [k, d] of Object.entries(daten)) if (praefix(k) === 115) {
    d.properties.needs_tagging = undefined
    d.properties.match_source = { strategy: "provisional" }
  }
  const neu = lauf(daten)
  check("4 provisional per match_source zaehlt auch", neu.filter(k => praefix(k) === 115), [])
  check("4 dann rueckt die naechste echte Welle nach", neu.filter(k => praefix(k) === 114).length, 3)
}

// 5) Ohne brauchbares Datum wird NICHTS markiert, statt auf die Nummer
//    zurueckzufallen. Nichts anzuzeigen ist unsichtbar, das Falsche
//    anzuzeigen ist der Fehler, der uns hierher gebracht hat.
{
  const daten = JSON.parse(JSON.stringify(AUSZUG.content))
  for (const d of Object.values(daten)) d.properties.release_date = ""
  check("5 ohne Datum bleibt alles ohne NEU", lauf(daten), [])
  const kaputt = JSON.parse(JSON.stringify(AUSZUG.content))
  for (const d of Object.values(kaputt)) d.properties.release_date = "irgendwann"
  check("5 unbrauchbares Datum ebenso", lauf(kaputt), [])
}

// 6) Leerer Katalog und fehlende Eintraege werfen nicht.
{
  check("6 leerer Katalog", lauf({}), [])
  const mitLuecke = JSON.parse(JSON.stringify(AUSZUG.content))
  mitLuecke["kaputt"] = null
  check("6 Katalog mit leerem Eintrag", lauf(mitLuecke).filter(k => praefix(k) === 115).length, 6)
}

// 7) Die alte Markierung wird zurueckgesetzt. Sonst bliebe ein Abzeichen aus
//    einem frueheren Durchlauf stehen, wenn der Katalog nachlaedt.
{
  const daten = JSON.parse(JSON.stringify(AUSZUG.content))
  for (const d of Object.values(daten)) d.isNew = true
  const neu = lauf(daten)
  check("7 alte Markierungen verschwinden", neu.length, 6)
}

// 9) Ein Datum in der ZUKUNFT ist kein brauchbares Datum. Der Wert kommt vom
//    CDN, und die Formpruefung sagt nichts ueber den Bereich. Ein Tippfehler
//    wie 2126-09-01 machte sonst einen einzigen Eintrag zur ewig neuesten
//    Welle und naehme allen anderen das Abzeichen: derselbe Fehler wie mit der
//    Nummer, nur mit dem Datum.
{
  const daten = JSON.parse(JSON.stringify(AUSZUG.content))
  const einer = Object.keys(daten).find(k => praefix(k) === 114)
  daten[einer].properties.release_date = "2126-09-01"
  const neu = lauf(daten)
  check("9 ein Datum aus der Zukunft zaehlt nicht", neu.includes(einer), false)
  check("9 die echte Welle behaelt das Abzeichen", neu.filter(k => praefix(k) === 115).length, 6)
  if (Probe.newestDayOf) {
    check("9 heute ist einschliesslich", Probe.releaseDayOf({ properties: { release_date: "2026-09-10" } }, "2026-09-10"), "2026-09-10")
    check("9 morgen nicht", Probe.releaseDayOf({ properties: { release_date: "2026-09-11" } }, "2026-09-10"), "")
  }
}

// 8) Die ZWEITE Stelle, die Kacheln der Kartenliste. Sie ging schon ueber das
//    Datum und war deshalb heute nicht betroffen, filterte vorlaeufige
//    Eintraege aber nicht. Der Katalogbauer stempelt sie mit dem HEUTIGEN
//    Datum, der naechste Fehleintrag haette also auch hier das Abzeichen
//    gekapert. Im --alt-Lauf gibt es die Klasse nicht, die Probe entfaellt.
if (!useAlt) {
  const daten = JSON.parse(JSON.stringify(AUSZUG.content))
  // Eine Sonde auf das juengste Datum setzen, so wie der Generator es taete.
  for (const [k, d] of Object.entries(daten)) if (praefix(k) === 999) d.properties.release_date = "2099-01-01"
  Suche.bmapData = { content: daten }
  Suche.beneosResetNewestReleaseMs?.()
  Suche._newestReleaseMs = {}

  const sonde = Object.entries(daten).find(([k]) => praefix(k) === 999)[1]
  const welle = Object.entries(daten).find(([k]) => praefix(k) === 115)[1]
  const r = (d) => Suche.beneosComputeNewUpdate(d, { type: "bmap" }).isNew

  check("8 die Sonde setzt nicht mehr die neueste Welle",
    Suche.beneosNewestReleaseMs("bmap"), Date.parse("2026-09-01"))
  check("8 die Sonde selbst bekommt kein NEU", r(sonde), false)
  check("8 die echte Welle bekommt es", r(welle), true)
}

console.log(fails ? `\n${fails} FEHLSCHLAEGE` : `\nalle Proben bestanden${useAlt ? " (das waere ein Befund, siehe README)" : ""}`)
process.exit(fails ? 1 : 0)
