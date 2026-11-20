/**
 * DER KODEX-REITER HAENGT AN BEIDEN BOGENFORMEN, ABER NUR EINMAL (stre-T-156).
 *
 * Am 08.11.2026 fiel der Haken `renderActorSheet` weg, gemessen unter dnd5e
 * 5.3.3, wo er null mal feuert. pf2e 7.12.2 baut seine Boegen aber im alten
 * Format (V1), und dort ruft Foundry genau diesen Haken und nicht
 * `renderActorSheetV2`. Eine pf2e-Kreatur hatte damit keinen Kodex-Reiter
 * mehr (Kalt-Review zu 1484674, W1). Betreiberentscheid 20.11.2026: der
 * V1-Einstieg bleibt.
 *
 * Zwei Werte, die sich unterscheiden muessen:
 * - ein V1-Bogen bekommt am `renderActorSheet` genau einen Reiter,
 * - ein V2-Bogen bekommt dort keinen, denn ihn bedient `renderActorSheetV2`.
 * Dazu: der V2-Weg in beneos_module.js haengt weiter genau einen Reiter an,
 * ein zweiter Render keinen zweiten, und eine fremde Kreatur keinen.
 *
 * DIESER SATZ FAEHRT DEN ECHTEN CODE. Haken und `haengeKodexReiter` werden aus
 * dem Quelltext geschnitten (`tools/lib/extract-method.mjs`), weil beide
 * Dateien Foundry-Module hereinziehen, die Node nicht laden kann. Jede Probe
 * ist im Sabotagelaeufer (`tools/stream-sabotagen.mjs`, Satz `kodexreiter`)
 * bewacht.
 *
 * Lauf:  node scripts/codex2/codex-sheet-wiring.test.mjs
 */

import { readFileSync } from "node:fs"
import { pruefstand } from "../../tools/lib/foundry-attrappe.mjs"
import { extractHaken, extractMethod } from "../../tools/lib/extract-method.mjs"

const p = pruefstand("codex-sheet-wiring: Kodex-Reiter an V1- und V2-Boegen")

const VERDRAHTUNG = readFileSync(new URL("./codex-sheet-wiring.mjs", import.meta.url), "utf8")
const MODUL = readFileSync(new URL("../beneos_module.js", import.meta.url), "utf8")

class ApplicationV2 {}

/** Ein Bogen mit einer Navigationsleiste, die ihre Kinder zaehlt. */
function bogen({ v2 = false, beneos = true } = {}) {
  const kinder = []
  const nav = {
    kinder,
    appendChild: (k) => { kinder.push(k) },
    querySelector: (sel) => (sel === ".beneos-sheet-codex-tab"
      ? kinder.find((k) => String(k.className).split(" ").includes("beneos-sheet-codex-tab")) ?? null
      : null),
  }
  const wurzel = { querySelector: (sel) => (sel.startsWith("nav.tabs") || sel === ".sheet-tabs" ? nav : null) }
  const actor = { name: "Kreatur", beneos }
  const sheet = v2 ? Object.assign(new ApplicationV2(), { document: actor }) : { actor }
  return { sheet, wurzel, nav }
}

const element = () => ({
  className: "", dataset: {}, innerHTML: "",
  setAttribute() {}, addEventListener() {},
})

/** Der Namensbereich der geschnittenen Stuecke. */
const bereich = () => ({
  foundry: { applications: { api: { ApplicationV2 } } },
  BeneosUtility: { checkIsBeneosToken: (a) => a?.beneos === true },
  game: { i18n: { localize: (k) => k }, beneos: { codex: { openForActor() {} } } },
  document: { createElement: element },
  HTMLElement: class {},
  console,
})

/** Schneidet und bindet; misslingt es, liefert er null und die Proben werden rot. */
function schnitt(quelle, haken, kennung, mitReiter) {
  try {
    const teile = []
    if (mitReiter) teile.push(extractMethod(VERDRAHTUNG, "haengeKodexReiter", { minZeilen: 5, maxZeilen: 60 }).replace(/^export /, ""))
    const fn = extractHaken(quelle, haken, { kennung })
    const b = bereich()
    return new Function(...Object.keys(b), `${teile.join("\n")}\nreturn (${fn})`)(...Object.values(b))
  } catch (e) {
    console.log(`  Schnitt ${haken} misslang: ${e.message}`)
    return null
  }
}

/** Rendert einen Bogen n mal und zaehlt die Reiter. */
function reiter(fn, form, mal = 1) {
  if (typeof fn !== "function") return -1
  const b = bogen(form)
  for (let i = 0; i < mal; i++) fn(b.sheet, [b.wurzel])
  return b.nav.kinder.filter((k) => String(k.className).includes("beneos-sheet-codex-tab")).length
}

// ===========================================================================
p.abschnitt("V1-Haken renderActorSheet in codex-sheet-wiring.mjs")
const v1 = schnitt(VERDRAHTUNG, "renderActorSheet", "haengeKodexReiter", true)
p.struktur("ein V1-Bogen einer Beneos-Kreatur bekommt genau einen Reiter", reiter(v1, { v2: false }), 1)
p.struktur("ein V2-Bogen bekommt am renderActorSheet keinen Reiter", reiter(v1, { v2: true }), 0)
p.struktur("ein zweiter Render haengt keinen zweiten Reiter an", reiter(v1, { v2: false }, 2), 1)
p.struktur("eine fremde Kreatur bekommt keinen Reiter", reiter(v1, { v2: false, beneos: false }), 0)

p.abschnitt("V2-Haken renderActorSheetV2 in beneos_module.js")
const v2 = schnitt(MODUL, "renderActorSheetV2", "haengeKodexReiter", true)
p.struktur("ein V2-Bogen einer Beneos-Kreatur bekommt am V2-Haken genau einen Reiter", reiter(v2, { v2: true }), 1)

p.ende()
