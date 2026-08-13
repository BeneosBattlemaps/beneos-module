/**
 * What happens around a scene draw when its pictures come from far away.
 *
 * Three things, and all three exist because of what the Foundry source does not
 * do. Measured against 13.351 on 2026-08-12.
 *
 * A scene draw is a hard barrier. `Canvas#draw` awaits every texture of the
 * scene before a single layer is drawn, and `TextureLoader.loadSceneTextures`
 * collects every tile regardless of whether it is hidden. Nothing appears until
 * the slowest file has arrived.
 *
 * Nothing in that chain has a deadline. `TextureLoader` sets none, PIXI hands
 * the URL to a bare fetch without a signal, and PIXI's video loader downloads
 * the whole file as a blob before the first frame and then waits on `canplay`
 * with no timeout either. A transfer that neither finishes nor fails parks the
 * draw for good: `canvas.loading` stays true and `Scene#view` refuses every
 * further scene change for the rest of the session. There is no watchdog
 * anywhere in the client.
 *
 * And `maxConcurrent` is never set by the core, so every asset of a scene
 * starts at once. The only place it can be changed is the `canvasInit` hook,
 * which is the last thing that runs before loading begins.
 *
 * The video is kept out of all this by not being in the document at all. The
 * preparation tool leaves the video tile empty and puts the address in a flag,
 * so the barrier holds pictures only, and the motion is fetched here afterwards
 * with a budget of its own. Losing it costs motion and nothing else.
 */

import { drawBudget, maxConcurrent, streamEnabled } from "./stream-settings.mjs"
import { abortAll, inFlightCount } from "./stream-fetch.mjs"
import { reportFailure } from "./stream-report.mjs"

const FLAG_SCOPE = "beneos-module"
const FLAG_KEY = "stream"

let watchdog = null
let drawStartedAt = 0

/** The tiles of a scene that have a video address parked in their flag. */
export function videoTilesOf(scene) {
  const out = []
  for (const tile of scene?.tiles ?? []) {
    const flag = tile?.flags?.[FLAG_SCOPE]?.[FLAG_KEY]
    if (flag?.role === "stream-video" && flag.video) out.push({ tile, url: flag.video })
  }
  return out
}

function clearWatchdog() {
  if (watchdog) clearTimeout(watchdog)
  watchdog = null
}

/**
 * The scene took too long. End the requests rather than the scene.
 *
 * Aborting is what makes the difference between a slow evening and a dead
 * client: every aborted request rejects, `TextureLoader` counts the rejection,
 * the `allSettled` finally settles, and the draw runs to completion with
 * whatever arrived. Without it the draw never ends and no further scene can be
 * opened at all.
 */
function onOverrun(sceneName) {
  const stopped = abortAll("draw-budget")
  const waited = Math.round((Date.now() - drawStartedAt) / 1000)
  reportFailure({
    url: "(scene draw)", reason: "draw-timeout",
    detail: `${sceneName}: ${stopped} requests cut off after ${waited} s`,
  })
  console.debug(`Beneos Stream | scene draw over budget after ${waited} s, `
    + `${stopped} requests cut off`)
  // English in place of a localisation key, like the rest of the beta surface
  // (see stream-guard.mjs). Adding a key here would mean thirteen language
  // files carrying an untranslated string for a feature that may not ship.
  ui.notifications?.warn?.(
    `Beneos Stream: "${sceneName}" could not be loaded completely within `
    + `${waited} seconds. Your connection is too slow or the server is not `
    + `answering. The scene is shown with whatever arrived.`)
}

function onCanvasInit(canvas) {
  if (!streamEnabled()) return
  clearWatchdog()
  drawStartedAt = Date.now()

  // The only window in which this can be changed: `Canvas##draw` reads it right
  // after this hook and before it starts loading.
  const cap = maxConcurrent()
  if (cap > 0 && canvas?.loadTexturesOptions) canvas.loadTexturesOptions.maxConcurrent = cap

  const budget = drawBudget()
  if (budget > 0) {
    const name = canvas?.scene?.name || "?"
    watchdog = setTimeout(() => { watchdog = null; onOverrun(name) }, budget)
  }
}

/**
 * Put the motion in, once the scene is standing.
 *
 * Deliberately after `canvasReady` and deliberately not awaited by anything: a
 * video that never arrives must cost motion, not the scene.
 */
async function fillInVideos() {
  if (!streamEnabled()) return
  const scene = canvas?.scene
  const wanted = videoTilesOf(scene)
  if (!wanted.length) return

  for (const { tile, url } of wanted) {
    const placeable = canvas.tiles?.get?.(tile.id) ?? canvas.tiles?.placeables?.find(p => p.id === tile.id)
    if (!placeable) continue
    try {
      const texture = await foundry.canvas.loadTexture(url)
      if (!texture) continue
      // The scene may have been left while the video was still coming.
      if (canvas.scene?.id !== scene.id) return
      await applyVideoTexture(placeable, texture)
    } catch (err) {
      // Already counted and reported by the fetch wrapper. One quiet line here,
      // never a red message: an unreachable video is the expected outcome of a
      // bad connection, not a defect.
      console.debug(`Beneos Stream | no motion for "${scene.name}": ${String(err).slice(0, 120)}`)
    }
  }
}

/**
 * Swap a loaded video texture onto a tile that is currently showing nothing.
 *
 * The document is left alone. Writing the address into `texture.src` would put
 * the video back into the load barrier on the next draw, which is the whole
 * thing this file exists to avoid, and it would also write a customer-specific
 * address into a document that gets exported and shared.
 */
async function applyVideoTexture(placeable, texture) {
  const mesh = placeable.mesh ?? placeable
  placeable.texture = texture
  if (mesh) mesh.texture = texture
  const source = texture.baseTexture?.resource?.source
  if (source instanceof HTMLVideoElement) {
    source.loop = true
    source.muted = true
    try { await game.video?.play?.(source, { loop: true, volume: 0 }) } catch (_) { /* gesture gate */ }
  }
  placeable.renderFlags?.set?.({ refreshTexture: true, redraw: true })
}

export function installStreamCanvas() {
  Hooks.on("canvasInit", onCanvasInit)
  Hooks.on("canvasReady", () => {
    clearWatchdog()
    // Not awaited on purpose, see fillInVideos.
    fillInVideos()
  })
  // A draw that fails for any other reason must not leave the watchdog armed.
  Hooks.on("canvasTearDown", clearWatchdog)
}

/** For the test programme: what the watchdog would currently be waiting on. */
export function drawStatus() {
  return {
    armed: Boolean(watchdog),
    waitedMs: drawStartedAt ? Date.now() - drawStartedAt : 0,
    inFlight: inFlightCount(),
    loading: Boolean(canvas?.loading),
  }
}
