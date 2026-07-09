/* =============================================================
   Beneos Creature Codex — Lazy migrator (Welle 2).
   Ensures `actor.flags.beneos-module.codex` exists with a v1 schema
   the data adapter can rely on. Idempotent: re-running on a migrated
   actor is a no-op. Does NOT populate `parsed.*` — that tier is only
   filled by the generation pipeline (Welle 0).
   ============================================================= */

import { BeneosCreatureCodexParser } from "./codex-html-parser.mjs"

const MODULE_ID = "beneos-module"
const FLAG_KEY  = "codex"
const SCHEMA_VERSION = 1

const JOURNAL_PACK_ID = "world.beneos_module_journal"

/** Pull the Beneos world flag set on imported creatures (`world.beneos`).
 *  Returns an empty object for non-Beneos actors so the caller can fall
 *  back to a minimal sourceMeta without throwing. */
function readWorldFlag(actor) {
  return actor?.getFlag("world", "beneos") ?? {}
}

/** Resolve the journal entry for a creature. Pattern mirrors
 *  beneos_module.js:259-265 — the journalId lives on the actor's
 *  `world.beneos` flag, and the entry sits in the
 *  `world.beneos_module_journal` compendium pack.
 *  Returns the JournalEntry document or null when:
 *    - no journalId is set (custom actor)
 *    - the pack is missing (fresh world)
 *    - the document is no longer in the pack (cleanup) */
async function resolveJournalEntry(actor) {
  const { journalId } = readWorldFlag(actor)
  if (!journalId) return null
  const pack = game.packs?.get(JOURNAL_PACK_ID)
  if (!pack) return null
  try {
    return await pack.getDocument(journalId)
  } catch (err) {
    console.warn("[beneos-codex] journal lookup failed", journalId, err)
    return null
  }
}

/** Lazy-migration entry point. Reads any existing codex flag and, if
 *  it is current, returns it. Otherwise writes a fresh v1 envelope and
 *  returns that. Never overwrites GM edits — the migration only
 *  ever creates a missing flag, never edits an existing one. */
export async function ensureCodexFlags(actor) {
  if (!actor) return null
  const existing = actor.getFlag(MODULE_ID, FLAG_KEY)
  if (existing && existing.version === SCHEMA_VERSION) return existing

  const worldFlag = readWorldFlag(actor)
  const tokenKey  = worldFlag.fullId ?? worldFlag.tokenKey ?? null
  const tokenInfo = (globalThis.BeneosUtility?.beneosTokens ?? {})[tokenKey] ?? {}
  const journal   = await resolveJournalEntry(actor)

  const next = {
    version: SCHEMA_VERSION,
    edited: {},
    // `parsed` is intentionally omitted here. The data adapter treats a
    // missing `parsed` as "no Tier-2 input", so the resolver will fall
    // through to the HTML parser. Welle-0 pipeline runs will set this
    // directly on the actor JSON during import.
    sourceMeta: {
      journalUuid:     journal?.uuid ?? null,
      tokenKey:        tokenKey ?? null,
      analysisSource:  tokenInfo.analysis_source ?? "legacy",
      pipelineVersion: 1,
      lastSync:        Date.now(),
      biographyHash:   BeneosCreatureCodexParser.fnv1aHash(actor.system?.details?.biography?.value ?? "")
    }
  }
  // Only attempt a write when the GM is current user AND the actor is a WORLD
  // actor. Players opening the codex must not trigger a server-side update; and
  // a compendium actor (actor.pack set — e.g. an installed creature that lives
  // only in the locked world.beneos_module_actors pack) cannot and should not be
  // mutated on open. In both cases the flag is synthesised in memory for display,
  // and the next GM open of a real world actor persists it.
  if (game.user?.isGM && !actor.pack) {
    try { await actor.setFlag(MODULE_ID, FLAG_KEY, next) }
    catch (err) { console.warn("[beneos-codex] could not persist codex flag", err) }
  }
  return next
}

/** Pure read of the Beneos world flag for callers that don't need the
 *  full migration (e.g. the cloud-preview adapter). */
export function resolveTokenKey(actor) {
  return readWorldFlag(actor)?.fullId ?? readWorldFlag(actor)?.tokenKey ?? null
}

export { resolveJournalEntry }
