/* =============================================================
   Beneos Creature Codex — PDF download service.
   Two-step signed-URL flow per `api-pdf.md`:
     1. GET /foundry-manager.php?foundryId=…&get_asset_pdf=1&assetKey=…
        → { result, data: { download_url, filename, expires_at } }
     2. fetch the signed URL (streams the PDF binary) and install it into
        the creature's local cloud token folder, alongside its other assets.
   Once installed, the codex offers "View PDF" via the embedded viewer.
   ============================================================= */

const API_BASE = "https://beneos.cloud"

/** Local cloud folder that already holds the creature's token assets. */
function pdfDataFolder(assetKey) {
  return `beneos_assets/cloud/tokens/${assetKey}`
}

/** Served (URL) path of the locally installed PDF, for href / pdfjs. */
export function pdfServedPath(assetKey) {
  return `/beneos_assets/cloud/tokens/${assetKey}/${assetKey}.pdf`
}

/** True if the PDF is already installed in the local token folder. */
export async function isPdfInstalled(assetKey) {
  if (!assetKey) return false
  try {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
    const res = await FP.browse("data", pdfDataFolder(assetKey))
    const name = `${assetKey}.pdf`
    return (res?.files ?? []).some(f => f.endsWith(name))
  } catch (_) {
    return false
  }
}

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

/** Create each folder level (idempotent — already-exists errors ignored). */
async function ensurePdfFolder(assetKey) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
  for (const dir of [
    "beneos_assets",
    "beneos_assets/cloud",
    "beneos_assets/cloud/tokens",
    pdfDataFolder(assetKey),
  ]) {
    try { await FP.createDirectory("data", dir) } catch (_) { /* exists */ }
  }
}

/** Download the creature's PDF from the cloud and INSTALL it locally into
 *  the token's cloud folder (alongside its other assets). Gated on cloud
 *  login + Tokens-Patreon access. Returns true on success so the caller can
 *  re-render and flip the button from "Download PDF" to "View PDF". */
export async function downloadCreaturePdf(tokenKey) {
  if (!tokenKey) {
    ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.NoTokenKey"))
    return false
  }
  // PDFs are Beneos Tokens-campaign assets: only served to a user who is
  // signed in to the cloud AND holds Tokens-Patreon access.
  const cloud = game.beneos?.cloud
  if (!cloud?.isLoggedIn?.()) {
    ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.NotLoggedIn"))
    return false
  }
  if (!cloud?.hasCampaignAccess?.("tokens")) {
    ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.PdfRequiresPatreon"))
    return false
  }
  const foundryId = resolveFoundryId()
  if (!foundryId) {
    ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.NotLoggedIn"))
    return false
  }
  try {
    ui.notifications.info(game.i18n.localize("BENEOS.CreatureCodex.PdfInstalling"))
    const { download_url, filename } = await requestPdfUrl({ foundryId, assetKey: tokenKey })
    const res = await fetch(download_url, { credentials: "omit", mode: "cors" })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const name = `${tokenKey}.pdf`
    const file = new File([blob], name, { type: "application/pdf" })
    await ensurePdfFolder(tokenKey)
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
    const upload = await FP.upload("data", pdfDataFolder(tokenKey), file, {}, { notify: false })
    if (!upload?.path) throw new Error("upload failed")
    ui.notifications.info(game.i18n.format(
      "BENEOS.CreatureCodex.PdfInstalled",
      { name: filename ?? name }
    ))
    return true
  } catch (err) {
    console.error("[beneos-codex] PDF install failed", err)
    ui.notifications.error(game.i18n.format(
      "BENEOS.CreatureCodex.Warning.PdfFailed",
      { reason: err.message ?? "unknown" }
    ))
    return false
  }
}
