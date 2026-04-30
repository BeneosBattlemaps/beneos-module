import "./beneos_tours.js";
import { libWrapper } from "./shim.js";
import { BeneosUtility } from "./beneos_utility.js";
import { BeneosSearchEngineLauncher, BeneosModuleMenu, BeneosDatabaseHolder } from "./beneos_search_engine.js";
import { BeneosCloud } from "./beneos_cloud.js";
// Unused : import { BeneosTableTop } from "./beneos-table-top.js";

/********************************************************************************** */
Hooks.once('init', () => {

  game.beneos = {
    BeneosUtility,
    cloud: new BeneosCloud(),
  }

  BeneosUtility.registerSettings()
  BeneosUtility.setupSocket()
  //BeneosTableTop.init()

})

/********************************************************************************** */
Hooks.once('ready', () => {

  BeneosUtility.debugMessage("----------------------------------------------")
  BeneosUtility.debugMessage(`Loading ${BeneosUtility.moduleName()} module...`)
  BeneosUtility.debugMessage("----------------------------------------------")

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

  //Token Magic Hack  Replacement to prevent double filters when changing animations
  if (typeof TokenMagic !== 'undefined') {
    let OrigSingleLoadFilters = TokenMagic._singleLoadFilters;
    TokenMagic._singleLoadFilters = async function (placeable, bulkLoading = false) {
      if (BeneosUtility.checkIsBeneosToken(placeable)) return;
      OrigSingleLoadFilters(placeable, bulkLoading);
    }
  } else {
    console.log("No Token Magic found !!!")
  }

  BeneosUtility.updateSceneTokens()
  //BeneosUtility.checkLockViewPresence()

  // Cloud login, welcome and news messages are GM-only
  if (game.user.isGM) {
    game.beneos.cloud.loginAttempt()
    BeneosUtility.checkWelcomeMessage()
    BeneosUtility.checkNewsMessage()
  }

  if (game.settings.get(BeneosUtility.moduleID(), "beneos-reload-search-engine")) {
    setTimeout(() => {
      game.settings.set(BeneosUtility.moduleID(), "beneos-reload-search-engine", false)
      let searchEngine = new BeneosSearchEngineLauncher;
      searchEngine.render()
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
        console.log("Beneos Journal Entry", beneosJournalEntry)
        $(html).find('img.beneosJournalAction').click((event) => {
          event.preventDefault();
          beneosJournalEntry.sheet.render(true);
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
  let beneosVariantsHUD = BeneosUtility.getVariants(tokenConfig)
  const beneosVariantsDisplay = await foundry.applications.handlebars.renderTemplate('modules/beneos-module/templates/beneosvariants.html',
    { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getBeneosTokenDataPath(), beneosVariantsHUD, current: tokenConfig.number })
  $(html).find('div.right').append(beneosVariantsDisplay).click((event) => {
    let beneosClickedButton = event.target.parentElement;
    let beneosTokenButton = $(html).find('.beneos-token-variants')[0];

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

})

/********************************************************************************** */
Hooks.on("deleteActor", (actor, options) => {
  if (actor?.pack == "world.beneos_module_actors") {
    BeneosUtility.removeTokenFromActorId(actor.id)
  }
  return true;
})
/********************************************************************************** */
Hooks.on("preCreateActor", (actor, data, context) => {
  if (actor?.flags?.world?.beneos?.fullId) {
    let folder = game.folders.getName("Beneos Actors")
    if (folder) {
      // databaseHolder may not be ready yet (e.g. during an early
      // ZipImporter run); fall back to the top-level Beneos Actors folder
      // instead of crashing the whole preCreateActor chain.
      let tokenDb = game.beneos?.databaseHolder?.getTokenDatabaseInfo?.(actor.flags.world.beneos.tokenKey)
      let folderName = tokenDb?.properties?.type?.[0] ?? "Unknown"
      // Upper first letter
      folderName = folderName.charAt(0).toUpperCase() + folderName.slice(1)
      // Create the sub-folder if it doesn't exist
      let subFolder = game.folders.getName(folderName)
      actor.updateSource({ folder: subFolder?.id ?? folder.id })
    }
  }
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
})
/********************************************************************************** */
Hooks.on("deleteItem", (item, options) => {
  console.log("Beneos delete item", item, options)
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
          if (Hooks._beneosOpenCloudInProgress) return
          Hooks._beneosOpenCloudInProgress = true
          try {
            const src = "modules/beneos-module/ui/sfx/beneos_start.ogg"
            const helper = foundry.audio?.AudioHelper
                        ?? (typeof AudioHelper !== "undefined" ? AudioHelper : null)
            helper?.play?.({ src, volume: 0.5, autoplay: true, loop: false }, false)
          } catch (e) {}
          // Defer the heavy work outside Foundry's click handler so the
          // scene-controls activation stack unwinds first.
          setTimeout(() => {
            try { new BeneosSearchEngineLauncher().render() } catch (e) { console.error(e) }
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
  console.log("BeneosModule - getSceneContextOptions", html, options)
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
