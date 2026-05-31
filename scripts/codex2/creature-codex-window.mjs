// Beneos Creature Codex Window — standalone per-creature detail page.
// Spawned via game.beneos.codex.openForActor(actor) from the Token-HUD,
// the Actor-Sheet header and the Cloud right-click context menu. Lives
// outside the main BeneosCodex hub window so multiple creature codices
// can be open in parallel during combat (one per token).

import { buildCreatureDetailCtx, openImagePopout, attachItemSheetContextMenu, openAllyCloudSearch, flashPaywallDenied, mountEmberField } from "./creature-codex.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATE_ROOT = "modules/beneos-module/templates/codex2";

export class BeneosCreatureCodexWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-creature-codex-{id}",   // {id} = actor.id, set per instance
    classes: ["beneos-codex", "beneos-creature-codex-window"],
    tag: "div",
    window: {
      title: "Creature Codex",
      icon: "beneos-icon-logo",
      resizable: true,
    },
    position: { width: 980, height: 720, left: 120, top: 80 },
    actions: {
      "cdx-tab":            BeneosCreatureCodexWindow._onTab,
      "cdx-tactics-sub":    BeneosCreatureCodexWindow._onTacticsSub,
      "cdx-ability-filter": BeneosCreatureCodexWindow._onAbilityFilter,
      "cdx-open-actor":     BeneosCreatureCodexWindow._onOpenActor,
      "cdx-download-pdf":   BeneosCreatureCodexWindow._onDownloadPdf,
      "cdx-open-pdf":       BeneosCreatureCodexWindow._onOpenPdf,
      "cdx-trigger-ability":BeneosCreatureCodexWindow._onTriggerAbility,
      "cdx-roll-chip":      BeneosCreatureCodexWindow._onRollChip,
      "cdx-toggle-prompt":  BeneosCreatureCodexWindow._onTogglePrompt,
      "cdx-ally-search":    BeneosCreatureCodexWindow._onAllySearch,
      "cdx-open-journal-image": BeneosCreatureCodexWindow._onOpenJournalImage,
    },
  };

  static PARTS = {
    main: {
      template: `${TEMPLATE_ROOT}/parts/creature-detail-page.hbs`,
      scrollable: [".cdx-creature-body"],
    },
  };

  // Instance state — per-window, not per-actor (theater-state lives in
  // creature-codex.mjs._theaterState because it should survive a window
  // close/reopen within the same combat).
  _activeTab = "overview";
  _tacticsSub = "general";
  _abilityFilter = "all";
  _tokenKey = null;
  _actorId = null;
  _locked = false;

  /** Open (or refocus) a creature codex window for the given actor.
   *  Multiple windows can coexist: each one gets a unique id derived
   *  from the actor id so Foundry treats them as separate instances. */
  static openForActor(actor) {
    if (!actor) return null;
    const flag = actor.getFlag?.("world", "beneos") ?? {};
    const tokenKey = flag.tokenKey ?? flag.fullId ?? actor.id;
    const existingId = `beneos-creature-codex-${actor.id}`;
    // Reuse if a window for this actor is already up
    const existing = foundry.applications?.instances?.get?.(existingId);
    if (existing) {
      try { existing.bringToTop?.(); } catch (_) {}
      existing.render({ force: true });
      return existing;
    }
    const win = new BeneosCreatureCodexWindow({ id: existingId });
    win._tokenKey = tokenKey;
    win._actorId = actor.id;
    win.render({ force: true });
    return win;
  }

  /** Foundry V13 title getter so the window-header reads the actor's
   *  name once context is built. */
  get title() {
    const actor = this._actorId ? game.actors?.get?.(this._actorId) : null;
    return actor?.name
      ? `${game.i18n.localize("BENEOS.CreatureCodex.WindowTitle")}: ${actor.name}`
      : game.i18n.localize("BENEOS.CreatureCodex.WindowTitle");
  }

  async _prepareContext(_options) {
    const creature = await buildCreatureDetailCtx({
      tokenKey: this._tokenKey,
      activeTab: this._activeTab,
      activeTacticsSub: this._tacticsSub,
      activeAbilityFilter: this._abilityFilter,
    });
    this._locked = !!creature?.locked;
    return { creature };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Left-click fires (cdx-trigger-ability); right-click opens the sheet.
    attachItemSheetContextMenu(this.element);
    // Persistent ambient embers over the hero band (survives tab re-renders).
    mountEmberField(this.element);
  }

  // ---- Action handlers (delegate to instance state, then re-render) ---

  static _onTab(_ev, target) {
    if (this._locked) { flashPaywallDenied(this.element); return; }
    const tab = target.dataset.cdxTab;
    if (!tab) return;
    this._activeTab = tab;
    this.render(false);
  }
  static _onTacticsSub(_ev, target) {
    if (this._locked) { flashPaywallDenied(this.element); return; }
    const sub = target.dataset.cdxSub;
    if (!sub) return;
    this._tacticsSub = sub;
    this.render(false);
  }
  static _onAbilityFilter(_ev, target) {
    const f = target.dataset.cdxFilter;
    if (!f) return;
    this._abilityFilter = f;
    this.render(false);
  }
  static async _onOpenActor(_ev, target) {
    const actor = game.actors?.get?.(target.dataset.actorId);
    try { await actor?.sheet?.render(true); } catch (_) {}
  }
  static async _onDownloadPdf(_ev, target) {
    if (this._locked) { flashPaywallDenied(this.element); return; }
    if (this._pdfDownloading) return;   // ignore double-clicks while running
    const actor = game.actors?.get?.(target?.dataset?.actorId);
    const flag = actor?.getFlag?.("world", "beneos") ?? {};
    const tokenKey = this._tokenKey ?? flag.tokenKey ?? flag.fullId ?? actor?.id;
    // M8.3.40: drive a left-to-right progress bar in the content-hint row
    // (mirrors the cloud-install bar). It eases toward ~90% while the PDF is
    // fetched/uploaded, then snaps to 100% with a flash on success.
    const hintEl = this.element?.querySelector?.(".beneos-codex-hint");
    this._pdfDownloading = true;
    hintEl?.classList.remove("is-done");
    hintEl?.classList.add("is-downloading");
    try {
      const mod = await import("../codex/codex-pdf-service.mjs");
      const ok = await mod.downloadCreaturePdf(tokenKey);
      if (ok) {
        hintEl?.classList.add("is-done");
        await new Promise((r) => setTimeout(r, 550));   // let the bar finish + flash
        this.render(false);                              // flips the button to "View PDF"
      } else {
        hintEl?.classList.remove("is-downloading");
      }
    } catch (err) {
      hintEl?.classList.remove("is-downloading", "is-done");
      console.error("[beneos-codex] PDF download failed", err);
      ui.notifications?.error?.(game.i18n.format(
        "BENEOS.CreatureCodex.Warning.PdfFailed",
        { reason: err?.message ?? "unknown" }
      ));
    } finally {
      this._pdfDownloading = false;
    }
  }
  static async _onOpenPdf(_ev, target) {
    if (this._locked) { flashPaywallDenied(this.element); return; }
    const path = target?.dataset?.pdfPath;
    if (!path) return;
    const actor = this._actorId ? game.actors?.get?.(this._actorId) : null;
    const mod = await import("./pdf-viewer-window.mjs");
    mod.openPdfViewer(path, actor?.name ?? "");
  }
  static async _onTriggerAbility(_ev, target) {
    const actor = game.actors?.get?.(target.dataset.actorId);
    const item  = actor?.items?.get?.(target.dataset.itemId);
    try {
      if (typeof item?.use === "function") await item.use();
      else if (typeof item?.roll === "function") await item.roll();
    } catch (_) {}
  }
  static async _onRollChip(_ev, target) {
    const actor = target.dataset.actorId ? game.actors?.get?.(target.dataset.actorId) : null;
    const formula = target.dataset.rollFormula ?? "";
    if (!formula) return;
    try {
      const roll = await (new Roll(formula)).evaluate();
      await roll.toMessage({ speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined });
    } catch (_) {}
  }
  /** Pop the journal/hero image full-size. Foundry's ImagePopout gives a
   *  correct-aspect window with a Show-Players share button and an X.
   *  Capped at 950px wide and never upscaled past the source resolution. */
  static _onOpenJournalImage(_ev, target) {
    if (this._locked) { flashPaywallDenied(this.element); return; }
    const src = target?.dataset?.src;
    if (!src) return;
    openImagePopout(src, target.dataset.title ?? "");
  }
  /** Toggle the clicked prompt's summary card open/closed (slow fade via CSS). */
  static _onTogglePrompt(_ev, target) {
    target?.closest?.(".cdx-prompt")?.classList?.toggle?.("cdx-prompt-open");
  }
  static async _onAllySearch(_ev, target) {
    openAllyCloudSearch(target?.dataset?.allyName ?? "");
  }

  static async preloadTemplates() {
    // Re-use the BeneosCodex partial-registration. The hub already
    // registers our creature/ partials globally, so nothing further
    // is needed here. Kept as a stub for symmetry.
    return true;
  }
}
