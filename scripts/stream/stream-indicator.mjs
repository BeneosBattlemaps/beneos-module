/**
 * A dot on the Beneos button that says whether the gate can be reached.
 *
 * Game master only, by decision: a player is told at the moment it matters, by
 * the scene refusing to open, and a permanent badge in a player's toolbar would
 * be chrome without a use.
 *
 * No new window and no new bar. The module already re-renders its own scene
 * control on every `renderSceneControls` and already guards that work with a
 * `dataset` flag, and it already ships a pulsing dot for the live-game-chat
 * button. This is the same dot in three colours.
 */

import { streamEnabled, streamMode } from "./stream-settings.mjs"
import { onStreamState, onlineStatus, streamState } from "./stream-online.mjs"

const DOT_CLASS = "beneos-stream-dot"

const LOOK = {
  online: { title: "Beneos Stream: connected", colour: "#5db075" },
  degraded: { title: "Beneos Stream: answers are failing, the connection is unreliable", colour: "#e0a33a" },
  offline: { title: "Beneos Stream: no connection, streamed scenes cannot be opened", colour: "#c9503f" },
}

let styled = false

function ensureStyle() {
  if (styled) return
  styled = true
  const style = document.createElement("style")
  style.textContent = `
    .${DOT_CLASS} {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      pointer-events: none;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
    }
    .${DOT_CLASS}[data-state="offline"] { animation: beneos-stream-dot-pulse 2s ease-in-out infinite; }
    @keyframes beneos-stream-dot-pulse { 50% { opacity: 0.35; } }
    @media (prefers-reduced-motion: reduce) {
      .${DOT_CLASS}[data-state="offline"] { animation: none; }
    }`
  document.head.appendChild(style)
}

function paint() {
  if (!streamEnabled() || !game.user?.isGM) return
  const button = document.querySelector('button[data-control="beneos"], li[data-control="beneos"]')
  if (!button) return
  ensureStyle()

  const host = button.tagName === "BUTTON" ? button : button.querySelector("button") || button
  if (getComputedStyle(host).position === "static") host.style.position = "relative"

  let dot = host.querySelector(`.${DOT_CLASS}`)
  if (!dot) {
    dot = document.createElement("span")
    dot.className = DOT_CLASS
    host.appendChild(dot)
  }
  const state = streamState()
  const look = LOOK[state] || LOOK.online
  dot.dataset.state = state
  dot.style.background = look.colour
  // The tooltip carries the detail so the dot itself can stay a dot.
  const status = onlineStatus()
  host.title = status.changedSecondsAgo === null
    ? look.title
    : `${look.title} (for ${status.changedSecondsAgo} s)`
}

export function installStreamIndicator() {
  // Am Modus, nicht an streamEnabled(): siehe die Begruendung in
  // installStreamFetch. `paint()` prueft weiterhin auf streamEnabled() und
  // zeichnet ohne Schluessel nichts, der Punkt taucht also erst auf, wenn es
  // etwas anzuzeigen gibt.
  if (!streamMode()) return
  // Runs after the module's own renderSceneControls handler, which is what puts
  // the button in its final place.
  Hooks.on("renderSceneControls", () => paint())
  onStreamState(() => paint())
  Hooks.once("ready", () => paint())
}
