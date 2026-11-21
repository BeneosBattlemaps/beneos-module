/**
 * Pruefsatz: eine gehaltene geteilte Datei bleibt ohne Manifest erreichbar
 * (stre-T-175, Vorbedingung vor GETEILTER_VORRAT_AN = true).
 *
 * Bei Schalter AN liegt eine geteilte Datei unter `geteilt/<sha>/<name>`. Die
 * Kartenadresse findet diesen Schluessel nur mit der Pruefsumme, und die kam
 * bis stre-T-175 allein aus einem geladenen Manifest. Offline oder vor dem
 * ersten Manifest fand der Lesepfad die Datei deshalb nicht. Die Pruefsumme
 * steht seit stre-T-174 aber im Gemeinschaftsvorrat, unter der Kartenkennung.
 *
 * Gemessen wird am echten Lesepfad (`fromStore`, `offlineGehalten`) mit dem
 * Schalter AN ueber die Naehte, und ohne Naht mit dem Schalter, wie er ist.
 *
 * Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-offline-geteilt.test.mjs
 */
import { pruefstand, installiereFoundry, netz } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, abschnitt, ende } = pruefstand("stream-offline-geteilt, gehaltene geteilte Datei ohne Manifest")

const BASIS = "https://gate.beneos.stream"
const SCHLUESSEL = "k-attrappe-0003"
const R = "beneos_bm_0113"

const SHA = "a".repeat(64)
const SHA_OHNE = "b".repeat(64)
const SHA_FRISCH = "c".repeat(64)
const SHA_ALT = "d".repeat(64)
const SHA_NEU = "e".repeat(64)
const SHA_ADRESSE = "f".repeat(64)
const SHA_KAPUTT = "g".repeat(64)
const SHA_SCHATTEN = "1".repeat(64)
const SHA_DECKEL_ALT = "2".repeat(64)
const SHA_DECKEL_NEU = "3".repeat(64)

const karte = (variant, name) => `${BASIS}/a/${SCHLUESSEL}/${R}/${variant}/map_assets/${name}`
const kennung = (variant, name) => `${R}|${variant}|map_assets/${name}`

const KARTE = karte("4k", "kompass.webp")
const KARTE_OHNE = karte("4k", "rose.webp")
const KARTE_HD = karte("hd", "kompass.webp")
const KARTE_FRISCH = karte("4k", "laterne.webp")
const KARTE_ALT = karte("4k", "bruecke.webp")
const KARTE_GLEICH = karte("4k", "turm.webp")
const KARTE_ADRESSE = karte("4k", "tor.webp")
const KARTE_KAPUTT = karte("4k", "mauer.webp")
const KARTE_SCHATTEN = karte("4k", "fahne.webp")
const R_DECKEL = "beneos_bm_0999"
const KARTE_DECKEL = `${BASIS}/a/${SCHLUESSEL}/${R_DECKEL}/4k/map_assets/kuppel.webp`
const EIGENE = `${BASIS}/a/${SCHLUESSEL}/${R}/4k/scene.webp`

installiereFoundry({
  einstellungen: {
    "beneos-stream-mode": true,
    "beneos-stream-key": SCHLUESSEL,
    "beneos-stream-base": BASIS,
    "beneos-stream-local-cache": true,
    "beneos-stream-offline-held": {},
    // Der Gemeinschaftsvorrat, wie `schreibGeteilt` ihn ablegt: unter der
    // Kartenkennung, mit Pruefsumme. Ein Alteintrag in Adressform und einer
    // ohne Pruefsumme stehen mit drin.
    "beneos-stream-offline-shared": {
      [kennung("4k", "kompass.webp")]: { bytes: 4, karten: [`${R}|4k|karte`], sha: SHA },
      [kennung("4k", "rose.webp")]: { bytes: 4, karten: [`${R}|4k|karte`] },
      [kennung("4k", "laterne.webp")]: { bytes: 4, karten: [`${R}|4k|karte`], sha: SHA_FRISCH },
      [kennung("4k", "bruecke.webp")]: { bytes: 4, karten: [`${R}|4k|karte`], sha: SHA_ALT },
      [kennung("4k", "turm.webp")]: { bytes: 4, karten: [`${R}|4k|karte`], sha: SHA },
      [KARTE_ADRESSE]: { bytes: 4, karten: [`${R}|4k|karte`], sha: SHA_ADRESSE },
      [kennung("4k", "mauer.webp")]: { bytes: 4, karten: [`${R}|4k|karte`], sha: SHA_KAPUTT },
      [kennung("4k", "fahne.webp")]: { bytes: 4, karten: [`${R}|4k|karte`], sha: SHA_SCHATTEN },
      [`${R_DECKEL}|4k|map_assets/kuppel.webp`]: { bytes: 4, karten: [`${R_DECKEL}|4k|karte`], sha: SHA_DECKEL_ALT },
    },
  },
})

// Ein Cache Storage im Speicher, wie in stream-traeger-ersatz.test.mjs.
const ablage = new Map()
{
  const schl = (anfrage, ohneSuche) => {
    const u = new URL(typeof anfrage === "string" ? anfrage : anfrage.url)
    if (ohneSuche) u.search = ""
    return u.href
  }
  const store = {
    async match(anfrage, opt) {
      const k = schl(anfrage, opt?.ignoreSearch)
      for (const [s, r] of ablage) if (schl(s, opt?.ignoreSearch) === k) return r.clone()
      return undefined
    },
    async put(anfrage, antwort) { ablage.set(schl(anfrage, false), antwort.clone()) },
    async delete(anfrage, opt) {
      const k = schl(anfrage, opt?.ignoreSearch)
      let weg = false
      for (const s of [...ablage.keys()]) if (schl(s, opt?.ignoreSearch) === k) { ablage.delete(s); weg = true }
      return weg
    },
    async keys() { return [...ablage.keys()].map((s) => new Request(s)) },
  }
  globalThis.caches = { async open() { return store }, async delete() { ablage.clear(); return true } }
}

// Kein Abruf darf ans Netz: alles hier ist Lesen aus dem Vorrat.
netz(() => undefined)

const einstellungen = await import("./stream-settings.mjs")
const f = await import("./stream-fetch.mjs")
const { GETEILT_RAUM } = einstellungen

const gehalten = (text) => new Response(text, { status: 200, headers: { "x-beneos-keep": "1", "content-type": "image/webp" } })
const geteilt = (sha, name) => f.schluesselVonKennung(GETEILT_RAUM, sha, name)

ablage.set(geteilt(SHA, "kompass.webp"), gehalten("kompass"))
ablage.set(geteilt(SHA_OHNE, "rose.webp"), gehalten("rose"))
// Frisch gestempelt, aber nicht gehalten: kein Treffer fuer den Rueckfall.
ablage.set(geteilt(SHA_FRISCH, "laterne.webp"), new Response("laterne", {
  status: 200, headers: { "x-beneos-stored": String(Date.now()), "content-type": "image/webp" },
}))
ablage.set(geteilt(SHA_ALT, "bruecke.webp"), gehalten("bruecke-alt"))
ablage.set(geteilt(SHA, "turm.webp"), gehalten("turm"))
ablage.set(geteilt(SHA_ADRESSE, "tor.webp"), gehalten("tor"))
ablage.set(geteilt(SHA_KAPUTT, "mauer.webp"), gehalten("mauer"))
ablage.set(f.vorratsSchluessel(EIGENE), gehalten("szene"))
// Ein abgelaufener, nicht gehaltener Alteintrag unter dem Kartenschluessel,
// etwa vom Streamen vor dem Umschalten, neben der gehaltenen geteilten Kopie.
ablage.set(f.vorratsSchluessel(KARTE_SCHATTEN), new Response("fahne-alt", {
  status: 200, headers: { "x-beneos-stored": "1", "content-type": "image/webp" },
}))
ablage.set(geteilt(SHA_SCHATTEN, "fahne.webp"), gehalten("fahne"))
ablage.set(geteilt(SHA_DECKEL_ALT, "kuppel.webp"), gehalten("kuppel-alt"))

/** Ruft und faengt: ein Wurf wird eine rote Probe, kein Absturz des Satzes. */
async function versuche(fn) {
  try { return await fn() } catch (e) { return { wurf: String(e?.message || e).slice(0, 120) } }
}
const text = async (hit) => (hit && typeof hit.text === "function" ? await hit.text() : hit?.wurf ? hit : null)
const lies = (url) => versuche(async () => text(await f.fromStoreMitVorratFuerPruefsatz(await caches.open("x"), url)))
const liegtAn = (urls) => versuche(() => f.offlineGehaltenMitVorratFuerPruefsatz(urls))

abschnitt("Schalter AN, kein Manifest geladen")
{
  gleich("Kartenadresse liefert die gehaltenen Bytes", await lies(KARTE), "kompass")
  gleich("Kartenadresse mit Abfrageteil liefert sie auch", await lies(`${KARTE}?v=3`), "kompass")
  gleich("offlineGehalten meldet sie als gehalten", await liegtAn([KARTE]), true)
  gleich("Alteintrag in Adressform traegt die Pruefsumme genauso", await lies(KARTE_ADRESSE), "tor")
  gleich("eigene Datei der Karte bleibt erreichbar", await lies(EIGENE), "szene")
  gleich("eigene und geteilte zusammen gehalten", await liegtAn([EIGENE, KARTE]), true)
  gleich("alleImSpeicher findet die geteilte Datei",
    await versuche(() => f.alleImSpeicherMitVorratFuerPruefsatz([KARTE])), true)
  gleich("nichtGehalten nennt nur die fehlende Variante",
    JSON.stringify(await versuche(() => f.nichtGehaltenMitVorratFuerPruefsatz([KARTE, KARTE_HD]))), JSON.stringify([KARTE_HD]))
  // Die Reihenfolge traegt: fromStore loescht einen abgelaufenen Treffer. Die
  // beiden Lesestellen ohne Loeschen laufen deshalb VOR dem Abruf, sonst
  // fehlt ihnen der Alteintrag, den sie ueberstehen sollen.
  gleich("abgelaufener Alteintrag: alleImSpeicher findet die gehaltene Kopie",
    await versuche(() => f.alleImSpeicherMitVorratFuerPruefsatz([KARTE_SCHATTEN])), true)
  gleich("abgelaufener Alteintrag: offlineGehalten meldet gehalten", await liegtAn([KARTE_SCHATTEN]), true)
  gleich("abgelaufener Alteintrag verdeckt die gehaltene Kopie nicht", await lies(KARTE_SCHATTEN), "fahne")
}

abschnitt("Grenzen des Rueckfalls")
{
  gleich("Eintrag ohne Pruefsumme: kein Treffer", await lies(KARTE_OHNE), null)
  gleich("andere Variante, gleicher Name: kein Treffer", await lies(KARTE_HD), null)
  gleich("andere Variante, gleicher Name: nicht gehalten", await liegtAn([KARTE_HD]), false)
  gleich("frisch, aber nicht gehalten: kein Treffer", await lies(KARTE_FRISCH), null)
  gleich("Pruefsumme in falscher Form: kein Treffer", await lies(KARTE_KAPUTT), null)
  gleich("der nicht gehaltene Eintrag bleibt liegen", ablage.has(geteilt(SHA_FRISCH, "laterne.webp")), true)
}

abschnitt("Schalter AUS (die Konstante): nichts aendert sich")
{
  gleich("AUS: offlineGehalten meldet die geteilte Datei nicht", await versuche(() => f.offlineGehalten([KARTE])), false)
  gleich("AUS: die eigene Datei bleibt gehalten", await versuche(() => f.offlineGehalten([EIGENE])), true)
  gleich("AUS: alleImSpeicher findet die geteilte Datei nicht", await versuche(() => f.alleImSpeicher([KARTE])), false)
  gleich("AUS: nichtGehalten nennt die geteilte Datei",
    JSON.stringify(await versuche(() => f.nichtGehalten([KARTE]))), JSON.stringify([KARTE]))
}

abschnitt("Schreiber bleiben ohne Rueckfall")
{
  const r = await versuche(() => f.offlineFreigeben([KARTE]))
  gleich("offlineFreigeben loest ueber die Kartenadresse nichts", r?.geloest, 0)
  gleich("unter dem Kartenschluessel entsteht keine Kopie", ablage.has(f.vorratsSchluessel(KARTE)), false)
}

abschnitt("Mit Manifest: das Manifest hat Vorrang")
{
  f.merkePruefsummen([[KARTE_GLEICH, SHA], [KARTE_ALT, SHA_NEU]])
  gleich("Manifest mit gleicher Pruefsumme: dieselben Bytes", await lies(KARTE_GLEICH), "turm")
  gleich("Manifest mit gleicher Pruefsumme: gehalten", await liegtAn([KARTE_GLEICH]), true)
  gleich("Manifest mit neuer Pruefsumme: keine alten Bytes", await lies(KARTE_ALT), null)
  gleich("Manifest mit neuer Pruefsumme: nicht gehalten", await liegtAn([KARTE_ALT]), false)
  gleich("Manifest mit neuer Pruefsumme, mit Abfrageteil: keine alten Bytes", await lies(`${KARTE_ALT}?v=1`), null)
}

abschnitt("Manifest geladen, Verzeichnis am Deckel: das Manifest gilt trotzdem")
{
  // Das Verzeichnis bis zum Deckel fuellen, danach das Manifest der Karte.
  const { deckel } = f.pruefsummenStand()
  const fuell = []
  for (let i = f.pruefsummenStand().adressen; i < deckel; i++) {
    fuell.push([`${BASIS}/a/${SCHLUESSEL}/beneos_bm_fuell/4k/f${i}.webp`, i.toString(16).padStart(64, "0")])
  }
  f.merkePruefsummen(fuell)
  f.merkePruefsummen([[KARTE_DECKEL, SHA_DECKEL_NEU]])
  gleich("das Verzeichnis steht am Deckel", f.pruefsummenStand().adressen, deckel)
  gleich("die Adresse hat keinen Platz mehr bekommen", f.pruefsummeVon(KARTE_DECKEL), "")
  gleich("Manifest geladen, Deckel erreicht: keine alten Bytes", await lies(KARTE_DECKEL), null)
}

ende()
