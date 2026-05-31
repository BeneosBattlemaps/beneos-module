import { getLootFlags } from "./loot-schema.mjs";
import { OriginsRegistry } from "./origins-registry.mjs";

const TEMPLATE_PATH = "modules/beneos-module/templates/loot/item-sheet-extras.hbs";

// Inject the Beneos Loot extras (Origin badge, Tier chip, Flavor quote,
// Card preview) into the item sheet whenever an item carries
// flags.beneos-module.loot. Works for dnd5e Item5e sheets (V2 = HTMLElement)
// and the legacy V1 (jQuery) path defensively.
//
// Also hides the legacy HTML sections in the item's system.description.value
// that the Beneos extras now render dynamically (Type/Set Type/Tier table,
// Flavor row with icon, Item Card secret section, divider). Same heuristic
// the old migrator used to strip, but applied as a non-destructive CSS hide
// so installations without the module still see the full description.

export class ItemSheetExtender {

  static register() {
    Hooks.on("renderItemSheet", (sheet, htmlOrJq, _data) => {
      try {
        ItemSheetExtender._inject(sheet, htmlOrJq);
      } catch (e) {
        console.warn("Beneos | ItemSheetExtender inject failed:", e);
      }
    });
  }

  static async _inject(sheet, htmlOrJq) {
    const item = sheet?.item ?? sheet?.object;
    if (!item) return;

    const loot = getLootFlags(item);
    if (!loot) return;

    const root = htmlOrJq?.jquery ? htmlOrJq[0] : htmlOrJq;
    if (!(root instanceof HTMLElement) && !(root instanceof DocumentFragment)) return;

    // Avoid double-injection (sheet can re-render multiple times).
    if (root.querySelector(":scope .beneos-loot-extras[data-beneos-loot]")) return;

    const ctx = ItemSheetExtender._buildContext(loot);
    const html = await renderTemplate(TEMPLATE_PATH, ctx);

    // dnd5e V2 ItemSheet renders the description text inside
    //   .tab[data-tab="description"] .editor / .editor-content / .item-description
    // V1 used #description. Inject at the top of whichever container we find first.
    const target =
         root.querySelector('.tab[data-tab="description"]')
      ?? root.querySelector('section[data-application-part="description"]')
      ?? root.querySelector('.sheet-body .description')
      ?? root.querySelector('.sheet-body')
      ?? root;

    target.insertAdjacentHTML("afterbegin", html);

    // After injecting our extras, mark the legacy Type/Cards/Flavor blocks
    // in the description so they don't render alongside our dynamic version.
    ItemSheetExtender._annotateLegacySections(root);

    // Wire the "Show original description" toggle inside the just-injected extras.
    ItemSheetExtender._wireToggle(root);
  }

  // Walks the rendered description and marks every direct block element
  // AFTER the first <h1> + first <div> with data-beneos-legacy-hidden="true".
  // The first h1 (Item Description heading) and first div (mechanics body)
  // are preserved — same heuristic the old migrator used to strip.
  static _annotateLegacySections(root) {
    const containers = root.querySelectorAll(
      '.tab[data-tab="description"], section[data-application-part="description"], .item-description'
    );

    for (const container of containers) {
      // The injected beneos extras sit as the first child; skip them.
      // Also skip any nested .editor / .editor-content wrappers — we want the
      // direct sequence of rendered description blocks.
      const renderedHost = container.querySelector(':scope > .editor .editor-content, :scope > .editor-content') || container;

      const blocks = [...renderedHost.children].filter(el =>
        !el.matches('.beneos-loot-extras, [data-beneos-loot]')
      );

      let keptH1 = false;
      let keptDiv = false;
      for (const block of blocks) {
        const tag = block.tagName?.toLowerCase();
        if (!keptH1 && tag === 'h1') { keptH1 = true; continue; }
        if (!keptDiv && tag === 'div') { keptDiv = true; continue; }
        block.setAttribute('data-beneos-legacy-hidden', 'true');
      }
    }
  }

  static _wireToggle(root) {
    const toggle = root.querySelector(':scope .beneos-loot-extras [data-beneos-toggle-legacy]');
    if (!toggle) return;
    toggle.addEventListener('click', (ev) => {
      ev.preventDefault();
      const containers = root.querySelectorAll(
        '.tab[data-tab="description"], section[data-application-part="description"], .item-description'
      );
      let nowVisible = false;
      for (const container of containers) {
        const hidden = container.querySelectorAll('[data-beneos-legacy-hidden]');
        for (const el of hidden) {
          el.toggleAttribute('data-beneos-legacy-revealed');
          nowVisible = el.hasAttribute('data-beneos-legacy-revealed');
        }
      }
      toggle.textContent = nowVisible
        ? (game.i18n?.localize?.('BENEOS.Loot.HideLegacy') || 'Hide original sections')
        : (game.i18n?.localize?.('BENEOS.Loot.ShowLegacy') || 'Show original sections');
    });
  }

  static _buildContext(loot) {
    const originDef = loot.origin?.slug ? OriginsRegistry.get(loot.origin.slug) : null;
    const originIconPath = loot.origin?.slug ? OriginsRegistry.iconPath(loot.origin.slug, "color") : null;

    return {
      loot,
      originDef,
      originIconPath,
      hasCards: !!(loot.render?.frontCardWebp || loot.render?.backCardWebp),
      tierTooltip: ItemSheetExtender._tierTooltip(loot.tier?.number),
    };
  }

  static _tierTooltip(tierNumber) {
    // The Beneos Power-Tier (1..4) maps to character-level brackets.
    // Used as the chip tooltip; localized via the BENEOS.Loot.Tier.Bracket.<N> keys.
    if (!tierNumber) return "";
    const key = `BENEOS.Loot.Tier.Bracket.${tierNumber}`;
    const localized = game.i18n?.localize?.(key);
    return localized && localized !== key ? localized : "";
  }
}
