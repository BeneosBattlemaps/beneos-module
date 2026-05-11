/********************************************************************************* */
import { BeneosTableTop } from "./beneos-table-top.js";
import { BeneosSearchEngineLauncher, BeneosDatabaseHolder, BeneosModuleMenu } from "./beneos_search_engine.js";
import { ClassCounter } from "./count-class-ready.js";
import { BeneosCloud, BeneosCloudLogin, BeneosCloudSettings, BeneosCloudAccountMenu } from "./beneos_cloud.js";

/********************************************************************************* */
globalThis.BENEOS_MODULE_NAME = "Beneos Module"
globalThis.BENEOS_MODULE_ID = "beneos-module"
globalThis.BENEOS_DEFAULT_TOKEN_PATH = "beneos_assets"

let beneosDebug = true
let beneosFadingSteps = 10
let beneosFadingWait = 30
let beneosFadingTime = beneosFadingSteps * beneosFadingWait
let __mask = 0xffffffff

/********************************************************************************* */
export class TableTopModeSettings extends FormApplication {

  constructor(object = {}, options) {
    super(object, options);
  }

  /** @override */
  static get defaultOptions() {
    return {
      ...super.defaultOptions,
      template: 'modules/beneos-module/templates/beneos-table-top-settings.html',
      height: 'auto',
      title: 'Table Top Mode Settings',
      width: 600,
      classes: ['beneos-module', 'settings'],
      tabs: [
        {
          contentSelector: 'form',
        },
      ],
      submitOnClose: false,
    };
  }

  static getDefaultTableTopSettings() {
    let config = {
      tableTopEnabled: false,
      performanceModePerUsers: [],
      controlPlayerView: true,
      autoScaleTVGrid: true,
      autoScaleTVWidthDiagonal: 90,
      autoScaleTVRatio: "16/9",
      gridOpacity: 0.5,
      miniatureSize: 25,
    }
    return config
  }

  getData() {
    let data = super.getData();
    data.config = game.settings.get(BeneosUtility.moduleID(), 'beneos-table-top-config') || this.getDefaultTableTopSettings();
    // Check if performanceModePerUsers is an array or not
    if (!Array.isArray(data.config.performanceModePerUsers)) {
      data.config.performanceModePerUsers = []
    }
    // Auto fill users
    for (let u of game.users) {
      if (!data.config.performanceModePerUsers.find(x => x.id == u.id)) {
        data.config.performanceModePerUsers.push({ id: u.id, name: u.name, perfMode: false })
      }
    }
    return data
  }

  async _updateObject(_, formData) {
    const data = foundry.utils.expandObject(formData)
    let config = game.settings.get(BeneosUtility.moduleID(), 'beneos-table-top-config')
    data.performanceModePerUsers = structuredClone(config.performanceModePerUsers) || []
    if (!Array.isArray(data.performanceModePerUsers)) {
      data.config.performanceModePerUsers = []
      for (let u of game.users) {
        if (!data.config.performanceModePerUsers.find(x => x.id == u.id)) {
          data.config.performanceModePerUsers.push({ id: u.id, name: u.name, perfMode: false })
        }
      }
    }
    //BeneosUtility.debugMessage("Updating object", data, config)
    for (let idx = 0; idx < data.performanceModePerUsersArray.length; idx++) {
      if (data.performanceModePerUsers[idx]) {
        data.performanceModePerUsers[idx].perfMode = data.performanceModePerUsersArray[idx] // Update with form flag value
      } else {
        console.warn("[Beneos] Error in updating user performance mode", idx, data)
      }
    }
    //BeneosUtility.debugMessage("Updating object",formData, data)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-table-top-config', data)

    // Manage the ON/OFF value
    await BeneosTableTop.manageTableTopMode(data.tableTopEnabled)

    window.location.reload() // Force reload after save
  }
}


/********************************************************************************* */
export class BeneosUtility {

  /********************************************************************************** */
  static forgeInit() {
    this.beneosBasePath = ""

    if (typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge) {
      this.debugMessage("[BENEOS MODULE] This process should only be run in Forge.")
      let ForgeVTTuserid = ForgeAPI.getUserId()
      ForgeVTTuserid.then(result => {
        this.beneosBasePath = ForgeVTT.ASSETS_LIBRARY_URL_PREFIX + result + "/"
      })
    }
  }

  /********************************************************************************** */
  static registerSettings() {

    // Common internal settings
    game.settings.register(BeneosUtility.moduleID(), 'beneos-user-config', {
      name: 'Internal data store for user-defined parameters',
      default: {},
      type: Object,
      scope: 'world',
      config: false
    })

    game.beneosTokens = {
      moduleId: BENEOS_MODULE_ID,
      BeneosUtility,
      BeneosCloud
    }

    game.settings.register(BeneosUtility.moduleID(), 'beneos-cloud-foundry-id', {
      name: 'Internal storage of the User ID with Beneos Cloud',
      default: "",
      type: String,
      scope: 'world',
      config: false,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), "beneos-cloud-patreon-status", {
      name: 'Patreon status of the user',
      default: "",
      type: String,
      scope: 'world',
      config: false,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-reload-search-engine', {
      name: 'Internal storage of the User ID with Beneos Cloud',
      default: "",
      type: Boolean,
      scope: 'world',
      config: false,
      restricted: true,
      default: false
    })

    // Wave B-9: per-user list/grid view preference for the V2 cloud
    // window. Client-scoped because the choice is purely visual; each
    // GM can pick their own preferred density.
    game.settings.register(BeneosUtility.moduleID(), 'beneos-cloud-view-mode', {
      name: 'Beneos Cloud V2 view mode',
      scope: 'client',
      config: false,
      type: String,
      default: 'list'
    })

    // Top-Down Stage 2: per-user default install style for tokens.
    // "tokenized" = classic 2.5D (-token.webp), "topdown" = top-down
    // skin (-top.webp). The Search-Window sidebar exposes a radio so
    // each GM can switch on the fly; persistent across sessions.
    game.settings.register(BeneosUtility.moduleID(), 'beneos-default-install-style', {
      name: 'Beneos default token install style',
      scope: 'client',
      config: false,
      type: String,
      default: 'tokenized'
    })

    // Stage 13a: hidden Creator-Mode toggle for the Beneos design team.
    // When enabled, prototypeToken-Scale-Änderungen on Beneos creatures
    // get auto-persisted into flags.world.beneos.rendering via the
    // preUpdateActor hook in beneos_module.js. End-User mode (default)
    // keeps Foundry-State edits out of the flag namespace, so cloud
    // re-installs reset the canvas state cleanly. Activation is via
    // console only — config:false hides the toggle from the Foundry
    // settings dialog, since this is internal team tooling and not
    // something end-users should ever flip.
    // Aktivierung: game.settings.set("beneos-module", "beneos-creator-mode", true)
    game.settings.register(BeneosUtility.moduleID(), 'beneos-creator-mode', {
      name: 'Beneos Creator Mode (internal)',
      scope: 'client',
      config: false,
      type: Boolean,
      default: false
    })

    // Wave B-9-fix-68: single state-aware menu. The button class
    // BeneosCloudAccountMenu inspects game.beneos.cloud.isLoggedIn()
    // at click time and dispatches to the login dialog OR the
    // disconnect handler. Previously we registered one of two menus
    // conditionally on the stored foundryId at init — that worked on
    // first load but stayed stale after a runtime login/logout
    // (Foundry doesn't re-evaluate menu definitions without a reload).
    game.settings.registerMenu(BeneosUtility.moduleID(), "beneos-cloud-account", {
      name: "BENEOS.Settings.CloudAccount.Name",
      label: "BENEOS.Settings.CloudAccount.Label",
      hint: "BENEOS.Settings.CloudAccount.Hint",
      scope: 'world',
      config: true,
      type: BeneosCloudAccountMenu,
      restricted: true
    })

    game.settings.registerMenu(BeneosUtility.moduleID(), "beneos-search-engine", {
      name: "BENEOS.Settings.SearchEngine.Name",
      label: "BENEOS.Settings.SearchEngine.Label",
      hint: "BENEOS.Settings.SearchEngine.Hint",
      scope: 'world',
      config: true,
      type: BeneosSearchEngineLauncher,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), "beneos-datapath", {
      name: "Storage path of tokens assets",
      hint: "Location of tokens and associated datas",
      scope: 'world',
      config: false,
      default: BENEOS_DEFAULT_TOKEN_PATH,
      type: String,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), "beneos-death-management", {
      name: "BENEOS.Settings.DeathManagement.Name",
      hint: "BENEOS.Settings.DeathManagement.Hint",
      scope: 'world',
      config: true,
      default: true,
      type: Boolean,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), "beneos-god-mode", {
      name: "Enable God Mode",
      hint: "",
      scope: 'world',
      config: false,
      default: false,
      type: Boolean,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-database-local-storage', {
      name: 'Internal storage of the Beneos database',
      type: Object,
      scope: 'world',
      default: {},
      config: false
    })


    // Keep track of the latest news message displayed
    game.settings.register(BeneosUtility.moduleID(), 'beneos-cloud-latest-news-id', {
      name: 'Last news message ID',
      type: String,
      scope: 'world',
      default: "",
      config: false
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', {
      name: 'Global JSON config for tokens',
      type: String,
      scope: 'world',
      default: "",
      config: false
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-json-itemconfig', {
      name: 'Global JSON config for items',
      type: String,
      scope: 'world',
      default: "",
      config: false
    })
    game.settings.register(BeneosUtility.moduleID(), 'beneos-json-spellconfig', {
      name: 'Global JSON config for spells',
      type: String,
      scope: 'world',
      default: "",
      config: false
    })


    /*game.settings.register('beneos-cloud', 'access_token', {
      name: 'Beneos Cloud Access Token',
      hint: 'Access token for Beneos Cloud (ie Patreon access key)',
      scope: 'world',
      config: true,
      type: String,
      restricted: true,
      default: ''
    })*/
    game.settings.register(BeneosUtility.moduleID(), 'beneos-user-config', {
      name: 'Internal data store for user-defined parameters',
      default: {},
      type: Object,
      scope: 'world',
      config: false
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-ui-state', {
      name: 'Internal data store for user-defined parameters',
      default: {},
      type: Boolean,
      scope: 'world',
      config: false,
      default: true
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-bmap-notice-dismissed', {
      name: 'Battlemap import notice dismissed',
      type: Boolean,
      scope: 'world',
      default: false,
      config: false
    })

    /*game.settings.register(BeneosUtility.moduleID(), 'beneos-table-top-config', {
      name: 'Internal data store for table top mode settings',
      default: TableTopModeSettings.getDefaultTableTopSettings(),
      type: Object,
      scope: 'world',
      config: false
    })

    const menuTableTopModeSettings = {
      key: 'tableTopModeSettings',
      config: {
        name: 'Configure Table Top mode',
        label: 'Table Top Mode',
        hint: 'Configure the Table Top mode features',
        type: TableTopModeSettings,
        restricted: true,
      },
    };

    const settingAutoTemplateSettings = {
      key: 'tableTopModeSettings',
      config: {
        name: 'Table Top mode settings',
        hint: 'Configure the Table Top mode settings',
        scope: 'world',
        config: false,
        default: {},
        type: Object,
      },
    };

    game.settings.registerMenu(BeneosUtility.moduleID(), menuTableTopModeSettings.key, menuTableTopModeSettings.config);
      game.settings.register(
        BeneosUtility.moduleID(),
        settingAutoTemplateSettings.key,
        foundry.utils.mergeObject(
          settingAutoTemplateSettings.config,
          {
            requiresReload: true
          },
          true,
          true
        )
      );*/
  }

  static openPostInNewTab(url, params) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = '_blank';

    for (const key in params) {
      if (params.hasOwnProperty(key)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = params[key];
        form.appendChild(input);
      }
    }
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }


  /********************************************************************************** */
  static getLocalStorage() {
    let localStorage = game.settings.get(BeneosUtility.moduleID(), 'beneos-database-local-storage') || {}
    return localStorage
  }

  /********************************************************************************** */
  static saveLocalStorage(data) {
    let localStorage = game.settings.get(BeneosUtility.moduleID(), 'beneos-database-local-storage') || {}
    localStorage = foundry.utils.mergeObject(localStorage, data)
    game.settings.set(BeneosUtility.moduleID(), 'beneos-database-local-storage', localStorage)
  }

  /********************************************************************************** */
  static getTableTopConfig() {
    return game.settings.get(BeneosUtility.moduleID(), 'beneos-table-top-config') || TableTopModeSettings.getDefaultTableTopSettings()
  }

  /********************************************************************************** */
  static setupSocket() {
    game.socket.on(`module.beneos-module`, (msg) => {
      //BeneosUtility.debugMessage('pl',payload)
      if (msg.name == 'msg_set_view_position') { BeneosTableTop.applyPosition(msg.data) }
      if (msg.name == 'msg_toggle_ui_elements') { BeneosTableTop.applyUIElements(msg.data) }
      if (msg.name == 'msg_request_user_view') { BeneosTableTop.sendUserViewMessage() }
      if (msg.name == 'msg_user_view_response') { BeneosTableTop.processUserCurrentView(msg.data) }
    });
  }

  /********************************************************************************** */
  static reloadInternalSettings() {
    try {
      this.beneosTokens = JSON.parse(game.settings.get(BeneosUtility.moduleID(), 'beneos-json-tokenconfig'))
    }
    catch {
      console.warn("[Beneos] Token JSON loading error")
      this.beneosTokens = {}
    }

    try {
      this.beneosSpells = JSON.parse(game.settings.get(BeneosUtility.moduleID(), 'beneos-json-spellconfig'))
    }
    catch {
      console.warn("[Beneos] Spell JSON loading error")
      this.beneosSpells = {}
    }

    try {
      this.beneosItems = JSON.parse(game.settings.get(BeneosUtility.moduleID(), 'beneos-json-itemconfig'))
    }
    catch {
      console.warn("[Beneos] Item JSON loading error")
      this.beneosItems = {}
    }
  }

  /********************************************************************************** */
  static getActorPack() {
    return game.packs.get("world.beneos_module_actors")
  }
  static getJournalPack() {
    return game.packs.get("world.beneos_module_journal")
  }
  static getItemPack() {
    return game.packs.get("world.beneos_module_items")
  }
  static getSpellPack() {
    return game.packs.get("world.beneos_module_spells")
  }
  static async lockUnlockAllPacks(flag = false) {
    let actorPack = this.getActorPack()
    let journalPack = this.getJournalPack()
    let itemPack = this.getItemPack()
    let spellPack = this.getSpellPack()
    if (actorPack) await actorPack.configure({ locked: flag })
    if (journalPack) await journalPack.configure({ locked: flag })
    if (itemPack) await itemPack.configure({ locked: flag })
    if (spellPack) await spellPack.configure({ locked: flag })
  }



  /********************************************************************************** */
  static async verifySettingsAgainstCompendium() {
    let toSave = false
    let actorDelete = []
    let itemDelete = []
    let spellDelete = []
    let actorPack = BeneosUtility.getActorPack()
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token?.actorId && !actorPack.index.some(i => i._id == token.actorId)) {
        BeneosUtility.debugMessage("Beneos Compendium actor not found for token", fullKey, token.actorId)
        delete this.beneosTokens[fullKey]
        toSave = true
      } else {
        // Check if the image/token are still present in the filesystem
        // Get the actor from the compendium
        let actor = actorPack.index.find(i => i._id == token.actorId)
        if (actor) {
          let ret = await foundry.utils.srcExists(actor.img)
          if (ret && actor.prototypeToken?.texture?.src) {
            ret = await foundry.utils.srcExists(actor.prototypeToken.texture.src)
          }
          if (!ret) {
            BeneosUtility.debugMessage("Beneos Compendium actor image not found for token", fullKey, actor.prototypeToken?.texture?.src)
            actorDelete.push(actor._id)
            delete this.beneosTokens[fullKey]
            toSave = true
          }
        }
      }
    }

    let itemPack = game.packs.get("world.beneos_module_items")
    for (let [fullKey, item] of Object.entries(this.beneosItems)) {
      if (item.itemId && !itemPack.index.some(i => i._id == item.itemId)) {
        BeneosUtility.debugMessage("Beneos Compendium item not found for item", fullKey, item.itemId)
        delete this.beneosItems[fullKey]
        toSave = true
      } else {
        let itemC = itemPack.index.find(i => i._id == item.itemId)
        if (itemC) {
          let ret = await foundry.utils.srcExists(itemC.img)
          if (!ret) {
            BeneosUtility.debugMessage("Beneos Compendium item image not found for item", fullKey, itemC.img)
            itemDelete.push(itemC._id)
            delete this.beneosItems[fullKey]
            toSave = true
          }
        }
      }
    }

    let spellPack = game.packs.get("world.beneos_module_spells")
    for (let [fullKey, spell] of Object.entries(this.beneosSpells)) {
      if (spell.spellId && !spellPack.index.some(i => i._id == spell.spellId)) {
        BeneosUtility.debugMessage("Beneos Compendium spell not found for spell", fullKey, spell.spellId)
        delete this.beneosSpells[fullKey]
        toSave = true
      } else {
        let spellC = spellPack.index.find(i => i._id == spell.spellId)
        if (spellC) {
          let ret = await foundry.utils.srcExists(spellC.img)
          if (!ret) {
            BeneosUtility.debugMessage("Beneos Compendium item image not found for item", fullKey, spellC.img)
            spellDelete.push(spellC._id)
            delete this.beneosSpells[fullKey]
            toSave = true
          }
        }
      }
    }

    if (game.user.isGM && toSave) {
      let packName = "world.beneos_module_actors"
      await BeneosUtility.lockUnlockAllPacks(false) // Unlock the packs before deleting
      for (let id of actorDelete) {
        await Actor.deleteDocuments([id], { pack: packName })
      }
      for (let id of itemDelete) {
        await Item.deleteDocuments([id], { pack: "world.beneos_module_items" })
      }
      for (let id of spellDelete) {
        await Item.deleteDocuments([id], { pack: "world.beneos_module_spells" })
      }
      await BeneosUtility.lockUnlockAllPacks(true) // Lock the packs after deleting

      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', JSON.stringify(this.beneosTokens))
      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', JSON.stringify(this.beneosItems))
      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-spellconfig', JSON.stringify(this.beneosSpells))
      // Post chat message to inform the user that the world will reload
      ChatMessage.create({
        content: `<div class="beneos-module"><p>Some Beneos files have been deleted or are corrupted. Affected assets must be downloaded again. Please refresh Foundry VTT with (F5 on Windows) to complete this.</p></div>`,
      });
    }
  }

  /********************************************************************************** */
  static async createCompendiums() {
    // Create the "Beneos Spells" folder if it doesn't exist
    const packFolder = game.folders.getName("Beneos Data") || await Folder.create({
      name: "Beneos Data", type: "Compendium"
    })

    // Create compendiums
    if (!game.packs.get("world.beneos_module_actors")) {
      let pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ "label": "Beneos Tokens", "name": "beneos_module_actors", "type": "Actor" });
      await pack.setFolder(packFolder.id);
    }
    if (!game.packs.get("world.beneos_module_journal")) {
      let pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ "label": "Beneos Journals", "name": "beneos_module_journal", "type": "JournalEntry" });
      await pack.setFolder(packFolder.id);
    }
    if (game.system.id == "dnd5e") {
      if (!game.packs.get("world.beneos_module_items")) {
        let pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ "label": "Beneos Items", "name": "beneos_module_items", "type": "Item" });
        await pack.setFolder(packFolder.id);
      }
      if (!game.packs.get("world.beneos_module_spells")) {
        let pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ "label": "Beneos Spells", "name": "beneos_module_spells", "type": "Item" });
        await pack.setFolder(packFolder.id);
      }
    }
    await this.verifySettingsAgainstCompendium()
  }

  /********************************************************************************** */
  static ready() {
    this.file_cache = {}
    this.titleCache = {}

    this.sheetLoaded = false

    this.beneosModule = true // Deprecated game.settings.get(BeneosUtility.moduleID(), 'beneos-animations')
    this.beneosHealth = {}
    this.standingImage = {}
    this.beneosPreload = []
    this.beneosTokens = {}
    this.beneosSpells = {}
    this.beneosItems = {}
    if (game.user.isGM) {
      this.tokenDataPath = game.settings.get(BeneosUtility.moduleID(), 'beneos-datapath')
      this.itemDataPath = game.settings.get(BeneosUtility.moduleID(), 'beneos-datapath')
      this.spellDataPath = game.settings.get(BeneosUtility.moduleID(), 'beneos-datapath')
      this.tokenDataPath += "/beneos_tokens/"
      this.itemDataPath += "/beneos_items/"
      this.spellDataPath += "/beneos_spells/"
    }

    this.reloadInternalSettings()
    // Check if folder exists
    if (game.user.isGM) {
      this.createCompendiums()
    }

    BeneosUtility.debugMessage("Loaded", this.beneosTokens)

    this.m_w = 123456789
    this.m_z = 987654321
    this.seed(Date.now())

    Handlebars.registerHelper('isEmpty', function (text) {
      if (typeof text !== 'string' && typeof text !== 'object') return false
      return text.length === 0
    })
    Handlebars.registerHelper('beneosAdd', function (a, b) {
      return parseInt(a) + parseInt(b);
    });

    Handlebars.registerHelper('beneosLength', function (text) {
      if (typeof text !== 'string' && typeof text !== 'object') return 0
      return text.length
    })
    Handlebars.registerHelper('beneosUpperFirst', function (text) {
      if (typeof text !== 'string') return text
      return text.charAt(0).toUpperCase() + text.slice(1)
    })
    Handlebars.registerHelper('getTagDescription', function (text) {
      return BeneosDatabaseHolder.getTagDescription(text)
    })
    Handlebars.registerHelper('beneosLowerCase', function (text) {
      if (typeof text !== 'string') return text
      return text.toLowerCase()
    })
    Handlebars.registerHelper('beneosGetHover', function (category, term) {
      return BeneosDatabaseHolder.getHover(category, term)
    })
    Handlebars.registerHelper('beneosChoose', function (text1, text2) {
      if (text1 && text1 != "") {
        return text1
      }
      return text2
    })
    Handlebars.registerHelper('beneosSubstr', function (text, len) {
      if (typeof text !== 'string') return text
      if (text.length <= len + 1) return text
      return text.substring(0, len) + "."
    })

    //Token Magic Hack  Replacement to prevent double filters when changing animations
    if (typeof TokenMagic !== 'undefined') {
      let OrigSingleLoadFilters = TokenMagic._singleLoadFilters;
      TokenMagic._singleLoadFilters = async function (placeable, bulkLoading = false) {
        if (BeneosUtility.checkIsBeneosToken(placeable)) return;
        OrigSingleLoadFilters(placeable, bulkLoading);
      }
    } else {
      BeneosUtility.debugMessage("No Token Magic found !!!")
    }

    if (game.user.isGM) {
      let stats = this.countBeneosAssetsUsage()
      try {
        ClassCounter.registerUsageCount('beneos-module', { beneosStats: stats })
      } catch (e) {
        BeneosUtility.debugMessage("Unable to register usage count, not important", e)
      }
    }

  }

  /********************************************************************************** */
  static getSceneBackgroundSrc(scene) {
    if (scene.firstLevel) return scene.firstLevel.background?.src;
    return scene.background?.src;
  }

  /********************************************************************************** */
  static async updateSceneBackgroundSrc(scene, srcPath) {
    if (scene.firstLevel) {
      await scene.firstLevel.update({"background.src": srcPath});
    } else {
      await scene.update({'background.src': srcPath});
    }
  }

  /********************************************************************************** */
  static countBeneosAssetsUsage() {
    let statsBeneos = { maps: {}, tokens: {}, items: {}, spells: {} }
    for (let scene of game.scenes) {
      let bgSrc = BeneosUtility.getSceneBackgroundSrc(scene)
      if (bgSrc?.includes('beneos-battlemaps-universe')) {
        statsBeneos.maps[bgSrc] = (statsBeneos.maps[bgSrc]) ? statsBeneos.maps[bgSrc] + 1 : 1
      }
    }
    for (let item of game.items) {
      if (item?.img?.includes('beneos_assets')) {
        let itemData = this.getItemSpellImageInfo(item.img)
        if (item.type == 'spell') {
          statsBeneos.spells[itemData.itemKey] = (statsBeneos.spells[itemData.itemKey]) ? statsBeneos.spells[itemData.itemKey] + 1 : 1
        } else {
          statsBeneos.items[itemData.itemKey] = (statsBeneos.items[itemData.itemKey]) ? statsBeneos.items[itemData.itemKey] + 1 : 1
        }
      }
    }
    for (let actor of game.actors) {
      if (actor?.prototypeToken?.texture?.src?.includes('beneos_assets')) {
        let tokenData = this.getTokenImageInfo(actor.prototypeToken.texture.src)
        if (tokenData?.fullKey) {
          statsBeneos.tokens[tokenData.fullKey] = (statsBeneos.tokens[tokenData.fullKey]) ? statsBeneos.tokens[tokenData.fullKey] + 1 : 1
        }
      }
    }
    return statsBeneos
  }

  /********************************************************************************** */
  static async checkNewsMessage() {
    try {
      const response = await fetch('https://beneos.cloud/messages/news_msg.json');
      if (!response.ok) {
        console.warn("[Beneos] Failed to fetch news message");
        return;
      }

      const newsData = await response.json();

      // Vérifier que les champs requis sont présents
      if (!newsData.id || !newsData.created_at || !newsData.content) {
        console.warn("[Beneos] Invalid news message format");
        return;
      }

      // Récupérer l'ID du dernier message affiché
      const lastNewsId = game.settings.get(BeneosUtility.moduleID(), 'beneos-cloud-latest-news-id');

      // Si l'ID est différent, afficher le message
      if (newsData.id !== lastNewsId) {
        this.displayNewsDialog(newsData);
      }
    } catch (error) {
      console.warn("[Beneos] Error checking news message:", error);
    }
  }

  /********************************************************************************** */
  // Strip inline color/background styles from fetched journal HTML so the
  // Beneos news box style (.beneos-news-box in beneos.css) is not overridden
  // by editor-default colors like #191813. Structural HTML, classes, links,
  // images and other attributes are preserved.
  static _sanitizeNewsHtml(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const STRIP = ["color", "background", "background-color"];
    doc.body.querySelectorAll("[style]").forEach(el => {
      STRIP.forEach(prop => el.style.removeProperty(prop));
      if (!el.getAttribute("style")) el.removeAttribute("style");
    });
    return doc.body.innerHTML;
  }

  /********************************************************************************** */
  static async displayNewsDialog(newsData) {
    const sanitized = BeneosUtility._sanitizeNewsHtml(newsData.content);
    const { BeneosNewsWindow } = await import("./beneos_news_window.js");
    new BeneosNewsWindow({ newsData, sanitizedHtml: sanitized }).render({ force: true });
  }

  /********************************************************************************** */
  // Beneos assets are authored against dnd5e. The compatibility model has two
  // tiers on non-dnd5e systems:
  //
  //   - Soft-warn kinds (tokens / maps): content will likely render, but with
  //     visual or mechanical glitches. The GM is asked once per session
  //     whether to continue, with an opt-out for the rest of the session.
  //
  //   - Hard-block kinds (items / spells): in testing on Pathfinder these
  //     hang the install pipeline mid-write. We don't even attempt the
  //     install; we show an info-only dialog explaining that Loot and Spells
  //     are dnd5e-only and that Maps + Creatures remain compatible.
  //
  // The soft-warn bypass is a runtime field, so it resets on world reload —
  // matching the natural notion of a "play session". A persistent setting
  // was explicitly avoided so users can't accidentally silence warnings
  // about a system mismatch they later forget about.
  static _systemCompatBypass = false;
  static _SOFT_KINDS = new Set(["token", "actor", "map", "bmap"]);
  static _HARD_KINDS = new Set(["item", "spell"]);

  static _normalizeKind(kind) {
    if (!kind) return null;
    if (kind === "actor") return "token";
    if (kind === "bmap")  return "map";
    return kind;
  }

  /**
   * Cached system-id check. Read once on first access (typically during
   * the V2 cloud window's first render) and reused for every result-card
   * enrich pass. Avoids the per-card property dereference the user
   * explicitly flagged as unnecessary overhead.
   */
  static get isDnd5e() {
    return BeneosUtility._isDnd5eCache ??= (game.system?.id === "dnd5e");
  }

  /**
   * True when `kind` cannot be installed in the active world. Used by the
   * V2 cloud window to render Loot/Spell cards in a "Not compatible"
   * state on non-dnd5e systems instead of an Install button. Click on
   * such a card still routes through #onInstallClick → confirmSystemCompat
   * which surfaces the incompatible-asset info dialog.
   */
  static isHardBlockedKind(kind) {
    if (BeneosUtility.isDnd5e) return false;
    return BeneosUtility._HARD_KINDS.has(BeneosUtility._normalizeKind(kind));
  }

  /**
   * Returns true if the install pipeline may continue, false if the GM
   * cancelled or the kind is hard-blocked on this system.
   *
   * @param {?string} kind  "token" | "item" | "spell" | "map" | null
   *                        When null, only the soft-warn path is evaluated
   *                        (used by callers that don't know the asset kind).
   */
  static async confirmSystemCompat(kind = null) {
    if (game.system?.id === "dnd5e") return true;

    const k = BeneosUtility._normalizeKind(kind);

    // Hard-block path: items/spells on any non-dnd5e system. Info-only
    // dialog, no Yes/No, no opt-out — this kind isn't going to install.
    if (k && BeneosUtility._HARD_KINDS.has(k)) {
      await BeneosUtility._showIncompatibleDialog(k);
      return false;
    }

    // Soft-warn path: tokens / maps / unknown.
    if (BeneosUtility._systemCompatBypass) return true;

    const systemLabel = game.system?.title || game.system?.id || "this game system";
    const title = game.i18n.localize("BENEOS.SystemCheck.Title");
    const body = game.i18n.format("BENEOS.SystemCheck.Body", { system: systemLabel });
    const yesLabel = game.i18n.localize("BENEOS.SystemCheck.Yes");
    const noLabel = game.i18n.localize("BENEOS.SystemCheck.No");
    const dontShowLabel = game.i18n.localize("BENEOS.SystemCheck.DontShowSession");

    const content = `
      <section class="beneos-system-check">
        <p>${body}</p>
        <label class="beneos-dont-show">
          <input type="checkbox" name="beneos-system-dont-show-session"> ${dontShowLabel}
        </label>
      </section>`;

    const readCheckbox = (root) => {
      try { return !!root?.querySelector?.('input[name="beneos-system-dont-show-session"]')?.checked; }
      catch (e) { return false; }
    };

    let result = null;
    try {
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (DialogV2?.wait) {
        result = await DialogV2.wait({
          window: { title },
          classes: ["beneos-system-check-dialog"],
          position: { width: 520 },
          content,
          buttons: [
            { action: "yes", label: yesLabel, default: true,
              callback: (e, btn, dlg) => ({ answer: true, dontShow: readCheckbox(dlg?.element) }) },
            { action: "no", label: noLabel,
              callback: (e, btn, dlg) => ({ answer: false, dontShow: readCheckbox(dlg?.element) }) }
          ],
          rejectClose: false,
          modal: true,
          close: () => null
        });
      }
    } catch (e) {
      console.warn("[Beneos] System compat dialog failed, falling back to safe-default cancel:", e);
      return false;
    }

    if (!result || typeof result.answer !== "boolean") return false;
    if (result.dontShow && result.answer) BeneosUtility._systemCompatBypass = true;
    return result.answer;
  }

  /**
   * Info-only dialog shown when a hard-blocked asset kind (item/spell) is
   * about to be installed on a non-dnd5e system. No Yes/No — the install
   * is always cancelled.
   */
  static async _showIncompatibleDialog(kind) {
    const systemLabel = game.system?.title || game.system?.id || "this game system";
    const title = game.i18n.localize("BENEOS.SystemCheck.IncompatibleTitle");
    const bodyKey = kind === "spell"
      ? "BENEOS.SystemCheck.IncompatibleBodySpell"
      : "BENEOS.SystemCheck.IncompatibleBodyItem";
    const body = game.i18n.format(bodyKey, { system: systemLabel });
    const closeLabel = game.i18n.localize("BENEOS.SystemCheck.IncompatibleClose");

    const content = `
      <section class="beneos-system-check beneos-system-check-blocked">
        <p>${body}</p>
      </section>`;

    try {
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (DialogV2?.wait) {
        await DialogV2.wait({
          window: { title },
          classes: ["beneos-system-check-dialog", "beneos-system-check-blocked"],
          position: { width: 520 },
          content,
          buttons: [
            { action: "close", label: closeLabel, default: true, callback: () => null }
          ],
          rejectClose: false,
          modal: true,
          close: () => null
        });
      }
    } catch (e) {
      console.warn("[Beneos] Incompatible-asset dialog failed:", e);
    }
  }

  /********************************************************************************** */
  // Returns true if the actor is a Warlock per the dnd5e 5.x spellcasting model.
  // `actor.spellcastingClasses` is the canonical getter; we additionally check
  // for an itemTypes.class entry with identifier "warlock" as a fallback for
  // older characters where the getter may not have been populated yet.
  static isWarlockActor(actor) {
    if (!actor || game.system?.id !== "dnd5e") return false;
    if (actor.spellcastingClasses?.warlock) return true;
    try {
      const cls = actor.itemTypes?.class?.find?.(c =>
        (c.identifier || c.system?.identifier || c.name?.toLowerCase()) === "warlock"
      );
      if (cls) return true;
    } catch (e) {}
    return false;
  }

  /**
   * Per-batch cache for the Pact-Magic prompt. Keyed by `${actorId}:${batchToken}`.
   * Populated when the user ticks "Apply to all remaining spells in this drop"
   * during the first prompt of a batch; subsequent spells in the same batch
   * reuse the cached choice instead of prompting again.
   */
  static _pactMagicBatchCache = new Map();

  /**
   * Decide whether a leveled spell about to be added to a Warlock should be
   * marked as Pact-Magic. Returns "pact" or "normal". Caller is responsible
   * for the actual JSON mutation (so this helper stays pure).
   *
   * @param {object}  opts
   * @param {Item}    opts.spellItem    The world-item / compendium document being copied to the actor.
   * @param {Actor}   opts.actor        The Warlock actor receiving the spell.
   * @param {string}  opts.batchToken   Stable token shared across all spells dropped in the same event; "" for single drops.
   */
  static async askPactMagicChoice({ spellItem, actor, batchToken }) {
    const cacheKey = batchToken ? `${actor.id}:${batchToken}` : null;
    if (cacheKey && BeneosUtility._pactMagicBatchCache.has(cacheKey)) {
      return BeneosUtility._pactMagicBatchCache.get(cacheKey);
    }

    const spellName = spellItem?.name ?? game.i18n.localize("BENEOS.PactMagic.UnknownSpell");
    const actorName = actor?.name ?? "";
    const title = game.i18n.localize("BENEOS.PactMagic.Title");
    const body = game.i18n.format("BENEOS.PactMagic.Body", { spell: spellName, actor: actorName });
    const yesLabel = game.i18n.localize("BENEOS.PactMagic.Yes");
    const noLabel = game.i18n.localize("BENEOS.PactMagic.No");
    const applyAllLabel = game.i18n.localize("BENEOS.PactMagic.ApplyToAll");

    const showApplyAll = !!batchToken;
    const content = `
      <section class="beneos-pact-magic">
        <p>${body}</p>
        ${showApplyAll ? `
          <label class="beneos-dont-show">
            <input type="checkbox" name="beneos-pact-apply-all"> ${applyAllLabel}
          </label>` : ""}
      </section>`;

    const readApplyAll = (root) => {
      try { return !!root?.querySelector?.('input[name="beneos-pact-apply-all"]')?.checked; }
      catch (e) { return false; }
    };

    let result = null;
    try {
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (DialogV2?.wait) {
        result = await DialogV2.wait({
          window: { title },
          classes: ["beneos-pact-magic-dialog"],
          position: { width: 520 },
          content,
          buttons: [
            { action: "yes", label: yesLabel, default: true,
              callback: (e, btn, dlg) => ({ choice: "pact", applyAll: readApplyAll(dlg?.element) }) },
            { action: "no", label: noLabel,
              callback: (e, btn, dlg) => ({ choice: "normal", applyAll: readApplyAll(dlg?.element) }) }
          ],
          rejectClose: false,
          modal: true,
          // ESC / X = treat as "normal" (no slot mismatch, just imports as-is).
          // The user explicitly only asked for Yes/No; we don't add a third
          // cancel path that would silently abort spell import.
          close: () => ({ choice: "normal", applyAll: false })
        });
      }
    } catch (e) {
      console.warn("[Beneos] Pact-Magic dialog failed, defaulting to normal slot:", e);
      return "normal";
    }

    const choice = result?.choice === "pact" ? "pact" : "normal";
    if (cacheKey && result?.applyAll) {
      BeneosUtility._pactMagicBatchCache.set(cacheKey, choice);
    }
    return choice;
  }

  /** Drop the per-batch Pact cache after the batch has fully drained. */
  static clearPactMagicBatchCache(actorId, batchToken) {
    if (!actorId || !batchToken) return;
    BeneosUtility._pactMagicBatchCache.delete(`${actorId}:${batchToken}`);
  }

  /**
   * Mutate a spell item's data object to be cast via Pact Magic. dnd5e 5.x
   * uses `system.method`; older versions used `system.preparation.mode`. We
   * write both so Beneos installs work across the supported version range.
   */
  static applyPactMagicToSpellData(itemData) {
    if (!itemData || itemData.type !== "spell") return itemData;
    if (!itemData.system) itemData.system = {};
    itemData.system.method = "pact";
    if (!itemData.system.preparation) itemData.system.preparation = {};
    itemData.system.preparation.mode = "pact";
    return itemData;
  }

  /********************************************************************************** */
  static getItemSpellImageInfo(newImage) {
    // beneos_assets/beneos_spells/0027_gunpowder_cloud/0027_gunpowder_cloud-icon.webp
    let dataPath = {
      itemKey: newImage
    }
    let apath = newImage.split("/")
    let itemKey = apath[apath.length - 2]
    let filename = apath[apath.length - 1]
    if (itemKey) {
      dataPath = { img: newImage, filename, itemKey }
    }
    return dataPath
  }

  /********************************************************************************** */
  static isSwitchableBeneosBattlemap(sceneId, fileType) {
    let scene = game.scenes.get(sceneId)
    if (!scene) return undefined
    let srcPath = BeneosUtility.getSceneBackgroundSrc(scene)
    let tileId = "scene"


    if (!srcPath) {
      for (let tile of scene.tiles) {
        if (tile.texture?.src?.toLowerCase().match(/beneos_battlemaps/) &&
          (tile.texture?.src?.toLowerCase().match(/4k/) || tile.texture?.src?.toLowerCase().match(/hd/))) {
          srcPath = tile.texture.src
          tileId = tile.id
          break
        }
      }
    }

    if (srcPath && game.user.isGM && !(srcPath.toLowerCase().match(/intro/)) && srcPath.toLowerCase().match(/beneos_battlemaps/) &&
      (srcPath.toLowerCase().match(/4k/) || srcPath.toLowerCase().match(/hd/)) &&
      (srcPath.toLowerCase().includes(fileType))) {
      return tileId
    } else {
      return undefined
    }
  }

  /********************************************************************************** */
  static getBattlemapSrcPath(sceneId, tileId) {
    let scene = game.scenes.get(sceneId)
    let bg = BeneosUtility.getSceneBackgroundSrc(scene)
    if (tileId != "scene") {
      let tile = scene.tiles.get(tileId)
      bg = tile.texture.src
    }
    return bg
  }

  /********************************************************************************** */
  static switchPhase(sceneId, command) {
    let tileId = this.isSwitchableBeneosBattlemap(sceneId, command == "toStatic" ? "webm" : "webp")
    let scene = game.scenes.get(sceneId)

    if (scene) {
      let tile
      if (tileId != "scene") {
        tile = scene.tiles.get(tileId)
      }

      //BeneosUtility.debugMessage("Scene : ", scene)
      let srcPath = (tile) ? tile.texture.src : BeneosUtility.getSceneBackgroundSrc(scene)
      if (command == "toStatic") {
        srcPath = srcPath.replace("webm", "webp")
      } else {
        srcPath = srcPath.replace("webp", "webm")
      }
      BeneosUtility.debugMessage("New path : ", srcPath)
      if (tile) {
        scene.updateEmbeddedDocuments("Tile", [({ _id: tile.id, 'texture.src': srcPath })])
      } else {
        BeneosUtility.updateSceneBackgroundSrc(scene, srcPath)
      }
      //scene.background.src = srcPath
    }
  }

  /********************************************************************************** */
  static resetTokenData() {
    this.beneosTokens = {}
  }

  /********************************************************************************** */
  static upperFirst(text) {
    if (typeof text !== 'string') return text
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  /********************************************************************************** */
  static debugMessage(msg, data) {
    if (BeneosUtility.isDebug()) {
      console.log(msg, data)
    }
  }

  /********************************************************************************** */
  static moduleName() {
    return BENEOS_MODULE_NAME
  }

  /********************************************************************************** */
  static getBeneosTokenDataPath() {
    return this.tokenDataPath
  }
  static getBeneosSpellDataPath() {
    return this.spellDataPath
  }
  static getBeneosItemDataPath() {
    return this.itemDataPath
  }

  /********************************************************************************** */
  static moduleID() {
    return BENEOS_MODULE_ID
  }

  /********************************************************************************** */
  static isDebug() {
    return beneosDebug
  }
  /********************************************************************************** */
  static isBeneosModule() {
    return true
  }

  /********************************************************************************** */
  static getBasePath() {
    if (this.beneosBasePath == undefined || this.beneosBasePath == null || this.beneosBasePath == "") {
      return ""
    }
    return this.beneosBasePath + "/"
  }

  /********************************************************************************** */
  static getFullPathWithSlash() {
    return this.getBasePath() + this.getBeneosTokenDataPath()
  }
  /********************************************************************************** */
  static seed(i) {
    this.m_w = (123456789 + i) & __mask
    this.m_z = (987654321 - i) & __mask
  }

  /********************************************************************************** */
  //Random function better than the default rand.
  static random() {
    this.m_z = (36969 * (this.m_z & 65535) + (this.m_z >> 16)) & __mask
    this.m_w = (18000 * (this.m_w & 65535) + (this.m_w >> 16)) & __mask
    let result = ((this.m_z << 16) + (this.m_w & 65535)) >>> 0
    result /= 4294967296
    return result
  }

  /********************************************************************************** */
  static newTokenSetup(token) {
    let object = (token.document) ? token.document : token
    let tokenData = BeneosUtility.getTokenImageInfo(object.texture.src)
    object.setFlag(BeneosUtility.moduleID(), "fullKey", tokenData.fullKey)
    object.setFlag("core", "randomizeVideo", false)
    let scaleFactor = this.getScaleFactor(token, object.texture.src)
    canvas.scene.updateEmbeddedDocuments("Token", [({ _id: token.id, scale: scaleFactor })])
    setTimeout(function () {
      BeneosUtility.updateToken(token.id, { forceupdate: true })
    }, 500)
  }

  /********************************************************************************** */
  static createToken(token) {
    if (BeneosUtility.checkIsBeneosToken(token)) {
      BeneosUtility.preloadToken(token)
      setTimeout(function () {
        BeneosUtility.newTokenSetup(token)
      }, 500)
    }
  }

  /********************************************************************************** */
  //Foundry default get token give errors from time to time. It's better to get them directly from de canvas.
  static getToken(tokenid) {
    return canvas.tokens.placeables.find(t => t.id == tokenid)
  }

  /********************************************************************************** */
  // Stage 13a-Polish: explicit Beneos-creature check. Prefers the
  // new `isBeneosCreature: true` flag for unambiguous detection;
  // falls back to `tokenKey`-existence for backward-compatibility
  // with installs from before this polish (legacy Beneos tokens get
  // the flag backfilled on next cloud-update via the propagate-
  // pipeline).
  // Accepts either a Token, a TokenDocument, or an Actor and resolves
  // to the underlying Actor for the flag-read.
  static isBeneosCreature(actorOrToken) {
    if (!actorOrToken) return false
    const actor = actorOrToken.actor || actorOrToken
    const flag = actor?.getFlag?.("world", "beneos")
    if (!flag) return false
    return flag.isBeneosCreature === true || !!flag.tokenKey
  }

  /********************************************************************************** */
  // Backward-compatibility shim — keeps the 5+ existing call sites
  // (renderTokenHUD-Hook, updateToken-Hook, etc.) working without a
  // mass-rename. New code should prefer isBeneosCreature() directly.
  static checkIsBeneosToken(token) {
    return BeneosUtility.isBeneosCreature(token)
  }

  /********************************************************************************** */
  static removeTokenFromActorId(actorId) {
    let isRemoved = false
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token.actorId == actorId) {
        BeneosUtility.debugMessage("Removing token from actorId", token.actorId, fullKey)
        delete this.beneosTokens[fullKey]
        isRemoved = true
        break
      }
    }

    if (isRemoved) {
      BeneosUtility.debugMessage("Token removed for actorId", actorId)
      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', JSON.stringify(this.beneosTokens))
      // Wave B-8g-2: only the legacy V1 search engine needs the close+reopen
      // refresh on actor delete (Foundry fires deleteActor when the cloud
      // import replaces an existing compendium entry during update). V2
      // handles the same case via the softRefresh chain that runs at the
      // tail of importTokenToCompendium — closing it here would defeat the
      // whole in-place patch UX and leave the user with a closed window.
      if (!game.beneos?.cloudWindowV2) BeneosSearchEngineLauncher.closeAndSave()
    }
  }

  /********************************************************************************** */
  static removeItem(itemId) {
    let isRemoved = false
    for (let [fullKey, item] of Object.entries(this.beneosItems)) {
      if (item.itemId == itemId) {
        BeneosUtility.debugMessage("Removing item from itemId", item.itemId, fullKey)
        delete this.beneosItems[fullKey]
        isRemoved = true
        break
      }
    }

    if (isRemoved) {
      // Save the new data
      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', JSON.stringify(this.beneosItems))
      // Wave B-8g-2: same V2 guard as removeTokenFromActorId.
      if (!game.beneos?.cloudWindowV2) BeneosSearchEngineLauncher.closeAndSave()
    }
  }

  /********************************************************************************** */
  static removeSpell(spellId) {
    let isRemoved = false
    for (let [fullKey, spell] of Object.entries(this.beneosSpells)) {
      if (spell.spellId == spellId) {
        BeneosUtility.debugMessage("Removing spell from spellId", spell.spellId, fullKey)
        delete this.beneosSpells[fullKey]
        isRemoved = true
        break
      }
    }
    if (isRemoved) {
      // Save the new data
      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-spellconfig', JSON.stringify(this.beneosSpells))
      // Wave B-8g-2: same V2 guard as removeTokenFromActorId.
      if (!game.beneos?.cloudWindowV2) BeneosSearchEngineLauncher.closeAndSave()
    }
  }

  /********************************************************************************** */
  //Retrieves the necessary data from a token in order to be able to fire automatic animations based on the current token image file.
  static getTokenImageInfo(token) {

    let fullKey = token?.document?.getFlag(BeneosUtility.moduleID(), "fullKey")
    if (fullKey) {
      return BeneosUtility.beneosTokens[fullKey]
    }

    let beneos = token?.actor?.getFlag("world", "beneos");
    if (beneos) {
      let fullKey = beneos.fullId
      return BeneosUtility.beneosTokens[fullKey]
    }
    return {}
  }

  /********************************************************************************** */
  //Retrieves the necessary data from a token in order to be able to fire automatic animations based on the current token image file.
  static getTokenDataFromKey(fullKey) {
    if (fullKey) {
      return BeneosUtility.beneosTokens[fullKey]
    }
    return {}
  }

  /********************************************************************************** */
  //Function that preloads token animations. We need to do it to prevent the "scale not found" error in Foundry
  static preloadToken(token) {
    // Not sure to keep this as it was used to preload animations
    let myToken = this.getTokenImageInfo(token)

    if (!myToken) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Config not found preloadToken " + token.name)
      return
    }

  }

  /********************************************************************************** */
  static async applyDeadFX(token) {
    let bfx = ["BFXDead", "BFXDeadIcon"]
    this.addFx(token, bfx, true, true)

  }
  /********************************************************************************** */
  // Function to add FX from the Token Magic module or from the ones defined in the configuration files.
  static async addFx(token, bfx, replace = true, apply = true) {
    if (typeof TokenMagic !== 'undefined') {
      let bpresets = []

      $.each(bfx, function (index, value) {
        let bfxid = value
        let effect = TokenMagic.getPreset(bfxid)
        if (effect !== undefined) {
          BeneosUtility.debugMessage("[BENEOS MODULE] Setting Library FX: " + bfxid)
          $.each(effect, function (presetindex, pressetvalue) {
            bpresets.push(pressetvalue)
          })
        } else {
          if (beneosFX[bfxid] !== undefined) {
            BeneosUtility.debugMessage("[BENEOS MODULE] Setting Beneos FX: " + bfxid)
            $.each(beneosFX[bfxid], function (presetindex, pressetvalue) {
              $.each(pressetvalue, function (kid, kidvalue) {
                if (kid.indexOf("eval_") != -1) {
                  let newkid = kid.replace("eval_", "")
                  kidvalue = kidvalue.replace("random()", "BeneosUtility.random()")
                  kidvalue = kidvalue.replace("__BENEOS_DATA_PATH__", BeneosUtility.getBasePath() + BeneosUtility.getBeneosTokenDataPath())
                  pressetvalue[newkid] = eval(kidvalue)
                };
              });
              bpresets.push(pressetvalue)
            })
          }
        }
      })
      if (apply) {
        BeneosUtility.debugMessage("Adding effects", bpresets, replace)
        token.TMFXaddFilters(bpresets, replace)
      } else {
        return bpresets
      }
    }
  }

  /********************************************************************************** */
  static firstLetterUpper(mySentence) {
    const words = mySentence.split(" ");
    return words.map((word) => {
      return word[0].toUpperCase() + word.substring(1)
    }).join(" ")
  }

  /********************************************************************************** */
  static async prepareMenu(e, sheet) {
    if (!game.user.isGM) return; // GM-only: defense-in-depth
    if (e.button == 2) {
      let tokenList = BeneosUtility.buildAvailableTokensMenu()
      const beneosTokensDisplay = await BeneosUtility.buildAvailableTokensMenuHTML("beneos-actor-menu.html", tokenList)
      let menu = new BeneosModuleMenu(beneosTokensDisplay, tokenList, sheet.actor.token?.actor || sheet.actor, e.pageX, e.pageY, "beneos-actor-menu.html")
      menu.render(true)
    }
  }

  /********************************************************************************** */
  static getTokenInstallTS(key) {
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token.tokenKey == key) {
        return token.installDate
      }
    }
    return undefined
  }
  static getItemInstallTS(key) {
    let token = this.beneosItems[key]
    if (token) {
      return token.installDate
    }
    return undefined
  }
  static getSpellInstallTS(key) {
    let token = this.beneosSpells[key]
    if (token) {
      return token.installDate
    }
    return undefined
  }

  /********************************************************************************** */
  static getLocalAvatarPicture(key) {
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token.tokenKey == key) {
        return token.avatar
      }
    }
    return undefined
  }

  /********************************************************************************** */
  // Punkt 1 — installed-status validation. The cache is necessary but not
  // sufficient: a stale entry can survive after the user deletes the
  // compendium document manually. We treat the asset as "installed" only
  // when the cache claims it AND the referenced compendium id resolves in
  // the pack index. If the index isn't ready yet (early boot), fall back to
  // the cache so the search engine doesn't flicker every asset to
  // "installable" before packs finish loading.
  static #compendiumHasId(packName, id) {
    if (!id) return false
    const pack = game.packs?.get?.(packName)
    if (!pack) return true
    const index = pack.index
    if (!index || index.size === 0) return true
    return !!index.get?.(id) || !!index.has?.(id)
  }

  static isTokenLoaded(key) {
    if (!this.beneosTokens) return false
    if (!key) return false
    for (let [, token] of Object.entries(this.beneosTokens)) {
      if (token.tokenKey == key) {
        return BeneosUtility.#compendiumHasId("world.beneos_module_actors", token.actorId)
      }
    }
    return false
  }
  static isItemLoaded(key) {
    if (!key) return false
    let entry = this.beneosItems[key]
    if (!entry) {
      const lk = key.toLowerCase().replace("-", "_")
      entry = this.beneosItems[lk]
    }
    if (!entry) return false
    return BeneosUtility.#compendiumHasId("world.beneos_module_items", entry.itemId)
  }
  static isSpellLoaded(key) {
    if (!key) return false
    let entry = this.beneosSpells[key]
    if (!entry) {
      const lk = key.toLowerCase().replace("-", "_")
      entry = this.beneosSpells[lk]
    }
    if (!entry) return false
    return BeneosUtility.#compendiumHasId("world.beneos_module_spells", entry.spellId)
  }

  /********************************************************************************** */
  static getActorIdVariant(key, idx) {
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token.tokenKey.toLowerCase() == key.toLowerCase() && token.number == idx) {
        return token.actorId
      }
    }
    return undefined
  }
  static getActorId(key) {
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token.tokenKey.toLowerCase() == key.toLowerCase()) {
        return token.actorId
      }
    }
    return undefined
  }
  static getItemId(key) {
    let token = this.beneosItems[key.toLowerCase()]
    if (token) {
      return token.itemId
    }
    return undefined
  }
  static getSpellId(key) {
    let token = this.beneosSpells[key.toLowerCase()]
    if (token) {
      //BeneosUtility.debugMessage("Spell ?", token)
      return token.spellId
    }
    return undefined
  }

  /********************************************************************************** */
  // Stage 13a: per-token scale resolver. Reads
  // flags.world.beneos.rendering.{topDownScale,tokenizedScale}; falls
  // back to BENEOS_SCALE_* constants when the actor has no override
  // (or has null/missing/non-numeric values). The cloud-delivered
  // actorJSON can ship per-creature defaults via this flag, and end-
  // users (or the Stage-13d Creator-Mode UI) can override locally.
  // Source-of-truth-Hierarchie: User-Override > Cloud-Default >
  // Konstante.
  static getBeneosScale(actor, mode) {
    const isTopDown = (mode === "topdown")
    const fallback = isTopDown
      ? BeneosUtility.BENEOS_SCALE_TOPDOWN
      : BeneosUtility.BENEOS_SCALE_TOKENIZED
    if (!actor) return fallback
    const rendering = actor.getFlag?.("world", "beneos")?.rendering
    if (!rendering) return fallback
    const override = isTopDown ? rendering.topDownScale : rendering.tokenizedScale
    return (typeof override === "number" && override > 0) ? override : fallback
  }

  /********************************************************************************** */
  // Stage 13d-9: per-mode anchor (texture.anchorX/Y). Mirrors the
  // scale pattern: each mode persists its own anchor, mode-switch
  // applies the right value alongside the texture+scale swap. Foundry
  // default is (0.5, 0.5) — center anchor — and we use that as the
  // fallback when no override exists.
  static getBeneosAnchor(actor, mode) {
    const fallback = { x: 0.5, y: 0.5 }
    if (!actor) return fallback
    const rendering = actor.getFlag?.("world", "beneos")?.rendering
    if (!rendering) return fallback
    const isTopDown = (mode === "topdown")
    const ax = isTopDown ? rendering.topDownAnchorX : rendering.tokenizedAnchorX
    const ay = isTopDown ? rendering.topDownAnchorY : rendering.tokenizedAnchorY
    return {
      x: (typeof ax === "number") ? ax : fallback.x,
      y: (typeof ay === "number") ? ay : fallback.y
    }
  }

  /********************************************************************************** */
  // Stage 13d-9: console-helper to write the per-mode anchor flags.
  // Example:
  //   const a = game.actors.getName("MyDragon")
  //   await BeneosUtility.setBeneosCreatureAnchor(a, "topdown", 0.5, 0.5)
  //   await BeneosUtility.setBeneosCreatureAnchor(a, "tokenized", 0.5, 0.7)
  static async setBeneosCreatureAnchor(actor, mode, x, y) {
    if (!actor) {
      ui.notifications?.error("Beneos: setBeneosCreatureAnchor needs an actor")
      return
    }
    if (typeof x !== "number" || typeof y !== "number"
        || !isFinite(x) || !isFinite(y)) {
      ui.notifications?.error(`Beneos: anchor must be numeric (got x=${x} y=${y})`)
      return
    }
    const beneosFlag = actor.getFlag("world", "beneos") || {}
    const rendering = beneosFlag.rendering || {}
    if (mode === "topdown") {
      rendering.topDownAnchorX = x
      rendering.topDownAnchorY = y
    } else {
      rendering.tokenizedAnchorX = x
      rendering.tokenizedAnchorY = y
    }
    await actor.setFlag("world", "beneos", { ...beneosFlag, rendering })
  }

  /********************************************************************************** */
  // Stage 13a: Console-Helper for designers / QA. Writes the per-token
  // scale flag without forcing the user to compose nested-spread
  // setFlag-calls by hand. Example:
  //   const a = game.actors.getName("MyTestCreature")
  //   await BeneosUtility.setBeneosCreatureScale(a, "topdown", 1.6)
  // Idempotent: re-calling with the same value is a no-op write but
  // doesn't fail. Mode "topdown" → topDownScale; anything else →
  // tokenizedScale. Defensive validation surfaces a user-readable
  // notification on invalid input.
  static async setBeneosCreatureScale(actor, mode, value) {
    if (!actor) {
      ui.notifications?.warn("Beneos: setBeneosCreatureScale needs an actor")
      return
    }
    if (typeof value !== "number" || !(value > 0)) {
      ui.notifications?.warn("Beneos: scale value must be a positive number")
      return
    }
    const existing = actor.getFlag("world", "beneos") || {}
    const rendering = { ...(existing.rendering || {}) }
    if (mode === "topdown") rendering.topDownScale = value
    else rendering.tokenizedScale = value
    await actor.setFlag("world", "beneos", { ...existing, rendering })
    ui.notifications?.info(`Beneos: ${mode === "topdown" ? "Top-Down" : "2.5D"} scale set to ${value} for ${actor.name}`)
  }

  /********************************************************************************** */
  // Stage 6: mode-aware scale. 2.5D tokens use the prototype's
  // baked-in 1.1 (matches the Beneos JSON); Top-Down tokens need 1.25
  // for proper coverage. When `mode` isn't passed, derive it from the
  // current texture src so callers that already swap the texture
  // before calling don't need to pass it explicitly.
  // Stage 13a: delegates to getBeneosScale once mode is resolved, so
  // per-token Flag-Overrides take precedence over the constants.
  static getScaleFactor(token, newImage = undefined, mode) {
    if (mode === undefined) {
      // Prefer newImage (caller's intent for the swap) over the
      // current document texture, since the swap may not yet be
      // committed when this is called.
      let probeSrc = ""
      if (typeof newImage === "string") probeSrc = newImage
      else probeSrc = token?.document?.texture?.src || ""
      mode = probeSrc.includes("-top.webp") ? "topdown" : "tokenized"
    }
    return BeneosUtility.getBeneosScale(token?.actor ?? null, mode)
  }

  /********************************************************************************** */
  static changeVariant(fullId) {
    let tokenData = BeneosUtility.getTokenDataFromKey(fullId)
    if (!tokenData) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Config not found changeVariant " + fullId)
      return
    }
    let token = canvas.tokens.placeables.find(t => t.id == tokenData.currentTokenId)
    if (!token) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Token not found changeVariant " + fullId)
      return
    }
    this.forceChangeToken(token.id, fullId)
  }

  /********************************************************************************** */
  static async forceChangeToken(tokenid, fullKey) {
    let token = BeneosUtility.getToken(tokenid)
    if (token === null || token == undefined) {
      return
    }
    let tokenData = BeneosUtility.getTokenDataFromKey(fullKey)
    if (!tokenData) return
    // Stage 5/6: mode-preserving variant switch. If the placed token
    // is currently in top-down mode (texture.src ends in -top.webp),
    // jump to the requested variant's top-down image. Stage 6 adds a
    // derived-path fallback for legacy installs whose cache has no
    // explicit topDown entry — same string-replace pattern used
    // elsewhere in the codebase.
    const currentSrc = token.document?.texture?.src || ""
    const isTopDownMode = currentSrc.includes("-top.webp")
    const newImage = isTopDownMode
      ? (BeneosUtility.beneosDerivedTopPath(tokenData) || tokenData.token)
      : tokenData.token
    await token.document.setFlag(BeneosUtility.moduleID(), "fullKey", tokenData.fullId)
    // Stage 6: probe-based scale. Pass `newImage` (the actual webp
    // path we're swapping TO) so getScaleFactor can detect mode from
    // the suffix and pick 1.1 vs 1.25 correctly.
    let scaleFactor = this.getScaleFactor(token, newImage)
    // Stage 13d-9: per-mode anchor — same swap-with-mode pattern as
    // scale. Mode is decided by the destination image's suffix
    // (-top.webp = topdown, otherwise tokenized).
    const newMode = newImage.includes("-top.webp") ? "topdown" : "tokenized"
    const newAnchor = BeneosUtility.getBeneosAnchor(token.actor, newMode)
    //BeneosUtility.debugMessage(">>>>>>>>>>> UPDATE TOKEN CHANGE", fullKey, tokenData, newImage)
    await token.document.update({ img: newImage, scale: scaleFactor, rotation: 1.0 })
    if (foundry.utils.isNewerVersion(game.version, "11")) {
      // Stage 7: V13-conformant scale path. texture.scaleX/Y is the
      // canonical schema field; setting it here keeps the token's
      // scale in sync with the new mode (1.25 for top-down, 1.1 for
      // 2.5D) when variant-switching in the change-skin HUD.
      await token.document.update({
        "texture.src": newImage,
        "texture.scaleX": scaleFactor,
        "texture.scaleY": scaleFactor,
        "texture.anchorX": newAnchor.x,
        "texture.anchorY": newAnchor.y
      })
    }
    //canvas.scene.updateEmbeddedDocuments("Token", [({ _id: token.id, img: finalimage, scale: 1.0, rotation: 0 })])
    let actor = token.actor
    if (actor && actor.type == "character") {
      let actorImage = tokenData.avatar
      actor.update({ 'token.img': actorImage })
    }
    return
  }

  /********************************************************************************** */
  // Top-Down Stage 6: per-mode scale constants. 2.5D tokens use the
  // baked-in JSON prototype scale of 1.1; Top-Down tokens need 1.25
  // for proper canvas-cell coverage. Used by every style-swap site
  // (forceChangeToken, toggleTokenStyle, preCreateToken hook,
  // importTokenToCompendium install-fork) so the scale moves with
  // the texture.
  static BENEOS_SCALE_TOKENIZED = 1.1
  static BENEOS_SCALE_TOPDOWN = 1.25

  /********************************************************************************** */
  // Top-Down Stage 6: derive the top-down companion path of a 2.5D
  // token asset by string replacement. Works even when the cache
  // doesn't have an explicit `topDown` entry (legacy installs
  // predating Stage 1, or local file drops without cloud pipeline).
  // Returns null if no derivation is possible.
  static beneosDerivedTopPath(value) {
    if (!value) return null
    if (value.topDown) return value.topDown
    if (value.token && value.token.includes("-token.webp")) {
      return value.token.replace("-token.webp", "-top.webp")
    }
    return null
  }

  /********************************************************************************** */
  // Top-Down Stage 3: filesystem-truth check. The Stage-1 cache
  // (BeneosUtility.beneosTokens[fullId].topDown) only reflects what
  // the cloud delivered at install time — manual file drops, legacy
  // installs, or backend-not-yet-patched scenarios all produce false
  // negatives. The actual disk presence is the only reliable signal,
  // so the HUD button and the toggle method both probe the file
  // server with a HEAD request.
  static async beneosTopVariantExists(prototypeSrc) {
    if (!prototypeSrc) return false
    let candidate = null
    if (prototypeSrc.includes("-token.webp")) {
      candidate = prototypeSrc.replace("-token.webp", "-top.webp")
    } else if (prototypeSrc.includes("-top.webp")) {
      candidate = prototypeSrc.replace("-top.webp", "-token.webp")
    } else {
      return false
    }
    try {
      const url = candidate.startsWith("/") ? candidate : `/${candidate}`
      const res = await fetch(url, { method: "HEAD" })
      return res.ok
    } catch (e) { return false }
  }

  /********************************************************************************** */
  // Top-Down Stage 2: flip an installed token's prototypeToken-texture
  // between -token.webp (2.5D) and -top.webp (Top-Down). Per Stage-2
  // contract: prototype only, scene placements stay frozen.
  // Stage 3: cache-check dropped — HUD-button gating already filters
  // unavailable styles; this method keeps a defensive last-mile FS
  // check for the race-condition where the file vanishes between
  // HUD render and click.
  static async toggleTokenStyle(tokenid) {
    const token = BeneosUtility.getToken(tokenid)
    if (!token) return
    const actor = token.actor
    if (!actor) return
    // Stage 8: source-of-truth is the placed token's own texture.src.
    // Stage 7's actor.prototypeToken.texture.src was the synthetic
    // delta-actor property for unlinked tokens, which could go stale
    // after a partially-failed actor.update — leading to a no-op
    // toggle and the user-reported "second click does nothing".
    const currentSrc = token.document?.texture?.src || ""
    let newSrc = null
    let newStyle = null
    if (currentSrc.includes("-token.webp")) {
      newSrc = currentSrc.replace("-token.webp", "-top.webp")
      newStyle = "topdown"
    } else if (currentSrc.includes("-top.webp")) {
      newSrc = currentSrc.replace("-top.webp", "-token.webp")
      newStyle = "tokenized"
    }
    if (!newSrc) {
      ui.notifications?.warn(game.i18n.localize("BENEOS.TokenMenu.StyleNotApplicable")
        || "Beneos: token has no recognizable variant suffix")
      return
    }

    // Stage 8: HUD-button gating in beneos_module.js (renderTokenHUD)
    // already checks file existence before rendering the toggle button.
    // The Stage-3 last-mile FS-check here was a redundant guard that
    // could fail on cached HEAD responses, silently aborting the swap.
    // Removed.

    // Stage 4/6/7: visible swap on canvas — placed token first, then
    // propagate to the actor's prototype for re-placement consistency.
    // Stage 8: isolate the two updates so a prototype-update failure
    // (e.g., delta-actor on an unlinked token) doesn't abort the
    // user-visible canvas swap.
    // Stage 13a: scale resolves via the per-token flag-aware helper;
    // creatures with custom rendering.{topDown,tokenized}Scale flags
    // get those values, others fall back to the BENEOS_SCALE_*
    // constants.
    const newScale = BeneosUtility.getBeneosScale(actor, newStyle)
    const newAnchor = BeneosUtility.getBeneosAnchor(actor, newStyle)

    try {
      await token.document.update({
        "texture.src": newSrc,
        "texture.scaleX": newScale,
        "texture.scaleY": newScale,
        "texture.anchorX": newAnchor.x,
        "texture.anchorY": newAnchor.y
      })
    } catch (err) {
      console.warn("[Beneos] toggleTokenStyle: token.document.update failed", err)
      ui.notifications?.error(`Beneos: token swap failed (${err?.message || "unknown"})`)
      return
    }

    try {
      await actor.update({
        "prototypeToken.texture.src": newSrc,
        "prototypeToken.texture.scaleX": newScale,
        "prototypeToken.texture.scaleY": newScale,
        "prototypeToken.texture.anchorX": newAnchor.x,
        "prototypeToken.texture.anchorY": newAnchor.y
      })
    } catch (err) {
      console.warn("[Beneos] toggleTokenStyle: actor.update failed (prototype out of sync)", err)
    }

    const msgKey = newStyle === "topdown"
      ? "BENEOS.TokenMenu.StyleSwitchedTopDown"
      : "BENEOS.TokenMenu.StyleSwitchedTokenized"
    ui.notifications?.info(game.i18n.localize(msgKey)
      || `Beneos: switched to ${newStyle === "topdown" ? "Top-Down" : "2.5D"}`)

    // Stage 8: refresh the Token-HUD so the style-toggle button's icon
    // (down-arrow ↔ circle) immediately reflects the new direction
    // without forcing the user to close+reopen the HUD.
    try {
      if (canvas?.hud?.token?.rendered) {
        canvas.hud.token.render(true)
      }
    } catch (err) {
      console.warn("[Beneos] HUD re-render failed", err)
    }
  }

  /********************************************************************************** */
  // Main function that allows to control the automatic animations and decide which animations has to be shown.
  static updateToken(tokenid, BeneosExtraData) {

    let token = BeneosUtility.getToken(tokenid)
    if (!token || !BeneosUtility.checkIsBeneosToken(token) || !token.document.texture.src) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Not Beneos/No image")
      return
    }

    let actorData = token.actor
    if (!actorData || actorData.flags.world.beneos == undefined) {
      return
    }
    let fullKey = actorData.flags.world.beneos.fullId
    let myToken = BeneosUtility.getTokenDataFromKey(fullKey)
    if (!myToken) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Config not found " + fullKey)
      return
    }

    let attributes = actorData.system.attributes
    if (!attributes) {
      BeneosUtility.debugMessage("[BENEOS MODULE] No attributes", actorData)
      return
    }
    BeneosUtility.debugMessage("Token HP value", fullKey, myToken)
    let hp = attributes.hp.value
    let benRotation = 0
    let benAlpha = 1
    if (!game.dnd5e || hp == undefined) {
      BeneosUtility.debugMessage("[BENEOS MODULE] No hp")
      return
    }

    // Check if the beneos-death-management settings is set to true
    let deathManagement = game.settings.get(BeneosUtility.moduleID(), 'beneos-death-management')
    if (!deathManagement) {
      BeneosUtility.beneosHealth[token.id] = hp // Store current HP value anyway
      return
    }

    if (hp == 0 && hp != BeneosUtility.beneosHealth[token.id]) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Dead")
      token.state = "dead"
      // TODO : apply grey FX ?
      BeneosUtility.applyDeadFX(token)
    }
    if (BeneosUtility.beneosHealth[token.id] == 0 && hp > 0) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Standing")
      token.state = "standing"
      TokenMagic.deleteFilters(token);
    }
    BeneosUtility.beneosHealth[token.id] = hp // Store current HP value
  }

  /********************************************************************************** */
  // Function to force update the renewal of beneos tokens in a scene.
  static updateSceneTokens() {
    for (let i in canvas.tokens.placeables) {
      let token = canvas.tokens.placeables[i];
      if (token !== undefined && ("id" in token)) {
        this.preloadToken(token)
        BeneosUtility.debugMessage("[BENEOS MODULE] Force updating " + token.id)
        /*this.updateToken(token.id, "standing", { forceupdate: true })*/
      }
    }
  }

  /********************************************************************************** */
  static checkLockViewPresence() {
    let lv = game.modules.get("LockView")
    if (lv?.active) {
      ui.notifications.warn(game.i18n.localize("BENEOS.Notifications.Utility.LockViewIncompatible"))
      return true
    }
  }

  /********************************************************************************** */
  static processCanvasReady() {
    for (let [key, token] of canvas.scene.tokens.entries()) {
      if (BeneosUtility.checkIsBeneosToken(token)) {
        let tokenData = BeneosUtility.getTokenImageInfo(token.texture.src)
        let tokenConfig = this.beneosTokens[tokenData.fullKey]
        if (typeof tokenConfig === 'object' && tokenConfig) {
          BeneosUtility.updateToken(token.id, {})
        }
      }
    }
  }

  /* -------------------------------------------- */
  static sortArrayObjectsByName(myArray) {
    myArray.sort((a, b) => {
      let fa = a.actorName?.toLowerCase() || "";
      let fb = b.actorName?.toLowerCase() || "";
      if (fa < fb) {
        return -1;
      }
      if (fa > fb) {
        return 1;
      }
      return 0;
    })
  }

  /* -------------------------------------------- */
  static hasVariants(tokenConfig) {
    let tokenKey = tokenConfig?.tokenKey
    if (!tokenKey) {
      BeneosUtility.debugMessage("[BENEOS MODULE] No tokenKey found in tokenConfig", tokenConfig)
      return false
    }
    let variants = false
    Object.entries(BeneosUtility.beneosTokens).forEach(([key, value]) => {
      if (value.tokenKey == tokenKey && value.fullId != tokenConfig.fullId) {
        variants = true
      }
    })
    return variants
  }

  /********************************************************************************** */
  // Stage 5: mode-aware variant list. When the placed token is in
  // top-down mode, the HUD lists OTHER variants as their top-down
  // images. Falls back to .token (2.5D) if the cache entry doesn't
  // have a topDown path (legacy installs predating Stage 1).
  static getVariants(tokenConfig, mode = "tokenized") {
    let tokenKey = tokenConfig?.tokenKey
    if (!tokenKey) {
      BeneosUtility.debugMessage("[BENEOS MODULE] No tokenKey found in tokenConfig", tokenConfig)
      return []
    }
    let variants = []
    Object.entries(BeneosUtility.beneosTokens).forEach(([key, value]) => {
      if (value.tokenKey == tokenKey && value.fullId != tokenConfig.fullId) {
        let number = value.number || ""
        // Stage 6: derived-path fallback covers legacy installs whose
        // cache lacks an explicit topDown entry. The browser will load
        // the derived URL if the file exists; if not, the HUD shows a
        // broken thumbnail (acceptable defensive — no crash).
        const img = (mode === "topdown")
          ? (BeneosUtility.beneosDerivedTopPath(value) || value.token)
          : value.token
        variants.push({ "display_name": value.actorName + " " + number, "img": img, "name": key, fullId: value.fullId })
      }
    })
    return variants
  }

  /********************************************************************************** */
  static buildAvailableTokensMenu() {
    let beneosTokensHUD = []

    Object.entries(BeneosUtility.beneosTokens).forEach(([key, value]) => {
      if (value?.actorName && value?.actorId) {
        beneosTokensHUD.push({
          "fullKey": key, //BeneosUtility.getBasePath() + BeneosUtility.getBeneosTokenDataPath() + "/" + key + '/' + key + "-idle_face_still.webp",
          "img": value.avatar,
          "actorId": value.actorId,
          "actorName": value.actorName
        })
      } else {
        ui.notifications.warn(game.i18n.format("BENEOS.Notifications.Utility.ActorNotFound", { key }))
      }
    })
    this.sortArrayObjectsByName(beneosTokensHUD)
    //BeneosUtility.debugMessage("Beneos Tokens HUD", beneosTokensHUD)
    return beneosTokensHUD
  }

  /********************************************************************************** */
  static async buildAvailableTokensMenuHTML(template, beneosTokensHUD) {
    const beneosTokensDisplay = await renderTemplate('modules/beneos-module/templates/' + template,
      { beneosTokensHUD })

    return beneosTokensDisplay
  }

  /********************************************************************************** */
  static manageAvailableTokensMenu(token, html, event) {
    let beneosClickedButton = event.target.parentElement
    let beneosTokenButton = html.find('.beneos-token-hud-action')[0]

    if (beneosClickedButton === beneosTokenButton) {
      beneosTokenButton.classList.add('active')
      html.find('.beneos-selector-wrap')[0].classList.add('beneos-active')
      html.find('.beneos-selector-wrap')[0].classList.remove('beneos-disabled')
    } else {
      beneosTokenButton.classList.remove('active')
      html.find('.beneos-selector-wrap')[0].classList.remove('beneos-active')
      html.find('.beneos-selector-wrap')[0].classList.add('beneos-disabled')
      if (beneosClickedButton.classList.contains("beneos-button-token")) {
        event.preventDefault()
        let fullKey = beneosClickedButton.dataset.fullkey
        setTimeout(function () {
          BeneosUtility.forceChangeToken(token.id, fullKey)
        }, 200)
      }
    }
  }

  /********************************************************************************** */
  static async saveJSONConfig(fullKey) {
    let tokenConfig = this.beneosTokens[fullKey]
    if (tokenConfig) {
      let jsonData = {}
      jsonData[fullKey] = {
        config: structuredClone(tokenConfig.config),
        top: structuredClone(tokenConfig.top)
      }
      let json = JSON.stringify(jsonData)
      saveDataToFile(json, "text/json", tokenConfig.JSONFilePath)
    }
  }

  /********************************************************************************** */
  // Build a Foundry V12+ compendium UUID. The legacy V11 form
  // "Compendium.<pack>.<id>" no longer resolves; Foundry now requires the
  // document-type segment between pack and id.
  static buildCompendiumUuid(packName, docType, id) {
    if (!packName || !docType || !id) return null
    return `Compendium.${packName}.${docType}.${id}`
  }

  // Compendium pack-name + doc-type for a Beneos search-engine docType.
  // Spells live in the items collection (5e treats spells as Items), so the
  // compendium document type is "Item" — only the pack differs.
  static getBeneosCompendiumTarget(docType) {
    if (docType === "Actor") return { pack: "world.beneos_module_actors", compendiumDocType: "Actor", worldCollection: "actors" }
    if (docType === "Item")  return { pack: "world.beneos_module_items",  compendiumDocType: "Item",  worldCollection: "items"  }
    if (docType === "Spell") return { pack: "world.beneos_module_spells", compendiumDocType: "Item",  worldCollection: "items"  }
    return null
  }

  // Resolve an installed Beneos asset to a drag-data payload that Foundry V13
  // can consume. Lookup chain:
  //   1) World-doc with matching flag (world.beneos.tokenKey / itemKey /
  //      spellKey) — preferred so Foundry doesn't clone a duplicate world
  //      copy on drop (Wave B-1d local-drag).
  //   2) Compendium index entry by the cached compendium id, emitted as a
  //      proper V12+ compendium UUID. Used when the world copy was deleted
  //      or never created (install-all mode skips world imports beyond the
  //      first variant).
  // Returns { type, uuid, pack? } or null for orphan assets (cache says
  // installed but neither world doc nor compendium entry exists).
  static resolveBeneosDragData(docType, key) {
    const target = BeneosUtility.getBeneosCompendiumTarget(docType)
    if (!target) return null

    const flagField = docType === "Actor" ? "tokenKey"
                    : docType === "Item"  ? "itemKey"
                    : docType === "Spell" ? "spellKey"
                    : null
    const collection = game[target.worldCollection]
    if (collection && flagField) {
      const worldDoc = collection.find?.(d => {
        const flag = d.getFlag?.("world", "beneos")
        return flag?.[flagField] === key
      })
      if (worldDoc) {
        return { type: target.compendiumDocType, uuid: worldDoc.uuid }
      }
    }

    const cachedId = docType === "Actor" ? BeneosUtility.getActorId?.(key)
                   : docType === "Item"  ? BeneosUtility.getItemId?.(key)
                   : docType === "Spell" ? BeneosUtility.getSpellId?.(key)
                   : null
    if (cachedId) {
      const pack = game.packs.get(target.pack)
      if (pack && pack.index?.has?.(cachedId)) {
        const uuid = BeneosUtility.buildCompendiumUuid(target.pack, target.compendiumDocType, cachedId)
        return { type: target.compendiumDocType, pack: target.pack, uuid }
      }
    }

    return null
  }

  /********************************************************************************** */
  // Source-bucket detection for the folder-restructure layout. Mirrors
  // BeneosCloudWindowV2.#getNormalizedSource so import paths can sort
  // installed assets into "SRD" vs "Beneos Originals" without coupling to
  // the V2 window. Buckets returned: "SRD" | "Patreon" | "Webshop" | "Loyalty".
  static SRD_KEY_RE = /(?:^|[-_])srd[-_]/i
  static getSourceBucket(data, assetType, key) {
    const k = typeof key === "string" ? key : ""
    const isKeySrd     = BeneosUtility.SRD_KEY_RE.test(k)
    const isKeyWebshop = !isKeySrd && k.startsWith("0000_")

    if (assetType === "token") {
      const explicit = data?.properties?.source
      if (explicit) return explicit
      if (isKeySrd) return "SRD"
      if (isKeyWebshop) return "Webshop"
      return "Patreon"
    }
    if (assetType === "item") {
      const origin = String(data?.properties?.origin || "").toLowerCase()
      if (origin === "srd" || isKeySrd) return "SRD"
      if (isKeyWebshop) return "Webshop"
      return "Patreon"
    }
    if (assetType === "spell") {
      if (isKeySrd) return "SRD"
      if (isKeyWebshop) return "Webshop"
      return "Patreon"
    }
    return "Patreon"
  }

  // Collapse the four raw buckets to the two folder buckets the user
  // wants surfaced: only SRD stays separate; everything else (Patreon,
  // Webshop, Loyalty) goes under "Beneos Originals".
  static getFolderBucket(rawBucket) {
    return rawBucket === "SRD" ? "SRD" : "Beneos Originals"
  }

  // CR -> folder-friendly label. Fractional CRs get "CR 1/8|1/4|1/2";
  // integers get "CR <n>". Missing/invalid input -> "CR ?".
  static formatCrFolder(cr) {
    if (cr === undefined || cr === null || cr === "") return "CR ?"
    const n = Number(cr)
    if (!Number.isFinite(n)) return "CR ?"
    if (n === 0) return "CR 0"
    if (Math.abs(n - 0.125) < 1e-6) return "CR 1/8"
    if (Math.abs(n - 0.25)  < 1e-6) return "CR 1/4"
    if (Math.abs(n - 0.5)   < 1e-6) return "CR 1/2"
    if (Number.isInteger(n)) return `CR ${n}`
    return `CR ${n}`
  }

  // Walk a folder-segment array (root first) and create missing folders,
  // returning the leaf Folder. Two scopes:
  //   layer = { type: "Actor"|"Item", scope: "world" }
  //   layer = { type: "Actor"|"Item", scope: "compendium", pack: "<pack-name>" }
  // Compendium folders use V11+ in-pack folders (Folder with `pack` option).
  static async ensureBeneosFolderPath(layer, segments) {
    if (!Array.isArray(segments) || segments.length === 0) return null
    const cleanSegments = segments
      .filter(s => s && typeof s === "string")
      .map(s => s.trim())
      .filter(Boolean)
    if (!cleanSegments.length) return null

    if (layer.scope === "world") {
      let parent = null
      for (const name of cleanSegments) {
        const existing = game.folders.find(f =>
          f.name === name &&
          f.type === layer.type &&
          (f.folder?.id ?? null) === (parent?.id ?? null)
        )
        if (existing) { parent = existing; continue }
        parent = await Folder.create({
          name,
          type: layer.type,
          folder: parent?.id ?? null
        })
      }
      return parent
    }

    if (layer.scope === "compendium") {
      const pack = game.packs.get(layer.pack)
      if (!pack) return null
      let parent = null
      for (const name of cleanSegments) {
        const existing = pack.folders.find(f =>
          f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null)
        )
        if (existing) { parent = existing; continue }
        parent = await Folder.create({
          name,
          type: layer.type,
          folder: parent?.id ?? null
        }, { pack: layer.pack })
      }
      return parent
    }

    return null
  }
}
