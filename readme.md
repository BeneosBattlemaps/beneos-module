s#Beneos Tokens Module

Programmed by Beorn based on the work of Beneos:

https://www.patreon.com/beneostokens/

Thanks to Tim Posney, SecretFire, Ruipin and Wasp for their modules that were an inspiration.
Thanks also to MattKDND and Madam Rouge Fox for helping me with the testing.
And of course thanks to Beneos and Leon for their work that allowed me to create this module.

## The module

This module allows you to benefit from the animated tokens created by Beneos and make it easier to use them in Foundry VTT.

Most things are done automatically. So when the token moves, dies or fires a special ability or an attack, if the token has a preconfigured animation, it will be played automatically without having to do anything.

Almost all the tokens have the following basic animations:

- Idle
- Combat Idle (when in combat)
- Move
- Die (when the token reaches to 0 HP)
- Dead (static image that replaces the die animations when it finishes)

Besides, those animations you will usually find animated attacks or special skills that will be fired automatically.

Some actions have special FX attached to them in order. This module uses Token Magic to be able to cast shadows, display a healing effect and many other things that will be improved with the new versions of the module.

You are not limited to use the tokens provided in the Beneos Token Compendium. When the module is installed you can access to any token hud and replace them with any of the Beneos animated token with just a couple of clicks.

You can also access to token journal entries from the Token Hud to know more about the tokens, see a new generic animations and be able to show it to the players.

Non Beneos tokens can be replaced with Beneos Tokens from the Token HUD. Just click on the HUD icon and the available tokens list will be shown. Once you select a token, the image will be replaced with the desired image and will have automatic animations like the ones in the module compendium. 

You are not limited to the default Beneos Tokens. Some tokens have variants that allow you to use the animations with monsters that have several appareancers like the dragons or the slimes. You can switch to a token variation (if there are available variants) from the Token HUD. You can also return to the default form clicking the "Default" option in the list. 

Finally, if you prefer the traditional round tokens, you can convert the tokens to animated ring tokens provided from Beneos setting them as default in the module configuration.

Note: As Iso animations will be reduced the module will not be compatible anymore with the automatic animations.

## The settings

The module can be customized from the foundry vtt settings:

- Use face rings instead of animations? [True / False (Default)]: 
  - This setting will allow you to use animated ring tokens instead of the full animations.
- Beneos Token View  [Top (Default) / Iso]:
  - Defines which perspective are you using. Many options will be disabled if you click on Iso view.
- Enable Automatic Animations [True (Default) / False]:
  - If enabled, all the custom animations will be used.
- Number of spaces walked per second [Default: 10]
  - Sets the speed of the token across the maps to make the walking animations more realistic. Lower numbers work better.

  
## Current Features List

- Automatic animations based on token status or actions:
    - Move. (If the movement is too small or done by keys the animation will not be played to prevent errors)
    - Idle.
    - Combat Idle.
    - Dying.
    - Dead.
    - Other custom actions depending on token.
- Possibility to add FX to different animations:
    - Each animation can have several effects attached in the configuration
- Scaling animations:
    - In order to be able to work with customized animations, each animation can be set with a scale factor that will keep the proportions between the different token animations.
    - If the token is scaled, the animations will be scaled proportionally.
- Beneos Token Transform
    - Non Beneos Tokens can be transformed to any of the Beneos Tokens from the token HUD
- Direct access from the Token Hud to the token journal without needing to add it to the Journals from the Compendium
- Possibility to work with circle animated tokens instead of full animations.
- Compatibility with The Forge, local hosting and online hosting.
- Compatibility with 'Better rolls', 'Midi QOL' and 'Token HUD Wildcard' modules.
- Token Variations: Some tokens will have the possibility to have animated variations that can be set from the token hud.
- The speed of the tokens across the maps can be set to improve token animations.


## List of Tokens with Variations

- Dragon

## Future features

- Attach custom sounds to the tokens so the animations can be complemented with sounds that will use the same rules that the normal foundry VTT Sounds.
- Clean the code as right now is a mess. Shame on me.

## Known issues

- Some times Foundry VTT will not load the animations files at time. It will produce an error in the console but everything will keep working. (Bug sent to foundry already)
- Randomly some animations will keep looping over an over. Probably this bug is related to the image cache and the animations length tha could have problems when the new animation is shorter than the first one. (bug sent to Foundry)


## Contact

If you find any issue please feel free to contact us through the Beneos discord. 

https://discord.com/invite/mVpv7Nt5qM



