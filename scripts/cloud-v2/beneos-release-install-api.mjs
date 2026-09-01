/**
 * Public release-install API for external callers (poi-teleport).
 *
 * Entry points on `game.beneos.api`:
 *
 *   resolveReleaseForJournal(journalId, opts)  -> resolution, no UI, no side effects
 *   installReleaseForTarget({ journalId, ... }) -> resolve, confirm, install
 *   installReleaseByNumber(releaseNum, opts)   -> legacy adapter, unchanged signature
 *   capabilities                               -> { poiIndex: 2 }
 *
 * The POI Teleporter calls this when a GM right-clicks a Beneos map-note whose
 * target scene is not in the world.
 *
 * Why the shape changed
 * ---------------------
 * The release NUMBER is not a usable key. It is parsed out of a journal name
 * frozen at pack time, it drops letter suffixes (0020b became 20), and it is
 * ambiguous between the main series and the single-map series. Matching it
 * against other names then compounded the error. Resolution is now keyed on the
 * target JournalEntry id against an index built from the packages themselves.
 *
 * Two rules govern everything below:
 *   - Installing the wrong pack is worse than installing nothing. It costs the
 *     user gigabytes and does not fix their pin. So every guessing stage that
 *     could not verify its answer was removed rather than tightened.
 *   - POI must also stay harmless in third-party worlds. Beneos-ness is decided
 *     by the index (a foreign document id is never in it), never by a fuzzy name.
 *
 * Resolution order, each stage returning early:
 *   1. index by journal id      -> `p[0]`, or a definitive "no package provides
 *                                  a scene for this" when `p` is empty
 *   2. index by exact journal name (for pins whose journal document is gone)
 *   3. local catalog by release token, side series excluded, unique match only
 *   4. give up honestly and open the cloud browser
 *
 * This file stays self-contained: it registers its own hooks and attaches to
 * game.beneos.api itself, so it never edits beneos_module.js or the cloud window.
 */

import { getPoiIndex, entryById, entryByName, releaseInfo, indexVersion } from "./beneos-poi-index.mjs"
import { BeneosInstallState } from "./beneos-install-state.mjs"

const MODULE_ID = "beneos-module"
const RES_SETTING = "battlemap-active-resolution"

/** Localize with an inline English fallback so the API works even pre-i18n-load. */
function L(key, fallback) {
  const s = game.i18n?.localize?.(key)
  return (s && s !== key) ? s : fallback
}
function Lf(key, data, fallback) {
  try {
    const s = game.i18n?.format?.(key, data)
    if (s && s !== key) return s
  } catch (_e) { /* fall through */ }
  // naive fallback interpolation
  return String(fallback).replace(/\{(\w+)\}/g, (_, k) => (data?.[k] ?? ""))
}

/** Human-readable byte size. Mirrors the cloud window's #formatBytes shape. */
function formatBytes(bytes) {
  const b = Number(bytes)
  if (!Number.isFinite(b) || b <= 0) return ""
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = b, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** Read the persisted battlemap resolution (4K|HD), default 4K. */
function activeResolution() {
  try {
    const v = game.settings?.get?.(MODULE_ID, RES_SETTING)
    if (v === "HD" || v === "4K") return v
  } catch (_e) { /* setting maybe not registered */ }
  return "4K"
}

/**
 * Which install variants a release actually offers, derived from variant_dirs
 * and variants_available (NOT from nb_variants, which can be stale/missing).
 * `both` drives the 4K/HD choice in the confirm dialog.
 */
function variantInfo(release) {
  const vdirs = (release?.variant_dirs && typeof release.variant_dirs === "object") ? release.variant_dirs : {}
  const avail = Array.isArray(release?.variants_available) ? release.variants_available : Object.keys(vdirs)
  const has4K = avail.includes("4K") || !!vdirs["4K"]
  const hasHD = avail.includes("HD") || !!vdirs["HD"]
  const hasSingle = !!vdirs.SINGLE || (!has4K && !hasHD)
  return { vdirs, has4K, hasHD, hasSingle, both: has4K && hasHD }
}

/**
 * Confirmation dialog with a 4K/HD selection and the download size.
 * Returns { variant } ("4K" | "HD" | "" for single-variant) or null on cancel.
 */
async function promptInstall(release) {
  const DialogV2 = foundry?.applications?.api?.DialogV2
  const vi = variantInfo(release)
  const bpv = release?.bytes_per_variant || {}
  const sceneCount = Number(release?.scene_count ?? release?.nb_scenes ?? 0) || 0
  const name = release?.display_name || release?.release_dir || ""
  const def = activeResolution()

  const sizeFor = (key) => {
    const txt = formatBytes(bpv?.[key])
    return txt ? ` (${txt})` : ""
  }

  // No DialogV2 (very old Foundry) -> proceed with the stored/only resolution.
  if (!DialogV2?.wait) return { variant: vi.both ? def : (vi.has4K ? "4K" : vi.hasHD ? "HD" : "") }

  const scenesLine = sceneCount
    ? `<p class="bcri-scenes">${Lf("BENEOS.Cloud.Bmap.PoiInstall.Scenes", { count: sceneCount }, "{count} scenes")}</p>`
    : ""

  let body
  if (vi.both) {
    // Both qualities available -> let the user choose (disk-space awareness).
    const checked4K = def !== "HD"
    body = `
      <p class="bcri-quality-label"><strong>${L("BENEOS.Cloud.Bmap.PoiInstall.Quality", "Quality")}</strong></p>
      <div class="bcri-quality" style="display:flex;gap:1.5em;margin:.25em 0 .5em;">
        <label style="cursor:pointer;"><input type="radio" name="bvar" value="4K" ${checked4K ? "checked" : ""}> 4K${sizeFor("4K")}</label>
        <label style="cursor:pointer;"><input type="radio" name="bvar" value="HD" ${checked4K ? "" : "checked"}> HD${sizeFor("HD")}</label>
      </div>
      ${scenesLine}`
  } else {
    // Single quality available -> still show the download size so the user
    // knows how much disk the install needs before confirming.
    const onlyKey = vi.has4K ? "4K" : vi.hasHD ? "HD" : "SINGLE"
    const sz = sizeFor(onlyKey) || sizeFor("SINGLE") || sizeFor("4K") || sizeFor("HD")
    const sizeTxt = sz ? sz.replace(/^ \((.*)\)$/, "$1") : ""
    const sizeLine = sizeTxt
      ? `<p class="bcri-size"><strong>${L("BENEOS.Cloud.Bmap.PoiInstall.SizeLabel", "Download size")}:</strong> ${sizeTxt}</p>`
      : ""
    body = `${scenesLine}${sizeLine}`
  }

  const content = `<div class="beneos-release-install">
    <p>${Lf("BENEOS.Cloud.Bmap.PoiInstall.Intro", { name: foundry.utils.escapeHTML(name) },
      "About to install '{name}' into this world.")}</p>
    ${body}
  </div>`

  let result = null
  try {
    result = await DialogV2.wait({
      window: { title: Lf("BENEOS.Cloud.Bmap.PoiInstall.Title", { name }, "Install {name}") },
      content,
      buttons: [
        {
          action: "install",
          label: L("BENEOS.Cloud.Bmap.PoiInstall.Install", "Install"),
          default: true,
          callback: (event, button, dialog) => {
            if (!vi.both) return { variant: vi.has4K ? "4K" : vi.hasHD ? "HD" : "" }
            const root = button?.form ?? dialog?.element ?? null
            const sel = root?.querySelector?.('input[name="bvar"]:checked')
            return { variant: sel?.value === "HD" ? "HD" : "4K" }
          },
        },
        { action: "cancel", label: L("BENEOS.Cloud.Bmap.PoiInstall.Cancel", "Cancel") },
      ],
      rejectClose: false,
    })
  } catch (_e) {
    return null
  }
  if (!result || result === "cancel" || typeof result !== "object") return null
  return result
}

/**
 * Open the cloud browser window. When a release is given, focus its bmap
 * release card so the drawer (and its Join-Patreon state) is shown. Any
 * focusing failure is swallowed: the window still opens (never a dead end).
 */
async function openCloudWindowOnRelease(release) {
  let Win = globalThis.BeneosCloudWindowV2
  if (!Win) {
    try { Win = (await import("./cloud-window-v2.mjs"))?.BeneosCloudWindowV2 } catch (_e) { /* ignore */ }
  }
  if (!Win) {
    ui.notifications?.error?.(L("BENEOS.Cloud.Bmap.PoiInstall.WindowMissing",
      "Beneos cloud window is not available."))
    return
  }
  const win = new Win()
  try { await win.render({ force: true }) }
  catch (_e) { try { win.render(true) } catch (_e2) { /* ignore */ } }

  if (!release?.release_dir) return
  try {
    win.searchMode = "bmap"
    win._bmapViewMode = "releases"
    win.selectedAssetKey = release.release_dir
    await win.render({ parts: ["results"] })
  } catch (e) {
    console.warn("Beneos | could not focus release in cloud window", e)
  }
}

/**
 * Release token of an on-disk release_dir, letter suffix preserved:
 * `bm_0057b` -> "57b", `bm_0005` -> "5". Empty for every side series, which is
 * exactly what we want: those must never be reachable through a bare number.
 */
function releaseTokenFromDir(dir) {
  const m = /^bm_(\d{4})([a-z]?)$/.exec(String(dir || "").trim())
  return m ? `${parseInt(m[1], 10)}${m[2]}` : ""
}

/** Normalise a token from either side of the comparison ("0020b" -> "20b"). */
function normalizeToken(token) {
  const m = /^0*(\d+)([a-z]?)$/i.exec(String(token || "").trim())
  return m ? `${parseInt(m[1], 10)}${(m[2] || "").toLowerCase()}` : ""
}

/** Fetch the cloud-ready release list, or [] on any failure. */
async function safeListReleases() {
  const mgr = window.BeneosScenePacker
  if (!mgr || typeof mgr.listReleases !== "function") return []
  try {
    const list = await mgr.listReleases()
    return Array.isArray(list) ? list : []
  } catch (e) {
    console.warn("Beneos | listReleases failed", e)
    return []
  }
}

/**
 * Last-resort bridge from a release token to an on-disk release_dir, using the
 * LOCAL bmap catalog. Deliberately far stricter than its predecessor:
 *
 *   - only `properties.release_dir` is read. The old version also mined the
 *     per-scene catalog KEY and `download_pack`, which is why `bm_single_map_0005`
 *     could claim the number 5 and steal it from `bm_0005`. Which one won was
 *     decided by the key order of a JSON file we do not control.
 *   - every side series is excluded up front. A destination must never send the
 *     user into a single-map, bundle, combo, tour, landing or extras package
 *     just because the digits happened to line up.
 *   - the token keeps its letter suffix, so `bm_0057b` is reachable and, more
 *     importantly, "57" no longer silently matches it.
 *   - a non-unique result yields "" rather than a first-match-wins pick.
 *
 * @returns {string} release_dir or "".
 */
function catalogReleaseDirForToken(token) {
  const want = normalizeToken(token)
  if (!want) return ""
  const catalog = game.beneos?.databaseHolder?.getAll?.("bmap")
  if (!catalog || typeof catalog !== "object") return ""

  const hits = new Set()
  for (const key in catalog) {
    const dir = String(catalog[key]?.properties?.release_dir || "").trim()
    if (!dir) continue
    if (releaseTokenFromDir(dir) === want) hits.add(dir)
  }
  return hits.size === 1 ? [...hits][0] : ""
}

/** Look up one cloud-ready release by its release_dir. */
function findCloudRelease(list, releaseDir) {
  if (!releaseDir) return null
  return list.find(r => String(r?.release_dir || "") === releaseDir) || null
}

/**
 * Strip the trailing release number from a cloud display name, since the number
 * is rendered separately. "Barovia Village - 11" -> "Barovia Village".
 */
function cleanDisplayName(s) {
  // U+2013 and U+2014 are the two longer separator code points that turn up in
  // legacy display names next to the plain hyphen.
  const SEPARATORS = "-" + String.fromCharCode(0x2013, 0x2014)
  return String(s || "").replace(new RegExp(`\\s*[${SEPARATORS}]\\s*\\d{1,4}[a-z]?\\s*$`, "i"), "").trim()
}

/**
 * Run the WHOLE-release install by delegating to the cloud window's proven
 * installer (`_onCloudBattlemapInstallNative`, scope "release"). That method
 * derives the on-disk packId from the release's `variant_dirs`, uses the
 * release cover thumbnail, and installs the entire release. We pre-seed the
 * window's release index from the already-fetched list so its internal lazy
 * load / re-render never runs (no stray window pops open).
 * @param {string} releaseDir  the release_dir key (matches listReleases).
 * @param {Array}  list        the listReleases() payload (cloud-ready releases).
 */
async function runNativeReleaseInstall(releaseDir, list) {
  let Win = globalThis.BeneosCloudWindowV2
  if (!Win) {
    try { Win = (await import("./cloud-window-v2.mjs"))?.BeneosCloudWindowV2 } catch (_e) { /* ignore */ }
  }
  if (!Win || typeof Win._onCloudBattlemapInstallNative !== "function") {
    ui.notifications?.error?.(L("BENEOS.Cloud.Bmap.PoiInstall.InstallerMissing",
      "Beneos installer is not ready. Please try again in a moment."))
    return
  }
  const win = new Win()
  // Pre-seed the release index so the static method skips #ensureReleasesLoaded
  // (and its re-render, which would otherwise open this window).
  try {
    if (Array.isArray(list) && list.length) {
      win._releaseList = list
      win._releaseIndex = new Map(list.map(r => [r.release_dir, r]))
    }
  } catch (_e) { /* ignore */ }
  try {
    await Win._onCloudBattlemapInstallNative.call(win, null, releaseDir, "release")
  } catch (err) {
    console.warn("Beneos | delegated release install failed", { releaseDir, err })
    ui.notifications?.error?.(`${releaseDir}: ${err?.message || err}`)
  }
}

/** Empty resolution, so every caller can read the same fields unconditionally. */
function emptyResolution(resolvedBy = "none") {
  return {
    found: false, kind: "unknown", releaseDir: null, cloudId: null,
    title: null, label: null, series: null, sceneName: null, sceneId: null,
    installed: false, cloudReady: false, ambiguous: false, candidates: [],
    // Graded install verdict. null everywhere means "not decidable", which is
    // the honest state for an old index that carries no scene id, and must
    // never be read as false. See describeInstall() for what fills these.
    destinationRecorded: null, destinationInWorld: null,
    installedSceneCount: 0, releaseSceneCount: 0,
    resolvedBy, indexVersion: null
  }
}

/**
 * The verdict itself, as a pure function of four measured values.
 *
 * WHY THE ROW COUNT WAS NOT ENOUGH
 *
 * Up to here the answer was `findByReleaseDir(dir).length > 0`, one boolean
 * meaning "the registry knows this release". POI turned that into "the release
 * is installed but ships no scene for this pin, please report this to Beneos".
 * The two statements are not the same, and three ordinary situations pull them
 * apart, none of them a packaging defect:
 *
 *   - a scene-scoped install writes the whole release dir with the ids of the
 *     scenes it imported (beneos-native-installer #recordInstallIfAny), and its
 *     dependency closure pulls in the JOURNALS the scene's pins point at
 *     without their target scenes. Journal present, destination absent,
 *     registry says yes.
 *   - a bundle run stopped or skipped after some members were written.
 *   - the user deleted the scene after installing it.
 *
 * In all three the customer was told to file a report that is not one. The
 * index has carried the destination's scene id all along (measured on index
 * 6f8a5c6b: of 2173 teleport journals, 2143 name a providing package, and all
 * 2143 of those carry the scene id), so the question can simply be asked
 * properly.
 *
 * `null` means NOT DECIDABLE and must never be read as false: an index too old
 * to name a scene id has to leave the question open rather than answer it.
 *
 * @param {object} m
 * @param {?string} m.sceneId            destination scene id from the index
 * @param {boolean} m.rowExists          the registry holds a row for this release
 * @param {boolean} m.sceneRecorded      that row's ids include the destination
 * @param {boolean} m.sceneInWorld       the scene document is in this world
 * @param {number}  m.installedSceneCount
 * @param {number}  m.releaseSceneCount
 */
export function gradeInstall({ sceneId, rowExists, sceneRecorded, sceneInWorld,
                               installedSceneCount, releaseSceneCount }) {
  return {
    installed: Boolean(rowExists),
    destinationRecorded: sceneId ? Boolean(sceneRecorded) : null,
    destinationInWorld: sceneId ? Boolean(sceneInWorld) : null,
    installedSceneCount: Number(installedSceneCount || 0),
    releaseSceneCount: Number(releaseSceneCount || 0),
  }
}

/** Collect the four values gradeInstall() needs, then write its answer onto `out`. */
function describeInstall(out, index) {
  const sceneId = out.sceneId
  Object.assign(out, gradeInstall({
    sceneId,
    rowExists: BeneosInstallState.findByReleaseDir(out.releaseDir).length > 0,
    sceneRecorded: sceneId ? BeneosInstallState.hasScene(out.releaseDir, sceneId) : false,
    sceneInWorld: sceneId ? Boolean(game.scenes?.get?.(sceneId)) : false,
    installedSceneCount: BeneosInstallState.installedSceneIds(out.releaseDir).size,
    releaseSceneCount: releaseInfo(index, out.releaseDir)?.scenes,
  }))
}

/**
 * Resolve a teleporter target to the release that ships its destination scene.
 * Pure lookup: no dialogs, no downloads, no notifications. POI calls this to
 * BUILD ITS MESSAGE, which is why it has to exist separately from the install.
 *
 * `found: false` with `resolvedBy: "index"` is a strong statement, not a
 * failure: the index knows this journal and knows that no package provides a
 * scene for it. The caller must then stop, not fall through to guessing.
 *
 * @param {string} journalId              target JournalEntry id (note.entryId)
 * @param {object} [opts]
 * @param {string} [opts.journalName]     name, for the exact-name fallback and display
 * @param {string} [opts.releaseToken]    release token incl. letter suffix ("57b")
 * @param {number} [opts.releaseHint]     legacy numeric hint, used only if no token
 * @returns {Promise<object>} resolution, incl. the graded install verdict from
 *                            describeInstall(). `installed` alone answers "does
 *                            the registry know this release"; only
 *                            `destinationRecorded` and `destinationInWorld`
 *                            answer whether THIS destination is here.
 */
export async function resolveReleaseForJournal(journalId, { journalName, releaseToken, releaseHint } = {}) {
  const index = await getPoiIndex()
  const out = emptyResolution()
  out.indexVersion = indexVersion(index)

  // --- stage 1: the document id, which is the only stable key we have.
  let entry = entryById(index, journalId)
  let resolvedBy = "index"

  // --- stage 2: exact name, for pins whose journal document is gone from the world.
  if (!entry && journalName) {
    entry = entryByName(index, journalName)
    if (entry) resolvedBy = "index-name"
  }

  if (entry) {
    out.kind = entry.k === "c" ? "content" : entry.k === "t" ? "teleport" : "unknown"
    out.resolvedBy = resolvedBy

    // A content journal (documentation, navigation, lore) is not a destination.
    // It must never produce an install offer, no matter what its name looks like.
    if (out.kind === "content") return out

    if (entry.p?.length) {
      out.releaseDir = entry.p[0]
      out.found = true
      out.ambiguous = entry.p.length > 1
      out.candidates = entry.p.map(dir => {
        const ri = releaseInfo(index, dir)
        return { releaseDir: dir, title: ri?.title || dir, label: ri?.label || "" }
      })
      const scene = (entry.s || []).find(s => s.r === out.releaseDir) || (entry.s || [])[0]
      out.sceneName = scene?.t || null
      // The scene document id, which is what makes "is THIS destination here"
      // answerable at all. Stable across installs, so it joins the index
      // against both the install registry and game.scenes.
      out.sceneId = scene?.i || null
    } else {
      // Known journal, but no package anywhere ships a scene for it. Definitive.
      return out
    }
  }

  // --- stage 3: local catalog by token. Unique main-series match only.
  if (!out.releaseDir) {
    const token = releaseToken || (Number.isFinite(Number(releaseHint)) ? String(releaseHint) : "")
    const dir = catalogReleaseDirForToken(token)
    if (dir) {
      out.releaseDir = dir
      out.found = true
      out.kind = "teleport"
      out.resolvedBy = "catalog-number"
    } else {
      // --- stage 4: honest give-up. No further stage may guess.
      return out
    }
  }

  // Enrich from the index, then let the cloud's own naming win where available.
  const info = releaseInfo(index, out.releaseDir)
  if (info) {
    out.title = info.title || null
    out.label = info.series === "bm" ? (info.label || "") : ""
    out.series = info.series || null
  }

  const list = await safeListReleases()
  const cloudRelease = findCloudRelease(list, out.releaseDir)
  if (cloudRelease) {
    out.cloudReady = true
    out.cloudId = cloudRelease.cloud_release_id || null
    const display = cleanDisplayName(cloudRelease.display_name)
    if (display) out.title = display
  }
  if (!out.title) out.title = out.releaseDir

  try { describeInstall(out, index) } catch (_e) { /* ignore */ }

  return out
}

/**
 * Cheap Beneos-ness test for a single journal id: a map lookup after the index
 * is loaded once, with no release list and no network.
 *
 * POI needs this on every note of every scene it draws, so it must stay cheap,
 * and it must be separate from resolveReleaseForJournal() for exactly that
 * reason. A document id from a third-party world is never in the index, so this
 * can not produce a false positive on somebody else's content.
 *
 * @param {string} journalId
 * @returns {Promise<""|"teleport"|"content">}
 */
export async function classifyBeneosJournal(journalId) {
  if (!journalId) return ""
  const entry = entryById(await getPoiIndex(), journalId)
  if (!entry) return ""
  if (entry.k === "t") return "teleport"
  if (entry.k === "c") return "content"
  return ""
}

/**
 * Resolve and, when possible, install the release that provides a teleporter
 * target. Same confirm / access / delegate flow as before, but it can no longer
 * be pointed at a package that does not contain the destination.
 *
 * @param {object} opts
 * @param {string} [opts.journalId]    target JournalEntry id (preferred key)
 * @param {string} [opts.journalName]  target journal name
 * @param {string} [opts.releaseToken] release token incl. letter suffix
 * @param {number} [opts.releaseHint]  legacy numeric hint
 * @returns {Promise<object>} { status, ...resolution }
 */
export async function installReleaseForTarget(opts = {}) {
  const cloud = game.beneos?.cloud
  const res = await resolveReleaseForJournal(opts.journalId, opts)
  const done = (status) => ({ status, ...res })

  // Content journals get an info text from POI, never a download.
  if (res.kind === "content") return done("content")

  // Nothing verified: open the browser and let the user decide. We deliberately
  // do NOT fall back to a name or number guess here.
  if (!res.found || !res.releaseDir) {
    await openCloudWindowOnRelease(null)
    return done("not-found")
  }

  const list = await safeListReleases()
  const release = findCloudRelease(list, res.releaseDir)
  if (!release) {
    // Known destination, but the release is not cloud-ready for this user.
    await openCloudWindowOnRelease(null)
    return done("browser-opened")
  }

  const loggedIn = cloud?.isLoggedIn?.() === true
  const hasAccess = loggedIn && cloud?.hasCampaignAccess?.("battlemaps") === true
  if (!hasAccess) {
    ui.notifications?.info?.(L("BENEOS.Cloud.Bmap.PoiInstall.NoAccess",
      "An active Beneos Battlemaps membership is required to install this release."))
    await openCloudWindowOnRelease(release)
    return done("no-access")
  }

  const choice = await promptInstall(release)
  if (!choice) return done("cancelled")

  const vi = variantInfo(release)
  let variant = ""
  if (vi.both) variant = choice.variant === "HD" ? "HD" : "4K"
  else if (vi.has4K) variant = "4K"
  else if (vi.hasHD) variant = "HD"
  if (variant === "4K" || variant === "HD") {
    try { await game.settings.set(MODULE_ID, RES_SETTING, variant) } catch (_e) { /* ignore */ }
  }

  await runNativeReleaseInstall(release.release_dir, list)
  return done("installed")
}

/**
 * Legacy entry point, signature unchanged so older poi-teleport builds in the
 * field keep working. They now benefit from the hardened resolution without any
 * update on their side: the fuzzy name stage is gone and the catalog stage no
 * longer confuses the main series with the single-map series.
 *
 * @param {number} [releaseNum]     Beneos release number (e.g. 46).
 * @param {object} [opts]
 * @param {string} [opts.journalId] target journal id, when the caller knows it
 * @param {number} [opts.mapHint]   scene number within the release (whole-release install)
 * @param {string} [opts.typeHint]  type code (BM/SC)
 * @param {string} [opts.name]      target journal name
 */
export async function installReleaseByNumber(releaseNum, { journalId, mapHint, typeHint, name } = {}) {
  return installReleaseForTarget({
    journalId,
    journalName: name,
    releaseHint: releaseNum,
    mapHint,
    typeHint
  })
}

// Self-register on the public API surface. game.beneos is created at init by
// beneos_module.js, so it exists by ready. Guarded so a partial boot never throws.
Hooks.once("ready", () => {
  if (!game.beneos) return
  game.beneos.api = game.beneos.api || {}
  game.beneos.api.installReleaseByNumber = installReleaseByNumber
  game.beneos.api.installReleaseForTarget = installReleaseForTarget
  game.beneos.api.resolveReleaseForJournal = resolveReleaseForJournal
  game.beneos.api.classifyBeneosJournal = classifyBeneosJournal
  // Capability marker rather than function sniffing: `typeof fn === "function"`
  // only proves a name exists, not that it honours this contract.
  //
  // 2: the resolution carries the destination's scene id and the graded install
  // verdict (destinationRecorded / destinationInWorld). POI must gate its new
  // message branches on >= 2, because against a version-1 module those fields
  // are absent and "absent" would read as "not recorded", which is exactly the
  // false accusation this change removes.
  game.beneos.api.capabilities = Object.assign({}, game.beneos.api.capabilities, { poiIndex: 2 })
})
