// Beneos FX — Render-Layer-Engine.
//
// Display-Object overlays mounted as PIXI.Graphics children of
// token.mesh. Unlike particle-systems (which spawn many small
// sprites), a render-layer is a *single* persistent Graphics that
// gets redrawn each frame for animation. Used for ring-pulses,
// shockwaves, lightning-bolts, and smoke-puffs.
//
// Self-registers with canvas.app.ticker for animation. Mirrors the
// memory-leak hardening from BeneosParticleSystem:
//   * Static instances-Set + MAX_INSTANCES cap.
//   * Self-destruct in _tick when graphics/token go away.
//   * Idempotent destroy() so double-calls are safe.

const TWO_PI = Math.PI * 2

function tokenHalfWidth(token) {
  const grid = canvas?.grid?.size || 100
  return (token?.document?.width ?? 1) * grid * 0.5
}
function tokenHalfHeight(token) {
  const grid = canvas?.grid?.size || 100
  return (token?.document?.height ?? 1) * grid * 0.5
}
function tokenRadius(token) {
  return Math.min(tokenHalfWidth(token), tokenHalfHeight(token))
}

export class BeneosRenderLayer {
  static instances = new Set()
  static MAX_INSTANCES = 30

  constructor(typeKey, params, token, fxId) {
    this.beneosFxId = fxId
    this.token = token
    this.typeKey = typeKey
    this.params = params
    this.elapsed = 0
    this.destroyed = false
    this.behind = (params?.behindToken ?? 0) >= 0.5
    this.state = {}  // type-specific scratch state
    this.graphics = new PIXI.Graphics()
    this.graphics.beneosFxId = fxId
    this.graphics.beneosRenderLayer = this
    // Mount-Switch (see BeneosParticleSystem for explanation).
    if (this.behind && token?.children) {
      const meshIdx = token.children.indexOf(token.mesh)
      const insertAt = (meshIdx >= 0) ? meshIdx : 0
      token.addChildAt(this.graphics, insertAt)
      this.graphics.x = (token.w ?? 0) / 2
      this.graphics.y = (token.h ?? 0) / 2
    } else if (token?.mesh) {
      token.mesh.addChild(this.graphics)
    }
    this._tickBound = this._tick.bind(this)
    if (canvas?.app?.ticker) canvas.app.ticker.add(this._tickBound)
    BeneosRenderLayer.instances.add(this)
    if (BeneosRenderLayer.instances.size > BeneosRenderLayer.MAX_INSTANCES) {
      const oldest = BeneosRenderLayer.instances.values().next().value
      if (oldest && oldest !== this) {
        console.warn("[Beneos FX] render-layer cap reached — evicting oldest")
        oldest.destroy()
      }
    }
  }

  applyParams(params) { this.params = params }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    BeneosRenderLayer.instances.delete(this)
    if (canvas?.app?.ticker) canvas.app.ticker.remove(this._tickBound)
    if (this.graphics && !this.graphics.destroyed) this.graphics.destroy()
  }

  static unregisterByToken(token) {
    if (!token) return
    for (const layer of [...BeneosRenderLayer.instances]) {
      if (layer.token === token) layer.destroy()
    }
  }

  static findOnToken(token, fxId) {
    for (const layer of BeneosRenderLayer.instances) {
      if (layer.token === token && layer.beneosFxId === fxId) return layer
    }
    return null
  }

  static destroyAll() {
    for (const layer of [...BeneosRenderLayer.instances]) layer.destroy()
  }

  _tick(ticker) {
    try {
      const dt = ticker?.deltaMS ?? 16
      this.elapsed += dt
      if (!this.graphics || this.graphics.destroyed
          || !this.graphics.parent || !this.token) {
        this.destroy()
        return
      }
      if (!this.behind && !this.token.mesh) {
        this.destroy()
        return
      }
      const def = RENDER_LAYER_DEFS[this.typeKey]
      if (!def) return
      def.draw(this.graphics, this.params, this.token, this.elapsed, this.state)
    } catch (err) {
      this._errorCount = (this._errorCount || 0) + 1
      if (this._errorCount === 1) {
        console.warn("[Beneos FX] render-layer tick failed:", this.typeKey, err)
      }
      if (this._errorCount > 5) {
        console.warn("[Beneos FX] render-layer disabled after repeated errors:", this.typeKey)
        this.destroy()
      }
    }
  }
}

const RENDER_LAYER_DEFS = {

  // Aura-Ring: single circle around the token with pulsing radius
  // and slow color-hue drift. Scales naturally to multi-cell tokens.
  "aura-ring": {
    draw: (g, params, token, elapsed) => {
      g.clear()
      const baseR = tokenRadius(token) * (params.radius ?? 1.1)
      const speed = params.speed ?? 1
      const pulse = 1 + 0.10 * Math.sin(elapsed * 0.002 * speed)
      const r = baseR * pulse
      const thickness = (params.thickness ?? 0.05) * tokenRadius(token)
      const alpha = (params.masterAlpha ?? 1) * (0.6 + 0.4 * Math.sin(elapsed * 0.0015 * speed))
      g.lineStyle(thickness, params.color ?? 0xFFD86B, alpha)
      g.drawCircle(0, 0, r)
      g.lineStyle(0)
    }
  },

  // Shockwave: 3 expanding rings cycling outward with alpha-fade.
  // Each ring is at a different phase of the same cycle so the
  // overall effect is a continuous pulse outward.
  "shockwave": {
    draw: (g, params, token, elapsed) => {
      g.clear()
      const baseR = tokenRadius(token)
      const speed = params.speed ?? 1
      const cycleMs = 1500 / speed
      const ringCount = Math.max(1, Math.floor(params.rings ?? 3))
      const thickness = (params.thickness ?? 0.04) * baseR
      const masterAlpha = params.masterAlpha ?? 1
      const color = params.color ?? 0xFF8080
      for (let i = 0; i < ringCount; i++) {
        const phase = ((elapsed + i * (cycleMs / ringCount)) % cycleMs) / cycleMs
        const r = baseR * (0.5 + 1.5 * phase * (params.radius ?? 1))
        const alpha = (1 - phase) * masterAlpha
        if (alpha <= 0.01) continue
        g.lineStyle(thickness * (1 - phase * 0.5), color, alpha)
        g.drawCircle(0, 0, r)
      }
      g.lineStyle(0)
    }
  },

  // Lightning-Bolt: random sprite-style jagged bolts that flash
  // briefly around the token. Uses an internal state array for
  // tracking active bolts; spawns bursts at random.
  "lightning-bolt": {
    draw: (g, params, token, elapsed, state) => {
      g.clear()
      const baseR = tokenRadius(token)
      const halfW = tokenHalfWidth(token) * (params.spread ?? 1)
      const halfH = tokenHalfHeight(token) * (params.spread ?? 1)
      const speed = params.speed ?? 1
      const masterAlpha = params.masterAlpha ?? 1
      const color = params.color ?? 0xCCEEFF

      if (!state.bolts) state.bolts = []
      if (state.lastSpawn === undefined) state.lastSpawn = -9999
      const spawnInterval = 200 / Math.max(0.3, params.intensity ?? 1) / speed

      // Spawn new bolts as the timer ticks past
      while (elapsed - state.lastSpawn >= spawnInterval) {
        state.lastSpawn += spawnInterval
        // Burst-spawn: 1-3 bolts at once with random offset
        const burstCount = 1 + Math.floor(Math.random() * 3)
        for (let i = 0; i < burstCount; i++) {
          const x = (Math.random() - 0.5) * 2 * halfW
          const y = (Math.random() - 0.5) * 2 * halfH
          const length = baseR * (0.4 + Math.random() * 0.7)
          const angle = Math.random() * TWO_PI
          state.bolts.push({
            x, y, length, angle,
            born: elapsed,
            life: 80 + Math.random() * 120,
            segments: makeBoltSegments(length)
          })
        }
      }

      // Render + cull
      for (let i = state.bolts.length - 1; i >= 0; i--) {
        const b = state.bolts[i]
        const age = elapsed - b.born
        if (age > b.life) {
          state.bolts.splice(i, 1)
          continue
        }
        const t = age / b.life
        const alpha = (1 - t) * masterAlpha
        // Outer glow stroke
        g.lineStyle(3, color, alpha * 0.4)
        renderBolt(g, b)
        // Inner sharp stroke
        g.lineStyle(1, 0xFFFFFF, alpha)
        renderBolt(g, b)
      }
      g.lineStyle(0)
    }
  },

  // Smoke-Puff: emits soft circles from the token base that drift
  // upward and grow while fading. Uses internal state for puff list.
  "smoke-puff": {
    draw: (g, params, token, elapsed, state) => {
      g.clear()
      const baseR = tokenRadius(token)
      const halfW = tokenHalfWidth(token) * (params.spreadX ?? 1)
      const baseY = tokenHalfHeight(token) * 0.7
      const speed = params.speed ?? 1
      const masterAlpha = params.masterAlpha ?? 1
      const color = params.color ?? 0x888888

      if (!state.puffs) state.puffs = []
      if (state.lastSpawn === undefined) state.lastSpawn = -9999
      const spawnInterval = 250 / Math.max(0.3, params.density ?? 1) / speed

      while (elapsed - state.lastSpawn >= spawnInterval) {
        state.lastSpawn += spawnInterval
        state.puffs.push({
          x: (Math.random() - 0.5) * halfW * 1.4,
          y: baseY + (Math.random() - 0.5) * baseR * 0.2,
          baseSize: baseR * (0.15 + Math.random() * 0.15) * (params.size ?? 1),
          vy: -(0.04 + Math.random() * 0.04) * speed,
          vx: (Math.random() - 0.5) * 0.015,
          born: elapsed,
          life: 1500 + Math.random() * 1000
        })
      }

      for (let i = state.puffs.length - 1; i >= 0; i--) {
        const p = state.puffs[i]
        const age = elapsed - p.born
        if (age > p.life) {
          state.puffs.splice(i, 1)
          continue
        }
        const t = age / p.life
        const cx = p.x + p.vx * age
        const cy = p.y + p.vy * age
        const size = p.baseSize * (1 + t * 1.2)
        const alpha = Math.max(0, (t < 0.2 ? t / 0.2 : 1 - t) * 0.6 * masterAlpha)
        // Two-layer soft blob
        g.beginFill(color, alpha * 0.4)
        g.drawCircle(cx, cy, size)
        g.endFill()
        g.beginFill(color, alpha * 0.7)
        g.drawCircle(cx, cy, size * 0.55)
        g.endFill()
      }
    }
  },

  // Spotlight: soft radial glow at the token base. Uses concentric
  // circles to fake a radial gradient (PIXI v7 has no native gradient
  // fill on Graphics).
  "spotlight": {
    draw: (g, params, token, elapsed) => {
      g.clear()
      const baseR = tokenRadius(token)
      const radius = baseR * (params.radius ?? 1.2)
      const cy = tokenHalfHeight(token) * (params.offsetY ?? 0.7)
      const speed = params.speed ?? 1
      // Gentle breath-in/out
      const pulse = 1 + 0.06 * Math.sin(elapsed * 0.0015 * speed)
      const r = radius * pulse
      const masterAlpha = params.masterAlpha ?? 1
      const color = params.color ?? 0xFFE9A8
      const layers = [
        { mul: 1.0,  a: 0.10 },
        { mul: 0.75, a: 0.18 },
        { mul: 0.50, a: 0.30 },
        { mul: 0.25, a: 0.50 }
      ]
      for (const L of layers) {
        g.beginFill(color, L.a * masterAlpha)
        g.drawCircle(0, cy, r * L.mul)
        g.endFill()
      }
    }
  },

  // Magic-Circle: outline polygon at token base (4 variants chosen
  // via the `variant` slider: 0=triangle, 1=pentagram, 2=hexagram,
  // 3=octagram). Includes a slowly rotating outer ring.
  "magic-circle": {
    draw: (g, params, token, elapsed) => {
      g.clear()
      const baseR = tokenRadius(token)
      const radius = baseR * (params.radius ?? 1)
      const cy = tokenHalfHeight(token) * (params.offsetY ?? 0.7)
      const speed = params.speed ?? 1
      const masterAlpha = params.masterAlpha ?? 1
      const color = params.color ?? 0xC78BFF
      const variant = Math.max(0, Math.min(3, Math.round(params.variant ?? 1)))
      const rot = elapsed * 0.0003 * speed
      // Outer ring
      g.lineStyle(2, color, 0.4 * masterAlpha)
      g.drawCircle(0, cy, radius)
      // Inner ring
      g.lineStyle(1, color, 0.6 * masterAlpha)
      g.drawCircle(0, cy, radius * 0.78)
      // Polygon shape
      g.lineStyle(2, color, 0.85 * masterAlpha)
      const points = (variant === 0) ? 3 : (variant === 1) ? 5 : (variant === 2) ? 6 : 8
      // Pentagram skip-pattern for 5-points; otherwise simple polygon
      if (variant === 1) {
        const verts = []
        for (let i = 0; i < points; i++) {
          const a = -Math.PI / 2 + i * (TWO_PI / points) + rot
          verts.push({ x: Math.cos(a) * radius * 0.78, y: cy + Math.sin(a) * radius * 0.78 })
        }
        const order = [0, 2, 4, 1, 3, 0]
        g.moveTo(verts[order[0]].x, verts[order[0]].y)
        for (let i = 1; i < order.length; i++) g.lineTo(verts[order[i]].x, verts[order[i]].y)
      } else {
        for (let i = 0; i <= points; i++) {
          const a = -Math.PI / 2 + i * (TWO_PI / points) + rot
          const x = Math.cos(a) * radius * 0.78
          const y = cy + Math.sin(a) * radius * 0.78
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
        }
      }
      g.lineStyle(0)
      // Small glyphs at vertices
      g.beginFill(color, 0.7 * masterAlpha)
      for (let i = 0; i < points; i++) {
        const a = -Math.PI / 2 + i * (TWO_PI / points) - rot * 1.5
        g.drawCircle(Math.cos(a) * radius * 0.95, cy + Math.sin(a) * radius * 0.95, 2)
      }
      g.endFill()
    }
  },

  // Energy-Beams: thin radial beams from token center, rotating
  // and pulsing in alpha. Reads as "channeling power".
  "energy-beams": {
    draw: (g, params, token, elapsed) => {
      g.clear()
      const baseR = tokenRadius(token)
      const reach = baseR * (params.reach ?? 1.4)
      const speed = params.speed ?? 1
      const masterAlpha = params.masterAlpha ?? 1
      const color = params.color ?? 0xFFD86B
      const beamCount = Math.max(2, Math.floor(params.beams ?? 8))
      const rot = elapsed * 0.0008 * speed
      const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(elapsed * 0.003 * speed))
      // Outer soft glow
      g.lineStyle(3, color, 0.25 * masterAlpha * pulse)
      for (let i = 0; i < beamCount; i++) {
        const a = (i / beamCount) * TWO_PI + rot
        g.moveTo(0, 0)
        g.lineTo(Math.cos(a) * reach, Math.sin(a) * reach)
      }
      // Inner bright stroke
      g.lineStyle(1.2, 0xFFFFFF, 0.85 * masterAlpha * pulse)
      for (let i = 0; i < beamCount; i++) {
        const a = (i / beamCount) * TWO_PI + rot
        g.moveTo(0, 0)
        g.lineTo(Math.cos(a) * reach, Math.sin(a) * reach)
      }
      g.lineStyle(0)
    }
  },

  // Pulse-Beat: heartbeat-rhythm rings — two quick pulses, then a
  // pause. Cycle period configurable.
  "pulse-beat": {
    draw: (g, params, token, elapsed) => {
      g.clear()
      const baseR = tokenRadius(token)
      const reach = baseR * (params.reach ?? 1.5)
      const masterAlpha = params.masterAlpha ?? 1
      const color = params.color ?? 0xFF4477
      const speed = params.speed ?? 1
      // Heartbeat: 1.2 s cycle by default, with two pulses 0.25 s apart
      // and a long pause. Each pulse expands from 0 to reach.
      const cycle = 1200 / speed
      const phase = (elapsed % cycle) / cycle  // 0..1
      const pulses = [
        { start: 0.00, dur: 0.20 },
        { start: 0.18, dur: 0.20 }
      ]
      const thickness = (params.thickness ?? 0.04) * baseR
      for (const pulse of pulses) {
        if (phase < pulse.start || phase > pulse.start + pulse.dur) continue
        const t = (phase - pulse.start) / pulse.dur
        const r = reach * t
        const alpha = (1 - t) * masterAlpha
        if (alpha <= 0.01) continue
        g.lineStyle(thickness * (1 - t * 0.4), color, alpha)
        g.drawCircle(0, 0, r)
      }
      g.lineStyle(0)
    }
  }
}

/** Generate a jagged polyline along a base direction, mid-point
 *  perturbed to give the lightning-bolt its "zig-zag" character. */
function makeBoltSegments(length) {
  const segments = 6
  const out = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const baseX = (t - 0.5) * length
    const jitter = (i === 0 || i === segments) ? 0 : (Math.random() - 0.5) * length * 0.25
    out.push({ x: baseX, y: jitter })
  }
  return out
}

function renderBolt(g, bolt) {
  const cosA = Math.cos(bolt.angle)
  const sinA = Math.sin(bolt.angle)
  for (let i = 0; i < bolt.segments.length; i++) {
    const s = bolt.segments[i]
    const wx = bolt.x + s.x * cosA - s.y * sinA
    const wy = bolt.y + s.x * sinA + s.y * cosA
    if (i === 0) g.moveTo(wx, wy)
    else g.lineTo(wx, wy)
  }
}
