/* =============================================================
   Beneos Creature Codex — ESM entry point + Hook-Wires.
   Welle 2.1: pre-register partial templates so the window renders.
   Welle 3: wire Sheet-Header / Token-HUD / Cloud-V2 Drawer + Card
            context menu — every entry point is `installed`-gated.
   ============================================================= */

import { BeneosCreatureCodexWindow } from "./codex-window.mjs"
import { getCodexDataForActor, getCodexDataForCloudPreview, hasV13CodexContent } from "./codex-data-adapter.mjs"
import { maybeOpenDeathPrompt, BeneosCodexDeathPrompt } from "./codex-death-prompt.mjs"

const CODEX_TEMPLATE_ROOT = "modules/beneos-module/templates/codex"

const CODEX_PARTIALS = [
  // Welle 5b master-mock layout
  `${CODEX_TEMPLATE_ROOT}/parts/hero.hbs`,
  `${CODEX_TEMPLATE_ROOT}/parts/tab-overview.hbs`,
  `${CODEX_TEMPLATE_ROOT}/parts/tab-hooks.hbs`,
  `${CODEX_TEMPLATE_ROOT}/parts/tab-foreshadow.hbs`,
  `${CODEX_TEMPLATE_ROOT}/parts/tab-theater.hbs`,
  `${CODEX_TEMPLATE_ROOT}/parts/tab-tactics.hbs`,
  `${CODEX_TEMPLATE_ROOT}/parts/partials/tac-rule.hbs`,
  `${CODEX_TEMPLATE_ROOT}/parts/partials/tac-inline.hbs`,
  // Legacy partials (still loaded so unused referenced kept resolving)
  `${CODEX_TEMPLATE_ROOT}/parts/partials/empty-section.hbs`,
  `${CODEX_TEMPLATE_ROOT}/parts/partials/source-chip.hbs`,
  `${CODEX_TEMPLATE_ROOT}/parts/entry-editor.hbs`,
  // Welle 5e — Death-Prompt popup template
  `${CODEX_TEMPLATE_ROOT}/parts/death-prompt.hbs`
]

/** Linear scan over `game.actors` for an Actor whose `world.beneos`
 *  flag identifies it as the given token-key. This is the "is installed?"
 *  check for cloud-V2 call sites — when this returns null, the codex
 *  button must not appear / fire. */
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
// Welle 2.1 — Pre-register Handlebars partials
// =========================================================

Hooks.once("init", async () => {
  try {
    const loader = foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates
    if (typeof loader === "function") {
      await loader(CODEX_PARTIALS)
      console.log(`[beneos-codex] pre-registered ${CODEX_PARTIALS.length} partials`)
    } else {
      console.warn("[beneos-codex] no loadTemplates available — partials may fail to render")
    }
  } catch (err) {
    console.error("[beneos-codex] partial pre-registration failed", err)
  }

  // Welle 5b — register the small set of helpers the master-mock
  // templates rely on. `typeof` distinguishes plain strings from chip
  // objects in TacText arrays; `or` lets tac-inline.hbs detect any of
  // the three rollable kinds in one expression; `padTwo` formats the
  // foreshadow numbers (1 → "01").
  if (typeof Handlebars !== "undefined") {
    Handlebars.registerHelper("typeof", (v) => typeof v)
    Handlebars.registerHelper("or", function (...args) {
      args.pop() // Handlebars options
      return args.some(Boolean)
    })
    Handlebars.registerHelper("padTwo", (n) => String(n).padStart(2, "0"))
    // Welle 5g — `add`/`sub` aren't bundled with Foundry V13's Handlebars
    // helper set; Beneos has only `beneosAdd`. Register the bare names
    // defensively so the codex templates' `{{add @index 1}}` resolve.
    // Skip registration when another module already owns the helper.
    if (!Handlebars.helpers?.add) {
      Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b))
    }
    if (!Handlebars.helpers?.sub) {
      Handlebars.registerHelper("sub", (a, b) => Number(a) - Number(b))
    }
    // `eq` is provided by Foundry itself, but registering a fallback is
    // harmless and protects against env quirks (e.g. test harnesses).
    if (!Handlebars.helpers?.eq) {
      Handlebars.registerHelper("eq", (a, b) => a === b)
    }
  }

  // Welle 5e — register module settings the death-prompt + theater
  // services consult. Registered defensively so reloading the module
  // doesn't crash on duplicate registration.
  try {
    if (!game.settings?.settings?.has("beneos-module.codex-death-popup")) {
      game.settings.register("beneos-module", "codex-death-popup", {
        name: "BENEOS.CreatureCodex.Settings.DeathPopup",
        hint: "BENEOS.CreatureCodex.Settings.DeathPopupHint",
        scope: "world", config: true, type: Boolean, default: true
      })
    }
    if (!game.settings?.settings?.has("beneos-module.codex-tts")) {
      game.settings.register("beneos-module", "codex-tts", {
        name: "BENEOS.CreatureCodex.Settings.TTS",
        hint: "BENEOS.CreatureCodex.Settings.TTSHint",
        scope: "client", config: true, type: Boolean, default: false
      })
    }
  } catch (err) {
    console.warn("[beneos-codex] settings registration failed", err)
  }

  // F12 ergonomy: expose the codex under the existing Beneos namespace.
  game.beneos = game.beneos ?? {}
  game.beneos.codex = {
    Window: BeneosCreatureCodexWindow,
    open: ({ actor = null, codexData = null, readonly = false } = {}) =>
      new BeneosCreatureCodexWindow({ actor, codexData, readonly }).render({ force: true }),
    openForActor: async (actor, { readonly = false } = {}) => {
      if (!actor) throw new Error("[beneos-codex] openForActor: actor required")
      const codexData = await getCodexDataForActor(actor)
      return new BeneosCreatureCodexWindow({ actor, codexData, readonly }).render({ force: true })
    },
    openCloudPreview: async (tokenKey) => {
      const codexData = await getCodexDataForCloudPreview(tokenKey)
      return new BeneosCreatureCodexWindow({ actor: null, codexData, readonly: true }).render({ force: true })
    },
    /** Welle 5e — manually trigger a death prompt (used by the
     *  Theater tab's "Trigger" button and by tests / dev). */
    openDeathPrompt: async (actor) => {
      if (!actor) return
      const codexData = await getCodexDataForActor(actor)
      return new BeneosCodexDeathPrompt({ codexData, actor }).render({ force: true })
    },
    findActorByTokenKey
  }
})

// Welle 5e — auto-fire when HP drops to 0. `preUpdateActor` is the
// safest hook: it fires before Foundry has committed the change,
// so we can compare old vs new HP without observing the post-state.
Hooks.on("preUpdateActor", (actor, changes) => {
  maybeOpenDeathPrompt(actor, changes).catch(err =>
    console.error("[beneos-codex] death-prompt auto-fire failed", err))
})

// =========================================================
// Welle 3 — Aufrufpunkt 1: Actor-Sheet-Header
// =========================================================

Hooks.on("renderActorSheet", (sheet, html) => {
  if (!sheet?.actor) return
  const util = beneosUtility()
  // Same gate as Cloud-V2: only Beneos-imported creatures get the surface.
  if (!util?.checkIsBeneosToken?.({ actor: sheet.actor })) return
  // Iter 13a — additional gate: only show the codex surfaces for actors
  // that carry structured v1.3 content under flags.beneos.content. SRD
  // creatures and any un-migrated actors fall back to the standard
  // Foundry sheet (biography.value renders there as before).
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
  // Beneos-creatures get an additional, more prominent surface in the
  // sheet's own nav.tabs strip. No `data-tab` attribute → does NOT
  // participate in Foundry's tab-switch state machine.
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
// Welle 3 — Aufrufpunkt 2: Token-HUD
// Welle 3.2 — Consolidated. Instead of injecting a second HUD icon we
// repurpose the existing Beneos "Open Token Journal" button in
// beneos_module.js:262-277 (its click handler now routes through the
// codex). No separate `.beneos-codex-hud` element is rendered.
// =========================================================

// =========================================================
// Welle 3 — Aufrufpunkt 3 & 4: Cloud-V2 Drawer + Card Context
// Both call sites live on the same hook so a single render pass wires
// them together. Installed-gating is enforced via:
//   (a) the drawer button reads `selectedAssetKey` from the app and
//       checks `findActorByTokenKey` before injecting,
//   (b) the context menu's selector is `.bc-result-card.bc-card-installed`
//       so non-installed cards never see the menu in the first place.
// =========================================================

Hooks.on("renderBeneosCloudWindowV2", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0]
  if (!root) return

  // ----- Aufrufpunkt 3: Detail drawer "Open Codex" button -----
  injectDrawerCodexButton(app, root)

  // ----- Aufrufpunkt 4: Right-click context menu on installed cards -----
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
  if (!hasV13CodexContent(actor)) return // Iter 13a — no v1.3 content → no codex

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
    if (!hasV13CodexContent(actor)) return // Iter 13a — no v1.3 content → no codex menu
    ev.preventDefault()
    ev.stopPropagation()
    showCodexFloatingMenu(ev.clientX, ev.clientY, actor)
  })
}

/** Show a small floating menu anchored at the cursor (Windows-style).
 *  Welle 3.2 — Backdrop + `pointerdown` pattern. The previous
 *  document-level click listener could race with Foundry's own capture
 *  handlers and close the menu before our action handler fired. A
 *  full-screen transparent backdrop owns outside-click detection in
 *  its own DOM subtree, and `pointerdown` on the menu item fires
 *  before any `click` bubbling so the codex opens reliably. */
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

export { BeneosCreatureCodexWindow, getCodexDataForActor, getCodexDataForCloudPreview, findActorByTokenKey }
