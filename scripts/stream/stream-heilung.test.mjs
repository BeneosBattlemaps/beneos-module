/**
 * stream-heilung.test.mjs
 *
 * Gegenprobe zur Praefix-Heilung in `beneos-asset-path-repair.js`
 * (`_heileStreamPraefixe`), stre-T-102. Laeuft ohne Foundry und ohne Browser:
 *
 *   node scripts/stream/stream-heilung.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ. Die Heilung liest `tile.texture.src`, also das
 * VORBEREITETE Feld, und schreibt per Update zurueck. Seit T-102 steht dort bei
 * einer schluesselfreien Kachel die Toradresse mit dem Schluessel von heute.
 * Traegt der Szenenhintergrund noch eine Toradresse mit einem aelteren
 * Schluessel, sind die Praefixe verschieden, und die Heilung schrieb den alten
 * Schluessel in die Kachel. Gemessen am 15.11.2026 in `v14Stream`
 * (Foundry 14.367): vorher `beneos://a/...`, nachher
 * `https://gate.beneos.stream/a/<alter Schluessel>/...`.
 *
 * Der Satz faengt den `canvasReady`-Haken ueber eine Attrappe von `Hooks` ab
 * und faehrt ihn mit einer nachgebauten Szene.
 */
import { assetUrl, platzhalterAdresse, SETTING } from "./stream-settings.mjs"

const GATE = "https://gate.beneos.stream"
const HEUTE = "pk_heute_pruefsatz"
const ALT = "pk_alt_pruefsatz"

globalThis.game = {
  settings: {
    get(_modul, name) {
      if (name === SETTING.key) return HEUTE
      if (name === SETTING.base) return GATE
      if (name === SETTING.mode) return true
      return ""
    },
  },
  user: { isGM: true },
  actors: [],
  scenes: [],
  i18n: { localize: (s) => s, format: (s) => s },
}
const haken = {}
globalThis.Hooks = {
  on(name, fn) { haken[name] = fn },
  once(name, fn) { haken[name] = fn },
}

await import("../beneos-asset-path-repair.js")

let aussagen = 0, gruen = 0, rot = 0
function gleich(name, ist, soll) {
  aussagen++
  if (ist === soll) { gruen++; console.log(`  ok   ${name}`) }
  else { rot++; console.log(`  ROT  ${name}\n       ist:  ${ist}\n       soll: ${soll}`) }
}

const REL = "beneos_bm_0011_cos_barovia_village"
const PFAD = "beneos_assets/beneos_battlemaps/4k/11_cos_barovia_village/kachel.webp"
const HG = "beneos_assets/beneos_battlemaps/4k/11_cos_barovia_village/4k_bm.webp"
const mitSchluessel = (s, pfad) => assetUrl(REL, "4k", pfad).split(HEUTE).join(s)

/** Faehrt die Heilung fuer eine Szene und gibt die geschriebenen Werte zurueck. */
async function heile(hintergrund, kachelVorbereitet) {
  const geschrieben = []
  const szene = {
    name: "pruef",
    _source: { background: { src: hintergrund } },
    tiles: [{ id: "k1", texture: { src: kachelVorbereitet } }],
    getFlag: () => true,
    async updateEmbeddedDocuments(_art, updates) { geschrieben.push(...updates.map((u) => u["texture.src"])) },
  }
  haken.canvasReady({ scene: szene })
  await new Promise((r) => setTimeout(r, 0))
  return geschrieben
}

console.log("Die Praefix-Heilung schreibt keinen Schluessel")

// Die Kachel ist schluesselfrei gespeichert; vorbereitet traegt sie den
// Schluessel von heute. Der Hintergrund traegt noch einen aelteren.
const geschrieben = await heile(mitSchluessel(ALT, HG), mitSchluessel(HEUTE, PFAD))
gleich("aelterer Schluessel im Hintergrund: die Kachel wird geschrieben", geschrieben.length, 1)
gleich("und zwar schluesselfrei", geschrieben[0], platzhalterAdresse(REL, "4k", PFAD))

// Gegenwert: gleicher Schluessel, gleicher Praefix, nichts zu tun.
gleich("gleicher Schluessel: nichts wird geschrieben",
  (await heile(mitSchluessel(HEUTE, HG), mitSchluessel(HEUTE, PFAD))).length, 0)

// Gegenwert: fremde Adressen gehen zeichengleich durch.
const fremd = await heile("https://fremd.example/x/beneos_assets/a/hg.webp",
  "https://fremd.example/y/beneos_assets/a/kachel.webp")
gleich("fremder Host: die Heilung schreibt den Praefix des Hintergrunds unveraendert",
  fremd[0], "https://fremd.example/x/beneos_assets/a/kachel.webp")

// Ein schluesselfreier Hintergrund ist kein absoluter Pfad: keine Heilung.
gleich("schluesselfreier Hintergrund: nichts wird geschrieben",
  (await heile(platzhalterAdresse(REL, "4k", HG), mitSchluessel(HEUTE, PFAD))).length, 0)

console.log(`\n${aussagen} Aussagen, ${gruen} gruen, ${rot} rot`)
const ERWARTET = 5
if (aussagen !== ERWARTET) {
  console.log(`ROT erwartet ${ERWARTET} Aussagen, gezaehlt ${aussagen}`)
  process.exit(1)
}
process.exit(rot ? 1 : 0)
