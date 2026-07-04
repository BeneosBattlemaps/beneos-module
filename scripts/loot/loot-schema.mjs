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

// The installer always uploads the item cards to a fixed local location keyed
// by the install itemKey (world.beneos.itemKey), regardless of the item's
// source: beneos_assets/cloud/items/<key>/<key>-front.webp (and -back.webp).
// The stored loot.render.*CardWebp paths come straight from the server JSON and
// are NOT rewritten on install, so for SRD items (different key convention)
// they point nowhere. Reconstructing from the itemKey heals that at render
// time (and stays correct for Originals, same folder as the working icon).
export function beneosCloudCardPaths(itemDoc) {
  const key = itemDoc?.getFlag?.("world", "beneos")?.itemKey;
  if (!key) return { front: null, back: null };
  const base = `beneos_assets/cloud/items/${key}/${key}`;
  return { front: `${base}-front.webp`, back: `${base}-back.webp` };
}

// SRD classification per the project standard (same rule as
// BeneosUtility.SRD_KEY_RE). SRD items have no Origin, so the panels must not
// try to render an origin emblem / "Origin" label for them.
export function isBeneosSrdItem(itemDoc, loot) {
  const key  = String(itemDoc?.getFlag?.("world", "beneos")?.itemKey || "");
  const slug = String(loot?.origin?.slug || "").toLowerCase();
  return /(?:^|[-_])srd[-_]/i.test(key) || slug === "srd";
}
