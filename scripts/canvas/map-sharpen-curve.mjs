/* ============================================================
   How hard the battlemap video is sharpened at a given zoom.
   Pure, no Foundry dependency, so the curve can be checked in Node
   (map-sharpen-curve.test.mjs).

   The measure is how many grid squares fit across the screen at the
   current zoom (user 2026-11-06). It depends on the zoom alone: panning
   the camera, fog of war or vision do not change it, because it counts
   the squares that COULD be seen, not the ones that are.

   At START squares across or more the map is shown as it is. From there
   the strength rises in a straight line to its maximum at FULL squares
   across, and stays there when zooming in further. The two numbers are
   the operator's first setting and are meant to be tuned.
   ============================================================ */

export const SHARPEN_START_SQUARES = 25
export const SHARPEN_FULL_SQUARES = 7

// Squares across the screen: screen width over the on-screen size of one
// square. Null when any input is missing or not a positive number.
export function squaresAcross(screenWidth, gridSize, scale) {
  if (!(screenWidth > 0) || !(gridSize > 0) || !(scale > 0)) return null
  return screenWidth / (gridSize * scale)
}

// Whether the map is sharpened at all: the setting is on, the module's
// performance mode is off, and the scene background is a video. A still
// image keeps Foundry's own shader.
export function sharpenWanted(settingOn, perfOn, isVideo) {
  return settingOn === true && perfOn !== true && isVideo === true
}

// Texel size of the video as [1/width, 1/height], or null while the size is
// unknown. A missing size must not become a step of a whole texture width.
export function texelSize(width, height) {
  if (!(width > 1) || !(height > 1)) return null
  return [1 / width, 1 / height]
}

// 0 = no sharpening, 1 = maximum. Linear between the two thresholds.
export function sharpenAmount(squares, start = SHARPEN_START_SQUARES, full = SHARPEN_FULL_SQUARES) {
  if (squares === null || !Number.isFinite(squares) || !(start > full)) return 0
  const t = (start - squares) / (start - full)
  return Math.min(1, Math.max(0, t))
}
