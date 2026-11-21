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
 * Seit stre-T-146 prueft er auch die Gegenrichtung, das Heilen eines fehlenden
 * Vorrats: eine Karte gilt nur als wiederhergestellt, wenn ihre Dateien liegen,
 * und keine Meldung nennt einen Erfolg, den es nicht gab.
 *
 * Aufruf: node scripts/stream/stream-zusage.test.mjs
 */
import { pruefstand, installiereFoundry, netz, nimmAbrufe, meldungen } from "../../tools/lib/foundry-attrappe.mjs"

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
const schalter = { wirfAb: 0, nur: 0, geoeffnet: 0 }
const speicherFaellt = (ab) => { schalter.wirfAb = ab; schalter.nur = 0; schalter.geoeffnet = 0 }
/** Nur der n-te Aufruf wirft, wie ein fremder Abruf, der einmal scheitert. */
const speicherStolpert = (n) => { schalter.wirfAb = 0; schalter.nur = n; schalter.geoeffnet = 0 }

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
      if ((schalter.wirfAb && schalter.geoeffnet >= schalter.wirfAb) || schalter.nur === schalter.geoeffnet) {
        throw Object.assign(new Error("Unexpected internal error."), { name: "UnknownError" })
      }
      return store
    },
    async delete() { ablage.clear(); return true },
  }
  return ablage
}
const ablage = speicherAttrappe()

const { karteZusagen, karteLoesen, vorratHeilen, meldeHeilung } = await import("./stream-offline.mjs")

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

abschnitt("Lokaler Speicher faellt waehrend der Zusage weg: die Zusage wird zurueckgegeben")
{
  // Die Welteinstellung kann ein zweiter Spielleiter umschalten, waehrend
  // dieser Client beim Tor fragt (Kalt-Review stre-T-145, Befund 2).
  netz((adresse) => {
    if (adresse === ZUSAGE) { game.settings.set("beneos-module", "beneos-stream-local-cache", false); return json(200, { ok: true }) }
    if (adresse === `${ZUSAGE}/release`) return json(200, { ok: true })
    if (adresse.startsWith(`${BASIS}/a/`)) return new Response("bild", { status: 200 })
    return undefined
  })
  nimmAbrufe()
  const r = await versuche(() => karteZusagen(auftrag()))
  await game.settings.set("beneos-module", "beneos-stream-local-cache", true)
  const tor = torAbrufe().map((a) => `${String(a.optionen?.method || "GET").toUpperCase()} ${a.adresse.slice(ZUSAGE.length) || "/"}`)
  gleich("Schalter faellt waehrend der Zusage: Freigabe, kein Eintrag", JSON.stringify([tor, r?.grund, eintraege()]), JSON.stringify([["POST /", "POST /release"], "speicher-aus", 0]))
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

abschnitt("Ein fremder Speicherfehler kostet die gehaltene Karte nicht")
{
  // Scheitert irgendein anderer Zugriff einmal, waehrend diese Karte
  // vollstaendig gehalten wird, bleibt die Zusage stehen (Kalt-Review
  // stre-T-145, Befund 1). Der dritte Aufruf ist der erste nach dem Oeffnen
  // in `offlineHalten`.
  await versuche(() => karteLoesen(KARTE.release, KARTE.variant, KARTE.karte))
  ablage.clear()
  torSagtZu()
  speicherStolpert(3)
  nimmAbrufe()
  const r = await versuche(() => karteZusagen(auftrag()))
  const geoeffnet = schalter.geoeffnet
  speicherFaellt(0)
  const tor = torAbrufe().map((a) => `${String(a.optionen?.method || "GET").toUpperCase()} ${a.adresse.slice(ZUSAGE.length) || "/"}`)
  gleich("der Stolperer trifft wirklich einen Zugriff", geoeffnet >= 3, true)
  gleich("Fremder Ausfall im Holen: Zusage bleibt", JSON.stringify([r?.ok, tor, eintraege(), r?.ergebnis?.geholt]), JSON.stringify([true, ["POST /"], 1, 1]))
}

abschnitt("Heilen zaehlt nur, was wirklich liegt")
{
  // Ein Ergebnis voller Nullen ist kein Erfolg (stre-T-146). Vorher zaehlte
  // `vorratHeilen` eine Karte, sobald kein Fehlschlag gemeldet war, und das
  // galt auch bei ausgefallenem Speicher und bei einem Eintrag ohne Adressen.
  torSagtZu()
  const fehlt = { ...KARTE, urls: [`${BASIS}/a/${SCHLUESSEL}/beneos_bm_0001/4k/k1.webp`], bytes: 10 }

  ablage.clear()
  speicherFaellt(1)
  const aus = await versuche(() => vorratHeilen([fehlt]))
  speicherFaellt(0)
  gleich("Heilen bei Speicherausfall: keine Karte gezaehlt", aus?.karten, 0)
  gleich("Heilen bei Speicherausfall: speicherAus gemeldet", aus?.speicherAus, true)

  ablage.clear()
  const leer = await versuche(() => vorratHeilen([{ ...fehlt, urls: [] }]))
  gleich("Heilen ohne Adressen: keine Karte gezaehlt", leer?.karten, 0)

  ablage.clear()
  const gesund = await versuche(() => vorratHeilen([fehlt]))
  gleich("Heilen mit gesundem Speicher: Karte gezaehlt, Datei liegt", JSON.stringify([gesund?.karten, gesund?.speicherAus ?? false, ablage.size]), JSON.stringify([1, false, 1]))
}

abschnitt("Die Heilmeldung nennt keinen Erfolg ohne Datei")
{
  const melde = (summe, gesamt) => {
    meldungen.length = 0
    const r = versuche(() => meldeHeilung({ geholt: 0, fehlgeschlagen: 0, karten: 0, geteiltGeholt: 0, deckelErreicht: false, ...summe }, gesamt))
    return r.then(() => meldungen.map((m) => `${m.art} ${m.text.replace(/^BENEOS.Stream.Offline./, "")}`).join(" | "))
  }
  gleich("Meldung bei Speicherausfall: BlockedStorage", await melde({ speicherAus: true }, 1), "warn BlockedStorage")
  gleich("Meldung ohne geheilte Karte: RestoredSome, kein RestoredAll", await melde({ karten: 0 }, 1), "warn RestoredSome")
  gleich("Meldung mit allen Karten: RestoredAll", await melde({ karten: 1 }, 1), "info RestoredAll")
  gleich("Meldung mit Dateifehlschlag: RestoredPartly", await melde({ karten: 0, fehlgeschlagen: 2 }, 1), "warn RestoredPartly")
  gleich("Meldung am Deckel: RestoredQuota", await melde({ karten: 0, deckelErreicht: true }, 1), "warn RestoredQuota")
  // Faellt der Speicher erst nach einer gehaltenen Karte aus, ist die Karte
  // trotzdem da. Der Speichersatz sagte "cannot be fetched" und verschwieg sie.
  gleich("Meldung bei Teilerfolg vor dem Ausfall: RestoredSome", await melde({ karten: 1, speicherAus: true }, 2), "warn RestoredSome")
}

abschnitt("Heilen nennt die Ursache, wo es sie kennt")
{
  // Kalt-Review stre-T-146, Befunde 3 und 5.
  torSagtZu()
  const geteilt = `${BASIS}/s/${SCHLUESSEL}/shared/icon.webp`
  await game.settings.set("beneos-module", "beneos-stream-offline-shared", { [geteilt]: { bytes: 5, karten: ["beneos_bm_0001|4k|k9"] } })
  ablage.clear()
  speicherFaellt(1)
  const nurGeteilt = await versuche(() => vorratHeilen([{ ...KARTE, karte: "k9", urls: [] }]))
  speicherFaellt(0)
  await game.settings.set("beneos-module", "beneos-stream-offline-shared", {})
  gleich("Nur geteilte Adressen, Speicher aus: speicherAus gemeldet", JSON.stringify([nurGeteilt?.karten, nurGeteilt?.speicherAus]), JSON.stringify([0, true]))

  // Der abgeschaltete Zwischenspeicher der Welt ist kein Browserfehler.
  ablage.clear()
  await game.settings.set("beneos-module", "beneos-stream-local-cache", false)
  const schalterAus = await versuche(() => vorratHeilen([{ ...KARTE, urls: [`${BASIS}/a/${SCHLUESSEL}/beneos_bm_0001/4k/k1.webp`], bytes: 10 }]))
  await game.settings.set("beneos-module", "beneos-stream-local-cache", true)
  gleich("Zwischenspeicher abgeschaltet: kein speicherAus, keine Karte", JSON.stringify([schalterAus?.karten, schalterAus?.speicherAus]), JSON.stringify([0, false]))
}

abschnitt("Geteilte Datei, die schon liegt: eigener Eintrag, kein fremdes Loesen (stre-T-175)")
{
  // Kalt-Review stre-T-175, Befund 2. Bei Schalter AN liegt eine Datei, die
  // Karte A geholt hat, fuer Karte B gleicher Bytes schon unter demselben
  // Schluessel. Gemessen wird dieselbe Lage bei AUS: zwei Eintraege, die
  // denselben Vorratsschluessel bilden, und eine schon gehaltene Datei.
  const { vorratsSchluessel } = await import("./stream-fetch.mjs")
  const { geteilterStand } = await import("./stream-offline.mjs")
  const B = { release: "beneos_bm_0002", variant: "4k", karte: "k2" }
  const ZUSAGE_B = `${BASIS}/offline/${SCHLUESSEL}/beneos_bm_0002/4k/k2`
  const G_B = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0002/4k/map_assets/x.webp`
  netz((adresse) => {
    if (adresse === ZUSAGE_B || adresse === `${ZUSAGE_B}/release`) return json(200, { ok: true })
    if (adresse.startsWith(`${BASIS}/a/`)) return new Response("bild", { status: 200 })
    return undefined
  })
  ablage.clear()
  await game.settings.set("beneos-module", "beneos-stream-offline-shared", {})
  ablage.set(vorratsSchluessel(G_B), new Response("x", { status: 200, headers: { "x-beneos-keep": "1" } }))
  const zu = await versuche(() => karteZusagen({ ...B, name: "B", urls: [`${BASIS}/a/${SCHLUESSEL}/beneos_bm_0002/4k/k2.webp`], bytes: 10,
    geteilt: [{ url: G_B, bytes: 5 }] }))
  const roh = game.settings.get("beneos-module", "beneos-stream-offline-shared") || {}
  gleich("Zusage B gelingt", zu?.ok, true)
  gleich("die schon gehaltene geteilte Datei bekommt einen Eintrag fuer B",
    JSON.stringify(roh["beneos_bm_0002|4k|map_assets/x.webp"]?.karten), JSON.stringify(["beneos_bm_0002|4k|k2"]))

  // Zwei Eintraege derselben Datei: die Kennung (Karte A) und ein Alteintrag
  // in Adressform mit anderem Streamschluessel (Karte C). Beide bilden
  // denselben Vorratsschluessel.
  const ALT = `${BASIS}/a/k-alt-0009/beneos_bm_0002/4k/map_assets/x.webp`
  await game.settings.set("beneos-module", "beneos-stream-offline-held", {})
  await game.settings.set("beneos-module", "beneos-stream-offline-shared", {
    "beneos_bm_0002|4k|map_assets/x.webp": { bytes: 5, karten: ["beneos_bm_0002|4k|k2"] },
    [ALT]: { bytes: 5, karten: ["beneos_bm_0002|4k|k3"] },
  })
  gleich("dieselbe Ablage zaehlt im Stand einmal", JSON.stringify(geteilterStand()), JSON.stringify({ dateien: 1, bytes: 5 }))
  await game.settings.set("beneos-module", "beneos-stream-offline-held", {
    "beneos_bm_0002|4k|k2": { ...B, name: "B", urls: [`${BASIS}/a/${SCHLUESSEL}/beneos_bm_0002/4k/k2.webp`], bytes: 10 },
  })
  await versuche(() => karteLoesen(B.release, B.variant, B.karte))
  const nachher = ablage.get(vorratsSchluessel(G_B))
  gleich("Loesen von B laesst die Datei gehalten, die C noch braucht", Boolean(nachher?.headers.get("x-beneos-keep")), true)
  await game.settings.set("beneos-module", "beneos-stream-offline-shared", {})
  await game.settings.set("beneos-module", "beneos-stream-offline-held", {})
  ablage.clear()
}

abschnitt("Fenster und Weltstart melden dieselbe Lage gleich")
{
  // Kalt-Review stre-T-146, Befunde 1, 2 und 6: der Baustein war geprueft,
  // seine Verdrahtung in beiden Wegen nicht.
  const { BeneosOfflineWindow } = await import("./stream-offline-window.mjs")
  const { pruefeVorrat, heilbarkeit, meldeFehlendenVorrat } = await import("./stream-offline.mjs")
  const { noteResult } = await import("./stream-online.mjs")
  foundry.applications.api.DialogV2 = { confirm: async () => true }
  foundry.utils.escapeHTML ??= (s) => String(s)
  torSagtZu()
  const adresse = (k) => `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0001/4k/${k}.webp`
  const halte = (...ks) => game.settings.set("beneos-module", "beneos-stream-offline-held",
    Object.fromEntries(ks.map((k) => [`beneos_bm_0001|4k|${k}`, { ...KARTE, karte: k, name: k, urls: [adresse(k)], bytes: 10 }])))
  const marke = (t) => String(t).replace(/^BENEOS\.Stream\.Offline\./, "")
    .replace(/^Beneos: some offline maps are missing, but there is no connection.*/, "BlockedOffline")
    .replace(/^Beneos: some offline maps are missing and your offline storage is full.*/, "BlockedQuota")
    .replace(/^(Beneos: fetching \d+ map\(s\)|Fetching your offline maps)\.\.\.$/, "Fetching")
  const lauf = async (weg) => {
    ablage.clear(); meldungen.length = 0; nimmAbrufe()
    if (weg === "fenster") await versuche(() => BeneosOfflineWindow._onRepair.call({ render: () => null }))
    else await versuche(async () => { const stand = await pruefeVorrat(); return meldeFehlendenVorrat({ stand, heilbar: await heilbarkeit(stand) }) })
    const dateien = nimmAbrufe().filter((a) => a.adresse.startsWith(`${BASIS}/a/`)).length
    return `${meldungen.map((m) => `${m.art} ${marke(m.text)}`).join(" | ")} / ${dateien} geholt`
  }
  const beide = async (titel, erwartet) => {
    gleich(`Fenster, ${titel}`, await lauf("fenster"), erwartet)
    gleich(`Weltstart, ${titel}`, await lauf("weltstart"), erwartet)
  }

  await halte("k1", "k2")
  noteResult(false, "probe")
  await beide("keine Verbindung: Grund statt Zahl", "warn BlockedOffline / 0 geholt")

  noteResult(true, "probe")
  await beide("alles holbar: RestoredAll", "info Fetching | info RestoredAll / 2 geholt")

  const vorher = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { estimate: async () => ({ quota: 15, usage: 0 }) } } })
  await beide("Kontingent reicht fuer 1 von 2: RestoredQuota", "info Fetching | warn RestoredQuota / 1 geholt")
  if (vorher) Object.defineProperty(globalThis, "navigator", vorher)
  else delete globalThis.navigator
  await game.settings.set("beneos-module", "beneos-stream-offline-held", {})
}

ende()
