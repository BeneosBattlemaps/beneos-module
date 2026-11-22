/**
 * stream-einbau.test.mjs
 *
 * Was der `init` von `beneos-stream.mjs` bei Modus AUS einbaut, wenn ein
 * Schluessel da ist. Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-einbau.test.mjs
 *
 * WARUM DIESER PRUEFSATZ, stre-T-102 (Betreiberentscheid 16.11.2026, "Weiter
 * laden"). Leinwand, Schreibnetz und Konsolenmaske haengen am Schluessel, nicht
 * am Modus. Gemessen vor diesem Stand in v13 und v14: bei Modus aus war nichts
 * davon eingebaut. Eine Neuzeichnung meldete je Kachel, Token und Notiz "Fetch
 * API cannot load beneos://", und Foundry schrieb jede Toradresse mit
 * Schluessel in die Konsole.
 *
 * Eingebaut wird unbedingt, geprueft wird im Behandler. Dann stimmt es auch
 * ohne Neuladen, wenn der Schluessel spaeter kommt oder der Modus per API
 * umgelegt wird. Ohne Schluessel tun die Behandler nichts; das belegt
 * `stream-leinwand.test.mjs`.
 *
 * Zweiwertprobe: der fetch-Ersatz bleibt am Modus und ist bei Modus aus NICHT
 * eingebaut, wie vor T-102.
 */
import { pruefstand, installiereFoundry, haken } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, ende } = pruefstand("stream-einbau, init bei Modus aus mit Schluessel")

const SCHLUESSEL = "pk_einbau_attrappe"
const GATE = "https://gate.beneos.stream"
const { SETTING } = await import("./stream-settings.mjs")
// Der letzte Abschnitt faehrt diesen Satz als Kindprozess mit Modus an.
const KIND_MODUS_AN = process.env.EINBAU_KIND === "an"
installiereFoundry({ einstellungen: { [SETTING.key]: SCHLUESSEL, [SETTING.base]: GATE, [SETTING.mode]: KIND_MODUS_AN } })
// Mit Modus an haengt der Einstieg Fensterhaken ein, die die Attrappe nicht stellt.
if (KIND_MODUS_AN) globalThis.addEventListener ??= () => {}

// Eine Dokumentklasse, wie `installStreamLeinwand` sie in CONFIG erwartet.
class Kachel {
  constructor(src) { this._source = { texture: { src } } }
  prepareBaseData() { this.texture = { src: this._source.texture.src } }
}
globalThis.CONFIG.Tile = { documentClass: Kachel }

// Die Konsole vor dem Einbau abfangen: die Maske wickelt, was sie vorfindet.
const gesehen = []
const urLog = console.log
console.log = (...a) => { gesehen.push(a.map(String).join(" ")) }

const urFetch = async () => new Response("")
globalThis.fetch = urFetch

globalThis.game.settings.registerMenu = () => {}
let ladefehler = ""
try {
  await import("./beneos-stream.mjs")
  /*
   * Je init-Haken einzeln: beim Laden kommen auch fremde Dateien des Moduls
   * mit (Asset-Waechter), deren init in der Attrappe scheitern darf. Gezaehlt
   * wird nur ein Fehler aus diesem Ordner.
   */
  for (const h of haken.liste.filter((x) => x.name === "init")) {
    try { await h.fn() } catch (e) {
      const s = String(e?.stack ?? e)
      if (s.includes("/scripts/stream/")) ladefehler = s.slice(0, 400)
    }
  }
} catch (e) { ladefehler = String(e?.stack ?? e).slice(0, 400) }

/** Ein Szenenaufbau beginnt, dann weist das Tor eine Datei ab: meldet die Meldestelle sofort? */
async function meldetImAufbau() {
  globalThis.game.user = { isGM: true }
  for (const h of haken.liste.filter((x) => x.name === "canvasInit")) {
    try { await h.fn() } catch (_) { /* gezaehlt wird die Wirkung */ }
  }
  const { meldeAusfall } = await import("./stream-hinweis.mjs")
  return meldeAusfall("denied", `${GATE}/a/${SCHLUESSEL}/beneos_bm_0113/4k/karte.webp`)
}

if (KIND_MODUS_AN) {
  const sofort = await meldetImAufbau()
  process.stdout.write(`\nKIND-ERGEBNIS ${JSON.stringify({ ladefehler, sofort })}\n`)
  process.exit(0)
}

gesehen.length = 0
console.log(`Loaded ${GATE}/a/${SCHLUESSEL}/beneos_bm_0113/4k/karte.webp`)
const zeile = gesehen.join("\n")
console.log = urLog

gleich("init laeuft in der Attrappe durch", ladefehler, "")
gleich("Modus aus mit Schluessel: die Konsole ist maskiert", zeile.includes(SCHLUESSEL), false)
gleich("Modus aus mit Schluessel: die Konsolenzeile bleibt erhalten", zeile.startsWith(`Loaded ${GATE}/a/`), true)
gleich("Modus aus mit Schluessel: prepareBaseData ist gewickelt",
  Object.hasOwn(Kachel.prototype, Symbol.for("beneos.stream.leinwand")), true)
gleich("Modus aus mit Schluessel: das Schreibnetz haengt", haken.namen().includes("preUpdateTile"), true)
/*
 * DIE WIRKUNG, NICHT DER HAKENNAME (stre-T-119). Bis dahin stand hier
 * `haken.namen().includes("updateSetting")`. Seit `installStreamKlang` haengt
 * ein zweiter Behandler an demselben Namen, und die Probe blieb gruen, auch
 * wenn die Leinwand gar nicht eingebaut war (Sabotage S652). Gefragt wird
 * jetzt, ob ein Szenendokument nach dem Wechsel des Schluessels per `reset()`
 * neu vorbereitet wird; das tut nur der Behandler der Leinwand.
 */
{
  const { MODULE_ID } = await import("./stream-settings.mjs")
  let neuVorbereitet = 0
  const szene = { reset() { neuVorbereitet++ } }
  const vorher = globalThis.game.scenes
  globalThis.game.scenes = [szene]
  for (const h of haken.liste.filter((x) => x.name === "updateSetting")) {
    try { await h.fn({ key: `${MODULE_ID}.${SETTING.key}` }) } catch (_) { /* gezaehlt wird die Wirkung */ }
  }
  globalThis.game.scenes = vorher
  gleich("Modus aus mit Schluessel: das Neuvorbereiten haengt", neuVorbereitet > 0, true)
}

/*
 * DER KLANGNEUBAU HAENGT WIE DIE LEINWAND AM SCHLUESSEL (stre-T-119,
 * Kalt-Review 17.11.2026, Befund 1). Gemessen wird die Wirkung: ein
 * gescheiterter Klang mit schluesselfreier Quelle bekommt nach dem Wechsel
 * ein neues Objekt. Eine Textprobe ueber die Reihenfolge im Quelltext sieht
 * nicht, ob der Aufruf in den Modusblock gerutscht ist.
 */
{
  const { MODULE_ID } = await import("./stream-settings.mjs")
  const alt = { failed: true, playing: false, _state: -1, src: "alt" }
  const klang = {
    _source: { path: "beneos://a/beneos_bm_0113/4k/musik.ogg" },
    path: "alt",
    sound: alt,
    reset() { this.path = `${GATE}/a/${SCHLUESSEL}/beneos_bm_0113/4k/musik.ogg` },
    _createSound() { return { src: this.path, playing: false, _state: 0 } },
    sync() {},
  }
  const vorher = globalThis.game.playlists
  globalThis.game.playlists = [{ sounds: [klang] }]
  for (const h of haken.liste.filter((x) => x.name === "updateSetting")) {
    try { await h.fn({ key: `${MODULE_ID}.${SETTING.key}` }) } catch (_) { /* gezaehlt wird die Wirkung */ }
  }
  globalThis.game.playlists = vorher
  gleich("Modus aus mit Schluessel: ein gescheiterter Klang wird neu aufgebaut", klang.sound !== alt, true)
}

/*
 * DERSELBE HAKEN BAUT DEN SZENENKLANG NEU (stre-T-123). Gemessen wird wieder
 * die Wirkung am Placeable der angezeigten Szene, nicht ein Hakenname.
 */
{
  const { MODULE_ID } = await import("./stream-settings.mjs")
  const alt = { failed: true, playing: false, loaded: false, _state: -1, src: "alt", _manager: null }
  const pfad = "beneos://a/beneos_bm_0006/4k/amb/regen.ogg"
  const szenenklang = {
    id: "e1",
    destroyed: false,
    sound: alt,
    document: {
      _source: { path: pfad },
      path: "alt",
      reset() { this.path = `${GATE}/a/${SCHLUESSEL}/beneos_bm_0006/4k/amb/regen.ogg` },
    },
    _createSound() { return { src: this.document.path, playing: false, _state: 0 } },
  }
  const vorher = globalThis.canvas
  globalThis.canvas = { sounds: { placeables: [szenenklang], refresh() {} } }
  for (const h of haken.liste.filter((x) => x.name === "updateSetting")) {
    try { await h.fn({ key: `${MODULE_ID}.${SETTING.key}` }) } catch (_) { /* gezaehlt wird die Wirkung */ }
  }
  globalThis.canvas = vorher
  gleich("Modus aus mit Schluessel: ein gescheiterter Szenenklang wird neu aufgebaut", szenenklang.sound !== alt, true)
}

const k = new Kachel("beneos://a/beneos_bm_0113/4k/karte.webp")
k.prepareBaseData()
gleich("Modus aus mit Schluessel: vorbereitet steht die Toradresse",
  k.texture.src, `${GATE}/a/${SCHLUESSEL}/beneos_bm_0113/4k/karte.webp`)
gleich("Modus aus mit Schluessel: _source bleibt schluesselfrei",
  k._source.texture.src, "beneos://a/beneos_bm_0113/4k/karte.webp")

/*
 * stre-T-116: HTML-Netz, Bildertausch und Altseiten-Lauf haengen am
 * Schluessel. Gemessen wird je die Wirkung, nicht der Hakenname.
 */
const { PLATZHALTER_BILD } = await import("./stream-html.mjs")
const TOR_HTML = `<img src="${GATE}/a/${SCHLUESSEL}/beneos_bm_0113/4k/handout.webp">`
const FREI_HTML = "beneos://a/beneos_bm_0113/4k/handout.webp"
{
  const aenderung = { "text.content": TOR_HTML }
  for (const h of haken.liste.filter((x) => x.name === "preUpdateJournalEntryPage")) {
    try { await h.fn({ type: "text" }, aenderung) } catch (_) { /* gezaehlt wird die Wirkung */ }
  }
  gleich("Modus aus mit Schluessel: das HTML-Netz macht Form (a)",
    aenderung["text.content"].includes(`data-beneos-src="${FREI_HTML}"`) && !aenderung["text.content"].includes(SCHLUESSEL), true)
}
{
  // Der Abruf scheitert in der Attrappe (leere Antwort); der Tausch setzt dann
  // die Toradresse in die Anzeige. Beides heisst: er ist eingebaut und lief.
  const attr = new Map([["src", PLATZHALTER_BILD], ["data-beneos-src", FREI_HTML]])
  const bild = {
    nodeType: 1, isConnected: true, closest: () => null,
    getAttribute: (k) => attr.get(k) ?? null, setAttribute: (k, v) => { attr.set(k, String(v)) }, hasAttribute: (k) => attr.has(k),
  }
  const wurzel = { nodeType: 1, querySelectorAll: (s) => (s === "img" ? [bild] : []), querySelector: () => null }
  for (const h of haken.liste.filter((x) => x.name === "renderJournalEntrySheet")) {
    try { await h.fn({ rendered: true, element: wurzel }, wurzel) } catch (_) { /* gezaehlt wird die Wirkung */ }
  }
  for (let i = 0; i < 20 && attr.get("src") === PLATZHALTER_BILD; i++) await new Promise((r) => setTimeout(r, 5))
  gleich("Modus aus mit Schluessel: ein Bild in Form (a) wird angefasst", attr.get("src") !== PLATZHALTER_BILD, true)
}
{
  const geschrieben = []
  const quelle = { name: "J", pages: [{ _id: "p1", type: "text", text: { content: TOR_HTML } }] }
  const journal = {
    constructor: { metadata: { embedded: { JournalEntryPage: "pages" } } },
    pages: [],
    toObject: () => JSON.parse(JSON.stringify(quelle)),
    async update(d) { geschrieben.push(d) },
    // Die Quelle bleibt bewusst stehen: so faende ein zweiter Lauf wieder etwas,
    // und nur der Einmal-Riegel haelt ihn auf.
    async updateEmbeddedDocuments(_k, teile) { geschrieben.push(...teile) },
  }
  const vorher = { journal: globalThis.game.journal, user: globalThis.game.user }
  globalThis.game.journal = [journal]
  globalThis.game.user = { isGM: true }
  const leise = console.log
  // Die Laeufe schreiben je eine Abschlusszeile; ihre Folge ist die Folge der Laeufe.
  const laufzeilen = []
  console.log = (...a) => {
    const t = a.map(String).join(" ")
    if (/^Beneos Stream \| (Altseiten|Fremde Flags|Eigene Flags)/.test(t)) laufzeilen.push(t)
  }
  for (let mal = 0; mal < 2; mal++) {
    // Seit stre-T-113 ruft der Haken `weltstartStream()` und wartet nicht
    // darauf; die Probe wartet deshalb selbst, bevor sie die Wirkung zaehlt.
    for (const h of haken.liste.filter((x) => x.name === "ready" && String(x.fn).includes("weltstartStream"))) {
      try { await h.fn() } catch (_) { /* gezaehlt wird die Wirkung */ }
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  // Auflage 2 (orch P-13:25): der Trockenlauf ist ueber `game.beneos.stream`
  // erreichbar, zaehlt und schreibt nichts. Die Quelle traegt hier noch die
  // Toradresse, also findet er genau ein Dokument.
  const vorTrocken = geschrieben.length
  let trocken = null
  try { trocken = await globalThis.game.beneos?.stream?.altseitenUmstellen?.({ trocken: true }) } catch (_) { /* gezaehlt wird die Wirkung */ }
  console.log = leise
  gleich("Modus aus mit Schluessel: Trockenlauf ueber game.beneos.stream zaehlt und schreibt nichts",
    `${trocken?.dokumente}|${trocken?.trocken}|${geschrieben.length - vorTrocken}`, "1|true|0")
  globalThis.game.journal = vorher.journal
  globalThis.game.user = vorher.user
  gleich("Modus aus mit Schluessel: ready stellt Altseiten auf Form (a) um, einmal",
    `${geschrieben.length}|${!JSON.stringify(geschrieben).includes(SCHLUESSEL)}`, "1|true")
  /*
   * DIE FESTE FOLGE DER SCHLUESSELLAEUFE (stre-T-128, stre-T-122 E). Bis
   * stre-T-208 lasen die Saetze fremdflaggen und flaggen sie am Rumpf von
   * `schluesselLaeufe`; hier zaehlt die Folge der Abschlusszeilen des echten
   * Weltstarts. Der Trockenlauf oben schreibt eine weitere Altseiten-Zeile;
   * gezaehlt werden deshalb nur die Zeilen ohne "(trocken)".
   */
  const folge = laufzeilen.filter((z) => !z.includes("(trocken)")).map((z) => z.replace("Beneos Stream | ", "").split(":")[0])
  gleich("ready: die Schluessellaeufe laufen je einmal, Altseiten, fremde Flags, eigene Flags",
    folge.join(" > "), "Altseiten > Fremde Flags > Eigene Flags")
}

/*
 * DAS FENSTER RUFT `BeneosStream.listReleases` UND LIEST `e.status`
 * (Kalt-Review 17.11.2026). Eine Huelle im api-Objekt, die neu wirft, verloere
 * den Status still, und das Fenster zeigte bei 403 den falschen Text. Bis
 * stre-T-208 stand das in stream-rueckfall.test.mjs als Strukturprobe am
 * Quelltext des Einstiegs; hier faehrt es das echte api-Objekt nach `ready`.
 * Zwei Werte, damit ein fester Status nicht zufaellig passt.
 */
{
  const api = globalThis.game.beneos?.stream
  const alt = globalThis.fetch
  const abruf = async (status) => {
    globalThis.fetch = async () => new Response("{}", { status, headers: { "content-type": "application/json" } })
    try { await api?.listReleases?.(); return "kein Fehler" } catch (e) { return `${e?.status}` } finally { globalThis.fetch = alt }
  }
  gleich("api.listReleases: ein 403 kommt mit Status 403 beim Fenster an", await abruf(403), "403")
  gleich("api.listReleases: ein 502 kommt mit Status 502 beim Fenster an", await abruf(502), "502")
}

// Zweiwertprobe: der fetch-Ersatz haengt weiter am Modus.
gleich("Modus aus: der fetch-Ersatz ist NICHT eingebaut", globalThis.fetch, urFetch)

/*
 * DER EINSTIEG BAUT DIE MELDESTELLE EIN, ABER NUR MIT MODUS AN (stre-T-208,
 * vorher eine Textprobe in stream-hinweis). Eingebaut haelt die Meldestelle
 * waehrend eines Szenenaufbaus die Meldung "nicht im Zugang" zurueck, bis die
 * Videos nachgeladen sind; ohne Einbau meldet sie sofort. Modus an laeuft als
 * Kindprozess, weil der Einstieg je Prozess einmal laedt. Steht zuletzt, denn
 * die Meldung bleibt danach in dieser Sitzung gemeldet.
 */
{
  const { execFileSync } = await import("node:child_process")
  const { fileURLToPath } = await import("node:url")
  let kind = null
  try {
    const aus = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
      encoding: "utf8", env: { ...process.env, EINBAU_KIND: "an" }, stdio: ["ignore", "pipe", "pipe"],
    })
    const z = aus.split("\n").find((x) => x.startsWith("KIND-ERGEBNIS "))
    kind = z ? JSON.parse(z.slice("KIND-ERGEBNIS ".length)) : null
  } catch (e) { kind = { wurf: String(e?.message || e).slice(0, 120) } }
  gleich("Modus an: init laeuft in der Attrappe durch", kind?.ladefehler, "")
  gleich("Modus an: die Meldestelle ist eingebaut und haelt die Meldung im Szenenaufbau zurueck", kind?.sofort, false)
  gleich("Gegenwert Modus aus: ohne Einbau meldet sie im Szenenaufbau sofort", await meldetImAufbau(), true)
}

ende()
