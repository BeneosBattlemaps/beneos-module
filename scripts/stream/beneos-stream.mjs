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

import { registerStreamSettings, streamEnabled, streamKey, streamBase, streamHost, pinStillsEnabled, installMode, downloadMode, streamMode, ensureStreamKey } from "./stream-settings.mjs"
import { installStreamFetch, storeStatus, clearStore, prewarm, diagnose, resetDiagnosis, abortAll, sichereSpeicher } from "./stream-fetch.mjs"
import { installStreamCanvas, drawStatus, videoTilesOf } from "./stream-canvas.mjs"
import { installStreamOnline, onlineStatus, streamState, isOffline, hasStreamedContent } from "./stream-online.mjs"
import { installStreamIndicator } from "./stream-indicator.mjs"
import { betaMayRun, ensureAcknowledged } from "./stream-guard.mjs"
import { loadStreamManifest, buildStreamPack, applyStreamAddresses, restoreLocalVideos, streamUrlsOf, releaseFromPackage, listReleases } from "./stream-install.mjs"
import { reportedSoFar } from "./stream-report.mjs"

Hooks.once("init", () => {
  registerStreamSettings()

  // Only patch when the switch is on. An off beta must cost nothing, not even
  // a wrapped fetch.
  if (streamEnabled()) {
    installStreamFetch()
    installStreamOnline()
    installStreamCanvas()
    installStreamIndicator()
  }

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
    restoreLocalVideos,
    installMode: () => installMode(),
    downloadMode: () => downloadMode(),
    streamUrlsOf,
    listReleases,
    prewarm,
    storeStatus,
    clearStore,
    diagnose,
    resetDiagnosis,
    reportedSoFar,
    // Connection and watchdog, the parts the test programme reads
    state: () => streamState(),
    offline: () => isOffline(),
    onlineStatus,
    drawStatus,
    videoTilesOf,
    hasStreamedContent,
    abortAll,
    pinStills: () => pinStillsEnabled(),
  }
  globalThis.BeneosStream = api
  game.beneos = game.beneos || {}
  game.beneos.stream = api
})

Hooks.once("ready", async () => {
  // Am Modus, nicht an streamEnabled(): letzteres verlangt bereits einen
  // Schluessel, und eine frisch eingeschaltete Welt hat noch keinen. Sie kaeme
  // sonst nie dazu, sich einen zu holen.
  if (!streamMode()) return
  if (!game.user?.isGM) return

  // Der Schluessel dieser Welt. Holt ihn beim ersten Mal, uebernimmt einen
  // handgetippten und laesst ihn danach in Ruhe.
  await ensureStreamKey()

  if (!streamEnabled()) {
    console.log("Beneos Stream | Modus an, aber kein Schluessel. Es wird nichts ausgeliefert.")
    return
  }

  // First activation in this world asks once, then never again.
  await ensureAcknowledged()

  // Direkt nach dem Dialog um die Speicherzusage bitten. Die Reihenfolge ist
  // kein Zufall: eine Nutzerhandlung unmittelbar davor erhoeht die Aussicht,
  // dass Chrome zusagt. Ohne Zusage darf der Browser den Cache bei
  // Plattenknappheit raeumen, und genau daran haengt das Offline-Versprechen.
  const zusage = await sichereSpeicher()

  const store = await storeStatus()
  console.log(
    `Beneos Stream | beta active | gate ${streamBase()} | key ${streamKey() ? "set" : "MISSING"} | ` +
    `${streamState()} | install ${installMode()} | pin-stills ${pinStillsEnabled() ? "on" : "off"} | ` +
    `store ${store.entries} entries, ${store.usageMB} MB of ${store.quotaGB} GB, persisted=${store.persisted}`
  )
  // Getrennt protokolliert, weil es eine Aussage ueber die HALTBARKEIT ist und
  // nicht ueber den Fuellstand. Wer beides in eine Zeile schreibt, liest die
  // wichtigere Zahl irgendwann ueber.
  if (zusage.zugesagt === true) {
    console.log("Beneos Stream | Speicher ist dauerhaft, der Browser raeumt ihn nicht von selbst")
  } else if (zusage.zugesagt === false) {
    console.warn(
      "Beneos Stream | KEINE Speicherzusage. Der Browser darf den Offline-Bestand bei " +
      "Plattenknappheit jederzeit verwerfen. Offline gilt nur, solange er ihn haelt."
    )
  } else {
    console.warn("Beneos Stream | Speicherzusage nicht erfragbar, dieser Browser kennt die Schnittstelle nicht")
  }
})
