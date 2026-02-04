# Change Log

All notable changes to this module will be documented in this file.

## Updates

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

