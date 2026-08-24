/**
 * Serving streamed media from the browser's programmable store.
 *
 * Two things had to be measured before this file could be written, and both
 * shaped it (2026-08-11, Foundry 13.351, Chrome 151):
 *
 * A service worker is not usable under Foundry. Registration for the root scope
 * fails with SecurityError because a module can only place files below
 * /modules/, while the game page lives at /game, and Foundry sends no
 * Service-Worker-Allowed header. So the interception happens on window.fetch.
 *
 * That works for video, which PIXI loads through fetch, but NOT for images:
 * with `preferWorkers` on, PIXI decodes them inside a worker thread that has a
 * fetch of its own. The symptom is Foundry's hazard icon and a texture of
 * exactly 512 by 512. Switching the flag off is therefore not a preference, it
 * is the condition for images arriving at all. The cost is image decoding on
 * the main thread.
 *
 * Measured with this in place: a scene rebuilds completely with the connection
 * to the gate cut, video running, 59 frames per second.
 */

import { budgetFor, downloadMode, localCacheEnabled, streamEnabled, streamHost, streamMode } from "./stream-settings.mjs"
import { reportFailure, reportedSoFar } from "./stream-report.mjs"
import { noteResult } from "./stream-online.mjs"

const CACHE_NAME = "beneos-stream-v1"
const TTL_MS = 72 * 60 * 60 * 1000
const STAMP_HEADER = "x-beneos-stored"

/**
 * Every request in flight, so a watchdog can end them all at once.
 *
 * Foundry has no way to do this. A scene draw waits on `Promise.allSettled`
 * over every texture, and nothing in that chain has a timeout, so one transfer
 * that neither completes nor errors parks the draw forever: `canvas.loading`
 * stays true and `Scene#view` then refuses every further scene change for the
 * rest of the session. Aborting turns the stall into an error, and an error is
 * something Foundry survives.
 */
const inFlight = new Set()

export function abortAll(reason = "watchdog") {
  let n = 0
  for (const controller of [...inFlight]) {
    try { controller.abort(reason); n += 1 } catch (_) { /* already gone */ }
  }
  inFlight.clear()
  return n
}

export function inFlightCount() {
  return inFlight.size
}

// How many failures are worth keeping the address of. Past this the counters
// keep counting; only the list stops growing, so a broken release cannot fill
// memory during a session.
const FAILURE_LOG_MAX = 200

let installed = false

/**
 * Haengt der Ersatz wirklich?
 *
 * Gebraucht, weil das Ausbleiben des Einbaus die teuerste Art von Fehler war,
 * die dieser Zweig bisher hatte: nichts stuerzt ab, nichts warnt, die Szene
 * zeichnet sich normal, und nur der Speicher bleibt leer. Wer das nicht
 * abfragen kann, findet es erst, wenn jemand die Eintraege zaehlt.
 */
export function streamFetchInstalled() {
  return installed
}

const counts = {}
const failures = []

function count(reason, url) {
  counts[reason] = (counts[reason] || 0) + 1
  if (reason !== "ok" && url && failures.length < FAILURE_LOG_MAX) {
    failures.push({ reason, url })
  }
}

/**
 * A file that decides rather than one that is shown.
 *
 * The store must pass these through in both directions, and the read side is
 * the half that matters. Lookups use `ignoreSearch`, which is right for assets
 * whose signature rotates in the query, but it makes a cache-busting query on
 * the manifest do nothing at all: on 2026-08-12 a re-published release kept
 * installing from a three-day-old manifest held here, and the write-side guard
 * alone did not help because the stale copy was already in the store.
 */
function isControl(url) {
  return /stream-manifest\.json/i.test(String(url)) || /\/_docs\//i.test(String(url))
}

/** Is this a request for our own delivery gate? */
function ours(url) {
  const host = streamHost()
  if (!host) return false
  try { return new URL(url, location.href).host === host } catch (_) { return false }
}

/**
 * Eine Abweisung des Tors, einmal je Release und Variante gemeldet.
 *
 * Das Tor beantwortet ein fehlendes Recht mit 200 und einem durchsichtigen
 * Pixel, damit Foundry kein Warndreieck ueber die Szene legt und keine
 * Wiederholungslawine ausloest. Sichtbar wird es nur ueber `X-Beneos-Denied`,
 * und deshalb gehoert eine Meldung dazu.
 *
 * Aber nur eine. Gesperrt ist nie eine einzelne Datei, sondern das Release; bei
 * einer Szene mit Overlays waeren das zwanzig gelbe Zeilen fuer einen einzigen
 * Sachverhalt. Ein Foundry-Nutzer, der sein Konsolenlog durchsieht, liest
 * zwanzig gelbe Zeilen als zwanzig Fehler seines Moduls.
 *
 * Der Schluessel ist Release und Variante aus der Adresse, denn genau daran
 * haengt das Recht. Die Zaehlung laeuft trotzdem ueber jede Datei weiter, sie
 * steht in `diagnose()`.
 */
const abgewiesen = new Map()

function meldeAbweisung(url) {
  let schluessel = "unbekannt"
  try {
    const teile = new URL(url, location.href).pathname.split("/").filter(Boolean)
    // /a/<schluessel>/<release>/<variante>/<pfad...>
    if (teile[0] === "a" && teile.length >= 4) schluessel = `${teile[2]}/${teile[3]}`
  } catch (_) { /* Adresse unlesbar, dann eben gesammelt unter "unbekannt" */ }

  const zahl = (abgewiesen.get(schluessel) || 0) + 1
  abgewiesen.set(schluessel, zahl)
  if (zahl > 1) return
  console.warn(`Beneos Stream | Das Tor liefert fuer ${schluessel} kein Material. `
    + "Meist ist die Mitgliedschaft oder die Miete abgelaufen. "
    + "Weitere Dateien desselben Releases werden nicht mehr einzeln gemeldet.")
}

async function openStore() {
  try { return await caches.open(CACHE_NAME) } catch (_) { return null }
}

function stamped(response) {
  const headers = new Headers(response.headers)
  headers.set(STAMP_HEADER, String(Date.now()))
  return response.blob().then((body) => new Response(body, {
    status: response.status, statusText: response.statusText, headers,
  }))
}

function fresh(hit) {
  const stamp = Number(hit.headers.get(STAMP_HEADER) || 0)
  return stamp > 0 && (Date.now() - stamp) < TTL_MS
}

/**
 * Look the request up without regard for the query part.
 *
 * The address itself is permanent, but a future signature or cache buster would
 * land in the query. Ignoring it means such a change costs nothing, instead of
 * discarding the whole store.
 */
async function fromStore(store, url) {
  try {
    const hit = await store.match(url, { ignoreSearch: true })
    if (!hit) return null
    if (fresh(hit)) return hit
    await store.delete(url, { ignoreSearch: true })
  } catch (_) { /* a broken store must never break the canvas */ }
  return null
}

async function toStore(store, url, response) {
  // A denied asset answers 200 with a placeholder pixel. Storing that would
  // freeze the denial in place for three days, long after the right returns.
  if (!response.ok || response.headers.get("x-beneos-denied")) return
  if (isControl(url)) return
  try { await store.put(url, await stamped(response.clone())) } catch (_) { /* quota, opaque, ignore */ }
}

export function installStreamFetch() {
  // Am Modus, nicht an streamEnabled(). Letzteres verlangt bereits einen
  // Schluessel, und den holt sich eine frisch eingeschaltete Welt erst im
  // ready-Hook. An streamEnabled() gehaengt liefe die erste Sitzung nach dem
  // Einschalten ganz ohne Speicher, und zwar stillschweigend.
  //
  // Nachruesten nach `ready` ist keine Loesung: gemessen am 22.08.2026 auf
  // Foundry 14.365 feuert `canvasReady` fuenf Millisekunden VOR `ready`, die
  // erste Szene ist dann laengst gezeichnet.
  //
  // Ohne Schluessel ist der Einbau untaetig, denn der Ersatz greift nur bei
  // Adressen auf dem Tor-Host, und ohne Schluessel steht keine solche Adresse
  // in einem Dokument.
  if (installed || !streamMode()) return
  installed = true

  // Images arrive through a worker thread unless this is off. See the file
  // comment: this is the condition, not a tuning knob.
  try {
    if (globalThis.PIXI?.loadTextures?.config) {
      PIXI.loadTextures.config.preferWorkers = false
    }
  } catch (_) { /* older PIXI, nothing to do */ }

  const original = globalThis.fetch.bind(globalThis)

  globalThis.fetch = async function beneosStreamFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url
    if (!url || !ours(url)) return original(input, init)

    // Der Berichtskanal geht am Ersatz vorbei.
    //
    // `/report` liegt auf demselben Host wie die Assets, lief also bisher durch
    // diese Funktion. Antwortet er einmal nicht mit 2xx, meldet der Fehlerkanal
    // seinen eigenen Fehlschlag an sich selbst und zaehlt ihn als Ausfall der
    // Auslieferung. Ein Melder, der sich selbst meldet, verfaelscht genau die
    // Zahl, fuer die er da ist.
    if (/\/report(\?|$)/.test(url)) return original(input, init)

    // In the measuring mode neither of the two applies, and both would falsify
    // the measurement. The store would answer the second run of a comparison
    // from the first one, and the per-file deadline is a streaming rule: it is
    // meant to keep a scene from parking on one slow video, while an install has
    // deadlines of its own that are sized to the file (installer 31-48) and must
    // be the same on both routes or the comparison measures this module.
    const measuring = downloadMode()
    const store = (!measuring && localCacheEnabled() && !isControl(url)) ? await openStore() : null
    if (store) {
      const hit = await fromStore(store, url)
      if (hit) {
        count("store-hit")
        return hit.clone()
      }
    }

    // A budget of our own, because Foundry has none. `TextureLoader` sets no
    // deadline, PIXI hands the URL to a bare `fetch` without a signal, and
    // Foundry's own `fetchWithTimeout` is used nowhere on the asset path. The
    // budget follows the file type: a picture that takes half a minute is
    // broken, a video that takes two is merely large.
    //
    // The deadline deliberately outlives the `await` below. `fetch` resolves as
    // soon as the headers arrive, while PIXI then reads the body with `.blob()`
    // and a seventy-megabyte video spends almost all of its time in that second
    // half. A timer cleared on the header would guard the part that never
    // stalls and leave the part that does. Aborting a request whose body has
    // already been read is a no-op, so letting it run costs nothing.
    const controller = new AbortController()
    const budget = measuring ? 0 : budgetFor(url)
    inFlight.add(controller)
    const release = () => { inFlight.delete(controller) }
    const timer = budget > 0
      ? setTimeout(() => {
          try { controller.abort("timeout") } catch (_) { /* already settled */ }
          release()
        }, budget)
      : null

    const callerSignal = init?.signal
    const signal = (callerSignal && AbortSignal.any)
      ? AbortSignal.any([callerSignal, controller.signal])
      : controller.signal

    let response
    try {
      response = await original(input, { ...(init || {}), signal })
    } catch (err) {
      if (timer) clearTimeout(timer)
      release()
      const aborted = controller.signal.aborted
      const reason = aborted ? "timeout" : "network"
      count(reason, url)
      noteResult(false, reason)
      reportFailure({ url, reason, detail: aborted
        ? `no answer within ${Math.round(budget / 1000)} s`
        : String(err).slice(0, 200) })
      throw err
    }

    if (!response.ok) {
      count("status", url)
      // An answer with a status is proof the gate is reachable, whatever it
      // says. Counting it as a connection failure would put a world with one
      // expired release into permanent "offline".
      noteResult(true)
      reportFailure({ url, reason: "status", detail: String(response.status) })
    } else if (response.headers.get("x-beneos-denied")) {
      // The one failure mode nobody could see. A refusal answers 200 with a
      // transparent pixel, on purpose: an error would paint a hazard icon over
      // the scene and set off a burst of retries. But `response.ok` is then
      // true, so the branch above never fired, the store refused the placeholder
      // without saying so, and the tile simply rendered nothing. No hazard icon,
      // no console line, no report. A failure that leaves no trace cannot be
      // measured, and round three of the beta programme exists to measure it.
      count("denied", url)
      noteResult(true)
      reportFailure({ url, reason: "denied", detail: "placeholder returned" })
      // Einmal je Szene, nicht je Datei.
      //
      // Eine abgelaufene Miete sperrt nicht eine Datei, sondern das ganze
      // Release. Eine Zeile je abgewiesener Datei sind bei einer Szene mit
      // Overlays schnell zwanzig gelbe Zeilen fuer einen einzigen Sachverhalt,
      // und ein Foundry-Nutzer, der sein Log liest, haelt das fuer zwanzig
      // Fehler. Gesammelt wird nach Release und Variante, die beide in der
      // Adresse stehen.
      meldeAbweisung(url)
    } else {
      count("ok")
      noteResult(true)
      // The number the whole delivery question turns on. A dense network of
      // nodes is worth nothing if every file is a miss, and for a catalogue this
      // long that is the case the moment the edge lifetime is short. Counted per
      // answer rather than reasoned about.
      const edge = response.headers.get("x-beneos-cache")
      if (edge) count(`edge:${edge.toLowerCase()}`)
      const fault = response.headers.get("x-beneos-fault")
      if (fault) {
        count(`fault:${fault}`, url)
        console.warn(`Beneos Stream | injected fault "${fault}": ${url}`)
      }
      if (store) await toStore(store, url, response)
    }
    return response
  }
}

/**
 * What happened this session, per reason.
 *
 * Counting is not the same as reporting: a report is deduplicated per address
 * and batched to the gate, which is right for collecting an outage but useless
 * to a tester who needs to know whether a scene produced three failures or
 * three hundred.
 */
export function diagnose() {
  return {
    counts: { ...counts },
    failures: [...failures],
    reported: reportedSoFar(),
  }
}

export function resetDiagnosis() {
  for (const key of Object.keys(counts)) delete counts[key]
  failures.length = 0
}

/** Pull a whole list of addresses into the store before anyone clicks. */
export async function prewarm(urls, onProgress) {
  if (!streamEnabled() || !localCacheEnabled()) return { warmed: 0, failed: 0 }
  const store = await openStore()
  if (!store) return { warmed: 0, failed: 0 }

  let warmed = 0, failed = 0
  for (const url of urls) {
    try {
      if (await fromStore(store, url)) { warmed++; onProgress?.(warmed + failed, urls.length); continue }
      const response = await fetch(url)
      if (response.ok) { await toStore(store, url, response); warmed++ } else { failed++ }
    } catch (_) { failed++ }
    onProgress?.(warmed + failed, urls.length)
  }
  return { warmed, failed }
}

/**
 * Den Browser um eine Zusage bitten, den Speicher nicht zu raeumen.
 *
 * WARUM DAS NOETIG IST
 *
 * Ohne Zusage ist der Cache "best effort": der Browser darf ihn bei
 * Plattenknappheit wegwerfen, ohne zu fragen. Das Offline-Versprechen der
 * Kundenkommunikation haengt genau daran (OP-PRJ-043).
 *
 * WAS AM 22.08.2026 GEMESSEN WURDE
 *
 * Das Modul hat bis dahin `persisted()` nur GELESEN und nie `persist()`
 * GERUFEN. Die Zusage konnte also gar nicht erteilt werden; das protokollierte
 * `persisted=false` war kein abgelehnter Antrag, sondern ein nie gestellter.
 *
 * Ein ausdruecklicher Antrag im Pruefstand ergab trotzdem `false`, bei einem
 * Kontingent von 10,74 GB. Das ist allerdings unter einem frischen
 * Browserprofil gemessen, und Chrome entscheidet nach Nutzungsverlauf. Ein
 * Kunde, der seine Welt taeglich oeffnet, kann dieselbe Frage mit `true`
 * beantwortet bekommen. Die Messung schliesst also die Zusage nicht aus, sie
 * beweist sie nur nicht.
 *
 * Daraus folgt der Umgang: fragen, die Antwort festhalten, und dem Kunden
 * sagen, was er wirklich hat. Ein pauschales Offline-Versprechen ist ohne
 * diese Antwort nicht zu halten.
 *
 * Gerufen wird das direkt nach dem Bestaetigungsdialog, weil eine
 * Nutzerhandlung die Aussicht auf eine Zusage erhoeht.
 *
 * @returns {Promise<{gefragt:boolean, zugesagt:boolean|null}>}
 */
export async function sichereSpeicher() {
  try {
    if (!navigator.storage?.persist) return { gefragt: false, zugesagt: null }
    if (await navigator.storage.persisted()) return { gefragt: false, zugesagt: true }
    return { gefragt: true, zugesagt: await navigator.storage.persist() }
  } catch (_) {
    return { gefragt: false, zugesagt: null }
  }
}

/** What the store currently holds for us, and how much room is left. */
export async function storeStatus() {
  const out = { entries: 0, quotaGB: null, usageMB: null, persisted: null }
  try {
    const store = await caches.open(CACHE_NAME)
    out.entries = (await store.keys()).length
    const est = await navigator.storage?.estimate?.()
    if (est) {
      out.quotaGB = +(est.quota / 1073741824).toFixed(2)
      out.usageMB = +(est.usage / 1048576).toFixed(1)
    }
    out.persisted = await navigator.storage?.persisted?.()
  } catch (_) { /* report what we have */ }
  return out
}

export async function clearStore() {
  try { return await caches.delete(CACHE_NAME) } catch (_) { return false }
}
