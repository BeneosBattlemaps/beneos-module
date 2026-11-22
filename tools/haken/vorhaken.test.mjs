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
 * Haken greift. Seit stre-T-070 heisst das: der Kern von der Platte der Kopie,
 * die Wachendateien vorgemerkt aus derselben Kopie (`merkeBenches`). Unter `tools/stream-sabotagen.mjs` liegt die Kopie ohne `.git`;
 * der Laeufer nennt das Repositorium dann in `VORHAKEN_GIT_DIR`.
 *
 * T-158. `bench.mjs` zaehlte jeden Fehler von ESLint, auch einen Parserfehler,
 * als Doppelname. Eine Regex mit v-Flag (ES2024) machte die Wache rot.
 *
 * NACHTRAG (Kalt-Review W1). Seit T-158 sperrt ein Parserfehler nur noch ueber
 * die Syntaxpruefung des Hakens. Die prueft eine `.js` jetzt in der Form, in
 * der Foundry sie laedt (`tools/haken/ladeform.mjs`): ein doppelter
 * Parametername in einem esmodule sperrt, in einer klassischen Datei nicht.
 *
 * KOSTEN. In der Wegwerfkopie ist jeder andere Pruefsatz, den der Haken faehrt,
 * ein Stub mit Austritt 0, auch dieser Satz selbst. Strukturproben halten fest,
 * dass der echte Haken die echten Saetze faehrt.
 *
 * Austritt 2, nicht 0, wenn `sh`, `git`, ESLint ueber `npx` oder eine
 * Foundry-Installation fehlt: eine Wache, die nicht laufen konnte, ist nicht
 * gruen.
 *
 * Lauf:  node tools/haken/vorhaken.test.mjs
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

// ------------------------------------------------------------ Stubs
//
// KOSTEN (Nachtrag stre-T-157). Der Haken faehrt jeden Pruefsatz, den er per
// `fahre "<pfad>"` oder `node "<pfad>"` nennt, und dazu die Streamsaetze unter
// scripts/. In der Wegwerfkopie liefert jeder davon nur `process.exit(0)`; echt
// laufen dort die zwei Benches unter `fahre_weich` aus dem Index, um die es in
// diesem Satz geht. Der Haken selbst bleibt bytegleich, und keine
// Umgebungsvariable schaltet im echten Haken etwas ab. Weil auch dieser Satz in
// der Kopie ein Stub ist, faehrt der innere Haken ihn nicht noch einmal.

// Seit stre-T-070 ist der Haken ein Kern und je Domaene eine Wachendatei unter
// `tools/haken/wachen/`. Der Kern laedt sie aus dem Index; `merkeBenches` merkt
// deshalb die eigenen Fassungen vor, sonst liefe der innere Haken mit denen aus
// HEAD oder ganz ohne Wachen. HAKENTEXT ist Kern und alle Wachendateien.
const HAKENDATEIEN = ["tools/haken/pre-commit",
  ...readdirSync(join(HIER, "wachen")).filter((n) => n.endsWith(".sh")).sort().map((n) => `tools/haken/wachen/${n}`)]
const HAKENTEXT = HAKENDATEIEN.map((f) => readFileSync(join(WURZEL, f), "utf8")).join("\n")
const STUB = "process.exit(0)\n"
const AUFRUF = /^\s*(?:fahre|node)\s+"([^"$]+)"/gm
const GERUFEN = [...HAKENTEXT.matchAll(AUFRUF)].map((m) => m[1])

/** Die Saetze, die der echte Haken per Namen faehrt. Faellt einer heraus, ist das ein Befund. */
const PFLICHT = [
  "scripts/creature-installer/anker.test.mjs", "tools/v14-import-bench/unit.mjs",
  "scripts/cloud-login-kennung.test.mjs", "tools/stream-sprachen-bench/bench.mjs",
  "tools/filter-reihenfolge-bench/bench.mjs", "tools/lib/kindlauf.test.mjs",
  "tools/bench-sabotagen.test.mjs", "tools/pruefe-katalog-offline.mjs",
  "tools/waisen-adressform-bench/bench.mjs", "tools/bildform-adresse-bench/bench.mjs",
  "tools/paket-grenze-bench/bench.mjs", "tools/haken/vorhaken.test.mjs",
  "tools/haken/vorpush.test.mjs", "tools/pruefe-beta-zip.test.mjs",
  "tools/haken/commit-msg.test.mjs", "tools/haken/wachen.test.mjs",
]

function stubListe(wt) {
  const tests = readdirSync(join(wt, "scripts"), { recursive: true })
    .map((p) => `scripts/${String(p).replaceAll("\\", "/")}`)
    .filter((p) => p.endsWith(".test.mjs"))
  return [...new Set([...GERUFEN, ...tests, "tools/haken/vorhaken.test.mjs"])]
    .filter((p) => p !== "tools/haken/ladeform.mjs" && existsSync(join(wt, p)))
    // Die zwei Wachen dieses Satzes laufen immer echt, auch wenn eine Sabotage
    // sie vom `fahre_weich` auf ein `fahre` umstellt.
    .filter((p) => !p.startsWith("tools/doppelnamen-bench/") && !p.startsWith("tools/v15-globale-bench/"))
}

/** Ein Arbeitsbaum ohne .git aus der eigenen Kopie, dazu ein Index ueber HEAD. */
function baum() {
  const wt = wegwerf("vorhaken-wt-")
  for (const t of TEILE) cpSync(join(WURZEL, t), join(wt, t), { recursive: true })
  for (const f of DATEIEN) if (existsSync(join(WURZEL, f))) cpSync(join(WURZEL, f), join(wt, f))
  const stubs = stubListe(wt)
  for (const p of stubs) writeFileSync(join(wt, p), STUB)
  const env = { ...process.env, GIT_DIR, GIT_WORK_TREE: wt, GIT_INDEX_FILE: join(wegwerf("vorhaken-ix-"), "index") }
  const git = (args, input) => execFileSync("git", args, { env, cwd: wt, encoding: "utf8", input })
  git(["read-tree", "HEAD"])
  return { wt, env, git, stubs }
}

function merke(b, pfad, inhalt) {
  const sha = b.git(["hash-object", "-w", "--stdin"], inhalt).trim()
  b.git(["update-index", "--add", "--cacheinfo", `100644,${sha},${pfad}`])
}

/**
 * Merkt die eigenen Fassungen der Benches und der Wachendateien vor, damit der
 * Haken sie und nicht HEAD faehrt. Die Wachendateien laedt der Kern nur aus dem
 * Index (stre-T-070); eine Sabotage an ihnen greift nur, wenn sie hier landet.
 */
function merkeBenches(b) {
  const liste = execFileSync("git", ["ls-files", "--others", "--cached", "--exclude-standard", "--", "tools/doppelnamen-bench", "tools/v15-globale-bench", "tools/foundry-orte.mjs", "tools/haken/wachen"],
    { env: b.env, cwd: b.wt, encoding: "utf8" }).split("\n").filter(Boolean)
  for (const pfad of liste) {
    if (/\.(m?js|json|sh)$/.test(pfad) && existsSync(join(b.wt, pfad))) {
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

// Hoechstens zwei Haken zugleich. Jeder Haken startet ESLint und die
// Globalenwache; zehn auf einmal belasteten den ganzen Rechner (gemessen von
// orch-stre-1: rund 35 gleichzeitige Haken unter vier Sabotagekopien).
const HAKEN_ZUGLEICH = 2
let hakenLaufend = 0
const hakenWarten = []
async function platz() {
  if (hakenLaufend >= HAKEN_ZUGLEICH) await new Promise((r) => hakenWarten.push(r))
  hakenLaufend += 1
}
function frei() {
  hakenLaufend -= 1
  hakenWarten.shift()?.()
}

async function fahreHaken(b) {
  await platz()
  let r
  try {
    r = await lauf("sh", [join(b.wt, "tools/haken/pre-commit")], { env: b.env, cwd: b.wt, timeout: 900000 })
  } finally {
    frei()
  }
  if (r.fehlt) nichtMessbar("sh nicht gefunden")
  return { doppelnamen: urteil(r.aus, WAECHTER.doppelnamen), v15: urteil(r.aus, WAECHTER.v15), aus: r.aus, rc: r.rc }
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
  return fahreHaken(b)
}

// ------------------------------------------------------------ Ladeform
//
// W1 aus dem Kalt-Review: Foundry laedt beneos-journal.js als Modul
// (esmodules), beneosfx.js klassisch (scripts). Ein doppelter Parametername
// ist nur im Modul ein Syntaxfehler. Die Faelle haengen an bestehende Dateien
// an, wie sie in HEAD stehen, und merken das Ergebnis im eigenen Index vor.

const JOURNAL = "scripts/beneos-journal.js"
const KLASSISCH = "scripts/beneosfx.js"
const DOPPELPARAM = "\nfunction zzVorhakenDoppel(a, a) { return a }\n"
const VFLAG = "\nfunction zzVorhakenV(s) { return /[\\p{L}--[a-z]]/v.test(s) }\n"

/** Haengt an die HEAD-Fassung je Pfad einen Zusatz an, oder ersetzt sie ganz (`{ganz}`). */
async function hakenMit(aenderungen) {
  const b = baum()
  merkeBenches(b)
  for (const [pfad, a] of Object.entries(aenderungen)) {
    const inhalt = typeof a === "string" ? b.git(["show", `HEAD:${pfad}`]) + a : a.ganz
    merke(b, pfad, inhalt)
  }
  return fahreHaken(b)
}

async function ladeform(aenderungen = {}) {
  const b = baum()
  for (const [pfad, inhalt] of Object.entries(aenderungen)) merke(b, pfad, inhalt)
  return lauf(process.execPath, [join(b.wt, "tools/haken/ladeform.mjs")], { env: b.env, cwd: b.wt, timeout: 120000 })
}

function syntaxBefund(aus, pfad) {
  return aus.includes(`Syntaxfehler in der VORGEMERKTEN Fassung von ${pfad}`)
}

// ------------------------------------------------------------ Bench direkt

async function bench(dateien) {
  const d = wegwerf("vorhaken-bench-")
  cpSync(join(WURZEL, "tools/doppelnamen-bench"), join(d, "tools/doppelnamen-bench"), { recursive: true })
  mkdirSync(join(d, "scripts"))
  for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(d, "scripts", name), inhalt)
  return lauf(process.execPath, [join(d, "tools/doppelnamen-bench/bench.mjs")], { cwd: d, timeout: 300000 })
}

// ------------------------------------------------------------ ESLint-Weg
//
// Die Bench nimmt ESLint aus dem npx-Zwischenspeicher nur, wenn package.json
// des Fundorts genau ihre Fassung nennt, und bei mehreren Treffern immer den
// ersten nach Namen. Ein falscher Treffer faellt auf npx zurueck.

function speicher(ordner) {
  const d = wegwerf("vorhaken-npx-")
  for (const [name, fassung] of Object.entries(ordner)) {
    const paket = join(d, "_npx", name, "node_modules", "eslint")
    mkdirSync(join(paket, "bin"), { recursive: true })
    writeFileSync(join(paket, "package.json"), JSON.stringify({ name: "eslint", version: fassung }))
    writeFileSync(join(paket, "bin", "eslint.js"), "process.exit(0)\n")
  }
  return d
}
function eslintWeg(cache) {
  return lauf(process.execPath, [join(HIER, "../doppelnamen-bench/bench.mjs"), "--eslint-weg"],
    { env: { ...process.env, npm_config_cache: cache }, timeout: 60000 })
}

// ------------------------------------------------------------ Lauf

const p = pruefstand("doppelwache: Vorhaken liest den Index (T-157), Parserfehler ist kein Doppelname (T-158)")

const MODUL_HEAD = execFileSync("git", ["--git-dir", GIT_DIR, "show", "HEAD:module.json"], { encoding: "utf8" })
const modulMitKlassischem = (() => {
  const m = JSON.parse(MODUL_HEAD)
  m.esmodules = [...m.esmodules, KLASSISCH]
  m.scripts = [...new Set([...(m.scripts ?? []), KLASSISCH])]
  return JSON.stringify(m, null, 2)
})()

const [f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, h1, h2, bV, bLeer, bDoppel, bBeides] = await Promise.all([
  haken({ index: "fehler", platte: "sauber" }),
  haken({ index: "sauber", platte: "sauber" }),
  haken({ index: "sauber", platte: "fremd-fehler" }),
  haken({ index: "fehler", platte: "probe-fehler" }),
  haken({ index: "kaputt", platte: "sauber" }),
  haken({ index: "fehler", platte: "sauber", skip: true }),
  hakenMit({ [JOURNAL]: DOPPELPARAM }),
  hakenMit({ [KLASSISCH]: DOPPELPARAM }),
  hakenMit({ [JOURNAL]: VFLAG }),
  hakenMit({ "module.json": { ganz: "{ kaputt\n" }, [JOURNAL]: "\n// zz\n" }),
  ladeform(),
  ladeform({ "module.json": modulMitKlassischem }),
  bench({ "v.mjs": "export const r = /[\\p{L}--[a-z]]/v\n" }),
  bench({ "kaputt.mjs": "const = ;\n" }),
  bench({ "doppel.mjs": "export const o = { a: 1, a: 2 }\n" }),
  bench({ "kaputt.mjs": "const = ;\n", "doppel.mjs": "export const o = { a: 1, a: 2 }\n" }),
])
const [eFalsch, eZwei] = await Promise.all([
  // Der Ordnername behauptet die richtige Fassung, package.json nennt eine andere.
  eslintWeg(speicher({ "eslint-10.13.0": "10.12.0" })),
  // Zwei Fundorte mit der richtigen Fassung. NTFS listet ohne Ruecksicht auf
  // Gross und Klein (a vor B), die Sortierung nach Codepunkt nimmt B. So
  // faellt auf, wenn die Bench der Reihenfolge des Dateisystems folgt.
  eslintWeg(speicher({ a: "10.13.0", B: "10.13.0" })),
])
const struktur = baum()
const menge = (r) => r.aus.split("\n").map((z) => z.trim()).filter(Boolean)

for (const f of [f1, f2, f3, f4, f6]) {
  for (const w of ["doppelnamen", "v15"]) {
    if (f[w] === "nicht gemessen") nichtMessbar(`${WAECHTER[w]} meldet NICHT GEMESSEN (kein npx-Zwischenspeicher oder keine Foundry)`)
  }
}
for (const r of [bV, bLeer, bDoppel, bBeides]) {
  if (/Selbstproben|eslint/i.test(r.aus) === false) nichtMessbar(`doppelnamen-bench lief nicht: ${r.aus.slice(0, 200)}`)
}
// VORHAKEN_ZEIG=1 bis 10 zeigt die Ausgabe des Hakens in diesem Fall.
const zeig = [f1, f2, f3, f4, f5, f6, f7, f8, f9, f10][Number(process.env.VORHAKEN_ZEIG) - 1]
if (zeig) console.log(zeig.aus)
if (h1.rc !== 0) console.log(`ladeform ueber HEAD: rc ${h1.rc}\n${h1.aus.slice(0, 400)}`)

p.abschnitt("Kosten: Stubs nur in der Wegwerfkopie")
p.gleich("Kern und Wachendateien in der Kopie sind bytegleich mit den eigenen",
  HAKENDATEIEN.filter((f) => !existsSync(join(struktur.wt, f))
    || readFileSync(join(struktur.wt, f), "utf8") !== readFileSync(join(WURZEL, f), "utf8")).join(", "), "")
p.gleich("es gibt Wachendateien fuer basis, modul und stre",
  ["basis", "modul", "stre"].filter((d) => !HAKENDATEIEN.includes(`tools/haken/wachen/${d}.sh`)).join(", "), "")
// Im Lauf der Kopie muss jede Wachendatei geladen sein und ihre immer laufende
// Wache gefahren haben; sonst liefe der Haken still mit einer Domaene weniger.
p.gleich("im Lauf der Kopie laedt der Kern jede Wachendatei",
  HAKENDATEIEN.slice(1).filter((f) => !f2.aus.includes(`pre-commit: Wachen aus ${f}`)).join(", "), "")
p.gleich("im Lauf der Kopie faehrt basis seine Wache auf jeden Commit", f2.aus.includes("pre-commit: ok  anker.test.mjs"), true)
p.gleich("im Lauf der Kopie faehrt stre seine Wache auf jeden Commit", f2.aus.includes("pre-commit: ok  cloud-login-kennung.test.mjs"), true)
p.gleich("im Lauf der Kopie faehrt modul die Doppelnamenwache", f2.doppelnamen, "ok")
p.gleich("der echte Haken faehrt jeden Pflichtsatz per Namen",
  PFLICHT.filter((s) => !GERUFEN.includes(s)).join(", "), "")
p.gleich("der echte Haken faehrt die Streamsaetze aus dem Index",
  HAKENTEXT.includes("git ls-files -- 'scripts/*.test.mjs'") && /^\s*fahre "\$datei"/m.test(HAKENTEXT), true)
// Die Weiche der Schleife (stre-T-021): Rueckgabe 2 ist NUR bei den
// Vertragssaetzen nicht gemessen, jeder andere Satz bleibt bei fahre.
p.gleich("der echte Haken wertet nur die Vertragssaetze ueber werte_aus",
  /^\s*scripts\/stream\/stream-vertrag-\*\.test\.mjs\)\s*$/m.test(HAKENTEXT)
    && HAKENTEXT.split('werte_aus "$?" "$(basename "$datei")"').length === 2, true)
p.gleich("der echte Haken faehrt jeden anderen Streamsatz ueber fahre",
  /^\s*\*\)\s*\n\s*fahre "\$datei" "\$\(basename "\$datei"\)"\s*\n\s*;;/m.test(HAKENTEXT), true)
p.gleich("der echte Haken faehrt die zwei Wachen echt aus dem Index",
  ["doppelnamen-bench", "v15-globale-bench"].every((w) => HAKENTEXT.includes(`fahre_weich "tools/${w}/bench.mjs"`)), true)
const streamsaetze = struktur.git(["ls-files", "--", "scripts/*.test.mjs"]).split("\n").filter(Boolean)
p.gleich("es gibt Streamsaetze, und jeder ist in der Kopie ein Stub",
  streamsaetze.length > 0 && streamsaetze.every((s) => struktur.stubs.includes(s)), true)
p.gleich("jeder per Namen gefahrene Satz ist in der Kopie ein Stub",
  GERUFEN.filter((s) => existsSync(join(WURZEL, s)) && !struktur.stubs.includes(s)).join(", "), "")
p.gleich("die Stubs liegen nur in der Kopie, nicht im eigenen Baum",
  readFileSync(join(WURZEL, "scripts/creature-installer/anker.test.mjs"), "utf8") !== STUB, true)
p.gleich("der Ladeform-Helfer ist in der Kopie echt", struktur.stubs.includes("tools/haken/ladeform.mjs"), false)

p.abschnitt("Kosten: ESLint aus dem npx-Zwischenspeicher")
p.gleich("falsche Fassung im Zwischenspeicher: Rueckfall npx", eFalsch.aus.trim(), "npx")
p.gleich("richtige Fassung im Zwischenspeicher: Direktstart", eZwei.aus.startsWith("direkt "), true)
p.gleich("zwei Fundorte: immer der erste nach Namen",
  /[\\/]_npx[\\/]B[\\/]node_modules[\\/]eslint[\\/]bin[\\/]eslint\.js\s*$/.test(eZwei.aus), true)

p.abschnitt("W1 Syntax in der Form, in der Foundry laedt")
p.gleich("Doppelparameter im esmodule sperrt", syntaxBefund(f7.aus, JOURNAL), true)
p.gleich("Doppelparameter im esmodule: Haken endet rot", f7.rc, 1)
p.gleich("Doppelparameter in der klassischen Datei: kein Syntaxbefund", syntaxBefund(f8.aus, KLASSISCH), false)
p.gleich("Regex mit v-Flag im esmodule: kein Syntaxbefund", syntaxBefund(f9.aus, JOURNAL), false)
p.gleich("Regex mit v-Flag im esmodule: Haken endet gruen", f9.rc, 0)
p.gleich("Regex mit v-Flag im esmodule: Doppelnamenwache misst", f9.doppelnamen, "ok")
p.gleich("module.json kaputt: Ladeform unbekannt sperrt", f10.aus.includes("pre-commit: ROT  Ladeform unbekannt"), true)
p.gleich("module.json kaputt: die Meldung nennt module.json", f10.aus.includes("module.json der vorgemerkten Fassung nicht lesbar"), true)
p.gleich("module.json kaputt: Haken endet rot", f10.rc, 1)

p.abschnitt("W1 Ladeform-Helfer ueber HEAD")
p.gleich("Helfer endet mit 0", h1.rc, 0)
p.gleich("nur importiert, nicht gelistet: ist Modul", menge(h1).includes("scripts/beneos-asset-repair-dialog.js"), true)
p.gleich("esmodule: ist Modul", menge(h1).includes(JOURNAL), true)
p.gleich("klassisch: ist kein Modul", menge(h1).includes(KLASSISCH), false)
p.gleich("klassisch und zugleich unter esmodules: bleibt klassisch", h2.rc === 0 && !menge(h2).includes(KLASSISCH), true)

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
