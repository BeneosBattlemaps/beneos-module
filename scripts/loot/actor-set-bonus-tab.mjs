import { getLootFlags } from "./loot-schema.mjs";
import { OriginsRegistry } from "./origins-registry.mjs";
import { calculateSetBonuses } from "./set-bonus-calculator.mjs";
import { ORIGIN_META } from "../codex2/origin-meta.mjs";
import {
  buildSenseCompassContext,
  diffAndMaybeFarewell,
  clearActorState,
} from "./sense-compass-data.mjs";

/** True if the actor has at least one attuned item whose loot-flag
 *  carries a Beneos Origin slug. Drives the Beneos-tab injection:
 *  the tab + nav button + logo only appear when the actor is bound
 *  to at least one Origin item. Owned-not-attuned doesn't qualify
 *  (the tab would be empty of compass content). */
function _actorHasAttunedBeneosOrigin(actor) {
  if (!actor?.items) return false;
  for (const it of actor.items) {
    const f = getLootFlags(it);
    if (!f?.origin?.slug) continue;
    if (it.system?.attuned === true) return true;
    if (it.system?.attunement === 2) return true;
  }
  return false;
}

const TEMPLATE_PATH = "modules/beneos-module/templates/loot/set-bonus-tab.hbs";
const RE_RENDER_DEBOUNCE_MS = 200;
const BENEOS_TAB_ID = "beneos-sets";
const BENEOS_TAB_GROUP = "primary";

// Render the Beneos Sets primary tab into the dnd5e character sheet:
//  - eigene <section data-tab="beneos-sets" data-group="primary">
//  - Sidebar-Button (Beneos-Symbol) der den Tab aktiviert
//  - Re-render bei Item-Änderung (attunement/equipped) — debounced

export class ActorSetBonusTab {

  static _renderTimers = new Map();
  static _activeSenseByActor = new Map();

  static async register() {
    // Pre-register HBS partials so {{> "modules/.../...hbs"}} works inside
    // the set-bonus-tab template. Foundry's Handlebars wants explicit
    // partial keys; using full paths as keys is the simplest approach.
    const partials = [
      "modules/beneos-module/templates/loot/sense-compass.hbs",
      "modules/beneos-module/templates/loot/sense-needle.hbs",
      "modules/beneos-module/templates/loot/sense-readout.hbs",
    ];
    try {
      const map = Object.fromEntries(partials.map(p => [p, p]));
      const loader = foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
      if (loader) await loader(map);
    } catch (e) {
      console.warn("Beneos | sense-compass partial preload failed:", e);
    }

    const onRender = (sheet, htmlOrJq) => {
      try {
        ActorSetBonusTab._inject(sheet, htmlOrJq);
      } catch (e) {
        console.warn("Beneos | ActorSetBonusTab inject failed:", e);
      }
    };
    // dnd5e 5.3 (V2): renderCharacterActorSheet for PCs, renderNPCActorSheet
    // for monsters/NPCs. Legacy V1: renderActorSheet covers both.
    Hooks.on("renderCharacterActorSheet", onRender);
    Hooks.on("renderNPCActorSheet", onRender);
    Hooks.on("renderActorSheet", onRender);

    const onItemTouched = (item, changeOrOptions) => {
      try {
        const actor = item?.parent;
        if (!(actor && actor.documentName === "Actor")) return;
        if (!getLootFlags(item)) return;
        if (changeOrOptions?.system) {
          const touched =
               "attuned"    in (changeOrOptions.system ?? {})
            || "attunement" in (changeOrOptions.system ?? {})
            || "equipped"   in (changeOrOptions.system ?? {});
          if (!touched) return;
        }
        ActorSetBonusTab._scheduleRender(actor);
      } catch (e) {
        console.warn("Beneos | ActorSetBonusTab re-render trigger failed:", e);
      }
    };
    Hooks.on("updateItem", onItemTouched);
    Hooks.on("createItem", (item) => onItemTouched(item, {}));
    Hooks.on("deleteItem", (item) => onItemTouched(item, {}));

    // Drop per-actor state when an actor is deleted so the module-level
    // Maps don't grow unbounded over a long session.
    Hooks.on("deleteActor", (actor) => {
      const id = actor?.id;
      if (!id) return;
      const pending = ActorSetBonusTab._renderTimers.get(id);
      if (pending) clearTimeout(pending);
      ActorSetBonusTab._renderTimers.delete(id);
      ActorSetBonusTab._activeSenseByActor.delete(id);
      ActorSetBonusTab._lastNeedleAngle.delete(id);
      clearActorState(id);
    });

    // Live Game Control pings: when the GM changes the world-setting,
    // re-render every open Character/NPC sheet so the Sense Compass
    // updates immediately for all connected players.
    Hooks.on("updateSetting", (setting) => {
      try {
        const key = setting?.key ?? setting?.name ?? "";
        if (key !== "beneos-module.beneos-lgc-active-pings") return;
        // foundry.applications.instances is a Map (V13), so iterate via
        // .values(). The legacy ui.windows registry only holds AppV1
        // sheets and would miss dnd5e V2 sheets — covered for safety.
        const seen = new Set();
        const visit = (app) => {
          const actor = app?.actor ?? app?.object;
          if (!actor || actor.documentName !== "Actor" || seen.has(actor.id)) return;
          seen.add(actor.id);
          // First diff the matched-set against the previous one; if
          // we just lost the last ping, stage a farewell overlay so
          // the sheet re-render shows "contact lost" instead of an
          // abrupt dormant state.
          try { diffAndMaybeFarewell(actor); } catch (_) {}
          ActorSetBonusTab._scheduleRender(actor);
          // Second render once the farewell window closes (4s), so the
          // overlay fades out and the compass falls back to dormant.
          setTimeout(() => {
            if (actor.sheet?.rendered) {
              try { actor.sheet.render(false); } catch (_) {}
            }
          }, 4100);
        };
        const map = foundry.applications?.instances;
        if (map?.forEach) map.forEach(visit);
        else if (map?.values) for (const a of map.values()) visit(a);
        for (const a of Object.values(ui.windows ?? {})) visit(a);
      } catch (e) { /* non-fatal */ }
    });
  }

  static _scheduleRender(actor) {
    const existing = ActorSetBonusTab._renderTimers.get(actor.id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      ActorSetBonusTab._renderTimers.delete(actor.id);
      if (actor.sheet?.rendered) actor.sheet.render(false);
    }, RE_RENDER_DEBOUNCE_MS);
    ActorSetBonusTab._renderTimers.set(actor.id, t);
  }

  static async _inject(sheet, htmlOrJq) {
    const actor = sheet?.actor ?? sheet?.object;
    if (!actor || (actor.type !== "character" && actor.type !== "npc")) return;

    const root = htmlOrJq?.jquery ? htmlOrJq[0] : htmlOrJq;
    if (!(root instanceof HTMLElement) && !(root instanceof DocumentFragment)) return;

    // Gate 1: world-setting "Use Beneos Items Set Bonuses". If the GM
    // has disabled the feature entirely, no Beneos tab on any sheet.
    let featureEnabled = true;
    try {
      featureEnabled = game.settings.get("beneos-module", "beneos-loot-set-bonuses") !== false;
    } catch (_) { /* setting may not be registered yet during init */ }

    // Gate 2: attunement. Do not inject the Beneos tab, section or
    // logo unless this actor is bound to at least one Origin item.
    const hasAttuned = featureEnabled && _actorHasAttunedBeneosOrigin(actor);
    if (!hasAttuned) {
      root.querySelector(`:scope section[data-tab="${BENEOS_TAB_ID}"]`)?.remove();
      root.querySelector(`nav.tabs[data-group="${BENEOS_TAB_GROUP}"] [data-tab="${BENEOS_TAB_ID}"]`)?.remove();
      return;
    }

    // Re-render path: if the section already exists from a previous render,
    // remove it so the new context (incl. updated senseCompass active id)
    // takes effect. Also keep the existing tab-button so we don't double it.
    const existing = root.querySelector(`:scope section[data-tab="${BENEOS_TAB_ID}"]`);
    const wasActive = existing?.classList?.contains("active");
    if (existing) existing.remove();

    const groups = calculateSetBonuses(actor);
    const activeSenseId = ActorSetBonusTab._activeSenseByActor.get(actor.id) ?? null;
    const ctx = {
      isEmpty: groups.length === 0,
      groups: groups.map(g => ActorSetBonusTab._enrichGroup(g)),
      senseCompass: buildSenseCompassContext(actor, activeSenseId),
    };

    const html = await renderTemplate(TEMPLATE_PATH, ctx);

    // 1. Tab-Section: append next to existing primary <section> sections.
    const lastPrimarySection =
         [...root.querySelectorAll('section.tab[data-group="primary"]')].pop()
      ?? root.querySelector('.sheet-body')
      ?? root;
    lastPrimarySection.insertAdjacentHTML("afterend", html);

    // Preserve the "active" state across re-renders.
    if (wasActive) {
      root.querySelector(`section[data-tab="${BENEOS_TAB_ID}"]`)?.classList.add("active");
    }

    // 2. Tab-Button: in der primary nav.tabs Strip neben Details/Inventory/etc.
    ActorSetBonusTab._injectTabButton(sheet, root);

    // 3. Wire effect-box toggles + active-state sync.
    ActorSetBonusTab._wireInteractions(sheet, root);

    // 4. Smooth needle rotation across re-renders. The HBS render
    // replaces .needle-aim in the DOM, so the CSS transition would
    // never fire (no state change for the browser). We restore the
    // previous angle as an initial style, then RAF-bump to the new
    // angle so the transition kicks in. Picks the short-way path so
    // the needle never sweeps the long way round.
    ActorSetBonusTab._applyNeedleSmoothing(actor, root);
  }

  static _lastNeedleAngle = new Map();

  static _applyNeedleSmoothing(actor, root) {
    const needleAim = root.querySelector?.(".needle-aim");
    if (!needleAim) return;
    const targetRaw = needleAim.style.getPropertyValue("--target-angle");
    const newAngle = parseFloat(targetRaw);
    if (!Number.isFinite(newAngle)) return;

    const prev = ActorSetBonusTab._lastNeedleAngle.get(actor.id);
    if (prev != null && Math.abs(prev - newAngle) > 0.5) {
      // Compute the equivalent target on the same "side" as prev so
      // the CSS rotate animates the shortest arc, not the long way.
      let delta = (newAngle - prev) % 360;
      if (delta >  180) delta -= 360;
      if (delta < -180) delta += 360;
      const animatedTo = prev + delta;
      // Initial paint: keep the previous angle, no transition yet.
      needleAim.style.setProperty("--target-angle", `${prev}deg`);
      // Two RAFs so the browser registers the initial state before
      // we mutate it (otherwise the change collapses to a single
      // commit and the transition doesn't fire).
      requestAnimationFrame(() => requestAnimationFrame(() => {
        needleAim.style.setProperty("--target-angle", `${animatedTo}deg`);
      }));
    }
    ActorSetBonusTab._lastNeedleAngle.set(actor.id, newAngle);
  }

  static _enrichGroup(g) {
    const slug = g.slug;
    const def = g.originDef;
    const meta = ORIGIN_META[slug] ?? {};
    const i18nName = game.i18n.localize(`BENEOS.Codex.Origins.${slug}.Name`);
    const originName = (i18nName && i18nName !== `BENEOS.Codex.Origins.${slug}.Name`)
      ? i18nName : (def?.display_name ?? slug);

    // Echo is NOT a set bonus — it's the baseline trait of every Generic
    // Origin item (and only matters at the Forge for assigning Origin to
    // a mundane item). The set-bonus tab focuses on Resonance + Harmony.
    const effects = [];
    if (g.tiers.resonance && def?.tiers?.resonance) {
      const arr = Array.isArray(def.tiers.resonance) ? def.tiers.resonance : [def.tiers.resonance];
      arr.forEach((r, i) => {
        const path = arr.length > 1 ? `Resonance.${i}` : "Resonance";
        effects.push({
          tier: "resonance",
          label: game.i18n.localize("BENEOS.Sheet.Tier.Resonance") + (arr.length > 1 ? ` ${i + 1}` : ""),
          rulesHtml: ActorSetBonusTab._renderRules(slug, path, r.rules),
        });
      });
    }
    if (g.tiers.harmony && def?.tiers?.harmony) {
      effects.push({
        tier: "harmony",
        label: game.i18n.localize("BENEOS.Sheet.Tier.Harmony"),
        rulesHtml: ActorSetBonusTab._renderRules(slug, "Harmony", def.tiers.harmony.rules),
      });
    }

    // Tier-Pill states + conditions. Echo is intentionally omitted —
    // it's a per-item baseline trait, not a set bonus.
    const count = g.attunedCount ?? 0;
    const tierStates = [
      {
        key: "resonance",
        label: game.i18n.localize("BENEOS.Sheet.Tier.Resonance"),
        active: g.tiers.resonance,
        statusKey: g.tiers.resonance ? "BENEOS.Sheet.Tier.Active" : "BENEOS.Sheet.Tier.Locked",
        condition: g.tiers.resonance
          ? game.i18n.format("BENEOS.Sheet.Tier.CountAttuned", { n: count })
          : game.i18n.format("BENEOS.Sheet.Tier.NeedsMore", { n: Math.max(0, 2 - count) }),
      },
      {
        key: "harmony",
        label: game.i18n.localize("BENEOS.Sheet.Tier.Harmony"),
        active: g.tiers.harmony,
        statusKey: g.tiers.harmony ? "BENEOS.Sheet.Tier.Active" : "BENEOS.Sheet.Tier.Locked",
        condition: g.tiers.harmony
          ? game.i18n.format("BENEOS.Sheet.Tier.CountAttuned", { n: count })
          : game.i18n.format("BENEOS.Sheet.Tier.NeedsMore", { n: Math.max(0, 3 - count) }),
      },
    ];
    for (const t of tierStates) t.statusLabel = game.i18n.localize(t.statusKey);

    // Rarity-Modifier pip-bar: 15 pips total (3 attuned items × Legendary 5).
    const RM_MAX = 15;
    const rmFilled = Math.min(Math.max(g.rarityModifierSum || 0, 0), RM_MAX);
    const rmPips = Array.from({ length: RM_MAX }, (_, i) => ({ filled: i < rmFilled }));

    return {
      ...g,
      originName,
      originIconPath: def ? OriginsRegistry.iconPath(slug, "color") : null,
      glow: meta.glow ?? "rgba(212,168,87,0.40)",
      mono: meta.mono ?? slug.slice(0, 2).toUpperCase(),
      effects,
      tierStates,
      rmPips,
    };
  }

  // i18n lookup with fallback to origins.json rules
  static _renderRules(slug, tierPath, fallback) {
    const key = `BENEOS.Codex.Origins.${slug}.Tiers.${tierPath}.Rules`;
    const v = game.i18n.localize(key);
    const md = (v && v !== key) ? v : (fallback || "");
    return ActorSetBonusTab._markdownToHtml(md);
  }

  static _markdownToHtml(md) {
    if (!md) return "";
    let html = String(md);
    html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.*?)__/g, "<em>$1</em>");
    html = html.replace(/\n{2,}/g, "</p><p>");
    html = html.replace(/\n/g, "<br>");
    return `<p>${html}</p>`;
  }

  static _injectTabButton(sheet, root) {
    const nav = root.querySelector(`nav.tabs[data-group="${BENEOS_TAB_GROUP}"]`);
    if (!nav) return;
    if (nav.querySelector(':scope a.beneos-tab-button')) return;

    const a = document.createElement('a');
    a.className = 'item control beneos-tab-button';
    a.dataset.action = 'tab';
    a.dataset.group = BENEOS_TAB_GROUP;
    a.dataset.tab = BENEOS_TAB_ID;
    a.setAttribute('data-tooltip', game.i18n.localize('BENEOS.Sheet.SetBonusTabTooltip'));
    a.setAttribute('aria-label', game.i18n.localize('BENEOS.Sheet.SetBonusTab'));
    a.innerHTML = `<i class="beneos-tab-icon" inert></i>`;
    nav.appendChild(a);
  }

  static _wireInteractions(sheet, root) {
    const tabSection = root.querySelector(`section[data-tab="${BENEOS_TAB_ID}"]`);
    const tabBtn = root.querySelector('a.beneos-tab-button');
    if (!tabSection) return;

    // Fallback click-handler: if dnd5e's native [data-action="tab"] delegate
    // doesn't fire on our dynamically injected anchor (which wasn't in the
    // TabsV2 init list), do the activation manually. Native handler fires
    // first and unless it activated us we step in.
    tabBtn?.addEventListener('click', (ev) => {
      // Yield to dnd5e's native handler; if after a tick our tab is still
      // inactive, force it.
      setTimeout(() => {
        if (!tabSection.classList.contains('active')) {
          ActorSetBonusTab._activateTab(root, sheet);
        }
      }, 50);
    });

    // Effect-box toggle + Sense-compass "Also stirring" row click
    const actor = sheet?.actor ?? sheet?.object;
    tabSection.addEventListener('click', (ev) => {
      // Origin icon / name click → open Codex on that Origin's page.
      // Same pattern as the Companion sheet's _openCodexForOrigin.
      const codexBtn = ev.target.closest('[data-action="beneos-set-open-codex"]');
      if (codexBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const slug = codexBtn.dataset.origin;
        ActorSetBonusTab._openCodexForOrigin(slug);
        return;
      }
      const senseRow = ev.target.closest('[data-action="beneos-select-sense"]');
      if (senseRow && actor) {
        ev.preventDefault();
        ev.stopPropagation();
        ActorSetBonusTab._activeSenseByActor.set(actor.id, senseRow.dataset.senseId);
        sheet.render(false);
        return;
      }
      const head = ev.target.closest('.beneos-set-effect__head');
      if (!head) return;
      ev.preventDefault();
      head.parentElement.classList.toggle('is-open');
    });
  }

  /** Open the Beneos Codex on the given Origin page. Mirrors the
   *  companion sheet's icon-click pattern (item-companion.mjs
   *  _openCodexForOrigin) so both routes feel identical. */
  static async _openCodexForOrigin(slug) {
    if (!slug) return;
    try {
      const mod = await import("../codex2/beneos-codex.mjs");
      mod.BeneosCodex?.open?.("items", "origins", slug);
    } catch (err) {
      const apiOpen = game.modules.get("beneos-module")?.api?.codex?.open;
      if (typeof apiOpen === "function") apiOpen("items", "origins", slug);
      else ui.notifications?.warn?.("Beneos Codex not available");
    }
  }

  static _activateTab(root, sheet) {
    const group = BENEOS_TAB_GROUP;
    const allSections = root.querySelectorAll(`section[data-group="${group}"]`);
    const allTabs = root.querySelectorAll(`[data-group="${group}"][data-tab]`);
    for (const s of allSections) s.classList.toggle('active', s.dataset.tab === BENEOS_TAB_ID);
    for (const t of allTabs)     t.classList.toggle('active', t.dataset.tab === BENEOS_TAB_ID);
    // Inform dnd5e's Tabs controller, so a subsequent click on a regular tab works.
    try {
      const tabs = sheet?.tabGroups?.[group];
      if (tabs !== undefined && sheet.tabGroups) sheet.tabGroups[group] = BENEOS_TAB_ID;
    } catch (_) { /* non-fatal */ }
  }
}

// Markdown helper for inline-template usage (kept for legacy templates).
Hooks.once("init", () => {
  if (Handlebars?.helpers?.markdownToHtml) return;
  Handlebars.registerHelper("markdownToHtml", function(md) {
    if (!md) return "";
    let html = String(md);
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.*?)__/g, "<em>$1</em>");
    html = html.replace(/(^|\n)[\-*] (.*?)(?=\n|$)/g, (_, br, li) => `${br}<li>${li}</li>`);
    html = html.replace(/\n{2,}/g, "</p><p>");
    html = html.replace(/\n/g, "<br>");
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
    html = html.replace(/<\/ul>\s*<ul>/g, "");
    return new Handlebars.SafeString(`<p>${html}</p>`);
  });
});
