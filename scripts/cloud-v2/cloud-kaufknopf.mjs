/**
 * cloud-kaufknopf.mjs - Kauflink und Art des Kaufknopfs je Release.
 * Seit stre-T-120.
 *
 * Der Server liefert je Release `shop_url` und seit stre-T-118 `shop_url_kind`
 * ('pack', 'bundle' oder null). 'bundle' heisst, das Release ist nur ueber ein
 * Bundle kaeuflich und der Link fuehrt auf die Bundle-Seite; dann heisst der
 * Knopf "Buy bundle" (Betreiberentscheid 15.11.2026). Jeder andere Wert, auch
 * ein fehlendes Feld von einem alten Server oder Katalog, laesst "Buy pack"
 * stehen, damit dort nichts anders aussieht als vorher.
 *
 * Die Vorlage nennt beide Sprachschluessel woertlich und waehlt mit
 * `isBundle`. Ein Schluessel aus einer Variablen waere fuer die Sprachwache
 * (tools/stream-sprachen-bench) und jede Suche nach ungenutzten Schluesseln
 * unsichtbar.
 *
 * Pruefsatz: scripts/cloud-v2/cloud-kaufknopf.test.mjs
 */

/**
 * @param {{shop_url?: string|null, shop_url_kind?: string|null}|null|undefined} release
 * @returns {{url: string|null, isBundle: boolean}}
 *   `url` null, wenn der Server kein aktives Shopprodukt fand; dann zeigt die
 *   Vorlage keinen Knopf.
 */
export function kaufKnopf(release) {
  return {
    url: release?.shop_url || null,
    isBundle: release?.shop_url_kind === "bundle",
  }
}
