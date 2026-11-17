/**
 * install-ausgang.test.mjs
 *
 * Gegenprobe zu MO-020, ohne Foundry (Attrappen fuer die Globals):
 *
 *   node --test scripts/cloud-v2/install-ausgang.test.mjs
 *
 * Scheitert die Vorabpruefung der Schreibrechte, installiert der Lauf nichts.
 * Bisher kehrte install() trotzdem "normal" zurueck, und der Nachlauf meldete
 * beneos.releaseInstalled, bei Getting Started samt Tour-Start. Hier laeuft der
 * ECHTE run() mit einer ZIP-Quelle bis zur Vorabpruefung; nur die Dateiablage
 * (FilePicker) und das Fortschrittsfenster sind Attrappen.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

const stub = class {}
for (const n of ["FormApplication", "Application", "Dialog"]) globalThis[n] ??= stub
globalThis.foundry ??= { utils: { randomID: () => "x".repeat(16), mergeObject: (a, b) => ({ ...a, ...b }) }, applications: { api: { ApplicationV2: stub, HandlebarsApplicationMixin: (c) => c, DialogV2: stub } } }
globalThis.game ??= { settings: { get: () => null }, i18n: { localize: (k) => k, format: (k) => k }, scenes: { get: () => null } }
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} }
globalThis.ui ??= { notifications: { info() {}, warn() {}, error() {} } }
globalThis.window ??= globalThis
globalThis.document ??= { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } }

// Jede weitere Methode des Fensters ist hier ein No-op; "then" bleibt leer,
// sonst haelt await das Fenster fuer ein Promise.
const fortschritt = new Proxy({ fehlgeschlagen: 0, markFailed() { this.fehlgeschlagen++ } },
  { get: (t, k) => (k in t ? t[k] : (k === "then" ? undefined : () => {})) })
globalThis.BeneosBattlemapInstallProgress = { open: async () => fortschritt }

const { BeneosNativeBattlemapInstaller: Installer } = await import("./beneos-native-installer.mjs")

// Der Host verweigert das Anlegen von Ordnern: genau der Fall der Vorabpruefung.
const verweigert = { createDirectory: async () => { throw new Error("EACCES: permission denied") }, upload: async () => { throw new Error("EACCES: permission denied") } }

test("gescheiterte Vorabpruefung: Ausgang unterscheidbar, kein Nachlauf", async () => {
  globalThis.FilePicker = verweigert
  const echtWarn = console.warn, echtDebug = console.debug
  console.warn = () => {}; console.debug = () => {}
  try {
    let n = 0
    const inst = await Installer.install({
      packageId: "zip_vorpruefung",
      source: { kind: "zip", entries: new Map([["data/Scene.json", () => new TextEncoder().encode("[]")]]) },
      record: { releaseDir: "bm_9999" },
      nachLauf: () => { n++ },
    })
    assert.equal(fortschritt.fehlgeschlagen, 1, "die Vorabpruefung muss den Lauf hier beenden")
    assert.equal(n, 0, "Nachlauf nach gescheiterter Vorabpruefung: Hook und Tour ohne Installation")
    assert.equal(inst.ausgang, "vorpruefung")
  } finally { console.warn = echtWarn; console.debug = echtDebug }
})
