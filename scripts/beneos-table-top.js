import { BeneosUtility } from "./beneos_utility.js";

/********************************************************************************** */
export class BeneosTableTop {

  static ready() {
    console.log("BeneosTableTop Ready");

    this.enabled = game.settings.get(BeneosUtility.moduleID(), "beneos-table-top-mode");

    Hooks.on("updateScene", (scene, updateData, options, userId) => {
      BeneosTableTop.manageGridOpacity(scene, updateData);
    });
  }


  static manageGridOpacity(scene, updateData) {
    if (!game.user.isGM) return; // GM Only

    if (updateData.active === true) {
      let beneosTTFlags = scene.getFlag(BeneosUtility.moduleID(), "beneos-tt-flags");
      if (beneosTTFlags === undefined) {
        beneosTTFlags = {};
      }

      // Manage token vision 
      if (game.settings.get(BeneosUtility.moduleID(), "beneos-tt-token-vision")) {
        if (this.enabled) {
          beneosTTFlags.tokenVision = scene.tokenVision;
          scene.setFlag(BeneosUtility.moduleID(), "beneos-tt-flags", beneosTTFlags);
          console.log("token vision : ", scene.tokenVision);
          scene.update({ 'tokenVision': false });
        } else if (beneosTTFlags.tokenVision !== undefined) {
          scene.update({ 'tokenVision': beneosTTFlags.tokenVision });
        }
      }

      if (game.settings.get(BeneosUtility.moduleID(), "beneos-tt-grid-visibility")) {
        if (this.enabled) {
          // Save the grid opacity
          beneosTTFlags.gridOpacity = scene.grid.alpha;
          scene.setFlag(BeneosUtility.moduleID(), "beneos-tt-flags", beneosTTFlags);
          // Set the new grid opacity
          let gridOpacity = game.settings.get(BeneosUtility.moduleID(), "beneos-tt-grid-visibility-opacity");
          console.log("Scene : ", scene);
          scene.update({ 'grid.alpha': gridOpacity })
        } else if (beneosTTFlags.gridOpacity !== undefined) {
          scene.update({ 'grid.alpha': beneosTTFlags.gridOpacity });
        }
      }
    }
  }


}