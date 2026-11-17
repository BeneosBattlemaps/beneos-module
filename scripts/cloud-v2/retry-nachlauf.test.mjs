/**
 * retry-nachlauf.test.mjs
 *
 * Gegenprobe zu MO-012, ohne Foundry (Attrappen fuer die Globals):
 *
 *   node --test scripts/cloud-v2/retry-nachlauf.test.mjs
 *
 * Der Retry im Bericht ruft install({ ...this._aufruf }) erneut auf. Was das
 * Cloud-Fenster nach einer Installation tut (Releasekarte neu zeichnen, Hook
 * beneos.releaseInstalled), lief bisher nur hinter seinem eigenen Aufruf und
 * fehlte nach einem Retry. Der Nachlauf reist deshalb in _aufruf mit und wird
 * von install() selbst gerufen, bei jedem Lauf.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

const stub = class {}
for (const n of ["FormApplication", "Application", "Dialog"]) globalThis[n] ??= stub
globalThis.foundry ??= { utils: { randomID: () => "x".repeat(16), mergeObject: (a, b) => ({ ...a, ...b }) }, applications: { api: { ApplicationV2: stub, HandlebarsApplicationMixin: (c) => c, DialogV2: stub } } }
globalThis.game ??= { settings: { get: () => null }, i18n: { localize: (k) => k, format: (k) => k } }
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} }
globalThis.window ??= globalThis
globalThis.document ??= { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } }

const { BeneosNativeBattlemapInstaller: Installer } = await import("./beneos-native-installer.mjs")

// run() braucht Foundry; ersetzt wird nur der Lauf selbst, nicht install().
function mitLauf(lauf, fn) {
  const echt = Installer.prototype.run
  Installer.prototype.run = lauf
  return fn().finally(() => { Installer.prototype.run = echt })
}

test("Nachlauf nach dem ersten Lauf und nach dem Retry mit denselben Argumenten", () => mitLauf(async function () {}, async () => {
  const gesehen = []
  const nachLauf = (inst) => { gesehen.push(inst) }
  const erst = await Installer.install({ packageId: "p1", label: "L", sceneSlugs: ["a"], record: { releaseDir: "bm_1" }, nachLauf })
  assert.equal(gesehen.length, 1)
  assert.equal(gesehen[0], erst)
  // Genau das tut der Retry-Knopf in #showReport.
  const retry = await Installer.install({ ...erst._aufruf })
  assert.equal(gesehen.length, 2, "Retry ohne Nachlauf: Karte und Hook bleiben aus")
  assert.equal(gesehen[1], retry)
  assert.deepEqual(retry._aufruf.sceneSlugs, ["a"])
}))

test("kein Nachlauf nach Abbruch im Ueberschreib-Dialog", () => mitLauf(async function () { this._cancelled = true }, async () => {
  let n = 0
  await Installer.install({ packageId: "p2", nachLauf: () => { n++ } })
  assert.equal(n, 0)
}))

test("kein Nachlauf, wenn der Lauf wirft; der Fehler kommt beim Aufrufer an", () => mitLauf(async function () { throw new Error("kaputt") }, async () => {
  let n = 0
  await assert.rejects(Installer.install({ packageId: "p3", nachLauf: () => { n++ } }), /kaputt/)
  assert.equal(n, 0)
}))

test("ein werfender Nachlauf bricht die Installation nicht", () => mitLauf(async function () {}, async () => {
  const echt = console.warn
  console.warn = () => {}
  try {
    const inst = await Installer.install({ packageId: "p4", nachLauf: () => { throw new Error("ui weg") } })
    assert.ok(inst instanceof Installer)
  } finally { console.warn = echt }
}))
