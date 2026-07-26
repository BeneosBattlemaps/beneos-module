# Product

<!-- impeccable:product-schema 1 -->

<!-- Canonical source: J:\Beneos_Webshop\_beneos_server_file_structure\PRODUCT.md
     Identical copies live in beneos_shopify_theme, beneos-cloud-server and beneos-module
     so the impeccable skill resolves product context from each repo root. Edit the
     canonical file first, then re-copy. Do not let the copies drift. -->

## Platform

web

## Users

Primary user: the **game master** running a tabletop RPG session, overwhelmingly **D&D 5e**. Two distinct situations, both real:

- **Preparing**, usually days or hours before a session, often under time pressure and usually at a desk. This is where assets are found, bought, and installed.
- **Running the table**, live, with players present. Here nothing may fail, load slowly, or demand configuration.

Three ways the same person consumes the product, and Foundry VTT is explicitly **not** required:

| Way of playing | What they need |
|---|---|
| Foundry VTT, deepest integration, one-click install | Foundry licence, Beneos module, cloud login |
| Other VTTs (Roll20, Alchemy, Fantasy Grounds) | the MP4 zips only |
| Tableplay at the physical table, map on a TV or projector | any video player |

Buying and browsing happens on a **mix of desktop and mobile**; mobile is a relevant share, not an edge case (confirmed by the operator, 2026-07-25). Installing and playing is desktop-only in practice.

Second audience: the **operator team** (currently the founder) in the cloud admin panel. Out of scope for the current design work but real.

## Product Purpose

Beneos sells **animated battlemaps** (with walls, lighting, fog, intro sequences and ambience already built) plus **play-ready creatures, spells and loot**. The promise is time: **play instead of prepare**.

Precision that user-facing copy repeatedly gets wrong: **only maps, sceneries and intro sequences are animated (video). Creatures, spells and loot are static images**, combat-ready but not animated.

Success means a GM goes from "I need a swamp encounter tonight" to a fully lit, walled, playable scene in minutes, without touching a wall tool.

## Positioning

The mechanism a neighbouring asset shop cannot truthfully copy: **the preparation work is already done and ships with the file.**

- Battlemaps arrive with **walls, lighting and fog pre-built**, plus **POI navigation** between scenes, installable in **one click** or as a bundle of releases.
- Creatures ship with a **tactical guide, foreshadowing mechanics, ability prompts, read-aloud start-up and death prompts**, and a **combat autopilot** that plans the first rounds so the creature is playable "brain-afk".
- Loot uses an **origin system**: items of one origin share abilities, attuning up to three grants set bonuses, three enables a ritual that fuses their powers and consumes the items. Supported by **item radar**, **shop creator** and **loot creator** in the module, and by an algorithmic pricing model that keeps all Beneos items balanced against each other.
- Everything also exists as **printable PDFs**, spells and loot additionally as **trading cards** in the Beneos design, reachable online and from a button inside the Foundry creature codex.

## Operating Context

- **Shopify (`beneos-battlemaps.com`) is the only public entrance.** All customer-facing surfaces of the cloud were sunsetted; `display-manager.php` redirects the former welcome, account and auth pages to the storefront.
- **Two separate Patreon campaigns**, neither includes the other: "Beneos Battlemaps" and "Beneos Creatures, Spells & Loot" (this exact wording is canonical). Membership and shop purchases both unlock cloud downloads.
- **Beneos Cloud** (PHP on OVH) holds entitlements and serves signed download URLs; the **Foundry module** consumes them through a cloud browser and a native battlemap installer.
- **Identity runs on email**, no shared SSO yet. The same person can arrive as a Patreon member, a Shopify customer, or both.
- **Release rhythm** the surfaces must accommodate: roughly two battlemap releases a month plus a backlog of over 1.800 maps, one creature every two weeks, 4 to 7 spells around the 20th, 1 to 7 loot items around the 10th.
- **Legacy tiers** exist and stay valid: Patreon historically forbade changing a tier's price, so new tiers were opened and old ones hidden. Hidden tiers still hold active paying members with full download rights, which is why the cloud resolves more tiers than are publicly visible.
- **Manual grants** exist alongside Patreon tiers (sponsors, gifts, support cases) and must be treated as full membership everywhere.

## Capabilities and Constraints

- **Foundry VTT: minimum V13, verified V14.** V13 stays supported while it is cheap to do so.
- **13 languages, mandatory and in this order:** en, de, fr, es, it, pt-BR, pt-PT, pl, cs, ca, ja, ko, zh-TW. Every locale file carries the identical key set; no hard-coded strings in a UI path.
- Creatures, spells and loot are designed **exclusively for D&D 5e** (statblocks, automation). The artwork is usable elsewhere; for Pathfinder 2e creatures ship on a default sheet so at least the images work. **There is no D&D-to-Pathfinder translator.**
- **Whole-campaign installs in one go are not active** (data volume, unclear benefit). Sub-clusters for large points of interest are planned.
- Hosting services (The Forge, Molten) are supported but constrained: shared performance, high storage cost. Self-hosting is the recommendation, and it requires write access for the module, a **file size policy above 1,5 GB**, and no transfer timeouts.
- Assets are large and animated. Bandwidth, file size and playback performance are product constraints, not implementation details.

## Brand Commitments

- **Campaign names are canonical**: "Beneos Battlemaps" and "Beneos Creatures, Spells & Loot". The variants "Tokens, Spells & Items" and "Tokens, Spells & Loot" are wrong and were removed in July 2026.
- **Legal safety wording, binding on every user-facing text**: never claim Beneos offers "Curse of Strahd", "Descent into Avernus" or comparable published adventures. Only ever state that content is **compatible with** them.
- **No em dashes or en dashes** (`—`, `–`) and no `--` as a sentence break, in any generated string, locale value, tooltip, lore or documentation. Ordinary hyphens for compounds stay.
- User-facing content is **English**; internal communication is German.
- The visual identity in use is dark, gold-accented and typographically editorial. Recorded here only as a fact, not as a direction. DESIGN.md owns the visual world.

## Evidence on Hand

Real and usable:

- A live catalogue of over 1.800 battlemaps plus regular creature, spell and loot releases, all with real artwork and thumbnails, served from the public catalogue CDN.
- Genuine product photography and captured Foundry screenshots throughout the theme (`assets/bpg-*`, 99 asset files).
- Two live Patreon campaigns with real, resolvable tier structures.
- Real analytics on account, login and job activity in the cloud admin panel.

Absences that future work must **not** fill with invention:

- **Reviews on the storefront come from the theme editor**, not from fixed defaults, and the section claims "Every review is real". Any review shown must therefore be a real quote from a real patron or customer. Never write filler testimonials into this section.
- The default review heading asserts a hard number ("Loved by 12 691+ game masters"). Such a claim needs a source before it ships. **Verify or remove; do not carry it forward unexamined.**
- No press coverage, awards, case studies or benchmark data exist. Do not imply any.

## Product Principles

1. **The preparation is the product.** Whatever a surface shows, it must make the saved work visible: walls already built, lighting already placed, one click to the table. An asset grid alone undersells it.
2. **Foundry is the deepest path, not the only one.** Every surface must stay truthful to the three ways of playing. Copy that assumes Foundry excludes paying customers who use another VTT or a television.
3. **Convincing and serving carry equal weight.** The storefront must sell to a stranger and, in the same session, let a paying member find their downloads fast. Where the two collide, the collision is the design problem, not an acceptable trade.
4. **Two purchase worlds, one person.** Patreon membership and shop purchase are separate mechanics but one customer with one email. Any surface that forces them to understand the internal split has failed.
5. **Live at the table means nothing may be fragile.** Slow, heavy or animation-hungry interface work is a product risk, not just a performance metric. The July 2026 compositor freezes are the standing proof.

## Accessibility & Inclusion

- **Target standard: WCAG 2.1 AA** (confirmed by the operator, 2026-07-25). Contrast below 4.5:1, missing keyboard operability, missing labels and broken focus order count as release-blocking defects, not polish.
- The interface is dark by default with a low-saturation gold accent. Dark themes fail contrast quietly, so contrast is a measured value here, never an impression.
- Content is animated by nature and the product wants **more** motion. `prefers-reduced-motion` therefore needs a genuine reduced alternative that preserves state changes and hierarchy, not a blanket kill and not unstoppable autoplay (WCAG 2.2.2).
- Thirteen languages including Japanese, Korean and Traditional Chinese: layouts must survive CJK line breaking and the length swings of Polish, Czech and Portuguese without clipping or overflow.
