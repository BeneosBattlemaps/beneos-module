/**
 * sprachschluessel.test.mjs
 *
 *   node tools/sprachschluessel.test.mjs
 *
 * Jede Sprachdatei unter lang/ muss genau die Schluessel von lang/en.json
 * tragen, und jeder Wert dieselben Platzhalter {x} wie sein englisches
 * Gegenstueck.
 *
 * WARUM (MO-055)
 *
 * Gemessen am 2026-11-25 auf main 1f886be fehlten in elf Sprachen je 19
 * Schluessel und in de 11. Vier Commits hatten en.json erweitert, die anderen
 * Sprachen nicht, und kein Tor hat es bemerkt. Foundry faellt dann still auf
 * Englisch zurueck, und Kunden lesen englische Saetze mitten in ihrer Sprache.
 *
 * Geprueft wird in beide Richtungen: ein fehlender Schluessel ist rot, ein
 * ueberzaehliger auch. Der ueberzaehlige ist meist ein Tippfehler im Namen,
 * und dann fehlt derselbe Text unter dem richtigen Namen.
 *
 * Platzhalter werden als Multimenge verglichen, ohne Reihenfolge: die
 * Uebersetzungen stellen sie grammatisch um, gemessen 59 Faelle in 20
 * Schluesseln (45 davon in ja, ko und zh-TW), die alle richtig sind. Ein
 * fehlendes {packages} dagegen liesse dem Kunden einen leeren Satzteil.
 *
 * WARUM AUCH DIE HTML-TAGS (MO-056)
 *
 * Gemessen am 2026-11-25 auf main 460cf52 wichen in zwoelf Sprachen 11
 * Schluessel (de 10) in ihren Tags von en ab, und jeder davon war ein
 * veralteter Text: en hatte die Tour neu geschrieben, die Uebersetzungen
 * erklaerten noch Moulinette und zwei Icons, die es nicht mehr gibt. Die
 * Platzhalterpruefung sah das nicht, die Tags schon. Verglichen wird deshalb
 * auch die Multimenge der Tags, mit Tagname und Attributen.
 *
 * Ausgenommen sind die Attribute, deren Wert Text fuer den Kunden ist: alt,
 * title, aria-label und placeholder. Ohne diesen Filter wichen 507 Paare
 * (Sprache, Schluessel) ab statt 131, die 376 zusaetzlichen waren uebersetzte
 * Bildbeschreibungen der Wiki-Seiten und damit richtig. Alles andere, auch
 * src, href, style, class, id und data-*, muss gleich bleiben: ein anderes
 * src zeigt ein anderes Bild, ein anderes data-wiki-jump springt woanders hin.
 * Hergeleitet mit tags() unten, einmal mit und einmal ohne den Filter, ueber
 * alle Schluessel aller Sprachdateien gegen en.
 *
 * Dazu prueft balance() jeden Wert fuer sich, auch in en: jedes Tag wird
 * geschlossen, kein schliessendes Tag steht ohne oeffnendes, und kein "<" mit
 * Tagnamen bleibt ohne ">". Ein offenes <strong> faerbt in Foundry den Rest
 * des Fensters fett. Am 2026-11-25 hatte das kein Wert, die Pruefung haelt es
 * so.
 *
 * AUSGABE
 *
 * Zeilen der Form "  ROT  <datei>: ..." auf stdout, vor dem TAP von
 * node:test. Der pre-commit-Haken zeigt bei rotem Lauf nur das Ende der
 * Ausgabe, zieht aber Zeilen dieser Form zuerst heraus, hoechstens 20. Ohne
 * sie nannte ein abgebrochener Commit weder Datei noch Schluessel
 * (Kalt-Review des Plans, Beleg B8).
 *
 * Deshalb zuerst je roter Datei EINE Uebersichtszeile mit Anzahl und erster
 * Abweichung, danach die Einzelzeilen. So nennt der Haken jede rote Datei,
 * auch wenn eine neue Sprache ohne Uebersetzung hunderte Zeilen bringt
 * (Kalt-Review des Diffs: mit Einzelzeilen zuerst verdeckte ar.json eine
 * fehlende Zeile in fr.json ganz). Eine Datei, die kein gueltiges JSON ist,
 * bekommt ebenfalls eine Zeile mit ihrem Namen; die anderen laufen weiter.
 *
 * Der Pfad zu lang/ steht woertlich im new URL(), damit
 * tools/haken/betroffen.mjs diese Pruefung bei jeder Aenderung unter lang/
 * waehlt. Ein zusammengesetzter Pfad waere dort unsichtbar (MO-049).
 * Auf stream-beta gibt es betroffen.mjs nicht; dort faehrt ein eigener Block
 * in tools/haken/wachen/stre.sh die Pruefung gegen den Index (stre-T-496).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const LANG = fileURLToPath(new URL("../lang/", import.meta.url))
const MAX_ZEILEN = 20

/** Verschachtelte Objekte zu "a.b.c" abflachen; Foundry liest beide Formen. */
export function flach(obj, prefix = "", aus = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === "object" && !Array.isArray(v)) flach(v, name, aus)
    else aus.set(name, v)
  }
  return aus
}

const platzhalter = (wert) =>
  [...String(wert).matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]).sort().join("\u0000")

// Ein Tag beginnt nur mit "<" vor einem Buchstaben oder "/" und Buchstaben.
// Text wie "&lt; 1" oder "a < b" ist damit nie ein Tag. Attributwerte in
// Anfuehrungszeichen duerfen ">" enthalten, ohne das Tag zu beenden.
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g
const ATTRIBUT = /([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g
const TAG_ANFANG = /<\/?[a-zA-Z]/
const UEBERSETZBAR = new Set(["alt", "title", "aria-label", "placeholder"])
const LEER = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

/** Multimenge der Tags eines Werts, ohne die uebersetzbaren Attribute. */
export function tags(wert) {
  return [...String(wert).matchAll(TAG)].map((m) => {
    const attribute = [...m[3].matchAll(ATTRIBUT)]
      .filter((a) => !UEBERSETZBAR.has(a[1].toLowerCase()))
      .map((a) => `${a[1].toLowerCase()}=${a[2] ?? ""}`)
      .sort()
    return [`${m[1]}${m[2].toLowerCase()}`, ...attribute].join(" ")
  }).sort().join("\u0000")
}

/** Fehler im Aufbau eines Werts: offene, verwaiste und unvollstaendige Tags. */
export function balance(wert) {
  const text = String(wert)
  const stapel = []
  const fehler = []
  for (const m of text.matchAll(TAG)) {
    const name = m[2].toLowerCase()
    if (LEER.has(name) || m[4] === "/") continue
    if (!m[1]) stapel.push(name)
    else if (stapel.at(-1) === name) stapel.pop()
    else fehler.push(`</${name}> ohne oeffnendes Tag`)
  }
  if (stapel.length) fehler.push(`nicht geschlossen: <${stapel.join(">, <")}>`)
  if (TAG_ANFANG.test(text.replace(TAG, ""))) fehler.push("Tag ohne Abschluss >")
  return fehler
}

/** Abweichungen einer Sprache gegen en, je Eintrag { art, schluessel }. */
export function vergleiche(en, andere) {
  const aus = []
  for (const k of en.keys()) if (!andere.has(k)) aus.push({ art: "fehlt", schluessel: k })
  for (const k of andere.keys()) if (!en.has(k)) aus.push({ art: "ueberzaehlig", schluessel: k })
  for (const [k, v] of andere) {
    if (en.has(k) && platzhalter(v) !== platzhalter(en.get(k))) {
      aus.push({ art: "platzhalter", schluessel: k })
    }
    if (en.has(k) && tags(v) !== tags(en.get(k))) aus.push({ art: "tags", schluessel: k })
    if (balance(v).length) aus.push({ art: "balance", schluessel: k })
  }
  return aus
}

/** Liest eine Sprachdatei; ein Syntaxfehler kommt als { fehler } zurueck. */
function lies(datei) {
  try {
    return { werte: flach(JSON.parse(fs.readFileSync(path.join(LANG, datei), "utf8"))) }
  } catch (e) {
    return { fehler: `kein gueltiges JSON (${e.message})` }
  }
}

const en = lies("en.json")
if (en.fehler) {
  console.log(`  ROT  en.json: ${en.fehler}`)
  throw new Error(`lang/en.json: ${en.fehler}`)
}
const sprachen = fs.readdirSync(LANG).filter((f) => f.endsWith(".json") && f !== "en.json").sort()

const befunde = new Map(sprachen.map((datei) => {
  const d = lies(datei)
  return [datei, d.fehler ? [{ art: "json", schluessel: d.fehler }] : vergleiche(en.werte, d.werte)]
}))

// en hat kein Gegenueber, nur den eigenen Aufbau.
const aufbauEn = [...en.werte]
  .filter(([, v]) => balance(v).length > 0)
  .map(([k]) => ({ art: "balance", schluessel: k }))

// Bankformat vor dem TAP, damit der Haken den Ort zeigt: erst je rote Datei
// eine Uebersichtszeile, dann hoechstens MAX_ZEILEN Einzelzeilen je Datei.
const rot = [["en.json", aufbauEn], ...befunde].filter(([, liste]) => liste.length > 0)
for (const [datei, liste] of rot) {
  const erste = liste[0]
  console.log(`  ROT  ${datei}: ${liste.length} Abweichung(en), erste: ${erste.art} ${erste.schluessel}`)
}
for (const [datei, liste] of rot) {
  for (const b of liste.slice(0, MAX_ZEILEN)) console.log(`  ROT  ${datei}: ${b.art} ${b.schluessel}`)
  if (liste.length > MAX_ZEILEN) console.log(`  ROT  ${datei}: und ${liste.length - MAX_ZEILEN} weitere`)
}

test("die Vergleichsfunktion meldet fehlende, ueberzaehlige und verlorene Platzhalter", () => {
  const vorlage = new Map([["A", "x"], ["B", "{n} y"], ["C", "{a} {b}"]])
  const probe = new Map([["A", "x"], ["B", "y"], ["C", "{b} {a}"], ["D", "z"]])
  const gefunden = vergleiche(vorlage, new Map([...probe].filter(([k]) => k !== "A")))
    .concat(vergleiche(vorlage, probe))
    .map((b) => `${b.art} ${b.schluessel}`)
  assert.deepEqual(gefunden.sort(), [
    "fehlt A", "platzhalter B", "platzhalter B", "ueberzaehlig D", "ueberzaehlig D",
  ])
})

test("die Vergleichsfunktion meldet abweichende und kaputte Tags", () => {
  const vorlage = new Map([
    ["E", "<p><b>x</b></p>"],
    ["F", "<p>y</p>"],
    ["G", '<img src="a.webp" alt="Map">'],
    ["H", '<img src="a.webp" alt="Map">'],
    ["I", '<a data-wiki-jump="faq">z</a>'],
  ])
  const probe = new Map([
    ["E", "<p>x</b></p>"],
    ["F", "<p>y</p></p>"],
    ["G", '<img src="a.webp" alt="Karte">'],
    ["H", '<img src="b.webp" alt="Map">'],
    ["I", '<a data-wiki-jump="faq">Z</a>'],
  ])
  assert.deepEqual(vergleiche(vorlage, probe).map((b) => `${b.art} ${b.schluessel}`).sort(), [
    "balance E", "balance F", "tags E", "tags F", "tags H",
  ])
})

test("balance trennt Text von Tags und findet offene und unvollstaendige", () => {
  assert.deepEqual(balance("<p>ok<br><img src=\"x\" /></p>"), [])
  assert.deepEqual(balance("Tier &lt; 1, a < b"), [])
  assert.deepEqual(balance("<p><strong>offen</p>"), ["</p> ohne oeffnendes Tag", "nicht geschlossen: <p>, <strong>"])
  assert.deepEqual(balance('<a href="x>kaputt'), ["Tag ohne Abschluss >"])
})

test("es gibt Sprachdateien neben en.json", () => {
  assert.ok(sprachen.length > 0, `keine Sprachdatei unter ${LANG}`)
})

test("en.json schliesst jedes Tag, das es oeffnet", () => {
  assert.deepEqual(aufbauEn.map((b) => `${b.art} ${b.schluessel}`), [])
})

for (const [datei, liste] of befunde) {
  test(`${datei} traegt genau die Schluessel, Platzhalter und Tags von en.json`, () => {
    assert.deepEqual(liste.map((b) => `${b.art} ${b.schluessel}`), [])
  })
}
