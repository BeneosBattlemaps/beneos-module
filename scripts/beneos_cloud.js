import { BeneosUtility } from "./beneos_utility.js"
import { BeneosSearchEngineLauncher } from "./beneos_search_engine.js"

export class BeneosCloudSettings extends FormApplication {
  render() {
    if (game.beneos.cloud) {
      game.beneos.cloud.disconnect()
    }
  }
}

export class BeneosCloudLogin extends FormApplication {

  /********************************************************************************** */
  constructor(origin = null) {
    super()
    this.requestOrigin = origin
  }

  /********************************************************************************** */
  async loginDialog() {

    let content = await renderTemplate("modules/beneos-module/templates/beneos-cloud-login.html", {})

    const dialogContext = await foundry.applications.api.DialogV2.wait({
      window: { title: "Login to Beneos Cloud" },
      classes: ["dialog", "app", "window-app"],
      content,
      buttons: [{
        action: "login",
        label: "Login",
        default: true,
        callback: (event, button, dialog) => {
          const output = Array.from(button.form.elements).reduce((obj, input) => {
            if (input.name) obj[input.name] = input.value
            return obj
          }, {})
          return output
        },
      }, {
        action: "cancel",
        label: "Cancel",
        callback: (event, button, dialog) => {
          return null
        }
      }],
      actions: {
      },
      render: (event, dialog) => { }
    })

    return dialogContext
  }

  /********************************************************************************** */
  async loginRequest(loginData = null) {

    if (!game.user.isGM) return;

    // Do we have already a UserID ?
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    if (!userId || userId == '') {
      userId = foundry.utils.randomID(32)
    }
    console.log("User ID: ", userId)

    if (loginData == null || typeof loginData === 'boolean') {
      // If we don't have login data, we need to ask the user
      console.log("No login data, asking user")
      // Show the login dialog
      loginData = await this.loginDialog()
      if (!loginData) {
        ui.notifications.warn("BeneosModule : Login cancelled !")
        return;
      }
    }

    let cloudLoginURL = `https://beneos.cloud/foundry-login.php?email=${loginData.email}&password=${loginData.password}&foundryId=${userId}`
    fetch(cloudLoginURL, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(data => {
        console.log("BENEOS Cloud login data", data)
        if (data.result == 'OK') {
          console.log("BENEOS Cloud login success")
          this.pollForAccess(userId)
        } else {
          console.log("BENEOS Cloud login error", data)
          ui.notifications.error("BeneosModule : Unable to connect to BeneosCloud, please check your credentials !")
        }
      })
  }

  /********************************************************************************** */
  pollForAccess(userId) {
    // Poll the index.php for the access_token
    let self = this
    self.nb_wait = 0;
    this.foundryId = userId;
    let requestOrigin = this.requestOrigin

    let pollInterval = setInterval(function () {
      let url = `https://beneos.cloud/foundry-manager.php?check=1&foundryId=${userId}`
      fetch(url, { credentials: 'same-origin' })
        .then(response => response.json())
        .then(data => {
          self.nb_wait++;
          if (self.nb_wait > 30) {
            clearInterval(pollInterval)
          }
          console.log("Fecth response:", data)
          if (data.result == 'OK') {
            clearInterval(pollInterval)
            game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-foundry-id", userId)
            game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-patreon-status", data.patreon_status)
            game.beneos.cloud.setLoginStatus(true)
            ui.notifications.info("BeneosModule : You are now connected to BeneosCloud !")
            if (requestOrigin == "searchEngine") {
              game.settings.set(BeneosUtility.moduleID(), "beneos-reload-search-engine", true)
            }
            setTimeout(() => {
              window.location.reload()
            }, 200)
          }
        })
    }, 1000)
  }

  /********************************************************************************** */
  render(loginData = null) {
    this.loginRequest(loginData)
  }
}

/********************************************************************************** */
export class BeneosCloud {

  cloudConnected = false
  availableContent = []

  loginAttempt() {
    this.setLoginStatus(false)
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    if (!userId || userId == '') {
      // Outputs a warning message
      ui.notifications.warn("You are not connected to BeneosCloud. Please connect to BeneosCloud thru the Settings form if you want to import Beneos assets.")
      return;
    }

    // Check login validity
    let url = `https://beneos.cloud/foundry-manager.php?check=1&foundryId=${userId}`
    fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(data => {
        console.log("BENEOS Cloud login data", data)
        if (data.result == 'OK') {
          game.beneos.cloud.setLoginStatus(true)
          game.beneos.cloud.checkAvailableContent()
        }
      })
  }

  async disconnect() {
    this.setLoginStatus(false)
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-foundry-id", "")
    await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-patreon-status", "no_patreon")
    setTimeout(() => {
      console.log("BeneosModule : You are now disconnected from BeneosCloud !")
      location.reload()
    }, 200)
  }

  isLoggedIn() {
    return this.cloudConnected
  }

  getPatreonStatus() {
    return game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-patreon-status")
  }

  setLoginStatus(status) {
    this.cloudConnected = status
  }

  setAvailableContent(content) {
    this.availableContent = content
  }

  getTokenTS(key) {
    let content = this.availableContent.tokens
    if (!content || content?.length == 0) return false
    for (const element of content) {
      if (element.key.toLowerCase() == key.toLowerCase()) {
        return element.updated_ts
      }
    }
    return false
  }

  getItemTS(key) {
    let content = this.availableContent.items
    if (!content || content.length == 0) return false
    for (const element of content) {
      if (element.key.toLowerCase() == key.toLowerCase()) {
        return element.updated_ts
      }
    }
    return false
  }

  getSpellTS(key) {
    let content = this.availableContent.spells
    if (!content || content.length == 0) return false
    for (const element of content) {
      if (element.key.toLowerCase() == key.toLowerCase()) {
        return element.updated_ts
      }
    }
    return false
  }

  isNew(key) {
    let content = this.availableContent.tokens
    if (!content || content?.length == 0) return false
    for (const element of content) {
      if (element.key.toLowerCase() == key.toLowerCase()) {
        // Is new if the updated_ts is greater than the current date minus 30 days
        let t30days = 30 * 24 * 60 * 60
        let tNow30Days = Math.floor(Date.now() / 1000) - t30days
        return element.updated_ts >= tNow30Days;
      }
    }
    return false
  }

  isTokenAvailable(key) {
    let content = this.availableContent.tokens
    if (!content || content?.length == 0) {
      console.log("No tokens available from BeneosCloud")
      return false
    }
    for (const element of content) {
      if (element.key.toLowerCase() == key.toLowerCase()) {
        return true
      }
    }
    return false
  }

  isItemAvailable(key) {
    let content = this.availableContent.items
    if (!content || content.length == 0) return false
    for (const element of content) {
      if (element.key.toLowerCase() == key.toLowerCase()) {
        return true
      }
    }
    return false
  }

  isSpellAvailable(key) {
    let content = this.availableContent.spells
    if (!content || content.length == 0) return false
    for (const element of content) {
      if (element.key.toLowerCase() == key.toLowerCase()) {
        return true
      }
    }
    return false
  }

  checkAvailableContent() {
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `https://beneos.cloud/foundry-manager.php?get_content=1&foundryId=${userId}`
    fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(data => {
        console.log("BENEOS Cloud available content", data)
        if (data.result == 'OK') {
          console.log("Available content: ", data.data)
          game.beneos.cloud.setAvailableContent(data.data)
        }
      })
  }

  sendChatMessageResult(event, assetName = "Token", name = undefined) {
    let content
    if (name) {
      content = `<div><strong>BeneosModule</strong> - ${assetName} : ${name} successfully installed.</div>`
    } else {
      content = `<div><strong>BeneosModule</strong> - Selected ${assetName}s has been installed.</div>`
    }
    console.log("Sending chat message result for", assetName, name, content)
    let chatData = {
      user: game.user.id,
      rollMode: game.settings.get("core", "rollMode"),
      whisper: ChatMessage.getWhisperRecipients('GM'),
      content: content,
    }
    if (event) {
      chatData.content += `<div>It was installed from a Drag&Drop operation, you can now access them from the Beneos Compendium</div>`
    }
    ChatMessage.create(chatData);

  }

  async importItemToCompendium(itemArray, event, isBatch = false) {
    this.beneosItems = {}
    console.log("Importing item to compendium", itemArray)

    let tNow = Date.now()
    let properName

    let itemPack
    if (game.system.id == "pf2e") {
      return
    } else {
      itemPack = game.packs.get("beneos-module.beneos_module_items")

    }
    if (!itemPack) {
      ui.notifications.error("BeneosModule : Unable to find compendiums, please check your installation !")
      return
    }
    let itemRecords = await itemPack.getIndex()
    if (!isBatch) {
      await itemPack.configure({ locked: false })
    }

    for (let itemKey in itemArray) {
      let itemData = itemArray[itemKey]
      // Get the common actor data
      let itemObjectData = itemData.itemJSON

      let finalFolder = `beneos_assets/cloud/items/${itemKey}`
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud/items");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", finalFolder);
      } catch (err) {
        console.log("Directory already exists")
      }
      console.log("Item", itemData, itemObjectData)
      // Decode the base64 tokenImg and upload it to the FilePicker
      let base64Response = await fetch(`data:image/webp;base64,${itemData.itemImage.front.image64}`);
      let blob = await base64Response.blob();
      let file = new File([blob], itemData.itemImage.front.filename, { type: "image/webp" });
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

      base64Response = await fetch(`data:image/webp;base64,${itemData.itemImage.back.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], itemData.itemImage.back.filename, { type: "image/webp" });
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

      itemObjectData.system.description.value = itemObjectData.system.description.value.replaceAll("beneos_assets/beneos_items/", "beneos_assets/cloud/items/")

      base64Response = await fetch(`data:image/webp;base64,${itemData.itemImage.icon.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], itemData.itemImage.icon.filename, { type: "image/webp" });
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });
      itemObjectData.img = `${finalFolder}/${itemData.itemImage.icon.filename}`

      let item = new CONFIG.Item.documentClass(itemObjectData);
      if (item) {
        // Search if we have already an actor with the same name in the compendium
        let existingItem = itemRecords.find(a => a.name == item.name && a.img == item.img)
        if (existingItem) {
          console.log("Deleting existing item", existingItem._id)
          await Item.deleteDocuments([existingItem._id], { pack: "beneos-module.beneos_module_items" })
        }
        // And then create it again
        let imported = await itemPack.importDocument(item);
        properName = imported.name
        await imported.setFlag("world", "beneos", { itemKey, fullId: itemKey, idx: 1, installationDate: tNow })
        BeneosUtility.beneosItems[itemKey] = {
          itemName: imported.name,
          img: imported.img,
          itemId: imported.id,
          folder: finalFolder,
          itemKey: itemKey,
          fullId: itemKey,
          installDate: tNow,
          number: 1
        }
      }
    }

    let toSave = JSON.stringify(BeneosUtility.beneosItems)
    console.log("Saving ITEM data :", toSave)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', toSave) // Save the token config !


    if (!isBatch) { // Lock/Unlock only in single install mode
      this.sendChatMessageResult(event, "Item", properName)
      await itemPack.configure({ locked: true })
      BeneosSearchEngineLauncher.closeAndSave()
      setTimeout(() => {
        new BeneosSearchEngineLauncher().render()
      }, 100)
    } else {
      this.updateInstalledAssets() // Update the installed assets count
    }
  }

  async importSpellToCompendium(spellArray, event, isBatch = false) {
    this.beneosSpells = {}

    let tNow = Date.now()
    let properName

    let spellPack
    if (game.system.id == "pf2e") {
      return
    } else {
      spellPack = game.packs.get("beneos-module.beneos_module_spells")
    }
    if (!spellPack) {
      ui.notifications.error("BeneosModule : Unable to find compendiums, please check your installation !")
      return
    }
    let spellRecords = await spellPack.getIndex()
    if (!isBatch) { // Lock/Unlock only in single install mode
      await spellPack.configure({ locked: false })
    }

    for (let spellKey in spellArray) {
      let spellData = spellArray[spellKey]
      // Get the common actor data
      let spellObjectData = spellData.spellJSON
      let finalFolder = `beneos_assets/cloud/spells/${spellKey}`
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud/spells");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", finalFolder);
      } catch (err) {
        console.log("Directory already exists")
      }
      // console.log("Spell", spellData, spellObjectData )
      // Decode the base64 tokenImg and upload it to the FilePicker
      let base64Response = await fetch(`data:image/webp;base64,${spellData.spellImage.front.image64}`);
      let blob = await base64Response.blob();
      let file = new File([blob], spellData.spellImage.front.filename, { type: "image/webp" });
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

      spellObjectData.system.description.value = spellObjectData.system.description.value.replaceAll("beneos_assets/beneos_spells/", "beneos_assets/cloud/spells/")

      base64Response = await fetch(`data:image/webp;base64,${spellData.spellImage.icon.image64}`);
      blob = await base64Response.blob();
      file = new File([blob], spellData.spellImage.icon.filename, { type: "image/webp" });
      await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });
      spellObjectData.img = `${finalFolder}/${spellData.spellImage.icon.filename}`

      let spell = new CONFIG.Item.documentClass(spellObjectData);
      if (spell) {
        // Search if we have already an actor with the same name in the compendium
        let existingSpell = spellRecords.find(a => a.name == spell.name && a.img == spell.img)
        if (existingSpell) {
          console.log("Deleting existing spell", existingSpell._id)
          await Item.deleteDocuments([existingSpell._id], { pack: "beneos-module.beneos_module_spells" })
        }
        // And then create it again
        let imported = await spellPack.importDocument(spell);
        properName = imported.name
        await imported.setFlag("world", "beneos", { spellKey, fullId: spellKey, idx: 1, installationDate: tNow })
        BeneosUtility.beneosSpells[spellKey] = {
          itemName: imported.name,
          img: imported.img,
          spellId: imported.id,
          folder: finalFolder,
          spellKey: spellKey,
          fullId: spellKey,
          installDate: tNow,
          number: 1
        }
      }
    }
    let toSave = JSON.stringify(BeneosUtility.beneosSpells)
    console.log("Saving SPELL data :", toSave)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-spellconfig', toSave) // Save the token config !

    if (!isBatch) { // Lock/Unlock only in single install mode
      this.sendChatMessageResult(event, "Spell", properName)
      await spellPack.configure({ locked: true })
      BeneosSearchEngineLauncher.closeAndSave()
      setTimeout(() => {
        new BeneosSearchEngineLauncher().render()
      }, 100)
    } else {
      this.updateInstalledAssets() // Update the installed assets count
    }
  }

  async importTokenToCompendium(tokenArray, event, isBatch = false) {

    console.log("Importing token to compendium", tokenArray, event, isBatch)

    let tNow = Math.floor(Date.now() / 1000) // Get the current date in seconds
    let properName

    let actorDataPF2
    let packName = "beneos-module.beneos_module_journal"
    let actorPack = BeneosUtility.getActorPack()
    if (game.system.id == "pf2e") {
      packName = "beneos-module.beneos_module_actors_pf2"
      let rPF2 = await fetch("modules/beneos-module/scripts/generic_npc_pf2.json")
      actorDataPF2 = await rPF2.json()
    }

    let journalPack = BeneosUtility.getJournalPack()
    if (!actorPack || !journalPack) {
      ui.notifications.error("BeneosModule : Unable to find compendiums, please check your installation !")
      return
    }
    let actorRecords = await actorPack.getIndex()
    let journalRecords = await journalPack.getIndex()

    if (!isBatch) { // Lock/Unlock only in single install mode
      await actorPack.configure({ locked: false })
      await journalPack.configure({ locked: false })
    }

    for (let tokenKey in tokenArray) {
      let tokenData = tokenArray[tokenKey]
      // Get the common actor data
      let actorData = tokenData.actorJSON
      if (actorDataPF2) {
        let name = tokenData.actorJSON.name
        actorData = actorDataPF2
        actorDataPF2.name = name
      }

      let finalFolder = `beneos_assets/cloud/tokens/${tokenKey}`
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "beneos_assets/cloud/tokens");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", finalFolder);
      } catch (err) {
        console.log("Directory already exists")
      }
      // Add journal entry
      let journalData = tokenData.journalJSON


      for (let i = 0; i < tokenData.tokenImages.length; i++) {
        let fullId = tokenKey + "_" + (i + 1)

        // Decode the base64 tokenImg and upload it to the FilePicker
        let base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].token.image64}`);
        let blob = await base64Response.blob();
        let file = new File([blob], tokenData.tokenImages[i].token.filename, { type: "image/webp" });
        await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].journal.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].journal.filename, { type: "image/webp" });
        await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].avatar.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].avatar.filename, { type: "image/webp" });
        await foundry.applications.apps.FilePicker.implementation.upload("data", finalFolder, file, {}, { notify: false });

        // Create the journal entry
        journalData.pages[0].src = `${finalFolder}/${tokenData.tokenImages[i].journal.filename}`
        journalData.name = actorData.name + " " + (i + 1)
        let journal = new JournalEntry(journalData);
        let newJournal
        if (journal) {
          // Search for existing journal entry
          let existingJournal = journalRecords.find(j => j.name == journal.name && j.img == journal.img)
          if (existingJournal) {
            console.log("Deleting existing journal", existingJournal._id)
            await JournalEntry.deleteDocuments([existingJournal._id], { pack: "beneos-module.beneos_module_journal" })

          }
          newJournal = await journalPack.importDocument(journal);
          await newJournal.setFlag("world", "beneos", { tokenkey: tokenKey, fullId: fullId, idx: i, installDate: tNow })
        }

        actorData.img = `${finalFolder}/${tokenData.tokenImages[i].avatar.filename}`
        actorData.prototypeToken.texture.src = `${finalFolder}/${tokenData.tokenImages[i].token.filename}`
        let actor = new CONFIG.Actor.documentClass(actorData);
        if (actor) {
          // Search if we have already an actor with the same name in the compendium
          let existingActor = actorRecords.find(a => a.name == actor.name && a.img == actorData.img)
          if (existingActor) {
            console.log("Deleting existing actor", existingActor._id)
            await Actor.deleteDocuments([existingActor._id], { pack: packName })
          }
          // And then create it again
          let imported = await actorPack.importDocument(actor);
          properName = imported.name
          await imported.setFlag("world", "beneos", { tokenKey, fullId, idx: i, journalId: newJournal.id, installationDate: Date.now() })
          //console.log("ACTOR IMPO", imported)
          BeneosUtility.beneosTokens[fullId] = {
            actorName: imported.name,
            avatar: actorData.img,
            token: actorData.prototypeToken.texture.src,
            actorId: imported.id,
            installDate: tNow,
            journalId: newJournal.id,
            folder: finalFolder,
            tokenKey: tokenKey,
            fullId: fullId,
            number: i + 1
          }
        } else {
          this.importErrors.push("Error in creating actor " + records.name)
          console.log("Error in creating actor", records.name);
        }
      }
    }
    let toSave = JSON.stringify(BeneosUtility.beneosTokens)
    console.log("Saving data :", toSave)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', toSave) // Save the token config !

    if (!isBatch) { // Lock/Unlock only in single install mode
      this.sendChatMessageResult(event, "Token", properName)
      await actorPack.configure({ locked: true })
      await journalPack.configure({ locked: true })
      BeneosSearchEngineLauncher.closeAndSave()
      setTimeout(() => {
        new BeneosSearchEngineLauncher().render()
      }, 100)
    } else {
      this.updateInstalledAssets() // Update the installed assets count
    }
  }

  async batchInstall(assetList) {
    await BeneosUtility.lockUnlockAllPacks(false)     // Unlock all packs before batch install
    // COunt the number of assets to install
    this.nbInstalled = 0
    this.toInstall = Object.keys(assetList).length
    if (this.toInstall == 0) {
      ui.notifications.warn("BeneosModule : No assets to install from BeneosCloud !")
      return;
    }
    // Loop thru the assetList and install them
    for (let key in assetList) {
      let asset = assetList[key]
      console.log("Batch installing asset", asset)
      if (asset.type == "actor" || asset.type == "token") {
        this.importTokenFromCloud(asset.key, undefined, true)
      } else if (asset.type == "item") {
        this.importItemFromCloud(asset.key, undefined, true)
      } else if (asset.type == "spell") {
        this.importSpellsFromCloud(asset.key, undefined, true)
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    //await BeneosUtility.lockUnlockAllPacks(true) // Lock all packs after batch install
  }

  updateInstalledAssets() {
    this.nbInstalled++;
    if (this.nbInstalled >= this.toInstall) {
      setTimeout(() => {
        BeneosUtility.lockUnlockAllPacks(true) // Lock all packs after batch install
        ui.notifications.info(`BeneosModule : ${this.nbInstalled} assets have been installed from BeneosCloud !`)
        game.beneos.cloud.sendChatMessageResult(null, game.beneos.cloud.importAsset)
        BeneosSearchEngineLauncher.closeAndSave()
        setTimeout(() => {
          new BeneosSearchEngineLauncher().render()
        }, 100)
      }, 400)
    }
  }

  importTokenFromCloud(tokenKey, event = undefined, isBatch = false) {
    ui.notifications.info("Importing token from BeneosCloud !")
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `https://beneos.cloud/foundry-manager.php?get_token=1&foundryId=${userId}&tokenKey=${tokenKey}`
    fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importAsset = "Token"
          game.beneos.cloud.importTokenToCompendium({ [`${tokenKey}`]: data.data.token }, event, isBatch)
        } else {
          console.log("Error in importing Token from BeneosCloud !", data, tokenKey)
          ui.notifications.error("Error in importing token from BeneosCloud !")
        }
      })
  }

  importItemFromCloud(itemKey, event = undefined, isBatch = false) {
    ui.notifications.info("Importing item from BeneosCloud !")
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `https://beneos.cloud/foundry-manager.php?get_item=1&foundryId=${userId}&itemKey=${itemKey}`
    fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importAsset = "Item"
          game.beneos.cloud.importItemToCompendium({ [`${itemKey}`]: data.data.item }, event, isBatch)
        } else {
          console.log("Error in importing Item from BeneosCloud !", data, itemKey)
          ui.notifications.error("Error in importing Item from BeneosCloud !", data)
        }
      })
  }

  importSpellsFromCloud(spellKey, event = undefined, isBatch = false

  ) {
    ui.notifications.info("Importing spell from BeneosCloud !")
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `https://beneos.cloud/foundry-manager.php?get_spell=1&foundryId=${userId}&spellKey=${spellKey}`
    fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importAsset = "Spell"
          game.beneos.cloud.importSpellToCompendium({ [`${spellKey}`]: data.data.spell }, event, isBatch)
        } else {
          console.log("Error in importing Spell from BeneosCloud !", data, spellKey)
          ui.notifications.error("Error in importing Spell from BeneosCloud !")
        }
      })
  }

}