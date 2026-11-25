/**
 * Baut die Anfrage an einen Anmelde-Endpunkt der Beneos Cloud
 * (foundry-otp-request.php, foundry-otp-verify.php, foundry-otp-status.php).
 *
 * ANLASS MO-054. E-Mail, Code und Foundry-ID standen im Query-String und damit
 * in jedem Zugriffsprotokoll auf dem Weg (Webserver, Proxy, CDN). Jetzt gehen
 * sie als Formular-Rumpf per POST.
 *
 * Serververtrag (beneos-cloud-server, lib/anfrage-quelle.php): Steht das
 * Traegerfeld des Endpunkts im Rumpf, liest der Server NUR den Rumpf, sonst nur
 * die Adresse. Darum gehoeren immer ALLE Felder in den Rumpf und keines in die
 * URL. JSON liest der Server nicht, deshalb URLSearchParams; fetch setzt damit
 * den Content-Type application/x-www-form-urlencoded selbst. Ein solcher POST
 * braucht keinen CORS-Preflight.
 *
 * Felder mit undefined, null oder leerem Text fallen weg. URLSearchParams
 * machte sonst den Text "undefined" daraus. Werte, die der Server strikt
 * vergleicht (confirmCreate === '1', otpv), uebergibt der Aufrufer als Text.
 *
 * @param {string} basis     Cloud-Basis ohne Schraegstrich am Ende
 * @param {string} endpunkt  Dateiname des Endpunkts, z. B. "foundry-otp-status.php"
 * @param {Record<string, string|number|undefined|null>} felder
 * @returns {{ url: string, init: RequestInit }}
 */
export function anmeldeAnfrage(basis, endpunkt, felder) {
  const body = new URLSearchParams()
  for (const [name, wert] of Object.entries(felder)) {
    if (wert === undefined || wert === null || wert === "") continue
    body.append(name, String(wert))
  }
  return {
    url: `${basis}/${endpunkt}`,
    init: { method: "POST", body, credentials: "same-origin" },
  }
}
