/**
 * install-ziel.mjs
 *
 * Where a pack entry is installed, and therefore under which key its signed
 * URL is indexed. #classifyPack and #doRefreshManifest in
 * beneos-native-installer.mjs both key the URL table through installZiel, so a
 * signature refresh always overwrites the entry the transfer reads (MO-011:
 * the refresh used to skip the packaged prefix, and packaged assets kept their
 * expired URL). Pure module without Foundry, tested by install-ziel.test.mjs.
 */

// Beneos cloud-install namespace. Battlemap packs are authored against
// `beneos_assets/beneos_battlemaps/...`; on cloud install we relocate them
// into the isolated `beneos_assets/cloud/battlemaps/...` namespace, mirroring
// the model items/spells already use (beneos_cloud.js rewrites
// `beneos_assets/beneos_items/` -> `beneos_assets/cloud/items/`). The prefix is
// deliberately narrow so tokens/spells/items refs are never touched.
export const PACK_SOURCE_PREFIX   = "beneos_assets/beneos_battlemaps/"
export const CLOUD_INSTALL_PREFIX = "beneos_assets/cloud/battlemaps/"
// Self-contained packs bundle every local asset a document references, including
// module-owned icons (modules/...), the scene thumbnail (worlds/<author-world>/...)
// and other non-beneos content. Those are relocated under this packaged namespace
// on install so they survive the customer disabling beneos-module or migrating
// worlds. The per-asset original->packaged mapping is built in #classifyPack.
export const PACKAGED_INSTALL_PREFIX = "beneos_assets/cloud/packaged/"

const ASSET_PREFIX = "data/assets/"

export const stripLeadSlash = (p) => String(p).replace(/^\/+/, "")

/** Swap the pack-source asset prefix for the cloud-install prefix in a string. */
export function toCloudAssetPath(p) {
  return (typeof p === "string" && p.includes(PACK_SOURCE_PREFIX))
    ? p.split(PACK_SOURCE_PREFIX).join(CLOUD_INSTALL_PREFIX)
    : p
}

/**
 * Install target of one pack entry.
 *  - `data/assets/<rel>` -> `{ target, rawRel, gepackt }`. Battlemap assets get
 *    the cloud prefix swap; anything outside a beneos_assets namespace is
 *    relocated under PACKAGED_INSTALL_PREFIX (`gepackt: true`).
 *  - every other entry keeps its relPath as key: `{ target: relPath }`.
 */
export function installZiel(relPath) {
  if (!relPath.startsWith(ASSET_PREFIX)) return { target: relPath, rawRel: null, gepackt: false }
  const rawRel = relPath.substring(ASSET_PREFIX.length)
  const swapped = toCloudAssetPath(rawRel)
  if (/^beneos_assets\//i.test(swapped)) return { target: swapped, rawRel, gepackt: false }
  return { target: PACKAGED_INSTALL_PREFIX + stripLeadSlash(swapped), rawRel, gepackt: true }
}
