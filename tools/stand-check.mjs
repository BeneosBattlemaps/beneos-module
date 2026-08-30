#!/usr/bin/env node
/**
 * Stimmen die Staende ueberein, die zusammengehoeren?
 *
 * WARUM ES DIESES WERKZEUG GIBT
 *
 * Am 30.08.2026 lag im V14-Pruefstand eine Datei zwei Tage hinter dem
 * Arbeitsstand, ohne dass es jemand merkte: der Ordner war eine Handkopie,
 * und beim Kopieren war eine Datei durchgerutscht. Die Fassungsnummer war
 * dieselbe. Gemessen wurde also gegen einen Stand, der nirgends stand.
 *
 * Dieselbe Klasse Fehler ist im Prueflauf schon zweimal aufgetreten (Forge,
 * 27. und 28.08.2026): dort meldete die Buehne 14.5.0-beta.3 wie der lokale
 * Stand, und der Code war trotzdem aelter. Der Satz aus dem Pruefkatalog gilt
 * seither: die Fassungsnummer verraet es nicht, nur ein Vergleich der Datei.
 *
 * WAS GEPRUEFT WIRD
 *
 * Fuenf Fragen, jede mit einer Zahl oder einem Pfad als Antwort:
 *
 *   1. Traegt das hoechste Tag dieselbe Fassung wie `main`?
 *   2. Passen `version` und die `download`-Adresse in `module.json` zusammen?
 *   3. Nennt der Changelog-Kopf die Fassung aus `module.json`?
 *   4. Liegt jeder Pruefstand auf dem Stand seines Zweigs?
 *   5. Traegt ein Pruefstand Aenderungen, die nirgends committet sind?
 *
 * AUFRUF
 *
 *   node tools/stand-check.mjs
 *   node tools/stand-check.mjs --json     maschinenlesbar
 *
 * Rueckgabe 0 wenn alles stimmt, 1 bei mindestens einem harten Befund.
 * Weiche Befunde (etwa ein Pruefstand, den es auf dieser Maschine nicht gibt)
 * aendern die Rueckgabe nicht.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Die Pruefstaende dieser Maschine.
 *
 * Bewusst hier und nicht in einer Konfigurationsdatei: sie gehoeren zur
 * Arbeitsumgebung und nicht zum Modul, und eine Datei, die niemand pflegt,
 * waere schlechter als eine Liste, die im Werkzeug steht und beim Lesen
 * auffaellt. Fehlt ein Pfad, ist das ein weicher Befund.
 *
 * `konserve: true` heisst: hier wird bewusst KEIN Stand gefuehrt.
 *
 * Betreiberauskunft vom 30.08.2026 zu `v14Data`: eine Konserveninstanz mit
 * irgendeinem alten Modulstand. Wer dort etwas messen will, kopiert das Modul
 * hinein und ueberschreibt, was liegt. Ein Rueckstand ist dort deshalb kein
 * Befund, sondern der vorgesehene Zustand. Ohne diese Unterscheidung meldete
 * der Pruefer bei jedem Lauf denselben Punkt, und ein Pruefer, der immer
 * dasselbe meldet, wird nach der dritten Woche ueberlesen.
 */
const STAENDE = [
  { name: "v13Data",   zweig: "main",        pfad: "D:/PNP_Game/Foundry VTT/FoundryVTT/v13Data/Data/modules/beneos-module" },
  { name: "v13Stream", zweig: "stream-beta", pfad: "D:/PNP_Game/Foundry VTT/FoundryVTT/v13Stream/Data/modules/beneos-module" },
  { name: "v14Stream", zweig: "stream-beta", pfad: "D:/PNP_Game/Foundry VTT/FoundryVTT/v14Stream/Data/modules/beneos-module" },
  { name: "v14Data",   konserve: true,       pfad: "D:/PNP_Game/Foundry VTT/FoundryVTT/v14Data/Data/modules/beneos-module" },
]

const hart = []
const weich = []
const zeilen = []

// `stderr: "ignore"`, weil dieses Werkzeug bewusst nach Dingen fragt, die es
// vielleicht nicht gibt: ein lokaler `main` etwa fehlt auf einer Maschine, die
// nur `origin/main` kennt. Git schreibt dann eine Zeile nach stderr, die mitten
// in der Ausgabe steht und wie ein Fehler des Pruefers aussieht. Das Ergebnis
// steht im Rueckgabewert, nicht in der Meldung.
function git(...args) {
  try {
    return execFileSync("git", ["-C", REPO, ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch (_) { return null }
}

function gitIn(pfad, ...args) {
  try {
    return execFileSync("git", ["-C", pfad, ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch (_) { return null }
}

/** Die Fassung aus einer module.json, egal ob aus dem Baum oder aus einem Zweig. */
function fassungAus(text) {
  if (!text) return null
  try { return String(JSON.parse(text).version || "") || null } catch (_) { return null }
}

function fassungVonZweig(zweig) {
  return fassungAus(git("show", `${zweig}:module.json`))
}

/**
 * Fassungen sortieren, ohne eine Bibliothek dafuer zu holen.
 *
 * Vorabfassungen wie `14.5.0-beta.4` zaehlen kleiner als ihre Endfassung, so
 * wie es die Regel semantischer Fassungsnummern vorsieht. Ohne diese Behandlung
 * stuende die Beta ueber dem Tag, und das Werkzeug meldete den Normalfall als
 * Befund.
 */
function fassungsSchluessel(v) {
  const [kern, vorab] = String(v).split("-")
  const teile = kern.split(".").map(n => Number(n) || 0)
  while (teile.length < 3) teile.push(0)
  return [...teile, vorab ? 0 : 1, vorab || ""]
}

function hoeher(a, b) {
  const A = fassungsSchluessel(a), B = fassungsSchluessel(b)
  for (let i = 0; i < 4; i++) { if (A[i] !== B[i]) return A[i] > B[i] ? a : b }
  return A[4] > B[4] ? a : b
}

// ---- 1. Das hoechste Tag gegen main ------------------------------------

const tags = (git("tag") || "").split("\n").map(s => s.trim())
  .filter(t => /^\d+\.\d+\.\d+$/.test(t))
const hoechstesTag = tags.length ? tags.reduce((a, b) => hoeher(a, b)) : null
const mainFassung = fassungVonZweig("origin/main") || fassungVonZweig("main")

zeilen.push(["hoechstes Tag", hoechstesTag || "(keines)"])
zeilen.push(["main traegt", mainFassung || "(unbekannt)"])

if (!mainFassung) {
  hart.push("Die Fassung von main ist nicht lesbar.")
} else if (!hoechstesTag) {
  weich.push("Es gibt kein Fassungs-Tag, also ist nichts ausgeliefert.")
} else if (hoechstesTag === mainFassung) {
  zeilen.push(["Tag und main", "gleich, ausgeliefert"])
} else if (hoeher(mainFassung, hoechstesTag) === mainFassung) {
  // Das ist der ERWARTETE Zwischenzustand nach einem Fassungssprung: main ist
  // vorbereitet, das Tag folgt beim Ausliefern. Kein Befund, aber eine Ansage.
  zeilen.push(["Tag und main", `main ist ${mainFassung}, ausgeliefert ist ${hoechstesTag}: Tag steht aus`])
} else {
  hart.push(`Das Tag ${hoechstesTag} ist hoeher als main (${mainFassung}). `
    + "Ausgeliefert ist damit ein Stand, den der Zweig nicht kennt.")
}

// ---- 2. version gegen die download-Adresse -----------------------------

const modulJson = git("show", "origin/main:module.json") || git("show", "main:module.json")
try {
  const m = JSON.parse(modulJson)
  const inAdresse = String(m.download || "").match(/tags\/([^/]+)\.zip/)?.[1] || null
  zeilen.push(["download zeigt auf", inAdresse || "(keine Tag-Adresse)"])
  if (inAdresse && inAdresse !== m.version) {
    hart.push(`In module.json steht Fassung ${m.version}, die Download-Adresse zeigt aber auf ${inAdresse}.`)
  }
} catch (_) { hart.push("module.json auf main ist nicht lesbar.") }

// ---- 3. Der Changelog-Kopf ---------------------------------------------

const changelog = git("show", "origin/main:changelog.md") || git("show", "main:changelog.md")
if (!changelog) {
  weich.push("Kein changelog.md auf main gefunden.")
} else {
  // Der Patchlog-Parser des Moduls akzeptiert im Kopf nur
  // `### <fassung> # <YYYY-MM-DD>` mit optionalem `| Label`. Ein Zusatz ohne
  // Pipe laesst den ganzen Block im Modul verschwinden, deshalb wird die Form
  // hier mitgeprueft und nicht nur die Zahl.
  const kopf = changelog.match(/^###\s+(\S+)\s+#\s+(\d{4}-\d{2}-\d{2})(\s*\|.*)?$/m)
  if (!kopf) {
    hart.push("Der oberste Changelog-Eintrag hat nicht die Form `### <fassung> # <YYYY-MM-DD>`. "
      + "Der Patchlog im Modul zeigt ihn dann gar nicht an.")
  } else {
    zeilen.push(["Changelog-Kopf", `${kopf[1]} vom ${kopf[2]}`])
    if (mainFassung && kopf[1] !== mainFassung) {
      hart.push(`Der Changelog nennt oben ${kopf[1]}, module.json traegt ${mainFassung}.`)
    }
  }
}

// ---- 4. und 5. Die Pruefstaende ----------------------------------------

for (const s of STAENDE) {
  if (!existsSync(s.pfad)) { weich.push(`Pruefstand ${s.name} liegt nicht unter ${s.pfad}.`); continue }

  const eigen = existsSync(join(s.pfad, "module.json"))
    ? fassungAus(readFileSync(join(s.pfad, "module.json"), "utf8")) : null

  // Eine Konserve wird nur berichtet, nicht beurteilt. Ihre Fassung steht
  // trotzdem da: wer dort misst, soll auf einen Blick sehen, wie alt der
  // Stand ist, den er gerade ueberschreiben muesste.
  if (s.konserve) {
    zeilen.push([`Konserve ${s.name}`, `${eigen || "?"} (wird nicht gefuehrt, vor einer Messung ueberschreiben)`])
    continue
  }

  const kopf = gitIn(s.pfad, "rev-parse", "HEAD")
  const soll = git("rev-parse", s.zweig) || git("rev-parse", `origin/${s.zweig}`)
  const schmutz = (gitIn(s.pfad, "status", "--porcelain") || "").split("\n").filter(Boolean).length

  if (!kopf) {
    // Eine Handkopie. Genau der Fall, der diesen Pruefer ausgeloest hat.
    hart.push(`Pruefstand ${s.name} ist kein Arbeitsbaum, sondern eine Kopie. `
      + "Was dort gemessen wird, laesst sich keinem Stand zuordnen.")
    zeilen.push([`Stand ${s.name}`, `${eigen || "?"} (Kopie, ohne Git)`])
    continue
  }

  const gleich = soll && kopf === soll
  const abstand = soll ? (git("rev-list", "--count", `${kopf}..${soll}`) || "?") : "?"
  zeilen.push([`Stand ${s.name}`, `${eigen || "?"} auf ${kopf.slice(0, 8)}`
    + (gleich ? `, aktuell zu ${s.zweig}` : `, ${abstand} Commits hinter ${s.zweig}`)
    + (schmutz ? `, ${schmutz} ungespeicherte Dateien` : "")])

  if (!gleich && abstand !== "0") {
    hart.push(`Pruefstand ${s.name} liegt ${abstand} Commits hinter ${s.zweig}. `
      + "Eine Messung dort misst einen aelteren Stand.")
  }
  if (schmutz) {
    weich.push(`Pruefstand ${s.name} traegt ${schmutz} Aenderungen, die nirgends committet sind.`)
  }
}

// ---- Ausgabe ------------------------------------------------------------

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ zeilen: Object.fromEntries(zeilen), hart, weich }, null, 2))
} else {
  const breite = Math.max(...zeilen.map(([k]) => k.length))
  console.log("\nStand der Fassungen\n")
  for (const [k, v] of zeilen) console.log(`  ${k.padEnd(breite)}   ${v}`)
  if (weich.length) { console.log("\nWeiche Befunde:"); for (const b of weich) console.log(`  - ${b}`) }
  if (hart.length)  { console.log("\nHarte Befunde:");  for (const b of hart)  console.log(`  - ${b}`) }
  console.log(`\nHarte Befunde: ${hart.length}   Weiche Befunde: ${weich.length}\n`)
}

process.exit(hart.length ? 1 : 0)
