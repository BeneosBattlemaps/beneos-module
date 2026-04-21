/**
 * Beneos Navigation Visibility Controller
 *
 * Hides Beneos navigation assets (tiles and journal note icons) from players
 * when they reference images from the beneos_battlemaps/map_assets/icons/ folder.
 * GM always sees all assets. No document data is modified — purely visual.
 *
 * Sets both container and mesh properties to survive Foundry's refresh cycle.
 *
 * Performance: Hooks are only registered when the feature is active (default).
 * When "Show DM navigation to players" is enabled, no hooks exist = zero overhead.
 */

const BENEOS_NAV_PATH = "beneos_battlemaps/map_assets/icons/";
const MODULE_ID = "beneos-module";
const SETTING_SHOW_NAV = "showNavToPlayers";

let _refreshTileHookId = null;
let _refreshNoteHookId = null;
let _canvasReadyHookId = null;

const BENEOS_NAV_EXCEPTION = "icon_leave.svg";

function isBeneosNavAsset(path) {
  if (!path?.includes(BENEOS_NAV_PATH)) return false;
  if (path.includes(BENEOS_NAV_EXCEPTION)) return false;
  return true;
}

function hideTileIfNav(tile) {
  if (game.user.isGM) return;
  if (!isBeneosNavAsset(tile.document.texture?.src)) return;
  tile.visible = false;
  tile.renderable = false;
  tile.alpha = 0;
  if (tile.mesh) {
    tile.mesh.visible = false;
    tile.mesh.renderable = false;
    tile.mesh.alpha = 0;
  }
}

function hideNoteIfNav(note) {
  if (game.user.isGM) return;
  const src = note.document.texture?.src ?? note.document.icon;
  console.log("Beneos Nav | Note check:", src, "| isNav:", isBeneosNavAsset(src), "| exception:", src?.includes(BENEOS_NAV_EXCEPTION));
  if (!isBeneosNavAsset(src)) return;
  note.visible = false;
  note.renderable = false;
  note.alpha = 0;
}

function applyToAllPlaceables() {
  if (game.user.isGM) return;
  canvas.tiles?.placeables.forEach(t => hideTileIfNav(t));
  canvas.notes?.placeables.forEach(n => hideNoteIfNav(n));
}

function updateHooks() {
  const shouldHide = !game.settings.get(MODULE_ID, SETTING_SHOW_NAV);

  if (shouldHide && !_refreshTileHookId) {
    _refreshTileHookId = Hooks.on("refreshTile", hideTileIfNav);
    _refreshNoteHookId = Hooks.on("refreshNote", hideNoteIfNav);
    _canvasReadyHookId = Hooks.on("canvasReady", applyToAllPlaceables);
  } else if (!shouldHide && _refreshTileHookId) {
    Hooks.off("refreshTile", _refreshTileHookId);
    Hooks.off("refreshNote", _refreshNoteHookId);
    Hooks.off("canvasReady", _canvasReadyHookId);
    _refreshTileHookId = null;
    _refreshNoteHookId = null;
    _canvasReadyHookId = null;
  }

  if (canvas.ready) {
    if (shouldHide) {
      applyToAllPlaceables();
    } else {
      canvas.tiles?.placeables.forEach(t => {
        if (isBeneosNavAsset(t.document.texture?.src)) {
          t.renderable = true;
          t.alpha = 1;
          if (t.mesh) { t.mesh.visible = true; t.mesh.renderable = true; t.mesh.alpha = 1; }
          t.refresh();
        }
      });
      canvas.notes?.placeables.forEach(n => {
        if (isBeneosNavAsset(n.document.texture?.src)) {
          n.renderable = true;
          n.alpha = 1;
          n.refresh();
        }
      });
    }
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_SHOW_NAV, {
    name: "BENEOS.Settings.ShowNav.Name",
    hint: "BENEOS.Settings.ShowNav.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => updateHooks()
  });
});

Hooks.once("ready", () => {
  updateHooks();
});
