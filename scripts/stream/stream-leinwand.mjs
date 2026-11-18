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

import { leinwandAdresse, schluesselfreiAdresse, streamKey, MODULE_ID, SETTING } from "./stream-settings.mjs"

/**
 * Je Dokumentart die Felder, die eine Adresse tragen, als Punktpfad.
 *
 * Jedes Feld, das das Schreibnetz schluesselfrei schreibt, MUSS hier stehen:
 * sonst laedt die Anzeige `beneos://` und das Bild bricht.
 *
 * Die einfachen Bildfelder kamen mit stre-T-142 B1 dazu. Gemessen am
 * 18.11.2026 in `v13Stream` (13.351): alle sind `FilePathField` und nehmen
 * `beneos://` an. Der fruehere Grund, `Item` auszulassen (ein
 * Gegenstandsbild geht in gespeicherte Chatkarten), traegt nicht mehr: das
 * HTML-Netz schreibt `<img>` in Chatnachrichten als Form (a). Effekte und
 * Makros stehen darin, weil sie oft mit `item.img` entstehen; der
 * vorbereitete Wert wanderte sonst mit Schluessel in neue Daten.
 *
 * Bewusst NICHT darin: `Card` (Listen von Seiten, die Punktpfade tragen sie
 * nicht) und `Macro.command` (Code; ein `beneos://` darin braeche den
 * Aufruf). Beide deckt nur der Export (stre-T-142 C).
 */
export const LEINWAND_FELDER = Object.freeze({
  "Tile": ["texture.src"],
  "Token": ["texture.src", "ring.subject.texture"],
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
  "Item": ["img"],
  "ActiveEffect": ["img"],
  "Macro": ["img"],
  "RollTable": ["img"],
  "TableResult": ["img"],
  "User": ["avatar"],
})

/**
 * Schreibt die vorbereiteten Felder eines Dokuments um. Rein, ohne Foundry.
 *
 * @returns {number} wie viele Felder umgeschrieben wurden
 */
export function leinwandFelder(art, doc, felder = LEINWAND_FELDER[art]) {
  if (!felder || !doc || typeof doc !== "object") return 0
  let zahl = 0
  for (const pfad of felder) {
    // Je Feld gefangen: ein Feld, das wirft, darf die folgenden nicht mitnehmen.
    try {
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
    } catch (_) { /* naechstes Feld */ }
  }
  return zahl
}

/**
 * Die Felder, die das Schema der Klasse wirklich fuehrt.
 *
 * Foundry 14 hat `background` und `foreground` aus dem Szenenschema genommen
 * und laesst nur veraltete Getter ohne Setter stehen. Gemessen am 15.11.2026 in
 * `v14Stream` (14.367): jeder Zugriff loggt eine Verfallswarnung, und das
 * Zuweisen an den Getter wirft. Eine Klasse ohne Schema behaelt alle Felder.
 */
function felderImSchema(art, klasse) {
  const felder = LEINWAND_FELDER[art]
  const schema = klasse?.schema
  if (typeof schema?.getField !== "function") return felder
  return felder.filter((pfad) => !!schema.getField(pfad.split(".")[0]))
}

/**
 * Die Felder, die das Schreibnetz beim Speichern prueft: die vorbereiteten und
 * dazu der Prototyp eines Akteurs. Der wird nicht vorbereitet, aber jeder
 * Schreiber, der ihn aus einem Token oder Akteur abschreibt, kann eine
 * Toradresse mitbringen.
 */
const SCHREIB_FELDER = Object.freeze({
  ...LEINWAND_FELDER,
  "Actor": [...LEINWAND_FELDER.Actor, "prototypeToken.texture.src", "prototypeToken.ring.subject.texture"],
})

/**
 * Die eingebetteten Dokumente, die ein Elterndokument in SEINER Aenderung
 * mitschickt, je Feld die Art des Elements.
 *
 * Kalt-Review 16.11.2026, zweiter Leser, Befund 1: die Szenenkonfiguration von
 * Foundry 14 legt die Stufe als `levels: [level]` in `scene.update`
 * (`scene-config.mjs:378`, `:493`), und dabei feuert nur `preUpdateScene`.
 * Ein Netz, das nur die Haken der eingebetteten Art kennt, sieht diese Form
 * nie. Dasselbe gilt fuer eine Szene, die mit Kacheln oder Tokens angelegt
 * wird, und fuer eine Playlist mit ihren Klaengen.
 */
const EINGEBETTET = Object.freeze({
  "Scene": Object.freeze({
    levels: "Level", tiles: "Tile", tokens: "Token", notes: "Note",
    drawings: "Drawing", sounds: "AmbientSound",
  }),
  "Playlist": Object.freeze({ sounds: "PlaylistSound" }),
  // stre-T-142 B1: ein Akteur aus Import oder Kompendium bringt Gegenstaende und
  // Effekte mit, ein Gegenstand seine Effekte. Es feuert nur der Haken des
  // Elterndokuments; das Netz steigt deshalb auch in die zweite Ebene.
  "Actor": Object.freeze({ items: "Item", effects: "ActiveEffect" }),
  "Item": Object.freeze({ effects: "ActiveEffect" }),
  "RollTable": Object.freeze({ results: "TableResult" }),
})

/** Wie tief das Netz in eingebettete Listen steigt; Foundry nutzt zwei Ebenen. */
const EBENEN = 4

/**
 * Wo in einem Aenderungsobjekt der Pfad steht: verschachtelt, flach
 * (`"texture.src"`) oder halb flach (`"prototypeToken.texture": { src }`).
 * Foundry nimmt alle drei Formen an.
 *
 * @returns {[object, string]|null} Behaelter und Schluessel
 */
function stelleIn(obj, teile) {
  if (!obj || typeof obj !== "object") return null
  for (let i = teile.length; i >= 1; i--) {
    const k = teile.slice(0, i).join(".")
    if (!Object.hasOwn(obj, k)) continue
    return i === teile.length ? [obj, k] : stelleIn(obj[k], teile.slice(i))
  }
  return null
}

/**
 * Schreibt in einem Aenderungsobjekt jede Toradresse der Feldliste in die
 * schluesselfreie Form um. Rein, ohne Foundry.
 *
 * @returns {number} wie viele Felder umgeschrieben wurden
 */
export function schreibFelder(aenderung, felder) {
  let zahl = 0
  for (const pfad of felder ?? []) {
    try {
      const stelle = stelleIn(aenderung, pfad.split("."))
      if (!stelle) continue
      const [behaelter, k] = stelle
      const vorher = behaelter[k]
      const nachher = schluesselfreiAdresse(vorher)
      if (nachher !== vorher) {
        behaelter[k] = nachher
        zahl++
      }
    } catch (_) { /* naechstes Feld */ }
  }
  return zahl
}

/**
 * DIE EIGENEN FLAGS, DIE EINE ADRESSE TRAGEN (stre-T-122 A), je Dokumentart
 * der Schluessel unter `flags.beneos-module`.
 *
 * - `Tile.stream`: die Videokachel, `video` und `partner` (`stream-scenes.mjs`,
 *   `marker()`). Die Leser setzen den Schluessel selbst ein
 *   (`leinwandAdresse` in `stream-online.mjs` und `stream-canvas.mjs`).
 * - `Scene.creatureInstaller`: die Kreaturenlade, `art` und
 *   `positions[].texture.src`. Die Positionen gehen beim Platzieren durch das
 *   Token-Netz, die Scheibe waehlt ueber `ersteLokaleAdresse`.
 *
 * Fremde Flags stehen bewusst nicht darin: ein fremdes Modul spielt die
 * Zeichenkette, wie sie dort steht, und braucht die Toradresse (stre-T-128).
 */
export const FLAGGEN_FELDER = Object.freeze({
  "Tile": Object.freeze(["stream"]),
  "Scene": Object.freeze(["creatureInstaller"]),
})

const TIEFE = 40

/** Der innere Wert eines Foundry-14-Operators, oder der Wert selbst. */
function operatorWert(wert) {
  const operator = globalThis.foundry?.data?.operators?.DataFieldOperator
  return typeof operator?.get === "function" ? operator.get(wert) : wert
}

/**
 * Faltet an Ort und Stelle jede Zeichenkette unter `behaelter[k]`, beliebig
 * tief. Ein Operator wird ausgepackt und bleibt stehen.
 */
function falteAlles(behaelter, k, tiefe) {
  if (tiefe > TIEFE) return 0
  const roh = behaelter[k]
  const wert = operatorWert(roh)
  if (typeof wert === "string") {
    const neu = schluesselfreiAdresse(wert)
    if (neu === wert) return 0
    if (wert === roh) behaelter[k] = neu
    else globalThis.foundry.data.operators.DataFieldOperator.set(roh, neu)
    return 1
  }
  if (!wert || typeof wert !== "object") return 0
  let zahl = 0
  for (const kind of Object.keys(wert)) zahl += falteAlles(wert, kind, tiefe + 1)
  return zahl
}

/**
 * Faltet in einem Aenderungsobjekt die eigenen Flaggenfelder der Art, in jeder
 * Form, die Foundry annimmt: verschachtelt, flach
 * (`"flags.beneos-module.stream.video"`) und halb flach. Ein `==` vor einem
 * Segment (ersetzen) zaehlt wie das Segment; ein `-=` (loeschen) traegt keinen
 * Wert und bleibt stehen. Rein, ohne Foundry.
 *
 * @returns {number} wie viele Zeichenketten umgeschrieben wurden
 */
export function schreibFlaggen(aenderung, art) {
  const ziele = (FLAGGEN_FELDER[art] ?? []).map((k) => ["flags", MODULE_ID, k])
  if (!ziele.length) return 0
  let zahl = 0
  const besuche = (obj, pfad, tiefe) => {
    if (tiefe > TIEFE || !obj || typeof obj !== "object" || Array.isArray(obj)) return
    for (const k of Object.keys(obj)) {
      const teile = k.split(".")
      if (teile.some((s) => s.startsWith("-="))) continue
      const neu = [...pfad, ...teile.map((s) => (s.startsWith("==") ? s.slice(2) : s))]
      // Drinnen: ein Ziel ist ganz erreicht, alles darunter wird gefaltet.
      if (ziele.some((z) => z.every((s, i) => neu[i] === s))) { zahl += falteAlles(obj, k, tiefe); continue }
      // Unterwegs: der Pfad ist noch Anfang eines Ziels.
      if (ziele.some((z) => neu.length < z.length && neu.every((s, i) => z[i] === s))) {
        besuche(operatorWert(obj[k]), neu, tiefe + 1)
      }
    }
  }
  try { besuche(aenderung, [], 0) } catch (_) { /* das Speichern geht vor */ }
  return zahl
}

/**
 * Die gefalteten Flaggenwerte eines Quellobjekts, als flache Aenderung
 * `{"flags.beneos-module.<k>": kopie}`; nur was sich aendert. Gearbeitet wird
 * in einer Kopie, die Quelle bleibt unberuehrt. Rein, ohne Foundry.
 */
export function falteWerte(art, daten) {
  const neu = {}
  for (const k of FLAGGEN_FELDER[art] ?? []) {
    try {
      const wert = daten?.flags?.[MODULE_ID]?.[k]
      if (wert == null) continue
      const huelle = { wert: JSON.parse(JSON.stringify(wert)) }
      if (falteAlles(huelle, "wert", 0) > 0) neu[`flags.${MODULE_ID}.${k}`] = huelle.wert
    } catch (_) { /* naechstes Flaggenfeld */ }
  }
  return neu
}

/** Die Einstellungen, aus denen `leinwandAdresse` die Toradresse baut. */
const EINSTELLUNGEN = new Set([SETTING.key, SETTING.base, SETTING.mode].map((s) => `${MODULE_ID}.${s}`))
let hakenGesetzt = false

/** Markiert einen Prototyp, damit ein zweiter Einbau nicht doppelt wickelt. */
const MARKE = Symbol.for("beneos.stream.leinwand")

/**
 * Wickelt `prepareBaseData` der Dokumentklassen aus `CONFIG`.
 *
 * Muss im `init` laufen: die Dokumente werden vor `ready` vorbereitet, und die
 * erste Szene ist gezeichnet, bevor `ready` feuert (gemessen am 22.08.2026,
 * siehe `beneos-stream.mjs`).
 *
 * Eingebaut wird unbedingt, auch bei Modus aus und ohne Schluessel; die
 * Behandler pruefen den Schluessel beim Aufruf. Begruendung in
 * `beneos-stream.mjs` am Einbau.
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
    const felder = felderImSchema(art, klasse)
    Object.defineProperty(proto, MARKE, { value: true })
    proto.prepareBaseData = function beneosLeinwand(...args) {
      const r = vorher?.apply(this, args)
      try { leinwandFelder(art, this, felder) } catch (_) { /* ein Feld darf die Vorbereitung nicht aufhalten */ }
      return r
    }
  }

  /*
   * DER SCHLUESSEL KANN SPAETER KOMMEN ODER WECHSELN, und die Basis auch. Eine
   * Welt, die ihn erst im `ready` bekommt, hat ihre Dokumente ohne ihn
   * vorbereitet, und nach einer Rotation tragen die vorbereiteten Felder den
   * alten. Beides heilt ein erneutes Vorbereiten, und `reset()` tut genau das.
   * Die Basis gehoert dazu: `schluesselfreiAdresse` laesst einen fremden Host
   * stehen, und ein vorbereitetes Feld mit der alten Basis kaeme an einer
   * Schreibstelle samt Schluessel auf die Platte. Die Haken nur einmal.
   */
  if (hakenGesetzt) return
  hakenGesetzt = true
  const neuVorbereiten = (setting) => {
    if (!EINSTELLUNGEN.has(setting?.key)) return
    for (const sammlung of [game.scenes, game.actors, game.playlists, game.items, game.tables, game.macros, game.users]) {
      for (const d of sammlung ?? []) {
        try { d.reset() } catch (_) { /* ein Dokument darf die anderen nicht aufhalten */ }
      }
    }
  }
  Hooks.on("createSetting", neuVorbereiten)
  Hooks.on("updateSetting", neuVorbereiten)

  /*
   * DAS SCHREIBNETZ (Kalt-Review 16.11.2026, Befund 2). Die Vorbereitung legt
   * die Toradresse mit Schluessel in die Felder, und jeder Schreiber, der einen
   * vorbereiteten Wert zurueckschickt, braechte sie auf die Platte. Gemessen am
   * selben Tag in `v14Stream` (14.367, dnd5e 5.3.3): Charakter- und
   * Fahrzeugblatt im Bearbeitungsmodus speichern `img` genau so. Die vier
   * Einzelfaenge an den Schreibstellen des Moduls bleiben als zweite Schicht.
   *
   * Beim Aendern wird das Aenderungsobjekt umgeschrieben, beim Anlegen die
   * Quelle des Dokuments: dort verlangt Foundry `updateSource`, eine Aenderung
   * der Daten wirkte nicht. Ohne Schluessel tut `schluesselfreiAdresse` nichts.
   */
  const felderJe = {}
  for (const art of Object.keys(SCHREIB_FELDER)) {
    const vorbereitet = felderImSchema(art, globalThis.CONFIG?.[art]?.documentClass)
    felderJe[art] = SCHREIB_FELDER[art].filter((p) => vorbereitet.includes(p) || !LEINWAND_FELDER[art].includes(p))
  }
  /*
   * Eine Liste, wie sie im Haken ankommt. Foundry 14 schickt `levels` bei
   * `update({"==levels": [...]})` oder einem ForcedReplacement als Operator
   * (common/data/operators.mjs), gemessen am 16.11.2026 in 14.367 (dritter
   * Kaltleser, F2). `DataFieldOperator.get` gibt das Array darin; die Elemente
   * werden an Ort und Stelle umgeschrieben, der Operator bleibt also stehen.
   */
  const alsListe = (wert) => {
    const operator = globalThis.foundry?.data?.operators?.DataFieldOperator
    const innen = typeof operator?.get === "function" ? operator.get(wert) : wert
    return Array.isArray(innen) ? innen : null
  }
  /*
   * Ein Aenderungs- oder Quellobjekt an Ort und Stelle: die Felder der Art,
   * die eingebetteten Listen (jedes Element mit seiner Art, bis EBENEN tief)
   * und die eigenen Flags. Je Schritt gefangen: das Speichern geht vor.
   */
  const netz = (art, daten, tiefe = 0) => {
    let zahl = 0
    try { zahl += schreibFelder(daten, felderJe[art] ?? []) } catch (_) { /* das Speichern geht vor */ }
    try { zahl += eingebettet(art, daten, tiefe) } catch (_) { /* das Speichern geht vor */ }
    // Die eigenen Flags (stre-T-122 B); fremde bleiben, siehe FLAGGEN_FELDER.
    try { zahl += schreibFlaggen(daten, art) } catch (_) { /* das Speichern geht vor */ }
    return zahl
  }
  // Die Elemente eines eingebetteten Feldes, jedes mit den Feldern seiner Art.
  const eingebettet = (art, daten, tiefe) => {
    if (tiefe >= EBENEN) return 0
    let zahl = 0
    for (const [feld, kind] of Object.entries(EINGEBETTET[art] ?? {})) {
      const liste = alsListe(daten?.[feld])
      if (!liste) continue
      for (const element of liste) zahl += netz(kind, element, tiefe + 1)
    }
    return zahl
  }
  // Die Adressfelder eines Quellobjekts, flach kopiert und umgeschrieben; nur
  // was sich aendert, kommt zurueck.
  const geaendert = (quelle, felder) => {
    const kopie = {}
    for (const pfad of felder) {
      const wert = pfad.split(".").reduce((o, t) => o?.[t], quelle)
      if (typeof wert === "string") kopie[pfad] = wert
    }
    schreibFelder(kopie, felder)
    const neu = {}
    for (const [pfad, wert] of Object.entries(kopie)) {
      if (pfad.split(".").reduce((o, t) => o?.[t], quelle) !== wert) neu[pfad] = wert
    }
    return neu
  }
  const verschachtelt = (flach, start = {}) => {
    for (const [pfad, wert] of Object.entries(flach)) {
      const teile = pfad.split(".")
      let ziel = start
      for (const t of teile.slice(0, -1)) ziel = ziel[t] ??= {}
      ziel[teile.at(-1)] = wert
    }
    return start
  }
  /*
   * Die Teilaenderung, die beim Anlegen in `updateSource` geht: die Felder
   * und Flags der Art, dazu je eingebettete Liste nur die geaenderten
   * Elemente, rekursiv bis EBENEN tief.
   */
  const teilFuer = (art, quelle, tiefe) => {
    const neu = { ...geaendert(quelle, felderJe[art] ?? []), ...falteWerte(art, quelle) }
    /*
     * Die eingebetteten Listen: `updateSource` gleicht Elemente ueber ihre
     * `_id` ab und laesst die uebrigen stehen, gemessen am 16.11.2026 in
     * 13.351 und 14.367 (zwei Kacheln, nur eine im Teilobjekt, beide
     * bleiben). Deshalb geht nur das geaenderte Element mit, als
     * `{_id, <feld>}`. Fehlt einem Element die `_id` oder steht eine doppelt
     * in der Liste, waere der Abgleich nicht eindeutig: dann die ganze
     * Liste als Kopie, wie bis zu diesem Stand.
     */
    if (tiefe >= EBENEN) return neu
    for (const [feld, kind] of Object.entries(EINGEBETTET[art] ?? {})) {
      const liste = quelle?.[feld]
      if (!Array.isArray(liste) || liste.length === 0) continue
      const teile = liste.map((element) => teilFuer(kind, element, tiefe + 1))
      if (teile.every((t) => Object.keys(t).length === 0)) continue
      const ids = liste.map((element) => element?._id)
      const eindeutig = ids.every((id) => typeof id === "string" && id) && new Set(ids).size === ids.length
      neu[feld] = eindeutig
        ? teile.flatMap((t, i) => (Object.keys(t).length ? [verschachtelt(t, { _id: ids[i] })] : []))
        : liste.map((element) => { const kopie = JSON.parse(JSON.stringify(element)); netz(kind, kopie, tiefe + 1); return kopie })
    }
    return neu
  }
  for (const art of new Set([...Object.keys(SCHREIB_FELDER), ...Object.keys(EINGEBETTET)])) {
    /*
     * Ohne Schluessel gibt es keine schluesselfreie Form zu schreiben:
     * `schluesselfreiAdresse` liesse jede Adresse stehen. Der fruehe Ausstieg
     * spart das Lesen und Kopieren der Listen (dritter Kaltleser, W1). Am
     * Schluessel und nicht am Modus, wie die Leseseite (Betreiberentscheid
     * 16.11.2026, "Weiter laden").
     */
    Hooks.on(`preUpdate${art}`, (_doc, aenderung) => {
      if (!streamKey()) return
      netz(art, aenderung)
    })
    Hooks.on(`preCreate${art}`, (doc) => {
      if (!streamKey()) return
      try {
        const neu = teilFuer(art, doc?._source, 0)
        if (Object.keys(neu).length > 0) doc.updateSource(neu)
      } catch (_) { /* das Anlegen geht vor */ }
    })
  }
}
