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
 */
import { GATE_DEFAULT_BASE, SETTING } from "./stream-settings.mjs"

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

console.log(`\n${gruen} gruen, ${rot} rot`)
console.log("\nNicht geprueft: der Browser-Speicher selbst (gehalteneAdressen, vMatch, vPut).")
console.log("Das deckt der Lauf auf dem Pruefstand, nicht dieser Satz.")
process.exit(rot > 0 ? 1 : 0)
