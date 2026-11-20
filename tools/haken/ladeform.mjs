/**
 * IN WELCHER FORM LAEDT FOUNDRY EINE DATEI UNTER scripts/? (Nachtrag zu
 * stre-T-157, Kalt-Review W1)
 *
 * Der Vorhaken prueft die vorgemerkte Fassung mit `node --check`. Node liest
 * eine `.js` ohne import und export als CommonJS, Foundry laedt dieselbe
 * Datei aber als Modul, wenn sie unter `esmodules` steht oder von dort
 * importiert wird. Ein Fehler, den nur das Modulziel kennt (etwa ein
 * doppelter Parametername), kam so durch den Commit.
 *
 * Dieser Helfer gibt die Modulmenge aus, je Zeile ein Pfad: die `esmodules`
 * aus module.json und alles, was von dort ueber einen relativen Pfad
 * importiert wird (`import ... from`, `import "x"`, `import("x")`). Eine
 * Datei unter `scripts` in module.json laedt Foundry klassisch; sie kommt nie
 * in die Menge. Gelesen wird der INDEX, also das, was committet wird, in
 * einem einzigen `git cat-file --batch`.
 *
 * Austritt 0 mit der Menge, 2 wenn module.json im Index fehlt, nicht lesbar
 * ist oder keine Liste `esmodules` traegt. Der Haken sperrt dann.
 *
 * Lauf:  node tools/haken/ladeform.mjs
 */

import { execFileSync } from "node:child_process"
import { posix } from "node:path"

function nichtLesbar(grund) {
  console.error(`module.json der vorgemerkten Fassung nicht lesbar: ${grund}`)
  process.exit(2)
}

// Index lesen: Pfad -> Blob.
const blob = new Map()
for (const zeile of execFileSync("git", ["ls-files", "-s", "-z"], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\0")) {
  const m = /^\d+ ([0-9a-f]+) \d\t(.+)$/.exec(zeile)
  if (m) blob.set(m[2], m[1])
}
if (!blob.has("module.json")) nichtLesbar("nicht im Index")

const wanted = ["module.json", ...[...blob.keys()].filter((p) => p.startsWith("scripts/") && /\.m?js$/.test(p))]
const roh = execFileSync("git", ["cat-file", "--batch"], {
  input: wanted.map((p) => blob.get(p)).join("\n") + "\n", maxBuffer: 1 << 28,
})
const inhalt = new Map()
let pos = 0
for (const pfad of wanted) {
  const kopfEnde = roh.indexOf(10, pos)
  const groesse = Number(roh.toString("utf8", pos, kopfEnde).split(" ")[2])
  inhalt.set(pfad, roh.toString("utf8", kopfEnde + 1, kopfEnde + 1 + groesse))
  pos = kopfEnde + 1 + groesse + 1
}

let modul
try { modul = JSON.parse(inhalt.get("module.json")) } catch (e) { nichtLesbar(e.message) }
if (!Array.isArray(modul?.esmodules)) nichtLesbar("keine Liste esmodules")
const klassisch = new Set(Array.isArray(modul.scripts) ? modul.scripts : [])

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g
const menge = new Set()
const offen = modul.esmodules.filter((p) => typeof p === "string")
while (offen.length > 0) {
  const pfad = offen.pop()
  if (menge.has(pfad) || klassisch.has(pfad) || !inhalt.has(pfad)) continue
  menge.add(pfad)
  for (const m of inhalt.get(pfad).matchAll(IMPORT)) {
    offen.push(posix.normalize(posix.join(posix.dirname(pfad), m[1])))
  }
}
console.log([...menge].sort().join("\n"))
