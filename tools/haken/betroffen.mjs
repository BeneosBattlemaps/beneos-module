// Waehlt fuer den pre-commit-Haken die Pruefdateien aus, deren Gegenstand
// vorgemerkt ist.
//
// Aufruf: node tools/haken/betroffen.mjs <liste-vorgemerkt> <pruefdatei> ...
// Ausgabe: je betroffene Pruefdatei eine Zeile, Pfad relativ zur Wurzel.
//
// WARUM DER GEGENSTAND HIER BERECHNET WIRD UND NICHT IM HAKEN STEHT
//
// Gegenstand einer Pruefdatei ist alles, was sie laedt, auch ueber Umwege.
// Gemessen am 2026-11-21: die vier Installer-Pruefungen in scripts/cloud-v2
// ziehen je 24 Dateien, install-nachspiel.test.mjs zieht 89, darunter
// beneos_utility.js und beneos_search_engine.js. Eine Liste von Hand waere
// beim naechsten neuen Import falsch, und zwar still: die Pruefung liefe dann
// bei genau der Aenderung nicht, die sie bricht. Der Importgraph wird deshalb
// bei jedem Commit aus den Quellen gelesen.
//
// Erfasst werden relative Pfade in `import ... from`, `import "..."`,
// `import("...")` und `new URL("...", import.meta.url)`, also auch die
// gelesenen Sprach- und Manifestdateien. Ein Pfad, der zur Laufzeit
// zusammengesetzt wird, ist nicht lesbar; solche Gegenstaende nennt der Haken
// selbst (siehe scene-merge-token-bench dort).

import fs from "node:fs"
import path from "node:path"

const [listeDatei, ...pruefdateien] = process.argv.slice(2)
const wurzel = process.cwd()
const rel = (p) => path.relative(wurzel, p).split(path.sep).join("/")

const vorgemerkt = new Set(
  fs.readFileSync(listeDatei, "utf8").split(/\r?\n/).filter(Boolean),
)

const MUSTER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']|new URL\(\s*["'](\.{1,2}\/[^"']+)["']/g

function gegenstand(start) {
  const gesehen = new Set()
  const offen = [path.resolve(wurzel, start)]
  while (offen.length) {
    const datei = offen.pop()
    if (gesehen.has(datei)) continue
    gesehen.add(datei)
    // Ein Ordner (lang/) oder eine geloeschte Datei zaehlt als Gegenstand,
    // wird aber nicht weiter gelesen.
    if (!/\.(m?js|cjs)$/.test(datei) || !fs.existsSync(datei)) continue
    const quelle = fs.readFileSync(datei, "utf8")
    for (const m of quelle.matchAll(MUSTER)) {
      offen.push(path.resolve(path.dirname(datei), m[1] ?? m[2]))
    }
  }
  return [...gesehen].map(rel)
}

for (const pruef of pruefdateien) {
  const treffer = gegenstand(pruef).some((g) =>
    vorgemerkt.has(g) || [...vorgemerkt].some((v) => v.startsWith(g + "/")))
  if (treffer) console.log(pruef)
}
