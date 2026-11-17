/**
 * stream-klang.mjs
 *
 * Playlist-Klaenge nach einem Schluesselwechsel neu aufbauen (stre-T-119).
 *
 * WARUM. Ein Klang, der mit einem widerrufenen Schluessel anlaeuft, bekommt vom
 * Tor den Platzhalter (200, 42 Byte GIF, `beneos-stream-worker/src/index.js`
 * `placeholder()`), das Dekodieren scheitert, und sein Klangobjekt steht auf
 * FAILED. Foundry baut es danach nie wieder neu, gelesen in 13 und 14 in
 * `client/documents/playlist-sound.mjs`:
 *
 * - `sync()` :150-152 nimmt das vorhandene Objekt und kehrt bei `failed` zurueck.
 * - Neu gebaut wird nur in `_onUpdate` :220-223, wenn `path` oder `channel` in
 *   der Aenderung steht, und in `Playlist#_onUpdate` bei `channel`.
 *
 * Seit T-102 steht auf der Platte `beneos://...`. Der Schluessel kommt erst beim
 * Vorbereiten dazu (`stream-leinwand.mjs`), ein Wechsel aendert `_source.path`
 * also nicht. Bestaetigt am 16.11.2026 in v13 und v14 durch work-stre-1: der
 * Klang blieb bis zum Neuladen stumm.
 *
 * WIE. Nach einem Wechsel von Schluessel oder Basis wird jeder
 * Playlist-Klang mit schluesselfreier Quelle geprueft. Ein Klangobjekt, dessen
 * Adresse nicht mehr die von heute ist, wird ersetzt und mit `sync()` wieder
 * an den Zustand des Dokuments gebunden.
 *
 * WAS NICHT ANGEFASST WIRD:
 *
 * - Ein Klang ohne schluesselfreie Quelle. Den hat dieses Modul nicht
 *   vorbereitet, also gehoert seine Adresse nicht uns.
 * - Ein laufender Klang. Er spielt aus dem, was er schon hat, und ein Neubau
 *   wuerde ihn mitten im Titel abbrechen.
 * - `stream-leinwand.mjs`. Diese Datei steht daneben, damit der Leinwandweg
 *   unabhaengig weiterentwickelt werden kann.
 */

import { leinwandAdresse, MODULE_ID, SETTING } from "./stream-settings.mjs"

const PRAEFIX = "beneos://"

/**
 * Die zwei Einstellungen, aus denen `leinwandAdresse` die Toradresse baut. Der
 * Modus gehoert seit T-102 nicht mehr dazu: die Adresse haengt am Schluessel,
 * nicht am Modus (`stream-settings.mjs`, `leinwandAdresse`).
 */
const EINSTELLUNGEN = new Set([SETTING.key, SETTING.base].map((s) => `${MODULE_ID}.${s}`))
let hakenGesetzt = false

/** `Sound.STATES.LOADING`, mit dem Wert aus 13 und 14 als Rueckfall. */
function zustandLaden() {
  return globalThis.foundry?.audio?.Sound?.STATES?.LOADING ?? 1
}

/**
 * Ein laufender Klang wird nicht unterbrochen, behaelt aber sonst seine alte
 * Adresse fuer immer: ein erneuter Start nimmt dasselbe, schon geladene Objekt.
 * Titel ueber zehn Minuten laufen als Element (`sound.mjs` :67) und laden
 * dabei mit dem widerrufenen Schluessel nach. Deshalb wird das Objekt ersetzt,
 * sobald es stoppt oder endet, OHNE `sync`: ein natuerliches Ende darf den
 * Titel nicht neu starten, erst der naechste Start baut mit der Adresse von
 * heute.
 */
function nachDemStoppNeu(ps, objekt, quelle) {
  const nachholen = () => {
    if (ps.sound !== objekt || objekt.playing) return
    if (objekt.src === leinwandAdresse(quelle)) return
    try { ps.sound = ps._createSound() } catch (_) { /* bleibt das alte, wie ohne diesen Haken */ }
  }
  try {
    objekt.addEventListener("stop", nachholen, { once: true })
    objekt.addEventListener("end", nachholen, { once: true })
  } catch (_) { /* ein Klang ohne diese Ereignisse bleibt wie er ist */ }
}

/**
 * Bringt EINEN Playlist-Klang auf die Adresse von heute.
 *
 * @returns {Promise<string>} der Ausgang: `unberuehrt`, `ohne-klang`, `laeuft`,
 *   `gleich` oder `neu`
 */
export async function klangNachziehen(ps) {
  const quelle = String(ps?._source?.path ?? "")
  if (!quelle.startsWith(PRAEFIX)) return "unberuehrt"
  if (!ps.sound) return "ohne-klang"

  /*
   * LAEDT ER GERADE, ERST DAS LADEN ABWARTEN. Ein Ersatz waehrend des Ladens
   * liesse das alte Objekt als Waisen zurueck: `stop()` greift erst bei
   * STARTING oder PLAYING, und ein Objekt, das danach mit der alten Adresse
   * doch noch losspielt, waere vom Bedienknopf aus nicht mehr erreichbar und
   * schnitte mit seinem `end` den neuen Titel ab. Ein zweiter `load()` wartet
   * auf das laufende Laden (`sound.mjs` :344-347) und startet selbst nichts.
   */
  const objekt = ps.sound
  if (objekt._state === zustandLaden()) {
    try { await objekt.load() } catch (_) { /* gescheitert ist hier ein Ergebnis */ }
    // Hat Foundry den Klang waehrenddessen selbst neu gebaut (Aenderung von
    // `path` oder `channel`), gilt die Entscheidung fuer das neue Objekt.
    if (ps.sound !== objekt) return klangNachziehen(ps)
  }
  if (objekt.playing) {
    nachDemStoppNeu(ps, objekt, quelle)
    return "laeuft"
  }

  const soll = leinwandAdresse(quelle)
  if (ps.sound.src === soll) return "gleich"

  /*
   * Das vorbereitete Feld nachziehen, falls dieser Haken vor dem der Leinwand
   * laeuft. `_createSound` liest `this.path`, nicht die Quelle.
   */
  if (ps.path !== soll) ps.reset()

  // Kein eigener Zweig fuer gesperrtes Audio: ein vorhandenes `ps.sound` gibt
  // es erst nach dem Entsperren, und `locked` wird nie zurueckgesetzt.
  ps.sound = ps._createSound()
  ps.sync()
  return "neu"
}

/**
 * Alle Playlist-Klaenge der Welt, je Klang einzeln gefangen.
 *
 * @returns {Promise<Record<string, number>>} je Ausgang die Zahl
 */
export async function klaengeNachziehen() {
  const zahl = {}
  for (const pl of game.playlists ?? []) {
    for (const ps of pl?.sounds ?? []) {
      let ausgang
      try { ausgang = await klangNachziehen(ps) }
      catch (e) {
        ausgang = "fehler"
        console.warn("Beneos Stream | Klang nach dem Schluesselwechsel nicht neu aufgebaut:", e?.message || e)
      }
      zahl[ausgang] = (zahl[ausgang] || 0) + 1
    }
  }
  if (zahl.neu) console.log(`Beneos Stream | ${zahl.neu} Klang/Klaenge nach dem Schluesselwechsel neu aufgebaut`)
  return zahl
}

/**
 * Setzt den Haken einmal. Aufzurufen NACH `installStreamLeinwand()`, damit die
 * vorbereiteten Felder schon die Adresse von heute tragen; `klangNachziehen`
 * zieht sie zur Sicherheit selbst nach.
 */
export function installStreamKlang() {
  if (hakenGesetzt) return
  hakenGesetzt = true
  const nachWechsel = (setting) => {
    if (!EINSTELLUNGEN.has(setting?.key)) return
    return klaengeNachziehen().catch((e) => {
      console.warn("Beneos Stream | Klangneubau gescheitert:", e?.message || e)
    })
  }
  Hooks.on("createSetting", nachWechsel)
  Hooks.on("updateSetting", nachWechsel)
}
