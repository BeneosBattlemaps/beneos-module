/**
 * stream-einbau.test.mjs
 *
 * Was der `init` von `beneos-stream.mjs` bei Modus AUS einbaut, wenn ein
 * Schluessel da ist. Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-einbau.test.mjs
 *
 * WARUM DIESER PRUEFSATZ, stre-T-102 (Betreiberentscheid 16.11.2026, "Weiter
 * laden"). Leinwand, Schreibnetz und Konsolenmaske haengen am Schluessel, nicht
 * am Modus. Gemessen vor diesem Stand in v13 und v14: bei Modus aus war nichts
 * davon eingebaut. Eine Neuzeichnung meldete je Kachel, Token und Notiz "Fetch
 * API cannot load beneos://", und Foundry schrieb jede Toradresse mit
 * Schluessel in die Konsole.
 *
 * Eingebaut wird unbedingt, geprueft wird im Behandler. Dann stimmt es auch
 * ohne Neuladen, wenn der Schluessel spaeter kommt oder der Modus per API
 * umgelegt wird. Ohne Schluessel tun die Behandler nichts; das belegt
 * `stream-leinwand.test.mjs`.
 *
 * Zweiwertprobe: der fetch-Ersatz bleibt am Modus und ist bei Modus aus NICHT
 * eingebaut, wie vor T-102.
 */
import { pruefstand, installiereFoundry, haken } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, ende } = pruefstand("stream-einbau, init bei Modus aus mit Schluessel")

const SCHLUESSEL = "pk_einbau_attrappe"
const GATE = "https://gate.beneos.stream"
const { SETTING } = await import("./stream-settings.mjs")
installiereFoundry({ einstellungen: { [SETTING.key]: SCHLUESSEL, [SETTING.base]: GATE, [SETTING.mode]: false } })

// Eine Dokumentklasse, wie `installStreamLeinwand` sie in CONFIG erwartet.
class Kachel {
  constructor(src) { this._source = { texture: { src } } }
  prepareBaseData() { this.texture = { src: this._source.texture.src } }
}
globalThis.CONFIG.Tile = { documentClass: Kachel }

// Die Konsole vor dem Einbau abfangen: die Maske wickelt, was sie vorfindet.
const gesehen = []
const urLog = console.log
console.log = (...a) => { gesehen.push(a.map(String).join(" ")) }

const urFetch = async () => new Response("")
globalThis.fetch = urFetch

globalThis.game.settings.registerMenu = () => {}
let ladefehler = ""
try {
  await import("./beneos-stream.mjs")
  /*
   * Je init-Haken einzeln: beim Laden kommen auch fremde Dateien des Moduls
   * mit (Asset-Waechter), deren init in der Attrappe scheitern darf. Gezaehlt
   * wird nur ein Fehler aus diesem Ordner.
   */
  for (const h of haken.liste.filter((x) => x.name === "init")) {
    try { await h.fn() } catch (e) {
      const s = String(e?.stack ?? e)
      if (s.includes("/scripts/stream/")) ladefehler = s.slice(0, 400)
    }
  }
} catch (e) { ladefehler = String(e?.stack ?? e).slice(0, 400) }

gesehen.length = 0
console.log(`Loaded ${GATE}/a/${SCHLUESSEL}/beneos_bm_0113/4k/karte.webp`)
const zeile = gesehen.join("\n")
console.log = urLog

gleich("init laeuft in der Attrappe durch", ladefehler, "")
gleich("Modus aus mit Schluessel: die Konsole ist maskiert", zeile.includes(SCHLUESSEL), false)
gleich("Modus aus mit Schluessel: die Konsolenzeile bleibt erhalten", zeile.startsWith(`Loaded ${GATE}/a/`), true)
gleich("Modus aus mit Schluessel: prepareBaseData ist gewickelt",
  Object.hasOwn(Kachel.prototype, Symbol.for("beneos.stream.leinwand")), true)
gleich("Modus aus mit Schluessel: das Schreibnetz haengt", haken.namen().includes("preUpdateTile"), true)
gleich("Modus aus mit Schluessel: das Neuvorbereiten haengt", haken.namen().includes("updateSetting"), true)

const k = new Kachel("beneos://a/beneos_bm_0113/4k/karte.webp")
k.prepareBaseData()
gleich("Modus aus mit Schluessel: vorbereitet steht die Toradresse",
  k.texture.src, `${GATE}/a/${SCHLUESSEL}/beneos_bm_0113/4k/karte.webp`)
gleich("Modus aus mit Schluessel: _source bleibt schluesselfrei",
  k._source.texture.src, "beneos://a/beneos_bm_0113/4k/karte.webp")

// Zweiwertprobe: der fetch-Ersatz haengt weiter am Modus.
gleich("Modus aus: der fetch-Ersatz ist NICHT eingebaut", globalThis.fetch, urFetch)

ende()
