/**
 * Telling Beneos when a streamed asset did not arrive.
 *
 * A failed fetch is invisible to the player: no message, an empty rectangle and
 * a line in a console nobody reads. Without collection nobody learns of an
 * outage until a complaint arrives, which is why this exists from the start
 * rather than being added after the first bad evening.
 *
 * Reports go to the gate, never to the live telemetry endpoint. The two answer
 * different questions: telemetry counts what customers do, this counts what the
 * delivery failed to hand them, and mixing them would make both harder to read.
 *
 * The sentence used to say "the beta gate", from a time when a separate gate
 * existed for the trial. It does not: `streamBase()` is the production gate
 * that every customer streams from, and has been since streaming became the
 * normal delivery on 2026-09-03.
 */

import { streamBase, streamEnabled, istPruefstand } from "./stream-settings.mjs"
import { isOffline } from "./stream-online.mjs"

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
  // Ohne Verbindung wird nicht gemeldet.
  //
  // Der Melder liegt auf demselben Host wie die Assets. Steht fest, dass der
  // Host nicht erreichbar ist, erzeugt der Versuch genau eine weitere rote
  // Zeile im Konsolenlog des Kunden, und zwar ueber einen Ausfall, den er
  // ohnehin schon kennt. Gemessen am 26.08.2026 in TC-PRJ-STR-001: einer der
  // drei verbliebenen Fehler beim Weltstart ohne Netz war dieser.
  //
  // Die Warteschlange bleibt stehen. Kommt die Verbindung zurueck, geht der
  // naechste Lauf mit allem, was sich angesammelt hat.
  if (isOffline()) return
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
        // DAS EIGENE RAUSCHEN MUSS SICH BENENNEN.
        //
        // GEMESSEN am 02.09.2026 ueber 72 Stunden: alle 35 Meldungen unter
        // /reports stammten aus den eigenen Pruefstaenden. Ohne dieses Feld
        // ersaeuft das erste echte Kundensignal darin, und nachtraeglich ist
        // es nicht zu trennen: Weltname und Foundry-Fassung sagen nichts
        // darueber, wer da meldet, und eine Kundenwelt darf genauso heissen.
        //
        // Die Vorgabe ist `false`. Fuer eine Kundenwelt aendert sich also
        // nichts, und wer einen Pruefstand betreibt, traegt es einmal ein.
        bench: istPruefstand(),
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
