/**
 * anmeldung-verloren.test.mjs
 *
 * Gegenprobe zu MO-046, ohne Foundry (Attrappen fuer die Globals):
 *
 *   node --test scripts/cloud-v2/anmeldung-verloren.test.mjs
 *
 * Kennt die Cloud die Foundry-Kennung einer Welt nicht mehr (Kappung auf 15
 * Bindungen je Konto oder serverseitig geloest), meldete clearStaleEntitlement
 * das nur Welten mit gespeicherten Patreon-Flags. Ein GM ohne Patreon fand die
 * Welt still abgemeldet. Jetzt bekommt er einmal je verlorener Bindung den
 * Hinweis SignInLost; wer vorher Zugang hatte, weiter SessionExpired.
 *
 * Drei Teile: die reine Entscheidung, die Verdrahtung in BeneosCloud
 * (clearStaleEntitlement, loginAttempt, pollForAccess, disconnect) und der
 * Text in allen Sprachen.
 */
import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// --- Attrappen fuer die Importkette von beneos_cloud.js ----------------------
const M = "beneos-module"
const MERKER = `${M}.beneos-cloud-signin-lost-notified`
const ablage = new Map()
const hinweise = []
const schreibvorgaenge = []
const stub = class {}
for (const n of ["FormApplication", "Application", "Dialog"]) globalThis[n] ??= stub
globalThis.foundry ??= { utils: { randomID: () => "x".repeat(16), mergeObject: (a, b) => ({ ...a, ...b }) }, applications: { api: { ApplicationV2: stub, HandlebarsApplicationMixin: (c) => c, DialogV2: stub } } }
globalThis.game ??= {
  settings: {
    get: (m, k) => ablage.get(`${m}.${k}`),
    set: async (m, k, v) => { schreibvorgaenge.push(k); ablage.set(`${m}.${k}`, v); return v },
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

const { anmeldungVerloren } = await import("./anmeldung-verloren.mjs")
const { BeneosCloud, BeneosCloudLogin } = await import("../beneos_cloud.js")

const KEIN = { hinweis: null, merken: null }

// --- 1. Die Entscheidung ------------------------------------------------------

test("ohne vorherigen Zugang, noch nicht gemeldet: Hinweis 'ohne', Kennung merken", () => {
  for (const gemeldetFuer of ["", undefined, null, "andere-welt"]) {
    assert.deepEqual(anmeldungVerloren({ hatteZugang: false, foundryId: "welt-1", gemeldetFuer }), { hinweis: "ohne", merken: "welt-1" })
  }
})

test("ohne vorherigen Zugang, fuer dieselbe Kennung schon gemeldet: still", () => {
  assert.deepEqual(anmeldungVerloren({ hatteZugang: false, foundryId: "welt-1", gemeldetFuer: "welt-1" }), KEIN)
})

test("mit vorherigem Zugang: Hinweis 'patron', auch wenn der Merker schon passt", () => {
  for (const gemeldetFuer of ["", "welt-1"]) {
    assert.deepEqual(anmeldungVerloren({ hatteZugang: true, foundryId: "welt-1", gemeldetFuer }), { hinweis: "patron", merken: "welt-1" })
  }
})

test("ohne Kennung: kein Hinweis, nichts merken", () => {
  for (const foundryId of ["", undefined, null]) {
    assert.deepEqual(anmeldungVerloren({ hatteZugang: true, foundryId, gemeldetFuer: "" }), KEIN)
    assert.deepEqual(anmeldungVerloren({ hatteZugang: false, foundryId, gemeldetFuer: "" }), KEIN)
  }
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
const UNBEKANNT = { result: "KO", information: "user not found" }
async function ruhe() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)) }
function frisch({ status = "no_patreon", token = false, battlemap = false, merker } = {}) {
  ablage.clear(); hinweise.length = 0; schreibvorgaenge.length = 0
  ablage.set(`${M}.beneos-cloud-foundry-id`, "welt-1")
  ablage.set(`${M}.beneos-cloud-patreon-status`, status)
  ablage.set(`${M}.beneos-cloud-token-patron`, token)
  ablage.set(`${M}.beneos-cloud-battlemap-patron`, battlemap)
  if (merker !== undefined) ablage.set(MERKER, merker)
}
async function check(daten) {
  antwort(daten)
  wolke().loginAttempt(); await ruhe()
}

test("Welt ohne Patreon verliert die Bindung: SignInLost und Merker gesetzt", async () => {
  frisch()
  await check(UNBEKANNT)
  assert.deepEqual(hinweise, ["BENEOS.Cloud.SignInLost"])
  assert.equal(ablage.get(MERKER), "welt-1")
})

test("verknuepftes Patreon ohne aktive Mitgliedschaft: SignInLost, Status geleert", async () => {
  frisch({ status: "not_active_patron" })
  await check(UNBEKANNT)
  assert.deepEqual(hinweise, ["BENEOS.Cloud.SignInLost"])
  assert.equal(ablage.get(`${M}.beneos-cloud-patreon-status`), "no_patreon")
})

test("Welt mit Zugang verliert die Bindung: weiter SessionExpired, Flags geleert", async () => {
  for (const vorher of [{ status: "active_patron", token: true, battlemap: true }, { status: "active_patron" }, { token: true }, { battlemap: true }]) {
    frisch(vorher)
    await check(UNBEKANNT)
    assert.deepEqual(hinweise, ["BENEOS.Cloud.SessionExpired"], JSON.stringify(vorher))
    assert.equal(ablage.get(`${M}.beneos-cloud-patreon-status`), "no_patreon")
    assert.equal(ablage.get(`${M}.beneos-cloud-token-patron`), false)
    assert.equal(ablage.get(`${M}.beneos-cloud-battlemap-patron`), false)
    assert.equal(ablage.get(MERKER), "welt-1")
  }
})

test("zweiter Lauf fuer dieselbe Kennung bleibt still, ob vorher Patron oder nicht", async () => {
  for (const vorher of [{}, { status: "active_patron", token: true }]) {
    frisch(vorher)
    await check(UNBEKANNT)
    hinweise.length = 0
    await check(UNBEKANNT)
    assert.deepEqual(hinweise, [], JSON.stringify(vorher))
  }
})

test("ein Spieler (kein GM) bekommt keinen Hinweis und schreibt nichts", async () => {
  frisch()
  game.user.isGM = false
  try { await check(UNBEKANNT) } finally { game.user.isGM = true }
  assert.deepEqual(hinweise, [])
  assert.deepEqual(schreibvorgaenge, [])
  assert.equal(ablage.get(MERKER), undefined)
})

test("ein Spieler (kein GM) leert den Merker nicht", async () => {
  frisch({ merker: "welt-1" })
  game.user.isGM = false
  try { await wolke().vergissAnmeldungVerloren() } finally { game.user.isGM = true }
  assert.deepEqual(schreibvorgaenge, [])
  assert.equal(ablage.get(MERKER), "welt-1")
})

test("erfolgreicher Check leert den Merker, ein erneuter Verlust meldet wieder", async () => {
  frisch({ merker: "welt-1" })
  await check(OK)
  assert.equal(ablage.get(MERKER), "")
  hinweise.length = 0
  await check(UNBEKANNT)
  assert.deepEqual(hinweise, ["BENEOS.Cloud.SignInLost"])
})

test("erfolgreicher Check schreibt den Merker nicht, wenn er schon leer ist", async () => {
  for (const merker of [undefined, ""]) {
    frisch({ merker })
    await check(OK)
    assert.ok(!schreibvorgaenge.includes("beneos-cloud-signin-lost-notified"), String(merker))
  }
})

test("pollForAccess (eigene Anmeldung) leert den Merker", async () => {
  frisch({ merker: "welt-1" }); antwort(OK)
  mock.timers.enable({ apis: ["setInterval"] })
  try {
    // pollForAccess sitzt am Anmeldefenster, nicht an BeneosCloud.
    wolke()
    BeneosCloudLogin.prototype.pollForAccess.call({}, "welt-1")
    mock.timers.tick(1000)
    await ruhe()
  } finally { mock.timers.reset() }
  assert.equal(ablage.get(MERKER), "")
})

test("disconnect leert den Merker wie die foundry_id", async () => {
  frisch({ merker: "welt-1" })
  await wolke().disconnect()
  assert.equal(ablage.get(MERKER), "")
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
    const text = JSON.parse(readFileSync(url, "utf8"))["BENEOS.Cloud.SignInLost"]
    assert.equal(typeof text, "string", code)
    assert.ok(text.trim().length > 0, code)
    assert.doesNotMatch(text, new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]|--`), code)
  }
  assert.equal(JSON.parse(readFileSync(SPRACHEN.en, "utf8"))["BENEOS.Cloud.SignInLost"],
    "Beneos Cloud no longer recognises this world's sign-in, so this world is now signed out. Open the Beneos Cloud window and sign in again to restore access to your content.")
})
