/* "What's new" service for the world-start popup.

   Asks the cloud what this account gained since it last acknowledged the popup
   and, once the user closed the window, moves the cursor forward.

   Two deliberate differences to news-api.mjs, which this otherwise follows:

   - No localStorage mirror. A cached unlock is worse than none: it would either
     re-celebrate something the user already dismissed on another machine, or
     announce content the account no longer holds. The cursor lives on the
     server precisely so the answer is always computed fresh.
   - Reading never acknowledges. fetchWhatsNew() only reads; ackWhatsNew() is a
     separate call the window makes after the user confirmed. An aborted popup
     therefore comes back on the next world load. */

const FETCH_TIMEOUT_MS = 6000

// Session circuit-breaker: after one failure we stop hitting the endpoint for
// the rest of the session. A world start is not worth retrying in a loop, and
// a silent popup is the correct behaviour when the cloud is unreachable.
let liveBlockedForSession = false

function moduleId() {
  return "beneos-module"
}

function cloudBase() {
  return globalThis.BeneosUtility?.cloudBase?.()
    ?? game.beneos?.BeneosUtility?.cloudBase?.()
    ?? "https://beneos.cloud"
}

function foundryId() {
  try { return game.settings.get(moduleId(), "beneos-cloud-foundry-id") || "" }
  catch (_e) { return "" }
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { cache: "no-cache", signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function emptyBucket() {
  return { items: [], overflow: 0 }
}

function normalizeBucket(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : []
  return {
    items: items.map(entry => ({
      id: String(entry?.id ?? ""),
      key: String(entry?.key ?? ""),
      name: String(entry?.name ?? ""),
      type: String(entry?.type ?? ""),
      source: String(entry?.source ?? ""),
      thumbnailUrl: String(entry?.thumbnail_url ?? ""),
      unlockedTs: Number(entry?.unlocked_ts ?? 0)
    })).filter(entry => entry.key !== ""),
    overflow: Math.max(0, Number(raw?.overflow ?? 0))
  }
}

/**
 * Read what is new for this account. Never throws and never acknowledges.
 * Returns null when there is nothing to show or nothing to ask (logged out,
 * offline, endpoint down, first sight of an existing account).
 */
export async function fetchWhatsNew() {
  if (liveBlockedForSession) return null
  const id = foundryId()
  if (!id || id === "anonymous") return null
  const isOffline = !!globalThis.navigator && globalThis.navigator.onLine === false
  if (isOffline) return null

  try {
    const url = `${cloudBase()}/foundry-manager.php?foundryId=${encodeURIComponent(id)}&get_whats_new=1`
    const data = await fetchJson(url)
    if (String(data?.result).toUpperCase() !== "OK" || !data?.data) {
      throw new Error(`Unexpected payload: ${JSON.stringify(data).slice(0, 120)}`)
    }
    const payload = data.data
    // firstRun means the server just stamped the cursor for a pre-existing
    // account and deliberately returned nothing. Not an error, just silence.
    if (payload.firstRun === true) return null
    const patreon = normalizeBucket(payload.patreon)
    const shop = normalizeBucket(payload.shop)
    if (!patreon.items.length && !shop.items.length) return null
    return {
      serverTime: Number(payload.serverTime ?? 0),
      patreon,
      shop
    }
  } catch (err) {
    liveBlockedForSession = true
    console.debug("[Beneos What's New] lookup skipped:", err?.message ?? err)
    return null
  }
}

/**
 * Move the account cursor forward. Sends back the server's own timestamp, never
 * a locally generated one, so a client clock running ahead cannot swallow
 * future announcements. Failure is silent: the popup simply reappears next time,
 * which is the harmless direction to fail in.
 */
export async function ackWhatsNew(serverTime) {
  const id = foundryId()
  const ts = Number(serverTime ?? 0)
  if (!id || id === "anonymous" || !(ts > 0)) return false
  try {
    const url = `${cloudBase()}/foundry-manager.php?foundryId=${encodeURIComponent(id)}&whats_new_ack=1&ts=${ts}`
    const data = await fetchJson(url)
    return String(data?.result).toUpperCase() === "OK"
  } catch (err) {
    console.warn("[Beneos What's New] Failed to acknowledge:", err)
    return false
  }
}
