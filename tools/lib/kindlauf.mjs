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
 *   zeitgrenze  an der Zeitgrenze getoetet. Geht allem anderen vor: was ein
 *               getoeteter Prozess noch gedruckt hat, ist kein Ergebnis.
 *
 * Geprueft in `tools/lib/kindlauf.test.mjs`.
 */

import { execFile } from "node:child_process"

export const ZEITGRENZE_MS = 120000
const STDERR_ZEILEN = 12

/**
 * Ein Streamschluessel hat die Form `pk_` plus Zeichen aus `[A-Za-z0-9_-]`
 * (Tor `validKey`). stderr eines Satzes kann einen tragen, etwa in einer
 * Fehlermeldung mit Adresse. Er geht nie unmaskiert in eine Ausgabe.
 */
export function maskiere(text) {
  return String(text).replace(/pk_[A-Za-z0-9_-]{4,}/g, "<KEY>")
}

/**
 * Faehrt `datei` mit dem eigenen Node in `verzeichnis`.
 * @param {Set} [kinder] wird gefuehrt, damit ein Abbruch laufende Prozesse
 *   beenden kann.
 * @returns {Promise<{rc:number, rot:Set<string>, gruen:Set<string>,
 *   doppelt:Set<string>, ms:number, signal:string|null, getoetet:boolean,
 *   stderr:string[]}>}
 */
export function fahreKind(verzeichnis, datei, { zeitgrenze = ZEITGRENZE_MS, kinder = null } = {}) {
  return new Promise((ok) => {
    const t0 = Date.now()
    const kind = execFile(process.execPath, ["--no-warnings", datei],
      { cwd: verzeichnis, timeout: zeitgrenze, maxBuffer: 16 * 1024 * 1024 },
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
        // `killed` setzt Node, wenn es den Prozess selbst beendet hat, hier
        // also an der Zeitgrenze. Dann ist `code` null.
        const getoetet = Boolean(fehler?.killed)
        const signal = fehler?.signal ?? null
        ok({
          rc: fehler ? (typeof fehler.code === "number" ? fehler.code : 1) : 0,
          rot, gruen, doppelt,
          ms: Date.now() - t0,
          signal,
          getoetet,
          stderr: maskiere(stderr).split(/\r?\n/).filter((z) => z.trim()).slice(0, STDERR_ZEILEN),
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
  if (r.getoetet) {
    // Das Signal ist nur ein Hinweis: unter Windows kommt auch `null`.
    return `Zeitgrenze ${zeitgrenze} ms nach ${(r.ms / 1000).toFixed(1)} s, Signal ${r.signal ?? "keins"}`
  }
  const err = r.stderr.length ? `, stderr: ${r.stderr.join(" | ")}` : ", stderr leer"
  return `rc ${r.rc} nach ${(r.ms / 1000).toFixed(1)} s${err}`
}
