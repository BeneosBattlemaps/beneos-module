/**
 * Pruefsatz fuer den Abgleich gehaltener Dateien (stre-T-081).
 *
 * `verwaisteLoesen` in `stream-offline.mjs` laedt in node nicht ("Hooks is not
 * defined"). Der Vergleich steht deshalb als reine Funktion `ohneDeckung` in
 * `stream-fetch.mjs`, und dieser Satz misst ihn dort.
 *
 * Teil 1, LEGACY: mit dem Schalter AUS verhaelt sich alles wie vor stre-T-081,
 * fuer eine Karte, eine /a/-Datei und ein Tonstueck. Die Vergleichsgroesse ist
 * der alte Filter, woertlich abgeschrieben, nicht eine Erwartung von Hand.
 *
 * EINE ABWEICHUNG BEI AUS IST GEWOLLT und steht unten als eigene Probe: deckt
 * der Gemeinschaftsvorrat eine Datei unter einem frueheren Streamschluessel
 * oder einer frueheren Basis, bleibt sie gehalten. Vor stre-T-081 wurde sie
 * geloest, obwohl ein Eintrag auf sie zeigt.
 */
import { assetUrl, GATE_DEFAULT_BASE, SETTING } from "./stream-settings.mjs"

let rot = 0
let gruen = 0

function gleich(name, ist, soll) {
  const a = JSON.stringify(ist), b = JSON.stringify(soll)
  if (a === b) { gruen++; console.log(`  ok   ${name}`) }
  else {
    rot++
    console.log(`  ROT  ${name}`)
    console.log(`       soll ${b}`)
    console.log(`       ist  ${a}`)
  }
}

const EINSTELLUNGEN = new Map([[SETTING.base, GATE_DEFAULT_BASE], [SETTING.key, "pk_pruefsatz"]])
globalThis.game = {
  settings: { get(_m, name) { return EINSTELLUNGEN.get(name) ?? "" } },
  i18n: { localize: s => s, format: s => s },
}
// `ours` fragt den Host gegen `location`. Ohne diese Zeile waere jede Adresse fremd.
globalThis.location = { href: `${GATE_DEFAULT_BASE}/` }

const f = await import("./stream-fetch.mjs")

const B = `${GATE_DEFAULT_BASE}/a/pk_pruefsatz`
const KARTE = `${B}/beneos_bm_0113/4k/scenes/karte.webp`
const DATEI = `${B}/beneos_cr_0042/normal/tokens/goblin.webp`
const TON = `${B}/beneos_bm_0113/4k/sounds/regen.ogg`

// Der alte Abgleich aus stream-offline.mjs vor stre-T-081, woertlich.
function adresseNormalAlt(url) {
  try { const u = new URL(String(url)); u.search = ""; u.hash = ""; return u.href }
  catch (_) { return String(url) }
}
function alterAbgleich(gehalten, gedecktListe) {
  const gedeckt = new Set(gedecktListe.map(adresseNormalAlt))
  return gehalten.filter(g => !gedeckt.has(adresseNormalAlt(g.url)))
}
const alterFilter = urls => [...new Set((urls || []).filter(u => typeof u === "string" && f.ours(u)))]

// So baut `gehalteneAdressen` einen Eintrag: Store-Schluessel, daraus die Toradresse.
function gehaltenAus(url, bytes = 1) {
  const schluessel = f.vorratsSchluessel(url)
  return { url: f.adresseAusSchluessel(schluessel), schluessel, bytes }
}

console.log("\nTeil 1: Legacy, Schalter AUS")
gleich("Vorratsschluessel der Karte zeichengleich", f.vorratsSchluessel(KARTE),
  "https://beneos-stream.invalid/a/beneos_bm_0113/4k/scenes/karte.webp")
gleich("Vorratsschluessel der /a/-Datei zeichengleich", f.vorratsSchluessel(DATEI),
  "https://beneos-stream.invalid/a/beneos_cr_0042/normal/tokens/goblin.webp")
gleich("Vorratsschluessel des Tonstuecks zeichengleich", f.vorratsSchluessel(TON),
  "https://beneos-stream.invalid/a/beneos_bm_0113/4k/sounds/regen.ogg")
for (const [name, u] of [["Karte", KARTE], ["/a/-Datei", DATEI], ["Tonstueck", TON]]) {
  gleich(`${name}: der Rueckweg gibt die Toradresse von heute`, gehaltenAus(u).url, u)
}

const G = [gehaltenAus(KARTE), gehaltenAus(DATEI), gehaltenAus(TON)]
const faelle = [
  ["alles gedeckt", [KARTE, DATEI, TON]],
  ["nichts gedeckt", []],
  ["nur die Karte gedeckt", [KARTE]],
  ["Deckung mit Abfrage und Anker", [`${DATEI}?v=2`, `${TON}#t`]],
]
for (const [name, gedeckt] of faelle) {
  gleich(`ohneDeckung wie der alte Abgleich: ${name}`,
    f.ohneDeckung(G, gedeckt).map(g => g.url), alterAbgleich(G, gedeckt).map(g => g.url))
}
const eingaben = [KARTE, DATEI, TON, KARTE, "https://fremd.example/a/x/y/z.webp", 7, null]
gleich("eigeneEingaben wie der alte Filter", f.eigeneEingaben(eingaben), alterFilter(eingaben))

/*
 * Teil 2, SCHALTER AN, ueber die Naht `vorratsSchluesselMitVorratFuerPruefsatz`.
 *
 * Mit dem Schalter AN liegt eine geteilte Datei unter einem release-freien
 * Schluessel. Der Rueckweg macht daraus eine /s/-Adresse (Traeger bekannt) oder
 * laesst den Schluessel stehen (Traeger unbekannt). Die Deckung dagegen kommt
 * als /a/-Adresse der Zusage oder als Kennung `shared|<sha>|<name>` aus dem
 * Gemeinschaftsvorrat. Ein Vergleich im ADRESSRAUM sieht zwei verschiedene
 * Zeichenketten fuer dieselbe Datei.
 *
 * Fall A: Traeger bekannt. Die zugesagte Datei darf NICHT verwaist heissen.
 * Fall B: Traeger unbekannt. Die verwaiste Datei muss sich loesen lassen, also
 *         muss `eigeneEingaben` ihren Schluessel annehmen.
 * Je Fall ein Gegenwert, der sich NICHT aendern darf.
 */
const VORRAT = "https://beneos-stream.invalid"
const SHA = "a".repeat(64)
const SHA_B = "b".repeat(64)
const KARTE_A = `${B}/beneos_bm_0113/4k/map_assets/foundry_bm_ui.webp`
const AN = { an: true }

console.log("\nTeil 2, Fall A: Schalter AN, Traeger bekannt")
f.merkePruefsummen([[KARTE_A, SHA]])
const keyA = f.vorratsSchluesselMitVorratFuerPruefsatz(KARTE_A)
gleich("Fall A: der Schluessel ist release-frei", keyA,
  `${VORRAT}/a/shared/${SHA}/foundry_bm_ui.webp`)
const gehaltenA = [{ url: f.adresseAusSchluessel(keyA), schluessel: keyA, bytes: 1 }]
gleich("Fall A: der Rueckweg gibt eine /s/-Adresse",
  gehaltenA[0].url.startsWith(`${GATE_DEFAULT_BASE}/s/`), true)
gleich("P-A: Zusage mit der Kartenadresse deckt die Datei",
  f.ohneDeckung(gehaltenA, [KARTE_A], AN).length, 0)
gleich("P-A: Kennung aus dem Gemeinschaftsvorrat deckt die Datei",
  f.ohneDeckung(gehaltenA, [`shared|${SHA}|foundry_bm_ui.webp`], AN).length, 0)
gleich("P-A Gegenwert: ohne Deckung ist sie verwaist",
  f.ohneDeckung(gehaltenA, [], AN).length, 1)

console.log("\nTeil 2, Fall B: Schalter AN, Traeger unbekannt")
const keyB = `${VORRAT}/a/shared/${SHA_B}/kompass.webp`
const gehaltenB = [{ url: f.adresseAusSchluessel(keyB), schluessel: keyB, bytes: 1 }]
gleich("Fall B: der Rueckweg laesst den Schluessel stehen", gehaltenB[0].url, keyB)
gleich("P-B Gegenwert: ohne Deckung ist sie verwaist",
  f.ohneDeckung(gehaltenB, [], AN).map(g => g.url), [keyB])
gleich("P-B: der verwaiste Schluessel ist loesbar", f.eigeneEingaben([keyB]), [keyB])
gleich("P-B: Kennung aus dem Gemeinschaftsvorrat deckt sie",
  f.ohneDeckung(gehaltenB, [`shared|${SHA_B}|kompass.webp`], AN).length, 0)

console.log("\nTeil 2, Kennung zur Adresse (W2)")
gleich("Kennung einer Karte gibt die Toradresse wie bisher",
  f.adresseVonKennung("beneos_bm_0113|4k|scenes/karte.webp"), KARTE)
gleich("geteilte Kennung mit bekanntem Traeger gibt die /s/-Adresse",
  f.adresseVonKennung(`shared|${SHA}|foundry_bm_ui.webp`), gehaltenA[0].url)
gleich("Kennung shared ohne Pruefsumme: die Antwort von vorher",
  f.adresseVonKennung("shared|normal|ui.webp"), assetUrl("shared", "normal", "ui.webp"))
gleich("Gegenwert: geteilte Kennung ohne Traeger bleibt leer",
  f.adresseVonKennung(`shared|${SHA_B}|kompass.webp`), "")

console.log("\nTeil 2, fremder Ursprung")
const fremd = [
  "https://beneos-stream.invalid.evil.example/a/shared/x/y.webp",
  "https://beneos-stream.invalidx/a/shared/x/y.webp",
  "https://fremd.example/a/shared/x/y.webp",
  `${VORRAT}/b/shared/x/y.webp`,
]
gleich("fremder Ursprung wird nicht geloest", f.eigeneEingaben(fremd), [])

/*
 * Teil 2b, WELTSTART (Kalt-Review stre-T-081). `verwaisteLoesen` laeuft beim
 * Weltstart, bevor ein Manifest geladen ist; das Sitzungsverzeichnis kennt
 * dann keine Pruefsumme. Die Deckung kommt als /a/-Kartenadresse oder als
 * Kennung in Kartenform, die Datei liegt unter dem geteilten Schluessel.
 * Im Zweifel bleibt sie gehalten: eine geteilte Datei desselben Namens deckt.
 */
console.log("\nTeil 2b: Schalter AN, Weltstart ohne Pruefsumme")
const SHA_C = "c".repeat(64)
const KOMPASS = `${B}/beneos_bm_0113/4k/map_assets/kompass.webp`
const keyC = `${VORRAT}/a/shared/${SHA_C}/kompass.webp`
const gehaltenC = [{ url: f.adresseAusSchluessel(keyC), schluessel: keyC, bytes: 1 }]
gleich("Weltstart: Zusage mit der Kartenadresse deckt sie",
  f.ohneDeckung(gehaltenC, [KOMPASS], AN).length, 0)
gleich("Weltstart: Kennung in Kartenform deckt sie",
  f.ohneDeckung(gehaltenC, ["beneos_bm_0113|4k|map_assets/kompass.webp"], AN).length, 0)
gleich("Weltstart Gegenwert: eine andere geteilte Datei deckt sie nicht",
  f.ohneDeckung(gehaltenC, [`${B}/beneos_bm_0113/4k/map_assets/stop.webp`], AN).length, 1)
gleich("Weltstart Gegenwert: eine Kartendatei gleichen Namens deckt sie nicht",
  f.ohneDeckung(gehaltenC, [`${B}/beneos_bm_0113/4k/scenes/kompass.webp`], AN).length, 1)

console.log("\nTeil 2c: Schalter AUS, Sonderformen des Speichers")
gleich("roher Speicherschluessel (Umzug gescheitert): gedeckt wie vorher",
  f.ohneDeckung([{ url: KARTE, schluessel: KARTE, bytes: 1 }], [KARTE]).length, 0)
gleich("gewollte Abweichung: Deckung unter frueherem Streamschluessel haelt die Datei",
  f.ohneDeckung([gehaltenAus(KARTE)],
    [`${GATE_DEFAULT_BASE}/a/pk_alt/beneos_bm_0113/4k/scenes/karte.webp`]).length, 0)

/*
 * Teil 2d, DER ZWILLING `geteilteLuecken` fragt umgekehrt: ist ein Eintrag des
 * Gemeinschaftsvorrats gehalten? Er muss im selben Raum fragen wie
 * `verwaisteLoesen`, sonst widersprechen sich beide im selben Weltstart.
 */
console.log("\nTeil 2d: geteilteLuecken im selben Raum")
const pruefung = (g, o) => (typeof f.gehaltenePruefung === "function" ? f.gehaltenePruefung(g, o) : () => null)
gleich("AUS: eine gehaltene Karte gilt als gehalten", pruefung([gehaltenAus(KARTE)])(KARTE), true)
gleich("AN, Pruefsumme bekannt: die /a/-Adresse gilt als gehalten", pruefung(gehaltenA, AN)(KARTE_A), true)
// Nur der Name passt, die Pruefsumme ist unbekannt: "unklar". `geteilteLuecken`
// laesst den Vermerk dann stehen, weder setzen noch loeschen; ein echter
// Fehlvermerk einer gleichnamigen anderen Datei bleibt so erhalten.
gleich("AN, Weltstart: der Eintrag in Kartenform ist unklar", pruefung(gehaltenC, AN)(KOMPASS), "unklar")

console.log("\nTeil 2e: die Namensregel gilt nur bei AN")
gleich("AUS: ein geteilter Schluessel ist durch die Kartenform nicht gedeckt",
  f.ohneDeckung(gehaltenC, [KOMPASS]).length, 1)
gleich("AUS: ein geteilter Schluessel gilt fuer die Kartenform nicht als gehalten",
  pruefung(gehaltenC)(KOMPASS), false)
gleich("Gegenwert: ohne gehaltene Datei fehlt der Eintrag", pruefung([], AN)(KOMPASS), false)

/*
 * Teil 3, STRUKTUR. Die Anschluesse im Browserteil laden in node nicht; sie
 * werden am Quelltext gelesen, je am Funktionskoerper und nicht an der Datei.
 */
console.log("\nTeil 3: Struktur der Anschluesse")
const { readFileSync } = await import("node:fs")
const hier = new URL(".", import.meta.url)
const quelle = name => readFileSync(new URL(name, hier), "utf8").replace(/\r\n/g, "\n")
const koerper = (text, kopf) => {
  const a = text.indexOf(kopf)
  if (a < 0) return ""
  const e = text.indexOf("\n}\n", a)
  return text.slice(a, e < 0 ? undefined : e)
}
const offlineQ = quelle("stream-offline.mjs")
const fetchQ = quelle("stream-fetch.mjs")
gleich("[Struktur] adresseVon ruft adresseVonKennung",
  /return adresseVonKennung\(kennung\)/.test(koerper(offlineQ, "export function adresseVon(")), true)
gleich("[Struktur] verwaisteLoesen loest ueber den Schluessel",
  /offlineFreigeben\(verwaist\.map\(v => v\.schluessel \|\| v\.url\)\)/
    .test(koerper(offlineQ, "export async function verwaisteLoesen(")), true)
gleich("[Struktur] gehalteneAdressen gibt den Schluessel mit",
  /schluessel: anfrage\.url,/.test(koerper(fetchQ, "export async function gehalteneAdressen(")), true)
gleich("[Struktur] geteilteLuecken fragt ueber gehaltenePruefung",
  /gehaltenePruefung\(await gehalteneAdressen\(\)\)/.test(koerper(offlineQ, "export async function geteilteLuecken(")), true)
gleich("[Struktur] geteilteLuecken laesst einen unklaren Eintrag unberuehrt",
  /if \(stand === "unklar"\) continue/.test(koerper(offlineQ, "export async function geteilteLuecken(")), true)

console.log(`\n${gruen} gruen, ${rot} rot`)
console.log("\nNicht geprueft: der Browser-Speicher selbst (gehalteneAdressen, vMatch, vPut).")
console.log("Das deckt der Lauf auf dem Pruefstand, nicht dieser Satz.")
process.exit(rot > 0 ? 1 : 0)
