// Prueft, dass jeder Streaming-Text in allen dreizehn Sprachen vorliegt und
// dass in den Streaming-Vorlagen kein fester Text mehr steht.
//
// Hintergrund, 29.10.2026. `templates/stream/offline-vorrat.hbs` trug deutsche
// Festtexte, in einem Produkt mit dreizehn Sprachdateien: ein Englaender sah
// dort "Die Frist ist abgelaufen." Beim Nachzaehlen kamen zwei weitere Luecken
// heraus, die niemand gemeldet hatte, weil nichts danach sah: drei Schluessel
// fehlten in allen zwoelf nicht-englischen Dateien, und die komplette
// Erklaerung beim ersten Weltstart stand ueberall auf Englisch.
//
// Betreibervorgabe vom selben Tag: zum Release muessen alle Strings in allen
// Sprachen vorliegen. Dieser Stand ist die Messung dazu.
//
// DREI AUSSAGEN, und die dritte ist die, die den Rueckfall verhindert:
//   1. jeder Schluessel, den eine Streaming-Vorlage ruft, steht in en.json
//   2. jeder BENEOS.Stream.*-Schluessel steht in allen dreizehn Dateien
//   3. keine Streaming-Vorlage traegt einen festen Text
//
// WARUM "GLEICH WIE ENGLISCH" NUR EIN HINWEIS IST UND KEIN FEHLER. Kurze
// Woerter sind in mehreren Sprachen wirklich gleich; "Offline" ist auf
// Franzoesisch "Offline". Ein LANGER englischer Satz in einer deutschen Datei
// ist dagegen nie eine Uebersetzung, sondern eine vergessene. Die Grenze liegt
// deshalb bei der Laenge, nicht bei der Gleichheit.
//
// Aufruf:
//   node bench.mjs          faehrt gegen den aktuellen Stand
//   node bench.mjs --liste  nennt zusaetzlich jede beanstandete Zeile
//
// Kein Foundry und kein Netz noetig.

import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HERE, "..", "..")
const LANG = join(WURZEL, "lang")
const VORLAGEN = join(WURZEL, "templates", "stream")

const zeigeListe = process.argv.includes("--liste")

/* ---------------------------------------------------------- Mini-Pruefstand */

let bestanden = 0
let gescheitert = 0

function ok(name, bedingung, detail = "") {
  if (bedingung) {
    console.log(`  ok   ${name}`)
    bestanden++
  } else {
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`)
    gescheitert++
  }
}

/* ------------------------------------------------------------- Die Quellen */

const dateien = readdirSync(LANG).filter((f) => f.endsWith(".json")).sort()
const sprachen = {}
for (const f of dateien) {
  sprachen[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(LANG, f), "utf8"))
}
const en = sprachen.en
if (!en) throw new Error("lang/en.json fehlt")

const vorlagen = readdirSync(VORLAGEN).filter((f) => f.endsWith(".hbs")).sort()

console.log(`\n${dateien.length} Sprachdateien, ${vorlagen.length} Streaming-Vorlage(n)`)

/* ----------------------------- 1. Vorlagenschluessel stehen in der Leitsprache */

console.log("\nJeder gerufene Schluessel steht in en.json")

const gerufen = new Map()
for (const name of vorlagen) {
  const text = readFileSync(join(VORLAGEN, name), "utf8")
  for (const treffer of text.matchAll(/localize\s+"([A-Za-z0-9._-]+)"/g)) {
    if (!gerufen.has(treffer[1])) gerufen.set(treffer[1], name)
  }
}

const unbekannt = [...gerufen].filter(([k]) => !(k in en))
ok(`alle ${gerufen.size} gerufenen Schluessel sind in en.json bekannt`,
  unbekannt.length === 0,
  unbekannt.map(([k, d]) => `${k} (${d})`).join(", "))

/*
 * Gegenfrage: findet der Leser ueberhaupt etwas? Ein Muster, das nichts
 * trifft, meldet null Unbekannte und sieht aus wie ein sauberer Lauf.
 */
ok("der Leser findet ueberhaupt Schluessel in den Vorlagen", gerufen.size >= 10,
  `gefunden: ${gerufen.size}`)

/* --------------------------------- 2. Jeder Stream-Schluessel in allen Sprachen */

console.log("\nJeder BENEOS.Stream.*-Schluessel steht in allen Sprachen")

const streamKeys = Object.keys(en).filter((k) => k.startsWith("BENEOS.Stream."))
const quotaKeys = Object.keys(en).filter((k) => k.startsWith("BENEOS.Cloud.Bmap.Quota"))
const pflicht = [...streamKeys, ...quotaKeys]

let fehlendGesamt = 0
const fehlendJeSprache = []
for (const [code, d] of Object.entries(sprachen)) {
  const fehlt = pflicht.filter((k) => !(k in d))
  fehlendGesamt += fehlt.length
  if (fehlt.length) fehlendJeSprache.push(`${code}: ${fehlt.length}`)
  if (zeigeListe && fehlt.length) {
    for (const k of fehlt) console.log(`       fehlt  ${code}  ${k}`)
  }
}

ok(`kein Schluessel fehlt (${pflicht.length} Pflichtschluessel mal ${dateien.length} Sprachen)`,
  fehlendGesamt === 0,
  fehlendJeSprache.join(", "))

/*
 * Lange englische Saetze in einer fremden Sprachdatei. Kurze Woerter duerfen
 * gleich sein, lange Saetze nie: eine Uebersetzung, die Zeichen fuer Zeichen
 * dem Englischen gleicht, ist keine.
 */
const LANG_GENUG = 25
let unuebersetztGesamt = 0
const unuebersetztJeSprache = []
for (const [code, d] of Object.entries(sprachen)) {
  if (code === "en") continue
  const gleich = pflicht.filter(
    (k) => k in d && d[k] === en[k] && String(en[k]).length > LANG_GENUG)
  unuebersetztGesamt += gleich.length
  if (gleich.length) unuebersetztJeSprache.push(`${code}: ${gleich.length}`)
  if (zeigeListe && gleich.length) {
    for (const k of gleich) console.log(`       englisch  ${code}  ${k}`)
  }
}

ok(`kein langer Satz steht unuebersetzt auf Englisch (ueber ${LANG_GENUG} Zeichen)`,
  unuebersetztGesamt === 0,
  unuebersetztJeSprache.join(", "))

/* --------------------------------- 3. Keine festen Texte in den Vorlagen */

console.log("\nKeine festen Texte in den Streaming-Vorlagen")

/*
 * Umlaute und scharfes S sind der billigste sichere Fund: sie koennen in einer
 * Vorlage nur aus einem deutschen Festtext stammen, denn jeder sichtbare Text
 * soll durch `localize` kommen. Kommentare zaehlen nicht mit, sie werden nie
 * ausgeliefert.
 */
const deutsch = []
for (const name of vorlagen) {
  const text = readFileSync(join(VORLAGEN, name), "utf8")
  const ohneKommentar = text.replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![\s\S]*?\}\}/g, "")
  for (const [i, zeile] of ohneKommentar.split("\n").entries()) {
    if (/[äöüßÄÖÜ]/.test(zeile)) deutsch.push(`${name}:${i + 1}`)
  }
}

ok("keine Vorlage traegt Umlaute ausserhalb von Kommentaren",
  deutsch.length === 0, deutsch.join(", "))

/*
 * Gegenprobe zur Umlautregel: sie findet nur deutsche Festtexte, keine
 * englischen. Deshalb zusaetzlich die Form messen, in der ein Festtext
 * auftritt, naemlich sichtbarer Text direkt zwischen zwei Tags.
 */
const festText = []
for (const name of vorlagen) {
  const text = readFileSync(join(VORLAGEN, name), "utf8")
  const ohneKommentar = text.replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![\s\S]*?\}\}/g, "")
  for (const [i, zeile] of ohneKommentar.split("\n").entries()) {
    // Text zwischen > und <, der Buchstaben traegt und kein Handlebars ist.
    for (const t of zeile.matchAll(/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g)) {
      const roh = t[1].trim()
      // "MB" und "GB" sind Einheiten und in jeder Sprache gleich.
      if (!roh || /^(MB|GB|KB)$/.test(roh)) continue
      festText.push(`${name}:${i + 1} "${roh.slice(0, 40)}"`)
    }
  }
}

ok("kein sichtbarer Text steht roh zwischen zwei Tags",
  festText.length === 0, festText.slice(0, 5).join(" | "))

/* ------------------------------------------------------------------ Bilanz */

console.log(`\n${bestanden} bestanden, ${gescheitert} gescheitert`)
process.exit(gescheitert === 0 ? 0 : 1)
