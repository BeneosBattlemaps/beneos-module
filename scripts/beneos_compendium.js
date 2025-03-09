/********************************************************************************** */
import { BeneosSearchEngineLauncher } from "./beneos_search_engine.js";
import { BeneosUtility } from "./beneos_utility.js";

/********************************************************************************** */
export class BeneosCompendiumReset extends FormApplication {

  /********************************************************************************** */
  async deleteCompendiumContent(comp) {
    let pack = game.packs.get(comp)
    if (pack) {
      await pack.getIndex()
      await pack.configure({ locked: false })

      pack.documentClass.deleteDocuments([], { deleteAll: true, pack: comp });
    }
    $(".beneos-meter-delete").attr("value", 100)
    //console.log("PACK", pack)
  }

  /********************************************************************************** */
  async performReset() {

    ui.notifications.info("BeneosModule : Compendium building is starting, check chat message....");

    await this.deleteCompendiumContent("beneos-module.beneos_module_journal")
    BeneosCompendiumManager.cleanImportErrors()

    if (game.system.id == "pf2e") {
      let chatData = {
        user: game.user.id,
        rollMode: game.settings.get("core", "rollMode"),
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<div><strong>BeneosModule</strong> : Import process started... Please wait end message and <strong>do not refresh</strong> your browser.</div>` +
          `<div><strong>1/2 - Cleanup : </strong><span class="beneos-chat-delete-info"></span></div>`
      }
      ChatMessage.create(chatData);
      await this.deleteCompendiumContent("beneos-module.beneos_module_actors_pf2")
      await this.deleteCompendiumContent("beneos-module.beneos_module_journal")
      $(".beneos-chat-delete-info").html("Cleanup finished")

      ui.notifications.info("BeneosModule : PF2 - Cleanup of compendiums finished.")
      chatData.content = `<div><strong>BeneosModule</strong> : Cleanup finished, importing actors</div>` +
        `<div><strong>2/2 - Actors : </strong><meter class="beneos-meter-actor" min="0" max="100" value="0">100%</meter>&nbsp;<span class="beneos-chat-actor-info"></span></div>`
      ChatMessage.create(chatData);
      BeneosCompendiumManager.buildDynamicCompendiumsTokensGeneric()
      $(".beneos-chat-actor-info").html("Actors import done ")
      $(".beneos-meter-actor").hide()

    } else {

      let chatData = {
        user: game.user.id,
        rollMode: game.settings.get("core", "rollMode"),
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: `<div><strong>BeneosModule</strong> : Import process started... Please wait end message and <strong>do not refresh</strong> your browser.</div>` +
          `<div><strong>1/4 - Cleanup : </strong><meter class="beneos-meter-delete" min="0" max="100" value="0">100%</meter>&nbsp;<span class="beneos-chat-delete-info"></span></div>`
      }
      ChatMessage.create(chatData);
      await this.deleteCompendiumContent("beneos-module.beneos_module_actors")
      await this.deleteCompendiumContent("beneos-module.beneos_module_items")
      await this.deleteCompendiumContent("beneos-module.beneos_module_spells")
      $(".beneos-chat-delete-info").html("Cleanup finished")
      $(".beneos-meter-delete").hide()

      // Cleanup JSON data local cache
      await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', JSON.stringify({})) 
      await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-spellconfig', JSON.stringify({}))
      await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', JSON.stringify({}))
  
      return; 
      
      chatData.content = `<div><strong>BeneosModule</strong> : Importing actors</div>` +
        `<div><strong>2/4 - Actors : </strong><meter class="beneos-meter-actor" min="0" max="100" value="0">100%</meter>&nbsp;<span class="beneos-chat-actor-info"></span></div>`
      ChatMessage.create(chatData);
      await BeneosCompendiumManager.buildDynamicCompendiumsTokensGeneric()
      $(".beneos-chat-actor-info").html("Actors import done ")
      $(".beneos-meter-actor").hide()

      chatData.content = `<div><strong>BeneosModule</strong> : Importing spells</div>` +
        `<div><strong>3/4 - Spells : </strong><meter class="beneos-meter-spell" min="0" max="100" value="0">100%</meter>&nbsp;<span class="beneos-chat-spell-info"></span></div>`
      ChatMessage.create(chatData);
      await BeneosCompendiumManager.buildDynamicCompendiumsSpellsDD5()
      $(".beneos-chat-spell-info").html("Spells import done ")
      $(".beneos-meter-spell").hide()

      chatData.content = `<div><strong>BeneosModule</strong> : Importing items</div>` +
        `<div><strong>4/4 - Items : </strong><meter class="beneos-meter-item" min="0" max="100" value="0">100%</meter>&nbsp;<span class="beneos-chat-item-info"></span></div>`
      ChatMessage.create(chatData);
      await BeneosCompendiumManager.buildDynamicCompendiumsItemsDD5()
      chatData.content = `<div><strong>BeneosModule</strong> : Items compendium done.<br><strong>All compendiums created, import finished !!</strong></div`
      ChatMessage.create(chatData)
      $(".beneos-chat-item-info").html("Items import done ")
      $(".beneos-meter-item").hide()

      // Reload the settings, as they have been updated during the import
      BeneosUtility.reloadInternalSettings()

      if (game.beneosTokens.searchEngine) {
        console.log("Closing search engine")
        game.beneosTokens.searchEngine.close()
        let newS = new BeneosSearchEngineLauncher
        newS.render(true)
      }

    }
    BeneosCompendiumManager.showImportErrors()

  }

  /********************************************************************************** */
  render() {
    this.performReset()
  }
}

/********************************************************************************** */
export class BeneosCompendiumManager {

  /********************************************************************************** */
  static cleanImportErrors() {
    this.importErrors = []; // clean local error cache
  }
  static async showImportErrors() {
    if (this.importErrors.length > 0) {
      console.log("Global import errors : ", this.importErrors)
      let content = await renderTemplate(`modules/beneos-module/templates/chat-import-error.html`, { errors: this.importErrors })
      let chatData = {
        user: game.user.id,
        rollMode: game.settings.get("core", "rollMode"),
        whisper: ChatMessage.getWhisperRecipients('GM'),
        content: content
      }
      ChatMessage.create(chatData);
    }
  }

  /********************************************************************************** */
  static async showNewItems(itemName, newData, previousData, compendium) {
    let diffData = [] // Detect new import data
    for (let key in newData) {
      if (!previousData[key]) {
        diffData.push(foundry.utils.duplicate(newData[key]))
      }
    }
    let content = itemName + " : No new content detected."
    if (diffData.length > 0) {
      content = await renderTemplate(`modules/beneos-module/templates/chat-new-compendium-data.html`, { itemList: diffData, itemName, compendium })
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
  static async buildDynamicCompendiumsTokensGeneric() {
    ui.notifications.info("BeneosModule : Compendium building .... Please wait !")

    BeneosUtility.resetTokenData()

    let tokenDataFolder = BeneosUtility.getBasePath() + BeneosUtility.getBeneosTokenDataPath()
    let rootFolder = await FilePicker.browse("data", tokenDataFolder)
    if (!rootFolder) {
      ui.notifications.error("BeneosModule : The Beneos Assets folder is not present or configuration is wrong !")
      return
    }

    // get the packs to update/check
    let actorPack
    let pf2NPCRecords
    if (game.system.id == "pf2e") {
      actorPack = game.packs.get("beneos-module.beneos_module_actors_pf2")
      let rPF2 = await fetch("modules/beneos-module/scripts/generic_npc_pf2.json")
      pf2NPCRecords = await rPF2.json()

    } else {
      actorPack = game.packs.get("beneos-module.beneos_module_actors")
    }
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
    // Move above : let rootFolder = await FilePicker.browse("data", tokenDataFolder)
    console.log("ROOT", rootFolder.dirs.length)
    let max = rootFolder.dirs.length
    let count = 0
    for (let subFolder of rootFolder.dirs) {
      // Detect all old token format folder
      if (subFolder.match(/\/(\d{3})_([\w\d_]+)$/)) {
        ChatMessage.create({
          user: game.user.id,
          rollMode: game.settings.get("core", "rollMode"),
          whisper: ChatMessage.getWhisperRecipients('GM'),
          content: `<div><strong class="beneos-text-warning">BeneosModule Warning</strong> : Old token format detected, please update your assets (${subFolder}) </div>`
        });
        continue;
      }
      // Match a subfolder starting with 3 digits and a dash
      let res = subFolder.match(/\/(\d{3})-([\w\d_]+)$/);
      if (res && !subFolder.includes("module_assets") && !subFolder.includes("ability_icons")) {
        // Token config
        let tid = res[1]
        let key = res[2]
        console.log("KEY", tid, key)

        // Build list of variant
        let dataFolder = await FilePicker.browse("data", subFolder)
        let r, actorRecords, journalRecords
        let subTokens = {}
        for (let filename of dataFolder.files) {
          // Load the actor JSON reference file
          if (filename.toLowerCase().includes("actor-") && filename.toLowerCase().includes(".json")) {
            try {
              r = await fetch(filename)
              actorRecords = await r.json()
            }
            catch {
              this.importErrors.push("Error in fetching file " + filename)
              console.log("Error in fetching file", filename);
              continue;
            }
          }
          // Load the journal JSON reference file
          if (filename.toLowerCase().includes("journal-") && filename.toLowerCase().includes(".json")) {
            try {
              r = await fetch(filename)
              journalRecords = await r.json()
            } catch {
              this.importErrors.push("Error in fetching file " + filename)
              console.log("Error in fetching file", filename);
              continue;
            }
          }
          
          // If it matches a webp file 
          if (filename.toLowerCase().includes(".webp")) {
            //console.log("FILENAME", filename)
            // SPlit the filename with the following pattern : 000-name_of_token-variant.webp 
            let res = filename.match("(\\d+)-(\\w*)-(\\d+)-(\\w*)\\.webp")
            if (!res || !res[1] || !res[2] || !res[3]) {
              this.importErrors.push("Error in parsing filename " + filename)
              console.log("Error in parsing filename", filename);
              continue;
            }
            if (res[3] && Number(res[3]) > 0) {              
              if ( ! subTokens[Number(res[3])] ) {
                subTokens[Number(res[3])] = { }
              }
              if (res[4]) {         
                subTokens[Number(res[3])][res[4]] = filename
              }
            }
          }
        }

        //console.log("VARIANTS", subTokens)
        // Process variant and create journal+actors
        for (let idx in subTokens) {
          let model = subTokens[idx]
          let fullId = tid + "_" + key + "_" + idx
          if (!model.token || !model.avatar || !model.journal || !model.dynamic) {
            this.importErrors.push("Error in parsing model " + fullId)
            console.log("Error in parsing model", fullId);
            continue;
          }
          // Create the journal
          try {
            let records = foundry.utils.duplicate(journalRecords)
            records.name = fullId
            records.pages[0].src = model.journal;
            let journal = new JournalEntry(records);
            let imported = await journalPack.importDocument(journal);
            model.journalId = imported.id
          } catch {
            this.importErrors.push("Error in creating journal " + fullId)
            console.log("Error in creating journal", fullId);
          }

          // Create relevant actors
          let actor
          if (game.system.id == "pf2e") {
            let pf2Record = foundry.utils.duplicate(pf2NPCRecords)
            pf2Record.name = actorRecords.name
            pf2Record.img = model.avatar
            pf2Record.prototypeToken.texture.src = model.token
            pf2Record.prototypeToken.name = actorRecords.name
            //actor = await Actor.create(pf2Record, { temporary: true })
            actor = new Actor.implementation(pf2Record)
          } else {
            let records = foundry.utils.duplicate(actorRecords)
            records.img = model.avatar;
            this.replaceItemsPath(records)
            //console.log(">>>>>>>>>>>>>> REC", records, actor)
            if (records.prototypeToken) {
              records.prototypeToken.texture.src = model.token;
            }
            actor = new CONFIG.Actor.documentClass(records);
          }
          if (actor ) {
            let imported = await actorPack.importDocument(actor);
            await imported.setFlag("world", "beneos", { tid: tid, key: key, fullId: fullId, journalId: model.journalId })
            $(".beneos-chat-actor-info").html(actor.name)
            $(".beneos-meter-actor").attr("value", Math.round((count++ / max) * 100));
            //console.log("ACTOR IMPO", imported)
            model.actorId = imported.id
            model.name = actor.name
            model.img = actor.img
          } else {
            this.importErrors.push("Error in creating actor " + records.name)
            console.log("Error in creating actor", records.name);
          }

          if (key) {
            //console.log("Final IDLE list : ", idleList)
            BeneosUtility.beneosTokens[fullId] = {
              actorName: model.name,
              avatar: model.avatar,
              token: model.token,
              journal: model.journal,
              dynamic: model.dynamic,
              actorId: model.actorId,
              journalId: model.journalId,
              folder: subFolder,
              tid: tid,
              key: key,
              searchKey: tid + "-" + key,
              familyId: tid + "_" + key,
              fullId: fullId,
              fullKey: fullId,
              number: idx,
              key: key,
            }
          }
        }
      } else {
        this.importErrors.push("Error in parsing folder " + subFolder)
        console.log("Error in parsing folder", subFolder);
      }
    }

    ui.notifications.info("BeneosModule : Compendium building finished !")
    let previousData = {}
    try {
      previousData = JSON.parse(game.settings.get(BeneosUtility.moduleID(), 'beneos-json-tokenconfig') || {}) // Get the previous config !
    }
    catch {
      previousData = {}
      console.log("Error in parsing JSON for Tokens previousData, warning only all content has been re-imported")
    }
    if (game.system.id == "pf2e") {
      await this.showNewItems("Actors", BeneosUtility.beneosTokens, previousData, "Compendium.beneos-module.beneos_module_actors_pf2.Actor")
    } else  {
      await this.showNewItems("Actors", BeneosUtility.beneosTokens, previousData, "Compendium.beneos-module.beneos_module_actors.Actor")
    } 

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
    let spellDataFolder = BeneosUtility.getBasePath() + BeneosUtility.getBeneosSpellDataPath()

    // get the packs to update/check
    let spellPack = game.packs.get("beneos-module.beneos_module_spells")
    await spellPack.getIndex()
    await spellPack.configure({ locked: false })

    // Parse subfolder
    let rootFolder
    try {
      rootFolder = await FilePicker.browse("data", spellDataFolder)
    } catch {
      console.log("Error in fetching root folder", spellDataFolder)
      return;
    }
    let max = rootFolder.dirs.length
    let count = 0
    console.log("ROOT", rootFolder)
    for (let subFolder of rootFolder.dirs) {
      console.log("SUBFOLDER", subFolder)
      let res = subFolder.match("/(\\d*)_")
      if (res && !subFolder.includes("module_assets") && !subFolder.includes("ability_icons")) {

        let dataFolder = await FilePicker.browse("data", subFolder)
        // And root folder to get json definitions and additionnel idle tokens
        for (let filename of dataFolder.files) {
          if (filename.toLowerCase().includes(".json")) {
            let r, records
            try {
              r = await fetch(filename)
              records = await r.json()
            }
            catch {
              this.importErrors.push("Error in fetching file " + filename)
              console.log("Error in fetching file", filename);
              continue;
            }
            if (r && records) {
              //let spell = await Item.create(records, { temporary: true })
              let spell = new game.dnd5e.documents.Item5e(records);
              $(".beneos-chat-spell-info").html(spell.name)
              $(".beneos-meter-spell").attr("value", Math.round((count++ / max) * 100));
              let iSpell = await spellPack.importDocument(spell)
              let key = subFolder.replace(/\/$/, "").split("/").pop();
              console.log("KEY", key, subFolder)
              BeneosUtility.beneosSpells[key] = { spellId: iSpell.id, id: iSpell.id, name: spell.name }
            }
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
      previousData = {}
      console.log("Error in parsing JSON for Spells previousData, warning only all content has been re-imported")
    }
    await this.showNewItems("Spells", BeneosUtility.beneosSpells, previousData, "Compendium.beneos-module.beneos_module_spells.Item")

    let toSave = JSON.stringify(BeneosUtility.beneosSpells)
    console.log("Saving data spells:", toSave)
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
    let rootFolder
    try {
      rootFolder = await FilePicker.browse("data", itemDataFolder)
    } catch {
      console.log("Error in fetching root folder", itemDataFolder)
      return;
    }
    let max = rootFolder.dirs.length
    let count = 0
    if ( !rootFolder ) {}
    //console.log("ROOT", rootFolder)
    for (let subFolder of rootFolder.dirs) {
      //console.log("SUBFOLDER", subFolder)
      let res = subFolder.match("/(\\d*)_")
      if (res && !subFolder.includes("module_assets") && !subFolder.includes("ability_icons")) {

        let dataFolder = await FilePicker.browse("data", subFolder)
        // And root folder to get json definitions and additionnel idle tokens
        for (let filename of dataFolder.files) {
          if (filename.toLowerCase().includes(".json")) {
            let r, records
            try {
              r = await fetch(filename)
              records = await r.json()
            }
            catch {
              this.importErrors.push("Error in fetching file " + filename)
              console.log("Error in fetching file", filename);
              continue;
            }
            if (r && records) {
              //let item = await Item.create(records, { temporary: true })
              let item = new game.dnd5e.documents.Item5e(records);
              $(".beneos-chat-item-info").html(item.name)
              $(".beneos-meter-item").attr("value", Math.round((count++ / max) * 100));
              let iItem = await itemPack.importDocument(item)
              let key = subFolder.replace(/\/$/, "").split("/").pop();
              BeneosUtility.beneosItems[key] = { itemId: iItem.id, id: iItem.id }
            }
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
      previousData = {}
      console.log("Error in parsing JSON for Items previousData, warning only all content has been re-imported")
    }
    await this.showNewItems("Items", BeneosUtility.beneosItems, previousData, "Compendium.beneos-module.beneos_module_items.Item")

    let toSave = JSON.stringify(BeneosUtility.beneosItems)
    //console.log("Saving data :", toSave)
    game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', toSave) // Save the token config !
  }

  /********************************************************************************** */
  static replaceItemsPath(records) {
    for (let item of records.items) {
      if (item?.img.match("ability_icons")) {
        let filename = item.img.substring(item.img.lastIndexOf("/") + 1)
        item.img = "modules/beneos-module/icons/ability_icons/" + filename
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