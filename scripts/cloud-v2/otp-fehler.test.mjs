/**
 * otp-fehler.test.mjs
 *
 * Gegenprobe zu MO-049, ohne Foundry (Attrappen fuer die Globals):
 *
 *   node --test scripts/cloud-v2/otp-fehler.test.mjs
 *
 * foundry-otp-verify.php verbraucht den Code, bevor es das Konto anlegt und
 * die Welt bindet. Scheitert einer dieser Schritte, zeigte connectWithCode
 * trotzdem "Invalid or expired code". Jetzt liest das Modul das Maschinenfeld
 * code der Antwort und waehlt danach den Hinweis. Der englische Servertext
 * information geht nur in die Konsole.
 *
 * Drei Teile: die reine Abbildung, die Verdrahtung in connectWithCode und der
 * Text in allen Sprachen.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// --- Attrappen fuer die Importkette von beneos_cloud.js ----------------------
const fehler = []
const warnungen = []
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
globalThis.ui ??= { notifications: { info() {}, warn() {}, error: (t) => fehler.push(t) } }
globalThis.window ??= globalThis
globalThis.document ??= { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } }

const { otpFehlerSchluessel } = await import("./otp-fehler.mjs")
const { BeneosCloudLogin } = await import("../beneos_cloud.js")

const UNGUELTIG = "BENEOS.Cloud.Notification.CodeInvalid"
const NICHT_VERBUNDEN = "BENEOS.Cloud.Notification.CodeAcceptedNotConnected"
const FEHLGESCHLAGEN = "BENEOS.Cloud.Notification.SignInFailed"
const T481_TEXT = "Could not connect this Foundry world, please request a new code"

// --- 1. Die Abbildung ---------------------------------------------------------

test("Konto- oder Bindungsfehler nach verbrauchtem Code: eigener Hinweis", () => {
  for (const code of ["account-create-failed", "bind-failed"]) {
    assert.equal(otpFehlerSchluessel({ result: "error", code, information: "x" }), NICHT_VERBUNDEN)
  }
})

test("fehlende Angaben: allgemeiner Hinweis", () => {
  assert.equal(otpFehlerSchluessel({ result: "error", code: "missing-parameters" }), FEHLGESCHLAGEN)
})

test("falscher Code, kein code, unbekannter code oder kaputte Antwort: wie bisher CodeInvalid", () => {
  const faelle = [
    { result: "error", code: "code-invalid", information: "Invalid or expired code" },
    { result: "error", information: "Could not create account" },
    { result: "error", code: "foundry-id-revoked" },
    { result: "error", code: "etwas-neues" },
    { result: "error", code: 42 },
    { result: "error", code: "toString" },
    { result: "error", code: "__proto__" },
    null, undefined, "", "bind-failed", 7, [], {},
  ]
  for (const daten of faelle) assert.equal(otpFehlerSchluessel(daten), UNGUELTIG, JSON.stringify(daten))
})

test("Zwei-Werte-Probe: code bind-failed aendert den Schluessel, information ohne code nicht", () => {
  const ohne = otpFehlerSchluessel({ result: "error" })
  assert.notEqual(otpFehlerSchluessel({ result: "error", code: "bind-failed" }), ohne)
  assert.equal(otpFehlerSchluessel({ result: "error", information: T481_TEXT }), ohne)
})

// --- 2. Die Verdrahtung in connectWithCode ------------------------------------

function anmeldung() {
  const l = Object.create(BeneosCloudLogin.prototype)
  const spur = { poll: 0, gemerkt: 0 }
  l.requestCode = async () => ({ status: "ok", ttl: 600, retryAfter: 0 })
  l.scheduleDeliveryCheck = () => {}
  l.codeDialog = async () => ({ code: "123456" })
  l.rememberLoginEmail = () => { spur.gemerkt++ }
  l.pollForAccess = () => { spur.poll++ }
  return { l, spur }
}
async function verifiziere(antwort) {
  fehler.length = 0; warnungen.length = 0
  globalThis.fetch = async () => antwort
  const warn = console.warn
  console.warn = (...a) => warnungen.push(a.map(String).join(" "))
  try {
    const { l, spur } = anmeldung()
    await l.connectWithCode("gm@example.org", "welt-1")
    return spur
  } finally {
    console.warn = warn
  }
}
const json = (daten) => ({ ok: true, status: 200, json: async () => daten })

test("bind-failed: eigener Hinweis, Servertext nur in der Konsole, kein Poll", async () => {
  const spur = await verifiziere(json({ result: "error", code: "bind-failed", information: T481_TEXT }))
  assert.deepEqual(fehler, [NICHT_VERBUNDEN])
  assert.ok(!fehler.some((t) => t.includes(T481_TEXT)))
  assert.ok(warnungen.some((w) => w.includes(T481_TEXT) && w.includes("bind-failed")), warnungen.join("\n"))
  assert.equal(spur.poll, 0)
})

test("Antwort ohne code mit information: CodeInvalid, Servertext nur in der Konsole", async () => {
  await verifiziere(json({ result: "error", information: "Could not create account" }))
  assert.deepEqual(fehler, [UNGUELTIG])
  assert.ok(warnungen.some((w) => w.includes("Could not create account")))
})

test("OK-Weg unveraendert: Adresse merken und pollen, keine Fehlermeldung", async () => {
  const spur = await verifiziere(json({ result: "OK", information: "Account connected" }))
  assert.deepEqual(fehler, [])
  assert.deepEqual(spur, { poll: 1, gemerkt: 1 })
})

test("Netzfehler und unlesbare Antwort bleiben LoginServerOffline wie bisher", async () => {
  const err = console.error
  console.error = () => {}
  try {
    globalThis.fetch = async () => { throw new Error("offline") }
    fehler.length = 0
    await anmeldung().l.connectWithCode("gm@example.org", "welt-1")
    assert.deepEqual(fehler, ["BENEOS.Cloud.Notification.LoginServerOffline"])
    await verifiziere({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json") } })
    assert.deepEqual(fehler, ["BENEOS.Cloud.Notification.LoginServerOffline"])
  } finally {
    console.error = err
  }
})

// --- 3. Der Text in allen Sprachen --------------------------------------------

const GEDANKENSTRICH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)
const SPRACHEN = ["ca", "cs", "de", "en", "es", "fr", "it", "ja", "ko", "pl", "pt-BR", "pt-PT", "ru", "zh-TW"]
// Der Ordner steht woertlich, damit tools/haken/betroffen.mjs diesen Test auch
// fuer einen Commit waehlt, der nur lang/*.json aendert.
const LANG = new URL("../../lang/", import.meta.url)
const lies = (code) => JSON.parse(readFileSync(new URL(`${code}.json`, LANG), "utf8"))

test("beide Hinweise in allen 14 Sprachen vorhanden, englisch woertlich, ohne Gedankenstriche", () => {
  for (const code of SPRACHEN) {
    const datei = lies(code)
    for (const schluessel of [NICHT_VERBUNDEN, FEHLGESCHLAGEN]) {
      const text = datei[schluessel]
      assert.equal(typeof text, "string", `${code} ${schluessel}`)
      assert.ok(text.trim().length > 0, `${code} ${schluessel} leer`)
      assert.ok(!GEDANKENSTRICH.test(text), `${code} ${schluessel} mit Gedankenstrich`)
    }
  }
  const en = lies("en")
  assert.equal(en[NICHT_VERBUNDEN], "Your code was accepted, but this world could not be connected. Please request a new code and try again.")
  assert.equal(en[FEHLGESCHLAGEN], "Sign-in failed. Please try again.")
})
