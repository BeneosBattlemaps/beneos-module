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

/* ------------------------------------------------------------------ */
/*  Journal-Pins schalten sich auf einer Beneos-Szene selbst ein       */
/* ------------------------------------------------------------------ */

const SETTING_AUTO_PINS = "autoShowJournalPins";

// Foundry-Kern, `NotesLayer.TOGGLE_SETTING`. Geltungsbereich `client`, Vorgabe
// `true`, `config: false`; bedient wird er ueber die Werkzeugleiste der
// Notizebene. Sein eigener `onChange` zeichnet die Ebene neu, deshalb genuegt
// hier das Setzen und es braucht keinen Aufruf auf `canvas.notes`.
const CORE_NOTES_TOGGLE = "notesDisplayToggle";

/**
 * Traegt diese Szene Beneos-Navigation?
 *
 * Erkannt wird an einer Notiz mit Beneos-Nav-Symbol, nicht am Modul-Flag.
 * Gemessen am 2026-09-15 ueber alle 143 Pakete: 2163 von 2168 Szenen tragen
 * eine solche Notiz, `flags["beneos-module"]` dagegen nur 1701. Das Symbol ist
 * ausserdem genau das, was der Nutzer vermisst, wenn die Pins aus sind.
 */
function sceneHasBeneosNavNotes(scene) {
  for (const n of (scene?.notes ?? [])) {
    const src = n?.texture?.src ?? n?.icon ?? "";
    if (isBeneosNavAsset(src)) return true;
  }
  return false;
}

/**
 * Sind die Journal-Pins aus, schaltet eine Beneos-Szene sie wieder an.
 *
 * WARUM DAS NOETIG IST
 *
 * Die Vorgabe des Kerns ist `true`, neue Welten kommen trotzdem oft mit
 * abgeschalteten Pins an. Die Overview-Tour schaltet sie zu Beginn ABSICHTLICH
 * ab (`beneos_tours.js`, Tour `tutorial-page-1-overview`) und erst in einem
 * spaeteren Schritt wieder an. Wer die Tour vorher abbricht, behaelt den
 * ausgeschalteten Regler und sieht danach auf keiner Karte mehr eine
 * Navigation. Die Tour kennt diesen Fall bereits und heilt ihn fuer sich
 * selbst; ausserhalb der Tour hat ihn bisher niemand geheilt.
 *
 * WIE DIE TOUR GESCHUETZT WIRD, UND WIE NICHT
 *
 * Die Overview-Tour schaltet die Pins in ihrem EIGENEN canvasReady-Haken ab,
 * und der laeuft laut Ladeliste in `module.json` VOR diesem hier. Ohne Sperre
 * schaltete diese Datei im selben Ereignis wieder an, was dort gerade ausging.
 *
 * Gesperrt wird ueber die SZENE: auf einer Tutorial-Szene ruehrt diese Datei
 * den Regler nie an. Das deckt jeden Fall ab, denn beide Stellen, die die Pins
 * ueberhaupt abschalten, gehoeren zur Tour `tutorial-page-1-overview`, und die
 * laeuft nur auf einer Tutorial-Szene.
 *
 * **Nicht ueber den Tourstatus, das war ein Fehlschlag.** Hier stand zuerst
 * `game.tours.contents.some(t => t.status === "in-progress")`. Gemessen am
 * 2026-09-15: `Tour#status` wird aus `#stepIndex` abgeleitet, der Zaehler kommt
 * aus der dauerhaft gespeicherten Einstellung `core.tourProgress`, und `exit()`
 * setzt ihn NICHT zurueck. Eine abgebrochene Tour steht damit fuer immer auf
 * `in-progress`, ueber jeden Neustart hinweg. Die Sperre blockierte also genau
 * bei dem Nutzer dauerhaft, fuer den diese Funktion ueberhaupt gebaut wurde.
 * Wer sie wieder einbauen will, muss `Tour#reset()` mitdenken.
 */
async function autoShowJournalPins() {
  let grund = null;
  try {
    if (!game.settings.get(MODULE_ID, SETTING_AUTO_PINS)) grund = "setting-off";
    else if (globalThis.BeneosTours?.isTutorialScene?.(canvas?.scene)) grund = "tutorial-scene";
    else if (game.settings.get("core", CORE_NOTES_TOGGLE)) grund = "already-on";
    else if (!sceneHasBeneosNavNotes(canvas?.scene)) grund = "no-beneos-notes";
    if (grund) {
      console.debug(`[Beneos] Journal pins left untouched: ${grund}`);
      return grund;
    }
    await game.settings.set("core", CORE_NOTES_TOGGLE, true);
    console.log("[Beneos] Journal pins were off on a Beneos scene and have been switched back on.");
    return "switched-on";
  } catch (e) {
    console.warn("[Beneos] Could not auto-enable the journal pin display:", e);
    return "error";
  }
}

// Von Hand aufrufbar, damit "bei mir passiert nichts" eine Antwort bekommt
// statt einer Vermutung: der Rueckgabewert benennt die Bedingung, die den Lauf
// gestoppt hat. Dasselbe Muster wie `globalThis.BeneosTours` eine Datei weiter.
globalThis.BeneosNavVisibility = Object.assign(globalThis.BeneosNavVisibility ?? {}, {
  pruefeJournalPins: autoShowJournalPins,
  sceneHasBeneosNavNotes
});

Hooks.on("canvasReady", autoShowJournalPins);

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

  // Geltungsbereich `client`, weil der Regler dahinter einer ist: jeder Nutzer
  // entscheidet ueber seine eigene Anzeige, und ein Spielleiter, der die Pins
  // von Hand steuern will, schaltet das hier nur fuer sich ab.
  game.settings.register(MODULE_ID, SETTING_AUTO_PINS, {
    name: "BENEOS.Settings.AutoJournalPins.Name",
    hint: "BENEOS.Settings.AutoJournalPins.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
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
