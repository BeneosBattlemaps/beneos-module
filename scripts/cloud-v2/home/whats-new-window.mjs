/* "What's new" popup shown once per world start when the signed-in account has
   gained something since it last confirmed the window.

   Two buckets are shown one after the other, never side by side: what the
   account gained through its Patreon support, and what it gained by buying in
   the shop. They read very differently to the customer, so each gets its own
   headline and its own reveal.

   The cursor lives on the server (users.last_whatsnew_seen_at) and is only
   moved when the user actually confirms the last card. Closing the window with
   the X leaves it untouched, so the announcement comes back next time. */

import { BeneosUtility } from "../../beneos_utility.js"
import { ackWhatsNew, fetchWhatsNew } from "../services/whats-new-api.mjs"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

const SETTING_ENABLED = "beneos-whatsnew-enabled"
// Own sound, not the shared notification one: this window is a reward, not an
// alert. Probed once per session because a missing file would otherwise make
// Foundry's audio helper log an error on every single card.
const NOTIFY_SFX = "modules/beneos-module/ui/sfx/beneos_update.ogg"
let sfxAvailable = null

// Same CDN roots and lookup chain the Home rails use (home-controller.mjs
// thumbnailFor). Battlemaps are the exception: their cover is served from the
// cloud under a stable unsigned path, and the server sends that URL along.
const THUMB_BASE = {
  token: "https://www.beneos-database.com/data/tokens/thumbnails_v2/",
  bmap: "https://www.beneos-database.com/data/battlemaps/thumbnails/",
  item: "https://www.beneos-database.com/data/items/thumbnails/",
  spell: "https://www.beneos-database.com/data/spells/thumbnails/"
}

const TYPE_LABEL_KEY = {
  token: "BENEOS.Cloud.Tab.Tokens",
  bmap: "BENEOS.Cloud.Tab.Maps",
  item: "BENEOS.Cloud.Tab.Items",
  spell: "BENEOS.Cloud.Tab.Spells"
}

/** Server asset type to the type string the module's catalog and tabs use. */
function toModuleType(serverType) {
  return String(serverType) === "battlemap" ? "bmap" : String(serverType)
}

export class BeneosWhatsNewWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-whatsnew-window",
    classes: ["beneos-cloud-app", "beneos_module", "beneos-whatsnew-window"],
    tag: "section",
    window: {
      title: "BENEOS.Cloud.WhatsNew.Title",
      icon: "fas fa-gift",
      resizable: false,
      minimizable: false
    },
    // Wide enough that a 16:9 release cover can be shown uncropped next to the
    // title: the cover is the selling point, so it is never cut to fit.
    position: { width: 660, height: 680 },
    actions: {
      whatsNewAdvance: BeneosWhatsNewWindow._onAdvance,
      whatsNewOpen: BeneosWhatsNewWindow._onOpenEntry
    }
  }

  static PARTS = {
    body: { template: "modules/beneos-module/templates/cloud-v2/home/whats-new.hbs" }
  }

  constructor(payload, options = {}) {
    super(options)
    this.payload = payload
    this.cardIndex = 0
    // Only non-empty buckets become cards, so a pure shop unlock never shows an
    // empty Patreon page first. Patreon leads because it is the recurring case.
    this.cards = []
    if (payload?.patreon?.items?.length) this.cards.push({ kind: "patreon", bucket: payload.patreon })
    if (payload?.shop?.items?.length) this.cards.push({ kind: "shop", bucket: payload.shop })
    this.acknowledged = false
  }

  get title() {
    return game.i18n.localize("BENEOS.Cloud.WhatsNew.Title") || "New for you"
  }

  /**
   * Entry point for the world-start orchestrator. Resolves to true when a window
   * was opened, so the caller can keep its "only one Beneos window per load"
   * rule. Never throws and never notifies: if anything is missing, the world
   * simply starts without a popup.
   */
  static async present() {
    try {
      if (!game.user?.isGM) return false
      let enabled = true
      try { enabled = game.settings.get(BeneosUtility.moduleID(), SETTING_ENABLED) !== false }
      catch (_e) { enabled = true }
      if (!enabled) return false
      if (!(await BeneosWhatsNewWindow.#waitForCloudLogin())) return false

      const payload = await fetchWhatsNew()
      if (!payload) return false

      const win = new BeneosWhatsNewWindow(payload)
      if (!win.cards.length) return false
      await win.render({ force: true })
      return true
    } catch (err) {
      console.warn("[Beneos What's New] Could not present:", err)
      return false
    }
  }

  /**
   * The cloud login resolves through an async round trip that is still in
   * flight when the ready hook runs, so asking isLoggedIn() right away always
   * answered no and the popup never appeared on a real world start.
   *
   * A stored foundry id is the cheap, synchronous signal that this world has an
   * account at all: without one we bail instantly and the update notice behind
   * us is not delayed. With one we wait for the connection to come up, bounded,
   * because a world start is not time critical but an endless wait would be.
   */
  static async #waitForCloudLogin(timeoutMs = 15000, stepMs = 500) {
    let storedId = ""
    try { storedId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id") || "" }
    catch (_e) { storedId = "" }
    if (!storedId || storedId === "anonymous") return false

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (game.beneos?.cloud?.isLoggedIn?.()) return true
      await new Promise(resolve => setTimeout(resolve, stepMs))
    }
    return false
  }

  async _prepareContext() {
    const card = this.cards[this.cardIndex] ?? this.cards[0]
    const total = this.cards.length
    const isLast = this.cardIndex >= total - 1

    // One catalog snapshot per type per render: BeneosDatabaseHolder.getAll
    // hands out a structuredClone of the whole category, so calling it per row
    // would clone the catalog once for every line in the list.
    const catalogs = {}
    const catalogFor = (type) => {
      if (!(type in catalogs)) {
        try { catalogs[type] = game.beneos?.databaseHolder?.getAll?.(type) || {} }
        catch (_e) { catalogs[type] = {} }
      }
      return catalogs[type]
    }

    const items = (card?.bucket?.items ?? []).map((entry, i) => {
      const type = toModuleType(entry.type)
      return {
        key: entry.key,
        name: entry.name || entry.key,
        type,
        typeLabel: game.i18n.localize(TYPE_LABEL_KEY[type] ?? ""),
        thumbnail: this.#thumbnailFor(type, entry.key, entry.thumbnailUrl, catalogFor),
        // Drives the staggered reveal in CSS; capped so a long list does not
        // end up waiting seconds for its last row.
        revealIndex: Math.min(i, 14)
      }
    })

    const overflow = card?.bucket?.overflow ?? 0
    return {
      kind: card?.kind ?? "patreon",
      headline: game.i18n.localize(card?.kind === "shop"
        ? "BENEOS.Cloud.WhatsNew.ShopHeadline"
        : "BENEOS.Cloud.WhatsNew.PatreonHeadline"),
      subline: game.i18n.localize(card?.kind === "shop"
        ? "BENEOS.Cloud.WhatsNew.ShopSubline"
        : "BENEOS.Cloud.WhatsNew.PatreonSubline"),
      items,
      overflow,
      overflowLabel: overflow > 0
        ? game.i18n.format("BENEOS.Cloud.WhatsNew.More", { count: overflow })
        : "",
      showCounter: total > 1,
      counterLabel: game.i18n.format("BENEOS.Cloud.WhatsNew.Counter", {
        current: this.cardIndex + 1, total
      }),
      buttonLabel: game.i18n.localize(isLast
        ? "BENEOS.Cloud.WhatsNew.Confirm"
        : "BENEOS.Cloud.WhatsNew.Next"),
      optOutLabel: game.i18n.localize("BENEOS.Cloud.WhatsNew.DontShowAgain"),
      hintLabel: game.i18n.localize("BENEOS.Cloud.WhatsNew.ClickHint")
    }
  }

  /** Server URL first (battlemaps), else the catalog lookup chain. */
  #thumbnailFor(type, key, serverUrl, catalogFor) {
    if (serverUrl) return serverUrl
    const base = THUMB_BASE[type]
    if (!base) return ""
    const data = catalogFor(type)?.[key]
    const file = data?.properties?.thumbnail
      || data?.properties?.icon
      || data?.thumbnail
      || data?.icon
      || `${key}.webp`
    return `${base}${file}`
  }

  _onRender(context, options) {
    super._onRender?.(context, options)
    try {
      const box = this.element?.querySelector?.('input[name="beneos-whatsnew-optout"]')
      if (box) {
        box.addEventListener("change", async ev => {
          try {
            await game.settings.set(BeneosUtility.moduleID(), SETTING_ENABLED, !ev.target.checked)
          } catch (err) {
            console.warn("[Beneos What's New] Could not persist opt-out:", err)
          }
        })
      }
    } catch (err) {
      console.warn("[Beneos What's New] Render wiring failed:", err)
    }
    // The reveal sound belongs to the card, not to the window: it plays again
    // when the second card comes up.
    BeneosWhatsNewWindow.#playRevealSfx()
  }

  /**
   * Play the reveal sound, once the file has been confirmed to exist. The probe
   * runs once per session and its result is remembered: without it a module
   * build that ships without the sound would log an audio error for every card
   * a user ever sees, which is a lot of noise for something purely decorative.
   */
  static #playRevealSfx() {
    const play = () => {
      try {
        const helper = foundry.audio?.AudioHelper
        if (helper?.play) helper.play({ src: NOTIFY_SFX, volume: 0.5, autoplay: true, loop: false }, false)
      } catch (_e) { /* no audio context yet */ }
    }
    if (sfxAvailable === true) { play(); return }
    if (sfxAvailable === false) return
    fetch(NOTIFY_SFX, { method: "HEAD" })
      .then(response => {
        sfxAvailable = response.ok
        if (sfxAvailable) play()
        else console.debug(`[Beneos What's New] reveal sound missing, staying silent: ${NOTIFY_SFX}`)
      })
      .catch(() => { sfxAvailable = false })
  }

  static async _onAdvance(event, _target) {
    event.preventDefault()
    if (this.cardIndex < this.cards.length - 1) {
      this.cardIndex += 1
      await this.render({ parts: ["body"] })
      return
    }
    // Last card confirmed: this is the only path that moves the cursor.
    this.acknowledged = true
    try { await ackWhatsNew(this.payload?.serverTime) }
    catch (err) { console.warn("[Beneos What's New] Acknowledge failed:", err) }
    await this.close()
  }

  /**
   * Open the cloud window on the clicked entry. Battlemaps focus their release
   * card directly; tokens, items and spells switch to their tab with the name
   * seeded into the text filter, which is the same route the Home rails take.
   */
  static async _onOpenEntry(event, target) {
    event.preventDefault()
    const key = target?.dataset?.entryKey
    const type = target?.dataset?.entryType
    const name = target?.dataset?.entryName || ""
    if (!key || !type) return

    // Close first: the cloud window is large and would otherwise open behind
    // this popup. Closing without confirming leaves the cursor alone on
    // purpose, so the user sees the rest of the list again next time.
    try { await this.close() } catch (_e) { /* already closing */ }

    let Win = globalThis.BeneosCloudWindowV2
    if (!Win) {
      try { Win = (await import("../cloud-window-v2.mjs"))?.BeneosCloudWindowV2 }
      catch (_e) { /* ignore */ }
    }
    if (!Win) return

    const win = game.beneos?.cloudWindowV2 ?? new Win()
    try { await win.render({ force: true }) }
    catch (_e) { try { win.render(true) } catch (_e2) { return } }

    try {
      if (type === "bmap") {
        win.searchMode = "bmap"
        win._bmapViewMode = "releases"
        win.selectedAssetKey = key
      } else {
        win.searchMode = type
        win.selectedAssetKey = null
        win._textFilter = name
      }
      await win.render({ parts: ["header", "home", "sidebar", "results"] })
    } catch (err) {
      console.warn("[Beneos What's New] Could not focus entry in cloud window:", err)
    }
  }
}
