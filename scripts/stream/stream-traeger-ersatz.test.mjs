/**
 * Pruefsatz fuer den Traeger-Rueckfall am echten Abrufersatz (stre-T-173,
 * Kalt-Review cab0a2e).
 *
 * `stream-traeger.test.mjs` faehrt `offlineHalten` ohne `installStreamFetch`,
 * also wie im Download-Betrieb. Im Streaming-Betrieb laeuft jeder Abruf von
 * `offlineHalten` durch den Abrufersatz, und dessen Abweisungszweig hat
 * Nebenwirkungen: eine Konsolenzeile, einen Hinweis an die Spielleitung, das
 * Kartenschild. Bis stre-T-173 war eine Abweisung endgueltig und die Meldung
 * damit wahr. Mit dem Rueckfall ist sie es nur noch, wenn auch der letzte
 * Traeger abweist.
 *
 * Die Zwei-Werte-Probe:
 *   - zwei Traeger, der erste abgewiesen: geholt, und keine Meldung an den Kunden;
 *   - ein einziger Traeger, abgewiesen: gemeldet wie vorher.
 * Dazu: eine Adresse mit Abfrageteil wird bei einem Traeger nur einmal geholt.
 *
 * Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-traeger-ersatz.test.mjs
 */
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { pruefstand, installiereFoundry, netz, nimmAbrufe, meldungen } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, abschnitt, ende } = pruefstand("stream-traeger-ersatz, Rueckfall am echten Abrufersatz")

const HIER = dirname(fileURLToPath(import.meta.url))
const UI = join(HIER, "..", "..", "ui")
const MODULPFAD = "/modules/beneos-module/ui/"
const BASIS = "https://gate.beneos.stream"
const SCHLUESSEL = "k-attrappe-0002"
installiereFoundry({
  einstellungen: {
    "beneos-stream-mode": true,
    "beneos-stream-key": SCHLUESSEL,
    "beneos-stream-base": BASIS,
    // An: ohne Vorrat haelt `offlineHalten` nichts und fragt das Tor gar nicht.
    "beneos-stream-local-cache": true,
    "beneos-stream-offline-held": {},
    "beneos-stream-offline-shared": {},
  },
})

// Ein Cache Storage im Speicher, wie in stream-traeger.test.mjs.
const ablage = new Map()
{
  const schl = (anfrage, ohneSuche) => {
    const u = new URL(typeof anfrage === "string" ? anfrage : anfrage.url)
    if (ohneSuche) u.search = ""
    return u.href
  }
  const store = {
    async match(anfrage, opt) {
      const k = schl(anfrage, opt?.ignoreSearch)
      for (const [s, r] of ablage) if (schl(s, opt?.ignoreSearch) === k) return r.clone()
      return undefined
    },
    async put(anfrage, antwort) { ablage.set(schl(anfrage, false), antwort.clone()) },
    async delete(anfrage, opt) {
      const k = schl(anfrage, opt?.ignoreSearch)
      let weg = false
      for (const s of [...ablage.keys()]) if (schl(s, opt?.ignoreSearch) === k) { ablage.delete(s); weg = true }
      return weg
    },
    async keys() { return [...ablage.keys()].map((s) => new Request(s)) },
  }
  globalThis.caches = { async open() { return store }, async delete() { ablage.clear(); return true } }
}

// Konsolenzeilen der Abweisung mitschreiben, alles andere durchreichen.
const zeilen = []
{
  const warn = console.warn.bind(console)
  console.warn = (...a) => {
    const t = a.map(String).join(" ")
    if (t.includes("kein Material")) zeilen.push(t)
    else warn(...a)
  }
}

const einstellungen = await import("./stream-settings.mjs")
const f = await import("./stream-fetch.mjs")
const { assetUrl, GETEILT_RAUM } = einstellungen

const SHA = "c".repeat(64)
const SHA_EINS = "d".repeat(64)
const SHA_ZWEI = "e".repeat(64)
const NAME = "foundry_bm_ui.webp"
const KARTE_A = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0113/4k/map_assets/${NAME}`
const KARTE_B = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0042/hd/map_assets/${NAME}`
const KARTE_C = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0077/4k/map_assets/kompass.webp`
const KARTE_D = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0088/4k/map_assets/rose.webp`
const S_A = assetUrl(GETEILT_RAUM, SHA, NAME, { release: "beneos_bm_0113", variant: "4k" })
const S_B = assetUrl(GETEILT_RAUM, SHA, NAME, { release: "beneos_bm_0042", variant: "hd" })
const S_C = assetUrl(GETEILT_RAUM, SHA_EINS, "kompass.webp", { release: "beneos_bm_0077", variant: "4k" })
const S_D = assetUrl(GETEILT_RAUM, SHA_ZWEI, "rose.webp", { release: "beneos_bm_0088", variant: "4k" })
const S_D_ABFRAGE = `${S_D}?v=2`

const ohneAbfrage = (u) => String(u).split("?")[0]
const abgewiesen = new Set([S_A, S_C, S_D].map(ohneAbfrage))

netz((adresse) => {
  if (adresse.startsWith(MODULPFAD)) {
    const datei = join(UI, adresse.slice(MODULPFAD.length))
    if (!existsSync(datei)) return new Response("fehlt", { status: 404 })
    return new Response(readFileSync(datei), { status: 200, headers: { "Content-Type": "image/webp" } })
  }
  if (adresse === `${BASIS}/health`) return new Response("ok", { status: 200 })
  if (abgewiesen.has(ohneAbfrage(adresse))) {
    return new Response("p", { status: 200, headers: { "x-beneos-denied": "1", "content-type": "image/webp" } })
  }
  if (adresse === S_B) {
    return new Response("bild", { status: 200, headers: { "content-type": "image/webp", "content-length": "4" } })
  }
  return undefined
})
f.installStreamFetch()

const amTor = () => nimmAbrufe().map((a) => a.adresse)
  .filter((a) => a.startsWith(`${BASIS}/`) && a !== `${BASIS}/health` && !a.includes("/report"))
const hinweise = () => meldungen.filter((m) => m.art === "warn").length

/** Ruft und faengt: ein Wurf wird eine rote Probe, kein Absturz des Satzes. */
async function versuche(fn) {
  try { return await fn() } catch (e) { return { wurf: String(e?.message || e).slice(0, 120) } }
}
const ruhe = () => new Promise((r) => setTimeout(r, 0))

f.merkePruefsummen([[KARTE_A, SHA], [KARTE_B, SHA], [KARTE_C, SHA_EINS], [KARTE_D, SHA_ZWEI]])

abschnitt("Teil 1: zwei Traeger, der erste abgewiesen")
{
  nimmAbrufe()
  const r = await versuche(() => f.offlineHalten([S_A]))
  await ruhe()
  gleich("erst der erste, dann der zweite gefragt", JSON.stringify(amTor()), JSON.stringify([S_A, S_B]))
  gleich("die Datei ist geholt", r?.geholt, 1)
  gleich("kein Fehlschlag gezaehlt", r?.fehlgeschlagen, 0)
  gleich("sie liegt unter dem geteilten Schluessel", ablage.has(f.vorratsSchluessel(S_A)), true)
  gleich("kein Hinweis an die Spielleitung", hinweise(), 0)
  gleich("keine Konsolenzeile 'kein Material'", zeilen.length, 0)
}

abschnitt("Teil 2: ein Traeger, abgewiesen: gemeldet wie vorher")
{
  nimmAbrufe()
  const r = await versuche(() => f.offlineHalten([S_C]))
  await ruhe()
  gleich("genau ein Abruf", JSON.stringify(amTor()), JSON.stringify([S_C]))
  gleich("ein Traeger: Fehlschlag mit Grund abgewiesen", r?.gruende?.abgewiesen, 1)
  gleich("ein Hinweis an die Spielleitung", hinweise(), 1)
  gleich("eine Konsolenzeile fuer den Traeger", zeilen.filter((z) => z.includes("beneos_bm_0077/4k")).length, 1)
}

abschnitt("Teil 3: Abfrageteil, ein Traeger")
{
  nimmAbrufe()
  const r = await versuche(() => f.offlineHalten([S_D_ABFRAGE]))
  await ruhe()
  gleich("genau ein Abruf, auch mit Abfrageteil", amTor().length, 1)
  gleich("mit Abfrageteil: Fehlschlag mit Grund abgewiesen", r?.gruende?.abgewiesen, 1)
}

ende()
