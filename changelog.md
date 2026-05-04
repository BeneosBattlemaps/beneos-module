# Change Log

All notable changes to this module will be documented in this file.

## Updates
### 14.0.4 # 2026-05-04
- New: **Beneos Cloud - completely redesigned interface.** A modern browse-and-install window with a fresh look, smoother animations, faster rendering and a cleaner layout designed around how you actually pick assets. Replaces the old Search Engine across Creatures, Maps, Items and Spells.
- New: **Beneos Cloud toolbar button.** The Cloud has a new permanent home in the left scene-controls toolbar, no longer hidden inside the Actor Directory. Open it from anywhere in Foundry - even on a fresh world before you've placed a scene.
- New: **Grid and List view modes.** Toggle between dense list cards or portrait-style grid tiles depending on how you like to browse. Your preference is remembered between sessions.
- New: **Asset detail drawer.** Click any creature, map, item or spell to slide open a side panel with full details - stats, tags, source, lore - without leaving the result list.
- New: **Bulk install actions.** Install all new content, all updates, every asset in your current view, or your entire backlog with a single click. Confirmation dialogs protect you from triggering large downloads by accident.
- New: **Multi-select with Ctrl/Cmd+click.** Pick several assets at once and install or drag them as a batch.
- New: **Smart asset grouping.** Search results are now organized into "New", "Updated" and "All Assets" sections so you immediately see what needs your attention.
- New: **Asset integrity check.** When you open a scene that uses Beneos content, the module verifies all referenced assets are actually on disk. If something's missing, you get one clear dialog with a link to the troubleshooting FAQ - no more silent 404s mid-session.
- Improved: **Search and filtering across the board.** Challenge Rating and Gold Price now use dual-thumb range sliders. Source and Biome filters support multi-select, with separate Biomes for Maps and Creatures (no more cross-contamination). New filter types: Faction, Campaign, Fighting Style, Purpose, Spell Type, Casting Time, Origin and Tier. Filters that don't apply to your current dataset hide themselves automatically.
- Improved: **Account and login.** Clearer error messages for network issues and invalid credentials. Patreon tier is re-checked on every login, so newly unlocked content shows up immediately without a manual reload. Automatic reconnect when you load a world while still signed in.
- Improved: **Performance.** Even searches with thousands of results stay responsive - cards load in as you scroll, thumbnails are fetched on demand, and the Cloud window no longer competes with the Foundry canvas for paint cycles.
- Improved: **Offline mode.** When the Beneos Cloud is unreachable, the search engine falls back to a local cached database. Cards from offline content show a clear cloud-offline indicator and disable installs until you're back online.
- Improved: **Battlemap browsing.** New filters for Brightness and Adventure, plus a Release-focus dropdown to zero in on a single map pack at a time.
- Improved: **Item filters.** Type names are deduplicated ("Light Armor" instead of "Light Armor +1/+2"), and Rarity is sorted in canonical D&D order (Common → Legendary) instead of alphabetically.
- Improved: **Patreon link awareness.** The footer's Patreon link now adapts to your current tab - Creatures/Loot/Spells link to the Beneos Tokens Patreon, Maps links to the Beneos Battle Maps Patreon.
- Improved: **Toast notifications.** Cleaner install confirmations, accurate counts of queued assets, and explicit Moulinette availability warnings.
- Improved: **13-language localization.** Full coverage of every UI string, tour step, notification and Easter-egg quote across English, German, French, Spanish, Italian, Portuguese (Brazil), Portuguese (Portugal), Polish, Czech, Catalan, Japanese, Korean and Traditional Chinese.
- Improved: **Smaller download.** Removed leftover assets from the previous interface to slim down the module package.

### 14.0.3 # 2026-04-28
- New: **Dark Mode support across the entire module.** Beneos creature, spell and loot journals - including all immersive integration boxes, tactical guide cards and DC check panels - now follow your active Foundry color scheme. Light mode keeps the classic beige + Beneos-red look, dark mode switches to a warm dark background with Beneos-gold accents that's easy on the eyes during long sessions.
- New: **Cloud News & Welcome dialogs** are now styled in the same dark-with-gold-glow CI as the rest of the Beneos onboarding, with subtle pulsing border for the latest message. Cloud-side announcements stay readable regardless of your Foundry theme.
- Improved: **Asset installation feedback** is now localized in all 13 languages and tells you exactly what to do next. Bulk installs explicitly point you to the Beneos Compendium where your tokens, spells and loot are ready to drag onto the scene; single Drag & Drop installs get their own concise confirmation.
- Improved: **Patreon tier auto-refresh.** Your tier status is now re-verified automatically every time you log in to the Beneos Cloud - newly unlocked content shows up without manual reload.
- Improved: **Missing-asset helper** now opens our always-current online FAQ in a new browser tab instead of a local troubleshooting journal that may have aged out with older Beneos installs. Moulinette-installed assets are now checked too, so users who installed packs through Moulinette get the same guidance.
- Improved: **Tour audio lifecycle.** Tutorial music no longer "follows" you onto unrelated scenes if you cancel a tour or navigate away - every other scene's own ambience plays cleanly.
- Fixed: Search engine occasionally failed to refresh after rapid filter changes (#331).

### 14.0.2 # 2026-04-22
- Updated: Automatic reference detection for missing assets has been improved and now points to an external URL instead of an internal journal (which, if present, is not updated and therefore offers no added value)

### 14.0.0 # 2026-04-19
- New: Foundry **V14 compatibility** - full module re-integration and migration for Foundry VTT V14. Existing V13 behaviour is preserved via a parallel v13/v14 data path.
- New: **Setup Tour** - interactive first-run tour that guides new users through the Moulinette Cloud login, filtering the Beneos creator and pack, and then automatically downloads + installs the Getting Started pack as a playable scene via ScenePacker.
- New: **Getting Started Tour** - comprehensive in-world demo tour based on a dedicated demo pack that walks players through every Beneos product line: Beneos **Battlemaps**, **Creatures**, **Spells**, and **Loot**, including the token HUD, skin variants, journal integrations, and the Beneos Search engine.
- New: **First-run prompt** - new patrons installing the module for the first time see a styled welcome dialog with an animated preview GIF and a "Don't show again" option, offering a one-click start of the Setup Tour.
- New: **Reference Checker** - users with incomplete or corrupt Beneos downloads now see a guided Beneos-styled notification with step-by-step recovery instructions instead of silent failures.
- New: **13 languages** - full translation of the tour system, prompts, and UI strings: Català, Čeština, Deutsch, English, Español, Français, Italiano, Polski, Português (Brasil), Português (Portugal), 日本語, 한국어, 繁體中文. The "Available in your language" intro step now lists all languages in alphabetical order.
- Updated: **Beneos documentation** Partially rewritten to match the new tour-driven onboarding, the V14 behaviour, and the Reference-Checker recovery flow.
- Updated: **DM-only information hidden from players by default** - all navigation icons, DM teleporters, and DM-facing overlays are now blanket-hidden for logged-in players, so only the GM sees them. Since this behaviour is now built into the Beneos module itself, the **LockView** module is no longer required and has been removed from the dependencies.
- Fixed: Multiple V13→V14 migration issues uncovered during integration (Application v1→v2 patterns, hook signatures, scene/actor data paths, tour DOM lifecycle).
- Fixed: Tour tooltip no longer lingers on screen during the post-install page reload.

### 13.2.10 # 2026-05-05
- Added: Beneos Cloud Message for Beneos Battlemaps Patrons (stating the cloud is only for Beneos Tokens Patrons for now)

### 13.2.9 # 2026-02-04
- Fixed: Loyalty Tokens are not displayed as available for some players
- Fixed: Lore text for items and creatures is now displayed more clearly
- Fixed: e.target?.closest is not a function error
- Fixed: Alternative token skins are now displayed correctly again
- Fixed: Log into Cloud Console randomly disappears
- Fixed: Missing moulinette references to battlemaps have been restored
- Added: Capital letters for map names for better readability
- Added: New spells and items are now always displayed at the top of the search list


### 13.2.8 # 2026-01-09
- Fixed: Uncaught TypeError: e.target?.closest is not a function
- Fixed: Alternative Token Skins are displayed colour-negative
- New: Module Setting - Disable Death Icon at 0 HP
- New: Advanced "Confirm Password" in Cloud Registration Process

### 13.2.7 # 2025-09-24
Changed Dependencies

### 13.2.6 # 2025-09-20
- New: There are new filter options for Beneos tokens. Campaign shows suggestions for campaigns where the creature fits well. Faction shows allies of the creature with synergy effects. Source now allows you to filter by Beneos tokens, SRD tokens, loyalty tokens, and shop content.
- New: We now have a news and welcome window for new users, with links to the setup and our Discord for questions.
- New: All tokens now have a label-formatted tactical guide in which terms and conditions are individually formatted to improve readability and make them even easier to understand.
- New: All assets downloaded from the Beneos module are now world-specific, meaning they must be downloaded individually for each world, but they will no longer be deleted during module updates.
- Updated: The tokens interface has been modified and the filters have been sorted alphabetically.
- Fixed: The Download ALL button on the cloud website has been fixed.
- Fixed: Several typos and rogue spaces. Dieser Text bricht jetzt ganz normal um, wenn du das Journalfenster verkleinerst.


### 13.2.5 # 2025-09-06
 - World compendiums have now been created for each world in which the downloads are stored. This means that the compendium will only be emptied during this last update and will remain untouched in the future, even during updates.
 - Cloud Website now has an "Already downloaded indicator"
 - Not all variants of a token are installed in the actor browser anymore, only the first one (the rest is controlled on the canvas via the variant skin feature).
 - There is now free content for non-Patrons to view a selection of tokens, spells, and items.
 - Fixed: Download ALL via the cloud website now works as expected again.

### 13.2.4 # 2025-09-03
 - Additionnal checks for corrupted data structures in users world preventing loading

### 13.2.3 # 2025-09-02
 - Additionnal checks when dealing with the beneosTokens data structure
 - Remove deprecated settings

### 13.2.2 # 2025-09-02
 - improved encoding to fix login issues with the HTTP protocol

### 13.2.0 # 2025-09-01
Complete rework of the Beneos tokens, spells, and items module infrastructure
- Beneos Battlemaps is not affected (yet)
- Tokens, spells, and items are now installed directly into the Foundry VTT world via the Beneos Cloud
- Manual installation (including compendium rebuild) is no longer necessary or possible
- All content is installed via the Beneos search engine
- There is a new setup video in English, German, and French: https://www.youtube.com/watch?v=6lTrpOILOTo
- The Beneos module must now be linked to a Beneos account (https://beneos.cloud/).

### 13.0.1 # 2025-05-29
 | For FoundryVTT v13+
Update: Dependency Manifest Links
Added: FXMaster as dependency again because it was unexpectedly updated

### 12.1.0 # 2025-01-08
- Fixed some incompatibilities
- Beneos Search Engine has been updated (New images to reflect the new 2.5D tokens)
- Added a new tabletop mode (deactivated at the moment until it's 100% pollished)
- Added the ability to read and work with new beneos tokens, spells and loot
- Added new Icons for the new Beneos Module

### 12.0.6 # 2024-09-02
- Fixed a V12 bug preving button functions on actor context menu

### 12.0.5 # 2024-07-14
- Added compatibility with the Vision5E Module

### 12.0.4 # 2024-06-16
- The module handles the TokenDocument5e#actorData Warning now
- We added a progress bar for the import process to give more feedback
- We added several optimizations for V12
- We drastically optimized the cleaning process for compendiums. The cleaning should now be 60% to 90% faster.

### 12.0.3 # 2024-05-29
- The search engine works properly again

### 12.0.2 # 2024-05-27
- Fixed An JS issue that changed the behaviour of the "this" keyword. This should lead to a more consistent The Forge integration

### 12.0.1 # 2024-05-23
- Added V12 compatibility for the core module (not the dependencies!)
- Added solutions to prevent the "The token key see seems wrong" from appearing this often
- Added compatibility with the Rideable module

### 11.0.11 # 2024-03-06
- The Beneos Module does not affect PF2E Sheets anymore
- We fixed a bug that prevented the journal icon from appearing
- Tokens are rotated towards the direction they are moved again
- We fixed a bug that prevented items from beeing draged and droped into the recent Foundry VTT DnD v3 System
- Search Engine links are now opened in a new browser window

### 11.0.10 # 2024-02-01
- New Feature Static Switcher: Make animated map a static image to safe performance
- New Feature Direct Download: If you find a map in the search engine, you can now download it directly in Moulinette via the download icon without having to search for a long time.
- Map Icons are larger now
- Classes have been fixed in the search engine for spells
- Titles are now cut off if they have too many characters in the search engine

### 11.0.9 # 2023-12-18
- Fixed: You can  drag and drop assets from the search engine after a content scan without F5 again.
- Fixed: Tooltip Descriptions

### 11.0.7 # 2023-12-9
- Fixed: Icon Pathing for Module related icons
- Added: Code Optimization


### 11.0.6 # 2023-12-8

- Added: Abilitiy icons to the module to make it easier for hosting service user and shop customers to install tokens
- Added: The module now checks if the beneos_assets folder is present and correctly named

