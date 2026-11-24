/**
 * Waehlt den Hinweis, den der GM sieht, wenn foundry-otp-verify.php die
 * Anmeldung mit einem Fehler beantwortet (MO-049).
 *
 * WOFUER
 *
 * Der Server verbraucht den Einmalcode, bevor er das Konto anlegt und diese
 * Welt bindet. Scheitert einer dieser beiden Schritte, stimmte der Code, ist
 * aber weg. Bis MO-049 las der GM auch dann "Invalid or expired code" und
 * versuchte denselben Code noch einmal. Jetzt traegt die Antwort ein
 * Maschinenfeld code, und nur danach wird gewaehlt. Den englischen Servertext
 * information zeigt das Modul nicht an; er ist weder uebersetzt noch fuer
 * Kunden geschrieben und darf sich ohne Modul-Release aendern.
 *
 * GRENZE
 *
 * Ohne code, mit einem unbekannten code oder bei einer unlesbaren Antwort
 * bleibt es beim bisherigen Hinweis CodeInvalid. Ein Server vor clou-T-513
 * sendet kein code, dort aendert sich also nichts. Die neuen Hinweise wirken
 * erst, wenn clou-T-513 live ist; clou-T-481 allein liefert nur information.
 *
 * foundry-id-revoked faellt ebenfalls auf CodeInvalid, obwohl der Code dort
 * nicht verbraucht ist. Heute unerreichbar, denn connectWithCode sendet kein
 * faehig=1. Ein Modul, das faehig=1 sendet, braucht dafuer einen eigenen Fall.
 */

const CODE_INVALID = "BENEOS.Cloud.Notification.CodeInvalid"
const NICHT_VERBUNDEN = "BENEOS.Cloud.Notification.CodeAcceptedNotConnected"
const FEHLGESCHLAGEN = "BENEOS.Cloud.Notification.SignInFailed"

// INTENTIONAL-SPECIAL-CASE: die code-Werte setzt foundry-otp-verify.php im
// beneos-cloud-server (clou-T-513). "code-invalid" fehlt hier mit Absicht,
// es faellt auf den Rueckfall CodeInvalid.
const SCHLUESSEL = new Map([
  ["account-create-failed", NICHT_VERBUNDEN],
  ["bind-failed", NICHT_VERBUNDEN],
  ["missing-parameters", FEHLGESCHLAGEN],
])

/**
 * @param {unknown} antwort  die gelesene JSON-Antwort von foundry-otp-verify.php
 * @returns {string} i18n-Schluessel fuer ui.notifications.error
 */
export function otpFehlerSchluessel(antwort) {
  const code = antwort && typeof antwort === "object" ? antwort.code : undefined
  return SCHLUESSEL.get(code) ?? CODE_INVALID
}
