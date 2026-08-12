/**
 * Entry point of the Beneos Stream beta.
 *
 * Everything hangs in the `init` hook. That is early enough: the canvas draws
 * after `ready`, so the fetch redirection and the PIXI flag are in place before
 * a single texture is asked for, and settings are readable there.
 *
 * This is the ONLY file of the beta referenced from module.json. With the main
 * switch off, `installStreamFetch` returns immediately, nothing is patched, and
 * the module runs exactly as it does on main. That is the whole point of the
 * branch: a tester can go back by pointing the manifest at main again.
 */

import { registerStreamSettings, streamEnabled, streamKey, streamBase, streamHost } from "./stream-settings.mjs"
import { installStreamFetch, storeStatus, clearStore, prewarm } from "./stream-fetch.mjs"
import { betaMayRun, ensureAcknowledged } from "./stream-guard.mjs"
import { loadStreamManifest, buildStreamPack, applyStreamAddresses, streamUrlsOf, releaseFromPackage } from "./stream-install.mjs"
import { reportedSoFar } from "./stream-report.mjs"

Hooks.once("init", () => {
  registerStreamSettings()

  // Only patch when the switch is on. An off beta must cost nothing, not even
  // a wrapped fetch.
  if (streamEnabled()) installStreamFetch()

  // The installer reaches for this rather than importing the beta directly, so
  // the live code path keeps no hard dependency on a beta module.
  const api = {
    enabled: () => streamEnabled(),
    mayRun: () => betaMayRun(),
    host: () => streamHost(),
    base: () => streamBase(),
    ensureAcknowledged,
    releaseFromPackage,
    loadStreamManifest,
    buildStreamPack,
    applyStreamAddresses,
    streamUrlsOf,
    prewarm,
    storeStatus,
    clearStore,
    reportedSoFar,
  }
  globalThis.BeneosStream = api
  game.beneos = game.beneos || {}
  game.beneos.stream = api
})

Hooks.once("ready", async () => {
  if (!streamEnabled()) return
  if (!game.user?.isGM) return

  // First activation in this world asks once, then never again.
  await ensureAcknowledged()

  const store = await storeStatus()
  console.log(
    `Beneos Stream | beta active | gate ${streamBase()} | key ${streamKey() ? "set" : "MISSING"} | ` +
    `store ${store.entries} entries, ${store.usageMB} MB of ${store.quotaGB} GB, persisted=${store.persisted}`
  )
})
