import { getLootFlags } from "./loot-schema.mjs";
import { OriginsRegistry } from "./origins-registry.mjs";

// Rarity Modifier table from _itemorigins/origins.json -> mechanic_rules.i
const RARITY_MODIFIERS = {
  common: 1, uncommon: 2, rare: 3, "very rare": 4, veryrare: 4, legendary: 5
};

function rarityModifier(item) {
  const r = String(item?.system?.rarity ?? "").toLowerCase().trim();
  return RARITY_MODIFIERS[r] ?? 0;
}

function isAttuned(item) {
  // dnd5e 5.x ships both: system.attunement (string: "none"|"required") and
  // system.attuned (bool). We treat "attuned" as true iff system.attuned === true.
  return item?.system?.attuned === true;
}

// Compute active set bonuses for an actor.
// Returns: [{ slug, originDef, attunedItems, attunedCount,
//             hasGeneric, rarityModifierSum, allVeryRareOrLegendary,
//             tiers: { echo:bool, resonance:bool, harmony:bool } }]
// Sorted by attunedCount desc, then slug.
export function calculateSetBonuses(actor) {
  if (!actor?.items) return [];

  const byOrigin = new Map();
  for (const item of actor.items) {
    if (!isAttuned(item)) continue;
    const loot = getLootFlags(item);
    const slug = loot?.origin?.slug;
    if (!slug) continue;

    if (!byOrigin.has(slug)) {
      byOrigin.set(slug, {
        slug,
        originDef: OriginsRegistry.get(slug),
        attunedItems: [],
      });
    }
    byOrigin.get(slug).attunedItems.push({
      id: item.id,
      name: item.name,
      img: item.img,
      isNamed: loot.origin.isNamed === true,
      rarityModifier: rarityModifier(item),
      rarity: item.system?.rarity ?? "",
    });
  }

  const out = [];
  for (const group of byOrigin.values()) {
    const count = group.attunedItems.length;
    const hasGeneric = group.attunedItems.some(i => !i.isNamed);
    const rarityModifierSum = group.attunedItems.reduce((s, i) => s + i.rarityModifier, 0);
    const allVeryRareOrLegendary = group.attunedItems.every(i => i.rarityModifier >= 4);

    out.push({
      slug: group.slug,
      originDef: group.originDef,
      attunedItems: group.attunedItems,
      attunedCount: count,
      hasGeneric,
      rarityModifierSum,
      allVeryRareOrLegendary,
      tiers: {
        echo:      hasGeneric && count >= 1,
        resonance: count >= 2,
        harmony:   count >= 3,
      },
    });
  }

  out.sort((a, b) => b.attunedCount - a.attunedCount || a.slug.localeCompare(b.slug));
  return out;
}
