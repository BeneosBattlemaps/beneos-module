/* =============================================================
   Beneos Creature Codex — PDF download service (Welle 4d).
   Two-step signed-URL flow per `api-pdf.md`:
     1. GET /foundry-manager.php?foundryId=…&get_asset_pdf=1&assetKey=…
        → { result, data: { download_url, filename, expires_at } }
     2. browser-download the signed URL (it streams the PDF binary).
   ============================================================= */

const API_BASE = "https://www.beneos-database.com"

/** Resolve the current Foundry user id from the Beneos cloud auth
 *  state. The authoritative key is `beneos-cloud-foundry-id` (set by
 *  `beneos_cloud.js:242` during login). We probe a few legacy keys as
 *  a defensive fallback so older Beneos installs keep working. */
function resolveFoundryId() {
  const util = globalThis.BeneosUtility
  if (typeof util?.getFoundryId === "function") {
    const v = util.getFoundryId()
    if (v) return v
  }
  // Authoritative key first, legacy fallbacks after.
  for (const key of ["beneos-cloud-foundry-id", "beneos-foundry-id", "foundry-id", "patreon-id"]) {
    try {
      const v = game.settings?.get?.("beneos-module", key)
      if (v) return v
    } catch (_) { /* setting not registered, try next */ }
  }
  return null
}

export async function requestPdfUrl({ foundryId, assetKey }) {
  const url = new URL(`${API_BASE}/foundry-manager.php`)
  url.searchParams.set("foundryId", foundryId)
  url.searchParams.set("get_asset_pdf", "1")
  url.searchParams.set("assetKey", assetKey)
  const res = await fetch(url, { credentials: "omit", mode: "cors" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (data?.result !== "OK") {
    throw new Error(data?.information ?? "Request failed")
  }
  return data.data
}

/** Trigger a browser-side download for the signed URL. We don't fetch
 *  the binary ourselves — letting the browser download it preserves
 *  Content-Disposition and avoids loading a large blob into JS memory. */
function startBrowserDownload(href, filename) {
  const a = document.createElement("a")
  a.href = href
  if (filename) a.download = filename
  a.rel = "noopener"
  // Don't append to body in modern browsers — the synthetic click works
  // without it, and avoids polluting the DOM. Safari fallback: do append.
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function downloadCreaturePdf(tokenKey) {
  if (!tokenKey) {
    ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.NoTokenKey"))
    return false
  }
  const foundryId = resolveFoundryId()
  if (!foundryId) {
    ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.NotLoggedIn"))
    return false
  }
  try {
    const { download_url, filename } = await requestPdfUrl({ foundryId, assetKey: tokenKey })
    startBrowserDownload(download_url, filename ?? `${tokenKey}.pdf`)
    return true
  } catch (err) {
    console.error("[beneos-codex] PDF download failed", err)
    ui.notifications.error(game.i18n.format(
      "BENEOS.CreatureCodex.Warning.PdfFailed",
      { reason: err.message ?? "unknown" }
    ))
    return false
  }
}
