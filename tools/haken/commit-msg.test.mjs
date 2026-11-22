/**
 * COMMIT-KENNUNG ALS PFLICHT AUF DEM STAND VON stream-beta (stre-T-047).
 *
 * Der Aufgabenabgleich sieht eine Kennung nur in der Klammer des Betreffs.
 * `tools/haken/commit-msg` sperrt deshalb auf dem Stand von stream-beta jeden
 * Commit ohne gueltige Kennung dort, mit Notweg. main und die Zweige anderer
 * Tabs bleiben unberuehrt: die Huelle erkennt den Stand am Manifest in der
 * vorgemerkten module.json.
 *
 * WIE DIESER SATZ PRUEFT. Die Regel selbst direkt an pruefeBetreff(), dann
 * echte `git commit` und `git merge` in Wegwerfdepots im tmpdir. Dort zeigt
 * `core.hooksPath` auf eine KOPIE des Hakens aus diesem Baum, damit eine
 * Sabotage am Haken greift; das echte Repositorium bleibt unberuehrt.
 *
 * Austritt 2, wenn `git` oder `sh` fehlt: eine Wache, die nicht laufen
 * konnte, ist nicht gruen.
 *
 * Lauf:  node tools/haken/commit-msg.test.mjs
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { pruefstand } from "../lib/foundry-attrappe.mjs"
import { pruefeBetreff } from "./commit-msg.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const BETA = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-module/stream-beta/module.json"
const MAIN = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-module/main/module.json"

function nichtMessbar(grund) {
  console.log(`NICHT MESSBAR: ${grund}`)
  process.exit(2)
}
for (const [befehl, args] of [["git", ["--version"]], ["sh", ["-c", "exit 0"]]]) {
  const r = spawnSync(befehl, args, { windowsHide: true })
  if (r.error || r.status !== 0) nichtMessbar(`${befehl} fehlt`)
}

const temp = []
function wegwerf(name) {
  const d = mkdtempSync(join(tmpdir(), name))
  temp.push(d)
  return d
}
process.on("exit", () => {
  for (const d of temp) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* genannt unten */ }
    if (existsSync(d)) console.log(`REST nicht abgeraeumt: ${d}`)
  }
})

const NAMEN = ["commit-msg", "commit-msg.mjs"]
const HAKEN = wegwerf("kennung-haken-")
for (const n of NAMEN) {
  const q = join(HIER, n)
  if (existsSync(q)) copyFileSync(q, join(HAKEN, n))
}

/*
 * GIT IM SATZ GEHOERT NUR DEN WEGWERFDEPOTS. Der pre-commit-Haken faehrt
 * diesen Satz; dort zeigen GIT_DIR und GIT_INDEX_FILE ins echte Repositorium.
 * Muster wie ohneHakenumgebung() in vorpush.test.mjs.
 */
function ohneHakenumgebung(env) {
  const e = { ...env }
  for (const k of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_PREFIX"]) delete e[k]
  e.GIT_CEILING_DIRECTORIES = tmpdir()
  return e
}
// Eine leere globale Konfiguration: commit.cleanup oder core.commentChar des
// Entwicklers duerfen die Rautenproben nicht verschieben (Kalt-Review stre-T-047).
const LEER_KONFIG = join(wegwerf("kennung-konfig-"), "leer.gitconfig")
writeFileSync(LEER_KONFIG, "")
const UMGEBUNG = {
  ...ohneHakenumgebung(process.env),
  GIT_CONFIG_GLOBAL: LEER_KONFIG,
  GIT_AUTHOR_NAME: "Probe", GIT_AUTHOR_EMAIL: "probe@invalid", GIT_COMMITTER_NAME: "Probe", GIT_COMMITTER_EMAIL: "probe@invalid",
  GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
}
delete UMGEBUNG.BENEOS_COMMIT_NOTWEG
delete UMGEBUNG.BENEOS_IST_MERGE

function git(dir, args, env = {}) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true, env: { ...UMGEBUNG, ...env } })
  return { rc: r.status ?? -1, aus: `${r.stdout || ""}${r.stderr || ""}` }
}
function mussGit(dir, args) {
  const r = git(dir, args)
  if (r.rc !== 0) nichtMessbar(`git ${args.join(" ")}: ${r.aus.trim()}`)
  return r.aus.trim()
}

/** Eine Umgebung, deren PATH kein node kennt, und die sh darin. */
function pfadOhneNode() {
  const trenner = process.platform === "win32" ? ";" : ":"
  const roh = Object.entries(UMGEBUNG).find(([k]) => k.toUpperCase() === "PATH")?.[1] || ""
  const dirs = roh.split(trenner).filter((d) => d && !["node.exe", "node"].some((n) => existsSync(join(d, n))))
  const sh = dirs.map((d) => join(d, process.platform === "win32" ? "sh.exe" : "sh")).find((f) => existsSync(f))
  if (!sh) nichtMessbar("keine sh in einem PATH ohne node")
  const env = Object.fromEntries(Object.entries(UMGEBUNG).filter(([k]) => k.toUpperCase() !== "PATH"))
  env.PATH = dirs.join(trenner)
  return { sh, env }
}

const modul = (manifest) => `${JSON.stringify({ id: "beneos-module", version: "14.5.0-beta.12", manifest }, null, 2)}\n`

/*
 * Vorlage: ein Depot auf dem Stand von stream-beta, der erste Commit entsteht
 * VOR dem Setzen des Hakens. Jeder Fall bekommt eine Kopie; ein git-Aufruf
 * kostet unter Windows rund 70 ms.
 */
const VORLAGE = (() => {
  const w = wegwerf("kennung-vorlage-")
  mussGit(w, ["init", "-q", "-b", "stream-beta"])
  mussGit(w, ["config", "core.autocrlf", "false"])
  writeFileSync(join(w, "module.json"), modul(BETA))
  mussGit(w, ["add", "module.json"])
  mussGit(w, ["commit", "-q", "-m", "feat(stre-T-001): Anfang"])
  mussGit(w, ["config", "core.hooksPath", HAKEN])
  return w
})()
function depot() {
  const w = wegwerf("kennung-depot-")
  cpSync(VORLAGE, w, { recursive: true })
  return w
}
let lauf = 0
/*
 * Ein gesperrter Commit laesst a.txt vorgemerkt zurueck; ein spaeteres
 * checkout in demselben Fall scheiterte daran, und unter einer Sabotage meldete
 * der Satz dann NICHT MESSBAR statt rot. Darum wird nach einem gesperrten
 * Commit der Index zurueckgesetzt.
 */
function commit(w, betreff, env = {}) {
  lauf += 1
  writeFileSync(join(w, "a.txt"), `${lauf}\n`)
  mussGit(w, ["add", "a.txt"])
  const r = git(w, ["commit", "-q", "-m", betreff], env)
  if (r.rc !== 0) {
    // Ohne HEAD (erster Commit) gibt es nichts zurueckzusetzen, nur den Index zu leeren.
    if (git(w, ["rev-parse", "-q", "--verify", "HEAD"]).rc === 0) mussGit(w, ["reset", "-q", "--hard", "HEAD"])
    else mussGit(w, ["rm", "-q", "--cached", "a.txt"])
  }
  return r
}
/** Einrichtung eines Falls: am Riegel vorbei, damit eine Sabotage den Aufbau nicht bricht. */
function vorbei(w, pfad, inhalt, betreff) {
  writeFileSync(join(w, pfad), inhalt)
  mussGit(w, ["add", pfad])
  mussGit(w, ["-c", "core.hooksPath=", "commit", "-q", "-m", betreff])
}
const durch = (r) => r.rc === 0
const sperrt = (r) => r.rc !== 0 && r.aus.includes("commit-msg:")

const p = pruefstand("betreffkennung: Commit-Kennung als Pflicht auf dem Stand von stream-beta (stre-T-047)")

p.abschnitt("Die Regel")
for (const [betreff, soll] of [
  ["fix(stre-T-047): x", true],
  ["i18n(stre-T-120): x", true],
  ["feat(stre-T-001, stre-T-002): x", true],
  ["feat(stream, stre-T-165): x", true],
  ["fix(stre-T-047)!: x", true],
  ["fix(OP-PRJ-126): x", true],
  ["fix(RG-2): x", true],
  ["docs(TC-PRJ-STR-264): x", true],
  ["merge(stre-T-028): x", true],
  ["chore(stre-T-047): 14.5.0-beta.13", true],
  ["fix(cla-T-005): x", true],
  // Ein Merge-Betreff ist ohne MERGE_HEAD keine Ausnahme (Nacharbeit stre-T-047).
  ["Merge branch 'seite' into stream-beta", false],
  ["fixup! fix: x", true],
  ["squash! fix: x", true],
  ["amend! fix: x", true],
  ["Revert \"fix: x\"", true],
  ["fix: x", false],
  ["fix(stream): stre-T-154 x", false],
  ["x [stre-T-156]", false],
  ["fix(T-056): x", false],
  ["stre-T-134: x", false],
  ["fix(stre-T-47): x", false],
  ["chore(version): x", false],
  ["fix(stre-T-122-review): x", false],
  ["Fix(stre-T-047): x", false],
  ["fix(stre-T-047):x", false],
  ["OP-PRJ-046: x", false],
  // Grenzen der Kennungen (Kalt-Review stre-T-047)
  ["fix(abcdef-T-047): x", false],
  ["fix(s-T-047): x", false],
  ["fix(STRE-T-047): x", false],
  ["fix(OP-P-1): x", false],
  ["fix(OP-PROJE-1): x", false],
  ["fix(OP-prj-1): x", false],
  ["fix(RG-): x", false],
  ["1fix(stre-T-047): x", false],
  ["fix(stream stre-T-165): x", false],
]) p.gleich(`${soll ? "geht durch" : "sperrt"}: ${betreff}`, pruefeBetreff(betreff).ok, soll)
p.gleich("Kommentarzeilen zaehlen nicht als Betreff", pruefeBetreff("# fix(stre-T-047): x\nfix: x\n").ok, false)
p.gleich("eine Kommentarzeile vor dem Betreff stoert nicht", pruefeBetreff("# Hinweis\n\nfix(stre-T-047): x\n").ok, true)
p.gleich("ohne Editor zaehlt eine Rautenzeile als Betreff", pruefeBetreff("# Hinweis\n\nfix(stre-T-047): x\n", false, false).ok, false)
p.gleich("ein Merge-Betreff mit MERGE_HEAD geht durch", pruefeBetreff("Merge branch 'seite' into stream-beta", true).ok, true)
p.gleich("ein Merge geht ohne Kennung durch", pruefeBetreff("merge: x", true).ok, true)
p.gleich("ohne Merge sperrt derselbe Betreff", pruefeBetreff("merge: x", false).ok, false)
p.gleich("eine leere Nachricht geht durch", pruefeBetreff("").ok, true)
p.gleich("eine reine Kommentarnachricht geht durch", pruefeBetreff("# nur Kommentar\n").ok, true)
// Gleichlauf mit der Python-Regel in beneos-stream-beta (tools/commit_kennung.py):
// dieselbe Tabelle steht dort in test_commit_kennung.py. Zeilen nur an LF und
// CRLF wie git, Leerraum und Ziffern nur ASCII.
for (const [name, nachricht, editor, soll] of [
  ["Kommentarzeile mit CR, mit Editor", "# c\rfix(stre-T-047): y\nchore: x\n", true, false],
  ["Kommentarzeile mit U+2028, mit Editor", "# c fix(stre-T-047): y\nchore: x\n", true, false],
  ["Seitenvorschub vor dem Betreff, ohne Editor", "\ffix(stre-T-047): y\n", false, false],
  ["Unicode-Ziffern in der Kennung", "fix(stre-T-٠٤٧): x\n", true, false],
  ["Zeile nur aus BOM vor dem Betreff", "﻿\nfix(stre-T-047): x\n", true, false],
  ["geschuetztes Leerzeichen nach dem Doppelpunkt", "fix(stre-T-047):  x\n", true, true],
]) p.gleich(`Gleichlauf ${soll ? "geht durch" : "sperrt"}: ${name}`, pruefeBetreff(nachricht, false, editor).ok, soll)

p.abschnitt("Echte Commits, die durchgehen")
{
  const w = depot()
  p.gleich("Commit mit Kennung geht durch", durch(commit(w, "fix(stre-T-047): x")), true)
}
{
  const w = depot()
  p.gleich("fixup per git commit -m geht durch", durch(commit(w, "fixup! fix(stre-T-001): Anfang")), true)
}
{
  const w = depot()
  p.gleich("Revert per git commit -m geht durch", durch(commit(w, "Revert \"fix: x\"")), true)
}
{
  // Ein echter Merge mit kleinem `merge: x` in einem verknuepften
  // Arbeitsbaum. Er geht nur ueber MERGE_HEAD durch, nicht ueber die
  // Betreff-Ausnahme, und MERGE_HEAD liegt dort in .git/worktrees/<name>/.
  const w = depot()
  mussGit(w, ["checkout", "-q", "-b", "seite"])
  vorbei(w, "a.txt", "seite\n", "fix(stre-T-002): seite")
  mussGit(w, ["checkout", "-q", "stream-beta"])
  vorbei(w, "b.txt", "b\n", "fix(stre-T-003): haupt")
  const baum = join(wegwerf("kennung-baum-"), "zelle")
  mussGit(w, ["worktree", "add", "-q", "-b", "zelle", baum, "stream-beta"])
  p.gleich("ein echter Merge 'merge: x' im Arbeitsbaum geht durch", durch(git(baum, ["merge", "--no-ff", "-q", "-m", "merge: x", "seite"])), true)
}
{
  // Gegenwert zu "Merge irgendwas ohne Kennung": derselbe Betreffanfang als
  // echter Merge mit dem Standardbetreff von git geht ueber MERGE_HEAD durch.
  const w = depot()
  mussGit(w, ["checkout", "-q", "-b", "seite"])
  vorbei(w, "a.txt", "seite\n", "fix(stre-T-002): seite")
  mussGit(w, ["checkout", "-q", "stream-beta"])
  vorbei(w, "b.txt", "b\n", "fix(stre-T-003): haupt")
  p.gleich("ein echter Merge mit Standardbetreff geht durch", durch(git(w, ["merge", "--no-ff", "--no-edit", "-q", "seite"])), true)
}
{
  // Gegenwert zu "-m '#ohne Kennung'": mit Editor raeumt git die Rautenzeile
  // nach dem Haken weg, ein gueltiger Betreff darunter geht durch.
  const w = depot()
  writeFileSync(join(w, "a.txt"), "editor\n")
  mussGit(w, ["add", "a.txt"])
  const f = join(wegwerf("kennung-nachricht-"), "n.txt")
  writeFileSync(f, "# Hinweis\nfix(stre-T-047): x\n")
  p.gleich("mit Editor geht eine Rautenzeile vor gueltigem Betreff durch", durch(git(w, ["commit", "-q", "-e", "-F", f], { GIT_EDITOR: "true" })), true)
}
{
  // Gegenwert zu commit.cleanup=whitespace: der ausdrueckliche Standard aendert nichts.
  const w = depot()
  writeFileSync(join(w, "a.txt"), "editor\n")
  mussGit(w, ["add", "a.txt"])
  const f = join(wegwerf("kennung-nachricht-"), "n.txt")
  writeFileSync(f, "# Hinweis\nfix(stre-T-047): x\n")
  p.gleich("mit Editor und commit.cleanup=default geht eine Rautenzeile vor gueltigem Betreff durch", durch(git(w, ["-c", "commit.cleanup=default", "commit", "-q", "-e", "-F", f], { GIT_EDITOR: "true" })), true)
}
{
  const w = depot()
  mussGit(w, ["checkout", "-q", "-b", "main"])
  writeFileSync(join(w, "module.json"), modul(MAIN))
  mussGit(w, ["add", "module.json"])
  p.gleich("auf einem Stand mit main-Manifest geht ein Commit ohne Kennung durch", durch(git(w, ["commit", "-q", "-m", "fix: main"])), true)
}
{
  // Freigabe: main nimmt stream-beta auf und behaelt sein Manifest.
  const w = depot()
  mussGit(w, ["checkout", "-q", "-b", "main"])
  writeFileSync(join(w, "module.json"), modul(MAIN))
  mussGit(w, ["add", "module.json"])
  mussGit(w, ["-c", "core.hooksPath=", "commit", "-q", "-m", "main"])
  mussGit(w, ["checkout", "-q", "stream-beta"])
  vorbei(w, "b.txt", "beta\n", "fix(stre-T-004): beta")
  mussGit(w, ["checkout", "-q", "main"])
  mussGit(w, ["-c", "core.hooksPath=", "merge", "-q", "-s", "ours", "-m", "Merge stream-beta", "stream-beta"])
  p.gleich("nach der Freigabe geht auf main ein Commit ohne Kennung durch", durch(commit(w, "fix: nach Freigabe")), true)
  mussGit(w, ["checkout", "-q", "stream-beta"])
  p.gleich("nach der Freigabe sperrt auf stream-beta ein Commit ohne Kennung", sperrt(commit(w, "fix: nach Freigabe")), true)
}
{
  const w = wegwerf("kennung-leer-")
  mussGit(w, ["init", "-q", "-b", "stream-beta"])
  mussGit(w, ["config", "core.hooksPath", HAKEN])
  p.gleich("ein erster Commit ohne module.json geht durch", durch(commit(w, "fix: Anfang")), true)
}

p.abschnitt("Echte Commits, die sperren")
// "#ohne Kennung" und "Merge irgendwas ohne Kennung": Nacharbeit stre-T-047,
// beide kamen vorher durch (nachgestellt am 22.11.2026 auf 372c876).
for (const betreff of ["fix: x", "fix(stream): stre-T-154 x", "fix(stre-T-47): x", "chore(version): 14.5.0-beta.13", "#ohne Kennung", "Merge irgendwas ohne Kennung"]) {
  const w = depot()
  p.gleich(`echter Commit sperrt: ${betreff}`, sperrt(commit(w, betreff)), true)
}
{
  const w = depot()
  mussGit(w, ["checkout", "-q", "-b", "seite"])
  vorbei(w, "a.txt", "seite\n", "fix(stre-T-002): seite")
  mussGit(w, ["checkout", "-q", "stream-beta"])
  vorbei(w, "b.txt", "b\n", "fix(stre-T-003): haupt")
  const r = git(w, ["merge", "--squash", "-q", "seite"])
  if (r.rc !== 0) nichtMessbar(`merge --squash: ${r.aus.trim()}`)
  p.gleich("nach merge --squash ist der Commit kein Merge und sperrt", sperrt(git(w, ["commit", "-q", "-m", "merge: x"])), true)
}
{
  // Eine Marke namens MERGE_HEAD ist kein Merge (Nacharbeit stre-T-047).
  const w = depot()
  mussGit(w, ["tag", "MERGE_HEAD"])
  p.gleich("echter Commit sperrt bei einer Marke namens MERGE_HEAD", sperrt(commit(w, "fix: x")), true)
}
// Mit Editor, aber einer Einstellung, unter der git die Rautenzeile behaelt:
// dann ist sie der gespeicherte Betreff (Kalt-Review stre-T-047, zweite Runde).
for (const [name, konfig] of [["commit.cleanup=whitespace", "commit.cleanup=whitespace"], ["commit.cleanup=verbatim", "commit.cleanup=verbatim"], ["core.commentChar=;", "core.commentChar=;"]]) {
  const w = depot()
  writeFileSync(join(w, "a.txt"), "editor\n")
  mussGit(w, ["add", "a.txt"])
  const f = join(wegwerf("kennung-nachricht-"), "n.txt")
  writeFileSync(f, "# ohne Kennung\nfix(stre-T-047): x\n")
  p.gleich(`echter Commit mit Editor sperrt unter ${name}: Rautenzeile bleibt Betreff`, sperrt(git(w, ["-c", konfig, "commit", "-q", "-e", "-F", f], { GIT_EDITOR: "true" })), true)
}
{
  // Die Sperrmeldung nennt die Nachrichtendatei des Arbeitsbaums, im
  // verknuepften Arbeitsbaum also .git/worktrees/<name>/COMMIT_EDITMSG.
  const w = depot()
  const haupt = commit(w, "fix: x")
  p.gleich("die Sperrmeldung nennt im Hauptbaum .git/COMMIT_EDITMSG", sperrt(haupt) && haupt.aus.includes(".git/COMMIT_EDITMSG"), true)
  const baum = join(wegwerf("kennung-meldung-baum-"), "zelle")
  mussGit(w, ["worktree", "add", "-q", "-b", "zelle", baum, "stream-beta"])
  const r = commit(baum, "fix: x")
  p.gleich("die Sperrmeldung nennt im verknuepften Arbeitsbaum dessen COMMIT_EDITMSG", sperrt(r) && r.aus.includes("worktrees/zelle/COMMIT_EDITMSG"), true)
}
{
  const w = depot()
  writeFileSync(join(w, "c.txt"), "c\n")
  mussGit(w, ["add", "c.txt"])
  const ohneNode = pfadOhneNode()
  const nachricht = join(w, "nachricht.txt")
  writeFileSync(nachricht, "fix(stre-T-047): x\n")
  const r = spawnSync(ohneNode.sh, [join(HAKEN, "commit-msg"), nachricht], { cwd: w, encoding: "utf8", windowsHide: true, env: ohneNode.env })
  p.gleich("ohne node sperrt der aktive Riegel", r.status !== 0 && String(r.stderr).includes("node fehlt"), true)
}
{
  const w = wegwerf("kennung-ohnenode-")
  mussGit(w, ["init", "-q", "-b", "main"])
  writeFileSync(join(w, "module.json"), modul(MAIN))
  mussGit(w, ["add", "module.json"])
  const ohneNode = pfadOhneNode()
  const nachricht = join(w, "nachricht.txt")
  writeFileSync(nachricht, "fix: x\n")
  const r = spawnSync(ohneNode.sh, [join(HAKEN, "commit-msg"), nachricht], { cwd: w, encoding: "utf8", windowsHide: true, env: ohneNode.env })
  p.gleich("ohne node schweigt der Riegel auf einem main-Stand", r.status, 0)
}

p.abschnitt("Notweg")
{
  const w = depot()
  p.gleich("Notweg mit Begruendung geht durch", durch(commit(w, "fix: x", { BENEOS_COMMIT_NOTWEG: "Probe Notweg 4711" })), true)
  const log = join(mussGit(w, ["rev-parse", "--absolute-git-dir"]), "beneos-commit-notweg.log")
  const zeile = existsSync(log) ? readFileSync(log, "utf8") : ""
  p.gleich("der Notweg steht mit Begruendung im Log", zeile.includes("Probe Notweg 4711"), true)
  p.gleich("der Notweg nennt im Log den Betreff", zeile.includes("| fix: x |"), true)
}
{
  const w = depot()
  p.gleich("Notweg ohne Begruendung sperrt", sperrt(commit(w, "fix: x", { BENEOS_COMMIT_NOTWEG: "   " })), true)
}
{
  const w = depot()
  mkdirSync(join(mussGit(w, ["rev-parse", "--absolute-git-dir"]), "beneos-commit-notweg.log"))
  const r = commit(w, "fix: x", { BENEOS_COMMIT_NOTWEG: "Probe Notweg 4712" })
  p.gleich("Notweg ohne schreibbares Log sperrt", r.rc !== 0 && r.aus.includes("nicht mitschreibbar"), true)
}
{
  // Im verknuepften Arbeitsbaum: das Log liegt im gemeinsamen git-Ordner, und
  // ein zweiter Notweg haengt an, statt den ersten zu ueberschreiben.
  const w = depot()
  const baum = join(wegwerf("kennung-notweg-baum-"), "zelle")
  mussGit(w, ["worktree", "add", "-q", "-b", "notweg", baum, "stream-beta"])
  commit(baum, "fix: eins", { BENEOS_COMMIT_NOTWEG: "Probe Notweg 4713" })
  commit(baum, "fix: zwei", { BENEOS_COMMIT_NOTWEG: "Probe Notweg 4714" })
  const log = join(mussGit(w, ["rev-parse", "--absolute-git-dir"]), "beneos-commit-notweg.log")
  const text = existsSync(log) ? readFileSync(log, "utf8") : ""
  p.gleich("im Arbeitsbaum steht der Notweg im gemeinsamen git-Ordner", text.includes("Probe Notweg 4713"), true)
  p.gleich("ein zweiter Notweg haengt an", text.includes("Probe Notweg 4713") && text.includes("Probe Notweg 4714"), true)
}

p.abschnitt("Die Bruecke, wirklich gefahren")
{
  const bruecke = wegwerf("kennung-bruecke-")
  const vorlage = join(HIER, "bruecke-commit-msg")
  if (existsSync(vorlage)) copyFileSync(vorlage, join(bruecke, "commit-msg"))
  {
    const w = depot()
    mussGit(w, ["config", "core.hooksPath", bruecke])
    p.gleich("die Bruecke schweigt auf einem Stand ohne den Riegel", durch(commit(w, "fix: x")), true)
  }
  {
    const w = depot()
    mussGit(w, ["config", "core.hooksPath", bruecke])
    mkdirSync(join(w, "tools", "haken"), { recursive: true })
    for (const n of NAMEN) if (existsSync(join(HAKEN, n))) copyFileSync(join(HAKEN, n), join(w, "tools", "haken", n))
    p.gleich("die Bruecke schweigt bei einer unversionierten Kopie des Riegels", durch(commit(w, "fix: x")), true)
    mussGit(w, ["add", "tools"])
    mussGit(w, ["-c", "core.hooksPath=", "commit", "-q", "-m", "feat(stre-T-047): Riegel"])
    p.gleich("die Bruecke ruft den versionierten Riegel des Stands", sperrt(commit(w, "fix: x")), true)
    mussGit(w, ["rm", "-q", "--cached", "tools/haken/commit-msg"])
    p.gleich("die Bruecke sperrt, wenn HEAD den Riegel kennt und der Index ihn verliert", sperrt(commit(w, "fix: x")), true)
  }
}

p.abschnitt("Der Satz selbst")
{
  // Koeder: ein Repositorium, auf das eine geerbte GIT_DIR zeigt. Ein
  // `init` mit der bereinigten Umgebung darf es nicht anfassen.
  const koeder = wegwerf("kennung-koeder-")
  mussGit(koeder, ["init", "-q"])
  const ziel = wegwerf("kennung-ziel-")
  spawnSync("git", ["-C", ziel, "init", "-q", "--bare"], { windowsHide: true, env: ohneHakenumgebung({ ...UMGEBUNG, GIT_DIR: join(koeder, ".git") }) })
  p.gleich("eine geerbte GIT_DIR erreicht das echte Repositorium nicht", git(koeder, ["config", "--get", "core.bare"]).aus.trim(), "false")
}

p.ende()
