/* =============================================================
   Beneos Codex, entry-point wiring (cloud-v2 drawer button,
   cloud-v2 card context menu).

   These surfaces all route through `game.beneos.codex.openForActor`,
   which beneos-codex-init.mjs points at the v2 windows. The wiring
   lives here (codex2) so the legacy codex/ tree can be removed.

   DER EINSTIEG AM ACTOR-BOGEN LIEGT NICHT HIER. Er steht in
   `beneos_module.js` am Haken `renderActorSheetV2` und haengt einen
   Knopf mit dem Beneos-Logo in `nav.tabs`. Bis zum 08.11.2026 stand
   hier ein zweiter, und der ist nie gelaufen: `renderActorSheet`
   feuert in Foundry 13 mit dnd5e 5.3.3 null mal, und `.app` trifft am
   v13-Fenster ebenfalls null mal, dort heisst es `.application`.
   Gemessen in `TC-PRJ-STR-273`: der Knopf erschien 0 mal, und
   `fa-book-skull` stand 0 mal im Dokument.

   Betreiberentscheid 08.11.2026: entfernt statt richtiggestellt. Eine
   richtiggestellte Fassung haette zwei Flaechen mit zwei verschiedenen
   Symbolen fuer dieselbe Funktion ergeben, und sie haette
   `beneos_module.js:238` mitgezogen, das `sheet.template.includes()`
   liest, waehrend `sheet.template` am v13-Bogen null ist.
   ============================================================= */

import { hasV13CodexContent } from "../codex/codex-data-adapter.mjs"

/** Linear scan over `game.actors` for an Actor whose `world.beneos`
 *  flag identifies it as the given token-key. Used by the cloud-v2
 *  call sites to gate the codex surfaces to installed creatures. */
function findActorByTokenKey(tokenKey) {
  if (!tokenKey || !game.actors) return null
  for (const actor of game.actors) {
    const f = actor.getFlag?.("world", "beneos")
    if (f && (f.fullId === tokenKey || f.tokenKey === tokenKey)) return actor
  }
  return null
}

// =========================================================
// Aufrufpunkt 1 & 2: Cloud-V2 Drawer button + Card context menu
// Both call sites live on the same hook so a single render pass wires
// them together. Installed-gating is enforced via findActorByTokenKey
// (drawer) and the `.bc-card-installed` selector (context menu).
// =========================================================

Hooks.on("renderBeneosCloudWindowV2", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0]
  if (!root) return
  injectDrawerCodexButton(app, root)
  wireCardContextMenu(app, root)
})

function injectDrawerCodexButton(app, root) {
  const drawer = root.querySelector(".bc-detail-drawer")
  if (!drawer) return
  const actionRow = drawer.querySelector(".bc-drawer-action") ?? drawer.querySelector(".bc-drawer-actions")
  if (!actionRow) return

  // Idempotent, Cloud-V2 re-renders this region on every drawer change.
  // We rebuild the button instead of bailing so the bound tokenKey
  // always matches the currently-shown asset.
  actionRow.querySelector(".bc-action-open-codex")?.remove()

  const tokenKey = app?.selectedAssetKey ?? drawer.dataset?.assetKey
  if (!tokenKey) return
  const actor = findActorByTokenKey(tokenKey)
  if (!actor) return // not installed → no button
  if (!hasV13CodexContent(actor)) return // no structured content → no codex

  const title = game.i18n.localize("BENEOS.CreatureCodex.OpenCodex")
                ?? game.i18n.localize("BENEOS.CreatureCodex.WindowTitle")
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = "bc-action-open-codex bc-btn"
  btn.dataset.tokenKey = tokenKey
  btn.innerHTML = `<i class="fa-solid fa-book-skull"></i> ${title}`
  btn.addEventListener("click", (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    game.beneos.codex.openForActor(actor).catch(err =>
      console.error("[beneos-codex] drawer-open failed", err))
  })
  actionRow.appendChild(btn)
}

function wireCardContextMenu(_app, root) {
  const resultList = root.querySelector(".bc-result-list")
  if (!resultList) return
  // Cloud-V2 re-renders the entire results region on each search, but
  // the .bc-result-list element identity is preserved within a single
  // hook tick. Use a marker attribute to avoid double-wiring.
  if (resultList.dataset.codexContextWired === "1") return
  resultList.dataset.codexContextWired = "1"

  resultList.addEventListener("contextmenu", (ev) => {
    const card = ev.target.closest?.(".bc-result-card.bc-card-installed")
    if (!card) return
    const tokenKey = card.dataset.assetKey ?? card.dataset.tokenKey
    const actor = findActorByTokenKey(tokenKey)
    if (!actor) return
    if (!hasV13CodexContent(actor)) return // no structured content → no codex menu
    ev.preventDefault()
    ev.stopPropagation()
    showCodexFloatingMenu(ev.clientX, ev.clientY, actor)
  })
}

/** Show a small floating menu anchored at the cursor. A full-screen
 *  transparent backdrop owns outside-click detection in its own DOM
 *  subtree, and `pointerdown` on the menu item fires before any `click`
 *  bubbling so the codex opens reliably. */
function showCodexFloatingMenu(x, y, actor) {
  document.querySelector(".beneos-codex-floating-backdrop")?.remove()

  const label = game.i18n.localize("BENEOS.CreatureCodex.OpenCodex")
              ?? game.i18n.localize("BENEOS.CreatureCodex.WindowTitle")

  const backdrop = document.createElement("div")
  backdrop.className = "beneos-codex-floating-backdrop"

  const menu = document.createElement("div")
  menu.className = "beneos-codex-floating-menu"
  menu.style.cssText = `position:fixed; left:${x}px; top:${y}px; z-index:10000;`
  menu.innerHTML = `
    <button type="button" class="bc-floating-item">
      <i class="fa-solid fa-book-skull"></i>
      <span>${label}</span>
    </button>`

  backdrop.appendChild(menu)
  document.body.appendChild(backdrop)

  // Clamp to viewport so the menu never overflows the screen.
  const rect = menu.getBoundingClientRect()
  if (rect.right > window.innerWidth)  menu.style.left = `${window.innerWidth  - rect.width  - 8}px`
  if (rect.bottom > window.innerHeight) menu.style.top  = `${window.innerHeight - rect.height - 8}px`

  let isOpen = true
  const close = () => {
    if (!isOpen) return
    isOpen = false
    backdrop.remove()
    document.removeEventListener("keydown", onKey, true)
    window.removeEventListener("blur", close, true)
  }
  const onKey = (e) => { if (e.key === "Escape") close() }

  // Backdrop owns outside-click + outside-contextmenu detection.
  backdrop.addEventListener("pointerdown", (e) => {
    if (!menu.contains(e.target)) close()
  })
  backdrop.addEventListener("contextmenu", (e) => {
    if (!menu.contains(e.target)) { e.preventDefault(); close() }
  })

  // Action handler also on pointerdown, beats any bubbling click that
  // Foundry could intercept first.
  menu.querySelector(".bc-floating-item").addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return // left button only
    e.preventDefault()
    e.stopPropagation()
    close()
    game.beneos.codex.openForActor(actor).catch(err =>
      console.error("[beneos-codex] floating-menu open failed", err))
  })

  document.addEventListener("keydown", onKey, true)
  window.addEventListener("blur", close, true)
}

export { findActorByTokenKey }
