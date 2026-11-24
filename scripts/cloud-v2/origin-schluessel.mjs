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
 * Adresse des Herkunft-Icons am CDN fuer den Drawer des Cloud-Fensters.
 *
 * Das CDN benennt seine Icons nach den Kartendateien (`techno_arcane`,
 * `giant_forged`, `dwarven_forged`, `crystaline`), nicht nach der kanonischen
 * Herkunft. Derselbe Kartenname steht in der Registry im Feld
 * `icon_filename_bw` (`<kartenname>_blackwhite.webp`), daraus wird er
 * gelesen. Gemessen am 2026-11-24: 16 von 19 Registry-Herkuenften liefern so
 * ein Icon; beastforged, infernal und mutation fehlen am CDN.
 *
 * Kennt die Registry die Herkunft nicht (etwa srd), bleibt es beim
 * kanonischen Schluessel, wie bisher; fehlt die Datei, entfernt die Vorlage
 * das Bild.
 *
 * @param {string} schluessel kanonische Herkunft
 * @param {{icon_filename_bw?: string} | null} eintrag Registry-Eintrag oder null
 * @returns {string|null}
 */
export function herkunftIconUrl(schluessel, eintrag) {
  if (!schluessel) return null
  const karte = /^(.+)_blackwhite\.webp$/.exec(String(eintrag?.icon_filename_bw ?? ""))?.[1]
  return `https://www.beneos-database.com/icons/${karte ?? schluessel}.webp`
}
