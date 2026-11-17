/**
 * EIN SATZPROZESS UND SEIN AUSGANG (stre-T-126).
 *
 * Bis zu diesem Stand stand dieser Lauf als `fahre()` im Sabotagelaeufer und
 * setzte `rc: fehler.code ?? 1`. stderr ging verloren. Ein echter Absturz und
 * eine Toetung an der Zeitgrenze sahen damit gleich aus ("rc 1 ohne rote
 * Probe"), und keiner von beiden erklaerte sich. Gemeldet von work-stre-2 an
 * einem Volllauf (S807 hakenfehler); nachgestellt in 17 Vollaeufen und
 * 24-fach parallel nicht. Der ganze gemeldete Lauf dauerte 76,2 s, eine
 * Toetung an der Zeitgrenze von 120 s war also ausgeschlossen: es war ein
 * Abbruch, gefahren auf einem Baum mitten im Merge, nicht committet.
 *
 * Jetzt liefert der Lauf, was der Prozess gesagt hat, und `einordnen` macht
 * daraus genau eine von vier Arten:
 *
 *   sauber      rc 0, keine rote Probe
 *   rot         mindestens eine rote Probe (der erwartete Ausgang einer
 *               wirksamen Sabotage)
 *   absturz     rc ungleich 0 ohne rote Probe, nicht getoetet
 *   zeitgrenze  von Node getoetet, an der Zeitgrenze oder bei Ausgabe ueber
 *               `maxBuffer`. Geht allem anderen vor: was ein getoeteter
 *               Prozess noch gedruckt hat, ist kein Ergebnis.
 *
 * Geprueft in `tools/lib/kindlauf.test.mjs`.
 */

import { execFile } from "node:child_process"

export const ZEITGRENZE_MS = 120000
const STDERR_ZEILEN = 12

/**
 * Ein Schluessel geht nie unmaskiert in eine Ausgabe des Laeufers: weder aus
 * stderr noch aus einem Proben- oder Zielnamen. Zwei Regeln, weil das Tor
 * (`validKey`) kein Praefix verlangt, die Attrappen der Saetze aber `pk_`
 * tragen:
 *   - jedes `pk_` mit mindestens vier Zeichen aus `[A-Za-z0-9_-]`,
 *   - das Pfadstueck nach einem Raumbuchstaben (`/a/<schluessel>/`), 16 bis
 *     64 Zeichen, wie die Konsolenmaske des Moduls (`ohneSchluesselImText`).
 * Zu viel zu maskieren ist hier harmlos, zu wenig nicht.
 */
export function maskiere(text) {
  return String(text)
    .replace(/pk_[A-Za-z0-9_-]{4,}/g, "<KEY>")
    .replace(/\/([a-z])\/[A-Za-z0-9_-]{16,64}(?=\/)/g, "/$1/<KEY>")
}

/**
 * Behaelt bei mehr als `STDERR_ZEILEN` Zeilen die ersten zwei und das Ende:
 * Der Stapel eines Absturzes steht unten, Modulwarnungen stehen oben.
 */
function kappe(zeilen) {
  if (zeilen.length <= STDERR_ZEILEN) return zeilen
  return [...zeilen.slice(0, 2), ...zeilen.slice(2 - STDERR_ZEILEN)]
}

/**
 * Faehrt `datei` mit dem eigenen Node in `verzeichnis`.
 * @param {Set} [kinder] wird gefuehrt, damit ein Abbruch laufende Prozesse
 *   beenden kann.
 * @returns {Promise<{rc:number, rot:Set<string>, gruen:Set<string>,
 *   doppelt:Set<string>, ms:number, signal:string|null, getoetet:boolean,
 *   stderr:string[]}>}
 */
export function fahreKind(verzeichnis, datei, { zeitgrenze = ZEITGRENZE_MS, kinder = null, puffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((ok) => {
    const t0 = Date.now()
    const kind = execFile(process.execPath, ["--no-warnings", datei],
      { cwd: verzeichnis, timeout: zeitgrenze, maxBuffer: puffer },
      (fehler, stdout, stderr) => {
        kinder?.delete(kind)
        const rot = new Set()
        const gruen = new Set()
        const doppelt = new Set()
        for (const z of String(stdout).split("\n")) {
          if (z.startsWith("  ROT  ")) rot.add(z.slice(7).trim())
          if (z.startsWith("  ok   ")) {
            const n = z.slice(7).trim()
            if (gruen.has(n)) doppelt.add(n)
            gruen.add(n)
          }
        }
        // Node beendet das Kind selbst an der Zeitgrenze UND bei Ausgabe ueber
        // `maxBuffer`. Im zweiten Fall ist `fehler.killed` undefined, nur
        // `kind.killed` ist wahr (gemessen im Kalt-Review). Beides ist eine
        // Toetung: was der Prozess bis dahin druckte, ist kein Ergebnis.
        const getoetet = Boolean(fehler?.killed || kind.killed)
        const signal = fehler?.signal ?? kind.signalCode ?? null
        // Ein Textcode (ERR_CHILD_PROCESS_STDIO_MAXBUFFER, ENOENT) nennt den
        // Grund, den stderr dann nicht traegt.
        const grund = typeof fehler?.code === "string" ? fehler.code : null
        ok({
          rc: fehler ? (typeof fehler.code === "number" ? fehler.code : 1) : 0,
          rot, gruen, doppelt,
          ms: Date.now() - t0,
          signal,
          getoetet,
          grund,
          stderr: kappe(maskiere(stderr).split(/\r?\n/).filter((z) => z.trim())),
        })
      })
    kinder?.add(kind)
  })
}

/** Genau eine Art je Ausgang, siehe Kopf. */
export function einordnen(r) {
  if (r.getoetet) return "zeitgrenze"
  if (r.rot && r.rot.size > 0) return "rot"
  if (r.rc !== 0) return "absturz"
  return "sauber"
}

/** Eine Zeile fuer die Ausgabe des Laeufers, ohne Schluessel. */
export function erklaere(r, zeitgrenze = ZEITGRENZE_MS) {
  const dauer = `${(r.ms / 1000).toFixed(1)} s`
  if (r.getoetet) {
    // Das Signal ist nur ein Hinweis: unter Windows kommt auch `null`.
    const sig = `Signal ${r.signal ?? "keins"}`
    if (r.grund) return `getoetet (${r.grund}) nach ${dauer}, ${sig}`
    return `Zeitgrenze ${zeitgrenze} ms nach ${dauer}, ${sig}`
  }
  const err = r.stderr.length ? `, stderr: ${r.stderr.join(" | ")}` : ", stderr leer"
  const grund = r.grund ? ` (${r.grund})` : ""
  return `rc ${r.rc}${grund} nach ${dauer}${err}`
}
