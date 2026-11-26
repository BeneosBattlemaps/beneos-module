/**
 * Baut die Anfragen an die Beneos Cloud, die eine Kennung oder Anmeldedaten
 * tragen: die Anmelde-Endpunkte (foundry-otp-request.php,
 * foundry-otp-verify.php, foundry-otp-status.php) und foundry-manager.php.
 *
 * ANLASS MO-054. E-Mail, Code und Foundry-ID standen im Query-String und damit
 * in jedem Zugriffsprotokoll auf dem Weg (Webserver, Proxy, CDN). Jetzt gehen
 * sie als Formular-Rumpf per POST. MO-064 zog foundry-manager.php nach.
 *
 * JSON liest der Server an diesen Endpunkten nicht, deshalb URLSearchParams;
 * fetch setzt damit den Content-Type application/x-www-form-urlencoded selbst.
 * Ein solcher POST braucht keinen CORS-Preflight.
 */

/**
 * Formular-Rumpf aus Feldern. Felder mit undefined, null oder leerem Text
 * fallen weg, URLSearchParams machte sonst den Text "undefined" daraus. Jeder
 * Wert reist als Text (String(wert)).
 *
 * @param {Record<string, string|number|undefined|null>} felder
 * @returns {URLSearchParams}
 */
function formRumpf(felder) {
  const body = new URLSearchParams()
  for (const [name, wert] of Object.entries(felder)) {
    if (wert === undefined || wert === null || wert === "") continue
    body.append(name, String(wert))
  }
  return body
}

/**
 * Anfrage an einen Anmelde-Endpunkt.
 *
 * Serververtrag (beneos-cloud-server, lib/anfrage-quelle.php): Steht das
 * Traegerfeld des Endpunkts im Rumpf, liest der Server NUR den Rumpf, sonst nur
 * die Adresse. Darum gehoeren immer ALLE Felder in den Rumpf und keines in die
 * URL. otpv liest der Server als Zahl ab 2, bei confirmCreate zaehlt der Wert
 * '1': ein Boolean wuerde zu "true" und fiele durch.
 *
 * @param {string} basis     Cloud-Basis ohne Schraegstrich am Ende
 * @param {string} endpunkt  Dateiname des Endpunkts, z. B. "foundry-otp-status.php"
 * @param {Record<string, string|number|undefined|null>} felder
 * @returns {{ url: string, init: RequestInit }}
 */
export function anmeldeAnfrage(basis, endpunkt, felder) {
  return {
    url: `${basis}/${endpunkt}`,
    init: { method: "POST", body: formRumpf(felder), credentials: "same-origin" },
  }
}

/**
 * Anfrage an foundry-manager.php mit der Kennung der Welt im Rumpf (MO-064).
 *
 * Serververtrag (beneos-cloud-server, clou-T-278): foundry-manager.php liest
 * NUR die foundryId aus dem Formular-Rumpf. Aktion und Nebenwerte (check,
 * get_token, tokenKey, since, surface, ...) liest er weiter aus der Adresse;
 * sie gehoeren deshalb in `adresse`, nicht in den Rumpf. Ausnahme
 * country_prompt: dort liest er action und country aus dem Rumpf (`rumpf`),
 * ein POST ohne action liest den Zustand.
 *
 * Die Kennung reist immer, auch leer. Eine leere Kennung beantwortet der Server
 * so wie bisher in der Adresse ("User not found"); fiele sie weg, hiesse die
 * Antwort "No FoundryId provided". Die Serverprobe ohne Anmeldung soll sich
 * nicht aendern.
 *
 * @param {string} basis    Cloud-Basis ohne Schraegstrich am Ende
 * @param {Record<string, string|number|undefined|null>} adresse  Aktion und Nebenwerte
 * @param {string|undefined|null} foundryId
 * @param {{ rumpf?: Record<string, string|number|undefined|null>, init?: RequestInit }} [weiteres]
 *        rumpf: weitere Rumpffelder; init: Optionen der Stelle (credentials,
 *        cache, signal, mode). method und body setzt dieser Helfer.
 * @returns {{ url: string, init: RequestInit }}
 */
export function foundryManagerAnfrage(basis, adresse, foundryId, { rumpf = {}, init = {} } = {}) {
  const body = formRumpf(rumpf)
  body.set("foundryId", String(foundryId ?? ""))
  // Ein Feld foundryId in `adresse` braechte die Kennung zurueck ins
  // Zugriffsprotokoll, ohne dass der Server es merkt (er liest dann den Rumpf).
  const felder = formRumpf(adresse)
  felder.delete("foundryId")
  return {
    url: `${basis}/foundry-manager.php?${felder}`,
    init: { ...init, method: "POST", body },
  }
}
