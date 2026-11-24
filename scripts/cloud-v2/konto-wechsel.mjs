/**
 * Entscheidet, ob eine Welt merken muss, dass ihre Foundry-Kennung jetzt zu
 * einem anderen Beneos-Konto gehoert (MO-045).
 *
 * WOFUER
 *
 * Seit T-472 bindet die Cloud eine foundry_id nach einer Anmeldung mit anderer
 * E-Mail auf das neue Konto um. Weltkopien mit derselben Kennung bekommen beim
 * naechsten Check still die Rechte des neuen Kontos. Die Antwort von check=1
 * traegt dafuer `account_ref`: genau 16 Kleinbuchstaben-Hexziffern, stabil je
 * Konto, nur im OK-Fall vorhanden. Die Welt merkt sich den Wert und zeigt dem
 * GM einen Hinweis, wenn er abweicht. Die Rechte des neuen Kontos bleiben.
 *
 * Fehlt das Feld oder passt es nicht zur Form, gilt es als unbekannt: kein
 * Hinweis, der gespeicherte Wert bleibt. Der erste Wert einer Welt und jeder
 * Wert aus der eigenen Anmeldung in dieser Welt werden still uebernommen, dort
 * ist ein Wechsel gewollt.
 *
 * GRENZE
 *
 * Wurde eine Kopie umgebunden, bevor sie je einen Wert gesehen hat, ist der
 * erste Wert schon der des neuen Kontos. Das laesst sich hier nicht erkennen.
 */

const FORM = /^[0-9a-f]{16}$/

/**
 * @param {object} p
 * @param {string|null|undefined} p.gespeichert  Wert im Welt-Setting
 * @param {unknown} p.neu                        `account_ref` aus der Antwort
 * @param {boolean} p.eigeneAnmeldung            true im Anmeldeweg dieser Welt
 * @returns {{ speichern: string|null, hinweis: boolean }}
 */
export function kontoWechsel({ gespeichert, neu, eigeneAnmeldung }) {
  if (typeof neu !== "string" || !FORM.test(neu) || neu === gespeichert) {
    return { speichern: null, hinweis: false }
  }
  return { speichern: neu, hinweis: !!gespeichert && !eigeneAnmeldung }
}
