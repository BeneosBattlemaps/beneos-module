/**
 * stream-zusage.test.mjs - sagt das Modul eine Offline-Karte per POST zu?
 * Seit stre-T-137.
 *
 * Die Zusage schreibt beim Tor in den Rechtespeicher und belegt Kontingent.
 * Bis stre-T-137 lief sie per GET, und ein GET darf vorab geholt werden: ein
 * Browser, der eine Adresse vorlaedt, ein Vorschau-Bot, ein Zwischenspeicher.
 * Einen POST holt niemand vorab. Das Tor nimmt seit stre-T-136 beides an,
 * aeltere Modulstaende bleiben also beim GET und verlieren nichts.
 *
 * Geprueft wird am echten `karteZusagen` und `karteLoesen`, das Tor ist eine
 * Attrappe. Ein Abruf, den dieser Satz nicht kennt, macht ihn rot.
 *
 * Aufruf: node scripts/stream/stream-zusage.test.mjs
 */
import { pruefstand, installiereFoundry, netz, nimmAbrufe } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, abschnitt, ende } = pruefstand("stream-zusage, Offline-Zusage per POST")

const BASIS = "https://gate.beneos.stream"
const SCHLUESSEL = "k-attrappe-0001"
installiereFoundry({
  einstellungen: {
    "beneos-stream-mode": true,
    "beneos-stream-key": SCHLUESSEL,
    "beneos-stream-base": BASIS,
    "beneos-stream-offline-held": {},
    "beneos-stream-offline-shared": {},
  },
})

const { karteZusagen, karteLoesen } = await import("./stream-offline.mjs")

const KARTE = { release: "beneos_bm_0001", variant: "4k", karte: "k1" }
const ZUSAGE = `${BASIS}/offline/${SCHLUESSEL}/beneos_bm_0001/4k/k1`
const json = (status, wert) => new Response(JSON.stringify(wert), { status, headers: { "content-type": "application/json" } })
const auftrag = (extra = {}) => ({ ...KARTE, name: "Probe", urls: [`${BASIS}/a/${SCHLUESSEL}/beneos_bm_0001/4k/k1.webp`], bytes: 10, geteilt: [], ...extra })

/** Ruft und faengt: ein Wurf wird eine rote Probe, kein Absturz des Satzes. */
async function versuche(fn) {
  try { return await fn() } catch (f) { return { wurf: String(f?.message || f).slice(0, 120) } }
}

const torAbrufe = () => nimmAbrufe().filter((a) => a.adresse.startsWith(`${BASIS}/offline/`))

abschnitt("Die Zusage geht als POST an die Kartenadresse")
{
  netz((adresse) => adresse === ZUSAGE
    ? json(409, { ok: false, reason: "quota", used: 1, quota: 2, needs: 3, free: 1 })
    : undefined)
  nimmAbrufe()
  const r = await versuche(() => karteZusagen(auftrag()))
  const tor = torAbrufe()
  gleich("genau ein Abruf beim Tor", tor.length, 1)
  gleich("die Zusage geht als POST", String(tor[0]?.optionen?.method || "GET").toUpperCase(), "POST")
  gleich("die Zusage geht an die Kartenadresse ohne /release", tor[0]?.adresse, ZUSAGE)
  gleich("409 quota ergibt grund kontingent", r?.grund, "kontingent")
  gleich("409 quota traegt die Zahlen des Tors", JSON.stringify([r?.belegt, r?.grenze, r?.braucht, r?.frei]), "[1,2,3,1]")
}

abschnitt("Ohne Netz: kein-netz, kein Absturz")
{
  netz((adresse) => adresse === ZUSAGE ? { wirf: "Failed to fetch" } : undefined)
  nimmAbrufe()
  const r = await versuche(() => karteZusagen(auftrag()))
  gleich("Netzfehler ergibt grund kein-netz", r?.grund, "kein-netz")
}

abschnitt("Die Freigabe bleibt POST auf /release")
{
  netz((adresse) => {
    if (adresse === ZUSAGE) return json(200, { ok: true })
    if (adresse === `${ZUSAGE}/release`) return json(200, { ok: true })
    if (adresse.startsWith(`${BASIS}/a/`)) return new Response("bild", { status: 200 })
    return undefined
  })
  nimmAbrufe()
  const zu = await versuche(() => karteZusagen(auftrag()))
  gleich("Zusage mit ok des Tors gelingt", zu?.ok, true)
  nimmAbrufe()
  const los = await versuche(() => karteLoesen(KARTE.release, KARTE.variant, KARTE.karte))
  const tor = torAbrufe()
  gleich("Loesen gelingt", los?.ok, true)
  gleich("genau ein Abruf beim Tor beim Loesen", tor.length, 1)
  gleich("die Freigabe geht an /release", tor[0]?.adresse, `${ZUSAGE}/release`)
  gleich("die Freigabe geht als POST", String(tor[0]?.optionen?.method || "GET").toUpperCase(), "POST")
}

ende()
