/**
 * anmelde-anfrage.test.mjs
 *
 * Gegenprobe zu MO-054, ohne Foundry (Attrappen fuer die Globals):
 *
 *   node --test scripts/cloud-v2/anmelde-anfrage.test.mjs
 *
 * Die Anmeldung schickte E-Mail, Code und Foundry-ID im Query-String an
 * foundry-otp-request.php, foundry-otp-verify.php und foundry-otp-status.php.
 * Adressen in URLs landen in Webserver-, Proxy- und CDN-Logs. Jetzt gehen alle
 * Werte als Formular-Rumpf (application/x-www-form-urlencoded) per POST.
 *
 * Serververtrag (beneos-cloud-server, lib/anfrage-quelle.php): Steht das
 * Traegerfeld des Endpunkts im Rumpf, liest der Server NUR den Rumpf. Darum
 * gehoeren alle Felder hinein, auch otpv und confirmCreate. Request per POST
 * setzt clou T-274 voraus, live gemessen 25.11.2026 ~18:45 durch gitg-cent-1
 * (sha256 live gleich origin).
 *
 * Zwei Teile: der Helfer und die Verdrahtung der drei Aufrufe.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

// --- Attrappen fuer die Importkette von beneos_cloud.js ----------------------
const stub = class {}
for (const n of ["FormApplication", "Application", "Dialog"]) globalThis[n] ??= stub
globalThis.foundry ??= { utils: { randomID: () => "x".repeat(16), mergeObject: (a, b) => ({ ...a, ...b }) }, applications: { api: { ApplicationV2: stub, HandlebarsApplicationMixin: (c) => c, DialogV2: stub } } }
globalThis.game ??= {
  settings: { get: () => undefined, set: async (m, k, v) => v, register() {}, registerMenu() {} },
  i18n: { localize: (k) => k, format: (k) => k },
  user: { isGM: true },
  scenes: { get: () => null },
  beneos: {},
}
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} }
globalThis.ui ??= { notifications: { info() {}, warn() {}, error() {} } }
globalThis.window ??= globalThis
globalThis.document ??= { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } }

const { anmeldeAnfrage } = await import("./anmelde-anfrage.mjs")
const { BeneosCloudLogin } = await import("../beneos_cloud.js")

const BASIS = "https://beneos.cloud"

// --- 1. Der Helfer -------------------------------------------------------------

test("Helfer: POST, URL ohne Parameter, Rumpf URLSearchParams mit allen Feldern", () => {
  const { url, init } = anmeldeAnfrage(BASIS, "foundry-otp-verify.php", { email: "gm@example.org", code: "123456", foundryId: "welt-1" })
  assert.equal(url, `${BASIS}/foundry-otp-verify.php`)
  assert.equal(init.method, "POST")
  assert.equal(init.credentials, "same-origin")
  assert.ok(init.body instanceof URLSearchParams)
  assert.deepEqual(Object.fromEntries(init.body), { email: "gm@example.org", code: "123456", foundryId: "welt-1" })
})

test("Helfer: undefined, null und leere Felder fallen weg statt als Text 'undefined' zu reisen", () => {
  const { init } = anmeldeAnfrage(BASIS, "foundry-otp-request.php", { email: "gm@example.org", foundryId: "welt-1", confirmCreate: undefined, x: null, y: "" })
  assert.deepEqual(Object.fromEntries(init.body), { email: "gm@example.org", foundryId: "welt-1" })
})

test("Zwei-Werte-Probe: eine andere Adresse aendert den Rumpf, die URL bleibt gleich", () => {
  const a = anmeldeAnfrage(BASIS, "foundry-otp-status.php", { email: "a@example.org" })
  const b = anmeldeAnfrage(BASIS, "foundry-otp-status.php", { email: "b@example.org" })
  assert.notEqual(a.init.body.toString(), b.init.body.toString())
  assert.equal(a.url, b.url)
})

test("Helfer: Sonderzeichen werden formularkodiert, nicht verdoppelt", () => {
  const { init } = anmeldeAnfrage(BASIS, "foundry-otp-status.php", { email: "a+b&c@example.org" })
  assert.equal(init.body.get("email"), "a+b&c@example.org")
  assert.equal(init.body.toString(), "email=a%2Bb%26c%40example.org")
})

// --- 2. Die Verdrahtung der drei Aufrufe ------------------------------------

const EMAIL = "gm@example.org"
const CODE = "654321"
const WELT = "welt-1"

/** Faengt jeden fetch-Aufruf mit URL und init ab und antwortet mit `daten`. */
function fange(daten) {
  const aufrufe = []
  globalThis.fetch = async (url, init) => {
    aufrufe.push({ url: String(url), init })
    return { ok: true, status: 200, json: async () => daten }
  }
  return aufrufe
}

/** Kein Parameter und kein Wert in der URL, Rumpf ist ein Formular per POST. */
function pruefePost(aufruf, endpunkt) {
  assert.ok(aufruf.url.endsWith(`/${endpunkt}`), aufruf.url)
  assert.ok(!aufruf.url.includes("?"), aufruf.url)
  for (const wert of [EMAIL, encodeURIComponent(EMAIL), CODE, WELT]) assert.ok(!aufruf.url.includes(wert), aufruf.url)
  assert.equal(aufruf.init?.method, "POST")
  assert.ok(aufruf.init.body instanceof URLSearchParams)
}

test("requestCode: POST, email, foundryId und otpv=2 im Rumpf, ohne confirmCreate", async () => {
  const aufrufe = fange({ result: "OK", ttl: 600 })
  const l = Object.create(BeneosCloudLogin.prototype)
  const r = await l.requestCode(EMAIL, WELT, false)
  assert.equal(r.status, "ok")
  assert.equal(aufrufe.length, 1)
  pruefePost(aufrufe[0], "foundry-otp-request.php")
  const rumpf = aufrufe[0].init.body
  assert.equal(rumpf.get("email"), EMAIL)
  assert.equal(rumpf.get("foundryId"), WELT)
  assert.equal(rumpf.get("otpv"), "2")
  assert.equal(rumpf.has("confirmCreate"), false)
})

test("requestCode mit Bestaetigung: confirmCreate ist der Text '1', den der Server strikt prueft", async () => {
  const aufrufe = fange({ result: "OK", ttl: 600 })
  const l = Object.create(BeneosCloudLogin.prototype)
  await l.requestCode(EMAIL, WELT, true)
  pruefePost(aufrufe[0], "foundry-otp-request.php")
  assert.equal(aufrufe[0].init.body.get("confirmCreate"), "1")
  assert.equal(aufrufe[0].init.body.get("otpv"), "2")
})

test("connectWithCode Verify-Schritt: POST, email, code und foundryId im Rumpf", async () => {
  const aufrufe = fange({ result: "OK" })
  const l = Object.create(BeneosCloudLogin.prototype)
  l.requestCode = async () => ({ status: "ok", ttl: 600, retryAfter: 0 })
  l.scheduleDeliveryCheck = () => {}
  l.codeDialog = async () => ({ code: ` ${CODE} ` })
  l.rememberLoginEmail = () => {}
  l.pollForAccess = () => {}
  await l.connectWithCode(EMAIL, WELT)
  assert.equal(aufrufe.length, 1)
  pruefePost(aufrufe[0], "foundry-otp-verify.php")
  assert.deepEqual(Object.fromEntries(aufrufe[0].init.body), { email: EMAIL, code: CODE, foundryId: WELT })
})

test("scheduleDeliveryCheck: POST, nur email im Rumpf", async () => {
  const aufrufe = fange({ result: "OK", deliverable: true })
  const zeitgeber = globalThis.setTimeout
  let rueckruf = null
  globalThis.setTimeout = (fn) => { rueckruf = fn; return 0 }
  try {
    Object.create(BeneosCloudLogin.prototype).scheduleDeliveryCheck(EMAIL)
  } finally {
    globalThis.setTimeout = zeitgeber
  }
  assert.equal(typeof rueckruf, "function")
  await rueckruf()
  assert.equal(aufrufe.length, 1)
  pruefePost(aufrufe[0], "foundry-otp-status.php")
  assert.deepEqual(Object.fromEntries(aufrufe[0].init.body), { email: EMAIL })
})
