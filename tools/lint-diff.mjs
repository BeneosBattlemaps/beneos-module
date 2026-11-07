/**
 * lint-diff.mjs
 *
 * Prueft NUR die Dateien des eigenen Diffs mit ESLint, nicht den Bestand.
 *
 *   node tools/lint-diff.mjs                 Arbeitsbaum und Index gegen HEAD
 *   node tools/lint-diff.mjs --gegen main    gegen einen anderen Stand
 *   node tools/lint-diff.mjs a.mjs b.js      genau diese Dateien
 *
 * Rueckgabe 0 heisst keine Fehler, 1 heisst mindestens einer.
 *
 * WARUM NUR DER DIFF. Ein Lauf ueber den Bestand meldet 5194 Treffer in 131
 * Dateien, gemessen am 07.11.2026, und fast alle sind Globale. Eine Pruefung,
 * die beim ersten Lauf einen Berg ausschuettet, wird abgeschaltet.
 * Betreiberentscheid 07.11.2026, `OP-PRJ-195`.
 *
 * WARUM OHNE `node_modules`. Dieser Ordner liegt in einem laufenden
 * Foundry-Datenverzeichnis und wird von dort ausgeliefert. ESLint kommt
 * deshalb ueber `npx` mit FESTER Fassung und liegt im npm-Zwischenspeicher,
 * ausserhalb des Repositories. Die Fassung ist hier festgenagelt und nicht
 * offen: ein `npx eslint` ohne Fassung holt jeden Tag etwas anderes, und eine
 * Pruefung, die sich unter der Hand aendert, ist keine.
 *
 * ERSTER LAUF BRAUCHT NETZ und dauert rund eine halbe Minute. Danach liegt die
 * Fassung im Zwischenspeicher und der Lauf ist schnell. Ohne Netz und ohne
 * Zwischenspeicher endet dieses Werkzeug mit Rueckgabe 2 und sagt es, denn
 * eine Pruefung, die nicht laufen konnte, darf nicht wie eine bestandene
 * aussehen.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

const ESLINT = "eslint@10.13.0"

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8" })
  if (r.status !== 0) {
    console.error(`git ${args.join(" ")} ging nicht: ${String(r.stderr || "").trim()}`)
    process.exit(2)
  }
  return String(r.stdout || "")
}

const wurzel = git("rev-parse", "--show-toplevel").trim()

// Argumente einsammeln. `--gegen <stand>` nimmt einen anderen Vergleichsstand,
// alles andere gilt als Dateiname.
const argv = process.argv.slice(2)
let gegen = "HEAD"
const handListe = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--gegen") { gegen = argv[++i] || "HEAD"; continue }
  handListe.push(argv[i])
}

/** Nur was ESLint hier lesen soll, und nur was wirklich noch liegt. */
function brauchbar(p) {
  if (!/\.(js|mjs)$/i.test(p)) return false
  // Muss zur `ignores`-Liste in `eslint.config.mjs` passen. Steht sie dort
  // allein, meldet ESLint fuer eine uebergebene ignorierte Datei eine Warnung
  // und die Pruefung wird unleserlich.
  if (/^(node_modules|docs|packs|dev)\//.test(p)) return false
  if (/^scripts\/lib\//.test(p)) return false
  return existsSync(path.join(wurzel, p))
}

let dateien
if (handListe.length) {
  dateien = handListe.map((p) => path.relative(wurzel, path.resolve(p)).split(path.sep).join("/"))
} else {
  // Beides: was committet werden soll und was noch nicht angemeldet ist. Eine
  // neue, unangemeldete Datei ist genau der Fall, in dem ein fehlender Name
  // am teuersten ist.
  const verfolgt = git("diff", "--name-only", "--diff-filter=d", gegen).split("\n")
  const neu = git("ls-files", "--others", "--exclude-standard").split("\n")
  dateien = [...new Set([...verfolgt, ...neu])]
}

dateien = dateien.map((s) => s.trim()).filter(Boolean).filter(brauchbar).sort()

if (!dateien.length) {
  console.log("Keine zu pruefende Datei im Diff. Nichts zu tun.")
  process.exit(0)
}

console.log(`ESLint ${ESLINT} ueber ${dateien.length} Datei(en):`)
for (const d of dateien) console.log(`  ${d}`)
console.log("")

const npx = process.platform === "win32" ? "npx.cmd" : "npx"
const lauf = spawnSync(npx, ["--yes", ESLINT, "--no-warn-ignored", ...dateien], {
  cwd: wurzel,
  encoding: "utf8",
  shell: process.platform === "win32",
})

if (lauf.error || lauf.status === null) {
  console.error(`ESLint konnte nicht starten: ${lauf.error?.message || "ohne Meldung"}`)
  console.error("Beim ersten Lauf braucht es Netz. Rueckgabe 2 heisst NICHT bestanden.")
  process.exit(2)
}

const aus = String(lauf.stdout || "")
const fehlerStrom = String(lauf.stderr || "")
if (aus.trim()) console.log(aus.trimEnd())
if (fehlerStrom.trim()) console.error(fehlerStrom.trimEnd())

// ESLint gibt 1 bei Befunden und 2, wenn es selbst nicht arbeiten konnte, etwa
// bei einer kaputten Einstellungsdatei. Der Unterschied muss sichtbar bleiben.
if (lauf.status === 2) {
  console.error("ESLint selbst ist gescheitert. Rueckgabe 2 heisst NICHT bestanden.")
  process.exit(2)
}
if (lauf.status === 0) console.log("Keine Befunde.")
process.exit(lauf.status === 0 ? 0 : 1)
