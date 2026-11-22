/**
 * Commit-Kennung als Pflicht auf dem Stand von stream-beta (stre-T-047).
 *
 * WARUM. Der Aufgabenabgleich (aufgaben-abgleich.py des session-orchestrator)
 * wertet eine Kennung nur in der Klammer des Betreffs: `fix(stre-T-047): ...`.
 * Ein Fix ohne Kennung dort bleibt fuer ihn unsichtbar, und sein Ticket bleibt
 * offen, obwohl die Arbeit gemergt ist. In der Inventur vom 12.11.2026 trugen
 * die meisten stre-Commits keine Kennung (G-5.9). Entscheid des Betreibers
 * (Betreiber-Automatik, 22.11.2026): sperren mit Notweg, und die Kennung muss
 * in der Klammer stehen.
 *
 * DIE REGEL. Die erste Zeile hat die Form `typ(<kennungen>)!?: text`, `typ`
 * aus Kleinbuchstaben und Ziffern (`i18n`), in der Klammer mindestens eine
 * gueltige Kennung, weitere Woerter mit `, ` daneben. Gueltig sind
 * `<dom>-T-nnn` mit mindestens drei Ziffern (die Liste fuehrt `T-047`, und der
 * Abgleich kanonisiert die Ziffern nicht: `stre-T-47` waere fuer ihn `T-47`),
 * `OP-XXX-n`, `RG-n` und `TC-...-n`. Ein blosses `T-n` ist mehrdeutig und
 * gilt nicht.
 *
 * OHNE PRUEFUNG: Merge-Commits (allein an der Datei MERGE_HEAD erkannt, von
 * der Huelle; ein Betreff `Merge ...` ohne Merge ist KEINE Ausnahme),
 * `fixup! `, `squash! `, `amend! `, `Revert "` und eine leere Nachricht, bei
 * der git selbst abbricht.
 *
 * KOMMENTARZEILEN (`#`) gelten nur dann als Kommentar, wenn ein Editor lief:
 * dann raeumt git sie nach dem Haken weg. Ohne Editor (`-m`, `-F`) setzt git
 * fuer den Haken GIT_EDITOR=":", raeumt nur Leerraum auf, und eine Rautenzeile
 * bleibt der gespeicherte Betreff; dann zaehlt sie hier auch als Betreff. Ein
 * umgestelltes core.commentChar kennt der Riegel nicht. Nachgezogen nach dem
 * Kalt-Review des Worker-Riegels (stre-T-047, 22.11.2026).
 *
 * WANN DER HAKEN GILT, entscheidet allein die sh-Huelle `commit-msg`: nur wenn
 * die vorgemerkte module.json das Manifest von stream-beta traegt. main und die
 * Zweige anderer Tabs bleiben unberuehrt.
 *
 * NOTWEG. `BENEOS_COMMIT_NOTWEG="<Begruendung>" git commit ...` laesst einen
 * gesperrten Commit durch und haengt Zeit, Wurzel, Zweig, Betreff, Grund und
 * Begruendung an `<git-common-dir>/beneos-commit-notweg.log`. Eine leere
 * Begruendung zaehlt nicht, ein nicht schreibbares Log haelt die Sperre.
 *
 * Aufruf durch die Huelle: `commit-msg.mjs <nachrichtendatei>`, Umgebung
 * `BENEOS_IST_MERGE=1` bei einem Merge.
 */

import { appendFileSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const KOPF = /^([a-z][a-z0-9]*)\(([^()]*)\)!?: \S/
const KENNUNG = /^(?:[a-z]{2,5}-T-\d{3,}|OP-[A-Z]{2,4}-\d+|RG-\d+|TC-[A-Z]+(?:-[A-Z]+)*-\d+)$/
const AUSNAHME = /^(?:fixup! |squash! |amend! |Revert ")/

/** Die erste nicht leere Zeile; Rautenzeilen nur ueberspringen, wenn ein Editor lief. */
export function betreffAus(nachricht, mitEditor = true) {
  for (const zeile of String(nachricht ?? "").split(/\r?\n/)) {
    if (mitEditor && zeile.startsWith("#")) continue
    const z = zeile.trimEnd()
    if (z.trim()) return z
  }
  return ""
}

export function pruefeBetreff(nachricht, istMerge = false, mitEditor = true) {
  const b = betreffAus(nachricht, mitEditor)
  if (!b) return { ok: true, grund: "leere Nachricht, git bricht selbst ab" }
  if (istMerge) return { ok: true, grund: "Merge-Commit" }
  if (AUSNAHME.test(b)) return { ok: true, grund: "Ausnahme" }
  const m = KOPF.exec(b)
  if (!m) return { ok: false, grund: `der Betreff hat nicht die Form typ(kennung): text: "${b}"` }
  const teile = m[2].split(",").map((t) => t.trim())
  if (!teile.some((t) => KENNUNG.test(t))) return { ok: false, grund: `keine gueltige Kennung in der Klammer "(${m[2]})"` }
  return { ok: true, grund: "Kennung in der Klammer" }
}

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8", windowsHide: true })
  return (r.status === 0 ? r.stdout || "" : "").trim()
}

export function hauptlauf(datei, env = process.env) {
  let nachricht = ""
  try { nachricht = readFileSync(datei, "utf8") } catch (e) {
    console.error(`commit-msg: Nachricht nicht lesbar (${e.message}), Commit gesperrt (stre-T-047)`)
    return 1
  }
  const mitEditor = env.GIT_EDITOR !== ":"
  const r = pruefeBetreff(nachricht, env.BENEOS_IST_MERGE === "1", mitEditor)
  if (r.ok) return 0

  const notweg = String(env.BENEOS_COMMIT_NOTWEG ?? "").trim()
  if (notweg) {
    const log = join(resolve(git(["rev-parse", "--git-common-dir"]) || ".git"), "beneos-commit-notweg.log")
    const zweig = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "?"
    const zeile = `${new Date().toISOString()} | ${git(["rev-parse", "--show-toplevel"])} | ${zweig} | ${betreffAus(nachricht, mitEditor)} | ${r.grund} | Begruendung: ${notweg.replace(/\s+/g, " ")}\n`
    try { appendFileSync(log, zeile) } catch (e) {
      console.error(`commit-msg: Notweg nicht mitschreibbar (${e.message}), Commit bleibt gesperrt`)
      return 1
    }
    console.error(`commit-msg: NOTWEG genommen, mitgeschrieben in ${log}`)
    return 0
  }

  console.error("commit-msg: Commit auf dem Stand von stream-beta gesperrt (stre-T-047)")
  console.error(`  ${r.grund}`)
  console.error("")
  console.error("  Sollform: typ(<kennung>): text, die Kennung in der Klammer, zum Beispiel")
  console.error("    fix(stre-T-047): Betreff nennt die Kennung")
  console.error("    chore(stre-T-047): 14.5.0-beta.13")
  console.error("  Gueltig: stre-T-nnn (mindestens drei Ziffern), OP-XXX-n, RG-n, TC-...-n.")
  console.error("  Den Betreff korrigieren und neu committen; die Nachricht steht noch in .git/COMMIT_EDITMSG.")
  console.error("  Notweg nur mit Begruendung: BENEOS_COMMIT_NOTWEG=\"<grund>\" git commit ...")
  return 1
}

const direkt = process.argv[1] && resolve(process.argv[1]).toLowerCase().endsWith("commit-msg.mjs")
if (direkt) {
  // exitCode statt exit, wie in pre-push.mjs: stderr soll vollstaendig ankommen.
  process.exitCode = hauptlauf(process.argv[2] || "")
}
