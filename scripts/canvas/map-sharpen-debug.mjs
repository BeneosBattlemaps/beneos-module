/* ============================================================
   Debug readout for the map sharpening (user 2026-11-06, stream-beta).

   A small line right of the creature drawer tab that shows what
   beneos-map-sharpen.mjs did last: strength out of the maximum, squares
   across the screen, how many videos carry the shader, or why nothing is
   sharpened. It only listens to "beneos.mapSharpenUpdated"; the
   sharpening itself does not know this file exists.

   GM only, no setting (user 2026-11-06): the readout is for the test on
   stream-beta and goes before the feature moves on, by deleting this file
   and its line in module.json. The texts are English literals for the
   same reason.
   ============================================================ */

const ELEMENT_ID = "beneos-sharpen-debug"

function format(state) {
  const sq = state.squares === null ? "?" : state.squares.toFixed(1)
  if (state.off) return `Sharpen off (${state.off}) · ${sq} squares`
  const videos = state.videos === 1 ? "1 video" : `${state.videos} videos`
  const wait = state.unknown ? `, ${state.unknown} not loaded` : ""
  return `Sharpen ${state.strength.toFixed(2)} of ${state.max} · ${sq} squares · ${videos}${wait}`
}

function element() {
  let el = document.getElementById(ELEMENT_ID)
  if (el) return el
  el = document.createElement("div")
  el.id = ELEMENT_ID
  Object.assign(el.style, {
    position: "fixed",
    height: "28px",
    lineHeight: "28px",
    padding: "0 10px",
    // One above the collapsed drawer (70), under every window.
    zIndex: "71",
    pointerEvents: "none",
    font: "12px var(--bc-font-data)",
    color: "var(--bc-text-muted)",
    background: "color-mix(in srgb, var(--bc-bg-panel) 62%, transparent)",
    borderTop: "1px solid var(--bc-border-control)",
    whiteSpace: "nowrap"
  })
  document.body.appendChild(el)
  return el
}

function render(state) {
  if (game.user?.isGM !== true) return
  const el = element()
  el.textContent = format(state)
  // Beside the drawer tab, same height; bottom left when the tab is missing.
  const tab = document.querySelector("#beneos-creature-installer .bci-tab")
  const r = tab?.getBoundingClientRect()
  if (r && r.width) {
    el.style.left = `${Math.round(r.right + 8)}px`
    el.style.top = `${Math.round(r.top)}px`
    el.style.bottom = "auto"
  } else {
    el.style.left = "8px"
    el.style.top = "auto"
    el.style.bottom = "0"
  }
}

Hooks.on("beneos.mapSharpenUpdated", render)
