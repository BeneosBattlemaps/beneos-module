// Beneos Forge - dynamic item icon generator.
//
// Browser-side (Canvas 2D) port of the Beneos Card Creator icon renderer
// (J:\Beneos_Adventures\Publishing\Item_Cards\beneos_card_creator_v1\foundry-icon-generator.js).
// When a mundane / SRD item is forged, and its current image is a Foundry or
// system default icon, we generate a 256x256 WebP "Sigil Plate" icon
// (dark plate + rarity glow + rarity diamond top-left + centered type glyph)
// and store it locally under beneos_assets/cloud/items/custom/, then assign it
// to the item. The type glyphs are bundled under icons/forge/ (converted from
// the Card Creator's item_source PNGs); the type->glyph mapping is the exact
// foundry-item-icon-map.json copied alongside them.

const MODULE_ID = "beneos-module";
const FORGE_ICON_DIR = `modules/${MODULE_ID}/icons/forge`;
const MAP_URL = `${FORGE_ICON_DIR}/item-icon-map.json`;
const CUSTOM_FOLDER = "beneos_assets/cloud/items/custom";
const SIZE = 256;        // output edge (px)
const VB = 1024;         // Card Creator internal viewBox; we draw in VB space and scale to SIZE

// --- Card Creator design tokens (verbatim) --------------------------------
const PLATE_TOP = "#221A14";
const PLATE_MID = "#150F0A";
const PLATE_BOT = "#0B0704";
const HAIRLINE = "rgba(233,199,123,0.18)";
const RARITY_COLOR = {
  common: "#A8A095",
  uncommon: "#5BAE7A",
  rare: "#5BA8D9",
  veryrare: "#9B7BD4",
  legendary: "#E9B658",
  artifact: "#E9B658",
};

let _mapCache = null;

/** normalizeKey from the Card Creator: lowercase, strip spaces/underscores/hyphens/apostrophes. */
function normalizeKey(s) {
  return String(s || "").toLowerCase().replace(/[\s_'-]/g, "");
}

/** Convert "#RRGGBB" to "rgba(r,g,b,a)". */
function hexToRgba(hex, alpha) {
  const h = String(hex || "").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * True if `img` looks like a Foundry / system default icon (not a custom upload),
 * i.e. it should be replaced with a generated Beneos icon when forging.
 * Custom uploads under modules/, worlds/, beneos_assets/ and absolute/http URLs
 * are left untouched. Empty/missing img is treated as replaceable.
 */
export function isReplaceableIcon(img) {
  if (!img) return true;
  const s = String(img).trim().toLowerCase();
  return s.startsWith("systems/") || s.startsWith("icons/");
}

async function loadMap() {
  if (_mapCache) return _mapCache;
  try {
    const res = await fetch(MAP_URL);
    if (!res.ok) throw new Error(`map fetch ${res.status}`);
    _mapCache = await res.json();
  } catch (err) {
    console.warn("[Beneos Forge] icon map load failed; using empty map", err);
    _mapCache = { fallback: "adventuring-gear.png", baseItem: {}, subtype: {}, type: {}, nameKeyword: {} };
  }
  return _mapCache;
}

/**
 * Resolve the glyph filename (as bundled .webp) for an item, following the
 * Card Creator precedence: name special-cases (harmony/resonance/origin) ->
 * baseItem -> subtype (trinket/wondrous deferred) -> nameKeyword ->
 * deferred subtype -> type -> fallback.
 */
export function resolveGlyphFile(item, map) {
  const toWebp = (f) => String(f || "adventuring-gear.png").replace(/\.png$/i, ".webp");
  const name = String(item?.name || "");
  if (/harmony/i.test(name)) return toWebp("harmony.png");
  if (/resonance/i.test(name)) return toWebp("resonance.png");
  if (/origin/i.test(name)) return toWebp("origin.png");

  const base = normalizeKey(item?.system?.type?.baseItem);
  const sub = normalizeKey(item?.system?.type?.value);
  const t = normalizeKey(item?.type);
  const lname = name.toLowerCase();

  if (base && map.baseItem?.[base]) return toWebp(map.baseItem[base]);

  const isDeferredSub = sub === "trinket" || sub === "wondrous";
  if (sub && map.subtype?.[sub] && !isDeferredSub) return toWebp(map.subtype[sub]);

  if (lname && map.nameKeyword) {
    for (const kw of Object.keys(map.nameKeyword)) {
      if (lname.includes(kw)) return toWebp(map.nameKeyword[kw]);
    }
  }
  if (sub && map.subtype?.[sub] && isDeferredSub) return toWebp(map.subtype[sub]);
  if (t && map.type?.[t]) return toWebp(map.type[t]);
  return toWebp(map.fallback || "adventuring-gear.png");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw the rarity diamond (rotated rounded square) top-left, in VB coords. */
function drawGem(ctx, color) {
  const cx = VB * 0.125, cy = VB * 0.125;
  const s = VB * 0.10, cr = s * 0.12;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  // dark backing
  roundRectPath(ctx, -s / 2 - 4, -s / 2 - 4, s + 8, s + 8, cr + 2);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();
  // rarity fill
  roundRectPath(ctx, -s / 2, -s / 2, s, s, cr);
  ctx.fillStyle = color;
  ctx.fill();
  // hairline edge
  roundRectPath(ctx, -s / 2, -s / 2, s, s, cr);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.stroke();
  ctx.restore();
}

/** Render the composited 256x256 icon to a Blob (image/webp). */
async function renderIconBlob(item) {
  const map = await loadMap();
  const rarityKey = normalizeKey(item?.system?.rarity) || "common";
  const color = RARITY_COLOR[rarityKey] || RARITY_COLOR.common;
  const glyphFile = resolveGlyphFile(item, map);

  let glyphImg = null;
  try { glyphImg = await loadImage(`${FORGE_ICON_DIR}/${glyphFile}`); }
  catch (_) {
    try { glyphImg = await loadImage(`${FORGE_ICON_DIR}/adventuring-gear.webp`); } catch (__) { glyphImg = null; }
  }

  const canvas = document.createElement("canvas");
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SIZE / VB, SIZE / VB); // draw everything in 1024 space

  // Clip to the rounded plate.
  ctx.save();
  roundRectPath(ctx, 0, 0, VB, VB, 140);
  ctx.clip();

  // Body gradient (diagonal approximation of the rotate(20) linear gradient).
  const body = ctx.createLinearGradient(0, 0, VB, VB);
  body.addColorStop(0, PLATE_TOP);
  body.addColorStop(0.6, PLATE_MID);
  body.addColorStop(1, PLATE_BOT);
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, VB, VB);

  // Accent glow (radial, rarity color).
  const glow = ctx.createRadialGradient(VB * 0.5, VB * 0.6, 0, VB * 0.5, VB * 0.6, VB * 0.55);
  glow.addColorStop(0, hexToRgba(color, 0.16));
  glow.addColorStop(0.7, hexToRgba(color, 0));
  glow.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, VB, VB);

  // Inner highlight / bottom shade.
  const inner = ctx.createLinearGradient(0, 0, 0, VB);
  inner.addColorStop(0, "rgba(255,235,200,0.06)");
  inner.addColorStop(0.03, "rgba(0,0,0,0)");
  inner.addColorStop(0.97, "rgba(0,0,0,0)");
  inner.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = inner;
  ctx.fillRect(0, 0, VB, VB);

  // Rarity diamond (under the glyph, as in the Card Creator).
  drawGem(ctx, color);

  // Central type glyph, 70% of output, centered, aspect preserved.
  if (glyphImg) {
    const boxOut = SIZE * 0.70;            // px in output
    const box = boxOut * (VB / SIZE);      // in VB space
    const iw = glyphImg.width || box, ih = glyphImg.height || box;
    const scale = Math.min(box / iw, box / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(glyphImg, (VB - dw) / 2, (VB - dh) / 2, dw, dh);
  }

  ctx.restore();

  // Hairline border on top.
  roundRectPath(ctx, 0.5, 0.5, VB - 1, VB - 1, 140);
  ctx.lineWidth = 1;
  ctx.strokeStyle = HAIRLINE;
  ctx.stroke();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  const stem = glyphFile.replace(/\.webp$/i, "");
  return { blob, filename: `${stem}-${rarityKey}.webp` };
}

async function ensureCustomFolder() {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
  for (const dir of [
    "beneos_assets",
    "beneos_assets/cloud",
    "beneos_assets/cloud/items",
    CUSTOM_FOLDER,
  ]) {
    try { await FP.createDirectory("data", dir); } catch (_) { /* exists */ }
  }
}

/**
 * Generate + upload a Beneos icon for `item` and return its data path
 * (e.g. "beneos_assets/cloud/items/custom/sword-rare.webp"), or null on failure.
 * The caller decides whether to apply it (see isReplaceableIcon).
 */
export async function generateBeneosItemIcon(item) {
  try {
    const { blob, filename } = await renderIconBlob(item);
    if (!blob) return null;
    await ensureCustomFolder();
    const file = new File([blob], filename, { type: "image/webp" });
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    const result = await FP.upload("data", CUSTOM_FOLDER, file, {}, { notify: false });
    if (!result?.path) {
      console.warn("[Beneos Forge] icon upload returned no path", { filename });
      return null;
    }
    return `${CUSTOM_FOLDER}/${filename}`;
  } catch (err) {
    console.warn("[Beneos Forge] icon generation failed", err);
    return null;
  }
}
