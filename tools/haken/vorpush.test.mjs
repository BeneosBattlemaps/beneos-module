/**
 * DER PUSH AUF stream-beta LIEFERT NUR MIT VERSIONSSPRUNG UND TAG AUS
 * (stre-T-028, OP-CLA-017).
 *
 * Bis stre-T-028 zeigte `download` in der `module.json` von stream-beta auf
 * das Zweig-ZIP. Jeder Push tauschte damit, was Betatester laden, und liess
 * die Version stehen: seit 14.5.0-beta.11 gingen ueber hundert Commits so
 * hinaus, ohne dass Foundry ein Update anbot. Entscheid des Betreibers vom
 * 21.11.2026: Push und Auslieferung trennen. `download` zeigt wie auf main auf
 * das ZIP eines Tags, und `tools/haken/pre-push` sperrt jeden Push auf
 * stream-beta, der ausliefern wuerde, ohne dass Version, Tag und Adressen
 * zusammenpassen. Ein Push ohne Versionssprung liefert nichts aus und geht
 * durch; das ist der Fast-Forward des Orchestrators.
 *
 * WIE DIESER SATZ PRUEFT. Je Fall ein nacktes Ferndepot und ein Klon im
 * tmpdir. Im Klon zeigt `core.hooksPath` auf eine KOPIE des Hakens aus diesem
 * Baum, damit eine Sabotage am Haken greift; das echte Repositorium bleibt
 * unberuehrt. Gepusht wird wirklich, `git push` ruft den Haken.
 *
 * Austritt 2, wenn `git` oder `sh` fehlt: eine Wache, die nicht laufen
 * konnte, ist nicht gruen.
 *
 * Lauf:  node tools/haken/vorpush.test.mjs
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync, spawnSync } from "node:child_process"
import { pruefstand } from "../lib/foundry-attrappe.mjs"
import { hauptlauf } from "./pre-push.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = resolve(HIER, "../..")
const BASIS = "https://github.com/BeneosBattlemaps/beneos-module"
const MANIFEST = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-module/stream-beta/module.json"
const tagZip = (v) => `${BASIS}/archive/refs/tags/${v}.zip`
const ZWEIG_ZIP = `${BASIS}/archive/refs/heads/stream-beta.zip`

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

// Der Haken aus DIESEM Baum, in einen eigenen Hakenordner kopiert.
const HAKEN = wegwerf("vorpush-haken-")
for (const n of ["pre-push", "pre-push.mjs"]) {
  const q = join(HIER, n)
  if (existsSync(q)) copyFileSync(q, join(HAKEN, n))
}

/*
 * GIT IM SATZ GEHOERT NUR DEN WEGWERFDEPOTS. Der pre-commit-Haken faehrt
 * diesen Satz; dort zeigen GIT_DIR und GIT_INDEX_FILE ins echte Repositorium,
 * und schon das erste `init --bare` schriebe core.bare=true in dessen geteilte
 * Konfiguration (Kalt-Review stre-T-028). Muster wie gitUmgebung() in
 * tools/bench-sabotagen.mjs.
 */
function ohneHakenumgebung(env) {
  const e = { ...env }
  for (const k of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_PREFIX"]) delete e[k]
  e.GIT_CEILING_DIRECTORIES = tmpdir()
  return e
}
const UMGEBUNG = {
  ...ohneHakenumgebung(process.env),
  GIT_AUTHOR_NAME: "Probe", GIT_AUTHOR_EMAIL: "probe@invalid", GIT_COMMITTER_NAME: "Probe", GIT_COMMITTER_EMAIL: "probe@invalid",
  GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
}
delete UMGEBUNG.BENEOS_PUSH_NOTWEG

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

function modul(version, { download = tagZip(version), manifest = MANIFEST } = {}) {
  return `${JSON.stringify({ id: "beneos-module", version, manifest, download }, null, 2)}\n`
}
function schreibe(w, pfad, inhalt, nachricht) {
  writeFileSync(join(w, pfad), inhalt)
  mussGit(w, ["add", pfad])
  mussGit(w, ["commit", "-q", "-m", nachricht])
  return mussGit(w, ["rev-parse", "HEAD"])
}

/*
 * Ein Ferndepot mit stream-beta auf 14.5.0-beta.12 samt Tag, ein Klon mit
 * dem Haken. Der Anfangsstand wird VOR dem Setzen des Hakens gepusht.
 *
 * Gebaut wird er EINMAL als Vorlage, jeder Fall bekommt eine Kopie. Jeder
 * git-Aufruf kostet unter Windows rund 70 ms, ein Push mit Haken mehrere
 * Aufrufe; je Fall neu gebaut lief der Satz 95 s.
 */
const VORLAGE = (() => {
  const fern = wegwerf("vorpush-vfern-")
  mussGit(fern, ["init", "-q", "--bare"])
  const w = wegwerf("vorpush-vklon-")
  mussGit(w, ["init", "-q", "-b", "stream-beta"])
  mussGit(w, ["config", "core.autocrlf", "false"])
  mussGit(w, ["remote", "add", "origin", fern])
  schreibe(w, "module.json", modul("14.5.0-beta.12"), "beta.12")
  mussGit(w, ["tag", "14.5.0-beta.12"])
  mussGit(w, ["push", "-q", "origin", "stream-beta", "refs/tags/14.5.0-beta.12"])
  mussGit(w, ["config", "core.hooksPath", HAKEN])
  return { fern, w }
})()
function depot() {
  const fern = wegwerf("vorpush-fern-")
  const w = wegwerf("vorpush-klon-")
  cpSync(VORLAGE.fern, fern, { recursive: true })
  cpSync(VORLAGE.w, w, { recursive: true })
  mussGit(w, ["remote", "set-url", "origin", fern])
  return { fern, w }
}
function push(w, args, env = {}) { return git(w, ["push", "origin", ...args], env) }
const durch = (r) => r.rc === 0
const sperrt = (r, code) => r.rc !== 0 && r.aus.includes(`[${code}]`)

const p = pruefstand("vorpush: Push auf stream-beta nur mit Versionssprung und Tag (stre-T-028)")

p.abschnitt("Was durchgeht")
{
  const { w } = depot()
  mussGit(w, ["checkout", "-q", "-b", "main"])
  schreibe(w, "module.json", modul("14.4.99", { download: ZWEIG_ZIP, manifest: "https://example.invalid/x.json" }), "main")
  p.gleich("ein Push auf main geht durch, gleich was in module.json steht", durch(push(w, ["main"])), true)
}
{
  // Die sh-Huelle filtert main schon vor node; der Fruehausgang im Haken
  // selbst bleibt die zweite Schicht und wird hier ohne Huelle geprueft. Der
  // Commit existiert nicht: ohne Fruehausgang waere das ein S1.
  const sha = "1".repeat(40)
  p.gleich("der Haken selbst laesst main durch, auch ohne die Huelle", hauptlauf("origin", `refs/heads/main ${sha} refs/heads/main ${sha}\n`, {}), 0)
}
{
  const { w } = depot()
  schreibe(w, "a.txt", "a\n", "ohne Versionssprung")
  p.gleich("Fast-Forward ohne Versionssprung geht durch", durch(push(w, ["stream-beta"])), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.13"), "beta.13")
  mussGit(w, ["tag", "-a", "-m", "beta.13", "14.5.0-beta.13"])
  p.gleich("Versionssprung mit Tag im selben Push geht durch", durch(push(w, ["stream-beta", "refs/tags/14.5.0-beta.13"])), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.13"), "beta.13")
  mussGit(w, ["tag", "14.5.0-beta.13"])
  const t = push(w, ["refs/tags/14.5.0-beta.13"])
  p.gleich("ein Tag allein geht durch", durch(t), true)
  p.gleich("Versionssprung mit Tag schon auf origin geht durch", durch(push(w, ["stream-beta"])), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.1"), "Freigabe")
  mussGit(w, ["tag", "14.5.1"])
  p.gleich("von der Beta zur naechsten Freigabe ist ein Sprung", durch(push(w, ["stream-beta", "refs/tags/14.5.1"])), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.13"), "beta.13")
  mussGit(w, ["tag", "14.5.0-beta.13"])
  schreibe(w, "a.txt", "a\n", "danach")
  p.gleich("Tag im Push auf einem Vorfahren des Kopfs geht durch", durch(push(w, ["stream-beta", "refs/tags/14.5.0-beta.13"])), true)
}
{
  const { w } = depot()
  mussGit(w, ["checkout", "-q", "-b", "main"])
  schreibe(w, "module.json", modul("14.4.99", { download: ZWEIG_ZIP }), "main")
  const ohneNode = pfadOhneNode()
  const r = spawnSync(ohneNode.sh, [join(HIER, "pre-push"), "origin", "x"], { input: "refs/heads/main 1111 refs/heads/main 2222\n", encoding: "utf8", windowsHide: true, env: ohneNode.env })
  p.gleich("ohne node geht ein Push auf main durch", r.status, 0)
}

p.abschnitt("Was sperrt")
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0"), "Freigabe nach Beta")
  mussGit(w, ["tag", "14.5.0"])
  p.gleich("14.5.0 nach 14.5.0-beta.12 sperrt, Foundry saehe kein Update", sperrt(push(w, ["stream-beta", "refs/tags/14.5.0"]), "S3"), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.13"), "beta.13")
  mussGit(w, ["tag", "14.5.0-beta.13"])
  push(w, ["refs/tags/14.5.0-beta.13"])
  schreibe(w, "a.txt", "a\n", "danach")
  mussGit(w, ["tag", "-f", "14.5.0-beta.13"])
  p.gleich("Tag im Push, auf origin aber auf anderem Commit, sperrt", sperrt(push(w, ["stream-beta", "refs/tags/14.5.0-beta.13"]), "S4"), true)
}
{
  const ohneNode = pfadOhneNode()
  const r = spawnSync(ohneNode.sh, [join(HIER, "pre-push"), "origin", "x"], { input: "refs/heads/stream-beta 1111 refs/heads/stream-beta 2222\n", encoding: "utf8", windowsHide: true, env: ohneNode.env })
  p.gleich("ohne node sperrt ein Push auf stream-beta", r.status !== 0 && String(r.stderr).includes("node fehlt"), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.13"), "beta.13")
  p.gleich("Versionssprung ohne Tag sperrt", sperrt(push(w, ["stream-beta"]), "S4"), true)
}
{
  const { w } = depot()
  mussGit(w, ["tag", "14.5.0-beta.13"])
  schreibe(w, "module.json", modul("14.5.0-beta.13"), "beta.13")
  p.gleich("Tag auf einem Commit mit anderer Version sperrt", sperrt(push(w, ["stream-beta", "refs/tags/14.5.0-beta.13"]), "S4"), true)
}
{
  const { w } = depot()
  mussGit(w, ["checkout", "-q", "-b", "seite"])
  schreibe(w, "module.json", modul("14.5.0-beta.13"), "Seitenzweig")
  mussGit(w, ["tag", "14.5.0-beta.13"])
  mussGit(w, ["checkout", "-q", "stream-beta"])
  schreibe(w, "module.json", modul("14.5.0-beta.13"), "beta.13")
  p.gleich("Tag ausserhalb der gepushten Geschichte sperrt", sperrt(push(w, ["stream-beta", "refs/tags/14.5.0-beta.13"]), "S4"), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.11"), "zurueck")
  mussGit(w, ["tag", "14.5.0-beta.11"])
  p.gleich("niedrigere Version sperrt", sperrt(push(w, ["stream-beta", "refs/tags/14.5.0-beta.11"]), "S3"), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.012"), "anders geschrieben")
  mussGit(w, ["tag", "14.5.0-beta.012"])
  p.gleich("dieselbe Zahl anders geschrieben sperrt", sperrt(push(w, ["stream-beta", "refs/tags/14.5.0-beta.012"]), "S3"), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.12", { download: ZWEIG_ZIP }), "Zweig-ZIP")
  p.gleich("download auf dem Zweig-ZIP sperrt", sperrt(push(w, ["stream-beta"]), "S1"), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.12", { download: tagZip("14.5.0-beta.11") }), "falscher Tag")
  p.gleich("download auf einem anderen Tag als der Version sperrt", sperrt(push(w, ["stream-beta"]), "S1"), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.12", { manifest: MANIFEST.replace("stream-beta", "main") }), "manifest")
  p.gleich("geaendertes manifest sperrt", sperrt(push(w, ["stream-beta"]), "S2"), true)
}
{
  const { w } = depot()
  writeFileSync(join(w, "module.json"), "{ kaputt\n")
  mussGit(w, ["add", "module.json"])
  mussGit(w, ["commit", "-q", "-m", "kaputt"])
  p.gleich("unlesbare module.json sperrt", sperrt(push(w, ["stream-beta"]), "S1"), true)
}
{
  const { fern, w } = depot()
  const w2 = wegwerf("vorpush-zweit-")
  mussGit(w2, ["clone", "-q", "-b", "stream-beta", fern, "."])
  schreibe(w2, "b.txt", "b\n", "fremd")
  mussGit(w2, ["push", "-q", "origin", "stream-beta"])
  schreibe(w, "a.txt", "a\n", "eigen")
  p.gleich("unbekannter Fernstand sperrt", sperrt(push(w, ["--force", "stream-beta"]), "S5"), true)
}
{
  const { w } = depot()
  p.gleich("Loeschen von stream-beta sperrt", sperrt(push(w, [":stream-beta"]), "S5"), true)
}

p.abschnitt("Notweg")
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.12", { download: ZWEIG_ZIP }), "Zweig-ZIP")
  const r = push(w, ["stream-beta"], { BENEOS_PUSH_NOTWEG: "Probe Notweg 4711" })
  p.gleich("Notweg mit Begruendung geht durch", durch(r), true)
  const log = join(mussGit(w, ["rev-parse", "--absolute-git-dir"]), "beneos-push-notweg.log")
  const zeile = existsSync(log) ? readFileSync(log, "utf8") : ""
  p.gleich("der Notweg steht mit Begruendung im Log", zeile.includes("Probe Notweg 4711"), true)
  p.gleich("der Notweg nennt im Log den Sperrgrund", zeile.includes("[S1]"), true)
}
{
  const { w } = depot()
  schreibe(w, "module.json", modul("14.5.0-beta.12", { download: ZWEIG_ZIP }), "Zweig-ZIP")
  p.gleich("Notweg ohne Begruendung sperrt", sperrt(push(w, ["stream-beta"], { BENEOS_PUSH_NOTWEG: "   " }), "S1"), true)
}
{
  const { w } = depot()
  mkdirSync(join(mussGit(w, ["rev-parse", "--absolute-git-dir"]), "beneos-push-notweg.log"))
  schreibe(w, "module.json", modul("14.5.0-beta.12", { download: ZWEIG_ZIP }), "Zweig-ZIP")
  const r = push(w, ["stream-beta"], { BENEOS_PUSH_NOTWEG: "Probe Notweg 4712" })
  p.gleich("Notweg ohne schreibbares Log sperrt", r.rc !== 0 && r.aus.includes("nicht mitschreibbar"), true)
}

p.abschnitt("Die Bruecke, wirklich gefahren")
{
  // Die Vorlage als pre-push in einem eigenen Hakenordner, wie sie in
  // .git/hooks liegt. Sie ruft den Haken des Stands, den sie im Klon findet.
  const bruecke = wegwerf("vorpush-bruecke-")
  const vorlage = join(HIER, "bruecke-pre-push")
  if (existsSync(vorlage)) copyFileSync(vorlage, join(bruecke, "pre-push"))
  {
    const { w } = depot()
    mussGit(w, ["config", "core.hooksPath", bruecke])
    schreibe(w, "module.json", modul("14.5.0-beta.13"), "beta.13 ohne Tag")
    p.gleich("die Bruecke schweigt auf einem Stand ohne den Haken", durch(push(w, ["stream-beta"])), true)
  }
  {
    const { w } = depot()
    mussGit(w, ["config", "core.hooksPath", bruecke])
    mkdirSync(join(w, "tools", "haken"), { recursive: true })
    for (const n of ["pre-push", "pre-push.mjs"]) copyFileSync(join(HAKEN, n), join(w, "tools", "haken", n))
    schreibe(w, "module.json", modul("14.5.0-beta.13"), "beta.13 ohne Tag")
    p.gleich("die Bruecke ruft den Haken des Stands", sperrt(push(w, ["stream-beta"]), "S4"), true)
  }
}

p.abschnitt("Der Satz selbst")
{
  // Koeder: ein Repositorium, auf das eine geerbte GIT_DIR zeigt. Ein
  // `init --bare` mit der bereinigten Umgebung darf es nicht anfassen.
  const koeder = wegwerf("vorpush-koeder-")
  mussGit(koeder, ["init", "-q"])
  const ziel = wegwerf("vorpush-ziel-")
  spawnSync("git", ["-C", ziel, "init", "-q", "--bare"], { windowsHide: true, env: ohneHakenumgebung({ ...UMGEBUNG, GIT_DIR: join(koeder, ".git") }) })
  p.gleich("eine geerbte GIT_DIR erreicht das echte Repositorium nicht", git(koeder, ["config", "--get", "core.bare"]).aus.trim(), "false")
}

p.abschnitt("Was im Repositorium steht")
{
  const m = JSON.parse(readFileSync(join(WURZEL, "module.json"), "utf8"))
  p.struktur("module.json: download zeigt auf das Tag-ZIP der Version", m.download, tagZip(m.version))
  p.struktur("module.json: eine Beta-Version zeigt auf das Beta-Manifest", !m.version.includes("-beta.") || m.manifest === MANIFEST, true)
}

p.ende()
