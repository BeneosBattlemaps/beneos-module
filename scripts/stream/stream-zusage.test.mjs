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

/**
 * Ein Cache Storage im Speicher, nur fuer diesen Satz.
 *
 * Ohne ihn scheitert `openStore()`, `offlineHalten` holt nichts, und die
 * Zusage gelingt trotzdem. Die Proben waeren dann ueber den Ausfallpfad gruen
 * statt ueber den Normalpfad (Kalt-Review stre-T-137).
 */
/**
 * Schalter fuer den Speicherausfall (stre-T-145). `wirfAb` ist der wievielte
 * Aufruf von `caches.open`, ab dem der Speicher wirft; 0 heisst nie. So
 * wirft ein beschaedigtes Chromium-Profil, gemessen am 31.08.2026.
 */
const schalter = { wirfAb: 0, geoeffnet: 0 }
const speicherFaellt = (ab) => { schalter.wirfAb = ab; schalter.geoeffnet = 0 }

function speicherAttrappe() {
  const schluessel = (anfrage, ohneSuche) => {
    const u = new URL(typeof anfrage === "string" ? anfrage : anfrage.url)
    if (ohneSuche) u.search = ""
    return u.href
  }
  const ablage = new Map()
  const store = {
    async match(anfrage, opt) {
      const k = schluessel(anfrage, opt?.ignoreSearch)
      for (const [s, r] of ablage) if (schluessel(s, opt?.ignoreSearch) === k) return r.clone()
      return undefined
    },
    async put(anfrage, antwort) { ablage.set(schluessel(anfrage, false), antwort.clone()) },
    async delete(anfrage, opt) {
      const k = schluessel(anfrage, opt?.ignoreSearch)
      let weg = false
      for (const s of [...ablage.keys()]) if (schluessel(s, opt?.ignoreSearch) === k) { ablage.delete(s); weg = true }
      return weg
    },
    async keys() { return [...ablage.keys()].map((s) => new Request(s)) },
  }
  globalThis.caches = {
    async open() {
      schalter.geoeffnet++
      if (schalter.wirfAb && schalter.geoeffnet >= schalter.wirfAb) {
        throw Object.assign(new Error("Unexpected internal error."), { name: "UnknownError" })
      }
      return store
    },
    async delete() { ablage.clear(); return true },
  }
  return ablage
}
const ablage = speicherAttrappe()

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

/** Das Tor sagt zu und gibt frei, die Kartendatei kommt. */
const torSagtZu = () => netz((adresse) => {
  if (adresse === ZUSAGE) return json(200, { ok: true })
  if (adresse === `${ZUSAGE}/release`) return json(200, { ok: true })
  if (adresse.startsWith(`${BASIS}/a/`)) return new Response("bild", { status: 200 })
  return undefined
})
const eintraege = () => Object.keys(game.settings.get("beneos-module", "beneos-stream-offline-held") || {}).length

abschnitt("Speicherausfall vor der Zusage: das Tor wird nicht gefragt")
{
  // Ein Speicher, der nichts haelt, darf kein Kontingent kosten (stre-T-145).
  torSagtZu()
  speicherFaellt(1)
  nimmAbrufe()
  const r = await versuche(() => karteZusagen(auftrag()))
  speicherFaellt(0)
  gleich("Speicherausfall: kein Abruf beim Tor", torAbrufe().length, 0)
  gleich("Speicherausfall ergibt grund speicher-aus", r?.grund, "speicher-aus")
  gleich("Speicherausfall: kein Eintrag", eintraege(), 0)
}

abschnitt("Speicherausfall im Holen: die Zusage wird zurueckgegeben")
{
  // Die Vorpruefung findet den Speicher, das Holen nicht mehr.
  torSagtZu()
  speicherFaellt(2)
  nimmAbrufe()
  const r = await versuche(() => karteZusagen(auftrag()))
  speicherFaellt(0)
  const tor = torAbrufe().map((a) => `${String(a.optionen?.method || "GET").toUpperCase()} ${a.adresse.slice(ZUSAGE.length) || "/"}`)
  gleich("Ausfall im Holen: Zusage und Freigabe", JSON.stringify(tor), JSON.stringify(["POST /", "POST /release"]))
  gleich("Ausfall im Holen ergibt grund speicher-aus", r?.grund, "speicher-aus")
  gleich("Ausfall im Holen: kein Eintrag", eintraege(), 0)
}

abschnitt("Lokaler Speicher abgeschaltet: das Tor wird nicht gefragt")
{
  torSagtZu()
  await game.settings.set("beneos-module", "beneos-stream-local-cache", false)
  nimmAbrufe()
  const r = await versuche(() => karteZusagen(auftrag()))
  await game.settings.set("beneos-module", "beneos-stream-local-cache", true)
  gleich("Cache-Schalter aus: kein Abruf beim Tor", JSON.stringify([torAbrufe().length, r?.ok, eintraege()]), "[0,false,0]")
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
  gleich("die Zusage holt die Kartendatei", JSON.stringify([zu?.ergebnis?.geholt, zu?.ergebnis?.fehlgeschlagen, ablage.size]), "[1,0,1]")
  nimmAbrufe()
  const los = await versuche(() => karteLoesen(KARTE.release, KARTE.variant, KARTE.karte))
  const tor = torAbrufe()
  gleich("Loesen gelingt", los?.ok, true)
  gleich("genau ein Abruf beim Tor beim Loesen", tor.length, 1)
  gleich("die Freigabe geht an /release", tor[0]?.adresse, `${ZUSAGE}/release`)
  gleich("die Freigabe geht als POST", String(tor[0]?.optionen?.method || "GET").toUpperCase(), "POST")
}

abschnitt("Loesen gelingt auch, wenn das Tor schweigt")
{
  // karteLoesen wartet das Tor bewusst nicht ab: der Kunde hat freigegeben,
  // ein stummes Tor darf ihm das nicht verweigern.
  netz((adresse) => {
    if (adresse === ZUSAGE) return json(200, { ok: true })
    if (adresse === `${ZUSAGE}/release`) return { wirf: "Failed to fetch" }
    if (adresse.startsWith(`${BASIS}/a/`)) return new Response("bild", { status: 200 })
    return undefined
  })
  const zu = await versuche(() => karteZusagen(auftrag()))
  gleich("Zusage vor dem stummen Loesen gelingt", zu?.ok, true)
  const los = await versuche(() => karteLoesen(KARTE.release, KARTE.variant, KARTE.karte))
  gleich("Loesen gelingt auch ohne Tor", JSON.stringify([los?.ok, los?.beimTor]), "[true,false]")
}

ende()
