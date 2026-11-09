import { getLootFlags, beneosCloudCardPaths, isBeneosSrdItem } from "./loot-schema.mjs";
import { karteFuerBlatt } from "../stream/stream-karten.mjs";
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

// DER HAKENNAME IST GEMESSEN UND NICHT GERATEN, OP-PRJ-216.
//
// Bis zum 2026-11-09 stand hier `renderItemSheet`, der Name aus Fassung 12.
// Gemessen am 2026-11-08 in der Welt `v13-streaming` mit einem Zaehler auf
// beiden Namen: beim Oeffnen eines Item-Blattes feuert `renderItemSheet`
// NULL mal und `renderItemSheet5e` EIN mal. Die Klassenkette von dnd5e 5.3.3
// fuehrt den alten Namen nicht, und `ItemSheet5e` erbt auch nicht von
// `ItemSheetV2`, also feuert `renderItemSheetV2` ebenfalls nicht.
//
// WAS DAS GEKOSTET HAT: `_inject()` wurde nie gerufen. Gemessen am selben
// Tag an einem Item MIT vollstaendigen Beute-Vermerken stand
// `.beneos-loot-extras` null mal im Blatt, und kein einziges Element mit
// `beneos` im Namen. Die Tabelle aus Typ, Set-Typ und Stufe sah der Kunde
// also nicht. Das war ein Kundenausfall und nicht nur toter Code.
//
// EIN NAME UND NICHT MEHRERE. Foundry V13 laesst alle Eltern-Haken der
// Klassenkette feuern, also auch `renderDocumentSheetV2` und
// `renderApplicationV2`. Ein Haken darauf rief `_inject()` dreimal je Render.
// Der Doppelschutz unten faengt das, aber dreimal zu rechnen, um zweimal
// nichts zu tun, ist kein Entwurf. Dieselbe Wahl trifft
// `scripts/codex2/item-companion.mjs` mit derselben Begruendung.
//
// Geprueft von `item-sheet-extender.test.mjs`, und zwar in beide Richtungen:
// dass dieser Name hier steht, und dass keiner der stummen oder der zu
// breiten Namen hier steht.
const HAKEN = "renderItemSheet5e";

export class ItemSheetExtender {

  static register() {
    Hooks.on(HAKEN, (sheet, htmlOrJq, _data) => {
      try {
        // Der Haken traegt nur Item-Blaetter, aber die Abfrage kostet nichts
        // und haelt die Funktion unabhaengig vom Namen darueber.
        const doc = sheet?.document ?? sheet?.object ?? sheet?.item;
        if (doc?.documentName !== "Item") return;
        ItemSheetExtender._inject(sheet, htmlOrJq);
      } catch (e) {
        console.warn("Beneos | ItemSheetExtender inject failed:", e);
      }
    });
  }

  static async _inject(sheet, htmlOrJq) {
    // `document` steht VORNE, und das ist der Teil, ohne den der neue
    // Hakenname allein nichts aendert: ein ApplicationV2-Blatt fuehrt
    // sein Dokument unter `document`, und `item` kann fehlen. Dieselbe
    // Reihenfolge nimmt `item-companion.mjs`.
    const item = sheet?.document ?? sheet?.item ?? sheet?.object;
    if (!item) return;

    const loot = getLootFlags(item);
    if (!loot) return;

    const root = htmlOrJq?.jquery ? htmlOrJq[0] : htmlOrJq;
    if (!(root instanceof HTMLElement) && !(root instanceof DocumentFragment)) return;

    // Avoid double-injection (sheet can re-render multiple times).
    if (root.querySelector(":scope .beneos-loot-extras[data-beneos-loot]")) return;

    const ctx = await ItemSheetExtender._buildContext(loot, item);
    const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE_PATH, ctx);

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

  static async _buildContext(loot, item) {
    // SRD items have no Origin: force the badge off (belt-and-suspenders on top
    // of the template's {{#if originDef}} gate, in case a stray slug is set).
    const isSrd = isBeneosSrdItem(item, loot);
    const originDef = (!isSrd && loot.origin?.slug) ? OriginsRegistry.get(loot.origin.slug) : null;
    const originIconPath = (!isSrd && loot.origin?.slug) ? OriginsRegistry.iconPath(loot.origin.slug, "color") : null;

    // Prefer the reconstructed local cloud path (fixes SRD items whose stored
    // render paths point nowhere); fall back to the stored render values.
    const cloudCards = beneosCloudCardPaths(item);
    // `OP-PRJ-141` Teil 2: DER VORRANG WAR FALSCH, sobald das Streaming
    // traegt. `beneosCloudCardPaths()` bildet einen oertlichen Pfad aus der
    // Kennung und liefert damit IMMER einen Wert; eine Toradresse in
    // `render.*CardWebp` wurde davon verdraengt und nie benutzt.
    //
    // `karteFuerBlatt()` dreht den Vorrang nur dort um, wo eine Toradresse
    // steht, und faellt sonst auf genau diese zwei Zeilen zurueck. Eine
    // oertlich installierte Welt verhaelt sich Zeichen fuer Zeichen wie
    // vorher, und das ist die Bedingung dafuer, dass hier gebaut werden darf.
    //
    // Der Gewinn ist nicht die Adresse, sondern die ABWESENHEIT: `OP-PRJ-139`
    // hat sechs Eintraege gezaehlt, deren Rueckseite es nicht oder nicht als
    // WebP gibt. Eine gebildete Adresse zeigt dort am Tor ein durchsichtiges
    // GIF von 42 Byte, also ein gueltiges Bild ohne Fehlermeldung; jetzt
    // faellt die Kachel weg.
    const vorne = await karteFuerBlatt(
      loot.render?.frontCardWebp || null, cloudCards.front, "front");
    const hinten = await karteFuerBlatt(
      loot.render?.backCardWebp || null, cloudCards.back, "back");
    const frontCard = vorne.src;
    const backCard  = hinten.src;

    return {
      loot,
      originDef,
      originIconPath,
      frontCard,
      backCard,
      hasCards: !!(frontCard || backCard),
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
