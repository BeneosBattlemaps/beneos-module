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
 * Ein Ladehinweis auf einer Flaeche, die noch nichts zeigt.
 *
 * Nur fuer den Fall, dass es zu diesem Video KEIN Standbild gibt, erkennbar an
 * `partner === ""`. Wo eines liegt, traegt die Flaeche laengst die Karte, und
 * dann waere ein Hinweis nichts als Stoerung.
 *
 * Kein Bild im Modul. Die Anzeige entsteht aus `PIXI.Texture.WHITE`, dem
 * einzigen Zeichenweg, den PIXI 7 (Foundry 13) und PIXI 8 (Foundry 14)
 * unveraendert teilen. `Graphics.beginFill()` gibt es in PIXI 8 nicht mehr, und
 * ein Ladehinweis, der beim Fassungswechsel selbst zum Fehler wird, waere die
 * Umkehrung seines Zwecks.
 *
 * Sie haengt an der Kachelebene, nicht an der Kachel: Kinder der Ebene liegen in
 * Szenenkoordinaten, und die stehen im Dokument. Wer sie in die Kachel haengt,
 * haengt sie in einen Raum, dessen Ursprung sich zwischen den Foundry-Fassungen
 * schon verschoben hat.
 *
 * @return {() => void} entfernt die Anzeige wieder, mehrfach aufrufbar
 */
function ladeAnzeige(doc) {
  const P = globalThis.PIXI
  const ebene = canvas?.tiles
  if (!P?.Sprite || !P?.Texture?.WHITE || !ebene?.addChild) return () => {}

  const b = Number(doc?.width) || 0
  const h = Number(doc?.height) || 0
  if (b <= 0 || h <= 0) return () => {}

  const flaeche = (tint, alpha, x, y, w, hh) => {
    const s = new P.Sprite(P.Texture.WHITE)
    s.tint = tint
    s.alpha = alpha
    s.position.set(x, y)
    s.width = w
    s.height = hh
    return s
  }

  // Balkenmasse an der Flaeche, nicht in Bildpunkten: dieselbe Anzeige sitzt auf
  // einer 4000er Karte und auf einem 500er Overlay.
  const bahnB = Math.min(b * 0.34, b - 4)
  const bahnH = Math.max(4, Math.round(h * 0.012))
  const laeufer = Math.max(2, bahnB * 0.28)

  const behaelter = new P.Container()
  behaelter.eventMode = "none"
  behaelter.position.set((Number(doc.x) || 0) + b / 2, (Number(doc.y) || 0) + h / 2)
  behaelter.angle = Number(doc.rotation) || 0

  behaelter.addChild(flaeche(0x0b0b10, 0.92, -b / 2, -h / 2, b, h))
  behaelter.addChild(flaeche(0x2a2a33, 0.9, -bahnB / 2, -bahnH / 2, bahnB, bahnH))
  const strich = flaeche(0xf5c992, 0.95, -bahnB / 2, -bahnH / 2, laeufer, bahnH)
  behaelter.addChild(strich)
  ebene.addChild(behaelter)

  // Der Weg des Laeufers haengt an der verstrichenen Zeit und nicht an der Zahl
  // der Bilder, sonst laeuft er auf einer schnellen Maschine schneller.
  const start = Date.now()
  const schritt = () => {
    const t = ((Date.now() - start) % 1400) / 1400
    strich.position.x = -bahnB / 2 + (bahnB - laeufer) * (t < 0.5 ? t * 2 : (1 - t) * 2)
  }
  canvas.app?.ticker?.add?.(schritt)

  let weg = false
  return () => {
    if (weg) return
    weg = true
    canvas.app?.ticker?.remove?.(schritt)
    try { behaelter.destroy({ children: true }) } catch (_) { /* Leinwand schon abgebaut */ }
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
    // Ohne Standbild zeigt die Flaeche bis zum Video den schwarzen Hintergrund
    // der Szene, und schwarz sagt niemandem, dass etwas unterwegs ist.
    const partner = tile?.flags?.[FLAG_SCOPE]?.[FLAG_KEY]?.partner
    const hinweisWeg = partner === "" ? ladeAnzeige(tile) : () => {}
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
    } finally {
      hinweisWeg()
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
