// Prueft BeneosAnalytics._fitKeepalive aus scripts/beneos_analytics.js.
//
// Die Funktion entscheidet, wie viele Ereignisse beim Schliessen der Welt
// wirklich rausgehen. fetch lehnt einen keepalive-Rumpf ueber 64 KB ab, und
// eine Ablehnung kostet den ganzen Stapel. Deshalb halbiert sie, bis es passt.
//
// Aufruf:
//   node bench.mjs          faehrt gegen den aktuellen Code
//   node bench.mjs --alt    faehrt gegen die Fassung ohne Deckelung, die bei
//                           einem zu grossen Stapel den vollen Rumpf schickt
//                           und damit rot werden MUSS
//
// Kein Foundry noetig. Die Methode ist rein: kein Netz, keine Warteschlange,
// keine Uhr.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { extractMethod, extractConst, buildProbe } from "../lib/extract-method.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, "..", "..", "scripts", "beneos_analytics.js")
const text = readFileSync(SOURCE, "utf8")

// NACHBAU der Fassung ohne Deckelung, wie sie vor 3dddd13 galt: sendBeacon
// bekam den vollen Rumpf, es gab keine Halbierung.
const ALT_IMPLEMENTATION = `
  static _fitKeepalive(batch, maxBytes = KEEPALIVE_MAX_BYTES) {
    void maxBytes
    return { sendCount: batch.length, sendBody: JSON.stringify({ events: batch }) }
  }
`

const useAlt = process.argv.includes("--alt")
const prelude = extractConst(text, "KEEPALIVE_MAX_BYTES")
const Probe = buildProbe(
  [useAlt ? ALT_IMPLEMENTATION : extractMethod(text, "_fitKeepalive", { maxZeilen: 20 })],
  prelude
)

// Der echte Deckel, aus derselben Quelle gelesen statt abgeschrieben.
const MAX = new Function(`${prelude} return KEEPALIVE_MAX_BYTES`)()

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? "OK  " : "FAIL"} ${name}` + (ok ? "" : `\n       erwartet ${JSON.stringify(want)}\n       gemessen ${JSON.stringify(got)}`))
}
const bytes = s => new Blob([s]).size

// Ereignisse in realistischer Groesse. PAYLOAD_MAX kappt die Nutzlast eines
// Ereignisses bei 1000 Byte, ein Ereignis wiegt also rund ein Kilobyte.
const event = (i, fuellung = 900) => ({ t: "probe", i, p: "x".repeat(fuellung) })

// 1) Ein kleiner Stapel geht unveraendert durch. Die haeufigste Lage, und die
//    Deckelung darf sie nicht anfassen.
{
  const batch = Array.from({ length: 5 }, (_, i) => event(i))
  const r = Probe._fitKeepalive(batch, MAX)
  check("1 kleiner Stapel, alle Ereignisse", r.sendCount, 5)
  check("1 kleiner Stapel, Rumpf passt", bytes(r.sendBody) <= MAX, true)
  check("1 kleiner Stapel, Rumpf traegt genau diese fuenf", JSON.parse(r.sendBody).events.length, 5)
}

// 2) Ein Stapel ueber dem Deckel muss schrumpfen, nicht verloren gehen.
{
  const batch = Array.from({ length: 100 }, (_, i) => event(i))
  const voll = bytes(JSON.stringify({ events: batch }))
  check("2 Vorbedingung, der volle Rumpf ist zu gross", voll > MAX, true)
  const r = Probe._fitKeepalive(batch, MAX)
  check("2 grosser Stapel, Rumpf passt jetzt", bytes(r.sendBody) <= MAX, true)
  check("2 grosser Stapel, es bleibt etwas uebrig zum Senden", r.sendCount > 0, true)
  check("2 grosser Stapel, es wurde wirklich gekuerzt", r.sendCount < batch.length, true)
  check("2 grosser Stapel, sendCount und Rumpf sagen dasselbe", JSON.parse(r.sendBody).events.length, r.sendCount)
}

// 3) Ein einzelnes Ereignis ueber dem Deckel kann nicht schrumpfen. Es darf
//    trotzdem nicht in eine Endlosschleife laufen.
{
  const batch = [event(0, MAX * 2)]
  const r = Probe._fitKeepalive(batch, MAX)
  check("3 ein zu grosses Ereignis, sendCount bleibt 1", r.sendCount, 1)
}

// 4) Leerer Stapel.
{
  const r = Probe._fitKeepalive([], MAX)
  check("4 leerer Stapel, sendCount 0", r.sendCount, 0)
  check("4 leerer Stapel, Rumpf ist gueltiges JSON", JSON.parse(r.sendBody).events.length, 0)
}

// 5) Der Standardwert greift, wenn kein Deckel uebergeben wird. Ohne diese
//    Probe waere genau der Weg ungeprueft, den der Produktivcode nimmt.
{
  const batch = Array.from({ length: 100 }, (_, i) => event(i))
  const r = Probe._fitKeepalive(batch)
  check("5 ohne Argument greift der Standarddeckel", bytes(r.sendBody) <= MAX, true)
}

console.log(fails ? `\n${fails} FEHLSCHLAEGE` : `\nalle Proben bestanden${useAlt ? " (das waere ein Befund, siehe README)" : ""}`)
process.exit(fails ? 1 : 0)
