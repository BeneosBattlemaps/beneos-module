#!/usr/bin/env node
// Bench: kein Name steht zweimal, wo der spaetere den frueheren still frisst
//
// WARUM DIESER STAND EXISTIERT. Am 09.11.2026 stand in `BeneosSetupTour` die
// Methode `async complete()` ZWEIMAL, in Zeile 1347 und in Zeile 1580.
// JavaScript nimmt den spaeteren Eintrag, ohne ein Wort zu sagen. Die Folge
// war verkehrt herum: beim ABBRECHEN der Tour ueber `exit()` lief die
// Aufraeumung, beim normalen BEENDEN nicht, und damit blieb der Ersatz von
// `game.tooltip.deactivate` nach jeder zu Ende gespielten Tour stehen.
//
// WARUM ES NIEMAND GESEHEN HAT, und das ist der eigentliche Befund. Die Regel
// `no-dupe-class-members` ist in `eslint.config.mjs` seit `OP-PRJ-195` auf
// `error` gestellt, also HAT der Bestand das Werkzeug dafuer. Aber
// `lint-diff.mjs` liest bewusst nur die Dateien des eigenen Diffs, und
// `beneos_tours.js` war monatelang in keinem. Der Fehler fiel erst, als die
// Datei aus einem voellig anderen Grund in einen Diff geriet.
//
// DARAUS FOLGT DIE BAUART DIESES STANDES: er liest den GANZEN Ordner
// `scripts/` und dafuer nur drei Regeln. Das ist die Gegenrichtung zu
// `lint-diff.mjs`, und beide braucht es. Ein Lauf mit der grossen Fassung
// ueber den Bestand meldet 5194 Treffer und wird abgeschaltet; dieser Lauf
// meldet heute null und faellt nicht auf, bis er etwas findet.
//
// ESLINT KOMMT UEBER `npx` MIT FESTER FASSUNG, derselbe Weg und dieselbe
// Fassung wie in `lint-diff.mjs`. Der Ordner `node_modules` darf hier nicht
// liegen, weil dieser Bestand aus einem laufenden Foundry-Datenverzeichnis
// ausgeliefert wird.
//
// OHNE NETZ UND OHNE ZWISCHENSPEICHER ENDET DIESER STAND MIT 2 und sagt es.
// Eine Pruefung, die nicht laufen konnte, darf nicht wie eine bestandene
// aussehen. Der Vorhaken nimmt 2 als "nicht gemessen" und blockiert nicht.
//
// Lauf:
//   node tools/doppelnamen-bench/bench.mjs
//   node tools/doppelnamen-bench/bench.mjs --verbose
//   node tools/doppelnamen-bench/bench.mjs --sabotage   # muss rot werden
//
// Rueckgabe: 0 kein Doppelname, 1 mindestens einer, 2 nicht messbar.

import { spawnSync } from "node:child_process"
import { writeFileSync, rmSync, existsSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = resolve(HIER, "..", "..")
const CONFIG = join(HIER, "eslint.doppelnamen.mjs")
const ORDNER = ["scripts"]
const ESLINT = "eslint@10.13.0"
const ZEILENENDE = String.fromCharCode(10)

const argv = process.argv.slice(2)
const VERBOSE = argv.includes("--verbose")
const SABOTAGE = argv.includes("--sabotage")

const WIN = process.platform === "win32"
const npx = WIN ? "npx.cmd" : "npx"

// --------------------------------------------------------------- Werkzeug
//
// `npx.cmd` laeuft auf Windows nur ueber die Eingabeaufforderung, sonst
// endet `spawnSync` mit EINVAL. Mit `shell: true` zerlegt aber die Schale
// die Argumente neu, und der Pfad dieses Bestandes traegt ein Leerzeichen
// ("Foundry VTT"). Jedes Argument mit Leerzeichen wird darum selbst in
// Anfuehrungszeichen gelegt. Ohne das sucht eslint eine Fassung namens
// "D:/PNP_Game/Foundry" und meldet einen Fehler, der wie ein Befund
// aussieht.
function schalenfest(a) {
  return WIN && /[\s]/.test(a) && !a.startsWith(String.fromCharCode(34))
    ? String.fromCharCode(34) + a + String.fromCharCode(34)
    : a
}

function lauf(ziele) {
  const args = [
    "--yes", ESLINT,
    "--no-config-lookup",
    "--config", CONFIG,
    "--no-warn-ignored",
    "--format", "json",
    ...ziele,
  ].map(schalenfest)
  const r = spawnSync(npx, args, {
    cwd: WURZEL, encoding: "utf8", shell: WIN,
    maxBuffer: 64 * 1024 * 1024,
  })

  if (r.error) return { nichtMessbar: `npx liess sich nicht starten: ${r.error.message}` }

  // ESLint gibt 1 zurueck, wenn es Fehler GEFUNDEN hat, und 2, wenn es selbst
  // nicht laufen konnte. Nur das zweite ist "nicht messbar".
  if (r.status === 2 || !String(r.stdout || "").trim().startsWith("[")) {
    const text = String(r.stderr || r.stdout || "").trim().split("\n").slice(0, 4).join(" ")
    return { nichtMessbar: text || `eslint endete mit ${r.status} ohne Ausgabe` }
  }

  let roh
  try { roh = JSON.parse(r.stdout) } catch (err) {
    return { nichtMessbar: `Ausgabe von eslint nicht lesbar: ${err.message}` }
  }

  const befunde = []
  for (const datei of roh) {
    for (const m of datei.messages || []) {
      if (m.severity !== 2) continue
      befunde.push({
        datei: String(datei.filePath || "").replace(WURZEL, "").replace(/^[\\/]/, ""),
        zeile: m.line,
        regel: m.ruleId || "?",
        text: m.message,
      })
    }
  }
  return { befunde, dateien: roh.length }
}

// ------------------------------------------------------- Teil 1: Selbstproben
// Der Leser ist hier ESLint und nicht eigener Code, geprueft wird also, ob der
// AUFRUF stimmt: richtige Fassung, richtige Regeln, richtige Sprachfassung.
// Ein Stand, der still auf null Regeln laeuft, meldet ewig gruen.
// `no-dupe-args` HAT HIER KEINE PROBE, und das ist gemessen und nicht
// vergessen. Ein doppelter Parametername ist im strengen Modus ein
// PARSERFEHLER und kein Lintbefund, und ein Modul ist immer streng. ESLint
// meldete auf `function f(a, b, a)` genau eine Zeile: "Parsing error:
// Argument name clash". Die Regel bleibt trotzdem in der Fassung, denn eine
// Datei, die nicht als Modul gelesen wird, kaeme ohne sie durch; sie ist nur
// nicht probierbar. Steht als "Nicht pruefbar" im README.
const PROBEN = [
  ["no-dupe-class-members", true,
   "class A { async b() { return 1 } async b() { return 2 } }\n"],
  ["no-dupe-keys", true,
   "export const o = { a: 1, b: 2, a: 3 }\n"],
  ["saubere Klasse bleibt still", false,
   "class A { async b() { return 1 } async c() { return 2 } }\n"],
  ["saubere Zuordnung bleibt still", false,
   "export const o = { a: 1, b: 2, c: 3 }\n"],
  // Eine Kurzschreibweise neben der langen Form ist derselbe Schluessel. Ohne
  // diese Probe koennte eine zu alte Sprachfassung sie uebersehen.
  ["Kurzschreibweise zaehlt mit", true,
   "const a = 1\nexport const o = { a, a: 2 }\n"],
  // Ein berechneter Schluessel ist KEIN Doppelname, den ESLint melden darf.
  // Diese Probe haelt die Gegenrichtung fest.
  ["berechneter Schluessel bleibt still", false,
   "const k = 'a'\nexport const o = { a: 1, [k]: 2 }\n"],
  // Eine Klassenmethode und ein gleichnamiges Feld sind ebenfalls derselbe
  // Name. Das ist die Form, in der der Fehler im Bestand am ehesten wieder
  // entsteht, denn sie sieht beim Lesen nicht nach Wiederholung aus.
  ["Feld neben gleichnamiger Methode", true,
   "class A { b = 1\n  b() { return 2 } }\n"],
]

// JE PROBE EINE EIGENE DATEI, und das ist die zweite Lehre aus einem eigenen
// Fehlschlag. Zuerst lagen alle Proben in einer Datei. Darin standen zwei
// Klassen namens `A` und zwei Bindungen namens `o`, also Wiederholungen im
// selben Gueltigkeitsbereich, und `function f(a, b, a)` erzeugte zusaetzlich
// einen Parserfehler. EIN Parserfehler blendet die ganze Datei: ESLint meldete
// genau eine Zeile und nichts von den anderen Proben. Der Stand sagte darauf
// "4 von 7" und sah wie ein kaputter Leser aus.
//
// EIN FEHLSCHLAG IN EINER PROBE DARF DIE ANDEREN NICHT BLENDEN. Mit je einer
// Datei kostet es trotzdem nur einen Lauf, denn ESLint nimmt mehrere Pfade auf
// einmal und berichtet je Datei.
//
// DIE DATEIEN LIEGEN IM BESTAND UND NICHT UNTER `os.tmpdir()`, und das war die
// erste Lehre: eine flache ESLint-Fassung deckt nur den Baum unter ihrem
// Wurzelordner ab, eine Datei daneben fiel still durch, und der Stand meldete
// "3 von 7". Eine Probe am falschen Ort ist von einer Regel, die nicht greift,
// nicht zu unterscheiden.
const PROBENNAME = (i) => join(HIER, `zzz_probe_${i}_tmp.mjs`)

function selbstproben() {
  const dateien = PROBEN.map((_, i) => PROBENNAME(i))
  try {
    PROBEN.forEach(([, , quelle], i) => writeFileSync(dateien[i], quelle, "utf8"))
    const r = lauf(dateien)
    if (r.nichtMessbar) return r
    let richtig = 0
    const fehl = []
    PROBEN.forEach(([name, erwartet], i) => {
      const meine = r.befunde.filter((b) => b.datei.endsWith(`zzz_probe_${i}_tmp.mjs`))
      // Ein Parserfehler traegt keine Regel. Er ist kein Befund dieser
      // Pruefung, sondern ein kaputter Proben-Quelltext, und er muss als
      // solcher auffallen statt als Treffer zu zaehlen.
      const kaputt = meine.find((b) => b.regel === "?")
      if (kaputt) {
        fehl.push(`${name}: Proben-Quelltext laesst sich nicht lesen, ${kaputt.text}`)
        return
      }
      if ((meine.length > 0) === erwartet) richtig += 1
      else fehl.push(`${name}: erwartet ${erwartet ? "Befund" : "still"}, `
        + `bekam ${meine.length} Befund(e)`)
    })
    return { richtig, von: PROBEN.length, fehl }
  } finally {
    for (const d of dateien) rmSync(d, { force: true })
  }
}

// ------------------------------------------------------------------ Hauptlauf
function main() {
  if (!existsSync(CONFIG)) {
    console.error(`NICHT MESSBAR: ${CONFIG} fehlt.`)
    return 2
  }

  const proben = selbstproben()
  if (proben.nichtMessbar) {
    console.error(`NICHT MESSBAR: ${proben.nichtMessbar}`)
    console.error("Erster Lauf braucht Netz, danach liegt die Fassung im npm-Zwischenspeicher.")
    return 2
  }
  console.log(`Selbstproben: ${proben.richtig} von ${proben.von} richtig`)
  if (proben.richtig !== proben.von) {
    for (const f of proben.fehl) console.error(`  ${f}`)
    console.error("\nROT: der Aufruf von eslint stimmt nicht, also sagt der Bestandslauf nichts.")
    return 1
  }

  const ziele = ORDNER.filter((o) => existsSync(join(WURZEL, o)))
  if (ziele.length === 0) {
    console.error(`NICHT MESSBAR: keiner der Ordner ${ORDNER.join(", ")} liegt unter ${WURZEL}.`)
    return 2
  }

  const r = lauf(ziele)
  if (r.nichtMessbar) {
    console.error(`NICHT MESSBAR: ${r.nichtMessbar}`)
    return 2
  }

  // --sabotage haengt einen erfundenen Befund an. Der Stand MUSS dann rot
  // werden, sonst traegt die Null nichts.
  const befunde = SABOTAGE
    ? [...r.befunde, { datei: "scripts/erfunden.js", zeile: 1, regel: "no-dupe-keys", text: "Sabotageprobe" }]
    : r.befunde

  console.log(`Dateien: ${r.dateien}`)
  console.log(`Doppelnamen: ${befunde.length}, erlaubt 0`)
  if (VERBOSE || befunde.length > 0) {
    for (const b of befunde) {
      console.log(`  ${b.datei}:${b.zeile}  ${b.regel}  ${b.text}`)
    }
  }

  if (befunde.length > 0) {
    console.error("\nROT: ein Name steht zweimal, und der spaetere Eintrag frisst den frueheren "
      + "still. Bei einer Klassenmethode laeuft der erste Koerper dann nie, bei einem "
      + "Zuordnungsschluessel gilt der letzte Wert. Zusammenfuehren, nicht umbenennen.")
    return 1
  }
  console.log("\nGRUEN: kein Doppelname im Bestand.")
  return 0
}

process.exit(main())
