/* =============================================================
   Beneos Creature Codex — List-entry editor (Welle 4b).
   Modal dialog that edits a single entry of a list-shaped section
   (hooks / foreshadowing / abilities). The host BeneosCreatureCodexWindow
   awaits the dialog's result Promise, then merges the change back
   into the section's entry list and persists via
   `persistListSection` from the edit controller.
   ============================================================= */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

const HOOK_KINDS = ["social", "combat", "exploration", "challenge"]
const ABILITY_TYPES = ["action", "bonus", "reaction", "legendary", "lair", "trait"]

/** Per-section field declarations. Keeps the dialog template generic
 *  while letting each section show only the fields it actually uses.
 *  `id`s map 1:1 to the keys we store in `flags.edited.<section>[*]`. */
const FIELD_SETS = {
  hooks: [
    { id: "title", type: "text",     label: "Title" },
    { id: "kind",  type: "select",   label: "Kind", options: HOOK_KINDS },
    { id: "body",  type: "prosemirror", label: "Body" }
  ],
  foreshadowing: [
    { id: "title",  type: "text",        label: "Title" },
    { id: "dc",     type: "number",      label: "DC" },
    { id: "skills", type: "csv",         label: "Skills (comma-separated)" },
    { id: "body",   type: "prosemirror", label: "Body" }
  ],
  abilities: [
    { id: "name",        type: "text",        label: "Name" },
    { id: "type",        type: "select",      label: "Type", options: ABILITY_TYPES },
    { id: "description", type: "prosemirror", label: "Description" }
  ]
}

const PROSE_FIELD_BY_SECTION = {
  hooks: "body",
  foreshadowing: "body",
  abilities: "description"
}

export class BeneosCodexEntryEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-codex-entry-editor",
    classes: ["beneos-codex-entry-editor", "beneos_module"],
    tag: "form",
    window: {
      title: "BENEOS.CreatureCodex.EntryEditor.Title",
      icon: "fa-solid fa-pen-to-square",
      resizable: true
    },
    position: { width: 560, height: "auto" },
    actions: {
      submit: BeneosCodexEntryEditor._onSubmit,
      cancel: BeneosCodexEntryEditor._onCancel
    }
  }

  static PARTS = {
    main: { template: "modules/beneos-module/templates/codex/parts/entry-editor.hbs" }
  }

  constructor({ section, entry } = {}, options = {}) {
    super(options)
    this.section = section
    this.entry = entry ?? {}
    this.fields = FIELD_SETS[section] ?? []
    this._resolve = null
    this._result = null
  }

  /** Convenience launcher. Resolves to the edited entry object, or
   *  `null` if the user cancels. */
  static open({ section, entry }) {
    return new Promise(resolve => {
      const app = new BeneosCodexEntryEditor({ section, entry })
      app._resolve = resolve
      app.render({ force: true })
    })
  }

  async _prepareContext(_options) {
    return {
      section: this.section,
      fields: this.fields.map(f => ({
        ...f,
        value: this.entry?.[f.id] ?? (f.type === "csv" ? "" : f.type === "number" ? null : ""),
        valueCsv: f.type === "csv" ? (this.entry?.[f.id] ?? []).join(", ") : ""
      })),
      submitLabel: game.i18n.localize("BENEOS.CreatureCodex.Save"),
      cancelLabel: game.i18n.localize("BENEOS.CreatureCodex.Cancel")
    }
  }

  async _onRender(_context, _options) {
    // Mount <prose-mirror> for the body/description field — the
    // Handlebars template emits a placeholder div with `data-prose-for`
    // and we instantiate the editor here so its lifecycle is owned by
    // this app and not by Handlebars.
    const proseFieldId = PROSE_FIELD_BY_SECTION[this.section]
    if (!proseFieldId) return
    const slot = this.element.querySelector(`[data-prose-for="${proseFieldId}"]`)
    if (!slot) return
    slot.innerHTML = ""
    const editor = document.createElement("prose-mirror")
    editor.setAttribute("name", proseFieldId)
    editor.setAttribute("value", this.entry?.[proseFieldId] ?? "")
    editor.style.cssText = "display:block; min-height: 200px; width:100%;"
    slot.appendChild(editor)
    this._proseEditor = editor
  }

  static _onSubmit(event, _target) {
    event?.preventDefault?.()
    const form = this.element
    const result = {}
    for (const f of this.fields) {
      if (f.type === "prosemirror") {
        result[f.id] = typeof this._proseEditor?.getEditorHtml === "function"
          ? this._proseEditor.getEditorHtml()
          : (this._proseEditor?.value ?? "")
      } else if (f.type === "csv") {
        const raw = form.querySelector(`[name="${f.id}"]`)?.value ?? ""
        result[f.id] = raw.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)
      } else if (f.type === "number") {
        const raw = form.querySelector(`[name="${f.id}"]`)?.value
        const n = raw === "" || raw == null ? null : Number.parseInt(raw, 10)
        result[f.id] = Number.isFinite(n) ? n : null
      } else {
        result[f.id] = form.querySelector(`[name="${f.id}"]`)?.value ?? ""
      }
    }
    // Preserve / generate id.
    result.id = this.entry?.id ?? `entry-${foundry.utils.randomID(8)}`
    // Strip per-entry wipBody flag — once the GM saves, it's no longer
    // a WIP placeholder regardless of the body text.
    result.wipBody = false
    this._result = result
    this.close({ submitted: true })
  }

  static _onCancel(_event, _target) {
    this._result = null
    this.close({ submitted: true })
  }

  async close(options = {}) {
    if (this._resolve && !options.submitted) {
      // X-button / ESC close — treat as cancel.
      this._resolve(null)
      this._resolve = null
    } else if (this._resolve) {
      this._resolve(this._result)
      this._resolve = null
    }
    return super.close(options)
  }
}
