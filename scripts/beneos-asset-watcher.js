/**
 * Beneos Asset Watcher
 *
 * On canvasReady, collects every Beneos-owned asset path referenced by the
 * scene (background, foreground, tiles, tokens, notes) and verifies each one
 * via a HEAD fetch. If any are missing, shows a single aggregated dialog with
 * a button that opens the public FAQ page in a new browser tab. Previously
 * this linked to a locally-installed troubleshooting journal, but Moulinette
 * does not overwrite existing assets on re-install — so users with an older
 * Beneos release already installed were being pointed at a stale local
 * journal whose referenced pages didn't exist. The external URL is always
 * reachable and always current.
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
 *   - Absolute http(s):// URLs are skipped — CORS would false-positive HEAD
 *     requests and we can't distinguish "really gone" from "cross-origin
 *     blocked". Only relative / local paths are verified. This covers both
 *     direct module installs and Moulinette-installed paths (which live
 *     under moulinette/adventures/beneos-battlemaps-universe/beneos_assets/…
 *     but are still local on disk and must be checked).
 *
 * Verbose console logging is intentional: when something goes wrong, the GM
 * needs a clear breadcrumb trail.
 */

import { BeneosRepairMenuApp } from "./beneos-asset-repair-dialog.js";

const MODULE_ID = "beneos-module";
const SETTING_ENABLED = "assetWatcherEnabled";
const FLAG_DISMISSED = "dismissedMissingAssets";
const WARN = (...args) => console.warn("Beneos AssetWatcher |", ...args);

// Reuses the path conventions already recognised elsewhere in the module
// (beneos_utility.js:710, 856, 865 and ctRotCerfAsset in beneos_tours.js).
//
// Two distinct shapes we accept as "Beneos-owned":
// 1) Anything under a beneos_assets/ or beneos_battlemaps/ folder — the
//    legacy convention used by the token pipeline and pre-Moulinette
//    installs.
// 2) Anything under moulinette/<subroot>/beneos[-_]…/ — files that
//    Moulinette extracted from a Beneos cloud pack live inside the
//    pack's own world-folder (e.g. moulinette/adventures/beneos-battle\
//    maps-universe/map_assets/icons/icon_prison.svg). Without this
//    branch the watcher silently ignores broken assets sitting under
//    map_assets/, sound_effects/, etc. — these subdirs don't carry
//    the beneos_ token but they are unambiguously Beneos because of
//    their grandparent folder.
const BENEOS_PATH_RE =
  /(?:^|\/)beneos_(?:assets|battlemaps)\/|^moulinette\/(?:adventures|images|sounds|scenes)\/beneos[-_]/i;

// Public FAQ page. The site itself can handle language negotiation; we open
// a single canonical URL so old/new Beneos installs all land on the right
// content regardless of which journal the local world happens to contain.
const TROUBLESHOOTING_URL = "https://beneos-battlemaps.com/pages/beneos-faq-black-screen-error";

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
  .beneos-asset-watcher-dialog .beneos-aw-pathlist li.beneos-aw-entry {
    list-style: none;
    margin: 0.4em 0;
    padding: 0.35em 0.5em;
    border-left: 2px solid #f5c992;
    background: rgba(245, 201, 146, 0.05);
    border-radius: 2px;
  }
  .beneos-asset-watcher-dialog .beneos-aw-entry-context {
    font-size: 0.9em;
    color: #b8b6b3;
    line-height: 1.3;
  }
  .beneos-asset-watcher-dialog .beneos-aw-entry-context strong {
    color: #f5c992;
  }
  .beneos-asset-watcher-dialog .beneos-aw-entry-child {
    color: #8d8b88;
    font-size: 0.9em;
  }
  .beneos-asset-watcher-dialog .beneos-aw-entry-asset {
    font-size: 0.95em;
    margin-top: 0.1em;
  }
  .beneos-asset-watcher-dialog .beneos-aw-entry-asset code {
    color: #e6e5e3;
    background: transparent;
    padding: 0;
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
  /* Phase E (still-missing) — source list + per-row actions */
  .beneos-asset-watcher-dialog .beneos-rd-stillmissing h3 {
    margin: 0.6em 0 0.4em;
    color: #f5c992;
    border-bottom: 1px solid #3a3228;
    padding-bottom: 0.25em;
  }
  .beneos-asset-watcher-dialog .beneos-rd-missing {
    margin: 0.4em 0;
    padding: 0.4em 0.5em;
    border-left: 2px solid #f5c992;
    background: rgba(245, 201, 146, 0.04);
    border-radius: 2px;
  }
  .beneos-asset-watcher-dialog .beneos-rd-missing summary {
    cursor: pointer;
    color: #e6e5e3;
    list-style: none;
  }
  .beneos-asset-watcher-dialog .beneos-rd-missing summary::-webkit-details-marker {
    display: none;
  }
  .beneos-asset-watcher-dialog .beneos-rd-show-path {
    padding: 2px 6px !important;
    margin-left: 6px;
    font-size: 0.85em;
  }
  .beneos-asset-watcher-dialog .beneos-rd-source {
    padding: 0.35em 0.5em;
    margin: 0.25em 0;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 2px;
  }
  .beneos-asset-watcher-dialog .beneos-rd-source-line {
    font-size: 0.9em;
    color: #b8b6b3;
    margin-bottom: 0.3em;
  }
  .beneos-asset-watcher-dialog .beneos-rd-kind {
    color: #f5c992;
  }
  .beneos-asset-watcher-dialog .beneos-rd-source-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35em;
  }
  .beneos-asset-watcher-dialog .beneos-rd-action {
    background: #2a2623 !important;
    color: #f5c992 !important;
    border: 1px solid #f5c992 !important;
    padding: 4px 8px !important;
    font-size: 0.85em;
    cursor: pointer;
    border-radius: 3px;
  }
  .beneos-asset-watcher-dialog .beneos-rd-action:hover {
    background: #3a3228 !important;
  }
  .beneos-asset-watcher-dialog .beneos-rd-education {
    margin: 0.6em 0;
    padding: 0.5em;
    background: rgba(245, 201, 146, 0.06);
    border-left: 3px solid #f5c992;
    border-radius: 2px;
  }
  .beneos-asset-watcher-dialog .beneos-rd-education p {
    margin: 0.4em 0;
    color: #e6e5e3;
  }
  .beneos-asset-watcher-dialog progress {
    accent-color: #f5c992;
  }
`;
document.head.appendChild(WATCHER_CSS);

const isBeneosPath = (src) => {
  if (!src || typeof src !== "string") return false;
  if (/^https?:\/\//i.test(src)) {
    // Beta: Beneos Stream. Absolute addresses are skipped as a rule, because a
    // HEAD against a foreign host cannot tell "really gone" from "blocked by
    // the browser". Our own delivery gate is the exception: it answers HEAD and
    // allows the origin, so the check works there and streamed scenes are not
    // silently exempt from it.
    try {
      const host = globalThis.BeneosStream?.enabled() ? globalThis.BeneosStream.host?.() : "";
      return Boolean(host) && new URL(src).host === host;
    } catch (_) { return false; }
  }
  return BENEOS_PATH_RE.test(src);
};

// Pull the filename ("foo.webp") out of a path for compact display in the
// watcher dialog. Falls back to the whole string if no slash present.
const _basename = (p) => {
  if (typeof p !== "string" || !p) return "";
  const decoded = p.replace(/\\/g, "/");
  const last = decoded.split("/").pop();
  return last || decoded;
};

// Structured ref: { path, kind, entityType, entityId, entityName, field,
// fileName, ownerType?, ownerId?, ownerName? }. The optional owner fields
// describe a containing document — e.g. an item-img has entityType="Item"
// with the actor as owner. Phase-E in the repair dialog uses these to
// build the "Scene X — Tile" / "Actor Y (Item: Z) — Icon" labels and to
// pick the right delete/remove action.
const _ref = (path, kind, entityType, entity, field, ownerType, owner) => ({
  path,
  kind,
  entityType,
  entityId: entity?.id ?? null,
  entityName: entity?.name ?? "",
  field,
  fileName: _basename(path),
  ownerType: ownerType ?? null,
  ownerId: owner?.id ?? null,
  ownerName: owner?.name ?? null
});

const _sceneRefs = (scene) => {
  const out = [];
  const push = (path, kind, entity, field) => {
    if (isBeneosPath(path)) out.push(_ref(path, kind, "Scene", entity ?? scene, field));
  };
  // V14 relocated the scene background/foreground onto scene.firstLevel (Level).
  // Reading the deprecated top-level scene.background/foreground logs a warning
  // on every canvas draw (seen in the install logs), so branch on firstLevel:
  // track the Level paths on V14, the legacy top-level paths only on a
  // V13-shaped scene that has no firstLevel.
  if (scene.firstLevel) {
    push(scene.firstLevel.background?.src, "firstLevelBg", scene, "firstLevel.background.src");
    push(scene.firstLevel.foreground?.src, "foreground", scene, "firstLevel.foreground.src");
  } else {
    push(scene.background?.src, "background", scene, "background.src");
    const fgRaw = typeof scene.foreground === "string" ? scene.foreground : scene.foreground?.src;
    if (isBeneosPath(fgRaw)) {
      out.push(_ref(
        fgRaw,
        "foreground",
        "Scene",
        scene,
        typeof scene.foreground === "string" ? "foreground" : "foreground.src"
      ));
    }
  }
  for (const t of scene.tiles ?? []) {
    if (isBeneosPath(t.texture?.src)) {
      out.push(_ref(t.texture.src, "tile", "Tile", t, "texture.src", "Scene", scene));
    }
  }
  for (const t of scene.tokens ?? []) {
    if (isBeneosPath(t.texture?.src)) {
      out.push(_ref(t.texture.src, "token", "Token", t, "texture.src", "Scene", scene));
    }
  }
  for (const n of scene.notes ?? []) {
    if (isBeneosPath(n.texture?.src)) {
      out.push(_ref(n.texture.src, "note-texture", "Note", n, "texture.src", "Scene", scene));
    }
    if (isBeneosPath(n.icon)) {
      out.push(_ref(n.icon, "note-icon", "Note", n, "icon", "Scene", scene));
    }
  }
  for (const s of scene.sounds ?? []) {
    if (isBeneosPath(s.path)) {
      out.push(_ref(s.path, "sound", "AmbientSound", s, "path", "Scene", scene));
    }
  }
  return out;
};

const _actorRefs = (actor) => {
  const out = [];
  if (isBeneosPath(actor.img)) {
    out.push(_ref(actor.img, "actor-img", "Actor", actor, "img"));
  }
  if (isBeneosPath(actor.prototypeToken?.texture?.src)) {
    out.push(_ref(actor.prototypeToken.texture.src, "prototype-token", "Actor", actor, "prototypeToken.texture.src"));
  }
  for (const item of actor.items ?? []) {
    if (isBeneosPath(item.img)) {
      out.push(_ref(item.img, "item-img", "Item", item, "img", "Actor", actor));
    }
    for (const eff of item.effects ?? []) {
      const effPath = eff.img ?? eff.icon;
      const effField = eff.img ? "img" : "icon";
      if (isBeneosPath(effPath)) {
        out.push(_ref(effPath, "item-effect-icon", "ActiveEffect", eff, effField, "Item", item));
      }
    }
  }
  for (const eff of actor.effects ?? []) {
    const effPath = eff.img ?? eff.icon;
    const effField = eff.img ? "img" : "icon";
    if (isBeneosPath(effPath)) {
      out.push(_ref(effPath, "effect-icon", "ActiveEffect", eff, effField, "Actor", actor));
    }
  }
  return out;
};

const _journalRefs = (journal) => {
  const out = [];
  if (isBeneosPath(journal.img)) {
    out.push(_ref(journal.img, "journal-img", "JournalEntry", journal, "img"));
  }
  for (const page of journal.pages ?? []) {
    if (isBeneosPath(page.src)) {
      out.push(_ref(page.src, "journal-page", "JournalEntryPage", page, "src", "JournalEntry", journal));
    }
    const html = page.text?.content;
    if (typeof html === "string" && html.length > 0) {
      const re = /<(?:img|video|source|audio)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        if (isBeneosPath(m[1])) {
          out.push(_ref(m[1], "journal-page", "JournalEntryPage", page, "text.content", "JournalEntry", journal));
        }
      }
    }
  }
  return out;
};

const _playlistRefs = (playlist) => {
  const out = [];
  for (const s of playlist.sounds ?? []) {
    if (isBeneosPath(s.path)) {
      out.push(_ref(s.path, "playlist-sound", "PlaylistSound", s, "path", "Playlist", playlist));
    }
  }
  return out;
};

const _tableRefs = (table) => {
  const out = [];
  if (isBeneosPath(table.img)) {
    out.push(_ref(table.img, "table-img", "RollTable", table, "img"));
  }
  for (const r of table.results ?? []) {
    if (isBeneosPath(r.img)) {
      out.push(_ref(r.img, "table-result", "TableResult", r, "img", "RollTable", table));
    }
  }
  return out;
};

// Legacy shim — returns deduplicated path strings. New code should use
// _sceneRefs / collectBeneosRefs to keep entity / kind / field info.
const collectBeneosPaths = (scene) => {
  const seen = new Set();
  for (const ref of _sceneRefs(scene)) seen.add(ref.path);
  return [...seen];
};

const collectBeneosRefs = (scene) => _sceneRefs(scene);

// Existence check for missing-asset detection.
//
// One HEAD per path. This used to run foundry.utils.srcExists first and then a
// second raw HEAD, but srcExists is itself nothing more than
// `fetchWithTimeout(src, {method: "HEAD"}).then(resp => resp.status < 400)`, and
// its early return only fired when the asset was MISSING. Present assets, which
// is nearly all of them, therefore paid two round trips for one answer. In the
// Universe world that meant 1893 assets turning into 3786 requests on every page
// load. The single request below answers both questions the two used to: the
// status says whether the file is there, and the content type catches hosting
// setups that answer 200 with an HTML error page for a missing asset.
//
// `cache: "no-store"` is gone because it never bought anything: Foundry already
// serves data files with `Cache-Control: no-store`, so a browser cache hit was
// impossible either way. Repeat probing is avoided by the persistent result
// cache in BeneosUtility instead.
//
// Plain fetch with an abort timeout, not foundry.utils.fetchWithTimeout: that
// helper throws an HttpError on any non-ok response, which would turn a clean
// 404 into a generic failure and lose the status code this function is
// contracted to report. The timeout keeps a stalled request from pinning a
// worker slot indefinitely.
//
// Function name kept as `headCheck` for back-compat with external
// callers; return shape matches the old { ok, status? } contract.
const HEAD_TIMEOUT_MS = 30000;

const headCheck = async (path) => {
  try {
    // Percent-encoding a path that is already encoded would turn "%20" into
    // "%2520" and report a present asset as missing, so encode only raw paths.
    // Encoding at all is what keeps "#" and "?" in a filename from being parsed
    // as a fragment or query.
    const url = /%[0-9A-Fa-f]{2}/.test(path)
      ? path
      : path.split("/").map(encodeURIComponent).join("/");

    const signal = (typeof AbortSignal?.timeout === "function")
      ? AbortSignal.timeout(HEAD_TIMEOUT_MS)
      : undefined;
    const resp = await fetch(url, { method: "HEAD", signal });
    if (!resp.ok) return { ok: false, status: resp.status };
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (ct.startsWith("text/html") && !/\.html?$/i.test(path)) {
      return { ok: false, status: 415, note: "html-fallback" };
    }
    return { ok: true, status: 200 };
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
  const refs = _sceneRefs(scene);
  if (!refs.length) {
    if (globalThis.BeneosUtility?.isDebug?.()) console.log(`Beneos AssetWatcher | scene "${scene.name}" — 0 Beneos refs found, skipping check`);
    lastResults.set(scene.id, "");
    return;
  }

  const probed = await _probeRefs(refs);
  const missingRefs = probed.filter(r => !r.ok);
  const missingPaths = [...new Set(missingRefs.map(r => r.path))];

  const dismissed = getDismissedPaths(scene);
  const undismissedRefs = missingRefs.filter(r => !dismissed.includes(r.path));
  const undismissedPaths = [...new Set(undismissedRefs.map(r => r.path))];
  const key = [...undismissedPaths].sort().join("|");
  const prevKey = lastResults.get(scene.id);
  lastResults.set(scene.id, key);

  if (globalThis.BeneosUtility?.isDebug?.()) console.log(`Beneos AssetWatcher | scene "${scene.name}" — ${refs.length} refs collected, ${missingRefs.length} missing, ${undismissedRefs.length} undismissed`);

  if (!missingRefs.length) return;
  if (!undismissedRefs.length) return;
  if (!forceDialog && prevKey === key) return;
  showDialog(scene, missingPaths, undismissedPaths, missingRefs);
};

const openTroubleshootingFaq = () => {
  try {
    window.open(TROUBLESHOOTING_URL, "_blank", "noopener,noreferrer");
  } catch (e) {
    WARN("failed to open FAQ in new tab:", e);
  }
};

const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

// Build a Discord-friendly plain-text clipboard payload from structured
// missing refs. Two lines per entry: a context line (Scene / Actor /
// Journal name + Type + filename) and an indented full-path line.
const _buildClipboardText = (missingRefs) => {
  if (!Array.isArray(missingRefs) || !missingRefs.length) return "";
  const _entLabel = (t) => {
    const k = `BENEOS.AssetWatcher.Dialog.EntityType.${t}`;
    return game.i18n.has?.(k) ? game.i18n.localize(k) : t;
  };
  const _kindLabel = (k) => {
    const key = `BENEOS.AssetWatcher.Dialog.Kind.${k}`;
    return game.i18n.has?.(key) ? game.i18n.localize(key) : k;
  };
  const lines = [
    game.i18n.localize?.("BENEOS.AssetWatcher.Repair.CopyListHeader") ?? "Beneos Asset Watcher — Missing Files",
    game.i18n.localize?.("BENEOS.AssetWatcher.Repair.CopyListSeparator") ?? "------------------------------------"
  ];
  for (const ref of missingRefs) {
    const parentName = ref.ownerName || ref.entityName || "—";
    const parentType = ref.ownerType ? _entLabel(ref.ownerType) : _entLabel(ref.entityType);
    const childPart = ref.ownerName ? ` (${_entLabel(ref.entityType)}: ${ref.entityName || "—"})` : "";
    const kindLine = _kindLabel(ref.kind);
    lines.push(`${parentType}: "${parentName}"${childPart} — ${kindLine} · ${ref.fileName || ""}`);
    lines.push(`  ${ref.path}`);
  }
  return lines.join("\n");
};

// Render a single missing-ref entry as a two-line block:
//   "Scene: <name>" / "<kind label> · <filename>"
// The full path goes into title= so the browser tooltip exposes it on
// hover, while the copy button still grabs the raw path list for
// Discord support tickets.
const _formatRef = (ref) => {
  const kindKey = `BENEOS.AssetWatcher.Dialog.Kind.${ref.kind}`;
  const kindLabel = game.i18n.has?.(kindKey) ? game.i18n.localize(kindKey) : ref.kind;
  const entityTypeKey = `BENEOS.AssetWatcher.Dialog.EntityType.${ref.entityType}`;
  const entityTypeLabel = game.i18n.has?.(entityTypeKey)
    ? game.i18n.localize(entityTypeKey)
    : ref.entityType;
  const parentName = ref.ownerName || ref.entityName || "—";
  const parentType = ref.ownerType
    ? (game.i18n.has?.(`BENEOS.AssetWatcher.Dialog.EntityType.${ref.ownerType}`)
        ? game.i18n.localize(`BENEOS.AssetWatcher.Dialog.EntityType.${ref.ownerType}`)
        : ref.ownerType)
    : entityTypeLabel;
  const childInfo = ref.ownerName
    ? ` <span class="beneos-aw-entry-child">(${entityTypeLabel}: ${escapeHTML(ref.entityName)})</span>`
    : "";

  return `
    <li class="beneos-aw-entry" title="${escapeHTML(ref.path)}">
      <div class="beneos-aw-entry-context">${escapeHTML(parentType)}: <strong>${escapeHTML(parentName)}</strong>${childInfo}</div>
      <div class="beneos-aw-entry-asset">${escapeHTML(kindLabel)} · <code>${escapeHTML(ref.fileName)}</code></div>
    </li>`;
};

const showDialog = (scene, missing, undismissed, missingRefs = null) => {
  const intro = game.i18n.format("BENEOS.AssetWatcher.DialogIntro", {
    count: missing.length,
    scene: escapeHTML(scene.name ?? "")
  });

  // Render structured entries if refs are available; fall back to legacy
  // path-only display for back-compat (e.g. external callers via
  // globalThis.beneosAssetWatcher.check that pre-date the refactor).
  const items = (missingRefs?.length)
    ? missingRefs.map(_formatRef).join("")
    : missing.map(p => `<li class="beneos-aw-entry" title="${escapeHTML(p)}"><code>${escapeHTML(p)}</code></li>`).join("");
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
      repair: {
        icon: '<i class="fas fa-wrench"></i>',
        label: game.i18n.localize("BENEOS.AssetWatcher.Repair.DialogButtonRepair"),
        callback: () => import("./beneos-asset-repair-dialog.js")
          .then(m => m.BeneosRepairDialog.open({
            scene,
            missingPaths: missing,
            missingRefs: missingRefs ?? [],
            initialScope: "ask"
          }))
          .catch(e => console.warn("Beneos Asset Repair | dialog load failed:", e))
      },
      open: {
        icon: '<i class="fas fa-book"></i>',
        label: game.i18n.localize("BENEOS.AssetWatcher.DialogOpenDocs"),
        callback: () => openTroubleshootingFaq()
      },
      close: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("BENEOS.AssetWatcher.DialogClose")
      }
    },
    default: "repair",
    close: handleClose,
    render: (html) => {
      const root = html?.jquery ? html[0] : html;
      const btn = root?.querySelector?.(".beneos-aw-copy");
      if (!btn) return;
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          // Prefer the structured Discord-friendly format when refs are
          // available; fall back to raw path list for back-compat.
          const payload = (missingRefs?.length)
            ? _buildClipboardText(missingRefs)
            : missing.join("\n");
          await navigator.clipboard.writeText(payload);
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

  // Troubleshooting entry: when the watcher silently misses a broken
  // pack (e.g. the user dismissed it earlier or the scene never opened),
  // the GM can still trigger the repair from the Beneos settings panel.
  game.settings.registerMenu(MODULE_ID, "assetRepairMenu", {
    name: "BENEOS.Settings.AssetRepair.Name",
    label: "BENEOS.Settings.AssetRepair.Label",
    hint: "BENEOS.Settings.AssetRepair.Hint",
    icon: "fas fa-wrench",
    type: BeneosRepairMenuApp,
    restricted: true
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

/**
 * Run an async mapper over items with a bounded number of calls in flight.
 *
 * The probe helpers used to fan out with a plain `Promise.all` over every path
 * at once. A whole-world scan reaches tens of thousands of paths, which floods
 * the browser's connection queue and starves everything else on the page. Eight
 * concurrent requests is what the static-switch warm-up has always used and it
 * keeps a local Foundry server busy without crowding anything out.
 *
 * Exported so scenepacker and the repair dialog can share one implementation.
 *
 * @param {Iterable} items
 * @param {(item: any, index: number) => Promise<any>} mapper
 * @param {number} [limit=8]
 * @returns {Promise<any[]>}   Results in input order.
 */
export const mapWithConcurrency = async (items, mapper, limit = 8) => {
  const list = [...items];
  const results = new Array(list.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await mapper(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
};

// Probe each ref's path via HEAD; returns refs annotated with `ok`.
// Deduplicated per path to avoid hammering the disk with the same lookup.
const _probeRefs = async (refs) => {
  const byPath = new Map();
  for (const r of refs) {
    if (!byPath.has(r.path)) byPath.set(r.path, []);
    byPath.get(r.path).push(r);
  }
  const probed = await mapWithConcurrency([...byPath.keys()], async p => {
    const r = await headCheck(p);
    return { path: p, ok: r.ok };
  });
  const okByPath = new Map(probed.map(p => [p.path, p.ok]));
  return refs.map(r => ({ ...r, ok: okByPath.get(r.path) ?? false }));
};

// Silent per-scene scanner — returns the missing-paths set without
// rendering any dialog. Used by the world-wide scan (see scanAllScenes
// below) so the GM gets one aggregated result rather than N popups.
const scanSceneSilent = async (scene) => {
  if (!scene) return { paths: [], missing: [], refs: [], missingRefs: [] };
  const refs = _sceneRefs(scene);
  if (!refs.length) return { paths: [], missing: [], refs: [], missingRefs: [] };
  const probed = await _probeRefs(refs);
  const missingRefs = probed.filter(r => !r.ok);
  const paths = [...new Set(refs.map(r => r.path))];
  const missing = [...new Set(missingRefs.map(r => r.path))];
  return { paths, missing, refs, missingRefs };
};

// World-wide scan triggered from the Cloud-V2 settings modal. Iterates
// every scene in the world (not just canvas.scene like the canvasReady
// hook) and returns aggregated counts plus a per-scene breakdown so the
// caller can decide how to surface the result. GM-only by design — the
// underlying watcher path is also GM-gated.
const scanAllScenes = async () => {
  if (!game.user?.isGM) return null;
  const scenes = [...(game.scenes ?? [])];
  const sceneSummary = [];
  let totalMissing = 0;
  for (const scene of scenes) {
    const { missing, missingRefs } = await scanSceneSilent(scene);
    if (missing.length) {
      totalMissing += missing.length;
      sceneSummary.push({ scene, missing, missingRefs });
    }
  }
  return {
    totalScenes:  scenes.length,
    scannedScenes: scenes.length,
    totalMissing,
    sceneSummary
  };
};

// World-wide scan across Scenes + Actors + Journals + Playlists + Tables.
// This is the entry point Phase B of the repair dialog uses for "Entire
// world" scope — it gives us Beneos ref coverage for every entity type
// (scene-only scanAllScenes() above misses actor-embedded paths like
// item icons, which user reported as W2-7 gap).
const scanAllEntities = async (onProgress) => {
  if (!game.user?.isGM) return null;
  const collections = [
    { type: "Scene",    coll: game.scenes ?? [],    refs: _sceneRefs },
    { type: "Actor",    coll: game.actors ?? [],    refs: _actorRefs },
    { type: "Journal",  coll: game.journal ?? [],   refs: _journalRefs },
    { type: "Playlist", coll: game.playlists ?? [], refs: _playlistRefs },
    { type: "Table",    coll: game.tables ?? [],    refs: _tableRefs }
  ];
  const total = collections.reduce((s, c) => s + (c.coll.size ?? c.coll.length ?? 0), 0);
  let current = 0;
  const allRefs = [];
  for (const spec of collections) {
    for (const doc of spec.coll) {
      current++;
      try { onProgress?.({ current, total, label: `${spec.type}: ${doc.name}` }); } catch (e) {}
      try {
        for (const r of spec.refs(doc)) allRefs.push(r);
      } catch (e) {
        WARN(`refs(${spec.type}:${doc.name}) failed:`, e);
      }
    }
  }
  if (!allRefs.length) {
    if (globalThis.BeneosUtility?.isDebug?.()) console.log(`Beneos AssetWatcher | world scan — 0 Beneos refs found across all entities`);
    return { totalRefs: 0, totalMissing: 0, refs: [], missingRefs: [], missing: [] };
  }
  const probed = await _probeRefs(allRefs);
  const missingRefs = probed.filter(r => !r.ok);
  const missing = [...new Set(missingRefs.map(r => r.path))];
  if (globalThis.BeneosUtility?.isDebug?.()) console.log(`Beneos AssetWatcher | world scan — ${allRefs.length} refs collected, ${missingRefs.length} missing`);
  return {
    totalRefs: allRefs.length,
    totalMissing: missingRefs.length,
    refs: probed,
    missingRefs,
    missing
  };
};

// Manual triggers (force-open the dialog, clear the session dedup cache,
// clear the per-scene dismissal flag, or run the world-wide scan). Left
// in place so a GM can re-test after fixing files without reloading the
// world. The world-wide scan also feeds the Cloud-V2 settings modal.
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
  },
  scanAllScenes,
  scanAllEntities,
  repair: (opts) => import("./beneos-asset-repair-dialog.js")
    .then(m => m.BeneosRepairDialog.open(opts ?? {}))
};

export {
  scanAllScenes,
  scanAllEntities,
  scanSceneSilent,
  collectBeneosRefs,
  _sceneRefs as collectSceneRefs,
  _actorRefs as collectActorRefs,
  _journalRefs as collectJournalRefs,
  _playlistRefs as collectPlaylistRefs,
  _tableRefs as collectTableRefs,
  headCheck,
  isBeneosPath,
  BENEOS_PATH_RE,
  escapeHTML,
  _basename
};
