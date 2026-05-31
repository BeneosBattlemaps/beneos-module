// Beneos Combat Death Window — a small, faded-in read-aloud textbox that
// shows a creature's Death Prompt when it drops to 0 HP in combat. Detached
// from the Creature Codex. Interactive: item refs fire, dice chips roll.

import { buildCreatureDetailCtx, attachItemSheetContextMenu } from "./creature-codex.mjs";
import { BeneosCombatPromptEngine } from "./combat-prompt-engine.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE_ROOT = "modules/beneos-module/templates/codex2";

export class BeneosCombatDeathWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "beneos-combat-death-{id}",
    classes: ["beneos-codex", "beneos-combat-death-window"],
    tag: "div",
    window: { title: "Death Prompt", icon: "fa-solid fa-skull", resizable: true },
    position: { width: 460, height: "auto", left: 200, top: 160 },
    actions: {
      "cdx-trigger-ability":    BeneosCombatDeathWindow._onTriggerAbility,
      "cdx-roll-chip":          BeneosCombatDeathWindow._onRollChip,
      "cdx-combat-close":       BeneosCombatDeathWindow._onCombatClose,
    },
  };

  static PARTS = { main: { template: `${TEMPLATE_ROOT}/parts/combat-death-page.hbs` } };

  _tokenKey = null;
  _actorId = null;

  static openForActor(actor) {
    if (!actor) return null;
    const flag = actor.getFlag?.("world", "beneos") ?? {};
    const tokenKey = flag.tokenKey ?? flag.fullId ?? actor.id;
    const id = `beneos-combat-death-${actor.id}`;
    const existing = foundry.applications?.instances?.get?.(id);
    if (existing) { try { (existing.bringToFront ?? existing.bringToTop)?.call(existing); } catch (_) {} existing.render({ force: true }); return existing; }
    const win = new BeneosCombatDeathWindow({ id });
    win._tokenKey = tokenKey;
    win._actorId = actor.id;
    win.render({ force: true });
    return win;
  }

  get title() {
    const actor = this._actorId ? game.actors?.get?.(this._actorId) : null;
    return actor?.name ?? game.i18n.localize("BENEOS.CreatureCodex.Combat.DeathTitle");
  }

  async _prepareContext(_options) {
    const creature = await buildCreatureDetailCtx({ tokenKey: this._tokenKey });
    return { creature, tokenKey: this._tokenKey };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    attachItemSheetContextMenu(this.element);
  }

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
  static async _onCombatClose(_ev, target) {
    const tokenKey = target?.closest?.("[data-token-key]")?.dataset?.tokenKey ?? this._tokenKey;
    const mute = this.element?.querySelector?.(".cdx-combat-optout")?.checked;
    if (mute) await BeneosCombatPromptEngine.setOptOut(tokenKey, "readaloud");
    this.close();
  }
}
