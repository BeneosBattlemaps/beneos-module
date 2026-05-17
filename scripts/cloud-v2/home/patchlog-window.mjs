/* Beneos Patchlog window — shows the most recent N changelog versions from
   the module's changelog.md. Opened from the small icon button in the
   News & Updates section header on the Home tab. Fixed-size window
   (680x600); body scrolls when content exceeds height (CSS handles that). */

import { loadAndParseChangelog } from "./changelog-parser.mjs"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

const FULL_CHANGELOG_URL = "https://github.com/BeneosBattlemaps/beneos-module/blob/main/changelog.md"

export class BeneosPatchlogWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-patchlog-window",
    classes: ["beneos-cloud-app", "beneos-patchlog-window", "beneos_module"],
    tag: "section",
    window: {
      title: "BENEOS.Cloud.Home.Patchlog.Title",
      icon: "fas fa-clipboard-list",
      resizable: true,
      minimizable: true
    },
    position: { width: 680, height: 600 },
    actions: {
      openExternalChangelog: BeneosPatchlogWindow._onOpenExternal
    }
  }

  static PARTS = {
    body: { template: "modules/beneos-module/templates/cloud-v2/home/patchlog-window.hbs" }
  }

  get title() {
    return game.i18n.localize("BENEOS.Cloud.Home.Patchlog.Title") || "Beneos Patch Log"
  }

  async _prepareContext() {
    const versions = await loadAndParseChangelog(2)
    return {
      versions,
      hasVersions: versions.length > 0,
      externalUrl: FULL_CHANGELOG_URL
    }
  }

  static _onOpenExternal(event, _target) {
    event.preventDefault()
    try { window.open(FULL_CHANGELOG_URL, "_blank", "noopener,noreferrer") }
    catch (err) { console.warn("[Beneos Patchlog] Failed to open external changelog:", err) }
  }
}
