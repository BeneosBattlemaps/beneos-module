import { libWrapper } from "./shim.js";
import { BeneosUtility } from "./beneos_utility.js";
import { BeneosSearchEngineLauncher, BeneosModuleMenu } from "./beneos_search_engine.js";

/********************************************************************************** */
Hooks.once('init', () => {

  // HAck to prevent errors when the animated textures are not fully loaded
  Token.prototype.oldRefresh = Token.prototype.refresh
  Token.prototype.refresh = function () {
    //console.log("TJIS", this, this.icon)
    try {
      if (this.mesh == undefined || typeof (this.mesh.scale) != 'object') {
        return this
      }
      return Token.prototype.oldRefresh.call(this)
    }
    catch {
      return this
    }
  }
})

/********************************************************************************** */
Hooks.once('ready', () => {

  BeneosUtility.debugMessage("----------------------------------------------")
  BeneosUtility.debugMessage(`Loading ${BeneosUtility.moduleName()} module...`)
  BeneosUtility.debugMessage("----------------------------------------------")

  BeneosUtility.forgeInit()
  BeneosUtility.registerSettings()
  
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

  //Replacement of the token movement across the maps
  libWrapper.register(BeneosUtility.moduleID(), 'CanvasAnimation.animateLinear', (function () {

    return async function (wrapped, ...args) {
      console.log(">>>>> ANIMATE !!!!", args)
      let options = args[1];
      let name = options.name;
      if (options.duration === 0 || !name || !name.startsWith('Token.') || !name.endsWith('.animateMovement'))
        return wrapped.apply(this, args);

      let token = args[0][0].parent;
      let ray = token._movement;
      let instantTeleport = Math.max(Math.abs(ray.dx), Math.abs(ray.dy)) <= canvas.grid.size;
      if (instantTeleport) {
        args[1].duration = 0;
        return wrapped.apply(this, args);
      }

      options.duration = (ray.distance * 1000) / (canvas.dimensions.size * game.settings.get(BeneosUtility.moduleID(), 'beneos-speed'));

      return wrapped.apply(this, args);
    }
  })());

  BeneosUtility.init()

  if (!game.user.isGM) {
    return
  }

  // Try to catch right click on profile image
  Hooks.on('renderActorSheet', (sheet, html, data) => {
    if (game.system.id == "pf2e") {
      $(".image-container .actor-image").mousedown(async function (e) {
        BeneosUtility.prepareMenu(e, sheet)
      })
    } else {
      $(".sheet-header .profile").mousedown(async function (e) {
        BeneosUtility.prepareMenu(e, sheet)
      })
    }
  });

  BeneosUtility.updateSceneTokens()

  /********************************************************************************** */
  Hooks.on('preUpdateToken', (token, changeData) => {
    console.log("CHANGEDATA", token)
    if (!game.user.isGM || !BeneosUtility.isBeneosModule() || !canvas.ready || token.texture.src != undefined) {
      return
    }

    if (!token) {
      BeneosUtility.debugMessage("[BENEOS TOKENS] Token not found")
      return
    }

    if (BeneosUtility.checkIsBeneosToken(token)) {
      if (changeData.scale != undefined) {
        let tokenData = BeneosUtility.getTokenImageInfo(token.texture.src)
        for (let [key, value] of Object.entries(BeneosUtility.beneosTokens[tokenData.tokenKey][tokenData.variant])) {
          if (value["a"] == tokenData.currentStatus) {
            let scaleFactor = (changeData.scale / value["s"])
            BeneosUtility.debugMessage("[BENEOS TOKENS] Beneos PreUpdate Token scale....")
            token.document.setFlag(BeneosUtility.moduleID(), "scalefactor", scaleFactor)
            break
          }
        }
      }
    }
  })

  /********************************************************************************** */
  Hooks.on('updateActor', (actor, changeData) => {
    let tokens = canvas.tokens.placeables.filter(t => t.document.actorId == actor.id)
    //console.log(">>>>>>>>><", tokens)
    for(let token of tokens) {
      if ( BeneosUtility.checkIsBeneosToken(token)) {
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

    if (changeData?.flags?.tokenmagic ) {
      if (changeData.flags.tokenmagic?.animeInfo[0] && token.state != "move") {
        BeneosUtility.processEndEffect(token.id, changeData.flags.tokenmagic.animeInfo)
      }
    }
    BeneosUtility.debugMessage("[BENEOS TOKENS] Beneos UpdateToken", changeData)

    if (changeData.actorData?.system?.attributes != undefined && changeData.actorData.system.attributes?.hp != undefined ) {
      BeneosUtility.updateToken(token.id, changeData)
      return
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
    if (typeof ForgeVTT === "undefined" || !ForgeVTT.usingTheForge) {
      BeneosUtility.debugMessage("[BENEOS TOKENS] This process should only be run in Forge.")
    } else {
      BeneosUtility.updateSceneTokens()
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
  let tokenData = BeneosUtility.getTokenImageInfo(token.document.texture.src)
  let tokenConfig = BeneosUtility.beneosTokens[tokenData.tokenKey]
  // JOURNAL HUD
  if (tokenConfig?.config) {
    if (tokenConfig.config.compendium) {
      let beneosPack = game.packs.get("beneos_module.beneos_module_journal")
      if (beneosPack) {
        let beneosJournalEntry = null
        let beneosCompendiumEntry = beneosPack.index.getName(tokenConfig.config.compendium)
        if (beneosCompendiumEntry?._id) {
          beneosJournalEntry = beneosPack.getDocument(beneosCompendiumEntry._id)
        }
        if (beneosJournalEntry) {
          const beneosJournalDisplay = await renderTemplate('modules/beneos_module/templates/beneosjournal.html',
            { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getBeneosTokenDataPath() })
          html.find('div.left').append(beneosJournalDisplay);
          html.find('img.beneosJournalAction').click((event) => {
            event.preventDefault()
            beneosJournalEntry.then(function (result) { result.sheet.render(true) })
          })
          html.find('img.beneosTokenSizePlus').click((event) => {
            event.preventDefault()
            BeneosUtility.userIncDecSize(token.id, tokenData.tokenKey, 0.1)
          })
          html.find('img.beneosTokenSizeMinus').click((event) => {
            event.preventDefault()
            BeneosUtility.userIncDecSize(token.id, tokenData.tokenKey, -0.1)
          })
        }
      }
    }

    //VARIANTS HUD
    if (tokenConfig.config.variants && Object.keys(tokenConfig.config.variants).length > 0) {
      let beneosVariantsHUD = []
      beneosVariantsHUD.push({ "name": "Default" })
      Object.entries(tokenConfig.config.variants).forEach(([key, value]) => {
        beneosVariantsHUD.push({ "name": key })
      })

      const beneosVariantsDisplay = await renderTemplate('modules/beneos_module/templates/beneosvariants.html',
        { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getBeneosTokenDataPath(), beneosVariantsHUD })
      if (!BeneosUtility.isBeneosModule()) {
        return
      }
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
            token.document.setFlag(BeneosUtility.moduleID(), "variant", beneosClickedButton.dataset.variant)
            setTimeout(function () { BeneosUtility.updateToken(token.id, { forceupdate: true }) }, 1000)
          }
        }
      });
    }
  }

  // Idle management
  let beneosTokensIdleHUD = BeneosUtility.getIdleTokens(token)
  if (game.user.isGM && game.settings.get(BeneosUtility.moduleID(), 'beneos-god-mode')) {
    beneosTokensIdleHUD = beneosTokensIdleHUD.concat(BeneosUtility.getAnimatedTokens(token))
  }
  const beneosTokensIdleDisplay = await renderTemplate('modules/beneos_module/templates/beneosidlehud.html',
    { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getBeneosTokenDataPath(), beneosTokensIdleHUD })
  html.find('div.right').append(beneosTokensIdleDisplay).click((event) => {
    let beneosClickedButton = event.target.parentElement
    let beneosTokenButton = html.find('.beneos-token-hud-idle-action')[0]

    if (beneosClickedButton === beneosTokenButton) {
      beneosTokenButton.classList.add('active')
      html.find('.beneos-selector-idle-wrap')[0].classList.add('beneos-active')
      html.find('.beneos-selector-idle-wrap')[0].classList.remove('beneos-disabled')
    } else {
      beneosTokenButton.classList.remove('active')
      html.find('.beneos-selector-idle-wrap')[0].classList.remove('beneos-active')
      html.find('.beneos-selector-idle-wrap')[0].classList.add('beneos-disabled')
      if (beneosClickedButton.classList.contains("beneos-button-idle-token")) {
        event.preventDefault()
        let finalImage = beneosClickedButton.dataset.token
        setTimeout(function () {
          BeneosUtility.forceIdleTokenUpdate(token.id, finalImage)
        }, 200)
      }
    }
  })

  // REPLACEMENT TOKEN HUD
  let tokenList = BeneosUtility.buildAvailableTokensMenu()
  const beneosTokensDisplay = await BeneosUtility.buildAvailableTokensMenuHTML("beneoshud.html", tokenList)
  html.find('div.right').append(beneosTokensDisplay).click((event) => {
    BeneosUtility.manageAvailableTokensMenu(token, html, event)
  })

  // Size management
  if (game.user.isGM && game.settings.get(BeneosUtility.moduleID(), 'beneos-god-mode')) {
    const beneosTokensSize = await renderTemplate('modules/beneos_module/templates/beneosreloadjson.html',
      { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getFullPathWithSlash(), tokenData })
    let buttonSize = html.find('div.right').append(beneosTokensSize)

    buttonSize.click((event) => {
      let beneosClickedButton = event.target.parentElement
      let beneosTokenButton = html.find('.beneos-token-hud-reload')[0]
      if (beneosTokenButton == beneosClickedButton) {
        let tokenImg = $(beneosTokenButton).data("img")
        BeneosUtility.changeSize(token.id, tokenImg, 0.1)
      } else {
        let beneosTokenButton = html.find('.beneos-token-hud-save')[0]
        if (beneosTokenButton == beneosClickedButton) {
          BeneosUtility.saveJSONConfig(tokenData.tokenKey)
        }
      }
    })
    buttonSize.contextmenu((event) => {
      let beneosClickedButton = event.target.parentElement
      let beneosTokenButton = html.find('.beneos-token-hud-reload')[0]
      if (beneosTokenButton == beneosClickedButton) {
        let tokenImg = $(beneosTokenButton).data("img")
        BeneosUtility.changeSize(token.id, tokenImg, -0.1)
      }
    })
  }
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
    html.find('.header-actions').after(button)
  }
})

