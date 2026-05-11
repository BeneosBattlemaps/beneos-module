// Beneos FX — Custom-Shader Filters.
//
// Native PIXI.Filter subclass driving GLSL fragment shaders. Time-
// uniform is auto-incremented every apply() call so shaders self-
// animate without needing a JS animator.
//
// GLSL noise functions are public-domain mathematical primitives
// (Inigo Quilez fbm/noise patterns, Stefan Gustavson hash). No
// code is taken from Token-Magic-FX or any third-party module.
//
// Two effect-types live here:
//   * lightning-arc — Perlin-FBM branching electric arcs.
//   * magic-aura    — Perlin-FBM halo with 8 sub-variants chosen
//                     via uAuraType (0..7).

const DEFAULT_VERTEX = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 projectionMatrix;
varying vec2 vTextureCoord;
void main(void) {
    gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = aTextureCoord;
}
`

// Public-domain GLSL noise utilities: 2D hash, value noise, fbm.
// Same primitives Inigo Quilez & Stefan Gustavson popularized.
const NOISE_GLSL = `
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
        v += amp * noise2(p);
        p *= 2.0;
        amp *= 0.5;
    }
    return v;
}
`

export const LIGHTNING_ARC_FRAGMENT = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uFrequency;
uniform float uBranching;
${NOISE_GLSL}
void main(void) {
    vec2 uv = vTextureCoord;
    vec4 base = texture2D(uSampler, uv);
    vec2 p = uv * uFrequency;
    p.y += uTime * 0.6;
    float n1 = fbm(p);
    float n2 = fbm(p * 2.3 + uTime * 0.4);
    float arc = pow(abs(n1 - n2), 1.2);
    float branchMask = smoothstep(0.45 - 0.04 * uBranching, 0.5, arc);
    float intensity = branchMask * uIntensity;
    vec3 lightning = uColor * intensity;
    gl_FragColor = base + vec4(lightning, intensity);
}
`

export const MAGIC_AURA_FRAGMENT = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uThickness;
uniform float uAuraType;
${NOISE_GLSL}
void main(void) {
    vec2 uv = vTextureCoord;
    vec4 base = texture2D(uSampler, uv);
    vec2 c = uv - vec2(0.5);
    float dist = length(c);
    int variant = int(floor(uAuraType + 0.5));
    float pattern = 0.0;
    if (variant == 0) {
        // Smooth halo
        pattern = fbm(uv * 4.0 + uTime * 0.3);
    } else if (variant == 1) {
        // Fire — turbulent + warm
        pattern = fbm(uv * 6.0 + vec2(0.0, -uTime * 1.0));
        pattern *= 1.4;
    } else if (variant == 2) {
        // Frost — sharp geometric
        float n = fbm(uv * 9.0);
        pattern = smoothstep(0.4, 0.6, n);
    } else if (variant == 3) {
        // Holy — radial bright core
        pattern = (1.0 - dist * 1.6) * (0.6 + 0.4 * sin(uTime * 1.5));
    } else if (variant == 4) {
        // Necrotic — dark veined
        pattern = fbm(uv * 5.0 + uTime * 0.2);
        pattern = pow(pattern, 2.0);
    } else if (variant == 5) {
        // Cosmic — chromatic shifting
        pattern = fbm(uv * 4.0 + uTime * 0.5);
        pattern *= 0.7 + 0.3 * sin(uTime * 0.8 + dist * 8.0);
    } else if (variant == 6) {
        // Lightning — high-contrast sharp edges
        float n = fbm(uv * 7.0 + uTime * 0.7);
        pattern = pow(smoothstep(0.45, 0.55, n), 2.0);
    } else {
        // Water — flowing waves
        pattern = 0.5 + 0.5 * sin(uv.x * 10.0 + uTime * 1.5)
                  * sin(uv.y * 8.0 + uTime * 1.2);
    }
    // Mask: only render in a band near the edge of the sprite
    float edge = smoothstep(0.5, 0.5 - uThickness, dist);
    float aura = pattern * edge * uIntensity;
    vec3 col = uColor * aura;
    gl_FragColor = base + vec4(col, aura * 0.8);
}
`

export class BeneosCustomFilter extends PIXI.Filter {
  constructor({ vertex, fragment, uniforms = {} }) {
    super(vertex || DEFAULT_VERTEX, fragment, { ...uniforms, uTime: 0 })
    this.padding = 8
  }
  apply(filterManager, input, output, clear) {
    this.uniforms.uTime = performance.now() * 0.001
    super.apply(filterManager, input, output, clear)
  }
}

/**
 * Convert a 0xRRGGBB hex int to a normalized [r, g, b] vec3 array
 * for use as a uniform. PIXI uniforms with type "vec3" expect a
 * 3-element array of floats in [0, 1].
 */
export function hexToRGB(hex) {
  const r = ((hex >> 16) & 0xFF) / 255
  const g = ((hex >>  8) & 0xFF) / 255
  const b = ( hex        & 0xFF) / 255
  return [r, g, b]
}
