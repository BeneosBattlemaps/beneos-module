/**
 * cloud-login-kennung.test.mjs
 *
 * Pruefsatz zu stre-T-135 (Weltmarke, weiche Sperre): die Anmeldung mit der
 * Kennung `beneos-cloud-foundry-id`.
 *
 *   node scripts/cloud-login-kennung.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 * Jede Probe ist im Sabotagelaeufer bewacht (`tools/stream-sabotagen.mjs`,
 * Satz `kennung`). Kein Netz: `sende` ist eine Attrappe.
 */
import { pruefstand } from "../tools/lib/foundry-attrappe.mjs"

let modul = null
try { modul = await import("./cloud-login-kennung.mjs") } catch (_e) { modul = null }
const anmelden = modul?.anmeldenMitKennung ?? (async (sende, k) => ({ daten: await sende(k), kennung: k }))
const mitFaehig = modul?.mitFaehig ?? ((felder) => felder)

const t = pruefstand("stre-T-135: Anmeldung mit der Weltkennung")

const ALT = "kennungalt000000000000000000001"
const NEU = "kennungneu000000000000000000002"
const GESPERRT = { result: "error", code: "foundry-id-revoked" }

/** Eine Cloud-Attrappe: Antworten der Reihe nach, jeder Ruf merkt die Kennung. */
function cloud(...antworten) {
  const rufe = []
  const sende = async (kennung) => { rufe.push(kennung); return antworten[rufe.length - 1] ?? { result: "error" } }
  return { sende, rufe }
}
let gewuerfelt = 0
const wuerfle = () => { gewuerfelt++; return NEU }

t.abschnitt("Vorbedingung")
t.gleich("das Modul laesst sich laden", modul !== null, true)

t.abschnitt("Gesperrte Kennung")
{
  gewuerfelt = 0
  const c = cloud(GESPERRT, { result: "OK" })
  const r = await anmelden(c.sende, ALT, wuerfle)
  t.gleich("gesperrt: genau ein Neuwuerfeln", gewuerfelt, 1)
  t.gleich("gesperrt: genau zwei Rufe", c.rufe.length, 2)
  t.gleich("gesperrt: der zweite Ruf traegt die neue Kennung", c.rufe[1], NEU)
  t.gleich("gesperrt: danach gilt die neue Kennung", r.kennung, NEU)
  t.gleich("gesperrt: die Antwort des zweiten Rufs kommt zurueck", r.daten?.result, "OK")
}
{
  gewuerfelt = 0
  const c = cloud(GESPERRT, GESPERRT, { result: "OK" })
  const r = await anmelden(c.sende, ALT, wuerfle)
  t.gleich("zweimal gesperrt: keine Schleife, zwei Rufe", c.rufe.length, 2)
  t.gleich("zweimal gesperrt: ein Neuwuerfeln", gewuerfelt, 1)
  t.gleich("zweimal gesperrt: der Fehler kommt zurueck", r.daten?.code, "foundry-id-revoked")
}

t.abschnitt("Wie heute")
{
  gewuerfelt = 0
  const c = cloud({ result: "OK" })
  const r = await anmelden(c.sende, ALT, wuerfle)
  t.gleich("OK ohne foundry_id: ein Ruf", c.rufe.length, 1)
  t.gleich("OK ohne foundry_id: die Kennung bleibt", r.kennung, ALT)
  t.gleich("OK ohne foundry_id: kein Neuwuerfeln", gewuerfelt, 0)
}
{
  gewuerfelt = 0
  const c = cloud({ result: "error" })
  const r = await anmelden(c.sende, ALT, wuerfle)
  t.gleich("anderer Fehler: ein Ruf, kein Neuwuerfeln", c.rufe.length + gewuerfelt, 1)
  t.gleich("anderer Fehler: die Kennung bleibt", r.kennung, ALT)
}
{
  const c = cloud({ result: "error", code: "anderes" })
  t.gleich("fremder Fehlercode: kein zweiter Ruf", (await anmelden(c.sende, ALT, wuerfle), c.rufe.length), 1)
}

t.abschnitt("foundry_id aus der Antwort")
{
  const c = cloud({ result: "OK", foundry_id: NEU })
  t.gleich("OK mit abweichender foundry_id: sie wird uebernommen", (await anmelden(c.sende, ALT, wuerfle)).kennung, NEU)
  const d = cloud({ result: "error", foundry_id: NEU })
  t.gleich("Fehler mit foundry_id: sie wird nicht uebernommen", (await anmelden(d.sende, ALT, wuerfle)).kennung, ALT)
  const e = cloud({ result: "OK", foundry_id: "a&b=c" })
  t.gleich("OK mit unsauberer foundry_id: sie wird nicht uebernommen", (await anmelden(e.sende, ALT, wuerfle)).kennung, ALT)
  const f = cloud({ result: "OK", foundry_id: "x".repeat(65) })
  t.gleich("OK mit zu langer foundry_id: sie wird nicht uebernommen", (await anmelden(f.sende, ALT, wuerfle)).kennung, ALT)
}

t.abschnitt("faehig")
// Seit stre-T-494 ein Feld im POST-Rumpf statt eines Anhangs an die Adresse.
{
  const felder = { email: "a", foundryId: "b" }
  t.gleich("die Felder bekommen faehig=1",
    JSON.stringify(mitFaehig(felder)), JSON.stringify({ email: "a", foundryId: "b", faehig: "1" }))
  t.gleich("die uebergebenen Felder bleiben unveraendert", JSON.stringify(felder), JSON.stringify({ email: "a", foundryId: "b" }))
}

t.abschnitt("Einbindung in beneos_cloud.js")
{
  // Der Baustein ist oben bewacht; hier der Anmeldeweg, der ihn nutzt. Seit
  // stre-T-494 ist es nur noch die Codeanmeldung: der Passwortweg ist mit
  // MO-036 (42b31f9) entfernt.
  const { readFileSync } = await import("node:fs")
  const quelle = readFileSync(new URL("./beneos_cloud.js", import.meta.url), "utf8")
  const zahl = (s) => quelle.split(s).length - 1
  t.gleich("[Struktur] die Codeanmeldung meldet sich ueber anmeldenMitKennung an", zahl("anmeldenMitKennung(sende, userId"), 1)
  t.gleich("[Struktur] die Codeanmeldung pollt mit der Kennung aus der Anmeldung", zahl("this.pollForAccess(kennung)"), 1)
  t.gleich("[Struktur] kein Weg pollt mit der alten Kennung", zahl("this.pollForAccess(userId)"), 0)
  t.gleich("[Struktur] es gibt keinen Passwortweg mehr", zahl("foundry-login.php"), 0)
  t.gleich("[Struktur] die Codeanmeldung traegt faehig=1",
    zahl("\"foundry-otp-verify.php\", mitFaehig({ email, code, foundryId: kennung })"), 1)
}

t.ende()
