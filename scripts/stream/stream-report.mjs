/**
 * Telling Beneos when a streamed asset did not arrive.
 *
 * A failed fetch is invisible to the player: no message, an empty rectangle and
 * a line in a console nobody reads. Without collection nobody learns of an
 * outage until a complaint arrives, which is why this exists from the start
 * rather than being added after the first bad evening.
 *
 * Reports go to the beta gate, never to the live telemetry endpoint. Beta noise
 * has no business in the live figures.
 */

import { streamBase, streamEnabled } from "./stream-settings.mjs"

// One report per address per session. A broken scene would otherwise send one
// report per retry per asset, which buries the signal it is meant to carry.
const seen = new Set()
const queue = []
let flushing = false

function key(entry) {
  return `${entry.reason}|${String(entry.url).split("?")[0]}`
}

async function flush() {
  if (flushing || !queue.length) return
  flushing = true
  const batch = queue.splice(0, queue.length)
  try {
    await fetch(`${streamBase()}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // Der Kundenschluessel wird NICHT mitgeschickt.
        //
        // Er stand hier bis zum 22.08.2026. Das Tor wirft ihn seinerseits weg
        // und begruendet das in `handleReport`: der Schluessel benennt eine
        // Person, und ein Diagnosekanal ist der falsche Ort dafuer. Ihn
        // trotzdem zu senden hiess, ihn ueber eine unangemeldete Route zu
        // schicken, damit ihn die Gegenseite anschliessend verwirft. Die Welt
        // leistet fuer die Gruppierung dasselbe und sagt nichts darueber, wer
        // am Tisch sitzt.
        world: game?.world?.id ?? null,
        foundry: game?.version ?? null,
        entries: batch,
      }),
      keepalive: true,
    })
  } catch (_) {
    // A report that cannot be sent is not worth breaking anything over.
  } finally {
    flushing = false
  }
}

export function reportFailure(entry) {
  if (!streamEnabled()) return
  const id = key(entry)
  if (seen.has(id)) return
  seen.add(id)
  queue.push({ ...entry, at: new Date().toISOString() })
  // Collect for a moment so a scene full of failures travels as one report.
  setTimeout(flush, 3000)
}

export function reportedSoFar() {
  return seen.size
}
