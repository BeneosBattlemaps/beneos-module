/* =============================================================
   Beneos Creature Codex — Chip-Roll service (Welle 5f).
   Routes click events on `.cdx-chip-rollable` elements to Foundry's
   Roll API and posts the result to chat. Three chip kinds are
   rollable (see ROLLABLE_KINDS in codex-types.mjs):
     - "dice"  — "1d4", "2d8+3"  → roll the formula, show total
     - "dc"    — "DC 15"         → 1d20, success/fail vs DC
     - "tohit" — "+5", "+5 To Hit" → 1d20+N
   Anything else falls through silently. Unable to parse / invalid
   roll → toast warning, no chat noise.
   ============================================================= */

const DICE_RE   = /^\s*(\d+)d(\d+)\s*(?:([+\-])\s*(\d+))?\s*$/i
const DC_RE     = /DC\s*(\d+)/i
const TOHIT_RE  = /([+\-])\s*(\d+)/

function speakerFor(actor) {
  return ChatMessage.getSpeaker({ actor: actor ?? undefined })
}

/** Roll a `dice` chip — e.g. "1d4", "2d8+3". Parses out the formula
 *  defensively so a stray "≈" or "—" in the chip text won't crash. */
async function rollDice({ chip, actor }) {
  const m = DICE_RE.exec(chip)
  if (!m) {
    ui.notifications.warn(`Codex: cannot parse dice chip "${chip}"`)
    return
  }
  const n = parseInt(m[1], 10)
  const d = parseInt(m[2], 10)
  const sign = m[3] ?? ""
  const mod  = m[4] ?? ""
  const formula = `${n}d${d}${sign && mod ? `${sign}${mod}` : ""}`
  const roll = await new Roll(formula).evaluate()
  return roll.toMessage({
    speaker: speakerFor(actor),
    flavor: `Codex roll: ${chip}`
  })
}

/** Roll a "DC X" check — 1d20 raw, GM compares vs DC. We post a
 *  flavor text that highlights success/failure. */
async function rollDc({ chip, actor }) {
  const m = DC_RE.exec(chip)
  if (!m) return
  const dc = parseInt(m[1], 10)
  const roll = await new Roll("1d20").evaluate()
  const ok = roll.total >= dc
  return roll.toMessage({
    speaker: speakerFor(actor),
    flavor: `${chip} ${ok ? "✓ success" : "✗ failure"}`
  })
}

/** Roll a "+N" / "+N To Hit" chip — 1d20 + modifier. */
async function rollToHit({ chip, actor }) {
  const m = TOHIT_RE.exec(chip)
  if (!m) return
  const sign = m[1]
  const mod  = parseInt(m[2], 10)
  const formula = `1d20${sign}${mod}`
  const roll = await new Roll(formula).evaluate()
  return roll.toMessage({
    speaker: speakerFor(actor),
    flavor: `To-Hit ${chip}`
  })
}

/** Public entry — dispatch by kind. */
export async function rollChip({ chip, kind, actor }) {
  try {
    if (kind === "dice")  return await rollDice({ chip, actor })
    if (kind === "dc")    return await rollDc({ chip, actor })
    if (kind === "tohit") return await rollToHit({ chip, actor })
  } catch (err) {
    console.error("[beneos-codex] chip roll failed", err)
    ui.notifications.error(`Codex roll failed: ${err.message ?? "unknown"}`)
  }
}

/** Attach a delegated click handler to a container so every
 *  `.cdx-chip-rollable` inside it triggers a Foundry roll. Returns a
 *  teardown function for callers that want to detach on close. */
export function wireRollableChips(container, actor) {
  if (!container) return () => {}
  const handler = (ev) => {
    const el = ev.target.closest(".cdx-chip-rollable")
    if (!el || !container.contains(el)) return
    const chip = el.dataset?.chip ?? el.textContent?.trim()
    const kind = el.dataset?.kind
    if (!chip || !kind) return
    el.classList.add("rolling")
    setTimeout(() => el.classList.remove("rolling"), 380)
    rollChip({ chip, kind, actor }).catch(err =>
      console.error("[beneos-codex] rollChip error", err))
  }
  container.addEventListener("click", handler)
  return () => container.removeEventListener("click", handler)
}
