/* =============================================================
   Beneos Creature Codex — Death-Prompt popup (Welle 5e).
   A small dramatic floating window that appears when a Beneos
   creature reaches 0 HP. Mirrors the master mock's `DeathPrompt.jsx`
   with enter → reading → leaving phases.
   ============================================================= */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

export class BeneosCodexDeathPrompt extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-codex-death-prompt",
    classes: ["beneos-codex-death-prompt", "beneos_module"],
    tag: "section",
    window: {
      title: "BENEOS.CreatureCodex.DeathPrompt.Title",
      icon: "fa-solid fa-skull",
      resizable: false,
      minimizable: false
    },
    position: { width: 520, height: "auto" },
    actions: {
      dismiss:    BeneosCodexDeathPrompt._onDismiss,
      openCodex:  BeneosCodexDeathPrompt._onOpenCodex
    }
  }

  static PARTS = {
    main: { template: "modules/beneos-module/templates/codex/parts/death-prompt.hbs" }
  }

  constructor({ codexData, actor = null } = {}, options = {}) {
    super(options)
    this.codexData = codexData
    this.actor = actor
    this.phase = "enter"
  }

  async _prepareContext(_options) {
    return {
      data: this.codexData,
      phase: this.phase
    }
  }

  async _onRender(_context, _options) {
    // Transition through the phases on a timer so the CSS animations
    // can hook into [data-phase="enter"] → "reading" classes.
    setTimeout(() => {
      const root = this.element?.querySelector("[data-phase]")
      if (root) root.dataset.phase = "reading"
      this.phase = "reading"
    }, 200)
  }

  static async _onDismiss(_event, _target) {
    const root = this.element?.querySelector("[data-phase]")
    if (root) root.dataset.phase = "leaving"
    setTimeout(() => this.close(), 280)
  }

  static async _onOpenCodex(_event, _target) {
    if (this.actor && game.beneos?.codex?.openForActor) {
      await game.beneos.codex.openForActor(this.actor)
    }
    await this.close()
  }
}

/** Per-combat dedupe — a creature's death prompt fires once per
 *  combat encounter, not on every HP touch. The set is cleared when
 *  the combat ends. Module-scoped via `game.beneos.codex.deathFired`. */
function deathFiredSet() {
  game.beneos = game.beneos ?? {}
  game.beneos.codex = game.beneos.codex ?? {}
  game.beneos.codex.deathFired = game.beneos.codex.deathFired ?? new Set()
  return game.beneos.codex.deathFired
}

/** Manual auto-fire helper for hp ≤ 0. The combat prompt engine
 *  (codex2/combat-prompt-engine.mjs) is the active death trigger; this
 *  remains for manual / programmatic use. */
export async function maybeOpenDeathPrompt(actor, changes) {
  if (!game.user?.isGM) return
  // GM-only auto-open, and only if the user setting allows it.
  let allowAuto = true
  try { allowAuto = game.settings?.get?.("beneos-module", "codex-death-popup") ?? true }
  catch (_) { /* setting not registered yet; default to on */ }
  if (!allowAuto) return

  const newHp = foundry.utils.getProperty(changes, "system.attributes.hp.value")
  if (typeof newHp !== "number" || newHp > 0) return
  const oldHp = actor.system?.attributes?.hp?.value
  if (oldHp === 0) return // already dead before this update
  const util = globalThis.BeneosUtility
  if (!util?.checkIsBeneosToken?.({ actor })) return

  const fired = deathFiredSet()
  if (fired.has(actor.id)) return
  fired.add(actor.id)
  Hooks.once("deleteCombat", () => fired.delete(actor.id))

  try {
    const { getCodexDataForActor } = await import("./codex-data-adapter.mjs")
    const codexData = await getCodexDataForActor(actor)
    if (!codexData?.deathPrompt) return
    new BeneosCodexDeathPrompt({ codexData, actor }).render({ force: true })
  } catch (err) {
    console.error("[beneos-codex] death-prompt auto-fire failed", err)
  }
}
