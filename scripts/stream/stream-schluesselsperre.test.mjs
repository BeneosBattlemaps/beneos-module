/**
 * stream-schluesselsperre.test.mjs
 *
 * Pruefsatz zu stre-T-230: EIN ZURUECKGEHALTENER SCHLUESSEL WIRD DEM KUNDEN
 * GEZEIGT.
 *
 *   node scripts/stream/stream-schluesselsperre.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 * Jede Probe ist im Sabotagelaeufer bewacht (`tools/stream-sabotagen.mjs`,
 * Satz `schluesselsperre`).
 *
 * WARUM. Seit RG-326 (clou-T-482) antwortet `get_stream_key` mit HTTP 409
 * "Stream key withheld", wenn die Foundry-Kennung dieser Welt nicht mehr an
 * das Beneos-Konto gebunden ist. Vorher schrieb `ensureStreamKey` das nur in
 * die Konsole, und der Kunde sah keinen Grund fuer fehlende Karten. Jetzt
 * reicht das Modul den Servertext an `clearStaleEntitlement` (MO-046) weiter,
 * das den Hinweis zum neuen Anmelden zeigt.
 *
 * Die Gegenfaelle halten fest, was bleiben muss: 200 und jeder andere Status
 * rufen nichts auf, Schluessel und Kennung bleiben stehen, und es gibt keinen
 * zweiten Abruf.
 */
import { installiereFoundry, pruefstand } from "../../tools/lib/foundry-attrappe.mjs"

const { SETTING, ensureStreamKey } = await import("./stream-settings.mjs")

const ALT = "pk_pruefsatz_sperre_alt"
const KENNUNG = "pruef-sitzung"
const TEXT = "Stream key withheld. This Foundry ID is no longer linked to this Beneos account. Please sign in again."

const einstellungen = {
  [SETTING.key]: ALT,
  [SETTING.base]: "https://stream.beneos-battlemaps.com",
  [SETTING.mode]: true,
  [SETTING.nachzugRiegel]: "",
  "beneos-cloud-foundry-id": KENNUNG,
}
installiereFoundry({ einstellungen })

const t = pruefstand("stre-T-230: zurueckgehaltener Schluessel wird gezeigt")

/**
 * Ein Abruf mit fester Antwort. Liefert, was `ensureStreamKey` zurueckgab,
 * wie oft der Server gefragt wurde, welche Meldungen ankamen und welche
 * Einstellungen geschrieben wurden.
 */
async function lauf(status, rumpf, { mitCloud = true } = {}) {
  const rufe = []
  const schreiben = []
  let abrufe = 0
  const urFetch = globalThis.fetch
  const urSet = game.settings.set
  const urBeneos = game.beneos
  globalThis.fetch = async () => {
    abrufe++
    return new Response(JSON.stringify(rumpf), { status, headers: { "content-type": "application/json" } })
  }
  game.settings.set = async function (modul, name, wert) {
    schreiben.push(name)
    return urSet.call(this, modul, name, wert)
  }
  game.beneos = mitCloud ? { cloud: { clearStaleEntitlement: (m) => { rufe.push(m) } } } : undefined
  const warnungen = []
  const urWarn = console.warn
  console.warn = (...teile) => { warnungen.push(teile.map(String).join(" ")) }
  let wert
  let wurf = null
  try {
    wert = await ensureStreamKey()
  } catch (e) {
    wurf = e
  } finally {
    console.warn = urWarn
    globalThis.fetch = urFetch
    game.settings.set = urSet
    game.beneos = urBeneos
  }
  return { wert, wurf, rufe, schreiben, abrufe, warnungen }
}

{
  const r = await lauf(409, { status: "error", message: TEXT })
  t.gleich("409: genau eine Meldung", r.rufe.length, 1)
  t.gleich("409: die Meldung traegt den Servertext", r.rufe[0], TEXT)
  t.gleich("409: der vorhandene Schluessel kommt zurueck", r.wert, ALT)
  t.gleich("409: der Schluessel bleibt stehen", einstellungen[SETTING.key], ALT)
  t.gleich("409: die Kennung bleibt stehen", einstellungen["beneos-cloud-foundry-id"], KENNUNG)
  t.gleich("409: keine Einstellung wird geschrieben", r.schreiben.length, 0)
  t.gleich("409: kein zweiter Abruf", r.abrufe, 1)
  t.gleich("409: die Konsole nennt den Grund", r.warnungen.some((z) => z.includes("zurueckgehalten") && z.includes(TEXT)), true)
}

// Seit clou-T-531 traegt die 409 ein Feld `reason`. Der Block oben ist die
// Antwort eines Altservers ohne dieses Feld; sie muss weiter zum neuen
// Anmelden fuehren. Nur `busy` ist als harmlos bekannt, jeder andere Wert
// wird behandelt wie kein Wert, das Modul raet nicht.
const BESCHAEFTIGT = "Stream key temporarily unavailable, the account is busy. Please try again."

{
  const r = await lauf(409, { status: "error", message: TEXT, reason: "withheld" })
  t.gleich("409 withheld: genau eine Meldung", r.rufe.length, 1)
  t.gleich("409 withheld: die Meldung traegt den Servertext", r.rufe[0], TEXT)
}

{
  const r = await lauf(409, { status: "error", message: TEXT, reason: "spaeter" })
  t.gleich("409 unbekannter Grund: genau eine Meldung", r.rufe.length, 1)
}

{
  const r = await lauf(409, { status: "error", message: BESCHAEFTIGT, reason: "busy" })
  t.gleich("409 busy: keine Meldung", r.rufe.length, 0)
  t.gleich("409 busy: die Konsole nennt den Servertext", r.warnungen.some((z) => z.includes("vorlaeufig") && z.includes(BESCHAEFTIGT)), true)
  t.gleich("409 busy: der vorhandene Schluessel kommt zurueck", r.wert, ALT)
  t.gleich("409 busy: Schluessel und Kennung bleiben stehen", [einstellungen[SETTING.key], einstellungen["beneos-cloud-foundry-id"]].join("|"), `${ALT}|${KENNUNG}`)
  t.gleich("409 busy: keine Einstellung wird geschrieben", r.schreiben.length, 0)
  t.gleich("409 busy: kein zweiter Abruf", r.abrufe, 1)
}

{
  const r = await lauf(200, { status: "ok", stream_key: ALT })
  t.gleich("200: keine Meldung", r.rufe.length, 0)
}

{
  const r = await lauf(500, { status: "error", message: "Server error" })
  t.gleich("500: keine Meldung", r.rufe.length, 0)
  t.gleich("500: die Konsole meldet wie bisher", r.warnungen.some((z) => z.includes("nicht erhalten")), true)
}

{
  const r = await lauf(403, { status: "error", message: "Forbidden" })
  t.gleich("403: keine Meldung", r.rufe.length, 0)
  t.gleich("403: die Konsole meldet wie bisher", r.warnungen.some((z) => z.includes("nicht erhalten")), true)
}

{
  const r = await lauf(409, { status: "error", message: TEXT }, { mitCloud: false })
  // ensureStreamKey faengt jeden Wurf selbst ab. Ob der fehlende Griff
  // sauber uebergangen wird, zeigt deshalb der Fehlerweg in der Konsole.
  t.gleich("409 ohne Cloud: kein Wurf", r.wurf, null)
  t.gleich("409 ohne Cloud: kein Fehlerweg", r.warnungen.some((z) => z.includes("konnte nicht geholt werden")), false)
  t.gleich("409 ohne Cloud: der vorhandene Schluessel kommt zurueck", r.wert, ALT)
}

t.ende()
