/* "What's new" popup shown once per world start when something has been
   released since the window was last confirmed.

   Two buckets are shown one after the other, never side by side: what the
   account gained through its Patreon support, and what it gained by buying in
   the shop. They read very differently to the customer, so each gets its own
   headline and its own reveal.

   The window does not only show what the account holds. Beneos runs two Patreon
   campaigns and most customers support one of them, so a window filtered by
   ownership would hide half of every release week from exactly the people worth
   telling. Everything released is shown; what the account cannot reach carries a
   lock mark, and its group heading carries the button that would fix that. A
   world with no account at all sees the same list under a neutral headline.

   The cursor lives on the server (users.last_whatsnew_seen_at) and is only
   moved when the user actually confirms the last card. Closing the window with
   the X leaves it untouched, so the announcement comes back next time. */

import { BeneosUtility } from "../../beneos_utility.js"
import { BeneosCloudLogin } from "../../beneos_cloud.js"
import { ackWhatsNew, fetchWhatsNew } from "../services/whats-new-api.mjs"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

const SETTING_ENABLED = "beneos-whatsnew-enabled"
// One sound when the window arrives, one per unlock as it lands. The opening
// note is a swoosh rather than a notification chime: the window is a reward,
// not an alert, and a chime on top of the run of unlock notes was too much.
// Each file is probed once per session, because a missing file would otherwise
// make Foundry's audio helper log an error on every single card.
const SFX_OPEN = "modules/beneos-module/ui/sfx/beneos_swoosh.ogg"
const SFX_SPAWN = "modules/beneos-module/ui/sfx/beneos_achievement.ogg"
// Both turned down by a fifth from where they started. The spawn note sits
// lower again because it fires once per unlock.
const SFX_VOLUME_OPEN = 0.4
const SFX_VOLUME_SPAWN = 0.24
const sfxAvailable = new Map()

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

// The two Patreon campaigns, and where a group has to send someone who is not
// in the right one. Creatures, loot and spells all come out of the same
// campaign, so they share a key and a destination.
const CAMPAIGN_URL = {
  battlemaps: "https://www.patreon.com/cw/BeneosBattlemaps",
  tokens: "https://www.patreon.com/cw/BeneosTokens"
}

// Reveal order. Maps lead because their cover is the strongest thing the window
// has to show; each group announces itself before its entries arrive.
// `wide` gets the big 16:9 card, everything else a square tile.
const GROUPS = [
  { type: "bmap", wide: true, campaign: "battlemaps", titleKey: "BENEOS.Cloud.WhatsNew.GroupMaps" },
  { type: "token", wide: false, campaign: "tokens", titleKey: "BENEOS.Cloud.WhatsNew.GroupCreatures" },
  { type: "item", wide: false, campaign: "tokens", titleKey: "BENEOS.Cloud.WhatsNew.GroupItems" },
  { type: "spell", wide: false, campaign: "tokens", titleKey: "BENEOS.Cloud.WhatsNew.GroupSpells" }
]

// Reveal timing in milliseconds. The card wipes in first, then the sequence
// runs: heading, then its entries one every REVEAL_STEP. Half a second between
// unlocks is deliberate and set by hand. It is slow enough to watch each one
// land instead of seeing a list assemble itself, which is the whole point of
// the window. The confirm button works throughout, so a long haul never traps
// anyone behind the animation.
// Late enough that the window has faded up and the card has finished wiping in
// before the first heading appears, so the opening note gets an empty card to
// itself.
const REVEAL_START = 900
const REVEAL_TITLE_HOLD = 400
const REVEAL_STEP = 500

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
      // No icon in the title bar. The logo in the card already says who this is
      // from, and a second mark beside it was one too many.
      icon: false,
      resizable: false,
      minimizable: false
    },
    // Wide enough for a full-width 16:9 release cover: the cover is the selling
    // point, so it gets the room and is never cut to fit.
    position: { width: 720, height: 760 },
    actions: {
      whatsNewAdvance: BeneosWhatsNewWindow._onAdvance,
      whatsNewOpen: BeneosWhatsNewWindow._onOpenEntry,
      whatsNewJoin: BeneosWhatsNewWindow._onJoinCampaign,
      whatsNewLogin: BeneosWhatsNewWindow._onLogin
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
   *
   * This window is the least important thing that happens at world start. Every
   * branch below therefore fails towards silence, and nothing here is allowed to
   * hold up the rest of the boot. An offline world never opens it and never logs
   * anything louder than a debug line.
   */
  static async present() {
    try {
      if (!game.user?.isGM) return false
      let enabled = true
      try { enabled = game.settings.get(BeneosUtility.moduleID(), SETTING_ENABLED) !== false }
      catch (_e) { enabled = true }
      if (!enabled) return false
      // Cheapest gate first, before any waiting: no network, no window, and in
      // particular no fifteen second wait for a login that cannot happen.
      if (BeneosWhatsNewWindow.#isOffline()) return false

      const storedId = BeneosWhatsNewWindow.#storedFoundryId()
      let loggedIn = false
      if (storedId) {
        loggedIn = await BeneosWhatsNewWindow.#waitForCloudLogin()
        // A world that HAS an account must never be shown the account-free
        // card. If the login is slow, expired or unreachable, the honest answer
        // is to stay quiet: guessing "not signed in" would put a stack of Join
        // Patreon buttons in front of a paying customer.
        if (!loggedIn) return false
      }

      const payload = await fetchWhatsNew({ loggedIn })
      if (!payload) return false

      const win = new BeneosWhatsNewWindow(payload)
      if (!win.cards.length) return false
      // Before the first frame, so the opening note is heard the moment the
      // window appears and every later note lands on its own unlock.
      await BeneosWhatsNewWindow.#preloadSfx()
      await win.render({ force: true })
      return true
    } catch (err) {
      // Debug, not warn: an unreachable cloud is an ordinary condition for this
      // window, not a fault the user needs to read about at every world start.
      console.debug("[Beneos What's New] not shown:", err?.message ?? err)
      return false
    }
  }

  /**
   * Whether there is any point in trying.
   *
   * Two independent signals, because neither alone covers the cases that
   * matter. navigator.onLine is only trusted in the negative: true means
   * "attached to a network", which a Foundry server on a LAN with no way out
   * also reports. The module's own serverOffline flag covers exactly that gap,
   * because it is set the moment one of its own requests fails at the network
   * level, and it is usually already set by the time this window is asked, the
   * login attempt having run first.
   */
  static #isOffline() {
    if (!!globalThis.navigator && globalThis.navigator.onLine === false) return true
    return game.beneos?.cloud?.serverOffline === true
  }

  static #storedFoundryId() {
    let storedId = ""
    try { storedId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id") || "" }
    catch (_e) { storedId = "" }
    return (!storedId || storedId === "anonymous") ? "" : storedId
  }

  /**
   * The cloud login resolves through an async round trip that is still in
   * flight when the ready hook runs, so asking isLoggedIn() right away always
   * answered no and the popup never appeared on a real world start. Hence the
   * bounded wait: a world start is not time critical, an endless wait would be.
   *
   * Only called when this world has a stored account. Drops out the moment the
   * connection goes away, so an offline start never spends the full budget.
   */
  static async #waitForCloudLogin(timeoutMs = 15000, stepMs = 500) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (game.beneos?.cloud?.isLoggedIn?.()) return true
      if (BeneosWhatsNewWindow.#isOffline()) return false
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

    // Shop entries are paid for and therefore always reachable, whatever the
    // Patreon situation is. Only the release card can hold locked rows.
    const isShopCard = card?.kind === "shop"
    const access = this.#campaignAccess()

    const entries = (card?.bucket?.items ?? []).map(entry => {
      const type = toModuleType(entry.type)
      return {
        key: entry.key,
        name: entry.name || entry.key,
        type,
        locked: !isShopCard && entry.owned !== true,
        typeLabel: game.i18n.localize(TYPE_LABEL_KEY[type] ?? ""),
        thumbnail: this.#thumbnailFor(type, entry.key, entry.thumbnailUrl, catalogFor)
      }
    })

    // One timeline across the whole card: every heading and every entry gets an
    // absolute delay, so the browser plays them in written order without the
    // window having to drive the sequence from JavaScript.
    const step = REVEAL_STEP
    let clock = REVEAL_START
    const groups = []
    for (const group of GROUPS) {
      const items = entries.filter(e => e.type === group.type)
      if (!items.length) continue
      const titleDelay = clock
      clock += REVEAL_TITLE_HOLD
      for (const item of items) {
        item.delay = clock
        clock += step
      }
      // The campaign flag answers the common case ("you support the other
      // Patreon"); the per-entry check catches the rarer one, where someone is
      // in the right campaign but on a tier that does not cover this drop.
      const hasCampaign = isShopCard || access[group.campaign] === true
      groups.push({
        title: game.i18n.localize(group.titleKey),
        isWide: group.wide,
        titleDelay,
        items,
        showJoin: !hasCampaign || items.some(item => item.locked),
        showLogin: !isShopCard && !access.loggedIn,
        joinUrl: CAMPAIGN_URL[group.campaign]
      })
    }

    // The Patreon headline is a thank-you, and it only holds if the whole card
    // is in fact a download for this account. One locked row already makes it
    // false: a card that says "new downloads for your Patreon support" over a
    // list of covers with locks on them tells the reader the opposite of what
    // they can see.
    const thanksForSupport = access.loggedIn && !entries.some(entry => entry.locked)
    let headlineKey = "BENEOS.Cloud.WhatsNew.PublicHeadline"
    let sublineKey = "BENEOS.Cloud.WhatsNew.PublicSubline"
    if (isShopCard) {
      headlineKey = "BENEOS.Cloud.WhatsNew.ShopHeadline"
      sublineKey = "BENEOS.Cloud.WhatsNew.ShopSubline"
    } else if (thanksForSupport) {
      headlineKey = "BENEOS.Cloud.WhatsNew.PatreonHeadline"
      sublineKey = "BENEOS.Cloud.WhatsNew.PatreonSubline"
    }

    const overflow = card?.bucket?.overflow ?? 0
    return {
      kind: card?.kind ?? "patreon",
      groups,
      overflowDelay: clock,
      headline: game.i18n.localize(headlineKey),
      subline: game.i18n.localize(sublineKey),
      joinLabel: game.i18n.localize("BENEOS.Cloud.WhatsNew.JoinPatreon"),
      loginLabel: game.i18n.localize("BENEOS.Cloud.WhatsNew.LoginToDownload"),
      lockedLabel: game.i18n.localize("BENEOS.Cloud.WhatsNew.Locked"),
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

  /**
   * Which of the two Patreon campaigns this account supports.
   *
   * Read from the module's own cloud singleton, not from the popup payload: it
   * already keeps these flags, persisted from the login response, and a second
   * source for the same fact would be a second thing to keep in step.
   *
   * Logged out forces both to false. The flags survive a restart on purpose, so
   * a world whose account signed out would otherwise still claim the support of
   * whoever was signed in last.
   */
  #campaignAccess() {
    const loggedIn = !!this.payload?.loggedIn
    const cloud = game.beneos?.cloud
    const has = (campaign) => {
      if (!loggedIn) return false
      try { return cloud?.hasCampaignAccess?.(campaign) === true }
      catch (_e) { return false }
    }
    return { loggedIn, battlemaps: has("battlemaps"), tokens: has("tokens") }
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
    // Both sounds belong to the card, not to the window: they play again when
    // the second card comes up.
    BeneosWhatsNewWindow.#playSfx(SFX_OPEN, SFX_VOLUME_OPEN)
    this.#scheduleSpawnSounds()
    this.#releasePopAfterLanding()
    this.#settleScrollbar()
  }

  /**
   * One sound per unlock, fired on the same schedule the CSS uses, so the note
   * lands with the pop rather than in a burst at the end.
   *
   * The timers are owned by the window and cleared before every render and on
   * close. Without that, advancing to the shop card or closing the window early
   * would leave the previous card's notes playing into an empty screen.
   *
   * Locked entries stay silent. The note is the reward for having unlocked
   * something; sounding it over content the account cannot reach would spend the
   * reward on a disappointment, and it is what separates the two kinds of row
   * here as clearly as the lock mark does.
   */
  #scheduleSpawnSounds() {
    this.#clearSpawnSounds()
    this.spawnTimers = []
    const nodes = this.element?.querySelectorAll?.('[data-action="whatsNewOpen"]:not(.is-locked)') ?? []
    for (const node of nodes) {
      const delay = parseInt(node.style.getPropertyValue("--bwn-d"), 10)
      if (!Number.isFinite(delay)) continue
      this.spawnTimers.push(setTimeout(() => {
        // Quieter than the opening note: two dozen of these in a row should
        // read as a run of small rewards, not as an alarm.
        BeneosWhatsNewWindow.#playSfx(SFX_SPAWN, SFX_VOLUME_SPAWN)
      }, Math.max(0, delay)))
    }
  }

  /**
   * Drop the reveal class once an entry has landed.
   *
   * Two reasons, and the first is a real defect rather than housekeeping: the
   * pop runs with fill-mode both, so its final transform stays applied forever
   * and silently wins over the hover lift, which would never move. Removing the
   * class hands the element back to normal styling. It also releases the
   * compositor layer the reveal asked for, which there is no reason to keep.
   */
  #releasePopAfterLanding() {
    for (const node of this.element?.querySelectorAll?.(".bwn-pop") ?? []) {
      node.addEventListener("animationend", event => {
        if (event.animationName !== "bwn-pop-in") return
        node.classList.remove("bwn-pop")
        node.style.willChange = "auto"
      }, { once: false })
    }
  }

  /**
   * Decide the scrollbar once, before the reveal starts.
   *
   * Left to `overflow-y: auto` the browser re-decides on every frame, and a
   * popping entry is briefly larger than its final size: just enough to grow
   * the scroll area, flash a scrollbar in, and shift the whole card sideways
   * for a few frames. Measured with the list clipped, so the transient size of
   * the animation cannot influence the answer, only the finished layout can.
   *
   * The entries already occupy their space while still invisible (the reveal
   * fills backwards), so the finished height is known from the first frame.
   */
  #settleScrollbar() {
    const list = this.element?.querySelector?.(".bwn-list")
    if (!list) return
    const decide = () => {
      list.classList.remove("is-scrolling")
      if (list.scrollHeight > list.clientHeight + 1) list.classList.add("is-scrolling")
    }
    decide()
    // A second pass after layout has settled: covers wrap their titles onto a
    // second line at some window widths, which changes the answer.
    requestAnimationFrame(() => requestAnimationFrame(decide))
  }

  #clearSpawnSounds() {
    for (const timer of this.spawnTimers ?? []) clearTimeout(timer)
    this.spawnTimers = []
  }

  _onClose(options) {
    this.#clearSpawnSounds()
    super._onClose?.(options)
  }

  /**
   * Play a sound once the file has been confirmed to exist. The probe runs once
   * per file per session and the answer is remembered: without it a module build
   * that ships without a sound would log an audio error for every card, and for
   * the spawn note for every single unlock, which is a lot of noise for
   * something purely decorative.
   */
  static #playSfx(src, volume) {
    // Only a missing file silences playback, and that is decided by asking the
    // server for it, once. A failed preload must never silence anything: it can
    // fail for reasons that have nothing to do with the file being there, and
    // treating that as "missing" turned the whole window mute.
    if (sfxAvailable.get(src) === false) return
    const play = () => {
      try {
        const helper = foundry.audio?.AudioHelper
        if (helper?.play) helper.play({ src, volume, autoplay: true, loop: false }, false)
      } catch (_e) { /* no audio context yet */ }
    }
    if (sfxAvailable.get(src) === true) { play(); return }
    fetch(src, { method: "HEAD" })
      .then(response => {
        sfxAvailable.set(src, response.ok)
        if (response.ok) play()
        else console.debug(`[Beneos What's New] sound missing, staying silent: ${src}`)
      })
      .catch(() => { /* leave undecided, try again next time */ })
  }

  /**
   * Load both sounds into the audio cache before the window opens.
   *
   * Without this the notes do not follow the reveal, they arrive in a heap: the
   * first play triggers the fetch and decode, every play started while that is
   * still running waits on the same buffer, and they all fire together the
   * moment it resolves. Preloading makes each timed play immediate, which is
   * what turns the run of unlocks into a click, click, click.
   *
   * Purely an optimisation. A preload that fails says nothing about whether the
   * file exists, so it is swallowed and playback still goes ahead; the timing
   * is then merely as good as the browser manages on its own.
   */
  static async #preloadSfx() {
    const helper = foundry.audio?.AudioHelper
    if (!helper?.preloadSound) return
    await Promise.all([SFX_OPEN, SFX_SPAWN].map(src =>
      Promise.resolve()
        .then(() => helper.preloadSound(src))
        .catch(err => console.debug(`[Beneos What's New] preload skipped for ${src}:`, err?.message ?? err))
    ))
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
    try { await ackWhatsNew(this.payload?.serverTime, { loggedIn: !!this.payload?.loggedIn }) }
    catch (err) { console.warn("[Beneos What's New] Acknowledge failed:", err) }
    await this.close()
  }

  /**
   * Open the Patreon campaign this group belongs to. The window stays open and
   * the cursor stays put: someone who steps out to look at a campaign page
   * should come back to the rest of the list, and should see it again next
   * world start if they never got round to confirming it.
   */
  static _onJoinCampaign(event, target) {
    event.preventDefault()
    const url = target?.dataset?.url
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }

  /** Open the cloud login. Same reasoning as above: window and cursor untouched. */
  static _onLogin(event, _target) {
    event.preventDefault()
    try { new BeneosCloudLogin("whatsNew").render(true) }
    catch (err) { console.warn("[Beneos What's New] Could not open the login:", err) }
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
