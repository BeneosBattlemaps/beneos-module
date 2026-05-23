// Stage 13c-mini + Stage 13c-full + Stage 13d-1: Beneos FX-Editor —
// ApplicationV2-Window für den Creator-Mode-Designer-Workflow.
//
// 13c-mini: live-auto-save Drop-Shadow-Editor.
// 13c-full: generischer Filter-Type-Dispatcher + Filter-Library-
// Section mit 8 vorkonfigurierten Effekten. Param-Sliders werden
// dynamisch aus BENEOS_FX_TYPES gerendert.
// 13d-1: split slider input → live PIXI-mutation (no setFlag) and
// change → persist (one setFlag at release). The actor-flag-roundtrip
// no longer drives the visual feedback, eliminating the prior 1–2 s
// drag lag.

import { BeneosUtility } from "../beneos_utility.js"
import { BENEOS_FX_TYPES } from "./beneos-fx-presets.mjs"
import { BeneosFXEngine } from "./beneos-fx.mjs"

/**
 * Mode-Schema-Helper: returns
 *   { mode: "topdown" | "tokenized", listKey: "fxTopdown" | "fxTokenized" }
 * for the token currently being edited. The list-key tells the editor
 * where to read/write fx-entries in the rendering-flag.
 */
function getEditingMode(token) {
  const mode = BeneosFXEngine.getActiveMode(token)
  return { mode, listKey: mode === "topdown" ? "fxTopdown" : "fxTokenized" }
}

/**
 * Pull the list-of-effects for the active mode out of the rendering-
 * flag. Lazy-migration: when no mode-specific list exists yet but a
 * legacy `fx[]` does, return a CLONE of the legacy list as the
 * starting point. Caller is responsible for writing it under the
 * mode-specific key on the next setFlag — the legacy `fx[]` stays
 * untouched as an immutable fallback for older worlds and exports.
 */
function readActiveFxList(rendering, token) {
  const { listKey } = getEditingMode(token)
  if (Array.isArray(rendering?.[listKey])) return rendering[listKey]
  if (Array.isArray(rendering?.fx)) return rendering.fx.map(e => ({ ...e, params: { ...(e.params || {}) } }))
  return []
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

export class BeneosFXEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-fx-editor",
    classes: ["beneos-fx-editor"],
    tag: "section",
    window: {
      title: "BENEOS.FXEditor.Title",
      resizable: true
    },
    position: { width: 560, height: 640 },
    actions: {
      addFilter:   BeneosFXEditor._onAddFilter,
      removeFx:    BeneosFXEditor._onRemoveFx,
      toggleFx:    BeneosFXEditor._onToggleFx,
      copyJson:    BeneosFXEditor._onCopyJson,
      closeEditor: BeneosFXEditor._onCloseEditor
    }
  }

  static PARTS = {
    body: { template: "modules/beneos-module/templates/cloud-v2/beneos-fx-editor.hbs" }
  }

  // Stage 13d-10-fix: track open editor instances so the OFF macro
  // / setting-change can close them all.
  static instances = new Set()

  /**
   * Hard gate — the editor is Designer-only. End-user installs run
   * the FX engine to render saved effects, but never open this UI.
   * Called from the static factory and from each render-pass so a
   * mid-session OFF-toggle stops further writes.
   */
  static _canOpen() {
    try {
      return !!game.settings.get("beneos-module", "beneos-creator-mode")
    } catch (e) { return false }
  }

  /**
   * Close every live editor instance. Used by the OFF-macro and the
   * setting-change watcher to ensure no auto-save can fire after
   * the Creator-Mode toggles off.
   */
  static closeAll() {
    for (const inst of [...BeneosFXEditor.instances]) {
      try { inst.close() } catch (e) { /* swallow */ }
    }
  }

  constructor(token, options = {}) {
    super(options)
    this.tokenId = token?.id
    BeneosFXEditor.instances.add(this)
  }

  get token() { return canvas?.tokens?.get(this.tokenId) }
  get actor() { return this.token?.actor || canvas?.tokens?.get(this.tokenId)?.document?.actor }

  /**
   * Override render() to bail out if Creator-Mode is off. Catches
   * both the initial open and any subsequent re-render attempts
   * after a mid-session OFF-toggle.
   */
  async render(force, options) {
    if (!BeneosFXEditor._canOpen()) {
      ui.notifications?.warn("Beneos: FX Editor is only available when Creator Mode is ON.")
      this.close()
      return this
    }
    return super.render(force, options)
  }

  get title() {
    const name = this.actor?.name || ""
    const { mode } = getEditingMode(this.token)
    const modeLabel = mode === "topdown"
      ? game.i18n.localize("BENEOS.FXEditor.ModeTopDown")
      : game.i18n.localize("BENEOS.FXEditor.ModeTokenized")
    return `${game.i18n.localize("BENEOS.FXEditor.Title")} — ${name} (${modeLabel})`
  }

  // ----- Context preparation -----

  async _prepareContext(_options) {
    const actor = this.actor
    const token = this.token
    const rendering = actor?.getFlag("world", "beneos")?.rendering || {}
    const { mode } = getEditingMode(token)
    const fxRaw = readActiveFxList(rendering, token)
    const isLegacyShared = !Array.isArray(rendering[mode === "topdown" ? "fxTopdown" : "fxTokenized"])
                        && Array.isArray(rendering.fx) && rendering.fx.length > 0

    // Stage 13c-full: enrich each fx-entry with the type-def's
    // param-schema so the template can render sliders generically.
    const fx = fxRaw.map(entry => {
      const typeDef = BENEOS_FX_TYPES[entry.type]
      if (!typeDef) {
        // Unknown filter type — render header only, log warning.
        console.warn("[Beneos FX-Editor] unknown filter type in flag:", entry.type)
        return { ...entry, typeLabel: entry.type, typeIcon: "fa-solid fa-question", paramDefs: [] }
      }
      const params = entry.params || {}
      // Stage 13d-6: particle + render-layer effects get an
      // auto-injected `behindToken` slider (0/1) so the user can
      // toggle z-order. Avoids declaring the same param on every
      // type-def. Filter-types skip this since z-order doesn't
      // apply to a PIXI-Filter (it operates on the mesh-output).
      const baseParams = typeDef.params || []
      const isLayer = typeDef.backing === "particle" || typeDef.backing === "render-layer"
      const fullParams = isLayer
        ? [...baseParams, {
            name: "behindToken",
            label: "Behind Token",
            control: "slider",
            min: 0, max: 1, step: 1
          }]
        : baseParams
      const paramDefs = fullParams.map(p => {
        const fallback = (p.name === "behindToken") ? 0 : typeDef.defaults?.[p.name]
        const value = params[p.name] ?? fallback
        const enriched = { ...p, value }
        if (p.control === "slider") {
          enriched.displayValue = (typeof value === "number")
            ? Number(value.toFixed(2)).toString()
            : (value ?? "")
        } else if (p.control === "color") {
          const num = (typeof value === "number") ? value : 0
          enriched.colorHex = `#${num.toString(16).padStart(6, "0")}`
        }
        return enriched
      })
      return {
        ...entry,
        typeLabel: typeDef.label,
        typeIcon:  typeDef.icon,
        paramDefs
      }
    })

    // Library cards grouped by backing-type so the template can
    // render separate sections (Filters / Particles / Render-Layers).
    const filterTypes = []
    const particleTypes = []
    const renderLayerTypes = []
    for (const [id, def] of Object.entries(BENEOS_FX_TYPES)) {
      const card = { id, label: def.label, icon: def.icon, description: def.description }
      if (def.backing === "particle") particleTypes.push(card)
      else if (def.backing === "render-layer") renderLayerTypes.push(card)
      else filterTypes.push(card)
    }

    return {
      actorName: actor?.name || "",
      fx,
      hasFx: fx.length > 0,
      filterTypes,
      particleTypes,
      renderLayerTypes,
      hasParticles: particleTypes.length > 0,
      hasRenderLayers: renderLayerTypes.length > 0,
      editingMode: mode,
      editingModeLabel: mode === "topdown"
        ? game.i18n.localize("BENEOS.FXEditor.ModeTopDown")
        : game.i18n.localize("BENEOS.FXEditor.ModeTokenized"),
      isLegacyShared
    }
  }

  // ----- Lifecycle -----

  _onRender(context, options) {
    super._onRender?.(context, options)
    const root = this.element
    if (!root) return
    // Stage 13d-1: split listeners.
    //   input  → live PIXI mutation only (no setFlag) — fires every
    //            slider tick, must stay cheap.
    //   change → persist via setFlag (fires once on slider release
    //            or color-picker commit).
    root.querySelectorAll("[data-fx-idx][data-param]").forEach(el => {
      el.addEventListener("input",  e => this._onParamLive(e))
      el.addEventListener("change", e => this._onParamCommit(e))
    })
    if (!this._updateActorHookId) {
      this._updateActorHookId = Hooks.on("updateActor", actor => {
        if (this._suppressNextHook) {
          this._suppressNextHook = false
          return
        }
        if (actor?.id === this.actor?.id && this.rendered) {
          this.render({ parts: ["body"] })
        }
      })
    }
    // Stage 13d-7: re-render the editor when the token's image
    // variant flips (toggleTokenStyle / forceChangeToken). The
    // active fx-list switches with the mode, so the body needs a
    // refresh to show the right one.
    if (!this._updateTokenHookId) {
      this._updateTokenHookId = Hooks.on("updateToken", (tokenDoc, changes) => {
        if (tokenDoc?.id !== this.tokenId) return
        if (!foundry.utils.hasProperty(changes, "texture.src")) return
        if (this.rendered) this.render({ parts: ["body"] })
      })
    }
  }

  _onClose(options) {
    if (this._updateActorHookId) {
      Hooks.off("updateActor", this._updateActorHookId)
      this._updateActorHookId = null
    }
    if (this._updateTokenHookId) {
      Hooks.off("updateToken", this._updateTokenHookId)
      this._updateTokenHookId = null
    }
    BeneosFXEditor.instances.delete(this)
    return super._onClose(options)
  }

  // ----- Stage 13d-1: split param-handling -----

  /**
   * Parse a slider/color-input event into (fxIdx, param, value, el).
   * Returns null on invalid input. Used by both live-mutation and
   * commit handlers.
   */
  _parseParamEvent(event) {
    const el = event.target
    const fxIdx = parseInt(el.dataset.fxIdx, 10)
    const param = el.dataset.param
    if (!Number.isFinite(fxIdx) || !param) return null
    const value = (el.type === "color")
      ? parseInt(el.value.replace("#", ""), 16)
      : parseFloat(el.value)
    if (Number.isNaN(value)) return null
    return { el, fxIdx, param, value }
  }

  /**
   * Update the small value-label next to the slider to track the
   * drag in real time. Independent of setFlag-roundtrip.
   */
  _updateValueLabel(el, param, value, fxType) {
    const valueLabel = el.parentElement?.querySelector(".bfx-value")
    if (!valueLabel) return
    if (el.type === "color") {
      valueLabel.textContent = el.value.toUpperCase()
    } else {
      const typeDef = BENEOS_FX_TYPES[fxType]
      const paramDef = typeDef?.params?.find(p => p.name === param)
      const suffix = paramDef?.unit || ""
      const display = Number(value.toFixed(2)).toString()
      valueLabel.textContent = `${display}${suffix}`
    }
  }

  /**
   * Stage 13d-1: live-mutation on slider input. Mutates the PIXI
   * filter directly — NO setFlag, NO Foundry-doc-roundtrip. Fires
   * up to 60×/s while dragging.
   */
  _onParamLive(event) {
    const parsed = this._parseParamEvent(event)
    if (!parsed) return
    const { el, fxIdx, param, value } = parsed
    const actor = this.actor
    if (!actor) return
    // Stage 13d-12: mode-aware lookup (same as _onParamCommit / _onToggleFx).
    // Was: `rendering?.fx` — hardcoded to the legacy key, which is empty on
    // tokens whose FX live in fxTopdown/fxTokenized. That made fxEntry
    // undefined and the early return below swallowed every slider input.
    const rendering = actor.getFlag("world", "beneos")?.rendering || {}
    const fx = readActiveFxList(rendering, this.token)
    const fxEntry = fx[fxIdx]
    if (!fxEntry?.id) return
    this._updateValueLabel(el, param, value, fxEntry.type)
    const token = this.token
    if (token) BeneosFXEngine.liveUpdate(token, fxEntry.id, param, value)
  }

  /**
   * Stage 13d-1: commit on slider release / color-picker confirm.
   * Persists via setFlag with two guards:
   *   - this._suppressNextHook so updateActor doesn't render-loop
   *     this editor instance.
   *   - globalThis.beneosFXEditorWriting so the master updateActor
   *     hook in beneos_module.js skips its full clear+re-apply (the
   *     PIXI state is already correct from liveUpdate).
   */
  async _onParamCommit(event) {
    // Hard guard against stale writes after a mid-session OFF-toggle.
    if (!BeneosFXEditor._canOpen()) {
      ui.notifications?.warn("Beneos: Creator Mode is OFF — change not persisted.")
      this.close()
      return
    }
    const parsed = this._parseParamEvent(event)
    if (!parsed) return
    const { fxIdx, param, value } = parsed
    const actor = this.actor
    if (!actor) return
    const beneosFlag = actor.getFlag("world", "beneos") || {}
    const rendering = beneosFlag.rendering || {}
    const { listKey } = getEditingMode(this.token)
    const sourceList = readActiveFxList(rendering, this.token)
    const fxList = sourceList.map((entry, i) =>
      i === fxIdx
        ? { ...entry, params: { ...(entry.params || {}), [param]: value } }
        : entry
    )
    this._suppressNextHook = true
    globalThis.beneosFXEditorWriting = true
    try {
      await actor.setFlag("world", "beneos", {
        ...beneosFlag,
        rendering: { ...rendering, [listKey]: fxList }
      })
    } finally {
      setTimeout(() => { globalThis.beneosFXEditorWriting = false }, 0)
    }
  }

  // ----- Action handlers -----

  /**
   * Stage 13c-full: generic add. dataset.fxType determines which
   * BENEOS_FX_TYPES entry's defaults are used for the new filter.
   */
  static async _onAddFilter(event, target) {
    if (!BeneosFXEditor._canOpen()) { this.close(); return }
    const fxType = target?.dataset?.fxType
    const typeDef = BENEOS_FX_TYPES[fxType]
    if (!typeDef) {
      ui.notifications?.warn(`Beneos: unknown filter type "${fxType}"`)
      return
    }
    const actor = this.actor
    if (!actor) return
    const beneosFlag = actor.getFlag("world", "beneos") || {}
    const rendering = beneosFlag.rendering || {}
    const { listKey } = getEditingMode(this.token)
    const sourceList = readActiveFxList(rendering, this.token)
    const fxList = [...sourceList, {
      id: foundry.utils.randomID(8),
      type: fxType,
      enabled: true,
      params: { ...typeDef.defaults }
    }]
    await actor.setFlag("world", "beneos", {
      ...beneosFlag,
      rendering: { ...rendering, [listKey]: fxList, fxEnabled: rendering.fxEnabled !== false }
    })
  }

  static async _onRemoveFx(event, target) {
    if (!BeneosFXEditor._canOpen()) { this.close(); return }
    const fxIdx = parseInt(target?.dataset?.fxIdx, 10)
    if (!Number.isFinite(fxIdx)) return
    const actor = this.actor
    if (!actor) return
    const beneosFlag = actor.getFlag("world", "beneos") || {}
    const rendering = beneosFlag.rendering || {}
    const { listKey } = getEditingMode(this.token)
    const sourceList = readActiveFxList(rendering, this.token)
    const fxList = sourceList.filter((_, i) => i !== fxIdx)
    await actor.setFlag("world", "beneos", {
      ...beneosFlag,
      rendering: { ...rendering, [listKey]: fxList }
    })
  }

  static async _onToggleFx(event, target) {
    if (!BeneosFXEditor._canOpen()) { this.close(); return }
    const fxIdx = parseInt(target?.dataset?.fxIdx, 10)
    if (!Number.isFinite(fxIdx)) return
    const actor = this.actor
    if (!actor) return
    const beneosFlag = actor.getFlag("world", "beneos") || {}
    const rendering = beneosFlag.rendering || {}
    const { listKey } = getEditingMode(this.token)
    const sourceList = readActiveFxList(rendering, this.token)
    const fxList = sourceList.map((entry, i) =>
      i === fxIdx ? { ...entry, enabled: !entry.enabled } : entry
    )
    await actor.setFlag("world", "beneos", {
      ...beneosFlag,
      rendering: { ...rendering, [listKey]: fxList }
    })
  }

  static async _onCopyJson(_event, _target) {
    const actor = this.actor
    if (!actor) return
    const rendering = actor.getFlag("world", "beneos")?.rendering || {}
    const json = JSON.stringify({ rendering }, null, 2)
    try {
      await navigator.clipboard.writeText(json)
      ui.notifications?.info(game.i18n.localize("BENEOS.FXEditor.Notification.Copied"))
    } catch (err) {
      console.warn("[Beneos FX-Editor] clipboard write failed", err)
      ui.notifications?.warn("Beneos: clipboard unavailable — see Console for the JSON.")
      console.log(json)
    }
  }

  static async _onCloseEditor(_event, _target) {
    this.close()
  }
}
