/* =============================================================
   Beneos Creature Codex — Data Schema (Welle 6a).

   Single source of truth for what a creature's structured codex
   record looks like. The codex window reads ONLY this shape from
   `actor.flags.beneos-module.codex.data`; legacy HTML parsing is
   restricted to the migration pipeline (Welle 6b).

   See `docs/codex-data-schema.md` for the prose specification +
   worked examples (Cult Possessed, Bone Hag, custom NPC).

   Schema version is bumped whenever a field is renamed / removed
   so the migrator can route old flags through a one-time upgrade.
   ============================================================= */

export const CODEX_SCHEMA_VERSION = 1

/** Slot under which the structured record sits on the actor flag. */
export const CODEX_FLAG_NAMESPACE = "beneos-module"
export const CODEX_FLAG_KEY       = "codex"

/* ===================== Enumerations ===================== */

/** Tactical phase ordering — see `data.tactical[<key>]`. The
 *  order also drives the playbook stepper render. */
export const TACTICAL_PHASES = Object.freeze([
  "beforeCombat",
  "startOfTurn",
  "movement",
  "actions",
  "bonusActions",
  "freeActions",
  "reactions",
  "endOfTurn",
  "traits"
])

/** Ability classifier — drives the chip / category badge in the
 *  Combat Theater tab and the Tactics filter set. */
export const ABILITY_TYPES = Object.freeze([
  "action", "bonus", "free", "reaction", "legendary", "lair", "trait"
])

/** Story-Hook campaign-integration tier. Spans 1 (low-stakes,
 *  intro) → 4 (capstone). The Hooks tab renders a `T<n>` badge. */
export const STORY_TIERS = Object.freeze([1, 2, 3, 4])

/** Inline-text segment kinds — every entry of a `TacticalLine.text`
 *  array is either a plain string or one of these typed objects.
 *  Three of them are roll-triggers (see ROLLABLE_SEGMENTS). */
export const TEXT_SEGMENT_KINDS = Object.freeze([
  "string",       // bare string entry (no wrapper object)
  "ref",          // ability reference: { ref: "<slug>", label?: string }
  "roll",         // dice formula:      { roll: "1d4" }
  "dc",           // DC check:          { dc: 15, skills?: ["Strength Saving Throw"] }
  "tohit",        // to-hit modifier:   { tohit: 5 }
  "condition",    // status chip:       { condition: "Restrained" }
  "mechanic",     // mechanic chip:     { mechanic: "Speed", value?: "+10" }
  "context",      // context marker:    { context: "When ..." }
  "action",       // action-type chip:  { action: "bonus" }
  "target",       // target chip:       { target: "One Creature" }
  "range"         // range chip:        { range: "5 Ft." }
])

/** Segment kinds that, when clicked, fire a Foundry roll +
 *  chat-message via `codex-chip-roller.mjs`. */
export const ROLLABLE_SEGMENTS = new Set(["roll", "dc", "tohit"])

/** Filter tag set offered above the Tactics Cards mode. Keep in
 *  sync with `buildTacticsCards()` tag harvest. */
export const TACTICS_FILTER_TAGS = Object.freeze([
  "All", "Before Combat", "Start of Turn", "Movement",
  "Action", "Bonus Action", "Free Action", "Reaction", "Trait",
  "Save", "Attack", "Damage", "Condition"
])

/* ===================== JSDoc-Types ===================== */

/**
 * @typedef {Object} CodexIdentity
 * @property {string}   tokenKey       — primary key, e.g. "month_1_bone_hag"
 * @property {string}   name
 * @property {string}   type           — system-specific creature type
 * @property {number|null} cr
 * @property {string}   [biome]
 * @property {string}   [faction]
 * @property {string[]} [fightingStyle]
 * @property {string[]} [purpose]
 */

/**
 * @typedef {Object} SizeTone
 * @property {string} primary   — top-left of the hero gradient (#rrggbb)
 * @property {string} secondary — bottom-right
 * @property {string} glow      — radial accent
 */

/**
 * @typedef {Object} CodexVisuals
 * @property {SizeTone} sizeTone
 * @property {string}   portraitInitial      — single character fallback
 * @property {string}   [heroImageUrl]       — relative asset path
 * @property {string}   [heroImageBase64]    — optional dataURL cache
 * @property {string}   [heroImageCachedAt]  — ISO timestamp of last cache
 */

/**
 * @typedef {Object} CodexNarrative
 * @property {string}   showcase           — 1–2 sentence hero subtitle
 * @property {string}   lore               — longer paragraph for Overview
 * @property {string[]} recommendedAllies
 */

/**
 * @typedef {Object} CodexAbility
 * @property {string} id              — lowercase_with_underscores slug
 * @property {string} name
 * @property {typeof ABILITY_TYPES[number]} type
 * @property {string} flavorText      — read-aloud during combat
 * @property {string} [mechanicalText] — optional mechanical summary
 */

/**
 * @typedef {Object} CodexStoryHook
 * @property {string} id
 * @property {1|2|3|4} tier
 * @property {string} title
 * @property {string} description
 */

/**
 * @typedef {Object} CodexCheckBox
 * @property {number}   dc
 * @property {string[]} skills
 * @property {string}   result      — what players learn on success
 */

/**
 * @typedef {Object} CodexCountermeasure
 * @property {number}   dc            — typically higher than primary check
 * @property {string[]} skills
 * @property {string}   result
 * @property {string}   [preparation] — what players can do in advance
 */

/**
 * @typedef {Object} CodexForeshadow
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {CodexCheckBox}        [check]
 * @property {CodexCountermeasure}  [countermeasure]
 */

/**
 * @typedef {Object} CodexCombat
 * @property {string} firstAppearance   — dramatic encounter intro
 * @property {string} deathPrompt       — read-aloud on hp ≤ 0
 */

/**
 * @typedef {(string|RefSegment|RollSegment|DcSegment|ToHitSegment|ConditionSegment|MechanicSegment|ContextSegment|ActionSegment|TargetSegment|RangeSegment)[]} TacText
 */
/** @typedef {Object} RefSegment       @property {string} ref @property {string} [label] */
/** @typedef {Object} RollSegment      @property {string} roll */
/** @typedef {Object} DcSegment        @property {number} dc @property {string[]} [skills] */
/** @typedef {Object} ToHitSegment     @property {number} tohit */
/** @typedef {Object} ConditionSegment @property {string} condition */
/** @typedef {Object} MechanicSegment  @property {string} mechanic @property {string} [value] */
/** @typedef {Object} ContextSegment   @property {string} context */
/** @typedef {Object} ActionSegment    @property {"action"|"bonus"|"free"|"reaction"|"legendary"|"lair"} action */
/** @typedef {Object} TargetSegment    @property {string} target */
/** @typedef {Object} RangeSegment     @property {string} range */

/**
 * @typedef {Object} TacticalLine
 * @property {TacText} text
 * @property {TacticalLine[]} [children]
 */

/**
 * @typedef {Object} CodexTactical
 * @property {TacticalLine[]} [beforeCombat]
 * @property {TacticalLine[]} [startOfTurn]
 * @property {TacticalLine[]} [movement]
 * @property {TacticalLine[]} [actions]
 * @property {TacticalLine[]} [bonusActions]
 * @property {TacticalLine[]} [freeActions]
 * @property {TacticalLine[]} [reactions]
 * @property {TacticalLine[]} [endOfTurn]
 * @property {TacticalLine[]} [traits]
 */

/**
 * @typedef {Object} CodexData       — the full structured record
 * @property {CodexIdentity}     identity
 * @property {CodexVisuals}      visuals
 * @property {CodexNarrative}    narrative
 * @property {CodexAbility[]}    abilities
 * @property {CodexStoryHook[]}  storyHooks
 * @property {CodexForeshadow[]} foreshadowing
 * @property {CodexCombat}       combat
 * @property {CodexTactical}     tactical
 */

/**
 * @typedef {Object} CodexFlagEnvelope — the actor-flag root
 * @property {number}    $version  — `CODEX_SCHEMA_VERSION`
 * @property {string}    $migrated — ISO timestamp of last migration
 * @property {CodexData} data
 */

/* ===================== Validator ===================== */

const SLUG_RE = /^[a-z][a-z0-9_]*$/
const HEX_RE  = /^#[0-9a-f]{3,8}$/i
const ISO_RE  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function isStr(v) { return typeof v === "string" }
function isNum(v) { return typeof v === "number" && Number.isFinite(v) }
function isObj(v) { return v && typeof v === "object" && !Array.isArray(v) }
function isArr(v) { return Array.isArray(v) }

/** Validate a fully-built CodexData. Returns `{ valid, errors }`
 *  where `errors` is an array of human-readable strings keyed by
 *  dot-path so the migrator UI can highlight the offending field. */
export function validateCodexData(data) {
  const errors = []
  const push = (path, msg) => errors.push(`${path}: ${msg}`)

  if (!isObj(data)) {
    return { valid: false, errors: ["root: data must be an object"] }
  }

  // ---- identity ----
  const id = data.identity
  if (!isObj(id)) push("identity", "missing object")
  else {
    if (!isStr(id.tokenKey) || !id.tokenKey) push("identity.tokenKey", "required string")
    if (!isStr(id.name) || !id.name)         push("identity.name", "required string")
    if (!isStr(id.type))                     push("identity.type", "must be a string")
    if (id.cr != null && !isNum(id.cr))       push("identity.cr", "must be number or null")
    for (const k of ["fightingStyle", "purpose"]) {
      if (id[k] != null && (!isArr(id[k]) || id[k].some(v => !isStr(v)))) {
        push(`identity.${k}`, "must be an array of strings")
      }
    }
  }

  // ---- visuals ----
  const v = data.visuals
  if (!isObj(v)) push("visuals", "missing object")
  else {
    if (!isObj(v.sizeTone)) push("visuals.sizeTone", "missing object")
    else {
      for (const k of ["primary", "secondary", "glow"]) {
        if (!isStr(v.sizeTone[k]) || !HEX_RE.test(v.sizeTone[k])) {
          push(`visuals.sizeTone.${k}`, `must be a hex colour, got ${JSON.stringify(v.sizeTone[k])}`)
        }
      }
    }
    if (!isStr(v.portraitInitial) || v.portraitInitial.length === 0) {
      push("visuals.portraitInitial", "must be a non-empty string (typically 1 character)")
    }
    if (v.heroImageBase64 != null && !isStr(v.heroImageBase64)) {
      push("visuals.heroImageBase64", "must be a string (dataURL) when present")
    }
    if (v.heroImageCachedAt != null && !ISO_RE.test(v.heroImageCachedAt)) {
      push("visuals.heroImageCachedAt", "must be an ISO timestamp when present")
    }
  }

  // ---- narrative ----
  const n = data.narrative
  if (!isObj(n)) push("narrative", "missing object")
  else {
    if (n.showcase != null && !isStr(n.showcase)) push("narrative.showcase", "must be string")
    if (n.lore     != null && !isStr(n.lore))     push("narrative.lore", "must be string")
    if (n.recommendedAllies != null &&
        (!isArr(n.recommendedAllies) || n.recommendedAllies.some(s => !isStr(s)))) {
      push("narrative.recommendedAllies", "must be array of strings")
    }
  }

  // ---- abilities ----
  const abilityIds = new Set()
  if (!isArr(data.abilities)) push("abilities", "must be an array")
  else {
    data.abilities.forEach((a, i) => {
      const p = `abilities[${i}]`
      if (!isObj(a)) { push(p, "must be an object"); return }
      if (!isStr(a.id) || !SLUG_RE.test(a.id)) push(`${p}.id`, "must be a lowercase_with_underscores slug")
      if (abilityIds.has(a.id))                push(`${p}.id`, `duplicate id "${a.id}"`)
      else if (a.id)                            abilityIds.add(a.id)
      if (!isStr(a.name) || !a.name)            push(`${p}.name`, "required string")
      if (!ABILITY_TYPES.includes(a.type))      push(`${p}.type`, `must be one of ${ABILITY_TYPES.join("|")}`)
      if (a.flavorText != null && !isStr(a.flavorText))         push(`${p}.flavorText`, "must be string")
      if (a.mechanicalText != null && !isStr(a.mechanicalText)) push(`${p}.mechanicalText`, "must be string")
    })
  }

  // ---- storyHooks ----
  if (!isArr(data.storyHooks)) push("storyHooks", "must be an array")
  else {
    data.storyHooks.forEach((h, i) => {
      const p = `storyHooks[${i}]`
      if (!isObj(h)) { push(p, "must be an object"); return }
      if (!isStr(h.id) || !h.id)              push(`${p}.id`, "required string")
      if (!STORY_TIERS.includes(h.tier))      push(`${p}.tier`, `must be one of ${STORY_TIERS.join("|")}`)
      if (!isStr(h.title) || !h.title)        push(`${p}.title`, "required string")
      if (h.description != null && !isStr(h.description)) push(`${p}.description`, "must be string")
    })
  }

  // ---- foreshadowing ----
  if (!isArr(data.foreshadowing)) push("foreshadowing", "must be an array")
  else {
    data.foreshadowing.forEach((f, i) => {
      const p = `foreshadowing[${i}]`
      if (!isObj(f)) { push(p, "must be an object"); return }
      if (!isStr(f.id) || !f.id)        push(`${p}.id`, "required string")
      if (!isStr(f.title) || !f.title)  push(`${p}.title`, "required string")
      if (f.description != null && !isStr(f.description)) push(`${p}.description`, "must be string")
      if (f.check != null) validateCheck(f.check, `${p}.check`, push)
      if (f.countermeasure != null) {
        validateCheck(f.countermeasure, `${p}.countermeasure`, push)
        if (f.countermeasure.preparation != null && !isStr(f.countermeasure.preparation)) {
          push(`${p}.countermeasure.preparation`, "must be string")
        }
      }
    })
  }

  // ---- combat ----
  const c = data.combat
  if (!isObj(c)) push("combat", "missing object")
  else {
    if (c.firstAppearance != null && !isStr(c.firstAppearance)) push("combat.firstAppearance", "must be string")
    if (c.deathPrompt     != null && !isStr(c.deathPrompt))     push("combat.deathPrompt", "must be string")
  }

  // ---- tactical ----
  const t = data.tactical
  if (!isObj(t)) push("tactical", "missing object")
  else {
    for (const phase of TACTICAL_PHASES) {
      if (t[phase] == null) continue
      if (!isArr(t[phase])) { push(`tactical.${phase}`, "must be an array of TacticalLine objects"); continue }
      t[phase].forEach((line, i) => validateTacticalLine(line, `tactical.${phase}[${i}]`, push, abilityIds))
    }
    for (const k of Object.keys(t)) {
      if (!TACTICAL_PHASES.includes(k)) push(`tactical.${k}`, "unknown phase key")
    }
  }

  return { valid: errors.length === 0, errors }
}

function validateCheck(check, path, push) {
  if (!isObj(check)) return push(path, "must be object")
  if (!isNum(check.dc) || check.dc <= 0)  push(`${path}.dc`, "must be a positive number")
  if (!isArr(check.skills) || check.skills.some(s => !isStr(s))) {
    push(`${path}.skills`, "must be an array of strings")
  }
  if (check.result != null && !isStr(check.result)) push(`${path}.result`, "must be string")
}

function validateTacticalLine(line, path, push, abilityIds) {
  if (!isObj(line))    return push(path, "must be a TacticalLine object")
  if (!isArr(line.text)) return push(`${path}.text`, "must be an array of TextSegments")
  line.text.forEach((seg, i) => validateTextSegment(seg, `${path}.text[${i}]`, push, abilityIds))
  if (line.children != null) {
    if (!isArr(line.children)) push(`${path}.children`, "must be an array of TacticalLine objects")
    else line.children.forEach((c, j) => validateTacticalLine(c, `${path}.children[${j}]`, push, abilityIds))
  }
}

function validateTextSegment(seg, path, push, abilityIds) {
  if (isStr(seg)) return // plain text — fine
  if (!isObj(seg)) return push(path, "must be a string or typed segment object")
  const keys = Object.keys(seg).filter(k => !["label", "skills", "value"].includes(k))
  if (keys.length !== 1) {
    return push(path, `expected exactly one of ${TEXT_SEGMENT_KINDS.slice(1).join("|")}, got keys ${JSON.stringify(Object.keys(seg))}`)
  }
  const kind = keys[0]
  if (!TEXT_SEGMENT_KINDS.includes(kind)) return push(path, `unknown segment kind "${kind}"`)

  if (kind === "ref") {
    if (!isStr(seg.ref) || !SLUG_RE.test(seg.ref)) return push(`${path}.ref`, "must be a slug")
    if (abilityIds && !abilityIds.has(seg.ref))    push(`${path}.ref`, `references unknown ability id "${seg.ref}"`)
    if (seg.label != null && !isStr(seg.label))    push(`${path}.label`, "must be a string when present")
  }
  if (kind === "roll"  && (!isStr(seg.roll) || seg.roll.length === 0)) push(`${path}.roll`, "must be a non-empty formula string")
  if (kind === "dc")   {
    if (!isNum(seg.dc) || seg.dc <= 0) push(`${path}.dc`, "must be a positive number")
    if (seg.skills != null && (!isArr(seg.skills) || seg.skills.some(s => !isStr(s)))) {
      push(`${path}.skills`, "must be array of strings when present")
    }
  }
  if (kind === "tohit" && !isNum(seg.tohit)) push(`${path}.tohit`, "must be a number")
  if (kind === "action" && !["action","bonus","free","reaction","legendary","lair"].includes(seg.action)) {
    push(`${path}.action`, `must be action|bonus|free|reaction|legendary|lair`)
  }
  for (const k of ["condition", "mechanic", "context", "target", "range"]) {
    if (kind === k && !isStr(seg[k])) push(`${path}.${k}`, "must be a string")
  }
  if (kind === "mechanic" && seg.value != null && !isStr(seg.value)) {
    push(`${path}.value`, "must be a string when present")
  }
}

/* ===================== Empty-Stub Factory ===================== */

/** Produce an empty-but-valid CodexData object — useful when the
 *  migrator needs to start from scratch (custom NPC, no journal). */
export function emptyCodexData(tokenKey = "", name = "") {
  return {
    identity: {
      tokenKey, name, type: "", cr: null,
      biome: "", faction: "",
      fightingStyle: [], purpose: []
    },
    visuals: {
      sizeTone: { primary: "#2a2014", secondary: "#14100a", glow: "#f5c992" },
      portraitInitial: (name?.[0] ?? "?").toUpperCase(),
      heroImageUrl: "", heroImageBase64: "", heroImageCachedAt: ""
    },
    narrative: { showcase: "", lore: "", recommendedAllies: [] },
    abilities: [],
    storyHooks: [],
    foreshadowing: [],
    combat: { firstAppearance: "", deathPrompt: "" },
    tactical: {}
  }
}
