/**
 * release-alias-vergleich.test.mjs
 *
 * Gegenprobe zu MO-039, ohne Foundry (Attrappen fuer die Globals):
 *
 *   node --test scripts/cloud-v2/release-alias-vergleich.test.mjs
 *
 * Dreizehn Releases heissen seit dem 2026-09-14 anders (`bm_0057b` ->
 * `bm_9108`). Der Katalog fuehrt nur noch den neuen Namen, der Vermerk einer
 * Welt, die vorher installiert hat, weiter den alten. Zwei Stellen verglichen
 * beide roh:
 *
 *   Uninstaller  fand zum Altvermerk keine Katalogzeile und liess deshalb bei
 *                JEDER anderen Deinstallation die Dateien liegen.
 *   Installer    erkannte eine vom Kunden umbenannte Szene nicht als eigene
 *                und meldete beim Update eine Kennungs-Kollision.
 *
 * Je Stelle ein Wert, dessen Ergebnis sich aendern muss, und einer, dessen
 * Ergebnis gleich bleiben muss.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

// Der Install-Vermerk der Welt. Die Szene `szeneAlt` wurde unter dem alten
// Namen installiert, `szeneFremd` gehoert zu einem ANDEREN umbenannten Release.
const vermerk = {
  "bm_0057b_4K": { releaseDir: "bm_0057b", variant: "4K", sceneIds: ["szeneAlt"] },
  "bm_0042b_4K": { releaseDir: "bm_0042b", variant: "4K", sceneIds: ["szeneFremd"] },
}

const stub = class {}
for (const n of ["FormApplication", "Application", "Dialog"]) globalThis[n] ??= stub
globalThis.foundry ??= { utils: { randomID: () => "x".repeat(16), mergeObject: (a, b) => ({ ...a, ...b }) }, applications: { api: { ApplicationV2: stub, HandlebarsApplicationMixin: (c) => c, DialogV2: stub } } }
globalThis.game ??= { settings: { get: () => vermerk }, i18n: { localize: (k) => k, format: (k) => k }, scenes: { get: () => null } }
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} }
globalThis.ui ??= { notifications: { info() {}, warn() {}, error() {} } }
globalThis.window ??= globalThis
globalThis.document ??= { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } }

const { BeneosInstallState } = await import("./beneos-install-state.mjs")
const { istUnsereSzene } = await import("./beneos-native-installer.mjs")
const { paketOrdnerAusListe } = await import("./beneos-native-uninstaller.mjs")

// Eine Weltszene, die der Kunde umbenannt hat. `flag` ist der Merker
// packEmbedIds, wie ihn ein Install nach dem 2026-09-18 setzt.
function weltSzene(id, flag = null) {
  return { id, name: "Mein Wald", getFlag: (_m, k) => (k === "packEmbedIds" ? flag : undefined) }
}
const paketSzene = { _id: "x", name: "Forest A Horror 01" }

test("gleichesRelease: alter und neuer Name desselben Release sind gleich", () => {
  assert.equal(BeneosInstallState.gleichesRelease("bm_0057b", "bm_9108"), true)
  assert.equal(BeneosInstallState.gleichesRelease("beneos_bm_0057b_forest_a_horror", "bm_9108"), true)
})

test("gleichesRelease: zwei verschiedene Releases bleiben verschieden, leer ist nie gleich", () => {
  assert.equal(BeneosInstallState.gleichesRelease("bm_0042b", "bm_9108"), false)
  assert.equal(BeneosInstallState.gleichesRelease("bm_0112", "bm_0113"), false)
  assert.equal(BeneosInstallState.gleichesRelease("", ""), false)
  assert.equal(BeneosInstallState.gleichesRelease("bm_0112", "bm_0112"), true)
})

test("Installer: umbenannte Szene mit Altvermerk gehoert zum Release", () => {
  assert.equal(istUnsereSzene(weltSzene("szeneAlt"), paketSzene, "bm_9108"), true)
})

test("Installer: Merker mit altem Namen gehoert zum Release", () => {
  assert.equal(istUnsereSzene(weltSzene("ohneVermerk", { releaseDir: "bm_0057b" }), paketSzene, "bm_9108"), true)
})

test("Installer: Szene eines anderen umbenannten Release bleibt fremd", () => {
  assert.equal(istUnsereSzene(weltSzene("szeneFremd"), paketSzene, "bm_9108"), false)
  assert.equal(istUnsereSzene(weltSzene("ohneVermerk", { releaseDir: "bm_0042b" }), paketSzene, "bm_9108"), false)
})

const katalog = [
  { release_dir: "bm_9108", variant_dirs: { "4K": "beneos_bm_9108_forest_a_horror_4k", HD: "beneos_bm_9108_forest_a_horror_hd" } },
  { release_dir: "bm_0112", variant_dirs: { "4K": "beneos_bm_0112_4k" } },
]

test("Uninstaller: Altvermerk findet die Katalogzeile unter dem neuen Namen", () => {
  assert.equal(paketOrdnerAusListe(katalog, "bm_0057b", "HD"), "beneos_bm_9108_forest_a_horror_hd")
})

test("Uninstaller: fuehrt die Liste beide Schreibweisen, gewinnt die genaue", () => {
  const beide = [
    { release_dir: "bm_0057b", variant_dirs: { "4K": "ALT_4k" } },
    { release_dir: "bm_9108", variant_dirs: { "4K": "NEU_4k" } },
  ]
  assert.equal(paketOrdnerAusListe(beide, "bm_9108", "4K"), "NEU_4k")
  assert.equal(paketOrdnerAusListe(beide, "bm_0057b", "4K"), "ALT_4k")
})

test("Uninstaller: unbekannter Name findet nichts, nie umbenannter findet sich selbst", () => {
  assert.equal(paketOrdnerAusListe(katalog, "bm_0999x", "4K"), null)
  assert.equal(paketOrdnerAusListe(katalog, "bm_0112", "4K"), "beneos_bm_0112_4k")
})
