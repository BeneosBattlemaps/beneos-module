# Change Log

All notable changes to this module will be documented in this file.

## Updates

### 2022-10-01

- Changed hack to prevent scale error so its compatible with libwrapped funtions.

### 2021-12-21 - Beneos Tokens - Yeti

### 2021-11-21 - Beneos Tokens - Night hag

- Night hag is the first token with the "hit" animation. Will be fired when the token loses hp and does not die.


### 2021-11-18 - Beneos Tokens - Swarm of vampire bats

- Added scale factor to token config. Now we can set a token default scale to improve realism.
- Added a hack to prevent the Scale error when the animated textures are not fully loaded.


### 2021-11-01 - Beneos Tokens - Infernal Steed

- Added hit animations as a new variant.
- Added some new blood effects and new animations to some tokens. 


### 2021-10-26 - Beneos Tokens - Unchained Armor

- Overwritten the Token Magic _singleLoadFilters to prevent the FX gap and the double Fx application when changing animations
- Solved some compendium issues related to path files written in caps.
- Added some animations to several tokens. They aren't new, they are reused.
- Added new blood colors for some tokens.
- Fixed an error when rolling initiative with better rolls module enabled
- Correct and endless diying animations loop when autodamage is set in MIDI-QOL
- Added some extra checks to prevent errors when modules modify the data format
- Added a control to manage token speed across the map to improve the movement animations.

### 2021-10-18 - Beneos Tokens - Revenant Knight

- Added preload function to prevent Foundry VTT scale error when the animations where not fully loaded.
- Removed the fading effects as there's no gap with the preloading function.
- Added compatibility with Token Hud Wildcard Module without having to set the wildcard in the image file (Only valid for Beneos tokens).
- Added the possibility to non GM players to control Beneos Tokens with all the automatic animations.
- Removed ISO compatibility with the automatic animations as they will be no longer maintained.
- The token compendium access is now set in the config instead of having to search for it. Direct acces via Token HUD
- Added Token Variants. Dragon Variants set for dragon to test the feature
- Added compatibility with 'Better rolls' and 'Midi QOL'
