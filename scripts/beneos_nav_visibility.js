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

// Matches all battlemap path schemes in the field, because the same icons live
// under beneos_assets/beneos_battlemaps/map_assets/icons/ (local + Moulinette)
// and under beneos_assets/cloud/battlemaps/map_assets/icons/ (cloud install).
// Pinning this to the literal "beneos_battlemaps" folder made the whole feature
// silently do nothing on every cloud-installed release.
const BENEOS_NAV_PATH = /battlemaps\/map_assets\/icons\//i;
const MODULE_ID = "beneos-module";
const SETTING_SHOW_NAV = "showNavToPlayers";

let _refreshTileHookId = null;
let _refreshNoteHookId = null;
let _canvasReadyHookId = null;

const BENEOS_NAV_EXCEPTION = "icon_leave.svg";

function isBeneosNavAsset(path) {
  if (!path || !BENEOS_NAV_PATH.test(path)) return false;
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

// A note carrying a documentation target "<pageKey>[#<anchor>]" opens that
// exact documentation location on click. Preferred home of the target is the
// flag flags["beneos-module"].docTarget (written through the beneos-dev Note
// config field), so the Label stays plain readable tooltip text. Legacy notes
// instead hide an "@doc[...]" marker inside the Label, e.g. "Garage
// @doc[landing-avernus#la-garage]"; that marker is stripped from the visible
// label (see the text wrapper below) and keeps working as a fallback. The
// "@doc[" prefix is distinct enough that it never collides with ordinary
// bracketed labels such as the world-map POIs "Castle Dourcrag [Release 48]".
const DOC_MARKER_RE = /@doc\[([^\]]+)\]/i;

function docTargetOf(note) {
  const d = note?.document;
  if (!d) return null;
  const flagged = d.getFlag?.(MODULE_ID, "docTarget");
  if (typeof flagged === "string" && flagged.trim()) {
    // Tolerate a full "@doc[...]" marker pasted into the flag.
    const fm = flagged.match(DOC_MARKER_RE);
    return (fm ? fm[1] : flagged).trim();
  }
  const text = d.text;
  if (typeof text !== "string") return null;
  const m = text.match(DOC_MARKER_RE);
  return m ? m[1].trim() : null;
}

function strippedNoteLabel(text) {
  if (typeof text !== "string" || text.indexOf("@doc[") < 0) return text;
  return text.replace(DOC_MARKER_RE, "").replace(/\s{2,}/g, " ").trim();
}

// The documentation location a click on this note should open: an explicit
// @doc[...] target wins; otherwise the plain "How to Use" help note opens the
// documentation front page; anything else is not ours.
function wikiTargetForNote(note) {
  return docTargetOf(note) || (isHowToUseNote(note) ? "overview" : null);
}

// While the "Beneos Dev Tools" window (beneos-dev) is open, doc routing is
// suspended so an author can reach the note's own config sheet again; with
// routing active every click would open the documentation instead. End users
// never have that window, so their behaviour is unchanged.
function docClickSuppressed() {
  return !!foundry.applications?.instances?.get?.("beneos-dev-tools")?.rendered;
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
  for (const method of ["_onClickLeft", "_onClickRight", "_onClickLeft2", "_onClickRight2"]) {
    try {
      libWrapper.register(MODULE_ID, `${base}.${method}`, function (wrapped, ...args) {
        const target = docClickSuppressed() ? null : wikiTargetForNote(this);
        if (target && typeof game.beneos?.openWiki === "function") {
          try { game.beneos.openWiki(target); }
          catch (e) { console.warn("[Beneos] Doc note open failed:", e); }
          return;
        }
        return wrapped(...args);
      }, "MIXED");
    } catch (e) {
      console.warn(`[Beneos] Could not wrap Note.${method} for the docs handler:`, e);
    }
  }

  // Hide the "@doc[...]" marker from the visible note label while keeping it in
  // document.text for routing. Wrap the placeable's label accessor so the
  // on-canvas label and the hover tooltip show only the human text; notes
  // without a marker are returned untouched.
  try {
    libWrapper.register(MODULE_ID, `${base}.text`, function (wrapped, ...args) {
      return strippedNoteLabel(wrapped(...args));
    }, "WRAPPER");
  } catch (e) {
    console.warn("[Beneos] Could not wrap Note.text to hide the docs marker:", e);
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
  if (!isHowToUseNote(note) && !docTargetOf(note)) return;
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
  // If this note carries a @doc[...] marker that does not resolve to a real
  // documentation page/section, warn once so authoring typos are not silent.
  const marker = docTargetOf(note);
  if (marker && game.beneos?.isValidDocTarget && game.beneos.isValidDocTarget(marker) === false) {
    console.warn(`[Beneos] Note doc marker "@doc[${marker}]" does not resolve to a documentation page/section. See game.beneos.listDocTargets() for valid targets.`);
  }
  const open = (event) => {
    // Let the event travel on untouched while the dev-tools window is open,
    // so the normal note interaction (select, open config) still works.
    if (docClickSuppressed()) return;
    try { event?.stopPropagation?.(); } catch (e) {}
    const target = wikiTargetForNote(note);
    if (!target) return;
    try { game.beneos?.openWiki?.(target); } catch (e) {}
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
