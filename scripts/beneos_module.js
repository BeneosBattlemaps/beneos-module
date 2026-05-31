import "./beneos_tours.js";
import { libWrapper } from "./shim.js";
import { BeneosUtility } from "./beneos_utility.js";
import { BeneosModuleMenu, BeneosDatabaseHolder } from "./beneos_search_engine.js";
import { BeneosCloud } from "./beneos_cloud.js";
import { BeneosFXEngine } from "./cloud-v2/beneos-fx.mjs";
import { BeneosFXEditor } from "./cloud-v2/beneos-fx-editor.mjs";
import { BeneosCloudWindowV2 } from "./cloud-v2/cloud-window-v2.mjs";
import { OriginsRegistry } from "./loot/origins-registry.mjs";
import { ItemSheetExtender } from "./loot/item-sheet-extender.mjs";
import { ActorSetBonusTab } from "./loot/actor-set-bonus-tab.mjs";
import { CharacterInventoryOriginIcon } from "./loot/character-inventory-origin-icon.mjs";
// Unused : import { BeneosTableTop } from "./beneos-table-top.js";

/********************************************************************************** */
// Chromium emits a benign "ResizeObserver loop ..." error when an observer
// callback triggers further layout in the same frame. It breaks nothing but
// clutters the console (e.g. while the codex PDF viewer relayouts). Swallow
// only that exact message; every other error passes through untouched.
window.addEventListener("error", (event) => {
  if (/ResizeObserver loop (limit exceeded|completed)/.test(event?.message ?? "")) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
});

/********************************************************************************** */
Hooks.once('init', () => {

  game.beneos = {
    BeneosUtility,
    cloud: new BeneosCloud(),
    // Stage 13d-11: expose FX engine for the FX master-disable setting's
    // onChange handler in beneos_utility.js (avoids a circular import).
    fx: BeneosFXEngine,
  }

  BeneosUtility.registerSettings()
  BeneosUtility.setupSocket()
  //BeneosTableTop.init()

  // dnd5e 5.3.x's NPCData.prepareBaseData unconditionally calls
  // `this.parent.getCRExp(cr)`. When Moulinette imports older-system actors
  // (_stats.systemVersion < current), the transient instance constructed by
  // Actor.fromImport occasionally lacks the method, polluting the log with
  // non-fatal "this.parent.getCRExp is not a function" errors. Install a
  // fallback on the BASE Actor prototype mirroring dnd5e's own implementation.
  // Actor5e keeps its own override on its class prototype, so live actors are
  // unaffected — this only catches the brief import-time gap.
  try {
    const BaseActor = foundry?.documents?.Actor ?? globalThis.Actor;
    if (BaseActor && !Object.prototype.hasOwnProperty.call(BaseActor.prototype, "getCRExp")) {
      BaseActor.prototype.getCRExp = function(cr) {
        if (cr === null || cr === undefined) return null;
        if (cr < 1) return Math.max(200 * cr, 10);
        const levels = CONFIG?.DND5E?.CR_EXP_LEVELS;
        if (!levels) return 0;
        return levels[cr] ?? Object.values(levels).pop();
      };
    }
  } catch (e) {
    console.warn("Beneos | getCRExp shim install failed:", e);
  }

  // State-aware label for the "Beneos Cloud Account" settings menu.
  // registerMenu() takes a static i18n key, so we patch the rendered
  // label in-place on every SettingsConfig render. Targets both the
  // V1 jQuery payload and the V2 HTMLElement payload defensively.
  const patchCloudAccountLabel = (root) => {
    try {
      const dom = root?.jquery ? root[0] : root
      if (!(dom instanceof HTMLElement) && !(dom instanceof DocumentFragment)) return
      const button = dom.querySelector('button[data-key="beneos-module.beneos-cloud-account"]')
                  ?? dom.querySelector('[data-key="beneos-module.beneos-cloud-account"] button')
                  ?? dom.querySelector('[data-key="beneos-module.beneos-cloud-account"]')
      if (!button) return
      const loggedIn = !!game.beneos?.cloud?.isLoggedIn?.()
      const key = loggedIn
        ? "BENEOS.Settings.CloudAccount.LabelLoggedIn"
        : "BENEOS.Settings.CloudAccount.LabelLoggedOut"
      const label = game.i18n.localize(key)
      // Replace only the text node so any existing <i> icon stays intact.
      let replaced = false
      for (const node of button.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          node.textContent = ` ${label}`
          replaced = true
          break
        }
      }
      if (!replaced) button.textContent = label
    } catch (e) {
      console.warn("Beneos | cloud-account label patch failed:", e)
    }
  }
  Hooks.on("renderSettingsConfig", (_app, html) => patchCloudAccountLabel(html))

})

/********************************************************************************** */
Hooks.once('ready', () => {

  BeneosUtility.debugMessage("----------------------------------------------")
  BeneosUtility.debugMessage(`Loading ${BeneosUtility.moduleName()} module...`)
  BeneosUtility.debugMessage("----------------------------------------------")

  try {
    const perfOn = game.settings.get(BENEOS_MODULE_ID, 'beneos-performance-mode')
    document.body.classList.toggle('beneos-perf-mode', !!perfOn)
  } catch (e) { /* setting may not be registered yet on very first install */ }

  BeneosUtility.forgeInit()

  game.beneosTokens = {
    moduleId: BENEOS_MODULE_ID,
    BeneosUtility,
    //BeneosTableTop,
  }
  BeneosUtility.ready()

  // Eagerly populate game.beneos.databaseHolder so hooks like preCreateActor
  // can use it even if the Search Engine UI hasn't been opened yet. Without
  // this, ZipImporter-driven actor imports crash in the preCreateActor hook
  // because `game.beneos.databaseHolder` is undefined.
  BeneosDatabaseHolder.loadDatabaseFiles().then(() => {
    game.beneos.databaseHolder = BeneosDatabaseHolder;
  }).catch(e => {
    console.warn("Beneos | databaseHolder eager load failed:", e);
  });

  // Load _itemorigins/origins.json into game.beneos.origins for the loot
  // sheet extender and the actor set-bonus tab. Failure is non-fatal:
  // the registry falls back to {} and downstream renderers no-op.
  OriginsRegistry.load().catch(e => {
    console.warn("Beneos | OriginsRegistry eager load failed:", e);
  });

  // Inject Beneos loot extras (Origin badge, Tier chip, Cards) into the
  // item sheet whenever an item carries flags.beneos-module.loot.
  ItemSheetExtender.register();

  // Inject the read-only "Origin Set Bonuses" section into character sheets,
  // showing active Echo / Resonance / Harmony tiers per Origin from attuned
  // Beneos loot items. Re-renders on item attunement changes (debounced).
  ActorSetBonusTab.register();

  // Decorate character-sheet inventory rows with the Origin icon next to
  // the item name for at-a-glance identification of Beneos items.
  CharacterInventoryOriginIcon.register();

  // Live Game Control: preload HBS partials so the LGC window can render
  // its origin-select, distance-radio, direction-picker and ping-card.
  import("./lgc/beneos-lgc.mjs").then(mod => {
    mod.BeneosLiveGameControl?.preloadTemplates?.();
  }).catch(e => console.warn("Beneos | LGC preload failed:", e));
  // Shared Patreon-paywall overlay partial — used by the loot/shop generators,
  // the LGC Item Radar and the codex. Register once globally (full-path partials
  // are NOT auto-loaded at render time), so every gated surface can include it.
  (() => {
    const loader = foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
    try { loader?.(["modules/beneos-module/templates/shared/beneos-paywall.hbs"]); }
    catch (e) { console.warn("Beneos | paywall partial preload failed:", e); }
  })();
  // LGC Socket bridge (ping sound) + ChatMessage card hook (open-sheet
  // click + pulse-stop). Both are no-ops until the first ping is fired.
  import("./lgc/lgc-socket.mjs").then(mod => {
    mod.registerLgcSocket?.();
  }).catch(e => console.warn("Beneos | LGC socket init failed:", e));
  import("./lgc/lgc-chatcard.mjs").then(mod => {
    mod.registerLgcChatcardHook?.();
  }).catch(e => console.warn("Beneos | LGC chatcard hook failed:", e));

  //Token Magic Hack  Replacement to prevent double filters when changing animations
  if (typeof TokenMagic !== 'undefined') {
    let OrigSingleLoadFilters = TokenMagic._singleLoadFilters;
    TokenMagic._singleLoadFilters = async function (placeable, bulkLoading = false) {
      if (BeneosUtility.checkIsBeneosToken(placeable)) return;
      OrigSingleLoadFilters(placeable, bulkLoading);
    }
  } else {
    BeneosUtility.debugMessage("No Token Magic found")
  }

  BeneosUtility.updateSceneTokens()
  //BeneosUtility.checkLockViewPresence()

  // Cloud login is GM-only. Setup-tour-prompt and news popups are
  // orchestrated centrally in beneos_tours.js so at most one window
  // opens per world load (priority: tutorial-tour > setup-prompt > news).
  if (game.user.isGM) {
    game.beneos.cloud.loginAttempt()
  }

  if (game.settings.get(BeneosUtility.moduleID(), "beneos-reload-search-engine")) {
    setTimeout(() => {
      game.settings.set(BeneosUtility.moduleID(), "beneos-reload-search-engine", false)
      new BeneosCloudWindowV2().render({ force: true })
    }, 4000)
  }

  // Try to catch right click on profile image
  Hooks.on('renderActorSheet', (sheet, html, data) => {
    if (!sheet.template && !sheet.constructor?.PARTS) return; // Skip unknown sheet formats (v14+ safety)
    if (!game.user.isGM) return; // GM-only: hide Beneos token menu from players
    if (game.system.id == "pf2e") {
      $("#" + sheet.id + " .image-container .actor-image").mouseup(async function (e) {
        BeneosUtility.prepareMenu(e, sheet)
      })
    } else {
      //console.log("sheet", sheet)
      if (sheet.template.includes("npc-sheet-2.hbs")) {
        $("#" + sheet.id + " .sheet-header .left .portrait").mouseup(async function (e) {
          BeneosUtility.prepareMenu(e, sheet)
        })
      } else {
        $("#" + sheet.id + " .sheet-header .profile").mouseup(async function (e) {
          BeneosUtility.prepareMenu(e, sheet)
        })
      }
    }
  });

  /********************************************************************************** */
  Hooks.on('updateActor', (actor, changeData) => {
    let tokens = canvas.tokens.placeables.filter(t => t.document.actorId == actor.id)
    //console.log(">>>>>>>>><", tokens)
    for (let token of tokens) {
      if (BeneosUtility.checkIsBeneosToken(token)) {
        if (changeData?.system?.attributes?.hp?.value == 0 || changeData?.system?.attributes?.hp?.value > 0) {
          BeneosUtility.updateToken(token.id, changeData)
        }
      }
    }
  })

  /********************************************************************************** */
  Hooks.on('updateToken', (token, changeData) => {
    // Skip texture-only updates: the tour system swaps token images at runtime,
    // and we don't want those swaps to trigger HP/variant downstream logic.
    if (!token || !game.user.isGM || !BeneosUtility.isBeneosModule() || !canvas.ready || changeData.texture?.src != undefined) {
      BeneosUtility.debugMessage("[BENEOS TOKENS] Exit condition")
      return
    }

    if (changeData.delta?.system?.attributes != undefined && changeData.delta.system.attributes?.hp != undefined) {
      BeneosUtility.updateToken(token.id, changeData)
      return
    }
  });

  /********************************************************************************** */
  Hooks.on('createCombatant', (combatant) => {
    if (!game.user.isGM || !BeneosUtility.isBeneosModule() || !canvas.ready) {
      return
    }
    BeneosUtility.debugMessage("[BENEOS TOKENS] Beneos Combat Start Token")
    BeneosUtility.updateToken(combatant.tokenId, {})
  })


  /********************************************************************************** */
  Hooks.on('deleteCombatant', (combatant, data) => {
    if (!game.user.isGM || !BeneosUtility.isBeneosModule() || !canvas.ready) {
      return
    }
    BeneosUtility.debugMessage("[BENEOS TOKENS] Beneos Combat End Token")
    BeneosUtility.updateToken(combatant.tokenId, {})
  })

  /********************************************************************************** */
  Hooks.on('createToken', (token) => {
    if (!game.user.isGM || !BeneosUtility.isBeneosModule()) {
      return
    }
    BeneosUtility.createToken(token)
  })

  /********************************************************************************** */
  Hooks.on('canvasReady', () => {
    if (!game.user.isGM) {
      return
    }
    BeneosUtility.processCanvasReady()
  });

  /********************************************************************************** */
  Hooks.on('controlToken', (token) => {
    if (BeneosUtility.checkIsBeneosToken(token) && typeof (tokenHUDWildcard) == "object") {
      const actor = game.actors.get(token.actorId)
      actor.getTokenImages = async function () {

        let source = "data";
        let index = token.texture.src.lastIndexOf("/") + 1
        let pattern = token.texture.src.substr(0, index) + "*"
        const browseOptions = { wildcard: true }
        if (/\.s3\./.test(pattern)) {
          source = "s3"
          const { bucket, keyPrefix } = FilePicker.parseS3URL(pattern)
          if (bucket) {
            browseOptions.bucket = bucket
            pattern = keyPrefix
          }
        }
        else if (pattern.startsWith("icons/")) source = "public"
        try {
          const content = await FilePicker.browse(source, pattern, browseOptions)
          this._tokenImages = content.files
        } catch (err) {
          this._tokenImages = []
          ui.notifications.error(err)
        }
        return this._tokenImages
      }
    }
  })
})

/********************************************************************************** */
// Add a Beneos Creature-Codex tab to the dnd5e actor sheet (ApplicationV2)
// for Beneos creatures, mirroring the right-click HUD button as an extra
// entry point. Appended to the sheet's tab nav (bottom-right for tabs-right).
Hooks.on('renderActorSheetV2', (sheet, html) => {
  const actor = sheet?.document ?? sheet?.actor
  if (!actor || !BeneosUtility.checkIsBeneosToken(actor)) return
  const root = html instanceof HTMLElement ? html : html?.[0]
  const nav = root?.querySelector?.('nav.tabs[data-group="primary"]')
        ?? root?.querySelector?.('nav.tabs')
        ?? root?.querySelector?.('.sheet-tabs')
  if (!nav || nav.querySelector('.beneos-sheet-codex-tab')) return
  const label = game.i18n.localize('BENEOS.CreatureCodex.SheetTabTooltip')
  const tab = document.createElement('a')
  tab.className = 'item control beneos-sheet-codex-tab'
  tab.dataset.tooltip = label
  tab.setAttribute('aria-label', label)
  tab.innerHTML = '<i class="beneos-icon-logo"></i>'
  tab.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation()
    try { game.beneos?.codex?.openForActor?.(actor) }
    catch (err) { console.error('[beneos-codex] sheet-tab open failed', err) }
  })
  nav.appendChild(tab)
})

/********************************************************************************** */
Hooks.on('renderTokenHUD', async (hud, html, token) => {

  token = BeneosUtility.getToken(token._id)
  if (!game.user.isGM || !BeneosUtility.checkIsBeneosToken(token)) {
    return
  }
  let tokenConfig = BeneosUtility.getTokenImageInfo(token)
  //console.log("Config ?", tokenConfig, token);
  // JOURNAL HUD
  if (tokenConfig?.journalId) {
    let beneosPack = game.packs.get("world.beneos_module_journal")
    if (beneosPack) {
      let beneosJournalEntry = await beneosPack.getDocument(tokenConfig.journalId)
      if (beneosJournalEntry) {
        const beneosJournalDisplay = await foundry.applications.handlebars.renderTemplate('modules/beneos-module/templates/beneosjournal.html',
          { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getBeneosTokenDataPath() })
        $(html).find('div.left').append(beneosJournalDisplay);
        BeneosUtility.debugMessage("Beneos Journal Entry", beneosJournalEntry)
        $(html).find('img.beneosJournalAction').click((event) => {
          event.preventDefault();
          // Welle 3.2: route HUD button through the Creature Codex so
          // the GM gets the curated tabbed view (lore + tags + tactical
          // grid) instead of the raw journal pages. Fall back to the
          // legacy journal sheet if the codex isn't loaded (defensive
          // for stripped-down worlds or pre-init timing).
          const opener = game.beneos?.codex?.openForActor
          if (typeof opener === "function" && token.actor) {
            opener(token.actor).catch(err =>
              console.error("[beneos-codex] HUD open failed", err))
          } else {
            beneosJournalEntry.sheet.render(true);
          }
        })
      }
    }
  }

  //VARIANTS HUD
  //console.log("TOKEN CONFIG", tokenConfig)
  if (!tokenConfig?.number) {
    BeneosUtility.debugMessage("[BENEOS TOKENS] No variants found for token", tokenConfig)
    return;
  }
  // Stage 5: derive HUD mode from the placed token's current texture
  // src so the change-skin button lists OTHER variants as either 2.5D
  // or top-down images, matching the active mode of this token.
  const protoSrc = token.document?.texture?.src || ""
  const hudMode = protoSrc.includes("-top.webp") ? "topdown" : "tokenized"
  let beneosVariantsHUD = BeneosUtility.getVariants(tokenConfig, hudMode)
  const beneosVariantsDisplay = await foundry.applications.handlebars.renderTemplate('modules/beneos-module/templates/beneosvariants.html',
    { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getBeneosTokenDataPath(), beneosVariantsHUD, current: tokenConfig.number })
  $(html).find('div.right').append(beneosVariantsDisplay).click((event) => {
    // div.right also hosts Foundry-Core HUD buttons (Add to Combat, etc.). Bail out
    // if our variants box isn't in this render — let core handlers run untouched.
    let beneosTokenButton = $(html).find('.beneos-token-variants')[0];
    if (!beneosTokenButton) return;
    let beneosClickedButton = event.target.parentElement;

    if (beneosClickedButton === beneosTokenButton) {
      beneosTokenButton.classList.add('active');
      $(html).find('.beneos-variants-wrap')[0].classList.add('beneos-active');
      $(html).find('.beneos-variants-wrap')[0].classList.remove('beneos-disabled');
    } else {
      beneosTokenButton.classList.remove('active')
      $(html).find('.beneos-variants-wrap')[0].classList.remove('beneos-active');
      $(html).find('.beneos-variants-wrap')[0].classList.add('beneos-disabled');
      if (event.target.classList.contains("beneos-button-variant")) {
        setTimeout(function () {
          BeneosUtility.forceChangeToken(token.id, event.target.dataset.variant)
        }, 400)
      }
    }
  });

  // Top-Down Stage 3: STYLE-SWITCH HUD button — filesystem-gated.
  // Stage 2 trusted the cache; Stage 3 probes the disk via
  // BeneosUtility.beneosTopVariantExists so manual-drop test setups
  // and legacy installs work transparently. If the counterpart file
  // (-top.webp ↔ -token.webp) isn't on disk, the button isn't
  // rendered at all — no error path, no notification noise.
  try {
    // Stage 7: read the placed token's texture.src first. Stage-6
    // relied on actor.prototypeToken.texture.src, which goes stale
    // when an actor.update fails (V13 schema rejection on legacy
    // `scale` paths). Token-document is the most authoritative
    // source for what the user actually sees on the canvas.
    const protoSrc = token?.document?.texture?.src
                  || token?.actor?.prototypeToken?.texture?.src
                  || ""
    const isTopDown = protoSrc.includes("-top.webp")
    const isTokenized = protoSrc.includes("-token.webp")
    if (isTopDown || isTokenized) {
      const counterpartExists = await BeneosUtility.beneosTopVariantExists(protoSrc)
      if (counterpartExists) {
        const tooltipKey = isTopDown
          ? "BENEOS.TokenMenu.SwitchStyleTo25D"
          : "BENEOS.TokenMenu.SwitchStyleToTopDown"
        const tooltipText = game.i18n.localize(tooltipKey)
        // Stage 7: visually distinct icon pair tied to the TARGET
        // shape. 2.5D tokens are round, Top-Down tokens are square-ish
        // map tiles. So Top-Down active → fa-circle (target = round
        // 2.5D); 2.5D active → fa-down-long (target = top-down view).
        const iconClass = isTopDown ? "fa-solid fa-circle" : "fa-solid fa-down-long"
        const $btn = $(`
          <div class="control-icon beneos-token-style-toggle"
               data-action="beneosToken-style"
               title="${tooltipText}"
               style="display:flex;align-items:center;justify-content:center;cursor:pointer;">
            <i class="${iconClass}" style="font-size:20px;"></i>
          </div>
        `)
        $btn.on("click", (e) => {
          e.preventDefault()
          e.stopPropagation()
          BeneosUtility.toggleTokenStyle(token.id)
        })
        $(html).find('div.right').append($btn)
      }
    }
  } catch (err) {
    console.warn("[Beneos] Style-toggle HUD button failed", err)
  }

  // Stage 13c-mini: FX-Editor-Button. Sichtbar NUR wenn Creator-Mode
  // aktiv und Token ist Beneos-Creature. Klick öffnet das BeneosFX-
  // Editor-Window mit Live-Auto-Save für Drop-Shadow-Parameter. End-
  // User-Modus zeigt diesen Button gar nicht.
  try {
    const creatorMode = game.settings.get(BeneosUtility.moduleID(), "beneos-creator-mode")
    if (creatorMode && BeneosUtility.isBeneosCreature(token)) {
      const tooltipText = game.i18n.localize("BENEOS.FXEditor.Title")
      const $fxBtn = $(`
        <div class="control-icon beneos-fx-editor-toggle"
             title="${tooltipText}"
             style="display:flex;align-items:center;justify-content:center;cursor:pointer;">
          <i class="fa-solid fa-wand-sparkles" style="font-size:20px;"></i>
        </div>
      `)
      $fxBtn.on("click", (e) => {
        e.preventDefault()
        e.stopPropagation()
        try {
          new BeneosFXEditor(token).render(true)
        } catch (err) {
          console.warn("[Beneos] FX-Editor open failed", err)
        }
      })
      $(html).find('div.right').append($fxBtn)
    }
  } catch (err) {
    console.warn("[Beneos] FX-Editor HUD button failed", err)
  }

})

/********************************************************************************** */
// Drag-from-variant-strip bridge: the variant drag-handler and the
// pending-canvas-drop drain both set BeneosUtility._pendingDropStyle to
// "topdown" only AFTER they have verified that the -top.webp counterpart
// is actually present on disk. This hook trusts that upstream gate and
// performs the synchronous texture swap here — preCreateToken cannot
// await an async FS probe and still mutate the document, so the check
// has to live upstream.
Hooks.on("preCreateToken", (tokenDoc, data, options, userId) => {
  try {
    const pending = BeneosUtility._pendingDropStyle
    BeneosUtility._pendingDropStyle = null
    if (pending !== "topdown") return
    const src = data?.texture?.src || tokenDoc?.texture?.src || ""
    if (!src.includes("-token.webp")) return
    const newSrc = src.replace("-token.webp", "-top.webp")
    // Stage 13d-10: pass newSrc so variant-specific scale/anchor apply
    // when the placed variant is not the `-1` default. Also lift the
    // anchor (previously only set on toggle), otherwise the token sits
    // visually off-center until the user clicks the HUD swap once.
    const topDownScale = BeneosUtility.getBeneosScale(tokenDoc?.actor, "topdown", newSrc)
    const topDownAnchor = BeneosUtility.getBeneosAnchor(tokenDoc?.actor, "topdown", newSrc)
    tokenDoc.updateSource({
      "texture.src": newSrc,
      "texture.scaleX": topDownScale,
      "texture.scaleY": topDownScale,
      "texture.anchorX": topDownAnchor.x,
      "texture.anchorY": topDownAnchor.y
    })
  } catch (err) {
    console.warn("[Beneos] preCreateToken style override failed", err)
  }
})

/********************************************************************************** */
// Stage 13a: Creator-Mode Auto-Write. Two hooks (Token + Actor) feed
// a shared persistence helper. The PRIMARY designer workflow runs via
// Right-Click placed Token → "Configure Token" (Gear-Icon im HUD) →
// Appearance → Scale-Slider → Save. That path goes through
// preUpdateToken (TokenDocument), NOT preUpdateActor — so a hook
// only on Actor-Updates would silently miss the most common path,
// which exactly matches the user's bug report. preUpdateActor stays
// for the alternate path (Actor-Sheet → Token-Tab edits).
//
// Critical: at unlinked Beneos tokens, `tokenDoc.actor` is the
// synthetic delta-actor. We must persist on the WORLD actor (via
// game.actors.get(tokenDoc.actorId)) so the flag survives in
// actor.toObject().flags for Foundry's Right-Click → Export Data
// roundtrip.
function _beneosCreatorPersistScale(worldActor, newScale, newTextureSrc) {
  if (!worldActor) return
  if (!(typeof newScale === "number" && newScale > 0)) return
  const beneosFlag = worldActor.getFlag("world", "beneos")
  if (!beneosFlag) return  // not a Beneos creature — silent skip
  const src = newTextureSrc || worldActor.prototypeToken?.texture?.src || ""
  const mode = src.includes("-top.webp") ? "topdown" : "tokenized"
  const flagKey = mode === "topdown" ? "topDownScale" : "tokenizedScale"
  const rendering = { ...(beneosFlag.rendering || {}), [flagKey]: newScale }
  worldActor.setFlag("world", "beneos", { ...beneosFlag, rendering }).then(() => {
    BeneosUtility.debugMessage(
      "[Beneos Creator-Mode] persisted", flagKey, "=", newScale, "on", worldActor.name
    )
  }).catch(err => {
    console.warn("[Beneos] Creator-Mode setFlag failed", err)
  })
}

// Stage 13d-11: anchor auto-save, mirror of the scale path. Detects
// the active mode from the token's current texture-src so 2.5D and
// top-down anchor settings stay separated. Caller passes whichever
// of ax/ay actually changed (a single-axis edit is the common case);
// no-op for non-Beneos actors.
function _beneosCreatorPersistAnchor(worldActor, ax, ay, newTextureSrc) {
  if (!worldActor) return
  if (!Number.isFinite(ax) && !Number.isFinite(ay)) return
  const beneosFlag = worldActor.getFlag("world", "beneos")
  if (!beneosFlag) return
  const src = newTextureSrc || worldActor.prototypeToken?.texture?.src || ""
  const mode = src.includes("-top.webp") ? "topdown" : "tokenized"
  const xKey = mode === "topdown" ? "topDownAnchorX" : "tokenizedAnchorX"
  const yKey = mode === "topdown" ? "topDownAnchorY" : "tokenizedAnchorY"
  const current = beneosFlag.rendering || {}
  // Idempotency: skip if neither axis would actually change.
  const xChanged = Number.isFinite(ax) && current[xKey] !== ax
  const yChanged = Number.isFinite(ay) && current[yKey] !== ay
  if (!xChanged && !yChanged) return
  const rendering = { ...current }
  if (xChanged) rendering[xKey] = ax
  if (yChanged) rendering[yKey] = ay
  worldActor.setFlag("world", "beneos", { ...beneosFlag, rendering }).then(() => {
    const parts = []
    if (xChanged) parts.push(`${xKey}=${ax}`)
    if (yChanged) parts.push(`${yKey}=${ay}`)
    BeneosUtility.debugMessage("[Beneos Creator-Mode] persisted anchor", parts.join(", "), "on", worldActor.name)
  }).catch(err => {
    console.warn("[Beneos] Creator-Mode anchor setFlag failed", err)
  })
}

// Path 1: Designer edits Scale via Actor-Sheet → Prototype-Token-Tab.
// Update lands directly on the Actor-Document, prototypeToken-Sub.
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  try {
    if (!game.settings.get(BeneosUtility.moduleID(), "beneos-creator-mode")) return
    const proto = changes?.prototypeToken
    if (!proto) return
    const newSrc = proto?.texture?.src ?? actor.prototypeToken?.texture?.src ?? ""
    const newScale = (typeof proto?.texture?.scaleX === "number") ? proto.texture.scaleX
                  : (typeof proto?.scale === "number") ? proto.scale
                  : null
    if (newScale !== null) _beneosCreatorPersistScale(actor, newScale, newSrc)
    // Stage 13d-11: anchor auto-save alongside scale.
    const ax = (typeof proto?.texture?.anchorX === "number") ? proto.texture.anchorX : null
    const ay = (typeof proto?.texture?.anchorY === "number") ? proto.texture.anchorY : null
    if (ax !== null || ay !== null) _beneosCreatorPersistAnchor(actor, ax, ay, newSrc)
  } catch (err) {
    console.warn("[Beneos] Creator-Mode preUpdateActor auto-write failed", err)
  }
})

// Path 2 (PRIMARY designer path): Right-Click placed Token →
// Configure Token → Appearance → Scale-Slider → Save. Update goes
// through TokenDocument. We resolve the WORLD actor via
// tokenDoc.actorId so the flag persists on the actor (for Export →
// Cloud roundtrip), not on the synthetic delta of the placed token.
Hooks.on("preUpdateToken", (tokenDoc, changes, options, userId) => {
  try {
    if (!game.settings.get(BeneosUtility.moduleID(), "beneos-creator-mode")) return
    const newSrc = changes?.texture?.src ?? tokenDoc?.texture?.src ?? ""
    const worldActor = tokenDoc.actorId ? game.actors.get(tokenDoc.actorId) : null
    if (!worldActor) return
    const newScale = (typeof changes?.texture?.scaleX === "number") ? changes.texture.scaleX
                  : (typeof changes?.scale === "number") ? changes.scale
                  : null
    if (newScale !== null) _beneosCreatorPersistScale(worldActor, newScale, newSrc)
    // Stage 13d-11: anchor auto-save alongside scale.
    const ax = (typeof changes?.texture?.anchorX === "number") ? changes.texture.anchorX : null
    const ay = (typeof changes?.texture?.anchorY === "number") ? changes.texture.anchorY : null
    if (ax !== null || ay !== null) _beneosCreatorPersistAnchor(worldActor, ax, ay, newSrc)
  } catch (err) {
    console.warn("[Beneos] Creator-Mode preUpdateToken auto-write failed", err)
  }
})

/********************************************************************************** */
// Stage 13b: FX-Engine Hook-Wiring. canvasReady covers the cold path
// when the user opens a scene; updateToken catches live flag-edits
// (Creator-Mode-Auto-Write or manual setFlag) and re-renders the FX
// without requiring a scene reload. destroyToken cleans up so
// detached PIXI-filter-objects don't outlive their token.
Hooks.on("canvasReady", () => {
  try {
    BeneosFXEngine.refreshAll()
  } catch (err) {
    console.warn("[Beneos FX] canvasReady refresh failed", err)
  }
})

Hooks.on("updateToken", (tokenDoc, changes) => {
  // Re-apply on rendering-flag changes OR on a texture-source flip
  // (mode-switch tokenized↔top-down). The mode-switch alone needs a
  // re-apply because the active fx-list resolves from
  // texture.src — switching modes selects the other list, so live
  // PIXI state has to be rebuilt to match.
  const flagChanged    = foundry.utils.hasProperty(changes, "flags.world.beneos.rendering")
  const textureChanged = foundry.utils.hasProperty(changes, "texture.src")
  if (!flagChanged && !textureChanged) return
  // Stage 13d-1: skip when the FX-Editor is mid-commit.
  if (globalThis.beneosFXEditorWriting) return
  const token = tokenDoc.object
  if (!token) return
  try {
    BeneosFXEngine.applyForToken(token)
  } catch (err) {
    console.warn("[Beneos FX] updateToken refresh failed", err)
  }
})

// Stage 13b-Bugfix: actor-level Hook für FX-Re-Apply.
//
// actor.setFlag(...) — wie es der Stage-13c-mini-FX-Editor und
// auch direkte Console-Edits aufrufen — feuert updateActor, NICHT
// updateToken. Stage 13b hörte nur auf updateToken, daher wurde
// die FX-Engine bei Editor-Edits nie getriggert. Hier iterieren
// wir alle placed Tokens des aktualisierten Actors auf der aktiven
// Canvas und re-applyen die Filter.
Hooks.on("updateActor", (actor, changes) => {
  if (!foundry.utils.hasProperty(changes, "flags.world.beneos.rendering")) return
  // Stage 13d-1: bypass when the FX-Editor is committing a slider
  // release. liveUpdate already wrote the value to the live PIXI
  // filters; clear+re-instantiate here would replace the running
  // filters with fresh ones — visually identical, but it resets
  // animator phase and triggers a 1-frame visual hiccup that the
  // user perceives as "lag". External flag-edits (Console, Cloud-
  // Update) never set this flag, so they still re-apply correctly.
  if (globalThis.beneosFXEditorWriting) return
  const tokens = canvas?.tokens?.placeables?.filter(
    t => t.document?.actorId === actor.id
  ) || []
  for (const token of tokens) {
    try {
      BeneosFXEngine.applyForToken(token)
    } catch (err) {
      console.warn("[Beneos FX] updateActor refresh failed", err)
    }
  }
})

Hooks.on("destroyToken", token => {
  try {
    BeneosFXEngine.clearForToken(token)
  } catch (err) {
    /* swallow — cleanup is best-effort, Foundry's own teardown
       handles the PIXI-mesh GC anyway. */
  }
})

/********************************************************************************** */
Hooks.on("deleteActor", (actor, options) => {
  if (actor?.pack == "world.beneos_module_actors") {
    BeneosUtility.removeTokenFromActorId(actor.id)
  }
  return true;
})
/********************************************************************************** */
// Punkt 1 — Folder-Restruktur: ZipImporter and other non-cloud creation
// flows hit this hook without a pre-set folder. We try to find the deepest
// matching folder in the new "Beneos Creatures / [SRD|Beneos Originals] /
// <Type> / CR <X>" hierarchy and fall back upward if any level is missing.
// This is sync-only (Foundry hooks can't await), so we never CREATE folders
// here — that's the import path's job. If nothing matches we leave the
// actor's folder untouched.
Hooks.on("preCreateActor", (actor, data, context) => {
  const beneosFlag = actor?.flags?.world?.beneos
  if (!beneosFlag?.fullId) return true
  if (actor.folder) return true // cloud-install path already set a folder

  const tokenKey = beneosFlag.tokenKey
  const tokenDb = game.beneos?.databaseHolder?.getTokenDatabaseInfo?.(tokenKey)
  const rawBucket = BeneosUtility.getSourceBucket(tokenDb, "token", tokenKey)
  const folderBucket = BeneosUtility.getFolderBucket(rawBucket)
  let creatureType = tokenDb?.properties?.type?.[0] ?? "Unknown"
  creatureType = creatureType.charAt(0).toUpperCase() + creatureType.slice(1)
  const crFolder = BeneosUtility.formatCrFolder(tokenDb?.properties?.cr)
  const segments = ["Beneos Creatures", folderBucket, creatureType, crFolder]

  const findChild = (parentId, name) => game.folders.find(f =>
    f.name === name && f.type === "Actor" && (f.folder?.id ?? null) === parentId
  )

  // Walk down as far as we can; the deepest match wins.
  let parent = null
  let chosen = null
  for (const name of segments) {
    const next = findChild(parent?.id ?? null, name)
    if (!next) break
    parent = next
    chosen = next
  }
  if (chosen?.id) actor.updateSource({ folder: chosen.id })
  return true;
})
/********************************************************************************** */
// Fix #B-1d: cloud-token drag-to-canvas pipeline. The dragstart handler in the
// search engine sets a phantom marker `{ beneosCloudPending: true,
// beneosTokenKey: ... }` on the dataTransfer instead of a real UUID. When the
// user drops onto the canvas, Foundry fires this hook with the parsed payload
// plus the drop coordinates. We cancel Foundry's default drop processing
// (returning false) and forward to BeneosCloud, which kicks off the import and
// places one Token per recorded drop position once the import has finished.
Hooks.on("dropCanvasData", (canvas, data) => {
  if (data?.beneosCloudPending !== true) return true
  game.beneos?.cloud?.handlePendingCanvasDrop?.(canvas, data)
  return false
})
/********************************************************************************** */
// Wave B-9-fix-41: cloud item / spell drop on a character sheet. Mirrors the
// dropCanvasData pipeline. The search-engine dragstart sets a phantom marker
// `{ beneosCloudPending: true, beneosItemKey, beneosAssetKind }` on the
// dataTransfer; when the user drops onto an actor sheet, this hook fires
// with the parsed data plus the actor + sheet refs. We forward to BeneosCloud,
// which kicks off the import and adds the freshly-installed item to the actor
// once the world doc exists. Returning false suppresses Foundry's default
// drop handler (which can't resolve the phantom marker as a real UUID).
Hooks.on("dropActorSheetData", (actor, sheet, data) => {
  if (data?.beneosCloudPending !== true) return true
  if (data?.type !== "Item") return true
  game.beneos?.cloud?.handlePendingItemDrop?.(actor, data)
  return false
})
/********************************************************************************** */
// Wave B-9-fix-48: silence Item.fromDropData / Actor.fromDropData when the
// drop payload is one of our phantom Beneos cloud markers. The
// dropActorSheetData hook above stops Foundry's V13 _onDrop from calling
// fromDropData, but the dnd5e ActorSheet override still calls it directly,
// which throws "Failed to resolve Document from provided DragData. Either
// data or a UUID must be provided.". Returning null here lets dnd5e fall
// through gracefully — our pipeline has already kicked off the import
// and will register the actor for drainPendingItemDrops to populate later.
Hooks.once("ready", () => {
  for (const docName of ["Item", "Actor"]) {
    const cls = CONFIG?.[docName]?.documentClass
    if (!cls?.fromDropData) continue
    const original = cls.fromDropData
    cls.fromDropData = async function(data, options) {
      if (data?.beneosCloudPending === true) return null
      return original.call(this, data, options)
    }
  }
  // Tier-3 delta-cursor safety net: every world-open starts with a
  // fresh cursor so the first checkAvailableContent fetches the full
  // catalog. Prevents a stale cursor from a previous session leaving
  // the available-content map in a partial state and tripping the
  // Out-of-Sync pill on every card.
  try {
    game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-last-content-fetch-server-time", 0)
  } catch (e) { /* setting not registered yet — module init order */ }
})
/********************************************************************************** */
// Warlock Pact-Magic prompt for the manual compendium → actor drop. The cloud
// import path runs its own prompt inside drainPendingItemDrops; this hook
// catches the case where a GM drags a spell directly out of the Beneos pack
// (or any other source carrying the world.beneos.spellKey flag) onto a
// Warlock sheet. We cancel the default create, run the async prompt, then
// re-create the embedded item with the chosen method. The
// `beneosPactMagicHandled` option flag prevents the hook from re-prompting
// itself on the second create call.
Hooks.on("preCreateItem", (item, data, options, userId) => {
  if (options?.beneosPactMagicHandled) return true;
  if (game.system?.id !== "dnd5e") return true;
  if (item?.type !== "spell") return true;
  if ((item?.system?.level ?? 0) === 0) return true; // cantrips never use slots
  const actor = item?.parent;
  if (!(actor && actor.documentName === "Actor")) return true;
  if (!BeneosUtility.isWarlockActor(actor)) return true;

  // Only fire for Beneos spells. The flag is stamped during cloud-import
  // (importSpellToCompendium) and rides along when the world item is
  // drag-dropped onto an actor.
  const beneosFlag = item.flags?.world?.beneos
                  ?? (item.getFlag?.("world", "beneos"));
  const isBeneos = !!(beneosFlag?.spellKey)
                || item.pack === "world.beneos_module_spells";
  if (!isBeneos) return true;

  (async () => {
    let choice = "normal";
    try {
      choice = await BeneosUtility.askPactMagicChoice({
        spellItem: item,
        actor,
        batchToken: "" // no batch cache for manual compendium drops
      });
    } catch (e) {
      console.warn("Beneos | Pact-Magic prompt failed during preCreateItem:", e);
    }
    const itemData = (item.toObject ? item.toObject() : foundry.utils.deepClone(data)) || {};
    if (choice === "pact") BeneosUtility.applyPactMagicToSpellData(itemData);
    try {
      await actor.createEmbeddedDocuments("Item", [itemData], { beneosPactMagicHandled: true });
    } catch (err) {
      console.error("Beneos | Re-create after Pact-Magic prompt failed:", err);
    }
  })();

  return false; // suppress the default create — re-created above with chosen method
})

/********************************************************************************** */
Hooks.on("deleteItem", (item, options) => {
  BeneosUtility.debugMessage("Beneos delete item", item, options)
  if (item?.pack == "world.beneos_module_items") {
    BeneosUtility.removeItem(item.id)
  }
  if (item?.pack == "world.beneos_module_spells") {
    BeneosUtility.removeSpell(item.id)
  }
  return true;
})

/********************************************************************************** */
// Wave B-8j (Cloud opener in left toolbar) — V13/V14 only, no V12 fallback.
//
// Foundry V13 changed the `getSceneControlButtons` payload from an Array
// (V12-style `btns.push({...})`) to an Object map keyed by category name.
// Tools within each category are also keyed objects, and the action
// handler for buttons is `onChange` (not `onClick`).
//
// This hook adds a single "Beneos Cloud" category with one "Open"
// button. No canvas layer is involved — the button works on a fresh
// world before any scene is active, which is the practical pain point
// users described with Moulinette and similar.
//
// The Actor-sidebar button (`renderActorDirectory` hook) was removed in
// the same wave — Beneos now ships Creatures + Loot + Spells, so a
// single Actor-tab entry no longer fits the module's surface.
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM) return
  controls.beneos = {
    name: "beneos",
    title: game.i18n.localize("BENEOS.Toolbar.Title"),
    // Wave B-9-fix-44: Beneos logo SVG via the masked CSS class.
    icon: "beneos-icon-logo",
    order: 99,
    visible: true,
    tools: {
      "open-cloud": {
        name: "open-cloud",
        title: game.i18n.localize("BENEOS.Toolbar.OpenCloud"),
        icon: "beneos-icon-logo",
        order: 1,
        visible: true,
        button: true,
        // Wave B-9-fix-52: V13 dispatches onChange twice for a single
        // click on a button-tool when both the control AND the tool
        // change in the same activation cycle (#postActivate fires the
        // tool onChange via #onToolChange, and #onChangeTool can fire
        // it again directly for `button: true` tools). The duplicate
        // fire makes the start sound stack on itself; debounce the
        // handler to a single trigger per ~600ms so a user-visible
        // double-click also still gets one open + one sound.
        //
        // Plus: do the window render and control switch on a setTimeout
        // so we leave the scene-controls activation stack before any
        // ApplicationV2 render. V13's _updatePosition reads
        // `el.parentElement.offsetWidth` which can be null when the
        // render fires inside the same JS task as the click — yields
        // "Cannot read properties of null (reading 'offsetWidth')".
        onChange: () => {
          // V13 dispatches onChange TWICE per click on button-tools
          // (see Wave B-9-fix-52 below). The in-progress lock catches
          // the duplicate dispatch.
          if (Hooks._beneosOpenCloudInProgress) return
          // No-op when the Cloud window is already on screen. Per
          // user direction: toolbar-button = open; window-X / ESC =
          // close. Strict === true so transient states (closing,
          // undefined) fall through to the open path.
          try {
            const existing = game.beneos?.cloudWindowV2
            if (existing && existing.rendered === true) return
          } catch (e) {}
          Hooks._beneosOpenCloudInProgress = true
          // Safety net: if the regular reset (120 ms after launcher
          // render) is dropped — browser tab throttling, mid-open
          // error — the lock would otherwise stay true forever and
          // dead-end the toolbar. Force-clear after 5 s.
          setTimeout(() => {
            if (Hooks._beneosOpenCloudInProgress) {
              console.warn("Beneos | open-cloud lock stuck >5s, forcing reset")
              Hooks._beneosOpenCloudInProgress = false
            }
          }, 5000)
          try {
            const src = "modules/beneos-module/ui/sfx/beneos_start.ogg"
            const helper = foundry.audio?.AudioHelper
                        ?? (typeof AudioHelper !== "undefined" ? AudioHelper : null)
            helper?.play?.({ src, volume: 0.5, autoplay: true, loop: false }, false)
          } catch (e) {}
          // Stage 11: synchronous splash-overlay. Cold-open of the
          // cloud window triggers up to 5 sequential CDN fetches in
          // BeneosDatabaseHolder.loadDatabaseFiles plus template
          // compilation — total 2-5s of dead silence between the
          // click sound and the first paint. Inject a fixed-position
          // overlay BEFORE the deferred render so the user sees
          // Foundry isn't frozen. Removed by V2's _onRender hook.
          if (!document.getElementById("beneos-cloud-loading-splash")) {
            try {
              const splash = document.createElement("div")
              splash.id = "beneos-cloud-loading-splash"
              const splashText = game.i18n?.localize?.("BENEOS.Cloud.Loading.Splash")
                              || "Loading Beneos Cloud…"
              splash.innerHTML = `
                <div class="beneos-loading-splash-card">
                  <div class="beneos-loading-splash-spinner"></div>
                  <div class="beneos-loading-splash-text">${splashText}</div>
                </div>
              `
              document.body.appendChild(splash)
            } catch (e) { /* splash is best-effort, never block the open */ }
          }
          // Defer the heavy work outside Foundry's click handler so the
          // scene-controls activation stack unwinds first.
          setTimeout(() => {
            try {
              new BeneosCloudWindowV2().render({ force: true })
            } catch (e) {
              console.error(e)
              // Stage 11: if the launcher throws synchronously,
              // strip the splash so it doesn't hang forever.
              document.getElementById("beneos-cloud-loading-splash")?.remove()
            }
            // Switch focus back to Token Controls — the "beneos" group
            // has no canvas tools, so leaving it focused after the cloud
            // window opens would strand the user. Defer once more so the
            // controls switch happens after the cloud window's first
            // paint (avoids a second render-time race).
            setTimeout(() => {
              try { ui.controls?.activate?.({ control: "tokens", tool: "select" }) }
              catch (e) {}
              Hooks._beneosOpenCloudInProgress = false
            }, 120)
          }, 0)
        }
      }
    },
    activeTool: "open-cloud"
  }
})

/********************************************************************************** */
Hooks.on("getSceneDirectoryEntryContext", (html, options) => {
  options.push({
    name: "Use Animated Map",
    icon: `<img class="beneos-scene-menu-icon" src="modules/beneos-module/icons/icon_video.svg" width="16" height="16" />`,
    callback: async function (li) {
      BeneosUtility.switchPhase(li.data("documentId"), "toAnimated");
    },
    condition: li => {
      return BeneosUtility.isSwitchableBeneosBattlemap(li.data("documentId"), "webp")
    },
  });
  options.push({
    name: "Use Static Map",
    icon: `<img class="beneos-scene-menu-icon" src="modules/beneos-module/icons/icon_image.svg" width="16px" height="16px" />`,
    callback: async function (li) {
      BeneosUtility.switchPhase(li.data("documentId"), "toStatic");
    },
    condition: li => {
      return BeneosUtility.isSwitchableBeneosBattlemap(li.data("documentId"), "webm")
    },
  });
});

/********************************************************************************** */
Hooks.on("getSceneContextOptions", (html, options) => {
  BeneosUtility.debugMessage("BeneosModule - getSceneContextOptions", html, options)
  let menuEntry1 = {
    name: "Use Static Map",
    icon: `<i class="fa-regular fa-image"></i>`,
    condition: li => {
      let sceneId = $(li).data("sceneId") || $(li).data("entryId")
      return BeneosUtility.isSwitchableBeneosBattlemap(sceneId, "webm")
    },
    callback: async li => {
      let sceneId = $(li).data("sceneId") || $(li).data("entryId")
      BeneosUtility.switchPhase(sceneId, "toStatic");
    }
  }
  let menuEntry2 = {
    name: "Use Animated Map",
    icon: `<i class="fa-regular fa-video"></i>`,
    condition: li => {
      let sceneId = $(li).data("sceneId") || $(li).data("entryId")
      return BeneosUtility.isSwitchableBeneosBattlemap(sceneId, "webp")
    },
    callback: async li => {
      let sceneId = $(li).data("sceneId") || $(li).data("entryId")
      BeneosUtility.switchPhase(sceneId, "toAnimated");
    }
  }
  options.push(menuEntry1);
  options.push(menuEntry2);
  return options;
})

/********************************************************************************** */
Hooks.on("getSceneNavigationContext", (html, options) => {
  let menuEntry1 = {
    name: "Use Static Map",
    icon: `<img class="beneos-active-scene-menu-icon" src="modules/beneos-module/icons/icon_image.svg" width="16" height="16" />`,
    condition: li => BeneosUtility.isSwitchableBeneosBattlemap(li.data("sceneId"), "webm"),
    callback: async li => {
      let sceneId = li.data("sceneId")
      BeneosUtility.switchPhase(sceneId, "toStatic");
    }
  }
  let menuEntry2 = {
    name: "Use Animated Map",
    icon: `<img class="beneos-active-scene-menu-icon" src="modules/beneos-module/icons/icon_video.svg" width="16" height="16" />`,
    condition: li => BeneosUtility.isSwitchableBeneosBattlemap(li.data("sceneId"), "webp"),
    callback: async li => {
      let sceneId = li.data("sceneId")
      BeneosUtility.switchPhase(sceneId, "toAnimated");
    }
  }
  options.push(menuEntry1);
  options.push(menuEntry2);
  return options;
});
