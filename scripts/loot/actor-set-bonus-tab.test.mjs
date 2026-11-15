/**
 * EIN FEHLER IM ASYNCHRONEN `_inject` AM AKTEURSBLATT KOMMT ALS WARNUNG AN,
 * NICHT ALS UNBEHANDELTE ABLEHNUNG (stre-T-113).
 *
 * `ActorSetBonusTab._inject` ist `async` und wird im Render-Haken ohne `await`
 * gerufen. Das `try/catch` dort faengt nur synchrone Wuerfe. Ohne `.catch` am
 * Aufruf wurde ein Fehler darin eine unbehandelte Ablehnung: kein Beneos-Tab
 * am Blatt, und in der Konsole keine Warnung, die ihn erklaert. Gemessen vor
 * dem Fix: unbehandelt 1, Warnungen 0. Dasselbe Muster schloss stre-T-112 am
 * Gegenstandsblatt (`item-sheet-extender.test.mjs`).
 *
 * DIESER SATZ FAEHRT DEN ECHTEN HAKEN. Er laedt `actor-set-bonus-tab.mjs` mit
 * der Foundry-Attrappe (`tools/lib/foundry-attrappe.mjs`), ruft `register()`
 * und feuert den Haken mit einem gestellten Blatt. `_inject` selbst ist ein
 * Spion: was das echte `_inject` im Blatt tut, prueft dieser Satz nicht.
 * Jede Probe ist im Sabotagelaeufer (`tools/stream-sabotagen.mjs`, Satz
 * `bonustab`) bewacht.
 *
 * Lauf:  node scripts/loot/actor-set-bonus-tab.test.mjs
 */

import { pruefstand, installiereFoundry, haken } from "../../tools/lib/foundry-attrappe.mjs"

const p = pruefstand("actor-set-bonus-tab: Fehler aus dem async _inject am echten Haken")
installiereFoundry({ einstellungen: {} })
globalThis.HTMLElement ??= class {}

const { ActorSetBonusTab } = await import("./actor-set-bonus-tab.mjs")

// Gezaehlt wird nur, was register() dazubringt.
haken.liste.length = 0
await ActorSetBonusTab.register()
const HAKEN = "renderCharacterActorSheet"

/** Ein gestelltes Charakterblatt; der Spion liest es nicht. */
const blatt = () => ({ actor: { type: "character", documentName: "Actor" } })
const wurzel = () => new globalThis.HTMLElement()

// ===========================================================================
p.abschnitt("Der Haken faengt den Fehler des asynchronen _inject")

/*
 * Ablauf wie in stre-T-112: erst die Ablehnungen frueherer Proben zustellen
 * lassen, dann zaehlen. Gegenwert: ein intaktes `_inject` meldet nichts.
 */
const echtesInject = ActorSetBonusTab._inject
const echteWarnung = console.warn
const warnungen = []
let gerufen = 0
let letzteArgs = []
let unbehandelt = 0
const zaehleUnbehandelt = () => { unbehandelt++ }
process.on("unhandledRejection", zaehleUnbehandelt)
const zweiTakte = async () => {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}
async function asyncLauf(inject) {
  await zweiTakte()
  ActorSetBonusTab._inject = async (...a) => { gerufen++; letzteArgs = a; return inject(...a) }
  gerufen = 0
  letzteArgs = []
  unbehandelt = 0
  warnungen.length = 0
  const gegebenesBlatt = blatt()
  const gegebeneWurzel = wurzel()
  console.warn = (...a) => { warnungen.push(a.map(String).join(" ")) }
  try {
    await haken.rufe(HAKEN, gegebenesBlatt, gegebeneWurzel)
    await zweiTakte()
  } finally {
    console.warn = echteWarnung
  }
  return {
    gerufen,
    // Ohne die Wurzel stiege das echte `_inject` still aus: kein Tab, keine Warnung.
    weitergegeben: letzteArgs[0] === gegebenesBlatt && letzteArgs[1] === gegebeneWurzel,
    unbehandelt,
    alle: warnungen.length,
    gemeldet: warnungen.filter((w) => w.includes("ActorSetBonusTab inject failed")).length,
  }
}

const wirft = await asyncLauf(async () => { throw new Error("Pruefsatz wirft im async _inject") })
p.gleich("der Haken ruft _inject", wirft.gerufen, 1)
p.gleich("und gibt Blatt und Wurzel des Blattes weiter", wirft.weitergegeben, true)
p.gleich("ein Wurf im async _inject wird keine unbehandelte Ablehnung", wirft.unbehandelt, 0)
p.gleich("ein Wurf im async _inject wird genau einmal als Warnung gemeldet", wirft.alle === 1 && wirft.gemeldet === 1, true)

const heil = await asyncLauf(async () => {})
// Der Gegenwert zaehlt nur, wenn das intakte `_inject` wirklich lief.
p.gleich("der Haken ruft auch das intakte _inject", heil.gerufen, 1)
p.gleich("ein intaktes async _inject meldet keine Warnung", heil.alle, 0)
p.gleich("und hinterlaesst keine unbehandelte Ablehnung", heil.unbehandelt, 0)
process.off("unhandledRejection", zaehleUnbehandelt)

ActorSetBonusTab._inject = echtesInject

/*
 * NICHT PRUEFBAR AN DIESEM SATZ:
 *
 * - DASS DER HAKEN IM ECHTEN FOUNDRY FEUERT. Hier feuert die Attrappe, was
 *   der Satz ihr sagt.
 * - WELCHE FEHLER DAS ECHTE `_inject` IM BLATT WIRFT. Dass ein Fehler darin
 *   als Warnung ankommt, zeigt ein werfender Spion; ob einer entsteht,
 *   entscheidet ein laufendes Foundry.
 */

p.ende()
