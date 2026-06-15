/**
 * Plan §33.6 — world-scoped install-state for battlemap releases.
 *
 * The Foundry-module records every cloud-installed release in the world
 * setting "battlemap-installs". The cloud window reads it to surface the
 * green installed-badge and the gold update-available badge, and the
 * pre-install dialog uses it to detect re-install + variant-switch attempts.
 *
 * No auto-scan: a world that imported a release before this feature shipped
 * starts blank. Re-installing through the module fills the record. Plan §33.10
 * pins this as the V1 decision (auto-scan via scene.background.src is V2).
 */

import { BeneosUtility } from "../beneos_utility.js"

const SETTING_KEY = "battlemap-installs"

/**
 * Static accessor — Foundry's settings storage is the source of truth; we
 * never cache to avoid stale reads across re-renders.
 */
export class BeneosInstallState {
  static getAll() {
    try {
      const v = game.settings.get(BeneosUtility.moduleID(), SETTING_KEY)
      return (v && typeof v === "object") ? v : {}
    } catch (_e) {
      return {}
    }
  }

  /**
   * Find any installed variants of a release. Returns an array because
   * V2 may legitimately have both 4K and HD installed in the same world
   * (the dialog warns against it but doesn't enforce); V1 we tolerate
   * the corner case so the badge logic stays honest.
   */
  static findByReleaseDir(releaseDir) {
    if (!releaseDir) return []
    const all = this.getAll()
    const out = []
    for (const [key, entry] of Object.entries(all)) {
      if (!entry || typeof entry !== "object") continue
      if (entry.releaseDir === releaseDir) out.push(entry)
    }
    return out
  }

  /**
   * Persist one install. Key format: `<releaseDir>_<variant>` (variant = ""
   * for single-variant releases). Idempotent: replacing the same key
   * overwrites scene-ids + timestamp + signature for the new install.
   */
  static async recordInstall({ releaseDir, variant, assetId, sceneIds, sourceSignature, sceneCount }) {
    if (!releaseDir) return
    const all = this.getAll()
    const key = variant ? `${releaseDir}_${variant}` : releaseDir
    all[key] = {
      releaseDir,
      variant:         variant || "",
      assetId:         String(assetId || ""),
      sceneIds:        Array.isArray(sceneIds) ? sceneIds.slice(0) : [],
      sceneCount:      Number(sceneCount || (Array.isArray(sceneIds) ? sceneIds.length : 0)),
      installedAt:     new Date().toISOString(),
      sourceSignature: String(sourceSignature || ""),
    }
    try {
      await game.settings.set(BeneosUtility.moduleID(), SETTING_KEY, all)
    } catch (e) {
      console.warn("BeneosInstallState | recordInstall failed", e)
    }
  }

  /**
   * Drop an install record. Used when the dialog confirms a variant-switch
   * and we replace the old entry. Idempotent: missing key is a no-op.
   */
  static async forget({ releaseDir, variant }) {
    if (!releaseDir) return
    const all = this.getAll()
    const key = variant ? `${releaseDir}_${variant}` : releaseDir
    if (!(key in all)) return
    delete all[key]
    try {
      await game.settings.set(BeneosUtility.moduleID(), SETTING_KEY, all)
    } catch (e) {
      console.warn("BeneosInstallState | forget failed", e)
    }
  }
}

/**
 * Plan §33.6 — pre-install confirmation dialog.
 *
 * Three states:
 *   - new install: no dialog, install proceeds immediately.
 *   - same release + same variant: "already installed, overwriting".
 *   - same release + different variant: "switching from 4K to HD" etc.
 *
 * Returns a Promise<boolean>: true when the user confirms, false otherwise.
 * Caller aborts the install on false.
 */
export class BeneosPreInstallDialog {
  static async confirm({ existingInstalls, releaseDir, newVariant, releaseDisplayName }) {
    if (!Array.isArray(existingInstalls) || !existingInstalls.length) return true

    const DialogV2 = foundry?.applications?.api?.DialogV2
    if (!DialogV2?.confirm) {
      // Foundry too old for DialogV2.confirm — fall through, do not block.
      return true
    }

    const sameVariant = existingInstalls.find(e => (e.variant || "") === (newVariant || ""))
    const otherVariant = existingInstalls.find(e => (e.variant || "") !== (newVariant || ""))
    const name = releaseDisplayName || releaseDir

    let title, body, yesLabel
    if (sameVariant) {
      title = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.ReinstallTitle") || "Release already installed"
      const fmt = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.ReinstallBody")
        || "'%name%' (%variant%) is already installed (%count% scenes since %date%). A reinstall overwrites any manual edits on those scenes. Continue?"
      body = fmt
        .replace("%name%",    foundry.utils.escapeHTML(name))
        .replace("%variant%", foundry.utils.escapeHTML(sameVariant.variant || "single-variant"))
        .replace("%count%",   String(sameVariant.sceneCount || sameVariant.sceneIds?.length || 0))
        .replace("%date%",    this.#formatDate(sameVariant.installedAt))
      yesLabel = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.ReinstallYes") || "Reinstall"
    } else if (otherVariant) {
      title = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.SwitchTitle") || "Variant switch"
      const fmt = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.SwitchBody")
        || "'%name%' is installed as %old% (%count% scenes since %date%). You are about to install %new%. The quality changes from %old% to %new%, and the existing scenes will be overwritten. Continue?"
      body = fmt
        .replace(/%name%/g,  foundry.utils.escapeHTML(name))
        .replace(/%old%/g,   foundry.utils.escapeHTML(otherVariant.variant || "the other variant"))
        .replace(/%new%/g,   foundry.utils.escapeHTML(newVariant || "single-variant"))
        .replace("%count%",  String(otherVariant.sceneCount || otherVariant.sceneIds?.length || 0))
        .replace("%date%",   this.#formatDate(otherVariant.installedAt))
      yesLabel = game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.SwitchYes") || "Switch variant"
    } else {
      return true
    }

    try {
      const proceed = await DialogV2.confirm({
        window:  { title },
        content: `<p style="line-height:1.5">${body}</p>`,
        yes:     { label: yesLabel, default: false },
        no:      { label: game.i18n.localize("BENEOS.Cloud.Bmap.PreInstall.Cancel") || "Cancel", default: true },
        rejectClose: false
      })
      return proceed === true
    } catch (_e) {
      return false
    }
  }

  static #formatDate(iso) {
    if (!iso) return "unknown"
    try {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return "unknown"
      return d.toLocaleDateString()
    } catch (_e) { return "unknown" }
  }
}

/**
 * Plan §33.6 — fire-and-forget download-log POST to api-scenepacker.php.
 * Session-cookie carries auth; we just hand the asset_id + variant + source.
 * Errors are swallowed: tracking must never block an install or surface to
 * the user (the install itself already succeeded if we reached this point).
 */
export async function beneosLogModuleInstall({ assetId, variant, sceneCount }) {
  try {
    const mgr = window.BeneosScenePacker
    const sid = mgr?.sessionId
    if (!sid || !assetId) return
    const apiEndpoint = mgr.apiEndpoint
    if (!apiEndpoint) return
    const body = new URLSearchParams({
      s:        sid,
      a:        "log_download",
      asset_id: String(assetId),
      source:   "module",
    })
    if (variant)            body.set("variant",     String(variant))
    if (sceneCount != null) body.set("scene_count", String(sceneCount))
    await fetch(apiEndpoint, {
      method:      "POST",
      headers:     { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      credentials: "include",
    })
  } catch (_e) {
    // intentional swallow — tracking is best-effort
  }
}
