/**
 * stream-flaggen.test.mjs
 *
 * Pruefsatz zu stre-T-122 A bis E: DIE EIGENEN FLAGS STEHEN SCHLUESSELFREI AUF
 * DER PLATTE.
 *
 *   node scripts/stream/stream-flaggen.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 * Jede Probe ist im Sabotagelaeufer bewacht (`tools/stream-sabotagen.mjs`,
 * Satz `flaggen`).
 *
 * WARUM. Seit stre-T-102 nimmt das Schreibnetz in `stream-leinwand.mjs` den
 * Schluessel aus den Adressfeldern, bevor ein Dokument gespeichert wird. Die
 * eigenen Flags fasste es nicht an: die Videokachel traegt
 * `flags.beneos-module.stream.video` und `.partner`, die Szene ihre
 * Kreaturenlade unter `flags.beneos-module.creatureInstaller`. Beide gingen mit
 * der Toradresse samt Schluessel auf die Platte und damit in jeden Export.
 *
 * DIE TEILE, je mit Faellen:
 *   A  `falteWerte`: die Flaggenwerte eines Quellobjekts, gefaltet in einer Kopie.
 *   B  das Netz faltet die Flaggenpfade beim Aendern und beim Anlegen.
 *   C  der Adressnachzug schreibt ueber `update`, also durch das Netz; geprueft
 *      in genau seiner Patchform.
 *   D  die Kreaturenlade zeigt keine gestreamte Adresse in einer Scheibe.
 *   E  `flaggenUmstellen`: der einmalige Lauf fuer Welten, die vor diesem Stand
 *      eingebaut wurden.
 *
 * Gegenfaelle stehen jeweils daneben: fremde Flags behalten die Toradresse
 * (stre-T-128), andere eigene Flags bleiben, ohne Schluessel bleibt alles.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { installiereFoundry, pruefstand, haken } from "../../tools/lib/foundry-attrappe.mjs"

const { SETTING, assetUrl, platzhalterAdresse, MODULE_ID } = await import("./stream-settings.mjs")
const settings = await import("./stream-settings.mjs")

const GATE = "https://stream.beneos-battlemaps.com"
const SCHLUESSEL = "pk_pruefsatz_flaggen"
let schluesselAn = true

const einstellungen = {
  get [SETTING.key]() { return schluesselAn ? SCHLUESSEL : "" },
  [SETTING.base]: GATE,
  [SETTING.mode]: true,
  [SETTING.nachzugRiegel]: "",
}
// Die Marke nur eintragen, wenn das Modul sie kennt; fehlt sie, wirft die
// Attrappe wie Foundry.
if (SETTING.flaggenGefaltet) einstellungen[SETTING.flaggenGefaltet] = false
installiereFoundry({ einstellungen })

const leinwand = await import("./stream-leinwand.mjs")
let flaggenUmstellen = null
try {
  ({ flaggenUmstellen } = await import("./stream-flaggen.mjs"))
} catch (_e) {
  flaggenUmstellen = null
}

const t = pruefstand("stre-T-122 A bis E: eigene Flags schluesselfrei")

const REL = "beneos_bm_pruefsatz"
const VAR = "4k"
const VIDEO = "beneos_assets/cloud/maps/pruef/pruef-karte.webm"
const PARTNER = "beneos_assets/cloud/maps/pruef/pruef-karte-standbild.webp"
const KUNST = "beneos_assets/cloud/maps/pruef/pruef-kreatur.webp"
const MIT = (p) => assetUrl(REL, VAR, p)
const FREI = (p) => platzhalterAdresse(REL, VAR, p)
const FREMD_HOST = "https://fremd.example/a/pk_fremder_schluessel_xyz/beneos_bm_x/4k/y.webp"

t.abschnitt("Gegenproben der Vorbedingung")
t.gleich("die Toradresse traegt den Schluessel", MIT(VIDEO).includes(SCHLUESSEL), true)
t.gleich("die schluesselfreie Form beginnt mit beneos://", FREI(VIDEO).startsWith("beneos://"), true)

const json = (x) => JSON.stringify(x)
const hatSchluessel = (x) => json(x).includes(SCHLUESSEL)

t.abschnitt("A: falteWerte")
t.gleich("FLAGGEN_FELDER ist exportiert", typeof leinwand.FLAGGEN_FELDER, "object")
t.gleich("falteWerte ist exportiert", typeof leinwand.falteWerte, "function")
t.gleich("schreibFlaggen ist exportiert", typeof leinwand.schreibFlaggen, "function")
const falteWerte = leinwand.falteWerte ?? (() => ({}))
const schreibFlaggen = leinwand.schreibFlaggen ?? (() => 0)
{
  const quelle = { flags: {
    [MODULE_ID]: { stream: { role: "video", video: MIT(VIDEO), partner: MIT(PARTNER) }, anderes: { bild: MIT(KUNST) } },
    "monks-active-tiles": { audiofile: MIT(VIDEO) },
  } }
  const vorher = json(quelle)
  const neu = falteWerte("Tile", quelle)
  t.gleich("A Kachel: stream wird schluesselfrei, die Rolle bleibt",
    json(neu[`flags.${MODULE_ID}.stream`]), json({ role: "video", video: FREI(VIDEO), partner: FREI(PARTNER) }))
  t.gleich("A Kachel: nur stream kommt zurueck, kein fremdes und kein anderes eigenes Flag",
    json(Object.keys(neu)), json([`flags.${MODULE_ID}.stream`]))
  t.gleich("A Kachel: das Quellobjekt bleibt unberuehrt", json(quelle), vorher)
}
{
  const quelle = { flags: { [MODULE_ID]: { creatureInstaller: {
    srdCreatures: [{ art: MIT(KUNST), positions: [{ x: 1, texture: { src: MIT(KUNST) } }] }],
    beneosCreatures: [{ art: "modules/lokal/a.webp", positions: [] }],
  } } } }
  const neu = falteWerte("Scene", quelle)
  const ci = neu[`flags.${MODULE_ID}.creatureInstaller`]
  t.gleich("A Szene: art der Kreaturenlade wird schluesselfrei", ci?.srdCreatures?.[0]?.art, FREI(KUNST))
  t.gleich("A Szene: positions[].texture.src wird schluesselfrei", ci?.srdCreatures?.[0]?.positions?.[0]?.texture?.src, FREI(KUNST))
  t.gleich("A Szene: ein lokaler Pfad bleibt", ci?.beneosCreatures?.[0]?.art, "modules/lokal/a.webp")
}
t.gleich("A: nichts zu falten gibt ein leeres Objekt",
  json(falteWerte("Tile", { flags: { [MODULE_ID]: { stream: { video: FREI(VIDEO) } } } })), "{}")
t.gleich("A: ein fremder Host bleibt, nichts kommt zurueck",
  json(falteWerte("Tile", { flags: { [MODULE_ID]: { stream: { video: FREMD_HOST } } } })), "{}")
t.gleich("A: eine Art ohne Flaggenfelder gibt ein leeres Objekt",
  json(falteWerte("Actor", { flags: { [MODULE_ID]: { stream: { video: MIT(VIDEO) } } } })), "{}")
{
  const tor = MIT(VIDEO)
  schluesselAn = false
  t.gleich("A ohne Schluessel: nichts kommt zurueck",
    json(falteWerte("Tile", { flags: { [MODULE_ID]: { stream: { video: tor } } } })), "{}")
}
schluesselAn = true

t.abschnitt("A: schreibFlaggen in allen Formen, die Foundry annimmt")
{
  const a = { flags: { [MODULE_ID]: { stream: { video: MIT(VIDEO) } } } }
  t.gleich("verschachtelt: video wird schluesselfrei, Zahl 1",
    `${schreibFlaggen(a, "Tile")}|${a.flags[MODULE_ID].stream.video}`, `1|${FREI(VIDEO)}`)
  const b = { [`flags.${MODULE_ID}.stream.video`]: MIT(VIDEO) }
  schreibFlaggen(b, "Tile")
  t.gleich("ganz flach", b[`flags.${MODULE_ID}.stream.video`], FREI(VIDEO))
  const c = { [`flags.${MODULE_ID}`]: { "stream.partner": MIT(PARTNER) } }
  schreibFlaggen(c, "Tile")
  t.gleich("halb flach", c[`flags.${MODULE_ID}`]["stream.partner"], FREI(PARTNER))
  const d = { flags: { [MODULE_ID]: { "==stream": { video: MIT(VIDEO) } } } }
  schreibFlaggen(d, "Tile")
  t.gleich("ersetzend mit ==", d.flags[MODULE_ID]["==stream"].video, FREI(VIDEO))
  const e = { flags: { [MODULE_ID]: { "-=stream": null, anderes: { video: MIT(VIDEO) } } } }
  schreibFlaggen(e, "Tile")
  t.gleich("ein anderes eigenes Flag bleibt, -= bleibt stehen",
    json(e), json({ flags: { [MODULE_ID]: { "-=stream": null, anderes: { video: MIT(VIDEO) } } } }))
  const f = { flags: { "monks-active-tiles": { video: MIT(VIDEO) }, [MODULE_ID]: { stream: { video: MIT(VIDEO) } } } }
  schreibFlaggen(f, "Tile")
  t.gleich("fremdes Flag behaelt die Toradresse, das eigene wird schluesselfrei",
    `${f.flags["monks-active-tiles"].video === MIT(VIDEO)}|${f.flags[MODULE_ID].stream.video}`, `true|${FREI(VIDEO)}`)
  const g = { flags: { [MODULE_ID]: { stream: { video: MIT(VIDEO) } } } }
  t.gleich("eine Art ohne Flaggenfelder bleibt", `${schreibFlaggen(g, "Actor")}|${g.flags[MODULE_ID].stream.video === MIT(VIDEO)}`, "0|true")
  // Foundry 14 nimmt auch Operatorhuellen an (common/data/operators.mjs). Die
  // Attrappe bildet get und set dort nach: der Wert steckt hinter einem Symbol.
  const WERT = Symbol("wert")
  class Operator {
    constructor(v) { this[WERT] = v }
    static get(v) { return v instanceof Operator ? v[WERT] : v }
    static set(o, v) { return (o[WERT] = v) }
  }
  const vorher = globalThis.foundry.data
  globalThis.foundry.data = { operators: { DataFieldOperator: Operator } }
  try {
    const h = { flags: { [MODULE_ID]: { stream: new Operator({ video: MIT(VIDEO) }) } } }
    const i = { flags: { [MODULE_ID]: { stream: { video: new Operator(MIT(VIDEO)) } } } }
    const zahl = schreibFlaggen(h, "Tile") + schreibFlaggen(i, "Tile")
    t.gleich("Operatorhuelle um das Flag: der Wert darin wird schluesselfrei, die Huelle bleibt",
      `${h.flags[MODULE_ID].stream instanceof Operator}|${Operator.get(h.flags[MODULE_ID].stream).video}`, `true|${FREI(VIDEO)}`)
    t.gleich("Operatorhuelle um die Adresse: der Wert darin wird schluesselfrei, Zahl 2",
      `${zahl}|${i.flags[MODULE_ID].stream.video instanceof Operator}|${Operator.get(i.flags[MODULE_ID].stream.video)}`, `2|true|${FREI(VIDEO)}`)
  } finally {
    globalThis.foundry.data = vorher
  }
}

t.abschnitt("B: das Netz")
leinwand.installStreamLeinwand()
const upd = async (art, aenderung) => { await haken.rufe(`preUpdate${art}`, {}, aenderung, {}, "nutzer"); return aenderung }
{
  const a = await upd("Tile", { flags: { [MODULE_ID]: { stream: { video: MIT(VIDEO), partner: MIT(PARTNER) } } } })
  t.gleich("B preUpdateTile: video und partner werden schluesselfrei", hatSchluessel(a), false)
  const b = await upd("Scene", { [`flags.${MODULE_ID}.creatureInstaller`]: { srdCreatures: [{ art: MIT(KUNST) }] } })
  t.gleich("B preUpdateScene: die Kreaturenlade wird schluesselfrei", hatSchluessel(b), false)
  const c = await upd("Scene", { tiles: [{ _id: "k1", flags: { [MODULE_ID]: { stream: { video: MIT(VIDEO) } } } }] })
  t.gleich("B preUpdateScene: die Kachel in der Szenenaenderung wird schluesselfrei", c.tiles[0].flags[MODULE_ID].stream.video, FREI(VIDEO))
  const d = await upd("Tile", { flags: { "monks-active-tiles": { audiofile: MIT(VIDEO) } } })
  t.gleich("B preUpdateTile: fremdes Flag behaelt die Toradresse", d.flags["monks-active-tiles"].audiofile, MIT(VIDEO))
  const tor = MIT(VIDEO)
  schluesselAn = false
  const e = await upd("Tile", { flags: { [MODULE_ID]: { stream: { video: tor } } } })
  schluesselAn = true
  t.gleich("B ohne Schluessel: das Netz laesst alles stehen", e.flags[MODULE_ID].stream.video, tor)
}
{
  const anlegen = async (art, quelle) => {
    const neu = []
    const doc = { _source: quelle, updateSource(x) { neu.push(x) } }
    await haken.rufe(`preCreate${art}`, doc, quelle, {}, "nutzer")
    return neu
  }
  const a = await anlegen("Tile", { texture: { src: "lokal.webp" }, flags: { [MODULE_ID]: { stream: { video: MIT(VIDEO) } } } })
  t.gleich("B preCreateTile: updateSource bekommt das gefaltete Flag",
    a[0]?.[`flags.${MODULE_ID}.stream`]?.video, FREI(VIDEO))
  const b = await anlegen("Scene", { flags: {}, tiles: [
    { _id: "k1", texture: { src: "lokal.webp" }, flags: { [MODULE_ID]: { stream: { video: MIT(VIDEO) } } } },
    { _id: "k2", texture: { src: "lokal.webp" }, flags: {} },
  ] })
  t.gleich("B preCreateScene: nur die Kachel mit Flag geht mit, mit Kennung",
    json(b[0]?.tiles), json([{ _id: "k1", flags: { [MODULE_ID]: { stream: { video: FREI(VIDEO) } } } }]))
  const c = await anlegen("Tile", { texture: { src: "lokal.webp" }, flags: { [MODULE_ID]: { stream: { video: FREI(VIDEO) } } } })
  t.gleich("B preCreateTile: nichts zu falten, kein updateSource", c.length, 0)
}

t.abschnitt("C: der Adressnachzug in seiner Patchform")
{
  // `_planSchreiben` schickt den ganzen obersten Wert (`flags`) und
  // eingebettete Teile als `{_id, flags}` durch `update`.
  const a = await upd("Tile", { flags: {
    [MODULE_ID]: { stream: { video: MIT(VIDEO), partner: MIT(PARTNER), role: "video" } },
    "monks-active-tiles": { actions: [{ data: { audiofile: MIT(VIDEO) } }] },
  } })
  t.gleich("C Kachel: eigenes Flag schluesselfrei, fremdes behaelt die Toradresse",
    `${hatSchluessel(a.flags[MODULE_ID])}|${a.flags["monks-active-tiles"].actions[0].data.audiofile === MIT(VIDEO)}`, "false|true")
  const b = await upd("Scene", { flags: { [MODULE_ID]: { creatureInstaller: { srdCreatures: [{ art: MIT(KUNST), positions: [{ texture: { src: MIT(KUNST) } }] }] } } } })
  t.gleich("C Szene: die ganze Kreaturenlade ohne Schluessel", hatSchluessel(b), false)
}

t.abschnitt("D: die Kreaturenlade zeigt keine gestreamte Adresse")
t.gleich("ersteLokaleAdresse ist exportiert", typeof settings.ersteLokaleAdresse, "function")
{
  const erste = settings.ersteLokaleAdresse ?? (() => "fehlt")
  t.gleich("D: Toradresse und beneos:// werden uebersprungen, der lokale Pfad gewinnt",
    erste(MIT(KUNST), FREI(KUNST), "modules/lokal/a.webp"), "modules/lokal/a.webp")
  t.gleich("D: nur gestreamte Adressen ergeben null", erste(MIT(KUNST), FREI(KUNST), null, ""), null)
  t.gleich("D: der erste lokale Pfad gewinnt", erste("a.webp", "b.webp"), "a.webp")
}
t.gleich("scheibenBild ist exportiert", typeof settings.scheibenBild, "function")
{
  // Die Bildwahl der Scheibe ohne Premium, als Verhalten (Kalt-Review T-122,
  // Befund 2). Die Kette: lokal, Miniatur, Vorschau, Platzhalter.
  const wahl = settings.scheibenBild ?? (() => ({}))
  const PLATZ = "modules/beneos-module/ui/beneos_thumb_placeholder.svg"
  const CDN = "https://cdn.example/miniatur.webp"
  const DATEN = "data:image/webp;base64,AAAA"
  const ist = (...a) => json(wahl(...a))
  t.gleich("D scheibenBild: ein lokaler Pfad gewinnt vor Miniatur und Vorschau",
    ist([FREI(KUNST), "modules/lokal/a.webp"], CDN, DATEN), json({ img: "modules/lokal/a.webp", imgFallback: null }))
  t.gleich("D scheibenBild: nur gestreamt, Miniatur mit Vorschau als Rueckfall",
    ist([FREI(KUNST), MIT(KUNST)], CDN, DATEN), json({ img: CDN, imgFallback: DATEN }))
  t.gleich("D scheibenBild: nur gestreamt, ohne Miniatur die Vorschau",
    ist([FREI(KUNST)], null, DATEN), json({ img: DATEN, imgFallback: null }))
  t.gleich("D scheibenBild: nur gestreamt, weder Miniatur noch Vorschau ergibt den Platzhalter",
    ist([FREI(KUNST)], null, null), json({ img: PLATZ, imgFallback: null }))
  t.gleich("D scheibenBild: ohne jeden Kandidaten kein Bild",
    ist([null, "", undefined], CDN, DATEN), json({ img: null, imgFallback: null }))
  const quelle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../creature-installer/creature-installer.mjs"), "utf8")
  t.struktur("D: die Scheibe ohne Premium waehlt ueber scheibenBild",
    /scheibenBild\(\s*\[entry\.art, actor\?\.prototypeToken\?\.texture\?\.src, actor\?\.img\]/.test(quelle), true)
}

t.abschnitt("E: flaggenUmstellen, einmal je Welt")
t.gleich("die Funktion ist exportiert", typeof flaggenUmstellen, "function")

/** Konsolenzeilen eines Laufs mitschneiden. */
async function mitschnitt(fn) {
  const zeilen = []
  const alt = { log: console.log, warn: console.warn }
  console.log = (...a) => zeilen.push(a.join(" "))
  console.warn = (...a) => zeilen.push(a.join(" "))
  try { return { wert: await fn(), zeilen } } finally { console.log = alt.log; console.warn = alt.warn }
}

/** Zwei Szenen; die zweite wird angezeigt. Geschriebenes wird aufgezeichnet. */
function welt({ wirft = false } = {}) {
  const geschrieben = []
  const szene = (id, mitFlag) => {
    const quelle = {
      _id: id,
      flags: mitFlag
        ? { [MODULE_ID]: { creatureInstaller: { srdCreatures: [{ art: MIT(KUNST) }] } }, "monks-x": { a: MIT(KUNST) } }
        : {},
      tiles: [
        { _id: `${id}k1`, flags: { [MODULE_ID]: { stream: { video: MIT(VIDEO), partner: MIT(PARTNER) } } } },
        { _id: `${id}k2`, flags: { [MODULE_ID]: { stream: { video: FREI(VIDEO) } } } },
      ],
    }
    return {
      id, documentName: "Scene",
      toObject: () => JSON.parse(JSON.stringify(quelle)),
      async update(a) { if (wirft) throw new Error(`abgelehnt ${MIT(VIDEO)}`); geschrieben.push([id, "update", a]) },
      async updateEmbeddedDocuments(k, teile) { if (wirft) throw new Error("abgelehnt"); geschrieben.push([id, k, teile]) },
    }
  }
  const angezeigt = szene("szene2", false)
  globalThis.game.scenes = Object.assign([angezeigt, szene("szene1", true)], { viewed: angezeigt })
  return geschrieben
}

if (typeof flaggenUmstellen === "function") {
  {
    const geschrieben = welt()
    const { wert: b } = await mitschnitt(() => flaggenUmstellen({ trocken: true }))
    t.gleich("E trocken: nichts geschrieben", geschrieben.length, 0)
    t.gleich("E trocken: drei Dokumente gezaehlt (Szene 1, zwei Kacheln)", b.dokumente, 3)
    t.gleich("E trocken: die Marke bleibt ungesetzt", einstellungen[SETTING.flaggenGefaltet], false)
  }
  {
    const geschrieben = welt()
    const { wert: b, zeilen } = await mitschnitt(() => flaggenUmstellen())
    t.gleich("E: nichts Geschriebenes traegt den Schluessel", hatSchluessel(geschrieben), false)
    const s1 = geschrieben.find(([id, k]) => id === "szene1" && k === "update")?.[2] ?? {}
    t.gleich("E: die Kreaturenlade der Szene wird geschrieben",
      s1[`flags.${MODULE_ID}.creatureInstaller`]?.srdCreatures?.[0]?.art, FREI(KUNST))
    t.gleich("E: das fremde Flag wird nicht geschrieben", Object.keys(s1).some((k) => k.includes("monks")), false)
    const k1 = geschrieben.find(([id, k]) => id === "szene1" && k === "Tile")?.[2] ?? []
    t.gleich("E: nur die Kachel mit Toradresse geht mit, mit Kennung",
      json(k1), json([{ _id: "szene1k1", [`flags.${MODULE_ID}.stream`]: { video: FREI(VIDEO), partner: FREI(PARTNER) } }]))
    t.gleich("E: die angezeigte Szene wird zuletzt geschrieben", geschrieben.at(-1)?.[0], "szene2")
    t.gleich("E: ohne Fehlschlag wird die Marke gesetzt", einstellungen[SETTING.flaggenGefaltet], true)
    t.gleich("E: der Bericht zaehlt drei Dokumente", b.dokumente, 3)
    t.gleich("E: die Zaehlzeile steht da", zeilen.some((z) => z.includes("Eigene Flags")), true)
    t.gleich("E: keine Zeile nennt Schluessel oder Adresse",
      zeilen.some((z) => z.includes("pk_") || z.includes("http") || z.includes("beneos://")), false)
    t.gleich("E: der Riegel ist danach wieder frei", einstellungen[SETTING.nachzugRiegel], "")
  }
  {
    const geschrieben = welt()
    const { wert: b } = await mitschnitt(() => flaggenUmstellen())
    t.gleich("E zweiter Start: die Marke steht, nichts geschrieben", `${geschrieben.length}|${b.grund}`, "0|erledigt")
  }
  {
    einstellungen[SETTING.flaggenGefaltet] = false
    const geschrieben = welt({ wirft: true })
    const { wert: b, zeilen } = await mitschnitt(() => flaggenUmstellen())
    t.gleich("E Fehlschlag: die Marke bleibt offen", `${einstellungen[SETTING.flaggenGefaltet]}|${b.fehler > 0}`, "false|true")
    t.gleich("E Fehlschlag: die Warnung nennt keinen Schluessel", zeilen.some((z) => z.includes("pk_")), false)
    t.gleich("E Fehlschlag: der Riegel ist wieder frei", einstellungen[SETTING.nachzugRiegel], "")
    void geschrieben
  }
  {
    einstellungen[SETTING.flaggenGefaltet] = false
    const geschrieben = welt()
    schluesselAn = false
    const { wert: b } = await mitschnitt(() => flaggenUmstellen())
    schluesselAn = true
    t.gleich("E ohne Schluessel: kein Lauf", `${geschrieben.length}|${b.grund}`, "0|ohne schluessel")
    globalThis.game.user.isGM = false
    const { wert: c } = await mitschnitt(() => flaggenUmstellen())
    globalThis.game.user.isGM = true
    t.gleich("E ohne Spielleitung: kein Lauf", `${geschrieben.length}|${c.grund}`, "0|kein gm")
  }
  {
    // Eine Welt ohne Toradresse in den eigenen Flags: Marke ja, Riegel nein.
    einstellungen[SETTING.flaggenGefaltet] = false
    globalThis.game.scenes = []
    let genommen = 0
    const alt = globalThis.game.settings.set
    globalThis.game.settings.set = async (m, n, w) => { if (n === SETTING.nachzugRiegel && w) genommen++; return alt(m, n, w) }
    await mitschnitt(() => flaggenUmstellen())
    globalThis.game.settings.set = alt
    t.gleich("E leere Welt: Marke gesetzt, Riegel nicht genommen", `${einstellungen[SETTING.flaggenGefaltet]}|${genommen}`, "true|0")
  }
  {
    // Eine Toradresse unter fremdem Host bleibt stehen und wird als Rest gezaehlt.
    einstellungen[SETTING.flaggenGefaltet] = false
    const quelle = { _id: "rest1", flags: {}, tiles: [{ _id: "rest1k1", flags: { [MODULE_ID]: { stream: { video: FREMD_HOST } } } }] }
    globalThis.game.scenes = [{ id: "rest1", toObject: () => JSON.parse(JSON.stringify(quelle)) }]
    const { wert: b } = await mitschnitt(() => flaggenUmstellen({ trocken: true }))
    t.gleich("E Rest: fremder Host bleibt stehen und wird gezaehlt", `${b.dokumente}|${b.rest}`, "0|1")
    globalThis.game.scenes = []
  }
  {
    // Der Rest kennt jeden Raum aus der Tabelle, auch die Beute unter `/l/`
    // (Kalt-Review T-122, Befund 1).
    einstellungen[SETTING.flaggenGefaltet] = false
    const raeume = Object.values(settings.STREAM_RAUM_BUCHSTABE)
    const quelle = { _id: "rest2", flags: {}, tiles: raeume.map((r, i) => (
      { _id: `rest2k${i}`, flags: { [MODULE_ID]: { stream: { video: FREMD_HOST.replace("/a/", `/${r}/`) } } } })) }
    globalThis.game.scenes = [{ id: "rest2", toObject: () => JSON.parse(JSON.stringify(quelle)) }]
    const { wert: b } = await mitschnitt(() => flaggenUmstellen({ trocken: true }))
    t.gleich("E Rest zaehlt jeden Raum, auch /l/", `${raeume.length}|${b.rest}`, `${raeume.length}|${raeume.length}`)
    globalThis.game.scenes = []
  }
  {
    // Haelt eine andere Sitzung den Riegel, laeuft nichts (Befund 3).
    einstellungen[SETTING.flaggenGefaltet] = false
    const fremd = `fremd|${Date.now()}|x`
    einstellungen[SETTING.nachzugRiegel] = fremd
    const geschrieben = welt()
    const { wert: b } = await mitschnitt(() => flaggenUmstellen())
    t.gleich("E Riegel besetzt: nichts geschrieben, Grund riegel", `${geschrieben.length}|${b.grund}`, "0|riegel")
    t.gleich("E Riegel besetzt: die Marke bleibt ungesetzt", einstellungen[SETTING.flaggenGefaltet], false)
    t.gleich("E Riegel besetzt: die fremde Riegelmarke bleibt", einstellungen[SETTING.nachzugRiegel], fremd)
    einstellungen[SETTING.nachzugRiegel] = ""
  }
  {
    // Der Lauf haelt den Riegel unter dem Zweck des Ruecklaufs, damit ein
    // Adressnachzug auf ihn wartet statt abzusagen (Befund 3).
    einstellungen[SETTING.flaggenGefaltet] = false
    welt()
    const mitFlag = [...globalThis.game.scenes].find((s) => s.id === "szene1")
    const update = mitFlag.update
    let zweck = "nicht gelesen"
    mitFlag.update = async (a) => { zweck = String(einstellungen[SETTING.nachzugRiegel]).split("|")[3] ?? ""; return update(a) }
    await mitschnitt(() => flaggenUmstellen())
    t.gleich("E: haelt den Riegel unter RUECKLAUF_ZWECK", zweck, settings.RUECKLAUF_ZWECK)
  }
  {
    // Ein Fehler im Zaehllauf (Kachel mit Toradresse ohne Kennung): keine
    // Marke, kein Riegel (Befund 4).
    einstellungen[SETTING.flaggenGefaltet] = false
    const quelle = { _id: "ohne1", flags: {}, tiles: [{ flags: { [MODULE_ID]: { stream: { video: MIT(VIDEO) } } } }] }
    globalThis.game.scenes = [{ id: "ohne1", toObject: () => JSON.parse(JSON.stringify(quelle)),
      async update() {}, async updateEmbeddedDocuments() {} }]
    let genommen = 0
    const alt = globalThis.game.settings.set
    globalThis.game.settings.set = async (m, n, w) => { if (n === SETTING.nachzugRiegel && w) genommen++; return alt(m, n, w) }
    const { wert: b } = await mitschnitt(() => flaggenUmstellen())
    globalThis.game.settings.set = alt
    t.gleich("E Vorabfehler: Marke ungesetzt, Riegel nicht genommen, Fehler gezaehlt",
      `${einstellungen[SETTING.flaggenGefaltet]}|${genommen}|${b.fehler}`, "false|0|1")
    globalThis.game.scenes = []
  }
}

t.abschnitt("Einstieg: die feste Reihenfolge der Schluessellaeufe")
{
  const quelle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "beneos-stream.mjs"), "utf8")
  const rumpf = quelle.slice(quelle.indexOf("async function schluesselLaeufe()"))
  const ende = rumpf.indexOf("\n}\n") >= 0 ? rumpf.indexOf("\n}\n") : rumpf.indexOf("\r\n}\r\n")
  const teil = rumpf.slice(0, ende)
  const f = teil.indexOf("await fremdflaggenZurueck()")
  const e = teil.indexOf("await flaggenUmstellen()")
  t.struktur("schluesselLaeufe ruft flaggenUmstellen als vierten Schritt nach fremdflaggenZurueck", f >= 0 && e > f, true)
}

t.ende()
