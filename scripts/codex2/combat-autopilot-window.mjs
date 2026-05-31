// Beneos Combat Autopilot Window — a faded-in window that explains the
// current round's autopilot play for the active creature in combat. Same
// header as the Creature Codex (avatar + journal) but without tabs and
// without Download PDF; keeps Open Actor. Ability chips open the item sheet
// (details), they do not fire. A single shared instance swaps creature on
// each turn so it stays where the GM placed it.

import { buildCreatureDetailCtx, openImagePopout, attachItemSheetContextMenu, flashPaywallDenied, mountEmberField } from "./creature-codex.mjs";
import { BeneosCombatPromptEngine } from "./combat-prompt-engine.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE_ROOT = "modules/beneos-module/templates/codex2";

export class BeneosCombatAutopilotWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "beneos-combat-autopilot",
    classes: ["beneos-codex", "beneos-combat-autopilot-window"],
    tag: "div",
    window: { title: "Beneos Autopilot", icon: "beneos-icon-logo", resizable: true },
    position: { width: 720, height: "auto", left: 160, top: 120 },
    actions: {
      "cdx-trigger-ability":    BeneosCombatAutopilotWindow._onTriggerAbility,
      "cdx-roll-chip":          BeneosCombatAutopilotWindow._onRollChip,
      "cdx-open-actor":         BeneosCombatAutopilotWindow._onOpenActor,
      "cdx-open-journal-image": BeneosCombatAutopilotWindow._onOpenJournalImage,
      "cdx-combat-close":       BeneosCombatAutopilotWindow._onCombatClose,
      "cdx-ap-tab":             BeneosCombatAutopilotWindow._onApTab,
      "cdx-ability-filter":     BeneosCombatAutopilotWindow._onAbilityFilter,
    },
  };

  static PARTS = { main: { template: `${TEMPLATE_ROOT}/parts/combat-autopilot-page.hbs` } };

  // Single shared instance: the autopilot for the creature whose turn it is
  // fades into the same frame so the DM keeps one window at one position.
  static _instance = null;

  _tokenKey = null;
  _actorId = null;
  _round = 1;
  _autoTab = "autopilot";   // "autopilot" | "abilities" | "mechanics"
  _abilityFilter = null;    // active ability-type filter in the abilities tab
  _fadeNext = false;        // play the dissolve-in on the next render (set on creature swap)
  _locked = false;          // paid creature without access: gate interactions

  static openForActor(actor, round = 1) {
    if (!actor) return null;
    const flag = actor.getFlag?.("world", "beneos") ?? {};
    const tokenKey = flag.tokenKey ?? flag.fullId ?? actor.id;
    const win = BeneosCombatAutopilotWindow._instance ?? new BeneosCombatAutopilotWindow();
    BeneosCombatAutopilotWindow._instance = win;
    // Detect a turn swap: same window already showing a different creature.
    // Fade the old content out first so the new creature dissolves in rather
    // than hard-cutting, a calmer experience for the DM mid-encounter.
    const isSwap = win.rendered && win._actorId && win._actorId !== actor.id;
    win._fadeNext = false;
    win._tokenKey = tokenKey;
    win._actorId = actor.id;
    win._round = round;
    const bringFront = () => { try { (win.bringToFront ?? win.bringToTop)?.call(win); } catch (_) {} };

    // Creature swap mid-combat: cross-fade instead of hard-cutting. The old
    // approach (fade out, THEN render) left a blank gap because render({force})
    // tears the DOM down synchronously, so the leaving element vanished before
    // the new one painted -> a visible flicker every turn. Instead we snapshot
    // the current content, overlay that frozen clone on top of the window, let
    // render() rebuild the real content underneath, then fade the clone out to
    // reveal it. No blank gap, no opacity reset race.
    const wc = isSwap ? win.element?.querySelector?.(".window-content") : null;
    const cur = wc?.querySelector?.(".cdx-combat-autopilot");
    if (wc && cur) {
      // A rapid turn swap can leave an earlier ghost mid-fade; drop any
      // before adding the new one so they never stack.
      wc.querySelectorAll(".cdx-autopilot-ghost").forEach(g => g.remove());
      const ghost = cur.cloneNode(true);
      ghost.classList.add("cdx-autopilot-ghost");
      ghost.removeAttribute("data-token-key");
      wc.appendChild(ghost);
      const removeGhost = () => ghost.remove();
      win.render({ force: true }).then(() => {
        requestAnimationFrame(() => {
          // Remove on the fade's own transitionend rather than a hardcoded
          // delay; a fallback timer covers reduced-motion / no-transition.
          ghost.addEventListener("transitionend", removeGhost, { once: true });
          setTimeout(removeGhost, 500);
          ghost.classList.add("is-fading");
        });
      }).catch(removeGhost);
      bringFront();
    } else {
      win.render({ force: true });
      bringFront();
    }
    return win;
  }

  get title() {
    const actor = this._actorId ? game.actors?.get?.(this._actorId) : null;
    const label = game.i18n.localize("BENEOS.CreatureCodex.Combat.AutopilotTitle");
    return actor?.name ? `${label} ${actor.name}` : label;
  }

  async _prepareContext(_options) {
    const creature = await buildCreatureDetailCtx({ tokenKey: this._tokenKey });
    this._locked = !!creature?.locked;
    const rounds = creature?.autopilot?.rounds ?? [];
    // Prefer the exact round; else the latest round at or below it; else first.
    const exact = rounds.find(r => r.n === this._round);
    const atOrBelow = [...rounds].filter(r => r.n <= this._round).sort((a, b) => b.n - a.n)[0];
    const currentRound = exact ?? atOrBelow ?? rounds[0] ?? null;

    // Abilities tab: filter buttons for the types this creature actually has
    // (no "All"; passive included as its own type). Fire on click like the
    // codex. Falls back to the first present type when the stored filter does
    // not exist for the creature now showing (shared instance swaps creature).
    const all = creature?.allAbilities ?? [];
    const order = ["action", "bonus", "reaction", "legendary", "player", "passive"];
    const present = order.filter(k => all.some(a => a.filterKey === k));
    const activeFilter = present.includes(this._abilityFilter) ? this._abilityFilter : (present[0] ?? null);
    const autoFilters = present.map(k => ({
      id: k,
      label: all.find(a => a.filterKey === k)?.filterLabel ?? k,
      active: k === activeFilter,
    }));
    const autoAbilities = activeFilter ? all.filter(a => a.filterKey === activeFilter) : [];

    return {
      creature,
      round: this._round,
      currentRound,
      hideDownload: true,
      autoTab: this._autoTab,
      autoFilters,
      autoAbilities,
      stats: this._buildStats(),
      // Paywall: autopilot works only for free creatures or active patrons.
      locked: this._locked,
      joinPatreonUrl: creature?.joinPatreonUrl ?? "https://www.patreon.com/c/BeneosTokens",
    };
  }

  /** Pull combat-relevant stats straight from the actor's dnd5e system data. */
  _buildStats() {
    const actor = this._actorId ? game.actors?.get?.(this._actorId) : null;
    const sys = actor?.system ?? {};
    const labels = (trait, isCondition = false) => {
      const cfg = isCondition ? CONFIG.DND5E?.conditionTypes : CONFIG.DND5E?.damageTypes;
      const out = [...(trait?.value ?? [])].map(k => cfg?.[k]?.label ?? cfg?.[k]?.name ?? k);
      if (trait?.custom) out.push(...String(trait.custom).split(";").map(s => s.trim()).filter(Boolean));
      return out.join(", ");
    };
    const t = sys.traits ?? {};
    // Movement: walk (or effective speed) first, then any non-zero other modes.
    const mv = sys.attributes?.movement ?? {};
    const units = mv.units || "ft";
    const moveParts = [];
    const primary = mv.walk || mv.speed || 0;
    if (primary) moveParts.push(`${primary} ${units}`);
    for (const [key, lbl] of [["fly", "Fly"], ["swim", "Swim"], ["climb", "Climb"], ["burrow", "Burrow"]]) {
      if (mv[key]) moveParts.push(`${lbl} ${mv[key]} ${units}`);
    }
    return {
      ac: sys.attributes?.ac?.value ?? null,
      hp: { value: sys.attributes?.hp?.value ?? 0, max: sys.attributes?.hp?.max ?? 0 },
      isOwner: !!actor?.isOwner,
      movement: moveParts.join(", "),
      resist:    labels(t.dr),
      immun:     labels(t.di),
      vuln:      labels(t.dv),
      condImmun: labels(t.ci, true),
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    attachItemSheetContextMenu(this.element);
    // Persistent ambient embers over the hero band (survives tab re-renders).
    mountEmberField(this.element);
    // Shared instance swaps creature on each turn: keep the window-chrome title
    // in sync with the creature now shown.
    const titleEl = this.element?.querySelector?.(".window-title");
    if (titleEl) titleEl.textContent = this.title;
    // Play the dissolve-in only when this render came from a creature swap,
    // not from internal tab/filter re-renders.
    if (this._fadeNext) {
      this._fadeNext = false;
      this.element?.querySelector?.(".cdx-combat-autopilot")?.classList.add("is-entering");
    }
    // Editable HP writes back to the actor the window was opened with.
    const hpInput = this.element?.querySelector?.(".cdx-ap-hp-input");
    if (hpInput) {
      hpInput.addEventListener("change", async (ev) => {
        const actor = this._actorId ? game.actors?.get?.(this._actorId) : null;
        if (!actor?.isOwner) return;
        const n = Math.max(0, parseInt(ev.target.value, 10) || 0);
        try { await actor.update({ "system.attributes.hp.value": n }); } catch (_) {}
      });
    }
  }

  static _onApTab(_ev, target) {
    if (this._locked) { flashPaywallDenied(this.element); return; }
    const tab = target?.dataset?.apTab;
    if (!tab) return;
    this._autoTab = tab;
    this.render(false);
  }
  static _onAbilityFilter(_ev, target) {
    const f = target?.dataset?.cdxFilter;
    if (!f) return;
    this._abilityFilter = f;
    this.render(false);
  }

  /** Left-click fires the ability; right-click (contextmenu) opens its sheet. */
  static async _onTriggerAbility(_ev, target) {
    const actor = game.actors?.get?.(target.dataset.actorId);
    const item  = actor?.items?.get?.(target.dataset.itemId);
    try {
      if (typeof item?.use === "function") await item.use();
      else if (typeof item?.roll === "function") await item.roll();
    } catch (_) {}
  }
  static async _onRollChip(_ev, target) {
    const actor = target.dataset.actorId ? game.actors?.get?.(target.dataset.actorId) : null;
    const formula = target.dataset.rollFormula ?? "";
    if (!formula) return;
    try {
      const roll = await (new Roll(formula)).evaluate();
      await roll.toMessage({ speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined });
    } catch (_) {}
  }
  static async _onOpenActor(_ev, target) {
    const actor = game.actors?.get?.(target.dataset.actorId);
    try { await actor?.sheet?.render(true); } catch (_) {}
  }
  static _onOpenJournalImage(_ev, target) {
    if (this._locked) { flashPaywallDenied(this.element); return; }
    const src = target?.dataset?.src;
    if (!src) return;
    openImagePopout(src, target.dataset.title ?? "");
  }
  static async _onCombatClose(_ev, _target) {
    const mute = this.element?.querySelector?.(".cdx-combat-optout")?.checked;
    if (mute) await BeneosCombatPromptEngine.setOptOut(this._tokenKey, "autopilot");
    this.close();
  }
}
