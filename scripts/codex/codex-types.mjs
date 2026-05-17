/* =============================================================
   Beneos Creature Codex — Master-Mock data contract (Welle 5a).
   Mirrors `INTEGRATION.md §4` from the codex-handoff folder.

   The codex window consumes a `CreatureCodex` object whose shape is
   defined below (as JSDoc). The data adapter (`codex-data-adapter.mjs`)
   produces this shape from actor + journal + token-DB inputs.
   ============================================================= */

/** 11 distinct chip kinds — each has its own CSS class
 *  (.cdx-chip-<kind>). Adding a new kind requires a new CSS rule. */
export const CHIP_KINDS = Object.freeze([
  "dice",       // 1d4, 2d8+3 → rollable
  "feature",    // Bountiful Gifts, Rake and Claw → cross-references
  "context",    // "When", "On Failure", "Options"
  "mechanic",   // Temporary Hit Points, Speed
  "action",     // BONUS ACTION, FREE ACTION, ATTACK
  "target",     // One Creature, One Target
  "range",      // 5 Ft., 10 Ft.
  "dc",         // DC 15 → rollable
  "save",       // Strength Saving Throw, …
  "condition",  // Grappled, Restrained, Frightened
  "attack",     // Melee Weapon Attack
  "tohit"       // +5 To Hit → rollable
])

/** Chip kinds that respond to click → produce a Foundry roll. */
export const ROLLABLE_KINDS = new Set(["dice", "dc", "tohit"])

/** The six playbook phases in turn-order. Used by the Tactics tab to
 *  walk through `tacticalGuide` slots one phase at a time. */
export const PLAYBOOK_PHASES = Object.freeze([
  { key: "startOfTurn",  num: 1, labelKey: "BENEOS.CreatureCodex.Phase.startOfTurn",
    hintKey: "BENEOS.CreatureCodex.Phase.startOfTurnHint" },
  { key: "movement",     num: 2, labelKey: "BENEOS.CreatureCodex.Phase.movement",
    hintKey: "BENEOS.CreatureCodex.Phase.movementHint" },
  { key: "actions",      num: 3, labelKey: "BENEOS.CreatureCodex.Phase.actions",
    hintKey: "BENEOS.CreatureCodex.Phase.actionsHint" },
  { key: "bonusActions", num: 4, labelKey: "BENEOS.CreatureCodex.Phase.bonusActions",
    hintKey: "BENEOS.CreatureCodex.Phase.bonusActionsHint" },
  { key: "freeActions",  num: 5, labelKey: "BENEOS.CreatureCodex.Phase.freeActions",
    hintKey: "BENEOS.CreatureCodex.Phase.freeActionsHint" },
  { key: "endOfTurn",    num: 6, labelKey: "BENEOS.CreatureCodex.Phase.endOfTurn",
    hintKey: "BENEOS.CreatureCodex.Phase.endOfTurnHint" }
])

/** Schema version. Bump when the CreatureCodex shape changes in a way
 *  that requires the adapter or templates to behave differently. */
export const CODEX_SCHEMA_VERSION = 2

/* ------------------------------------------------------------------
   JSDoc types — Foundry projects don't ship TypeScript by default
   but the IDE picks these up for autocomplete + hover hints.
   ------------------------------------------------------------------ */

/**
 * @typedef {Object} SizeTone
 * @property {string} primary   — top-left hex of the hero gradient
 * @property {string} secondary — bottom-right hex
 * @property {string} glow      — radial-gradient glow accent
 */

/**
 * @typedef {Object} StoryPrompt
 * @property {string} title
 * @property {1|2|3|4} tier  — campaign-integration tier badge
 * @property {string} text   — plain text or simple HTML
 */

/**
 * @typedef {Object} ForeshadowCheck
 * @property {number} dc
 * @property {string[]} skills
 * @property {string} [modifier]  — optional formula hint, e.g. "10+Insight"
 * @property {string} result      — what the players learn on success
 */

/**
 * @typedef {Object} Foreshadow
 * @property {string} title
 * @property {string} text
 * @property {ForeshadowCheck} [check]
 */

/**
 * @typedef {Object} AbilityPrompt
 * @property {string} name
 * @property {string} text  — read-aloud flavor
 */

/**
 * @typedef {Object} ChipPart
 * @property {string} chip
 * @property {typeof CHIP_KINDS[number]} kind
 */

/**
 * @typedef {(string|ChipPart)[]} TacText
 *   Mixed array of plain strings and chip objects. The renderer walks
 *   it left-to-right.
 */

/**
 * @typedef {Object} TacItem
 * @property {TacText} text
 * @property {TacItem[]} [children]
 */

/**
 * @typedef {Object} TacticalGuide
 * @property {TacItem[]} [startOfTurn]
 * @property {TacItem[]} [traits]
 * @property {TacItem[]} [movement]
 * @property {TacItem[]} [bonusActions]
 * @property {TacItem[]} [freeActions]
 * @property {TacItem[]} [actions]
 */

/**
 * @typedef {Object} CreatureCodex
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {number|null} cr
 * @property {string} [biome]
 * @property {string} [faction]
 * @property {string[]} [fightingStyle]
 * @property {string[]} [purpose]
 * @property {SizeTone} sizeTone
 * @property {string} portraitInitial
 * @property {string} [heroImageUrl]
 * @property {string} showcase
 * @property {string} lore
 * @property {StoryPrompt[]} storyPrompts
 * @property {Foreshadow[]} foreshadowing
 * @property {string} firstAppearance
 * @property {AbilityPrompt[]} abilityPrompts
 * @property {string} deathPrompt
 * @property {TacticalGuide} tacticalGuide
 * @property {string[]} [recommendedAllies]
 * @property {string[]} [tags]
 * @property {boolean} [pdfAvailable]
 * @property {Object} sourceMeta — adapter-internal: tokenKey, journalUuid, ...
 */
