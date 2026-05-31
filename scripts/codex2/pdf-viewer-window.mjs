// Beneos PDF Viewer — a Foundry-internal window that renders a locally
// installed creature PDF via the bundled pdfjs viewer in an iframe, so the
// stat block stays inside Foundry instead of opening a separate browser tab.

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE_ROOT = "modules/beneos-module/templates/codex2";

export class BeneosPdfViewer extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "beneos-pdf-viewer-{id}",
    classes: ["beneos-pdf-viewer"],
    tag: "div",
    window: { title: "PDF", icon: "fa-solid fa-file-pdf", resizable: true },
    position: { width: 860, height: 920, left: 180, top: 60 },
  };

  static PARTS = { main: { template: `${TEMPLATE_ROOT}/parts/pdf-viewer.hbs` } };

  _filePath = "";
  _title = "";

  static openForPdf(filePath, title = "") {
    if (!filePath) return null;
    const slug = String(filePath).replace(/[^a-z0-9]+/gi, "-");
    const id = `beneos-pdf-viewer-${slug}`;
    const existing = foundry.applications?.instances?.get?.(id);
    if (existing) { try { (existing.bringToFront ?? existing.bringToTop)?.call(existing); } catch (_) {} return existing; }
    const win = new BeneosPdfViewer({ id });
    win._filePath = filePath;
    win._title = title;
    win.render({ force: true });
    return win;
  }

  get title() {
    const label = game.i18n.localize("BENEOS.CreatureCodex.ViewPdf");
    return this._title ? `${label}: ${this._title}` : label;
  }

  async _prepareContext(_options) {
    const file = this._filePath.startsWith("/") ? this._filePath : `/${this._filePath}`;
    return { viewerSrc: `scripts/pdfjs/web/viewer.html?file=${encodeURIComponent(file)}` };
  }
}

export function openPdfViewer(filePath, title = "") {
  return BeneosPdfViewer.openForPdf(filePath, title);
}
