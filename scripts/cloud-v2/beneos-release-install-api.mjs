/**
 * Public release-install API for external callers (poi-teleport).
 *
 * Exposes a single stable entry point on `game.beneos.api`:
 *
 *   game.beneos.api.installReleaseByNumber(releaseNum, { mapHint, typeHint })
 *
 * The POI Teleporter calls this when a GM clicks "Install Missing Pack" on a
 * Beneos map-note whose target scene is not in the world. The release number
 * comes from the note's `flags["poi-teleport"].releaseHint`.
 *
 * Flow:
 *   1. Resolve the POI's reference to a CLOUD-READY release (a listReleases()
 *      entry) via the parsed number, a local-catalog number->release_dir bridge,
 *      or a display_name match. Releases that exist only in the local catalog
 *      (not yet on the cloud) resolve to null.
 *   2. Not cloud-ready / not found -> open the cloud browser so the user can
 *      find it manually (no error notification).
 *   3. No access (not logged in / not an active battlemaps patron) -> open the
 *      cloud window focused on the release so its drawer shows the Join Patreon
 *      state.
 *   4. Access -> confirmation dialog with a 4K/HD choice and the download size,
 *      persist the chosen resolution, then DELEGATE the whole-release install to
 *      the cloud window's proven installer (_onCloudBattlemapInstallNative,
 *      scope "release"), which derives the correct packId from variant_dirs and
 *      uses the release cover.
 *
 * This file is intentionally self-contained: it registers its own ready hook
 * and attaches to game.beneos.api itself, so it never edits beneos_module.js
 * or the cloud window. The only shared touch is its esmodule entry in
 * module.json.
 */

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
 * Extract a Beneos release number from a single identifier string. The catalog
 * encodes the number several ways and NONE of them is a guaranteed bare integer:
 *   - pack / release_dir slug:  `bm_0011_cos_barovia_village` (optionally
 *     `beneos_`-prefixed) -> 11
 *   - per-scene catalog key:    `11-00_1F-4K_Still_Battlemap_GRIDLESS` -> 11
 *   - download_pack label:      `Barovia Village - 11` -> 11
 * Returns NaN when no number is found.
 */
function releaseNumFromString(s) {
  const str = String(s || "")
  // `bm_0011_slug` / `beneos_bm_0011_...` (the `beneos_` prefix is OPTIONAL;
  // requiring it was the original bug that left release 11 unresolved).
  let m = str.match(/(?:^|[^a-z0-9])bm_0*(\d+)[_-]/i)
  if (m) return parseInt(m[1], 10)
  // Catalog key `11-00_...` / `11_08_...` (leading number, then sep + digit).
  m = str.match(/^0*(\d+)[-_]\d/)
  if (m) return parseInt(m[1], 10)
  // download_pack trailing `… - 11`.
  m = str.match(/-\s*0*(\d+)\s*$/)
  if (m) return parseInt(m[1], 10)
  return NaN
}

/**
 * Does a release object (from listReleases) belong to the given release number?
 * Matches against release_num (bare integer) OR the number encoded in
 * release_dir / pack / download_pack, so a POI's parsed number resolves even
 * when release_num is formatted differently than the bare integer.
 */
function releaseMatchesNumber(r, want) {
  const direct = parseInt(r?.release_num, 10)
  if (Number.isFinite(direct) && direct === want) return true
  for (const f of [r?.release_dir, r?.pack, r?.download_pack]) {
    if (releaseNumFromString(f) === want) return true
  }
  return false
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
 * Bridge a release number to its on-disk release_dir using the LOCAL bmap
 * catalog (`databaseHolder.getAll("bmap")`). The catalog lists every release
 * (cloud-ready or not); each per-scene entry carries `properties.release_dir`,
 * which is exactly the key the cloud window indexes releases by
 * (`_releaseIndex`, see `_onCloudBattlemapInstallNative`). We only return the
 * release_dir string; whether that release is actually installable is decided
 * afterwards by checking it against listReleases().
 * @returns {string} release_dir or "".
 */
function catalogReleaseDirForNumber(want) {
  if (!Number.isFinite(want)) return ""
  const catalog = game.beneos?.databaseHolder?.getAll?.("bmap")
  if (!catalog || typeof catalog !== "object") return ""
  for (const key in catalog) {
    const props = catalog[key]?.properties || {}
    const num = [props.release_dir, props.pack, props.download_pack, key]
      .map(releaseNumFromString)
      .find(n => Number.isFinite(n))
    if (num === want && props.release_dir) return String(props.release_dir).trim()
  }
  return ""
}

/**
 * Resolve a POI's release reference to a CLOUD-READY release object (an entry of
 * listReleases()), or null. The install path works exclusively with these, so a
 * non-cloud-ready release (present only in the local catalog) resolves to null
 * and the caller opens the cloud browser instead of forcing a 404 install.
 *
 * Order: (a) number match directly in listReleases; (b) number -> release_dir
 * via the local catalog, then exact release_dir lookup in listReleases;
 * (c) display_name match for special releases without a number.
 * @returns {Promise<object|null>}
 */
async function resolveCloudRelease(releaseNum, name) {
  const list = await safeListReleases()
  if (!list.length) return null

  const want = parseInt(releaseNum, 10)
  if (Number.isFinite(want)) {
    let rel = list.find(r => releaseMatchesNumber(r, want))
    if (rel) return rel
    const dir = catalogReleaseDirForNumber(want)
    if (dir) {
      rel = list.find(r => String(r?.release_dir || "") === dir)
      if (rel) return rel
    }
  }

  if (name) {
    const q = normalizeReleaseName(name)
    if (q) {
      const norm = r => normalizeReleaseName(r?.display_name)
      return list.find(r => norm(r) === q)
          || list.find(r => { const n = norm(r); return n && (n.includes(q) || q.includes(n)) })
          || null
    }
  }
  return null
}

/**
 * Normalise a release / journal name to a comparable search term:
 * strip the teleporter prefix, collapse separators, lowercase.
 */
function normalizeReleaseName(s) {
  return String(s || "")
    .replace(/^DontTouch-POI-Teleporter-?/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
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

/**
 * Public entry point. See file header for the full flow.
 * @param {number} [releaseNum]           Beneos release number (e.g. 46).
 * @param {object} [opts]
 * @param {number} [opts.mapHint]         scene number within the release (unused for whole-release install; kept for future per-map scope)
 * @param {string} [opts.typeHint]        type code (BM/SC) hint (reserved)
 * @param {string} [opts.name]            target journal name; used to resolve special releases (no number) via display_name match
 */
export async function installReleaseByNumber(releaseNum, { mapHint, typeHint, name } = {}) {
  const cloud = game.beneos?.cloud

  // Resolve to a CLOUD-READY release object (a listReleases entry). A release
  // that exists only in the local catalog (not yet on the cloud) resolves to
  // null on purpose.
  const release = await resolveCloudRelease(releaseNum, name)

  // (2) Not cloud-ready / not found -> silently open the browser so the user
  // can find it manually (no extra notification, per the agreed behaviour).
  if (!release) {
    await openCloudWindowOnRelease(null)
    return
  }

  // (3) No access -> open the window focused on the release (Join Patreon state).
  const loggedIn = cloud?.isLoggedIn?.() === true
  const hasAccess = loggedIn && cloud?.hasCampaignAccess?.("battlemaps") === true
  if (!hasAccess) {
    ui.notifications?.info?.(L("BENEOS.Cloud.Bmap.PoiInstall.NoAccess",
      "An active Beneos Battlemaps membership is required to install this release."))
    await openCloudWindowOnRelease(release)
    return
  }

  // (4) Access -> confirm (4K/HD + real size from listReleases), persist the
  // chosen resolution, then delegate the whole-release install to the proven
  // cloud-window installer (which reads the setting + derives the right packId).
  const choice = await promptInstall(release)
  if (!choice) return

  const vi = variantInfo(release)
  let variant = ""
  if (vi.both) variant = choice.variant === "HD" ? "HD" : "4K"
  else if (vi.has4K) variant = "4K"
  else if (vi.hasHD) variant = "HD"
  if (variant === "4K" || variant === "HD") {
    try { await game.settings.set(MODULE_ID, RES_SETTING, variant) } catch (_e) { /* ignore */ }
  }

  // listReleases() is cached after resolveCloudRelease(), so this is a cheap
  // re-read used only to pre-seed the delegated window's release index.
  await runNativeReleaseInstall(release.release_dir, await safeListReleases())
}

// Self-register on the public API surface. game.beneos is created at init by
// beneos_module.js, so it exists by ready. Guarded so a partial boot never throws.
Hooks.once("ready", () => {
  if (!game.beneos) return
  game.beneos.api = game.beneos.api || {}
  game.beneos.api.installReleaseByNumber = installReleaseByNumber
})
