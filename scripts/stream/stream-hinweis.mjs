/**
 * stream-hinweis.mjs
 *
 * Sagt dem Kunden in Worten, warum ein gestreamter Inhalt fehlt (stre-T-165,
 * stre-T-166).
 *
 * WARUM. Fehlt die Verbindung oder enthaelt der Zugang einen Inhalt nicht,
 * bekommen Token, Journal und Karten ein Ersatzbild und Klaenge bleiben stumm.
 * Bis hierher stand der Grund nur in der Konsole (`meldeAbweisung`,
 * `meldeOffline` in stream-fetch.mjs), und sichtbar war allein der
 * Video-Hinweis aus OP-PRJ-186. Ein Kunde mit einer Standbildkarte und stummer
 * Playlist hielt das Modul fuer defekt.
 *
 * WIE. Je Sitzung und Grund (`offline`, `denied`) genau EINE Foundry-Meldung.
 * Dazu ein Schild oben im Bedienfeld, solange die angezeigte Szene einen
 * abgewiesenen Inhalt hat. Betreiberentscheid ueber orch-stre-1 (R1 zu T-165):
 *
 * - E1: der Link des Schildes fuehrt auf die Bibliotheksseite des Shops. Er
 *   steht hier als Konstante und nicht in einem Sprachwert, damit ihn eine
 *   Uebersetzung nicht verstellen kann.
 * - E2: das Schild sehen alle Clients, denn auch der Mitspieler sieht die
 *   unvollstaendige Karte. Die Meldung "nicht im Zugang" bekommt nur die
 *   Spielleitung: am Zugang kann nur sie etwas aendern. Die Meldung "offline"
 *   bekommt jeder Client, denn die Verbindung ist die des eigenen Rechners.
 * - E3: der Video-Hinweis bleibt unveraendert. Kam er in dieser Sitzung schon,
 *   entfaellt die allgemeine Meldung "nicht im Zugang", sie sagte dasselbe
 *   ein zweites Mal.
 *
 * Diese Datei importiert stream-online.mjs, nie umgekehrt: die Szenen- und die
 * Klangwache dort holen sie mit `import()` zur Laufzeit, wie sie es mit
 * stream-fetch.mjs schon tun. Ein Gegenimport waere ein Zirkelbezug.
 */

import { streamAdressenVon, isOffline } from "./stream-online.mjs"

export const ZUGANG_SEITE = "https://beneos-battlemaps.com/pages/my-library"
export const SCHILD_ID = "beneos-stream-kartenschild"

// Je Grund der Schluessel und der englische Rueckfall fuer den Fall, dass
// `game.i18n` noch nicht steht. Dieselbe Form wie `ERSATZ_VIDEO` in
// stream-fetch.mjs.
const MELDUNG = {
  offline: ["BENEOS.Stream.Notice.Offline",
    "Beneos Stream: there is no connection to the server. Streamed maps, tokens, journals and sounds show a placeholder or stay silent until it is back."],
  denied: ["BENEOS.Stream.Notice.Denied",
    "Beneos Stream: some content in this world is not part of your access. It shows a placeholder or stays silent."],
}
const SCHILD_TEXT = ["BENEOS.Stream.Notice.MapDenied", "This map cannot load fully. Your access does not include it."]
const SCHILD_LINK = ["BENEOS.Stream.Notice.MapLink", "Check your access"]

/**
 * Der uebersetzte Text, sonst der englische Rueckfall. `daten` fuellt `{name}`.
 *
 * Die Reihenfolge Schluessel, Daten, Rueckfall ist Absicht: in der Form
 * `hinweisText("K", { name })` erkennt die Sprachwache
 * (tools/stream-sprachen-bench) den Aufrufer, der den Platzhalter fuellt.
 */
export function hinweisText(schluessel, daten, rueckfall) {
  try {
    const i18n = globalThis.game?.i18n
    const t = daten ? i18n?.format?.(schluessel, daten) : i18n?.localize?.(schluessel)
    if (t && t !== schluessel) return t
  } catch (_) { /* faellt auf den Rueckfall zurueck */ }
  return daten ? rueckfall.replace(/\{(\w+)\}/g, (_, k) => String(daten[k] ?? "")) : rueckfall
}

const gemeldet = new Set()
let videoHinweisKam = false
// Abgewiesene Adressen dieser Sitzung, ohne Abfrage. Das Schild fragt sie bei
// jedem Szenenaufbau, denn der Vorrat nimmt das Ersatzbild nicht auf und die
// Abweisung kommt beim naechsten Aufbau erneut, aber vielleicht erst nach
// `canvasReady`.
const abgewiesen = new Set()

const ohneAbfrage = (u) => String(u || "").split("?")[0]

/** Ruft `meldeVideoAbweisung` in stream-fetch.mjs, sobald sie gewarnt hat (E3). */
export function merkeVideoToast() {
  videoHinweisKam = true
}

/**
 * Ein Inhalt fehlt aus `grund`. Gibt zurueck, ob eine Meldung erschien.
 */
export function meldeAusfall(grund, url) {
  if (!MELDUNG[grund]) return false
  if (grund === "denied") {
    const adresse = ohneAbfrage(url)
    if (adresse) {
      abgewiesen.add(adresse)
      pruefeSchild()
    }
  }
  if (gemeldet.has(grund)) return false
  if (grund === "denied") {
    if (!globalThis.game?.user?.isGM) return false
    if (videoHinweisKam) {
      gemeldet.add(grund)
      return false
    }
  }
  gemeldet.add(grund)
  try { globalThis.ui?.notifications?.warn?.(hinweisText(MELDUNG[grund][0], null, MELDUNG[grund][1])) } catch (_) { /* ohne Oberflaeche bleibt die Konsolenzeile */ }
  return true
}

/** Hat diese Szene einen Inhalt, den das Tor in dieser Sitzung abgewiesen hat? */
export function schildNoetig(scene) {
  if (!scene || abgewiesen.size === 0) return false
  try {
    return streamAdressenVon(scene).some((a) => abgewiesen.has(ohneAbfrage(a)))
  } catch (_) {
    return false
  }
}

export function pruefeSchild() {
  if (!schildNoetig(globalThis.canvas?.scene)) return null
  return zeigeSchild()
}

/**
 * Das Schild ist ein Element im Bedienfeld und kein PIXI-Abzeichen: das
 * Ladeabzeichen in stream-canvas.mjs nimmt keine Eingabe an (`eventMode
 * "none"`), ein Link darin waere nicht klickbar. Es steht unter `#ui-top`,
 * oben links ueber der Karte; fehlt das, unter `body`.
 */
export function zeigeSchild() {
  const doc = globalThis.document
  if (!doc?.createElement) return null
  entferneSchild()
  const el = doc.createElement("div")
  el.id = SCHILD_ID
  el.className = "beneos-stream-kartenschild"
  el.setAttribute("role", "status")
  const satz = doc.createElement("span")
  satz.textContent = hinweisText(SCHILD_TEXT[0], null, SCHILD_TEXT[1])
  el.append(satz)
  // Nur mit Verbindung: ohne sie oeffnet der Link nichts.
  if (!isOffline()) {
    const a = doc.createElement("a")
    a.href = ZUGANG_SEITE
    a.target = "_blank"
    a.rel = "noopener"
    a.textContent = hinweisText(SCHILD_LINK[0], null, SCHILD_LINK[1])
    el.append(a)
  }
  const ziel = doc.getElementById?.("ui-top") ?? doc.body
  if (!ziel?.append) return null
  ziel.append(el)
  return el
}

export function entferneSchild() {
  try { globalThis.document?.getElementById?.(SCHILD_ID)?.remove?.() } catch (_) { /* nichts zu entfernen */ }
}

let eingebaut = false
export function installStreamHinweis() {
  if (eingebaut) return
  eingebaut = true
  globalThis.Hooks?.on?.("canvasTearDown", entferneSchild)
  globalThis.Hooks?.on?.("canvasReady", pruefeSchild)
}
