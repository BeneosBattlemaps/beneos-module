/* ============================================================
   Debug readout for the map sharpening (user 2026-11-06, stream-beta).

   A small line right of the creature drawer tab that shows what
   beneos-map-sharpen.mjs did last: strength, squares across the screen,
   how many videos carry the shader, or why nothing is sharpened. It only
   listens to "beneos.mapSharpenUpdated"; the sharpening itself does not
   know this file exists and works the same without it.

   Setting "beneos-map-sharpen-debug", client scope, off by default and
   offered to the GM only. The texts are English literals on purpose: a
   tuning aid for the operator, not a customer surface, and the file is
   meant to go once the curve is settled.
   ============================================================ */

const MODULE_ID = "beneos-module"
const SETTING = "beneos-map-sharpen-debug"
const ELEMENT_ID = "beneos-sharpen-debug"

let last = null

function enabled() {
  try { return game.user?.isGM === true && game.settings.get(MODULE_ID, SETTING) === true } catch (_) { return false }
}

function format(state) {
  const sq = state.squares === null ? "?" : state.squares.toFixed(1)
  if (state.off) return `Sharpen off (${state.off}) · ${sq} squares`
  const videos = state.videos === 1 ? "1 video" : `${state.videos} videos`
  const wait = state.unknown ? `, ${state.unknown} not loaded` : ""
  return `Sharpen ${Math.round(state.amount * 100)} % · ${sq} squares · ${videos}${wait}`
}

function element() {
  let el = document.getElementById(ELEMENT_ID)
  if (el) return el
  el = document.createElement("div")
  el.id = ELEMENT_ID
  Object.assign(el.style, {
    position: "fixed",
    bottom: "0",
    height: "28px",
    lineHeight: "28px",
    padding: "0 10px",
    // One above the collapsed drawer (70), under every window.
    zIndex: "71",
    pointerEvents: "none",
    font: "12px var(--bc-font-data, sans-serif)",
    color: "var(--bc-text-muted, #bbb)",
    background: "color-mix(in srgb, var(--bc-bg-panel, #1a1714) 62%, transparent)",
    borderTop: "1px solid var(--bc-edge, #3a332b)",
    whiteSpace: "nowrap"
  })
  document.body.appendChild(el)
  return el
}

function render() {
  const old = document.getElementById(ELEMENT_ID)
  if (!enabled() || !last) { old?.remove(); return }
  const el = element()
  el.textContent = format(last)
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

// Registered in "setup", where game.user exists, so only the GM is offered it.
Hooks.once("setup", () => {
  game.settings.register(MODULE_ID, SETTING, {
    name: "BENEOS.Settings.MapSharpenDebug.Name",
    hint: "BENEOS.Settings.MapSharpenDebug.Hint",
    scope: "client",
    config: game.user?.isGM === true,
    type: Boolean,
    default: false
  })
})

Hooks.on("beneos.mapSharpenUpdated", (state) => { last = state; render() })
Hooks.on("clientSettingChanged", (key) => { if (key === `${MODULE_ID}.${SETTING}`) render() })
