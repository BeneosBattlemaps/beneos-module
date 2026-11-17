/**
 * install-nachspiel.test.mjs
 *
 * Gegenprobe zu MO-021 und MO-022, ohne Foundry (Attrappen fuer die Globals):
 *
 *   node --test scripts/cloud-v2/install-nachspiel.test.mjs
 *
 * Nach einer Installation zeichnet das offene Cloud-Fenster die Releasekarte
 * neu, und beneos.releaseInstalled geht raus (Static-Switch-Cache, Tour).
 *  - MO-021: der ZIP-Import tat keines von beiden, auch nicht nach seinem Retry.
 *  - MO-022: der delegierte Weg (POI, Journal) baute ein nie gerendertes
 *    Fenster, das sich ins Register game.beneos.cloudWindowV2 schrieb; das
 *    offene Fenster wurde nicht aufgefrischt und verlor seinen Registerplatz.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { zipSync, strToU8 } from "../lib/fflate.module.js"

const stub = class {}
for (const n of ["FormApplication", "Application", "Dialog"]) globalThis[n] ??= stub
globalThis.foundry ??= { utils: { randomID: () => "x".repeat(16), mergeObject: (a, b) => ({ ...a, ...b }) }, applications: { api: { ApplicationV2: stub, HandlebarsApplicationMixin: (c) => c, DialogV2: stub } } }
globalThis.game ??= { settings: { get: () => null, set: async () => {} }, i18n: { localize: (k) => k, format: (k) => k }, user: { isGM: true } }
globalThis.ui ??= { notifications: { info() {}, warn() {}, error() {} } }
globalThis.window ??= globalThis
globalThis.document ??= { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } }

const signale = []
globalThis.Hooks = { on() {}, once() {}, callAll: (name, data) => { signale.push({ name, data }) } }

const { BeneosNativeBattlemapInstaller: Installer } = await import("./beneos-native-installer.mjs")
const { BeneosZipImporter } = await import("./beneos-zip-importer.mjs")
const api = await import("./beneos-release-install-api.mjs")

/** Das Cloud-Fenster, das der Kunde gerade offen hat. */
function offenesFenster() {
  const w = { rendered: true, renders: [], render(opts) { this.renders.push(opts) } }
  game.beneos = { cloudWindowV2: w }
  return w
}

test("MO-021: ZIP-Import frischt das offene Fenster auf und meldet die Installation", async () => {
  const fenster = offenesFenster()
  signale.length = 0
  const echt = Installer.prototype.run
  Installer.prototype.run = async function () { this._importedScenes = [{ id: "sz1" }]; this.ausgang = "fertig" }
  try {
    const bytes = zipSync({ "data/Scene.json": strToU8("[]") })
    await BeneosZipImporter.importFile({ name: "bm_zip_test.zip", arrayBuffer: async () => bytes.buffer })
  } finally { Installer.prototype.run = echt }
  const hook = signale.filter(s => s.name === "beneos.releaseInstalled")
  assert.equal(hook.length, 1, "kein beneos.releaseInstalled nach dem ZIP-Import")
  assert.equal(hook[0].data.releaseDir, "bm_zip_test")
  assert.deepEqual(hook[0].data.sceneIds, ["sz1"])
  assert.deepEqual(fenster.renders, [{ parts: ["results"] }], "Releasekarte im offenen Fenster nicht neu gezeichnet")
})

test("MO-022: der delegierte Weg installiert ueber das offene Fenster und laesst das Register stehen", async () => {
  const fenster = offenesFenster()
  let lief = null
  class Win {
    constructor() { this.rendered = false; game.beneos.cloudWindowV2 = this }
    static async _onCloudBattlemapInstallNative() { lief = this }
  }
  globalThis.BeneosCloudWindowV2 = Win
  Object.setPrototypeOf(fenster, Win.prototype)
  fenster._releaseIndex = new Map([["bm_0042", { release_dir: "bm_0042" }]])
  try {
    await api.runNativeReleaseInstall("bm_0042", [{ release_dir: "bm_0042" }])
  } finally { delete globalThis.BeneosCloudWindowV2 }
  assert.equal(game.beneos.cloudWindowV2, fenster, "Register zeigt nicht mehr auf das offene Fenster")
  assert.equal(lief, fenster, "Installation lief ueber ein unsichtbares Fenster")
})

test("MO-022: ohne offenes Fenster installiert ein Hilfsfenster und gibt das Register zurueck", async () => {
  game.beneos = { cloudWindowV2: undefined }
  let lief = null
  let imRegister = null
  class Win {
    constructor() { this.rendered = false; game.beneos.cloudWindowV2 = this }
    static async _onCloudBattlemapInstallNative() {
      lief = this
      // Waehrend des Laufs gemerkt; ein assert hier wuerde delegate() verschlucken.
      imRegister = game.beneos.cloudWindowV2 === this
    }
  }
  globalThis.BeneosCloudWindowV2 = Win
  try {
    await api.runNativeReleaseInstall("bm_0042", [{ release_dir: "bm_0042" }])
  } finally { delete globalThis.BeneosCloudWindowV2 }
  assert.ok(lief instanceof Win)
  assert.equal(lief._releaseIndex.get("bm_0042").release_dir, "bm_0042")
  assert.equal(game.beneos.cloudWindowV2, undefined, "unsichtbares Hilfsfenster bleibt im Register")
  assert.equal(imRegister, false, "Hilfsfenster sitzt waehrend des Laufs im Register, der Nachlauf findet das offene Fenster nicht")
})

test("MO-022: offenes Fenster ohne geladene Liste, Hilfsfenster installiert, Register bleibt beim offenen", async () => {
  const fenster = offenesFenster()
  let lief = null
  class Win {
    constructor() { this.rendered = false; game.beneos.cloudWindowV2 = this }
    static async _onCloudBattlemapInstallNative() { lief = this }
  }
  globalThis.BeneosCloudWindowV2 = Win
  Object.setPrototypeOf(fenster, Win.prototype)
  fenster._releaseNeedsLogin = true
  try {
    await api.runNativeReleaseInstall("bm_0042", [{ release_dir: "bm_0042" }])
  } finally { delete globalThis.BeneosCloudWindowV2 }
  assert.notEqual(lief, fenster, "Fenster ohne Index haette das Release nicht gefunden")
  assert.equal(lief._releaseIndex.get("bm_0042").release_dir, "bm_0042")
  assert.equal(game.beneos.cloudWindowV2, fenster)
})

test("MO-022: zwei ueberlappende delegierte Laeufe hinterlassen kein Hilfsfenster im Register", async () => {
  game.beneos = { cloudWindowV2: undefined }
  const freigaben = []
  class Win {
    constructor() { this.rendered = false; game.beneos.cloudWindowV2 = this }
    static _onCloudBattlemapInstallNative() { return new Promise(r => freigaben.push(r)) }
  }
  globalThis.BeneosCloudWindowV2 = Win
  try {
    const a = api.runNativeReleaseInstall("bm_0001", [{ release_dir: "bm_0001" }])
    await new Promise(r => setImmediate(r))
    const b = api.runNativeReleaseInstall("bm_0002", [{ release_dir: "bm_0002" }])
    await new Promise(r => setImmediate(r))
    assert.equal(freigaben.length, 2)
    freigaben[0](); await a
    freigaben[1](); await b
  } finally { delete globalThis.BeneosCloudWindowV2 }
  assert.equal(game.beneos.cloudWindowV2, undefined)
})
