/**
 * EIN FEHLER IN EINEM ASYNCHRONEN LAUF, DEN EIN HAKEN ANSTOESST, KOMMT ALS
 * WARNUNG AN, NICHT ALS UNBEHANDELTE ABLEHNUNG (stre-T-113, Stellen 2 und 3).
 *
 * Foundry wartet Haken nicht ab. Ein async-Behandler oder ein async-Ruf ohne
 * `.catch` endet bei einem Fehler in einer unbehandelten Ablehnung: die
 * Funktion faellt still aus, und keine Konsolenzeile sagt warum. Stelle 1
 * (`actor-set-bonus-tab.mjs`) ist geschlossen und in
 * `actor-set-bonus-tab.test.mjs` am echten Haken geprueft. Dieser Satz deckt
 * die drei Stellen im Streaming-Ordner:
 *
 *   - `ready` in `beneos-stream.mjs` war selbst `async`. `await explainOnce()`
 *     (`stream-intro.mjs`, `game.settings.set` ohne try) und
 *     `ui.notifications.warn` liegen ausserhalb jedes try.
 *   - `canvasReady` in `stream-canvas.mjs` rief `fillInVideos()` ohne `.catch`;
 *     vor dessen innerem try steht synchroner Code, der werfen kann.
 *   - `updateTile` ruft ueber `setTimeout` `fuehreAbspielwunschAus`, darin
 *     `game.video.play` ohne catch. Die Ablehnung mangels Nutzergeste
 *     (`NotAllowedError`) bleibt still wie beim ersten Abspielen in derselben
 *     Datei; jede andere wird gemeldet.
 *
 * DIESER SATZ FAEHRT DIE ECHTEN BEHANDLER mit der Foundry-Attrappe
 * (`tools/lib/foundry-attrappe.mjs`). Jede Probe ist im Sabotagelaeufer
 * (`tools/stream-sabotagen.mjs`, Satz `hakenfehler`) bewacht.
 *
 * Lauf:  node scripts/stream/stream-hakenfehler.test.mjs
 */

import { pruefstand, installiereFoundry, haken } from "../../tools/lib/foundry-attrappe.mjs"

const p = pruefstand("stream-hakenfehler: async-Laeufe aus Haken melden ihren Fehler")

const { SETTING } = await import("./stream-settings.mjs")
const { einstellungen } = installiereFoundry({ einstellungen: {
  [SETTING.mode]: true, [SETTING.key]: "pk_hakenfehler_attrappe0", [SETTING.base]: "https://gate.beneos.stream",
} })
globalThis.game.settings.registerMenu = () => {}
globalThis.HTMLVideoElement ??= class HTMLVideoElement {}

await import("./beneos-stream.mjs")
const C = await import("./stream-canvas.mjs")
C.installStreamCanvas()

// ------------------------------------------------------------- Werkzeug
const echteWarnung = console.warn
const warnungen = []
const rohWarnungen = []
let unbehandelt = 0
const zaehleUnbehandelt = () => { unbehandelt++ }
process.on("unhandledRejection", zaehleUnbehandelt)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Ruft einen Behandler wie Foundry: ohne auf sein Ergebnis zu warten. Gezaehlt
 * wird danach, was als Warnung kam und was unbehandelt blieb.
 */
async function lauf(ausloesen, marke) {
  await warte(20)
  unbehandelt = 0
  warnungen.length = 0
  rohWarnungen.length = 0
  console.warn = (...a) => {
    rohWarnungen.push(a)
    warnungen.push(a.map((x) => String(x?.message ?? x)).join(" "))
  }
  try {
    ausloesen()
    await warte(300)
  } finally {
    console.warn = echteWarnung
  }
  return {
    unbehandelt,
    gemeldet: warnungen.filter((w) => w.includes(marke)).length,
    erklaert: (text) => warnungen.some((w) => w.includes(marke) && w.includes(text)),
    // Das Fehlerobjekt selbst, nicht nur sein Text: nur so behaelt die
    // Konsole den Stack.
    traegt: (fehler) => rohWarnungen.some((a) => a.includes(fehler)),
  }
}

const behandler = (name, kennung) => haken.liste.find((h) => h.name === name && String(h.fn).includes(kennung))?.fn

// ===================================================================== ready
p.abschnitt("ready in beneos-stream.mjs")
const ready = behandler("ready", "weltstartStream") ?? behandler("ready", "ensureStreamKey")
p.gleich("der ready-Behandler ist angemeldet", typeof ready, "function")

const echteNotiz = globalThis.ui.notifications.warn
const wurfReady = new Error("Pruefsatz wirft im ready")
globalThis.ui.notifications.warn = () => { throw wurfReady }
const rWirft = await lauf(() => ready?.(), "Weltstart abgebrochen")
globalThis.ui.notifications.warn = echteNotiz
p.gleich("ready: ein Wurf wird keine unbehandelte Ablehnung", rWirft.unbehandelt, 0)
p.gleich("ready: der Wurf wird genau einmal gemeldet", rWirft.gemeldet, 1)
p.gleich("ready: die Warnung nennt den Fehler", rWirft.erklaert("Pruefsatz wirft im ready"), true)
p.gleich("ready: die Warnung traegt das Fehlerobjekt", rWirft.traegt(wurfReady), true)

// Gegenwert: ohne Schluessel steigt der Behandler regulaer aus.
einstellungen[SETTING.key] = ""
const rHeil = await lauf(() => ready?.(), "Weltstart abgebrochen")
einstellungen[SETTING.key] = "pk_hakenfehler_attrappe0"
p.gleich("ready, ohne Schluessel: keine Warnung", rHeil.gemeldet, 0)
p.gleich("ready, ohne Schluessel: keine unbehandelte Ablehnung", rHeil.unbehandelt, 0)

// =============================================================== canvasReady
p.abschnitt("canvasReady in stream-canvas.mjs")
const bereit = behandler("canvasReady", "fillInVideos")
p.gleich("der canvasReady-Behandler ist angemeldet", typeof bereit, "function")

const echteLeinwand = globalThis.canvas
const wurfLeinwand = new Error("Pruefsatz wirft vor dem try")
globalThis.canvas = { scene: { name: "t113", get tiles() { throw wurfLeinwand } } }
const cWirft = await lauf(() => bereit?.(), "Videos nachladen abgebrochen")
p.gleich("canvasReady: ein Wurf wird keine unbehandelte Ablehnung", cWirft.unbehandelt, 0)
p.gleich("canvasReady: der Wurf wird genau einmal gemeldet", cWirft.gemeldet, 1)
p.gleich("canvasReady: die Warnung nennt den Fehler", cWirft.erklaert("Pruefsatz wirft vor dem try"), true)
p.gleich("canvasReady: die Warnung traegt das Fehlerobjekt", cWirft.traegt(wurfLeinwand), true)

globalThis.canvas = { scene: { name: "t113", tiles: [] } }
const cHeil = await lauf(() => bereit?.(), "Videos nachladen abgebrochen")
p.gleich("canvasReady, Szene ohne Videos: keine Warnung", cHeil.gemeldet, 0)
p.gleich("canvasReady, Szene ohne Videos: keine unbehandelte Ablehnung", cHeil.unbehandelt, 0)
globalThis.canvas = echteLeinwand

// ============================================================ Abspielwunsch
p.abschnitt("Abspielwunsch nach updateTile in stream-canvas.mjs")
const wunsch = C.fuehreAbspielwunschAus
p.gleich("die Naht fuehreAbspielwunschAus ist exportiert", typeof wunsch, "function")

const element = new globalThis.HTMLVideoElement()
const kachel = () => ({ object: { sourceElement: element, document: { flags: {} } }, video: { autoplay: true, volume: 0 } })
let gespielt = []
// Als Methode wie Foundrys VideoHelper, der `this.locked` und `this.pending`
// liest: ein Ruf ohne Objekt wuerde dort werfen.
const spiele = (antwort) => {
  globalThis.game.video = { play(el, opt) { gespielt.push({ el, opt, selbst: this }); return antwort() } }
}
const ablehnung = (name, text) => () => Promise.reject(Object.assign(new Error(text), { name }))

gespielt = []
const wurfAbspielen = Object.assign(new Error("Pruefsatz lehnt das Abspielen ab"), { name: "AbortError" })
spiele(() => Promise.reject(wurfAbspielen))
const aWirft = await lauf(() => wunsch?.(kachel(), {}), "Abspielen abgebrochen")
p.gleich("Abspielen: eine Ablehnung wird keine unbehandelte Ablehnung", aWirft.unbehandelt, 0)
p.gleich("Abspielen: die Ablehnung wird genau einmal gemeldet", aWirft.gemeldet, 1)
p.gleich("Abspielen: die Warnung nennt den Fehler", aWirft.erklaert("Pruefsatz lehnt das Abspielen ab"), true)
p.gleich("Abspielen: die Warnung traegt das Fehlerobjekt", aWirft.traegt(wurfAbspielen), true)

spiele(ablehnung("NotAllowedError", "Pruefsatz: keine Nutzergeste"))
const aGeste = await lauf(() => wunsch?.(kachel(), {}), "Abspielen abgebrochen")
p.gleich("Abspielen ohne Nutzergeste: still, keine Warnung", aGeste.gemeldet, 0)
p.gleich("Abspielen ohne Nutzergeste: keine unbehandelte Ablehnung", aGeste.unbehandelt, 0)

// Ein synchroner Wurf aus play darf ebenso nicht entkommen.
spiele(() => { throw new Error("Pruefsatz wirft synchron in play") })
const aSync = await lauf(() => { try { wunsch?.(kachel(), {}) } catch (_) { unbehandelt += 100 } }, "Abspielen abgebrochen")
p.gleich("Abspielen: ein synchroner Wurf entkommt nicht", aSync.unbehandelt, 0)
p.gleich("Abspielen: ein synchroner Wurf wird gemeldet", aSync.erklaert("Pruefsatz wirft synchron in play"), true)

gespielt = []
spiele(() => Promise.resolve())
const aHeil = await lauf(() => wunsch?.(kachel(), { offset: 3 }), "Abspielen abgebrochen")
p.gleich("Abspielen intakt: play wird mit dem Element gerufen", gespielt.length === 1 && gespielt[0].el === element, true)
p.gleich("Abspielen intakt: play wird an game.video gerufen", gespielt[0]?.selbst === globalThis.game.video, true)
p.gleich("Abspielen intakt: die Optionen kommen an", JSON.stringify(gespielt[0]?.opt), JSON.stringify({ playing: true, loop: true, offset: 3, volume: 0 }))
p.gleich("Abspielen intakt: keine Warnung", aHeil.gemeldet, 0)

process.off("unhandledRejection", zaehleUnbehandelt)

/*
 * NICHT PRUEFBAR AN DIESEM SATZ:
 *
 * - DASS DIE HAKEN IM ECHTEN FOUNDRY FEUERN. Hier feuert der Satz die
 *   Behandler selbst.
 * - WELCHE FEHLER DORT WIRKLICH ENTSTEHEN. Die Wuerfe sind gestellt.
 * - OB EIN KUNDE JE EINE ANDERE ABLEHNUNG VON `game.video.play` SIEHT ALS
 *   `NotAllowedError`. Das entscheidet der Browser.
 */

p.ende()
