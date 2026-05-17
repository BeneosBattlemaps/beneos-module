/* =============================================================
   Beneos Creature Codex — HTML parser (Welle 2, Tier 3 legacy).
   Pure, stateless. Consumes the raw HTML strings from the Beneos
   journal Immersive-Integration page and the actor biography, and
   returns either DocumentFragments (top-level splits) or normalised
   plain objects (extractors). The data adapter is the only caller.
   ============================================================= */

const WIP_PATTERNS = [
  /work in progress/i,
  /this section provides background information about the creature for official beneos tokens/i
]

/** bne-chip class → CHIP_KIND mapping. The Beneos generator emits the
 *  source-of-truth class names listed here; we project them into the
 *  11 ChipKinds the codex template renders. Unmapped chips fall back
 *  to "context" (visually grey, non-rollable). */
const BNE_CHIP_KIND_MAP = {
  "bne--dc":          "dc",
  "bne--check":       "dc",
  "bne--tohit":       "tohit",
  "bne--attack":      "attack",
  "bne--action":      "action",
  "bne--bonus-action":"action",
  "bne--save":        "save",
  "bne--cond":        "condition",
  "bne--condition":   "condition",
  "bne--cond-plain":  "context",
  "bne--target":      "target",
  "bne--range":       "range",
  "bne--feature":     "feature",
  "bne--mechanic":    "mechanic",
  "bne--attr":        "mechanic",
  "bne--attribute":   "mechanic",
  "bne--info":        "context",
  "bne--dice":        "dice"
}

/** Patterns that infer ChipKind from raw text when no explicit class
 *  is present (typical in Journal-page rendering where chips were
 *  produced as `<strong>` rather than `<span class="bne-chip ...">`). */
const TEXT_KIND_HEURISTICS = [
  { re: /^\s*\d+d\d+(\s*\+\s*\d+)?\s*$/i,             kind: "dice" },
  { re: /^\s*DC\s*\d+/i,                              kind: "dc" },
  { re: /^\s*\+\d+\s*(to hit|to-hit)?$/i,             kind: "tohit" },
  { re: /(bonus|free|legendary|lair)?\s*action$/i,    kind: "action" },
  { re: /saving throw/i,                              kind: "save" },
  { re: /melee weapon attack|ranged weapon attack/i,  kind: "attack" },
  { re: /\bft\.?$/i,                                  kind: "range" },
  { re: /^(one|all|each|every)\s+(creature|target)/i, kind: "target" },
  { re: /^when\b|^on\b|^options\b/i,                  kind: "context" }
]

const TACTICAL_SUBS = [
  "main_mechanics", "start_turn", "movement",
  "bonus_actions", "actions", "reactions",
  "lair_actions", "turn_playbook",
  "recommended_allies", "se_tags"
]

export class BeneosCreatureCodexParser {

  /* ----- Top-level splits ----- */

  /** Split the Immersive Integration page HTML at every `journal_*.webp`
   *  marker image. Returns a map of section-key → DocumentFragment with
   *  every node up to (but not including) the next marker.
   *  Empty input or a page without any markers returns `{ lore: <whole> }`
   *  as a permissive fallback for pre-marker creatures. */
  static splitImmersiveIntegration(html) {
    return BeneosCreatureCodexParser._splitByMarker(html, /journal_([a-z_]+)\.webp/, "lore")
  }

  /** Same logic for the Tactical Guide, using `guide_*.webp` markers.
   *  Fallback bucket is `main_mechanics` since older biographies often
   *  have one inline narrative. */
  static splitTacticalGuide(biographyHtml) {
    return BeneosCreatureCodexParser._splitByMarker(biographyHtml, /guide_([a-z_]+)\.webp/, "main_mechanics")
  }

  static _splitByMarker(html, keyPattern, fallbackKey) {
    if (!html || typeof html !== "string") return {}
    const root = document.createElement("div")
    root.innerHTML = html
    const tag = keyPattern.source.startsWith("journal_") ? "journal_" : "guide_"
    const imgs = [...root.querySelectorAll(`img[src*="/icons/${tag}"]`)]
    if (imgs.length === 0) {
      const fragment = document.createDocumentFragment()
      while (root.firstChild) fragment.appendChild(root.firstChild)
      return { [fallbackKey]: fragment }
    }
    const sections = {}
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i]
      const m = img.src.match(keyPattern)
      const key = m?.[1]
      if (!key) continue
      // Preferred path: each Beneos marker sits inside its own styled
      // <div> wrapper (background-color / border / padding). Cloning
      // the wrapper keeps the DOM balanced and prevents the "second
      // empty box" rendering that Range-across-containers produces.
      const wrapper = img.parentElement
      const useWrapper =
        wrapper && wrapper !== root && wrapper.tagName === "DIV" &&
        // Avoid stealing a wrapper that contains multiple markers.
        wrapper.querySelectorAll(`img[src*="/icons/${tag}"]`).length === 1
      if (useWrapper) {
        const clone = wrapper.cloneNode(true)
        clone.querySelector(`img[src*="/icons/${tag}"]`)?.remove()
        const frag = document.createDocumentFragment()
        while (clone.firstChild) frag.appendChild(clone.firstChild)
        sections[key] = frag
        continue
      }
      // Fallback: inline marker without wrapper — use Range as before.
      const range = document.createRange()
      range.setStartAfter(img)
      if (imgs[i + 1]) range.setEndBefore(imgs[i + 1])
      else range.setEndAfter(root.lastChild)
      sections[key] = range.cloneContents()
    }
    return sections
  }

  /* ----- Extractors ----- */

  /** Story Prompts → Hook[]. Each `<ol><li>` is one prompt; the first
   *  `<strong>` inside the <li> becomes the title, the rest of the <li>
   *  (plus any body paragraph after the <ol>) is the body. Sets
   *  `wipBody: true` per entry when only the body is a placeholder so
   *  the adapter can still surface real DCs / titles. */
  static extractHooks(fragment) {
    if (!fragment) return []
    const div = document.createElement("div")
    div.appendChild(fragment.cloneNode(true))
    const items = div.querySelectorAll("ol > li")
    const hooks = []
    items.forEach((li, idx) => {
      const titleEl = li.querySelector("strong")
      const title = titleEl?.textContent?.trim() || `Prompt ${idx + 1}`
      // Body = li contents minus title strong; also pull in the next
      // sibling paragraph (Beneos renders descriptions as `<p>` after
      // the prompt's enclosing div).
      const liClone = li.cloneNode(true)
      liClone.querySelector("strong")?.remove()
      let body = liClone.innerHTML.trim()
      if (!body || body.length < 8) {
        const ol = li.parentElement
        const promptDiv = ol?.parentElement // the styled prompt-header div
        let sib = promptDiv?.nextElementSibling
        const acc = []
        while (sib && !sib.querySelector?.("ol")) {
          acc.push(sib.outerHTML)
          sib = sib.nextElementSibling
        }
        body = acc.join("\n")
      }
      hooks.push({
        id: `hook-${idx + 1}`,
        kind: BeneosCreatureCodexParser._guessHookKind(li),
        title,
        body,
        wipBody: BeneosCreatureCodexParser._isWipText(body)
      })
    })
    return hooks
  }

  /** Foreshadowing → Foreshadow[]. Each Beneos prompt is a styled
   *  `<div>` containing an `<ol><li><strong>Prompt N</strong></li></ol>`,
   *  followed by a description `<p>` and a DC-box `<div>` with
   *  `<strong>DC X Skill1, Skill2:</strong>`. Walks forward through
   *  siblings of the prompt's `<ol>` until the next `<ol>` (next prompt). */
  static extractForeshadowing(fragment) {
    if (!fragment) return []
    const div = document.createElement("div")
    div.appendChild(fragment.cloneNode(true))

    const items = div.querySelectorAll("ol > li")
    const result = []
    items.forEach((li, idx) => {
      const titleEl = li.querySelector("strong")
      const title = titleEl?.textContent?.trim() || `Prompt ${idx + 1}`

      // Walk siblings of the prompt's <ol> wrapper-div until the next
      // wrapper containing an <ol>. Accumulate body + look for DC.
      const ol = li.parentElement
      const promptDiv = ol?.parentElement
      const bodyParts = []
      let dcText = null
      let sib = promptDiv?.nextElementSibling
      while (sib && !sib.querySelector?.("ol")) {
        // DC chip path (biography style)
        const chip = sib.querySelector?.(".bne-chip.bne--dc, .bne-chip.bne--check")
        if (chip && !dcText) dcText = chip.textContent
        // DC strong path (journal style: <strong>DC 10 Check1, Check2:</strong>)
        if (!dcText) {
          for (const s of sib.querySelectorAll?.("strong") ?? []) {
            if (/DC\s*\d/i.test(s.textContent)) { dcText = s.textContent; break }
          }
        }
        bodyParts.push(sib.outerHTML)
        sib = sib.nextElementSibling
      }
      const body = bodyParts.join("\n").trim()
      const dcInfo = dcText ? BeneosCreatureCodexParser.parseDcExpression(dcText) : null

      result.push({
        id: `foreshadow-${idx + 1}`,
        dc: dcInfo?.dc ?? null,
        skills: dcInfo?.skills ?? [],
        title,
        body,
        wipBody: BeneosCreatureCodexParser._isWipText(body)
      })
    })
    return result
  }

  /** During Combat → Ability[]. The Beneos generator emits exactly one
   *  <table> with two columns per row: bold name (left, 25%) and a
   *  descriptive paragraph (right). Each row becomes one ability; a
   *  WIP-body row keeps the name + flags `wipBody: true`. */
  static extractAbilities(fragment) {
    if (!fragment) return []
    const div = document.createElement("div")
    div.appendChild(fragment.cloneNode(true))
    const rows = div.querySelectorAll("table tbody tr")
    const abilities = []
    rows.forEach((tr, idx) => {
      const cells = tr.querySelectorAll("td")
      if (cells.length < 2) return
      const nameRaw = cells[0].textContent?.trim()
      const descHtml = cells[1].innerHTML.trim()
      if (!nameRaw) return
      abilities.push({
        id: `ability-${idx + 1}`,
        name: nameRaw,
        type: BeneosCreatureCodexParser._guessAbilityType(nameRaw, descHtml),
        description: descHtml,
        wipBody: BeneosCreatureCodexParser._isWipText(descHtml)
      })
    })
    return abilities
  }

  /* ----- Normalisers / helpers ----- */

  /** Accepts both journal raw ("DC 15 History, Insight") and biography
   *  chip ("DC 17"). Returns `{ dc, skills }` or `null` if no DC found. */
  static parseDcExpression(text) {
    if (!text) return null
    const m = text.match(/DC\s*(\d+)\s*(.*)$/i)
    if (!m) return null
    const skillsRaw = (m[2] || "").trim()
    return {
      dc: parseInt(m[1], 10),
      skills: skillsRaw ? skillsRaw.split(/[,/]\s*|\s+and\s+/i).map(s => s.trim()).filter(Boolean) : []
    }
  }

  /** Detect canonical WIP placeholder text used by the Beneos generator
   *  for incomplete SRD creatures. Returns true if the visible text
   *  matches any known placeholder phrase. Operates on a DOM node;
   *  empty content counts as WIP for the section-level test. */
  static isWipPlaceholder(node) {
    if (!node) return false
    const text = (node.textContent || "").trim()
    if (!text) return true
    return WIP_PATTERNS.some(p => p.test(text))
  }

  /** Body-level WIP test for individual list entries (hooks /
   *  foreshadow / abilities). Accepts an HTML string. Empty body is
   *  considered WIP. */
  static _isWipText(htmlOrText) {
    if (!htmlOrText) return true
    const tmp = document.createElement("div")
    tmp.innerHTML = htmlOrText
    const text = (tmp.textContent || "").trim()
    if (!text) return true
    return WIP_PATTERNS.some(p => p.test(text))
  }

  /** Serialise a DocumentFragment (or a string fallback) to HTML. The
   *  adapter holds parsed values as either DocumentFragments or already
   *  flat HTML strings; templates always render strings. */
  static fragmentToHtml(fragmentOrString) {
    if (fragmentOrString == null) return ""
    if (typeof fragmentOrString === "string") return fragmentOrString
    const tmp = document.createElement("div")
    tmp.appendChild(fragmentOrString.cloneNode(true))
    return tmp.innerHTML.trim()
  }

  /** FNV-1a 32-bit — synchronous, deterministic, ~10 ns per character.
   *  Used to fingerprint the biography so we can detect external edits
   *  without async crypto.subtle. */
  static fnv1aHash(str) {
    if (!str) return "0"
    let hash = 0x811c9dc5
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0
    }
    return hash.toString(16).padStart(8, "0")
  }

  /** Whether the parsed sections plus biography all match WIP / are
   *  empty. Used by the adapter to flag a creature with a yellow chip
   *  in the header. */
  static detectWipCreature(parsedFromHtml, biography) {
    const sections = Object.values(parsedFromHtml ?? {})
    const allEmpty = sections.length === 0
      || sections.every(s => !s || BeneosCreatureCodexParser.isWipPlaceholder(s))
    const bioEmpty = !biography || /^[\s<>]*$/.test(biography)
    return allEmpty && bioEmpty
  }

  /* ----- Private heuristics ----- */

  static _guessHookKind(li) {
    // The Beneos generator does not yet emit kind markers inside the
    // story-prompt list, but reserves the markers `journal_combat`,
    // `journal_social`, `journal_exploration`, `journal_challenge` for
    // future use. Look for any of those images inside the <li> first.
    const inner = li.querySelector('img[src*="/icons/journal_combat"], img[src*="/icons/journal_social"], img[src*="/icons/journal_exploration"], img[src*="/icons/journal_challenge"]')
    if (inner) {
      const m = inner.src.match(/journal_(combat|social|exploration|challenge)\./)
      if (m) return m[1]
    }
    return "social"
  }

  static _guessAbilityType(_name, descHtml) {
    const text = (descHtml || "").toLowerCase()
    if (/bonus action/.test(text)) return "bonus"
    if (/reaction/.test(text)) return "reaction"
    if (/legendary/.test(text)) return "legendary"
    if (/lair action/.test(text)) return "lair"
    return "action"
  }

  /** Exposed for the adapter / migrator if it needs to enumerate the
   *  full tactical sub-marker set. */
  static get TACTICAL_SUBS() { return TACTICAL_SUBS }

  /* ===========================================================
     Welle 5a — Master-Mock extractors.
     The originals above (extractHooks/Foreshadowing/Abilities)
     stay for legacy callers; the V2 extractors emit the data
     shapes the new template + tactics-lab expect.
     =========================================================== */

  /** Story Prompts → `StoryPrompt[]`. Two layouts supported:
   *    A) `<ol><li><strong>Prompt N: Title</strong> body…</li></ol>` —
   *       used when the generator emits a nested list with explicit
   *       T1/T2/T3/T4 tier tags.
   *    B) flat `<p><strong>Prompt N.</strong> body…</p>` paragraphs
   *       separated by `<hr>` — current Beneos output for the
   *       Story-Prompts section (e.g. Bone Hag has 3 of these).
   *  Tier defaults to 1 when no tag is found. */
  static extractStoryPrompts(fragment) {
    if (!fragment) return []
    const div = document.createElement("div")
    div.appendChild(fragment.cloneNode(true))

    // ---- Layout A: nested <ol><li> ----
    const liItems = div.querySelectorAll("ol > li")
    if (liItems.length > 0) {
      const out = []
      liItems.forEach((li, idx) => {
        const titleEl = li.querySelector("strong")
        const rawTitle = titleEl?.textContent?.trim() ?? `Prompt ${idx + 1}`
        const tierMatch = /\bT([1-4])\b/i.exec(rawTitle)
        const tier = tierMatch ? parseInt(tierMatch[1], 10) : 1
        const title = rawTitle.replace(/\bT[1-4]\b\s*/i, "").trim()
        const liClone = li.cloneNode(true)
        liClone.querySelector("strong")?.remove()
        let body = liClone.innerHTML.trim()
        if (body.length < 8) {
          const ol = li.parentElement
          const promptDiv = ol?.parentElement
          let sib = promptDiv?.nextElementSibling
          const acc = []
          while (sib && !sib.querySelector?.("ol")) {
            acc.push(sib.outerHTML)
            sib = sib.nextElementSibling
          }
          body = acc.join("\n")
        }
        const tmp = document.createElement("div")
        tmp.innerHTML = body
        const text = (tmp.textContent ?? "").trim()
        out.push({ title: title || `Prompt ${idx + 1}`, tier, text })
      })
      return out
    }

    // ---- Layout B: flat <p><strong>Prompt N.</strong> body</p> ----
    // Walk every <p> that opens with a Prompt-N marker. We also accept
    // <strong>Prompt N: Title</strong>; the trailing punctuation (.,:)
    // is stripped before keying off the number.
    const paragraphs = [...div.querySelectorAll("p")]
    const out = []
    let idx = 0
    for (const p of paragraphs) {
      const strong = p.querySelector("strong")
      if (!strong) continue
      const heading = (strong.textContent ?? "").trim()
      const promptMatch = /^Prompt\s+(\d+)\b/i.exec(heading)
      if (!promptMatch) continue
      idx++
      // Tier from the heading (T1/T2/...). If none, peek the body.
      const tierMatch = /\bT([1-4])\b/i.exec(heading) || /\bT([1-4])\b/i.exec(p.textContent ?? "")
      const tier = tierMatch ? parseInt(tierMatch[1], 10) : 1
      // Title: portion of the heading after "Prompt N[.:]" up to a
      // trailing dash or colon. Falls back to "Prompt N".
      const titleRaw = heading
        .replace(/^Prompt\s+\d+\s*[.:]?\s*/i, "")
        .replace(/\bT[1-4]\b\s*/i, "")
        .replace(/^[—-]+\s*/, "")
        .trim()
      const title = titleRaw || `Prompt ${promptMatch[1]}`
      // Body: paragraph content minus the heading strong.
      const pClone = p.cloneNode(true)
      pClone.querySelector("strong")?.remove()
      const text = (pClone.textContent ?? "").replace(/\s+/g, " ").trim()
        .replace(/^[—.\-:\s]+/, "")
      out.push({ title, tier, text })
    }
    return out
  }

  /** Foreshadowing → `Foreshadow[]` with structured `check` block. */
  static extractForeshadow(fragment) {
    if (!fragment) return []
    const div = document.createElement("div")
    div.appendChild(fragment.cloneNode(true))
    const items = div.querySelectorAll("ol > li")
    const out = []
    items.forEach((li, idx) => {
      const title = li.querySelector("strong")?.textContent?.trim() || `Prompt ${idx + 1}`
      // Walk siblings of the prompt's <ol> wrapper-div until the next
      // wrapper containing an <ol>. Split out the description + DC-box.
      const ol = li.parentElement
      const promptDiv = ol?.parentElement
      const bodyParts = []
      let checkHtml = null
      let sib = promptDiv?.nextElementSibling
      while (sib && !sib.querySelector?.("ol")) {
        if (!checkHtml && sib.querySelector?.("strong") &&
            /DC\s*\d/i.test(sib.textContent ?? "")) {
          checkHtml = sib.innerHTML
        } else {
          bodyParts.push(sib.textContent?.trim() ?? "")
        }
        sib = sib.nextElementSibling
      }
      const text = bodyParts.filter(Boolean).join(" ").trim()
      const check = checkHtml ? BeneosCreatureCodexParser._parseCheckBox(checkHtml) : undefined
      out.push({ title, text, check })
    })
    return out
  }

  /** Parse the DC + skills + result text out of a foreshadowing
   *  check box (e.g. "DC 15 Perception:<br>The figures exhibit…"). */
  static _parseCheckBox(html) {
    const tmp = document.createElement("div")
    tmp.innerHTML = html
    const strongs = tmp.querySelectorAll("strong")
    let dc = null
    let skills = []
    let modifier = undefined
    let headerEl = null
    for (const s of strongs) {
      const m = /DC\s*(\d+)\s*([^:.]*)/i.exec(s.textContent ?? "")
      if (m) {
        dc = parseInt(m[1], 10)
        const rest = (m[2] ?? "").trim().replace(/[:.]+$/, "")
        skills = rest ? rest.split(/[,/]\s*|\s+and\s+/i).map(t => t.trim()).filter(Boolean) : []
        headerEl = s
        break
      }
    }
    if (dc == null) return undefined
    // Result text = whatever sits after the header element. Try the
    // header's parent <p>: usually it has "<strong>DC X Y:</strong><br>Result".
    const parent = headerEl?.parentElement
    let result = ""
    if (parent) {
      const clone = parent.cloneNode(true)
      clone.querySelectorAll("strong").forEach(n => n.remove())
      result = (clone.textContent ?? "").replace(/^[\s:.\-]+/, "").trim()
    }
    // Detect modifier hints in parens like "(10+Insight)".
    const modMatch = /\(([^)]+)\)/.exec(headerEl?.textContent ?? "")
    if (modMatch && /[+]/.test(modMatch[1])) modifier = modMatch[1].trim()
    return { dc, skills, modifier, result }
  }

  /** Ability Prompts → `AbilityPrompt[]`. Per Master-Mock the row
   *  layout matches the legacy two-column abilities table — just
   *  drop the chip detection and keep name + flavor text. */
  static extractAbilityPrompts(fragment) {
    if (!fragment) return []
    const div = document.createElement("div")
    div.appendChild(fragment.cloneNode(true))
    const rows = div.querySelectorAll("table tbody tr")
    const out = []
    rows.forEach((tr, idx) => {
      const cells = tr.querySelectorAll("td")
      if (cells.length < 2) return
      const name = cells[0].textContent?.trim()
      const text = cells[1].textContent?.trim()
      if (!name || !text) return
      out.push({ name, text })
    })
    return out
  }

  /** Pull the first paragraph from a lore HTML blob, capped at ~25
   *  words, for the Hero "showcase" line. Falls back to the full
   *  paragraph if it's already short. */
  static extractShowcase(loreHtml, maxWords = 25) {
    if (!loreHtml || typeof loreHtml !== "string") return ""
    const tmp = document.createElement("div")
    tmp.innerHTML = loreHtml
    const firstPara = tmp.querySelector("p")?.textContent ?? tmp.textContent ?? ""
    const text = firstPara.replace(/\s+/g, " ").trim()
    if (!text) return ""
    const words = text.split(" ")
    if (words.length <= maxWords) return text
    return words.slice(0, maxWords).join(" ").replace(/[,;:.\-—]+$/, "") + "…"
  }

  /** Strip an HTML body to its plain-text form. Used for the Master
   *  schema which expects strings for lore / firstAppearance /
   *  deathPrompt, not HTML. */
  static htmlToPlainText(html) {
    if (!html) return ""
    const tmp = document.createElement("div")
    tmp.innerHTML = typeof html === "string" ? html : ""
    return (tmp.textContent ?? "").replace(/\s+/g, " ").trim()
  }

  /** Heuristic SizeTone derivation when the pipeline hasn't yet
   *  emitted explicit `flags.beneos-module.codex.tone`. Maps the
   *  creature type / biome to a hex-triple. Falls back to gold. */
  static guessSizeTone({ type, biome, faction } = {}) {
    const lc = (s) => (s ?? "").toString().toLowerCase()
    const t = `${lc(type)} ${lc(biome)} ${lc(faction)}`
    if (/aberration|cult|psionic/.test(t))   return { primary: "#3a1a2a", secondary: "#1a0a14", glow: "#a8745a" }
    if (/dragon|fire|volcanic/.test(t))       return { primary: "#3a1a14", secondary: "#1a0808", glow: "#d86a30" }
    if (/undead|necrotic|crypt/.test(t))      return { primary: "#1a1a2a", secondary: "#0a0a14", glow: "#7a5a9a" }
    if (/fey|forest|nature/.test(t))          return { primary: "#1a2a14", secondary: "#0a140a", glow: "#8bbf8b" }
    if (/elemental|ice|arctic/.test(t))       return { primary: "#1a2a3a", secondary: "#0a141c", glow: "#8faac6" }
    if (/construct|stone/.test(t))            return { primary: "#2a2a2a", secondary: "#141414", glow: "#a59d8e" }
    if (/humanoid|criminal|brawler/.test(t))  return { primary: "#3a2a1a", secondary: "#1a1408", glow: "#c89050" }
    return { primary: "#2a2014", secondary: "#14100a", glow: "#f5c992" }
  }

  /** Turn a tactical-sub HTML chunk into a TacItem[] tree. The
   *  algorithm: each `<ul>` / `<ol>` becomes a level; each top-level
   *  `<li>` is a TacItem; nested lists are children; inline text
   *  with bne-chip spans turns into a chip-segmented `text` array. */
  static extractTacItems(html) {
    if (!html || typeof html !== "string") return []
    const root = document.createElement("div")
    root.innerHTML = html
    const list = root.querySelector("ul, ol")
    if (list) return BeneosCreatureCodexParser._walkList(list)
    // No list found → single bullet from the wrapper's own content.
    const text = BeneosCreatureCodexParser._splitInlineChips(root)
    return text.length ? [{ text }] : []
  }

  static _walkList(listEl) {
    return [...listEl.children]
      .filter(li => li.tagName?.toLowerCase() === "li")
      .map(li => {
        const childList = li.querySelector(":scope > ul, :scope > ol")
        if (childList) childList.remove()
        const text = BeneosCreatureCodexParser._splitInlineChips(li)
        const item = { text }
        if (childList) item.children = BeneosCreatureCodexParser._walkList(childList)
        return item
      })
  }

  /** Walk the children of `el` left-to-right and produce a
   *  `(string | ChipPart)[]` array. `<span class="bne-chip bne--X">`
   *  elements are mapped via BNE_CHIP_KIND_MAP; standalone `<strong>`
   *  fragments fall through TEXT_KIND_HEURISTICS to infer a kind. */
  static _splitInlineChips(el) {
    const out = []
    const push = (s) => {
      if (typeof s === "string") {
        const last = out[out.length - 1]
        if (typeof last === "string") out[out.length - 1] = last + s
        else out.push(s)
      } else {
        out.push(s)
      }
    }
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child.textContent.replace(/\s+/g, " ")
          if (t.trim()) push(t)
          continue
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue
        const tag = child.tagName.toLowerCase()
        if (tag === "br") { push(" "); continue }
        // bne-chip span → ChipPart
        if (tag === "span" && child.classList?.contains("bne-chip")) {
          let kind = "context"
          for (const cls of child.classList) {
            if (BNE_CHIP_KIND_MAP[cls]) { kind = BNE_CHIP_KIND_MAP[cls]; break }
          }
          push({ chip: child.textContent.trim(), kind })
          continue
        }
        // Bare <strong> → infer kind from text heuristics
        if (tag === "strong") {
          const text = child.textContent.trim()
          if (text) {
            const hit = TEXT_KIND_HEURISTICS.find(h => h.re.test(text))
            push({ chip: text, kind: hit?.kind ?? "feature" })
          }
          continue
        }
        // Foundry inline-link [[/item Name]] renders as <a class="content-link" data-type="Item">
        if (tag === "a" && child.classList?.contains("content-link")) {
          push({ chip: child.textContent.trim(), kind: "feature" })
          continue
        }
        // Everything else: recurse so nested formatting (em/i) flattens.
        walk(child)
      }
    }
    walk(el)
    // Trim leading / trailing whitespace strings.
    while (out.length && typeof out[0] === "string" && !out[0].trim()) out.shift()
    while (out.length && typeof out[out.length - 1] === "string" && !out[out.length - 1].trim()) out.pop()
    return out
  }
}
