/**
 * stream-umschalter.test.mjs
 *
 * Der Umschalter zwischen statischer und animierter Karte probt nur Pfade der
 * eigenen Welt. Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-umschalter.test.mjs
 *
 * WARUM DIESER PRUEFSATZ, stre-T-102. Seit der schluesselfreien Form steht in
 * einem Dokument `beneos://<raum>/<release>/<pfad>`. Bei laufendem Streaming
 * macht `leinwandAdresse` daraus im vorbereiteten Feld die Toradresse, die
 * `isAbsoluteRef` als absolut kennt. Bei Modus aus bleibt das vorbereitete Feld
 * schluesselfrei. `isAbsoluteRef` kannte `beneos://` nicht, der Umschalter
 * sammelte die Karte als oertlich, und die Probe schickte
 * `beneos%3A//...` als HEAD gegen den eigenen Foundry-Server: ein 404 im
 * Konsolenlog und ein Eintrag "nicht verfuegbar" im localStorage.
 *
 * Zweiwertprobe: eine oertliche Beneos-Karte wird weiter gesammelt und
 * geprobt, damit Kunden ohne Streaming nichts verlieren.
 */
import { pruefstand, installiereFoundry, netz, nimmAbrufe } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, abschnitt, ende } = pruefstand("stream-umschalter, isAbsoluteRef und die Probe des Umschalters")

const { SETTING } = await import("./stream-settings.mjs")
installiereFoundry({ einstellungen: { [SETTING.key]: "", [SETTING.base]: "https://gate.beneos.stream", [SETTING.mode]: false } })

// localStorage wie im Browser, als Tabelle.
const ablage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (ablage.has(k) ? ablage.get(k) : null),
    setItem: (k, v) => { ablage.set(k, String(v)) },
    removeItem: (k) => { ablage.delete(k) },
  },
}

// Oertliche Pfade antworten 200, alles unter `beneos%3A` waere der 404 vom
// eigenen Server, den es nicht geben darf.
netz((url) => {
  const a = decodeURIComponent(String(url))
  if (a.startsWith("beneos_assets/")) return new Response(null, { status: a.includes("/fehlt/") ? 404 : 200 })
  if (a.startsWith("beneos:")) return new Response("", { status: 404 })
  return undefined
})

const { BeneosUtility } = await import("../beneos_utility.js")
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const OHNE = "beneos://a/0122_Sibriex/maps/sibriex_4k_bm.webm"
const OERTLICH = "beneos_assets/beneos_battlemaps/0122/sibriex_4k_bm.webm"

/** Eine Szene, wie der Umschalter sie liest: Hintergrund und Kacheln. */
function szene(id, hintergrund, kacheln = []) {
  return {
    id,
    background: { src: hintergrund },
    tiles: kacheln.map((src, i) => ({ id: `${id}k${i}`, texture: { src }, flags: {} })),
  }
}

function setzeSzenen(liste) {
  const m = new Map(liste.map((s) => [s.id, s]))
  game.scenes = { get: (id) => m.get(id), [Symbol.iterator]: () => m.values() }
}

abschnitt("isAbsoluteRef")
gleich("beneos:// gilt als absolut", BeneosUtility.isAbsoluteRef(OHNE), true)
gleich("BENEOS:// in Grossschreibung gilt als absolut", BeneosUtility.isAbsoluteRef(OHNE.replace("beneos", "BENEOS")), true)
gleich("Toradresse gilt weiter als absolut", BeneosUtility.isAbsoluteRef("https://gate.beneos.stream/a/k/x_4k_bm.webm"), true)
gleich("oertlicher Pfad bleibt oertlich", BeneosUtility.isAbsoluteRef(OERTLICH), false)
gleich("Pfad mit beneos im Namen bleibt oertlich", BeneosUtility.isAbsoluteRef("beneos_assets/maps/beneos://x_4k_bm.webm"), false)

abschnitt("collectStaticSwitchTargets")
gleich("schluesselfreier Hintergrund und Kachel: kein Ziel",
  BeneosUtility.collectStaticSwitchTargets(szene("s1", OHNE, [OHNE])).length, 0)
gleich("oertlicher Hintergrund und Kachel: zwei Ziele",
  BeneosUtility.collectStaticSwitchTargets(szene("s2", OERTLICH, [OERTLICH])).length, 2)
gleich("gemischt: nur die oertliche Kachel",
  BeneosUtility.collectStaticSwitchTargets(szene("s3", OHNE, [OERTLICH])).map((t) => t.kind).join(","), "tile")

abschnitt("Probe beim Aufwaermen")
nimmAbrufe()
setzeSzenen([szene("s1", OHNE, [OHNE])])
BeneosUtility._mapAssetProbe.clear()
BeneosUtility.warmStaticSwitchCache()
await warte(20)
gleich("schluesselfreie Szene: keine Abfrage", nimmAbrufe().length, 0)
gleich("schluesselfreie Szene: kein Probeneintrag", BeneosUtility._mapAssetProbe.size, 0)
setzeSzenen([szene("s2", OERTLICH)])
BeneosUtility.warmStaticSwitchCache()
await warte(20)
const abrufe = nimmAbrufe()
gleich("oertliche Szene: eine Abfrage", abrufe.length, 1)
gleich("oertliche Szene: auf das Standbild", decodeURIComponent(abrufe[0]?.adresse ?? ""), OERTLICH.replace(/\.webm$/, ".webp"))

abschnitt("localStorage")
BeneosUtility._mapAssetProbe.clear()
ablage.set(BeneosUtility._probeCacheKey(), JSON.stringify({
  version: BeneosUtility._probeCacheVersion(),
  savedAt: Date.now(),
  results: { [OHNE.replace(/\.webm$/, ".webp")]: false, [OERTLICH.replace(/\.webm$/, ".webp")]: true },
}))
gleich("Laden: nur der oertliche Eintrag", BeneosUtility.loadMapAssetProbeCache(), 1)
gleich("Laden: alter beneos://-Eintrag verworfen", BeneosUtility._mapAssetProbe.has(OHNE.replace(/\.webm$/, ".webp")), false)

/*
 * DER ASSET-WAECHTER (Auftrag AG-12:28:21). `scanSceneSilent` und der
 * Scenepacker lesen vorbereitete Felder. Bei Modus aus steht dort die
 * schluesselfreie Form, und jede echte `/a/`-Adresse traegt
 * `beneos_assets/beneos_battlemaps/` im Pfad (gemessen am 16.11.2026: v13
 * 2019 von 2021, v14 1186 von 1186). Ohne Riegel ging sie als HEAD
 * `beneos%3A//...` an den eigenen Server und kam als "fehlt" zurueck.
 */
abschnitt("Asset-Waechter")
const W = await import("../beneos-asset-watcher.js")
const KARTE = "beneos://a/beneos_bm_0011_cos_barovia_village/4k/beneos_assets/beneos_battlemaps/4k/11_cos_barovia_village/01/4k_bm.webp"
const FEHLT = "beneos_assets/beneos_battlemaps/fehlt/4k_bm.webp"
gleich("isBeneosPath: schluesselfreie Karte ist nicht seine Sache", W.isBeneosPath(KARTE), false)
gleich("isBeneosPath: oertlicher Beneos-Pfad bleibt seine Sache", W.isBeneosPath(FEHLT), true)
gleich("headCheck: schluesselfreie Karte wird nicht abgefragt", (await W.headCheck(KARTE)).status, -2)
nimmAbrufe()
const leer = await W.scanSceneSilent({ id: "w1", name: "w1", background: { src: KARTE }, tiles: [{ id: "k", texture: { src: KARTE } }] })
gleich("scanSceneSilent: schluesselfreie Szene meldet nichts als fehlend", leer.missing.length, 0)
gleich("scanSceneSilent: schluesselfreie Szene fragt nichts ab", nimmAbrufe().length, 0)
const zwei = await W.scanSceneSilent({ id: "w2", name: "w2", background: { src: KARTE }, tiles: [{ id: "k", texture: { src: FEHLT } }] })
gleich("scanSceneSilent: ein fehlender oertlicher Pfad wird weiter gemeldet", zwei.missing.join(","), FEHLT)

ende()
