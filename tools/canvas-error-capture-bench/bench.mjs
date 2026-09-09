// Prueft, welche Fehler die Erfassung behaelt, welche sie verwirft, und was
// dabei nach draussen geht. Aus scripts/beneos_analytics.js.
//
// Hintergrund: Foundry wirft diese Fehlerart nicht, es WICKELT sie ein.
// Hooks.onError baut `new Error(msg, { cause: original })` und feuert erst
// danach den Hook. Unser Faenger prueft den Stack der Huelle, in dem nur
// foundry.js steht. Der Stack, der den Verursacher nennt, liegt in `cause`.
//
// Am 09.09.2026 im Lake gezaehlt: ueber 3.150 Fehlerereignisse, davon NULL
// mit einem gescheiterten Zeichenvorgang der Primaergruppe. Nicht weil es
// nicht vorkommt, sondern weil wir es nie sehen konnten.
//
// Aufruf:
//   node bench.mjs          faehrt gegen den aktuellen Code
//   node bench.mjs --alt    faehrt gegen die Fassung vor dem Fix und muss
//                           rot werden
//
// Kein Foundry noetig. Der Entscheidungsweg wird GESCHNITTEN, nicht
// nachgebaut: _hookErrorReason ist genau dafuer eine eigene Funktion.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { extractMethod, extractConst, buildProbe } from "../lib/extract-method.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, "..", "..", "scripts", "beneos_analytics.js")
const text = readFileSync(SOURCE, "utf8")

// NACHBAU der Fassung vor dem Fix: sie sah nur den aeussersten Stack, kannte
// `cause` nicht, verlangte im Hook-Zweig ein "beneos" in der location, und
// kuerzte nur ab `modules/beneos-module`. Ausdruecklich Nachbau, kein Zitat.
const ALT = `
  static _stackChain(err, maxLinks = ERROR_CAUSE_MAX_LINKS) {
    void maxLinks
    return err && err.stack ? [String(err.stack)] : []
  }
  static _isBeneosError(err, filename) {
    return this._isBeneosStack(err && err.stack ? err.stack : "", filename)
  }
  static _hookErrorReason(err, location) {
    const loc = String(location || "")
    return (this._isBeneosError(err) || /beneos/i.test(loc)) ? "beneos" : null
  }
  static _canvasBudgetLeft() { return true }
  static _stackTopLine(err) {
    const lines = String(err && err.stack ? err.stack : "").split("\\n").map(l => l.trim()).filter(Boolean)
    let line = lines.find(l => l.includes("beneos-module")) || lines[1] || lines[0] || ""
    const idx = line.indexOf("modules/beneos-module")
    if (idx >= 0) line = line.slice(idx)
    return line.replace(/[)(]/g, "").slice(0, 255)
  }
`

const useAlt = process.argv.includes("--alt")

const prelude = [
  extractConst(text, "ERROR_CAUSE_MAX_LINKS"),
  extractConst(text, "CANVAS_DRAW_LOCATION"),
  extractConst(text, "CANVAS_ERRORS_PER_SESSION"),
].join("\n")

const unveraendert = [
  extractMethod(text, "_isBeneosStack", { maxZeilen: 10 }),
  extractMethod(text, "_splitStackPackages", { maxZeilen: 14 }),
  extractMethod(text, "sanitize", { maxZeilen: 12 }),
  extractMethod(text, "_kuerzeStackZeile", { maxZeilen: 12 }),
]
const geaendert = useAlt ? [ALT] : [
  extractMethod(text, "_stackChain", { maxZeilen: 24 }),
  extractMethod(text, "_isBeneosError", { maxZeilen: 6 }),
  extractMethod(text, "_hookErrorReason", { maxZeilen: 10 }),
  extractMethod(text, "_canvasBudgetLeft", { maxZeilen: 8 }),
  extractMethod(text, "_stackTopLine", { maxZeilen: 26 }),
]

const Probe = buildProbe([...unveraendert, ...geaendert, "  static _canvasErrorsSent = 0"], prelude)
const GRENZE = new Function(`${prelude} return CANVAS_ERRORS_PER_SESSION`)()

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? "OK  " : "FAIL"} ${name}` + (ok ? "" : `\n       erwartet ${JSON.stringify(want)}\n       gemessen ${JSON.stringify(got)}`))
}

// Stacks in der Form, die Chrome erzeugt: Zeile 0 ist die Meldung.
const stack = (...rahmen) => ["Error: irgendwas", ...rahmen.map(r => `    at ${r}`)].join("\n")
const FREMD = stack("Object.foo (https://vtt.mueller-familie.de:30000/modules/schuldig/main.js:12:9)")
const EIGEN = stack("BeneosCloud.bar (https://vtt.mueller-familie.de:30000/modules/beneos-module/scripts/beneos_cloud.js:7:1)")
// Ein Rahmen im Foundry-Kern: hier steht KEIN modules/, und genau hier blieb
// der Wirt frueher stehen. Auf The Forge ist die Unterdomaene der Kundenname.
const KERN  = stack("PrimaryCanvasGroup.draw (https://kundenname.forge-vtt.com/scripts/foundry.mjs:112233:9)")
const HUELLE = stack("Hooks.onError (https://kundenname.forge-vtt.com/scripts/foundry.mjs:652:19)")

// Genau das, was Foundry baut, nachgelesen in hooks.mjs:184 der V14.
const eingewickelt = (ursache, msg = "Failed drawing primary canvas group: Scene is not a valid embedded Document") => {
  const e = new Error(msg)
  e.stack = HUELLE
  e.cause = ursache
  return e
}
const roh = (s, msg = "kaputt") => { const e = new Error(msg); e.stack = s; return e }

// 1) DER KERN. Huelle ohne eigenen Rahmen, `cause` mit einem. Vorher verworfen.
{
  const e = eingewickelt(roh(EIGEN))
  check("1 eigener Fehler in der Huelle wird erkannt", Probe._isBeneosError(e), true)
  check("1 Grund ist beneos, nicht canvas", Probe._hookErrorReason(e, "Canvas#draw"), "beneos")
  check("1 auch bei einer harmlosen location", Probe._hookErrorReason(e, "SomethingElse"), "beneos")
}

// 2) Fremder Fehler in der Huelle. Nur wegen der location genommen, nicht
//    wegen der Herkunft. Das ist der Unterschied zwischen Absicht und
//    Sammelstelle.
{
  const e = eingewickelt(roh(FREMD))
  check("2 fremder Fehler gilt nicht als unserer", Probe._isBeneosError(e), false)
  check("2 bei Canvas#draw trotzdem genommen", Probe._hookErrorReason(e, "Canvas#draw"), "canvas")
}

// 3) GEGENPROBE. Ein gewoehnlicher Fremdfehler ohne Canvas-Bezug bleibt
//    draussen. Ohne diese Probe koennte die Aenderung unbemerkt zur
//    Sammelstelle fuer fremdes Rauschen werden.
{
  check("3 gewoehnlicher Fremdfehler bleibt draussen", Probe._hookErrorReason(roh(FREMD), "Actor#update"), null)
  check("3 auch eingewickelt, solange die location eine andere ist",
    Probe._hookErrorReason(eingewickelt(roh(FREMD)), "Actor#update"), null)
  check("3 leere location aendert daran nichts", Probe._hookErrorReason(roh(FREMD), ""), null)
}

// 4) Die Kette terminiert. `cause` ist das, was der Werfer hineingelegt hat.
{
  const a = roh(HUELLE), b = roh(FREMD)
  a.cause = b; b.cause = a
  check("4 Zyklus terminiert", Probe._stackChain(a).length <= 3, true)
  check("4 Zyklus liefert trotzdem Stapel", Probe._stackChain(a).length >= 2, true)

  let tief = roh(EIGEN)
  for (let i = 0; i < 10; i++) { const n = roh(HUELLE); n.cause = tief; tief = n }
  check("4 zehn Glieder werden auf drei gedeckelt", Probe._stackChain(tief).length, 3)
  check("4 und tiefer als drei sehen wir bewusst nicht", Probe._isBeneosError(tief), false)
}

// 5) stack_top_line nennt die Zeile aus `cause`, nicht die aus der Huelle,
//    und traegt weder Wirt noch Port. Der Wirt ist der Punkt: das Feld geht
//    ungefiltert in die Telemetrie, und auf The Forge IST die Unterdomaene
//    der Name des Kunden.
{
  const eigen = Probe._stackTopLine(eingewickelt(roh(EIGEN)))
  check("5 eigener Rahmen gewinnt", /beneos-module/.test(eigen), true)
  check("5 eigener Rahmen ohne Wirt", /mueller-familie|https?:/.test(eigen), false)

  const fremd = Probe._stackTopLine(eingewickelt(roh(FREMD)))
  check("5 sonst der innerste Ursprung", /modules\/schuldig/.test(fremd), true)
  check("5 nicht die Huelle", /foundry\.mjs|hooks/.test(fremd), false)
  check("5 fremder Rahmen ohne Wirt", /mueller-familie|https?:/.test(fremd), false)

  // Der Fall ohne modules/: fruehere Fassungen liessen hier alles stehen.
  const kern = Probe._stackTopLine(eingewickelt(roh(KERN)))
  check("5 Kernrahmen ohne Wirt", /kundenname|forge-vtt\.com|https?:/.test(kern), false)
  check("5 Kernrahmen behaelt den Pfad", /foundry\.mjs/.test(kern), true)
}

// 6) Nur echte Rahmen. Die Meldungszeile ist Freitext von aussen und kann
//    einen Namen oder ein Zeichen tragen; sie darf nicht in das Feld und
//    schon gar nicht in den Drosselungsfingerabdruck.
{
  const ohneRahmen = roh("Error: token abcdefghijklmnopqrstuvwxyz0123456789 rejected for user Max Mustermann")
  const r = Probe._stackTopLine(eingewickelt(ohneRahmen))
  check("6 ein Stapel ohne Rahmen liefert nichts", r, "")
  check("6 und damit auch keinen Personennamen", /Mustermann/.test(r), false)
}

// 7) Der Deckel je Sitzung. Der Ausfall wiederholt sich stundenlang, und die
//    60-Sekunden-Drosselung haelt ihn nicht auf.
{
  let genommen = 0
  for (let i = 0; i < 20; i++) if (Probe._canvasBudgetLeft()) genommen++
  check("7 hoechstens drei Canvas-Ereignisse je Sitzung", genommen, GRENZE)
}

// 8) Die Zuschreibung wird sauber abgetrennt, in beiden Formen. Sie stammt
//    von libWrapper, nicht von Foundry, und fehlt deshalb oft ganz.
{
  const r = Probe._splitStackPackages(
    "Failed drawing primary canvas group: boom [Detected 2 packages: levels(3.2.0), beneos-module(14.4.8)]")
  check("8 Meldung ohne die Liste", r.message, "Failed drawing primary canvas group: boom")
  check("8 Liste in eigenem Feld", /levels\(3\.2\.0\)/.test(r.packages), true)
  check("8 die Einzahlform ebenfalls",
    /schuldig/.test(Probe._splitStackPackages("boom [Detected 1 package: schuldig(1.0)]").packages || ""), true)
  check("8 ohne Liste bleibt alles stehen", Probe._splitStackPackages("nur text").packages, null)
}

console.log(fails ? `\n${fails} FEHLSCHLAEGE` : `\nalle Proben bestanden${useAlt ? " (das waere ein Befund, siehe README)" : ""}`)
process.exit(fails ? 1 : 0)
