import { BeneosUtility } from "./beneos_utility.js";
import { BeneosModuleMenu } from "./beneos_search_engine.js";

/********************************************************************************** */
export class BeneosTableTop {

  static init() {
    console.log("BeneosTableTop init");
    BeneosTableTop.titleCache = {}

    Hooks.on("updateScene", (scene, updateData, options, userId) => {
      BeneosTableTop.manageGridOpacity(scene, updateData);
    });

    Hooks.on("canvasInit", (canvas) => { return BeneosTableTop.onCanvasInit() });
    Hooks.on('canvasReady', () => { return BeneosTableTop.onCanvasReady() });
    Hooks.on('canvasPan', (canvas, data) => { return BeneosTableTop.onCanvasPan(canvas, data) });
    Hooks.on("preDeleteDrawing", (drawing, options, data) => { return BeneosTableTop.preDeleteDrawing(drawing, options, data) });
    Hooks.on('refreshDrawing', (drawing, options, data) => { return BeneosTableTop.refreshDrawing(drawing, options, data) });
    Hooks.on("getSceneControlButtons", (btns) => { return BeneosTableTop.getSceneControlButtons(btns) });
  }

  /******************************************************************************** */
  static getSceneControlButtons(btns) {
    if (!canvas) return;
    CONFIG.Canvas.layers.beneos = { layerClass: ControlsLayer, group: "primary" };
    let menu = [];

    if (game.user.isGM) {
      menu.push({
        name: "enable-boundary",
        title: "Enable/Disable scene boundary",
        icon: "fa-solid fa-users",
        //button: true,
        toggle: true,
        active: BeneosTableTop.isSceneBoundary(),
        onClick: () => { BeneosTableTop.toggleSceneBoundary() }
      });

      menu.push({
        name: "enable-player-view",
        title: "Enable/Disable GM player view control",
        icon: "fas fa-magnifying-glass",
        //button: true,
        toggle: true,
        active: BeneosTableTop.isControlPlayerView(),
        onClick: async () => {
          BeneosTableTop.toggleControlPlayerView()
        },
      });

      btns.push({
        name: "beneos",
        title: "Beneos Module",
        icon: "beneos-module",
        layer: "beneos",
        tools: menu
      });

    }
  }

  /******************************************************************************** */
  static refreshDrawing(drawing, options, data) {
    console.log("Drawing updated", drawing, options, data)
    if (!game.user.isGM || !options.refreshPosition) {
      return true;
    }

    if (drawing.document.getFlag("beneos-module", "beneos-area-mode") == "scene-boundary") {
      let precText = BeneosTableTop.titleCache[drawing.id]
      if (!precText) {
        precText = new PreciseText("Scene Boundary", CONFIG.canvasTextStyle.clone())
        canvas.drawings.addChild(precText);
        BeneosTableTop.titleCache[drawing.id] = precText
      }
      precText.x = drawing.x + 32;
      precText.y = drawing.y - 40;
      BeneosTableTop.sendPositionMessage()
    }
    if (drawing.document.getFlag("beneos-module", "user-view")) {
      console.log("Drawing updated for user", drawing)
      let user = game.users.get(drawing.document.getFlag("beneos-module", "user-view"))
      let precText = BeneosTableTop.titleCache[drawing.id]
      if (!precText) {
        precText = new PreciseText("View : " + user.name, CONFIG.canvasTextStyle.clone())
        canvas.drawings.addChild(precText);
        BeneosTableTop.titleCache[drawing.id] = precText
      }
      precText.x = drawing.x + 32;
      precText.y = drawing.y - 40;
      BeneosTableTop.sendPositionMessage()
    }
    return true;
  }

  /******************************************************************************** */
  static preDeleteDrawing(drawing, options, data) {
    if (drawing.getFlag("beneos-module", "beneos-area-mode") || drawing.getFlag("beneos-module", "user-view")) {
      ui.notifications.info("Scene boundary or user view activated : you can't delete this drawing")
      return false;
    }
    let precText = BeneosTableTop.titleCache[drawing.id]
    if (precText) {
      precText.destroy()
      delete BeneosTableTop.titleCache[drawing.id]
    }
    return true;
  }

  /******************************************************************************** */
  static searchLockViewArea() {
    let drawings = canvas.scene.drawings
    for (let drawing of drawings) {
      if (drawing.flags?.LockView?.boundingBox_mode == 2) {
        console.log("Found a LockView area", drawing)
        return drawing
      }
    }
    return undefined
  }

  /******************************************************************************** */
  static searchBoundaryArea() {
    let drawings = canvas.scene.drawings
    for (let drawing of drawings) {
      let mode = drawing.getFlag("beneos-module", "beneos-area-mode")
      if (mode == "scene-boundary") {
        console.log("Found a Beneos area", drawing)
        return drawing
      }
    }
    return undefined
  }

  /******************************************************************************** */
  static async toggleSceneBoundary() {
    let sceneData = game.canvas.scene.getFlag("beneos-module", "beneos-data") || this.getDefaultSceneData()
    if (sceneData.sceneBoundary) {
      sceneData.sceneBoundary = false
      await game.canvas.scene.setFlag("beneos-module", "beneos-data", sceneData)

      let rect = BeneosTableTop.searchBoundaryArea()
      if (rect) {
        await rect.setFlag("beneos-module", "beneos-area-mode", false)
        let d = await canvas.scene.deleteEmbeddedDocuments('Drawing', [rect.id]);
      }
      ui.notifications.info("Scene boundary disabled")
    } else {
      sceneData.sceneBoundary = true
      await game.canvas.scene.setFlag("beneos-module", "beneos-data", sceneData)

      let rect = BeneosTableTop.searchBoundaryArea()
      if (!rect) {
        rect = BeneosTableTop.searchLockViewArea()
        if (rect) {
          rect.setFlag("beneos-module", "beneos-area-mode", "scene-boundary")
        } else {
          let rect = { x: canvas.stage.x, y: canvas.stage.y, interface: true, drawingRole: 'information', hidden: true, strokeColor: game.user.color, shape: { width: canvas.stage.width, height: canvas.stage.height, type: 'r' }, visible: true, fillType: 0 }
          const defaults = game.settings.get("core", DrawingsLayer.DEFAULT_CONFIG_SETTING);
          const rectData = foundry.utils.mergeObject(defaults, rect);
          let d = await canvas.scene.createEmbeddedDocuments('Drawing', [rectData]);
          await d[0].setFlag('beneos-module', 'beneos-area-mode', "scene-boundary");
        }
      }
      BeneosTableTop.sendPositionMessage()
      ui.notifications.info("Scene boundary enabled")
    }
  }

  /********************************************************************************** */
  static async toggleControlPlayerView() {
    let sceneData = canvas.scene.getFlag("beneos-module", "beneos-data") || this.getDefaultSceneData()
    if (sceneData.controlPlayerView) {
      sceneData.controlPlayerView = false
      await game.canvas.scene.setFlag("beneos-module", "beneos-data", sceneData)

      for (let d of canvas.scene.drawings) {
        let isUserDrawing = d.getFlag('beneos-module', 'user-view');
        if (isUserDrawing) {
          await d.setFlag("beneos-module", "user-view", false)
          await canvas.scene.deleteEmbeddedDocuments('Drawing', [d.id]);
        }
      }
      ui.notifications.info("Control player view disabled")
    } else {
      sceneData.controlPlayerView = true
      await game.canvas.scene.setFlag("beneos-module", "beneos-data", sceneData)
      // Loop thru user
      let userViews = {}
      for (let user of game.users) {
        if (user.isGM) continue
        userViews[user.id] = false
        for (let d of canvas.scene.drawings) {
          let isUserDrawing = d.getFlag('beneos-module', 'user-view') === user.id;
          if (isUserDrawing) {
            userViews[user.id] = d.id
          }
        }
      }
      // Loop thru missing players and create view areas
      for (let userId in userViews) {
        if (!userViews[userId]) {
          console.log('Creating view area for ' + userId);
          let rect = { x: canvas.stage.x, y: canvas.stage.y, interface: true, drawingRole: 'information', hidden: true,  strokeColor: game.user.color, shape: { width: canvas.stage.width, height: canvas.stage.height, type: 'r' }, visible: true, fillType: 0 }
          const defaults = game.settings.get("core", DrawingsLayer.DEFAULT_CONFIG_SETTING);
          const rectData = foundry.utils.mergeObject(defaults, rect);
          let d = await canvas.scene.createEmbeddedDocuments('Drawing', [rectData]);
          await d[0].setFlag('beneos-module', 'user-view', userId);
        }
      }
      BeneosTableTop.sendPositionMessage()
      ui.notifications.info("Control player view enabled")
    }
  }

  /********************************************************************************** */
  static isSceneBoundary() {
    let sceneData = canvas?.scene?.getFlag("beneos-module", "beneos-data") || this.getDefaultSceneData()
    return sceneData.sceneBoundary
  }
  static isControlPlayerView() {
    let sceneData = canvas?.scene?.getFlag("beneos-module", "beneos-data") || this.getDefaultSceneData()
    return sceneData.controlPlayerView
  }

  /********************************************************************************** */
  static computePhysicalScale() {
    let screenWidth = game.settings.get("beneos-module", "beneos-tt-auto-scale-width");
    if ( screenWidth == 0) {
      let diagonal = game.settings.get("beneos-module", "beneos-tt-auto-scale-diagonal");
      if (diagonal == 0) {
        ui.notifications.error("Please set the screen width or the diagonal of the screen in the module settings")
        return
      }
      screenWidth = (diagonal * 25,4 * 16) / 18.3576;
    }
    let miniatureSize = game.settings.get("beneos-module", "beneos-tt-auto-scale-miniature-size");
    if ( miniatureSize <= 5) {
      ui.notifications.error("Please set the miniature size in the module settings")
      return
    }
    let squareSize = screenWidth / miniatureSize;
    let pixelPerSquare = screen.width / squareSize;
    let scale = pixelPerSquare / canvas.scene.grid.size;
    return scale;
  }
  
  /********************************************************************************** */
  static getDefaultSceneData() {
    let sceneData = {
      sceneBoundary: game.settings.get("beneos-module", "beneos-scene-boundaries"),
      controlPlayerView: game.settings.get("beneos-module", "beneos-tt-control-player-view")
    }
    return sceneData
  }
  /********************************************************************************** */
  static isControlPlayerView() {
    let sceneData = canvas.scene?.getFlag("beneos-module", "beneos-data") || this.getDefaultSceneData()
    return sceneData && (sceneData.sceneBoundary || sceneData.controlPlayerView)
  }


  /*************************************/
  static newConstrainView({ x, y, scale }) {
    const d = canvas.dimensions;                    //Canvas dimensions
    let boxDefined = false;                         //Whether a bounding box has been drawn
    let bound = { Xmin: 0, Xmax: 0, Ymin: 0, Ymax: 0 };      //Stores the bounding box values
    let rect = { Xmin: 0, Xmax: 0, Ymin: 0, Ymax: 0 };       //Stores the bounding rectangle values
    let scaleChange = false;                        //Checks if the scale must be changed
    let drawings = canvas.scene.drawings.contents;      //The drawings on the canvas
    let scaleMin;                                   //The minimum acceptable scale
    let controlledTokens = [];                      //Array or tokens that are controlled by the user
    let boundingBox = this.isSceneBoundary() || this.isControlPlayerView(); //Whether a bounding box is drawn
    let isPlayerView = this.isControlPlayerView();
    
    if (boundingBox) {
      let tokensInBox = 0;                            //Number of tokens in the bounding box
      let force = false;                              //Rectangle is defined as 'Force Always'

      //Get the controlled tokens
      if (game.user.isGM == false) controlledTokens = canvas.tokens.controlled;

      //Check all drawings in the scene
      for (let i = 0; i < drawings.length; i++) {
        const drawing = drawings[i];

        //If drawing isn't a rectangle, continue
        if (drawing.shape.type != "r" || force) continue;

        //Get the line width of the rectangle
        const lineWidth = drawing.strokeWidth;
        //Store rectangle location
        let rectTemp = {
          Xmin: drawing.x + lineWidth,
          Xmax: drawing.x + drawing.shape.width - 2 * lineWidth,
          Ymin: drawing.y + lineWidth,
          Ymax: drawing.y + drawing.shape.height - 2 * lineWidth
        }

        let isUserDrawing = drawing.getFlag('beneos-module', 'user-view') == game.userId;
        if (isUserDrawing) {
          // console.log("User Drawing : ", drawing);
          rect.Xmin = rectTemp.Xmin;
          rect.Xmax = rectTemp.Xmax;
          rect.Ymin = rectTemp.Ymin;
          rect.Ymax = rectTemp.Ymax;
          boxDefined = true;
          force = true;
          break;
        }

        //Check boundingbox mode of the rectangle
        //if (drawing.flags.LockView == undefined) continue;
        //if (drawing.flags.LockView.boundingBox_mode == 0) continue;
        const mode = 2; // drawing.flags.LockView.boundingBox_mode;

        if ( isPlayerView) continue; // If player view has nto been found here, then continue
        
        let isSceneBoundary = drawing.getFlag('beneos-module', 'beneos-area-mode')
        if (isSceneBoundary == 'scene-boundary') {
          //console.log("Scene Boundary : ", drawing);
          rect.Xmin = rectTemp.Xmin;
          rect.Xmax = rectTemp.Xmax;
          rect.Ymin = rectTemp.Ymin;
          rect.Ymax = rectTemp.Ymax;
          boxDefined = true;
          force = true;
          break;
        }

        if (!isUserDrawing && !isSceneBoundary) continue;

        //Check if one of the tokens that are controlled by the user are within the rectangle
        let activeToken = false;
        for (let j = 0; j < controlledTokens.length; j++) {
          //Get the center of the token
          const centerPoint = controlledTokens[j].getCenterPoint({ x, y });
          let center = [centerPoint.x, centerPoint.y];

          //Check if it is within the rectangle
          if (center.x >= rectTemp.Xmin && center.x <= rectTemp.Xmax && center.y >= rectTemp.Ymin && center.y <= rectTemp.Ymax) {
            activeToken = true;
            tokensInBox++;

            //Extend rect variable so all rectanges that a controlled token is within are included
            if (rect.Xmin == 0 || rectTemp.Xmin < rect.Xmin) rect.Xmin = rectTemp.Xmin;
            if (rect.Xmax == 0 || rectTemp.Xmax > rect.Xmax) rect.Xmax = rectTemp.Xmax;
            if (rect.Ymin == 0 || rectTemp.Ymin < rect.Ymin) rect.Ymin = rectTemp.Ymin;
            if (rect.Ymax == 0 || rectTemp.Ymax > rect.Ymax) rect.Ymax = rectTemp.Ymax;
          }
        }

        if (activeToken == false) continue;
        boxDefined = true;
      }

      let controlledTokensLength = 0;
      if (game.user.isGM)
        boxDefined = false;
      else
        controlledTokensLength = controlledTokens.length;

      //If there is no box defined, or not all tokens are in the box, and no rectangle is set to 'Force Always', set 'rect' to the canvas size
      if ((boxDefined == false || tokensInBox != controlledTokensLength) && force == false) {
        rect.Xmin = canvas.dimensions.sceneRect.x;
        rect.Xmax = canvas.dimensions.sceneRect.x + canvas.dimensions.sceneRect.width;
        rect.Ymin = canvas.dimensions.sceneRect.y;
        rect.Ymax = canvas.dimensions.sceneRect.y + canvas.dimensions.sceneRect.height;
      }

      //If 'excludeSidebar' is enabled and the sidebar is not collapsed, add sidebar width to rect variable
      //if (excludeSidebar && ui.sidebar._collapsed == false)
      //rect.Xmax += Math.ceil(ui.sidebar.position.width / canvas.scene._viewPosition.scale);

      //Compare ratio between window size and rect size in x and y direction to determine if the fit should be horizontal or vertical
      const horizontal = ((window.innerWidth / (rect.Xmax - rect.Xmin)) > (window.innerHeight / (rect.Ymax - rect.Ymin))) ? true : false;

      //Get the minimum allowable scale
      if (horizontal) scaleMin = window.innerWidth / (rect.Xmax - rect.Xmin);
      else scaleMin = window.innerHeight / (rect.Ymax - rect.Ymin);
    }

    //Check if the scale is a number, otherwise set it to the current canvas' scale
    if (Number.isNumeric(scale) == false) scale = canvas.scene._viewPosition.scale;

    //Get the max zoom
    const max = CONFIG.Canvas.maxZoom;

    //Calculate the min zoom
    const ratio = Math.max(d.width / window.innerWidth, d.height / window.innerHeight, max);
    let min = 1 / ratio;
    if (boundingBox) min = scaleMin;

    //Get the new scale
    scale = Math.round(Math.clamp(scale, min, max) * 2000) / 2000;
    if ( game.settings.get(BeneosUtility.moduleID(), "beneos-tt-auto-scale-tv")) {
      scale = this.computePhysicalScale();
    }


    //Set the bounding box
    bound.Xmin = rect.Xmin + window.innerWidth / (2 * scale);
    bound.Xmax = rect.Xmax - window.innerWidth / (2 * scale);
    bound.Ymin = rect.Ymin + window.innerHeight / (2 * scale);
    bound.Ymax = rect.Ymax - window.innerHeight / (2 * scale);

    //Get the new x value
    if (Number.isNumeric(x) == false) x = canvas.stage.pivot.x;
    const padw = 0.4 * (window.innerWidth / scale);
    if (boundingBox) {
      x = Math.clamp(x, bound.Xmin, bound.Xmax);
    }
    else x = Math.clamp(x, -padw, d.width + padw);

    //Get the new y value
    if (Number.isNumeric(y) == false) y = canvas.stage.pivot.y;
    const padh = 0.4 * (window.innerHeight / scale);
    if (boundingBox) {
      y = Math.clamp(y, bound.Ymin, bound.Ymax);
    }
    else y = Math.clamp(y, -padh, d.height + padh);

    return { x, y, scale };
  }

  /*************************************/
  static newPan({ x = null, y = null, scale = null } = {}) {
    // console.log("newPan");
    const constrained = BeneosTableTop.newConstrainView({ x, y, scale });
    this.stage.pivot.set(constrained.x, constrained.y);
    this.stage.scale.set(constrained.scale, constrained.scale);
    this.updateBlur();
    canvas.scene._viewPosition = constrained;
    Hooks.callAll("canvasPan", this, constrained);
    this.hud.align();
    canvas.perception.update({ refreshVision: true })
    //compatibilityHandler('refreshVision');
  }

  /*************************************/
  static newOnDragCanvasPan(event) {
    // Throttle panning by 200ms
    const now = Date.now();
    if (now - (BeneosTableTop.panTime || 0) <= 200) return;
    BeneosTableTop.panTime = now;

    // Shift by 3 grid spaces at a time
    const { x, y } = event;
    const pad = 50;
    const shift = (this.dimensions.size * 3) / this.stage.scale.x;

    // Shift horizontally
    let dx = 0;
    if (x < pad) dx = -shift;
    else if (x > window.innerWidth - pad) dx = shift;

    // Shift vertically
    let dy = 0;
    if (y < pad) dy = -shift;
    else if (y > window.innerHeight - pad) dy = shift;

    const constrained = BeneosTableTop.newConstrainView({ x: this.stage.pivot.x + dx, y: this.stage.pivot.y + dy });

    // Enact panning
    if (dx || dy) return this.animatePan({ x: constrained.x, y: constrained.y, duration: 200 });
  }

  /*************************************/
  static async newAnimatePan({ x, y, scale, duration = 250, speed }) {
    // Determine the animation duration to reach the target
    if (speed) {
      let ray = new Ray(this.stage.pivot, { x, y });
      duration = Math.round(ray.distance * 1000 / speed);
    }

    // Constrain the resulting dimensions and construct animation attributes
    const constrained = BeneosTableTop.newConstrainView({ x, y, scale });
    const attributes = [
      { parent: this.stage.pivot, attribute: 'x', to: constrained.x },
      { parent: this.stage.pivot, attribute: 'y', to: constrained.y },
      { parent: this.stage.scale, attribute: 'x', to: constrained.scale },
      { parent: this.stage.scale, attribute: 'y', to: constrained.scale },
    ].filter(a => a.to !== undefined);

    // Trigger the animation function
    await CanvasAnimation.animate(attributes, {
      name: "canvas.animatePan",
      duration: duration,
      easing: CanvasAnimation.easeInOutCosine,
      ontick: () => {
        this.hud.align();
        const stage = this.stage;
        Hooks.callAll("canvasPan", this, { x: stage.pivot.x, y: stage.pivot.y, scale: stage.scale.x });
      }
    });
    // Record final values
    this.updateBlur();

    // Update the scene tracked position
    canvas.scene._viewPosition = constrained;
  }

  /*************************************/
  static onCanvasInit(canvas) {
    // Reset the title caches
    BeneosTableTop.titleCache = {}

    // Enable only if bounding box is enabled
    if (!game.user.isGM && (BeneosTableTop.isControlPlayerView() || BeneosTableTop.isSceneBoundary())) {
      Canvas.prototype.pan = BeneosTableTop.newPan;
      Canvas.prototype._onDragCanvasPan = BeneosTableTop.newOnDragCanvasPan;
      Canvas.prototype.animatePan = BeneosTableTop.newAnimatePan;
    }
    return true;
  }

  /*************************************/
  static sendViewPosition(viewPosition, playerViews) {
    let msg = {
      name: "msg_set_view_position",
      data: { bounds: viewPosition, views: playerViews }
    }
    game.socket.emit("module.beneos-module", msg);
    console.log("viewPosition PAN : ", viewPosition);
  }

  /*************************************/
  static async sendPositionMessage(data) {
    let viewPosition = foundry.utils.duplicate(canvas.scene._viewPosition);
    let views = {}
    for (let d of canvas.scene.drawings) {
      let userId = d.getFlag('beneos-module', 'viewer');
      if (userId) {
        views[userId] = { width: d.shape.width, height: d.shape.height, x: d.x, y: d.y };
      }
    }
    this.sendViewPosition(viewPosition, views);
  }

  /*************************************/
  static onCanvasPan(canvas, data) {
    if (!game.user.isGM) return; // GM Only
    if (!BeneosTableTop.isControlPlayerView()) return;

    this.sendPositionMessage(data);
  }

  /*************************************/
  static async applyPosition(msgData) {
    let bounds = msgData.bounds;
    console.log("viewPosition client : ", bounds);
    Canvas.prototype.pan = BeneosTableTop.newPan;
    Canvas.prototype._onDragCanvasPan = BeneosTableTop.newOnDragCanvasPan;
    Canvas.prototype.animatePan = BeneosTableTop.newAnimatePan;

    await canvas.pan(bounds);
  }

  /*************************************/
  static onCanvasReady() {
    console.log("*********************************************** READY")
    if (game.user.isGM) {
      this.pauseVideo()
    }
    if (!game.user.isGM || !BeneosTableTop.isControlPlayerView()) {
      return true;
    }
    let viewPosition = foundry.utils.duplicate(canvas.scene._viewPosition);
    this.sendViewPosition(viewPosition);

    return true;
  }

  /*************************************/
  static pauseVideo() {
    // Video playing
    if (game.settings.get(BeneosUtility.moduleID(), "beneos-tt-performance-mode")) {
      console.log("Pause video");
      BeneosTableTop.videoPause = setInterval(() => {
        if (canvas.primary?.background?.sourceElement && !canvas.primary.background.sourceElement.paused) {
          canvas.primary.background.sourceElement.pause(0)
          // clear interval
          clearInterval(BeneosTableTop.videoPause);
          BeneosTableTop.videoPause = undefined;
        }
      }, 200);
    }
  }

  /*************************************/
  static manageGridOpacity(scene, updateData) {
    if (!game.user.isGM) return; // GM Only

    if (updateData.active === true) {
      let beneosTTFlags = scene.getFlag(BeneosUtility.moduleID(), "beneos-tt-flags");
      if (beneosTTFlags === undefined) {
        beneosTTFlags = {};
      }

      this.pauseVideo(scene, updateData)

      // Manage token vision 
      if (game.settings.get(BeneosUtility.moduleID(), "beneos-tt-token-vision")) {
        beneosTTFlags.tokenVision = scene.tokenVision;
        scene.setFlag(BeneosUtility.moduleID(), "beneos-tt-flags", beneosTTFlags);
        console.log("token vision : ", scene.tokenVision);
        scene.update({ 'tokenVision': false });
      } else if (beneosTTFlags.tokenVision !== undefined) {
        scene.update({ 'tokenVision': beneosTTFlags.tokenVision });
      }

      if (game.settings.get(BeneosUtility.moduleID(), "beneos-tt-grid-visibility")) {
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

  /*************************************/
  static manageDisplayUIComponents() {
    let display = true;
    let show = false;
    $('body')
      .toggleClass('hide-ui', true)
      .toggleClass('hide-chat', true)
      .toggleClass('hide-camera-views', display)
      .toggleClass('show-combat', show)
      .toggleClass('show-combatants', show)
      .attr('limit-combatants', 10);
    if (display && ui.sidebar) {
      ui.sidebar.activateTab('chat');
    }
    //$("body").get(0).style.setProperty("--combat-popout-scale", display ? setting('combat-scale') : 1);
  }



}