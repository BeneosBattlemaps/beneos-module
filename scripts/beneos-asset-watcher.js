/**
 * Beneos Asset Watcher
 *
 * On canvasReady, collects every Beneos-owned asset path referenced by the
 * scene (background, foreground, tiles, tokens, notes) and verifies each one
 * via a HEAD fetch. If any are missing, shows a single aggregated dialog with
 * a button that opens the troubleshooting journal (locale-aware: DE gets the
 * German docs page, everything else gets the English one).
 *
 * Design constraints:
 *   - GM-only. Players can't fix missing files and shouldn't see warnings.
 *   - Zero network I/O when the scene has no Beneos assets (regex-filter first).
 *   - Dialog dedup via result-key (same missing set → no re-dialog this session).
 *   - Explicit per-scene dismissal: dialog has a "report this again" checkbox
 *     (default ON). When user unchecks it and closes, the currently-listed
 *     missing paths are persisted on the scene as a flag. They will never
 *     trigger the dialog again — but any OTHER path that breaks on the same
 *     scene later will still show it.
 *   - Cloud URLs (beneos-battlemaps-universe) are skipped — CORS would false-
 *     positive HEAD requests and we can't distinguish "really gone" from
 *     "cross-origin blocked".
 *
 * Verbose console logging is intentional: when something goes wrong, the GM
 * needs a clear breadcrumb trail.
 */

const MODULE_ID = "beneos-module";
const SETTING_ENABLED = "assetWatcherEnabled";
const FLAG_DISMISSED = "dismissedMissingAssets";
const WARN = (...args) => console.warn("Beneos AssetWatcher |", ...args);

// Reuses the path conventions already recognised elsewhere in the module
// (beneos_utility.js:710, 856, 865 and ctRotCerfAsset in beneos_tours.js).
const BENEOS_PATH_RE = /(?:^|\/)beneos_(?:assets|battlemaps)\//i;
const CLOUD_SUBSTR = "beneos-battlemaps-universe";

// Locale → { journal, page }. Anything not listed falls back to _default.
const TROUBLESHOOTING_DOCS = {
  de:       { journal: "Q2wVmtfGoydDgvom", page: "NYrsaIkoo7nq418k" },
  _default: { journal: "Q5xvdypjD1tGOro5", page: "Dngl5lDgXpxQCxyR" }
};

// Session dedup: sceneId → sorted-undismissed-missing-key. Suppresses
// re-opening the same dialog on repeated canvasReady fires within a session.
const lastResults = new Map();

// ---------- Dialog styling: match Beneos tour palette ----------
// Tour system (beneos_tours.js:246) defines: #151412 bg, #f5c992 gold, #e6e5e3 body.
const WATCHER_CSS = document.createElement("style");
WATCHER_CSS.id = "beneos-asset-watcher-styles";
WATCHER_CSS.textContent = `
  /* Outer frame: disable the default border (Foundry paints its own border
     that doesn't track our border-radius, making the stroke vanish at the
     rounded corners). We emulate the gold stroke with an inset box-shadow
     ring which follows border-radius perfectly, combined with overflow:hidden
     so children don't paint over it. */
  .beneos-asset-watcher-dialog {
    background: #151412 !important;
    color: #e6e5e3 !important;
    border: none !important;
    border-radius: 6px !important;
    overflow: hidden !important;
    box-shadow:
      inset 0 0 0 2px #f5c992,
      0 0 24px rgba(245, 201, 146, 0.25) !important;
  }
  .beneos-asset-watcher-dialog .window-header {
    background: #151412 !important;
    color: #f5c992 !important;
    border-bottom: 1px solid #f5c992 !important;
  }
  .beneos-asset-watcher-dialog .window-header .window-title { color: #f5c992 !important; }
  .beneos-asset-watcher-dialog .window-content {
    background: #151412 !important;
    color: #e6e5e3 !important;
    padding: 0.75em 1em !important;
  }
  .beneos-asset-watcher-dialog p,
  .beneos-asset-watcher-dialog li { color: #e6e5e3 !important; }
  .beneos-asset-watcher-dialog strong,
  .beneos-asset-watcher-dialog b { color: #f5c992 !important; }
  .beneos-asset-watcher-dialog summary {
    color: #f5c992 !important;
    cursor: pointer;
    user-select: none;
  }
  .beneos-asset-watcher-dialog code {
    background: #0a0a0a !important;
    color: #f5c992 !important;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.9em;
    user-select: text;
  }
  .beneos-asset-watcher-dialog .beneos-aw-pathlist {
    max-height: 220px;
    overflow: auto;
    margin: 0.5em 0;
    padding-left: 1.5em;
  }
  .beneos-asset-watcher-dialog .beneos-aw-pathlist li {
    margin: 0.25em 0;
    line-height: 1.4;
    word-break: break-all;
  }
  .beneos-asset-watcher-dialog .beneos-aw-copy {
    background: #2a2623 !important;
    color: #f5c992 !important;
    border: 1px solid #f5c992 !important;
    padding: 4px 10px !important;
    margin-left: 6px;
    cursor: pointer;
    border-radius: 3px;
  }
  .beneos-asset-watcher-dialog .beneos-aw-copy:hover {
    background: #3a3228 !important;
  }
  .beneos-asset-watcher-dialog .beneos-aw-report-row {
    margin-top: 0.75em;
    padding: 0.5em 0;
    border-top: 1px solid #3a3228;
    display: flex;
    align-items: center;
    gap: 0.5em;
  }
  .beneos-asset-watcher-dialog .beneos-aw-report-row input[type=checkbox] {
    accent-color: #f5c992;
  }
  .beneos-asset-watcher-dialog .dialog-buttons button {
    background: #2a2623 !important;
    color: #f5c992 !important;
    border: 1px solid #f5c992 !important;
  }
  .beneos-asset-watcher-dialog .dialog-buttons button:hover {
    background: #3a3228 !important;
  }
`;
document.head.appendChild(WATCHER_CSS);

const isBeneosPath = (src) => {
  if (!src || typeof src !== "string") return false;
  if (src.includes(CLOUD_SUBSTR)) return false;
  if (/^https?:\/\//i.test(src)) return false;
  return BENEOS_PATH_RE.test(src);
};

const collectBeneosPaths = (scene) => {
  const paths = new Set();
  const push = (p) => { if (isBeneosPath(p)) paths.add(p); };
  push(scene.background?.src);
  push(typeof scene.foreground === "string" ? scene.foreground : scene.foreground?.src);
  push(scene.firstLevel?.background?.src);
  for (const t of scene.tiles ?? [])  push(t.texture?.src);
  for (const t of scene.tokens ?? []) push(t.texture?.src);
  for (const n of scene.notes ?? []) { push(n.texture?.src); push(n.icon); }
  return [...paths];
};

const headCheck = async (path) => {
  const url = path.split("/").map(encodeURIComponent).join("/");
  try {
    const resp = await fetch(url, { method: "HEAD", cache: "no-store" });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, status: -1, error: String(e) };
  }
};

const getDismissedPaths = (scene) => {
  const v = scene.getFlag(MODULE_ID, FLAG_DISMISSED);
  return Array.isArray(v) ? v : [];
};

const persistDismissal = async (scene, paths) => {
  if (!paths?.length) return;
  const existing = getDismissedPaths(scene);
  const merged = Array.from(new Set([...existing, ...paths]));
  try { await scene.setFlag(MODULE_ID, FLAG_DISMISSED, merged); }
  catch (e) { WARN("failed to persist dismissal:", e); }
};

const runCheck = async (scene, { forceDialog = false } = {}) => {
  const paths = collectBeneosPaths(scene);
  if (!paths.length) {
    lastResults.set(scene.id, "");
    return;
  }

  const results = await Promise.all(paths.map(async p => {
    const r = await headCheck(p);
    return { p, ...r };
  }));

  const missing = results.filter(r => !r.ok).map(r => r.p);
  const dismissed = getDismissedPaths(scene);
  const undismissed = missing.filter(p => !dismissed.includes(p));
  const key = [...undismissed].sort().join("|");
  const prevKey = lastResults.get(scene.id);
  lastResults.set(scene.id, key);

  if (!missing.length) return;
  if (!undismissed.length) return;
  if (!forceDialog && prevKey === key) return;
  showDialog(scene, missing, undismissed);
};

const openTroubleshootingJournal = async () => {
  const locale = TROUBLESHOOTING_DOCS[game.i18n.lang] ?? TROUBLESHOOTING_DOCS._default;
  const journal = game.journal.get(locale.journal);
  if (!journal) {
    WARN(`troubleshooting journal ${locale.journal} not found in world`);
    return;
  }
  try { await journal.sheet.render(true, { pageId: locale.page }); }
  catch (e) { WARN("failed to open journal:", e); }
};

const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const showDialog = (scene, missing, undismissed) => {
  const intro = game.i18n.format("BENEOS.AssetWatcher.DialogIntro", {
    count: missing.length,
    scene: escapeHTML(scene.name ?? "")
  });
  const items = missing.map(p => `<li><code>${escapeHTML(p)}</code></li>`).join("");
  const content = `
    <p>${intro}</p>
    <details open>
      <summary>${game.i18n.localize("BENEOS.AssetWatcher.DialogShowPaths")}
        <button type="button" class="beneos-aw-copy" title="${game.i18n.localize("BENEOS.AssetWatcher.DialogCopy")}">
          <i class="fas fa-copy"></i> ${game.i18n.localize("BENEOS.AssetWatcher.DialogCopy")}
        </button>
      </summary>
      <ul class="beneos-aw-pathlist">${items}</ul>
    </details>
    <p>${game.i18n.localize("BENEOS.AssetWatcher.DialogHint")}</p>
    <label class="beneos-aw-report-row">
      <input type="checkbox" class="beneos-aw-report-again" checked>
      <span>${game.i18n.localize("BENEOS.AssetWatcher.DialogReportAgain")}</span>
    </label>`;

  const handleClose = async (html) => {
    const root = html?.jquery ? html[0] : html;
    const cb = root?.querySelector?.("input.beneos-aw-report-again");
    const reportAgain = cb ? cb.checked : true;
    if (!reportAgain) await persistDismissal(scene, missing);
  };

  const dlg = new Dialog({
    title: game.i18n.localize("BENEOS.AssetWatcher.DialogTitle"),
    content,
    buttons: {
      open: {
        icon: '<i class="fas fa-book"></i>',
        label: game.i18n.localize("BENEOS.AssetWatcher.DialogOpenDocs"),
        callback: () => openTroubleshootingJournal()
      },
      close: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("BENEOS.AssetWatcher.DialogClose")
      }
    },
    default: "open",
    close: handleClose,
    render: (html) => {
      const root = html?.jquery ? html[0] : html;
      const btn = root?.querySelector?.(".beneos-aw-copy");
      if (!btn) return;
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          await navigator.clipboard.writeText(missing.join("\n"));
          const old = btn.innerHTML;
          btn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("BENEOS.AssetWatcher.DialogCopied")}`;
          setTimeout(() => { btn.innerHTML = old; }, 1500);
        } catch (e) {
          WARN("clipboard copy failed:", e);
        }
      });
    }
  }, { classes: ["beneos-asset-watcher-dialog"] });

  dlg.render(true);
};

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_ENABLED, {
    name: "BENEOS.Settings.AssetWatcher.Name",
    hint: "BENEOS.Settings.AssetWatcher.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.on("canvasReady", async () => {
  if (!game.user?.isGM) return;
  let enabled;
  try { enabled = game.settings.get(MODULE_ID, SETTING_ENABLED); }
  catch (e) { return; }
  if (!enabled) return;
  const scene = canvas.scene;
  if (!scene) return;
  try { await runCheck(scene); }
  catch (e) { WARN("check failed:", e); }
});

// Manual triggers (force-open the dialog, clear the session dedup cache, or
// clear the per-scene dismissal flag). Left in place so a GM can re-test
// after fixing files without reloading the world.
globalThis.beneosAssetWatcher = {
  check: async () => {
    const scene = canvas.scene;
    if (!scene) return;
    await runCheck(scene, { forceDialog: true });
  },
  reset: () => { lastResults.clear(); },
  clearDismissals: async () => {
    const scene = canvas.scene;
    if (!scene) return;
    await scene.unsetFlag(MODULE_ID, FLAG_DISMISSED);
  }
};
