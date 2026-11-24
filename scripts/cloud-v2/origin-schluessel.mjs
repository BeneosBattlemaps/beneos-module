/**
 * Kanonische Form der Item-Herkunft (`properties.origin` im Item-Katalog).
 *
 * WOFUER
 *
 * Der Katalog fuehrte dieselbe Herkunft in zwei Schreibweisen, etwa
 * `techno_arcane` neben `technoarcane` und `giant_forged` neben `giantforged`
 * (MO-043, gemessen am 2026-11-24). Der Card Creator leitet den Wert aus dem
 * Dateinamen des Kartenicons ab und liess dabei die Unterstriche stehen. Im
 * Cloud-Fenster entstanden so zwei Filteroptionen, zwei Kompendiumsordner,
 * und Hover-Text und Uebersetzung fehlten bei der Unterstrich-Form.
 *
 * Kanonisch ist die Form OHNE Trennzeichen. Sie steht in
 * data/_itemorigins/origins.json, im Hover-Block des Common-Katalogs und in
 * der Uebersetzungsmatrix (item.origin).
 *
 * Die Funktion ist idempotent und damit ueberall vorschaltbar.
 */

import { OriginsRegistry } from "../loot/origins-registry.mjs"
import { ORIGIN_META } from "../codex2/origin-meta.mjs"

// Ein Kartenicon heisst `crystaline`, die Herkunft `crystalline`.
const HERKUNFT_ALIAS = Object.freeze({
  crystaline: "crystalline",
})

/**
 * @param {unknown} wert Herkunft aus dem Katalog, in beliebiger Schreibweise
 * @returns {string} kleingeschrieben, ohne Unterstriche, Bindestriche und Leerzeichen
 */
export function herkunftSchluessel(wert) {
  const k = String(wert ?? "").toLowerCase().replace(/[_\s-]+/g, "")
  return HERKUNFT_ALIAS[k] ?? k
}

/**
 * Herkunft-Symbol fuer den Drawer des Cloud-Fensters: die Scheibe aus dem
 * Modul, die auch die Codex-Galerie zeigt. Eingefaerbt wird sie wie dort mit
 * herkunftFarbe(), denn alle 19 Dateien sind dasselbe Rot.
 *
 * Bis MO-043 kam das Icon vom CDN. Dort fehlten beastforged, infernal und
 * mutation (gemessen 404 am 2026-11-24), und die Dateien am CDN sind in keinem
 * Repository. Seit MO-044 (Betreiberentscheid: farbige Modul-Scheibe) gilt
 * die Registry: alle 19 Herkuenfte haben ihr Icon unter icons/origin/.
 *
 * Kennt die Registry die Herkunft nicht, gibt es kein Icon. Das betrifft srd,
 * das im Katalog eine Quelle ist und keine Herkunft.
 *
 * @param {string} schluessel kanonische Herkunft
 * @returns {string|null} Foundry-Pfad oder null
 */
export function herkunftIconUrl(schluessel) {
  if (!schluessel) return null
  return OriginsRegistry.iconPath(schluessel, "color")
}

/**
 * Glow-Farbe der Herkunft, dieselbe Quelle wie Codex-Galerie und Item-Radar
 * (ORIGIN_META). Ohne Eintrag, etwa bei srd, keine Farbe.
 *
 * @param {string} schluessel kanonische Herkunft
 * @returns {string|null}
 */
export function herkunftFarbe(schluessel) {
  return ORIGIN_META[schluessel]?.glow ?? null
}
