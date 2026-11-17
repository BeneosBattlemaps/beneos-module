/**
 * stream-export.mjs - kein Schluessel in einem Export, und beim Hereinkommen
 * die Toradresse zurueck unter fremde Flags (stre-T-134, Weg A).
 *
 * WARUM. Seit stre-T-128 tragen Werte unter dem Flag eines fremden Moduls die
 * Toradresse mit dem Streamschluessel, weil etwa monks-active-tiles sein
 * `audiofile` roh spielt. Jeder Export trug diesen Schluessel mit hinaus: die
 * JSON-Datei, das Kompendium, das Abenteuer. Wer die Datei weitergab, gab den
 * Zugang mit.
 *
 * DER TRICHTER. Foundry 13 baut jeden clientseitigen Export ueber
 * `ClientDocument#toCompendium` (client-document.mjs:1122): `exportToJSON`,
 * `CompendiumCollection#importDocument`, das Ziehen ins Kompendium, den
 * Ordnerexport und den Abenteuerexport (adventure-exporter.mjs:315, dort mit
 * `clearFlags: false`). Einen Haken gibt es dort nicht, also wird die Methode
 * an jeder Dokumentklasse aus `CONFIG` gewickelt. Die Huelle ruft zuerst, was
 * vorher dort stand, und bearbeitet danach das Ergebnis. So bleibt sie mit den
 * Huellen anderer Module vertraeglich, vor wie nach ihr.
 *
 * DIE WANDLUNG, auf dem Ergebnis und nie auf `_source`. `toCompendium` gibt
 * ein frisches `toObject()` zurueck; die Welt behaelt, was sie hatte, und
 * spielt wie vorher.
 *   1. Eigenes HTML: jedes Bild mit Toradresse wird Form (a), wie beim
 *      Speichern (`htmlTiefSchluesselfrei`).
 *   2. Jede Toradresse, ganz oder mitten im Text, auch unter fremden Flags,
 *      wird `beneos://` (`schluesselfreiAdresse`). Unter fremden Flags heilt
 *      der Import sie zurueck, siehe unten.
 *   3. Eine Toradresse, die sich nicht rundlaufend wandeln laesst, oder eine
 *      unter einem frueheren Tor der Zone verliert ihr Schluesselstueck: `-`.
 *      Sie ist danach tot statt undicht.
 *   4. Steht der Schluessel von heute danach noch irgendwo, roh oder als
 *      `encodeURIComponent`, wird er `-`.
 * Wirft die Wandlung, wirft der Export. Ein Rohergebnis truege den Schluessel.
 *
 * DAS HEILEN. Ein Import legt die Daten mit `beneos://` unter fremden Flags an.
 * Die Spielleitung, die ihn ausgeloest hat, schreibt dort die Toradresse mit
 * ihrem Schluessel zurueck, ueber `flaggenAenderung` aus
 * `stream-fremdflaggen.mjs`. Gehoert wird auf `create<Art>` und
 * `update<Art>`: diese Haken ruft Foundry auch bei `noHook`
 * (client-backend.mjs:146 und :299), und genau so schreiben `importFromJSON`
 * (client-document.mjs:1066) und der Abenteuerimport (adventure.mjs:166-169).
 * Eingebettete Dokumente, die mit ihrem Elternteil kommen, feuern keinen
 * eigenen Haken; das Elternteil heilt sie mit. Damit heilen auch die stummen
 * Importe aus der Zeit stre-T-102 bis stre-T-128, sobald sie jemand schreibt.
 *
 * Gemeldet wird nie eine Adresse und nie ein Schluessel.
 * Pruefsatz: `stream-export.test.mjs`, Sabotagen im Satz `export`.
 */
import { streamKey, schluesselfreiAdresse, erlaubteBasis, STREAM_RAUM_BUCHSTABE } from "./stream-settings.mjs"
import { htmlTiefSchluesselfrei } from "./stream-html.mjs"
import { flaggenAenderung } from "./stream-fremdflaggen.mjs"

const MARKE = Symbol.for("beneos.stream.export")
const RAEUME = Object.values(STREAM_RAUM_BUCHSTABE).join("|")

/*
 * Eine Adresse mit Raumbuchstabe an erster Stelle, unter jedem Host. Ob sie
 * unsere ist, entscheiden danach `schluesselfreiAdresse` (heutiger Host) und
 * `erlaubteBasis` (Zone). Endet an Leerraum, Anfuehrungszeichen und spitzer
 * Klammer, wie die Textmaske in `stream-report.mjs`.
 */
const TOR_IM_TEXT = new RegExp(`https?://[^/\\s"'<>]+/(?:${RAEUME})/[^\\s"'<>]+`, "gi")
const SCHLUESSELSTUECK = new RegExp(`^(https?://([^/\\s"'<>]+))/(${RAEUME})/([^/\\s"'<>?#]+)`, "i")

/** Das Schluesselstueck einer Toradresse unter einem Host der Zone wird `-`. */
function maskiere(adresse) {
  const t = SCHLUESSELSTUECK.exec(adresse)
  if (!t || t[4] === "-") return adresse
  if (!erlaubteBasis(`https://${t[2]}`)) return adresse
  return `${t[1]}/${t[3]}/-${adresse.slice(t[0].length)}`
}

function wandle(adresse) {
  const frei = schluesselfreiAdresse(adresse)
  return frei !== adresse ? frei : maskiere(adresse)
}

/** Die Formen des heutigen Schluessels, nach denen zuletzt gesucht wird. */
function schluesselFormen() {
  const k = streamKey()
  // Ein sehr kurzer Wert waere als Teilstring auch in gewoehnlichem Text zu
  // finden. Ein echter Schluessel ist laenger; die Masken davor greifen ohnehin.
  if (k.length < 8) return []
  return [...new Set([k, encodeURIComponent(k)])]
}

function textFrei(text, formen) {
  let neu = text
  // Ein ganzer Wert ohne Leerraum geht als eine Adresse durch. Mit Leerraum
  // nicht: `URL` kodierte den Text dahinter in den Pfad.
  if (/^https?:\/\/\S+$/i.test(neu)) neu = wandle(neu)
  neu = neu.replace(TOR_IM_TEXT, wandle)
  for (const form of formen) if (neu.includes(form)) neu = neu.split(form).join("-")
  return neu
}

function tief(wert, formen, tiefe, zahl) {
  if (tiefe > 40 || !wert || typeof wert !== "object") return
  for (const k of Object.keys(wert)) {
    const v = wert[k]
    if (typeof v === "string") {
      const neu = textFrei(v, formen)
      if (neu !== v) { wert[k] = neu; zahl.n++ }
    } else if (v && typeof v === "object") {
      tief(v, formen, tiefe + 1, zahl)
    }
  }
}

/**
 * Macht Exportdaten AN ORT UND STELLE schluesselfrei.
 *
 * @param {object} daten das Ergebnis von `toCompendium`, nie `_source`
 * @returns {number} wie viele Zeichenketten sich geaendert haben
 */
export function exportSchluesselfrei(daten) {
  if (!daten || typeof daten !== "object") return 0
  if (streamKey()) htmlTiefSchluesselfrei(daten)
  const zahl = { n: 0 }
  tief(daten, schluesselFormen(), 0, zahl)
  return zahl.n
}

function wickleExport(proto) {
  if (!proto || Object.hasOwn(proto, MARKE)) return
  const vorher = proto.toCompendium
  if (typeof vorher !== "function") return
  Object.defineProperty(proto, MARKE, { value: true })
  proto.toCompendium = function beneosExport(...args) {
    const daten = vorher.apply(this, args)
    try {
      exportSchluesselfrei(daten)
    } catch (_e) {
      // Ohne Fehlertext: er kann eine Adresse tragen.
      throw new Error("Beneos Stream | Export angehalten, die Daten liessen sich nicht schluesselfrei machen")
    }
    return daten
  }
}

/* ------------------------------------------------------------- Heilen */

const UNTERWEGS = new Set()

function darfHeilen(doc, userId) {
  if (!globalThis.game?.user?.isGM) return false
  if (userId !== globalThis.game.user.id) return false
  if (!streamKey()) return false
  if (!doc || doc.pack || doc.parent?.pack) return false
  return true
}

/**
 * Schreibt unter den fremden Flags eines Dokuments und seiner eingebetteten
 * Dokumente jedes `beneos://` als Toradresse zurueck. Gibt die Zahl der
 * Schreibvorgaenge zurueck.
 */
export async function heile(doc) {
  const quelle = doc.toObject()
  const eingebettet = doc.constructor?.metadata?.embedded ?? {}
  const bericht = { adressen: 0, rest: 0 }
  const eigen = flaggenAenderung(quelle, bericht, new Set(Object.values(eingebettet)))
  let schreibe = 0
  if (eigen) { await doc.update(eigen); schreibe++ }
  for (const [klasse, feld] of Object.entries(eingebettet)) {
    const teile = []
    for (const kind of Array.isArray(quelle[feld]) ? quelle[feld] : []) {
      const a = kind?._id ? flaggenAenderung(kind, bericht) : null
      if (a) teile.push({ ...a, _id: kind._id })
    }
    if (teile.length) { await doc.updateEmbeddedDocuments(klasse, teile); schreibe++ }
  }
  return schreibe
}

async function heileSicher(doc) {
  const wer = `${doc?.documentName ?? "Dokument"} ${doc?.id ?? "?"}`
  // Das eigene Update feuert denselben Haken wieder; es traegt kein
  // `beneos://` mehr und faellt am Vorfilter. Die Menge haelt nur einen
  // gleichzeitigen zweiten Lauf am selben Dokument fern.
  if (UNTERWEGS.has(doc)) return 0
  UNTERWEGS.add(doc)
  try {
    return await heile(doc)
  } catch (_e) {
    console.warn(`Beneos Stream | Import: fremde Flags von ${wer} nicht geheilt`)
    return 0
  } finally {
    UNTERWEGS.delete(doc)
  }
}

const traegtPlatzhalter = (wert) => {
  try { return JSON.stringify(wert ?? null).toLowerCase().includes("beneos://") } catch (_e) { return false }
}

/**
 * Wickelt `toCompendium` an jeder Dokumentklasse aus `CONFIG` und setzt die
 * Haken fuer das Heilen. Unbedingt eingebaut, die Behandler pruefen den
 * Schluessel selbst, wie Leinwand und Schreibnetz.
 */
const BEHORCHT = new Set()

export function installStreamExport() {
  const config = globalThis.CONFIG ?? {}
  for (const art of Object.keys(config)) {
    const klasse = config[art]?.documentClass
    if (typeof klasse !== "function") continue
    wickleExport(klasse.prototype)
    // Ein zweiter Einbau setzt keinen Haken doppelt; sonst heilte jedes
    // Dokument zweimal.
    if (BEHORCHT.has(art)) continue
    BEHORCHT.add(art)
    globalThis.Hooks.on(`create${art}`, (doc, _optionen, userId) => {
      if (!darfHeilen(doc, userId) || !traegtPlatzhalter(doc.toObject?.())) return undefined
      return heileSicher(doc)
    })
    globalThis.Hooks.on(`update${art}`, (doc, aenderung, _optionen, userId) => {
      if (!darfHeilen(doc, userId) || !traegtPlatzhalter(aenderung)) return undefined
      return heileSicher(doc)
    })
  }
}
