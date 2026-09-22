/**
 * V13 -> V14 import bridge for Beneos battlemap packs.
 *
 * Foundry migrates WORLDS automatically across core versions, but external pack
 * import via createDocuments() bypasses that migration. Our packs are authored
 * and exported in V13, so when a customer installs them into a V14 world the raw
 * documents hit V14's stricter schema without ever being migrated. This module
 * applies, at install time, exactly the V13->V14 conversions Foundry would have
 * done itself , and nothing else.
 *
 * Gating: every conversion is keyed on the PACK origin, not the running version.
 * `packNeedsV14Migration()` returns true only when the client runs V14 (>=14)
 * AND the pack's `_stats.coreVersion` major is < 14. A V13 client never migrates
 * (its data is already native); a future V14-authored pack (coreVersion >= 14)
 * is skipped so it is never double-converted.
 *
 * Scope (verified against the full delivered ZIP catalogue + V14 core schemas on
 * 14.360, see J:\Beneos_programming\_testing\v13_v14_scene_differential_2026-07-07.md):
 *   1. Scene background/foreground/backgroundColor -> scene.levels[0].{background,
 *      foreground, textures}. V14 removed the top-level scene.background/foreground
 *      fields (the map now lives on a Level); without this the map image is LOST
 *      on 89% of the catalogue (background-based battlemaps). The level background
 *      colour also drives the near-black letterbox/padding natively, so no extra
 *      canvas hook is needed.
 *   2. Tile occlusion.mode (V13 singular enum NONE:0/FADE:1/RADIAL:3/VISION:4)
 *      -> occlusion.modes SetField (FADE:1/SURFACE:2/RADIAL:4/VISION:8) which
 *      REJECTS NONE(0). Left raw, the whole Scene fails validation and no scene
 *      is created.
 *   3. Tile x/y (V13 = top-left of the rect) -> V14 texture-anchor-point
 *      semantics (default anchor 0.5 = centre). Left raw, tiles render shifted by
 *      half their size (tile-only scenes look destroyed).
 *   4. Scene background.offsetX/offsetY -> scene.shiftX/shiftY. Same field,
 *      renamed in V14. Written to level.textures.offsetX instead (the bug fixed
 *      on 2026-09-22) the rect stays put and the map is pushed the other way, so
 *      the map sits 2 * offset off its own walls. 40 of 2180 catalogue scenes
 *      carry a non-zero offset, hence "random releases are misaligned".
 *   5. Scene fog.exploration (boolean) -> fog.mode (enum). Same kind of rename,
 *      and the wide case: 1191 of 2180 scenes ship exploration off while V14
 *      defaults to on, so half the catalogue gained fog of war on V14.
 *   6. foregroundElevation -> levels[].elevation.top and fog.overlay ->
 *      levels[].fog.src, the last two relocations migrateLevels performs.
 *
 * Everything else in the catalogue validated clean on V14 (walls, notes,
 * drawings, tokens, lights, sounds, journal pages, templates, effects), so this
 * bridge deliberately touches only Scene documents and their tiles.
 */

// Stable per-scene embedded id for the level we synthesize. MUST be Foundry's
// native default-level id: TokenDocument.level defaults to "defaultLevel0000",
// and V13 pack tokens carry no level at all, so they land on that default. A
// custom id here (the former "beneosLevel00001") makes every imported token
// reference a level that does not exist in the scene, and V14 then renders
// none of them (empty CoS landing-page Characters scene, 2026-07-17).
const BENEOS_LEVEL_ID = "defaultLevel0000"
// Fallback letterbox/background colour for a Beneos scene that shipped without
// an explicit backgroundColor (Beneos maps are dark-themed; keeps the padding
// near-black instead of the light V14 default).
const BENEOS_DEFAULT_BG_COLOR = "#050505"

const V13_TO_V14_OCCLUSION = { 1: 1, 3: 4, 4: 8 } // FADE, RADIAL->4, VISION->8 (NONE dropped)
const V14_VALID_OCCLUSION  = new Set([1, 2, 4, 8])
// CONST.FOG_EXPLORATION_MODES, spelled out because this module also runs in the
// bench harness, outside a Foundry client.
const V14_FOG_DISABLED   = 0
const V14_FOG_INDIVIDUAL = 1

/** True when the running client is V14 and the pack was authored pre-V14. */
export function packNeedsV14Migration(sceneData) {
  const generation = game.release?.generation ?? 13
  if (generation < 14) return false
  const major = parseInt(String(sceneData?._stats?.coreVersion ?? "13"), 10) || 13
  return major < 14
}

/** Occlusion + coordinate conversion for a single raw tile (mutates). */
function migrateTile(tile) {
  if (!tile || typeof tile !== "object") return
  // (1) occlusion.mode (singular) -> occlusion.modes (SetField), dropping NONE(0).
  const occ = tile.occlusion
  if (occ && typeof occ === "object") {
    const modes = new Set()
    for (const m of (Array.isArray(occ.modes) ? occ.modes : [])) {
      if (V14_VALID_OCCLUSION.has(Number(m))) modes.add(Number(m))
    }
    if (typeof occ.mode === "number" && occ.mode !== 0 && V13_TO_V14_OCCLUSION[occ.mode] != null) {
      modes.add(V13_TO_V14_OCCLUSION[occ.mode])
    }
    occ.modes = [...modes]
    delete occ.mode
  }
  // (2) x/y top-left -> texture-anchor point. Rotation-safe: the 0.5 anchor is
  // the rotation pivot, invariant under rotation.
  const ax = Number(tile.texture?.anchorX ?? 0.5)
  const ay = Number(tile.texture?.anchorY ?? 0.5)
  if (typeof tile.x === "number") tile.x = Math.round(tile.x + (Number(tile.width)  || 0) * ax)
  if (typeof tile.y === "number") tile.y = Math.round(tile.y + (Number(tile.height) || 0) * ay)
}

/**
 * The V13 scene-rect shift, in the V14 field names. Pure.
 *
 * V13 `background.offsetX/offsetY` shifts the SCENE RECT, not the texture:
 * `sceneX = dimensions.x - background.offsetX` (v13 client/documents/scene.mjs:273).
 * V14 renamed the field to the top-level `scene.shiftX/shiftY` and kept the formula
 * verbatim (V14 client/documents/scene.mjs:497); Foundry's own world migration
 * `migrateLevels` performs exactly this assignment. `level.textures.offsetX` is a
 * DIFFERENT concept in V14: it moves only the texture, against an already computed
 * rect (primary.mjs:295). Writing the V13 offset there leaves the rect unshifted and
 * pushes the map the other way, so the map lands 2 * offset off its own walls.
 *
 * @returns {{shiftX: number, shiftY: number}|null} null when there is nothing to move.
 */
export function rectShiftFrom(bg) {
  if (!bg || typeof bg !== "object") return null
  const x = Number(bg.offsetX)
  const y = Number(bg.offsetY)
  if (!Number.isFinite(x) && !Number.isFinite(y)) return null
  // V14 declares both as `integer: true`, so a fractional pack value must round.
  return { shiftX: Number.isFinite(x) ? Math.round(x) : 0, shiftY: Number.isFinite(y) ? Math.round(y) : 0 }
}

/**
 * The two Level fields Foundry's `migrateLevels` fills that this bridge used to
 * drop: the overhead elevation and the fog overlay image. Pure.
 *
 * The truthiness test on the elevation is Foundry's own (`a && (c.elevation =
 * {top: a})`) and it is not cosmetic: V13 declares `foregroundElevation` nullable,
 * and 239 of 2180 catalogue scenes ship null. Coercing that to 0 would produce a
 * level spanning [0, 0], which `Level#clampElevation` then uses to pin every token
 * to elevation 0.
 *
 * @returns {{elevation?: {top: number}, fog?: {src: string}}}
 */
export function levelExtrasFrom(scene) {
  const extras = {}
  const elev = scene?.foregroundElevation
  if (typeof elev === "number" && Number.isFinite(elev) && elev > 0) extras.elevation = { top: elev }
  const overlay = scene?.fog?.overlay
  if (typeof overlay === "string" && overlay) extras.fog = { src: overlay }
  return extras
}

/**
 * V13 `fog.exploration` (boolean) -> V14 `fog.mode` (enum). Foundry's own world
 * migration `migrateFogExploration` makes exactly this mapping, but that registry
 * never runs on documents handed to createDocuments, and the V14 default is
 * INDIVIDUAL. Left alone, every scene that shipped with exploration switched OFF
 * silently gains fog of war: 1191 of 2180 catalogue scenes, nearly all of them the
 * SC and overview scenes where a fogged image is exactly wrong. Mutates.
 */
function migrateSceneFog(scene) {
  const fog = scene?.fog
  if (!fog || typeof fog !== "object" || !("exploration" in fog)) return
  if (fog.mode === undefined) fog.mode = fog.exploration ? V14_FOG_INDIVIDUAL : V14_FOG_DISABLED
  delete fog.exploration
}

/** Strip the V13 top-level scene fields that V14 removed from the schema. */
function stripLegacySceneFields(scene) {
  delete scene.background
  delete scene.foreground
  delete scene.backgroundColor
  delete scene.foregroundElevation
  if (scene.fog && typeof scene.fog === "object") delete scene.fog.overlay
}

/**
 * Move the V13 scene background/foreground/backgroundColor onto a V14 Level
 * (scene.levels[0]). Split matches the V14 schema: src/color/tint/alphaThreshold
 * -> level.background; the placement transform (anchor/scale/fit/rotation)
 * -> level.textures; foreground -> level.foreground; the scene-rect shift
 * -> scene.shiftX/shiftY. A pure tile scene (no background) is left for Foundry
 * to give its own default level; an already-V14 scene (levels present) is left
 * untouched. Mutates.
 */
function migrateSceneBackground(scene) {
  const bg = (scene.background && typeof scene.background === "object") ? scene.background : null
  const hasBgSrc = !!(bg && bg.src)
  const fgRaw = typeof scene.foreground === "string" ? { src: scene.foreground } : scene.foreground
  const hasFgSrc = !!(fgRaw && fgRaw.src)
  const hasColor = typeof scene.backgroundColor === "string" && scene.backgroundColor

  // Assigned before the early return so a tile-only scene keeps its rect shift
  // too. An explicit shiftX in the source wins, which is Foundry's own rule
  // (client/documents/scene.mjs:1023: `!("shiftX" in data)`) and keeps mixed
  // data, carrying both levels and a legacy background, from being overwritten.
  const shift = rectShiftFrom(bg)
  if (shift && !("shiftX" in scene)) scene.shiftX = shift.shiftX
  if (shift && !("shiftY" in scene)) scene.shiftY = shift.shiftY

  // Already-V14 data, or nothing to relocate: just drop the removed fields.
  if ((Array.isArray(scene.levels) && scene.levels.length) || (!hasBgSrc && !hasFgSrc && !hasColor)) {
    stripLegacySceneFields(scene)
    return
  }

  const level = { _id: BENEOS_LEVEL_ID, name: "Level" }

  const background = {}
  background.color = hasColor ? scene.backgroundColor : BENEOS_DEFAULT_BG_COLOR
  if (bg && bg.src != null)            background.src = bg.src
  if (bg && bg.tint != null)           background.tint = bg.tint
  if (bg && bg.alphaThreshold != null) background.alphaThreshold = bg.alphaThreshold
  level.background = background

  // V14 positions the Level's background texture so that its anchor FRACTION
  // point coincides with the scene-rect centre. A map that should fill the scene
  // therefore needs anchor 0.5/0.5 (V14's own default), NOT the V13 value.
  // V13 `scene.background.anchorX/anchorY` (Beneos packs ship 0/0) is a different
  // concept; copied verbatim it anchors the texture's TOP-LEFT at the centre, so
  // the map is shoved down-right by half the scene (the Headisport bug). Force
  // 0.5 and carry only the transform fields that map 1:1 (scale/fit/rotation;
  // Beneos ships defaults, so this stays a faithful fill).
  // offsetX/offsetY are deliberately NOT in this list, see rectShiftFrom.
  const textures = { anchorX: 0.5, anchorY: 0.5 }
  for (const key of ["fit", "scaleX", "scaleY", "rotation"]) {
    if (bg && bg[key] != null) textures[key] = bg[key]
  }
  level.textures = textures

  if (hasFgSrc) {
    const foreground = { src: fgRaw.src }
    if (fgRaw.tint != null)           foreground.tint = fgRaw.tint
    if (fgRaw.alphaThreshold != null) foreground.alphaThreshold = fgRaw.alphaThreshold
    level.foreground = foreground
  }

  Object.assign(level, levelExtrasFrom(scene))

  scene.levels = [level]
  scene.initialLevel = BENEOS_LEVEL_ID
  stripLegacySceneFields(scene)
}

/**
 * Apply the full V13 -> V14 conversion to one raw pack Scene document. Mutates
 * and returns it. The caller is responsible for the version gate
 * (packNeedsV14Migration) so a V13 install stays byte-identical.
 */
export function migrateSceneForV14(scene) {
  if (!scene || typeof scene !== "object") return scene
  migrateSceneBackground(scene)
  migrateSceneFog(scene)
  for (const tile of (Array.isArray(scene.tiles) ? scene.tiles : [])) migrateTile(tile)
  return scene
}
