import { BeneosUtility } from "./beneos_utility.js"

/********************************************************************************** */
const tokenDBURL = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/tokens/beneos_tokens_database.json"
const battlemapDBURL = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/battlemaps/beneos_battlemaps_database.json"
const itemDBURL = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/items/beneos_items_database.json"
const spellDBURL = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/spells/beneos_spells_database.json"
const commonDBURL = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/common/beneos_common_database.json"

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
    let html = await renderTemplate('modules/beneos_module/templates/' + this.listTemplate,
      { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getBeneosModuleDataPath(), beneosTokensHUD, searchValue })
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
      let actorId = $(event.currentTarget).data("actor-id")

      const pack = game.packs.get(BeneosUtility.getActorCompendium()) // find that key by doing game.packs.keys(); in the console.
      const myActor = await pack.getDocument(actorId)
      //console.log(">>>>>> ACTOR", actorId, myActor, myObject.actor)
      await myObject.actor.update({ 'img': myActor.img })
      if (myObject.actor.token) {
        await myObject.actor.token.update({ texture: { src: myActor.prototypeToken.texture.src } })
        await myObject.actor.prototypeToken.update({ texture: { src: myActor.prototypeToken.texture.src } })
      } else {
        await myObject.actor.prototypeToken.update({ texture: { src: myActor.prototypeToken.texture.src } })
      }
      myObject.close()
    })
  }
}

/********************************************************************************** */
export class BeneosDatabaseHolder {

  /********************************************************************************** */
  static async loadDatabaseFiles() {
    try {
      let tokenData = await fetchJsonWithTimeout(tokenDBURL)
      this.tokenData = tokenData
    } catch {
      ui.notifications.error("Unable to load Beneos Token Database - File error")
    }
    try {
      let bmapData = await fetchJsonWithTimeout(battlemapDBURL)
      this.bmapData = bmapData
    } catch {
      ui.notifications.error("Unable to load Beneos Battlemap Database - File error")
    }
    try {
      let itemData = await fetchJsonWithTimeout(itemDBURL)
      this.itemData = itemData
    } catch {
      ui.notifications.error("Unable to load Beneos Item Database - File error")
    }
    try {
      let spellData = await fetchJsonWithTimeout(spellDBURL)
      this.spellData = spellData
    } catch {
      ui.notifications.error("Unable to load Beneos Spell Database - File error")
    }
    try {
      let commonData = await fetchJsonWithTimeout(commonDBURL)
      this.commonData = commonData
    } catch {
      ui.notifications.error("Unable to load Beneos Common Database - File error")
    }

    this.buildSearchData()
  }

  /********************************************************************************** */
  static getHover(category, term) {
    category = category.toString().toLowerCase()
    term = term.toString().toLowerCase()
    if (this.commonData?.hover[category] && this.commonData.hover[category][term]?.message) {
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
  static buildSearchData() {
    this.tokenTypes = {}
    this.tokenBioms = {}
    this.bmapBioms = {}
    this.fightingStyles = {}
    this.bmapBrightness = {}
    this.crList = {}
    this.movementList = {}
    this.purposeList = {}
    this.gridList = {}
    this.adventureList = {}
    this.itemRarity = {}
    this.itemOrigin = {}
    this.itemType = {}
    this.itemTier = {}
    this.itemPrice = {}
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
        tokenData.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/tokens/thumbnails/" + key + "-idle_face_still.webp"
        mergeObject(this.tokenBioms, this.buildList(tokenData.properties.biom))
        mergeObject(this.tokenTypes, this.buildList(tokenData.properties.type))
        mergeObject(this.fightingStyles, this.buildList(tokenData.properties.fightingstyle))
        mergeObject(this.crList, this.buildList(tokenData.properties.cr))
        mergeObject(this.movementList, this.buildList(tokenData.properties.movement))
        mergeObject(this.purposeList, this.buildList(tokenData.properties.purpose))
        tokenData.isInstalled = BeneosUtility.isTokenLoaded(key)
        tokenData.installed = (tokenData.isInstalled) ? "installed" : "notinstalled"
        tokenData.actorId = BeneosUtility.getActorId(key)
        //tokenData.description = tokenData.description
      }
    }
    for (let key in this.bmapData.content) {
      let bmapData = this.bmapData.content[key]
      if (bmapData && typeof (bmapData) == "object") {
        bmapData.kind = "battlemap"
        bmapData.key = key
        bmapData.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/battlemaps/thumbnails/" + bmapData.properties.thumbnail
        mergeObject(this.bmapBrightness, this.buildList(bmapData.properties.brightness))
        mergeObject(this.bmapBioms, this.buildList(bmapData.properties.biom))
        mergeObject(this.adventureList, this.buildList(bmapData.properties.adventure))
        mergeObject(this.gridList, this.buildList(bmapData.properties.grid))
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
      250
      let itemData = this.itemData.content[key]
      if (itemData && typeof (itemData) == "object") {
        itemData.kind = "item"
        itemData.key = key
        itemData.path_name = itemData.name.replace(/ /g, "_").toLowerCase()
        itemData.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/items/thumbnails/" + itemData.properties.icon
        mergeObject(this.itemRarity, this.buildList(itemData.properties.rarity))
        mergeObject(this.itemOrigin, this.buildList(itemData.properties.origin))
        mergeObject(this.itemType, this.buildList(itemData.properties.item_type))
        mergeObject(this.itemTier, this.buildList(itemData.properties.tier))
        mergeObject(this.itemPrice, this.buildList(itemData.properties.price))
        itemData.isInstalled = BeneosUtility.isItemLoaded(key)
        itemData.installed = (itemData.isInstalled) ? "installed" : "notinstalled"
        if (itemData.isInstalled) {
          itemData.itemId = BeneosUtility.getItemId(key)
          itemData.card_front = BeneosUtility.getBeneosItemDataPath() + "/" + key + "/" + itemData.path_name + "-front.webp"
          itemData.card_back = BeneosUtility.getBeneosItemDataPath() + "/" + key + "/" + itemData.path_name + "-back.webp"
        }
      }
    }

    for (let key in this.spellData.content) {
      let spellData = this.spellData.content[key]
      if (spellData && typeof (spellData) == "object") {
        spellData.kind = "spell"
        spellData.key = key
        spellData.path_name = spellData.name.replace(/ /g, "_").toLowerCase()
        spellData.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/spells/thumbnails/" + spellData.properties.icon
        mergeObject(this.spellLevel, this.buildList(spellData.properties.level))
        mergeObject(this.spellSchool, this.buildList(spellData.properties.school))
        mergeObject(this.spellCastingTime, this.buildList(spellData.properties.casting_time))
        mergeObject(this.spellType, this.buildList(String(spellData.properties.spell_type)))
        mergeObject(this.spellClasses, this.buildList(spellData.properties.classes))
        spellData.isInstalled = BeneosUtility.isSpellLoaded(key)
        spellData.installed = (spellData.isInstalled) ? "installed" : "notinstalled"
        if (spellData.isInstalled) {
          spellData.spellId = BeneosUtility.getSpellId(key)
          spellData.card_front = BeneosUtility.getBeneosSpellDataPath() + "/" + key + "/" + spellData.path_name + "-front.webp"
          spellData.card_back = BeneosUtility.getBeneosSpellDataPath() + "/" + "spell_card_back.webp"
        }
      }
    }
    // Double pass to setup siblingPicture


  }

  /********************************************************************************** */
  static fieldTextSearch(item, text) {
    for (let field in item) {
      let value = item[field]
      if (typeof (value) == "string") {
        if (value.toLowerCase().includes(text)) {
          return true
        }
      } else if (Array.isArray(value)) {
        for (let arrayValue of value) {
          if (typeof (arrayValue) == "string" && arrayValue.toLowerCase().includes(text)) {
            return true
          }
        }
      }
    }
    return false
  }

  /********************************************************************************** */
  static getTagDescriptions() {
    return duplicate(this.tokenData.tag_description)
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
      let item = duplicate(objectList[key])
      item.kind = (kind == "token") ? "token" : item.properties.type
      if (item.kind == "token") {
        item.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/tokens/thumbnails/" + item.key + "-idle_face_still.webp"
      } else {
        item.kind = "battlemap"
        item.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/battlemaps/thumbnails/" + item.key + ".webp"
      }
      if (this.fieldTextSearch(item, text) || this.fieldTextSearch(item.properties, text)) {
        results.push(item)
      }
    }
    return results
  }

  /********************************************************************************** */
  static textSearch(text, mode) {

    let results = []
    if (mode == "token") {
      results = this.objectTextSearch(this.tokenData.content, text, "token")
    }
    if (mode == "bmap") {
      results = results.concat(this.objectTextSearch(this.bmapData.content, text, "bmap"))
    }
    if (mode == "item") {
      results = results.concat(this.objectTextSearch(this.bmapData.content, text, "item"))
    }
    if (mode == "spell") {
      results = results.concat(this.objectTextSearch(this.bmapData.content, text, "spell"))
    }

    //console.log("TEXT results ", results, this.bmapData.content)
    return results
  }

  /********************************************************************************** */
  static getSiblingPicture(key) {
    let sibling = this.bmapData.content[key]
    if (sibling) {
      return sibling.picture
    }
    console.log("No relevant sibling picture found for", key)
    return undefined
  }

  /********************************************************************************** */
  static searchByProperty(type, propertyName, value, searchResults, strict = false) {
    let newResults = {}
    value = value.toLowerCase()

    //console.log(">>>>>", type, propertyName, value, searchResults)

    for (let key in searchResults) {
      let item = searchResults[key]
      item.kind = type
      if (type == "bmap" || type == "battlemap") {
        item.kind = "battlemap"
        item.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/battlemaps/thumbnails/" + item.key + ".webp"
        if (item.properties.sibling) {
          item.siblingPicture = this.getSiblingPicture(item.properties.sibling)
        }
      }
      if (item.kind == "token") {
        item.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/tokens/thumbnails/" + item.key + "-idle_face_still.webp"
      }
      if (item[propertyName]) {
        if (item[propertyName].toLowerCase() == value) {
          newResults[key] = duplicate(item)
        }
      }
      if (item.properties && item.properties[propertyName]) {
        //console.log(item.properties[propertyName], typeof (item.properties[propertyName]))
        if (typeof (item.properties[propertyName]) == "string" || typeof (item.properties[propertyName]) == "number") {
          if (strict) {
            if (item.properties[propertyName].toString().toLowerCase() == value.toString()) {
              newResults[key] = duplicate(item)
            }
          } else {
            if (item.properties[propertyName].toString().toLowerCase().includes(value)) {
              newResults[key] = duplicate(item)
            }
          }
        } else {
          if (Array.isArray(item.properties[propertyName])) {
            for (let valueArray of item.properties[propertyName]) {
              if ((typeof (valueArray) == "string") && valueArray.toString().toLowerCase().includes(value)) {
                newResults[key] = duplicate(item)
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
      return duplicate(this.tokenData.content)
    }
    if (type == "item") {
      return duplicate(this.itemData.content)
    }
    if (type == "spell") {
      return duplicate(this.spellData.content)
    }
    return duplicate(this.bmapData.content)
  }

  /********************************************************************************** */
  static toTable(object, sort = true) {
    let tab = []
    for (let key in object) {
      tab.push(key)
    }
    return (sort) ? tab.sort() : tab
  }

  /********************************************************************************** */
  static getData() {
    return {
      searchMode: "token",

      tokenBioms: this.toTable(this.tokenBioms),
      bmapBioms: this.toTable(this.bmapBioms),
      tokenTypes: this.toTable(this.tokenTypes),
      fightingStyles: this.toTable(this.fightingStyles),
      bmapBrightness: this.toTable(this.bmapBrightness),
      movementList: this.toTable(this.movementList),
      crList: this.toTable(this.crList, false),
      purposeList: this.toTable(this.purposeList),
      adventureList: this.toTable(this.adventureList),
      gridList: this.toTable(this.gridList),

      rarity: this.toTable(this.itemRarity),
      origin: this.toTable(this.itemOrigin),
      itemType: this.toTable(this.itemType),
      tier: this.toTable(this.itemTier),
      price: this.toTable(this.itemPrice),

      level: this.toTable(this.spellLevel),
      school: this.toTable(this.spellSchool),
      castingTime: this.toTable(this.spellCastingTime),
      spellType: this.toTable(this.spellType),
      spellClass: this.toTable(this.spellClasses),

    }
  }
}

/********************************************************************************** */
export class BeneosSearchResults extends Dialog {

  /********************************************************************************** */
  constructor(html, launcher, data) {

    let myButtons = {
    }

    // Common conf
    let dialogConf = { content: html, title: "BENEOS SEARCH ENGINE", buttons: myButtons }
    let dialogOptions = { classes: ["beneos_module", "beneos_search_results", "draggable"], 'window-title': "", left: 620, width: 720, height: 580, 'z-index': 99999 }
    super(dialogConf, dialogOptions)
  }

  /********************************************************************************** */
  processSearchButton(event, typeName, fieldName, dataName, selectorName) {
    let searchResults = BeneosDatabaseHolder.getAll(typeName)
    let value = $(event.currentTarget).data(dataName)
    searchResults = BeneosDatabaseHolder.searchByProperty(typeName, fieldName, value.toString(), searchResults)
    game.beneosTokens.searchEngine.displayResults(searchResults)
    $('#' + selectorName).val(value)
  }
  /********************************************************************************** */
  activateListeners() {

    $(".token-search-data").on('dragstart', function (e) {
      let id = e.target.getAttribute("data-document-id")
      let docType = e.target.getAttribute("data-type")
      let compendium = ""
      if (docType == "Actor") {
        compendium = (game.system.id == "pf2e") ? "beneos_module.beneos_module_actors_pf2" : "beneos_module.beneos_module_actors"
      }
      if (docType == "Item") {
        compendium = "beneos_module.beneos_module_items"
      }
      if (docType == "Spell") {
        compendium = "beneos_module.beneos_module_spells"
        docType = "Item"
      }
      let drag_data = { "type": docType, "pack": compendium, "uuid": "Compendium." + compendium + "." + id }
      //console.log("DRAGDARA", drag_data)
      e.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(drag_data));
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

    $(".beneos-button-journal").click(event => {
      let element = $(event.currentTarget)?.parents(".token-root-div")
      let tokenKey = element.data("token-key")
      let tokenConfig = BeneosUtility.isTokenLoaded(tokenKey)
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
              beneosJournalEntry.then(function (result) { result.sheet.render(true) })
            }
          }
        }
      }
    })
  }
}

/********************************************************************************** */
export class BeneosSearchEngine extends Dialog {

  /********************************************************************************** */
  constructor(html, data) {

    let myButtons = {
      //closeButton: { label: "Close", callback: html => this.close() }
    }

    // Common conf
    let dialogConf = { content: html, title: "Beneos Search Engine", buttons: myButtons };
    let dialogOptions = { classes: ["beneos_module", "beneos_search_engine"], left: 200, width: 400, height: 420, 'z-index': 99999 }
    super(dialogConf, dialogOptions)

    this.dbData = data
    this.dbData.searchMode = "token"

    game.beneosTokens.searchEngine = this
  }

  /********************************************************************************** */
  close() {
    if (this.resultDialog) {
      this.resultDialog.close()
    }
    super.close()
    game.beneosTokens.searchEngine = undefined
  }


  /********************************************************************************** */
  async displayResults(results, event = undefined) {
    if (results.length == 0) {
      results.push({ name: "No results" })
    }

    console.log("SEARCH results", results, this.dbData.searchMode)

    let template = 'modules/beneos_module/templates/beneossearchresults.html'
    if (this.dbData.searchMode == "token") {
      template = 'modules/beneos_module/templates/beneos-search-results-tokens.html'
    }
    if (this.dbData.searchMode == "item") {
      template = 'modules/beneos_module/templates/beneos-search-results-items.html'
    }
    if (this.dbData.searchMode == "spell") {
      template = 'modules/beneos_module/templates/beneos-search-results-spells.html'
    }
    if (this.dbData.searchMode == "bmap") {
      template = 'modules/beneos_module/templates/beneos-search-results-battlemaps.html'
    }
    // Sort alpha
    let resTab = []
    for (let key in results) {
      resTab.push(results[key])
    }
    resTab.sort(function (a, b) { return a.name.localeCompare(b.name) })

    let html = await renderTemplate(template, {
      results: resTab,
      isMoulinette: false // Up to now
    })
    if (!this.resultDialog) {
      this.resultDialog = new BeneosSearchResults(html, this, results)
    } else {
      this.resultDialog.data.content = html
    }
    this.resultDialog.render(true)
  }

  /********************************************************************************** */
  processTextSearch(event) {
    let code = event.keyCode ? event.keyCode : event.which
    if (code == 13) {  // Enter keycode
      return
    }
    if (event.currentTarget.value && event.currentTarget.value.length >= 3) {
      let results = BeneosDatabaseHolder.textSearch(event.currentTarget.value, this.dbData.searchMode)

      this.displayResults(results, event)
    }
  }

  /********************************************************************************** */
  async updateContent() {
    let html = await renderTemplate('modules/beneos_module/templates/beneossearchengine.html', this.dbData)
    this.data.content = html
    this.render(true)
  }

  /********************************************************************************** */
  processSelectorSearch() {
    let type = this.dbData.searchMode
    let searchResults = BeneosDatabaseHolder.getAll(type)

    let biomValue = $("#bioms-selector").val()
    if (biomValue && biomValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "biom", biomValue, searchResults)
    }
    biomValue = $("#bioms-selector-2").val()
    if (biomValue && biomValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "biom", biomValue, searchResults)
    }
    let kindValue = $("#kind-selector").val()
    if (kindValue && kindValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "type", kindValue, searchResults)
    }
    let brightnessValue = $("#bmap-brightness").val()
    if (brightnessValue && brightnessValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "brightness", brightnessValue, searchResults)
    }
    let typeValue = $("#token-types").val()
    if (typeValue && typeValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "type", typeValue, searchResults)
    }
    let fightValue = $("#token-fight-style").val()
    if (fightValue && fightValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "fightingstyle", fightValue, searchResults)
    }
    let crValue = $("#token-cr").val()
    if (crValue && crValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "cr", crValue.toString(), searchResults, true)
    }
    let moveValue = $("#token-movement").val()
    if (moveValue && moveValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "movement", moveValue.toString(), searchResults, true)
    }
    let purposeValue = $("#token-purpose").val()
    if (purposeValue && purposeValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "purpose", purposeValue, searchResults)
    }
    let gridValue = $("#bmap-grid").val()
    if (gridValue && gridValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "grid", gridValue, searchResults)
    }
    let adventureValue = $("#bmap-adventure").val()
    if (adventureValue && adventureValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "adventure", adventureValue, searchResults)
    }

    let rarityValue = $("#rarity-selector").val()
    if (rarityValue && rarityValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "rarity", rarityValue, searchResults, true)
    }
    let itemTypeValue = $("#item-type").val()
    if (itemTypeValue && itemTypeValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "item_type", itemTypeValue, searchResults)
    }
    let originValue = $("#origin-selector").val()
    if (originValue && originValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "origin", originValue, searchResults, true)
    }
    let tierValue = $("#tier-selector").val()
    if (tierValue && tierValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "tier", tierValue, searchResults, true)
    }
    let priceValue = $("#price-selector").val()
    if (priceValue && priceValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "price", priceValue, searchResults, true)
    }

    let spellTypeValue = $("#spell-type").val()
    if (spellTypeValue && spellTypeValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "spell_type", spellTypeValue, searchResults)
    }
    let schoolValue = $("#school-selector").val()
    if (schoolValue && schoolValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "school", schoolValue, searchResults)
    }
    let levelValue = $("#level-selector").val()
    if (levelValue && levelValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "level", levelValue, searchResults)
    }
    let castingValue = $("#casting_time-selector").val()
    if (castingValue && castingValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "casting_time", castingValue, searchResults)
    }
    let classValue = $("#class-selector").val()
    if (classValue && classValue.toLowerCase() != "any") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "classes", classValue, searchResults)
    }
    let installedValue = $("#installation-selector").val()
    if (installedValue && installedValue.toLowerCase() != "all") {
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "installed", installedValue, searchResults)
    }

    this.displayResults(searchResults)
  }

  /********************************************************************************** */
  updateSelector(event) {
    let myObject = this

    clearTimeout(myObject.timeout)
    myObject.timeout = setTimeout(function () {
      myObject.processSelectorSearch(event)
    }, 800)
  }

  /********************************************************************************** */
  cleanFilters() {
    $("#bioms-selector").val("any")
    $("#bmap-grid").val("any")
    $("#bmap-brightness").val("any")
    $('#bmap-adventure').val("any")
    $("#token-cr").val("any")
    $('#token-fight-style').val("any")
    $("#token-purpose").val("any")

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
  activateListeners() {

    let myObject = this

    $('#beneos-search-text').bind("enterKey", function (event) {
      let key = event.keyCode ? event.keyCode : event.which
      if (key == 13) {
        //console.log("HERE KEYDOWN 13 - 2!!!!")
        event.preventDefault()
        return
      }
    });
    $('#beneos-search-form').keydown(function (event) {
      let key = event.keyCode ? event.keyCode : event.which
      if (key == 13) {
        event.preventDefault()
        //console.log("HERE KEYDOWN 13 - 2!!!!")
        return
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
      this.dbData.searchMode = "token"
      this.updateContent()
      this.updateSelector(event)
    })

    $("#beneos-radio-bmap").click(event => {
      this.dbData.searchMode = "bmap"
      this.updateContent()
      this.updateSelector(event)
    })
    $("#beneos-radio-spell").click(event => {
      this.dbData.searchMode = "spell"
      this.updateContent()
      this.updateSelector(event)
    })
    $("#beneos-radio-item").click(event => {
      this.dbData.searchMode = "item"
      this.updateContent()
      this.updateSelector(event)
    })

    $("#reset-search-list").click(event => {
      let type = this.dbData.searchMode
      this.cleanFilters()
      let searchResults = BeneosDatabaseHolder.getAll(type)
      this.displayResults(searchResults)
    })

    $(".beneos-selector").change(event => {
      this.updateSelector(event)
    })
  }
}

/********************************************************************************** */
export class BeneosSearchEngineLauncher extends FormApplication {

  /********************************************************************************** */
  async render() {
    if (game.beneosTokens.searchEngine) {
      return
    }
    await BeneosDatabaseHolder.loadDatabaseFiles()
    let dbData = BeneosDatabaseHolder.getData()

    let html = await renderTemplate('modules/beneos_module/templates/beneossearchengine.html', dbData)
    let searchDialog = new BeneosSearchEngine(html, dbData)
    searchDialog.render(true)
    setTimeout(searchDialog.processSelectorSearch(), 500)
  }

}
