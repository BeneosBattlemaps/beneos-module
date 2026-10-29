/**
 * Bench for the scene update of linked tokens (`tokenUpdatesAufteilen`).
 *
 * Loads the real data model of an installed Foundry release, so the rejection is
 * measured against Foundry itself and not against a guess. The server step is
 * replayed: the client turns each change into a diff, the server applies that
 * diff to its stored token, which carries `delta: null` for a linked token.
 *
 * Usage: node unit.mjs --foundry "<path to resources/app>"     Exit code 1 on any failure.
 */
import path from "node:path"
import url from "node:url"
import fs from "node:fs"

const arg = process.argv.indexOf("--foundry")
if (arg < 0) { console.error("missing --foundry <path to resources/app>"); process.exit(2) }
const APP = process.argv[arg + 1]
const GENERATION = JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf-8")).release.generation

globalThis.foundry = await import(url.pathToFileURL(path.join(APP, "common", "server.mjs")).href)
globalThis.CONFIG = { Token: { movement: { actions: { walk: {}, fly: {}, swim: {}, burrow: {}, climb: {}, jump: {}, blink: {}, crawl: {}, displace: {} } } } }
globalThis.game = { system: { id: "dnd5e", grid: { type: 1, size: 100, distance: 5, units: "ft", diagonals: 0 } } }

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const SRC = url.pathToFileURL(path.resolve(HERE, "..", "..", "scripts", "cloud-v2", "token-delta.mjs")).href
const { tokenUpdatesAufteilen } = await import(SRC)
const { BaseToken } = foundry.documents

let fehler = 0
function pruefe(name, ok) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`)
  if (!ok) fehler += 1
}

/** Token 7 der Szene "2 Characters" aus Landing 0001, so wie das Pack es liefert. */
const packToken = (actorLink, deltaName = null) => ({
  _id: "di3ZDb1nzpZ90pJ4", name: "Sir Godfrey Gwilym", actorId: "KM5sNFK5RtuCUZzv", actorLink, x: 100,
  delta: { _id: "3WcjWmzUyG43fyhc", system: {}, items: [], effects: [], flags: {},
    name: deltaName, type: null, img: null, ownership: null },
})

/**
 * Spielt Update-Laeufe nacheinander gegen eine Weltfassung mit `delta: null`.
 * Je Lauf bildet der Client den Diff auf einer Kopie, der Server wendet ihn an.
 * Gibt die Weltfassung zurueck, oder null, wenn ein Lauf abgelehnt wurde.
 */
function serverFolge(weltLink, laeufe) {
  const welt = new BaseToken({ _id: "di3ZDb1nzpZ90pJ4", name: "Sir Godfrey Gwilym",
    actorId: "KM5sNFK5RtuCUZzv", actorLink: weltLink, delta: null })
  for (const change of laeufe) {
    const diff = new BaseToken(structuredClone(welt._source)).updateSource(structuredClone(change))
    try { welt.updateSource(diff) }
    catch (_) { return null }
  }
  return welt
}
const ueberFix = (weltLink, pack) => {
  const { zuerst, danach } = tokenUpdatesAufteilen([pack], () => weltLink)
  return serverFolge(weltLink, [...zuerst, ...danach])
}

// Reine Entscheidung
const nie = () => false, immer = () => true
const linked = tokenUpdatesAufteilen([packToken(true)], nie)
pruefe("linked pack token loses delta, no second run",
  !("delta" in linked.zuerst[0]) && linked.danach.length === 0)
const kreuz = tokenUpdatesAufteilen([packToken(false)], immer)
pruefe("unlinked pack token over linked world token: delta moves to the second run",
  !("delta" in kreuz.zuerst[0]) && kreuz.danach.length === 1 && "delta" in kreuz.danach[0])
const beide = tokenUpdatesAufteilen([packToken(false)], nie)
pruefe("unlinked on both sides keeps delta in the first run", "delta" in beide.zuerst[0] && beide.danach.length === 0)
const ohneDelta = { _id: "x", actorLink: true }
pruefe("token without delta stays the same object", tokenUpdatesAufteilen([ohneDelta], nie).zuerst[0] === ohneDelta)
pruefe("pack entry itself is not changed",
  "delta" in (() => { const t = packToken(true); tokenUpdatesAufteilen([t], nie); return t })())

// Gegen den echten Foundry-Kern
// Erst V14 lehnt ab; V13 nimmt das ungeteilte Update an. Gemessen gegen Build 351 und 367.
const roh = serverFolge(true, [packToken(true)])
if (GENERATION >= 14) pruefe("counter check: unfixed linked update is rejected by Foundry", roh === null)
else pruefe("V13 accepts the unfixed linked update as well", roh !== null)
pruefe("fixed linked update is accepted by Foundry", ueberFix(true, packToken(true)) !== null)
const ergebnisKreuz = ueberFix(true, packToken(false, "Packname"))
pruefe("cross case is accepted, token ends unlinked with the pack delta",
  ergebnisKreuz !== null && ergebnisKreuz._source.actorLink === false
  && ergebnisKreuz._source.delta?.name === "Packname")
const ergebnisBeide = ueberFix(false, packToken(false, "Packname"))
pruefe("unlinked update keeps the pack delta",
  ergebnisBeide !== null && ergebnisBeide._source.delta?.name === "Packname")

console.log(`\nFoundry generation ${GENERATION}`)
console.log(fehler ? `\n${fehler} failure(s)` : "\nall passed")
process.exit(fehler ? 1 : 0)
