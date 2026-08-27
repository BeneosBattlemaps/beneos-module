/********************************************************************************* */
import { BeneosTableTop } from "./beneos-table-top.js";
import { BeneosDatabaseHolder, BeneosModuleMenu } from "./beneos_search_engine.js";
import { BeneosCloud, BeneosCloudLogin, BeneosCloudSettings, BeneosCloudAccountMenu, BeneosOrphanCleanupMenu, BeneosManualZipImportMenu } from "./beneos_cloud.js";
// Asset existence probe, shared with the missing-asset watcher: srcExists plus
// a no-store HEAD that also rejects HTML fallback pages answering 200.
import { headCheck as beneosHeadCheck } from "./beneos-asset-watcher.js";

/********************************************************************************* */
globalThis.BENEOS_MODULE_NAME = "Beneos Module"
globalThis.BENEOS_MODULE_ID = "beneos-module"
globalThis.BENEOS_DEFAULT_TOKEN_PATH = "beneos_assets"

let beneosDebug = false
let beneosFadingSteps = 10
let beneosFadingWait = 30
let beneosFadingTime = beneosFadingSteps * beneosFadingWait
let __mask = 0xffffffff

/********************************************************************************* */
export class TableTopModeSettings extends FormApplication {

  constructor(object = {}, options) {
    super(object, options);
  }

  /** @override */
  static get defaultOptions() {
    return {
      ...super.defaultOptions,
      template: 'modules/beneos-module/templates/beneos-table-top-settings.html',
      height: 'auto',
      title: 'Table Top Mode Settings',
      width: 600,
      classes: ['beneos-module', 'settings'],
      tabs: [
        {
          contentSelector: 'form',
        },
      ],
      submitOnClose: false,
    };
  }

  static getDefaultTableTopSettings() {
    let config = {
      tableTopEnabled: false,
      performanceModePerUsers: [],
      controlPlayerView: true,
      autoScaleTVGrid: true,
      autoScaleTVWidthDiagonal: 90,
      autoScaleTVRatio: "16/9",
      gridOpacity: 0.5,
      miniatureSize: 25,
    }
    return config
  }

  getData() {
    let data = super.getData();
    data.config = game.settings.get(BeneosUtility.moduleID(), 'beneos-table-top-config') || this.getDefaultTableTopSettings();
    // Check if performanceModePerUsers is an array or not
    if (!Array.isArray(data.config.performanceModePerUsers)) {
      data.config.performanceModePerUsers = []
    }
    // Auto fill users
    for (let u of game.users) {
      if (!data.config.performanceModePerUsers.find(x => x.id == u.id)) {
        data.config.performanceModePerUsers.push({ id: u.id, name: u.name, perfMode: false })
      }
    }
    return data
  }

  async _updateObject(_, formData) {
    const data = foundry.utils.expandObject(formData)
    let config = game.settings.get(BeneosUtility.moduleID(), 'beneos-table-top-config')
    data.performanceModePerUsers = structuredClone(config.performanceModePerUsers) || []
    if (!Array.isArray(data.performanceModePerUsers)) {
      data.config.performanceModePerUsers = []
      for (let u of game.users) {
        if (!data.config.performanceModePerUsers.find(x => x.id == u.id)) {
          data.config.performanceModePerUsers.push({ id: u.id, name: u.name, perfMode: false })
        }
      }
    }
    //BeneosUtility.debugMessage("Updating object", data, config)
    for (let idx = 0; idx < data.performanceModePerUsersArray.length; idx++) {
      if (data.performanceModePerUsers[idx]) {
        data.performanceModePerUsers[idx].perfMode = data.performanceModePerUsersArray[idx] // Update with form flag value
      } else {
        console.warn("[Beneos] Error in updating user performance mode", idx, data)
      }
    }
    //BeneosUtility.debugMessage("Updating object",formData, data)
    await game.settings.set(BeneosUtility.moduleID(), 'beneos-table-top-config', data)

    // Manage the ON/OFF value
    await BeneosTableTop.manageTableTopMode(data.tableTopEnabled)

    window.location.reload() // Force reload after save
  }
}


/********************************************************************************* */
export class BeneosUtility {

  /********************************************************************************** */
  static forgeInit() {
    this.beneosBasePath = ""

    if (typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge) {
      this.debugMessage("[BENEOS MODULE] This process should only be run in Forge.")
      let ForgeVTTuserid = ForgeAPI.getUserId()
      ForgeVTTuserid.then(result => {
        this.beneosBasePath = ForgeVTT.ASSETS_LIBRARY_URL_PREFIX + result + "/"
      })
    }
  }

  /********************************************************************************** */
  static registerSettings() {

    // Common internal settings
    game.settings.register(BeneosUtility.moduleID(), 'beneos-user-config', {
      name: 'Internal data store for user-defined parameters',
      default: {},
      type: Object,
      scope: 'world',
      config: false
    })

    game.beneosTokens = {
      moduleId: BENEOS_MODULE_ID,
      BeneosUtility,
      BeneosCloud
    }

    game.settings.register(BeneosUtility.moduleID(), 'beneos-cloud-foundry-id', {
      name: 'Internal storage of the User ID with Beneos Cloud',
      default: "",
      type: String,
      scope: 'world',
      config: false,
      restricted: true
    })

    // Eine Zufallskennung fuer Welten OHNE Cloud-Anmeldung.
    //
    // WARUM SIE GEBRAUCHT WIRD. Die Telemetrie haengte bisher vollstaendig an
    // 'beneos-cloud-foundry-id', und die entsteht erst beim erfolgreichen
    // Login. Eine Welt, die das Modul startet und sich nie anmeldet, hat
    // deshalb kein einziges Ereignis erzeugt, nicht einmal world_open. Genau
    // dieser Fall ist der interessante: bei den stillen Patrons war nicht zu
    // unterscheiden zwischen "nie installiert", "installiert und nie
    // geoeffnet" und "geoeffnet und nie angemeldet". Drei verschiedene
    // Befunde, drei verschiedene Massnahmen, kein Weg sie zu trennen.
    //
    // WAS SIE NICHT IST. Kein Personenbezug, keine Ableitung aus Welt-, Nutzer-
    // oder Rechnerdaten, keine Adresse. Eine gewuerfelte Kette, die in dieser
    // Welt liegen bleibt, damit dieselbe Welt ueber Sitzungen hinweg als
    // dieselbe zaehlt und nicht jeden Abend als neue.
    //
    // DER SCHALTER GILT WEITER. 'beneos-analytics-enabled' entscheidet vorher;
    // ist er aus, wird auch anonym nichts gesendet.
    game.settings.register(BeneosUtility.moduleID(), 'beneos-analytics-anon-id', {
      name: 'Internal random id for unattributed telemetry',
      default: "",
      type: String,
      scope: 'world',
      config: false,
      restricted: true
    })

    // Last successfully-logged-in Cloud email, kept ONLY on this machine
    // (scope: 'client' -> browser localStorage, never synced to the world DB,
    // the server, or other players). Used to pre-fill the login form after an
    // accidental logout so the GM can't fat-finger the address into a typo'd
    // inbox or a forked ghost account. Stored base64-obfuscated (see
    // BeneosCloudLogin.rememberLoginEmail) so it isn't plainly readable in
    // localStorage; that's obfuscation, not encryption (an email shown back to
    // the user can't be truly secured client-side). config:false hides it from
    // the settings UI.
    game.settings.register(BeneosUtility.moduleID(), 'beneos-cloud-last-email', {
      name: 'Last Beneos Cloud login email (local prefill only)',
      default: "",
      type: String,
      scope: 'client',
      config: false
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-cloud-base-url', {
      name: 'Beneos Cloud base URL (advanced)',
      hint: 'Override the Beneos Cloud base URL for testing against a dev server. Leave empty for the production cloud (https://beneos.cloud).',
      default: "",
      type: String,
      scope: 'world',
      config: false,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), "beneos-cloud-patreon-status", {
      name: 'Patreon status of the user',
      default: "",
      type: String,
      scope: 'world',
      config: false,
      restricted: true
    })

    // Per-campaign Patreon membership flags. The Beneos Cloud runs two
    // independent Patreon campaigns (Tokens/Spells/Loot vs Battlemaps).
    // Persisted here so the patron-aware UI can decide between
    // installable / Join-Patreon CTA without waiting for a fresh login
    // poll after a Foundry restart.
    game.settings.register(BeneosUtility.moduleID(), "beneos-cloud-token-patron", {
      name: 'Token campaign Patreon membership',
      default: false,
      type: Boolean,
      scope: 'world',
      config: false,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), "beneos-cloud-battlemap-patron", {
      name: 'Battlemap campaign Patreon membership',
      default: false,
      type: Boolean,
      scope: 'world',
      config: false,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-reload-search-engine', {
      name: 'Internal storage of the User ID with Beneos Cloud',
      default: "",
      type: Boolean,
      scope: 'world',
      config: false,
      restricted: true,
      default: false
    })

    // Wave B-9: per-user list/grid view preference for the V2 cloud
    // window. Client-scoped because the choice is purely visual; each
    // GM can pick their own preferred density.
    game.settings.register(BeneosUtility.moduleID(), 'beneos-cloud-view-mode', {
      name: 'Beneos Cloud V2 view mode',
      scope: 'client',
      config: false,
      type: String,
      default: 'list'
    })

    // Plan §13: active resolution for battlemap installs. Persists across
    // sessions per-user. Single-variant releases ignore this — they install
    // their only available pack regardless. Default 4K (the higher-quality
    // master); the toolbar control flips it for the rest of the session.
    game.settings.register(BeneosUtility.moduleID(), 'battlemap-active-resolution', {
      name: 'Beneos battlemap active resolution',
      scope: 'client',
      config: false,
      type: String,
      default: '4K'
    })

    // Plan §13: view-mode toggle for the bmap tab — "releases" (one card per
    // release, default) or "individual" (one card per scene). Not persisted
    // across reloads; see plan decision §13.7 ("Persistence of view-mode: not
    // persisted"). Kept here for API parity but with scope=client + config=false
    // so the runtime can still read/write inside a session.
    game.settings.register(BeneosUtility.moduleID(), 'battlemap-bmap-view-mode', {
      name: 'Beneos battlemap view mode (session-only)',
      scope: 'client',
      config: false,
      type: String,
      default: 'releases'
    })

    // Plan §33.6: world-scoped record of installed battlemap releases.
    // Map<"<releaseDir>_<variant>", { sceneIds[], installedAt iso, assetId,
    // sourceSignature, sceneCount }>. Empty at world-start (no auto-scan; see
    // Plan §33.10 decision). The cloud window reads this to surface the green
    // installed-badge plus the gold update-available badge, and the pre-install
    // dialog uses it to detect re-install + variant-switch attempts.
    game.settings.register(BeneosUtility.moduleID(), 'battlemap-installs', {
      name: 'Beneos installed battlemap releases',
      scope: 'world',
      config: false,
      type: Object,
      default: {}
    })

    // Top-Down Stage 2: per-user default install style for tokens.
    // "tokenized" = classic 2.5D (-token.webp), "topdown" = top-down
    // skin (-top.webp). The Search-Window sidebar exposes a radio so
    // each GM can switch on the fly; persistent across sessions.
    game.settings.register(BeneosUtility.moduleID(), 'beneos-default-install-style', {
      name: 'Beneos default token install style',
      scope: 'client',
      config: false,
      type: String,
      default: 'tokenized'
    })

    // Configurable window for the "Newly added"-badge in the Search
    // Engine. Default 30 days; world-scoped so each table can tune it
    // (slow-release setups may want 60-90, fast iteration 7-14).
    game.settings.register(BeneosUtility.moduleID(), 'beneos-new-asset-window-days', {
      name: game.i18n.localize("BENEOS.Settings.NewAssetWindowDays.Name") || "New-asset highlight window (days)",
      hint: game.i18n.localize("BENEOS.Settings.NewAssetWindowDays.Hint") || "How many days an asset stays in the 'Newly added' filter after its last update. Default 30.",
      scope: 'world',
      config: true,
      type: Number,
      default: 30,
      range: { min: 1, max: 365, step: 1 }
    })

    // Stage 13d-11: global FX master-disable for performance-constrained
    // clients. The read-side (beneos-fx.mjs:121) already consults this
    // setting and short-circuits applyForToken when true. onChange triggers
    // immediate re-apply on every placed Beneos token so the toggle is
    // visible without a reload. Falls back to a no-op if game.beneos.fx
    // isn't ready yet (init ordering).
    game.settings.register(BeneosUtility.moduleID(), 'beneos-fx-master-disable', {
      name: game.i18n.localize("BENEOS.Settings.FxMasterDisable.Name") || "Disable FX (Performance)",
      hint: game.i18n.localize("BENEOS.Settings.FxMasterDisable.Hint") || "Hides all visual FX (drop shadows, glow effects) on Beneos creatures. Enable if you experience performance issues.",
      scope: 'world',
      config: true,
      type: Boolean,
      default: false,
      restricted: true,
      onChange: () => {
        if (!canvas?.ready) return
        const fx = game.beneos?.fx
        if (!fx?.applyForToken) return
        for (const t of canvas.tokens.placeables) {
          try {
            if (BeneosUtility.isBeneosCreature(t)) fx.applyForToken(t)
          } catch (e) { /* defensive */ }
        }
      }
    })

    // Server-time cursor for delta content fetches. Stored as Unix
    // seconds (from the server's clock, returned in the get_content
    // response). Empty/0 = first run, full catalog fetch; non-zero =
    // next fetch only asks for assets updated since this timestamp.
    // Client-scoped because each Foundry instance fetches independently.
    game.settings.register(BeneosUtility.moduleID(), 'beneos-cloud-last-content-fetch-server-time', {
      name: 'Beneos Cloud delta-fetch cursor (server time)',
      scope: 'client',
      config: false,
      type: Number,
      default: 0
    })

    // Stage 13a: hidden Creator-Mode toggle for the Beneos design team.
    // When enabled, prototypeToken-Scale-Änderungen on Beneos creatures
    // get auto-persisted into flags.world.beneos.rendering via the
    // preUpdateActor hook in beneos_module.js. End-User mode (default)
    // keeps Foundry-State edits out of the flag namespace, so cloud
    // re-installs reset the canvas state cleanly. config:false hides the
    // toggle from the Foundry settings dialog, since this is internal
    // team tooling and not something end-users should ever flip.
    //
    // Der Regelfall braucht diesen Schalter gar nicht mehr: sobald die
    // Beneos Development Tools in der Welt aktiv sind, gilt Creator-Mode
    // automatisch (siehe isBeneosCreatorMode). Der gespeicherte Wert
    // bleibt als manueller Weg fuer Welten ohne beneos-dev erhalten.
    // Aktivierung: game.settings.set("beneos-module", "beneos-creator-mode", true)
    game.settings.register(BeneosUtility.moduleID(), 'beneos-creator-mode', {
      name: 'Beneos Creator Mode (internal)',
      scope: 'client',
      config: false,
      type: Boolean,
      default: false
    })

    // Wave B-9-fix-68: single state-aware menu. The button class
    // BeneosCloudAccountMenu inspects game.beneos.cloud.isLoggedIn()
    // at click time and dispatches to the login dialog OR the
    // disconnect handler. Previously we registered one of two menus
    // conditionally on the stored foundryId at init — that worked on
    // first load but stayed stale after a runtime login/logout
    // (Foundry doesn't re-evaluate menu definitions without a reload).
    game.settings.registerMenu(BeneosUtility.moduleID(), "beneos-cloud-account", {
      name: "BENEOS.Settings.CloudAccount.Name",
      label: "BENEOS.Settings.CloudAccount.Label",
      hint: "BENEOS.Settings.CloudAccount.Hint",
      scope: 'world',
      config: true,
      type: BeneosCloudAccountMenu,
      restricted: true
    })

    // Orphan-Cleanup maintenance entry. Opens a one-shot dialog that
    // scans the Beneos compendiums and lets the GM delete entries that
    // have lost their folder, lost their local asset files, or have no
    // matching world actor. See BeneosCloud.runOrphanCleanup.
    game.settings.registerMenu(BeneosUtility.moduleID(), "beneos-orphan-cleanup", {
      name: "BENEOS.Settings.OrphanCleanup.Name",
      label: "BENEOS.Settings.OrphanCleanup.Label",
      hint: "BENEOS.Settings.OrphanCleanup.Hint",
      scope: 'world',
      config: true,
      type: BeneosOrphanCleanupMenu,
      restricted: true
    })

    // Manual ZIP import (bottom of the Beneos settings): pick a local release
    // ZIP and install it 1:1 like a cloud install. Makes Beneos independent of
    // the scene-packer importer wizard.
    game.settings.registerMenu(BeneosUtility.moduleID(), "beneos-manual-zip-import", {
      name: "BENEOS.Settings.ManualZipImport.Name",
      label: "BENEOS.Settings.ManualZipImport.Label",
      hint: "BENEOS.Settings.ManualZipImport.Hint",
      scope: 'world',
      config: true,
      type: BeneosManualZipImportMenu,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), "beneos-datapath", {
      name: "Storage path of tokens assets",
      hint: "Location of tokens and associated datas",
      scope: 'world',
      config: false,
      default: BENEOS_DEFAULT_TOKEN_PATH,
      type: String,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), "beneos-death-management", {
      name: "BENEOS.Settings.DeathManagement.Name",
      hint: "BENEOS.Settings.DeathManagement.Hint",
      scope: 'world',
      config: true,
      default: true,
      type: Boolean,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), "beneos-god-mode", {
      name: "Enable God Mode",
      hint: "",
      scope: 'world',
      config: false,
      default: false,
      type: Boolean,
      restricted: true
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-database-local-storage', {
      name: 'Internal storage of the Beneos database',
      type: Object,
      scope: 'world',
      default: {},
      config: false
    })


    // Per-user read-state for Home-tab news cards. Stores the array of
    // news ids the user has opened so the "unread" highlight clears.
    game.settings.register(BeneosUtility.moduleID(), 'beneos-cloud-news-read-ids', {
      name: 'Beneos Cloud news read state',
      type: Array,
      scope: 'client',
      default: [],
      config: false
    })

    // World-start "What's new" popup. Client scope so one GM can switch it off
    // without deciding for everyone else. The "seen" cursor itself is NOT stored
    // here: it lives on the cloud account, so a purchase is celebrated once
    // across all worlds and machines instead of once per world.
    game.settings.register(BeneosUtility.moduleID(), 'beneos-whatsnew-enabled', {
      name: 'BENEOS.Settings.WhatsNewEnabled.Name',
      hint: 'BENEOS.Settings.WhatsNewEnabled.Hint',
      type: Boolean,
      scope: 'client',
      default: true,
      config: true
    })

    // Seen-marker for worlds with no cloud account. Signed-in worlds keep their
    // cursor on the account so a purchase is celebrated once everywhere; a world
    // without an account has nothing to hang that on, so the marker lives here.
    // Client scope for the same reason the toggle above is: it belongs to the
    // person looking at the screen, not to the world.
    game.settings.register(BeneosUtility.moduleID(), 'beneos-whatsnew-anon-seen-at', {
      name: 'Beneos what is new marker (no account)',
      type: Number,
      scope: 'client',
      default: 0,
      config: false
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', {
      name: 'Global JSON config for tokens',
      type: String,
      scope: 'world',
      default: "",
      config: false
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-json-itemconfig', {
      name: 'Global JSON config for items',
      type: String,
      scope: 'world',
      default: "",
      config: false
    })
    game.settings.register(BeneosUtility.moduleID(), 'beneos-json-spellconfig', {
      name: 'Global JSON config for spells',
      type: String,
      scope: 'world',
      default: "",
      config: false
    })


    /*game.settings.register('beneos-cloud', 'access_token', {
      name: 'Beneos Cloud Access Token',
      hint: 'Access token for Beneos Cloud (ie Patreon access key)',
      scope: 'world',
      config: true,
      type: String,
      restricted: true,
      default: ''
    })*/
    game.settings.register(BeneosUtility.moduleID(), 'beneos-user-config', {
      name: 'Internal data store for user-defined parameters',
      default: {},
      type: Object,
      scope: 'world',
      config: false
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-ui-state', {
      name: 'Internal data store for user-defined parameters',
      default: {},
      type: Boolean,
      scope: 'world',
      config: false,
      default: true
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-bmap-notice-dismissed', {
      name: 'Battlemap import notice dismissed',
      type: Boolean,
      scope: 'world',
      default: false,
      config: false
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-performance-mode', {
      name: 'BENEOS.Settings.PerfMode.Name',
      hint: 'BENEOS.Settings.PerfMode.Hint',
      scope: 'client',
      config: true,
      type: Boolean,
      default: false,
      onChange: (val) => document.body.classList.toggle('beneos-perf-mode', !!val)
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-loot-set-bonuses', {
      name: 'BENEOS.Settings.LootSetBonuses.Name',
      hint: 'BENEOS.Settings.LootSetBonuses.Hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
      onChange: () => {
        // Re-render all open actor sheets so the Beneos tab appears
        // or disappears depending on the new state.
        const map = foundry?.applications?.instances;
        const visit = (app) => {
          if (app?.actor && app?.rendered) {
            try { app.render(false); } catch (_) {}
          }
        };
        if (map?.forEach) map.forEach(visit);
        for (const a of Object.values(ui.windows ?? {})) visit(a);
      }
    })

    game.settings.register(BeneosUtility.moduleID(), 'beneos-sense-demo', {
      name: 'BENEOS.Sense.DemoSetting.Name',
      hint: 'BENEOS.Sense.DemoSetting.Hint',
      scope: 'client',
      config: true,
      type: Boolean,
      default: false,
      onChange: () => {
        for (const app of Object.values(ui.windows ?? {})) {
          if (app?.rendered) try { app.render(false); } catch (_) {}
        }
      }
    })

    /* Live Game Control: world-scoped list of active Origin pings. The GM
       Sense-Radar tab writes here; player char sheets read via
       sense-compass-data._resolveSenses. */
    game.settings.register(BeneosUtility.moduleID(), 'beneos-lgc-active-pings', {
      name: 'Beneos LGC Active Pings (internal)',
      scope: 'world',
      config: false,
      type: Array,
      default: []
    })

    /* Analytics opt-out. Anonymous, GM-only usage telemetry that helps us
       find broken assets and unreported problems. Default ON; a one-time
       info banner explains it on first cloud-window open. */
    game.settings.register(BeneosUtility.moduleID(), 'beneos-analytics-enabled', {
      name: game.i18n.localize("BENEOS.Settings.Analytics.Name") || "Share anonymous usage data",
      hint: game.i18n.localize("BENEOS.Settings.Analytics.Hint") || "Sends anonymous, GM-only telemetry (no player data, no names) so Beneos can detect broken content and improve releases. You can turn this off at any time.",
      scope: 'world',
      config: true,
      restricted: true,
      type: Boolean,
      default: true
    })

    /* Internal cache: detected hosting environment (self/forge/molten/aws). */
    game.settings.register(BeneosUtility.moduleID(), 'beneos-analytics-hosting-type', {
      name: 'Beneos analytics hosting type (internal)',
      scope: 'world',
      config: false,
      restricted: true,
      type: String,
      default: ''
    })

    /* Internal: whether the one-time analytics info banner has been shown. */
    game.settings.register(BeneosUtility.moduleID(), 'beneos-analytics-banner-shown', {
      name: 'Beneos analytics banner shown (internal)',
      scope: 'world',
      config: false,
      restricted: true,
      type: Boolean,
      default: false
    })

    /*game.settings.register(BeneosUtility.moduleID(), 'beneos-table-top-config', {
      name: 'Internal data store for table top mode settings',
      default: TableTopModeSettings.getDefaultTableTopSettings(),
      type: Object,
      scope: 'world',
      config: false
    })

    const menuTableTopModeSettings = {
      key: 'tableTopModeSettings',
      config: {
        name: 'Configure Table Top mode',
        label: 'Table Top Mode',
        hint: 'Configure the Table Top mode features',
        type: TableTopModeSettings,
        restricted: true,
      },
    };

    const settingAutoTemplateSettings = {
      key: 'tableTopModeSettings',
      config: {
        name: 'Table Top mode settings',
        hint: 'Configure the Table Top mode settings',
        scope: 'world',
        config: false,
        default: {},
        type: Object,
      },
    };

    game.settings.registerMenu(BeneosUtility.moduleID(), menuTableTopModeSettings.key, menuTableTopModeSettings.config);
      game.settings.register(
        BeneosUtility.moduleID(),
        settingAutoTemplateSettings.key,
        foundry.utils.mergeObject(
          settingAutoTemplateSettings.config,
          {
            requiresReload: true
          },
          true,
          true
        )
      );*/
  }

  static openPostInNewTab(url, params) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = '_blank';

    for (const key in params) {
      if (params.hasOwnProperty(key)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = params[key];
        form.appendChild(input);
      }
    }
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }


  /********************************************************************************** */
  static getLocalStorage() {
    let localStorage = game.settings.get(BeneosUtility.moduleID(), 'beneos-database-local-storage') || {}
    return localStorage
  }

  /********************************************************************************** */
  static saveLocalStorage(data) {
    let localStorage = game.settings.get(BeneosUtility.moduleID(), 'beneos-database-local-storage') || {}
    localStorage = foundry.utils.mergeObject(localStorage, data)
    game.settings.set(BeneosUtility.moduleID(), 'beneos-database-local-storage', localStorage)
  }

  /********************************************************************************** */
  static getTableTopConfig() {
    return game.settings.get(BeneosUtility.moduleID(), 'beneos-table-top-config') || TableTopModeSettings.getDefaultTableTopSettings()
  }

  /********************************************************************************** */
  static setupSocket() {
    game.socket.on(`module.beneos-module`, (msg) => {
      //BeneosUtility.debugMessage('pl',payload)
      if (msg.name == 'msg_set_view_position') { BeneosTableTop.applyPosition(msg.data) }
      if (msg.name == 'msg_toggle_ui_elements') { BeneosTableTop.applyUIElements(msg.data) }
      if (msg.name == 'msg_request_user_view') { BeneosTableTop.sendUserViewMessage() }
      if (msg.name == 'msg_user_view_response') { BeneosTableTop.processUserCurrentView(msg.data) }
    });
  }

  /********************************************************************************** */
  static reloadInternalSettings() {
    // These are the legacy local stores of installed token/spell/item JSON
    // (world settings), separate from the public cloud catalog. On a fresh
    // world they are empty/unset, so parse them tolerantly: empty -> {} with no
    // noise; only a non-empty-but-broken value is a real error worth warning.
    const loadJsonSetting = (key, label) => {
      const raw = game.settings.get(BeneosUtility.moduleID(), key)
      if (raw === undefined || raw === null || String(raw).trim() === "") return {}
      try {
        return JSON.parse(raw)
      } catch {
        console.warn(`[Beneos] ${label} JSON loading error`)
        return {}
      }
    }
    this.beneosTokens = loadJsonSetting('beneos-json-tokenconfig', 'Token')
    this.beneosSpells = loadJsonSetting('beneos-json-spellconfig', 'Spell')
    this.beneosItems  = loadJsonSetting('beneos-json-itemconfig', 'Item')
  }

  /********************************************************************************** */
  static getActorPack() {
    return game.packs.get("world.beneos_module_actors")
  }
  static getJournalPack() {
    return game.packs.get("world.beneos_module_journal")
  }
  static getItemPack() {
    return game.packs.get("world.beneos_module_items")
  }
  static getSpellPack() {
    return game.packs.get("world.beneos_module_spells")
  }
  static async lockUnlockAllPacks(flag = false) {
    let actorPack = this.getActorPack()
    let journalPack = this.getJournalPack()
    let itemPack = this.getItemPack()
    let spellPack = this.getSpellPack()
    if (actorPack) await actorPack.configure({ locked: flag })
    if (journalPack) await journalPack.configure({ locked: flag })
    if (itemPack) await itemPack.configure({ locked: flag })
    if (spellPack) await spellPack.configure({ locked: flag })
  }



  /********************************************************************************** */
  static async verifySettingsAgainstCompendium() {
    let toSave = false
    let actorDelete = []
    let itemDelete = []
    let spellDelete = []
    let actorPack = BeneosUtility.getActorPack()
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token?.actorId && !actorPack.index.some(i => i._id == token.actorId)) {
        BeneosUtility.debugMessage("Beneos Compendium actor not found for token", fullKey, token.actorId)
        delete this.beneosTokens[fullKey]
        toSave = true
      } else {
        // Check if the image/token are still present in the filesystem
        // Get the actor from the compendium
        let actor = actorPack.index.find(i => i._id == token.actorId)
        if (actor) {
          let ret = await foundry.utils.srcExists(actor.img)
          if (ret && actor.prototypeToken?.texture?.src) {
            ret = await foundry.utils.srcExists(actor.prototypeToken.texture.src)
          }
          if (!ret) {
            BeneosUtility.debugMessage("Beneos Compendium actor image not found for token", fullKey, actor.prototypeToken?.texture?.src)
            actorDelete.push(actor._id)
            delete this.beneosTokens[fullKey]
            toSave = true
          }
        }
      }
    }

    let itemPack = game.packs.get("world.beneos_module_items")
    for (let [fullKey, item] of Object.entries(this.beneosItems)) {
      if (item.itemId && !itemPack.index.some(i => i._id == item.itemId)) {
        BeneosUtility.debugMessage("Beneos Compendium item not found for item", fullKey, item.itemId)
        delete this.beneosItems[fullKey]
        toSave = true
      } else {
        let itemC = itemPack.index.find(i => i._id == item.itemId)
        if (itemC) {
          let ret = await foundry.utils.srcExists(itemC.img)
          if (!ret) {
            BeneosUtility.debugMessage("Beneos Compendium item image not found for item", fullKey, itemC.img)
            itemDelete.push(itemC._id)
            delete this.beneosItems[fullKey]
            toSave = true
          }
        }
      }
    }

    let spellPack = game.packs.get("world.beneos_module_spells")
    for (let [fullKey, spell] of Object.entries(this.beneosSpells)) {
      if (spell.spellId && !spellPack.index.some(i => i._id == spell.spellId)) {
        BeneosUtility.debugMessage("Beneos Compendium spell not found for spell", fullKey, spell.spellId)
        delete this.beneosSpells[fullKey]
        toSave = true
      } else {
        let spellC = spellPack.index.find(i => i._id == spell.spellId)
        if (spellC) {
          let ret = await foundry.utils.srcExists(spellC.img)
          if (!ret) {
            BeneosUtility.debugMessage("Beneos Compendium item image not found for item", fullKey, spellC.img)
            spellDelete.push(spellC._id)
            delete this.beneosSpells[fullKey]
            toSave = true
          }
        }
      }
    }

    if (game.user.isGM && toSave) {
      let packName = "world.beneos_module_actors"
      await BeneosUtility.lockUnlockAllPacks(false) // Unlock the packs before deleting
      for (let id of actorDelete) {
        await Actor.deleteDocuments([id], { pack: packName })
      }
      for (let id of itemDelete) {
        await Item.deleteDocuments([id], { pack: "world.beneos_module_items" })
      }
      for (let id of spellDelete) {
        await Item.deleteDocuments([id], { pack: "world.beneos_module_spells" })
      }
      await BeneosUtility.lockUnlockAllPacks(true) // Lock the packs after deleting

      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', JSON.stringify(this.beneosTokens))
      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', JSON.stringify(this.beneosItems))
      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-spellconfig', JSON.stringify(this.beneosSpells))
      // Post chat message to inform the user that the world will reload
      ChatMessage.create({
        content: `<div class="beneos-module"><p>Some Beneos files have been deleted or are corrupted. Affected assets must be downloaded again. Please refresh Foundry VTT with (F5 on Windows) to complete this.</p></div>`,
      });
    }
  }

  /********************************************************************************** */
  static async createCompendiums() {
    // Create the "Beneos Spells" folder if it doesn't exist
    const packFolder = game.folders.getName("Beneos Data") || await Folder.create({
      name: "Beneos Data", type: "Compendium"
    })

    // Create compendiums
    if (!game.packs.get("world.beneos_module_actors")) {
      let pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ "label": "Beneos Tokens", "name": "beneos_module_actors", "type": "Actor" });
      await pack.setFolder(packFolder.id);
    }
    if (!game.packs.get("world.beneos_module_journal")) {
      let pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ "label": "Beneos Journals", "name": "beneos_module_journal", "type": "JournalEntry" });
      await pack.setFolder(packFolder.id);
    }
    if (game.system.id == "dnd5e") {
      if (!game.packs.get("world.beneos_module_items")) {
        let pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ "label": "Beneos Items", "name": "beneos_module_items", "type": "Item" });
        await pack.setFolder(packFolder.id);
      }
      if (!game.packs.get("world.beneos_module_spells")) {
        let pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ "label": "Beneos Spells", "name": "beneos_module_spells", "type": "Item" });
        await pack.setFolder(packFolder.id);
      }
    }
    await this.verifySettingsAgainstCompendium()
  }

  /********************************************************************************** */
  static ready() {
    this.file_cache = {}
    this.titleCache = {}

    this.sheetLoaded = false

    this.beneosModule = true // Deprecated game.settings.get(BeneosUtility.moduleID(), 'beneos-animations')
    this.beneosHealth = {}
    this.standingImage = {}
    this.beneosPreload = []
    this.beneosTokens = {}
    this.beneosSpells = {}
    this.beneosItems = {}
    if (game.user.isGM) {
      this.tokenDataPath = game.settings.get(BeneosUtility.moduleID(), 'beneos-datapath')
      this.itemDataPath = game.settings.get(BeneosUtility.moduleID(), 'beneos-datapath')
      this.spellDataPath = game.settings.get(BeneosUtility.moduleID(), 'beneos-datapath')
      this.tokenDataPath += "/beneos_tokens/"
      this.itemDataPath += "/beneos_items/"
      this.spellDataPath += "/beneos_spells/"
    }

    this.reloadInternalSettings()
    // Check if folder exists
    if (game.user.isGM) {
      this.createCompendiums()
    }

    BeneosUtility.debugMessage("Loaded", this.beneosTokens)

    this.m_w = 123456789
    this.m_z = 987654321
    this.seed(Date.now())

    Handlebars.registerHelper('isEmpty', function (text) {
      if (typeof text !== 'string' && typeof text !== 'object') return false
      return text.length === 0
    })
    Handlebars.registerHelper('beneosAdd', function (a, b) {
      return parseInt(a) + parseInt(b);
    });

    Handlebars.registerHelper('beneosLength', function (text) {
      if (typeof text !== 'string' && typeof text !== 'object') return 0
      return text.length
    })
    Handlebars.registerHelper('beneosUpperFirst', function (text) {
      if (typeof text !== 'string') return text
      return text.charAt(0).toUpperCase() + text.slice(1)
    })
    Handlebars.registerHelper('getTagDescription', function (text) {
      return BeneosDatabaseHolder.getTagDescription(text)
    })
    Handlebars.registerHelper('beneosLowerCase', function (text) {
      if (typeof text !== 'string') return text
      return text.toLowerCase()
    })
    Handlebars.registerHelper('beneosGetHover', function (category, term) {
      return BeneosDatabaseHolder.getHover(category, term)
    })
    Handlebars.registerHelper('beneosChoose', function (text1, text2) {
      if (text1 && text1 != "") {
        return text1
      }
      return text2
    })
    Handlebars.registerHelper('beneosSubstr', function (text, len) {
      if (typeof text !== 'string') return text
      if (text.length <= len + 1) return text
      return text.substring(0, len) + "."
    })

    // Note: the TokenMagic._singleLoadFilters hijack (preventing double
    // filters on Beneos tokens) is installed once in beneos_module.js's
    // ready hook.

    // HIER STAND EIN FREMDER ZAEHLDIENST, UND ER IST AM 2026-08-24 ENTFERNT
    // WORDEN.
    //
    // `ClassCounter.registerUsageCount` schickte bei jeder
    // Spielleitersitzung eine dauerhafte Weltkennung, die Adresse der
    // Kundeninstanz (`game.data.addresses.remote`), die Sprache und neun
    // Bestandszahlen per POST an `uberwald.me/fvtt_appcount`.
    //
    // Zwei Gruende, keiner davon Geschmack:
    //
    // 1. Der Aufruf fragte `beneos-analytics-enabled` NICHT ab. Wer die
    //    Statistik im Modul abschaltete, sendete trotzdem, und zwar an einen
    //    Dritten. Ein Schalter, an dem etwas vorbeilaeuft, ist kein Schalter.
    // 2. Der Dienst stammt aus der Zeit vor der Beneos-Cloud. Alles, was er
    //    lieferte, liefert die eigene Erhebung inzwischen genauer und ohne
    //    Adresse: `world_open`, `hosting_environment`, `module_inventory`.
    //
    // Mit ihm faellt `countBeneosAssetsUsage()`, das nur ihn bedient hat.

  }

  /********************************************************************************** */
  static getSceneBackgroundSrc(scene) {
    if (scene.firstLevel) return scene.firstLevel.background?.src;
    return scene.background?.src;
  }

  /********************************************************************************** */
  static async updateSceneBackgroundSrc(scene, srcPath) {
    if (scene.firstLevel) {
      await scene.firstLevel.update({"background.src": srcPath});
    } else {
      await scene.update({'background.src': srcPath});
    }
  }


  /********************************************************************************** */
  // Beneos assets are authored against dnd5e. The compatibility model has two
  // tiers on non-dnd5e systems:
  //
  //   - Soft-warn kinds (tokens / maps): content will likely render, but with
  //     visual or mechanical glitches. The GM is asked once per session
  //     whether to continue, with an opt-out for the rest of the session.
  //
  //   - Hard-block kinds (items / spells): in testing on Pathfinder these
  //     hang the install pipeline mid-write. We don't even attempt the
  //     install; we show an info-only dialog explaining that Loot and Spells
  //     are dnd5e-only and that Maps + Creatures remain compatible.
  //
  // The soft-warn bypass is a runtime field, so it resets on world reload —
  // matching the natural notion of a "play session". A persistent setting
  // was explicitly avoided so users can't accidentally silence warnings
  // about a system mismatch they later forget about.
  static _systemCompatBypass = false;
  static _SOFT_KINDS = new Set(["token", "actor", "map", "bmap"]);
  static _HARD_KINDS = new Set(["item", "spell"]);

  static _normalizeKind(kind) {
    if (!kind) return null;
    if (kind === "actor") return "token";
    if (kind === "bmap")  return "map";
    return kind;
  }

  /**
   * Cached system-id check. Read once on first access (typically during
   * the V2 cloud window's first render) and reused for every result-card
   * enrich pass. Avoids the per-card property dereference the user
   * explicitly flagged as unnecessary overhead.
   */
  static get isDnd5e() {
    return BeneosUtility._isDnd5eCache ??= (game.system?.id === "dnd5e");
  }

  /**
   * True when `kind` cannot be installed in the active world. Used by the
   * V2 cloud window to render Loot/Spell cards in a "Not compatible"
   * state on non-dnd5e systems instead of an Install button. Click on
   * such a card still routes through #onInstallClick → confirmSystemCompat
   * which surfaces the incompatible-asset info dialog.
   */
  static isHardBlockedKind(kind) {
    if (BeneosUtility.isDnd5e) return false;
    return BeneosUtility._HARD_KINDS.has(BeneosUtility._normalizeKind(kind));
  }

  /**
   * Returns true if the install pipeline may continue, false if the GM
   * cancelled or the kind is hard-blocked on this system.
   *
   * @param {?string} kind  "token" | "item" | "spell" | "map" | null
   *                        When null, only the soft-warn path is evaluated
   *                        (used by callers that don't know the asset kind).
   */
  static async confirmSystemCompat(kind = null) {
    if (game.system?.id === "dnd5e") return true;

    const k = BeneosUtility._normalizeKind(kind);

    // Hard-block path: items/spells on any non-dnd5e system. Info-only
    // dialog, no Yes/No, no opt-out — this kind isn't going to install.
    if (k && BeneosUtility._HARD_KINDS.has(k)) {
      await BeneosUtility._showIncompatibleDialog(k);
      return false;
    }

    // Soft-warn path: tokens / maps / unknown.
    if (BeneosUtility._systemCompatBypass) return true;

    const systemLabel = game.system?.title || game.system?.id || "this game system";
    const title = game.i18n.localize("BENEOS.SystemCheck.Title");
    const body = game.i18n.format("BENEOS.SystemCheck.Body", { system: systemLabel });
    const yesLabel = game.i18n.localize("BENEOS.SystemCheck.Yes");
    const noLabel = game.i18n.localize("BENEOS.SystemCheck.No");
    const dontShowLabel = game.i18n.localize("BENEOS.SystemCheck.DontShowSession");

    const content = `
      <section class="beneos-system-check">
        <p>${body}</p>
        <label class="beneos-dont-show">
          <input type="checkbox" name="beneos-system-dont-show-session"> ${dontShowLabel}
        </label>
      </section>`;

    const readCheckbox = (root) => {
      try { return !!root?.querySelector?.('input[name="beneos-system-dont-show-session"]')?.checked; }
      catch (e) { return false; }
    };

    let result = null;
    try {
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (DialogV2?.wait) {
        result = await DialogV2.wait({
          window: { title },
          classes: ["beneos-system-check-dialog"],
          position: { width: 520 },
          content,
          buttons: [
            { action: "yes", label: yesLabel, default: true,
              callback: (e, btn, dlg) => ({ answer: true, dontShow: readCheckbox(dlg?.element) }) },
            { action: "no", label: noLabel,
              callback: (e, btn, dlg) => ({ answer: false, dontShow: readCheckbox(dlg?.element) }) }
          ],
          rejectClose: false,
          modal: true,
          close: () => null
        });
      }
    } catch (e) {
      console.warn("[Beneos] System compat dialog failed, falling back to safe-default cancel:", e);
      return false;
    }

    if (!result || typeof result.answer !== "boolean") return false;
    if (result.dontShow && result.answer) BeneosUtility._systemCompatBypass = true;
    return result.answer;
  }

  /**
   * Info-only dialog shown when a hard-blocked asset kind (item/spell) is
   * about to be installed on a non-dnd5e system. No Yes/No — the install
   * is always cancelled.
   */
  static async _showIncompatibleDialog(kind) {
    const systemLabel = game.system?.title || game.system?.id || "this game system";
    const title = game.i18n.localize("BENEOS.SystemCheck.IncompatibleTitle");
    const bodyKey = kind === "spell"
      ? "BENEOS.SystemCheck.IncompatibleBodySpell"
      : "BENEOS.SystemCheck.IncompatibleBodyItem";
    const body = game.i18n.format(bodyKey, { system: systemLabel });
    const closeLabel = game.i18n.localize("BENEOS.SystemCheck.IncompatibleClose");

    const content = `
      <section class="beneos-system-check beneos-system-check-blocked">
        <p>${body}</p>
      </section>`;

    try {
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (DialogV2?.wait) {
        await DialogV2.wait({
          window: { title },
          classes: ["beneos-system-check-dialog", "beneos-system-check-blocked"],
          position: { width: 520 },
          content,
          buttons: [
            { action: "close", label: closeLabel, default: true, callback: () => null }
          ],
          rejectClose: false,
          modal: true,
          close: () => null
        });
      }
    } catch (e) {
      console.warn("[Beneos] Incompatible-asset dialog failed:", e);
    }
  }

  /********************************************************************************** */
  // Returns true if the actor is a Warlock per the dnd5e 5.x spellcasting model.
  // `actor.spellcastingClasses` is the canonical getter; we additionally check
  // for an itemTypes.class entry with identifier "warlock" as a fallback for
  // older characters where the getter may not have been populated yet.
  static isWarlockActor(actor) {
    if (!actor || game.system?.id !== "dnd5e") return false;
    if (actor.spellcastingClasses?.warlock) return true;
    try {
      const cls = actor.itemTypes?.class?.find?.(c =>
        (c.identifier || c.system?.identifier || c.name?.toLowerCase()) === "warlock"
      );
      if (cls) return true;
    } catch (e) {}
    return false;
  }

  /**
   * Per-batch cache for the Pact-Magic prompt. Keyed by `${actorId}:${batchToken}`.
   * Populated when the user ticks "Apply to all remaining spells in this drop"
   * during the first prompt of a batch; subsequent spells in the same batch
   * reuse the cached choice instead of prompting again.
   */
  static _pactMagicBatchCache = new Map();

  /**
   * Decide whether a leveled spell about to be added to a Warlock should be
   * marked as Pact-Magic. Returns "pact" or "normal". Caller is responsible
   * for the actual JSON mutation (so this helper stays pure).
   *
   * @param {object}  opts
   * @param {Item}    opts.spellItem    The world-item / compendium document being copied to the actor.
   * @param {Actor}   opts.actor        The Warlock actor receiving the spell.
   * @param {string}  opts.batchToken   Stable token shared across all spells dropped in the same event; "" for single drops.
   */
  static async askPactMagicChoice({ spellItem, actor, batchToken }) {
    const cacheKey = batchToken ? `${actor.id}:${batchToken}` : null;
    if (cacheKey && BeneosUtility._pactMagicBatchCache.has(cacheKey)) {
      return BeneosUtility._pactMagicBatchCache.get(cacheKey);
    }

    const spellName = spellItem?.name ?? game.i18n.localize("BENEOS.PactMagic.UnknownSpell");
    const actorName = actor?.name ?? "";
    const title = game.i18n.localize("BENEOS.PactMagic.Title");
    const body = game.i18n.format("BENEOS.PactMagic.Body", { spell: spellName, actor: actorName });
    const yesLabel = game.i18n.localize("BENEOS.PactMagic.Yes");
    const noLabel = game.i18n.localize("BENEOS.PactMagic.No");
    const applyAllLabel = game.i18n.localize("BENEOS.PactMagic.ApplyToAll");

    const showApplyAll = !!batchToken;
    const content = `
      <section class="beneos-pact-magic">
        <p>${body}</p>
        ${showApplyAll ? `
          <label class="beneos-dont-show">
            <input type="checkbox" name="beneos-pact-apply-all"> ${applyAllLabel}
          </label>` : ""}
      </section>`;

    const readApplyAll = (root) => {
      try { return !!root?.querySelector?.('input[name="beneos-pact-apply-all"]')?.checked; }
      catch (e) { return false; }
    };

    let result = null;
    try {
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (DialogV2?.wait) {
        result = await DialogV2.wait({
          window: { title },
          classes: ["beneos-pact-magic-dialog"],
          position: { width: 520 },
          content,
          buttons: [
            { action: "yes", label: yesLabel, default: true,
              callback: (e, btn, dlg) => ({ choice: "pact", applyAll: readApplyAll(dlg?.element) }) },
            { action: "no", label: noLabel,
              callback: (e, btn, dlg) => ({ choice: "normal", applyAll: readApplyAll(dlg?.element) }) }
          ],
          rejectClose: false,
          modal: true,
          // ESC / X = treat as "normal" (no slot mismatch, just imports as-is).
          // The user explicitly only asked for Yes/No; we don't add a third
          // cancel path that would silently abort spell import.
          close: () => ({ choice: "normal", applyAll: false })
        });
      }
    } catch (e) {
      console.warn("[Beneos] Pact-Magic dialog failed, defaulting to normal slot:", e);
      return "normal";
    }

    const choice = result?.choice === "pact" ? "pact" : "normal";
    if (cacheKey && result?.applyAll) {
      BeneosUtility._pactMagicBatchCache.set(cacheKey, choice);
    }
    return choice;
  }

  /** Drop the per-batch Pact cache after the batch has fully drained. */
  static clearPactMagicBatchCache(actorId, batchToken) {
    if (!actorId || !batchToken) return;
    BeneosUtility._pactMagicBatchCache.delete(`${actorId}:${batchToken}`);
  }

  /**
   * Mutate a spell item's data object to be cast via Pact Magic. dnd5e 5.x
   * uses `system.method`; older versions used `system.preparation.mode`. We
   * write both so Beneos installs work across the supported version range.
   */
  static applyPactMagicToSpellData(itemData) {
    if (!itemData || itemData.type !== "spell") return itemData;
    if (!itemData.system) itemData.system = {};
    itemData.system.method = "pact";
    if (!itemData.system.preparation) itemData.system.preparation = {};
    itemData.system.preparation.mode = "pact";
    return itemData;
  }

  /********************************************************************************** */
  static getItemSpellImageInfo(newImage) {
    // beneos_assets/beneos_spells/0027_gunpowder_cloud/0027_gunpowder_cloud-icon.webp
    let dataPath = {
      itemKey: newImage
    }
    let apath = newImage.split("/")
    let itemKey = apath[apath.length - 2]
    let filename = apath[apath.length - 1]
    if (itemKey) {
      dataPath = { img: newImage, filename, itemKey }
    }
    return dataPath
  }

  /********************************************************************************** */
  /* Static / animated battlemap switching                                             */
  /*                                                                                   */
  /* Beneos ships every battlemap and scenery video as <name>.webm plus a matching     */
  /* <name>.webp still, side by side in the same folder. What identifies such a file   */
  /* is the FILENAME, never the folder: the very same map lives under                  */
  /*   beneos_assets/beneos_battlemaps/...        (local authoring install)            */
  /*   beneos_assets/cloud/battlemaps/...         (cloud installer namespace)          */
  /*   moulinette/adventures/<pack>/beneos_assets/beneos_battlemaps/...  (Moulinette)  */
  /* Matching on the folder is what used to hide the switch on every cloud-installed   */
  /* release. The suffix also draws the right line against battlemap OVERLAYS: an      */
  /* animated trap or effect tile is not a battlemap, has no still, and must never be  */
  /* switched. Intro sequences and previews fall out for the same reason.              */
  /********************************************************************************** */

  // <anything>[-_/]<4k|hd>_<bm|scen|sc>[_<n>].<webm|webp>
  static BENEOS_MAP_FILE = /(?:^|[-_/])(?:4k|hd)_(?:bm|scen|sc)(?:_\d+)?\.(?:webm|webp)$/i

  // Any of the three battlemap path schemes above. Used for coarse "is this a
  // Beneos battlemap asset at all" questions, never for the switch itself.
  static BENEOS_BATTLEMAP_DIR = /battlemaps\//i

  // Probe results for still/animated counterparts, keyed by full asset path.
  // Populated asynchronously; the context-menu condition can only read it
  // synchronously, hence the cache. Cleared when a release is installed.
  static _mapAssetProbe = new Map()

  /**
   * Every switchable battlemap reference on a scene: the background when it is
   * one, plus every tile that carries one. Both are collected, not just the
   * background, because rotated maps are placed as a rotated tile on a scene
   * whose background is empty, and some scenes carry a non-Beneos background
   * next to the real battlemap tile.
   * @returns {Array<{kind: "scene"|"tile", id?: string, src: string}>}
   */
  /**
   * Traegt die Szene Streaming-Markierungen?
   *
   * Erkennungsmerkmal ist die Kachel, die der Streaming-Umbau einfuegt: leere
   * Textur, Rolle in `flags["beneos-module"].stream`. Der Hintergrund allein
   * taugt nicht, denn er ist bei beiden Formen ein Standbild.
   */
  static isStreamedScene(scene) {
    if (!scene?.tiles) return false
    for (const tile of scene.tiles) {
      if (tile.flags?.["beneos-module"]?.stream?.role) return true
    }
    return false
  }

  static collectStaticSwitchTargets(scene) {
    const targets = []
    if (!scene) return targets

    // Eine gestreamte Szene hat keinen Umschalter, und das ist kein Mangel.
    //
    // Sie zeigt ohnehin erst das Standbild und laesst das Video nachkommen; ein
    // Schalter "auf statisch" haette hier nichts umzuschalten. Vor allem aber
    // stehen ihre Adressen auf dem Tor, sind also absolut, und die Probe unten
    // hat sie bis zum 2026-08-24 prozentkodiert gegen den eigenen
    // Foundry-Server geschickt: sechzehn rote Zeilen im Konsolenlog je
    // Installation, und danach war der Menueeintrag dauerhaft als nicht
    // verfuegbar vermerkt, samt Eintrag im localStorage.
    //
    // Bewusst frueh und ohne Probe. Was ein Spielleiter wirklich will, naemlich
    // das Video einer gestreamten Szene aus Leistungsgruenden gar nicht erst zu
    // holen, ist eine eigene Sache und keine Umbenennung von Dateiendungen.
    if (BeneosUtility.isStreamedScene(scene)) return targets

    const bg = BeneosUtility.getSceneBackgroundSrc(scene)
    if (bg && !BeneosUtility.isAbsoluteRef(bg) && BeneosUtility.BENEOS_MAP_FILE.test(bg)) {
      targets.push({ kind: "scene", src: bg })
    }
    for (const tile of scene.tiles) {
      const src = tile.texture?.src
      if (src && !BeneosUtility.isAbsoluteRef(src) && BeneosUtility.BENEOS_MAP_FILE.test(src)) {
        targets.push({ kind: "tile", id: tile.id, src })
      }
    }
    return targets
  }

  /**
   * Adressen, die nicht in die eigene Welt zeigen.
   *
   * Zweite Sicherung neben `isStreamedScene()`: eine Szene kann eine gestreamte
   * Kachel neben einer oertlichen tragen, und dann darf die eine geprueft
   * werden und die andere nicht. Der Umschalter arbeitet ausschliesslich auf
   * Pfaden der eigenen Welt.
   */
  static isAbsoluteRef(src) {
    return typeof src === "string" && (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src))
  }

  /** Swap a battlemap reference to its still / animated counterpart. Anchored
   *  on the extension so a folder containing "webm" can never be mangled. */
  static toStaticPath(src) { return String(src).replace(/\.webm$/i, ".webp") }
  static toAnimatedPath(src) { return String(src).replace(/\.webp$/i, ".webm") }

  /**
   * What the scene can currently be switched to: "toStatic" while any target is
   * still animated, "toAnimated" once everything is a still, or null when the
   * scene carries no Beneos battlemap at all.
   */
  static getStaticSwitchState(sceneId) {
    if (!game.user.isGM) return null
    const scene = game.scenes.get(sceneId)
    if (!scene) return null
    const targets = BeneosUtility.collectStaticSwitchTargets(scene)
    if (!targets.length) return null

    const animated = targets.some(t => /\.webm$/i.test(t.src))
    const command = animated ? "toStatic" : "toAnimated"
    const wanted = targets.map(t => ({
      ...t,
      target: animated ? BeneosUtility.toStaticPath(t.src) : BeneosUtility.toAnimatedPath(t.src)
    }))

    // Unknown counterparts are treated as available: the probe runs in the
    // background and switchPhase verifies again before touching the scene, so
    // an un-probed entry can never break a map.
    const probes = wanted.map(w => BeneosUtility._mapAssetProbe.get(w.target))
    const available = !probes.includes(false)
    if (probes.includes(undefined)) BeneosUtility.warmMapAssetProbe(wanted.map(w => w.target))

    return { command, targets: wanted, available }
  }

  /** Probe the given asset paths once each and remember the result. */
  static async warmMapAssetProbe(paths) {
    const todo = [...new Set(paths)].filter(p => p && !BeneosUtility._mapAssetProbe.has(p))
    if (!todo.length) return
    // Reserve the keys up front so overlapping warm-ups do not probe twice.
    for (const p of todo) BeneosUtility._mapAssetProbe.set(p, undefined)
    const queue = [...todo]
    const worker = async () => {
      while (queue.length) {
        const path = queue.shift()
        let ok = true
        try { ok = (await beneosHeadCheck(path))?.ok !== false }
        catch (e) { ok = true }
        BeneosUtility._mapAssetProbe.set(path, ok)
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker))
    BeneosUtility.scheduleMapAssetProbeCacheSave()
  }

  /********************************************************************************** */
  /* Persisting the probe results.                                                    */
  /*                                                                                  */
  /* Foundry serves data files with `Cache-Control: no-store`, so the browser can      */
  /* never reuse a probe on its own and every reload used to re-check every asset      */
  /* from scratch. In the Universe world that is 1893 requests before anyone has       */
  /* even right-clicked a scene. The results are per client, not per world state, so   */
  /* they belong in localStorage rather than in a world setting, which would be a      */
  /* document write on every change.                                                   */
  /*                                                                                  */
  /* Staleness is bounded three ways: the module version, an age limit, and the        */
  /* explicit clear on beneos.releaseInstalled. On top of that switchPhase re-checks   */
  /* live before it writes to a scene, so a stale entry can mislead a menu label but   */
  /* can never point a scene at a file that is not there.                              */
  /********************************************************************************** */
  static _probeCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000
  static _probeCacheSaveTimer = null

  static _probeCacheKey() {
    return `beneos-map-asset-probe:${game.world?.id ?? "unknown"}`
  }

  static _probeCacheVersion() {
    return game.modules.get(BeneosUtility.moduleID())?.version ?? "0"
  }

  static loadMapAssetProbeCache() {
    try {
      const raw = window.localStorage.getItem(BeneosUtility._probeCacheKey())
      if (!raw) return 0
      const data = JSON.parse(raw)
      if (data?.version !== BeneosUtility._probeCacheVersion()) return 0
      if (!data.savedAt || ((Date.now() - data.savedAt) > BeneosUtility._probeCacheMaxAgeMs)) return 0
      let restored = 0
      for (const [path, ok] of Object.entries(data.results ?? {})) {
        // Altlast vom 2026-08-24 und davor: bis dahin probte der Umschalter
        // auch absolute Tor-Adressen, bekam wegen der Prozentkodierung immer
        // 404 und schrieb das Ergebnis hierher. Wer diese Eintraege
        // zurueckliest, haelt den Umschalter fuer jede gestreamte Szene
        // dauerhaft fuer nicht verfuegbar, auch nachdem die Ursache behoben
        // ist. Sie werden beim Lesen verworfen; neu geschrieben werden sie
        // nicht mehr, weil `collectStaticSwitchTargets` sie gar nicht erst
        // sammelt.
        if (BeneosUtility.isAbsoluteRef(path)) continue
        BeneosUtility._mapAssetProbe.set(path, ok)
        restored++
      }
      return restored
    } catch (e) {
      console.warn("[Beneos] could not read the asset probe cache, re-probing:", e)
      return 0
    }
  }

  static scheduleMapAssetProbeCacheSave() {
    clearTimeout(BeneosUtility._probeCacheSaveTimer)
    BeneosUtility._probeCacheSaveTimer = setTimeout(() => BeneosUtility.saveMapAssetProbeCache(), 2000)
  }

  static saveMapAssetProbeCache() {
    try {
      const results = {}
      for (const [path, ok] of BeneosUtility._mapAssetProbe) {
        if (ok !== undefined) results[path] = ok
      }
      window.localStorage.setItem(BeneosUtility._probeCacheKey(), JSON.stringify({
        version: BeneosUtility._probeCacheVersion(),
        savedAt: Date.now(),
        results
      }))
    } catch (e) {
      // Quota exceeded or storage disabled. The in-memory cache still works for
      // this session, so this is not worth interrupting anyone over.
      console.warn("[Beneos] could not persist the asset probe cache:", e)
    }
  }

  /** Warm the probe cache for every scene that could offer the switch. */
  static warmStaticSwitchCache() {
    if (!game.user.isGM) return
    const paths = []
    for (const scene of game.scenes) {
      for (const t of BeneosUtility.collectStaticSwitchTargets(scene)) {
        paths.push(/\.webm$/i.test(t.src) ? BeneosUtility.toStaticPath(t.src) : BeneosUtility.toAnimatedPath(t.src))
      }
    }
    BeneosUtility.warmMapAssetProbe(paths)
  }

  /**
   * Re-probe only the scenes a freshly installed release brought in.
   *
   * Installing used to drop the WHOLE probe cache and walk the entire world
   * again, which fired a burst of HEAD requests for every other release in it,
   * including the 404s for older ones that ship no still. The install already
   * knows its scene ids, and files can only have appeared for those, so nothing
   * outside them needs re-checking. Deleting before warming is mandatory:
   * warmMapAssetProbe reserves its keys and skips any that are already set.
   */
  static async refreshStaticSwitchCacheForScenes(sceneIds) {
    if (!game.user.isGM) return
    const paths = []
    for (const id of new Set((sceneIds || []).map(String))) {
      const scene = game.scenes.get(id)
      if (!scene) continue
      for (const t of BeneosUtility.collectStaticSwitchTargets(scene)) {
        paths.push(/\.webm$/i.test(t.src) ? BeneosUtility.toStaticPath(t.src) : BeneosUtility.toAnimatedPath(t.src))
      }
    }
    if (!paths.length) return
    for (const p of paths) BeneosUtility._mapAssetProbe.delete(p)
    await BeneosUtility.warmMapAssetProbe(paths)
    BeneosUtility.scheduleMapAssetProbeCacheSave()
  }

  static clearStaticSwitchCache() {
    BeneosUtility._mapAssetProbe.clear()
    clearTimeout(BeneosUtility._probeCacheSaveTimer)
    try { window.localStorage.removeItem(BeneosUtility._probeCacheKey()) }
    catch (e) { /* storage disabled, nothing persisted to drop */ }
  }

  /********************************************************************************** */
  /** Kept for backwards compatibility with external callers: returns "scene",
   *  a tile id, or undefined, for the requested direction. */
  static isSwitchableBeneosBattlemap(sceneId, fileType) {
    const state = BeneosUtility.getStaticSwitchState(sceneId)
    if (!state) return undefined
    const wanted = (fileType === "webm") ? "toStatic" : "toAnimated"
    if (state.command !== wanted) return undefined
    const first = state.targets[0]
    return (first.kind === "scene") ? "scene" : first.id
  }

  /********************************************************************************** */
  static getBattlemapSrcPath(sceneId, tileId) {
    let scene = game.scenes.get(sceneId)
    let bg = BeneosUtility.getSceneBackgroundSrc(scene)
    if (tileId != "scene") {
      let tile = scene.tiles.get(tileId)
      bg = tile.texture.src
    }
    return bg
  }

  /********************************************************************************** */
  static async switchPhase(sceneId, command) {
    const scene = game.scenes.get(sceneId)
    const state = BeneosUtility.getStaticSwitchState(sceneId)
    if (!scene || !state) return
    if (command && command !== state.command) return

    // Verify on disk before writing. A missing counterpart would otherwise
    // leave the scene pointing at a file that does not exist.
    //
    // This deliberately re-checks instead of trusting _mapAssetProbe. That cache
    // survives reloads now, so an entry may predate a file being deleted, and it
    // only ever drives a menu label. Here a scene is about to be rewritten, so a
    // few HEAD requests on an explicit user action are the right trade.
    const missing = []
    for (const t of state.targets) {
      let ok = true
      try { ok = (await beneosHeadCheck(t.target))?.ok !== false }
      catch (e) { ok = true }
      BeneosUtility._mapAssetProbe.set(t.target, ok)
      if (!ok) missing.push(t.target)
    }
    BeneosUtility.scheduleMapAssetProbeCacheSave()
    if (missing.length) {
      ui.notifications.warn(game.i18n.localize("BENEOS.Scene.StaticMap.Unavailable"))
      BeneosUtility.debugMessage("Static switch aborted, missing asset(s): ", missing)
      // Re-render both menus so the entry turns red now that we know.
      ui.nav?.render()
      ui.scenes?.render()
      return
    }

    const tileUpdates = state.targets.filter(t => t.kind === "tile")
      .map(t => ({ _id: t.id, "texture.src": t.target }))
    const background = state.targets.find(t => t.kind === "scene")

    BeneosUtility.debugMessage("Static switch: ", { command: state.command, targets: state.targets })
    if (background) await BeneosUtility.updateSceneBackgroundSrc(scene, background.target)
    if (tileUpdates.length) await scene.updateEmbeddedDocuments("Tile", tileUpdates)
  }

  /********************************************************************************** */
  static resetTokenData() {
    this.beneosTokens = {}
  }

  /********************************************************************************** */
  static upperFirst(text) {
    if (typeof text !== 'string') return text
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  /********************************************************************************** */
  static debugMessage(msg, data) {
    if (BeneosUtility.isDebug()) {
      console.log(msg, data)
    }
  }

  /********************************************************************************** */
  static moduleName() {
    return BENEOS_MODULE_NAME
  }

  /********************************************************************************** */
  static getBeneosTokenDataPath() {
    return this.tokenDataPath
  }
  static getBeneosSpellDataPath() {
    return this.spellDataPath
  }
  static getBeneosItemDataPath() {
    return this.itemDataPath
  }

  /********************************************************************************** */
  static moduleID() {
    return BENEOS_MODULE_ID
  }

  /********************************************************************************** */
  // Base URL of the Beneos Cloud. Defaults to the production cloud; can be pointed
  // at a dev server via the hidden 'beneos-cloud-base-url' world setting (no trailing slash).
  static cloudBase() {
    let base = ""
    try { base = game.settings.get(BeneosUtility.moduleID(), 'beneos-cloud-base-url') || "" } catch (e) { base = "" }
    base = String(base).trim().replace(/\/+$/, "")
    return base || "https://beneos.cloud"
  }

  /********************************************************************************** */
  static isDebug() {
    return beneosDebug
  }
  /********************************************************************************** */
  static isBeneosModule() {
    return true
  }

  /********************************************************************************** */
  static getBasePath() {
    if (this.beneosBasePath == undefined || this.beneosBasePath == null || this.beneosBasePath == "") {
      return ""
    }
    return this.beneosBasePath + "/"
  }

  /********************************************************************************** */
  static getFullPathWithSlash() {
    return this.getBasePath() + this.getBeneosTokenDataPath()
  }
  /********************************************************************************** */
  static seed(i) {
    this.m_w = (123456789 + i) & __mask
    this.m_z = (987654321 - i) & __mask
  }

  /********************************************************************************** */
  //Random function better than the default rand.
  static random() {
    this.m_z = (36969 * (this.m_z & 65535) + (this.m_z >> 16)) & __mask
    this.m_w = (18000 * (this.m_w & 65535) + (this.m_w >> 16)) & __mask
    let result = ((this.m_z << 16) + (this.m_w & 65535)) >>> 0
    result /= 4294967296
    return result
  }

  /********************************************************************************** */
  static newTokenSetup(token) {
    let object = (token.document) ? token.document : token
    let tokenData = BeneosUtility.getTokenImageInfo(object.texture.src)
    object.setFlag(BeneosUtility.moduleID(), "fullKey", tokenData.fullKey)
    object.setFlag("core", "randomizeVideo", false)
    // Frueher stand hier ein Update auf das Feld `scale`. Das ist ein
    // V9-Feld, das TokenDocument in V13 nicht mehr kennt. Der Aufruf
    // lief fehlerfrei durch und bewirkte nichts, weshalb ein per
    // Drag-and-Drop abgelegter Token weder Scale noch Anchor aus den
    // Flags bekam. Kanonisch sind texture.scaleX/scaleY/anchorX/anchorY.
    const renderUpdate = BeneosUtility.beneosRenderUpdateFor(object)
    const scene = object.parent ?? canvas.scene
    if (renderUpdate && scene) {
      scene.updateEmbeddedDocuments("Token", [renderUpdate], { beneosRenderSync: true })
        .catch(err => console.warn("[Beneos] newTokenSetup render update failed", err))
    }
    setTimeout(function () {
      BeneosUtility.updateToken(token.id, { forceupdate: true })
    }, 500)
  }

  /********************************************************************************** */
  static createToken(token) {
    if (BeneosUtility.checkIsBeneosToken(token)) {
      BeneosUtility.preloadToken(token)
      setTimeout(function () {
        BeneosUtility.newTokenSetup(token)
      }, 500)
    }
  }

  /********************************************************************************** */
  //Foundry default get token give errors from time to time. It's better to get them directly from de canvas.
  static getToken(tokenid) {
    return canvas.tokens.placeables.find(t => t.id == tokenid)
  }

  /********************************************************************************** */
  // Stage 13a-Polish: explicit Beneos-creature check. Prefers the
  // new `isBeneosCreature: true` flag for unambiguous detection;
  // falls back to `tokenKey`-existence for backward-compatibility
  // with installs from before this polish (legacy Beneos tokens get
  // the flag backfilled on next cloud-update via the propagate-
  // pipeline).
  // Accepts either a Token, a TokenDocument, or an Actor and resolves
  // to the underlying Actor for the flag-read.
  static isBeneosCreature(actorOrToken) {
    if (!actorOrToken) return false
    const actor = actorOrToken.actor || actorOrToken
    const flag = actor?.getFlag?.("world", "beneos")
    if (!flag) return false
    return flag.isBeneosCreature === true || !!flag.tokenKey
  }

  /********************************************************************************** */
  // Backward-compatibility shim — keeps the 5+ existing call sites
  // (renderTokenHUD-Hook, updateToken-Hook, etc.) working without a
  // mass-rename. New code should prefer isBeneosCreature() directly.
  static checkIsBeneosToken(token) {
    return BeneosUtility.isBeneosCreature(token)
  }

  /********************************************************************************** */
  // Decides whether THIS client should perform a persisted token-document
  // mutation (dead-FX / variant swap). Foundry only lets OWNER/GM write a token,
  // so reactive automation must run on exactly one privileged client to avoid
  // both "lacks permission" errors on player clients and double-writes when
  // several GMs are connected. Preference: the single active GM (always has the
  // rights). If no GM is connected, fall back to exactly one owner client that
  // actually has update rights, so GM-less sessions still get the effect.
  static beneosIsTokenWriter(tokenDoc) {
    if (!tokenDoc) return false
    const activeGM = game.users?.activeGM
    if (activeGM) return activeGM.isSelf
    if (!tokenDoc.canUserModify?.(game.user, "update")) return false
    const owners = (game.users?.players ?? []).filter(u => u.active && tokenDoc.testUserPermission(u, "OWNER"))
    const primary = owners.sort((a, b) => a.id.localeCompare(b.id))[0]
    return (primary?.id ?? game.user.id) === game.user.id
  }

  /********************************************************************************** */
  static removeTokenFromActorId(actorId) {
    let isRemoved = false
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token.actorId == actorId) {
        BeneosUtility.debugMessage("Removing token from actorId", token.actorId, fullKey)
        delete this.beneosTokens[fullKey]
        isRemoved = true
        break
      }
    }

    if (isRemoved) {
      BeneosUtility.debugMessage("Token removed for actorId", actorId)
      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-tokenconfig', JSON.stringify(this.beneosTokens))
      // V1 close-and-reopen path removed — V2 handles the actor-delete
      // refresh via the notifyInstallEnded chain at the tail of
      // importTokenToCompendium and stays open in place.
    }
  }

  /********************************************************************************** */
  static removeItem(itemId) {
    let isRemoved = false
    for (let [fullKey, item] of Object.entries(this.beneosItems)) {
      if (item.itemId == itemId) {
        BeneosUtility.debugMessage("Removing item from itemId", item.itemId, fullKey)
        delete this.beneosItems[fullKey]
        isRemoved = true
        break
      }
    }

    if (isRemoved) {
      // Save the new data
      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-itemconfig', JSON.stringify(this.beneosItems))
      // V1 close-and-reopen removed — V2 handles refresh in place.
    }
  }

  /********************************************************************************** */
  static removeSpell(spellId) {
    let isRemoved = false
    for (let [fullKey, spell] of Object.entries(this.beneosSpells)) {
      if (spell.spellId == spellId) {
        BeneosUtility.debugMessage("Removing spell from spellId", spell.spellId, fullKey)
        delete this.beneosSpells[fullKey]
        isRemoved = true
        break
      }
    }
    if (isRemoved) {
      // Save the new data
      game.settings.set(BeneosUtility.moduleID(), 'beneos-json-spellconfig', JSON.stringify(this.beneosSpells))
      // V1 close-and-reopen removed — V2 handles refresh in place.
    }
  }

  /********************************************************************************** */
  //Retrieves the necessary data from a token in order to be able to fire automatic animations based on the current token image file.
  static getTokenImageInfo(token) {

    let fullKey = token?.document?.getFlag(BeneosUtility.moduleID(), "fullKey")
    if (fullKey) {
      return BeneosUtility.beneosTokens[fullKey]
    }

    let beneos = token?.actor?.getFlag("world", "beneos");
    if (beneos) {
      let fullKey = beneos.fullId
      return BeneosUtility.beneosTokens[fullKey]
    }
    return {}
  }

  /********************************************************************************** */
  //Retrieves the necessary data from a token in order to be able to fire automatic animations based on the current token image file.
  static getTokenDataFromKey(fullKey) {
    if (fullKey) {
      return BeneosUtility.beneosTokens[fullKey]
    }
    return {}
  }

  /********************************************************************************** */
  //Function that preloads token animations. We need to do it to prevent the "scale not found" error in Foundry
  static preloadToken(token) {
    // Not sure to keep this as it was used to preload animations
    let myToken = this.getTokenImageInfo(token)

    if (!myToken) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Config not found preloadToken " + token.name)
      return
    }

  }

  /********************************************************************************** */
  static async applyDeadFX(token) {
    let bfx = ["BFXDead", "BFXDeadIcon"]
    this.addFx(token, bfx, true, true)

  }
  /********************************************************************************** */
  // Function to add FX from the Token Magic module or from the ones defined in the configuration files.
  static async addFx(token, bfx, replace = true, apply = true) {
    if (typeof TokenMagic !== 'undefined') {
      let bpresets = []

      $.each(bfx, function (index, value) {
        let bfxid = value
        let effect = TokenMagic.getPreset(bfxid)
        if (effect !== undefined) {
          BeneosUtility.debugMessage("[BENEOS MODULE] Setting Library FX: " + bfxid)
          $.each(effect, function (presetindex, pressetvalue) {
            bpresets.push(pressetvalue)
          })
        } else {
          if (beneosFX[bfxid] !== undefined) {
            BeneosUtility.debugMessage("[BENEOS MODULE] Setting Beneos FX: " + bfxid)
            // Computed preset fields are plain functions (see beneosfx.js).
            // Resolve them per-apply so the per-token randomisation stays
            // live, producing a fresh preset object without mutating the
            // shared beneosFX definition.
            const fxCtx = {
              dataPath: BeneosUtility.getBasePath() + BeneosUtility.getBeneosTokenDataPath(),
              random: () => BeneosUtility.random()
            }
            $.each(beneosFX[bfxid], function (presetindex, pressetvalue) {
              const resolved = {}
              $.each(pressetvalue, function (kid, kidvalue) {
                resolved[kid] = (typeof kidvalue === "function") ? kidvalue(fxCtx) : kidvalue
              })
              bpresets.push(resolved)
            })
          }
        }
      })
      if (apply) {
        BeneosUtility.debugMessage("Adding effects", bpresets, replace)
        token.TMFXaddFilters(bpresets, replace)
      } else {
        return bpresets
      }
    }
  }

  /********************************************************************************** */
  static firstLetterUpper(mySentence) {
    const words = mySentence.split(" ");
    return words.map((word) => {
      return word[0].toUpperCase() + word.substring(1)
    }).join(" ")
  }

  /********************************************************************************** */
  static async prepareMenu(e, sheet) {
    if (!game.user.isGM) return; // GM-only: defense-in-depth
    if (e.button == 2) {
      let tokenList = BeneosUtility.buildAvailableTokensMenu()
      const beneosTokensDisplay = await BeneosUtility.buildAvailableTokensMenuHTML("beneos-actor-menu.html", tokenList)
      let menu = new BeneosModuleMenu(beneosTokensDisplay, tokenList, sheet.actor.token?.actor || sheet.actor, e.pageX, e.pageY, "beneos-actor-menu.html")
      menu.render(true)
    }
  }

  /********************************************************************************** */
  // Asset-type registry for the generic install/loaded lookups below.
  // Tokens are cached under their fullKey (so they need a scan on
  // token.tokenKey); items and spells are keyed directly in their dict.
  static #ASSET_DICT    = { token: "beneosTokens", item: "beneosItems", spell: "beneosSpells" }
  static #ASSET_PACK    = { token: "world.beneos_module_actors", item: "world.beneos_module_items", spell: "world.beneos_module_spells" }
  static #ASSET_IDFIELD = { token: "actorId", item: "itemId", spell: "spellId" }

  // Resolve the cache entry for an asset key. `fallback` enables the
  // lowercase/underscore key normalisation that the loaded-status check
  // uses for items and spells.
  static #assetEntry(type, key, { fallback = false } = {}) {
    if (!key) return undefined
    const dict = this[this.#ASSET_DICT[type]]
    if (!dict) return undefined
    if (type === "token") {
      for (const token of Object.values(dict)) {
        if (token.tokenKey == key) return token
      }
      return undefined
    }
    let entry = dict[key]
    if (!entry && fallback) entry = dict[key.toLowerCase().replace("-", "_")]
    return entry
  }

  static getInstallTS(type, key) {
    return this.#assetEntry(type, key)?.installDate
  }
  // Returns the SHA256 stored at install time, or empty string if the
  // asset predates the Tier-2 flag schema (in which case Update-
  // Detection falls back to a pure timestamp compare).
  static getInstallHash(type, key) {
    return this.#assetEntry(type, key)?.contentSignature || ""
  }

  static getTokenInstallTS(key) { return this.getInstallTS("token", key) }
  static getItemInstallTS(key)  { return this.getInstallTS("item", key) }
  static getSpellInstallTS(key) { return this.getInstallTS("spell", key) }
  static getTokenInstallHash(key) { return this.getInstallHash("token", key) }
  static getItemInstallHash(key)  { return this.getInstallHash("item", key) }
  static getSpellInstallHash(key) { return this.getInstallHash("spell", key) }

  // Days an asset stays in the "Newly added" filter, configurable per
  // world via the beneos-new-asset-window-days setting. Returns the
  // value in seconds for direct comparison against Unix timestamps.
  // Defaults to 30 days when the setting is not yet registered (init
  // order on a fresh world) or holds a non-positive value.
  static getNewAssetWindowSeconds() {
    let days = 30
    try {
      const v = game.settings.get(BeneosUtility.moduleID(), 'beneos-new-asset-window-days')
      if (typeof v === "number" && v > 0) days = v
    } catch (e) { /* setting not registered yet */ }
    return days * 24 * 60 * 60
  }

  /********************************************************************************** */
  static getLocalAvatarPicture(key) {
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token.tokenKey == key) {
        return token.avatar
      }
    }
    return undefined
  }

  /********************************************************************************** */
  // Punkt 1 — installed-status validation. The cache is necessary but not
  // sufficient: a stale entry can survive after the user deletes the
  // compendium document manually. We treat the asset as "installed" only
  // when the cache claims it AND the referenced compendium id resolves in
  // the pack index. If the index isn't ready yet (early boot), fall back to
  // the cache so the search engine doesn't flicker every asset to
  // "installable" before packs finish loading.
  static #compendiumHasId(packName, id) {
    if (!id) return false
    const pack = game.packs?.get?.(packName)
    if (!pack) return true
    const index = pack.index
    if (!index || index.size === 0) return true
    return !!index.get?.(id) || !!index.has?.(id)
  }

  // Installed-status: the cache claims the asset AND its referenced
  // compendium id resolves in the pack index. Items/spells get the
  // lowercase/underscore key fallback; tokens are matched by tokenKey.
  static isLoaded(type, key) {
    const entry = this.#assetEntry(type, key, { fallback: type !== "token" })
    if (!entry) return false
    return BeneosUtility.#compendiumHasId(this.#ASSET_PACK[type], entry[this.#ASSET_IDFIELD[type]])
  }

  static isTokenLoaded(key) { return this.isLoaded("token", key) }
  static isItemLoaded(key)  { return this.isLoaded("item", key) }
  static isSpellLoaded(key) { return this.isLoaded("spell", key) }

  /********************************************************************************** */
  static getActorIdVariant(key, idx) {
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token.tokenKey.toLowerCase() == key.toLowerCase() && token.number == idx) {
        return token.actorId
      }
    }
    return undefined
  }
  static getActorId(key) {
    for (let [fullKey, token] of Object.entries(this.beneosTokens)) {
      if (token.tokenKey.toLowerCase() == key.toLowerCase()) {
        return token.actorId
      }
    }
    return undefined
  }
  static getItemId(key) {
    let token = this.beneosItems[key.toLowerCase()]
    if (token) {
      return token.itemId
    }
    return undefined
  }
  static getSpellId(key) {
    let token = this.beneosSpells[key.toLowerCase()]
    if (token) {
      //BeneosUtility.debugMessage("Spell ?", token)
      return token.spellId
    }
    return undefined
  }

  /********************************************************************************** */
  // Stage 13d-10: variant index from a Beneos texture path
  // (`…-2-top.webp` → "2", `…-1-token.webp` → "1"). Returned as string
  // so it indexes the JSON variants map directly.
  // Stage 13d-13: die Endung ist jetzt offen. Ein Autor, der noch am
  // Rendern ist, hat oft `-1-top.png` auf dem Token; mit der alten
  // webp-Bindung galt das als variantenlos und der Wert landete nur im
  // Top-Level. Der Query-String-Zweig faengt Cache-Buster wie `?v=2`.
  static beneosVariantFromSrc(src) {
    if (typeof src !== "string") return null
    const m = /-(\d+)-(?:top|token)\.[a-z0-9]+(?:\?|$)/i.exec(src)
    return m ? m[1] : null
  }

  /********************************************************************************** */
  // Stage 13a: per-token scale resolver. Reads
  // flags.world.beneos.rendering.{topDownScale,tokenizedScale}; falls
  // back to BENEOS_SCALE_* constants when the actor has no override
  // (or has null/missing/non-numeric values). The cloud-delivered
  // actorJSON can ship per-creature defaults via this flag, and end-
  // users (or the Stage-13d Creator-Mode UI) can override locally.
  // Source-of-truth-Hierarchie: User-Override > Cloud-Default >
  // Konstante.
  // Stage 13d-10: variant-aware. When `src` is passed and the actor's
  // rendering flag carries a `variants` map, the per-variant value
  // (e.g. rendering.variants["2"].topDownScale) wins over the
  // top-level. The top-level remains the canonical `-1` default.
  static getBeneosScale(actor, mode, src = null) {
    const isTopDown = (mode === "topdown")
    const fallback = isTopDown
      ? BeneosUtility.BENEOS_SCALE_TOPDOWN
      : BeneosUtility.BENEOS_SCALE_TOKENIZED
    if (!actor) return fallback
    const rendering = actor.getFlag?.("world", "beneos")?.rendering
    if (!rendering) return fallback
    const scaleKey = isTopDown ? "topDownScale" : "tokenizedScale"
    const variant = BeneosUtility.beneosVariantFromSrc(src)
    if (variant && rendering.variants && rendering.variants[variant]) {
      const v = rendering.variants[variant][scaleKey]
      if (typeof v === "number" && v > 0) return v
    }
    const override = rendering[scaleKey]
    return (typeof override === "number" && override > 0) ? override : fallback
  }

  /********************************************************************************** */
  // Stage 13d-9: per-mode anchor (texture.anchorX/Y). Mirrors the
  // scale pattern: each mode persists its own anchor, mode-switch
  // applies the right value alongside the texture+scale swap. Foundry
  // default is (0.5, 0.5) — center anchor — and we use that as the
  // fallback when no override exists.
  // Stage 13d-10: variant-aware. Same precedence chain as
  // getBeneosScale — variants[N] beats top-level when `src` resolves
  // to a known variant, both axes must be numeric to count as a hit.
  static getBeneosAnchor(actor, mode, src = null) {
    const fallback = { x: 0.5, y: 0.5 }
    if (!actor) return fallback
    const rendering = actor.getFlag?.("world", "beneos")?.rendering
    if (!rendering) return fallback
    const isTopDown = (mode === "topdown")
    const xKey = isTopDown ? "topDownAnchorX" : "tokenizedAnchorX"
    const yKey = isTopDown ? "topDownAnchorY" : "tokenizedAnchorY"
    // Stage 13d-12: achsenweise aufloesen. Vorher verlangte der
    // Varianten-Zweig BEIDE Achsen als Zahl und fiel sonst komplett auf
    // das Top-Level zurueck. Eine Einzelachsen-Anpassung im Creator-Mode
    // schreibt aber genau eine Achse in variants[N], womit die gerade
    // gesetzte Korrektur beim Lesen wieder verschwand. Praezedenz bleibt
    // pro Achse: variants[N] vor Top-Level vor Konstante.
    const variant = BeneosUtility.beneosVariantFromSrc(src)
    const ve = (variant && rendering.variants) ? rendering.variants[variant] : null
    const pick = (key) => {
      if (ve && typeof ve[key] === "number") return ve[key]
      if (typeof rendering[key] === "number") return rendering[key]
      return null
    }
    const ax = pick(xKey)
    const ay = pick(yKey)
    return {
      x: (ax === null) ? fallback.x : ax,
      y: (ay === null) ? fallback.y : ay
    }
  }

  /********************************************************************************** */
  // Stage 13d-13: der eine Schreiber fuer Scale- und Anchor-Werte in
  // flags.world.beneos.rendering. Vorher lag diese Logik doppelt in
  // beneos_module.js (_beneosCreatorPersistScale und -Anchor), und sie musste
  // schon zweimal nachgebessert werden: erst um die Variantenmap, dann um die
  // achsenweise Anchor-Aufloesung. Eine dritte Kopie im dev-Tool waere die
  // naechste Divergenz gewesen, deshalb steht sie jetzt hier und wird von
  // beiden Seiten benutzt.
  //
  // Optionen:
  //   src        Texturpfad, aus dem Modus und Variante abgeleitet werden
  //   mode       "topdown" | "tokenized", ueberstimmt die Ableitung. Noetig bei
  //              Pfaden, aus denen sich der Modus nicht ergibt
  //   variant    ueberstimmt die Ableitung aus src; null erzwingt "keine Variante"
  //   scale      positive Zahl oder null
  //   anchorX/Y  Zahl oder null, einzeln setzbar
  //   createFlag legt flags.world.beneos an, wenn es fehlt. Standard false,
  //              damit der Endkunden-Pfad sich unveraendert verhaelt
  //
  // Rueckgabe: { rendering, created, changed } oder null, wenn nichts zu tun war.
  static async beneosPersistRenderValues(worldActor, {
    src = null, mode = null, variant = undefined,
    scale = null, anchorX = null, anchorY = null,
    createFlag = false
  } = {}) {
    if (!worldActor) return null
    const beneosFlag = worldActor.getFlag("world", "beneos")
    if (!beneosFlag && !createFlag) return null   // kein Beneos-Actor, stiller Ausstieg wie bisher

    const effSrc = src || worldActor.prototypeToken?.texture?.src || ""
    const effMode = (mode === "topdown" || mode === "tokenized")
      ? mode
      : BeneosUtility.beneosRenderMode(effSrc)
    const effVariant = (variant === undefined)
      ? BeneosUtility.beneosVariantFromSrc(effSrc)
      : variant

    const isTopDown = (effMode === "topdown")
    const scaleKey = isTopDown ? "topDownScale" : "tokenizedScale"
    const xKey = isTopDown ? "topDownAnchorX" : "tokenizedAnchorX"
    const yKey = isTopDown ? "topDownAnchorY" : "tokenizedAnchorY"

    const current = beneosFlag?.rendering || {}
    // Der Vergleich laeuft gegen den tatsaechlich wirksamen Wert, also gegen
    // den Varianteneintrag falls vorhanden. Gegen das Top-Level zu vergleichen
    // wuerde eine Anpassung an einer Variante als "keine Aenderung" verwerfen.
    const effective = (effVariant && current.variants?.[effVariant])
      ? current.variants[effVariant]
      : current

    const wantScale = (typeof scale === "number" && scale > 0) && effective[scaleKey] !== scale
    const wantX = Number.isFinite(anchorX) && effective[xKey] !== anchorX
    const wantY = Number.isFinite(anchorY) && effective[yKey] !== anchorY
    const created = !beneosFlag
    if (!wantScale && !wantX && !wantY) {
      return { rendering: current, created: false, changed: false }
    }

    const rendering = { ...current }
    if (effVariant) {
      const variants = { ...(rendering.variants || {}) }
      const entry = { ...(variants[effVariant] || {}) }
      if (wantScale) entry[scaleKey] = scale
      if (wantX) entry[xKey] = anchorX
      if (wantY) entry[yKey] = anchorY
      variants[effVariant] = entry
      rendering.variants = variants
    }
    // Variante 1 ist die Leitvariante: ihr Wert bleibt zusaetzlich der
    // Top-Level-Default fuer Varianten ohne eigenen Eintrag. Ohne erkennbare
    // Variante gibt es nur den Top-Level-Pfad.
    if (!effVariant || effVariant === "1") {
      if (wantScale) rendering[scaleKey] = scale
      if (wantX) rendering[xKey] = anchorX
      if (wantY) rendering[yKey] = anchorY
    }

    // Dotted path statt setFlag("world","beneos", vollesObjekt): setFlag
    // ersetzt den kompletten Teilbaum, ein Fehler in der Spread-Kette wuerde
    // also tokenKey, fullId oder contentSignature verlieren. Der dotted path
    // kann strukturell nur rendering treffen. Das ist besonders wichtig, seit
    // der Block auch neu angelegt wird: dort waere sonst gar kein
    // Geschwisterobjekt vorhanden, das man versehentlich mitschreiben koennte.
    // render:false haelt den Actor-Directory-Rebuild aus dem Klickpfad heraus.
    try {
      await worldActor.update(
        { "flags.world.beneos.rendering": rendering },
        { beneosRenderSync: true, render: false }
      )
    } catch (err) {
      console.warn("[Beneos] persist render values failed", err)
      return null
    }
    BeneosUtility.debugMessage("[Beneos] persisted render values",
      { mode: effMode, variant: effVariant, scale, anchorX, anchorY, created }, "on", worldActor.name)
    return { rendering, created, changed: true }
  }

  /********************************************************************************** */
  // Stage 13d-13: dieselbe Praezedenzkette wie getBeneosScale und
  // getBeneosAnchor, aber OHNE Fallback auf die Konstanten. Fehlt ein Wert,
  // steht dort null.
  //
  // Der Unterschied ist fuer eine Anzeige entscheidend: getBeneosRenderProfile
  // liefert bei einem Actor ohne rendering-Flag stumm 1.1 und 0.5/0.5, und
  // damit kann ein Werkzeug "gespeicherter Wert ist 1.1" nicht von "es ist
  // ueberhaupt nichts gespeichert" unterscheiden. Es wuerde also eine
  // Abweichung anzeigen, wo gar kein Vergleichswert existiert.
  static getBeneosRenderOverrides(actor, mode, src = null) {
    const empty = { scale: null, anchorX: null, anchorY: null, hasFlag: false }
    if (!actor) return empty
    const rendering = actor.getFlag?.("world", "beneos")?.rendering
    if (!rendering) return empty

    const isTopDown = (mode === "topdown")
    const scaleKey = isTopDown ? "topDownScale" : "tokenizedScale"
    const xKey = isTopDown ? "topDownAnchorX" : "tokenizedAnchorX"
    const yKey = isTopDown ? "topDownAnchorY" : "tokenizedAnchorY"

    const variant = BeneosUtility.beneosVariantFromSrc(src)
    const ve = (variant && rendering.variants) ? rendering.variants[variant] : null
    const pick = (key, positiveOnly = false) => {
      const ok = (v) => typeof v === "number" && (!positiveOnly || v > 0)
      if (ve && ok(ve[key])) return ve[key]
      if (ok(rendering[key])) return rendering[key]
      return null
    }
    return {
      scale: pick(scaleKey, true),
      anchorX: pick(xKey),
      anchorY: pick(yKey),
      hasFlag: true
    }
  }

  /********************************************************************************** */
  // Creator-Mode: gilt automatisch, sobald die Beneos Development Tools
  // (Modul-ID "beneos-dev") in der Welt aktiv sind. Dieses Modul liegt
  // ausschliesslich auf Entwickler-Instanzen, seine Anwesenheit ist also
  // das ehrlichste Signal dafuer, dass hier autorisiert wird und
  // Scale-, Anchor- und FX-Aenderungen zurueck in die Flags gehoeren.
  // Dieselbe Erkennung nutzt bereits beneos_analytics.js, um Dev-
  // Instanzen von der Telemetrie auszunehmen.
  //
  // Bewusst abgeleitet statt beim Start in die Einstellung geschrieben:
  // so schaltet ein deaktiviertes beneos-dev den Modus von selbst wieder
  // ab, statt einen einmal gesetzten Wert zurueckzulassen.
  // Nur fuer GMs. Alles, was der Modus freischaltet, schreibt in
  // Welt-Actor-Flags; auf einem Spieler-Client wuerden diese Versuche an
  // den Rechten scheitern und nur Warnungen produzieren. Vor der
  // Automatik war das kein Thema, weil die Einstellung client-scoped und
  // standardmaessig aus war. Mit beneos-dev in der Welt gaelte sie sonst
  // fuer jeden verbundenen Spieler mit.
  static isBeneosCreatorMode() {
    if (!game.user?.isGM) return false
    if (game.modules?.get("beneos-dev")?.active) return true
    try {
      return !!game.settings.get(BeneosUtility.moduleID(), "beneos-creator-mode")
    } catch (e) {
      return false  // Einstellung bei sehr fruehem Init noch nicht registriert
    }
  }

  /********************************************************************************** */
  // Render-Profil: Modus, Scale und Anchor fuer genau einen Texturpfad.
  //
  // Content-Regel: 2.5D (`-token.webp`) ist pauschal, Scale 1.1 bei
  // Anchor 0.5/0.5. Top-Down (`-top.webp`) ist dynamisch, weil die
  // Draufsicht-Formate je Kreatur und je Variante anders ausfallen.
  // Beide Faelle laufen bewusst durch denselben Resolver, damit ein
  // kuenftiger 2.5D-Sonderwert aus dem dev-Tool nicht an einer
  // Sonderbehandlung scheitert.
  // Stage 13d-13: erkennt `-top` bei jeder Endung, nicht mehr nur bei webp.
  // Ein korrekt benanntes `-top.png` galt vorher als 2.5D, der Wert landete
  // also in tokenizedScale und die Draufsicht blieb ungespeichert. Der alte
  // includes-Zweig bleibt als ODER stehen: er trifft auch Pfade, bei denen
  // `-top.webp` nicht am Ende steht (Ordnername, Cache-Buster), und die
  // sollen ihre bisherige Einordnung behalten. Diese Funktion entscheidet,
  // in welchen Flag-Key rund 970 Varianten geschrieben werden.
  static beneosRenderMode(src) {
    if (typeof src !== "string") return "tokenized"
    const isTop = /-top\.[a-z0-9]+(?:\?|$)/i.test(src) || src.includes("-top.webp")
    return isTop ? "topdown" : "tokenized"
  }

  // Stage 13d-13: laesst sich der Modus ueberhaupt aus dem Pfad ableiten?
  // Bei einem Platzhalter-SVG, einem Roh-Render oder einer Wildcard ist die
  // Antwort nein, und dann muss der Modus von aussen kommen statt geraten
  // zu werden. beneosRenderMode wuerde in diesen Faellen stumm "tokenized"
  // liefern, was fuer eine Draufsicht die falsche Flag-Ebene ist.
  static beneosRenderModeDerivable(src) {
    return typeof src === "string" && /-(?:top|token)\.[a-z0-9]+(?:\?|$)/i.test(src)
  }

  static getBeneosRenderProfile(actor, src) {
    const mode = BeneosUtility.beneosRenderMode(src)
    const anchor = BeneosUtility.getBeneosAnchor(actor, mode, src)
    return {
      mode,
      scale: BeneosUtility.getBeneosScale(actor, mode, src),
      anchorX: anchor.x,
      anchorY: anchor.y
    }
  }

  // Flaches Update-Objekt. `prefix` ist "texture" fuer ein
  // TokenDocument und "prototypeToken.texture" fuer den Actor.
  static beneosRenderPatch(profile, prefix = "texture") {
    return {
      [`${prefix}.scaleX`]: profile.scale,
      [`${prefix}.scaleY`]: profile.scale,
      [`${prefix}.anchorX`]: profile.anchorX,
      [`${prefix}.anchorY`]: profile.anchorY
    }
  }

  /********************************************************************************** */
  // Stempel-Mechanik. Jedes Mal, wenn das Modul Scale/Anchor selbst
  // setzt, legt es dieselben Werte unter flags.beneos-module.renderStamp
  // ab. Nur so laesst sich spaeter unterscheiden, ob ein abweichender
  // Wert von uns stammt oder ob der GM den Token bewusst umskaliert hat
  // (vergroesserter Boss). Der Szenen-Sync fasst nur unberuehrte Tokens
  // an.
  static BENEOS_RENDER_EPSILON = 0.0005

  static beneosNearlyEqual(a, b) {
    return Math.abs((a ?? 0) - (b ?? 0)) < BeneosUtility.BENEOS_RENDER_EPSILON
  }

  static beneosRenderStamp(profile) {
    return { scaleX: profile.scale, anchorX: profile.anchorX, anchorY: profile.anchorY }
  }

  // true = unveraendert seit unserem letzten Schreiben, false = vom
  // Anwender angepasst, null = noch nie gestempelt (Alt-Bestand).
  static beneosRenderStampMatches(doc, texture) {
    const stamp = doc?.getFlag?.(BeneosUtility.moduleID(), "renderStamp")
    if (!stamp) return null
    return BeneosUtility.beneosNearlyEqual(texture?.scaleX, stamp.scaleX)
      && BeneosUtility.beneosNearlyEqual(texture?.anchorX, stamp.anchorX)
      && BeneosUtility.beneosNearlyEqual(texture?.anchorY, stamp.anchorY)
  }

  static beneosRenderInSync(texture, profile) {
    return BeneosUtility.beneosNearlyEqual(texture?.scaleX, profile.scale)
      && BeneosUtility.beneosNearlyEqual(texture?.scaleY, profile.scale)
      && BeneosUtility.beneosNearlyEqual(texture?.anchorX, profile.anchorX)
      && BeneosUtility.beneosNearlyEqual(texture?.anchorY, profile.anchorY)
  }

  /********************************************************************************** */
  // Ein Token-Update gegen sein Flag-Profil bauen, oder null wenn nichts
  // zu tun ist. Gibt das Update-Objekt zurueck statt selbst zu schreiben,
  // damit der Szenen-Sync alle Tokens in einem einzigen
  // updateEmbeddedDocuments buendeln kann.
  static beneosRenderUpdateFor(tokenDoc, { respectStamp = true } = {}) {
    if (!tokenDoc) return null
    const actor = tokenDoc.actor
    if (!BeneosUtility.isBeneosCreature(actor)) return null
    const texture = tokenDoc.texture
    if (!texture?.src) return null
    const profile = BeneosUtility.getBeneosRenderProfile(actor, texture.src)
    const stampKey = `flags.${BeneosUtility.moduleID()}.renderStamp`
    const stampState = BeneosUtility.beneosRenderStampMatches(tokenDoc, texture)

    if (BeneosUtility.beneosRenderInSync(texture, profile)) {
      // Werte stimmen bereits. Fehlt aber der Stempel, waere eine
      // spaetere manuelle Anpassung nicht mehr von unserem eigenen Wert
      // zu unterscheiden, also einmalig nachtragen.
      if (stampState !== null) return null
      return { _id: tokenDoc.id, [stampKey]: BeneosUtility.beneosRenderStamp(profile) }
    }

    if (respectStamp && stampState === false) {
      BeneosUtility.debugMessage("[Beneos Render] manual override kept for", tokenDoc.name)
      return null
    }

    return {
      _id: tokenDoc.id,
      ...BeneosUtility.beneosRenderPatch(profile),
      [stampKey]: BeneosUtility.beneosRenderStamp(profile)
    }
  }

  /********************************************************************************** */
  // Szenen-Sync: zieht jeden platzierten Beneos-Token auf Scale und
  // Anchor aus seinen Flags. Laeuft beim Szenenwechsel, damit auch
  // laengst platzierte Kreaturen die Werte bekommen. Genau ein Client
  // schreibt (beneosIsTokenWriter), sonst wuerden Spieler-Clients
  // Permission-Fehler werfen und mehrere GMs doppelt schreiben.
  static async syncSceneRenderProfiles(scene) {
    const target = scene || canvas?.scene
    if (!target) return 0
    const updates = []
    const actorIds = new Set()
    for (const tokenDoc of target.tokens) {
      if (!BeneosUtility.beneosIsTokenWriter(tokenDoc)) continue
      const update = BeneosUtility.beneosRenderUpdateFor(tokenDoc)
      if (!update) continue
      updates.push(update)
      if (tokenDoc.actorId) actorIds.add(tokenDoc.actorId)
    }
    if (updates.length) {
      try {
        await target.updateEmbeddedDocuments("Token", updates, { beneosRenderSync: true })
        BeneosUtility.debugMessage(
          `[Beneos Render] synced ${updates.length} token(s) on "${target.name}"`)
      } catch (err) {
        console.warn("[Beneos] scene render-sync failed", err)
      }
    }
    // Prototype mitziehen, damit kuenftige Drag-and-Drops die richtigen
    // Werte direkt erben statt nachtraeglich korrigiert zu werden.
    for (const actorId of actorIds) {
      await BeneosUtility.syncActorPrototypeRenderProfile(game.actors.get(actorId))
    }
    return updates.length
  }

  /********************************************************************************** */
  // Prototype-Reparatur. Dieselbe Stempel-Regel wie beim Token: ein vom
  // Anwender bewusst gesetzter Prototype-Scale bleibt stehen.
  // Stage 13d-13: requireBeneosCreature ist optional geworden. Der Standard
  // bleibt streng, damit der Szenen-Sync und alle Endkunden-Pfade unveraendert
  // arbeiten. Nur das dev-Tool setzt ihn auf false, wenn es eine Kreatur
  // justiert, die noch nicht registriert ist. Ein Nachbau dieser Funktion dort
  // waere gefaehrlicher als die Option: die Stempel-Regel unten
  // (null = nie gestempelt, false = bewusster Anwender-Override, true = unser
  // Wert) ist der einzige Teil, dessen falsche Kopie still Kundendaten
  // ueberschreibt.
  static async syncActorPrototypeRenderProfile(actor, { requireBeneosCreature = true } = {}) {
    if (!actor) return false
    if (requireBeneosCreature && !BeneosUtility.isBeneosCreature(actor)) return false
    if (!actor.canUserModify?.(game.user, "update")) return false
    const texture = actor.prototypeToken?.texture
    if (!texture?.src) return false
    const profile = BeneosUtility.getBeneosRenderProfile(actor, texture.src)
    const stampState = BeneosUtility.beneosRenderStampMatches(actor, texture)
    if (BeneosUtility.beneosRenderInSync(texture, profile)) {
      if (stampState !== null) return false
      try {
        await actor.setFlag(BeneosUtility.moduleID(), "renderStamp",
          BeneosUtility.beneosRenderStamp(profile))
      } catch (err) {
        console.warn("[Beneos] prototype stamp failed", err)
      }
      return false
    }
    if (stampState === false) {
      BeneosUtility.debugMessage("[Beneos Render] manual prototype override kept for", actor.name)
      return false
    }
    try {
      await actor.update({
        ...BeneosUtility.beneosRenderPatch(profile, "prototypeToken.texture"),
        [`flags.${BeneosUtility.moduleID()}.renderStamp`]: BeneosUtility.beneosRenderStamp(profile)
      }, { beneosRenderSync: true })
      BeneosUtility.debugMessage("[Beneos Render] prototype repaired for", actor.name, profile)
      return true
    } catch (err) {
      console.warn("[Beneos] prototype render-sync failed", err)
      return false
    }
  }

  /********************************************************************************** */
  // Stage 13d-9: console-helper to write the per-mode anchor flags.
  // Example:
  //   const a = game.actors.getName("MyDragon")
  //   await BeneosUtility.setBeneosCreatureAnchor(a, "topdown", 0.5, 0.5)
  //   await BeneosUtility.setBeneosCreatureAnchor(a, "tokenized", 0.5, 0.7)
  static async setBeneosCreatureAnchor(actor, mode, x, y) {
    if (!actor) {
      ui.notifications?.error("Beneos: setBeneosCreatureAnchor needs an actor")
      return
    }
    if (typeof x !== "number" || typeof y !== "number"
        || !isFinite(x) || !isFinite(y)) {
      ui.notifications?.error(`Beneos: anchor must be numeric (got x=${x} y=${y})`)
      return
    }
    const beneosFlag = actor.getFlag("world", "beneos") || {}
    const rendering = beneosFlag.rendering || {}
    if (mode === "topdown") {
      rendering.topDownAnchorX = x
      rendering.topDownAnchorY = y
    } else {
      rendering.tokenizedAnchorX = x
      rendering.tokenizedAnchorY = y
    }
    await actor.setFlag("world", "beneos", { ...beneosFlag, rendering })
  }

  /********************************************************************************** */
  // Stage 13a: Console-Helper for designers / QA. Writes the per-token
  // scale flag without forcing the user to compose nested-spread
  // setFlag-calls by hand. Example:
  //   const a = game.actors.getName("MyTestCreature")
  //   await BeneosUtility.setBeneosCreatureScale(a, "topdown", 1.6)
  // Idempotent: re-calling with the same value is a no-op write but
  // doesn't fail. Mode "topdown" → topDownScale; anything else →
  // tokenizedScale. Defensive validation surfaces a user-readable
  // notification on invalid input.
  static async setBeneosCreatureScale(actor, mode, value) {
    if (!actor) {
      ui.notifications?.warn("Beneos: setBeneosCreatureScale needs an actor")
      return
    }
    if (typeof value !== "number" || !(value > 0)) {
      ui.notifications?.warn("Beneos: scale value must be a positive number")
      return
    }
    const existing = actor.getFlag("world", "beneos") || {}
    const rendering = { ...(existing.rendering || {}) }
    if (mode === "topdown") rendering.topDownScale = value
    else rendering.tokenizedScale = value
    await actor.setFlag("world", "beneos", { ...existing, rendering })
    ui.notifications?.info(`Beneos: ${mode === "topdown" ? "Top-Down" : "2.5D"} scale set to ${value} for ${actor.name}`)
  }

  /********************************************************************************** */
  // Stage 6: mode-aware scale. 2.5D tokens use the prototype's
  // baked-in 1.1 (matches the Beneos JSON); Top-Down tokens need 1.25
  // for proper coverage. When `mode` isn't passed, derive it from the
  // current texture src so callers that already swap the texture
  // before calling don't need to pass it explicitly.
  // Stage 13a: delegates to getBeneosScale once mode is resolved, so
  // per-token Flag-Overrides take precedence over the constants.
  // Nur noch Kompatibilitaets-Shim: die Aufrufer im Modul gehen ueber
  // getBeneosRenderProfile, das Scale und Anchor gemeinsam aufloest.
  // Bleibt fuer Console-Nutzung und Fremdaufrufer erhalten.
  static getScaleFactor(token, newImage = undefined, mode) {
    // Stage 13d-10: hoist probeSrc out of the mode-derivation branch
    // so the variant-aware getBeneosScale call below can always see
    // the texture path (e.g. `-2-top.webp` → variant "2"), even when
    // the caller passed `mode` explicitly.
    let probeSrc = ""
    if (typeof newImage === "string") probeSrc = newImage
    else probeSrc = token?.document?.texture?.src || ""
    if (mode === undefined) {
      mode = probeSrc.includes("-top.webp") ? "topdown" : "tokenized"
    }
    return BeneosUtility.getBeneosScale(token?.actor ?? null, mode, probeSrc)
  }

  /********************************************************************************** */
  static changeVariant(fullId) {
    let tokenData = BeneosUtility.getTokenDataFromKey(fullId)
    if (!tokenData) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Config not found changeVariant " + fullId)
      return
    }
    let token = canvas.tokens.placeables.find(t => t.id == tokenData.currentTokenId)
    if (!token) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Token not found changeVariant " + fullId)
      return
    }
    this.forceChangeToken(token.id, fullId)
  }

  /********************************************************************************** */
  static async forceChangeToken(tokenid, fullKey) {
    let token = BeneosUtility.getToken(tokenid)
    if (token === null || token == undefined) {
      return
    }
    // Manual HUD action: only the acting user runs it, so gate on THEIR rights
    // (not the GM-writer, which would block an owning player's own click). Shows
    // a friendly note instead of a red core error if they lack update rights.
    if (!token.document.canUserModify(game.user, "update")) {
      ui.notifications?.warn(game.i18n.localize("BENEOS.TokenSwitchNoPermission"))
      return
    }
    let tokenData = BeneosUtility.getTokenDataFromKey(fullKey)
    if (!tokenData) return
    // Stage 5/6: mode-preserving variant switch. If the placed token
    // is currently in top-down mode (texture.src ends in -top.webp),
    // jump to the requested variant's top-down image. Stage 6 adds a
    // derived-path fallback for legacy installs whose cache has no
    // explicit topDown entry — same string-replace pattern used
    // elsewhere in the codebase.
    const currentSrc = token.document?.texture?.src || ""
    const isTopDownMode = currentSrc.includes("-top.webp")
    const newImage = isTopDownMode
      ? (BeneosUtility.beneosDerivedTopPath(tokenData) || tokenData.token)
      : tokenData.token
    // Scale und Anchor kommen aus dem Ziel-Bild: sein Suffix entscheidet
    // den Modus (-top.webp = topdown, sonst tokenized) und seine
    // Variantennummer entscheidet, welcher Flag-Eintrag gewinnt.
    const profile = BeneosUtility.getBeneosRenderProfile(token.actor, newImage)
    //BeneosUtility.debugMessage(">>>>>>>>>>> UPDATE TOKEN CHANGE", fullKey, tokenData, newImage)
    try {
      await token.document.setFlag(BeneosUtility.moduleID(), "fullKey", tokenData.fullId)
      // Hier stand zuvor ein zweiter Update-Aufruf mit { img, scale,
      // rotation: 1.0 }. `img` und `scale` sind V9-Felder und verpufften,
      // `rotation: 1.0` drehte den Token aber bei jedem Variantenwechsel
      // tatsaechlich um 1 Grad. Der kanonische texture.*-Update unten
      // traegt alles Noetige.
      await token.document.update({
        "texture.src": newImage,
        ...BeneosUtility.beneosRenderPatch(profile),
        [`flags.${BeneosUtility.moduleID()}.renderStamp`]: BeneosUtility.beneosRenderStamp(profile)
      }, { beneosRenderSync: true })
    } catch (err) {
      console.warn("[Beneos] forceChangeToken: token.document update failed", err)
      ui.notifications?.error(`Beneos: token swap failed (${err?.message || "unknown"})`)
      return
    }
    // Hier folgte ein Update auf `token.img` fuer Actors vom Typ
    // "character". Auch das ist V9-Schema, das V13 verwirft, der Block
    // war also seit Jahren wirkungslos. Ersatzlos entfernt und bewusst
    // nicht nachgebaut: anders als der Stilwechsel darf ein
    // Variantenwechsel den Prototype gar nicht mitziehen, denn im
    // Beneos-Modell ist jede Variante ein eigener Actor
    // (siehe getActorIdVariant). Der Wechsel gilt nur fuer den einen
    // angeklickten Token auf der Canvas.
    return
  }

  /********************************************************************************** */
  // Top-Down Stage 6: per-mode scale constants. 2.5D tokens use the
  // baked-in JSON prototype scale of 1.1; Top-Down tokens need 1.25
  // for proper canvas-cell coverage. Used by every style-swap site
  // (forceChangeToken, toggleTokenStyle, preCreateToken hook,
  // importTokenToCompendium install-fork) so the scale moves with
  // the texture.
  static BENEOS_SCALE_TOKENIZED = 1.1
  static BENEOS_SCALE_TOPDOWN = 1.25

  /********************************************************************************** */
  // Top-Down Stage 6: derive the top-down companion path of a 2.5D
  // token asset by string replacement. Works even when the cache
  // doesn't have an explicit `topDown` entry (legacy installs
  // predating Stage 1, or local file drops without cloud pipeline).
  // Returns null if no derivation is possible.
  static beneosDerivedTopPath(value) {
    if (!value) return null
    if (value.topDown) return value.topDown
    if (value.token && value.token.includes("-token.webp")) {
      return value.token.replace("-token.webp", "-top.webp")
    }
    return null
  }

  /********************************************************************************** */
  // Top-Down Stage 3: filesystem-truth check. The Stage-1 cache
  // (BeneosUtility.beneosTokens[fullId].topDown) only reflects what
  // the cloud delivered at install time — manual file drops, legacy
  // installs, or backend-not-yet-patched scenarios all produce false
  // negatives. The actual disk presence is the only reliable signal,
  // so the HUD button and the toggle method both probe the file
  // server with a HEAD request.
  static async beneosTopVariantExists(prototypeSrc) {
    if (!prototypeSrc) return false
    let candidate = null
    if (prototypeSrc.includes("-token.webp")) {
      candidate = prototypeSrc.replace("-token.webp", "-top.webp")
    } else if (prototypeSrc.includes("-top.webp")) {
      candidate = prototypeSrc.replace("-top.webp", "-token.webp")
    } else {
      return false
    }
    try {
      const url = candidate.startsWith("/") ? candidate : `/${candidate}`
      const res = await fetch(url, { method: "HEAD" })
      return res.ok
    } catch (e) { return false }
  }

  /********************************************************************************** */
  // Top-Down Stage 2: flip an installed token's prototypeToken-texture
  // between -token.webp (2.5D) and -top.webp (Top-Down). Per Stage-2
  // contract: prototype only, scene placements stay frozen.
  // Stage 3: cache-check dropped — HUD-button gating already filters
  // unavailable styles; this method keeps a defensive last-mile FS
  // check for the race-condition where the file vanishes between
  // HUD render and click.
  static async toggleTokenStyle(tokenid) {
    const token = BeneosUtility.getToken(tokenid)
    if (!token) return
    const actor = token.actor
    if (!actor) return
    // Manual HUD action: gate on the acting user's own rights so a missing
    // permission shows a friendly note instead of a red core error.
    if (!token.document.canUserModify(game.user, "update")) {
      ui.notifications?.warn(game.i18n.localize("BENEOS.TokenSwitchNoPermission"))
      return
    }
    // Stage 8: source-of-truth is the placed token's own texture.src.
    // Stage 7's actor.prototypeToken.texture.src was the synthetic
    // delta-actor property for unlinked tokens, which could go stale
    // after a partially-failed actor.update — leading to a no-op
    // toggle and the user-reported "second click does nothing".
    const currentSrc = token.document?.texture?.src || ""
    let newSrc = null
    let newStyle = null
    if (currentSrc.includes("-token.webp")) {
      newSrc = currentSrc.replace("-token.webp", "-top.webp")
      newStyle = "topdown"
    } else if (currentSrc.includes("-top.webp")) {
      newSrc = currentSrc.replace("-top.webp", "-token.webp")
      newStyle = "tokenized"
    }
    if (!newSrc) {
      ui.notifications?.warn(game.i18n.localize("BENEOS.TokenMenu.StyleNotApplicable")
        || "Beneos: token has no recognizable variant suffix")
      return
    }

    // Stage 8: HUD-button gating in beneos_module.js (renderTokenHUD)
    // already checks file existence before rendering the toggle button.
    // The Stage-3 last-mile FS-check here was a redundant guard that
    // could fail on cached HEAD responses, silently aborting the swap.
    // Removed.

    // Stage 4/6/7: visible swap on canvas — placed token first, then
    // propagate to the actor's prototype for re-placement consistency.
    // Stage 8: isolate the two updates so a prototype-update failure
    // (e.g., delta-actor on an unlinked token) doesn't abort the
    // user-visible canvas swap.
    // Stage 13a: scale resolves via the per-token flag-aware helper;
    // creatures with custom rendering.{topDown,tokenized}Scale flags
    // get those values, others fall back to the BENEOS_SCALE_*
    // constants.
    // Stage 13d-10: newSrc carries the variant suffix, so the resolver
    // can look up per-variant scale/anchor in flags.world.beneos.rendering.variants.
    // Token und Prototype teilen sich dasselbe Profil, damit die beiden
    // nach dem Wechsel garantiert nicht auseinanderlaufen.
    const profile = BeneosUtility.getBeneosRenderProfile(actor, newSrc)
    const stampKey = `flags.${BeneosUtility.moduleID()}.renderStamp`
    const stamp = BeneosUtility.beneosRenderStamp(profile)

    try {
      await token.document.update({
        "texture.src": newSrc,
        ...BeneosUtility.beneosRenderPatch(profile),
        [stampKey]: stamp
      }, { beneosRenderSync: true })
    } catch (err) {
      console.warn("[Beneos] toggleTokenStyle: token.document.update failed", err)
      ui.notifications?.error(`Beneos: token swap failed (${err?.message || "unknown"})`)
      return
    }

    // Der Prototype gehoert dem WELT-Actor. Beneos-Tokens sind unlinked,
    // `token.actor` ist deshalb der synthetische Delta-Actor, und ein
    // prototypeToken-Update darauf landete im Delta des platzierten
    // Tokens statt beim Actor. Der Prototype blieb dadurch stumm auf dem
    // alten Stil stehen, und jede spaeter abgelegte Kopie kam wieder im
    // alten Modus auf die Canvas. Aufloesung ueber actorId, genauso wie
    // es der Creator-Mode-Hook macht.
    const worldActor = token.document.actorId
      ? game.actors.get(token.document.actorId)
      : null
    try {
      await (worldActor ?? actor).update({
        "prototypeToken.texture.src": newSrc,
        ...BeneosUtility.beneosRenderPatch(profile, "prototypeToken.texture"),
        [stampKey]: stamp
      }, { beneosRenderSync: true })
    } catch (err) {
      console.warn("[Beneos] toggleTokenStyle: actor.update failed (prototype out of sync)", err)
    }

    const msgKey = newStyle === "topdown"
      ? "BENEOS.TokenMenu.StyleSwitchedTopDown"
      : "BENEOS.TokenMenu.StyleSwitchedTokenized"
    ui.notifications?.info(game.i18n.localize(msgKey)
      || `Beneos: switched to ${newStyle === "topdown" ? "Top-Down" : "2.5D"}`)

    // Stage 8: refresh the Token-HUD so the style-toggle button's icon
    // (down-arrow ↔ circle) immediately reflects the new direction
    // without forcing the user to close+reopen the HUD.
    try {
      if (canvas?.hud?.token?.rendered) {
        canvas.hud.token.render(true)
      }
    } catch (err) {
      console.warn("[Beneos] HUD re-render failed", err)
    }
  }

  /********************************************************************************** */
  // Main function that allows to control the automatic animations and decide which animations has to be shown.
  static updateToken(tokenid, BeneosExtraData) {

    let token = BeneosUtility.getToken(tokenid)
    if (!token || !BeneosUtility.checkIsBeneosToken(token) || !token.document.texture.src) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Not Beneos/No image")
      return
    }

    // Only the single privileged writer (active GM, else one owner client)
    // performs the persisted FX mutations below. Every other client returns
    // here, which stops the "lacks permission to update Token" errors that
    // fired on player clients whenever a Beneos creature reached 0 HP.
    if (!BeneosUtility.beneosIsTokenWriter(token.document)) {
      return
    }

    let actorData = token.actor
    if (!actorData || actorData.flags.world.beneos == undefined) {
      return
    }
    let fullKey = actorData.flags.world.beneos.fullId
    let myToken = BeneosUtility.getTokenDataFromKey(fullKey)
    if (!myToken) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Config not found " + fullKey)
      return
    }

    let attributes = actorData.system.attributes
    if (!attributes) {
      BeneosUtility.debugMessage("[BENEOS MODULE] No attributes", actorData)
      return
    }
    BeneosUtility.debugMessage("Token HP value", fullKey, myToken)
    let hp = attributes.hp.value
    let benRotation = 0
    let benAlpha = 1
    if (!game.dnd5e || hp == undefined) {
      BeneosUtility.debugMessage("[BENEOS MODULE] No hp")
      return
    }

    // Check if the beneos-death-management settings is set to true
    let deathManagement = game.settings.get(BeneosUtility.moduleID(), 'beneos-death-management')
    if (!deathManagement) {
      BeneosUtility.beneosHealth[token.id] = hp // Store current HP value anyway
      return
    }

    if (hp == 0 && hp != BeneosUtility.beneosHealth[token.id]) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Dead")
      token.state = "dead"
      // TODO : apply grey FX ?
      BeneosUtility.applyDeadFX(token)
    }
    if (BeneosUtility.beneosHealth[token.id] == 0 && hp > 0) {
      BeneosUtility.debugMessage("[BENEOS MODULE] Standing")
      token.state = "standing"
      if (typeof TokenMagic !== 'undefined') {
        TokenMagic.deleteFilters(token);
      }
    }
    BeneosUtility.beneosHealth[token.id] = hp // Store current HP value
  }

  /********************************************************************************** */
  // Function to force update the renewal of beneos tokens in a scene.
  static updateSceneTokens() {
    for (let i in canvas.tokens.placeables) {
      let token = canvas.tokens.placeables[i];
      if (token !== undefined && ("id" in token)) {
        this.preloadToken(token)
        BeneosUtility.debugMessage("[BENEOS MODULE] Force updating " + token.id)
        /*this.updateToken(token.id, "standing", { forceupdate: true })*/
      }
    }
  }

  /********************************************************************************** */
  static checkLockViewPresence() {
    let lv = game.modules.get("LockView")
    if (lv?.active) {
      ui.notifications.warn(game.i18n.localize("BENEOS.Notifications.Utility.LockViewIncompatible"))
      return true
    }
  }

  /********************************************************************************** */
  static processCanvasReady() {
    for (let [key, token] of canvas.scene.tokens.entries()) {
      if (BeneosUtility.checkIsBeneosToken(token)) {
        let tokenData = BeneosUtility.getTokenImageInfo(token.texture.src)
        let tokenConfig = this.beneosTokens[tokenData.fullKey]
        if (typeof tokenConfig === 'object' && tokenConfig) {
          BeneosUtility.updateToken(token.id, {})
        }
      }
    }
    // Laengst platzierte Kreaturen auf Scale und Anchor aus ihren Flags
    // ziehen. Bewusst nicht awaited: der Szenenaufbau soll nicht auf die
    // Datenbankschreibvorgaenge warten.
    BeneosUtility.syncSceneRenderProfiles(canvas.scene)
      .catch(err => console.warn("[Beneos] canvasReady render-sync failed", err))
  }

  /* -------------------------------------------- */
  static sortArrayObjectsByName(myArray) {
    myArray.sort((a, b) => {
      let fa = a.actorName?.toLowerCase() || "";
      let fb = b.actorName?.toLowerCase() || "";
      if (fa < fb) {
        return -1;
      }
      if (fa > fb) {
        return 1;
      }
      return 0;
    })
  }

  /* -------------------------------------------- */
  static hasVariants(tokenConfig) {
    let tokenKey = tokenConfig?.tokenKey
    if (!tokenKey) {
      BeneosUtility.debugMessage("[BENEOS MODULE] No tokenKey found in tokenConfig", tokenConfig)
      return false
    }
    let variants = false
    Object.entries(BeneosUtility.beneosTokens).forEach(([key, value]) => {
      if (value.tokenKey == tokenKey && value.fullId != tokenConfig.fullId) {
        variants = true
      }
    })
    return variants
  }

  /********************************************************************************** */
  // Stage 5: mode-aware variant list. When the placed token is in
  // top-down mode, the HUD lists OTHER variants as their top-down
  // images. Falls back to .token (2.5D) if the cache entry doesn't
  // have a topDown path (legacy installs predating Stage 1).
  static getVariants(tokenConfig, mode = "tokenized") {
    let tokenKey = tokenConfig?.tokenKey
    if (!tokenKey) {
      BeneosUtility.debugMessage("[BENEOS MODULE] No tokenKey found in tokenConfig", tokenConfig)
      return []
    }
    let variants = []
    Object.entries(BeneosUtility.beneosTokens).forEach(([key, value]) => {
      if (value.tokenKey == tokenKey && value.fullId != tokenConfig.fullId) {
        let number = value.number || ""
        // Stage 6: derived-path fallback covers legacy installs whose
        // cache lacks an explicit topDown entry. The browser will load
        // the derived URL if the file exists; if not, the HUD shows a
        // broken thumbnail (acceptable defensive — no crash).
        const img = (mode === "topdown")
          ? (BeneosUtility.beneosDerivedTopPath(value) || value.token)
          : value.token
        variants.push({ "display_name": value.actorName + " " + number, "img": img, "name": key, fullId: value.fullId })
      }
    })
    return variants
  }

  /********************************************************************************** */
  static buildAvailableTokensMenu() {
    let beneosTokensHUD = []

    Object.entries(BeneosUtility.beneosTokens).forEach(([key, value]) => {
      if (value?.actorName && value?.actorId) {
        beneosTokensHUD.push({
          "fullKey": key, //BeneosUtility.getBasePath() + BeneosUtility.getBeneosTokenDataPath() + "/" + key + '/' + key + "-idle_face_still.webp",
          "img": value.avatar,
          "actorId": value.actorId,
          "actorName": value.actorName
        })
      } else {
        ui.notifications.warn(game.i18n.format("BENEOS.Notifications.Utility.ActorNotFound", { key }))
      }
    })
    this.sortArrayObjectsByName(beneosTokensHUD)
    //BeneosUtility.debugMessage("Beneos Tokens HUD", beneosTokensHUD)
    return beneosTokensHUD
  }

  /********************************************************************************** */
  static async buildAvailableTokensMenuHTML(template, beneosTokensHUD) {
    const beneosTokensDisplay = await renderTemplate('modules/beneos-module/templates/' + template,
      { beneosTokensHUD })

    return beneosTokensDisplay
  }

  /********************************************************************************** */
  static manageAvailableTokensMenu(token, html, event) {
    let beneosClickedButton = event.target.parentElement
    let beneosTokenButton = html.find('.beneos-token-hud-action')[0]

    if (beneosClickedButton === beneosTokenButton) {
      beneosTokenButton.classList.add('active')
      html.find('.beneos-selector-wrap')[0].classList.add('beneos-active')
      html.find('.beneos-selector-wrap')[0].classList.remove('beneos-disabled')
    } else {
      beneosTokenButton.classList.remove('active')
      html.find('.beneos-selector-wrap')[0].classList.remove('beneos-active')
      html.find('.beneos-selector-wrap')[0].classList.add('beneos-disabled')
      if (beneosClickedButton.classList.contains("beneos-button-token")) {
        event.preventDefault()
        let fullKey = beneosClickedButton.dataset.fullkey
        setTimeout(function () {
          BeneosUtility.forceChangeToken(token.id, fullKey)
        }, 200)
      }
    }
  }

  /********************************************************************************** */
  static async saveJSONConfig(fullKey) {
    let tokenConfig = this.beneosTokens[fullKey]
    if (tokenConfig) {
      let jsonData = {}
      jsonData[fullKey] = {
        config: structuredClone(tokenConfig.config),
        top: structuredClone(tokenConfig.top)
      }
      let json = JSON.stringify(jsonData)
      saveDataToFile(json, "text/json", tokenConfig.JSONFilePath)
    }
  }

  /********************************************************************************** */
  // Build a Foundry V12+ compendium UUID. The legacy V11 form
  // "Compendium.<pack>.<id>" no longer resolves; Foundry now requires the
  // document-type segment between pack and id.
  static buildCompendiumUuid(packName, docType, id) {
    if (!packName || !docType || !id) return null
    return `Compendium.${packName}.${docType}.${id}`
  }

  // Compendium pack-name + doc-type for a Beneos search-engine docType.
  // Spells live in the items collection (5e treats spells as Items), so the
  // compendium document type is "Item" — only the pack differs.
  static getBeneosCompendiumTarget(docType) {
    if (docType === "Actor") return { pack: "world.beneos_module_actors", compendiumDocType: "Actor", worldCollection: "actors" }
    if (docType === "Item")  return { pack: "world.beneos_module_items",  compendiumDocType: "Item",  worldCollection: "items"  }
    if (docType === "Spell") return { pack: "world.beneos_module_spells", compendiumDocType: "Item",  worldCollection: "items"  }
    return null
  }

  // Resolve an installed Beneos asset to a drag-data payload that Foundry V13
  // can consume. Lookup chain:
  //   1) World-doc with matching flag (world.beneos.tokenKey / itemKey /
  //      spellKey) — preferred so Foundry doesn't clone a duplicate world
  //      copy on drop (Wave B-1d local-drag).
  //   2) Compendium index entry by the cached compendium id, emitted as a
  //      proper V12+ compendium UUID. Used when the world copy was deleted
  //      or never created (install-all mode skips world imports beyond the
  //      first variant).
  // Returns { type, uuid, pack? } or null for orphan assets (cache says
  // installed but neither world doc nor compendium entry exists).
  static resolveBeneosDragData(docType, key) {
    const target = BeneosUtility.getBeneosCompendiumTarget(docType)
    if (!target) return null

    const flagField = docType === "Actor" ? "tokenKey"
                    : docType === "Item"  ? "itemKey"
                    : docType === "Spell" ? "spellKey"
                    : null
    const collection = game[target.worldCollection]
    if (collection && flagField) {
      const worldDoc = collection.find?.(d => {
        const flag = d.getFlag?.("world", "beneos")
        return flag?.[flagField] === key
      })
      if (worldDoc) {
        return { type: target.compendiumDocType, uuid: worldDoc.uuid }
      }
    }

    const cachedId = docType === "Actor" ? BeneosUtility.getActorId?.(key)
                   : docType === "Item"  ? BeneosUtility.getItemId?.(key)
                   : docType === "Spell" ? BeneosUtility.getSpellId?.(key)
                   : null
    if (cachedId) {
      const pack = game.packs.get(target.pack)
      if (pack && pack.index?.has?.(cachedId)) {
        const uuid = BeneosUtility.buildCompendiumUuid(target.pack, target.compendiumDocType, cachedId)
        return { type: target.compendiumDocType, pack: target.pack, uuid }
      }
    }

    return null
  }

  /********************************************************************************** */
  // Source-bucket detection for the folder-restructure layout. Mirrors
  // BeneosCloudWindowV2.#getNormalizedSource so import paths can sort
  // installed assets into "SRD" vs "Beneos Originals" without coupling to
  // the V2 window. Buckets returned: "SRD" | "Patreon" | "Webshop" | "Loyalty".
  static SRD_KEY_RE = /(?:^|[-_])srd[-_]/i
  static getSourceBucket(data, assetType, key) {
    const k = typeof key === "string" ? key : ""
    const isKeySrd     = BeneosUtility.SRD_KEY_RE.test(k)
    const isKeyWebshop = !isKeySrd && k.startsWith("0000_")

    if (assetType === "token") {
      const explicit = data?.properties?.source
      if (explicit) return explicit
      if (isKeySrd) return "SRD"
      if (isKeyWebshop) return "Webshop"
      return "Patreon"
    }
    if (assetType === "item") {
      const origin = String(data?.properties?.origin || "").toLowerCase()
      if (origin === "srd" || isKeySrd) return "SRD"
      if (isKeyWebshop) return "Webshop"
      return "Patreon"
    }
    if (assetType === "spell") {
      if (isKeySrd) return "SRD"
      if (isKeyWebshop) return "Webshop"
      return "Patreon"
    }
    return "Patreon"
  }

  // Collapse the four raw buckets to the two folder buckets the user
  // wants surfaced: only SRD stays separate; everything else (Patreon,
  // Webshop, Loyalty) goes under "Beneos Originals".
  static getFolderBucket(rawBucket) {
    return rawBucket === "SRD" ? "SRD" : "Beneos Originals"
  }

  // CR -> folder-friendly label. Fractional CRs get "CR 1/8|1/4|1/2";
  // integers get "CR <n>". Missing/invalid input -> "CR ?".
  static formatCrFolder(cr) {
    if (cr === undefined || cr === null || cr === "") return "CR ?"
    const n = Number(cr)
    if (!Number.isFinite(n)) return "CR ?"
    if (n === 0) return "CR 0"
    if (Math.abs(n - 0.125) < 1e-6) return "CR 1/8"
    if (Math.abs(n - 0.25)  < 1e-6) return "CR 1/4"
    if (Math.abs(n - 0.5)   < 1e-6) return "CR 1/2"
    if (Number.isInteger(n)) return `CR ${n}`
    return `CR ${n}`
  }

  // Walk a folder-segment array (root first) and create missing folders,
  // returning the leaf Folder. Two scopes:
  //   layer = { type: "Actor"|"Item", scope: "world" }
  //   layer = { type: "Actor"|"Item", scope: "compendium", pack: "<pack-name>" }
  // Compendium folders use V11+ in-pack folders (Folder with `pack` option).
  static async ensureBeneosFolderPath(layer, segments) {
    if (!Array.isArray(segments) || segments.length === 0) return null
    const cleanSegments = segments
      .filter(s => s && typeof s === "string")
      .map(s => s.trim())
      .filter(Boolean)
    if (!cleanSegments.length) return null

    if (layer.scope === "world") {
      let parent = null
      for (const name of cleanSegments) {
        const existing = game.folders.find(f =>
          f.name === name &&
          f.type === layer.type &&
          (f.folder?.id ?? null) === (parent?.id ?? null)
        )
        if (existing) { parent = existing; continue }
        parent = await Folder.create({
          name,
          type: layer.type,
          folder: parent?.id ?? null
        })
      }
      return parent
    }

    if (layer.scope === "compendium") {
      const pack = game.packs.get(layer.pack)
      if (!pack) return null
      let parent = null
      for (const name of cleanSegments) {
        const existing = pack.folders.find(f =>
          f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null)
        )
        if (existing) { parent = existing; continue }
        parent = await Folder.create({
          name,
          type: layer.type,
          folder: parent?.id ?? null
        }, { pack: layer.pack })
      }
      return parent
    }

    return null
  }
}
