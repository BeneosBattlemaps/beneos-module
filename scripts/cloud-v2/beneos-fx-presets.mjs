import { BeneosCustomFilter, LIGHTNING_ARC_FRAGMENT, MAGIC_AURA_FRAGMENT, hexToRGB } from "./beneos-fx-shaders.mjs"

// Stage 13c-Polish + Stage 13d-1: Beneos-FX-Type-Schema.
//
// Each entry defines a filter type the FX-Editor can offer:
//
//   - label / icon / description: UI metadata for the library
//   - pixiCtor: lazy lookup of the PIXI-Filter constructor (TMFX
//     bundles pixi-filters globally on init)
//   - animated + animator: when true, BeneosFXAnimator registers
//     the filter for per-frame updates via canvas.app.ticker
//   - defaults: initial param-values for new filter instances
//   - params: declarative parameter definitions (slider / color)
//     that the FX-Editor renders dynamically
//
//   - instantiate(Ctor, params): constructs the raw PIXI filter
//     instance(s). Stage 13d-1: this hook now ONLY does
//     constructor + non-param setup (distance, quality, etc.).
//     Param-driven property writes happen exclusively in
//     applyParams so live-slider-mutation has a single
//     source-of-truth.
//
//   - applyParams(filters, params): writes all param-driven
//     properties onto the existing filter instances. Called
//     both at initial-apply (right after instantiate) and on
//     every slider input-event for live mutation. NO setFlag,
//     NO re-instantiation — just property writes.

export const BENEOS_FX_TYPES = {

  "drop-shadow": {
    label: "Drop Shadow",
    icon: "fa-solid fa-clone",
    description: "Soft shadow under the token",
    pixiCtor: () => globalThis.PIXI?.filters?.DropShadowFilter,
    animated: false,
    defaults: {
      rotation: 45, distance: 5, color: 0x000000,
      alpha: 0.5, blur: 2, quality: 3, masterAlpha: 1
    },
    instantiate: (Ctor, params) => {
      // DropShadowFilter accepts an options-object directly. Object
      // is passed so PIXI sets up the right internal sub-filters
      // (drop-shadow needs a blur stage as part of construction).
      // Param-driven values are then overwritten in applyParams.
      return new Ctor({
        rotation: params.rotation, distance: params.distance,
        color: params.color, alpha: params.alpha,
        blur: params.blur, quality: params.quality
      })
    },
    applyParams: (filters, params) => {
      const f = filters[0]; if (!f) return
      f.rotation = params.rotation
      f.distance = params.distance
      f.color = params.color
      f.alpha = (params.alpha ?? 0.5) * (params.masterAlpha ?? 1)
      f.blur = params.blur
      f.quality = params.quality
    },
    params: [
      { name: "distance",    label: "Distance",    control: "slider", min: 0, max: 30, step: 0.5 },
      { name: "rotation",    label: "Rotation",    control: "slider", min: 0, max: 360, step: 5, unit: "°" },
      { name: "color",       label: "Color",       control: "color"  },
      { name: "alpha",       label: "Alpha",       control: "slider", min: 0, max: 1,  step: 0.05 },
      { name: "blur",        label: "Blur",        control: "slider", min: 0, max: 10, step: 0.5 },
      { name: "quality",     label: "Quality",     control: "slider", min: 1, max: 5,  step: 1   },
      { name: "masterAlpha", label: "Strength",    control: "slider", min: 0, max: 1,  step: 0.05 }
    ]
  },

  "glow-aura": {
    label: "Glow Aura",
    icon: "fa-solid fa-sun",
    description: "Soft colored glow around the token",
    pixiCtor: () => globalThis.PIXI?.filters?.GlowFilter,
    animated: false,
    defaults: {
      color: 0xFFFFAA, outerStrength: 4, innerStrength: 0,
      distance: 12, quality: 0.2, masterAlpha: 1
    },
    instantiate: (Ctor) => new Ctor(),
    applyParams: (filters, params) => {
      const f = filters[0]; if (!f) return
      const masterAlpha = params.masterAlpha ?? 1
      f.color = params.color
      f.outerStrength = (params.outerStrength ?? 4) * masterAlpha
      f.innerStrength = (params.innerStrength ?? 0) * masterAlpha
      f.distance = params.distance ?? 12
      f.quality = params.quality ?? 0.2
    },
    params: [
      { name: "color",         label: "Color",         control: "color"  },
      { name: "outerStrength", label: "Outer Glow",    control: "slider", min: 0, max: 10, step: 0.5 },
      { name: "innerStrength", label: "Inner Glow",    control: "slider", min: 0, max: 5,  step: 0.1 },
      { name: "distance",      label: "Distance",      control: "slider", min: 0, max: 30, step: 1   },
      { name: "quality",       label: "Quality",       control: "slider", min: 0.1, max: 1, step: 0.05 },
      { name: "masterAlpha",   label: "Strength",      control: "slider", min: 0, max: 1, step: 0.05 }
    ]
  },

  "outline-glow": {
    label: "Outline",
    icon: "fa-solid fa-circle-dot",
    description: "Crisp colored outline — great for hero highlights",
    pixiCtor: () => globalThis.PIXI?.filters?.OutlineFilter,
    animated: false,
    defaults: { color: 0xFFD700, thickness: 2, alpha: 1, quality: 0.5, masterAlpha: 1 },
    instantiate: (Ctor) => new Ctor(),
    applyParams: (filters, params) => {
      const f = filters[0]; if (!f) return
      f.thickness = params.thickness ?? 2
      f.color = params.color ?? 0xFFD700
      f.alpha = (params.alpha ?? 1) * (params.masterAlpha ?? 1)
      f.quality = params.quality ?? 0.5
    },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "thickness",   label: "Thickness", control: "slider", min: 0, max: 10, step: 0.5 },
      { name: "alpha",       label: "Alpha",     control: "slider", min: 0, max: 1,  step: 0.05 },
      { name: "quality",     label: "Quality",   control: "slider", min: 0.1, max: 1, step: 0.05 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0, max: 1, step: 0.05 }
    ]
  },

  "fire-glow": {
    label: "Fire",
    icon: "fa-solid fa-fire",
    description: "Two-stage warm flickering aura with bright inner core (animated)",
    pixiCtor: () => globalThis.PIXI?.filters?.GlowFilter,
    animated: true,
    animator: "fire-flicker",
    defaults: { color: 0xFF6F2C, intensity: 1, speed: 1, masterAlpha: 1 },
    instantiate: (Ctor) => {
      // Setup-only: construction + non-param geometry. Color and
      // strengths are written by applyParams.
      const outer = new Ctor()
      outer.distance = 18
      outer.quality = 0.2
      const inner = new Ctor()
      inner.distance = 6
      inner.quality = 0.3
      return [outer, inner]
    },
    applyParams: (filters, params) => {
      const intensity = params.intensity ?? 1
      const masterAlpha = params.masterAlpha ?? 1
      const [outer, inner] = filters
      if (outer) {
        outer.color = params.color ?? 0xFF6F2C
        outer.outerStrength = 7 * intensity * masterAlpha
        outer.innerStrength = 0
      }
      if (inner) {
        inner.color = 0xFFFFAA
        inner.outerStrength = 0
        inner.innerStrength = 1.5 * intensity * masterAlpha
      }
    },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "intensity",   label: "Intensity", control: "slider", min: 0, max: 2,    step: 0.05 },
      { name: "speed",       label: "Speed",     control: "slider", min: 0.1, max: 3,  step: 0.1  },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0, max: 1,    step: 0.05 }
    ]
  },

  "frost-glow": {
    label: "Frost",
    icon: "fa-solid fa-snowflake",
    description: "Cool icy aura with cool-tone tint",
    pixiCtor: () => globalThis.PIXI?.filters?.GlowFilter,
    animated: false,
    defaults: {
      color: 0x88CCFF, outerStrength: 5, innerStrength: 0.5,
      distance: 12, masterAlpha: 1
    },
    instantiate: (Ctor) => {
      const glow = new Ctor()
      glow.quality = 0.2
      const stack = [glow]
      const CM = globalThis.PIXI?.ColorMatrixFilter ?? globalThis.PIXI?.filters?.ColorMatrixFilter
      if (CM) {
        const cm = new CM()
        if (typeof cm.brightness === "function") cm.brightness(1.08, false)
        if (typeof cm.hue === "function") cm.hue(15, true)
        stack.push(cm)
      }
      return stack
    },
    applyParams: (filters, params) => {
      const masterAlpha = params.masterAlpha ?? 1
      const [glow] = filters
      if (glow) {
        glow.color = params.color ?? 0x88CCFF
        glow.outerStrength = (params.outerStrength ?? 5) * masterAlpha
        glow.innerStrength = (params.innerStrength ?? 0.5) * masterAlpha
        glow.distance = params.distance ?? 12
      }
    },
    params: [
      { name: "color",         label: "Color",      control: "color"  },
      { name: "outerStrength", label: "Strength",   control: "slider", min: 0, max: 10, step: 0.5 },
      { name: "innerStrength", label: "Inner Glow", control: "slider", min: 0, max: 5,  step: 0.1 },
      { name: "distance",      label: "Distance",   control: "slider", min: 0, max: 30, step: 1   },
      { name: "masterAlpha",   label: "Strength",   control: "slider", min: 0, max: 1,  step: 0.05 }
    ]
  },

  "lightning-flash": {
    label: "Lightning",
    icon: "fa-solid fa-bolt",
    description: "Crackling electric flash with RGB-split (animated)",
    pixiCtor: () => globalThis.PIXI?.filters?.GlowFilter,
    animated: true,
    animator: "lightning-flash",
    defaults: { color: 0xCCEEFF, intensity: 1.2, speed: 2.5, masterAlpha: 1 },
    instantiate: (Ctor) => {
      const glow = new Ctor()
      glow.distance = 22
      glow.quality = 0.3
      const stack = [glow]
      const RGBSplit = globalThis.PIXI?.filters?.RGBSplitFilter
      if (RGBSplit) {
        const split = new RGBSplit()
        if ("alpha" in split) split.alpha = 0.8
        stack.push(split)
      }
      return stack
    },
    applyParams: (filters, params) => {
      const intensity = params.intensity ?? 1.2
      const masterAlpha = params.masterAlpha ?? 1
      const [glow, split] = filters
      if (glow) {
        glow.color = params.color ?? 0xCCEEFF
        glow.outerStrength = 9 * intensity * masterAlpha
        glow.innerStrength = 2 * intensity * masterAlpha
      }
      if (split) {
        split.red = [-2, 0]
        split.green = [0, 0]
        split.blue = [2, 0]
      }
    },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "intensity",   label: "Intensity", control: "slider", min: 0, max: 2,    step: 0.05 },
      { name: "speed",       label: "Speed",     control: "slider", min: 0.5, max: 5,  step: 0.1  },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0, max: 1,    step: 0.05 }
    ]
  },

  "mist-veil": {
    label: "Mist",
    icon: "fa-solid fa-cloud",
    description: "Soft blurred haze",
    pixiCtor: () => globalThis.PIXI?.BlurFilter ?? globalThis.PIXI?.filters?.BlurFilter,
    animated: false,
    defaults: { strength: 2, quality: 4, masterAlpha: 1 },
    instantiate: (Ctor, params) => {
      // BlurFilter is positional-args; live updates of strength/
      // quality go via .strength / .quality property setters in
      // applyParams (PIXI v8 supports both runtime mutations).
      return new Ctor(params.strength ?? 2, params.quality ?? 4)
    },
    applyParams: (filters, params) => {
      const f = filters[0]; if (!f) return
      if ("strength" in f) f.strength = params.strength ?? 2
      if ("quality" in f) f.quality = params.quality ?? 4
      if ("alpha" in f) f.alpha = params.masterAlpha ?? 1
    },
    params: [
      { name: "strength",    label: "Blur Strength", control: "slider", min: 0, max: 10, step: 0.5 },
      { name: "quality",     label: "Quality",       control: "slider", min: 1, max: 8,  step: 1   },
      { name: "masterAlpha", label: "Strength",      control: "slider", min: 0, max: 1,  step: 0.05 }
    ]
  },

  "phantom": {
    label: "Phantom",
    icon: "fa-solid fa-ghost",
    description: "Semi-transparent ghostly look",
    pixiCtor: () => globalThis.PIXI?.AlphaFilter ?? globalThis.PIXI?.filters?.AlphaFilter,
    animated: false,
    defaults: { alpha: 0.4, masterAlpha: 1 },
    instantiate: (Ctor, params) => {
      const effective = (params.alpha ?? 0.4) * (params.masterAlpha ?? 1)
      return new Ctor(Math.max(0, Math.min(1, effective)))
    },
    applyParams: (filters, params) => {
      const f = filters[0]; if (!f) return
      const effective = (params.alpha ?? 0.4) * (params.masterAlpha ?? 1)
      f.alpha = Math.max(0, Math.min(1, effective))
    },
    params: [
      { name: "alpha",       label: "Visibility", control: "slider", min: 0.05, max: 1, step: 0.05 },
      { name: "masterAlpha", label: "Strength",   control: "slider", min: 0, max: 1, step: 0.05 }
    ]
  },

  // Particle-backed effects. backing:"particle" routes them through
  // BeneosParticleSystem instead of token.mesh.filters. Live-updates
  // via the system's applyParams; defaults+params drive the UI.

  "sparkle-orbit": {
    label: "Sparkles",
    icon: "fa-solid fa-sparkles",
    description: "Twinkling particles orbiting the token",
    backing: "particle",
    defaults: { color: 0xFFEEAA, count: 8, size: 0.08, speed: 1, spreadX: 1, spreadY: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",      control: "color"  },
      { name: "count",       label: "Density",    control: "slider", min: 2, max: 25, step: 1 },
      { name: "size",        label: "Size",       control: "slider", min: 0.03, max: 0.2, step: 0.005 },
      { name: "speed",       label: "Speed",      control: "slider", min: 0.2, max: 3,   step: 0.1 },
      { name: "spreadX",     label: "Spread X",   control: "slider", min: 0,   max: 3,   step: 0.1 },
      { name: "spreadY",     label: "Spread Y",   control: "slider", min: 0,   max: 3,   step: 0.1 },
      { name: "masterAlpha", label: "Strength",   control: "slider", min: 0,   max: 1,   step: 0.05 }
    ]
  },

  "embers-rise": {
    label: "Embers",
    icon: "fa-solid fa-fire-flame-curved",
    description: "Glowing embers rising from the token",
    backing: "particle",
    defaults: { color: 0xFF8833, density: 1, size: 0.06, speed: 1, spreadX: 1, spreadY: 0, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",      control: "color"  },
      { name: "density",     label: "Density",    control: "slider", min: 0.2, max: 3, step: 0.1 },
      { name: "size",        label: "Size",       control: "slider", min: 0.02, max: 0.15, step: 0.005 },
      { name: "speed",       label: "Rise Speed", control: "slider", min: 0.3, max: 3, step: 0.1 },
      { name: "spreadX",     label: "Spread X",   control: "slider", min: 0,   max: 3, step: 0.1 },
      { name: "spreadY",     label: "Spread Y",   control: "slider", min: 0,   max: 3, step: 0.1 },
      { name: "masterAlpha", label: "Strength",   control: "slider", min: 0,   max: 1, step: 0.05 }
    ]
  },

  "snow-fall": {
    label: "Snow",
    icon: "fa-solid fa-snowflake",
    description: "Snowflakes drifting down through the token",
    backing: "particle",
    defaults: { color: 0xFFFFFF, density: 1, size: 0.05, speed: 1, spreadX: 1, spreadY: 0, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",      control: "color"  },
      { name: "density",     label: "Density",    control: "slider", min: 0.2, max: 3, step: 0.1 },
      { name: "size",        label: "Size",       control: "slider", min: 0.02, max: 0.15, step: 0.005 },
      { name: "speed",       label: "Fall Speed", control: "slider", min: 0.3, max: 3, step: 0.1 },
      { name: "spreadX",     label: "Spread X",   control: "slider", min: 0,   max: 3, step: 0.1 },
      { name: "spreadY",     label: "Spread Y",   control: "slider", min: 0,   max: 3, step: 0.1 },
      { name: "masterAlpha", label: "Strength",   control: "slider", min: 0,   max: 1, step: 0.05 }
    ]
  },

  "magic-stars": {
    label: "Magic Stars",
    icon: "fa-solid fa-star",
    description: "Twinkling stars orbiting in a 2D pattern",
    backing: "particle",
    defaults: { color: 0xFFE066, count: 6, size: 0.1, speed: 1, spreadX: 1, spreadY: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",      control: "color"  },
      { name: "count",       label: "Density",    control: "slider", min: 2, max: 20, step: 1 },
      { name: "size",        label: "Size",       control: "slider", min: 0.04, max: 0.25, step: 0.005 },
      { name: "speed",       label: "Speed",      control: "slider", min: 0.2, max: 3, step: 0.1 },
      { name: "spreadX",     label: "Spread X",   control: "slider", min: 0,   max: 3, step: 0.1 },
      { name: "spreadY",     label: "Spread Y",   control: "slider", min: 0,   max: 3, step: 0.1 },
      { name: "masterAlpha", label: "Strength",   control: "slider", min: 0,   max: 1, step: 0.05 }
    ]
  },

  "frost-cloud": {
    label: "Frost Cloud",
    icon: "fa-solid fa-cloud-meatball",
    description: "Cool vapor puffs drifting outward",
    backing: "particle",
    defaults: { color: 0xB8E6FF, density: 1, size: 0.18, speed: 1, spreadX: 1, spreadY: 0.5, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",      control: "color"  },
      { name: "density",     label: "Density",    control: "slider", min: 0.2, max: 3, step: 0.1 },
      { name: "size",        label: "Size",       control: "slider", min: 0.08, max: 0.4, step: 0.01 },
      { name: "speed",       label: "Speed",      control: "slider", min: 0.2, max: 3, step: 0.1 },
      { name: "spreadX",     label: "Spread X",   control: "slider", min: 0,   max: 3, step: 0.1 },
      { name: "spreadY",     label: "Spread Y",   control: "slider", min: 0,   max: 3, step: 0.1 },
      { name: "masterAlpha", label: "Strength",   control: "slider", min: 0,   max: 1, step: 0.05 }
    ]
  },

  "lightning-spark": {
    label: "Lightning Spark",
    icon: "fa-solid fa-bolt-lightning",
    description: "Discrete electric spark-lines flickering around the token",
    backing: "particle",
    defaults: { color: 0xCCEEFF, density: 1, size: 0.12, spreadX: 1, spreadY: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",      control: "color"  },
      { name: "density",     label: "Density",    control: "slider", min: 0.2, max: 3, step: 0.1 },
      { name: "size",        label: "Length",     control: "slider", min: 0.05, max: 0.3, step: 0.005 },
      { name: "spreadX",     label: "Spread X",   control: "slider", min: 0,   max: 3, step: 0.1 },
      { name: "spreadY",     label: "Spread Y",   control: "slider", min: 0,   max: 3, step: 0.1 },
      { name: "masterAlpha", label: "Strength",   control: "slider", min: 0,   max: 1, step: 0.05 }
    ]
  },

  // Render-Layer-backed effects. backing:"render-layer" mounts a
  // single PIXI.Graphics that's redrawn every frame.

  "aura-ring": {
    label: "Aura Ring",
    icon: "fa-solid fa-circle-notch",
    description: "Pulsing colored ring around the token",
    backing: "render-layer",
    defaults: { color: 0xFFD86B, radius: 1.1, thickness: 0.05, speed: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "radius",      label: "Radius",    control: "slider", min: 0.5, max: 3,    step: 0.05 },
      { name: "thickness",   label: "Thickness", control: "slider", min: 0.01, max: 0.2, step: 0.005 },
      { name: "speed",       label: "Speed",     control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "shockwave": {
    label: "Shockwave",
    icon: "fa-solid fa-circle-radiation",
    description: "Repeating expanding rings outward from the token",
    backing: "render-layer",
    defaults: { color: 0xFF8080, rings: 3, radius: 1, thickness: 0.04, speed: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "rings",       label: "Ring Count",control: "slider", min: 1,   max: 6,    step: 1 },
      { name: "radius",      label: "Reach",     control: "slider", min: 0.5, max: 3,    step: 0.05 },
      { name: "thickness",   label: "Thickness", control: "slider", min: 0.01, max: 0.2, step: 0.005 },
      { name: "speed",       label: "Speed",     control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "lightning-bolt": {
    label: "Lightning Bolts",
    icon: "fa-solid fa-bolt",
    description: "Random jagged bolts flashing around the token",
    backing: "render-layer",
    defaults: { color: 0xCCEEFF, intensity: 1, speed: 1, spread: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "intensity",   label: "Frequency", control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "speed",       label: "Speed",     control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "spread",      label: "Spread",    control: "slider", min: 0.3, max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "smoke-puff": {
    label: "Smoke Puffs",
    icon: "fa-solid fa-smog",
    description: "Soft smoke clouds rising from the token",
    backing: "render-layer",
    defaults: { color: 0x888888, density: 1, size: 1, speed: 1, spreadX: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "density",     label: "Density",   control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "size",        label: "Size",      control: "slider", min: 0.4, max: 2,    step: 0.05 },
      { name: "speed",       label: "Rise Speed",control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "spreadX",     label: "Spread X",  control: "slider", min: 0.3, max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  // Stage 13d-5: 7 additional particle-types

  "holy-rays": {
    label: "Holy Rays",
    icon: "fa-solid fa-cross",
    description: "Vertical rays of light rising from the token",
    backing: "particle",
    defaults: { color: 0xFFEEAA, density: 1, size: 1, speed: 1, spreadX: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",      control: "color"  },
      { name: "density",     label: "Density",    control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "size",        label: "Length",     control: "slider", min: 0.3, max: 2.5,  step: 0.05 },
      { name: "speed",       label: "Rise Speed", control: "slider", min: 0.3, max: 3,    step: 0.1 },
      { name: "spreadX",     label: "Spread X",   control: "slider", min: 0,   max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",   control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "bubble-stream": {
    label: "Bubbles",
    icon: "fa-solid fa-droplet",
    description: "Rising bubbles from the token base",
    backing: "particle",
    defaults: { color: 0xAEDFFF, density: 1, size: 1, speed: 1, spreadX: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",      control: "color"  },
      { name: "density",     label: "Density",    control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "size",        label: "Size",       control: "slider", min: 0.4, max: 2.5,  step: 0.05 },
      { name: "speed",       label: "Rise Speed", control: "slider", min: 0.3, max: 3,    step: 0.1 },
      { name: "spreadX",     label: "Spread X",   control: "slider", min: 0,   max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",   control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "magic-runes": {
    label: "Magic Runes",
    icon: "fa-solid fa-hashtag",
    description: "Geometric runes orbiting the token",
    backing: "particle",
    defaults: { color: 0xC78BFF, count: 5, size: 0.12, speed: 1, spreadX: 1, spreadY: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "count",       label: "Density",   control: "slider", min: 2,   max: 15,   step: 1 },
      { name: "size",        label: "Size",      control: "slider", min: 0.06, max: 0.25, step: 0.005 },
      { name: "speed",       label: "Speed",     control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "spreadX",     label: "Spread X",  control: "slider", min: 0,   max: 3,    step: 0.1 },
      { name: "spreadY",     label: "Spread Y",  control: "slider", min: 0,   max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "falling-leaves": {
    label: "Falling Leaves",
    icon: "fa-solid fa-leaf",
    description: "Leaves drifting down with sin-wobble",
    backing: "particle",
    defaults: { color: 0x4A8B2A, density: 1, size: 0.08, speed: 1, spreadX: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "density",     label: "Density",   control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "size",        label: "Size",      control: "slider", min: 0.04, max: 0.2, step: 0.005 },
      { name: "speed",       label: "Fall Speed",control: "slider", min: 0.3, max: 3,    step: 0.1 },
      { name: "spreadX",     label: "Spread X",  control: "slider", min: 0,   max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "poison-aura": {
    label: "Poison Aura",
    icon: "fa-solid fa-skull-crossbones",
    description: "Sickly green vapor pulsing around the token",
    backing: "particle",
    defaults: { color: 0x88DD44, density: 1, size: 0.22, speed: 1, spreadX: 1, spreadY: 0.8, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "density",     label: "Density",   control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "size",        label: "Size",      control: "slider", min: 0.1, max: 0.5,  step: 0.01 },
      { name: "speed",       label: "Speed",     control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "spreadX",     label: "Spread X",  control: "slider", min: 0,   max: 3,    step: 0.1 },
      { name: "spreadY",     label: "Spread Y",  control: "slider", min: 0,   max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "stink-cloud": {
    label: "Stink Lines",
    icon: "fa-solid fa-poo",
    description: "Comic stink-lines wafting up from the token",
    backing: "particle",
    defaults: { color: 0x8FA84F, density: 1, size: 1, speed: 1, spreadX: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "density",     label: "Density",   control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "size",        label: "Size",      control: "slider", min: 0.4, max: 2.5,  step: 0.05 },
      { name: "speed",       label: "Rise Speed",control: "slider", min: 0.3, max: 3,    step: 0.1 },
      { name: "spreadX",     label: "Spread X",  control: "slider", min: 0,   max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "fire-flames": {
    label: "Flames",
    icon: "fa-solid fa-fire",
    description: "Realistic flame sprites rising with flicker",
    backing: "particle",
    defaults: { color: 0xFF6622, density: 1, size: 0.15, speed: 1, spreadX: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "density",     label: "Density",   control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "size",        label: "Size",      control: "slider", min: 0.07, max: 0.35, step: 0.005 },
      { name: "speed",       label: "Rise Speed",control: "slider", min: 0.3, max: 3,    step: 0.1 },
      { name: "spreadX",     label: "Spread X",  control: "slider", min: 0,   max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  // Stage 13d-5: 4 additional render-layer types

  "spotlight": {
    label: "Spotlight",
    icon: "fa-solid fa-lightbulb",
    description: "Soft glow pool under the token",
    backing: "render-layer",
    defaults: { color: 0xFFE9A8, radius: 1.2, offsetY: 0.7, speed: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "radius",      label: "Radius",    control: "slider", min: 0.3, max: 2.5,  step: 0.05 },
      { name: "offsetY",     label: "Offset Y",  control: "slider", min: -1,  max: 1,    step: 0.05 },
      { name: "speed",       label: "Pulse Speed", control: "slider", min: 0.2, max: 3,  step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "magic-circle": {
    label: "Magic Circle",
    icon: "fa-solid fa-circle-nodes",
    description: "Pentagram or polygon under the token (4 variants)",
    backing: "render-layer",
    defaults: { color: 0xC78BFF, variant: 1, radius: 1, offsetY: 0.7, speed: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "variant",     label: "Style",     control: "slider", min: 0,   max: 3,    step: 1 },
      { name: "radius",      label: "Radius",    control: "slider", min: 0.3, max: 2.5,  step: 0.05 },
      { name: "offsetY",     label: "Offset Y",  control: "slider", min: -1,  max: 1,    step: 0.05 },
      { name: "speed",       label: "Rotation Speed", control: "slider", min: 0.1, max: 3,step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "energy-beams": {
    label: "Energy Beams",
    icon: "fa-solid fa-burst",
    description: "Star-burst rays radiating from the token",
    backing: "render-layer",
    defaults: { color: 0xFFD86B, beams: 8, reach: 1.4, speed: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "beams",       label: "Beam Count",control: "slider", min: 3,   max: 16,   step: 1 },
      { name: "reach",       label: "Reach",     control: "slider", min: 0.5, max: 3,    step: 0.05 },
      { name: "speed",       label: "Speed",     control: "slider", min: 0.2, max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "pulse-beat": {
    label: "Pulse Beat",
    icon: "fa-solid fa-heart-pulse",
    description: "Heartbeat-rhythm rings (two pulses + pause)",
    backing: "render-layer",
    defaults: { color: 0xFF4477, reach: 1.5, thickness: 0.04, speed: 1, masterAlpha: 1 },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "reach",       label: "Reach",     control: "slider", min: 0.5, max: 3,    step: 0.05 },
      { name: "thickness",   label: "Thickness", control: "slider", min: 0.01, max: 0.2, step: 0.005 },
      { name: "speed",       label: "Beat Speed",control: "slider", min: 0.3, max: 3,    step: 0.1 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  // Stage 13d-5: 2 custom-shader filter types

  "lightning-arc": {
    label: "Lightning Arc",
    icon: "fa-solid fa-bolt",
    description: "Branching electric arcs (Perlin-FBM shader)",
    backing: "filter",
    pixiCtor: () => BeneosCustomFilter,
    animated: false,
    defaults: { color: 0xCCEEFF, intensity: 1.5, frequency: 8, branching: 3, masterAlpha: 1 },
    instantiate: (Ctor, params) => new Ctor({
      fragment: LIGHTNING_ARC_FRAGMENT,
      uniforms: {
        uColor: hexToRGB(params.color ?? 0xCCEEFF),
        uIntensity: (params.intensity ?? 1.5) * (params.masterAlpha ?? 1),
        uFrequency: params.frequency ?? 8,
        uBranching: params.branching ?? 3
      }
    }),
    applyParams: (filters, params) => {
      const f = filters[0]; if (!f?.uniforms) return
      f.uniforms.uColor = hexToRGB(params.color ?? 0xCCEEFF)
      f.uniforms.uIntensity = (params.intensity ?? 1.5) * (params.masterAlpha ?? 1)
      f.uniforms.uFrequency = params.frequency ?? 8
      f.uniforms.uBranching = params.branching ?? 3
    },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "intensity",   label: "Intensity", control: "slider", min: 0,   max: 3,    step: 0.05 },
      { name: "frequency",   label: "Frequency", control: "slider", min: 1,   max: 20,   step: 0.5 },
      { name: "branching",   label: "Branches",  control: "slider", min: 1,   max: 6,    step: 0.5 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  },

  "magic-aura": {
    label: "Magic Aura",
    icon: "fa-solid fa-wand-sparkles",
    description: "Mystical aura halo (8 sub-variants via Style slider)",
    backing: "filter",
    pixiCtor: () => BeneosCustomFilter,
    animated: false,
    defaults: { color: 0x88CCFF, auraType: 0, thickness: 0.3, intensity: 1, masterAlpha: 1 },
    instantiate: (Ctor, params) => new Ctor({
      fragment: MAGIC_AURA_FRAGMENT,
      uniforms: {
        uColor: hexToRGB(params.color ?? 0x88CCFF),
        uAuraType: params.auraType ?? 0,
        uThickness: params.thickness ?? 0.3,
        uIntensity: (params.intensity ?? 1) * (params.masterAlpha ?? 1)
      }
    }),
    applyParams: (filters, params) => {
      const f = filters[0]; if (!f?.uniforms) return
      f.uniforms.uColor = hexToRGB(params.color ?? 0x88CCFF)
      f.uniforms.uAuraType = params.auraType ?? 0
      f.uniforms.uThickness = params.thickness ?? 0.3
      f.uniforms.uIntensity = (params.intensity ?? 1) * (params.masterAlpha ?? 1)
    },
    params: [
      { name: "color",       label: "Color",     control: "color"  },
      { name: "auraType",    label: "Style",     control: "slider", min: 0,   max: 7,    step: 1 },
      { name: "thickness",   label: "Thickness", control: "slider", min: 0.05, max: 0.5, step: 0.01 },
      { name: "intensity",   label: "Intensity", control: "slider", min: 0,   max: 2,    step: 0.05 },
      { name: "masterAlpha", label: "Strength",  control: "slider", min: 0,   max: 1,    step: 0.05 }
    ]
  }
}

// Stage 13c-Polish: animator functions receive the filter STACK
// (array). Each animator drives effects "alive" via per-frame
// property writes. With Stage 13d-1's live-mutation, the params
// reference held by the animator entry is mutated in-place by
// BeneosFXAnimator.updateParams when the user drags a slider —
// so animator ticks read fresh values without restart.

export const BENEOS_FX_ANIMATORS = {

  "fire-flicker": (filters, params, time) => {
    const speed = params.speed ?? 1
    const intensity = params.intensity ?? 1
    const masterAlpha = params.masterAlpha ?? 1

    // Three coprime sine waves → non-repeating flicker
    const flicker = 1
      + Math.sin(time * speed * 0.0061) * 0.20
      + Math.sin(time * speed * 0.0107) * 0.13
      + Math.sin(time * speed * 0.0173) * 0.07
    const flickerClamped = Math.max(0.2, flicker)

    // Color-oscillation: drift between source-color and a deeper-red
    // shade for an organic flame feel.
    const colorPulse = 0.5 + 0.5 * Math.sin(time * speed * 0.003)
    const baseColor = params.color ?? 0xFF6F2C
    const r = ((baseColor >> 16) & 0xFF) * (1 - colorPulse * 0.30)
    const g = ((baseColor >> 8)  & 0xFF) * (1 - colorPulse * 0.40)
    const b = ( baseColor        & 0xFF)
    const animColor = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)

    const [outer, inner] = filters
    if (outer) {
      outer.color = animColor
      outer.outerStrength = 7 * intensity * masterAlpha * flickerClamped
    }
    if (inner) {
      inner.innerStrength = 1.5 * intensity * masterAlpha * (0.8 + (flicker - 1) * 0.6)
    }
  },

  "lightning-flash": (filters, params, time) => {
    const speed = params.speed ?? 2.5
    const intensity = params.intensity ?? 1.2
    const masterAlpha = params.masterAlpha ?? 1

    const a = Math.sin(time * speed * 0.017)
    const b = Math.sin(time * speed * 0.041)
    const isFlashing = (a > 0.7 || b > 0.85)
    const flash = isFlashing ? 1 : 0.25

    const [glow, rgbSplit] = filters
    if (glow) {
      glow.color = params.color ?? 0xCCEEFF
      glow.outerStrength = 9 * flash * intensity * masterAlpha
      glow.innerStrength = 2 * flash * intensity * masterAlpha
    }
    if (rgbSplit && isFlashing) {
      const jitter = Math.sin(time * 0.07) * 1.5
      if (rgbSplit.red)  rgbSplit.red[0]  = -2 - jitter
      if (rgbSplit.blue) rgbSplit.blue[0] =  2 + jitter
    } else if (rgbSplit) {
      if (rgbSplit.red)  rgbSplit.red[0]  = -0.5
      if (rgbSplit.blue) rgbSplit.blue[0] =  0.5
    }
  }
}
