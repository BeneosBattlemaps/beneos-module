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

/* ------------------------------------------------------------------ */
/*  "How to Use" note -> open the documentation wiki                   */
/*                                                                     */
/*  Every Beneos scene carries a journal map-note labelled "How to     */
/*  Use" (icon icon_help.svg) with no linked journal. Clicking it,     */
/*  left or right, opens the Beneos documentation in the Foundry       */
/*  client language. POI Teleporter never touches this note because it */
/*  has no journal reference, so there is no conflict.                 */
/* ------------------------------------------------------------------ */

const HOWTO_NOTE_LABEL = "How to Use";
const HOWTO_NOTE_ICON = "icon_help.svg";

function isHowToUseNote(note) {
  const d = note?.document;
  if (!d) return false;
  if (d.text === HOWTO_NOTE_LABEL) return true;
  const src = d.texture?.src ?? d.icon ?? "";
  return typeof src === "string" && src.includes(HOWTO_NOTE_ICON);
}

let _howToWrapped = false;
function registerHowToNoteHandler() {
  if (_howToWrapped) return;
  if (typeof libWrapper === "undefined") {
    console.warn("[Beneos] libWrapper unavailable; 'How to Use' note handler skipped.");
    return;
  }
  // CONFIG.Note.objectClass resolves to the active Note placeable class in
  // both V13 and V14, so we wrap there rather than a namespace path.
  const base = "CONFIG.Note.objectClass.prototype";
  const open = function () {
    try { game.beneos?.openWiki?.("overview"); }
    catch (e) { console.warn("[Beneos] How-to note open failed:", e); }
  };
  for (const method of ["_onClickLeft", "_onClickRight", "_onClickLeft2", "_onClickRight2"]) {
    try {
      libWrapper.register(MODULE_ID, `${base}.${method}`, function (wrapped, ...args) {
        if (isHowToUseNote(this) && typeof game.beneos?.openWiki === "function") {
          open();
          return;
        }
        return wrapped(...args);
      }, "MIXED");
    } catch (e) {
      console.warn(`[Beneos] Could not wrap Note.${method} for the How-to handler:`, e);
    }
  }
  _howToWrapped = true;
}

// Belt-and-suspenders: also bind a direct pointer listener on each "How to
// Use" note placeable. Not every interaction path routes a real click through
// Note.prototype._onClickLeft, so this guarantees the click opens the docs,
// the same way POI Teleporter binds its own per-note listeners. Idempotent per
// placeable via a marker flag.
function bindHowToNote(note, attempt = 0) {
  if (!note || note._beneosHowToBound) return;
  if (!isHowToUseNote(note)) return;
  // The real interaction target is the note's ControlIcon (where the
  // MouseInteractionManager listens and where PIXI pointer events land). It is
  // created during draw(), which can be slightly after this fires, so retry
  // until it exists, then bind there.
  const target = note.mouseInteractionManager?.target;
  if (!target || typeof target.on !== "function") {
    if (attempt < 20) setTimeout(() => bindHowToNote(note, attempt + 1), 150);
    return;
  }
  note._beneosHowToBound = true;
  const open = (event) => {
    try { event?.stopPropagation?.(); } catch (e) {}
    try { game.beneos?.openWiki?.("overview"); } catch (e) {}
  };
  try {
    target.eventMode = "static";
    target.cursor = "pointer";
    // pointerdown covers both mouse buttons; rightdown is what POI uses, bind
    // it too so a right-click also opens the docs on these unlinked notes.
    target.on("pointerdown", open);
    target.on("rightdown", open);
  } catch (e) {
    note._beneosHowToBound = false;
    console.warn("[Beneos] Could not bind How-to note listener:", e);
  }
}

function bindAllHowToNotes() {
  if (!canvas?.ready) return;
  for (const note of (canvas.notes?.placeables || [])) bindHowToNote(note);
}

Hooks.on("canvasReady", bindAllHowToNotes);
Hooks.on("drawNote", bindHowToNote);

Hooks.once("ready", () => {
  updateHooks();
  registerHowToNoteHandler();
  bindAllHowToNotes();
});
