/* ============================================================
   Zoom-dependent sharpening of the battlemap video (user 2026-11-06,
   the same idea as PM-18 in the GM Screen).

   Zoomed in, a compressed map video reads soft. The scene background and
   every tile are drawn by Foundry's PrimarySpriteMesh with a
   PrimaryBaseSamplerShader; this file swaps in a subclass whose texture read adds an unsharp mask
   on luma, four neighbours one source texel away. It runs inside the
   draw of the map itself, so there is no extra render pass, and with a
   strength of 0 the shader skips the extra reads.

   The strength follows the zoom alone (map-sharpen-curve.mjs): how many
   grid squares fit across the screen. Panning, fog and vision do not
   change it. Every client computes its own, players included.

   Which meshes: the scene background and every tile whose texture is a
   video. A Beneos map is either a video background or, in newer releases
   and always in streaming, a still background with the map video as a
   tile on top; intro sequences are video tiles as well. Still images keep
   Foundry's shader. The streaming code lays its video onto the tile late,
   without a Foundry event, and calls the hook "beneos.streamVideoApplied"
   for this file (scripts/stream/stream-canvas.mjs).

   Setting "beneos-map-sharpen", client scope, on by default. Off whenever
   the module's performance mode is on.

   Calibration: "beneos-map-sharpen-points" (world scope) holds points { squares,
   strength } that the operator saved by eye (map-sharpen-debug.mjs). With
   at least one point they replace the default curve, linear between the
   points. While calibrating, the hook "beneos.mapSharpenManual" sets one
   fixed strength regardless of zoom; null hands back to the curve.

   What sharpening cannot do: it adds no detail. It raises edge contrast,
   compression artefacts included. MAX_STRENGTH and the clamp on the
   correction keep that in bounds; both are first values to be tuned.
   ============================================================ */

import { squaresAcross, sharpenAmount, sharpenWanted, texelSize, strengthFromPoints, clampStrength } from "./map-sharpen-curve.mjs"

const MODULE_ID = "beneos-module"
const SETTING = "beneos-map-sharpen"
const PERF_SETTING = "beneos-performance-mode"
const POINTS_SETTING = "beneos-map-sharpen-points"
const MAX_STRENGTH = 1.5

// Fixed strength while the operator calibrates, null otherwise.
let manual = null

let SharpenShader = null
// The class each mesh had before the swap, to give it back.
const originalClass = new WeakMap()

function shaderClass() {
  if (SharpenShader) return SharpenShader
  const Base = foundry.canvas.rendering.shaders.PrimaryBaseSamplerShader
  SharpenShader = class BeneosSharpenSamplerShader extends Base {
    // Drawn on its own, not through Foundry's batch: a batch shares one
    // shader and cannot carry the per-mesh sharpening uniforms.
    static classPluginName = null

    static _fragmentShader = `
      uniform float sharpAmount;
      uniform vec2 sharpTexel;

      float bnLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

      vec4 _main() {
        vec4 c = texture(sampler, vUvs);
        if ( sharpAmount > 0.0 ) {
          float n = bnLuma(texture(sampler, vUvs + vec2(sharpTexel.x, 0.0)).rgb)
                  + bnLuma(texture(sampler, vUvs - vec2(sharpTexel.x, 0.0)).rgb)
                  + bnLuma(texture(sampler, vUvs + vec2(0.0, sharpTexel.y)).rgb)
                  + bnLuma(texture(sampler, vUvs - vec2(0.0, sharpTexel.y)).rgb);
          float d = clamp((bnLuma(c.rgb) - n * 0.25) * sharpAmount, -0.15, 0.15);
          c.rgb = clamp(c.rgb + d * c.a, 0.0, c.a);
        }
        return c * tintAlpha;
      }
    `

    static defaultUniforms = {
      ...Base.defaultUniforms,
      sharpAmount: 0,
      sharpTexel: [0, 0]
    }
  }
  return SharpenShader
}

function setting(key) {
  try { return game.settings.get(MODULE_ID, key) } catch (_) { return undefined }
}

function isVideo(mesh) {
  return mesh?.texture?.baseTexture?.resource?.source instanceof HTMLVideoElement
}

// Every mesh that can carry a map video: the background and the tiles.
function candidates() {
  if (!canvas?.ready) return []
  const out = []
  if (canvas.primary?.background) out.push(canvas.primary.background)
  for (const tile of canvas.tiles?.placeables ?? []) if (tile.mesh) out.push(tile.mesh)
  return out
}

function sharpened() {
  return SharpenShader ? candidates().filter((m) => m.shader instanceof SharpenShader) : []
}

function offReason() {
  if (setting(SETTING) !== true) return "setting"
  if (setting(PERF_SETTING) === true) return "performance mode"
  if (!candidates().some(isVideo)) return "no video on this scene"
  return "off"
}

// Shader strength the curve gives at this zoom: the saved points if there
// are any, the default line otherwise.
function curveStrength(squares) {
  const fromPoints = strengthFromPoints(setting(POINTS_SETTING), squares)
  return fromPoints === null ? sharpenAmount(squares) * MAX_STRENGTH : clampStrength(fromPoints)
}

// Strength from the zoom, texel size from each video. Cheap: runs on every
// pan. Announces what it did as "beneos.mapSharpenUpdated" for anyone who
// wants to show it; the module itself shows nothing.
function updateStrength() {
  if (!canvas?.ready) return
  const squares = squaresAcross(canvas.app.renderer.screen.width, canvas.dimensions?.size, canvas.stage.scale.x)
  const meshes = sharpened()
  const curve = curveStrength(squares)
  const strength = meshes.length ? (manual ?? curve) : 0
  let unknown = 0
  for (const mesh of meshes) {
    const base = mesh.texture.baseTexture
    const u = mesh.shader.uniforms
    const texel = texelSize(base.realWidth, base.realHeight)
    // Size not known yet: no sharpening rather than neighbours a texture apart.
    if (!texel) { u.sharpAmount = 0; unknown++; continue }
    u.sharpTexel = texel
    u.sharpAmount = strength
  }
  const points = setting(POINTS_SETTING)
  Hooks.callAll("beneos.mapSharpenUpdated", {
    strength, curve, manual: manual !== null, squares,
    points: Array.isArray(points) ? points.length : 0,
    videos: meshes.length, unknown,
    off: meshes.length ? null : offReason()
  })
}

// Swap the shader in or out of one mesh to match the settings and its texture.
function syncMesh(mesh) {
  if (!mesh?.texture || mesh.destroyed) return
  const Cls = shaderClass()
  const want = sharpenWanted(setting(SETTING), setting(PERF_SETTING), isVideo(mesh))
  const has = mesh.shader instanceof Cls
  if (want && !has) {
    originalClass.set(mesh, mesh.shader.constructor)
    mesh.setShaderClass(Cls)
  } else if (!want && has) {
    mesh.setShaderClass(originalClass.get(mesh) ?? foundry.canvas.rendering.shaders.PrimaryBaseSamplerShader)
  }
}

function apply() {
  for (const mesh of candidates()) syncMesh(mesh)
  updateStrength()
}

// One tile was drawn, refreshed or got its video: only that mesh. On a full
// redraw Foundry calls drawTile before the streaming code lays its video
// back on; the refreshTile that follows corrects it.
function applyTile(tile) {
  if (!tile?.mesh) return
  syncMesh(tile.mesh)
  updateStrength()
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING, {
    name: "BENEOS.Settings.MapSharpen.Name",
    hint: "BENEOS.Settings.MapSharpen.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  })
  // World scope: the GM calibrates once, every client draws the same
  // curve, and the points can be read off the world afterwards.
  game.settings.register(MODULE_ID, POINTS_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    // onChange runs on every client, for the first save (Foundry creates
    // the setting then, so updateSetting would not fire) and every later one.
    onChange: () => updateStrength()
  })
})

// Registered once and never removed: the feature lives as long as the page,
// and every handler reads the current canvas, so nothing goes stale.
Hooks.on("canvasReady", () => apply())
Hooks.on("canvasPan", () => updateStrength())
Hooks.on("drawTile", applyTile)
Hooks.on("refreshTile", applyTile)
Hooks.on("beneos.streamVideoApplied", applyTile)
Hooks.on("beneos.mapSharpenManual", (value) => {
  manual = Number.isFinite(value) ? clampStrength(value) : null
  updateStrength()
})
Hooks.on("clientSettingChanged", (key) => {
  if (key === `${MODULE_ID}.${SETTING}` || key === `${MODULE_ID}.${PERF_SETTING}`) apply()
})
