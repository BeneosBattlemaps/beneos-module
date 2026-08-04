// Patches Foundry's sidebar folder tree builder for large worlds. Listed in
// module.json as well, but imported here so an existing installation picks it up
// on a page reload instead of only after a server restart, since Foundry caches
// the module manifest at startup.
import "./beneos-tree-performance.js";
import "./beneos_tours.js";
import { libWrapper } from "./shim.js";
import { BeneosUtility } from "./beneos_utility.js";
import { BeneosModuleMenu, BeneosDatabaseHolder } from "./beneos_search_engine.js";
import { BeneosCloud } from "./beneos_cloud.js";
import { BeneosAnalytics } from "./beneos_analytics.js";
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
    // Anonymous, GM-only usage telemetry (opt-out, default on).
    analytics: BeneosAnalytics,
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
    // Load the public Free/Published allowlists right after the catalog so the
    // cloud browser groups free content green and hides drafts even when the
    // user is logged OUT (free stays click-to-login). Re-render the browser if
    // it is already open when the lists arrive.
    game.beneos?.cloud?.loadPublicAllowlists?.().then(() => {
      try { game.beneos?.cloudWindowV2?.render?.({ parts: ["results"] }); } catch (e) { /* window not open */ }
    });
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

    // Anonymous usage telemetry: boot the collector and emit the once-per-
    // session world/hosting/companion/party events. Gated internally by the
    // GM check and the beneos-analytics-enabled opt-out, and wrapped so it can
    // never interfere with world load.
    Promise.resolve(BeneosAnalytics.start())
      .then(() => BeneosAnalytics.emitSessionStartEvents())
      .catch(e => console.warn("Beneos | analytics start failed:", e))
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
    // Match the sibling hooks: bail on a non-ready canvas / disabled module so
    // canvas.tokens is safe to touch (this also avoids a throw during scene load
    // on the GM client). The single-writer gate (active GM, else one owner) lives
    // in BeneosUtility.updateToken, so every client may enter here but only the
    // writer performs the persisted FX mutation. That is what stops the
    // "lacks permission to update Token" errors on player clients.
    if (!BeneosUtility.isBeneosModule() || !canvas.ready) {
      return
    }
    if (changeData?.system?.attributes?.hp?.value === undefined) {
      return
    }
    let tokens = canvas.tokens.placeables.filter(t => t.document.actorId == actor.id)
    for (let token of tokens) {
      if (BeneosUtility.checkIsBeneosToken(token)) {
        BeneosUtility.updateToken(token.id, changeData)
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
    try {
      const token = BeneosUtility.getToken(combatant.tokenId)
      if (BeneosUtility.checkIsBeneosToken(token)) {
        const assetId = BeneosAnalytics.beneosAssetId(token)
        if (assetId) BeneosAnalytics.track("combat_add", { asset_id: assetId })
      }
      // Encounter summary state: every combatant (also non-Beneos) joins the
      // roster so co-occurrence and rounds-in-initiative can be measured.
      BeneosAnalytics.combatantAdded(combatant)
    } catch (_) {}
  })


  /********************************************************************************** */
  Hooks.on('deleteCombatant', (combatant, data) => {
    if (!game.user.isGM || !BeneosUtility.isBeneosModule() || !canvas.ready) {
      return
    }
    BeneosUtility.debugMessage("[BENEOS TOKENS] Beneos Combat End Token")
    BeneosUtility.updateToken(combatant.tokenId, {})
    try {
      const token = BeneosUtility.getToken(combatant.tokenId)
      if (BeneosUtility.checkIsBeneosToken(token)) {
        const assetId = BeneosAnalytics.beneosAssetId(token)
        if (assetId) BeneosAnalytics.track("combat_remove", { asset_id: assetId })
      }
      BeneosAnalytics.combatantRemoved(combatant)
    } catch (_) {}
  })

  /********************************************************************************** */
  // Combat deleted = fight over: emit ONE combat_encounter summary (rounds per
  // Beneos creature, battlemap, co-occurrence roster).
  Hooks.on('deleteCombat', (combat) => {
    if (!game.user.isGM || !BeneosUtility.isBeneosModule()) {
      return
    }
    try { BeneosAnalytics.combatEnded(combat) } catch (_) {}
  })

  /********************************************************************************** */
  // Item lands on a sheet: Beneos spell onto a player character (real spell
  // adoption) and Beneos loot items with an origin imprint (PC vs NPC split).
  Hooks.on('createItem', (item) => {
    if (!game.user.isGM || !BeneosUtility.isBeneosModule()) {
      return
    }
    try {
      const parentType = item?.parent?.type || ""
      const spellKey = item?.flags?.world?.beneos?.spellKey
      if (spellKey && item.type === "spell" && parentType === "character") {
        BeneosAnalytics.track("spell_added_to_pc", { asset_id: String(spellKey).slice(0, 32), spell_key: spellKey })
      }
      const originSlug = item?.flags?.["beneos-module"]?.loot?.origin?.slug
      if (originSlug && item?.parent) {
        BeneosAnalytics.trackItemAdded(originSlug, parentType)
      }
    } catch (_) {}
  })

  /********************************************************************************** */
  // Beneos spell actually cast (dnd5e). 4.x fires dnd5e.postUseActivity, older
  // 3.x builds fire dnd5e.useItem; both are registered defensively and the
  // session cap in trackSpellCast keeps duplicates/macro spam harmless.
  const beneosTrackSpellUse = (item) => {
    try {
      if (!game.user.isGM) return
      const spellKey = item?.flags?.world?.beneos?.spellKey
      if (!spellKey || item?.type !== "spell") return
      const caster = (item?.parent?.type === "character") ? "pc" : "npc"
      BeneosAnalytics.trackSpellCast(spellKey, caster)
    } catch (_) {}
  }
  Hooks.on('dnd5e.postUseActivity', (activity) => beneosTrackSpellUse(activity?.item))
  Hooks.on('dnd5e.useItem', (item) => beneosTrackSpellUse(item))

  /********************************************************************************** */
  Hooks.on('createToken', (token) => {
    if (!game.user.isGM || !BeneosUtility.isBeneosModule()) {
      return
    }
    BeneosUtility.createToken(token)
    try {
      if (BeneosUtility.checkIsBeneosToken(token)) {
        const assetId = BeneosAnalytics.beneosAssetId(token)
        if (assetId) BeneosAnalytics.track("canvas_drop_local", { asset_id: assetId })
      }
    } catch (_) {}
  })

  /********************************************************************************** */
  Hooks.on('canvasReady', () => {
    if (!game.user.isGM) {
      return
    }
    try {
      BeneosUtility.processCanvasReady()
    } catch (e) {
      try { BeneosAnalytics.trackBattlemapError(canvas?.scene, e) } catch (_) {}
      throw e
    }
    try { BeneosAnalytics.trackSceneActivate(canvas?.scene) } catch (_) {}
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
        // V14: the bare global FilePicker is a deprecated alias; resolve the
        // namespaced implementation with a V13 fallback.
        const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
        if (/\.s3\./.test(pattern)) {
          source = "s3"
          const { bucket, keyPrefix } = FP.parseS3URL(pattern)
          if (bucket) {
            browseOptions.bucket = bucket
            pattern = keyPrefix
          }
        }
        else if (pattern.startsWith("icons/")) source = "public"
        try {
          const content = await FP.browse(source, pattern, browseOptions)
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
    const creatorMode = BeneosUtility.isBeneosCreatorMode()
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
          try { BeneosAnalytics.track("feature_used", { feature: "fx-editor" }) } catch (_) {}
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
// Zentrale Stelle fuer jede Form von Drop: dieser Hook feuert bei jeder
// Token-Erzeugung, egal ob aus dem Actor-Verzeichnis, aus einem
// Compendium, aus dem Cloud-Fenster oder aus der Variantenleiste. Er
// setzt Scale und Anchor aus den Flags, damit der Token schon im ersten
// gezeichneten Frame richtig sitzt.
//
// Zusaetzlich die Drag-from-variant-strip-Bruecke: der Variant-Drag-
// Handler und der Pending-Canvas-Drop-Drain setzen
// BeneosUtility._pendingDropStyle erst dann auf "topdown", wenn sie das
// Vorhandensein der -top.webp auf der Platte geprueft haben. Dieser Hook
// vertraut auf dieses vorgelagerte Gate und macht den Texturtausch
// synchron, denn preCreateToken kann keine asynchrone Dateipruefung
// abwarten und danach noch das Dokument aendern.
Hooks.on("preCreateToken", (tokenDoc, data, options, userId) => {
  try {
    const pending = BeneosUtility._pendingDropStyle
    BeneosUtility._pendingDropStyle = null
    const actor = tokenDoc?.actor
    if (!BeneosUtility.isBeneosCreature(actor)) return

    let src = data?.texture?.src || tokenDoc?.texture?.src || ""
    if (!src) return
    const patch = {}
    if (pending === "topdown" && src.includes("-token.webp")) {
      src = src.replace("-token.webp", "-top.webp")
      patch["texture.src"] = src
    }

    // Scale und Anchor werden jetzt bei JEDEM Beneos-Drop gesetzt, nicht
    // mehr nur im Top-Down-Zweig. Der 2.5D-Drop lief vorher komplett
    // ohne Flag-Werte durch und lebte allein von dem, was zufaellig im
    // Prototype stand. Synchron per updateSource, damit der Token schon
    // im ersten gezeichneten Frame richtig sitzt und nicht sichtbar
    // nachspringt.
    const profile = BeneosUtility.getBeneosRenderProfile(actor, src)
    Object.assign(patch, BeneosUtility.beneosRenderPatch(profile))
    patch[`flags.${BeneosUtility.moduleID()}.renderStamp`] =
      BeneosUtility.beneosRenderStamp(profile)
    tokenDoc.updateSource(patch)
  } catch (err) {
    console.warn("[Beneos] preCreateToken render override failed", err)
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
// Stage 13d-13: die Merge-Logik liegt jetzt in
// BeneosUtility.beneosPersistRenderValues, weil sie auch das dev-Tool braucht
// und zwei Kopien schon zweimal auseinandergelaufen sind. Hier bleibt nur der
// Creator-Mode-Vertrag: kein neuer Flag-Block (createFlag false), damit ein
// Fremd-Actor beim Endkunden weiterhin unangetastet bleibt.
function _beneosCreatorPersistScale(worldActor, newScale, newTextureSrc) {
  if (!(typeof newScale === "number" && newScale > 0)) return
  BeneosUtility.beneosPersistRenderValues(worldActor, {
    src: newTextureSrc, scale: newScale, createFlag: false
  }).catch(err => console.warn("[Beneos] Creator-Mode scale persist failed", err))
}

// Stage 13d-11: anchor auto-save, mirror of the scale path. Detects
// the active mode from the token's current texture-src so 2.5D and
// top-down anchor settings stay separated. Caller passes whichever
// of ax/ay actually changed (a single-axis edit is the common case);
// no-op for non-Beneos actors.
function _beneosCreatorPersistAnchor(worldActor, ax, ay, newTextureSrc) {
  if (!Number.isFinite(ax) && !Number.isFinite(ay)) return
  BeneosUtility.beneosPersistRenderValues(worldActor, {
    src: newTextureSrc,
    anchorX: Number.isFinite(ax) ? ax : null,
    anchorY: Number.isFinite(ay) ? ay : null,
    createFlag: false
  }).catch(err => console.warn("[Beneos] Creator-Mode anchor persist failed", err))
}

// Path 1: Designer edits Scale via Actor-Sheet → Prototype-Token-Tab.
// Update lands directly on the Actor-Document, prototypeToken-Sub.
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  try {
    if (!BeneosUtility.isBeneosCreatorMode()) return
    // Der Render-Sync schreibt genau die Werte, die er zuvor aus den
    // Flags gelesen hat. Wuerde Creator-Mode sie zurueckschreiben,
    // entstuende eine Schleife aus Lesen und Schreiben desselben Werts.
    if (options?.beneosRenderSync) return
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

// Analytics: a GM personalising a Beneos creature (rename or stat tweak) is a
// strong "this asset is actually used" signal. We only record WHICH top-level
// fields changed, never the values, and only the asset_id, never the name.
// Debounced 30s per actor because Foundry fires internal preUpdateActor churn.
Hooks.on("preUpdateActor", (actor, changes) => {
  try {
    if (!game.user.isGM || !BeneosUtility.checkIsBeneosToken(actor)) return
    const assetId = BeneosAnalytics.beneosAssetId(actor)
    if (!assetId) return

    const nameChanged = typeof changes?.name === "string"
    const sys = changes?.system
    const statFields = []
    // HP changes constantly during play, so it is not a reskin / variant-demand
    // signal. Deliberately not tracked (an HP-only edit emits no actor_modify_stats).
    if (sys?.attributes?.ac !== undefined) statFields.push("ac")
    if (sys?.abilities !== undefined) statFields.push("abilities")
    if (sys?.details?.cr !== undefined) statFields.push("cr")
    if (sys?.attributes?.movement !== undefined) statFields.push("movement")

    if (!nameChanged && !statFields.length) return
    if (!BeneosAnalytics.shouldEmitActorModify(actor.id)) return

    if (nameChanged) BeneosAnalytics.track("actor_modify_name", { asset_id: assetId })
    if (statFields.length) {
      BeneosAnalytics.track("actor_modify_stats", { asset_id: assetId, fields_changed: statFields })
    }
  } catch (_) { /* swallow */ }
})

// Path 2 (PRIMARY designer path): Right-Click placed Token →
// Configure Token → Appearance → Scale-Slider → Save. Update goes
// through TokenDocument. We resolve the WORLD actor via
// tokenDoc.actorId so the flag persists on the actor (for Export →
// Cloud roundtrip), not on the synthetic delta of the placed token.
Hooks.on("preUpdateToken", (tokenDoc, changes, options, userId) => {
  try {
    if (!BeneosUtility.isBeneosCreatorMode()) return
    // Siehe preUpdateActor: unsere eigenen Sync-Schreibvorgaenge duerfen
    // nicht als Designer-Eingabe zurueck in die Flags wandern.
    if (options?.beneosRenderSync) return
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

// Kalter Pfad fuer frisch abgelegte Tokens. createToken loest keinen der
// Trigger oben aus: die Flags unter world.beneos.rendering aendern sich
// nicht und texture.src auch nicht, der updateToken-Hook filtert also
// weg. Ergebnis war, dass ein per Drag-and-Drop platzierter Token seinen
// Schlagschatten erst beim naechsten Szenenwechsel bekam. drawToken
// feuert dagegen bei jedem Zeichnen des Placeables, also beim Drop, beim
// Szenenaufbau und beim Mesh-Neuaufbau nach einem Texturwechsel.
// applyForToken ist idempotent (raeumt zuerst die eigenen
// beneosFxId-Filter ab, Partikel- und Render-Layer-Systeme laufen
// diff-basiert weiter) und steigt bei Nicht-Beneos-Tokens sofort aus,
// die zusaetzlichen Aufrufe kosten daher praktisch nichts.
Hooks.on("drawToken", token => {
  try {
    BeneosFXEngine.applyForToken(token)
  } catch (err) {
    console.warn("[Beneos FX] drawToken apply failed", err)
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
  try {
    const assetId = data?.beneosTokenKey || data?.beneosItemKey || null
    if (assetId) BeneosAnalytics.track("canvas_drop_cloud", { asset_id: assetId })
  } catch (_) {}
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
// Silence Item.fromDropData / Actor.fromDropData when the drop payload is one
// of our phantom Beneos cloud markers. The dropActorSheetData hook above stops
// Foundry's V13 _onDrop from calling fromDropData, but the dnd5e ActorSheet
// override still calls it directly, which throws "Failed to resolve Document
// from provided DragData. Either data or a UUID must be provided.". Returning
// null here lets dnd5e fall through gracefully: our pipeline has already kicked
// off the import and will register the actor for drainPendingItemDrops to
// populate later. We wrap via libWrapper instead of reassigning the method so
// other modules patching the same fromDropData stay compatible.
Hooks.once("ready", () => {
  for (const docName of ["Item", "Actor"]) {
    const cls = CONFIG?.[docName]?.documentClass
    if (!cls?.fromDropData) continue
    try {
      libWrapper.register(
        BeneosUtility.moduleID(),
        `CONFIG.${docName}.documentClass.fromDropData`,
        function (wrapped, data, options) {
          if (data?.beneosCloudPending === true) return null
          return wrapped(data, options)
        },
        "MIXED"
      )
    } catch (e) {
      console.warn(`Beneos | fromDropData libWrapper register failed for ${docName}:`, e)
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
// Wave B-9-fix-71: shared opener for the Beneos Cloud window. Extracted from
// the open-cloud tool's onChange so BOTH the scene-control activation path AND
// the direct toolbar-button click listener (renderSceneControls hook below)
// run the exact same logic. The in-progress lock dedupes the two paths down to
// a single open + a single start sound, which fixes the stacked-sound report.
function openBeneosCloudWindow() {
  // The in-progress lock catches duplicate dispatch (V13 fires the button
  // onChange twice per click) AND the parallel direct-click listener.
  if (Hooks._beneosOpenCloudInProgress) return
  // No-op when the Cloud window is already on screen. Per user direction:
  // toolbar-button = open; window-X / ESC = close. Strict === true so transient
  // states (closing, undefined) fall through to the open path.
  try {
    const existing = game.beneos?.cloudWindowV2
    if (existing && existing.rendered === true) return
  } catch (e) {}
  Hooks._beneosOpenCloudInProgress = true
  // Safety net: if the regular reset (120 ms after launcher render) is dropped
  // (browser tab throttling, mid-open error), the lock would otherwise stay
  // true forever and dead-end the toolbar. Force-clear after 5 s.
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
  // Stage 11: synchronous splash-overlay. Cold-open of the cloud window
  // triggers up to 5 sequential CDN fetches in
  // BeneosDatabaseHolder.loadDatabaseFiles plus template compilation, a total
  // 2-5s of dead silence between the click sound and the first paint. Inject a
  // fixed-position overlay BEFORE the deferred render so the user sees Foundry
  // isn't frozen. Removed by V2's _onRender hook.
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
  // Defer the heavy work outside Foundry's click handler so the scene-controls
  // activation stack unwinds first. V13's _updatePosition reads
  // `el.parentElement.offsetWidth` which can be null when the render fires
  // inside the same JS task as the click.
  setTimeout(() => {
    try {
      new BeneosCloudWindowV2().render({ force: true })
    } catch (e) {
      console.error(e)
      // Stage 11: if the launcher throws synchronously, strip the splash so it
      // doesn't hang forever.
      document.getElementById("beneos-cloud-loading-splash")?.remove()
    }
    // Switch focus back to Token Controls. The "beneos" group has no canvas
    // tools, so leaving it focused after the cloud window opens would strand
    // the user. Defer once more so the controls switch happens after the cloud
    // window's first paint (avoids a second render-time race).
    setTimeout(() => {
      try { ui.controls?.activate?.({ control: "tokens", tool: "select" }) }
      catch (e) {}
      Hooks._beneosOpenCloudInProgress = false
    }, 120)
  }, 0)
}

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM) return
  controls.beneos = {
    name: "beneos",
    title: game.i18n.localize("BENEOS.Toolbar.Title"),
    // Wave B-9-fix-44: Beneos logo SVG via the masked CSS class.
    icon: "beneos-icon-logo",
    // Keep the Beneos logo pinned to the very bottom of the left toolbar. A high
    // `order` gets us past the core groups (effects tops out at 100), but that
    // alone is not enough: some modules (e.g. Moulinette) register their group
    // WITHOUT an `order`, so Foundry's sort can still leave them below us. The
    // renderSceneControls hook below therefore also physically moves our button
    // to be the last child of the toolbar on every render.
    order: 200,
    visible: true,
    tools: {
      "open-cloud": {
        name: "open-cloud",
        title: game.i18n.localize("BENEOS.Toolbar.OpenCloud"),
        icon: "beneos-icon-logo",
        order: 1,
        visible: true,
        button: true,
        // Wave B-9-fix-71: the heavy open logic lives in the shared
        // openBeneosCloudWindow() above. This onChange fires when the user
        // activates the beneos group from the canvas-tool side. The same
        // function is also bound as a direct click listener on the group
        // button (renderSceneControls hook below) so the logo opens the
        // window even while another group's sub-toolbar is active; the
        // in-progress lock dedupes the two paths to one open + one sound.
        onChange: () => openBeneosCloudWindow()
      }
    },
    activeTool: "open-cloud"
  }
})

// Wave B-9-fix-71: bind a direct click listener on the Beneos group button in
// the left toolbar. The bug: when another group's sub-toolbar is open (e.g.
// "Beneos Dev Tools"), clicking the Beneos logo did nothing: V13 buffers the
// open-cloud onChange and only flushes it on the next clean group activation,
// so the window opened (and the start sounds stacked) only after the user left
// the other sub-toolbar. All group buttons live permanently in the DOM
// regardless of the active group, so a capture-phase click listener on our own
// button fires synchronously and opens the window from anywhere. We do NOT
// stop propagation: Foundry still activates the group normally (keeping the
// open-wiki sub-tool reachable), and the in-progress lock dedupes the parallel
// onChange so there is exactly one open and one sound.
Hooks.on("renderSceneControls", (app, element) => {
  if (!game.user?.isGM) return
  const root = element instanceof HTMLElement ? element : element?.[0]
  const btn = root?.querySelector?.('button[data-control="beneos"]')
  if (!btn) return
  // Pin the Beneos logo to the very bottom of the left toolbar, below every
  // other group. `order: 200` handles the core groups, but modules that register
  // without an `order` (e.g. Moulinette) can still sort after us, so we move our
  // button to be the last child of its container on every render.
  const item = btn.closest("li") || btn
  const parent = item.parentElement
  if (parent && parent.lastElementChild !== item) parent.appendChild(item)
  // Wave B-9-fix-71 (see the block comment above): bind the direct click
  // listener exactly once so the logo opens the cloud window from anywhere.
  if (btn.dataset.beneosBound === "1") return
  btn.dataset.beneosBound = "1"
  btn.addEventListener("click", () => openBeneosCloudWindow(), true)
})

/********************************************************************************** */
/* Static / animated battlemap switch in the scene context menu.                      */
/*                                                                                    */
/* One registration covers both places the switch is documented to appear: the scene  */
/* navigation bar and the Scene Directory. Foundry V13 and V14 both fire              */
/* getSceneContextOptions for either (scene-navigation.mjs and document-directory.mjs */
/* pass hookName explicitly). The former getSceneDirectoryEntryContext and            */
/* getSceneNavigationContext hooks were V12 names and had stopped firing.             */
/*                                                                                    */
/* Exactly one entry is offered per scene, matching the wiki and the onboarding tour: */
/* "Use Static Map" while the map is animated, "Use Animated Map" once it is a still. */
/* If the still is missing on disk the entry is still shown, but red and inert, so    */
/* the GM learns why instead of silently getting no menu at all.                      */
/********************************************************************************** */

// ContextMenu runs with jQuery: false in V13/V14 and jQuery goes away entirely in
// V15, so read the id off the element itself. The nav bar tags its <li> with
// data-scene-id, the directory uses data-entry-id.
function beneosSceneIdFromMenuTarget(li) {
  const el = (li instanceof HTMLElement) ? li : li?.[0]
  if (!el) return null
  return el.dataset?.sceneId || el.dataset?.entryId
    || el.closest?.("[data-scene-id]")?.dataset?.sceneId
    || el.closest?.("[data-entry-id]")?.dataset?.entryId
    || null
}

Hooks.on("getSceneContextOptions", (app, options) => {
  const stateOf = li => BeneosUtility.getStaticSwitchState(beneosSceneIdFromMenuTarget(li))

  // V14 deprecates ContextMenuEntry#name in favour of #label and warns when only
  // `name` is present; V13 reads `name` exclusively. Supplying both is correct on
  // either and warning-free. The labels stay English on purpose: the wiki page and
  // the tour quote them verbatim in all 13 languages.
  const entry = (label, iconClass, wanted) => ({
    name: label,
    label: label,
    icon: `<i class="${iconClass}"></i>`,
    condition: li => {
      const state = stateOf(li)
      return !!state && state.command === wanted
    },
    callback: li => BeneosUtility.switchPhase(beneosSceneIdFromMenuTarget(li), wanted)
  })

  const toStatic = entry("Use Static Map", "fa-regular fa-image", "toStatic")
  const toAnimated = entry("Use Animated Map", "fa-regular fa-video", "toAnimated")

  // The unavailable variant replaces "Use Static Map" whenever the still is known
  // to be missing, so the two conditions stay mutually exclusive.
  const baseStaticCondition = toStatic.condition
  toStatic.condition = li => baseStaticCondition(li) && stateOf(li).available !== false
  const unavailable = {
    name: "Use Static Map",
    label: "Use Static Map",
    icon: `<i class="fa-regular fa-image"></i>`,
    classes: "beneos-static-unavailable",
    condition: li => baseStaticCondition(li) && stateOf(li).available === false,
    callback: () => ui.notifications.warn(game.i18n.localize("BENEOS.Scene.StaticMap.Unavailable"))
  }

  options.push(toStatic, unavailable, toAnimated)
  return options
})

/********************************************************************************** */
Hooks.once("ready", () => {
  if (!game.user.isGM) return

  // The ContextMenu builds its <li> itself and marks the icon inert in V14, so a
  // data-tooltip cannot be attached declaratively. Delegate instead and drive the
  // core tooltip manager directly.
  document.body.addEventListener("pointerover", ev => {
    const el = ev.target?.closest?.("#context-menu li.beneos-static-unavailable")
    if (!el) return
    game.tooltip.activate(el, { text: game.i18n.localize("BENEOS.Scene.StaticMap.Unavailable") })
  })

  const restored = BeneosUtility.loadMapAssetProbeCache()
  if (restored) BeneosUtility.debugMessage(`Static switch: ${restored} probe result(s) restored from the local cache`)
  warmStaticSwitchCacheWhenIdle()
})

// Keep the availability cache warm before anyone right-clicks, and drop it when
// new files land on disk.
//
// The warm-up used to run straight out of the render hook. Both hooks fire on
// every sidebar and navigation redraw, so in a world with a few thousand scenes
// that put a full walk over every scene, and potentially a burst of HEAD
// requests, inside the render frame. Coalescing the calls and handing them to an
// idle callback keeps the work off the frame that is trying to paint, without
// changing what ends up in the cache.
let warmStaticSwitchHandle = null
function warmStaticSwitchCacheWhenIdle() {
  if (warmStaticSwitchHandle !== null) return
  const run = () => {
    warmStaticSwitchHandle = null
    BeneosUtility.warmStaticSwitchCache()
  }
  warmStaticSwitchHandle = (typeof requestIdleCallback === "function")
    ? requestIdleCallback(run, { timeout: 2000 })
    : setTimeout(run, 250)
}

Hooks.on("renderSceneNavigation", () => warmStaticSwitchCacheWhenIdle())
Hooks.on("renderSceneDirectory", () => warmStaticSwitchCacheWhenIdle())
Hooks.on("beneos.releaseInstalled", (data) => {
  // Scoped refresh when the install told us which scenes it brought in. Only
  // those can have gained or lost a still, so dropping the whole cache and
  // re-walking the world would just re-probe every other release for nothing.
  const sceneIds = Array.isArray(data?.sceneIds) ? data.sceneIds.filter(Boolean) : []
  if (sceneIds.length) {
    BeneosUtility.refreshStaticSwitchCacheForScenes(sceneIds)
    return
  }
  // Fallback for callers that do not carry scene ids: the old full clear.
  BeneosUtility.clearStaticSwitchCache()
  warmStaticSwitchCacheWhenIdle()
})
