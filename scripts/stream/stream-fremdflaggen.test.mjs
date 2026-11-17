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

const { SETTING, assetUrl, platzhalterAdresse, MODULE_ID, nachzugRiegelNehmenNachRuecklauf, nachzugRiegelLoesen } =
  await import("./stream-settings.mjs")

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
{
  // Kalt-Review 17.11.2026, W6: zwei Regeln ohne Wache. Unter einem fremden
  // Flag bleibt alles fremd, auch ein tiefer liegendes `flags.beneos-module`;
  // und eine Liste behaelt den Feldnamen, damit `img` gesperrt bleibt.
  const tief = { flags: { "monks-active-tiles": { teil: { flags: { [MODULE_ID]: { klang: KLANG } } } } }, img: [BILD] }
  applyStreamAddresses(tief, ziele)
  t.gleich("W6: unter einem fremden Flag bleibt auch ein tieferes eigenes Flag fremd",
    tief.flags["monks-active-tiles"].teil.flags[MODULE_ID].klang, ziele.get(KLANG))
  t.gleich("W6: eine Liste im img-Feld bleibt oertlich", JSON.stringify(tief.img), JSON.stringify([BILD]))
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

  t.abschnitt("Kalt-Review 17.11.2026: Nachbesserungen W2 bis W6")

  /** Eine Welt aus einem Dokument beliebiger Art. */
  function weltAus(quelle, { art = "Actor", eingebettet = {}, sammlung = "actors" } = {}) {
    const geschrieben = []
    const doc = {
      id: quelle._id,
      documentName: art,
      constructor: { metadata: { embedded: eingebettet } },
      toObject: () => JSON.parse(JSON.stringify(quelle)),
      async update(a) { geschrieben.push(["update", a]) },
      async updateEmbeddedDocuments(k, teile) { geschrieben.push([k, teile]) },
    }
    for (const n of ["journal", "actors", "items", "tables", "cards", "messages", "scenes", "playlists", "macros"]) globalThis.game[n] = []
    globalThis.game[sammlung] = [doc]
    return geschrieben
  }
  {
    // W2: Flags liegen nicht nur oben am Dokument. Das Prototyp-Token eines
    // Akteurs traegt eigene, und dort setzt monks-active-tiles seine Werte.
    einstellungen[SETTING.fremdflaggenZurueck] = false
    const geschrieben = weltAus({
      _id: "akteur000000001",
      prototypeToken: { flags: { "monks-active-tiles": { klang: FREI(KLANG) }, [MODULE_ID]: { stream: { video: FREI(VIDEO) } } } },
      system: { liste: [{ flags: { "fremd-liste": { klang: FREI(KLANG) } } }] },
    })
    const { wert: b } = await mitschnitt(() => fremdflaggenZurueck())
    const a = geschrieben.find(([k]) => k === "update")?.[1] ?? {}
    t.gleich("W2: fremdes Flag im Prototyp-Token wird Toradresse",
      JSON.stringify(a["prototypeToken.flags.monks-active-tiles"]), JSON.stringify({ klang: ziele.get(KLANG) }))
    t.gleich("W2: eigenes Flag im Prototyp-Token wird nicht geschrieben", `prototypeToken.flags.${MODULE_ID}` in a, false)
    t.gleich("W2: ein fremdes Flag in einer Liste wird nicht geschrieben",
      Object.keys(a).some((k) => k.includes("fremd-liste") || k.startsWith("system")), false)
    t.gleich("W2: das fremde Flag in der Liste zaehlt als Rest", b.rest, 1)
    t.gleich("W2: eine Adresse gezaehlt", b.adressen, 1)
  }
  {
    // W3: ein Fehlschlag nennt Art und Kennung, aber nicht den Fehlertext.
    einstellungen[SETTING.fremdflaggenZurueck] = false
    welt({ wirft: true })
    const { zeilen } = await mitschnitt(() => fremdflaggenZurueck())
    t.gleich("W3: der Fehlschlag nennt Art und Kennung", zeilen.some((z) => z.includes("Scene szene0000000001")), true)
    t.gleich("W3: die Meldung traegt nicht den Fehlertext", zeilen.some((z) => z.includes("abgelehnt")), false)
  }
  {
    // W6 und W3: eine eingebettete Kachel ohne Kennung laesst sich nicht
    // gezielt schreiben. Sie zaehlt als Fehler und wird mit dem Dokument
    // gemeldet; die Marke bleibt offen.
    einstellungen[SETTING.fremdflaggenZurueck] = false
    const geschrieben = weltAus({ _id: "szene0000000002", tiles: [{ flags: { "monks-active-tiles": { klang: FREI(KLANG) } } }] },
      { art: "Scene", eingebettet: { Tile: "tiles" }, sammlung: "scenes" })
    const { wert: b, zeilen } = await mitschnitt(() => fremdflaggenZurueck())
    t.gleich("W6: Kachel ohne Kennung wird nicht geschrieben", geschrieben.length, 0)
    t.gleich("W6: Kachel ohne Kennung zaehlt als Fehler", b.fehler > 0, true)
    t.gleich("W6: Kachel ohne Kennung laesst die Marke offen", einstellungen[SETTING.fremdflaggenZurueck], false)
    t.gleich("W3: die Kachel ohne Kennung wird mit dem Dokument gemeldet",
      zeilen.some((z) => z.includes("szene0000000002") && z.includes("Tile")), true)
  }
  {
    // W4: nur Fehler, keine Adresse. Dann gibt es nichts zu schreiben, und
    // der Riegel, der bis zu 1500 ms wartet, wird nicht genommen. Der besetzte
    // Riegel zeigt es.
    einstellungen[SETTING.fremdflaggenZurueck] = false
    einstellungen[SETTING.nachzugRiegel] = `andere|${Date.now()}|zufall`
    welt()
    globalThis.game.scenes[0].toObject = () => { throw new Error("unlesbar") }
    const { wert: b } = await mitschnitt(() => fremdflaggenZurueck())
    einstellungen[SETTING.nachzugRiegel] = ""
    t.gleich("W4: nur Fehler: der Riegel wird nicht genommen", b.grund, "gelaufen")
    t.gleich("W4: nur Fehler: der Fehler steht im Bericht", b.fehler > 0, true)
    t.gleich("W4: nur Fehler: die Marke bleibt offen", einstellungen[SETTING.fremdflaggenZurueck], false)
  }
  {
    // W5: der Ruecklauf haelt den Weltriegel unter seinem Zweck, damit ein
    // Adressnachzug, der ihn besetzt findet, weiss, dass er warten soll.
    einstellungen[SETTING.fremdflaggenZurueck] = false
    let gesehen = ""
    welt()
    const doc = globalThis.game.scenes[0]
    const urUpdate = doc.update
    doc.update = async (a) => { gesehen = String(einstellungen[SETTING.nachzugRiegel]); return urUpdate.call(doc, a) }
    await mitschnitt(() => fremdflaggenZurueck())
    t.gleich("W5: der Ruecklauf haelt den Riegel unter seinem Zweck", gesehen.endsWith("|fremdflaggen"), true)
  }
}

t.abschnitt("W5: der Adressnachzug wartet auf den Ruecklauf")
t.gleich("W5: das Abwarten ist exportiert", typeof nachzugRiegelNehmenNachRuecklauf, "function")
if (typeof nachzugRiegelNehmenNachRuecklauf === "function") {
  einstellungen[SETTING.nachzugRiegel] = `andere|${Date.now()}|zufall|fremdflaggen`
  setTimeout(() => { einstellungen[SETTING.nachzugRiegel] = "" }, 30)
  const { wert: marke } = await mitschnitt(() => nachzugRiegelNehmenNachRuecklauf({ schritt: 10, frist: 5000 }))
  t.gleich("W5: haelt der Ruecklauf den Riegel, bekommt der Nachzug ihn danach", !!marke && marke !== "ohne-riegel", true)
  await nachzugRiegelLoesen(marke)

  einstellungen[SETTING.nachzugRiegel] = `andere|${Date.now()}|zufall`
  const { wert: zweite, zeilen: zweiteZeilen } = await mitschnitt(() => nachzugRiegelNehmenNachRuecklauf({ schritt: 10, frist: 5000 }))
  t.gleich("W5: haelt ein anderer Nachzug den Riegel, bleibt es beim Absagen", zweite, "")
  t.gleich("W5: haelt ein anderer Nachzug den Riegel, wird nur einmal gefragt",
    zweiteZeilen.filter((z) => z.includes("laeuft schon")).length, 1)

  einstellungen[SETTING.nachzugRiegel] = `andere|${Date.now()}|zufall|fremdflaggen`
  const anfang = Date.now()
  const { wert: dritte, zeilen: dritteZeilen } = await mitschnitt(() => nachzugRiegelNehmenNachRuecklauf({ schritt: 10, frist: 40 }))
  t.gleich("W5: endet der Ruecklauf nicht in der Frist, sagt der Nachzug ab", dritte, "")
  t.gleich("W5: die Frist begrenzt das Warten", Date.now() - anfang < 1000, true)
  t.gleich("W5: das Ende der Frist wird gemeldet", dritteZeilen.some((z) => z.includes("gab den Riegel nicht frei")), true)
  einstellungen[SETTING.nachzugRiegel] = ""
}
{
  const quelle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "stream-settings.mjs"), "utf8")
  const rumpf = quelle.slice(quelle.indexOf("async function _adressenNachziehen()"))
  t.struktur("_adressenNachziehen nimmt den Riegel ueber das Abwarten",
    rumpf.slice(0, 200).includes("await nachzugRiegelNehmenNachRuecklauf()"), true)
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
