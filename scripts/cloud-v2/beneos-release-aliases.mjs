/**
 * ERZEUGT. NICHT VON HAND AENDERN.
 *
 * Quelle: beneos-cloud-server/tools/release-rename-map.json (Stand 2026-09-14)
 * Erzeuger: beneos-cloud-server/tools/build-module-aliases.php
 * Abgleich: derselbe Aufruf mit --check meldet jede Abweichung.
 *
 * WOFUER
 *
 * Dreizehn Releases mit Buchstabensuffix wandern auf das Band ab 9100, weil
 * die Katalogerzeugung den Buchstaben nicht liest und sie deshalb alle im
 * Nummernraum 00 landen. Zwei Dinge tragen den alten Namen und koennen von
 * aussen nicht umgeschrieben werden:
 *
 *   1. Der Weltvermerk `battlemap-installs` des Kunden, geschluesselt auf
 *      den Releasenamen, etwa `bm_0057b`.
 *   2. Der POI-Teleporter, der sein Zielrelease aus dem JOURNALNAMEN liest
 *      (`DontTouch-POI-Teleporter-57b-...`). Journalnamen sind Paketinhalt
 *      und liegen in jeder Kundenwelt.
 *
 * Deshalb stehen beide Schreibweisen in derselben Tabelle:
 *
 *   bm_0057b -> bm_9108      Releaseschluessel
 *   57b      -> 9108         POI-Token, ohne bm_ und ohne fuehrende Null
 *
 * 13 Releases, je zwei Formen.
 */

export const BENEOS_RELEASE_ALIASES = Object.freeze({
  "14b": "9101",
  "20b": "9102",
  "42b": "9103",
  "42c": "9104",
  "46b": "9105",
  "47b": "9106",
  "53b": "9107",
  "57b": "9108",
  "57c": "9109",
  "70b": "9110",
  "70c": "9111",
  "78b": "9112",
  "93b": "9113",
  "bm_0014b": "bm_9101",
  "bm_0020b": "bm_9102",
  "bm_0042b": "bm_9103",
  "bm_0042c": "bm_9104",
  "bm_0046b": "bm_9105",
  "bm_0047b": "bm_9106",
  "bm_0053b": "bm_9107",
  "bm_0057b": "bm_9108",
  "bm_0057c": "bm_9109",
  "bm_0070b": "bm_9110",
  "bm_0070c": "bm_9111",
  "bm_0078b": "bm_9112",
  "bm_0093b": "bm_9113",
})

/**
 * Aufloesung eines Release- oder Tokenschluessels auf seinen neuen Namen.
 *
 * Unbekannte Schluessel kommen UNVERAENDERT zurueck, in ihrer
 * Originalschreibweise. Die Funktion ist damit ueberall vorschaltbar, ohne
 * dass der Aufrufer eine Fallunterscheidung braucht.
 *
 * Drei Formen werden erkannt:
 *
 *   bm_0057b                        genau
 *   beneos_bm_0057b_forest_a_horror Langform des Vermerks, Vorsatz plus Name
 *   57b                             POI-Token
 *
 * Die Langform wird bewusst nur fuer Schluessel mit ANGEHAENGTEM BUCHSTABEN
 * erkannt (`bm_\d{4}[a-z]`). Damit kann die Funktion `bm_0111`, `bm_tour_0001`
 * oder `bm_single_map_0003` gar nicht erst beruehren, und der Vergleich
 * bleibt eng an den dreizehn bekannten Faellen.
 *
 * @param {string} schluessel
 * @returns {string} neuer Name, oder die Eingabe unveraendert
 */
export function beneosReleaseAlias(schluessel) {
  const roh = String(schluessel || "")
  if (!roh) return roh
  const k = roh.trim().toLowerCase().replace(/^beneos_/, "")
  if (BENEOS_RELEASE_ALIASES[k]) return BENEOS_RELEASE_ALIASES[k]
  const m = k.match(/^(bm_\d{4}[a-z])(?:_|$)/)
  if (m && BENEOS_RELEASE_ALIASES[m[1]]) return BENEOS_RELEASE_ALIASES[m[1]]
  return roh
}
