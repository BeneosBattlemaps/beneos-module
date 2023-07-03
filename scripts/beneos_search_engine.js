import { BeneosUtility } from "./beneos_utility.js"

/********************************************************************************** */
const tokenDBURL = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/tokens/beneos_tokens_database.json"
const battlemapDBURL = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/battlemaps/beneos_battlemaps_database.json"

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

    //console.log("SEARCH results", results)
    let html = await renderTemplate('modules/beneos_module/templates/' + this.listTemplate, 
      { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getBeneosModuleDataPath(), beneosTokensHUD, searchValue })
    this.data.content = html
    this.render(true)
  }

  /********************************************************************************** */
  textSearch(searchValue) {
    let newList = this.tokenList.filter( t => t.name.toLowerCase().includes( searchValue.toLowerCase()))
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
      console.log(">>>>>> ACTOR", actorId, myActor, myObject.actor)
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
    let tokenData = await fetchJsonWithTimeout(tokenDBURL)
    this.tokenData = tokenData
    let bmapData = await fetchJsonWithTimeout(battlemapDBURL)
    this.bmapData = bmapData
    this.buildSearchData()
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

    for (let key in this.tokenData.content) {
      console.log("Processing", key)
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
        tokenData.isInstalled = BeneosUtility.isLoaded(key)
        tokenData.actorId = BeneosUtility.getActorId(key)
        //tokenData.description = tokenData.description
      }
    }
    for (let key in this.bmapData.content) {
      let bmapData = this.bmapData.content[key]
      if (bmapData && typeof (bmapData) == "object") {
        bmapData.kind = "battlemap"
        bmapData.key = key
        bmapData.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/battlemaps/thumbnails/" + key + ".webp"
        mergeObject(this.bmapBrightness, this.buildList(bmapData.properties.brightness))
        mergeObject(this.bmapBioms, this.buildList(bmapData.properties.biom))
        mergeObject(this.adventureList, this.buildList(bmapData.properties.adventure))
        mergeObject(this.gridList, this.buildList(bmapData.properties.grid))
        bmapData.isInstalled = true
        //this.bmapBioms["Any"] = 1 // Force Any, as not present (why ??)
      }
    }
    //console.log(">>>>>>>>>>>>>>>>>>>", this.bmapBioms)
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
        item.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/battlemaps/thumbnails/" + item.key + ".webp"
      }
      if (this.fieldTextSearch(item, text) || this.fieldTextSearch(item.properties, text)) {
        results.push(item)
      } 
    }
    return results
  }

  /********************************************************************************** */
  static textSearch(text) {

    let results = this.objectTextSearch(this.tokenData.content, text, "token")
    results = results.concat(this.objectTextSearch(this.bmapData.content, text, "bmap"))

    //console.log("TEXT results ", results, this.bmapData.content)
    return results
  }

  /********************************************************************************** */
  static searchByProperty(type, propertyName, value, searchResults, strict = false) {
    let newResults = {}
    value = value.toLowerCase()

    //console.log(">>>>>", type, propertyName, value)

    for (let key in searchResults) {
      let item = searchResults[key]
      item.kind = (type == "token") ? "token" : item.properties.type
      if (item.kind == "token") {
        item.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/tokens/thumbnails/" + item.key + "-idle_face_still.webp"
      } else {
        item.picture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/battlemaps/thumbnails/" + item.key + ".webp"
        if (item.properties.sibling) {
          item.siblingPicture = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-database/main/battlemaps/thumbnails/" + item.properties.sibling + ".webp"
        }
      }
      //console.log("PROP", type, propertyName, value, searchResults, item.properties[propertyName])
      if (item[propertyName]) {
        if (item[propertyName].toLowerCase() == value) {
          newResults[key] = duplicate(item)
        }
      }
      if (item.properties && item.properties[propertyName]) {
        //console.log(item.properties[propertyName], typeof(item.properties[propertyName]))
        if (typeof (item.properties[propertyName]) == "string") {
          if (strict) {
            if (item.properties[propertyName].toLowerCase().toString() == value.toString()) {
              newResults[key] = duplicate(item)
            }
          } else {
            if (item.properties[propertyName].toLowerCase().toString().includes(value)) {
              newResults[key] = duplicate(item)
            }
          }
        } else {
          if (Array.isArray(item.properties[propertyName])) {
            for (let valueArray of item.properties[propertyName]) {
              if ((typeof (valueArray) == "string") && valueArray.toLowerCase().toString().includes(value)) {
                newResults[key] = duplicate(item)
              }
            }
          }
        }
      }
    }
    return newResults
    //console.log("Found", searchResults)
  }

  /********************************************************************************** */
  static getAll(type) {
    return (type == "token") ? duplicate(this.tokenData.content) : duplicate(this.bmapData.content)
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
      searchToken: true,
      searchBmap: false,
      tokenBioms: this.toTable(this.tokenBioms),
      bmapBioms: this.toTable(this.bmapBioms),
      tokenTypes: this.toTable(this.tokenTypes),
      fightingStyles: this.toTable(this.fightingStyles),
      bmapBrightness: this.toTable(this.bmapBrightness),
      movementList: this.toTable(this.movementList),
      crList: this.toTable(this.crList, false),
      purposeList: this.toTable(this.purposeList),
      adventureList: this.toTable(this.adventureList),
      gridList: this.toTable(this.gridList)
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
    let dialogConf = { content: html, title: "Beneos Search Results", buttons: myButtons };
    let dialogOptions = { classes: ["beneos_module", "draggable"], left: 620, width: 720, height: 580, 'z-index': 99999 }
    super(dialogConf, dialogOptions)
  }
  /********************************************************************************** */
  activateListeners() {

    $(".token-search-data").on('dragstart', function (e) {
      let id = e.target.getAttribute("data-document-id");
      let compendium = (game.system.id == "pf2e") ? "beneos_module.beneos_module_actors_pf2" : "beneos_module.beneos_module_actors"
      let drag_data = { "type": "Actor", "pack": compendium, "uuid": "Compendium." + compendium + "." + id }
      //console.log("DRAGDARA", drag_data)
      e.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(drag_data));
    })
    $(".beneos-button-biom").click(event => {
      let searchResults = BeneosDatabaseHolder.getAll("bmap")
      let biom = $(event.currentTarget).data("biom-value")
      searchResults = BeneosDatabaseHolder.searchByProperty("bmap", "biom", biom.toString(), searchResults)
      game.beneosTokens.searchEngine.displayResults(searchResults)
      $("#bioms-selector").val(BeneosUtility.firstLetterUpper(biom.toString()))
    })
    $(".beneos-button-grid").click(event => {
      let searchResults = BeneosDatabaseHolder.getAll("bmap")
      let grid = $(event.currentTarget).data("grid-value")
      searchResults = BeneosDatabaseHolder.searchByProperty("bmap", "grid", grid.toString(), searchResults)
      game.beneosTokens.searchEngine.displayResults(searchResults)
      console.log("Set grid", grid.toString())
      $("#bmap-grid").val(grid.toString())
    })
    $(".beneos-button-brightness").click(event => {
      let searchResults = BeneosDatabaseHolder.getAll("bmap")
      let brightness = $(event.currentTarget).data("brightness-value")
      searchResults = BeneosDatabaseHolder.searchByProperty("bmap", "brightness", brightness.toString(), searchResults)
      game.beneosTokens.searchEngine.displayResults(searchResults)
      $("#bmap-brightness").val(brightness.toString())
    })
    $(".beneos-jump-linked").click(event => {
      let jumpKey = $(event.currentTarget).data("jump-data")
      let searchResults = BeneosDatabaseHolder.textSearch(jumpKey)
      game.beneosTokens.searchEngine.displayResults(searchResults)
      //$('#beneos-search-text').val(jumpKey)
    })
    $(".beneos-button-adventure").click(event => {
      let searchResults = BeneosDatabaseHolder.getAll("bmap")
      let adventure = $(event.currentTarget).data("adventure-name")
      searchResults = BeneosDatabaseHolder.searchByProperty("bmap", "adventure", adventure.toString(), searchResults)
      game.beneosTokens.searchEngine.displayResults(searchResults)
      $('#bmap-adventure').val(adventure)
    })

    $(".beneos-button-cr").click(event => {
      let searchResults = BeneosDatabaseHolder.getAll("token")
      let cr = $(event.currentTarget).data("cr-value")
      searchResults = BeneosDatabaseHolder.searchByProperty("token", "cr", cr.toString(), searchResults, true)
      game.beneosTokens.searchEngine.displayResults(searchResults)
      $("#token-cr").val(cr)
    })
    $(".beneos-button-fight").click(event => {
      let searchResults = BeneosDatabaseHolder.getAll("token")
      let fight = $(event.currentTarget).data("fight-value")
      searchResults = BeneosDatabaseHolder.searchByProperty("token", "fightingstyle", fight.toString(), searchResults)
      game.beneosTokens.searchEngine.displayResults(searchResults)
      $('#token-fight-style').val(fight)
    })
    $(".beneos-button-purpose").click(event => {
      let searchResults = BeneosDatabaseHolder.getAll("token")
      let purpose = $(event.currentTarget).data("purpose-value")
      searchResults = BeneosDatabaseHolder.searchByProperty("token", "purpose", purpose.toString(), searchResults)
      game.beneosTokens.searchEngine.displayResults(searchResults)
      $("#token-purpose").val(purpose)
    })

    $(".beneos-button-journal").click(event => {
      let element = $(event.currentTarget)?.parents(".token-root-div")
      let tokenKey = element.data("token-key")
      let tokenConfig = BeneosUtility.isLoaded(tokenKey)
      if (tokenConfig && tokenConfig.config) {
        if (tokenConfig.config.compendium) {
          let beneosPack = game.packs.get("beneos_module.beneos_module_journal")
          if (beneosPack) {
            let beneosJournalEntry = null
            let beneosCompendiumEntry = beneosPack.index.getName(tokenConfig.config.compendium)
            if (beneosCompendiumEntry && beneosCompendiumEntry._id) {
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
    let dialogOptions = { classes: ["beneos_module"], left: 200, width: 400, height: 420, 'z-index': 99999 }
    super(dialogConf, dialogOptions)

    this.dbData = data
    this.dbData.searchToken = true
    this.dbData.searchBmap = false
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

    //console.log("SEARCH results", results)
    let html = await renderTemplate('modules/beneos_module/templates/beneossearchresults.html', {
      results: results,
      //isMoulinette: (game.moulinette) ? true : false
      isMoulinette: false // Up to now
    }
    )
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
      let results = BeneosDatabaseHolder.textSearch(event.currentTarget.value)

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
    let type = (this.dbData.searchToken) ? "token" : "bmap"
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
      searchResults = BeneosDatabaseHolder.searchByProperty(type, "kind", kindValue, searchResults)
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
      this.dbData.searchToken = $(event.currentTarget).val()
      this.dbData.searchBmap = !this.dbData.searchToken
      this.updateContent()
      this.updateSelector(event)
    })

    $("#beneos-radio-bmap").click(event => {
      this.dbData.searchBmap = $(event.currentTarget).val()
      this.dbData.searchToken = !this.dbData.searchBmap
      this.updateContent()
      this.updateSelector(event)
    })

    $("#reset-search-list").click(event => {
      let type = (this.dbData.searchToken) ? "token" : "bmap"
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
    await BeneosDatabaseHolder.loadDatabaseFiles()
    let dbData = BeneosDatabaseHolder.getData()

    let html = await renderTemplate('modules/beneos_module/templates/beneossearchengine.html', dbData)
    let searchDialog = new BeneosSearchEngine(html, dbData)
    searchDialog.render(true)
    setTimeout(searchDialog.processSelectorSearch(), 500)
  }

}
