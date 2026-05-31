/* Shared token-geometry helpers for the Beneos FX runtime
 * (particle systems + render layers). Derived from document.width/height
 * × grid.size; token.w/.h can carry mesh-scale subtleties, so
 * document-based math is reliable for multi-cell tokens (e.g. a 2×3
 * dragon). */

export function tokenHalfWidth(token) {
  const grid = canvas?.grid?.size || 100
  return (token?.document?.width ?? 1) * grid * 0.5
}

export function tokenHalfHeight(token) {
  const grid = canvas?.grid?.size || 100
  return (token?.document?.height ?? 1) * grid * 0.5
}

// Smaller axis: keeps sprites/graphics proportional on rectangular tokens.
export function tokenRadius(token) {
  return Math.min(tokenHalfWidth(token), tokenHalfHeight(token))
}
