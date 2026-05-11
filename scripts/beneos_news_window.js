import { BeneosUtility } from "./beneos_utility.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BeneosNewsWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "beneos-news-window",
    classes: ["beneos-news-window", "beneos_module"],
    tag: "section",
    window: {
      title: "BENEOS.News.Title",
      icon: "fas fa-newspaper",
      resizable: true,
      minimizable: true
    },
    position: { width: 640, height: "auto" },
    actions: {
      closeNews: BeneosNewsWindow._onCloseNews
    }
  }

  static PARTS = {
    body: { template: "modules/beneos-module/templates/beneos-news-window.hbs" }
  }

  constructor({ newsData, sanitizedHtml } = {}, options = {}) {
    super(options);
    this.newsData = newsData;
    this.sanitizedHtml = sanitizedHtml;
  }

  async _prepareContext() {
    return {
      content: this.sanitizedHtml ?? "",
      dateLabel: game.i18n.localize("BENEOS.News.Date"),
      formattedDate: this.newsData?.created_at
        ? new Date(this.newsData.created_at).toLocaleDateString()
        : "",
      closeLabel: game.i18n.localize("BENEOS.News.Close")
    };
  }

  // Persist the dedup ID on every close path (X button, ESC, custom button).
  async _preClose(options) {
    if (this.newsData?.id) {
      try {
        await game.settings.set(BeneosUtility.moduleID(), "beneos-cloud-latest-news-id", this.newsData.id);
      } catch (e) {
        console.warn("[Beneos News] Failed to persist last-news-id:", e);
      }
    }
    return super._preClose(options);
  }

  static _onCloseNews(_event, _target) {
    this.close();
  }
}
