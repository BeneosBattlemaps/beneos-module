// Stage 13b/13c/13d-1: Beneos FX-Engine. Reads
// flags.world.beneos.rendering.fx[] and applies each entry as one
// or more PIXI-Filters on token.mesh.filters with a beneosFxId-
// marker.
//
// Co-existence: TMFX cleanup only removes filters carrying its own
// `.filterId` property. Our `.beneosFxId` marker keeps Beneos-filters
// safe from TMFX's teardown, and our own `clearForToken` only removes
// filters with `.beneosFxId` — TMFX-, Foundry-vision-, and other
// module filters stay untouched.
//
// Stage 13c-Polish: each fx entry can produce a FILTER STACK (array).
// All filters in one stack share the same `beneosFxId` so they're
// applied and torn down as a unit. The animator receives the entire
// stack so e.g. fire-flicker can drive an outer-glow + inner-core
// simultaneously.
//
// Stage 13d-1: instantiate is split from applyParams. `instantiate`
// only constructs and does non-param setup; `applyParams` writes
// every param-driven value. This split powers `liveUpdate` —
// dragging a slider mutates existing PIXI filters in-place
// (no setFlag, no teardown, no re-instantiation), so slider-feel
// is butter-smooth even when the actor.flag-roundtrip would
// otherwise take 1–2 s.

import { BeneosUtility } from "../beneos_utility.js"
import { BENEOS_FX_TYPES, BENEOS_FX_ANIMATORS } from "./beneos-fx-presets.mjs"
import { BeneosParticleSystem } from "./beneos-fx-particles.mjs"
import { BeneosRenderLayer } from "./beneos-fx-render-layers.mjs"

/**
 * Per-frame animator. One central canvas.app.ticker callback iterates
 * all registered (token, filters[], params, animator)-tuples and
 * mutates filter properties for the next frame. Self-pausing: ticker
 * is only subscribed while there's at least one animated filter alive.
 *
 * Stage 13d-1: the params object held in the entry IS the same
 * reference that liveUpdate mutates — so animator ticks see slider
 * changes immediately without registry-restart.
 */
export class BeneosFXAnimator {
  static _ticking = false
  static _entries = new Set()

  static register(token, filters, params, animatorKey) {
    if (!token || !filters?.length || !animatorKey) return
    // Stage 13d-1: store params by reference, never clone — liveUpdate
    // mutates this exact object.
    this._entries.add({ token, filters, params, animator: animatorKey })
    if (!this._ticking) this._start()
  }

  static unregisterToken(token) {
    for (const e of [...this._entries]) {
      if (e.token === token) this._entries.delete(e)
    }
    if (this._entries.size === 0 && this._ticking) this._stop()
  }

  static unregisterFilter(filter) {
    for (const e of [...this._entries]) {
      if (e.filters?.includes(filter)) this._entries.delete(e)
    }
    if (this._entries.size === 0 && this._ticking) this._stop()
  }

  /**
   * Stage 13d-1: mutate the params-reference of any animator entry
   * matching this token + fxId so the next tick reads the new value.
   * No-op for non-animated filters — they're driven by applyParams
   * directly in BeneosFXEngine.liveUpdate.
   */
  static updateParams(token, fxId, paramName, value) {
    for (const e of this._entries) {
      if (e.token !== token) continue
      const matches = e.filters?.some(f => f?.beneosFxId === fxId)
      if (matches) e.params[paramName] = value
    }
  }

  static _start() {
    if (!canvas?.app?.ticker) return
    this._ticking = true
    canvas.app.ticker.add(this._tick, this)
  }

  static _stop() {
    if (!canvas?.app?.ticker) return
    canvas.app.ticker.remove(this._tick, this)
    this._ticking = false
  }

  static _tick() {
    const time = performance.now()
    for (const e of [...this._entries]) {
      if (!e.token?.mesh || !e.filters?.length) {
        BeneosFXAnimator._entries.delete(e)
        continue
      }
      const fn = BENEOS_FX_ANIMATORS[e.animator]
      if (fn) {
        try { fn(e.filters, e.params, time) }
        catch (err) { console.warn("[Beneos FX] animator failed", e.animator, err) }
      }
    }
    if (BeneosFXAnimator._entries.size === 0) BeneosFXAnimator._stop()
  }
}

export class BeneosFXEngine {

  /**
   * Apply all enabled filters from the actor's rendering.fx flag to
   * the token's PIXI mesh. Idempotent: clears existing Beneos filters
   * first, then re-applies in flag order.
   */
  static applyForToken(token) {
    if (!token?.mesh) return
    if (!BeneosUtility.isBeneosCreature(token)) return
    try {
      if (game.settings.get(BeneosUtility.moduleID(), "beneos-fx-master-disable")) {
        BeneosFXEngine.clearForToken(token)
        return
      }
    } catch (e) { /* setting not yet registered (early init) */ }
    const rendering = token.actor?.getFlag("world", "beneos")?.rendering || {}
    if (rendering.fxEnabled === false) {
      BeneosFXEngine.clearForToken(token)
      return
    }
    // Mode-aware list resolution: pick the list matching the token's
    // current image-variant. Falls back to legacy `fx[]` when the
    // mode-specific list is absent — keeps existing exports working.
    const fxList = BeneosFXEngine._resolveFxList(rendering, token)
    // Diff-based cleanup: collect fxIds that should be live now,
    // destroy any active particle-system whose fxId is NOT in this
    // set. Filters are cheap to rebuild, so we still full-replace
    // them. This is the central fix for the ghost-listener leak
    // — re-running applyForToken on a Foundry update no longer
    // tears down particle-systems that should keep running.
    const enabledIds = new Set()
    for (const cfg of fxList) {
      if (cfg?.enabled && cfg.id) enabledIds.add(cfg.id)
    }
    for (const sys of [...BeneosParticleSystem.instances]) {
      if (sys.token === token && !enabledIds.has(sys.beneosFxId)) sys.destroy()
    }
    for (const layer of [...BeneosRenderLayer.instances]) {
      if (layer.token === token && !enabledIds.has(layer.beneosFxId)) layer.destroy()
    }
    // Filters get the full-replace treatment (clear + re-apply).
    if (Array.isArray(token.mesh.filters)) {
      token.mesh.filters = token.mesh.filters.filter(f => !f?.beneosFxId)
    }
    BeneosFXAnimator.unregisterToken(token)

    if (!fxList.length) return
    if (!Array.isArray(token.mesh.filters)) token.mesh.filters = []
    for (const cfg of fxList) {
      if (!cfg?.enabled) continue
      // Stage 13d-5: auto-migrate the deprecated `lightning-flash`
      // type to the new `lightning-arc` shader-based variant. Token
      // flag is left untouched; the user can re-save in the editor
      // to persist the upgrade.
      let cfgType = cfg.type
      if (cfgType === "lightning-flash") {
        if (!BeneosFXEngine._lightningMigrationLogged) {
          console.info("[Beneos FX] migrating lightning-flash → lightning-arc")
          BeneosFXEngine._lightningMigrationLogged = true
        }
        cfgType = "lightning-arc"
      }
      const typeDef = BENEOS_FX_TYPES[cfgType]
      if (!typeDef) {
        console.warn("[Beneos FX] unknown filter type:", cfg.type)
        continue
      }
      const fxId = cfg.id || foundry.utils.randomID(8)
      const params = { ...typeDef.defaults, ...(cfg.params || {}) }
      const backing = typeDef.backing || "filter"
      try {
        if (backing === "particle") {
          const existing = BeneosParticleSystem.findOnToken(token, fxId)
          if (existing) existing.applyParams(params)
          else new BeneosParticleSystem(cfg.type, params, token, fxId)
        } else if (backing === "render-layer") {
          const existing = BeneosRenderLayer.findOnToken(token, fxId)
          if (existing) existing.applyParams(params)
          else new BeneosRenderLayer(cfg.type, params, token, fxId)
        } else {
          BeneosFXEngine._applyFilterBacking(typeDef, cfg, params, token, fxId)
        }
      } catch (err) {
        console.warn("[Beneos FX] apply failed:", cfg.type, err)
      }
    }
  }

  /**
   * Filter-backing application path. Construct the PIXI filter stack,
   * tag every filter with the shared beneosFxId, push onto
   * token.mesh.filters, register animator if applicable.
   */
  static _applyFilterBacking(typeDef, cfg, params, token, fxId) {
    const Ctor = typeDef.pixiCtor?.()
    if (!Ctor) {
      console.warn(
        "[Beneos FX]", cfg.type,
        "needs a PIXI-Filter that's not available in this runtime",
        "(check that Token-Magic-FX is active, since it bundles pixi-filters)"
      )
      return
    }
    let filters
    try {
      let result
      if (typeof typeDef.instantiate === "function") {
        result = typeDef.instantiate(Ctor, params)
      } else {
        result = new Ctor(params)
      }
      filters = (Array.isArray(result) ? result : [result]).filter(f => f)
      for (const f of filters) f.beneosFxType = cfg.type
    } catch (err) {
      console.warn("[Beneos FX] filter construct failed:", cfg.type, err)
      return
    }
    if (!filters.length) return
    if (typeof typeDef.applyParams === "function") {
      try { typeDef.applyParams(filters, params) }
      catch (err) {
        console.warn("[Beneos FX] applyParams failed:", cfg.type, err)
      }
    }
    for (const filter of filters) {
      filter.beneosFxId = fxId
      token.mesh.filters.push(filter)
    }
    if (typeDef.animated && typeDef.animator) {
      BeneosFXAnimator.register(token, filters, params, typeDef.animator)
    }
  }

  /**
   * Remove all Beneos-marked filters AND particle/render-layer
   * children from this token's mesh. Leaves TMFX, Foundry-vision,
   * and other module objects intact.
   */
  static clearForToken(token) {
    const sprite = token?.mesh
    if (Array.isArray(sprite?.filters)) {
      sprite.filters = sprite.filters.filter(f => !f?.beneosFxId)
    }
    // Registry-based particle + render-layer cleanup. Works even
    // after Foundry re-creates token.mesh (the mesh.children path
    // then finds nothing, but the static-registry still holds the
    // system references with their live ticker-listeners).
    BeneosParticleSystem.unregisterByToken(token)
    BeneosRenderLayer.unregisterByToken(token)
    // Stragglers: tagged children that escaped registry-cleanup.
    // Scan both `token.mesh.children` (for behindToken=0 mounts)
    // and `token.children` (for behindToken=1 mounts).
    const sweepStragglers = (children) => {
      if (!Array.isArray(children)) return
      for (const child of children.filter(c => c?.beneosFxId)) {
        const sys = child.beneosParticleSystem || child.beneosRenderLayer
        if (sys) sys.destroy()
        else if (!child.destroyed) child.destroy({ children: true })
      }
    }
    sweepStragglers(sprite?.children)
    sweepStragglers(token?.children)
    BeneosFXAnimator.unregisterToken(token)
  }

  /**
   * Stage 13d-1: live-mutate filters belonging to one fx-entry on
   * a single token. Called from the FX-Editor on slider input-events
   * to give the user a frame-perfect drag experience without
   * setFlag/teardown roundtrips.
   *
   * Returns true if filters were found and updated; false if the
   * token has no live filters with this fxId (e.g. user added an
   * fx-entry but the token is off-canvas).
   */
  static liveUpdate(token, fxId, paramName, value) {
    if (!token?.mesh || !fxId || !paramName) return false
    const rendering = token.actor?.getFlag("world", "beneos")?.rendering || {}
    const fxList = BeneosFXEngine._resolveFxList(rendering, token)
    const fxEntry = fxList.find(e => e.id === fxId)
    if (!fxEntry) return false
    const typeDef = BENEOS_FX_TYPES[fxEntry.type]
    if (!typeDef) return false
    const params = {
      ...typeDef.defaults,
      ...(fxEntry.params || {}),
      [paramName]: value
    }
    const backing = typeDef.backing || "filter"
    // behindToken is a constructor-time decision — we can't switch
    // mount-points on a live system. Destroy + re-create when this
    // specific param changes; all other params route through the
    // normal applyParams live-mutation path.
    const isBehindFlip = (paramName === "behindToken")
    try {
      if (backing === "particle") {
        const sys = BeneosParticleSystem.findOnToken(token, fxId)
        if (!sys) return false
        if (isBehindFlip) {
          const newBehind = (value ?? 0) >= 0.5
          if (newBehind !== sys.behind) {
            sys.destroy()
            new BeneosParticleSystem(fxEntry.type, params, token, fxId)
            return true
          }
        }
        sys.applyParams(params)
        return true
      }
      if (backing === "render-layer") {
        const layer = BeneosRenderLayer.findOnToken(token, fxId)
        if (!layer) return false
        if (isBehindFlip) {
          const newBehind = (value ?? 0) >= 0.5
          if (newBehind !== layer.behind) {
            layer.destroy()
            new BeneosRenderLayer(fxEntry.type, params, token, fxId)
            return true
          }
        }
        layer.applyParams(params)
        return true
      }
      // filter backing — mutate live PIXI filters in-place
      const filters = (token.mesh.filters || []).filter(f => f?.beneosFxId === fxId)
      if (!filters.length || !typeDef.applyParams) return false
      typeDef.applyParams(filters, params)
      BeneosFXAnimator.updateParams(token, fxId, paramName, value)
      return true
    } catch (err) {
      console.warn("[Beneos FX] liveUpdate failed:", fxEntry.type, err)
      return false
    }
  }

  /**
   * Re-apply filters on every Beneos-Token on the active canvas.
   * Used by canvasReady (cold path) and Stage-13c+'s master-toggle.
   */
  static refreshAll() {
    if (!canvas?.tokens) return
    for (const t of canvas.tokens.placeables || []) {
      BeneosFXEngine.applyForToken(t)
    }
  }

  /**
   * Detect which image-variant the token currently shows. Beneos
   * tokens use `-top.webp` for the bird's-eye variant and the bare
   * filename for the 2.5D-frontview. The texture-source is the
   * authoritative signal — same approach used in beneos_utility.js
   * (forceChangeToken/toggleTokenStyle).
   */
  static getActiveMode(token) {
    const src = token?.document?.texture?.src ?? ""
    return src.includes("-top.webp") ? "topdown" : "tokenized"
  }

  /**
   * Pick the right fx-list for the token's active mode. Mode-
   * specific override wins; falls back to legacy `rendering.fx[]`
   * so existing exports keep working unchanged.
   */
  static _resolveFxList(rendering, token) {
    const mode = BeneosFXEngine.getActiveMode(token)
    const key = mode === "topdown" ? "fxTopdown" : "fxTokenized"
    if (Array.isArray(rendering?.[key])) return rendering[key]
    if (Array.isArray(rendering?.fx))    return rendering.fx
    return []
  }
}
