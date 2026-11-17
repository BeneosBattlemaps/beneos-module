/**
 * stream-fremdflaggen.test.mjs
 *
 * Pruefsatz zu stre-T-128: FREMDE FLAGS BEHALTEN DIE TORADRESSE.
 *
 *   node scripts/stream/stream-fremdflaggen.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 * Jede Probe ist im Sabotagelaeufer bewacht (`tools/stream-sabotagen.mjs`,
 * Satz `fremdflaggen`).
 *
 * WARUM. Seit stre-T-102 schreibt der Installer in jedes Feld, das eine
 * gestreamte Datei traegt, die schluesselfreie Form `beneos://`. Unser Modul
 * setzt den Schluessel zur Anzeige wieder ein (`stream-leinwand.mjs`,
 * `stream-bilder.mjs`). Ein fremdes Modul tut das nicht: monks-active-tiles
 * spielt sein `audiofile` mit genau der Zeichenkette, die im Flag steht, und
 * `beneos://` kann kein Browser laden. Unter `flags.<fremd>` gehoert deshalb
 * die Toradresse hin, wie vor stre-T-102.
 *
 * ZWEI TEILE, und beide haben hier ihre Faelle:
 *   - die Regel beim Einbau, `applyStreamAddresses` in `stream-install.mjs`;
 *   - der einmalige Ruecklauf fuer Welten, die zwischen stre-T-102 und
 *     stre-T-128 eingebaut wurden, `fremdflaggenZurueck` in
 *     `stream-fremdflaggen.mjs`.
 *
 * Die Haelfte der Faelle sind Gegenfaelle: das eigene Flag, das `img`-Feld
 * und gewoehnliche Felder muessen bleiben, wie sie vorher waren.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { installiereFoundry, pruefstand } from "../../tools/lib/foundry-attrappe.mjs"

const { SETTING, assetUrl, platzhalterAdresse, MODULE_ID } = await import("./stream-settings.mjs")

const GATE = "https://stream.beneos-battlemaps.com"
const SCHLUESSEL = "pk_pruefsatz_fremdflaggen"
let schluesselAn = true

const einstellungen = {
  get [SETTING.key]() { return schluesselAn ? SCHLUESSEL : "" },
  [SETTING.base]: GATE,
  [SETTING.mode]: true,
  [SETTING.nachzugRiegel]: "",
}
// Die Marke des Ruecklaufs nur eintragen, wenn das Modul sie kennt. Fehlt sie,
// wirft die Attrappe wie Foundry, und der Lauf liest den Rueckfallwert.
if (SETTING.fremdflaggenZurueck) einstellungen[SETTING.fremdflaggenZurueck] = false
installiereFoundry({ einstellungen })

const { applyStreamAddresses } = await import("./stream-install.mjs")
let fremdflaggenZurueck = null
try {
  ({ fremdflaggenZurueck } = await import("./stream-fremdflaggen.mjs"))
} catch (_e) {
  fremdflaggenZurueck = null
}

const t = pruefstand("stre-T-128: fremde Flags behalten die Toradresse")

const REL = "beneos_bm_pruefsatz"
const VAR = "4k"
const VIDEO = "beneos_assets/cloud/maps/pruef/pruef-karte.webm"
const KLANG = "beneos_assets/cloud/maps/pruef/pruef-klang.ogg"
const BILD = "beneos_assets/cloud/maps/pruef/pruef-bild.webp"
const ziele = new Map([VIDEO, KLANG, BILD].map((p) => [p, assetUrl(REL, VAR, p)]))
const FREI = (p) => platzhalterAdresse(REL, VAR, p)

t.abschnitt("Gegenproben der Vorbedingung")
t.gleich("das Ziel in der Liste traegt den Schluessel", ziele.get(KLANG).includes(SCHLUESSEL), true)
t.gleich("die schluesselfreie Form beginnt mit beneos://", FREI(KLANG).startsWith("beneos://"), true)

t.abschnitt("applyStreamAddresses(): die Regel beim Einbau")
{
  const kachel = {
    texture: { src: VIDEO },
    flags: {
      [MODULE_ID]: { stream: { video: VIDEO } },
      "monks-active-tiles": {
        actions: [{ command: "playsound", data: { audiofile: KLANG } }],
        img: BILD,
        notiz: `<p><img src="${BILD}"></p>`,
      },
    },
  }
  applyStreamAddresses(kachel, ziele)
  t.gleich("eigenes Flag stream.video wird schluesselfrei", kachel.flags[MODULE_ID].stream.video, FREI(VIDEO))
  t.gleich("fremdes audiofile behaelt die Toradresse", kachel.flags["monks-active-tiles"].actions[0].data.audiofile, ziele.get(KLANG))
  t.gleich("gewoehnliches Feld texture.src wird schluesselfrei", kachel.texture.src, FREI(VIDEO))
  t.gleich("das img-Feld bleibt auch unter einem fremden Flag oertlich", kachel.flags["monks-active-tiles"].img, BILD)
  t.gleich("HTML unter einem fremden Flag bekommt die Toradresse, nicht Form (a)",
    kachel.flags["monks-active-tiles"].notiz, `<p><img src="${ziele.get(BILD)}"></p>`)
}
{
  // Eingebettet: die Szene traegt Kacheln, jede mit eigenen Flags. Die Regel
  // haengt am Schluessel `flags`, nicht an der Tiefe.
  const szene = {
    flags: { "monks-sound-enhancements": { klang: KLANG } },
    tiles: [{ flags: { "monks-active-tiles": { klang: KLANG }, [MODULE_ID]: { stream: { video: VIDEO } } } }],
  }
  applyStreamAddresses(szene, ziele)
  t.gleich("fremdes Flag der Szene behaelt die Toradresse", szene.flags["monks-sound-enhancements"].klang, ziele.get(KLANG))
  t.gleich("fremdes Flag einer eingebetteten Kachel behaelt die Toradresse", szene.tiles[0].flags["monks-active-tiles"].klang, ziele.get(KLANG))
  t.gleich("eigenes Flag einer eingebetteten Kachel wird schluesselfrei", szene.tiles[0].flags[MODULE_ID].stream.video, FREI(VIDEO))
}
{
  // `flags: null` kommt in Altdaten vor. Der Einbau darf daran nicht brechen.
  const ohne = { flags: null, src: VIDEO }
  let ok = true
  try { applyStreamAddresses(ohne, ziele) } catch (_e) { ok = false }
  t.gleich("Flags null brechen den Einbau nicht ab", ok && ohne.flags === null && ohne.src === FREI(VIDEO), true)
}

t.abschnitt("fremdflaggenZurueck(): der einmalige Ruecklauf")
t.gleich("die Funktion ist exportiert", typeof fremdflaggenZurueck, "function")

/** Eine Attrappenwelt mit einer Szene und einer Kachel, die geschriebenes aufzeichnet. */
function welt({ wirft = false } = {}) {
  const geschrieben = []
  const quelle = {
    _id: "szene0000000001",
    flags: {
      "monks-sound-enhancements": { klang: FREI(KLANG) },
      "fremd-html": { text: `<img src="${FREI(BILD)}">` },
      [MODULE_ID]: { stream: { video: FREI(VIDEO) } },
    },
    tiles: [{
      _id: "kachel000000001",
      flags: {
        "monks-active-tiles": { actions: [{ data: { audiofile: FREI(KLANG) } }, { data: { audiofile: "sounds/eigen.ogg" } }] },
        [MODULE_ID]: { stream: { video: FREI(VIDEO) } },
      },
    }],
  }
  const doc = {
    id: quelle._id,
    documentName: "Scene",
    constructor: { metadata: { embedded: { Tile: "tiles" } } },
    toObject: () => JSON.parse(JSON.stringify(quelle)),
    async update(a) { if (wirft) throw new Error("abgelehnt"); geschrieben.push(["update", a]) },
    async updateEmbeddedDocuments(k, teile) { if (wirft) throw new Error("abgelehnt"); geschrieben.push([k, teile]) },
  }
  globalThis.game.scenes = [doc]
  for (const n of ["journal", "actors", "items", "tables", "cards", "messages", "playlists", "macros"]) globalThis.game[n] = []
  return geschrieben
}

/** Konsolenzeilen eines Laufs mitschneiden. */
async function mitschnitt(fn) {
  const zeilen = []
  const alt = { log: console.log, warn: console.warn }
  console.log = (...a) => zeilen.push(a.join(" "))
  console.warn = (...a) => zeilen.push(a.join(" "))
  try { return { wert: await fn(), zeilen } } finally { console.log = alt.log; console.warn = alt.warn }
}

if (typeof fremdflaggenZurueck === "function") {
  {
    const geschrieben = welt()
    const { wert: b } = await mitschnitt(() => fremdflaggenZurueck({ trocken: true }))
    t.gleich("trocken: nichts geschrieben", geschrieben.length, 0)
    t.gleich("trocken: zwei Adressen gezaehlt", b.adressen, 2)
    t.gleich("trocken: eine HTML-Stelle als Rest gezaehlt", b.rest, 1)
    t.gleich("trocken: die Marke bleibt ungesetzt", einstellungen[SETTING.fremdflaggenZurueck], false)
  }
  {
    const geschrieben = welt()
    const { wert: b, zeilen } = await mitschnitt(() => fremdflaggenZurueck())
    const szene = geschrieben.find(([k]) => k === "update")?.[1] ?? {}
    const kachel = geschrieben.find(([k]) => k === "Tile")?.[1]?.[0] ?? {}
    t.gleich("Szene: der ganze oberste Wert des fremden Flags wird geschrieben",
      JSON.stringify(szene[`flags.monks-sound-enhancements`]), JSON.stringify({ klang: ziele.get(KLANG) }))
    t.gleich("Szene: das eigene Flag wird nicht geschrieben", `flags.${MODULE_ID}` in szene, false)
    t.gleich("Szene: das HTML-Flag wird nicht geschrieben", "flags.fremd-html" in szene, false)
    t.gleich("Kachel: audiofile wird Toradresse, das eigene Feld daneben bleibt",
      JSON.stringify(kachel["flags.monks-active-tiles"]),
      JSON.stringify({ actions: [{ data: { audiofile: ziele.get(KLANG) } }, { data: { audiofile: "sounds/eigen.ogg" } }] }))
    t.gleich("Kachel: die Kennung steht im Teil", kachel._id, "kachel000000001")
    t.gleich("Kachel: das eigene Flag wird nicht geschrieben", `flags.${MODULE_ID}` in kachel, false)
    t.gleich("ohne Fehlschlag wird die Marke gesetzt", einstellungen[SETTING.fremdflaggenZurueck], true)
    t.gleich("der Bericht zaehlt zwei Adressen", b.adressen, 2)
    t.gleich("die Zaehlzeile nennt keinen Schluessel und keine Adresse",
      zeilen.some((z) => z.includes("pk_") || z.includes(SCHLUESSEL) || z.includes("http") || z.includes("beneos://")), false)
    t.gleich("die Zaehlzeile steht da", zeilen.some((z) => z.includes("Fremde Flags")), true)
    t.gleich("der Riegel ist danach wieder frei", einstellungen[SETTING.nachzugRiegel], "")
  }
  {
    // Zweiter Start: die Marke steht, also wird nicht einmal gelesen.
    const geschrieben = welt()
    const { wert: b } = await mitschnitt(() => fremdflaggenZurueck())
    t.gleich("zweiter Start: nichts geschrieben", geschrieben.length, 0)
    t.gleich("zweiter Start: als erledigt gemeldet", b.grund, "erledigt")
  }
  {
    einstellungen[SETTING.fremdflaggenZurueck] = false
    const geschrieben = welt({ wirft: true })
    const { wert: b } = await mitschnitt(() => fremdflaggenZurueck())
    t.gleich("Fehlschlag: als Fehler gezaehlt", b.fehler > 0, true)
    t.gleich("Fehlschlag: die Marke bleibt ungesetzt", einstellungen[SETTING.fremdflaggenZurueck], false)
    void geschrieben
  }
  {
    // Ein Spieler, keine Spielleitung: er darf die Welt nicht schreiben.
    globalThis.game.user.isGM = false
    const geschrieben = welt()
    const { wert: b } = await mitschnitt(() => fremdflaggenZurueck())
    globalThis.game.user.isGM = true
    t.gleich("Spieler: nichts geschrieben", geschrieben.length, 0)
    t.gleich("Spieler: Grund genannt", b.grund, "kein gm")
  }
  {
    // Ein besetzter Riegel: eine andere Sitzung laeuft gerade.
    einstellungen[SETTING.nachzugRiegel] = `andere|${Date.now()}|zufall`
    const geschrieben = welt()
    const { wert: b } = await mitschnitt(() => fremdflaggenZurueck())
    t.gleich("Riegel besetzt: nichts geschrieben", geschrieben.length, 0)
    t.gleich("Riegel besetzt: die Marke bleibt ungesetzt", einstellungen[SETTING.fremdflaggenZurueck], false)
    t.gleich("Riegel besetzt: Grund genannt", b.grund, "riegel")
    einstellungen[SETTING.nachzugRiegel] = ""
  }
  {
    // Nichts umzustellen: der Lauf haelt den Weltstart nicht mit dem Riegel
    // auf, der bis zu 1500 ms wartet. Der besetzte Riegel zeigt, dass er ihn
    // gar nicht erst nimmt.
    einstellungen[SETTING.nachzugRiegel] = `andere|${Date.now()}|zufall`
    const geschrieben = welt()
    globalThis.game.scenes[0].toObject = () => ({ _id: "szene0000000001", tiles: [], flags: {
      "fremd-html": { text: `<img src="${FREI(BILD)}">` }, [MODULE_ID]: { stream: { video: FREI(VIDEO) } } } })
    const { wert: b } = await mitschnitt(() => fremdflaggenZurueck())
    t.gleich("nichts umzustellen: nichts geschrieben", geschrieben.length, 0)
    t.gleich("nichts umzustellen: die HTML-Stelle als Rest gezaehlt", b.rest, 1)
    t.gleich("nichts umzustellen: die Marke wird ohne Riegel gesetzt", einstellungen[SETTING.fremdflaggenZurueck], true)
    t.gleich("nichts umzustellen: Grund genannt", b.grund, "gelaufen")
    einstellungen[SETTING.nachzugRiegel] = ""
    einstellungen[SETTING.fremdflaggenZurueck] = false
  }
  {
    // Ein Dokument, das sich nicht lesen laesst: ohne Adresse, aber mit
    // Fehler. Das ist nicht "nichts umzustellen", die Marke bleibt offen.
    welt()
    globalThis.game.scenes[0].toObject = () => { throw new Error("unlesbar") }
    const { wert: b } = await mitschnitt(() => fremdflaggenZurueck())
    t.gleich("unlesbares Dokument: als Fehler gezaehlt", b.fehler > 0, true)
    t.gleich("unlesbares Dokument: die Marke bleibt ungesetzt", einstellungen[SETTING.fremdflaggenZurueck], false)
  }
  {
    schluesselAn = false
    const geschrieben = welt()
    const { wert: b } = await mitschnitt(() => fremdflaggenZurueck())
    schluesselAn = true
    t.gleich("ohne Schluessel: nichts geschrieben", geschrieben.length, 0)
    t.gleich("ohne Schluessel: die Marke bleibt ungesetzt", einstellungen[SETTING.fremdflaggenZurueck], false)
    t.gleich("ohne Schluessel: Grund genannt", b.grund, "ohne schluessel")
  }
}

t.abschnitt("Einstieg: die feste Reihenfolge der Schluessellaeufe")
{
  // Eine Strukturaussage: der Einstieg laesst sich ohne ganzes Foundry nicht
  // laden. Geprueft wird nur der Rumpf von `schluesselLaeufe`.
  const quelle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "beneos-stream.mjs"), "utf8")
  const rumpf = quelle.slice(quelle.indexOf("async function schluesselLaeufe()"))
  const ende = rumpf.indexOf("\n}\n") >= 0 ? rumpf.indexOf("\n}\n") : rumpf.indexOf("\r\n}\r\n")
  const teil = rumpf.slice(0, ende)
  const a = teil.indexOf("altseitenUmstellen()")
  const f = teil.indexOf("await fremdflaggenZurueck()")
  t.struktur("schluesselLaeufe ruft fremdflaggenZurueck nach altseitenUmstellen", a >= 0 && f > a, true)
}

t.ende()
