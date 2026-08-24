/**
 * Beneos Ability Icons
 *
 * Every embedded ability, feat, weapon and spell of a Beneos creature is
 * supposed to draw its icon from the module's own central pool,
 * `modules/beneos-module/icons/ability_icons/`. Most authored actors already
 * do. A minority does not: some spells still carry a path into the authoring
 * asset tree (`beneos_assets/beneos_spells/...`), which no customer ever has
 * because the installer writes to `beneos_assets/cloud/spells/...`, and the
 * creature import does not carry spell art along at all. Others carry a
 * Foundry core icon, which is not a Beneos icon either. Both show up as a
 * broken or foreign image on the actor sheet.
 *
 * The pool ships with `icons/ability_icons_taxonomy.json`, which classifies
 * all 2216 files by school, motif, mood and color. Until now not a single
 * line of code read that file. This module is its first consumer: it picks an
 * icon that matches the ability's school, and it picks it deterministically
 * from the ability's name, so the same spell lands on the same icon on every
 * machine and after every re-install.
 */

import { BeneosUtility } from "../beneos_utility.js"

const TAXONOMY_REL = "icons/ability_icons_taxonomy.json"
const ICON_DIR_REL = "icons/ability_icons"

// The only paths that are correct. Everything else on an embedded item gets
// replaced, per the product rule that ability art comes from the module's own
// pool. A sweep over all 730 authored actors backs that up: of 5154 embedded
// items, 97.2 % already point here, and every single exception is broken or
// foreign art. The authoring tree (`beneos_assets/beneos_*`) exists on no
// customer machine. The cloud tree (`beneos_assets/cloud/spells/*`) only
// exists if the customer separately bought and installed that very spell,
// because the creature import carries no spell art. Foundry core icons
// (`icons/*`), dnd5e placeholders (`systems/*`) and leftovers from the old
// authoring tool (`Iconpack/*`) are not ours either.
const MODULE_ICON_RE = /^modules\/[^/]+\/icons\//i

// dnd5e damage types carry more signal than the spell school does, so they
// win when both are present. A fire bolt is fire art whatever its school.
const DAMAGE_TO_SCHOOL = {
  fire: "fire",
  cold: "ice_water",
  lightning: "lightning_air",
  thunder: "lightning_air",
  acid: "poison_disease",
  poison: "poison_disease",
  necrotic: "shadow_death",
  radiant: "holy_light",
  psychic: "arcane_illusion",
  force: "force_physical",
  bludgeoning: "force_physical",
  piercing: "force_physical",
  slashing: "force_physical"
}

// dnd5e spell school codes. Evocation deliberately does NOT map to fire:
// without a damage type there is nothing that says which element it is, and
// the damage table above already catches the elemental cases.
const SPELL_SCHOOL_TO_SCHOOL = {
  abj: "force_physical",
  con: "beast_primal",
  div: "arcane_illusion",
  enc: "arcane_illusion",
  evo: "arcane_illusion",
  ill: "arcane_illusion",
  nec: "shadow_death",
  trs: "arcane_illusion"
}

// Plenty of abilities carry no damage type at all, and the bare spell school
// is too coarse on its own: Gust of Wind and Fog Cloud are both "no damage,
// evocation or conjuration" and would end up on whatever art that maps to.
// The name is the better signal in those cases, so it is consulted before the
// school. First match in this list wins, so order matters.
const NAME_KEYWORDS = [
  [/\b(fire|flame|burn|ember|ash|inferno|scorch|blaze|heat|magma|lava)\b/i, "fire"],
  [/\b(ice|frost|freez|cold|chill|snow|glacial|water|wave|tide|rain|mist|fog|steam)\b/i, "ice_water"],
  [/\b(storm|thunder|lightning|bolt|shock|spark|wind|gale|gust|air|sky|tempest|cloud)\b/i, "lightning_air"],
  [/\b(earth|stone|rock|root|vine|thorn|grove|moss|bark|tree|leaf|nature|quake|sand)\b/i, "nature_earth"],
  [/\b(holy|divine|radiant|light|bless|sacred|sun|dawn|heal|cure|ward|sanctuar)\b/i, "holy_light"],
  [/\b(shadow|dark|night|death|necro|undead|grave|soul|wraith|spectr|doom|curse|rot)\b/i, "shadow_death"],
  [/\b(poison|venom|toxic|plague|disease|acid|corros|blight|spore|fester)\b/i, "poison_disease"],
  [/\b(blood|gore|bleed|crimson|sanguine|vein)\b/i, "blood"],
  [/\b(beast|claw|talon|fang|bite|horn|hoof|maw|wing|swarm|pack|primal|feral|animal)\b/i, "beast_primal"],
  [/\b(demon|devil|infernal|fiend|hell|abyss|profane|unholy)\b/i, "demonic_infernal"],
  [/\b(arcane|magic|spell|illusion|phantom|mirror|charm|mind|psychic|dream|rune|sigil)\b/i, "arcane_illusion"],
  [/\b(strike|slash|blade|sword|axe|hammer|spear|arrow|shot|attack|shield|armor|guard|force)\b/i, "force_physical"]
]

const ITEM_TYPE_TO_SCHOOL = {
  weapon: "force_physical",
  feat: "neutral",
  consumable: "neutral",
  equipment: "force_physical"
}

let _bySchool = null      // school -> sorted filename[]
let _loadPromise = null

function _modulePath(rel) {
  const base = `modules/${BeneosUtility.moduleID()}/${rel}`
  return foundry.utils?.getRoute?.(base) || base
}

/**
 * Read the taxonomy once and group the filenames by school. Sorting matters:
 * the deterministic pick indexes into this array, so a stable order is what
 * makes the choice reproducible across machines.
 */
async function _load() {
  if (_bySchool) return _bySchool
  if (_loadPromise) return _loadPromise
  _loadPromise = (async () => {
    const grouped = {}
    try {
      const res = await fetch(_modulePath(TAXONOMY_REL))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      for (const [file, meta] of Object.entries(data?.icons || {})) {
        const school = String(meta?.school || "neutral")
        ;(grouped[school] ||= []).push(file)
      }
      for (const list of Object.values(grouped)) list.sort()
    } catch (err) {
      console.warn("Beneos | ability-icons: taxonomy unavailable, embedded icons stay as authored", err)
    }
    _bySchool = grouped
    return grouped
  })()
  return _loadPromise
}

/** FNV-1a. Any stable hash would do; this one is short and has no deps. */
function _hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Best guess at a school for one embedded item. Never throws. */
function _schoolOf(item) {
  const sys = item?.system || {}

  // 1) damage type, wherever this dnd5e version keeps it
  const damageTypes = new Set()
  try {
    for (const part of sys.damage?.parts || []) {
      if (Array.isArray(part) && part[1]) damageTypes.add(String(part[1]).toLowerCase())
    }
    for (const t of sys.damage?.base?.types || []) damageTypes.add(String(t).toLowerCase())
    for (const act of Object.values(sys.activities || {})) {
      for (const part of act?.damage?.parts || []) {
        for (const t of part?.types || []) damageTypes.add(String(t).toLowerCase())
      }
    }
  } catch (_) { /* shape differs across dnd5e versions, guessing is optional */ }
  for (const t of damageTypes) {
    if (DAMAGE_TO_SCHOOL[t]) return DAMAGE_TO_SCHOOL[t]
  }

  // 2) the ability's own name
  const name = String(item?.name || "")
  for (const [re, school] of NAME_KEYWORDS) {
    if (re.test(name)) return school
  }

  // 3) spell school
  const school = String(sys.school || "").toLowerCase()
  if (SPELL_SCHOOL_TO_SCHOOL[school]) return SPELL_SCHOOL_TO_SCHOOL[school]

  // 4) item type, then give up
  return ITEM_TYPE_TO_SCHOOL[String(item?.type || "").toLowerCase()] || "neutral"
}

/**
 * Pick an icon path for one embedded item, or null when the pool could not be
 * read. Deterministic in the item's name and type.
 */
export async function resolveAbilityIcon(item) {
  const bySchool = await _load()
  const school = _schoolOf(item)
  const pool = (bySchool[school]?.length ? bySchool[school] : bySchool.neutral) || []
  if (pool.length === 0) return null
  const idx = _hash(`${item?.name || ""}|${item?.type || ""}`) % pool.length
  return `modules/${BeneosUtility.moduleID()}/${ICON_DIR_REL}/${pool[idx]}`
}

/** True when this img has to be replaced. Applies to the item's own icon. */
export function needsBeneosIcon(img) {
  const s = String(img || "").trim()
  return !s || !MODULE_ICON_RE.test(s)
}

/**
 * Narrower gate, used for active-effect icons. Only paths that cannot resolve
 * on a customer machine are touched, which is anything pointing into the asset
 * tree, because the creature import uploads no spell or item art.
 *
 * Foundry's own effect icons are deliberately left alone. They are small
 * status overlays on the token, the core set is what players recognise, and
 * repainting roughly 950 of them across the catalog with ability art would be
 * a visual change nobody asked for. The item icon above is a different matter:
 * there the module pool is the authored norm at 97.2 %.
 */
export function isUnresolvableAssetIcon(img) {
  const s = String(img || "").trim()
  if (!s) return false
  if (MODULE_ICON_RE.test(s)) return false
  return /^beneos_assets\//i.test(s)
}

/**
 * Rewrite authoring asset paths inside a description to the cloud namespace,
 * the same swap the standalone item and spell imports already do for their own
 * documents. The embedded ones never had it, which is why a creature sheet
 * could show card art pointing at a folder that exists on no customer machine.
 *
 * The shared `spell_card_back.webp` gets special treatment. It is the old card
 * architecture: one generic back for every spell. Today each card carries its
 * own back, and the shared file is not part of any upload. Where the same
 * description reveals which spell it belongs to, the reference is moved to
 * that spell's own back; otherwise it is dropped rather than left dangling.
 */
export function rewriteEmbeddedDescription(html) {
  if (typeof html !== "string" || !html.includes("beneos_assets/beneos_")) return html
  let out = html

  const slug = out.match(/beneos_assets\/beneos_spells\/([^/"']+)\//)?.[1] || null
  if (slug) {
    out = out.split("beneos_assets/beneos_spells/spell_card_back.webp")
      .join(`beneos_assets/cloud/spells/${slug}/${slug}-back.webp`)
  } else {
    out = out.replace(/<img[^>]*beneos_assets\/beneos_spells\/spell_card_back\.webp[^>]*>/gi, "")
  }

  out = out.split("beneos_assets/beneos_spells/").join("beneos_assets/cloud/spells/")
  out = out.split("beneos_assets/beneos_items/").join("beneos_assets/cloud/items/")
  return out
}

/**
 * Normalise every embedded item of an actor payload in place, right before the
 * Actor document is constructed. Returns how many icons were replaced, for the
 * install log.
 */
export async function normalizeEmbeddedItems(actorData) {
  const items = Array.isArray(actorData?.items) ? actorData.items : null
  if (!items || items.length === 0) return 0
  let replaced = 0
  for (const item of items) {
    if (needsBeneosIcon(item?.img)) {
      const icon = await resolveAbilityIcon(item)
      if (icon) {
        item.img = icon
        replaced += 1
      }
    }

    // Active-effect icons need the same treatment. The standalone item and
    // spell imports point theirs at the cloud namespace, which is right there
    // because those imports upload the art. Here nothing is uploaded, so the
    // module pool is the only path that resolves. The effect's own name is the
    // better hint when it has one.
    for (const effect of Array.isArray(item?.effects) ? item.effects : []) {
      if (!isUnresolvableAssetIcon(effect?.img)) continue
      const icon = await resolveAbilityIcon({ name: effect?.name || item?.name, type: item?.type, system: item?.system })
      if (icon) {
        effect.img = icon
        replaced += 1
      }
    }

    const desc = item?.system?.description?.value
    if (typeof desc === "string") {
      const next = rewriteEmbeddedDescription(desc)
      if (next !== desc) item.system.description.value = next
    }
  }
  return replaced
}
