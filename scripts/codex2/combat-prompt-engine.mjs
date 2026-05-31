// Beneos Combat Prompt Engine — GM-only in-combat assistant.
// Fades in two interactive windows during an encounter:
//   - Death window when a Beneos creature drops to 0 HP (Combat-Theater
//     death prompt).
//   - Autopilot window when a Beneos creature with an autopilot script
//     takes its turn (Tactical-Guide round-by-round play).
// Both are gated by world settings and per-creature, client-local opt-outs.

import { hasV13CodexContent } from "../codex/codex-data-adapter.mjs";
import { isWip } from "./creature-codex.mjs";
import { BeneosCombatDeathWindow } from "./combat-death-window.mjs";
import { BeneosCombatAutopilotWindow } from "./combat-autopilot-window.mjs";

// Dedupe so each prompt fires once per relevant combat state.
const _deathFired = new Set();      // `${combatId}:${actorId}`
const _autopilotFired = new Set();  // `${combatId}:${combatantId}:${round}`

function _isGM() { return !!game.user?.isGM; }
function _setting(key) { try { return game.settings.get("beneos-module", key); } catch (_) { return false; } }

function _tokenKeyOf(actor) {
  const flag = actor?.getFlag?.("world", "beneos") ?? {};
  return flag.tokenKey ?? flag.fullId ?? actor?.id ?? null;
}

function _optOutMap() {
  try { return game.settings.get("beneos-module", "codex-combat-optout") ?? {}; }
  catch (_) { return {}; }
}
function _optedOut(tokenKey, kind) {
  if (!tokenKey) return false;
  return !!_optOutMap()?.[tokenKey]?.[kind];
}
async function _setOptOut(tokenKey, kind) {
  if (!tokenKey) return;
  const map = foundry.utils.deepClone(_optOutMap());
  map[tokenKey] = { ...(map[tokenKey] ?? {}), [kind]: true };
  try { await game.settings.set("beneos-module", "codex-combat-optout", map); } catch (_) {}
}

/** Is the actor part of the currently active encounter? */
function _inActiveCombat(actor) {
  const combat = game.combat;
  if (!combat?.started && !combat?.combatants?.size) return false;
  return !!combat?.combatants?.some?.(c => c.actorId === actor?.id);
}

export const BeneosCombatPromptEngine = {
  // Exposed so the windows can persist the per-creature opt-out checkbox.
  setOptOut: _setOptOut,
  optedOut: _optedOut,

  init() {
    // Death: preUpdateActor fires before the HP write is committed, so we
    // compare the pre-state HP (actor) against the incoming change.
    Hooks.on("preUpdateActor", (actor, changes) => {
      try { BeneosCombatPromptEngine._onActorHp(actor, changes); }
      catch (e) { console.warn("Beneos | death prompt trigger failed:", e); }
    });

    // Autopilot: a turn or round change in the active combat.
    Hooks.on("updateCombat", (combat, change) => {
      try { BeneosCombatPromptEngine._onCombatUpdate(combat, change); }
      catch (e) { console.warn("Beneos | autopilot trigger failed:", e); }
    });

    // Reset dedupe when a combat ends so a fresh encounter prompts again.
    Hooks.on("deleteCombat", (combat) => {
      const id = combat?.id;
      if (!id) return;
      for (const k of [..._deathFired]) if (k.startsWith(`${id}:`)) _deathFired.delete(k);
      for (const k of [..._autopilotFired]) if (k.startsWith(`${id}:`)) _autopilotFired.delete(k);
    });

    // Encounter tracker: a small Beneos-logo button per Beneos creature
    // that opens its Creature Codex.
    Hooks.on("renderCombatTracker", (app, html) => {
      try { BeneosCombatPromptEngine._injectTrackerButtons(html); }
      catch (e) { console.warn("Beneos | tracker codex button failed:", e); }
    });
  },

  _injectTrackerButtons(html) {
    if (!_isGM()) return;
    const root = (html instanceof HTMLElement) ? html : html?.[0];
    const combat = game.combat;
    if (!root || !combat) return;
    for (const el of root.querySelectorAll("[data-combatant-id]")) {
      if (el.querySelector(".beneos-tracker-codex")) continue;     // idempotent
      const combatant = combat.combatants?.get?.(el.dataset.combatantId);
      const actor = combatant?.actor;
      if (!actor || !hasV13CodexContent(actor)) continue;
      const controls = el.querySelector(".combatant-controls") || el;
      const btn = document.createElement("a");
      btn.className = "combatant-control beneos-tracker-codex";
      btn.setAttribute("role", "button");
      btn.dataset.tooltip = game.i18n.localize("BENEOS.CreatureCodex.Combat.OpenCodex");
      btn.innerHTML = `<img src="modules/beneos-module/icons/beneos_logo.svg" alt="">`;
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try { game.beneos?.codex?.openForActor?.(actor); } catch (_) {}
      });
      controls.appendChild(btn);
    }
  },

  _onActorHp(actor, changes) {
    if (!_isGM() || !actor) return;
    if (!_setting("codex-death-popup")) return;
    const newHp = changes?.system?.attributes?.hp?.value;
    if (newHp === undefined || newHp === null) return;
    const oldHp = actor.system?.attributes?.hp?.value ?? 0;
    if (!(oldHp > 0 && Number(newHp) <= 0)) return;     // only the 0-HP transition
    if (!hasV13CodexContent(actor)) return;
    if (!_inActiveCombat(actor)) return;
    // Don't auto-open for placeholder/empty death prompts ("Work in Progress").
    if (isWip(actor.flags?.beneos?.content?.immersive?.deathPrompt)) return;
    const tokenKey = _tokenKeyOf(actor);
    if (_optedOut(tokenKey, "readaloud")) return;
    const dedupe = `${game.combat?.id}:${actor.id}`;
    if (_deathFired.has(dedupe)) return;
    _deathFired.add(dedupe);
    BeneosCombatDeathWindow.openForActor(actor);
  },

  _onCombatUpdate(combat, change) {
    if (!_isGM() || !combat) return;
    if (!("turn" in change) && !("round" in change)) return;
    if (!_setting("codex-autopilot-popup")) return;
    const combatant = combat.combatant;
    const actor = combatant?.actor;
    if (!actor || !hasV13CodexContent(actor)) return;
    if (!actor.flags?.beneos?.content?.autopilot) return;
    const tokenKey = _tokenKeyOf(actor);
    if (_optedOut(tokenKey, "autopilot")) return;
    const round = combat.round ?? 1;
    const dedupe = `${combat.id}:${combatant.id}:${round}`;
    if (_autopilotFired.has(dedupe)) return;
    _autopilotFired.add(dedupe);
    BeneosCombatAutopilotWindow.openForActor(actor, round);
  },
};
