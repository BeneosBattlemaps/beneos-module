# Beneos Foundry VTT Module — Design 2.0 Mapping

This document is a bridge between the new design prototype and the existing module code. It is **read-only documentation** — it does not change behavior.

## Source

- **Design bundle:** `D:\PNP_Game\Foundry VTT\FoundryVTT\Beneos Foundry VTT Module Design 2.0\`
- **Open in browser:** `Beneos Cloud.html` (loads React + Babel from CDN — no build needed)
- **Read first:** `handoff/INTEGRATION.md`, `handoff/design-tokens.css`, `handoff/api-contract.md`, `handoff/README.md`

## Design summary (verbatim direction from handoff)

- **Unified single window** replacing the old Form + Results split (Tokens/Maps/Items/Spells tabs at top).
- **Filter sidebar on the left** — search, chips, sliders, dropdowns, source checklist with counts.
- **List + Grid view** with switchable density (List default for Tokens & Maps).
- **Detail drawer** slides in from right on row click.
- **Maps paired** (battlemap + scenery) as a single installable unit with hover-crossfade — *server-side change, deferred to Welle 2*.
- **Releases** = clusters of maps with their own atmospheric hero artwork — *server-side change, deferred*.
- **Install button** has 4 states: idle / in-progress (bar) / installed (green ✓) / update-available (blue dot).
- **Account chip** in sidebar footer; login modal opens automatically when install attempted while offline.
- **Three themes** via `[data-bc-theme]`: dark (default), parchment, neutral. Welle 1 ships only `dark`.
- **Quick Picker** — separate compact window for in-scene asset drops.

## Brand decision

- **Accent color: Beneos Gold `#f5c992`** (replaces the legacy `#ff6400` orange). One accent only in dark theme.
- Per-category tints (`--bc-cat-tokens` `#d98876`, `--bc-cat-maps` `#7fb3ad`, `--bc-cat-items` `#e0b36a`, `--bc-cat-spells` `#a692d4`) opt-in via `[data-cat-accent="on"]`.
- Fonts: Inter (UI), Fraunces (display, sparingly), JetBrains Mono.

## Component-to-code mapping

| Mockup component | Prototype file | Maps onto today's code | Note |
|---|---|---|---|
| `<FloatingWindow>` | `prototype/FloatingWindow.jsx` | NOT a code mapping — Foundry's `ApplicationV2` chrome replaces this | DROP from port |
| Top tab strip | inside `app.jsx` | `<button id="beneos-radio-{token|bmap|item|spell}">` in `templates/beneossearchengine.html` | preserve IDs as Tour aliases |
| `<FilterSidebar>` | `prototype/FilterSidebar.jsx` | Filter form sections in `beneossearchengine.html` (token/bmap/item/spell sub-sections) | restructure to vertical sidebar |
| `<Results>` | `prototype/Results.jsx` | The 4 `beneos-search-results-*.html` templates | unify with category-aware part rendering |
| `<ReleaseCard>` | `prototype/ReleaseCard.jsx` | NEW concept — no current code | server-side, Welle 2 |
| Detail drawer | inside `Results.jsx` | NEW concept — no current code | slide-in panel inside the V2 window |
| `<LoginModal>` | `prototype/LoginModal.jsx` | `BeneosCloudLogin.loginDialog()` in `scripts/beneos_cloud.js:22` (DialogV2) | reskin only — backend stays |
| `<QuickPicker>` | `prototype/QuickPicker.jsx` | NEW window — no current code | Welle 1 second ApplicationV2 |
| `<TweaksPanel>` | `prototype/TweaksPanel.jsx` | DESIGN-ONLY DEBUG TOOL | DELETE — never port |
| `data.jsx` mock arrays | — | Replace with adapter over existing `BeneosCloud.checkAvailableContent()` + database CDN | shape-mismatch documented in `handoff/api-contract.md` |
| Install button (4 states) | `app.jsx` install state machine | Today: install starts, full re-render after | hardening + 4-state UI in Welle B-3+ |
| Status bar (storage/sync/issues) | `app.jsx` | NEW — partial info exists in settings | Welle 1 |
| Right icon-rail | inside `FloatingWindow.jsx` | Foundry's actual sidebar — DO NOT recreate | DROP |
| `.vtt-canvas` simulation | `styles.css` | Foundry's actual scene canvas | DROP from CSS port |

## Phase-B waves (from plan)

The implementation will follow the wave plan in `C:\Users\Beneos\.claude\plans\dieses-video-vermutlich-wei-dynamic-mist.md`:

- **B-1:** quick-win bug-fixes (no UI change) — issues B5, B1, A2, A3, A4, C3, E7, E4-verify
- **B-2:** live patreon-status refresh (server-coordination needed for D2)
- **B-3:** CSS token system + gold rebrand (no HTML change)
- **B-4:** Search-Form V2 (single window, ApplicationV2)
- **B-5:** Search-Results V2
- **B-6:** Unified `BeneosCloudWindow` (optional, after V2 windows prove out)
- **B-7:** Quick Picker, Releases (server-side), themes parchment/neutral

Each wave is a separate user-approval point.

## What this document is not

- Not a spec — the bundle's `handoff/INTEGRATION.md` is the actual integration spec.
- Not auto-generated — keep updating it as Phase B progresses (or delete if it goes stale).
- Not part of the module runtime — files under `docs/` are documentation only and not loaded by `module.json`.
