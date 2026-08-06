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

// One rail per category, and it is a timeline, not a shopping list.
//
// It used to list only what carried a NEW or UPDATE chip for this account,
// which meant everything already installed disappeared and everything from an
// earlier wave with it. The result was a single tile under "new creatures" on
// an account that owns the current wave. What belongs here is what Beneos
// published, newest first, going back: the reader wants to see what has been
// happening, not what is missing from their library.
//
// Ownership therefore decides nothing about the selection. It still decides the
// chip, so an entry the account can update says so, but it stays in the row
// either way. The same list is shown signed in and signed out, because a
// release is not a property of an account; the catalog is all this needs and it
// is on disk even offline.
function pickRailItems(type) {
  const dbHolder = game.beneos?.databaseHolder
  const all = dbHolder?.getAll?.(type) || {}
  const entries = Object.entries(all)
  if (!entries.length) return { news: [], updates: [] }

  // Chips only. A failure here costs a marker, never the tile.
  const process = type === "token" ? dbHolder?.processInstalledToken
                : type === "item"  ? dbHolder?.processInstalledItem
                : type === "spell" ? dbHolder?.processInstalledSpell
                : null

  const cards = []
  for (const [key, data] of entries) {
    if (!data) continue
    if (process) { try { process.call(dbHolder, data) } catch (_e) { /* marker only */ } }
    cards.push(buildRailCard(type, key, data))
  }
  // Sorted before the cap. Capping first would keep whichever twelve the
  // catalog file happens to list first, which is how this went wrong before.
  return { news: sortRailCards(cards).slice(0, RAIL_LIMIT_PER_GROUP), updates: [] }
}

/**
 * Newest first: publication date, then the release number carried in the key,
 * then the name. The release number is the tie-breaker rather than the primary
 * key because a whole wave shares one date, and inside a wave the numbering is
 * what tells them apart.
 */
function sortRailCards(cards) {
  return cards.sort((a, b) => {
    if (a.releaseMs !== b.releaseMs) return (b.releaseMs || 0) - (a.releaseMs || 0)
    if (a.releaseNum !== b.releaseNum) return (b.releaseNum || 0) - (a.releaseNum || 0)
    return String(a.name || "").localeCompare(String(b.name || ""))
  })
}

function buildRailCard(type, key, data) {
  const thumb = thumbnailFor(type, key, data)
  const name = data?.properties?.display_name
            || data?.properties?.name
            || data?.name
            || key
  const sub = subInfoFor(type, data)
  const relMs = Date.parse(data?.properties?.release_date || "")
  const relNum = String(key || "").match(/^(\d+)/)
  const card = {
    type,
    key,
    name,
    sub,
    thumb,
    // Sort keys, carried on the card so the comparator stays cheap.
    releaseMs: Number.isFinite(relMs) ? relMs : 0,
    releaseNum: relNum ? (parseInt(relNum[1], 10) || 0) : 0,
    isNew: !!data.isNew,
    isUpdate: !!data.isUpdate
  }
  if (type === "bmap") {
    const props = data?.properties || {}
    card.mouPack    = props.download_pack    || ""
    card.mouCreator = props.download_creator || ""
    card.mouTerms   = props.download_terms   || ""
    // The per-scene preview lives on the CDN and is published by the catalog
    // pipeline, which can lag a fresh release by a cycle. The release cover is
    // served from the cloud itself and is there as soon as the release is, so
    // it stands in rather than leaving an empty tile. Wired as a fallback on
    // the element, not as a replacement, so the scene preview still wins the
    // moment it appears.
    const releaseId = props.cloud_release_id || ""
    if (releaseId) card.thumbFallback = `https://beneos.cloud/release-thumbnails/${releaseId}.webp`
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

// Parse a news item's timestamp for recency sorting. Prefers the plain
// `date` (YYYY-MM-DD) and falls back to `createdAt`; unparseable values
// sort to the bottom.
function newsSortValue(n) {
  const t = Date.parse(n?.date || n?.createdAt || "")
  return Number.isNaN(t) ? 0 : t
}

// Latest N news, newest first (pure recency, so the Home grid fills
// 1,2,3 / 4,5,6 left-to-right). Each item is decorated with read-state
// and a display date. Pinned entries keep their `isPinned` flag for the
// small pin marker but get no positional priority.
function selectLatestNews(newsItems, readIds, limit = 6) {
  return [...newsItems]
    .sort((a, b) => newsSortValue(b) - newsSortValue(a))
    .slice(0, limit)
    .map(n => {
      const hasCta = !!(n.ctaUrl && n.ctaString)
      const dateLabel = formatDayMonth(n.date || n.createdAt)
      return {
        ...n,
        isUnread: !readIds.has(n.id),
        formattedDate: formatDate(n.date),
        dateLabel,
        hasCta,
        // The footer row carries the button on the left and the date on the
        // right. Decided here rather than in the template so an entry with
        // neither does not leave an empty strip at the bottom of the card.
        hasFooter: hasCta || !!dateLabel
      }
    })
}

// Day and month in the reader's language, "July 14" in English, "14. Juli" in
// German. The year is left out on purpose: the card footer is a narrow strip,
// and the feed only ever shows the last handful of posts, where the year says
// nothing.
function formatDayMonth(iso) {
  const d = parseFeedDate(iso)
  if (!d) return ""
  try {
    return new Intl.DateTimeFormat(game.i18n?.lang || undefined, { month: "long", day: "numeric" }).format(d)
  } catch (_e) {
    return d.toLocaleDateString(undefined, { month: "long", day: "numeric" })
  }
}

// A bare "YYYY-MM-DD" is read as UTC midnight by the Date constructor, which
// lands on the previous day for everyone west of Greenwich. The feed dates are
// calendar days, not instants, so they are built as local dates.
function parseFeedDate(iso) {
  if (!iso) return null
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
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
    const news6 = selectLatestNews(news, readIds, 6)

    const rails = RAIL_CATEGORIES.map(type => {
      const { news: railItems } = pickRailItems(type)
      return {
        type,
        labelKey: categoryLabelKey(type),
        newItems: railItems,
        hasContent: railItems.length > 0,
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
      news: news6,
      hasAnyNews: news6.length > 0,
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
