// Beneos Creature Codex — single-creature detail-page builder.
// Lives inside the v2 BeneosCodex route system: the route
// ["creatures", "<tokenKey>"] lands here. The v1 codex-data-adapter
// does the heavy lifting (parses the Beneos creature journal +
// actor flags into a CreatureCodex shape); this module owns the
// v2 ApplicationV2 context, tab/sub-tab state and the action wiring.

import { getCodexDataForActor, tokenizeV13ToTacText, enrichDescription, buildAbilityRefTooltip } from "../codex/codex-data-adapter.mjs";
import { buildHeaderPills, buildDamageLine } from "./ability-foundry-resolver.mjs";

// Per-actor combat-theater state survives tab/sub-tab switches. Lost on
// world reload, which is fine: a new combat starts at round 1 anyway.
const _theaterState = new Map();

function getTheaterState(actorId) {
  if (!_theaterState.has(actorId)) {
    _theaterState.set(actorId, { round: 1, firstAppRead: false, used: {} });
  }
  return _theaterState.get(actorId);
}

/** A field counts as "no real content" when it is empty or a placeholder
 *  ("Work in Progress" / "WIP"). Used to hide unfinished content. */
export function isWip(s) {
  // Placeholder content: empty, or starts with "WIP" / "Work in Progress"
  // (covers "Work in Progress.", "Work in Progress - Description …", "WIP - …").
  const t = String(s ?? "").trim().toLowerCase();
  return !t || /^wip\b/.test(t) || t.startsWith("work in progress");
}
const _isWip = isWip;

export function resetTheaterState(actorId) {
  _theaterState.set(actorId, { round: 1, firstAppRead: false, used: {} });
}

export function bumpTheaterRound(actorId, delta) {
  const s = getTheaterState(actorId);
  s.round = Math.max(1, s.round + delta);
  return s.round;
}

export function markAbilityUsed(actorId, name) {
  const s = getTheaterState(actorId);
  s.used[name] = (s.used[name] || 0) + 1;
  return s.used[name];
}

export function setFirstAppearanceRead(actorId, value) {
  const s = getTheaterState(actorId);
  s.firstAppRead = !!value;
}

const POPOUT_MAX_WIDTH = 800;
let _BeneosImagePopout = null;

/** Lazily build a fixed-size, non-resizable ImagePopout subclass. We size
 *  in `_preFirstRender` (before the first paint) instead of letting the core
 *  fit-to-2x-natural logic run and then shrinking afterwards, which caused a
 *  big-then-small flicker. The whole image is always shown (window = image
 *  aspect at <=800px wide) and cannot be resized. Keeps the Show-Players
 *  control inherited from ImagePopout. */
function _getBeneosImagePopout() {
  if (_BeneosImagePopout) return _BeneosImagePopout;
  const Base = foundry.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;
  if (!Base) return null;
  _BeneosImagePopout = class BeneosImagePopout extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["image-popout", "beneos-image-popout"],
      window: { resizable: false },
    };
    async _preFirstRender(context, options) {
      let w = 0, h = 0;
      try {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { w = img.naturalWidth || 0; h = img.naturalHeight || 0; resolve(); };
          img.onerror = () => resolve();
          img.src = this.options.src;
        });
      } catch (_) {}
      // Account for the window chrome so the full image fits with a uniform
      // margin: titlebar (~36) + the scoped figure padding (14 each side).
      // object-fit:contain (CSS) guarantees no clipping if these are slightly
      // off. HORIZ shrinks the image box width; VERT is titlebar + padding.
      const HORIZ = 30, VERT = 64;
      const width = (w > 0) ? Math.min(POPOUT_MAX_WIDTH, w) : POPOUT_MAX_WIDTH;
      const height = (w > 0 && h > 0)
        ? Math.round((width - HORIZ) * h / w) + VERT
        : undefined;
      options.position = Object.assign(options.position ?? {}, height ? { width, height } : { width });
    }
  };
  return _BeneosImagePopout;
}

/** Open a hero/journal image full-size (correct aspect, Show-Players, X).
 *  Fixed 800px wide (never upscaled), complete image always visible,
 *  not resizable, no open-then-shrink flicker. */
export function openImagePopout(src, title = "") {
  if (!src) return;
  const Popout = _getBeneosImagePopout();
  if (!Popout) return;
  try {
    new Popout({ src, window: { title } }).render({ force: true });
  } catch (e) { console.warn("Beneos Codex | image popout failed:", e); }
}

/** tokenKey pattern for SRD creatures (e.g. `000-srd_darkmantle`). Mirrors
 *  BeneosUtility.SRD_KEY_RE so SRD detection stays consistent without a hard
 *  import dependency. SRD creatures ship no dedicated journal art. */
const SRD_KEY_RE = /(?:^|[-_])srd[-_]/i;
function isSrdKey(tokenKey) {
  const re = globalThis.BeneosUtility?.SRD_KEY_RE ?? SRD_KEY_RE;
  return re.test(String(tokenKey ?? ""));
}

/** Open the Beneos cloud search on Creatures (tokens) with the free-text
 *  filter prefilled to a recommended ally's name, so that one creature
 *  surfaces. Reuses an open window instance when present. */
export async function openAllyCloudSearch(query) {
  if (!query) return;
  try {
    const mod = await import("../cloud-v2/cloud-window-v2.mjs");
    const Klass = mod.BeneosCloudWindowV2 ?? mod.default;
    if (!Klass) return;
    let inst = game.beneos?.cloudWindowV2;
    if (!inst) inst = new Klass();
    inst.searchMode = "token";   // Creatures
    inst._textFilter = query;    // wireSidebarListeners fills #beneos-search-text; renderResults filters
    await inst.render({ force: true });
    // Safety net: ensure the field reflects the query and the keyup-bound
    // listener re-filters even if the window was already mounted.
    setTimeout(() => {
      const input = document.querySelector("#beneos-search-text");
      if (input && input.value !== query) {
        input.value = query;
        input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      }
    }, 300);
  } catch (e) {
    console.warn("Beneos Codex | ally cloud search failed:", e);
  }
}

/** Locked-click feedback: a paid creature/feature was clicked without access.
 *  Pulse the central Locked card and flash a glow on the Join-Patreon button,
 *  so the block is unmistakable. Used by the codex + autopilot windows when a
 *  gated action (tab switch, PDF, journal popout) is attempted while locked. */
export function flashPaywallDenied(rootEl) {
  if (!rootEl) return;
  const pairs = [
    [rootEl.querySelector(".beneos-paywall-card"), "is-denied"],
    [rootEl.querySelector(".beneos-paywall-join"), "is-denied-glow"],
  ];
  for (const [node, cls] of pairs) {
    if (!node) continue;
    node.classList.remove(cls);
    void node.offsetWidth; // restart the animation
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), 800);
  }
}

/** Ensure the ambient ember field exists in the window. The codex/autopilot
 *  re-render their "main" part on every tab switch, which would restart any
 *  hero-attached CSS animation. We instead inject a single persistent element
 *  into the persistent .window-content (a sibling of the re-rendered part) so
 *  the drift runs continuously. On every render we only re-measure the hero
 *  band and resize the field to match. Resizing does NOT restart the animation,
 *  so the embers keep drifting across tabs. Safe to call on each _onRender. */
export function mountEmberField(rootEl) {
  try {
    const content = rootEl?.querySelector?.(".window-content");
    if (!content) return;
    let field = content.querySelector(":scope > .cdx-ember-field");
    if (!field) {
      field = document.createElement("div");
      field.className = "cdx-ember-field";
      field.setAttribute("aria-hidden", "true");
      content.appendChild(field);
    }
    // Keep the band aligned to the (re-rendered) hero header height so the
    // embers stay in the header and never bleed over the scrolling body.
    const hero = content.querySelector(".cdx-creature-hero");
    const h = Math.round(hero?.offsetHeight || 0);
    field.style.height = h > 0 ? `${h}px` : "140px";
  } catch (_) { /* ambient effect only; never block render */ }
}

/** Wire right-click on an item chip to open that item's sheet. Left-click
 *  keeps firing the ability (cdx-trigger-ability). Idempotent per element. */
export function attachItemSheetContextMenu(root) {
  if (!root || root._beneosItemCtxBound) return;
  root._beneosItemCtxBound = true;
  root.addEventListener("contextmenu", (ev) => {
    const el = ev.target?.closest?.("[data-item-id][data-actor-id]");
    if (!el) return;
    ev.preventDefault();
    const actor = game.actors?.get?.(el.dataset.actorId);
    const item = actor?.items?.get?.(el.dataset.itemId);
    try { item?.sheet?.render(true); } catch (_) {}
  });
}

/** Resolve an actor by its world.beneos tokenKey or fullId. */
export function findActorByTokenKey(tokenKey) {
  if (!tokenKey || !game.actors) return null;
  for (const actor of game.actors) {
    const f = actor.getFlag?.("world", "beneos");
    if (!f) continue;
    if (f.fullId === tokenKey || f.tokenKey === tokenKey) return actor;
  }
  return null;
}

/** Build the Handlebars context for the creature-detail page.
 *  Returns { ready: false, ... } if the actor cannot be resolved so the
 *  template can render an inline "not found" stub instead of crashing. */
export async function buildCreatureDetailCtx({ tokenKey, activeTab, activeTacticsSub, activeAbilityFilter, codex: codexState }) {
  const actor = findActorByTokenKey(tokenKey);
  if (!actor) {
    return { ready: false, tokenKey, reason: "actor-not-found" };
  }

  let data;
  try {
    data = await getCodexDataForActor(actor);
  } catch (e) {
    console.warn("Beneos | getCodexDataForActor failed:", e);
    return { ready: false, tokenKey, reason: "adapter-error", error: String(e?.message ?? e) };
  }

  // Paywall gate. Active Creatures/Spells/Loot (tokens) patrons see everything;
  // others only get free creatures (free_content flag on the token). The free
  // flag lives on BeneosUtility.beneosTokens[<dbKey>].properties (same source as
  // the cloud cards). Resolve the DB key from the actor's world flag, falling
  // back to the passed tokenKey. Missing entry -> not free (safe default).
  const hasTokenAccess = !!game.beneos?.cloud?.hasCampaignAccess?.("tokens");
  const _worldFlag = actor.getFlag?.("world", "beneos") ?? {};
  // The token DB is keyed by the BASE key (e.g. "000-goblin_pack_1_crookshank");
  // the actor's world flag exposes that as `tokenKey`, while `fullId` carries a
  // "_<variant>" suffix that is NOT a DB key. Resolve via databaseHolder and try
  // base key first, then strip a trailing "_<n>" as a fallback.
  const _dh = game.beneos?.databaseHolder;
  const _info = (k) => k ? (_dh?.getTokenDatabaseInfo?.(k) ?? _dh?.tokenData?.content?.[k] ?? null) : null;
  const _strip = (k) => String(k ?? "").replace(/_\d+$/, "");
  const _dbInfo = _info(_worldFlag.tokenKey) ?? _info(tokenKey)
               ?? _info(_strip(_worldFlag.fullId)) ?? _info(_strip(tokenKey));
  // Free status from the cloud "Free" tier (data.free), the dynamic source of
  // truth — not the stale catalog free_content flag. Missing key -> not free.
  const _freeKey = _worldFlag.tokenKey ?? tokenKey ?? _strip(_worldFlag.fullId) ?? _strip(tokenKey);
  const isFree = game.beneos?.cloud?.isFreeAsset?.("token", _freeKey) === true;

  // Image paths: normalize so the template's <img src> and inline
  // background-image rules resolve from the page root. Foundry usually
  // stores these as world-relative paths ("beneos_assets/..."); CSS
  // would otherwise resolve them against the .css file location (404).
  // Force a leading slash so both interpretations land on /beneos_assets.
  const _norm = (u) => (u && !/^([a-z]+:|\/)/i.test(u)) ? "/" + u.replace(/^\/+/, "") : u;
  const srd = isSrdKey(tokenKey);
  if (data) {
    data.heroImageUrl = _norm(data.heroImageUrl);
    data.avatarUrl    = _norm(data.avatarUrl);
    // SRD creatures ship no dedicated journal art (heroImageUrl would only
    // fall back to the portrait), so suppress the header journal + popout.
    if (srd) data.heroImageUrl = null;

    // Header meta line: "Size Type" via dnd5e CONFIG labels, plus an origin
    // marker (Beneos Original vs SRD Creature). Alignment is intentionally
    // omitted — it made the line too long and wrapped in the header.
    const cfg = CONFIG.DND5E ?? {};
    const sizeKey = actor.system?.traits?.size;
    const sizeLabel = cfg.actorSizes?.[sizeKey]?.label ?? cfg.actorSizes?.[sizeKey] ?? "";
    const typeKey = actor.system?.details?.type?.value;
    const typeLabel = cfg.creatureTypes?.[typeKey]?.label ?? cfg.creatureTypes?.[typeKey]?.name ?? data.type ?? "";
    data.typeLine = [sizeLabel, typeLabel].filter(Boolean).join(" ");
    data.isSrd = srd;

    // Drop placeholder foreshadowing entries ("Prompt 1" / "Work in Progress"):
    // keep an entry only if its text is real OR it carries a real check result.
    data.foreshadowing = (data.foreshadowing ?? [])
      .filter(f => !_isWip(f.text) || (f.checks ?? []).some(c => !_isWip(c.result)));
  }

  // PDF state: if the creature's stat-block PDF is already installed locally
  // the hero button shows "View PDF" (opens the embedded viewer); otherwise
  // "Download PDF" (installs it). Detection is best-effort — never blocks.
  if (data && tokenKey) {
    try {
      const pdfSvc = await import("../codex/codex-pdf-service.mjs");
      data.pdfInstalled = await pdfSvc.isPdfInstalled(tokenKey);
      data.pdfLocalPath = pdfSvc.pdfServedPath(tokenKey);
    } catch (_) {
      data.pdfInstalled = false;
    }
  }

  // Build a resolver that maps a [[/item NAME]] reference to the actor item
  // id + its Beneos summary, so tokenized text can render clickable chips
  // and hover tooltips. Shared by ability cards, prompts and any tokenized
  // string in this context.
  const _beneosAbilities = actor.flags?.beneos?.content?.abilities ?? [];
  const _normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const _actorItems = Array.from(actor.items ?? []);
  // Enrich each item's dnd5e description once so the ability-reference hover
  // tooltip can show the real ability text beside the Beneos comment. The
  // card display itself is unchanged; this only feeds the tooltip.
  const _descById = new Map();
  for (const it of _actorItems) {
    const raw = it.system?.description?.value ?? "";
    _descById.set(it.id, raw ? await enrichDescription(raw, it) : "");
  }
  const resolveItem = (refName) => {
    const target = _normName(refName);
    if (!target) return null;
    const item = _actorItems.find(it => _normName(it.name) === target)
      || _actorItems.find(it => _normName(it.name).includes(target))
      || _actorItems.find(it => target.includes(_normName(it.name)));
    if (!item) return null;
    const ab = _beneosAbilities.find(a => a.sourceItemId === item.id)
      || _beneosAbilities.find(a => _normName(a.name) === _normName(item.name));
    const summary = (ab && ab.summary) || "";
    return { id: item.id, summary, summaryHtml: buildAbilityRefTooltip(_descById.get(item.id) || "", summary) };
  };

  // Enrich each ability-prompt with the matching Foundry item id, image
  // and a short summary so the Combat-Theater tab can show the ability
  // icon next to the prompt and a hover tooltip. The summary prefers the
  // Beneos content-schema text, falling back to the dnd5e description.
  // Both the read-aloud text and the summary are tokenized so inline
  // [[/item]] / {kw:…} markup renders as chips, never as raw text.
  if (Array.isArray(data?.abilityPrompts)) {
    data.abilityPrompts = data.abilityPrompts.map(p => {
      const item = _matchItemForPrompt(actor, p.name);
      const beneosMatch = _matchBeneosAbility(p.name, _beneosAbilities);
      const summary = (beneosMatch?.summary && beneosMatch.summary.trim())
                   || (item ? _firstLine(_stripHtml(item.system?.description?.value ?? "")) : null);
      return {
        ...p,
        itemId: item?.id ?? null,
        itemImg: item?.img ?? null,
        itemSummary: summary,
        textTokens: tokenizeV13ToTacText(p.text ?? "", resolveItem),
        summaryTokens: summary ? tokenizeV13ToTacText(summary, resolveItem) : [],
      };
    });
  }

  // Tokenized read-aloud prompts for the combat prompt engine (clickable
  // item refs / styled keyword chips, never raw markup).
  if (data) {
    data.deathPromptTokens = data.deathPrompt ? tokenizeV13ToTacText(data.deathPrompt, resolveItem) : [];
    data.firstAppearanceTokens = data.firstAppearance ? tokenizeV13ToTacText(data.firstAppearance, resolveItem) : [];
  }

  const tacticsSubs = [
    { id: "general",   labelKey: "BENEOS.CreatureCodex.TacticsSub.General",   icon: "fa-solid fa-list-ul" },
    { id: "abilities", labelKey: "BENEOS.CreatureCodex.TacticsSub.Abilities", icon: "fa-solid fa-bolt" },
    { id: "autopilot", labelKey: "BENEOS.CreatureCodex.TacticsSub.Autopilot", icon: "fa-solid fa-play" },
  ].map(t => ({ ...t, label: game.i18n.localize(t.labelKey), active: t.id === activeTacticsSub }));

  // Build the ability list from dnd5e items. Map dnd5e item categories
  // to the codex filter buckets, then split into the always-visible
  // passive sidebar (right column) and the filterable active list
  // (left column). The filter bar in the UI only changes the left
  // column, the passives stay constant.
  const allAbilities = _collectAbilities(actor, data, resolveItem);
  const passiveAbilities = allAbilities.filter(a => a.filterKey === "passive");
  const activeAbilities  = allAbilities.filter(a => a.filterKey !== "passive");

  // Passive Traits live in the right-hand sidebar and aren't in the
  // filter bar. A filter button only appears when the creature actually
  // has at least one ability of that type (no empty "Bonus"/"Legendary").
  const presentKeys = new Set(activeAbilities.map(a => a.filterKey));
  const abilityFilters = [
    { id: "all",       labelKey: "BENEOS.CreatureCodex.Filter.All" },
    { id: "action",    labelKey: "BENEOS.CreatureCodex.Filter.Action" },
    { id: "bonus",     labelKey: "BENEOS.CreatureCodex.Filter.Bonus" },
    { id: "reaction",  labelKey: "BENEOS.CreatureCodex.Filter.Reaction" },
    { id: "legendary", labelKey: "BENEOS.CreatureCodex.Filter.Legendary" },
    { id: "player",    labelKey: "BENEOS.CreatureCodex.Filter.Player" },
  ].filter(f => f.id === "all" || presentKeys.has(f.id))
   .map(f => ({ ...f, label: game.i18n.localize(f.labelKey), active: f.id === activeAbilityFilter }));
  const filteredAbilities = (activeAbilityFilter === "all" || activeAbilityFilter === "passive")
    ? activeAbilities
    : activeAbilities.filter(a => a.filterKey === activeAbilityFilter);

  // Build the autopilot round-by-round sequence from the Beneos schema.
  const autopilot = _buildAutopilot(actor, resolveItem);

  // Dynamic tabs: a content tab only appears when it carries real content.
  // Empty or placeholder ("Work in Progress" / "WIP") entries don't count,
  // so unfinished creatures don't show hollow tabs. Overview always shows.
  const tacticsText = (data.tacticalSections ?? [])
    .flatMap(s => (s.items ?? []).map(it => (it.text ?? []).map(p => typeof p === "string" ? p : (p.chip ?? "")).join(" ")));
  const tabHasContent = {
    overview:   true,
    hooks:      (data.storyPrompts ?? []).some(p => !_isWip(p.text)),
    foreshadow: (data.foreshadowing ?? []).some(f => !_isWip(f.text) || (f.checks ?? []).some(c => !_isWip(c.result))),
    theater:    (data.abilityPrompts ?? []).some(p => !_isWip(p.text)) || !_isWip(data.firstAppearance) || !_isWip(data.deathPrompt),
    tactics:    tacticsText.some(t => !_isWip(t)) || allAbilities.length > 0 || autopilot.hasContent,
  };
  const tabDefs = [
    { id: "overview",   labelKey: "BENEOS.CreatureCodex.Tab.Overview",    icon: "fa-solid fa-circle-info" },
    { id: "hooks",      labelKey: "BENEOS.CreatureCodex.Tab.Hooks",       icon: "fa-solid fa-star",          count: data.storyPrompts?.length },
    { id: "foreshadow", labelKey: "BENEOS.CreatureCodex.Tab.Foreshadow",  icon: "fa-solid fa-eye",           count: data.foreshadowing?.length },
    { id: "theater",    labelKey: "BENEOS.CreatureCodex.Tab.Theater",     icon: "fa-solid fa-masks-theater", count: data.abilityPrompts?.length },
    { id: "tactics",    labelKey: "BENEOS.CreatureCodex.Tab.Tactics",     icon: "fa-solid fa-chess-knight", standalone: true },
  ].filter(t => tabHasContent[t.id]);
  // If the previously-active tab got hidden, fall back to overview.
  const effectiveActiveTab = tabDefs.some(t => t.id === activeTab) ? activeTab : "overview";
  const tabs = tabDefs.map(t => ({ ...t, label: game.i18n.localize(t.labelKey), active: t.id === effectiveActiveTab }));

  return {
    ready: true,
    tokenKey,
    actorId: actor.id,
    actorName: actor.name,
    data,
    tabs,
    activeTab: effectiveActiveTab,
    tacticsSubs,
    activeTacticsSub,
    abilityFilters,
    activeAbilityFilter,
    allAbilities,
    activeAbilities,
    passiveAbilities,
    filteredAbilities,
    abilityGroupsForAll: _groupAbilitiesForAll(activeAbilities, abilityFilters),
    hasPassives: passiveAbilities.length > 0,
    autopilot,
    // Derived flags for the template
    hasLore:             !!data.lore?.trim(),
    hasRecommendedAllies: (data.recommendedAllies?.length ?? 0) > 0,
    hasStoryPrompts:     (data.storyPrompts?.length ?? 0) > 0,
    hasForeshadowing:    (data.foreshadowing?.length ?? 0) > 0,
    hasFirstAppearance:  !_isWip(data.firstAppearance),
    hasAbilityPrompts:   (data.abilityPrompts?.length ?? 0) > 0,
    hasDeathPrompt:      !_isWip(data.deathPrompt),
    hasTacticsGeneral:   (data.tacticalGuide?.startOfTurn?.length ?? 0) +
                         (data.tacticalGuide?.movement?.length ?? 0) +
                         (data.tacticalGuide?.traits?.length ?? 0) > 0,
    hasAbilities:        allAbilities.length > 0,
    hasAutopilot:        autopilot.hasContent,
    // Content-origin hint + paywall gate: this is Beneos Creatures/Spells/Loot
    // (tokens) content. Free creatures stay open (with a free-preview hint);
    // paid creatures are locked for non-patrons (blurred body + Join CTA), so
    // download-and-cancel users can't keep using the content after cancelling.
    hasTokenAccess:      hasTokenAccess,
    isFree:              isFree,
    locked:              !hasTokenAccess && !isFree,
    joinPatreonUrl:      "https://www.patreon.com/c/BeneosTokens",
  };
}

/** Pull all activatable items off the actor and bucket them by the
 *  five filter categories: action / bonus / reaction / legendary /
 *  player. Anything passive (always-on traits, lair actions without a
 *  consume mechanic) goes into the "passive" bucket.
 *
 *  Beneos content schema (v1.4.1) provides the authoritative ability
 *  metadata when present on flags.beneos.content.abilities[]:
 *    - `summary`  → card summary text
 *    - `categories[]` → primary source for the filter bucket
 *
 *  When no Beneos match exists we fall back to the dnd5e activation
 *  inference for stock NPC sheets. Legacy property names
 *  (mechanicalText/flavorText, singular `type`) remain as fallbacks for
 *  pre-1.4 migrated docs. */
function _collectAbilities(actor, data, resolveItem = null) {
  const out = [];
  const beneosAbilities = actor.flags?.beneos?.content?.abilities ?? [];
  for (const item of actor.items ?? []) {
    const sys = item.system ?? {};
    // dnd5e 5.x stores activation either on system.activation or on the
    // first entry of system.activities (Map or plain object — handle both).
    const activitiesFirst = sys.activities
      ? (typeof sys.activities.values === "function"
          ? sys.activities.values().next().value
          : Object.values(sys.activities)[0])
      : null;
    const act = sys.activation?.type ?? activitiesFirst?.activation?.type;
    const beneosMatch = _matchBeneosAbility(item.name, beneosAbilities);
    const filterKey = _categoriesToFilter(beneosMatch?.categories)
                    || _legacyTypeToFilter(beneosMatch?.type)
                    || _mapActivationToFilter(item, act);
    if (!filterKey) continue;
    const summary = (beneosMatch?.summary && beneosMatch.summary.trim())
                 || (beneosMatch?.mechanicalText && beneosMatch.mechanicalText.trim())
                 || (beneosMatch?.flavorText && beneosMatch.flavorText.trim())
                 || _firstLine(_stripHtml(sys.description?.value ?? ""));
    out.push({
      id: item.id,
      name: item.name,
      img: item.img,
      summary,
      summaryTokens: summary ? tokenizeV13ToTacText(summary, resolveItem) : [],
      description: sys.description?.value ?? "",
      pills: buildHeaderPills(item, actor),
      damageLine: buildDamageLine(item),
      filterKey,
      filterLabel: _filterLabel(filterKey),
      isLegendary: filterKey === "legendary",
      isPassive:   filterKey === "passive",
    });
  }
  return out;
}

/** Map a Beneos schema `categories[]` array to a single filter bucket,
 *  using a fixed priority so a multi-tagged ability lands in the most
 *  active bucket. Tags that are pure narrative markers (`main_mechanics`)
 *  are ignored. Both camel (`bonusActions`) and snake (`bonus_actions`)
 *  category names are tolerated. */
function _categoriesToFilter(categories) {
  if (!Array.isArray(categories) || !categories.length) return null;
  const norm = (s) => String(s || "").toLowerCase().replace(/[_\-\s]+/g, "");
  const present = new Set(categories.map(norm));
  if (present.has("legendaryactions") || present.has("lairactions")) return "legendary";
  if (present.has("actions"))                                         return "action";
  if (present.has("bonusactions"))                                    return "bonus";
  if (present.has("reactions"))                                       return "reaction";
  if (present.has("traits") || present.has("startofturn") ||
      present.has("endofturn") || present.has("passive"))              return "passive";
  return null;
}

/** Pre-1.4 migrated docs occasionally exposed a singular `type` field on
 *  abilities. Keep mapping it so legacy data still buckets correctly. */
function _legacyTypeToFilter(type) {
  if (!type) return null;
  const t = String(type).toLowerCase();
  if (t === "action")    return "action";
  if (t === "bonus")     return "bonus";
  if (t === "reaction")  return "reaction";
  if (t === "legendary" || t === "lair") return "legendary";
  if (t === "trait" || t === "passive")  return "passive";
  if (t === "player")    return "player";
  return null;
}

/** Three-tier name-normalized match between a dnd5e item name and a
 *  Beneos content-schema ability. Same pattern as _matchItemForPrompt. */
function _matchBeneosAbility(itemName, beneosAbilities) {
  if (!itemName || !Array.isArray(beneosAbilities) || !beneosAbilities.length) return null;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(itemName);
  if (!target) return null;
  for (const ab of beneosAbilities) if (norm(ab.name) === target) return ab;
  for (const ab of beneosAbilities) if (norm(ab.name).includes(target)) return ab;
  for (const ab of beneosAbilities) if (target.includes(norm(ab.name))) return ab;
  return null;
}

/** Public lookup: the Beneos "Comment" summary string for a given actor
 *  item, or "" if the creature has no Beneos content for it. Reuses the
 *  same name-normalized match the codex cards use, so the NPC-sheet hover
 *  panel and the codex stay in sync. Prefers an explicit sourceItemId
 *  link, then falls back to the three-tier name match. */
export function getAbilitySummary(actor, item) {
  const beneosAbilities = actor?.flags?.beneos?.content?.abilities;
  if (!Array.isArray(beneosAbilities) || !beneosAbilities.length || !item) return "";
  const byId = item.id ? beneosAbilities.find(a => a.sourceItemId === item.id) : null;
  const ab = byId ?? _matchBeneosAbility(item.name, beneosAbilities);
  const summary = (ab?.summary && ab.summary.trim())
               || (ab?.mechanicalText && ab.mechanicalText.trim())
               || (ab?.flavorText && ab.flavorText.trim())
               || "";
  return _isWip(summary) ? "" : summary;
}

function _mapActivationToFilter(item, activationType) {
  const t = item.type;
  if (activationType === "action")    return "action";
  if (activationType === "bonus")     return "bonus";
  if (activationType === "reaction")  return "reaction";
  if (activationType === "legendary") return "legendary";
  if (activationType === "lair")      return "legendary";
  // Weapon items without an explicit activation are attacks (an Action
  // in dnd5e parlance). Without this the only items that survived the
  // filter were passive feats.
  if (t === "weapon") return "action";
  if (activationType === "special" || activationType === "none" || !activationType) {
    if (t === "feat") return "passive";
    return null;
  }
  // dnd5e spells default to "action" when the actor itself wields them;
  // "player" only kicks in for explicitly granted player-side spells.
  if (t === "spell") return "action";
  return null;
}

function _filterLabel(key) {
  const map = {
    action:    "BENEOS.CreatureCodex.Filter.Action",
    bonus:     "BENEOS.CreatureCodex.Filter.Bonus",
    reaction:  "BENEOS.CreatureCodex.Filter.Reaction",
    legendary: "BENEOS.CreatureCodex.Filter.Legendary",
    player:    "BENEOS.CreatureCodex.Filter.Player",
    passive:   "BENEOS.CreatureCodex.Filter.Passive",
  };
  return game.i18n.localize(map[key] ?? "");
}

/** Best-effort match between an ability-prompt name (free text from the
 *  journal/flag) and a dnd5e item on the actor sheet. Used by the
 *  Combat-Theater tab so the GM can hover a prompt to see the actual
 *  ability stats and trigger it inline. */
function _matchItemForPrompt(actor, promptName) {
  if (!actor?.items || !promptName) return null;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(promptName);
  if (!target) return null;
  // 1) exact normalized match
  for (const it of actor.items) {
    if (norm(it.name) === target) return it;
  }
  // 2) item name contains the prompt name
  for (const it of actor.items) {
    if (norm(it.name).includes(target)) return it;
  }
  // 3) prompt name contains the item name
  for (const it of actor.items) {
    if (target.includes(norm(it.name))) return it;
  }
  return null;
}

function _stripHtml(html) {
  if (!html) return "";
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.textContent ?? d.innerText ?? "";
}
function _firstLine(s) {
  if (!s) return "";
  const t = s.trim();
  const i = t.indexOf("\n");
  return i < 0 ? t : t.slice(0, i);
}

/** When the user has the "All" filter on, we still want to group the
 *  cards so the GM can scan the section. Returns [{ filter, list }]. */
function _groupAbilitiesForAll(allAbilities, abilityFilters) {
  const order = abilityFilters.filter(f => f.id !== "all").map(f => f.id);
  return order
    .map(key => ({
      filterKey: key,
      filterLabel: _filterLabel(key),
      list: allAbilities.filter(a => a.filterKey === key),
    }))
    .filter(g => g.list.length > 0);
}

/** Generate a heuristic 4-round autopilot script from the tactical
 *  guide phases. Round 1 is the opener, Round 2 the standard cycle,
 *  Round 3 the variant cycle and Round 4 the closer / contingency. */
/** Build the autopilot view-model straight from the Beneos content schema
 *  (flags.beneos.content.autopilot, v1.0). Opening Move + Fallback are the
 *  standing strategy; phases[].rounds[] flatten into a round-by-round list
 *  (round 1 .. maxRound), each with a compact head and expandable detail.
 *  All free-text fields are tokenized so [[/item]] / {kw:…} render as chips. */
function _buildAutopilot(actor, resolveItem) {
  const ap = actor.flags?.beneos?.content?.autopilot;
  if (!ap || typeof ap !== "object") return { hasContent: false, rounds: [] };

  const chip = (name) => {
    if (!name) return null;
    const r = resolveItem ? resolveItem(name) : null;
    return { name, itemId: r?.id ?? null };
  };

  const rounds = [];
  for (const phase of (ap.phases ?? [])) {
    const hp = phase.hpRange;
    const hpRangeLabel = (hp && hp.from != null && hp.to != null)
      ? game.i18n.format("BENEOS.CreatureCodex.Autopilot.HpRange", { from: hp.from, to: hp.to })
      : "";
    for (const r of (phase.rounds ?? [])) {
      rounds.push({
        n: r.round,
        phaseLabel: phase.label || "",
        hpRangeLabel,
        primary: chip(r.primaryAction?.abilityName),
        bonus: r.bonusAction ? chip(r.bonusAction.abilityName) : null,
        movementTokens: r.movement ? tokenizeV13ToTacText(r.movement, resolveItem) : [],
        positioningHintTokens: r.positioningHint ? tokenizeV13ToTacText(r.positioningHint, resolveItem) : [],
        dmHintTokens: r.dmHint ? tokenizeV13ToTacText(r.dmHint, resolveItem) : [],
        targetPriority: (Array.isArray(r.targetPriority) ? r.targetPriority : []).map(t => ({
          rank: t.rank,
          archetype: t.archetype || "",
          reasonTokens: t.reason ? tokenizeV13ToTacText(t.reason, resolveItem) : [],
        })),
        reactionTriggers: (r.reactionTriggers ?? []).map(t => ({
          name: t.abilityName || "",
          itemId: (resolveItem ? resolveItem(t.abilityName)?.id : null) ?? null,
          triggerTokens: t.trigger ? tokenizeV13ToTacText(t.trigger, resolveItem) : [],
        })),
      });
    }
  }
  rounds.sort((a, b) => (a.n ?? 0) - (b.n ?? 0));

  const openingMoveTokens = ap.openingMove ? tokenizeV13ToTacText(ap.openingMove, resolveItem) : [];
  const fallbackTokens    = ap.fallbackAction ? tokenizeV13ToTacText(ap.fallbackAction, resolveItem) : [];

  return {
    hasContent: rounds.length > 0 || openingMoveTokens.length > 0 || fallbackTokens.length > 0,
    openingMoveTokens,
    fallbackTokens,
    hasOpeningMove: openingMoveTokens.length > 0,
    hasFallback:    fallbackTokens.length > 0,
    maxRound: rounds.length ? Math.max(...rounds.map(r => r.n ?? 0)) : 0,
    rounds,
  };
}
