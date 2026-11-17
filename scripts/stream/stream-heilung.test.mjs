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
let schluesselAn = true

globalThis.game = {
  settings: {
    get(_modul, name) {
      if (name === SETTING.key) return schluesselAn ? HEUTE : ""
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

const { heileJournalGateAdressen } = await import("../beneos-asset-path-repair.js")
const { PLATZHALTER_BILD } = await import("./stream-html.mjs")

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

/*
 * DIE JOURNALHEILUNG SCHREIBT FORM (a), stre-T-116. Bis dahin schrieb sie den
 * Praefix der Massstab-Adresse samt Schluessel ins HTML. Seit pages[].src
 * schluesselfrei ist, nimmt sie auch `beneos://a/<release>/<variante>/` als
 * Massstab, aus `page.src` oder aus `data-beneos-src`.
 */
console.log("Die Journalheilung schreibt Form (a)")
const LOKAL = "beneos_assets/cloud/battlemaps/11_cos_barovia_village/handout.webp"
const MANIFEST = "beneos_assets/beneos_battlemaps/11_cos_barovia_village/handout.webp"
const FREI_MANIFEST = platzhalterAdresse(REL, "4k", MANIFEST)
const FORM_A = `<img src="${PLATZHALTER_BILD}#${FREI_MANIFEST}" data-beneos-src="${FREI_MANIFEST}">`
function journal(seiten) {
  const geschrieben = []
  return {
    geschrieben,
    j: { name: "J", pages: seiten, async updateEmbeddedDocuments(_art, u) { geschrieben.push(...u) } },
  }
}
const textSeite = { id: "t1", text: { content: `<img src="${LOKAL}">` } }
const ohneSchluessel = (s) => !String(s).includes(HEUTE) && !String(s).includes(ALT)

{
  const { j, geschrieben } = journal([{ id: "b1", src: mitSchluessel(HEUTE, PFAD) }, structuredClone(textSeite)])
  game.journal = [j]
  const b = await heileJournalGateAdressen()
  gleich("Massstab Toradresse: Seite in Form (a)", geschrieben[0]?.["text.content"], FORM_A)
  gleich("Massstab Toradresse: eine Adresse gezaehlt", b.adressen, 1)
}
{
  const { j, geschrieben } = journal([{ id: "b1", src: platzhalterAdresse(REL, "4k", PFAD) }, structuredClone(textSeite)])
  game.journal = [j]
  await heileJournalGateAdressen()
  gleich("Massstab beneos:// aus page.src: Seite in Form (a)", geschrieben[0]?.["text.content"], FORM_A)
}
{
  // data-beneos-src VOR src: die gierige Medien-Regex faengt das letzte `src`
  // im Tag und saehe hier nur den Platzhalter. So bewacht die Probe die eigene
  // Suche nach data-beneos-src.
  const anderes = `<img data-beneos-src="${platzhalterAdresse(REL, "4k", PFAD)}" src="${PLATZHALTER_BILD}">`
  const { j, geschrieben } = journal([{ id: "t0", text: { content: anderes } }, structuredClone(textSeite)])
  game.journal = [j]
  await heileJournalGateAdressen()
  gleich("Massstab aus data-beneos-src: Seite in Form (a)", geschrieben[0]?.["text.content"], FORM_A)
}
{
  // Der Bilddialog hat data-beneos-src verworfen; der Massstab steht nur noch
  // im Fragment des Platzhalters (Kalt-Review, kritisch).
  const nurFragment = `<img src="${PLATZHALTER_BILD}#${platzhalterAdresse(REL, "4k", PFAD)}">`
  const { j, geschrieben } = journal([{ id: "t0", text: { content: nurFragment } }, structuredClone(textSeite)])
  game.journal = [j]
  await heileJournalGateAdressen()
  gleich("Massstab aus dem Fragment des Platzhalters: Seite in Form (a)", geschrieben.find((u) => u._id === "t1")?.["text.content"], FORM_A)
}
{
  // Kalt-Review W6: bei schluesselfreiem Massstab schrieb die Heilung einem
  // Video die Toradresse MIT Schluessel ins HTML. Ein Video geht nie ueber den
  // Blob-Weg und hat keine Form (a); es bleibt lokal.
  const video = `<video src="${LOKAL}"></video>`
  const { j, geschrieben } = journal([{ id: "b1", src: platzhalterAdresse(REL, "4k", PFAD) },
    { id: "t1", text: { content: video + `<img src="${LOKAL}">` } }])
  game.journal = [j]
  await heileJournalGateAdressen()
  gleich("Massstab beneos://: ein Video bleibt lokal, das Bild wird Form (a)", geschrieben[0]?.["text.content"], video + FORM_A)
}
{
  const { j, geschrieben } = journal([{ id: "b1", src: "https://gate.alt.example/a/" + ALT + "/" + REL + "/4k/x.webp" }, structuredClone(textSeite)])
  game.journal = [j]
  const b = await heileJournalGateAdressen()
  gleich("fremde Basis: gezaehlt", b.fremdeBasis, 1)
  gleich("fremde Basis: geschrieben wie bisher, mit dem Praefix des Massstabs",
    geschrieben[0]?.["text.content"], `<img src="https://gate.alt.example/a/${ALT}/${REL}/4k/${MANIFEST}">`)
}
{
  const { j, geschrieben } = journal([{ id: "b1", src: mitSchluessel(HEUTE, PFAD) }, structuredClone(textSeite)])
  game.journal = [j]
  schluesselAn = false
  await heileJournalGateAdressen()
  schluesselAn = true
  gleich("ohne Schluessel: kein Lauf", geschrieben.length, 0)
}
{
  const { j, geschrieben } = journal([structuredClone(textSeite)])
  game.journal = [j]
  const b = await heileJournalGateAdressen()
  gleich("ohne Massstab: nichts geschrieben, benannt", `${geschrieben.length}|${b.ohneMassstab.join()}`, "0|J")
}
{
  const { j, geschrieben } = journal([{ id: "b1", src: mitSchluessel(HEUTE, PFAD) }, structuredClone(textSeite)])
  game.journal = [j]
  await heileJournalGateAdressen()
  gleich("kein Schluessel im Geschriebenen", ohneSchluessel(JSON.stringify(geschrieben)), true)
}

console.log(`\n${aussagen} Aussagen, ${gruen} gruen, ${rot} rot`)
const ERWARTET = 16
if (aussagen !== ERWARTET) {
  console.log(`ROT erwartet ${ERWARTET} Aussagen, gezaehlt ${aussagen}`)
  process.exit(1)
}
process.exit(rot ? 1 : 0)
