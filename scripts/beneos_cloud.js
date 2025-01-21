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

  importTokenFromCloud(tokenKey) {
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id")
    let url = `https://beneos.cloud/foundry-manager.php?get_token=1&foundryId=${userId}&tokenKey=${tokenKey}`
    fetch(url, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(async function (data) {
        if (data.result == 'OK') {
          console.log("Token data: ", data.data)  
          let actor = CONFIG.Actor.documentClass.create(data.data.token.actorJSON);
          let journal = JournalEntry.create(data.data.token.journalJSON);
          
          try { 
            await FilePicker.createDirectory("data", "beneos_assets/cloud");  
            await FilePicker.createDirectory("data", "beneos_assets/cloud/tokens");  
          } catch (err) {
            console.log("Directory already exists")
          }
  
          for (let i=0; i<data.data.token.tokenImages.length; i++) {
            // Decode the base64 tokenImg and upload it to the FilePicker
            let base64Response = await fetch(`data:image/webp;base64,${data.data.token.tokenImages[i].token.image64}`);
            let blob = await base64Response.blob();
            let file = new File([blob], data.data.token.tokenImages[i].token.filename, { type: "image/webp" }) ;
            let response = await FilePicker.upload("data", "beneos_assets/cloud/tokens/", file, {});

            base64Response = await fetch(`data:image/webp;base64,${data.data.token.tokenImages[i].journal.image64}`);
            blob = await base64Response.blob();
            file = new File([blob], data.data.token.tokenImages[i].journal.filename, { type: "image/webp" }) ;
            response = await FilePicker.upload("data", "beneos_assets/cloud/tokens/", file, {});

            base64Response = await fetch(`data:image/webp;base64,${data.data.token.tokenImages[i].avatar.image64}`);
            blob = await base64Response.blob();
            file = new File([blob], data.data.token.tokenImages[i].avatar.filename, { type: "image/webp" }) ;
            response = await FilePicker.upload("data", "beneos_assets/cloud/tokens/", file, {});
          }
        }
      })
  }

}