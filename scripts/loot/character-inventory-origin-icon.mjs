import { getLootFlags } from "./loot-schema.mjs";
import { OriginsRegistry } from "./origins-registry.mjs";

// Decorate the dnd5e character-sheet inventory rows with a small Origin
// icon right after the item name. Lets the GM/player identify Beneos
// items by Origin at a glance.

export class CharacterInventoryOriginIcon {

  static register() {
    const onRender = (sheet, htmlOrJq) => {
      try {
        CharacterInventoryOriginIcon._inject(sheet, htmlOrJq);
      } catch (e) {
        console.warn("Beneos | CharacterInventoryOriginIcon inject failed:", e);
      }
    };
    // dnd5e 5.3 ApplicationV2 fires renderCharacterActorSheet for PCs,
    // renderNPCActorSheet for NPCs; legacy V1 fires renderActorSheet.
    Hooks.on("renderCharacterActorSheet", onRender);
    Hooks.on("renderNPCActorSheet", onRender);
    Hooks.on("renderActorSheet", onRender);
  }

  static _inject(sheet, htmlOrJq) {
    const actor = sheet?.actor ?? sheet?.object;
    if (!actor || (actor.type !== "character" && actor.type !== "npc")) return;

    const root = htmlOrJq?.jquery ? htmlOrJq[0] : htmlOrJq;
    if (!(root instanceof HTMLElement) && !(root instanceof DocumentFragment)) return;

    const rows = root.querySelectorAll('li[data-item-id] .item-row');
    for (const row of rows) {
      const li = row.closest('[data-item-id]');
      const itemId = li?.dataset?.itemId;
      if (!itemId) continue;
      const item = actor.items.get(itemId);
      if (!item) continue;
      const slug = getLootFlags(item)?.origin?.slug;
      if (!slug) continue;

      const nameEl = row.querySelector('.item-name .name.name-stacked');
      if (!nameEl) continue;
      // Avoid duplicate pills on re-render.
      if (nameEl.nextElementSibling?.classList?.contains('beneos-origin-pill')) continue;

      const iconPath = OriginsRegistry.iconPath(slug, "color");
      if (!iconPath) continue;
      const originDef = OriginsRegistry.get(slug);
      const i18nName = game.i18n.localize(`BENEOS.Codex.Origins.${slug}.Name`);
      const originName = (i18nName && i18nName !== `BENEOS.Codex.Origins.${slug}.Name`)
        ? i18nName : (originDef?.display_name ?? slug);
      const clickHint = game.i18n.localize("BENEOS.Pill.ClickToOpen");

      const pill = document.createElement('span');
      pill.className = 'beneos-origin-pill';
      pill.dataset.originSlug = slug;
      pill.dataset.itemId = itemId;
      pill.setAttribute('role', 'button');
      pill.setAttribute('aria-label', originName);
      // Two-line themed tooltip via data-tooltip-html + custom class.
      pill.setAttribute('data-tooltip', `<strong>${originName}</strong><small>${clickHint}</small>`);
      pill.setAttribute('data-tooltip-html', '');
      pill.setAttribute('data-tooltip-class', 'beneos-origin-tooltip');
      pill.setAttribute('data-tooltip-direction', 'UP');
      pill.innerHTML = `<img src="${iconPath}" alt="${originName}">`;
      // Click → open the item sheet (so the Companion attaches via the
      // existing renderItemSheet5e hook). stopPropagation prevents the
      // surrounding .item-name's roll/use action from also firing.
      pill.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try { item.sheet?.render(true); } catch (e) { console.warn("Beneos | open item failed:", e); }
      });
      // Also intercept the parent's pointerdown so dnd5e's drag-to-roll
      // doesn't pick up the pill.
      pill.addEventListener('mousedown', (ev) => ev.stopPropagation());
      nameEl.insertAdjacentElement('afterend', pill);
    }
  }
}
