/**
 * Pruefsatz fuer den Rueckfall auf einen zweiten Traeger (stre-T-173).
 *
 * Eine geteilte Datei hat keine eigene Freigabe. Das Tor prueft das Recht an
 * einer Karte, die sie fuehrt, dem Traeger (T-052, T-056). Fuehren zwei Karten
 * dieselbe Datei, gibt es zwei moegliche /s/-Adressen. Bis stre-T-173 nahm
 * `geteilteAdresse` immer die erste, und wurde die abgewiesen, blieb die Datei
 * unerreichbar, obwohl die zweite Karte ging.
 *
 * Die Zwei-Werte-Probe:
 *   - zwei Traeger, der erste abgewiesen: der zweite wird genommen;
 *   - ein einziger Traeger, abgewiesen: es aendert sich nichts.
 *
 * Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-traeger.test.mjs
 */
import { pruefstand, installiereFoundry, netz, nimmAbrufe } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, abschnitt, ende } = pruefstand("stream-traeger, Rueckfall auf den naechsten Traeger")

const BASIS = "https://gate.beneos.stream"
const SCHLUESSEL = "k-attrappe-0001"
installiereFoundry({
  einstellungen: {
    "beneos-stream-mode": true,
    "beneos-stream-key": SCHLUESSEL,
    "beneos-stream-base": BASIS,
    "beneos-stream-offline-held": {},
    "beneos-stream-offline-shared": {},
  },
})

// Ein Cache Storage im Speicher, wie in stream-zusage.test.mjs.
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

const einstellungen = await import("./stream-settings.mjs")
const f = await import("./stream-fetch.mjs")
const { assetUrl, GETEILT_RAUM } = einstellungen

// Ueber den Namensraum: fehlt eine Funktion, wird der Satz ROT statt beim Laden abzubrechen.
const geteilteAdresse = (...a) =>
  typeof einstellungen.geteilteAdresse === "function" ? einstellungen.geteilteAdresse(...a) : "FEHLT"

const SHA = "a".repeat(64)
const SHA_EINS = "b".repeat(64)
const NAME = "foundry_bm_ui.webp"
const KARTE_A = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0113/4k/map_assets/${NAME}`
const KARTE_B = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0042/hd/map_assets/${NAME}`
const KARTE_C = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0077/4k/map_assets/kompass.webp`
const S_A = assetUrl(GETEILT_RAUM, SHA, NAME, { release: "beneos_bm_0113", variant: "4k" })
const S_B = assetUrl(GETEILT_RAUM, SHA, NAME, { release: "beneos_bm_0042", variant: "hd" })
const S_C = assetUrl(GETEILT_RAUM, SHA_EINS, "kompass.webp", { release: "beneos_bm_0077", variant: "4k" })

const abgewiesen = () => new Response("p", { status: 200, headers: { "x-beneos-denied": "1", "content-type": "image/webp" } })
const bild = () => new Response("bild", { status: 200, headers: { "content-type": "image/webp", "content-length": "4" } })

/** Ruft und faengt: ein Wurf wird eine rote Probe, kein Absturz des Satzes. */
async function versuche(fn) {
  try { return await fn() } catch (e) { return { wurf: String(e?.message || e).slice(0, 120) } }
}

abschnitt("Teil 1: geteilteAdresse mit einer Menge abgewiesener Traeger")
gleich("ohne Abweisung der erste Traeger",
  geteilteAdresse(SHA, NAME, [KARTE_A, KARTE_B], new Set()), S_A)
gleich("erster abgewiesen, der zweite wird genommen",
  geteilteAdresse(SHA, NAME, [KARTE_A, KARTE_B], new Set(["beneos_bm_0113|4k"])), S_B)
gleich("nur ein Traeger, abgewiesen: es bleibt derselbe",
  geteilteAdresse(SHA, NAME, [KARTE_A], new Set(["beneos_bm_0113|4k"])), S_A)
gleich("alle abgewiesen: der erste wie vorher, nie leer",
  geteilteAdresse(SHA, NAME, [KARTE_A, KARTE_B], new Set(["beneos_bm_0113|4k", "beneos_bm_0042|hd"])), S_A)
gleich("ohne Menge wie vorher der erste",
  geteilteAdresse(SHA, NAME, [KARTE_A, KARTE_B]), S_A)

abschnitt("Teil 2: offlineHalten faellt nach einer Abweisung auf den naechsten Traeger zurueck")
f.merkePruefsummen([[KARTE_A, SHA], [KARTE_B, SHA], [KARTE_C, SHA_EINS]])
const GETEILT = f.vorratsSchluessel(S_A)
gleich("der Rueckweg nennt vor der Abweisung den ersten Traeger", f.adresseAusSchluessel(GETEILT), S_A)
{
  netz((adresse) => {
    if (adresse === S_A) return abgewiesen()
    if (adresse === S_B) return bild()
    return undefined
  })
  nimmAbrufe()
  const r = await versuche(() => f.offlineHalten([S_A]))
  const abrufe = nimmAbrufe().map((a) => a.adresse)
  gleich("zwei Traeger: erst der erste, dann der zweite gefragt", JSON.stringify(abrufe), JSON.stringify([S_A, S_B]))
  gleich("zwei Traeger: die Datei ist geholt", r?.geholt, 1)
  gleich("zwei Traeger: kein Fehlschlag gezaehlt", r?.fehlgeschlagen, 0)
  gleich("zwei Traeger: sie liegt unter dem geteilten Schluessel", ablage.has(GETEILT), true)
  gleich("danach nennt der Rueckweg den zweiten Traeger", f.adresseAusSchluessel(GETEILT), S_B)
  gleich("danach nennt die Kennung den zweiten Traeger",
    f.adresseVonKennung(`${GETEILT_RAUM}|${SHA}|${NAME}`), S_B)
}
{
  netz((adresse) => adresse === S_C ? abgewiesen() : undefined)
  nimmAbrufe()
  const r = await versuche(() => f.offlineHalten([S_C]))
  const abrufe = nimmAbrufe().map((a) => a.adresse)
  gleich("ein Traeger: genau ein Abruf", JSON.stringify(abrufe), JSON.stringify([S_C]))
  gleich("ein Traeger: Fehlschlag wie vorher", r?.fehlgeschlagen, 1)
  gleich("ein Traeger: Grund abgewiesen wie vorher", r?.gruende?.abgewiesen, 1)
  gleich("ein Traeger: der Rueckweg bleibt beim selben", f.adresseAusSchluessel(f.vorratsSchluessel(S_C)), S_C)
}

// Der Abweisungszweig des Abrufersatzes wird seit stre-T-208 gefahren, nicht
// mehr am Quelltext gelesen: stream-traeger-ersatz.test.mjs, Teil 4.

ende()
