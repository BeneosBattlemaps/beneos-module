/**
 * DER GEMEINSAME MERKER: EIN ABRUF JE SCHLUESSEL, EINE FRIST, EIN DECKEL.
 *
 * WARUM DIESE DATEI EXISTIERT, und die Begruendung steht schon in
 * `stream-settings.mjs` ueber `zerlegeAdresse`: zwei Kopien in zwei Dateien
 * gehen erfahrungsgemaess nicht zugleich mit. Diese vier Helfer standen bis
 * zum 08.11.2026 privat in `stream-posen.mjs`. Mit `stream-karten.mjs` kam
 * ein zweiter Aufrufer mit derselben Aufgabe; abgeschrieben waere der Deckel
 * zweimal gesetzt, die Verdraengung zweimal geschrieben und beim naechsten
 * Fehler nur an einer Stelle behoben.
 *
 * `laufend` IST ABSICHTLICH GETEILT. Zehn Kacheln einer Kreatur teilen schon
 * heute EINEN Abruf; mit einer zweiten Liste daneben teilen auch die Karten
 * eines Gegenstands einen. Die Schluessel tragen deshalb ein Vorwort je
 * Gegenstand (`liste:`, `platte:`, `karten:`), und zwei Aufrufer mit
 * demselben Vorwort und derselben Kennung MEINEN auch dasselbe.
 *
 * Diese Datei kennt weder Foundry noch das Tor. Sie ist ohne Browser
 * pruefbar, und `scripts/stream/stream-beute.test.mjs` tut das.
 */

/**
 * Obergrenze je Karte, mit Verdraengung der aeltesten Eintraege.
 *
 * Ohne sie waechst der Zwischenspeicher ueber die Sitzung, und zwar nicht
 * theoretisch: Tokenpfade tragen im Bestand mitunter einen Cache-Brecher, also
 * bekaeme dieselbe Datei je Abruf einen neuen Eintrag. Deshalb faellt der
 * Abfrageteil zusaetzlich aus dem Schluessel.
 */
export const KARTE_MAX = 400

/** Laufende Abrufe, damit zehn Kacheln einer Kreatur EINEN Abruf teilen. */
const laufend = new Map()

export function frisch(eintrag, frist) {
  return !!eintrag && (Date.now() - eintrag.stand) < frist
}

/** Setzen samt Abraeumen und Deckel. `frisch()` liest nur, es loescht nicht. */
export function merken(karte, schluessel, wert, frist) {
  const jetzt = Date.now()
  for (const [k, e] of karte) {
    if ((jetzt - e.stand) >= frist) karte.delete(k)
  }
  while (karte.size >= KARTE_MAX) {
    const aeltester = karte.keys().next().value
    if (aeltester === undefined) break
    karte.delete(aeltester)
  }
  karte.set(schluessel, { stand: jetzt, wert })
  return wert
}

/**
 * Ein Abruf je Schluessel, auch wenn zehn Aufrufer gleichzeitig fragen.
 *
 * Der Zwischenspeicher legt das ERGEBNIS ab, nicht das Versprechen. Solange
 * noch keine Antwort liegt, wuerde jede Variantenkachel ihren eigenen Abruf
 * starten; `#probeVariantTopAssets()` faechert mit `Promise.allSettled` ueber
 * alle Kacheln einer Kreatur gleichzeitig auf, das waeren fuenf Abrufe
 * derselben Datei. Deshalb liegt das laufende Versprechen hier daneben.
 */
export function einmal(schluessel, arbeit) {
  const schon = laufend.get(schluessel)
  if (schon) return schon
  const lauf = (async () => {
    try { return await arbeit() } finally { laufend.delete(schluessel) }
  })()
  laufend.set(schluessel, lauf)
  return lauf
}

/** Der Abfrageteil gehoert nicht zur Identitaet einer Datei. */
export function ohneAbfrage(pfad) {
  return String(pfad || "").split("?")[0].split("#")[0]
}

