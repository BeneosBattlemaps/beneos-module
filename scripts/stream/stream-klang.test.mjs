/**
 * stream-klang.test.mjs
 *
 * Gegenprobe zum Klangneubau nach einem Schluesselwechsel, stre-T-119. Laeuft
 * ohne Foundry und ohne Browser:
 *
 *   node scripts/stream/stream-klang.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 mindestens einer rot, 2 nicht
 * pruefbar.
 *
 * DER FEHLER. Ein Playlist-Klang, der mit einem widerrufenen Schluessel
 * anlaeuft, bekommt vom Tor den 42-Byte-Platzhalter, das Dekodieren scheitert,
 * und sein Klangobjekt steht auf FAILED. `PlaylistSound#sync` kehrt dann
 * dauerhaft zurueck (Foundry 13 und 14, `client/documents/playlist-sound.mjs`
 * :150-152), und neu gebaut wird das Objekt nur, wenn sich `path` oder
 * `channel` aendert (:220-223). Seit T-102 steht auf der Platte die
 * schluesselfreie Form, der Schluesselwechsel aendert also `_source.path`
 * nicht, und der Klang bleibt bis zum Neuladen stumm.
 *
 * DIE ATTRAPPE bildet `_createSound` (:53-63) und `sync` (:141-175) zeilentreu
 * nach, dazu die Zustaende aus `client/audio/sound.mjs` (:51-61, `failed`
 * :182, `playing` :190). Alles andere aus Foundry braucht der Satz nicht.
 *
 * DIE ZWEI WERTE, DIE ALLES TRAGEN:
 *
 * - Ein Klang ohne Streamadresse wird nicht angefasst, auch wenn er
 *   gescheitert ist.
 * - Ein laufender Klang wird nicht unterbrochen.
 *
 * KEIN SCHLUESSEL IN EINER AUSGABE. Die Probenamen nennen nur "A" und "B", und
 * ROT druckt Wahrheitswerte und Ausgangswoerter, keine Adresse.
 *
 * DIE ZAHL DER AUSSAGEN STEHT AM ENDE und wird von Hand nachgezogen, aus
 * demselben Grund wie in `stream-platzhalter.test.mjs`.
 */
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { platzhalterAdresse, leinwandAdresse, SETTING, MODULE_ID } from "./stream-settings.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const GATE = "https://gate2.beneos.stream"
const SCHLUESSEL_A = "pk_pruefsatz_alt_a"
const SCHLUESSEL_B = "pk_pruefsatz_neu_b"

let schluessel = SCHLUESSEL_A
globalThis.game = {
  settings: {
    get(_modul, name) {
      if (name === SETTING.key) return schluessel
      if (name === SETTING.base) return GATE
      if (name === SETTING.mode) return true
      return ""
    },
  },
  i18n: { localize: (s) => s, format: (s) => s },
  playlists: [],
}

const haken = {}
globalThis.Hooks = {
  on(name, f) { (haken[name] ??= []).push(f) },
  once(name, f) { (haken[name] ??= []).push(f) },
}

/*
 * Das Modul unter Pruefung. Fehlt es, ist das der rote Ausgangspunkt und kein
 * Werkzeugfehler: die Kernprobe wird dann rot gezaehlt.
 */
let modul = {}
try { modul = await import("./stream-klang.mjs") }
catch (e) { console.log(`  (stream-klang.mjs nicht ladbar: ${e?.code || e?.message || e})`) }

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

/* ------------------------------------------------------------------ */
/* Attrappe Sound, Zustaende aus client/audio/sound.mjs                */
/* ------------------------------------------------------------------ */
const STATES = Object.freeze({ FAILED: -1, NONE: 0, LOADING: 1, LOADED: 2, STARTING: 3, PLAYING: 4, PAUSED: 5, STOPPING: 6, STOPPED: 7 })
globalThis.foundry = { audio: { Sound: { STATES } } }

/** Welche Adressen das Tor bedient: nur die mit dem gueltigen Schluessel. */
let gueltig = SCHLUESSEL_B
class Klang {
  constructor(src) {
    Object.defineProperty(this, "src", { value: src, writable: false, enumerable: true })
    this._state = STATES.NONE
    this.ladeAufrufe = 0
    this.stopAufrufe = 0
    this.autoplay = false
    this._warte = null
  }
  get failed() { return this._state === STATES.FAILED }
  get playing() { return this._state === STATES.STARTING || this._state === STATES.PLAYING }
  addEventListener() {}
  /** Laedt sofort, ausser `_warte` haelt das Laden an. */
  load({ autoplay = false } = {}) {
    this.ladeAufrufe++
    if (this._warte) return this._warte
    this._state = this.src.includes(`/${gueltig}/`) ? STATES.LOADED : STATES.FAILED
    if (autoplay && !this.failed) { this._state = STATES.PLAYING; this.autoplay = true }
    return Promise.resolve(this)
  }
  stop() { this.stopAufrufe++; if (this.playing) this._state = STATES.STOPPED }
}

let audioGesperrt = false
globalThis.game.audio = { get locked() { return audioGesperrt } }

/** Attrappe PlaylistSound, `_createSound` und `sync` wie Foundry. */
class Spur {
  constructor(id, quelle, { playing = true } = {}) {
    this.id = id
    this._source = { path: quelle }
    this.playing = playing
    this.pausedTime = null
    this.repeat = false
    this.volume = 0.5
    this.sound = null
    this.resetAufrufe = 0
    this._vorbereiten()
  }
  _vorbereiten() { this.path = leinwandAdresse(this._source.path) }
  reset() { this.resetAufrufe++; this._vorbereiten() }
  get fadeDuration() { return 0 }
  _createSound() {
    if (game.audio.locked) {
      throw new Error("You may not call PlaylistSound#_createSound until after game audio is unlocked.")
    }
    if (!(this.id && this.path)) return null
    return new Klang(this.path)
  }
  sync() {
    if (!this.playing) {
      if (this.sound?.playing) this.sound.stop()
      return
    }
    this.sound ||= this._createSound()
    const sound = this.sound
    if (!sound || sound.failed) return
    if (sound.playing) return
    sound.load({ autoplay: true, autoplayOptions: { loop: this.repeat, volume: this.volume } })
  }
}

const PFAD = platzhalterAdresse("beneos_bm_0113", "4k", "musik/nacht.ogg")

/** Ein Klang, der mit Schluessel A gestartet und gescheitert ist. */
function gescheitert(id = "s1") {
  schluessel = SCHLUESSEL_A
  const ps = new Spur(id, PFAD)
  ps.sync()
  return ps
}

/** Der Wechsel auf B, wie Foundry ihn meldet: Wert gesetzt, dann der Haken. */
async function wechsle(neu = SCHLUESSEL_B, einstellung = SETTING.key) {
  schluessel = neu
  // Die Leinwand bereitet vorher neu vor (stream-leinwand.mjs:215-224).
  for (const pl of game.playlists) for (const ps of pl.sounds) ps.reset()
  for (const f of haken.updateSetting ?? []) await f({ key: `${MODULE_ID}.${einstellung}` })
  await Promise.resolve()
}

const hatSchluessel = (ps, s) => String(ps.sound?.src || "").includes(`/${s}/`)

console.log("Der heutige Fehler, ohne den Haken")
{
  const ps = gescheitert()
  gleich("Basis: mit A gescheitert", ps.sound.failed, true)
  schluessel = SCHLUESSEL_B
  ps.reset()
  ps.sync()
  gleich("Basis: nach dem Wechsel auf B ohne Haken bleibt der Klang stumm", ps.sound.failed, true)
}

console.log("Herkunft")
{
  gleich("stream-klang.mjs liefert installStreamKlang", typeof modul.installStreamKlang, "function")
  gleich("stream-klang.mjs liefert klangNachziehen", typeof modul.klangNachziehen, "function")
  if (typeof modul.installStreamKlang === "function") modul.installStreamKlang()
  gleich("ein zweiter Einbau setzt den Haken nicht doppelt",
    (modul.installStreamKlang?.(), (haken.updateSetting ?? []).length), 1)
}

console.log("Kern: der gescheiterte Klang spielt nach dem Wechsel")
{
  const ps = gescheitert()
  game.playlists = [{ sounds: [ps] }]
  const alt = ps.sound
  await wechsle()
  gleich("Kern: das Klangobjekt ist ersetzt", ps.sound !== alt, true)
  gleich("Kern: das neue Objekt traegt B", hatSchluessel(ps, SCHLUESSEL_B), true)
  gleich("Kern: es spielt (autoplay)", ps.sound?.playing === true && ps.sound?.autoplay === true, true)
}

console.log("Zwei Werte")
{
  // Wert 1: ohne Streamadresse, gescheitert, bleibt dasselbe Objekt.
  schluessel = SCHLUESSEL_A
  const fremd = new Spur("f1", "music/x.ogg")
  fremd.sound = new Klang("music/x.ogg")
  fremd.sound._state = STATES.FAILED
  const altFremd = fremd.sound
  gleich("Zweiwert 1: Ausgang ohne Streamadresse", await modul.klangNachziehen?.(fremd), "unberuehrt")
  gleich("Zweiwert 1: dasselbe Objekt", fremd.sound === altFremd, true)

  // Ein fremdes Modul schreibt beim Vorbereiten um: path weicht von der
  // Quelle ab. Auch dann gehoert der Klang nicht uns.
  const umgeschrieben = new Spur("f2", "music/y.ogg")
  umgeschrieben.path = "https://cdn.example/y.ogg"
  umgeschrieben.sound = new Klang("https://cdn.example/y.ogg")
  umgeschrieben.sound._state = STATES.FAILED
  const altUm = umgeschrieben.sound
  gleich("Zweiwert 1: fremder Umschreiber, Ausgang", await modul.klangNachziehen?.(umgeschrieben), "unberuehrt")
  gleich("Zweiwert 1: fremder Umschreiber, dasselbe Objekt und kein reset",
    umgeschrieben.sound === altUm && umgeschrieben.resetAufrufe === 0, true)

  // Wert 2: ein laufender Klang mit A wird nicht unterbrochen.
  schluessel = SCHLUESSEL_A
  gueltig = SCHLUESSEL_A
  const laeuft = new Spur("l1", PFAD)
  laeuft.sync()
  gueltig = SCHLUESSEL_B
  const altLauf = laeuft.sound
  game.playlists = [{ sounds: [laeuft] }]
  await wechsle()
  gleich("Zweiwert 2: laeuft vor dem Wechsel", altLauf.playing, true)
  gleich("Zweiwert 2: dasselbe Objekt, nicht gestoppt",
    laeuft.sound === altLauf && altLauf.stopAufrufe === 0 && altLauf.playing, true)
}

console.log("Laedt gerade: erst nach dem Laden entscheiden")
{
  schluessel = SCHLUESSEL_A
  const ps = new Spur("w1", PFAD)
  ps.sound = new Klang(ps.path)
  ps.sound._state = STATES.LOADING
  let freigeben
  ps.sound._warte = new Promise((r) => { freigeben = r })
  const alt = ps.sound
  schluessel = SCHLUESSEL_B
  ps.reset()
  const lauf = modul.klangNachziehen?.(ps)
  await Promise.resolve()
  gleich("LOADING: waehrend des Ladens kein zweites Objekt", ps.sound === alt, true)
  alt._state = STATES.FAILED
  alt._warte = null
  freigeben(alt)
  gleich("LOADING: nach dem Scheitern neu gebaut", await lauf, "neu")
  gleich("LOADING: das neue Objekt traegt B", hatSchluessel(ps, SCHLUESSEL_B), true)
}

console.log("Kein Anlass, kein Neubau")
{
  const ps = gescheitert()
  game.playlists = [{ sounds: [ps] }]
  await wechsle()
  const nachB = ps.sound
  await wechsle(SCHLUESSEL_B)
  gleich("derselbe Schluessel erneut: dasselbe Objekt", ps.sound === nachB, true)

  const ps2 = gescheitert("s2")
  game.playlists = [{ sounds: [ps2] }]
  const alt2 = ps2.sound
  schluessel = SCHLUESSEL_B
  ps2.reset()
  for (const f of haken.updateSetting ?? []) await f({ key: "core.fremd" })
  gleich("fremde Einstellung: dasselbe Objekt", ps2.sound === alt2, true)
}

console.log("Veraltetes vorbereitetes Feld")
{
  const ps = gescheitert("v1")
  schluessel = SCHLUESSEL_B
  // Ohne reset steht in path noch A, etwa wenn dieser Haken vor dem der
  // Leinwand liefe.
  gleich("veraltet: Ausgang", await modul.klangNachziehen?.(ps), "neu")
  gleich("veraltet: reset gerufen und B im neuen Objekt",
    ps.resetAufrufe === 1 && hatSchluessel(ps, SCHLUESSEL_B), true)
}

console.log("Ein werfender Klang haelt die anderen nicht auf")
{
  const kaputt = gescheitert("k1")
  kaputt._createSound = () => { throw new Error("kaputt") }
  const gut = gescheitert("k2")
  game.playlists = [{ sounds: [kaputt, gut] }]
  let geworfen = false
  try { await wechsle() } catch (_) { geworfen = true }
  gleich("werfend: der Haken wirft nicht", geworfen, false)
  gleich("werfend: der zweite Klang traegt B", hatSchluessel(gut, SCHLUESSEL_B), true)
}

console.log("Verdrahtung")
{
  const text = readFileSync(join(HIER, "beneos-stream.mjs"), "utf8")
  const leinwand = text.indexOf("installStreamLeinwand()")
  const klang = text.indexOf("installStreamKlang()")
  gleich("beneos-stream.mjs ruft installStreamKlang() nach installStreamLeinwand()",
    leinwand >= 0 && klang > leinwand, true)
}

console.log("Kein Schluessel in einer Ausgabe")
{
  const quelltext = readFileSync(fileURLToPath(import.meta.url), "utf8")
  const ausgaben = quelltext.split("\n").filter((z) => /console\.log\(/.test(z))
  gleich("keine Ausgabezeile nennt eine Adresse oder einen Schluessel",
    ausgaben.filter((z) => /SCHLUESSEL_|PFAD|\.src|\.path/.test(z)).length, 0)
}

console.log(`\n${aussagen} Aussagen, ${gruen} gruen, ${rot} rot`)
/*
 * Von Hand nachgezogen, siehe Kopf. Weicht die gezaehlte Zahl ab, ist der Lauf
 * mittendrin gestorben oder ein Block ist still weggefallen.
 */
const ERWARTET = 25
if (aussagen !== ERWARTET) {
  console.log(`ROT  erwartet ${ERWARTET} Aussagen, gezaehlt ${aussagen}`)
  process.exit(1)
}
process.exit(rot ? 1 : 0)
