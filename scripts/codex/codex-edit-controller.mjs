/* =============================================================
   Beneos Creature Codex — Edit controller (Welle 4).
   Persists section edits to `actor.flags.beneos-module.codex.edited.*`
   and arbitrates between concurrent codex windows via a module-scoped
   lock set. Section editing for list-shaped sections (hooks /
   foreshadowing / abilities) is reserved for Welle 4b.
   ============================================================= */

import { BeneosCreatureCodexParser } from "./codex-html-parser.mjs"

const MODULE_ID = "beneos-module"
const FLAG_KEY  = "codex"

/** Section paths that are list-shaped — Welle 4 refuses to edit them
 *  via the single-ProseMirror pattern and surfaces a Welle-4b hint
 *  instead. */
const LIST_SECTIONS = new Set(["hooks", "foreshadowing", "abilities"])

export function isListSection(sectionPath) {
  return LIST_SECTIONS.has(sectionPath)
}

/* ---------------- Lock set ---------------- */

function lockSet() {
  globalThis.game ??= {}
  game.beneos = game.beneos ?? {}
  game.beneos.codex = game.beneos.codex ?? {}
  game.beneos.codex.lockedSections = game.beneos.codex.lockedSections ?? new Set()
  return game.beneos.codex.lockedSections
}

export function lockKey(actorId, sectionPath) {
  return `${actorId}:${sectionPath}`
}

export function tryAcquireLock(actorId, sectionPath) {
  if (!actorId || !sectionPath) return true // mock / cloud-preview path
  const key = lockKey(actorId, sectionPath)
  const locks = lockSet()
  if (locks.has(key)) return false
  locks.add(key)
  return true
}

export function releaseLock(actorId, sectionPath) {
  if (!actorId || !sectionPath) return
  lockSet().delete(lockKey(actorId, sectionPath))
}

/* ---------------- Persistence ---------------- */

/** Routing helper for nested-vs-flat section paths. The actor flag
 *  layout is `edited.<key>` for top-level sections (lore, combatStarter,
 *  deathPrompt) and `edited.tactical.<sub>` for tactical sub-markers. */
function flagPathFor(sectionPath) {
  return `flags.${MODULE_ID}.${FLAG_KEY}.edited.${sectionPath}`
}

/** Persist HTML for a single section. Bails out for non-GMs and in
 *  Synology sync worlds. Returns true on success. */
export async function persistSection(actor, sectionPath, html) {
  if (!actor) return false
  if (!game.user?.isGM) return false
  const util = globalThis.BeneosUtility
  if (util?.isWorkWorld && !util.isWorkWorld()) {
    ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.SyncWorldReadOnly"))
    return false
  }
  const payload = {
    html,
    mtime: Date.now(),
    editor: game.user.id
  }
  await actor.update({ [flagPathFor(sectionPath)]: payload })
  return true
}

/** Persist a full list-shaped section (hooks / foreshadowing /
 *  abilities). The whole list lives under `edited.<section>` as an
 *  array of entry objects; we never partially-write, so reorder /
 *  remove / add operations all go through this single call. Empty
 *  array also persists, signalling "the GM explicitly cleared this
 *  section" — at render time the resolver treats it as an empty
 *  legacy list and shows the Add button. */
export async function persistListSection(actor, sectionPath, entries) {
  if (!actor) return false
  if (!game.user?.isGM) return false
  const util = globalThis.BeneosUtility
  if (util?.isWorkWorld && !util.isWorkWorld()) {
    ui.notifications.warn(game.i18n.localize("BENEOS.CreatureCodex.Warning.SyncWorldReadOnly"))
    return false
  }
  const stamped = (entries ?? []).map(e => ({
    ...e,
    mtime: e.mtime ?? Date.now()
  }))
  await actor.update({ [flagPathFor(sectionPath)]: stamped })
  return true
}

/** Remove an edit — the section falls back to parsed/legacy at the
 *  next render. Used by future "Revert to original" UX, kept here so
 *  the controller surface is complete. */
export async function clearSection(actor, sectionPath) {
  if (!actor || !game.user?.isGM) return false
  // Foundry deletion sigil: prefix the LEAF key with `-=`.
  const segments = `edited.${sectionPath}`.split(".")
  const leaf = segments.pop()
  const parentPath = `flags.${MODULE_ID}.${FLAG_KEY}.${segments.join(".")}.-=${leaf}`
  await actor.update({ [parentPath]: null })
  return true
}

/** Recompute the biography hash. Surfaces from the drift-banner click
 *  and from any GM-edit-roundtrip that wants to clear the warning. */
export async function reseedBiographyHash(actor) {
  if (!actor || !game.user?.isGM) return false
  const biography = actor.system?.details?.biography?.value ?? ""
  const hash = BeneosCreatureCodexParser.fnv1aHash(biography)
  await actor.setFlag(MODULE_ID, `${FLAG_KEY}.sourceMeta.biographyHash`, hash)
  return true
}
