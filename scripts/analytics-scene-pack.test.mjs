// Prueft, mit welchem Releasenamen die Telemetrie eine Szene meldet (MO-038).
//
// Dreizehn Releases mit Buchstabensuffix tragen seit dem 2026-09-14 einen
// neuen Namen (`bm_0057b` -> `bm_9108`). Welten, die vorher installiert haben,
// fuehren im Install-State weiter den alten. `battlemap_pack` ging bis MO-038
// mit diesem alten Namen hinaus, und der Lake konnte die Szenenzeit keinem
// Asset zuordnen.
//
// Gelesen wird die Warteschlange, also das, was `track` und `_buildEvent`
// wirklich zum Versand legen. Ein Aufruf von `_scenePack` allein wuerde eine
// Sendestelle uebersehen, die den Wert anders bezieht.
//
// Ohne Foundry, ohne Netz. Aufruf aus der Wurzel: node scripts/analytics-scene-pack.test.mjs

import { test } from "node:test"
import assert from "node:assert/strict"

// Foundry-Globale, die die Importkette beim Laden braucht. Muster aus
// tools/pruefe-katalog-offline.mjs; geprueft wird keine davon.
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true })
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } }
const knoten = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
  appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {},
  querySelector: () => null, querySelectorAll: () => [], textContent: "", innerHTML: "",
})
globalThis.document = {
  createElement: knoten, createTextNode: knoten, head: knoten(), body: knoten(),
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
}
globalThis.window = globalThis
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
class Leer { constructor() {} static get defaultOptions() { return {} } }
for (const name of ["FormApplication", "Application", "Dialog", "FilePicker", "Actor", "Item", "Scene", "Token"]) {
  if (globalThis[name] === undefined) globalThis[name] = Leer
}
globalThis.Hooks = { on() {}, once() {}, callAll() {}, call() {} }
globalThis.CONFIG = {}
globalThis.foundry = {
  applications: { api: { ApplicationV2: Leer, HandlebarsApplicationMixin: (B) => B }, instances: {} },
  utils: {},
}

// Der Install-State der Welt: drei Installationen, je eine Szene.
//   alt   unter dem alten Namen, wie vor der Umbenennung vermerkt
//   lang  alter Name in der Langform mit Vorsatz, wie in aelteren Welten
//   neu   ein Release, das nie umbenannt wurde
const installState = {
  "bm_0057b_4K": { releaseDir: "bm_0057b", variant: "4K", sceneIds: ["szeneAlt"] },
  "lang_HD":     { releaseDir: "beneos_bm_0057c_forest_a_winter", variant: "HD", sceneIds: ["szeneLang"] },
  "bm_0112_4K":  { releaseDir: "bm_0112", variant: "4K", sceneIds: ["szeneUnbekannt"] },
}
globalThis.game = {
  i18n: { localize: (k) => k, format: (k) => k },
  settings: { get: () => installState, set() {} },
  modules: { get: () => null },
  user: { isGM: true },
  users: [],
  beneos: {},
}

const { BeneosAnalytics: A } = await import(new URL("./beneos_analytics.js", import.meta.url))
A.isEnabled = () => true
A.flush = () => {}

function szene(id) {
  return { id, background: { src: `beneos_assets/cloud/4k/ordner/${id}/${id}-4k_bm.webm` } }
}

// Eine Szene betreten und mit genug Spielzeit wieder verlassen; zurueck kommt
// das scene_time aus der Warteschlange.
function besuche(id) {
  A.queue.length = 0
  A._currentScene = null
  A.trackSceneActivate(szene(id))
  A._currentScene.ts -= 5 * 60 * 1000
  A._closeSceneTime()
  return A.queue.find(e => e.event_type === "scene_time")
}

test("Wert 1: alter Name wird beim Senden zum neuen", () => {
  const ev = besuche("szeneAlt")
  assert.ok(ev, "scene_time liegt nicht in der Warteschlange")
  assert.equal(ev.payload.battlemap_pack, "bm_9108")
})

test("Langform mit Vorsatz wird ebenfalls aufgeloest", () => {
  assert.equal(besuche("szeneLang").payload.battlemap_pack, "bm_9109")
})

test("Wert 2: ein nie umbenanntes Release bleibt wie es ist", () => {
  assert.equal(besuche("szeneUnbekannt").payload.battlemap_pack, "bm_0112")
})

test("Szene ohne Vermerk sendet kein battlemap_pack", () => {
  const ev = besuche("szeneOhneVermerk")
  assert.ok(ev, "scene_time liegt nicht in der Warteschlange")
  assert.equal("battlemap_pack" in ev.payload, false)
})

test("scene_activate traegt denselben aufgeloesten Namen", async () => {
  A.queue.length = 0
  A._distinctScenes.clear()
  A.trackSceneActivate(szene("szeneAlt"))
  // scene_activate wird erst gelegt, wenn crypto.subtle die Szenenkennung
  // gehasht hat, und das laeuft im Threadpool. Gewartet wird deshalb ueber
  // Zeit und nicht ueber eine Zahl von Runden: unter Last braucht der Hash
  // mehr Runden, und ein Rundenbudget meldete dann einen Fehler, den es nicht
  // gab (Kalt-Review MO-038, 56 von 2314 Laeufen). Gesucht wird gezielt die
  // eigene Szene, damit ein verspaetetes Ereignis eines anderen Falls nicht
  // zaehlt.
  let ev
  for (const ende = Date.now() + 5000; !ev && Date.now() < ende;) {
    await new Promise(r => setTimeout(r, 1))
    ev = A.queue.find(e => e.event_type === "scene_activate" && e.payload.battlemap_key === "szeneAlt")
  }
  assert.ok(ev, "scene_activate liegt nicht in der Warteschlange")
  assert.equal(ev.payload.battlemap_pack, "bm_9108")
})
