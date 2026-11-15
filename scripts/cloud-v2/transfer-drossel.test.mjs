/**
 * transfer-drossel.test.mjs
 *
 * Gegenprobe zu `transfer-drossel.mjs`, ohne Foundry:
 *
 *   node --test scripts/cloud-v2/transfer-drossel.test.mjs
 *
 * TICK-17: Ein Kunde verlor 2 von 254 Dateien, weil der Installer bei HTTP 429
 * nach 2 s aufgab und auf The Forge kein spaeterer Lauf die Luecke nachholte.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync, readdirSync } from "node:fs"
import {
  retryAfterMs, wartezeit429, Bahnsteuerung, runPool, naechsteLuecken, reparaturKandidaten, entscheide429,
  RATE_WAIT_MAX_MS, RATE_MAX_ATTEMPTS, RATE_TOTAL_MAX_MS, ERHOLUNG_NACH,
} from "./transfer-drossel.mjs"

/** Uhr, die nur auf Zuruf weiterlaeuft; schlafe() rueckt sie sofort vor. */
function testUhr(start = 1_000_000) {
  const u = { t: start, geschlafen: [] }
  u.jetzt = () => u.t
  u.schlafe = async (ms) => { u.geschlafen.push(ms); u.t += ms }
  return u
}

test("Retry-After: Sekunden, HTTP-Datum, ungueltig, leer", () => {
  const jetzt = Date.parse("2026-11-15T12:00:00Z")
  assert.equal(retryAfterMs("30", jetzt), 30000)
  assert.equal(retryAfterMs(" 0 ", jetzt), 0)
  assert.equal(retryAfterMs("Sun, 15 Nov 2026 12:00:20 GMT", jetzt), 20000)
  assert.equal(retryAfterMs("Sun, 15 Nov 2026 11:59:00 GMT", jetzt), 0)
  assert.equal(retryAfterMs("bald", jetzt), null)
  assert.equal(retryAfterMs("-5", jetzt), null)
  assert.equal(retryAfterMs("", jetzt), null)
  assert.equal(retryAfterMs(null, jetzt), null)
})

test("Wartezeit ohne Header: 5, 15, 30 s; mit Header gedeckelt", () => {
  assert.deepEqual([1, 2, 3, 4].map(v => wartezeit429(v, null)), [5000, 15000, 30000, 30000])
  assert.equal(wartezeit429(1, 12000), 12000)
  assert.equal(wartezeit429(1, 3600 * 1000), RATE_WAIT_MAX_MS)
  assert.equal(wartezeit429(1, 0), 0)
  assert.ok(RATE_MAX_ATTEMPTS >= 4)
})

test("Halbieren einmal je Drossel-Ereignis: 6, 3, 1, 1; gemeinsame Pause", async () => {
  const u = testUhr()
  const s = new Bahnsteuerung({ decke: 6, jetzt: u.jetzt, schlafe: u.schlafe })
  assert.equal(s.lanes, 6)
  assert.equal(s.bei429(5000), 5000); assert.equal(s.lanes, 3)
  // Weitere 429 in DIESELBE Pause halbieren nicht noch einmal, und die Pause
  // verlaengert sich nur auf das spaetere Ende.
  assert.equal(s.bei429(3000), 3000); assert.equal(s.lanes, 3)
  assert.equal(s.bei429(5000), 5000); assert.equal(s.lanes, 3)
  assert.equal(s.restPauseMs(), 5000)
  await s.warte()
  assert.equal(s.pausiert(), false)
  assert.equal(u.t, 1_000_000 + 5000)
  s.bei429(1000); assert.equal(s.lanes, 1)
  u.t += 1000
  s.bei429(1000); assert.equal(s.lanes, 1)
})

test("erwerbe/gib: nach einer Pause laufen hoechstens lanes Abrufe gleichzeitig", async () => {
  const s = new Bahnsteuerung({ decke: 6 })
  s.lanes = 1
  let laufend = 0
  let hoechst = 0
  await Promise.all(Array.from({ length: 6 }, async () => {
    await s.erwerbe()
    try {
      laufend += 1; hoechst = Math.max(hoechst, laufend)
      await new Promise(r => setTimeout(r, 2))
      laufend -= 1
    } finally { s.gib() }
  }))
  assert.equal(hoechst, 1)
  assert.equal(s.laufend, 0)
})

test("erwerbe: eine Erholung weckt Wartende", async () => {
  const s = new Bahnsteuerung({ decke: 6 })
  s.lanes = 1
  await s.erwerbe()
  let zweiter = false
  const p = s.erwerbe().then(() => { zweiter = true })
  await new Promise(r => setImmediate(r))
  assert.equal(zweiter, false)
  for (let i = 0; i < ERHOLUNG_NACH; i++) s.beiErfolg()
  await p
  assert.equal(zweiter, true)
  assert.equal(s.laufend, 2)
})

test("entscheide429: warten, aufgeben, wie-5xx", () => {
  const u = testUhr()
  const s = new Bahnsteuerung({ decke: 6, jetzt: u.jetzt, schlafe: u.schlafe, gesamtMaxMs: 20000 })
  assert.deepEqual(entscheide429(s, 1, null), { aktion: "warten", ms: 5000 })
  u.t += 5000
  assert.deepEqual(entscheide429(s, 2, null), { aktion: "warten", ms: 15000 })
  u.t += 15000
  assert.deepEqual(entscheide429(s, 3, null), { aktion: "wie-5xx" })
  assert.deepEqual(entscheide429(s, RATE_MAX_ATTEMPTS, null), { aktion: "aufgeben" })
})

test("Erholung schrittweise bis zur Decke, nie darueber; ein 429 setzt die Serie zurueck", () => {
  const u = testUhr()
  const s = new Bahnsteuerung({ decke: 6, jetzt: u.jetzt, schlafe: u.schlafe })
  s.bei429(1000); u.t += 1000; s.bei429(1000); u.t += 1000
  assert.equal(s.lanes, 1)
  for (let i = 0; i < ERHOLUNG_NACH - 1; i++) s.beiErfolg()
  assert.equal(s.lanes, 1)
  s.bei429(1000); u.t += 1000
  for (let i = 0; i < ERHOLUNG_NACH - 1; i++) s.beiErfolg()
  assert.equal(s.lanes, 1, "Serie nach 429 neu begonnen")
  for (let i = 0; i < ERHOLUNG_NACH * 20; i++) s.beiErfolg()
  assert.equal(s.lanes, 6)
})

test("Duenn-Leitungs-Decke bleibt: Erholung hoechstens bis 2", () => {
  const u = testUhr()
  const s = new Bahnsteuerung({ decke: 6, jetzt: u.jetzt, schlafe: u.schlafe })
  s.bei429(1000); u.t += 1000; s.bei429(1000); u.t += 1000
  s.setzeDecke(2)
  for (let i = 0; i < ERHOLUNG_NACH * 20; i++) s.beiErfolg()
  assert.equal(s.lanes, 2)
  assert.equal(s.decke, 2)
  s.setzeDecke(6)
  assert.equal(s.decke, 2, "die Decke sinkt nur")
})

test("Gesamtobergrenze: danach keine langen Pausen mehr", () => {
  const u = testUhr()
  const s = new Bahnsteuerung({ decke: 6, jetzt: u.jetzt, schlafe: u.schlafe })
  let gewartet = 0
  for (let i = 0; i < 100; i++) {
    const w = s.bei429(RATE_WAIT_MAX_MS)
    if (w === null) break
    gewartet += w
    u.t += w
  }
  assert.equal(gewartet, RATE_TOTAL_MAX_MS)
  assert.equal(s.bei429(5000), null)
})

test("runPool: jedes Item genau einmal, Bahnen fallen auf 1 und steigen wieder", async () => {
  // Uhr laeuft hier nicht: zwei 429 nacheinander sind dann ein Ereignis, nicht
  // zwei. Darum zwei Uhren-Schritte, damit die Bahnen auf 1 fallen.
  const u = testUhr()
  const s = new Bahnsteuerung({ decke: 6, jetzt: u.jetzt, schlafe: u.schlafe })
  const orig429 = s.bei429.bind(s)
  s.bei429 = (ms) => { const r = orig429(ms); u.t += ms; return r }
  const items = Array.from({ length: 120 }, (_, i) => i)
  const gesehen = new Map()
  let laufend = 0
  const belegung = []
  await runPool(items, 6, async (i) => {
    laufend += 1
    belegung.push(laufend)
    gesehen.set(i, (gesehen.get(i) || 0) + 1)
    await new Promise(r => setImmediate(r))
    if (i === 10) { s.bei429(1); s.bei429(1) }
    else s.beiErfolg()
    laufend -= 1
  }, s)
  assert.equal(gesehen.size, 120)
  assert.ok([...gesehen.values()].every(n => n === 1))
  assert.equal(Math.max(...belegung.slice(0, 6)), 6)
  // Nach dem 429 laufen die sechs angefangenen Uebertragungen aus, danach
  // arbeitet eine einzige Bahn, bis ERHOLUNG_NACH Erfolge eine zweite bringen.
  const eins = belegung.indexOf(1, 11)
  assert.ok(eins > 10 && eins <= 17, `nach dem 429 laeuft bald nur eine Bahn (ab Start ${eins})`)
  assert.ok(Math.max(...belegung.slice(eins, eins + 3)) === 1, "und bleibt es bis zur Erholung")
  assert.ok(Math.max(...belegung.slice(-10)) >= 2, "die Bahnen haben sich erholt")
  assert.ok(Math.max(...belegung) <= 6)
})

test("runPool loest erst auf, wenn auch nachtraeglich gestartete Bahnen fertig sind", async () => {
  const budget = { lanes: 1 }
  const fertig = new Set()
  await runPool([0, 1, 2, 3, 4, 5], 6, async (i) => {
    if (i === 0) budget.lanes = 6
    await new Promise(r => setTimeout(r, i === 5 ? 30 : 1))
    fertig.add(i)
  }, budget)
  assert.equal(fertig.size, 6)
})

test("runPool ohne Budget und mit leerer Liste", async () => {
  await runPool([], 6, async () => { throw new Error("nie") })
  let n = 0
  await runPool([1, 2, 3], 6, async () => { n += 1 })
  assert.equal(n, 3)
})

test("naechsteLuecken: gescopter sauberer Lauf loescht fremde Luecken nicht", () => {
  const vorher = ["a/map3.webp", "a/map7.webp"]
  assert.deepEqual(naechsteLuecken(vorher, new Set(["a/map7.webp"]), []), ["a/map3.webp"])
  assert.deepEqual(naechsteLuecken(vorher, new Set(), ["a/map9.webp"]), ["a/map3.webp", "a/map7.webp", "a/map9.webp"])
  assert.deepEqual(naechsteLuecken(undefined, new Set(), []), [])
  assert.deepEqual(naechsteLuecken("kaputt", new Set(), ["x"]), ["x"])
  // Ein Ziel, das in diesem Lauf erst scheiterte und dann repariert wurde,
  // steht nicht mehr in den Fehlschlaegen und faellt heraus.
  assert.deepEqual(naechsteLuecken(["x"], new Set(["x"]), []), [])
  // Ungescopter Lauf: eine Luecke, die es im Release nicht mehr gibt, faellt weg;
  // gescopt (releaseZiele null) bleibt sie stehen.
  assert.deepEqual(naechsteLuecken(["alt/v1.webp", "a"], new Set(), [], new Set(["a", "b"])), ["a"])
  assert.deepEqual(naechsteLuecken(["alt/v1.webp", "a"], new Set(), [], null), ["a", "alt/v1.webp"])
})

test("reparaturKandidaten: vorige Luecken auch auf Forge, nur fuer Ziele dieses Laufs", () => {
  const assets = [{ target: "a" }, { target: "b" }, { target: "c" }]
  const k = reparaturKandidaten({ assets, fehler: [{ target: "a", category: "server" }], vorigeLuecken: ["b", "fremd"] })
  assert.deepEqual(k.map(x => x.target), ["a", "b"])
  const hoffnungslos = reparaturKandidaten({ assets, fehler: [{ target: "a", category: "toolarge" }], vorigeLuecken: ["a"], hoffnungslosKategorie: "toolarge" })
  assert.deepEqual(hoffnungslos.map(x => x.target), [], "toolarge dieses Laufs wird nicht erneut geholt")
  // Eine vorige Luecke, die dieser Lauf schon uebertragen hat, wird nicht noch einmal geholt;
  // ein Fehlschlag dieses Laufs gilt trotzdem.
  const schonDa = reparaturKandidaten({ assets, fehler: [{ target: "c", category: "server" }], vorigeLuecken: ["b", "c"], erledigt: new Set(["b", "c"]) })
  assert.deepEqual(schonDa.map(x => x.target), ["c"])
  // Ohne genannte Kategorie gilt nichts als hoffnungslos.
  const ohne = reparaturKandidaten({ assets, fehler: [{ target: "a", category: "toolarge" }], vorigeLuecken: [] })
  assert.deepEqual(ohne.map(x => x.target), ["a"])
})

test("Ende-zu-Ende: 429 mit und ohne Retry-After gegen echten HTTP-Server", async () => {
  let zaehler = 0
  const server = createServer((req, res) => {
    zaehler += 1
    if (req.url === "/mit" && zaehler <= 2) { res.writeHead(429, { "Retry-After": "7" }); return res.end() }
    if (req.url === "/ohne" && zaehler <= 3) { res.writeHead(429); return res.end() }
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok")
  })
  await new Promise(r => server.listen(0, "127.0.0.1", r))
  const basis = `http://127.0.0.1:${server.address().port}`
  // Dieselben Bausteine wie #fetchAsset: erwerbe/gib um den Abruf, Retry-After
  // aus dem Header, entscheide429 fuer die Wahl. Die Schleife selbst ist im
  // Installer an Foundry gebunden und hier nicht ladbar (Nicht pruefbar).
  async function hole(pfad, u) {
    const s = new Bahnsteuerung({ decke: 6, jetzt: u.jetzt, schlafe: u.schlafe })
    for (let rate = 0; ;) {
      await s.erwerbe()
      let r
      try { r = await fetch(basis + pfad, { cache: "no-store" }) } finally { s.gib() }
      if (r.ok) { s.beiErfolg(); return await r.text() }
      if (r.status !== 429) throw new Error("HTTP " + r.status)
      rate += 1
      const e = entscheide429(s, rate, retryAfterMs(r.headers.get("retry-after"), Date.now()))
      if (e.aktion !== "warten") throw new Error("HTTP 429 " + e.aktion)
    }
  }
  try {
    zaehler = 0
    const u1 = testUhr()
    assert.equal(await hole("/mit", u1), "ok")
    assert.deepEqual(u1.geschlafen, [7000, 7000])
    zaehler = 0
    const u2 = testUhr()
    assert.equal(await hole("/ohne", u2), "ok")
    assert.deepEqual(u2.geschlafen, [5000, 15000, 30000])
  } finally {
    server.close()
  }
})

// U+2013 und U+2014 ueber ihre Codes, damit die Zeichen selbst nicht im Quelltext stehen.
const GEDANKENSTRICH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]")

test("Sprachen: Schluessel in jeder Datei, gleicher Platzhalter, hoechstens 80 Zeichen, kein Gedankenstrich", () => {
  const dir = new URL("../../lang/", import.meta.url)
  const dateien = readdirSync(dir).filter(f => f.endsWith(".json"))
  const module = JSON.parse(readFileSync(new URL("../../module.json", import.meta.url), "utf8"))
  assert.equal(dateien.length, module.languages.length)
  for (const f of dateien) {
    const lang = JSON.parse(readFileSync(new URL(f, dir), "utf8"))
    const text = lang["BENEOS.Cloud.Install.RateLimited"]
    assert.equal(typeof text, "string", `${f}: Schluessel fehlt`)
    assert.ok(text.includes("{seconds}"), `${f}: {seconds} fehlt`)
    assert.ok(text.replace("{seconds}", "60").length <= 80, `${f}: laenger als 80 Zeichen`)
    assert.ok(!GEDANKENSTRICH.test(text), `${f}: Gedankenstrich`)
  }
})
