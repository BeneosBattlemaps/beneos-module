/* Beneos module update check.
   On world start (GM only) this compares the installed module version against
   the version published in the module's GitHub manifest and, when a newer one
   exists, shows a dismissible notice with the installed vs. available version
   and a Patchnotes button that opens the in-module change log.

   Source of truth for "available online" is the manifest URL declared in
   module.json (raw module.json on the main branch) - the same file Foundry's
   own update check reads - so this needs no backend and works for self-hosters.
   Every failure path is silent: a world must always start, online or not. */

import { BeneosPatchlogWindow } from "./patchlog-window.mjs"

const MODULE_ID = "beneos-module"
const DISMISS_SETTING = "updateNoticeDismissedVersion"
const FETCH_TIMEOUT_MS = 8000

/** Installed module version, or "" if unavailable. */
function installedVersion() {
  try { return game.modules.get(MODULE_ID)?.version || "" } catch (_) { return "" }
}

/** Manifest URL declared by the module (main-branch raw module.json). */
function manifestUrl() {
  try { return game.modules.get(MODULE_ID)?.manifest || "" } catch (_) { return "" }
}

/**
 * Fetch the manifest and report whether a newer version is available.
 * Never throws: any network/parse error resolves to { hasUpdate:false }.
 * Returns { hasUpdate, installed, remote }.
 */
export async function checkForModuleUpdate() {
  const installed = installedVersion()
  const url = manifestUrl()
  if (!installed || !url) return { hasUpdate: false, installed, remote: "" }

  let remote = ""
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let resp
    try {
      resp = await fetch(url, { cache: "no-cache", signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!resp?.ok) return { hasUpdate: false, installed, remote: "" }
    const data = await resp.json()
    remote = String(data?.version || "")
  } catch (err) {
    // Offline, blocked, or malformed manifest: stay silent, never block startup.
    console.debug?.("[Beneos] Update check skipped:", err?.message || err)
    return { hasUpdate: false, installed, remote: "" }
  }

  const hasUpdate = !!remote && foundry.utils.isNewerVersion(remote, installed)
  return { hasUpdate, installed, remote }
}

/** Read the "skip this version" checkbox out of the dialog root. */
function readSkipCheckbox(root) {
  try { return !!root?.querySelector?.('input[name="beneos-update-skip"]')?.checked }
  catch (err) { console.warn("[Beneos] update-notice checkbox read failed", err); return false }
}

/**
 * Show the update notice (DialogV2). Persists the skip choice into the
 * world-scope DISMISS_SETTING when the user ticks "do not show again for this
 * version". The Patchnotes icon opens BeneosPatchlogWindow without closing the
 * notice. Mirrors the first-run prompt pattern in beneos_tours.js.
 */
export async function showUpdateNotice({ installed, remote }) {
  try {
    const src = "modules/beneos-module/ui/sfx/beneos_notification.ogg"
    const helper = foundry.audio?.AudioHelper
    if (helper?.play) helper.play({ src, volume: 0.5, autoplay: true, loop: false }, false)
  } catch (_) {}

  const L = (k) => game.i18n.localize(k)
  const title = L("BENEOS.Cloud.UpdateNotice.Title")
  const intro = L("BENEOS.Cloud.UpdateNotice.Intro")
  const installedLabel = L("BENEOS.Cloud.UpdateNotice.Installed")
  const onlineLabel = L("BENEOS.Cloud.UpdateNotice.Online")
  const patchTooltip = L("BENEOS.Cloud.UpdateNotice.PatchnotesTooltip")
  const skipLabel = L("BENEOS.Cloud.UpdateNotice.DontShowAgain")
  const closeLabel = L("BENEOS.Cloud.UpdateNotice.Close")
  const esc = (s) => foundry.utils.escapeHTML?.(String(s)) ?? String(s)

  const content = `
    <div class="beneos-update-notice">
      <div class="beneos-update-notice__head">
        <img class="beneos-update-notice__logo" src="modules/beneos-module/icons/beneos_logo_animated.gif" alt="Beneos" />
      </div>
      <p class="beneos-update-notice__intro">${intro}</p>
      <div class="beneos-update-notice__box">
        <dl class="beneos-update-notice__versions">
          <div><dt>${installedLabel}</dt><dd>${esc(installed)}</dd></div>
          <div><dt>${onlineLabel}</dt><dd class="is-new">${esc(remote)}</dd></div>
        </dl>
        <button type="button" class="beneos-update-notice__patchnotes" data-tooltip="${patchTooltip}" title="${patchTooltip}" aria-label="${patchTooltip}">
          <i class="fas fa-clipboard-list" aria-hidden="true"></i>
        </button>
      </div>
      <label class="beneos-update-notice__skip"><input type="checkbox" name="beneos-update-skip"> ${skipLabel}</label>
    </div>`

  const openPatchnotes = () => {
    try { new BeneosPatchlogWindow().render({ force: true }) }
    catch (err) { console.warn("[Beneos] Failed to open patch notes:", err) }
  }

  // Live mirror of the skip checkbox. Tracked via a change listener so the
  // choice is honoured no matter how the dialog is closed (Close button OR the
  // window X), not just when a button callback happens to read the DOM.
  let skip = false

  const persistSkip = async () => {
    if (!skip) return
    try { await game.settings.set(MODULE_ID, DISMISS_SETTING, remote) }
    catch (err) { console.warn("[Beneos] Failed to persist update-notice skip:", err) }
  }

  const wire = (root) => {
    const btn = root?.querySelector?.(".beneos-update-notice__patchnotes")
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "1"
      btn.addEventListener("click", (ev) => { ev.preventDefault(); openPatchnotes() })
    }
    const cb = root?.querySelector?.('input[name="beneos-update-skip"]')
    if (cb && !cb.dataset.bound) {
      cb.dataset.bound = "1"
      skip = !!cb.checked
      cb.addEventListener("change", () => { skip = !!cb.checked })
    }
  }

  try {
    const DialogV2 = foundry.applications?.api?.DialogV2
    if (DialogV2?.wait) {
      await DialogV2.wait({
        window: { title },
        classes: ["beneos-cloud-app", "beneos_module", "beneos-update-notice-dialog"],
        position: { width: 460 },
        content,
        render: (_event, dialog) => wire(dialog?.element),
        buttons: [
          {
            action: "close",
            label: closeLabel,
            default: true,
            callback: (_event, _button, dialog) => { skip = readSkipCheckbox(dialog?.element); return null }
          }
        ],
        rejectClose: false,
        modal: false,
        close: () => null
      })
      // Runs whether closed via the Close button or the window X.
      await persistSkip()
      return
    }
  } catch (err) {
    console.warn("[Beneos] Update notice DialogV2 failed:", err)
  }
}

/**
 * Entry point for the ready orchestrator: run the check and, when a newer
 * version is available and not already skipped, show the notice. GM-only
 * gating and popup-stacking avoidance are the caller's responsibility.
 */
export async function maybeShowUpdateNotice() {
  let dismissed = ""
  try { dismissed = game.settings.get(MODULE_ID, DISMISS_SETTING) || "" } catch (_) {}
  const { hasUpdate, installed, remote } = await checkForModuleUpdate()
  if (!hasUpdate) return false
  if (remote === dismissed) return false
  await showUpdateNotice({ installed, remote })
  return true
}
