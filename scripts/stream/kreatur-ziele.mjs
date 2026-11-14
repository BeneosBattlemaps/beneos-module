/**
 * Wohin zeigt ein Feld einer Kreatur: auf die lokale Datei oder aufs Tor?
 *
 * stre-T-064 (E5): Die Umstellung einer Bestandswelt muss genau das Ergebnis
 * einer Neuinstallation liefern. Deshalb steht die Zielregel hier EINMAL, und
 * der Installer (beneos_cloud.js) und die Umstellung (stream-umstellung.mjs)
 * rufen dieselben Funktionen. Bis zum 14.11.2026 stand sie als Ausdruck an drei
 * Stellen im Installer; der Pruefsatz kreatur-ziele.test.mjs haelt die damalige
 * Ausgabe als feste Zeichenkette fest.
 *
 * Reine Funktionen ohne Foundry und ohne Einstellungen: die Adressbildung
 * kommt als `adresse(tokenKey, dateiname)` herein, im Installer ist das
 * `_beneosKreaturAdresse`. Das Journalbild regelt diese Datei NICHT, es bleibt
 * beim Platzhalter bzw. lokal (G1, Legacy-Regel 14.4.12).
 */

/** Der lokale Ordner einer Kreatur, wie ihn der Installer anlegt. */
export function kreaturOrdner(tokenKey) {
  return `beneos_assets/cloud/tokens/${tokenKey}`
}

/**
 * Ist das ein gewoehnlicher Dateiname, oder ein Pfad? Begruendung am Aufrufer
 * `_beneosKreaturDateiOk` in beneos_cloud.js: `assetUrl()` kodiert je Segment
 * und liesse `/` und `..` als Segmente stehen.
 */
export function kreaturDateiOk(filename) {
  return /^[A-Za-z0-9._-]+\.webp$/.test(String(filename || ""))
}

/**
 * Streamt diese Variante? Nur wenn die Lieferung streamt UND Token- und
 * (falls vorhanden) Draufsichtname gewoehnliche Dateinamen sind. Ein
 * untauglicher Name kippt die ganze Variante auf lokal, nicht nur das Feld.
 */
export function varianteStreamt({ streamt, tokenName, topName }) {
  return Boolean(streamt)
    && kreaturDateiOk(tokenName)
    && (!topName || kreaturDateiOk(topName))
}

/** Das Ziel einer einzelnen Bilddatei: Toradresse oder lokaler Pfad. */
export function kreaturBildZiel({ tokenKey, name, streamt, adresse }) {
  return streamt ? adresse(tokenKey, name) : `${kreaturOrdner(tokenKey)}/${name}`
}

/** Der Registerwert `topDown`: die Draufsicht, oder null ohne Draufsicht. */
export function registerTopDown({ tokenKey, topName, variantStreamt, adresse }) {
  return topName ? kreaturBildZiel({ tokenKey, name: topName, streamt: variantStreamt, adresse }) : null
}
