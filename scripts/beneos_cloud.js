import { BeneosUtility } from "./beneos_utility.js"

// Global parameters
const redirect_uri = 'https://beneos.cloud/index.php';
const client_id = 'Vlql3B0mCqWge1GkA8dWJ0E4WjAnLzmZAAqBeWTBL-P3PaSmMQlsX92n3Ji6tBv3';

export class BeneosCloudLogin extends FormApplication {

  loginRequest() {

    if (!game.user.isGM) return;

    // Do we have already a UserID ?
    let userId = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-user-id")
    if (!userId || userId == '') {
      userId = foundry.utils.randomID(32)
    }
    console.log("User ID: ", userId)
    let patreonURL = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${client_id}&redirect_uri=${redirect_uri}&scope=identity identity.memberships&state=${userId}`
    console.log("URL: ", patreonURL)
    window.open(patreonURL, '_blank');

    // Poll the index.php for the access_token
    let self = this
    let pollInterval = setInterval(function() {
      let url = `https://beneos.cloud/foundry-manager.php?check=1&foundryId=${userId}`
      fetch(url)
        .then(response => response.json())
        .then(data => {
          console.log(data)
          if( data.access_token ) {
            clearInterval(pollInterval)
            game.settings.set("beneos-cloud", "beneos-cloud-user-id", userId)
            console.log("User id saved", userId)
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


}