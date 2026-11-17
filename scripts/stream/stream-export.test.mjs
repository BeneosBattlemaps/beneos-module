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

const einstellungen = {
  get [SETTING.key]() { return schluesselAn ? SCHLUESSEL : "" },
  [SETTING.base]: GATE,
  [SETTING.mode]: true,
}
installiereFoundry({ einstellungen })

let modul = null
try { modul = await import("./stream-export.mjs") } catch (_e) { modul = null }
const installStreamExport = modul?.installStreamExport ?? (() => {})
const exportSchluesselfrei = modul?.exportSchluesselfrei ?? ((d) => d)

const t = pruefstand("stre-T-134: kein Schluessel im Export, Heilen beim Hereinkommen")

const zaehle = (wert) => {
  const s = typeof wert === "string" ? wert : JSON.stringify(wert)
  return s.split(SCHLUESSEL).length - 1
}
const zaehleAlt = (wert) => JSON.stringify(wert).split(ALTER).length - 1
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
  static metadata = { embedded: {} }
  toCompendium(pack, optionen) { originalRufe++; return super.toCompendium(pack, optionen) }
}

globalThis.CONFIG.Tile = { documentClass: Kachel }
globalThis.CONFIG.Scene = { documentClass: Szene }
globalThis.CONFIG.JournalEntry = { documentClass: Journal }
globalThis.CONFIG.Note = { documentClass: Notiz }
globalThis.CONFIG.Region = { documentClass: NotizUnter }
globalThis.CONFIG.Item = { documentClass: Gegenstand }

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

/* ------------------------------------------------------------- Huelle */

t.abschnitt("Mit Huelle: 0 Mal der Schluessel")
{
  const k = new Kachel("Tile", kachelQuelle())
  const daten = k.toCompendium(null, {})
  t.gleich("mit Huelle: toCompendium traegt den Schluessel 0 Mal", zaehle(daten), 0)
  t.gleich("mit Huelle: exportToJSON traegt den Schluessel 0 Mal", zaehle(k.exportToJSON()), 0)
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
  const d = j.toCompendium(null, {})
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
  const d = j.toCompendium(null, {})
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
  const d = s.toCompendium(null, { clearFlags: false, clearSort: false, clearFolder: false, keepId: true })
  t.gleich("Abenteuerexport mit clearFlags:false: 0 Mal", zaehle(d), 0)
  t.gleich("Abenteuerexport: die Kennung bleibt", d._id, "szene0000000001")
  t.gleich("Szene: was nach super kommt, bleibt", d.nachSuper, true)
  const n = new NotizUnter("Region", { _id: "notiz0000000001" })
  t.gleich("Unterklasse haengt nach super eine Toradresse an: 0 Mal", zaehle(n.toCompendium(null, {})), 0)
}

t.abschnitt("Vertraeglichkeit mit fremden Huellen")
{
  originalRufe = 0
  const g = new Gegenstand("Item", { _id: "gegenstand00001", flags: { [MONKS]: { a: TOR(KLANG) } } })
  const d = g.toCompendium(null, {})
  t.gleich("das Original laeuft genau einmal", originalRufe, 1)
  t.gleich("die fremde Huelle davor: ihr Wert bleibt, ohne Schluessel", d.fremdVorher, FREI(KLANG))
  t.gleich("die fremde Huelle danach: ihr Wert bleibt", d.fremdNachher, true)
  t.gleich("Vertraeglichkeit: 0 Mal", zaehle(d), 0)
  installStreamExport()
  originalRufe = 0
  Kachel.prototype.toCompendium.call(new Kachel("Tile", kachelQuelle()), null, {})
  g.toCompendium(null, {})
  t.gleich("ein zweiter Einbau wickelt nicht doppelt", originalRufe, 1)
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

t.abschnitt("Ohne Schluessel")
{
  schluesselAn = false
  const d = new Journal("JournalEntry", { _id: "journal00000004", flags: { [MONKS]: { a: `${GATE}/a/${ALTER}/${REL}/${VAR}/k.ogg` } } })
    .toCompendium(null, {})
  t.gleich("ohne Schluessel: die Toradresse wird maskiert", zaehleAlt(d), 0)
  schluesselAn = true
}

/* ------------------------------------------------------------- Heilen */

const ruf = async (name, ...args) => { geschrieben.length = 0; await haken.rufe(name, ...args); return geschrieben.slice() }
const frei = () => ({
  _id: "kachel000000002",
  flags: { [MONKS]: { actions: [{ command: "playsound", data: { audiofile: FREI(KLANG) } }] }, [MODULE_ID]: { x: FREI(BILD) } },
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

t.abschnitt("Einbau")
{
  const namen = haken.namen()
  t.gleich("Haken createTile gesetzt", namen.includes("createTile"), true)
  t.gleich("Haken updateScene gesetzt", namen.includes("updateScene"), true)
}

t.ende()
