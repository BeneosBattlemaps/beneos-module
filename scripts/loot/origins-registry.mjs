import { BeneosUtility } from "../beneos_utility.js";

// Loader for _itemorigins/origins.json, the canonical source of the 19 Beneos
// Origins (slug, display_name, lore, icons, tier rules) plus the shared
// mechanic_rules block (Generic-vs-Named, Rarity Modifier, Dormant/Grandeur,
// Ritual of Ascension, Sensing Items). Path is resolved against the
// world-scoped "beneos-datapath" setting, so multi-machine setups stay portable.

const ORIGINS_FILE_REL = "_itemorigins/origins.json";

export class OriginsRegistry {

  static origins = {};
  static mechanicRules = {};
  static loaded = false;
  static sourceUrl = null;

  static async load() {
    // origins.json ships bundled with the module so the codex works without a
    // configured beneos-datapath. A user-data override is still honoured (for
    // shipping a newer schema alongside assets without a module update), but
    // only when the file is actually present. We confirm that via a directory
    // listing instead of a raw GET, so the common no-override case never fires
    // a 404 probe into the console.
    const moduleUrl = `modules/${BeneosUtility.moduleID()}/data/${ORIGINS_FILE_REL}`;
    const userUrl = await this.#resolveUserOverrideUrl();

    const candidates = userUrl ? [userUrl, moduleUrl] : [moduleUrl];

    let json = null;
    let lastErr = null;
    for (const url of candidates) {
      try {
        json = await foundry.utils.fetchJsonWithTimeout(url, {
          cache: "no-cache",
          method: "GET",
          "Content-Type": "application/json"
        });
        this.sourceUrl = url;
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (json) {
      this.origins = json?.origins ?? {};
      this.mechanicRules = json?.mechanic_rules ?? {};
      this.loaded = true;
      if (globalThis.BeneosUtility?.isDebug?.()) console.log(`Beneos | OriginsRegistry loaded ${Object.keys(this.origins).length} origins from ${this.sourceUrl}`);
    } else {
      this.origins = {};
      this.mechanicRules = {};
      this.loaded = false;
      console.warn(`Beneos | OriginsRegistry failed to load origins.json from any candidate (${candidates.join(", ")}):`, lastErr);
    }

    if (game.beneos) {
      game.beneos.origins = this.origins;
      game.beneos.originMechanicRules = this.mechanicRules;
      game.beneos.originsRegistry = this;
    }
  }

  /** Resolve the user-datapath override URL, but only when an origins.json
   *  actually exists there. Checked via a directory listing (GM-side; players
   *  always use the bundled copy, which is identical) so a missing override
   *  never produces a 404 in the console. Returns null when absent. */
  static async #resolveUserOverrideUrl() {
    if (!game.user?.isGM) return null;
    let datapath = null;
    try { datapath = game.settings.get(BeneosUtility.moduleID(), "beneos-datapath"); }
    catch (_) { return null; }
    if (!datapath) return null;
    try {
      const FP = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
      const listing = await FP.browse("data", `${datapath}/_itemorigins`);
      const hit = (listing?.files ?? []).find(f => f.split("?")[0].endsWith("origins.json"));
      return hit ?? null;
    } catch (_) {
      return null;
    }
  }

  static get(slug) {
    return this.origins?.[slug] ?? null;
  }

  static all() {
    return Object.values(this.origins ?? {});
  }

  // Resolve an Origin icon filename to a Foundry-loadable path.
  // Icons ship with the module (modules/beneos-module/icons/origin/) so they
  // stay available offline and can be extended without touching world data.
  // variant: "color" (default) or "bw".
  static iconPath(slug, variant = "color") {
    const origin = this.get(slug);
    if (!origin) return null;
    const filename = variant === "bw" ? origin.icon_filename_bw : origin.icon_filename;
    if (!filename) return null;
    return `modules/${BeneosUtility.moduleID()}/icons/origin/${filename}`;
  }
}
