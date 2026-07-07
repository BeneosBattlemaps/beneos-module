// Beneos Forge — an ApplicationV2 embedded in the Item-Codex "Forge" tab (and
// usable standalone). It turns a non-Beneos / mundane SRD dnd5e Item into a
// Beneos item by imprinting a chosen Origin (see forge-imprint.mjs): the item
// gains the Origin's Echo bonus (text appended to its description), is renamed
// "<Origin> <name>", and is flagged so the radar / inventory pill / set-bonus
// tab recognise it once the player attunes it.
//
// Patreon-gated like the loot/shop generators: only active Creatures/Spells/
// Loot (tokens) patrons can forge; others see the controls blurred + a Join CTA.

import { OriginsRegistry } from "../loot/origins-registry.mjs";
import { imprintBeneosOrigin, changeBeneosOrigin, isForged, echoRulesToHtml } from "../loot/forge-imprint.mjs";
import { getLootFlags, isBeneosLootItem } from "../loot/loot-schema.mjs";
import { ORIGIN_META } from "../codex2/origin-meta.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BeneosForge extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-forge",
    classes: ["beneos-forge", "beneos_module"],
    tag: "section",
    window: { title: "BENEOS.Forge.WindowTitle", icon: "fa-solid fa-hammer", resizable: false, minimizable: true },
    position: { width: 880, height: "auto" },
    actions: {
      forgeStrike:        BeneosForge._onStrike,
      forgeReset:         BeneosForge._onReset,
      forgeClearItem:     BeneosForge._onClearItem,
      forgeSelectOrigin:  BeneosForge._onSelectOrigin,
    },
  };

  static PARTS = {
    body: { template: "modules/beneos-module/templates/cloud-v2/parts/forge-generator.hbs" },
  };

  _itemUuid = null;
  _itemName = null;
  _itemImg = null;
  _originSlug = null;
  _forging = false;
  _resultName = null;
  _resultImg = null;
  _resultUuid = null;
  // "forge" = imprint a non-Beneos item (Echo + rename + icon).
  // "change" = the dropped item is already Beneos -> only reassign its Origin.
  _mode = "forge";
  _resultIsChange = false;

  // Cursor sparkle-trail state (a few seconds of "casting magic" when ready).
  #sparkleHandler = null;
  #sparkleLayer = null;
  #sparkleUntil = 0;
  #sparkleStop = null;

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.hasTokenAccess = !!game.beneos?.cloud?.hasCampaignAccess?.("tokens");
    ctx.joinPatreonUrl = "https://www.patreon.com/c/BeneosTokens";
    ctx.origins = OriginsRegistry.all()
      .map((o) => {
        const meta = ORIGIN_META[o.slug] || {};
        return {
          slug: o.slug,
          name: o.display_name || o.slug,
          selected: o.slug === this._originSlug,
          icon: meta.image || null,
          // Leading-slash absolute path for the CSS-mask tint (matches the codex
          // Origin gallery): the colour WebP's alpha gives the form shape.
          iconMask: meta.image ? "/" + meta.image : null,
          glow: meta.glow || "#d4a857",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    ctx.hasItem = !!this._itemUuid;
    ctx.hasOrigin = !!this._originSlug;
    ctx.itemName = this._itemName;
    ctx.itemImg = this._itemImg;
    const originDoc = this._originSlug ? OriginsRegistry.get(this._originSlug) : null;
    const display = originDoc ? (originDoc.display_name || this._originSlug) : null;
    ctx.originName = display;
    const originMeta = this._originSlug ? (ORIGIN_META[this._originSlug] || {}) : {};
    ctx.originIcon = originMeta.image || null;
    ctx.originIconMask = originMeta.image ? "/" + originMeta.image : null;
    ctx.originGlow = originMeta.glow || "#d4a857";
    // Echo-of-Origin preview for the small text box under the picker.
    const echo = originDoc?.tiers?.echo || null;
    ctx.echoTitle = echo ? (echo.title || `${display}: Echo of Origin`) : null;
    ctx.echoHtml = echo ? echoRulesToHtml(echo.rules || echo.lore || "") : null;
    // Forge preview name: "<Origin> <item name>" (prefix once). Used by the
    // stamp under the anvil so the user sees exactly what will be created.
    let forgedPreview = null;
    if (display && this._itemName) {
      forgedPreview = this._itemName.startsWith(`${display} `) ? this._itemName : `${display} ${this._itemName}`;
    }
    ctx.forgedPreviewName = forgedPreview;
    ctx.stampNew = !!(forgedPreview && this._mode !== "change");
    ctx.canForge = !!(this._itemUuid && this._originSlug && !this._forging);
    ctx.forging = this._forging;
    ctx.isChangeMode = this._mode === "change";
    ctx.resultName = this._resultName;
    ctx.resultImg = this._resultImg;
    ctx.isChangeResult = this._resultIsChange;
    ctx.resultMessage = this._resultName
      ? game.i18n.format(this._resultIsChange ? "BENEOS.Forge.ChangeSuccess" : "BENEOS.Forge.Success", { name: this._resultName })
      : null;
    return ctx;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Drop target (ApplicationV2 actions don't cover drag/drop).
    const drop = this.element?.querySelector?.(".bf-drop");
    if (drop && !drop._bfDropWired) {
      drop._bfDropWired = true;
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-dragover"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
      drop.addEventListener("drop", (e) => this.#onDrop(e));
    }
    // Make the revealed forged item a drag source so it can be dropped onto a
    // character sheet (Foundry Item drag payload).
    const card = this.element?.querySelector?.(".bf-reveal-card");
    if (card && this._resultUuid && !card._bfDragWired) {
      card._bfDragWired = true;
      card.setAttribute("draggable", "true");
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: this._resultUuid }));
        e.dataTransfer.effectAllowed = "copy";
        const img = card.querySelector(".bf-reveal-img");
        if (img) { try { e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2); } catch (_) {} }
      });
    }
  }

  async #onDrop(event) {
    event.preventDefault();
    this.element?.querySelector?.(".bf-drop")?.classList.remove("is-dragover");
    if (this._forging) return;
    let data = null;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch (_) { /* not JSON */ }
    if (!data || data.type !== "Item") {
      ui.notifications?.warn?.(game.i18n.localize("BENEOS.Forge.NotAnItem"));
      return;
    }
    let item = null;
    try { item = await fromUuid(data.uuid); } catch (_) {}
    if (!item) { ui.notifications?.warn?.(game.i18n.localize("BENEOS.Forge.NotAnItem")); return; }
    // A Beneos item that already carries a REAL Origin can't be re-forged for
    // an Echo, but its Origin can be reassigned: switch to "change" mode and
    // preselect it. A plain or SRD base item (origin slug "srd" or none) is a
    // forge target , keep "forge" mode and do NOT clobber a previously chosen
    // Origin. Overwriting it with the "srd" sentinel (which has no ORIGIN_META
    // entry) is exactly what reset the picker and rendered the broken image.
    const droppedSlug = getLootFlags(item)?.origin?.slug || null;
    const hasRealOrigin = (isForged(item) || isBeneosLootItem(item)) && droppedSlug && droppedSlug !== "srd";
    if (hasRealOrigin) {
      this._mode = "change";
      this._originSlug = droppedSlug;
    } else {
      this._mode = "forge";
      // Preserve this._originSlug: a base/SRD item drop keeps the user's pick.
    }
    this._itemUuid = item.uuid;
    this._itemName = item.name;
    this._itemImg = item.img;
    this._resultName = null;
    this.#maybeSparkle();
    this.render({ parts: ["body"] });
  }

  static _onSelectOrigin(_ev, target) {
    const slug = target?.dataset?.slug || target?.closest?.("[data-slug]")?.dataset?.slug;
    if (!slug || this._forging) return;
    // Toggle off if the active origin is clicked again.
    this._originSlug = this._originSlug === slug ? null : slug;
    if (this._originSlug) this.#maybeSparkle();
    this.render({ parts: ["body"] });
  }

  static _onClearItem(_ev) {
    this._itemUuid = null; this._itemName = null; this._itemImg = null;
    this._resultName = null; this._resultImg = null; this._resultUuid = null;
    this._mode = "forge"; this._originSlug = null;
    this.#stopSparkles();
    this.render({ parts: ["body"] });
  }

  static _onReset(_ev) {
    this._itemUuid = null; this._itemName = null; this._itemImg = null;
    this._originSlug = null; this._resultName = null; this._resultImg = null;
    this._resultUuid = null;
    this._forging = false; this._mode = "forge"; this._resultIsChange = false;
    this.#stopSparkles();
    this.render({ parts: ["body"] });
  }

  _onClose(options) {
    this.#stopSparkles();
    return super._onClose?.(options);
  }

  // Kick off the cursor sparkle-trail when an item AND an Origin are both set
  // (we are about to "cast"). Skipped in performance mode.
  #maybeSparkle() {
    if (document.body.classList.contains("beneos-perf-mode")) return;
    if (!(this._itemUuid && this._originSlug)) return;
    this.#startSparkles(2600);
  }

  #startSparkles(durationMs) {
    this.#sparkleUntil = performance.now() + durationMs;
    if (this.#sparkleHandler) return; // already running -> just extended
    const layer = document.createElement("div");
    layer.className = "bf-sparkle-layer";
    document.body.appendChild(layer);
    this.#sparkleLayer = layer;
    let last = 0;
    const handler = (ev) => {
      const t = performance.now();
      if (t > this.#sparkleUntil) { this.#stopSparkles(); return; }
      if (t - last < 26) return;
      last = t;
      const s = document.createElement("span");
      s.className = "bf-sparkle";
      s.style.left = `${ev.clientX + (Math.random() - 0.5) * 14}px`;
      s.style.top = `${ev.clientY + (Math.random() - 0.5) * 14}px`;
      s.style.setProperty("--sx", `${((Math.random() - 0.5) * 30).toFixed(1)}px`);
      s.style.setProperty("--sy", `${(16 + Math.random() * 26).toFixed(1)}px`);
      layer.appendChild(s);
      s.addEventListener("animationend", () => s.remove());
    };
    this.#sparkleHandler = handler;
    window.addEventListener("mousemove", handler);
    this.#sparkleStop = setTimeout(() => this.#stopSparkles(), durationMs + 200);
  }

  #stopSparkles() {
    if (this.#sparkleHandler) window.removeEventListener("mousemove", this.#sparkleHandler);
    this.#sparkleHandler = null;
    if (this.#sparkleStop) { clearTimeout(this.#sparkleStop); this.#sparkleStop = null; }
    const layer = this.#sparkleLayer;
    this.#sparkleLayer = null;
    if (layer) setTimeout(() => layer.remove(), 900);
  }

  static async _onStrike(_ev) {
    if (!this._itemUuid || !this._originSlug || this._forging) return;
    const item = await fromUuid(this._itemUuid);
    if (!item) { this._itemUuid = null; this.render({ parts: ["body"] }); return; }
    const isChange = this._mode === "change";
    this._forging = true;
    // Play the hammer-strike + explosion before committing.
    const stage = this.element?.querySelector?.(".bf-stage");
    stage?.classList.add("is-forging");
    await new Promise((r) => setTimeout(r, 850));
    try {
      const result = isChange
        ? await changeBeneosOrigin(item, this._originSlug)
        : await imprintBeneosOrigin(item, this._originSlug);
      this._resultName = result?.name ?? null;
      this._resultImg = result?.img ?? null;
      this._resultUuid = result?.uuid ?? null;
      this._resultIsChange = isChange;
      const key = isChange ? "BENEOS.Forge.ChangeSuccess" : "BENEOS.Forge.Success";
      ui.notifications?.info?.(game.i18n.format(key, { name: this._resultName ?? "" }));
    } catch (err) {
      console.error("[Beneos Forge] forge failed", err);
      ui.notifications?.error?.(game.i18n.localize("BENEOS.Forge.Failed"));
    }
    this._forging = false;
    this._itemUuid = null; this._itemName = null; this._itemImg = null;
    this._mode = "forge"; this._originSlug = null;
    this.#stopSparkles();
    stage?.classList.remove("is-forging");
    this.render({ parts: ["body"] });
  }
}
