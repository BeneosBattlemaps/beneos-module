/********************************************************************************** */
import { BeneosUtility } from "./beneos_utility.js";

/********************************************************************************** */
export class BeneosCompendiumReset extends FormApplication {

  /********************************************************************************** */
  async deleteCompendiumContent(comp) {
    let pack = game.packs.get(comp)
    if (pack) {
      await pack.getIndex()
      await pack.configure({ locked: false })
  
      for (let item of pack.index.contents) {
        let doc = await pack.getDocument(item._id)
        await doc.delete()
      }  
    }
    //console.log("PACK", pack)
  }

  /********************************************************************************** */
  async performReset() {
    ui.notifications.info("BeneosModule : Cleanup of compendiums has started....")

    await this.deleteCompendiumContent("beneos-module.beneos_module_journal")

    if (game.system.id == "pf2e") {
      await this.deleteCompendiumContent("beneos-module.beneos_module_actors_pf2")
      ui.notifications.info("BeneosModule : PF2 - Cleanup of compendiums finished.")
      BeneosCompendiumManager.buildDynamicCompendiumsPF2()
    } else {
      let chatData = {
        user: game.user.id,
        rollMode: game.settings.get("core", "rollMode"),
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<div><strong>BeneosModule</strong> : Import process started... Please wait end message</div`
      }
      ChatMessage.create(chatData);
      await this.deleteCompendiumContent("beneos-module.beneos_module_actors")
      await this.deleteCompendiumContent("beneos-module.beneos_module_items")
      await this.deleteCompendiumContent("beneos-module.beneos_module_spells")
      chatData.content = `<div><strong>BeneosModule</strong> : Cleanup of compendiums finished, import is starting</div`
      ChatMessage.create(chatData);
      
      await BeneosCompendiumManager.buildDynamicCompendiumsTokensDD5()
      chatData.content = `<div><strong>BeneosModule</strong> : Actors compendium done.</div`
      ChatMessage.create(chatData);
      
      await BeneosCompendiumManager.buildDynamicCompendiumsSpellsDD5()
      chatData.content = `<div><strong>BeneosModule</strong> : Spells compendium done.</div`
      ChatMessage.create(chatData);
      
      await BeneosCompendiumManager.buildDynamicCompendiumsItemsDD5()
      chatData.content = `<div><strong>BeneosModule</strong> : Items compendium done.<br><strong>All compendiums created, import finished !!</strong></div`
      ChatMessage.create(chatData)
      
      // Reload the settings, as they have been updated during the import
      BeneosUtility.reloadInternalSettings()

    }
  }

  /********************************************************************************** */
  render() {
    this.performReset()
  }
}

/********************************************************************************** */
export class BeneosCompendiumManager {

  /********************************************************************************** */
  static async buildDynamicCompendiumsPF2() {
    ui.notifications.info("BeneosModule : PF2 Compendium building .... Please wait !")

    BeneosUtility.resetTokenData()
    let tokenDataFolder = BeneosUtility.getBasePath() + BeneosUtility.getBeneosTokenDataPath()

    // get the packs to update/check
    let actorPack = game.packs.get("beneos-module.beneos_module_actors_pf2")
    let journalPack = game.packs.get("beneos-module.beneos_module_journal")
    await actorPack.getIndex()
    await journalPack.getIndex()

    // Unlock the compendiums
    await actorPack.configure({ locked: false })
    await journalPack.configure({ locked: false })

    // Parse subfolder
    let rootFolder = await FilePicker.browse("data", tokenDataFolder)
    // Loop thru folders
    for (let subFolder of rootFolder.dirs) {
      let res = subFolder.match("/(\\d*)_")
      if (res && !subFolder.includes("module_assets") && !subFolder.includes("ability_icons")) {
        // Token config
        let idleList = []
        let imgVideoList = []
        let currentId = ""
        let currentName = ""
        let key = subFolder.substring(subFolder.lastIndexOf("/") + 1)
        //console.log("KEY", res[1])

        let JSONFilePath = subFolder + "/tokenconfig_" + key + ".json"
        try {
          let tokenJSON = await fetch(JSONFilePath)
          if (tokenJSON && tokenJSON.status == 200) {
            let recordsToken = await tokenJSON.json()
            if (recordsToken) {
              recordsToken.JSONFilePath = JSONFilePath // Auto-reference
              BeneosUtility.beneosTokens[key] = duplicate(recordsToken[key])
            } else {
              ui.notifications.warn("Warning ! Wrong token config for token " + key)
            }
          } else {
            if (!key.match("000_")) {
              ui.notifications.warn("Warning ! Unable to fetch config for token " + key)
            }
          }
        } catch (error) {
          console.log("Warning ! Error in parsing JSON " + error, JSONFilePath)
        }

        let dataFolder = await FilePicker.browse("data", subFolder)
        // Parse subfolders to build idle tokens list
        for (let subFolder2 of dataFolder.dirs) {
          let dataFolder2 = await FilePicker.browse("data", subFolder2)
          for (let filename of dataFolder2.files) {
            if (filename.toLowerCase().includes("idle_")) {
              idleList.push(filename)
            }
            if (filename.toLowerCase().includes(".web") && !filename.toLowerCase().includes(".-preview")) {
              imgVideoList.push(filename)
            }
          }
        }
        // And root folder to get json definitions and additionnel idle tokens
        for (let filename of dataFolder.files) {
          if (filename.toLowerCase().includes("idle_")) {
            idleList.push(filename)
          }
          if (filename.toLowerCase().includes(".web") && !filename.toLowerCase().includes(".-preview")) {
            imgVideoList.push(filename)
          }
          if (filename.toLowerCase().includes("actor_") && filename.toLowerCase().includes(".json")) {
            let r = await fetch(filename)
            let records = await r.json() // This DD5 stuff...
            let pf2Record = { name: records.name, type: "npc", img: this.replaceImgPath(dataFolder.target, records.img, false) }
            if (records.prototypeToken) {
              pf2Record.prototypeToken = { texture: { src: this.replaceImgPath(dataFolder.target, records.prototypeToken.texture.src, true) } }
            }
            let actor = await Actor.create(pf2Record, { temporary: true })
            let imported = await actorPack.importDocument(actor)
            console.log("ACTOR IMPO", imported)
            currentName = actor.name
            currentId = imported.id
          }
          if (filename.toLowerCase().includes("journal_") && filename.toLowerCase().includes(".json")) {
            let r = await fetch(filename)
            let records = await r.json()
            //console.log("JOURNAL DATA", records)
            if (!game.release.generation || game.release.generation < 10) {
              records.img = this.replaceImgPath(dataFolder.target, records.img, false)
              records.content = this.replaceImgPathHTMLContent(dataFolder.target, records.content)
            }
            // Remove the DD5 token link
            let newPages = []
            for (let page of records.pages) {
              if (!page.name.includes("Token PDF ")) {
                newPages.push(page)
              }
            }
            records.pages = newPages
            let journal = await JournalEntry.create(records, { temporary: true })
            journalPack.importDocument(journal)
          }
        }
        if (key && BeneosUtility.beneosTokens[key]) {
          //console.log("Final IDLE list : ", idleList)
          BeneosUtility.beneosTokens[key].idleList = duplicate(idleList)
          BeneosUtility.beneosTokens[key].imgVideoList = duplicate(imgVideoList)
          BeneosUtility.beneosTokens[key].actorId = currentId
          BeneosUtility.beneosTokens[key].actorName = currentName
        }
      }
    }

    ui.notifications.info("BeneosModule : PF2 Compendium building finished !")
    let toSave = JSON.stringify(BeneosUtility.beneosTokens)
    console.log("Saving data :", toSave)
    game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', toSave) // Save the token config !

    await actorPack.configure({ locked: true })
    await journalPack.configure({ locked: true })
  }

  /********************************************************************************** */
  static async showNewItems(itemName, newData, previousData, compendium) {
    let diffData = [] // Detect new import data
    for(let key in newData) {
      if (!previousData[key]) {
        diffData.push(duplicate(newData[key]))
      }
    }
    let content = itemName + " : No new content detected."
    if (diffData.length > 0) {
      content = await renderTemplate(`modules/beneos-module/templates/chat-new-compendium-data.html`, {itemList: diffData, itemName, compendium} )
    } 
    let chatData = {
      user: game.user.id,
      rollMode: game.settings.get("core", "rollMode"),
      whisper: ChatMessage.getWhisperRecipients('GM'),
      content: content 
    }
    ChatMessage.create(chatData);
  }

  /********************************************************************************** */
  // Main root importer/builder function
  static async buildDynamicCompendiumsTokensDD5() {
    ui.notifications.info("BeneosModule : Compendium building .... Please wait !")

    BeneosUtility.resetTokenData()
    let tokenDataFolder = BeneosUtility.getBasePath() + BeneosUtility.getBeneosTokenDataPath()

    // get the packs to update/check
    let actorPack = game.packs.get("beneos-module.beneos_module_actors")
    let journalPack = game.packs.get("beneos-module.beneos_module_journal")
    if (!actorPack || !journalPack) {
      ui.notifications.error("BeneosModule : Unable to find compendiums, please check your installation !")
      return
    }
    await actorPack.getIndex()
    await journalPack.getIndex()

    await actorPack.configure({ locked: false })
    await journalPack.configure({ locked: false })

    // Parse subfolder
    let rootFolder = await FilePicker.browse("data", tokenDataFolder)
    console.log("ROOT", rootFolder)
    for (let subFolder of rootFolder.dirs) {
      console.log("SUBFOLDER", subFolder)
      let res = subFolder.match("/(\\d*)_")
      if (res && !subFolder.includes("module_assets") && !subFolder.includes("ability_icons")) {
        // Token config
        let idleList = []
        let imgVideoList = []
        let currentId = ""
        let currentName = ""
        let key = subFolder.substring(subFolder.lastIndexOf("/") + 1)
        //console.log("KEY", res[1])

        let JSONFilePath = subFolder + "/tokenconfig_" + key + ".json"
        try {
          let tokenJSON = await fetch(JSONFilePath)
          if (tokenJSON && tokenJSON.status == 200) {
            let recordsToken = await tokenJSON.json()
            if (recordsToken) {
              recordsToken.JSONFilePath = JSONFilePath // Auto-reference
              BeneosUtility.beneosTokens[key] = duplicate(recordsToken[key])
            } else {
              ui.notifications.warn("Warning ! Wrong token config for token " + key)
            }
          } else {
            if (!key.match("000_")) {
              ui.notifications.warn("Warning ! Unable to fetch config for token " + key)
            }
          }
        } catch (error) {
          console.log("Warning ! Error in parsing JSON " + error, JSONFilePath)
        }

        let dataFolder = await FilePicker.browse("data", subFolder)
        // Parse subfolders to build idle tokens list
        for (let subFolder2 of dataFolder.dirs) {
          let dataFolder2 = await FilePicker.browse("data", subFolder2)
          for (let filename of dataFolder2.files) {
            if (filename.toLowerCase().includes("idle_")) {
              idleList.push(filename)
            }
            if (filename.toLowerCase().includes(".web") && !filename.toLowerCase().includes(".-preview")) {
              imgVideoList.push(filename)
            }
          }
        }
        // And root folder to get json definitions and additionnel idle tokens
        for (let filename of dataFolder.files) {
          if (filename.toLowerCase().includes("idle_")) {
            idleList.push(filename)
          }
          if (filename.toLowerCase().includes(".web") && !filename.toLowerCase().includes(".-preview")) {
            imgVideoList.push(filename)
          }
          if (filename.toLowerCase().includes("actor_") && filename.toLowerCase().includes(".json")) {
            let r = await fetch(filename)
            let records = await r.json()
            // Replace common v9/v10 stuff
            records.img = this.replaceImgPath(dataFolder.target, records.img, false)
            this.replaceItemsPath(records)
            //console.log(">>>>>>>>>>>>>> REC", records, actor)
            if (records.prototypeToken) {
              records.prototypeToken.texture.src = this.replaceImgPath(dataFolder.target, records.prototypeToken.texture.src, true)
            } else {
              records.token.img = this.replaceImgPath(dataFolder.target, records.token.img, true)
            }
            let actor = await Actor.create(records, { temporary: true })
            let imported = await actorPack.importDocument(actor)
            console.log("ACTOR IMPO", imported)
            currentId = imported.id
            currentName = actor.name
          }
          if (filename.toLowerCase().includes("journal_") && filename.toLowerCase().includes(".json")) {
            let r = await fetch(filename)
            let records = await r.json()
            //console.log("JOURNAL DATA", records)
            if (!game.release.generation || game.release.generation < 10) {
              records.img = this.replaceImgPath(dataFolder.target, records.img, false)
              records.content = this.replaceImgPathHTMLContent(dataFolder.target, records.content)
            }
            let journal = await JournalEntry.create(records, { temporary: true })
            journalPack.importDocument(journal)
          }
        }
        if (key && BeneosUtility.beneosTokens[key]) {
          //console.log("Final IDLE list : ", idleList)
          BeneosUtility.beneosTokens[key].idleList = duplicate(idleList)
          BeneosUtility.beneosTokens[key].imgVideoList = duplicate(imgVideoList)
          BeneosUtility.beneosTokens[key].actorId = currentId
          BeneosUtility.beneosTokens[key].id = currentId
          BeneosUtility.beneosTokens[key].actorName = currentName
        }
      }
    }

    ui.notifications.info("BeneosModule : Compendium building finished !")
    let previousData = {}
    try  {
      previousData = JSON.parse(game.settings.get(BeneosUtility.moduleID(), 'beneos-json-tokenconfig') || {}) // Get the previous config !
    }
    catch {
      console.log("Error in parsing JSON for Tokens previousData, warning only all content has been re-imported")
    }
    await this.showNewItems("Actors", BeneosUtility.beneosTokens, previousData, "Compendium.beneos-module.beneos_module_actors.Actor")
    
    let toSave = JSON.stringify(BeneosUtility.beneosTokens)
    console.log("Saving data :", toSave)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', toSave) // Save the token config !

    await actorPack.configure({ locked: true })
    await journalPack.configure({ locked: true })
  }

  /********************************************************************************** */
  // Main root importer/builder function
  static async buildDynamicCompendiumsSpellsDD5() {
    ui.notifications.info("BeneosModule : Spells Compendium building .... Please wait !")

    BeneosUtility.resetTokenData()
    let tokenDataFolder = BeneosUtility.getBasePath() + BeneosUtility.getBeneosSpellDataPath()

    // get the packs to update/check
    let spellPack = game.packs.get("beneos-module.beneos_module_spells")
    await spellPack.getIndex()
    await spellPack.configure({ locked: false })

    // Parse subfolder
    let rootFolder = await FilePicker.browse("data", tokenDataFolder)
    console.log("ROOT", rootFolder)
    for (let subFolder of rootFolder.dirs) {
      console.log("SUBFOLDER", subFolder)
      let res = subFolder.match("/(\\d*)_")
      if (res && !subFolder.includes("module_assets") && !subFolder.includes("ability_icons")) {

        let dataFolder = await FilePicker.browse("data", subFolder)
        // And root folder to get json definitions and additionnel idle tokens
        for (let filename of dataFolder.files) {
          if (filename.toLowerCase().includes(".json")) {
            let r = await fetch(filename)
            let records = await r.json()
            let spell = await Item.create(records, { temporary: true })
            let iSpell = await spellPack.importDocument(spell)
            let key = subFolder.replace(/\/$/, "").split("/").pop();
            BeneosUtility.beneosSpells[key] = {spellId: iSpell.id, id: iSpell.id} 
          }
        }
      }
    }

    ui.notifications.info("BeneosModule : Spells Compendium building finished !")
    await spellPack.configure({ locked: true })

    let previousData = {}
    try {
      previousData = JSON.parse(game.settings.get(BeneosUtility.moduleID(), 'beneos-json-spellconfig') || {}) // Get the previous config !
    }
    catch {
      console.log("Error in parsing JSON for Spells previousData, warning only all content has been re-imported")
    }
    await this.showNewItems("Spells", BeneosUtility.beneosSpells, previousData, "Compendium.beneos-module.beneos_module_spells.Item" )

    let toSave = JSON.stringify(BeneosUtility.beneosSpells)
    //console.log("Saving data :", toSave)
    game.settings.set(BeneosUtility.moduleID(), 'beneos-json-spellconfig', toSave) // Save the token config !

  }

    /********************************************************************************** */
  // Main root importer/builder function
  static async buildDynamicCompendiumsItemsDD5() {
    ui.notifications.info("BeneosModule : Items Compendium building .... Please wait !")

    BeneosUtility.resetTokenData()
    let itemDataFolder = BeneosUtility.getBasePath() + BeneosUtility.getBeneosItemDataPath()

    // get the packs to update/check
    let itemPack = game.packs.get("beneos-module.beneos_module_items")
    await itemPack.getIndex()
    await itemPack.configure({ locked: false })

    // Parse subfolder
    let rootFolder = await FilePicker.browse("data", itemDataFolder)
    //console.log("ROOT", rootFolder)
    for (let subFolder of rootFolder.dirs) {
      //console.log("SUBFOLDER", subFolder)
      let res = subFolder.match("/(\\d*)_")
      if (res && !subFolder.includes("module_assets") && !subFolder.includes("ability_icons")) {

        let dataFolder = await FilePicker.browse("data", subFolder)
        // And root folder to get json definitions and additionnel idle tokens
        for (let filename of dataFolder.files) {
          if (filename.toLowerCase().includes(".json")) {
            let r = await fetch(filename)
            let records = await r.json()
            let item = await Item.create(records, { temporary: true })
            let iItem = await itemPack.importDocument(item)
            let key = subFolder.replace(/\/$/, "").split("/").pop();
            BeneosUtility.beneosItems[key] = {itemId: iItem.id, id: iItem.id} 
          }
        }
      }
    }

    ui.notifications.info("BeneosModule : Items Compendium building finished !")
    await itemPack.configure({ locked: true })
    let previousData = {}
    try { 
      previousData = JSON.parse(game.settings.get(BeneosUtility.moduleID(), 'beneos-json-itemconfig') || {}) // Get the previous config !
    }
    catch {
      console.log("Error in parsing JSON for Items previousData, warning only all content has been re-imported")
    }
    await this.showNewItems("Items", BeneosUtility.beneosItems, previousData, "Compendium.beneos-module.beneos_module_items.Item" )

    let toSave = JSON.stringify(BeneosUtility.beneosItems)
    //console.log("Saving data :", toSave)
    game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', toSave) // Save the token config !

  }

  /********************************************************************************** */
  static replaceItemsPath(records) {
    for (let item of records.items) {
      if (item?.img.match("_ability_icons")) {
        let filename = item.img.substring(item.img.lastIndexOf("/") + 1)
        item.img = BeneosUtility.getBasePath() + BeneosUtility.getBeneosTokenDataPath() + "/_ability_icons/" + filename
      }
    }
  }

  /********************************************************************************** */
  /** Replace the initial image from exported JSON to the new actual path */
  static replaceImgPathHTMLContent(currentFolder, content) {
    let res = content.match("img\\s+src=\"([\\w/\\.\\-]*)\"")
    if (res && res[1]) { // Image found !
      let filename = res[1].substring(res[1].lastIndexOf("/") + 1)
      if (filename[2] == "_") { // No 3 digits in the preview file
        filename = "0" + filename
      }
      filename = filename.toLowerCase().replace(".gif", ".webm") // Patch to webm
      let newPath = currentFolder + "/" + filename

      let newContent = content.replace(res[1], newPath) // Replace filepath
      newContent = newContent.replace("width=\"673\" height=\"376\"", "") // Delete width/height gif
      newContent = newContent.replace("<img ", "<video autoplay=\"autoplay\" loop=\"loop\" width=\"674\" height=\"377\" ") // Replace img tag
      return newContent
    } else {
      let res = content.match("video\\s+src=\"([\\w/\\.\\-]*)\"")
      if (res && res[1]) {
        let filename = res[1].substring(res[1].lastIndexOf("/") + 1)
        if (filename[2] == "_") { // No 3 digits in the preview file
          filename = "0" + filename
        }
        console.log("Folder", currentFolder, filename)
        let newPath = currentFolder + "/" + filename
        let newContent = content.replace(res[1], newPath) // Replace filepath
        return newContent
      }
    }
    return content
  }

  /********************************************************************************** */
  /** Replace the initial image from exported JSON to the new actual path */
  static replaceImgPath(currentFolder, filepath, isToken) {
    let filename = filepath.substring(filepath.lastIndexOf("/") + 1)
    let newPath = currentFolder + ((isToken) ? "/top/" : "/") + filename
    //console.log("Replaced", filepath, newPath)
    return newPath
  }
}