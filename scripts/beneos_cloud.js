import { BeneosUtility } from "./beneos_utility.js"
import { BeneosSearchEngineLauncher } from "./beneos_search_engine.js"

export class BeneosCloudSettings extends FormApplication {
  render() {
    if (game.beneos.cloud) {
      game.beneos.cloud.disconnect()}
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
      render: (event, dialog) => {}
    })

    return dialogContext
  }

  /********************************************************************************** */
  async loginRequest() {

    if (!game.user.isGM) return;

    // Do we have already a UserID ?
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    if (!userId || userId == '') {
      userId = foundry.utils.randomID(32)
    }
    console.log("User ID: ", userId)

    let loginData = await this.loginDialog()
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
            console.log("User id saved", userId)
            game.beneos.cloud.setLoginStatus(true)
            ui.notifications.info("BeneosModule : You are now connected to BeneosCloud !")
            console.log("Refreshing search engine", requestOrigin)
            if ( requestOrigin == "searchEngine") {
              window.location.reload()
            }
          }
        })
    }, 1000)
  }

  /********************************************************************************** */
  render() {
    this.loginRequest()
  }

}

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

  disconnect() {
    this.setLoginStatus(false)
    game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-foundry-id", "")
    // reload the page
    location.reload()
  }

  isLoggedIn() {
    return this.cloudConnected
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
      if (element.key == key) {
        return element.updated_ts
      }
    }
    return false
  }

  isNew(key) {
    let content = this.availableContent.tokens
    if (!content || content?.length == 0) return false
    for (const element of content) {
      if (element.key == key) {
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
    if (!content || content?.length == 0) return false
    for (const element of content) {
      if (element.key == key) {
        return true
      }
    }
    return false
  }

  isItemAvailable(key) {
    let content = this.availableContent.items
    if (!content || content.length == 0) return false
    for (const element of content) {
      if (element.key == key) {
        return true
      }
    }
    return false
  }

  isSpellAvailable(key) {
    let content = this.availableContent.spells
    if (!content || content.length == 0) return false
    for (const element of content) {
      if (element.key == key) {
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

  sendChatMessageResult(event) {
    let chatData = {
      user: game.user.id,
      rollMode: game.settings.get("core", "rollMode"),
      whisper: ChatMessage.getWhisperRecipients('GM'),
      content: `<div><strong>BeneosModule</strong> : Token(s) has been imported into the beneos module compendium.
      </span></div>`
    }
    if (event) {
      chatData.content += `<div>It was installed from a Drag&Drop operation, you can now access them from the Beneos Compendium</div>`
    }
    ChatMessage.create(chatData);

    /*Unused : if ( game.beneosTokens.searchEngine ) {
      setTimeout( () => {
        game.beneosTokens.searchEngine.updateContent() }, 1000)
    }*/

  }

  async importItemToCompendium(itemArray) {
    this.beneosItems = {}
    console.log("Importing item to compendium", itemArray)

    let tNow = Date.now()

    let itemPack
    if (game.system.id == "pf2e") {
      return
    } else {
      itemPack = game.packs.get("beneos-module.beneos_module_items")

    }
    if (!itemPack ) {
      ui.notifications.error("BeneosModule : Unable to find compendiums, please check your installation !")
      return
    }
    let itemRecords = await itemPack.getIndex()
    await itemPack.configure({ locked: false })

    for (let itemKey in itemArray) {
      let itemData = itemArray[itemKey]
      // Get the common actor data
      let itemObjectData = itemData.itemJSON

      let finalFolder = `beneos_assets/cloud/items/${itemKey}`
      try {
        await FilePicker.createDirectory("data", "beneos_assets/cloud");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await FilePicker.createDirectory("data", "beneos_assets/cloud/items");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await FilePicker.createDirectory("data", finalFolder);
      } catch (err) {
        console.log("Directory already exists")
      }

      for (let i = 0; i < itemData.itemImages.length; i++) {
        let fullId = itemKey + "_" + (i+1)

        // Decode the base64 tokenImg and upload it to the FilePicker
        let base64Response = await fetch(`data:image/webp;base64,${itemData.itemImages[i].image.image64}`);
        let blob = await base64Response.blob();
        let file = new File([blob], tokenData.tokenImages[i].token.filename, { type: "image/webp" });
        await FilePicker.upload("data", finalFolder, file, {});

        itemData.img = `${finalFolder}/${itemData.itemImages[i].image.filename}`
        let item = new CONFIG.Item.documentClass(itemData);
        if (item) {
          // Search if we have already an actor with the same name in the compendium
          let existingItem = itemRecords.find(a => a.name == item.name && a.img == item.img)
          if (existingItem) {
            console.log("Deleting existing item", existingItem._id)
            await Item.deleteDocuments([existingJournal._id], { pack: "beneos-module.beneos_module_items" })
          }
          // And then create it again
          let imported = await itemPack.importDocument(item);
          await imported.setFlag("world", "beneos", { tokenKey, fullId, idx: i, installationDate: tNow })
          //console.log("ACTOR IMPO", imported)
          BeneosUtility.beneosItems[fullId] = {
            itemName: imported.name,
            imf: itemData.img,
            itemId:imported.id,
            folder: finalFolder,
            tokenKey: tokenKey,
            fullId: fullId,
            installDate: tNow,
            number: i+1
          }
        } else {
          this.importErrors.push("Error in creating item " + records.name)
          console.log("Error in creating item", records.name);
        }
      }
    }
    let toSave = JSON.stringify(BeneosUtility.beneosItems)
    console.log("Saving ITEM data :", toSave)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', toSave) // Save the token config !
    await itemPack.configure({ locked: true })
  }

  async importTokenToCompendium(tokenArray, event) {

    console.log("Importing token to compendium", tokenArray)

    let tNow = Math.floor(Date.now() / 1000) // Get the current date in seconds

    let actorPack
    if (game.system.id == "pf2e") {
      actorPack = game.packs.get("beneos-module.beneos_module_actors_pf2")
      let rPF2 = await fetch("modules/beneos-module/scripts/generic_npc_pf2.json")
      actorData = await rPF2.json()

    } else {
      actorPack = game.packs.get("beneos-module.beneos_module_actors")

    }
    let journalPack = game.packs.get("beneos-module.beneos_module_journal")
    if (!actorPack || !journalPack) {
      ui.notifications.error("BeneosModule : Unable to find compendiums, please check your installation !")
      return
    }
    let actorRecords = await actorPack.getIndex()
    let journalRecords = await journalPack.getIndex()

    await actorPack.configure({ locked: false })
    await journalPack.configure({ locked: false })

    for (let tokenKey in tokenArray) {
      let tokenData = tokenArray[tokenKey]
      // Get the common actor data
      let actorData = tokenData.actorJSON

      let finalFolder = `beneos_assets/cloud/tokens/${tokenKey}`
      try {
        await FilePicker.createDirectory("data", "beneos_assets/cloud");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await FilePicker.createDirectory("data", "beneos_assets/cloud/tokens");
      } catch (err) {
        console.log("Directory already exists")
      }
      try {
        await FilePicker.createDirectory("data", finalFolder);
      } catch (err) {
        console.log("Directory already exists")
      }
      // Add journal entry
      let journalData = tokenData.journalJSON


      for (let i = 0; i < tokenData.tokenImages.length; i++) {
        let fullId = tokenKey + "_" + (i+1)

        // Decode the base64 tokenImg and upload it to the FilePicker
        let base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].token.image64}`);
        let blob = await base64Response.blob();
        let file = new File([blob], tokenData.tokenImages[i].token.filename, { type: "image/webp" });
        await FilePicker.upload("data", finalFolder, file, {});

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].journal.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].journal.filename, { type: "image/webp" });
        await FilePicker.upload("data", finalFolder, file, {});

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].avatar.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].avatar.filename, { type: "image/webp" });
        await FilePicker.upload("data", finalFolder, file, {});

        // Create the journal entry
        journalData.pages[0].src = `${finalFolder}/${tokenData.tokenImages[i].journal.filename}`
        journalData.name = actorData.name + " " + (i+1)
        let journal = new JournalEntry(journalData);
        let newJournal
        if ( journal ) {
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
            await Actor.deleteDocuments([existingActor._id], { pack: "beneos-module.beneos_module_actors" })
          }
          // And then create it again
          let imported = await actorPack.importDocument(actor);
          await imported.setFlag("world", "beneos", { tokenKey, fullId, idx: i, journalId: newJournal.id, installationDate: Date.now() })
          //console.log("ACTOR IMPO", imported)
          BeneosUtility.beneosTokens[fullId] = {
            actorName: imported.name,
            avatar: actorData.img,
            token: actorData.prototypeToken.texture.src ,
            actorId:imported.id,
            installDate: tNow,
            journalId: newJournal.id,
            folder: finalFolder,
            tokenKey: tokenKey,
            fullId: fullId,
            number: i+1
          }
          // Import the actor into the world
          //game.actors.importFromCompendium(actorPack, imported.id, { folder: folder.id });


        } else {
          this.importErrors.push("Error in creating actor " + records.name)
          console.log("Error in creating actor", records.name);
        }
      }
    }
    let toSave = JSON.stringify(BeneosUtility.beneosTokens)
    console.log("Saving data :", toSave)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', toSave) // Save the token config !
    await actorPack.configure({ locked: true })
    await journalPack.configure({ locked: true })

    this.sendChatMessageResult(event)

    for (let tokenKey in tokenArray) {
      BeneosSearchEngineLauncher.refresh("token", tokenKey)
    }
    BeneosSearchEngineLauncher.updateDisplay()
  }

  async batchInstall(assetList) {
    // Loop thru the assetList and install them
    for (let key in assetList) {
      let asset = assetList[key]
      if (asset.type == "token") {
        this.importTokenFromCloud(asset.key)
      } else if (asset.type == "item") {
        this.importItemFromCloud(asset.key)
      }
    }
  }

  importTokenFromCloud(tokenKey, event = undefined) {
    ui.notifications.info("Importing token from BeneosCloud !")
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `https://beneos.cloud/foundry-manager.php?get_token=1&foundryId=${userId}&tokenKey=${tokenKey}`
    fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importTokenToCompendium( { [`${tokenKey}`]: data.data.token }, event )
        } else {
          ui.notifications.error("Error in importing token from BeneosCloud !")
        }
      })
  }

  importItemFromCloud(itemKey) {
    ui.notifications.info("Importing item from BeneosCloud !")
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `https://beneos.cloud/foundry-manager.php?get_item=1&foundryId=${userId}&itemKey=${itemKey}`
    fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importItemToCompendium( { [`${itemKey}`]: data.data.item } )
        }
      })
  }

}