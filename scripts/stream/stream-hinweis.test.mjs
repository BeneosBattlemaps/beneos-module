/**
 * stream-hinweis.test.mjs
 *
 * Gegenprobe zur Meldestelle `stream-hinweis.mjs`, stre-T-165 und stre-T-166.
 * Laeuft ohne Foundry und ohne Browser:
 *
 *   node scripts/stream/stream-hinweis.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 mindestens einer rot, 2 nicht
 * pruefbar.
 *
 * WAS FESTGEHALTEN WIRD. Fehlt ein Inhalt, weil die Verbindung fehlt oder der
 * Zugang ihn nicht enthaelt, sagt das Modul es in Worten, und zwar je Sitzung
 * und Grund genau einmal. Betreiberentscheid ueber orch-stre-1 (R1 zu T-165):
 *
 * - E1: der Link des Kartenschilds fuehrt auf die Bibliotheksseite des Shops,
 *   als Konstante an einer Stelle und nicht in einem Sprachwert.
 * - E2: das Schild sehen alle Clients, die Meldung "nicht im Zugang" nur die
 *   Spielleitung, die Meldung "offline" jeder Client.
 * - E3: der Video-Hinweis aus OP-PRJ-186 bleibt; kam er in der Sitzung schon,
 *   entfaellt die allgemeine Meldung "nicht im Zugang".
 *
 * DIE ZWEI WERTE, DIE ALLES TRAGEN: eine zweite Abweisung derselben Sitzung
 * meldet nichts mehr, eine Abweisung aus einem ANDEREN Grund meldet wieder.
 *
 * Jede Meldestelle haelt ihren Zustand je Sitzung im Modul. Damit ein Fall den
 * naechsten nicht anfaerbt, holt `frisch()` das Modul mit neuer Abfrage neu.
 *
 * Kein Schluessel in einer Ausgabe: die Attrappenadressen tragen einen
 * Pruefsatzschluessel, und ROT druckt nur Wahrheitswerte und Zahlen.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { extractMethod } from "../../tools/lib/extract-method.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, "..", "..")

/* ------------------------------------------------------- die Buehne stellen */

const TOR = "https://gate.beneos.stream"
const SCHLUESSEL = "pk_pruefsatz_hinweis"
const einstellungen = new Map()

let warnungen = []
let istGM = true
let uebersetzt = true
globalThis.game = {
  settings: {
    get(modul, name) {
      const k = `${modul}.${name}`
      if (!einstellungen.has(k)) throw new Error(`nicht registriert: ${k}`)
      return einstellungen.get(k)
    },
  },
  i18n: { localize: (s) => uebersetzt ? `T:${s}` : s, format: (s) => uebersetzt ? `T:${s}` : s },
  get user() { return { isGM: istGM } },
}
globalThis.ui = { notifications: { warn: (t) => warnungen.push(String(t)) } }
const haken = []
globalThis.Hooks = { on: (name, fn) => haken.push([name, fn]), callAll() {} }
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true })

/* Ein DOM, so klein wie moeglich: Elemente mit Kindern, `remove`, und
 * `getElementById` ueber den ganzen Baum. */
function element(tag) {
  const el = {
    tagName: tag.toUpperCase(), id: "", className: "", textContent: "", children: [], parent: null,
    attribute: {},
    setAttribute(k, v) { this.attribute[k] = String(v) },
    append(...kinder) { for (const k of kinder) { k.parent = this; this.children.push(k) } },
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((k) => k !== this); this.parent = null } },
  }
  return el
}
function suche(el, id) {
  if (el.id === id) return el
  for (const k of el.children) { const t = suche(k, id); if (t) return t }
  return null
}
const body = element("body")
const uiTop = element("div"); uiTop.id = "ui-top"; body.append(uiTop)
globalThis.document = {
  body,
  createElement: (tag) => element(tag),
  getElementById: (id) => suche(body, id),
}

const { MODULE_ID, SETTING } = await import("./stream-settings.mjs")
einstellungen.set(`${MODULE_ID}.${SETTING.mode}`, true)
einstellungen.set(`${MODULE_ID}.${SETTING.key}`, SCHLUESSEL)
einstellungen.set(`${MODULE_ID}.${SETTING.base}`, TOR)
const online = await import("./stream-online.mjs")

const KARTE = `${TOR}/a/${SCHLUESSEL}/beneos_battlemaps_0042/var1/karte.webp`
const KACHEL = `${TOR}/a/${SCHLUESSEL}/beneos_battlemaps_0042/var1/overlay.webm`
const FREMD = `${TOR}/a/${SCHLUESSEL}/beneos_battlemaps_0099/var1/andere.webp`
const TOKEN = `${TOR}/c/${SCHLUESSEL}/000-barovian_direwolf/1-top.webp`
const szene = {
  name: "Pruefszene",
  _source: { background: { src: KARTE } },
  tiles: [{ texture: { src: KACHEL } }],
  notes: [],
}

let lauf = 0
async function frisch() {
  lauf += 1
  warnungen = []
  istGM = true
  haken.length = 0
  for (const k of [...uiTop.children]) k.remove()
  globalThis.canvas = { scene: null }
  return import(`./stream-hinweis.mjs?lauf=${lauf}`)
}

/* ------------------------------------------------------------ die Werkzeuge */

let rot = 0
let gruen = 0
// Ein Element der Attrappe ist zirkulaer (`parent`); die Ausgabe darf daran
// nicht abstuerzen, sonst endet der Satz ohne rote Probe.
const zeige = (w) => { try { return JSON.stringify(w) } catch (_) { return `<${w?.tagName ?? typeof w}>` } }
function gleich(name, ist, soll) {
  const ok = ist === soll
  if (ok) { gruen++; console.log(`  ok   ${name}`) }
  else { rot++; console.log(`  ROT  ${name}\n       soll ${zeige(soll)}\n       ist  ${zeige(ist)}`) }
}
const schild = () => document.getElementById("beneos-stream-kartenschild")
const linkeVon = (el) => el?.children.filter((k) => k.tagName === "A") ?? []
const linkMit = (el, text) => linkeVon(el).find((a) => a.textContent === text) ?? null
// Der echte Kern aus dem Bestand, als Quelltext geschnitten: das Modul selbst
// laesst sich in node nicht laden (es braucht FormApplication).
const kern = new Function(`${extractMethod(readFileSync(join(WURZEL, "scripts/cloud-v2/beneos-install-state.mjs"), "utf8"), "releaseKern", { maxZeilen: 10 }).replace(/^export\s+/, "")}; return releaseKern`)()
/** Die Releaseliste der Cloud, wie BeneosScenePacker sie liefert. `null` scheitert. */
function kaufQuelle(liste) {
  const mgr = {
    aufrufe: 0,
    async listReleases() { mgr.aufrufe += 1; if (liste === null) throw new Error("list_releases scheitert"); return liste },
  }
  globalThis.BeneosScenePacker = mgr
  return mgr
}

/* ------------------------------------------- Teil 1: je Sitzung und Grund einmal */

console.log("\nJe Sitzung und Grund eine Meldung")
{
  const h = await frisch()
  h.meldeAusfall("denied", TOKEN)
  gleich("erste Abweisung: eine Meldung", warnungen.length, 1)
  gleich("die Meldung kommt aus dem Schluessel fuer den Zugang", warnungen[0], "T:BENEOS.Stream.Notice.Denied")
  h.meldeAusfall("denied", KARTE)
  gleich("zweite Abweisung derselben Sitzung: keine weitere", warnungen.length, 1)
  h.meldeAusfall("offline", TOKEN)
  gleich("danach offline: wieder eine Meldung", warnungen.length, 2)
  gleich("die zweite kommt aus dem Schluessel fuer offline", warnungen[1], "T:BENEOS.Stream.Notice.Offline")
  h.meldeAusfall("offline", KARTE)
  gleich("zweimal offline: keine weitere", warnungen.length, 2)
}
{
  // Frisch, damit kein schon gemeldeter Grund eine falsche Zuordnung verdeckt.
  const h = await frisch()
  canvas.scene = szene
  h.meldeAusfall("irgendwas", KARTE)
  gleich("ein unbekannter Grund meldet nichts", warnungen.length, 0)
  gleich("ein unbekannter Grund stellt kein Schild auf", schild() === null, true)
}
{
  // Ohne Uebersetzung (Schluessel kommt unveraendert zurueck): englischer Rueckfall.
  const h = await frisch()
  uebersetzt = false
  h.meldeAusfall("offline", TOKEN)
  gleich("ohne Uebersetzung: der englische Rueckfall, nicht der Schluessel", /^Beneos Stream: there is no connection/.test(warnungen[0] ?? ""), true)
  gleich("ohne Uebersetzung: Platzhalter werden gefuellt", h.hinweisText("X.Y", { name: "Pruefszene" }, "scene {name} refused"), "scene Pruefszene refused")
  uebersetzt = true
}

/* ----------------------------------------------- Teil 2: wer was sieht (E2) */

console.log("\nWer was sieht")
{
  const h = await frisch()
  istGM = false
  h.meldeAusfall("denied", TOKEN)
  gleich("Mitspieler: keine Meldung fuer den Zugang", warnungen.length, 0)
  h.meldeAusfall("offline", TOKEN)
  gleich("Mitspieler: die Meldung fuer offline", warnungen.length, 1)
  gleich("Mitspieler: und zwar die fuer offline", warnungen[0], "T:BENEOS.Stream.Notice.Offline")
}
{
  const h = await frisch()
  h.meldeAusfall("offline", TOKEN)
  gleich("Spielleitung: offline meldet auch dort", warnungen.length, 1)
}

/* ----------------------------------------------- Teil 3: Video-Hinweis (E3) */

console.log("\nDer Video-Hinweis geht vor")
{
  const h = await frisch()
  h.merkeVideoToast()
  h.meldeAusfall("denied", KACHEL)
  gleich("Video-Hinweis schon gezeigt: keine allgemeine Meldung", warnungen.length, 0)
  h.meldeAusfall("offline", KACHEL)
  gleich("offline bleibt davon unberuehrt", warnungen.length, 1)
}
{
  const h = await frisch()
  h.meldeAusfall("denied", KACHEL)
  gleich("ohne Video-Hinweis: die allgemeine Meldung kommt", warnungen.length, 1)
}
{
  // Gemessen im Foundry-Test auf 30003 (20.11.2026): beim Szenenaufbau meldete
  // ein Bild der Szene vor dem Video, und der GM bekam beide Meldungen. Waehrend
  // des Aufbaus wartet die allgemeine Meldung deshalb. Zweite Messung am selben
  // Tag, Kaltstart: die Videos laedt fillInVideos erst NACH canvasReady, der
  // Video-Hinweis kam 745 ms danach. Das Warten endet also erst, wenn das
  // Nachladen der Videos durch ist (aufbauEnde).
  const h = await frisch()
  h.installStreamHinweis()
  const fahre = (name) => { for (const [n, fn] of haken) if (n === name) fn() }
  canvas.scene = szene
  fahre("canvasInit")
  h.meldeAusfall("denied", KARTE)
  gleich("waehrend des Szenenaufbaus: die allgemeine Meldung wartet", warnungen.length, 0)
  fahre("canvasReady")
  const fertig = h.aufbauEnde()
  gleich("canvasReady allein beendet das Warten nicht", warnungen.length, 0)
  h.merkeVideoToast()
  fertig()
  gleich("Video kam nach canvasReady: keine allgemeine Meldung", warnungen.length, 0)
  h.meldeAusfall("denied", TOKEN)
  gleich("und auch spaeter keine", warnungen.length, 0)
}
{
  const h = await frisch()
  h.installStreamHinweis()
  const fahre = (name) => { for (const [n, fn] of haken) if (n === name) fn() }
  canvas.scene = szene
  fahre("canvasInit")
  h.meldeAusfall("denied", KARTE)
  h.meldeAusfall("denied", KACHEL)
  fahre("canvasReady")
  h.aufbauEnde()()
  gleich("Aufbau ohne Video-Hinweis: die Meldung kommt, wenn die Videos durch sind", warnungen.length, 1)
  gleich("und zwar die fuer den Zugang", warnungen[0], "T:BENEOS.Stream.Notice.Denied")
  fahre("canvasInit")
  h.meldeAusfall("denied", KARTE)
  fahre("canvasReady")
  h.aufbauEnde()()
  gleich("der naechste Aufbau meldet nicht noch einmal", warnungen.length, 1)
}
{
  // Ein Nachladen, das zu einem abgeloesten Aufbau gehoert, beendet das Warten
  // des neuen Aufbaus nicht.
  const h = await frisch()
  h.installStreamHinweis()
  const fahre = (name) => { for (const [n, fn] of haken) if (n === name) fn() }
  canvas.scene = szene
  fahre("canvasInit")
  fahre("canvasReady")
  const alt = h.aufbauEnde()
  fahre("canvasInit")
  h.meldeAusfall("denied", KARTE)
  alt()
  gleich("das Ende eines alten Aufbaus beendet das neue Warten nicht", warnungen.length, 0)
  fahre("canvasReady")
  h.aufbauEnde()()
  gleich("das Ende des eigenen Aufbaus meldet", warnungen.length, 1)
}
{
  // Offline wartet nicht: die Verbindung ist sofort zu melden.
  const h = await frisch()
  h.installStreamHinweis()
  const fahre = (name) => { for (const [n, fn] of haken) if (n === name) fn() }
  fahre("canvasInit")
  h.meldeAusfall("offline", KARTE)
  gleich("offline meldet auch waehrend des Aufbaus sofort", warnungen.length, 1)
}
{
  // Kommt canvasReady nie (Aufbau scheitert), geht die Meldung nicht verloren.
  const h = await frisch()
  h.installStreamHinweis()
  const fahre = (name) => { for (const [n, fn] of haken) if (n === name) fn() }
  fahre("canvasInit")
  h.meldeAusfall("denied", KARTE)
  h.meldeWartendes()
  gleich("der Rueckfall-Zeitgeber meldet die wartende Meldung", warnungen.length, 1)
  h.meldeWartendes()
  gleich("und nur einmal", warnungen.length, 1)
}

/* --------------------------------------------- Teil 4: das Kartenschild */

console.log("\nDas Kartenschild")
{
  const h = await frisch()
  delete globalThis.BeneosScenePacker
  await h.ladeKaufIndex({ kern })
  canvas.scene = szene
  h.meldeAusfall("denied", FREMD)
  gleich("fremde Adresse: kein Schild", schild() === null, true)
  h.meldeAusfall("denied", `${KARTE}?v=2`)
  const s = schild()
  gleich("Adresse der Szene, mit Abfrage: Schild da", s !== null, true)
  gleich("das Schild sitzt oben im Bedienfeld", s?.parent === uiTop, true)
  gleich("das Schild nennt den Grund aus dem Schluessel", s?.children[0]?.textContent, "T:BENEOS.Stream.Notice.MapDenied")
  gleich("online: Subscribe fuehrt auf das Patreon der Karten", linkMit(s, "T:BENEOS.Stream.Notice.MapSubscribe")?.href, "https://www.patreon.com/c/BeneosBattlemaps")
  gleich("der Link oeffnet ein neues Fenster", linkMit(s, "T:BENEOS.Stream.Notice.MapSubscribe")?.target, "_blank")
  h.meldeAusfall("denied", KACHEL)
  gleich("eine zweite Abweisung der Szene: weiter EIN Schild", uiTop.children.length, 1)
  gleich("das Patreon der Karten ist eine Konstante", h.PATREON_KARTEN, "https://www.patreon.com/c/BeneosBattlemaps")
  gleich("das Patreon der Kreaturen ist eine Konstante", h.PATREON_TOKEN, "https://www.patreon.com/c/BeneosTokens")
  await h.ladeKaufIndex({ kern })
  gleich("ohne Kaufquelle: kein Buy, nur Subscribe", linkeVon(schild()).length, 1)
}
{
  // Zwei-Werte-Probe der Patreon-Wahl: /c/ (Kreaturen) gegen /a/ (Karten).
  const h = await frisch()
  canvas.scene = { name: "Tokenszene", _source: { background: { src: TOKEN } }, tiles: [], notes: [] }
  h.meldeAusfall("denied", TOKEN)
  gleich("Kreaturenadresse: Subscribe fuehrt auf das Patreon der Kreaturen", linkMit(schild(), "T:BENEOS.Stream.Notice.MapSubscribe")?.href, "https://www.patreon.com/c/BeneosTokens")
}

/* ------------------------------------- Teil 4b: Buy aus list_releases (Weg A) */

console.log("\nDer Kauflink")
{
  const h = await frisch()
  const mgr = kaufQuelle([{ release_dir: "beneos_battlemaps_0042", shop_url: "https://shop.example/products/k42", shop_url_kind: "pack" }])
  await h.ladeKaufIndex({ kern })
  canvas.scene = szene
  h.meldeAusfall("denied", KARTE)
  await h.ladeKaufIndex()
  const buy = linkMit(schild(), "T:BENEOS.Cloud.Card.BuyPack")
  gleich("Release mit Shopprodukt: Buy fuehrt auf shop_url", buy?.href, "https://shop.example/products/k42")
  gleich("Buy oeffnet ein neues Fenster", buy?.target, "_blank")
  gleich("Buy steht vor Subscribe", linkeVon(schild())[0]?.textContent, "T:BENEOS.Cloud.Card.BuyPack")
  h.meldeAusfall("denied", KACHEL)
  canvas.scene = szene
  h.pruefeSchild()
  await h.ladeKaufIndex({ kern })
  gleich("die Liste wird je Sitzung nur einmal geholt", mgr.aufrufe, 1)
  gleich("nach dem Neuaufbau steht Buy wieder da", linkMit(schild(), "T:BENEOS.Cloud.Card.BuyPack") !== null, true)
}
{
  const h = await frisch()
  kaufQuelle([{ release_dir: "beneos_battlemaps_0042", shop_url: "https://shop.example/products/bundle", shop_url_kind: "bundle" }])
  await h.ladeKaufIndex({ kern })
  canvas.scene = szene
  h.meldeAusfall("denied", KARTE)
  await h.ladeKaufIndex()
  gleich("shop_url_kind bundle: dieselbe Beschriftung wie der Kaufknopf", linkMit(schild(), "T:BENEOS.Cloud.Card.BuyBundle")?.href, "https://shop.example/products/bundle")
}
{
  const h = await frisch()
  kaufQuelle([{ release_dir: "beneos_battlemaps_0042", shop_url: null }])
  await h.ladeKaufIndex({ kern })
  canvas.scene = szene
  h.meldeAusfall("denied", KARTE)
  await h.ladeKaufIndex()
  gleich("ohne shop_url: kein Buy, nie ein toter Link", linkeVon(schild()).length, 1)
}
{
  // Ueber den Kern: die Liste nennt die Kurzform, die Streamadresse die Langform.
  const h = await frisch()
  kaufQuelle([{ release_dir: "battlemaps_0042", shop_url: "https://shop.example/products/kurz", shop_url_kind: "pack" }])
  await h.ladeKaufIndex({ kern })
  canvas.scene = szene
  h.meldeAusfall("denied", KARTE)
  await h.ladeKaufIndex()
  gleich("eindeutiger Kern: Buy kommt", linkMit(schild(), "T:BENEOS.Cloud.Card.BuyPack")?.href, "https://shop.example/products/kurz")
}
{
  const h = await frisch()
  kaufQuelle([
    { release_dir: "battlemaps_0042_a", shop_url: "https://shop.example/products/a", shop_url_kind: "pack" },
    { release_dir: "battlemaps_0042_b", shop_url: "https://shop.example/products/b", shop_url_kind: "pack" },
  ])
  await h.ladeKaufIndex({ kern })
  canvas.scene = szene
  h.meldeAusfall("denied", KARTE)
  await h.ladeKaufIndex()
  gleich("mehrdeutiger Kern: kein Buy", linkeVon(schild()).length, 1)
}
{
  const h = await frisch()
  const mgr = kaufQuelle(null)
  await h.ladeKaufIndex({ kern })
  canvas.scene = szene
  h.meldeAusfall("denied", KARTE)
  await h.ladeKaufIndex()
  gleich("Abruf scheitert: kein Buy, Subscribe bleibt", linkeVon(schild()).length, 1)
  await h.ladeKaufIndex({ kern })
  gleich("und keine Wiederholung", mgr.aufrufe, 1)
}
delete globalThis.BeneosScenePacker
{
  // Mitspieler: keine Meldung, aber das Schild (E2).
  const h = await frisch()
  istGM = false
  canvas.scene = szene
  h.meldeAusfall("denied", KACHEL)
  gleich("Mitspieler: das Schild erscheint trotzdem", schild() !== null, true)
  gleich("Mitspieler: und keine Meldung", warnungen.length, 0)
}
{
  // Abbau und Wiederkehr ueber die Haken.
  const h = await frisch()
  h.installStreamHinweis()
  const fahre = (name) => { for (const [n, fn] of haken) if (n === name) fn() }
  gleich("der Abbau haengt an canvasTearDown", haken.some(([n]) => n === "canvasTearDown"), true)
  canvas.scene = szene
  h.meldeAusfall("denied", KARTE)
  fahre("canvasTearDown")
  gleich("canvasTearDown entfernt das Schild", schild() === null, true)
  canvas.scene = { name: "andere", _source: { background: { src: FREMD } }, tiles: [], notes: [] }
  fahre("canvasReady")
  gleich("eine andere Szene: kein Schild", schild() === null, true)
  fahre("canvasTearDown")
  canvas.scene = szene
  fahre("canvasReady")
  gleich("zurueck zur abgewiesenen Szene: Schild wieder da", schild() !== null, true)
  h.installStreamHinweis()
  gleich("ein zweiter Einbau setzt die Haken nicht doppelt", haken.filter(([n]) => n === "canvasReady").length, 1)
}
{
  // Kalt-Review a9acf9e: kam die Abweisung, waehrend canvas.scene noch die
  // alte Szene war, blieb das Schild auf der neuen, sauberen Szene stehen.
  const h = await frisch()
  h.installStreamHinweis()
  const fahre = (name) => { for (const [n, fn] of haken) if (n === name) fn() }
  canvas.scene = szene
  h.meldeAusfall("denied", KARTE)
  canvas.scene = { name: "sauber", _source: { background: { src: FREMD } }, tiles: [], notes: [] }
  fahre("canvasReady")
  gleich("canvasReady einer sauberen Szene baut ein stehendes Schild ab", schild() === null, true)
}
{
  // Offline und denied streng getrennt (Betreiber-Nachtrag zu T-165). Der
  // Browser meldet sich ohne Netz, das ist der kuerzeste Weg in den Zustand
  // `offline` (wie in stream-sperre.test.mjs).
  const h = await frisch()
  h.installStreamHinweis()
  canvas.scene = szene
  h.meldeAusfall("denied", KARTE)
  gleich("online: das Schild steht", schild() !== null, true)
  navigator.onLine = false
  online.noteResult(false, "pruefsatz")
  if (!online.isOffline()) {
    console.log("\nNICHT PRUEFBAR: der Zustand laesst sich nicht auf offline stellen")
    process.exit(2)
  }
  gleich("faellt die Verbindung, verschwindet das denied-Schild", schild() === null, true)
  h.meldeAusfall("denied", KACHEL)
  gleich("offline erscheint das denied-Schild nie", schild() === null, true)
  h.pruefeSchild()
  gleich("auch nicht beim Neuaufbau", schild() === null, true)
  // Zurueck nach online fuehrt nur die Probe des Tors (ein Erfolg heilt
  // `offline` mit Absicht nicht); die braucht installStreamOnline samt
  // Szenenwache. Der Rueckweg ist deshalb eine Strukturprobe unten und wird im
  // Foundry-Test gemessen. Der Zustand bleibt ab hier offline.
  navigator.onLine = true
}

/* ---------------------------------- Teil 5: die Anschlussstellen im Bestand */

console.log("\nDie Anschlussstellen")
const lies = (p) => readFileSync(join(WURZEL, p), "utf8")
const FETCH = lies("scripts/stream/stream-fetch.mjs")
const ONLINE = lies("scripts/stream/stream-online.mjs")
const EINSTIEG = lies("scripts/stream/beneos-stream.mjs")
const zweig = FETCH.slice(FETCH.indexOf('count("denied", url)'), FETCH.indexOf('return await ersatzAntwort(url, "denied")'))
gleich("[Struktur] der denied-Zweig meldet den Grund", zweig.includes('meldeAusfall("denied", url)'), true)
gleich("[Struktur] und zwar NACH dem Video-Hinweis",
  zweig.indexOf("meldeVideoAbweisung(url)") >= 0 && zweig.indexOf("meldeVideoAbweisung(url)") < zweig.indexOf('meldeAusfall("denied", url)'), true)
const offlineTeil = FETCH.slice(FETCH.indexOf("async function offlineAntwort(url) {"), FETCH.indexOf("async function offlineAntwort(url) {") + 400)
gleich("[Struktur] die Offline-Antwort meldet den Grund", offlineTeil.includes('meldeAusfall("offline", url)'), true)
const video = FETCH.slice(FETCH.indexOf("function meldeVideoAbweisung(url) {"), FETCH.indexOf("function meldeVideoAbweisung(url) {") + 900)
gleich("[Struktur] der Video-Hinweis merkt sich, dass er kam", video.includes("merkeVideoToast()"), true)
const CANVAS = lies("scripts/stream/stream-canvas.mjs")
const bereit = CANVAS.slice(CANVAS.indexOf('Hooks.on("canvasReady", () => {'), CANVAS.indexOf('Hooks.on("canvasReady", () => {') + 600)
gleich("[Struktur] das Nachladen der Videos beendet das Warten, gebunden an den Aufbau vor dem Nachladen",
  /const fertig = aufbauEnde\(\)\s*\n[\s\S]*?fillInVideos\(\)[^\n]*\.finally\(fertig\)/.test(bereit), true)
gleich("[Struktur] stream-canvas holt aufbauEnde aus der Meldestelle", /import \{[^}]*\baufbauEnde\b[^}]*\} from "\.\/stream-hinweis\.mjs"/.test(CANVAS), true)
const klang = ONLINE.slice(ONLINE.indexOf("function installKlangWache() {"), ONLINE.indexOf("let klangGemeldet = false"))
gleich("[Struktur] die Klangwache meldet offline", /meldeKlang\("offline", src\)/.test(klang), true)
gleich("[Struktur] die Klangwache meldet einen gescheiterten Torklang",
  /if \(tor && src\.includes\(tor\) && this\?\.failed && !isOffline\(\)\) meldeKlang\("denied", src\)/.test(klang), true)
gleich("[Struktur] der Klanghelfer gibt an die Meldestelle weiter",
  /function meldeKlang\(grund, src\) \{\s+import\("\.\/stream-hinweis\.mjs"\)\.then\(\(m\) => m\.meldeAusfall\(grund, src\)\)/.test(ONLINE), true)
const wache = ONLINE.slice(ONLINE.indexOf("function installSceneGuard() {"), ONLINE.indexOf("function installKlangWache() {"))
gleich("[Struktur] die Szenenablehnung nimmt ihren Text aus dem Schluessel", wache.includes('"BENEOS.Stream.Scene.Offline"'), true)
gleich("[Struktur] kein hart geschriebener Ablehnungstext mehr", wache.includes("cannot be loaded, there is no connection"), false)
gleich("[Struktur] der Einstieg baut die Meldestelle ein", EINSTIEG.includes("installStreamHinweis()"), true)
gleich("[Struktur] kein Patreon-Link in einem Sprachwert", lies("lang/en.json").includes("patreon.com/c/"), false)
gleich("[Struktur] jeder Wechsel der Verbindung stellt das Schild neu",
  lies("scripts/stream/stream-hinweis.mjs").includes("onStreamState(() => pruefeSchild())"), true)
gleich("[Struktur] Steuerdateien wie das Manifest melden keinen Ausfall", zweig.includes('if (!isControl(url)) meldeAusfall("denied", url)'), true)
const FENSTER = lies("scripts/cloud-v2/cloud-window-v2.mjs")
gleich("[Struktur] der Kaufknopf im Fenster nimmt weiter kaufKnopf(bmapRelease)",
  FENSTER.includes("const bmapKauf = kaufKnopf(bmapRelease)") && FENSTER.includes("shopUrl: bmapKauf.url,"), true)
gleich("[Struktur] das Schild nimmt denselben kaufKnopf",
  /import \{ kaufKnopf \} from "\.\.\/cloud-v2\/cloud-kaufknopf\.mjs"/.test(lies("scripts/stream/stream-hinweis.mjs")), true)

/* ----------------------------------------------------- Teil 6: die Sprachen */

console.log("\nDie Sprachen")
const modul = JSON.parse(lies("module.json"))
const sprachen = modul.languages.map((l) => l.path)
gleich("module.json nennt 14 Sprachdateien (13 Pflichtsprachen und Englisch)", sprachen.length, 14)
const NEU = ["BENEOS.Stream.Notice.Offline", "BENEOS.Stream.Notice.Denied", "BENEOS.Stream.Notice.MapDenied",
  "BENEOS.Stream.Notice.MapSubscribe", "BENEOS.Stream.Scene.Offline", "BENEOS.Cloud.Card.BuyPack", "BENEOS.Cloud.Card.BuyBundle"]
const GEAENDERT = ["BENEOS.Stream.Intro.Cost", "BENEOS.Stream.Doku.DropBody"]
// Halbgeviert, Geviert und das doppelte Minus. Aus Zeichencodes gebaut, damit
// der Pruefsatz selbst keinen Gedankenstrich traegt.
const STRICHE = [String.fromCharCode(0x2013), String.fromCharCode(0x2014), ` ${"-".repeat(2)} `]
const hatStrich = (t) => STRICHE.some((s) => t.includes(s))
for (const p of sprachen) {
  const j = JSON.parse(lies(p))
  const fehlt = NEU.filter((k) => typeof j[k] !== "string" || j[k].trim() === "")
  gleich(`${p}: alle neuen Schluessel da`, fehlt.length, 0)
  gleich(`${p}: Scene.Offline nennt den Namen`, String(j["BENEOS.Stream.Scene.Offline"] ?? "").includes("{name}"), true)
  const strich = [...NEU, ...GEAENDERT].filter((k) => hatStrich(String(j[k] ?? "")))
  gleich(`${p}: kein Gedankenstrich in den neuen und geaenderten Werten`, strich.length, 0)
}
const en = JSON.parse(lies("lang/en.json"))
for (const k of GEAENDERT) {
  gleich(`${k}: verspricht nicht mehr, dass offline gezeichnet wird`, /still draws/.test(en[k]), false)
}
// Betreiber-Nachtrag: "nicht berechtigt", eine Karte ist auch kaufbar.
gleich("MapDenied sagt: nicht berechtigt", /not entitled to view this map/i.test(en["BENEOS.Stream.Notice.MapDenied"] ?? ""), true)
const URSACHE = /membership|subscri|patreon|\btier\b/i
gleich("MapDenied nennt keine Mitgliedschaft als Ursache", URSACHE.test(en["BENEOS.Stream.Notice.MapDenied"] ?? "x membership"), false)
gleich("Notice.Denied nennt keine Mitgliedschaft als Ursache", URSACHE.test(en["BENEOS.Stream.Notice.Denied"] ?? "x membership"), false)
const BERECHTIGUNG = /entitl|access|permission|membership|subscri/i
gleich("die Offline-Meldung nennt nie fehlende Berechtigung", BERECHTIGUNG.test(en["BENEOS.Stream.Notice.Offline"] ?? "x access"), false)
gleich("die Offline-Ablehnung der Szene nennt nie fehlende Berechtigung", BERECHTIGUNG.test(en["BENEOS.Stream.Scene.Offline"] ?? "x access"), false)
gleich("Positivkontrolle: die Ursachensuche findet die Mitgliedschaft", URSACHE.test("your membership expired") && BERECHTIGUNG.test("not entitled"), true)
// Positivkontrolle der Strichsuche: dieselbe Regel findet jeden der drei Striche.
gleich("Positivkontrolle: die Strichsuche findet einen Gedankenstrich",
  STRICHE.every((s) => hatStrich(`a ${s} b`)), true)

/* ------------------------------------------------------------------ Schluss */

console.log(`\n${gruen} bestanden, ${rot} gescheitert`)
console.log("\nNicht pruefbar ohne Foundry: dass PIXI und das Tor die abgewiesene Adresse\n"
  + "in derselben Form liefern, die streamAdressenVon nennt, und wie das Schild\n"
  + "im echten Bedienfeld aussieht. Das misst der Foundry-Test.")
process.exit(rot > 0 ? 1 : 0)
