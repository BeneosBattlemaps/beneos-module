
const __DEFAULT_VIEW_AREA = { x: 100, y: 100, width: 200, height: 200 };

export class BeneosPlayerView {

  static async onDisplayScene() {
    // Loop thru connected players and force rect display + detect missing players
    let noViews = {}
    for (let player of game.users) {
      if (player.isGM) continue; // Ignore GM
      noViews[player.id] = true;
      for (let d of canvas.scene.drawings) {
        let isUserDrawing = d.getFlag('beneos-module', 'viewer') === player.id;
        if (isUserDrawing) {
          d.visible = true;
          noViews[player.id] = false;
        }
      }
    }

    // Loop thru missing players and create view areas
    for (let userId in noViews) {
      if (noViews[userId]) {
        console.log('Creating view area for ' + userId);
        let user = game.users.get(userId);
        let rect = { x: canvas.stage.x+100, y: canvas.stage.y+100, interface: true, drawingRole: 'information', strokeColor: user.color, shape: { width: canvas.stage.width-200, height: canvas.stage.height-200, type: 'r' }, visible: true, fillType: 0 }
        const defaults = game.settings.get("core", DrawingsLayer.DEFAULT_CONFIG_SETTING);
        const rectData = foundry.utils.mergeObject(defaults, rect);
        let d = await canvas.scene.createEmbeddedDocuments('Drawing', [rectData]);
        await d[0].setFlag('beneos-module', 'viewer', userId);

        // Now create the text label
        //let text = { x: rect.x, y: rect.y - 32, text: user.name, fontSize: 20, fontFamily: "Arial", strokeColor: user.color, textColor: user.color, visible: true, shape: { type: 'r' } }
        //const textData = foundry.utils.mergeObject(defaults, text);
        //let t = await canvas.scene.createEmbeddedDocuments('Drawing', [rectData]);
        //await t[0].setFlag('beneos-module', 'viewer-name', userId);
      }
    }
  }
}

export class BeneosPlayerViewLayer extends CanvasLayer {


  constructor() {
    super();

    this.viewAreas = this.populateViewAreas();
  }

  addContainer() {
    this.container = new PIXI.Container();
    this.addChild(this.container);
  }

  populateViewAreas() {
    // Loop thru connected players 
    // For each player, get their viewer area
    // Add the view area to the views
    let viewAreas = canvas.scene.getFlag('beneos-module', 'view-areas') || {}
    for (let player of game.users) {
      console.log(player);
      if (viewAreas[player.id]) {
        viewAreas[player.id] = player.color;
      } else {
        viewAreas[player.id] = foundry.utils.duplicate(__DEFAULT_VIEW_AREA);
        viewAreas[player.id].color = player.color;
      }
    }
    canvas.scene.setFlag('beneos-module', 'view-areas', viewAreas);
    return viewAreas;
  }

  async _draw(options = {}) {
    //super._draw(options);
    this.drawViewAreas();
  }

  drawViewAreas() {
    for (let userId in this.viewAreas) {
      let viewArea = this.viewAreas[userId];
      //console.log(viewArea);
      let graphics = new PIXI.Graphics();
      graphics.lineStyle(2, viewArea.color, 1);
      //graphics.beginFill(0xFF00BB, 0.01);
      graphics.drawRect(viewArea.x, viewArea.y, viewArea.width, viewArea.height);
      //graphics.endFill();
      this.container.addChild(graphics);
    }

    //this.container.setTransform(x+(data.width/2), y+(data.height/2), 1, 1, data.rotation, 0, 0, (data.width/2), (data.height/2));
    this.container.visible = true;
  }

  hide() {
    this.container.visible = false;
  }

  show() {
    this.container.visible = true;
  }

  remove() {
    this.container.removeChildren();
  }

}