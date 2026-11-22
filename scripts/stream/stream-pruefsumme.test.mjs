/**
 * Pruefsatz fuer die Pruefsumme im Gemeinschaftsvorrat (stre-T-174).
 *
 * Beim Weltstart ist kein Manifest geladen, die Pruefsumme einer geteilten
 * Datei also unbekannt. Bis stre-T-174 hielt `verwaisteLoesen` deshalb bei
 * Schalter AN jede gehaltene geteilte Datei, deren NAME eine Deckung traegt,
 * auch wenn ihre Pruefsumme fremd war (Kalt-Review stre-T-081, Befund 2).
 *
 * Seit stre-T-174 schreibt der Gemeinschaftsvorrat die Pruefsumme mit, und ein
 * Eintrag mit Pruefsumme deckt genau seine Datei. Die Namensregel bleibt nur
 * fuer Alteintraege ohne Pruefsumme, damit kein Kunde Bestand verliert.
 *
 * Die Zwei-Werte-Probe:
 *   - gleicher Name, fremde Pruefsumme: wird geloest;
 *   - gleiche Pruefsumme: bleibt.
 *
 *   node scripts/stream/stream-pruefsumme.test.mjs
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { pruefstand, installiereFoundry, netz } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, struktur, abschnitt, ende } = pruefstand("stream-pruefsumme, Pruefsumme im Gemeinschaftsvorrat")

const BASIS = "https://gate.beneos.stream"
const SCHLUESSEL = "k-attrappe-0001"
const { einstellungen } = installiereFoundry({
  einstellungen: {
    "beneos-stream-mode": true,
    "beneos-stream-key": SCHLUESSEL,
    "beneos-stream-base": BASIS,
    "beneos-stream-offline-held": {},
    "beneos-stream-offline-shared": {},
  },
})

// Ein Cache Storage im Speicher, wie in stream-zusage.test.mjs.
{
  const ablage = new Map()
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

const f = await import("./stream-fetch.mjs")
const { karteZusagen } = await import("./stream-offline.mjs")

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)
const SHA_C = "c".repeat(64)
const URSPRUNG = "https://beneos-stream.invalid"
const geteilterSchluessel = (sha, name) => `${URSPRUNG}/a/shared/${sha}/${name}`
const KENNUNG = "beneos_bm_0113|4k|map_assets/kompass.webp"
const gehalten = (schluessel) => ({ url: schluessel, schluessel, bytes: 1 })
const namen = (liste) => JSON.stringify(liste.map((g) => g.schluessel))

/*
 * DIE DECKUNG KOMMT AUS DER GESPEICHERTEN FORM des Gemeinschaftsvorrats, wie
 * `liesGeteilt` ihn liefert: Adresse oder Kennung auf Eintrag. Fehlt
 * `deckungDesVorrats` (Stand vor stre-T-174), nimmt die Probe den alten Weg
 * von `verwaisteLoesen` und `geteilteLuecken`: nur die Schluessel des Vorrats.
 * So bekommt der alte Code dieselben Daten, und rot heisst: er hat sie falsch
 * behandelt, nicht: er kannte die Eingabeform nicht.
 */
const deckung = (vorrat) => typeof f.deckungDesVorrats === "function"
  ? f.deckungDesVorrats(vorrat) : Object.keys(vorrat)
const frage = (url, e) => typeof f.deckungDesVorrats === "function"
  ? f.deckungDesVorrats({ [url]: e })[0] : url
const mitSumme = (sha) => ({ bytes: 1, karten: ["beneos_bm_0113|4k|k1"], sha })
const ohneSumme = { bytes: 1, karten: ["beneos_bm_0113|4k|k1"] }

abschnitt("Teil 1: Schalter AN, Weltstart ohne Manifest")
{
  const an = { an: true }
  const fremd = gehalten(geteilterSchluessel(SHA_B, "kompass.webp"))
  const eigen = gehalten(geteilterSchluessel(SHA_A, "kompass.webp"))
  gleich("gleicher Name, fremde Pruefsumme: wird geloest",
    namen(f.ohneDeckung([fremd], deckung({ [KENNUNG]: mitSumme(SHA_A) }), an)), namen([fremd]))
  gleich("gleiche Pruefsumme: bleibt",
    namen(f.ohneDeckung([eigen], deckung({ [KENNUNG]: mitSumme(SHA_A) }), an)), "[]")
  gleich("Alteintrag ohne Pruefsumme, gleicher Name: bleibt wie vorher",
    namen(f.ohneDeckung([fremd], deckung({ [KENNUNG]: ohneSumme }), an)), "[]")
  gleich("Eintrag mit unbrauchbarer Pruefsumme gilt als Alteintrag: bleibt",
    namen(f.ohneDeckung([fremd], deckung({ [KENNUNG]: mitSumme("kaputt") }), an)), "[]")
  const MAP = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0113/4k/map_assets/kompass.webp`
  gleich("Adresse mit Pruefsumme: fremde Pruefsumme wird geloest",
    namen(f.ohneDeckung([fremd], deckung({ [MAP]: mitSumme(SHA_A) }), an)), namen([fremd]))
  const kartenform = gehalten(f.vorratsSchluessel(MAP))
  gleich("Datei unter dem Kartenschluessel aus der AUS-Zeit: bleibt",
    namen(f.ohneDeckung([kartenform], deckung({ [KENNUNG]: mitSumme(SHA_A) }), an)), "[]")

  const nurFremd = f.gehaltenePruefung([fremd], an)
  const nurEigen = f.gehaltenePruefung([eigen], an)
  gleich("geteilteLuecken, mit Pruefsumme und nur fremd gehalten: fehlt", nurFremd(frage(KENNUNG, mitSumme(SHA_A))), false)
  gleich("geteilteLuecken, mit Pruefsumme und eigen gehalten: gehalten", nurEigen(frage(KENNUNG, mitSumme(SHA_A))), true)
  gleich("geteilteLuecken, Alteintrag ohne Pruefsumme: unklar wie vorher", nurFremd(frage(KENNUNG, ohneSumme)), "unklar")
}

abschnitt("Teil 2: Schalter AUS, unveraendert")
{
  const aus = { an: false }
  const MAP = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0113/4k/map_assets/kompass.webp`
  const kartenform = gehalten(f.vorratsSchluessel(MAP))
  const geteilt = gehalten(geteilterSchluessel(SHA_A, "kompass.webp"))
  for (const [name, g] of [["Kartenschluessel", kartenform], ["geteilter Schluessel", geteilt]]) {
    gleich(`AUS, ${name}: mit Pruefsumme wie ohne`,
      namen(f.ohneDeckung([g], deckung({ [KENNUNG]: mitSumme(SHA_A) }), aus)),
      namen(f.ohneDeckung([g], [KENNUNG], aus)))
    gleich(`AUS, ${name}: geteilteLuecken mit Pruefsumme wie ohne`,
      f.gehaltenePruefung([g], aus)(frage(KENNUNG, mitSumme(SHA_A))),
      f.gehaltenePruefung([g], aus)(KENNUNG))
  }
}

abschnitt("Teil 3: der Gemeinschaftsvorrat schreibt die Pruefsumme mit")
{
  const ZUSAGE = `${BASIS}/offline/${SCHLUESSEL}/beneos_bm_0113/4k/k1`
  const MAP_A = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0113/4k/map_assets/kompass.webp`
  const MAP_U = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0113/4k/map_assets/unbekannt.webp`
  const MAP_C = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0113/4k/map_assets/alt.webp`
  f.merkePruefsummen([[MAP_A, SHA_A]])
  // Ein Alteintrag mit Pruefsumme, die diese Sitzung nicht kennt, und einer mit kaputter.
  einstellungen["beneos-stream-offline-shared"] = {
    "beneos_bm_0113|4k|map_assets/alt.webp": { bytes: 3, karten: ["x|y|z"], sha: SHA_C },
    "beneos_bm_0113|4k|map_assets/unbekannt.webp": { bytes: 3, karten: ["x|y|z"], sha: "kaputt" },
  }
  netz((adresse) => {
    if (adresse === ZUSAGE || adresse === `${ZUSAGE}/release`) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    if (adresse.startsWith(`${BASIS}/a/`)) return new Response("bild", { status: 200, headers: { "content-type": "image/webp" } })
    return undefined
  })
  let r
  try {
    r = await karteZusagen({
      release: "beneos_bm_0113", variant: "4k", karte: "k1", name: "Probe",
      urls: [`${BASIS}/a/${SCHLUESSEL}/beneos_bm_0113/4k/k1.webp`], bytes: 10,
      geteilt: [{ url: MAP_A, bytes: 4 }, { url: MAP_U, bytes: 4 }, { url: MAP_C, bytes: 4 }],
    })
  } catch (e) { r = { wurf: String(e?.message || e) } }
  gleich("Vorbedingung: die Zusage gelingt", r?.ok, true)
  const vorrat = einstellungen["beneos-stream-offline-shared"] || {}
  gleich("bekannte Pruefsumme wird mitgeschrieben", vorrat["beneos_bm_0113|4k|map_assets/kompass.webp"]?.sha, SHA_A)
  gleich("eine vorhandene Pruefsumme bleibt, wenn die Sitzung keine kennt", vorrat["beneos_bm_0113|4k|map_assets/alt.webp"]?.sha, SHA_C)
  gleich("eine kaputte Pruefsumme wird nicht geschrieben", "sha" in (vorrat["beneos_bm_0113|4k|map_assets/unbekannt.webp"] || {}), false)
  gleich("der Schluessel des Eintrags bleibt die Kennung", Object.keys(vorrat).sort().join(" "),
    ["beneos_bm_0113|4k|map_assets/alt.webp", "beneos_bm_0113|4k|map_assets/kompass.webp", "beneos_bm_0113|4k|map_assets/unbekannt.webp"].join(" "))
}

/*
 * Teil 3b, DIE ANSCHLUESSE AM WELTSTART, am Verhalten statt am Quelltext
 * (stre-T-208). `verwaisteLoesen` und `geteilteLuecken` laufen hier mit dem
 * Speicher der Attrappe und den Einstellungen, wie der Weltstart sie ruft.
 */
abschnitt("Teil 3b: Weltstart-Abgleich am Speicher")
{
  const { verwaisteLoesen, geteilteLuecken } = await import("./stream-offline.mjs")
  const store = await caches.open("x")
  await caches.delete()
  const gehaltenImSpeicher = async (schluessel) => {
    const r = await store.match(schluessel)
    return Boolean(r?.headers.get("x-beneos-keep"))
  }
  const lege = (schluessel) => store.put(schluessel, new Response("bild", {
    status: 200, headers: { "x-beneos-keep": "1", "content-type": "image/webp", "content-length": "4" } }))

  const KARTE_V = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0120/4k/karte.webp`
  const VERWAIST = f.vorratsSchluessel(KARTE_V)
  const ZUGESAGT_V = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0121/4k/karte.webp`
  const ZUGESAGT = f.vorratsSchluessel(ZUGESAGT_V)
  const OHNE_TRAEGER = geteilterSchluessel("d".repeat(64), "ohne.webp")
  await lege(VERWAIST)
  await lege(ZUGESAGT)
  await lege(OHNE_TRAEGER)
  einstellungen["beneos-stream-offline-held"] = {
    "beneos_bm_0121|4k|z": { release: "beneos_bm_0121", variant: "4k", karte: "z", dateien: ["karte.webp"], bytes: 4 },
  }
  einstellungen["beneos-stream-offline-shared"] = {}
  let r
  try { r = await verwaisteLoesen() } catch (e) { r = { wurf: String(e?.message || e) } }
  gleich("verwaisteLoesen: zwei Dateien ohne Zusage werden geloest", r?.geloest, 2)
  gleich("verwaisteLoesen: die Kartendatei ohne Zusage ist nicht mehr gehalten", await gehaltenImSpeicher(VERWAIST), false)
  gleich("verwaisteLoesen: die geteilte Datei ohne Traeger ist nicht mehr gehalten", await gehaltenImSpeicher(OHNE_TRAEGER), false)
  gleich("verwaisteLoesen Gegenwert: die zugesagte Kartendatei bleibt gehalten", await gehaltenImSpeicher(ZUGESAGT), true)

  await caches.delete()
  const DA_V = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0122/4k/map_assets/da.webp`
  await lege(f.vorratsSchluessel(DA_V))
  einstellungen["beneos-stream-offline-shared"] = {
    "beneos_bm_0122|4k|map_assets/da.webp": { bytes: 4, karten: ["x|y|z"], fehlt: true },
    "beneos_bm_0122|4k|map_assets/weg.webp": { bytes: 4, karten: ["x|y|z"] },
  }
  try { r = await geteilteLuecken() } catch (e) { r = { wurf: String(e?.message || e) } }
  const nachher = einstellungen["beneos-stream-offline-shared"] || {}
  gleich("geteilteLuecken: die gehaltene Datei verliert ihren Fehlvermerk",
    "fehlt" in (nachher["beneos_bm_0122|4k|map_assets/da.webp"] || {}), false)
  gleich("geteilteLuecken Gegenwert: die nicht gehaltene Datei wird als fehlend vermerkt",
    nachher["beneos_bm_0122|4k|map_assets/weg.webp"]?.fehlt, true)
  gleich("geteilteLuecken: genau eine Datei fehlt", r?.fehlend, 1)
}

abschnitt("Teil 4: Struktur")
{
  const hier = dirname(fileURLToPath(import.meta.url))
  const code = readFileSync(join(hier, "stream-offline.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((z) => z.replace(/\/\/.*$/, "")).join("\n")
  // M6: S, die Pruefsumme des Eintrags wirkt nur bei GETEILTER_VORRAT_AN, der Schalter ist modulprivat und aus, im Pruefstand gleicht der Weg mit und ohne deckungDesVorrats also.
  const verwaist = code.slice(code.indexOf("export async function verwaisteLoesen"))
  struktur("verwaisteLoesen deckt den Gemeinschaftsvorrat ueber deckungDesVorrats",
    /deckungDesVorrats\(liesGeteilt\(\)\)/.test(verwaist.slice(0, 900)), true)
  const luecken = code.slice(code.indexOf("function geteilteLuecken"))
  struktur("geteilteLuecken fragt mit dem Eintrag",
    /istGehalten\(deckungDesVorrats\(\{\s*\[url\]:\s*e\s*\}\)\[0\]\)/.test(luecken), true)
}

ende()
