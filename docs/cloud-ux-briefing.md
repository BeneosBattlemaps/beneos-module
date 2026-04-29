# Beneos Cloud — UX Hardening Briefing

> **Purpose:** A discussion document listing concrete module-side improvements that sharpen how end users perceive the Beneos Cloud. Status: 2026-04-29. This file is *not* an implementation order — items in here are reviewed and approved before any code changes happen.

## 1. Architecture verdict in one sentence

The concept (Patreon webhook replica → own user DB → pseudonymous `foundryId` → server-personalized asset list) is **solid and scales**. The rough edges are all in the **module-side code/UX layer** and can be ironed out with surgical small interventions — no refactor of the data flow required.

## 2. Beneos access model (clarification for future code decisions)

| Account state | Visible content |
|---|---|
| Not logged in | Locally installed assets only |
| Logged in, **Free account** | Subset of tokens explicitly released for free users |
| Logged in, **Paid Patron** (any tier) | Full asset library |
| Account with **Loyalty Tokens** | Plus the loyalty items their account was assigned at the publication cut-off date |

**Important:** there is **no differentiation between Paid tiers**. All paid patrons see the same asset set. The system does not split "Tier A sees 100 tokens, Tier B 200". Consequence for UI: a central `canUserAccess(asset)` function is trivial — it just checks "did the server include this in the per-account list? → yes". No tier mapping needed.

### Loyalty Tokens — special case

- Permanently assigned to accounts that were active patrons on the publication date.
- Former patrons, new patrons (after the cut-off), free users: do **not** receive them.
- This is also why the server returns a **per-account asset list** rather than a global one — not for tier filtering, but for per-account loyalty assignment.
- The module needs no special logic. The server decides at `?get_content=1` time what is in the account; the module just renders the result.

## 3. Guiding principle: "in dubio pro reo"

For every UI decision "should I show this content / enable this control?" the rule is: **when in doubt, show it; never lock down preemptively.**

- **Loading states**: don't display "Cloud not available" while data is in flight. Use "Loading…" or optimistically show the cloud icon.
- **Race conditions**: don't render false-negative when `availableContent` is still empty. Fall back to "probably available".
- **Server-side reject**: only block at the actual install click. Don't preemptively disable the UI.
- **Live status polling**: deliberately NOT implemented. We do not let the user's status degrade mid-session at the user's expense.
- **Default values for capability flags**: optimistic (`isInstallable = true`, `accessible = true`) until proven otherwise.

## 4. Concrete hardening items (prioritized)

### Wave 1 — quick module-side hygiene (no UI swap, no server change)

These are small, local edits — each ~a few lines, with an inline comment naming the issue ID (e.g. `// Fix #B5: replaceAll instead of replace, see beneos-search-engine skill`).

| ID | Where | What | Effect |
|---|---|---|---|
| **B1** | `beneos_cloud.js:139` | `availableContent = []` → `{ tokens:[], items:[], spells:[] }` | Eliminates the "I'm logged in but see nothing" race in the first seconds |
| **B2** | `beneos_cloud.js:279` | `checkAvailableContent()` returns a Promise; UI can await it | UI shows "loading…" instead of falsely "not available" |
| **B5** | `beneos_cloud.js:202, 215` | `replace("-","_")` → `replaceAll("-","_")` | Items with ≥2 hyphens are correctly recognized as cloud-available (silent bug today) |
| **C3** | `beneos_cloud.js:770–776` | Settings update only on successful actor create (guard) | UI no longer shows "installed" badges for tokens whose compendium entry never materialized |
| **C5** | `beneos_cloud.js:315` | Reset `noWorldImport` flag on entry into single-install paths | Single install after a crashed batch lands in the Actors folder again |
| **E2** | `beneos_cloud.js:782` | Make settings write atomic, or per-asset-key instead of full JSON | Parallel installs no longer lose half the tracking data |
| **E4** | `beneos_cloud.js:979` | Verify and fix the duplicated `.FilePicker` path — looks like a typo | **Likely a production bug** — battlemap upload may already be broken today |
| **E7** | several URLs | `encodeURIComponent()` on every URL build site | Asset keys with special characters become installable again |
| **F1** | many `ui.notifications.*` | Hardcoded English → `game.i18n.localize("BENEOS.Cloud.…")` with keys in all 13 languages | Currently violates Beneos's own localization standard |

### Wave 2 — flag for later, requires server coordination

| ID | What | Reason |
|---|---|---|
| **A10** | Move login credentials from URL query to POST body | Otherwise the password lands in browser history and server access logs |
| **G2** | Migrate jQuery sites (e.g. `$().html()` line 843) to vanilla JS | jQuery deprecated in Foundry V14 — silent breakage at the V14 cut-over otherwise |

### Wave 3 — bundled with the new design (V2)

These are not to be retrofitted into V1 — they should be part of the ApplicationV2 migration because they are UX lifecycle topics:

- **A2/A3** Visible login feedback (spinner, timeout notification, disabled-while-pending state on the login button)
- **A5/A6** Replace `window.location.reload()` with proper re-rendering
- **A9** Server response `result: "session_expired"` (server-side change required) → module triggers re-login modal
- **C2** Search engine preserves filter, scroll position, and tab across each install (current behavior: full close+reopen)

### Wave 4 — architectural maturity (long-term)

These are **not** must-haves for Q2/Q3 but pay off if the patron volume grows 5×:

- **Enrich server responses**: `/foundry-manager.php?check=1` could additionally return: `is_free_user` (bool), `loyalty_token_count` (for display), `quota_used_bytes`, `server_time`. Saves future round-trips.
- **Central `canUserAccess(asset)` function** in the module — minimal form: "server included it in the list? → yes". Plus a special rule for free-user tokens if those are decided client-side.
- **Single `import…(category, key)` entry point** instead of four separate functions. The duplication in `importTokenToCompendium` / `importItemToCompendium` / `importSpellToCompendium` (~70 % identical logic across 100–180 lines each) is the largest maintainability pain point today.

## 5. What is deliberately NOT on the list

These items are skipped on purpose, with reasoning:

| Skipped | Reason |
|---|---|
| Live Patreon status re-poll during session | Status changes mid-session are rare; the next login picks them up. In-dubio-pro-reo: the user keeps access until the next login at worst. |
| Tier-based UI filtering | The business model has no such differentiation (all paid tiers see the same content). Free-vs-Paid + Loyalty Tokens are already handled correctly by the server. |
| Refreshing the asset list during a live session | New releases mid-session are rare; a Foundry reload is an acceptable refresh point. |

## 6. Risks of doing nothing

If none of the hardening lands, we accept:

- "I'm logged in but see nothing" right after Foundry start (B1+B2) — today's classic support ticket, easily fixed.
- Items with multi-hyphen keys remain invisible (B5) — gets worse as content grows.
- Battlemap upload possibly broken in production (E4) — **needs explicit verification**.
- False "installed" indicator for failed imports (C3) — undermines trust at drag-and-drop time.
- Silent login failures on flaky networks (A2/A3) — users click helplessly multiple times.
- Language inconsistency for DE/FR/etc. users (F1) — degrades brand perception.

## 7. References

- Full vulnerability catalogue (A1–J3) with severity tiers: kept in Beneos's local memory (`beneos_cloud_known_issues.md` — internal)
- Cloud endpoint inventory: `beneos_cloud_communication.md` (internal)
- UI architecture: `beneos_search_engine_architecture.md` (internal)
- Deeper skill document for future code work: `beneos-search-engine` skill (internal)
- Plan file with phase split A/B: `dieses-video-vermutlich-wei-dynamic-mist.md` (internal)
- Future design (V2): `D:\PNP_Game\Foundry VTT\FoundryVTT\Beneos Foundry VTT Module Design 2.0\handoff\INTEGRATION.md`
