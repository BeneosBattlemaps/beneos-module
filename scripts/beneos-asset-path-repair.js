/**
 * Beneos Asset Path Repair
 *
 * Detects the user's actual "<prefix>beneos_assets/" location by scanning
 * known-good references (actor images, scene backgrounds — both written by
 * the Beneos token pipeline at install time, so their paths always match
 * the user's real filesystem). Exposes a resolver + two one-time repair
 * hooks that rewrite mismatched paths baked into pre-placed scene tiles
 * and the tutorial-music playlist.
 *
 * GM-only writes. Idempotent via scene flag + per-update prefix equality.
 */
const MODULE_ID = "beneos-module";
const ASSET_MARKER = "beneos_assets/";
const ASSET_RE = /^(.*?)beneos_assets\//;
const REPAIR_FLAG = "pathsRepairedV1";
const TUTORIAL_PLAYLIST_ID = "pQpsDUhEtL0Q27vJ";

let _cachedPrefix = null;

function _probe(s) {
  if (typeof s !== "string") return null;
  const m = s.replace(/\\/g, "/").match(ASSET_RE);
  return m ? m[1] : null;
}

export function beneosGetAssetPrefix() {
  if (_cachedPrefix !== null) return _cachedPrefix;
  for (const actor of game.actors ?? []) {
    const p = _probe(actor.img) ?? _probe(actor.prototypeToken?.texture?.src);
    if (p !== null) { _cachedPrefix = p; return p; }
  }
  for (const scene of game.scenes ?? []) {
    const p = _probe(scene.background?.src);
    if (p !== null) { _cachedPrefix = p; return p; }
  }
  return "";
}

export function beneosResolvePath(path) {
  if (typeof path !== "string") return path;
  const norm = path.replace(/\\/g, "/");
  const idx = norm.indexOf(ASSET_MARKER);
  if (idx < 0) return path;
  return beneosGetAssetPrefix() + norm.slice(idx);
}

async function _repairSceneTiles(scene) {
  if (!game.user.isGM) return;
  if (scene.getFlag(MODULE_ID, REPAIR_FLAG)) return;
  const prefix = beneosGetAssetPrefix();
  if (!prefix) return;
  const updates = [];
  for (const tile of scene.tiles) {
    const src = tile.texture?.src;
    if (typeof src !== "string") continue;
    const norm = src.replace(/\\/g, "/");
    const idx = norm.indexOf(ASSET_MARKER);
    if (idx < 0) continue;
    if (norm.slice(0, idx) === prefix) continue;
    updates.push({ _id: tile.id, "texture.src": prefix + norm.slice(idx) });
  }
  if (updates.length) {
    await scene.updateEmbeddedDocuments("Tile", updates);
    console.log(`Beneos Asset Repair | Fixed ${updates.length} tile path(s) on scene "${scene.name}"`);
  }
  await scene.setFlag(MODULE_ID, REPAIR_FLAG, true);
}

async function _repairTutorialPlaylist() {
  if (!game.user.isGM) return;
  const pl = game.playlists.get(TUTORIAL_PLAYLIST_ID);
  if (!pl) return;
  const prefix = beneosGetAssetPrefix();
  if (!prefix) return;
  const updates = [];
  for (const sound of pl.sounds) {
    const p = sound.path;
    if (typeof p !== "string") continue;
    const norm = p.replace(/\\/g, "/");
    const idx = norm.indexOf(ASSET_MARKER);
    if (idx < 0) continue;
    if (norm.slice(0, idx) === prefix) continue;
    updates.push({ _id: sound.id, path: prefix + norm.slice(idx) });
  }
  if (updates.length) {
    await pl.updateEmbeddedDocuments("PlaylistSound", updates);
    console.log(`Beneos Asset Repair | Fixed ${updates.length} sound path(s) on "${pl.name}"`);
  }
}

Hooks.once("ready", () => {
  _repairTutorialPlaylist().catch(e =>
    console.warn("Beneos Asset Repair | Playlist repair failed:", e));
});

Hooks.on("canvasReady", canvas => {
  const scene = canvas?.scene;
  if (!scene) return;
  _repairSceneTiles(scene).catch(e =>
    console.warn("Beneos Asset Repair | Tile repair failed:", e));
});

globalThis.beneosAssetPathRepair = {
  getPrefix: beneosGetAssetPrefix,
  resolve: beneosResolvePath,
  repairScene: (scene) => _repairSceneTiles(scene ?? canvas.scene),
  repairPlaylist: _repairTutorialPlaylist,
  clearCache: () => { _cachedPrefix = null; }
};
