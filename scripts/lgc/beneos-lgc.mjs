import { ORIGIN_META, ORIGIN_ORDER } from "../codex2/origin-meta.mjs";
import { OriginsRegistry } from "../loot/origins-registry.mjs";
import {
  sliderToFeet, feetToSlider, formatDistance,
  degToSector, snapToCardinal, mouseToDeg,
  migratePing, CARDINAL_TO_DEG,
} from "./lgc-math.mjs";
import { dispatchPing, actorsSensingPing } from "./lgc-dispatcher.mjs";
import { emitPingSound } from "./lgc-socket.mjs";
import { createPingWhispers } from "./lgc-chatcard.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const TEMPLATE_ROOT = "modules/beneos-module/templates/lgc";
const SETTING_KEY = "beneos-lgc-active-pings";

const DIST_FT_DEFAULT = 15840;   // 3 miles, sensible middle ground
const DIR_DEG_DEFAULT = 45;      // NE
const COMMIT_DEBOUNCE_MS = 250;  // throttle world-setting writes

function _localize(key, data) {
  const txt = data ? game.i18n.format(key, data) : game.i18n.localize(key);
  return (txt && txt !== key) ? txt : key;
}

function _originDisplay(slug) {
  const meta = ORIGIN_META[slug] ?? {};
  const def = OriginsRegistry.get(slug);
  const i18nKey = `BENEOS.Codex.Origins.${slug}.Name`;
  const i18nName = game.i18n.localize(i18nKey);
  const name = (i18nName && i18nName !== i18nKey) ? i18nName : (def?.display_name ?? slug);
  // For CSS-mask icon tinting we want the BW/silhouette variant of the
  // origin icon (a flat alpha shape), not the full-colour artwork. The
  // colour version already encodes its own colour and won't tint
  // correctly via mask-image. Falls back to the colour image, then to
  // the registry-resolved bw path if available.
  const bwPath = OriginsRegistry.iconPath?.(slug, "bw");
  const iconPath = bwPath ?? meta.image ?? null;
  return {
    slug,
    mono: meta.mono ?? slug.slice(0, 2).toUpperCase(),
    name,
    color: meta.glow ?? "#d4a857",
    iconPath,
  };
}

function _timeAgo(ts) {
  const s = Math.floor((Date.now() - (ts ?? Date.now())) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export class BeneosLiveGameControl extends HandlebarsApplicationMixin(ApplicationV2) {

  static _instance = null;

  static DEFAULT_OPTIONS = {
    id: "beneos-lgc",
    classes: ["beneos-lgc", "lgc-window"],
    tag: "div",
    window: { frame: false, positioned: true, resizable: false },
    position: { width: 760, height: 620, left: null, top: null },
    actions: {
      "lgc-pop":     BeneosLiveGameControl._onPop,
      "lgc-min":     BeneosLiveGameControl._onMinimize,
      "lgc-close":   BeneosLiveGameControl._onClose,
      "lgc-tab":     BeneosLiveGameControl._onSwitchTab,
      "lgc-set-origin":   BeneosLiveGameControl._onSetOrigin,
      "lgc-direction-cardinal": BeneosLiveGameControl._onDirectionCardinal,
      "lgc-direction-click":    BeneosLiveGameControl._onDirectionClick,
      "lgc-ping-add":     BeneosLiveGameControl._onPingAdd,
      "lgc-ping-remove":  BeneosLiveGameControl._onPingRemove,
      "lgc-toggle-origin-dropdown": BeneosLiveGameControl._onToggleOriginDropdown,
      "lgc-toggle-composer": BeneosLiveGameControl._onToggleComposer,
      "lgc-open-actor-sheet": BeneosLiveGameControl._onOpenActorSheet,
    },
  };

  static PARTS = {
    main: { template: `${TEMPLATE_ROOT}/lgc-window.hbs`, scrollable: [".lgc-content"] },
  };

  _tab = "radar";
  _popped = false;
  _minimized = false;
  _composer = { originSlug: "vampiric", distanceFt: DIST_FT_DEFAULT, directionDeg: DIR_DEG_DEFAULT };
  _composerExpanded = false;
  _originDropdownOpen = false;
  // Live preview state for hover-derived direction-degree (does not
  // commit until click). Map<pingId|"composer", deg>.
  _dirPreview = new Map();
  // Debounce timers for slider commit -> world setting (Map<pingId|"composer", timeoutId>).
  _commitTimers = new Map();

  // ---- Data API ----------------------------------------------------------

  static _getPings() {
    try {
      const v = game.settings.get("beneos-module", SETTING_KEY);
      return Array.isArray(v) ? v : [];
    } catch (_) { return []; }
  }

  static async _setPings(pings) {
    if (!game.user?.isGM) return;
    await game.settings.set("beneos-module", SETTING_KEY, pings ?? []);
  }

  // ---- Lifecycle / static open -------------------------------------------

  static open() {
    if (!game.user?.isGM) {
      ui.notifications?.warn(_localize("BENEOS.LGC.NotGM"));
      return;
    }
    if (!this._instance || !this._instance.rendered) {
      this._instance = new this();
    } else {
      this._instance._minimized = false;
    }
    // Explicit user open == "bring me to front". Reset the one-shot
    // flag so the next _onRender re-claims the top z-index even if
    // some other window has been raised in the meantime.
    this._instance._zClaimed = false;
    this._instance.render({ force: true });
  }

  static async preloadTemplates() {
    const list = [
      `${TEMPLATE_ROOT}/lgc-window.hbs`,
      `${TEMPLATE_ROOT}/tab-radar.hbs`,
      `${TEMPLATE_ROOT}/tab-placeholder.hbs`,
      `${TEMPLATE_ROOT}/partials/lgc-origin-select.hbs`,
      `${TEMPLATE_ROOT}/partials/lgc-distance-slider.hbs`,
      `${TEMPLATE_ROOT}/partials/lgc-direction-picker.hbs`,
      `${TEMPLATE_ROOT}/partials/lgc-ping-card.hbs`,
    ];
    try {
      const map = Object.fromEntries(list.map(p => [p, p]));
      const loader = foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
      if (loader) await loader(map);
    } catch (e) {
      console.warn("Beneos | LGC template preload failed:", e);
    }
  }

  // ---- Context -----------------------------------------------------------

  async _prepareContext(_options) {
    const origins = ORIGIN_ORDER.map(_originDisplay);
    const composer = this._composer;
    const composerOrigin = origins.find(o => o.slug === composer.originSlug) ?? origins[0];

    const rawPings = BeneosLiveGameControl._getPings();
    const pings = rawPings.map(raw => {
      const p = migratePing(raw);
      const origin = _originDisplay(p.originSlug);
      const distLabel = formatDistance(p.distanceFt);
      const sector = degToSector(p.directionDeg);
      const degLabel = `${Math.round(p.directionDeg)}°`;
      return {
        ...p,
        origin,
        sliderValue: feetToSlider(p.distanceFt),
        distanceLabel: distLabel,
        directionLabel: `${degLabel} ${sector}`,
        directionDegLabel: degLabel,
        directionSector: sector,
        directionSectorCardinal: snapToCardinal(p.directionDeg),
        agoLabel: _timeAgo(p.createdAt),
        // GM-side: characters currently picking this ping up on their
        // Sense-Compass. Rendered as a clickable footer chip-list so
        // the GM can jump straight to the affected actor's sheet.
        sensingActors: actorsSensingPing(p),
      };
    });

    const tabs = [
      { id: "radar",    label: _localize("BENEOS.LGC.Tab.Radar"),    icon: "fa-solid fa-satellite-dish", active: this._tab === "radar",    count: pings.length },
      { id: "sound",    label: _localize("BENEOS.LGC.Tab.Sound"),    icon: "fa-solid fa-volume-high",    active: this._tab === "sound",    wip: true },
      { id: "rolls",    label: _localize("BENEOS.LGC.Tab.Rolls"),    icon: "fa-solid fa-dice",           active: this._tab === "rolls",    wip: true },
      { id: "handouts", label: _localize("BENEOS.LGC.Tab.Handouts"), icon: "fa-solid fa-scroll",         active: this._tab === "handouts", wip: true },
    ];

    return {
      tab: this._tab,
      popped: this._popped,
      minimized: this._minimized,
      tabs,
      origins,
      // Patreon gate: only active Creatures/Spells/Loot (tokens) patrons can
      // use the Item Radar composer; others see it blurred behind a join CTA.
      hasTokenAccess: !!game.beneos?.cloud?.hasCampaignAccess?.("tokens"),
      joinPatreonUrl: "https://www.patreon.com/c/BeneosTokens",
      composer: (() => {
        const previewDeg = this._dirPreview.get("composer");
        const liveDeg = (previewDeg != null) ? previewDeg : composer.directionDeg;
        return {
          ...composer,
          originDisplay: composerOrigin,
          dropdownOpen: this._originDropdownOpen,
          expanded: this._composerExpanded,
          sliderValue: feetToSlider(composer.distanceFt),
          distanceLabel: formatDistance(composer.distanceFt),
          directionDeg: composer.directionDeg,
          directionDegLabel: `${Math.round(liveDeg)}°`,
          directionSector: degToSector(liveDeg),
          directionSectorCardinal: snapToCardinal(liveDeg),
        };
      })(),
      pings,
      pingCount: pings.length,
      i18n: {
        title: _localize("BENEOS.LGC.WindowTitle"),
        sessionLive: _localize("BENEOS.LGC.SessionLive"),
        radarHeading: _localize("BENEOS.LGC.Radar.Heading"),
        radarSub: _localize("BENEOS.LGC.Radar.Sub"),
        countActive: _localize("BENEOS.LGC.Radar.CountActive", { n: pings.length }),
        composerHeading: _localize("BENEOS.LGC.Composer.Heading"),
        composerCollapsedLabel: _localize("BENEOS.LGC.Composer.CollapsedLabel"),
        composerHint: _localize("BENEOS.LGC.Composer.Hint"),
        composerOriginLabel: _localize("BENEOS.LGC.Composer.Origin"),
        composerDistanceLabel: _localize("BENEOS.LGC.Composer.Distance"),
        composerDirectionLabel: _localize("BENEOS.LGC.Composer.Direction"),
        composerOriginPlaceholder: _localize("BENEOS.LGC.Composer.OriginPlaceholder"),
        composerSend: _localize("BENEOS.LGC.Composer.Send"),
        composerHelpTooltip: _localize("BENEOS.LGC.Composer.HelpTooltip"),
        composerHelpAria:    _localize("BENEOS.LGC.Composer.HelpAria"),
        activeHeading: _localize("BENEOS.LGC.Active.Heading"),
        activeHint: pings.length ? _localize("BENEOS.LGC.Active.Hint") : _localize("BENEOS.LGC.Active.HintEmpty"),
        liveTag: _localize("BENEOS.LGC.Active.LiveTag"),
        sensingLabel: _localize("BENEOS.LGC.Active.SensingLabel"),
        editDistance: _localize("BENEOS.LGC.Active.EditDistance"),
        editDirection: _localize("BENEOS.LGC.Active.EditDirection"),
        endPing: _localize("BENEOS.LGC.Active.EndPing"),
        empty: _localize("BENEOS.LGC.Empty"),
        soonTag: _localize("BENEOS.LGC.Placeholder.SoonTag"),
        wipBadge: _localize("BENEOS.LGC.Tab.WIP"),
        placeholderSound: { title: _localize("BENEOS.LGC.Placeholder.SoundTitle"), body: _localize("BENEOS.LGC.Placeholder.SoundBody") },
        placeholderRolls: { title: _localize("BENEOS.LGC.Placeholder.RollsTitle"), body: _localize("BENEOS.LGC.Placeholder.RollsBody") },
        placeholderHandouts: { title: _localize("BENEOS.LGC.Placeholder.HandoutsTitle"), body: _localize("BENEOS.LGC.Placeholder.HandoutsBody") },
        distClose: _localize("BENEOS.LGC.Composer.DistanceClose"),
        distMid:   _localize("BENEOS.LGC.Composer.DistanceMid"),
        distFar:   _localize("BENEOS.LGC.Composer.DistanceFar"),
      },
    };
  }

  // ---- Render: wire drag + dropdown outside-click ------------------------

  _onRender(_context, _options) {
    this._applyWindowState();
    this._wireDrag();
    this._wireOutsideClickForDropdown();
    this._wireSliders();
    this._wireDirectionPreview();

    // First open → claim the top. Subsequent internal re-renders
    // (slider input, ping add, …) must not re-claim it, otherwise
    // LGC would steal focus from a window the user just clicked.
    if (!this._zClaimed) {
      this._claimTop();
      this._zClaimed = true;
    }

    const el = this.element;
    if (el && el.dataset.bttWired !== "1") {
      el.dataset.bttWired = "1";
      // Click inside LGC raises it via the same shared counter.
      el.addEventListener("mousedown", () => this._claimTop(), true);
    }

    // Global mousedown listener: V2 apps (including dnd5e Character
    // sheets) do NOT auto-bringToTop on click in V13. We emulate that
    // by bumping the shared _maxZ counter and applying it directly to
    // the clicked app's element. This way LGC and any other window
    // can be raised by clicking them, in either direction.
    if (!BeneosLiveGameControl._globalStackingWired) {
      BeneosLiveGameControl._globalStackingWired = true;
      document.addEventListener("mousedown", (ev) => {
        const appEl = ev.target?.closest?.(".application, .window-app");
        if (!appEl) return;
        if (appEl.id === "beneos-lgc") return;  // LGC handles itself
        const Z = foundry?.applications?.api?.ApplicationV2;
        if (!Z || typeof Z._maxZ !== "number") return;
        // Already on top? Skip to avoid pointless DOM mutations.
        const cur = parseInt(appEl.style.zIndex, 10);
        if (Number.isFinite(cur) && cur >= Z._maxZ) return;
        Z._maxZ = (Z._maxZ || 100) + 1;
        appEl.style.zIndex = String(Z._maxZ);
      }, true);
    }
  }

  /** Claim the top z-index via Foundry's shared V2 counter. Bumps
   *  ApplicationV2._maxZ so the next time any other V2-app calls its
   *  own bringToTop it goes above us, and vice versa. Falls back to a
   *  DOM scan if Foundry's counter is unavailable (older builds). */
  _claimTop() {
    if (!this.element) return;
    const Z = foundry?.applications?.api?.ApplicationV2;
    if (Z && typeof Z._maxZ === "number") {
      Z._maxZ = (Z._maxZ || 100) + 1;
      this.element.style.zIndex = String(Z._maxZ);
      return;
    }
    // Fallback: scan DOM for highest visible z-index.
    let maxZ = 100;
    document.querySelectorAll(".application, .window-app").forEach((el) => {
      if (el === this.element) return;
      const inline = parseInt(el.style.zIndex, 10);
      const computed = parseInt(getComputedStyle(el).zIndex, 10);
      const z = Number.isFinite(inline) ? inline : (Number.isFinite(computed) ? computed : 0);
      if (z > maxZ) maxZ = z;
    });
    this.element.style.zIndex = String(Math.min(maxZ + 1, 9998));
  }

  _wireDrag() {
    const handle = this.element?.querySelector?.(".lgc-titlebar");
    if (!handle) return;
    // The titlebar DOM is replaced on every render, so the guard must live
    // on the new element (not on the instance) to avoid double-binding.
    if (handle.dataset.dragWired === "1") return;
    handle.dataset.dragWired = "1";
    const THRESHOLD = 4;
    handle.addEventListener("mousedown", (ev) => {
      if (ev.target.closest("button, a, [data-action]")) return;
      ev.preventDefault();
      const startX = ev.clientX, startY = ev.clientY;
      const startLeft = this.position?.left ?? 0;
      const startTop  = this.position?.top  ?? 0;
      let dragging = false;
      const onMove = (e) => {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (!dragging && Math.abs(dx) + Math.abs(dy) > THRESHOLD) dragging = true;
        if (dragging) this.setPosition({ left: startLeft + dx, top: startTop + dy });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    handle.addEventListener("dblclick", (ev) => {
      if (ev.target.closest("button, a, [data-action]")) return;
      this._minimized = !this._minimized;
      this._applyWindowState();
    });
  }

  _wireOutsideClickForDropdown() {
    if (this._dropdownListener) return;
    this._dropdownListener = (ev) => {
      if (!this._originDropdownOpen) return;
      if (!this.element?.contains(ev.target)) return;
      const sel = ev.target.closest(".origin-select");
      if (!sel) {
        this._originDropdownOpen = false;
        this.render(false);
      }
    };
    document.addEventListener("mousedown", this._dropdownListener);
  }

  async close(options) {
    if (this._dropdownListener) {
      document.removeEventListener("mousedown", this._dropdownListener);
      this._dropdownListener = null;
    }
    return super.close(options);
  }

  _applyWindowState() {
    const el = this.element;
    if (!el) return;
    el.classList.toggle("popped",    this._popped);
    el.classList.toggle("minimized", this._minimized);
    if (this._popped) {
      this.setPosition({ left: 16, top: 16, width: window.innerWidth - 32, height: window.innerHeight - 32 });
    } else if (this._minimized) {
      this.setPosition({ width: 320, height: 44 });
    } else {
      const w = 760, h = 620;
      // Centre the window inside the Foundry canvas viewport (between
      // the left scene-controls toolbar and the right ui-right sidebar
      // cluster, not the wide #ui-left container which spans halfway
      // across the screen). Falls back to viewport-centre if neither
      // sidebar is measurable yet.
      const sceneCtrls = document.getElementById("scene-controls");
      const uiRight    = document.getElementById("ui-right");
      const leftX  = sceneCtrls
        ? (sceneCtrls.getBoundingClientRect().right + 12)
        : 24;
      const rightX = uiRight
        ? (uiRight.getBoundingClientRect().left - 12)
        : (window.innerWidth - 24);
      const canvasW = Math.max(0, rightX - leftX);
      const left = (this.position?.left == null)
        ? Math.max(24, Math.round(leftX + (canvasW - w) / 2))
        : this.position.left;
      const top  = (this.position?.top  == null)
        ? Math.max(24, Math.round((window.innerHeight - h) / 2))
        : this.position.top;
      this.setPosition({ left, top, width: w, height: h });
    }
  }

  // ---- Action handlers ---------------------------------------------------

  static _onPop(_ev, _target) {
    this._popped = !this._popped;
    this._applyWindowState();
  }
  static _onMinimize(_ev, _target) {
    this._minimized = !this._minimized;
    this._applyWindowState();
  }
  static async _onClose(_ev, _target) { await this.close(); }

  static _onSwitchTab(_ev, target) {
    const id = target.dataset.tab;
    if (!id) return;
    const t = target.classList?.contains?.("disabled");
    if (t) return;
    this._tab = id;
    this.render(false);
  }

  static _onToggleOriginDropdown(_ev, _target) {
    this._originDropdownOpen = !this._originDropdownOpen;
    this.render(false);
  }

  static _onToggleComposer(_ev, _target) {
    this._composerExpanded = !this._composerExpanded;
    if (!this._composerExpanded) this._originDropdownOpen = false;
    this.render(false);
  }

  static _onSetOrigin(_ev, target) {
    const slug = target.dataset.slug;
    if (!slug) return;
    this._composer.originSlug = slug;
    this._originDropdownOpen = false;
    this.render(false);
  }

  // -- Direction handlers -------------------------------------------

  // Cardinal quick-pick button: snap to the exact 8-way degree.
  static _onDirectionCardinal(_ev, target) {
    const card = target.dataset.cardinal;
    if (card == null) return;
    const deg = CARDINAL_TO_DEG[card];
    if (deg == null) return;
    const pingId = target.closest("[data-ping-id]")?.dataset?.pingId || null;
    this._writeDirection(pingId, deg);
  }

  // Click anywhere on the .dir-cross face commits the hovered angle.
  // Mouse-move (separate non-action handler wired in _onRender) keeps
  // the live preview state up to date so the readout follows the
  // pointer until commit.
  static _onDirectionClick(ev, target) {
    // Ignore clicks on the cardinal-buttons (they have their own action)
    if (ev.target?.closest?.(".dir-btn")) return;
    const deg = mouseToDeg(ev, target);
    const pingId = target.dataset.pingId || null;
    this._writeDirection(pingId, deg);
  }

  // Writes a new direction-degree either to the composer state or to
  // the addressed ping (and triggers a debounced setting write).
  _writeDirection(pingId, deg) {
    deg = ((deg % 360) + 360) % 360;
    if (!pingId || pingId === "composer") {
      this._composer.directionDeg = deg;
      this._dirPreview.delete("composer");
      this.render(false);
      return;
    }
    const pings = BeneosLiveGameControl._getPings();
    const idx = pings.findIndex(p => p.id === pingId);
    if (idx < 0) return;
    pings[idx] = { ...migratePing(pings[idx]), directionDeg: deg };
    this._dirPreview.delete(pingId);
    BeneosLiveGameControl._setPings(pings).then(() => this.render(false));
  }

  // -- Slider input (non-action handler, wired in _onRender) ---------

  _onSliderInput(ev) {
    const input = ev.target;
    const wrap  = input.closest(".dist-slider");
    const pingId = wrap?.dataset.pingId || null;
    const ft = sliderToFeet(input.value);

    // Live-update the readout without re-rendering the whole window,
    // so the slider stays responsive while dragging.
    const readout = wrap?.querySelector(".dist-readout");
    if (readout) readout.textContent = formatDistance(ft);

    // For the composer we just stash locally; for an existing ping we
    // commit on every change but debounced so we don't hammer the DB.
    if (!pingId || pingId === "composer") {
      this._composer.distanceFt = ft;
      return;
    }
    this._scheduleCommit(pingId, () => {
      const pings = BeneosLiveGameControl._getPings();
      const idx = pings.findIndex(p => p.id === pingId);
      if (idx < 0) return;
      pings[idx] = { ...migratePing(pings[idx]), distanceFt: ft };
      BeneosLiveGameControl._setPings(pings);
    });
  }

  _scheduleCommit(key, fn) {
    const existing = this._commitTimers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this._commitTimers.delete(key);
      try { fn(); } catch (e) { console.warn("LGC commit failed", e); }
    }, COMMIT_DEBOUNCE_MS);
    this._commitTimers.set(key, t);
  }

  // -- Direction live-preview wiring (mouse-move, non-action) -------

  _wireDirectionPreview() {
    const crosses = this.element?.querySelectorAll?.(".dir-cross");
    if (!crosses) return;
    crosses.forEach((cross) => {
      if (cross.dataset.dirWired === "1") return;
      cross.dataset.dirWired = "1";
      cross.addEventListener("mousemove", (ev) => {
        if (ev.target?.closest?.(".dir-btn")) return;
        const deg = mouseToDeg(ev, cross);
        const pingId = cross.dataset.pingId || "composer";
        // Cheap local update: rewrite the readout text + wedge angle
        // without re-rendering. The .dir-deg CSS-var rotates the
        // highlight wedge.
        cross.style.setProperty("--dir-deg", `${deg}deg`);
        const readout = cross.querySelector(".dir-readout-deg");
        const sector  = cross.querySelector(".dir-readout-sector");
        if (readout) readout.textContent = `${Math.round(deg)}°`;
        if (sector)  sector.textContent  = degToSector(deg);
        this._dirPreview.set(pingId, deg);
      });
      cross.addEventListener("mouseleave", () => {
        const pingId = cross.dataset.pingId || "composer";
        const stored = Number(cross.dataset.deg) || 0;
        cross.style.setProperty("--dir-deg", `${stored}deg`);
        const readout = cross.querySelector(".dir-readout-deg");
        const sector  = cross.querySelector(".dir-readout-sector");
        if (readout) readout.textContent = `${Math.round(stored)}°`;
        if (sector)  sector.textContent  = degToSector(stored);
        this._dirPreview.delete(pingId);
      });
    });
  }

  _wireSliders() {
    const inputs = this.element?.querySelectorAll?.(".dist-range");
    if (!inputs) return;
    inputs.forEach((input) => {
      if (input.dataset.distWired === "1") return;
      input.dataset.distWired = "1";
      input.addEventListener("input", (ev) => this._onSliderInput(ev));
    });
  }

  // -- Ping add / remove --------------------------------------------

  static async _onPingAdd(_ev, _target) {
    const c = this._composer;
    if (!c.originSlug || c.distanceFt == null || c.directionDeg == null) return;
    const ping = {
      id: foundry.utils.randomID(16),
      originSlug: c.originSlug,
      distanceFt: Math.round(c.distanceFt),
      directionDeg: ((c.directionDeg % 360) + 360) % 360,
      createdAt: Date.now(),
    };
    const pings = BeneosLiveGameControl._getPings();
    pings.unshift(ping);
    await BeneosLiveGameControl._setPings(pings);

    // Targeting: classify all chars, dispatch sound to attuned-user
    // group, post chat-whispers (attuned: pulsing with char-link;
    // owned-not-attuned: lightweight item-vibrates note).
    try {
      const dispatch = dispatchPing(ping);
      if (dispatch.soundUserIds.length) {
        emitPingSound(dispatch.soundUserIds, { alsoGM: true });
      }
      try { game.beneos?.analytics?.track("feature_used", { feature: "lgc-ping" }); } catch (_) {}
      await createPingWhispers(ping, dispatch);
    } catch (e) {
      console.warn("Beneos | LGC ping dispatch failed:", e);
    }

    this._composerExpanded = false;
    this._originDropdownOpen = false;
    this.render(false);
  }

  // GM convenience: clicking a sensing-actor chip in the ping-card
  // footer opens that actor's sheet and switches to the Beneos tab so
  // the GM can see exactly what the player is looking at.
  static async _onOpenActorSheet(_ev, target) {
    const actorId = target.closest("[data-actor-id]")?.dataset?.actorId
                 ?? target.dataset.actorId;
    if (!actorId) return;
    const actor = game.actors?.get?.(actorId);
    if (!actor) return;
    try {
      await actor.sheet.render(true);
      setTimeout(() => {
        const el = actor.sheet?.element;
        const root = (el instanceof HTMLElement) ? el : el?.[0];
        const tab = root?.querySelector?.('[data-tab="beneos"]');
        if (tab) tab.click();
      }, 350);
    } catch (e) { console.warn("LGC open-actor-sheet failed:", e); }
  }

  static async _onPingRemove(_ev, target) {
    const id = target.closest("[data-ping-id]")?.dataset?.pingId;
    if (!id) return;
    const pings = BeneosLiveGameControl._getPings().filter(p => p.id !== id);
    await BeneosLiveGameControl._setPings(pings);
    this.render(false);
  }
}

// Expose a global opener so the Cloud-Footer launcher action can call it
// regardless of when this ESM file is actually parsed (which can happen
// after the Foundry "ready" hook has already fired).
function _exposeOpener() {
  if (typeof globalThis.game === "undefined") return;
  globalThis.game.beneos ??= {};
  globalThis.game.beneos.openLgc = () => BeneosLiveGameControl.open();
}
_exposeOpener();
Hooks.once("init",  _exposeOpener);
Hooks.once("setup", _exposeOpener);
Hooks.once("ready", _exposeOpener);
