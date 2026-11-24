/**
 * konto-wechsel.test.mjs
 *
 * Gegenprobe zu MO-045, ohne Foundry (Attrappen fuer die Globals):
 *
 *   node --test scripts/cloud-v2/konto-wechsel.test.mjs
 *
 * Seit T-472 bindet die Cloud eine foundry_id nach einer Anmeldung mit
 * anderer E-Mail auf das neue Konto um. Weltkopien mit derselben Kennung
 * bekamen danach still die Rechte des neuen Kontos. Die Cloud liefert dafuer
 * `account_ref` (genau [0-9a-f]{16}, nur im OK-Fall). Die Welt merkt sich den
 * Wert und zeigt dem GM einen Hinweis, wenn er beim Check abweicht.
 *
 * Drei Teile: die reine Entscheidung, die Verdrahtung in BeneosCloud
 * (loginAttempt, pollForAccess, disconnect) und der Text in allen Sprachen.
 */
import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// --- Attrappen fuer die Importkette von beneos_cloud.js ----------------------
const M = "beneos-module"
const REF = `${M}.beneos-cloud-account-ref`
const ablage = new Map()
const hinweise = []
const stub = class {}
for (const n of ["FormApplication", "Application", "Dialog"]) globalThis[n] ??= stub
globalThis.foundry ??= { utils: { randomID: () => "x".repeat(16), mergeObject: (a, b) => ({ ...a, ...b }) }, applications: { api: { ApplicationV2: stub, HandlebarsApplicationMixin: (c) => c, DialogV2: stub } } }
globalThis.game ??= {
  settings: {
    get: (m, k) => ablage.get(`${m}.${k}`),
    set: async (m, k, v) => { ablage.set(`${m}.${k}`, v); return v },
    register() {}, registerMenu() {},
  },
  i18n: { localize: (k) => k, format: (k) => k },
  user: { isGM: true },
  scenes: { get: () => null },
  beneos: {},
}
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} }
globalThis.ui ??= { notifications: { info() {}, warn: (t) => hinweise.push(t), error() {} } }
globalThis.window ??= globalThis
globalThis.document ??= { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } }

const { kontoWechsel } = await import("./konto-wechsel.mjs")
const { BeneosCloud, BeneosCloudLogin } = await import("../beneos_cloud.js")

const A = "aaaaaaaaaaaaaaaa"
const B = "bbbbbbbbbbbbbbbb"
const KEIN = { speichern: null, hinweis: false }

// --- 1. Die Entscheidung ------------------------------------------------------

test("abweichender gueltiger Wert beim Check: Hinweis und Speichern", () => {
  assert.deepEqual(kontoWechsel({ gespeichert: A, neu: B, eigeneAnmeldung: false }), { speichern: B, hinweis: true })
})

test("Feld fehlt, ungueltige Form oder gleicher Wert: kein Hinweis, nichts speichern", () => {
  for (const neu of [undefined, null, "", A.toUpperCase(), "a".repeat(15), "a".repeat(17), "g".repeat(16), 1234567890123456, { A }]) {
    assert.deepEqual(kontoWechsel({ gespeichert: A, neu, eigeneAnmeldung: false }), KEIN, `neu=${JSON.stringify(neu)}`)
  }
  assert.deepEqual(kontoWechsel({ gespeichert: A, neu: A, eigeneAnmeldung: false }), KEIN)
  assert.deepEqual(kontoWechsel({ gespeichert: A, neu: A, eigeneAnmeldung: true }), KEIN)
})

test("erster Wert in einer Welt ohne gespeicherten Wert: still speichern", () => {
  for (const gespeichert of ["", undefined, null]) {
    assert.deepEqual(kontoWechsel({ gespeichert, neu: B, eigeneAnmeldung: false }), { speichern: B, hinweis: false })
  }
})

test("eigene Anmeldung (OTP, pollForAccess): abweichender Wert wird still uebernommen", () => {
  assert.deepEqual(kontoWechsel({ gespeichert: A, neu: B, eigeneAnmeldung: true }), { speichern: B, hinweis: false })
})

// --- 2. Die Verdrahtung -------------------------------------------------------

function wolke() {
  const c = Object.create(BeneosCloud.prototype)
  for (const n of ["setLoginStatus", "startServerProbeLoop", "markServerStatus", "refreshCloudBrowseSession"]) c[n] = () => {}
  c.checkAvailableContent = async () => {}
  game.beneos.cloud = c
  return c
}
function antwort(daten) {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => daten })
}
const OK = { result: "OK", patreon_status: "no_patreon", token_patron: false, battlemap_patron: false }
async function ruhe() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)) }
function frisch(ref) {
  ablage.clear(); hinweise.length = 0
  ablage.set(`${M}.beneos-cloud-foundry-id`, "welt-1")
  if (ref !== undefined) ablage.set(REF, ref)
}

test("loginAttempt: anderes account_ref zeigt dem GM den Hinweis und speichert den neuen Wert", async () => {
  frisch(A); antwort({ ...OK, account_ref: B })
  wolke().loginAttempt(); await ruhe()
  assert.deepEqual(hinweise, ["BENEOS.Cloud.AccountRebound"])
  assert.equal(ablage.get(REF), B)
})

test("loginAttempt: gleiches oder fehlendes account_ref laesst Hinweis und Wert unberuehrt", async () => {
  for (const daten of [{ ...OK, account_ref: A }, { ...OK }, { ...OK, account_ref: "XYZ" }]) {
    frisch(A); antwort(daten)
    wolke().loginAttempt(); await ruhe()
    assert.deepEqual(hinweise, [], JSON.stringify(daten))
    assert.equal(ablage.get(REF), A)
  }
})

test("loginAttempt: ein Spieler (kein GM) bekommt keinen Hinweis und schreibt nichts", async () => {
  frisch(A); antwort({ ...OK, account_ref: B })
  game.user.isGM = false
  try { wolke().loginAttempt(); await ruhe() } finally { game.user.isGM = true }
  assert.deepEqual(hinweise, [])
  assert.equal(ablage.get(REF), A)
})

test("pollForAccess (eigene Anmeldung): neuer Wert still uebernommen", async () => {
  frisch(A); antwort({ ...OK, account_ref: B })
  mock.timers.enable({ apis: ["setInterval"] })
  try {
    // pollForAccess sitzt am Anmeldefenster, nicht an BeneosCloud.
    wolke()
    BeneosCloudLogin.prototype.pollForAccess.call({}, "welt-1")
    mock.timers.tick(1000)
    await ruhe()
  } finally { mock.timers.reset() }
  assert.deepEqual(hinweise, [])
  assert.equal(ablage.get(REF), B)
})

test("disconnect leert den gespeicherten Wert wie die foundry_id", async () => {
  frisch(A)
  await wolke().disconnect()
  assert.equal(ablage.get(REF), "")
  assert.equal(ablage.get(`${M}.beneos-cloud-foundry-id`), "")
})

// --- 3. Der Text --------------------------------------------------------------

const SPRACHEN = {
  ca: new URL("../../lang/ca.json", import.meta.url),
  cs: new URL("../../lang/cs.json", import.meta.url),
  de: new URL("../../lang/de.json", import.meta.url),
  en: new URL("../../lang/en.json", import.meta.url),
  es: new URL("../../lang/es.json", import.meta.url),
  fr: new URL("../../lang/fr.json", import.meta.url),
  it: new URL("../../lang/it.json", import.meta.url),
  ja: new URL("../../lang/ja.json", import.meta.url),
  ko: new URL("../../lang/ko.json", import.meta.url),
  pl: new URL("../../lang/pl.json", import.meta.url),
  "pt-BR": new URL("../../lang/pt-BR.json", import.meta.url),
  "pt-PT": new URL("../../lang/pt-PT.json", import.meta.url),
  ru: new URL("../../lang/ru.json", import.meta.url),
  "zh-TW": new URL("../../lang/zh-TW.json", import.meta.url),
}

test("Hinweistext in allen 14 Sprachen vorhanden, englisch woertlich, ohne Gedankenstriche", () => {
  assert.equal(Object.keys(SPRACHEN).length, 14)
  for (const [code, url] of Object.entries(SPRACHEN)) {
    const text = JSON.parse(readFileSync(url, "utf8"))["BENEOS.Cloud.AccountRebound"]
    assert.equal(typeof text, "string", code)
    assert.ok(text.trim().length > 0, code)
    assert.doesNotMatch(text, new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]|--`), code)
  }
  assert.equal(JSON.parse(readFileSync(SPRACHEN.en, "utf8"))["BENEOS.Cloud.AccountRebound"],
    "This world is now linked to another Beneos account. Sign in again to switch back.")
})
