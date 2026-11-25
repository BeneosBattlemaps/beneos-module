/**
 * cloud-login-code.test.mjs
 *
 * Pruefsatz zu tick-T-050 mit T-051: die Code-Anmeldung auf Stufe otpv=3.
 *
 *   node scripts/cloud-login-code.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 * Jede Probe ist im Sabotagelaeufer bewacht (`tools/stream-sabotagen.mjs`,
 * Satz `anmeldecode`). Kein Netz: `sende` und `frage` sind Attrappen.
 */
import { pruefstand } from "../tools/lib/foundry-attrappe.mjs"

let modul = null
try { modul = await import("./cloud-login-code.mjs") } catch (_e) { modul = null }
const anfrageAdresse = modul?.anfrageAdresse ?? (() => "")
const pruefAdresse = modul?.pruefAdresse ?? (() => "")
const anfrageStufe = modul?.anfrageStufe ?? (() => ({}))
const pruefen = modul?.pruefenMitRueckfrage ?? (async () => ({ daten: {}, kennung: "", wahl: null }))
const ausgang = modul?.ausgangNachPruefung ?? (() => "")
const htmlSicher = modul?.htmlSicher ?? ((s) => s)

const t = pruefstand("tick-T-050: Code-Anmeldung otpv=3")

const BASIS = "https://cloud.example"
const ALT = "kennungalt000000000000000000001"
const NEU = "kennungneu000000000000000000002"
const NEUKONTO = { result: "new_account" }

/** Eine Cloud-Attrappe: Antworten der Reihe nach, jeder Ruf merkt Kennung und Bestaetigung. */
function cloud(...antworten) {
  const rufe = []
  const sende = async (kennung, bestaetigt) => { rufe.push({ kennung, bestaetigt: !!bestaetigt }); return antworten[rufe.length - 1] ?? { result: "error" } }
  return { sende, rufe }
}
/** Eine Rueckfrage-Attrappe, die zaehlt, wie oft sie gestellt wurde. */
function fragt(wahl) {
  const f = async () => { f.mal += 1; return wahl }
  f.mal = 0
  return f
}
const wuerfle = () => NEU

t.abschnitt("Vorbedingung")
t.gleich("das Modul laesst sich laden", modul !== null, true)

t.abschnitt("Adressen")
{
  const a = anfrageAdresse(BASIS, "a+b@x.example", "k1", false)
  t.gleich("Anfrage meldet otpv=3", a.includes("&otpv=3"), true)
  t.gleich("Anfrage ohne Bestaetigung traegt kein confirmCreate", a.includes("confirmCreate"), false)
  t.gleich("Anfrage kodiert die Adresse", a.includes("email=a%2Bb%40x.example"), true)
  t.gleich("Anfrage mit Bestaetigung traegt confirmCreate=1", anfrageAdresse(BASIS, "a@x", "k1", true).endsWith("&confirmCreate=1"), true)
  const p = pruefAdresse(BASIS, "a@x", "123456", "k1", false)
  t.gleich("Pruefung meldet otpv=3", p.includes("&otpv=3"), true)
  t.gleich("Pruefung traegt faehig=1", p.endsWith("&faehig=1"), true)
  t.gleich("Pruefung ohne Bestaetigung traegt kein confirmCreate", p.includes("confirmCreate"), false)
  t.gleich("Pruefung mit Bestaetigung traegt confirmCreate=1", pruefAdresse(BASIS, "a@x", "123456", "k1", true).includes("&confirmCreate=1"), true)
}

t.abschnitt("Antworten beim Anfordern")
{
  t.gleich("OK: Stufe ok mit ttl", JSON.stringify(anfrageStufe({ result: "OK", ttl: 300 })), JSON.stringify({ status: "ok", ttl: 300, retryAfter: 0, meldung: null }))
  t.gleich("OK ohne ttl: 600", anfrageStufe({ result: "OK" }).ttl, 600)
  t.gleich("send_failed: eigene Meldung CodeSendFailed", anfrageStufe({ result: "send_failed" }).meldung, "BENEOS.Cloud.Notification.CodeSendFailed")
  t.gleich("send_failed: Stufe error", anfrageStufe({ result: "send_failed" }).status, "error")
  t.gleich("unbekannte Antwort: LoginFailed wie bisher", anfrageStufe({ result: "error" }).meldung, "BENEOS.Cloud.Notification.LoginFailed")
  t.gleich("rate_limited: retry_after kommt mit", anfrageStufe({ result: "rate_limited", retry_after: 42 }).retryAfter, 42)
  t.gleich("new_account beim Anfordern (alter Server): keine Meldung", anfrageStufe({ result: "new_account" }).meldung, null)
  t.gleich("undeliverable: Meldung wie bisher", anfrageStufe({ result: "undeliverable" }).meldung, "BENEOS.Cloud.Notification.CodeUndeliverable")
}

t.abschnitt("Pruefen mit Rueckfrage")
{
  const c = cloud({ result: "OK", foundry_id: ALT })
  const f = fragt("create")
  const r = await pruefen(c.sende, ALT, wuerfle, f, false)
  t.gleich("Konto: ein Ruf, keine Rueckfrage", [c.rufe.length, f.mal].join(","), "1,0")
  t.gleich("Konto: die Antwort kommt zurueck", r.daten?.result, "OK")
}
{
  const c = cloud(NEUKONTO, { result: "OK" })
  const f = fragt("create")
  const r = await pruefen(c.sende, ALT, wuerfle, f, false)
  t.gleich("neu und anlegen: genau eine Rueckfrage", f.mal, 1)
  t.gleich("neu und anlegen: zwei Rufe", c.rufe.length, 2)
  t.gleich("neu und anlegen: erster Ruf ohne, zweiter mit Bestaetigung", c.rufe.map((x) => x.bestaetigt).join(","), "false,true")
  t.gleich("neu und anlegen: beide Rufe mit derselben Kennung", c.rufe.map((x) => x.kennung).join(","), `${ALT},${ALT}`)
  t.gleich("neu und anlegen: die Antwort des zweiten Rufs kommt zurueck", r.daten?.result, "OK")
  t.gleich("neu und anlegen: die Wahl kommt zurueck", r.wahl, "create")
}
{
  const c = cloud(NEUKONTO, { result: "OK" })
  const r = await pruefen(c.sende, ALT, wuerfle, fragt("check"), false)
  t.gleich("neu und pruefen: kein zweiter Ruf", c.rufe.length, 1)
  t.gleich("neu und pruefen: die Wahl kommt zurueck", r.wahl, "check")
}
{
  const c = cloud(NEUKONTO, { result: "OK" })
  const r = await pruefen(c.sende, ALT, wuerfle, fragt(null), false)
  t.gleich("neu und geschlossen: kein zweiter Ruf", c.rufe.length, 1)
  t.gleich("neu und geschlossen: new_account bleibt die Antwort", r.daten?.result, "new_account")
}
{
  // Ein alter Server fragte schon beim Anfordern; die Bestaetigung geht gleich mit.
  const c = cloud({ result: "OK" })
  const f = fragt("create")
  await pruefen(c.sende, ALT, wuerfle, f, true)
  t.gleich("schon bestaetigt: Ruf mit Bestaetigung, keine Rueckfrage", `${c.rufe[0]?.bestaetigt},${f.mal}`, "true,0")
}
{
  const c = cloud(NEUKONTO, { result: "OK" })
  const f = fragt("create")
  await pruefen(c.sende, ALT, wuerfle, f, true)
  t.gleich("schon bestaetigt und new_account: keine zweite Rueckfrage", `${c.rufe.length},${f.mal}`, "1,0")
}
{
  // Gesperrte Kennung vor der Rueckfrage: neu gewuerfelt, danach gilt die neue Kennung.
  const c = cloud({ result: "error", code: "foundry-id-revoked" }, NEUKONTO, { result: "OK" })
  const r = await pruefen(c.sende, ALT, wuerfle, fragt("create"), false)
  t.gleich("gesperrt, dann neu: der Bestaetigungsruf traegt die neue Kennung", c.rufe[2]?.kennung, NEU)
  t.gleich("gesperrt, dann neu: die neue Kennung kommt zurueck", r.kennung, NEU)
}

{
  // Gesperrte Kennung erst beim Bestaetigungsruf: auch dort genau einmal neu gewuerfelt.
  const c = cloud(NEUKONTO, { result: "error", code: "foundry-id-revoked" }, { result: "OK" })
  const r = await pruefen(c.sende, ALT, wuerfle, fragt("create"), false)
  t.gleich("gesperrt beim Bestaetigen: drei Rufe", c.rufe.length, 3)
  t.gleich("gesperrt beim Bestaetigen: erst alte, dann neue Kennung, beide bestaetigt", JSON.stringify(c.rufe.slice(1)), JSON.stringify([{ kennung: ALT, bestaetigt: true }, { kennung: NEU, bestaetigt: true }]))
  t.gleich("gesperrt beim Bestaetigen: die neue Kennung kommt zurueck", r.kennung, NEU)
}

t.abschnitt("Ausgang nach dem Pruefen")
t.gleich("HTTP-Fehler: nichts weiter, auch nach check", `${ausgang({ result: "http" }, null)},${ausgang({ result: "http" }, "check")}`, "http,http")
t.gleich("check: zurueck zum Formular", ausgang({ result: "new_account" }, "check"), "zurueck")
t.gleich("Rueckfrage geschlossen: still", ausgang({ result: "new_account" }, null), "still")
t.gleich("OK: anmelden, auch nach create", `${ausgang({ result: "OK" }, null)},${ausgang({ result: "OK" }, "create")}`, "anmelden,anmelden")
t.gleich("Fehler oder new_account nach create: ungueltig", `${ausgang({ result: "error" }, null)},${ausgang({ result: "new_account" }, "create")}`, "ungueltig,ungueltig")

t.abschnitt("Anzeige")
t.gleich("htmlSicher maskiert < > & und Anfuehrungszeichen", htmlSicher("<a>&\"b"), "&lt;a&gt;&amp;&quot;b")

t.abschnitt("Einbindung in beneos_cloud.js")
{
  const { readFileSync } = await import("node:fs")
  const quelle = readFileSync(new URL("./beneos_cloud.js", import.meta.url), "utf8")
  const zahl = (s) => quelle.split(s).length - 1
  t.gleich("[Struktur] keine Anfrage mehr mit otpv=2", zahl("otpv=2"), 0)
  t.gleich("[Struktur] die Anfrage baut ihre Adresse ueber anfrageAdresse", zahl("const reqURL = anfrageAdresse("), 1)
  t.gleich("[Struktur] die Anfrage wertet ueber anfrageStufe aus", zahl("anfrageStufe(await resp.json())"), 1)
  t.gleich("[Struktur] die Pruefung fragt bei new_account ueber confirmNewAccountDialog", zahl("() => this.confirmNewAccountDialog(email), confirmed)"), 1)
  t.gleich("[Struktur] der Codedialog zeigt die Adresse von Anfang an", zahl("<p class=\"bc-login-form__email\">${safeEmail}</p>\n        <button type=\"button\" class=\"bc-login-form__resend\" data-bc-change-email>"), 1)
  t.gleich("[Struktur] connectWithCode verzweigt ueber ausgangNachPruefung", zahl("const ausgang = ausgangNachPruefung(data, wahl)\n      if (ausgang === \"http\" || ausgang === \"still\") return\n      if (ausgang === \"zurueck\") return this.loginRequest(null, email)\n      if (ausgang === \"anmelden\") {"), 1)
  t.gleich("[Struktur] die Rueckfrage beim Anfordern merkt die Bestaetigung", zahl("      confirmed = true\n      first = await this.requestCode(email, userId, true)"), 1)
  t.gleich("[Struktur] Adresse aendern fuehrt mit vorbefuellter Adresse zurueck", zahl("if (codeData && codeData.changeEmail) { return this.loginRequest(null, email) }"), 1)
  t.gleich("[Struktur] der Codedialog maskiert die Adresse ueber htmlSicher", zahl("const safeEmail = htmlSicher(email)"), 1)
  t.gleich("[Struktur] eine verwaiste Resend-Rueckfrage sendet nicht", zahl("const answer = await this.confirmEmailDialog(email)\n              // tick-T-050: the confirm dialog is not modal; if the code dialog closed\n              // meanwhile (Change email, Cancel), this answer must not send anything.\n              if (wantsEmailChange || !root.isConnected) return"), 1)
  t.gleich("[Struktur] der Knopf Adresse aendern schliesst mit Adresswechsel", zahl("querySelector(\"[data-bc-change-email]\")?.addEventListener(\"click\", () => {\n            wantsEmailChange = true"), 1)
}

t.abschnitt("Sprachen")
{
  const { readFileSync, readdirSync } = await import("node:fs")
  const dateien = readdirSync(new URL("../lang/", import.meta.url)).filter((d) => d.endsWith(".json"))
  const ohne = dateien.filter((d) => !JSON.parse(readFileSync(new URL(`../lang/${d}`, import.meta.url), "utf8"))["BENEOS.Cloud.Notification.CodeSendFailed"])
  t.gleich("alle Sprachdateien gelesen (mindestens 13)", dateien.length >= 13, true)
  t.gleich("jede Sprache traegt CodeSendFailed", ohne.join(","), "")
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"))
  t.gleich("englischer Wortlaut nach Betreiberentscheid E3", en["BENEOS.Cloud.Notification.CodeSendFailed"], "We could not send the code right now. Please try again in a moment.")
}

t.ende()
