/* ============================================================
   Calibration of the map sharpening (user 2026-11-06, stream-beta).

   A small bar right of the creature drawer tab. While it is on, the
   automatic curve is off: the slider sets one strength for the map,
   whatever the zoom. "Save" stores that strength at the current zoom
   (squares across the screen) as a point in "beneos-map-sharpen-points".
   Once points exist, beneos-map-sharpen.mjs runs its curve through them,
   linear between two points, so the operator sets the levels by eye and
   the curve is read off the points afterwards instead of guessed.

   This file only talks to the sharpening through hooks: it listens to
   "beneos.mapSharpenUpdated" and sends "beneos.mapSharpenManual". The
   sharpening works the same without it.

   Setting "beneos-map-sharpen-debug", client scope, off by default and
   offered to the GM only. The texts are English literals on purpose: a
   tuning aid for the operator, not a customer surface, and the file is
   meant to go once the curve is settled.
   ============================================================ */

import { upsertPoint, STRENGTH_MAX } from "./map-sharpen-curve.mjs"

const MODULE_ID = "beneos-module"
const SETTING = "beneos-map-sharpen-debug"
const POINTS_SETTING = "beneos-map-sharpen-points"
const ELEMENT_ID = "beneos-sharpen-debug"

let last = null
// The element exists exactly while calibration runs; its slider is the
// manual strength.
let bar = null

function enabled() {
  try { return game.user?.isGM === true && game.settings.get(MODULE_ID, SETTING) === true } catch (_) { return false }
}

function format(state) {
  const sq = state.squares === null ? "?" : state.squares.toFixed(1)
  if (state.off) return `Sharpen off (${state.off}) · ${sq} squares`
  const wait = state.unknown ? ` · ${state.unknown} not loaded` : ""
  const pts = state.points === 1 ? "1 point" : `${state.points} points`
  return `Sharpen ${state.strength.toFixed(2)} · ${sq} squares · curve ${state.curve.toFixed(2)} · ${pts}${wait}`
}

function sendManual() {
  Hooks.callAll("beneos.mapSharpenManual", bar ? Number(bar.slider.value) : null)
}

async function savePoint() {
  if (!bar || !last || last.squares === null) return
  try {
    const points = game.settings.get(MODULE_ID, POINTS_SETTING)
    await game.settings.set(MODULE_ID, POINTS_SETTING, upsertPoint(points, last.squares, Number(bar.slider.value)))
  } catch (err) {
    console.error("Beneos | map sharpening point not saved", err)
    ui.notifications?.error("Sharpening point not saved, see the console.")
  }
}

function build(start) {
  const el = document.createElement("div")
  el.id = ELEMENT_ID
  // The Beneos slider (standard 4.13) lives under these two classes.
  el.className = "beneos-fx-editor"
  Object.assign(el.style, {
    position: "fixed",
    height: "28px",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    padding: "0 8px",
    // One above the collapsed drawer (70), under every window.
    zIndex: "71",
    font: "12px var(--bc-font-data)",
    color: "var(--bc-text-muted)",
    background: "color-mix(in srgb, var(--bc-bg-panel) 62%, transparent)",
    borderTop: "1px solid var(--bc-border-control)",
    whiteSpace: "nowrap"
  })

  const text = document.createElement("span")

  const wrap = document.createElement("div")
  wrap.className = "bfx-param"
  wrap.style.width = "160px"
  const slider = document.createElement("input")
  slider.type = "range"
  slider.min = "0"
  slider.max = String(STRENGTH_MAX)
  slider.step = "0.05"
  slider.value = String(Math.min(STRENGTH_MAX, Math.max(0, start)))
  slider.title = "Sharpening strength"
  slider.setAttribute("aria-label", "Sharpening strength")
  slider.addEventListener("input", sendManual)
  wrap.appendChild(slider)

  const save = document.createElement("button")
  save.type = "button"
  save.textContent = "Save"
  save.title = "Save this strength for the current zoom"
  Object.assign(save.style, {
    width: "auto",
    height: "22px",
    lineHeight: "20px",
    padding: "0 10px",
    margin: "0",
    font: "12px var(--bc-font-control)",
    color: "var(--bc-text)",
    background: "transparent",
    border: "1px solid var(--bc-border-control)",
    borderRadius: "var(--bc-edge)",
    cursor: "pointer"
  })
  save.addEventListener("click", savePoint)

  el.append(text, wrap, save)
  document.body.appendChild(el)
  return { el, text, slider }
}

function place(el) {
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

function render() {
  if (!enabled()) {
    if (bar) { bar.el.remove(); bar = null; sendManual() }
    return
  }
  if (!last) return
  if (!bar) {
    // Start where the curve stands, so switching on changes nothing visible.
    bar = build(last.curve ?? 0)
    sendManual()
    return
  }
  bar.text.textContent = format(last)
  place(bar.el)
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
