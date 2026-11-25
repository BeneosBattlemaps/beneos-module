/**
 * cloud-login-code.mjs
 *
 * Die Code-Anmeldung, Stufe otpv=3 (tick-T-050 mit T-051).
 *
 * WARUM. Bis otpv=2 antwortete die Cloud schon beim Anfordern des Codes
 * verschieden, je nachdem ob es zur Adresse ein Konto gibt (new_account) oder
 * ob die Adresse gesperrt ist. Daran liess sich ablesen, wer Kunde ist. Mit
 * otpv=3 antwortet die Cloud beim Anfordern fuer jede Adresse gleich (OK,
 * ausser rate_limited, das an der Sendeachse haengt). Die Frage "neues Konto
 * anlegen?" kommt erst beim Pruefen des Codes, also nur zu jemandem, der das
 * Postfach liest. Die Cloud verbraucht den Code dabei nicht, derselbe Code
 * legt nach der Rueckfrage mit confirmCreate=1 an.
 *
 * Ein Server ohne diesen Bau behandelt otpv=3 wie otpv=2 und kann beim
 * Anfordern noch new_account melden; das Modul fragt dann wie bisher dort und
 * schickt die Bestaetigung beim Pruefen mit.
 *
 * Pruefsatz: `cloud-login-code.test.mjs`, Sabotagen im Satz `anmeldecode`.
 */

import { anmeldenMitKennung, mitFaehig } from "./cloud-login-kennung.mjs"

/** Die Stufe, die dieses Modul der Cloud meldet. */
export const OTP_STUFE = 3

/** Adresse zum Anfordern eines Codes. */
export function anfrageAdresse(basis, email, kennung, bestaetigt) {
  let url = `${basis}/foundry-otp-request.php?email=${encodeURIComponent(email)}&foundryId=${encodeURIComponent(kennung)}&otpv=${OTP_STUFE}`
  if (bestaetigt) url += "&confirmCreate=1"
  return url
}

/** Adresse zum Pruefen eines Codes, mit `faehig=1` fuer die Weltkennung. */
export function pruefAdresse(basis, email, code, kennung, bestaetigt) {
  let url = `${basis}/foundry-otp-verify.php?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}&foundryId=${encodeURIComponent(kennung)}&otpv=${OTP_STUFE}`
  if (bestaetigt) url += "&confirmCreate=1"
  return mitFaehig(url)
}

/**
 * Ordnet die Antwort auf das Anfordern einer Stufe zu. `meldung` ist der
 * Sprachschluessel, den der Aufrufer zeigt, oder null.
 *
 * @returns {{status:'ok'|'new_account'|'rate_limited'|'undeliverable'|'error', ttl:number, retryAfter:number, meldung:string|null}}
 */
export function anfrageStufe(daten) {
  const r = daten?.result
  if (r === "OK") return { status: "ok", ttl: Number(daten.ttl) || 600, retryAfter: 0, meldung: null }
  if (r === "new_account") return { status: "new_account", ttl: 0, retryAfter: 0, meldung: null }
  if (r === "rate_limited") return { status: "rate_limited", ttl: 0, retryAfter: Number(daten.retry_after) || 0, meldung: "BENEOS.Cloud.Notification.CodeRateLimited" }
  if (r === "undeliverable") return { status: "undeliverable", ttl: 0, retryAfter: 0, meldung: "BENEOS.Cloud.Notification.CodeUndeliverable" }
  // T-051: der Versand ist gescheitert, die Zugangsdaten sind nicht schuld.
  if (r === "send_failed") return { status: "error", ttl: 0, retryAfter: 0, meldung: "BENEOS.Cloud.Notification.CodeSendFailed" }
  return { status: "error", ttl: 0, retryAfter: 0, meldung: "BENEOS.Cloud.Notification.LoginFailed" }
}

/** Eine Adresse fuer die Anzeige im Dialog, HTML-sicher. */
export function htmlSicher(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]))
}

/**
 * Was nach dem Pruefen geschieht: "http" (Fehler schon gemeldet), "zurueck"
 * (Adresse pruefen, zum Formular), "still" (Rueckfrage geschlossen),
 * "anmelden" oder "ungueltig".
 */
export function ausgangNachPruefung(daten, wahl) {
  if (daten?.result === "http") return "http"
  if (wahl === "check") return "zurueck"
  if (daten?.result === "new_account" && wahl !== "create") return "still"
  if (daten?.result === "OK") return "anmelden"
  return "ungueltig"
}

/**
 * Prueft den Code und fragt bei new_account einmal nach. `sende(kennung,
 * bestaetigt)` ist ein Pruefruf, `frage()` liefert "create", "check" oder null.
 * Nach "create" geht derselbe Code mit confirmCreate an dieselbe Kennung.
 *
 * @returns {Promise<{daten: object, kennung: string, wahl: string|null}>}
 */
export async function pruefenMitRueckfrage(sende, kennung, wuerfle, frage, bestaetigt) {
  let { daten, kennung: k } = await anmeldenMitKennung((x) => sende(x, bestaetigt), kennung, wuerfle)
  if (daten?.result !== "new_account" || bestaetigt) return { daten, kennung: k, wahl: null }
  const wahl = await frage()
  if (wahl !== "create") return { daten, kennung: k, wahl }
  ;({ daten, kennung: k } = await anmeldenMitKennung((x) => sende(x, true), k, wuerfle))
  return { daten, kennung: k, wahl }
}
