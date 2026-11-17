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
 *
 * SZENENKLAENGE (stre-T-123). Ein AmbientSound hat dasselbe Muster, gemessen am
 * 17.11.2026 in v14 und v13: nach dem Wechsel dasselbe Objekt, gescheitert,
 * stumm bis zum Neuzeichnen der Szene. In 13.351 und 14.367 gleich,
 * `client/canvas/placeables/sound.mjs`:
 *
 * - `sync` v13 :169/:181, v14 :196/:208 baut einmal (`this.sound ||=`) und
 *   steigt bei `!sound.loaded` aus (v13 :191-192, v14 :218-219).
 * - Neu gebaut wird nur in `_onUpdate` bei `path` (v13 :414-420, v14 :491-497).
 * - `_createSound` (v13 :76-79, v14 :94-97) teilt das Objekt ueber den Cache
 *   in `AudioHelper.create` (`client/audio/helper.mjs:189-199`), nach `src`.
 *
 * Nur die Placeables der angezeigten Szene: andere Szenen haben keine und
 * bauen beim Zeichnen aus dem frisch vorbereiteten `document.path`. Kein
 * `canvas.draw()`, das zeichnete die ganze Szene neu.
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
 *
 * Fuer Szenenklaenge gilt dasselbe, gemessen am 17.11.2026 in v14: ein Ersatz
 * mit Stopp setzt rund 150 ms aus (plus Ladezeit beim Kunden), ein Ersatz ohne
 * Stopp laesst das alte Objekt als Waise weiterspielen, auch ueber einen
 * Szenenwechsel. Sie hoeren nur auf `stop`: `end` kommt bei `loop: true` nie.
 *
 * Entschieden wird einen Takt NACH dem Ereignis (Kalt-Review 17.11.2026,
 * Befund 3): beim Loeschen stoppt Foundry zuerst und zerstoert erst danach
 * (v14 `placeables/sound.mjs:519-523`), beim Pfadwechsel stoppt es und baut
 * dann selbst neu (:495-498). Verglichen wird mit der Adresse zum Zeitpunkt
 * des Stopps, nicht des ersten Wechsels (Befund 2: A, B, zurueck auf A).
 *
 * @param {object} objekt das laufende Klangobjekt
 * @param {object} weg
 * @param {string[]} weg.ereignisse worauf gewartet wird
 * @param {() => boolean} weg.zustaendig ob das Objekt noch das des Klangs ist
 * @param {string} weg.quelle die schluesselfreie Quelle des Klangs
 * @param {() => void} weg.ersetze baut das neue Objekt, ohne es zu starten
 */
function nachDemStoppNeu(objekt, { ereignisse, zustaendig, quelle, ersetze }) {
  const entscheide = () => {
    if (!zustaendig() || objekt.playing) return
    if (objekt.src === leinwandAdresse(quelle)) return
    try { ersetze() } catch (_) { /* bleibt das alte, wie ohne diesen Haken */ }
  }
  const nachholen = () => { setTimeout(entscheide, 0) }
  try {
    for (const typ of ereignisse) objekt.addEventListener(typ, nachholen, { once: true })
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
   * auf das laufende Laden (`sound.mjs` :344-347) und spielt nichts ab. Ist
   * das erste Laden gescheitert, laedt er allerdings noch einmal mit der alten
   * Adresse (v14 :344-361): eine weitere abgewiesene Anfrage, danach steht er
   * wieder auf FAILED und wird unten ersetzt.
   */
  const objekt = ps.sound
  if (objekt._state === zustandLaden()) {
    try { await objekt.load() } catch (_) { /* gescheitert ist hier ein Ergebnis */ }
    // Hat Foundry den Klang waehrenddessen selbst neu gebaut (Aenderung von
    // `path` oder `channel`), gilt die Entscheidung fuer das neue Objekt.
    if (ps.sound !== objekt) return klangNachziehen(ps)
  }
  if (objekt.playing) {
    nachDemStoppNeu(objekt, {
      ereignisse: ["stop", "end"],
      zustaendig: () => ps.sound === objekt,
      quelle,
      ersetze: () => { ps.sound = ps._createSound() },
    })
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
 * Bringt EINEN Szenenklang (AmbientSound-Placeable) auf die Adresse von heute.
 * Dieselben Ausgaenge wie `klangNachziehen`; gestartet wird hier nichts, das
 * tut der eine `refresh` in `szenenklaengeNachziehen`.
 *
 * @returns {Promise<string>} `unberuehrt`, `ohne-klang`, `laeuft`, `gleich` oder `neu`
 */
export async function szenenklangNachziehen(pl) {
  const quelle = String(pl?.document?._source?.path ?? "")
  if (!quelle.startsWith(PRAEFIX) || pl.destroyed) return "unberuehrt"
  if (!pl.sound) return "ohne-klang"

  // Wie oben: erst das laufende Laden abwarten, dann fuer das Objekt
  // entscheiden, das danach am Placeable haengt.
  const objekt = pl.sound
  if (objekt._state === zustandLaden()) {
    try { await objekt.load() } catch (_) { /* gescheitert ist hier ein Ergebnis */ }
    // Abgebaut, waehrend gewartet wurde: Foundry laesst `sound` am zerstoerten
    // Placeable haengen (Kalt-Review 17.11.2026, Befund 1).
    if (pl.destroyed || pl.sound !== objekt) return szenenklangNachziehen(pl)
  }

  // Beim Abbau der Szene kommt `stop` erst, wenn das Placeable schon zerstoert
  // ist (`layers/sounds.mjs` `_tearDown` ruft `stopAll()` ohne `await`). Dann
  // wird nichts mehr gebaut.
  if (objekt.playing) {
    nachDemStoppNeu(objekt, {
      ereignisse: ["stop"],
      zustaendig: () => !pl.destroyed && pl.sound === objekt,
      quelle,
      // `_manager` hat Foundry vor dem Stopp schon geloest (v13 :174, v14 :201).
      ersetze: () => { pl.sound = pl._createSound() },
    })
    return "laeuft"
  }

  const soll = leinwandAdresse(quelle)
  if (objekt.src === soll) return "gleich"

  if (pl.document.path !== soll) pl.document.reset()
  // Ohne das hielte das alte Objekt die Zustaendigkeit, und `sync` luede ein
  // geteiltes Objekt nie wieder (`requireLoad = !loaded && !_manager`).
  objekt._manager = null
  pl.sound = pl._createSound()
  return "neu"
}

/**
 * Alle Szenenklaenge der angezeigten Szene, nebeneinander und je Placeable
 * einzeln gefangen. Jeder Neubau loest sofort einen `refresh` aus, damit die
 * hoerbaren mit der neuen Adresse laden. Ein ladender Szenenklang haelt so die
 * anderen nicht auf (Kalt-Review 17.11.2026, offene Frage 1); `refresh`
 * gleicht alle Hoerer ab und darf mehrfach laufen.
 *
 * @returns {Promise<Record<string, number>>} je Ausgang die Zahl
 */
export async function szenenklaengeNachziehen() {
  const ebene = globalThis.canvas?.sounds
  const zahl = {}
  const einer = async (pl) => {
    let ausgang
    try { ausgang = await szenenklangNachziehen(pl) }
    catch (e) {
      ausgang = "fehler"
      console.warn("Beneos Stream | Szenenklang nach dem Schluesselwechsel nicht neu aufgebaut:", e?.message || e)
    }
    zahl[ausgang] = (zahl[ausgang] || 0) + 1
    if (ausgang !== "neu") return
    // Gemessen am 17.11.2026 in v13: `refresh` direkt nach einem Neuzeichnen
    // warf "reading 'refresh'". Der Neubau ist dann trotzdem geschehen, der
    // naechste Abgleich der Hoerer spielt ihn ab.
    try { ebene.refresh() }
    catch (e) { console.warn("Beneos Stream | Szenenklaenge nicht abgeglichen:", e?.message || e) }
  }
  await Promise.all([...(ebene?.placeables ?? [])].map(einer))
  if (zahl.neu) console.log(`Beneos Stream | ${zahl.neu} Szenenklang/Szenenklaenge nach dem Schluesselwechsel neu aufgebaut`)
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
  const gescheitert = (e) => { console.warn("Beneos Stream | Klangneubau gescheitert:", e?.message || e) }
  const nachWechsel = (setting) => {
    if (!EINSTELLUNGEN.has(setting?.key)) return
    // Nebeneinander: ein ladender Playlist-Titel haelt die Szenenklaenge nicht
    // auf (kalter Planleser 17.11.2026, Befund 6). Jeder Weg faengt selbst.
    return Promise.all([
      klaengeNachziehen().catch(gescheitert),
      szenenklaengeNachziehen().catch(gescheitert),
    ])
  }
  Hooks.on("createSetting", nachWechsel)
  Hooks.on("updateSetting", nachWechsel)
}
