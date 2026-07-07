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

  /**
   * Teil 2 — world-presence overwrite confirmation. Driven by the ACTUAL
   * scenes in the world (not just the install registry), so it also fires for
   * worlds that imported a release before the registry existed. Returns
   * Promise<boolean>: true => proceed in overwrite mode, false => abort.
   */
  static async confirmWorldOverwrite({ scope, name, presentCount = 0, totalCount = 0, installedAt = "", stale = false }) {
    const DialogV2 = foundry?.applications?.api?.DialogV2
    if (!DialogV2?.confirm) return true   // too old to ask -> never block an install

    const L = (key, fallback) => {
      try { const s = game.i18n.localize(key); if (s && s !== key) return s } catch (_) {}
      return fallback
    }
    const safeName  = foundry.utils.escapeHTML(String(name || ""))
    const dateStr   = this.#formatDate(installedAt)
    const isRelease = scope === "release"

    const title = stale
      ? L("BENEOS.Cloud.Bmap.Overwrite.TitleUpdate", "Update available")
      : L("BENEOS.Cloud.Bmap.Overwrite.Title", "Already in your world")
    const subject = isRelease
      ? L("BENEOS.Cloud.Bmap.Overwrite.SubjectRelease", "This release")
      : L("BENEOS.Cloud.Bmap.Overwrite.SubjectScene", "This scene")
    const intro = stale
      ? L("BENEOS.Cloud.Bmap.Overwrite.IntroUpdate",
          "%subject% of '%name%' is already in your world (installed %date%), and a newer version is online.")
      : L("BENEOS.Cloud.Bmap.Overwrite.Intro",
          "%subject% of '%name%' is already in your world (installed %date%).")
    const warn = L("BENEOS.Cloud.Bmap.Overwrite.Warn",
      "Reinstalling rebuilds the scenes from the pack — any placed tokens or manual edits on them are lost. Continue?")

    const body = (intro + " " + warn)
      .replace("%subject%", foundry.utils.escapeHTML(subject))
      .replace("%name%",    safeName)
      .replace("%date%",    foundry.utils.escapeHTML(dateStr))

    const yesLabel = stale
      ? L("BENEOS.Cloud.Bmap.Overwrite.YesUpdate", "Update")
      : L("BENEOS.Cloud.Bmap.Overwrite.Yes", "Overwrite")
    const noLabel = L("BENEOS.Cloud.Bmap.Overwrite.Cancel", "Cancel")

    try {
      const proceed = await DialogV2.confirm({
        window:  { title },
        content: `<p style="line-height:1.5">${body}</p>`,
        yes:     { label: yesLabel, default: false },
        no:      { label: noLabel, default: true },
        rejectClose: false,
      })
      return proceed === true
    } catch (_e) {
      return false
    }
  }

  /**
   * Bundle "install entire bundle" per-release prompt. A release already in the
   * world raises this 3-way choice so a single one never aborts the whole run:
   *   overwrite -> reinstall it; skip -> leave it, continue with the next;
   *   stop -> stop the bundle run here. The "apply to all remaining" checkbox
   * lets the caller remember the choice for the rest of the run.
   * Returns Promise<{ choice:"overwrite"|"skip"|"stop", applyAll:boolean }>.
   */
  static async confirmBundleMemberOverwrite({ name } = {}) {
    const DialogV2 = foundry?.applications?.api?.DialogV2
    const L = (key, fallback) => {
      try { const s = game.i18n.localize(key); if (s && s !== key) return s } catch (_) {}
      return fallback
    }
    // Too old to ask -> default to skip (never destroys an existing install).
    if (!DialogV2?.wait) return { choice: "skip", applyAll: false }

    const safeName = foundry.utils.escapeHTML(String(name || ""))
    const title = L("BENEOS.Cloud.Bmap.MemberOverwrite.Title", "Already in your world")
    const body  = L("BENEOS.Cloud.Bmap.MemberOverwrite.Body",
      "'%name%' is already in your world. Overwrite it, skip it, or stop the bundle?")
      .replace("%name%", safeName)
    const applyAllLabel = L("BENEOS.Cloud.Bmap.MemberOverwrite.ApplyAll",
      "Apply to all remaining already-installed releases")
    const content =
      `<p style="line-height:1.5">${body}</p>` +
      `<label style="display:flex;gap:.4rem;align-items:center;margin-top:.5rem">` +
      `<input type="checkbox" name="applyAll"> ${foundry.utils.escapeHTML(applyAllLabel)}</label>`

    // The third callback arg is the dialog instance in some Foundry builds and the
    // rendered HTMLElement in others; the clicked button shares the dialog's form.
    // Try all three so the checkbox read works regardless of the build.
    const readApplyAll = (button, dialog) => {
      try {
        const fromBtn = button?.form?.elements?.applyAll
        if (fromBtn) return !!fromBtn.checked
        const root = dialog?.element ?? dialog
        return !!root?.querySelector?.('input[name="applyAll"]')?.checked
      } catch (_) { return false }
    }
    try {
      const r = await DialogV2.wait({
        window: { title },
        content,
        buttons: [
          { action: "overwrite", label: L("BENEOS.Cloud.Bmap.MemberOverwrite.Overwrite", "Overwrite"),
            callback: (_e, b, dialog) => ({ choice: "overwrite", applyAll: readApplyAll(b, dialog) }) },
          { action: "skip", label: L("BENEOS.Cloud.Bmap.MemberOverwrite.Skip", "Skip"), default: true,
            callback: (_e, b, dialog) => ({ choice: "skip", applyAll: readApplyAll(b, dialog) }) },
          { action: "stop", label: L("BENEOS.Cloud.Bmap.MemberOverwrite.Stop", "Stop bundle"),
            callback: () => ({ choice: "stop", applyAll: false }) },
        ],
        rejectClose: false,
      })
      return r || { choice: "stop", applyAll: false }
    } catch (_e) {
      return { choice: "stop", applyAll: false }
    }
  }

  static #formatDate(iso) {
    if (!iso) return "unknown"
    try {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return "unknown"
      // Force US English (most patrons are US), e.g. "June 25, 2026".
      return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
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
      // Auth runs through the s= body param, not a cookie, so we must NOT send
      // credentials: the server's CDN sends Access-Control-Allow-Origin: '*',
      // which the browser rejects for a credentialed cross-origin request
      // (the CORS error seen in the install logs). "omit" keeps this call clean.
      credentials: "omit",
    })
  } catch (_e) {
    // intentional swallow — tracking is best-effort
  }
}
