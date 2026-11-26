/**
 * kennung-anfrage.test.mjs
 *
 * Gegenprobe zu MO-064, ohne Foundry (Attrappen fuer die Globals):
 *
 *   node --test scripts/cloud-v2/kennung-anfrage.test.mjs
 *
 * Die foundryId ist der Kontoausweis einer Welt. Das Modul schickte sie in der
 * Adresse an foundry-manager.php und an api-analytics.php?ingest=1, und damit
 * stand sie in jedem Zugriffsprotokoll auf dem Weg (Webserver, Proxy, CDN).
 *
 * Serververtrag (beneos-cloud-server, clou-T-278 und clou-T-279, live seit
 * 26.11.2026):
 *   - foundry-manager.php liest NUR die foundryId aus dem Formular-Rumpf.
 *     Aktion und Nebenwerte (check, get_token, tokenKey, since, ...) liest er
 *     weiter aus der Adresse. country_prompt liest action und country aus dem
 *     Rumpf, ein POST ohne action liest den Zustand.
 *   - api-analytics.php?ingest=1 liest die foundryId aus dem JSON-Rumpf
 *     {foundryId, events}.
 *
 * Drei Teile: der Quellscan (die Kernprobe), der Helfer und die Verdrahtung.
 */
import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// --- Attrappen fuer die Importkette von beneos_cloud.js ----------------------
const M = "beneos-module"
const ablage = new Map()
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
  modules: { get: () => null },
  beneos: {},
}
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} }
globalThis.ui ??= { notifications: { info() {}, warn() {}, error() {} } }
globalThis.window ??= globalThis
globalThis.document ??= { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} } }

const { foundryManagerAnfrage } = await import("./anmelde-anfrage.mjs")
const { BeneosCloud, BeneosCloudLogin } = await import("../beneos_cloud.js")
const { BeneosAnalytics } = await import("../beneos_analytics.js")
const { fetchWhatsNew, ackWhatsNew } = await import("./services/whats-new-api.mjs")
const { requestPdfUrl } = await import("../codex/codex-pdf-service.mjs")

const BASIS = "https://beneos.cloud"
const WELT = "welt-mo064"

// --- 1. Kernprobe: keine Kennung mehr in einer Adresse ----------------------
//
// Jede Datei steht als eigenes Literal in new URL. Nur diese Form erkennt
// tools/haken/betroffen.mjs als Gegenstand; eine Liste mit map oder ein Pfad in
// Backticks liesse den Test bei einer Aenderung an genau dieser Datei aus.
const QUELLEN = {
  "beneos_cloud.js": readFileSync(new URL("../beneos_cloud.js", import.meta.url), "utf8"),
  "beneos_analytics.js": readFileSync(new URL("../beneos_analytics.js", import.meta.url), "utf8"),
  "country-prompt.mjs": readFileSync(new URL("./country-prompt.mjs", import.meta.url), "utf8"),
  "whats-new-api.mjs": readFileSync(new URL("./services/whats-new-api.mjs", import.meta.url), "utf8"),
  "codex-pdf-service.mjs": readFileSync(new URL("../codex/codex-pdf-service.mjs", import.meta.url), "utf8"),
}

// Die Formen, in denen die Kennung in eine Adresse kommt: als Text oder ueber
// searchParams.set/append.
const KENNUNG_IN_ADRESSE = [/foundryId=/, /searchParams\.(set|append)\(\s*["']foundryId["']/]
const traegtKennung = (zeile) => KENNUNG_IN_ADRESSE.some((muster) => muster.test(zeile))

test("Quellscan erkennt jede Form, in der die Kennung in eine Adresse kommt", () => {
  for (const zeile of [
    "const url = `${b}/foundry-manager.php?check=1&foundryId=${id}`",
    "url.searchParams.set(\"foundryId\", id)",
    "url.searchParams.append('foundryId', id)",
  ]) assert.ok(traegtKennung(zeile), zeile)
  assert.ok(!traegtKennung("body.set(\"foundryId\", id)"), "Rumpf ist keine Adresse")
})

test("Quellscan: keine Kennung in einer Adresse der fuenf Moduldateien", () => {
  const treffer = []
  for (const [datei, text] of Object.entries(QUELLEN)) {
    text.split(/\r?\n/).forEach((zeile, i) => {
      if (traegtKennung(zeile)) {
        treffer.push(`${datei}:${i + 1}: ${zeile.trim().slice(0, 100)}`)
      }
    })
  }
  assert.deepEqual(treffer, [], `${treffer.length} Stelle(n) tragen die Kennung noch in der Adresse`)
})

// --- 2. Der Helfer -------------------------------------------------------------

test("Helfer: POST, Aktion in der Adresse, Kennung nur im Rumpf", () => {
  const { url, init } = foundryManagerAnfrage(BASIS, { get_token: 1, tokenKey: "a&b c" }, WELT)
  assert.equal(url, `${BASIS}/foundry-manager.php?get_token=1&tokenKey=a%26b+c`)
  assert.ok(!url.includes(WELT))
  assert.equal(init.method, "POST")
  assert.ok(init.body instanceof URLSearchParams)
  assert.deepEqual(Object.fromEntries(init.body), { foundryId: WELT })
})

test("Helfer: ein Feld foundryId in der Adresse wird nie gesendet, die Kennung reist nur im Rumpf", () => {
  const { url, init } = foundryManagerAnfrage(BASIS, { check: 1, foundryId: "fremd" }, WELT, { rumpf: { foundryId: "auch-fremd" } })
  assert.equal(url, `${BASIS}/foundry-manager.php?check=1`)
  assert.deepEqual(Object.fromEntries(init.body), { foundryId: WELT })
})

test("Helfer: leere oder fehlende Kennung reist als leerer Text, wie bisher in der Adresse", () => {
  for (const id of ["", undefined, null]) {
    const { init } = foundryManagerAnfrage(BASIS, { check: 1 }, id)
    assert.deepEqual(Object.fromEntries(init.body), { foundryId: "" }, `id=${id}`)
  }
})

test("Helfer: Adressfelder ohne Wert fallen weg, Rumpffelder kommen dazu, init der Stelle bleibt", () => {
  const signal = new AbortController().signal
  const { url, init } = foundryManagerAnfrage(BASIS, { country_prompt: 1, since: undefined, x: null, y: "" }, WELT, {
    rumpf: { action: "set", country: "DE", leer: undefined },
    init: { credentials: "omit", cache: "no-cache", signal, method: "GET", body: "falsch" },
  })
  assert.equal(url, `${BASIS}/foundry-manager.php?country_prompt=1`)
  assert.deepEqual(Object.fromEntries(init.body), { foundryId: WELT, action: "set", country: "DE" })
  assert.equal(init.method, "POST")
  assert.equal(init.credentials, "omit")
  assert.equal(init.cache, "no-cache")
  assert.equal(init.signal, signal)
})

// --- 3. Die Verdrahtung --------------------------------------------------------

let aufrufe = []
function antwort(daten, ok = true) {
  aufrufe = []
  globalThis.fetch = async (url, init) => {
    aufrufe.push({ url: String(url), init })
    return { ok, status: ok ? 200 : 500, json: async () => daten }
  }
}
async function ruhe() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)) }
function frisch() {
  ablage.clear()
  ablage.set(`${M}.beneos-cloud-foundry-id`, WELT)
}
function pruefeFoundryManager(aufruf, aktion) {
  assert.ok(aufruf, `kein Aufruf fuer ${aktion}`)
  assert.ok(aufruf.url.startsWith(`${BASIS}/foundry-manager.php?`), aufruf.url)
  assert.ok(new URL(aufruf.url).searchParams.has(aktion), `${aktion} fehlt in ${aufruf.url}`)
  assert.ok(!aufruf.url.includes(WELT), `Kennung in der Adresse: ${aufruf.url}`)
  assert.equal(aufruf.init?.method, "POST")
  assert.equal(new URLSearchParams(aufruf.init.body).get("foundryId"), WELT)
}
function wolke() {
  const c = Object.create(BeneosCloud.prototype)
  for (const n of ["setLoginStatus", "startServerProbeLoop", "markServerStatus", "refreshCloudBrowseSession"]) c[n] = () => {}
  c.checkAvailableContent = async () => {}
  c.inflightImports = new Set()
  c.pendingCanvasDrops = new Map()
  c.enqueueInstall = (job) => job()
  game.beneos.cloud = c
  return c
}

test("loginAttempt: check per POST, Kennung im Rumpf", async () => {
  frisch(); antwort({ result: "error" })
  wolke().loginAttempt(); await ruhe()
  pruefeFoundryManager(aufrufe[0], "check")
})

test("pollForAccess: check per POST, Kennung im Rumpf", async () => {
  frisch(); antwort({ result: "error" })
  wolke()
  mock.timers.enable({ apis: ["setInterval"] })
  try {
    BeneosCloudLogin.prototype.pollForAccess.call({}, WELT)
    mock.timers.tick(1000)
    await ruhe()
  } finally { mock.timers.reset() }
  pruefeFoundryManager(aufrufe[0], "check")
})

test("checkAvailableContent: get_content per POST, Kennung im Rumpf", async () => {
  frisch(); antwort({ result: "error" })
  await BeneosCloud.prototype.checkAvailableContent.call(wolke())
  pruefeFoundryManager(aufrufe[0], "get_content")
})

test("importTokenFromCloud: get_token per POST, tokenKey und surface in der Adresse", async () => {
  frisch(); antwort({ result: "error" })
  await wolke().importTokenFromCloud("001-ork", undefined, true, { force: true, surface: "drawer" }).catch(() => {})
  pruefeFoundryManager(aufrufe[0], "get_token")
  const adresse = new URL(aufrufe[0].url).searchParams
  assert.equal(adresse.get("tokenKey"), "001-ork")
  assert.equal(adresse.get("surface"), "drawer")
})

test("What's New: get_whats_new und whats_new_ack per POST, Kennung im Rumpf", async () => {
  frisch(); antwort({ result: "OK", data: { firstRun: true, serverTime: 5 } })
  await fetchWhatsNew({ loggedIn: true })
  pruefeFoundryManager(aufrufe[0], "get_whats_new")
  antwort({ result: "OK" })
  assert.equal(await ackWhatsNew(77, { loggedIn: true }), true)
  pruefeFoundryManager(aufrufe[0], "whats_new_ack")
  assert.equal(new URL(aufrufe[0].url).searchParams.get("ts"), "77")
})

test("Codex: get_asset_pdf per POST, assetKey in der Adresse, credentials omit bleibt", async () => {
  frisch(); antwort({ result: "OK", data: { download_url: "u", filename: "f" } })
  await requestPdfUrl({ foundryId: WELT, assetKey: "001-ork" })
  pruefeFoundryManager(aufrufe[0], "get_asset_pdf")
  assert.equal(new URL(aufrufe[0].url).searchParams.get("assetKey"), "001-ork")
  assert.equal(aufrufe[0].init.credentials, "omit")
})

test("country-prompt baut seine Anfrage ueber den Helfer", () => {
  assert.match(QUELLEN["country-prompt.mjs"], /foundryManagerAnfrage\(/)
})

test("Analytics-Ingest: Adresse nur ?ingest=1, Kennung im JSON-Rumpf, auf beiden Wegen", async () => {
  const ereignis = { event_type: "world_open", payload: {} }
  const vorher = { getSendeKennung: BeneosAnalytics.getSendeKennung, sichern: BeneosAnalytics._sichern }
  BeneosAnalytics.getSendeKennung = () => WELT
  BeneosAnalytics._sichern = () => {}
  try {
    for (const [weg, keepalive, final] of [["flush", false, false], ["keepalive", true, true]]) {
      BeneosAnalytics._disabledForSession = false
      BeneosAnalytics._flushing = false
      BeneosAnalytics._lastKeepaliveAt = 0
      BeneosAnalytics.queue = [ereignis]
      antwort({ status: "ok" })
      await BeneosAnalytics.flush(keepalive, final)
      await ruhe()
      assert.equal(aufrufe.length, 1, weg)
      assert.equal(aufrufe[0].url, "https://beneos.cloud/api-analytics.php?ingest=1", weg)
      assert.equal(aufrufe[0].init.method, "POST", weg)
      assert.deepEqual(JSON.parse(aufrufe[0].init.body), { foundryId: WELT, events: [ereignis] }, weg)
    }
  } finally {
    BeneosAnalytics.getSendeKennung = vorher.getSendeKennung
    BeneosAnalytics._sichern = vorher.sichern
    BeneosAnalytics.queue = []
  }
})

test("_fitKeepalive misst die Groesse mit der Kennung", () => {
  const gross = { event_type: "x", payload: { p: "a".repeat(400) } }
  const stapel = Array.from({ length: 10 }, () => gross)
  const ohne = JSON.stringify({ events: stapel })
  const mit = JSON.stringify({ foundryId: WELT, events: stapel })
  // Grenze genau zwischen den beiden Groessen: nur wer die Kennung mitmisst, halbiert.
  const grenze = new Blob([ohne]).size + 1
  assert.ok(new Blob([mit]).size > grenze)
  const r = BeneosAnalytics._fitKeepalive(stapel, grenze, WELT)
  assert.equal(r.sendCount, 5)
  assert.deepEqual(JSON.parse(r.sendBody), { foundryId: WELT, events: stapel.slice(0, 5) })
})
