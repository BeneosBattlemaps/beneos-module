// Per-origin presentation metadata: glow colour, mono-letters, optional
// icon override. Mirrors window.ORIGIN_META from the React design bundle
// (origin-bonis/project/data.js) but with image paths rewritten to the
// bundled module icons under modules/beneos-module/icons/origin/.
//
// Used by codex gallery cards, detail emblems, and the item-sheet companion.

const MOD = "modules/beneos-module/icons/origin";

export const ORIGIN_META = {
  ancient:       { mono: "AN", glow: "#8aa86b", hue: "rgba(138,168,107,1)", ring: "#c8d99f", image: `${MOD}/ancient.webp` },
  arcane:        { mono: "AR", glow: "#8b5cf6", hue: "rgba(139,92,246,1)",  ring: "#c4a8ff", image: `${MOD}/arcane.webp` },
  awoken:        { mono: "AW", glow: "#a8c0d8", hue: "rgba(168,192,216,1)", ring: "#dde8f3", image: `${MOD}/awoken.webp` },
  beastforged:   { mono: "BF", glow: "#a86838", hue: "rgba(168,104,56,1)",  ring: "#d99c6a", image: `${MOD}/beastforged.webp` },
  blessed:       { mono: "BL", glow: "#f0d96a", hue: "rgba(240,217,106,1)", ring: "#fff0b5", image: `${MOD}/blessed.webp` },
  crystalline:   { mono: "CR", glow: "#c994d9", hue: "rgba(201,148,217,1)", ring: "#e8c8f3", image: `${MOD}/crystalline.webp` },
  druidic:       { mono: "DR", glow: "#5a8c3a", hue: "rgba(90,140,58,1)",   ring: "#a3c878", image: `${MOD}/druidic.webp` },
  dwarvenforged: { mono: "DF", glow: "#c08040", hue: "rgba(192,128,64,1)",  ring: "#e6b478", image: `${MOD}/dwarven_forged.webp` },
  elemental:     { mono: "EL", glow: "#d9a847", hue: "rgba(217,168,71,1)",  ring: "#f0d486", image: `${MOD}/elemental.webp` },
  feywoven:      { mono: "FW", glow: "#4dbf8e", hue: "rgba(77,191,142,1)",  ring: "#a3e8c8", image: `${MOD}/feywoven.webp` },
  giantforged:   { mono: "GF", glow: "#8a9aa8", hue: "rgba(138,154,168,1)", ring: "#c4d0db", image: `${MOD}/giant_forged.webp` },
  infernal:      { mono: "IF", glow: "#e26a2c", hue: "rgba(226,106,44,1)",  ring: "#f5a878", image: `${MOD}/infernal.webp` },
  mutation:      { mono: "MU", glow: "#a82828", hue: "rgba(168,40,40,1)",   ring: "#d96868", image: `${MOD}/mutation.webp` },
  occult:        { mono: "OC", glow: "#6a2d8a", hue: "rgba(106,45,138,1)",  ring: "#a878c8", image: `${MOD}/occult.webp` },
  primordial:    { mono: "PR", glow: "#a8783a", hue: "rgba(168,120,58,1)",  ring: "#d9b478", image: `${MOD}/primordial.webp` },
  relic:         { mono: "RL", glow: "#d4a857", hue: "rgba(212,168,87,1)",  ring: "#f0d486", image: `${MOD}/relic.webp` },
  sanctified:    { mono: "SN", glow: "#f7e3a3", hue: "rgba(247,227,163,1)", ring: "#fff4cc", image: `${MOD}/sanctified.webp` },
  technoarcane:  { mono: "TA", glow: "#4ac8d9", hue: "rgba(74,200,217,1)",  ring: "#a3e3ef", image: `${MOD}/techno_arcane.webp` },
  vampiric:      { mono: "VM", glow: "#b03030", hue: "rgba(176,48,48,1)",   ring: "#e07878", image: `${MOD}/vampiric.webp` },
};

// Canonical ordering for the gallery — matches origins.json import order.
export const ORIGIN_ORDER = [
  "ancient", "arcane", "awoken", "beastforged", "blessed", "crystalline",
  "druidic", "dwarvenforged", "elemental", "feywoven", "giantforged",
  "infernal", "mutation", "occult", "primordial", "relic", "sanctified",
  "technoarcane", "vampiric",
];

export const RARITY_COLOR = {
  "Common":    { fg: "#c8c8c0", bg: "rgba(200,200,192,0.10)", border: "rgba(200,200,192,0.30)" },
  "Uncommon":  { fg: "#7dd07d", bg: "rgba(125,208,125,0.10)", border: "rgba(125,208,125,0.32)" },
  "Rare":      { fg: "#6db0ec", bg: "rgba(109,176,236,0.10)", border: "rgba(109,176,236,0.32)" },
  "Very Rare": { fg: "#c478ec", bg: "rgba(196,120,236,0.10)", border: "rgba(196,120,236,0.32)" },
  "Legendary": { fg: "#f0a040", bg: "rgba(240,160,64,0.10)",  border: "rgba(240,160,64,0.34)" },
};

export const RARITY_MODIFIER = {
  "Common": 1, "Uncommon": 2, "Rare": 3, "Very Rare": 4, "Legendary": 5,
};

// Mechanic-rule summaries for the Concept-Rail accordion. Title/body
// strings are i18n keys, resolved via {{localize}} at render time.
export const MECHANIC_RULES = [
  { k: "item_echo",       title: "BENEOS.Codex.Mechanic.ItemEcho.Title",       body: "BENEOS.Codex.Mechanic.ItemEcho.Body" },
  { k: "generic_named",   title: "BENEOS.Codex.Mechanic.GenericNamed.Title",   body: "BENEOS.Codex.Mechanic.GenericNamed.Body" },
  { k: "set_bonus",       title: "BENEOS.Codex.Mechanic.SetBonus.Title",       body: "BENEOS.Codex.Mechanic.SetBonus.Body" },
  { k: "rarity_modifier", title: "BENEOS.Codex.Mechanic.RarityModifier.Title", body: "BENEOS.Codex.Mechanic.RarityModifier.Body" },
  { k: "dormant",         title: "BENEOS.Codex.Mechanic.Dormant.Title",        body: "BENEOS.Codex.Mechanic.Dormant.Body" },
  { k: "grandeur",        title: "BENEOS.Codex.Mechanic.Grandeur.Title",       body: "BENEOS.Codex.Mechanic.Grandeur.Body" },
  { k: "ritual",          title: "BENEOS.Codex.Mechanic.Ritual.Title",         body: "BENEOS.Codex.Mechanic.Ritual.Body" },
  { k: "sensing",         title: "BENEOS.Codex.Mechanic.Sensing.Title",        body: "BENEOS.Codex.Mechanic.Sensing.Body" },
];

export function originIconPath(slug, variant = "color") {
  const meta = ORIGIN_META[slug];
  if (!meta) return null;
  if (variant === "bw") {
    // The bw icons live alongside the colour ones with a _blackwhite suffix.
    return meta.image.replace(/\.webp$/, "_blackwhite.webp");
  }
  return meta.image;
}
