import { BeneosUtility } from "./beneos_utility.js"
import { BeneosInfoBox } from "./beneos_info_box.js"
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

export class BeneosCloudLogin extends FormApplication {

  /********************************************************************************** */
  constructor(origin = null) {
    super()
    this.requestOrigin = origin
    this.noWorldImport = false
  }

  /********************************************************************************** */
  async loginDialog() {

    let content = await renderTemplate("modules/beneos-module/templates/beneos-cloud-login.html", {})

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
          action: "login",
          label: game.i18n.localize("BENEOS.Cloud.Login.Submit"),
          default: true,
          callback: (event, button, dialog) => {
            const output = Array.from(button.form.elements).reduce((obj, input) => {
              if (input.name) obj[input.name] = input.value
              return obj
            }, {})
            return output
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

    // Wave B-9-fix-57: validate that BOTH fields were filled. Empty
    // fields used to fall through to the LoginFailed red error which
    // confused the user — the issue isn't bad credentials, it's an
    // incomplete form. Surface a yellow warn with a clear message.
    if (!loginData.email?.trim() || !loginData.password?.trim()) {
      ui.notifications.warn(game.i18n.localize("BENEOS.Cloud.Notification.LoginIncomplete"))
      return
    }

    let cloudLoginURL = `https://beneos.cloud/foundry-login.php?email=${encodeURIComponent(loginData.email)}&password=${encodeURIComponent(loginData.password)}&foundryId=${encodeURIComponent(userId)}`
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
      let url = `https://beneos.cloud/foundry-manager.php?check=1&foundryId=${encodeURIComponent(userId)}`
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

  // Stage 9: 60s probe loop, only active while serverOffline is true.
  // Hits the existing ?check=1 healthcheck endpoint and lets
  // markServerStatus flip the flag back when the server returns.
  startServerProbeLoop() {
    if (this._serverProbeHandle) return
    this._serverProbeHandle = setInterval(() => {
      if (!this.serverOffline) return
      const userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id") || ""
      const url = `https://beneos.cloud/foundry-manager.php?check=1&foundryId=${encodeURIComponent(userId)}&_t=${Date.now()}`
      fetch(url, { credentials: 'same-origin' })
        .then(r => this.markServerStatus(r, null))
        .catch(err => this.markServerStatus(null, err))
    }, 60000)
  }

  // Fix #E3: idempotency lock for in-flight imports. Keys look like
  // "token:<assetKey>" / "item:<assetKey>" / "spell:<assetKey>" / "battlemap:<filename>".
  // A repeated click on the same asset while its pipeline is still running is
  // ignored (with a notification) instead of spawning a parallel pipeline that
  // would race on file uploads, compendium delete-then-create, and the search
  // engine close-and-reopen. Released in `finally` blocks so errors don't leak
  // a permanent lock.
  inflightImports = new Set()

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
    let url = `https://beneos.cloud/foundry-manager.php?check=1&foundryId=${encodeURIComponent(userId)}`
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

  async disconnect() {
    this.setLoginStatus(false)
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-foundry-id", "")
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-patreon-status", "no_patreon")
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-token-patron", false)
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-battlemap-patron", false)
    this.lastLoginPayload = null
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

      // Stage 5: bridge flag for the preCreateToken hook in
      // beneos_module.js — flips the texture src to -top.webp before
      // the placeable is committed when the user dragged a Top-Down
      // tile. Set per-drop so multiple drops in a batch each carry
      // their own intent.
      BeneosUtility._pendingDropStyle = drop.forceStyle || "tokenized"
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

  // Dev-only helper: simulate a Patreon membership state for local
  // UX testing without an actual server login. Manipulates persistent
  // settings + in-memory payload + connected flag in lockstep, so the
  // patron-aware UI behaves as if the user signed in fresh with the
  // given role. Reset by calling disconnect().
  //
  // Also stubs availableContent so simulated personas can actually
  // install assets — patrons get every catalogue key, free accounts get
  // only the entries flagged properties.free_content === true in the
  // public database. Without this stub the Free-Section would render
  // but every card would fall back to the legacy "Not Available" path.
  async simulatePatron({ tokens = false, battlemaps = false, freeAccount = false } = {}) {
    const isPatron = tokens || battlemaps
    this.setLoginStatus(true)
    this.lastLoginPayload = {
      result: "OK",
      information: "User found (simulated)",
      patreon_status: isPatron ? "active_patron" : (freeAccount ? "free" : "no_patreon"),
      token_patron: !!tokens,
      battlemap_patron: !!battlemaps,
      campaigns: [tokens && "tokens", battlemaps && "battlemaps"].filter(Boolean),
      foundryId: "simulated"
    }
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-token-patron", !!tokens)
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-battlemap-patron", !!battlemaps)
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-patreon-status",
      isPatron ? "active_patron" : (freeAccount ? "free" : "no_patreon"))
    // Build a stub availableContent so cards have a real Install path.
    // Patron of a campaign → all keys from that campaign's catalogue
    // are available. Free / non-patron → only properties.free_content
    // entries surface as installable.
    const db = game.beneos?.databaseHolder
    const ts = Math.floor(Date.now() / 1000)
    const collect = (raw, includeAll) => {
      if (!raw) return []
      return Object.entries(raw)
        .filter(([_, data]) => includeAll || data?.properties?.free_content === true)
        .map(([key]) => ({ key, updated_ts: ts }))
    }
    this.availableContent = {
      tokens: collect(db?.tokenData?.content, !!tokens),
      items:  collect(db?.itemData?.content,  !!tokens),
      spells: collect(db?.spellData?.content, !!tokens)
    }
    console.warn("[Beneos] simulatePatron applied", {
      payload: this.lastLoginPayload,
      stubCounts: {
        tokens: this.availableContent.tokens.length,
        items:  this.availableContent.items.length,
        spells: this.availableContent.spells.length
      }
    })
    const v2 = game.beneos?.cloudWindowV2
    if (v2) v2.render({ parts: ["home", "sidebar", "results", "footer"] })
  }

  setLoginStatus(status) {
    this.cloudConnected = status
  }

  setAvailableContent(content) {
    this.availableContent = content
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

  isNew(key) {
    let content = this.availableContent.tokens
    if (!content || content.length == 0) return false
    for (const element of content) {
      if (element.key.toLowerCase() == key.toLowerCase()) {
        // Is new if the updated_ts is greater than the current date minus 30 days
        let t30days = 30 * 24 * 60 * 60
        let tNow30Days = Math.floor(Date.now() / 1000) - t30days
        return element.updated_ts >= tNow30Days;
      }
    }
    return false
  }

  isTokenAvailable(key) {
    // Defensive: a single malformed cloud entry (missing `key`) used to
    // crash the V2 cloud window render chain. Skip non-string entries
    // and bail early on a non-string lookup key.
    if (!key || typeof key !== "string") return false
    const content = this.availableContent?.tokens
    if (!Array.isArray(content) || !content.length) {
      BeneosUtility.debugMessage("No tokens available from BeneosCloud")
      return false
    }
    const lowKey = key.toLowerCase()
    for (const element of content) {
      const ek = element?.key
      if (typeof ek === "string" && ek.toLowerCase() === lowKey) return true
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

  // Fix #B2: returns a promise so callers (e.g. loginAttempt, search engine
  // open) can await content readiness before they read availableContent. The
  // function still no-ops gracefully on network/server errors; callers are not
  // forced to handle them. In-dubio-pro-reo: a UI that wants to be optimistic
  // can simply not await and render with the empty initial shape from #B1.
  async checkAvailableContent() {
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `https://beneos.cloud/foundry-manager.php?get_content=1&foundryId=${encodeURIComponent(userId)}`
    try {
      const response = await fetch(url, { credentials: 'same-origin' })
      // Stage 9: classify reachability before parsing the body.
      game.beneos?.cloud?.markServerStatus?.(response, null)
      const data = await response.json()
      BeneosUtility.debugMessage("BENEOS Cloud available content", data)
      if (data.result == 'OK') {
        BeneosUtility.debugMessage("Available content: ", data.data)
        game.beneos.cloud.setAvailableContent(data.data)
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
      return
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
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

      base64Response = await fetch(`data:image/webp;base64,${itemData.itemImage.back.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], itemData.itemImage.back.filename, { type: "image/webp" });
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

      itemObjectData.system.description.value = itemObjectData.system.description.value.replaceAll("beneos_assets/beneos_items/", "beneos_assets/cloud/items/")

      base64Response = await fetch(`data:image/webp;base64,${itemData.itemImage.icon.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], itemData.itemImage.icon.filename, { type: "image/webp" });
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });
      itemObjectData.img = `${finalFolder}/${itemData.itemImage.icon.filename}`

      // Loop thru itemObjectData.effects and update the img paths
      if (itemObjectData.effects && itemObjectData.effects.length > 0) {
        for (let i = 0; i < itemObjectData.effects.length; i++) {
          let effect = itemObjectData.effects[i]
          effect.img = effect.img.replaceAll("beneos_assets/beneos_items/", "beneos_assets/cloud/items/")
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
          await imported.setFlag("world", "beneos", { itemKey, fullId: itemKey, idx: 1, installationDate: tNow })
          BeneosUtility.beneosItems[itemKey] = {
            itemName: imported.name,
            img: imported.img,
            itemId: imported.id,
            folder: finalFolder,
            itemKey: itemKey,
            fullId: itemKey,
            installDate: tNow,
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
    }

    let toSave = JSON.stringify(BeneosUtility.beneosItems)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', toSave) // Save the token config !

    if (!isBatch) { // Lock/Unlock only in single install mode
      this.sendChatMessageResult(event, "Item", properName)
      await itemPack.configure({ locked: true })
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
      return
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
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

      base64Response = await fetch(`data:image/webp;base64,${spellData.spellImage.back.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], spellData.spellImage.back.filename, { type: "image/webp" });
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

      spellObjectData.system.description.value = spellObjectData.system.description.value.replaceAll("beneos_assets/beneos_spells/", "beneos_assets/cloud/spells/")

      base64Response = await fetch(`data:image/webp;base64,${spellData.spellImage.icon.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], spellData.spellImage.icon.filename, { type: "image/webp" });
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });
      spellObjectData.img = `${finalFolder}/${spellData.spellImage.icon.filename}`

      // Loop thru spellObjectData.effects and update the img paths
      if (spellObjectData.effects && spellObjectData.effects.length > 0) {
        for (let i = 0; i < spellObjectData.effects.length; i++) {
          let effect = spellObjectData.effects[i]
          effect.img = effect.img.replaceAll("beneos_assets/beneos_spells/", "beneos_assets/cloud/spells/")
        }
      }

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
          await imported.setFlag("world", "beneos", { spellKey, fullId: spellKey, idx: 1, installationDate: tNow })
          BeneosUtility.beneosSpells[spellKey] = {
            itemName: imported.name,
            img: imported.img,
            spellId: imported.id,
            folder: finalFolder,
            spellKey: spellKey,
            fullId: spellKey,
            installDate: tNow,
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
    }
    let toSave = JSON.stringify(BeneosUtility.beneosSpells)
    BeneosUtility.debugMessage("Saving SPELL data :", toSave)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-spellconfig', toSave) // Save the token config !

    if (!isBatch) { // Lock/Unlock only in single install mode
      this.sendChatMessageResult(event, "Spell", properName)
      await spellPack.configure({ locked: true })
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
   *
   * Lazy migration: actors installed before originalName was tracked have
   * no flag yet — for those we treat the current compendium name as the
   * baseline (best-effort; if the DM had already renamed pre-feature, we
   * cannot tell, but those will simply not match and stay untouched).
   *
   * Counts are surfaced in a DialogV2 so the GM has a chance to abort
   * before the cascade runs.
   */
  async _propagateTokenUpdateToWorld(fullId, imported, existingWorldActors) {
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
          if (token.name !== baseline) continue
          tokenUpdates.push({
            _id: token.id,
            name: compendiumName,
            "texture.src": imported.prototypeToken.texture.src
          })
          matchedTokens++
        }
        if (tokenUpdates.length) {
          console.log(`[Beneos Cloud] Scene "${scene.name}": ${tokenUpdates.length} matching token(s)`)
          sceneUpdates.push({ scene, updates: tokenUpdates })
        }
      }
    } finally {
      document.body.style.cursor = prevCursorSearch
    }
    console.log(`[Beneos Cloud] Scene scan complete — scanned ${scannedTokens} token(s), matched ${matchedTokens} for fullId=${fullId}`)
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

      const introText = game.i18n.format("BENEOS.Cloud.Update.IntroDetail", { actorCount: updatable.length })

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
          position: { width: 520 },
          content,
          buttons: [
            { action: "yes",       label: game.i18n.localize("BENEOS.Cloud.Update.Yes"),       default: true, callback: () => "yes"       },
            { action: "yesAlways", label: game.i18n.localize("BENEOS.Cloud.Update.YesAlways"),                callback: () => "yesAlways" },
            { action: "no",        label: game.i18n.localize("BENEOS.Cloud.Update.No"),                       callback: () => "no"        }
          ],
          rejectClose: false
        })
      } catch (err) {
        console.warn("[Beneos Cloud] Update-confirm dialog failed", err)
        dialogResult = "no"
      }
      if (!dialogResult || dialogResult === "no") return
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
        const existingRendering = beneosFlag.rendering || {}
        const cloudRendering = newData?.flags?.world?.beneos?.rendering || {}
        const mergedRendering = {
          topDownScale:   existingRendering.topDownScale   ?? cloudRendering.topDownScale   ?? null,
          tokenizedScale: existingRendering.tokenizedScale ?? cloudRendering.tokenizedScale ?? null,
          fx: (existingRendering.fx && existingRendering.fx.length > 0)
            ? existingRendering.fx
            : (cloudRendering.fx || []),
          fxEnabled: existingRendering.fxEnabled !== undefined ? existingRendering.fxEnabled : true
        }
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
        await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].journal.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].journal.filename, { type: "image/webp" });
        await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].avatar.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].avatar.filename, { type: "image/webp" });
        await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

        // Top-Down Stage 1: optional `*-top.webp` companion. Cloud
        // delivers the field on every response once the backend patch
        // is live; while it isn't (or for tokens whose top-asset isn't
        // rendered yet) we silently skip and leave a debug hint.
        const topData = tokenData.tokenImages[i].top
        if (topData?.image64 && topData?.filename) {
          const topResp = await fetch(`data:image/webp;base64,${topData.image64}`);
          const topBlob = await topResp.blob();
          const topFile = new File([topBlob], topData.filename, { type: "image/webp" });
          await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, topFile, {}, { notify: false });
        } else {
          BeneosUtility.debugMessage(
            "[Beneos] No top-down variant in cloud response for token", tokenKey, "variant", i + 1
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
            await newJournal.setFlag("world", "beneos", { tokenkey: tokenKey, fullId: fullId, idx: i, installDate: tNow })
          }
        } else {
          BeneosUtility.debugMessage("No journal data for token", tokenKey)
        }

        if (actorData) {
          actorData.img = `${finalFolder}/${tokenData.tokenImages[i].avatar.filename}`
          actorData.prototypeToken.texture.src = `${finalFolder}/${tokenData.tokenImages[i].token.filename}`
          // Top-Down Stage 2/6/7/12/13a: honour the user's default
          // install style. Stage 12 dropped the topData?.filename guard
          // — setting is source-of-truth. Stage 13a: when the cloud-
          // delivered actorJSON ships flags.world.beneos.rendering.
          // topDownScale (per-token-default), use that instead of the
          // BENEOS_SCALE_TOPDOWN constant.
          try {
            const installStyle = game.settings.get(BeneosUtility.moduleID(), "beneos-default-install-style")
            const cloudRendering = actorData?.flags?.world?.beneos?.rendering || null
            if (installStyle === "topdown"
              && actorData.prototypeToken.texture.src.includes("-token.webp")) {
              actorData.prototypeToken.texture.src =
                actorData.prototypeToken.texture.src.replace("-token.webp", "-top.webp")
              const topDownScale = (typeof cloudRendering?.topDownScale === "number" && cloudRendering.topDownScale > 0)
                ? cloudRendering.topDownScale
                : BeneosUtility.BENEOS_SCALE_TOPDOWN
              if (actorData.prototypeToken.texture) {
                actorData.prototypeToken.texture.scaleX = topDownScale
                actorData.prototypeToken.texture.scaleY = topDownScale
              }
              actorData.prototypeToken.scale = topDownScale
              if (!topData?.filename) {
                BeneosUtility.debugMessage(
                  "[Beneos] Top-Down install style active but cloud response has no top variant; relying on local file presence",
                  tokenKey, "variant", i + 1
                )
              }
            } else if (installStyle !== "topdown" && cloudRendering?.tokenizedScale
              && typeof cloudRendering.tokenizedScale === "number" && cloudRendering.tokenizedScale > 0) {
              // Stage 13a: 2.5D install path can also pick up a per-
              // token-override for the tokenized scale (e.g. a giant's
              // creature being sized larger than the 1.1 default).
              if (actorData.prototypeToken.texture) {
                actorData.prototypeToken.texture.scaleX = cloudRendering.tokenizedScale
                actorData.prototypeToken.texture.scaleY = cloudRendering.tokenizedScale
              }
              actorData.prototypeToken.scale = cloudRendering.tokenizedScale
            }
          } catch (e) { /* setting not registered yet — fall back to 2.5D */ }
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
                rendering: cloudRenderingFlag
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
                  // world actors and their scene tokens.
                  await this._propagateTokenUpdateToWorld(fullId, imported, existingWorldActors)
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

      let toSave = JSON.stringify(BeneosUtility.beneosTokens)
      // DEBUG : BeneosUtility.debugMessage("Saving data :", toSave)
      await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', toSave) // Save the token config !

      if (!isBatch) { // Lock/Unlock only in single install mode
        this.sendChatMessageResult(event, "Token", properName)
        await actorPack.configure({ locked: true })
        await journalPack.configure({ locked: true })
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

    await BeneosUtility.lockUnlockAllPacks(false)     // Unlock all packs before batch install
    // COunt the number of assets to install
    this.nbInstalled = 0
    this.toInstall = Object.keys(filteredAssets).length
    if (this.toInstall == 0) {
      ui.notifications.warn(game.i18n.localize("BENEOS.Cloud.Notification.BatchEmpty"))
      return;
    }
    BeneosUtility.debugMessage("Batch installing assets", filteredAssets, this.toInstall)
    // Loop thru the filtered assetList and install them
    for (let key in filteredAssets) {
      let asset = filteredAssets[key]
      BeneosUtility.debugMessage("Batch installing asset", asset)
      if (asset.type == "actor" || asset.type == "token") {
        this.importTokenFromCloud(asset.key, undefined, true)
      } else if (asset.type == "item") {
        this.importItemFromCloud(asset.key, undefined, true)
      } else if (asset.type == "spell") {
        this.importSpellsFromCloud(asset.key, undefined, true)
      }
      await new Promise(resolve => setTimeout(resolve, 200));
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
        // V2 full-refresh after batch install — the previous V1 path
        // closed and reopened the dialog window; V2 stays open and
        // re-renders its parts in place.
        const v2 = game.beneos?.cloudWindowV2
        if (v2) v2.render({ parts: ["home", "sidebar", "results", "footer"] })
      }, 400)
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
    let url = `https://beneos.cloud/foundry-manager.php?get_token=1&foundryId=${encodeURIComponent(userId)}&tokenKey=${encodeURIComponent(tokenKey)}`
    return fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importAsset = "Token"
          // Fix #E3: await so the lock is only released after the full import (including
          // file uploads, compendium writes and search-engine re-render) has settled.
          await game.beneos.cloud.importTokenToCompendium({ [`${tokenKey}`]: data.data.token }, event, isBatch)
        } else {
          console.warn("[Beneos Cloud] Error in importing Token from BeneosCloud", data, tokenKey)
          ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.ImportErrorToken"))
          // Fix #B-1d: drop any pending canvas drops on server reject; user
          // already saw the generic error notification, no second one needed.
          game.beneos.cloud.pendingCanvasDrops.delete(tokenKey)
        }
      })
      .catch(err => {
        console.error("BeneosModule: token import error for", tokenKey, err)
        // Fix #B-1d: discard pending drops AND surface a notification so the
        // user understands why nothing appeared on the canvas.
        game.beneos.cloud.discardPendingCanvasDrops(tokenKey)
      })
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
    let url = `https://beneos.cloud/foundry-manager.php?get_item=1&foundryId=${encodeURIComponent(userId)}&itemKey=${encodeURIComponent(itemKey)}`
    return fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importAsset = "Item"
          await game.beneos.cloud.importItemToCompendium({ [`${itemKey}`]: data.data.item }, event, isBatch)
        } else {
          console.warn("[Beneos Cloud] Error in importing Item from BeneosCloud", data, itemKey)
          ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.ImportErrorItem"))
          // Wave B-9-fix-41: clear any pending actor-sheet drops for this key
          // so they don't dangle waiting for an install that never happened.
          game.beneos.cloud.discardPendingItemDrops?.(itemKey)
        }
      })
      .catch(err => {
        console.error("BeneosModule: item import error for", itemKey, err)
        game.beneos.cloud.discardPendingItemDrops?.(itemKey)
      })
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
    let url = `https://beneos.cloud/foundry-manager.php?get_spell=1&foundryId=${encodeURIComponent(userId)}&spellKey=${encodeURIComponent(spellKey)}`
    return fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importAsset = "Spell"
          await game.beneos.cloud.importSpellToCompendium({ [`${spellKey}`]: data.data.spell }, event, isBatch)
        } else {
          console.warn("[Beneos Cloud] Error in importing Spell from BeneosCloud", data, spellKey)
          ui.notifications.error(game.i18n.localize("BENEOS.Cloud.Notification.ImportErrorSpell"))
          // Wave B-9-fix-41: drop pending actor-sheet drops on failure.
          game.beneos.cloud.discardPendingItemDrops?.(spellKey)
        }
      })
      .catch(err => {
        console.error("BeneosModule: spell import error for", spellKey, err)
        game.beneos.cloud.discardPendingItemDrops?.(spellKey)
      })
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
    let url = `https://beneos.cloud/foundry-manager.php?download_uploaded_file=1&foundryId=${encodeURIComponent(userId)}&filename=${encodeURIComponent(filename)}`

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

          // Create the directory structure if it doesn't exist
          try {
            await FilePicker.createDirectory("data", "beneos_assets", {});
          } catch (err) {
            BeneosUtility.debugMessage("Directory beneos_assets already exists")
          }
          try {
            await FilePicker.createDirectory("data", "beneos_assets/cloud", {});
          } catch (err) {
            BeneosUtility.debugMessage("Directory beneos_assets/cloud already exists")
          }
          try {
            await FilePicker.createDirectory("data", "beneos_assets/cloud/battlemaps", {});
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