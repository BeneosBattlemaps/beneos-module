/**
 * stream-klangwache.test.mjs (stre-T-172)
 *
 * Die Klangwache in stream-online.mjs meldet einen Torklang, der MIT
 * Verbindung scheitert. Gemeldet werden darf "nicht im Zugang" nur, wenn das
 * Tor es sagt (`x-beneos-denied`). Ein reiner Netzfehler oder ein 5xx ist kein
 * fehlender Zugang, und der Kunde laese sonst einen falschen Grund.
 *
 * Zwei-Werte-Probe: derselbe gescheiterte Klang, einmal mit Netzfehler, einmal
 * mit 503 ohne Kopf, einmal mit dem denied-Kopf. Nur der letzte meldet.
 *
 * Nichts geht ins Netz: `fetch` ist eine Attrappe, `foundry.audio.Sound`
 * ebenso. Die Wache wird ueber `installStreamOnline` eingebaut, wie im Modul.
 *
 * Aufruf: node scripts/stream/stream-klangwache.test.mjs
 */

const TOR = "https://gate.beneos.stream"
const SCHLUESSEL = "pk_pruefsatz_klangwache"
const KLANG = (n) => `${TOR}/a/${SCHLUESSEL}/beneos_battlemaps_0042/var1/klang_${n}.ogg`
const einstellungen = new Map()

let warnungen = []
globalThis.game = {
  settings: {
    get(modul, name) {
      const k = `${modul}.${name}`
      if (!einstellungen.has(k)) throw new Error(`nicht registriert: ${k}`)
      return einstellungen.get(k)
    },
  },
  i18n: { localize: (s) => `T:${s}`, format: (s) => `T:${s}` },
  user: { isGM: true },
}
globalThis.ui = { notifications: { warn: (t) => warnungen.push(String(t)) } }
globalThis.Hooks = { on() {}, once() {}, callAll() {} }
globalThis.addEventListener = () => {}
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true })

// Die Antwort des Tors je Klang: "netz" wirft wie ein Netzfehler, "503" ohne
// Kopf, "denied" 200 mit x-beneos-denied. Die Probe /health antwortet immer 200.
const antworten = new Map()
const klangAbrufe = []
const ablauf = []
globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input)
  if (url.endsWith("/health")) return new Response("ok", { status: 200 })
  klangAbrufe.push({ url, method: String(init?.method || "GET").toUpperCase(), signal: init?.signal })
  const art = antworten.get(url)
  if (art === "netz") throw new TypeError("Failed to fetch")
  if (art === "abbruch") throw new DOMException("The operation was aborted.", "AbortError")
  if (art === "503") return new Response("", { status: 503 })
  if (art === "denied") return new Response("", { status: 200, headers: { "x-beneos-denied": "1" } })
  if (art === "spaet") {
    await new Promise((r) => setTimeout(r, 50))
    ablauf.push("antwort")
  }
  return new Response("", { status: 200 })
}
const abrufeVon = (url) => klangAbrufe.filter((a) => a.url === url)
let unbehandelt = 0
process.on("unhandledRejection", () => { unbehandelt += 1 })

// Ein Klang wie Foundrys Sound: `load` setzt `failed`, wenn das <audio> nicht
// laedt. Ob er scheitert, sagt die Probe.
let naechsterScheitert = true
let waehrendLaden = null
class Sound {
  constructor(src) { this.src = src; this.failed = false }
  async load() {
    if (waehrendLaden) waehrendLaden()
    this.failed = naechsterScheitert
    return this
  }
}
globalThis.foundry = { audio: { Sound } }

const { MODULE_ID, SETTING } = await import("./stream-settings.mjs")
einstellungen.set(`${MODULE_ID}.${SETTING.mode}`, true)
einstellungen.set(`${MODULE_ID}.${SETTING.key}`, SCHLUESSEL)
einstellungen.set(`${MODULE_ID}.${SETTING.base}`, TOR)
const online = await import("./stream-online.mjs")
online.installStreamOnline()

let rot = 0
let gruen = 0
function gleich(name, ist, soll) {
  const ok = ist === soll
  if (ok) { gruen++; console.log(`  ok   ${name}`) }
  else { rot++; console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}\n       ist  ${JSON.stringify(ist)}`) }
}
// Die Meldung laeuft ueber einen Import zur Laufzeit und ohne await.
const ruhe = () => new Promise((r) => setTimeout(r, 30))

await ruhe()
if (online.isOffline()) {
  console.log("\nNICHT PRUEFBAR: der Zustand ist nicht online")
  process.exit(2)
}
gleich("Vorbedingung: der Klang laeuft ueber die Wache", Sound.prototype.load.__beneosStream, true)

console.log("\nEin Torklang, der laedt")
{
  naechsterScheitert = false
  await new Sound(KLANG(0)).load()
  await ruhe()
  gleich("geladener Klang: keine Nachfrage", abrufeVon(KLANG(0)).length, 0)
  gleich("und keine Meldung", warnungen.length, 0)
  naechsterScheitert = true
}

console.log("\nEin online gescheiterter Torklang")
{
  antworten.set(KLANG(1), "netz")
  await new Sound(KLANG(1)).load()
  await ruhe()
  gleich("Netzfehler: keine Meldung \"nicht im Zugang\"", warnungen.length, 0)
  gleich("gescheiterter Klang: genau eine Nachfrage", abrufeVon(KLANG(1)).length, 1)
  gleich("und zwar als HEAD", abrufeVon(KLANG(1))[0]?.method, "HEAD")
  gleich("mit eigener Zeitgrenze", abrufeVon(KLANG(1))[0]?.signal instanceof AbortSignal, true)
  await new Sound(KLANG(1)).load()
  await ruhe()
  gleich("derselbe Klang noch einmal, auch nach gescheiterter Nachfrage: keine zweite", abrufeVon(KLANG(1)).length, 1)
}
{
  antworten.set(KLANG(2), "503")
  await new Sound(KLANG(2)).load()
  await ruhe()
  gleich("503 ohne Kopf: keine Meldung \"nicht im Zugang\"", warnungen.length, 0)
}
{
  // Etwa ein Codec-Fehler: das Tor liefert die Datei, der Browser spielt sie nicht.
  antworten.set(KLANG(4), "200")
  await new Sound(KLANG(4)).load()
  await ruhe()
  gleich("200 ohne Kopf, trotzdem gescheitert: keine Meldung", warnungen.length, 0)
}
{
  antworten.set(KLANG(5), "abbruch")
  await new Sound(KLANG(5)).load()
  await ruhe()
  gleich("abgebrochene Nachfrage: keine Meldung", warnungen.length, 0)
  gleich("und keine unbehandelte Ablehnung", unbehandelt, 0)
}
{
  antworten.set(KLANG(6), "spaet")
  await new Sound(KLANG(6)).load()
  ablauf.push("geladen")
  await new Promise((r) => setTimeout(r, 120))
  gleich("die Nachfrage haelt den Klang nicht auf", ablauf.join(","), "geladen,antwort")
}
{
  antworten.set(KLANG(3), "denied")
  await new Sound(KLANG(3)).load()
  await ruhe()
  gleich("denied-Kopf: genau eine Meldung", warnungen.length, 1)
  gleich("und zwar die fuer den Zugang", warnungen[0], "T:BENEOS.Stream.Notice.Denied")
}

console.log("\nOffline")
{
  // Die Verbindung reisst WAEHREND des Ladens ab: die Wache liess den Klang
  // noch durch, aber nach dem Scheitern fragt sie nicht mehr nach.
  const vorher = klangAbrufe.length
  waehrendLaden = () => {
    navigator.onLine = false
    online.noteResult(false, "pruefsatz")
  }
  await new Sound(KLANG(8)).load()
  waehrendLaden = null
  await ruhe()
  if (!online.isOffline()) {
    console.log("\nNICHT PRUEFBAR: der Zustand laesst sich nicht auf offline stellen")
    process.exit(2)
  }
  gleich("offline waehrend des Ladens: keine Nachfrage", klangAbrufe.length, vorher)
}
{
  const vorher = klangAbrufe.length
  await new Sound(KLANG(7)).load()
  await ruhe()
  gleich("offline: keine Nachfrage", klangAbrufe.length, vorher)
  gleich("offline: die Meldung ist die fuer offline", warnungen[1], "T:BENEOS.Stream.Notice.Offline")
}

console.log("\nDie Zeitgrenze")
{
  const { readFileSync } = await import("node:fs")
  const quelle = readFileSync(new URL("./stream-online.mjs", import.meta.url), "utf8")
  const m = /const KLANG_NACHFRAGE_MS = (\d+)/.exec(quelle)
  const ms = m ? Number(m[1]) : NaN
  gleich("[Struktur] die Nachfrage hat eine Zeitgrenze von 1 bis 10 Sekunden", ms >= 1000 && ms <= 10000, true)
  gleich("[Struktur] und nimmt sie als AbortSignal.timeout", /signal: AbortSignal\.timeout\(KLANG_NACHFRAGE_MS\)/.test(quelle), true)
}

console.log(`\n${gruen} bestanden, ${rot} gescheitert`)
process.exit(rot ? 1 : 0)
