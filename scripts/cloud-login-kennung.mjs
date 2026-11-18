/**
 * cloud-login-kennung.mjs
 *
 * Die Anmeldung mit der Weltkennung `beneos-cloud-foundry-id` (stre-T-135,
 * Weltmarke, Betreiberentscheid R26: weiche Sperre).
 *
 * WARUM. Eine kopierte Welt traegt die Kennung des Besitzers mit. Widerruft der
 * Kunde auf Connections ein Geraet, sperrt die Cloud dessen Kennung. Ein Modul,
 * das `faehig=1` mitschickt, bekommt fuer eine gesperrte Kennung die Antwort
 * `{"result":"error","code":"foundry-id-revoked"}` statt einer Bindung. Es
 * wuerfelt dann GENAU EINMAL eine neue Kennung und meldet sich damit erneut an;
 * ein zweiter Fehler wird gemeldet wie heute, ohne Schleife.
 *
 * Ein Modul ohne `faehig` wird von der Cloud gebunden wie bisher. Ein Server
 * ohne diesen Bau kennt den Parameter nicht und uebergeht ihn.
 *
 * Gespeichert wird die Kennung nicht hier, sondern wie bisher erst nach dem
 * erfolgreichen Abfragen in `pollForAccess` (`beneos_cloud.js`). Eine
 * gewuerfelte Kennung, mit der die Anmeldung scheitert, landet also nie in der
 * Welt.
 *
 * Pruefsatz: `cloud-login-kennung.test.mjs`, Sabotagen im Satz `kennung`.
 */

export const SPERRCODE = "foundry-id-revoked"

/** So sieht eine Kennung aus, die das Modul von der Cloud uebernimmt. */
const SAUBER = /^[A-Za-z0-9]{1,64}$/

/** Haengt `faehig=1` an eine Anmeldeadresse, die schon Parameter traegt. */
export function mitFaehig(url) {
  return `${url}&faehig=1`
}

/**
 * Meldet sich mit `kennung` an und wuerfelt bei einer gesperrten Kennung
 * einmal neu. Traegt eine OK-Antwort eine saubere `foundry_id`, gilt diese.
 *
 * @param {(kennung: string) => Promise<object>} sende ein Anmelderuf, liefert die JSON-Antwort
 * @param {string} kennung die Kennung der Welt
 * @param {() => string} wuerfle liefert eine neue Kennung
 * @returns {Promise<{daten: object, kennung: string}>}
 */
export async function anmeldenMitKennung(sende, kennung, wuerfle) {
  let daten = await sende(kennung)
  if (daten?.result === "error" && daten?.code === SPERRCODE) {
    kennung = wuerfle()
    daten = await sende(kennung)
  }
  const gebunden = daten?.result === "OK" ? daten.foundry_id : null
  if (typeof gebunden === "string" && SAUBER.test(gebunden)) kennung = gebunden
  return { daten, kennung }
}
