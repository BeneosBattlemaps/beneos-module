/**
 * stream-ersatz-speicher.mjs
 *
 * Verwirft Ersatzbilder, die PIXI als echte Texturen festhaelt, stre-T-222.
 *
 * WARUM ES DAS BRAUCHT. Fehlt die Verbindung, bekommt ein Bild statt eines
 * Fehlers das Ersatzbild "offline" (stream-fetch.mjs, `offlineAntwort` und
 * der Netzfehler-Zweig). Die Antwort traegt Status 200, also ist sie fuer PIXI
 * ein gueltiges Bild, und `PIXI.Assets` haelt es je Adresse fest. Foundry
 * fragt die Datei danach nicht mehr ab: gemessen in T-222 Schritt 1 zeigten
 * Szene hin und zurueck und das Wiederverbinden weiter das Ersatzbild
 * (960x540), erst F5 das echte Bild (3840x2160). Der Vorrat nimmt das
 * Ersatzbild nicht auf, deshalb half F5. Ohne dieses Modul blieb es bis F5
 * oder bis Foundry die Textur nach 15 Minuten ohne Nutzung bei einem
 * Szenenaufbau selbst verwirft (`TextureLoader.CACHE_TTL`).
 *
 * WANN VERWORFEN WIRD.
 *
 * 1. Beim Abbau der Szene, `canvasTearDown`. Foundry v13 wartet den Abbau ab,
 *    bevor `canvasInit` und das Laden der Texturen kommen (foundry.mjs, Canvas
 *    #draw). Der Haken feuert VOR dem Abbau der Gruppen und Ebenen; deren
 *    Buehne ist zu dem Zeitpunkt schon unsichtbar und der Ticker steht.
 *    NICHT nach `canvasInit` verlegen: `PIXI.Assets.unload` loescht den
 *    Eintrag im promiseCache erst nach einem Mikrotakt, und zwischen
 *    `canvasInit` und dem Laden liegt keiner. Gemessen am echten PIXI 7.4.3
 *    im Kalt-Review: ohne Mikrotakt kam die alte, zerstoerte Textur zurueck.
 *    Den Haken gibt es nur, wenn die Leinwand vorher bereit war; nach einem
 *    gescheiterten Zeichnen wird erst beim uebernaechsten Aufbau verworfen.
 *
 * 2. Beim Uebergang von `offline` nach `online`, durch EIN Neuzeichnen der
 *    Szene. Erst damit stimmt Notice.Offline ("... show a placeholder ...
 *    until it is back"). Nur dieser Uebergang: unter einem anhaltenden
 *    Bildfehler bei erreichbarem Tor pendelt der Zustand zwischen `degraded`
 *    und `online` im Sondentakt, und jedes Pendeln haette die Szene neu
 *    gezeichnet. Ist die Leinwand gerade nicht bereit, wird das Neuzeichnen
 *    beim naechsten `canvasReady` nachgeholt.
 *
 * NUR WAS PIXI GELADEN HAT. Gezaehlt wird nur eine Adresse, die der Lader von
 * PIXI kennt; der Lader ruft genau die Adresse ab, unter der er sie fuehrt
 * (Kalt-Review, `path.toAbsolute(src)`). Journal- und Blattbilder gehen durch
 * denselben Abruf (stream-bilder.mjs) und koennen dieselbe Adresse tragen wie
 * eine Textur, die PIXI echt geladen hat. Ihr Abruf meldet sich deshalb mit
 * `{ beneosOberflaeche: true }` und wird nicht gemerkt; sonst zeichnete die
 * Rueckkehr grundlos neu, und der naechste Abbau entluede die echte Textur
 * (Kalt-Review zum Diff, Befund 3).
 *
 * Ersatzbilder wegen fehlenden Zugangs werden nicht gemerkt: die heilt keine
 * Verbindung.
 *
 * Keine Abhaengigkeit auf Foundry oder andere Stream-Dateien zur Ladezeit;
 * die Welt kommt beim Einbau herein. stream-fetch.mjs importiert diese Datei,
 * ein Gegenimport waere ein Zirkelbezug.
 */

/** Adressen, die bei fehlender Verbindung das Ersatzbild bekamen. */
const gemerkt = new Set()

let welt = {
  assets: () => globalThis.PIXI?.Assets,
}

/** Merkt eine Adresse, die gerade das Ersatzbild "offline" bekommen hat. */
export function merkeErsatz(url) {
  if (url) gemerkt.add(String(url))
}

/** Fuer den Pruefsatz: welche Adressen sind gemerkt, unabhaengig von PIXI? */
export function gemerktFuerPruefsatz() {
  return [...gemerkt]
}

/** Hat PIXI diese Adresse geladen? */
function inPixi(assets, url) {
  try { return !!assets?.loader?.promiseCache?.[url] } catch (_) { return false }
}

/** Wie viele gemerkte Ersatzbilder haelt PIXI gerade? */
export function ersatzZahl() {
  const assets = welt.assets()
  let n = 0
  for (const url of gemerkt) if (inPixi(assets, url)) n += 1
  return n
}

/**
 * Entlaedt jedes gemerkte Ersatzbild, das PIXI haelt, und vergisst alle
 * gemerkten Adressen. Gibt die Zahl der angestossenen Entladungen zurueck.
 */
export function verwirfErsatz() {
  const assets = welt.assets()
  let n = 0
  for (const url of gemerkt) {
    if (!inPixi(assets, url)) continue
    n += 1
    // `unload` lehnt asynchron ab und wirft nie synchron; ein try fienge nichts.
    Promise.resolve()
      .then(() => assets.unload(url))
      .catch((e) => console.warn("Beneos Stream | Ersatzbild nicht entladen:", String(e).slice(0, 120)))
  }
  gemerkt.clear()
  return n
}

/**
 * Haengt die beiden Ausloeser ein. Die Parameter sind fuer den Pruefsatz;
 * im Modul kommen die Vorgaben zum Zug.
 */
export function installErsatzVerwerfen({
  hooks = globalThis.Hooks,
  onState,
  leinwand = () => globalThis.canvas,
  assets = () => globalThis.PIXI?.Assets,
  zustand = () => null,
} = {}) {
  welt = { assets }
  hooks.on("canvasTearDown", () => { verwirfErsatz() })

  // Der Zustand beim Einbau zaehlt mit: startet die Welt ohne Netz, steht
  // `offline` schon fest, bevor dieser Hoerer existiert, und die Rueckkehr
  // saehe sonst wie ein Weltstart aus (Kalt-Review zum Diff, Befund 1).
  let vorher = zustand()
  let wartet = false
  const zeichne = () => {
    const c = leinwand()
    if (!c?.ready) {
      if (wartet) return
      wartet = true
      hooks.once("canvasReady", () => { wartet = false; zeichne() })
      return
    }
    if (!ersatzZahl()) return
    Promise.resolve()
      .then(() => c.draw())
      .catch((e) => console.warn("Beneos Stream | Neuzeichnen nach der Rueckkehr abgebrochen:", String(e).slice(0, 120)))
  }
  onState((next) => {
    const war = vorher
    vorher = next
    if (next !== "online" || war !== "offline") {
      // Ein Weg ueber `degraded` zaehlt als Rueckkehr aus `offline`.
      if (next === "degraded" && war === "offline") vorher = "offline"
      return
    }
    zeichne()
  })
}
