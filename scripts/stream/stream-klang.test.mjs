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
const GATE_NEU = "https://gate3.beneos.stream"
let basis = GATE
const SCHLUESSEL_A = "pk_pruefsatz_alt_a"
const SCHLUESSEL_B = "pk_pruefsatz_neu_b"

let schluessel = SCHLUESSEL_A
globalThis.game = {
  settings: {
    get(_modul, name) {
      if (name === SETTING.key) return schluessel
      if (name === SETTING.base) return basis
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
  /** `sound.mjs` v14 :174: erst ab LOADED, ein gescheitertes Objekt nie. */
  get loaded() { return this._state >= STATES.LOADED }
  /** Wie `EventEmitterMixin` aus Foundry: je Typ, mit `once`. */
  addEventListener(typ, fn, { once = false } = {}) { ((this._zuhoerer ??= {})[typ] ??= []).push({ fn, once }) }
  sende(typ) {
    this._zuhoerer ??= {}
    const liste = this._zuhoerer[typ] ?? []
    this._zuhoerer[typ] = liste.filter((z) => !z.once)
    for (const z of liste) z.fn()
  }
  /** Laedt sofort, ausser `_warte` haelt das Laden an. */
  load({ autoplay = false } = {}) {
    this.ladeAufrufe++
    if (this._warte) return this._warte
    this._state = this.src.includes(`/${gueltig}/`) ? STATES.LOADED : STATES.FAILED
    if (autoplay && !this.failed) { this._state = STATES.PLAYING; this.autoplay = true }
    return Promise.resolve(this)
  }
  stop() { this.stopAufrufe++; if (this.playing) { this._state = STATES.STOPPED; this.sende?.("stop") } }
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

/*
 * ATTRAPPE AmbientSound (stre-T-123), Foundry 13.351 und 14.367,
 * `client/canvas/placeables/sound.mjs`:
 *
 * - `_createSound` v13 :76-79, v14 :94-97, mit `singleton: true`. Der Cache in
 *   `AudioHelper.create` (`client/audio/helper.mjs:189-199`) ist nach `src`
 *   geschluesselt; ein zweites Placeable mit derselben Adresse bekommt dasselbe
 *   Objekt.
 * - `sync` v13 :169-200, v14 :196-235: unhoerbar stoppt, hoerbar baut einmal
 *   (`this.sound ||=`), laedt nur ohne `_manager`, steigt bei `!sound.loaded`
 *   aus (v13 :191-192, v14 :218-219) und spielt sonst.
 */
const audioCache = new Map()
function audioErzeuge(src) {
  let s = audioCache.get(src)
  if (!s) { s = new Klang(src); audioCache.set(src, s) }
  return s
}
class Szenenklang {
  constructor(id, quelle) {
    this.id = id
    this.destroyed = false
    this.sound = undefined
    this.document = {
      _source: { path: quelle },
      resetAufrufe: 0,
      path: leinwandAdresse(quelle),
      reset() { this.resetAufrufe++; this.path = leinwandAdresse(this._source.path) },
    }
  }
  _createSound() {
    this.erzeugt = (this.erzeugt || 0) + 1
    const path = this.document.path
    if (!this.id || !path) return null
    return audioErzeuge(path)
  }
  async sync(isAudible) {
    if (!isAudible) {
      if (!this.sound) return
      this.sound._manager = null
      this.sound.stop()
      return
    }
    this.sound ||= this._createSound()
    if (this.sound === null) return
    const sound = this.sound
    const requireLoad = !sound.loaded && !sound._manager
    sound._manager = this
    if (requireLoad) await sound.load()
    if (!sound.loaded) return
    if (!sound.playing) sound._state = STATES.PLAYING
  }
}

/** `canvas.sounds`: `refresh` synct jedes hoerbare Placeable (layers/sounds.mjs). */
let refreshAufrufe = 0
let refreshWirft = false
globalThis.canvas = {
  sounds: {
    placeables: [],
    refresh() {
      refreshAufrufe++
      if (refreshWirft) throw new TypeError("Cannot read properties of undefined (reading 'refresh')")
      for (const pl of this.placeables) if (!pl.destroyed) pl.sync(true)
    },
  },
}
const ruhe = () => new Promise((r) => setTimeout(r, 0))
const ambPfad = (id) => platzhalterAdresse("beneos_bm_0006", "4k", `amb/${id}.ogg`)

/** Ein Szenenklang, der mit Schluessel A hoerbar wurde und gescheitert ist. */
async function szeneGescheitert(id) {
  schluessel = SCHLUESSEL_A
  gueltig = SCHLUESSEL_B
  const pl = new Szenenklang(id, ambPfad(id))
  await pl.sync(true)
  return pl
}

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
  for (const s of canvas.sounds.placeables) s.document.reset()
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
  gleich("Zweiwert 2: laeuft vor dem Wechsel", altLauf.playing, true)
  await wechsle()
  gleich("Zweiwert 2: dasselbe Objekt, nicht gestoppt",
    laeuft.sound === altLauf && altLauf.stopAufrufe === 0 && altLauf.playing, true)

  // Nach dem Stopp traegt das Objekt fuer den naechsten Start B, ohne dass der
  // Stopp den Titel neu startet (Kalt-Review 17.11.2026, Befund 5).
  laeuft.playing = false
  altLauf.stop()
  gleich("Zweiwert 2: nach dem Stopp ein neues Objekt mit B",
    laeuft.sound !== altLauf && hatSchluessel(laeuft, SCHLUESSEL_B), true)
  gleich("Zweiwert 2: nach dem Stopp kein Neustart", laeuft.sound?.playing, false)

  // Natuerliches Ende, waehrend das Dokument noch `playing` traegt: das neue
  // Objekt darf nicht von selbst losspielen.
  schluessel = SCHLUESSEL_A
  gueltig = SCHLUESSEL_A
  const ende = new Spur("l2", PFAD)
  ende.sync()
  gueltig = SCHLUESSEL_B
  const altEnde = ende.sound
  game.playlists = [{ sounds: [ende] }]
  await wechsle()
  altEnde._state = STATES.STOPPED
  altEnde.sende("end")
  gleich("Zweiwert 2: nach dem Ende ersetzt, aber kein Neustart",
    ende.sound !== altEnde && ende.sound?.playing === false, true)

  // Stoppt ein Klang, dessen Adresse schon die von heute ist, bleibt er.
  schluessel = SCHLUESSEL_B
  const aktuell = new Spur("l3", PFAD)
  aktuell.sync()
  const altAktuell = aktuell.sound
  game.playlists = [{ sounds: [aktuell] }]
  await wechsle()
  aktuell.playing = false
  altAktuell.stop()
  gleich("Zweiwert 2: Stopp mit aktueller Adresse, dasselbe Objekt", aktuell.sound === altAktuell, true)
}

console.log("Ohne Klangobjekt")
{
  schluessel = SCHLUESSEL_B
  const ps = new Spur("o1", PFAD)
  let ausgang
  try { ausgang = await modul.klangNachziehen?.(ps) } catch (_) { ausgang = "wirft" }
  gleich("ohne Klangobjekt: Ausgang ohne-klang, es bleibt keines", [ausgang, ps.sound], ["ohne-klang", null])
}

console.log("Basiswechsel")
{
  const ps = gescheitert("b1")
  game.playlists = [{ sounds: [ps] }]
  schluessel = SCHLUESSEL_B
  basis = GATE_NEU
  for (const pl of game.playlists) for (const s of pl.sounds) s.reset()
  for (const f of haken.updateSetting ?? []) await f({ key: `${MODULE_ID}.${SETTING.base}` })
  gleich("Basiswechsel: das neue Objekt traegt die neue Basis",
    String(ps.sound?.src || "").startsWith(`${GATE_NEU}/`), true)
  basis = GATE
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

  // Baut Foundry waehrend des Wartens selbst neu, gilt die Entscheidung fuer
  // das neue Objekt: es traegt B und laedt, es wird nicht ersetzt.
  schluessel = SCHLUESSEL_A
  const ps2 = new Spur("w2", PFAD)
  ps2.sound = new Klang(ps2.path)
  ps2.sound._state = STATES.LOADING
  let frei2
  ps2.sound._warte = new Promise((r) => { frei2 = r })
  const alt2 = ps2.sound
  schluessel = SCHLUESSEL_B
  ps2.reset()
  const lauf2 = modul.klangNachziehen?.(ps2)
  await Promise.resolve()
  // Foundry hat waehrenddessen den Pfad geaendert und in `_onUpdate` neu gebaut.
  ps2._source.path = platzhalterAdresse("beneos_bm_0113", "4k", "musik/morgen.ogg")
  ps2.reset()
  const vonFoundry = new Klang(ps2.path)
  vonFoundry._state = STATES.LOADED
  ps2.sound = vonFoundry
  alt2._state = STATES.FAILED
  alt2._warte = null
  frei2(alt2)
  await lauf2
  gleich("LOADING: von Foundry neu gebautes Objekt bleibt", ps2.sound === vonFoundry, true)
}

console.log("Kein Anlass, kein Neubau")
{
  const ps = gescheitert()
  game.playlists = [{ sounds: [ps] }]
  await wechsle()
  const nachB = ps.sound
  // Angehalten und geladen: dann haelt ihn allein der Abgleich der Adresse,
  // nicht schon der Zweig fuer laufende Klaenge.
  ps.playing = false
  nachB._state = STATES.LOADED
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

console.log("Szenenklang (stre-T-123)")
{
  game.playlists = []
  const amb = canvas.sounds

  // Der heutige Fehler am Szenenklang, ohne Modul: gemessen am 17.11.2026 in
  // v14 und v13, dasselbe Objekt bleibt mit A gescheitert.
  {
    const pl = await szeneGescheitert("a0")
    gleich("Szenenklang Basis: mit A gescheitert", pl.sound.failed, true)
    schluessel = SCHLUESSEL_B
    pl.document.reset()
    await pl.sync(true)
    gleich("Szenenklang Basis: nach dem Wechsel ohne Haken stumm", pl.sound.failed, true)
  }

  gleich("stream-klang.mjs liefert szenenklangNachziehen", typeof modul.szenenklangNachziehen, "function")

  // Kern
  {
    const pl = await szeneGescheitert("a1")
    const alt = pl.sound
    amb.placeables = [pl]
    const vorher = refreshAufrufe
    await wechsle()
    await ruhe()
    gleich("Szenenklang Kern: das Objekt ist ersetzt", pl.sound !== alt, true)
    gleich("Szenenklang Kern: das neue Objekt traegt B", hatSchluessel(pl, SCHLUESSEL_B), true)
    gleich("Szenenklang Kern: genau ein refresh", refreshAufrufe - vorher, 1)
    gleich("Szenenklang Kern: es spielt danach", pl.sound?.playing, true)
    gleich("Szenenklang Kern: das alte Objekt hat keinen Verwalter mehr", alt._manager === null, true)
  }

  // Zweiwert 1: ohne Streamadresse
  {
    schluessel = SCHLUESSEL_A
    const pl = new Szenenklang("a2", "sounds/regen.ogg")
    pl.sound = new Klang("sounds/regen.ogg")
    pl.sound._state = STATES.FAILED
    const alt = pl.sound
    gleich("Szenenklang Zweiwert 1: Ausgang ohne Streamadresse", await modul.szenenklangNachziehen?.(pl), "unberuehrt")
    gleich("Szenenklang Zweiwert 1: dasselbe Objekt", pl.sound === alt, true)
  }

  // Zweiwert 2: ein laufender Szenenklang
  {
    schluessel = SCHLUESSEL_A
    gueltig = SCHLUESSEL_A
    const pl = new Szenenklang("a3", ambPfad("a3"))
    await pl.sync(true)
    gueltig = SCHLUESSEL_B
    const alt = pl.sound
    amb.placeables = [pl]
    gleich("Szenenklang Zweiwert 2: laeuft vor dem Wechsel", alt.playing, true)
    await wechsle()
    gleich("Szenenklang Zweiwert 2: dasselbe Objekt, nicht gestoppt",
      pl.sound === alt && alt.stopAufrufe === 0 && alt.playing, true)
    // Unhoerbar: Foundry stoppt (sync(false)), danach traegt das Objekt B.
    await pl.sync(false)
    gleich("Szenenklang Zweiwert 2: nach dem Stopp ein neues Objekt mit B",
      pl.sound !== alt && hatSchluessel(pl, SCHLUESSEL_B), true)
    gleich("Szenenklang Zweiwert 2: nach dem Stopp kein Neustart", pl.sound?.playing, false)
    // Wieder hoerbar: der naechste sync baut mit B und spielt.
    await pl.sync(true)
    gleich("Szenenklang Zweiwert 2: wieder hoerbar spielt er mit B",
      pl.sound?.playing === true && hatSchluessel(pl, SCHLUESSEL_B), true)
  }

  // Stopp mit schon aktueller Adresse
  {
    schluessel = SCHLUESSEL_B
    const pl = new Szenenklang("a4", ambPfad("a4"))
    await pl.sync(true)
    const alt = pl.sound
    amb.placeables = [pl]
    await wechsle()
    const erzeugt = pl.erzeugt
    await pl.sync(false)
    // Der Singleton-Cache gaebe dasselbe Objekt auch bei einem Neubau zurueck;
    // gezaehlt wird deshalb, ob ueberhaupt neu erzeugt wurde.
    gleich("Szenenklang: Stopp mit aktueller Adresse, dasselbe Objekt, nichts erzeugt",
      pl.sound === alt && pl.erzeugt === erzeugt, true)
  }

  // Abbau (Planleser B5): das Placeable ist zerstoert, bevor "stop" kommt.
  {
    schluessel = SCHLUESSEL_A
    gueltig = SCHLUESSEL_A
    const pl = new Szenenklang("a5", ambPfad("a5"))
    await pl.sync(true)
    gueltig = SCHLUESSEL_B
    const alt = pl.sound
    amb.placeables = [pl]
    await wechsle()
    pl.destroyed = true
    alt.stop()
    gleich("Szenenklang Abbau: zerstoertes Placeable bekommt kein neues Objekt", pl.sound === alt, true)
  }

  // Foundry hat das Objekt inzwischen selbst ersetzt (Pfadaenderung): der
  // spaete Stopp des alten Objekts baut nichts mehr.
  {
    schluessel = SCHLUESSEL_A
    gueltig = SCHLUESSEL_A
    const pl = new Szenenklang("a5b", ambPfad("a5b"))
    await pl.sync(true)
    gueltig = SCHLUESSEL_B
    const alt = pl.sound
    amb.placeables = [pl]
    await wechsle()
    const vonFoundry = new Klang(pl.document.path)
    pl.sound = vonFoundry
    alt.stop()
    gleich("Szenenklang Zweiwert 2: von Foundry ersetzt, der Stopp des alten baut nichts", pl.sound === vonFoundry, true)
  }

  // Ohne Klangobjekt
  {
    schluessel = SCHLUESSEL_B
    const pl = new Szenenklang("a6", ambPfad("a6"))
    let ausgang
    try { ausgang = await modul.szenenklangNachziehen?.(pl) } catch (_) { ausgang = "wirft" }
    gleich("Szenenklang ohne Klangobjekt: Ausgang ohne-klang, es bleibt keines", [ausgang, pl.sound ?? null], ["ohne-klang", null])
  }

  // Zerstoertes Placeable
  {
    const pl = await szeneGescheitert("a7")
    const alt = pl.sound
    pl.destroyed = true
    schluessel = SCHLUESSEL_B
    pl.document.reset()
    gleich("Szenenklang zerstoert: Ausgang unberuehrt, dasselbe Objekt",
      [await modul.szenenklangNachziehen?.(pl), pl.sound === alt], ["unberuehrt", true])
  }

  // LOADING
  {
    schluessel = SCHLUESSEL_A
    const pl = new Szenenklang("a8", ambPfad("a8"))
    pl.sound = new Klang(pl.document.path)
    pl.sound._state = STATES.LOADING
    let frei
    pl.sound._warte = new Promise((r) => { frei = r })
    const alt = pl.sound
    schluessel = SCHLUESSEL_B
    pl.document.reset()
    const lauf = modul.szenenklangNachziehen?.(pl)
    await Promise.resolve()
    gleich("Szenenklang LOADING: waehrend des Ladens kein zweites Objekt", pl.sound === alt, true)
    alt._state = STATES.FAILED
    alt._warte = null
    frei(alt)
    gleich("Szenenklang LOADING: nach dem Scheitern neu gebaut", await lauf, "neu")

    // Foundry baut waehrend des Wartens selbst neu (Pfadaenderung): bleibt.
    schluessel = SCHLUESSEL_A
    const pl2 = new Szenenklang("a9", ambPfad("a9"))
    pl2.sound = new Klang(pl2.document.path)
    pl2.sound._state = STATES.LOADING
    let frei2
    pl2.sound._warte = new Promise((r) => { frei2 = r })
    const alt2 = pl2.sound
    schluessel = SCHLUESSEL_B
    pl2.document.reset()
    const lauf2 = modul.szenenklangNachziehen?.(pl2)
    await Promise.resolve()
    pl2.document._source.path = ambPfad("a9-neu")
    pl2.document.reset()
    const vonFoundry = new Klang(pl2.document.path)
    vonFoundry._state = STATES.LOADED
    pl2.sound = vonFoundry
    alt2._state = STATES.FAILED
    alt2._warte = null
    frei2(alt2)
    await lauf2
    gleich("Szenenklang LOADING: von Foundry neu gebautes Objekt bleibt", pl2.sound === vonFoundry, true)
  }

  // Kein Anlass
  {
    const pl = await szeneGescheitert("b1")
    amb.placeables = [pl]
    await wechsle()
    await ruhe()
    const nachB = pl.sound
    nachB._state = STATES.LOADED
    const vorRefresh = refreshAufrufe
    const erzeugt = pl.erzeugt
    await wechsle(SCHLUESSEL_B)
    gleich("Szenenklang derselbe Schluessel erneut: dasselbe Objekt, nichts erzeugt",
      pl.sound === nachB && pl.erzeugt === erzeugt, true)
    gleich("Szenenklang derselbe Schluessel erneut: kein refresh", refreshAufrufe - vorRefresh, 0)

    const pl2 = await szeneGescheitert("b2")
    amb.placeables = [pl2]
    const alt2 = pl2.sound
    schluessel = SCHLUESSEL_B
    pl2.document.reset()
    for (const f of haken.updateSetting ?? []) await f({ key: "core.fremd" })
    gleich("Szenenklang fremde Einstellung: dasselbe Objekt", pl2.sound === alt2, true)
  }

  // Veraltetes vorbereitetes Feld
  {
    const pl = await szeneGescheitert("b3")
    schluessel = SCHLUESSEL_B
    gleich("Szenenklang veraltet: Ausgang", await modul.szenenklangNachziehen?.(pl), "neu")
    gleich("Szenenklang veraltet: reset gerufen und B im neuen Objekt",
      pl.document.resetAufrufe === 1 && hatSchluessel(pl, SCHLUESSEL_B), true)
  }

  // Werfend
  {
    const kaputt = await szeneGescheitert("b4")
    kaputt._createSound = () => { throw new Error("kaputt") }
    const gut = await szeneGescheitert("b5")
    amb.placeables = [kaputt, gut]
    let geworfen = false
    try { await wechsle() } catch (_) { geworfen = true }
    gleich("Szenenklang werfend: der Haken wirft nicht", geworfen, false)
    gleich("Szenenklang werfend: der zweite traegt B", hatSchluessel(gut, SCHLUESSEL_B), true)

    const pl = await szeneGescheitert("b6")
    amb.placeables = [pl]
    refreshWirft = true
    let geworfen2 = false
    try { await wechsle() } catch (_) { geworfen2 = true }
    refreshWirft = false
    gleich("Szenenklang refresh wirft: der Haken wirft nicht, das Objekt traegt B",
      [geworfen2, hatSchluessel(pl, SCHLUESSEL_B)], [false, true])

    // Direkt gerufen, ohne den Fang des Hakens: der Neubau wird trotzdem
    // gezaehlt und gemeldet.
    const pl2 = await szeneGescheitert("b6b")
    amb.placeables = [pl2]
    schluessel = SCHLUESSEL_B
    pl2.document.reset()
    refreshWirft = true
    let zahl
    try { zahl = await modul.szenenklaengeNachziehen?.() } catch (_) { zahl = "wirft" }
    refreshWirft = false
    gleich("Szenenklang refresh wirft: der Neubau wird gemeldet", zahl?.neu, 1)
  }

  // Nebeneinander (Planleser B6): ein ladender Playlist-Titel haelt den
  // Szenenklang nicht auf.
  {
    schluessel = SCHLUESSEL_A
    const ps = new Spur("n1", PFAD)
    ps.sound = new Klang(ps.path)
    ps.sound._state = STATES.LOADING
    let frei
    ps.sound._warte = new Promise((r) => { frei = r })
    const psAlt = ps.sound
    const pl = await szeneGescheitert("b7")
    const plAlt = pl.sound
    game.playlists = [{ sounds: [ps] }]
    amb.placeables = [pl]
    schluessel = SCHLUESSEL_B
    ps.reset()
    pl.document.reset()
    const lauf = Promise.all((haken.updateSetting ?? []).map((f) => f({ key: `${MODULE_ID}.${SETTING.key}` })))
    await ruhe()
    gleich("Szenenklang nebeneinander: ersetzt, waehrend der Playlist-Titel noch laedt",
      pl.sound !== plAlt && ps.sound === psAlt, true)
    psAlt._state = STATES.FAILED
    psAlt._warte = null
    frei(psAlt)
    await lauf
    game.playlists = []
  }

  amb.placeables = []
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
const ERWARTET = 65
if (aussagen !== ERWARTET) {
  console.log(`ROT  erwartet ${ERWARTET} Aussagen, gezaehlt ${aussagen}`)
  process.exit(1)
}
process.exit(rot ? 1 : 0)
