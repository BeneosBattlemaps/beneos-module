/**
 * POI journal index: "which release ships the scene this teleporter pin points at".
 *
 * Why this exists
 * ---------------
 * A teleporter pin knows the id of its target JournalEntry. It used to have to
 * guess the owning release by parsing a number out of the journal NAME and
 * matching that number against other names. That number is a claim frozen at
 * pack time, and it is wrong often enough to send users to the wrong download.
 *
 * The index is built from the packages themselves and keeps two relations apart:
 *
 *   p (provides)  packages that ship a SCENE whose `journal` is this entry.
 *                 That scene IS the destination, so only this may drive an
 *                 install. `p[0]` is the canonical package.
 *   c (contains)  packages that merely ship the JournalEntry document. Releases
 *                 bundle foreign journals on purpose so a pin renders a readable
 *                 name instead of a bare id. It says nothing about the target.
 *
 * `p: []` is an answer, not a gap: no package anywhere provides a scene for this
 * journal. The caller must then say so instead of guessing on.
 *
 * Loading strategy: offline is the normal case, not the exception
 * ---------------------------------------------------------------
 * A Foundry table does not need internet access to run, so neither may this.
 * Three sources, newest `generated_at` wins:
 *
 *   1. the copy shipped with the module, so a fresh install resolves immediately
 *   2. a copy written into the world's own data directory on first online
 *      contact, which then survives restarts and stays authoritative until
 *      something newer arrives
 *   3. the cloud, checked once per session in the background
 *
 * Releases published after the user's last module update only exist in (2) and
 * (3), which is why the local copy has to be a real file rather than a session
 * cache: without it, going offline would lose every release learned since the
 * module was installed.
 *
 * The store is a file in the data directory, not a world setting. A world
 * setting of this size is pushed to every connected client on every world load,
 * and a file is shared by all clients, survives module updates and costs nothing
 * to read.
 */

const MODULE_ID = "beneos-module"
const SUPPORTED_SCHEMA = 1
const BUNDLED_URL = `modules/${MODULE_ID}/data/poi-index.json`
const PERSIST_DIR = "beneos_assets/cloud"
const PERSIST_FILE = "poi-index.json"
const PERSIST_URL = `${PERSIST_DIR}/${PERSIST_FILE}`
const CLOUD_HEAD_URL = "https://beneos.cloud/poi-index/poi-index-head.json"
const CLOUD_INDEX_URL = "https://beneos.cloud/poi-index/poi-index.json"
const CLOUD_TIMEOUT_MS = 8000

/**
 * Remote refresh.
 *
 * Live since 2026-07-26: the cloud publishes the index after every release
 * ingest and serves it with `Access-Control-Allow-Origin: *`, which Foundry
 * needs because worlds run on arbitrary origins. Without that header a failed
 * cross-origin fetch would put a red CORS error in every user's console on every
 * world load, and the browser logs it in a way JavaScript cannot suppress.
 */
const CLOUD_REFRESH_ENABLED = true

let _index = null
let _loading = null
let _nameMap = null
let _refreshTried = false

async function fetchJson(url, timeoutMs) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
    if (!res.ok) return null
    return await res.json()
  } catch (_e) {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Reject anything we do not fully understand rather than half-read it. */
function isUsable(data) {
  return Boolean(
    data &&
    typeof data === "object" &&
    Number(data.schema) === SUPPORTED_SCHEMA &&
    data.journals && typeof data.journals === "object" &&
    data.releases && typeof data.releases === "object"
  )
}

function adopt(data) {
  _index = data
  _nameMap = null
  return data
}

/** Milliseconds since epoch of an index's build time, 0 when it carries none. */
function builtAt(data) {
  const t = Date.parse(data?.generated_at ?? "")
  return Number.isFinite(t) ? t : 0
}

/**
 * Write the index into the world's data directory so it outlives the session.
 * GM only: players have no write access, and one writer is enough.
 */
async function persist(data) {
  if (!game.user?.isGM) return false
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker
  if (!FP?.upload) return false
  const source = (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge === true) ? "forgevtt" : "data"

  try {
    // mkdir -p, tolerating "already exists" at every level.
    let path = ""
    for (const part of PERSIST_DIR.split("/")) {
      path = path ? `${path}/${part}` : part
      try { await FP.createDirectory(source, path, {}) }
      catch (e) { if (!/exists/i.test(String(e?.message || e))) throw e }
    }

    const blob = new Blob([JSON.stringify(data)], { type: "application/json" })
    const file = new File([blob], PERSIST_FILE, { type: "application/json" })
    await FP.upload(source, PERSIST_DIR, file, {}, { notify: false })
    return true
  } catch (err) {
    // A world on read-only storage simply keeps using the in-memory copy.
    console.warn("Beneos | POI index could not be stored locally", err)
    return false
  }
}

/**
 * Background refresh. Checks the tiny head file first so the common case costs
 * a few hundred bytes. Never throws, never blocks the caller.
 */
async function refreshFromCloud() {
  if (!CLOUD_REFRESH_ENABLED) return
  if (_refreshTried) return
  _refreshTried = true
  try {
    const head = await fetchJson(CLOUD_HEAD_URL, CLOUD_TIMEOUT_MS)
    if (!head || Number(head.schema) !== SUPPORTED_SCHEMA) return

    // Same content: nothing to do. Older content: the cloud is behind us, which
    // can happen right after a module update, so we keep what we have.
    if (_index && head.index_version === _index.index_version) return
    if (_index && builtAt(head) <= builtAt(_index)) return

    const fresh = await fetchJson(CLOUD_INDEX_URL, CLOUD_TIMEOUT_MS * 4)
    if (!isUsable(fresh)) return
    if (_index && builtAt(fresh) <= builtAt(_index)) return

    adopt(fresh)
    const stored = await persist(fresh)
    console.log(
      `Beneos | POI index refreshed from cloud (${fresh.index_version}, ` +
      `${Object.keys(fresh.journals).length} journals${stored ? ", stored locally" : ""})`
    )
  } catch (_e) {
    /* whatever we already had stays valid */
  }
}

/**
 * Resolve the index, loading the bundled copy on first use. Lazy on purpose:
 * a world with no teleporter pins never pays for it, and the world start-up
 * must not wait on a file read.
 */
export async function getPoiIndex() {
  if (_index) { refreshFromCloud(); return _index }
  if (_loading) return _loading

  _loading = (async () => {
    // Both sources in parallel; the locally stored one is usually absent on a
    // fresh install and present on every world that has been online once.
    const [bundled, stored] = await Promise.all([
      fetchJson(BUNDLED_URL, CLOUD_TIMEOUT_MS),
      fetchJson(PERSIST_URL, CLOUD_TIMEOUT_MS)
    ])

    const candidates = [bundled, stored].filter(isUsable)
    if (!candidates.length) {
      console.warn("Beneos | no usable POI index found", { BUNDLED_URL, PERSIST_URL })
      return null
    }

    // Newest wins. A module update can legitimately ship a newer index than the
    // stored one, and a stored one can be newer than the module.
    candidates.sort((a, b) => builtAt(b) - builtAt(a))
    adopt(candidates[0])

    const from = candidates[0] === stored ? "locally stored copy" : "bundled copy"
    console.log(`Beneos | POI index loaded from ${from} (${_index.index_version}, ${Object.keys(_index.journals).length} journals)`)

    // A module update that ships a newer index replaces the stored copy, so the
    // world never falls back to something older after going offline again.
    if (stored && candidates[0] !== stored) await persist(candidates[0])

    return _index
  })()

  const out = await _loading
  _loading = null
  refreshFromCloud()
  return out
}

/**
 * The index if it is already in memory, otherwise null. Never loads, never
 * awaits.
 *
 * The cloud window builds its release cards synchronously and may not block on
 * a file read for a cosmetic badge, so it warms the index once with
 * getPoiIndex() and reads it through this afterwards. A null here means "not
 * loaded yet", which every caller must treat as "cannot tell" rather than as
 * an answer.
 */
export function peekPoiIndex() {
  return _index
}

/** Normalise a journal name for the name fallback: exact match after cleanup, never a substring. */
export function normalizeJournalName(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase()
}

function nameMap(index) {
  if (_nameMap) return _nameMap
  _nameMap = new Map()
  for (const [id, entry] of Object.entries(index.journals || {})) {
    if (!entry?.n) continue
    const key = normalizeJournalName(entry.n)
    // First writer wins: duplicate names are almost non-existent, and where they
    // do occur the entries are equivalent for resolution purposes.
    if (!_nameMap.has(key)) _nameMap.set(key, { id, ...entry })
  }
  return _nameMap
}

/** Index entry by document id, or null. */
export function entryById(index, journalId) {
  if (!index || !journalId) return null
  const e = index.journals?.[journalId]
  return e ? { id: journalId, ...e } : null
}

/** Index entry by exact (normalised) journal name, or null. */
export function entryByName(index, journalName) {
  if (!index || !journalName) return null
  return nameMap(index).get(normalizeJournalName(journalName)) || null
}

/**
 * Release metadata as recorded in the index, or null.
 *
 * `scenes` is the number of scenes the package ships and is the denominator of
 * the completeness test: it is counted from the pack at build time, so it is
 * the only figure that does not depend on what a particular world did. Measured
 * on index 6f8a5c6b: present on all 143 releases. A release the index does not
 * know yields null, and callers must then not claim incompleteness.
 */
export function releaseInfo(index, releaseDir) {
  if (!index || !releaseDir) return null
  const r = index.releases?.[releaseDir]
  return r ? { releaseDir, ...r } : null
}

/**
 * Is this journal id known to the Beneos index at all?
 *
 * This is the authoritative Beneos-ness test for a pin whose journal document is
 * missing from the world. A document id from somebody else's world is never in
 * here, so third-party worlds can not accidentally trip the Beneos install path.
 */
export function isKnownJournal(index, journalId) {
  return Boolean(index && journalId && index.journals?.[journalId])
}

export function indexVersion(index) {
  return index?.index_version || ""
}
