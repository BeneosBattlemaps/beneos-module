# Beneos Creature Codex — Data Schema (v1)

This document is the **single source of truth** for the structured
codex record that drives the in-game `Creature Codex` window. The
codex window reads only from this shape — no HTML parsing at render
time. The Welle-6b migration pipeline converts the legacy journal +
biography HTML once and writes the result here.

- Implementation: `scripts/codex/codex-schema.mjs`
- Storage: `actor.flags.beneos-module.codex`
- Validator: `validateCodexData(data)` returns `{ valid, errors[] }`

---

## 1. Flag envelope

The actor flag holds an envelope plus the data:

```jsonc
actor.flags["beneos-module"].codex = {
  "$version":  1,                              // CODEX_SCHEMA_VERSION
  "$migrated": "2026-05-15T19:42:00Z",         // ISO of last migration
  "data": { /* CodexData — see §2 */ }
}
```

`$version` lets the migrator route old flags through one-time
upgrades when the schema grows. Bump whenever a field is renamed
or removed.

---

## 2. CodexData — top-level

```jsonc
{
  "identity":      { ... },     // §2.1
  "visuals":       { ... },     // §2.2
  "narrative":     { ... },     // §2.3
  "abilities":     [ ... ],     // §2.4 — referenced by tactical
  "storyHooks":    [ ... ],     // §2.5
  "foreshadowing": [ ... ],     // §2.6
  "combat":        { ... },     // §2.7
  "tactical":      { ... }      // §2.8
}
```

### 2.1 `identity`

```jsonc
"identity": {
  "tokenKey":      "month_1_bone_hag",     // required, primary key
  "name":          "Bone Hag",              // required
  "type":          "Medium Fey (Hag)",
  "cr":            8,                       // number or null
  "biome":         "underdark",
  "faction":       "primordial",
  "fightingStyle": ["debuff", "area"],
  "purpose":       ["boss"]
}
```

`tokenKey` mirrors `actor.getFlag("world","beneos").fullId` so the
codex can round-trip back to the cloud asset.

### 2.2 `visuals`

```jsonc
"visuals": {
  "sizeTone": { "primary": "#3a1a2a", "secondary": "#1a0a14", "glow": "#a8745a" },
  "portraitInitial":   "B",
  "heroImageUrl":      "beneos_assets/beneos_tokens/000-month_1_bone_hag/000-month_1_bone_hag-1-journal.webp",
  "heroImageBase64":   "data:image/webp;base64,UklGRk…",
  "heroImageCachedAt": "2026-05-15T19:42:00Z"
}
```

`sizeTone` drives the hero gradient + radial glow. The migrator
derives a default from creature type/biome; the GM can override
in the editor.

`heroImageBase64` is **optional**: the migrator can embed the
player-handout image as a dataURL to eliminate runtime fetches.
At ~250 KB per image × 579 creatures the world DB grows ~145 MB,
so the migrator surfaces this as a user toggle. When the field is
absent the renderer falls back to `heroImageUrl`.

### 2.3 `narrative`

```jsonc
"narrative": {
  "showcase":          "A vessel of forbidden powers...",
  "lore":              "Not every cult is heard...",
  "recommendedAllies": ["Cult Oracle", "Acolyte of Murder", "Witherflesh Ripper"]
}
```

All three are plain text (no HTML). The Overview tab renders `lore`
as a blockquote and `recommendedAllies` as a simple bullet list.

### 2.4 `abilities`

Structured list of every creature ability. Referenced from
`tactical.*` via `{ "ref": "<id>" }` segments.

```jsonc
"abilities": [
  {
    "id":             "bountiful_gifts",     // lowercase_with_underscores
    "name":           "Bountiful Gifts",
    "type":           "trait",                // action|bonus|free|reaction|legendary|lair|trait
    "flavorText":     "The creature convulses, new limbs tearing free…",
    "mechanicalText": "Roll 1d4 at the start of the turn..."
  }
]
```

`id` is the **slug** the tactical refs target. Two abilities cannot
share an id (the validator rejects duplicates).

If the actor has a matching Foundry Item (e.g. `actor.items.getName("Bountiful Gifts")`),
the renderer can also open its item sheet on ref-click.

### 2.5 `storyHooks`

```jsonc
"storyHooks": [
  {
    "id":          "hook-1",
    "tier":        1,                        // 1 | 2 | 3 | 4
    "title":       "Old Town",
    "description": "Locals avoid an old tenement after several disappearances."
  }
]
```

`tier` drives the `T<n>` campaign-integration badge:
- 1 = intro / low stakes
- 2 = mid-game subplot
- 3 = arc climax
- 4 = capstone

### 2.6 `foreshadowing`

Each entry pairs a **discovery clue** (`check`) with an optional
**countermeasure-strategy** (`countermeasure`) so prepared players
can react with concrete actions.

```jsonc
"foreshadowing": [
  {
    "id":          "foresee-1",
    "title":       "Midnight Movements",
    "description": "Late at night, robed figures move erratically through alleys.",
    "check": {
      "dc":     16,
      "skills": ["Perception"],
      "result": "These figures exhibit physical deformities."
    },
    "countermeasure": {
      "dc":          19,
      "skills":      ["Arcana", "Investigation"],
      "result":      "The mutations bear runic seals — Detect Evil/Good or Holy Water disrupts them.",
      "preparation": "Bring blessed weapons or scrolls of Dispel Magic."
    }
  }
]
```

`countermeasure` is **optional**. When absent the foreshadow card
shows only the discovery check. Typical pattern: countermeasure
DC is higher than the discovery DC (rewards investigation depth).

### 2.7 `combat`

```jsonc
"combat": {
  "firstAppearance": "A disjointed figure emerges from the shadows…",
  "deathPrompt":     "The Possessed stumbles, limbs locking…"
}
```

Plain text — the Combat-Theater tab posts them to chat-log via
`readAloud()` and the Death-Prompt popup uses `deathPrompt` as its
body text.

### 2.8 `tactical`

Phase-keyed map of `TacticalLine[]` arrays. Empty phases may be
omitted; the playbook stepper hides empty ones automatically.

**Phases (in turn order):**
- `beforeCombat`  — preparation, ambush positioning, stealth setup
- `startOfTurn`   — triggers, rule dice
- `movement`      — positioning
- `actions`       — primary action
- `bonusActions`  — bonus actions
- `freeActions`   — free / conditional actions
- `reactions`     — reactions
- `endOfTurn`     — lingering effects
- `traits`        — always-on rules (rendered in the playbook sidebar)

#### TacticalLine

A single rule line. Its `text` is an **array of mixed strings and
typed segments** (see §3 for segment kinds). `children` allows
nested if/then trees.

```jsonc
{
  "text": [
    "Roll ",
    { "roll": "1d4" },
    " to determine which ",
    { "ref": "bountiful_gifts" },
    " effect activates."
  ],
  "children": [
    {
      "text": [
        { "context": "On 1" }, " ",
        { "ref": "parasitic_protrusions" },
        " becomes available as ",
        { "action": "bonus" }, "."
      ]
    }
  ]
}
```

---

## 3. TextSegment kinds

Every element of `TacticalLine.text` is either a plain string
(rendered as `<span class="cdx-tac-text">`) or one of these
**typed-object** segments:

| Kind        | Shape                                          | Render class            | Rollable |
|-------------|------------------------------------------------|-------------------------|----------|
| `ref`       | `{ ref: "<slug>", label?: "..." }`             | `.cdx-ref`              | no — click opens item sheet or scrolls to ability |
| `roll`      | `{ roll: "1d4" }` or `{ roll: "2d8+3" }`       | `.cdx-chip-dice`        | **yes** |
| `dc`        | `{ dc: 15, skills?: ["Strength Saving Throw"] }` | `.cdx-chip-dc`        | **yes** — rolls 1d20 vs DC |
| `tohit`     | `{ tohit: 5 }`                                 | `.cdx-chip-tohit`       | **yes** — rolls 1d20+5 |
| `condition` | `{ condition: "Restrained" }`                  | `.cdx-chip-condition`   | no |
| `mechanic`  | `{ mechanic: "Speed", value?: "+10" }`         | `.cdx-chip-mechanic`    | no |
| `context`   | `{ context: "When …" }`                        | `.cdx-chip-context`     | no |
| `action`    | `{ action: "bonus" }`                          | `.cdx-chip-action`      | no |
| `target`    | `{ target: "One Creature" }`                   | `.cdx-chip-target`      | no |
| `range`     | `{ range: "5 Ft." }`                           | `.cdx-chip-range`       | no |

Rollable segments fire via `codex-chip-roller.mjs` → Foundry `Roll`
→ `toMessage({ speaker })`. The `ref` segment is **not** rollable;
clicking it opens the referenced ability's item sheet (or scrolls
to its Theater-tab card if the actor has no matching item).

### 3.1 Validation rules for segments

- Plain strings: any non-empty string.
- Typed objects must have **exactly one** of the 10 typed keys
  (`ref` / `roll` / `dc` / `tohit` / `condition` / `mechanic` /
  `context` / `action` / `target` / `range`), plus optional sidecar
  fields (`label`, `skills`, `value`).
- `ref.ref` must be a slug **and** must exist in `data.abilities[].id`
  (the validator checks integrity).
- `dc.dc` must be a positive number.
- `action.action` must be one of `action | bonus | free | reaction | legendary | lair`.

---

## 4. Worked examples

### 4.1 Cult Possessed (master mock — full content)

```jsonc
{
  "identity": {
    "tokenKey": "tkn-cult-possessed", "name": "Cult Possessed",
    "type": "Medium Aberration", "cr": 3,
    "biome": "urban", "faction": "cults",
    "fightingStyle": ["Pack", "Melee"], "purpose": ["Damage", "Gimmick", "Minion"]
  },
  "visuals": {
    "sizeTone": { "primary": "#3a1a2a", "secondary": "#1a0a14", "glow": "#a8745a" },
    "portraitInitial": "P", "heroImageUrl": "icons/svg/mystery-man.svg"
  },
  "narrative": {
    "showcase": "A vessel of forbidden powers...",
    "lore":     "Not every cult is heard...",
    "recommendedAllies": ["Cult Oracle", "Witherflesh Ripper"]
  },
  "abilities": [
    { "id": "bountiful_gifts",       "name": "Bountiful Gifts",       "type": "trait",
      "flavorText": "The creature convulses, new limbs tearing free." },
    { "id": "parasitic_protrusions", "name": "Parasitic Protrusions", "type": "bonus",
      "flavorText": "Wet tendrils shoot out from its throat." },
    { "id": "rake_and_claw",         "name": "Rake and Claw",         "type": "action",
      "flavorText": "Its claws shred armour and flesh alike." }
  ],
  "storyHooks": [
    { "id": "hook-1", "tier": 1, "title": "Old Town", "description": "Locals avoid an old tenement…" }
  ],
  "foreshadowing": [
    {
      "id": "foresee-1", "title": "Midnight Movements",
      "description": "Robed figures move erratically through alleys.",
      "check": { "dc": 16, "skills": ["Perception"], "result": "Figures exhibit deformities." },
      "countermeasure": {
        "dc": 19, "skills": ["Arcana"], "result": "Runic seals — Holy Water disrupts.",
        "preparation": "Bring blessed weapons or Dispel Magic."
      }
    }
  ],
  "combat": {
    "firstAppearance": "A disjointed figure emerges from the shadows…",
    "deathPrompt":     "The Possessed stumbles, limbs locking…"
  },
  "tactical": {
    "startOfTurn": [
      {
        "text": ["Roll ", { "roll": "1d4" }, " for ", { "ref": "bountiful_gifts" }, "."],
        "children": [
          { "text": [{ "context": "On 1" }, " ", { "ref": "parasitic_protrusions" }, " available as ", { "action": "bonus" }, "."] }
        ]
      }
    ],
    "movement":     [{ "text": [{ "action": "action" }, " Get into melee range."] }],
    "bonusActions": [
      { "text": [{ "ref": "parasitic_protrusions" }, ": ", { "dc": 15, "skills": ["Strength Saving Throw"] }, "."] }
    ],
    "actions": [
      { "text": [{ "ref": "rake_and_claw" }, " — ", { "tohit": 5 }, ", ", { "range": "5 Ft." }, ", ", { "roll": "2d4+3" }, " slashing."] }
    ],
    "traits": [
      {
        "text": [{ "ref": "bountiful_gifts" }],
        "children": [
          { "text": [{ "context": "On 1-10" }, " ", { "context": "Saving Throw" }, " fails."] },
          { "text": [{ "context": "On 11-20" }, " auto-succeeds."] }
        ]
      }
    ]
  }
}
```

### 4.2 Bone Hag — migrated from existing journal

Migrated state, all sections present, some `countermeasure` fields
left empty pending GM authoring. Only the schema-relevant fields
are shown:

```jsonc
{
  "identity": { "tokenKey": "month_1_bone_hag", "name": "Bone Hag",
                "type": "Large Fey (Hag)", "cr": 8 },
  "abilities": [
    { "id": "multiattack",  "name": "Multiattack",  "type": "action", "flavorText": "" },
    { "id": "spine_whip",   "name": "Spine Whip",   "type": "bonus",  "flavorText": "" },
    { "id": "bone_ridge",   "name": "Bone Ridge",   "type": "trait",  "flavorText": "" }
  ],
  "storyHooks": [
    { "id": "hook-1", "tier": 1, "title": "Prompt 1", "description": "Work in Progress" },
    { "id": "hook-2", "tier": 1, "title": "Prompt 2", "description": "Work in Progress" },
    { "id": "hook-3", "tier": 1, "title": "Prompt 3", "description": "Work in Progress" }
  ],
  "foreshadowing": [
    { "id": "foresee-1", "title": "Prompt 1", "description": "Work in Progress",
      "check": { "dc": 10, "skills": ["Check1", "Check2"], "result": "Work in Progress" } }
  ]
}
```

The migrator produces this skeleton; the GM then enriches via the
structured editor (Welle 6c).

### 4.3 Empty / custom NPC (no journal)

```jsonc
{
  "identity": { "tokenKey": "", "name": "Custom NPC", "type": "", "cr": null,
                "fightingStyle": [], "purpose": [] },
  "visuals":  { "sizeTone": { "primary": "#2a2014", "secondary": "#14100a", "glow": "#f5c992" },
                "portraitInitial": "C" },
  "narrative": { "showcase": "", "lore": "", "recommendedAllies": [] },
  "abilities": [], "storyHooks": [], "foreshadowing": [],
  "combat":   { "firstAppearance": "", "deathPrompt": "" },
  "tactical": {}
}
```

`emptyCodexData(tokenKey, name)` returns this exactly.

---

## 5. Adding a new field — checklist

When the schema needs to grow:

1. Update the JSDoc typedef in `codex-schema.mjs`.
2. Add validation in `validateCodexData()`.
3. Bump `CODEX_SCHEMA_VERSION` if the change is non-additive
   (renaming / removal). Migrator gains a version upgrader.
4. Update this document with the new field's spec.
5. Update the structured editor (Welle 6c) so GMs can author it.
6. Update the migrator (Welle 6b) so HTML imports produce it.
