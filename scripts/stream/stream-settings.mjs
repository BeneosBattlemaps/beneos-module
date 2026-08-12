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
}

const DEFAULT_BASE = "https://gate.beneos.stream"

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

/** The address of one asset of one release variant. */
export function assetUrl(release, variant, path) {
  const clean = String(path).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")
  return `${streamBase()}/a/${encodeURIComponent(streamKey())}/${encodeURIComponent(release)}/${encodeURIComponent(variant)}/${clean}`
}
