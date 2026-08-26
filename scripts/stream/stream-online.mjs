/**
 * Whether the gate can be reached, and what follows from the answer.
 *
 * With nothing but the documents on the customer's disk, a scene without a
 * connection has nothing to draw. Foundry would still try: it would fetch every
 * picture, fail on each, draw an empty surface for the background (which has no
 * fallback at all) and a hazard icon for every tile, and say nothing about why.
 * A game master would read that as a broken product.
 *
 * So the scene is not opened in the first place. One sentence that names the
 * cause beats a canvas full of hazard icons, and it is also what the wiki's
 * offline rule demands: no broken pictures, no dead links, nothing that waits
 * longer than necessary.
 *
 * Detection follows the module's existing pattern (whats-new-window.mjs):
 * `navigator.onLine` is trusted only when it says no. A machine can be attached
 * to a router that has no route to the outside world, and that is the ordinary
 * case, not the exotic one; there the flag stays true and only a real request
 * tells the truth.
 */

import { streamBase, streamEnabled, streamMode } from "./stream-settings.mjs"

// Probing while the answer is already known is pointless traffic. These follow
// the cloud client's own probe loop: start soon, then back off.
const PROBE_MIN_MS = 30 * 1000
const PROBE_MAX_MS = 10 * 60 * 1000
const PROBE_TIMEOUT_MS = 8 * 1000

// Reached after this many consecutive asset failures while the gate itself
// still answers. Not offline, but not healthy either.
const DEGRADED_AFTER = 3

const STATE = { unbekannt: "unbekannt", online: "online", offline: "offline", degraded: "degraded" }

/**
 * Der Anfangszustand ist NICHT "online".
 *
 * Bis zum 26.08.2026 stand hier `STATE.online`, und das war eine Behauptung
 * ohne Grundlage: beim Weltstart hat noch niemand mit dem Tor gesprochen. Die
 * Folge war TC-PRJ-STR-001, durchgefallen am 25.08.2026. Bei gesperrtem Netz
 * startete die Welt zwar vollstaendig, aber die Konsole trug **65 Fehler und 9
 * Warnungen**, alle aus der Szene, die beim Start schon aktiv war. Die
 * Szenenwache konnte nichts ausrichten: sie umhuellt `Scene#view`, und eine
 * beim Start aktive Szene zeichnet Foundry ueber `canvasInit`, ohne `view` je
 * zu rufen. Selbst am richtigen Ort haette sie nichts zu pruefen gehabt, denn
 * der Zustand log.
 *
 * `unbekannt` heisst: noch nicht gemessen. Es sperrt nichts, denn eine Welt
 * darf nicht warten, bis das Tor geantwortet hat. Es erlaubt nur auch nichts.
 */
let state = STATE.unbekannt
let consecutiveFailures = 0
let probeTimer = null
let probeDelay = PROBE_MIN_MS
let lastChangeAt = 0
const listeners = new Set()

export function streamState() {
  return state
}

export function isOffline() {
  return state === STATE.offline
}

export function onStreamState(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setState(next, why) {
  if (next === state) return
  state = next
  lastChangeAt = Date.now()
  consecutiveFailures = 0
  console.debug(`Beneos Stream | connection ${next} (${why})`)
  for (const fn of listeners) {
    try { fn(next, why) } catch (_) { /* a listener must not break the state */ }
  }
  if (next === STATE.online) stopProbe()
  else startProbe()
}

/**
 * Die erste Probe, so frueh wie moeglich, und ohne den Weltstart aufzuhalten.
 *
 * Gemessene Hookfolge auf Foundry 14.365: `init` 3599 ms, `canvasInit` 7868 ms.
 * Zwischen dem Einbau und dem ersten Zeichnen liegen also gut vier Sekunden,
 * und eine Probe mit acht Sekunden Frist ist in aller Regel lange vorher
 * zurueck. Wer erst beim Zeichnen fragt, muesste warten; wer hier fragt,
 * wartet nie.
 *
 * Bewusst ohne `await` an der Aufrufstelle: schlaegt die Probe fehl, ist der
 * Zustand rechtzeitig `offline`; ist sie langsam, zeichnet die Welt eben unter
 * `unbekannt`, und das ist genau der Zustand von vorher, also kein Rueckschritt.
 */
export async function ersteProbe() {
  // Ebenfalls am Modus, aus demselben Grund wie in `probeOnce`.
  if (!streamMode()) return state
  if (await probeOnce()) setState(STATE.online, "erste Probe beim Weltstart")
  else setState(STATE.offline, "erste Probe beim Weltstart blieb ohne Antwort")
  return state
}

/**
 * One request against the gate's liveness route.
 *
 * Deliberately not one of the asset addresses: those carry the customer key and
 * a refusal there would be read as a dead connection when it is a permission
 * question.
 */
async function probeOnce() {
  // Am Modus, nicht am Schluessel.
  //
  // `streamEnabled()` verlangt einen nicht leeren Schluessel, und den holt sich
  // eine Welt erst im `ready`-Hook. Die Probe lief deshalb beim Einbau ins
  // Leere und kehrte sofort mit `false` zurueck, ohne je gefragt zu haben, und
  // der Zustand blieb bis zum ersten gescheiterten Asset unbestimmt. Gemessen
  // am 26.08.2026: bei gesperrtem Tor stand der Zustand beim ersten
  // Szenenwechsel auf `online`, die Szene wurde gezeichnet, und es entstanden
  // zwanzig Netzfehler.
  //
  // `/health` ist die eine Adresse des Tors, die keinen Schluessel braucht,
  // ausdruecklich damit sie ohne Berechtigung gefragt werden kann.
  if (!streamMode()) return false
  if (navigator.onLine === false) return false
  const controller = new AbortController()
  const timer = setTimeout(() => { try { controller.abort() } catch (_) {} }, PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(`${streamBase()}/health`, {
      cache: "no-store", signal: controller.signal,
    })
    return response.ok
  } catch (_) {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function stopProbe() {
  if (probeTimer) clearTimeout(probeTimer)
  probeTimer = null
  probeDelay = PROBE_MIN_MS
}

function startProbe() {
  if (probeTimer) return
  const tick = async () => {
    probeTimer = null
    if (await probeOnce()) {
      setState(STATE.online, "probe succeeded")
      return
    }
    // Growing gaps rather than a steady drum: a table that stays offline for an
    // hour should not produce a hundred and twenty requests.
    probeDelay = Math.min(probeDelay * 2, PROBE_MAX_MS)
    probeTimer = setTimeout(tick, probeDelay)
  }
  probeTimer = setTimeout(tick, probeDelay)
}

/**
 * Told by the fetch wrapper what happened to a real asset request.
 *
 * A single failure means nothing; a browser drops requests for many reasons. A
 * run of them while the gate is supposed to be up is what "degraded" means, and
 * a network-level failure with the browser reporting itself offline is the one
 * case that needs no confirmation.
 */
export function noteResult(ok, reason) {
  if (!streamEnabled()) return
  if (ok) {
    consecutiveFailures = 0
    // Ein Erfolg heilt `offline` NICHT. Das darf allein die Probe.
    //
    // Eine gelungene Antwort beweist nicht, dass das Tor erreichbar ist: der
    // Browser bedient sie moeglicherweise aus seinem eigenen Zwischenspeicher,
    // und der antwortet auch ohne jede Leitung mit 200. Gemessen auf The Forge
    // 14.365 am 26.08.2026 bei gesperrtem Tor: der Zustand sprang mitten im
    // Zeichnen von `offline` auf `online` zurueck, die Szenenwache schaltete
    // sich damit ab, und es entstanden 25 Netzfehler an einer Szene, die haette
    // abgelehnt werden muessen.
    //
    // Aus `degraded` heilt ein Erfolg weiterhin, denn `degraded` heisst "das
    // Tor antwortet, aber die Assets scheitern", und dagegen ist eine
    // angekommene Datei das richtige Gegenargument.
    //
    // Der Preis ist eine Verzoegerung bis zur naechsten Probe. Genau das
    // verlangt TC-PRJ-STR-005: der Punkt wird von selbst gruen, spaetestens
    // nach dem laufenden Sondenabstand.
    if (state === STATE.degraded || state === STATE.unbekannt) {
      setState(STATE.online, "an asset arrived")
    }
    return
  }
  if (navigator.onLine === false) {
    setState(STATE.offline, "the browser reports no network")
    return
  }
  consecutiveFailures += 1
  if (consecutiveFailures >= DEGRADED_AFTER && state === STATE.online) {
    setState(STATE.degraded, `${consecutiveFailures} failures in a row (${reason})`)
    // Degraded may well be offline with a router in between. The probe decides.
    probeOnce().then(ok2 => {
      if (!ok2) setState(STATE.offline, "the gate does not answer either")
    })
  }
}

/**
 * Refuse to open a scene there is nothing to draw for.
 *
 * `Scene#view` is wrapped rather than a hook used, because Foundry offers no
 * cancellable hook before a draw, and the draw is exactly what has to be
 * prevented. The wrap is installed once and only while the beta is on.
 */
function installSceneGuard() {
  const Scene = foundry.documents?.Scene ?? globalThis.Scene
  if (!Scene?.prototype?.view || Scene.prototype.view.__beneosStream) return

  const original = Scene.prototype.view
  // Foundry reaches `view` more than once for a single click, so a naive
  // refusal produced the same sentence twice in a row. Measured 2026-08-12.
  let lastRefusal = { id: "", at: 0 }
  const wrapped = async function beneosStreamView(...args) {
    if (streamEnabled() && isOffline() && hasStreamedContent(this)) {
      const now = Date.now()
      if (lastRefusal.id === this.id && now - lastRefusal.at < 5000) return this
      lastRefusal = { id: this.id, at: now }
      // Warn, not error: this is a state of the world, not a fault of the
      // software, and the module's own convention reserves error for faults.
      ui.notifications?.warn?.(
        `Beneos Stream: "${this.name}" cannot be loaded, there is no connection `
        + `to the server. The scene is delivered over the network and nothing `
        + `of it is stored locally.`)
      console.debug(`Beneos Stream | refused to draw "${this.name}", offline`)
      return this
    }
    return original.apply(this, args)
  }
  wrapped.__beneosStream = true
  Scene.prototype.view = wrapped
}

/**
 * Does this scene depend on the gate at all?
 *
 * A world holds installed scenes next to streamed ones, and a scene that lives
 * entirely on disk must open whether or not there is a connection.
 */
export function hasStreamedContent(scene) {
  const host = (() => { try { return new URL(streamBase()).host } catch (_) { return "" } })()
  if (!host) return false
  const remote = (src) => typeof src === "string" && src.includes(host)
  // Nicht ueber `scene.background`: ab Foundry 14 ist das ein veralteter
  // Zugriffspfad, der bei jedem Lesen warnt und in Version 16 verschwindet.
  // Gemessen auf The Forge 14.365 am 26.08.2026, diese Zeile erzeugte eine der
  // drei Warnungen des Weltstarts. Dritte Stelle derselben Fehlerklasse nach
  // dc08cca und 39b675e. `_source` ist der rohe Datensatz und warnt nicht.
  const stufe = Array.isArray(scene?.levels) ? scene.levels[0] : null
  const hintergrund = stufe?.background?.src || scene?._source?.background?.src || null
  if (remote(hintergrund) || remote(scene?._source?.foreground)) return true
  for (const tile of scene?.tiles ?? []) {
    if (remote(tile?.texture?.src)) return true
    if (remote(tile?.flags?.["beneos-module"]?.stream?.video)) return true
  }
  return false
}

export function installStreamOnline() {
  // Am Modus, nicht an streamEnabled(): siehe die Begruendung in
  // installStreamFetch. Der Schluessel entsteht erst in `ready`, und ein
  // Wachhund, der in genau dieser Sitzung nicht eingehaengt wird, fehlt bis
  // zum naechsten Weltstart.
  //
  // Untaetig bleibt der Einbau von selbst: `probeOnce` und die Szenenwache
  // pruefen weiterhin auf streamEnabled() und kehren ohne Schluessel sofort
  // zurueck. Es wird also nichts gemessen und nichts gemeldet, bis er da ist.
  if (!streamMode()) return
  installSceneGuard()

  // The browser knows one half of the answer for free. Only the negative one.
  globalThis.addEventListener("offline", () => setState(STATE.offline, "browser event"))
  globalThis.addEventListener("online", () => {
    probeOnce().then(ok => setState(ok ? STATE.online : STATE.degraded, "browser event"))
  })

  if (navigator.onLine === false) setState(STATE.offline, "offline at startup")

  // Sofort fragen, aber auf nichts warten. Siehe `ersteProbe`: bis die erste
  // Szene gezeichnet wird, vergehen auf Foundry 14.365 gut vier Sekunden, und
  // die Antwort ist dann da. Ohne diese Zeile bliebe der Zustand bis zum
  // ersten gescheiterten Asset `unbekannt`, und genau dann ist es zu spaet.
  ersteProbe().catch(() => { /* eine Probe darf den Weltstart nie stoeren */ })
}

/** For the test programme and the status dot. */
export function onlineStatus() {
  return {
    state,
    consecutiveFailures,
    probing: Boolean(probeTimer),
    nextProbeInMs: probeTimer ? probeDelay : 0,
    changedSecondsAgo: lastChangeAt ? Math.round((Date.now() - lastChangeAt) / 1000) : null,
    browserOnline: navigator.onLine,
  }
}
