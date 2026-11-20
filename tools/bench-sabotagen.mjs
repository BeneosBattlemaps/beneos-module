#!/usr/bin/env node
/**
 * MUTATIONSPROBEN FUER DIE BENCHES (stre-T-015).
 *
 * Die Benches unter `tools/*-bench` wurden am 07. bis 09.11.2026 mit
 * Sabotagen von Hand geprueft, und die standen danach nur als Erzaehlung im
 * Wiki. Dieser Laeufer macht sie wiederholbar: je Eintrag genau eine
 * Textersetzung im Modulcode einer Wegwerfkopie, danach muss der Bench rot
 * sein, und zwar an den benannten Zielen.
 *
 * WARUM EIN EIGENER LAEUFER NEBEN `tools/stream-sabotagen.mjs`:
 *   - `SATZDATEI` dort kennt nur die Pfade der Stream-Saetze.
 *   - Zwei Benches melden rot mit `  FAIL `; dort waere das ein Absturz.
 *   - v15-globale und doppelnamen melden nur ueber den Ausgang und `ROT:` auf
 *     stderr, ohne eine Zeile je Pruefung.
 *   - paket-grenze misst den Git-Index und braucht einen eigenen Baum.
 *   - Dort ist die Deckung jeder Probe der Gegenstand. Hier nicht: verlangt
 *     wird nur, dass jede Sabotage rot wird, nicht, dass jede Pruefung eines
 *     Benches von einer Sabotage getroffen wird. Die Benches standen nie
 *     unter dieser Regel, Gegenstand sind die Wiki-Sabotagen.
 *
 * ZWEI ARTEN VON BENCHES:
 *   zeilen   Je Pruefung eine Zeile mit Praefix. Ein Ziel ist der feste Teil
 *            eines Probennamens, vor der ersten Rechenzahl. Im Grundlauf muss
 *            genau eine gruene Probe mit dem Ziel beginnen, nach der
 *            Sabotage mindestens eine rote. Ein Anhang an der roten Zeile
 *            (` - detail`, `  (zusatz)`) stoert so nicht.
 *   ausgang  Nur Ausgang 0, 1 oder 2. Rot heisst Ausgang 1 und eine Zeile
 *            `ROT:` auf stderr. Ein Ziel ist der Anfang einer Ausgabezeile,
 *            die im Grundlauf nicht vorkommt. Der Grundlauf muss genau auf
 *            seiner Obergrenze stehen, sonst bliebe eine einzelne neue Stelle
 *            gruen, und der Lauf ist nicht pruefbar.
 *
 * paket-grenze laeuft in einer Kopie aller verfolgten Dateien mit eigenem
 * `git init`. Ohne Git endet der Bench mit 0, also wird vorher geprueft, dass
 * Git in der Kopie genau die Kopie als Wurzel nennt. Der Bench liest den
 * Index, also wird jede Ersetzung vorgemerkt.
 *
 * Doppelte Probennamen im Grundlauf sind nicht pruefbar: ein Ziel liesse sich
 * keiner Pruefung mehr zuordnen.
 *
 * Aufruf:   node tools/bench-sabotagen.mjs [--bench <name>] [--zeig]
 *           node tools/bench-sabotagen.mjs --selbstprobe
 * Rueckgabe 0 alles belegt, 1 ein Befund, 2 nicht pruefbar.
 * Geprueft in `tools/bench-sabotagen.test.mjs`.
 */

import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, existsSync, mkdirSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { fahreKind, einordnen, erklaere, maskiere, ZEITGRENZE_MS } from "./lib/kindlauf.mjs"
import { ersetze } from "./lib/ersetze.mjs"

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..")

const CLOUD = "scripts/beneos_cloud.js"
const SUCHE = "scripts/beneos_search_engine.js"
const FENSTER = "scripts/cloud-v2/cloud-window-v2.mjs"
const DE = "lang/de.json"
const FR = "lang/fr.json"
const OFFLINE = "scripts/stream/stream-offline.mjs"
const VORRAT = "templates/stream/offline-vorrat.hbs"
const ATTRIBUTE = ".gitattributes"
const SHEET = "scripts/loot/item-sheet-extender.mjs"
const TOUREN = "scripts/beneos_tours.js"
// stream-sprachen liest auch `tools/` nach Aufrufern. Stuende der Aufruf hier
// am Stueck, faende der Bench in dieser Tabelle einen zweiten Aufrufer, und
// die Sabotage daran bliebe gruen (gemessen beim Bau, stre-T-015).
const FETCHING1 = 'game.i18n.format("BENEOS.Stream.Offline.Fetching1", '

/*
 * DIE BENCHES. `rot` und `ok` sind die Zeilenpraefixe, gemessen am Grundlauf
 * (stre-T-015). `grenze` liest bei Art `ausgang` die Zeile "ist, erlaubt".
 */
export const BENCHES = {
  "waisen-adressform": { art: "zeilen", kopie: "teile" },
  "bildform-adresse": { art: "zeilen", kopie: "teile" },
  "filter-reihenfolge": { art: "zeilen", kopie: "teile", rot: ["  FAIL "] },
  "stream-sprachen": { art: "zeilen", kopie: "teile", rot: ["  FAIL "] },
  "paket-grenze": { art: "zeilen", kopie: "baum" },
  "v15-globale": { art: "ausgang", kopie: "teile", grenze: /^Stellen, die bei entferntem Globalen brechen: (\d+), erlaubt (\d+)$/ },
  "doppelnamen": { art: "ausgang", kopie: "teile", grenze: /^Doppelnamen: (\d+), erlaubt (\d+)$/ },
}
export const BENCHDATEI = (bench) => `tools/${bench}-bench/bench.mjs`

// Eine Sperrzeile der `.gitattributes`, einzeln entfernt (TC-305).
const ohneSperre = (zeile, ziel) => ({
  bench: "paket-grenze", ziel, ersetze: [[ATTRIBUTE, `\n${zeile}\n`, "\n"]],
})
// Eine zu weite Sperre dazu (TC-305). `dev/` steht genau einmal.
const weiteSperre = (zeile, ziel) => ({
  bench: "paket-grenze", ziel: ["keine der ", ...ziel],
  ersetze: [[ATTRIBUTE, "\ndev/ export-ignore\n", `\ndev/ export-ignore\n${zeile}\n`]],
})

/*
 * DIE SABOTAGEN. Je Eintrag `bench`, `ziel` und `ersetze` in der Form von
 * `tools/lib/ersetze.mjs`. Die Nummer in der Ausgabe ist die Stelle in dieser
 * Liste. Kommentar je Eintrag: Testfall und Wiki-Klasse.
 */
export const SABOTAGEN = [
  // TC-233 waisen-adressform. W1 ist die Wiki-Sabotage (Forge-Ausnahme umbenannt).
  { bench: "waisen-adressform", ziel: ["und sie ist als Funktion mit genau diesem Namen erklaert"],
    ersetze: [[CLOUD, "function _beneosUsingTheForge() {", "function _beneosUsingTheForgeXX() {"]] },
  { bench: "waisen-adressform", ziel: ["die Datei fuehrt genau EINE HEAD-Probe", "die Probe im Waisenzweig ist die gute"],
    ersetze: [[CLOUD, 'if (!(await _beneosProbeInstalledFile(protoSrc))) issues.push("missing_files")',
      'if (!(await fetch(protoSrc.startsWith("/") ? protoSrc : "/" + protoSrc, { method: "HEAD" })).ok) issues.push("missing_files")']] },
  { bench: "waisen-adressform", ziel: ["die Weiche fragt die Adressform, bevor sie probt"],
    ersetze: [[CLOUD, '} else if (_beneosAdressForm(protoSrc) !== "tor") {', "} else if (true) {"]] },
  { bench: "waisen-adressform", ziel: ["eine Kartenadresse ist eine Toradresse"],
    ersetze: [[CLOUD, 'return zerlegeAdresse(adresse) ? "tor" : "oertlich"', 'return "oertlich"']] },
  { bench: "waisen-adressform", ziel: ["sie bricht den Zwischenspeicher"],
    ersetze: [[CLOUD, '"?_b=" + Date.now()', '""']] },
  { bench: "waisen-adressform", ziel: ["sie erkennt den Stummel des Deinstallierers"],
    ersetze: [[CLOUD, "if (Number.isFinite(len) && len <= BENEOS_STUB_MAX_BYTES) return false",
      "if (Number.isFinite(len) && len <= 8) return false"]] },
  // Zwei Aufrufe weg: die Schranke verlangt mindestens 3 Treffer und zaehlt
  // die Erklaerung mit (heute 4). Ein einzelner entfernter Aufruf bleibt
  // gruen; das ist eine Luecke des Benches, gemeldet unter stre-T-015.
  { bench: "waisen-adressform", ziel: ["die Forge-Ausnahme wird wirklich aufgerufen"],
    ersetze: [[CLOUD, "if (_beneosUsingTheForge()) return 0", "if (false) return 0"],
      [CLOUD, "if (_beneosUsingTheForge()) return { aspectsExpected: 0, aspectsMissing: [] }", "if (false) return { aspectsExpected: 0, aspectsMissing: [] }"]] },

  // TC-289, 291, 299, 311 stream-sprachen. L1 und L2: gefaltete Wortformen
  // (289, 291), L3 und L4: Platzhalter je Form (299), L5: ein Aufrufer ohne
  // seinen Platzhalter (311), L6: Rohtext in einer Vorlage, L7: ein fehlender
  // Schluessel. Das JSON bleibt in jedem Eintrag gueltig.
  { bench: "stream-sprachen", ziel: ["kein ausgelieferter Textbaustein traegt eine gefaltete Wortform "],
    ersetze: [[DE, "Streaming ist für dieses Release mit deinem aktuellen Zugang nicht verfügbar.",
      "Streaming ist fuer dieses Release mit deinem aktuellen Zugang nicht verfuegbar."]] },
  { bench: "stream-sprachen", ziel: ["kein ausgelieferter Textbaustein traegt eine gefaltete Wortform "],
    ersetze: [[DE, "Wir haben den Aktoren-Tab für dich", "Wir haben den Aktoren-Tab fuer dich"]] },
  { bench: "stream-sprachen", ziel: ['kein Platzhalter der Form "geschweift" weicht ab '],
    ersetze: [[DE, "„{name}“ wird für die Offline-Nutzung geladen...", "„{nom}“ wird für die Offline-Nutzung geladen..."]] },
  { bench: "stream-sprachen", ziel: ['kein Platzhalter der Form "prozent" weicht ab '],
    ersetze: [[FR, "'%name%' (%variant%) est déjà installée", "'%name%' (%variante%) est déjà installée"]] },
  { bench: "stream-sprachen", ziel: ["kein Platzhalter bleibt unbefuellt "],
    ersetze: [[OFFLINE, FETCHING1 + "{ name: k.name })", FETCHING1 + "{ nam: k.name })"]] },
  { bench: "stream-sprachen", ziel: ["kein sichtbarer Text steht roh zwischen zwei Tags"],
    ersetze: [[VORRAT, '<p><strong>{{localize "BENEOS.Stream.Doku.BarLead"}}</strong>',
      "<p><strong>Noch keine Karte offline gestellt.</strong>"]] },
  { bench: "stream-sprachen", ziel: ["kein Schluessel fehlt "],
    ersetze: [[DE, '\n  "BENEOS.Stream.ManifestDenied": "Streaming ist für dieses Release mit deinem aktuellen Zugang nicht verfügbar.",\n', "\n"]] },

  // TC-292 filter-reihenfolge. F1 ist die Wiki-Klasse (zu weite Form `<abc`).
  { bench: "filter-reihenfolge", ziel: ["`<abc` ist keine Schwelle"],
    ersetze: [[SUCHE, "const BENEOS_SCHWELLE = /^([<>])(\\d+(?:[.,]\\d+)?)$/", "const BENEOS_SCHWELLE = /^([<>])(.*)$/"]] },
  { bench: "filter-reihenfolge", ziel: ["und Big steht vor Very Big", "die Gitterliste steht als Leiter "],
    ersetze: [[SUCHE, "return a.kleiner ? -1 : 1", "return a.kleiner ? 1 : -1"]] },
  { bench: "filter-reihenfolge", ziel: ["eine Zahlenliste mit Null und zweistelligen Werten "],
    ersetze: [[SUCHE, "return Number(a.key) - Number(b.key)", "return String(a.key).localeCompare(String(b.key))"]] },
  { bench: "filter-reihenfolge", ziel: ["die Regel selbst haelt any vorn "],
    ersetze: [[SUCHE, "return [...vorn, ...sortiert]", "return [...sortiert, ...vorn]"]] },
  { bench: "filter-reihenfolge", ziel: ["die Preisliste geht durch sortProperties"],
    ersetze: [[SUCHE, "price: BeneosDatabaseHolder.sortProperties(structuredClone(this.itemPrice)),",
      "price: structuredClone(this.itemPrice),"]] },
  { bench: "filter-reihenfolge", ziel: ["die Seltenheit wird nicht mehr in das Array hineingemischt"],
    ersetze: [[SUCHE, "foundry.utils.mergeObject(this.itemOrigin, this.buildList(itemData.properties.origin))",
      "foundry.utils.mergeObject(this.itemOrigin, this.buildList(itemData.properties.origin))\n        foundry.utils.mergeObject(this.itemRarity, this.buildList(itemData.properties.rarity))"]] },
  { bench: "filter-reihenfolge", ziel: ["die Gitterliste geht im neuen Fenster durch die zweite Stelle"],
    ersetze: [[FENSTER, "gridList:       orderList(context.gridList),", "gridList:       context.gridList,"]] },

  // TC-295 bildform-adresse. Die Wiki-Klassen: beide Richtungen des
  // Schalters, Vorpruefung zurueck auf image64, base64-Rueckfall weg,
  // Adressvorrang weg, zweiter Versuch weg, Draufsicht mit continue.
  { bench: "bildform-adresse", ziel: ["A2 die Vorgabe ist AUS"],
    ersetze: [[CLOUD, "const BILDFORM_ADRESSE_AN = false", "const BILDFORM_ADRESSE_AN = true"]] },
  { bench: "bildform-adresse", ziel: ["A3 der Anhang steht an EINER Stelle"],
    ersetze: [[CLOUD, 'return BILDFORM_ADRESSE_AN ? "&bildform=adresse" : ""', 'return "&bildform=adresse"']] },
  { bench: "bildform-adresse", ziel: ["C2 keine Stelle ausser dem Helfer fragt nach image64", "C5 drei Vorpruefungen "],
    ersetze: [[CLOUD, "if (!_beneosBildDa(part)) continue", "if (!part.image64) continue"]] },
  // Der base64-Rueckfall faellt weg. Den Adresszweig immer zu nehmen
  // (`if (true)`) bringt den Bench zum Absturz statt zu einer roten Zeile
  // (bench.mjs:388), gemeldet unter stre-T-015.
  { bench: "bildform-adresse", ziel: ["E3 die alte Form geht weiter"],
    ersetze: [[CLOUD, "return alsDatei(await antwort.blob())", "return null"]] },
  { bench: "bildform-adresse", ziel: ["E2 die Adresse hat Vorrang"],
    ersetze: [[CLOUD, 'if (typeof eintrag.url === "string" && eintrag.url !== "") {',
      'if (typeof eintrag.url === "string" && eintrag.url !== "" && !eintrag.image64) {']] },
  // Der zweite Versuch, je Weiche einzeln. Die Schleife selbst auf einen
  // Versuch zu kuerzen bringt den Bench zum Absturz statt zu einer roten
  // Zeile (bench.mjs:388), gemeldet unter stre-T-015.
  { bench: "bildform-adresse", ziel: ["E7 ein 503 wird wiederholt"],
    ersetze: [[CLOUD, "if (versuch === 2) {", "if (true) {", 2, 1]] },
  { bench: "bildform-adresse", ziel: ["E8 ein geworfener Netzfehler wird wiederholt"],
    ersetze: [[CLOUD, "if (versuch === 2) {", "if (true) {", 2, 2]] },
  { bench: "bildform-adresse", ziel: ["E4b und sie wird zweimal versucht"],
    ersetze: [[CLOUD, "if (versuch === 2) return null", "if (true) return null"]] },
  { bench: "bildform-adresse", ziel: ["F2 zwischen Abruf und Prototypfeld steht kein continue"],
    ersetze: [[CLOUD, "const topFile = await _beneosBildDatei(topData, `token ${tokenKey} variant ${i + 1} top`);",
      "const topFile = await _beneosBildDatei(topData, `token ${tokenKey} variant ${i + 1} top`);\n          if (!topFile) continue"]] },
  { bench: "bildform-adresse", ziel: ["E5 ein 403 wird nicht wiederholt", "E6 ein 404 wird nicht wiederholt"],
    ersetze: [[CLOUD, "if (antwort.status === 403 || antwort.status === 404) {", "if (false) {"]] },
  { bench: "bildform-adresse", ziel: ["E4 eine zu kurze Datei wird abgewiesen", "E4c die Meldung nennt beide Zahlen"],
    ersetze: [[CLOUD, "if (erwartet > 0 && blob.size !== erwartet) {", "if (false) {"]] },
  { bench: "bildform-adresse", ziel: ["E9 ein leerer Blob wird nicht zur Datei"],
    ersetze: [[CLOUD, "if (!blob || blob.size === 0) return null", "if (!blob) return null"]] },
  { bench: "bildform-adresse", ziel: ["B1 alle drei Installationsanfragen tragen den Anhang"],
    ersetze: [[CLOUD, "&itemKey=${encodeURIComponent(itemKey)}` + _beneosBildformAnhang()", "&itemKey=${encodeURIComponent(itemKey)}`"]] },

  // TC-305 paket-grenze, alle Wiki-Sabotagen: jede der sieben Sperrzeilen
  // einzeln entfernt, sieben zu weite Sperren dazu, `* export-ignore`.
  ohneSperre("*.test.mjs export-ignore", ["*.test.mjs, die Pruefsaetze: null im Archiv", "*.test.mjs export-ignore"]),
  ohneSperre("tools/ export-ignore", ["tools/, die Messwerkzeuge und Erzeuger: null im Archiv", "tools/ export-ignore"]),
  ohneSperre("dev/ export-ignore", ["dev/, das Probiermaterial: null im Archiv", "dev/ export-ignore"]),
  ohneSperre("eslint.config.mjs export-ignore", ["eslint.config.mjs, braucht node_modules: null im Archiv", "eslint.config.mjs export-ignore"]),
  ohneSperre("*.code-workspace export-ignore", ["*.code-workspace, Editorzustand: null im Archiv", "*.code-workspace export-ignore"]),
  ohneSperre(".gitattributes export-ignore", [".gitattributes und .gitignore, Bauvorgaben: null im Archiv", ".gitattributes export-ignore"]),
  ohneSperre(".gitignore export-ignore", [".gitattributes und .gitignore, Bauvorgaben: null im Archiv", ".gitignore export-ignore"]),
  weiteSperre("docs/ export-ignore", ["docs/ traegt mindestens "]),
  weiteSperre("lang/ export-ignore", ["lang/ traegt mindestens ", "lang/en.json liegt im Archiv"]),
  weiteSperre("ui/ export-ignore", ["ui/ traegt mindestens "]),
  weiteSperre("scripts/ export-ignore", ["scripts/stream/stream-fetch.mjs liegt im Archiv"]),
  weiteSperre("icons/ export-ignore", ["icons/ traegt mindestens "]),
  weiteSperre("fonts/ export-ignore", ["fonts/ traegt mindestens "]),
  weiteSperre("assets/ export-ignore", ["assets/ traegt mindestens "]),
  // `* export-ignore` macht die Pflichtproben rot, nicht aber "keine der N
  // Sperrzeilen": deren Muster `^(\*|...)\b` verlangt hinter dem Stern eine
  // Wortgrenze, und vor einem Leerzeichen gibt es keine. Gemeldet unter
  // stre-T-015.
  { bench: "paket-grenze", ziel: ["module.json liegt im Archiv", "readme.md liegt im Archiv"],
    ersetze: [[ATTRIBUTE, "\ndev/ export-ignore\n", "\ndev/ export-ignore\n* export-ignore\n"]] },

  // TC-312 v15-globale. V1 ist die Wiki-Sabotage (b): eine echte neue Stelle
  // als neue Datei. V2 eine bestehende Stelle zurueck auf die Globale.
  { bench: "v15-globale", ziel: ["ROT: 25 Stellen", "2  Ray  (bis Foundry 15)"],
    ersetze: [["scripts/sabotage-ray.mjs", null, "export const r = new Ray(a, b)\n"]] },
  { bench: "v15-globale", ziel: ["ROT: 25 Stellen"],
    ersetze: [[SHEET, "await foundry.applications.handlebars.renderTemplate(TEMPLATE_PATH, ctx);", "await renderTemplate(TEMPLATE_PATH, ctx);"]] },

  // TC-314 doppelnamen, je Regel des Benches eine Stelle. D3 ist die Klasse
  // des Kundenfehlers vom 09.11.2026: ein zweites `complete()` in einer Tour.
  { bench: "doppelnamen", ziel: ["Doppelnamen: 1, erlaubt 0"],
    ersetze: [["scripts/sabotage-doppelname.mjs", null, "export class SabotageDoppelname {\n  eins() { return 1 }\n  eins() { return 2 }\n}\n"]] },
  { bench: "doppelnamen", ziel: ["Doppelnamen: 1, erlaubt 0"],
    ersetze: [["scripts/sabotage-doppelschluessel.mjs", null, "export const o = { eins: 1, eins: 2 }\n"]] },
  { bench: "doppelnamen", ziel: ["Doppelnamen: 1, erlaubt 0"],
    ersetze: [[TOUREN, "  async complete() {", "  async complete() {}\n  async complete() {", 3, 1]] },
]

/*
 * AUFRUFPROBEN: kein Modulcode geaendert, nur ein Argument. v15-globale mit
 * `--foundry` auf einen leeren Ordner muss "nicht messbar" sagen (Wiki-
 * Sabotage c zu TC-312). `<LEER>` wird ein frischer leerer Ordner.
 */
export const AUFRUFPROBEN = [
  { bench: "v15-globale", args: ["--foundry", "<LEER>"], rc: 2 },
]

// ------------------------------------------------------------- Bewertung

/** Wie viele Zeilen beginnen mit dem Ziel. */
export function treffer(zeilen, ziel) {
  let n = 0
  for (const z of zeilen) if (z.startsWith(ziel)) n += 1
  return n
}

/** Alle Ausgabezeilen eines Laufs, ohne Einrueckung. */
export function zeilenVon(r) {
  return [...(r.ausgabe ?? []), ...(r.stderr ?? [])].map((z) => z.trim())
}

/**
 * Prueft den Grundlauf eines Benches. Liefert `null`, wenn er taugt, sonst
 * den Grund, warum der Bench nicht pruefbar ist.
 */
export function grundlaufTaugt(bench, r) {
  const b = BENCHES[bench]
  if (r.getoetet) return `Grundlauf getoetet: ${erklaere(r)}`
  if (r.rc !== 0) return `Grundlauf nicht gruen: ${erklaere(r)}`
  if (b.art === "zeilen") {
    if (r.gruen.size === 0) return "Grundlauf ohne eine gruene Probe"
    if (r.doppelt.size > 0) return `doppelte Probennamen: ${[...r.doppelt].join(" | ")}`
    return null
  }
  const stand = (r.ausgabe ?? []).map((z) => z.trim().match(b.grenze)).filter(Boolean)
  if (stand.length !== 1) return `Grenzzeile ${stand.length}x statt 1x`
  const [, ist, erlaubt] = stand[0]
  if (Number(ist) !== Number(erlaubt)) return `Grundlauf ${ist}, erlaubt ${erlaubt}: nicht genau auf der Grenze`
  return null
}

/** Ziele, die schon am Grundlauf nicht taugen, mit Grund. */
export function zieleOhneProbe(bench, grund, ziele) {
  const b = BENCHES[bench]
  const aus = []
  for (const z of ziele) {
    if (b.art === "zeilen") {
      const n = treffer([...grund.gruen], z)
      if (n !== 1) aus.push(`${z} (${n} Proben statt 1)`)
    } else if (treffer(zeilenVon(grund), z) > 0) {
      aus.push(`${z} (steht schon im Grundlauf)`)
    }
  }
  return aus
}

/**
 * Bewertet einen Sabotagelauf. `art` ist "bewacht", "befund" oder
 * "nichtpruefbar", `text` die Begruendung.
 */
export function bewerte(bench, r, ziele) {
  const b = BENCHES[bench]
  if (r.getoetet) return { art: "nichtpruefbar", text: erklaere(r) }
  let rote
  if (b.art === "zeilen") {
    const e = einordnen(r)
    if (e === "sauber") return { art: "befund", text: "rc 0, Ziel nicht rot: bleibt gruen" }
    if (r.rc === 0) return { art: "befund", text: "rc 0 trotz roter Zeile: der Bench bleibt fuer den Aufrufer gruen" }
    if (e === "absturz") return { art: "befund", text: `ohne rote Probe abgebrochen, ${erklaere(r)}` }
    rote = [...r.rot]
  } else {
    if (r.rc === 2) return { art: "nichtpruefbar", text: `nicht messbar, ${erklaere(r)}` }
    if (r.rc === 0) return { art: "befund", text: "rc 0, Ziel nicht rot: bleibt gruen" }
    if (!(r.stderr ?? []).some((z) => z.trim().startsWith("ROT:"))) {
      return { art: "befund", text: `ohne ROT-Zeile abgebrochen, ${erklaere(r)}` }
    }
    rote = zeilenVon(r)
  }
  const verfehlt = ziele.filter((z) => treffer(rote, z) === 0)
  if (verfehlt.length > 0) return { art: "befund", text: `rc ${r.rc}, Ziel nicht rot: ${verfehlt.join(" | ")}`, rote }
  return { art: "bewacht", text: "", rote }
}

// ------------------------------------------------------------- Lauf

const rohLog = console.log
const log = (...teile) => rohLog(...teile.map((t) => (typeof t === "string" ? maskiere(t) : t)))

const kinder = new Set()
const kopien = []

function fahre(verzeichnis, bench, extra = {}) {
  const b = BENCHES[bench]
  return fahreKind(verzeichnis, BENCHDATEI(bench), {
    zeitgrenze: ZEITGRENZE_MS, kinder,
    ...(b.rot ? { rotPraefixe: b.rot } : {}),
    ...(b.ok ? { okPraefixe: b.ok } : {}),
    ...extra,
  })
}

function neueKopie(praefix) {
  const d = mkdtempSync(join(tmpdir(), praefix))
  kopien.push(d)
  return d
}

// Wie im Stream-Laeufer: die Ordner, die die Benches lesen.
function kopiereTeile(ziel) {
  for (const teil of ["scripts", "lang", "ui", "tools", "templates"]) {
    cpSync(join(WURZEL, teil), join(ziel, teil), { recursive: true })
  }
  for (const datei of ["module.json", "package.json"]) {
    if (existsSync(join(WURZEL, datei))) cpSync(join(WURZEL, datei), join(ziel, datei))
  }
}

/*
 * GIT IN DER KOPIE GEHOERT NUR DER KOPIE. Faehrt der Laeufer aus einem Haken,
 * zeigen GIT_DIR und GIT_INDEX_FILE ins Original; `write-tree` schriebe dann
 * dorthin. Die Variablen fallen fuer den ganzen Lauf weg, und
 * GIT_CEILING_DIRECTORIES haelt die Suche unterhalb des Temp-Verzeichnisses.
 */
function gitUmgebung() {
  for (const k of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_PREFIX"]) {
    delete process.env[k]
  }
  process.env.GIT_CEILING_DIRECTORIES = tmpdir()
}
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
const normal = (p) => realpathSync(p).replace(/\\/g, "/").toLowerCase()

/** Alle verfolgten Dateien im Stand des Arbeitsbaums, mit eigenem Git. */
function kopiereBaum(ziel) {
  const pfade = git(WURZEL, "ls-files", "-z").split("\0").filter(Boolean)
  for (const p of pfade) {
    const von = join(WURZEL, p)
    if (!existsSync(von)) continue
    mkdirSync(dirname(join(ziel, p)), { recursive: true })
    cpSync(von, join(ziel, p))
  }
  git(ziel, "init", "-q")
  // Vor dem ersten Schreiben: Git muss genau die Kopie als Wurzel nennen.
  const oben = git(ziel, "rev-parse", "--show-toplevel").trim()
  if (normal(oben) !== normal(ziel)) throw new Error(`Git nennt ${oben} statt der Kopie`)
  // -f: eine verfolgte Datei, die .gitignore traefe, gehoert trotzdem dazu.
  git(ziel, "add", "-A", "-f")
  return pfade.length
}

function raeumeAb() {
  for (const d of kopien) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch (e) {
      if (existsSync(d)) log(`REST nicht abgeraeumt: ${d} (${e && e.code})`)
    }
  }
}

async function abbrechen(rc) {
  const enden = [...kinder].map((k) => new Promise((fertig) => { k.once("exit", fertig); k.kill() }))
  await Promise.race([Promise.all(enden), new Promise((r) => setTimeout(r, 3000))])
  raeumeAb()
  process.exit(rc)
}

/**
 * Schreibt die Ersetzung in die Kopie, faehrt, und stellt zurueck. Wirft
 * dabei etwas, wird der Eintrag nicht pruefbar und der Lauf geht weiter: eine
 * Ablehnung in `Promise.all` liesse die Geschwister weiterlaufen, waehrend
 * `finally` ihre Kopien abraeumt (EBUSY, Kalt-Review stre-T-015).
 */
async function mitSabotage(kopie, bench, liste) {
  try {
    const lies = (datei) => readFileSync(join(WURZEL, datei), "utf8")
    const e = ersetze(lies, liste, (datei) => existsSync(join(WURZEL, datei)))
    if (e.fehler) return { fehler: e.fehler }
    const baum = BENCHES[bench].kopie === "baum"
    const dateien = [...e.neu.keys()]
    try {
      for (const [datei, text] of e.neu) writeFileSync(join(kopie, datei), text)
      if (baum) git(kopie, "add", "-A", "-f", "--", ...dateien)
      return { r: await fahre(kopie, bench) }
    } finally {
      for (const datei of dateien) {
        if (existsSync(join(WURZEL, datei))) writeFileSync(join(kopie, datei), lies(datei))
        else rmSync(join(kopie, datei), { force: true })
      }
      if (baum) git(kopie, "add", "-A", "-f", "--", ...dateien)
    }
  } catch (e) {
    return { fehler: `Werkzeugfehler: ${String(e?.message || e).split("\n")[0]}` }
  }
}

async function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i >= 0 ? process.argv[i + 1] : null
  }
  const zeig = process.argv.includes("--zeig")
  const selbstprobe = process.argv.includes("--selbstprobe")
  const nurBench = arg("--bench")
  if (process.argv.includes("--bench") && !(nurBench in BENCHES)) {
    log(`unbekannter Bench: ${nurBench}`)
    return 2
  }

  /*
   * --selbstprobe: ein Eintrag, der nichts aendert (Ersatz gleich Anker),
   * muss als Befund enden. Sonst zaehlte der Laeufer eine wirkungslose
   * Sabotage als bewacht.
   */
  const auftraege = selbstprobe
    ? [{ bench: "waisen-adressform", ziel: ["und sie ist als Funktion mit genau diesem Namen erklaert"],
      ersetze: [[CLOUD, "function _beneosUsingTheForge() {", "function _beneosUsingTheForge() {"]] }]
    : SABOTAGEN
  const benches = Object.keys(BENCHES)
    .filter((b) => !nurBench || b === nurBench)
    .filter((b) => auftraege.some((s) => s.bench === b))
  const nummeriert = auftraege.map((s, i) => ({ ...s, nr: i + 1 })).filter((s) => benches.includes(s.bench))
  // Ein Lauf ueber nichts ist kein bestandener Lauf.
  if (nummeriert.length === 0) {
    log("NICHT PRUEFBAR: keine Sabotage fuer diese Auswahl")
    return 2
  }

  gitUmgebung()
  let befund = 0
  let nichtPruefbar = 0
  const t0 = Date.now()
  process.once("SIGINT", () => { abbrechen(130) })
  process.once("SIGTERM", () => { abbrechen(143) })

  try {
    // 1. Die Kopien. Die Ordnerkopie gilt fuer alle Benches ausser paket-grenze.
    const teile = []
    const brauchtTeile = benches.some((b) => BENCHES[b].kopie === "teile")
    if (brauchtTeile) {
      for (let i = 0; i < 4; i += 1) {
        const d = neueKopie("bench-sabotage-")
        kopiereTeile(d)
        teile.push(d)
      }
    }
    let baum = null
    if (benches.includes("paket-grenze")) {
      baum = neueKopie("bench-sabotage-baum-")
      try {
        const n = kopiereBaum(baum)
        log(`paket-grenze: eigener Baum mit ${n} verfolgten Dateien`)
      } catch (e) {
        nichtPruefbar += 1
        log(`NICHT PRUEFBAR paket-grenze: Baum nicht gebaut, ${String(e.message || e).split("\n")[0]}`)
        baum = null
      }
    }
    const kopieFuer = (bench) => (BENCHES[bench].kopie === "baum" ? baum : teile[0])

    // 2. Die Grundlaeufe. Ein Bench, dessen Grundlauf nicht taugt, faellt aus.
    const grund = {}
    for (const bench of benches) {
      const kopie = kopieFuer(bench)
      if (!kopie) continue
      const r = await fahre(kopie, bench)
      const warum = grundlaufTaugt(bench, r)
      if (warum) {
        nichtPruefbar += 1
        log(`NICHT PRUEFBAR ${bench}: ${warum}`)
        continue
      }
      grund[bench] = r
    }

    // 3. Die Sabotagen. Die Ordnerkopien teilen sich die Eintraege, der Baum
    // faehrt seine der Reihe nach.
    const ergebnisse = []
    const offen = nummeriert.filter((s) => grund[s.bench])
    const warteschlange = (liste, kopie) => (async () => {
      for (const s of liste) ergebnisse.push({ s, ...(await mitSabotage(kopie, s.bench, s.ersetze)) })
    })()
    const teilListe = offen.filter((s) => BENCHES[s.bench].kopie === "teile")
    const baumListe = offen.filter((s) => BENCHES[s.bench].kopie === "baum")
    let naechster = 0
    const arbeiter = async (kopie) => {
      while (naechster < teilListe.length) {
        const s = teilListe[naechster]
        naechster += 1
        ergebnisse.push({ s, ...(await mitSabotage(kopie, s.bench, s.ersetze)) })
      }
    }
    await Promise.all([...teile.map((k) => arbeiter(k)), ...(baum ? [warteschlange(baumListe, baum)] : [])])

    // 4. Aufrufproben.
    const aufrufe = selbstprobe ? [] : AUFRUFPROBEN.filter((a) => grund[a.bench])
    for (const a of aufrufe) {
      const leer = neueKopie("bench-sabotage-leer-")
      const args = a.args.map((x) => (x === "<LEER>" ? leer : x))
      const r = await fahre(kopieFuer(a.bench), a.bench, { args })
      if (r.getoetet) {
        nichtPruefbar += 1
        log(`  NICHT PRUEFBAR Aufruf ${a.bench} ${a.args.join(" ")}: ${erklaere(r)}`)
      } else if (r.rc !== a.rc) {
        befund += 1
        log(`  BEFUND Aufruf ${a.bench} ${a.args.join(" ")}: rc ${r.rc} statt ${a.rc}`)
      } else if (zeig) {
        log(`  ok Aufruf ${a.bench} ${a.args.join(" ")}: rc ${r.rc}`)
      }
    }

    // 5. Auswertung je Eintrag, in der Reihenfolge der Liste.
    ergebnisse.sort((x, y) => x.s.nr - y.s.nr)
    const belegt = {}
    for (const { s, r, fehler } of ergebnisse) {
      const kopf = `B${s.nr} ${s.bench}`
      belegt[s.bench] ??= 0
      if (fehler) {
        nichtPruefbar += 1
        log(`  NICHT PRUEFBAR ${kopf}: ${fehler}`)
        continue
      }
      const fremd = zieleOhneProbe(s.bench, grund[s.bench], s.ziel)
      if (fremd.length > 0) {
        befund += 1
        log(`  BEFUND ${kopf}: Ziel ist keine Probe des Grundlaufs: ${fremd.join(" | ")}`)
      }
      const urteil = bewerte(s.bench, r, s.ziel)
      if (urteil.art === "nichtpruefbar") {
        nichtPruefbar += 1
        log(`  NICHT PRUEFBAR ${kopf}: ${urteil.text}`)
      } else if (urteil.art === "befund") {
        befund += 1
        log(`  BEFUND ${kopf}: ${urteil.text}`)
      } else if (fremd.length === 0) {
        belegt[s.bench] += 1
      }
      if (zeig && urteil.rote) log(`  ${kopf} rot: ${urteil.rote.slice(0, 8).join(" | ")}`)
    }

    log("")
    for (const bench of benches) {
      if (!grund[bench]) continue
      const zahl = nummeriert.filter((s) => s.bench === bench).length
      const aufruf = aufrufe.filter((a) => a.bench === bench).length
      const proben = BENCHES[bench].art === "zeilen" ? `${grund[bench].gruen.size} Proben` : "Ausgang"
      log(`${bench}: ${proben}, ${zahl} Sabotagen, ${belegt[bench] ?? 0} per Sabotage rot belegt`
        + (aufruf ? `, ${aufruf} Aufrufprobe(n)` : ""))
    }
  } finally {
    raeumeAb()
  }
  log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s, Befunde ${befund}, nicht pruefbar ${nichtPruefbar}`)
  return nichtPruefbar > 0 ? 2 : (befund > 0 ? 1 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main().catch((e) => {
    log(`NICHT PRUEFBAR: Werkzeugfehler, ${String(e?.message || e).split("\n")[0]}`)
    return 2
  }))
}
