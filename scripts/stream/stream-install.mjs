/**
 * The streaming mode of the release installer.
 *
 * Today an install copies roughly 170 files into the world and then rewrites the
 * document paths to match. In streaming mode the heavy files are not copied at
 * all: the documents carry the address of the gate instead, and the browser
 * fetches the bytes the first time a scene is actually opened.
 *
 * The split runs along the file type, not the size. Video and sound go to the
 * edge, images and JSON stay local. Measured over the fifteen beta releases:
 * 18.08 GB moves to the edge and 1.31 GB stays on the customer's disk, so an
 * install shrinks by a factor of fourteen.
 *
 * Two things are deliberately NOT done here.
 *
 * The existing rewrite is left alone. `remapAssetString` returns early after its
 * prefix swap, so a battlemap path never reaches the exact-match table, and
 * bending that function would put a beta concern into the middle of the live
 * install path. Instead the addresses are applied in a second pass afterwards,
 * against the very paths the first pass produced.
 *
 * Nothing is touched that is not in the pack list. A customer's own picture
 * appears in no manifest, so it cannot be rewritten by accident.
 */

import { assetUrl, streamEnabled } from "./stream-settings.mjs"

const PACK_SOURCE_PREFIX = "beneos_assets/beneos_battlemaps/"
const CLOUD_INSTALL_PREFIX = "beneos_assets/cloud/battlemaps/"
const DOC_DIR = "_docs/"

const stripLeadSlash = (p) => String(p).replace(/^\/+/, "")

/** Where a packed asset ends up in the world. Mirrors the installer's own rule. */
function installedPath(inWorld) {
  return inWorld.includes(PACK_SOURCE_PREFIX)
    ? inWorld.split(PACK_SOURCE_PREFIX).join(CLOUD_INSTALL_PREFIX)
    : inWorld
}

/**
 * Split a package directory into release and variant.
 *
 * The stock names them `beneos_bm_<slug>_foundry_4k`, `_hd`, or plain
 * `_foundry` for the handful of single-edition packs. The bucket is laid out
 * the same way, so the address of a file is its key and nothing has to be
 * looked up.
 */
export function releaseFromPackage(packageId) {
  const m = /^(.+?)_foundry(?:_(4k|hd))?$/i.exec(String(packageId || ""))
  if (!m) return { release: String(packageId || ""), variant: "single" }
  return { release: m[1], variant: (m[2] || "single").toLowerCase() }
}

/**
 * The file list of one release variant, as written by the preparation tool.
 * Every entry carries its role: `edge` stays an address, `local` is downloaded,
 * `doc` is a document collection.
 */
export async function loadStreamManifest(release, variant) {
  const url = assetUrl(release, variant, "stream-manifest.json")
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`stream manifest unavailable (${response.status}) for ${release}/${variant}`)
  }
  const manifest = await response.json()
  if (!Array.isArray(manifest?.entries)) {
    throw new Error(`stream manifest malformed for ${release}/${variant}`)
  }
  return manifest
}

/**
 * Turn a manifest into what the installer expects.
 *
 * `packInfo` is shaped exactly like the one a ZIP or the cloud produces, so
 * `#classifyPack` and everything behind it stay untouched. `streamTargets` is
 * the extra part: installed path -> gate address, for the files that are never
 * copied.
 */
export function buildStreamPack(manifest, release, variant) {
  const packInfo = {}
  const streamTargets = new Map()
  let edgeBytes = 0
  let localBytes = 0

  for (const entry of manifest.entries) {
    const key = stripLeadSlash(entry.key)
    const url = assetUrl(release, variant, key)

    if (key.startsWith(DOC_DIR)) {
      packInfo[`data/${key.slice(DOC_DIR.length)}`] = url
      continue
    }
    if (entry.role === "edge") {
      // Never enters packInfo: an entry there would be downloaded.
      streamTargets.set(stripLeadSlash(installedPath(key)), url)
      edgeBytes += entry.bytes || 0
      continue
    }
    packInfo[`data/assets/${key}`] = url
    localBytes += entry.bytes || 0
  }

  return { packInfo, streamTargets, edgeBytes, localBytes }
}

/**
 * Second pass over a document: swap installed paths for gate addresses.
 *
 * Runs after the installer's own rewrite, on the paths that rewrite produced.
 * Exact matches only, and only against the map built from this release's file
 * list, so anything the customer put there stays as it is.
 */
export function applyStreamAddresses(value, streamTargets) {
  if (!streamTargets || !streamTargets.size) return value

  if (typeof value === "string") {
    if (value === "") return value
    let key = stripLeadSlash(value)
    try { key = stripLeadSlash(decodeURIComponent(value)) } catch (_) { /* keep raw key */ }
    const target = streamTargets.get(key)
    return target || value
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = applyStreamAddresses(value[i], streamTargets)
    return value
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = applyStreamAddresses(value[k], streamTargets)
    return value
  }
  return value
}

/** Every gate address a release variant will ever ask for. Feeds the prewarm. */
export function streamUrlsOf(streamTargets) {
  return [...streamTargets.values()]
}

export function streamModeActive() {
  return streamEnabled()
}
