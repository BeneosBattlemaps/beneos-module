/* =============================================================
   Beneos Creature Codex — Data adapter (Welle 5a).
   Produces the `CreatureCodex` shape defined in `codex-types.mjs`
   from actor + journal + token-DB inputs. Mirrors the contract
   documented in the master mock's INTEGRATION.md §4.

   Welle 5a deliberately drops the read of `flags.beneos-module.codex.edited.*`
   (user choice "frischer Start"). Once a content-edit layer is
   reintroduced (later wave), this adapter regains its overlay merge.
   ============================================================= */

import { BeneosCreatureCodexParser } from "./codex-html-parser.mjs"
import { ensureCodexFlags, resolveJournalEntry } from "./codex-migrator.mjs"
import { CODEX_SCHEMA_VERSION } from "./codex-types.mjs"

/* ---------------- Helpers ---------------- */

const TACTICAL_SLOTS = [
  "main_mechanics", "start_turn", "movement",
  "bonus_actions", "actions", "reactions",
  "lair_actions", "turn_playbook",
  "recommended_allies", "se_tags"
]

/** Map Beneos `guide_*.webp` sub-marker keys onto the master schema's
 *  tacticalGuide buckets. `main_mechanics` and `traits` are treated as
 *  synonyms — traits live in the playbook sidebar. */
function tacticalSlotToBucket(slot) {
  switch (slot) {
    case "main_mechanics":  return "traits"
    case "start_turn":      return "startOfTurn"
    case "movement":        return "movement"
    case "bonus_actions":   return "bonusActions"
    case "actions":         return "actions"
    case "reactions":       return "freeActions"   // closest match
    case "lair_actions":    return "actions"       // appended after actions
    case "turn_playbook":   return null            // playbook is the layout, not a bucket
    case "recommended_allies": return null         // handled separately
    case "se_tags":         return null            // surfaced via tokenInfo
    default:                return null
  }
}

/** Resolve recommended-allies as a flat string list from the
 *  Tactical-Guide sub-marker block. Strips bullet markup. */
function parseAlliesFromHtml(html) {
  if (!html) return []
  const tmp = document.createElement("div")
  tmp.innerHTML = html
  const items = [...tmp.querySelectorAll("li")].map(li => li.textContent?.trim()).filter(Boolean)
  if (items.length) return items
  // Fallback: comma-separated paragraph.
  const text = (tmp.textContent ?? "").trim()
  if (!text) return []
  return text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
}

/** Tone derivation: prefer a pipeline-emitted value, then heuristic. */
function resolveSizeTone(actor, props) {
  const fromFlag = actor?.getFlag?.("beneos-module", "codex.tone")
  if (fromFlag?.primary && fromFlag?.secondary && fromFlag?.glow) return fromFlag
  return BeneosCreatureCodexParser.guessSizeTone({
    type:    actor?.system?.details?.type?.value ?? actor?.system?.details?.type,
    biome:   Array.isArray(props?.biom) ? props.biom[0] : props?.biom,
    faction: Array.isArray(props?.faction) ? props.faction[0] : props?.faction
  })
}

/** Compose a single string from an array-or-string field. */
function flat(v) {
  if (Array.isArray(v)) return v.join(", ")
  return v ?? ""
}

/** Phase-to-tag map for the Tactics "Cards" filter mode. Each phase
 *  contributes one tag; chip-derived kinds add more (Save / Attack /
 *  Damage / Trait). The result is a flat de-duplicated list per card. */
const PHASE_TAG = {
  startOfTurn:  "Start of Turn",
  traits:       "Trait",
  movement:     "Movement",
  bonusActions: "Bonus Action",
  freeActions:  "Free Action",
  actions:      "Action"
}

/** Walk a TacText array recursively and collect chip kinds. */
function harvestKinds(parts, out) {
  if (!Array.isArray(parts)) return
  for (const p of parts) {
    if (p && typeof p === "object" && p.chip) out.add(p.kind)
  }
}
function harvestKindsDeep(item, out) {
  harvestKinds(item.text, out)
  if (Array.isArray(item.children)) for (const c of item.children) harvestKindsDeep(c, out)
}

/** Pull a short, plain-text summary from a TacItem text-array. */
function summarizeTacText(parts, maxChars = 140) {
  if (!Array.isArray(parts)) return ""
  const flatParts = parts.map(p => typeof p === "string" ? p : p?.chip ?? "")
  const text = flatParts.join(" ").replace(/\s+/g, " ").trim()
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).replace(/[\s,.\-—]+$/, "") + "…"
}

/** Card title: the first chip with kind "feature" wins; else the first
 *  plain-text fragment; else "Tactic". */
function tacCardTitle(item, fallbackIdx) {
  if (Array.isArray(item.text)) {
    const featureChip = item.text.find(p => p && typeof p === "object" && p.kind === "feature")
    if (featureChip) return featureChip.chip
    const firstText = item.text.find(p => typeof p === "string" && p.trim())
    if (firstText) return firstText.trim().slice(0, 60)
  }
  return `Tactic ${fallbackIdx + 1}`
}

/** Build the flat Cards list used by the Tactics "Cards" mode. One
 *  card per top-level TacItem across all phases. Tags = phase tag +
 *  chip-derived kinds. */
function buildTacticsCards(tacticalGuide) {
  if (!tacticalGuide) return []
  const cards = []
  let nextId = 0
  for (const [phaseKey, items] of Object.entries(tacticalGuide)) {
    if (!Array.isArray(items) || items.length === 0) continue
    const phaseTag = PHASE_TAG[phaseKey] ?? null
    for (const item of items) {
      const kinds = new Set()
      harvestKindsDeep(item, kinds)
      const tags = []
      if (phaseTag) tags.push(phaseTag)
      if (kinds.has("save"))     tags.push("Save")
      if (kinds.has("attack"))   tags.push("Attack")
      if (kinds.has("tohit"))    tags.push("Attack")
      if (kinds.has("dice"))     tags.push("Damage")
      if (kinds.has("condition"))tags.push("Condition")
      // de-dup while preserving order
      const seen = new Set()
      const dedup = []
      for (const t of tags) { if (!seen.has(t)) { seen.add(t); dedup.push(t) } }
      cards.push({
        id:      `tac-${nextId++}`,
        title:   tacCardTitle(item, nextId),
        phase:   phaseKey,
        tags:    dedup,
        summary: summarizeTacText(item.text)
      })
    }
  }
  return cards
}

/** Filter chips offered above the Cards grid. Order matches the
 *  Master mock's `FILTER_TAGS`. */
const TACTICS_FILTER_TAGS = ["All", "Start of Turn", "Action", "Bonus Action", "Free Action", "Trait", "Movement", "Save", "Attack", "Damage", "Condition"]

/* =============================================================
   Iter 13a — Bridge from `flags.beneos.content` (v1.3) to the
   existing CreatureCodex shape consumed by the renderer.

   Strategy: when the Python migrator has populated structured
   content under `actor.flags.beneos.content`, we synthesize a
   CreatureCodex object from it (no HTML parsing). When the flag
   is absent (SRD creatures, un-migrated actors), the adapter
   returns `null` so the launcher hides the codex button.
   ============================================================= */

/** v1.3 chip-category → existing CreatureCodex segment-kind.
 *  Categories: cond / attr / dmg / adv / status / dc / save / tgt / info.
 *  Modul kinds (codex-types.mjs CHIP_KINDS):
 *    dice / feature / context / mechanic / action / target / range /
 *    dc / save / condition / attack / tohit. */
const V13_CAT_TO_KIND = Object.freeze({
  cond:   "condition",
  attr:   "mechanic",
  dmg:    "dice",
  adv:    "context",
  status: "condition",
  dc:     "dc",
  save:   "save",
  tgt:    "target",
  info:   "mechanic"
})

const KW_TOKEN_RE = /\{kw:([a-z\-]+)\|([^}]+)\}/gi
const ITEM_REF_RE = /\[\[\/item\s+([^\]]+)\]\]/g

/** Tokenize a v1.3 string into the existing TacText array. Plain text
 *  outside of `{kw:CAT|TEXT}` and `[[/item Name]]` becomes a string;
 *  recognised tokens become `{chip, kind}` objects.  Unknown chip-cats
 *  fall through as plain strings so unknown markup is visible, not
 *  invisible. */
function tokenizeV13ToTacText(str) {
  if (!str) return []
  const parts = []
  let i = 0
  // Combine kw + item-ref into a single sweep so we keep ordering.
  const tokens = []
  const collect = (re, kind) => {
    re.lastIndex = 0
    let m
    while ((m = re.exec(str)) !== null) {
      tokens.push({ start: m.index, end: re.lastIndex, kind, match: m })
    }
  }
  collect(KW_TOKEN_RE, "kw")
  collect(ITEM_REF_RE, "item")
  tokens.sort((a, b) => a.start - b.start)
  for (const t of tokens) {
    if (t.start > i) parts.push(str.slice(i, t.start))
    if (t.kind === "kw") {
      const cat = (t.match[1] || "").toLowerCase()
      const text = (t.match[2] || "").trim()
      const kind = V13_CAT_TO_KIND[cat]
      if (kind) parts.push({ chip: text, kind })
      else parts.push(text)   // unknown cat — plain text fallback
    } else {
      const refName = (t.match[1] || "").trim()
      parts.push({ chip: refName, kind: "feature" })
    }
    i = t.end
  }
  if (i < str.length) parts.push(str.slice(i))
  return parts.filter(p => typeof p !== "string" || p.length > 0)
}

/** One v1.3 clause → one TacText[] (concatenation of slot strings with
 *  separators that hint at slot boundaries). Empty slots are skipped. */
function clauseToTacText(clause) {
  if (!clause) return []
  const out = []
  const pushSlot = (slot) => {
    const tokens = tokenizeV13ToTacText(slot)
    if (tokens.length) {
      if (out.length) out.push(" — ")
      out.push(...tokens)
    }
  }
  if (clause.trigger)   pushSlot(clause.trigger)
  if (clause.effect)    pushSlot(clause.effect)
  if (clause.save) {
    const s = clause.save
    const skill = s.skill ? ` ${s.skill}` : ""
    pushSlot(`{kw:dc|DC ${s.dc}} {kw:save|${s.ability}${skill} ${s.type || "Saving Throw"}}`)
  }
  if (clause.onFailure) pushSlot(`On Failure: ${clause.onFailure}`)
  if (clause.onSuccess) pushSlot(`On Success: ${clause.onSuccess}`)
  if (clause.notes)     pushSlot(clause.notes)
  return out
}

/** v1.3 section_id → CreatureCodex.tacticalGuide bucket. The modul has
 *  fewer buckets than v1.3's 13 sections; collapse synonyms onto the
 *  closest fit. Sections we have no bucket for return null (skipped). */
function v13SectionToBucket(section) {
  switch (section) {
    case "actions":            return "actions"
    case "bonus_actions":      return "bonusActions"
    case "free_actions":       return "freeActions"
    case "reactions":          return "freeActions"   // closest existing bucket
    case "lair_actions":       return "actions"       // appended after actions
    case "legendary_actions":  return "actions"
    case "traits":             return "traits"
    case "main_mechanics":     return "traits"
    case "start_turn":         return "startOfTurn"
    case "start_combat":       return "startOfTurn"   // closest fit
    case "at_0_hp":            return "startOfTurn"   // closest fit
    case "end_of_turn":        return "startOfTurn"   // closest fit
    case "movement":           return "movement"
    default:                   return null
  }
}

/** Build one TacItem per v1.3 ability. Trigger-Phase + Action-Type get
 *  surfaced as a leading `feature`-chip so the existing tactics-card
 *  title-picker still produces a sensible heading. */
function v13AbilityToTacItem(ab) {
  const text = []
  if (ab.name) text.push({ chip: ab.name, kind: "feature" })
  const clauses = Array.isArray(ab.clauses) ? ab.clauses : []
  const children = []
  for (let i = 0; i < clauses.length; i++) {
    const ct = clauseToTacText(clauses[i])
    if (!ct.length) continue
    if (i === 0 && !text.length) {
      text.push(...ct)
    } else {
      children.push({ text: ct, children: [] })
    }
  }
  // If no name + no first clause, fall back to category label so the
  // bullet still has at least one visible string.
  if (!text.length) {
    const cat = (ab.categories && ab.categories[0]) || "Tactic"
    text.push(cat)
  }
  return { text, children }
}

/** Map v1.3 immersive.foreshadowing[] → modul Foreshadow[]. The shapes
 *  align closely (title / description / checks[] with dc / skills /
 *  result). Modul uses `entries` as the array key; we expose under
 *  `foreshadowing` to match the existing adapter contract. */
function v13ForeshadowingToModul(arr) {
  if (!Array.isArray(arr)) return []
  return arr.map((f, idx) => ({
    id:          f.id || `fs-${idx + 1}`,
    title:       f.title || "",
    description: f.description || "",
    checks:      (f.checks || []).map(c => ({
      level:    c.level,
      dc:       c.dc,
      skills:   c.skills || [],
      result:   c.result || "",
      preparation: c.preparation || ""
    }))
  }))
}

/** v1.3 immersive.storyPrompts[] → modul StoryPrompt[]. */
function v13StoryPromptsToModul(arr) {
  if (!Array.isArray(arr)) return []
  return arr.map((s, idx) => ({
    id:    s.id || `sp-${idx + 1}`,
    title: s.title || "",
    tier:  s.tier ?? null,
    text:  s.text || ""
  }))
}

/** v1.3 abilities[].duringCombatPrompts[<variant>] → modul abilityPrompts.
 *  The modul shape is a flat list of `{name, prompt}`; v1.3 supports
 *  variants per ability (default + named variants like rabid_assault).
 *  Bridge flattens them with `Name (variant)` style display names. */
function v13AbilityPromptsToModul(abilities) {
  if (!Array.isArray(abilities)) return []
  const out = []
  for (const ab of abilities) {
    const prompts = ab.duringCombatPrompts || {}
    for (const [variant, text] of Object.entries(prompts)) {
      if (!text) continue
      const label = variant === "default"
        ? (ab.name || "Ability")
        : `${ab.name || "Ability"}: ${variant.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}`
      out.push({ name: label, prompt: text })
    }
  }
  return out
}

/** v1.3 immersive.contextualPrompts[] (battle-cries, trigger-conditions,
 *  phase descriptions that didn't resolve to an Ability) → modul
 *  abilityPrompts list as well. They show up in the Theater tab under
 *  the same UI grouping. */
function v13ContextualPromptsToModul(arr) {
  if (!Array.isArray(arr)) return []
  return arr.map(p => ({ name: p.trigger || p.id || "Contextual", prompt: p.text || "" }))
}

/** Main entry: synthesize the existing CreatureCodex shape from a
 *  validated v1.3 content object. Returns the same fields that the
 *  legacy HTML-pipeline produced, so the renderer is unchanged. */
function transformV13ToCreatureCodex(content, actor, props, tokenKey, journal) {
  const showcase = content.showcase || {}
  const immersive = content.immersive || {}
  const meta = content.meta || {}

  // Group abilities by tacticalGuide bucket. Many-to-Many via categories[]
  // is collapsed to the FIRST matching bucket per ability (the renderer
  // shows each item once in the playbook stepper).
  const tacticalGuide = {
    startOfTurn:  [],
    traits:       [],
    movement:     [],
    bonusActions: [],
    freeActions:  [],
    actions:      []
  }
  for (const ab of (content.abilities || [])) {
    const cats = ab.categories || []
    let placed = false
    for (const cat of cats) {
      const bucket = v13SectionToBucket(cat)
      if (bucket && tacticalGuide[bucket]) {
        tacticalGuide[bucket].push(v13AbilityToTacItem(ab))
        placed = true
        break
      }
    }
    // If no recognised category, drop in traits as the most generic fit.
    if (!placed) tacticalGuide.traits.push(v13AbilityToTacItem(ab))
  }

  // tacticalNotes (DM-tips from hybrid-routed sections) — surface as
  // children of a single synthetic TacItem per bucket so the renderer
  // still walks them. Beforecombat → into traits as "Before Combat".
  const tn = content.tacticalNotes || {}
  const addNotes = (bucket, bullets, label) => {
    if (!Array.isArray(bullets) || !bullets.length) return
    const children = bullets.map(b => ({ text: tokenizeV13ToTacText(b), children: [] }))
    tacticalGuide[bucket].push({
      text: [{ chip: label, kind: "feature" }],
      children
    })
  }
  addNotes("traits",       tn.beforeCombat, "Before Combat")
  addNotes("traits",       tn.generalNotes, "General Notes")
  addNotes("traits",       tn.tactics,      "Tactics")
  addNotes("movement",     tn.movement,     "Movement Notes")

  // Lore / showcase — modul expects a single string each.
  const loreText = (immersive.lore && immersive.lore.text) || ""
  const showcaseStr = showcase.tagline
    ? `${showcase.name || ""} — ${showcase.tagline}`.trim()
    : (showcase.summary || showcase.name || "")

  // Compose final CreatureCodex object.
  const playerImg = actor?.img
  const name = actor?.name || showcase.name || ""
  const cr = actor?.system?.details?.cr?.value
          ?? actor?.system?.details?.cr
          ?? actor?.system?.details?.level
          ?? null
  const type = flat(actor?.system?.details?.type?.value ?? actor?.system?.details?.type)

  // Combined abilityPrompts: per-ability variants + contextualPrompts.
  const abilityPrompts = [
    ...v13AbilityPromptsToModul(content.abilities),
    ...v13ContextualPromptsToModul(immersive.contextualPrompts)
  ]

  return {
    id:                 actor?.id,
    name,
    type,
    cr:                 typeof cr === "number" ? cr : (Number.parseFloat(cr) || null),

    biome:              Array.isArray(props.biom) ? props.biom.join(" / ") : props.biom,
    faction:            Array.isArray(props.faction) ? props.faction[0] : props.faction,
    fightingStyle:      Array.isArray(props.fightingstyle) ? props.fightingstyle : (props.fightingstyle ? [props.fightingstyle] : []),
    purpose:            Array.isArray(props.purpose) ? props.purpose : (props.purpose ? [props.purpose] : []),

    sizeTone:           resolveSizeTone(actor, props),
    portraitInitial:    (name?.[0] ?? "?").toUpperCase(),
    heroImageUrl:       playerImg,

    showcase:           showcaseStr,
    lore:               loreText,
    storyPrompts:       v13StoryPromptsToModul(immersive.storyPrompts),
    foreshadowing:      v13ForeshadowingToModul(immersive.foreshadowing),
    firstAppearance:    immersive.combatStarterPrompt || "",
    abilityPrompts,
    deathPrompt:        immersive.deathPrompt || "",
    tacticalGuide,

    recommendedAllies:  meta.recommendedAllies || [],
    tags:               Array.isArray(props.type) ? props.type : (props.type ? [props.type] : []),
    pdfAvailable:       !!tokenKey,

    tacticsCards:       buildTacticsCards(tacticalGuide),
    tacticsFilterTags:  TACTICS_FILTER_TAGS,

    sourceMeta: {
      tokenKey,
      journalUuid: journal?.uuid ?? null,
      schemaVersion: CODEX_SCHEMA_VERSION,
      v13ContentVersion: content.schemaVersion || null
    },
    journalId: journal?.id ?? null,
    actorId:   actor?.id
  }
}

/** Synchronous fast-check: does this actor carry v1.3 codex content?
 *  Used by the launcher to gate which surfaces (sheet-header icon,
 *  token-HUD button) appear. */
export function hasV13CodexContent(actor) {
  if (!actor) return false
  // `flags.beneos.content` is written by the external Python/Gemini
  // pipeline via document.update(), so read it directly instead of
  // actor.getFlag("beneos", ...) — "beneos" is not a registered module
  // id and would trip Foundry's flag-scope validation.
  const flag = actor.flags?.beneos?.content
  return !!(flag && flag.schemaVersion)
}

/* ---------------- Main adapter ---------------- */

export async function getCodexDataForActor(actor) {
  if (!actor) throw new Error("getCodexDataForActor: actor is required")

  // Iter 13a — Bridge: prefer v1.3 structured content when present.
  // Direct flag access — see hasV13CodexContent above.
  const v13Content = actor.flags?.beneos?.content
  if (v13Content && v13Content.schemaVersion) {
    const worldFlag = actor.getFlag("world", "beneos") ?? {}
    const tokenKey  = worldFlag.fullId ?? worldFlag.tokenKey ?? null
    const tokenInfo = (globalThis.BeneosUtility?.beneosTokens ?? {})[tokenKey] ?? {}
    const props     = tokenInfo.properties ?? {}
    const journal   = await resolveJournalEntry(actor)
    return transformV13ToCreatureCodex(v13Content, actor, props, tokenKey, journal)
  }

  // Legacy path — HTML-parser pipeline. Untouched.
  const flags     = await ensureCodexFlags(actor)
  const worldFlag = actor.getFlag("world", "beneos") ?? {}
  const tokenKey  = flags?.sourceMeta?.tokenKey ?? worldFlag.fullId ?? null
  const tokenInfo = (globalThis.BeneosUtility?.beneosTokens ?? {})[tokenKey] ?? {}
  const props     = tokenInfo.properties ?? {}

  // Journal lookup (Pack-Dokumentation)
  const journal = await resolveJournalEntry(actor)
  const pages = journal?.pages?.contents ?? []
  const immersive    = pages.find(p => p.name === "Immersive Integration")
  const playerPage   = pages.find(p => p.name === "Creature Player Handout")
  const tacticalPage = pages.find(p => p.name === "Tactical Guide")

  // Welle 2-Parser für Immersive-Integration: split per journal_*.webp
  const parsedImmersive = immersive
    ? BeneosCreatureCodexParser.splitImmersiveIntegration(immersive.text?.content ?? "")
    : {}

  // Biography (actor.system) → Tactical-Guide-Quelle; fallback auf Journal-Page.
  const biography = actor.system?.details?.biography?.value
                  || tacticalPage?.text?.content
                  || ""
  const tacticalFromHtml = BeneosCreatureCodexParser.splitTacticalGuide(biography)

  // Story Prompts + Foreshadowing + Ability-Prompts: Welle-5a V2-Extraktoren
  const storyPrompts  = BeneosCreatureCodexParser.extractStoryPrompts(parsedImmersive.story_prompts)
  const foreshadowing = BeneosCreatureCodexParser.extractForeshadow(parsedImmersive.foreshadowing)
  const abilityPrompts = BeneosCreatureCodexParser.extractAbilityPrompts(parsedImmersive.during_combat)

  // Lore + Before-Combat + Death-Prompt: plain-text aus den HTML-Fragments.
  const loreFragment   = parsedImmersive.lore
  const loreHtml = loreFragment ? BeneosCreatureCodexParser.fragmentToHtml(loreFragment) : ""
  const lore     = BeneosCreatureCodexParser.htmlToPlainText(loreHtml) || ""
  const showcase = BeneosCreatureCodexParser.extractShowcase(loreHtml)

  const firstAppearance = BeneosCreatureCodexParser.htmlToPlainText(
    BeneosCreatureCodexParser.fragmentToHtml(parsedImmersive.before_combat)
  )
  const deathPrompt = BeneosCreatureCodexParser.htmlToPlainText(
    BeneosCreatureCodexParser.fragmentToHtml(parsedImmersive.death_prompt)
  )

  // TacticalGuide → buckets via slot-mapping. Empty slots are
  // omitted entirely so the playbook can hide phases with no rules.
  const tacticalGuide = { startOfTurn: [], traits: [], movement: [], bonusActions: [], freeActions: [], actions: [] }
  let recommendedAllies = []
  for (const slot of TACTICAL_SLOTS) {
    const fragment = tacticalFromHtml[slot]
    if (!fragment) continue
    if (BeneosCreatureCodexParser.isWipPlaceholder(fragment)) continue
    const html = BeneosCreatureCodexParser.fragmentToHtml(fragment)
    if (slot === "recommended_allies") {
      recommendedAllies = parseAlliesFromHtml(html)
      continue
    }
    const bucket = tacticalSlotToBucket(slot)
    if (!bucket) continue
    const items = BeneosCreatureCodexParser.extractTacItems(html)
    if (!items.length) continue
    tacticalGuide[bucket].push(...items)
  }

  // CR fallback chain — DnD5e exposes cr as number-or-string, custom
  // systems may store it under details.level / cr.value / ...
  const cr = actor.system?.details?.cr?.value
          ?? actor.system?.details?.cr
          ?? actor.system?.details?.level
          ?? null

  const name = actor.name
  const type = flat(actor.system?.details?.type?.value ?? actor.system?.details?.type)

  const playerImg = playerPage?.src ?? actor.img

  return {
    /* identity */
    id:                 actor.id,
    name,
    type,
    cr:                 typeof cr === "number" ? cr : (Number.parseFloat(cr) || null),

    /* search-engine tags */
    biome:              Array.isArray(props.biom) ? props.biom.join(" / ") : props.biom,
    faction:            Array.isArray(props.faction) ? props.faction[0] : props.faction,
    fightingStyle:      Array.isArray(props.fightingstyle) ? props.fightingstyle : (props.fightingstyle ? [props.fightingstyle] : []),
    purpose:            Array.isArray(props.purpose) ? props.purpose : (props.purpose ? [props.purpose] : []),

    /* visuals */
    sizeTone:           resolveSizeTone(actor, props),
    portraitInitial:    (name?.[0] ?? "?").toUpperCase(),
    heroImageUrl:       playerImg,

    /* narrative */
    showcase,
    lore,
    storyPrompts,
    foreshadowing,
    firstAppearance,
    abilityPrompts,
    deathPrompt,
    tacticalGuide,

    /* references */
    recommendedAllies,
    tags:               Array.isArray(props.type) ? props.type : (props.type ? [props.type] : []),
    pdfAvailable:       !!tokenKey,   // gated on having a tokenKey; the cloud may still reject

    /* Welle 5h — Tactics Cards mode */
    tacticsCards:       buildTacticsCards(tacticalGuide),
    tacticsFilterTags:  TACTICS_FILTER_TAGS,

    /* adapter meta — not part of the public CreatureCodex shape but
       the codex window uses it for the drift banner + open-journal
       + open-sheet actions. */
    sourceMeta: {
      ...(flags?.sourceMeta ?? {}),
      tokenKey,
      journalUuid: journal?.uuid ?? flags?.sourceMeta?.journalUuid ?? null,
      schemaVersion: CODEX_SCHEMA_VERSION
    },
    journalId: journal?.id ?? null,
    actorId:   actor.id
  }
}

/** Cloud-preview path — same shape, but mostly empty. */
export async function getCodexDataForCloudPreview(tokenKey) {
  const tokenInfo = (globalThis.BeneosUtility?.beneosTokens ?? {})[tokenKey] ?? {}
  const props = tokenInfo.properties ?? {}
  const name = tokenInfo.name ?? tokenKey ?? "Unknown"
  return {
    id:                 null,
    name,
    type:               Array.isArray(props.type) ? props.type.join(" / ") : props.type ?? "",
    cr:                 null,
    biome:              Array.isArray(props.biom) ? props.biom.join(" / ") : props.biom,
    faction:            Array.isArray(props.faction) ? props.faction[0] : props.faction,
    fightingStyle:      Array.isArray(props.fightingstyle) ? props.fightingstyle : [],
    purpose:            Array.isArray(props.purpose) ? props.purpose : [],
    sizeTone:           BeneosCreatureCodexParser.guessSizeTone({ type: props.type, biome: props.biom, faction: props.faction }),
    portraitInitial:    (name?.[0] ?? "?").toUpperCase(),
    heroImageUrl:       tokenInfo.thumbnail
                          ? `https://www.beneos-database.com/data/tokens/thumbnails_v2/${tokenInfo.thumbnail}`
                          : null,
    showcase:           "",
    lore:               "",
    storyPrompts:       [],
    foreshadowing:      [],
    firstAppearance:    "",
    abilityPrompts:     [],
    deathPrompt:        "",
    tacticalGuide:      { startOfTurn: [], traits: [], movement: [], bonusActions: [], freeActions: [], actions: [] },
    recommendedAllies:  [],
    tags:               Array.isArray(props.type) ? props.type : [],
    pdfAvailable:       !!tokenKey,
    tacticsCards:       [],
    tacticsFilterTags:  TACTICS_FILTER_TAGS,
    sourceMeta: {
      tokenKey, analysisSource: tokenInfo.analysis_source ?? "cloud-preview",
      pipelineVersion: 0, lastSync: 0, biographyHash: null, journalUuid: null,
      schemaVersion: CODEX_SCHEMA_VERSION
    },
    journalId: null,
    actorId:   null
  }
}
