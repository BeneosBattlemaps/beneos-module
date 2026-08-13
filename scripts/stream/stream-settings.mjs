/**
 * Settings for the streaming beta.
 *
 * All world-scoped, all hidden from the settings sheet, all GM-only, following
 * the pattern of `beneos-cloud-base-url` in beneos_utility.js. Hidden because a
 * beta switch has no business in a customer's options list, and world-scoped
 * because the addresses live in that world's documents.
 *
 * The main switch defaults to OFF. With it off, every code path in scripts/stream
 * returns immediately and the module behaves exactly as it does on main.
 */

export const MODULE_ID = "beneos-module"

export const SETTING = {
  mode: "beneos-stream-mode",
  key: "beneos-stream-key",
  base: "beneos-stream-base",
  localCache: "beneos-stream-local-cache",
  acknowledged: "beneos-stream-backup-acknowledged",
  pinStills: "beneos-stream-pin-stills",
  budgetImage: "beneos-stream-budget-image",
  budgetVideo: "beneos-stream-budget-video",
  budgetAudio: "beneos-stream-budget-audio",
  budgetDraw: "beneos-stream-budget-draw",
  maxConcurrent: "beneos-stream-max-concurrent",
}

const DEFAULT_BASE = "https://gate.beneos.stream"

// Seconds, not milliseconds: these are numbers an operator reads and changes at
// a table, and a value in milliseconds invites a factor-of-a-thousand mistake.
const DEFAULT_BUDGET = { image: 30, video: 120, audio: 60, draw: 45 }

// Foundry never sets one, so every asset of a scene starts at once. On a wide
// line that is right; on a narrow one it makes each single file slower and
// bursts the budget on a line that would have sufficed.
const DEFAULT_MAX_CONCURRENT = 6

const VIDEO_EXT = /\.(webm|mp4|ogv|m4v)(\?|$)/i
const AUDIO_EXT = /\.(ogg|mp3|wav|flac|opus|m4a)(\?|$)/i

export function registerStreamSettings() {
  const world = { scope: "world", config: false, restricted: true }

  game.settings.register(MODULE_ID, SETTING.mode, {
    name: "Beneos Stream mode",
    hint: "Beta. Installs scenes without their heavy media and fetches it at play time.",
    ...world, type: Boolean, default: false,
  })

  game.settings.register(MODULE_ID, SETTING.key, {
    name: "Beneos Stream key",
    hint: "The beta key handed out by Beneos. Without it nothing is delivered.",
    ...world, type: String, default: "",
  })

  game.settings.register(MODULE_ID, SETTING.base, {
    name: "Beneos Stream gate",
    hint: "Address of the delivery gate.",
    ...world, type: String, default: DEFAULT_BASE,
  })

  game.settings.register(MODULE_ID, SETTING.localCache, {
    name: "Keep streamed media in the browser store",
    hint: "Speeds up a second visit and survives a short loss of connection.",
    ...world, type: Boolean, default: true,
  })

  // Existing worlds are allowed in the beta, so the first activation has to be
  // deliberate. This remembers that it was.
  game.settings.register(MODULE_ID, SETTING.acknowledged, {
    name: "Backup acknowledged",
    ...world, type: Boolean, default: false,
  })

  // Off is the pure form: nothing but the documents lands on the customer's
  // disk. On installs the pictures a scene needs in order to draw at all, which
  // the manifest marks per file with `pin`. Off first, on purpose: the pure
  // form gets measured before any compromise is made, and the switch exists so
  // that comparing the two costs a reload rather than a re-publish.
  game.settings.register(MODULE_ID, SETTING.pinStills, {
    name: "Install the pictures a scene needs to draw",
    hint: "Off streams everything. On keeps still images and scene backgrounds local.",
    ...world, type: Boolean, default: false,
  })

  for (const [what, seconds] of Object.entries(DEFAULT_BUDGET)) {
    game.settings.register(MODULE_ID, SETTING[`budget${what[0].toUpperCase()}${what.slice(1)}`], {
      name: `Beneos Stream budget, ${what} (seconds)`,
      hint: "0 switches the deadline off, which is what Foundry does by itself.",
      ...world, type: Number, default: seconds,
    })
  }

  game.settings.register(MODULE_ID, SETTING.maxConcurrent, {
    name: "Beneos Stream, parallel requests per scene",
    hint: "0 leaves it to Foundry, which starts every asset of a scene at once.",
    ...world, type: Number, default: DEFAULT_MAX_CONCURRENT,
  })
}

const read = (key, fallback) => {
  try { return game.settings.get(MODULE_ID, key) } catch (_) { return fallback }
}

/** Is the beta switched on AND usable? A mode without a key delivers nothing. */
export function streamEnabled() {
  return Boolean(read(SETTING.mode, false)) && Boolean(read(SETTING.key, ""))
}

export function streamKey() {
  return String(read(SETTING.key, "") || "").trim()
}

export function streamBase() {
  return String(read(SETTING.base, DEFAULT_BASE) || DEFAULT_BASE).replace(/\/+$/, "")
}

export function localCacheEnabled() {
  return Boolean(read(SETTING.localCache, true))
}

/** Host of the gate, used to decide which requests this module may touch. */
export function streamHost() {
  try { return new URL(streamBase()).host } catch (_) { return "" }
}

export function pinStillsEnabled() {
  return Boolean(read(SETTING.pinStills, false))
}

const seconds = (key, fallback) => {
  const value = Number(read(key, fallback))
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

/** How long this one file may take, in milliseconds. 0 means no deadline. */
export function budgetFor(url) {
  const path = String(url || "").split("#")[0]
  if (VIDEO_EXT.test(path)) return seconds(SETTING.budgetVideo, DEFAULT_BUDGET.video) * 1000
  if (AUDIO_EXT.test(path)) return seconds(SETTING.budgetAudio, DEFAULT_BUDGET.audio) * 1000
  return seconds(SETTING.budgetImage, DEFAULT_BUDGET.image) * 1000
}

/** How long a whole scene may take to draw before the watchdog steps in. */
export function drawBudget() {
  return seconds(SETTING.budgetDraw, DEFAULT_BUDGET.draw) * 1000
}

export function maxConcurrent() {
  return seconds(SETTING.maxConcurrent, DEFAULT_MAX_CONCURRENT)
}

/** The address of one asset of one release variant. */
export function assetUrl(release, variant, path) {
  const clean = String(path).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")
  return `${streamBase()}/a/${encodeURIComponent(streamKey())}/${encodeURIComponent(release)}/${encodeURIComponent(variant)}/${clean}`
}
