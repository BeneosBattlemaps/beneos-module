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

import { istPlatzhalter, streamBase, streamEnabled, istPruefstand, zerlegeAdresse,
  STREAM_RAUM_BUCHSTABE } from "./stream-settings.mjs"
import { isOffline } from "./stream-online.mjs"

/**
 * Die Adresse ohne den Streamschluessel.
 *
 * **Weiter unten steht, der Kundenschluessel werde nicht mitgeschickt, und das
 * war bis zum 05.11.2026 nur fuer das eigens entfernte Feld wahr.** Gemessen an
 * diesem Tag mit abgefangener Meldung: eine echte Toradresse im Feld `url`
 * ergab eine Meldung von 322 Byte, und die **enthielt den echten Schluessel**,
 * denn eine Toradresse traegt ihn als zweites Pfadstueck. Vier Aufrufstellen in
 * `stream-fetch.mjs` uebergeben diese Rohadresse.
 *
 * Ausgenutzt war der Weg nicht: das Tor wirft den Schluessel in `handleReport`
 * von sich aus weg. Er lief also ueber eine Route, die ihn nicht will, und lag
 * auf dem Weg dorthin in jedem Protokoll, das eine Verbindung mitschreibt.
 *
 * Darum wird hier, an der **einen** Stelle, durch die jede Meldung geht, das
 * Schluesselstueck durch einen Bindestrich ersetzt. Die Form bleibt sonst
 * gleich, damit eine Meldung weiterhin lesbar sagt, welche Datei welches
 * Releases gefehlt hat. `vorratsSchluessel()` in `stream-fetch.mjs` leistet
 * dasselbe fuer die Ablage und traegt dort noch einen eigenen Ursprung, weil ein
 * Vorratsschluessel einen Schluesselwechsel ueberleben muss.
 *
 * DER BUCHSTABE KAM BIS ZUM 08.11.2026 AUS EINER ZWEITEILIGEN FRAGE,
 * `t.raum === "kreatur" ? "c" : "a"`, und damit wurde jede Beuteadresse und
 * jede geteilte Adresse als KARTENADRESSE gemeldet. Der Schluessel fiel dabei
 * richtig weg, die Meldung log aber ueber den Raum: eine fehlende Beutedatei
 * erschien unter `/a/-/`. Jetzt kommt er aus `STREAM_RAUM_BUCHSTABE`, also aus
 * derselben Quelle wie die Textmaske darunter.
 *
 * KEIN WEG DURCH DIESE FUNKTION GIBT EINEN SCHLUESSEL HERAUS, und das ist der
 * Grund fuer den Rueckfall auf `ohneSchluesselImText()` statt auf `roh`. Eine
 * Adresse, die `zerlegeAdresse()` nicht zerlegt, oder ein Raum, den die Tabelle
 * noch nicht kennt, kaeme sonst UNVERAENDERT heraus, also mit Schluessel. Die
 * kanonische Form geht dabei verloren, der Schluessel nicht.
 */
export function ohneSchluessel(url) {
  const roh = String(url || "").split("?")[0]
  /*
   * EINE SCHLUESSELFREIE FORM BLEIBT, WIE SIE IST, und dieser Zweig steht vor
   * allem anderen.
   *
   * Seit dem 08.11.2026 liest `zerlegeAdresse` auch die Platzhalterform
   * `beneos://<raum>/...`, und ohne diesen Zweig baute der Rumpf darunter sie
   * kanonisch mit `streamBase()` neu auf. Gemessen an diesem Tag wurde aus
   * `beneos://s/shared/<sha>/<name>` die Toradresse
   * `https://<tor>/s/-/shared/<sha>/<name>`.
   *
   * Das ist nicht harmlos: diese Funktion maskiert, sie formt nicht um. Ein
   * Fehlerbericht soll die Adresse nennen, die im Dokument STEHT. Wer dort
   * eine Toradresse liest, sucht sie im Dokument und findet sie nicht. Und es
   * gibt hier nichts zu maskieren, denn die Form traegt keinen Schluessel.
   */
  if (istPlatzhalter(roh)) return roh
  const t = zerlegeAdresse(roh)
  const buchstabe = t ? STREAM_RAUM_BUCHSTABE[t.raum] : ""
  if (!buchstabe) return ohneSchluesselImText(roh)
  const mitte = t.variant ? `${t.release}/${t.variant}` : t.release
  return `${streamBase()}/${buchstabe}/-/${mitte}/${t.pfad}`
}

/**
 * Dasselbe fuer FLIESSTEXT, in dem eine Toradresse irgendwo drinsteht.
 *
 * Warum es zwei Formen braucht und das trotzdem EINE Regel ist: `ohneSchluessel`
 * bekommt eine Adresse und baut sie ueber `zerlegeAdresse` kanonisch neu auf.
 * Diese hier bekommt einen Satz wie `Loaded https://.../a/<schluessel>/... (50%)`
 * und darf den Satz nicht antasten, nur das Schluesselstueck darin. Beide
 * stuetzen sich auf dieselben zwei Tatsachen, und mehr sind es nicht: der Host
 * steht in `streamBase()`, und der Raum ist `a` oder `c`. Eine dritte Regel
 * entsteht dadurch nicht.
 *
 * Der Host ist Teil des Musters und nicht Zierwerk. Ohne ihn wuerde `/a/x/` in
 * jedem fremden Text getroffen, etwa in einem Dateipfad des Kunden.
 *
 * DIE RAEUME STANDEN BIS ZUM 08.11.2026 ALS `a|c` IN DIESER FUNKTION, und das
 * war ein Leck: eine Beuteadresse `/l/` und eine geteilte Adresse `/s/` gingen
 * mit dem echten Streamschluessel durch, gemessen an diesem Tag. Beide Raeume
 * sind am 08.11.2026 entstanden, diese Maske ist aelter, und sie ist nicht
 * mitgewachsen. Die Buchstaben kommen jetzt aus `STREAM_RAUM_BUCHSTABE`, damit
 * ein fuenfter Raum an einer Stelle eingetragen wird und nicht an vier.
 *
 * Zuerst eine billige Teilstring-Probe, weil diese Funktion an `console.log`
 * haengt und damit an einer der heissesten Stellen des Browsers. Erst wenn
 * einer der Raumbuchstaben ueberhaupt vorkommt, wird die Einstellung gelesen.
 */
const RAUM_BUCHSTABEN = Object.values(STREAM_RAUM_BUCHSTABE)
const RAUM_TEILSTRINGE = RAUM_BUCHSTABEN.map((b) => `/${b}/`)

const maskeCache = { basis: null, muster: null }

export function ohneSchluesselImText(text) {
  const s = String(text)
  if (!RAUM_TEILSTRINGE.some((t) => s.includes(t))) return s
  let basis = ""
  try { basis = String(streamBase() || "") } catch (_) { return s }
  if (!basis) return s
  if (maskeCache.basis !== basis) {
    maskeCache.basis = basis
    const roh = basis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    maskeCache.muster = new RegExp(
      `${roh}/(${RAUM_BUCHSTABEN.join("|")})/[^/\\s"'<>]+`, "g")
  }
  return s.replace(maskeCache.muster, (_, raum) => `${basis}/${raum}/-`)
}

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
        // Dieser Satz galt bis zum 05.11.2026 nur fuer dieses Feld, nicht fuer
        // das Feld `url`. Seit dem Umbau faellt der Schluessel in
        // `reportFailure` ueber `ohneSchluessel`, also fuer jede Aufrufstelle
        // und jede kuenftige.
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
  // Der Schluessel faellt HIER, an der einen Stelle, durch die jede Meldung
  // geht. Eine Aufrufstelle kann es damit nicht mehr falsch machen, und auch
  // eine kuenftige nicht. Siehe `ohneSchluessel`.
  const sicher = { ...entry, url: ohneSchluessel(entry?.url) }
  const id = key(sicher)
  if (seen.has(id)) return
  seen.add(id)
  queue.push({ ...sicher, at: new Date().toISOString() })
  // Collect for a moment so a scene full of failures travels as one report.
  setTimeout(flush, 3000)
}

export function reportedSoFar() {
  return seen.size
}
