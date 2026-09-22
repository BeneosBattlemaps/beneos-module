/**
 * Bench: what a given Foundry release throws away from our pack data.
 *
 * It does not guess what a new Foundry generation dislikes. It loads the REAL
 * data model of the installed Foundry release, runs the Beneos bridge over
 * scenes and actors, then builds every pack document the way createDocuments
 * builds it, and compares what went in with what came out. Any field that
 * disappears or changes value on the way is a loss at install time.
 *
 * Usage, see README:
 *   node bench.mjs --foundry "<path to the app folder>" --packs "<folder>"
 *                  [--limit 20] [--verbose] [--without-bridge]
 *
 * Exit code 1 as soon as a loss is found, so the run works as a release gate.
 * Exit code 2 when the run could not measure anything, so "nothing lost" can
 * never be confused with "nothing measured".
 */
import fs from "node:fs"
import path from "node:path"
import url from "node:url"
import { execFileSync } from "node:child_process"

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const MODULE_ROOT = path.resolve(HERE, "..", "..")
const NODE_MIN = 18

const PACK_FILES = ["data/Scene.json", "data/Actor.json", "data/Item.json", "data/JournalEntry.json",
  "data/Playlist.json", "data/Macro.json", "data/RollTable.json", "data/Cards.json", "data/folders.json"]

// A run that measures nothing must not report success.
const MIN_PACKS = 1
const MIN_DOCUMENTS = 10

// Paths Foundry itself rewrites in its own migrateData, measured at the document
// rather than assumed:
//   effects[].changes        -> system.changes, mode -> type, value retyped
//   effects[].duration.*     -> duration.value/units and start.time/round/turn
//   effects[].origin         -> flags.core.originText for a non-core uuid
//   Scene.initial.scale      -> rounded to three decimals by every release
const FOUNDRY_MOVES = [
  /\.effects\[\]\.changes$/,
  /\.effects\[\]\.changes\[\]\.value$/,
  /\.effects\[\]\.duration\./,
  /\.effects\[\]\.origin$/,
  /^Scene\.initial\.scale$/,
]

// Paths the BENEOS BRIDGE rewrites on purpose. They are excused in a normal run
// and deliberately NOT excused under --without-bridge, because that run exists
// to prove this list is real. Every entry names a rename, not a deletion: a move
// that keeps the leaf name and the value is recognised automatically.
const BRIDGE_MOVES = [
  /^Scene\.background\.(offsetX|offsetY|anchorX|anchorY)$/,
  /^Scene\.backgroundColor$/,
  /^Scene\.foregroundElevation$/,
  /^Scene\.fog\.(exploration|overlay)$/,
  /^Scene\.templates$/,
  /^Scene\.tiles\[\]\.occlusion\.mode$/,
  /^Scene\.tiles\[\]\.(x|y)$/,
  /^Scene\.tokens\[\]\.detectionModes$/,
  /^Actor\.prototypeToken\.detectionModes$/,
]

// `system` belongs to the game system, which is not loaded here. `_stats` and
// `_key` are stamped by the server on create. Both only at the document root:
// `flags` carries our own scene and token markers and `sort` is a tile's stacking
// order, so neither may be waved through further down.
const SKIP_AT_ROOT = new Set(["system", "_stats", "_key", "flags", "ownership", "sort"])

/* ----------------------------------------------------------------------- */
/*  Arguments                                                               */
/* ----------------------------------------------------------------------- */

function parseArgs(argv) {
  const a = { limit: Infinity, verbose: false, withoutBridge: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--foundry") a.foundry = argv[++i]
    else if (argv[i] === "--packs") a.packs = argv[++i]
    else if (argv[i] === "--limit") a.limit = Number(argv[++i]) || Infinity
    else if (argv[i] === "--verbose") a.verbose = true
    // A green run that cannot turn red proves nothing.
    else if (argv[i] === "--without-bridge" || argv[i] === "--ohne-bruecke") a.withoutBridge = true
  }
  return a
}

const FOUNDRY_CANDIDATES = [
  "D:/PNP_Game/Foundry VTT/FoundryVTT/Foundry Virtual Tabletop V14/App/resources/app",
  "D:/PNP_Game/Foundry VTT/FoundryVTT/Foundry Virtual Tabletop v13/resources/app",
  "C:/Program Files/Foundry Virtual Tabletop/resources/app",
]

function findFoundry(wanted) {
  for (const p of (wanted ? [wanted] : FOUNDRY_CANDIDATES)) {
    for (const inner of ["", "resources/app", "App/resources/app"]) {
      const q = inner ? path.join(p, inner) : p
      if (fs.existsSync(path.join(q, "common", "documents", "_module.mjs"))) return q
    }
  }
  return null
}

/* ----------------------------------------------------------------------- */
/*  Foundry environment                                                     */
/* ----------------------------------------------------------------------- */

const messages = new Map()
let messagesSuppressed = 0

async function loadFoundry(root) {
  const u = (p) => url.pathToFileURL(path.join(root, p)).href
  await import(u("common/primitives/_module.mjs"))
  const CONST = await import(u("common/constants.mjs"))
  const utils = await import(u("common/utils/_module.mjs"))
  const abstract = await import(u("common/abstract/_module.mjs"))
  const data = await import(u("common/data/_module.mjs"))
  let grid = {}
  try { grid = await import(u("common/grid/_module.mjs")) } catch (_) { /* named differently before V12 */ }
  // DocumentFlagsField validates every flag scope against BasePackage.validateId.
  // Without this import the check throws, is caught, and EVERY module flag looks
  // dropped: monks-active-tiles, poi-teleport, multilevel-tokens, LockView.
  let packages = {}
  try { packages = await import(u("common/packages/_module.mjs")) } catch (_) { /* older layout */ }

  // Validation failures arrive through `logger`. Only the ones that depend on a
  // loaded game system are dropped, and the drop is counted rather than hidden.
  const note = (m) => {
    const raw = String(m?.message || m).replace(/\s+/g, " ")
    // `type` resolves against the game system's data models, which are absent
    // here. Nothing else is filtered by wording.
    if (/\btype\b: (Cannot convert undefined or null to object|.* is not a valid choice)/.test(raw)) {
      messagesSuppressed++; return
    }
    if (/_stats:/.test(raw)) { messagesSuppressed++; return }
    const key = raw.replace(/\b[A-Za-z0-9]{16}\b/g, "<id>").slice(0, 150)
    messages.set(key, (messages.get(key) || 0) + 1)
  }
  globalThis.CONST = CONST
  globalThis.logger = { warn: note, error: note, info: () => {}, debug: () => {}, log: () => {} }
  // The schema reads only choice lists out of CONFIG, so a permissive stand-in
  // keeps the bench independent of any game system.
  globalThis.CONFIG = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (t[k] = new Proxy({}, { get: (a, b) => a[b] }))),
  })
  // Compatibility warnings need real arrays, not a stand-in. SILENT, because the
  // comparison triggers the deprecation getters itself.
  globalThis.CONFIG.compatibility = {
    mode: CONST.COMPATIBILITY_MODES?.SILENT ?? 0, includePatterns: [], excludePatterns: [],
  }
  globalThis.foundry = { CONST, utils, abstract, data, grid, packages }
  globalThis.game = {
    system: { id: "none", version: "0.0.0", grid: { type: 1, distance: 5, units: "ft", diagonals: 0 } },
    release: { generation: 0, version: "0" }, modules: new Map(),
    documentTypes: new Proxy({}, { get: () => [] }), model: {},
    // parseUuid looks into game.packs for an origin that points at a compendium.
    packs: new Map(), collections: new Map(),
    // Deliberately NO `settings`. PrototypeTokenOverrides.applyOverrides returns
    // early without it ("Server-side or Setup") and throws with an empty stand-in,
    // which would make every Actor fail to build for a reason that is ours alone.
    i18n: { localize: (s) => s, format: (s) => s },
  }
  const documents = await import(u("common/documents/_module.mjs"))
  globalThis.foundry.documents = documents

  let version = "unknown", generation = 0
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    version = pj.version || version
    generation = Number(pj.release?.generation ?? String(version).split(".")[0]) || 0
  } catch (_) { /* version stays unknown */ }
  globalThis.game.release = { generation, version }
  return { documents, version, generation }
}

/* ----------------------------------------------------------------------- */
/*  Pack source                                                             */
/* ----------------------------------------------------------------------- */

let unreadable = 0
let pythonVersion = null

/** [{ name, files: { "data/Scene.json": [...] } }] from ZIP archives or folders. */
function loadPacks(source, limit) {
  if (!fs.existsSync(source)) throw new Error(`pack source not found: ${source}`)
  const entries = fs.readdirSync(source)
  const zips = entries.filter((f) => f.toLowerCase().endsWith(".zip"))
  if (zips.length) return zips.slice(0, limit).map((z) => ({ name: z, files: fromZip(path.join(source, z)) }))

  const out = []
  for (const e of entries) {
    if (out.length >= limit) break
    if (!fs.existsSync(path.join(source, e, "data"))) continue
    const files = {}
    for (const rel of PACK_FILES) {
      const p = path.join(source, e, rel)
      if (!fs.existsSync(p)) continue
      try { files[rel] = JSON.parse(fs.readFileSync(p, "utf8")) }
      catch (err) { unreadable++; console.warn(`  unreadable: ${e}/${rel}: ${err.message}`) }
    }
    if (Object.keys(files).length) out.push({ name: e, files })
  }
  return out
}

// ZIP archives need Python; node ships no reader. The path is passed as an
// argument, never pasted into the script text.
const ZIP_READER = `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1])
wanted = json.loads(sys.argv[2])
out = {}
for n in z.namelist():
    for k in wanted:
        if n.endswith(k):
            out[k] = json.loads(z.read(n).decode('utf-8'))
sys.stdout.write(json.dumps(out))
`

function python() {
  if (pythonVersion) return pythonVersion
  for (const exe of ["python", "python3"]) {
    try {
      const v = execFileSync(exe, ["--version"], { encoding: "utf8" }).trim()
      pythonVersion = { exe, version: v }
      return pythonVersion
    } catch (_) { /* try the next name */ }
  }
  throw new Error("ZIP archives need Python on PATH. Point --packs at unpacked packs instead.")
}

function fromZip(file) {
  const { exe } = python()
  try {
    return JSON.parse(execFileSync(exe, ["-c", ZIP_READER, file, JSON.stringify(PACK_FILES)],
      { maxBuffer: 1 << 30, encoding: "utf8" }))
  } catch (e) {
    unreadable++
    console.warn(`  unreadable: ${path.basename(file)}: ${String(e.message).slice(0, 100)}`)
    return {}
  }
}

/* ----------------------------------------------------------------------- */
/*  Comparison                                                              */
/* ----------------------------------------------------------------------- */

const short = (v) => { const s = JSON.stringify(v); return s && s.length > 44 ? s.slice(0, 44) + "..." : s }
const trivial = (v) => v === undefined || v === null || v === "" || v === 0
  || v === "[]" || v === "{}" || v === "0" || v === "null" || v === '""' || v === "List(0)"

/**
 * Leaf name -> set of values present in the result. A dropped field is treated as
 * MOVED only when the same leaf name carries the same value somewhere else, for
 * example background.src landing on levels[0].background.src. Matching on the
 * value alone would excuse every `true`, `0` and `60` in the document.
 */
function collectLeaves(node, key, into) {
  if (node === null || typeof node !== "object") {
    if (key) (into.get(key) || into.set(key, new Set()).get(key)).add(JSON.stringify(node))
    return into
  }
  if (key) (into.get(key) || into.set(key, new Set()).get(key)).add(JSON.stringify(node))
  if (Array.isArray(node)) { for (const v of node) collectLeaves(v, key, into) ; return into }
  for (const [k, v] of Object.entries(node)) collectLeaves(v, k, into)
  return into
}

function compare(source, cleaned, at, hits, leaves, depth = 0) {
  if (source === null || typeof source !== "object") {
    if (JSON.stringify(source) !== JSON.stringify(cleaned)) hits.push({ at, from: source, to: cleaned })
    return
  }
  if (Array.isArray(source)) {
    if (!Array.isArray(cleaned)) { hits.push({ at, from: `List(${source.length})`, to: typeof cleaned }); return }
    if (source.length !== cleaned.length) hits.push({ at, from: `List(${source.length})`, to: `List(${cleaned.length})` })
    for (let i = 0; i < Math.min(source.length, cleaned.length); i++) {
      compare(source[i], cleaned[i], `${at}[]`, hits, leaves, depth + 1)
    }
    return
  }
  for (const [k, v] of Object.entries(source)) {
    if (depth === 0 && SKIP_AT_ROOT.has(k)) continue
    const r = cleaned?.[k]
    if (r === undefined) {
      if (leaves.get(k)?.has(JSON.stringify(v))) continue
      hits.push({ at: `${at}.${k}`, from: short(v), to: "gone" })
      continue
    }
    compare(v, r, `${at}.${k}`, hits, leaves, depth + 1)
  }
}

/* ----------------------------------------------------------------------- */
/*  Run                                                                     */
/* ----------------------------------------------------------------------- */

const arg = parseArgs(process.argv.slice(2))
if (Number(process.versions.node.split(".")[0]) < NODE_MIN) {
  console.error(`node ${NODE_MIN} or newer required, found ${process.versions.node}`)
  process.exit(2)
}
const root = findFoundry(arg.foundry)
if (!root) {
  console.error('no Foundry installation found. Point --foundry "<path>" at the app folder.')
  console.error("looked in:\n  " + FOUNDRY_CANDIDATES.join("\n  "))
  process.exit(2)
}
if (!arg.packs) {
  console.error('no pack source. --packs "<folder of ZIP archives or unpacked packs>"')
  process.exit(2)
}

const { documents, version, generation } = await loadFoundry(root)
const bridge = await import(url.pathToFileURL(
  path.join(MODULE_ROOT, "scripts", "cloud-v2", "beneos-v14-scene-migration.mjs")).href)

const CLASS = {
  "data/Scene.json": documents.BaseScene,
  "data/Actor.json": documents.BaseActor,
  "data/Item.json": documents.BaseItem,
  "data/JournalEntry.json": documents.BaseJournalEntry,
  "data/Playlist.json": documents.BasePlaylist,
  "data/Macro.json": documents.BaseMacro,
  "data/RollTable.json": documents.BaseRollTable,
  "data/Cards.json": documents.BaseCards,
  "data/folders.json": documents.BaseFolder,
}

const packs = loadPacks(arg.packs, arg.limit)
console.log(`Foundry ${version} (generation ${generation}) from ${root}`)
console.log(`node ${process.versions.node}${pythonVersion ? `, ${pythonVersion.version}` : ""}`)
console.log(`${packs.length} packs from ${arg.packs}${arg.withoutBridge ? "  [WITHOUT the bridge]" : ""}`)

const totals = new Map()
let documentCount = 0

function inspect(file, doc, packName) {
  documentCount++
  const work = JSON.parse(JSON.stringify(doc))
  if (!arg.withoutBridge && bridge.packNeedsV14Migration(work)) {
    if (file === "data/Scene.json") bridge.migrateSceneForV14(work)
    if (file === "data/Actor.json") bridge.migrateActorForV14(work)
  }
  // Compared against the RAW pack document, not against the bridge's output, so
  // the bridge's own rewrites are measured too. What it changes on purpose is
  // listed in BRIDGE_MOVES and is not excused under --without-bridge.
  const before = JSON.parse(JSON.stringify(doc))
  let cleaned
  // The real path: createDocuments builds a document, and the constructor runs
  // migrateData AND cleanData. Cleaning alone measures too strictly.
  try { cleaned = new CLASS[file](work, { strict: false }).toObject() }
  catch (e) {
    // The first stack is printed once: a document that will not build at all is
    // the kind of finding that needs a place to look, not just a count.
    if (!globalThis.__firstStack) {
      globalThis.__firstStack = 1
      console.error(`\nfirst failing document (${packName}, ${file}):`)
      console.error(e.stack.split("\n").slice(0, 7).join("\n") + "\n")
    }
    record(`${file} : document build throws: ${String(e.message).slice(0, 70)}`, "x", packName)
    return
  }
  const hits = []
  compare(before, cleaned, file.replace("data/", "").replace(".json", ""), hits, collectLeaves(cleaned, null, new Map()))
  for (const h of hits) {
    if (FOUNDRY_MOVES.some((r) => r.test(h.at))) continue
    if (!arg.withoutBridge && BRIDGE_MOVES.some((r) => r.test(h.at))) continue
    record(`${h.at} : ${h.to === "gone" ? "falls away" : `becomes ${short(h.to)}`}`, h.from, packName)
  }
}

function record(key, from, packName) {
  const e = totals.get(key) || { n: 0, real: 0, sample: null, where: null }
  e.n++
  if (!trivial(from)) { e.real++; e.sample ||= from; e.where ||= packName }
  totals.set(key, e)
}

for (const pack of packs) {
  for (const [file, list] of Object.entries(pack.files)) {
    if (!CLASS[file] || !Array.isArray(list)) continue
    for (const doc of list) inspect(file, doc, pack.name)
  }
}

console.log(`${documentCount} documents built.${unreadable ? `  ${unreadable} file(s) unreadable and skipped.` : ""}\n`)

const rows = [...totals.entries()].filter(([, e]) => arg.verbose || e.real > 0)
  .sort((a, b) => b[1].real - a[1].real || b[1].n - a[1].n)

if (!rows.length) {
  console.log("No loss. Every field a pack brings arrives in this Foundry release.")
} else {
  console.log("  real   total  finding")
  for (const [k, e] of rows) {
    console.log(String(e.real).padStart(6), String(e.n).padStart(7), " ", k,
      e.sample ? `  e.g. ${e.sample}` : "", e.where ? `  (${e.where})` : "")
  }
  console.log("\n'real' counts only the cases where a value was actually lost; the rest were defaults.")
  console.log("--verbose lists the defaults as well.")
}

if (messages.size || messagesSuppressed) {
  console.log(`\nValidation messages from Foundry itself (${messagesSuppressed} suppressed as system-dependent):`)
  const sorted = [...messages.entries()].sort((a, b) => b[1] - a[1])
  for (const [k, n] of sorted.slice(0, 20)) console.log(String(n).padStart(6), " ", k)
  if (sorted.length > 20) console.log(`       ... and ${sorted.length - 20} more kinds`)
}

if (packs.length < MIN_PACKS || documentCount < MIN_DOCUMENTS) {
  console.error(`\nMeasured too little: ${packs.length} pack(s), ${documentCount} document(s).`)
  console.error("'no loss' would mean 'nothing measured' here. Check --packs.")
  process.exit(2)
}
process.exit(rows.some(([, e]) => e.real > 0) ? 1 : 0)
