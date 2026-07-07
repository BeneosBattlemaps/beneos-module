// Beneos Item-Sheet-Companion (M7.2)
//
// Hangs a Codex-style side panel next to (or above) the dnd5e Item-Sheet
// whenever the item carries flags.beneos-module.loot. Re-uses the Codex
// visual language (origin emblem, tier pip, rarity chips, card layout)
// plus a 3D-flip front↔back card preview.
//
// Two layouts, switched live via ResizeObserver:
//   - Side    : <aside> floated to the right of the sheet (>= ~300px room)
//   - Crown   : compact banner prepended to the sheet header (tight space)
//
// Also implements M3.1 (Legacy-Section-Hider): the Foundry description
// duplicates Type / Set Type / Tier / Item Card blocks. When the companion
// is mounted, those blocks get data-beneos-legacy-hidden="true" and the
// CSS in beneos-companion.css hides them. The ⋯ button in the header
// toggles them back on for that session.


import { getLootFlags, beneosCloudCardPaths, isBeneosSrdItem } from "../loot/loot-schema.mjs";
import { OriginsRegistry } from "../loot/origins-registry.mjs";
import { ORIGIN_META, RARITY_COLOR, RARITY_MODIFIER } from "./origin-meta.mjs";

const TEMPLATE_ROOT = "modules/beneos-module/templates/codex2";
const SIDE_TPL    = `${TEMPLATE_ROOT}/companion-side.hbs`;
const COMPANION_W = 320;     // must match .beneos-companion--side width in beneos-companion.css
const GAP_SHEET   = 12;
const GAP_SIDEBAR = 12;
const RECOMPUTE_DEBOUNCE = 80;

// Per-sheet cache so re-renders reuse the same companion instance and
// don't multiply observers. WeakMap auto-frees when the sheet GC's.
const INSTANCES = new WeakMap();

export class ItemCompanion {

  static async attach(sheet, html) {
    // V1 sheets carry `.item`; ApplicationV2 sheets carry `.document` (and
    // sometimes `.object`). Support all three.
    const item = sheet?.item ?? sheet?.document ?? sheet?.object ?? null;
    if (!item || item.documentName !== "Item") return;
    const flags = getLootFlags(item);
    if (!flags) return;
    // F4: mount whenever the item is a Beneos card item. We used to require an
    // origin.slug, so a Beneos item whose authored loot block is missing that
    // datum (e.g. Hallowblight Strain) mounted nothing , the right pane stayed
    // blank. The card renderer already handles a missing origin (the SRD path
    // suppresses the emblem/label), so gate on "has a resolvable card OR a real
    // origin" instead of on the origin alone.
    const cardPaths = beneosCloudCardPaths(item);
    const hasCard = !!(cardPaths.front || flags.render?.frontCardWebp);
    if (!hasCard && !flags.origin?.slug) return;

    if (CONFIG?.debug?.hooks) console.log(`Beneos | Companion attaching to "${item.name}" (origin=${flags.origin?.slug ?? "none"})`);

    let inst = INSTANCES.get(sheet);
    if (!inst) {
      inst = new ItemCompanion(sheet, item);
      INSTANCES.set(sheet, inst);
    }
    // Generation counter: when several render hooks fire in the same microtask
    // burst, only the latest mount call actually inserts DOM. Earlier in-flight
    // mounts notice their gen is stale and bail before insertBefore.
    const myGen = ++inst._gen;
    inst.destroy({ keepCache: true });
    await inst.mount(html, myGen);
  }

  static detach(sheet) {
    const inst = INSTANCES.get(sheet);
    if (inst) {
      inst.destroy({ keepCache: false });
      INSTANCES.delete(sheet);
    }
    // Defense-in-depth: Foundry's `close({force:true})` can skip lifecycle
    // hooks, leaving the companion DOM orphaned. Sweep any companion node
    // tagged with this item's id.
    const itemId = sheet?.document?.id ?? sheet?.object?.id ?? sheet?.item?.id;
    if (itemId) {
      document.querySelectorAll(`.beneos-companion[data-companion-item="${itemId}"]`).forEach(el => el.remove());
    }
  }

  constructor(sheet, item) {
    this.sheet = sheet;
    this.item = item ?? sheet?.item ?? sheet?.document ?? sheet?.object ?? null;
    this.element = null;     // active companion DOM node
    this.mode = null;        // "side" | "crown"
    this.flipped = false;    // card-flipper state, preserved across re-mounts
    this.showLegacy = false; // section-hider toggle, preserved across re-mounts
    this._expandedContribs = new Set(); // which Set-Bonus tiers are expanded ("echo"|"resonance"|"harmony")
    this._gen = 0;           // monotonic mount generation; latest wins, earlier in-flight mounts bail
    this._resizeObs = null;
    this._mutObs = null;
    this._raf = null;
    this._debounce = null;
  }

  // ---- public lifecycle --------------------------------------------------

  async mount(html, gen = this._gen) {
    const sheetEl = this._sheetEl(html);
    if (!sheetEl) return;
    if (gen !== this._gen) return; // a newer attach() already superseded us

    this._wireObservers(sheetEl);
    this._ensureRoomForSide(sheetEl);

    await this._render(sheetEl, gen);
    if (gen !== this._gen) return;
    this._applyLegacyHiding(sheetEl);
  }

  destroy({ keepCache } = { keepCache: false }) {
    this._teardownObservers();
    this.element?.remove();
    this.element = null;
    this.mode = null;
    if (!keepCache) {
      this.flipped = false;
      this.showLegacy = false;
    }
  }

  // ---- internals: render -------------------------------------------------

  async _render(sheetEl, gen = this._gen) {
    const ctx = this._context();
    const renderFn = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    const html = await renderFn(SIDE_TPL, ctx);
    if (gen !== this._gen) return; // newer mount superseded us during renderTemplate

    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    const node = wrap.firstElementChild;
    if (!node) return;
    node.classList.add("beneos-companion", "beneos-companion--side");
    node.dataset.companionMode = "side";
    if (this.item?.id) node.dataset.companionItem = this.item.id;

    document.body.appendChild(node);
    this._positionSide(sheetEl, node);

    this._bindActions(node);
    this.element = node;
    this.mode = "side";
  }

  _context() {
    const flags = getLootFlags(this.item) ?? {};
    const slug  = flags.origin?.slug ?? null;
    const meta  = ORIGIN_META[slug] ?? null;
    const def   = OriginsRegistry.get(slug) ?? null;
    const raw   = flags.raw ?? {};
    const tier  = flags.tier ?? {};
    const card  = flags.card ?? {};
    const render = flags.render ?? {};

    const rarity = raw.rarity || "Common";
    const rarityMod = RARITY_MODIFIER[rarity] ?? 1;
    const rarityClass = `rc-${(rarity || "Common").replace(/\s+/g, "")}`;
    const rarityColor = RARITY_COLOR[rarity] ?? RARITY_COLOR.Common;

    const goldRaw = raw.goldValue ?? raw.gold ?? card.goldValue ?? null;
    const goldVal = (goldRaw === null || goldRaw === undefined || goldRaw === "")
      ? null
      : Number(goldRaw).toLocaleString(game.i18n?.lang || "en-US");
    const weight  = raw.weight ?? null;

    // Prefer the reconstructed local cloud path (heals SRD items whose stored
    // render paths point to the wrong location); fall back to the stored value.
    const cloudCards = beneosCloudCardPaths(this.item);
    const frontCard = cloudCards.front || render.frontCardWebp || null;
    const backCard  = cloudCards.back  || render.backCardWebp  || null;

    // SRD items have no Origin: suppress the emblem + "Origin" label for them
    // (they would otherwise render a "??" placeholder glyph and a stray label).
    const isSrd = isBeneosSrdItem(this.item, flags);
    const hasOrigin = !isSrd && !!(slug && (meta || def));

    const isNamed = !!flags.origin?.isNamed;
    const pips = Array.from({ length: 5 }, (_, i) => ({
      on: i < rarityMod,
      peak: i === rarityMod - 1 && rarityMod > 0, // highest active pip — pulse target
    }));

    return {
      slug,
      mono: meta?.mono ?? "??",
      glow: meta?.glow ?? "#d4a857",
      ring: meta?.ring ?? "#f0d486",
      iconUrl: meta?.image ?? null,
      hasOrigin,
      displayName: def?.display_name ?? card.frontTitle ?? this.item?.name ?? "Unknown",
      lore: def?.lore ?? "",
      isNamed,
      tierNumber: tier.number ?? null,
      tierLabel: tier.label ?? (tier.number ? `Tier ${tier.number}` : ""),
      rarity,
      rarityMod,
      rarityModMax: 5,
      rarityClass,
      rarityFg: rarityColor.fg,
      rarityBg: rarityColor.bg,
      rarityBorder: rarityColor.border,
      goldVal,
      weight,
      frontCard,
      backCard,
      flipped: this.flipped,
      hasBack: !!backCard,
      showLegacy: this.showLegacy,
      rarityModPips: pips,
      contributes: this._contributesCards(def, isNamed, tier.number),
    };
  }

  // Build expand-able Set-Bonus rows from origins.json tiers. Echo only for
  // Generic items (rules: Named items don't grant Echo of Origin). Resonance
  // picks the lowest-tier ("Resonance I") entry — Resonance II is bonus tier,
  // reachable via the Codex.
  _contributesCards(def, isNamed, tierNum) {
    const i18n = (k) => game?.i18n?.localize?.(k) ?? k;
    const fmt  = (k, data) => game?.i18n?.format?.(k, data) ?? k;
    const tn = Number(tierNum) || 0;
    const out = [];
    if (!isNamed && def?.tiers?.echo) {
      out.push({
        key: "echo", kind: "echo",
        prefix: "", // Echo isn't a set-bonus per rules — single-item feature
        label: i18n("BENEOS.Companion.ItemEcho"),
        threshold: 1, active: tn >= 1,
        title: def.tiers.echo.title,
        rules: this._enrichMarkdown(def.tiers.echo.rules),
        expanded: this._expandedContribs.has("echo"),
      });
    }
    const reson = Array.isArray(def?.tiers?.resonance)
      ? (def.tiers.resonance.find(r => /Resonance I\b/.test(r.title)) ?? def.tiers.resonance[0])
      : null;
    if (reson) {
      out.push({
        key: "resonance", kind: "reson",
        prefix: fmt("BENEOS.Companion.SetBonusN", { n: 2 }),
        label: i18n("BENEOS.Companion.Resonance"),
        threshold: 2, active: false,
        title: reson.title,
        rules: this._enrichMarkdown(reson.rules),
        expanded: this._expandedContribs.has("resonance"),
      });
    }
    if (def?.tiers?.harmony) {
      out.push({
        key: "harmony", kind: "harm",
        prefix: fmt("BENEOS.Companion.SetBonusN", { n: 3 }),
        label: i18n("BENEOS.Companion.PerfectHarmony"),
        threshold: 3, active: false,
        title: def.tiers.harmony.title,
        rules: this._enrichMarkdown(def.tiers.harmony.rules),
        expanded: this._expandedContribs.has("harmony"),
      });
    }
    return out;
  }

  // Minimal inline-markdown converter. The origins.json rules text uses
  // **bold** and __italic__ wrappers plus literal \n line breaks. We escape
  // HTML first so the rule text can't inject markup, then re-introduce the
  // intentional formatting.
  _enrichMarkdown(s) {
    if (!s) return "";
    const escaped = String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<em>$1</em>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/^/, "<p>")
      .replace(/$/, "</p>");
  }

  // ---- internals: positioning + observers --------------------------------

  _sheetEl(html) {
    // V13 ApplicationV2 hands raw HTMLElement (the <form> sheet root).
    // Beware: for a <form>, `form[0]` returns the first NAMED FORM CONTROL
    // (e.g. <slide-toggle name="…">), NOT the first child — so HTMLElement
    // check MUST come before the indexed-access fallback.
    if (html instanceof HTMLElement) return html;
    // V1 jQuery wrapper — $el[0] is the underlying DOM element.
    if (html?.[0] instanceof HTMLElement) return html[0];
    return this.sheet?.element instanceof HTMLElement ? this.sheet.element : this.sheet?.element?.[0] ?? null;
  }

  _wireObservers(sheetEl) {
    this._teardownObservers();
    this._resizeObs = new ResizeObserver(() => this._scheduleRecompute(sheetEl));
    this._resizeObs.observe(sheetEl);
    try { this._resizeObs.observe(document.documentElement); } catch (_) { /* noop */ }
    this._mutObs = new MutationObserver(() => this._scheduleRecompute(sheetEl));
    this._mutObs.observe(sheetEl, { attributes: true, attributeFilter: ["style"] });
  }

  _teardownObservers() {
    try { this._resizeObs?.disconnect(); } catch (_) {}
    try { this._mutObs?.disconnect(); } catch (_) {}
    this._resizeObs = null;
    this._mutObs = null;
    if (this._debounce) { clearTimeout(this._debounce); this._debounce = null; }
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  _scheduleRecompute(sheetEl) {
    // rAF-coalesce instead of setTimeout-debounce: during a sheet drag, the
    // MutationObserver fires ~60 Hz on the style attribute. setTimeout would
    // be reset on every tick and never run until the drag ended; with rAF we
    // re-position the companion on the very next frame.
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._recompute(sheetEl);
    });
  }

  async _recompute(sheetEl) {
    if (!document.body.contains(sheetEl)) return;
    this._ensureRoomForSide(sheetEl);
    if (this.element) this._positionSide(sheetEl, this.element);
  }

  // Push the Foundry sheet left whenever there isn't enough room to the right
  // for the 320 px companion + margins. Idempotent: when the sheet already
  // fits, this is a no-op (so MutationObserver-driven re-runs don't loop).
  _ensureRoomForSide(sheetEl) {
    const sidebarEl = document.getElementById("sidebar") ?? document.querySelector("#ui-right");
    const sidebarLeft = sidebarEl ? sidebarEl.getBoundingClientRect().left : window.innerWidth;
    const needed = COMPANION_W + GAP_SHEET + GAP_SIDEBAR;
    const maxSheetRight = sidebarLeft - needed;
    const rect = sheetEl.getBoundingClientRect();
    if (rect.right <= maxSheetRight) return;
    const desiredLeft = Math.max(0, Math.floor(maxSheetRight - rect.width));
    try {
      this.sheet?.setPosition?.({ left: desiredLeft });
    } catch (_) { /* setPosition can throw on edge V14 cases; non-fatal */ }
  }

  _positionSide(sheetEl, node) {
    if (!node) return;
    const rect = sheetEl.getBoundingClientRect();
    node.style.position = "fixed";
    node.style.width = `${COMPANION_W}px`;
    node.style.left = `${Math.round(rect.right + GAP_SHEET)}px`;
    node.style.top  = `${Math.round(rect.top)}px`;
    node.style.maxHeight = `${Math.round(rect.height)}px`;
    // Mirror the parent sheet's z-index so the companion stays at the same
    // window-stack level as its owner. Without this, the companion sits on a
    // fixed z-index and floats above unrelated Foundry windows.
    const parentApp = sheetEl.closest?.(".app, .window-app") ?? sheetEl;
    const parentZ = parentApp.style?.zIndex;
    if (parentZ) node.style.zIndex = parentZ;
  }

  // ---- internals: interactions ------------------------------------------

  _bindActions(root) {
    // One delegated listener on the companion root. Robust against re-renders
    // (no stale listeners on old DOM nodes) and survives partial subtree swaps.
    root.addEventListener("click", (ev) => {
      const target = ev.target.closest("[data-act]");
      if (!target || !root.contains(target)) return;
      const act = target.dataset.act;
      if (act === "flip") {
        ev.preventDefault();
        ev.stopPropagation();
        this.flipped = !this.flipped;
        const flipper = root.querySelector(".beneos-card-flipper");
        if (flipper) flipper.dataset.flipped = String(this.flipped);
      } else if (act === "toggle-legacy") {
        ev.preventDefault();
        ev.stopPropagation();
        this.showLegacy = !this.showLegacy;
        target.classList.toggle("is-on", this.showLegacy);
        const sheetEl = this._sheetEl(this.sheet.element);
        if (sheetEl) this._applyLegacyHiding(sheetEl);
      } else if (act === "copy") {
        ev.preventDefault();
        ev.stopPropagation();
        this._handleCopy(target);
      } else if (act === "open-codex") {
        ev.preventDefault();
        ev.stopPropagation();
        this._openCodexForOrigin(target.dataset.origin);
      } else if (act === "toggle-contrib") {
        ev.preventDefault();
        ev.stopPropagation();
        this._toggleContrib(target);
      }
    });
  }

  async _handleCopy(btn) {
    const value = btn.dataset.copy ?? btn.textContent.trim();
    const i18n = (k) => game?.i18n?.localize?.(k) ?? k;
    const original = btn.innerHTML;
    try {
      await navigator.clipboard.writeText(String(value));
      btn.classList.add("is-copied");
      btn.innerHTML = i18n("BENEOS.Companion.Copied");
      setTimeout(() => {
        btn.classList.remove("is-copied");
        btn.innerHTML = original;
      }, 1200);
    } catch (err) {
      ui.notifications?.warn?.(i18n("BENEOS.Companion.CopyFailed"));
    }
  }

  async _openCodexForOrigin(slug) {
    if (!slug) return;
    try {
      const mod = await import("./beneos-codex.mjs");
      mod.BeneosCodex?.open?.("items", "origins", slug);
    } catch (err) {
      const apiOpen = game.modules.get("beneos-module")?.api?.codex?.open;
      if (typeof apiOpen === "function") apiOpen("items", "origins", slug);
      else ui.notifications?.warn?.("Beneos Codex not available");
    }
  }

  _toggleContrib(rowEl) {
    const key = rowEl.dataset.tier;
    if (!key) return;
    const expanded = !this._expandedContribs.has(key);
    if (expanded) this._expandedContribs.add(key);
    else this._expandedContribs.delete(key);
    rowEl.dataset.expanded = String(expanded);
    const body = rowEl.nextElementSibling;
    if (body?.classList.contains("bc-contrib-body")) body.dataset.expanded = String(expanded);
  }

  // ---- internals: M3.1 legacy section hider -----------------------------

  _applyLegacyHiding(sheetEl) {
    const editors = sheetEl.querySelectorAll(
      '.tab[data-tab="description"] .editor-content, .editor-content, [data-edit="system.description.value"]'
    );
    const seen = new Set();
    const markers = [
      /^\s*Type\s*:/i,
      /^\s*Set\s*Type\s*:/i,
      /^\s*Tier\s*:/i,
      /^\s*Item\s*Card\b/i,
      /^\s*Flavor\s*:/i,
    ];
    editors.forEach(root => {
      if (seen.has(root)) return;
      seen.add(root);
      const blocks = root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, section, blockquote, div");
      blocks.forEach(el => {
        const text = (el.textContent || "").trim();
        if (!text) return;
        const isLegacy =
          markers.some(rx => rx.test(text)) ||
          el.tagName === "SECTION" && el.classList.contains("secret");
        if (isLegacy) {
          if (this.showLegacy) el.removeAttribute("data-beneos-legacy-hidden");
          else                 el.setAttribute("data-beneos-legacy-hidden", "true");
        }
      });
    });
  }
}

// ---- partial preregistration ----------------------------------------------

async function preregisterPartials() {
  const map = {
    "beneos-companion/flipper": `${TEMPLATE_ROOT}/companion-flipper.hbs`,
  };
  try {
    await foundry.applications.handlebars.loadTemplates(map);
  } catch {
    if (typeof loadTemplates === "function") await loadTemplates(Object.values(map));
  }
}

// ---- hook registration ----------------------------------------------------

Hooks.once("ready", () => { preregisterPartials().catch(() => {}); });

// Fix.2-Verifikation hat gezeigt: dnd5e 5.x V13 nennt die Klasse `ItemSheet5e`
// (nicht `ItemSheet5e2`), und Foundry V13 bubblet ALLE Parent-Hooks der Klassen-
// Hierarchie. `renderItemSheet5e`, `renderDocumentSheetV2`, `renderApplicationV2`
// feuern alle drei für denselben Render — wenn wir auf alle hören, attachen wir
// 3× parallel (Race-Condition). Wir wählen den spezifischsten Hook.
// Fallback bei dnd5e-Klassen-Rename: `renderApplicationV2` mit Item-Filter
// einkommentieren.
const ATTACH_HOOKS = ["renderItemSheet5e"];
const DETACH_HOOKS = ["closeItemSheet5e"];

if (CONFIG?.debug?.hooks) console.log("Beneos | Companion registering attach hooks:", ATTACH_HOOKS);
for (const name of ATTACH_HOOKS) {
  Hooks.on(name, (app, html) => {
    const doc = app?.document ?? app?.object ?? app?.item;
    if (CONFIG?.debug?.hooks) console.log(`Beneos | Hook fired: ${name} | class=${app?.constructor?.name} | docName=${doc?.documentName}`);
    if (doc?.documentName !== "Item") return;
    ItemCompanion.attach(app, html).catch(err => console.warn(`Beneos | Companion attach failed (${name}):`, err));
  });
}
for (const name of DETACH_HOOKS) {
  Hooks.on(name, (app) => {
    const doc = app?.document ?? app?.object ?? app?.item;
    if (doc?.documentName !== "Item") return;
    ItemCompanion.detach(app);
  });
}
