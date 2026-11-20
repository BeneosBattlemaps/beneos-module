/**
 * DIE DOPPELNAMENWACHE UND DIE GLOBALENWACHE LESEN DEN INDEX (stre-T-157),
 * UND EIN PARSERFEHLER IST KEIN DOPPELNAME (stre-T-158).
 *
 * T-157. Der Vorhaken prueft, was committet wird. Die zwei Waechter mit drei
 * Austritten (`fahre_weich`) fuhren ihre Benches aber gegen die Platte: ein
 * vorgemerkter Doppelname mit sauberer Platte rutschte durch, und eine fremde
 * unverfolgte Datei sperrte einen sauberen Commit.
 *
 * WIE DIESER SATZ DEN HAKEN FAEHRT, OHNE EIN NEUES REPOSITORIUM. Er baut einen
 * eigenen Index (`GIT_INDEX_FILE`, `git read-tree HEAD`, Probe per
 * `git hash-object -w` und `git update-index --cacheinfo`) und einen eigenen
 * Arbeitsbaum in einer Wegwerfkopie (`GIT_WORK_TREE`), beide ueber dem
 * Objektspeicher des echten Repositoriums (`GIT_DIR`). Der echte Index und der
 * echte Arbeitsbaum bleiben unberuehrt; liegen gebliebene Objekte raeumt `git gc`.
 * Der Haken kommt aus der EIGENEN Kopie dieses Satzes, damit eine Sabotage am
 * Haken greift. Unter `tools/stream-sabotagen.mjs` liegt die Kopie ohne `.git`;
 * der Laeufer nennt das Repositorium dann in `VORHAKEN_GIT_DIR`.
 *
 * T-158. `bench.mjs` zaehlte jeden Fehler von ESLint, auch einen Parserfehler,
 * als Doppelname. Eine Regex mit v-Flag (ES2024) machte die Wache rot.
 *
 * Austritt 2, nicht 0, wenn `sh`, `git`, ESLint ueber `npx` oder eine
 * Foundry-Installation fehlt: eine Wache, die nicht laufen konnte, ist nicht
 * gruen.
 *
 * Lauf:  node tools/haken/vorhaken.test.mjs
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFile, execFileSync } from "node:child_process"
import { pruefstand } from "../lib/foundry-attrappe.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = resolve(HIER, "../..")
const TEILE = ["scripts", "lang", "ui", "tools", "templates", "css"]
const DATEIEN = ["module.json", "package.json"]

const FEHLER = "export const zzProbe = { a: 1, a: 2 }\nexport const zzVorlage = () => renderTemplate(\"x\")\n"
const SAUBER = "export const zzProbe = { a: 1 }\n"
const KAPUTT = "const = ;\n"
const PROBE = `scripts/zz-vorhaken-probe-${process.pid}.js`
const FREMD = `scripts/zz-vorhaken-fremd-${process.pid}.js`

function nichtMessbar(grund) {
  console.log(`NICHT MESSBAR: ${grund}`)
  process.exit(2)
}

const kinder = new Set()
function lauf(befehl, args, opt = {}) {
  return new Promise((fertig) => {
    const k = execFile(befehl, args, { maxBuffer: 1 << 26, windowsHide: true, ...opt }, (fehler, aus, err) => {
      kinder.delete(k)
      fertig({ rc: fehler ? (typeof fehler.code === "number" ? fehler.code : -1) : 0, aus: `${aus}${err}`, fehlt: fehler?.code === "ENOENT" })
    })
    kinder.add(k)
  })
}

// ------------------------------------------------------------ Repositorium

function gitDir() {
  if (process.env.VORHAKEN_GIT_DIR) return process.env.VORHAKEN_GIT_DIR
  try {
    return execFileSync("git", ["-C", WURZEL, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}
const GIT_DIR = gitDir()
if (!GIT_DIR || !existsSync(GIT_DIR)) nichtMessbar("kein Repositorium gefunden (VORHAKEN_GIT_DIR oder git rev-parse)")

const temp = []
function wegwerf(name) {
  const d = mkdtempSync(join(tmpdir(), name))
  temp.push(d)
  return d
}
function raeumeAb() {
  for (const d of temp) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* genannt unten */ }
    if (existsSync(d)) console.log(`REST nicht abgeraeumt: ${d}`)
  }
}
process.on("exit", raeumeAb)
// Strg+C oder eine Toetung an der Zeitgrenze des Laeufers loest kein
// exit-Ereignis aus. Ohne diese Zeilen blieben Kopien liegen und die Haken
// liefen weiter. Ein Kind, das nicht endet, haelt den Abbruch nicht auf.
function abbrechen(rc) {
  for (const k of kinder) k.kill()
  setTimeout(() => process.exit(rc), 3000).unref()
  Promise.all([...kinder].map((k) => new Promise((r) => k.once("exit", r)))).then(() => process.exit(rc))
}
process.once("SIGINT", () => abbrechen(130))
process.once("SIGTERM", () => abbrechen(143))

/** Ein Arbeitsbaum ohne .git aus der eigenen Kopie, dazu ein Index ueber HEAD. */
function baum() {
  const wt = wegwerf("vorhaken-wt-")
  for (const t of TEILE) cpSync(join(WURZEL, t), join(wt, t), { recursive: true })
  for (const f of DATEIEN) if (existsSync(join(WURZEL, f))) cpSync(join(WURZEL, f), join(wt, f))
  // VORHAKEN_INNEN: der Haken faehrt diesen Satz sonst selbst wieder, sobald
  // eine Bench im eigenen Index von HEAD abweicht.
  const env = { ...process.env, GIT_DIR, GIT_WORK_TREE: wt, GIT_INDEX_FILE: join(wegwerf("vorhaken-ix-"), "index"), VORHAKEN_INNEN: "1" }
  const git = (args, input) => execFileSync("git", args, { env, cwd: wt, encoding: "utf8", input })
  git(["read-tree", "HEAD"])
  return { wt, env, git }
}

function merke(b, pfad, inhalt) {
  const sha = b.git(["hash-object", "-w", "--stdin"], inhalt).trim()
  b.git(["update-index", "--add", "--cacheinfo", `100644,${sha},${pfad}`])
}

/** Merkt die eigenen Fassungen der Benches vor, damit der Haken sie und nicht HEAD faehrt. */
function merkeBenches(b) {
  const liste = execFileSync("git", ["ls-files", "--others", "--cached", "--exclude-standard", "--", "tools/doppelnamen-bench", "tools/v15-globale-bench"],
    { env: b.env, cwd: b.wt, encoding: "utf8" }).split("\n").filter(Boolean)
  for (const pfad of liste) {
    if (/\.(m?js|json)$/.test(pfad) && existsSync(join(b.wt, pfad))) {
      b.git(["update-index", "--add", `--`, pfad])
    }
  }
}

const WAECHTER = { doppelnamen: "doppelnamen-bench, erlaubt 0", v15: "v15-globale-bench" }

function urteil(aus, name) {
  if (aus.includes(`pre-commit: ROT  ${name}`)) return "ROT"
  if (aus.includes(`pre-commit: ok  ${name}`)) return "ok"
  if (aus.includes(`pre-commit: NICHT GEMESSEN  ${name}`)) return "nicht gemessen"
  return "fehlt"
}

async function haken({ index, platte, skip = false }) {
  const b = baum()
  merkeBenches(b)
  merke(b, PROBE, { fehler: FEHLER, sauber: SAUBER, kaputt: KAPUTT }[index])
  // skip-worktree: committet wird der Indexinhalt, checkout-index ueberspringt
  // ihn aber ohne --ignore-skip-worktree-bits (Kalt-Review zu stre-T-157).
  if (skip) b.git(["update-index", "--skip-worktree", "--", PROBE])
  // Die Platte: dieselbe Probe sauber, oder fremd mit Fehler, oder beides mit Fehler.
  writeFileSync(join(b.wt, PROBE), platte === "probe-fehler" ? FEHLER : SAUBER)
  if (platte === "fremd-fehler") writeFileSync(join(b.wt, FREMD), FEHLER)
  const r = await lauf("sh", [join(b.wt, "tools/haken/pre-commit")], { env: b.env, cwd: b.wt, timeout: 900000 })
  if (r.fehlt) nichtMessbar("sh nicht gefunden")
  return { doppelnamen: urteil(r.aus, WAECHTER.doppelnamen), v15: urteil(r.aus, WAECHTER.v15), aus: r.aus, rc: r.rc }
}

// ------------------------------------------------------------ Bench direkt

async function bench(dateien) {
  const d = wegwerf("vorhaken-bench-")
  cpSync(join(WURZEL, "tools/doppelnamen-bench"), join(d, "tools/doppelnamen-bench"), { recursive: true })
  mkdirSync(join(d, "scripts"))
  for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(d, "scripts", name), inhalt)
  return lauf(process.execPath, [join(d, "tools/doppelnamen-bench/bench.mjs")], { cwd: d, timeout: 300000 })
}

// ------------------------------------------------------------ Lauf

const p = pruefstand("doppelwache: Vorhaken liest den Index (T-157), Parserfehler ist kein Doppelname (T-158)")

const [f1, f2, f3, f4, f5, f6, bV, bLeer, bDoppel, bBeides] = await Promise.all([
  haken({ index: "fehler", platte: "sauber" }),
  haken({ index: "sauber", platte: "sauber" }),
  haken({ index: "sauber", platte: "fremd-fehler" }),
  haken({ index: "fehler", platte: "probe-fehler" }),
  haken({ index: "kaputt", platte: "sauber" }),
  haken({ index: "fehler", platte: "sauber", skip: true }),
  bench({ "v.mjs": "export const r = /[\\p{L}--[a-z]]/v\n" }),
  bench({ "kaputt.mjs": "const = ;\n" }),
  bench({ "doppel.mjs": "export const o = { a: 1, a: 2 }\n" }),
  bench({ "kaputt.mjs": "const = ;\n", "doppel.mjs": "export const o = { a: 1, a: 2 }\n" }),
])

for (const f of [f1, f2, f3, f4, f6]) {
  for (const w of ["doppelnamen", "v15"]) {
    if (f[w] === "nicht gemessen") nichtMessbar(`${WAECHTER[w]} meldet NICHT GEMESSEN (kein npx-Zwischenspeicher oder keine Foundry)`)
  }
}
for (const r of [bV, bLeer, bDoppel, bBeides]) {
  if (/Selbstproben|eslint/i.test(r.aus) === false) nichtMessbar(`doppelnamen-bench lief nicht: ${r.aus.slice(0, 200)}`)
}
// VORHAKEN_ZEIG=1 bis 6 zeigt die Ausgabe des Hakens in diesem Fall.
const zeig = [f1, f2, f3, f4, f5, f6][Number(process.env.VORHAKEN_ZEIG) - 1]
if (zeig) console.log(zeig.aus)

p.abschnitt("T-157 doppelnamen-bench im Vorhaken")
p.gleich("Doppelname nur im Index sperrt", f1.doppelnamen, "ROT")
p.gleich("sauberer Index mit sauberer Platte geht durch", f2.doppelnamen, "ok")
p.gleich("fremde Datei auf der Platte sperrt einen sauberen Index nicht", f3.doppelnamen, "ok")
p.gleich("Doppelname im Index und auf der Platte sperrt", f4.doppelnamen, "ROT")

p.gleich("Doppelname mit skip-worktree im Index sperrt", f6.doppelnamen, "ROT")
p.gleich("mit skip-worktree liest die Bench den Indexinhalt", /Doppelnamen: 1, erlaubt 0/.test(f6.aus), true)

p.abschnitt("T-157 v15-globale-bench im Vorhaken")
p.gleich("Globale nur im Index sperrt", f1.v15, "ROT")
p.gleich("sauberer Index geht durch, Globalenwache", f2.v15, "ok")
p.gleich("fremde Globale auf der Platte sperrt nicht", f3.v15, "ok")
p.gleich("Globale im Index und auf der Platte sperrt", f4.v15, "ROT")

// Ein Parserfehler im Index: die Doppelnamenwache meldet NICHT GEMESSEN und
// sperrt nicht, gesperrt wird ueber die Syntaxpruefung der vorgemerkten Fassung.
p.abschnitt("T-158 Parserfehler im Vorhaken")
p.gleich("Parserfehler im Index: Doppelnamenwache nicht gemessen", f5.doppelnamen, "nicht gemessen")
p.gleich("Parserfehler im Index: Syntaxpruefung sperrt", f5.aus.includes(`Syntaxfehler in der VORGEMERKTEN Fassung von ${PROBE}`), true)
p.gleich("Parserfehler im Index: Haken endet rot", f5.rc, 1)
p.gleich("sauberer Index: Haken endet gruen", f2.rc, 0)

p.abschnitt("T-158 doppelnamen-bench direkt")
p.gleich("Regex mit v-Flag ist kein Befund", bV.rc, 0)
p.gleich("nur ein Parserfehler: nicht messbar", bLeer.rc, 2)
p.gleich("nur ein Parserfehler: Meldung nennt NICHT MESSBAR und die Datei", /NICHT MESSBAR: Parserfehler in scripts[\\/]kaputt\.mjs:1/.test(bLeer.aus), true)
p.gleich("nur ein Parserfehler zaehlt keinen Doppelnamen", /Doppelnamen: [1-9]/.test(bLeer.aus), false)
p.gleich("ein Doppelname bleibt rot", bDoppel.rc, 1)
p.gleich("Doppelname neben Parserfehler bleibt rot", bBeides.rc, 1)
p.gleich("Doppelname neben Parserfehler zaehlt genau einen", /Doppelnamen: 1, erlaubt 0/.test(bBeides.aus), true)
p.gleich("Doppelname neben Parserfehler nennt die nicht gelesene Datei", /nicht gelesen: scripts[\\/]kaputt\.mjs:1/.test(bBeides.aus), true)

p.ende()
