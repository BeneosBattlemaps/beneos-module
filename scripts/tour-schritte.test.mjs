/**
 * tour-schritte.test.mjs
 *
 *   node scripts/tour-schritte.test.mjs
 *
 * Prueft, wie _localizeSteps in beneos_tours.js den Text eines Tour-Schritts
 * zusammensetzt: Title und Content aus der Sprachdatei, dazu ein Hinweis aus
 * dem Schluessel .Note, wenn die Sprache dort einen Text traegt.
 *
 * WARUM (MO-056)
 *
 * Elf Sprachen tragen im ersten Tour-Fenster den Satz "Diese Uebersetzung ist
 * automatisch, Fehler bitte auf Discord melden". Bis MO-056 stand er am Ende
 * von StartExplainer.Content und brachte Tags mit, die en dort nicht hat.
 * Damit war die Tag-Pruefung in tools/sprachschluessel.test.mjs fuer diesen
 * Schluessel dauerhaft rot. Der Satz steht deshalb in einem eigenen Schluessel
 * StartExplainer.Note: reiner Text, in en, de und ru leer, und der Code setzt
 * das <p><small> darum. Ein leerer Wert haengt nichts an, Foundry gibt ihn als
 * "" zurueck (v13 und V14, client/helpers/localization.mjs).
 *
 * Der echte Code wird aus der Quelle geschnitten, nicht nachgebaut, damit der
 * Test nicht von ihm wegdriftet. Beide Pfade stehen woertlich im new URL(),
 * damit tools/haken/betroffen.mjs die Pruefung bei Aenderungen an der Tour
 * und an lang/ waehlt (MO-049).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { extractMethod } from "../tools/lib/extract-method.mjs"

const QUELLE = fs.readFileSync(new URL("./beneos_tours.js", import.meta.url), "utf8")
const LANG = fileURLToPath(new URL("../lang/", import.meta.url))
const NOTE = "BENEOS.Tour.StartHere.StartExplainer.Note"
const OHNE_HINWEIS = ["de.json", "en.json", "ru.json"]

/** _localizeSteps mit einem game.i18n, das sich wie Foundrys localize/has verhaelt. */
function localizeSteps(uebersetzt, fallback = {}) {
  const wert = (k) => (typeof uebersetzt[k] === "string" ? uebersetzt[k] : fallback[k])
  const game = {
    i18n: {
      localize: (k) => (typeof wert(k) === "string" ? wert(k) : k),
      has: (k) => typeof wert(k) === "string",
    },
  }
  const rumpf = `${extractMethod(QUELLE, "_localizeSteps")}\nreturn _localizeSteps`
  return new Function("game", rumpf)(game)
}

const schritt = { id: "start-explainer", selector: "" }
const basis = {
  "BENEOS.Tour.StartHere.StartExplainer.Title": "T",
  "BENEOS.Tour.StartHere.StartExplainer.Content": "<p>C</p>",
}

test("ein Hinweis wird klein unter den Text gesetzt", () => {
  const [s] = localizeSteps({ ...basis, [NOTE]: "Automatisch." })("StartHere", [schritt])
  assert.equal(s.title, "T")
  assert.equal(s.content, "<p>C</p><p><small>Automatisch.</small></p>")
})

test("ein leerer Hinweis haengt nichts an", () => {
  const [s] = localizeSteps({ ...basis, [NOTE]: "" })("StartHere", [schritt])
  assert.equal(s.content, "<p>C</p>")
})

test("ein fehlender Hinweis haengt nichts an, auch nicht den Schluesselnamen", () => {
  const [s] = localizeSteps(basis)("StartHere", [schritt])
  assert.equal(s.content, "<p>C</p>")
})

test("die Sprachdateien tragen den Hinweis nur dort, wo er hingehoert", () => {
  const falsch = []
  for (const datei of fs.readdirSync(LANG).filter((f) => f.endsWith(".json")).sort()) {
    const werte = JSON.parse(fs.readFileSync(path.join(LANG, datei), "utf8"))
    const note = werte[NOTE]
    const leer = OHNE_HINWEIS.includes(datei)
    if (typeof note !== "string") falsch.push(`${datei}: ${NOTE} fehlt`)
    else if (leer && note !== "") falsch.push(`${datei}: Hinweis muss leer sein`)
    else if (!leer && note.trim() === "") falsch.push(`${datei}: Hinweis fehlt`)
    else if (/</.test(note)) falsch.push(`${datei}: Hinweis traegt Tags, das <small> setzt der Code`)
    if (/<small>/.test(werte["BENEOS.Tour.StartHere.StartExplainer.Content"] ?? "")) {
      falsch.push(`${datei}: Hinweis steht noch in StartExplainer.Content`)
    }
  }
  assert.deepEqual(falsch, [])
})
