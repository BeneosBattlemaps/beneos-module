/* News feed service for the Beneos Cloud Home tab.
   - Production endpoint: https://beneos.cloud/api-news.php
   - Offline-first: every successful live payload is mirrored into a persistent
     localStorage cache. When the user is offline or the endpoint is briefly
     unreachable, that saved payload is served instead, so the Home tab keeps
     showing the last real news with no error or broken image. This also spares
     repeat traffic. A clean empty state shows only when nothing was ever saved.
   - The bundled /dev/news-mock.json is a DEV preview only (LIVE disabled); it
     is never shown to end users in production.
   - 5-minute in-memory cache on top, so reopening the window does not refetch. */

const ENDPOINT_LIVE = "https://beneos.cloud/api-news.php"
const ENDPOINT_MOCK = "modules/beneos-module/dev/news-mock.json"
const PERSIST_KEY = "beneos-cloud-news-cache-v1"
const CACHE_TTL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 6000

// The live endpoint is deployed. When it is unreachable the fetch fails and
// the bundled mock JSON is served as a graceful fallback (see fetchNewsFeed).
const LIVE_ENDPOINT_ENABLED = true

let memoryCache = null
// Session circuit-breaker: once the live endpoint has failed for any reason
// in this Foundry session, we skip the live attempt entirely on the next
// fetches and go straight to the mock. Stays in place for the post-deploy
// world where the live endpoint exists but might temporarily fail.
let liveBlockedForSession = false

function isFresh(entry) {
  return entry && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { cache: "no-cache", signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

// Plain-text excerpt of the news body. Strips HTML and collapses whitespace,
// then truncates on a word boundary so the pinned card can show a teaser line
// without bleeding raw markup.
function buildPreview(html, limit = 220) {
  const text = String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const ws = cut.lastIndexOf(" ")
  return (ws > 0 ? cut.slice(0, ws) : cut) + "…"
}

function normalize(item) {
  const newsText = item.news_text || ""
  return {
    id: item.id,
    title: item.title || "",
    date: item.date || "",
    ctaString: item.cta_string || "",
    ctaUrl: item.cta_url || "",
    newsText,
    preview: buildPreview(newsText),
    imageBase64: item.image_base64 || null,
    isPinned: item.is_pinned === true,
    createdAt: item.created_at || ""
  }
}

async function fetchFromMock() {
  const data = await fetchJson(ENDPOINT_MOCK)
  if (!Array.isArray(data?.news)) return null
  const news = data.news.map(normalize)
  memoryCache = { news, fetchedAt: Date.now(), source: "mock" }
  return { news, source: "mock", offline: true }
}

// ---- Persistent (offline) cache -----------------------------------------
// Mirror the last successful live payload into localStorage so the Home tab
// can render real news while offline and across reloads.
function readPersistentCache() {
  try {
    const raw = globalThis.localStorage?.getItem(PERSIST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.news) && parsed.news.length) return parsed.news
  } catch (_e) { /* unavailable or corrupt */ }
  return null
}

function writePersistentCache(news) {
  const store = globalThis.localStorage
  if (!store || !Array.isArray(news) || !news.length) return
  try {
    store.setItem(PERSIST_KEY, JSON.stringify({ news, savedAt: Date.now() }))
  } catch (_e) {
    // Quota exceeded (base64 images are large): keep the text so at least the
    // headlines and bodies survive offline, drop the images.
    try {
      const slim = news.map(n => ({ ...n, imageBase64: null }))
      store.setItem(PERSIST_KEY, JSON.stringify({ news: slim, savedAt: Date.now() }))
    } catch (_e2) { /* give up silently */ }
  }
}

// Serve the saved news (offline path). Returns null when nothing is cached.
function servedFromCache() {
  const news = readPersistentCache()
  if (!news) return null
  memoryCache = { news, fetchedAt: Date.now(), source: "cache" }
  return { news, source: "cache", offline: true }
}

// Clean empty state: no error, no broken links, just "no news yet".
function servedEmpty() {
  memoryCache = { news: [], fetchedAt: Date.now(), source: "empty" }
  return { news: [], source: "empty", offline: true }
}

export async function fetchNewsFeed({ force = false } = {}) {
  if (!force && isFresh(memoryCache)) {
    return {
      news: memoryCache.news,
      source: memoryCache.source,
      offline: memoryCache.source !== "live"
    }
  }

  // Dev preview: the live endpoint is gated off. Show the saved cache first,
  // then the bundled dev mock, then a clean empty state. (Mock is dev-only.)
  if (!LIVE_ENDPOINT_ENABLED) {
    const cached = servedFromCache()
    if (cached) return cached
    try { const mock = await fetchFromMock(); if (mock) return mock } catch (_e) { /* ignore */ }
    return servedEmpty()
  }

  // True offline (no connection) or the circuit-breaker already tripped this
  // session: never hit the network, so the browser logs no error. Serve the
  // last saved news, else a clean empty state. No dev mock for end users.
  const isOffline = !!globalThis.navigator && globalThis.navigator.onLine === false
  if (isOffline || liveBlockedForSession) {
    return servedFromCache() ?? servedEmpty()
  }

  try {
    const data = await fetchJson(ENDPOINT_LIVE)
    if (data?.result === "ok" && Array.isArray(data.news)) {
      const news = data.news.map(normalize)
      memoryCache = { news, fetchedAt: Date.now(), source: "live" }
      writePersistentCache(news)
      return { news, source: "live", offline: false }
    }
    throw new Error(`Unexpected payload: ${JSON.stringify(data).slice(0, 80)}`)
  } catch (_liveErr) {
    liveBlockedForSession = true
    return servedFromCache() ?? servedEmpty()
  }
}

export function invalidateNewsCache() {
  memoryCache = null
  // Note: liveBlockedForSession stays true on purpose — the circuit-breaker
  // is session-wide. A Foundry reload resets it.
}

export function resetLiveCircuitBreaker() {
  liveBlockedForSession = false
  memoryCache = null
}

const READ_IDS_SETTING = "beneos-cloud-news-read-ids"

export function getReadNewsIds() {
  try {
    const raw = game.settings.get("beneos-module", READ_IDS_SETTING)
    if (Array.isArray(raw)) return new Set(raw)
    if (typeof raw === "string" && raw.length) return new Set(JSON.parse(raw))
  } catch (_e) { /* setting not yet registered */ }
  return new Set()
}

export async function markNewsRead(id) {
  if (id === undefined || id === null) return
  const set = getReadNewsIds()
  set.add(id)
  try {
    await game.settings.set("beneos-module", READ_IDS_SETTING, [...set])
  } catch (err) {
    console.warn("[Beneos News] Failed to persist read-ids:", err)
  }
}
