// Flag-schema constants and accessor helpers for Beneos Loot Items
// (flags.beneos-module.loot) and Beneos Spells (flags.beneos-module.spell).
// The Card Creator writes these flags on publish; the module reads them to
// render the item sheet and to compute Origin set bonuses on the actor sheet.

export const LOOT_SCHEMA_VERSION  = 1;
export const SPELL_SCHEMA_VERSION = 1;

export const BENEOS_LOOT_FLAG_SCOPE = "beneos-module";
export const BENEOS_LOOT_FLAG_KEY   = "loot";
export const BENEOS_SPELL_FLAG_KEY  = "spell";

export const BENEOS_LOOT_FLAG_PATH  = `flags.${BENEOS_LOOT_FLAG_SCOPE}.${BENEOS_LOOT_FLAG_KEY}`;
export const BENEOS_SPELL_FLAG_PATH = `flags.${BENEOS_LOOT_FLAG_SCOPE}.${BENEOS_SPELL_FLAG_KEY}`;

export function getLootFlags(itemDoc) {
  return itemDoc?.getFlag?.(BENEOS_LOOT_FLAG_SCOPE, BENEOS_LOOT_FLAG_KEY) ?? null;
}

export function getSpellFlags(itemDoc) {
  if (itemDoc?.type !== "spell") return null;
  return itemDoc?.getFlag?.(BENEOS_LOOT_FLAG_SCOPE, BENEOS_SPELL_FLAG_KEY) ?? null;
}

export function isBeneosLootItem(itemDoc) {
  return !!getLootFlags(itemDoc);
}

export function isBeneosSpell(itemDoc) {
  return !!getSpellFlags(itemDoc);
}
