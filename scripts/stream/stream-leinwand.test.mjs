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
import { LEINWAND_FELDER, leinwandFelder, installStreamLeinwand } from "./stream-leinwand.mjs"
import { MODULE_ID } from "./stream-settings.mjs"

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
    // Die Sollzahl kommt aus dem Fall und nicht aus der Tabelle: fehlte dort ein
    // Feld, waere eine Sollzahl aus der Tabelle mit ihr kleiner geworden.
    const soll = JSON.stringify(felder).split(OHNE).length - 1
    gleich(`${art}: alle Felder umgeschrieben`, zahl, soll)
    gleich(`${art}: vorbereitet steht die Toradresse`,
      JSON.stringify(d).split(MIT).length - 1 - (JSON.stringify(d._source).split(MIT).length - 1),
      soll)
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
  // Ein Wurf wird hier gefangen und als Wert gemeldet. Ohne den Fang braeche der
  // Satz ab, statt die Probe rot zu melden.
  const ohneWurf = (f) => { try { return f() } catch (e) { return `wirft: ${e?.message}` } }
  gleich("ein fehlendes Feld wirft nicht",
    ohneWurf(() => leinwandFelder("Tile", dokument({}))), 0)
  gleich("ein Teilobjekt null wirft nicht",
    ohneWurf(() => leinwandFelder("Tile", dokument({ texture: null }))), 0)
  gleich("eine fremde Art bleibt unberuehrt",
    leinwandFelder("Item", dokument({ img: OHNE })), 0)
  gleich("kein Dokument wirft nicht", ohneWurf(() => leinwandFelder("Tile", null)), 0)
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
  /*
   * DIE SCHREIBSTELLEN LAUFEN AUCH OHNE STREAMING, mit jeder Adresse, die ein
   * Token tragen kann. Eine fremde Adresse in unserer Pfadform ist der Fall,
   * der ohne Hostpruefung umgedeutet wuerde; The Forge legt Dateien unter
   * einem eigenen Host ab.
   */
  for (const fremd of [
    "modules/x/y.webp",
    "beneos_assets/cloud/tokens/x/y.webp",
    "",
    "https://fremd.example/c/pk_x/beneos_ct_000-wolf/000-wolf-1-top.webp",
    `https://fremd.example/a/${SCHLUESSEL}/beneos_bm_0113/4k/karte.webp`,
    "https://assets.forge-vtt.com/0123abcd/beneos_assets/cloud/tokens/x/y.webp",
    "http://192.168.1.10:30000/beneos_assets/x.webp",
  ]) {
    // Eigene Namen fuer die Gegenrichtung: der Sabotagelaeufer verlangt
    // eindeutige Probennamen.
    gleich(`schreibend unveraendert: ${JSON.stringify(fremd)}`, schluesselfreiAdresse(fremd), fremd)
  }
  gleich("schreibend: null bleibt null", schluesselfreiAdresse(null), null)
  /*
   * OHNE STREAMING BLEIBT DIE TORADRESSE STEHEN (Kalt-Review 16.11.2026,
   * Befund 1). Die Leseseite setzt ohne Modus oder Schluessel nichts ein; eine
   * hier geschriebene schluesselfreie Form zeigte danach kein Bild mehr. Eine
   * Bestandswelt mit abgeschaltetem Streaming behaelt ihre ladbare Adresse.
   */
  modus = false
  gleich("schreibend, Modus aus: die Toradresse bleibt stehen", schluesselfreiAdresse(MIT), MIT)
  modus = true
  schluessel = ""
  gleich("schreibend, kein Schluessel: die Toradresse bleibt stehen", schluesselfreiAdresse(MIT), MIT)
  schluessel = SCHLUESSEL
  gleich("schreibend, Gegenprobe mit beidem: schluesselfrei", schluesselfreiAdresse(MIT), OHNE)
  /*
   * DER RUNDLAUF MUSS DASSELBE ZIEL TREFFEN (zweiter Kaltleser, 16.11.2026).
   * Eine Kreatur unter `/a/` kaeme als `beneos://c/...` ohne Variante zurueck.
   * Ein Sonderzeichen, das `URL` anders kodiert als `encodeURIComponent`, darf
   * den Vergleich nicht kippen.
   */
  const kreaturUnterA = `${GATE}/a/${SCHLUESSEL}/beneos_ct_000-wolf/4k/wolf.webp`
  gleich("schreibend, Kreatur unter /a/: bleibt stehen, sonst ein anderes Ziel",
    schluesselfreiAdresse(kreaturUnterA), kreaturUnterA)
  const klammer = { release: "beneos_bm_0113", variant: "4k", pfad: "karte[1].webp" }
  gleich("schreibend, Klammer im Dateinamen: dekodiert verglichen",
    schluesselfreiAdresse(`${GATE}/a/${SCHLUESSEL}/beneos_bm_0113/4k/karte[1].webp`), ohneVon(klammer))
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

/*
 * DIE HUELLE SELBST, gegen gestellte Dokumentklassen. Die Kachel steht fuer
 * jede Art mit Schemafeld; die Szene ist wie in Foundry 14 gebaut
 * (gemessen am 15.11.2026 in `v14Stream`, 14.367): `background` und
 * `foreground` stehen nicht mehr im Schema und sind nur noch veraltete Getter
 * ohne Setter, die bei jedem Zugriff eine Verfallswarnung loggen.
 */
console.log("Die Huelle um prepareBaseData")
{
  const haken = {}
  const altHooks = globalThis.Hooks, altConfig = globalThis.CONFIG
  globalThis.Hooks = { on(n, f) { (haken[n] ??= []).push(f) }, once() {} }
  const schema = (namen) => ({ getField: (n) => (namen.includes(n) ? {} : undefined) })
  let resets = 0
  class Kachel {
    static schema = schema(["texture"])
    constructor(src) { this._source = { texture: { src } } }
    prepareBaseData() { this.texture = { src: this._source.texture.src } }
    reset() { resets++; this.prepareBaseData() }
  }
  class Szene14 {
    static schema = schema(["thumb"])
    constructor(thumb, vordergrund) { this._source = { thumb }; this._vg = vordergrund; this.zugriffe = 0 }
    get foreground() { this.zugriffe++; return this._vg }
    get background() { this.zugriffe++; return { src: this._vg } }
    prepareBaseData() { this.thumb = this._source.thumb }
  }
  // Zaehlt, wie oft die Huelle das Feld liest: einmal gewickelt heisst einmal.
  class Zaehler {
    static schema = schema(["texture"])
    prepareBaseData() {
      let src = OHNE
      const selbst = this
      this.lesen = 0
      this.texture = { get src() { selbst.lesen++; return src }, set src(v) { src = v } }
    }
  }
  globalThis.CONFIG = { Tile: { documentClass: Kachel }, Scene: { documentClass: Szene14 }, Token: { documentClass: Zaehler } }
  installStreamLeinwand()
  installStreamLeinwand()
  const z = new Zaehler()
  z.prepareBaseData()
  gleich("zweimal eingebaut: prepareBaseData einmal gewickelt", z.lesen, 1)
  gleich("zweimal eingebaut: ein Netzhaken je Art", (haken.preUpdateTile ?? []).length, 1)

  const k = new Kachel(OHNE)
  k.prepareBaseData()
  gleich("Huelle: vorbereitet steht die Toradresse von heute", k.texture.src, MIT)
  gleich("Huelle: _source bleibt schluesselfrei", k._source.texture.src, OHNE)

  const sz = new Szene14(OHNE, OHNE)
  sz.prepareBaseData()
  gleich("Szene wie Foundry 14: das Vorschaubild wird vorbereitet, auch bei schluesselfreiem Vordergrund",
    sz.thumb, MIT)
  gleich("Szene wie Foundry 14: die veralteten Getter werden nicht gelesen", sz.zugriffe, 0)

  const altScenes = game.scenes
  game.scenes = [k]
  const feuere = (key) => { for (const f of haken.updateSetting ?? []) f({ key }) }
  resets = 0; feuere(`${MODULE_ID}.${SETTING.key}`)
  gleich("Schluesselwechsel: neu vorbereitet", resets, 1)
  resets = 0; feuere(`${MODULE_ID}.${SETTING.base}`)
  gleich("Basiswechsel: neu vorbereitet", resets, 1)
  resets = 0; feuere(`${MODULE_ID}.irgendwas`)
  gleich("fremde Einstellung: nicht neu vorbereitet", resets, 0)

  /*
   * DAS SCHREIBNETZ (Kalt-Review 16.11.2026, Befund 2). Fremde Schreiber
   * schicken den vorbereiteten Wert zurueck. Gemessen am selben Tag in
   * `v14Stream`: das dnd5e-Charakter- und das Fahrzeugblatt speichern im
   * Bearbeitungsmodus `img` als Toradresse mit Schluessel. Das Netz nimmt
   * den Schluessel vor dem Speichern wieder heraus.
   */
  const ruf = (name, ...a) => { for (const f of haken[name] ?? []) f(...a) }
  const upd = (art, aenderung) => { ruf(`preUpdate${art}`, {}, aenderung, {}, "nutzer"); return aenderung }
  gleich("Netz, Akteur: img mit Schluessel wird schluesselfrei", upd("Actor", { img: MIT }).img, OHNE)
  gleich("Netz, Akteur: der Prototyp verschachtelt",
    upd("Actor", { prototypeToken: { texture: { src: MIT } } }).prototypeToken.texture.src, OHNE)
  gleich("Netz, Akteur: der Prototyp als flacher Schluessel",
    upd("Actor", { "prototypeToken.texture.src": MIT })["prototypeToken.texture.src"], OHNE)
  gleich("Netz, Akteur: der Prototyp halb flach",
    upd("Actor", { "prototypeToken.texture": { src: MIT } })["prototypeToken.texture"].src, OHNE)
  gleich("Netz, Akteur: ein anderes Feld bleibt", upd("Actor", { name: MIT }).name, MIT)
  gleich("Netz, Akteur: eine fremde Adresse bleibt",
    upd("Actor", { img: "https://fremd.example/a/x/y/z/w.webp" }).img, "https://fremd.example/a/x/y/z/w.webp")
  gleich("Netz, Kachel: texture.src wird schluesselfrei", upd("Tile", { texture: { src: MIT } }).texture.src, OHNE)
  gleich("Netz, Kachel: auch als flacher Schluessel", upd("Tile", { "texture.src": MIT })["texture.src"], OHNE)
  gleich("Netz, Klang: path wird schluesselfrei", upd("PlaylistSound", { path: MIT }).path, OHNE)
  gleich("Netz, Szene wie Foundry 14: das Vorschaubild", upd("Scene", { thumb: MIT }).thumb, OHNE)
  /*
   * DIE FORM, DIE FOUNDRY 14 SCHICKT (zweiter Kaltleser, 16.11.2026): die
   * Szenenkonfiguration legt die Stufe als `levels: [level]` in `scene.update`
   * (`scene-config.mjs:378`), und es feuert nur `preUpdateScene`.
   */
  const stufe = upd("Scene", { grid: { size: 101 }, levels: [{ _id: "x", background: { src: MIT }, foreground: { src: MIT } }] }).levels[0]
  gleich("Netz, Szene: levels[] Hintergrund wird schluesselfrei", stufe.background.src, OHNE)
  gleich("Netz, Szene: levels[] Vordergrund wird schluesselfrei", stufe.foreground.src, OHNE)
  gleich("Netz, Szene: tiles[] wird schluesselfrei",
    upd("Scene", { tiles: [{ _id: "t", texture: { src: MIT } }] }).tiles[0].texture.src, OHNE)
  gleich("Netz, Szene: tokens[] wird schluesselfrei",
    upd("Scene", { tokens: [{ _id: "k", texture: { src: MIT } }] }).tokens[0].texture.src, OHNE)
  gleich("Netz, Szene: sounds[] wird schluesselfrei",
    upd("Scene", { sounds: [{ _id: "s", path: MIT }] }).sounds[0].path, OHNE)
  gleich("Netz, Szene: ein Element ohne Adressfeld bleibt",
    upd("Scene", { tiles: [{ _id: "t", name: MIT }] }).tiles[0].name, MIT)
  gleich("Netz, Playlist: sounds[] wird schluesselfrei",
    upd("Playlist", { sounds: [{ _id: "p", path: MIT }] }).sounds[0].path, OHNE)
  modus = false
  gleich("Netz, Modus aus: die Toradresse bleibt", upd("Actor", { img: MIT }).img, MIT)
  modus = true
  // Beim Anlegen zaehlt das Dokument, nicht die Daten: Foundry verlangt dort
  // `updateSource`.
  let gesetzt = null
  const neu = { _source: { texture: { src: MIT } }, updateSource(d) { gesetzt = d } }
  ruf("preCreateTile", neu, { texture: { src: MIT } }, {}, "nutzer")
  gleich("Netz, Anlegen: die Quelle bekommt die schluesselfreie Form",
    JSON.stringify(gesetzt), JSON.stringify({ "texture.src": OHNE }))
  gesetzt = null
  ruf("preCreateTile", { _source: { texture: { src: OHNE } }, updateSource(d) { gesetzt = d } }, {}, {}, "nutzer")
  gleich("Netz, Anlegen: schon schluesselfrei, nichts gesetzt", gesetzt, null)
  // Eine Szene, die mit Kacheln und Tokens angelegt wird (Import, Duplikat).
  gesetzt = null
  ruf("preCreateScene", {
    _source: { name: "s", tiles: [{ texture: { src: MIT } }], tokens: [{ texture: { src: OHNE } }] },
    updateSource(d) { gesetzt = d },
  }, {}, {}, "nutzer")
  gleich("Netz, Anlegen einer Szene: die Kachel wird schluesselfrei, nur die geaenderte Liste",
    JSON.stringify(gesetzt), JSON.stringify({ tiles: [{ texture: { src: OHNE } }] }))
  gesetzt = null
  ruf("preCreateScene", { _source: { name: "s", tiles: [{ texture: { src: OHNE } }] }, updateSource(d) { gesetzt = d } }, {}, {}, "nutzer")
  gleich("Netz, Anlegen einer Szene: schon schluesselfrei, nichts gesetzt", gesetzt, null)
  gesetzt = null
  ruf("preCreatePlaylist", { _source: { name: "p", sounds: [{ path: MIT }] }, updateSource(d) { gesetzt = d } }, {}, {}, "nutzer")
  gleich("Netz, Anlegen einer Playlist: der Klang wird schluesselfrei",
    JSON.stringify(gesetzt), JSON.stringify({ sounds: [{ path: OHNE }] }))

  game.scenes = altScenes
  globalThis.Hooks = altHooks
  globalThis.CONFIG = altConfig
}

console.log(`\n${aussagen} Aussagen, ${gruen} gruen, ${rot} rot`)
/*
 * Von Hand nachgezogen, siehe Kopf. Weicht die gezaehlte Zahl ab, ist der Lauf
 * mittendrin gestorben oder ein Block ist still weggefallen.
 */
const ERWARTET = 145
if (aussagen !== ERWARTET) {
  console.log(`ROT  erwartet ${ERWARTET} Aussagen, gezaehlt ${aussagen}`)
  process.exit(1)
}
process.exit(rot ? 1 : 0)
