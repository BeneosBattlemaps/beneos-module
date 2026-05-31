// Beneos Codex — central static-content UI bound into the beneos-module.
// ApplicationV2 + Handlebars. Internal route stack (no URL hash) drives
// the view. Implements Hub + Item-Codex (Origins gallery + detail) +
// Creature/World tab stubs + Spell/Adventure WIP screens.
//
// Visual fidelity matched to /tmp/beneos-design/origin-bonis/ React prototype
// (handoff bundle). Tech-stack adapted: ApplicationV2 not React; styling
// from beneos-codex.css.

import { OriginsRegistry } from "../loot/origins-registry.mjs";
import { ORIGIN_META, ORIGIN_ORDER, MECHANIC_RULES } from "./origin-meta.mjs";
import {
  buildCreatureDetailCtx,
  findActorByTokenKey,
  bumpTheaterRound,
  resetTheaterState,
  markAbilityUsed,
  setFirstAppearanceRead,
  openAllyCloudSearch,
} from "./creature-codex.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATE_ROOT = "modules/beneos-module/templates/codex2";

export class BeneosCodex extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-codex",
    classes: ["beneos-codex", "codex-root"],
    tag: "div",
    window: {
      title: "Beneos Codex",
      icon: "fa-solid fa-book-open",
      resizable: true,
    },
    // M7-Fix.4: Explizite left/top, damit das Fenster auf Ultrawide-Displays
    // nicht hinter der Foundry-Sidebar oder außerhalb des sichtbaren Bereichs
    // landet (ApplicationV2-Default ist Viewport-Center, was bei 3440px+ ungünstig
    // ist). Default-Size auf 1100x760 reduziert — passt auf 1366x768-Laptops und
    // ist groß genug für Item-Detail (3-Spalten-Grid kollabiert ab <1100px auf
    // 1-Spalte via beneos-codex-app.css). User schiebt selbst wo gewünscht.
    position: { width: 1200, height: 760, left: 80, top: 60 },
    actions: {
      "go-route":     BeneosCodex._onGoRoute,
      "go-hub":       BeneosCodex._onGoHub,
      "go-tab":       BeneosCodex._onGoTab,
      "open-origin":  BeneosCodex._onOpenOrigin,
      "back":         BeneosCodex._onBack,
      "set-attuned":  BeneosCodex._onSetAttuned,
      "toggle-rule":  BeneosCodex._onToggleRule,
      "open-loot":    BeneosCodex._onOpenLoot,
      "close-codex":  BeneosCodex._onCloseCodex,
      "scroll-to-specials": BeneosCodex._onScrollToSpecials,
      // ---- Creature-Detail actions ----
      "cdx-tab":            BeneosCodex._onCreatureTab,
      "cdx-tactics-sub":    BeneosCodex._onCreatureTacticsSub,
      "cdx-ability-filter": BeneosCodex._onCreatureAbilityFilter,
      "cdx-open-actor":     BeneosCodex._onCreatureOpenActor,
      "cdx-download-pdf":   BeneosCodex._onCreatureDownloadPdf,
      "cdx-open-pdf":       BeneosCodex._onCreatureOpenPdf,
      "cdx-round-plus":     BeneosCodex._onCreatureRoundPlus,
      "cdx-round-minus":    BeneosCodex._onCreatureRoundMinus,
      "cdx-round-reset":    BeneosCodex._onCreatureRoundReset,
      "cdx-mark-used":      BeneosCodex._onCreatureMarkUsed,
      "cdx-mark-first-app": BeneosCodex._onCreatureMarkFirstApp,
      "cdx-read-aloud":     BeneosCodex._onCreatureReadAloud,
      "cdx-trigger-ability":BeneosCodex._onCreatureTriggerAbility,
      "cdx-roll-chip":      BeneosCodex._onCreatureRollChip,
      "cdx-trigger-death":  BeneosCodex._onCreatureTriggerDeath,
      "cdx-ally-search":    BeneosCodex._onCreatureAllySearch,
      "cdx-toggle-prompt":  BeneosCodex._onCreatureTogglePrompt,
    },
  };

  static PARTS = {
    main: { template: `${TEMPLATE_ROOT}/beneos-codex.hbs`, scrollable: [".cdx-body"] },
  };

  // ---- route ---------------------------------------------------------

  // Examples: [], ["items"], ["items","origins"], ["items","origins","vampiric"],
  //           ["creatures","factions","harrowshrike"], ["world","cosmology"]
  _route = [];

  _openRuleKey = "item_echo"; // accordion-default in concept-rail
  _attuned     = 0;                // detail attunement simulator state

  // Creature-detail in-window state (does not survive a window close)
  _creatureTab = "overview";
  _creatureTacticsSub = "general";
  _creatureAbilityFilter = "all";

  // ---- preset / state helpers ---------------------------------------

  setRoute(...segs) {
    const prev = this._route;
    this._route = segs.filter(Boolean);
    this._attuned = 0;
    // Reset creature-detail tab state whenever we land on a new creature
    // (or leave the creature view entirely), so a fresh open of a token
    // always starts on Overview / General / All.
    const wasCreature = prev[0] === "creatures" && prev[1];
    const isCreature  = this._route[0] === "creatures" && this._route[1];
    const sameCreature = wasCreature && isCreature && prev[1] === this._route[1];
    if (!sameCreature) {
      this._creatureTab = "overview";
      this._creatureTacticsSub = "general";
      this._creatureAbilityFilter = "all";
    }
    this.render({ force: false });
  }

  // ---- title --------------------------------------------------------

  get title() {
    const [s0] = this._route;
    const brand = game.i18n.localize("BENEOS.Codex.Brand");
    if (!s0) return brand;
    const sectionKeys = {
      items: "BENEOS.Codex.Section.Items",
      creatures: "BENEOS.Codex.Section.Creatures",
      world: "BENEOS.Codex.Section.World",
      spells: "BENEOS.Codex.Section.Spells",
      adventures: "BENEOS.Codex.Section.Adventures",
    };
    const section = sectionKeys[s0] ? game.i18n.localize(sectionKeys[s0]) : s0;
    return game.i18n.format("BENEOS.Codex.TitleSection", { section });
  }

  // ---- context ------------------------------------------------------

  async _prepareContext(_options) {
    if (!OriginsRegistry.loaded) await OriginsRegistry.load();

    const route = this._route;
    const [s0, s1, s2] = route;

    const ctx = {
      route,
      view: this._pickView(s0, s1),
      header: this._headerCtx(s0),
    };

    if (s0 === "items") Object.assign(ctx, this._itemCtx(s1, s2));
    // ["creatures"] -> hub stub; ["creatures", "<tokenKey>"] -> detail page
    if (s0 === "creatures" && s1) {
      const detail = await buildCreatureDetailCtx({
        tokenKey: s1,
        activeTab: this._creatureTab,
        activeTacticsSub: this._creatureTacticsSub,
        activeAbilityFilter: this._creatureAbilityFilter,
      });
      ctx.creature = detail;
    }
    if (s0 === "spells" || s0 === "adventures" || s0 === "world" || (s0 === "creatures" && !s1)) {
      ctx.wipLabel = s0;
    }

    // Sub-hero banner — one line that sits under the main header on every
    // sub-page. Hub uses its own .hub-hero, so no sub-hero there.
    const L = (k) => game.i18n.localize(k);
    const wipHeroMap = {
      spells:     { title: L("BENEOS.Codex.SubHero.Spells.Title"),     lead: L("BENEOS.Codex.SubHero.Spells.Lead") },
      world:      { title: L("BENEOS.Codex.SubHero.World.Title"),      lead: L("BENEOS.Codex.SubHero.World.Lead") },
      adventures: { title: L("BENEOS.Codex.SubHero.Adventures.Title"), lead: L("BENEOS.Codex.SubHero.Adventures.Lead") },
      creatures:  { title: L("BENEOS.Codex.SubHero.Creature.Title"),   lead: L("BENEOS.Codex.SubHero.Creature.Lead") },
    };
    const heroByView = {
      item: { title: L("BENEOS.Codex.SubHero.Item.Title"), lead: L("BENEOS.Codex.SubHero.Item.Lead") },
      wip:  wipHeroMap[ctx.wipLabel] ?? wipHeroMap.adventures,
    };
    ctx.subHero = heroByView[ctx.view] ?? null;

    // Content-origin hint: the item codex is Beneos Creatures/Spells/Loot
    // (tokens) content. Non-patrons additionally get a Join-Patreon CTA.
    ctx.hasTokenAccess = !!game.beneos?.cloud?.hasCampaignAccess?.("tokens");
    ctx.joinPatreonUrl = "https://www.patreon.com/c/BeneosTokens";

    // Origin-detail paywall: all origins are Patreon-only (no free exception).
    // Non-patrons see each center tier card clamped to heading + ~2 lines with
    // a fade + subtle Join link; the left nav + right simulator stay functional.
    if (ctx.detail) {
      ctx.detail.locked = !ctx.hasTokenAccess;
      ctx.detail.joinPatreonUrl = ctx.joinPatreonUrl;
    }

    return ctx;
  }

  _pickView(s0, s1) {
    if (!s0) return "hub";
    if (s0 === "items") return "item";
    if (s0 === "creatures" && s1) return "creature-detail";
    if (s0 === "creatures" || s0 === "world" || s0 === "spells" || s0 === "adventures") return "wip";
    return "hub";
  }

  _headerCtx(s0) {
    const tabs = [
      { id: "items",      label: "BENEOS.Codex.Tabs.Items" },
      { id: "creatures",  label: "BENEOS.Codex.Tabs.Creatures" },
      { id: "world",      label: "BENEOS.Codex.Tabs.World",      wip: true },
      { id: "spells",     label: "BENEOS.Codex.Tabs.Spells",     wip: true },
      { id: "adventures", label: "BENEOS.Codex.Tabs.Adventures", wip: true },
    ];
    return {
      tabs: tabs.map(t => ({ ...t, active: t.id === s0 })),
    };
  }

  _itemCtx(s1, s2) {
    const tab = (["origins", "forge", "loot", "shop"].includes(s1) || !s1)
      ? (s1 || "origins")
      : "origins";

    const subTabs = [
      { id: "origins", label: "BENEOS.Codex.ItemSubTab.Origins", active: tab === "origins" },
      { id: "forge",   label: "BENEOS.Codex.ItemSubTab.Forge",   active: tab === "forge" },
      { id: "loot",    label: "BENEOS.Codex.ItemSubTab.Loot",    active: tab === "loot" },
      { id: "shop",    label: "BENEOS.Codex.ItemSubTab.Shop",    active: tab === "shop" },
    ];

    const out = { itemTab: tab, itemSubTabs: subTabs, mechanicRules: this._rulesCtx() };

    if (tab === "origins") {
      const selectedSlug = s2 && OriginsRegistry.get(s2) ? s2 : null;
      if (selectedSlug) {
        out.detail = this._buildOriginDetail(selectedSlug);
      } else {
        out.gallery = this._buildGallery();
      }
    }
    // Foundry V13 Handlebars doesn't accept {{#unless}} cleanly — pre-compute
    // a boolean so the template can use {{#if showItemHero}}.
    out.showItemHero = !out.detail;

    // Sub-lead explainer text for each item-codex sub-tab
    const leadMap = {
      origins: "BENEOS.Codex.ItemSubLead.Origins",
      forge:   "BENEOS.Codex.ItemSubLead.Forge",
      loot:    "BENEOS.Codex.ItemSubLead.Loot",
      shop:    "BENEOS.Codex.ItemSubLead.Shop",
    };
    out.itemSubLead = leadMap[tab] ?? leadMap.origins;
    return out;
  }

  _rulesCtx() {
    return MECHANIC_RULES.map(r => ({
      ...r,
      open: r.k === this._openRuleKey,
    }));
  }

  _buildGallery() {
    const cards = ORIGIN_ORDER.map(slug => {
      const origin = OriginsRegistry.get(slug);
      const meta   = ORIGIN_META[slug] || {};
      if (!origin) return null;
      return {
        slug,
        displayName: this._originName(slug, origin),
        lore: this._originLore(slug, origin),
        glow: meta.glow,
        ring: meta.ring,
        iconPath: meta.image,
        // For CSS-mask tinting: the color WebP has the correct alpha shape
        // (transparent corners, opaque form). _blackwhite is a full disc and
        // would just mask to a solid circle.
        iconBw: meta.image ? "/" + meta.image : null,
        mono: meta.mono,
        hasSpecials: !!(origin.tiers?.specials?.length),
        hasRitual: !!(origin.tiers?.specials?.some(s => s.type === "ritual_of_ascension")),
        missingEcho: !origin.tiers?.echo,
      };
    }).filter(Boolean);
    return { cards, totalOrigins: cards.length };
  }

  _buildOriginDetail(slug) {
    const origin = OriginsRegistry.get(slug);
    const meta   = ORIGIN_META[slug] || {};
    if (!origin) return null;

    const idx = ORIGIN_ORDER.indexOf(slug);
    const prev = ORIGIN_ORDER[(idx - 1 + ORIGIN_ORDER.length) % ORIGIN_ORDER.length];
    const next = ORIGIN_ORDER[(idx + 1) % ORIGIN_ORDER.length];

    // Resonance can be an array (awoken has I + II). Normalize.
    const resonRaw = origin.tiers?.resonance;
    const reson = Array.isArray(resonRaw) ? resonRaw : (resonRaw ? [resonRaw] : []);

    const resonItems = [...reson].sort((a, b) => {
      const aI = /resonance i\b/i.test(a.title || "");
      const aII = /resonance ii\b/i.test(a.title || "");
      const bI = /resonance i\b/i.test(b.title || "");
      const bII = /resonance ii\b/i.test(b.title || "");
      if (aI && bII) return -1;
      if (aII && bI) return 1;
      return 0;
    });

    const attunedN = this._attuned ?? 0;
    const sbaHintKey = attunedN === 0
      ? "BENEOS.Codex.SbaHint.None"
      : attunedN === 1
        ? "BENEOS.Codex.SbaHint.One"
        : attunedN === 2
          ? "BENEOS.Codex.SbaHint.Two"
          : "BENEOS.Codex.SbaHint.Three";
    const sbaHint = game.i18n.localize(sbaHintKey);
    const displayName = this._originName(slug, origin);
    const attuneWithLabel = game.i18n.format("BENEOS.Codex.Detail.AttuneWith", { origin: displayName });
    const itemLabels = [1, 2, 3].map(n => game.i18n.format("BENEOS.Codex.Detail.Item", { n }));

    return {
      slug,
      displayName,
      lore: this._originLore(slug, origin),
      glow: meta.glow,
      iconPath: meta.image,
      iconBw: meta.image ? "/" + meta.image : null,
      mono: meta.mono,
      attuned: this._attuned,
      attuneWithLabel,
      itemLabels,
      sbaHint,
      resonActive: this._attuned >= 2,
      harmonyActive: this._attuned >= 3,
      resonItems: resonItems.map((r, i) => {
        const t = this._localizedTier(slug, resonItems.length > 1 ? `Resonance.${i}` : "Resonance", r);
        return {
          title: this._cleanTitle(t.title),
          lore: t.lore.replace(/^Requires.*$/m, "").trim(),
          rules: this._renderRulesHtml(t.rules),
          rarity: r.rarity,
        };
      }),
      harmony: origin.tiers?.harmony ? (() => {
        const t = this._localizedTier(slug, "Harmony", origin.tiers.harmony);
        return {
          title: this._cleanTitle(t.title),
          lore: t.lore.replace(/^Requires.*$/m, "").trim(),
          rules: this._renderRulesHtml(t.rules),
          rarity: origin.tiers.harmony.rarity,
        };
      })() : null,
      echo: origin.tiers?.echo ? (() => {
        const t = this._localizedTier(slug, "Echo", origin.tiers.echo);
        return {
          title: this._cleanTitle(t.title),
          lore: t.lore,
          rules: this._renderRulesHtml(t.rules),
          rarity: origin.tiers.echo.rarity,
        };
      })() : null,
      specials: (origin.tiers?.specials || []).map((s, i) => {
        const t = this._localizedTier(slug, `Specials.${i}`, s);
        const isRitual = s.type === "ritual_of_ascension";
        return {
          type: s.type,
          title: this._cleanTitle(t.title),
          lore: t.lore,
          rules: this._renderRulesHtml(t.rules),
          rarity: s.rarity,
          isRitual,
          ritualLabel: game.i18n.localize(isRitual ? "BENEOS.Codex.Detail.RitualLabel" : "BENEOS.Codex.Detail.SpecialRite"),
          ritualReq:   isRitual ? game.i18n.localize("BENEOS.Codex.Detail.RitualRequires") : "",
        };
      }),
      prev: { slug: prev, name: this._originName(prev, OriginsRegistry.get(prev)) },
      next: { slug: next, name: this._originName(next, OriginsRegistry.get(next)) },
    };
  }

  // i18n lookup with fallback to origins.json for origin display names and
  // lore. Translators only need to provide BENEOS.Codex.Origins.<slug>.Name
  // and .Lore — if a key is missing, the English origins.json values are used.
  _originName(slug, origin) {
    const key = `BENEOS.Codex.Origins.${slug}.Name`;
    const v = game.i18n.localize(key);
    return v && v !== key ? v : (origin?.display_name ?? slug);
  }
  _originLore(slug, origin) {
    const key = `BENEOS.Codex.Origins.${slug}.Lore`;
    const v = game.i18n.localize(key);
    return v && v !== key ? v : (origin?.lore ?? "");
  }
  // Returns { title, lore, rules } with each field looked up via i18n
  // (BENEOS.Codex.Origins.<slug>.Tiers.<tierPath>.{Title,Lore,Rules}) and
  // falling back to the source-of-truth values from origins.json.
  // tierPath examples: "Echo", "Harmony", "Resonance", "Resonance.0", "Specials.0".
  _localizedTier(slug, tierPath, fallback) {
    const base = `BENEOS.Codex.Origins.${slug}.Tiers.${tierPath}`;
    const lookup = (suffix, fb) => {
      const k = `${base}.${suffix}`;
      const v = game.i18n.localize(k);
      return v && v !== k ? v : fb;
    };
    return {
      title: lookup("Title", fallback?.title ?? ""),
      lore:  lookup("Lore",  (fallback?.lore  ?? "").trim()),
      rules: lookup("Rules", (fallback?.rules ?? "").trim()),
    };
  }

  _cleanTitle(t) {
    return String(t || "").replace(/^[A-Z][a-z]+:\s*/, "").trim();
  }

  // Minimal **bold** + __italic-kw__ + !|! HR markdown subset (mirrors React `renderRules`)
  _renderRulesHtml(raw) {
    if (!raw) return "";
    const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const blocks = String(raw).replace(/\r/g, "").split(/\n\s*!\|!\s*\n/);
    return blocks.map((block, bi) => {
      const html = block.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => {
        let line = escape(p);
        line = line.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        line = line.replace(/__([^_]+)__/g, '<em class="kw">$1</em>');
        line = line.split("\n").join("<br>");
        return `<p>${line}</p>`;
      }).join("");
      return (bi > 0 ? "<hr>" : "") + html;
    }).join("");
  }

  async _creatureCtx(s1, s2) {
    const tab = (["factions", "philosophy", "howto"].includes(s1) || !s1) ? (s1 || "factions") : "factions";
    const subTabs = [
      { id: "factions",   label: "BENEOS.Codex.CreatureSubTab.Factions",   active: tab === "factions" },
      { id: "philosophy", label: "BENEOS.Codex.CreatureSubTab.Philosophy", active: tab === "philosophy" },
      { id: "howto",      label: "BENEOS.Codex.CreatureSubTab.Howto",      active: tab === "howto" },
    ];

    let factions = null, selected = null;
    if (tab === "factions") {
      const url = `modules/beneos-module/data/codex/factions-stub.json`;
      try {
        const data = await foundry.utils.fetchJsonWithTimeout(url, { cache: "no-cache" });
        factions = data?.factions || [];
        selected = s2 ? factions.find(f => f.slug === s2) : null;
      } catch (e) { console.warn("[BeneosCodex] factions-stub.json load failed:", e); }
    }

    return { creatureTab: tab, creatureSubTabs: subTabs, factions, selectedFaction: selected };
  }

  async _worldCtx(s1) {
    const tab = (["cosmology", "geography", "calendar", "history"].includes(s1) || !s1) ? (s1 || "cosmology") : "cosmology";
    const subTabs = [
      { id: "cosmology", label: "BENEOS.Codex.WorldSubTab.Cosmology", active: tab === "cosmology" },
      { id: "geography", label: "BENEOS.Codex.WorldSubTab.Geography", active: tab === "geography" },
      { id: "calendar",  label: "BENEOS.Codex.WorldSubTab.Calendar",  active: tab === "calendar" },
      { id: "history",   label: "BENEOS.Codex.WorldSubTab.History",   active: tab === "history" },
    ];

    let section = null;
    try {
      const url = `modules/beneos-module/data/codex/world-stub.json`;
      const data = await foundry.utils.fetchJsonWithTimeout(url, { cache: "no-cache" });
      section = data?.sections?.[tab] || null;
    } catch (e) { console.warn("[BeneosCodex] world-stub.json load failed:", e); }

    return { worldTab: tab, worldSubTabs: subTabs, worldSection: section };
  }

  // ---- action handlers ---------------------------------------------

  static _onGoHub(_event, _target)            { this.setRoute(); }
  static _onGoRoute(_event, target)           { this.setRoute(...(target.dataset.route || "").split("/").filter(Boolean)); }
  static _onGoTab(_event, target)             {
    const tab = target.dataset.tab;
    if (!tab) return;
    const [s0] = this._route;
    if (s0) this.setRoute(s0, tab);
    else    this.setRoute(tab);
  }
  static _onOpenOrigin(_event, target)        { this.setRoute("items", "origins", target.dataset.slug); }
  static _onBack(_event, _target)             {
    if (this._route.length <= 1) { this.setRoute(); return; }
    this.setRoute(...this._route.slice(0, -1));
  }
  static _onSetAttuned(_event, target)        {
    let n = Math.max(0, Math.min(5, parseInt(target.dataset.attuned, 10) || 0));
    // Toggle: clicking the tile that already equals the current count deselects it.
    if (n === this._attuned) n = Math.max(0, n - 1);
    this._attuned = n;
    // Direct DOM update — avoids the full re-render's layout shift / scrollbar flash.
    const root = this.element;
    if (!root) return;

    // Tile active-state
    root.querySelectorAll(".attune-tile").forEach(t => {
      const a = parseInt(t.dataset.attuned, 10) || 0;
      t.classList.toggle("is-active", a <= n && a > 0);
    });

    // Sense-of-Like map: data-attuned drives which range rings light up
    const sense = root.querySelector(".sense-of-like");
    if (sense) sense.dataset.attuned = String(n);

    // Specials (Ritual of Ascension + other Bonus Rites): unlocked at Perfect Harmony
    const specials = root.querySelector(".specials-section");
    if (specials) specials.dataset.visible = String(n >= 3);
    const ritualCta = root.querySelector(".sba-ritual-cta");
    if (ritualCta) ritualCta.dataset.visible = String(n >= 3);

    // Dynamic count-text: "Attuned to two Vampiric Items."
    const countText = root.querySelector(".attune-count-text");
    if (countText) {
      const NUMBER_WORD = { 0: "0", 1: "one", 2: "two", 3: "three" };
      const word = NUMBER_WORD[n] ?? n;
      const origin = countText.dataset.origin || "";
      countText.textContent = game.i18n.format("BENEOS.Codex.Detail.AttuneCount", { word, origin, plural: n === 1 ? "" : "s" });
    }

    // Set-Bonus-Active block (sba-value + sba-hint)
    const sba = root.querySelector(".sba-value");
    if (sba) {
      const i18n = (k) => game.i18n.localize(k);
      sba.classList.remove("is-none", "is-reson", "is-harmony");
      if (n >= 3) {
        sba.classList.add("is-harmony");
        sba.textContent = i18n("BENEOS.Codex.PerfectHarmonyActive");
      } else if (n >= 2) {
        sba.classList.add("is-reson");
        sba.textContent = i18n("BENEOS.Codex.ResonanceActive");
      } else {
        sba.classList.add("is-none");
        sba.textContent = i18n("BENEOS.Codex.NoSetBonus");
      }
    }
    const sbaHint = root.querySelector(".sba-hint");
    if (sbaHint) {
      sbaHint.textContent =
        n === 0 ? game.i18n.localize("BENEOS.Codex.Detail.HintBegin")
      : n === 1 ? game.i18n.localize("BENEOS.Codex.Detail.HintResonance")
      : n === 2 ? game.i18n.localize("BENEOS.Codex.Detail.HintHarmony")
      :           game.i18n.localize("BENEOS.Codex.Detail.HintAllUnlocked");
    }

    // Center tier-cards active-state (Resonance = first, Harmony = second).
    // We must toggle BOTH `.active` and `.dimmed` — the initial render set
    // `.dimmed` based on the original `active=false`, and the dimmed CSS
    // (opacity 0.36 + saturate 0.6) would otherwise override the active glow.
    const tierCards = root.querySelectorAll(".tier-stack > .tier-card");
    const setTier = (card, active) => {
      if (!card) return;
      card.classList.toggle("active", active);
      card.classList.toggle("dimmed", !active);
      const lock = card.querySelector(".tier-lock");
      if (lock) lock.textContent = active ? game.i18n.localize("BENEOS.Codex.TierCard.Active") : game.i18n.localize("BENEOS.Codex.TierCard.Dormant");
    };
    setTier(tierCards[0], n >= 2);
    setTier(tierCards[1], n >= 3);
  }
  static _onToggleRule(_event, target)        {
    const k = target.dataset.rule;
    this._openRuleKey = (this._openRuleKey === k) ? null : k;
    // Capture scroll position so the user doesn't snap back to the top.
    const rail = this.element?.querySelector?.(".concept-rail");
    const layout = this.element?.querySelector?.(".item-origins-layout");
    const cdxBody = this.element?.querySelector?.(".cdx-body");
    const railTop   = rail?.scrollTop ?? 0;
    const layoutTop = layout?.scrollTop ?? 0;
    const bodyTop   = cdxBody?.scrollTop ?? 0;
    const p = this.render({ force: false });
    Promise.resolve(p).then(() => {
      const r2 = this.element?.querySelector?.(".concept-rail");
      const l2 = this.element?.querySelector?.(".item-origins-layout");
      const b2 = this.element?.querySelector?.(".cdx-body");
      if (r2) r2.scrollTop = railTop;
      if (l2) l2.scrollTop = layoutTop;
      if (b2) b2.scrollTop = bodyTop;
    });
  }
  static _onOpenLoot(_event, _target)         {
    // Legacy stub — Fix.10 replaces this with an inline embed via _onRender
    BeneosCodex._instance?._mountEmbeddedGenerator?.("loot");
  }
  static _onCloseCodex(_event, _target)       { this.close(); }
  static _onScrollToSpecials(_event, _target) {
    const target = this.element?.querySelector?.(".specials-section");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- embedded generator lifecycle (Loot / Shop sub-tabs) ----------

  async _onRender(context, options) {
    if (super._onRender) await super._onRender(context, options);
    this._wireCustomDrag();
    this._wireOriginPagerKeys();
    const host = this.element?.querySelector?.(".codex-embed-host");
    if (!host) {
      // No embed slot on this view — tear down any previously embedded apps.
      await this._teardownEmbeddedGenerators();
      return;
    }
    await this._mountEmbeddedGenerator(host.dataset.embed, host);
  }

  // Custom drag handle on our .cdx-header. The Foundry window-header is
  // hidden via CSS (Fix.12), so its drag listener has nothing to bind to.
  _wireOriginPagerKeys() {
    if (this._pagerKeysWired) return;
    this._pagerKeysWired = true;
    this._onPagerKey = (ev) => {
      if (this._route?.[0] !== "items" || this._route?.[1] !== "origins" || !this._route?.[2]) return;
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      const t = document.activeElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      ev.preventDefault();
      const idx = ORIGIN_ORDER.indexOf(this._route[2]);
      if (idx < 0) return;
      const delta = ev.key === "ArrowLeft" ? -1 : 1;
      const next = ORIGIN_ORDER[(idx + delta + ORIGIN_ORDER.length) % ORIGIN_ORDER.length];
      this.setRoute("items", "origins", next);
    };
    window.addEventListener("keydown", this._onPagerKey);
  }

  _wireCustomDrag() {
    const handles = this.element?.querySelectorAll?.(".cdx-header, .codex-sub-hero");
    if (!handles?.length) return;
    const DRAG_THRESHOLD = 4; // px — below this, treat as click
    for (const handle of handles) {
      if (handle.dataset.dragWired) continue;
      handle.dataset.dragWired = "1";
      handle.style.cursor = "grab";
      handle.addEventListener("mousedown", (ev) => {
        // The .cdx-brand button is allowed to drag too — go-hub still fires
        // on a real click (mouseup without movement past threshold).
        const isBrand = !!ev.target.closest(".cdx-brand");
        if (!isBrand && ev.target.closest("button, a, [data-action]")) return;

        const startX = ev.clientX, startY = ev.clientY;
        const startLeft = this.position?.left ?? 0;
        const startTop  = this.position?.top  ?? 0;
        let dragging = false;
        if (!isBrand) ev.preventDefault(); // brand keeps default to allow click

        const onMove = (e) => {
          const dx = e.clientX - startX, dy = e.clientY - startY;
          if (!dragging && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
            dragging = true;
            handle.style.cursor = "grabbing";
          }
          if (dragging) this.setPosition({ left: startLeft + dx, top: startTop + dy });
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          handle.style.cursor = "grab";
          if (dragging && isBrand) {
            // Swallow the synthetic click that follows mouseup on a button
            const swallow = (ce) => { ce.preventDefault(); ce.stopPropagation(); window.removeEventListener("click", swallow, true); };
            window.addEventListener("click", swallow, true);
            setTimeout(() => window.removeEventListener("click", swallow, true), 0);
          }
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    }
  }

  async _mountEmbeddedGenerator(kind, host) {
    if (!kind) return;
    // Tear down any other kind currently embedded.
    await this._teardownEmbeddedGenerators(kind);
    host = host ?? this.element?.querySelector?.(`.codex-embed-host[data-embed="${kind}"]`);
    if (!host) return;

    let cached = this._embeddedGen?.[kind];
    if (cached?.element && host.contains(cached.element)) return; // already in slot
    if (cached?.element && !host.contains(cached.element)) {
      // Re-attach orphaned cached element if still alive
      host.appendChild(cached.element);
      return;
    }

    let App;
    try {
      if (kind === "loot") {
        const m = await import("../cloud-v2/loot-generator.mjs");
        App = m.BeneosLootGenerator;
      } else if (kind === "shop") {
        const m = await import("../cloud-v2/magic-shop-generator.mjs");
        App = m.BeneosMagicShopGenerator;
      } else if (kind === "forge") {
        const m = await import("../cloud-v2/forge-generator.mjs");
        App = m.BeneosForge;
      } else return;
    } catch (e) {
      console.error(`Beneos | Failed to load ${kind}-generator module`, e);
      host.innerHTML = `<div class="generator-pane"><h2>${game.i18n.format("BENEOS.Codex.GeneratorLoadFailed", { kind })}</h2></div>`;
      return;
    }

    const app = new App();
    try {
      await app.render(true);
    } catch (e) {
      console.error(`Beneos | ${kind}-generator failed to render`, e);
      return;
    }
    const genEl = app.element;
    if (!genEl) return;
    host.appendChild(genEl);
    genEl.classList.add("codex-embedded");
    // Hide the window frame inside the host
    genEl.querySelectorAll(".window-header, .window-resize-handle").forEach(el => {
      el.style.display = "none";
    });
    (this._embeddedGen ??= {})[kind] = app;
  }

  async _teardownEmbeddedGenerators(keepKind) {
    if (!this._embeddedGen) return;
    for (const [k, app] of Object.entries(this._embeddedGen)) {
      if (k === keepKind) continue;
      try { await app.close({ force: true }); } catch (_) {}
      delete this._embeddedGen[k];
    }
  }

  async close(options) {
    await this._teardownEmbeddedGenerators();
    if (this._onPagerKey) {
      window.removeEventListener("keydown", this._onPagerKey);
      this._onPagerKey = null;
      this._pagerKeysWired = false;
    }
    return super.close(options);
  }

  // ---- one-time partial registration --------------------------------

  static async preregisterPartials() {
    const partials = [
      "hub", "header", "sub-hero",
      "item-page", "item-gallery", "item-detail", "item-concept-rail", "item-tier-card",
      "creature-page",
      "creature-detail-page",
      "world-page",
      "wip-screen",
    ];
    const creatureSubparts = [
      "hero", "tab-overview", "tab-hooks", "tab-foreshadow", "tab-theater", "tab-tactics",
      "sub-general", "sub-abilities", "sub-autopilot", "ap-round",
      "ability-card", "tac-rule", "tac-inline",
    ];
    const map = {};
    for (const name of partials) {
      const path = `${TEMPLATE_ROOT}/parts/${name}.hbs`;
      map[`beneos-codex/${name}`] = path;
    }
    for (const name of creatureSubparts) {
      const path = `${TEMPLATE_ROOT}/parts/creature/${name}.hbs`;
      map[`beneos-codex/creature/${name}`] = path;
    }
    try {
      await foundry.applications.handlebars.loadTemplates(map);
    } catch {
      // Fallback for older Foundry where the helper lives on the namespace root.
      if (typeof loadTemplates === "function") await loadTemplates(Object.values(map));
    }
  }

  // ---- Creature-detail action handlers -----------------------------

  static _onCreatureTab(_event, target) {
    const tab = target.dataset.cdxTab;
    if (!tab) return;
    this._creatureTab = tab;
    this.render(false);
  }
  static _onCreatureTacticsSub(_event, target) {
    const sub = target.dataset.cdxSub;
    if (!sub) return;
    this._creatureTacticsSub = sub;
    this.render(false);
  }
  static _onCreatureAbilityFilter(_event, target) {
    const f = target.dataset.cdxFilter;
    if (!f) return;
    this._creatureAbilityFilter = f;
    this.render(false);
  }
  static async _onCreatureOpenActor(_event, target) {
    const actorId = target.dataset.actorId;
    const actor = game.actors?.get?.(actorId);
    if (!actor) return;
    try { await actor.sheet.render(true); } catch (e) { console.warn("Codex open-actor failed:", e); }
  }
  static async _onCreatureDownloadPdf(_event, target) {
    const actor = game.actors?.get?.(target?.dataset?.actorId);
    const flag = actor?.getFlag?.("world", "beneos") ?? {};
    const tokenKey = flag.tokenKey ?? flag.fullId ?? actor?.id;
    try {
      const mod = await import("../codex/codex-pdf-service.mjs");
      const ok = await mod.downloadCreaturePdf(tokenKey);
      if (ok) this.render(false);
    } catch (err) {
      console.error("[beneos-codex] PDF download failed", err);
      ui.notifications?.error?.(game.i18n.format(
        "BENEOS.CreatureCodex.Warning.PdfFailed",
        { reason: err?.message ?? "unknown" }
      ));
    }
  }
  static async _onCreatureOpenPdf(_event, target) {
    const path = target?.dataset?.pdfPath;
    if (!path) return;
    const actor = game.actors?.get?.(target?.dataset?.actorId);
    const mod = await import("./pdf-viewer-window.mjs");
    mod.openPdfViewer(path, actor?.name ?? "");
  }
  static _onCreatureRoundPlus(_event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    bumpTheaterRound(actorId, +1);
    this.render(false);
  }
  static _onCreatureRoundMinus(_event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    bumpTheaterRound(actorId, -1);
    this.render(false);
  }
  static _onCreatureRoundReset(_event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    resetTheaterState(actorId);
    this.render(false);
  }
  static _onCreatureMarkUsed(_event, target) {
    const actorId = target.dataset.actorId;
    const name    = target.dataset.abilityName;
    if (!actorId || !name) return;
    markAbilityUsed(actorId, name);
    this.render(false);
  }
  static _onCreatureMarkFirstApp(_event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    const current = (target.dataset.firstAppRead === "true");
    setFirstAppearanceRead(actorId, !current);
    this.render(false);
  }
  static async _onCreatureReadAloud(_event, target) {
    const actorId = target.dataset.actorId;
    const text    = target.dataset.readText ?? "";
    const title   = target.dataset.readTitle ?? "";
    const actor = actorId ? game.actors?.get?.(actorId) : null;
    if (!text.trim()) return;
    try {
      await ChatMessage.create({
        speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
        content: `<div class="beneos-codex-readaloud"><strong>${foundry.utils.escapeHTML?.(title) ?? title}</strong><p>${foundry.utils.escapeHTML?.(text) ?? text}</p></div>`,
      });
    } catch (e) { console.warn("Codex read-aloud chat post failed:", e); }
  }
  static async _onCreatureTriggerAbility(_event, target) {
    const actorId = target.dataset.actorId;
    const itemId  = target.dataset.itemId;
    const actor = game.actors?.get?.(actorId);
    const item  = actor?.items?.get?.(itemId);
    if (!item) return;
    try {
      if (typeof item.use === "function") await item.use();
      else if (typeof item.roll === "function") await item.roll();
    } catch (e) { console.warn("Codex trigger-ability failed:", e); }
  }
  static async _onCreatureRollChip(_event, target) {
    const formula = target.dataset.rollFormula ?? "";
    const actorId = target.dataset.actorId;
    const actor   = actorId ? game.actors?.get?.(actorId) : null;
    if (!formula) return;
    try {
      const roll = await (new Roll(formula)).evaluate();
      await roll.toMessage({ speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined });
    } catch (e) { console.warn("Codex chip roll failed:", e); }
  }
  static async _onCreatureAllySearch(_event, target) {
    openAllyCloudSearch(target?.dataset?.allyName ?? "");
  }
  /** Toggle the clicked prompt's summary card open/closed (slow fade via CSS). */
  static _onCreatureTogglePrompt(_event, target) {
    target?.closest?.(".cdx-prompt")?.classList?.toggle?.("cdx-prompt-open");
  }

  static async _onCreatureTriggerDeath(_event, target) {
    const actorId = target.dataset.actorId;
    const actor = game.actors?.get?.(actorId);
    if (!actor) return;
    try {
      const mod = await import("../codex/codex-death-prompt.mjs");
      const codexData = await (await import("../codex/codex-data-adapter.mjs")).getCodexDataForActor(actor);
      new mod.BeneosCodexDeathPrompt({ codexData, actor }).render({ force: true });
    } catch (e) { console.warn("Codex trigger-death failed:", e); }
  }

  // ---- public API ---------------------------------------------------

  static open(...segs) {
    if (!BeneosCodex._instance) BeneosCodex._instance = new BeneosCodex();
    BeneosCodex._instance.setRoute(...segs);
    BeneosCodex._instance.render({ force: true });
    return BeneosCodex._instance;
  }
}
