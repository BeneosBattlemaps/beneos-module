// Beneos "Beneos Comment" hover panel on the dnd5e NPC sheet.
//
// When the GM hovers an ability/feature row that has a Beneos summary, a small
// panel labelled "Beneos Comment" docks flush under the default dnd5e rich
// tooltip: same left edge, same width, its top edge on the tooltip's bottom
// edge. The default tooltip keeps showing the real mechanics; this adds the
// Beneos author note directly below it so the two read as one card. Abilities
// without a Beneos summary show nothing extra.
//
// The panel keeps no schedule of its own. While a native tooltip is up the
// panel is a pure function of that tooltip's state: what it is anchored to
// decides the content, where it sits decides the position, and its `active`
// class decides visibility. That is what makes all three of Foundry's timings
// fall out for free, without reimplementing any of them:
//   - first hover      -> activates after TOOLTIP_ACTIVATION_MS, both fade in
//   - move to another  -> the core swaps instantly, so does the panel
//   - pointer leaves   -> the core waits out its deactivation grace, so do we
// The core fires no hook for any of it, so we observe the element the same way
// dnd5e does (Tooltips5e#observe). Docking re-runs on every observed change
// because dnd5e loads the tooltip body asynchronously and the box grows once
// it arrives.
//
// Only the fallback for rows that have no native tooltip at all is driven by
// pointer events and a timer of our own.

import { getAbilitySummary } from "./creature-codex.mjs";
import { summaryToTooltipHtml } from "../codex/codex-data-adapter.mjs";

const HEADING_KEY = "BENEOS.CreatureCodex.Ability.BeneosCommentHeading";
const WIRED_SELECTOR = '[data-beneos-comment-wired="1"]';

// Extra grace on top of the core activation delay before the fallback kicks
// in. Both timers start on the same pointerover, so without it ours could win
// the race and flash the fallback position for one frame.
const FALLBACK_GRACE_MS = 150;

const _actors = new WeakMap();  // wired sheet root -> actor

let _panel = null;         // single reused floating element
let _renderedId = null;    // item whose html is currently in the panel
let _fallbackRow = null;   // row the fallback is showing for, null when mirroring
let _fallbackTimer = null;
let _hideTimer = null;
let _rafId = null;
let _observing = false;

function _ensurePanel() {
  if (_panel && document.body.contains(_panel)) return _panel;
  _panel = document.createElement("div");
  _panel.className = "beneos-comment-pop";
  document.body.appendChild(_panel);
  _renderedId = null;
  return _panel;
}

function _nativeTooltip() {
  // Resolved per call rather than cached: in V14 the core adopts #tooltip into
  // whichever document owns the hovered element, so a cached reference can go
  // stale. Detached windows are not supported here; we simply find nothing and
  // the panel stays hidden instead of docking to the wrong place.
  return document.getElementById("tooltip");
}

function _activationMs() {
  const TM = foundry.helpers?.interaction?.TooltipManager ?? globalThis.TooltipManager;
  return TM?.TOOLTIP_ACTIVATION_MS ?? 500;
}

/** The item row the core tooltip is currently anchored to, if any. */
function _nativeRow() {
  return game.tooltip?.element?.closest?.("[data-item-id]") ?? null;
}

/** Beneos summary for a row, or null when the row is not ours or has none. */
function _summaryForRow(row) {
  if (!row) return null;
  const root = row.closest(WIRED_SELECTOR);
  const actor = root ? _actors.get(root) : null;
  if (!actor) return null;
  const itemId = row.dataset.itemId;
  const item = itemId ? actor.items?.get?.(itemId) : null;
  const summary = item ? getAbilitySummary(actor, item) : "";
  return summary ? { root, itemId, summary } : null;
}

function _renderContent(panel, itemId, summary) {
  if (_renderedId === itemId) return;
  const heading = game.i18n.localize(HEADING_KEY);
  panel.innerHTML =
    `<div class="beneos-comment-pop-head">${heading}</div>` +
    `<div class="beneos-comment-pop-body">${summaryToTooltipHtml(summary)}</div>`;
  _renderedId = itemId;
}

function _setShown(on) {
  if (_panel) _panel.classList.toggle("active", on);
}

/**
 * Dock flush under the native tooltip. The width is copied from the measured
 * box on every call so the two always read as one card, even after the async
 * body has grown it. When there is no room below, the panel flips above the
 * tooltip instead of being clamped upward into it.
 */
function _dockToNative(panel, rect) {
  panel.style.width = `${Math.round(rect.width)}px`;
  const pr = panel.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = Math.round(rect.bottom);
  if (top + pr.height > vh) {
    // Ceil the height and floor the anchor so a fractional box height can
    // never round the panel a pixel back into the tooltip it sits above.
    const above = Math.floor(rect.top) - Math.ceil(pr.height);
    top = (above >= 0) ? above : Math.max(0, Math.floor(vh - pr.height));
  }
  let left = Math.round(rect.left);
  if (left + pr.width > vw) left = Math.round(vw - pr.width);
  if (left < 0) left = 0;

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

/** No native tooltip on this row: fall back to the sheet's left edge, below
 *  the hovered row, so the tactical guide is never lost. */
function _dockToRow(panel, root, row) {
  panel.style.width = "";
  const sheetRect = root.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  let left = Math.round(sheetRect.left);
  let top = Math.round(rowRect.bottom + 6);
  if (left + pr.width > window.innerWidth) left = Math.round(window.innerWidth - pr.width - 8);
  if (left < 4) left = 4;
  if (top + pr.height > window.innerHeight) top = Math.round(window.innerHeight - pr.height - 8);
  if (top < 4) top = 4;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

/**
 * Bring the panel in line with the core tooltip. Content and position are
 * written together so a row swap never shows the new text at the old spot.
 */
function _sync() {
  const panel = _panel;
  if (!panel) return;
  const tip = _nativeTooltip();
  const info = (tip && tip.classList.contains("active")) ? _summaryForRow(_nativeRow()) : null;

  if (!info) {
    // The core is hidden, or anchored to something without a Beneos summary.
    // Leave the fallback alone; its own timers own that case.
    if (!_fallbackRow) _setShown(false);
    return;
  }

  // A native tooltip won, so the fallback is off the table.
  if (_fallbackTimer) { clearTimeout(_fallbackTimer); _fallbackTimer = null; }
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  _fallbackRow = null;

  _renderContent(panel, info.itemId, info.summary);
  _dockToNative(panel, tip.getBoundingClientRect());
  _setShown(true);
}

// Measure after layout has settled: the core documents the same reflow caveat
// in lockTooltip() and also defers to requestAnimationFrame.
function _scheduleSync() {
  if (_rafId) return;
  _rafId = requestAnimationFrame(() => { _rafId = null; _sync(); });
}

function _ensureObservers() {
  if (_observing) return;
  const tip = _nativeTooltip();
  if (!tip) return;
  _observing = true;
  // class -> activation and deactivation, style -> the core re-anchoring via
  // _setAnchor, size -> dnd5e swapping the spinner for the real body.
  new MutationObserver(_scheduleSync).observe(tip, { attributeFilter: ["class", "style"] });
  if (globalThis.ResizeObserver) new ResizeObserver(_scheduleSync).observe(tip);
}

function _clearTimers() {
  if (_fallbackTimer) { clearTimeout(_fallbackTimer); _fallbackTimer = null; }
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
}

/** Hard hide, used when the sheet goes away. */
function _hide() {
  _clearTimers();
  _fallbackRow = null;
  _setShown(false);
}

function _enter(info, row) {
  // Rows on an inactive sheet tab have no box. They cannot be hovered for
  // real, but a synthetic event would anchor to a 0x0 rect and send the panel
  // somewhere arbitrary, so bail out rather than dock to nonsense.
  if (!row.getClientRects().length) return;
  const panel = _ensurePanel();
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }

  // If a tooltip is already up this resolves on the very next frame (instant
  // swap); otherwise the observer picks it up once the core activates.
  _scheduleSync();

  if (_fallbackTimer) clearTimeout(_fallbackTimer);
  _fallbackTimer = setTimeout(() => {
    _fallbackTimer = null;
    const tip = _nativeTooltip();
    if (tip?.classList.contains("active") && _nativeRow() === row) return;
    _fallbackRow = row;
    _renderContent(panel, info.itemId, info.summary);
    _dockToRow(panel, info.root, row);
    _setShown(true);
  }, _activationMs() + FALLBACK_GRACE_MS);
}

function _leave() {
  if (_fallbackTimer) { clearTimeout(_fallbackTimer); _fallbackTimer = null; }
  if (!_fallbackRow) {
    // Mirroring a native tooltip: the core waits out its own deactivation
    // grace before fading, and the observer relays that. Hiding here would
    // make the panel fade out half a second ahead of the box it belongs to.
    _scheduleSync();
    return;
  }
  // Fallback has no native counterpart to follow, so match the core's grace.
  if (_hideTimer) clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => {
    _hideTimer = null;
    _fallbackRow = null;
    _setShown(false);
  }, _activationMs());
}

Hooks.on("renderActorSheetV2", (sheet, html) => {
  const actor = sheet?.document ?? sheet?.actor;
  const abilities = actor?.flags?.beneos?.content?.abilities;
  if (!Array.isArray(abilities) || !abilities.length) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  _actors.set(root, actor);
  if (root.dataset.beneosCommentWired === "1") return;
  root.dataset.beneosCommentWired = "1";
  _ensurePanel();
  _ensureObservers();

  root.addEventListener("pointerover", (ev) => {
    const row = ev.target?.closest?.("[data-item-id]");
    if (!row || !root.contains(row)) return;
    const info = _summaryForRow(row);
    if (!info) { _leave(); return; }
    _enter(info, row);
  });

  root.addEventListener("pointerout", (ev) => {
    const row = ev.target?.closest?.("[data-item-id]");
    const to = ev.relatedTarget;
    // Keep showing while the pointer stays inside the same item row.
    if (row && to && row.contains(to)) return;
    _leave();
  });
});

Hooks.on("closeActorSheetV2", () => _hide());
