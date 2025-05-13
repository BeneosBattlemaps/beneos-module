import { libWrapper } from "./shim.js";
import { BeneosUtility } from "./beneos_utility.js";
import { BeneosSearchEngineLauncher, BeneosModuleMenu } from "./beneos_search_engine.js";
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

  // Try to catch right click on profile image
  Hooks.on('renderActorSheet', (sheet, html, data) => {
    if (game.system.id == "pf2e") {
      $("#" + sheet.id + " .image-container .actor-image").mouseup(async function (e) {
        BeneosUtility.prepareMenu(e, sheet)
      })
    } else {
      // console.log("sheet", sheet)
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
  Hooks.on('refreshToken', (token) => {
    /* Unused : if (BeneosUtility.checkIsBeneosToken(token)) {
      // console.log(">>>>>>>>>>>>> REFRESH TOKEN", token)
      let tokenData = BeneosUtility.getTokenImageInfo(token.document?.texture?.src)
      if (!tokenData?.filename.includes("_face") && token.layer.preview?.children[0]) {
        let clone = token.layer.preview?.children.find(c => c.id == token.id)
        if (!clone) return;
        let r = new Ray(canvas.scene.tokens.get(token.id), clone)
        clone.mesh.angle = r.angle * 180 / Math.PI - 90;
        token.cursor = 'grabbing';
      }
    } */
  });

  /********************************************************************************** */
  Hooks.on('updateActor', (actor, changeData) => {
    let tokens = canvas.tokens.placeables.filter(t => t.document.actorId == actor.id)
    //console.log(">>>>>>>>><", tokens)
    for (let token of tokens) {
      if (BeneosUtility.checkIsBeneosToken(token)) {
        //BeneosUtility.debugMessage("[BENEOS TOKENS] update actor", actor)
        //BeneosUtility.debugMessage("[BENEOS TOKENS] update actor", changeData)
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

    /*if (changeData?.flags?.tokenmagic) {
      if (changeData.flags.tokenmagic?.animeInfo[0] && token.state != "move") {
        BeneosUtility.processEndEffect(token.id, changeData.flags.tokenmagic.animeInfo)
      }
    }
    BeneosUtility.debugMessage("[BENEOS TOKENS] Beneos UpdateToken", changeData) */

    if (foundry.utils.isNewerVersion(game.version, "11")) {
      if (changeData.delta?.system?.attributes != undefined && changeData.delta.system.attributes?.hp != undefined) {
        BeneosUtility.updateToken(token.id, changeData)
        return
      }
    } else {
      if (changeData.actorData?.system?.attributes != undefined && changeData.actorData.system.attributes?.hp != undefined) {
        BeneosUtility.updateToken(token.id, changeData)
        return
      }
    }

    BeneosUtility.debugMessage("[BENEOS TOKENS] Nothing to do")

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
    /*if (typeof ForgeVTT === "undefined" || !ForgeVTT.usingTheForge) {
      BeneosUtility.debugMessage("[BENEOS TOKENS] This process should only be run in Forge.")
    } else {
      BeneosUtility.updateSceneTokens()
    }*/

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
    let beneosPack = game.packs.get("beneos-module.beneos_module_journal")
    if (beneosPack) {
      let beneosJournalEntry = await beneosPack.getDocument(tokenConfig.journalId)
      if (beneosJournalEntry) {
        const beneosJournalDisplay = await renderTemplate('modules/beneos-module/templates/beneosjournal.html',
          { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getBeneosTokenDataPath() })
        html.find('div.left').append(beneosJournalDisplay);
        html.find('img.beneosJournalAction').click((event) => {
          event.preventDefault();
          beneosJournalEntry.sheet.render(true);
        })
      }
    }
  }

  //VARIANTS HUD
  //console.log("TOKEN CONFIG", tokenConfig)
  let beneosVariantsHUD = BeneosUtility.getVariants(tokenConfig)
  const beneosVariantsDisplay = await renderTemplate('modules/beneos-module/templates/beneosvariants.html',
    { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getBeneosTokenDataPath(), beneosVariantsHUD, current: tokenConfig.number })
  html.find('div.right').append(beneosVariantsDisplay).click((event) => {
    let beneosClickedButton = event.target.parentElement;
    let beneosTokenButton = html.find('.beneos-token-variants')[0];

    if (beneosClickedButton === beneosTokenButton) {
      beneosTokenButton.classList.add('active');
      html.find('.beneos-variants-wrap')[0].classList.add('beneos-active');
      html.find('.beneos-variants-wrap')[0].classList.remove('beneos-disabled');
    } else {
      beneosTokenButton.classList.remove('active')
      html.find('.beneos-variants-wrap')[0].classList.remove('beneos-active');
      html.find('.beneos-variants-wrap')[0].classList.add('beneos-disabled');
      if (beneosClickedButton.classList.contains("beneos-button-variant")) {
        event.preventDefault();
        setTimeout(function () { BeneosUtility.forceChangeToken(token.id, beneosClickedButton.dataset.variant) }, 1000)
      }
    }
  });

  // REPLACEMENT TOKEN HUD
  /* Disable old button : let tokenList = BeneosUtility.buildAvailableTokensMenu()
  const beneosTokensDisplay = await BeneosUtility.buildAvailableTokensMenuHTML("beneoshud.html", tokenList)
  html.find('div.right').append(beneosTokensDisplay).click((event) => {
    BeneosUtility.manageAvailableTokensMenu(token, html, event)
  })*/

})

/********************************************************************************** */
Hooks.on("renderActorDirectory", (app, html, data) => {
  if (game.user.can('ACTOR_CREATE')) {
    const button = document.createElement('button');
    button.style.width = '95%';
    button.innerHTML = 'Search Beneos Database'
    button.addEventListener('click', () => {
      new BeneosSearchEngineLauncher().render()
    })
    $(html).find('.header-actions').after(button)
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
