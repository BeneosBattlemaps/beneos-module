// Beneos "Beneos Comment" hover panel on the dnd5e NPC sheet.
//
// When the GM hovers an ability/feature row that has a Beneos summary, a
// small panel labelled "Beneos Comment" appears below the default Foundry
// rich tooltip, anchored at the sheet's left edge. The default dnd5e tooltip
// keeps showing the real mechanics; this adds the Beneos author note next to
// it so the reader can use whichever framing suits them. Abilities without a
// Beneos summary show nothing extra.

import { getAbilitySummary } from "./creature-codex.mjs";
import { summaryToTooltipHtml } from "../codex/codex-data-adapter.mjs";

const HEADING_KEY = "BENEOS.CreatureCodex.Ability.BeneosCommentHeading";

let _panel = null;       // single reused floating element
let _showTimer = null;   // reposition-after-tooltip timer
let _currentId = null;   // item currently shown, so re-hovers are no-ops

function _ensurePanel() {
  if (_panel && document.body.contains(_panel)) return _panel;
  _panel = document.createElement("div");
  _panel.className = "beneos-comment-pop";
  _panel.style.display = "none";
  document.body.appendChild(_panel);
  return _panel;
}

function _hide() {
  if (_showTimer) { clearTimeout(_showTimer); _showTimer = null; }
  _currentId = null;
  if (_panel) _panel.style.display = "none";
}

// Anchor x at the sheet's left edge, y just below the default tooltip if it
// is visible (else below the hovered row). Clamp into the viewport.
function _position(panel, sheetEl, rowEl) {
  const sheetRect = sheetEl.getBoundingClientRect();
  const tip = document.getElementById("tooltip");
  const tipRect = tip ? tip.getBoundingClientRect() : null;
  const tipVisible = !!tipRect && tipRect.height > 2 && tip.classList.contains("active");
  const rowRect = rowEl.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  let left = Math.round(sheetRect.left);
  let top = Math.round((tipVisible ? tipRect.bottom : rowRect.bottom) + 6);
  if (left + pr.width > window.innerWidth) left = window.innerWidth - pr.width - 8;
  if (left < 4) left = 4;
  if (top + pr.height > window.innerHeight) top = window.innerHeight - pr.height - 8;
  if (top < 4) top = 4;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function _show(summary, sheetEl, rowEl, itemId) {
  const panel = _ensurePanel();
  if (_currentId === itemId && panel.style.display === "block") return;
  _currentId = itemId;
  const heading = game.i18n.localize(HEADING_KEY);
  panel.innerHTML =
    `<div class="beneos-comment-pop-head">${heading}</div>` +
    `<div class="beneos-comment-pop-body">${summaryToTooltipHtml(summary)}</div>`;
  panel.style.display = "block";
  _position(panel, sheetEl, rowEl);
  // The Foundry tooltip activates after a short hover delay, so reposition
  // once it has had time to appear and snap below it.
  if (_showTimer) clearTimeout(_showTimer);
  _showTimer = setTimeout(() => {
    if (panel.style.display === "block") _position(panel, sheetEl, rowEl);
  }, 340);
}

Hooks.on("renderActorSheetV2", (sheet, html) => {
  const actor = sheet?.document ?? sheet?.actor;
  const abilities = actor?.flags?.beneos?.content?.abilities;
  if (!Array.isArray(abilities) || !abilities.length) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.dataset.beneosCommentWired === "1") return;
  root.dataset.beneosCommentWired = "1";

  root.addEventListener("pointerover", (ev) => {
    const row = ev.target?.closest?.("[data-item-id]");
    if (!row || !root.contains(row)) return;
    const itemId = row.dataset.itemId;
    if (!itemId) return;
    const item = actor.items?.get?.(itemId);
    const summary = item ? getAbilitySummary(actor, item) : "";
    if (!summary) { _hide(); return; }
    _show(summary, root, row, itemId);
  });

  root.addEventListener("pointerout", (ev) => {
    const row = ev.target?.closest?.("[data-item-id]");
    const to = ev.relatedTarget;
    // Keep showing while the pointer stays inside the same item row.
    if (row && to && row.contains(to)) return;
    _hide();
  });
});

Hooks.on("closeActorSheetV2", () => _hide());
