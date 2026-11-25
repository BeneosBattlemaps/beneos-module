/**
 * anmelde-anfrage.test.mjs - gehen E-Mail, Code und Weltkennung der
 * Code-Anmeldung als POST-Formular statt in der Adresse, und ist der
 * Passwortweg fort? Seit stre-T-494.
 *
 * ANLASS. Auf stream-beta schickte `loginRequest` E-Mail und Passwort als
 * Adressparameter an foundry-login.php, und die drei Aufrufe der
 * Code-Anmeldung (foundry-otp-request.php, -verify.php, -status.php) trugen
 * E-Mail, Code und Weltkennung im Query-String. Adressen landen in
 * Webserver-, Proxy- und CDN-Protokollen. Main hat den Passwortweg mit MO-036
 * entfernt und die Aufrufe mit MO-054 (2be6a73) auf POST gestellt; dieser Satz
 * ist nach dem Satz von MO-054 gebaut und um die Weltkennung aus stre-T-135
 * erweitert: `faehig=1` und die Kennung reisen im Rumpf, und nach
 * `foundry-id-revoked` traegt der zweite Ruf die neu gewuerfelte Kennung.
 *
 * GRENZE. Der Satz deckt die drei Anmelde-Endpunkte. Nach einer gelungenen
 * Anmeldung fragt pollForAccess foundry-manager.php weiter per GET mit der
 * Weltkennung in der Adresse (`?check=1&foundryId=`); der Server liest sie
 * dort nur aus $_GET. Das ist Bestand und eigener Folgepunkt, die Proben
 * ersetzen pollForAccess deshalb durch eine Attrappe.
 *
 * Serververtrag (beneos-cloud-server, lib/anfrage-quelle.php): Steht das
 * Traegerfeld des Endpunkts im Rumpf, liest der Server NUR den Rumpf. Darum
 * gehoeren alle Felder hinein, auch otpv, confirmCreate und faehig.
 *
 * Kein Netz: `fetch` ist die Attrappe aus tools/lib/foundry-attrappe.mjs.
 *
 * Aufruf: node scripts/cloud-v2/anmelde-anfrage.test.mjs
 */
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { pruefstand, installiereFoundry, netz, nimmAbrufe } from "../../tools/lib/foundry-attrappe.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const { gleich, struktur, abschnitt, ende } = pruefstand("stre-T-494: Code-Anmeldung per POST, kein Passwortweg")

const HELFER = join(HIER, "anmelde-anfrage.mjs")
const anmeldeAnfrage = existsSync(HELFER)
  ? (await import(pathToFileURL(HELFER).href)).anmeldeAnfrage
  : () => ({ url: "fehlt?", init: {} })

const BASIS = "https://beneos.cloud"
const EMAIL = "gm@example.org"
const CODE = "654321"
const WELT = "weltkennung00000000000000000001"
const GEWUERFELT = "zufall0000000000"
const ATTRAPPE = "ATTRAPPEgeheim"

const rumpf = (init) => (init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : null)

// --------------------------------------------------------------- 1. Helfer
abschnitt("Helfer anmeldeAnfrage")
{
  const { url, init } = anmeldeAnfrage(BASIS, "foundry-otp-verify.php", { email: EMAIL, code: CODE, foundryId: WELT })
  gleich("Helfer: die Adresse ist der nackte Endpunkt", url, `${BASIS}/foundry-otp-verify.php`)
  gleich("Helfer: Methode POST", init?.method, "POST")
  gleich("Helfer: credentials same-origin wie vorher", init?.credentials, "same-origin")
  gleich("Helfer: der Rumpf traegt alle Felder", JSON.stringify(rumpf(init)), JSON.stringify({ email: EMAIL, code: CODE, foundryId: WELT }))
}
{
  const { init } = anmeldeAnfrage(BASIS, "foundry-otp-request.php", { email: EMAIL, a: undefined, b: null, c: "" })
  gleich("Helfer: undefined, null und leer fallen weg", JSON.stringify(rumpf(init)), JSON.stringify({ email: EMAIL }))
}
{
  const a = anmeldeAnfrage(BASIS, "foundry-otp-verify.php", { email: EMAIL, code: CODE, foundryId: "k1", faehig: "1" })
  const b = anmeldeAnfrage(BASIS, "foundry-otp-verify.php", { email: EMAIL, code: CODE, foundryId: "k2", faehig: "1" })
  gleich("Zwei Werte: eine andere Kennung aendert den Rumpf", a.init?.body?.toString() !== b.init?.body?.toString(), true)
  gleich("Zwei Werte: die Adresse bleibt dieselbe", a.url, b.url)
  gleich("Zwei Werte: faehig=1 steht im Rumpf", a.init?.body?.get?.("faehig"), "1")
}
{
  const { init } = anmeldeAnfrage(BASIS, "foundry-otp-status.php", { email: "a+b&c@example.org" })
  gleich("Helfer: Sonderzeichen werden einmal formularkodiert", init?.body?.toString(), "email=a%2Bb%26c%40example.org")
}

// ------------------------------------------------------- 2. Verdrahtung
installiereFoundry({ einstellungen: {} })
game.beneos = {}
const { BeneosCloudLogin } = await import("../beneos_cloud.js")

/** Liefert der Reihe nach `antworten` als JSON, jede Adresse gilt als bekannt. */
function stelleNetz(...antworten) {
  let n = 0
  netz(() => new Response(JSON.stringify(antworten[Math.min(n++, antworten.length - 1)]), { status: 200 }))
  nimmAbrufe()
}

/** Ein Aufruf ohne Parameter und ohne Wert in der Adresse, als POST-Formular. */
function postOhneAdresswerte(abruf, endpunkt) {
  const a = String(abruf?.adresse ?? "")
  return a.endsWith(`/${endpunkt}`) && !a.includes("?")
    && ![EMAIL, encodeURIComponent(EMAIL), CODE, WELT, ATTRAPPE].some((w) => a.includes(w))
    && abruf.optionen?.method === "POST" && abruf.optionen?.body instanceof URLSearchParams
}

// Eine echte Instanz, kein Object.create: der alte Passwortweg rief die
// private Methode #loginAbruf, und die wirft auf einem blossen Prototypobjekt.
// Die Probe "kein Abruf traegt das Passwort" waere dann gruen, ohne dass der
// Weg je lief (an e1a5e1d gemessen).
function login() {
  const l = new BeneosCloudLogin()
  l.scheduleDeliveryCheck = () => {}
  l.codeDialog = async () => ({ code: ` ${CODE} ` })
  l.rememberLoginEmail = () => {}
  l.gepollt = []
  l.pollForAccess = (k) => { l.gepollt.push(k) }
  return l
}

abschnitt("requestCode")
{
  stelleNetz({ result: "OK", ttl: 600 })
  await Object.create(BeneosCloudLogin.prototype).requestCode(EMAIL, WELT, false)
  const [abruf, ...rest] = nimmAbrufe()
  gleich("requestCode: genau ein Abruf", rest.length, 0)
  gleich("requestCode: POST an foundry-otp-request.php ohne Adresswerte", postOhneAdresswerte(abruf, "foundry-otp-request.php"), true)
  gleich("requestCode: email, foundryId und otpv=2 im Rumpf, kein confirmCreate",
    JSON.stringify(rumpf(abruf?.optionen)), JSON.stringify({ email: EMAIL, foundryId: WELT, otpv: "2" }))
}
{
  stelleNetz({ result: "OK", ttl: 600 })
  await Object.create(BeneosCloudLogin.prototype).requestCode(EMAIL, WELT, true)
  const [abruf] = nimmAbrufe()
  gleich("requestCode mit Bestaetigung: confirmCreate ist der Text 1", rumpf(abruf?.optionen)?.confirmCreate, "1")
}

abschnitt("Verify mit Weltkennung")
{
  stelleNetz({ result: "OK", ttl: 600 }, { result: "OK" })
  const l = login()
  await l.connectWithCode(EMAIL, WELT)
  const abrufe = nimmAbrufe()
  const verify = abrufe.filter((x) => String(x.adresse).includes("foundry-otp-verify"))
  gleich("verify: genau ein Abruf", verify.length, 1)
  gleich("verify: POST an foundry-otp-verify.php ohne Adresswerte", postOhneAdresswerte(verify[0], "foundry-otp-verify.php"), true)
  gleich("verify: email, code, Kennung und faehig=1 im Rumpf",
    JSON.stringify(rumpf(verify[0]?.optionen)), JSON.stringify({ email: EMAIL, code: CODE, foundryId: WELT, faehig: "1" }))
  gleich("verify: gepollt wird mit der Kennung der Welt", JSON.stringify(l.gepollt), JSON.stringify([WELT]))
}
{
  stelleNetz({ result: "OK", ttl: 600 }, { result: "error", code: "foundry-id-revoked" }, { result: "OK" })
  const l = login()
  await l.connectWithCode(EMAIL, WELT)
  const verify = nimmAbrufe().filter((x) => String(x.adresse).includes("foundry-otp-verify"))
  gleich("gesperrt: zwei verify-Rufe", verify.length, 2)
  gleich("gesperrt: der erste Ruf traegt die Kennung der Welt", rumpf(verify[0]?.optionen)?.foundryId, WELT)
  gleich("gesperrt: der zweite Ruf traegt die neu gewuerfelte Kennung", rumpf(verify[1]?.optionen)?.foundryId, GEWUERFELT)
  gleich("gesperrt: auch der zweite Ruf traegt faehig=1", rumpf(verify[1]?.optionen)?.faehig, "1")
  gleich("gesperrt: auch der zweite Ruf ist ein POST ohne Adresswerte", postOhneAdresswerte(verify[1], "foundry-otp-verify.php"), true)
  gleich("gesperrt: gepollt wird mit der neuen Kennung", JSON.stringify(l.gepollt), JSON.stringify([GEWUERFELT]))
}

abschnitt("Zustellstatus")
{
  stelleNetz({ result: "OK", deliverable: true })
  const zeitgeber = globalThis.setTimeout
  let rueckruf = null
  globalThis.setTimeout = (fn) => { rueckruf = fn; return 0 }
  try { Object.create(BeneosCloudLogin.prototype).scheduleDeliveryCheck(EMAIL) } finally { globalThis.setTimeout = zeitgeber }
  if (typeof rueckruf === "function") await rueckruf()
  const [abruf] = nimmAbrufe()
  gleich("status: POST an foundry-otp-status.php ohne Adresswerte", postOhneAdresswerte(abruf, "foundry-otp-status.php"), true)
  gleich("status: nur email im Rumpf", JSON.stringify(rumpf(abruf?.optionen)), JSON.stringify({ email: EMAIL }))
}

abschnitt("Kein Passwortweg")
{
  // Ein alter Dialogwert mit Passwort: es darf nirgends hin gesendet werden.
  stelleNetz({ result: "OK", ttl: 600 }, { result: "OK" })
  const l = login()
  l.loginDialog = async () => ({ email: EMAIL, password: ATTRAPPE })
  game.settings.get = (_m, name) => (name === "beneos-cloud-foundry-id" ? WELT : undefined)
  await l.loginRequest()
  await new Promise((r) => setTimeout(r, 0))
  const abrufe = nimmAbrufe()
  gleich("Passwortdialog: kein Abruf traegt das Passwort",
    abrufe.some((x) => String(x.adresse).includes(ATTRAPPE) || String(x.optionen?.body ?? "").includes(ATTRAPPE)), false)
  gleich("Passwortdialog: kein Abruf an foundry-login.php", abrufe.some((x) => String(x.adresse).includes("foundry-login")), false)
}
{
  const quelle = readFileSync(join(HIER, "..", "beneos_cloud.js"), "utf8")
  const zahl = (s) => quelle.split(s).length - 1
  struktur("kein password= im Modul", zahl("password="), 0)
  struktur("kein foundry-login im Modul", zahl("foundry-login"), 0)
  struktur("kein Anmelde-Endpunkt mit Query-String", /foundry-otp-(request|verify|status)\.php\?/.test(quelle), false)
  struktur("alle drei Anmelde-Endpunkte gehen ueber anmeldeAnfrage",
    zahl("anmeldeAnfrage(BeneosUtility.cloudBase(), \"foundry-otp-"), 3)
}

ende()
