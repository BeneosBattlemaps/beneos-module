// Beneos Codex (M7) — module-level wiring:
//   - register the small Handlebars helpers the codex templates need
//   - preregister the partial templates
//   - expose a Settings-Menu entry that opens the codex
//   - publish a stable game.beneos.codex.open() API for cloud-v2 buttons
//     (M7.3) and other callers.

import { BeneosCodex } from "./beneos-codex.mjs";
import { BeneosCreatureCodexWindow } from "./creature-codex-window.mjs";
import { BeneosCombatPromptEngine } from "./combat-prompt-engine.mjs";
// Side-effect: registers the NPC-sheet "Beneos Comment" hover panel.
import "./sheet-ability-comment.mjs";
// Side-effect: wires the codex entry points (sheet header/tab button,
// cloud-v2 drawer button, cloud-v2 card context menu).
import "./codex-sheet-wiring.mjs";

// ---- Combat Prompt Engine settings -------------------------------------

Hooks.once("init", () => {
  const reg = (key, opts) => {
    if (!game.settings?.settings?.has(`beneos-module.${key}`)) {
      try { game.settings.register("beneos-module", key, opts); }
      catch (e) { console.warn(`Beneos | setting ${key} failed`, e); }
    }
  };
  // Combat read-aloud (death) engine toggle. Reuses the legacy key so an
  // existing world preference carries over; the v1 auto-fire is disabled.
  reg("codex-death-popup", {
    name: "BENEOS.CreatureCodex.Settings.DeathPopup",
    hint: "BENEOS.CreatureCodex.Settings.DeathPopupHint",
    scope: "world", config: true, type: Boolean, default: true,
  });
  reg("codex-autopilot-popup", {
    name: "BENEOS.CreatureCodex.Settings.AutopilotPopup",
    hint: "BENEOS.CreatureCodex.Settings.AutopilotPopupHint",
    scope: "world", config: true, type: Boolean, default: true,
  });
  // Per-creature opt-out map, client-local: { [tokenKey]: { autopilot, readaloud } }
  reg("codex-combat-optout", {
    scope: "client", config: false, type: Object, default: {},
  });
});

// ---- Handlebars helpers ------------------------------------------------

Hooks.once("init", () => {
  if (typeof Handlebars === "undefined") return;

  // eq — equality test usable in {{#if (eq a b)}}
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }
  // lte — less-than-or-equal (used by attune-dots)
  if (!Handlebars.helpers.lte) {
    Handlebars.registerHelper("lte", (a, b) => Number(a) <= Number(b));
  }
  // gte — greater-than-or-equal (used by sense-compass rarity gems)
  if (!Handlebars.helpers.gte) {
    Handlebars.registerHelper("gte", (a, b) => Number(a) >= Number(b));
  }
  // range — produces [start, start+1, ..., end-1] (used to iterate attune-dots)
  if (!Handlebars.helpers.range) {
    Handlebars.registerHelper("range", function (start, end) {
      const out = [];
      for (let i = Number(start); i < Number(end); i++) out.push(i);
      return out;
    });
  }
  // sum — Number(a) + Number(b); used to compute @index+1 inline.
  if (!Handlebars.helpers.sum) {
    Handlebars.registerHelper("sum", (a, b) => Number(a) + Number(b));
  }
  // numString — zero-padded 2-digit string (01, 02, ..., 99). Used for
  // the foreshadowing card numbering.
  if (!Handlebars.helpers.numString) {
    Handlebars.registerHelper("numString", (n) => String(Number(n) || 0).padStart(2, "0"));
  }
  // roman — arabic to Roman numeral (1 -> I, 4 -> IV, ...). Used for the
  // story-hook running index. Falls back to the arabic number above 3999.
  if (!Handlebars.helpers.roman) {
    Handlebars.registerHelper("roman", (n) => {
      let v = Number(n) || 0;
      if (v <= 0 || v > 3999) return String(v);
      const map = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
      let out = "";
      for (const [val, sym] of map) { while (v >= val) { out += sym; v -= val; } }
      return out;
    });
  }
  // typeof — string of the runtime type. Used by the chip renderer to
  // distinguish raw strings from chip objects in the tactical guide.
  if (!Handlebars.helpers.typeof) {
    Handlebars.registerHelper("typeof", (v) => typeof v);
  }
  // or — boolean OR over all args (last arg is the Handlebars options).
  if (!Handlebars.helpers.or) {
    Handlebars.registerHelper("or", function (...args) {
      args.pop(); // strip Handlebars options
      return args.some(Boolean);
    });
  }
});

// ---- Partials + Settings-Menu ------------------------------------------

Hooks.once("ready", async () => {
  try {
    await BeneosCodex.preregisterPartials();
  } catch (e) {
    console.warn("Beneos | Codex partial preregister failed:", e);
  }

  // Wire the combat prompt engine (death-prompt on 0 HP + autopilot on turn).
  try {
    BeneosCombatPromptEngine.init();
  } catch (e) {
    console.warn("Beneos | Combat prompt engine init failed:", e);
  }

  // Stable API for the cloud-v2 startseite + sub-tab links, the Token-HUD
  // journal button, the sheet header/tab buttons and the cloud-v2 card
  // context menu (all wired in codex-sheet-wiring.mjs).
  game.beneos = game.beneos ?? {};
  const prev = game.beneos.codex ?? {};
  game.beneos.codex = {
    ...prev,
    open: (...segs) => BeneosCodex.open(...segs),
    /** Token-HUD / sheet-header / context-menu route. Opens a
     *  standalone per-creature window (BeneosCreatureCodexWindow), so
     *  multiple creature codices can be open in parallel during a
     *  combat encounter. The main Bestiary hub stays on its own.
     *  Returns a Promise so callers (e.g. the Token-HUD handler in
     *  beneos_module.js) can .catch() the result safely. */
    openForActor: async (actor) => {
      if (!actor) { BeneosCodex.open("creatures"); return null; }
      return BeneosCreatureCodexWindow.openForActor(actor);
    },
  };
});

// ---- Settings menu — adds "Open Beneos Codex" to Module Settings -------

Hooks.once("init", () => {
  game.settings.registerMenu("beneos-module", "beneos-codex-open", {
    name: "Beneos Codex",
    label: "Open Beneos Codex",
    hint: "Open the Beneos Codex — origins, set bonuses, lore, design philosophy.",
    icon: "fa-solid fa-book-open",
    type: BeneosCodexOpener,
    restricted: false,
  });
});

// M7-Fix.2: Bridge ApplicationV2 — Foundry's registerMenu() requires a
// constructible Application class. We never actually mount it; render()
// just forwards to BeneosCodex.open() and returns. V1 FormApplication was
// the old approach (deprecated in V13, side-effects on the Foundry UI).
class BeneosCodexOpener extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "beneos-codex-opener-stub",
    classes: ["beneos-codex-opener-stub"],
    window: { title: "Beneos Codex" },
    position: { width: 1, height: 1 },
  };
  render(_force, _options) {
    BeneosCodex.open();
    return this;
  }
}
