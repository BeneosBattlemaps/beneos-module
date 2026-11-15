/**
 * stream-leinwand.mjs
 *
 * Schluesselfrei auf der Platte, mit Schluessel im Arbeitsspeicher
 * (stre-T-102, Betreiberentscheid D1).
 *
 * WARUM. Seit T-102 steht in Kacheln, Szenen, Klaengen und Akteuren die
 * schluesselfreie Form `beneos://...`. Ein exportiertes Dokument gibt damit
 * nichts weiter, womit ein Dritter am Tor etwas abrufen koennte. Die Leinwand,
 * die Audioschicht und die Verzeichnislisten koennen mit dieser Form aber
 * nichts anfangen, gemessen am 15.11.2026 im Pruefstand:
 *
 * - `<img src="beneos://...">` meldet einen Fehler, ohne je `fetch` zu rufen.
 * - `foundry.audio.Sound` mit `beneos://` scheitert gepuffert wie gestreamt,
 *   ebenfalls ohne `fetch`.
 * - Die Verzeichnislisten zeichnen aus den vorbereiteten Feldern
 *   (`scene.thumb`, `actor.img`).
 *
 * WIE. Beim Vorbereiten eines Dokuments wird in den Feldern dieser Tabelle die
 * schluesselfreie Form durch die Toradresse von heute ersetzt
 * (`leinwandAdresse`). Nur die VORBEREITETEN Felder, nie `_source`: gemessen
 * am 15.11.2026 ist `tile.texture` ein anderes Objekt als
 * `tile._source.texture`, und weder `toObject()` noch `scene.toObject()` sieht
 * die Aenderung. Gespeichert und exportiert wird `_source`.
 *
 * WARUM IN `prepareBaseData` UND NICHT EINMALIG. `reset()` stellt den
 * Quellwert wieder her, gemessen am selben Tag. Ein einmaliges Umschreiben
 * waere nach dem naechsten Update des Dokuments wieder weg.
 *
 * Die Verzeichnislisten bleiben damit beim Lazy Loading des Browsers. Ein
 * eigener Listenweg ueber Blob-Adressen ist nicht noetig, und der Riegel
 * `VERBOTEN` in `stream-bilder.mjs` (OP-PRJ-177) bleibt unberuehrt.
 */

import { leinwandAdresse, streamEnabled, MODULE_ID, SETTING } from "./stream-settings.mjs"

/**
 * Je Dokumentart die Felder, die eine Adresse tragen, als Punktpfad.
 *
 * `Item` steht bewusst NICHT darin: die Pruefwelt traegt 0 Gegenstaende mit
 * Toradresse, und ein Gegenstandsbild geht in Chatkarten, deren Inhalt
 * gespeichert wird.
 */
export const LEINWAND_FELDER = Object.freeze({
  "Tile": ["texture.src"],
  "Token": ["texture.src"],
  "Note": ["texture.src"],
  "Drawing": ["texture"],
  "AmbientSound": ["path"],
  "PlaylistSound": ["path"],
  "Scene": ["background.src", "foreground", "thumb"],
  // Foundry 14 legt Hintergrund und Vordergrund in die Stufen der Szene
  // (`levels[0]`, siehe `hintergrundVon` in `stream-scenes.mjs`). Auf 13 gibt
  // es `CONFIG.Level` nicht, und die Zeile bleibt ohne Wirkung.
  "Level": ["background.src", "foreground.src"],
  "Actor": ["img"],
})

/**
 * Schreibt die vorbereiteten Felder eines Dokuments um. Rein, ohne Foundry.
 *
 * @returns {number} wie viele Felder umgeschrieben wurden
 */
export function leinwandFelder(art, doc) {
  const felder = LEINWAND_FELDER[art]
  if (!felder || !doc || typeof doc !== "object") return 0
  let zahl = 0
  for (const pfad of felder) {
    const teile = pfad.split(".")
    const letztes = teile.pop()
    let ziel = doc
    for (const t of teile) ziel = ziel?.[t]
    if (!ziel || typeof ziel !== "object") continue
    const vorher = ziel[letztes]
    const nachher = leinwandAdresse(vorher)
    if (nachher !== vorher) {
      ziel[letztes] = nachher
      zahl++
    }
  }
  return zahl
}

/** Markiert einen Prototyp, damit ein zweiter Einbau nicht doppelt wickelt. */
const MARKE = Symbol.for("beneos.stream.leinwand")

/**
 * Wickelt `prepareBaseData` der Dokumentklassen aus `CONFIG`.
 *
 * Muss im `init` laufen: die Dokumente werden vor `ready` vorbereitet, und die
 * erste Szene ist gezeichnet, bevor `ready` feuert (gemessen am 22.08.2026,
 * siehe `beneos-stream.mjs`).
 *
 * Gewickelt wird die Klasse, die `CONFIG` nennt, also auch die eines Systems
 * (dnd5e `Actor5e`). Das System bereitet zuerst vor, dann wird umgeschrieben.
 */
export function installStreamLeinwand() {
  for (const art of Object.keys(LEINWAND_FELDER)) {
    const klasse = globalThis.CONFIG?.[art]?.documentClass
    const proto = klasse?.prototype
    if (!proto || Object.hasOwn(proto, MARKE)) continue
    const vorher = proto.prepareBaseData
    Object.defineProperty(proto, MARKE, { value: true })
    proto.prepareBaseData = function beneosLeinwand(...args) {
      const r = vorher?.apply(this, args)
      try { leinwandFelder(art, this) } catch (_) { /* ein Feld darf die Vorbereitung nicht aufhalten */ }
      return r
    }
  }

  /*
   * DER SCHLUESSEL KANN SPAETER KOMMEN ODER WECHSELN. Eine Welt, die ihn erst
   * im `ready` bekommt, hat ihre Dokumente ohne ihn vorbereitet, und nach einer
   * Rotation tragen die vorbereiteten Felder den alten. Beides heilt ein
   * erneutes Vorbereiten, und `reset()` tut genau das.
   */
  const name = `${MODULE_ID}.${SETTING.key}`
  const neuVorbereiten = (setting) => {
    if (setting?.key !== name || !streamEnabled()) return
    for (const sammlung of [game.scenes, game.actors, game.playlists]) {
      for (const d of sammlung ?? []) {
        try { d.reset() } catch (_) { /* ein Dokument darf die anderen nicht aufhalten */ }
      }
    }
  }
  Hooks.on("createSetting", neuVorbereiten)
  Hooks.on("updateSetting", neuVorbereiten)
}
