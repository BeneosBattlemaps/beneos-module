/* =============================================================
   Beneos Loot Generator — Punkt 3.

   Standalone ApplicationV2 modal that rolls 3 random magic items
   from the Beneos cloud item database with a Baldur's-Gate-3-style
   reveal: bias selector → tier selector → loading bar → staggered
   card reveal with rarity glow + legendary banner.

   Roll spec (see plan punkt-3 for derivation):
   - Rarity is rolled with bias-adjusted weights (lower / normal / higher).
   - For Rare+ rolls a tier-shift step picks the actual item-tier (95/5
     at the edges, 90/5/5 in the middle).
   - Common/Uncommon ignore tier — they pass through any tier band.
   - Items without an explicit `properties.tier` fall back to a
     DMG-style price-band classification (≤500 / ≤5k / ≤50k / >50k gp).
   ============================================================= */

import { BeneosUtility } from "../beneos_utility.js"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

export const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary"]

// Rarity-roll weights per bias preset (Punkt 3 v2 distribution). Common
// is intentionally heavy reduced — pre-v2 had 50/30/15/4/1 but Common
// items below 30 gp (buckets, rations, …) felt like noise in a magic
// loot table, so weight migrates to Uncommon and Rare. Common items
// that DO roll get filtered to ≥30 gp anyway (see `#commonAllowed`).
export const RARITY_WEIGHTS = {
  lower:  { Common: 40, Uncommon: 40, Rare: 14, "Very Rare": 4,  Legendary: 2 },
  normal: { Common: 25, Uncommon: 45, Rare: 22, "Very Rare": 6,  Legendary: 2 },
  higher: { Common: 10, Uncommon: 35, Rare: 35, "Very Rare": 14, Legendary: 6 }
}

// Minimum gold value a Common item must carry to be considered for the
// magic-loot pool. Filters out trivial mundane Commons (buckets, rope,
// rations) per User-Direktive.
export const COMMON_MIN_PRICE = 30

// Tier-Shift table (only consulted for Rare+ rolls). Edge tiers (1, 4)
// are skewed 95/5; mid tiers 90/5/5.
export const TIER_SHIFT = {
  1: { 1: 95, 2: 5 },
  2: { 1: 5,  2: 90, 3: 5 },
  3: { 2: 5,  3: 90, 4: 5 },
  4: { 3: 5,  4: 95 }
}

// Gold-hoard ranges per tier (loose DMG-style hoard scaling).
export const GOLD_HOARD = {
  1: { min: 50,    max: 500   },
  2: { min: 500,   max: 3000  },
  3: { min: 3000,  max: 15000 },
  4: { min: 15000, max: 60000 }
}

// Punkt 3 v3-fix: expected total item value for the 3 magic items at
// each tier. Used to balance the gold roll inversely — when the rolled
// items happened to be above expectation, gold drops; when below, gold
// rises. Keeps the total reward (items + gold) steadier per tier.
export const TIER_EXPECTED_ITEM_TOTAL = {
  1: 300,
  2: 4000,
  3: 30000,
  4: 150000
}

// Treasure-price caps per tier (max single-treasure value).
export const TREASURE_PRICE_CAP = { 1: 100, 2: 500, 3: 2500, 4: 10000 }

// Punkt 3 v3-fix: chance of a "Wondrous Twist" — a single bonus item
// of `item_type` containing "wondrous", shown in its own celebrated
// slot above the regular 3 loot items.
export const WONDROUS_TWIST_CHANCE = 0.40

export function isWondrousItem(item) {
  const type = String(item?.properties?.item_type || "").toLowerCase()
  return /wondrous/.test(type)
}

// Heuristic to detect treasures (gems, art, trinkets) in the item DB.
const TREASURE_TYPE_RE = /^(treasure|trinket|gem|art|valuable|loot)$/i
const TREASURE_NAME_RE = /(gem|pearl|sapphire|ruby|emerald|diamond|amethyst|jewel|art\s+object|gold\s*piece|silver\s*piece|trinket)/i

export function isTreasureItem(item) {
  const type = String(item?.properties?.item_type || "").trim()
  if (TREASURE_TYPE_RE.test(type)) return true
  const name = String(item?.name || "")
  return TREASURE_NAME_RE.test(name)
}

// Heuristic to detect healing potions for the Magic-Shop guarantee.
export function isHealingPotion(item) {
  const type = String(item?.properties?.item_type || "").toLowerCase()
  const name = String(item?.name || "").toLowerCase()
  return /potion/.test(type) && /heal/.test(name)
}

export function extractRarity(item) {
  const raw = item?.properties?.rarity
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  if (s === "veryrare" || s === "very-rare" || s === "very_rare") return "Very Rare"
  return RARITY_ORDER.find(r => r.toLowerCase() === s) || null
}

export function itemTier(item) {
  const t = Number(item?.properties?.tier)
  if ([1, 2, 3, 4].includes(t)) return t
  const price = Number(item?.properties?.price) || 0
  if (price <= 500)   return 1
  if (price <= 5000)  return 2
  if (price <= 50000) return 3
  return 4
}

export function weightedPick(weights) {
  const entries = Object.entries(weights || {})
  const total = entries.reduce((a, [, v]) => a + v, 0)
  if (total <= 0) return entries[0]?.[0]
  let r = Math.random() * total
  for (const [k, v] of entries) {
    r -= v
    if (r <= 0) return k
  }
  return entries[entries.length - 1][0]
}

export function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// True if this item is acceptable for the rarity pool. Common items
// without a price ≥ COMMON_MIN_PRICE are filtered out.
export function commonAllowed(item) {
  const rarity = extractRarity(item)
  if (rarity !== "Common") return true
  return Number(item?.properties?.price || 0) >= COMMON_MIN_PRICE
}

export const RARITY_COLOR_CLASS = {
  "Common":     "blg-rarity-common",
  "Uncommon":   "blg-rarity-uncommon",
  "Rare":       "blg-rarity-rare",
  "Very Rare":  "blg-rarity-veryrare",
  "Legendary":  "blg-rarity-legendary"
}

const TIER_DEFS = [
  { tier: 1, levels: "1–4",   tagKey: "BENEOS.LootGen.TierTag.Apprentice", icon: "fa-solid fa-shield" },
  { tier: 2, levels: "5–10",  tagKey: "BENEOS.LootGen.TierTag.Heroic",     icon: "fa-solid fa-helmet-battle" },
  { tier: 3, levels: "11–16", tagKey: "BENEOS.LootGen.TierTag.Paragon",    icon: "fa-solid fa-crown" },
  { tier: 4, levels: "17–20", tagKey: "BENEOS.LootGen.TierTag.Epic",       icon: "fa-solid fa-star" }
]

const BIAS_DEFS = [
  { key: "lower",  labelKey: "BENEOS.LootGen.Bias.Lower",  icon: "fa-solid fa-arrow-trend-down" },
  { key: "normal", labelKey: "BENEOS.LootGen.Bias.Normal", icon: "fa-solid fa-scale-balanced" },
  { key: "higher", labelKey: "BENEOS.LootGen.Bias.Higher", icon: "fa-solid fa-arrow-trend-up" }
]

export class BeneosLootGenerator extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-loot-generator",
    classes: ["beneos-loot-generator", "beneos_module"],
    tag: "section",
    window: {
      title: "BENEOS.LootGen.WindowTitle",
      icon: "fa-solid fa-dice-d20",
      resizable: false,
      minimizable: true
    },
    position: { width: 720, height: "auto" },
    actions: {
      pickBias:    BeneosLootGenerator._onPickBias,
      goNext:      BeneosLootGenerator._onGoNext,
      pickTier:    BeneosLootGenerator._onPickTier,
      reroll:      BeneosLootGenerator._onReroll,
      restart:     BeneosLootGenerator._onRestart,
      installPick: BeneosLootGenerator._onInstallPick,
      claimGold:   BeneosLootGenerator._onClaimGold,
      openItem:    BeneosLootGenerator._onOpenItem,
      addLootSlot: BeneosLootGenerator._onAddLootSlot
    }
  }

  static PARTS = {
    body: { template: "modules/beneos-module/templates/cloud-v2/parts/loot-generator.hbs" }
  }

  constructor(options = {}) {
    super(options)
    try { game.beneos?.analytics?.track("feature_used", { feature: "loot-generator" }); } catch (_) {}
    this.step = 1
    this.bias = null
    this.tier = null
    this.results = []
    this.gold = 0
    this.treasures = []
    this.wondrous = null
    this.deliveredKeys = new Set()  // Punkt 3 v5: itemKeys dragged onto a sheet — visually grayed in the result list.
    this.poolWarning = null         // Punkt 3 v5b: "loot" when Add-Loot-Slot exhausts the matching pool.
    this.rerollCount = 0
    this.rolling = false
  }

  get title() {
    return game.i18n.localize("BENEOS.LootGen.WindowTitle") || "Beneos Loot Generator"
  }

  /* ---------- View prep ---------- */

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options)
    ctx.step = this.step
    ctx.isStep1 = this.step === 1
    ctx.isStep2 = this.step === 2
    ctx.isStep3 = this.step === 3
    ctx.bias = this.bias
    ctx.tier = this.tier
    ctx.rolling = this.rolling
    ctx.rerollCount = this.rerollCount
    ctx.biases = BIAS_DEFS.map(b => ({
      ...b,
      label: game.i18n.localize(b.labelKey),
      selected: this.bias === b.key,
      tooltip: this.#biasTooltip(b.key)
    }))
    ctx.tiers = TIER_DEFS.map(t => ({ ...t, tag: game.i18n.localize(t.tagKey), selected: this.tier === t.tier }))
    ctx.results = this.results.map(r => this.#enrichResult(r))
    ctx.hasLegendary = this.results.some(r => r.rolledRarity === "Legendary")
    ctx.hasVeryRare  = this.results.some(r => r.rolledRarity === "Very Rare")
    ctx.canGoNext = this.bias !== null
    ctx.gold = this.gold
    ctx.goldFormatted = this.gold ? this.gold.toLocaleString("en-US") : null
    ctx.treasures = this.treasures.map(t => this.#enrichTreasure(t))
    ctx.hasHoard = this.gold > 0 || this.treasures.length > 0
    ctx.wondrous = this.wondrous ? this.#enrichResult(this.wondrous) : null
    ctx.hasWondrous = !!this.wondrous
    ctx.poolWarningLoot = this.poolWarning === "loot"
    // Patreon gate: only active Creatures/Spells/Loot (tokens) patrons can use
    // the generator; everyone else sees the controls blurred behind a join CTA.
    ctx.hasTokenAccess = !!game.beneos?.cloud?.hasCampaignAccess?.("tokens")
    ctx.joinPatreonUrl = "https://www.patreon.com/c/BeneosTokens"
    return ctx
  }

  #biasTooltip(key) {
    const w = RARITY_WEIGHTS[key]
    if (!w) return ""
    return RARITY_ORDER.map(r => `${this.#fmtPct(w[r])} ${r}`).join(" · ")
  }

  #fmtPct(n) {
    if (n < 1) return `${n.toFixed(1)} %`
    if (Number.isInteger(n)) return `${n} %`
    return `${n.toFixed(1)} %`
  }

  #enrichResult(r) {
    const item = r.item
    const itemKey = r.itemKey
    const props = item?.properties || {}
    const rarity = r.rolledRarity
    const isInstalled = !!BeneosUtility.isItemLoaded?.(itemKey)
    const thumbUrl = props.icon
      ? `https://www.beneos-database.com/data/items/thumbnails/${props.icon}`
      : null
    const probabilityPct = this.#computeProbability(r)
    let crossTierMarker = null
    if (RARITY_ORDER.indexOf(rarity) >= RARITY_ORDER.indexOf("Rare")) {
      if (r.rolledTier > this.tier)      crossTierMarker = "up"
      else if (r.rolledTier < this.tier) crossTierMarker = "down"
    }
    return {
      itemKey,
      name: item?.name || itemKey,
      thumbUrl,
      rarity,
      rarityClass: RARITY_COLOR_CLASS[rarity] || "",
      itemTier: r.rolledTier,
      origin: props.origin || "",
      itemType: props.item_type || "",
      price: props.price ? Number(props.price).toLocaleString("en-US") + " gp" : "",
      // Punkt 3 v2: description from the Beneos item DB record (top-level
      // `description` field, see cloud-window-v2.mjs:1192). Used as the
      // hover-tooltip on result cards.
      description: this.#trimDescription(item?.description),
      // Punkt 3 v5: rich HTML tooltip — bold name + price, then desc.
      tooltipHtml: this.#richTooltip(
        item?.name || itemKey,
        props.price ? Number(props.price).toLocaleString("en-US") + " gp" : null,
        this.#trimDescription(item?.description)
      ),
      // Punkt 3 v5: drag-done greyout flag.
      isDelivered: this.deliveredKeys.has(itemKey),
      probabilityPct: this.#fmtPct(probabilityPct),
      probabilityRaw: probabilityPct,
      crossTierMarker,
      isInstalled,
      isFallbackBucket: !!r.isFallback,
      isLegendary: rarity === "Legendary",
      isVeryRare: rarity === "Very Rare"
    }
  }

  #enrichTreasure(t) {
    const item = t.item
    const props = item?.properties || {}
    const isInstalled = !!BeneosUtility.isItemLoaded?.(t.itemKey)
    const thumbUrl = props.icon
      ? `https://www.beneos-database.com/data/items/thumbnails/${props.icon}`
      : null
    const priceLabel = props.price ? Number(props.price).toLocaleString("en-US") + " gp" : ""
    const description = this.#trimDescription(item?.description)
    return {
      itemKey: t.itemKey,
      name: item?.name || t.itemKey,
      thumbUrl,
      price: priceLabel,
      description,
      tooltipHtml: this.#richTooltip(item?.name || t.itemKey, priceLabel || null, description),
      isInstalled,
      isDelivered: this.deliveredKeys.has(t.itemKey)
    }
  }

  // Trim long Beneos descriptions for tooltip display. Foundry's tooltip
  // renders long text gracefully, but we cap to avoid runaway tooltips
  // on items with multi-paragraph fluff.
  #trimDescription(desc) {
    if (!desc || typeof desc !== "string") return null
    const trimmed = desc.trim()
    if (trimmed.length <= 600) return trimmed
    return trimmed.slice(0, 580).trimEnd() + "…"
  }

  // Punkt 3 v5: HTML tooltip — bold name + price line, description below.
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

  // Approximate probability of pulling THIS rarity at THIS tier (without
  // factoring the item-pool size — that's a flat random within the bucket).
  // Goal is an honest "this was unlikely" signal for the DM.
  #computeProbability(r) {
    const w = RARITY_WEIGHTS[this.bias] || RARITY_WEIGHTS.normal
    const rarityPct = w[r.rolledRarity] ?? 0
    if (RARITY_ORDER.indexOf(r.rolledRarity) < RARITY_ORDER.indexOf("Rare")) {
      return rarityPct
    }
    const tierTable = TIER_SHIFT[this.tier] || {}
    const totalT = Object.values(tierTable).reduce((a, b) => a + b, 0) || 1
    const tierPct = (tierTable[r.rolledTier] ?? 0) / totalT * 100
    return rarityPct * tierPct / 100
  }

  /* ---------- Actions ---------- */

  static async _onPickBias(event, target) {
    const key = target?.dataset?.bias
    if (!key || !RARITY_WEIGHTS[key]) return
    this.bias = key
    // Punkt 3 v3: auto-advance to the tier step — the explicit Next-
    // button felt like an unnecessary gate per User-Direktive.
    this.step = 2
    await this.render({ parts: ["body"] })
  }

  static async _onGoNext(event, target) {
    if (this.step === 1 && this.bias) {
      this.step = 2
      await this.render({ parts: ["body"] })
    }
  }

  static async _onPickTier(event, target) {
    const t = Number(target?.dataset?.tier)
    if (![1, 2, 3, 4].includes(t)) return
    this.tier = t
    this.step = 3
    this.rolling = true
    this.results = []
    this.gold = 0
    this.treasures = []
    this.wondrous = null
    this.deliveredKeys = new Set()
    this.poolWarning = null
    this.rerollCount = 0
    await this.render({ parts: ["body"] })
    await this.#runRoll()
  }

  static async _onReroll(event, target) {
    if (this.rolling) return
    this.rolling = true
    this.results = []
    this.gold = 0
    this.treasures = []
    this.wondrous = null
    this.deliveredKeys = new Set()
    this.poolWarning = null
    this.rerollCount += 1
    await this.render({ parts: ["body"] })
    await this.#runRoll()
  }

  static async _onRestart(event, target) {
    this.step = 1
    this.bias = null
    this.tier = null
    this.results = []
    this.gold = 0
    this.treasures = []
    this.wondrous = null
    this.deliveredKeys = new Set()
    this.poolWarning = null
    this.rerollCount = 0
    this.rolling = false
    await this.render({ parts: ["body"] })
  }

  static async _onInstallPick(event, target) {
    const key = target?.dataset?.itemKey
    if (!key) return
    try {
      await game.beneos?.cloud?.importItemFromCloud?.(key, event)
      // Re-render so the card flips to drag-mode after install.
      await this.render({ parts: ["body"] })
    } catch (err) {
      console.warn("[Beneos LootGen] install failed", key, err)
    }
  }

  // Punkt 3 v5b: Plus-Button under the result grid — adds another
  // loot slot using the same bias + tier-shift mechanic as the initial
  // roll. No upper limit; DM uses it to top up underwhelming rolls.
  // Sets `poolWarning = "loot"` when the pool is fully exhausted.
  static async _onAddLootSlot(event, target) {
    if (this.rolling) return
    const all = this.#allItems()
    const used = [
      ...this.results,
      ...(this.wondrous ? [this.wondrous] : []),
      ...this.treasures
    ]
    const pick = this.#rollOneLootItem(all, used)
    if (!pick) {
      this.poolWarning = "loot"
    } else {
      this.poolWarning = null
      this.results.push(pick)
    }
    await this.render({ parts: ["body"] })
  }

  // Single-item version of #rollThree. Walks the same rarity-weight
  // and tier-shift logic, but returns one slot or null when no item
  // matches even the relaxed-fallback pools.
  #rollOneLootItem(allInput, currentResults) {
    const all = (allInput || this.#allItems()).filter(([, it]) => commonAllowed(it))
    if (!all.length) return null
    const usedKeys = new Set(currentResults.map(r => r.itemKey))
    let attempts = 0
    while (attempts < 100) {
      attempts++
      const rarity = weightedPick(RARITY_WEIGHTS[this.bias])
      const isHigh = RARITY_ORDER.indexOf(rarity) >= RARITY_ORDER.indexOf("Rare")
      let tier = null
      let pool
      let isFallback = false
      if (isHigh) {
        tier = weightedPick(TIER_SHIFT[this.tier])
        pool = all.filter(([k, it]) =>
          !usedKeys.has(k) && extractRarity(it) === rarity && itemTier(it) === Number(tier)
        )
        if (!pool.length) {
          pool = all.filter(([k, it]) => !usedKeys.has(k) && extractRarity(it) === rarity)
          isFallback = true
        }
      } else {
        pool = all.filter(([k, it]) => !usedKeys.has(k) && extractRarity(it) === rarity)
      }
      if (!pool.length) continue
      const pick = randomChoice(pool)
      return {
        itemKey: pick[0],
        item: pick[1],
        rolledRarity: rarity,
        rolledTier: tier ?? itemTier(pick[1]),
        isFallback
      }
    }
    // Final relax: any item the user hasn't seen yet.
    const leftover = all.filter(([k]) => !usedKeys.has(k))
    if (!leftover.length) return null
    const pick = randomChoice(leftover)
    return {
      itemKey: pick[0],
      item: pick[1],
      rolledRarity: extractRarity(pick[1]) || "Common",
      rolledTier: itemTier(pick[1]),
      isFallback: true
    }
  }

  // Punkt 3 v5: click on a result card opens the item-sheet, auto-
  // installing first if needed. Inner buttons (installPick / claimGold)
  // win the closest-action resolution.
  static async _onOpenItem(event, target) {
    const key = target?.dataset?.itemKey
    if (!key) return
    if (!BeneosUtility.isItemLoaded?.(key)) {
      try {
        await game.beneos?.cloud?.importItemFromCloud?.(key, event)
      } catch (err) {
        console.warn("[Beneos LootGen] click-install failed", key, err)
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

  // Punkt 3 v4: claim the rolled gold on a target actor. Picks the
  // first selected token's actor, falls back to the user's bound
  // character. Adds to system.currency.gp (dnd5e). Other systems get
  // a defensive warning rather than a silent no-op.
  static async _onClaimGold(event, target) {
    if (!this.gold) return
    if (game.system?.id !== "dnd5e") {
      ui.notifications?.warn?.(game.i18n.format("BENEOS.LootGen.Notify.SystemRequired", { system: game.system?.id ?? "unknown" }))
      return
    }
    const tokenActor = canvas.tokens?.controlled?.[0]?.actor
    const userChar  = game.user?.character
    const actor = tokenActor || userChar
    if (!actor) {
      ui.notifications?.warn?.(game.i18n.localize("BENEOS.LootGen.NoTargetActor") || "Select a token or set your User Character first.")
      return
    }
    const path = "system.currency.gp"
    const current = Number(foundry.utils.getProperty(actor, path)) || 0
    const claimed = this.gold
    try {
      await actor.update({ [path]: current + claimed })
      ui.notifications?.info?.(game.i18n.format(
        "BENEOS.LootGen.GoldAdded",
        { amount: claimed, name: actor.name }
      ) || `${claimed} gp added to ${actor.name}.`)
      this.gold = 0
      await this.render({ parts: ["body"] })
    } catch (err) {
      console.warn("[Beneos LootGen] claim-gold failed", err)
      ui.notifications?.error?.(game.i18n.localize("BENEOS.LootGen.Notify.GoldAddFailed"))
    }
  }

  /* ---------- Roll pipeline ---------- */

  async #runRoll() {
    // Pacing: ~2.5 s loading, then results render. The CSS keyframe
    // drives the visual fill; we wait the same duration here so the
    // reveal lines up with the bar finishing.
    await this.#sleep(2500)
    const all = this.#allItems()
    this.results = this.#rollThree(all)
    // Punkt 3 v3-fix: gold scales inversely with the rolled item value
    // — a high-roll on items pulls gold down, a low-roll pulls it up.
    const itemTotal = this.results.reduce(
      (sum, r) => sum + (Number(r.item?.properties?.price) || 0), 0
    )
    this.gold = this.#rollGoldHoard(itemTotal)
    this.treasures = this.#rollTreasures(all)
    this.wondrous = this.#rollWondrousTwist(all, this.results)
    this.rolling = false
    await this.render({ parts: ["body"] })
  }

  // Punkt 3 v3-fix: gold roll balanced against the actual item value of
  // the loot pulled. Ratio ~ expected/actual; clamped to [0.5..2.0]
  // and mapped onto the tier's gold range. A small jitter keeps two
  // identical-item rolls from producing identical gold.
  #rollGoldHoard(actualItemTotal = 0) {
    const range = GOLD_HOARD[this.tier] || GOLD_HOARD[1]
    const expected = TIER_EXPECTED_ITEM_TOTAL[this.tier] || range.max
    const actual = Math.max(actualItemTotal || 1, 1)
    const ratio = expected / actual
    const clamped = Math.max(0.5, Math.min(2.0, ratio))
    let factor = (clamped - 0.5) / 1.5    // 0..1
    factor += (Math.random() - 0.5) * 0.2 // ±0.1 jitter
    factor = Math.max(0, Math.min(1, factor))
    const raw = range.min + factor * (range.max - range.min)
    return Math.round(raw / 10) * 10
  }

  // Punkt 3 v3-fix: optional bonus slot — a single Wondrous Item shown
  // in its own celebrated section. Rolled with WONDROUS_TWIST_CHANCE
  // probability; pool is items whose `item_type` contains "wondrous".
  #rollWondrousTwist(allItems, currentResults) {
    if (Math.random() > WONDROUS_TWIST_CHANCE) return null
    const used = new Set(currentResults.map(r => r.itemKey))
    const pool = allItems.filter(([k, it]) => !used.has(k) && isWondrousItem(it))
    if (!pool.length) return null
    const pick = randomChoice(pool)
    return {
      itemKey: pick[0],
      item: pick[1],
      rolledRarity: extractRarity(pick[1]) || "Uncommon",
      rolledTier: itemTier(pick[1]),
      isFallback: false
    }
  }

  // Roll 0-2 treasures appropriate for the selected tier. Treasures are
  // detected via item_type / name heuristics; price-capped per tier so
  // the hoard scales with party tier.
  #rollTreasures(allItems) {
    const cap = TREASURE_PRICE_CAP[this.tier] || TREASURE_PRICE_CAP[1]
    const pool = allItems.filter(([, it]) => {
      if (!isTreasureItem(it)) return false
      const price = Number(it?.properties?.price) || 0
      return price > 0 && price <= cap
    })
    if (!pool.length) return []
    const count = Math.floor(Math.random() * 3) // 0, 1, or 2
    const out = []
    const seen = new Set()
    let attempts = 0
    while (out.length < count && attempts < 20 && pool.length > out.length) {
      attempts++
      const pick = randomChoice(pool)
      if (seen.has(pick[0])) continue
      seen.add(pick[0])
      out.push({ itemKey: pick[0], item: pick[1] })
    }
    return out
  }

  #rollThree(allInput) {
    const all = (allInput || this.#allItems()).filter(([, it]) => commonAllowed(it))
    if (!all.length) return []
    const out = []
    let attempts = 0
    while (out.length < 3 && attempts < 100) {
      attempts++
      const rarity = weightedPick(RARITY_WEIGHTS[this.bias])
      let tier = null
      let pool = null
      let isFallback = false
      const isHighRarity = RARITY_ORDER.indexOf(rarity) >= RARITY_ORDER.indexOf("Rare")
      if (isHighRarity) {
        tier = weightedPick(TIER_SHIFT[this.tier])
        pool = all.filter(([, it]) => extractRarity(it) === rarity && itemTier(it) === Number(tier))
        if (!pool.length) {
          // Fallback 1: ignore tier-shift, accept any tier for this rarity.
          pool = all.filter(([, it]) => extractRarity(it) === rarity)
          isFallback = true
        }
      } else {
        pool = all.filter(([, it]) => extractRarity(it) === rarity)
      }
      if (!pool.length) continue
      // Diversity soft-preference: avoid 3 identical item_types if possible.
      let pick = randomChoice(pool)
      if (out.length === 2) {
        const sameTypes = out.every(o => (o.item.properties?.item_type || "") === (pick[1].properties?.item_type || ""))
        if (sameTypes) {
          const diverse = pool.filter(([, it]) => (it.properties?.item_type || "") !== (out[0].item.properties?.item_type || ""))
          if (diverse.length) pick = randomChoice(diverse)
        }
      }
      // Unique-3-Roll
      if (out.some(o => o.itemKey === pick[0])) continue
      out.push({
        itemKey: pick[0],
        item: pick[1],
        rolledRarity: rarity,
        rolledTier: tier ?? itemTier(pick[1]),
        isFallback
      })
    }
    // Final fallback: if we still don't have 3 (very thin DB), drop
    // whatever rarity/tier we still need from any item.
    while (out.length < 3 && all.length) {
      const pick = randomChoice(all)
      if (out.some(o => o.itemKey === pick[0])) {
        if (all.length <= out.length) break
        continue
      }
      const rarity = extractRarity(pick[1]) || "Common"
      out.push({
        itemKey: pick[0],
        item: pick[1],
        rolledRarity: rarity,
        rolledTier: itemTier(pick[1]),
        isFallback: true
      })
    }
    return out
  }

  #allItems() {
    const content = game.beneos?.databaseHolder?.itemData?.content
    if (!content) return []
    return Object.entries(content)
  }

  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /* ---------- Render-time hooks ---------- */

  _onRender(context, options) {
    super._onRender?.(context, options)
    const root = this.element
    if (!root) return
    // Punkt 3 v4: drag wiring covers all result + wondrous cards.
    // Installed cards emit a V13-compendium UUID via the Punkt-1
    // resolver; uninstalled cards emit the Wave-B-9 cloud-pending
    // phantom payload so the dropActorSheetData/dropCanvasData hooks
    // in beneos_module.js install the item on-drop and add it to the
    // target sheet automatically.
    root.querySelectorAll(".blg-result-card").forEach(card => {
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
    // Punkt 3 v5b: hoard treasures (gems / jewels) get the same
    // drag/install pipeline as result cards.
    root.querySelectorAll(".blg-hoard-treasure").forEach(pill => {
      pill.addEventListener("dragstart", (e) => {
        const key = pill.dataset.itemKey
        if (!key) return
        const installed = pill.classList.contains("is-installed")
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
      pill.addEventListener("dragend", (e) => {
        const key = pill.dataset.itemKey
        if (!key) return
        if (e.dataTransfer?.dropEffect && e.dataTransfer.dropEffect !== "none") {
          this.deliveredKeys.add(key)
          this.render({ parts: ["body"] })
        }
      })
    })
    // Punkt 3 v5b: gold pile drag — emits an on-the-fly dnd5e loot
    // item so character sheets can accept it as inventory. Non-dnd5e
    // systems get a defensive abort with a friendly notification.
    const goldEl = root.querySelector(".blg-hoard-gold")
    if (goldEl) {
      goldEl.addEventListener("dragstart", (e) => {
        if (!this.gold) { e.preventDefault(); return }
        if (game.system?.id !== "dnd5e") {
          ui.notifications?.warn?.(game.i18n.localize("BENEOS.LootGen.Notify.GoldDragSystem"))
          e.preventDefault()
          return
        }
        const payload = {
          type: "Item",
          data: {
            name: `${this.gold} gp`,
            type: "loot",
            img: "icons/commodities/currency/coins-stitched-pouch-brown.webp",
            system: {
              identified: true,
              quantity: 1,
              price: { value: this.gold, denomination: "gp" }
            }
          }
        }
        e.dataTransfer.setData("text/plain", JSON.stringify(payload))
      })
      goldEl.addEventListener("dragend", (e) => {
        if (e.dataTransfer?.dropEffect && e.dataTransfer.dropEffect !== "none") {
          this.gold = 0
          this.render({ parts: ["body"] })
        }
      })
    }
    // Stagger reveal: the .blg-reveal class triggers the drop animation.
    if (this.step === 3 && !this.rolling && this.results.length) {
      const cards = root.querySelectorAll(".blg-result-card:not(.blg-wondrous-card)")
      cards.forEach((card, idx) => {
        setTimeout(() => card.classList.add("blg-reveal"), idx * 250)
      })
      // Wondrous card reveals after the main 3-card stagger finishes.
      const wondrous = root.querySelector(".blg-wondrous-card")
      if (wondrous) setTimeout(() => wondrous.classList.add("blg-reveal"), 750)
    }
  }
}
