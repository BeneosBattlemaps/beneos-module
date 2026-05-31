/* =============================================================
   Beneos Codex — entry-point wiring (sheet header, sheet tab,
   cloud-v2 drawer button, cloud-v2 card context menu).

   These surfaces all route through `game.beneos.codex.openForActor`,
   which beneos-codex-init.mjs points at the v2 windows. The wiring
   lives here (codex2) so the legacy codex/ tree can be removed.
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

/** Resolve the BeneosUtility namespace lazily so this module can load
 *  in any ESM evaluation order without crashing if beneos_utility.js
 *  hasn't initialised yet. */
function beneosUtility() {
  return globalThis.BeneosUtility ?? null
}

// =========================================================
// Aufrufpunkt 1: Actor-Sheet-Header + tab-bar action button
// =========================================================

Hooks.on("renderActorSheet", (sheet, html) => {
  if (!sheet?.actor) return
  const util = beneosUtility()
  // Same gate as Cloud-V2: only Beneos-imported creatures get the surface.
  if (!util?.checkIsBeneosToken?.({ actor: sheet.actor })) return
  // Only show the codex surfaces for actors that carry structured
  // content under flags.beneos.content. SRD creatures and un-migrated
  // actors fall back to the standard Foundry sheet.
  if (!hasV13CodexContent(sheet.actor)) return

  const $html = html instanceof jQuery ? html : $(html)
  const $window = $html.closest(".app")
  const title = game.i18n.localize("BENEOS.CreatureCodex.WindowTitle")

  // -------- Surface 1: window-header icon --------
  if (!$window.find(".beneos-codex-btn").length) {
    const btn = $(
      `<a class="header-button beneos-codex-btn" data-tooltip="${title}" aria-label="${title}">
         <i class="fa-solid fa-book-skull"></i>
       </a>`
    )
    btn.on("click", (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      game.beneos.codex.openForActor(sheet.actor).catch(err =>
        console.error("[beneos-codex] openForActor failed", err))
    })
    $window.find(".window-header .window-title").after(btn)
  }

  // -------- Surface 2: tab-bar action button --------
  // No `data-tab` attribute → does NOT participate in Foundry's
  // tab-switch state machine.
  const root = html instanceof jQuery ? html[0] : html
  const tabNav = root?.querySelector?.("nav.tabs") || root?.querySelector?.(".sheet-tabs")
  if (tabNav && !tabNav.querySelector(".beneos-sheet-codex-tab")) {
    const tab = document.createElement("a")
    tab.className = "item beneos-sheet-codex-tab"
    tab.dataset.tooltip = title
    tab.setAttribute("aria-label", title)
    tab.innerHTML = '<i class="fa-solid fa-book-skull"></i>'
    tab.addEventListener("click", (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      game.beneos.codex.openForActor(sheet.actor).catch(err =>
        console.error("[beneos-codex] sheet-tab open failed", err))
    })
    tabNav.appendChild(tab)
  }
})

// =========================================================
// Aufrufpunkt 2 & 3: Cloud-V2 Drawer button + Card context menu
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

  // Idempotent — Cloud-V2 re-renders this region on every drawer change.
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

  // Action handler also on pointerdown — beats any bubbling click that
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
