/**
 * EINE SABOTAGE ALS TEXTERSETZUNG (stre-T-015).
 *
 * Stand bis hierher im Stream-Laeufer `tools/stream-sabotagen.mjs`. Seit der
 * Bench-Laeufer `tools/bench-sabotagen.mjs` dieselbe Form braucht, steht sie
 * hier, damit beide Laeufer einen Anker gleich zaehlen.
 *
 * Je Ersetzung `[datei, anker, ersatz, anzahl = 1, nr = 1]`: Der Anker muss
 * genau `anzahl` mal in der Datei stehen, ersetzt wird die Stelle `nr`. LF im
 * Anker und im Ersatz wird auf das Zeilenende der Datei umgesetzt. Anker
 * `null` legt die Datei mit dem Ersatz als Inhalt NEU an; sie darf im
 * Arbeitsbaum nicht liegen (`liegt`). Mehrere Ersetzungen an derselben Datei
 * bauen aufeinander auf.
 *
 * Rueckgabe `{ neu: Map<datei, text> }` oder `{ fehler: string }`.
 */

const LF = "\n"
const CR = "\r"

export function zeilenende(text) {
  return text.includes(CR + LF) ? CR + LF : LF
}

/**
 * @param {(datei: string) => string} lies liefert den Ausgangstext
 * @param {Array} liste die Ersetzungen
 * @param {(datei: string) => boolean} liegt ob die Datei im Arbeitsbaum liegt
 */
export function ersetze(lies, liste, liegt) {
  const neu = new Map()
  for (const [datei, rohAnker, rohErsatz, anzahl = 1, nr = 1] of liste) {
    if (rohAnker === null) {
      if (liegt(datei)) return { fehler: `${datei}: soll neu entstehen, liegt aber schon` }
      neu.set(datei, rohErsatz)
      continue
    }
    const text = neu.has(datei) ? neu.get(datei) : lies(datei)
    const eol = zeilenende(text)
    const anker = rohAnker.split(LF).join(eol)
    const ersatz = rohErsatz.split(LF).join(eol)
    const stellen = []
    let i = text.indexOf(anker)
    while (i >= 0) { stellen.push(i); i = text.indexOf(anker, i + anker.length) }
    if (stellen.length !== anzahl) {
      return { fehler: `${datei}: Anker ${stellen.length}x statt ${anzahl}x: ${rohAnker.slice(0, 70).replace(/\n/g, "\\n")}` }
    }
    const at = stellen[nr - 1]
    neu.set(datei, text.slice(0, at) + ersatz + text.slice(at + anker.length))
  }
  return { neu }
}
