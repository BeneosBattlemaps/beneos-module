/**
 * creature-installer.mjs
 *
 * In-scene Creature Installer drawer. A viewport-anchored overlay that slides up
 * from the bottom of the screen on Beneos battlemap scenes and lets the GM place
 * the creatures intended for that scene:
 *
 *   - Free / SRD creatures: always placeable (one click or drag-and-drop).
 *   - Beneos creatures: hand-built premium tokens. Placeable for supporters of
 *     the Beneos Creatures Patreon; shown behind a tasteful support gate for
 *     everyone else (no "Premium"/lock/lootbox treatment - higher-craft framing).
 *
 * Data source: the scene flag written by the beneos-dev "Scan Scene Creatures"
 * tool (scene.flags["beneos-module"].creatureInstaller). A present, non-empty
 * flag is what activates the drawer - the in-scene navigation-bar art is only
 * visual context. The drawer is fully optional; a GM who only wants the map can
 * leave it collapsed.
 *
 * This module is intentionally self-contained: it registers its own hooks and
 * builds its own DOM/overlay (it does NOT modify beneos_module.js). Drag-and-drop
 * reuses Foundry's native Actor-drop ({type:"Actor", uuid}) so no custom
 * dropCanvasData handler is needed.
 *
 * The one import is the system-compatibility gate: it has to run ONCE per
 * install run, and the cloud install would otherwise ask per creature. There is
 * no global BeneosUtility to reach it through - the `globalThis.BeneosUtility`
 * reads elsewhere in the module resolve to undefined and are swallowed by their
 * optional chaining.
 */

import { BeneosUtility } from "../beneos_utility.js";

const MODULE_ID = "beneos-module";
const FLAG_SCOPE = "beneos-module";
const FLAG_KEY = "creatureInstaller";
const TEMPLATE = "modules/beneos-module/templates/creature-installer/drawer.hbs";

// Client-scoped, per-scene "hide this drawer" map { [sceneId]: true }. Local to
// each GM, never written to the scene -> never shipped/packed.
const HIDDEN_SETTING = "creatureInstallerHidden";

// Client-scoped, per-scene "the GM has opened this drawer at least once" map.
// Drives the one-time attract pulse on the collapsed tab; once opened it never
// pulses again (survives F5 / scene revisits).
const SEEN_SETTING = "creatureInstallerSeen";

// How long the drawer stays open after the cursor leaves it, so the gap between
// the bookmark tab and the panel can be crossed without it snapping shut.
const HOVER_CLOSE_DELAY = 250;

// Slack around the panel that still counts as "inside" for hover-close: applied
// to the left, right AND top edges (below the panel always stays open - that is
// the macro-hotbar area). Same margin on all three sides per design.
const HOVER_MARGIN = 8;

// Beneos token thumbnail CDN base (mirrors cloud-window-v2.mjs THUMB_BASE.token).
const TOKEN_THUMB_BASE = "https://www.beneos-database.com/data/tokens/thumbnails_v2/";

// V13 moved renderTemplate under foundry.applications.handlebars; keep a fallback
// to the (deprecated) global for older builds.
function renderTemplateCompat(path, data) {
  const rt = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  return rt(path, data);
}

// Stable identity for a creature entry (and for an assignment reference).
function entryKey(e) {
  return e?.fullId || e?.tokenKey || e?.name || null;
}

// All canvas placements of a creature entry. Supports the positions[] model and
// upgrades legacy single-x/y entries. Each position carries its own hidden flag.
function positionsOf(entry) {
  if (Array.isArray(entry?.positions) && entry.positions.length) return entry.positions;
  if (entry?.x != null && entry?.y != null) {
    return [{ x: entry.x, y: entry.y, elevation: entry.elevation, rotation: entry.rotation, width: entry.width, height: entry.height, hidden: !!entry.hidden, disposition: entry.disposition }];
  }
  return [];
}

const positionKey = (p) => `${Math.round(p.x ?? 0)},${Math.round(p.y ?? 0)},${p.hidden ? 1 : 0}`;

// Collapse a list to one entry per unique creature, merging their positions, so
// the drawer never shows the same creature twice (it may still sit at many spots).
function dedupeByCreature(list) {
  const out = [];
  const byKey = new Map();
  for (const e of (list || [])) {
    const k = entryKey(e);
    const ex = byKey.get(k);
    if (!ex) { const copy = { ...e, positions: [...positionsOf(e)] }; byKey.set(k, copy); out.push(copy); }
    else { for (const p of positionsOf(e)) if (!ex.positions.some(q => positionKey(q) === positionKey(p))) ex.positions.push(p); }
  }
  return out;
}

export class BeneosCreatureInstaller {
  /** @type {BeneosCreatureInstaller|null} */
  static instance = null;
  /** @type {boolean} whether the canvas/scene listeners are bound */
  static _hooked = false;

  constructor() {
    this.scene = null;
    this.data = null;
    this.expanded = false;
    /** @type {HTMLElement|null} */
    this.host = null;
    /** @type {number|null} hover-intent close timer */
    this._closeTimer = null;
  }

  /* --------------------------------------------------------------- lifecycle */

  /**
   * Register the scene/canvas listeners. Runs on `setup`, i.e. BEFORE the first
   * `canvasReady` fires, so the initial scene draw is never missed (this was the
   * cause of the "drawer absent after reload until a scene switch" bug: the
   * listeners used to be registered only on `ready`, which can land after the
   * initial canvasReady). Guarded so it only binds once.
   */
  static registerHooks() {
    if (BeneosCreatureInstaller._hooked) return;
    BeneosCreatureInstaller._hooked = true;
    const refresh = () => BeneosCreatureInstaller.get().attachToActiveScene();
    Hooks.on("canvasReady", refresh);
    // The flag may be (un)set on the active scene while it is open (admin scan).
    Hooks.on("updateScene", (scene) => {
      if (scene?.id === canvas?.scene?.id) refresh();
    });
  }

  static boot() {
    const refresh = () => BeneosCreatureInstaller.get().attachToActiveScene();
    // Belt and suspenders: registerHooks() normally already ran on `setup`; call
    // it again here in case the module loaded late (setup missed).
    BeneosCreatureInstaller.registerHooks();
    // Expose a refresh hook so the login/support flow can flip the drawer into
    // the patron state after a successful auth without a scene reload.
    game.beneos = game.beneos || {};
    game.beneos.creatureInstaller = BeneosCreatureInstaller.get();
    // On a hard reload (F5) canvasReady often fires BEFORE this ready hook, so the
    // setup-registered listener handled the initial draw already; this is just a
    // fallback if the canvas is already up.
    if (canvas?.ready) refresh();
    // Final safety net against load-order races (another module's updateScene /
    // a late flag migration firing before our listeners were bound): one deferred
    // attach. attachToActiveScene() is idempotent, so an extra call is harmless.
    setTimeout(() => { try { refresh(); } catch (e) { /* render() already logs */ } }, 300);
  }

  static get() {
    return (BeneosCreatureInstaller.instance ??= new BeneosCreatureInstaller());
  }

  refresh() { this.attachToActiveScene(); }

  /* -------------------------------------------------------- hide (per scene) */

  /** @returns {boolean} whether this GM hid the drawer on the current scene. */
  isHidden() {
    if (!this.scene) return false;
    try {
      const map = game.settings.get(MODULE_ID, HIDDEN_SETTING) || {};
      return map[this.scene.id] === true;
    } catch (e) { return false; }
  }

  async setHidden(bool) {
    if (!this.scene) return;
    try {
      const map = foundry.utils.duplicate(game.settings.get(MODULE_ID, HIDDEN_SETTING) || {});
      if (bool) map[this.scene.id] = true; else delete map[this.scene.id];
      await game.settings.set(MODULE_ID, HIDDEN_SETTING, map);
    } catch (e) { console.error("beneos | creature-installer setHidden failed", e); }
  }

  /** Has the GM opened the drawer on this scene before? (drives the attract pulse) */
  isSeen() {
    if (!this.scene) return true;
    try { return (game.settings.get(MODULE_ID, SEEN_SETTING) || {})[this.scene.id] === true; }
    catch (e) { return true; }
  }

  async markSeen() {
    if (!this.scene || this.isSeen()) return;
    try {
      const map = foundry.utils.duplicate(game.settings.get(MODULE_ID, SEEN_SETTING) || {});
      map[this.scene.id] = true;
      await game.settings.set(MODULE_ID, SEEN_SETTING, map);
    } catch (e) { console.error("beneos | creature-installer markSeen failed", e); }
  }

  attachToActiveScene({ force = false } = {}) {
    const scene = canvas?.scene;
    const data = scene?.getFlag?.(FLAG_SCOPE, FLAG_KEY);
    const hasContent = data && ((data.srdCreatures?.length ?? 0) > 0 || (data.beneosCreatures?.length ?? 0) > 0);
    // Alternate-creature tokens only belong on battlemaps. Beneos scenes carry a
    // "BM: " name prefix for battlemaps and "SC: " for sceneries; sceneries (and
    // overview/tour scenes) never need creature tokens, so the drawer stays
    // hidden there. Prefix-tolerant of the space after the colon seen in real
    // world data (e.g. "BM: 1F"). Two escape hatches keep flag/content/GM
    // required: the tutorial tour forces the drawer onto its "Page 2: Battlemaps"
    // demo page via force:true; and a scene may opt in permanently by setting
    // `alwaysShow: true` on its creatureInstaller flag (e.g. a non-"BM:" demo
    // scene that should carry the drawer outside the tour too).
    const isBattlemap = force || data?.alwaysShow === true || /^BM\s*:/i.test(String(scene?.name || ""));
    if (!game.user?.isGM || !scene || !hasContent || !isBattlemap) {
      this.destroy();
      return;
    }
    // Only force the collapsed bookmark when arriving on a DIFFERENT scene. A
    // flag update on the current scene (e.g. removing a creature) keeps the
    // drawer's open/closed state instead of snapping it shut.
    const sameScene = this.scene?.id === scene.id;
    this.scene = scene;
    this.data = data;
    if (!sameScene) this.expanded = false;
    this.render();
  }

  destroy() {
    if (this._docHover) { document.removeEventListener("mousemove", this._docHover); this._docHover = null; }
    if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
    this.host?.remove();
    this.host = null;
    this.scene = null;
    this.data = null;
    this.expanded = false;
  }

  /* ------------------------------------------------------------ account state */

  /** @returns {"patron"|"connected_nonpatron"|"not_connected"} */
  accountState() {
    try {
      if (game.beneos?.cloud?.hasCampaignAccess?.("tokens")) return "patron";
    } catch (e) { /* fall through */ }
    try {
      if (game.settings.get(MODULE_ID, "beneos-cloud-token-patron")) return "patron";
    } catch (e) { /* setting may be unregistered */ }
    try {
      const status = game.settings.get(MODULE_ID, "beneos-cloud-patreon-status");
      if (status && status !== "no_patreon") return "connected_nonpatron";
    } catch (e) { /* fall through */ }
    return "not_connected";
  }

  /* --------------------------------------------------- creature resolution */

  /** Find the world Actor for a flag entry via stable Beneos id, then name. */
  resolveActor(entry) {
    if (!entry) return null;
    // SRD/packed actors keep their _id on import (Scene-Packer keepId), so the
    // stored actorId is the most reliable handle and survives token-vs-actor name
    // drift (e.g. token "Barovian Commoner" vs actor "Barovian Commoner 06").
    if (entry.actorId) {
      const a = game.actors.get(entry.actorId);
      if (a) return a;
    }
    if (entry.fullId) {
      const a = game.actors.find(x => x.flags?.world?.beneos?.fullId === entry.fullId);
      if (a) return a;
    }
    if (entry.tokenKey) {
      const a = game.actors.find(x => x.flags?.world?.beneos?.tokenKey === entry.tokenKey);
      if (a) return a;
    }
    if (entry.name) {
      const a = game.actors.getName(entry.name);
      if (a) return a;
    }
    return null;
  }

  /* ----------------------------------------------------------- render context */

  /**
   * Why this creature cannot be installed for THIS user, or null when it can be.
   * Only ever set for a patron: for everyone else the whole Beneos column already
   * sits behind the support gate, and badging every disc on top of that is noise.
   *
   * Before this existed the drawer offered a "+" on every missing Beneos creature
   * as soon as the user held any token-campaign access. Monthly rewards are not
   * covered by that - they belong to the patrons who were subscribed in that
   * month. The server refused them correctly, but the user only saw a generic
   * "Error importing token" and, because the import does not throw on a refusal,
   * a success message right next to it (Discord report 2026-08-24,
   * 000-month_1_bone_hag on the Shadow Realm Mountains maps).
   */
  #blockInfo(entry, { premium, isPatron, installed }) {
    if (!premium || !isPatron || installed || !entry?.tokenKey) return null;
    const state = game.beneos?.cloud?.getTokenAccessState?.(entry.tokenKey) ?? "ok";
    if (state === "ok") return null;
    // not_patron should not reach this branch (isPatron is true), but a stale
    // campaign flag could still produce it; keep sane wording for that case.
    const suffix = state === "loyalty" ? "Loyalty" : state === "not_patron" ? "NotPatron" : "Unavailable";
    return {
      state,
      label: game.i18n.localize(`BENEOS.CreatureInstaller.Blocked.${suffix}.Short`),
      tooltip: game.i18n.localize(`BENEOS.CreatureInstaller.Blocked.${suffix}.Body`)
    };
  }

  decorate(entry, { premium, isPatron, assignedKeys }) {
    const actor = this.resolveActor(entry);
    const installed = !!actor;
    // Entitlement per creature, not per account (see #blockInfo).
    const block = this.#blockInfo(entry, { premium, isPatron, installed });
    // A Beneos creature is an "alternative" purely by DERIVATION, never by a stale
    // stored flag: it is alternative iff it was neither placed on the map (no
    // positions) nor assigned 1:1 to an SRD (not a replacedBy target). Anything
    // placed or assigned is a regular creature and must never show the ALT tag.
    const positions = positionsOf(entry);
    const hasPositions = positions.length > 0;
    const isAssigned = !!(premium && assignedKeys && assignedKeys.has(entryKey(entry)));
    const alternative = premium && !hasPositions && !isAssigned;
    // Disposition to the players: captured per placement, else the actor's
    // prototype. Drives the disc ring colour (hostile/neutral/friendly/secret) so
    // the GM sees what is actually hostile at a glance. Alternatives keep their
    // blue ring (a suggestion, not a placed combatant), so no disposition ring.
    const dispRaw = positions.find(p => typeof p.disposition === "number")?.disposition;
    const disposition = (typeof dispRaw === "number") ? dispRaw
      : (typeof actor?.prototypeToken?.disposition === "number" ? actor.prototypeToken.disposition : null);
    const dispClass = alternative ? null
      : disposition === -1 ? "hostile"
      : disposition === 1 ? "friendly"
      : disposition === -2 ? "secret"
      : disposition === 0 ? "neutral" : null;
    // SRD discs use local token art; premium guests/uninstalled use the CDN
    // thumbnail; an installed premium token can use its real local art.
    let img = null;
    if (premium) {
      const installedArt = installed ? (actor.prototypeToken?.texture?.src || actor.img) : null;
      const embedded = entry.thumbnailData || null;   // offline-safe base64 preview
      const cdn = entry.thumbnail ? TOKEN_THUMB_BASE + entry.thumbnail : null;
      img = (isPatron && installedArt) || embedded || cdn || installedArt || null;
    } else {
      img = entry.art || (actor?.prototypeToken?.texture?.src) || actor?.img || null;
    }
    // Animated token art (.webm/.mp4/...) cannot display in an <img> (the disc
    // renders empty, e.g. the Creeping Hut or the Lake Zarovich rowboat). Flag it
    // so the template renders a muted looping <video> representor instead. The
    // asset ships locally with the battlemap, so this stays offline-safe.
    const isVideo = /\.(webm|mp4|m4v|ogv)(\?.*)?$/i.test(img || "");
    return {
      ...entry,
      img,
      isVideo,
      shape: entry.shape || (premium ? "square" : "round"),
      installed,
      available: installed,                 // locally resolvable -> visible + draggable
      uuid: actor?.uuid || null,
      // Anything present in the world can be dragged onto the canvas (native
      // Actor-drop). Premium that is not installed yet stays non-draggable and
      // is handled by the install-on-place button instead.
      draggable: installed,
      // Patron, premium, not yet installed -> "+" install affordance. Needs the
      // same tokenKey test as needsInstall below: a not-yet-published source
      // creature has no key, so nothing could install it and the "+" would lie.
      // `!block` for the same reason: a reward this user has no grant for cannot
      // be installed either, so offering the affordance would be a false promise.
      showInstallBadge: premium && isPatron && !installed && !alternative && !!entry.tokenKey && !block,
      // Any accessible premium not yet in the world (incl. alternatives) can be
      // cloud-installed from the drawer -> grayscale + part of "Install Beneos".
      needsInstall: premium && isPatron && !installed && !!entry.tokenKey && !block,
      // Out of reach for this user: shown, named, but not installable.
      blocked: !!block,
      blockLabel: block?.label || null,
      blockTooltip: block?.tooltip || null,
      // Alternatives: optional swap suggestions, never auto-placed. Derived above.
      alternative,
      // Players disposition -> disc ring colour class (null = no disposition ring).
      dispClass,
      // Assignment link viz: own key + (for SRD) the assigned Beneos' key/name.
      key: entryKey(entry),
      linkedKey: entry.replacedBy ? entryKey(entry.replacedBy) : null,
      linkedName: entry.replacedBy?.name || null
    };
  }

  async buildContext() {
    const hidden = this.isHidden();
    // No data (e.g. a forced render on a scene whose flag was cleared, or a race
    // where render() runs after destroy()) -> fall back to the collapsed logo
    // instead of dereferencing a null `data`. Mirrors the null-safe reads in
    // attachToActiveScene(); never hard-crash the drawer.
    if (!this.data) return { logo: true };
    // Hidden + collapsed -> show only the restore logo. Hidden + expanded means
    // the GM peeked it open via the logo; render the full drawer (hide checkbox
    // stays checked) without clearing the per-scene hide choice.
    if (hidden && !this.expanded) return { logo: true };

    const state = this.accountState();
    const isPatron = state === "patron";
    // Keys of Beneos creatures that are assigned 1:1 to an SRD (replacedBy targets);
    // these are regular creatures, never alternatives.
    const assignedKeys = new Set();
    for (const s of (this.data.srdCreatures || [])) if (s.replacedBy) assignedKeys.add(entryKey(s.replacedBy));
    const srd = dedupeByCreature(this.data.srdCreatures).map(e => this.decorate(e, { premium: false, isPatron, assignedKeys }));
    const beneos = dedupeByCreature(this.data.beneosCreatures).map(e => this.decorate(e, { premium: true, isPatron, assignedKeys }));
    // "Missing" means missing AND obtainable. A reward this user has no grant for
    // is not missing, it is simply not theirs, and counting it would promise a
    // number the install button can never work off.
    const missingCount = isPatron ? beneos.filter(c => !c.installed && !c.blocked).length : 0;
    const blockedCount = beneos.filter(c => c.blocked).length;
    // One line per distinct reason under the Beneos row. A tooltip alone hides the
    // explanation behind a hover; the whole point of this is that the GM can read
    // why without touching anything. In practice this is a single line.
    const blockNotes = [...new Set(beneos.filter(c => c.blocked).map(c => c.blockTooltip).filter(Boolean))];
    // Gold-button state machine: not connected -> support; patron with any
    // accessible-but-not-installed Beneos -> install (cloud); all installed and
    // something to auto-place -> place; all installed but only alternatives (no
    // auto-placeable) -> place disabled (drag-only).
    const beneosMissing = beneos.filter(c => c.needsInstall).length;
    const srdPlaceable = srd.some(c => positionsOf(c).length);
    const beneosOwnPlaceable = beneos.some(c => !c.alternative && positionsOf(c).length);
    const beneosPlaceable = srdPlaceable || beneosOwnPlaceable;
    let beneosBtn = "support";
    if (isPatron) beneosBtn = beneosMissing > 0 ? "install" : (beneosPlaceable ? "place" : "place-empty");
    return {
      logo: false,
      hidden,
      state,
      pulse: !this.isSeen(),   // one-time attract glow on the collapsed tab
      isPatron,
      isConnected: state !== "not_connected",
      expanded: this.expanded,
      sceneName: this.data.sceneName || this.scene?.name || "",
      srd,
      beneos,
      srdCount: srd.length,
      beneosCount: beneos.length,
      totalCount: srd.length + beneos.length,
      hasSrd: srd.length > 0,
      hasBeneos: beneos.length > 0,
      missingCount,
      blockedCount,
      hasBlocked: blockedCount > 0,
      blockNotes,
      beneosMissing,
      beneosBtn,
      btnInstall: beneosBtn === "install",
      btnPlace: beneosBtn === "place",
      btnPlaceEmpty: beneosBtn === "place-empty",
      hasGuide: !!this.data.guideRef
    };
  }

  async render() {
    try {
      const ctx = await this.buildContext();
      const html = await renderTemplateCompat(TEMPLATE, ctx);
      if (!this.host) {
        this.host = document.createElement("div");
        this.host.id = "beneos-creature-installer";
        document.body.appendChild(this.host);
      }
      this.host.innerHTML = html;
      this.host.classList.toggle("bci-expanded", this.expanded && !ctx.logo);
      this.host.classList.toggle("bci-hidden", !!ctx.logo);
      this.activateListeners();
      if (ctx.logo) this.#positionRestore();
      this._renderRetry = false;   // a clean render clears the retry guard
    } catch (e) {
      // A transient render error (bad flag entry, template hiccup) must NEVER
      // silently kill the drawer: keep the existing host in its last good state
      // and retry once on the next tick. The drawer stays "always active" as long
      // as the scene carries a creatureInstaller flag.
      console.error("beneos | creature-installer: render failed (drawer kept in last good state)", e);
      if (!this._renderRetry) {
        this._renderRetry = true;
        setTimeout(() => { this.render().catch(() => {}); }, 250);
      }
    }
  }

  /** Anchor the restore logo just left of the macro hotbar. */
  #positionRestore() {
    const btn = this.host?.querySelector(".bci-restore");
    if (!btn) return;
    const hb = document.getElementById("hotbar") || document.getElementById("ui-bottom");
    if (!hb) return; // CSS default keeps it bottom-centre-left
    const r = hb.getBoundingClientRect();
    if (!r.width) return;
    btn.style.left = `${Math.max(8, Math.round(r.left - 52))}px`;
    btn.style.bottom = `${Math.max(8, Math.round(window.innerHeight - r.bottom))}px`;
  }

  /* --------------------------------------------------------------- listeners */

  activateListeners() {
    const root = this.host;
    if (!root) return;

    // Click actions (buttons, links, the restore logo).
    root.querySelectorAll("[data-action]").forEach(el => {
      if (el.tagName === "INPUT") return; // checkboxes handled below via change
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        const action = el.dataset.action;
        const handler = this[`_on_${action}`];
        if (typeof handler === "function") handler.call(this, ev, el);
      });
    });

    // Checkbox actions (the per-scene hide toggle).
    root.querySelectorAll("input[type=checkbox][data-action]").forEach(el => {
      el.addEventListener("change", (ev) => {
        const handler = this[`_on_${el.dataset.action}`];
        if (typeof handler === "function") handler.call(this, ev, el);
      });
    });

    // Native Foundry actor-drop: dragging a disc onto the canvas creates a token.
    // The inner <img> is made non-draggable (template + CSS pointer-events:none)
    // so the drag source is the disc div, carrying our Actor data - otherwise the
    // browser drags the image file instead and Foundry never sees the actor.
    root.querySelectorAll(".bci-disc[draggable=true]").forEach(disc => {
      disc.addEventListener("dragstart", (ev) => {
        const uuid = disc.dataset.uuid;
        if (!uuid) { ev.preventDefault(); return; }
        this._dragging = true;
        this.#clearCloseTimer();
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid }));
        ev.dataTransfer.effectAllowed = "copy";
        try { ev.dataTransfer.setDragImage(disc, 26, 26); } catch (e) { /* best effort */ }
      });
      disc.addEventListener("dragend", () => {
        this._dragging = false;
        // The pointer ends up on the canvas after the drop; close shortly after.
        if (this.expanded) this._closeTimer = setTimeout(() => { this._closeTimer = null; this.#collapse(); }, HOVER_CLOSE_DELAY);
      });
      // Single click opens the creature's actor sheet. A click does NOT fire
      // after a drag, so holding-and-dragging still drops onto the canvas.
      disc.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const uuid = disc.dataset.uuid;
        if (!uuid) return;
        try { (await fromUuid(uuid))?.sheet?.render(true); }
        catch (e) { console.warn("beneos | creature-installer: open sheet failed", uuid, e); }
      });
    });

    // Assignment link viz: hovering a creature highlights its counterpart and
    // shows a short "<Beneos> replaces <SRD>" message.
    this.#activateLinkHover(root);

    // Hover-open from the collapsed bookmark tab.
    const tab = root.querySelector(".bci-tab");
    if (tab) tab.addEventListener("mouseenter", () => this.#open());

    // Hover-close while expanded is tracked at document level so that moving the
    // pointer anywhere outside the drawer (macro hotbar, canvas, ...) closes it -
    // not only when the pointer happens to leave the panel element itself.
    this.#syncDocHover();
  }

  /** Wire the SRD<->Beneos assignment highlight + message on hover. */
  #activateLinkHover(root) {
    const msgEl = root.querySelector(".bci-link-msg");
    const setMsg = (txt) => {
      if (!msgEl) return;
      msgEl.textContent = txt || "";
      msgEl.classList.toggle("bci-link-msg-on", !!txt);
    };
    const clear = () => {
      root.querySelectorAll(".bci-linked-hl, .bci-linked-src").forEach(e => e.classList.remove("bci-linked-hl", "bci-linked-src"));
      root.classList.remove("bci-focus-link");
      setMsg("");
    };
    const discByKey = (key) => key ? root.querySelector(`.bci-disc[data-key="${CSS.escape(key)}"]`) : null;
    const srdByLink = (key) => key ? root.querySelector(`.bci-disc[data-linked="${CSS.escape(key)}"]`) : null;
    const message = (beneosName, srdName) =>
      game.i18n.format("BENEOS.CreatureInstaller.Replaces", { beneos: beneosName || "?", srd: srdName || "?" });
    // Highlight the pair, mark the hovered one as source, and focus-dim the rest.
    const focus = (srcEl, targetEl, beneosName, srdName) => {
      if (!targetEl) return;
      srcEl.classList.add("bci-linked-src");
      targetEl.classList.add("bci-linked-hl");
      root.classList.add("bci-focus-link");
      setMsg(message(beneosName, srdName));
    };

    root.querySelectorAll(".bci-disc[data-linked]").forEach(srd => {
      srd.addEventListener("mouseenter", () => focus(srd, discByKey(srd.dataset.linked), discByKey(srd.dataset.linked)?.dataset.name, srd.dataset.name));
      srd.addEventListener("mouseleave", clear);
    });
    root.querySelectorAll(".bci-col-beneos .bci-disc[data-key]").forEach(b => {
      b.addEventListener("mouseenter", () => focus(b, srdByLink(b.dataset.key), b.dataset.name, srdByLink(b.dataset.key)?.dataset.name));
      b.addEventListener("mouseleave", clear);
    });
  }

  #clearCloseTimer() {
    if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
  }

  /** Attach/detach the document-level hover-close watcher to match expanded.
   *  Close only when the pointer leaves the drawer's horizontal band (left/right).
   *  Everything below the drawer down to the screen edge - and above it up to the
   *  top - within that column keeps it open, so hovering the macro hotbar or the
   *  gold button (which sits inside the band) never closes it. The watcher only
   *  ARMS once the pointer has entered the band, so opening from a spot outside it
   *  (e.g. the bottom-left restore logo) does not immediately re-close it. */
  #syncDocHover() {
    if (this.expanded && !this._docHover) {
      this._docHover = (ev) => {
        if (this._dragging) { this.#clearCloseTimer(); return; }
        const panel = this.host?.querySelector(".bci-panel");
        if (!panel) return;
        const r = panel.getBoundingClientRect();
        // Inside = within the panel's horizontal band AND not above its top edge
        // (minus a small margin). Anything below the panel down to the screen edge
        // stays open (macro hotbar); leaving left, right or up closes it.
        const inSafe = ev.clientX >= r.left - HOVER_MARGIN
                    && ev.clientX <= r.right + HOVER_MARGIN
                    && ev.clientY >= r.top - HOVER_MARGIN;
        if (inSafe) { this._closeArmed = true; this.#clearCloseTimer(); }
        else if (this._closeArmed && !this._closeTimer) {
          this._closeTimer = setTimeout(() => { this._closeTimer = null; this.#collapse(); }, HOVER_CLOSE_DELAY);
        }
      };
      document.addEventListener("mousemove", this._docHover);
    } else if (!this.expanded && this._docHover) {
      document.removeEventListener("mousemove", this._docHover);
      this._docHover = null;
      this.#clearCloseTimer();
    }
  }

  #open() {
    if (this.expanded) return;
    this._closeArmed = false; // require the pointer to enter the band before closing
    this.markSeen();          // first open kills the attract pulse for good
    this.expanded = true;
    this.render();
  }

  #collapse() {
    if (!this.expanded) return;
    this.expanded = false;
    this.render();
  }

  /** Show a spinner on a button while an async action runs. */
  async #withBusy(el, fn) {
    if (el) { el.classList.add("bci-busy"); el.setAttribute("disabled", ""); }
    try { return await fn(); }
    finally { if (el) { el.classList.remove("bci-busy"); el.removeAttribute("disabled"); } }
  }

  /* ------------------------------------------------------------------ actions */

  _on_toggle() {
    // Tab click (touch / accessibility). Hover-intent normally opens it already.
    this.#open();
  }

  _on_close() {
    this.#clearCloseTimer();
    this.expanded = false;
    this.render();
  }

  async _on_hide(ev, el) {
    const checked = el ? !!el.checked : true;
    await this.setHidden(checked);
    // Checking hides -> collapse to the logo. Unchecking keeps the drawer open.
    if (checked) this.expanded = false;
    this.render();
  }

  // Clicking the restore logo only PEEKS the drawer open; the per-scene hide
  // choice stays active, so collapsing returns to the logo (not the tab). #open
  // resets the close-arm so the panel (centred) does not snap shut just because
  // the logo (bottom-left) sits outside the panel's band.
  _on_restore() {
    this.#open();
  }

  async _on_placeSrd(ev, el) {
    if (!this.data?.srdCreatures?.length) return;
    await this.#withBusy(el, () => this.#placeEntries(this.data.srdCreatures, { allowInstall: false }));
  }

  async _on_placeBeneos(ev, el) {
    if (this.accountState() !== "patron") { this._on_support(); return; }
    this._compatRun = undefined;
    await this.#withBusy(el, () => this.#placeBestVersion());
  }

  /**
   * System-compatibility gate, asked once per user action instead of once per
   * creature. On dnd5e this returns true without a dialog; everywhere else the
   * cloud install would otherwise prompt for every single creature it fetches.
   * Reset at the start of each action that can install (place / install all).
   */
  async #compatOk() {
    if (this._compatRun === undefined) {
      this._compatRun = await BeneosUtility.confirmSystemCompat("token");
    }
    return this._compatRun;
  }

  /**
   * "Install Beneos Creatures" - cloud-install every accessible-but-not-installed
   * Beneos creature listed in the drawer (incl. alternatives, so they become
   * draggable). Each disc fills from grayscale to colour with a gold rim as its
   * token finishes; the button shows progress, then glows and relabels to "Place".
   */
  async _on_installAll(ev, el) {
    if (this.accountState() !== "patron") { this._on_support(); return; }
    const root = this.host;
    if (!root) return;
    this._compatRun = undefined;

    // Unique accessible-but-not-installed Beneos tokenKeys (one creature may appear once).
    const seen = new Set();
    const queue = [];
    root.querySelectorAll(".bci-disc-beneos.bci-needsinstall[data-tokenkey]").forEach(d => {
      const tokenKey = d.dataset.tokenkey;
      if (!tokenKey || seen.has(tokenKey)) return;
      seen.add(tokenKey);
      queue.push(tokenKey);
    });
    const total = queue.length;
    if (!total) { this.render(); return; }

    // Gate ONCE for the whole run, before any UI state changes - mirrors the
    // canvas-drop path in beneos_cloud.js. Without this each importTokenFromCloud
    // prompts for system compatibility on its own, so a scene with nine creatures
    // asked the same question nine times.
    if (!await this.#compatOk()) return;

    const setProgress = (done) => {
      const span = el?.querySelector("span");
      if (span) span.textContent = game.i18n.format("BENEOS.CreatureInstaller.Installing", { done, total });
      el?.style.setProperty("--bci-progress", `${Math.round((done / total) * 100)}%`);
    };
    el?.classList.add("bci-installing-btn");
    el?.setAttribute("disabled", "");
    setProgress(0);

    // EINE Vorgangskennung fuer den ganzen Lauf. Ein Drawer holt dutzende
    // Kreaturen auf einen Klick; ohne gemeinsame Kennung stuenden sie in der
    // Auswertung als dutzende einzelne Griffe, und genau die Verwechslung soll
    // die Messung verhindern.
    const vorgang = game.beneos?.cloud?.neuerErwerbsvorgang?.() ?? "";

    let done = 0, failed = 0, installed = 0;
    for (const tokenKey of queue) {
      const discs = [...root.querySelectorAll(`.bci-disc-beneos[data-tokenkey="${CSS.escape(tokenKey)}"]`)];
      discs.forEach(d => d.classList.add("bci-installing"));   // gold pulsing rim while loading
      let ok = false;
      try {
        await game.beneos?.cloud?.importTokenFromCloud?.(tokenKey, undefined, false,
          { gated: true, surface: "drawer", interaction: vorgang });
        // A refused import does NOT throw: importTokenFromCloud handles a server
        // rejection inline (notification + cleanup) and resolves normally. The
        // catch below therefore never fires for the most common failure of all,
        // which is why this loop used to report "Installed N" right next to a red
        // error. Ask the world instead of trusting the call to have worked.
        ok = !!this.resolveActor({ tokenKey });
      } catch (e) {
        console.error("beneos | creature-installer: install failed", tokenKey, e);
      }
      if (ok) {
        installed++;
        // grayscale 0% -> colour 100% + green check on completion
        discs.forEach(d => { d.classList.remove("bci-needsinstall", "bci-installing"); d.classList.add("bci-installed-fx", "bci-available"); });
      } else {
        failed++;
        discs.forEach(d => d.classList.remove("bci-installing"));
      }
      done++;
      setProgress(done);
    }

    el?.classList.remove("bci-installing-btn");
    el?.classList.add("bci-glow");   // brief triumphant glow
    if (failed) ui.notifications?.warn(game.i18n.format("BENEOS.CreatureInstaller.PlacedWithMissing", { n: failed }));
    if (installed) ui.notifications?.info(game.i18n.format("BENEOS.CreatureInstaller.InstallDone", { n: installed }));
    // Re-render after the glow so the button recomputes to "Place ..." (or place-empty).
    setTimeout(() => this.render(), 950);
  }

  _on_login() { this.#openCloud(); }
  _on_support() { this.#openCloud(); }

  async _on_guide() {
    const ref = this.data?.guideRef;
    if (!ref) return;
    try {
      const doc = await fromUuid(ref);
      doc?.sheet?.render(true);
    } catch (e) {
      ui.notifications?.warn(game.i18n.localize("BENEOS.CreatureInstaller.GuideMissing"));
    }
  }

  /* -------------------------------------------------------------- placement */

  /** Resolve a creature reference; for patrons, install a missing Beneos by key. */
  async #resolveOrInstall(ref, { allowInstall }) {
    let actor = this.resolveActor(ref);
    if (!actor && allowInstall && ref?.tokenKey) actor = await this.#installToken(ref.tokenKey);
    return actor;
  }

  /**
   * Build a TokenDocument object for `actor` at the given stored placement.
   *  - `full` (default): the placement IS this actor's own token, so restore the
   *    entire authored setup (name/displayName, appearance, vision, light, bars,
   *    flags, delta, disposition, ...). The stored `_id`/`actorId` are dropped so
   *    getTokenDocument assigns a fresh token id and points actorId at the
   *    resolved world actor (SRD: same id via keepId import; Beneos: new id).
   *  - `!full`: the placement belongs to a DIFFERENT actor (an assigned Beneos
   *    taking an SRD's slot). Keep only the placement subset so the Beneos keeps
   *    its own appearance/vision but inherits position, disposition and IDENTITY
   *    (name + nameplate visibility). Identity travels because an adventure
   *    addresses the NPC by the name on the map, not by the statblock behind it:
   *    the module's "Harald" must stay "Harald" after a generic SRD thief is
   *    upgraded to a Beneos creature, or every reference in that module breaks.
   *    Only the token document is written; the world actor and its prototype
   *    keep the Beneos name, which is also what the drawer keeps showing.
   * Entries captured before the full-token migration only carry the subset
   * fields; `inheritName` is the fallback for those, taken from the drawer entry.
   *
   * `premium` drops the stored texture block. A Beneos placement was authored
   * against the author's own copy under beneos_assets/beneos_tokens/, but the
   * cloud install writes the creature to beneos_assets/cloud/tokens/ - and map
   * packages must not ship the premium art that would make the authored path
   * resolve. Falling back to the actor's prototype gives the customer the file
   * that is actually on their disk, plus the scale/anchor of the rendering mode
   * they chose (2.5D or top-down). Everything else the author set up - size,
   * name, vision, light, bars, disposition - still comes from the placement.
   */
  async #buildToken(actor, pos, { full = true, premium = false, inheritName = null } = {}) {
    let data;
    if (full) {
      data = foundry.utils.deepClone(pos);
      delete data._id;
      delete data.actorId;
      if (premium) delete data.texture;
    } else {
      data = {
        x: pos.x, y: pos.y,
        elevation: pos.elevation ?? 0,
        rotation: pos.rotation ?? 0,
        hidden: !!pos.hidden
      };
      if (typeof pos.disposition === "number") data.disposition = pos.disposition;
      // Identity of the slot, not of the creature (see the doc block above).
      // displayName travels with it, otherwise the inherited name could sit on a
      // token whose Beneos prototype never shows a nameplate.
      const name = pos.name || inheritName;
      if (name) {
        data.name = name;
        if (typeof pos.displayName === "number") data.displayName = pos.displayName;
        // Records that WE renamed this token, not the GM. The cloud update
        // cascade skips renamed tokens to protect the GM's own naming; without
        // this marker an assigned Beneos would silently drop out of every later
        // image and statblock refresh (see _propagateTokenUpdateToWorld).
        data.flags = { ...(data.flags || {}), [MODULE_ID]: { replacedName: name } };
      }
    }
    const td = await actor.getTokenDocument(data);
    return td.toObject();
  }

  /**
   * "Place Beneos Creatures on Map" - the best version of every slot:
   *  - each SRD slot: its assigned Beneos at the SRD's position, else the SRD itself;
   *  - any standalone Beneos (not used as a replacement) at its own position.
   *  No duplicates. Assigned Beneos keep their own size and art; x/y/elev/rot,
   *  disposition and the name come from the SRD slot they replace.
   */
  async #placeBestVersion() {
    const scene = this.scene;
    if (!scene) return;
    const allowInstall = this.accountState() === "patron";
    const tokenDocs = [];
    const placedBeneos = new Set();
    let missing = 0;

    const placeAll = async (actor, positions, opts) => {
      for (const pos of positions) {
        try { tokenDocs.push(await this.#buildToken(actor, pos, opts)); }
        catch (e) { console.error("beneos | creature-installer: token build failed", pos, e); missing++; }
      }
    };

    for (const srd of dedupeByCreature(this.data.srdCreatures)) {
      const positions = positionsOf(srd);
      if (!positions.length) continue;
      let beneosActor = null;
      if (srd.replacedBy) beneosActor = await this.#resolveOrInstall(srd.replacedBy, { allowInstall });
      if (beneosActor) {
        placedBeneos.add(entryKey(srd.replacedBy));
        // Assigned Beneos at the SRD slot: keep the Beneos's own appearance, only
        // take position, disposition and identity from the SRD placement (subset).
        // srd.name is the fallback for pre-full-token entries, which store no name.
        await placeAll(beneosActor, positions, { full: false, inheritName: srd.name });
        continue;
      }
      const srdActor = this.resolveActor(srd);
      if (!srdActor) { missing += positions.length; continue; }
      // Free SRD at its own placement -> full restore, texture included: its art
      // ships with the map package, so the authored path resolves.
      await placeAll(srdActor, positions, { full: true });
    }

    // Standalone Beneos creatures at their own position(s). Alternatives have no
    // positions (so they are skipped here); assigned ones were placed above and
    // are tracked in placedBeneos. No reliance on the stored `alternative` flag.
    for (const b of dedupeByCreature(this.data.beneosCreatures)) {
      if (placedBeneos.has(entryKey(b))) continue;
      const positions = positionsOf(b);
      if (!positions.length) continue;
      const actor = await this.#resolveOrInstall(b, { allowInstall });
      if (!actor) { missing++; continue; }
      // Standalone Beneos at its own placement -> full restore, but the texture
      // comes from the installed actor (see #buildToken).
      await placeAll(actor, positions, { full: true, premium: true });
    }

    if (tokenDocs.length) await scene.createEmbeddedDocuments("Token", tokenDocs);
    if (missing > 0) ui.notifications?.warn(game.i18n.format("BENEOS.CreatureInstaller.PlacedWithMissing", { n: missing }));
    else if (tokenDocs.length) ui.notifications?.info(game.i18n.format("BENEOS.CreatureInstaller.Placed", { n: tokenDocs.length }));
  }

  async #placeEntries(entries, { allowInstall, premium = false }) {
    const scene = this.scene;
    if (!scene) return;
    const tokenDocs = [];
    let missing = 0;
    for (const entry of dedupeByCreature(entries)) {
      let actor = this.resolveActor(entry);
      if (!actor && allowInstall && entry.tokenKey) {
        actor = await this.#installToken(entry.tokenKey);
      }
      const positions = positionsOf(entry);
      if (!actor) { missing += positions.length || 1; continue; }
      for (const pos of positions) {
        try { tokenDocs.push(await this.#buildToken(actor, pos, { full: true, premium })); }
        catch (e) { console.error("beneos | creature-installer: token build failed", entry, e); missing++; }
      }
    }
    if (tokenDocs.length) {
      await scene.createEmbeddedDocuments("Token", tokenDocs);
    }
    if (missing > 0) {
      ui.notifications?.warn(game.i18n.format("BENEOS.CreatureInstaller.PlacedWithMissing", { n: missing }));
    } else if (tokenDocs.length) {
      ui.notifications?.info(game.i18n.format("BENEOS.CreatureInstaller.Placed", { n: tokenDocs.length }));
    }
  }

  /** Install a Beneos token by key via the cloud importer, then resolve it.
   *  Gated through #compatOk so a placement that has to fetch several creatures
   *  asks once, not once per creature.
   *
   *  `vorgang` reicht die Kennung des laufenden Setzvorgangs durch, damit eine
   *  Platzierung, die mehrere Kreaturen nachladen muss, EIN Vorgang bleibt.
   *  Ohne Kennung erzeugt der Server eine eigene, was hier richtig ist: dann war
   *  es tatsaechlich ein einzelner Griff. */
  async #installToken(tokenKey, vorgang = "") {
    if (!await this.#compatOk()) return null;
    try {
      await game.beneos?.cloud?.importTokenFromCloud?.(tokenKey, undefined, false,
        { gated: true, surface: "drawer", interaction: vorgang });
    } catch (e) {
      console.error("beneos | creature-installer: install failed", tokenKey, e);
    }
    return this.resolveActor({ tokenKey });
  }

  /* ----------------------------------------------------------------- cloud */

  #openCloud() {
    const w = game.beneos?.cloudWindowV2;
    if (w?.render) { w.render(true); return; }
    import("../cloud-v2/cloud-window-v2.mjs")
      .then(m => new m.BeneosCloudWindowV2().render({ force: true }))
      .catch(() => ui.notifications?.warn(game.i18n.localize("BENEOS.CreatureInstaller.OpenCloudHint")));
  }
}

Hooks.once("init", () => {
  try {
    game.settings.register(MODULE_ID, HIDDEN_SETTING, {
      scope: "client",
      config: false,
      type: Object,
      default: {}
    });
    game.settings.register(MODULE_ID, SEEN_SETTING, {
      scope: "client",
      config: false,
      type: Object,
      default: {}
    });
  } catch (e) { console.error("beneos | creature-installer setting register failed", e); }
});

// Bind the canvas/scene listeners as early as possible (before the first
// canvasReady) so the drawer never misses the initial scene draw.
Hooks.once("setup", () => {
  try { BeneosCreatureInstaller.registerHooks(); }
  catch (e) { console.error("beneos | creature-installer hook register failed", e); }
});

Hooks.once("ready", () => {
  try { BeneosCreatureInstaller.boot(); }
  catch (e) { console.error("beneos | creature-installer boot failed", e); }
});
