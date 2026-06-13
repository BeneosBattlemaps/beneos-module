/* =============================================================
   Beneos Magic Shop Generator — Punkt 3 v2.

   Sister modal to BeneosLootGenerator. Rolls a complete inventory
   for a magic shop based on shop size (Small / Medium / Large),
   with guaranteed healing potions and a one-click "save to world"
   pipeline that installs every shop item and sorts them into a
   `Beneos Shop / <Shop-Name> / <price-bracket>` folder tree.

   Re-uses the loot-generator's roll helpers (rarity weights, tier
   shift, common-filter, healing detection) so both modals stay in
   sync if balance values change.
   ============================================================= */

import { BeneosUtility } from "../beneos_utility.js"
import {
  RARITY_WEIGHTS, RARITY_ORDER, RARITY_COLOR_CLASS, TIER_SHIFT,
  weightedPick, randomChoice, extractRarity, itemTier,
  isHealingPotion, commonAllowed
} from "./loot-generator.mjs"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

// Shop-size definitions. `tierMix` is a weighted distribution over
// tier-pools (Tier 1-4) the non-healing items roll from. `slots` is a
// {min,max} range for total slot count; `healing` for guaranteed
// healing potions. `cash` is the shopkeeper's gold-on-hand (Punkt 3
// v3-fix), used when players want to SELL items to the shop.
const SHOP_SIZES = {
  small: {
    labelKey: "BENEOS.MagicShop.Size.Small",
    subKey: "BENEOS.MagicShop.Size.SmallSub",
    icon: "fa-solid fa-cart-shopping",
    slots:   { min: 4, max: 6 },
    healing: { min: 1, max: 2 },
    cash:    { min: 100,  max: 500 },
    tierMix: { 1: 75, 2: 25 }
  },
  medium: {
    labelKey: "BENEOS.MagicShop.Size.Medium",
    subKey: "BENEOS.MagicShop.Size.MediumSub",
    icon: "fa-solid fa-shop",
    slots:   { min: 8, max: 12 },
    healing: { min: 2, max: 4 },
    cash:    { min: 500,  max: 3000 },
    tierMix: { 1: 15, 2: 60, 3: 25 }
  },
  large: {
    labelKey: "BENEOS.MagicShop.Size.Large",
    subKey: "BENEOS.MagicShop.Size.LargeSub",
    icon: "fa-solid fa-building-columns",
    slots:   { min: 15, max: 20 },
    healing: { min: 4, max: 6 },
    cash:    { min: 3000, max: 15000 },
    tierMix: { 2: 15, 3: 60, 4: 25 }
  }
}

// Punkt 3 v3 — discovery + filtering helpers for the shop-type step.
// `properties.shop` is a string-array on each item record listing the
// shop categories (`magic_shop`, `weapon_shop`, `black_market`, …) the
// item belongs to. Items without the array are excluded from any shop.
function discoverShopTypes(allItems) {
  const set = new Set()
  for (const [, it] of allItems) {
    const tags = it?.properties?.shop
    if (Array.isArray(tags)) tags.forEach(t => t && set.add(String(t)))
  }
  return [...set].sort()
}

function shopLabel(snake) {
  return String(snake || "")
    .split("_")
    .map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : "")
    .join(" ")
    .trim()
}

function matchesShop(item, shopType) {
  const tags = item?.properties?.shop
  if (!Array.isArray(tags)) return false
  return tags.includes(shopType)
}

// Punkt 3 v4: number of "default inventory" items rolled per shop.
// Rendered as 2 rows × 5 columns above the special-items section.
const DEFAULT_ITEM_COUNT = 10

// Folder bracket buckets for the save-shop pipeline. Matches the user
// direction: Under 100 / 500 / 1000 / 5000 / 10000 / Over 10000.
function priceBracket(price) {
  const p = Number(price) || 0
  if (p < 100)   return "Under 100 gp"
  if (p < 500)   return "Under 500 gp"
  if (p < 1000)  return "Under 1000 gp"
  if (p < 5000)  return "Under 5000 gp"
  if (p < 10000) return "Under 10000 gp"
  return "Over 10000 gp"
}

function rollIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export class BeneosMagicShopGenerator extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-magic-shop-generator",
    classes: ["beneos-loot-generator", "beneos-magic-shop", "beneos_module"],
    tag: "section",
    window: {
      title: "BENEOS.MagicShop.WindowTitle",
      icon: "fa-solid fa-shop",
      resizable: true,
      minimizable: true
    },
    position: { width: 820, height: "auto" },
    actions: {
      pickShopType:    BeneosMagicShopGenerator._onPickShopType,
      pickSize:        BeneosMagicShopGenerator._onPickSize,
      reroll:          BeneosMagicShopGenerator._onReroll,
      restart:         BeneosMagicShopGenerator._onRestart,
      saveShop:        BeneosMagicShopGenerator._onSaveShop,
      installPick:     BeneosMagicShopGenerator._onInstallPick,
      removeSlot:      BeneosMagicShopGenerator._onRemoveSlot,
      rollSlot:        BeneosMagicShopGenerator._onRollSlot,
      openItem:        BeneosMagicShopGenerator._onOpenItem,
      addDefaultSlot:  BeneosMagicShopGenerator._onAddDefaultSlot,
      addSpecialSlot:  BeneosMagicShopGenerator._onAddSpecialSlot
    }
  }

  static PARTS = {
    body: { template: "modules/beneos-module/templates/cloud-v2/parts/magic-shop-generator.hbs" }
  }

  constructor(options = {}) {
    super(options)
    try { game.beneos?.analytics?.track("feature_used", { feature: "magic-shop" }); } catch (_) {}
    // Punkt 3 v3: 4 steps: Type, Size+Name, Loading, Result
    this.step = 1
    this.shopType = null           // Punkt 3 v3: e.g. "magic_shop"
    this.size = null               // "small" | "medium" | "large"
    this.shopName = ""
    this.items = []                // [{ itemKey, item, kind: "healing"|"loot", rarity, price }] — special items (rolled per slot)
    this.defaultItems = []         // Punkt 3 v4: 10 Uncommon/Common items always-stocked for this shop type.
    this.shopCash = 0              // Punkt 3 v3-fix: gold-on-hand for buy-back from players.
    this.deliveredKeys = new Set() // Punkt 3 v5: itemKeys dragged onto a sheet — visually grayed in the list.
    this.poolWarning = null        // Punkt 3 v5: "default" | "special" | null — surfaced as a red inline message.
    this.rolling = false
    this.rerollCount = 0
    this.saving = false
  }

  get title() {
    return game.i18n.localize("BENEOS.MagicShop.WindowTitle") || "Beneos Magic Shop"
  }

  /* ---------- View prep ---------- */

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options)
    ctx.step = this.step
    ctx.isStep1 = this.step === 1   // shop-type picker
    ctx.isStep2 = this.step === 2   // size + name
    ctx.isStep3 = this.step === 3   // loading
    ctx.isStep4 = this.step === 4   // result
    ctx.rolling = this.rolling
    ctx.rerollCount = this.rerollCount
    ctx.shopName = this.shopName
    ctx.shopNamePlaceholder = this.#suggestShopName()

    // Shop-type discovery — re-run on every render so a freshly-loaded
    // DB picks up new tags without needing to reopen the wizard.
    const allItems = this.#allItems()
    const types = discoverShopTypes(allItems)
    ctx.shopTypes = types.map(t => ({
      key: t,
      label: shopLabel(t),
      selected: this.shopType === t
    }))
    ctx.hasShopTypes = types.length > 0
    ctx.shopType = this.shopType
    ctx.shopTypeLabel = this.shopType ? shopLabel(this.shopType) : null

    ctx.sizes = Object.entries(SHOP_SIZES).map(([key, def]) => ({
      key, ...def,
      label: game.i18n.localize(def.labelKey),
      sub: game.i18n.localize(def.subKey),
      selected: this.size === key
    }))
    ctx.size = this.size ? SHOP_SIZES[this.size] : null

    // Punkt 3 v4: Special-Items + Default-Items as two separate
    // sections; Roleplay (atmosphere) sweep was removed per User-
    // Direktive — the new Default Inventory replaces it conceptually.
    ctx.itemCount = this.items.length
    ctx.totalGold = this.items.reduce((sum, x) => sum + (Number(x.item?.properties?.price) || 0), 0)
    ctx.totalGoldFormatted = ctx.totalGold ? ctx.totalGold.toLocaleString("en-US") : "0"
    ctx.items = this.items.map((x, idx) => this.#enrichItem(x, idx, "special"))
    ctx.defaultItems = this.defaultItems.map((x, idx) => this.#enrichItem(x, idx, "default"))
    ctx.hasDefaultItems = this.defaultItems.length > 0
    ctx.shopCash = this.shopCash
    ctx.shopCashFormatted = this.shopCash ? this.shopCash.toLocaleString("en-US") : "0"
    ctx.saving = this.saving
    ctx.poolWarningDefault = this.poolWarning === "default"
    ctx.poolWarningSpecial = this.poolWarning === "special"
    const typeLabel = this.shopType ? shopLabel(this.shopType) : "Misc"
    ctx.saveTooltip = game.i18n.format("BENEOS.MagicShop.SaveTooltip", {
      path: `${typeLabel} / ${this.shopName || this.#suggestShopName()}`
    })
    // Patreon gate: only active Creatures/Spells/Loot (tokens) patrons can use
    // the generator; everyone else sees the controls blurred behind a join CTA.
    ctx.hasTokenAccess = !!game.beneos?.cloud?.hasCampaignAccess?.("tokens")
    ctx.joinPatreonUrl = "https://www.patreon.com/c/BeneosTokens"
    return ctx
  }

  #enrichItem(x, idx, section = "special") {
    const item = x.item
    const props = item?.properties || {}
    const rarity = x.rarity || extractRarity(item) || "Common"
    const isInstalled = !!BeneosUtility.isItemLoaded?.(x.itemKey)
    const thumbUrl = props.icon
      ? `https://www.beneos-database.com/data/items/thumbnails/${props.icon}`
      : null
    const priceN = Number(props.price) || 0
    const priceLabel = priceN ? priceN.toLocaleString("en-US") + " gp" : "—"
    const description = this.#trimDescription(item?.description)
    return {
      slotIdx: idx,
      section,                                // "special" | "default"
      itemKey: x.itemKey,
      name: item?.name || x.itemKey,
      thumbUrl,
      rarity,
      rarityClass: RARITY_COLOR_CLASS[rarity] || "",
      itemTier: x.tier || itemTier(item),
      itemType: props.item_type || "",
      price: priceLabel,
      bracket: priceBracket(priceN),
      description,
      tooltipHtml: this.#richTooltip(item?.name || x.itemKey, priceLabel, description),
      isHealing: x.kind === "healing",
      isInstalled,
      isDelivered: this.deliveredKeys.has(x.itemKey)
    }
  }

  // Punkt 3 v5: build a small HTML tooltip — bold name + price on the
  // first line, description below. Foundry V13's TooltipManager renders
  // basic HTML inside data-tooltip attributes.
  #richTooltip(name, priceLabel, description) {
    const safe = (s) => String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
    const head = priceLabel
      ? `<strong>${safe(name)}</strong> &middot; ${safe(priceLabel)}`
      : `<strong>${safe(name)}</strong>`
    const body = description ? `<p>${safe(description)}</p>` : ""
    return `${head}${body}`
  }

  #trimDescription(desc) {
    if (!desc || typeof desc !== "string") return null
    const t = desc.trim()
    if (t.length <= 600) return t
    return t.slice(0, 580).trimEnd() + "…"
  }

  #suggestShopName() {
    // Punkt 3 v5b: name sequence is now scoped per shop-type so the
    // tree `Beneos Shop / Traveling Merchant / Shop 1` and
    // `Beneos Shop / Weaponsmith / Shop 1` are independent.
    const typeLabel = this.shopType ? shopLabel(this.shopType) : "Misc"
    let max = 0
    for (const f of game.folders ?? []) {
      if (f.type !== "Item") continue
      if (f.folder?.name !== typeLabel) continue
      if (f.folder?.folder?.name !== "Beneos Shop") continue
      const m = /^Shop\s+(\d+)$/i.exec(f.name)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return `Shop ${max + 1}`
  }

  /* ---------- Actions ---------- */

  // Punkt 3 v3: Step 1 — pick the shop type (filters all subsequent
  // pools by `properties.shop` containing this key). Auto-advances to
  // size selection.
  static async _onPickShopType(event, target) {
    const key = target?.dataset?.shopType
    if (!key) return
    this.shopType = key
    this.step = 2
    await this.render({ parts: ["body"] })
  }

  static async _onPickSize(event, target) {
    const key = target?.dataset?.size
    if (!SHOP_SIZES[key]) return
    this.size = key
    // Capture the shop-name input before re-rendering.
    const input = this.element?.querySelector("#blg-shop-name")
    if (input) this.shopName = input.value.trim()
    this.step = 3
    this.rolling = true
    this.items = []
    this.defaultItems = []
    this.deliveredKeys = new Set()
    this.poolWarning = null
    this.rerollCount = 0
    await this.render({ parts: ["body"] })
    await this.#runRoll()
  }

  static async _onReroll(event, target) {
    if (this.rolling || this.saving) return
    this.rolling = true
    // Punkt 3 v4: switch back to the loading step so the Stocking
    // animation re-runs. #runRoll moves us to step 4 again on completion.
    this.step = 3
    this.items = []
    this.defaultItems = []
    this.deliveredKeys = new Set()
    this.poolWarning = null
    this.shopCash = 0
    this.rerollCount += 1
    await this.render({ parts: ["body"] })
    await this.#runRoll()
  }

  static async _onRestart(event, target) {
    if (this.saving) return
    // Capture shop name from input before restart so it survives.
    const input = this.element?.querySelector("#blg-shop-name")
    if (input) this.shopName = input.value.trim()
    this.step = 1
    this.shopType = null
    this.size = null
    this.items = []
    this.defaultItems = []
    this.shopCash = 0
    this.deliveredKeys = new Set()
    this.poolWarning = null
    this.rolling = false
    this.rerollCount = 0
    await this.render({ parts: ["body"] })
  }

  static async _onRollSlot(event, target) {
    if (this.rolling || this.saving) return
    const idx = Number(target?.dataset?.slotIdx)
    if (Number.isNaN(idx)) return
    const slot = this.items[idx]
    if (!slot) return
    if (slot.kind === "healing") {
      // Re-roll among the healing pool only.
      const all = this.#allItems()
      const pick = this.#rollOneHealing(all, this.items, idx)
      if (pick) this.items[idx] = pick
    } else {
      const all = this.#allItems()
      const pick = this.#rollOneLoot(all, this.items, idx)
      if (pick) this.items[idx] = pick
    }
    await this.render({ parts: ["body"] })
  }

  static async _onRemoveSlot(event, target) {
    if (this.rolling || this.saving) return
    const idx = Number(target?.dataset?.slotIdx)
    if (Number.isNaN(idx)) return
    this.items.splice(idx, 1)
    await this.render({ parts: ["body"] })
  }

  static async _onInstallPick(event, target) {
    const key = target?.dataset?.itemKey
    if (!key) return
    try {
      await game.beneos?.cloud?.importItemFromCloud?.(key, event)
      await this.render({ parts: ["body"] })
    } catch (err) {
      console.warn("[Beneos MagicShop] install failed", key, err)
    }
  }

  // Punkt 3 v5: click-to-open-sheet on the card root. Inner buttons
  // (installPick / removeSlot / rollSlot) win the closest-action
  // resolution, so this only fires when the user clicks the card body.
  static async _onOpenItem(event, target) {
    const key = target?.dataset?.itemKey
    if (!key) return
    if (!BeneosUtility.isItemLoaded?.(key)) {
      try {
        await game.beneos?.cloud?.importItemFromCloud?.(key, event)
      } catch (err) {
        console.warn("[Beneos MagicShop] click-install failed", key, err)
      }
    }
    if (!BeneosUtility.isItemLoaded?.(key)) {
      ui.notifications?.warn?.(game.i18n.localize("BENEOS.LootGen.Notify.InstallFailed"))
      return
    }
    const doc = game.items?.find?.(d => d.getFlag?.("world", "beneos")?.itemKey === key)
    if (doc) doc.sheet.render(true)
    await this.render({ parts: ["body"] })
  }

  // Punkt 3 v5: Plus-Button on the Default-Inventory section. Pulls
  // one more Uncommon (or Common fallback) from the shop pool. Sets a
  // poolWarning flag when the pool is exhausted so the template can
  // show a red message.
  static async _onAddDefaultSlot(event, target) {
    if (this.rolling || this.saving) return
    const all = this.#allItems().filter(([, it]) => matchesShop(it, this.shopType))
    const used = new Set([...this.items, ...this.defaultItems].map(x => x.itemKey))
    const tryRoll = (rarities) => {
      const pool = all.filter(([k, it]) => !used.has(k) && rarities.includes(extractRarity(it)))
      if (!pool.length) return null
      const pick = randomChoice(pool)
      return {
        itemKey: pick[0], item: pick[1], kind: "default",
        rarity: extractRarity(pick[1]) || "Common",
        tier: itemTier(pick[1])
      }
    }
    const pick = tryRoll(["Uncommon"]) || tryRoll(["Common"])
    if (!pick) {
      this.poolWarning = "default"
    } else {
      this.poolWarning = null
      this.defaultItems.push(pick)
    }
    await this.render({ parts: ["body"] })
  }

  // Punkt 3 v5: Plus-Button on the Special-Items section. Re-uses the
  // same per-slot loot-roll logic the initial #runRoll uses.
  static async _onAddSpecialSlot(event, target) {
    if (this.rolling || this.saving) return
    const all = this.#allItems().filter(([, it]) => matchesShop(it, this.shopType))
    const pick = this.#rollOneLoot(all, [...this.items, ...this.defaultItems])
    if (!pick) {
      this.poolWarning = "special"
    } else {
      this.poolWarning = null
      this.items.push(pick)
    }
    await this.render({ parts: ["body"] })
  }

  static async _onSaveShop(event, target) {
    if (this.rolling || this.saving) return
    // Punkt 3 v4: roleplay/atmosphere items are gone. Both special
    // items and default-inventory items are persisted to the world.
    const tradeableCount = this.items.length + this.defaultItems.length
    if (!tradeableCount) {
      ui.notifications.warn(game.i18n.localize("BENEOS.MagicShop.NoItems") || "Shop is empty.")
      return
    }
    const inputName = this.element?.querySelector("#blg-shop-name")?.value?.trim()
    const shopName = inputName || this.#suggestShopName()
    this.shopName = shopName

    // Confirm before bulk-importing — the import is async and noticeable.
    const total = tradeableCount
    const typeLabel = this.shopType ? shopLabel(this.shopType) : "Misc"
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("BENEOS.MagicShop.SaveConfirmTitle") || "Save Magic Shop" },
      content: `<p>${game.i18n.format("BENEOS.MagicShop.SaveConfirmBody", { count: total, name: `${typeLabel} / ${shopName}` })}</p>`,
      rejectClose: false,
      modal: true
    })
    if (!confirmed) return

    this.saving = true
    await this.render({ parts: ["body"] })
    try {
      await this.#saveToWorld(shopName)
      ui.notifications.info(game.i18n.format("BENEOS.MagicShop.SaveSuccess", { name: `${typeLabel} / ${shopName}`, count: total }))
    } catch (err) {
      console.error("[Beneos MagicShop] save failed", err)
      ui.notifications.error(game.i18n.localize("BENEOS.MagicShop.SaveFailed") || "Saving the shop failed. See console.")
    } finally {
      this.saving = false
      await this.render({ parts: ["body"] })
    }
  }

  /* ---------- Roll pipeline ---------- */

  async #runRoll() {
    await this.#sleep(2500)
    const allDb = this.#allItems()
    // Punkt 3 v3: pre-filter by shop-type so every subsequent pool draws
    // only from items tagged for this shop. Falls back to the full DB
    // if shopType is unset (defensive — shouldn't happen with the new
    // step flow).
    const all = this.shopType
      ? allDb.filter(([, it]) => matchesShop(it, this.shopType))
      : allDb
    const def = SHOP_SIZES[this.size]
    const slots = rollIntInclusive(def.slots.min, def.slots.max)
    const healingCount = Math.min(rollIntInclusive(def.healing.min, def.healing.max), slots)
    const items = []

    // 1) Fill healing-potion slots.
    for (let i = 0; i < healingCount; i++) {
      const pick = this.#rollOneHealing(all, items)
      if (pick) items.push(pick)
    }

    // 2) Fill remaining slots with loot rolls scoped to the shop's tier mix.
    while (items.length < slots) {
      const pick = this.#rollOneLoot(all, items)
      if (!pick) break
      items.push(pick)
    }

    this.items = items
    // Punkt 3 v4: Default Inventory — 10 Uncommon/Common items the
    //   shop always carries. Replaces the v3 Roleplay/Atmosphere
    //   sweep which the user judged out of place once we split the
    //   inventory into Default + Special.
    this.defaultItems = this.#rollDefaultItems(all, items)
    // Punkt 3 v3-fix: shop's cash on hand for buying back from PCs.
    this.shopCash = this.#rollShopCash()
    this.step = 4
    this.rolling = false
    await this.render({ parts: ["body"] })
  }

  // Random shopkeeper-cash within the size's range, rounded to 10 gp.
  #rollShopCash() {
    const range = SHOP_SIZES[this.size]?.cash || SHOP_SIZES.small.cash
    const raw = range.min + Math.random() * (range.max - range.min)
    return Math.round(raw / 10) * 10
  }

  // Punkt 3 v4: 10 unique Uncommon items from the shop pool, falling
  // back to Common to fill the slate when Uncommon is too thin.
  #rollDefaultItems(allShopItems, currentItems) {
    const used = new Set(currentItems.map(c => c.itemKey))
    const filterRarity = (rarities) => allShopItems.filter(([k, it]) =>
      !used.has(k) && rarities.includes(extractRarity(it))
    )
    let pool = filterRarity(["Uncommon"])
    if (pool.length < DEFAULT_ITEM_COUNT) {
      const seen = new Set(pool.map(([k]) => k))
      const commonPool = filterRarity(["Common"]).filter(([k]) => !seen.has(k))
      pool = pool.concat(commonPool)
    }
    if (!pool.length) return []
    const shuffled = [...pool].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, DEFAULT_ITEM_COUNT).map(([k, it]) => ({
      itemKey: k,
      item: it,
      kind: "default",
      rarity: extractRarity(it) || "Common",
      tier: itemTier(it)
    }))
  }

  #allItems() {
    const content = game.beneos?.databaseHolder?.itemData?.content
    if (!content) return []
    return Object.entries(content)
  }

  // Roll a healing potion appropriate for the shop tier mix. Skips
  // duplicates already in the shop (or excludes a specific slot when
  // re-rolling that slot in place).
  #rollOneHealing(allItems, currentItems, replaceIdx = -1) {
    const def = SHOP_SIZES[this.size]
    const targetTier = weightedPick(def.tierMix)
    const usedKeys = new Set(currentItems.filter((_, i) => i !== replaceIdx).map(x => x.itemKey))
    let pool = allItems.filter(([k, it]) => isHealingPotion(it) && !usedKeys.has(k))
    if (!pool.length) return null
    // Prefer a potion whose tier matches the shop tier; fall back if no exact match.
    const matched = pool.filter(([, it]) => itemTier(it) === Number(targetTier))
    const selected = matched.length ? matched : pool
    const pick = randomChoice(selected)
    return {
      itemKey: pick[0],
      item: pick[1],
      kind: "healing",
      rarity: extractRarity(pick[1]) || "Common",
      tier: itemTier(pick[1])
    }
  }

  // Roll one non-healing loot item using the shop's tier mix as the target
  // tier, modulated by the standard tier-shift table for Rare+ rolls.
  // Rarity weights match the loot-generator's "normal" preset.
  #rollOneLoot(allItems, currentItems, replaceIdx = -1) {
    const def = SHOP_SIZES[this.size]
    const usedKeys = new Set(currentItems.filter((_, i) => i !== replaceIdx).map(x => x.itemKey))
    const all = allItems.filter(([k, it]) => commonAllowed(it) && !usedKeys.has(k) && !isHealingPotion(it))
    if (!all.length) return null

    let attempts = 0
    while (attempts < 60) {
      attempts++
      const rarity = weightedPick(RARITY_WEIGHTS.normal)
      const baseTier = Number(weightedPick(def.tierMix))
      let realTier = baseTier
      const isHigh = RARITY_ORDER.indexOf(rarity) >= RARITY_ORDER.indexOf("Rare")
      if (isHigh) {
        realTier = Number(weightedPick(TIER_SHIFT[baseTier])) || baseTier
      }
      let pool = all.filter(([, it]) => extractRarity(it) === rarity && itemTier(it) === realTier)
      if (!pool.length && isHigh) pool = all.filter(([, it]) => extractRarity(it) === rarity)
      if (!pool.length) pool = all.filter(([, it]) => extractRarity(it) === rarity)
      if (!pool.length) continue
      const pick = randomChoice(pool)
      return {
        itemKey: pick[0],
        item: pick[1],
        kind: "loot",
        rarity,
        tier: realTier
      }
    }
    // Last-resort fallback: anything from the trimmed pool.
    const pick = randomChoice(all)
    if (!pick) return null
    return {
      itemKey: pick[0],
      item: pick[1],
      kind: "loot",
      rarity: extractRarity(pick[1]) || "Common",
      tier: itemTier(pick[1])
    }
  }

  /* ---------- Save pipeline ---------- */

  async #saveToWorld(shopName) {
    // Punkt 3 v4: persist both special items and default inventory.
    const tradeable = [...this.items, ...this.defaultItems]

    // 1) Install every item that isn't already in the world.
    const toInstallKeys = []
    for (const x of tradeable) {
      if (!BeneosUtility.isItemLoaded?.(x.itemKey)) {
        toInstallKeys.push(x.itemKey)
      }
    }
    for (const key of toInstallKeys) {
      try {
        await game.beneos.cloud.importItemFromCloud(key, null)
      } catch (err) {
        console.warn("[Beneos MagicShop] install failed for", key, err)
      }
    }

    // 2) Resolve the world Item documents we just created (or that already
    //    existed) so we can move them into the shop folder tree.
    const worldDocs = []
    for (const x of tradeable) {
      const doc = game.items?.find?.(d => d.getFlag?.("world", "beneos")?.itemKey === x.itemKey)
      if (doc) worldDocs.push({ doc, slot: x })
    }

    // 3) Ensure the per-bracket folders exist + move docs.
    // Punkt 3 v5b: insert the shop-type as an extra level so the
    // campaign-wide tree is `Beneos Shop / <Type> / <Name> / <Bracket>`.
    const typeLabel = this.shopType ? shopLabel(this.shopType) : "Misc"
    for (const { doc, slot } of worldDocs) {
      const price = Number(slot.item?.properties?.price) || 0
      const bracket = priceBracket(price)
      const leaf = await BeneosUtility.ensureBeneosFolderPath?.(
        { type: "Item", scope: "world" },
        ["Beneos Shop", typeLabel, shopName, bracket]
      )
      if (leaf?.id && doc.folder?.id !== leaf.id) {
        try { await doc.update({ folder: leaf.id }) }
        catch (err) { console.warn("[Beneos MagicShop] folder assign failed for", doc.name, err) }
      }
    }
  }

  /* ---------- Helpers ---------- */

  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /* ---------- Render-time hooks ---------- */

  _onRender(context, options) {
    super._onRender?.(context, options)
    const root = this.element
    if (!root) return
    // Punkt 3 v4: drag-handle for ALL shop items — installed cards use
    // the Punkt-1 V13-compendium resolver, uninstalled cards emit the
    // cloud-pending phantom payload that the Wave-B-1d/B-9 hooks in
    // beneos_module.js (`dropActorSheetData` / `dropCanvasData`) catch
    // and turn into a real install + character-sheet add. Bypasses the
    // "Install → search again → add to actor" detour.
    root.querySelectorAll(".blg-shop-item").forEach(card => {
      card.addEventListener("dragstart", (e) => {
        const key = card.dataset.itemKey
        if (!key) return
        const installed = card.classList.contains("is-installed")
        let payload
        if (installed) {
          payload = BeneosUtility.resolveBeneosDragData?.("Item", key)
          if (!payload) {
            ui.notifications?.warn?.(game.i18n.localize("BENEOS.Cloud.Notification.OrphanInstall") || "Asset unavailable.")
            e.preventDefault()
            return
          }
        } else {
          payload = {
            type: "Item",
            beneosCloudPending: true,
            beneosItemKey: key,
            beneosAssetKind: "item"
          }
        }
        e.dataTransfer.setData("text/plain", JSON.stringify(payload))
      })
      // Punkt 3 v5: track successful drops so the card can be grayed.
      card.addEventListener("dragend", (e) => {
        const key = card.dataset.itemKey
        if (!key) return
        if (e.dataTransfer?.dropEffect && e.dataTransfer.dropEffect !== "none") {
          this.deliveredKeys.add(key)
          this.render({ parts: ["body"] })
        }
      })
    })
    // Stagger reveal once the result is in (step 4 after #runRoll).
    if (this.step === 4 && !this.rolling && (this.items.length || this.defaultItems.length)) {
      const cards = root.querySelectorAll(".blg-shop-item")
      cards.forEach((card, idx) => {
        setTimeout(() => card.classList.add("blg-reveal"), idx * 50)
      })
    }
  }
}
