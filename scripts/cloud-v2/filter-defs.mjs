// Dropdown filter definitions of the Beneos Cloud window (V2). Moved out of
// cloud-window-v2.mjs in MO-043 so a test can read the real table instead of
// a copy; the window imports it unchanged.
//
// Property keys (mirrors a subset of the v1 __propertyDefList from
// beneos_search_engine.js). Keeping it local avoids exporting the v1
// internal, the V2 filter logic only needs the selector to property name
// mapping.
// Wave B-8h-1: each entry now declares which asset types it applies to.
// Without this, switching tabs (e.g. Maps to Creatures) crashed because
// the OLD bmap selectors (still in the DOM until the sidebar re-renders)
// had stale values and #applyDropdownFilters fired searchByProperty for
// "grid" on a token, where item.properties.grid is undefined and v1's
// helper does `item.properties.grid.match(...)` (beneos_search_engine.js:700).
export const V2_FILTER_DEFS = [
  // Tokens
  { types: ["token"], selector: "faction-selector",       prop: "faction"       },
  { types: ["token"], selector: "campaign-selector",      prop: "campaign"      },
  { types: ["token"], selector: "token-types",            prop: "type"          },
  { types: ["token", "item", "spell"], selector: "installation-selector",  prop: "installed"     },
  { types: ["token"], selector: "token-fight-style",      prop: "fightingstyle" },
  { types: ["token"], selector: "token-purpose",          prop: "purpose"       },
  // Battlemaps
  // Wave B-8k-2: bmap-bioms-selector dropped, biome is now a chip-
  // dropdown shared with the token mode, filtered via #applyBiomeFilter.
  { types: ["bmap"],  selector: "bmap-brightness",        prop: "brightness"    },
  { types: ["bmap"],  selector: "bmap-adventure",         prop: "adventure"     },
  { types: ["bmap"],  selector: "bmap-grid",              prop: "grid"          },
  { types: ["bmap"],  selector: "kind-selector",          prop: "type"          },
  // Items
  { types: ["item"],  selector: "item-type",              prop: "item_type"     },
  // Rarity matches exactly (strict): the values "common"/"rare" are substrings of
  // "uncommon"/"very rare", so a substring match would over-select.
  { types: ["item"],  selector: "rarity-selector",        prop: "rarity", strict: true },
  // Origin matches exactly too: "arcane" is a substring of "technoarcane" (MO-043).
  { types: ["item"],  selector: "origin-selector",        prop: "origin", strict: true },
  // Wave B-8i-3: tier dropdown for items (was already in dbHolder.getData()
  // as `tier` but had no V2 surface).
  { types: ["item"],  selector: "tier-selector",          prop: "tier"          },
  // Own id beside the spell tab's class-selector, one id per tab like the rest.
  { types: ["item"],  selector: "item-class-selector",    prop: "classes"       },
  // Spells
  { types: ["spell"], selector: "level-selector",         prop: "level"         },
  { types: ["spell"], selector: "school-selector",        prop: "school"        },
  { types: ["spell"], selector: "class-selector",         prop: "classes"       },
  // Wave B-8e-fix-3: spell DB exposes casting_time (Action / Bonus
  // Action / Reaction / 1 Minute / 10 Minutes / 1 Hour) and spell_type
  // (Area Damage / Buff / Curse / Debuff / Melee Damage / Mobility /
  // Protection / Ranged Damage / Regeneration / Restoration / Summon /
  // Utility / etc.), both deserve their own dropdown.
  { types: ["spell"], selector: "casting-time-selector",  prop: "casting_time"  },
  { types: ["spell"], selector: "spell-type-selector",    prop: "spell_type"    }
]
