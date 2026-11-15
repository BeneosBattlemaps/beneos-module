/**
 * stream-leinwand.test.mjs
 *
 * Gegenprobe zur Leinwandadresse, stre-T-102. Laeuft ohne Foundry und ohne
 * Browser:
 *
 *   node scripts/stream/stream-leinwand.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 mindestens einer rot, 2 nicht
 * pruefbar.
 *
 * WARUM DIESER PRUEFSATZ. Auf der Platte steht seit T-102 die schluesselfreie
 * Form `beneos://...`, auch in Kacheln, Szenen, Klaengen und Akteuren. Die
 * Leinwand, die Audioschicht und die Verzeichnislisten koennen damit nichts
 * anfangen: gemessen am 15.11.2026 laedt `<img src="beneos://...">` nicht, und
 * `foundry.audio.Sound` holt es nicht. Deshalb setzt das Modul beim Vorbereiten
 * eines Dokuments den Schluessel von heute ein, und zwar NUR in den
 * vorbereiteten Feldern. Was gespeichert und exportiert wird, ist `_source`,
 * und dort bleibt der Schluessel draussen.
 *
 * DIE ZWEI AUSSAGEN, DIE ALLES TRAGEN:
 *
 * - Zwei Werte: eine schluesselfreie Adresse WIRD zur Toradresse von heute,
 *   eine alte Toradresse mit Schluessel BLEIBT zeichengleich stehen.
 * - `_source` bleibt unberuehrt. Ein Umschreiben, das in `_source` schreibt,
 *   wuerde den Schluessel beim naechsten Speichern in die Welt tragen.
 *
 * DIE ZAHL DER AUSSAGEN STEHT AM ENDE und wird von Hand nachgezogen, aus
 * demselben Grund wie in `stream-platzhalter.test.mjs`.
 */
import {
  assetUrl,
  platzhalterAdresse,
  leinwandAdresse,
  schluesselfreiAdresse,
  SETTING,
} from "./stream-settings.mjs"
import { LEINWAND_FELDER, leinwandFelder } from "./stream-leinwand.mjs"

const GATE = "https://gate2.beneos.stream"
const SCHLUESSEL = "pk_pruefsatz_geheim"

/*
 * Der Schalter ist umlegbar, damit der Satz "ohne Streaming bleibt alles
 * stehen" gegen dieselbe Attrappe laeuft und nicht gegen eine zweite.
 */
let modus = true
let schluessel = SCHLUESSEL
globalThis.game = {
  settings: {
    get(_modul, name) {
      if (name === SETTING.key) return schluessel
      if (name === SETTING.base) return GATE
      if (name === SETTING.mode) return modus
      return ""
    },
  },
  i18n: { localize: (s) => s, format: (s) => s },
}

let rot = 0
let gruen = 0
let aussagen = 0

function gleich(name, ist, soll) {
  aussagen++
  const ok = JSON.stringify(ist) === JSON.stringify(soll)
  if (ok) { gruen++; console.log(`  ok   ${name}`) }
  else {
    rot++
    console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}`
      + `\n       ist  ${JSON.stringify(ist)}`)
  }
}

// Herkunft vor dem Messen, siehe stream-platzhalter.test.mjs.
for (const [name, f] of Object.entries({
  assetUrl, platzhalterAdresse, leinwandAdresse, leinwandFelder, schluesselfreiAdresse,
})) {
  if (typeof f !== "function") {
    console.log(`NICHT PRUEFBAR: "${name}" ist keine Funktion, sondern `
      + `${typeof f}. Der Lauf misst nichts und bricht ab.`)
    process.exit(2)
  }
}
if (!LEINWAND_FELDER || typeof LEINWAND_FELDER !== "object") {
  console.log("NICHT PRUEFBAR: LEINWAND_FELDER fehlt.")
  process.exit(2)
}

const PROBEN = {
  karte: { release: "beneos_bm_0113", variant: "4k", pfad: "karte.webp" },
  kreatur: {
    release: "beneos_ct_000-barovian_direwolf",
    variant: "",
    pfad: "000-barovian_direwolf-1-journal.webp",
  },
  beute: {
    release: "beneos_lt_000-sunblade",
    variant: "",
    pfad: "000-sunblade-front.webp",
  },
  geteilt: {
    release: "shared",
    variant: "b".repeat(64),
    pfad: "foundry_bm_ui.webp",
    traeger: { release: "beneos_bm_0113", variant: "4k" },
  },
  unterpfad: { release: "beneos_bm_0113", variant: "4k", pfad: "tief/mit raum.webm" },
}

const ohneVon = (p) => platzhalterAdresse(p.release, p.variant, p.pfad, p.traeger)
const mitVon = (p) => assetUrl(p.release, p.variant, p.pfad, p.traeger)

console.log("Zwei Werte: schluesselfrei wird zur Toradresse, mit Schluessel bleibt")
{
  for (const [raum, p] of Object.entries(PROBEN)) {
    const ohne = ohneVon(p)
    const mit = mitVon(p)
    gleich(`"${raum}": die schluesselfreie Form wird zur Toradresse von heute`,
      leinwandAdresse(ohne), mit)
    gleich(`"${raum}": die alte Toradresse bleibt zeichengleich`,
      leinwandAdresse(mit), mit)
  }
  // Gegenprobe: das Ergebnis traegt den Schluessel wirklich, sonst waere der
  // erste Satz auch mit einer leeren Attrappe gruen.
  gleich("das Ergebnis traegt den Schluessel",
    leinwandAdresse(ohneVon(PROBEN.karte)).includes(`/${SCHLUESSEL}/`), true)
}

console.log("Die Anfrage des zweiten Versuchs faellt weg")
{
  /*
   * GEMESSEN AM 15.11.2026 (P0a): PIXI ruft beim zweiten Versuch dieselbe
   * Adresse mit `?cors-retry=<zahl>`. In der schluesselfreien Form ist ein
   * echtes `?` nie Teil des Pfades, denn der Bauer kodiert jedes Segment.
   */
  const ohne = ohneVon(PROBEN.karte)
  gleich("?cors-retry= faellt weg",
    leinwandAdresse(`${ohne}?cors-retry=1763215200000`), mitVon(PROBEN.karte))
  gleich("ein Anker faellt weg", leinwandAdresse(`${ohne}#x`), mitVon(PROBEN.karte))
  gleich("ein kodiertes Fragezeichen im Namen bleibt Teil des Pfades",
    leinwandAdresse(platzhalterAdresse("beneos_bm_0113", "4k", "wer?.webp")),
    assetUrl("beneos_bm_0113", "4k", "wer?.webp"))
}

console.log("Was nicht unsere schluesselfreie Form ist, bleibt, wie es ist")
{
  for (const fremd of [
    "https://fremd.example/a/x/y/z.webp",
    "modules/beneos-module/icons/x.webp",
    "beneos_assets/cloud/tokens/x/y.webp",
    "beneos:/c/beneos_ct_x/y.webp",
    "beneos://",
    "beneos://C/beneos_ct_x/y.webp",
    "",
  ]) {
    gleich(`unveraendert: ${JSON.stringify(fremd)}`, leinwandAdresse(fremd), fremd)
  }
  gleich("null bleibt null", leinwandAdresse(null), null)
  gleich("undefined bleibt undefined", leinwandAdresse(undefined), undefined)
  gleich("eine Zahl bleibt eine Zahl", leinwandAdresse(42), 42)
}

console.log("Ohne Streaming und ohne Schluessel bleibt die schluesselfreie Form stehen")
{
  const ohne = ohneVon(PROBEN.karte)
  modus = false
  gleich("Modus aus", leinwandAdresse(ohne), ohne)
  modus = true
  schluessel = ""
  gleich("kein Schluessel", leinwandAdresse(ohne), ohne)
  schluessel = SCHLUESSEL
  gleich("Gegenprobe: mit beidem wird sie umgeschrieben",
    leinwandAdresse(ohne) !== ohne, true)
}

/*
 * Ein Dokument, wie Foundry es vorbereitet: die Felder stehen am Objekt,
 * `_source` ist ein ANDERES Objekt mit denselben Werten. Gemessen am
 * 15.11.2026 (P0): `tile.texture` ist nicht `tile._source.texture`.
 */
function dokument(felder) {
  const kopie = (o) => JSON.parse(JSON.stringify(o))
  const d = kopie(felder)
  d._source = kopie(felder)
  return d
}

const OHNE = ohneVon(PROBEN.karte)
const MIT = mitVon(PROBEN.karte)
const MIT_ALT = MIT.replace(SCHLUESSEL, "pk_alter_schluessel")

console.log("Die Felder je Dokumentart")
{
  const faelle = {
    "Tile": { texture: { src: OHNE } },
    "Token": { texture: { src: OHNE } },
    "Note": { texture: { src: OHNE } },
    "Drawing": { texture: OHNE },
    "AmbientSound": { path: OHNE },
    "PlaylistSound": { path: OHNE },
    "Scene": { background: { src: OHNE }, foreground: OHNE, thumb: OHNE },
    "Level": { background: { src: OHNE }, foreground: { src: OHNE } },
    "Actor": { img: OHNE },
  }
  gleich("die Tabelle nennt genau diese Arten",
    Object.keys(LEINWAND_FELDER).sort(), Object.keys(faelle).sort())
  for (const [art, felder] of Object.entries(faelle)) {
    const d = dokument(felder)
    const zahl = leinwandFelder(art, d)
    gleich(`${art}: alle Felder umgeschrieben`, zahl, LEINWAND_FELDER[art]?.length)
    gleich(`${art}: vorbereitet steht die Toradresse`,
      JSON.stringify(d).split(MIT).length - 1 - (JSON.stringify(d._source).split(MIT).length - 1),
      LEINWAND_FELDER[art]?.length)
    gleich(`${art}: _source traegt keinen Schluessel`,
      JSON.stringify(d._source).includes(SCHLUESSEL), false)
    gleich(`${art}: _source traegt weiter die schluesselfreie Form`,
      JSON.stringify(d._source), JSON.stringify(felder))
  }
}

console.log("Alte Welten, leere Felder und fremde Arten")
{
  const alt = dokument({ background: { src: MIT_ALT }, foreground: null, thumb: "" })
  gleich("Szene mit alter Toradresse: nichts umgeschrieben",
    leinwandFelder("Scene", alt), 0)
  gleich("und die alte Toradresse steht unveraendert", alt.background.src, MIT_ALT)
  gleich("ein leeres Feld bleibt leer", alt.thumb, "")
  gleich("ein fehlendes Feld wirft nicht",
    leinwandFelder("Tile", dokument({})), 0)
  gleich("ein Teilobjekt null wirft nicht",
    leinwandFelder("Tile", dokument({ texture: null })), 0)
  gleich("eine fremde Art bleibt unberuehrt",
    leinwandFelder("Item", dokument({ img: OHNE })), 0)
  gleich("kein Dokument wirft nicht", leinwandFelder("Tile", null), 0)
  // Zweimal vorbereitet heisst nicht zweimal umgeschrieben.
  const zwei = dokument({ img: OHNE })
  leinwandFelder("Actor", zwei)
  gleich("ein zweiter Lauf findet nichts mehr", leinwandFelder("Actor", zwei), 0)
  gleich("und laesst die Toradresse stehen", zwei.img, MIT)
}

console.log("Die Gegenrichtung: was ins Dokument geschrieben wird")
{
  for (const [raum, p] of Object.entries(PROBEN)) {
    const ohne = ohneVon(p)
    const mit = mitVon(p)
    gleich(`"${raum}": aus der Toradresse wird die schluesselfreie Form`,
      schluesselfreiAdresse(mit), ohne)
    gleich(`"${raum}": die schluesselfreie Form bleibt, wie sie ist`,
      schluesselfreiAdresse(ohne), ohne)
    gleich(`"${raum}": und der Umlauf trifft die Toradresse von heute`,
      leinwandAdresse(schluesselfreiAdresse(mit)), mit)
  }
  gleich("eine Anfrage faellt weg",
    schluesselfreiAdresse(`${MIT}?t=1763215200000`), OHNE)
  gleich("ein alter Schluessel faellt genauso weg", schluesselfreiAdresse(MIT_ALT), OHNE)
  for (const fremd of ["modules/x/y.webp", "beneos_assets/cloud/tokens/x/y.webp", ""]) {
    gleich(`unveraendert: ${JSON.stringify(fremd)}`, schluesselfreiAdresse(fremd), fremd)
  }
  gleich("null bleibt null", schluesselfreiAdresse(null), null)
}

/*
 * DIE LESER, die vor T-102 nur die Toradresse kannten. Sie lesen `_source`
 * und die Videoflagge, also Felder, die das Vorbereiten nicht umschreibt.
 * Verlangt von orch-stre-1: eine Altwelt mit Toradressen muss dasselbe
 * Ergebnis liefern wie vorher.
 */
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true }, configurable: true, writable: true,
})
const { streamAdressenVon, hasStreamedContent, offlineGesperrt, noteResult } =
  await import("./stream-online.mjs")

const szene = (bg, kachel, video, notiz) => ({
  _source: { background: { src: bg }, foreground: null },
  tiles: [{
    texture: { src: kachel },
    flags: { "beneos-module": { stream: { role: "stream-video", video } } },
  }],
  notes: [{ texture: { src: notiz } }],
})
const K = {
  bg: { release: "beneos_bm_0113", variant: "4k", pfad: "bg.webp" },
  kachel: { release: "beneos_bm_0113", variant: "4k", pfad: "still.webp" },
  video: { release: "beneos_bm_0113", variant: "4k", pfad: "karte.webm" },
  notiz: { release: "beneos_bm_0113", variant: "4k", pfad: "map_assets/pin.svg" },
}
const alleMit = Object.values(K).map(mitVon)

console.log("Szenenwache und Offline-Zusage: Altwelt wie heute, schluesselfrei erkannt")
{
  const alt = szene(...alleMit)
  gleich("Altwelt: dieselbe Liste wie vor T-102, Toradressen unveraendert",
    streamAdressenVon(alt), alleMit)
  gleich("Altwelt: haengt am Tor", hasStreamedContent(alt), true)

  const neu = szene(...Object.values(K).map(ohneVon))
  gleich("schluesselfrei auf der Platte: dieselbe Liste, mit dem Schluessel von heute",
    streamAdressenVon(neu), alleMit)
  gleich("schluesselfrei: haengt am Tor", hasStreamedContent(neu), true)

  const oertlich = szene("worlds/x/bg.webp", "worlds/x/still.webp", "", "icons/pin.svg")
  gleich("oertlich: leere Liste", streamAdressenVon(oertlich), [])
  gleich("oertlich: haengt nicht am Tor", hasStreamedContent(oertlich), false)
}

console.log("Offline-Sperre: schluesselfrei wird gesperrt wie die Toradresse")
{
  gleich("online: nichts gesperrt", offlineGesperrt(OHNE), false)
  globalThis.navigator.onLine = false
  noteResult(false, "pruefsatz")
  gleich("offline: Toradresse gesperrt, wie heute", offlineGesperrt(MIT), true)
  gleich("offline: schluesselfreie Form gesperrt", offlineGesperrt(OHNE), true)
  gleich("offline: oertlicher Pfad frei", offlineGesperrt("worlds/x/a.webp"), false)
}

console.log(`\n${aussagen} Aussagen, ${gruen} gruen, ${rot} rot`)
/*
 * Von Hand nachgezogen, siehe Kopf. Weicht die gezaehlte Zahl ab, ist der Lauf
 * mittendrin gestorben oder ein Block ist still weggefallen.
 */
const ERWARTET = 104
if (aussagen !== ERWARTET) {
  console.log(`ROT  erwartet ${ERWARTET} Aussagen, gezaehlt ${aussagen}`)
  process.exit(1)
}
process.exit(rot ? 1 : 0)
