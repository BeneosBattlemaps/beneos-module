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
     therefore comes back on the next world load.

   A world without a cloud account takes the second route: the same release list
   with nothing marked as owned, and the marker kept in a client setting because
   there is no account for the server to hang one on. That local marker is the
   one exception to the no-cache rule above, and a safe one: it stores a
   timestamp, never the content. */

const FETCH_TIMEOUT_MS = 6000
// Marker for worlds with no cloud account. The signed-in cursor stays on the
// server (users.last_whatsnew_seen_at) so a purchase is celebrated once across
// all worlds; this one cannot be shared, there is nothing to share it by.
const ANON_CURSOR_SETTING = "beneos-whatsnew-anon-seen-at"

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

function anonCursor() {
  try { return Number(game.settings.get(moduleId(), ANON_CURSOR_SETTING)) || 0 }
  catch (_e) { return 0 }
}

async function setAnonCursor(ts) {
  try { await game.settings.set(moduleId(), ANON_CURSOR_SETTING, Number(ts) || 0) }
  catch (err) { console.warn("[Beneos What's New] Could not store local marker:", err) }
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
      unlockedTs: Number(entry?.unlocked_ts ?? 0),
      // Default false, not true: an old server that does not send the field
      // yet would otherwise present locked content as ready to install.
      owned: entry?.owned === true
    })).filter(entry => entry.key !== ""),
    overflow: Math.max(0, Number(raw?.overflow ?? 0))
  }
}

/**
 * Read what is new. Never throws and never acknowledges.
 *
 * With an account this is "what the cloud released, and what of it you hold";
 * without one it is the same release list with nothing held. Returns null when
 * there is nothing to show or nothing to ask (offline, endpoint down, first
 * sight of this world or account).
 *
 * @param {{loggedIn?: boolean}} options
 */
export async function fetchWhatsNew({ loggedIn = true } = {}) {
  if (liveBlockedForSession) return null
  const id = foundryId()
  const signedIn = loggedIn && !!id && id !== "anonymous"
  const isOffline = !!globalThis.navigator && globalThis.navigator.onLine === false
  if (isOffline) return null

  try {
    const url = signedIn
      ? `${cloudBase()}/foundry-manager.php?foundryId=${encodeURIComponent(id)}&get_whats_new=1`
      : `${cloudBase()}/foundry-manager.php?get_whats_new=1&since=${anonCursor()}`
    const data = await fetchJson(url)
    if (String(data?.result).toUpperCase() !== "OK" || !data?.data) {
      throw new Error(`Unexpected payload: ${JSON.stringify(data).slice(0, 120)}`)
    }
    const payload = data.data
    // firstRun means the cursor was never set and the server deliberately
    // returned nothing: a world that has been around for months should not open
    // with a backlog of everything it missed. Not an error, just silence. For an
    // account the server stamps it; without one we stamp it here.
    if (payload.firstRun === true) {
      if (!signedIn) await setAnonCursor(payload.serverTime)
      return null
    }
    const patreon = normalizeBucket(payload.patreon)
    const shop = normalizeBucket(payload.shop)
    if (!patreon.items.length && !shop.items.length) return null
    return {
      serverTime: Number(payload.serverTime ?? 0),
      loggedIn: signedIn,
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
export async function ackWhatsNew(serverTime, { loggedIn = true } = {}) {
  const id = foundryId()
  const ts = Number(serverTime ?? 0)
  if (!(ts > 0)) return false
  const signedIn = loggedIn && !!id && id !== "anonymous"
  if (!signedIn) {
    await setAnonCursor(ts)
    return true
  }
  try {
    const url = `${cloudBase()}/foundry-manager.php?foundryId=${encodeURIComponent(id)}&whats_new_ack=1&ts=${ts}`
    const data = await fetchJson(url)
    return String(data?.result).toUpperCase() === "OK"
  } catch (err) {
    console.warn("[Beneos What's New] Failed to acknowledge:", err)
    return false
  }
}
