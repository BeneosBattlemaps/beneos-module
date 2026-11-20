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
 * - E1 (Betreiber-Nachtrag, ersetzt den Link auf die Bibliothek): das Schild
 *   sagt "nicht berechtigt", nie "Mitgliedschaft reicht nicht", denn eine
 *   Karte ist auch kaufbar. Nur mit Verbindung traegt es zwei Links: Buy auf
 *   das Shopprodukt aus `list_releases` (shop_url, dieselbe Quelle und
 *   dieselbe Deutung wie der Kaufknopf im Cloud-Fenster) und Subscribe auf das
 *   passende Patreon. Ohne bekanntes Produkt erscheint nur Subscribe. Die
 *   Adressen stehen hier als Konstanten und nicht in einem Sprachwert, damit
 *   eine Uebersetzung sie nicht verstellen kann. Offline erscheint das Schild
 *   gar nicht: dort fehlt die Verbindung, nicht die Berechtigung.
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

import { streamAdressenVon, isOffline, onStreamState } from "./stream-online.mjs"
import { kaufKnopf } from "../cloud-v2/cloud-kaufknopf.mjs"

// Fundorte: cloud database-manager.php:21420 ff. und js/codex/codex-standalone.js:1276
export const PATREON_KARTEN = "https://www.patreon.com/c/BeneosBattlemaps"
export const PATREON_TOKEN = "https://www.patreon.com/c/BeneosTokens"
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
const SCHILD_TEXT = ["BENEOS.Stream.Notice.MapDenied", "You are not entitled to view this map."]
const SCHILD_ABO = ["BENEOS.Stream.Notice.MapSubscribe", "Subscribe"]
// Dieselben Schluessel wie der Kaufknopf im Cloud-Fenster (results-pane.hbs).
const KAUF_PACK = ["BENEOS.Cloud.Card.BuyPack", "Buy pack"]
const KAUF_BUNDLE = ["BENEOS.Cloud.Card.BuyBundle", "Buy bundle"]

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
// Waehrend eine Szene aufgebaut wird, wartet die allgemeine Meldung "nicht im
// Zugang". Gemessen im Foundry-Test auf 30003 (20.11.2026): ein Bild der Szene
// wurde vor dem Video abgewiesen, und der GM bekam beide Meldungen, obwohl E3
// genau das ausschliesst. Zweite Messung am selben Tag, Kaltstart: die Videos
// laedt fillInVideos (stream-canvas.mjs) erst NACH canvasReady, der
// Video-Hinweis kam 745 ms danach. Der Aufbau endet deshalb nicht bei
// canvasReady, sondern wenn das Nachladen der Videos durch ist (aufbauEnde).
let szeneLaedt = false
let denieWartet = false
// Zaehlt die Aufbauten, damit das Nachladen eines abgeloesten Aufbaus das
// Warten des neuen nicht beendet.
let aufbau = 0
// Scheitert der Aufbau und canvasReady kommt nie, meldet der Zeitgeber.
const WARTEN_HOECHSTENS_MS = 20000
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
    if (szeneLaedt) {
      if (!denieWartet) {
        denieWartet = true
        const t = setTimeout(meldeWartendes, WARTEN_HOECHSTENS_MS)
        t?.unref?.()
      }
      return false
    }
  }
  return warne(grund)
}

function warne(grund) {
  gemeldet.add(grund)
  try { globalThis.ui?.notifications?.warn?.(hinweisText(MELDUNG[grund][0], null, MELDUNG[grund][1])) } catch (_) { /* ohne Oberflaeche bleibt die Konsolenzeile */ }
  return true
}

/**
 * Gibt die wartende Meldung "nicht im Zugang" aus, wenn der Video-Hinweis sie
 * inzwischen nicht ersetzt hat. Laeuft bei canvasReady und als Rueckfall nach
 * WARTEN_HOECHSTENS_MS.
 */
export function meldeWartendes() {
  if (!denieWartet) return false
  denieWartet = false
  if (gemeldet.has("denied")) return false
  if (videoHinweisKam) {
    gemeldet.add("denied")
    return false
  }
  return warne("denied")
}

/**
 * Fuer den canvasReady-Behandler in stream-canvas.mjs: liefert die Funktion,
 * die den Aufbau beendet, sobald das Nachladen der Videos durch ist. Sie wirkt
 * nur, solange kein neuer Aufbau begonnen hat.
 */
export function aufbauEnde() {
  const n = aufbau
  return () => {
    if (n !== aufbau) return
    szeneLaedt = false
    meldeWartendes()
  }
}

/** Die erste Adresse dieser Szene, die das Tor in dieser Sitzung abgewiesen hat. */
function schildAdresse(scene) {
  if (!scene || abgewiesen.size === 0) return null
  try {
    return streamAdressenVon(scene).find((a) => abgewiesen.has(ohneAbfrage(a))) ?? null
  } catch (_) {
    return null
  }
}

/** Hat diese Szene einen Inhalt, den das Tor in dieser Sitzung abgewiesen hat? */
export function schildNoetig(scene) {
  return schildAdresse(scene) !== null
}

/**
 * Stellt das Schild nach dem Sollzustand: da, wenn die angezeigte Szene eine
 * abgewiesene Adresse hat und eine Verbindung besteht, sonst weg. Der Abbau
 * gehoert dazu (Kalt-Review a9acf9e): eine Abweisung, die waehrend des
 * Szenenwechsels noch der alten Szene galt, liess das Schild sonst auf der
 * neuen stehen.
 */
export function pruefeSchild() {
  const adresse = isOffline() ? null : schildAdresse(globalThis.canvas?.scene)
  if (!adresse) {
    entferneSchild()
    return null
  }
  return zeigeSchild(adresse)
}

// Eine Streamadresse ist `<tor>/<art>/<schluessel>/<ordner>/...`; das Tor kann
// unter einem Unterpfad liegen, deshalb wird die Art gesucht, nicht gezaehlt.
// `a` sind Karten und ihre Dateien, `c` Kreaturen.
const STREAM_PFAD = /\/(a|c)\/[^/?#]+\/([^/?#]+)/

/** Kreaturen fuehren auf das Patreon der Token, alles andere auf das der Karten. */
export function patreonFuer(adresse) {
  return STREAM_PFAD.exec(String(adresse || ""))?.[1] === "c" ? PATREON_TOKEN : PATREON_KARTEN
}

/** Der Releaseordner einer Kartenadresse, sonst "". */
export function releaseVon(adresse) {
  const m = STREAM_PFAD.exec(String(adresse || ""))
  return m?.[1] === "a" ? m[2] : ""
}

/**
 * Der Kaufindex aus der Releaseliste der Cloud. Erst genau ueber
 * `release_dir` (getrimmt wie im Cloud-Fenster), dann ueber den Kern. Anders
 * als das Fenster gewinnt bei gleichem Kern NICHT der neuere Eintrag: ein
 * mehrdeutiger Kern gibt keinen Kauflink, denn ein falscher Kauflink ist
 * schlechter als keiner (Auflage orch-stre-1 zu Weg A).
 */
export function kaufIndexAus(liste, kern) {
  const genau = new Map()
  const kerne = new Map()
  for (const r of Array.isArray(liste) ? liste : []) {
    const dir = String(r?.release_dir || "").trim()
    if (!dir) continue
    if (!genau.has(dir)) genau.set(dir, r)
    const k = kern(dir)
    if (!k) continue
    kerne.set(k, kerne.has(k) ? null : r)
  }
  return { genau, kerne, kern }
}

/** `{ url, isBundle }` wie `kaufKnopf`; `url` null, wenn nichts eindeutig passt. */
export function kaufFuer(index, release) {
  if (!index || !release) return { url: null, isBundle: false }
  const r = index.genau.get(release) ?? index.kerne.get(index.kern(release)) ?? null
  return kaufKnopf(r)
}

let kaufLaden = null
/**
 * Holt die Releaseliste hoechstens einmal je Sitzung, und erst, wenn ein Schild
 * sie braucht. Scheitert der Abruf oder fehlt der Cloud-Manager, gibt es keinen
 * Kauflink und keinen zweiten Versuch. `kern` reicht der Pruefsatz herein: das
 * Modul mit `releaseKern` laesst sich nur in Foundry laden.
 */
export function ladeKaufIndex({ kern } = {}) {
  if (kaufLaden) return kaufLaden
  kaufLaden = (async () => {
    try {
      const k = kern ?? (await import("../cloud-v2/beneos-install-state.mjs")).releaseKern
      const mgr = globalThis.BeneosScenePacker
      if (typeof mgr?.listReleases !== "function") return null
      return kaufIndexAus(await mgr.listReleases(), k)
    } catch (_) {
      return null
    }
  })()
  return kaufLaden
}

function link(doc, href, [schluessel, rueckfall]) {
  const a = doc.createElement("a")
  a.href = href
  a.target = "_blank"
  a.rel = "noopener"
  a.textContent = hinweisText(schluessel, null, rueckfall)
  return a
}

/** Setzt Buy vor Subscribe, sobald der Kaufindex steht und das Schild noch dasselbe ist. */
function ergaenzeKauf(el, abo, release) {
  if (!release) return
  ladeKaufIndex().then((index) => {
    const doc = globalThis.document
    if (doc?.getElementById?.(SCHILD_ID) !== el || isOffline()) return
    const kauf = kaufFuer(index, release)
    if (!kauf.url) return
    abo.remove()
    el.append(link(doc, kauf.url, kauf.isBundle ? KAUF_BUNDLE : KAUF_PACK), abo)
  }).catch(() => { /* ohne Kauflink bleibt Subscribe */ })
}

/**
 * Das Schild ist ein Element im Bedienfeld und kein PIXI-Abzeichen: das
 * Ladeabzeichen in stream-canvas.mjs nimmt keine Eingabe an (`eventMode
 * "none"`), ein Link darin waere nicht klickbar. Es steht unter `#ui-top`,
 * oben links ueber der Karte; fehlt das, unter `body`.
 */
export function zeigeSchild(adresse = "") {
  const doc = globalThis.document
  if (!doc?.createElement) return null
  entferneSchild()
  // Offline fehlt die Verbindung, nicht die Berechtigung: kein denied-Schild.
  if (isOffline()) return null
  const el = doc.createElement("div")
  el.id = SCHILD_ID
  el.className = "beneos-stream-kartenschild"
  el.setAttribute("role", "status")
  const satz = doc.createElement("span")
  satz.textContent = hinweisText(SCHILD_TEXT[0], null, SCHILD_TEXT[1])
  el.append(satz)
  const abo = link(doc, patreonFuer(adresse), SCHILD_ABO)
  el.append(abo)
  const ziel = doc.getElementById?.("ui-top") ?? doc.body
  if (!ziel?.append) return null
  ziel.append(el)
  ergaenzeKauf(el, abo, releaseVon(adresse))
  return el
}

export function entferneSchild() {
  try { globalThis.document?.getElementById?.(SCHILD_ID)?.remove?.() } catch (_) { /* nichts zu entfernen */ }
}

let eingebaut = false
export function installStreamHinweis() {
  if (eingebaut) return
  eingebaut = true
  globalThis.Hooks?.on?.("canvasInit", () => {
    aufbau++
    szeneLaedt = true
  })
  globalThis.Hooks?.on?.("canvasTearDown", entferneSchild)
  // Die wartende Meldung kommt nicht hier, sondern ueber aufbauEnde, wenn die
  // Videos nachgeladen sind.
  globalThis.Hooks?.on?.("canvasReady", () => pruefeSchild())
  // Faellt die Verbindung, verschwindet das Schild; kommt sie zurueck, steht
  // es wieder mit seinen Links (Kalt-Review a9acf9e, Betreiber-Nachtrag).
  onStreamState(() => pruefeSchild())
}
