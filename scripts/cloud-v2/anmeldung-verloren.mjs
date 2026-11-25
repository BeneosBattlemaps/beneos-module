/**
 * Entscheidet, ob und wie eine Welt dem GM meldet, dass Beneos Cloud ihre
 * Foundry-Kennung nicht mehr kennt (MO-046).
 *
 * WOFUER
 *
 * Die Cloud behaelt je Konto nur die 15 neuesten Foundry-Bindungen und kann
 * eine Bindung auch serverseitig loesen. Antwortet check=1 dann mit "nicht
 * gefunden", ist die Welt abgemeldet. Bis MO-046 erfuhr das nur, wer vorher
 * Patreon-Zugang gespeichert hatte, denn diese Flags dienten zugleich als
 * Merker "schon gemeldet". Ein GM ohne Patreon fand die Welt still abgemeldet,
 * auch fuer Gekauftes.
 *
 * Jetzt merkt sich die Welt die Kennung, fuer die sie gemeldet hat. Wer vorher
 * Zugang hatte, liest weiter, dass der gespeicherte Zugang geloescht wurde;
 * alle anderen bekommen einen Hinweis ohne Patreon-Bezug. Ein erfolgreicher
 * Check, die eigene Anmeldung und das Abmelden leeren den Merker, damit ein
 * spaeterer Verlust wieder gemeldet wird.
 *
 * GRENZE
 *
 * Der Merker gilt je Welt. Den Hinweis sieht der GM, der nach dem Verlust
 * zuerst laedt; ein zweiter GM nicht.
 */

/**
 * @param {object} p
 * @param {boolean} p.hatteZugang                vorher Patreon-Zugang gespeichert
 * @param {string|null|undefined} p.foundryId    Kennung dieser Welt
 * @param {string|null|undefined} p.gemeldetFuer Kennung, fuer die schon gemeldet wurde
 * @returns {{ hinweis: "patron"|"ohne"|null, merken: string|null }}
 */
export function anmeldungVerloren({ hatteZugang, foundryId, gemeldetFuer }) {
  if (!foundryId) return { hinweis: null, merken: null }
  if (hatteZugang) return { hinweis: "patron", merken: foundryId }
  if (gemeldetFuer === foundryId) return { hinweis: null, merken: null }
  return { hinweis: "ohne", merken: foundryId }
}
