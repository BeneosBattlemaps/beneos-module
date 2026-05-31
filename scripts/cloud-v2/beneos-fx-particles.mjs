// Beneos FX — Particle-Engine.
//
// Sprite-based particle systems mounted as PIXI.Container children
// of token.mesh. Each system self-registers with canvas.app.ticker
// for per-frame spawn-loop + motion update, and self-unsubscribes
// in destroy(). The container carries a `beneosFxId` so
// BeneosFXEngine.clearForToken can find and destroy it as a unit.
//
// All sprite shapes are drawn via PIXI.Graphics — no external
// asset files. PIXI batches Graphics with the same draw-pattern
// efficiently on the GPU.
//
// Foundry V13/V14: token.mesh has anchor (0.5, 0.5), so local
// coords (0, 0) is the token center. Token width/height available
// via `token.w` / `token.h`.

import { tokenHalfWidth, tokenHalfHeight, tokenRadius } from "./beneos-fx-geometry.mjs"

const TWO_PI = Math.PI * 2

/**
 * Effective spawn half-extents per axis, scaled by user-controlled
 * spread. Backward-compat: a single `area` param maps to spreadX
 * (so old saved configs keep working). spreadX/spreadY default
 * to 1 unless the type-def's own defaults override them.
 */
function spreadX(params) { return params?.spreadX ?? params?.area ?? 1 }
function spreadY(params) { return params?.spreadY ?? 1 }
function tokenSpawnHalfWidth(token, params)  { return tokenHalfWidth(token)  * spreadX(params) }
function tokenSpawnHalfHeight(token, params) { return tokenHalfHeight(token) * spreadY(params) }

export class BeneosParticleSystem {
  // Global registry of all live systems. Lets us find and destroy
  // systems even after their token.mesh has been re-created by
  // Foundry (which orphans the mesh.children-based lookup but
  // leaves the system's ticker-listener still subscribed —
  // a memory-leak source if not tracked separately).
  static instances = new Set()
  static MAX_INSTANCES = 30

  constructor(typeKey, params, token, fxId) {
    this.beneosFxId = fxId
    this.token = token
    this.typeKey = typeKey
    this.params = params
    this.particles = []
    this.spawnAccum = 0
    this.elapsed = 0
    this.destroyed = false
    this.behind = (params?.behindToken ?? 0) >= 0.5
    this.container = new PIXI.Container()
    this.container.beneosFxId = fxId
    this.container.beneosParticleSystem = this
    // Mount-Switch: behindToken=0 → above token (children of mesh).
    // behindToken=1 → below token (insert into token-container before
    // the mesh-child). For "behind" mounting we have to translate
    // local coords because token.mesh has anchor (0.5,0.5) but the
    // token-container's origin is top-left.
    if (this.behind && token?.children) {
      const meshIdx = token.children.indexOf(token.mesh)
      const insertAt = (meshIdx >= 0) ? meshIdx : 0
      token.addChildAt(this.container, insertAt)
      this.container.x = (token.w ?? 0) / 2
      this.container.y = (token.h ?? 0) / 2
    } else if (token?.mesh) {
      token.mesh.addChild(this.container)
    }
    this._tickBound = this._tick.bind(this)
    if (canvas?.app?.ticker) canvas.app.ticker.add(this._tickBound)
    BeneosParticleSystem.instances.add(this)
    // Notbremse: oldest-first eviction if the registry exceeds the
    // global cap. Indicates a leak somewhere; warn once.
    if (BeneosParticleSystem.instances.size > BeneosParticleSystem.MAX_INSTANCES) {
      const oldest = BeneosParticleSystem.instances.values().next().value
      if (oldest && oldest !== this) {
        console.warn("[Beneos FX] particle-system cap reached — evicting oldest")
        oldest.destroy()
      }
    }
  }

  applyParams(params) { this.params = params }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    BeneosParticleSystem.instances.delete(this)
    if (canvas?.app?.ticker) canvas.app.ticker.remove(this._tickBound)
    if (this.container && !this.container.destroyed) {
      this.container.destroy({ children: true })
    }
    this.particles = []
  }

  /** Destroy every system whose token matches. Called from
   *  BeneosFXEngine.clearForToken so cleanup works even after
   *  Foundry has re-created token.mesh. */
  static unregisterByToken(token) {
    if (!token) return
    for (const sys of [...BeneosParticleSystem.instances]) {
      if (sys.token === token) sys.destroy()
    }
  }

  /** Find a live system on this token by its fxId. Used for
   *  idempotent applyForToken — if a system already exists,
   *  applyParams() is enough; no need to construct a duplicate. */
  static findOnToken(token, fxId) {
    for (const sys of BeneosParticleSystem.instances) {
      if (sys.token === token && sys.beneosFxId === fxId) return sys
    }
    return null
  }

  /** Last-resort full sweep, e.g. on canvas-tear-down. */
  static destroyAll() {
    for (const sys of [...BeneosParticleSystem.instances]) sys.destroy()
  }

  _tick(ticker) {
    // Hard guard: any throw inside here would propagate up into
    // canvas.app.ticker, abort its run-loop, and freeze the canvas
    // (zoom + pan break). We swallow + self-destruct on repeated
    // failure so a single broken effect can't take the scene down.
    try {
      const dt = ticker?.deltaMS ?? 16
      this.elapsed += dt
      // CRITICAL: self-destruct if our container or token has been
      // torn down. Without this the ticker-listener leaks forever
      // and accumulates across Foundry's frequent mesh-recreation
      // events — the source of the ERR_INSUFFICIENT_RESOURCES
      // memory exhaustion in user testing.
      if (!this.container || this.container.destroyed
          || !this.container.parent || !this.token) {
        this.destroy()
        return
      }
      // Mount-mode-specific liveness check. Behind-mode mounts on
      // the token-container directly, so we don't need a live mesh.
      if (!this.behind && !this.token.mesh) {
        this.destroy()
        return
      }
      const def = PARTICLE_DEFS[this.typeKey]
      if (!def) return
      this.spawnAccum += dt
      const spawnInterval = def.spawnInterval(this.params)
      while (this.spawnAccum >= spawnInterval && this.particles.length < def.maxCount(this.params)) {
        this.spawnAccum -= spawnInterval
        const p = def.spawn(this.params, this.token, this.elapsed)
        if (p?.sprite) {
          this.container.addChild(p.sprite)
          this.particles.push(p)
        }
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i]
        def.update(p, this.params, dt, this.elapsed)
        if (p.life >= p.maxLife) {
          if (p.sprite && !p.sprite.destroyed) p.sprite.destroy()
          this.particles.splice(i, 1)
        }
      }
    } catch (err) {
      this._errorCount = (this._errorCount || 0) + 1
      if (this._errorCount === 1) {
        console.warn("[Beneos FX] particle tick failed:", this.typeKey, err)
      }
      if (this._errorCount > 5) {
        console.warn("[Beneos FX] particle system disabled after repeated errors:", this.typeKey)
        this.destroy()
      }
    }
  }
}

/**
 * Build a soft "glow circle" via a multi-layer gradient effect using
 * concentric circles with decreasing alpha. PIXI v8 doesn't support
 * native radial-gradient fills on Graphics, so this is the practical
 * approximation. Layers are flat-shaded → still GPU-batchable.
 */
function drawGlowCircle(g, radius, color, coreAlpha = 1) {
  // 4 concentric circles, outer to inner, increasing alpha. Uses
  // the PIXI v7 chain (beginFill/drawCircle/endFill) since Foundry
  // V13/V14 ships PIXI v7. The v8 chain (.circle().fill({...}))
  // would throw "g.circle is not a function".
  const layers = [
    { r: radius * 1.0, a: coreAlpha * 0.15 },
    { r: radius * 0.7, a: coreAlpha * 0.30 },
    { r: radius * 0.4, a: coreAlpha * 0.55 },
    { r: radius * 0.2, a: coreAlpha * 1.00 }
  ]
  for (const L of layers) {
    g.beginFill(color, L.a)
    g.drawCircle(0, 0, L.r)
    g.endFill()
  }
}

function drawSnowflake(g, radius, color) {
  // White soft circle for simplicity — readable at small sizes.
  drawGlowCircle(g, radius, color, 0.9)
}

/** Five-pointed star outline filled with a soft warm core. */
function drawStar(g, radius, color, points = 5) {
  const step = TWO_PI / (points * 2)
  const inner = radius * 0.45
  g.beginFill(color, 0.95)
  for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 === 0) ? radius : inner
    const a = -Math.PI / 2 + i * step
    const px = Math.cos(a) * r
    const py = Math.sin(a) * r
    if (i === 0) g.moveTo(px, py)
    else g.lineTo(px, py)
  }
  g.closePath()
  g.endFill()
  // Bright inner core for the twinkle highlight
  g.beginFill(0xFFFFFF, 0.7)
  g.drawCircle(0, 0, radius * 0.25)
  g.endFill()
}

/** Thin straight line spark — sharp ends, used for lightning-spark. */
function drawSparkLine(g, length, color) {
  g.lineStyle(2, color, 1)
  g.moveTo(-length / 2, 0)
  g.lineTo( length / 2, 0)
  g.lineStyle(0)
  // Bright center dot for added punch
  g.beginFill(0xFFFFFF, 0.9)
  g.drawCircle(0, 0, 1.2)
  g.endFill()
}

/** Thin vertical light ray with bright top and fading tail. */
function drawRayLine(g, length, color) {
  // Multi-line stack for soft glow
  g.lineStyle(3, color, 0.25)
  g.moveTo(0, length / 2); g.lineTo(0, -length / 2)
  g.lineStyle(1.5, color, 0.6)
  g.moveTo(0, length / 2); g.lineTo(0, -length / 2)
  g.lineStyle(0)
  g.beginFill(0xFFFFFF, 0.9)
  g.drawCircle(0, -length / 2, 1.5)
  g.endFill()
}

/** Soft bubble: outline circle with a small highlight. */
function drawBubble(g, radius, color) {
  g.lineStyle(1.5, color, 0.85)
  g.drawCircle(0, 0, radius)
  g.lineStyle(0)
  // Highlight blob (top-left)
  g.beginFill(0xFFFFFF, 0.7)
  g.drawCircle(-radius * 0.35, -radius * 0.35, radius * 0.18)
  g.endFill()
}

/**
 * Geometric rune symbol — 3 variants by `kind` (0=triangle,
 * 1=pentagram, 2=hexagram). Drawn as outline with bright fill.
 */
function drawRune(g, radius, color, kind = 0) {
  g.lineStyle(1.5, color, 0.9)
  if (kind === 0) {
    // Equilateral triangle
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * (TWO_PI / 3)
      const x = Math.cos(a) * radius, y = Math.sin(a) * radius
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
    }
    const ax = Math.cos(-Math.PI / 2) * radius, ay = Math.sin(-Math.PI / 2) * radius
    g.lineTo(ax, ay)
  } else if (kind === 1) {
    // Pentagram (5-point star, every-other connection)
    const pts = []
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * (TWO_PI / 5)
      pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius })
    }
    g.moveTo(pts[0].x, pts[0].y)
    g.lineTo(pts[2].x, pts[2].y)
    g.lineTo(pts[4].x, pts[4].y)
    g.lineTo(pts[1].x, pts[1].y)
    g.lineTo(pts[3].x, pts[3].y)
    g.lineTo(pts[0].x, pts[0].y)
  } else {
    // Hexagram (two overlapping triangles)
    for (let tri = 0; tri < 2; tri++) {
      const offset = tri === 0 ? 0 : Math.PI
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + offset + i * (TWO_PI / 3)
        const x = Math.cos(a) * radius, y = Math.sin(a) * radius
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      const ax = Math.cos(-Math.PI / 2 + offset) * radius
      const ay = Math.sin(-Math.PI / 2 + offset) * radius
      g.lineTo(ax, ay)
    }
  }
  g.lineStyle(0)
  // Bright glow at center
  g.beginFill(color, 0.4)
  g.drawCircle(0, 0, radius * 0.2)
  g.endFill()
}

/**
 * Stylized leaf — pointed ellipse with a center vein.
 */
function drawLeaf(g, size, color) {
  g.beginFill(color, 0.85)
  g.drawEllipse(0, 0, size * 0.4, size)
  g.endFill()
  // Center vein
  g.lineStyle(1, 0x4A2A0A, 0.6)
  g.moveTo(0, -size); g.lineTo(0, size)
  g.lineStyle(0)
}

/**
 * Flame sprite — vertical teardrop shape with hot core.
 * (Approximated via stacked circles for soft edge.)
 */
function drawFlameSprite(g, size, color, hotColor = 0xFFEE66) {
  // Outer warm body
  g.beginFill(color, 0.55)
  g.drawEllipse(0, 0, size * 0.6, size)
  g.endFill()
  // Mid body
  g.beginFill(color, 0.8)
  g.drawEllipse(0, size * 0.1, size * 0.4, size * 0.75)
  g.endFill()
  // Hot core
  g.beginFill(hotColor, 0.95)
  g.drawEllipse(0, size * 0.2, size * 0.22, size * 0.5)
  g.endFill()
}

/**
 * Comic-style stink-line — short vertical zig-zag.
 */
function drawZigZagLine(g, length, color) {
  const segments = 4
  const w = length * 0.25
  g.lineStyle(2, color, 0.85)
  for (let i = 0; i <= segments; i++) {
    const y = -length / 2 + (i / segments) * length
    const x = (i % 2 === 0 ? -w : w) * 0.5
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
  }
  g.lineStyle(0)
}

const PARTICLE_DEFS = {

  // Sparkles orbit the token at a stable radius, twinkle on/off,
  // and slowly rotate around the center.
  "sparkle-orbit": {
    spawnInterval: (p) => Math.max(50, 2000 / Math.max(1, p.count ?? 8)),
    maxCount: (p) => Math.max(2, Math.floor(p.count ?? 8)),
    spawn: (params, token, elapsed) => {
      const sprite = new PIXI.Graphics()
      // Sprite size scales with token, NOT with spread — spread only
      // controls spawn-distribution, never particle size.
      const size = (params.size ?? 0.08) * tokenRadius(token)
      drawGlowCircle(sprite, size, params.color ?? 0xFFEEAA, 1)
      const angle = Math.random() * TWO_PI
      // Elliptical orbit using both axes — supports rectangular
      // tokens cleanly (orbit becomes an ellipse instead of a
      // squashed circle).
      const rx = tokenSpawnHalfWidth(token, params)  * (0.85 + Math.random() * 0.25)
      const ry = tokenSpawnHalfHeight(token, params) * (0.85 + Math.random() * 0.25)
      const angularSpeed = (params.speed ?? 1) * 0.0008 * (Math.random() < 0.5 ? -1 : 1)
      return {
        sprite,
        life: 0,
        maxLife: 9999999,        // perma-orbit
        angle,
        rx,
        ry,
        angularSpeed,
        twinklePhase: Math.random() * TWO_PI,
        twinkleSpeed: 0.003 + Math.random() * 0.005
      }
    },
    update: (p, params, dt) => {
      p.angle += p.angularSpeed * dt
      p.sprite.x = Math.cos(p.angle) * p.rx
      p.sprite.y = Math.sin(p.angle) * p.ry
      p.twinklePhase += p.twinkleSpeed * dt
      const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(p.twinklePhase))
      p.sprite.alpha = tw * (params.masterAlpha ?? 1)
    }
  },

  // Embers spawn at the token base, rise with horizontal drift,
  // fade out near the top of the token.
  "embers-rise": {
    spawnInterval: (p) => Math.max(40, 200 / Math.max(0.5, p.density ?? 1)),
    maxCount: (p) => Math.floor(40 * (p.density ?? 1)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const baseR = tokenRadius(token)
      const halfW = tokenSpawnHalfWidth(token, params)
      const halfH = tokenSpawnHalfHeight(token, params)
      const size = (params.size ?? 0.06) * baseR * (0.5 + Math.random() * 0.8)
      // Random warm color: red → orange → yellow weighted to orange
      const colorPick = Math.random()
      const color = colorPick < 0.3 ? 0xFF4422
                  : colorPick < 0.7 ? (params.color ?? 0xFF8833)
                  :                   0xFFEE66
      drawGlowCircle(sprite, size, color, 1)
      // Full-width X spawn. Y is anchored at the token base and
      // optionally jittered upward by spreadY (0 = strict bottom
      // line — classic look — up to a full token-height fountain).
      sprite.x = (Math.random() - 0.5) * 2 * halfW
      const baseY = tokenHalfHeight(token) * 0.75
      sprite.y = baseY - Math.random() * halfH
      return {
        sprite,
        life: 0,
        maxLife: 1500 + Math.random() * 800,
        vy: -(0.04 + Math.random() * 0.06) * (params.speed ?? 1),  // negative = up
        vx: (Math.random() - 0.5) * 0.02,
        baseSize: size
      }
    },
    update: (p, params, dt) => {
      p.life += dt
      p.sprite.x += p.vx * dt
      p.sprite.y += p.vy * dt
      // Slight horizontal sway
      p.sprite.x += Math.sin(p.life * 0.005) * 0.05
      // Fade out across lifetime
      const t = p.life / p.maxLife
      p.sprite.alpha = (1 - t * t) * (params.masterAlpha ?? 1)
      // Shrink late
      const shrink = t < 0.7 ? 1 : (1 - (t - 0.7) / 0.3)
      p.sprite.scale.set(shrink, shrink)
    }
  },

  // Snow falls from above the token, with sin-wobble and slow spin.
  "snow-fall": {
    spawnInterval: (p) => Math.max(80, 250 / Math.max(0.5, p.density ?? 1)),
    maxCount: (p) => Math.floor(35 * (p.density ?? 1)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const baseR = tokenRadius(token)
      const halfW = tokenSpawnHalfWidth(token, params)
      const halfH = tokenSpawnHalfHeight(token, params)
      const size = (params.size ?? 0.05) * baseR * (0.6 + Math.random() * 0.7)
      drawSnowflake(sprite, size, params.color ?? 0xFFFFFF)
      // X spawn full token-width (slight overhang). Y anchored above
      // the token; spreadY pushes the start-line down inside the
      // token for a snow-cloud-volume effect.
      sprite.x = (Math.random() - 0.5) * halfW * 2.2
      const baseY = -tokenHalfHeight(token) * 1.1
      sprite.y = baseY + Math.random() * halfH
      return {
        sprite,
        life: 0,
        maxLife: 2500 + Math.random() * 1200,
        vy: (0.03 + Math.random() * 0.04) * (params.speed ?? 1),
        wobbleAmp: 0.5 + Math.random() * 1,
        wobblePhase: Math.random() * TWO_PI,
        spin: (Math.random() - 0.5) * 0.002,
        baseX: sprite.x
      }
    },
    update: (p, params, dt) => {
      p.life += dt
      p.sprite.y += p.vy * dt
      p.wobblePhase += 0.002 * dt
      p.sprite.x = p.baseX + Math.sin(p.wobblePhase) * p.wobbleAmp * 8
      p.sprite.rotation += p.spin * dt
      // Fade in early, fade out at end
      const t = p.life / p.maxLife
      const fade = t < 0.1 ? t / 0.1 : (t > 0.85 ? (1 - t) / 0.15 : 1)
      p.sprite.alpha = fade * (params.masterAlpha ?? 1)
    }
  },

  // Magic-Stars orbit the token in a 2D ellipse with twinkle +
  // scale-pulse. Visually richer than sparkles thanks to the
  // star-shape and the slow scale oscillation.
  "magic-stars": {
    spawnInterval: (p) => Math.max(60, 2200 / Math.max(1, p.count ?? 6)),
    maxCount: (p) => Math.max(2, Math.floor(p.count ?? 6)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const size = (params.size ?? 0.1) * tokenRadius(token)
      drawStar(sprite, size, params.color ?? 0xFFE066)
      const angle = Math.random() * TWO_PI
      const rx = tokenSpawnHalfWidth(token, params)  * (0.8 + Math.random() * 0.3)
      const ry = tokenSpawnHalfHeight(token, params) * (0.8 + Math.random() * 0.3)
      const angularSpeed = (params.speed ?? 1) * 0.0006 * (Math.random() < 0.5 ? -1 : 1)
      return {
        sprite, life: 0, maxLife: 9999999,
        angle, rx, ry, angularSpeed,
        twinklePhase: Math.random() * TWO_PI,
        twinkleSpeed: 0.002 + Math.random() * 0.004,
        scalePhase: Math.random() * TWO_PI
      }
    },
    update: (p, params, dt) => {
      p.angle += p.angularSpeed * dt
      p.sprite.x = Math.cos(p.angle) * p.rx
      p.sprite.y = Math.sin(p.angle) * p.ry
      p.twinklePhase += p.twinkleSpeed * dt
      const tw = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(p.twinklePhase))
      p.sprite.alpha = tw * (params.masterAlpha ?? 1)
      p.scalePhase += 0.0015 * dt
      const sc = 0.85 + 0.3 * (0.5 + 0.5 * Math.sin(p.scalePhase))
      p.sprite.scale.set(sc, sc)
      p.sprite.rotation += 0.0008 * dt
    }
  },

  // Frost-Cloud emits large soft cyan circles in bursts that drift
  // outward and slowly fade. Reads as a chilled vapor cloud.
  "frost-cloud": {
    spawnInterval: (p) => Math.max(120, 600 / Math.max(0.3, p.density ?? 1)),
    maxCount: (p) => Math.floor(20 * (p.density ?? 1)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const baseR = tokenRadius(token)
      const halfW = tokenSpawnHalfWidth(token, params)
      const halfH = tokenSpawnHalfHeight(token, params)
      const size = (params.size ?? 0.18) * baseR * (0.7 + Math.random() * 0.7)
      drawGlowCircle(sprite, size, params.color ?? 0xB8E6FF, 0.6)
      sprite.x = (Math.random() - 0.5) * 2 * halfW
      sprite.y = (Math.random() - 0.5) * 2 * halfH
      // Outward drift away from token center, with slight randomness.
      const angle = Math.atan2(sprite.y, sprite.x || 0.001) + (Math.random() - 0.5) * 0.5
      const driftSpeed = 0.02 + Math.random() * 0.025
      return {
        sprite, life: 0,
        maxLife: 1800 + Math.random() * 1000,
        vx: Math.cos(angle) * driftSpeed * (params.speed ?? 1),
        vy: Math.sin(angle) * driftSpeed * (params.speed ?? 1),
        baseSize: size
      }
    },
    update: (p, params, dt) => {
      p.life += dt
      p.sprite.x += p.vx * dt
      p.sprite.y += p.vy * dt
      const t = p.life / p.maxLife
      // Fade in fast, fade out slow
      const fade = t < 0.15 ? t / 0.15 : (1 - t)
      p.sprite.alpha = Math.max(0, fade) * 0.7 * (params.masterAlpha ?? 1)
      // Slight expansion across lifetime
      const sc = 1 + t * 0.4
      p.sprite.scale.set(sc, sc)
    }
  },

  // Lightning-Spark spawns short straight spark-lines randomly
  // around the token in tight bursts, each with a very short
  // lifespan so they read as discrete electric pops, not a steady
  // glow. Self-flickering via random alpha-cuts.
  "lightning-spark": {
    spawnInterval: (p) => Math.max(30, 150 / Math.max(0.3, p.density ?? 1)),
    maxCount: (p) => Math.floor(25 * (p.density ?? 1)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const baseR = tokenRadius(token)
      const halfW = tokenSpawnHalfWidth(token, params)
      const halfH = tokenSpawnHalfHeight(token, params)
      const length = (params.size ?? 0.12) * baseR * (0.6 + Math.random() * 0.9)
      drawSparkLine(sprite, length, params.color ?? 0xCCEEFF)
      sprite.x = (Math.random() - 0.5) * 2 * halfW
      sprite.y = (Math.random() - 0.5) * 2 * halfH
      sprite.rotation = Math.random() * TWO_PI
      return {
        sprite, life: 0,
        maxLife: 100 + Math.random() * 150,
        flickerPhase: Math.random() * TWO_PI
      }
    },
    update: (p, params, dt) => {
      p.life += dt
      const t = p.life / p.maxLife
      // Hard-cut flicker: alternates between visible and invisible
      // every few frames, simulating electric arcing.
      p.flickerPhase += 0.05 * dt
      const visible = Math.sin(p.flickerPhase) > 0
      const fade = 1 - t
      p.sprite.alpha = (visible ? fade : 0) * (params.masterAlpha ?? 1)
    }
  },

  // Holy-Rays: thin vertical light pillars rising from the token.
  "holy-rays": {
    spawnInterval: (p) => Math.max(80, 300 / Math.max(0.3, p.density ?? 1)),
    maxCount: (p) => Math.floor(20 * (p.density ?? 1)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const baseR = tokenRadius(token)
      const halfW = tokenSpawnHalfWidth(token, params)
      const length = baseR * (0.4 + Math.random() * 0.4) * (params.size ?? 1)
      drawRayLine(sprite, length, params.color ?? 0xFFEEAA)
      sprite.x = (Math.random() - 0.5) * 2 * halfW
      const baseY = tokenHalfHeight(token) * 0.6
      sprite.y = baseY
      return {
        sprite, life: 0,
        maxLife: 1200 + Math.random() * 600,
        vy: -(0.05 + Math.random() * 0.05) * (params.speed ?? 1)
      }
    },
    update: (p, params, dt) => {
      p.life += dt
      p.sprite.y += p.vy * dt
      const t = p.life / p.maxLife
      const fade = t < 0.2 ? t / 0.2 : (1 - t)
      p.sprite.alpha = Math.max(0, fade) * (params.masterAlpha ?? 1)
    }
  },

  // Bubble-Stream: rising bubbles from the token base, slight wobble,
  // pop (rapid alpha fade) at the top.
  "bubble-stream": {
    spawnInterval: (p) => Math.max(80, 250 / Math.max(0.3, p.density ?? 1)),
    maxCount: (p) => Math.floor(25 * (p.density ?? 1)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const baseR = tokenRadius(token)
      const halfW = tokenSpawnHalfWidth(token, params)
      const size = baseR * (0.04 + Math.random() * 0.05) * (params.size ?? 1)
      drawBubble(sprite, size, params.color ?? 0xAEDFFF)
      sprite.x = (Math.random() - 0.5) * 2 * halfW
      sprite.y = tokenHalfHeight(token) * 0.6
      return {
        sprite, life: 0,
        maxLife: 1500 + Math.random() * 800,
        vy: -(0.04 + Math.random() * 0.05) * (params.speed ?? 1),
        wobblePhase: Math.random() * TWO_PI,
        baseX: sprite.x
      }
    },
    update: (p, params, dt) => {
      p.life += dt
      p.sprite.y += p.vy * dt
      p.wobblePhase += 0.003 * dt
      p.sprite.x = p.baseX + Math.sin(p.wobblePhase) * 4
      const t = p.life / p.maxLife
      // Pop at end: very fast fade in last 15%
      const fade = t < 0.1 ? t / 0.1 : (t > 0.85 ? (1 - t) / 0.15 : 1)
      p.sprite.alpha = Math.max(0, fade) * (params.masterAlpha ?? 1)
    }
  },

  // Magic-Runes: 3 rune-variants orbiting around the token,
  // slow rotation around their own center.
  "magic-runes": {
    spawnInterval: (p) => Math.max(80, 2500 / Math.max(1, p.count ?? 5)),
    maxCount: (p) => Math.max(2, Math.floor(p.count ?? 5)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const size = (params.size ?? 0.12) * tokenRadius(token)
      const kind = Math.floor(Math.random() * 3)
      drawRune(sprite, size, params.color ?? 0xC78BFF, kind)
      const angle = Math.random() * TWO_PI
      const rx = tokenSpawnHalfWidth(token, params)  * (0.85 + Math.random() * 0.3)
      const ry = tokenSpawnHalfHeight(token, params) * (0.85 + Math.random() * 0.3)
      const angularSpeed = (params.speed ?? 1) * 0.0005 * (Math.random() < 0.5 ? -1 : 1)
      return {
        sprite, life: 0, maxLife: 9999999,
        angle, rx, ry, angularSpeed,
        spinSpeed: (Math.random() - 0.5) * 0.001
      }
    },
    update: (p, params, dt) => {
      p.angle += p.angularSpeed * dt
      p.sprite.x = Math.cos(p.angle) * p.rx
      p.sprite.y = Math.sin(p.angle) * p.ry
      p.sprite.rotation += p.spinSpeed * dt
      p.sprite.alpha = (params.masterAlpha ?? 1)
    }
  },

  // Falling-Leaves: leaves drift down with sin-wobble + spin.
  "falling-leaves": {
    spawnInterval: (p) => Math.max(150, 600 / Math.max(0.3, p.density ?? 1)),
    maxCount: (p) => Math.floor(20 * (p.density ?? 1)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const baseR = tokenRadius(token)
      const halfW = tokenSpawnHalfWidth(token, params)
      const size = (params.size ?? 0.08) * baseR * (0.7 + Math.random() * 0.5)
      // Earthy palette: green, yellow-green, brown
      const palette = [0x4A8B2A, 0x7AAE3F, 0xC78A2A, 0x8E5A1F]
      const color = (params.color !== undefined && Math.random() < 0.5)
                  ? params.color
                  : palette[Math.floor(Math.random() * palette.length)]
      drawLeaf(sprite, size, color)
      sprite.x = (Math.random() - 0.5) * halfW * 1.6
      sprite.y = -tokenHalfHeight(token) * 1.1
      return {
        sprite, life: 0,
        maxLife: 3000 + Math.random() * 1500,
        vy: (0.025 + Math.random() * 0.025) * (params.speed ?? 1),
        wobbleAmp: 4 + Math.random() * 8,
        wobblePhase: Math.random() * TWO_PI,
        spin: (Math.random() - 0.5) * 0.003,
        baseX: sprite.x
      }
    },
    update: (p, params, dt) => {
      p.life += dt
      p.sprite.y += p.vy * dt
      p.wobblePhase += 0.0015 * dt
      p.sprite.x = p.baseX + Math.sin(p.wobblePhase) * p.wobbleAmp
      p.sprite.rotation += p.spin * dt
      const t = p.life / p.maxLife
      const fade = t < 0.1 ? t / 0.1 : (t > 0.85 ? (1 - t) / 0.15 : 1)
      p.sprite.alpha = Math.max(0, fade) * (params.masterAlpha ?? 1)
    }
  },

  // Poison-Aura: large soft sickly-green clouds slowly drifting,
  // pulsing alpha — reads as "noxious miasma".
  "poison-aura": {
    spawnInterval: (p) => Math.max(150, 700 / Math.max(0.3, p.density ?? 1)),
    maxCount: (p) => Math.floor(15 * (p.density ?? 1)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const baseR = tokenRadius(token)
      const halfW = tokenSpawnHalfWidth(token, params)
      const halfH = tokenSpawnHalfHeight(token, params)
      const size = (params.size ?? 0.22) * baseR * (0.7 + Math.random() * 0.6)
      drawGlowCircle(sprite, size, params.color ?? 0x88DD44, 0.5)
      sprite.x = (Math.random() - 0.5) * 2 * halfW
      sprite.y = (Math.random() - 0.5) * 2 * halfH
      return {
        sprite, life: 0,
        maxLife: 2500 + Math.random() * 1500,
        vx: (Math.random() - 0.5) * 0.015 * (params.speed ?? 1),
        vy: -(0.005 + Math.random() * 0.015) * (params.speed ?? 1),
        pulsePhase: Math.random() * TWO_PI
      }
    },
    update: (p, params, dt) => {
      p.life += dt
      p.sprite.x += p.vx * dt
      p.sprite.y += p.vy * dt
      p.pulsePhase += 0.002 * dt
      const t = p.life / p.maxLife
      const fade = t < 0.2 ? t / 0.2 : (1 - t)
      const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(p.pulsePhase))
      p.sprite.alpha = Math.max(0, fade) * pulse * 0.7 * (params.masterAlpha ?? 1)
    }
  },

  // Stink-Cloud: comic-style zig-zag stink lines rising from the
  // token (classic "smelly" trope).
  "stink-cloud": {
    spawnInterval: (p) => Math.max(100, 400 / Math.max(0.3, p.density ?? 1)),
    maxCount: (p) => Math.floor(15 * (p.density ?? 1)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const baseR = tokenRadius(token)
      const halfW = tokenSpawnHalfWidth(token, params)
      const length = baseR * (0.2 + Math.random() * 0.2) * (params.size ?? 1)
      drawZigZagLine(sprite, length, params.color ?? 0x8FA84F)
      sprite.x = (Math.random() - 0.5) * 2 * halfW * 0.7
      sprite.y = tokenHalfHeight(token) * 0.5
      return {
        sprite, life: 0,
        maxLife: 1500 + Math.random() * 800,
        vy: -(0.04 + Math.random() * 0.04) * (params.speed ?? 1),
        wobblePhase: Math.random() * TWO_PI,
        baseX: sprite.x
      }
    },
    update: (p, params, dt) => {
      p.life += dt
      p.sprite.y += p.vy * dt
      p.wobblePhase += 0.004 * dt
      p.sprite.x = p.baseX + Math.sin(p.wobblePhase) * 3
      const t = p.life / p.maxLife
      const fade = t < 0.15 ? t / 0.15 : (1 - t)
      p.sprite.alpha = Math.max(0, fade) * 0.85 * (params.masterAlpha ?? 1)
    }
  },

  // Fire-Flames: vertical flame sprites rising from token base
  // with flicker (scale + alpha noise) for a real "burning" look.
  "fire-flames": {
    spawnInterval: (p) => Math.max(40, 180 / Math.max(0.3, p.density ?? 1)),
    maxCount: (p) => Math.floor(30 * (p.density ?? 1)),
    spawn: (params, token) => {
      const sprite = new PIXI.Graphics()
      const baseR = tokenRadius(token)
      const halfW = tokenSpawnHalfWidth(token, params)
      const size = (params.size ?? 0.15) * baseR * (0.7 + Math.random() * 0.7)
      drawFlameSprite(sprite, size, params.color ?? 0xFF6622)
      sprite.x = (Math.random() - 0.5) * 2 * halfW * 0.85
      sprite.y = tokenHalfHeight(token) * 0.6
      return {
        sprite, life: 0,
        maxLife: 800 + Math.random() * 600,
        vy: -(0.08 + Math.random() * 0.06) * (params.speed ?? 1),
        flickerPhase: Math.random() * TWO_PI,
        baseSize: 1
      }
    },
    update: (p, params, dt) => {
      p.life += dt
      p.sprite.y += p.vy * dt
      p.flickerPhase += 0.015 * dt
      const t = p.life / p.maxLife
      const fade = t < 0.15 ? t / 0.15 : (1 - t)
      const flicker = 0.85 + 0.3 * Math.sin(p.flickerPhase * 1.7)
      p.sprite.alpha = Math.max(0, fade) * (params.masterAlpha ?? 1)
      p.sprite.scale.set(flicker * (1 - t * 0.4), flicker * (1 - t * 0.4))
    }
  }
}
