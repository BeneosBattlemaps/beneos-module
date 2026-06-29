/* Home-tab controller for the Beneos Cloud window.
   Owns the data preparation for the Home PART context — news fetch (with read-
   state), Hero rotation slice selection, and "What's new in library" rails per
   category. All asset-NEW/UPDATED flags are read from game.beneos.databaseHolder
   which already has them populated by BeneosDatabaseHolder.processInstalledX
   (30-day cutoff for tokens/items/spells) and the bmap max-release pass in
   BeneosCloudWindowV2.#buildCards. */

import { fetchNewsFeed, getReadNewsIds } from "../services/news-api.mjs"
import { loadAndParseChangelog } from "./changelog-parser.mjs"
import { BeneosUtility } from "../../beneos_utility.js"

const RAIL_CATEGORIES = ["token", "bmap", "item", "spell"]
const RAIL_LIMIT_PER_GROUP = 12

function categoryLabelKey(type) {
  switch (type) {
    case "token": return "BENEOS.Cloud.Tab.Tokens"
    case "bmap":  return "BENEOS.Cloud.Tab.Maps"
    case "item":  return "BENEOS.Cloud.Tab.Items"
    case "spell": return "BENEOS.Cloud.Tab.Spells"
    default:      return ""
  }
}

function ensureBattlemapNewFlags() {
  const dbHolder = game.beneos?.databaseHolder
  const all = dbHolder?.getAll?.("bmap") || {}
  const entries = Object.entries(all)
  if (!entries.length) return
  // Reset first so a fresher DB scan doesn't keep stale NEW flags from
  // an earlier render.
  for (const [, data] of entries) { if (data) data.isNew = false }
  let maxRelease = 0
  for (const [k] of entries) {
    const m = String(k || "").match(/^(\d+)/)
    const r = m ? (parseInt(m[1], 10) || 0) : 0
    if (r > maxRelease) maxRelease = r
  }
  if (maxRelease <= 0) return
  for (const [k, data] of entries) {
    if (!data) continue
    const m = String(k || "").match(/^(\d+)/)
    const r = m ? (parseInt(m[1], 10) || 0) : 0
    if (r === maxRelease) data.isNew = true
  }
}

// Defensive map preload: touch every bmap entry once so any lazy DB
// hydration in BeneosDatabaseHolder completes before the NEW-flag scan
// runs. Cheap O(N), no side effects beyond making the data object
// readable from JS scope.
function ensureBmapHydrated() {
  const all = game.beneos?.databaseHolder?.getAll?.("bmap") || {}
  for (const data of Object.values(all)) {
    if (data && typeof data === "object") void data.properties
  }
}

// Re-run the per-asset NEW/UPDATED flag computation for `type`. The flags
// are normally set by BeneosDatabaseHolder.processInstalledX during the
// eager ready-hook buildSearchData() pass, but that pass races with
// BeneosCloud.checkAvailableContent() — when the Home tab opens before
// the cloud roundtrip resolves, `availableContent` is still empty and
// getTokenTS() returns undefined, so isNew stays false. Calling the same
// processInstalledX functions again here, after game.beneos.cloud has
// populated availableContent, fills in the flags correctly. This also
// benefits the regular tab views: subsequent tab switches read the
// already-corrected flags directly from the databaseHolder.
function refreshAssetFlags(type) {
  if (type === "bmap") { ensureBattlemapNewFlags(); return }
  const dbHolder = game.beneos?.databaseHolder
  if (!dbHolder) return
  const all = dbHolder.getAll?.(type) || {}
  const fn = type === "token" ? dbHolder.processInstalledToken
           : type === "item"  ? dbHolder.processInstalledItem
           : type === "spell" ? dbHolder.processInstalledSpell
           : null
  if (typeof fn !== "function") return
  for (const data of Object.values(all)) {
    if (!data) continue
    data.isNew = false
    data.isUpdate = false
    try { fn.call(dbHolder, data) }
    catch (_e) { /* single-asset failure is non-fatal */ }
  }
}

function pickRailItems(type) {
  if (type === "bmap") return pickBmapItems()
  if (type === "token" || type === "item" || type === "spell") return pickTimedItems(type)
  return { news: [], updates: [] }
}

// Pure rail selection for token/item/spell. Like pickBmapItems, this
// bypasses the data.isNew-mutation route because BeneosDatabaseHolder
// .getAll(type) returns a structuredClone — any flag set on one
// snapshot is lost in the next getAll call. We recompute NEW/UPD here
// from the canonical sources: cloud TS vs. local install TS, with the
// same 30-day cutoff that BeneosDatabaseHolder.processInstalledX uses
// (beneos_search_engine.js:234-390).
//
// Logged-out fallback: cloud.getXTS() reads from availableContent which
// is only populated after login. Without login, every cloudTS is 0 and
// the rail would be empty. To still show new content for non-patrons /
// signed-out users we fall back to the key-prefix release-number
// heuristic (works for all 4 asset types — DB JSONs use NNN-/NNNN_
// prefixes that increase with each release). UPDATE is intentionally
// not shown when logged out — nothing locally installed to compare.
function pickTimedItems(type) {
  const dbHolder = game.beneos?.databaseHolder
  const cloud    = game.beneos?.cloud
  const all      = dbHolder?.getAll?.(type) || {}
  const entries  = Object.entries(all)
  if (!entries.length) return { news: [], updates: [] }

  const cloudLoggedIn = !!cloud?.isLoggedIn?.()
  if (!cloudLoggedIn) return pickByReleasePrefix(type, entries)

  const t30days    = 30 * 24 * 60 * 60
  const tNow30Days = Math.floor(Date.now() / 1000) - t30days

  const getCloudTS = (key) =>
      type === "token" ? cloud?.getTokenTS?.(key)
    : type === "item"  ? cloud?.getItemTS?.(key)
    : type === "spell" ? cloud?.getSpellTS?.(key)
    : 0
  const getInstallTS = (key) =>
      type === "token" ? BeneosUtility.getTokenInstallTS?.(key)
    : type === "item"  ? BeneosUtility.getItemInstallTS?.(key)
    : type === "spell" ? BeneosUtility.getSpellInstallTS?.(key)
    : 0

  const news = []
  const updates = []
  for (const [key, data] of entries) {
    if (!data) continue
    const cloudTS = Number(getCloudTS(key) || 0)
    const installed = data?.installed === "installed"
    if (installed) {
      const installTS = Number(getInstallTS(key) || 0)
      if (cloudTS > installTS && updates.length < RAIL_LIMIT_PER_GROUP) {
        const c = buildRailCard(type, key, data)
        c.isUpdate = true
        c.isNew = false
        updates.push(c)
      }
    } else if (cloudTS > 0 && cloudTS >= tNow30Days && news.length < RAIL_LIMIT_PER_GROUP) {
      const c = buildRailCard(type, key, data)
      c.isNew = true
      c.isUpdate = false
      news.push(c)
    }
    if (news.length >= RAIL_LIMIT_PER_GROUP && updates.length >= RAIL_LIMIT_PER_GROUP) break
  }
  return { news, updates }
}

// Pure bmap rail selection. Bypasses the isNew-mutation route because
// BeneosDatabaseHolder.getAll("bmap") returns a structuredClone — any
// data.isNew=true on one snapshot is lost in the next getAll call. So
// we do it pure: read once, sort by release-prefix (^\d+), keep the
// entries that match the highest release.
// Release-prefix fallback for token/item/spell when the user is not
// logged in (cloud TS unavailable). Sorts entries by the leading-digits
// release number from the key and returns the top N. Items with prefix
// "0" (e.g. "000-srd_*") are excluded — those are SRD content, not new
// Beneos releases.
function pickByReleasePrefix(type, entries) {
  const annotated = entries.map(([key, data]) => {
    const m = String(key || "").match(/^(\d+)/)
    const release = m ? (parseInt(m[1], 10) || 0) : 0
    return { key, data, release }
  })
  const byReleaseDesc = annotated
    .filter(a => a.release > 0 && a.data)
    .sort((a, b) => b.release - a.release)
  if (!byReleaseDesc.length) return { news: [], updates: [] }
  const news = byReleaseDesc
    .slice(0, RAIL_LIMIT_PER_GROUP)
    .map(({ key, data }) => {
      const card = buildRailCard(type, key, data)
      card.isNew = true
      card.isUpdate = false
      return card
    })
  return { news, updates: [] }
}

function pickBmapItems() {
  const all = game.beneos?.databaseHolder?.getAll?.("bmap") || {}
  const entries = Object.entries(all)
  if (!entries.length) return { news: [], updates: [] }
  const annotated = entries.map(([key, data]) => {
    const m = String(key || "").match(/^(\d+)/)
    const release = m ? (parseInt(m[1], 10) || 0) : 0
    return { key, data, release }
  })
  let maxRelease = 0
  for (const a of annotated) if (a.release > maxRelease) maxRelease = a.release
  if (maxRelease <= 0) return { news: [], updates: [] }
  const news = annotated
    .filter(a => a.release === maxRelease && a.data)
    .slice(0, RAIL_LIMIT_PER_GROUP)
    .map(({ key, data }) => buildRailCard("bmap", key, data))
  return { news, updates: [] }
}

function buildRailCard(type, key, data) {
  const thumb = thumbnailFor(type, key, data)
  const name = data?.properties?.display_name
            || data?.properties?.name
            || data?.name
            || key
  const sub = subInfoFor(type, data)
  const card = {
    type,
    key,
    name,
    sub,
    thumb,
    isNew: !!data.isNew,
    isUpdate: !!data.isUpdate
  }
  if (type === "bmap") {
    const props = data?.properties || {}
    card.mouPack    = props.download_pack    || ""
    card.mouCreator = props.download_creator || ""
    card.mouTerms   = props.download_terms   || ""
    // Highest-release bmaps from pickBmapItems are always treated as new
    card.isNew = true
  }
  return card
}

function thumbnailFor(type, key, data) {
  const base = {
    token: "https://www.beneos-database.com/data/tokens/thumbnails_v2/",
    bmap:  "https://www.beneos-database.com/data/battlemaps/thumbnails/",
    item:  "https://www.beneos-database.com/data/items/thumbnails/",
    spell: "https://www.beneos-database.com/data/spells/thumbnails/"
  }[type]
  // Same lookup chain as cloud-window-v2.mjs:#enrichCard so items/spells/
  // maps that only expose .icon (not .thumbnail) still render their
  // canonical preview in the Home rails.
  const file = data?.properties?.thumbnail
            || data?.properties?.icon
            || data?.thumbnail
            || data?.icon
            || `${key}.webp`
  return base ? `${base}${file}` : ""
}

function subInfoFor(type, data) {
  const p = data?.properties || {}
  if (type === "token")  return p.type || p.cr || ""
  if (type === "bmap")   return p.download_pack || p.biom || ""
  if (type === "item")   return p.item_type || p.rarity || ""
  if (type === "spell")  return p.level ? `Level ${p.level}` : (p.school || "")
  return ""
}

function buildHeroSlides(newsItems) {
  if (!newsItems.length) return []
  const pinned = newsItems.find(n => n.isPinned)
  const rolling = newsItems.filter(n => !n.isPinned)
  const slides = []
  if (pinned) slides.push(pinned)
  for (const n of rolling) {
    if (slides.length >= 3) break
    slides.push(n)
  }
  return slides
}

function partitionNews(newsItems, readIds) {
  const pinned = newsItems.find(n => n.isPinned) || null
  const rolling = newsItems.filter(n => !n.isPinned).slice(0, 4)
  const decorate = (n) => n
    ? { ...n, isUnread: !readIds.has(n.id), formattedDate: formatDate(n.date) }
    : null
  return {
    pinned: decorate(pinned),
    rolling: rolling.map(decorate)
  }
}

function formatDate(iso) {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  } catch (_e) {
    return iso
  }
}

export class HomeController {

  static async prepare() {
    const [{ news, source, offline }, changelog] = await Promise.all([
      fetchNewsFeed(),
      loadAndParseChangelog(2)
    ])

    // Hydrate the bmap data before any consumer (rails or stats) reads
    // from it. Otherwise refreshAssetFlags("bmap") may see an empty
    // entries list and the Maps-rail ends up "No recent additions".
    ensureBmapHydrated()

    const readIds = getReadNewsIds()
    const { pinned, rolling } = partitionNews(news, readIds)
    const hero = buildHeroSlides(news).map((n, i) => ({
      ...n,
      formattedDate: formatDate(n.date),
      slideNumber: i + 1
    }))

    const rails = RAIL_CATEGORIES.map(type => {
      const { news: railNew, updates: railUpdates } = pickRailItems(type)
      return {
        type,
        labelKey: categoryLabelKey(type),
        newItems: railNew,
        updatedItems: railUpdates,
        hasContent: railNew.length > 0 || railUpdates.length > 0,
        emptyKey: "BENEOS.Cloud.Home.Recent.Empty"
      }
    })

    // Patreon-access aware stats: count how many assets per category the
    // current user can actually access (campaign-patron OR per-asset
    // free_content flag). Plus surface status semantics for the UI:
    //  - tone "is-full" (gold)  = full patron access for this category
    //  - tone "is-free" (green) = only free-content reachable
    //  - tone "is-disconnected" (red) = not logged in
    const cloud = game.beneos?.cloud
    const cloudLoggedIn  = !!cloud?.isLoggedIn?.()
    const hasTokenAccess = cloudLoggedIn && !!cloud?.hasCampaignAccess?.("tokens")
    const hasMapAccess   = cloudLoggedIn && !!cloud?.hasCampaignAccess?.("battlemaps")
    // Free status: token/item/spell from the cloud "Free" tier (data.free, the
    // dynamic source of truth); battlemaps from their own catalog free_content.
    const isFreeData = (type, data) => (type === "bmap")
      ? (data?.properties?.free_content === true)
      : (cloud?.isFreeAsset?.(type, data?.key) === true)
    const isAccessible = (type, data) => {
      if (isFreeData(type, data)) return true
      if (type === "bmap") return hasMapAccess
      return hasTokenAccess
    }
    const FREE_LABEL = {
      token: "BENEOS.Cloud.Home.Stats.Free.Tokens",
      bmap:  "BENEOS.Cloud.Home.Stats.Free.Maps",
      item:  "BENEOS.Cloud.Home.Stats.Free.Items",
      spell: "BENEOS.Cloud.Home.Stats.Free.Spells"
    }

    const stats = RAIL_CATEGORIES.map(type => {
      const all = game.beneos?.databaseHolder?.getAll?.(type) || {}
      const entries = Object.values(all)
      const total = entries.length
      let accessible = 0
      let freeCount  = 0
      for (const data of entries) {
        if (isFreeData(type, data)) freeCount++
        if (isAccessible(type, data)) accessible++
      }
      const categoryPatron = type === "bmap" ? hasMapAccess : hasTokenAccess
      const isDisconnected = !cloudLoggedIn
      const hasFullAccess  = !isDisconnected && categoryPatron
      const pct = total > 0 ? Math.min(100, Math.round((accessible / total) * 100)) : 0
      const statusSuffixKey =
          isDisconnected ? "BENEOS.Cloud.Home.Stats.Suffix.NotConnected"
        : !categoryPatron ? "BENEOS.Cloud.Home.Stats.Suffix.NoPatron"
                          : ""
      const accessTone =
          isDisconnected ? "is-disconnected"
        : hasFullAccess  ? "is-full"
                         : "is-free"
      return {
        type,
        labelKey: categoryLabelKey(type),
        iconClass: type === "token" ? "fa-dragon"
                 : type === "bmap"  ? "fa-map"
                 : type === "item"  ? "fa-shield-halved"
                 : type === "spell" ? "fa-wand-sparkles"
                 : "fa-circle",
        accessible,
        total,
        pct,
        freeCount,
        isDisconnected,
        hasFullAccess,
        statusSuffixKey,
        freeLabelKey: FREE_LABEL[type] || "",
        accessTone
      }
    })

    const status = {
      cloudLoggedIn,
      mapPatron:   hasMapAccess,
      tokenPatron: hasTokenAccess,
      patreonMapsUrl:   "https://www.patreon.com/c/BeneosBattlemaps",
      patreonTokensUrl: "https://www.patreon.com/c/BeneosTokens"
    }

    return {
      hero,
      heroHasSlides: hero.length > 0,
      heroHasMultiple: hero.length > 1,
      pinned,
      rolling,
      hasRolling: rolling.length > 0,
      hasAnyNews: !!pinned || rolling.length > 0,
      rails,
      stats,
      status,
      newsSource: source,
      newsOffline: offline,
      latestVersion: changelog[0] || null,
      changelogVersions: changelog
    }
  }

  static getNewsById(id, newsItems) {
    return newsItems.find(n => String(n.id) === String(id)) || null
  }
}
