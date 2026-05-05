/**
 * Beneos Module — Tour / Onboarding System
 *
 * Self-contained file. To remove: delete this file and remove the
 * import line in beneos_module.js and the esmodules entry in module.json.
 */

import { BeneosUtility } from "./beneos_utility.js";

const MODULE_ID = "beneos-module";

// V13/V14 compat: use namespaced Tour if available
const TourBase = foundry.nue?.Tour ?? Tour;

/**
 * Map of Foundry scene IDs to their corresponding tutorial tour IDs.
 * When a GM enters one of these scenes, the matching tour auto-starts via canvasReady.
 * Add a new entry per tutorial scene; the BeneosTutorialSceneTour class is generic.
 */
const TUTORIAL_SCENE_TOURS = {
  "0A8yWjm42oAg0vnw": "tutorial-start-here",        // Start Here
  "7C7jvaaI3W1gFFZ3": "tutorial-page-1-overview",   // Page 1: Overview
  "M0uzfpdYcLJveveu": "tutorial-page-2-battlemaps", // Page 2: Battlemaps
  "oQFWGxrKGYbhsE22": "tutorial-page-3-sceneries",  // Page 3: Sceneries
  "sBm7NH23HJ2gv6lA": "tutorial-page-4-intro",      // Page 4: Intro Sequences
  "HNcl2IS9T6JuFxL6": "tutorial-page-5-world-map",  // Page 5: World Map
  "u0wKs5Gmwgqr8NK0": "tutorial-page-6-creatures",  // Page 6: Creatures
  "B0h1UkhCXoKatFx4": "tutorial-page-7-loot",       // Page 7: Loot
  "e8XNodRWUYixtEjd": "tutorial-page-8-spells",     // Page 8: Spells
  "dWgZnsQYC2QDt7Kk": "tutorial-page-9-contacts"    // Page 9: Farewell / Next Steps
};

/**
 * Fallback name-based mapping for the tutorial-tour canvasReady auto-start.
 * When a freshly-imported pack contains a scene whose ID differs from the
 * historical one in TUTORIAL_SCENE_TOURS, we still want the tour to fire;
 * the scene NAMES stay stable across pack revisions.
 */
const TUTORIAL_SCENE_TOURS_BY_NAME = {
  "Start Here": "tutorial-start-here",
  "Page 1: Overview": "tutorial-page-1-overview",
  "Page 2: Battlemaps": "tutorial-page-2-battlemaps",
  "Page 3: Sceneries": "tutorial-page-3-sceneries",
  "Page 4: Intro Sequences": "tutorial-page-4-intro",
  "Page 5: World Map": "tutorial-page-5-world-map",
  "Page 6: Creatures": "tutorial-page-6-creatures",
  "Page 7: Loot": "tutorial-page-7-loot",
  "Page 8: Spells": "tutorial-page-8-spells",
  "Page 9: Farewell": "tutorial-page-9-contacts"
};

/**
 * Tile IDs on the Overview scene that represent placeholder "image-only"
 * journal icons (there is no real JournalEntry behind them — they just
 * visually simulate a fully populated Overview). We hide these at tour
 * start (alpha 0) and reveal them together with the real journal pins
 * during the pin-activation step to sell the demo effect.
 */
/**
 * Arrow indicator tiles on the Loot scene (Scene.B0h1UkhCXoKatFx4).
 * Pushed to the back (sort -99999) at tour start, then brought forward
 * step-by-step to reveal each section of the item card.
 */
/**
 * Farewell scene (Page 9) — IDs for the reward cinematic at tour completion.
 * The scene has a full-size video tile (normally hidden at the back) which we
 * bring forward and play once. During playback the decorative drawings,
 * clickable button drawings, and scene tokens are hidden so the video shows
 * fullscreen. Everything is restored when the video ends.
 */
const FAREWELL_VIDEO_TILE_ID = "HEtHPR80iNdjZCpZ";
const FAREWELL_DRAWING_IDS = [
  "JmaN2PzlRgJunGeX", "NmTPU7iW7cpRSXkf", "sGTub1Nw2tE40cjS",
  "SNNnNUyIMRgzpIsO", "dDQsEbV8nYx1l5uF", "MXjZBTiM1k7cnFmv",
  "smJrGTYsp2KFo3Cj", "dJkovVmnEIcVHaU6", "2RK5IJ2NnvaXaewZ",
  "k9t6KITRPuAltRfm"
];
const FAREWELL_TOKEN_IDS   = ["Cbuc8hdl0vYMTYed", "VTMbQnRgyoRDUkXX", "hcsnrL9is8G1gTbA"];
const FAREWELL_PLAYLIST_ID = "K5RzRMzyN0EjfJru";
const FAREWELL_SOUND_ID    = "xqoLFHkuOuGjIOTf";
// Post-video farewell ambient. The Contacts scene's own playlist-sound
// (K5RzRMzyN0EjfJru.xqoLFHkuOuGjIOTf) is stopped at fn-farewell so the
// reward video has the mix; once the video ends, _runFarewellVideoSequence
// starts THIS track instead of resuming the scene's original sound — a
// deliberate swap to close the tour on a different musical mood.
const FAREWELL_POST_VIDEO_PLAYLIST_ID = "7031JEHB2Swfyye9";
const FAREWELL_POST_VIDEO_SOUND_ID    = "7ecc25df4dad44bd";
/**
 * Per-tour audio. Foundry routes each Playlist through one of three global
 * volume channels (Music / Environment / Interface). Only `pQpsDUhEtL0Q27vJ`
 * is configured as Music; most Env sounds are driven by each Scene's own
 * attached playlist (Foundry auto-plays on scene activation) so we don't
 * list them here.
 *
 * Exception — Scenery scene (Scene.oQFWGxrKGYbhsE22): the GM baked the tour
 * Music into that scene's playlist attachment (so ScenePacker packs it), but
 * that also means the scene doesn't auto-play any Environment. For the
 * Scenery tour we therefore additionally start the shared ambient
 * `7031JEHB2Swfyye9.pSdWUnS7WncdVfZv` on the Env channel, and stop it on
 * every other tour.
 *
 * `music: null` means "no Music on this tour" (Intro: video carries audio).
 * Only keys listed here (music and env) are ever stopped — the user's
 * personal playlists are never touched.
 */
const TOUR_AUDIO_MAP = {
  "tutorial-start-here":        { music: { p: "pQpsDUhEtL0Q27vJ", s: "sycGtPyfkbz5IhCa" } },
  "tutorial-page-1-overview":   { music: { p: "pQpsDUhEtL0Q27vJ", s: "sycGtPyfkbz5IhCa" } },
  "tutorial-page-2-battlemaps": { music: { p: "pQpsDUhEtL0Q27vJ", s: "sycGtPyfkbz5IhCa" } },
  "tutorial-page-3-sceneries":  { music: { p: "pQpsDUhEtL0Q27vJ", s: "sycGtPyfkbz5IhCa" }, env: { p: "7031JEHB2Swfyye9", s: "pSdWUnS7WncdVfZv" } },
  "tutorial-page-4-intro":      { music: null },
  "tutorial-page-5-world-map":  { music: { p: "pQpsDUhEtL0Q27vJ", s: "sycGtPyfkbz5IhCa" } },
  "tutorial-page-6-creatures":  { music: { p: "pQpsDUhEtL0Q27vJ", s: "sycGtPyfkbz5IhCa" } },
  "tutorial-page-7-loot":       { music: { p: "pQpsDUhEtL0Q27vJ", s: "sycGtPyfkbz5IhCa" } },
  "tutorial-page-8-spells":     { music: { p: "pQpsDUhEtL0Q27vJ", s: "sycGtPyfkbz5IhCa" } },
  "tutorial-page-9-contacts":   { music: { p: "pQpsDUhEtL0Q27vJ", s: "mkZYCCk9xSiVIU9t" } }
};

// Union of every Music + Env key any tour manages. Iterated at tour start
// to stop leftovers from a previous tour that don't belong here.
const MANAGED_AUDIO_KEYS = (() => {
  const keys = new Set();
  for (const spec of Object.values(TOUR_AUDIO_MAP)) {
    if (spec.music) keys.add(`${spec.music.p}.${spec.music.s}`);
    if (spec.env)   keys.add(`${spec.env.p}.${spec.env.s}`);
  }
  return keys;
})();

/**
 * Stop every sound listed in MANAGED_AUDIO_KEYS that is currently playing.
 * Called when the GM leaves a tutorial scene for a non-tutorial scene, so
 * the Foundry-global tour playlist does not keep playing on unrelated
 * scenes (e.g. another Moulinette pack). Tour start paths always re-apply
 * the desired music via _applyTourAudio() so stopping here is safe — the
 * next tour entry will restart what it needs.
 */
const stopAllManagedTourAudio = () => {
  try {
    for (const key of MANAGED_AUDIO_KEYS) {
      const [pId, sId] = key.split(".");
      const pl = game.playlists.get(pId);
      const snd = pl?.sounds.get(sId);
      if (snd?.playing) pl.stopSound(snd);
    }
  } catch (e) {
    console.warn("Beneos Tutorial Tour | stopAllManagedTourAudio failed:", e);
  }
};
// Video length: 19s 5f @ 24fps ≈ 19.208s — buffer a bit for fade/decode.
const FAREWELL_VIDEO_MS    = 19500;

// While true, the libWrapper tile-click patch on the contacts scene no-ops,
// so accidental clicks during the reward cinematic don't fire button actions.
let _beneosFarewellVideoPlaying = false;

/**
 * Intro Sequences scene (Scene.sBm7NH23HJ2gv6lA) — tiles that explain the
 * manual right-click start. Hidden via renderable flags at tour start,
 * revealed only during intro-right-click-tile, hidden again on leave.
 * Sort tricks don't work for these (same constraint as the Contacts scene).
 */
const INTRO_MANUAL_TILE_IDS = ["MOfivoWtmB5UfNGJ", "NO2Wf65BCMCGTGiQ"];

/**
 * Scenery scene (Scene.oQFWGxrKGYbhsE22) — two drawings that form a big
 * pause-symbol (two vertical bars). Hidden at tour start via renderable
 * flags, revealed only during sc-static-freeze alongside the video-pause,
 * hidden again on leave. Same pattern as the Contacts scene / Intro tiles.
 */
const SCENERY_PAUSE_DRAWING_IDS = ["TkZ1ghikqrzzPoIx", "crRuqeOeJ6abKryF"];

const LOOT_ARROW_TILE_IDS = [
  "9wJE3bbBWIl2aAxi",  // Title
  "Y6nt3O1nEruAsLEQ",  // Lore
  "Et56kbh5uz689QWz",  // Item Description / mechanical features
  "bp1LAXQ5TrtrOWDP",  // Tier
  "9kSgJOCwehCjKd21",  // Price
  "d9tTsJPuHwmNxZm0",  // Origin (1)
  "Oghw8ydlqC3Sxdq3"   // Origin (2)
];

/**
 * Arrow indicator tiles on the World Map (Scene.HNcl2IS9T6JuFxL6).
 * Pushed to the back (sort -99999) at tour start, then temporarily brought
 * to front during specific steps to point at relevant areas.
 */
const WORLD_MAP_ARROW_TILE_IDS = [
  "BPNunnOSD6kF7tzf",
  "OP9kim8h39FAOnnZ",
  "ek0ze7VTDR0nRXC7",
  "3s6uQohqJqCuBxVh"
];

const OVERVIEW_PLACEHOLDER_TILE_IDS = [
  "af9t4NIT6wzbB24V",
  "fTEBlXceKkXvHZoO",
  "Sr7RIhg2tHfdRtgT",
  "rNj18fpVdsD4ZRbt",
  "aexdHy8epJgDdHdK",
  "Bg5p0vXnDpQxt9hK",
  "Hnafwm3UFwObEQZP",
  "ngdeLriIcTBkwEFe",
  "6P93LBiraQkjQS12",
  "MwnbQAl4Vm3p6vrC",
  "pilcSOS9X0W1xkAO",
  "UintiYWCfSveQUwo",
  "QkiG9PyMADnrIWja"
];

/**
 * Per-target step-transition SFX overrides. When next()/previous()
 * transitions INTO one of these step IDs, the switch/page-turn SFX is
 * replaced with the specified sound. Null = silent transition.
 *  - Journal steps: click (opens the docs journal sheet)
 *  - p1-pin-activated: click (announces the pin activation confirmation)
 */
const NEXT_SOUND_OVERRIDES = {
  // Setup tour — per-step transition sounds
  "mou-toolbar":         "beneos_click.ogg",
  "mou-tools":           "beneos_click.ogg",
  "mou-auth-open":       "beneos_click.ogg",
  "mou-browser-open":    "beneos_swoosh.ogg",
  "mou-browser-creator": "beneos_click.ogg",
  "mou-scenepacker":     "beneos_switch.ogg",

  "p1-lore-journal":  "beneos_click.ogg",
  "p1-help-journal":  "beneos_click.ogg",
  "p1-pin-activated": "beneos_click.ogg",
  "bm-handout-1":            "beneos_click.ogg",
  "bm-handout-2":            "beneos_click.ogg",
  "bm-share-image":          "beneos_click.ogg",
  // Token movement / follow-player chat notification / foreground-tile demos
  "bm-player-field-moved":   "beneos_walk.ogg",
  "bm-follow-players":       "beneos_notification.ogg",
  "bm-obstacles":            "beneos_walk.ogg",
  "bm-foreground-tiles":     "beneos_climb.ogg",

  // Page 3 — Scenery tour
  "sc-static-maps":   "beneos_click.ogg",
  "sc-static-freeze": "beneos_click.ogg",

  // Page 6 — Creatures tour
  "ct-cloud-open":             "beneos_click.ogg",
  "ct-categories":             "beneos_click.ogg",
  "ct-filter-biome":           "beneos_click.ogg",
  "ct-filter-campaign":        "beneos_click.ogg",
  "ct-filter-type":            "beneos_click.ogg",
  "ct-filter-faction":         "beneos_click.ogg",
  "ct-filter-fighting":        "beneos_click.ogg",
  "ct-filter-purpose":         "beneos_click.ogg",
  "ct-search-intro":           "beneos_click.ogg",
  "ct-search-rotcerf":         "beneos_type.ogg",
  "ct-search-install":         "beneos_click.ogg",
  "ct-place-token":            "beneos_roar.ogg",
  "ct-context-menu":           "beneos_click.ogg",
  "ct-skin-alternate":         "beneos_swoosh.ogg",
  "ct-skin-switch-back":       "beneos_click.ogg",
  "ct-death-icon":             "beneos_monster_dead.ogg",
  "ct-character-sheet":        "beneos_click.ogg",
  "ct-biography-tactical":     "beneos_click.ogg",
  "ct-journal-open":           "beneos_click.ogg",
  "ct-journal-lore":           "beneos_swoosh.ogg",
  "ct-journal-story":          "beneos_swoosh.ogg",
  "ct-journal-foreshadowing":  "beneos_swoosh.ogg",
  "ct-journal-before-combat":  "beneos_swoosh.ogg",
  "ct-journal-during-combat":  "beneos_swoosh.ogg",
  "ct-journal-death":          "beneos_swoosh.ogg",
  "ct-token-rotation":         "beneos_click.ogg",
  "ct-rotation-setting":       "beneos_click.ogg",
  "ct-creatures-complete":     "beneos_swoosh.ogg",

  // Page 7 — Loot tour
  "lt-title":                  "beneos_swoosh.ogg",
  "lt-foundry-view":           "beneos_swoosh.ogg",

  // Page 8 — Spells tour
  "sp-card":                   "beneos_swoosh.ogg",
  "sp-icon":                   "beneos_swoosh.ogg",
  "sp-foundry-view":           "beneos_swoosh.ogg",

  // Page 9 — Farewell / Next Steps
  "fn-dungeon":                "beneos_swoosh.ogg",
  "fn-cloud":                  "beneos_swoosh.ogg",
  "fn-search":                 "beneos_swoosh.ogg",
  "fn-discord":                "beneos_swoosh.ogg"
};

/**
 * Steps after which opened journals should be KEPT OPEN (not auto-closed
 * by _postStep). Used when the next step re-uses the same journal sheet
 * — closing + re-opening causes a visual flicker.
 */
/**
 * Steps after which tiles brought to the front by `_bringTileToFront` should
 * STAY foregrounded (instead of being restored by `_postStep`'s `_restoreTiles`
 * call). Used when several consecutive steps share the same arrow tile and we
 * don't want a flicker every time the user clicks Next.
 */
const KEEP_TILES_FOREGROUNDED_AFTER = new Set([
  // Page 7 Loot — Origin tiles span steps 9, 10, 11
  "lt-origin",
  "lt-set-bonus"
  // lt-origin-sense is the LAST step using the origin tiles → _postStep restores
]);

const KEEP_JOURNAL_OPEN_AFTER = new Set([
  "bm-handout-2",  // bm-share-image reuses the same handout
  // Page 6 Creatures journal sequence — keep the journal open across all of these
  // so the user navigates between pages via goToPage() instead of close+reopen.
  "ct-journal-open",
  "ct-journal-fullbody",
  "ct-journal-lore",
  "ct-journal-story",
  "ct-journal-foreshadowing",
  "ct-journal-before-combat",
  "ct-journal-during-combat",
  // ct-journal-death is the last creatures journal step — let _postStep close it normally

  // Page 7 Loot — keep the PDF journal open between intro and page-6 step
  "lt-pdf-intro"
  // lt-pdf-page6 is the LAST PDF step → _postStep closes the journal cleanly
]);

/* ================================================================== */
/*  Tour CSS — injected once to fix visibility and z-index issues      */
/* ================================================================== */

const TOUR_CSS = document.createElement("style");
TOUR_CSS.textContent = `
  /* ============================================================
     Beneos Tour Design System
     - Background:  #151412
     - Title:       #f5c992
     - Body:        #e6e5e3
     - Step counter: #f5c992
     - Pulsing 2px box-shadow border driven from JS (BeneosTutorialSceneTour
       startBorderPulse) so it overrides any Foundry-injected styles.
     ============================================================ */
  .tour-center-step,
  #tooltip.tour {
    background: #151412 !important;
    color: #e6e5e3 !important;
    border: none !important;
    border-radius: 6px !important;
  }
  .tour-center-step .step-title,
  #tooltip.tour .step-title {
    color: #f5c992 !important;
    text-align: center !important;
    padding-right: 32px !important; /* leave room for the X close button */
  }
  .tour-center-step .content,
  .tour-center-step p,
  .tour-center-step li,
  #tooltip.tour .content,
  #tooltip.tour p,
  #tooltip.tour li {
    color: #e6e5e3 !important;
    text-align: left !important;
  }
  .tour-center-step .progress,
  #tooltip.tour .progress {
    color: #f5c992 !important;
  }
  .tour-center-step .step-button,
  #tooltip.tour .step-button {
    color: #f5c992 !important;
  }
  /* Bold text inside tour content → gold (was default white) */
  .tour-center-step strong, .tour-center-step b,
  #tooltip.tour strong, #tooltip.tour b {
    color: #f5c992 !important;
  }
  /* Body copy nudged up 2px for readability */
  .tour-center-step .content,
  .tour-center-step p,
  .tour-center-step li,
  #tooltip.tour .content,
  #tooltip.tour p,
  #tooltip.tour li {
    font-size: calc(1em + 2px) !important;
  }

  /* During a tour, boost app windows above the overlay (z-index 9998).
     V14: Moulinette's cloud-search renders as #mou-cloud (was #mou-browser
     in V13 via mou.browser.render). Both ID variants are listed so the
     z-index lift works on either Foundry version. */
  body.tour-active #mou-user,
  body.tour-active #mou-browser,
  body.tour-active #mou-cloud,
  body.tour-active .browser,
  body.tour-active .beneos_search_engine,
  body.tour-active .dialog,
  body.tour-active .window-app {
    z-index: 10001 !important;
  }

  /* Keep the sidebar (incl. playlist + audio sliders) and the players list
     interactive during tours so users can adjust volume / open tabs even
     when those areas are not the highlighted target. */
  body.tour-active #sidebar,
  body.tour-active aside#sidebar,
  body.tour-active #players,
  body.tour-active aside#players {
    z-index: 10001 !important;
  }
  /* Force pointer-events on every descendant — defeats any nested layer that
     would otherwise swallow drag events on volume sliders. */
  body.tour-active #sidebar *,
  body.tour-active aside#sidebar *,
  body.tour-active #players * {
    pointer-events: auto !important;
  }
  /* Lift sliders + master volume container above the tour overlay so drag
     mousedown/mousemove/mouseup events reach them directly. */
  body.tour-active #sidebar input[type="range"],
  body.tour-active #sidebar .global-volume-slider,
  body.tour-active #sidebar .global-volume,
  body.tour-active #sidebar .global-volume.global-control,
  body.tour-active #players input[type="range"] {
    z-index: 10003 !important;
    position: relative !important;
    pointer-events: auto !important;
  }

  /* Screen-fixed tour markers (for highlighting screen-positioned UI elements
     that aren't on the canvas — e.g. fallback for the audio settings area). */
  .beneos-screen-marker {
    position: fixed;
    pointer-events: none;
    background: transparent;
    border: none;
    z-index: 50;
  }
  body.tour-active .beneos-screen-marker {
    z-index: 10000 !important;
  }

  /* "No fade" mode for specific steps — removes the dark overlay so the user
     can see the full scene/UI behind the tooltip. Used for the start-welcome
     countdown (so the scene is visible) and the audio step (so volume sliders
     remain interactive without any layer in between). */
  body.tour-active.beneos-no-fade .tour-overlay,
  body.tour-active.beneos-no-fade .tour-fadeout {
    display: none !important;
    pointer-events: none !important;
  }

  /* Gold glow for chat messages highlighted by the tour. Uses a dedicated
     class (NOT .tour-highlight) so we don't collide with sidebar/clipping
     quirks. Does NOT override the chat message's own background — that
     would turn the message transparent and let the canvas bleed through. */
  #chat-log .chat-message.beneos-chat-highlight,
  .chat-log .chat-message.beneos-chat-highlight {
    outline: 3px solid #f5c992 !important;
    outline-offset: 2px !important;
    border-radius: 4px !important;
    box-shadow: 0 0 14px 4px rgba(245, 201, 146, 0.55) !important;
    position: relative !important;
    z-index: 100 !important;
  }

  /* Generic tour highlight for filter dropdowns and result boxes */
  .beneos-filter-highlight {
    outline: 3px solid #f5c992 !important;
    outline-offset: 2px !important;
    border-radius: 4px !important;
    box-shadow: 0 0 14px 4px rgba(245, 201, 146, 0.55) !important;
    position: relative !important;
    z-index: 10 !important;
  }

  /* Compact tooltip for the Welcome countdown step (start-welcome) — scoped
     via .beneos-countdown-compact so end-of-tour countdowns appended to
     wider tooltips don't get squeezed into a 320 px box. */
  .tour:has(.beneos-countdown-compact),
  .tour-center-step:has(.beneos-countdown-compact) {
    max-width: 320px !important;
    min-width: 0 !important;
  }
  .beneos-countdown-box {
    text-align: center;
    font-size: 1.05em;
    margin-top: 0.6em;
  }
  .beneos-countdown-box #beneos-countdown {
    font-size: 1.4em;
    color: #f5c992;
    font-weight: bold;
  }

  /* Fake context menu (visual demonstration of right-click options on a Note) */
  .beneos-fake-context-menu {
    position: fixed;
    background: #1a1a1a;
    border: 1px solid #999;
    border-radius: 4px;
    padding: 4px 0;
    z-index: 10005;
    pointer-events: none;
    font-family: var(--font-primary, sans-serif);
    color: #f0e6d2;
    min-width: 200px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.7);
    font-size: 0.9em;
  }
  body.tour-active .beneos-fake-context-menu {
    z-index: 10005 !important;
  }
  .beneos-fake-context-menu ol {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .beneos-fake-context-menu li {
    padding: 6px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid #333;
  }
  .beneos-fake-context-menu li:last-child {
    border-bottom: none;
  }
  .beneos-fake-context-menu li i {
    width: 16px;
    text-align: center;
    color: #c8b888;
  }

  /* Tour tooltip must be above boosted windows AND above the spotlight overlay
     (which sits at z-index 999998 to cover the Beneos Cloud window). */
  body.tour-active .tooltip.tour {
    z-index: 999999 !important;
  }
  body.tour-active .tour-center-step {
    z-index: 999999 !important;
  }
  body.tour-active .tooltip.locked-tooltip,
  body.tour-active .locked-tooltip {
    z-index: 999999 !important;
  }

  /* Make the highlighted target element pop — bright glowing border */
  .tour-highlight {
    z-index: 10000 !important;
    position: relative;
    outline: 3px solid #FFFFFF !important;
    outline-offset: 3px;
    border-radius: 4px;
    box-shadow: 0 0 12px 4px rgba(255, 255, 255, 0.6),
                inset 0 0 8px 2px rgba(255, 255, 255, 0.3) !important;
    filter: brightness(1.5) !important;
  }

  /* Also highlight the scene-controls tools area when Moulinette is active */
  body.tour-active #scene-controls-tools {
    position: relative;
  }

  /* Canvas tour markers — invisible DOM anchors in #hud for Tour tooltip targeting.
     Markers are anchor points only; the visible highlight comes from the standard
     .tour-highlight class (white-glow, identical to Phase 1 Setup Tour). */
  .beneos-tour-marker {
    position: absolute;
    pointer-events: none;
    background: transparent;
    border: none;
    z-index: 50;
  }
  body.tour-active #hud .beneos-tour-marker {
    z-index: 10000 !important;
  }

  /* "Expose" modifier — brightens the area behind the marker so the scene
     content is visually "cut out" of the dark tour overlay, even though the
     overlay itself is still in place. Requires a tiny non-zero background
     for the backdrop-filter to apply in all browsers. */
  body.tour-active #hud .beneos-tour-marker.beneos-expose {
    background: rgba(255, 255, 255, 0.005);
    backdrop-filter: brightness(2.5);
    -webkit-backdrop-filter: brightness(2.5);
    z-index: 10001 !important;
  }

  /* Persistent hover state for a Moulinette asset row during the Setup Tour.
     Moulinette hides .overlay / .menu until :hover; we force them visible so
     the per-row "Import w. ScenePacker" button shown in Step 10 stays on
     screen while the tour spotlight dims everything else. Selectors cover
     both V13 (#mou-browser) and V14 (#mou-cloud) container IDs plus the
     shared .browser root class. */
  #mou-browser .asset.inline.beneos-tour-row-focus .overlay,
  #mou-browser .asset.inline.beneos-tour-row-focus .menu,
  #mou-cloud .asset.inline.beneos-tour-row-focus .overlay,
  #mou-cloud .asset.inline.beneos-tour-row-focus .menu,
  .browser .asset.inline.beneos-tour-row-focus .overlay,
  .browser .asset.inline.beneos-tour-row-focus .menu {
    display: block !important;
    opacity: 1 !important;
    visibility: visible !important;
    pointer-events: auto !important;
  }
  #mou-browser .asset.inline.beneos-tour-row-focus,
  #mou-cloud .asset.inline.beneos-tour-row-focus,
  .browser .asset.inline.beneos-tour-row-focus {
    outline: 3px solid #f5c992;
    outline-offset: 2px;
    box-shadow: 0 0 12px 4px rgba(245, 201, 146, 0.6);
    z-index: 10001;
    position: relative;
  }
`;
document.head.appendChild(TOUR_CSS);

/* ================================================================== */
/*  Utility: wait for a DOM element to appear                          */
/* ================================================================== */

function waitForElement(selector, timeoutMs = 6000) {
  return new Promise(resolve => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const start = Date.now();
    const iv = setInterval(() => {
      const found = document.querySelector(selector);
      if (found || Date.now() - start > timeoutMs) {
        clearInterval(iv);
        resolve(found || null);
      }
    }, 200);
  });
}

// Inverse of waitForElement: resolves true once the element disappears (or was
// never there), false on timeout. Used to confirm a window actually closed
// before triggering the next render — V14 close animations can take ~300ms,
// during which Moulinette still treats the window as active and can suppress
// a fresh searchUI render.
function waitForElementGone(selector, timeoutMs = 1500) {
  return new Promise(resolve => {
    if (!document.querySelector(selector)) return resolve(true);
    const start = Date.now();
    const iv = setInterval(() => {
      const stillThere = document.querySelector(selector);
      if (!stillThere) {
        clearInterval(iv);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        resolve(false);
      }
    }, 100);
  });
}

/* ================================================================== */
/*  Utility: open a Moulinette window via its module API               */
/* ================================================================== */

function getMoulinette() {
  return game.modules.get("moulinette");
}

// Moulinette patron-login detection, three-layered:
//
//   1. Cache truth — `game.modules.get("moulinette").cache.user.patron`
//      is the field templates consult. Populated lazily on first render
//      and updated only when the cache is cleared and re-fetched (which
//      is what the manual-recheck path does). When cache.user exists, it
//      is authoritative.
//
//   2. DOM primary — a link to patreon.com/moulinette is rendered in both
//      the browser footer (browser.hbs) and the user window (user.hbs),
//      but ONLY when `user.patron === false`. If no Moulinette window has
//      ever rendered, no such link exists either.
//
//   3. DOM secondary — per-asset action "Support Creator" button
//      (MOU.action_support) appears in place of Download on locked
//      premium assets.
//
// If nothing indicates "not logged in" we assume logged-in (conservative
// default — better than trapping a user whose windows are simply closed).
function _isMoulinetteLoggedIn() {
  try {
    const mou = getMoulinette();
    const cached = mou?.cache?.user;
    // Moulinette's own user window gates all logged-in UI on `user.fullName`
    // (see moulinette/templates/user.hbs — the login button is wrapped in
    // `{{#unless user.fullName}}`). Using `cached.patron` here was wrong:
    // `patron` is per-creator tier info, not a login-state flag. Free-tier
    // Moulinette members (no paid Patreon pledge to Beneos) who still have
    // access to freely-granted content like the Getting Started pack were
    // mis-detected as logged out, triggering the login gate even though
    // the ScenePacker import button was right there and working.
    if (cached?.fullName) return true;
  } catch (e) {}
  if (document.querySelector('a[href*="patreon.com/moulinette"]')) return false;
  const supportLabel = (game.i18n.localize("MOU.action_support") || "Support Creator").trim();
  if (supportLabel) {
    const candidates = document.querySelectorAll('.browser button, .browser a, button[data-id]');
    for (const el of candidates) {
      if (el.textContent?.trim().includes(supportLabel)) return false;
    }
  }
  return true;
}

async function openMoulinetteUser() {
  const mou = getMoulinette();
  if (!mou?.user) return null;
  mou.user.render(true);
  return waitForElement("#mou-user");
}

async function openMoulinetteBrowser() {
  const mou = getMoulinette();
  if (!mou?.browser) return null;
  mou.browser.render(true);
  return waitForElement("#mou-browser");
}

/**
 * Open Moulinette's cloud search UI pre-filtered to a specific Beneos pack.
 * Used by the per-scene quick-download tiles: each demo scene has a small
 * decorative tile in the top-left that opens this filtered view so the GM
 * can grab the matching release without hunting through Moulinette manually.
 * `filters` is an object of `{ creator, pack, terms }` — any subset is fine;
 * unknown keys are safely ignored by Moulinette.
 */
function openMoulinetteWithFilter(filters = {}) {
  try {
    const mou = game.modules.get("moulinette");
    if (!mou?.api?.searchUI) {
      ui.notifications.warn(game.i18n.localize("BENEOS.Notifications.Tours.MoulinetteUnavailable"));
      return;
    }
    mou.api.searchUI("mou-cloud", "Map", filters);
  } catch (e) {
    console.warn("Beneos | Moulinette search failed:", e);
  }
}

function closeMoulinetteWindow(id) {
  const win = document.querySelector(`#${id}`);
  if (!win) return;
  const closeBtn = win.querySelector(".header-control.close, [data-action='close'], .close");
  if (closeBtn) closeBtn.click();
}

/* ================================================================== */
/*  Utility: activate the Moulinette control group in the toolbar      */
/* ================================================================== */

function activateMoulinetteToolbar() {
  const btn = document.querySelector('button[data-control="moulinette"]');
  if (btn) btn.click();
}

/* ================================================================== */
/*  Cleanup helper — removes all stale tour DOM elements               */
/* ================================================================== */

function cleanupTourElements() {
  document.querySelectorAll(".tour-center-step").forEach(el => el.remove());
  document.querySelectorAll(".tour-fadeout").forEach(el => el.remove());
  document.querySelectorAll(".tour-overlay").forEach(el => el.remove());
  // Beneos custom spotlight cutouts (applied via _applySpotlight). If a step
  // returns early or errors out, _removeSpotlight may not run — leaves the
  // dim overlay locked over the screen until full tour exit.
  document.querySelectorAll(".beneos-spotlight-piece").forEach(el => el.remove());
}

/**
 * Clear stale Foundry tour-tooltip containers BEFORE rendering a new step.
 * Foundry V13 uses a singleton `#tooltip` element so duplicates shouldn't
 * happen, but V14's tour transition occasionally leaves an orphaned
 * `aside.tour` / `.tour-tooltip` in the DOM (the X close button of the
 * orphan is bound to a stale Tour instance and refuses to dismiss). When a
 * step's _preStep takes long enough to render the next tooltip while the
 * previous one is still visible, the user sees TWO tour boxes stacked.
 *
 * Defensive sweep: keep at most one of each container. We don't know which
 * is the live one, so the simplest robust answer is to remove ALL of them —
 * Foundry will re-render the live tooltip from scratch in `_renderStep`.
 */
function clearStaleTourTooltips() {
  // Foundry V14 renders the tour box ON the singleton <aside id="tooltip">
  // by adding class="tour …". Removing that node detaches TooltipManager's
  // internal `this.tooltip` reference — the next activate() then calls
  // showPopover() on a disconnected element → InvalidStateError, tour aborts.
  // Only sweep ORPHAN duplicates, never the singleton.
  document.querySelectorAll("aside.tour, .tour-tooltip").forEach(el => {
    if (el.id === "tooltip") return;
    try { el.remove(); } catch (e) {}
  });
}

/* ================================================================== */
/*  BeneosSetupTour — Phase 1                                         */
/* ================================================================== */

/** Shared cleanup for all Beneos tours */
function tourCleanup(tour) {
  document.body.classList.remove("tour-active");
  cleanupTourElements();
  try { game.tooltip.deactivate(); } catch(e) {}
}

class BeneosSetupTour extends TourBase {

  /**
   * Play one of the Beneos tour SFX as local audio feedback (not broadcast).
   * Mirrors `BeneosTutorialSceneTour._playSound` so both tours use the same
   * files and volume.
   */
  _playSound(filename) {
    try {
      const src = `modules/beneos-module/ui/sfx/${filename}`;
      const helper = foundry.audio?.AudioHelper;
      if (helper?.play) {
        helper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
      } else if (typeof AudioHelper !== "undefined" && AudioHelper.play) {
        AudioHelper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
      }
    } catch (e) {
      console.warn(`Beneos Setup Tour | Could not play SFX ${filename}:`, e);
    }
  }

  _safeguardSelector() {
    const step = this.steps[this.stepIndex];
    if (step.selector && !document.querySelector(step.selector)) {
      step.selector = "";
    }
  }

  /** Try to set selector if element exists. Returns true if set. */
  _trySelector(selector) {
    if (document.querySelector(selector)) {
      this.steps[this.stepIndex].selector = selector;
      return true;
    }
    return false;
  }

  /**
   * Spotlight helper — identical to BeneosTutorialSceneTour's, duplicated here
   * so the Setup Tour can dim everything outside a target element (e.g. the
   * Moulinette Creator/Pack <select>, a single asset row, or the Import-All
   * button). Uses one fixed cutout div with a huge box-shadow.
   */
  _applySpotlight(targets, padding = 6) {
    this._removeSpotlight();
    const els = Array.isArray(targets) ? targets : [targets];
    const rects = els.filter(Boolean).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    if (!rects.length) return;
    const top    = Math.floor(Math.max(0, Math.min(...rects.map(r => r.top)) - padding));
    const left   = Math.floor(Math.max(0, Math.min(...rects.map(r => r.left)) - padding));
    const bottom = Math.ceil(Math.min(window.innerHeight, Math.max(...rects.map(r => r.bottom)) + padding));
    const right  = Math.ceil(Math.min(window.innerWidth, Math.max(...rects.map(r => r.right)) + padding));
    const cutout = document.createElement("div");
    cutout.classList.add("beneos-spotlight-piece");
    Object.assign(cutout.style, {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
      pointerEvents: "none",
      zIndex: "999998",
      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.75)"
    });
    document.body.appendChild(cutout);
    this._spotlight = [cutout];
  }

  _removeSpotlight() {
    (this._spotlight || []).forEach(d => { try { d.remove(); } catch (e) {} });
    this._spotlight = null;
  }

  /**
   * End-of-tour Getting-Started install flow. Extracted from the old
   * setup-complete preStep branch so we can invoke it BEFORE super._preStep
   * renders the "Setup Complete" tooltip — showing the tooltip and the
   * install dialog at the same time was confusing, and the tooltip is
   * redundant when the install actually takes over and reloads the page.
   */
  async _runAutoInstall() {
    // Transition SFX — plays the moment the user commits to the install,
    // before anything else happens, so the jump into the overlay feels
    // intentional and snappy.
    this._playSound("beneos_transition.ogg");

    // Spinner-bug workaround. Moulinette's first-pack-click after F5 routinely
    // renders ScenePacker's importer in a stuck loading state — the
    // `.content.loading .lds-ring` spinner runs forever and the import-all
    // button never appears, because moulinette-importer.js:65 has a `.then()`
    // without a `.catch()` so a transient fetch failure leaves the promise
    // chain hanging. Manual workaround that always works: close the importer,
    // wait 1-2s, reopen → loads correctly. Automate that here.
    const fixOk = await this._fixStuckImporterIfNeeded();
    if (fixOk === "failed") {
      ui.notifications.error(game.i18n.localize("BENEOS.Tour.Setup.InstallError.NoButton"));
      return;
    }

    const btn = document.querySelector('button[name="import-all"]')
             ?? document.getElementById('beneos-scenepacker-import-all');
    if (!btn) {
      console.warn("Beneos Setup Tour | Import-All button not found — user will need to click it manually.");
      ui.notifications.error(game.i18n.localize("BENEOS.Tour.Setup.InstallError.NoButton"));
      return;
    }
    // Show the full-screen install overlay so the user can't accidentally
    // click/interrupt the import. Removed by the page reload at the end of
    // onInstallDone, OR by any of the watchdog failure paths below.
    _showInstallOverlay();
    // Arm the flag: _maybeHandInstallComplete() sees this and bails out so
    // it doesn't re-ask the user via _confirmStartTutorial — the inline
    // path here is the single source of truth for this install.
    _autoInstallActive = true;

    // Shared post-install activation: runs on whichever ScenePacker
    // completion hook fires first. `handled` is closed-over so all watchdogs
    // and the hook bail out if any one of them already fired.
    let handled = false;

    // Watchdog handles — cleared on success or on any single failure so we
    // never leave a dangling timer that fires after the user has retried.
    let initialResponseTimer = null;
    let stallHintTimer = null;
    let hardTimer = null;
    const clearWatchdogs = () => {
      if (initialResponseTimer) { clearTimeout(initialResponseTimer); initialResponseTimer = null; }
      if (stallHintTimer)       { clearTimeout(stallHintTimer);       stallHintTimer = null; }
      if (hardTimer)            { clearTimeout(hardTimer);            hardTimer = null; }
    };

    // Failure-path entry point. Hides overlay, opens retry dialog, recurses
    // back into _runAutoInstall on Retry. `reasonKey` selects the user-facing
    // message; the console log includes the raw reason for diagnostics.
    const fail = async (reasonKey, diagnostic = "") => {
      if (handled) return;
      handled = true;
      clearWatchdogs();
      _hideInstallOverlay();
      // Click-blocker cleanup. _hideInstallOverlay only removes our own
      // overlay element. Foundry's tour layer (`.tour-fadeout`, `.tour-overlay`,
      // `.tour-center-step`) and our spotlight-cutout pieces can still be in
      // the DOM and intercept clicks above the dialog — the user reports
      // seeing the retry dialog but not being able to click any button or X.
      // Force-clean every tour-layer element and the body class so the
      // retry dialog is the only interactive layer left.
      cleanupTourElements();
      try { document.body.classList.remove("tour-active", "beneos-no-fade"); } catch (e) {}
      try { _removeTourTooltipDOM(); } catch (e) {}
      _autoInstallActive = false;
      console.warn(`[Beneos] Auto-install failed (${reasonKey}):`, diagnostic);
      const retry = await _confirmInstallRetry(reasonKey);
      if (retry) {
        // Re-trigger the install. The Moulinette window may have been
        // closed by the user's interactions during the retry dialog —
        // re-running _runAutoInstall handles missing-button gracefully via
        // the early-return at the top.
        await this._runAutoInstall();
      }
    };

    const onInstallDone = async (data) => {
      if (handled) return;
      handled = true;
      clearWatchdogs();
      BeneosUtility.debugMessage("Beneos Setup | post-install scene activation:", data);

      // Wave 1.5 cross-talk: if the generic empty-install detector in
      // beneos-scenepacker.js has already detected and reported a silent
      // Moulinette failure, abort the tour-level reload path. The user is
      // already looking at a "0 of N files installed" dialog from there;
      // re-firing our own retry dialog on top would be a stacked-modal mess.
      // The flag self-resets on consume, so a subsequent retry-driven run
      // gets fresh state.
      const wasEmptyInstall = globalThis.BeneosInstallTracker?.consumeEmptyInstallFlag?.();
      if (wasEmptyInstall) {
        console.warn("[Beneos] Auto-install: empty install detected by scenepacker hook — skipping tour-level reload, scenepacker dialog handles retry UX");
        _hideInstallOverlay();
        _autoInstallActive = false;
        return;
      }

      try {
        await game.settings.set(MODULE_ID, "sceneTourPending", false);
        // Let ScenePacker finish any leftover folder/journal work.
        await new Promise(r => setTimeout(r, 2500));
        // Close everything — ScenePacker "complete!" prompt, Moulinette
        // browser, auto-opened welcome journal, Setup-Tour leftovers, etc.
        // Tour Apps are spared so the Welcome tour can still start.
        _closeAllPopupsForInstall();
        let startScene = _findStartHereScene();
        if (!startScene) {
          // ScenePacker sometimes materializes the scene a tick after the
          // hook fires — one extra retry eliminates that race.
          await new Promise(r => setTimeout(r, 1500));
          startScene = _findStartHereScene();
        }
        if (!startScene) {
          console.warn("Beneos Setup | Start Here scene not found after install — activation skipped.");
          _hideInstallOverlay();
          return;
        }
        if (canvas.scene?.id !== startScene.id) {
          if (startScene.activate) await startScene.activate();
          else await startScene.view();
        }
        // Now that the Welcome scene is the active scene, reload the whole
        // page (F5 equivalent) so every client-side state is rebuilt from
        // scratch: freshly-imported compendia, playlists, tile positions,
        // tour tooltips etc. After reload, the Welcome scene is active →
        // canvasReady fires → Welcome tour auto-starts via
        // TUTORIAL_SCENE_TOURS_BY_NAME. We also clear tourFirstRun so the
        // reload doesn't accidentally re-launch the Setup Tour.
        try { await game.settings.set(MODULE_ID, "tourFirstRun", false); } catch (e) {}
        await new Promise(r => setTimeout(r, 800));
        try { window.location.reload(); } catch (e) {}
      } catch (e) {
        console.warn("Beneos Setup | post-install activation failed:", e);
        _hideInstallOverlay();
      } finally {
        _autoInstallActive = false;
      }
    };
    Hooks.once("ScenePacker.importMoulinetteComplete", onInstallDone);
    Hooks.once("ScenePacker.importAllComplete", onInstallDone);

    btn.click();

    // ---- Watchdog 1: initial-response timeout ----
    // ScenePacker's MoulinetteImporter renders with id="scene-packer-importer"
    // (export-import/moulinette-importer.js:89). It should appear within a
    // few seconds of the click — if it hasn't after 15s, the click did not
    // take. Most likely cause: Moulinette session timed out, the user got
    // signed out without the UI updating, or the network is unreachable.
    initialResponseTimer = setTimeout(() => {
      if (handled) return;
      const importer = document.getElementById("scene-packer-importer") ||
                       document.querySelector(".scene-packer-importer");
      if (!importer) {
        fail("no-start", "scene-packer-importer never rendered after 15s");
      }
    }, 15000);

    // ---- Watchdog 2: stall hint ----
    // After 60s of "Please wait…" the user starts to wonder if it's frozen.
    // We don't fail — large WebMs can legitimately take this long — but we
    // update the overlay text so the user knows it's working, not stuck.
    stallHintTimer = setTimeout(() => {
      if (handled) return;
      _updateInstallOverlayText(game.i18n.localize("BENEOS.Tour.Setup.InstallOverlay.StillWorking"));
    }, 60000);

    // ---- Watchdog 3: hard timeout ----
    // Even on a slow connection, the Getting Started Tour pack should finish
    // within 8 minutes. If the completion hook never fires by then, abort —
    // overlay can't be left up indefinitely (it blocks all input and the
    // user has no recovery path otherwise).
    hardTimer = setTimeout(() => {
      fail("timeout", "no completion hook within 8 minutes");
    }, 8 * 60 * 1000);

    // Clear suggested-next-tours BEFORE exit so Foundry's native suggestion
    // popup doesn't appear on top of the install flow.
    try { if (this.config) this.config.suggestedNextTours = []; } catch (e) {}
    // Exit the Setup Tour — fire-and-forget, not awaited (awaiting exit()
    // from inside _preStep has caused execution stalls in some V14 builds).
    try { this.exit(); } catch (e) {}
    // Kill any setup-complete tooltip DOM as a belt-and-suspenders cleanup
    // in case the framework still schedules a render tick.
    _removeTourTooltipDOM();
    setTimeout(_removeTourTooltipDOM, 200);
    setTimeout(_removeTourTooltipDOM, 800);
  }

  /**
   * Detect ScenePacker importer stuck-loading state and apply close-and-reopen
   * workaround. Returns "ok" (importer is loaded or absent — no fix needed),
   * "fixed" (stuck importer was reset and the new instance loaded fine), or
   * "failed" (stuck and reopen didn't recover within 8s — caller should fail
   * gracefully, the import-all button still won't be clickable).
   *
   * Why this exists: Moulinette's first pack-click after a Foundry reload
   * routinely traps ScenePacker's importer in a state where the loading
   * spinner runs forever — the `.then()` chain at moulinette-importer.js:65
   * has no `.catch()`, so a transient fetch failure leaves the promise
   * unresolved and `this.loading` never flips back to false. Manually closing
   * + reopening the importer fixes it 100% of the time, because the second
   * instance hits a fresh fetch with the connection now warmed up.
   */
  async _fixStuckImporterIfNeeded() {
    const importer = document.getElementById("scene-packer-importer");
    if (!importer) return "ok"; // No importer rendered — caller decides

    // Stuck signal: spinner element present + no enabled import-all button.
    // Both checks together rule out the rare race where both are momentarily
    // visible during normal load.
    const hasSpinner = !!importer.querySelector(".content.loading .lds-ring");
    const hasUsableButton = !!importer.querySelector('button[name="import-all"]:not([disabled])');
    if (!hasSpinner || hasUsableButton) return "ok";

    console.warn("[Beneos] Setup Tour | ScenePacker importer detected in stuck loading state — applying close-and-reopen workaround");

    // Cached packInfo from beneos-scenepacker.js's renderMoulinetteImporter
    // listener. Exposed via globalThis.BeneosInstallTracker.
    const cached = globalThis.BeneosInstallTracker?.getCachedPackInfo?.();
    if (!cached?.packInfo) {
      console.warn("[Beneos] Setup Tour | No cached packInfo available — cannot reinstantiate, user will need to retry the tour");
      return "failed";
    }

    // Close the stuck importer cleanly via its FormApplication instance.
    let closedOk = false;
    try {
      const importerApp = ui.windows
        ? Object.values(ui.windows).find(w => w.id === "scene-packer-importer")
        : null;
      if (importerApp) {
        await importerApp.close();
        closedOk = true;
      }
    } catch (e) {
      console.warn("[Beneos] Setup Tour | importerApp.close() threw:", e);
    }
    // Belt-and-suspenders: if no app reference or close failed, fall back to
    // clicking the close button directly via DOM.
    if (!closedOk) {
      const closeBtn = importer.querySelector('button[name="close"], [data-action="close"], .close');
      if (closeBtn) closeBtn.click();
    }

    // Wait for the DOM element to actually disappear, plus a small extra
    // buffer — the second-instance fetch needs the connection-pool to settle.
    await waitForElementGone("#scene-packer-importer", 3000);
    await new Promise(r => setTimeout(r, 1500));

    // Reinstantiate with the same pack details. ScenePacker's MoulinetteImporter
    // is a default-export ESM class; we dynamically import it the same way
    // BeneosScenePackerManager.importPackage already does (beneos-scenepacker.js:169).
    try {
      const { default: MoulinetteImporter } = await import("/modules/scene-packer/scripts/export-import/moulinette-importer.js");
      const newImporter = new MoulinetteImporter({
        packInfo: cached.packInfo,
        sceneID: cached.sceneID ?? "",
        actorID: cached.actorID ?? ""
      });
      newImporter.render(true);
    } catch (e) {
      console.error("[Beneos] Setup Tour | failed to reinstantiate MoulinetteImporter:", e);
      return "failed";
    }

    // Poll for fully-loaded state — enabled import-all button is the
    // definitive ready signal. 200ms intervals up to 8s.
    const start = Date.now();
    while (Date.now() - start < 8000) {
      const newBtn = document.querySelector('#scene-packer-importer button[name="import-all"]:not([disabled])');
      if (newBtn) {
        console.log("[Beneos] Setup Tour | stuck importer recovered via close+reopen");
        return "fixed";
      }
      await new Promise(r => setTimeout(r, 200));
    }

    console.warn("[Beneos] Setup Tour | importer still stuck after 8s of close+reopen retry");
    return "failed";
  }

  async start() {
    document.body.classList.add("tour-active");
    cleanupTourElements();
    _installTourTooltipGuard(this);
    const result = await super.start();
    this._playSound("beneos_start.ogg");
    return result;
  }

  exit() {
    _restoreTourTooltipGuard(this);
    tourCleanup(this);
    return super.exit();
  }

  async complete() {
    this._playSound("beneos_transition.ogg");
    _restoreTourTooltipGuard(this);
    tourCleanup(this);
    return super.complete();
  }

  async _postStep() {
    cleanupTourElements();
    // Restore tooltip deactivation if we blocked it
    if (this._origDeactivate) {
      game.tooltip.deactivate = this._origDeactivate;
      this._origDeactivate = null;
    }
    try { game.tooltip.deactivate(); } catch(e) {}
    // Remove extra highlights
    document.querySelector('button[data-control="moulinette"]')?.classList.remove("tour-highlight");
    document.querySelector("#beneos-scenepacker-import-all")?.classList.remove("tour-highlight");
    // Clear spotlight + Moulinette-row focus + select focus so no residue
    // carries into the next step.
    try { this._removeSpotlight(); } catch (e) {}
    document.querySelectorAll(".beneos-tour-row-focus").forEach(el => {
      el.classList.remove("beneos-tour-row-focus");
      try { el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true })); } catch (e) {}
    });
    // V13: #mou-browser, V14: #mou-cloud — both for safety.
    document.querySelectorAll("#mou-browser select, #mou-cloud select, .browser select").forEach(s => { try { s.blur(); } catch (e) {} });
    await super._postStep();
  }

  /**
   * After rendering a targeted step, block tooltip auto-dismissal.
   * Foundry's tooltip manager dismisses on pointerleave — we prevent that
   * so the tour tooltip stays visible until the user clicks Next/Previous.
   */
  async _renderStep() {
    await super._renderStep();
    if (this.currentStep.selector) {
      // Block the tooltip manager from dismissing our tour tooltip
      this._origDeactivate = game.tooltip.deactivate.bind(game.tooltip);
      game.tooltip.deactivate = () => {};
    }
    // Step-transition SFX priority (target-step keyed):
    //   1. NEXT_SOUND_OVERRIDES entry for this step id → use override.
    //   2. Last step → beneos_end.ogg.
    //   3. stepIndex > 0 → beneos_switch.ogg (stepIndex 0 stays silent so
    //      it doesn't double-up with the beneos_start.ogg fired in start()).
    const stepId = this.currentStep.id;
    if (stepId in NEXT_SOUND_OVERRIDES) {
      const override = NEXT_SOUND_OVERRIDES[stepId];
      if (override) this._playSound(override);
    } else if (this.stepIndex === this.steps.length - 1) {
      this._playSound("beneos_end.ogg");
    } else if (this.stepIndex > 0) {
      this._playSound("beneos_switch.ogg");
    }
    _hideTourStepOfY();
    setTimeout(_hideTourStepOfY, 50);
  }

  async _preStep() {
    // Step-handover guardrail: nuke any orphaned tour tooltip containers
    // BEFORE Foundry renders the new step's tooltip. V14 occasionally leaks
    // a previous step's <aside class="tour"> into the next step, producing
    // a stacked duplicate that the X button can't dismiss. Always start the
    // step with a clean DOM. Also clears stale spotlight cutouts left over
    // by an early-returning preStep handler.
    clearStaleTourTooltips();
    cleanupTourElements();

    // setup-complete: ask the auto-install question BEFORE super._preStep
    // renders the "Setup Complete" tooltip. "Yes" → run the install and skip
    // the tooltip entirely (they appeared simultaneously before, which was
    // redundant — the tour effectively continues inside the tutorial scene
    // after the reload). "No" → fall through so the tooltip serves as the
    // natural wrap-up of the Setup Tour.
    if (this.currentStep?.id === "setup-complete") {
      const proceed = await _confirmAutoInstall();
      if (proceed) {
        await this._runAutoInstall();
        return;
      }
    }
    await super._preStep();
    const stepId = this.currentStep.id;

    if (stepId === "mou-toolbar") {
      this._safeguardSelector();
    }

    if (stepId === "mou-tools") {
      activateMoulinetteToolbar();
      await new Promise(r => setTimeout(r, 600));
      // Target the last tool button (user auth icon — the person icon)
      this._trySelector("#scene-controls-tools li:last-child button") ||
      this._trySelector("#scene-controls-tools li:last-child");
      // Also highlight the Moulinette parent button
      document.querySelector('button[data-control="moulinette"]')?.classList.add("tour-highlight");
    }

    if (stepId === "mou-auth-open") {
      await openMoulinetteUser();
      await new Promise(r => setTimeout(r, 800));
      this._trySelector("#mou-user");
    }

    if (stepId === "mou-auth-explain") {
      this._trySelector("#mou-user");
    }

    if (stepId === "mou-browser-open") {
      // V14 reliability: instead of fire-and-wait-1500ms, actively poll for
      // the cloud window after each open attempt. V14 occasionally drops the
      // first searchUI call (especially right after closing #mou-user) — we
      // give it up to 4s, then retry once with a fresh API call.
      closeMoulinetteWindow("mou-user");
      // Wait for the user window to actually leave the DOM before triggering
      // searchUI. Without this, V14 can race: the close animation hasn't
      // finished, searchUI fires, and Moulinette internally suppresses the
      // new render because the previous window is still flagged as active.
      const userGone = await waitForElementGone("#mou-user", 1500);
      if (!userGone) {
        BeneosUtility?.debugMessage?.("Beneos Setup Tour | mou-browser-open: #mou-user did not close in 1.5s, proceeding anyway");
      }

      const tryOpen = async () => {
        const mouApi = getMoulinette()?.api;
        if (mouApi?.searchUI) {
          try { await mouApi.searchUI("mou-cloud", "Map", {}); return; }
          catch (e) { console.warn("[Beneos] Tour | mouApi.searchUI threw, falling back to mou.browser.render:", e); }
        }
        try { await openMoulinetteBrowser(); }
        catch (e) { console.warn("[Beneos] Tour | openMoulinetteBrowser failed:", e); }
      };

      const waitForBrowser = async (timeoutMs) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const el = document.querySelector("#mou-cloud") ||
                     document.querySelector("#mou-browser") ||
                     document.querySelector(".browser");
          if (el) return el;
          await new Promise(r => setTimeout(r, 150));
        }
        return null;
      };

      let opened = null;
      for (let attempt = 1; attempt <= 2 && !opened; attempt++) {
        await tryOpen();
        opened = await waitForBrowser(4000);
        if (!opened && attempt < 2) {
          console.warn(`[Beneos] Tour | mou-browser-open: attempt ${attempt} did not render the cloud window, retrying`);
          await new Promise(r => setTimeout(r, 500));
        }
      }

      if (!opened) {
        // Hard failure after 2 attempts. Surface a notification so the GM
        // knows why the tour is now anchored to the body — they can either
        // open Moulinette manually and click Next, or restart the tour.
        ui.notifications.warn(game.i18n.localize("BENEOS.Notifications.Tours.MoulinetteUnavailable"));
        console.error("[Beneos] Tour | mou-browser-open: Moulinette cloud window did not render after 2 attempts. Subsequent tour steps will float.");
        return;
      }

      // Anchor tooltip to whichever window ID actually rendered.
      this._trySelector("#mou-browser") ||
      this._trySelector("#mou-cloud") ||
      this._trySelector(".browser");
    }

    if (stepId === "mou-browser-creator") {
      // Filter to Beneos as creator. Same await-then-fallback pattern as
      // mou-browser-open above (without the close+open prelude).
      const mouApi = getMoulinette()?.api;
      if (mouApi?.searchUI) {
        try { await mouApi.searchUI("mou-cloud", "Map", { creator: "Beneos Battlemaps" }); }
        catch (e) { console.warn("[Beneos] Tour | searchUI(creator) failed:", e); }
      }
      await new Promise(r => setTimeout(r, 1500));
      // Point tooltip at the Creator <select> and dim the rest so the user's
      // eye is pulled to the right field (was ambiguous between Creator/Pack).
      const creatorSelect = document.querySelector("#creator-select");
      if (creatorSelect) {
        this._trySelector("#creator-select");
        this._applySpotlight(creatorSelect, 8);
      } else {
        this._trySelector("#mou-cloud .filters") ||
        this._trySelector("#mou-browser .filters") ||
        this._trySelector(".browser .filters") ||
        this._trySelector("#mou-cloud") ||
        this._trySelector("#mou-browser") ||
        this._trySelector(".browser");
      }
    }

    if (stepId === "mou-browser-pack") {
      // Filter to specific pack
      const mouApi = getMoulinette()?.api;
      if (mouApi?.searchUI) {
        try {
          await mouApi.searchUI("mou-cloud", "Map", {
            creator: "Beneos Battlemaps",
            pack: "- Beneos Getting Started Tour"
          });
        } catch (e) { console.warn("[Beneos] Tour | searchUI(pack) failed:", e); }
      }
      await new Promise(r => setTimeout(r, 1500));
      // Point tooltip at the Pack <select> (one row below Creator), spotlight
      // it, and release focus so arrow-key tour nav doesn't iterate options.
      const packSelect = document.querySelector("#pack-select");
      if (packSelect) {
        this._trySelector("#pack-select");
        this._applySpotlight(packSelect, 8);
        try { packSelect.blur(); } catch (e) {}
        try { document.activeElement?.blur?.(); } catch (e) {}
      } else {
        this._trySelector("#mou-cloud .content") ||
        this._trySelector("#mou-browser .content") ||
        this._trySelector(".browser .content") ||
        this._trySelector("#mou-cloud") ||
        this._trySelector("#mou-browser") ||
        this._trySelector(".browser");
      }
    }

    if (stepId === "mou-install-pack") {
      // Point the user at the "Start Here" scene row. Moulinette renders the
      // per-row action buttons only on :hover, so dispatch mouseenter to
      // populate .menu, mark the row to keep overlay/menu visible, then
      // spotlight that one row.
      const browser = getMoulinette()?.browser;
      const asset = browser?.currentAssets?.find(a => a.name?.includes("Start Here"));
      // V14: row lives under #mou-cloud (searchUI), V13: under #mou-browser
      // (mou.browser.render). Try both before falling back to .browser class.
      const row = asset
        ? (document.querySelector(`#mou-cloud .asset.inline[data-id="${asset.id}"]`) ||
           document.querySelector(`#mou-browser .asset.inline[data-id="${asset.id}"]`) ||
           document.querySelector(`.browser .asset.inline[data-id="${asset.id}"]`))
        : null;
      if (row) {
        row.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        row.dispatchEvent(new MouseEvent("mouseover",  { bubbles: true }));
        row.classList.add("beneos-tour-row-focus");
        await new Promise(r => setTimeout(r, 300));
        if (!row.id) row.id = "beneos-tour-target-row";
        this._trySelector(`#${row.id}`);
        this._applySpotlight(row, 6);
      } else {
        this._trySelector("#mou-cloud .content") ||
        this._trySelector("#mou-browser .content") ||
        this._trySelector(".browser .content") ||
        this._trySelector("#mou-cloud") ||
        this._trySelector("#mou-browser") ||
        this._trySelector(".browser");
      }
    }

    if (stepId === "mou-scenepacker") {
      // Login gate: if the user skipped the Moulinette Patreon login, the
      // pack download will silently fail. Detect the missing patron state
      // (Patreon link present in the DOM), force the user through the
      // login flow with a blocking dialog + Moulinette user window +
      // passive polling, and only proceed once authentication is detected.
      if (!_isMoulinetteLoggedIn()) {
        await _requireMoulinetteLogin();
        const loggedIn = await _waitForMoulinetteLogin();
        if (!loggedIn) {
          // User gave up or Moulinette never reported success — loop them
          // back to the explicit auth step so they can try the manual flow.
          this.stepIndex = 4; // mou-auth-open
          return this._preStep();
        }
        // Login confirmed — fall through and let the normal
        // mou-scenepacker preStep work finish the install path.
      }

      // Use Moulinette's internal API to trigger ScenePacker import directly
      // Action ID 2 = "Import w. ScenePacker"
      try {
        const browser = getMoulinette()?.browser;
        if (browser?.currentAssets && browser.collection) {
          const asset = browser.currentAssets.find(a =>
            a.name?.includes("Start Here")
          );
          if (asset) {
            BeneosUtility.debugMessage("Beneos Tour | Triggering ScenePacker import for:", asset.name);
            await browser.collection.executeAction(2, asset);
            // Wait for MoulinetteImporter window to render
            await new Promise(r => setTimeout(r, 4000));
          } else {
            console.warn("Beneos Tour | Asset 'Start Here' not found in currentAssets");
          }
        }
      } catch (e) {
        console.warn("Beneos Tour | Could not auto-open ScenePacker:", e);
      }

      // Find and highlight the "Import All" button
      const importAllBtn = document.querySelector('button[name="import-all"]');
      if (importAllBtn) {
        importAllBtn.id = "beneos-scenepacker-import-all";
        importAllBtn.classList.add("tour-highlight");
        this._trySelector("#beneos-scenepacker-import-all");
        this._applySpotlight(importAllBtn, 8);
      }
    }

    // Note: setup-complete is handled at the top of _preStep (before
    // super._preStep) via _runAutoInstall, so the tooltip and the install
    // dialog no longer overlap. On "no", the tooltip renders here with no
    // extra per-step logic needed — it serves as the tour's wrap-up cue.
  }
}

/* ================================================================== */
/*  BeneosDemoTour — Phase 2                                          */
/* ================================================================== */

class BeneosDemoTour extends TourBase {

  _safeguardSelector() {
    const step = this.steps[this.stepIndex];
    if (step.selector && !document.querySelector(step.selector)) {
      step.selector = "";
    }
  }

  _trySelector(selector) {
    if (document.querySelector(selector)) {
      this.steps[this.stepIndex].selector = selector;
      return true;
    }
    return false;
  }

  async start() {
    document.body.classList.add("tour-active");
    cleanupTourElements();
    _installTourTooltipGuard(this);
    return super.start();
  }

  exit() {
    _restoreTourTooltipGuard(this);
    tourCleanup(this);
    return super.exit();
  }

  async complete() {
    _restoreTourTooltipGuard(this);
    tourCleanup(this);
    return super.complete();
  }

  async _postStep() {
    cleanupTourElements();
    if (this._origDeactivate) {
      game.tooltip.deactivate = this._origDeactivate;
      this._origDeactivate = null;
    }
    try { game.tooltip.deactivate(); } catch(e) {}
    await super._postStep();
  }

  async _renderStep() {
    await super._renderStep();
    if (this.currentStep.selector) {
      this._origDeactivate = game.tooltip.deactivate.bind(game.tooltip);
      game.tooltip.deactivate = () => {};
    }
    _hideTourStepOfY();
    setTimeout(_hideTourStepOfY, 50);
  }

  async _preStep() {
    // See BeneosSetupTour._preStep — same orphan-tooltip guardrail applies
    // to the demo / creature tours too.
    clearStaleTourTooltips();
    cleanupTourElements();
    await super._preStep();
    const stepId = this.currentStep.id;

    if (stepId === "demo-actors-tab") {
      // Activate the Actors sidebar tab
      const tab = document.querySelector('[data-tab="actors"]');
      if (tab) tab.click();
      await new Promise(r => setTimeout(r, 500));
      this._trySelector('[data-tab="actors"]');
    }

    if (stepId === "demo-actors-button") {
      // Find and highlight the Beneos Cloud button (no ID/class, find by text)
      const allButtons = document.querySelectorAll("button");
      for (const btn of allButtons) {
        if (btn.textContent.includes("Beneos Cloud")) {
          btn.id = "beneos-cloud-launch-btn";
          break;
        }
      }
      this._trySelector("#beneos-cloud-launch-btn");
    }

    if (stepId === "demo-beneos-cloud") {
      // Open the Beneos Search Engine
      try {
        const { BeneosSearchEngineLauncher } = await import("./beneos_search_engine.js");
        new BeneosSearchEngineLauncher().render();
      } catch(e) {
        if (typeof BeneosSearchEngineLauncher !== "undefined") {
          new BeneosSearchEngineLauncher().render();
        }
      }
      await waitForElement(".beneos_search_engine", 5000);
      await new Promise(r => setTimeout(r, 1500));
      this._trySelector("#beneos-radio-token") ||
      this._trySelector(".beneos_search_engine");
    }

    if (stepId === "demo-search-overview") {
      this._trySelector(".beneos_search_engine");
    }

    if (stepId === "demo-maps-tab") {
      // Switch to Maps tab WITHOUT clicking the button (which submits the form!)
      // Instead, simulate the click with preventDefault
      const mapsBtn = document.querySelector("#beneos-radio-bmap");
      if (mapsBtn) {
        const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
        evt.preventDefault();
        mapsBtn.dispatchEvent(evt);
      }
      await new Promise(r => setTimeout(r, 1000));
      this._trySelector("#beneos-radio-bmap");
    }

    if (stepId === "demo-maps-filters") {
      this._trySelector("#bc-biome-add") ||
      this._trySelector(".beneos_search_engine");
    }

    if (stepId === "demo-maps-download") {
      // Target the results area where download buttons are
      this._trySelector(".bc-results") ||
      this._trySelector(".beneos_search_engine");
    }
  }
}

/* ================================================================== */
/*  Settings                                                           */
/* ================================================================== */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "tourFirstRun", {
    scope: "client",
    type: Boolean,
    default: true,
    config: false
  });

  game.settings.registerMenu(MODULE_ID, "tourStartMenu", {
    name: "BENEOS.Settings.SetupTour.Name",
    label: "BENEOS.Settings.SetupTour.Label",
    hint: "BENEOS.Settings.SetupTour.Hint",
    icon: "fas fa-hiking",
    type: BeneosStartSetupTour,
    restricted: false
  });

  game.settings.register(MODULE_ID, "sceneTourPending", {
    scope: "client",
    type: Boolean,
    default: false,
    config: false
  });

  // World-scope intentional: each new world should get a fresh first-run
  // experience. A client-scoped flag would survive world/module resets via
  // browser localStorage, so a returning GM creating a new campaign world
  // would silently miss the Setup Tour prompt.
  game.settings.register(MODULE_ID, "tourPromptLastVersion", {
    scope: "world",
    type: String,
    default: "",
    config: false
  });

  game.settings.register(MODULE_ID, "tourPromptDontShowAgain", {
    scope: "world",
    type: Boolean,
    default: false,
    config: false
  });
});

/* ------------------------------------------------------------------ */
/*  Settings-button helpers                                            */
/* ------------------------------------------------------------------ */

function startTourByKey(tourKey) {
  if (startTourByKey._active) return;
  startTourByKey._active = true;

  // Immediately: exit active tour, reset target tour, clean DOM
  try {
    if (TourBase.activeTour) TourBase.activeTour.exit();
  } catch(e) {}
  cleanupTourElements();
  try { game.tooltip.deactivate(); } catch(e) {}

  const tour = game.tours.get(`${MODULE_ID}.${tourKey}`);
  if (tour) tour.reset();

  // Short delay for settings dialog to close, then start
  setTimeout(async () => {
    try {
      if (tour) await tour.start();
    } finally {
      startTourByKey._active = false;
    }
  }, 400);
}

export class BeneosStartSetupTour extends FormApplication {
  render() { startTourByKey("setup"); return this; }
}

/* ================================================================== */
/*  BeneosTutorialSceneTour — Phase 3: Per-Scene Tutorial Tours        */
/* ================================================================== */

const TUTORIAL_ADVENTURE_NAME = "Getting Started";

class BeneosTutorialSceneTour extends TourBase {

  /** Tracked canvas-coordinate marker elements (in #hud) for cleanup */
  _markers = [];

  /** Tracked screen-fixed marker elements (in body) for cleanup */
  _screenMarkers = [];

  /** IDs of journals opened during this tour run, closed in _postStep */
  _openedJournals = [];

  /** Tiles whose sort order has been temporarily raised, restored in _postStep */
  _modifiedTiles = [];

  /** Tiles whose texture src has been temporarily swapped, restored in exit/complete */
  _modifiedTileTextures = [];

  /** Active countdown interval handle, cleared in _postStep */
  _countdownInterval = null;

  /** Active border pulse animation interval, cleared in _postStep */
  _borderPulseInterval = null;

  /** Watchdog interval that forces canvas.notes.objects hidden during the
   *  pin-activate step — defeats PlaceablesLayer._activate which would
   *  otherwise make all journal pins visible the moment we click the Notes
   *  scene-control button. */
  _notesHideInterval = null;

  /** When true, `_postStep` must NOT clear `_notesHideInterval` on step
   *  teardown — used on the Battlemap tour where pins stay hidden across
   *  steps 1–3 and only release on step 4 (`bm-region-world`). */
  _keepNotesHiddenPersistent = false;

  /** Saved original state of the battlemap knight token (position, elevation)
   *  so we can restore it on tour exit/complete. */
  _tokenOriginalState = null;

  /** Reference to a currently highlighted chat message so _postStep can clear
   *  the tour-highlight class on it. */
  _highlightedChatMsg = null;

  /** Fake context-menu DOM elements created for visual demos */
  _fakeContextMenus = [];

  /**
   * Optional next-scene navigation: if set, complete() will navigate to this
   * scene after the tour finishes. Used to chain per-scene tutorial tours.
   * @type {string|null}
   */
  nextSceneId = null;

  /**
   * Tour-wide no-fade flag. When true, the dark tour overlay is suppressed
   * for the entire tour (added in start, kept through transitions, removed
   * in exit/complete). Used for tours where the scene background should
   * remain fully visible.
   * @type {boolean}
   */
  noFade = false;

  constructor(config = {}) {
    super(config);
    this.nextSceneId = config.nextSceneId ?? null;
    this.noFade = config.noFade ?? false;
  }

  /* ---- Canvas Marker System ---- */

  /**
   * Create a temporary DOM element inside #hud at canvas coordinates.
   * The #hud container is positioned/scaled to match the canvas, so
   * canvas coordinates work directly as CSS left/top values (same
   * pattern as Foundry's ChatBubbles).
   *
   * Markers are invisible anchor points by default. Pass `highlight: true`
   * to apply the standard .tour-highlight class for a visible white glow
   * (matches the Phase 1 Setup Tour styling — no style break).
   */
  _createCanvasMarker({ x, y, w, h, id, highlight = false, expose = false }) {
    const hud = document.getElementById("hud");
    if (!hud) return null;
    const marker = document.createElement("div");
    marker.id = `beneos-tour-marker-${id}`;
    marker.classList.add("beneos-tour-marker");
    if (highlight) marker.classList.add("tour-highlight");
    if (expose) marker.classList.add("beneos-expose");
    Object.assign(marker.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`
    });
    hud.appendChild(marker);
    this._markers.push(marker);
    return marker;
  }

  /** Remove all canvas markers from the DOM */
  _clearMarkers() {
    for (const m of this._markers) m.remove();
    this._markers = [];
  }

  /* ---- Screen Marker System (fixed-position, body-relative) ---- */

  /**
   * Create a fixed-position DOM element on the body at viewport coordinates.
   * Use this for highlighting screen UI elements that aren't tied to the
   * canvas (e.g. the audio settings area in the playlist sidebar).
   *
   * Like canvas markers, these are invisible anchors by default. Pass
   * `highlight: true` to apply the standard `.tour-highlight` class.
   */
  _createScreenMarker({ x, y, w, h, id, highlight = false }) {
    const marker = document.createElement("div");
    marker.id = `beneos-screen-marker-${id}`;
    marker.classList.add("beneos-screen-marker");
    if (highlight) marker.classList.add("tour-highlight");
    Object.assign(marker.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`
    });
    document.body.appendChild(marker);
    this._screenMarkers.push(marker);
    return marker;
  }

  /** Remove all screen markers from the DOM */
  _clearScreenMarkers() {
    for (const m of this._screenMarkers) m.remove();
    this._screenMarkers = [];
  }

  /* ---- Canvas Navigation ---- */

  /**
   * Pan and zoom the canvas camera, with optional swoosh audio feedback.
   * Pass `sound: false` when the step has its own NEXT_SOUND_OVERRIDES entry
   * (e.g. roar, monster death) to avoid stacking sounds.
   */
  async _panTo({ x, y, scale = 1.2, duration = 1000, sound = true }) {
    if (!canvas.ready) return;
    if (sound) {
      this._swooshThisStep = true; // Tells _renderStep not to play page-turn
      this._playSound("beneos_swoosh.ogg");
    }
    return canvas.animatePan({ x, y, scale, duration });
  }

  /** Wait until the canvas is ready (max 10 s) */
  _ensureCanvasReady() {
    if (canvas.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Canvas not ready")), 10000);
      Hooks.once("canvasReady", () => { clearTimeout(timeout); resolve(); });
    });
  }

  /** Navigate to a scene and wait for the canvas to be ready.
   *  Uses scene.activate() so that ambient playlists & related triggers fire. */
  async _navigateToScene(scene) {
    if (canvas.scene?.id === scene.id) return;
    if (scene.activate) await scene.activate();
    else await scene.view();
    await this._ensureCanvasReady();
    await new Promise(r => setTimeout(r, 800));
  }

  /**
   * Open a JournalEntry sheet (optionally on a specific page) and track it
   * so it can be closed later by _closeOpenedJournals.
   *
   * The click SFX for journal steps is played by next()/previous() via the
   * NEXT_SOUND_OVERRIDES map (target step id → "beneos_click.ogg"). Playing
   * it here as well would cause a double-click artefact.
   *
   * @returns {Promise<JournalSheet|null>}  The rendered sheet, or null on failure.
   */
  async _openJournal(journalId, pageId = null, { collapseSidebar = false } = {}) {
    try {
      const journal = game.journal.get(journalId);
      if (!journal) {
        console.warn(`Beneos Tutorial Tour | Journal ${journalId} not found`);
        return null;
      }
      // Pass the collapse preference as a render option so the sheet's
      // internal state is correct on first paint (V14: `expanded: false`,
      // V13: `collapsed: true`). Belt-and-braces toggle call below handles
      // re-renders and any core version that ignores the option.
      const renderOpts = {};
      if (pageId) renderOpts.pageId = pageId;
      if (collapseSidebar) {
        renderOpts.expanded = false;    // V14 JournalEntrySheet
        renderOpts.collapsed = true;    // V13 JournalSheet
      }
      await journal.sheet.render(true, renderOpts);
      this._openedJournals.push(journalId);
      if (collapseSidebar) this._collapseJournalSidebar(journal.sheet);
      return journal.sheet;
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to open journal:", e);
      return null;
    }
  }

  /**
   * Collapse the page-navigation sidebar of a JournalEntrySheet using
   * Foundry's native API. Handouts in this tour are single-page, so the
   * sidebar is visual clutter.
   *   - V14 JournalEntrySheet (ApplicationV2): `sheet.sidebarExpanded`
   *     getter + `toggleSidebar()` method. Sidebar is open when expanded.
   *   - V13 JournalSheet (appv1): `sheet.sidebarCollapsed` getter +
   *     `toggleSidebar()` method. Sidebar is open when NOT collapsed.
   * We wait briefly for the first render to complete, then toggle only if
   * the sidebar is currently open — idempotent on re-renders.
   */
  _collapseJournalSidebar(sheet) {
    setTimeout(() => {
      try {
        if (!sheet || typeof sheet.toggleSidebar !== "function") return;
        const isOpen = (sheet.sidebarExpanded === true)        // V14
                    || (sheet.sidebarCollapsed === false);      // V13
        if (isOpen) sheet.toggleSidebar();
      } catch (e) {
        console.warn("Beneos Tutorial Tour | _collapseJournalSidebar failed:", e);
      }
    }, 150);
  }

  /**
   * Close all journals opened earlier in this tour run via _openJournal.
   * Called from _postStep so journals disappear after the step that opened them.
   */
  async _closeOpenedJournals() {
    for (const id of this._openedJournals) {
      try {
        const journal = game.journal.get(id);
        if (journal?.sheet?.rendered) {
          await journal.sheet.close();
        }
      } catch (e) {
        console.warn(`Beneos Tutorial Tour | Failed to close journal ${id}:`, e);
      }
    }
    this._openedJournals = [];
  }

  /**
   * Temporarily raise a tile's sort order so it renders above other tiles.
   * Used to reveal hidden arrow/marker tiles for specific tour steps.
   * The original sort is saved and restored in _restoreTiles.
   */
  async _bringTileToFront(tileIdOrUuid) {
    try {
      const id = tileIdOrUuid.includes(".") ? tileIdOrUuid.split(".").pop() : tileIdOrUuid;
      // Idempotent: skip if already foregrounded — second call would overwrite
      // the saved sort with 99999 and break restoration.
      if (this._modifiedTiles.some(t => t.id === id)) return;
      const tile = canvas.tiles?.get(id) ?? canvas.tiles?.placeables.find(t => t.id === id);
      if (!tile) {
        console.warn(`Beneos Tutorial Tour | Tile ${id} not found on canvas`);
        return;
      }
      this._modifiedTiles.push({
        id,
        sort: tile.document.sort,
        elevation: tile.document.elevation
      });
      await tile.document.update({ sort: 99999 });
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to bring tile to front:", e);
    }
  }

  /** Restore the original sort order of any tiles modified by _bringTileToFront. */
  async _restoreTiles() {
    for (const t of this._modifiedTiles) {
      try {
        const tile = canvas.tiles?.get(t.id);
        if (tile) await tile.document.update({ sort: t.sort });
      } catch (e) {
        console.warn(`Beneos Tutorial Tour | Failed to restore tile ${t.id}:`, e);
      }
    }
    this._modifiedTiles = [];
  }

  /**
   * Play or pause a video tile by ID, mirroring the exact pattern Foundry's
   * own Tile HUD uses (see tile-hud.mjs#onControlVideo): pass `playVideo` in
   * the document update *options* (not in the data), which triggers
   * `_refreshVideo` → `game.video.play(video, playOptions)` on the placeable.
   *
   * As a belt-and-suspenders fallback, also call the underlying HTMLVideoElement
   * `.play()` / `.pause()` directly via `tile.sourceElement` so playback starts
   * even when the document update path is racing or being suppressed.
   */
  async _playTileVideo(tileIdOrUuid, play = true) {
    try {
      const id = tileIdOrUuid.includes(".") ? tileIdOrUuid.split(".").pop() : tileIdOrUuid;
      const tile = canvas.tiles?.get(id);
      if (!tile) {
        console.warn(`Beneos Tutorial Tour | Tile ${id} not found for video control`);
        return;
      }
      // Primary path: official Foundry V13/V14 API — same as TileHUD's play button.
      try {
        await tile.document.update(
          { "video.autoplay": play, "video.loop": play },
          { diff: false, playVideo: play, offset: play ? null : null }
        );
      } catch (e) {
        console.warn("Beneos Tutorial Tour | tile.document.update playVideo failed:", e);
      }
      // Fallback: poke the underlying HTMLVideoElement directly. tile.sourceElement
      // is the documented accessor; tile.mesh.texture path is the older one.
      try {
        const src = tile.sourceElement
                 ?? tile.mesh?.texture?.baseTexture?.resource?.source
                 ?? tile.mesh?.texture?.source?.resource;
        if (src && typeof src.play === "function") {
          if (play) {
            src.loop = true;
            const p = src.play();
            if (p && typeof p.catch === "function") p.catch(() => {});
          } else {
            src.pause();
          }
        }
      } catch (e) {
        console.warn("Beneos Tutorial Tour | Direct video element control failed:", e);
      }
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Tile video control failed:", e);
    }
  }

  /**
   * Pause every video tile on the current scene — used to simulate the
   * "static map" variant on the Scenery tour. Stores the previously-playing
   * HTMLVideoElements on `this._frozenSceneVideos` so `_unfreezeSceneVideos`
   * can restart exactly those (and not resume tiles the user had paused).
   */
  _freezeSceneVideos() {
    this._frozenSceneVideos = [];
    try {
      for (const tile of canvas.tiles?.placeables ?? []) {
        const src = tile.sourceElement
                 ?? tile.mesh?.texture?.baseTexture?.resource?.source
                 ?? tile.mesh?.texture?.source?.resource;
        if (src && typeof src.pause === "function" && !src.paused) {
          try { src.pause(); this._frozenSceneVideos.push(src); } catch (e) {}
        }
      }
    } catch (e) {
      console.warn("Beneos Tutorial Tour | _freezeSceneVideos failed:", e);
    }
  }

  /**
   * Toggle PIXI `renderable` on a set of tiles (placeable container + the
   * primary-group mesh). Mirrors the farewell-video hide pattern — setting
   * only `placeable.renderable = false` leaves the tile sprite on screen
   * because the actual mesh lives in `canvas.primary`.
   *
   * Returns the prior state as an array of `{ id, obj, mesh }` so the caller
   * can restore the exact pre-call renderable booleans on tour exit.
   */
  _setTilesRenderable(tileIds, renderable) {
    const snapshots = [];
    for (const id of tileIds) {
      const tile = canvas.tiles?.get(id);
      if (!tile) continue;
      snapshots.push({ id, obj: tile.renderable, mesh: tile.mesh?.renderable });
      try {
        tile.renderable = renderable;
        if (tile.mesh) tile.mesh.renderable = renderable;
      } catch (e) {}
    }
    return snapshots;
  }

  /**
   * Same pattern as `_setTilesRenderable`, but for Drawing placeables. In V14
   * the drawing's shape lives in `canvas.primary` — setting only
   * `placeable.renderable = false` leaves the shape visible. Toggle both.
   * Returns a snapshot for restoration on tour exit.
   */
  _setDrawingsRenderable(drawingIds, renderable) {
    const snapshots = [];
    for (const id of drawingIds) {
      const drawing = canvas.drawings?.get(id);
      if (!drawing) continue;
      snapshots.push({ id, obj: drawing.renderable, shape: drawing.shape?.renderable });
      try {
        drawing.renderable = renderable;
        if (drawing.shape) drawing.shape.renderable = renderable;
      } catch (e) {}
    }
    return snapshots;
  }

  /** Resume video tiles paused by `_freezeSceneVideos`. Idempotent. */
  _unfreezeSceneVideos() {
    if (!this._frozenSceneVideos?.length) return;
    for (const src of this._frozenSceneVideos) {
      try {
        const p = src.play?.();
        if (p?.catch) p.catch(() => {});
      } catch (e) {}
    }
    this._frozenSceneVideos = [];
  }

  /**
   * Swap a tile's texture src to a new path. The original src is saved so
   * _restoreTileTextures can put it back at the end of the tour.
   */
  async _swapTileTexture(tileIdOrUuid, newSrc) {
    try {
      const id = tileIdOrUuid.includes(".") ? tileIdOrUuid.split(".").pop() : tileIdOrUuid;
      const tile = canvas.tiles?.get(id);
      if (!tile) {
        console.warn(`Beneos Tutorial Tour | Tile ${id} not found for texture swap`);
        return;
      }
      this._modifiedTileTextures.push({ id, src: tile.document.texture?.src });
      await tile.document.update({ texture: { src: newSrc } });
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Tile texture swap failed:", e);
    }
  }

  /** Restore any tile textures that were swapped via _swapTileTexture. */
  async _restoreTileTextures() {
    for (const t of this._modifiedTileTextures) {
      try {
        const tile = canvas.tiles?.get(t.id);
        if (tile && t.src) await tile.document.update({ texture: { src: t.src } });
      } catch (e) {
        console.warn(`Beneos Tutorial Tour | Failed to restore tile texture ${t.id}:`, e);
      }
    }
    this._modifiedTileTextures = [];
  }

  /**
   * Programmatically open the Tile HUD on a given tile, simulating a
   * right-click. The TileHUD displays its control buttons next to the tile.
   */
  _openTileHUD(tileIdOrUuid) {
    try {
      const id = tileIdOrUuid.includes(".") ? tileIdOrUuid.split(".").pop() : tileIdOrUuid;
      const tile = canvas.tiles?.get(id);
      if (!tile) return;
      canvas.hud?.tile?.bind?.(tile);
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to open tile HUD:", e);
    }
  }

  /**
   * Hide placeholder-image tiles on the active scene by setting their alpha
   * to 0 via a single batched update. Used to create the "empty overview"
   * demo effect before the pin-activation step reveals them.
   */
  async _hidePlaceholderTiles(tileIds) {
    if (!canvas.scene) return;
    const updates = [];
    for (const uuid of tileIds) {
      const id = uuid.includes(".") ? uuid.split(".").pop() : uuid;
      if (canvas.scene.tiles.get(id)) {
        updates.push({ _id: id, alpha: 0 });
      }
    }
    if (updates.length) {
      try {
        await canvas.scene.updateEmbeddedDocuments("Tile", updates);
      } catch (e) {
        console.warn("Beneos Tutorial Tour | Failed to hide placeholder tiles:", e);
      }
    }
  }

  /** Reveal previously hidden placeholder tiles (alpha back to 1). */
  async _showPlaceholderTiles(tileIds) {
    if (!canvas.scene) return;
    const updates = [];
    for (const uuid of tileIds) {
      const id = uuid.includes(".") ? uuid.split(".").pop() : uuid;
      if (canvas.scene.tiles.get(id)) {
        updates.push({ _id: id, alpha: 1 });
      }
    }
    if (updates.length) {
      try {
        await canvas.scene.updateEmbeddedDocuments("Tile", updates);
      } catch (e) {
        console.warn("Beneos Tutorial Tour | Failed to show placeholder tiles:", e);
      }
    }
  }

  /* ---- Token Helpers (Battlemap tour) ---- */

  /**
   * Find a token on the current canvas. Accepts a Token document ID,
   * an Actor ID, or a full Foundry UUID (e.g. "Actor.0kffK0uqEseXCTQi").
   */
  _findToken(idOrUuid) {
    if (!idOrUuid || !canvas.tokens) return null;
    const id = idOrUuid.includes(".") ? idOrUuid.split(".").pop() : idOrUuid;
    let token = canvas.tokens.get(id);
    if (token) return token;
    return canvas.tokens.placeables.find(t =>
      t.id === id || t.actor?.id === id || t.document?.actorId === id
    ) || null;
  }

  /** Move a token by `dx`/`dy` grid cells (negative = up/left). */
  async _moveTokenByFields(idOrUuid, dx, dy) {
    const token = this._findToken(idOrUuid);
    if (!token) {
      console.warn(`Beneos Tutorial Tour | Token ${idOrUuid} not found`);
      return;
    }
    const gs = canvas.grid?.size ?? 100;
    try {
      // Tour controls all MLT teleports explicitly via _triggerMLTTeleport;
      // the auto-trigger from MLT's updateToken hook would visually revert
      // the move (token enters region → MLT teleports back → "halfway" bug).
      await token.document.update(
        { x: token.document.x + (dx * gs), y: token.document.y + (dy * gs) },
        { mlt_bypass: true }
      );
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to move token:", e);
    }
  }

  /** Set a token's elevation value (V13/V14: tokenDoc.elevation). */
  async _setTokenElevation(idOrUuid, elevation) {
    const token = this._findToken(idOrUuid);
    if (!token) return;
    try {
      await token.document.update({ elevation });
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to set token elevation:", e);
    }
  }

  /** Snapshot a token's current position + elevation for later restoration. */
  _saveTokenState(idOrUuid) {
    const token = this._findToken(idOrUuid);
    if (!token) return;
    this._tokenOriginalState = {
      id: token.id,
      x: token.document.x,
      y: token.document.y,
      elevation: token.document.elevation ?? 0
    };
  }

  /** Restore the previously snapshotted token state (if any). */
  async _restoreTokenState() {
    if (!this._tokenOriginalState) return;
    const s = this._tokenOriginalState;
    this._tokenOriginalState = null;
    try {
      const token = canvas.tokens?.get(s.id);
      if (token) {
        await token.document.update({ x: s.x, y: s.y, elevation: s.elevation });
      }
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to restore token state:", e);
    }
  }

  /**
   * Trigger an MLT teleport DIRECTLY by calling the MLT module's internal
   * `_activateTeleport` method on `game.multilevel`.
   *
   * Why direct call instead of the hook-based trigger:
   *  - MLT's `updateToken` hook (`_onUpdateToken`) requires the token's
   *    CENTRE (as computed by MLT's own grid math) to land inside the "in"
   *    region AND `_isPrimaryGamemaster()` to be true. Our earlier attempts
   *    at positioning the token programmatically weren't landing inside the
   *    region reliably, so the hook never fired.
   *  - `game.multilevel` is the global module instance, set in
   *    `multilevel.js` line 1996: `Hooks.on('init', () => game.multilevel = new MultilevelTokens());`
   *  - `_activateTeleport(scene, inRegion, tokens)` is the method that
   *    computes the destination via `_mapPosition`, updates the token, and
   *    fires the GM chat notification (`_notifyGmTeleport`).
   *
   * The token is first moved to the exact centre of the "in" drawing with
   * `mlt_bypass: true` in the update options so MLT's hook sets
   * `_lastTeleport` (via `_onUpdateToken` line 1751) instead of trying to
   * run a double teleport. Then we call `_activateTeleport` directly.
   */
  async _triggerMLTTeleport(drawingId, tokenIdOrUuid) {
    const mlt = game.multilevel;
    if (!mlt) {
      console.warn("Beneos Tutorial Tour | game.multilevel not initialised — MLT module missing?");
      return false;
    }
    if (typeof mlt._isPrimaryGamemaster === "function" && !mlt._isPrimaryGamemaster()) {
      console.warn("Beneos Tutorial Tour | Not primary GM — MLT teleport aborted");
      return false;
    }
    const scene = canvas.scene;
    if (!scene) return false;
    const dId = drawingId.includes(".") ? drawingId.split(".").pop() : drawingId;
    const drawing = scene.drawings.get(dId);
    const tokenPlaceable = this._findToken(tokenIdOrUuid);
    if (!drawing || !tokenPlaceable) {
      console.warn("Beneos Tutorial Tour | MLT teleport: drawing or token not found");
      return false;
    }
    const tokenDoc = tokenPlaceable.document;
    try {
      // Step 1: move the token into the centre of the "in" drawing so that
      // MLT's position mapping produces a sensible destination. Pass
      // `mlt_bypass: true` so MLT's own updateToken hook does NOT also try
      // to run the teleport logic (which would cause a double teleport).
      const gs = canvas.grid?.size ?? 100;
      const shape = drawing.shape;
      const drawX = drawing.x ?? 0;
      const drawY = drawing.y ?? 0;
      const w = shape?.width ?? gs;
      const h = shape?.height ?? gs;
      const cx = drawX + w / 2;
      const cy = drawY + h / 2;
      const tokenW = (tokenDoc.width ?? 1) * gs;
      const tokenH = (tokenDoc.height ?? 1) * gs;
      await tokenDoc.update(
        { x: cx - tokenW / 2, y: cy - tokenH / 2 },
        { mlt_bypass: true }
      );
      // Tiny pause so the update fully propagates before we fire the teleport
      await new Promise(r => setTimeout(r, 100));
      // Step 2: directly invoke MLT's internal teleport activation. This
      // bypasses _doTeleport's region-containment + _lastTeleport checks
      // and goes straight to _activateTeleport → _mapPosition → queued
      // token update + _notifyGmTeleport chat message.
      mlt._activateTeleport(scene, drawing, [tokenDoc]);
      return true;
    } catch (e) {
      console.warn("Beneos Tutorial Tour | MLT _activateTeleport threw:", e);
      return false;
    }
  }

  /**
   * Wait for the next createChatMessage hook to fire, or resolve to null
   * after `timeoutMs`. Use this to time-align UI with MLT's async chat
   * notification instead of guessing a fixed delay.
   */
  _waitForNewChatMessage(timeoutMs = 10000) {
    return new Promise((resolve) => {
      let resolved = false;
      const hookId = Hooks.once("createChatMessage", (message) => {
        if (resolved) return;
        resolved = true;
        resolve(message);
      });
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        try { Hooks.off("createChatMessage", hookId); } catch (e) {}
        resolve(null);
      }, timeoutMs);
    });
  }

  /**
   * Open the chat sidebar and highlight a specific ChatMessage document by
   * ID (preferred) or the last rendered message in the log (fallback).
   * Uses a dedicated `.beneos-chat-highlight` class (not `.tour-highlight`)
   * so sidebar clipping / stacking quirks don't wreck the visual.
   *
   * @returns {HTMLElement|null}  The highlighted chat message element.
   */
  async _highlightChatMessage(messageId = null) {
    try {
      const chatTab = document.querySelector('[data-tab="chat"]')
                   ?? document.querySelector('#sidebar-tabs [data-tab="chat"]')
                   ?? document.querySelector('nav#sidebar-tabs a[data-tab="chat"]');
      chatTab?.click();
      await new Promise(r => setTimeout(r, 300));
      // Prefer targeting by ID so we highlight exactly the message we waited for
      let msgEl = null;
      if (messageId) {
        msgEl = document.querySelector(`#chat-log .chat-message[data-message-id="${messageId}"]`);
      }
      if (!msgEl) {
        const msgs = document.querySelectorAll('#chat-log .chat-message, .chat-log .chat-message');
        if (msgs.length) msgEl = msgs[msgs.length - 1];
      }
      if (!msgEl) return null;
      try { msgEl.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
      msgEl.classList.add("beneos-chat-highlight");
      this._highlightedChatMsg = msgEl;
      return msgEl;
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to highlight chat message:", e);
      return null;
    }
  }

  /**
   * Open the chat sidebar tab and highlight its last message with the
   * custom .beneos-chat-highlight class (gold glow). Waits `delayMs` first
   * so any MLT teleport notification has time to arrive.
   *
   * @returns {HTMLElement|null}  The highlighted chat message element, or null.
   */
  async _showChatWithLastMessage(delayMs = 3000) {
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    try {
      const chatTab = document.querySelector('[data-tab="chat"]')
                   ?? document.querySelector('#sidebar-tabs [data-tab="chat"]')
                   ?? document.querySelector('nav#sidebar-tabs a[data-tab="chat"]');
      chatTab?.click();
      await new Promise(r => setTimeout(r, 400));
      const messages = document.querySelectorAll('#chat-log .chat-message, .chat-log .chat-message');
      if (messages.length === 0) return null;
      const last = messages[messages.length - 1];
      try { last.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
      last.classList.add("beneos-chat-highlight");
      this._highlightedChatMsg = last;
      return last;
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to show/highlight chat:", e);
      return null;
    }
  }

  /**
   * Start a visible countdown that auto-advances the tour when it reaches zero.
   * The countdown updates an element with id `beneos-countdown` inside the
   * current step's content (if present).
   *
   * @param {number} seconds  How many seconds to count down from.
   */
  _startCountdown(seconds = 10) {
    this._stopCountdown();
    // Capture the step we started from so we can stop cleanly if the user
    // advances manually before the countdown finishes (race condition guard).
    const startStepId = this.currentStep?.id;
    let remaining = seconds;
    const tick = () => {
      // Safety: bail out if we are no longer on the step that started the countdown
      if (this.currentStep?.id !== startStepId) {
        this._stopCountdown();
        return;
      }
      const el = document.getElementById("beneos-countdown");
      if (el) el.textContent = String(remaining);
      if (remaining <= 0) {
        this._stopCountdown();
        try { this.next(); } catch (e) { console.warn("Beneos Tutorial Tour | next() failed:", e); }
        return;
      }
      remaining--;
    };
    tick(); // initial paint
    this._countdownInterval = setInterval(tick, 1000);
  }

  /** Stop any active countdown interval. */
  _stopCountdown() {
    if (this._countdownInterval) {
      clearInterval(this._countdownInterval);
      this._countdownInterval = null;
    }
  }

  /**
   * Start a sinusoidal box-shadow pulse on visible tour boxes AND the
   * Next-arrow button. Driven from JS (not CSS) so it overrides any
   * Foundry-injected !important styles via inline style.setProperty(..., "important").
   *
   * Uses two separate color ramps synchronized on the same phase:
   * - Box border: dark #151412  <->  gold #f5c992
   * - Next arrow: white #e6e5e3  <->  gold #f5c992
   * (arrow never pulses down to the box colour — it would be invisible)
   */
  _startBorderPulse() {
    this._stopBorderPulse();
    const PERIOD_MS = 4000; // 0.5 Hz: one full pulse every 2 seconds
    const boxStart   = [21, 20, 18];      // #151412 dark
    const boxEnd     = [245, 201, 146];   // #f5c992 gold
    const arrowStart = [230, 229, 227];   // #e6e5e3 body text white
    const arrowEnd   = [245, 201, 146];   // #f5c992 gold
    const t0 = performance.now();
    const lerp = (a, b, p) => Math.round(a + (b - a) * p);
    const tick = () => {
      const t = ((performance.now() - t0) % PERIOD_MS) / PERIOD_MS; // 0..1
      // Smooth sinusoidal easing 0 -> 1 -> 0 over the period
      const phase = (Math.sin(t * Math.PI * 2 - Math.PI / 2) + 1) / 2; // 0..1

      // 1) Box border pulse (dark <-> gold)
      const br = lerp(boxStart[0], boxEnd[0], phase);
      const bg = lerp(boxStart[1], boxEnd[1], phase);
      const bb = lerp(boxStart[2], boxEnd[2], phase);
      const boxColor = `rgb(${br}, ${bg}, ${bb})`;
      const boxGlow  = `rgba(${br}, ${bg}, ${bb}, 0.45)`;
      const boxValue = `0 0 0 2px ${boxColor}, 0 0 14px 2px ${boxGlow}`;
      document.querySelectorAll(".tour-center-step, #tooltip.tour").forEach(
        el => el.style.setProperty("box-shadow", boxValue, "important")
      );

      // 2) Next-arrow pulse (white <-> gold) — stays visible at all times
      const ar = lerp(arrowStart[0], arrowEnd[0], phase);
      const ag = lerp(arrowStart[1], arrowEnd[1], phase);
      const ab = lerp(arrowStart[2], arrowEnd[2], phase);
      const arrowColor = `rgb(${ar}, ${ag}, ${ab})`;
      const arrowGlow  = `rgba(${ar}, ${ag}, ${ab}, 0.55)`;
      document.querySelectorAll(
        ".tour-center-step [data-action='next'], #tooltip.tour [data-action='next']"
      ).forEach(btn => {
        btn.style.setProperty("color", arrowColor, "important");
        btn.style.setProperty("filter", `drop-shadow(0 0 6px ${arrowGlow})`, "important");
      });
    };
    tick();
    this._borderPulseInterval = setInterval(tick, 50); // ~20fps, smooth enough
  }

  /** Stop the pulsing border animation. */
  _stopBorderPulse() {
    if (this._borderPulseInterval) {
      clearInterval(this._borderPulseInterval);
      this._borderPulseInterval = null;
    }
  }

  /**
   * Make sure the game is not paused — the pause icon overlays the canvas
   * and would obscure tutorial content/markers. Called at start of each step.
   */
  async _ensureUnpaused() {
    try {
      if (game.paused) await game.togglePause(false);
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to unpause game:", e);
    }
  }

  /**
   * Play one of the Beneos tour SFX as local audio feedback (not broadcast).
   * @param {string} filename  Filename inside modules/beneos-module/ui/sfx/
   */
  _playSound(filename) {
    try {
      const src = `modules/beneos-module/ui/sfx/${filename}`;
      const helper = foundry.audio?.AudioHelper;
      if (helper?.play) {
        helper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
      } else if (typeof AudioHelper !== "undefined" && AudioHelper.play) {
        AudioHelper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
      }
    } catch (e) {
      console.warn(`Beneos Tutorial Tour | Could not play SFX ${filename}:`, e);
    }
  }

  /**
   * Override next() to play the appropriate step-transition SFX.
   * Rules:
   *  - Last step reached → beneos_end.ogg
   *  - Target step is in NEXT_SOUND_OVERRIDES → use that override (or silence if null)
   *  - Otherwise → beneos_switch.ogg
   */
  async next() {
    // Sound is handled in _renderStep (after we know whether _panTo played a swoosh)
    return super.next();
  }

  async previous() {
    return super.previous();
  }

  /**
   * Make sure Music + Ambient master volumes are at least at the given
   * per-slider thresholds so the user gets the intended audio experience
   * during the tutorial. Settings ABOVE the threshold are left untouched —
   * those are the user's personal preference.
   *
   * @param {object} [opts]
   * @param {number} [opts.playlist=0.6]  Music slider floor 0-1.
   * @param {number} [opts.ambient=0.4]   Ambient slider floor 0-1.
   */
  async _ensureMinAudioVolume({ playlist = 0.6, ambient = 0.4 } = {}) {
    try {
      const helper = foundry.audio?.AudioHelper;
      const settings = [
        ["core", "globalPlaylistVolume", playlist],
        ["core", "globalAmbientVolume",  ambient]
      ];
      for (const [ns, key, threshold] of settings) {
        try {
          const target = helper?.inputToVolume ? helper.inputToVolume(threshold) : threshold;
          const current = game.settings.get(ns, key);
          if (current < target) {
            await game.settings.set(ns, key, target);
            BeneosUtility.debugMessage(`Beneos Tutorial Tour | Raised ${key} from ${current.toFixed(3)} to ${target.toFixed(3)}`);
          }
        } catch (e) {
          console.warn(`Beneos Tutorial Tour | Could not adjust ${key}:`, e);
        }
      }
    } catch (e) {
      console.warn("Beneos Tutorial Tour | _ensureMinAudioVolume failed:", e);
    }
  }

  /**
   * Pin the Interface volume (click / feedback SFX channel) to a fixed
   * slider value at every tour start. Unlike `_ensureMinAudioVolume`, this
   * is an unconditional set — the tour SFX are designed around this level
   * and the user has explicitly asked for 50 % on every tour start.
   *
   * @param {number} input  Slider position 0-1 (default 0.5).
   */
  _setInterfaceVolume(input = 0.5) {
    try {
      const helper = foundry.audio?.AudioHelper;
      const target = helper?.inputToVolume ? helper.inputToVolume(input) : input;
      const current = game.settings.get("core", "globalInterfaceVolume");
      if (current !== target) {
        game.settings.set("core", "globalInterfaceVolume", target);
      }
    } catch (e) {
      console.warn("Beneos Tutorial Tour | _setInterfaceVolume failed:", e);
    }
  }

  /**
   * Enforce this tour's Music + (optional) Env sound per TOUR_AUDIO_MAP.
   * Stops every managed sound that doesn't belong here, then (re)starts
   * the desired ones. Idempotent. Each scene's own attached playlist still
   * handles its Env via Foundry's scene-audio system; this method only
   * touches sounds explicitly listed in TOUR_AUDIO_MAP.
   */
  _applyTourAudio() {
    try {
      const desired = TOUR_AUDIO_MAP[this.id] ?? {};
      const desiredKeys = new Set();
      if (desired.music) desiredKeys.add(`${desired.music.p}.${desired.music.s}`);
      if (desired.env)   desiredKeys.add(`${desired.env.p}.${desired.env.s}`);
      for (const key of MANAGED_AUDIO_KEYS) {
        if (desiredKeys.has(key)) continue;
        const [pId, sId] = key.split(".");
        const pl = game.playlists.get(pId);
        const snd = pl?.sounds.get(sId);
        if (snd?.playing) pl.stopSound(snd);
      }
      for (const key of desiredKeys) {
        const [pId, sId] = key.split(".");
        const pl = game.playlists.get(pId);
        const snd = pl?.sounds.get(sId);
        if (snd && !snd.playing) pl.playSound(snd);
      }
    } catch (e) {
      console.warn("Beneos Tutorial Tour | _applyTourAudio failed:", e);
    }
  }

  /**
   * Silence every sound on the Contacts scene so the farewell reward video
   * plays with a clean mix. Called from the fn-farewell dispatcher.
   * Iterates the scene's attached playlist at runtime (so it keeps working
   * if the GM swaps which sound is on the scene) and also covers a legacy
   * env attachment for installs that haven't been re-packed yet.
   */
  _stopFarewellMusic() {
    try {
      const scene = game.scenes.get("dWgZnsQYC2QDt7Kk");
      const pl = scene?.playlist;
      if (pl) {
        for (const snd of pl.sounds) {
          if (snd.playing) pl.stopSound(snd);
        }
      }
      const legacyPl = game.playlists.get(FAREWELL_PLAYLIST_ID);
      const legacySnd = legacyPl?.sounds.get(FAREWELL_SOUND_ID);
      if (legacySnd?.playing) legacyPl.stopSound(legacySnd);
    } catch (e) {}
  }

  /**
   * Reward cinematic at the end of the Farewell tour.
   *
   * Hiding drawings + tokens cleanly is the tricky bit. In V14, a Token's
   * actual sprite lives in `canvas.primary` via `canvas.primary.addToken(this)`
   * (token.mjs:1211) — NOT as a child of the Token placeable container.
   * Likewise, a Drawing's shape is added to `canvas.primary` (or
   * `canvas.interface`) via `targetGroup.addDrawing(this)` (drawing.mjs:245).
   * That's why setting only `placeable.renderable = false` left the visuals on
   * screen — the main sprite/shape is somewhere else entirely. Fix: also flip
   * `placeable.mesh.renderable` / `placeable.shape.renderable`.
   *
   * Also: raise `core.globalAmbientVolume` to 70% so the reward video plays
   * loud (video tiles route through the ambient channel), then restore the
   * GM's previous value when the video ends.
   *
   * Sequence:
   *   1. snapshot + hide every drawing + token (placeable AND primary child)
   *   2. save current ambient volume, raise to 70%
   *   3. bring video tile to front (via document sort — `_bringTileToFront`)
   *   4. reset HTMLVideoElement to frame 0 + play once without loop
   *   5. wait for `ended` event (setTimeout fallback)
   *   6. restore: tile sort, ambient volume, `renderable` flags
   */
  async _runFarewellVideoSequence() {
    const scene = canvas.scene;
    if (!scene || scene.id !== "dWgZnsQYC2QDt7Kk") return;
    _beneosFarewellVideoPlaying = true;
    // Snapshot entries so restoration honours prior state. Each entry records
    // up to two PIXI nodes to toggle: the placeable itself AND its primary-
    // group sprite (token.mesh or drawing.shape). Both need renderable=false.
    const hiddenObjects = [];
    const snapshotAndHide = (placeable) => {
      if (!placeable) return;
      const primaryChild = placeable.mesh ?? placeable.shape ?? null;
      hiddenObjects.push({
        obj: placeable,
        objRenderable: placeable.renderable,
        prim: primaryChild,
        primRenderable: primaryChild?.renderable
      });
      placeable.renderable = false;
      if (primaryChild) primaryChild.renderable = false;
    };
    let prevAmbientVolume = null;
    try {
      // 1. Hide drawings + tokens (placeable + primary-group sprite).
      for (const id of FAREWELL_DRAWING_IDS) snapshotAndHide(canvas.drawings?.get(id));
      for (const id of FAREWELL_TOKEN_IDS)   snapshotAndHide(canvas.tokens?.get(id));

      // 2. Ambient volume → 70% for the reward video. Video tiles route their
      // audio through the ambient channel. `inputToVolume` converts the
      // linear slider value (0-1) to the internal log-scaled volume.
      try {
        prevAmbientVolume = game.settings.get("core", "globalAmbientVolume");
        const targetVol = foundry.audio?.AudioHelper?.inputToVolume?.(0.7) ?? 0.7;
        await game.settings.set("core", "globalAmbientVolume", targetVol);
      } catch (e) { prevAmbientVolume = null; }

      // 3. Reset the HTMLVideoElement to frame 0 WHILE the tile is still
      // sorted behind everything. If we bring it forward first, the first
      // paint after the tile becomes visible shows whatever frame the video
      // was paused on — a 1-2 frame glimpse of a random still. Resetting
      // before the sort swap means the video texture carries frame 0 by
      // the time the tile enters the user's viewport.
      const tile = canvas.tiles?.get(FAREWELL_VIDEO_TILE_ID);
      const src = tile?.sourceElement
               ?? tile?.mesh?.texture?.baseTexture?.resource?.source
               ?? tile?.mesh?.texture?.source?.resource;
      if (src && typeof src.pause === "function") {
        try {
          src.pause();
          src.currentTime = 0;
          src.loop = false;
        } catch (e) { console.warn("Beneos Tutorial Tour | Farewell video reset failed:", e); }
      }
      // Give the seek one tick to commit before swapping the tile sort.
      await new Promise(r => setTimeout(r, 100));

      // 4. Bring video tile to front (DB write, but `_bringTileToFront`
      // stashes the original sort for `_restoreTiles` below).
      await this._bringTileToFront(FAREWELL_VIDEO_TILE_ID);

      // 5. Play once. Direct HTMLVideoElement control avoids persisting
      // `video.loop=true` to the tile document.
      if (src && typeof src.play === "function") {
        try {
          const p = src.play();
          if (p?.catch) p.catch(() => {});
        } catch (e) { console.warn("Beneos Tutorial Tour | Farewell video play failed:", e); }
      }

      // 6. Wait for the video's `ended` event (setTimeout fallback).
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (done) return; done = true; resolve(); };
        try { src?.addEventListener?.("ended", finish, { once: true }); } catch (e) {}
        setTimeout(finish, FAREWELL_VIDEO_MS);
      });

      try { src?.pause?.(); } catch (e) {}

      // 6a. Restore tile sort.
      await this._restoreTiles();
    } finally {
      // 6b. Restore renderable flags (placeable + primary child).
      for (const entry of hiddenObjects) {
        try {
          if (entry.obj) entry.obj.renderable = entry.objRenderable;
          if (entry.prim) entry.prim.renderable = entry.primRenderable;
        } catch (e) {}
      }
      // 6c. Restore ambient volume.
      if (prevAmbientVolume !== null) {
        try { await game.settings.set("core", "globalAmbientVolume", prevAmbientVolume); }
        catch (e) {}
      }
      // 6d. Start the post-video farewell ambient (replaces the Contacts
      //     scene's own playlist-sound which was stopped at fn-farewell).
      //     Unconditional — the tour always ends on this track.
      try {
        const ambPl = game.playlists.get(FAREWELL_POST_VIDEO_PLAYLIST_ID);
        const ambSnd = ambPl?.sounds.get(FAREWELL_POST_VIDEO_SOUND_ID);
        if (ambSnd && !ambSnd.playing) ambPl.playSound(ambSnd);
      } catch (e) {}
      _beneosFarewellVideoPlaying = false;
    }
  }

  /**
   * Render a visual-only fake context menu near a canvas point. Used to
   * demonstrate the right-click menu options without requiring real Foundry
   * note context behavior (which doesn't exist on canvas notes).
   *
   * @param {object} opts
   * @param {number} opts.canvasX  Canvas-space X coordinate (e.g. note position)
   * @param {number} opts.canvasY  Canvas-space Y coordinate
   * @param {Array<{icon?: string, label: string}>} opts.items  Menu items to render
   * @param {string} opts.id       Identifier suffix used for the DOM id
   * @param {{x: number, y: number}} [opts.offset]  Pixel offset from the canvas point
   */
  _createFakeContextMenu({ canvasX, canvasY, items, id, offset = { x: 24, y: 0 } }) {
    let screenX = 0, screenY = 0;
    try {
      const screen = canvas.stage.toGlobal({ x: canvasX, y: canvasY });
      screenX = screen.x;
      screenY = screen.y;
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to compute screen position:", e);
    }
    const menu = document.createElement("div");
    menu.id = `beneos-fake-context-menu-${id}`;
    menu.classList.add("beneos-fake-context-menu");
    Object.assign(menu.style, {
      left: `${screenX + offset.x}px`,
      top: `${screenY + offset.y}px`
    });
    const ol = document.createElement("ol");
    for (const item of items) {
      const li = document.createElement("li");
      if (item.imgIcon) {
        const img = document.createElement("img");
        img.src = item.imgIcon;
        img.style.width = "16px";
        img.style.height = "16px";
        img.style.filter = "invert(1)";
        li.appendChild(img);
      } else if (item.icon) {
        const i = document.createElement("i");
        i.className = item.icon;
        li.appendChild(i);
      }
      const span = document.createElement("span");
      span.textContent = item.label;
      li.appendChild(span);
      ol.appendChild(li);
    }
    menu.appendChild(ol);
    document.body.appendChild(menu);
    this._fakeContextMenus.push(menu);
    return menu;
  }

  /** Remove all fake context menus from the DOM */
  _clearFakeContextMenus() {
    for (const m of this._fakeContextMenus) {
      try { m.remove(); } catch (e) {}
    }
    this._fakeContextMenus = [];
  }

  /**
   * Create a "spotlight" effect: darken the whole screen EXCEPT a rectangular
   * cutout around the given element (or union of elements). Uses 4 fixed-
   * position divs that sit at the top/bottom/left/right of the cutout.
   * Works regardless of z-index / stacking contexts — perfect for highlighting
   * elements inside windows that would otherwise "poke through" Foundry's fade.
   */
  _applySpotlight(targets, padding = 6) {
    this._removeSpotlight();
    const els = Array.isArray(targets) ? targets : [targets];
    const rects = els.filter(Boolean).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    if (!rects.length) return;
    const top    = Math.floor(Math.max(0, Math.min(...rects.map(r => r.top)) - padding));
    const left   = Math.floor(Math.max(0, Math.min(...rects.map(r => r.left)) - padding));
    const bottom = Math.ceil(Math.min(window.innerHeight, Math.max(...rects.map(r => r.bottom)) + padding));
    const right  = Math.ceil(Math.min(window.innerWidth, Math.max(...rects.map(r => r.right)) + padding));

    // Single transparent cutout div with a huge box-shadow that darkens
    // EVERYTHING outside the cutout rect. No overlapping strips → no visible
    // border lines from doubled-up transparency.
    const cutout = document.createElement("div");
    cutout.classList.add("beneos-spotlight-piece");
    Object.assign(cutout.style, {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
      pointerEvents: "none",
      // Above Foundry app windows; tour tooltip is at 999999 via CSS
      zIndex: "999998",
      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.75)"
    });
    document.body.appendChild(cutout);
    this._spotlight = [cutout];
  }

  /** Remove the spotlight overlay pieces */
  _removeSpotlight() {
    (this._spotlight || []).forEach(d => { try { d.remove(); } catch (e) {} });
    this._spotlight = null;
  }

  /**
   * Ensure a token is recognised as a Beneos creature so the Token HUD adds
   * the journal + skin icons. Sets `flags.world.beneos` on the actor and
   * populates `BeneosUtility.beneosTokens` with a minimal config.
   * Tracks whether we injected the flag so cleanup can remove it.
   */
  async _ensureBeneosFlag(actor, { journalId = null } = {}) {
    if (!actor) return;
    const existing = actor.getFlag("world", "beneos");
    if (existing) return;
    this._injectedBeneosFlag = { actorId: actor.id };
    await actor.setFlag("world", "beneos", {
      fullId: "tutorial_rot_cerf",
      journalId: journalId
    });
    try {
      const BU = window.BeneosUtility ?? globalThis.BeneosUtility ?? game.beneos?.utility;
      if (BU?.beneosTokens) {
        BU.beneosTokens["tutorial_rot_cerf"] = {
          actorName: actor.name,
          actorId: actor.id,
          journalId: journalId,
          fullId: "tutorial_rot_cerf",
          fullKey: "tutorial_rot_cerf",
          number: 1,
          tokenKey: "rot_cerf",
          token: actor.prototypeToken?.texture?.src
        };
      }
    } catch (e) {}
  }

  /** Restore the state we changed in _ensureBeneosFlag */
  async _restoreBeneosFlag() {
    if (!this._injectedBeneosFlag) return;
    try {
      const actor = game.actors.get(this._injectedBeneosFlag.actorId);
      if (actor) await actor.unsetFlag("world", "beneos");
    } catch (e) {}
    try {
      const BU = window.BeneosUtility ?? globalThis.BeneosUtility ?? game.beneos?.utility;
      if (BU?.beneosTokens) delete BU.beneosTokens["tutorial_rot_cerf"];
    } catch (e) {}
    this._injectedBeneosFlag = null;
  }

  /* ---- Selector helpers (identical to existing tours) ---- */

  _safeguardSelector() {
    const step = this.steps[this.stepIndex];
    if (step.selector && !document.querySelector(step.selector)) {
      step.selector = "";
    }
  }

  _trySelector(selector) {
    if (document.querySelector(selector)) {
      this.steps[this.stepIndex].selector = selector;
      return true;
    }
    return false;
  }

  /* ---- Tour Lifecycle ---- */

  async start() {
    document.body.classList.add("tour-active");
    if (this.noFade) document.body.classList.add("beneos-no-fade");
    cleanupTourElements();
    _installTourTooltipGuard(this);
    await this._ensureUnpaused();
    // On every auto-starting scene tour (Welcome + page tours), enforce the
    // baseline audio floors so the ambient + music playlists are actually
    // audible during the tutorial. Module-started tours (Setup) extend
    // TourBase directly and opt out of this.
    await this._ensureMinAudioVolume();
    // For the Overview tour, ensure the demo-state (hidden pins + placeholder
    // tiles) is active. This is a backup for when the tour is triggered
    // manually and the canvasReady hook pre-hide didn't fire.
    if (this.id === "tutorial-page-1-overview") {
      if (game.user.isGM) await game.settings.set("core", "notesDisplayToggle", false);
      await this._hidePlaceholderTiles(OVERVIEW_PLACEHOLDER_TILE_IDS);
    }
    // Scenery tour: hide the pause-symbol drawings at start; revealed only
    // during sc-static-freeze and re-hidden on leave. Snapshot for restore.
    // Also explicitly start the animated scenery tile so steps 1–5 show a
    // living map — sc-static-freeze pauses it, sc-next-intro's postStep
    // resumes. The tile's own autoplay is off so we can own the pause state.
    if (this.id === "tutorial-page-3-sceneries") {
      this._sceneryPauseDrawingSnapshot = this._setDrawingsRenderable(SCENERY_PAUSE_DRAWING_IDS, false);
      await this._playTileVideo("N6UT2wnPEllLG2fa", true);
    }
    // Scenery + World Map: ensure journal icons are visible (may be off if
    // the user aborted a previous tour before pins were re-enabled)
    if (this.id === "tutorial-page-3-sceneries" || this.id === "tutorial-page-5-world-map") {
      if (game.user.isGM) await game.settings.set("core", "notesDisplayToggle", true);
    }
    // Battlemap: journal pins stay active throughout this tour. The scene may
    // load with the display toggle off if a previous tour aborted before
    // re-enabling it — force it back on and snap the notes layer visible so
    // there's no flicker into step 1.
    if (this.id === "tutorial-page-2-battlemaps") {
      if (game.user.isGM) await game.settings.set("core", "notesDisplayToggle", true);
      if (canvas.notes?.objects) {
        canvas.notes.objects.visible = true;
        canvas.notes.objects.renderable = true;
      }
    }
    // World Map tour: push arrow indicator tiles to the back so they are
    // invisible until explicitly brought to front in their respective steps.
    if (this.id === "tutorial-page-5-world-map") {
      this._wmOriginalSorts = [];
      for (const id of WORLD_MAP_ARROW_TILE_IDS) {
        try {
          const tile = canvas.tiles?.get(id);
          if (tile) {
            this._wmOriginalSorts.push({ id, sort: tile.document.sort });
            await tile.document.update({ sort: -99999 });
          }
        } catch (e) {}
      }
    }
    // Loot tour: push arrow indicator tiles to the back, same pattern.
    if (this.id === "tutorial-page-7-loot") {
      this._lootOriginalSorts = [];
      for (const id of LOOT_ARROW_TILE_IDS) {
        try {
          const tile = canvas.tiles?.get(id);
          if (tile) {
            this._lootOriginalSorts.push({ id, sort: tile.document.sort });
            await tile.document.update({ sort: -99999 });
          }
        } catch (e) {}
      }
    }
    // Intro tour: hide the two manual-start explainer tiles; they're only
    // revealed during the intro-right-click-tile step and re-hidden after.
    if (this.id === "tutorial-page-4-intro") {
      this._introManualTileSnapshot = this._setTilesRenderable(INTRO_MANUAL_TILE_IDS, false);
    }
    // Creatures tour: blank slate — remove any leftover Rot Cerf tokens from previous runs
    if (this.id === "tutorial-page-6-creatures") {
      try {
        const stale = canvas.tokens?.placeables.filter(t => t.actor?.name?.toLowerCase().includes("rot cerf"));
        if (stale?.length) await canvas.scene.deleteEmbeddedDocuments("Token", stale.map(t => t.id));
      } catch (e) {}
    }
    // Apply this tour's Music + Environment, stopping any managed sound
    // from a previous tour that doesn't belong here.
    this._applyTourAudio();
    // Pin the Interface (click/feedback SFX) volume to 50 % so tour clicks
    // land at the intended level regardless of the GM's personal setting.
    this._setInterfaceVolume(0.5);
    const result = await super.start();
    // Play the opening SFX once the first step has been rendered
    this._playSound("beneos_start.ogg");
    return result;
  }

  exit() {
    this._stopCountdown();
    this._stopBorderPulse();
    this._keepNotesHiddenPersistent = false;
    if (this._notesHideInterval) {
      clearInterval(this._notesHideInterval);
      this._notesHideInterval = null;
      if (canvas.notes?.objects) canvas.notes.objects.renderable = true;
    }
    if (this._highlightedChatMsg) {
      this._highlightedChatMsg.classList.remove("beneos-chat-highlight");
      this._highlightedChatMsg = null;
    }
    this._restoreTokenState();
    this._clearMarkers();
    this._clearScreenMarkers();
    this._clearFakeContextMenus();
    this._closeOpenedJournals();
    this._restoreTiles();
    this._unfreezeSceneVideos();
    // World Map: leave the scene tidy — push ALL arrow tiles back to the
    // background regardless of their pre-tour sort, mirroring the Loot
    // tour pattern. A subsequent tour run starts fresh.
    if (this.id === "tutorial-page-5-world-map") {
      for (const id of WORLD_MAP_ARROW_TILE_IDS) {
        try { canvas.tiles?.get(id)?.document.update({ sort: -99999 }); } catch (e) {}
      }
      this._wmOriginalSorts = [];
    }
    // Loot tour: leave a clean canvas — push ALL arrow tiles back to the
    // background (sort = -99999) regardless of their pre-tour sort. The saved
    // originals are dropped intentionally per user request: tiles should stay
    // hidden so a subsequent tour run starts fresh.
    if (this.id === "tutorial-page-7-loot") {
      for (const id of LOOT_ARROW_TILE_IDS) {
        try { canvas.tiles?.get(id)?.document.update({ sort: -99999 }); } catch (e) {}
      }
      this._lootOriginalSorts = [];
      try { game.items.get("6QYFmLk3ne0HNXZA")?.sheet?.close(); } catch (e) {}
    }
    // Spells tour: close the demo spell sheet opened by sp-foundry-view
    if (this.id === "tutorial-page-8-spells") {
      try { game.items.get("2iY3M4R5kl1aFPub")?.sheet?.close(); } catch (e) {}
    }
    // Stop any video tile we may have started, restore swapped textures.
    if (this.id === "tutorial-page-4-intro") {
      this._playTileVideo("4sIUsXFBVfEEmgsc", false);
      // Restore the manual-start explainer tiles to their pre-tour renderable
      // state so a mid-tour exit doesn't leave them invisible on the scene.
      if (this._introManualTileSnapshot?.length) {
        for (const snap of this._introManualTileSnapshot) {
          const t = canvas.tiles?.get(snap.id);
          if (!t) continue;
          try {
            t.renderable = snap.obj;
            if (t.mesh) t.mesh.renderable = snap.mesh;
          } catch (e) {}
        }
        this._introManualTileSnapshot = null;
      }
    }
    // Scenery tour: restore pause-symbol drawings to their pre-tour state
    // (default = visible) so a mid-tour exit leaves the scene as we found it.
    if (this.id === "tutorial-page-3-sceneries" && this._sceneryPauseDrawingSnapshot?.length) {
      for (const snap of this._sceneryPauseDrawingSnapshot) {
        const dw = canvas.drawings?.get(snap.id);
        if (!dw) continue;
        try {
          dw.renderable = snap.obj;
          if (dw.shape) dw.shape.renderable = snap.shape;
        } catch (e) {}
      }
      this._sceneryPauseDrawingSnapshot = null;
    }
    this._restoreTileTextures();
    // Close settings window if it was opened by bm-pause-mlt step
    try { game.settings.sheet?.close(); } catch (e) {}
    // Close Beneos Cloud window if still open
    try {
      const cloudEl = document.querySelector(".beneos_search_engine")?.closest(".app");
      if (cloudEl) { const app = Object.values(ui.windows).find(w => w.element?.[0] === cloudEl); if (app) app.close(); else cloudEl.remove(); }
    } catch (e) {}
    // Creatures tour: remove placed Rot Cerf tokens + close actor sheet + restore texture + close image popout + reset position
    if (this.id === "tutorial-page-6-creatures") {
      try { this._imagePopout?.close(); this._imagePopout = null; } catch (e) {}
      try {
        const token = canvas.tokens?.placeables.find(t => t.actor?.name?.toLowerCase().includes("rot cerf"));
        if (token && this._savedRotCerfPos) {
          token.document.update(this._savedRotCerfPos);
          this._savedRotCerfPos = null;
        }
        if (token && this._savedRotCerfTexture) {
          token.document.update({ "texture.src": this._savedRotCerfTexture });
          this._savedRotCerfTexture = null;
        }
        const tokens = canvas.tokens?.placeables.filter(t => t.actor?.name?.toLowerCase().includes("rot cerf"));
        if (tokens?.length) canvas.scene.deleteEmbeddedDocuments("Token", tokens.map(t => t.id));
      } catch (e) {}
      try {
        const actor = game.actors.get("q5thcJTwfi7uHZLA") ?? game.actors.find(a => a.name.toLowerCase().includes("rot cerf"));
        if (actor?.sheet?.rendered) actor.sheet.close();
      } catch (e) {}
      this._restoreBeneosFlag();
    }
    // Dismiss any context menu left by sc-static-maps step
    try { document.querySelector('#context-menu')?.remove(); } catch (e) {}
    // Restore the demo-state modifications so the user isn't stuck with
    // hidden pins or invisible placeholder tiles after a mid-tour exit.
    if (game.user.isGM) game.settings.set("core", "notesDisplayToggle", true);
    if (this.id === "tutorial-page-1-overview") {
      this._showPlaceholderTiles(OVERVIEW_PLACEHOLDER_TILE_IDS);
    }
    this._removeSpotlight();
    document.body.classList.remove("beneos-no-fade");
    // Stop every tour-managed sound. Without this, manually aborting a tour
    // (X-button, Esc, or navigating to a non-tutorial scene) leaves the
    // Foundry-global tour playlist running. It then "follows" the GM onto
    // unrelated scenes (e.g. other Moulinette packs), overriding the scene's
    // own ambient sound. A later tour entry restarts what it needs via
    // _applyTourAudio(), so stopping here is always safe.
    stopAllManagedTourAudio();
    _restoreTourTooltipGuard(this);
    tourCleanup(this);
    return super.exit();
  }

  async complete() {
    // Fires when the user clicks Next on the LAST step. Play a short
    // transition SFX to bridge the loading gap to the next tutorial scene
    // (and to signal "done!" on terminal tours). The per-step arrival sound
    // (beneos_end.ogg on last step) still plays separately when that step
    // rendered — this is in addition, on the Next-click.
    this._playSound("beneos_transition.ogg");
    this._stopCountdown();
    this._stopBorderPulse();
    this._keepNotesHiddenPersistent = false;
    if (this._notesHideInterval) {
      clearInterval(this._notesHideInterval);
      this._notesHideInterval = null;
      if (canvas.notes?.objects) canvas.notes.objects.renderable = true;
    }
    if (this._highlightedChatMsg) {
      this._highlightedChatMsg.classList.remove("beneos-chat-highlight");
      this._highlightedChatMsg = null;
    }
    await this._restoreTokenState();
    this._clearMarkers();
    this._clearScreenMarkers();
    this._clearFakeContextMenus();
    await this._closeOpenedJournals();
    await this._restoreTiles();
    this._unfreezeSceneVideos();
    // World Map: leave the scene tidy — push ALL arrow tiles back to the
    // background, same treatment as the Loot tour.
    if (this.id === "tutorial-page-5-world-map") {
      for (const id of WORLD_MAP_ARROW_TILE_IDS) {
        try { const tile = canvas.tiles?.get(id); if (tile) await tile.document.update({ sort: -99999 }); } catch (e) {}
      }
      this._wmOriginalSorts = [];
    }
    // Loot tour: leave a clean canvas — push ALL arrow tiles back to background
    if (this.id === "tutorial-page-7-loot") {
      for (const id of LOOT_ARROW_TILE_IDS) {
        try { const tile = canvas.tiles?.get(id); if (tile) await tile.document.update({ sort: -99999 }); } catch (e) {}
      }
      this._lootOriginalSorts = [];
      try { game.items.get("6QYFmLk3ne0HNXZA")?.sheet?.close(); } catch (e) {}
    }
    if (this.id === "tutorial-page-8-spells") {
      try { game.items.get("2iY3M4R5kl1aFPub")?.sheet?.close(); } catch (e) {}
    }
    // Stop any video tile we may have started, restore swapped textures.
    if (this.id === "tutorial-page-4-intro") {
      await this._playTileVideo("4sIUsXFBVfEEmgsc", false);
      // Restore the manual-start explainer tiles to their pre-tour renderable
      // state so tour completion leaves the scene as we found it.
      if (this._introManualTileSnapshot?.length) {
        for (const snap of this._introManualTileSnapshot) {
          const t = canvas.tiles?.get(snap.id);
          if (!t) continue;
          try {
            t.renderable = snap.obj;
            if (t.mesh) t.mesh.renderable = snap.mesh;
          } catch (e) {}
        }
        this._introManualTileSnapshot = null;
      }
    }
    // Scenery tour: restore pause-symbol drawings to their pre-tour state.
    if (this.id === "tutorial-page-3-sceneries" && this._sceneryPauseDrawingSnapshot?.length) {
      for (const snap of this._sceneryPauseDrawingSnapshot) {
        const dw = canvas.drawings?.get(snap.id);
        if (!dw) continue;
        try {
          dw.renderable = snap.obj;
          if (dw.shape) dw.shape.renderable = snap.shape;
        } catch (e) {}
      }
      this._sceneryPauseDrawingSnapshot = null;
    }
    await this._restoreTileTextures();
    // Close settings window if it was opened by bm-pause-mlt step
    try { game.settings.sheet?.close(); } catch (e) {}
    // Close Beneos Cloud window if still open
    try {
      const cloudEl = document.querySelector(".beneos_search_engine")?.closest(".app");
      if (cloudEl) { const app = Object.values(ui.windows).find(w => w.element?.[0] === cloudEl); if (app) app.close(); else cloudEl.remove(); }
    } catch (e) {}
    // Creatures tour: remove placed Rot Cerf tokens + close actor sheet
    if (this.id === "tutorial-page-6-creatures") {
      try {
        const tokens = canvas.tokens?.placeables.filter(t => t.actor?.name?.toLowerCase().includes("rot cerf"));
        if (tokens?.length) await canvas.scene.deleteEmbeddedDocuments("Token", tokens.map(t => t.id));
      } catch (e) {}
      try {
        const actor = game.actors.get("q5thcJTwfi7uHZLA") ?? game.actors.find(a => a.name.toLowerCase().includes("rot cerf"));
        if (actor?.sheet?.rendered) actor.sheet.close();
      } catch (e) {}
    }
    // Dismiss any context menu left by sc-static-maps step
    try { document.querySelector('#context-menu')?.remove(); } catch (e) {}
    // Ensure demo-state modifications are reverted when the tour completes
    if (game.user.isGM) await game.settings.set("core", "notesDisplayToggle", true);
    if (this.id === "tutorial-page-1-overview") {
      await this._showPlaceholderTiles(OVERVIEW_PLACEHOLDER_TILE_IDS);
    }
    this._removeSpotlight();
    document.body.classList.remove("beneos-no-fade");
    _restoreTourTooltipGuard(this);
    tourCleanup(this);
    await super.complete();
    // Auto-navigate to the next tutorial scene if configured.
    // Uses activate() so the ambient playlist of the next scene starts playing.
    // The new scene's canvasReady hook will then auto-start its own tour.
    if (this.nextSceneId) {
      const next = game.scenes.get(this.nextSceneId);
      if (next) setTimeout(() => (next.activate ? next.activate() : next.view()), 400);
    }
    // Farewell tour: play the closing reward cinematic after the tour UI is
    // gone. Fire-and-forget — the user watches the video on an empty scene.
    if (this.id === "tutorial-page-9-contacts") {
      this._runFarewellVideoSequence().catch(e =>
        console.warn("Beneos Tutorial Tour | Farewell video sequence failed:", e));
    }
  }

  async _postStep() {
    cleanupTourElements();
    this._stopCountdown();
    this._stopBorderPulse();
    // Restore tooltip deactivation that was blocked in _renderStep
    // (dismissLockedTooltips stays stubbed tour-wide — restored in exit/complete)
    if (this._origDeactivate) {
      game.tooltip.deactivate = this._origDeactivate;
      this._origDeactivate = null;
    }
    this._clearMarkers();
    this._clearScreenMarkers();
    this._clearFakeContextMenus();
    // Restore any tiles temporarily raised by the step we are leaving — UNLESS
    // the step is in KEEP_TILES_FOREGROUNDED_AFTER (then the next step will
    // reuse the same tiles and we don't want a flicker).
    const leavingStepId = this.currentStep?.id;
    if (!KEEP_TILES_FOREGROUNDED_AFTER.has(leavingStepId)) {
      await this._restoreTiles();
    }
    // Resume any videos we paused for the sc-static-freeze "static map" demo,
    // and re-hide the pause-symbol drawings so they vanish with the next step.
    if (leavingStepId === "sc-static-freeze") {
      this._unfreezeSceneVideos();
      this._setDrawingsRenderable(SCENERY_PAUSE_DRAWING_IDS, false);
    }
    // Intro tour: re-hide the two manual-start explainer tiles after the user
    // leaves intro-right-click-tile (both forward and backward navigation).
    if (leavingStepId === "intro-right-click-tile") {
      this._setTilesRenderable(INTRO_MANUAL_TILE_IDS, false);
    }
    // Close any journals opened during the step we are leaving so they don't
    // overlap subsequent steps. Exception: KEEP_JOURNAL_OPEN_AFTER steps keep
    // the journal open so the next step can reuse the sheet without flicker.
    if (!KEEP_JOURNAL_OPEN_AFTER.has(leavingStepId)) {
      await this._closeOpenedJournals();
    }
    // Remove the no-fade class IF it was a per-step add (tour-wide stays through transitions)
    if (!this.noFade) document.body.classList.remove("beneos-no-fade");
    try { game.tooltip.deactivate(); } catch(e) {}
    // Remove extra highlights
    document.querySelectorAll(".beneos-tour-marker").forEach(el => el.remove());
    document.querySelectorAll(".beneos-screen-marker").forEach(el => el.remove());
    // Remove manual tour-highlight class from the Journal scene-control button
    // (added in p1-pin-activate to emphasise which main button to press first)
    document.querySelector('button[data-control="notes"]')?.classList.remove("tour-highlight");
    document.querySelector('button[data-control="tokens"]')?.classList.remove("tour-highlight");
    document.querySelector('button[data-control="tiles"]')?.classList.remove("tour-highlight");
    // Remove filter / result highlights from the Beneos Cloud (Page 6 creatures tour)
    document.querySelectorAll(".beneos-filter-highlight").forEach(el => el.classList.remove("beneos-filter-highlight"));
    // Collapse any expanded select dropdowns back to their default size
    document.querySelectorAll(".beneos_search_engine select").forEach(s => { s.size = 1; });
    // Remove injected fake Beneos HUD icons from previous steps
    document.querySelectorAll(".beneos-tour-fake-journal, .beneos-tour-fake-skin").forEach(el => el.remove());
    // Remove spotlight overlay if active
    this._removeSpotlight();
    // Close the tile HUD if it was opened by intro-right-click-tile
    try { canvas.hud?.tile?.close?.(); } catch(e) {}
    // Close the Token HUD if it was opened by ct-context-menu
    try { canvas.hud?.token?.close?.(); } catch(e) {}
    // Stop the notes-hide watchdog if it is running (from p1-pin-activate).
    // Persistent mode (Battlemap) skips this teardown — cleared explicitly
    // in bm-region-world / exit / complete.
    if (this._notesHideInterval && !this._keepNotesHiddenPersistent) {
      clearInterval(this._notesHideInterval);
      this._notesHideInterval = null;
      if (canvas.notes?.objects) canvas.notes.objects.renderable = true;
    }
    // Clear any highlighted chat message
    if (this._highlightedChatMsg) {
      this._highlightedChatMsg.classList.remove("beneos-chat-highlight");
      this._highlightedChatMsg = null;
    }
    await super._postStep();
    // Aggressive cleanup AFTER Foundry's _postStep: ensure the tooltip popover
    // and any locked clones are fully gone before the next step renders.
    // (Fixes a bug where Step N+1 appears alongside Step N because the popover
    // transition didn't finish before the next render.)
    try {
      const tt = document.getElementById("tooltip");
      if (tt) {
        tt.classList.remove("active");
        if (tt.matches?.(":popover-open")) tt.hidePopover();
      }
      document.querySelectorAll(".locked-tooltip").forEach(el => el.remove());
      document.querySelectorAll(".tour-center-step").forEach(el => el.remove());
    } catch(e) {}
  }

  async _renderStep() {
    await super._renderStep();
    // Block Foundry's tooltip manager from dismissing our tour tooltip when
    // the user interacts with the canvas, hovers highlighted elements, or
    // triggers any other event that calls game.tooltip.deactivate().
    // Note: dismissLockedTooltips is already stubbed tour-wide via
    // _installTourTooltipGuard() in start(); no per-step override needed.
    if (this.currentStep.selector) {
      this._origDeactivate = game.tooltip.deactivate.bind(game.tooltip);
      game.tooltip.deactivate = () => {};
    }
    // Step-transition sound priority:
    //   1. NEXT_SOUND_OVERRIDES entry → wins (even on the last step).
    //      Dispatcher must call _panTo({ sound: false }) to avoid swoosh stacking.
    //   2. _panTo already played a swoosh → silent (swoosh IS the transition sound).
    //   3. Last step → end sound.
    //   4. Default → page-turn switch.
    {
      const stepId = this.currentStep.id;
      if (stepId in NEXT_SOUND_OVERRIDES) {
        const override = NEXT_SOUND_OVERRIDES[stepId];
        if (override) this._playSound(override);
      } else if (this._swooshThisStep) {
        // Swoosh already played — that's the transition feedback
      } else if (this.stepIndex === this.steps.length - 1) {
        this._playSound("beneos_end.ogg");
      } else {
        this._playSound("beneos_switch.ogg");
      }
    }
    // Start the JS-driven box-shadow pulse on the freshly rendered tour box.
    this._startBorderPulse();
    // End-of-tour auto-advance countdown. On every non-terminal tour's last
    // step, drop a "Next scene in N…" footer into the tour tooltip and kick
    // off `_startCountdown`. `_postStep` already clears the timer on
    // forward/backward navigation, so no extra teardown is needed.
    // Skip start-here's last step (start-continue) — it runs its own
    // countdown from the dispatcher (duration 5 s there, don't double-fire).
    if (this.stepIndex === this.steps.length - 1
        && this.nextSceneId
        && this.currentStep.id !== "start-continue") {
      // Inject the countdown just before the tour's footer so it always
      // sits AFTER every body paragraph. Foundry's template renders each
      // paragraph as its own `<p class="content">` sibling (tour-step.html),
      // so we target the tour ROOT and insertBefore the footer rather than
      // appending to `.content` (which would land inside paragraph 1 and
      // push it above later paragraphs).
      //
      // Retry up to ~1 s because some center-mode steps (e.g. intro-complete)
      // have late Foundry re-renders that can clobber a one-shot injection.
      const inject = () => {
        const roots = document.querySelectorAll("#tooltip.tour, .tour-center-step");
        if (!roots.length) return false;
        let injected = false;
        for (const root of roots) {
          if (root.querySelector("#beneos-countdown")) { injected = true; continue; }
          const box = document.createElement("p");
          box.className = "beneos-countdown-box";
          box.innerHTML = game.i18n.localize("BENEOS.Tour.Common.ContinuesIn");
          const footer = root.querySelector("footer.step-controls, footer");
          if (footer?.parentNode) footer.parentNode.insertBefore(box, footer);
          else root.appendChild(box);
          injected = true;
        }
        return injected;
      };
      const tries = [80, 200, 400, 700, 1100];
      for (const delay of tries) {
        setTimeout(() => {
          try { inject(); } catch (e) {
            console.warn("Beneos Tutorial Tour | End-of-tour countdown inject failed:", e);
          }
        }, delay);
      }
      this._startCountdown(10);
    }
    // Strip "of Y" from the step counter — second pass via setTimeout catches
    // any late re-renders by Foundry's tour template.
    _hideTourStepOfY();
    setTimeout(_hideTourStepOfY, 50);
  }

  /* ---- Step Logic ---- */

  async _preStep() {
    // See BeneosSetupTour._preStep — same orphan-tooltip guardrail applies
    // to the per-scene tutorial tours.
    clearStaleTourTooltips();
    cleanupTourElements();
    await super._preStep();
    this._swooshThisStep = false; // Reset before step logic; _panTo sets it
    // Always ensure the game isn't paused at the start of each step
    await this._ensureUnpaused();
    // Re-apply tour-wide no-fade class at the start of every step so
    // individual dispatcher cases can opt OUT (remove it) and subsequent
    // steps still get the tour-wide behaviour. Also protects against
    // previous() navigation back into a no-fade step.
    if (this.noFade) document.body.classList.add("beneos-no-fade");
    const stepId = this.currentStep.id;

    // ===== Tour: tutorial-start-here =====

    if (stepId === "start-welcome") {
      // Place the tooltip near a specific spot on the canvas
      // (no-fade is handled tour-wide via noFade: true on the tour config)
      const coords = { x: 2161, y: 988, w: 602, h: 325 };
      this._createCanvasMarker({ ...coords, id: "start-welcome" });
      this._trySelector("#beneos-tour-marker-start-welcome");
      // Start the 10-second countdown that auto-advances the tour
      this._startCountdown(10);
    }

    if (stepId === "start-explainer") {
      // Safety-net: re-enforce this tour's audio loadout after the countdown intro.
      this._applyTourAudio();
    }

    if (stepId === "start-battlemaps-info") {
      // Reveal the hidden arrow tile
      await this._bringTileToFront("izlqiHpbKHz1n8OK");
      // Invisible anchor box — tooltip docks to its LEFT edge.
      const coords = { x: 1600, y: 1388, w: 800, h: 757 };
      this._createCanvasMarker({ ...coords, id: "start-battlemaps-info" });
      this._trySelector("#beneos-tour-marker-start-battlemaps-info");
    }

    if (stepId === "start-tokens-info") {
      // Reveal the second arrow tile (Tokens, Spells & Items area)
      await this._bringTileToFront("Hd8muyJFpuhhEmRk");
      // Invisible anchor box — tooltip docks to its RIGHT edge.
      const coords = { x: 3650, y: 1400, w: 800, h: 757 };
      this._createCanvasMarker({ ...coords, id: "start-tokens-info" });
      this._trySelector("#beneos-tour-marker-start-tokens-info");
    }

    if (stepId === "start-continue") {
      // Darken the background for the final prompt so the user's attention
      // focuses on the closing message (opt out of tour-wide noFade)
      document.body.classList.remove("beneos-no-fade");
      // 5-second countdown before auto-navigating to the Battlemaps scene.
      // next() on the last step calls complete() which triggers nextSceneId.
      this._startCountdown(5);
    }

    // ===== Tour: tutorial-page-1-overview =====

    if (stepId === "p1-welcome") {
      // No fade so the user can see the scene behind the box
      document.body.classList.add("beneos-no-fade");
      // Reset the camera to the scene's default view so the user sees the
      // full overview (not zoomed in from a previous tour or stale state).
      // Uses canvas.animatePan directly (not _panTo) to skip the swoosh SFX —
      // this is the initial orientation, nothing to swoosh away from.
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await canvas.animatePan({
            x: initial.x, y: initial.y, scale: initial.scale, duration: 600
          });
        } else if (canvas.dimensions) {
          // Fallback: fit the whole scene extent into the viewport
          const d = canvas.dimensions;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const scale = Math.min(vw / d.sceneWidth, vh / d.sceneHeight) * 0.85;
          await canvas.animatePan({
            x: d.sceneX + d.sceneWidth / 2,
            y: d.sceneY + d.sceneHeight / 2,
            scale,
            duration: 600
          });
        }
      } catch (e) {
        console.warn("Beneos Tutorial Tour | Failed to reset canvas view:", e);
      }
      // Canvas marker at the user-specified overview position. Tooltip docks
      // to the LEFT of this invisible box (vertically centred).
      const coords = { x: 3502, y: 704, w: 875, h: 563 };
      this._createCanvasMarker({ ...coords, id: "p1-welcome" });
      this._trySelector("#beneos-tour-marker-p1-welcome");
      // The demo-effect hiding (notes + placeholder tiles) happens earlier in
      // canvasReady + start() so the user never briefly sees the icons.
    }

    if (stepId === "p1-pin-notice") {
      // Navbar IS the tour target — Foundry creates a clean fadeout cutout
      // around the target automatically, so we get a real "exposed" area
      // without any backdrop-filter tricks. The tooltip docks above it via
      // tooltipDirection: "UP". No pan, no zoom.
      const coords = { x: 1241, y: 2754, w: 2188, h: 323 };
      this._createCanvasMarker({ ...coords, id: "p1-pin-notice" });
      this._trySelector("#beneos-tour-marker-p1-pin-notice");
    }

    if (stepId === "p1-pin-activate") {
      // Highlight the Journal tool button so the user SEES where pins live,
      // but do NOT click it — clicking triggers `NotesLayer._activate` which
      // synchronously flips `objects.visible = true` and PIXI paints a
      // one-frame flash of every pin before our watchdog can override it.
      // Instead we keep pins invisible through this step; activation
      // happens cleanly in p1-pin-activated's preStep via the
      // `notesDisplayToggle` setting change.
      const notesBtn = document.querySelector('button[data-control="notes"]');
      if (notesBtn) notesBtn.classList.add("tour-highlight");
      this._trySelector('button[data-control="notes"]');
    }

    if (stepId === "p1-pin-activated") {
      // Activation moment: enable notesDisplayToggle and reveal all placeholder
      // tiles in one go so the user sees the journal icons appear as they read
      // the confirmation box. The click SFX is triggered by next()/previous()
      // via the NEXT_SOUND_OVERRIDES map.
      if (game.user.isGM) await game.settings.set("core", "notesDisplayToggle", true);
      await this._showPlaceholderTiles(OVERVIEW_PLACEHOLDER_TILE_IDS);
      // Same tour target as p1-pin-notice — the navbar itself. Foundry's
      // fadeout creates a clean cutout, and the tooltip docks above it.
      const coords = { x: 1241, y: 2754, w: 2188, h: 323 };
      this._createCanvasMarker({ ...coords, id: "p1-pin-activated" });
      this._trySelector("#beneos-tour-marker-p1-pin-activated");
    }

    if (stepId === "p1-teleporters") {
      // Highlight the teleporter (journal note) for the Oracle battlemap
      const coords = { x: 1395, y: 1501, w: 456, h: 298 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.8 });
      this._createCanvasMarker({ ...coords, id: "p1-teleporters", highlight: true });
      this._trySelector("#beneos-tour-marker-p1-teleporters");
    }

    if (stepId === "p1-navbar-intro") {
      // The full navigation bar below the map area
      const coords = { x: 928, y: 2739, w: 3881, h: 488 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.4 });
      this._createCanvasMarker({ ...coords, id: "p1-navbar", highlight: true });
      this._trySelector("#beneos-tour-marker-p1-navbar");
    }

    if (stepId === "p1-intro-icon") {
      // Film clapperboard icon → Intro Sequence
      const coords = { x: 1255, y: 2780, w: 529, h: 440 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.6 });
      this._createCanvasMarker({ ...coords, id: "p1-intro-icon", highlight: true });
      this._trySelector("#beneos-tour-marker-p1-intro-icon");
    }

    if (stepId === "p1-regional") {
      // Region / World Map buttons
      const coords = { x: 1874, y: 2780, w: 981, h: 494 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.55 });
      this._createCanvasMarker({ ...coords, id: "p1-regional", highlight: true });
      this._trySelector("#beneos-tour-marker-p1-regional");
    }

    if (stepId === "p1-lore") {
      // Step A: highlight ONLY the lore icon. The journal opens in p1-lore-journal.
      const coords = { x: 3055, y: 2785, w: 327, h: 476 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.6 });
      this._createCanvasMarker({ ...coords, id: "p1-lore", highlight: true });
      this._trySelector("#beneos-tour-marker-p1-lore");
    }

    if (stepId === "p1-lore-journal") {
      // Step B: open the Ashur Fire Temple lore journal. Anchor the tour
      // tooltip to a SCREEN MARKER positioned over the rendered sheet, NOT
      // to the sheet element itself — anchoring to the sheet causes the
      // tooltip to dismiss when the user hovers off the sheet (Foundry's
      // TooltipManager#onDeactivate fires on pointerleave even during a tour).
      const sheet = await this._openJournal("DgMTZF8iucXbDp5h");
      await new Promise(r => setTimeout(r, 700));
      const el = sheet?.element;
      const sheetEl = el?.getBoundingClientRect ? el : el?.[0];
      if (sheetEl?.getBoundingClientRect) {
        const rect = sheetEl.getBoundingClientRect();
        this._createScreenMarker({
          x: rect.left, y: rect.top, w: rect.width, h: rect.height,
          id: "p1-lore-journal-anchor"
        });
        this._trySelector("#beneos-screen-marker-p1-lore-journal-anchor");
      }
    }

    if (stepId === "p1-help") {
      // Step A: highlight ONLY the help icon. The journal opens in p1-help-journal.
      const coords = { x: 4303, y: 2817, w: 190, h: 251 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.7 });
      this._createCanvasMarker({ ...coords, id: "p1-help", highlight: true });
      this._trySelector("#beneos-tour-marker-p1-help");
    }

    if (stepId === "p1-help-journal") {
      // Step B: open the Beneos documentation journal. Same screen-marker
      // approach as p1-lore-journal — prevents the tooltip from dismissing
      // when the user accidentally hovers over the open journal.
      // German users get the German documentation journal; all other
      // locales share the English one (no other translations exist).
      const journalId = game.i18n.lang === "de" ? "Q2wVmtfGoydDgvom" : "Q5xvdypjD1tGOro5";
      const sheet = await this._openJournal(journalId);
      await new Promise(r => setTimeout(r, 700));
      const el = sheet?.element;
      const sheetEl = el?.getBoundingClientRect ? el : el?.[0];
      if (sheetEl?.getBoundingClientRect) {
        const rect = sheetEl.getBoundingClientRect();
        this._createScreenMarker({
          x: rect.left, y: rect.top, w: rect.width, h: rect.height,
          id: "p1-help-journal-anchor"
        });
        this._trySelector("#beneos-screen-marker-p1-help-journal-anchor");
      }
    }

    if (stepId === "p1-compass") {
      // Compass icon at the bottom-right of the navbar
      const coords = { x: 4487, y: 2763, w: 302, h: 329 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.65 });
      this._createCanvasMarker({ ...coords, id: "p1-compass", highlight: true });
      this._trySelector("#beneos-tour-marker-p1-compass");
    }

    if (stepId === "p1-summary") {
      // Zoom back out so the full overview is visible for the summary message
      document.body.classList.add("beneos-no-fade");
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 700 });
        } else if (canvas.dimensions) {
          const d = canvas.dimensions;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const scale = Math.min(vw / d.sceneWidth, vh / d.sceneHeight) * 0.85;
          await this._panTo({
            x: d.sceneX + d.sceneWidth / 2,
            y: d.sceneY + d.sceneHeight / 2,
            scale,
            duration: 700
          });
        }
      } catch (e) {
        console.warn("Beneos Tutorial Tour | Failed to zoom out for summary:", e);
      }
    }

    if (stepId === "p1-continue") {
      // Zoom back IN to the teleporter for the context-menu demo.
      // sound:false — this is the LAST step of the Overview tour; swooshing
      // here would suppress the end.ogg fired by _renderStep's last-step rule.
      document.body.classList.add("beneos-no-fade");
      const coords = { x: 1361, y: 1448, w: 499, h: 394 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.7, sound: false });
      this._createCanvasMarker({ ...coords, id: "p1-continue", highlight: true });
      this._trySelector("#beneos-tour-marker-p1-continue");
      // Render a visual-only fake context menu next to the teleporter showing
      // the typical Beneos right-click options.
      this._createFakeContextMenu({
        canvasX: coords.x + coords.w,
        canvasY: coords.y + coords.h / 2,
        offset: { x: 24, y: -40 },
        id: "p1-continue",
        items: [
          { icon: "fas fa-bullhorn", label: "Activate Scene" },
          { icon: "fas fa-eye",      label: "View Scene" },
          { icon: "fas fa-download", label: "Preload Scene" }
        ]
      });
    }

    // ===== Tour: tutorial-page-2-battlemaps =====

    // Belt-and-braces: on every Battlemap step, re-assert journal pin
    // visibility. Something in Foundry's canvas/layer activation path was
    // observed to drop `objects.visible` back to false between tour start
    // and step 1; re-applying on each step eliminates the race.
    if (this.id === "tutorial-page-2-battlemaps") {
      if (game.user.isGM) await game.settings.set("core", "notesDisplayToggle", true);
      if (canvas.notes?.objects) {
        canvas.notes.objects.visible = true;
        canvas.notes.objects.renderable = true;
      }
    }

    if (stepId === "bm-welcome") {
      // Snapshot the knight token's state BEFORE we touch anything, so we
      // can restore the user's scene to its pristine state on exit/complete.
      if (!this._tokenOriginalState) this._saveTokenState("0kffK0uqEseXCTQi");
      // Reset the camera to the scene's default view
      document.body.classList.add("beneos-no-fade");
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await canvas.animatePan({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        } else if (canvas.dimensions) {
          const d = canvas.dimensions;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const scale = Math.min(vw / d.sceneWidth, vh / d.sceneHeight) * 0.85;
          await canvas.animatePan({
            x: d.sceneX + d.sceneWidth / 2,
            y: d.sceneY + d.sceneHeight / 2,
            scale,
            duration: 600
          });
        }
      } catch (e) {
        console.warn("Beneos Tutorial Tour | Failed to reset canvas for bm-welcome:", e);
      }
      // Canvas marker in the upper third of the scene, horizontally centred
      if (canvas.dimensions) {
        const d = canvas.dimensions;
        const cx = d.sceneX + d.sceneWidth / 2;
        const cy = d.sceneY + d.sceneHeight * 0.2; // ~20% from top (upper third)
        const coords = { x: cx - 25, y: cy - 25, w: 50, h: 50 };
        this._createCanvasMarker({ ...coords, id: "bm-welcome" });
        this._trySelector("#beneos-tour-marker-bm-welcome");
      }
    }

    if (stepId === "bm-navbar-intro") {
      // Reset the knight token to a known demo starting position. This
      // guarantees the later teleport/overlay-tile demo steps always start
      // from the same spot regardless of where the user had dropped the
      // token before the tour began.
      const knight = this._findToken("0kffK0uqEseXCTQi");
      if (knight) {
        try {
          // mlt_bypass prevents MLT's auto-teleport from yanking the knight
          // back into the world overview region during the demo reset.
          await knight.document.update(
            { x: 2050, y: 2825, elevation: 0 },
            { mlt_bypass: true }
          );
        } catch (e) {
          console.warn("Beneos Tutorial Tour | Failed to reset knight position:", e);
        }
      }
      const coords = { x: 75, y: 3450, w: 4000, h: 613 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.4 });
      this._createCanvasMarker({ ...coords, id: "bm-navbar-intro", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-navbar-intro");
    }

    if (stepId === "bm-overview-teleporter") {
      const coords = { x: 463, y: 3450, w: 550, h: 613 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.7 });
      this._createCanvasMarker({ ...coords, id: "bm-overview-teleporter", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-overview-teleporter");
    }

    if (stepId === "bm-region-world") {
      const coords = { x: 1050, y: 3450, w: 1025, h: 613 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.6 });
      this._createCanvasMarker({ ...coords, id: "bm-region-world", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-region-world");
    }

    if (stepId === "bm-scenery-link") {
      const coords = { x: 2225, y: 3450, w: 438, h: 613 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.75 });
      this._createCanvasMarker({ ...coords, id: "bm-scenery-link", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-scenery-link");
    }

    if (stepId === "bm-handouts") {
      const coords = { x: 2688, y: 3450, w: 750, h: 613 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.65 });
      this._createCanvasMarker({ ...coords, id: "bm-handouts", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-handouts");
    }

    if (stepId === "bm-handout-1") {
      // Close any previously opened journals (e.g. when navigating backwards
      // from bm-handout-2 where the close was skipped via KEEP_JOURNAL_OPEN_AFTER).
      await this._closeOpenedJournals();
      // Open the first handout journal and dock the tooltip to it
      const sheet = await this._openJournal("phpFJcAkvbk0MDwf", null, { collapseSidebar: true });
      await new Promise(r => setTimeout(r, 700));
      const el = sheet?.element;
      const sheetEl = el?.getBoundingClientRect ? el : el?.[0];
      if (sheetEl?.getBoundingClientRect) {
        const rect = sheetEl.getBoundingClientRect();
        this._createScreenMarker({
          x: rect.left, y: rect.top, w: rect.width, h: rect.height,
          id: "bm-handout-1-anchor"
        });
        this._trySelector("#beneos-screen-marker-bm-handout-1-anchor");
      }
    }

    if (stepId === "bm-handout-2") {
      // Previous handout was closed by _postStep of bm-handout-1. Open the second.
      const sheet = await this._openJournal("CxUVbsHJne9aqz66", null, { collapseSidebar: true });
      await new Promise(r => setTimeout(r, 700));
      const el = sheet?.element;
      const sheetEl = el?.getBoundingClientRect ? el : el?.[0];
      if (sheetEl?.getBoundingClientRect) {
        const rect = sheetEl.getBoundingClientRect();
        this._createScreenMarker({
          x: rect.left, y: rect.top, w: rect.width, h: rect.height,
          id: "bm-handout-2-anchor"
        });
        this._trySelector("#beneos-screen-marker-bm-handout-2-anchor");
      }
    }

    if (stepId === "bm-share-image") {
      // The journal was kept open after bm-handout-2 (KEEP_JOURNAL_OPEN_AFTER).
      // Read the existing sheet's position WITHOUT re-rendering to avoid flicker.
      const journal = game.journal.get("CxUVbsHJne9aqz66");
      const sheet = journal?.sheet;
      // Re-assert the collapsed sidebar in case a re-render expanded it.
      if (sheet) this._collapseJournalSidebar(sheet);
      const el = sheet?.element;
      const sheetEl = el?.getBoundingClientRect ? el : el?.[0];
      if (sheetEl?.getBoundingClientRect) {
        const rect = sheetEl.getBoundingClientRect();
        // Anchor marker at the top-right corner of the journal header,
        // roughly where the three-dots menu lives in V13/V14 sheets.
        this._createScreenMarker({
          x: rect.right - 80,
          y: rect.top,
          w: 80,
          h: 40,
          id: "bm-share-image"
        });
        this._trySelector("#beneos-screen-marker-bm-share-image");
      }
    }

    if (stepId === "bm-navigation-recap") {
      // Zoom back out to show the full map for the "that was the DM nav" message
      document.body.classList.add("beneos-no-fade");
      try {
        const d = canvas.dimensions;
        if (d) {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const scale = Math.min(vw / d.sceneWidth, vh / d.sceneHeight) * 0.85;
          await this._panTo({
            x: d.sceneX + d.sceneWidth / 2,
            y: d.sceneY + d.sceneHeight / 2,
            scale,
            duration: 700
          });
        }
      } catch (e) {}
    }

    if (stepId === "bm-player-navigators") {
      const coords = { x: 1513, y: 2900, w: 1088, h: 438 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.6 });
      this._createCanvasMarker({ ...coords, id: "bm-player-navigators", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-player-navigators");
    }

    if (stepId === "bm-player-icon") {
      const coords = { x: 1950, y: 3113, w: 263, h: 213 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 1.2 });
      this._createCanvasMarker({ ...coords, id: "bm-player-icon", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-player-icon");
    }

    if (stepId === "bm-player-field") {
      const coords = { x: 1638, y: 2788, w: 875, h: 613 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.7 });
      this._createCanvasMarker({ ...coords, id: "bm-player-field", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-player-field");
    }

    if (stepId === "bm-player-field-moved") {
      // Move the knight 2 fields down so it enters the teleporter region
      await this._moveTokenByFields("0kffK0uqEseXCTQi", 0, 2);
      // Keep the same canvas framing as the previous step
      const coords = { x: 1638, y: 2788, w: 875, h: 613 };
      this._createCanvasMarker({ ...coords, id: "bm-player-field-moved", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-player-field-moved");
    }

    if (stepId === "bm-follow-players") {
      // Arm the chat hook FIRST so we don't miss the MLT whisper if it
      // arrives faster than we can await it.
      const chatMsgPromise = this._waitForNewChatMessage(10000);
      // Trigger the MLT teleport via DIRECT call to game.multilevel._activateTeleport
      // (the hook-based trigger was unreliable with programmatic position updates).
      await this._triggerMLTTeleport("lX676XA39rdDuOLN", "0kffK0uqEseXCTQi");
      // Wait for the MLT teleport notification to actually land in chat.
      // Uses the createChatMessage hook so timing is exact — no guessing.
      const createdMsg = await chatMsgPromise;
      // Open chat + highlight the message + position the tour box next to it
      const msgEl = await this._highlightChatMessage(createdMsg?.id);
      if (msgEl) {
        const rect = msgEl.getBoundingClientRect();
        this._createScreenMarker({
          x: rect.left,
          y: rect.top,
          w: rect.width,
          h: rect.height,
          id: "bm-follow-players"
        });
        this._trySelector("#beneos-screen-marker-bm-follow-players");
      }
    }

    if (stepId === "bm-teleport-destination") {
      // Zoom to where the knight ended up after the MLT teleport
      const coords = { x: 2500, y: 1700, w: 1100, h: 713 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.7 });
      this._createCanvasMarker({ ...coords, id: "bm-teleport-destination", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-teleport-destination");
    }

    if (stepId === "bm-pause-mlt") {
      // Zoom out to default view — just an informational step, no settings opened yet
      document.body.classList.add("beneos-no-fade");
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        }
      } catch (e) {}
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500, h: 200
        };
        this._createCanvasMarker({ ...coords, id: "bm-pause-mlt" });
        this._trySelector("#beneos-tour-marker-bm-pause-mlt");
      }
    }

    if (stepId === "bm-pause-mlt-settings") {
      // Open the Settings sidebar, Configure Settings, and navigate to the MLT module
      try {
        const settingsTab = document.querySelector('[data-tab="settings"]');
        if (settingsTab) settingsTab.click();
        await new Promise(r => setTimeout(r, 400));

        const configBtn = document.querySelector('button[data-app="configure"]');
        if (configBtn) configBtn.click();
        await new Promise(r => setTimeout(r, 600));

        const mltTab = document.querySelector('button[data-action="tab"][data-tab="multilevel-tokens"]');
        if (mltTab) mltTab.click();
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {}

      // Find the Pause MLT setting row so Foundry's fade overlay can cut it
      // out — a proper spotlight effect instead of just a gold border. Also
      // add the gold outline class for double emphasis.
      let pauseRow = null;
      try {
        const panel = document.querySelector('section.settings-config, .categories, form.application')
                   ?? document;
        const labels = panel.querySelectorAll("label");
        for (const label of labels) {
          if (label.textContent?.trim().toLowerCase().startsWith("pause mlt")) {
            pauseRow = label.closest(".form-group, .form-fields, .setting, div") ?? label.parentElement;
            if (pauseRow) pauseRow.classList.add("beneos-filter-highlight");
            break;
          }
        }
      } catch (e) {}

      if (pauseRow?.getBoundingClientRect) {
        const rect = pauseRow.getBoundingClientRect();
        // Screen marker slightly larger than the row — Foundry's tour fade
        // overlay creates a cutout around the selector element, so the row
        // becomes the spotlit area on an otherwise darkened screen.
        this._createScreenMarker({
          x: rect.left - 6,
          y: rect.top - 6,
          w: rect.width + 12,
          h: rect.height + 12,
          id: "bm-pause-mlt-setting"
        });
        this._trySelector("#beneos-screen-marker-bm-pause-mlt-setting");
      } else {
        // Fallback: canvas anchor so at least the tooltip shows
        document.body.classList.add("beneos-no-fade");
        const d = canvas.dimensions;
        if (d) {
          const coords = {
            x: d.sceneX + d.sceneWidth / 2 - 250,
            y: d.sceneY + d.sceneHeight / 3 - 100,
            w: 500, h: 200
          };
          this._createCanvasMarker({ ...coords, id: "bm-pause-mlt-settings" });
          this._trySelector("#beneos-tour-marker-bm-pause-mlt-settings");
        }
      }
    }

    if (stepId === "bm-overlay-tiles") {
      // Close the settings window opened by the previous step
      try { game.settings.sheet?.close(); } catch (e) {}
      try {
        const chatTab = document.querySelector('[data-tab="chat"]');
        if (chatTab) chatTab.click();
      } catch (e) {}
      // Zoom out to default view — this is a transition step after the settings dialog
      document.body.classList.add("beneos-no-fade");
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 700 });
        }
      } catch (e) {}
      // Upper-third center anchor for the transition text
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500, h: 200
        };
        this._createCanvasMarker({ ...coords, id: "bm-overlay-tiles" });
        this._trySelector("#beneos-tour-marker-bm-overlay-tiles");
      }
    }

    if (stepId === "bm-obstacles") {
      // Zoom to the overlay area, then move the knight so it vanishes under a foreground tile
      const coords = { x: 2500, y: 1700, w: 1100, h: 713 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.7, duration: 700 });
      await this._moveTokenByFields("0kffK0uqEseXCTQi", 3, 0);
      this._createCanvasMarker({ ...coords, id: "bm-obstacles", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-obstacles");
    }

    if (stepId === "bm-foreground-tiles") {
      // Bump the token's elevation to 20 so it reappears above the overhead tile
      await this._setTokenElevation("0kffK0uqEseXCTQi", 20);
      const coords = { x: 2500, y: 1700, w: 1100, h: 713 };
      this._createCanvasMarker({ ...coords, id: "bm-foreground-tiles", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-foreground-tiles");
    }

    if (stepId === "bm-complete") {
      // Restore token state first so the final zoomed-out view shows a clean scene
      await this._restoreTokenState();
      document.body.classList.add("beneos-no-fade");
      try {
        const d = canvas.dimensions;
        if (d) {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const scale = Math.min(vw / d.sceneWidth, vh / d.sceneHeight) * 0.85;
          await this._panTo({
            x: d.sceneX + d.sceneWidth / 2,
            y: d.sceneY + d.sceneHeight / 2,
            scale,
            duration: 700
          });
        }
      } catch (e) {}
    }

    if (stepId === "bm-scenery-next") {
      // Pan to the Scenery icon in the navbar so the user sees what comes next.
      // Silent pan — this is the LAST step of the tour; _renderStep's last-step
      // rule plays beneos_end.ogg, and swooshing here would suppress that.
      const coords = { x: 2213, y: 3400, w: 438, h: 588 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.7, sound: false });
      this._createCanvasMarker({ ...coords, id: "bm-scenery-next", highlight: true });
      this._trySelector("#beneos-tour-marker-bm-scenery-next");
    }

    // ===== Tour: tutorial-page-3-sceneries =====

    if (stepId === "sc-welcome") {
      // Initial reset to the scene's default view
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await canvas.animatePan({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        }
      } catch (e) {}
      // Upper third center: anchor invisible marker for tour box positioning
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500,
          h: 200
        };
        this._createCanvasMarker({ ...coords, id: "sc-welcome" });
        this._trySelector("#beneos-tour-marker-sc-welcome");
      }
    }

    if (stepId === "sc-welcome-2") {
      // Same position as sc-welcome
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500,
          h: 200
        };
        this._createCanvasMarker({ ...coords, id: "sc-welcome-2" });
        this._trySelector("#beneos-tour-marker-sc-welcome-2");
      }
    }

    if (stepId === "sc-navbar") {
      const coords = { x: 849, y: 2693, w: 4038, h: 621 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.45 });
      this._createCanvasMarker({ ...coords, id: "sc-navbar", highlight: true });
      this._trySelector("#beneos-tour-marker-sc-navbar");
    }

    if (stepId === "sc-battlemap-teleporter") {
      const coords = { x: 3006, y: 2713, w: 433, h: 620 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 1.0 });
      this._createCanvasMarker({ ...coords, id: "sc-battlemap-teleporter", highlight: true });
      this._trySelector("#beneos-tour-marker-sc-battlemap-teleporter");
    }

    if (stepId === "sc-static-maps") {
      // Pan back to default view for context
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        }
      } catch (e) {}

      // Show a visual-only fake context menu at the scene nav bar.
      // A real context menu would steal focus and kill the tour tooltip,
      // so we render a non-interactive replica (pointer-events: none).
      try {
        const sceneNav = document.querySelector('#scene-navigation');
        const sceneEl = sceneNav?.querySelector('.scene.active, .scene.view')
                      ?? sceneNav?.querySelector('.scene');
        if (sceneEl) {
          const rect = sceneEl.getBoundingClientRect();
          const fakeMenu = this._createFakeContextMenu({
            canvasX: 0, canvasY: 0,
            offset: { x: 0, y: 0 },
            id: "sc-static-maps",
            items: [
              { icon: "fas fa-bullseye",  label: "View Scene" },
              { icon: "fas fa-bullhorn",  label: "Activate Scene" },
              { icon: "fas fa-cogs",      label: "Configure" },
              { icon: "fas fa-map-pin",   label: "Toggle Navigation" },
              { icon: "fas fa-image",     label: "Use Static Map" }
            ]
          });
          // Override position to anchor below the scene element in screen space
          Object.assign(fakeMenu.style, {
            left: `${rect.left}px`,
            top: `${rect.bottom + 4}px`
          });
          // Highlight the "Use Static Map" entry
          const entries = fakeMenu.querySelectorAll("li");
          for (const li of entries) {
            if (li.textContent.includes("Static Map")) {
              li.style.background = "rgba(255,255,255,0.15)";
              li.style.fontWeight = "bold";
              break;
            }
          }
          this._trySelector(`#beneos-fake-context-menu-sc-static-maps`);
        }
      } catch (e) {}

      // Fallback anchor if the scene nav wasn't found
      if (!this.steps[this.stepIndex]?.selector) {
        const d = canvas.dimensions;
        if (d) {
          const coords = {
            x: d.sceneX + d.sceneWidth / 2 - 250,
            y: d.sceneY + d.sceneHeight / 3 - 100,
            w: 500, h: 200
          };
          this._createCanvasMarker({ ...coords, id: "sc-static-maps" });
          this._trySelector("#beneos-tour-marker-sc-static-maps");
        }
      }
    }

    if (stepId === "sc-static-freeze") {
      // Freeze every video tile on the scene (covers the animated scenery
      // tile N6UT2wnPEllLG2fa) to simulate the "Use Static Map" variant.
      // Videos resume on Next via _postStep's _unfreezeSceneVideos call.
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 500 });
        }
      } catch (e) {}
      this._freezeSceneVideos();
      // Reveal the two pause-symbol drawings so the user sees a visual cue
      // that the scene is "paused". Hidden again on postStep leave.
      this._setDrawingsRenderable(SCENERY_PAUSE_DRAWING_IDS, true);
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 200,
          y: d.sceneY + d.sceneHeight / 2 - 100,
          w: 400, h: 200
        };
        this._createCanvasMarker({ ...coords, id: "sc-static-freeze" });
        this._trySelector("#beneos-tour-marker-sc-static-freeze");
      }
    }

    if (stepId === "sc-next-intro") {
      // Pan back to the scene's default view. sound:false so the pan swoosh
      // doesn't swallow the last-step end sound.
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 700, sound: false });
        }
      } catch (e) {}
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500,
          h: 200
        };
        this._createCanvasMarker({ ...coords, id: "sc-next-intro" });
        this._trySelector("#beneos-tour-marker-sc-next-intro");
      }
    }

    // ===== Tour: tutorial-page-4-intro =====

    if (stepId === "intro-welcome") {
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await canvas.animatePan({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        }
      } catch (e) {}
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500,
          h: 200
        };
        this._createCanvasMarker({ ...coords, id: "intro-welcome" });
        this._trySelector("#beneos-tour-marker-intro-welcome");
      }
    }

    if (stepId === "intro-start-button") {
      // Intro video plays through the Ambient channel — raise that floor to
      // 60 % so the intro is clearly audible. Music stays at the tour default.
      // Settings above the floor are left untouched.
      await this._ensureMinAudioVolume({ ambient: 0.6 });
      const coords = { x: 3370, y: 2664, w: 917, h: 670 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.7 });
      this._createCanvasMarker({ ...coords, id: "intro-start-button", highlight: true });
      this._trySelector("#beneos-tour-marker-intro-start-button");
    }

    if (stepId === "intro-token-control") {
      // Pan back to default view so the intro area is visible (we were stuck on the start button)
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        } else if (canvas.dimensions) {
          const d = canvas.dimensions;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const scale = Math.min(vw / d.sceneWidth, vh / d.sceneHeight) * 0.85;
          await this._panTo({
            x: d.sceneX + d.sceneWidth / 2,
            y: d.sceneY + d.sceneHeight / 2,
            scale,
            duration: 600
          });
        }
      } catch (e) {}
      // Highlight the first scene-controls button (Token Controls)
      const tokenBtn = document.querySelector('#scene-controls-layers button[data-control="tokens"]')
                    ?? document.querySelector('button[data-control="tokens"]');
      if (tokenBtn) {
        tokenBtn.classList.add("tour-highlight");
        try { tokenBtn.click(); } catch (e) {}
        await new Promise(r => setTimeout(r, 300));
        this._trySelector('button[data-control="tokens"]');
      }
    }

    if (stepId === "intro-play") {
      // Reset camera to the scene's default view so any manual zoom from
      // earlier steps is undone and the whole intro video is visible.
      // Mirrors the pan used by intro-complete (the last step) — the
      // tutorial scene's initial view is specifically tuned to frame the
      // video, so reusing it keeps the framing identical across both steps.
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 700 });
        } else if (canvas.dimensions) {
          const d = canvas.dimensions;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const scale = Math.min(vw / d.sceneWidth, vh / d.sceneHeight) * 0.85;
          await this._panTo({
            x: d.sceneX + d.sceneWidth / 2,
            y: d.sceneY + d.sceneHeight / 2,
            scale,
            duration: 700
          });
        }
      } catch (e) {}
      // Play the video tile
      await this._playTileVideo("4sIUsXFBVfEEmgsc", true);
      // Swap the icon tile texture from icon_stop_play.webp → icon_playing.webp
      await this._swapTileTexture(
        "cIJhkHCxygIioaB7",
        "modules/beneos-module/icons/icon_playing.webp"
      );
      // Play the navigate SFX (different path than the standard helper expects)
      try {
        const helper = foundry.audio?.AudioHelper;
        const src = globalThis.beneosAssetPathRepair.resolve("beneos_assets/beneos_battlemaps/map_assets/sfx/sfx_navigate.ogg");
        if (helper?.play) {
          helper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
        }
      } catch (e) {
        console.warn("Beneos Tutorial Tour | Could not play sfx_navigate.ogg:", e);
      }
      // Anchor: upper third center for the tour box
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500,
          h: 200
        };
        this._createCanvasMarker({ ...coords, id: "intro-play" });
        this._trySelector("#beneos-tour-marker-intro-play");
      }
    }

    if (stepId === "intro-use-freely") {
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500,
          h: 200
        };
        this._createCanvasMarker({ ...coords, id: "intro-use-freely" });
        this._trySelector("#beneos-tour-marker-intro-use-freely");
      }
    }

    if (stepId === "intro-manual-start") {
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500,
          h: 200
        };
        this._createCanvasMarker({ ...coords, id: "intro-manual-start" });
        this._trySelector("#beneos-tour-marker-intro-manual-start");
      }
    }

    if (stepId === "intro-tile-controls") {
      // Highlight the third scene-controls button (Tile Controls)
      const tileBtn = document.querySelector('#scene-controls-layers button[data-control="tiles"]')
                   ?? document.querySelector('button[data-control="tiles"]');
      if (tileBtn) {
        tileBtn.classList.add("tour-highlight");
        try { tileBtn.click(); } catch (e) {}
        await new Promise(r => setTimeout(r, 300));
        this._trySelector('button[data-control="tiles"]');
      }
    }

    if (stepId === "intro-right-click-tile") {
      // Reveal the two manual-start explainer tiles that were hidden at
      // tour start. _postStep will re-hide them when leaving this step.
      this._setTilesRenderable(INTRO_MANUAL_TILE_IDS, true);
      // Simulate the right-click on the video tile so the Tile HUD (which
      // is Foundry's "context menu" for tiles, with the play/pause button)
      // appears on-screen. Without this the arrow tiles pointing at the
      // HUD icons would point at nothing.
      this._openTileHUD("4sIUsXFBVfEEmgsc");
      // User-provided invisible-box coords covering the right-click HUD area.
      // No highlight — the arrow tiles do the pointing.
      const coords = { x: 4739, y: 539, w: 355, h: 511 };
      await this._panTo({
        x: coords.x + coords.w / 2,
        y: coords.y + coords.h / 2,
        scale: 0.9
      });
      this._createCanvasMarker({ ...coords, id: "intro-right-click-tile" });
      this._trySelector("#beneos-tour-marker-intro-right-click-tile");
    }

    if (stepId === "intro-complete") {
      // Intro tour's TOUR_AUDIO_MAP entry is music=null (the video carries the
      // audio). At intro-complete the video is done and the next scene (World
      // Map) expects the standard tour music — start it early so the wrap-up
      // beat doesn't feel silent.
      try {
        const pl = game.playlists.get("pQpsDUhEtL0Q27vJ");
        const snd = pl?.sounds.get("sycGtPyfkbz5IhCa");
        if (snd && !snd.playing) pl.playSound(snd);
      } catch (e) {}
      // Stop the video
      await this._playTileVideo("4sIUsXFBVfEEmgsc", false);
      // Explicit, deterministic icon restore (do not rely on _restoreTileTextures alone —
      // the saved entry was unreliable in practice).
      const ORIG_ICON = globalThis.beneosAssetPathRepair.resolve("beneos_assets/beneos_battlemaps/map_assets/icons/icon_stop_play.webp");
      try {
        const iconTile = canvas.tiles?.get("cIJhkHCxygIioaB7");
        if (iconTile) await iconTile.document.update({ texture: { src: ORIG_ICON } });
      } catch (e) {
        console.warn("Beneos Tutorial Tour | Failed to restore intro icon tile:", e);
      }
      // Clear the saved swap state so exit/complete don't double-restore from a stale entry
      this._modifiedTileTextures = [];
      // Return to the scene's default view (same as intro-token-control / wm-welcome).
      document.body.classList.add("beneos-no-fade");
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 700 });
        } else if (canvas.dimensions) {
          const d = canvas.dimensions;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const scale = Math.min(vw / d.sceneWidth, vh / d.sceneHeight) * 0.85;
          await this._panTo({
            x: d.sceneX + d.sceneWidth / 2,
            y: d.sceneY + d.sceneHeight / 2,
            scale,
            duration: 700
          });
        }
      } catch (e) {}
    }

    // ===== Tour: tutorial-page-5-world-map =====

    /** Helper for Page 5: pan to scene default view (used by wm-welcome,
     *  wm-campaign, wm-example to "zoom back out") */
    const wmPanDefault = async () => {
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 700 });
        } else if (canvas.dimensions) {
          const d = canvas.dimensions;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const scale = Math.min(vw / d.sceneWidth, vh / d.sceneHeight) * 0.85;
          await this._panTo({
            x: d.sceneX + d.sceneWidth / 2,
            y: d.sceneY + d.sceneHeight / 2,
            scale,
            duration: 700
          });
        }
      } catch (e) {}
    };

    if (stepId === "wm-welcome") {
      // No fade — full map visible behind the text
      document.body.classList.add("beneos-no-fade");
      // Reset to scene default view
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await canvas.animatePan({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        }
      } catch (e) {}
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500, h: 200
        };
        this._createCanvasMarker({ ...coords, id: "wm-welcome" });
        this._trySelector("#beneos-tour-marker-wm-welcome");
      }
    }

    if (stepId === "wm-escalian") {
      // Show arrow tiles for this step
      await this._bringTileToFront("BPNunnOSD6kF7tzf");
      await this._bringTileToFront("OP9kim8h39FAOnnZ");
      const coords = { x: 2928, y: 6425, w: 2475, h: 1569 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.45 });
      this._createCanvasMarker({ ...coords, id: "wm-escalian", highlight: true });
      this._trySelector("#beneos-tour-marker-wm-escalian");
    }

    if (stepId === "wm-city-tiles") {
      // Show arrow tiles for this step
      await this._bringTileToFront("ek0ze7VTDR0nRXC7");
      await this._bringTileToFront("3s6uQohqJqCuBxVh");
      const coords = { x: 4719, y: 4212, w: 1852, h: 1266 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.55 });
      this._createCanvasMarker({ ...coords, id: "wm-city-tiles", highlight: true });
      this._trySelector("#beneos-tour-marker-wm-city-tiles");
    }

    if (stepId === "wm-campaign") {
      // No fade — full map visible behind the text
      document.body.classList.add("beneos-no-fade");
      await wmPanDefault();
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500, h: 200
        };
        this._createCanvasMarker({ ...coords, id: "wm-campaign" });
        this._trySelector("#beneos-tour-marker-wm-campaign");
      }
    }

    if (stepId === "wm-continents") {
      const coords = { x: 7899, y: 2423, w: 2304, h: 3062 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.35 });
      this._createCanvasMarker({ ...coords, id: "wm-continents", highlight: true });
      this._trySelector("#beneos-tour-marker-wm-continents");
    }

    if (stepId === "wm-dowercrag") {
      // Bring the Dowercrag arrow tile to the front so the castle marker is
      // visible. Pre-sorted to back at tour start via WORLD_MAP_ARROW_TILE_IDS.
      await this._bringTileToFront("OP9kim8h39FAOnnZ");
      const coords = { x: 4739, y: 6588, w: 1157, h: 1017 };
      await this._panTo({ x: coords.x + coords.w / 2, y: coords.y + coords.h / 2, scale: 0.7 });
      this._createCanvasMarker({ ...coords, id: "wm-dowercrag", highlight: true });
      this._trySelector("#beneos-tour-marker-wm-dowercrag");
    }

    if (stepId === "wm-example") {
      // No fade — full map visible behind the text
      document.body.classList.add("beneos-no-fade");
      await wmPanDefault();
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500, h: 200
        };
        this._createCanvasMarker({ ...coords, id: "wm-example" });
        this._trySelector("#beneos-tour-marker-wm-example");
      }
    }

    if (stepId === "wm-tutorial-complete") {
      // Show arrow tile for the final step
      await this._bringTileToFront("OP9kim8h39FAOnnZ");
      // No fade — full map visible
      document.body.classList.add("beneos-no-fade");
      const d = canvas.dimensions;
      if (d) {
        const coords = {
          x: d.sceneX + d.sceneWidth / 2 - 250,
          y: d.sceneY + d.sceneHeight / 3 - 100,
          w: 500, h: 200
        };
        this._createCanvasMarker({ ...coords, id: "wm-tutorial-complete" });
        this._trySelector("#beneos-tour-marker-wm-tutorial-complete");
      }
    }

    // ===== Tour: tutorial-page-6-creatures =====

    // Build a full path to a Rot Cerf demo asset.
    // ScenePacker → Moulinette installs the world under arbitrary roots
    // (data/beneos_assets/..., data/moulinette/adventures/.../beneos_assets/...,
    // etc.). All nine Rot Cerf demo files live in the SAME folder as the
    // actor's portrait (and prototype-token texture), so we read that folder
    // off the actor itself and append the requested filename. The actor img
    // is stable — unlike the live token texture it isn't mutated by the tour.
    const ctRotCerfAsset = (filename) => {
      const actor = game.actors.get("q5thcJTwfi7uHZLA")
                 ?? game.actors.find(a => a.name?.toLowerCase().includes("rot cerf"));
      const ref = actor?.img || actor?.prototypeToken?.texture?.src || "";
      const slash = ref.lastIndexOf("/");
      if (slash >= 0) return `${ref.slice(0, slash + 1)}${filename}`;
      // Last-resort fallback: derive prefix from the on-canvas token, then
      // append the historic asset folder. Only reached if the actor has no img.
      const token = canvas.tokens?.placeables.find(t => t.actor?.id === "q5thcJTwfi7uHZLA"
                                                     || t.actor?.name?.toLowerCase().includes("rot cerf"));
      const src = token?.document?.texture?.src || "";
      const m = src.match(/^(.*?)beneos_assets\//);
      const prefix = m ? m[1] : "";
      return `${prefix}beneos_assets/beneos_battlemaps/map_assets/getting_started/${filename}`;
    };

    // Swap the Rot Cerf token's texture to a demo asset.
    // Saves the ORIGINAL texture on the first swap for cleanup.
    const ctSwapRotCerfTexture = async (filename) => {
      const token = canvas.tokens?.placeables.find(t => t.actor?.name?.toLowerCase().includes("rot cerf"));
      if (!token) return;
      if (!this._savedRotCerfTexture) this._savedRotCerfTexture = token.document.texture.src;
      await token.document.update({ "texture.src": ctRotCerfAsset(filename) });
    };

    // Helper: anchor the tour tooltip in upper-third center of the canvas
    const ctCenterAnchor = (id) => {
      const d = canvas.dimensions;
      if (!d) return;
      const coords = {
        x: d.sceneX + d.sceneWidth / 2 - 250,
        y: d.sceneY + d.sceneHeight / 3 - 100,
        w: 500, h: 200
      };
      this._createCanvasMarker({ ...coords, id });
      this._trySelector(`#beneos-tour-marker-${id}`);
    };

    // Helper: close the BattleMap import notice popup if it's open
    const ctCloseBattleMapNotice = () => {
      try {
        for (const app of Object.values(ui.windows)) {
          const title = app.title || app.options?.title || "";
          if (typeof title === "string" && title.toLowerCase().includes("battlemap import")) {
            app.close();
          }
        }
      } catch (e) {}
    };

    // Helper: ensure cloud search engine is open on Tokens tab
    const ctEnsureCloudOpen = async () => {
      if (!document.querySelector(".beneos_search_engine")) {
        try {
          const { BeneosSearchEngineLauncher } = await import("./beneos_search_engine.js");
          new BeneosSearchEngineLauncher().render();
        } catch (e) {
          try { if (typeof BeneosSearchEngineLauncher !== "undefined") new BeneosSearchEngineLauncher().render(); } catch (e2) {}
        }
        await new Promise(r => setTimeout(r, 1500));
        try {
          const tokenTab = document.querySelector("#beneos-radio-token");
          if (tokenTab) {
            const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
            evt.preventDefault();
            tokenTab.dispatchEvent(evt);
          }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 500));
      }
      // Always dismiss the BattleMap notice if it's hanging around
      ctCloseBattleMapNotice();
    };

    // Helper: close ALL cloud-related windows (main + results dialog + notice).
    // Sometimes a search-results window remains open after the search engine itself
    // is closed and overlaps subsequent steps — this iterates every Foundry app
    // and removes anything Beneos-Cloud-related.
    const ctCloseCloud = () => {
      ctCloseBattleMapNotice();
      // V1 path: ui.windows contains FormApplication-style apps. The V2 cloud
      // window does NOT register here — Foundry V14's ApplicationV2 lives in
      // foundry.applications.instances instead.
      try {
        for (const app of Object.values(ui.windows || {})) {
          const el = app.element?.[0] ?? app.element;
          if (!el) continue;
          if (el.classList?.contains("beneos_search_engine") ||
              el.querySelector?.(".beneos_search_engine") ||
              el.querySelector?.(".bc-results")) {
            try { app.close(); } catch (e) {}
          }
        }
      } catch (e) {}
      // V2 path: iterate the ApplicationV2 instance map. Anything carrying
      // our cloud-app class gets closed via its own .close() method.
      try {
        const v2 = foundry.applications?.instances;
        if (v2 && typeof v2[Symbol.iterator] === "function") {
          for (const [, app] of v2) {
            const el = app?.element;
            if (!el?.classList) continue;
            if (el.classList.contains("beneos-cloud-app") ||
                el.classList.contains("beneos_search_engine")) {
              try { app.close(); } catch (e) {}
            }
          }
        }
      } catch (e) {}
      // Defensive DOM nuke for both V1 (`.app` wrapper) and V2 (`.application`
      // wrapper). Picks up anything our class checks above missed.
      document.querySelectorAll(".beneos_search_engine, .beneos-cloud-app").forEach(el => {
        const wrapper = el.closest(".app, .application");
        if (wrapper && document.body.contains(wrapper)) wrapper.remove();
      });
    };

    // Helper: collapse ALL select elements in the cloud back to size=1 (dropdown mode)
    const ctCollapseAllSelects = () => {
      document.querySelectorAll(".beneos_search_engine select").forEach(s => { s.size = 1; });
    };

    // Render a fake "dropdown preview" below the filter <select> so the user
    // can see what values are available — like opening the dropdown — while
    // the spotlight stays tightly on the select itself. The cloud sidebar is
    // pre-scrolled so the select sits near the top of its visible band, which
    // guarantees room below for the popup even for selects that normally live
    // at the bottom of the sidebar (Campaign, Source, Show).
    const ctShowFilterOptions = (sel) => {
      this._clearFakeContextMenus();
      const el = document.querySelector(sel);
      if (!el) return false;
      const sidebar = el.closest(".bc-sidebar");
      if (sidebar) {
        const sbRect = sidebar.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        sidebar.scrollTop = Math.max(0, sidebar.scrollTop + (elRect.top - sbRect.top - 16));
      }
      requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const menu = document.createElement("div");
        menu.classList.add("beneos-fake-context-menu");
        const popupTop = rect.bottom + 4;
        const popupLeft = Math.max(8, rect.left);
        const maxHeight = Math.max(120, Math.min(360, window.innerHeight - popupTop - 24));
        Object.assign(menu.style, {
          left: `${popupLeft}px`,
          top: `${popupTop}px`,
          minWidth: `${Math.max(rect.width, 200)}px`,
          maxHeight: `${maxHeight}px`,
          overflowY: "auto",
          zIndex: "999999"
        });
        const ol = document.createElement("ol");
        for (const opt of el.options) {
          const label = (opt.textContent || opt.value || "").trim();
          if (!label) continue;
          const li = document.createElement("li");
          const span = document.createElement("span");
          span.textContent = label;
          li.appendChild(span);
          ol.appendChild(li);
        }
        menu.appendChild(ol);
        document.body.appendChild(menu);
        this._fakeContextMenus.push(menu);
        // Spotlight covers select + dropdown preview so both are illuminated
        // out of the dark tour overlay.
        this._applySpotlight([el, menu], 6);
        this._trySelector(sel);
      });
      return true;
    };

    if (stepId === "ct-welcome") {
      document.body.classList.add("beneos-no-fade");
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await canvas.animatePan({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        }
      } catch (e) {}
      ctCenterAnchor("ct-welcome");
    }

    if (stepId === "ct-actor-directory") {
      // V2 layout: Beneos has its own scene-controls toolbar button on the
      // left side of the canvas. Anchor the tour spotlight there. Note: the
      // scene-controls panel only renders when a scene is active — for the
      // tour case this is fine because we run on a tutorial scene, but the
      // tooltip text mentions the requirement so patrons hit no surprise
      // when they later try to open Beneos Cloud from a fresh world.
      document.body.classList.remove("beneos-no-fade");
      const beneosBtn = document.querySelector("#scene-controls li button.beneos-icon-logo, .scene-controls button.beneos-icon-logo");
      if (beneosBtn) {
        beneosBtn.id = beneosBtn.id || "beneos-tour-toolbar-anchor";
        try { beneosBtn.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
        this._applySpotlight(beneosBtn, 10);
        this._trySelector("#" + beneosBtn.id);
      } else {
        // Last-ditch fallback: center the tooltip if the toolbar button isn't
        // in the DOM yet (e.g. canvas still initializing).
        ctCenterAnchor("ct-actor-directory");
      }
    }

    if (stepId === "ct-cloud-open") {
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      this._trySelector(".beneos_search_engine");
    }

    if (stepId === "ct-cloud-account") {
      // Suppress Foundry's fade; we'll use our own custom spotlight covering the cloud window too.
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      await new Promise(r => setTimeout(r, 300));
      // V2 layout: auth lives in the cloud window footer (status-footer.hbs), not
      // in the form body. Either the Sign-In button (logged out) or the Account
      // Settings button (logged in) is rendered — never both. Spotlight whichever
      // is currently shown so the step works in either state.
      const loginBtn = document.querySelector(".beneos-cloud-login-button");
      const accountBtn = document.querySelector('.bc-footer-button[data-action="openCloudSettings"]');
      const anchor = loginBtn ?? accountBtn;
      if (anchor) {
        anchor.id = anchor.id || "beneos-tour-auth-anchor";
        try { anchor.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
        this._applySpotlight(anchor, 10);
        this._trySelector("#" + anchor.id);
      } else {
        this._trySelector(".beneos_search_engine");
      }
    }

    if (stepId === "ct-categories") {
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      // Ensure Creatures (Tokens) tab is active
      try {
        const tokenTab = document.querySelector("#beneos-radio-token");
        if (tokenTab) {
          const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
          evt.preventDefault();
          tokenTab.dispatchEvent(evt);
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
      ctCollapseAllSelects();
      this._trySelector(".beneos_search_engine");
    }

    // Filter steps — expand the relevant <select> inline so the user sees the
    // available values right where the filter is. No-fade stays ACTIVE so the
    // cloud remains readable; the spotlight on the expanded select is the focus.
    if (stepId === "ct-filter-biome") {
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      if (!ctShowFilterOptions("#bc-biome-add")) this._trySelector(".beneos_search_engine");
    }
    if (stepId === "ct-filter-campaign") {
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      if (!ctShowFilterOptions("#campaign-selector")) this._trySelector(".beneos_search_engine");
    }
    if (stepId === "ct-filter-type") {
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      if (!ctShowFilterOptions("#token-types")) this._trySelector(".beneos_search_engine");
    }
    if (stepId === "ct-filter-faction") {
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      if (!ctShowFilterOptions("#faction-selector")) this._trySelector(".beneos_search_engine");
    }
    if (stepId === "ct-filter-fighting") {
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      if (!ctShowFilterOptions("#token-fight-style")) this._trySelector(".beneos_search_engine");
    }
    if (stepId === "ct-filter-purpose") {
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      if (!ctShowFilterOptions("#token-purpose")) this._trySelector(".beneos_search_engine");
    }

    if (stepId === "ct-search-intro") {
      // Transition step — explain filters vs search, no highlight yet
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      ctCollapseAllSelects();
      this._clearFakeContextMenus();
      this._removeSpotlight();
      // Clear any stale search text so the intro view is neutral
      try {
        const input = document.querySelector("#beneos-search-text");
        if (input) {
          input.value = "";
          input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        }
      } catch (e) {}
      this._trySelector(".beneos_search_engine");
    }

    if (stepId === "ct-search-rotcerf") {
      // Type the search, then spotlight BOTH the search input AND the result row
      document.body.classList.add("beneos-no-fade");
      await ctEnsureCloudOpen();
      ctCollapseAllSelects();
      // The previous filter steps scrolled the cloud sidebar down so the
      // various selects sat near the top of the visible band. The search
      // input lives at the very top of the sidebar — reset the sidebar's
      // scroll so it's actually visible for this step.
      try { document.querySelector(".bc-sidebar")?.scrollTo({ top: 0, behavior: "instant" }); } catch (e) {}
      try {
        const input = document.querySelector("#beneos-search-text");
        if (input) {
          input.value = "Rot Cerf";
          input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 1300));
      try {
        const resultBox = document.querySelector(".bc-results");
        const rows = resultBox?.querySelectorAll(".bc-result-card");
        let rotRow = null;
        for (const row of rows || []) {
          if (row.textContent.toLowerCase().includes("rot cerf")) { rotRow = row; break; }
        }
        if (resultBox && rotRow) {
          resultBox.scrollTop = rotRow.offsetTop - resultBox.offsetTop - 8;
          await new Promise(r => setTimeout(r, 250));
          rotRow.id = "beneos-tour-rotcerf-row";
          const input = document.querySelector("#beneos-search-text");
          // Spotlight both the search input and the Rot Cerf row
          this._applySpotlight([input, rotRow].filter(Boolean), 8);
          this._trySelector("#beneos-tour-rotcerf-row");
          return;
        }
      } catch (e) {}
      this._trySelector(".bc-results") || this._trySelector(".beneos_search_engine");
    }

    if (stepId === "ct-search-install") {
      // Keep the fade overlay active on this step so the install button gets
      // a proper spotlight — many users were confused about which button
      // (Install vs the CR/Source/Tier buttons below) is the right one.
      await ctEnsureCloudOpen();
      try {
        const rows = document.querySelectorAll(".bc-result-card");
        let rotRow = null;
        for (const row of rows || []) {
          if (row.textContent.toLowerCase().includes("rot cerf")) { rotRow = row; break; }
        }
        if (rotRow) {
          const resultBox = document.querySelector(".bc-results");
          if (resultBox) resultBox.scrollTop = rotRow.offsetTop - resultBox.offsetTop - 8;
          await new Promise(r => setTimeout(r, 250));
          // V2 card layout: the install action is a single button with both
          // .bc-card-button and .bc-action-install classes (results-pane.hbs:259).
          // Update buttons share the install class and add .bc-action-update on top,
          // so this selector also picks them up — fine for the demo, since either
          // button is the "primary card action" the tour should highlight.
          const installBtn = rotRow.querySelector(".bc-card-button.bc-action-install");
          if (installBtn) {
            installBtn.id = "beneos-tour-install-anchor";
            // _applySpotlight darkens everything OUTSIDE a cutout around the
            // button — this bypasses the cloud window's boosted z-index, so
            // the user sees a real dark fade on the light-on-light button row
            // instead of just a subtle gold frame that blends into the bg.
            this._applySpotlight(installBtn, 8);
            this._trySelector("#beneos-tour-install-anchor");
            return;
          }
        }
      } catch (e) {}
      // Fallback: if we couldn't find the specific button, suppress the fade
      // to avoid darkening the cloud window with no cutout reference.
      document.body.classList.add("beneos-no-fade");
      this._trySelector(".bc-results") || this._trySelector(".beneos_search_engine");
    }

    if (stepId === "ct-place-token") {
      document.body.classList.add("beneos-no-fade");
      ctCloseCloud();
      await new Promise(r => setTimeout(r, 300));
      // Place the pre-existing Rot Cerf actor on the map
      try {
        const actor = game.actors.get("q5thcJTwfi7uHZLA")
                   ?? game.actors.find(a => a.name.toLowerCase().includes("rot cerf"));
        const existing = canvas.tokens?.placeables.find(t => t.actor?.name?.toLowerCase().includes("rot cerf"));
        if (actor && !existing) {
          const td = (await actor.getTokenDocument()).toObject();
          td.x = 2710;
          td.y = 1744;
          await canvas.scene.createEmbeddedDocuments("Token", [td]);
        }
      } catch (e) {
        console.warn("Beneos Tutorial Tour | Failed to place Rot Cerf token:", e);
      }
      await this._panTo({ x: 2710 + 150, y: 1744 + 150, scale: 0.6, duration: 700, sound: false });
      // No highlight — the freshly placed Rot Cerf speaks for itself.
      const coords = { x: 2710 - 100, y: 1744 - 100, w: 500, h: 500 };
      this._createCanvasMarker({ ...coords, id: "ct-place-token" });
      this._trySelector("#beneos-tour-marker-ct-place-token");
    }

    // Helper: open the real Token HUD and inject Beneos-style icons directly
    // into its .left/.right columns. Bypasses the complex Beneos compendium
    // requirements so the icons ALWAYS render for the tour demo.
    const ctOpenTokenHUDWithIcons = async () => {
      const token = canvas.tokens?.placeables.find(t => t.actor?.name?.toLowerCase().includes("rot cerf"));
      if (!token) return null;
      token.control({ releaseOthers: true });
      canvas.hud.token.bind(token);
      await new Promise(r => setTimeout(r, 400));
      const hud = document.querySelector("#token-hud");
      if (!hud) return null;
      // Inject journal icon on LEFT
      const leftCol = hud.querySelector(".col.left, div.left");
      if (leftCol && !leftCol.querySelector(".beneos-tour-fake-journal")) {
        const jIcon = document.createElement("div");
        jIcon.className = "control-icon beneos-tour-fake-journal";
        jIcon.innerHTML = `<img src="modules/beneos-module/icons/beneos_icon_open_journal.svg" style="width:100%;height:100%;filter:invert(1)">`;
        leftCol.appendChild(jIcon);
      }
      // Inject skin icon on RIGHT
      const rightCol = hud.querySelector(".col.right, div.right");
      if (rightCol && !rightCol.querySelector(".beneos-tour-fake-skin")) {
        const sIcon = document.createElement("div");
        sIcon.className = "control-icon beneos-tour-fake-skin";
        sIcon.innerHTML = `<img src="modules/beneos-module/icons/beneos_icon_change_skin.svg" style="width:100%;height:100%;filter:invert(1)">`;
        rightCol.appendChild(sIcon);
      }
      return hud;
    };

    if (stepId === "ct-context-menu") {
      document.body.classList.add("beneos-no-fade");
      await this._panTo({ x: 2710 + 150, y: 1744 + 150, scale: 0.9, duration: 500, sound: false });
      const hud = await ctOpenTokenHUDWithIcons();
      if (hud) {
        const jEl = hud.querySelector(".beneos-tour-fake-journal");
        const sEl = hud.querySelector(".beneos-tour-fake-skin");
        this._applySpotlight([jEl, sEl, hud].filter(Boolean), 8);
        // Anchor tooltip to the RIGHTMOST element (skin icon) so the box appears
        // to the right of it — leaves the portrait + both icons visible between
        // the creature frame and the tour box.
        if (sEl) {
          sEl.id = sEl.id || "beneos-tour-hud-right-anchor";
          this._trySelector("#" + sEl.id);
        } else {
          hud.id = hud.id || "beneos-tour-hud-anchor";
          this._trySelector("#" + hud.id);
        }
      } else {
        const coords = { x: 2710 - 80, y: 1744 - 80, w: 440, h: 440 };
        this._createCanvasMarker({ ...coords, id: "ct-context-menu", highlight: true });
        this._trySelector("#beneos-tour-marker-ct-context-menu");
      }
    }

    if (stepId === "ct-skin-switch") {
      document.body.classList.add("beneos-no-fade");
      // Just open the HUD with icons and highlight the skin button — DON'T
      // swap the skin yet. The actual swap happens in the next step so the
      // user first reads "click here", then sees the result.
      const hud = await ctOpenTokenHUDWithIcons();
      const skinIcon = hud?.querySelector(".beneos-tour-fake-skin");
      if (skinIcon) {
        skinIcon.id = skinIcon.id || "beneos-tour-skin-anchor";
        this._applySpotlight(skinIcon, 10);
        this._trySelector("#" + skinIcon.id);
      } else {
        const coords = { x: 2710 - 80, y: 1744 - 80, w: 440, h: 440 };
        this._createCanvasMarker({ ...coords, id: "ct-skin-switch", highlight: true });
        this._trySelector("#beneos-tour-marker-ct-skin-switch");
      }
    }

    if (stepId === "ct-skin-alternate") {
      document.body.classList.add("beneos-no-fade");
      // NOW swap to Skin 2 — clear HUD first so the texture-update token re-
      // render doesn't fight the open HUD.
      try { canvas.hud?.token?.close?.(); } catch (e) {}
      try { await ctSwapRotCerfTexture("184-rot_cerf-2-token.webp"); } catch (e) {}
      await new Promise(r => setTimeout(r, 350));
      ctCenterAnchor("ct-skin-alternate");
    }

    if (stepId === "ct-skin-switch-back") {
      document.body.classList.add("beneos-no-fade");
      // Just swap back to Skin 1 — no HUD, no spotlight, full-canvas visible
      try { canvas.hud?.token?.close?.(); } catch (e) {}
      try { await ctSwapRotCerfTexture("184-rot_cerf-1-token.webp"); } catch (e) {}
      await new Promise(r => setTimeout(r, 250));
      // Place an invisible marker NEXT TO the creature so the tour box
      // appears beside the token (not at the top edge of the viewport).
      const coords = { x: 2710 + 120, y: 1744 - 40, w: 50, h: 200 };
      this._createCanvasMarker({ ...coords, id: "ct-skin-switch-back" });
      this._trySelector("#beneos-tour-marker-ct-skin-switch-back");
    }

    if (stepId === "ct-death-icon") {
      document.body.classList.add("beneos-no-fade");
      try { canvas.hud?.token?.close?.(); } catch (e) {}
      await this._panTo({ x: 2710 + 150, y: 1744 + 150, scale: 0.9, duration: 500, sound: false });
      // We're already on Skin 1 after ct-skin-switch-back — go straight to dead variant
      try {
        await ctSwapRotCerfTexture("184-rot_cerf-1-token_dead.webp");
        await new Promise(r => setTimeout(r, 400));
      } catch (e) {}
      // No highlight — the death-variant sprite is its own visual cue.
      const coords = { x: 2710 - 80, y: 1744 - 80, w: 440, h: 440 };
      this._createCanvasMarker({ ...coords, id: "ct-death-icon" });
      this._trySelector("#beneos-tour-marker-ct-death-icon");
    }

    if (stepId === "ct-death-icon-setting") {
      document.body.classList.add("beneos-no-fade");
      // Restore the original token texture
      try {
        const token = canvas.tokens?.placeables.find(t => t.actor?.name?.toLowerCase().includes("rot cerf"));
        if (token && this._savedRotCerfTexture) {
          await token.document.update({ "texture.src": this._savedRotCerfTexture });
          this._savedRotCerfTexture = null;
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (e) {}
      const coords = { x: 2710 - 80, y: 1744 - 80, w: 440, h: 440 };
      this._createCanvasMarker({ ...coords, id: "ct-death-icon-setting" });
      this._trySelector("#beneos-tour-marker-ct-death-icon-setting");
    }

    if (stepId === "ct-character-sheet") {
      document.body.classList.add("beneos-no-fade");
      try {
        const actor = game.actors.get("q5thcJTwfi7uHZLA")
                   ?? game.actors.find(a => a.name.toLowerCase().includes("rot cerf"));
        if (actor) {
          await actor.sheet.render(true);
          this._openedJournals.push("__sheet:" + actor.id);
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 800));
      this._trySelector('.dnd5e.sheet.actor') ||
        this._trySelector('.actor.sheet') ||
        this._trySelector('.app[class*="actor"]');
    }

    if (stepId === "ct-design-philosophy") {
      document.body.classList.add("beneos-no-fade");
      this._trySelector('.dnd5e.sheet.actor') ||
        this._trySelector('.actor.sheet') ||
        this._trySelector('.app[class*="actor"]');
    }

    // Helper: scroll the DnD5e NPC sheet to a given fraction of its height.
    // The real scrollable container on NPC sheets is `.sheet-body` (overflow:hidden auto).
    const ctScrollSheet = (sheetEl, fraction) => {
      const candidates = [
        '.dnd5e2.sheet.actor.npc .sheet-body',
        '.sheet-body',
        '.tab[data-tab="biography"] .editor-container',
        '.tab[data-tab="biography"]',
        '.window-content'
      ];
      for (const sel of candidates) {
        const el = sheetEl?.matches?.(sel) ? sheetEl : sheetEl?.querySelector(sel);
        if (el && el.scrollHeight > el.clientHeight + 20) {
          el.scrollTop = el.scrollHeight * fraction;
          return el;
        }
      }
      return null;
    };

    if (stepId === "ct-biography-tactical") {
      document.body.classList.add("beneos-no-fade");
      // Click Biography tab + scroll to the Tactical Guide
      try {
        const actor = game.actors.get("q5thcJTwfi7uHZLA")
                   ?? game.actors.find(a => a.name.toLowerCase().includes("rot cerf"));
        if (actor?.sheet?.rendered) {
          const sheetEl = actor.sheet.element?.[0] || actor.sheet.element;
          // DnD5e 5.x ApplicationV2 — changeTab() is the reliable API (DOM .click() does nothing)
          try { actor.sheet.changeTab("biography", "primary"); } catch (e) {
            // Fallback to DOM click for older sheet versions
            try { sheetEl?.querySelector('nav.tabs [data-tab="biography"]')?.click(); } catch (e2) {}
          }
          await new Promise(r => setTimeout(r, 500));
          // Scroll so the Tactical Guide heading image is near the top
          const scrollBox = ctScrollSheet(sheetEl, 0.45);
          const guideImg = sheetEl?.querySelector('img[src*="guide_tactical_guide.webp"]');
          if (scrollBox && guideImg) {
            const scrollRect = scrollBox.getBoundingClientRect();
            const imgRect = guideImg.getBoundingClientRect();
            scrollBox.scrollTop += (imgRect.top - scrollRect.top) - 12;
          }
          await new Promise(r => setTimeout(r, 200));
          if (scrollBox) {
            scrollBox.id = scrollBox.id || "beneos-tour-bio-scroll";
            this._trySelector("#" + scrollBox.id);
            return;
          }
          const bioTab = sheetEl?.querySelector('.tab[data-tab="biography"]');
          if (bioTab) {
            bioTab.id = bioTab.id || "beneos-tour-bio-tab";
            this._trySelector("#" + bioTab.id);
            return;
          }
        }
      } catch (e) {}
      this._trySelector('.dnd5e.sheet.actor') ||
        this._trySelector('.actor.sheet') ||
        this._trySelector('.app[class*="actor"]');
    }

    if (stepId === "ct-tactical-detail") {
      document.body.classList.add("beneos-no-fade");
      // Scroll further down into the Tactical Guide
      try {
        const actor = game.actors.get("q5thcJTwfi7uHZLA")
                   ?? game.actors.find(a => a.name.toLowerCase().includes("rot cerf"));
        if (actor?.sheet?.rendered) {
          // Make sure we're still on biography in case the user flipped tabs
          try { actor.sheet.changeTab("biography", "primary"); } catch (e) {}
          await new Promise(r => setTimeout(r, 200));
          const sheetEl = actor.sheet.element?.[0] || actor.sheet.element;
          const scrolled = ctScrollSheet(sheetEl, 0.75);
          if (scrolled) {
            scrolled.id = scrolled.id || "beneos-tour-bio-scroll";
            this._trySelector("#" + scrolled.id);
            return;
          }
        }
      } catch (e) {}
      this._trySelector('.dnd5e.sheet.actor') ||
        this._trySelector('.actor.sheet') ||
        this._trySelector('.app[class*="actor"]');
    }

    // Helper: open the Rot Cerf journal in MULTIPLE-page view mode and navigate
    // to a given page without re-rendering. In Foundry V14, the view mode is
    // a private field (#mode) accessed via the public `isMultiple` getter.
    // We MUST pass mode via render() options — setting _viewMode directly is
    // a no-op because the private field isn't accessible.
    //
    // In MULTIPLE mode, `goToPage()` uses scrollIntoView() on the already-rendered
    // page element → no flicker. In SINGLE mode, Foundry re-renders → flicker.
    const ctOpenJournalPage = async (pageId) => {
      const journal = game.journal.get("Dc3QiEyRe6H2aV8w");
      if (!journal) return null;
      const sheet = journal.sheet;
      // V14 value is JournalEntrySheet.VIEW_MODES.MULTIPLE = 2
      const MULTIPLE = sheet.constructor?.VIEW_MODES?.MULTIPLE ?? 2;

      if (!sheet.rendered) {
        await sheet.render(true, { pageId, mode: MULTIPLE });
        this._openedJournals.push("Dc3QiEyRe6H2aV8w");
        await new Promise(r => setTimeout(r, 500));
        return sheet;
      }
      // Already rendered — if already in MULTIPLE mode, just scroll (no flicker)
      if (sheet.isMultiple && typeof sheet.goToPage === "function") {
        try { sheet.goToPage(pageId); } catch (e) {}
        await new Promise(r => setTimeout(r, 200));
        return sheet;
      }
      // Otherwise switch mode (this does re-render once, but subsequent calls won't)
      await sheet.render(true, { pageId, mode: MULTIPLE });
      await new Promise(r => setTimeout(r, 300));
      return sheet;
    };

    if (stepId === "ct-journal-open") {
      // Close the actor sheet and open the creature journal on the first page
      try {
        const actor = game.actors.get("q5thcJTwfi7uHZLA")
                   ?? game.actors.find(a => a.name.toLowerCase().includes("rot cerf"));
        if (actor?.sheet?.rendered) actor.sheet.close();
      } catch (e) {}
      await ctOpenJournalPage("a6628c70657b4c23");
      this._trySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
    }

    if (stepId === "ct-journal-fullbody") {
      await ctOpenJournalPage("a6628c70657b4c23");
      // Open the full-body ImagePopout right here so the user sees the art
      // at full size in this step (no need for a separate step to click).
      try {
        const journal = game.journal.get("Dc3QiEyRe6H2aV8w");
        const page = journal?.pages.get("a6628c70657b4c23");
        const PopoutCls = foundry.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;
        if (page?.src && PopoutCls && !this._imagePopout?.rendered) {
          this._imagePopout = new PopoutCls({
            src: page.src,
            caption: page.image?.caption,
            window: { title: page.name || "Rot Cerf" }
          });
          await this._imagePopout.render(true);
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {
        console.warn("Beneos Tutorial Tour | ImagePopout failed:", e);
      }
      // Anchor to the popout if opened, else the journal
      const popoutEl = this._imagePopout?.element?.[0] ?? this._imagePopout?.element
                    ?? document.querySelector('.image-popout, [class*="image-popout"]');
      if (popoutEl instanceof HTMLElement) {
        popoutEl.id = popoutEl.id || "beneos-tour-popout-anchor";
        this._trySelector("#" + popoutEl.id);
      } else {
        this._trySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
      }
    }

    // Helper: switch to Immersive Integration page (smooth) and scroll to an image anchor
    const ctJournalScrollTo = async (imageName) => {
      // Ensure any image popout opened by ct-journal-fullbody-popout is closed
      try { this._imagePopout?.close(); this._imagePopout = null; } catch (e) {}
      try {
        await ctOpenJournalPage("ca4b04404f7944bd");
        const journalWin = document.querySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
        const img = journalWin?.querySelector(`img[src*="${imageName}"]`)
                 ?? document.querySelector(`img[src*="${imageName}"]`);
        if (img) img.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {}
    };

    if (stepId === "ct-journal-lore") {
      await ctJournalScrollTo("journal_lore.webp");
      this._trySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
    }
    if (stepId === "ct-journal-story") {
      await ctJournalScrollTo("journal_story_prompts.webp");
      this._trySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
    }
    if (stepId === "ct-journal-foreshadowing") {
      await ctJournalScrollTo("journal_foreshadowing.webp");
      this._trySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
    }
    if (stepId === "ct-journal-before-combat") {
      await ctJournalScrollTo("journal_before_combat.webp");
      this._trySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
    }
    if (stepId === "ct-journal-during-combat") {
      await ctJournalScrollTo("journal_during_combat.webp");
      this._trySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
    }
    if (stepId === "ct-journal-death") {
      await ctJournalScrollTo("journal_death_prompt.webp");
      this._trySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
    }

    if (stepId === "ct-token-rotation") {
      document.body.classList.add("beneos-no-fade");
      // Close the journal so the canvas demonstration is unobstructed
      try { await this._closeOpenedJournals(); } catch (e) {}
      // Pan back to the token
      await this._panTo({ x: 2710 + 150, y: 1744 + 150, scale: 0.7, duration: 500, sound: false });
      // Move the Rot Cerf 3 squares to the right AND rotate 90° (270 in Foundry's
      // clockwise convention = 90° counter-clockwise visually). Foundry's auto-
      // rotate setting only triggers on user-initiated drags — programmatic
      // updates need to set rotation explicitly to demonstrate the effect.
      try {
        const token = canvas.tokens?.placeables.find(t => t.actor?.name?.toLowerCase().includes("rot cerf"));
        if (token) {
          const grid = canvas.scene?.grid?.size ?? canvas.dimensions?.size ?? 100;
          if (!this._savedRotCerfPos) {
            this._savedRotCerfPos = {
              x: token.document.x,
              y: token.document.y,
              rotation: token.document.rotation
            };
          }
          await token.document.update({
            x: token.document.x + 3 * grid,
            rotation: 270
          });
          await new Promise(r => setTimeout(r, 600));
        }
      } catch (e) {}
      // Invisible anchor near the new token position — the creature moves
      // around in the demo, so a visible frame would just be left behind.
      const coords = { x: 2710 + 3 * 100 - 80, y: 1744 - 80, w: 440, h: 440 };
      this._createCanvasMarker({ ...coords, id: "ct-token-rotation" });
      this._trySelector("#beneos-tour-marker-ct-token-rotation");
    }

    if (stepId === "ct-rotation-setting") {
      document.body.classList.add("beneos-no-fade");
      // Open Settings sidebar → Configure Settings.
      try {
        document.querySelector('[data-tab="settings"]')?.click();
        await new Promise(r => setTimeout(r, 400));
        document.querySelector('button[data-app="configure"]')?.click();
        await new Promise(r => setTimeout(r, 700));
      } catch (e) {}

      // Make sure the Core category is the active tab. On some installs the
      // dialog opens with a different tab pre-selected, which means the
      // search filter below has nothing to match against and the user sees
      // an empty highlight.
      try {
        const coreTab = document.querySelector('button[data-action="tab"][data-tab="core"]')
                     ?? document.querySelector('[data-tab="core"]')
                     ?? document.querySelector('button[data-category="core"]');
        if (coreTab) {
          coreTab.click();
          await new Promise(r => setTimeout(r, 250));
        }
      } catch (e) {}

      // Type into the built-in search filter — Foundry hides non-matching
      // .form-groups via the `hidden` attribute, leaving exactly one row visible.
      try {
        const search = document.querySelector('#settings-config-search-filter')
                    ?? document.querySelector('#settings-config input[type="search"]')
                    ?? document.querySelector('.application[id*="settings"] input[type="search"]');
        if (search) {
          search.value = "Automatic Token Rotation";
          search.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {}

      // The first non-hidden form-group is now the auto-rotate setting
      let target = null;
      try {
        const dialog = document.querySelector('#settings-config, .application[id*="settings"], .category-browser');
        target = (dialog ?? document).querySelector('.form-group:not([hidden]):not([data-bulk-actions])');
      } catch (e) {}

      if (target) {
        target.scrollIntoView({ behavior: "instant", block: "center" });
        await new Promise(r => setTimeout(r, 350));
        target.id = target.id || "beneos-tour-rotation-setting-anchor";
        this._applySpotlight(target, 10);
        this._trySelector("#" + target.id);
      } else {
        this._trySelector("#settings-config") || this._trySelector(".application[class*='settings']");
      }
    }

    if (stepId === "ct-creatures-complete") {
      // Close the journal + settings window + restore the moved token
      await this._closeOpenedJournals();
      try { game.settings.sheet?.close(); } catch (e) {}
      try {
        const chatTab = document.querySelector('[data-tab="chat"]');
        if (chatTab) chatTab.click();
      } catch (e) {}
      try {
        const token = canvas.tokens?.placeables.find(t => t.actor?.name?.toLowerCase().includes("rot cerf"));
        if (token && this._savedRotCerfPos) {
          await token.document.update(this._savedRotCerfPos);
          this._savedRotCerfPos = null;
        }
      } catch (e) {}
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600, sound: false });
        }
      } catch (e) {}
      ctCenterAnchor("ct-creatures-complete");
    }

    if (stepId === "ct-loot-spells-next") {
      document.body.classList.add("beneos-no-fade");
      // Last step of the Creatures tour — wrap-up + scene chain to Loot.
      // Slight zoom-in (≈1.3× the scene's default scale) for a more
      // dramatic closing shot compared to ct-creatures-complete's wide view.
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({
            x: initial.x,
            y: initial.y,
            scale: initial.scale * 1.3,
            duration: 800,
            sound: false
          });
        }
      } catch (e) {}
      ctCenterAnchor("ct-loot-spells-next");
    }

    // ===== Tour: tutorial-page-7-loot =====

    // Helper: anchor on the upper-third center of the canvas (intro/wrap-up steps)
    const ltCenterAnchor = (id) => {
      const d = canvas.dimensions;
      if (!d) return;
      const coords = {
        x: d.sceneX + d.sceneWidth / 2 - 250,
        y: d.sceneY + d.sceneHeight / 3 - 100,
        w: 500, h: 200
      };
      this._createCanvasMarker({ ...coords, id });
      this._trySelector(`#beneos-tour-marker-${id}`);
    };

    // Helper: pan to a box, bring its arrow tile(s) to the foreground, anchor
    // tour. NO spotlight — visual cue is the popping-up arrow tile.
    // Marker is a thin TOP strip (50px tall) so the tooltip docks consistently
    // at the top of every box (vertical position stays uniform across steps).
    const ltBox = async (id, coords, scale = 0.7, tileIds = null) => {
      await this._panTo({
        x: coords.x + coords.w / 2,
        y: coords.y + coords.h / 2,
        scale,
        duration: 600,
        sound: false
      });
      if (tileIds) {
        for (const tid of (Array.isArray(tileIds) ? tileIds : [tileIds])) {
          try { await this._bringTileToFront(tid); } catch (e) {}
        }
      }
      const TOP_DOCK_H = 50;
      this._createCanvasMarker({ x: coords.x, y: coords.y, w: coords.w, h: TOP_DOCK_H, id });
      this._trySelector(`#beneos-tour-marker-${id}`);
    };

    if (stepId === "lt-welcome") {
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await canvas.animatePan({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        }
      } catch (e) {}
      ltCenterAnchor("lt-welcome");
    }

    if (stepId === "lt-cards") {
      ltCenterAnchor("lt-cards");
    }

    // Box 1 — Item title
    if (stepId === "lt-title") {
      await ltBox("lt-title", { x: 1688, y: 1011, w: 448, h: 463 }, 0.7, "9wJE3bbBWIl2aAxi");
    }

    // Box 2 — Lore text
    if (stepId === "lt-lore") {
      await ltBox("lt-lore", { x: 1685, y: 1168, w: 448, h: 463 }, 0.7, "Y6nt3O1nEruAsLEQ");
    }

    // Box 3 — Mechanical features (x=1830 per user)
    if (stepId === "lt-features") {
      await ltBox("lt-features", { x: 1830, y: 1572, w: 448, h: 453 }, 0.7, "Et56kbh5uz689QWz");
    }

    // Box 4 — Footer (attunement + tier) (x=1830 per user)
    if (stepId === "lt-footer") {
      await ltBox("lt-footer", { x: 1830, y: 2096, w: 448, h: 463 }, 0.7, "bp1LAXQ5TrtrOWDP");
    }

    // Tier upgrade deep-dive — same box, same tier tile stays foregrounded
    if (stepId === "lt-tier-upgrade") {
      await ltBox("lt-tier-upgrade", { x: 1830, y: 2096, w: 448, h: 463 }, 0.7, "bp1LAXQ5TrtrOWDP");
    }

    // Box 5 — Gold price (corrected coords from user)
    if (stepId === "lt-price") {
      await ltBox("lt-price", { x: 2121, y: 2192, w: 448, h: 463 }, 0.7, "9kSgJOCwehCjKd21");
    }

    // Box 6 — Item Origin — TWO arrow tiles (corrected coords from user)
    // Steps 9, 10, 11 share the same box and arrow tiles → KEEP_TILES_FOREGROUNDED_AFTER
    // ensures the tiles stay visible across all three steps without flicker.
    if (stepId === "lt-origin") {
      await ltBox("lt-origin", { x: 3058, y: 2169, w: 448, h: 463 }, 0.7, ["d9tTsJPuHwmNxZm0", "Oghw8ydlqC3Sxdq3"]);
    }

    if (stepId === "lt-set-bonus") {
      // Tiles are already foregrounded from lt-origin (kept by KEEP_TILES_FOREGROUNDED_AFTER).
      // _bringTileToFront is idempotent so this no-ops if already up.
      await ltBox("lt-set-bonus", { x: 3058, y: 2169, w: 448, h: 463 }, 0.7, ["d9tTsJPuHwmNxZm0", "Oghw8ydlqC3Sxdq3"]);
    }

    if (stepId === "lt-origin-sense") {
      // LAST step in the origin sequence — _postStep WILL restore (not in the set)
      await ltBox("lt-origin-sense", { x: 3058, y: 2169, w: 448, h: 463 }, 0.7, ["d9tTsJPuHwmNxZm0", "Oghw8ydlqC3Sxdq3"]);
    }

    // Foundry view — open the actual item sheet for the demonstrated item
    if (stepId === "lt-foundry-view") {
      // Pan back to default view to reduce visual chaos
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600, sound: false });
        }
      } catch (e) {}
      // Open the item sheet (item ID supplied by the user)
      try {
        const item = game.items.get("6QYFmLk3ne0HNXZA");
        if (item) {
          await item.sheet.render(true);
          await new Promise(r => setTimeout(r, 600));
        }
      } catch (e) {
        console.warn("Beneos Tutorial Tour | Failed to open item sheet:", e);
      }
      // Anchor the tour to the item sheet window
      this._trySelector('.app[class*="item"], .item.sheet, [class*="item-sheet"], .dnd5e.sheet.item')
        || ltCenterAnchor("lt-foundry-view");
    }

    if (stepId === "lt-pdf-intro") {
      // Close the item sheet to make space for the journal
      try { game.items.get("6QYFmLk3ne0HNXZA")?.sheet?.close(); } catch (e) {}
      // Open the PDF-bearing journal at its PDF page in MULTIPLE view mode
      const journal = game.journal.get("SwQBW0GJYnCytpOp");
      if (journal) {
        const sheet = journal.sheet;
        const MULTIPLE = sheet.constructor?.VIEW_MODES?.MULTIPLE ?? 2;
        if (!sheet.rendered) {
          await sheet.render(true, { pageId: "ynFwzv7zDFTRz6AY", mode: MULTIPLE, expanded: false, collapsed: true });
          this._openedJournals.push("SwQBW0GJYnCytpOp");
          await new Promise(r => setTimeout(r, 600));
        } else {
          try { sheet.goToPage("ynFwzv7zDFTRz6AY"); } catch (e) {}
          await new Promise(r => setTimeout(r, 300));
        }
        this._collapseJournalSidebar(sheet);

        // Load the PDF. The JournalEntryPagePDFSheet renders the page in an
        // "unloaded" state with a <button data-action="loadPDF"> inside a
        // <div class="load-pdf"> wrapper. Clicking that button replaces the
        // wrapper with an iframe pointing at pdfjs/web/viewer.html (see
        // client/applications/sheets/journal/journal-entry-page-pdf-sheet.mjs
        // :87 _onLoadPDF). The tour needs that iframe to exist before the
        // next step (lt-pdf-page6) jumps to page 6.
        //
        // Strategy: poll for up to ~4s for the button to appear, click it,
        // and confirm an iframe was created. If the click path ever fails
        // (listener not attached yet, button disabled, etc.), replicate
        // _onLoadPDF manually so the PDF is guaranteed to load.
        let pdfLoaded = false;
        for (let i = 0; i < 20 && !pdfLoaded; i++) {
          const pdfPage = document.querySelector('.journal-entry-page[data-page-id="ynFwzv7zDFTRz6AY"]');
          if (pdfPage) {
            if (pdfPage.querySelector("iframe")) { pdfLoaded = true; break; }
            const btn = pdfPage.querySelector('button[data-action="loadPDF"]');
            if (btn && !btn.disabled) {
              try { btn.click(); } catch (e) {}
              await new Promise(r => setTimeout(r, 400));
              if (pdfPage.querySelector("iframe")) { pdfLoaded = true; break; }
            }
          }
          await new Promise(r => setTimeout(r, 200));
        }
        if (!pdfLoaded) {
          try {
            const page = journal.pages.get("ynFwzv7zDFTRz6AY");
            const loader = document.querySelector('.journal-entry-page[data-page-id="ynFwzv7zDFTRz6AY"] .load-pdf');
            if (loader && page?.src) {
              let src;
              try { new URL(page.src); src = page.src; }
              catch { src = foundry.utils.getRoute(page.src); }
              const params = new URLSearchParams();
              params.append("file", src);
              const frame = document.createElement("iframe");
              frame.src = `scripts/pdfjs/web/viewer.html?${params}`;
              loader.replaceWith(frame);
            }
          } catch (e) { console.warn("Beneos Tour | PDF manual load fallback failed:", e); }
        }
        // Wait for PDF.js to initialize, then force page 1 (PDF viewers can
        // restore the last-viewed page from localStorage — we always want the
        // intro step to land on the first page).
        try {
          for (let i = 0; i < 20; i++) {
            const iframe = document.querySelector('.journal-entry-page[data-page-id="ynFwzv7zDFTRz6AY"] iframe')
                        ?? document.querySelector('.journal-entry-sheet iframe');
            const app = iframe?.contentWindow?.PDFViewerApplication;
            if (app?.pdfDocument) {
              try { app.page = 1; } catch (e) {}
              break;
            }
            await new Promise(r => setTimeout(r, 250));
          }
        } catch (e) {}
      }
      this._trySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
    }

    if (stepId === "lt-pdf-page6") {
      // Wait for the PDF.js viewer iframe to be ready, then jump to page 4
      // (the origin-mechanic page). Step id kept as "lt-pdf-page6" to avoid
      // churning the step list / locale keys.
      try {
        for (let i = 0; i < 20; i++) {
          const iframe = document.querySelector('.journal-entry-page[data-page-id="ynFwzv7zDFTRz6AY"] iframe')
                      ?? document.querySelector('.journal-entry-sheet iframe');
          const app = iframe?.contentWindow?.PDFViewerApplication;
          if (app?.pdfDocument) {
            try { app.page = 4; } catch (e) {}
            break;
          }
          await new Promise(r => setTimeout(r, 250));
        }
      } catch (e) {}
      this._trySelector('.journal-entry-sheet, .journal-sheet, .app[class*="journal"]');
    }

    if (stepId === "lt-item-folder") {
      // Close the PDF journal from the previous steps (item sheet was already
      // closed in lt-pdf-intro). Open the Items sidebar and expand the
      // Beneos Items folder so the user can browse other downloads.
      try { game.journal.get("SwQBW0GJYnCytpOp")?.sheet?.close(); } catch (e) {}
      try {
        const itemsTab = document.querySelector('[data-tab="items"]');
        if (itemsTab) itemsTab.click();
        await new Promise(r => setTimeout(r, 400));
      } catch (e) {}
      let folderEl = null;
      try { folderEl = await _expandSidebarFolder("QwWs3EOaJUZSYs27"); } catch (e) {}
      if (folderEl) {
        folderEl.id = folderEl.id || "beneos-tour-items-folder-anchor";
        this._trySelector("#" + folderEl.id);
        return;
      }
      // Fallback — anchor to the items sidebar tab
      this._trySelector('[data-tab="items"]') || ltCenterAnchor("lt-item-folder");
    }

    if (stepId === "lt-loot-complete") {
      // Close the item sheet from earlier steps, then pan to default view
      try { game.items.get("6QYFmLk3ne0HNXZA")?.sheet?.close(); } catch (e) {}
      // Switch sidebar back to chat for the wrap-up
      try {
        const chatTab = document.querySelector('[data-tab="chat"]');
        if (chatTab) chatTab.click();
      } catch (e) {}
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600, sound: false });
        }
      } catch (e) {}
      ltCenterAnchor("lt-loot-complete");
    }

    // ===== Tour: tutorial-page-8-spells =====

    const spCenterAnchor = (id) => {
      const d = canvas.dimensions;
      if (!d) return;
      const coords = {
        x: d.sceneX + d.sceneWidth / 2 - 250,
        y: d.sceneY + d.sceneHeight / 3 - 100,
        w: 500, h: 200
      };
      this._createCanvasMarker({ ...coords, id });
      this._trySelector(`#beneos-tour-marker-${id}`);
    };

    const spBox = async (id, coords, scale = 0.6) => {
      await this._panTo({
        x: coords.x + coords.w / 2,
        y: coords.y + coords.h / 2,
        scale,
        duration: 600,
        sound: false
      });
      const TOP_DOCK_H = 50;
      this._createCanvasMarker({ x: coords.x, y: coords.y, w: coords.w, h: TOP_DOCK_H, id });
      this._trySelector(`#beneos-tour-marker-${id}`);
    };

    if (stepId === "sp-welcome") {
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await canvas.animatePan({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        }
      } catch (e) {}
      spCenterAnchor("sp-welcome");
    }

    // Main box — both card faces visible, design-philosophy step
    if (stepId === "sp-card") {
      await spBox("sp-card", { x: 1952, y: 1003, w: 1981, h: 1306 }, 0.4);
    }

    // Front side of the card (coords per user — same as main box)
    if (stepId === "sp-front") {
      await spBox("sp-front", { x: 1952, y: 1003, w: 1981, h: 1306 }, 0.4);
    }

    // Back side of the card (coords per user — same as main box)
    if (stepId === "sp-back") {
      await spBox("sp-back", { x: 1952, y: 1003, w: 1981, h: 1306 }, 0.4);
    }

    // Zoom into the small spell icon (school + level pips)
    if (stepId === "sp-icon") {
      await spBox("sp-icon", { x: 3322, y: 2005, w: 194, h: 219 }, 1.8);
    }

    if (stepId === "sp-monsters") {
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600, sound: false });
        }
      } catch (e) {}
      spCenterAnchor("sp-monsters");
    }

    // Foundry view — open the spell folder in the Items sidebar and the demo spell sheet
    if (stepId === "sp-foundry-view") {
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600, sound: false });
        }
      } catch (e) {}
      try {
        const itemsTab = document.querySelector('[data-tab="items"]');
        if (itemsTab) itemsTab.click();
        await new Promise(r => setTimeout(r, 400));
      } catch (e) {}
      try { await _expandSidebarFolder("uSlobekchaKd4hrL"); } catch (e) {}
      try {
        const spell = game.items.get("2iY3M4R5kl1aFPub");
        if (spell) {
          await spell.sheet.render(true);
          await new Promise(r => setTimeout(r, 600));
        }
      } catch (e) { console.warn("Beneos Tour | Failed to open spell sheet:", e); }
      this._trySelector('.app[class*="item"], .item.sheet, [class*="item-sheet"], .dnd5e.sheet.item')
        || spCenterAnchor("sp-foundry-view");
    }

    if (stepId === "sp-complete") {
      // Close the demo spell sheet from sp-foundry-view
      try { game.items.get("2iY3M4R5kl1aFPub")?.sheet?.close(); } catch (e) {}
      try {
        const chatTab = document.querySelector('[data-tab="chat"]');
        if (chatTab) chatTab.click();
      } catch (e) {}
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600, sound: false });
        }
      } catch (e) {}
      spCenterAnchor("sp-complete");
    }

    // ===== Tour: tutorial-page-9-contacts =====

    const fnCenterAnchor = (id) => {
      const d = canvas.dimensions;
      if (!d) return;
      const coords = {
        x: d.sceneX + d.sceneWidth / 2 - 250,
        y: d.sceneY + d.sceneHeight / 3 - 100,
        w: 500, h: 200
      };
      this._createCanvasMarker({ ...coords, id });
      this._trySelector(`#beneos-tour-marker-${id}`);
    };

    // Pan to an invisible highlight box and dock the tour marker to its full
    // bounds. The tooltip renders to the RIGHT of the box (see step list
    // below), so these coords define where the tooltip appears.
    const fnHighlight = async (id, coords, scale = 0.7) => {
      await this._panTo({
        x: coords.x + coords.w / 2,
        y: coords.y + coords.h / 2,
        scale,
        duration: 600,
        sound: false
      });
      this._createCanvasMarker({ ...coords, id });
      this._trySelector(`#beneos-tour-marker-${id}`);
    };

    if (stepId === "fn-welcome") {
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await canvas.animatePan({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600 });
        }
      } catch (e) {}
      fnCenterAnchor("fn-welcome");
    }
    if (stepId === "fn-dungeon") await fnHighlight("fn-dungeon", { x: 3250, y: 1038, w: 638, h: 75 });
    if (stepId === "fn-cloud")   await fnHighlight("fn-cloud",   { x: 3300, y: 1138, w: 588, h: 75 });
    if (stepId === "fn-search")  await fnHighlight("fn-search",  { x: 3450, y: 1238, w: 438, h: 75 });
    if (stepId === "fn-discord") await fnHighlight("fn-discord", { x: 3246, y: 1332, w: 638, h: 75 });

    if (stepId === "fn-farewell") {
      // Stop the Contacts scene's own env sound (K5R….xqoL…) so the reward
      // video has the mix. _runFarewellVideoSequence starts the post-video
      // ambient (7031….7ecc…) after the cinematic ends.
      this._stopFarewellMusic();
      try {
        const initial = canvas.scene?.initial;
        if (initial && Number.isFinite(initial.x) && Number.isFinite(initial.y) && Number.isFinite(initial.scale)) {
          await this._panTo({ x: initial.x, y: initial.y, scale: initial.scale, duration: 600, sound: false });
        }
      } catch (e) {}
      fnCenterAnchor("fn-farewell");
    }

    // Future per-scene tour step IDs go here.
  }
}

/* ================================================================== */
/*  Tour Registration                                                  */
/* ================================================================== */

/**
 * Block external code from hijacking the tour's #tooltip element during a
 * tour. The actual offenders are Foundry's PlaylistDirectory volume sliders
 * (client/applications/sidebar/tabs/playlist-directory.mjs:595 & 727): every
 * slider input event calls `game.tooltip.activate(slider, {text: "X%"})`.
 * That call replaces the tour step's innerHTML, drops the "tour" cssClass,
 * and repositions the popover next to the slider — so from the user's
 * perspective the tour box vanishes.
 *
 * The Tour base class (client/nue/tour.mjs:480) always activates its step
 * with `cssClass: "tour themed theme-dark"`, which we use as the whitelist
 * signal: only activations whose cssClass contains "tour" are allowed while
 * a tour is running; anything else is silently dropped.
 *
 * dismissLockedTooltips is stubbed as defence-in-depth (tours don't use
 * locked tooltips, but stubbing is harmless).
 */
function _installTourTooltipGuard(tour) {
  if (!game.tooltip || tour._tourGuardInstalled) return;
  if (typeof game.tooltip.activate === "function") {
    tour._origActivateTour = game.tooltip.activate.bind(game.tooltip);
    game.tooltip.activate = (element, options = {}) => {
      const cssClass = String(options?.cssClass ?? "");
      if (cssClass.includes("tour")) return tour._origActivateTour(element, options);
      // External activation (playlist volume slider, etc.) — ignored so the
      // tour box stays put. Percentage tooltips resume once the tour exits.
    };
  }
  if (typeof game.tooltip.dismissLockedTooltips === "function") {
    tour._origDismissLockedTour = game.tooltip.dismissLockedTooltips.bind(game.tooltip);
    game.tooltip.dismissLockedTooltips = () => {};
  }
  tour._tourGuardInstalled = true;
}

/**
 * Ensure a sidebar folder is expanded. V14's ApplicationV2 sidebar uses the
 * class `expanded` on the folder `<li>` (not `collapsed`) and persists state
 * via `game.folders._expanded[uuid]` (see
 * client/applications/sidebar/document-directory.mjs:627-631).
 */
async function _expandSidebarFolder(folderId) {
  const folderEl = document.querySelector(`.directory-item.folder[data-folder-id="${folderId}"]`)
                ?? document.querySelector(`[data-folder-id="${folderId}"]`);
  if (!folderEl) return null;
  if (!folderEl.classList.contains("expanded")) {
    const header = folderEl.querySelector(".folder-header") ?? folderEl;
    try { header.click(); } catch (e) {}
    // Fallback: set state directly in case the click handler was missed.
    if (!folderEl.classList.contains("expanded")) {
      folderEl.classList.add("expanded");
      try {
        const uuid = folderEl.dataset.uuid;
        if (uuid && game.folders?._expanded) game.folders._expanded[uuid] = true;
      } catch (e) {}
    }
    await new Promise(r => setTimeout(r, 300));
  }
  try { folderEl.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  return folderEl;
}

function _restoreTourTooltipGuard(tour) {
  if (!tour._tourGuardInstalled) return;
  try { if (tour._origActivateTour) game.tooltip.activate = tour._origActivateTour; } catch (e) {}
  try { if (tour._origDismissLockedTour) game.tooltip.dismissLockedTooltips = tour._origDismissLockedTour; } catch (e) {}
  tour._origActivateTour = null;
  tour._origDismissLockedTour = null;
  tour._tourGuardInstalled = false;
}

/**
 * Strip the "of Y" portion from the tour step counter so users see "Step X"
 * without the total. Foundry V14 renders the counter as
 * `<span class="progress">Step N of M</span>` (templates/apps/tour-step.html:17).
 * Showing the total intimidates users — they shouldn't worry about how many
 * steps remain. Applied to every Beneos tour after each step renders.
 */
function _hideTourStepOfY() {
  try {
    const containers = document.querySelectorAll('.tooltip.tour, .tour-center-step, .locked-tooltip, .tour');
    for (const container of containers) {
      const els = container.matches?.('span.progress')
        ? [container]
        : container.querySelectorAll('span.progress');
      for (const el of els) {
        const newTxt = (el.textContent || "")
          .replace(/(\d+)\s+of\s+\d+/gi, '$1')
          .replace(/(\d+)\s*\/\s*\d+/g, '$1');
        if (newTxt !== el.textContent) el.textContent = newTxt;
      }
    }
  } catch (e) {}
}

/**
 * Resolve localised title & content for every step from the language file.
 * Keys follow: BENEOS.Tour.{tourKey}.{PascalStepId}.Title / .Content
 * e.g. step id "bm-welcome" in tour key "Page2" → BENEOS.Tour.Page2.BmWelcome.Title
 */
function _localizeSteps(tourKey, steps) {
  return steps.map(step => {
    const pascal = step.id.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
    return {
      ...step,
      title: game.i18n.localize(`BENEOS.Tour.${tourKey}.${pascal}.Title`),
      content: game.i18n.localize(`BENEOS.Tour.${tourKey}.${pascal}.Content`)
    };
  });
}

/**
 * Manually load tour translations into game.i18n.translations.
 * This ensures the strings are available even when Foundry hasn't re-read
 * module.json (e.g. because the server hasn't been restarted after adding
 * the languages array). English is merged first as the base, then the
 * active language is merged on top so its translations win; keys missing
 * from the active language fall back to the English value.
 */
async function _loadTourTranslations() {
  const basePath = `modules/${MODULE_ID}/lang`;
  const lang = game.i18n.lang || "en";
  const filesToLoad = lang !== "en" ? [`${basePath}/en.json`, `${basePath}/${lang}.json`] : [`${basePath}/en.json`];
  for (const path of filesToLoad) {
    try {
      const resp = await fetch(path);
      if (!resp.ok) continue;
      const json = await resp.json();
      const expanded = foundry.utils.expandObject(json);
      foundry.utils.mergeObject(game.i18n.translations, expanded, { inplace: true });
    } catch (e) { /* language file not available — skip */ }
  }
}

Hooks.once("setup", async () => {
  await _loadTourTranslations();

  /* ---- Phase 1: Setup Tour ---- */
  game.tours.register(MODULE_ID, "setup", new BeneosSetupTour({
    namespace: MODULE_ID,
    id: "setup",
    title: game.i18n.localize("BENEOS.Tour.Setup.Title"),
    description: game.i18n.localize("BENEOS.Tour.Setup.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    steps: _localizeSteps("Setup", [
      { id: "welcome-intro", selector: "", tooltipDirection: "CENTER" },
      { id: "setup-languages", selector: "", tooltipDirection: "CENTER" },
      { id: "mou-toolbar", selector: `button[data-control="moulinette"]`, tooltipDirection: "RIGHT" },
      { id: "mou-tools", selector: "", tooltipDirection: "RIGHT" },
      { id: "mou-auth-open", selector: "", tooltipDirection: "RIGHT" },
      { id: "mou-auth-explain", selector: "", tooltipDirection: "RIGHT" },
      { id: "mou-browser-open", selector: "", tooltipDirection: "RIGHT" },
      { id: "mou-browser-creator", selector: "", tooltipDirection: "RIGHT" },
      { id: "mou-browser-pack", selector: "", tooltipDirection: "RIGHT" },
      { id: "mou-install-pack", selector: "", tooltipDirection: "RIGHT" },
      { id: "mou-scenepacker", selector: "", tooltipDirection: "UP" },
      { id: "setup-complete", selector: "", tooltipDirection: "CENTER" }
    ])
  }));

  /* ---- Phase 2: Beneos Search Engine Tour ---- */
  game.tours.register(MODULE_ID, "demo", new BeneosDemoTour({
    namespace: MODULE_ID,
    id: "demo",
    title: game.i18n.localize("BENEOS.Tour.Demo.Title"),
    description: game.i18n.localize("BENEOS.Tour.Demo.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    suggestedNextTours: [`${MODULE_ID}.tutorial-start-here`],
    steps: _localizeSteps("Demo", [
      { id: "demo-intro", selector: "", tooltipDirection: "CENTER" },
      { id: "demo-actors-tab", selector: "", tooltipDirection: "LEFT" },
      { id: "demo-actors-button", selector: "", tooltipDirection: "LEFT" },
      { id: "demo-beneos-cloud", selector: "", tooltipDirection: "RIGHT" },
      { id: "demo-search-overview", selector: "", tooltipDirection: "RIGHT" },
      { id: "demo-maps-tab", selector: "", tooltipDirection: "DOWN" },
      { id: "demo-maps-filters", selector: "", tooltipDirection: "RIGHT" },
      { id: "demo-maps-download", selector: "", tooltipDirection: "RIGHT" },
      { id: "demo-complete", selector: "", tooltipDirection: "CENTER" }
    ])
  }));

  /* ---- Phase 3: Per-Scene Tutorial Tours ---- */

  // Tour: tutorial-start-here — auto-starts on Scene.0A8yWjm42oAg0vnw ("Start Here")
  game.tours.register(MODULE_ID, "tutorial-start-here", new BeneosTutorialSceneTour({
    namespace: MODULE_ID,
    id: "tutorial-start-here",
    title: game.i18n.localize("BENEOS.Tour.StartHere.Title"),
    description: game.i18n.localize("BENEOS.Tour.StartHere.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    noFade: true,
    nextSceneId: "7C7jvaaI3W1gFFZ3",
    steps: _localizeSteps("StartHere", [
      { id: "start-welcome", selector: "", tooltipDirection: "RIGHT" },
      { id: "start-explainer", selector: "", tooltipDirection: "CENTER" },
      { id: "start-languages", selector: "", tooltipDirection: "CENTER" },
      { id: "start-battlemaps-info", selector: "", tooltipDirection: "LEFT" },
      { id: "start-tokens-info", selector: "", tooltipDirection: "RIGHT" },
      { id: "start-continue", selector: "", tooltipDirection: "CENTER" }
    ])
  }));

  // Tour: tutorial-page-1-overview — auto-starts on Scene.7C7jvaaI3W1gFFZ3 ("Page 1: Overview")
  game.tours.register(MODULE_ID, "tutorial-page-1-overview", new BeneosTutorialSceneTour({
    namespace: MODULE_ID,
    id: "tutorial-page-1-overview",
    title: game.i18n.localize("BENEOS.Tour.Page1.Title"),
    description: game.i18n.localize("BENEOS.Tour.Page1.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    nextSceneId: "M0uzfpdYcLJveveu",
    steps: _localizeSteps("Page1", [
      { id: "p1-welcome", selector: "", tooltipDirection: "LEFT" },
      { id: "p1-pin-notice", selector: "", tooltipDirection: "UP" },
      { id: "p1-pin-activate", selector: "", tooltipDirection: "RIGHT" },
      { id: "p1-pin-activated", selector: "", tooltipDirection: "UP" },
      { id: "p1-teleporters", selector: "", tooltipDirection: "RIGHT" },
      { id: "p1-navbar-intro", selector: "", tooltipDirection: "UP" },
      { id: "p1-intro-icon", selector: "", tooltipDirection: "UP" },
      { id: "p1-regional", selector: "", tooltipDirection: "UP" },
      { id: "p1-lore", selector: "", tooltipDirection: "UP" },
      { id: "p1-lore-journal", selector: "", tooltipDirection: "RIGHT" },
      { id: "p1-help", selector: "", tooltipDirection: "UP" },
      { id: "p1-help-journal", selector: "", tooltipDirection: "LEFT" },
      { id: "p1-compass", selector: "", tooltipDirection: "UP" },
      { id: "p1-summary", selector: "", tooltipDirection: "CENTER" },
      { id: "p1-continue", selector: "", tooltipDirection: "LEFT" }
    ])
  }));

  // Tour: tutorial-page-2-battlemaps — auto-starts on Scene.M0uzfpdYcLJveveu ("Page 2: Battlemaps")
  game.tours.register(MODULE_ID, "tutorial-page-2-battlemaps", new BeneosTutorialSceneTour({
    namespace: MODULE_ID,
    id: "tutorial-page-2-battlemaps",
    title: game.i18n.localize("BENEOS.Tour.Page2.Title"),
    description: game.i18n.localize("BENEOS.Tour.Page2.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    nextSceneId: "oQFWGxrKGYbhsE22",
    steps: _localizeSteps("Page2", [
      { id: "bm-welcome", selector: "", tooltipDirection: "CENTER" },
      { id: "bm-navbar-intro", selector: "", tooltipDirection: "UP" },
      { id: "bm-overview-teleporter", selector: "", tooltipDirection: "UP" },
      { id: "bm-region-world", selector: "", tooltipDirection: "UP" },
      { id: "bm-scenery-link", selector: "", tooltipDirection: "UP" },
      { id: "bm-handouts", selector: "", tooltipDirection: "UP" },
      { id: "bm-handout-1", selector: "", tooltipDirection: "LEFT" },
      { id: "bm-handout-2", selector: "", tooltipDirection: "LEFT" },
      { id: "bm-share-image", selector: "", tooltipDirection: "UP" },
      { id: "bm-navigation-recap", selector: "", tooltipDirection: "CENTER" },
      { id: "bm-player-navigators", selector: "", tooltipDirection: "UP" },
      { id: "bm-player-icon", selector: "", tooltipDirection: "UP" },
      { id: "bm-player-field", selector: "", tooltipDirection: "UP" },
      { id: "bm-player-field-moved", selector: "", tooltipDirection: "UP" },
      { id: "bm-follow-players", selector: "", tooltipDirection: "LEFT" },
      { id: "bm-teleport-destination", selector: "", tooltipDirection: "UP" },
      { id: "bm-pause-mlt", selector: "", tooltipDirection: "DOWN" },
      { id: "bm-pause-mlt-settings", selector: "", tooltipDirection: "DOWN" },
      { id: "bm-overlay-tiles", selector: "", tooltipDirection: "DOWN" },
      { id: "bm-obstacles", selector: "", tooltipDirection: "UP" },
      { id: "bm-foreground-tiles", selector: "", tooltipDirection: "UP" },
      { id: "bm-complete", selector: "", tooltipDirection: "CENTER" },
      { id: "bm-scenery-next", selector: "", tooltipDirection: "LEFT" }
    ])
  }));

  // Tour: tutorial-page-3-sceneries — auto-starts on Scene.oQFWGxrKGYbhsE22 ("Page 3: Sceneries")
  game.tours.register(MODULE_ID, "tutorial-page-3-sceneries", new BeneosTutorialSceneTour({
    namespace: MODULE_ID,
    id: "tutorial-page-3-sceneries",
    title: game.i18n.localize("BENEOS.Tour.Page3.Title"),
    description: game.i18n.localize("BENEOS.Tour.Page3.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    noFade: true,
    nextSceneId: "sBm7NH23HJ2gv6lA",
    steps: _localizeSteps("Page3", [
      { id: "sc-welcome", selector: "", tooltipDirection: "DOWN" },
      { id: "sc-welcome-2", selector: "", tooltipDirection: "DOWN" },
      { id: "sc-navbar", selector: "", tooltipDirection: "UP" },
      { id: "sc-battlemap-teleporter", selector: "", tooltipDirection: "UP" },
      { id: "sc-static-maps", selector: "", tooltipDirection: "DOWN" },
      { id: "sc-static-freeze", selector: "", tooltipDirection: "CENTER" },
      { id: "sc-next-intro", selector: "", tooltipDirection: "DOWN" }
    ])
  }));

  // Tour: tutorial-page-4-intro — auto-starts on Scene.sBm7NH23HJ2gv6lA ("Page 4: Intro Sequences")
  game.tours.register(MODULE_ID, "tutorial-page-4-intro", new BeneosTutorialSceneTour({
    namespace: MODULE_ID,
    id: "tutorial-page-4-intro",
    title: game.i18n.localize("BENEOS.Tour.Page4.Title"),
    description: game.i18n.localize("BENEOS.Tour.Page4.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    noFade: true,
    nextSceneId: "HNcl2IS9T6JuFxL6",
    steps: _localizeSteps("Page4", [
      { id: "intro-welcome", selector: "", tooltipDirection: "DOWN" },
      { id: "intro-start-button", selector: "", tooltipDirection: "UP" },
      { id: "intro-token-control", selector: "", tooltipDirection: "RIGHT" },
      { id: "intro-play", selector: "", tooltipDirection: "DOWN" },
      { id: "intro-use-freely", selector: "", tooltipDirection: "DOWN" },
      { id: "intro-manual-start", selector: "", tooltipDirection: "DOWN" },
      { id: "intro-tile-controls", selector: "", tooltipDirection: "RIGHT" },
      { id: "intro-right-click-tile", selector: "", tooltipDirection: "RIGHT" },
      { id: "intro-complete", selector: "", tooltipDirection: "CENTER" }
    ])
  }));

  // Tour: tutorial-page-5-world-map — auto-starts on Scene.HNcl2IS9T6JuFxL6 ("Page 5: World Map")
  game.tours.register(MODULE_ID, "tutorial-page-5-world-map", new BeneosTutorialSceneTour({
    namespace: MODULE_ID,
    id: "tutorial-page-5-world-map",
    title: game.i18n.localize("BENEOS.Tour.Page5.Title"),
    description: game.i18n.localize("BENEOS.Tour.Page5.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    // noFade omitted: the default dark tour fadeout is back for this tour
    nextSceneId: "u0wKs5Gmwgqr8NK0", // Page 6: Creatures
    steps: _localizeSteps("Page5", [
      { id: "wm-welcome", selector: "", tooltipDirection: "DOWN" },
      { id: "wm-escalian", selector: "", tooltipDirection: "UP" },
      { id: "wm-city-tiles", selector: "", tooltipDirection: "UP" },
      { id: "wm-campaign", selector: "", tooltipDirection: "DOWN" },
      { id: "wm-continents", selector: "", tooltipDirection: "LEFT" },
      { id: "wm-dowercrag", selector: "", tooltipDirection: "RIGHT" },
      { id: "wm-example", selector: "", tooltipDirection: "DOWN" },
      { id: "wm-tutorial-complete", selector: "", tooltipDirection: "CENTER" }
    ])
  }));

  // Tour: tutorial-page-6-creatures — auto-starts on Scene.u0wKs5Gmwgqr8NK0 ("Page 6: Creatures")
  game.tours.register(MODULE_ID, "tutorial-page-6-creatures", new BeneosTutorialSceneTour({
    namespace: MODULE_ID,
    id: "tutorial-page-6-creatures",
    title: game.i18n.localize("BENEOS.Tour.Page6.Title"),
    description: game.i18n.localize("BENEOS.Tour.Page6.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    noFade: true,
    nextSceneId: "B0h1UkhCXoKatFx4",  // Page 7: Loot
    steps: _localizeSteps("Page6", [
      { id: "ct-welcome", selector: "", tooltipDirection: "DOWN" },
      { id: "ct-actor-directory", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-cloud-open", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-cloud-account", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-categories", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-filter-biome", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-filter-campaign", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-filter-type", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-filter-faction", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-filter-fighting", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-filter-purpose", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-search-intro", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-search-rotcerf", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-search-install", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-place-token", selector: "", tooltipDirection: "DOWN" },
      { id: "ct-context-menu", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-skin-switch", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-skin-alternate", selector: "", tooltipDirection: "DOWN" },
      { id: "ct-skin-switch-back", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-death-icon", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-death-icon-setting", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-character-sheet", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-design-philosophy", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-biography-tactical", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-tactical-detail", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-journal-open", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-journal-fullbody", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-journal-lore", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-journal-story", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-journal-foreshadowing", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-journal-before-combat", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-journal-during-combat", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-journal-death", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-token-rotation", selector: "", tooltipDirection: "LEFT" },
      { id: "ct-rotation-setting", selector: "", tooltipDirection: "RIGHT" },
      { id: "ct-creatures-complete", selector: "", tooltipDirection: "CENTER" },
      { id: "ct-loot-spells-next", selector: "", tooltipDirection: "CENTER" }
    ])
  }));

  // Tour: tutorial-page-7-loot — auto-starts on Scene.B0h1UkhCXoKatFx4 ("Page 7: Loot")
  game.tours.register(MODULE_ID, "tutorial-page-7-loot", new BeneosTutorialSceneTour({
    namespace: MODULE_ID,
    id: "tutorial-page-7-loot",
    title: game.i18n.localize("BENEOS.Tour.Page7.Title"),
    description: game.i18n.localize("BENEOS.Tour.Page7.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    noFade: true,
    nextSceneId: "e8XNodRWUYixtEjd",  // Page 8: Spells
    steps: _localizeSteps("Page7", [
      { id: "lt-welcome", selector: "", tooltipDirection: "DOWN" },
      { id: "lt-cards", selector: "", tooltipDirection: "DOWN" },
      { id: "lt-title", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-lore", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-features", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-footer", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-tier-upgrade", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-price", selector: "", tooltipDirection: "RIGHT" },
      { id: "lt-origin", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-set-bonus", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-origin-sense", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-foundry-view", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-pdf-intro", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-pdf-page6", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-item-folder", selector: "", tooltipDirection: "LEFT" },
      { id: "lt-loot-complete", selector: "", tooltipDirection: "CENTER" }
    ])
  }));

  // Tour: tutorial-page-8-spells — auto-starts on Scene.e8XNodRWUYixtEjd ("Page 8: Spells")
  game.tours.register(MODULE_ID, "tutorial-page-8-spells", new BeneosTutorialSceneTour({
    namespace: MODULE_ID,
    id: "tutorial-page-8-spells",
    title: game.i18n.localize("BENEOS.Tour.Page8.Title"),
    description: game.i18n.localize("BENEOS.Tour.Page8.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    noFade: true,
    nextSceneId: "dWgZnsQYC2QDt7Kk",  // "Your next steps" contacts scene
    steps: _localizeSteps("Page8", [
      { id: "sp-welcome",       selector: "", tooltipDirection: "DOWN" },
      { id: "sp-card",          selector: "", tooltipDirection: "LEFT" },
      { id: "sp-front",         selector: "", tooltipDirection: "LEFT" },
      { id: "sp-back",          selector: "", tooltipDirection: "LEFT" },
      { id: "sp-icon",          selector: "", tooltipDirection: "LEFT" },
      { id: "sp-monsters",      selector: "", tooltipDirection: "DOWN" },
      { id: "sp-foundry-view",  selector: "", tooltipDirection: "LEFT" },
      { id: "sp-complete",      selector: "", tooltipDirection: "CENTER" }
    ])
  }));

  // Tour: tutorial-page-9-contacts — auto-starts on Scene.dWgZnsQYC2QDt7Kk (terminal)
  game.tours.register(MODULE_ID, "tutorial-page-9-contacts", new BeneosTutorialSceneTour({
    namespace: MODULE_ID,
    id: "tutorial-page-9-contacts",
    title: game.i18n.localize("BENEOS.Tour.Page9.Title"),
    description: game.i18n.localize("BENEOS.Tour.Page9.Desc"),
    display: true,
    canBeResumed: false,
    restricted: true,
    noFade: true,
    // Terminal tour — no nextSceneId.
    steps: _localizeSteps("Page9", [
      { id: "fn-welcome",  selector: "", tooltipDirection: "CENTER" },
      { id: "fn-dungeon",  selector: "", tooltipDirection: "RIGHT" },
      { id: "fn-cloud",    selector: "", tooltipDirection: "RIGHT" },
      { id: "fn-search",   selector: "", tooltipDirection: "RIGHT" },
      { id: "fn-discord",  selector: "", tooltipDirection: "RIGHT" },
      { id: "fn-farewell", selector: "", tooltipDirection: "CENTER" }
    ])
  }));

  /* ---- Contacts scene: make the 4 action drawings clickable ---- */
  //
  // On Scene.dWgZnsQYC2QDt7Kk ("Now it's your turn — your next steps") the
  // scene has four Drawing documents laid out like buttons. Foundry drawings
  // aren't clickable by default: `_onClickLeft` runs only when the user can
  // control the object. To make them act as buttons for GMs AND players, we
  // attach a pointerdown listener directly to each drawing's PIXI frame —
  // the frame already has `eventMode = "auto"` with a shape-based hitArea
  // (client/canvas/placeables/drawing.mjs:264-276), so hit testing works for
  // everyone. `stopPropagation()` prevents Foundry's default control path.
  const CONTACTS_SCENE_ID = "dWgZnsQYC2QDt7Kk";
  // Handlers keyed by SCENE ID → { TILE ID → handler }. Every tutorial scene
  // has at least one invisible tile on top of a decorative text box that
  // opens Moulinette pre-filtered to the relevant pack/creator/terms.
  // The Contacts scene additionally keeps its original four action-tile
  // handlers (Discord, beneos.cloud, Mega Dungeon download, Cloud search).
  const SCENE_TILE_HANDLERS = {
    // Contacts / Farewell scene — the 4 existing action tiles + the new
    // quick-download tile in the top-left.
    "dWgZnsQYC2QDt7Kk": {
      "yuRN7VDZ0bfcRhOx": () => openMoulinetteWithFilter({ creator: "Beneos Battlemaps", pack: "Modular Dungeon B - 63-64" }),
      "UbYZoxyfcf5xQ1sJ": () => window.open("https://beneos.cloud/", "_blank", "noopener"),
      "OrdZJUbt0u3YDd8w": async () => {
        try {
          const { BeneosSearchEngineLauncher } = await import("./beneos_search_engine.js");
          new BeneosSearchEngineLauncher().render();
        } catch (e) { console.warn("Beneos | Search launcher failed:", e); }
      },
      "SidVYdtkooJ3H52J": () => window.open("https://discord.gg/MS6KbX7YQ6", "_blank", "noopener"),
      "huvDEibZyu30B47y": () => openMoulinetteWithFilter({ terms: "BM: Spire Monastery", creator: "Beneos Battlemaps", pack: "00 Single Map Releases - 01" }),
      "uaAecFJ5vcGmZatj": () => window.open("https://www.patreon.com/cw/BeneosBattlemaps", "_blank", "noopener"),
      "9sgVlpqG6FWQew0x": () => window.open("https://www.patreon.com/cw/BeneosTokens", "_blank", "noopener")
    },
    // Welcome / Start Here
    "0A8yWjm42oAg0vnw": {
      "b8WFRDx8Tardl9tq": () => openMoulinetteWithFilter({ terms: "BM: Spire Monastery", creator: "Beneos Battlemaps", pack: "00 Single Map Releases - 01" }),
      "1wMJVxGzBtenMvkr": () => window.open("https://www.patreon.com/cw/BeneosBattlemaps", "_blank", "noopener"),
      "G9RiERlYL85bMKPF": () => window.open("https://www.patreon.com/cw/BeneosTokens", "_blank", "noopener")
    },
    // Page 1 — Overview
    "7C7jvaaI3W1gFFZ3": {
      "UWnbhn66Sj8soskv": () => openMoulinetteWithFilter({ creator: "Beneos Battlemaps", pack: "The Ashuur Fire Temple - 68" })
    },
    // Page 2 — Battlemap
    "M0uzfpdYcLJveveu": {
      "lpZ93iKjrWFM6uoH": () => openMoulinetteWithFilter({ creator: "Beneos Battlemaps", pack: "The Ashuur Fire Temple - 68" })
    },
    // Page 3 — Scenery
    "oQFWGxrKGYbhsE22": {
      "fd0UGnKuTCEZ6gkc": () => openMoulinetteWithFilter({ creator: "Beneos Battlemaps", pack: "The Ashuur Fire Temple - 68" })
    },
    // Page 4 — Intro Sequences
    "sBm7NH23HJ2gv6lA": {
      "tbiLC6GPRXjxdemd": () => openMoulinetteWithFilter({ creator: "Beneos Battlemaps", pack: "The Ashuur Fire Temple - 68" })
    },
    // Page 5 — World Map
    "HNcl2IS9T6JuFxL6": {
      "ky6z4AxdrY1mt7NK": () => openMoulinetteWithFilter({ creator: "Beneos Battlemaps", pack: "00 Beneos Escalia World Map" })
    },
    // Page 6 — Creatures / Tokens
    "u0wKs5Gmwgqr8NK0": {
      "hMx3Y8SewlgG1ItS": () => openMoulinetteWithFilter({ terms: "necromancers", creator: "Beneos Battlemaps", pack: "00 Single Map Releases - 01" })
    },
    // Page 7 — Loot / Items
    "B0h1UkhCXoKatFx4": {
      "3nERH9xZRQD0lIZx": () => openMoulinetteWithFilter({ terms: "Monk", creator: "Beneos Battlemaps", pack: "00 Single Map Releases - 01" })
    },
    // Page 8 — Spells
    "e8XNodRWUYixtEjd": {
      "BjOsigMoJ4J7gVfW": () => openMoulinetteWithFilter({ creator: "Beneos Battlemaps", pack: "Old Cemetery - 93" })
    }
  };
  // Foundry's MouseInteractionManager routes every canvas click through
  // `canvas.activeLayer._onClickLeft` (board.mjs:2074-2076). So in Token
  // Controls mode, clicks are delivered to TokenLayer._onClickLeft — they
  // never reach a Tile's or Drawing's own _onClickLeft. Monk's Active Tile
  // Triggers solves this by libWrapping `_onClickLeft` on every layer and
  // hit-testing active tiles on each click (monks-active-tiles.js:2815-2822).
  //
  // We use the same pattern, scoped to just our 4 Contacts tiles: wrap
  // `TokenLayer.prototype._onClickLeft` (the layer the user is in 99% of the
  // time) via libWrapper, convert the event to world coords, and hit-test
  // our tiles by document bounds. On a hit we fire the handler. We always
  // call `wrapped(...)` so Foundry's normal click path (e.g. token deselect)
  // still runs — it's harmless when clicking empty-canvas tile area.
  const _sceneTileClickHit = (event) => {
    const sceneId = canvas.scene?.id;
    const handlers = SCENE_TILE_HANDLERS[sceneId];
    if (!handlers) return false;
    // Contacts-scene guard: swallow clicks while the reward video plays so
    // an accidental click doesn't fire a button behind the cinematic.
    if (sceneId === CONTACTS_SCENE_ID && _beneosFarewellVideoPlaying) return false;
    let pt;
    try { pt = event.getLocalPosition(canvas.stage); }
    catch (e) { console.warn("[Beneos Tours] _sceneTileClickHit: failed to compute world coords", e); return false; }
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return false;
    for (const [tileId, handler] of Object.entries(handlers)) {
      // Resolve the tile document. `canvas.tiles.get` returns the Tile
      // PLACEABLE only once the tile layer has drawn, which can miss tiles
      // on newly-loaded scenes. Falling back to the scene's embedded
      // document collection (`canvas.scene.tiles`) is the authoritative
      // source and works even before placeables materialise.
      const placeable = canvas.tiles?.get(tileId);
      const doc = placeable?.document ?? canvas.scene?.tiles?.get(tileId) ?? null;
      if (!doc) {
        console.debug(`Beneos | scene-tile click: tile ${tileId} not found on scene ${sceneId}`);
        continue;
      }
      const w = doc.width ?? 0;
      const h = doc.height ?? 0;
      if (!w || !h) continue;
      if (pt.x >= doc.x && pt.x <= doc.x + w
       && pt.y >= doc.y && pt.y <= doc.y + h) {
        // Click feedback SFX — plays immediately so the user knows their
        // click registered before the browser/Moulinette window opens.
        try {
          const src = `modules/${MODULE_ID}/ui/sfx/beneos_click.ogg`;
          const helper = foundry.audio?.AudioHelper;
          if (helper?.play) helper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
        } catch (e) {}
        try { handler(); }
        catch (e) { console.error("Beneos | Scene-tile click handler failed:", e); }
        return true;
      }
    }
    return false;
  };
  Hooks.once("ready", () => {
    if (!game.modules.get("lib-wrapper")?.active) {
      console.warn("Beneos | libWrapper not available; scene-tile clicks disabled.");
      return;
    }
    // Wrap _onClickLeft on every interaction layer so a click fires our
    // handler no matter which control layer the user is currently on.
    const layers = [
      "foundry.canvas.layers.TokenLayer",
      "foundry.canvas.layers.TilesLayer",
      "foundry.canvas.layers.DrawingsLayer",
      "foundry.canvas.layers.WallsLayer",
      "foundry.canvas.layers.LightingLayer",
      "foundry.canvas.layers.SoundsLayer",
      "foundry.canvas.layers.NotesLayer",
      "foundry.canvas.layers.RegionLayer"
    ];
    for (const layerPath of layers) {
      try {
        libWrapper.register(MODULE_ID, `${layerPath}.prototype._onClickLeft`,
          function (wrapped, ...args) {
            try { _sceneTileClickHit(args[0]); } catch (e) {}
            return wrapped(...args);
          }, "WRAPPER");
      } catch (e) {
        // Layer may not exist in a given install — not fatal
      }
    }
  });

  /* ---- ScenePacker import hooks: flag for auto-start after reload ----
   *   When the inline Setup-Tour Yes-flow is active (_autoInstallActive),
   *   we skip the pending-flag write and the _maybeHandInstallComplete
   *   bridge entirely — the inline flow owns the activation and showing
   *   an additional confirmation dialog on top of it would overlap. */
  Hooks.on("ScenePacker.importAllComplete", (data) => {
    if (!data.adventureName?.includes(TUTORIAL_ADVENTURE_NAME)) return;
    if (_autoInstallActive) return;
    game.settings.set(MODULE_ID, "sceneTourPending", true);
    _maybeHandInstallComplete();
  });
  Hooks.on("ScenePacker.importMoulinetteComplete", (data) => {
    if (!data.info?.name?.includes(TUTORIAL_ADVENTURE_NAME)) return;
    if (_autoInstallActive) return;
    game.settings.set(MODULE_ID, "sceneTourPending", true);
    _maybeHandInstallComplete();
  });
});

/* ================================================================== */
/*  Auto-start on first run (GM only)                                  */
/* ================================================================== */

Hooks.once("ready", async () => {
  if (!game.user.isGM) {
    BeneosUtility.debugMessage("Beneos Setup Tour | first-run check skipped: user is not GM");
    return;
  }

  // --- Phase 1 auto-start on first run ---
  const isFirstRun = game.settings.get(MODULE_ID, "tourFirstRun");
  if (!isFirstRun) {
    const tour = game.tours.get(`${MODULE_ID}.setup`);
    if (tour && tour.status === TourBase.STATUS.UNSTARTED) {
      await game.settings.set(MODULE_ID, "tourFirstRun", true);
    }
  }

  // Show the Beneos Tour prompt on first install or after any module
  // version change, unless the user has opted out permanently. This
  // replaces the previous silent auto-start so veteran users aren't
  // forced through the tour on every update.
  const currentVersion = game.modules.get(MODULE_ID)?.version ?? "";
  const lastVersion = game.settings.get(MODULE_ID, "tourPromptLastVersion");
  const dontShow = game.settings.get(MODULE_ID, "tourPromptDontShowAgain");
  const shouldPrompt = !dontShow && currentVersion && currentVersion !== lastVersion;
  BeneosUtility.debugMessage(`Beneos Setup Tour | first-run check: currentVersion="${currentVersion}", lastVersion="${lastVersion}", dontShow=${dontShow}, shouldPrompt=${shouldPrompt}`);

  if (shouldPrompt) {
    setTimeout(async () => {
      BeneosUtility.debugMessage("Beneos Setup Tour | opening first-run prompt");
      const result = await _confirmStartSetupTour();
      BeneosUtility.debugMessage("Beneos Setup Tour | first-run prompt resolved:", result);
      // Only persist the "last seen version" when the user actually clicked
      // Yes or No. Any other close path — null (close-handler), undefined,
      // escape key, X button, auto-dismiss, or a malformed callback return —
      // leaves settings untouched so the prompt re-appears on next load.
      // The old `if (!result) return` was too permissive: some DialogV2
      // variants return an empty object on X-close, which previously slipped
      // past and got treated as a "yes" answer.
      if (!result || typeof result.answer !== "boolean") {
        BeneosUtility.debugMessage("Beneos Setup Tour | dismissed without explicit Yes/No — settings left untouched, prompt will re-appear on next load");
        return;
      }
      await game.settings.set(MODULE_ID, "tourPromptLastVersion", currentVersion);
      BeneosUtility.debugMessage(`Beneos Setup Tour | tourPromptLastVersion set to "${currentVersion}" (answer=${result.answer}, dontShow=${!!result.dontShow})`);
      if (result.dontShow) {
        await game.settings.set(MODULE_ID, "tourPromptDontShowAgain", true);
        BeneosUtility.debugMessage("Beneos Setup Tour | user opted out permanently for this world");
      }
      if (result.answer) {
        const tour = game.tours.get(`${MODULE_ID}.setup`);
        if (tour?.canStart) {
          await tour.start();
          await game.settings.set(MODULE_ID, "tourFirstRun", false);
        }
      }
    }, 2000);
    return; // Don't also start scene tour on same load
  }

  // --- Bridge: after Getting Started Pack import, ask whether to launch the
  //     tutorial. Yes → activate Start Here scene; the canvasReady hook below
  //     then auto-starts the per-scene tutorial tour. No → silently abort so
  //     the user isn't trapped in an unwanted tour sequence.
  if (game.settings.get(MODULE_ID, "sceneTourPending")) {
    await game.settings.set(MODULE_ID, "sceneTourPending", false);
    setTimeout(async () => {
      const proceed = await _confirmStartTutorial();
      if (!proceed) return;
      const startScene = _findStartHereScene();
      if (startScene) {
        if (startScene.activate) await startScene.activate();
        else await startScene.view();
        // canvasReady hook handles the tour start automatically
      }
    }, 3000);
  }
});

/**
 * Resolve the "Start Here" welcome scene robustly. The historical pack used
 * id `0A8yWjm42oAg0vnw`; the newer "- Beneos Getting Started Tour" pack may
 * carry a different id but always names the scene "Start Here". Fall through
 * id → getName → linear find so either pack layout works.
 */
function _findStartHereScene() {
  return game.scenes.get("0A8yWjm42oAg0vnw")
    ?? game.scenes.getName?.("Start Here")
    ?? game.scenes.find(s => s.name === "Start Here")
    ?? null;
}

/**
 * Close any ScenePacker completion Dialog / DialogV2 that may still be open
 * on top of the canvas after Import All finishes. Leaves every other dialog
 * untouched.
 */
function _closeScenePackerCompletionDialogs() {
  const isScenePacker = (app) => {
    const title = app?.options?.window?.title
               ?? app?.data?.title
               ?? app?.title
               ?? "";
    return typeof title === "string" && title.toLowerCase().includes("scene packer");
  };
  try {
    for (const app of Object.values(ui.windows ?? {})) {
      if ((app instanceof Dialog || app?.constructor?.name === "Dialog") && isScenePacker(app)) {
        try { app.close(); } catch (e) {}
      }
    }
  } catch (e) {}
  try {
    const instances = foundry.applications?.instances;
    if (instances) {
      for (const app of instances.values?.() ?? Object.values(instances)) {
        if (app?.constructor?.name?.includes?.("Dialog") && isScenePacker(app)) {
          try { app.close(); } catch (e) {}
        }
      }
    }
  } catch (e) {}
}

/**
 * Remove any lingering tour-tooltip DOM nodes. Foundry's `tour.exit()`
 * cleans up internal state but — at least in some V14 builds — leaves the
 * last-step tooltip element in the DOM for a render tick. A freshly-
 * starting tour adds its own nodes, so removing these is safe.
 */
function _removeTourTooltipDOM() {
  try {
    document.querySelectorAll(
      ".tour-center-step, .tour-step, .tour-fadeout, #tour-details"
    ).forEach(el => el.remove());
  } catch (e) {}
}

/**
 * Close every open popup so only the freshly-activated Welcome scene and
 * its Welcome-tour tooltip remain. Covers:
 *  - V11-V13 `ui.windows` Applications (incl. Dialog / JournalSheet /
 *    ScenePacker importer / `Dialog.prompt` "complete!" dialog).
 *  - V14 `foundry.applications.instances` (DialogV2, JournalSheetV2, …).
 *  - Moulinette DOM-only windows (`#mou-browser`, `#mou-cloud`, `#mou-user`).
 *  - Stray tour-tooltip DOM nodes from the just-exited Setup Tour.
 *
 * Tour Applications (`Tour.activeTour` UI) are intentionally left alone so
 * the Welcome tour keeps running after it starts.
 */
function _closeAllPopupsForInstall() {
  const isTourApp = (app) => {
    const cn = app?.constructor?.name ?? "";
    return cn === "Tour" || cn.endsWith("Tour") || cn.includes("TourBase");
  };
  try {
    for (const app of Object.values(ui.windows ?? {})) {
      if (isTourApp(app)) continue;
      try { app.close?.({ force: true }); } catch (e) {}
    }
  } catch (e) {}
  try {
    const instances = foundry.applications?.instances;
    if (instances) {
      for (const app of instances.values?.() ?? Object.values(instances)) {
        if (isTourApp(app)) continue;
        try { app.close?.({ force: true }); } catch (e) {}
      }
    }
  } catch (e) {}
  // Moulinette's cloud / browser / user windows render into fixed DOM IDs
  // outside Foundry's Application manager. Close them via header button.
  try {
    for (const id of ["mou-browser", "mou-cloud", "mou-user"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      const btn = el.querySelector("header .close, .window-header .close, a.header-button.close, button.close");
      if (btn) { try { btn.click(); } catch (e) {} }
    }
  } catch (e) {}
  _removeTourTooltipDOM();
}

/**
 * Set by the Setup-Tour inline install-confirm Yes-handler before it clicks
 * ScenePacker's "Import All". Signals to `_maybeHandInstallComplete` that
 * the inline path owns this install and will handle activation itself, so
 * the global bridge must NOT re-ask the user via _confirmStartTutorial.
 */
let _autoInstallActive = false;

/**
 * Direct post-install bridge: fires on ScenePacker import completion. If the
 * Setup tour is NOT running anymore (user already closed it or never started
 * it), and the freshly-imported Start Here scene exists, ask the user right
 * now whether to jump there — avoids forcing a world reload. If the Setup
 * tour is still active, do nothing here — the `sceneTourPending` flag set
 * by the calling hook will drive the confirmation on the next reload. When
 * the inline Setup-Tour Yes-handler is active, this function also bails out
 * so the inline path remains the single source of truth for the activation.
 */
let _installBridgeInFlight = false;
async function _maybeHandInstallComplete() {
  if (_installBridgeInFlight) return;
  if (_autoInstallActive) return;
  const setupTour = game.tours.get(`${MODULE_ID}.setup`);
  if (setupTour?.status === TourBase.STATUS.IN_PROGRESS) return;
  _installBridgeInFlight = true;
  try {
    // Let ScenePacker finish any leftover journal/folder work before activation.
    await new Promise(r => setTimeout(r, 2000));
    const startScene = _findStartHereScene();
    if (!startScene) return; // fall back to the reload path
    // Clear the pending flag so the reload-path doesn't re-fire the dialog.
    await game.settings.set(MODULE_ID, "sceneTourPending", false);
    const proceed = await _confirmStartTutorial();
    if (!proceed) return;
    if (canvas.scene?.id === startScene.id) return;
    if (startScene.activate) await startScene.activate();
    else await startScene.view();
    // canvasReady hook picks up from here and auto-starts the scene tour.
  } catch (e) {
    console.warn("Beneos Tutorial Tour | _maybeHandInstallComplete failed:", e);
  } finally {
    _installBridgeInFlight = false;
  }
}

// ---------- Beneos-styled confirmation-dialog CSS ----------
// Same palette as the asset-watcher dialog so the Setup-Tour confirm box
// visually matches the tour tooltips (dark bg, gold border + accents).
(() => {
  if (document.getElementById("beneos-tour-confirm-styles")) return;
  const css = document.createElement("style");
  css.id = "beneos-tour-confirm-styles";
  css.textContent = `
    .beneos-tour-confirm-dialog {
      background: #151412 !important;
      color: #e6e5e3 !important;
      border: none !important;
      border-radius: 6px !important;
      overflow: hidden !important;
      box-shadow:
        inset 0 0 0 2px #f5c992,
        0 0 24px rgba(245, 201, 146, 0.25) !important;
    }
    .beneos-tour-confirm-dialog .window-header {
      background: #151412 !important;
      color: #f5c992 !important;
      border-bottom: 1px solid #f5c992 !important;
    }
    .beneos-tour-confirm-dialog .window-header .window-title { color: #f5c992 !important; }
    .beneos-tour-confirm-dialog .window-content {
      background: #151412 !important;
      color: #e6e5e3 !important;
      padding: 0.75em 1em !important;
    }
    .beneos-tour-confirm-dialog p,
    .beneos-tour-confirm-dialog li { color: #e6e5e3 !important; }
    .beneos-tour-confirm-dialog label.beneos-dont-show {
      display: inline-flex !important;
      align-items: center !important;
      gap: 0.5em !important;
      margin-top: 0.8em !important;
      color: #e6e5e3 !important;
      cursor: pointer !important;
      user-select: none !important;
    }
    .beneos-tour-confirm-dialog label.beneos-dont-show input[type="checkbox"] {
      accent-color: #f5c992 !important;
      cursor: pointer !important;
    }
    /* First-run prompt: constrain width so text wraps and buttons stay
       a sane size instead of stretching to fit a one-line paragraph. */
    .beneos-tour-firstrun { max-width: 600px !important; }
    .beneos-tour-firstrun .window-content,
    .beneos-tour-firstrun .dialog-content { max-width: 100% !important; }
    .beneos-tour-firstrun .window-content p,
    .beneos-tour-firstrun .dialog-content p {
      white-space: normal !important;
      overflow-wrap: break-word !important;
      word-wrap: break-word !important;
      line-height: 1.45 !important;
      margin: 0 0 0.4em 0 !important;
    }
    .beneos-tour-firstrun .dialog-buttons,
    .beneos-tour-firstrun .form-footer { gap: 0.5em !important; }
    .beneos-tour-firstrun .dialog-buttons button,
    .beneos-tour-firstrun .form-footer button {
      flex: 0 1 auto !important;
      min-width: 8em !important;
      padding: 0.35em 1em !important;
    }
    /* Two-column layout: animated logo left, body + checkbox right. */
    .beneos-tour-firstrun .beneos-firstrun-grid {
      display: grid !important;
      grid-template-columns: 128px 1fr !important;
      gap: 1em !important;
      align-items: center !important;
    }
    .beneos-tour-firstrun .beneos-firstrun-logo {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .beneos-tour-firstrun .beneos-firstrun-logo img {
      width: 128px !important;
      height: 128px !important;
      max-width: 128px !important;
      object-fit: contain !important;
      user-select: none !important;
      pointer-events: none !important;
      border: none !important;
    }
    .beneos-tour-firstrun .beneos-firstrun-body { min-width: 0 !important; }
    .beneos-tour-confirm-dialog strong,
    .beneos-tour-confirm-dialog b { color: #f5c992 !important; }
    .beneos-tour-confirm-dialog .dialog-buttons button,
    .beneos-tour-confirm-dialog .form-footer button {
      background: #2a2623 !important;
      color: #f5c992 !important;
      border: 1px solid #f5c992 !important;
    }
    .beneos-tour-confirm-dialog .dialog-buttons button:hover,
    .beneos-tour-confirm-dialog .form-footer button:hover {
      background: #3a3228 !important;
    }
    /* Pulsing Yes button — mirrors the tour-tooltip border pulse (white
       <-> gold glow) so the dialog's primary action catches the eye. */
    @keyframes beneos-tour-confirm-yes-pulse {
      0%, 100% {
        box-shadow: 0 0 4px rgba(245, 201, 146, 0.35), inset 0 0 0 1px #f5c992;
        color: #f5c992 !important;
      }
      50% {
        box-shadow: 0 0 14px rgba(245, 201, 146, 0.95), inset 0 0 0 2px #f5c992;
        color: #fff2d6 !important;
      }
    }
    .beneos-tour-confirm-dialog button[data-button="yes"],
    .beneos-tour-confirm-dialog .dialog-button.yes,
    .beneos-tour-confirm-dialog .dialog-buttons button.yes,
    .beneos-tour-confirm-dialog .form-footer button[data-button="yes"] {
      animation: beneos-tour-confirm-yes-pulse 1.1s ease-in-out infinite;
    }
    /* Full-screen install overlay: blocks clicks, shows spinner + message
       so the user can't accidentally interrupt the install. */
    #beneos-install-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.94);
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      cursor: progress;
    }
    #beneos-install-overlay .beneos-install-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
      padding: 2rem 3rem;
      max-width: 680px;
      text-align: center;
    }
    #beneos-install-overlay .beneos-install-logo {
      width: 256px;
      height: 256px;
      object-fit: contain;
      user-select: none;
      pointer-events: none;
    }
    #beneos-install-overlay .beneos-install-text {
      color: #f5c992;
      font-size: 1.35rem;
      font-weight: 600;
      line-height: 1.4;
      text-shadow: 0 0 10px rgba(245, 201, 146, 0.35);
      user-select: none;
    }
    /* Moulinette login waiting overlay — pinned top-center, non-modal so
       the user can still interact with the Moulinette user window beneath. */
    #beneos-login-overlay {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483000;
      pointer-events: auto;
    }
    #beneos-login-overlay .beneos-login-inner {
      display: flex;
      align-items: center;
      gap: 1em;
      padding: 0.75em 1.25em;
      background: #151412;
      border: 2px solid #f5c992;
      border-radius: 8px;
      box-shadow: 0 0 24px rgba(245, 201, 146, 0.35);
      max-width: 520px;
    }
    #beneos-login-overlay .beneos-login-logo {
      width: 56px;
      height: 56px;
      object-fit: contain;
      flex-shrink: 0;
      user-select: none;
      pointer-events: none;
      border: none;
    }
    #beneos-login-overlay .beneos-login-body {
      display: flex;
      flex-direction: column;
      gap: 0.35em;
      min-width: 0;
    }
    #beneos-login-overlay .beneos-login-text {
      color: #f5c992;
      font-size: 1rem;
      font-weight: 600;
      line-height: 1.3;
    }
    #beneos-login-overlay .beneos-login-hint {
      color: #c9c5bd;
      font-size: 0.85rem;
      line-height: 1.3;
    }
    #beneos-login-overlay .beneos-login-recheck {
      background: #2a2623;
      color: #f5c992;
      border: 1px solid #f5c992;
      border-radius: 4px;
      padding: 0.35em 1em;
      margin-top: 0.4em;
      align-self: flex-start;
      cursor: pointer;
      font-size: 0.9rem;
      animation: beneos-tour-confirm-yes-pulse 1.1s ease-in-out infinite;
    }
    #beneos-login-overlay .beneos-login-recheck:hover {
      background: #3a3228;
    }
    #beneos-login-overlay .beneos-login-recheck.is-checking {
      opacity: 0.6;
      pointer-events: none;
      cursor: wait;
      animation: none;
    }
  `;
  document.head.appendChild(css);
})();

/**
 * Full-screen fade + spinner overlay. Shown from the moment the user clicks
 * "Yes, install and start" until the page reloads. Prevents accidental
 * clicks that could cancel the import halfway through. Idempotent.
 */
let _beneosInstallOverlay = null;
function _showInstallOverlay() {
  if (_beneosInstallOverlay) return;
  const text = game.i18n.localize("BENEOS.Tour.Setup.InstallOverlay.Text");
  const overlay = document.createElement("div");
  overlay.id = "beneos-install-overlay";
  overlay.innerHTML = `
    <div class="beneos-install-inner">
      <img class="beneos-install-logo" src="modules/beneos-module/icons/beneos_logo_animated.gif" alt="" />
      <div class="beneos-install-text">${text}</div>
    </div>
  `;
  // Block keyboard too (Esc, F-keys) while the overlay is up.
  overlay.addEventListener("keydown", (e) => { e.stopPropagation(); e.preventDefault(); }, true);
  overlay.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); }, true);
  document.body.appendChild(overlay);
  _beneosInstallOverlay = overlay;
}

function _hideInstallOverlay() {
  if (!_beneosInstallOverlay) return;
  try { _beneosInstallOverlay.remove(); } catch (e) {}
  _beneosInstallOverlay = null;
}

// Update the visible install-overlay text in place — used by the auto-install
// stall-hint watchdog (60s) so the user sees something change rather than
// staring at the same "Please wait…" string and assuming Foundry froze.
function _updateInstallOverlayText(text) {
  if (!_beneosInstallOverlay) return;
  const el = _beneosInstallOverlay.querySelector(".beneos-install-text");
  if (el) el.textContent = text;
}

// Retry-or-cancel dialog shown after the auto-install watchdogs trip. Returns
// true if the user wants to retry, false on cancel. Each `reasonKey` maps to
// a distinct user-facing message in en.json so the user understands WHICH
// failure mode they're in (no install ever started vs. install ran out of
// time) and can address the right cause.
async function _confirmInstallRetry(reasonKey) {
  const messageMap = {
    "no-start": "BENEOS.Tour.Setup.InstallError.NoStart",
    "timeout":  "BENEOS.Tour.Setup.InstallError.Timeout"
  };
  const messageI18n = messageMap[reasonKey] ?? "BENEOS.Tour.Setup.InstallError.Generic";
  const title   = game.i18n.localize("BENEOS.Tour.Setup.InstallError.Title");
  const message = game.i18n.localize(messageI18n);
  const retry   = game.i18n.localize("BENEOS.Tour.Setup.InstallError.Retry");
  const cancel  = game.i18n.localize("BENEOS.Tour.Setup.InstallError.Cancel");

  return new Promise(resolve => {
    new Dialog({
      title,
      content: `<p>${message}</p>`,
      buttons: {
        retry:  { icon: '<i class="fas fa-rotate-right"></i>', label: retry,  callback: () => resolve(true) },
        cancel: { icon: '<i class="fas fa-xmark"></i>',         label: cancel, callback: () => resolve(false) }
      },
      default: "retry",
      close: () => resolve(false)
    }, { classes: ["beneos-asset-watcher-dialog"] }).render(true);
  });
}

/**
 * Non-fullscreen "waiting for Moulinette login" overlay. Pinned to the top
 * of the viewport so the Moulinette user window is still reachable beneath.
 * Contains animated logo, localized status text, and a manual re-check
 * button (used as a safety net if Moulinette doesn't auto-re-render after
 * Patreon OAuth). Returns a handle with an `onRecheck` setter so the caller
 * can wire up the manual-confirm path.
 */
let _beneosLoginOverlay = null;
function _showLoginWaitingOverlay() {
  if (_beneosLoginOverlay) return _beneosLoginOverlay;
  const text = game.i18n.localize("BENEOS.Tour.Setup.MoulinetteLogin.Waiting");
  const hint = game.i18n.localize("BENEOS.Tour.Setup.MoulinetteLogin.WaitingHint");
  const recheck = game.i18n.localize("BENEOS.Tour.Setup.MoulinetteLogin.Recheck");
  const overlay = document.createElement("div");
  overlay.id = "beneos-login-overlay";
  overlay.innerHTML = `
    <div class="beneos-login-inner">
      <img class="beneos-login-logo" src="modules/beneos-module/icons/beneos_logo_animated.gif" alt="" />
      <div class="beneos-login-body">
        <div class="beneos-login-text">${text}</div>
        <div class="beneos-login-hint">${hint}</div>
        <button type="button" class="beneos-login-recheck">${recheck}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const btn = overlay.querySelector(".beneos-login-recheck");
  const hintEl = overlay.querySelector(".beneos-login-hint");
  const handle = {
    element: overlay,
    onRecheck: null,
    setButtonState(mode) {
      if (!btn) return;
      if (mode === "checking") {
        btn.disabled = true;
        btn.classList.add("is-checking");
        btn.textContent = game.i18n.localize("BENEOS.Tour.Setup.MoulinetteLogin.Checking");
      } else if (mode === "fallback") {
        btn.disabled = false;
        btn.classList.remove("is-checking");
        btn.textContent = game.i18n.localize("BENEOS.Tour.Setup.MoulinetteLogin.Continue");
      } else {
        btn.disabled = false;
        btn.classList.remove("is-checking");
        btn.textContent = game.i18n.localize("BENEOS.Tour.Setup.MoulinetteLogin.Recheck");
      }
    },
    setHint(text) {
      if (hintEl) hintEl.innerHTML = text;
    }
  };
  btn?.addEventListener("click", () => { handle.onRecheck?.(); });
  _beneosLoginOverlay = handle;
  return handle;
}

function _hideLoginWaitingOverlay() {
  if (!_beneosLoginOverlay) return;
  try { _beneosLoginOverlay.element.remove(); } catch (e) {}
  _beneosLoginOverlay = null;
}

/**
 * Block execution until Moulinette reports a patron-authenticated state.
 * Opens the Moulinette user window so the Patreon OAuth flow is one click
 * away, shows a Beneos-styled status overlay, and polls the same detection
 * heuristic used in the tour gate. Two exit paths:
 *
 *   - passive: `_isMoulinetteLoggedIn()` flips to true (Moulinette re-rendered
 *     after a successful OAuth, `a[href*=patreon.com/moulinette]` is gone)
 *   - manual: user clicks the "I'm logged in" button in the overlay, which
 *     forces an immediate re-check — safety net if Moulinette doesn't
 *     auto-re-render
 *
 * Returns `true` on detected login, `false` on timeout (default 10 min).
 */
async function _waitForMoulinetteLogin() {
  try { await openMoulinetteUser(); } catch (e) {}
  const overlay = _showLoginWaitingOverlay();
  let manualPoke = false;
  let rechecking = false;
  let fallbackArmed = false;
  let manualTrust = false;
  overlay.onRecheck = () => {
    if (fallbackArmed) manualTrust = true;
    else manualPoke = true;
  };

  const MAX_WAIT_MS = 10 * 60 * 1000;
  const INTERVAL_MS = 500;
  const start = Date.now();

  // Force Moulinette to re-fetch user details from its API. Moulinette
  // populates `cache.user` lazily and will only re-fetch when that field
  // is empty — so we null it out, close the user window, and reopen it.
  // The reopen triggers the template's `getData()` path which sees the
  // missing cache and calls `apiGET(...)` to pull fresh patron state.
  const forceRefetch = async () => {
    const mou = getMoulinette();
    if (!mou) return;
    try {
      if (mou.cache) {
        try { delete mou.cache.user; } catch (e) { try { mou.cache.user = null; } catch (e2) {} }
      }
    } catch (e) {}
    try {
      if (mou.user?.close) await mou.user.close({ animate: false });
    } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
    try { mou.user?.render(true); } catch (e) {}
    try { await waitForElement("#mou-user", 5000); } catch (e) {}
    // apiGET + re-render + DOM paint. Give it a beat before we read state.
    await new Promise(r => setTimeout(r, 1500));
  };

  try {
    while (Date.now() - start < MAX_WAIT_MS) {
      // Second click while fallback is armed — trust the user's claim and exit.
      // Downstream Moulinette actions will surface their own error if the
      // claim turns out to be wrong. Better than a silent hang.
      if (manualTrust) return true;

      if (manualPoke && !rechecking) {
        manualPoke = false;
        rechecking = true;
        overlay.setButtonState("checking");
        try {
          await forceRefetch();
          if (_isMoulinetteLoggedIn()) return true;
          // Heuristic still says logged-out after a forced refetch. Arm the
          // fallback: the next click becomes an explicit "trust me, continue".
          fallbackArmed = true;
          overlay.setButtonState("fallback");
          overlay.setHint(game.i18n.localize("BENEOS.Tour.Setup.MoulinetteLogin.FallbackHint"));
        } finally {
          rechecking = false;
        }
      }
      // Passive polling: works only if Moulinette re-renders on its own
      // (rare — its user window doesn't auto-refresh after OAuth). Kept
      // as a safety net in case a future Moulinette version fixes this.
      if (_isMoulinetteLoggedIn()) {
        await new Promise(r => setTimeout(r, 400));
        if (_isMoulinetteLoggedIn()) return true;
      }
      await new Promise(r => setTimeout(r, INTERVAL_MS));
    }
    return false;
  } finally {
    _hideLoginWaitingOverlay();
  }
}

/**
 * Inline Setup-Tour end prompt: ask the user whether we should auto-click
 * the ScenePacker "Import All" button and jump straight into the Getting
 * Started Tour. Returns `true` on Yes, `false` on No / dismiss. Uses V14's
 * DialogV2 when available and falls back to V13's Dialog.confirm. Styled
 * with the Beneos palette via `beneos-tour-confirm-dialog` CSS class.
 */
async function _confirmAutoInstall() {
  // Notification SFX for attention — the dialog pulses its Yes button too.
  try {
    const src = "modules/beneos-module/ui/sfx/beneos_notification.ogg";
    const helper = foundry.audio?.AudioHelper;
    if (helper?.play) helper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
    else if (typeof AudioHelper !== "undefined" && AudioHelper.play) AudioHelper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
  } catch (e) {}
  const title = game.i18n.localize("BENEOS.Tour.Setup.InstallConfirm.Title");
  const content = game.i18n.localize("BENEOS.Tour.Setup.InstallConfirm.Content");
  const yesLabel = game.i18n.localize("BENEOS.Tour.Setup.InstallConfirm.Yes");
  const noLabel = game.i18n.localize("BENEOS.Tour.Setup.InstallConfirm.No");
  try {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (DialogV2?.confirm) {
      const result = await DialogV2.confirm({
        window: { title },
        classes: ["beneos-tour-confirm-dialog"],
        content,
        yes: { label: yesLabel },
        no: { label: noLabel },
        rejectClose: false,
        modal: true
      });
      return result === true;
    }
  } catch (e) {
    console.warn("Beneos Setup Tour | DialogV2 confirm failed, falling back:", e);
  }
  try {
    return await Dialog.confirm({
      title,
      content,
      yes: () => true,
      no: () => false,
      defaultYes: true,
      options: { classes: ["dialog", "beneos-tour-confirm-dialog"] }
    });
  } catch (e) {
    console.warn("Beneos Setup Tour | Auto-install confirm failed:", e);
    return false;
  }
}

/**
 * First-run / post-update Setup-Tour prompt. Shown when the module has just
 * been installed or updated and the user has not opted out. Returns
 *   { answer: boolean, dontShow: boolean }  on Yes / No,
 *   null                                   if the user dismissed via X.
 * The caller is responsible for persisting lastVersion / dontShowAgain and
 * for starting the tour on { answer: true }.
 */
async function _confirmStartSetupTour() {
  try {
    const src = "modules/beneos-module/ui/sfx/beneos_notification.ogg";
    const helper = foundry.audio?.AudioHelper;
    if (helper?.play) helper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
    else if (typeof AudioHelper !== "undefined" && AudioHelper.play) AudioHelper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
  } catch (e) {}
  const title = game.i18n.localize("BENEOS.Tour.FirstRun.Title");
  const body = game.i18n.localize("BENEOS.Tour.FirstRun.Content");
  const yesLabel = game.i18n.localize("BENEOS.Tour.FirstRun.Yes");
  const noLabel = game.i18n.localize("BENEOS.Tour.FirstRun.No");
  const dontShowLabel = game.i18n.localize("BENEOS.Tour.FirstRun.DontShowAgain");
  const content = `
    <div class="beneos-firstrun-grid">
      <div class="beneos-firstrun-logo">
        <img src="modules/beneos-module/icons/beneos_logo_animated.gif" alt="" />
      </div>
      <div class="beneos-firstrun-body">
        ${body}
        <label class="beneos-dont-show"><input type="checkbox" name="beneos-dont-show-again"> ${dontShowLabel}</label>
      </div>
    </div>`;

  const readCheckbox = (root) => {
    try { return !!root?.querySelector?.('input[name="beneos-dont-show-again"]')?.checked; }
    catch (e) { console.warn("[Beneos Tours] readCheckbox failed", e); return false; }
  };

  try {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (DialogV2?.wait) {
      return await DialogV2.wait({
        window: { title },
        classes: ["beneos-tour-confirm-dialog", "beneos-tour-firstrun"],
        position: { width: 540 },
        content,
        buttons: [
          {
            action: "yes",
            label: yesLabel,
            default: true,
            callback: (event, button, dialog) => ({ answer: true, dontShow: readCheckbox(dialog?.element) })
          },
          {
            action: "no",
            label: noLabel,
            callback: (event, button, dialog) => ({ answer: false, dontShow: readCheckbox(dialog?.element) })
          }
        ],
        rejectClose: false,
        modal: false,
        close: () => null
      });
    }
  } catch (e) {
    console.warn("Beneos Setup Tour | DialogV2 first-run prompt failed, falling back:", e);
  }

  try {
    return await new Promise((resolve) => {
      const dlg = new Dialog({
        title,
        content,
        buttons: {
          yes: {
            label: yesLabel,
            callback: (html) => resolve({ answer: true, dontShow: readCheckbox(html?.[0] ?? html) })
          },
          no: {
            label: noLabel,
            callback: (html) => resolve({ answer: false, dontShow: readCheckbox(html?.[0] ?? html) })
          }
        },
        default: "yes",
        close: () => resolve(null)
      }, { classes: ["dialog", "beneos-tour-confirm-dialog", "beneos-tour-firstrun"], width: 540 });
      dlg.render(true);
    });
  } catch (e) {
    console.warn("Beneos Setup Tour | First-run prompt failed:", e);
    return null;
  }
}

/**
 * Blocking instruction dialog shown when the user is about to enter the
 * Setup-Tour's ScenePacker step without being logged into Moulinette. Single
 * "Got it" button, `rejectClose: false`, modal — the user MUST acknowledge
 * before the tour can jump back to the login step. No abort path.
 */
async function _requireMoulinetteLogin() {
  try {
    const src = "modules/beneos-module/ui/sfx/beneos_notification.ogg";
    const helper = foundry.audio?.AudioHelper;
    if (helper?.play) helper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
    else if (typeof AudioHelper !== "undefined" && AudioHelper.play) AudioHelper.play({ src, volume: 0.5, autoplay: true, loop: false }, false);
  } catch (e) {}
  const title = game.i18n.localize("BENEOS.Tour.Setup.MoulinetteLogin.Title");
  const content = game.i18n.localize("BENEOS.Tour.Setup.MoulinetteLogin.Content");
  const okLabel = game.i18n.localize("BENEOS.Tour.Setup.MoulinetteLogin.OK");
  try {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (DialogV2?.wait) {
      await DialogV2.wait({
        window: { title },
        classes: ["beneos-tour-confirm-dialog"],
        position: { width: 460 },
        content,
        buttons: [{ action: "ok", label: okLabel, default: true, callback: () => true }],
        rejectClose: false,
        modal: true,
        close: () => true
      });
      return;
    }
  } catch (e) {
    console.warn("Beneos Setup Tour | DialogV2 Moulinette-login prompt failed, falling back:", e);
  }
  try {
    await new Promise((resolve) => {
      const dlg = new Dialog({
        title,
        content,
        buttons: {
          ok: { label: okLabel, callback: () => resolve() }
        },
        default: "ok",
        close: () => resolve()
      }, { classes: ["dialog", "beneos-tour-confirm-dialog"], width: 460 });
      dlg.render(true);
    });
  } catch (e) {
    console.warn("Beneos Setup Tour | Moulinette-login prompt failed:", e);
  }
}

/**
 * Show a Yes/No confirmation asking the user whether to start the tutorial
 * after the Getting Started Pack has been installed. Returns `true` on Yes,
 * `false` on No / dismiss. Uses V14's DialogV2 when available and falls back
 * to V13's Dialog.confirm.
 */
async function _confirmStartTutorial() {
  const title = game.i18n.localize("BENEOS.Tour.PostInstall.Title");
  const content = game.i18n.localize("BENEOS.Tour.PostInstall.Content");
  const yesLabel = game.i18n.localize("BENEOS.Tour.PostInstall.Yes");
  const noLabel = game.i18n.localize("BENEOS.Tour.PostInstall.No");
  try {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (DialogV2?.confirm) {
      const result = await DialogV2.confirm({
        window: { title },
        content,
        yes: { label: yesLabel },
        no: { label: noLabel },
        rejectClose: false,
        modal: true
      });
      return result === true;
    }
  } catch (e) {
    console.warn("Beneos Tutorial Tour | DialogV2 confirm failed, falling back:", e);
  }
  try {
    return await Dialog.confirm({
      title,
      content,
      yes: () => true,
      no: () => false,
      defaultYes: true
    });
  } catch (e) {
    console.warn("Beneos Tutorial Tour | Tour-start confirm failed:", e);
    return false;
  }
}

/* ================================================================== */
/*  Per-Scene Tutorial Auto-Trigger                                    */
/* ================================================================== */

/**
 * On every scene entry, check if the scene has a registered tutorial tour.
 * If yes and the user is a GM and no other tour is already running, start it.
 * Skip-conditions are cheap (a few property checks) so this has negligible
 * impact on non-tutorial scene switches.
 */
Hooks.on("canvasReady", async () => {
  if (!game.user?.isGM) return;
  if (!canvas.scene) return;

  // If a tour is already running, exit it cleanly before starting the new one.
  // This handles the user navigating away mid-tour (e.g. clicking a scene directly).
  if (TourBase.activeTour) {
    try { TourBase.activeTour.exit(); } catch (e) {}
  }

  const tourKey = TUTORIAL_SCENE_TOURS[canvas.scene.id]
               ?? TUTORIAL_SCENE_TOURS_BY_NAME[canvas.scene.name];
  if (!tourKey) {
    // Non-tutorial scene: stop any tour-managed music that may still be
    // playing from a previous tour. Tour playlists are Foundry-global, so
    // they keep playing across scene switches unless we explicitly stop
    // them. Without this guard the Getting Started tour music "follows"
    // the GM onto unrelated scenes (e.g. other Moulinette packs).
    stopAllManagedTourAudio();
    return;
  }

  const tour = game.tours.get(`${MODULE_ID}.${tourKey}`);
  if (!tour) return;

  // For the Overview tour, pre-hide the journal pin display and the
  // placeholder image tiles IMMEDIATELY (before the 1.5 s tour-start delay)
  // so the user never sees the icons flash into view. They are revealed
  // during the p1-pin-activated step.
  if (tourKey === "tutorial-page-1-overview") {
    if (game.user.isGM) await game.settings.set("core", "notesDisplayToggle", false);
    try {
      const updates = OVERVIEW_PLACEHOLDER_TILE_IDS
        .filter(id => canvas.scene.tiles.get(id))
        .map(id => ({ _id: id, alpha: 0 }));
      if (updates.length) {
        await canvas.scene.updateEmbeddedDocuments("Tile", updates);
      }
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Failed to pre-hide placeholder tiles:", e);
    }
  }

  // Slightly longer delay so any in-flight tour completion (e.g. the
  // start-here tour that just finished and triggered a scene swap) has time
  // to fully clear `Tour.activeTour` and finish writing its progress.
  setTimeout(async () => {
    try {
      if (game.paused) await game.togglePause(false);
    } catch (e) {}
    try {
      // IMPORTANT: await both — reset() is async (it calls progress(-1)
      // which awaits _postStep + _saveProgress). Calling start() before
      // reset finishes causes a race where two progress() invocations
      // interleave and the new tour silently never renders.
      await tour.reset();
      await tour.start();
      BeneosUtility.debugMessage(`Beneos Tutorial Tour | Auto-started '${tourKey}' on ${canvas.scene.name}`);
    } catch (e) {
      console.warn("Beneos Tutorial Tour | Auto-start failed:", e);
    }
  }, 1500);
});
