import { BeneosUtility } from "./beneos_utility.js"
import { BeneosCloudLogin } from "./beneos_cloud.js"

/********************************************************************************** */
//const tokenDBURL = "https://www.beneos-database.com/data/tokens/beneos_tokens_database.json"
const tokenDBURL = "https://www.beneos-database.com/data/tokens/beneos_tokens_database_v2.json"
const battlemapDBURL = "https://www.beneos-database.com/data/battlemaps/beneos_battlemaps_database.json"
const itemDBURL = "https://www.beneos-database.com/data/items/beneos_items_database.json"
const spellDBURL = "https://www.beneos-database.com/data/spells/beneos_spells_database.json"
const commonDBURL = "https://www.beneos-database.com/data/common/beneos_common_database.json"
const i18nMatrixURL = "https://www.beneos-database.com/data/common/beneos_i18n.json"

/********************************************************************************** */
export class BeneosModuleMenu extends Dialog {

  /********************************************************************************** */
  constructor(html, tokenList, actor, x, y, template) {

    let myButtons = {
    }

    // Common conf
    let dialogConf = { content: html, title: "Beneos Tokens List", buttons: myButtons };
    let dialogOptions = { classes: ["beneos-actor-menu", "draggable"], left: x + 60, top: y + 20, width: 382, height: 520, 'z-index': 99999 }
    super(dialogConf, dialogOptions)

    this.actor = actor
    this.tokenList = tokenList
    this.listTemplate = template
  }
  /********************************************************************************** */
  async displayResults(beneosTokensHUD, searchValue = "") {
    if (beneosTokensHUD.length == 0) {
      beneosTokensHUD.push({ name: "No results" })
    }

    BeneosUtility.debugMessage("SEARCH results", beneosTokensHUD)
    let html = await renderTemplate('modules/beneos-module/templates/' + this.listTemplate,
      { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getFullPathWithSlash(), beneosTokensHUD, searchValue })
    this.data.content = html
    this.render(true)
  }

  /********************************************************************************** */
  textSearch(searchValue) {
    let newList = this.tokenList.filter(t => t.name.toLowerCase().includes(searchValue.toLowerCase()))
    return newList
  }

  /********************************************************************************** */
  processTextSearch(event) {
    BeneosUtility.debugMessage("Processing text search", event.currentTarget.value)
    let code = event.keyCode ? event.keyCode : event.which
    if (code == 13) {  // Enter keycode
      return
    }
    if (event.currentTarget.value && event.currentTarget.value.length >= 3) {
      let results = this.textSearch(event.currentTarget.value)
      this.displayResults(results, event.currentTarget.value)
    } else {
      this.displayResults(this.tokenList, event.currentTarget.value)
    }
  }

  /********************************************************************************** */
  activateListeners() {

    let myObject = this
    $(".beneos-actor-menu .beneos-search-token-text").keyup(event => {
      let code = event.keyCode ? event.keyCode : event.which
      if (code == 13) {  // Enter keycode
        event.preventDefault()
        return
      }
      clearTimeout(myObject.timeout)
      myObject.timeout = setTimeout(function () {
        myObject.processTextSearch(event)
      }, 600)
    })

    $(".beneos-actor-menu .beneos-button-select").click(async event => {
      let fullKey = $(event.currentTarget).data("full-key")
      let tokenData = BeneosUtility.getTokenDataFromKey(fullKey)

      let myActor = this.actor
      await myActor.update({ 'img': tokenData.avatar })
      if (myActor.token) {
        await myActor.token.update({ texture: { src: tokenData.token } })
        await myActor.prototypeToken.update({ texture: { src: tokenData.token } })
      } else {
        await myActor.prototypeToken.update({ texture: { src: tokenData.token } })
      }
    })
  }
}

/********************************************************************************** */
export class BeneosDatabaseHolder {

  /********************************************************************************** */
  static async loadDatabaseFiles() {
    let localStorage = BeneosUtility.getLocalStorage()
    this.isOffline = false

    try {
      let tokenData = await foundry.utils.fetchJsonWithTimeout(tokenDBURL, { cache: "no-cache", method: 'GET', 'Content-Type': 'application/json' })
      this.tokenData = tokenData
      localStorage.tokenData = structuredClone(tokenData)
    } catch (err) {
      if (localStorage.tokenData) {
        this.tokenData = structuredClone(localStorage.tokenData)
        this.isOffline = true
        ui.notifications.info(game.i18n.localize("BENEOS.Notifications.Search.TokenDbLocal"))
      } else {
        ui.notifications.error(game.i18n.format("BENEOS.Notifications.Search.TokenDbError", { message: err.message, url: tokenDBURL }))
      }
    }
    try {
      let bmapData = await foundry.utils.fetchJsonWithTimeout(battlemapDBURL, { cache: "no-cache", method: 'GET', 'Content-Type': 'application/json' })
      this.bmapData = bmapData
      localStorage.bmapData = structuredClone(bmapData)
    } catch {
      if (localStorage.bmapData) {
        this.bmapData = structuredClone(localStorage.bmapData)
        this.isOffline = true
        ui.notifications.info(game.i18n.localize("BENEOS.Notifications.Search.BattlemapDbLocal"))
      } else {
        ui.notifications.error(game.i18n.localize("BENEOS.Notifications.Search.BattlemapDbError"))
      }
    }
    try {
      let itemData = await foundry.utils.fetchJsonWithTimeout(itemDBURL, { cache: "no-cache", method: 'GET', 'Content-Type': 'application/json' })
      this.itemData = itemData
      localStorage.itemData = structuredClone(itemData)
    } catch {
      if (localStorage.itemData) {
        this.itemData = structuredClone(localStorage.itemData)
        this.isOffline = true
        ui.notifications.info(game.i18n.localize("BENEOS.Notifications.Search.ItemDbLocal"))
      } else {
        ui.notifications.error(game.i18n.localize("BENEOS.Notifications.Search.ItemDbError"))
      }
    }
    try {
      let spellData = await foundry.utils.fetchJsonWithTimeout(spellDBURL, { cache: "no-cache", method: 'GET', 'Content-Type': 'application/json' })
      this.spellData = spellData
      localStorage.spellData = structuredClone(spellData)
    } catch {
      if (localStorage.spellData) {
        this.spellData = structuredClone(localStorage.spellData)
        this.isOffline = true
        ui.notifications.info(game.i18n.localize("BENEOS.Notifications.Search.SpellDbLocal"))
      } else {
        ui.notifications.error(game.i18n.localize("BENEOS.Notifications.Search.SpellDbError"))
      }
    }
    try {
      let commonData = await foundry.utils.fetchJsonWithTimeout(commonDBURL, { cache: "no-cache", method: 'GET', 'Content-Type': 'application/json' })
      this.commonData = commonData
      localStorage.commonData = structuredClone(commonData)
    } catch {
      if (localStorage.commonData) {
        this.commonData = structuredClone(localStorage.commonData)
        this.isOffline = true
        ui.notifications.info(game.i18n.localize("BENEOS.Notifications.Search.CommonDbLocal"))
      } else {
        ui.notifications.error(game.i18n.localize("BENEOS.Notifications.Search.CommonDbError"))
      }
    }

    // Controlled-vocabulary tag-translation matrix (biomes, schools, rarities,
    // origins, ...). Best-effort: a failure here must not break the DB load;
    // the localizeTag helper falls back to the raw value when it is absent.
    try {
      let i18nMatrix = await foundry.utils.fetchJsonWithTimeout(i18nMatrixURL, { cache: "no-cache", method: 'GET', 'Content-Type': 'application/json' })
      this.i18nMatrix = i18nMatrix
      this._i18nLcIndex = null // reset the lazy lowercase index on (re)load
      localStorage.i18nMatrix = structuredClone(i18nMatrix)
    } catch {
      if (localStorage.i18nMatrix) {
        this.i18nMatrix = structuredClone(localStorage.i18nMatrix)
        this._i18nLcIndex = null
      } else {
        this.i18nMatrix = null
      }
    }

    BeneosUtility.saveLocalStorage(localStorage)

    this.buildSearchData()
  }

  /********************************************************************************** */
  // Localize a controlled-vocabulary tag value via the shared beneos_i18n matrix.
  // `domainField` is a field_map key (e.g. "token.biom", "item.rarity",
  // "spell.school"). Returns the translation for the active locale, falling back
  // to English, then to the raw value (so callers can still #capitalize it).
  // Never throws.
  static localizeTag(domainField, value) {
    const raw = String(value ?? "")
    try {
      const m = this.i18nMatrix
      if (!m || !m.field_map || !m.domains) return raw
      const catPath = m.field_map[domainField]
      if (!catPath) return raw
      const dot = catPath.indexOf(".")
      const dom = catPath.slice(0, dot), cat = catPath.slice(dot + 1)
      const bucket = m.domains?.[dom]?.[cat]
      if (!bucket) return raw
      let term = bucket[raw]
      if (!term) {
        // case-insensitive fallback (e.g. hardcoded "very rare" vs key "Very Rare")
        if (!this._i18nLcIndex) this._i18nLcIndex = {}
        const ck = dom + "." + cat
        let idx = this._i18nLcIndex[ck]
        if (!idx) {
          idx = {}
          for (const k in bucket) idx[k.toLowerCase()] = bucket[k]
          this._i18nLcIndex[ck] = idx
        }
        term = idx[raw.toLowerCase()]
      }
      if (!term) return raw
      return term[game.i18n.lang] || term.en || raw
    } catch (e) {
      return raw
    }
  }

  /********************************************************************************** */
  static getIsOffline() {
    return this.isOffline
  }

  /********************************************************************************** */
  static getHover(category, term) {
    if (!term || !category) return ""
    category = category.toString().toLowerCase()
    let termLow = term.toString().toLowerCase()
    if (this.commonData?.hover[category] && this.commonData.hover[category][termLow]?.message) {
      return this.commonData.hover[category][term].message
    }
    if (this.commonData?.hover[category] && this.commonData.hover[category][term.toString()]?.message) {
      return this.commonData.hover[category][term].message
    }
    return "No information"
  }

  /********************************************************************************** */
  static buildList(list) {
    let valueList = {}

    const sortObject = obj => Object.keys(obj).sort().reduce((res, key) => (res[key] = obj[key], res), {})

    if (list) {
      if (typeof (list) == "string" || typeof (list) == "number") {
        list = list.toString()
        if (!valueList[list]) {
          valueList[list] = 1
        } else {
          valueList[list]++
        }
        return sortObject(valueList)
      }
      if (Array.isArray(list)) {
        for (let key of list) {
          let keyStr = key.toString()
          if (!valueList[keyStr]) {
            valueList[keyStr] = 1
          } else {
            valueList[keyStr]++
          }
        }
      } else if (typeof (list) == "object") {
        for (let key in list) {
          let keyStr = list[key].toString()
          if (!valueList[keyStr]) {
            valueList[keyStr] = 1
          } else {
            valueList[keyStr]++
          }
        }
      }
    }
    return sortObject(valueList)
  }

  /********************************************************************************** */
  // Teil 4: unified New/Updated computation for token/item/spell.
  //  - New: the asset's catalog release_date (publication) is within the
  //    "new asset" window (default 30 days) AND it is not yet installed.
  //  - Updated: it IS installed and the online version is newer than the local
  //    install — compared via the catalog updated_date vs the local install
  //    date, with a content-signature mismatch as the fallback signal.
  // Falls back to the legacy updated_ts window for "new" only when release_date
  // is absent, so un-backfilled catalogs keep working and the new rule
  // auto-activates once the date fields arrive. (The old `ts > installTS`
  // update check compared unix-seconds against milliseconds and could never
  // fire, so update relied solely on the hash mismatch — the date comparison
  // below is what actually makes time-based updates work.)
  static beneosComputeNewUpdate(data, { ts, installTS, cloudHash, installHash } = {}) {
    const props = data?.properties || {}
    const installed = data?.installed === "installed"
    const windowSec = BeneosUtility.getNewAssetWindowSeconds()
    let isNew = false, isUpdate = false

    if (!installed) {
      const relMs = this.beneosParseDateMs(props.release_date)
      if (relMs != null) {
        const ageDays = (Date.now() - relMs) / 86400000
        isNew = ageDays >= 0 && ageDays <= (windowSec / 86400)
      } else if (ts) {
        isNew = ts >= (Math.floor(Date.now() / 1000) - windowSec)
      }
    } else {
      const updMs  = this.beneosParseDateMs(props.updated_date)
      const instMs = Number(installTS) || 0
      if (updMs != null && instMs > 0 && updMs > instMs) isUpdate = true
      if (!isUpdate && cloudHash && installHash && cloudHash !== installHash) isUpdate = true
    }
    return { isNew, isUpdate }
  }

  static beneosParseDateMs(s) {
    const str = String(s || "").trim()
    if (!str) return null
    const ms = Date.parse(str)
    return Number.isFinite(ms) ? ms : null
  }

  /********************************************************************************** */
  static processInstalledToken(tokenData) {
    tokenData.isInstalled = BeneosUtility.isTokenLoaded(tokenData.key)
    tokenData.installed = (tokenData.isInstalled) ? "installed" : "notinstalled"
    tokenData.isCloudAvailable = false
    tokenData.isNew = false
    tokenData.isUpdate = false

    if (tokenData.installed == "notinstalled") {
      tokenData.isCloudAvailable = game.beneos.cloud.isTokenAvailable(tokenData.key)
      if (!tokenData.isCloudAvailable
          && game.beneos.cloud.isFreeAsset?.("token", tokenData.key) === true
          && game.beneos.cloud.isLoggedIn?.()) {
        tokenData.isCloudAvailable = true
      }
      tokenData.installed = (tokenData.isCloudAvailable) ? "cloudavailable" : tokenData.installed
    }
    tokenData.cloudMessage = (tokenData.isCloudAvailable) ? "Cloud available" : "Cloud not available"
    tokenData.isInstallable = (tokenData.isInstalled || tokenData.isCloudAvailable)

    tokenData.dragMode = "none"
    if (tokenData.isCloudAvailable) {
      tokenData.dragMode = "cloud"
    } else if (tokenData.isInstalled) {
      tokenData.dragMode = "local"
    }

    // Prepare update/new status (Teil 4: unified release_date / updated_date)
    let tokenTS = game.beneos.cloud.getTokenTS(tokenData.key)
    tokenData.isNewForUser = !!game.beneos.cloud.getTokenIsNewForUser(tokenData.key)
    {
      const f = this.beneosComputeNewUpdate(tokenData, {
        ts:          tokenTS,
        installTS:   BeneosUtility.getTokenInstallTS(tokenData.key),
        cloudHash:   game.beneos.cloud.getTokenHash(tokenData.key),
        installHash: BeneosUtility.getTokenInstallHash(tokenData.key),
      })
      tokenData.isNew = f.isNew
      tokenData.isUpdate = f.isUpdate
    }

    tokenData.properties.install = ["Any", "All"] // Used for filtering
    if (tokenData.isNew) {
      tokenData.properties.install.push("New")
    }
    if (tokenData.isNewForUser) {
      tokenData.properties.install.push("NewForYou")
    }
    if (tokenData.isUpdate) {
      tokenData.properties.install.push("Updated")
    }
  }

  /********************************************************************************** */
  static processInstalledItem(itemData) {
    itemData.isInstalled = BeneosUtility.isItemLoaded(itemData.key)
    itemData.installed = (itemData.isInstalled) ? "installed" : "notinstalled"
    itemData.isCloudAvailable = false
    if (itemData.installed === "notinstalled") {
      itemData.isCloudAvailable = game.beneos.cloud.isItemAvailable(itemData.key)
      // Free items are always cloud-available for logged-in users. Free status
      // comes from the cloud "Free" tier (data.free), the single dynamic source
      // of truth — not the stale catalog free_content flag.
      if (!itemData.isCloudAvailable
          && game.beneos.cloud.isFreeAsset?.("item", itemData.key) === true
          && game.beneos.cloud.isLoggedIn?.()) {
        itemData.isCloudAvailable = true
      }
      itemData.installed = (itemData.isCloudAvailable) ? "cloudavailable" : itemData.installed
    }
    itemData.cloudMessage = (itemData.isCloudAvailable) ? "Cloud available" : "Cloud not available"
    itemData.isInstallable = (itemData.isInstalled || itemData.isCloudAvailable)

    // Prepare update/new status (Teil 4: unified release_date / updated_date)
    let itemTS = game.beneos.cloud.getItemTS(itemData.key)
    itemData.isNewForUser = !!game.beneos.cloud.getItemIsNewForUser(itemData.key)
    {
      const f = this.beneosComputeNewUpdate(itemData, {
        ts:          itemTS,
        installTS:   BeneosUtility.getItemInstallTS(itemData.key),
        cloudHash:   game.beneos.cloud.getItemHash(itemData.key),
        installHash: BeneosUtility.getItemInstallHash(itemData.key),
      })
      itemData.isNew = f.isNew
      itemData.isUpdate = f.isUpdate
    }
    itemData.properties.install = ["Any", "All"] // Used for filtering
    if (itemData.isNew) {
      itemData.properties.install.push("New")
    }
    if (itemData.isNewForUser) {
      itemData.properties.install.push("NewForYou")
    }
    if (itemData.isUpdate) {
      itemData.properties.install.push("Updated")
    }
    itemData.dragMode = "none"
    if (itemData.isCloudAvailable) {
      itemData.dragMode = "cloud"
    } else if (itemData.isInstalled) {
      itemData.dragMode = "local"
    } else {
      itemData.dragMode = "none"
    }
  }

  /********************************************************************************** */
  static processInstalledSpell(spellData) {
    spellData.isInstalled = BeneosUtility.isSpellLoaded(spellData.key)
    spellData.installed = (spellData.isInstalled) ? "installed" : "notinstalled"
    spellData.isCloudAvailable = false
    if (spellData.installed == "notinstalled") {
      spellData.isCloudAvailable = game.beneos.cloud.isSpellAvailable(spellData.key)
      if (!spellData.isCloudAvailable
          && game.beneos.cloud.isFreeAsset?.("spell", spellData.key) === true
          && game.beneos.cloud.isLoggedIn?.()) {
        spellData.isCloudAvailable = true
      }
      spellData.installed = (spellData.isCloudAvailable) ? "cloudavailable" : spellData.installed
    }
    spellData.cloudMessage = (spellData.isCloudAvailable) ? "Cloud available" : "Cloud not available"
    spellData.isInstallable = (spellData.isInstalled || spellData.isCloudAvailable)

    if (spellData.isInstalled) {
      //spellData.picture = BeneosUtility.getLocalAvatarPicture(spellData.key)
    }
    // Prepare update/new status (Teil 4: unified release_date / updated_date)
    let spellTS = game.beneos.cloud.getSpellTS(spellData.key)
    spellData.isNewForUser = !!game.beneos.cloud.getSpellIsNewForUser(spellData.key)
    {
      const f = this.beneosComputeNewUpdate(spellData, {
        ts:          spellTS,
        installTS:   BeneosUtility.getSpellInstallTS(spellData.key),
        cloudHash:   game.beneos.cloud.getSpellHash(spellData.key),
        installHash: BeneosUtility.getSpellInstallHash(spellData.key),
      })
      spellData.isNew = f.isNew
      spellData.isUpdate = f.isUpdate
    }
    spellData.properties.install = ["Any", "All"] // Used for filtering
    if (spellData.isNew) {
      spellData.properties.install.push("New")
    }
    if (spellData.isNewForUser) {
      spellData.properties.install.push("NewForYou")
    }
    if (spellData.isUpdate) {
      spellData.properties.install.push("Updated")
    }
    spellData.dragMode = "none"
    if (spellData.isCloudAvailable) {
      spellData.dragMode = "cloud"
    } else if (spellData.isInstalled) {
      spellData.dragMode = "local"
    } else {
      spellData.dragMode = "none"
    }
  }

  /********************************************************************************** */
  static getTokenDatabaseInfo(key) {
    return this.tokenData.content[key]
  }

  /********************************************************************************** */
  static buildTypeACHPString(properties) {
    if (!properties.type || properties.type.length == 0) {
      properties.typeString = ""
      return
    }
    let typeString = properties.type[0].charAt(0).toUpperCase() + properties.type[0].slice(1)
    // For each type above the first, put them into (), comma separated
    if (properties.type.length > 1) {
      typeString += " ("
      for (let i = 1; i < properties.type.length; i++) {
        if (i > 1) {
          typeString += ", "
        }
        // Uppercase first letter
        typeString += properties.type[i].charAt(0).toUpperCase() + properties.type[i].slice(1)
      }
      typeString += ")"
    }
    properties.typeString = typeString
  }

  /********************************************************************************** */
  static buildSearchData() {
    this.tokenTypes = {}
    this.tokenBioms = {}
    this.tokenFactions = {}
    this.tokenCampaigns = {}
    this.tokenSources = {}
    this.bmapBioms = {}
    this.fightingStyles = {}
    this.bmapBrightness = {}
    this.crList = [{ key: "any", value: game.i18n.localize("BENEOS.Cloud.Filter.Any") }, { key: "0,4", value: "0 to 4" }, { key: "5,10", value: "5 to 10" }, { key: "11,15", value: "11 to 15" },
    { key: "15,10000000", value: "15+" }]
    this.movementList = {}
    this.purposeList = {}
    this.hiddenTagsList = {}
    this.gridList = [{ key: "any", value: game.i18n.localize("BENEOS.Cloud.Filter.Any") }, { key: "<150", value: "Tiny" }, { key: "<500", value: "Small" }, { key: "<1000", value: "Medium" },
    { key: "<2000", value: "Big" }, { key: ">2000", value: "Very Big" }]
    this.adventureList = {}
    this.itemRarity = [{ key: "any", value: game.i18n.localize("BENEOS.Cloud.Filter.Any") }, { key: "common", value: "    Common" }, { key: "uncommon", value: "   Uncommon" }, { key: "rare", value: "  Rare" }, { key: "very rare", value: " Very Rare" }, { key: "legendary", value: "Legendary" }]
    this.itemOrigin = {}
    this.itemType = {}
    this.itemTier = {}
    this.itemPrice = [{ key: "any", value: game.i18n.localize("BENEOS.Cloud.Filter.Any") }, { key: "<100", value: "< 100g" }, { key: "<1000", value: "< 1000g" }, { key: "<5000", value: "< 5000g" },
    { key: "<15000", value: "< 15.000g" }, { key: ">15000", value: "> 15.000g" }]
    this.spellLevel = {}
    this.spellSchool = {}
    this.spellCastingTime = {}
    this.spellType = {}
    this.spellClasses = {}

    for (let key in this.tokenData.content) {
      //BeneosUtility.debugMessage("Processing", key)
      let tokenData = this.tokenData.content[key]
      if (tokenData && typeof (tokenData) == "object") {
        tokenData.kind = "token"
        tokenData.key = key
        tokenData.picture = "https://www.beneos-database.com/data/tokens/thumbnails_v2/" + tokenData.properties.thumbnail
        foundry.utils.mergeObject(this.tokenBioms, this.buildList(tokenData.properties.biom))
        foundry.utils.mergeObject(this.tokenFactions, this.buildList(tokenData.properties.faction))
        foundry.utils.mergeObject(this.tokenSources, this.buildList(tokenData.properties.source))
        foundry.utils.mergeObject(this.tokenTypes, this.buildList(tokenData.properties.type))
        foundry.utils.mergeObject(this.fightingStyles, this.buildList(tokenData.properties.fightingstyle))
        foundry.utils.mergeObject(this.movementList, this.buildList(tokenData.properties.movement))
        foundry.utils.mergeObject(this.purposeList, this.buildList(tokenData.properties.purpose))
        foundry.utils.mergeObject(this.tokenCampaigns, this.buildList(tokenData.properties.campaign))
        this.processInstalledToken(tokenData)
        this.buildTypeACHPString(tokenData.properties)
        tokenData.factionText = tokenData.properties?.faction?.[0] || ""
        if (tokenData.installed === "notinstalled") {
          continue; // Skip the rest of the processing if not installed (ie only cloud/installed listing)
        }

        tokenData.nbVariants = tokenData.properties.nb_variants || 1
        tokenData.actorId = BeneosUtility.getActorId(key)
        tokenData.description = tokenData.description
        if (tokenData.nbVariants > 0) {
          tokenData.variantClass = "beneos-search-icons-result-tooltip-variant-3"
          if (tokenData.nbVariants == 1) {
            tokenData.variantClass = "beneos-search-icons-result-tooltip-variant-1"
          }
          if (tokenData.nbVariants == 2) {
            tokenData.variantClass = "beneos-search-icons-result-tooltip-variant-2"
          }
          tokenData.variantList = []
          for (let i = 1; i <= tokenData.nbVariants; i++) {
            let variant = {
              thumbnail: "https://www.beneos-database.com/data/tokens/thumbnails_v2/" + tokenData.key + "-" + i + "-db.webp",
              actorId: BeneosUtility.getActorIdVariant(key, i),
            }
            tokenData.variantList.push(variant)
          }
        }
      }
    }

    for (let key in this.bmapData.content) {
      let bmapData = this.bmapData.content[key]
      if (bmapData && typeof (bmapData) == "object") {
        // Make uppercase first letter to all words in the name string
        bmapData.name = bmapData.name.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
        bmapData.kind = "battlemap"
        bmapData.key = key
        bmapData.picture = "https://www.beneos-database.com/data/battlemaps/thumbnails/" + bmapData.properties.thumbnail
        foundry.utils.mergeObject(this.bmapBrightness, this.buildList(bmapData.properties.brightness))
        foundry.utils.mergeObject(this.bmapBioms, this.buildList(bmapData.properties.biom))
        foundry.utils.mergeObject(this.adventureList, this.buildList(bmapData.properties.adventure))
        bmapData.isInstalled = true
      }
    }
    for (let key in this.bmapData.content) {
      let bmapData = this.bmapData.content[key]
      if (bmapData && typeof (bmapData) == "object") {
        if (bmapData.properties.sibling) {
          bmapData.siblingPicture = this.getSiblingPicture(bmapData.properties.sibling)
        }
      }
    }

    for (let key in this.itemData.content) {
      let itemData = this.itemData.content[key]
      if (itemData && typeof (itemData) == "object") {
        if (/^\d+_/.test(key)) {
          key = key.replace(/^(\d+)_/, '$1-');
        }
        itemData.kind = "item"
        itemData.key = key
        itemData.path_name = itemData.name.replace(/ /g, "_").toLowerCase()
        itemData.picture = "https://www.beneos-database.com/data/items/thumbnails/" + itemData.properties.icon
        foundry.utils.mergeObject(this.itemRarity, this.buildList(itemData.properties.rarity))
        foundry.utils.mergeObject(this.itemOrigin, this.buildList(itemData.properties.origin))
        foundry.utils.mergeObject(this.itemType, this.buildList(itemData.properties.item_type))
        foundry.utils.mergeObject(this.itemTier, this.buildList(itemData.properties.tier))
        this.processInstalledItem(itemData)
        if (itemData.isInstalled) {
          itemData.itemId = BeneosUtility.getItemId(key)
          itemData.card_front = BeneosUtility.getBeneosItemDataPath() + "/" + key + "/" + key + "-front.webp"
          itemData.card_back = BeneosUtility.getBeneosItemDataPath() + "/" + key + "/" + key + "-back.webp"
        }
      }
    }

    for (let key in this.spellData.content) {
      let spellData = this.spellData.content[key]
      if (spellData && typeof (spellData) == "object") {
        if (/^\d+_/.test(key)) {
          key = key.replace(/^(\d+)_/, '$1-');
        }
        spellData.kind = "spell"
        spellData.key = key
        spellData.path_name = spellData.name.replace(/ /g, "_").toLowerCase()
        spellData.picture = "https://www.beneos-database.com/data/spells/thumbnails/" + spellData.properties.icon
        foundry.utils.mergeObject(this.spellLevel, this.buildList(spellData.properties.level))
        foundry.utils.mergeObject(this.spellSchool, this.buildList(spellData.properties.school))
        foundry.utils.mergeObject(this.spellCastingTime, this.buildList(spellData.properties.casting_time))
        foundry.utils.mergeObject(this.spellType, this.buildList(String(spellData.properties.spell_type)))
        foundry.utils.mergeObject(this.spellClasses, this.buildList(spellData.properties.classes))
        this.processInstalledSpell(spellData)
        if (spellData.isInstalled) {
          spellData.spellId = BeneosUtility.getSpellId(key)
          spellData.card_front = BeneosUtility.getBeneosSpellDataPath() + "/" + key + "/" + key + "-front.webp"
          spellData.card_back = BeneosUtility.getBeneosSpellDataPath() + "/" + "spell_card_back.webp"
        }
      }
    }
  }

  /********************************************************************************** */
  static fieldTextSearch(item, text) {
    // Split text in words, ignore words smaller than 3 letters
    let words = text.split(" ").filter(word => word.length >= 3)
    if (words.length == 0) {
      return false
    }
    // Search each word in all fields
    for (let word of words) {
      for (let field in item) {
        let value = item[field]
        if (field == "description") {
          continue
        }
        if (typeof (value) == "string") {
          if (value.toLowerCase().includes(word)) {
            return true
          }
        } else if (Array.isArray(value)) {
          for (let arrayValue of value) {
            if (typeof (arrayValue) == "string" && arrayValue.toLowerCase().includes(word)) {
              return true
            }
          }
        }
      }
    }
    return false
  }

  /********************************************************************************** */
  static getTagDescriptions() {
    return structuredClone(this.tokenData.tag_description)
  }

  /********************************************************************************** */
  static getTagDescription(tagName) {
    if (this.tokenData.tag_description) {
      let tag = this.tokenData.tag_description[tagName.toLowerCase()]
      if (tag) {
        return tag.description
      }
    }
    return "No information"
  }

  /********************************************************************************** */
  static objectTextSearch(objectList, text, kind) {
    let results = []

    text = text.toLowerCase()

    for (let key in objectList) {
      let item = structuredClone(objectList[key])
      item.kind = kind || "token"
      if (item.kind == "token") {
        item.kind = (kind == "token") ? "token" : item.properties.type
      }
      if (kind && kind == "item") {
        item.picture = "https://www.beneos-database.com/data/items/thumbnails/" + item.properties.icon
      } else if (kind && kind == "spell") {
        item.picture = "https://www.beneos-database.com/data/spells/thumbnails/" + item.properties.icon
      } else if (item.kind == "token") {
        item.picture = "https://www.beneos-database.com/data/tokens/thumbnails_v2/" + item.properties.thumbnail
      } else {
        item.kind = "battlemap"
        item.picture = "https://www.beneos-database.com/data/battlemaps/thumbnails/" + item.properties.thumbnail
      }
      if (this.fieldTextSearch(item, text) || this.fieldTextSearch(item.properties, text)) {
        results.push(item)
      }
    }
    return results
  }

  /********************************************************************************** */
  static textSearch(text, mode) {
    BeneosUtility.debugMessage("TEXT search", text, mode)
    let results = []
    if (mode == "token") {
      results = this.objectTextSearch(this.tokenData.content, text, "token")
    }
    if (mode == "bmap") {
      results = results.concat(this.objectTextSearch(this.bmapData.content, text, "bmap"))
    }
    if (mode == "item") {
      results = results.concat(this.objectTextSearch(this.itemData.content, text, "item"))
    }
    if (mode == "spell") {
      results = results.concat(this.objectTextSearch(this.spellData.content, text, "spell"))
    }

    BeneosUtility.debugMessage("TEXT search results", results)
    return results
  }

  /********************************************************************************** */
  static getSiblingPicture(key) {
    let sibling = this.bmapData.content[key]
    if (sibling) {
      return "https://www.beneos-database.com/data/battlemaps/thumbnails/" + sibling.properties.thumbnail
    }
    BeneosUtility.debugMessage("No relevant sibling picture found for", key)
    return undefined
  }

  /********************************************************************************** */
  static searchByProperty(type, propertyName, value, searchResults, strict = false) {
    let newResults = {}
    value = value.toLowerCase()

    BeneosUtility.debugMessage(">>>>>", type, propertyName, value, searchResults)

    for (let key in searchResults) {
      let item = searchResults[key]
      item.kind = type
      if (type == "bmap" || type == "battlemap") {
        item.kind = "battlemap"
      }
      if (item.kind == "token") {
        item.picture = "https://www.beneos-database.com/data/tokens/thumbnails_v2/" + item.properties.thumbnail
      }
      if (item[propertyName]) {
        if (item[propertyName].toLowerCase() == value) {
          newResults[key] = structuredClone(item)
        }
      }
      if (propertyName == "grid") {
        let comp = value.substring(0, 1)
        let grid = parseInt(value.substring(1))
        let sizeParse = item.properties.grid.match(/(\d+)\s*x\s*(\d+)/)
        if (sizeParse?.[1] && sizeParse?.[2]) {
          let size = parseInt(sizeParse[1]) * parseInt(sizeParse[2])
          if ((comp == "<" && Number(size) <= Number(grid)) || (comp == ">" && Number(size) >= Number(grid))) {
            newResults[key] = structuredClone(item)
          }
        }
      } else if (propertyName == "cr") {
        let comp = value.match(/(\d+),(\d+)/)
        if (comp?.[1] && comp?.[2]) {
          if (item.properties.cr >= Number(comp[1]) && (item.properties.cr <= Number(comp[2]))) {
            newResults[key] = structuredClone(item)
          }
        } else if (item.properties.cr == Number(value)) {
          newResults[key] = structuredClone(item)
        }

      } else if (propertyName == "price") {
        let comp = value.substring(0, 1)
        let price = parseInt(value.substring(1))
        if ((comp == "<" && item.properties.price <= price) || (comp == ">" && item.properties.price > price)) {
          newResults[key] = structuredClone(item)
        }
      } else if (item?.properties[propertyName]) {
        if (typeof (item.properties[propertyName]) == "string" || typeof (item.properties[propertyName]) == "number") {
          if (strict) {
            if (item.properties[propertyName].toString().toLowerCase() == value.toString()) {
              newResults[key] = structuredClone(item)
            }
          } else {
            if (item.properties[propertyName].toString().toLowerCase().includes(value)) {
              newResults[key] = structuredClone(item)
            }
          }
        } else {
          if (Array.isArray(item.properties[propertyName])) {
            for (let valueArray of item.properties[propertyName]) {
              if ((typeof (valueArray) == "string") && valueArray.toString().toLowerCase().includes(value)) {
                newResults[key] = structuredClone(item)
              }
            }
          }
        }
      }
    }
    BeneosUtility.debugMessage("Found", newResults)
    return newResults
  }

  /********************************************************************************** */
  static getAll(type) {
    if (type == "token") {
      return structuredClone(this.tokenData.content)
    }
    if (type == "item") {
      return structuredClone(this.itemData.content)
    }
    if (type == "spell") {
      return structuredClone(this.spellData.content)
    }
    return structuredClone(this.bmapData.content)
  }

  /********************************************************************************** */
  static sortProperties(tab) {
    // Check if tab is an array
    if (!Array.isArray(tab)) {
      return tab
    }
    if (tab.length > 0) {
      if (Number(tab[0].key)) {
        return tab.sort(function (a, b) {
          if (!Number(a.key) || !Number(b.key)) {
            return 0;
          }
          if (Number(a.key) > Number(b.key)) {
            return 1;
          }
          return -1;
        })
      }
      if (tab[0].key[0] == "<" || tab[0].key[0] == ">") {
        let a1 = Number(a.key.slice(1))
        let b1 = Number(b.key.slice(1))
        if (a1 > b1) return 1;
        return -1;
      }
    }
    return tab.sort(function (a, b) { return a.value.localeCompare(b.value) })
  }

  /********************************************************************************** */
  static toTable(object) {
    let tab = []
    for (let key in object) {
      key = String(key)
      if (tab.find((it) => it.key == key.toLowerCase()) == undefined) {
        tab.push({ key: key.toLowerCase(), value: key })
      }
    }
    tab = BeneosDatabaseHolder.sortProperties(tab)
    if (tab.find((it) => it.key.toLowerCase() == "any") == undefined) {
      tab.splice(0, 0, { key: "any", value: game.i18n.localize("BENEOS.Cloud.Filter.Any") })
    }

    return tab
  }

  /********************************************************************************** */
  static getBattlemap(key) {
    return this.bmapData.content[key]
  }

  /********************************************************************************** */
  static getData() {
    let mode = "token"
    if (game.beneosTokens.lastFilterStack?.mode) {
      mode = game.beneosTokens.lastFilterStack.mode
    }

    return {
      searchMode: mode,

      tokenBioms: this.toTable(this.tokenBioms),
      bmapBioms: this.toTable(this.bmapBioms),
      tokenTypes: this.toTable(this.tokenTypes),
      tokenFactions: this.toTable(this.tokenFactions),
      tokenSources: this.toTable(this.tokenSources),
      tokenCampaigns: this.toTable(this.tokenCampaigns),
      fightingStyles: this.toTable(this.fightingStyles),
      bmapBrightness: this.toTable(this.bmapBrightness),
      movementList: this.toTable(this.movementList),
      crList: structuredClone(this.crList),
      purposeList: this.toTable(this.purposeList),
      adventureList: this.toTable(this.adventureList),
      gridList: BeneosDatabaseHolder.sortProperties(structuredClone(this.gridList)),

      rarity: this.toTable(this.itemRarity),
      origin: this.toTable(this.itemOrigin),
      itemType: this.toTable(this.itemType),
      tier: this.toTable(this.itemTier),
      price: BeneosDatabaseHolder.sortProperties(structuredClone(this.itemPrice)),

      level: this.toTable(this.spellLevel),
      school: this.toTable(this.spellSchool),
      castingTime: this.toTable(this.spellCastingTime),
      spellType: this.toTable(this.spellType),
      spellClass: this.toTable(this.spellClasses),

      isCloudLoggedIn: game.beneos.cloud.isLoggedIn(),
      patreonStatus: game.beneos.cloud.getPatreonStatus(),
    }
  }
}
