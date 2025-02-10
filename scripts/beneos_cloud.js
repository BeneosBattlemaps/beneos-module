import { BeneosUtility } from "./beneos_utility.js"

// Global parameters
const redirect_uri = 'https://beneos.cloud/index.php';
const client_id = 'Vlql3B0mCqWge1GkA8dWJ0E4WjAnLzmZAAqBeWTBL-P3PaSmMQlsX92n3Ji6tBv3';

export class BeneosCloudLogin extends FormApplication {

  loginRequest() {

    if (!game.user.isGM) return;

    // Do we have already a UserID ?
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    if (!userId || userId == '') {
      userId = foundry.utils.randomID(32)
    }
    console.log("User ID: ", userId)
    let patreonURL = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${client_id}&redirect_uri=${redirect_uri}&scope=identity identity.memberships&state=${userId}`
    console.log("URL: ", patreonURL)
    window.open(patreonURL, '_blank');

    // Poll the index.php for the access_token
    let self = this
    self.nb_wait = 0;
    this.foundryId = userId;

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
        console.log(data)
        if (data.result == 'OK') {
          game.beneos.cloud.setLoginStatus(true)
          game.beneos.cloud.checkAvailableContent()
        }
      })
  }

  setLoginStatus(status) {
    this.cloudConnected = status
  }

  setAvailableContent(content) {
    this.availableContent = content
  }

  isTokenAvailable(key) {
    let content = this.availableContent.tokens
    if (content.length == 0) return false
    for (let i = 0; i < content.length; i++) {
      if (content[i].key == key) {
        return true
      }
    }
    return false
  }

  isItemAvailable(key) {
    let content = this.availableContent.items
    if (content.length == 0) return false
    for (let i = 0; i < content.length; i++) {
      if (content[i].key == key) {
        return true
      }
    }
    return false
  }

  isSpellAvailable(key) {
    let content = this.availableContent.spells
    if (content.length == 0) return false
    for (let i = 0; i < content.length; i++) {
      if (content[i].key == key) {
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
        console.log(data)
        if (data.result == 'OK') {
          console.log("Available content: ", data.data)
          game.beneos.cloud.setAvailableContent(data.data)
        }
      })
  }

  sendChatMessageResult() {

  }

  async importItemToCompendium(itemArray) {
    this.beneosItems = {}
    console.log("Importing token to compendium", tokenArray)  

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

      for (let i = 0; i < tokenData.tokenImages.length; i++) {
        let fullId = tokenKey + "_" + (i+1)

        // Decode the base64 tokenImg and upload it to the FilePicker
        let base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].token.image64}`);
        let blob = await base64Response.blob();
        let file = new File([blob], tokenData.tokenImages[i].token.filename, { type: "image/webp" });
        let response = await FilePicker.upload("data", finalFolder, file, {});

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].journal.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].journal.filename, { type: "image/webp" });
        response = await FilePicker.upload("data", finalFolder, file, {});

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].avatar.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].avatar.filename, { type: "image/webp" });
        response = await FilePicker.upload("data", finalFolder, file, {});

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
            await journalPack.delete(existingJournal._id)
          }
          newJournal = await journalPack.importDocument(journal);
          await newJournal.setFlag("world", "beneos", { tokenkey: tokenKey, fullId: fullId, idx: i, })
        }

        actorData.img = `${finalFolder}/${tokenData.tokenImages[i].avatar.filename}`
        actorData.prototypeToken.texture.src = `${finalFolder}/${tokenData.tokenImages[i].token.filename}`
        let actor = new CONFIG.Actor.documentClass(actorData);
        if (actor) {
          // Search if we have already an actor with the same name in the compendium 
          let existingActor = actorRecords.find(a => a.name == actor.name && a.img == actorData.img)
          if (existingActor) {
            console.log("Deleting existing actor", existingActor._id)
            await actorPack.delete(existingActor._id)
          }
          // And then create it again
          let imported = await actorPack.importDocument(actor);
          await imported.setFlag("world", "beneos", { tokenKey, fullId, idx: i, journalId: newJournal.id })
          //console.log("ACTOR IMPO", imported)
          BeneosUtility.beneosTokens[fullId] = {
            actorName: imported.name,
            avatar: actorData.img,
            token: actorData.prototypeToken.texture.src ,
            actorId:imported.id,
            journalId: newJournal.id,
            folder: finalFolder,
            tokenKey: tokenKey,
            fullId: fullId,
            number: i+1
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
    await actorPack.configure({ locked: true })
    await journalPack.configure({ locked: true })

  }

  async importTokenToCompendium(tokenArray) {
    
    console.log("Importing token to compendium", tokenArray)  

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
        let response = await FilePicker.upload("data", finalFolder, file, {});

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].journal.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].journal.filename, { type: "image/webp" });
        response = await FilePicker.upload("data", finalFolder, file, {});

        base64Response = await fetch(`data:image/webp;base64,${tokenData.tokenImages[i].avatar.image64}`);
        blob = await base64Response.blob();
        file = new File([blob], tokenData.tokenImages[i].avatar.filename, { type: "image/webp" });
        response = await FilePicker.upload("data", finalFolder, file, {});

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
            await journalPack.delete(existingJournal._id)
          }
          newJournal = await journalPack.importDocument(journal);
          await newJournal.setFlag("world", "beneos", { tokenkey: tokenKey, fullId: fullId, idx: i, })
        }

        actorData.img = `${finalFolder}/${tokenData.tokenImages[i].avatar.filename}`
        actorData.prototypeToken.texture.src = `${finalFolder}/${tokenData.tokenImages[i].token.filename}`
        let actor = new CONFIG.Actor.documentClass(actorData);
        if (actor) {
          // Search if we have already an actor with the same name in the compendium 
          let existingActor = actorRecords.find(a => a.name == actor.name && a.img == actorData.img)
          if (existingActor) {
            console.log("Deleting existing actor", existingActor._id)
            await actorPack.delete(existingActor._id)
          }
          // And then create it again
          let imported = await actorPack.importDocument(actor);
          await imported.setFlag("world", "beneos", { tokenKey, fullId, idx: i, journalId: newJournal.id })
          //console.log("ACTOR IMPO", imported)
          BeneosUtility.beneosTokens[fullId] = {
            actorName: imported.name,
            avatar: actorData.img,
            token: actorData.prototypeToken.texture.src ,
            actorId:imported.id,
            journalId: newJournal.id,
            folder: finalFolder,
            tokenKey: tokenKey,
            fullId: fullId,
            number: i+1,
            installDate: Date.now()
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
    await actorPack.configure({ locked: true })
    await journalPack.configure({ locked: true })

    this.sendChatMessageResult()
  }

  importTokenFromCloud(tokenKey) {
    ui.notifications.info("Importing token from BeneosCloud !")
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `https://beneos.cloud/foundry-manager.php?get_token=1&foundryId=${userId}&tokenKey=${tokenKey}`
    fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          game.beneos.cloud.importTokenToCompendium( { [`${tokenKey}`]: data.data.token } )
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