/* News feed service for the Beneos Cloud Home tab.
   - Production endpoint: https://cloud.beneos.com/api-news.php
   - Falls back to a bundled mock JSON in /dev/news-mock.json when the live
     endpoint is unreachable (Frontend-First development; the PHP endpoint may
     not be deployed yet). The mock is shipped in the module repo only — it is
     not loaded unless the live endpoint fails.
   - 5-minute in-memory cache keyed by URL. The launcher reopens the window
     many times per session; the user-facing news rarely changes that fast. */

const ENDPOINT_LIVE = "https://cloud.beneos.com/api-news.php"
const ENDPOINT_MOCK = "modules/beneos-module/dev/news-mock.json"
const CACHE_TTL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 6000

// Set to true once https://cloud.beneos.com/api-news.php is deployed.
// While false, the module renders the bundled mock JSON only — no live
// fetch is attempted, so the browser does not surface
// ERR_NAME_NOT_RESOLVED in the console for users.
const LIVE_ENDPOINT_ENABLED = false

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

function normalize(item) {
  return {
    id: item.id,
    title: item.title || "",
    date: item.date || "",
    ctaString: item.cta_string || "",
    ctaUrl: item.cta_url || "",
    newsText: item.news_text || "",
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

export async function fetchNewsFeed({ force = false } = {}) {
  if (!force && isFresh(memoryCache)) {
    return {
      news: memoryCache.news,
      source: memoryCache.source,
      offline: memoryCache.source !== "live"
    }
  }

  // Compile-time gate: the live endpoint is not deployed yet, so we
  // never attempt the network request. Sparing the browser a guaranteed
  // ERR_NAME_NOT_RESOLVED until the API is shipped.
  // Also the runtime circuit-breaker: skip the live attempt entirely
  // once it has failed in this session.
  if (!LIVE_ENDPOINT_ENABLED || liveBlockedForSession) {
    try {
      const mock = await fetchFromMock()
      if (mock) return mock
    } catch (_e) { /* fall through to empty */ }
    memoryCache = { news: [], fetchedAt: Date.now(), source: "empty" }
    return { news: [], source: "empty", offline: true }
  }

  try {
    const data = await fetchJson(ENDPOINT_LIVE)
    if (data?.result === "ok" && Array.isArray(data.news)) {
      const news = data.news.map(normalize)
      memoryCache = { news, fetchedAt: Date.now(), source: "live" }
      return { news, source: "live", offline: false }
    }
    throw new Error(`Unexpected payload: ${JSON.stringify(data).slice(0, 80)}`)
  } catch (_liveErr) {
    liveBlockedForSession = true
    try {
      const mock = await fetchFromMock()
      if (mock) return mock
    } catch (_mockErr) { /* fall through to empty */ }
    memoryCache = { news: [], fetchedAt: Date.now(), source: "empty" }
    return { news: [], source: "empty", offline: true }
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
