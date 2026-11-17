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

import { readFileSync } from "node:fs"
import { pruefstand, installiereFoundry, haken } from "../../tools/lib/foundry-attrappe.mjs"
import { extractHaken, extractMethod } from "../../tools/lib/extract-method.mjs"

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

// ===================================================== stre-T-125: die Uebrigen
//
// Dieselben drei Proben wie oben, je Stelle: keine unbehandelte Ablehnung,
// genau eine Meldung, und die Meldung traegt das Fehlerobjekt.
function dreiProben(stelle, r, wurf) {
  p.gleich(`${stelle}: keine unbehandelte Ablehnung`, r.unbehandelt, 0)
  p.gleich(`${stelle}: genau einmal gemeldet`, r.gemeldet, 1)
  p.gleich(`${stelle}: traegt das Fehlerobjekt`, r.traegt(wurf), true)
}
const lehneAb = (wurf) => () => Promise.reject(wurf)

// ------------------------------------------------------- beneos_module.js
//
// Das Modul laesst sich nicht importieren: es zieht das Cloud-Fenster und
// weitere Teile mit Foundry-Klassen herein. Gemessen wird deshalb der ECHTE
// Rueckruf, geschnitten mit `extractHaken` und ausgewertet in einem Bereich,
// in dem jeder unbekannte Name ein Allesschlucker ist. Was eine Probe braucht,
// setzt sie selbst.
const MODULQUELLE = readFileSync(new URL("../beneos_module.js", import.meta.url), "utf8")

/** Jeder Zugriff, jeder Ruf und jedes `new` liefert ihn wieder. */
const LEER = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (typeof k === "symbol" || k === "then") ? undefined : LEER),
  apply: () => LEER,
  construct: () => LEER,
})
/** Ein Objekt mit eigenen Feldern; was fehlt, ist LEER. */
const teil = (eigen) => new Proxy(eigen, {
  get: (t, k) => (k in t ? t[k] : (typeof k === "symbol" || k === "then") ? undefined : LEER),
})
/** Der Namensbereich des Rueckrufs: eigene Namen, dann Node, sonst LEER. */
const bereich = (eigen) => new Proxy(eigen, {
  has: (t, k) => typeof k !== "symbol",
  get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : k in globalThis ? globalThis[k] : LEER),
  set: (t, k, v) => { t[k] = v; return true },
})
const sofort = (fn) => { fn(); return 0 }

/**
 * Schneidet den Haken und optionale benannte Funktionen des Moduls und
 * bindet sie an `eigen`. Misslingt der Schnitt, liefert er null: die Proben
 * werden rot, statt dass der Satz abbricht.
 */
function modulHaken(name, kennung, eigen, hilfen = []) {
  try {
    const teile = []
    for (const h of hilfen) {
      try { teile.push(extractMethod(MODULQUELLE, h, { minZeilen: 1, maxZeilen: 400 })) } catch (_) { /* fehlt vor dem Bau */ }
    }
    const quelle = extractHaken(MODULQUELLE, name, { kennung })
    return new Function("bereich", `with (bereich) {\n${teile.join("\n")}\nreturn (${quelle})\n}`)(bereich(eigen))
  } catch (e) {
    console.log(`  Schnitt ${name}/${kennung} misslang: ${e.message}`)
    return null
  }
}
/**
 * Ruft den Rueckruf wie Foundry, ohne auf ihn zu warten. Fehlt er oder wirft
 * er synchron, kam der Lauf nie an die Stelle: das zaehlt als hundert
 * unbehandelte Ablehnungen, damit die erste Probe nicht zufaellig gruen ist.
 */
const rufe = (fn, ...args) => () => {
  if (typeof fn !== "function") { unbehandelt += 100; return }
  try { fn(...args) } catch (e) {
    unbehandelt += 100
    console.log(`  synchroner Wurf: ${e?.message ?? e}`)
  }
}
const STILL = { on() {}, once() {}, off() {}, callAll() {}, call() { return true } }

p.abschnitt("beneos_module.js: ready, Freigabelisten nach dem Katalog (M1)")
{
  const wurf = new Error("Pruefsatz: Freigabelisten")
  const fn = modulHaken("ready", "loadPublicAllowlists", {
    Hooks: STILL, setTimeout: sofort,
    BeneosUtility: teil({ moduleID: () => "beneos-module" }),
    BeneosDatabaseHolder: teil({ loadDatabaseFiles: () => Promise.resolve() }),
    game: teil({
      beneos: teil({ cloud: teil({ loadPublicAllowlists: lehneAb(wurf) }) }),
      settings: teil({ get: () => false, set: () => Promise.resolve() }),
    }),
  })
  dreiProben("ready Freigabelisten", await lauf(rufe(fn), "public allowlists load failed"), wurf)
}

p.abschnitt("beneos_module.js: ready, Suchmaschine wieder oeffnen (M2)")
{
  const wurf = new Error("Pruefsatz: Suchmaschine")
  const fn = modulHaken("ready", "loadPublicAllowlists", {
    Hooks: STILL, setTimeout: sofort,
    BeneosUtility: teil({ moduleID: () => "beneos-module" }),
    BeneosDatabaseHolder: teil({ loadDatabaseFiles: () => Promise.resolve() }),
    game: teil({
      // Ausdruecklich GM, seit stre-T-132 steht das Tor davor.
      user: { isGM: true },
      beneos: teil({ cloud: teil({ loadPublicAllowlists: () => Promise.resolve() }) }),
      settings: teil({
        get: (_m, n) => n === "beneos-reload-search-engine",
        set: (_m, n) => (n === "beneos-reload-search-engine" ? Promise.reject(wurf) : Promise.resolve()),
      }),
    }),
  })
  dreiProben("ready Suchmaschine", await lauf(rufe(fn), "search engine reload flag reset failed"), wurf)
}

// stre-T-132: Das Flag ist ein Welt-Setting. Schreiben darf es in Foundry v13
// nur, wer SETTINGS_MODIFY hat (ab Assistenz-GM), also kein Spieler. Ohne Tor
// oeffnet jeder Spielerclient das Cloud-Fenster und scheitert am
// Zuruecksetzen. Die Attrappe lehnt `set` darum fuer Spieler ab, wie Foundry.
p.abschnitt("beneos_module.js: ready, Suchmaschine nur beim GM (T-132)")
async function gmTorLauf(isGM, flag) {
  // drin: Schreiben und Oeffnen, die im Rueckruf des 4000-ms-Zeitgebers geschahen.
  const z = { timer: 0, set: [], render: 0, renderOpt: null, drin: 0 }
  const fn = modulHaken("ready", "loadPublicAllowlists", {
    Hooks: STILL,
    setTimeout: (f, ms) => {
      const vor = z.set.length + z.render
      f()
      if (ms === 4000) { z.timer++; z.drin += z.set.length + z.render - vor }
      return 0
    },
    BeneosUtility: teil({ moduleID: () => "beneos-module" }),
    BeneosDatabaseHolder: teil({ loadDatabaseFiles: () => Promise.resolve() }),
    BeneosCloudWindowV2: class { render(o) { z.render++; z.renderOpt = o; return Promise.resolve() } },
    game: teil({
      user: { isGM },
      beneos: teil({ cloud: teil({ loadPublicAllowlists: () => Promise.resolve() }) }),
      settings: teil({
        get: (_m, n) => (n === "beneos-reload-search-engine" ? flag : false),
        set: (_m, n, v) => {
          if (n !== "beneos-reload-search-engine") return Promise.resolve()
          z.set.push(v)
          return isGM ? Promise.resolve() : Promise.reject(new Error("Pruefsatz: Spieler darf nicht schreiben"))
        },
      }),
    }),
  })
  // Nur die Warnungen dieses Zweigs; der Analytics-Zweig des GM laeuft hier gegen Attrappen.
  const r = await lauf(rufe(fn), "search engine")
  return { ...z, r }
}
{
  const s = await gmTorLauf(false, true)
  p.gleich("T-132 Spieler: kein Zeitgeber fuer das Suchfenster", s.timer, 0)
  p.gleich("T-132 Spieler: das Flag wird nicht geschrieben", s.set.length, 0)
  p.gleich("T-132 Spieler: das Cloud-Fenster oeffnet nicht", s.render, 0)
  p.gleich("T-132 Spieler: keine Warnung", s.r.gemeldet, 0)
  p.gleich("T-132 Spieler: keine unbehandelte Ablehnung", s.r.unbehandelt, 0)

  const g = await gmTorLauf(true, true)
  p.gleich("T-132 GM: ein Zeitgeber mit 4000 ms", g.timer, 1)
  p.gleich("T-132 GM: das Flag wird einmal auf false gesetzt", JSON.stringify(g.set), "[false]")
  p.gleich("T-132 GM: das Cloud-Fenster oeffnet einmal", g.render, 1)
  p.gleich("T-132 GM: keine Warnung", g.r.gemeldet, 0)
  p.gleich("T-132 GM: Flag und Fenster erst im Zeitgeber", g.drin, 2)
  // Ohne force oeffnet ApplicationV2 ein neues Fenster nie (Foundry v13).
  p.gleich("T-132 GM: das Cloud-Fenster mit force", JSON.stringify(g.renderOpt), "{\"force\":true}")
  p.gleich("T-132 GM: keine unbehandelte Ablehnung", g.r.unbehandelt, 0)

  const o = await gmTorLauf(true, false)
  p.gleich("T-132 GM ohne Flag: kein Zeitgeber", o.timer, 0)
  p.gleich("T-132 GM ohne Flag: das Cloud-Fenster bleibt zu", o.render, 0)
  p.gleich("T-132 GM ohne Flag: keine unbehandelte Ablehnung", o.r.unbehandelt, 0)
}

p.abschnitt("beneos_module.js: renderActorSheet, Tokenmenue am Portraet (M3)")
for (const [weg, system, vorlage] of [["pf2e", "pf2e", "x.hbs"], ["npc-sheet-2", "dnd5e", "npc-sheet-2.hbs"], ["Profil", "dnd5e", "character.hbs"]]) {
  const wurf = new Error(`Pruefsatz: Tokenmenue ${weg}`)
  const klicks = []
  const jq = (sel) => teil({ mouseup: (f) => { klicks.push(f) } })
  const fn = modulHaken("renderActorSheet", "prepareMenu", {
    $: jq,
    BeneosUtility: teil({ prepareMenu: lehneAb(wurf) }),
    game: teil({ user: { isGM: true }, system: { id: system } }),
  })
  rufe(fn, { template: vorlage, id: "blatt" }, {}, {})()
  dreiProben(`Tokenmenue ${weg}`, await lauf(rufe(klicks[0], {}), "token menu failed"), wurf)
}

// Der Token-HUD und seine zwei Klickwege. Die Umgebung ist fuer alle drei
// dieselbe; jede Probe stellt nur die eine Ablehnung.
function hudUmgebung(utility) {
  const klicks = []
  const knopf = { classList: { add() {}, remove() {}, contains: () => true }, querySelector: () => null, setAttribute() {} }
  const jq = (sel) => {
    const o = teil({
      0: knopf,
      find: () => o,
      append: () => o,
      click: (f) => { if (f) klicks.push({ art: "click", sel, f }); return o },
      on: (_ereignis, f) => { klicks.push({ art: "on", sel, f }); return o },
    })
    return o
  }
  const marke = { id: "marke", document: { texture: { src: "kreatur-token.webp" } } }
  const fn = modulHaken("renderTokenHUD", "hud, html, token", {
    $: jq, setTimeout: sofort,
    offlineGesperrt: () => false,
    foundry: { applications: { handlebars: { renderTemplate: async () => "" } } },
    BeneosUtility: teil({
      getToken: () => marke,
      checkIsBeneosToken: () => true,
      getTokenImageInfo: () => ({ number: 2 }),
      getVariants: () => [],
      beneosTopVariantExists: () => Promise.resolve(true),
      isBeneosCreatorMode: () => false,
      ...utility,
    }),
    game: teil({ user: { isGM: true } }),
  }, ["tokenHudAufbauen"])
  return { fn, klicks }
}

p.abschnitt("beneos_module.js: renderTokenHUD (M4)")
{
  const wurf = new Error("Pruefsatz: Token-HUD")
  const { fn } = hudUmgebung({ getToken: () => { throw wurf } })
  dreiProben("Token-HUD", await lauf(rufe(fn, {}, {}, { _id: "marke" }), "token HUD failed"), wurf)
}

p.abschnitt("beneos_module.js: Variantenwechsel im HUD (M5)")
{
  const wurf = new Error("Pruefsatz: Variantenwechsel")
  const { fn, klicks } = hudUmgebung({ forceChangeToken: lehneAb(wurf) })
  rufe(fn, {}, {}, { _id: "marke" })()
  await warte(30)
  const klick = klicks.find((k) => k.art === "click")?.f
  const ereignis = { target: { parentElement: {}, dataset: { variant: "2" }, classList: { contains: (c) => c === "beneos-button-variant" } } }
  dreiProben("Variantenwechsel", await lauf(rufe(klick, ereignis), "variant switch failed"), wurf)
}

p.abschnitt("beneos_module.js: Stilwechsel im HUD (M6)")
{
  const wurf = new Error("Pruefsatz: Stilwechsel")
  const { fn, klicks } = hudUmgebung({ toggleTokenStyle: lehneAb(wurf) })
  rufe(fn, {}, {}, { _id: "marke" })()
  await warte(30)
  const klick = klicks.find((k) => k.art === "on" && String(k.sel).includes("style-toggle"))?.f
  dreiProben("Stilwechsel", await lauf(rufe(klick, { preventDefault() {}, stopPropagation() {} }), "style switch failed"), wurf)
}

p.abschnitt("beneos_module.js: Cloud-Ablage auf der Leinwand (M7)")
{
  const wurf = new Error("Pruefsatz: Leinwandablage")
  const fn = modulHaken("dropCanvasData", "handlePendingCanvasDrop", {
    game: teil({ beneos: teil({ cloud: teil({ handlePendingCanvasDrop: lehneAb(wurf) }) }) }),
  })
  let rueckgabe
  const r = await lauf(rufe((...a) => { rueckgabe = fn(...a) }, {}, { beneosCloudPending: true }), "cloud canvas drop failed")
  dreiProben("Leinwandablage", r, wurf)
  p.gleich("Leinwandablage: Foundrys eigene Ablage bleibt unterdrueckt", rueckgabe, false)
}

p.abschnitt("beneos_module.js: Cloud-Ablage auf dem Blatt (M8)")
{
  const wurf = new Error("Pruefsatz: Blattablage")
  const fn = modulHaken("dropActorSheetData", "handlePendingItemDrop", {
    game: teil({ beneos: teil({ cloud: teil({ handlePendingItemDrop: lehneAb(wurf) }) }) }),
  })
  let rueckgabe
  const r = await lauf(rufe((...a) => { rueckgabe = fn(...a) }, {}, {}, { beneosCloudPending: true, type: "Item" }), "cloud item drop failed")
  dreiProben("Blattablage", r, wurf)
  p.gleich("Blattablage: Foundrys eigene Ablage bleibt unterdrueckt", rueckgabe, false)
}

p.abschnitt("beneos_module.js: ready, Abrufmarke zuruecksetzen (M9)")
{
  const wurf = new Error("Pruefsatz: Abrufmarke")
  const fn = modulHaken("ready", "last-content-fetch-server-time", {
    BeneosUtility: teil({ moduleID: () => "beneos-module" }),
    CONFIG: {},
    game: teil({ settings: teil({ set: lehneAb(wurf) }) }),
  })
  dreiProben("Abrufmarke", await lauf(rufe(fn), "content fetch cursor reset failed"), wurf)
}

p.abschnitt("beneos_module.js: Szenenmenue, Kartenwechsel (M10)")
{
  const wurf = new Error("Pruefsatz: Kartenwechsel")
  const fn = modulHaken("getSceneContextOptions", "switchPhase", {
    BeneosUtility: teil({ switchPhase: lehneAb(wurf) }),
  })
  const optionen = []
  rufe(fn, {}, optionen)()
  const statisch = optionen.find((o) => o.name === "Use Static Map" && !o.classes)
  dreiProben("Kartenwechsel", await lauf(rufe(statisch?.callback, {}), "map switch failed"), wurf)
}

p.abschnitt("beneos_module.js: beneos.releaseInstalled (M11)")
{
  const wurf = new Error("Pruefsatz: Standbildliste")
  const fn = modulHaken("beneos.releaseInstalled", "refreshStaticSwitchCacheForScenes", {
    BeneosUtility: teil({ refreshStaticSwitchCacheForScenes: lehneAb(wurf) }),
  })
  dreiProben("Standbildliste", await lauf(rufe(fn, { sceneIds: ["szene"] }), "static switch refresh failed"), wurf)
}

// ------------------------------------------------------ beneos_utility.js
//
// Acht Haken (updateActor, updateToken, createCombatant, deleteCombatant,
// canvasReady, createToken, deleteActor, deleteItem) rufen synchrone
// Funktionen der Utility, die den Promise wegwerfen. Ein Fang am Haken kaeme
// dort nie an; gefangen wird deshalb dort, wo der Promise entsteht. Diese
// Datei laesst sich echt importieren.
const { BeneosUtility: BU } = await import("../beneos_utility.js")

/** Ersetzt Felder von `ziel` fuer die Dauer eines Laufs. */
async function mit(ziel, felder, koerper) {
  const alt = {}
  for (const k of Object.keys(felder)) { alt[k] = ziel[k]; ziel[k] = felder[k] }
  try { return await koerper() } finally { Object.assign(ziel, alt) }
}

p.abschnitt("beneos_utility.js: Todesdarstellung nach Trefferpunkten (U1)")
globalThis.game.dnd5e ??= {}
BU.beneosHealth ??= {}
{
  const wurf = new Error("Pruefsatz: Todeseffekt setzen")
  const marke = { id: "tot", actor: { system: { attributes: { hp: { value: 0 } } } } }
  BU.beneosHealth[marke.id] = 5
  const r = await mit(BU, { deathIconApplies: () => true, applyDeadFX: lehneAb(wurf) },
    () => lauf(rufe(() => BU.applyDeathStateByHp(marke)), "dead FX apply failed"))
  dreiProben("Todeseffekt setzen", r, wurf)
}
{
  const wurf = new Error("Pruefsatz: Todeseffekt loesen")
  const marke = { id: "steht", actor: { system: { attributes: { hp: { value: 3 } } } } }
  BU.beneosHealth[marke.id] = 0
  const r = await mit(BU, { deathIconApplies: () => true, removeDeadFX: lehneAb(wurf) },
    () => lauf(rufe(() => BU.applyDeathStateByHp(marke)), "dead FX removal failed"))
  dreiProben("Todeseffekt loesen", r, wurf)
}

p.abschnitt("beneos_utility.js: neuer Token (U2)")
for (const [stelle, bereichName, marke] of [["Tokenschluessel", "beneos-module", "token fullKey flag write failed"], ["Videozufall", "core", "token randomizeVideo flag write failed"]]) {
  const wurf = new Error(`Pruefsatz: ${stelle}`)
  const dokument = {
    id: "neu", parent: null, texture: { src: "kreatur-token.webp" },
    setFlag: (s) => (s === bereichName ? Promise.reject(wurf) : Promise.resolve()),
  }
  const r = await mit(BU, {
    moduleID: () => "beneos-module", getTokenImageInfo: () => ({ fullKey: "k" }),
    beneosRenderUpdateFor: () => null, updateToken: () => {},
  }, async () => {
    const e = await lauf(rufe(() => BU.newTokenSetup({ id: "neu", document: dokument })), marke)
    await warte(550) // der verzoegerte updateToken-Ruf laeuft noch gegen die Attrappe
    return e
  })
  dreiProben(stelle, r, wurf)
}

p.abschnitt("beneos_utility.js: Registereintrag entfernen (U3)")
for (const [stelle, methode, feld, eintrag, marke] of [
  ["Tokenregister", "removeTokenFromActorId", "beneosTokens", { actorId: "weg" }, "token registry save failed"],
  ["Gegenstandsregister", "removeItem", "beneosItems", { itemId: "weg" }, "item registry save failed"],
  ["Zauberregister", "removeSpell", "beneosSpells", { spellId: "weg" }, "spell registry save failed"],
]) {
  const wurf = new Error(`Pruefsatz: ${stelle}`)
  const r = await mit(BU, { [feld]: { schluessel: eintrag } }, () =>
    mit(globalThis.game.settings, { set: lehneAb(wurf) }, () => lauf(rufe(() => BU[methode]("weg")), marke)))
  dreiProben(stelle, r, wurf)
}

// ------------------------------------------------------ stream-scene-ui.mjs
p.abschnitt("stream-scene-ui.mjs: Rechtsklick auf Szene und Ordner (S1 bis S3)")
globalThis.HTMLElement ??= class HTMLElement {}
const SU = await import("./stream-scene-ui.mjs")
if (!behandler("getFolderContextOptions", "ordnerDialog")) SU.installStreamSceneUi()
{
  const wurf = new Error("Pruefsatz: Szene offline schalten")
  const optionen = behandler("getSceneContextOptions", "schalteKarte")?.({}, []) ?? []
  const eintrag = optionen.find((o) => String(o.callback).includes("schalteKarte"))
  const r = await mit(globalThis.game, { scenes: { get() { throw wurf } } },
    () => lauf(rufe(eintrag?.callback, { 0: { dataset: { sceneId: "szene" } } }), "Offline schalten abgebrochen"))
  dreiProben("Szene offline schalten", r, wurf)
}
for (const [stelle, ruf, marke] of [["Ordner offline nehmen", "ordnerDialog", "Ordner offline nehmen abgebrochen"], ["Ordner freigeben", "ordnerFreigeben", "Ordner freigeben abgebrochen"]]) {
  const wurf = new Error(`Pruefsatz: ${stelle}`)
  // Die Szene wirft erst beim zweiten Lesen ihrer Kennung: das erste Lesen
  // gehoert dem synchronen Sammeln, das zweite der asynchronen Vorschau.
  let gelesen = 0
  const szene = { get id() { gelesen++; if (gelesen > 1) throw wurf; return "szene" } }
  const ordner = { type: "Scene", contents: [szene] }
  const optionen = behandler("getFolderContextOptions", "ordnerDialog")?.({}, []) ?? []
  const eintrag = optionen.find((o) => String(o.callback).includes(ruf))
  const r = await mit(globalThis.game, { folders: { get: () => ordner } },
    () => lauf(rufe(eintrag?.callback, { 0: { dataset: { folderId: "ordner" } } }), marke))
  dreiProben(stelle, r, wurf)
}

// ------------------------------------------------ Kalt-Review zu stre-T-125
//
// W1 und W2: ein async render() hinter einem synchronen try oder ganz ohne
// Fang. W3: der Zwilling des Ordnerdialogs im Cloud-Fenster.
p.abschnitt("beneos_module.js: ready, Ergebnisliste neu zeichnen (W2)")
{
  const wurf = new Error("Pruefsatz: Ergebnisliste")
  const fn = modulHaken("ready", "loadPublicAllowlists", {
    Hooks: STILL, setTimeout: sofort,
    BeneosUtility: teil({ moduleID: () => "beneos-module" }),
    BeneosDatabaseHolder: teil({ loadDatabaseFiles: () => Promise.resolve() }),
    game: teil({
      beneos: teil({
        cloud: teil({ loadPublicAllowlists: () => Promise.resolve() }),
        cloudWindowV2: teil({ render: lehneAb(wurf) }),
      }),
      settings: teil({ get: () => false, set: () => Promise.resolve() }),
    }),
  })
  dreiProben("ready Ergebnisliste", await lauf(rufe(fn), "results re-render failed"), wurf)
}

p.abschnitt("beneos_module.js: ready, Suchfenster neu oeffnen (W1)")
{
  const wurf = new Error("Pruefsatz: Suchfenster")
  const fn = modulHaken("ready", "loadPublicAllowlists", {
    Hooks: STILL, setTimeout: sofort,
    BeneosUtility: teil({ moduleID: () => "beneos-module" }),
    BeneosDatabaseHolder: teil({ loadDatabaseFiles: () => Promise.resolve() }),
    BeneosCloudWindowV2: class { render() { return Promise.reject(wurf) } },
    game: teil({
      // Ausdruecklich GM, seit stre-T-132 steht das Tor davor.
      user: { isGM: true },
      beneos: teil({ cloud: teil({ loadPublicAllowlists: () => Promise.resolve() }) }),
      settings: teil({ get: (_m, n) => n === "beneos-reload-search-engine", set: () => Promise.resolve() }),
    }),
  })
  dreiProben("ready Suchfenster", await lauf(rufe(fn), "search engine reopen failed"), wurf)
}

// Das Cloud-Fenster laesst sich nicht importieren. Geschnitten wird die echte
// Methode und in eine Klasse gesetzt; die Namen kommen aus dem Bereich.
const FENSTERQUELLE = readFileSync(new URL("../cloud-v2/cloud-window-v2.mjs", import.meta.url), "utf8")
function fensterMethode(name, eigen) {
  try {
    const schnitt = extractMethod(FENSTERQUELLE, name, { minZeilen: 3, maxZeilen: 200 })
    const ruf = name.startsWith("#")
      ? `static probe(...a) { return new this().${name}(...a) }`
      : ""
    return new Function("bereich", `with (bereich) { return class { ${schnitt}\n${ruf} } }`)(bereich(eigen))
  } catch (e) {
    console.log(`  Schnitt ${name} misslang: ${e.message}`)
    return null
  }
}

p.abschnitt("cloud-window-v2.mjs: Release-Kachel, Offline-Daten entfernen (W3)")
{
  const wurf = new Error("Pruefsatz: Release freigeben")
  const K = fensterMethode("_onReleaseOfflineFreigeben", {
    game: teil({ user: { isGM: true } }),
    szenenZuRelease: () => ["szene"],
    releaseOfflineSchalten: lehneAb(wurf),
  })
  const ereignis = { preventDefault() {}, stopPropagation() {} }
  const ziel = { dataset: { releaseDir: "release", releaseVariant: "" } }
  const app = { render: () => Promise.resolve() }
  dreiProben("Release freigeben", await lauf(rufe((...a) => K?._onReleaseOfflineFreigeben.call(app, ...a), ereignis, ziel), "release offline data removal failed"), wurf)
}

p.abschnitt("cloud-window-v2.mjs: Offline-Menue am Release (W3)")
{
  const wurf = new Error("Pruefsatz: Offline-Menue")
  const knoepfe = []
  const element = () => ({
    style: {}, remove() {}, appendChild() {},
    addEventListener(art, f) { if (art === "click") knoepfe.push(f) },
  })
  const K = fensterMethode("#offlineMenue", {
    document: { querySelector: () => null, createElement: element, body: { appendChild() {} } },
    window: { addEventListener() {} },
    setTimeout: () => 0,
    game: teil({ i18n: { localize: (k) => k } }),
    releaseOfflineSchalten: lehneAb(wurf),
  })
  await K?.probe({ clientX: 0, clientY: 0 }, ["szene"], false)
  dreiProben("Offline-Menue", await lauf(rufe(knoepfe[0]), "release offline menu failed"), wurf)
}

p.abschnitt("extractHaken: eine Klammer in einer Zeichenkette kuerzt den Schnitt nicht still")
{
  const quelle = 'Hooks.on("probe", () => {\n  console.log(":)")\n  return 1\n})\n'
  let meldung = ""
  try { extractHaken(quelle, "probe", { kennung: "console" }) } catch (e) { meldung = e.message }
  p.gleich("extractHaken: ein abgeschnittener Rueckruf bricht mit Meldung ab", meldung.includes("kein gueltiger Ausdruck"), true)
}

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
