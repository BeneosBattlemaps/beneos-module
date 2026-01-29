import { BeneosUtility } from "./beneos_utility.js"
import { BeneosCloudLogin } from "./beneos_cloud.js"

/********************************************************************************** */
//const tokenDBURL = "https://www.beneos-database.com/data/tokens/beneos_tokens_database.json"
const tokenDBURL = "https://www.beneos-database.com/data/tokens/beneos_tokens_database_v2.json"
const battlemapDBURL = "https://www.beneos-database.com/data/battlemaps/beneos_battlemaps_database.json"
const itemDBURL = "https://www.beneos-database.com/data/items/beneos_items_database.json"
const spellDBURL = "https://www.beneos-database.com/data/spells/beneos_spells_database.json"
const commonDBURL = "https://www.beneos-database.com/data/common/beneos_common_database.json"

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

    console.log("SEARCH results", beneosTokensHUD)
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
    console.log("Processing text search", event.currentTarget.value)
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
      localStorage.tokenData = foundry.utils.duplicate(tokenData)
    } catch (err) {
      if (localStorage.tokenData) {
        this.tokenData = foundry.utils.duplicate(localStorage.tokenData)
        this.isOffline = true
        ui.notifications.info("Unable to load Beneos Token Database - Using local copy (may be outdated)")
      } else {
        ui.notifications.error("Unable to load Beneos Token Database - File error " + err.message + " " + tokenDBURL)
      }
    }
    try {
      let bmapData = await foundry.utils.fetchJsonWithTimeout(battlemapDBURL, { cache: "no-cache", method: 'GET', 'Content-Type': 'application/json' })
      this.bmapData = bmapData
      localStorage.bmapData = foundry.utils.duplicate(bmapData)
    } catch {
      if (localStorage.bmapData) {
        this.bmapData = foundry.utils.duplicate(localStorage.bmapData)
        this.isOffline = true
        ui.notifications.info("Unable to load Beneos Battlemap Database - Using local copy (may be outdated)")
      } else {
        ui.notifications.error("Unable to load Beneos Battlemap Database - File error")
      }
    }
    try {
      let itemData = await foundry.utils.fetchJsonWithTimeout(itemDBURL, { cache: "no-cache", method: 'GET', 'Content-Type': 'application/json' })
      this.itemData = itemData
      localStorage.itemData = foundry.utils.duplicate(itemData)
    } catch {
      if (localStorage.itemData) {
        this.itemData = foundry.utils.duplicate(localStorage.itemData)
        this.isOffline = true
        ui.notifications.info("Unable to load Beneos Item Database - Using local copy (may be outdated)")
      } else {
        ui.notifications.error("Unable to load Beneos Item Database - File error")
      }
    }
    try {
      let spellData = await foundry.utils.fetchJsonWithTimeout(spellDBURL, { cache: "no-cache", method: 'GET', 'Content-Type': 'application/json' })
      this.spellData = spellData
      localStorage.spellData = foundry.utils.duplicate(spellData)
    } catch {
      if (localStorage.spellData) {
        this.spellData = foundry.utils.duplicate(localStorage.spellData)
        this.isOffline = true
        ui.notifications.info("Unable to load Beneos Spell Database - Using local copy (may be outdated)")
      } else {
        ui.notifications.error("Unable to load Beneos Spell Database - File error")
      }
    }
    try {
      let commonData = await foundry.utils.fetchJsonWithTimeout(commonDBURL, { cache: "no-cache", method: 'GET', 'Content-Type': 'application/json' })
      this.commonData = commonData
      localStorage.commonData = foundry.utils.duplicate(commonData)
    } catch {
      if (localStorage.commonData) {
        this.commonData = foundry.utils.duplicate(localStorage.commonData)
        this.isOffline = true
        ui.notifications.info("Unable to load Beneos Common Database - Using local copy (may be outdated)")
      } else {
        ui.notifications.error("Unable to load Beneos Common Database - File error")
      }
    }

    BeneosUtility.saveLocalStorage(localStorage)

    this.buildSearchData()
  }

  /********************************************************************************** */
  static getIsOffline() {
    return this.isOffline
  }

  /********************************************************************************** */
  static getHover(category, term) {
    if (!term || !category) {
      console.log("Wrong term/category", category, term)
      return ""
    }
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
  static processInstalledToken(tokenData) {
    tokenData.isInstalled = BeneosUtility.isTokenLoaded(tokenData.key)
    tokenData.installed = (tokenData.isInstalled) ? "installed" : "notinstalled"
    tokenData.isCloudAvailable = false
    tokenData.isNew = false
    tokenData.isUpdate = false

    if (tokenData.installed == "notinstalled") {
      tokenData.isCloudAvailable = game.beneos.cloud.isTokenAvailable(tokenData.key)
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

    // Prepare update/new status
    let tokenTS = game.beneos.cloud.getTokenTS(tokenData.key)
    if (tokenTS) {
      let t30days = 30 * 24 * 60 * 60
      let tNow30Days = Math.floor(Date.now() / 1000) - t30days
      if (tokenData.installed !== "installed" && tokenTS >= tNow30Days) {
        tokenData.isNew = true
      }
      if (tokenData.installed === "installed") {
        let installTS = BeneosUtility.getTokenInstallTS(tokenData.key)
        console.log("Installed token", tokenData.key, tokenTS, installTS)
        if (tokenTS > installTS) {
          tokenData.isUpdate = true
        }
      }
    } else {
      //console.log("No tokenTS for", tokenData.key)
    }

    tokenData.properties.install = ["Any", "All"] // Used for filtering
    if (tokenData.isNew) {
      tokenData.properties.install.push("New")
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
      itemData.installed = (itemData.isCloudAvailable) ? "cloudavailable" : itemData.installed
    }
    itemData.cloudMessage = (itemData.isCloudAvailable) ? "Cloud available" : "Cloud not available"
    itemData.isInstallable = (itemData.isInstalled || itemData.isCloudAvailable)

    // Prepare update/new status
    let itemTS = game.beneos.cloud.getItemTS(itemData.key)
    if (itemTS) {
      let t30days = 30 * 24 * 60 * 60
      let tNow30Days = Math.floor(Date.now() / 1000) - t30days
      if (itemData.installed !== "installed" && itemTS >= tNow30Days) {
        itemData.isNew = true
      }
      if (itemData.installed === "installed") {
        let installTS = BeneosUtility.getItemInstallTS(itemData.key)
        console.log("Installed item", itemData.key, itemTS, installTS)
        if (itemTS > installTS) {
          itemData.isUpdate = true
        }
      }
    } else {
      // console.log("No itemTS for", itemData)
    }
    itemData.properties.install = ["Any", "All"] // Used for filtering
    if (itemData.isNew) {
      itemData.properties.install.push("New")
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
      spellData.installed = (spellData.isCloudAvailable) ? "cloudavailable" : spellData.installed
    }
    spellData.cloudMessage = (spellData.isCloudAvailable) ? "Cloud available" : "Cloud not available"
    spellData.isInstallable = (spellData.isInstalled || spellData.isCloudAvailable)

    if (spellData.isInstalled) {
      //spellData.picture = BeneosUtility.getLocalAvatarPicture(spellData.key)
    }
    // Prepare update/new status
    let spellTS = game.beneos.cloud.getSpellTS(spellData.key)
    if (spellTS) {
      let t30days = 30 * 24 * 60 * 60
      let tNow30Days = Math.floor(Date.now() / 1000) - t30days
      if (spellData.installed !== "installed" && spellTS >= tNow30Days) {
        spellData.isNew = true
      }
      if (spellData.installed === "installed") {
        let installTS = BeneosUtility.getSpellInstallTS(spellData.key)
        console.log("Installed spell", spellData.key, spellTS, installTS)
        if (spellTS > installTS) {
          spellData.isUpdate = true
        }
      }
    } else {
      //console.log("No spellTS for", spellData.key)
    }
    spellData.properties.install = ["Any", "All"] // Used for filtering
    if (spellData.isNew) {
      spellData.properties.install.push("New")
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
    // Add AC/HP
    /* No more displayed
    if (properties.stat_hp) {
      typeString += ", HP: " + properties.stat_hp
    }
    if (properties.stat_ac) {
      typeString += ", AC: " + properties.stat_ac
    }*/
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
    this.crList = [{ key: "any", value: "Any" }, { key: "0,4", value: "0 to 4" }, { key: "5,10", value: "5 to 10" }, { key: "11,15", value: "11 to 15" },
    { key: "15,10000000", value: "15+" }]
    this.movementList = {}
    this.purposeList = {}
    this.hiddenTagsList = {}
    this.gridList = [{ key: "any", value: "Any" }, { key: "<150", value: "Tiny" }, { key: "<500", value: "Small" }, { key: "<1000", value: "Medium" },
    { key: "<2000", value: "Big" }, { key: ">2000", value: "Very Big" }]
    this.adventureList = {}
    this.itemRarity = [{ key: "any", value: "Any" }, { key: "common", value: "    Common" }, { key: "uncommon", value: "   Uncommon" }, { key: "rare", value: "  Rare" }, { key: "very rare", value: " Very Rare" }, { key: "legendary", value: "Legendary" }]
    this.itemOrigin = {}
    this.itemType = {}
    this.itemTier = {}
    this.itemPrice = [{ key: "any", value: "Any" }, { key: "<100", value: "< 100g" }, { key: "<1000", value: "< 1000g" }, { key: "<5000", value: "< 5000g" },
    { key: "<15000", value: "< 15.000g" }, { key: ">15000", value: "> 15.000g" }]
    this.spellLevel = {}
    this.spellSchool = {}
    this.spellCastingTime = {}
    this.spellType = {}
    this.spellClasses = {}

    for (let key in this.tokenData.content) {
      //console.log("Processing", key)
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
        // Deprecated foundry.utils.mergeObject(this.gridList, this.buildList(bmapData.properties.grid))
        bmapData.isInstalled = true
      }
    }
    for (let key in this.bmapData.content) {
      let bmapData = this.bmapData.content[key]
      if (bmapData && typeof (bmapData) == "object") {
        if (bmapData.properties.sibling) {
          bmapData.siblingPicture = this.getSiblingPicture(bmapData.properties.sibling)
          //console.log("SIBLING : ", bmapData.siblingPicture)
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
    // Double pass to setup siblingPicture

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
    return foundry.utils.duplicate(this.tokenData.tag_description)
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
      let item = foundry.utils.duplicate(objectList[key])
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
    console.log("TEXT search", text, mode)
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

    console.log("TEXT search results", results)
    //console.log("TEXT results ", results, this.bmapData.content)
    return results
  }

  /********************************************************************************** */
  static getSiblingPicture(key) {
    let sibling = this.bmapData.content[key]
    if (sibling) {
      return "https://www.beneos-database.com/data/battlemaps/thumbnails/" + sibling.properties.thumbnail
    }
    console.log("No relevant sibling picture found for", key)
    return undefined
  }

  /********************************************************************************** */
  static searchByProperty(type, propertyName, value, searchResults, strict = false) {
    let newResults = {}
    value = value.toLowerCase()

    console.log(">>>>>", type, propertyName, value, searchResults)

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
          newResults[key] = foundry.utils.duplicate(item)
        }
      }
      if (propertyName == "grid") {
        let comp = value.substring(0, 1)
        let grid = parseInt(value.substring(1))
        //console.log("Parsing", item.properties.grid, grid, comp)
        let sizeParse = item.properties.grid.match(/(\d+)\s*x\s*(\d+)/)
        if (sizeParse?.[1] && sizeParse?.[2]) {
          let size = parseInt(sizeParse[1]) * parseInt(sizeParse[2])
          if ((comp == "<" && Number(size) <= Number(grid)) || (comp == ">" && Number(size) >= Number(grid))) {
            newResults[key] = foundry.utils.duplicate(item)
          }
        }
      } else if (propertyName == "cr") {
        let comp = value.match(/(\d+),(\d+)/)
        if (comp?.[1] && comp?.[2]) {
          if (item.properties.cr >= Number(comp[1]) && (item.properties.cr <= Number(comp[2]))) {
            newResults[key] = foundry.utils.duplicate(item)
          }
        } else if (item.properties.cr == Number(value)) {
          newResults[key] = foundry.utils.duplicate(item)
        }

      } else if (propertyName == "price") {
        let comp = value.substring(0, 1)
        let price = parseInt(value.substring(1))
        if ((comp == "<" && item.properties.price <= price) || (comp == ">" && item.properties.price > price)) {
          newResults[key] = foundry.utils.duplicate(item)
        }
      } else if (item?.properties[propertyName]) {
        //console.log(item.properties[propertyName], typeof (item.properties[propertyName]))
        if (typeof (item.properties[propertyName]) == "string" || typeof (item.properties[propertyName]) == "number") {
          if (strict) {
            if (item.properties[propertyName].toString().toLowerCase() == value.toString()) {
              newResults[key] = foundry.utils.duplicate(item)
            }
          } else {
            if (item.properties[propertyName].toString().toLowerCase().includes(value)) {
              newResults[key] = foundry.utils.duplicate(item)
            }
          }
        } else {
          if (Array.isArray(item.properties[propertyName])) {
            for (let valueArray of item.properties[propertyName]) {
              if ((typeof (valueArray) == "string") && valueArray.toString().toLowerCase().includes(value)) {
                newResults[key] = foundry.utils.duplicate(item)
              }
            }
          }
        }
      }
    }
    console.log("Found", newResults)
    return newResults
  }

  /********************************************************************************** */
  static getAll(type) {
    if (type == "token") {
      return foundry.utils.duplicate(this.tokenData.content)
    }
    if (type == "item") {
      return foundry.utils.duplicate(this.itemData.content)
    }
    if (type == "spell") {
      return foundry.utils.duplicate(this.spellData.content)
    }
    return foundry.utils.duplicate(this.bmapData.content)
  }

  /********************************************************************************** */
  static sortProperties(tab) {
    // Check if tab is an array
    if (!Array.isArray(tab)) {
      return tab
    }
    if (tab.length > 0) {
      if (Number(tab[0].key)) {
        //console.log("Numeric sort!!!")
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
    //console.log(">>>>> SORT", tab)
    if (tab.find((it) => it.key.toLowerCase() == "any") == undefined) {
      tab.splice(0, 0, { key: "any", value: "Any" })
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
      crList: foundry.utils.duplicate(this.crList),
      purposeList: this.toTable(this.purposeList),
      adventureList: this.toTable(this.adventureList),
      gridList: BeneosDatabaseHolder.sortProperties(foundry.utils.duplicate(this.gridList)),

      rarity: this.toTable(this.itemRarity),
      origin: this.toTable(this.itemOrigin),
      itemType: this.toTable(this.itemType),
      tier: this.toTable(this.itemTier),
      price: BeneosDatabaseHolder.sortProperties(foundry.utils.duplicate(this.itemPrice)),

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

/********************************************************************************** */
export class BeneosSearchResults extends Dialog {

  /********************************************************************************** */
  constructor(html, launcher, data) {

    let myButtons = {
    }

    // Common conff
    let dialogConf = { content: html, title: "BENEOS CLOUD SEARCH RESULTS", buttons: myButtons }
    let pos = game?.beneosTokens?.lastResultPos || { left: 620, width: 720, height: 500 }
    console.log("Beneos Search Results - Constructor", pos, game.beneosTokens?.lastFilterStack?.resultPos)
    let dialogOptions = { classes: ["beneos_module", "beneos_search_results", "draggable"], 'window-title': "", left: pos.left, width: pos.width, height: pos.height, 'z-index': 99999 }
    super(dialogConf, dialogOptions)
  }

  /********************************************************************************** */
  processSearchButton(event, typeName, fieldName, dataName, selectorName) {
    console.log("Search button", event, typeName, fieldName, dataName, selectorName)
    let searchResults = BeneosDatabaseHolder.getAll(typeName)
    let value = $(event.currentTarget).data(dataName)
    searchResults = BeneosDatabaseHolder.searchByProperty(typeName, fieldName, value.toString(), searchResults)
    game.beneosTokens.searchEngine.displayResults(searchResults)

    game.beneosTokens.searchEngine.updatePropertiesDropDown(searchResults)
    this.removeSelectedBatchClass()

    $('#' + selectorName).val(value.toLowerCase())
  }

  /********************************************************************************** */
  removeSelectedBatchClass() {
    game.beneosTokens.searchEngine.batchInstall = {}
    $(".beneos-batch-install").removeClass("beneos-batch-install");
    document.getElementById('beneos-cloud-batch-install').hidden = true;
    // Add the beneos-item-container-hover class from all items
    $(".beneos-item-container").addClass("beneos-item-container-hover");
  }

  /********************************************************************************** */
  activateListeners(html) {

    super.activateListeners(html);

    console.log("Beneos Search Results - Activate listeners", html)

    // Gestionnaire pour CTRL+CLICK sur les éléments avec classe selected-batch
    $(html).find('.selected-batch').on('click', (event) => {
      let docType = $(event.target).parents(".beneos-search-middle").data("type");
      let key
      if (docType == "Actor") {
        key = $(event.target).parents(".token-result-section").data("token-key")
      }
      if (docType == "Spell") {
        key = $(event.target).parents(".spell-result-section").data("token-key")
      }
      if (docType == "Item") {
        key = $(event.target).parents(".item-result-section").data("token-key")
      }
      console.log("Batch install - Click on selected-batch", event, docType)

      // Vérifier si la touche CTRL est enfoncée
      if (event.ctrlKey && docType) {
        event.preventDefault();
        // Remove the beneos-item-container-hover class
        $(event.target).parents(".beneos-item-container").removeClass("beneos-item-container-hover");
        // Get token key
        let id = $(event.target).parents(".token-search-data").data("document-id")
        let parentItem = $(event.target).parents(".beneos-item-container")
        if (game.beneosTokens.searchEngine.batchInstall[key]) {
          game.beneosTokens.searchEngine.batchInstall[key] = undefined
          parentItem.removeClass("beneos-batch-install")
        } else {
          game.beneosTokens.searchEngine.batchInstall[key] = { type: docType.toLowerCase(), id: id, key: key }
          parentItem.addClass("beneos-batch-install")
        }
        // Show the Batch Install button if at least one checkbox is checked
        let anyChecked = false
        for (let idx in game.beneosTokens.searchEngine.batchInstall) {
          let asset = game.beneosTokens.searchEngine.batchInstall[idx]
          if (asset) {
            anyChecked = true
            break
          }
        }
        document.getElementById('beneos-cloud-batch-install').hidden = !anyChecked;
        console.log("Batch install - Button", anyChecked)
      } else {
        // If not CTRL, remove the batch install class
        this.removeSelectedBatchClass()
      }
    })

    $(".beneos-cloud-item-install").click(event => {
      if (!event.ctrlKey) {
        game.beneos.cloud.scrollTop = $(".bsr_result_box").scrollTop()
        // Get the data-key from the previous div and get it from the cloud
        let tokenKey = $(event.target).parents(".item-result-section").data("token-key")
        game.beneos.cloud.importItemFromCloud(tokenKey)
      }
    })
    $(".beneos-cloud-spell-install").click(event => {
      if (!event.ctrlKey) {
        game.beneos.cloud.scrollTop = $(".bsr_result_box").scrollTop()
        // Get the data-key from the previous div and get it from the cloud
        let tokenKey = $(event.target).parents(".spell-result-section").data("token-key")
        game.beneos.cloud.importSpellsFromCloud(tokenKey)
      }
    })

    $(".beneos-cloud-token-install").click(event => {
      if (!event.ctrlKey) {
        // Keep track of last scroll position
        game.beneos.cloud.scrollTop = $(".bsr_result_box").scrollTop()
        // Get the data-key from the previous div and get it from the cloud
        let tokenKey = $(event.target).parents(".token-result-section").data("token-key")
        game.beneos.cloud.importTokenFromCloud(tokenKey)
      }
    })

    $(".beneos-cloud-token-add-to-world").click(event => {
      if (!event.ctrlKey) {
        // Keep track of last scroll position
        game.beneos.cloud.scrollTop = $(".bsr_result_box").scrollTop()
        // Get the data-key from the previous div and get it from the cloud
        let tokenKey = $(event.target).parents(".token-result-section").data("token-key")
        game.beneos.cloud.addTokenToWorldFromCompendium(tokenKey)
      }
    })

    $(".token-search-data").on('dragstart', function (e) {
      let dragMode = $(e.target).data("drag-mode")
      if (dragMode == "none") {
        console.log("No drag mode", dragMode)
        return false
      }
      let id = e.target.getAttribute("data-document-id")
      let docType = e.target.getAttribute("data-type")
      console.log("DRAG START", id, docType, e)
      if (!id || id == "" || id == "") {
        console.log("Cloud - Draggable id", id)
        // Probable cloud data -> call for the token key
        if (docType == "Actor") {
          let tokenKey = $(e.target).parents(".token-result-section").data("token-key")
          game.beneos.cloud.importTokenFromCloud(tokenKey, e)
        }
        if (docType == "Item") {
          let itemKey = $(e.target).parents(".item-result-section").data("token-key")
          game.beneos.cloud.importItemFromCloud(itemKey, e)
        }
        if (docType == "Spell") {
          let spellKey = $(e.target).parents(".spell-result-section").data("token-key")
          game.beneos.cloud.importSpellsFromCloud(spellKey, e)
        }
        return false
      } else {
        let isBatch = false
        if (game.beneosTokens?.searchEngine?.batchInstall) {
          for (let idx in game.beneosTokens.searchEngine.batchInstall) {
            let token = game.beneosTokens.searchEngine.batchInstall[idx]
            if (token && token.actorId == id) {
              isBatch = true
              break
            }
          }
        }
        let compendium = ""
        if (docType == "Actor") {
          compendium = "world.beneos_module_actors"
        }
        if (docType == "Item") {
          compendium = "world.beneos_module_items"
        }
        if (docType == "Spell") {
          compendium = "world.beneos_module_spells"
          docType = "Item"
        }
        let drag_data = { "type": docType, "pack": compendium, "uuid": "Compendium." + compendium + "." + id }
        e.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(drag_data));
      }
    })

    $(".beneos-button-biom").click(event => {
      this.processSearchButton(event, "bmap", "biom", "biom-value", "bioms-selector")
    })
    $(".beneos-button-grid").click(event => {
      this.processSearchButton(event, "bmap", "grid", "grid-value", "bmap-grid")
    })
    $(".beneos-button-brightness").click(event => {
      this.processSearchButton(event, "bmap", "brightness", "brightness-value", "bmap-brightness")
    })
    $(".beneos-jump-linked").click(event => {
      let jumpKey = $(event.currentTarget).data("jump-data")
      let searchResults = BeneosDatabaseHolder.textSearch(jumpKey)
      console.log("Jump linked", jumpKey, searchResults)
      game.beneosTokens.searchEngine.displayResults(searchResults)
      //$('#beneos-search-text').val(jumpKey)
    })
    $(".beneos-button-adventure").click(event => {
      this.processSearchButton(event, "bmap", "adventure", "adventure-name", "bmap-adventure")
    })

    $(".beneos-button-cr").click(event => {
      this.processSearchButton(event, "token", "cr", "cr-value", "token-cr")
    })
    $(".beneos-button-fight").click(event => {
      this.processSearchButton(event, "token", "fightingstyle", "fight-value", "token-fight-style")
    })
    $(".beneos-button-purpose").click(event => {
      this.processSearchButton(event, "token", "purpose", "purpose-value", "token-purpose")
    })

    $(".beneos-button-origin").click(event => {
      this.processSearchButton(event, "item", "origin", "origin-value", "origin-selector")
    })
    $(".beneos-button-item_type").click(event => {
      this.processSearchButton(event, "item", "item_type", "item-type-value", "item-type")
    })
    $(".beneos-button-rarity").click(event => {
      this.processSearchButton(event, "item", "rarity", "rarity-value", "rarity-selector")
    })
    $(".beneos-button-tier").click(event => {
      this.processSearchButton(event, "item", "tier", "tier-value", "tier-selector")
    })
    $(".beneos-button-price").click(event => {
      this.processSearchButton(event, "item", "price", "price-value", "price-selector")
    })

    $(".beneos-button-level").click(event => {
      this.processSearchButton(event, "spell", "level", "level-value", "level-selector")
    })
    $(".beneos-button-school").click(event => {
      this.processSearchButton(event, "spell", "school", "school-value", "school-selector")
    })
    $(".beneos-button-class").click(event => {
      this.processSearchButton(event, "spell", "classes", "class-value", "class-selector")
    })
    $(".beneos-button-spell-type").click(event => {
      this.processSearchButton(event, "spell", "spell_type", "spell_type-value", "spell-type")
    })
    $(".beneos-button-casting").click(event => {
      this.processSearchButton(event, "spell", "casting_time", "casting_time-value", "casting_time-selector")
    })
    $(".battlemap-open-pack").click(event => {
      let bmapKey = $(event.currentTarget).data("bmap-key")
      if (bmapKey) {
        let bmapData = BeneosDatabaseHolder.getBattlemap(bmapKey)
        if (bmapData?.properties?.download_pack) {
          console.log("Open pack", bmapData.properties.download_pack)
          console.log("Cretaor", bmapData.properties.download_creator)
          game.modules.get("moulinette").api.searchUI("mou-cloud", "Map",
            {
              "creator": bmapData.properties.download_creator,
              "pack": bmapData.properties.download_pack
            })
        } else {
          ui.notifications.info("The selected battlemap does not have a Moulinette download information")
        }
      }
    })
    $(".beneos-button-moulinette").click(event => {
      let bmapKey = $(event.currentTarget).data("bmap-key")
      if (bmapKey) {
        let bmapData = BeneosDatabaseHolder.getBattlemap(bmapKey)
        if (bmapData?.properties?.download_terms) {
          console.log("Moulinette search", bmapData.properties.download_terms, bmapData.properties.download_creator, bmapData.properties.download_pack)
          game.modules.get("moulinette").api.searchUI("mou-cloud", "Map", {
            "terms": bmapData.properties.download_terms,
            "creator": bmapData.properties.download_creator,
            "pack": bmapData.properties.download_pack
          })
        } else {
          ui.notifications.info("The selected battlemap does not have a Moulinette download information")
        }
      }
    })
    $(".beneos-button-journal").click(event => {
      let element = $(event.currentTarget)?.parents(".token-root-div")
      let tokenKey = element.data("token-key")
      let tokenConfig = BeneosUtility.isTokenLoaded(tokenKey)
      if (tokenConfig?.config) {
        if (tokenConfig.config.compendium) {
          let beneosPack = game.packs.get("world.beneos_module_journal")
          if (beneosPack) {
            let beneosJournalEntry = null
            let beneosCompendiumEntry = beneosPack.index.getName(tokenConfig.config.compendium)
            if (beneosCompendiumEntry?._id) {
              beneosJournalEntry = beneosPack.getDocument(beneosCompendiumEntry._id)
            }
            if (beneosJournalEntry) {
              beneosJournalEntry.then(function (result) { result.sheet.render(true) })
            }
          }
        }
      }
    })
  }
}

/********************************************************************************** */
const __propertyDefList = {
  "grid": { name: "grid", selectors: ["bmap-grid"] },
  "biom": { name: "biom", sort: true, selectors: ["bioms-selector", "bioms-selector-2"] },
  "faction": { name: "faction", sort: true, selectors: ["faction-selector"] },
  "source": { name: "source", sort: true, selectors: ["source-selector"] },
  "campaign": { name: "campaign", sort: true, selectors: ["campaign-selector"] },
  "adventure": { name: "adventure", sort: true, selectors: ["bmap-adventure"] },
  "type": { name: "type", sort: true, selectors: ["kind-selector"] },
  "token-types": { name: "type", sort: true, selectors: ["token-types"] },
  "brightness": { name: "brightness", sort: true, selectors: ["bmap-brightness"] },
  "cr": { name: "cr", selectors: ["token-cr"] },
  "fightingstyle": { name: "fightingstyle", sort: true, selectors: ["token-fight-style"] },
  "movement": { name: "movement", sort: true, selectors: ["token-movement"] },
  "purpose": { name: "purpose", sort: true, selectors: ["token-purpose"] },
  "install": { name: "install", sort: false, selectors: ["asset-install"] },
  "origin": { name: "origin", sort: true, selectors: ["origin-selector"] },
  "item_type": { name: "item_type", sort: true, selectors: ["item-type"] },
  "rarity": { name: "rarity", sort: false, selectors: ["rarity-selector"] },
  "tier": { name: "tier", sort: true, selectors: ["tier-selector"] },
  "price": { name: "price", sort: false, selectors: ["price-selector"] },
  "level": { name: "level", sort: true, selectors: ["level-selector"] },
  "school": { name: "school", sort: true, selectors: ["school-selector"] },
  "classes": { name: "classes", sort: true, selectors: ["class-selector"] },
  "spell_type": { name: "spell_type", sort: true, selectors: ["spell-type"] },
  "casting_time": { name: "casting_time", sort: true, selectors: ["casting_time-selector"] },
  "installed": { name: "installed", sort: true, selectors: ["installation-selector"] },
}

/********************************************************************************** */
export class BeneosSearchEngine extends Dialog {

  /********************************************************************************** */
  constructor(html, data) {

    let myButtons = {
      //closeButton: { label: "Close", callback: html => this.close() }
    }

    // Common conf
    let dialogConf = { content: html, title: "Beneos Cloud", buttons: myButtons };
    let pos = game.beneosTokens?.lastFilterStack?.searchPos || { left: 200, top: 200, width: 410, height: 580 }
    let dialogOptions = { classes: ["beneos_module", "beneos_search_engine", "beneos_search_interface"], left: pos.left, width: pos.width, height: pos.height, 'z-index': 99999 }
    super(dialogConf, dialogOptions)

    this.dbData = data
    if (game.beneosTokens.lastFilterStack?.mode) {
      this.dbData.searchMode = game.beneosTokens.lastFilterStack.mode
    } else {
      this.dbData.searchMode = "token"
    }
    this.filterStack = []
    this.batchInstall = {}

    game.beneosTokens.searchEngine = this
  }

  /********************************************************************************** */
  updateFilterStack(propName, propValue) {
    for (let propKey in __propertyDefList) {
      if (__propertyDefList[propKey].name == propName &&
        this.filterStack.find((it) => it.propKey == propKey) == undefined
      ) {
        this.filterStack.push({ propKey: propKey, propValue: propValue })
      }
    }
  }

  /********************************************************************************** */
  restoreFilterStack() {
    if (game.beneosTokens.lastFilterStack) {
      // Restore the scroll position of the search results class bsr_result_box
      if (game.beneosTokens.lastFilterStack.scrollTop) {
        $(".bsr_result_box").scrollTop(game.beneosTokens.lastFilterStack.scrollTop)
      }
      let filterStack = game.beneosTokens.lastFilterStack.searchFilters || []
      if (game.beneosTokens.lastFilterStack?.textSearch && game.beneosTokens.lastFilterStack.textSearch != "") {
        $("#beneos-search-text").val(game.beneosTokens.lastFilterStack.textSearch)
        setTimeout(() => {
          game.beneosTokens.lastFilterStack.textSearch = undefined
          $("#beneos-search-text").trigger("keyup")
        }, 600)
        return false
      }

      for (let filter of filterStack) {
        let propDef = __propertyDefList[filter.propKey]
        if (propDef?.selectors?.length > 0) {
          let selector = propDef.selectors[0]
          let ret = $("#" + selector).val(filter.propValue)
          console.log("Restoring filter", filter, selector, filter.propValue, ret)
        }
      }
      game.beneosTokens.lastFilterStack = undefined
    }
    return true
  }

  /********************************************************************************** */
  saveSearchFilters() {
    let searchFilters = []
    for (let propKey in __propertyDefList) {
      let propDef = __propertyDefList[propKey]
      let selected = $("#" + propDef.selectors[0]).val()
      if (selected && selected != "any") {
        searchFilters.push({ propKey: propKey, propValue: selected })
      }
    }

    game.beneosTokens.lastFilterStack = {
      // Get the scroll position of the search results class bsr_result_box
      scrollTop: $(".bsr_result_box")?.scrollTop() || 0,
      searchPos: foundry.utils.duplicate(this.position),
      resultPos: foundry.utils.duplicate(this.resultDialog?.position || { left: 0, top: 0, width: 0, height: 0 }),
      mode: this.dbData.searchMode,
      searchFilters,
      textSearch: $("#beneos-search-text").val()
    }
    game.beneosTokens.lastResultPos = foundry.utils.duplicate(game.beneosTokens?.lastFilterStack?.resultPos)
  }

  /********************************************************************************** */
  close() {
    if (this.resultDialog) {

      this.resultDialog.close()
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = undefined
    }
    super.close()
    game.beneosTokens.searchEngine = undefined
  }

  /********************************************************************************** */
  updatePropertiesDropDown(searchResults) {
    for (let propKey in __propertyDefList) {
      let propDef = __propertyDefList[propKey]
      let properties = []
      let toSearch = searchResults

      if (this.filterStack.length == 1 && this.filterStack[0].propKey == propKey) {
        //console.log("Full list for", propKey, this.filterStack)
        toSearch = BeneosDatabaseHolder.getAll(this.dbData.searchMode)
      }

      if (propKey == "installed") {
        properties = [{ key: "installed", value: "Installed" }, { key: "notinstalled", value: "Not Installed" }, { key: "cloudavailable", value: "Cloud Available" }]
      }

      for (let key in toSearch) {
        let item = toSearch[key]
        if (item.properties?.[propDef.name]) {
          if (propDef.name.toLowerCase() == "rarity") {
            properties = foundry.utils.duplicate(BeneosDatabaseHolder.itemRarity)
          } else if (propDef.name.toLowerCase() == "price") {
            properties = foundry.utils.duplicate(BeneosDatabaseHolder.itemPrice)
          } else if (propDef.name.toLowerCase() == "grid") {
            properties = foundry.utils.duplicate(BeneosDatabaseHolder.gridList)
          } else if (propDef.name.toLowerCase() == "tier") {
            properties = foundry.utils.duplicate(BeneosDatabaseHolder.itemTier)
          } else if (propDef.name.toLowerCase() == "cr") {
            properties = foundry.utils.duplicate(BeneosDatabaseHolder.crList)
          } else if (typeof (item.properties[propDef.name]) == "string") {
            if (properties.find((prop) => prop.key == item.properties[propDef.name].toLowerCase()) == undefined) {
              properties.push({ key: item.properties[propDef.name].toLowerCase(), value: item.properties[propDef.name] })
            }
          } else if (Array.isArray(item.properties[propDef.name])) {
            for (let prop of item.properties[propDef.name]) {
              if (properties.find((propi) => propi.key == prop.toLowerCase()) == undefined) {
                properties.push({ key: prop.toLowerCase(), value: prop })
              }
            }
          }
        }
      }

      if (propDef.sort) {
        BeneosDatabaseHolder.sortProperties(properties)
      }
      // Check if properties is an array
      if (!Array.isArray(properties)) {
        // Convert to an array
        properties = Object.keys(properties).map(key => ({ key: key, value: properties[key] }))
      }
      let html = ""
      if (properties.find(it => it.key.toLowerCase() == "any") === undefined) {
        html += "<option value='any'>Any</option>"
      }
      for (let propDef of properties) {
        if ( propDef.value.length > 1) {
          html += "<option value='" + propDef.key + "'>" + propDef.value.charAt(0).toUpperCase() + propDef.value.slice(1) + "</option>"
        } else {
          html += "<option value='" + propDef.key + "'>" + propDef.value + "</option>"
        }
      }
      for (let selector of propDef.selectors) {
        let selected = $("#" + selector).val()
        selected = (selected) ? selected.toLowerCase() : "any"
        if (selected && !properties.find(it => it.key.toLowerCase() == selected.toLowerCase())) {
          html += "<option value='" + selected + "'>" + selected.charAt(0).toUpperCase() + selected.slice(1) + "</option>"
        }
        $("#" + selector).html(html)
        $("#" + selector).val(selected)
      }
    }
  }

  /********************************************************************************** */
  async displayResults(results, event = undefined) {
    let searchSize = Object.keys(results).length
    let resTab = []
    if (searchSize == 0) {
      resTab.push({ name: "No results" })
      let template = 'modules/beneos-module/templates/beneos-search-no-result.html'
      let response = await fetch(template)
      let content = await response.text()
      let templateObj = Handlebars.compile(content)
      let html = templateObj({})
      $('#display-result-section').html(html)
      return
    }

    console.log("SEARCH results", searchSize, results, this.dbData.searchMode)

    // Compare length of results and fullResults
    let fullResults = BeneosDatabaseHolder.getAll(this.dbData.searchMode)
    let isFiltered = Object.keys(fullResults).length != Object.keys(results).length

    // If less than 100 results, display the full list
    let template
    if (this.dbData.searchMode == "token") {
      template = 'modules/beneos-module/templates/beneos-search-results-tokens.html'
    }
    if (this.dbData.searchMode == "item") {
      template = 'modules/beneos-module/templates/beneos-search-results-items.html'
    }
    if (this.dbData.searchMode == "spell") {
      template = 'modules/beneos-module/templates/beneos-search-results-spells.html'
    }
    if (this.dbData.searchMode == "bmap") {
      template = 'modules/beneos-module/templates/beneos-search-results-battlemaps.html'
    }

    // Always display New/Updated in top of the resulting search list, cf ticket#165
    // First push the results with the isUpdate property
    let count = 0
    let resTab2 = []
    let resTab3 = []
    for (let key in results) {
      if (results[key].isUpdate) {
        resTab.push(results[key])
        count++;
      }
    }
    // Then push the results with the isNew property
    for (let key in results) {
      if (results[key].isNew) {
        resTab.push(results[key])
        count++;
      }
    }
    // Then push remaining ones
    for (let key in results) {
      if (!results[key].isUpdate && !results[key].isNew && (results[key].isInstallable || results[key].isInstalled)) {
        resTab2.push(results[key])
      } else if (!results[key].isInstallable) {
        resTab3.push(results[key])
      }
      count++;
      if (count > 100) {
        break
      }
    }

    // Sort the final results
    resTab2.sort(function (a, b) { return a.name.trim().localeCompare(b.name.trim()) })
    resTab3.sort(function (a, b) { return a.name.trim().localeCompare(b.name.trim()) })
    // then merge resTab and resTab2
    for (let key in resTab2) {
      resTab.push(resTab2[key])
    }
    for (let key in resTab3) {
      resTab.push(resTab3[key])
    }
    console.log("Final results", resTab)

    let html = await foundry.applications.handlebars.renderTemplate(template, {
      results: resTab,
      isOffline: BeneosDatabaseHolder.getIsOffline(),
      isCloudLoggedIn: game.beneos.cloud.isLoggedIn(),
      isMoulinette: false // Up to now
    })
    if (!this.resultDialog) {
      this.resultDialog = new BeneosSearchResults(html, this, resTab)
    } else {
      this.resultDialog.data.content = html
    }

    // Keep track for batch install
    this.latestResults = results

    if (searchSize > 100) {
      $('#beneos-search-overflow').html("Only the first 100 results are shown. Please use filters to narrow your search.")
    } else {
      $('#beneos-search-overflow').html("")
    }

    // Reset by default
    $(".install-batch-button-new").attr("hidden", true);
    $(".install-batch-button-updated").attr("hidden", true);
    $(".install-batch-button-all").attr("hidden", true);

    // Get  the value of the asset-install selector and uupdatt relevant buttons
    let installMode = $("#asset-install").val()
    if (installMode && installMode == "new") {
      $(".install-batch-button-new").attr("hidden", false);
    }
    if (installMode && installMode == "updated") {
      $(".install-batch-button-updated").attr("hidden", false);
    }
    if (installMode && installMode == "all") {
      $(".install-batch-button-all").attr("hidden", false);
    }

    this.resultDialog.render(true)
  }

  /********************************************************************************** */
  checkTextField() {
    let value = $("#beneos-search-text").val()
    if (!value || value.length === 0) {
      clearInterval(this.checkInterval)
      this.checkInterval = undefined
      this.searchText = undefined
      let results = BeneosDatabaseHolder.getAll(this.dbData.searchMode)
      console.log("Clearing text search", results)
      this.displayResults(results)
    }
  }

  /********************************************************************************** */
  processTextSearch(event) {
    console.log("Processing text search", event)
    let code = event.keyCode ? event.keyCode : event.which
    if (code == 13) {  // Enter keycode
      return
    }
    if (event.currentTarget.value && event.currentTarget.value.length >= 3) {
      let results = BeneosDatabaseHolder.textSearch(event.currentTarget.value, this.dbData.searchMode)
      this.searchText = event.currentTarget.value
      this.displayResults(results, event)
      this?.resultDialog?.removeSelectedBatchClass()
      if (!this.checkInterval) {
        let myObject = this
        this.checkInterval = setInterval(function () { myObject.checkTextField() }, 500)
      }
    }
  }

  /********************************************************************************** */
  async updateContent() {
    // Update the content of the dialog
    let html = await foundry.applications.handlebars.renderTemplate('modules/beneos-module/templates/beneossearchengine.html', this.dbData)
    this.data.content = html
    this.render(true)
  }

  /********************************************************************************** */
  processSelectorSearch() {
    if (!this.restoreFilterStack()) {
      return
    }

    let type = this.dbData.searchMode
    let searchResults = BeneosDatabaseHolder.getAll(type)

    for (let propKey in __propertyDefList) {
      let propDef = __propertyDefList[propKey]
      for (let selector of propDef.selectors) {
        let value = $("#" + selector).val()
        if (value && value.toLowerCase() != "any") {
          if (!this.filterStack.find((it) => String(it.propKey) == String(propKey))) {
            this.filterStack.push({ propKey: propKey, value: value })
          }
          searchResults = BeneosDatabaseHolder.searchByProperty(type, propDef.name, value, searchResults)
        } else if (value && value.toLowerCase() == "any") {
          this.filterStack = this.filterStack.filter((it) => it.propKey != propKey)
        }
      }
    }

    // Save the search filters
    this.displayResults(searchResults)

    if (game.beneos.cloud.scrollTop) {
      setTimeout(() => {
        $(".bsr_result_box").scrollTop(game.beneos.cloud.scrollTop)
        game.beneos.cloud.scrollTop = undefined
      }, 200)
    }

    let myObject = this
    // Refresh the dialog selectors
    setTimeout(() => {
      game.beneosTokens.searchEngine.updatePropertiesDropDown(searchResults);
      myObject.resultDialog.removeSelectedBatchClass()
      if (game.beneos.cloud.isLoggedIn()) {
        let patreonStatus = game.beneos.cloud.getPatreonStatus()
        if ( patreonStatus == "active_patron" ) {
          $(".beneos_search_engine .window-header .window-title").html('<span class="beneos-window-title-green">Beneos Cloud - Connected - Patreon OK</span>');
        } else {
          $(".beneos_search_engine .window-header .window-title").html('<span class="beneos-window-title-orange">Beneos Cloud - Connected - Patreon NOK</span>');
        }
      } else {
        $(".beneos_search_engine .window-header .window-title").html("Beneos Cloud");
      }
    }, 400)
  }

  /********************************************************************************** */
  updateSelector(event) {
    let myObject = this

    clearTimeout(myObject.timeout)
    myObject.timeout = setTimeout(function () {
      console.log("Processing update selector search", event)
      myObject.processSelectorSearch(event)
    }, 800)
  }

  /********************************************************************************** */
  cleanFilters() {
    console.log("Cleaning filters")

    $("#bioms-selector").val("any")
    $("#bmap-grid").val("any")
    $("#bmap-brightness").val("any")
    $('#bmap-adventure').val("any")
    $("#token-cr").val("any")
    $('#token-fight-style').val("any")
    $("#token-purpose").val("any")
    $("#asset-install").val("any")

    $("#rarity-selector").val("any")
    $("#item-type").val("any")
    $("#origin-selector").val("any")
    $("#price-selector").val("any")
    $("#tier-selector").val("any")

    $("#spell-type").val("any")
    $("#school-selector").val("any")
    $("#class-selector").val("any")
    $("#level-selector").val("any")
    $("#castingtime-selector").val("any")
  }

  /********************************************************************************** */
  processBatchInstall(installMode) {
    // Display warning message in a Dialog to ensure the user is aware of the batch install
    // Get the number of assets to install
    let assetNum = 0
    for (let key in this.latestResults) {
      let r = this.latestResults[key]
      if (r.isInstallable) {
        assetNum++
      }
    }
    let message = `<H2>WARNING ! </H2><p>You are about to install ${assetNum} assets.</p>`
    message += "<p>Please note that this will overwrite any existing assets with the same name.<br></p>"
    message += "<p>Note also that the download process of all assets can take a significant amount of time.</p>"
    message += "<p>Do you want to proceed with this batch install?</p>"
    let buttons = {
      yes: {
        label: "Yes",
        callback: () => {
          this.executeBatchInstall(installMode)
        }
      },
      no: {
        label: "No",
        callback: () => {
          // Do nothing
        }
      }
    }
    let dialogOptions = { classes: ["beneos_module", "beneos_search_engine", "beneos_search_interface"], left: 200, width: 410, 'z-index': 99999 }
    let dialogConf = { title: "Batch Install", content: message, buttons: buttons }
    let dialog = new Dialog(dialogConf, dialogOptions)
    dialog.render(true)
    // Hide the Batch Install button
    document.getElementById('beneos-cloud-batch-install').hidden = true
    $(".check-token-batch-install").prop("checked", false)
  }

  /********************************************************************************** */
  executeBatchInstall(installMode) {
    let batchInstall = {}
    if (installMode == "install-new") {
      for (let key in this.latestResults) {
        let r = this.latestResults[key]
        if (r.isNew) {
          batchInstall[r.key] = { type: this.dbData.searchMode, key: r.key }
        }
      }
    }
    if (installMode == "install-updated") {
      for (let key in this.latestResults) {
        let r = this.latestResults[key]
        if (r.isUpdate) {
          batchInstall[r.key] = { type: this.dbData.searchMode, key: r.key }
        }
      }
    }
    if (installMode == "install-all") {
      for (let key in this.latestResults) {
        let r = this.latestResults[key]
        if (r.isInstallable) {
          batchInstall[r.key] = { type: this.dbData.searchMode, key: r.key }
        }
      }
    }
    console.log("Batch install", installMode, batchInstall)
    game.beneos.cloud.setNoWorldImport(true)
    game.beneos.cloud.batchInstall(batchInstall)
  }

  /********************************************************************************** */
  activateListeners() {

    let myObject = this

    $('#beneos-search-text').bind("enterKey", function (event) {
      let key = event.keyCode ? event.keyCode : event.which
      if (key == 13) {
        //console.log("HERE KEYDOWN 13 - 2!!!!")
        event.preventDefault()
      }
    });
    $('#beneos-search-form').keydown(function (event) {
      let key = event.keyCode ? event.keyCode : event.which
      if (key == 13) {
        event.preventDefault()
        //console.log("HERE KEYDOWN 13 - 2!!!!")
      }
    });
    $("#beneos-search-text").keyup(event => {
      let code = event.keyCode ? event.keyCode : event.which
      if (code == 13) {  // Enter keycode
        event.preventDefault()
        //console.log("HERE 13!!!!")
        return
      }
      clearTimeout(myObject.timeout)
      myObject.timeout = setTimeout(function () {
        myObject.processTextSearch(event)
      }, 600)
    })
    $("#beneos-radio-token").click(event => {
      // Retirer la classe active des autres boutons si besoin
      $('.beneos-search-button').removeClass('category-active');
      // Ajouter la classe active à ce bouton
      this.dbData.searchMode = "token"
      this.updateContent()
      this.updateSelector(event)
      $("#beneos-radio-token").addClass('category-active')
    })

    $("#beneos-radio-bmap").click(event => {
      // Retirer la classe active des autres boutons si besoin
      $('.beneos-search-button').removeClass('category-active');
      // Ajouter la classe active à ce bouton
      $("#beneos-radio-bmap").addClass('category-active')
      this.dbData.searchMode = "bmap"
      this.updateContent()
      this.updateSelector(event)
    })
    $("#beneos-radio-spell").click(event => {
      // Retirer la classe active des autres boutons si besoin
      $('.beneos-search-button').removeClass('category-active');
      // Ajouter la classe active à ce bouton
      $("#beneos-radio-spell").addClass('category-active')
      this.dbData.searchMode = "spell"
      this.updateContent()
      this.updateSelector(event)
    })
    $("#beneos-radio-item").click(event => {
      // Retirer la classe active des autres boutons si besoin
      $('.beneos-search-button').removeClass('category-active');
      // Ajouter la classe active à ce bouton
      $("#beneos-radio-item").addClass('category-active')
      this.dbData.searchMode = "item"
      this.updateContent()
      this.updateSelector(event)
    })

    $("#reset-search-list").click(event => {
      console.log("Resetting search list")
      let type = this.dbData.searchMode
      this.cleanFilters()
      let searchResults = BeneosDatabaseHolder.getAll(type)
      this.displayResults(searchResults)
    })

    $(".beneos-selector").change(event => {
      this.updateSelector(event)
    })

    $("#beneos-cloud-settings").click(event => {
      // Open the Beneos Cloud settings dialog
      BeneosUtility.openPostInNewTab('https://beneos.cloud/', {});
    })

    $("#beneos-cloud-create-account").click(event => {
      BeneosUtility.openPostInNewTab('https://beneos.cloud/', { 'request-register': 1 });
    })

    $("#beneos-cloud-login").click(event => {
      let loginData = {
        email: $("#beneos-cloud-email").val(),
        password: $("#beneos-cloud-password").val(),
      }
      let login = new BeneosCloudLogin("searchEngine")
      login.render(loginData)
    })

    $("#beneos-cloud-batch-install").click(event => {
      console.log("Processing batch install", game.beneosTokens.searchEngine.batchInstall)
      game.beneos.cloud.batchInstall(foundry.utils.duplicate(game.beneosTokens.searchEngine.batchInstall))
      game.beneosTokens.searchEngine.batchInstall = {}
      // Hide the Batch Install button
      document.getElementById('beneos-cloud-batch-install').hidden = true
      $(".check-token-batch-install").prop("checked", false)
    })

    $(".install-batch-button").click(event => {
      // Get the install-mode
      let installMode = $(event.currentTarget).data("install-mode")
      this.processBatchInstall(installMode)
    })
  }
}

/********************************************************************************** */
export class BeneosSearchEngineLauncher extends FormApplication {

  /********************************************************************************** */
  static refresh(typeAsset, key) {
    if (!game.beneos.searchEngine) {
      return
    }
    if (typeAsset == "token") {
      let tokenData = BeneosDatabaseHolder.tokenData.content[key]
      if (tokenData) {
        BeneosDatabaseHolder.processInstalledToken(tokenData)
      } else {
        console.log("No token data found for", key)
      }
    } else if (typeAsset == "item") {
      // If the key has (numbers)-, then replace it with a underscore
      if (/^\d+-/.test(key)) {
        key = key.replace(/^(\d+)-/, '$1_');
      }
      let itemData = BeneosDatabaseHolder.itemData.content[key]
      if (itemData) {
        BeneosDatabaseHolder.processInstalledItem(itemData)
      } else {
        console.log("No item data found for", key)
      }
    }
    else if (typeAsset == "spell") {
      // If the key has (numbers)-, then replace it with a underscore
      if (/^\d+-/.test(key)) {
        key = key.replace(/^(\d+)-/, '$1_');
      }
      // If the key has (numbers)-, then replace it with a underscore
      let spellData = BeneosDatabaseHolder.spellData.content[key]
      if (spellData) {
        BeneosDatabaseHolder.processInstalledSpell(spellData)
      } else {
        console.log("No spell data found for", key)
      }
    }
    else if (typeAsset == "bmap") {
      let bmapData = BeneosDatabaseHolder.bmapData.content[key]
      if (bmapData) {
        BeneosDatabaseHolder.processInstalledBattlemap(bmapData)
      } else {
        console.log("No battlemap data found for", key)
      }
    }
  }

  /********************************************************************************** */
  static closeAndSave() {
    if (game.beneos.searchEngine) {
      game.beneos.searchEngine.saveSearchFilters()
      game.beneos.searchEngine.close()
      game.beneos.searchEngine = undefined
      game.beneos.selectTid = undefined
    }
  }

  /********************************************************************************** */
  async render(installed = undefined) {
    if (game.beneosTokens.searchEngine) {
      return
    }
    await BeneosDatabaseHolder.loadDatabaseFiles()
    let dbData = BeneosDatabaseHolder.getData()

    let html = await foundry.applications.handlebars.renderTemplate('modules/beneos-module/templates/beneossearchengine.html', dbData)
    let searchDialog = new BeneosSearchEngine(html, dbData)
    game.beneos.searchEngine = searchDialog
    game.beneos.databaseHolder = BeneosDatabaseHolder

    await searchDialog.render(true)
    if (installed) {
      console.log("Refresh with installed", installed)
    }
    if (game.beneos.info) {
      game.beneos.info.hide()
      game.beneos.info = undefined
    }
    game.beneos.selectTid = setTimeout(() => { searchDialog.processSelectorSearch() }, 200)
  }

}
