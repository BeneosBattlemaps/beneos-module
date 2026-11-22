/**
 * Riegel vor dem Push auf stream-beta (stre-T-028, OP-CLA-017).
 *
 * WARUM. Betatester beziehen das Modul ueber
 * `raw.githubusercontent.com/.../stream-beta/module.json`. Bis stre-T-028
 * zeigte `download` dort auf das Zweig-ZIP, und jeder Push tauschte, was sie
 * laden, ohne die Version anzuheben: seit 14.5.0-beta.11 gingen ueber hundert
 * Commits so hinaus, und Foundry bot keinem Tester ein Update an. Entscheid
 * des Betreibers vom 21.11.2026: Push und Auslieferung trennen, wie auf main.
 * `download` zeigt auf das ZIP des Tags der Version. Dann liefert ein Push
 * ohne Versionssprung nichts aus und geht durch, und ein Push mit
 * Versionssprung liefert nur aus, wenn der Tag mitkommt oder schon liegt.
 *
 * WAS SPERRT, je mit Kennung im Text:
 *   S1  download ist nicht das Tag-ZIP der Version, oder module.json ist
 *       nicht lesbar.
 *   S2  manifest zeigt nicht mehr auf stream-beta. Die installierten Tester
 *       verloeren sonst ihren Updateweg.
 *   S3  die Version hat sich geaendert, ist aber nicht neuer.
 *   S4  die Version ist neuer, aber der Tag fehlt, traegt eine andere
 *       Version oder liegt nicht in der gepushten Geschichte. Neuinstallationen
 *       bekaemen sonst ein 404 oder einen anderen Stand.
 *   S5  der Fernstand ist hier unbekannt (erst fetch), oder stream-beta soll
 *       geloescht werden.
 *
 * Andere Zweige und Tags gehen ohne Pruefung durch. main und jeder Weg der
 * Bestandskunden bleibt damit unberuehrt.
 *
 * NOTWEG. `BENEOS_PUSH_NOTWEG="<Begruendung>" git push ...` laesst einen
 * gesperrten Push durch und haengt Zeit, Refs, Shas, Sperrgruende und
 * Begruendung an `<git-common-dir>/beneos-push-notweg.log`. Eine leere
 * Begruendung zaehlt nicht.
 *
 * Aufruf durch git: `pre-push <fernname> <fernadresse>`, stdin je Ref
 * `<lokal ref> <lokal sha> <fern ref> <fern sha>`.
 */

import { appendFileSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const ZWEIG = "refs/heads/stream-beta"
const BASIS = "https://github.com/BeneosBattlemaps/beneos-module"
const MANIFEST = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-module/stream-beta/module.json"
const NULL = /^0+$/

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8", windowsHide: true, maxBuffer: 1 << 24 })
  return { rc: r.status ?? -1, aus: (r.stdout || "").trim() }
}
const bekannt = (sha) => git(["cat-file", "-e", `${sha}^{commit}`]).rc === 0
const commitVon = (sha) => { const r = git(["rev-parse", "--verify", "-q", `${sha}^{commit}`]); return r.rc === 0 ? r.aus : "" }
const vorfahr = (a, b) => git(["merge-base", "--is-ancestor", a, b]).rc === 0

function modulAm(sha) {
  const r = git(["show", `${sha}:module.json`])
  if (r.rc !== 0) return null
  try { return JSON.parse(r.aus) } catch { return null }
}

/** Nur diese Form traegt stream-beta: 14.5.0 oder 14.5.0-beta.12. */
export const versionGueltig = (v) => /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(String(v ?? ""))

const numerisch = (s) => !Number.isNaN(parseFloat(s)) && Number.isFinite(Number(s))
/**
 * Foundrys eigene Ordnung, nachgebaut nach `isNewerVersion` in
 * common/utils/helpers.mjs (V13 und V14): Teile an "." trennen, numerisch
 * vergleichen nur wenn beide Teile Zahlen sind, sonst als Zeichenkette.
 * Foundry bietet ein Update nur an, wenn das fuer (neu, installiert) wahr ist.
 * Darum zaehlt diese Ordnung und keine eigene: nach ihr ist 14.5.0 NICHT
 * neuer als 14.5.0-beta.12 ("0" gegen "0-beta"), eine Freigabe nach einer
 * Beta braucht auf diesem Zweig also 14.5.1 (Kalt-Review stre-T-028).
 */
export function foundryNeuer(v1, v0) {
  const a = String(v1).split("."), b = String(v0).split(".")
  for (const [i, p1] of a.entries()) {
    const p0 = b[i]
    if (p0 === undefined) return true
    if (numerisch(p0) && numerisch(p1)) {
      if (p1 !== p0) return parseInt(p1) > parseInt(p0)
    } else if (p1 !== p0) return p1 > p0
  }
  return false
}
export const istNeuer = (neu, alt) => versionGueltig(neu) && versionGueltig(alt) && foundryNeuer(neu, alt)
export const tagZip = (v) => `${BASIS}/archive/refs/tags/${v}.zip`

/** Die Tags dieses Pushes und die des Ferndepots, je Name auf den Commit. */
function tagsFern(fern) {
  const r = git(["ls-remote", "--tags", fern])
  const tags = new Map()
  if (r.rc !== 0) return tags
  for (const zeile of r.aus.split("\n")) {
    const [sha, ref] = zeile.trim().split(/\s+/)
    if (!ref?.startsWith("refs/tags/")) continue
    const name = ref.slice(10).replace(/\^\{\}$/, "")
    // Die geschaelte Zeile (^{}) zeigt auf den Commit und geht vor.
    if (ref.endsWith("^{}") || !tags.has(name)) tags.set(name, sha)
  }
  return tags
}

function pruefeZweig(lokal, fernSha, tagsPush, holeTagsFern) {
  const gruende = []
  if (NULL.test(lokal)) return ["[S5] stream-beta soll geloescht werden"]
  const neu = modulAm(lokal)
  if (!neu) return ["[S1] module.json am gepushten Stand fehlt oder ist nicht lesbar"]
  if (neu.download !== tagZip(neu.version)) {
    gruende.push(`[S1] download ist "${neu.download}", erwartet ${tagZip(neu.version)}`)
  }
  if (neu.manifest !== MANIFEST) gruende.push(`[S2] manifest ist "${neu.manifest}", erwartet ${MANIFEST}`)

  let altVersion = null
  if (!NULL.test(fernSha)) {
    if (!bekannt(fernSha)) {
      gruende.push(`[S5] der Fernstand ${fernSha.slice(0, 12)} ist hier unbekannt, erst git fetch`)
      return gruende
    }
    altVersion = modulAm(fernSha)?.version ?? null
  }
  if (altVersion !== null && neu.version === altVersion) return gruende

  if (altVersion !== null && !istNeuer(neu.version, altVersion)) {
    gruende.push(`[S3] Version ${neu.version} ist fuer Foundry nicht neuer als ${altVersion}, kein Tester bekaeme ein Update`)
    return gruende
  }
  // Ein Sprung, also eine Auslieferung: der Tag der Version muss mitkommen
  // oder schon liegen, dieselbe Version tragen und in der Geschichte liegen.
  // Den Fernstand des Tags immer fragen, auch wenn der Tag mitkommt: liegt er
  // dort schon auf einem anderen Commit, weist der Server den Tag ab, waehrend
  // der Zweig durchgeht, und das Tag-ZIP liefert einen anderen Stand.
  let tagCommit = tagsPush.get(neu.version) || ""
  const fern = holeTagsFern().get(neu.version)
  if (fern && tagCommit && fern !== tagCommit) {
    gruende.push(`[S4] Tag ${neu.version} liegt auf origin schon auf ${fern.slice(0, 12)}, nicht auf dem mitgegebenen Commit`)
    return gruende
  }
  if (!tagCommit && fern) {
    tagCommit = bekannt(fern) ? fern : ""
    if (!tagCommit) {
      gruende.push(`[S4] Tag ${neu.version} liegt auf origin, ist hier aber unbekannt, erst git fetch --tags`)
      return gruende
    }
  }
  if (!tagCommit) {
    gruende.push(`[S4] Version ${neu.version} ohne Tag ${neu.version}: Tag setzen und im selben Push mitgeben`)
  } else if (modulAm(tagCommit)?.version !== neu.version) {
    gruende.push(`[S4] Tag ${neu.version} zeigt auf einen Commit mit Version ${modulAm(tagCommit)?.version}`)
  } else if (!vorfahr(tagCommit, lokal)) {
    gruende.push(`[S4] Tag ${neu.version} liegt nicht in der gepushten Geschichte`)
  }
  return gruende
}

export function hauptlauf(fernname, eingabe, env = process.env) {
  const zeilen = eingabe.split("\n").map((z) => z.trim().split(/\s+/)).filter((t) => t.length === 4)
  const tagsPush = new Map()
  for (const [, lokal, fernRef] of zeilen) {
    if (fernRef.startsWith("refs/tags/") && !NULL.test(lokal)) {
      const c = commitVon(lokal)
      if (c) tagsPush.set(fernRef.slice(10), c)
    }
  }
  let tagsFernCache = null
  const holeTagsFern = () => (tagsFernCache ??= tagsFern(fernname))

  const gruende = []
  const betroffen = []
  for (const [lokalRef, lokal, fernRef, fernSha] of zeilen) {
    if (fernRef !== ZWEIG) continue
    betroffen.push(`${lokalRef} ${lokal.slice(0, 12)} -> ${fernRef} ${fernSha.slice(0, 12)}`)
    gruende.push(...pruefeZweig(lokal, fernSha, tagsPush, holeTagsFern))
  }
  if (!gruende.length) return 0

  const notweg = String(env.BENEOS_PUSH_NOTWEG ?? "").trim()
  if (notweg) {
    const log = join(resolve(git(["rev-parse", "--git-common-dir"]).aus || ".git"), "beneos-push-notweg.log")
    const zeile = `${new Date().toISOString()} | ${fernname} | ${betroffen.join("; ")} | ${gruende.join("; ")} | Begruendung: ${notweg.replace(/\s+/g, " ")}\n`
    try { appendFileSync(log, zeile) } catch (e) {
      console.error(`pre-push: Notweg nicht mitschreibbar (${e.message}), Push bleibt gesperrt`)
      return 1
    }
    console.error(`pre-push: NOTWEG genommen, mitgeschrieben in ${log}`)
    for (const g of gruende) console.error(`  ${g}`)
    return 0
  }

  console.error("pre-push: Push auf stream-beta gesperrt (stre-T-028)")
  for (const g of gruende) console.error(`  ${g}`)
  console.error("")
  console.error("  Ohne Versionssprung liefert stream-beta nichts aus und geht durch.")
  console.error("  Ausliefern: version in module.json anheben, download auf das Tag-ZIP der")
  console.error("  Version setzen, Tag auf diesen Commit, und beides in EINEM Push:")
  console.error("    git push --atomic origin <commit>:refs/heads/stream-beta refs/tags/<version>")
  console.error("  Notweg nur mit Begruendung: BENEOS_PUSH_NOTWEG=\"<grund>\" git push ...")
  return 1
}

const direkt = process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("pre-push.mjs")
if (direkt) {
  let eingabe = ""
  try { eingabe = readFileSync(0, "utf8") } catch { eingabe = "" }
  // exitCode statt exit: an einer Windows-Konsole koennte exit die
  // Sperrmeldung abschneiden, bevor stderr geleert ist.
  process.exitCode = hauptlauf(process.argv[2] || "origin", eingabe)
}
