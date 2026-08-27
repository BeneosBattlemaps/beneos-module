import { BeneosUtility } from "./beneos_utility.js"
import { BeneosInfoBox } from "./beneos_info_box.js"
// No import cycle: beneos_analytics pulls in beneos_utility and
// cloud-v2/beneos-install-state, and neither reaches back here.
import { BeneosAnalytics } from "./beneos_analytics.js"
import { normalizeEmbeddedItems } from "./cloud-v2/beneos-ability-icons.mjs"

// FilePicker.upload(..., { notify: false }) used to swallow failures
// (disk full, permissions, server reject) — the await would resolve,
// the loop would continue, and the asset would be missing on disk
// without any signal to the user. _beneosSafeUpload wraps the call,
// validates the return value, and surfaces the failure through
// console.warn + a notification, while still returning so the caller
// can decide whether to continue or abort.
async function _beneosSafeUpload(folder, file, label) {
  let result = null
  try {
    result = await foundry.applications.apps.FilePicker.implementation.upload(
      "data", folder, file, {}, { notify: false }
    )
  } catch (err) {
    console.warn(`[Beneos Cloud] FilePicker.upload threw for ${label || file?.name}`, err, { folder, filename: file?.name })
    ui.notifications?.warn?.(
      game.i18n.format("BENEOS.Cloud.Notification.UploadFailed", { filename: file?.name || label || "unknown" })
      || `Beneos: upload of ${file?.name || label || "asset"} failed (${err?.message || "unknown"})`
    )
    return null
  }
  if (!result?.path) {
    console.warn(`[Beneos Cloud] FilePicker.upload returned no path for ${label || file?.name}`, { result, folder, filename: file?.name })
    ui.notifications?.warn?.(
      game.i18n.format("BENEOS.Cloud.Notification.UploadFailed", { filename: file?.name || label || "unknown" })
      || `Beneos: upload of ${file?.name || label || "asset"} did not produce a file on disk`
    )
    return null
  }
  return result
}

// Probe a single installed file. Mirrors #headCheck in the battlemap
// installer (scripts/cloud-v2/beneos-native-installer.mjs), which the token
// path never inherited:
//   - route prefix: a bare "/path" 404s on every Foundry served under a
//     subpath, which would fail EVERY aspect instead of the broken one
//   - cache bust: a stale 404 from a probe taken before the upload landed
//     must not outlive it
//   - stub guard: the uninstaller cannot delete, it overwrites with a 1-byte
//     placeholder that answers 200 and would pass as a healthy asset
const BENEOS_STUB_MAX_BYTES = 8
function _beneosUsingTheForge() {
  return typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge === true
}
async function _beneosProbeInstalledFile(path) {
  try {
    const base = "/" + String(path).replace(/^\/+/, "")
    const url = (foundry.utils?.getRoute?.(base) || base) + "?_b=" + Date.now()
    const res = await fetch(url, { method: "HEAD" })
    if (!res.ok) return false
    if (/text\/html/i.test(res.headers.get("content-type") || "")) return false
    const len = Number(res.headers.get("content-length"))
    if (Number.isFinite(len) && len <= BENEOS_STUB_MAX_BYTES) return false
    return true
  } catch (err) {
    return false
  }
}

// Post-install health-check: after a token/item/spell has been processed,
// HEAD-probe each expected asset aspect on disk. Catches partial installs
// where the cloud response was missing an aspect (forgotten field) or an
// upload silently failed despite _beneosSafeUpload's guards. Returns a
// list of missing aspect labels so callers can aggregate batch results
// later; emits a console.warn + ui.notifications.warn per asset when
// anything is missing.
//
// For tokens the caller passes `tokenImages` from the cloud response, not a
// count. Two reasons. The filename is read from the response instead of being
// rebuilt as `${key}-${i}-top.webp`, because the upload uses the server's
// filename (see importTokenToCompendium) and a naming drift between the two
// would report a file that is sitting right there. And top-down is now
// mandatory per product rule, so a variant that ships without one is a real
// failure and gets reported with its own label rather than being skipped.
//
// On The Forge every probe is skipped. Assets live behind a foreign asset
// library prefix there, so probing "/beneos_assets/..." would mark every
// single aspect as missing. Same reasoning as the battlemap installer.
// `source` carries the images from the cloud response: the tokenImages array
// for tokens, the itemImage/spellImage bag for the other two. Each expected
// entry keeps a reference to its payload, which is what makes the repair pass
// below possible without asking the server again. A bare number is still
// accepted from older callers and falls back to the naming convention.
async function _beneosValidateInstalledAsset(kind, key, source = 1) {
  if (!key) return { aspectsExpected: 0, aspectsMissing: [] }
  if (_beneosUsingTheForge()) return { aspectsExpected: 0, aspectsMissing: [] }
  const expected = []
  if (kind === "token") {
    const folder = `beneos_assets/cloud/tokens/${key}`
    const images = Array.isArray(source)
      ? source
      : Array.from({ length: Number(source) || 1 }, () => null)
    const ASPECTS = ["token", "avatar", "journal", "top"]
    images.forEach((img, idx) => {
      const i = idx + 1
      for (const aspect of ASPECTS) {
        const data = img?.[aspect]
        expected.push({
          folder,
          file: data?.filename || `${key}-${i}-${aspect}.webp`,
          label: `variant ${i} ${aspect}`,
          data
        })
      }
    })
  } else if (kind === "item" || kind === "spell") {
    const folder = `beneos_assets/cloud/${kind === "item" ? "items" : "spells"}/${key}`
    const bag = (source && typeof source === "object" && !Array.isArray(source)) ? source : null
    for (const aspect of ["icon", "front", "back"]) {
      const data = bag?.[aspect]
      expected.push({ folder, file: data?.filename || `${key}-${aspect}.webp`, label: aspect, data })
    }
  } else {
    return { aspectsExpected: 0, aspectsMissing: [] }
  }

  const missing = []
  await Promise.allSettled(expected.map(async (e) => {
    if (!(await _beneosProbeInstalledFile(`${e.folder}/${e.file}`))) missing.push(e.label)
  }))

  if (missing.length > 0) {
    console.warn(`[Beneos Cloud] Post-install validation: ${kind} ${key} missing ${missing.length}/${expected.length} aspect(s):`, missing)
    try {
      ui.notifications?.warn?.(
        game.i18n.format("BENEOS.Cloud.Notification.PostInstallIncomplete", {
          kind, key, count: missing.length, total: expected.length, aspects: missing.join(", ")
        })
        || `Beneos: ${kind} '${key}' install incomplete, ${missing.length}/${expected.length} aspect(s) missing: ${missing.join(", ")}`
      )
    } catch (e) { /* notifications not ready */ }
  }
  return { aspectsExpected: expected.length, aspectsMissing: missing, expected }
}

// Repair pass for the token/item/spell path. The battlemap installer has had
// one since forever (#verifyAndRepair in cloud-v2/beneos-native-installer.mjs);
// here a missing aspect was terminal and the user was told to re-install the
// whole asset by hand.
//
// The transport differs from the battlemap side: the bytes already came down
// inside the JSON response as base64, so there is nothing to re-download. What
// failed is the upload, and that is what gets retried, one file at a time
// rather than in the parallel burst of the first pass. Aspects the server
// never delivered (no image64) cannot be repaired from here and stay missing;
// that is a catalog defect, not a transfer problem.
//
// Mutates `health.aspectsMissing` in place so callers see the post-repair
// truth, and returns the number of files recovered.
async function _beneosRepairMissingAspects(kind, key, health) {
  if (!health || !Array.isArray(health.expected) || health.aspectsMissing.length === 0) return 0
  if (_beneosUsingTheForge()) return 0
  const stillMissing = new Set(health.aspectsMissing)
  const candidates = health.expected.filter(e => stillMissing.has(e.label))
  let repaired = 0

  for (const e of candidates) {
    if (!e.data?.image64 || !e.data?.filename) continue // server never sent it
    try {
      const resp = await fetch(`data:image/webp;base64,${e.data.image64}`)
      const blob = await resp.blob()
      const file = new File([blob], e.data.filename, { type: "image/webp" })
      const up = await _beneosSafeUpload(e.folder, file, `${kind} ${key} ${e.label} (repair)`)
      if (!up?.path) continue
      if (!(await _beneosProbeInstalledFile(`${e.folder}/${e.file}`))) continue
      stillMissing.delete(e.label)
      repaired += 1
    } catch (err) {
      console.warn(`[Beneos Cloud] Repair of ${kind} ${key} ${e.label} threw`, err)
    }
  }

  health.aspectsMissing = health.aspectsMissing.filter(l => stillMissing.has(l))
  if (repaired > 0) {
    console.warn(`[Beneos Cloud] Repair pass recovered ${repaired} aspect(s) for ${kind} ${key}; ${health.aspectsMissing.length} still missing`)
  }
  return repaired
}

// Telemetry is never allowed to break an install, so the call is wrapped.
function _beneosTrackAssetInstallError(kind, key, health) {
  try { BeneosAnalytics.trackAssetInstallError(kind, key, health) } catch (_) { /* swallow */ }
}

// Compendium UI refresh helper. After a fresh import the open compendium
// window kept showing the stale index (newly imported actors were absent
// until the user closed and reopened the pack). Force a fresh index and
// re-render every Application instance attached to the pack.
async function _beneosRefreshOpenPackWindows(pack) {
  if (!pack) return
  try { await pack.getIndex({ force: true }) } catch (e) { /* getIndex variations across foundry versions */ }
  const apps = pack.apps || []
  for (const app of apps) {
    try { await app.render(false) } catch (e) { /* per-app render failed */ }
  }
}

// A refused import, put into words the user can act on. The server answers a
// refusal with `reason: "loyalty" | "tier"`; anything older answers without one
// and we keep the previous generic wording.
//
// Until 2026-08-24 every refusal produced the same "Error importing token"
// regardless of cause, so a supporter who ran into a reward from a month they
// were not subscribed in had no way to tell that apart from a real fault. `kind`
// is "Token" | "Item" | "Spell" and matches the ImportError* key suffix.
function _beneosRefusalMessage(kind, data) {
  const reason = String(data?.reason || "")
  if (reason === "loyalty") return game.i18n.localize("BENEOS.Cloud.Notification.RefusedLoyalty")
  if (reason === "tier") return game.i18n.localize("BENEOS.Cloud.Notification.RefusedTier")
  return game.i18n.localize(`BENEOS.Cloud.Notification.ImportError${kind}`)
}

// Server-side asset-aspect manifest consumer. The cloud now ships a
// `_metadata.aspectsMissing` list per get_token/get_item/get_spell
// response — assets the server knows are not available on its storage.
// We surface that pre-install so the user understands the lack of disk
// presence isn't a local failure. Defensive: when the server hasn't
// been deployed yet, `_metadata` is undefined and we skip silently.
function _beneosReportCloudMetadata(kind, key, payload) {
  const metadata = payload?._metadata
  if (!metadata) return
  const missing = Array.isArray(metadata.aspectsMissing) ? metadata.aspectsMissing : []
  if (missing.length === 0) return
  console.warn(`[Beneos Cloud] Server reports ${missing.length} missing aspect(s) for ${kind} ${key}:`, missing)
  try {
    ui.notifications?.warn?.(
      game.i18n.format("BENEOS.Cloud.Notification.ServerMissingAspects", {
        kind, key, count: missing.length, aspects: missing.join(", ")
      })
      || `Beneos: cloud could not deliver ${missing.length} aspect(s) for ${kind} '${key}': ${missing.join(", ")}`
    )
  } catch (e) { /* notifications not ready */ }
}

export class BeneosCloudSettings extends FormApplication {
  async render() {
    if (!game.beneos?.cloud) return
    // Confirm before disconnect — the Foundry-Settings menu entry
    // looks like "Manage Account" but actually triggers a logout when
    // already signed in. The dialog makes the destructive intent
    // explicit instead of relying on the user reading the label.
    const DialogV2 = foundry?.applications?.api?.DialogV2
    let proceed = true
    if (DialogV2?.confirm) {
      try {
        proceed = await DialogV2.confirm({
          window: { title: game.i18n.localize("BENEOS.Cloud.Disconnect.ConfirmTitle") },
          content: `<p>${game.i18n.localize("BENEOS.Cloud.Disconnect.ConfirmContent")}</p>`,
          yes: { label: game.i18n.localize("BENEOS.Cloud.Disconnect.ConfirmYes") },
          no:  { label: game.i18n.localize("BENEOS.Cloud.Disconnect.ConfirmNo") },
          rejectClose: false
        })
      } catch (e) {
        proceed = false
      }
    }
    if (proceed) await game.beneos.cloud.disconnect()
  }
}

// Wave B-9-fix-68: single state-aware settings menu. Foundry's
// game.settings.registerMenu() instantiates the registered class on
// click; we dispatch from there based on the live login state instead
// of registering two conditional menus at module init (which couldn't
// react to runtime state changes without a reload).
export class BeneosCloudAccountMenu extends FormApplication {
  render(force, options) {
    const cloud = game.beneos?.cloud
    if (cloud?.isLoggedIn?.()) {
      return new BeneosCloudSettings().render(force, options)
    }
    return new BeneosCloudLogin().render(force, options)
  }
}

// Maintenance entry registered as a Foundry Settings-Menu. On click,
// scans the Beneos compendiums (actors / items / spells / journals) for
// orphan entries — those without a folder, with missing local asset
// files, or with no matching world actor — and lets the GM pick which
// to delete. Uses a one-shot DialogV2 instead of a full FormApplication
// since the UX is "scan + confirm + done".
export class BeneosOrphanCleanupMenu extends FormApplication {
  async render() {
    const cloud = game.beneos?.cloud
    if (!cloud) {
      ui.notifications?.warn?.("Beneos cloud is not initialised yet")
      return this
    }
    try {
      await cloud.runOrphanCleanup()
    } catch (err) {
      console.error("[Beneos Cloud] OrphanCleanup failed", err)
      ui.notifications?.error?.(`Beneos cleanup failed: ${err?.message || "unknown"}`)
    }
    return this
  }
}

// Manual ZIP-import entry registered as a Foundry Settings-Menu (bottom of the
// Beneos settings). On click it opens a local file dialog to pick a release ZIP
// and installs it 1:1 like a cloud install. The importer (+ its fflate ZIP lib)
// is loaded lazily on first use so it costs nothing at startup.
//
// Extends ApplicationV2 (not the deprecated V1 FormApplication) so clicking the
// menu doesn't log a V1-framework deprecation. It never renders a window —
// render() just runs the action and returns.
export class BeneosManualZipImportMenu extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "beneos-manual-zip-import", tag: "div" }
  async render() {
    try {
      const { BeneosZipImporter } = await import("./cloud-v2/beneos-zip-importer.mjs")
      await BeneosZipImporter.pickAndImport()
    } catch (err) {
      console.error("[Beneos] Manual ZIP import failed", err)
      ui.notifications?.error?.(`Beneos ZIP import failed: ${err?.message || "unknown"}`)
    }
    return this
  }
}

export class BeneosCloudLogin extends FormApplication {

  /********************************************************************************** */
  constructor(origin = null) {
    super()
    this.requestOrigin = origin
    this.noWorldImport = false
  }

  /********************************************************************************** */
  // Recall the last successfully-used login email (this machine only). Stored
  // base64-obfuscated; returns "" on any miss/corruption so the field just
  // starts empty.
  recallLoginEmail() {
    try {
      const raw = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-last-email") || ""
      if (!raw) return ""
      return decodeURIComponent(escape(atob(raw)))
    } catch (_) {
      return ""
    }
  }

  // Persist the email after a successful login so the next login can pre-fill
  // it. Client scope -> stays in this browser's localStorage, never leaves the
  // machine. Base64 is light obfuscation (not encryption) so a casual glance at
  // localStorage doesn't expose the address. Non-fatal on failure.
  async rememberLoginEmail(email) {
    try {
      const v = (email || "").trim()
      const enc = v ? btoa(unescape(encodeURIComponent(v))) : ""
      await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-last-email", enc)
    } catch (_) {
      /* storing the prefill hint must never block login */
    }
  }

  async loginDialog() {

    // Pre-fill the email field with the last address that logged in on this
    // machine (recovers gracefully from an accidental logout; the OTP code is
    // still required, so this is convenience, not an auth bypass). The field
    // stays editable, which doubles as the "use a different email" reset.
    const savedEmail = this.recallLoginEmail()
    let content = await renderTemplate("modules/beneos-module/templates/beneos-cloud-login.html", { email: savedEmail })

    // Wave B-9-fix-57: rejectClose: false so closing via the X header
    // button resolves with null (matches Cancel) instead of throwing.
    // Wrapped in try/catch as a belt-and-braces in case a future Foundry
    // patch flips the default back. Either way → no error toast on close.
    let dialogContext = null
    try {
      dialogContext = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("BENEOS.Cloud.Login.WindowTitle") },
        // Wave B-5c/B-5d: scope V2 styling onto the login dialog so it matches the
        // unified-window look (gold accent, dark surfaces, compact form) instead
        // of Foundry's default Dialog chrome.
        classes: ["dialog", "app", "window-app", "beneos-cloud-app", "beneos-cloud-login-dialog"],
        content,
        rejectClose: false,
        buttons: [{
          action: "connect",
          label: game.i18n.localize("BENEOS.Cloud.ConnectAccount.ButtonLabel"),
          default: true,
          callback: (event, button, dialog) => {
            // Passwordless: email only. We email a one-time code (login for existing
            // accounts, registration for new ones), then verify it in connectWithCode().
            const emailEl = button.form.elements.email
            return { mode: "otp", action: "login", email: emailEl ? emailEl.value : "" }
          },
        }, {
          // Same email + code flow; "create" just signals new-account intent so the
          // flow sends straight away (and the form hint already explains the Patreon-email tip).
          action: "create",
          label: game.i18n.localize("BENEOS.Cloud.ConnectAccount.CreateAccountButton"),
          callback: (event, button, dialog) => {
            const emailEl = button.form.elements.email
            return { mode: "otp", action: "create", email: emailEl ? emailEl.value : "" }
          },
        }, {
          action: "cancel",
          label: game.i18n.localize("BENEOS.Cloud.Login.Cancel"),
          callback: (event, button, dialog) => {
            return null
          }
        }],
        actions: {
        },
        render: (event, dialog) => { }
      })
    } catch (e) {
      // Treat any close-related rejection the same as a Cancel.
      dialogContext = null
    }

    return dialogContext
  }

  /********************************************************************************** */
  async loginRequest(loginData = null) {

    if (!game.user.isGM) return;

    // Do we have already a UserID ?
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    if (!userId || userId == '') {
      userId = foundry.utils.randomID(32)
    }

    if (loginData == null || typeof loginData === 'boolean') {
      // If we don't have login data, we need to ask the user
      BeneosUtility.debugMessage("No login data, asking user")
      // Show the login dialog
      loginData = await this.loginDialog()
      // Wave B-9-fix-57 → fix-62: silent on Cancel / X / Esc. V13's
      // DialogV2._onSubmit (api/dialog.mjs:242) does
      //   result = (await callback?.()) ?? button.action
      // so a callback returning null falls back to the action name
      // string ("cancel"). That string is truthy and used to slip past
      // the old `if (!loginData) return` guard, which is what surfaced
      // the red "check credentials" error on a plain Cancel click.
      // Treating any non-object return as dismissal covers null,
      // undefined, and the action-name string in one rule.
      if (!loginData || typeof loginData !== "object") return
    }

    // Passwordless path: the user clicked "Connect with email code" in the dialog.
    // Hand off to the one-time-code flow; the email+password branch below is skipped.
    if (loginData.mode === "otp") {
      return this.connectWithCode((loginData.email || "").trim(), userId, { createIntent: loginData.action === "create" })
    }

    // Wave B-9-fix-57: validate that BOTH fields were filled. Empty
    // fields used to fall through to the LoginFailed red error which
    // confused the user — the issue isn't bad credentials, it's an
    // incomplete form. Surface a yellow warn with a clear message.
    if (!loginData.email?.trim() || !loginData.password?.trim()) {
      ui.notifications.warn(game.i18n.localize("BENEOS.Cloud.Notification.LoginIncomplete"))
      return
    }

    let cloudLoginURL = `${BeneosUtility.cloudBase()}/foundry-login.php?email=${encodeURIComponent(loginData.email)}&password=${encodeURIComponent(loginData.password)}&foundryId=${encodeURIComponent(userId)}`
    // Wave B-5d-Hotfix: sanitize URL for console (strip password) so we can
    // share screenshots without leaking credentials.
    BeneosUtility.debugMessage("BENEOS Cloud login attempt:", cloudLoginURL.replace(/password=[^&]+/, "password=***"))
    // Fix #A2 / Wave B-5d-Hotfix: surface fetch failures as user-visible
    // notifications instead of unhandled promise rejections. "Failed to fetch"
    // is a network-level error (DNS / TCP / TLS / CSP / CORS preflight). The
    // error message exposes which class the failure belongs to so we can act.
    fetch(cloudLoginURL, { credentials: 'same-origin' })
      .then(response => {
        // Stage 9: classify the response so the global serverOffline
        // flag and the user-facing notification both reflect the
        // distinction between server-down (5xx, network) and
        // wrong-credentials (4xx).
        game.beneos?.cloud?.markServerStatus?.(response, null)
        if (!response.ok) {
          console.error(`BENEOS Cloud login HTTP ${response.status} ${response.statusText}`)
          if (response.status >= 500) {
            ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.LoginServerOffline"))
          } else {
            ui.notifications.error(game.i18n.format("BENEOS.Cloud.Notification.LoginHttpError", { status: response.status }))
          }
          throw new Error(`HTTP ${response.status}`)
        }
        return response.json()
      })
      .then(data => {
        BeneosUtility.debugMessage("BENEOS Cloud login data", data)
        if (data.result == 'OK') {
          BeneosUtility.debugMessage("BENEOS Cloud login success")
          this.pollForAccess(userId)
        } else {
          BeneosUtility.debugMessage("BENEOS Cloud login error", data)
          ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.LoginFailed"))
        }
      })
      .catch(err => {
        // HTTP-error path already notified above; this branch catches network
        // failures (Failed to fetch / NetworkError) and JSON parse errors.
        if (err && String(err.message).startsWith("HTTP ")) return
        // Stage 9: tag the global flag — true network failure means
        // server is unreachable.
        game.beneos?.cloud?.markServerStatus?.(null, err)
        console.error("BENEOS Cloud login network error:", err)
        ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.LoginServerOffline"))
      })
  }

  /********************************************************************************** */
  // Fix #E7: every URL building site below wraps dynamic segments
  // (foundryId, tokenKey, itemKey, spellKey, filename) in encodeURIComponent.
  // For alphanumeric keys this is a no-op; for keys containing & + space # it
  // makes the request well-formed where it would previously have been rejected
  // by the server. Login URL (line 79) was already encoded.
  pollForAccess(userId) {
    // Poll the index.php for the access_token
    let self = this
    self.nb_wait = 0;
    this.foundryId = userId;
    let requestOrigin = this.requestOrigin

    let pollInterval = setInterval(function () {
      let url = `${BeneosUtility.cloudBase()}/foundry-manager.php?check=1&foundryId=${encodeURIComponent(userId)}`
      // Fix #A4 / Wave B-5d-Hotfix: HTTP-status check + .catch() so server
      // errors and network failures during polling don't loop silently for
      // 30 seconds. Polling stops on the first hard error.
      fetch(url, { credentials: 'same-origin' })
        .then(response => {
          if (!response.ok) {
            clearInterval(pollInterval)
            console.error(`BENEOS Cloud poll HTTP ${response.status} ${response.statusText}`)
            ui.notifications.error(game.i18n.format("BENEOS.Cloud.Notification.LoginHttpError", { status: response.status }))
            throw new Error(`HTTP ${response.status}`)
          }
          return response.json()
        })
        .then(async data => {
          self.nb_wait++;
          if (self.nb_wait > 30) {
            clearInterval(pollInterval)
            ui.notifications.warn(game.i18n.localize("BENEOS.Cloud.Notification.LoginTimeout"))
          }
          BeneosUtility.debugMessage("Fecth response:", data)
          if (data.result == 'OK') {
            clearInterval(pollInterval)
            // Wave B-9-fix-66: Beneos runs two separate Patreon
            // campaigns — "Beneos Battlemaps" and "Beneos Tokens /
            // Spells / Loot". Users from one Patreon can't access the
            // other's content but frequently confuse the two on
            // Discord. We need the server to expose which campaign(s)
            // the authenticated user belongs to so the install path
            // can warn before a futile cloud roundtrip. Until that
            // server-side change ships, log the FULL poll response so
            // we can see exactly which fields the back-end returns
            // today — `patreon_status` is currently the only signal
            // the module reads. After the user shares this log we'll
            // wire up the campaign-distinction check.
            BeneosUtility.debugMessage("[Beneos Cloud] Poll response keys:", Object.keys(data))
            BeneosUtility.debugMessage("[Beneos Cloud] Full payload (excluding sensitive):", {
              ...data,
              // Strip any token-looking fields if they ever appear.
              access_token: data.access_token ? "<redacted>" : undefined
            })
            await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-foundry-id", userId)
            await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-patreon-status", data.patreon_status)
            // Persist per-campaign Patreon membership so the patron-aware
            // UI survives a Foundry restart without requiring a re-login.
            // Falls back to `false` when the server hasn't sent the field
            // (e.g. legacy responses) — strict "true only when explicitly
            // confirmed" semantics match the "in dubio gate" memory rule.
            await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-token-patron", !!data.token_patron)
            await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-battlemap-patron", !!data.battlemap_patron)
            // Stash the raw login response on the cloud singleton so the
            // campaign-check helper can read fields like token_patron /
            // battlemap_patron / campaigns in the same session.
            game.beneos.cloud.lastLoginPayload = data
            game.beneos.cloud.setLoginStatus(true)
            // F7: re-point the ScenePacker session + drop stale caches so the
            // re-render below shows unlocked install buttons without a reload.
            game.beneos.cloud.refreshCloudBrowseSession()
            ui.notifications.info(game.i18n.localize("BENEOS.Cloud.Notification.Connected"))
            // Fix #B-5d / Issue #A5: no more `window.location.reload()`. Refresh the
            // available-content map and re-render the open search-engine in place.
            // V2 (BeneosCloudWindowV2) supports partial part-renders; V1 keeps the
            // legacy close-and-reopen because the v1 Dialog has no partial-render.
            await game.beneos.cloud.checkAvailableContent()
            const v2 = game.beneos.cloudWindowV2
            if (v2) {
              v2.render({ parts: ["home", "sidebar", "results", "footer"] })
            }
          }
        })
        .catch(err => {
          if (err && String(err.message).startsWith("HTTP ")) return
          clearInterval(pollInterval)
          console.error("BENEOS Cloud poll network error:", err)
          ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.LoginNetworkError"))
        })
    }, 1000)
  }

  /********************************************************************************** */
  // Passwordless login (steps 1 + 2): ask the Cloud to email a one-time code, then
  // verify it. On success it reuses pollForAccess() exactly like the password path,
  // so login state, settings and the V2 re-render are handled by the same code.
  async connectWithCode(email, userId, opts = {}) {
    if (!game.user.isGM) return
    if (!email || !email.trim()) {
      ui.notifications.warn(game.i18n.localize("BENEOS.Cloud.Notification.LoginIncomplete"))
      return
    }
    email = email.trim()
    // The "Create account" button signals new-account intent: the user already chose to
    // create one, so we send straight away (confirmCreate) and skip the extra gate.
    const createIntent = opts.createIntent === true

    // Step 1: request a code (shared with the in-dialog "resend" button).
    let first = await this.requestCode(email, userId, createIntent)
    // Unknown email via the plain "Login" button: confirm before creating a fresh account
    // so a typo (especially into an address the user also owns) does not silently fork
    // their identity away from their Patreon/shop entitlements.
    if (!createIntent && first.status === 'new_account') {
      const confirmed = await this.confirmNewAccountDialog(email)
      if (!confirmed) return
      first = await this.requestCode(email, userId, true)
    }
    if (first.status !== 'ok') return
    ui.notifications.info(game.i18n.localize("BENEOS.Cloud.Notification.CodeSent"))

    // A code can still bounce after the server accepted the send. Poll the delivery
    // status once, shortly after, and warn the user if the address is undeliverable.
    this.scheduleDeliveryCheck(email)

    // Step 2: collect the code (with live TTL, resend + help) and verify it.
    const codeData = await this.codeDialog(email, userId, first.ttl)
    // User decided the address was wrong while resending: restart at the email step.
    if (codeData && codeData.changeEmail) { return this.loginRequest() }
    if (!codeData || typeof codeData !== "object" || !codeData.code?.trim()) return
    const code = codeData.code.trim()

    let verURL = `${BeneosUtility.cloudBase()}/foundry-otp-verify.php?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}&foundryId=${encodeURIComponent(userId)}`
    try {
      const resp = await fetch(verURL, { credentials: 'same-origin' })
      game.beneos?.cloud?.markServerStatus?.(resp, null)
      if (!resp.ok) {
        ui.notifications.error(game.i18n.format("BENEOS.Cloud.Notification.LoginHttpError", { status: resp.status }))
        return
      }
      const data = await resp.json()
      if (data.result === 'OK') {
        // Remember the verified address (this machine only) for next time.
        this.rememberLoginEmail(email)
        this.pollForAccess(userId)
      } else {
        ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.CodeInvalid"))
      }
    } catch (err) {
      game.beneos?.cloud?.markServerStatus?.(null, err)
      console.error("BENEOS Cloud OTP verify error:", err)
      ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.LoginServerOffline"))
    }
  }

  /********************************************************************************** */
  // Requests an OTP for an email. Used both for the initial send and the resend button,
  // so the rate limit, suppression and TTL handling live in one place. Returns a small
  // status object; only emits notifications for the failure cases the caller shares.
  // @returns {Promise<{status:'ok'|'new_account'|'rate_limited'|'undeliverable'|'error', ttl:number, retryAfter:number}>}
  async requestCode(email, userId, confirmCreate = false) {
    // otpv=2 marks this client as understanding the new responses (new_account /
    // rate_limited / undeliverable). The server keeps legacy behavior for clients
    // that omit it, so the hardened endpoint is safe to deploy before this module ships.
    let reqURL = `${BeneosUtility.cloudBase()}/foundry-otp-request.php?email=${encodeURIComponent(email)}&foundryId=${encodeURIComponent(userId)}&otpv=2`
    if (confirmCreate) reqURL += `&confirmCreate=1`
    try {
      const resp = await fetch(reqURL, { credentials: 'same-origin' })
      game.beneos?.cloud?.markServerStatus?.(resp, null)
      if (!resp.ok) {
        if (resp.status >= 500) ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.LoginServerOffline"))
        else ui.notifications.error(game.i18n.format("BENEOS.Cloud.Notification.LoginHttpError", { status: resp.status }))
        return { status: 'error', ttl: 0, retryAfter: 0 }
      }
      const data = await resp.json()
      if (data.result === 'OK') {
        return { status: 'ok', ttl: Number(data.ttl) || 600, retryAfter: 0 }
      }
      if (data.result === 'new_account') {
        // Caller decides whether to confirm; no notification here.
        return { status: 'new_account', ttl: 0, retryAfter: 0 }
      }
      if (data.result === 'rate_limited') {
        const retryAfter = Number(data.retry_after) || 0
        ui.notifications.warn(game.i18n.format("BENEOS.Cloud.Notification.CodeRateLimited", { seconds: retryAfter }))
        return { status: 'rate_limited', ttl: 0, retryAfter }
      }
      if (data.result === 'undeliverable') {
        ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.CodeUndeliverable"))
        return { status: 'undeliverable', ttl: 0, retryAfter: 0 }
      }
      ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.LoginFailed"))
      return { status: 'error', ttl: 0, retryAfter: 0 }
    } catch (err) {
      game.beneos?.cloud?.markServerStatus?.(null, err)
      console.error("BENEOS Cloud OTP request error:", err)
      ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.LoginServerOffline"))
      return { status: 'error', ttl: 0, retryAfter: 0 }
    }
  }

  /********************************************************************************** */
  // One-shot, delayed delivery-status poll. If the address hard-bounced / was blocked,
  // tell the user plainly instead of leaving them waiting for a code that never arrives.
  scheduleDeliveryCheck(email) {
    setTimeout(async () => {
      try {
        const url = `${BeneosUtility.cloudBase()}/foundry-otp-status.php?email=${encodeURIComponent(email)}`
        const resp = await fetch(url, { credentials: 'same-origin' })
        if (!resp.ok) return
        const data = await resp.json()
        if (data.result === 'OK' && data.deliverable === false) {
          ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.CodeUndeliverable"))
        }
      } catch (err) {
        // Best-effort only; never block login on the status probe.
      }
    }, 6000)
  }

  /********************************************************************************** */
  // Confirm creating a brand-new Beneos account for an unknown email. The big onboarding
  // pitfall is a typo / wrong address that forks identity away from the user's Patreon /
  // shop email, so the copy nudges them to use the exact one. Returns true to proceed.
  async confirmNewAccountDialog(email) {
    const content = `<section class="bc-login-form">
      <p class="bc-login-form__hint">${game.i18n.format("BENEOS.Cloud.ConnectAccount.NewAccountConfirmBody", { email })}</p>
    </section>`
    let result = false
    try {
      result = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("BENEOS.Cloud.ConnectAccount.NewAccountConfirmTitle") },
        classes: ["dialog", "app", "window-app", "beneos-cloud-app", "beneos-cloud-login-dialog"],
        content,
        rejectClose: false,
        buttons: [{
          action: "create",
          label: game.i18n.localize("BENEOS.Cloud.ConnectAccount.NewAccountConfirmCreate"),
          default: true,
          callback: () => true
        }, {
          action: "cancel",
          label: game.i18n.localize("BENEOS.Cloud.Login.Cancel"),
          callback: () => false
        }]
      })
    } catch (e) {
      result = false
    }
    return result === true
  }

  /********************************************************************************** */
  // Asked on the second+ resend: if a code never arrives, the likeliest cause is a typo
  // in the address. Shows the exact email and lets the user confirm or go back to edit it.
  // Returns "yes" (resend), "change" (edit email), or null (dismissed).
  async confirmEmailDialog(email) {
    const safeEmail = String(email).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    const content = `<section class="bc-login-form">
      <p class="bc-login-form__hint">${game.i18n.localize("BENEOS.Cloud.ConnectAccount.ResendConfirmBody")}</p>
      <p class="bc-login-form__email">${safeEmail}</p>
    </section>`
    let result = null
    try {
      result = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("BENEOS.Cloud.ConnectAccount.ResendConfirmTitle") },
        classes: ["dialog", "app", "window-app", "beneos-cloud-app", "beneos-cloud-login-dialog"],
        content,
        rejectClose: false,
        buttons: [{
          action: "yes",
          label: game.i18n.localize("BENEOS.Cloud.ConnectAccount.ResendConfirmYes"),
          default: true,
          callback: () => "yes"
        }, {
          action: "change",
          label: game.i18n.localize("BENEOS.Cloud.ConnectAccount.ResendConfirmEdit"),
          callback: () => "change"
        }]
      })
    } catch (e) {
      result = null
    }
    return result
  }

  /********************************************************************************** */
  // Second-step dialog: enter the 6-digit code. Adds a live "expires in M:SS" countdown,
  // a rate-limited "resend" button, and inline help for when no email arrives.
  async codeDialog(email, userId, ttl) {
    const RESEND_COOLDOWN = 60 // mirrors the server-side OTP_RESEND_COOLDOWN
    let expiresAt = Date.now() + (Number(ttl) || 600) * 1000
    // The first code was just sent before this dialog opened, so the resend starts
    // on cooldown. We track start + ready so the button can fill from left to right.
    let resendStartedAt = Date.now()
    let resendReadyAt = Date.now() + RESEND_COOLDOWN * 1000
    let countdownTimer = null
    let resendCount = 0          // first resend is frictionless; from the 2nd we re-check the email
    let wantsEmailChange = false // set when the user picks "change email" in the confirm dialog

    const fmt = (totalSeconds) => {
      const s = Math.max(0, Math.floor(totalSeconds))
      const m = Math.floor(s / 60)
      const r = s % 60
      return `${m}:${r.toString().padStart(2, "0")}`
    }

    const content = `<section class="bc-login-form">
      <p class="bc-login-form__hint">${game.i18n.localize("BENEOS.Cloud.ConnectAccount.CodeDescription")}</p>
      <div class="bc-login-form__field">
        <label for="code" class="bc-login-form__label">${game.i18n.localize("BENEOS.Cloud.ConnectAccount.CodeLabel")}</label>
        <input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="bc-login-form__input" />
      </div>
      <p class="bc-login-form__ttl" data-bc-ttl>${game.i18n.format("BENEOS.Cloud.ConnectAccount.CodeExpiresIn", { time: fmt((expiresAt - Date.now()) / 1000) })}</p>
      <button type="button" class="bc-login-form__resend is-cooling" data-bc-resend disabled>
        <span class="bc-login-form__resend-fill" data-bc-resend-fill></span>
        <span class="bc-login-form__resend-label" data-bc-resend-label>${game.i18n.localize("BENEOS.Cloud.ConnectAccount.ResendCooldown")}</span>
      </button>
      <div class="bc-login-form__help">
        <strong>${game.i18n.localize("BENEOS.Cloud.CodeHelp.Title")}</strong>
        <ul>
          <li>${game.i18n.localize("BENEOS.Cloud.CodeHelp.CheckSpam")}</li>
          <li>${game.i18n.localize("BENEOS.Cloud.CodeHelp.UsePatreonEmail")}</li>
          <li>${game.i18n.localize("BENEOS.Cloud.CodeHelp.WaitMinutes")}</li>
        </ul>
      </div>
    </section>`

    let result = null
    try {
      result = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("BENEOS.Cloud.ConnectAccount.Title") },
        classes: ["dialog", "app", "window-app", "beneos-cloud-app", "beneos-cloud-login-dialog"],
        content,
        rejectClose: false,
        render: (event, dialog) => {
          const root = dialog.element
          const ttlEl = root.querySelector("[data-bc-ttl]")
          const resendBtn = root.querySelector("[data-bc-resend]")
          const fillEl = root.querySelector("[data-bc-resend-fill]")
          const labelEl = root.querySelector("[data-bc-resend-label]")

          const tick = () => {
            const now = Date.now()
            // Expiry countdown above the button.
            const remainTtl = (expiresAt - now) / 1000
            if (ttlEl) {
              ttlEl.textContent = remainTtl > 0
                ? game.i18n.format("BENEOS.Cloud.ConnectAccount.CodeExpiresIn", { time: fmt(remainTtl) })
                : game.i18n.localize("BENEOS.Cloud.ConnectAccount.CodeExpired")
            }
            if (!resendBtn) return
            // Resend cooldown shows as a subtle left-to-right fill (no numbers, no
            // pressure). While filling, the label is greyed + non-interactive; once
            // full the button becomes a clear "resend" call to action.
            const cooling = now < resendReadyAt
            if (cooling) {
              const span = resendReadyAt - resendStartedAt
              const pct = span > 0 ? Math.min(100, Math.max(0, ((now - resendStartedAt) / span) * 100)) : 100
              if (fillEl) fillEl.style.width = pct + "%"
              resendBtn.disabled = true
              resendBtn.classList.add("is-cooling")
              if (labelEl) labelEl.textContent = game.i18n.localize("BENEOS.Cloud.ConnectAccount.ResendCooldown")
            } else {
              if (fillEl) fillEl.style.width = "100%"
              resendBtn.disabled = false
              resendBtn.classList.remove("is-cooling")
              if (labelEl) labelEl.textContent = game.i18n.localize("BENEOS.Cloud.ConnectAccount.Resend")
            }
          }
          tick()
          countdownTimer = setInterval(tick, 1000)

          resendBtn?.addEventListener("click", async () => {
            if (resendBtn.disabled) return
            resendBtn.disabled = true // also guards against double-clicks during the confirm dialog
            // From the second resend on, the likeliest reason no code arrives is a typo in
            // the address. Show it and ask before sending again; let the user go back to edit.
            if (resendCount >= 1) {
              const answer = await this.confirmEmailDialog(email)
              if (answer === 'change') { wantsEmailChange = true; dialog.close(); return }
              if (answer !== 'yes') { tick(); return } // dismissed: re-enable per cooldown, no send
            }
            // By the time this dialog is open the account creation is already confirmed
            // (or the account exists), so a resend must always send, never re-prompt.
            const res = await this.requestCode(email, userId, true)
            const now = Date.now()
            if (res.status === 'ok') {
              resendCount++
              expiresAt = now + (Number(res.ttl) || 600) * 1000
              resendStartedAt = now
              resendReadyAt = now + RESEND_COOLDOWN * 1000
              ui.notifications.info(game.i18n.localize("BENEOS.Cloud.Notification.CodeSent"))
              this.scheduleDeliveryCheck(email)
            } else if (res.status === 'rate_limited') {
              // Honour the server's retry window so the fill matches reality.
              resendStartedAt = now
              resendReadyAt = now + (Number(res.retryAfter) || RESEND_COOLDOWN) * 1000
            } else {
              // Request failed: let the user try again right away.
              resendReadyAt = now
            }
            // Snap the fill back to 0 without animating backwards, then resume.
            if (fillEl) {
              const prev = fillEl.style.transition
              fillEl.style.transition = "none"
              fillEl.style.width = "0%"
              void fillEl.offsetWidth // force reflow so the reset is not animated
              fillEl.style.transition = prev
            }
            tick()
          })
        },
        close: () => {
          if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
        },
        buttons: [{
          action: "verify",
          label: game.i18n.localize("BENEOS.Cloud.ConnectAccount.VerifyCode"),
          default: true,
          callback: (event, button, dialog) => {
            const el = button.form.elements.code
            return { code: el ? el.value : "" }
          },
        }, {
          action: "cancel",
          label: game.i18n.localize("BENEOS.Cloud.Login.Cancel"),
          callback: () => null
        }]
      })
    } catch (e) {
      result = null
    } finally {
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
    }
    if (wantsEmailChange) return { changeEmail: true }
    return result
  }

  /********************************************************************************** */
  render(loginData = null) {
    this.loginRequest(loginData)
  }
}

/********************************************************************************** */
export class BeneosCloud {

  cloudConnected = false
  // Stage 9: server-reachability flag, separate from cloudConnected
  // (which is the LOGIN state). serverOffline is true when ANY fetch
  // to beneos.cloud has recently failed at the network level OR
  // returned 5xx. 4xx responses (auth, validation) keep this flag
  // false because they prove the server is up. Auto-recovers via
  // the periodic re-probe in startServerProbeLoop().
  serverOffline = false
  _serverProbeHandle = null
  // Fix #B1: pre-shape so is*Available() can short-circuit cleanly before
  // checkAvailableContent() resolves. Previously this was [], but downstream
  // code accesses it as { tokens, items, spells } and would otherwise throw.
  availableContent = { tokens: [], items: [], spells: [] }

  /********************************************************************************** */
  // Stage 9: central reachability classifier. Every fetch to
  // beneos.cloud should call this with its (response, error) pair so
  // the offline state stays in sync. Only network errors and 5xx flip
  // the flag; 4xx (auth, bad request) and 2xx clear it.
  markServerStatus(response, error) {
    const wasOffline = this.serverOffline
    if (error && !response) {
      // Network-level failure (DNS / TCP / TLS / CORS).
      this.serverOffline = true
    } else if (response && response.status >= 500 && response.status < 600) {
      // Server reachable but in trouble (maintenance, crash, overload).
      this.serverOffline = true
    } else if (response && response.ok) {
      // Server proven up.
      this.serverOffline = false
    } else if (response && response.status >= 400 && response.status < 500) {
      // 4xx — server up, request rejected. Don't toggle offline.
      this.serverOffline = false
    }
    if (wasOffline !== this.serverOffline) this._notifyServerStateChange()
  }

  // Stage 9: re-render the open V2 cloud window so the footer chip
  // and any inline server-state UI reflects the new flag immediately.
  _notifyServerStateChange() {
    try {
      const v2 = game.beneos?.cloudWindowV2
      if (v2?.rendered) v2.render({ parts: ["footer", "results"] })
    } catch (err) {
      console.warn("[Beneos Cloud] Server-state re-render failed", err)
    }
  }

  // Stage 9: probe loop, only active while serverOffline is true.
  // Hits the existing ?check=1 healthcheck endpoint and lets
  // markServerStatus flip the flag back when the server returns.
  // Exponential backoff (60s, 2min, 4min, 8min, cap 10min): when the server
  // is down because of overload, thousands of worlds probing every 60s made
  // the outage worse. The delay resets to 60s once the server answers again.
  startServerProbeLoop() {
    if (this._serverProbeHandle) return
    this._serverProbeDelayMs = 60000
    const scheduleNext = () => {
      this._serverProbeHandle = setTimeout(() => {
        this._serverProbeHandle = null
        if (!this.serverOffline) {
          this._serverProbeDelayMs = 60000
          scheduleNext()
          return
        }
        const userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id") || ""
        const url = `${BeneosUtility.cloudBase()}/foundry-manager.php?check=1&foundryId=${encodeURIComponent(userId)}&_t=${Date.now()}`
        fetch(url, { credentials: 'same-origin' })
          .then(r => this.markServerStatus(r, null))
          .catch(err => this.markServerStatus(null, err))
          .finally(() => {
            this._serverProbeDelayMs = this.serverOffline
              ? Math.min(this._serverProbeDelayMs * 2, 600000)
              : 60000
            scheduleNext()
          })
      }, this._serverProbeDelayMs)
    }
    scheduleNext()
  }

  // Fix #E3: idempotency lock for in-flight imports. Keys look like
  // "token:<assetKey>" / "item:<assetKey>" / "spell:<assetKey>" / "battlemap:<filename>".
  // A repeated click on the same asset while its pipeline is still running is
  // ignored (with a notification) instead of spawning a parallel pipeline that
  // would race on file uploads, compendium delete-then-create, and the search
  // engine close-and-reopen. Released in `finally` blocks so errors don't leak
  // a permanent lock.
  inflightImports = new Set()

  // Globale Serialisierung aller Compendium-Installs (token/item/spell):
  // importXToCompendium entsperrt world.beneos_module_* am Anfang und sperrt
  // am Ende wieder. Zwei PARALLELE Laeufe (verschiedene Assets, schnelle
  // Einzel-Klicks) hebeln sich dabei gegenseitig aus: Lauf A sperrt wieder,
  // waehrend Lauf B noch Folder.create im Pack macht -> "You may not create
  // documents in the locked compendium". Der inflight-Guard oben ist nur
  // pro Asset-Key und verhindert das nicht. Deshalb laufen alle Installs
  // als FIFO-Kette strikt nacheinander.
  installQueue = Promise.resolve()

  enqueueInstall(job) {
    const link = this.installQueue.then(job)
    // Kette darf nie abreissen; der Fehler erreicht den Aufrufer ueber `link`.
    this.installQueue = link.catch(() => { })
    return link
  }

  // Batch-install error log: each entry records an asset whose post-install
  // health-check found missing aspects. Cleared at the start of batchInstall
  // and rendered in updateInstalledAssets when the last asset of the batch
  // completes. Single-install paths (isBatch=false) don't push here — the
  // per-asset notification from the health-check already informs the user.
  importErrors = []

  // Session-only opt-out for the world-update confirmation dialog. Set when
  // the GM picks "Yes, don't ask again this session" in the propagate
  // dialog; resets on world reload (no setting persistence). Keeps batch
  // updates of many creatures from prompting on every single one.
  _skipUpdateConfirmation = false

  // Fix #B-1d: pending canvas drops for cloud-tokens. When a user drags a
  // "Cloud available" token onto the scene, we don't yet have a Foundry
  // document to place — the cloud import takes a few seconds. This map keeps
  // tokenKey -> [{ x, y, sceneId }, ...] entries; once importTokenToCompendium
  // finishes successfully, drainPendingCanvasDrops places one Token per entry.
  // On import failure the entries are discarded with a notification.
  pendingCanvasDrops = new Map()

  // Wave B-9-fix-41: pending actor-sheet drops for cloud-only items /
  // spells. Mirrors pendingCanvasDrops. itemKey -> [{ actorId, kind }]
  // entries; once importItemToCompendium / importSpellToCompendium
  // finishes, drainPendingItemDrops looks up the freshly-installed
  // world Item and creates an embedded copy on each registered actor.
  pendingItemDrops = new Map()

  loginAttempt() {
    this.setLoginStatus(false)
    // Stage 9: fire up the periodic re-probe loop on first attempt.
    // It only actually probes while serverOffline is true, so it's a
    // no-op cost when the server is reachable.
    this.startServerProbeLoop()
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    if (!userId || userId == '') {
      return;
    }

    // Check login validity
    let url = `${BeneosUtility.cloudBase()}/foundry-manager.php?check=1&foundryId=${encodeURIComponent(userId)}`
    // Wave B-5d-Hotfix: silent init-time check; on network failure we don't
    // bother the user with a notification (they haven't asked for anything
    // yet) — just log so devs can see why the cloud chip is not green.
    // Stage 9: feed every response/error through markServerStatus so the
    // serverOffline flag stays accurate at init time too.
    fetch(url, { credentials: 'same-origin' })
      .then(response => {
        game.beneos.cloud.markServerStatus(response, null)
        if (!response.ok) {
          console.warn(`BENEOS Cloud loginAttempt HTTP ${response.status} ${response.statusText}`)
          throw new Error(`HTTP ${response.status}`)
        }
        return response.json()
      })
      .then(async data => {
        BeneosUtility.debugMessage("BENEOS Cloud login data", data)
        if (data.result == 'OK') {
          game.beneos.cloud.setLoginStatus(true)
          // F7: re-point the ScenePacker session + drop stale browse caches so
          // the storefront reflects the new entitlement without a reload.
          game.beneos.cloud.refreshCloudBrowseSession()
          await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-patreon-status", data.patreon_status)
          await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-token-patron", !!data.token_patron)
          await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-battlemap-patron", !!data.battlemap_patron)
          // Cache the raw response in-memory so hasCampaignAccess() can
          // read fresh-from-server fields on the same session without
          // hitting the settings store on every call.
          game.beneos.cloud.lastLoginPayload = data
          // Fix #B2: await the available-content fetch so the search UI sees the
          // populated map on the next render, not an empty placeholder.
          await game.beneos.cloud.checkAvailableContent()
        } else {
          // The cloud answered, and it does not know this Foundry ID any more.
          // That happens for real users: the cloud keeps only the 15 newest
          // Foundry bindings per account, so a GM with many worlds loses the
          // oldest ones. The patron flags live in world settings and used to
          // survive that, which left the storefront claiming "Full Patron"
          // while every release came back locked and no free section appeared
          // (reported 2026-08-03). Drop the claim so the UI asks for a fresh
          // sign-in instead of promising access the server will refuse.
          //
          // Only an ANSWERED request lands here. Network failures and HTTP
          // errors are thrown above and handled in .catch, so being offline
          // never wipes a valid entitlement.
          await game.beneos.cloud.clearStaleEntitlement(data?.information || "")
        }
      })
      .catch(err => {
        if (err && String(err.message).startsWith("HTTP ")) return
        // Stage 9: only mark offline on TRUE network errors (no
        // response object at all). A "HTTP <n>" error was already
        // marked above via markServerStatus on the response.
        game.beneos.cloud.markServerStatus(null, err)
        console.warn("BENEOS Cloud loginAttempt network error:", err)
      })
  }

  /**
   * The cloud no longer recognises this world's Foundry ID. Forget the patron
   * claim that was persisted from an earlier, working session so the UI stops
   * promising access the server will refuse, and tell the GM what to do about
   * it. Idempotent: with nothing left to clear it does nothing at all, so the
   * repeated init check cannot loop on notifications.
   *
   * The Foundry ID itself is kept. A fresh sign-in reuses it and rebinds the
   * same identity, which keeps the world's install history meaningful.
   *
   * @param {string} serverInformation  the server's own wording, for the log
   */
  async clearStaleEntitlement(serverInformation = "") {
    this.setLoginStatus(false)
    this.lastLoginPayload = null
    if (!game.user?.isGM) return          // world settings are GM-writable only

    const M = BeneosUtility.moduleID()
    const had = ["beneos-cloud-patreon-status", "beneos-cloud-token-patron", "beneos-cloud-battlemap-patron"]
      .some(key => {
        try { const v = game.settings.get(M, key); return v === true || (typeof v === "string" && v && v !== "no_patreon") }
        catch (_e) { return false }
      })
    if (!had) return

    console.warn(`BENEOS Cloud | this world's Foundry ID is unknown to the cloud (${serverInformation || "no detail"}); `
      + "clearing the stored Patreon entitlement so the storefront stops showing patron access")
    try {
      await game.settings.set(M, "beneos-cloud-patreon-status", "no_patreon")
      await game.settings.set(M, "beneos-cloud-token-patron", false)
      await game.settings.set(M, "beneos-cloud-battlemap-patron", false)
    } catch (e) {
      console.warn("BENEOS Cloud | could not clear the stale entitlement", e)
      return
    }
    this.refreshCloudBrowseSession()
    ui.notifications?.warn?.(game.i18n.localize("BENEOS.Cloud.SessionExpired"))
  }

  /**
   * F7: after any auth change (interactive login, init auto-login, disconnect)
   * the browse layer must pick up the new identity WITHOUT a world reload. The
   * ScenePacker manager holds a `sessionId` (the Foundry ID) plus cached
   * release/bundle lists, and the V2 window memoizes its release list/index and
   * free-map. None of these were refreshed on login, so a stale `anonymous`
   * session lingered: install buttons stayed "locked" and free maps stayed
   * unfetchable until a reload. This re-points the session and drops the caches,
   * mirroring the manual Retry button (_onRetryLoadReleases).
   */
  refreshCloudBrowseSession() {
    const foundryId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id") || "anonymous"
    const mgr = window.BeneosScenePacker
    if (mgr) {
      mgr.sessionId      = foundryId
      mgr._releasesCache = null
      mgr._bundlesCache  = null
    }
    // _releaseList / _releaseIndex / _releaseFreeMap live on the WINDOW INSTANCE
    // (ApplicationV2 action handlers like _onRetryLoadReleases run with this =
    // the instance), so clear them there , not on the constructor. Only present
    // while the cloud window is open; a fresh instance loads fresh anyway.
    const v2 = game.beneos?.cloudWindowV2
    if (v2) {
      v2._releaseList    = null
      v2._releaseIndex   = null
      v2._releaseFreeMap = null
    }
  }

  async disconnect() {
    this.setLoginStatus(false)
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-foundry-id", "")
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-patreon-status", "no_patreon")
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-token-patron", false)
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-battlemap-patron", false)
    this.lastLoginPayload = null
    // F7: reset the ScenePacker session to anonymous + drop caches so the
    // storefront re-locks correctly without a reload.
    this.refreshCloudBrowseSession()
    // Fix #B-5d / Issue #A5: no full GUI reload. Clear the available-content map,
    // surface a notification, and re-render the V2 window if it's open.
    this.availableContent = { tokens: [], items: [], spells: [] }
    ui.notifications.info(game.i18n.localize("BENEOS.Cloud.Notification.Disconnected"))
    const v2 = game.beneos?.cloudWindowV2
    if (v2) {
      v2.render({ parts: ["home", "sidebar", "results", "footer"] })
    }
    BeneosUtility.debugMessage("BeneosModule: disconnected from Beneos Cloud")
  }

  isLoggedIn() {
    return this.cloudConnected
  }

  // Fix #B-1d: called from the dropCanvasData hook in beneos_module.js when a
  // user drops a "Cloud available" token onto the scene. We register the drop
  // position (so multiple drags of the same token can each land at their own
  // spot) and kick off the cloud import. The actual token placement happens
  // later, in drainPendingCanvasDrops, once the compendium has the document.
  //
  // Wave B-9-fix-49: payload may carry `beneosTokenKeys: [...]` when the user
  // dragged a Ctrl+click multi-selection. Each key gets its own drop position
  // distributed in a ring around the original drop point so the tokens don't
  // stack on top of each other when they pop in.
  async handlePendingCanvasDrop(canvas, data) {
    const sceneId = canvas.scene?.id
    const grid = canvas.scene?.grid?.size || 100
    const tokenKeys = Array.isArray(data?.beneosTokenKeys) && data.beneosTokenKeys.length
      ? data.beneosTokenKeys
      : (data?.beneosTokenKey ? [data.beneosTokenKey] : [])
    if (!tokenKeys.length) return

    // Gate before any UI state change (notifyInstallStarted, notifications,
    // pending-drop registration). Otherwise the GM sees the install
    // animation running while the system-compat prompt is still up.
    if (!await BeneosUtility.confirmSystemCompat("token")) return;

    // Ring/grid distribution: first token at the drop point, subsequent
    // ones placed one grid step away in cardinal then diagonal directions
    // for a clean cluster around the cursor. Beyond 9 the pattern reaches
    // out one further ring; rare in practice but bounded.
    const offsets = [
      [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1],
      [1, 1], [-1, 1], [-1, -1], [1, -1],
      [2, 0], [0, 2], [-2, 0], [0, -2],
      [2, 1], [-2, 1], [2, -1], [-2, -1],
      [1, 2], [-1, 2], [1, -2], [-1, -2]
    ]

    // Stage 5: pull variant-strip-specific fields off the payload so
    // drainPendingCanvasDrops can place the correct variant with the
    // right style. Stage 6: when the result-card drag has no explicit
    // beneosForceStyle (only the variant-strip drag adds it), fall
    // back to the user's default install-style setting so the result-
    // card drop respects the GM's sidebar choice for already-installed
    // creatures too.
    const variantIndex = data?.beneosVariantIndex || 1
    let forceStyle = data?.beneosForceStyle
    if (!forceStyle) {
      try {
        forceStyle = game.settings.get(BeneosUtility.moduleID(), "beneos-default-install-style")
      } catch (e) { /* setting not registered yet */ }
    }
    forceStyle = forceStyle || "tokenized"

    for (let i = 0; i < tokenKeys.length; i++) {
      const tokenKey = tokenKeys[i]
      const [dx, dy] = offsets[i] || [i, 0]
      const x = data.x + dx * grid
      const y = data.y + dy * grid
      if (!this.pendingCanvasDrops.has(tokenKey)) {
        this.pendingCanvasDrops.set(tokenKey, [])
      }
      this.pendingCanvasDrops.get(tokenKey).push({ x, y, sceneId, variantIndex, forceStyle })
      game.beneos?.cloudWindowV2?.notifyInstallStarted?.(tokenKey)
    }

    if (tokenKeys.length === 1) {
      ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.ImportingForCanvas", { key: tokenKeys[0] }))
    } else {
      ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.ImportingMultipleForCanvas", { count: tokenKeys.length }))
    }

    // Wave B-9-fix-47: await each pipeline so the compendium lock/unlock
    // cycle finishes before the next starts. The previous fire-and-forget
    // approach worked for single tokens but races on multi.
    for (const tokenKey of tokenKeys) {
      if (!this.inflightImports.has(`token:${tokenKey}`)) {
        // Pre-gated above; pass opts.gated=true so importTokenFromCloud
        // doesn't re-prompt. isBatch stays false so the import* function
        // continues to manage its own compendium lock cycle.
        await this.importTokenFromCloud(tokenKey, undefined, false, { gated: true })
      }
    }
  }

  // Fix #B-1d: place one Token per registered drop position once the cloud
  // import has produced a world actor. Called from the success branch of
  // importTokenToCompendium. On failure, discardPendingCanvasDrops clears the
  // map and surfaces a notification.
  async drainPendingCanvasDrops(tokenKey) {
    const pending = this.pendingCanvasDrops.get(tokenKey)
    if (!pending || pending.length === 0) return

    // Primary world actor (variant 1) — used for the legacy result-
    // card-drag path. Stage 5 may override per-drop with a specific
    // variant actor pulled from the compendium.
    const primaryWorldActor = game.actors?.find(a => {
      const flag = a.getFlag("world", "beneos")
      return flag?.tokenKey === tokenKey
    })
    const compendium = game.packs?.get("world.beneos_module_actors")

    for (const drop of pending) {
      const scene = game.scenes.get(drop.sceneId)
      if (!scene) continue

      // Stage 5: resolve the variant-specific actor. Variant 1 has a
      // world copy; variants 2..N are compendium-only. The variant
      // strip drag passes drop.variantIndex; the result-card path
      // defaults to 1.
      const variantIdx = drop.variantIndex || 1
      let actorForPlace = null
      if (variantIdx === 1) {
        actorForPlace = primaryWorldActor
      } else {
        const variantActorId = BeneosUtility.getActorIdVariant(tokenKey, variantIdx)
        if (variantActorId && compendium) {
          try { actorForPlace = await compendium.getDocument(variantActorId) }
          catch (err) { console.warn("BeneosModule: compendium variant lookup failed", err) }
        }
      }
      if (!actorForPlace) {
        console.error("BeneosModule: cannot resolve actor for pending canvas drop", tokenKey, drop)
        continue
      }

      // Bridge flag for the preCreateToken hook — flips the texture src
      // to -top.webp before the placeable is committed when the drop
      // intent is Top-Down. We verify the -top.webp counterpart is on
      // disk first; if it isn't (server didn't ship it, or the asset
      // simply wasn't rendered yet) we degrade to 2.5D rather than
      // leaving the user with a broken-image token on the canvas.
      let effectiveStyle = drop.forceStyle || "tokenized"
      if (effectiveStyle === "topdown") {
        const protoSrc = actorForPlace?.prototypeToken?.texture?.src || ""
        const topPath = protoSrc.includes("-top.webp")
          ? protoSrc
          : (protoSrc.includes("-token.webp")
              ? protoSrc.replace("-token.webp", "-top.webp")
              : null)
        let topPresent = false
        if (topPath) {
          try {
            const url = topPath.startsWith("/") ? topPath : `/${topPath}`
            const res = await fetch(url, { method: "HEAD" })
            topPresent = res.ok
          } catch (e) { topPresent = false }
        }
        if (!topPresent) {
          console.warn("[Beneos Cloud] Top-Down asset missing for token", tokenKey,
            "variant", variantIdx, "— falling back to 2.5D for this drop")
          effectiveStyle = "tokenized"
        }
      }
      BeneosUtility._pendingDropStyle = effectiveStyle
      try {
        const tokenDoc = await actorForPlace.getTokenDocument({ x: drop.x, y: drop.y })
        await scene.createEmbeddedDocuments("Token", [tokenDoc.toObject()])
      } catch (err) {
        console.error("BeneosModule: failed to place pending token on canvas", tokenKey, drop, err)
      }
    }
    this.pendingCanvasDrops.delete(tokenKey)
    // Wave B-5e: drag-install completed successfully — flash the card green
    // and settle into the installed state.
    game.beneos?.cloudWindowV2?.notifyInstallEnded?.(tokenKey, true)
  }

  // Fix #B-1d: clear pending canvas drops for a token whose import failed.
  // Called from the error branches of importTokenFromCloud / catch handler.
  discardPendingCanvasDrops(tokenKey) {
    if (!this.pendingCanvasDrops.has(tokenKey)) return
    this.pendingCanvasDrops.delete(tokenKey)
    ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.ImportErrorToken"))
    // Wave B-5e: drag-install failed — clear the in-progress visual so the
    // card snaps back to "cloud available" and the user can retry.
    game.beneos?.cloudWindowV2?.notifyInstallEnded?.(tokenKey, false)
  }

  // Wave B-9-fix-41: cloud item / spell dropped on a character sheet.
  // Mirrors handlePendingCanvasDrop. The dropActorSheetData hook in
  // beneos_module.js calls this with the dropped-on actor and the
  // payload from the search-engine dragstart. We register the drop,
  // kick off the cloud import (if not already running), then return —
  // drainPendingItemDrops will add the installed item to the actor
  // once the world doc is created.
  //
  // Wave B-9-fix-46: payload may carry `beneosItemKeys` (an array)
  // when the user dropped a multi-select; iterate and register each
  // key on the same actor so all selected items get added once their
  // imports complete.
  async handlePendingItemDrop(actor, data) {
    const kind = data?.beneosAssetKind === "spell" ? "spell" : "item"
    if (!actor) return
    const keys = Array.isArray(data?.beneosItemKeys) && data.beneosItemKeys.length
      ? data.beneosItemKeys
      : (data?.beneosItemKey ? [data.beneosItemKey] : [])
    if (!keys.length) return

    // Gate before any UI state change. On non-dnd5e this fires the
    // hard-block info dialog for items/spells and aborts the drop without
    // ever flipping the cards into "Installing" state.
    if (!await BeneosUtility.confirmSystemCompat(kind)) return;

    // One token per drop event. Used by drainPendingItemDrops to group
    // spells from the same drop so the Pact-Magic "apply to all" choice
    // can flow across them (BeneosUtility._pactMagicBatchCache).
    const batchToken = (keys.length > 1) ? foundry.utils.randomID() : ""

    // Step 1 — register all drops + show progress visuals up front so the
    // user sees the cards switch to "Installing" the moment they drop,
    // not one-at-a-time as the queue drains.
    for (const itemKey of keys) {
      if (!this.pendingItemDrops.has(itemKey)) {
        this.pendingItemDrops.set(itemKey, [])
      }
      this.pendingItemDrops.get(itemKey).push({ actorId: actor.id, kind, batchToken })
      game.beneos?.cloudWindowV2?.notifyInstallStarted?.(itemKey)
    }

    if (keys.length === 1) {
      ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.ImportingForActorSheet", { key: keys[0] }))
    } else {
      ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.ImportingMultipleForActorSheet", { count: keys.length }))
    }

    // Step 2 — Wave B-9-fix-50: await each import in turn. The previous
    // version fired all imports in parallel, which raced on the shared
    // compendium lock (importItemToCompendium / importSpellToCompendium
    // unlock → write → lock) and threw "may not create documents in the
    // locked compendium" mid-batch. Awaiting serialises the lock cycle.
    for (const itemKey of keys) {
      const lockKey = `${kind}:${itemKey}`
      if (this.inflightImports.has(lockKey)) continue
      // Pre-gated above; pass opts.gated=true so import* doesn't re-prompt.
      // isBatch stays false so the import* function manages its own
      // compendium lock cycle.
      if (kind === "spell") await this.importSpellsFromCloud(itemKey, undefined, false, { gated: true })
      else                  await this.importItemFromCloud(itemKey, undefined, false, { gated: true })
    }
  }

  // Add the freshly-installed world Item to every actor that received a
  // cloud-drop while the import was in flight. Called from the success
  // branch of importItemToCompendium / importSpellToCompendium.
  async drainPendingItemDrops(itemKey, kind) {
    const pending = this.pendingItemDrops.get(itemKey)
    if (!pending || pending.length === 0) return

    // Look up the world Item document that the import just created.
    // Items installed via importItemToCompendium also import to the
    // world's items collection (game.items) and carry a flag
    // world.beneos.itemKey (or spellKey) we can match on.
    const flagKey = kind === "spell" ? "spellKey" : "itemKey"
    const worldItem = game.items?.find?.(i => {
      const flag = i.getFlag?.("world", "beneos")
      return flag?.[flagKey] === itemKey
    })
    if (!worldItem) {
      console.error("BeneosModule: cannot resolve pending item drops; world item not found for", itemKey)
      this.pendingItemDrops.delete(itemKey)
      return
    }

    for (const drop of pending) {
      const actor = game.actors?.get?.(drop.actorId)
      if (!actor) continue
      try {
        const itemData = worldItem.toObject()

        // Warlock Pact-Magic: leveled spells dropped on a Warlock get a
        // chance to be marked as Pact-cast so dnd5e routes them through
        // the pact-slot pool instead of normal spell slots. Cantrips skip
        // the prompt (level 0 spells never consume slots either way).
        if (kind === "spell"
            && itemData.type === "spell"
            && (itemData.system?.level ?? 0) > 0
            && BeneosUtility.isWarlockActor(actor)) {
          const choice = await BeneosUtility.askPactMagicChoice({
            spellItem: worldItem,
            actor,
            batchToken: drop.batchToken
          });
          if (choice === "pact") BeneosUtility.applyPactMagicToSpellData(itemData);
        }

        await actor.createEmbeddedDocuments("Item", [itemData])
      } catch (err) {
        console.error("BeneosModule: failed to add cloud item to actor", itemKey, drop, err)
      }
    }
    // Clean up per-batch Pact-cache entries owned by this batch token. Safe
    // even when no Warlock prompt fired — clearPactMagicBatchCache no-ops
    // on missing keys.
    for (const drop of pending) {
      BeneosUtility.clearPactMagicBatchCache(drop.actorId, drop.batchToken);
    }
    this.pendingItemDrops.delete(itemKey)
    game.beneos?.cloudWindowV2?.notifyInstallEnded?.(itemKey, true)
  }

  // Clear pending item drops for a key whose import failed. Called from
  // the error branches of importItemFromCloud / importSpellsFromCloud.
  discardPendingItemDrops(itemKey) {
    if (!this.pendingItemDrops.has(itemKey)) return
    this.pendingItemDrops.delete(itemKey)
    game.beneos?.cloudWindowV2?.notifyInstallEnded?.(itemKey, false)
  }

  getPatreonStatus() {
    return game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-patreon-status")
  }

  // Wave B-9-fix-66: Beneos has two Patreon campaigns:
  //   - Beneos Battlemaps (gives access to bmaps via Moulinette; not
  //     served by this module's Cloud install path)
  //   - Beneos Tokens / Spells / Loot (gives access to the cloud-served
  //     creature, item, and spell catalogue)
  // Users frequently support one but not the other and don't realise
  // their Battlemaps subscription doesn't unlock tokens. This helper
  // returns true when the authenticated user has access to a given
  // campaign category. Until the server starts returning explicit
  // campaign membership in the poll response (e.g. data.campaigns =
  // ["battlemaps", "tokens"]), we fall back to the existing single-
  // string `patreon_status` setting and treat any "active_*" value as
  // having access — the strict check kicks in only when we see the
  // expected campaign field.
  //
  // Categories: "battlemaps" | "tokens" | "items" | "spells"
  hasCampaignAccess(category) {
    // tokens / items / spells are all unlocked by the same "Beneos
    // Tokens" Patreon campaign, so collapse them into one key.
    const isBattlemaps = (category === "battlemaps")
    const settingKey = isBattlemaps ? "beneos-cloud-battlemap-patron" : "beneos-cloud-token-patron"
    // Primary source: persisted setting — survives Foundry restart
    // without needing a fresh login round-trip.
    try {
      const persisted = game.settings.get(BeneosUtility.moduleID(), settingKey)
      if (persisted === true) return true
      if (persisted === false) {
        // Fall through to the in-memory payload check only when the
        // setting hasn't been populated yet (first login in a fresh
        // session that updated lastLoginPayload but we're being called
        // before the await game.settings.set chain completed).
        const payload = this.lastLoginPayload
        if (payload) {
          if (isBattlemaps && payload.battlemap_patron === true) return true
          if (!isBattlemaps && payload.token_patron === true) return true
        }
        return false
      }
    } catch (e) {
      // Settings not registered yet (very early init) — fall back to
      // the in-memory payload.
    }
    const payload = this.lastLoginPayload
    if (payload) {
      if (isBattlemaps) return !!payload.battlemap_patron
      return !!payload.token_patron
    }
    return false
  }

  setLoginStatus(status) {
    this.cloudConnected = status
    // Reset Tier-3 delta cursor on every auth-status change so the next
    // checkAvailableContent fetches a full catalog. Logins and logouts
    // both signal that the user's Patreon entitlements may have shifted
    // since the last sync — a stale delta cursor would leave the catalog
    // with gaps and trigger Out-of-Sync pills on every card.
    try {
      game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-last-content-fetch-server-time", 0)
    } catch (e) { /* setting not registered yet during module init */ }
  }

  setAvailableContent(content) {
    this.availableContent = content
  }

  // Delta-merge: when checkAvailableContent fetched with a `since` cursor,
  // the server's payload contains only the assets updated since that
  // cursor. Replacing this.availableContent wholesale would shrink the
  // catalog to those few entries, so we merge: existing assets keep
  // their place, updated/added assets overwrite by `key`. Fully
  // backwards-compatible with the full-listing path (delta=false) by
  // delegating to setAvailableContent there.
  mergeAvailableContent(deltaContent) {
    if (!deltaContent || typeof deltaContent !== "object") return
    const mergeList = (existing, incoming) => {
      const out = Array.isArray(existing) ? existing.slice() : []
      if (!Array.isArray(incoming) || !incoming.length) return out
      const indexByKey = new Map()
      for (let i = 0; i < out.length; i++) {
        const k = out[i]?.key
        if (typeof k === "string") indexByKey.set(k.toLowerCase().replaceAll("-", "_"), i)
      }
      for (const entry of incoming) {
        const k = entry?.key
        if (typeof k !== "string") continue
        const nk = k.toLowerCase().replaceAll("-", "_")
        if (indexByKey.has(nk)) {
          out[indexByKey.get(nk)] = entry
        } else {
          out.push(entry)
          indexByKey.set(nk, out.length - 1)
        }
      }
      return out
    }
    this.availableContent = {
      tokens: mergeList(this.availableContent?.tokens, deltaContent.tokens),
      items:  mergeList(this.availableContent?.items,  deltaContent.items),
      spells: mergeList(this.availableContent?.spells, deltaContent.spells)
    }
  }

  getTokenTS(key) {
    let content = this.availableContent.tokens
    if (!content || content.length == 0) return false
    for (const element of content) {
      if (element.key.toLowerCase() == key.toLowerCase()) {
        return element.updated_ts
      }
    }
    return false
  }

  // Fix #B5: keys are normalised with replaceAll (not replace) so multi-hyphen item/spell
  // keys like "my-fancy-token" get all hyphens converted, matching the cloud-side key form.
  // See `beneos-search-engine` skill, issue B5, for context.
  getItemTS(key) {
    let content = this.availableContent.items
    if (!content || content.length == 0) return false
    let key2 = key.toLowerCase().replaceAll("-", "_")
    for (const element of content) {
      let key1 = element.key.toLowerCase().replaceAll("-", "_")
      if (key1 == key2) {
        return element.updated_ts
      }
    }
    return false
  }

  getSpellTS(key) {
    let content = this.availableContent.spells
    if (!content || content.length == 0) return false
    let key2 = key.toLowerCase().replaceAll("-", "_")
    for (const element of content) {
      let key1 = element.key.toLowerCase().replaceAll("-", "_")
      if (key1 == key2) {
        return element.updated_ts
      }
    }
    return false
  }

  // Hash + per-user "new" lookups against the cached available-content
  // list. Both are tolerant to the server not (yet) shipping the field
  // — they return empty string / false respectively. Defensive against
  // malformed entries that lack a `key`.
  _beneosFindCloudAsset(list, key) {
    if (!Array.isArray(list) || !list.length || !key) return null
    const k = String(key).toLowerCase().replaceAll("-", "_")
    for (const element of list) {
      if (!element?.key) continue
      if (String(element.key).toLowerCase().replaceAll("-", "_") === k) return element
    }
    return null
  }
  getTokenHash(key) { return this._beneosFindCloudAsset(this.availableContent?.tokens, key)?.contentSignature || "" }
  getItemHash(key)  { return this._beneosFindCloudAsset(this.availableContent?.items,  key)?.contentSignature || "" }
  getSpellHash(key) { return this._beneosFindCloudAsset(this.availableContent?.spells, key)?.contentSignature || "" }
  getTokenIsNewForUser(key) { return !!this._beneosFindCloudAsset(this.availableContent?.tokens, key)?.isNewForUser }
  getItemIsNewForUser(key)  { return !!this._beneosFindCloudAsset(this.availableContent?.items,  key)?.isNewForUser }
  getSpellIsNewForUser(key) { return !!this._beneosFindCloudAsset(this.availableContent?.spells, key)?.isNewForUser }

  isNew(key) {
    let content = this.availableContent.tokens
    if (!content || content.length == 0) return false
    for (const element of content) {
      if (element.key.toLowerCase() == key.toLowerCase()) {
        // Configurable window (defaults to 30 days). Asset stays in
        // "Newly added" filter as long as updated_ts is within window.
        const tNowWindow = Math.floor(Date.now() / 1000) - BeneosUtility.getNewAssetWindowSeconds()
        return element.updated_ts >= tNowWindow;
      }
    }
    return false
  }

  isTokenAvailable(key) {
    // Defensive: a single malformed cloud entry (missing `key`) used to
    // crash the V2 cloud window render chain. Skip non-string entries
    // and bail early on a non-string lookup key.
    // Normalises hyphens to underscores so it matches isItemAvailable's
    // lookup form — without this, tokens whose DB-holder key uses a
    // hyphen but the cloud-side key uses an underscore (or vice versa)
    // never resolved as available, which sent every Install button into
    // the silent catch-all branch.
    if (!key || typeof key !== "string") return false
    const content = this.availableContent?.tokens
    if (!Array.isArray(content) || !content.length) {
      BeneosUtility.debugMessage("No tokens available from BeneosCloud")
      return false
    }
    const lowKey = key.toLowerCase().replaceAll("-", "_")
    for (const element of content) {
      const ek = element?.key
      if (typeof ek === "string" && ek.toLowerCase().replaceAll("-", "_") === lowKey) return true
    }
    return false
  }

  isItemAvailable(key) {
    if (!key || typeof key !== "string") return false
    const content = this.availableContent?.items
    if (!Array.isArray(content) || !content.length) return false
    const key2 = key.toLowerCase().replaceAll("-", "_")
    for (const element of content) {
      const ek = element?.key
      if (typeof ek !== "string") continue
      const key1 = ek.toLowerCase().replaceAll("-", "_")
      if (key1 == key2) {
        return true
      }
    }
    return false
  }

  isSpellAvailable(key) {
    if (!key || typeof key !== "string") return false
    const content = this.availableContent?.spells
    if (!Array.isArray(content) || !content.length) return false
    const key2 = key.toLowerCase().replaceAll("-", "_")
    for (const element of content) {
      const ek = element?.key
      if (typeof ek !== "string") continue
      const key1 = ek.toLowerCase().replaceAll("-", "_")
      if (key1 == key2) {
        return true
      }
    }
    return false
  }

  // Published-asset allowlist (filename-keyed per type), delivered by the cloud
  // get_content endpoint. Lets the search engine hide catalog entries that are
  // not assigned to any tier yet. Stored as normalised Sets; only refreshed on
  // a full fetch (the server sends `published: null` on delta polls).
  setPublishedSet(published) {
    if (!published || typeof published !== "object") return
    const toSet = (arr) => {
      const s = new Set()
      if (Array.isArray(arr)) {
        for (const k of arr) {
          if (typeof k === "string") s.add(k.toLowerCase().replaceAll("-", "_"))
        }
      }
      return s
    }
    this.publishedSet = {
      token: toSet(published.token),
      item:  toSet(published.item),
      spell: toSet(published.spell)
    }
  }

  // True when the published allowlist is unknown (no gate yet) OR the key is in
  // it. Returns true on absence so a missing/old server never blanks the library.
  isPublished(type, key) {
    const set = this.publishedSet && this.publishedSet[type]
    if (!set) return true
    if (!key || typeof key !== "string") return true
    return set.has(key.toLowerCase().replaceAll("-", "_"))
  }

  // Free allowlist (assets in any "Free" tier), delivered by get_content. The
  // single dynamic source of truth for free status: change the Free tier in the
  // admin panel and the next full fetch reflects it. Only refreshed on a full
  // fetch (server sends `free: null` on delta polls).
  setFreeSet(free) {
    if (!free || typeof free !== "object") return
    const toSet = (arr) => {
      const s = new Set()
      if (Array.isArray(arr)) {
        for (const k of arr) {
          if (typeof k === "string") s.add(k.toLowerCase().replaceAll("-", "_"))
        }
      }
      return s
    }
    this.freeSet = { token: toSet(free.token), item: toSet(free.item), spell: toSet(free.spell) }
  }

  // True when the asset is in the cloud Free tier. Returns null when the free
  // list is unknown so callers can fall back to the catalog free_content flag.
  isFreeAsset(type, key) {
    const set = this.freeSet && this.freeSet[type]
    if (!set) return null
    if (!key || typeof key !== "string") return false
    return set.has(key.toLowerCase().replaceAll("-", "_"))
  }

  // Loyalty allowlist (published reward assets with NO tier link), delivered by
  // get_content and get_public_data. These are the monthly supporter rewards:
  // reachable only through a permanent grant to the patrons who were subscribed
  // that month, never through a tier. Same normalisation as the two sets above.
  setLoyaltySet(loyalty) {
    if (!loyalty || typeof loyalty !== "object") return
    const toSet = (arr) => {
      const s = new Set()
      if (Array.isArray(arr)) {
        for (const k of arr) {
          if (typeof k === "string") s.add(k.toLowerCase().replaceAll("-", "_"))
        }
      }
      return s
    }
    this.loyaltySet = { token: toSet(loyalty.token), item: toSet(loyalty.item), spell: toSet(loyalty.spell) }
  }

  // True when the asset is a monthly reward with no tier link. False when the
  // list is unknown, so an old server or a failed fetch never invents a reason
  // the user cannot act on — the caller then falls back to its generic wording.
  isLoyaltyAsset(type, key) {
    const set = this.loyaltySet && this.loyaltySet[type]
    if (!set) return false
    if (!key || typeof key !== "string") return false
    return set.has(key.toLowerCase().replaceAll("-", "_"))
  }

  // Why a token is (not) installable for THIS user. The creature-installer drawer
  // used to ask only "is this a token patron?" and offered a "+" on every missing
  // creature, including rewards from months the user was not subscribed in. The
  // server then refused and all the user saw was a generic import error next to a
  // success message (Discord report 2026-08-24).
  //
  //   "ok"          -> in this user's catalog, install away
  //   "not_patron"  -> no token-campaign access at all
  //   "loyalty"     -> a monthly reward, and this user has no grant for it
  //   "unavailable" -> patron, but the asset is not in their catalog (draft,
  //                    tier they don't hold, ...)
  //
  // Order matters: a patron WITH the grant has the token in availableContent even
  // though it also sits in the loyalty list, so "ok" has to win. An empty
  // availableContent means the catalog has not arrived yet — answer "ok" so a
  // slow fetch never blanks the drawer, mirroring isPublished's fail-open rule.
  getTokenAccessState(key) {
    if (!key || typeof key !== "string") return "ok"
    const content = this.availableContent?.tokens
    if (!Array.isArray(content) || content.length === 0) return "ok"
    if (this._beneosFindCloudAsset(content, key)) return "ok"
    if (!this.hasCampaignAccess?.("tokens")) return "not_patron"
    if (this.isLoyaltyAsset("token", key)) return "loyalty"
    return "unavailable"
  }

  // Public Free + Published allowlists (catalog-wide, NO login required). Lets the
  // LOGGED-OUT cloud browser still group free content green and hide unpublished
  // drafts, exactly like the storefront — the assets stay click-to-login. Logged-in
  // get_content fetches refresh the same sets, so this is a no-harm pre-population.
  async loadPublicAllowlists() {
    try {
      const r = await fetch(`${BeneosUtility.cloudBase()}/foundry-manager.php?get_public_data=1`, { credentials: 'same-origin' })
      const d = await r.json()
      if (d && d.result === 'OK' && d.data) {
        if (d.data.published) this.setPublishedSet(d.data.published)
        if (d.data.free) this.setFreeSet(d.data.free)
        if (d.data.loyalty) this.setLoyaltySet(d.data.loyalty)
      }
      return d
    } catch (e) {
      console.warn("BeneosModule: loadPublicAllowlists failed", e)
      return null
    }
  }

  // Fix #B2: returns a promise so callers (e.g. loginAttempt, search engine
  // open) can await content readiness before they read availableContent. The
  // function still no-ops gracefully on network/server errors; callers are not
  // forced to handle them. In-dubio-pro-reo: a UI that wants to be optimistic
  // can simply not await and render with the empty initial shape from #B1.
  async checkAvailableContent() {
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    // Tier 3 delta-fetch: include the previously stored server-time cursor
    // so the API can return only assets updated since the last visit.
    // First-run / never-fetched yields cursor=0, which the server treats
    // as "send full catalog". `since` is intentionally an absolute server-
    // time value (not the local clock) — see beneos-cloud-last-content-
    // fetch-server-time setting registration in beneos_utility.js.
    // Tier-3 delta only works as an INCREMENT on an already-populated in-memory
    // catalog. availableContent is a per-session field (resets to empty on every
    // Foundry reload) while the cursor is PERSISTED in settings, so the first
    // fetch of a fresh session must be FULL: otherwise the server returns only a
    // delta and mergeAvailableContent merges it into an empty list, leaving almost
    // every asset falsely reading as "out of sync" until an auto-resync fires.
    // Force a full fetch until the catalog is populated this session.
    let sinceTs = 0
    const ac = this.availableContent
    const populated = !!(ac && ((ac.tokens?.length || 0) + (ac.items?.length || 0) + (ac.spells?.length || 0)) > 0)
    if (populated) {
      try {
        const v = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-last-content-fetch-server-time")
        if (typeof v === "number" && v > 0) sinceTs = v
      } catch (e) { /* setting not registered yet */ }
    }
    let url = `${BeneosUtility.cloudBase()}/foundry-manager.php?get_content=1&foundryId=${encodeURIComponent(userId)}`
    if (sinceTs > 0) url += `&since=${encodeURIComponent(sinceTs)}`
    try {
      const response = await fetch(url, { credentials: 'same-origin' })
      // Stage 9: classify reachability before parsing the body.
      game.beneos?.cloud?.markServerStatus?.(response, null)
      const data = await response.json()
      BeneosUtility.debugMessage("BENEOS Cloud available content", data)
      if (data.result == 'OK') {
        BeneosUtility.debugMessage("Available content: ", data.data)
        // Delta vs full: on a delta response we merge into the existing
        // catalog so the search-engine UI keeps the assets that didn't
        // change. On a full response (no `since` or pre-Tier3 server) we
        // replace as before.
        if (data.data?.delta === true) {
          game.beneos.cloud.mergeAvailableContent(data.data)
        } else {
          game.beneos.cloud.setAvailableContent(data.data)
        }
        // Published allowlist: only present on a full fetch; kept across delta
        // polls so the search engine can hide not-yet-published catalog entries.
        if (data.data?.published) {
          game.beneos.cloud.setPublishedSet(data.data.published)
        }
        // Free allowlist (dynamic Free-tier membership) — same full-fetch contract.
        if (data.data?.free) {
          game.beneos.cloud.setFreeSet(data.data.free)
        }
        // Loyalty allowlist (monthly rewards without a tier link) — same contract.
        // Drives the reason the creature-installer shows for an unreachable token.
        if (data.data?.loyalty) {
          game.beneos.cloud.setLoyaltySet(data.data.loyalty)
        }
        // Lock the cursor to the server's clock so the next fetch is
        // resistant to local-clock drift. If the server (pre-Tier3) did
        // not echo serverTime we leave the cursor untouched, which means
        // the next call also asks for a full listing — safe fallback.
        const serverTime = data.data?.serverTime
        if (typeof serverTime === "number" && serverTime > 0) {
          try {
            game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-last-content-fetch-server-time", serverTime)
          } catch (e) { /* setting not registered yet */ }
        }
      }
      return data
    } catch (err) {
      // Stage 9: network/parse failure — server unreachable from our
      // perspective.
      game.beneos?.cloud?.markServerStatus?.(null, err)
      console.error("BeneosModule: checkAvailableContent failed", err)
      return null
    }
  }

  sendChatMessageResult(event, assetName = "Token", name = undefined, isBatch = false) {
    // No-op: install feedback now lives in the V2 cloud-window footer
    // (mass-install progress band) and per-card pulse/state-pill
    // animation. Whisper-to-GM chat spam was net-negative for actual
    // play. Signature kept so legacy call-sites stay compatible.
  }

  setNoWorldImport() {
    this.noWorldImport = true
    BeneosUtility.debugMessage("No world import set to true")
  }

  // PF2e-Weg fuer Items/Spells: analog zum generic_npc_pf2-Token-Pfad wird
  // statt des dnd5e-Dokuments ein minimales pf2e-World-Item erzeugt (equipment
  // bzw. spell), das Name, Beneos-Bilder und Beschreibung uebernimmt. Die
  // Schema-Defaults fuellt das pf2e-System selbst; die dnd5e-Compendien
  // (world.beneos_module_*) bleiben unangetastet, weil sie dnd5e-only sind.
  async importGenericPF2Documents(assetArray, kind) {
    const isSpell = kind === "spell"
    const cloudBase = isSpell ? "spells" : "items"
    const legacyBase = isSpell ? "beneos_assets/beneos_spells/" : "beneos_assets/beneos_items/"
    const folderName = isSpell ? "Beneos Spells" : "Beneos Loot"
    let created = 0
    for (let key in assetArray) {
      try {
        const data = assetArray[key]
        const json = isSpell ? data.spellJSON : data.itemJSON
        const images = isSpell ? data.spellImage : data.itemImage
        if (!json || !images) continue
        const finalFolder = `beneos_assets/cloud/${cloudBase}/${key}`
        for (const dir of ["beneos_assets", "beneos_assets/cloud", `beneos_assets/cloud/${cloudBase}`, finalFolder]) {
          try {
            await foundry.applications.apps.FilePicker.implementation.createDirectory("data", dir)
          } catch (err) {
            BeneosUtility.debugMessage("Directory already exists")
          }
        }
        for (const aspect of ["front", "back", "icon"]) {
          const part = images[aspect]
          if (!part?.image64) continue
          const resp = await fetch(`data:image/webp;base64,${part.image64}`)
          const file = new File([await resp.blob()], part.filename, { type: "image/webp" })
          await _beneosSafeUpload(finalFolder, file, `${kind} ${key} ${aspect} (pf2e)`)
        }
        const description = String(json.system?.description?.value || "").replaceAll(legacyBase, `beneos_assets/cloud/${cloudBase}/`)
        const flags = foundry.utils.deepClone(json.flags || {})
        const lootRender = foundry.utils.getProperty(flags, "beneos-module.loot.render")
        if (lootRender && typeof lootRender === "object") {
          for (const k of ["frontCardWebp", "backCardWebp", "iconWebp"]) {
            if (typeof lootRender[k] === "string") lootRender[k] = lootRender[k].replaceAll(legacyBase, `beneos_assets/cloud/${cloudBase}/`)
          }
        }
        const docData = {
          name: json.name,
          type: isSpell ? "spell" : "equipment",
          img: images.icon?.filename ? `${finalFolder}/${images.icon.filename}` : json.img,
          system: { description: { value: description } },
          flags
        }
        if (isSpell) {
          docData.system.level = { value: Math.max(1, Number(json.system?.level) || 1) }
        }
        let folder = game.folders.find(f => f.type === "Item" && f.name === folderName)
        if (!folder) folder = await Folder.create({ name: folderName, type: "Item" })
        if (folder) docData.folder = folder.id
        const existing = game.items.find(i => i.name === docData.name && i.img === docData.img)
        if (existing) {
          BeneosUtility.debugMessage("Deleting existing pf2e world item", existing.id)
          try { await existing.delete() } catch (err) { console.warn("[Beneos Cloud] Error deleting existing pf2e item", err) }
        }
        await Item.create(docData)
        created++
      } catch (err) {
        console.warn(`[Beneos Cloud] PF2e ${kind} import failed for ${key}`, err)
      }
    }
    BeneosUtility.debugMessage(`PF2e ${kind} import done`, created)
  }

  async importItemToCompendium(itemArray, event, isBatch = false) {
    // Fix #C5: a single install must always world-import. Reset stale flag from a
    // crashed earlier batch so this install behaves deterministically.
    if (!isBatch) this.noWorldImport = false
    this.beneosItems = {}
    BeneosUtility.debugMessage("Importing item to compendium", itemArray)

    // Punkt 1 — Folder-Restruktur: per-item path is computed inside the loop
    // ("Beneos Loot / SRD / <Item-Type>" or
    //  "Beneos Loot / Beneos Originals / <Origin> / <Item-Type>"). The legacy
    // flat "Beneos Items" world folder is no longer auto-created.

    let tNow = Date.now()
    let properName

    let itemPack
    if (game.system.id == "pf2e") {
      return this.importGenericPF2Documents(itemArray, "item")
    } else {
      itemPack = game.packs.get("world.beneos_module_items")

    }
    if (!itemPack) {
      ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.CompendiumMissing"))
      return
    }
    let itemRecords = await itemPack.getIndex()
    if (!isBatch) {
      await itemPack.configure({ locked: false })
    }

    for (let itemKey in itemArray) {
      let itemData = itemArray[itemKey]
      // Get the common actor data
      let itemObjectData = itemData.itemJSON

      let finalFolder = `beneos_assets/cloud/items/${itemKey}`
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets");
      } catch (err) {
        BeneosUtility.debugMessage("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud");
      } catch (err) {
        BeneosUtility.debugMessage("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud/items");
      } catch (err) {
        BeneosUtility.debugMessage("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", finalFolder);
      } catch (err) {
        BeneosUtility.debugMessage("Directory already exists")
      }
      BeneosUtility.debugMessage("Item", itemData, itemObjectData)
      // Decode the base64 tokenImg and upload it to the FilePicker
      let base64Response = await fetch(`data:image/webp;base64,${itemData.itemImage.front.image64}`);
      let blob = await base64Response.blob();
      let file = new File([blob], itemData.itemImage.front.filename, { type: "image/webp" });
      await _beneosSafeUpload(finalFolder, file, `item ${itemKey} front`);

      base64Response = await fetch(`data:image/webp;base64,${itemData.itemImage.back.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], itemData.itemImage.back.filename, { type: "image/webp" });
      await _beneosSafeUpload(finalFolder, file, `item ${itemKey} back`);

      itemObjectData.system.description.value = itemObjectData.system.description.value.replaceAll("beneos_assets/beneos_items/", "beneos_assets/cloud/items/")

      base64Response = await fetch(`data:image/webp;base64,${itemData.itemImage.icon.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], itemData.itemImage.icon.filename, { type: "image/webp" });
      await _beneosSafeUpload(finalFolder, file, `item ${itemKey} icon`);
      itemObjectData.img = `${finalFolder}/${itemData.itemImage.icon.filename}`

      // Loop thru itemObjectData.effects and update the img paths
      if (itemObjectData.effects && itemObjectData.effects.length > 0) {
        for (let i = 0; i < itemObjectData.effects.length; i++) {
          let effect = itemObjectData.effects[i]
          effect.img = effect.img.replaceAll("beneos_assets/beneos_items/", "beneos_assets/cloud/items/")
        }
      }

      // F4: the flip-card renderer (item-companion / item-sheet-extender) reads
      // the front/back/icon card paths from flags.beneos-module.loot.render.*Webp.
      // The authored item bakes the LEGACY beneos_assets/beneos_items/ path into
      // those, but the cards are uploaded to beneos_assets/cloud/items/ , so
      // without this rewrite the card <img> 404s on a fresh install (the
      // description/effect/img rewrites above missed these fields).
      const lootRender = foundry.utils.getProperty(itemObjectData, "flags.beneos-module.loot.render")
      if (lootRender && typeof lootRender === "object") {
        for (const k of ["frontCardWebp", "backCardWebp", "iconWebp"]) {
          if (typeof lootRender[k] === "string") {
            lootRender[k] = lootRender[k].replaceAll("beneos_assets/beneos_items/", "beneos_assets/cloud/items/")
          }
        }
      }

      let item = new CONFIG.Item.documentClass(itemObjectData);
      if (item) {
        // Search if we have already an item with the same name in the compendium
        let existingItem = itemRecords.find(a => a.name == item.name && a.img == item.img)
        if (existingItem) {
          BeneosUtility.debugMessage("Deleting existing item", existingItem._id)
          try {
            await Item.deleteDocuments([existingItem._id], { pack: "world.beneos_module_items" })
          }
          catch (err) {
            console.warn("[Beneos Cloud] Error deleting existing item", err)
          }
        }
        // Punkt 1 — Folder-Restruktur: build segment path per item.
        // BeneosDatabaseHolder exposes itemData.content directly (see
        // beneos_search_engine.js:515), no dedicated getItemDatabaseInfo.
        const itemDb = game.beneos.databaseHolder?.itemData?.content?.[itemKey]
        const itemRawBucket = BeneosUtility.getSourceBucket(itemDb, "item", itemKey)
        const itemFolderBucket = BeneosUtility.getFolderBucket(itemRawBucket)
        const itemTypeSlug = item.type || "loot"
        const itemTypeLabel = (() => {
          const raw = CONFIG?.Item?.typeLabels?.[itemTypeSlug] || itemTypeSlug
          const localized = typeof raw === "string" && raw.includes(".") ? game.i18n.localize(raw) : raw
          return (localized || "Item").charAt(0).toUpperCase() + (localized || "Item").slice(1)
        })()
        let itemSegments
        if (itemFolderBucket === "SRD") {
          itemSegments = ["Beneos Loot", "SRD", itemTypeLabel]
        } else {
          let origin = String(itemDb?.properties?.origin || "Misc")
          origin = origin.charAt(0).toUpperCase() + origin.slice(1)
          itemSegments = ["Beneos Loot", "Beneos Originals", origin, itemTypeLabel]
        }
        const itemCompendiumLeaf = await BeneosUtility.ensureBeneosFolderPath(
          { type: "Item", scope: "compendium", pack: "world.beneos_module_items" },
          itemSegments
        )
        // And then create it again
        let imported = await itemPack.importDocument(item, itemCompendiumLeaf?.id ? { folder: itemCompendiumLeaf.id } : undefined);
        // Fix #C3: only mark as installed when import actually succeeded, otherwise
        // the UI showed an "installed" badge for items that never made it to the compendium.
        if (imported?.id) {
          properName = imported.name
          if (itemCompendiumLeaf?.id && imported.folder?.id !== itemCompendiumLeaf.id) {
            try { await imported.update({ folder: itemCompendiumLeaf.id }) }
            catch (err) { BeneosUtility.debugMessage("Folder assign failed (compendium item)", err) }
          }
          await imported.setFlag("world", "beneos", { itemKey, fullId: itemKey, idx: 1, installationDate: tNow, contentSignature: itemData?.contentSignature ?? "" })
          BeneosUtility.beneosItems[itemKey] = {
            itemName: imported.name,
            img: imported.img,
            itemId: imported.id,
            folder: finalFolder,
            itemKey: itemKey,
            fullId: itemKey,
            installDate: tNow,
            contentSignature: itemData?.contentSignature ?? "",
            number: 1
          }
          // World-copy import into the matching world-folder, except if in install *ALL* mode.
          if (!this.noWorldImport) {
            const itemWorldLeaf = await BeneosUtility.ensureBeneosFolderPath(
              { type: "Item", scope: "world" },
              itemSegments
            )
            await game.items.importFromCompendium(itemPack, imported.id, itemWorldLeaf?.id ? { folder: itemWorldLeaf.id } : {});
          }
        } else {
          console.error("BeneosModule: Item import failed for", itemKey)
        }
      }
      const _bnHealthItem = await _beneosValidateInstalledAsset("item", itemKey, itemData?.itemImage)
      await _beneosRepairMissingAspects("item", itemKey, _bnHealthItem)
      if (_bnHealthItem.aspectsMissing.length > 0) {
        this.importErrors.push({ kind: "item", key: itemKey, missing: _bnHealthItem.aspectsMissing })
        _beneosTrackAssetInstallError("item", itemKey, _bnHealthItem)
      }
    }

    let toSave = JSON.stringify(BeneosUtility.beneosItems)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', toSave) // Save the token config !

    if (!isBatch) { // Lock/Unlock only in single install mode
      this.sendChatMessageResult(event, "Item", properName)
      await itemPack.configure({ locked: true })
      try { await _beneosRefreshOpenPackWindows(itemPack) } catch (e) { /* refresh failed */ }
      // Fix #C2: in-place refresh — keeps search engine open, scroll position,
      // and prevents the battlemap notice from re-appearing on every install.
      // Fix #B-5c: itemKey is no longer in scope outside the for-loop above; in
      // single-install mode itemArray has exactly one entry, so the first key
      // is the asset we just installed.
      const installedItemKey = Object.keys(itemArray)[0]
      if (installedItemKey) game.beneos?.cloudWindowV2?.notifyInstallEnded?.(installedItemKey, true)
      // Wave B-9-fix-41: place the installed item on any actor sheet
      // the user dropped it onto while the import was running.
      if (installedItemKey) await this.drainPendingItemDrops(installedItemKey, "item")
    } else {
      this.updateInstalledAssets() // Update the installed assets count
    }
  }

  async importSpellToCompendium(spellArray, event, isBatch = false) {
    // Fix #C5: see importItemToCompendium for rationale.
    if (!isBatch) this.noWorldImport = false
    this.beneosSpells = {}

    // Punkt 1 — Folder-Restruktur: per-spell path is computed inside the loop
    // ("Beneos Spells / [SRD|Beneos Originals] / <School>"). The legacy
    // "Beneos Spells / Level <0..8>" world folder is no longer auto-created.

    let tNow = Date.now()
    let properName

    let spellPack
    if (game.system.id == "pf2e") {
      return this.importGenericPF2Documents(spellArray, "spell")
    } else {
      spellPack = game.packs.get("world.beneos_module_spells")
    }
    if (!spellPack) {
      ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.CompendiumMissing"))
      return
    }
    let spellRecords = await spellPack.getIndex()
    if (!isBatch) { // Lock/Unlock only in single install mode
      await spellPack.configure({ locked: false })
    }

    for (let spellKey in spellArray) {
      let spellData = spellArray[spellKey]
      // Get the common actor data
      let spellObjectData = spellData.spellJSON
      let finalFolder = `beneos_assets/cloud/spells/${spellKey}`
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets");
      } catch (err) {
        BeneosUtility.debugMessage("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud");
      } catch (err) {
        BeneosUtility.debugMessage("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud/spells");
      } catch (err) {
        BeneosUtility.debugMessage("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", finalFolder);
      } catch (err) {
        BeneosUtility.debugMessage("Directory already exists")
      }
      BeneosUtility.debugMessage("Spell", spellData, spellObjectData)
      // Decode the base64 tokenImg and upload it to the FilePicker
      let base64Response = await fetch(`data:image/webp;base64,${spellData.spellImage.front.image64}`);
      let blob = await base64Response.blob();
      let file = new File([blob], spellData.spellImage.front.filename, { type: "image/webp" });
      await _beneosSafeUpload(finalFolder, file, `spell ${spellKey} front`);

      base64Response = await fetch(`data:image/webp;base64,${spellData.spellImage.back.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], spellData.spellImage.back.filename, { type: "image/webp" });
      await _beneosSafeUpload(finalFolder, file, `spell ${spellKey} back`);

      spellObjectData.system.description.value = spellObjectData.system.description.value.replaceAll("beneos_assets/beneos_spells/", "beneos_assets/cloud/spells/")

      base64Response = await fetch(`data:image/webp;base64,${spellData.spellImage.icon.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], spellData.spellImage.icon.filename, { type: "image/webp" });
      await _beneosSafeUpload(finalFolder, file, `spell ${spellKey} icon`);
      spellObjectData.img = `${finalFolder}/${spellData.spellImage.icon.filename}`

      // Loop thru spellObjectData.effects and update the img paths
      if (spellObjectData.effects && spellObjectData.effects.length > 0) {
        for (let i = 0; i < spellObjectData.effects.length; i++) {
          let effect = spellObjectData.effects[i]
          effect.img = effect.img.replaceAll("beneos_assets/beneos_spells/", "beneos_assets/cloud/spells/")
        }
      }

      // Fix M8.3.39: the cloud spellJSON occasionally ships an empty/wrong
      // system.school (e.g. Message/Prestidigitation), which leaves the
      // installed spell "school not configured" and falling back to the
      // wrong (evocation) school. The authoritative school lives in the
      // Beneos spell DB; map its word to the dnd5e code and write it onto
      // the object BEFORE the Item is created. Unknown words are left as-is.
      try {
        const dbSchoolWord = String(game.beneos.databaseHolder?.spellData?.content?.[spellKey]?.properties?.school || "").trim().toLowerCase()
        const DND5E_SCHOOL_CODE = { abjuration: "abj", conjuration: "con", divination: "div", enchantment: "enc", evocation: "evo", illusion: "ill", necromancy: "nec", transmutation: "trs" }
        const code = DND5E_SCHOOL_CODE[dbSchoolWord]
        if (code) {
          spellObjectData.system = spellObjectData.system || {}
          spellObjectData.system.school = code
        }
      } catch (e) { /* never block import on school mapping */ }

      let spell = new CONFIG.Item.documentClass(spellObjectData);
      if (spell) {
        // Search if we have already an actor with the same name in the compendium
        let existingSpell = spellRecords.find(a => a.name == spell.name && a.img == spell.img)
        if (existingSpell) {
          BeneosUtility.debugMessage("Deleting existing spell", existingSpell._id)
          await Item.deleteDocuments([existingSpell._id], { pack: "world.beneos_module_spells" })
        }
        // Punkt 1 — Folder-Restruktur: build segment path per spell
        // ("Beneos Spells / [SRD|Beneos Originals] / <School>"). School is
        // taken from the cloud DB; spell objects also expose it via
        // imported.system.school after import as a fallback.
        const spellDb = game.beneos.databaseHolder?.spellData?.content?.[spellKey]
        const spellRawBucket = BeneosUtility.getSourceBucket(spellDb, "spell", spellKey)
        const spellFolderBucket = BeneosUtility.getFolderBucket(spellRawBucket)
        let school = String(spellDb?.properties?.school || spell.system?.school || "Misc")
        school = school.charAt(0).toUpperCase() + school.slice(1)
        const spellSegments = ["Beneos Spells", spellFolderBucket, school]
        const spellCompendiumLeaf = await BeneosUtility.ensureBeneosFolderPath(
          { type: "Item", scope: "compendium", pack: "world.beneos_module_spells" },
          spellSegments
        )
        // And then create it again
        let imported = await spellPack.importDocument(spell, spellCompendiumLeaf?.id ? { folder: spellCompendiumLeaf.id } : undefined);
        // Fix #C3: only mark as installed when import actually succeeded.
        if (imported?.id) {
          properName = imported.name
          if (spellCompendiumLeaf?.id && imported.folder?.id !== spellCompendiumLeaf.id) {
            try { await imported.update({ folder: spellCompendiumLeaf.id }) }
            catch (err) { BeneosUtility.debugMessage("Folder assign failed (compendium spell)", err) }
          }
          await imported.setFlag("world", "beneos", { spellKey, fullId: spellKey, idx: 1, installationDate: tNow, contentSignature: spellData?.contentSignature ?? "" })
          BeneosUtility.beneosSpells[spellKey] = {
            itemName: imported.name,
            img: imported.img,
            spellId: imported.id,
            folder: finalFolder,
            spellKey: spellKey,
            fullId: spellKey,
            installDate: tNow,
            contentSignature: spellData?.contentSignature ?? "",
            number: 1
          }
          // World-copy import into the matching world-folder, except if in install *ALL* mode.
          if (!this.noWorldImport) {
            const spellWorldLeaf = await BeneosUtility.ensureBeneosFolderPath(
              { type: "Item", scope: "world" },
              spellSegments
            )
            await game.items.importFromCompendium(spellPack, imported.id, spellWorldLeaf?.id ? { folder: spellWorldLeaf.id } : {});
          }
        } else {
          console.error("BeneosModule: Spell import failed for", spellKey)
        }
      }
      const _bnHealthSpell = await _beneosValidateInstalledAsset("spell", spellKey, spellData?.spellImage)
      await _beneosRepairMissingAspects("spell", spellKey, _bnHealthSpell)
      if (_bnHealthSpell.aspectsMissing.length > 0) {
        this.importErrors.push({ kind: "spell", key: spellKey, missing: _bnHealthSpell.aspectsMissing })
        _beneosTrackAssetInstallError("spell", spellKey, _bnHealthSpell)
      }
    }
    let toSave = JSON.stringify(BeneosUtility.beneosSpells)
    BeneosUtility.debugMessage("Saving SPELL data :", toSave)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-spellconfig', toSave) // Save the token config !

    if (!isBatch) { // Lock/Unlock only in single install mode
      this.sendChatMessageResult(event, "Spell", properName)
      await spellPack.configure({ locked: true })
      try { await _beneosRefreshOpenPackWindows(spellPack) } catch (e) { /* refresh failed */ }
      // Fix #C2: see importItemToCompendium for rationale.
      // Fix #B-5c: spellKey is not in scope outside the for-loop above; pull
      // the just-installed key from spellArray (single-install: one entry).
      const installedSpellKey = Object.keys(spellArray)[0]
      if (installedSpellKey) game.beneos?.cloudWindowV2?.notifyInstallEnded?.(installedSpellKey, true)
      // Wave B-9-fix-41: place the installed spell on any actor sheet
      // the user dropped it onto while the import was running.
      if (installedSpellKey) await this.drainPendingItemDrops(installedSpellKey, "spell")
    } else {
      this.updateInstalledAssets() // Update the installed assets count
    }
  }

  async addTokenToWorldFromCompendium(tokenKey) {
    let actorPack = BeneosUtility.getActorPack()
    if (!actorPack) {
      ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.CompendiumMissing"))
      return
    }
    let actorRecords = await actorPack.getIndex()
    let actorId = BeneosUtility.getActorId(tokenKey)
    if (!actorId) {
      ui.notifications.error(game.i18n.format("BENEOS.Cloud.Notification.TokenLookupFailed", { key: tokenKey }))
      return
    }
    let existingActor = actorRecords.find(a => a._id == actorId)
    if (existingActor) {
      let imported = await actorPack.getDocument(existingActor._id)
      if (imported) {
        // Punkt 1 — Folder-Restruktur: world-side path
        // "Beneos Creatures / [SRD|Beneos Originals] / <Type> / CR <X>".
        const tokenDb = game.beneos.databaseHolder.getTokenDatabaseInfo(tokenKey)
        const rawBucket = BeneosUtility.getSourceBucket(tokenDb, "token", tokenKey)
        const folderBucket = BeneosUtility.getFolderBucket(rawBucket)
        let creatureType = tokenDb?.properties?.type?.[0] ?? "Unknown"
        creatureType = creatureType.charAt(0).toUpperCase() + creatureType.slice(1)
        const crFolder = BeneosUtility.formatCrFolder(tokenDb?.properties?.cr)
        const worldLeaf = await BeneosUtility.ensureBeneosFolderPath(
          { type: "Actor", scope: "world" },
          ["Beneos Creatures", folderBucket, creatureType, crFolder]
        )
        await game.actors.importFromCompendium(actorPack, imported.id, worldLeaf?.id ? { folder: worldLeaf.id } : {});
      } else {
        ui.notifications.error(game.i18n.format("BENEOS.Cloud.Notification.TokenLookupFailed", { key: tokenKey }))
      }
    } else {
      ui.notifications.error(game.i18n.format("BENEOS.Cloud.Notification.TokenLookupFailed", { key: tokenKey }))
    }
  }

  /**
   * Propagate a compendium creature update to existing world actors and
   * the scene tokens that point at them. Called from importTokenToCompendium
   * when a re-install detects pre-existing world actors carrying the same
   * fullId flag.
   *
   * Protection rules (per user direction "nur wenn original liegen"):
   *   - World actors whose name matches the recorded originalName flag get
   *     a full-replace from the new compendium document.
   *   - World actors the DM has renamed are left untouched.
   *   - Scene tokens whose name still matches the originalName get their
   *     visuals (texture, name) refreshed; renamed scene tokens are skipped.
   *   - Exception: a token the creature drawer renamed itself when it took an
   *     SRD's slot (flag beneos-module.replacedName, still equal to the current
   *     name). That name belongs to the adventure, not to the GM, so the token
   *     is refreshed like any other but keeps its name. Without the exception
   *     every 1:1 replacement would fall out of the refresh below, and with it
   *     out of the item/effect renewal that only runs for matched tokens.
   *
   * Lazy migration: actors installed before originalName was tracked have
   * no flag yet — for those we treat the current compendium name as the
   * baseline (best-effort; if the DM had already renamed pre-feature, we
   * cannot tell, but those will simply not match and stay untouched).
   *
   * Counts are surfaced in a DialogV2 so the GM has a chance to abort
   * before the cascade runs.
   */
  async _propagateTokenUpdateToWorld(fullId, imported, existingWorldActors, options = {}) {
    const compendiumName = imported.name
    const updatable = []
    const skippedRenamed = []
    for (const actor of existingWorldActors) {
      const flag = actor.getFlag("world", "beneos") || {}
      const baseline = flag.originalName ?? compendiumName
      if (actor.name === baseline) updatable.push(actor)
      else skippedRenamed.push(actor)
    }

    // Collect scene-token updates. Unlinked Beneos tokens carry their own
    // texture override per scene, so an Actor-side update does NOT reach
    // them automatically — we have to push per-token updates per scene.
    //
    // Two match strategies, in order:
    //   1) TokenDocument.actorId === world actor id (the standard drop
    //      pipeline registers this directly).
    //   2) Synthetic-actor beneos flag fullId matches — fallback for
    //      tokens whose actorId resolution didn't catch (cloud-drag
    //      edge cases, legacy installs, etc.).
    //
    // Visual feedback while we scan: setting body cursor to "wait" plus
    // a heads-up notification on multi-scene worlds. The DM is rarely
    // sitting on the scene that holds the affected tokens, so the scan
    // routinely runs against scenes that aren't currently rendered.
    const allScenes = [...(game.scenes ?? [])]
    if (allScenes.length > 1) {
      ui.notifications.info(game.i18n.format(
        "BENEOS.Cloud.Update.SearchingScenes",
        { count: allScenes.length }
      ))
    }
    const prevCursorSearch = document.body.style.cursor
    document.body.style.cursor = "wait"
    const sceneUpdates = []
    let scannedTokens = 0
    let matchedTokens = 0
    try {
      for (const scene of allScenes) {
        const tokenUpdates = []
        for (const token of scene.tokens) {
          scannedTokens++
          let actor = updatable.find(a => a.id === token.actorId)
          if (!actor) {
            const tokenActor = token.actor
            const tokenFlag = tokenActor?.getFlag?.("world", "beneos")
            if (tokenFlag?.fullId === fullId) actor = updatable[0]
          }
          if (!actor) continue
          const flag = actor.getFlag("world", "beneos") || {}
          const baseline = flag.originalName ?? compendiumName
          // The drawer stamps replacedName when it puts this creature into an
          // SRD's slot. Equal to the current name means we set it, so refresh
          // the token but leave the adventure's name alone. Any other deviation
          // is the GM's own renaming and stays untouched.
          const ownRename = token.getFlag?.(BeneosUtility.moduleID(), "replacedName")
          const isOwnRename = !!ownRename && ownRename === token.name
          if (token.name !== baseline && !isOwnRename) continue
          const tokenUpdate = {
            _id: token.id,
            "texture.src": imported.prototypeToken.texture.src
          }
          if (!isOwnRename) tokenUpdate.name = compendiumName
          tokenUpdates.push(tokenUpdate)
          matchedTokens++
        }
        if (tokenUpdates.length) {
          BeneosUtility.debugMessage(`[Beneos Cloud] Scene "${scene.name}": ${tokenUpdates.length} matching token(s)`)
          sceneUpdates.push({ scene, updates: tokenUpdates })
        }
      }
    } finally {
      document.body.style.cursor = prevCursorSearch
    }
    BeneosUtility.debugMessage(`[Beneos Cloud] Scene scan complete — scanned ${scannedTokens} token(s), matched ${matchedTokens} for fullId=${fullId}`)
    const totalSceneTokens = sceneUpdates.reduce((n, s) => n + s.updates.length, 0)

    if (updatable.length === 0) {
      ui.notifications.info(game.i18n.localize("BENEOS.Cloud.Update.NothingToDo"))
      return
    }

    // Confirmation dialog with full context — asset name + type so the
    // GM can identify the affected creature at a glance (matters when a
    // bulk-install run pauses on the first asset that has world actors;
    // without the name + type the prompt feels generic). The scene
    // breakdown lists every place the asset is currently in use, so the
    // GM can make an informed call before mass-updating tokens that may
    // already be mid-session. Skipped entirely if the GM previously
    // chose "Yes, don't ask again this session".
    if (!this._skipUpdateConfirmation) {
      const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[c]))

      // Asset type label — driven by the imported document so future
      // extensions to items / spells slot in without changing the helper
      // signature. _propagateTokenUpdateToWorld currently only runs for
      // creatures, but the i18n keys are pre-staged for the rest.
      let assetTypeLabel = game.i18n.localize("BENEOS.Cloud.Update.AssetCreature")
      if (imported?.documentName === "Item") {
        const isSpell = imported?.type === "spell"
        assetTypeLabel = game.i18n.localize(isSpell
          ? "BENEOS.Cloud.Update.AssetSpell"
          : "BENEOS.Cloud.Update.AssetLoot")
      }

      const escapedName = escapeHTML(compendiumName)
      const escapedType = escapeHTML(assetTypeLabel)

      const sceneListItems = sceneUpdates.map(s => {
        const text = game.i18n.format("BENEOS.Cloud.Update.SceneEntry", {
          scene: s.scene.name ?? "",
          count: s.updates.length
        })
        return `<li>${escapeHTML(text)}</li>`
      }).join("")
      const sceneListHtml = sceneUpdates.length
        ? `<ul class="bc-update-scene-list">${sceneListItems}</ul>`
        : `<p class="bc-update-no-scenes">${escapeHTML(game.i18n.localize("BENEOS.Cloud.Update.NoSceneTokens"))}</p>`

      const renamedLine = skippedRenamed.length
        ? `<p class="bc-update-skipped-note">${escapeHTML(game.i18n.format("BENEOS.Cloud.Update.SkippedRenamedDetail", { count: skippedRenamed.length }))}</p>`
        : ""

      const introKey = updatable.length === 1
        ? "BENEOS.Cloud.Update.IntroDetail"
        : "BENEOS.Cloud.Update.IntroDetailPlural"
      const introText = game.i18n.format(introKey, { actorCount: updatable.length, name: compendiumName })

      const content = `
        <div class="bc-update-dialog">
          <div class="bc-update-asset-header">
            <span class="bc-update-asset-type">${escapedType}</span>
            <span class="bc-update-asset-name">${escapedName}</span>
          </div>
          <p class="bc-update-intro">${escapeHTML(introText)}</p>
          <p class="bc-update-scenes-heading">${escapeHTML(game.i18n.localize("BENEOS.Cloud.Update.UsedOn"))}</p>
          ${sceneListHtml}
          ${renamedLine}
          <p class="bc-update-question">${escapeHTML(game.i18n.localize("BENEOS.Cloud.Update.QuestionDetail"))}</p>
        </div>
      `

      let dialogResult
      try {
        dialogResult = await foundry.applications.api.DialogV2.wait({
          window: { title: game.i18n.localize("BENEOS.Cloud.Update.Title") },
          classes: ["dialog", "app", "window-app", "beneos-cloud-app", "beneos-confirm"],
          position: { width: 560 },
          content,
          buttons: [
            { action: "yes",        label: game.i18n.localize("BENEOS.Cloud.Update.Yes"),        default: true, callback: () => "yes"        },
            { action: "yesAlways",  label: game.i18n.localize("BENEOS.Cloud.Update.YesAlways"),                 callback: () => "yesAlways"  },
            { action: "installNew", label: game.i18n.localize("BENEOS.Cloud.Update.InstallNew"),                callback: () => "installNew" },
            { action: "reset",      label: game.i18n.localize("BENEOS.Cloud.Update.Reset"),                     callback: () => "reset"      },
            { action: "no",         label: game.i18n.localize("BENEOS.Cloud.Update.No"),                        callback: () => "no"         }
          ],
          rejectClose: false
        })
      } catch (err) {
        console.warn("[Beneos Cloud] Update-confirm dialog failed", err)
        dialogResult = "no"
      }
      if (!dialogResult || dialogResult === "no") return
      if (dialogResult === "installNew") {
        await this._installAsNewCopy(fullId, imported, options)
        return
      }
      if (dialogResult === "reset") {
        await this._resetAndReinstall(fullId, imported, existingWorldActors, sceneUpdates, options)
        return
      }
      if (dialogResult === "yesAlways") this._skipUpdateConfirmation = true
    }

    // Apply phase — visual feedback again because the actor + token CRUD
    // pass can take a noticeable moment on big worlds.
    if (sceneUpdates.length > 0 || updatable.length > 1) {
      ui.notifications.info(game.i18n.format(
        "BENEOS.Cloud.Update.ApplyingUpdate",
        { actors: updatable.length, tokens: totalSceneTokens }
      ))
    }
    const prevCursorApply = document.body.style.cursor
    document.body.style.cursor = "wait"

    // Full-replace each world actor with the compendium copy. Strip the
    // compendium _id so we don't collide with the existing actor's id; we
    // also drop folder so the world copy stays in its current sub-folder,
    // and we strip the embedded collections (items / effects) because
    // Actor.update() does NOT replace embedded collections — those must
    // be wiped and re-created explicitly, otherwise removed items don't
    // come back and renamed/changed items aren't refreshed.
    const newData = imported.toObject()
    delete newData._id
    delete newData.folder
    delete newData.items
    delete newData.effects
    const newItemsData   = imported.items.map(i => i.toObject())
    const newEffectsData = imported.effects.map(e => e.toObject())
    for (const actor of updatable) {
      const beneosFlag = actor.getFlag("world", "beneos") || {}
      try {
        // 1) Top-level properties (system, name, img, prototypeToken, ...)
        await actor.update(newData)
        // 2) Items: full replace. Wipe any DM edits, restore the canonical set.
        const oldItemIds = actor.items.map(i => i.id)
        if (oldItemIds.length) {
          await actor.deleteEmbeddedDocuments("Item", oldItemIds)
        }
        if (newItemsData.length) {
          await actor.createEmbeddedDocuments("Item", newItemsData, { keepId: true })
        }
        // 3) Active effects: full replace, same reasoning.
        const oldEffectIds = actor.effects.map(e => e.id)
        if (oldEffectIds.length) {
          await actor.deleteEmbeddedDocuments("ActiveEffect", oldEffectIds)
        }
        if (newEffectsData.length) {
          await actor.createEmbeddedDocuments("ActiveEffect", newEffectsData, { keepId: true })
        }
        // 4) Re-stamp the beneos flag (newData.flags from the compendium
        //    may have overwritten it during step 1).
        // Stage 13a: rendering-Merge mit User-Override-Priorität. Der
        // user-gesetzte rendering-Block (z.B. lokal im Foundry via
        // Console oder Stage-13d-Creator-UI) hat Priorität über Cloud-
        // Defaults. Cloud füllt nur null/missing-Felder. Per-Field-
        // Merge, damit auch teilweise gesetzte Overrides respektiert
        // werden (z.B. nur topDownScale gesetzt, tokenizedScale aus
        // Cloud).
        //
        // Der Merge laeuft ueber ALLE Felder, nicht mehr ueber eine feste
        // Liste. Die alte Whitelist kannte nur topDownScale,
        // tokenizedScale, fx und fxEnabled. Jedes Cloud-Update loeschte
        // damit still die Anchor-Werte, die variants-Map mit den
        // Scale- und Anchor-Werten je Variante und die modusabhaengigen
        // FX-Listen fxTokenized und fxTopdown. Genau die Felder also, aus
        // denen Top-Down seine individuellen Werte und die Kreaturen ihre
        // Effekte beziehen.
        const existingRendering = beneosFlag.rendering || {}
        const cloudRendering = newData?.flags?.world?.beneos?.rendering || {}
        const mergedRendering = { ...cloudRendering }
        for (const [key, value] of Object.entries(existingRendering)) {
          // User-Override gewinnt, aber nur wenn er wirklich etwas aussagt:
          // null, undefined und leere Listen duerfen den Cloud-Wert nicht
          // verdraengen.
          if (value === null || value === undefined) continue
          if (Array.isArray(value) && value.length === 0) continue
          mergedRendering[key] = value
        }
        if (mergedRendering.fxEnabled === undefined) mergedRendering.fxEnabled = true
        // Stage 13a-Polish: backfill isBeneosCreature on every cloud-
        // update — Pre-Polish-Tokens (no explicit marker yet) get the
        // flag set silently the next time the cloud ships a refresh.
        await actor.setFlag("world", "beneos", {
          ...beneosFlag,
          originalName: compendiumName,
          updateDate: Date.now(),
          isBeneosCreature: true,
          rendering: mergedRendering
        })
      } catch (err) {
        console.warn("[Beneos Cloud] World actor update failed for", actor.name, err)
      }
    }

    // Apply per-scene token updates. Two passes per scene:
    //
    //   1) TokenDocument-level updates (texture.src, name) so the canvas
    //      shows the new image and label.
    //   2) Embedded-collection refresh on each token's synthetic actor.
    //      Beneos tokens are unlinked (actorLink: false) — each token
    //      carries its own ActorDelta that overrides the world actor's
    //      data. If the GM had deleted items/actions from the token's
    //      sheet (which writes to the delta, NOT the world actor), step 1
    //      would leave those deletions in place; the token would still
    //      render the stale, DM-modified item set even though the world
    //      actor is now fresh. Wiping + recreating items/effects on the
    //      synthetic actor routes through the delta and brings the token
    //      back in line with the new compendium data.
    for (const { scene, updates } of sceneUpdates) {
      try { await scene.updateEmbeddedDocuments("Token", updates) }
      catch (err) { console.warn("[Beneos Cloud] Scene-token document update failed for", scene.name, err) }
      for (const u of updates) {
        const token = scene.tokens.get(u._id)
        const tokenActor = token?.actor
        if (!tokenActor) continue
        try {
          const oldItemIds = tokenActor.items.map(i => i.id)
          if (oldItemIds.length) {
            await tokenActor.deleteEmbeddedDocuments("Item", oldItemIds)
          }
          if (newItemsData.length) {
            await tokenActor.createEmbeddedDocuments("Item", newItemsData, { keepId: true })
          }
          const oldEffectIds = tokenActor.effects.map(e => e.id)
          if (oldEffectIds.length) {
            await tokenActor.deleteEmbeddedDocuments("ActiveEffect", oldEffectIds)
          }
          if (newEffectsData.length) {
            await tokenActor.createEmbeddedDocuments("ActiveEffect", newEffectsData, { keepId: true })
          }
        } catch (err) {
          console.warn("[Beneos Cloud] Scene-token actor refresh failed for", token?.name, err)
        }
      }
    }

    document.body.style.cursor = prevCursorApply
    ui.notifications.info(game.i18n.format("BENEOS.Cloud.Update.Done", {
      actors: updatable.length,
      tokens: totalSceneTokens,
      skipped: skippedRenamed.length
    }))
  }

  /**
   * Imports an additional world copy of the compendium actor without
   * touching any existing copies. Triggered by the "Install as new copy
   * alongside" option in the update dialog. Adds a "(new copy)" suffix
   * to the name so the GM can distinguish the freshly imported version
   * from any pre-existing one(s).
   */
  async _installAsNewCopy(fullId, imported, options = {}) {
    const { actorPack, beneosSegments, tokenKey, contentSignature, cloudRenderingFlag } = options
    if (!actorPack) {
      console.warn("[Beneos Cloud] _installAsNewCopy missing actorPack — abort")
      return
    }
    const existingCount = game.actors.filter(a =>
      a.getFlag("world", "beneos")?.fullId === fullId
    ).length
    const worldLeaf = beneosSegments
      ? await BeneosUtility.ensureBeneosFolderPath({ type: "Actor", scope: "world" }, beneosSegments)
      : null
    let additionalCopy
    try {
      additionalCopy = await game.actors.importFromCompendium(
        actorPack, imported.id,
        worldLeaf?.id ? { folder: worldLeaf.id } : {}
      )
    } catch (err) {
      console.error("[Beneos Cloud] _installAsNewCopy importFromCompendium failed", err)
      ui.notifications?.error?.(`Beneos: import of new copy failed (${err?.message || "unknown"})`)
      return
    }
    if (!additionalCopy) {
      ui.notifications?.error?.("Beneos: import of new copy returned no actor")
      return
    }
    try {
      await additionalCopy.update({ name: `${imported.name} (new copy)` })
    } catch (err) {
      console.warn("[Beneos Cloud] _installAsNewCopy rename failed", err)
    }
    try {
      await additionalCopy.setFlag("world", "beneos", {
        tokenKey, fullId, idx: 0,
        originalName: imported.name,
        installationDate: Date.now(),
        isBeneosCreature: true,
        rendering: cloudRenderingFlag || {},
        contentSignature: contentSignature || ""
      })
    } catch (err) {
      console.warn("[Beneos Cloud] _installAsNewCopy setFlag failed", err)
    }
    ui.notifications?.info?.(game.i18n.format("BENEOS.Cloud.Update.InstallNewDone", {
      name: imported.name,
      existing: existingCount
    }))
  }

  /**
   * Destructive reset: deletes all existing world copies of the asset
   * (plus their scene tokens), then imports a clean fresh copy from the
   * just-updated compendium entry. Triggered by the "Delete existing and
   * reinstall fresh" option in the update dialog. A compact confirmation
   * dialog (count-only, no scene list per user preference) gates the
   * destructive step.
   */
  async _resetAndReinstall(fullId, imported, existingWorldActors, sceneUpdates, options = {}) {
    const { actorPack, beneosSegments, tokenKey, contentSignature, cloudRenderingFlag } = options
    const totalSceneTokens = (sceneUpdates || []).reduce((n, s) => n + s.updates.length, 0)

    // Compact confirmation — count only, no scene list.
    let confirmResult
    try {
      confirmResult = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("BENEOS.Cloud.Update.Reset") },
        classes: ["dialog", "app", "window-app", "beneos-cloud-app", "beneos-confirm"],
        content: `<p>${game.i18n.format("BENEOS.Cloud.Update.ResetConfirm", {
          actors: existingWorldActors.length,
          tokens: totalSceneTokens,
          name: imported.name
        })}</p>`,
        buttons: [
          { action: "yes", label: game.i18n.localize("BENEOS.Cloud.Update.Reset"), default: true, callback: () => "yes" },
          { action: "no",  label: game.i18n.localize("BENEOS.Cloud.Update.No"),                      callback: () => "no"  }
        ],
        rejectClose: false
      })
    } catch (err) {
      console.warn("[Beneos Cloud] _resetAndReinstall confirm dialog failed", err)
      confirmResult = "no"
    }
    if (confirmResult !== "yes") return

    // 1) Delete scene tokens that reference any of the existing world actors.
    for (const sceneUpdate of (sceneUpdates || [])) {
      const tokenIds = sceneUpdate.updates.map(u => u._id)
      if (!tokenIds.length) continue
      try {
        await sceneUpdate.scene.deleteEmbeddedDocuments("Token", tokenIds)
      } catch (err) {
        console.warn(`[Beneos Cloud] _resetAndReinstall: scene-token delete failed on "${sceneUpdate.scene.name}"`, err)
      }
    }

    // 2) Delete existing world actors.
    const worldActorIds = existingWorldActors.map(a => a.id)
    if (worldActorIds.length) {
      try {
        await Actor.deleteDocuments(worldActorIds)
      } catch (err) {
        console.warn("[Beneos Cloud] _resetAndReinstall: world-actor delete failed", err)
      }
    }

    // 3) Fresh import from the just-updated compendium entry.
    if (!actorPack) {
      console.warn("[Beneos Cloud] _resetAndReinstall missing actorPack — fresh import skipped")
      ui.notifications?.warn?.("Beneos: existing copies removed, but fresh import skipped (missing pack reference). Please install again from the Cloud Search Engine.")
      return
    }
    const worldLeaf = beneosSegments
      ? await BeneosUtility.ensureBeneosFolderPath({ type: "Actor", scope: "world" }, beneosSegments)
      : null
    let freshCopy
    try {
      freshCopy = await game.actors.importFromCompendium(
        actorPack, imported.id,
        worldLeaf?.id ? { folder: worldLeaf.id } : {}
      )
    } catch (err) {
      console.error("[Beneos Cloud] _resetAndReinstall fresh import failed", err)
      ui.notifications?.error?.(`Beneos: fresh import failed (${err?.message || "unknown"})`)
      return
    }
    if (freshCopy) {
      try {
        await freshCopy.setFlag("world", "beneos", {
          tokenKey, fullId, idx: 0,
          originalName: imported.name,
          installationDate: Date.now(),
          isBeneosCreature: true,
          rendering: cloudRenderingFlag || {},
          contentSignature: contentSignature || ""
        })
      } catch (err) {
        console.warn("[Beneos Cloud] _resetAndReinstall setFlag failed", err)
      }
    }
    ui.notifications?.info?.(game.i18n.format("BENEOS.Cloud.Update.ResetDone", {
      actors: existingWorldActors.length,
      tokens: totalSceneTokens,
      name: imported.name
    }))
  }

  /**
   * Maintenance flow: scans the Beneos compendiums for orphan entries
   * and lets the GM review + delete them in one dialog. Orphan = any of:
   *   (1) entry without a folder assignment (sits in the pack root)
   *   (2) entry whose local asset files are missing from disk
   *   (3) entry without a matching world actor (no game.actors copy with
   *       a flag.world.beneos.fullId === entry.flag.fullId)
   * Triggered from the Foundry Settings menu via BeneosOrphanCleanupMenu.
   */
  async runOrphanCleanup() {
    ui.notifications?.info?.(game.i18n.localize("BENEOS.Cleanup.Scanning"))
    const actorPack = BeneosUtility.getActorPack()
    if (!actorPack) {
      ui.notifications?.error?.(game.i18n.localize("BENEOS.Cloud.Notification.CompendiumMissing"))
      return
    }
    // Need full documents (not just the index) so we can read flags +
    // prototypeToken.texture.src. The pack is small (one entry per
    // Beneos creature) so loading all of them is fine.
    const allDocs = await actorPack.getDocuments()

    // Build a quick set of fullIds known to the world (for orphan-check (3)).
    const worldFullIds = new Set()
    for (const a of game.actors) {
      const fid = a.getFlag("world", "beneos")?.fullId
      if (fid) worldFullIds.add(fid)
    }

    // Probe local files in parallel and collect results. Each entry gets
    // an issues array with the failing categories.
    const probeResults = await Promise.all(allDocs.map(async (doc) => {
      const issues = []
      // Foundry resolves `doc.folder` to a Folder document, returning null
      // if the reference no longer exists in the pack — but the raw source
      // still carries the old folder id. That mismatch is the signature of
      // a stale folder link: entries that visually disappear from the
      // compendium-window because they're filed under a deleted folder.
      const rawFolderId = doc._source?.folder ?? null
      const resolvedFolder = doc.folder
      if (rawFolderId && !actorPack.folders.get(rawFolderId)) {
        issues.push("stale_folder")
      } else if (!resolvedFolder) {
        issues.push("no_folder")
      }
      // (2) local files: HEAD-probe the prototypeToken texture path
      const protoSrc = doc.prototypeToken?.texture?.src || ""
      if (protoSrc) {
        try {
          const url = protoSrc.startsWith("/") ? protoSrc : `/${protoSrc}`
          const res = await fetch(url, { method: "HEAD" })
          if (!res.ok) issues.push("missing_files")
        } catch (e) { issues.push("missing_files") }
      } else {
        issues.push("missing_files")
      }
      // (3) no world copy
      const fid = doc.getFlag("world", "beneos")?.fullId
      if (fid && !worldFullIds.has(fid)) issues.push("no_world_copy")
      return { doc, issues, rawFolderId }
    }))

    const orphans = probeResults.filter(r => r.issues.length > 0)
    if (!orphans.length) {
      ui.notifications?.info?.(game.i18n.localize("BENEOS.Cleanup.NoOrphans"))
      return
    }

    const labelNoFolder    = game.i18n.localize("BENEOS.Cleanup.IssueNoFolder")
    const labelMissingFiles = game.i18n.localize("BENEOS.Cleanup.IssueMissingFiles")
    const labelNoWorldCopy = game.i18n.localize("BENEOS.Cleanup.IssueNoWorldCopy")
    const labelStaleFolder = game.i18n.localize("BENEOS.Cleanup.IssueStaleFolder")
    const issueLabel = (issue) => {
      if (issue === "no_folder")     return labelNoFolder
      if (issue === "missing_files") return labelMissingFiles
      if (issue === "no_world_copy") return labelNoWorldCopy
      if (issue === "stale_folder")  return labelStaleFolder
      return issue
    }
    const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]))

    const intro = game.i18n.format("BENEOS.Cleanup.Intro", { count: orphans.length })
    const rows = orphans.map((r, idx) => {
      const issueText = r.issues.map(issueLabel).join(", ")
      return `<tr>
        <td><input type="checkbox" class="bc-orphan-cb" data-idx="${idx}" checked /></td>
        <td>${escapeHTML(r.doc.name || "(unnamed)")}</td>
        <td><em>${escapeHTML(issueText)}</em></td>
      </tr>`
    }).join("")

    const content = `
      <div class="bc-cleanup-dialog">
        <p>${escapeHTML(intro)}</p>
        <p>
          <button type="button" class="bc-orphan-select-all">${escapeHTML(game.i18n.localize("BENEOS.Cleanup.SelectAll"))}</button>
          <button type="button" class="bc-orphan-deselect-all">${escapeHTML(game.i18n.localize("BENEOS.Cleanup.DeselectAll"))}</button>
        </p>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr><th style="width:32px;"></th><th>Name</th><th>Issues</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `

    let dialogResult = null
    try {
      dialogResult = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("BENEOS.Cleanup.Title") },
        classes: ["dialog", "app", "window-app", "beneos-cloud-app"],
        position: { width: 640, height: "auto" },
        content,
        buttons: [
          { action: "delete", label: game.i18n.localize("BENEOS.Cleanup.DeleteSelected"), default: true,
            callback: (event, button, dialog) => {
              const root = dialog.element ?? dialog
              const indices = Array.from(root.querySelectorAll(".bc-orphan-cb"))
                .filter(cb => cb.checked)
                .map(cb => parseInt(cb.dataset.idx, 10))
                .filter(n => Number.isFinite(n))
              return { action: "delete", indices }
            }
          },
          { action: "relink", label: game.i18n.localize("BENEOS.Cleanup.RelinkSelected"),
            callback: (event, button, dialog) => {
              const root = dialog.element ?? dialog
              const indices = Array.from(root.querySelectorAll(".bc-orphan-cb"))
                .filter(cb => cb.checked)
                .map(cb => parseInt(cb.dataset.idx, 10))
                .filter(n => Number.isFinite(n))
              return { action: "relink", indices }
            }
          },
          { action: "cancel", label: game.i18n.localize("BENEOS.Cleanup.Cancel"), callback: () => ({ action: "cancel" }) }
        ],
        render: (event, dialog) => {
          const root = dialog?.element ?? dialog
          root.querySelector(".bc-orphan-select-all")?.addEventListener("click", () => {
            root.querySelectorAll(".bc-orphan-cb").forEach(cb => cb.checked = true)
          })
          root.querySelector(".bc-orphan-deselect-all")?.addEventListener("click", () => {
            root.querySelectorAll(".bc-orphan-cb").forEach(cb => cb.checked = false)
          })
        },
        rejectClose: false
      })
    } catch (err) {
      console.warn("[Beneos Cloud] OrphanCleanup dialog failed", err)
      return
    }

    if (!dialogResult || (dialogResult.action !== "delete" && dialogResult.action !== "relink")) return
    const selectedIndices = Array.isArray(dialogResult.indices) ? dialogResult.indices : []
    if (!selectedIndices.length) return

    const packName = actorPack.collection || actorPack.metadata?.id || "world.beneos_module_actors"
    const wasLocked = actorPack.locked

    // Relink branch: instead of deleting, we set folder=null on the
    // selected entries. The compendium view then shows them at the pack
    // root, which fixes the "folder expanded but entries invisible" case
    // caused by stale folder references.
    if (dialogResult.action === "relink") {
      const updates = selectedIndices
        .map(i => orphans[i]?.doc?.id)
        .filter(Boolean)
        .map(id => ({ _id: id, folder: null }))
      if (!updates.length) return
      try {
        if (wasLocked) await actorPack.configure({ locked: false })
        await Actor.implementation.updateDocuments(updates, { pack: packName })
        if (wasLocked) await actorPack.configure({ locked: true })
        try { await _beneosRefreshOpenPackWindows(actorPack) } catch (e) { /* refresh failed */ }
      } catch (err) {
        console.error("[Beneos Cloud] OrphanCleanup relink failed", err)
        ui.notifications?.error?.(`Beneos relink failed: ${err?.message || "unknown"}`)
        return
      }
      ui.notifications?.info?.(game.i18n.format("BENEOS.Cleanup.RelinkDone", { count: updates.length }))
      return
    }

    // Delete branch (default).
    const confirmResult = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("BENEOS.Cleanup.Title") },
      content: `<p>${game.i18n.format("BENEOS.Cleanup.ConfirmDelete", { count: selectedIndices.length })}</p>`,
      buttons: [
        { action: "yes", label: game.i18n.localize("BENEOS.Cleanup.DeleteSelected"), default: true, callback: () => "yes" },
        { action: "no",  label: game.i18n.localize("BENEOS.Cleanup.Cancel"),                          callback: () => "no"  }
      ],
      rejectClose: false
    }).catch(() => "no")
    if (confirmResult !== "yes") return

    const ids = selectedIndices.map(i => orphans[i]?.doc?.id).filter(Boolean)
    if (!ids.length) return
    try {
      if (wasLocked) await actorPack.configure({ locked: false })
      await Actor.implementation.deleteDocuments(ids, { pack: packName })
      if (wasLocked) await actorPack.configure({ locked: true })
      try { await _beneosRefreshOpenPackWindows(actorPack) } catch (e) { /* refresh failed */ }
    } catch (err) {
      console.error("[Beneos Cloud] OrphanCleanup delete failed", err)
      ui.notifications?.error?.(`Beneos cleanup failed: ${err?.message || "unknown"}`)
      return
    }
    ui.notifications?.info?.(game.i18n.format("BENEOS.Cleanup.Done", { count: ids.length }))
  }

  async importTokenToCompendium(tokenArray, event, isBatch = false) {
    // Fix #C5: see importItemToCompendium for rationale.
    if (!isBatch) this.noWorldImport = false

    BeneosUtility.debugMessage("Importing token to compendium", tokenArray, event, isBatch)

    // Punkt 1 — Folder-Restruktur: per-token folder paths are computed
    // inside the loop now ("Beneos Creatures / [SRD|Beneos Originals] /
    // <Type> / CR <X>"), in both the world Actor-Directory and the
    // compendium pack. The legacy flat "Beneos Actors" world folder is no
    // longer created automatically; pre-existing installs keep their old
    // folders by direction (no migration).

    let tNow = Math.floor(Date.now() / 1000) // Get the current date in seconds
    let properName

    let actorDataPF2
    let packName = "world.beneos_module_actors"
    let actorPack = BeneosUtility.getActorPack()
    if (game.system.id == "pf2e") {
      let rPF2 = await fetch("modules/beneos-module/scripts/generic_npc_pf2.json")
      actorDataPF2 = await rPF2.json()
    }

    let journalPack = BeneosUtility.getJournalPack()
    if (!actorPack || !journalPack) {
      ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.CompendiumMissing"))
      return
    }
    let actorRecords = await actorPack.getIndex()
    let journalRecords = await journalPack.getIndex()

    if (!isBatch) { // Lock/Unlock only in single install mode
      await actorPack.configure({ locked: false })
      await journalPack.configure({ locked: false })
    }

    for (let tokenKey in tokenArray) {
      let tokenData = tokenArray[tokenKey]
      // Get the common actor data
      let actorData = tokenData.actorJSON
      if (actorDataPF2) {
        let name = tokenData.actorJSON.name
        actorData = actorDataPF2
        actorDataPF2.name = name
      }

      let finalFolder = `beneos_assets/cloud/tokens/${tokenKey}`
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets");
      } catch (err) {
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud");
      } catch (err) {
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud/tokens");
      } catch (err) {
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", finalFolder);
      } catch (err) {
      }
      // Add journal entry
      let journalData = tokenData.journalJSON


      for (let i = 0; i < tokenData.tokenImages.length; i++) {
        let fullId = tokenKey + "_" + (i + 1)

        // Decode the base64 tokenImg and upload it to the FilePicker
        let base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].token.image64}`);
        let blob = await base64Response.blob();
        let file = new File([blob], tokenData.tokenImages[i].token.filename, { type: "image/webp" });
        await _beneosSafeUpload(finalFolder, file, `token ${tokenKey} variant ${i + 1} token`);

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].journal.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].journal.filename, { type: "image/webp" });
        await _beneosSafeUpload(finalFolder, file, `token ${tokenKey} variant ${i + 1} journal`);

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].avatar.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].avatar.filename, { type: "image/webp" });
        await _beneosSafeUpload(finalFolder, file, `token ${tokenKey} variant ${i + 1} avatar`);

        // `*-top.webp` companion. Top-down used to be optional here: a
        // variant that shipped without one was skipped with nothing but a
        // debug line, while the post-install check demanded all four aspects
        // and reported a file that was never supposed to exist. Product rule
        // since 2026-08-21: a creature is only correct WITH a top-down, so a
        // missing one is a real defect in the catalog and gets said out loud
        // instead of being swallowed.
        const topData = tokenData.tokenImages[i].top
        if (topData?.image64 && topData?.filename) {
          const topResp = await fetch(`data:image/webp;base64,${topData.image64}`);
          const topBlob = await topResp.blob();
          const topFile = new File([topBlob], topData.filename, { type: "image/webp" });
          // Fix M8.3.39: remember whether the top file actually landed on disk.
          // The prototype-token swap below must only point at -top.webp when
          // the upload succeeded; otherwise we leave a dangling reference that
          // 404s on the canvas (matches the user-report top.webp 404 spam).
          const topUpload = await _beneosSafeUpload(finalFolder, topFile, `token ${tokenKey} variant ${i + 1} top`);
          topData._beneosUploaded = !!(topUpload && topUpload.path)
        } else {
          console.warn(
            `[Beneos Cloud] Token ${tokenKey} variant ${i + 1} ships without a top-down image. `
            + `Top-down is mandatory; this variant should not be in the catalog.`
          )
        }

        // Create the journal entry
        let newJournal
        if (journalData) {
          journalData.pages[0].src = `${finalFolder}/${tokenData.tokenImages[i].journal.filename}`
          journalData.name = actorData.name + " " + (i + 1)
          let journal = new JournalEntry(journalData);
          if (journal) {
            // Search for existing journal entry
            let existingJournal = journalRecords.find(j => j.name == journal.name && j.img == journal.img)
            if (existingJournal) {
              BeneosUtility.debugMessage("Deleting existing journal", existingJournal._id)
              try {
                await JournalEntry.deleteDocuments([existingJournal._id], { pack: "world.beneos_module_journal" })
              } catch (err) {
                console.warn("[Beneos Cloud] Error deleting existing journal", err)
              }
            }
            newJournal = await journalPack.importDocument(journal);
            await newJournal.setFlag("world", "beneos", { tokenkey: tokenKey, fullId: fullId, idx: i, installDate: tNow, contentSignature: tokenData?.contentSignature ?? "" })
          }
        } else {
          BeneosUtility.debugMessage("No journal data for token", tokenKey)
        }

        if (actorData) {
          actorData.img = `${finalFolder}/${tokenData.tokenImages[i].avatar.filename}`
          actorData.prototypeToken.texture.src = `${finalFolder}/${tokenData.tokenImages[i].token.filename}`
          // Top-Down swap is gated on the asset actually having been uploaded
          // by the loop above. Every token in scope of an account is supposed
          // to ship with a -top.webp; if it didn't arrive, that's a server-
          // side anomaly and we don't pretend the prototype points at a real
          // file. Per-token rendering overrides (cloudRendering.topDownScale /
          // tokenizedScale) still apply.
          try {
            const installStyle = game.settings.get(BeneosUtility.moduleID(), "beneos-default-install-style")
            const topAssetAvailable = !!(topData?.image64 && topData?.filename && topData._beneosUploaded)
            if (installStyle === "topdown" && topAssetAvailable
              && actorData.prototypeToken.texture.src.includes("-token.webp")) {
              actorData.prototypeToken.texture.src =
                actorData.prototypeToken.texture.src.replace("-token.webp", "-top.webp")
            } else if (installStyle === "topdown" && !topAssetAvailable) {
              // User picked Top-Down as default but the cloud response did
              // not include a top variant. Keep the prototype on 2.5D and
              // surface a warning so the user understands what happened.
              try {
                ui.notifications?.warn?.(
                  game.i18n.format("BENEOS.Cloud.Notification.TopDownMissing", { name: actorData.name })
                  || `Beneos: Top-Down variant unavailable for ${actorData.name} — falling back to 2.5D.`
                )
              } catch (e) { /* notifications not ready yet */ }
            }
            // Scale UND Anchor aus demselben Resolver wie ueberall sonst.
            // Vorher wurde hier nur der Scale von Hand aus dem Flag
            // gelesen: ohne Varianten-Praezedenz (die `-2-top.webp` also
            // mit dem Wert der `-1` versorgt) und ohne Anchor, weshalb
            // Top-Down-Prototypes auf 0.5/0.5 stehenblieben, bis der
            // Anwender einmal den HUD-Toggle betaetigte.
            const finalSrc = actorData.prototypeToken.texture.src
            // Der Resolver liest die Flags ueber getFlag. Hier liegt aber
            // noch kein Actor-Dokument vor, nur der rohe Cloud-JSON, also
            // reichen wir einen minimalen Traeger mit derselben Signatur
            // durch statt die Aufloesungslogik zu duplizieren.
            const flagCarrier = { getFlag: (scope, key) => actorData?.flags?.[scope]?.[key] }
            const profile = BeneosUtility.getBeneosRenderProfile(flagCarrier, finalSrc)
            if (actorData.prototypeToken.texture) {
              actorData.prototypeToken.texture.scaleX = profile.scale
              actorData.prototypeToken.texture.scaleY = profile.scale
              actorData.prototypeToken.texture.anchorX = profile.anchorX
              actorData.prototypeToken.texture.anchorY = profile.anchorY
            }
            // `prototypeToken.scale` war ein V9-Feld und wird von V13 beim
            // Anlegen des Dokuments verworfen, also ersatzlos entfernt.
          } catch (e) { /* setting not registered yet, fall back to 2.5D */ }
          // The import used to rewrite exactly two fields, actorData.img and
          // prototypeToken.texture.src, and never looked at the embedded
          // items. Anything they carried survived verbatim, including spell
          // icons pointing into the authoring asset tree. Normalise them here,
          // the last moment before the document exists.
          try {
            const _bnIcons = await normalizeEmbeddedItems(actorData)
            if (_bnIcons > 0) {
              console.log(`Beneos | ${tokenKey}: ${_bnIcons} embedded item icon(s) redirected to the module icon pool`)
            }
          } catch (err) {
            console.warn("Beneos | embedded item normalisation failed, importing as authored", err)
          }
          let actor = new CONFIG.Actor.documentClass(actorData);
          if (actor) {
            // Search if we have already an actor with the same name in the compendium
            let existingActor = actorRecords.find(a => a.name == actor.name && a.img == actorData.img)
            if (existingActor) {
              BeneosUtility.debugMessage("Deleting existing actor", existingActor._id, packName)
              try {
                await Actor.implementation.deleteDocuments([existingActor._id], { pack: packName });
              } catch (err) {
                console.warn("[Beneos Cloud] Error deleting existing actor", err)
              }
            }
            // Punkt 1 — Folder-Restruktur: compute the new path
            // "Beneos Creatures / [SRD|Beneos Originals] / <Type> / CR <X>"
            // for both the compendium folder and the world folder, so the
            // compendium-doc and (later) the world-copy land in matching
            // structured folders. Source-bucket detection is shared with V2.
            const tokenDb = game.beneos.databaseHolder.getTokenDatabaseInfo(tokenKey)
            const rawBucket = BeneosUtility.getSourceBucket(tokenDb, "token", tokenKey)
            const folderBucket = BeneosUtility.getFolderBucket(rawBucket)
            let creatureType = tokenDb?.properties?.type?.[0] ?? "Unknown"
            creatureType = creatureType.charAt(0).toUpperCase() + creatureType.slice(1)
            const crFolder = BeneosUtility.formatCrFolder(tokenDb?.properties?.cr)
            const beneosSegments = ["Beneos Creatures", folderBucket, creatureType, crFolder]
            const compendiumLeaf = await BeneosUtility.ensureBeneosFolderPath(
              { type: "Actor", scope: "compendium", pack: "world.beneos_module_actors" },
              beneosSegments
            )
            // And then create it again
            let imported = await actorPack.importDocument(actor, compendiumLeaf?.id ? { folder: compendiumLeaf.id } : undefined);
            // Fix #C3: only mark as installed when import actually succeeded; previous
            // code accessed `imported.name` unconditionally, which crashed silently for
            // failed imports and could leave half-written settings.
            if (imported?.id) {
              properName = imported.name
              if (compendiumLeaf?.id && imported.folder?.id !== compendiumLeaf.id) {
                try { await imported.update({ folder: compendiumLeaf.id }) }
                catch (err) { BeneosUtility.debugMessage("Folder assign failed (compendium actor)", err) }
              }
              // Stage 13a: pull rendering metadata (per-token scale +
              // FX presets + fxEnabled) from the cloud-delivered
              // actorJSON. The cloud may not yet ship this object, so
              // we default to an empty `rendering: {}` — that's
              // forward-compatible: getBeneosScale falls through to
              // the BENEOS_SCALE_* constants when fields are absent.
              // Stage 13a-Polish: explicit isBeneosCreature marker so
              // future features can gate Beneos-only behavior on a
              // boolean instead of relying on flag-existence
              // truthiness.
              const cloudRenderingFlag = actorData?.flags?.world?.beneos?.rendering || {}
              await imported.setFlag("world", "beneos", {
                tokenKey, fullId, idx: i,
                journalId: newJournal?.id,
                installationDate: Date.now(),
                isBeneosCreature: true,
                rendering: cloudRenderingFlag,
                contentSignature: tokenData?.contentSignature ?? ""
              })
              BeneosUtility.beneosTokens[fullId] = {
                actorName: imported.name,
                avatar: actorData.img,
                token: actorData.prototypeToken.texture.src,
                // Top-Down Stage 1: remember the top-webp path when the
                // cloud included it; null otherwise so Stage 2 (mode
                // switch) can detect old-cache entries that need a
                // re-install.
                topDown: (topData?.filename) ? `${finalFolder}/${topData.filename}` : null,
                actorId: imported.id,
                installDate: tNow,
                contentSignature: tokenData?.contentSignature ?? "",
                journalId: newJournal?.id,
                folder: finalFolder,
                tokenKey: tokenKey,
                fullId: fullId,
                number: i + 1
              }
              // World import — only the first token of a multi-variant series.
              // Two paths depending on whether this is a first install or an update:
              //   - First install: import a fresh world copy and stamp originalName.
              //   - Update: propagate to existing world actors (and scene tokens),
              //     skipping anything the DM has renamed.
              if (!this.noWorldImport && i == 0) {
                const worldLeaf = await BeneosUtility.ensureBeneosFolderPath(
                  { type: "Actor", scope: "world" },
                  beneosSegments
                )
                const existingWorldActors = game.actors.filter(a =>
                  a.getFlag("world", "beneos")?.fullId === fullId
                )
                if (existingWorldActors.length === 0) {
                  // First install: drop a fresh world copy and stamp the
                  // original compendium name so future updates can verify
                  // the world actor hasn't been renamed by the DM.
                  const newWorldActor = await game.actors.importFromCompendium(actorPack, imported.id, worldLeaf?.id ? { folder: worldLeaf.id } : {});
                  if (newWorldActor) {
                    const flag = newWorldActor.getFlag("world", "beneos") || {}
                    // Stage 13a: rendering ships with the cloud actorJSON
                    // and was already merged into the compendium imported
                    // actor's flag (line 1786). importFromCompendium
                    // copies that flag-tree, so it lands here too. We
                    // just preserve it via spread; if the import dropped
                    // it, fall back to the cloud value.
                    // Stage 13a-Polish: ensure isBeneosCreature is set
                    // explicitly on the world copy too.
                    const cloudRenderingFlag = actorData?.flags?.world?.beneos?.rendering || {}
                    await newWorldActor.setFlag("world", "beneos", {
                      ...flag,
                      originalName: imported.name,
                      installationDate: Date.now(),
                      isBeneosCreature: true,
                      rendering: flag.rendering || cloudRenderingFlag
                    })
                  }
                } else {
                  // Update: cascade the new compendium data to matching
                  // world actors and their scene tokens. The options bag
                  // carries the context the dispatcher needs for the
                  // "install as new copy" and "reset & reinstall" handlers.
                  await this._propagateTokenUpdateToWorld(fullId, imported, existingWorldActors, {
                    actorPack,
                    beneosSegments,
                    tokenKey,
                    contentSignature: tokenData?.contentSignature ?? "",
                    cloudRenderingFlag
                  })
                }
              }
            } else {
              console.error("BeneosModule: Token actor import failed for", tokenKey, fullId)
            }
          } else {
            // Fix #C3: previous code referenced an undefined `records` variable here,
            // which threw ReferenceError and crashed the entire batch. Use the data we have.
            this.importErrors?.push("Error in creating actor " + (actorData?.name ?? tokenKey))
            console.error("BeneosModule: Error creating actor for", tokenKey, actorData?.name)
          }
        } else {
          BeneosUtility.debugMessage("No actor data for token", tokenKey)
          ui.notifications.error(game.i18n.format("BENEOS.Cloud.Notification.TokenInstallError", { key: tokenKey }))
        }
      }
      // Pass the images themselves, not their count: the expectation is then
      // built from what the server actually offered, filenames included.
      const _bnHealthToken = await _beneosValidateInstalledAsset("token", tokenKey, tokenData?.tokenImages || 1)
      // Anything still missing after the first pass gets one sequential retry
      // before it counts as a failure, mirroring the battlemap installer.
      await _beneosRepairMissingAspects("token", tokenKey, _bnHealthToken)
      // Used to be gated on isBatch, so a single install recorded nothing at
      // all and neither the summary nor telemetry ever saw it.
      if (_bnHealthToken.aspectsMissing.length > 0) {
        this.importErrors.push({ kind: "token", key: tokenKey, missing: _bnHealthToken.aspectsMissing })
        _beneosTrackAssetInstallError("token", tokenKey, _bnHealthToken)
      }

      let toSave = JSON.stringify(BeneosUtility.beneosTokens)
      // DEBUG : BeneosUtility.debugMessage("Saving data :", toSave)
      await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', toSave) // Save the token config !

      if (!isBatch) { // Lock/Unlock only in single install mode
        this.sendChatMessageResult(event, "Token", properName)
        await actorPack.configure({ locked: true })
        await journalPack.configure({ locked: true })
        // Refresh any open compendium windows so the freshly imported actors
        // become visible without a manual close+reopen. Failure is silent
        // because this is a UX polish step, not a correctness requirement.
        try { await _beneosRefreshOpenPackWindows(actorPack) } catch (e) { /* refresh failed */ }
        try { await _beneosRefreshOpenPackWindows(journalPack) } catch (e) { /* refresh failed */ }
        // Fix #C2: see importItemToCompendium for rationale.
        game.beneos?.cloudWindowV2?.notifyInstallEnded?.(tokenKey, true)
        // Fix #B-1d: place any tokens whose drop position was registered while
        // the import was running (cloud-drag onto canvas). No-op if there were none.
        await this.drainPendingCanvasDrops(tokenKey)
      } else {
        this.updateInstalledAssets() // Update the installed assets count
      }
    }
  }

  async batchInstall(assetList) {
    // Per-kind compat gate. We bucket the batch by kind, run the gate once
    // per kind that's actually present, and drop blocked kinds before the
    // animation starts. Hard-blocked kinds (item/spell on non-dnd5e) emit
    // an info dialog and silently disappear from the queue. The soft-warn
    // for tokens/maps fires once with a session-bypass option. Dnd5e takes
    // a single property-read fast path inside confirmSystemCompat.
    const kindOrder = ["item", "spell", "token"]; // hard-blocked first so info dialogs come first
    const buckets = { token: {}, item: {}, spell: {} };
    for (let key in assetList) {
      const asset = assetList[key];
      if (asset.type === "actor" || asset.type === "token") buckets.token[key] = asset;
      else if (asset.type === "item")  buckets.item[key]  = asset;
      else if (asset.type === "spell") buckets.spell[key] = asset;
    }
    const filteredAssets = {};
    for (const kind of kindOrder) {
      const entries = buckets[kind];
      if (!Object.keys(entries).length) continue;
      if (!await BeneosUtility.confirmSystemCompat(kind)) continue;
      Object.assign(filteredAssets, entries);
    }
    if (Object.keys(filteredAssets).length === 0) return;

    // Stage 14: User-choice dialog when many creatures land in the same
    // batch. Notorious-bulk-downloaders inflate the world DB + actor sidebar
    // when 100s of tokens get a world copy each. Offer compendium-only as
    // an opt-in (creature-count drives the prompt; items/spells follow the
    // choice when triggered). Threshold: > 5 creatures.
    const creatureCount = Object.values(filteredAssets)
      .filter(a => a.type === "actor" || a.type === "token").length
    let deferWorldImport = false
    if (creatureCount > 5) {
      // Use DialogV2.wait so the Beneos theme classes actually take effect
      // (legacy `new Dialog()` ignores them, producing an off-theme grey box).
      let choice
      try {
        choice = await foundry.applications.api.DialogV2.wait({
          window: { title: game.i18n.localize("BENEOS.Cloud.BulkInstall.ConfirmTitle") },
          classes: ["dialog", "app", "window-app", "beneos-cloud-app", "beneos-confirm"],
          position: { width: 460 },
          content: `<div class="bc-confirm-content"><p class="bc-confirm-text">${game.i18n.format("BENEOS.Cloud.BulkInstall.ConfirmText", { count: creatureCount })}</p></div>`,
          buttons: [
            { action: "world",    label: game.i18n.localize("BENEOS.Cloud.BulkInstall.WorldInstall"), default: true, callback: () => "world"    },
            { action: "download", label: game.i18n.localize("BENEOS.Cloud.BulkInstall.DownloadOnly"),                callback: () => "download" },
            { action: "cancel",   label: game.i18n.localize("BENEOS.Common.Cancel"),                                 callback: () => "cancel"   }
          ],
          rejectClose: false
        })
      } catch (err) {
        console.warn("[Beneos Cloud] Bulk-install confirm dialog failed", err)
        choice = "cancel"
      }
      if (!choice || choice === "cancel") return
      deferWorldImport = (choice === "download")
    }

    await BeneosUtility.lockUnlockAllPacks(false)     // Unlock all packs before batch install
    // COunt the number of assets to install
    this.nbInstalled = 0
    this.toInstall = Object.keys(filteredAssets).length
    this.importErrors = []
    if (this.toInstall == 0) {
      ui.notifications.warn(game.i18n.localize("BENEOS.Cloud.Notification.BatchEmpty"))
      return;
    }
    BeneosUtility.debugMessage("Batch installing assets", filteredAssets, this.toInstall)
    // Stage 14: temporarily flip noWorldImport for the lifetime of this batch
    // when the user picked "Download only". Imports below are fire-and-forget
    // with a 200ms throttle, so we collect their Promises and await all of
    // them before restoring the flag — otherwise the restore races with the
    // first imports finishing and they'd still create world copies.
    const prevNoWorldImport = this.noWorldImport
    this.noWorldImport = deferWorldImport || this.noWorldImport
    try {
      const pending = []
      // Loop thru the filtered assetList and install them
      for (let key in filteredAssets) {
        let asset = filteredAssets[key]
        BeneosUtility.debugMessage("Batch installing asset", asset)
        if (asset.type == "actor" || asset.type == "token") {
          pending.push(this.importTokenFromCloud(asset.key, undefined, true))
        } else if (asset.type == "item") {
          pending.push(this.importItemFromCloud(asset.key, undefined, true))
        } else if (asset.type == "spell") {
          pending.push(this.importSpellsFromCloud(asset.key, undefined, true))
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      // Wait for every in-flight import to finish before resetting the flag.
      await Promise.allSettled(pending)
    } finally {
      this.noWorldImport = prevNoWorldImport
    }
    //await BeneosUtility.lockUnlockAllPacks(true) // Lock all packs after batch install
  }

  async updateInstalledAssets() {
    // V2 surfaces progress via the cloud-window footer band. Chat-message
    // and toast generation removed; the counter and pack-lock/re-render
    // sequence remains so the legacy V1 batchInstall path still completes
    // cleanly.
    this.nbInstalled++;
    if (this.nbInstalled >= this.toInstall) {
      setTimeout(() => {
        BeneosUtility.lockUnlockAllPacks(true)
        this.noWorldImport = false
        // Batch summary: report any assets whose post-install health-check
        // found missing aspects. Without this the GM only sees a generic
        // "done" — partial failures used to be invisible until someone
        // tried to drag a broken token.
        const errs = Array.isArray(this.importErrors) ? this.importErrors : []
        const total = this.toInstall || 0
        if (errs.length > 0) {
          try {
            console.warn("[Beneos Cloud] Batch finished with missing aspects:")
            console.table(errs.map(e => ({ kind: e.kind, key: e.key, missing: e.missing.join(", ") })))
          } catch (e) { console.warn("[Beneos Cloud] Batch errors:", errs) }
          try {
            ui.notifications?.warn?.(
              game.i18n.format("BENEOS.Cloud.Notification.BatchPartial", {
                ok: total - errs.length, total, failed: errs.length
              })
              || `Beneos: batch finished — ${total - errs.length}/${total} clean, ${errs.length} with missing aspects. See console for details.`
            )
          } catch (e) { /* notifications not ready */ }
        } else if (total > 0) {
          try {
            ui.notifications?.info?.(
              game.i18n.format("BENEOS.Cloud.Notification.BatchAllClean", { total })
              || `Beneos: batch finished — all ${total} asset(s) installed without missing aspects.`
            )
          } catch (e) { /* notifications not ready */ }
        }
        this.importErrors = []
        // V2 full-refresh after batch install — the previous V1 path
        // closed and reopened the dialog window; V2 stays open and
        // re-renders its parts in place.
        const v2 = game.beneos?.cloudWindowV2
        if (v2) v2.render({ parts: ["home", "sidebar", "results", "footer"] })
      }, 400)
    }
  }

  /**
   * Haengt Oberflaeche und Vorgang an eine Installationsadresse.
   *
   * WARUM DAS NOETIG IST
   *
   * Eine Kreatur kommt auf drei Wegen: sie wird beim Installieren einer Karte
   * mitgeliefert (`scene_install`), sie haengt am Creature Drawer einer Szene
   * (`drawer`), oder der Spielleiter hat sie selbst gesucht (`search`). Fuer den
   * Server war das bisher derselbe Aufruf und dieselbe Zeile. Der Unterschied
   * ist aber die eigentliche Frage: hundert Kreaturen ueber fuenf Wochen einzeln
   * geholt ist ein anderes Verhalten als der ganze Rueckstand an Tag eins.
   *
   * `interaction` haelt einen Lauf zusammen. Ein Drawer-Lauf holt dutzende
   * Kreaturen; ohne gemeinsame Kennung waeren das dutzende Vorgaenge.
   *
   * Fehlt beides, bleibt die Adresse unveraendert und der Server traegt
   * `unknown` ein. Das ist Absicht: geraten wird nicht.
   */
  _erwerbsAnhang(opts = {}) {
    let anhang = ""
    const flaeche = String(opts?.surface || "")
    if (["drawer", "search", "scene_install", "codex"].includes(flaeche)) {
      anhang += `&surface=${encodeURIComponent(flaeche)}`
    }
    const vorgang = String(opts?.interaction || "").replace(/[^a-f0-9]/gi, "").slice(0, 32)
    if (vorgang) anhang += `&interaction=${encodeURIComponent(vorgang)}`
    return anhang
  }

  /**
   * Eine neue Vorgangskennung fuer einen Installationslauf.
   *
   * Der Server nimmt nur [a-f0-9] an, die Spalte ist CHAR(32). `randomID` liefert
   * base62; die Nicht-Hex-Zeichen einfach auf "0" abzubilden wuerde drei Viertel
   * des Alphabets zusammenfallen lassen. Deshalb echte Hexziffern, mit
   * `randomID` nur als Rueckfall, falls die Krypto-Schnittstelle fehlt.
   */
  neuerErwerbsvorgang() {
    try {
      const b = new Uint8Array(16)
      globalThis.crypto.getRandomValues(b)
      return Array.from(b, x => x.toString(16).padStart(2, "0")).join("")
    } catch (_) {
      return foundry.utils.randomID(32).toLowerCase().replace(/[^a-f0-9]/g, "0")
    }
  }

  // Wave B-9-fix-47: returns the Promise so multi-install loops can
  // sequence pipelines and avoid the compendium-lock race.
  //
  // `isBatch` controls the compendium lock contract: when true, the caller
  // (batchInstall) is responsible for the global lockUnlockAllPacks cycle.
  // `opts.gated` is the system-compat gate flag: when true, the caller has
  // already shown the prompt and we skip the per-import gate. The two are
  // intentionally orthogonal — single-asset paths like the V2 install
  // button or handlePendingCanvasDrop gate up-front (so the install
  // animation only starts after Yes) but still want the import* function
  // to manage its own pack lock.
  async importTokenFromCloud(tokenKey, event = undefined, isBatch = false, opts = {}) {
    if (!isBatch && !opts.gated && !await BeneosUtility.confirmSystemCompat("token")) return;
    // Fix #E3: ignore repeat clicks while this token's pipeline is still in flight.
    const lockKey = `token:${tokenKey}`
    if (this.inflightImports.has(lockKey)) {
      ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.AlreadyImporting", { key: tokenKey }))
      return Promise.resolve()
    }
    this.inflightImports.add(lockKey)

    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `${BeneosUtility.cloudBase()}/foundry-manager.php?get_token=1&foundryId=${encodeURIComponent(userId)}&tokenKey=${encodeURIComponent(tokenKey)}` + this._erwerbsAnhang(opts)
    // Ueber die globale FIFO (enqueueInstall), damit parallele Einzel-Klicks
    // auf verschiedene Assets sich nicht im Compendium-Lock ueberholen.
    return this.enqueueInstall(() => fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importAsset = "Token"
          // Continue under the name the CLOUD uses for this asset, which can
          // differ from the one we asked for: some map packs reference their
          // creatures as "NNN_name" while the catalog knows them as "NNN-name"
          // (found 2026-08-03). The delivered image filenames always follow the
          // catalog, and the install folder, the flags and the post-install
          // health check are all built from the key, so keeping the requested
          // spelling produced a folder whose contents nothing could find again.
          const cloudKey = String(data?.data?.token?.filename || "") || tokenKey
          if (cloudKey !== tokenKey) {
            console.warn(`[Beneos Cloud] token '${tokenKey}' is '${cloudKey}' in the catalog; installing under the catalog name`)
            const drops = game.beneos.cloud.pendingCanvasDrops.get(tokenKey)
            if (drops) {
              game.beneos.cloud.pendingCanvasDrops.set(cloudKey, drops)
              game.beneos.cloud.pendingCanvasDrops.delete(tokenKey)
            }
          }
          _beneosReportCloudMetadata("token", cloudKey, data.data.token)
          // Fix #E3: await so the lock is only released after the full import (including
          // file uploads, compendium writes and search-engine re-render) has settled.
          await game.beneos.cloud.importTokenToCompendium({ [`${cloudKey}`]: data.data.token }, event, isBatch)
        } else {
          console.warn("[Beneos Cloud] Error in importing Token from BeneosCloud", data, tokenKey)
          ui.notifications.error(_beneosRefusalMessage("Token", data))
          BeneosAnalytics.trackAssetRefused?.("token", tokenKey, data?.reason)
          // Fix #B-1d: drop any pending canvas drops on server reject; user
          // already saw the error notification, no second one needed.
          game.beneos.cloud.pendingCanvasDrops.delete(tokenKey)
        }
      })
      .catch(err => {
        console.error("BeneosModule: token import error for", tokenKey, err)
        // Fix #B-1d: discard pending drops AND surface a notification so the
        // user understands why nothing appeared on the canvas.
        game.beneos.cloud.discardPendingCanvasDrops(tokenKey)
      }))
      .finally(() => {
        game.beneos.cloud.inflightImports.delete(lockKey)
      })
  }

  // Wave B-9-fix-47: returns a Promise that resolves after the full
  // import pipeline (fetch + compendium write + world import + softRefresh
  // + drainPendingItemDrops) completes. Callers can `await` to sequence
  // multiple installs and avoid the compendium-lock race condition that
  // happened when 7+ parallel imports tried to lock/unlock the same pack.
  // See importTokenFromCloud for the isBatch-vs-opts.gated contract.
  async importItemFromCloud(itemKey, event = undefined, isBatch = false, opts = {}) {
    if (!isBatch && !opts.gated && !await BeneosUtility.confirmSystemCompat("item")) return;
    itemKey = itemKey.toLowerCase().replaceAll("-", "_") // Fix #B5: replaceAll handles multi-hyphen keys
    // Fix #E3: see importTokenFromCloud for rationale.
    const lockKey = `item:${itemKey}`
    if (this.inflightImports.has(lockKey)) {
      ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.AlreadyImporting", { key: itemKey }))
      return Promise.resolve()
    }
    this.inflightImports.add(lockKey)

    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `${BeneosUtility.cloudBase()}/foundry-manager.php?get_item=1&foundryId=${encodeURIComponent(userId)}&itemKey=${encodeURIComponent(itemKey)}` + this._erwerbsAnhang(opts)
    // Globale FIFO, siehe importTokenFromCloud.
    return this.enqueueInstall(() => fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importAsset = "Item"
          _beneosReportCloudMetadata("item", itemKey, data.data.item)
          await game.beneos.cloud.importItemToCompendium({ [`${itemKey}`]: data.data.item }, event, isBatch)
        } else {
          console.warn("[Beneos Cloud] Error in importing Item from BeneosCloud", data, itemKey)
          ui.notifications.error(_beneosRefusalMessage("Item", data))
          BeneosAnalytics.trackAssetRefused?.("item", itemKey, data?.reason)
          // Wave B-9-fix-41: clear any pending actor-sheet drops for this key
          // so they don't dangle waiting for an install that never happened.
          game.beneos.cloud.discardPendingItemDrops?.(itemKey)
        }
      })
      .catch(err => {
        console.error("BeneosModule: item import error for", itemKey, err)
        game.beneos.cloud.discardPendingItemDrops?.(itemKey)
      }))
      .finally(() => {
        game.beneos.cloud.inflightImports.delete(lockKey)
      })
  }

  // Wave B-9-fix-47: returns the Promise (see importItemFromCloud).
  // See importTokenFromCloud for the isBatch-vs-opts.gated contract.
  async importSpellsFromCloud(spellKey, event = undefined, isBatch = false, opts = {}) {
    if (!isBatch && !opts.gated && !await BeneosUtility.confirmSystemCompat("spell")) return;
    spellKey = spellKey.toLowerCase().replaceAll("-", "_") // Fix #B5: replaceAll handles multi-hyphen keys
    // Fix #E3: see importTokenFromCloud for rationale.
    const lockKey = `spell:${spellKey}`
    if (this.inflightImports.has(lockKey)) {
      ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.AlreadyImporting", { key: spellKey }))
      return Promise.resolve()
    }
    this.inflightImports.add(lockKey)

    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `${BeneosUtility.cloudBase()}/foundry-manager.php?get_spell=1&foundryId=${encodeURIComponent(userId)}&spellKey=${encodeURIComponent(spellKey)}` + this._erwerbsAnhang(opts)
    // Globale FIFO, siehe importTokenFromCloud.
    return this.enqueueInstall(() => fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importAsset = "Spell"
          _beneosReportCloudMetadata("spell", spellKey, data.data.spell)
          await game.beneos.cloud.importSpellToCompendium({ [`${spellKey}`]: data.data.spell }, event, isBatch)
        } else {
          console.warn("[Beneos Cloud] Error in importing Spell from BeneosCloud", data, spellKey)
          ui.notifications.error(_beneosRefusalMessage("Spell", data))
          BeneosAnalytics.trackAssetRefused?.("spell", spellKey, data?.reason)
          // Wave B-9-fix-41: drop pending actor-sheet drops on failure.
          game.beneos.cloud.discardPendingItemDrops?.(spellKey)
        }
      })
      .catch(err => {
        console.error("BeneosModule: spell import error for", spellKey, err)
        game.beneos.cloud.discardPendingItemDrops?.(spellKey)
      }))
      .finally(() => {
        game.beneos.cloud.inflightImports.delete(lockKey)
      })
  }

  async importBattlemapFromCloud(filename, event = undefined) {
    // Fix #E3: see importTokenFromCloud for rationale. Battlemap path is not yet
    // wired to the search UI (see beneos-search-engine skill — Moulinette is the
    // current battlemap distribution channel) but we lock here for consistency.
    const lockKey = `battlemap:${filename}`
    if (this.inflightImports.has(lockKey)) {
      ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.AlreadyImporting", { key: filename }))
      return
    }
    this.inflightImports.add(lockKey)

    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `${BeneosUtility.cloudBase()}/foundry-manager.php?download_uploaded_file=1&foundryId=${encodeURIComponent(userId)}&filename=${encodeURIComponent(filename)}`

    try {
      let response = await fetch(url, { credentials: 'same-origin' })
      let data = await response.json()

      if (data.result == 'OK') {
        // Dump result for debug
        BeneosUtility.debugMessage("Battlemap data from BeneosCloud", data)
        // The field data.data.download_url contains the URL to download the battlemap file
        if (data.data?.download_url) {
          // Convertir l'URL /download/ en /download-fetch/ pour utiliser X-Accel-Redirect
          let fetchUrl = data.data.download_url.replace('/download/', '/download-fetch/')
          BeneosUtility.debugMessage("Downloading battlemap from URL", fetchUrl)

          // Create the directory structure if it doesn't exist. V14: the bare
          // global FilePicker is a deprecated alias; use the namespaced
          // implementation like the rest of this file.
          const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
          try {
            await FP.createDirectory("data", "beneos_assets", {});
          } catch (err) {
            BeneosUtility.debugMessage("Directory beneos_assets already exists")
          }
          try {
            await FP.createDirectory("data", "beneos_assets/cloud", {});
          } catch (err) {
            BeneosUtility.debugMessage("Directory beneos_assets/cloud already exists")
          }
          try {
            await FP.createDirectory("data", "beneos_assets/cloud/battlemaps", {});
          } catch (err) {
            BeneosUtility.debugMessage("Directory beneos_assets/cloud/battlemaps already exists")
          }

          // Download the file from the URL using fetch-optimized route
          let fileResponse = await fetch(fetchUrl);
          BeneosUtility.debugMessage("File response", fileResponse)

          if (!fileResponse.ok) {
            throw new Error(`Download failed: ${fileResponse.status} ${fileResponse.statusText}`);
          }

          let blob = await fileResponse.blob();
          BeneosUtility.debugMessage("Downloaded blob size:", blob.size);

          // Determine the file type from the filename
          let fileType = filename.split('.').pop().toLowerCase();
          let mimeType = blob.type || `application/${fileType}`;

          // FoundryVTT bloque les fichiers .zip pour raisons de sécurité
          // Solution : renommer en .webm
          let uploadFilename = filename;
          let isZipFile = fileType === 'zip';

          if (isZipFile) {
            uploadFilename = filename.replace(/\.zip$/i, '.webm');
            mimeType = 'video/webm';
            BeneosUtility.debugMessage(`Renaming ZIP file: ${filename} -> ${uploadFilename}`);
          }

          // Create a File object
          let file = new File([blob], uploadFilename, { type: mimeType });
          BeneosUtility.debugMessage("File object created:", file.name, file.size, file.type);

          // Fix #E4: previous code had a duplicated `.FilePicker` segment
          // (`FilePicker.implementation.FilePicker.upload`) which threw silently
          // and broke every battlemap upload. Aligned to the same form used by
          // token/item/spell uploads earlier in this file.
          try {
            let uploadResult = await foundry.applications.apps.FilePicker.implementation.upload(
              "data",
              "beneos_assets/cloud/battlemaps",
              file,
              {},
              { notify: false }
            );
            BeneosUtility.debugMessage("Upload result", uploadResult);

            if (isZipFile) {
              ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.BattlemapSavedRenamed", { newName: uploadFilename, oldName: filename }));
              ui.notifications.warn(game.i18n.localize("BENEOS.Cloud.Notification.BattlemapRenameNotice"));
            } else {
              ui.notifications.info(game.i18n.format("BENEOS.Cloud.Notification.BattlemapSaved", { filename }));
            }
          } catch (uploadError) {
            console.error("Upload error:", uploadError);
            ui.notifications.error(game.i18n.format("BENEOS.Cloud.Notification.BattlemapUploadFailed", { message: uploadError.message }));
          }

        } else {
          console.warn("[Beneos Cloud] Error in downloading Battlemap from BeneosCloud, no download URL provided", data, filename)
          ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.BattlemapNoUrl"))
        }
      } else {
        console.warn("[Beneos Cloud] Error in importing Battlemap from BeneosCloud", data, filename)
        ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.ImportErrorBattlemap"))
      }
    } catch (err) {
      console.warn("[Beneos Cloud] Error in downloading Battlemap from BeneosCloud", err)
      ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.ImportErrorBattlemap"))
    } finally {
      // Fix #E3: release the idempotency lock regardless of outcome.
      this.inflightImports.delete(`battlemap:${filename}`)
    }
  }
}