/**
 * DIE WACHEN DES VORHAKENS LIEGEN JE DOMAENE IN EINER EIGENEN DATEI (stre-T-070),
 * UND KEINE IST DABEI VERLOREN GEGANGEN.
 *
 * Bis stre-T-070 trug `tools/haken/pre-commit` den Kern des Tors und alle
 * Wachen in einer Datei. Jede neue Wache war ein Edit an derselben Datei, und
 * beim Trennen von Commits fuer einen Push hing jeder Schnitt an ihr. Seitdem
 * liegen die Wachen in `tools/haken/wachen/<domaene>.sh`, und der Kern laedt
 * jede vorgemerkte Datei dieses Ordners.
 *
 * WAS DIESER SATZ FESTHAELT
 *
 * Erhalt. Die Saetze, die der Haken auf cf5ddc5 (letzter Stand vor der
 * Teilung) gefahren hat, sind eine Teilmenge der Saetze aus Kern und
 * Wachendateien. Teilmenge und nicht Gleichheit, damit eine neue Wache den
 * Satz nicht bricht. Dazu je Datei eine Untergrenze.
 *
 * Code unveraendert. Jede Codezeile (ohne Kommentar) eines alten Blocks steht
 * unveraendert, zusammenhaengend und in der alten Reihenfolge in der Datei
 * ihrer Domaene. Kommentare durften sich aendern, weil ihre Lageverweise
 * ("darueber", "oben") nach dem Umzug auf andere Stellen zeigten.
 *
 * Lader. In einem Wegwerf-Repositorium faehrt der echte Kern gegen kleine
 * Wachendateien: eine rote Wache macht ihn rot, ohne sie ist er gruen; eine
 * Datei mit Syntaxfehler laeuft gar nicht an und ist rot; eine Datei, die HEAD
 * kennt und der Index nicht, ist rot; eine unverfolgte Datei laeuft nie; von
 * einer geaenderten Datei laeuft die vorgemerkte Fassung; alle Dateien des
 * Ordners laufen, nicht nur eine. Dazu die Fehlerzweige: ohne HEAD gruen,
 * Datei oder Liste nicht lesbar rot, `exit 0` in einer Datei rot, eine Datei
 * in einem Unterordner laeuft nicht.
 *
 * Erhalt und Zeichengleichheit lesen Kern und Wachendateien aus dem Index,
 * wie der Haken sie laedt; nur ausserhalb eines Arbeitsbaums die Platte.
 *
 * Die Sabotagen stehen in `tools/stream-sabotagen.mjs`, Satz `wachen`.
 *
 * Austritt 2, nicht 0, wenn `git` oder `sh` fehlt oder cf5ddc5 nicht lesbar
 * ist: ein Satz, der nicht messen konnte, ist nicht gruen.
 *
 * Lauf:  node tools/haken/wachen.test.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync, spawnSync } from "node:child_process"
import { pruefstand } from "../lib/foundry-attrappe.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const ALT = "cf5ddc5"
const KERN = join(HIER, "pre-commit")
const ORDNER = join(HIER, "wachen")

function nichtMessbar(grund) {
  console.log(`NICHT MESSBAR: ${grund}`)
  process.exit(2)
}

// Unter `tools/stream-sabotagen.mjs` liegt dieser Satz in einer Kopie ohne
// `.git`; der Laeufer nennt das Repositorium in `VORHAKEN_GIT_DIR`.
function gitDir() {
  if (process.env.VORHAKEN_GIT_DIR) return process.env.VORHAKEN_GIT_DIR
  try {
    return execFileSync("git", ["-C", HIER, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}
const GIT_DIR = gitDir()
if (!GIT_DIR || !existsSync(GIT_DIR)) nichtMessbar("kein Repositorium gefunden (VORHAKEN_GIT_DIR oder git rev-parse)")
let ALTTEXT
try {
  ALTTEXT = execFileSync("git", ["--git-dir", GIT_DIR, "show", `${ALT}:tools/haken/pre-commit`], { encoding: "utf8" })
} catch {
  nichtMessbar(`${ALT}:tools/haken/pre-commit nicht lesbar`)
}

// ------------------------------------------------------------ Saetze

const SCHLEIFE = "<Streamsaetze-Schleife unter scripts>"
const AUFRUF = /^\s*(?:fahre|fahre_weich|node)\s+"([^"$]+)"/gm

/** Die Saetze eines Hakentexts: jeder per Namen gefahrene, dazu die Schleife. */
function saetze(text) {
  const s = [...text.matchAll(AUFRUF)].map((m) => m[1])
  if (text.includes("git ls-files -- 'scripts/*.test.mjs'")) s.push(SCHLEIFE)
  return s
}

const DOMAENE = {
  basis: ["scripts/creature-installer/anker.test.mjs", "tools/v14-import-bench/unit.mjs", "tools/pruefe-katalog-offline.mjs"],
  modul: ["tools/filter-reihenfolge-bench/bench.mjs", "tools/paket-grenze-bench/bench.mjs", "tools/v15-globale-bench/bench.mjs",
    "tools/v14-import-bench/bench.mjs", "tools/scene-merge-token-bench/unit.mjs", "tools/doppelnamen-bench/bench.mjs"],
}
const domaeneVon = (satz) => Object.keys(DOMAENE).find((d) => DOMAENE[d].includes(satz)) ?? "stre"
// stre: die 11 alten Saetze und dieser Satz selbst, den stre.sh seit stre-T-070 faehrt,
// dazu kompendium-riegel-bench und seit stre-T-496 die Schluesselpruefung der
// Sprachdateien, also 14. DIE ZAHL IST DER STAND, NICHT EIN ABSTAND DARUNTER: sie
// stand auf 12, waehrend stre.sh 13 Saetze fuhr, und dann blieb der Verlust eines
// Satzes gruen (Sabotage W3 in tools/stream-sabotagen.mjs, gemessen am 26.11.2026
// auf 883acf3). Wer in stre.sh einen Satz dazunimmt, zieht sie hier nach.
const MINDEST = { basis: 3, modul: 6, stre: 14 }

const istCode = (z) => z.trim() !== "" && !z.trim().startsWith("#")

/**
 * Die Wachenbloecke des alten Hakens: ab dem ersten `fahre` auf Spalte 0 bis
 * zum Ausgang. Ein Block ist ein `fahre` auf Spalte 0 oder ein `if` auf
 * Spalte 0 bis zu seinem `fi` auf Spalte 0. Zurueck kommen nur Codezeilen.
 */
function bloecke(text) {
  const z = text.split(/\r?\n/)
  const a = z.findIndex((l) => /^fahre "/.test(l))
  const e = z.findIndex((l) => /^# -+ Ausgang/.test(l))
  if (a < 0 || e < a) return []
  const out = []
  let akt = null
  for (let i = a; i < e; i += 1) {
    const l = z[i]
    if (akt) {
      akt.push(l)
      if (l === "fi") { out.push(akt); akt = null }
      continue
    }
    if (/^fahre /.test(l)) out.push([l])
    else if (/^if /.test(l)) akt = [l]
  }
  return out.map((b) => b.filter(istCode))
}

/** Stelle, ab der `teil` zusammenhaengend in `ganz` steht, sonst -1. */
function stelle(ganz, teil, ab = 0) {
  for (let i = ab; i + teil.length <= ganz.length; i += 1) {
    if (teil.every((z, j) => ganz[i + j] === z)) return i
  }
  return -1
}

/**
 * Kern und Wachendateien so, wie der Haken sie laedt: aus dem Index. Liefe
 * der Satz gegen die Platte, saehe er im Haken eine andere Fassung als der
 * Kern, und eine nur vorgemerkte Kuerzung bliebe gruen. Ist dieser Ordner
 * nicht Teil eines Arbeitsbaums (die Sabotagekopie hat kein `.git`), gilt
 * die Platte. Die Umgebung bleibt geerbt, samt GIT_INDEX_FILE des Hakens.
 */
function quelle() {
  let top = null
  try {
    top = execFileSync("git", ["-C", HIER, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch { /* kein Arbeitsbaum: Platte */ }
  if (top && resolve(top, "tools/haken") === resolve(HIER)) {
    const g = (...a) => execFileSync("git", ["-C", top, ...a], { encoding: "utf8" })
    try {
      const namen = g("ls-files", "--", ":(glob)tools/haken/wachen/*.sh").split("\n").filter(Boolean).sort()
      return {
        art: "Index",
        kern: g("show", ":tools/haken/pre-commit"),
        fragment: Object.fromEntries(namen.map((p) => [p.replace(/^.*\//, "").replace(/\.sh$/, ""), g("show", `:${p}`)])),
      }
    } catch (e) {
      nichtMessbar(`Index nicht lesbar: ${String(e.message).split("\n")[0]}`)
    }
  }
  const dateien = existsSync(ORDNER) ? readdirSync(ORDNER).filter((n) => n.endsWith(".sh")).sort() : []
  return {
    art: "Platte",
    kern: readFileSync(KERN, "utf8"),
    fragment: Object.fromEntries(dateien.map((n) => [n.replace(/\.sh$/, ""), readFileSync(join(ORDNER, n), "utf8")])),
  }
}
const QUELLE = quelle()
console.log(`wachen: Kern und Wachendateien aus ${QUELLE.art === "Index" ? "dem Index" : "der Platte"}`)
const KERNTEXT = QUELLE.kern
const FRAGMENT = QUELLE.fragment
const NEUTEXT = [KERNTEXT, ...Object.values(FRAGMENT)].join("\n")

const alt = saetze(ALTTEXT)
const neu = saetze(NEUTEXT)
const altBloecke = bloecke(ALTTEXT)

// ------------------------------------------------------------ Lader

// Umgebung ohne die Git-Variablen des aeusseren Hakens: laeuft dieser Satz im
// Vorhaken, zeigt GIT_INDEX_FILE auf den Index des echten Commits.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/.test(k)))
const temp = []
process.on("exit", () => {
  for (const d of temp) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* genannt unten */ }
    if (existsSync(d)) console.log(`REST nicht abgeraeumt: ${d}`)
  }
})

const GRUEN = (name) => `fahre "t/gruen.mjs" "${name}"\n`
const ROT = `fahre "t/rot.mjs" "probe-rot"\n`
// Der erste Befehl schreibt eine Marke, der Fehler steht am Ende. Laeuft
// irgendetwas aus dieser Datei, liegt die Marke da.
const KAPUTT = `: > t/marke-kaputt\nfahre "t/gruen.mjs" "probe-kaputt"\nif true; then\n`
const FREMD = `: > t/marke-fremd\nexit 0\n`
const PLATTE = `: > t/marke-platte\nfahre "t/rot.mjs" "probe-platte"\n`

/** Ein Wegwerf-Repositorium mit dem echten Kern und, ausser bei `ohneCommit`, einem ersten Commit. */
function repo({ ohneCommit = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), "wachen-repo-"))
  temp.push(d)
  const git = (...args) => execFileSync("git", ["-c", "user.name=wachen", "-c", "user.email=wachen@example.invalid",
    "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd: d, env, encoding: "utf8" })
  git("init", "-q")
  mkdirSync(join(d, "tools/haken/wachen"), { recursive: true })
  mkdirSync(join(d, "t"))
  writeFileSync(join(d, "tools/haken/pre-commit"), KERNTEXT)
  writeFileSync(join(d, "t/gruen.mjs"), "process.exit(0)\n")
  writeFileSync(join(d, "t/rot.mjs"), "process.exit(1)\n")
  writeFileSync(join(d, "t/.gitignore"), "marke-*\n")
  git("add", "tools/haken/pre-commit", "t/gruen.mjs", "t/rot.mjs", "t/.gitignore")
  if (!ohneCommit) git("commit", "-q", "--no-verify", "-m", "basis")
  const schreib = (name, text) => {
    mkdirSync(dirname(join(d, "tools/haken/wachen", name)), { recursive: true })
    writeFileSync(join(d, "tools/haken/wachen", name), text)
  }
  const fahr = (zusatz = {}) => {
    const r = spawnSync("sh", ["tools/haken/pre-commit"], { cwd: d, env: { ...env, ...zusatz }, encoding: "utf8", timeout: 120000 })
    if (r.error?.code === "ENOENT") nichtMessbar("sh nicht gefunden")
    return { rc: r.status, aus: `${r.stdout}${r.stderr}` }
  }
  const marke = (n) => existsSync(join(d, "t", `marke-${n}`))
  return { d, git, schreib, fahr, marke }
}

// 1 und 2: zwei Werte. Dieselbe Lage, einmal mit roter Wache, einmal ohne.
const r1 = repo()
r1.schreib("a.sh", GRUEN("probe-a"))
r1.schreib("b.sh", ROT)
r1.git("add", "tools/haken/wachen/a.sh", "tools/haken/wachen/b.sh")
const l1 = r1.fahr()
const r2 = repo()
r2.schreib("a.sh", GRUEN("probe-a"))
r2.git("add", "tools/haken/wachen/a.sh")
const l2 = r2.fahr()

// 3: Syntaxfehler nach dem ersten Befehl.
const r3 = repo()
r3.schreib("a.sh", KAPUTT)
r3.git("add", "tools/haken/wachen/a.sh")
const l3 = r3.fahr()

// 4: HEAD kennt die Datei, der Index nicht mehr.
const r4 = repo()
r4.schreib("a.sh", GRUEN("probe-a"))
r4.git("add", "tools/haken/wachen/a.sh")
r4.git("commit", "-q", "--no-verify", "-m", "wache")
r4.git("rm", "-q", "--cached", "tools/haken/wachen/a.sh")
const l4 = r4.fahr()

// 5: unverfolgte Datei auf der Platte, vor einer roten Wache einsortiert.
const r5 = repo()
r5.schreib("aa.sh", FREMD)
r5.schreib("zz.sh", ROT)
r5.git("add", "tools/haken/wachen/zz.sh")
const l5 = r5.fahr()

// 6: vorgemerkt ist die gruene Fassung, auf der Platte liegt eine rote.
const r6 = repo()
r6.schreib("m.sh", GRUEN("probe-index"))
r6.git("add", "tools/haken/wachen/m.sh")
r6.schreib("m.sh", PLATTE)
const l6 = r6.fahr()

// 7: alle Dateien des Ordners laufen, je Domaene eine Probe.
const r7 = repo()
for (const d of ["basis", "modul", "stre"]) r7.schreib(`${d}.sh`, GRUEN(`probe-${d}`))
r7.git("add", "tools/haken/wachen/basis.sh", "tools/haken/wachen/modul.sh", "tools/haken/wachen/stre.sh")
const l7 = r7.fahr()

// 8: noch kein Commit, also kein HEAD; die vorgemerkte gruene Wache laeuft.
const r8 = repo({ ohneCommit: true })
r8.schreib("a.sh", GRUEN("probe-a"))
r8.git("add", "tools/haken/wachen/a.sh")
const l8 = r8.fahr()

// 9: der Index nennt eine Wachendatei, deren Inhalt es nicht gibt.
const r9 = repo()
r9.git("update-index", "--add", "--cacheinfo", `100644,${"1".repeat(40)},tools/haken/wachen/x.sh`)
const l9 = r9.fahr()

// 10: der Index selbst ist nicht lesbar, also auch die Liste nicht.
const r10 = repo()
writeFileSync(join(r10.d, "t", "kaputter-index"), "kein Index\n")
const l10 = r10.fahr({ GIT_INDEX_FILE: join(r10.d, "t", "kaputter-index") })

// 11: eine Wachendatei endet mit `exit 0`, nach einer roten Wache.
const r11 = repo()
r11.schreib("a.sh", ROT)
r11.schreib("b.sh", `: > t/marke-exit\nexit 0\n`)
r11.git("add", "tools/haken/wachen/a.sh", "tools/haken/wachen/b.sh")
const l11 = r11.fahr()

// 12: eine verfolgte .sh in einem Unterordner ist keine Domaene und laeuft nicht.
const r12 = repo()
r12.schreib("a.sh", GRUEN("probe-a"))
r12.schreib("alt/x.sh", `: > t/marke-unterordner\n`)
r12.git("add", "tools/haken/wachen/a.sh", "tools/haken/wachen/alt/x.sh")
const l12 = r12.fahr()

// ------------------------------------------------------------ Urteil

const p = pruefstand("wachen: die Wachen des Vorhakens je Domaene in einer Datei (stre-T-070)")

p.abschnitt("Erhalt gegen cf5ddc5")
p.gleich("der alte Haken zerfaellt in 19 Wachenbloecke", altBloecke.length, 19)
p.gleich("der alte Haken faehrt 20 Saetze", alt.length, 20)
p.gleich("jeder alte Satz steht in Kern oder Wachendatei", alt.filter((s) => !neu.includes(s)).join(", "), "")
p.gleich("kein Satz steht zweimal", neu.filter((s, i) => neu.indexOf(s) !== i).join(", "), "")
p.gleich("der Kern faehrt keine Wache selbst", saetze(KERNTEXT).join(", "), "")
for (const d of Object.keys(MINDEST)) {
  const hier = FRAGMENT[d] === undefined ? [] : saetze(FRAGMENT[d])
  p.gleich(`${d}.sh faehrt mindestens ${MINDEST[d]} Saetze`, hier.length >= MINDEST[d], true)
  p.gleich(`${d}.sh faehrt nur Saetze seiner Domaene`, hier.filter((s) => domaeneVon(s) !== d && s !== "tools/haken/wachen.test.mjs").join(", "), "")
}

p.abschnitt("Code jedes alten Blocks unveraendert in der Datei seiner Domaene")
const ab = { basis: 0, modul: 0, stre: 0 }
const fehlt = []
for (const b of altBloecke) {
  const d = domaeneVon(saetze(b.join("\n"))[0])
  const ziel = (FRAGMENT[d] ?? "").split(/\r?\n/).filter(istCode)
  const i = stelle(ziel, b, ab[d])
  if (i < 0) fehlt.push(`${d}: ${b[b.length > 1 ? b.length - 2 : 0].trim()}`)
  else ab[d] = i + b.length
}
p.gleich("jeder alte Block steht zeichengleich und in alter Reihenfolge", fehlt.join(" | "), "")

p.abschnitt("Lader im Wegwerf-Repositorium")
p.gleich("rote Wache in einer Wachendatei: Haken endet rot", l1.rc, 1)
p.gleich("rote Wache: die Meldung nennt sie", l1.aus.includes("pre-commit: ROT  probe-rot"), true)
p.gleich("rote Wache: die andere Datei laeuft trotzdem", l1.aus.includes("pre-commit: ok  probe-a"), true)
p.gleich("ohne die rote Wache: Haken endet gruen", l2.rc, 0)
p.gleich("ohne die rote Wache: die gruene laeuft", l2.aus.includes("pre-commit: ok  probe-a"), true)
p.gleich("Syntaxfehler: Haken endet rot", l3.rc, 1)
p.gleich("Syntaxfehler: die Meldung nennt die Datei", l3.aus.includes("Syntaxfehler in der Wachendatei tools/haken/wachen/a.sh"), true)
p.gleich("Syntaxfehler: nichts aus der Datei laeuft an", r3.marke("kaputt") || l3.aus.includes("probe-kaputt"), false)
p.gleich("HEAD kennt die Wachendatei, der Index nicht: Haken endet rot", l4.rc, 1)
p.gleich("HEAD kennt, Index nicht: die Meldung nennt die Datei", l4.aus.includes("tools/haken/wachen/a.sh fehlt im Index, HEAD kennt sie aber"), true)
p.gleich("unverfolgte Wachendatei laeuft nicht", r5.marke("fremd"), false)
p.gleich("unverfolgte Wachendatei: die rote verfolgte sperrt weiter", l5.rc, 1)
p.gleich("geaenderte Wachendatei: die vorgemerkte Fassung laeuft", l6.aus.includes("pre-commit: ok  probe-index"), true)
p.gleich("geaenderte Wachendatei: die Fassung der Platte laeuft nicht", r6.marke("platte") || l6.aus.includes("probe-platte"), false)
p.gleich("geaenderte Wachendatei: Haken endet gruen", l6.rc, 0)
p.gleich("alle Wachendateien laufen", ["basis", "modul", "stre"].filter((d) => !l7.aus.includes(`pre-commit: ok  probe-${d}`)).join(", "), "")
p.gleich("alle Wachendateien laufen: Haken endet gruen", l7.rc, 0)
p.gleich("ohne HEAD: Haken endet gruen", l8.rc, 0)
p.gleich("ohne HEAD: die vorgemerkte Wache laeuft", l8.aus.includes("pre-commit: ok  probe-a"), true)
p.gleich("Wachendatei nicht aus dem Index lesbar: Haken endet rot", l9.rc, 1)
p.gleich("nicht lesbar: die Meldung nennt die Datei", l9.aus.includes("Wachendatei tools/haken/wachen/x.sh nicht aus dem Index lesbar"), true)
p.gleich("Index kaputt: Haken endet rot", l10.rc, 1)
p.gleich("Index kaputt: die Liste gilt als nicht lesbar", l10.aus.includes("pre-commit: ROT  Liste der Wachendateien nicht lesbar"), true)
p.gleich("exit 0 in einer Wachendatei: Haken endet rot", l11.rc, 1)
p.gleich("exit 0: die Meldung nennt die Datei", l11.aus.includes("die Wachendatei tools/haken/wachen/b.sh hat den Haken vorzeitig beendet"), true)
p.gleich("exit 0: die Datei lief wirklich", r11.marke("exit"), true)
p.gleich("Unterordner: die Datei darin laeuft nicht", r12.marke("unterordner") || l12.aus.includes("alt/x.sh"), false)
p.gleich("Unterordner: die Datei daneben laeuft", l12.aus.includes("pre-commit: ok  probe-a"), true)
if (process.env.WACHEN_ZEIG) console.log([l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12][Number(process.env.WACHEN_ZEIG) - 1]?.aus)

p.ende()
