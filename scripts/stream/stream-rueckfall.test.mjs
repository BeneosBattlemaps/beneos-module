/**
 * stream-rueckfall.test.mjs
 *
 * Rueckfall auf die Cloud-Liste, wenn der Stream-Katalog des Tors nicht
 * antwortet (stre-T-115). Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-rueckfall.test.mjs
 *
 * WARUM. Gemessen am 17.11.2026 auf v14 mit einer Route auf `/catalog/`: bei
 * 403 und bei 502 zeigte die Release-Ansicht nur die Fehlerkarte "Could not
 * load release list" und 0 Karten. Ohne Route waren es 151 Releases und 100
 * Karten. Die Liste gibt kein Recht; das Recht prueft das Tor beim Manifest.
 *
 * Betreiberentscheid 17.11.2026 ("Alle installierbar"): im Rueckfall ist jede
 * Zeile installierbar und traegt keinen Freischalt-Hinweis. Weist das Tor beim
 * Manifest ab, kommt ein verstaendlicher Text statt eines Parserfehlers.
 *
 * Geschnitten wird der echte Code aus `cloud-window-v2.mjs` mit
 * `tools/lib/extract-method.mjs`; die Datei selbst laesst sich in Node nicht
 * laden.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { extractMethod, buildProbe } from "../../tools/lib/extract-method.mjs"
import { pruefstand, installiereFoundry, netz } from "../../tools/lib/foundry-attrappe.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, "..", "..")
const { gleich, struktur, abschnitt, ende } = pruefstand("stream-rueckfall, Cloud-Liste wenn der Stream-Katalog scheitert")

const fensterText = readFileSync(join(WURZEL, "scripts/cloud-v2/cloud-window-v2.mjs"), "utf8")
const zustandText = readFileSync(join(WURZEL, "scripts/cloud-v2/beneos-install-state.mjs"), "utf8")

/** Schneidet, oder liefert null, wenn es die Stelle (noch) nicht gibt. */
function schnitt(text, name, grenzen) {
  try { return extractMethod(text, name, grenzen) } catch (_) { return null }
}

const teile = {
  holen: schnitt(fensterText, "#fetchReleasesWithBackoff", { maxZeilen: 60 }),
  cloud: schnitt(fensterText, "#cloudReleasesWithBackoff", { maxZeilen: 40 }),
  retry: schnitt(fensterText, "_onRetryLoadReleases", { maxZeilen: 25 }),
  ausCloud: schnitt(fensterText, "#releasesAusCloud", { maxZeilen: 12 }),
  zeilen: schnitt(fensterText, "rueckfallZeilen", { maxZeilen: 40 }),
  langform: schnitt(fensterText, "langformAusVarianten", { maxZeilen: 20 }),
}
struktur("cloud-window-v2.mjs: alle geschnittenen Stellen vorhanden",
  Object.entries(teile).filter(([, v]) => !v).map(([k]) => k).join(","), "")

const kern = extractMethod(zustandText, "releaseKern", { maxZeilen: 10 }).replace(/^export\s+/, "")
const vorspann = [kern, teile.langform ?? "", teile.zeilen ?? "function rueckfallZeilen(l) { return l }"].join("\n")

// Was die geschnittenen Methoden aus dem Fenster erwarten.
const Fenster = buildProbe([
  teile.holen ?? "  async #fetchReleasesWithBackoff() { throw new Error('fehlt') }",
  teile.cloud ?? "",
  teile.retry ?? "  static _onRetryLoadReleases() {}",
  teile.ausCloud ?? "  #releasesAusCloud() { return false }",
  "  searchMode = 'bmap'",
  "  gezeichnet = 0",
  "  geladen = 0",
  "  #renderResults() { this.gezeichnet++ }",
  "  #ensureReleasesLoaded() { this.geladen++ }",
  "  holen() { return this.#fetchReleasesWithBackoff() }",
  "  ausCloud() { return this.#releasesAusCloud() }",
], vorspann)
const rueckfallZeilen = new Function(`${vorspann}\nreturn rueckfallZeilen`)()

installiereFoundry({ einstellungen: {} })
globalThis.window = globalThis

// --------------------------------------------------------------- Attrappen

const TOR = [{ release_dir: "beneos_bm_0001_crystal_case", variant_dirs: { "4K": "beneos_bm_0001_crystal_case_foundry_4k" }, can_install: true }]
const CLOUD = () => [
  { release_dir: "bm_0001", variant_dirs: { "4K": "beneos_bm_0001_crystal_case_foundry_4k", HD: "beneos_bm_0001_crystal_case_foundry_hd" }, can_install: false, unlock_hint: { url: "https://www.patreon.com/x" } },
  { release_dir: "bm_0042", variant_dirs: { SINGLE: "beneos_bm_0042_tavern_foundry_single" }, can_install: false, unlock_hint: { url: "https://www.patreon.com/x" } },
]

let modus = true
let torAntwort = () => TOR
let torAbrufe = 0
globalThis.BeneosStream = {
  enabled: () => modus,
  listReleases: async () => { torAbrufe++; return torAntwort() },
}
let cloudAntwort = () => CLOUD()
let cloudAbrufe = 0
const manager = {
  _releasesCache: "voll",
  listReleases: async () => { cloudAbrufe++; return cloudAntwort() },
}
globalThis.BeneosScenePacker = manager
globalThis.ensureBeneosScenePacker = undefined

const warnungen = []
const urWarn = console.warn
console.warn = (...a) => { warnungen.push(a.map(String).join(" ")) }

/** Ein Lauf mit frischem Fenster; Wartezeiten des Backoffs sofort. */
async function lauf() {
  torAbrufe = 0; cloudAbrufe = 0; warnungen.length = 0
  const f = new Fenster()
  const urTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn) => urTimeout(fn, 0)
  let liste, fehler = null
  try { liste = await f.holen() } catch (e) { fehler = e?.message || String(e) }
  globalThis.setTimeout = urTimeout
  return { f, liste, fehler }
}
const fehlerVomTor = (status) => () => { throw new Error(`stream catalogue unavailable (${status})`) }

// --------------------------------------------------------------- Proben

abschnitt("Zweiwert: Tor 200 gegen Tor 403 und 502")
{
  torAntwort = () => TOR
  const r = await lauf()
  gleich("Tor 200: die Tor-Liste", r.liste === TOR || JSON.stringify(r.liste) === JSON.stringify(TOR), true)
  gleich("Tor 200: Quelle tor", r.f._releaseQuelle, "tor")
  gleich("Tor 200: die Cloud wird nicht gefragt", cloudAbrufe, 0)
}
for (const status of [403, 502]) {
  torAntwort = fehlerVomTor(status)
  const r = await lauf()
  gleich(`Tor ${status}: die Cloud-Liste`, Array.isArray(r.liste) && r.liste.length, 2)
  gleich(`Tor ${status}: Quelle cloud`, r.f._releaseQuelle, "cloud")
  gleich(`Tor ${status}: genau ein Torabruf`, torAbrufe, 1)
  gleich(`Tor ${status}: die Zeilen gehen durch den Rueckfall`,
    Array.isArray(r.liste) && r.liste.every((z) => z.can_install === true && z.release_dir.startsWith("beneos_")), true)
}

abschnitt("Andere Fehlschlaege des Tors")
{
  torAntwort = () => { throw new TypeError("Failed to fetch") }
  const r = await lauf()
  gleich("Netzfehler: die Cloud-Liste", Array.isArray(r.liste) && r.liste.length, 2)
  torAntwort = () => { throw new Error("stream catalogue malformed") }
  const r2 = await lauf()
  gleich("unlesbare Antwort: die Cloud-Liste", Array.isArray(r2.liste) && r2.liste.length, 2)
  gleich("Warnung ohne Adresse und ohne Schluessel", warnungen.some((w) => /https?:|catalog\//.test(w)), false)
  gleich("genau eine Warnung zum Rueckfall", warnungen.filter((w) => /stream catalogue/i.test(w)).length, 1)
}

abschnitt("Tor scheitert und die Cloud auch")
{
  torAntwort = fehlerVomTor(403)
  globalThis.BeneosScenePacker = undefined
  const r = await lauf()
  gleich("ohne Manager: BENEOS_NEEDS_LOGIN wie heute", r.fehler, "BENEOS_NEEDS_LOGIN")
  globalThis.BeneosScenePacker = manager
  cloudAntwort = () => { throw new Error("cloud weg") }
  const r2 = await lauf()
  gleich("Cloud scheitert dreimal: ihr Fehler wird geworfen", `${r2.fehler}|${cloudAbrufe}`, "cloud weg|3")
  cloudAntwort = () => CLOUD()
}

abschnitt("Modus aus")
{
  modus = false
  torAntwort = () => TOR
  const r = await lauf()
  gleich("Modus aus: das Tor wird nicht gefragt", torAbrufe, 0)
  gleich("Modus aus: die Cloud-Liste unveraendert", JSON.stringify(r.liste), JSON.stringify(CLOUD()))
  gleich("Modus aus: keine Rueckfall-Quelle", r.f._releaseQuelle === "cloud", false)
  modus = true
}

abschnitt("Retry fragt zuerst wieder das Tor")
{
  torAntwort = fehlerVomTor(502)
  const r = await lauf()
  const vorRetry = r.f._releaseQuelle
  Fenster._onRetryLoadReleases.call(r.f, { preventDefault() {} })
  gleich("Retry setzt die Quelle zurueck", `${vorRetry}|${r.f._releaseQuelle ?? null}`, "cloud|null")
  gleich("Retry laedt neu", r.f.geladen, 1)
}

abschnitt("rueckfallZeilen")
{
  const ein = CLOUD()
  const vorher = JSON.stringify(ein)
  const aus = rueckfallZeilen(ein)
  gleich("4K/HD: Langform aus variant_dirs", aus[0]?.release_dir, "beneos_bm_0001_crystal_case")
  gleich("SINGLE: Langform aus variant_dirs", aus[1]?.release_dir, "beneos_bm_0042_tavern")
  gleich("installierbar", aus.every((z) => z.can_install === true), true)
  gleich("kein Freischalt-Hinweis", aus.every((z) => z.unlock_hint === null), true)
  gleich("die Eingabeliste bleibt unveraendert", JSON.stringify(ein), vorher)
  gleich("variant_dirs bleiben", JSON.stringify(aus[0]?.variant_dirs), JSON.stringify(ein[0].variant_dirs))

  const nichts = rueckfallZeilen([{ release_dir: "bm_0007", variant_dirs: {}, can_install: false }])
  gleich("ohne Ableitung bleibt die Kurzform", nichts[0]?.release_dir, "bm_0007")
  const fremd = rueckfallZeilen([{ release_dir: "bm_0007", variant_dirs: { "4K": "beneos_bm_0008_anders_foundry_4k" } }])
  gleich("anderer Kern: die Kurzform bleibt", fremd[0]?.release_dir, "bm_0007")
  const ohneEndung = rueckfallZeilen([{ release_dir: "bm_0009", variant_dirs: { "4K": "beneos_bm_0009_ohne_endung" } }])
  gleich("ohne _foundry_-Endung: die Kurzform bleibt", ohneEndung[0]?.release_dir, "bm_0009")
  // Der Verbraucher (#ensureReleasesLoaded) vertraegt beides; hier darf es nicht werfen.
  let keineListe
  try { keineListe = rueckfallZeilen(null) } catch (_) { keineListe = "wirft" }
  gleich("keine Liste: unveraendert zurueck", keineListe, null)
  let leer
  try { leer = JSON.stringify(rueckfallZeilen([null])) } catch (_) { leer = "wirft" }
  gleich("leere Zeile: unveraendert zurueck", leer, "[null]")
}

abschnitt("Kontext und Vorlage")
{
  const f = new Fenster()
  f._releaseIndex = new Map([["x", {}]])
  f._releaseQuelle = "cloud"
  gleich("Hinweis: Quelle cloud mit Index", f.ausCloud(), true)
  f._releaseQuelle = "tor"
  gleich("kein Hinweis: Quelle tor", f.ausCloud(), false)
  f._releaseQuelle = "cloud"
  f._releaseIndex = null
  gleich("kein Hinweis: ohne Index", f.ausCloud(), false)
  f._releaseIndex = new Map([["x", {}]])
  f.searchMode = "token"
  gleich("kein Hinweis: anderer Reiter", f.ausCloud(), false)

  struktur("der Kontext reicht bmapReleasesAusCloud durch",
    /bmapReleasesAusCloud:\s*this\.#releasesAusCloud\(\)/.test(fensterText), true)
  const vorlage = readFileSync(join(WURZEL, "templates/cloud-v2/parts/results-pane.hbs"), "utf8")
  const block = vorlage.slice(vorlage.indexOf("{{#if isBmap}}"), vorlage.indexOf("{{/if}}", vorlage.indexOf("{{#if bmapReleasesAusCloud}}")) + 7)
  const zeile = vorlage.split("\n").find((z) => z.includes("BENEOS.Cloud.Bmap.ReleasesFromCloud")) ?? ""
  struktur("die Vorlage zeigt den Hinweis im Battlemap-Block",
    block.includes("{{#if bmapReleasesAusCloud}}") && block.includes("BENEOS.Cloud.Bmap.ReleasesFromCloud"), true)
  struktur("der Hinweis steht ohne Icon", zeile.length > 0 && !zeile.includes("<i class="), true)
}

abschnitt("Sprachen")
{
  const ordner = join(WURZEL, "lang")
  const dateien = readdirSync(ordner).filter((n) => n.endsWith(".json"))
  const modul = JSON.parse(readFileSync(join(WURZEL, "module.json"), "utf8"))
  gleich("jede Sprache aus module.json hat eine Datei",
    (modul.languages ?? []).every((l) => dateien.includes(String(l.path).split("/").pop())), true)
  const lies = (n) => JSON.parse(readFileSync(join(ordner, n), "utf8"))
  const wert = (j, pfad) => pfad.split(".").reduce((x, k) => (x == null ? x : x[k]), j) ?? j[pfad]
  for (const schluessel of ["BENEOS.Cloud.Bmap.ReleasesFromCloud", "BENEOS.Stream.ManifestDenied"]) {
    const fehlt = dateien.filter((n) => {
      const w = wert(lies(n), schluessel)
      return typeof w !== "string" || !w.trim() || /[–—]/.test(w)
    })
    gleich(`${schluessel}: in jeder Sprache, nicht leer, ohne Gedankenstrich`, fehlt.join(","), "")
  }
}

abschnitt("Manifest: Abweisung durch das Tor")
{
  installiereFoundry({ einstellungen: { "beneos-stream-key": "pk_rueckfall_attrappe", "beneos-stream-base": "https://gate.beneos.stream", "beneos-stream-mode": true } })
  globalThis.game.i18n.localize = (k) => (k === "BENEOS.Stream.ManifestDenied" ? "Streaming is not available (lokalisiert)" : k)
  const { loadStreamManifest } = await import("./stream-install.mjs")
  const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 59])
  netz(() => new Response(gif, { status: 200, headers: { "content-type": "image/gif", "x-beneos-denied": "1" } }))
  let text = ""
  try { await loadStreamManifest("beneos_bm_0001_crystal_case", "4K") } catch (e) { text = e?.message || String(e) }
  gleich("abgewiesen: der lokalisierte Text", text, "Streaming is not available (lokalisiert)")

  netz(() => new Response(JSON.stringify({ entries: [] }), { status: 200, headers: { "content-type": "application/json" } }))
  let gelesen = null
  try { gelesen = await loadStreamManifest("beneos_bm_0001_crystal_case", "4K") } catch (e) { gelesen = e?.message || String(e) }
  gleich("ohne Abweisung: das Manifest wird gelesen wie heute", Array.isArray(gelesen?.entries), true)
}

console.warn = urWarn
ende()
