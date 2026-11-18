/**
 * stream-export.test.mjs
 *
 * Pruefsatz zu stre-T-134 (Weg A): KEIN SCHLUESSEL IN EINEM EXPORT, UND BEIM
 * HEREINKOMMEN DIE TORADRESSE ZURUECK UNTER FREMDE FLAGS.
 *
 *   node scripts/stream/stream-export.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 * Jede Probe ist im Sabotagelaeufer bewacht (`tools/stream-sabotagen.mjs`,
 * Satz `export`).
 *
 * Gezaehlt wird der Schluessel, nie ausgegeben: jede Probe vergleicht eine
 * Zahl. Die Dokumentklassen unten bauen `toCompendium` und `exportToJSON`
 * nach dem Kern 13.351 nach (client-document.mjs:935 und :1122), so weit, wie
 * die Huelle sie beruehrt.
 */
import { installiereFoundry, pruefstand, haken } from "../../tools/lib/foundry-attrappe.mjs"

const { SETTING, assetUrl, platzhalterAdresse, MODULE_ID } = await import("./stream-settings.mjs")

const GATE = "https://gate.beneos.stream"
const SCHLUESSEL = "pk_pruefsatz_export_000001"
const ALTER = "pk_pruefsatz_alter_0000001"
let schluesselAn = true
let sonderAn = ""

const einstellungen = {
  get [SETTING.key]() { return sonderAn || (schluesselAn ? SCHLUESSEL : "") },
  [SETTING.base]: GATE,
  [SETTING.mode]: true,
}
installiereFoundry({ einstellungen })

let modul = null
try { modul = await import("./stream-export.mjs") } catch (_e) { modul = null }
const installStreamExport = modul?.installStreamExport ?? (() => {})
const exportSchluesselfrei = modul?.exportSchluesselfrei ?? ((d) => d)

const t = pruefstand("stre-T-134: kein Schluessel im Export, Heilen beim Hereinkommen")

/*
 * Wirft ein Export, steht an seiner Stelle WURF: jeder Zugriff darauf liefert
 * wieder WURF, und jeder Vergleich damit ist rot. Der Riegel in Schritt 5 haelt
 * einen Export mit Schluessel an; ohne diese Stelle braeche der Pruefsatz dort
 * ab, statt die Probe rot zu melden.
 */
const WURF = new Proxy(function wurf() {}, {
  get: (_z, p) => (p === "toJSON" ? () => "Export geworfen" : WURF),
})
const exp = (doc, optionen = {}) => { try { return doc.toCompendium(null, optionen) } catch (_e) { return WURF } }
const expJ = (doc) => { try { return doc.exportToJSON() } catch (_e) { return WURF } }

const zaehle = (wert) => {
  if (wert === WURF) return "Export geworfen"
  const s = typeof wert === "string" ? wert : JSON.stringify(wert)
  return s.split(SCHLUESSEL).length - 1
}
const zaehleAlt = (wert) => (wert === WURF ? "Export geworfen" : JSON.stringify(wert).split(ALTER).length - 1)
const kopie = (x) => JSON.parse(JSON.stringify(x))

const REL = "beneos_bm_pruefsatz"
const VAR = "4k"
const KLANG = "beneos_assets/cloud/maps/pruef/pruef-klang.ogg"
const BILD = "beneos_assets/cloud/maps/pruef/pruef-bild.webp"
const TOR = (p) => assetUrl(REL, VAR, p)
const FREI = (p) => platzhalterAdresse(REL, VAR, p)
const MONKS = "monks-active-tiles"

/* ------------------------------------------------------------- Attrappen */

const geschrieben = []
class KernDokument {
  constructor(name, quelle, { pack = null, parent = null } = {}) {
    this.documentName = name
    this._source = quelle
    this.id = quelle._id
    this.pack = pack
    this.parent = parent
  }
  toObject() { return kopie(this._source) }
  toCompendium(_pack, optionen = {}) {
    const daten = this.toObject()
    if (!optionen.keepId) delete daten._id
    if (optionen.clearFlags) delete daten.flags
    return daten
  }
  exportToJSON(optionen) {
    return JSON.stringify(this.toCompendium(null, { ...optionen, clearFlags: false, keepId: true }), null, 2)
  }
  async update(a) { geschrieben.push([this.documentName, "update", a]) }
  async updateEmbeddedDocuments(k, teile) { geschrieben.push([this.documentName, k, teile]) }
  // Wie der Kern: die Kinder einer Sammlung als eigene Dokumente.
  getEmbeddedCollection(k) {
    const feld = this.constructor.metadata.embedded[k]
    const Klasse = globalThis.CONFIG[k].documentClass
    const wert = this._source[feld]
    // Ein Einzelkind (ActorDelta) ist ein Dokument, keine Sammlung.
    if (wert && !Array.isArray(wert)) return new Klasse(k, wert, { parent: this })
    return (wert ?? []).map((q) => new Klasse(k, q, { parent: this }))
  }
}
class Kachel extends KernDokument { static metadata = { embedded: {} } }
class Szene extends KernDokument {
  static metadata = { embedded: { Tile: "tiles" } }
  // Wie scene.mjs:769: die Szene ruft super und arbeitet danach weiter.
  toCompendium(pack, optionen) {
    const daten = super.toCompendium(pack, optionen)
    daten.nachSuper = true
    return daten
  }
}
class Journal extends KernDokument { static metadata = { embedded: {} } }
class Notiz extends KernDokument { static metadata = { embedded: {} } }
// Eine Unterklasse, die selbst in CONFIG steht, haengt nach super einen Wert an.
class NotizUnter extends Notiz {
  toCompendium(pack, optionen) {
    const daten = super.toCompendium(pack, optionen)
    daten.angehaengt = TOR(KLANG)
    return daten
  }
}
// Fuer die Vertraeglichkeit: zaehlt die Rufe des Originals.
let originalRufe = 0
class Gegenstand extends KernDokument {
  static metadata = { embedded: { ActiveEffect: "effects" } }
  toCompendium(pack, optionen) { originalRufe++; return super.toCompendium(pack, optionen) }
}
class Effekt extends KernDokument { static metadata = { embedded: {} } }
class Delta extends KernDokument { static metadata = { embedded: {} } }
class Marke extends KernDokument { static metadata = { embedded: { ActorDelta: "delta" } } }
// Wie dnd5e: die Klasse in CONFIG erbt toCompendium von ihrer Elternklasse.
class AkteurBasis extends KernDokument {}
class Akteur extends AkteurBasis { static metadata = { embedded: { Item: "items" } } }

globalThis.CONFIG.ActiveEffect = { documentClass: Effekt }
globalThis.CONFIG.ActorDelta = { documentClass: Delta }
globalThis.CONFIG.Token = { documentClass: Marke }
globalThis.CONFIG.Actor = { documentClass: Akteur }
globalThis.CONFIG.Tile = { documentClass: Kachel }
globalThis.CONFIG.Scene = { documentClass: Szene }
globalThis.CONFIG.JournalEntry = { documentClass: Journal }
globalThis.CONFIG.Note = { documentClass: Notiz }
globalThis.CONFIG.Region = { documentClass: NotizUnter }
globalThis.CONFIG.Item = { documentClass: Gegenstand }

/*
 * stre-T-142 C: der Chatlog-Export. Wie der Kern 13.351 (chat-message.mjs:547)
 * gibt `export()` die Textknoten des Inhalts als Text aus. Die Klasse in
 * CONFIG erbt `export` von ihrer Elternklasse, und die Elternmethode wird
 * erst NACH dem Einbau gesetzt, wie eine spaete fremde Huelle.
 */
let chatText = ""
class NachrichtBasis extends KernDokument {}
class Nachricht extends NachrichtBasis { static metadata = { embedded: {} } }
globalThis.CONFIG.ChatMessage = { documentClass: Nachricht }

const kachelQuelle = () => ({
  _id: "kachel000000001",
  texture: { src: FREI(BILD) },
  flags: {
    [MODULE_ID]: { stream: { video: FREI(BILD) } },
    [MONKS]: { actions: [{ command: "playsound", data: { audiofile: TOR(KLANG) } }] },
  },
})

/* ------------------------------------------------------------- Vorbedingung */

t.abschnitt("Vorbedingung")
t.gleich("die Toradresse traegt den Schluessel", zaehle(TOR(KLANG)), 1)
t.gleich("das Modul laesst sich laden", modul !== null, true)

t.abschnitt("Ohne Huelle: der heutige Fehler")
{
  const k = new Kachel("Tile", kachelQuelle())
  t.gleich("ohne Huelle: toCompendium traegt den Schluessel einmal", zaehle(k.toCompendium(null, {})), 1)
  t.gleich("ohne Huelle: exportToJSON traegt den Schluessel einmal", zaehle(k.exportToJSON()), 1)
}

// Eine fremde Huelle VOR unserer, am Gegenstand.
const urGegenstand = Gegenstand.prototype.toCompendium
Gegenstand.prototype.toCompendium = function fremdVorher(...a) {
  const d = urGegenstand.apply(this, a)
  d.fremdVorher = TOR(KLANG)
  return d
}

installStreamExport()

// Eine fremde Huelle NACH unserer.
const unsereGegenstand = Gegenstand.prototype.toCompendium
Gegenstand.prototype.toCompendium = function fremdNachher(...a) {
  const d = unsereGegenstand.apply(this, a)
  d.fremdNachher = true
  return d
}

// Eine fremde Huelle NACH unserer an der ELTERNKLASSE, wie scene-packer per
// libWrapper an Actor.prototype.
let spaetRufe = 0
const urBasis = AkteurBasis.prototype.toCompendium
AkteurBasis.prototype.toCompendium = function spaetAnEltern(...a) {
  spaetRufe++
  const d = urBasis.apply(this, a)
  d.flags = { ...(d.flags ?? {}), "scene-packer": { sourceId: "Actor.quelle" } }
  return d
}

/* ------------------------------------------------------------- Huelle */

t.abschnitt("Mit Huelle: 0 Mal der Schluessel")
{
  const k = new Kachel("Tile", kachelQuelle())
  const daten = exp(k)
  t.gleich("mit Huelle: toCompendium traegt den Schluessel 0 Mal", zaehle(daten), 0)
  t.gleich("mit Huelle: exportToJSON traegt den Schluessel 0 Mal", zaehle(expJ(k)), 0)
  t.gleich("fremdes audiofile wird beneos://",
    daten.flags[MONKS].actions[0].data.audiofile, FREI(KLANG))
  t.gleich("_source behaelt die Toradresse (die Welt spielt wie vorher)", zaehle(k._source), 1)
  t.gleich("eigenes schluesselfreies Feld bleibt bytegleich", daten.texture.src, FREI(BILD))
  t.gleich("eigenes Flag bleibt bytegleich", daten.flags[MODULE_ID].stream.video, FREI(BILD))
  t.gleich("das Kommando daneben bleibt", daten.flags[MONKS].actions[0].command, "playsound")
}

t.abschnitt("Text und HTML")
{
  const html = `<p>Klang <a href="${TOR(KLANG)}">hier</a> und <img src="${TOR(BILD)}"> Ende.</p>`
  const j = new Journal("JournalEntry", {
    _id: "journal00000001",
    text: html,
    flags: { "fremd-modul": { notiz: `Siehe ${TOR(KLANG)} und ${TOR(BILD)}.`, ziel: "https://fremd.example/bilder/x.webp" } },
  })
  const d = exp(j)
  t.gleich("eigenes HTML mit zwei Adressen: 0 Mal", zaehle(d.text), 0)
  t.gleich("eigenes HTML: das Bild wird Form (a)", d.text.includes(`data-beneos-src="${FREI(BILD)}"`), true)
  t.gleich("fremder Text mit zwei Adressen: 0 Mal", zaehle(d.flags["fremd-modul"].notiz), 0)
  t.gleich("fremder Text: der Satz bleibt zeichengleich",
    d.flags["fremd-modul"].notiz, `Siehe ${FREI(KLANG)} und ${FREI(BILD)}.`)
  t.gleich("fremde Nicht-Beneos-Adresse bleibt bytegleich", d.flags["fremd-modul"].ziel, "https://fremd.example/bilder/x.webp")
}

t.abschnitt("Riegel")
{
  const schief = `${GATE}/a/${SCHLUESSEL}/beneos_ct_pruef/4k/kreatur.webp`
  const altHost = `https://alt.beneos.stream/a/${ALTER}/${REL}/${VAR}/karte.webp`
  const j = new Journal("JournalEntry", {
    _id: "journal00000002",
    flags: {
      "fremd-modul": {
        schief,
        nackt: `Schluessel: ${SCHLUESSEL} und kodiert ${encodeURIComponent(SCHLUESSEL)}`,
        alt: `${GATE}/a/${ALTER}/${REL}/${VAR}/karte.webp`,
        altHost,
        fremdHost: `https://fremd.example/a/${ALTER}/bild.webp`,
      },
    },
  })
  const d = exp(j)
  const f = d.flags["fremd-modul"]
  t.gleich("nicht rundlaufende Toradresse: 0 Mal", zaehle(f.schief), 0)
  t.gleich("nicht rundlaufende Toradresse: maskiert statt umgedeutet", f.schief, `${GATE}/a/-/beneos_ct_pruef/4k/kreatur.webp`)
  t.gleich("nackter Schluessel im Text: 0 Mal", zaehle(f.nackt), 0)
  t.gleich("alter Schluessel unter dem heutigen Tor: wird beneos://", f.alt, FREI(`karte.webp`))
  t.gleich("alter Schluessel unter frueherem Tor der Zone: 0 Mal", zaehleAlt(f.altHost), 0)
  t.gleich("fremder Host ausserhalb der Zone bleibt bytegleich", f.fremdHost, `https://fremd.example/a/${ALTER}/bild.webp`)
  t.gleich("zweimal gewandelt aendert nichts mehr", JSON.stringify(exportSchluesselfrei(kopie(d)) === 0 ? d : null), JSON.stringify(d))
}

t.abschnitt("Abenteuer und Szene")
{
  const s = new Szene("Scene", {
    _id: "szene0000000001",
    flags: { [MONKS]: { klang: TOR(KLANG) } },
    tiles: [kachelQuelle()],
  })
  // adventure-exporter.mjs:315 ruft je Dokument so.
  const d = exp(s, { clearFlags: false, clearSort: false, clearFolder: false, keepId: true })
  t.gleich("Abenteuerexport mit clearFlags:false: 0 Mal", zaehle(d), 0)
  t.gleich("Abenteuerexport: die Kennung bleibt", d._id, "szene0000000001")
  t.gleich("Szene: was nach super kommt, bleibt", d.nachSuper, true)
  const n = new NotizUnter("Region", { _id: "notiz0000000001" })
  t.gleich("Unterklasse haengt nach super eine Toradresse an: 0 Mal", zaehle(exp(n)), 0)
}

t.abschnitt("Vertraeglichkeit mit fremden Huellen")
{
  originalRufe = 0
  const g = new Gegenstand("Item", { _id: "gegenstand00001", flags: { [MONKS]: { a: TOR(KLANG) } } })
  const d = exp(g)
  t.gleich("das Original laeuft genau einmal", originalRufe, 1)
  t.gleich("die fremde Huelle davor: ihr Wert bleibt, ohne Schluessel", d.fremdVorher, FREI(KLANG))
  t.gleich("die fremde Huelle danach: ihr Wert bleibt", d.fremdNachher, true)
  t.gleich("Vertraeglichkeit: 0 Mal", zaehle(d), 0)
  const a = new Akteur("Actor", { _id: "akteur000000001", flags: { [MONKS]: { a: TOR(KLANG) } } })
  const da = exp(a)
  t.gleich("fremde Huelle spaeter an der Elternklasse: genau ein Ruf", spaetRufe, 1)
  t.gleich("fremde Huelle spaeter an der Elternklasse: ihr Flag bleibt", da.flags?.["scene-packer"]?.sourceId, "Actor.quelle")
  t.gleich("geerbte Methode: 0 Mal", zaehle(da), 0)
  const vorZweitem = Kachel.prototype.toCompendium
  installStreamExport()
  t.gleich("ein zweiter Einbau wickelt nicht doppelt", Kachel.prototype.toCompendium === vorZweitem, true)
}

t.abschnitt("Fehler in der Wandlung")
{
  const j = new Journal("JournalEntry", { _id: "journal00000003" })
  j.toObject = () => {
    const d = { flags: {} }
    Object.defineProperty(d.flags, "boese", { enumerable: true, get() { throw new Error(TOR(KLANG)) } })
    return d
  }
  let fehler = null
  try { j.toCompendium(null, {}) } catch (e) { fehler = e }
  t.gleich("die Wandlung wirft: der Export wirft auch", fehler !== null, true)
  t.gleich("die Fehlermeldung traegt den Schluessel 0 Mal", zaehle(String(fehler?.message ?? "")), 0)
}
{
  // Was der Lauf ueber die Werte nicht erreicht, haelt den Export an.
  const wirft = (daten) => { try { exportSchluesselfrei(daten); return false } catch (_e) { return true } }
  t.gleich("Schluessel im Eigenschaftsnamen: der Export wirft", wirft({ flags: { "fremd-modul": { [TOR(KLANG)]: 1 } } }), true)
  let tief = TOR(KLANG)
  for (let i = 0; i < 44; i++) tief = { x: tief }
  t.gleich("Schluessel tiefer als 40: der Export wirft", wirft({ flags: { "fremd-modul": tief } }), true)
  t.gleich("ohne Schluessel im Ergebnis: der Export wirft nicht", wirft({ flags: { "fremd-modul": { a: TOR(KLANG) } } }), false)
}

t.abschnitt("Schluessel mit Sonderzeichen")
{
  // Ein Schluessel, dessen kodierte Form sich von der rohen unterscheidet.
  const SONDER = "pk_pruefsatz/sonder+00001"
  sonderAn = SONDER
  const d = { flags: { "fremd-modul": { t: `kodiert ${encodeURIComponent(SONDER)} Ende` } } }
  exportSchluesselfrei(d)
  t.gleich("kodierter Schluessel mit Sonderzeichen im Text: 0 Mal", d.flags["fremd-modul"].t.split(encodeURIComponent(SONDER)).length - 1, 0)
  sonderAn = ""
}

t.abschnitt("Ohne Schluessel")
{
  schluesselAn = false
  const d = exp(new Journal("JournalEntry", { _id: "journal00000004", flags: { [MONKS]: { a: `${GATE}/a/${ALTER}/${REL}/${VAR}/k.ogg` } } }))
  t.gleich("ohne Schluessel: die Toradresse wird maskiert", zaehleAlt(d), 0)
  schluesselAn = true
}

/* ------------------------------------------------------------- Heilen */

const ruf = async (name, ...args) => { geschrieben.length = 0; await haken.rufe(name, ...args); return geschrieben.slice() }
const frei = () => ({
  _id: "kachel000000002",
  flags: { [MONKS]: { actions: [{ command: "playsound", data: { audiofile: FREI(KLANG) } }] }, [MODULE_ID]: { x: FREI(KLANG) } },
})

t.abschnitt("Heilen beim Hereinkommen")
{
  const k = new Kachel("Tile", frei())
  const w = await ruf("createTile", k, {}, "nutzer")
  const a = w.find(([, art]) => art === "update")?.[2] ?? {}
  t.gleich("create: genau ein update", w.length, 1)
  t.gleich("create: das fremde audiofile wird Toradresse", a[`flags.${MONKS}`]?.actions?.[0]?.data?.audiofile, TOR(KLANG))
  t.gleich("create: das eigene Flag wird nicht geschrieben", `flags.${MODULE_ID}` in a, false)
}
{
  // importFromJSON: update mit noHook am Dokument (client-document.mjs:1066).
  const s = new Szene("Scene", { _id: "szene0000000002", flags: { [MONKS]: { klang: FREI(KLANG) } }, tiles: [frei()] })
  const w = await ruf("updateScene", s, kopie(s._source), { noHook: true }, "nutzer")
  const eigen = w.find(([, art]) => art === "update")?.[2] ?? {}
  const kinder = w.find(([, art]) => art === "Tile")?.[2] ?? []
  t.gleich("JSON-Import (noHook): das fremde Flag der Szene wird Toradresse", eigen[`flags.${MONKS}`]?.klang, TOR(KLANG))
  t.gleich("JSON-Import (noHook): die eingebettete Kachel heilt mit", kinder[0]?.[`flags.${MONKS}`]?.actions?.[0]?.data?.audiofile, TOR(KLANG))
  t.gleich("JSON-Import (noHook): die Kachel traegt ihre Kennung", kinder[0]?._id, "kachel000000002")
}
{
  // Abenteuerimport: create der neuen Szenen (adventure.mjs:153), update der
  // vorhandenen mit noHook (adventure.mjs:166-169).
  const neu = new Szene("Scene", { _id: "szene0000000003", tiles: [frei()] })
  const w1 = await ruf("createScene", neu, {}, "nutzer")
  t.gleich("Abenteuerimport, neue Szene: die Kachel heilt", (w1.find(([, art]) => art === "Tile")?.[2] ?? [])[0]?.[`flags.${MONKS}`]?.actions?.[0]?.data?.audiofile, TOR(KLANG))
  const alt = new Szene("Scene", { _id: "szene0000000004", tiles: [frei()] })
  const w2 = await ruf("updateScene", alt, { tiles: kopie(alt._source.tiles) }, { noHook: true, diff: false }, "nutzer")
  t.gleich("Abenteuerimport, vorhandene Szene (noHook): die Kachel heilt", (w2.find(([, art]) => art === "Tile")?.[2] ?? [])[0]?.[`flags.${MONKS}`]?.actions?.[0]?.data?.audiofile, TOR(KLANG))
}

{
  // Rundlauf: fremdes HTML mit zwei Adressen mitten im Text.
  const html = `<p><img src="${TOR(BILD)}"> und ${TOR(KLANG)} Ende.</p>`
  const welt = { _id: "kachel000000006", flags: { "fremd-modul": { html } } }
  const export_ = exp(new Kachel("Tile", welt), { keepId: true })
  t.gleich("fremdes HTML im Export: 0 Mal", zaehle(export_), 0)
  const w = await ruf("createTile", new Kachel("Tile", export_), {}, "nutzer")
  const a = w.find(([, art]) => art === "update")?.[2] ?? {}
  t.gleich("fremdes HTML nach dem Rundlauf: wie vorher", a["flags.fremd-modul"]?.html, html)
}
{
  // Enkel: Effekt unter Gegenstand unter Akteur.
  const akteur = new Akteur("Actor", {
    _id: "akteur000000002",
    items: [{ _id: "gegenstand00002", flags: { [MONKS]: { a: FREI(KLANG) } },
      effects: [{ _id: "effekt000000001", flags: { [MONKS]: { a: FREI(KLANG) } } }] }],
  })
  const w = await ruf("createActor", akteur, {}, "nutzer")
  const kind = (w.find(([wer, art]) => wer === "Actor" && art === "Item")?.[2] ?? [])[0]
  const enkel = (w.find(([wer, art]) => wer === "Item" && art === "ActiveEffect")?.[2] ?? [])[0]
  t.gleich("Kind: der Gegenstand heilt", kind?.[`flags.${MONKS}`]?.a, TOR(KLANG))
  t.gleich("Enkel: der Effekt heilt", enkel?.[`flags.${MONKS}`]?.a, TOR(KLANG))
  t.gleich("Enkel: er traegt seine Kennung", enkel?._id, "effekt000000001")
}
{
  // Einzelkind: das ActorDelta eines Tokens bleibt aussen vor, ohne Fehler.
  const marke = new Marke("Token", { _id: "marke0000000001", flags: { [MONKS]: { a: FREI(KLANG) } },
    delta: { _id: "delta0000000001", flags: { [MONKS]: { a: FREI(KLANG) } } } })
  geschrieben.length = 0
  let fehler = null
  try { await modul?.heile?.(marke) } catch (e) { fehler = e }
  const a = geschrieben.find(([, art]) => art === "update")?.[2] ?? {}
  t.gleich("Einzelkind: das Heilen wirft nicht", fehler, null)
  t.gleich("Einzelkind: die Marke heilt", a[`flags.${MONKS}`]?.a, TOR(KLANG))
  t.gleich("Einzelkind: das Delta steht nicht im Update der Marke", `delta.flags.${MONKS}` in a, false)
}

t.abschnitt("Heilen: Gegenproben")
{
  const ohne = new Kachel("Tile", { _id: "kachel000000003", flags: { [MONKS]: { a: "sounds/lokal.ogg" } } })
  t.gleich("ohne beneos://: kein update", (await ruf("createTile", ohne, {}, "nutzer")).length, 0)
  const eigenNur = new Kachel("Tile", { _id: "kachel000000004", flags: { [MODULE_ID]: { a: FREI(KLANG) } } })
  t.gleich("beneos:// nur im eigenen Flag: kein update", (await ruf("createTile", eigenNur, {}, "nutzer")).length, 0)
  t.gleich("fremder Nutzer: kein update", (await ruf("createTile", new Kachel("Tile", frei()), {}, "anderer")).length, 0)
  globalThis.game.user.isGM = false
  t.gleich("Spieler: kein update", (await ruf("createTile", new Kachel("Tile", frei()), {}, "nutzer")).length, 0)
  globalThis.game.user.isGM = true
  t.gleich("Kompendiumsdokument: kein update",
    (await ruf("createTile", new Kachel("Tile", frei(), { pack: "welt.paket" }), {}, "nutzer")).length, 0)
  t.gleich("eingebettet im Kompendium: kein update",
    (await ruf("createTile", new Kachel("Tile", frei(), { parent: { pack: "welt.paket" } }), {}, "nutzer")).length, 0)
  schluesselAn = false
  t.gleich("ohne Schluessel: kein update", (await ruf("createTile", new Kachel("Tile", frei()), {}, "nutzer")).length, 0)
  schluesselAn = true
  const s = new Szene("Scene", { _id: "szene0000000005", flags: { [MONKS]: { klang: FREI(KLANG) } }, tiles: [] })
  t.gleich("update ohne beneos:// in der Aenderung: kein update",
    (await ruf("updateScene", s, { name: "neu" }, {}, "nutzer")).length, 0)
  const geheilt = new Kachel("Tile", { _id: "kachel000000005", flags: { [MONKS]: { a: TOR(KLANG) } } })
  t.gleich("das eigene Heil-Update loest kein zweites aus",
    (await ruf("updateTile", geheilt, { flags: { [MONKS]: { a: TOR(KLANG) } } }, {}, "nutzer")).length, 0)
}

t.abschnitt("stre-T-135 E2: fremder Schluessel wird der eigene")
{
  // Eine Toradresse des eigenen Tors mit dem Schluessel eines anderen Kontos,
  // wie sie in einer kopierten oder importierten Welt steht.
  const FREMD = (p) => TOR(p).replace(SCHLUESSEL, ALTER)
  const auf = (wert) => new Kachel("Tile", { _id: "kachel000000135", flags: { [MONKS]: { a: wert } } })
  const geheilt = async (wert, haken_ = "createTile", aenderung = null) => {
    const k = auf(wert)
    const w = haken_ === "createTile"
      ? await ruf("createTile", k, {}, "nutzer")
      : await ruf("updateTile", k, aenderung ?? { flags: { [MONKS]: { a: wert } } }, {}, "nutzer")
    return w.find(([, art]) => art === "update")?.[2]?.[`flags.${MONKS}`]?.a ?? "kein update"
  }
  t.gleich("Vorbedingung: die fremde Adresse traegt den fremden Schluessel", zaehleAlt(FREMD(KLANG)), 1)
  t.gleich("create: fremder Schluessel wird der eigene", await geheilt(FREMD(KLANG)), TOR(KLANG))
  t.gleich("create: eigener Schluessel bleibt zeichengleich (kein update)", await geheilt(TOR(KLANG)), "kein update")
  const fremdHost = `https://fremd.example/a/${ALTER}/${REL}/${VAR}/${KLANG}`
  t.gleich("create: fremder Host bleibt (kein update)", await geheilt(fremdHost), "kein update")
  t.gleich("update: fremder Schluessel in der Aenderung heilt", await geheilt(FREMD(KLANG), "updateTile"), TOR(KLANG))
  t.gleich("mitten im Text: fremder Schluessel wird der eigene",
    await geheilt(`Klang ${FREMD(KLANG)} und Bild ${FREMD(BILD)} Ende`), `Klang ${TOR(KLANG)} und Bild ${TOR(BILD)} Ende`)
  // Kalt-Review: das Textmuster nimmt Folgezeichen mit. Sie bleiben byte-gleich.
  t.gleich("eigener Schluessel mit Komma danach: kein update", await geheilt(`Klang ${TOR(KLANG)}, weiter`), "kein update")
  t.gleich("eigener Schluessel mit Entitaet danach: kein update",
    await geheilt(`<p>${TOR(KLANG)}&amp;nbsp;und</p>`), "kein update")
  t.gleich("eigener Schluessel mit Anfrage: kein update", await geheilt(`${TOR(KLANG)}?t=1`), "kein update")
  t.gleich("fremder Schluessel mit Komma danach: nur der Schluessel wechselt",
    await geheilt(`Klang ${FREMD(KLANG)}, weiter`), `Klang ${TOR(KLANG)}, weiter`)
  t.gleich("fremder Schluessel mit Anfrage: nur der Schluessel wechselt",
    await geheilt(`${FREMD(KLANG)}?t=1#x`), `${TOR(KLANG)}?t=1#x`)
  const maske = `${GATE}/a/-/${REL}/${VAR}/${KLANG}`
  t.gleich("maskierter Schluessel (-) bleibt (kein update)", await geheilt(maske), "kein update")
  const zform = `${GATE}/a/z.pruef/${REL}/${VAR}/${KLANG}`
  t.gleich("Form z. bleibt (kein update)", await geheilt(zform), "kein update")
  const eigenFlag = new Kachel("Tile", { _id: "kachel000000136", flags: { [MODULE_ID]: { a: FREMD(KLANG) } } })
  t.gleich("eigenes Flag mit fremdem Schluessel: kein update",
    (await ruf("createTile", eigenFlag, {}, "nutzer")).length, 0)
  // Nachpruefung: eine Toradresse, die IN einer fremden Adresse steckt, geht
  // an deren Host. Dort darf nie der eigene Schluessel landen.
  const fremdWeg = "https://fremd.example/go"
  t.gleich("in der Anfrage einer fremden Adresse: kein update",
    await geheilt(`${fremdWeg}?u=${FREMD(KLANG)}`), "kein update")
  t.gleich("im Pfad einer fremden Adresse: kein update",
    await geheilt(`https://fremd.example/proxy/${FREMD(KLANG)}`), "kein update")
  t.gleich("im Attribut einer fremden Adresse mit Leerraum: kein update",
    await geheilt(`<a href="${fremdWeg}?u= ${FREMD(KLANG)}">x</a>`), "kein update")
  t.gleich("beneos:// in der Anfrage einer fremden Adresse: kein update",
    await geheilt(`${fremdWeg}?u=${FREI(KLANG)}`), "kein update")
  t.gleich("hinter einem Host ohne Schema: kein update",
    await geheilt(`fremd.example/go?u=${FREMD(KLANG)}`), "kein update")
  t.gleich("hinter einem Schema ohne Schraegstrich: kein update",
    await geheilt(`mailto:a@fremd.example?body=${FREMD(KLANG)}`), "kein update")
  t.gleich("hinter einem Windows-Pfad: kein update",
    await geheilt(`\\\\fremd\\freigabe\\${FREMD(KLANG)}`), "kein update")
  t.gleich("Gegenprobe: je Absatz eine fremde Adresse, beide heilen",
    await geheilt(`<p>${FREMD(KLANG)}</p><p>${FREMD(BILD)}</p>`), `<p>${TOR(KLANG)}</p><p>${TOR(BILD)}</p>`)
  t.gleich("Gegenprobe: ganzer Attributwert heilt",
    await geheilt(`<img alt="a/b" src="${FREMD(BILD)}">`), `<img alt="a/b" src="${TOR(BILD)}">`)
  t.gleich("http mit fremdem Schluessel: kein update",
    await geheilt(FREMD(KLANG).replace(/^https:/, "http:")), "kein update")
  const rueck = FREMD(KLANG).replace(`/${ALTER}/`, `/${SCHLUESSEL}\\x/`)
  t.gleich("eigener Schluessel mit Rueckstrich: kein update", await geheilt(rueck), "kein update")
  t.gleich("update: fremde Adresse im HTML-Attribut heilt",
    await geheilt(`<img src="${FREMD(BILD)}">`, "updateTile"), `<img src="${TOR(BILD)}">`)
  t.gleich("update: fremde Adresse vor Zeilenumbruch heilt",
    await geheilt(`${FREMD(KLANG)}\nweiter`, "updateTile"), `${TOR(KLANG)}\nweiter`)
  t.gleich("update: fremde Adresse vor Tabulator heilt",
    await geheilt(`${FREMD(KLANG)}\tweiter`, "updateTile"), `${TOR(KLANG)}\tweiter`)
  schluesselAn = false
  t.gleich("ohne eigenen Schluessel: kein update", await geheilt(FREMD(KLANG)), "kein update")
  schluesselAn = true
}

t.abschnitt("stre-T-142 C: Chatlog-Export")
{
  // Die Elternmethode kommt erst jetzt, nach dem Einbau.
  NachrichtBasis.prototype.export = function kernExport() { return chatText }
  const n = new Nachricht("ChatMessage", { _id: "nachricht000001" })
  const ausgabe = () => { try { return n.export() } catch (_e) { return "Export geworfen" } }
  chatText = `[18:00] GM\nSiehe ${TOR(BILD)} hier`
  t.gleich("Chat: Toradresse im Text, 0 Mal der Schluessel", zaehle(ausgabe()), 0)
  t.gleich("Chat: die Adresse wird schluesselfrei", ausgabe(), `[18:00] GM\nSiehe ${FREI(BILD)} hier`)
  const SONDER = "pk_pruefsatz/chat+000001"
  sonderAn = SONDER
  chatText = `kodiert ${encodeURIComponent(SONDER)} und roh ${SONDER} Ende`
  t.gleich("Chat: Schluessel roh und kodiert, 0 Mal", [SONDER, encodeURIComponent(SONDER)].map((f) => ausgabe().split(f).length - 1).join(","), "0,0")
  sonderAn = ""
  chatText = "[18:00] GM\nnichts Besonderes"
  t.gleich("Zwei-Werte-Probe: Chat ohne Toradresse bytegleich", ausgabe(), "[18:00] GM\nnichts Besonderes")
  // Die Toradresse vor dem Abschalten bauen: `assetUrl` liest den Schluessel.
  const mitTor = `Siehe ${TOR(BILD)}`
  chatText = mitTor
  schluesselAn = false
  t.gleich("Chat ohne eigenen Schluessel: bytegleich", ausgabe(), mitTor)
  schluesselAn = true
}

t.abschnitt("Einbau")
{
  const namen = haken.namen()
  t.gleich("Haken createTile gesetzt", namen.includes("createTile"), true)
  t.gleich("Haken updateScene gesetzt", namen.includes("updateScene"), true)
}

t.ende()
