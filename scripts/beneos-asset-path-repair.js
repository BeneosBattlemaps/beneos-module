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

// Multi-pack Moulinette pattern: when a path lives under
// moulinette/<subroot>/<world>/, it was placed there by Moulinette's pack
// installer and already carries its own pack-specific prefix. The legacy
// auto-repair below assumes a single global prefix per world and would
// rewrite such paths onto the cached global prefix — wrong in multi-pack
// installs. We detect this pattern and skip those entries in the legacy
// hooks; the new per-pack repair (scanForMappings/applyMappings) handles
// them correctly.
const MOULINETTE_MULTIPACK_RE = /^moulinette\/(adventures|images|sounds|scenes)\/[^/]+\//i;

// The in-house Beneos cloud-install namespace. Anything under
// beneos_assets/cloud/ is written by the native cloud installer at a canonical
// root-relative location and must never be re-prefixed by the global-prefix
// legacy repair (see _repairSceneTiles / _repairTutorialPlaylist).
const BENEOS_CLOUD_NAMESPACE_RE = /(^|\/)beneos_assets\/cloud\//i;

// Eine absolute Adresse ist kein Pfad-Praefix, sondern eine Auslieferung.
//
// Seit dem Streaming steht in `scene.background.src` eine Gate-Adresse der Form
// https://gate.beneos.stream/a/<schluessel>/<release>/<variante>/beneos_assets/...
// Ohne diese Schranke nimmt beneosGetAssetPrefix() genau diese Zeichenkette als
// den Ort, an dem beim Kunden die Assets liegen, und klebt sie danach vor JEDE
// Kachel JEDER Szene. Da der Praefix zwischengespeichert wird und die erste
// gefundene Szene gewinnt, traegt danach ein ganzes Release die Adresse eines
// ANDEREN Releases.
//
// Gemessen am 25.08.2026: bm_0111 wurde nach bm_0067 installiert, und danach
// zeigten seine Overlay- und Symbolkacheln auf
// .../beneos_bm_0067_white_dragon_lair/4k/beneos_assets/.../0111/111-03-ol.webp,
// mit 404 und Gefahrensymbol auf jeder Karte. Weil ausgerechnet das
// Overlay fehlt, das Schatten und Details traegt, wirkte die Karte zugleich
// flach und zu hell.
const ABSOLUTE_RE = /^(?:https?:)?\/\/|^data:/i;

let _cachedPrefix = null;

/** Der Teil vor `beneos_assets/`, auch bei absoluten Adressen. */
function _praefixVon(s) {
  if (typeof s !== "string") return null;
  const m = s.replace(/\\/g, "/").match(ASSET_RE);
  return m ? m[1] : null;
}

function _probe(s) {
  if (typeof s !== "string") return null;
  if (ABSOLUTE_RE.test(s)) return null;
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
    // Skip Moulinette multi-pack paths — they're managed by the per-pack
    // scanForMappings/applyMappings flow. Rewriting them onto the global
    // prefix would re-break references after a successful repair.
    if (MOULINETTE_MULTIPACK_RE.test(norm)) continue;
    // Never re-prefix the in-house cloud namespace. Assets installed by the
    // Beneos native cloud installer live at the canonical root-relative
    // location beneos_assets/cloud/...; a world that ALSO holds older
    // Moulinette-prefixed Beneos content makes beneosGetAssetPrefix() detect a
    // moulinette/<...>/ prefix, which would then be wrongly prepended here and
    // 404 the (already correct) cloud paths.
    if (BENEOS_CLOUD_NAMESPACE_RE.test(norm)) continue;
    // Eine ausgelieferte Adresse wird nie umgeschrieben. Sie zeigt schon dahin,
    // wo die Datei wirklich liegt, und ein davorgesetzter Plattenpfad macht aus
    // ihr einen Pfad, den es nirgends gibt.
    if (ABSOLUTE_RE.test(norm)) continue;
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
    // Skip Moulinette multi-pack paths (see note in _repairSceneTiles).
    if (MOULINETTE_MULTIPACK_RE.test(norm)) continue;
    // Skip the in-house cloud namespace (see note in _repairSceneTiles).
    if (BENEOS_CLOUD_NAMESPACE_RE.test(norm)) continue;
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

/**
 * Den Szenenhintergrund lesen, ohne Foundry 14 eine Verfallswarnung zu
 * entlocken.
 *
 * Ab Foundry 14 liegt der Hintergrund in `levels[0].background`, und das alte
 * `Scene#background` ist nur noch ein Zugriffspfad, der bei jedem Lesen warnt
 * und in Version 16 verschwindet. Gemessen auf The Forge 14.365 am 26.08.2026:
 * drei Warnungen je Sitzung kamen allein aus dieser Datei.
 *
 * Der Rueckfall geht bewusst auf `_source` und nicht auf `scene.background`.
 * `_source` ist der rohe Datensatz und loest die Warnung nicht aus; auf
 * Foundry 13 traegt er denselben Wert, den der alte Zugriff geliefert haette.
 * Beide Wege sind noetig, weil ein Pack je nach Herkunft mal migriert und mal
 * unmigriert ankommt.
 */
function _hintergrundQuelle(scene) {
  const stufe = Array.isArray(scene?.levels) ? scene.levels[0] : null;
  return stufe?.background?.src || scene?._source?.background?.src || null;
}

/**
 * Bereits verbogene Welten geradeziehen.
 *
 * Der Fehler oben hat in ausgelieferte Welten geschrieben, und die Szenen
 * tragen danach das Flag, das den Reparaturlauf ein zweites Mal verhindert. Es
 * braucht also einen eigenen Weg zurueck, und er darf nicht raten.
 *
 * Er raet auch nicht: der Szenenhintergrund einer gestreamten Szene traegt die
 * RICHTIGE Adresse, weil sie nicht von dieser Datei stammt, sondern vom
 * Szenenumbau des Streamings. Jede Kachel derselben Szene gehoert zum selben
 * Release, also ist der Hintergrund der Massstab. Eine Kachel, deren Adresse
 * einen anderen Praefix traegt, bekommt den des Hintergrunds.
 *
 * Nichts passiert, wenn der Hintergrund kein absoluter Pfad ist. Damit ruehrt
 * dieser Lauf eine Welt ohne Streaming nicht an.
 */
async function _heileStreamPraefixe(scene) {
  if (!game.user.isGM) return;
  const hintergrund = _hintergrundQuelle(scene);
  if (typeof hintergrund !== "string" || !ABSOLUTE_RE.test(hintergrund)) return;
  const soll = _praefixVon(hintergrund);
  if (!soll) return;

  const updates = [];
  for (const tile of scene.tiles) {
    const src = tile.texture?.src;
    if (typeof src !== "string" || !ABSOLUTE_RE.test(src)) continue;
    const ist = _praefixVon(src);
    // Kein `beneos_assets/` im Pfad heisst: die Adresse folgt einer anderen
    // Regel, etwa dem inhaltsadressierten Raum. Finger weg.
    if (ist === null || ist === soll) continue;
    updates.push({ _id: tile.id, "texture.src": soll + src.slice(ist.length) });
  }
  if (!updates.length) return;

  await scene.updateEmbeddedDocuments("Tile", updates);
  console.log(`Beneos Asset Repair | ${updates.length} Kachel(n) auf den Praefix `
    + `der Szene "${scene.name}" zurueckgesetzt`);
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
  _heileStreamPraefixe(scene).catch(e =>
    console.warn("Beneos Asset Repair | Praefix-Heilung fehlgeschlagen:", e));
});

/* ============================================================== */
/*  Moulinette-bug repair (per-pack prefix matching)                */
/* ============================================================== */
/*
 * Use case: Moulinette/ScenePacker occasionally extracts a Beneos pack
 * into folder A while rewriting all references to folder B. Every ref
 * of the affected pack then 404s. The detection lives in
 * beneos-asset-watcher.js and beneos-scenepacker.js; this section adds
 * the repair: take the broken paths, find where the files actually
 * live under a sibling folder of moulinette/<subroot>/, derive a
 * prefix-rewrite rule, and apply it to every matching reference.
 *
 * Independent of beneosGetAssetPrefix() — that helper caches one global
 * prefix for the world, which is wrong here: the bug affects one pack
 * in isolation, so we must search per broken-prefix group.
 */

const MOULINETTE_SUBROOTS = ["adventures", "images", "sounds", "scenes"];
const VERIFY_SAMPLE_SIZE = 3;
const VERIFY_CONFIDENCE_THRESHOLD = 0.66;

export function _parseBrokenPath(path) {
  if (typeof path !== "string") return null;
  const norm = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const segs = norm.split("/");
  if (segs.length < 4) return null;
  if (segs[0] !== "moulinette") return null;
  if (!MOULINETTE_SUBROOTS.includes(segs[1])) return null;
  const root = `moulinette/${segs[1]}/`;
  const world = segs[2];
  if (!world) return null;
  const tail = segs.slice(3).join("/");
  if (!tail) return null;
  return { root, world, tail, prefix: `${root}${world}/` };
}

function _groupBrokenPathsByPrefix(paths) {
  const groups = new Map();
  for (const p of paths) {
    const parsed = _parseBrokenPath(p);
    if (!parsed) continue;
    let g = groups.get(parsed.prefix);
    if (!g) {
      g = { root: parsed.root, world: parsed.world, prefix: parsed.prefix, tails: [] };
      groups.set(parsed.prefix, g);
    }
    g.tails.push(parsed.tail);
  }
  return groups;
}

function _commonPrefixLength(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

async function _safeBrowseDirs(root) {
  try {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    const result = await FP.browse("data", root);
    return Array.isArray(result?.dirs) ? result.dirs : [];
  } catch (e) {
    console.warn(`Beneos Asset Repair | FilePicker.browse("${root}") failed:`, e);
    return [];
  }
}

async function _findActualPrefix(root, brokenWorld, sampleTail) {
  const allDirs = await _safeBrowseDirs(root);
  if (!allDirs.length) return null;
  const candidates = allDirs
    .map(d => {
      const norm = d.replace(/\\/g, "/").replace(/\/+$/, "");
      const base = norm.split("/").pop();
      return { full: norm, base };
    })
    .filter(c => c.base && c.base !== brokenWorld);

  candidates.sort((a, b) =>
    _commonPrefixLength(b.base, brokenWorld) - _commonPrefixLength(a.base, brokenWorld)
  );

  for (const c of candidates) {
    const probePath = `${c.full}/${sampleTail}`;
    try {
      const ok = await foundry.utils.srcExists(probePath);
      if (ok) return `${c.full}/`;
    } catch (e) {}
  }
  return null;
}

async function _verifyMapping(actualPrefix, sampleTails) {
  const samples = sampleTails.slice(0, VERIFY_SAMPLE_SIZE);
  if (!samples.length) return { confidence: 1, hits: 0, probed: 0 };
  let hits = 0;
  for (const tail of samples) {
    try {
      if (await foundry.utils.srcExists(`${actualPrefix}${tail}`)) hits++;
    } catch (e) {}
  }
  return { confidence: hits / samples.length, hits, probed: samples.length };
}

/* ============================================================== */
/*  Tier-2: deep file-system basename index (exhaustive search)     */
/* ============================================================== */
/*
 * If Tier-1 sibling-folder probe fails for a broken-prefix group,
 * walk the whole Foundry data folder recursively and build a
 * basename → paths index. Then for each unresolved group, look up
 * tail-basenames and either derive a prefix-mapping (if most files
 * share a new parent directory) or emit per-path direct replacements.
 *
 * Scope (User-Direktive Welle 6): suchen, egal wo. Skip-Liste
 * unterhalb des Data-Root für klar irrelevante Foundry-Internals
 * (systems/, modules/, default-icons) damit der Walk auf realen
 * Welten in Minuten — nicht Stunden — durchläuft. worlds/ wird
 * bewusst NICHT skipped — User-Files können dort versehentlich
 * landen oder Hosting-Services können sie relocate'n.
 *
 * Memory-Optimization: wantedBasenames-Set filtert beim Indexing —
 * wir speichern nur Dateinamen, nach denen wir tatsächlich suchen.
 * Auf einem 100k+ Data-Folder ist das der Unterschied zwischen
 * 50 MB Index und 50 KB.
 */
const FILE_INDEX_SKIP_TOP_DIRS = new Set([
  "systems",      // Foundry game systems — irrelevant for asset repair
  "modules",      // installed modules — irrelevant
  "assets",       // Foundry default assets
  "icons",        // Foundry default icons
  "cards",        // Foundry default cards
  "ui",           // Foundry UI assets
  "sounds",       // Foundry default sounds (Beneos packs use their own subdirs)
  "tutorial"      // tutorial scenes
]);
const FILE_INDEX_DENY_SUBPATH_RE = /(?:^|\/)(?:\.git|\.cache|node_modules|tmp|temp)(?:$|\/)/i;
const FILE_INDEX_MAX_DIRS = 50_000;
const FILE_INDEX_SLEEP_EVERY_N_DIRS = 50;
const FILE_INDEX_SLEEP_MS = 25;

function _shouldSkipDir(dir) {
  const norm = dir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!norm) return false;
  const top = norm.split("/")[0]?.toLowerCase();
  if (top && FILE_INDEX_SKIP_TOP_DIRS.has(top)) return true;
  if (FILE_INDEX_DENY_SUBPATH_RE.test(norm)) return true;
  return false;
}

async function _buildFileIndex(wantedBasenames, onProgress) {
  const index = new Map();         // basename → [fullPath, ...]
  const visited = new Set();
  const queue = [""];              // Data-root
  let dirsScanned = 0;
  let dirsSkipped = 0;
  let filesSeen = 0;
  const wanted = wantedBasenames instanceof Set
    ? wantedBasenames
    : new Set(Array.isArray(wantedBasenames) ? wantedBasenames : []);
  const filterByWanted = wanted.size > 0;

  while (queue.length) {
    if (dirsScanned >= FILE_INDEX_MAX_DIRS) {
      console.warn(`Beneos Asset Repair | deep scan reached cap ${FILE_INDEX_MAX_DIRS} dirs, stopping`);
      break;
    }
    const dir = queue.shift();
    if (visited.has(dir)) continue;
    visited.add(dir);

    if (dir && _shouldSkipDir(dir)) {
      dirsSkipped++;
      continue;
    }

    dirsScanned++;
    try { onProgress?.({ dirsScanned, queueLength: queue.length, currentDir: dir || "/" }); } catch (e) {}

    // Defensive throttle: yield to the event loop every N dirs to
    // prevent hosting-service rate-limiting and keep the page responsive.
    if (FILE_INDEX_SLEEP_EVERY_N_DIRS > 0 && dirsScanned % FILE_INDEX_SLEEP_EVERY_N_DIRS === 0) {
      await new Promise(r => setTimeout(r, FILE_INDEX_SLEEP_MS));
    }

    let result;
    try {
      const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
      result = await FP.browse("data", dir || "/");
    } catch (e) {
      // Permission denied / non-existent / forge quirk — skip and continue.
      continue;
    }
    for (const sub of result?.dirs ?? []) {
      const norm = sub.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
      if (!visited.has(norm)) queue.push(norm);
    }
    for (const file of result?.files ?? []) {
      filesSeen++;
      const norm = file.replace(/\\/g, "/");
      const basename = norm.split("/").pop();
      if (!basename) continue;
      if (filterByWanted && !wanted.has(basename)) continue;
      let arr = index.get(basename);
      if (!arr) { arr = []; index.set(basename, arr); }
      arr.push(norm);
    }
  }
  console.log(`Beneos Asset Repair | deep scan complete — ${dirsScanned} dirs scanned, ${dirsSkipped} skipped, ${index.size} wanted-basenames indexed (out of ${filesSeen} files seen)`);
  return { index, dirsScanned, dirsSkipped, filesSeen };
}

function _tier2ResolveGroup(unresolvedEntry, index) {
  const group = unresolvedEntry.group;
  if (!group) {
    return { unresolvedPaths: [unresolvedEntry.brokenPrefix + (unresolvedEntry.sample ?? "")] };
  }
  const brokenPrefix = group.prefix;
  const derivedCounts = new Map();   // derived prefix → count of exact-suffix matches
  const tailLookups = [];            // { tail, fullPath, derived, exact }
  const unresolvedPaths = [];

  for (const tail of group.tails) {
    const basename = tail.split("/").pop();
    const candidates = index.get(basename) ?? [];
    if (!candidates.length) {
      unresolvedPaths.push(brokenPrefix + tail);
      continue;
    }
    // Prefer a candidate whose full path ends with the entire tail
    // (= structure preserved, derivable as prefix mapping). Falls back
    // to the first candidate as a direct replacement otherwise.
    let bestMatch = null;
    for (const cand of candidates) {
      if (cand.endsWith("/" + tail)) {
        bestMatch = { fullPath: cand, derived: cand.slice(0, -tail.length), exact: true };
        break;
      }
    }
    if (!bestMatch) {
      const cand = candidates[0];
      const parent = cand.slice(0, cand.length - basename.length);
      bestMatch = { fullPath: cand, derived: parent, exact: false };
    }
    tailLookups.push({ tail, ...bestMatch });
    if (bestMatch.exact) {
      derivedCounts.set(bestMatch.derived, (derivedCounts.get(bestMatch.derived) ?? 0) + 1);
    }
  }

  // Majority derived prefix from exact-suffix matches (≥ 66 % wins).
  let majorityDerived = null;
  let majorityCount = 0;
  for (const [d, c] of derivedCounts) {
    if (c > majorityCount) { majorityCount = c; majorityDerived = d; }
  }
  const totalTails = group.tails.length;
  const ratio = totalTails > 0 ? majorityCount / totalTails : 0;

  if (majorityDerived && ratio >= VERIFY_CONFIDENCE_THRESHOLD) {
    return {
      mapping: {
        brokenPrefix,
        actualPrefix: majorityDerived,
        count: totalTails,
        confidence: ratio,
        tier: 2
      },
      unresolvedPaths
    };
  }

  // No majority — emit per-path direct replacements for resolved tails.
  const directReplacements = tailLookups.map(tl => ({
    brokenPath: brokenPrefix + tl.tail,
    actualPath: tl.fullPath,
    tier: 2,
    suffixExact: tl.exact
  }));
  return { directReplacements, unresolvedPaths };
}

export async function scanForMappings(brokenPaths, onProgress) {
  const mappings = [];
  const tier1Unresolved = [];
  const groups = _groupBrokenPathsByPrefix(brokenPaths);
  let groupsProbed = 0;
  const totalGroups = groups.size;

  // Tier 1 — sibling-folder search (fast path, covers 99%).
  for (const [brokenPrefix, g] of groups) {
    groupsProbed++;
    try { onProgress?.({ phase: "tier1", current: groupsProbed, total: totalGroups, currentPrefix: brokenPrefix }); } catch (e) {}
    const sampleTail = g.tails[0];
    const actualPrefix = await _findActualPrefix(g.root, g.world, sampleTail);
    if (!actualPrefix) {
      tier1Unresolved.push({
        brokenPrefix,
        count: g.tails.length,
        sample: sampleTail,
        reason: "no-sibling-match",
        group: g
      });
      continue;
    }
    const verify = await _verifyMapping(actualPrefix, g.tails.slice(1));
    if (verify.confidence < VERIFY_CONFIDENCE_THRESHOLD) {
      tier1Unresolved.push({
        brokenPrefix,
        count: g.tails.length,
        sample: sampleTail,
        reason: "low-confidence",
        confidence: verify.confidence,
        attemptedActual: actualPrefix,
        group: g
      });
      continue;
    }
    mappings.push({
      brokenPrefix,
      actualPrefix,
      count: g.tails.length,
      confidence: verify.confidence,
      verifyHits: verify.hits,
      verifyProbed: verify.probed,
      tier: 1
    });
  }

  // Tier 2 — deep recursive basename index for any leftover group.
  // Builds the wanted-basenames set first so the indexer only stores
  // files that we might actually need — massive memory + time win on
  // worlds with 50k+ unrelated files.
  const directReplacements = [];
  const finalUnresolved = [];
  let tier2IndexDirs = 0;
  if (tier1Unresolved.length > 0) {
    const wantedBasenames = new Set();
    for (const u of tier1Unresolved) {
      for (const tail of u.group?.tails ?? []) {
        const basename = tail.split("/").pop();
        if (basename) wantedBasenames.add(basename);
      }
    }
    let indexResult = { index: new Map(), dirsScanned: 0 };
    try {
      indexResult = await _buildFileIndex(wantedBasenames, (p) => {
        try { onProgress?.({ phase: "index", dirsScanned: p.dirsScanned, queueLength: p.queueLength, currentDir: p.currentDir }); } catch (e) {}
      });
    } catch (e) {
      console.warn("Beneos Asset Repair | _buildFileIndex failed:", e);
    }
    tier2IndexDirs = indexResult.dirsScanned;
    const index = indexResult.index;

    let tier2Probed = 0;
    for (const u of tier1Unresolved) {
      tier2Probed++;
      try { onProgress?.({ phase: "tier2", current: tier2Probed, total: tier1Unresolved.length, currentPrefix: u.brokenPrefix }); } catch (e) {}
      const res = _tier2ResolveGroup(u, index);
      if (res.mapping) {
        mappings.push(res.mapping);
      }
      if (res.directReplacements?.length) {
        directReplacements.push(...res.directReplacements);
      }
      if (res.unresolvedPaths?.length) {
        finalUnresolved.push({
          brokenPrefix: u.brokenPrefix,
          count: res.unresolvedPaths.length,
          reason: "no-basename-match",
          sample: res.unresolvedPaths[0],
          unresolvedPaths: res.unresolvedPaths
        });
      }
    }
  }

  // Strip internal `group` ref before returning (avoids leaking Foundry
  // doc references via clipboard/JSON-stringify in callers).
  return {
    mappings,
    directReplacements,
    unresolved: finalUnresolved,
    stats: {
      groupsProbed,
      mappingsFound: mappings.length,
      directReplacementsFound: directReplacements.length,
      unresolvedCount: finalUnresolved.length,
      totalPaths: brokenPaths.length,
      tier1Unresolved: tier1Unresolved.length,
      tier2IndexDirs
    }
  };
}

/* ============================================================== */
/*  Mapping application                                             */
/* ============================================================== */

function _rewriteWithMappings(value, mappings) {
  if (typeof value !== "string") return null;
  // Direct replacements (Tier-2 per-path rewrites) take priority over
  // prefix-mappings — they describe specific paths that couldn't be
  // collapsed into a single broken→actual prefix migration. Map is
  // attached to the mappings array by applyMappings via _directMap.
  if (mappings._directMap && mappings._directMap.has(value)) {
    return mappings._directMap.get(value);
  }
  for (const m of mappings) {
    if (value.startsWith(m.brokenPrefix)) {
      return m.actualPrefix + value.slice(m.brokenPrefix.length);
    }
  }
  return null;
}

const HTML_SRC_RE = /<(?:img|video|source|audio)\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi;

function _rewriteHtml(html, mappings) {
  if (typeof html !== "string" || !html) return { html, count: 0 };
  let count = 0;
  const out = html.replace(HTML_SRC_RE, (match, quote, src) => {
    const rewritten = _rewriteWithMappings(src, mappings);
    if (rewritten == null) return match;
    count++;
    return match.replace(`${quote}${src}${quote}`, `${quote}${rewritten}${quote}`);
  });
  return { html: out, count };
}

async function _applyToScene(scene, mappings) {
  let updated = 0;
  const errors = [];
  try {
    const sceneUpdate = {};
    const bg = scene.background?.src;
    const newBg = _rewriteWithMappings(bg, mappings);
    if (newBg != null) { sceneUpdate["background.src"] = newBg; updated++; }

    const fg = scene.foreground?.src ?? scene.foreground;
    if (typeof fg === "string") {
      const newFg = _rewriteWithMappings(fg, mappings);
      if (newFg != null) {
        if (typeof scene.foreground === "string") sceneUpdate["foreground"] = newFg;
        else sceneUpdate["foreground.src"] = newFg;
        updated++;
      }
    }

    const firstLevelBg = scene.firstLevel?.background?.src;
    const newFirstLevelBg = _rewriteWithMappings(firstLevelBg, mappings);
    if (newFirstLevelBg != null) { sceneUpdate["firstLevel.background.src"] = newFirstLevelBg; updated++; }

    if (Object.keys(sceneUpdate).length) {
      await scene.update(sceneUpdate);
    }
  } catch (e) {
    errors.push({ entity: `Scene:${scene.name}`, error: String(e) });
  }

  const embeddedTypes = [
    { type: "Tile", collection: scene.tiles, field: "texture.src", getter: t => t.texture?.src },
    { type: "Token", collection: scene.tokens, field: "texture.src", getter: t => t.texture?.src },
    { type: "Note", collection: scene.notes, field: "texture.src", getter: n => n.texture?.src },
    { type: "AmbientSound", collection: scene.sounds, field: "path", getter: s => s.path }
  ];

  for (const spec of embeddedTypes) {
    try {
      const docs = spec.collection;
      if (!docs?.size && !docs?.length) continue;
      const updates = [];
      for (const doc of docs) {
        const current = spec.getter(doc);
        const next = _rewriteWithMappings(current, mappings);
        if (next == null) continue;
        updates.push({ _id: doc.id, [spec.field]: next });
      }
      if (updates.length) {
        await scene.updateEmbeddedDocuments(spec.type, updates);
        updated += updates.length;
      }
    } catch (e) {
      errors.push({ entity: `Scene:${scene.name}:${spec.type}`, error: String(e) });
    }
  }

  // Note: scene.notes have a separate "icon" field on V12-era data; in V13
  // most notes use texture.src, but icon may also exist. Check both.
  try {
    const updates = [];
    for (const note of scene.notes ?? []) {
      const current = note.icon;
      const next = _rewriteWithMappings(current, mappings);
      if (next == null) continue;
      updates.push({ _id: note.id, icon: next });
    }
    if (updates.length) {
      await scene.updateEmbeddedDocuments("Note", updates);
      updated += updates.length;
    }
  } catch (e) {
    errors.push({ entity: `Scene:${scene.name}:Note.icon`, error: String(e) });
  }

  // Set the legacy auto-repair guard so canvasReady-triggered
  // _repairSceneTiles never touches this scene again — it would
  // rewrite our per-pack mappings back onto the global prefix.
  if (updated > 0) {
    try {
      await scene.setFlag(MODULE_ID, REPAIR_FLAG, true);
    } catch (e) {
      console.warn(`Beneos Asset Repair | could not set repair flag on "${scene.name}":`, e);
    }
  }

  console.log(`Beneos Asset Repair | Scene "${scene.name}" — ${updated} reference(s) rewritten, ${errors.length} error(s)`);
  return { updated, errors };
}

async function _applyToActor(actor, mappings) {
  let updated = 0;
  const errors = [];

  // Pass 1: top-level Actor fields (portrait + prototype token).
  try {
    const updateData = {};
    const newImg = _rewriteWithMappings(actor.img, mappings);
    if (newImg != null) { updateData.img = newImg; updated++; }
    const ptSrc = actor.prototypeToken?.texture?.src;
    const newPt = _rewriteWithMappings(ptSrc, mappings);
    if (newPt != null) { updateData["prototypeToken.texture.src"] = newPt; updated++; }
    if (Object.keys(updateData).length) await actor.update(updateData);
  } catch (e) {
    errors.push({ entity: `Actor:${actor.name}`, error: String(e) });
  }

  // Pass 2: embedded Items (Spells/Feats/Equipment icons).
  try {
    const itemUpdates = [];
    for (const item of actor.items ?? []) {
      const newImg = _rewriteWithMappings(item.img, mappings);
      if (newImg == null) continue;
      itemUpdates.push({ _id: item.id, img: newImg });
    }
    if (itemUpdates.length) {
      await actor.updateEmbeddedDocuments("Item", itemUpdates);
      updated += itemUpdates.length;
    }
  } catch (e) {
    errors.push({ entity: `Actor:${actor.name}:Items`, error: String(e) });
  }

  // Pass 3: embedded ActiveEffects directly on the Actor.
  // V13 uses `img`; V12 used `icon`. Foundry tolerates unknown keys on
  // update, so we set whichever field already has a value.
  try {
    const effectUpdates = [];
    for (const eff of actor.effects ?? []) {
      const current = eff.img ?? eff.icon;
      const next = _rewriteWithMappings(current, mappings);
      if (next == null) continue;
      const u = { _id: eff.id };
      if (eff.img !== undefined && eff.img !== null) u.img = next;
      else u.icon = next;
      effectUpdates.push(u);
    }
    if (effectUpdates.length) {
      await actor.updateEmbeddedDocuments("ActiveEffect", effectUpdates);
      updated += effectUpdates.length;
    }
  } catch (e) {
    errors.push({ entity: `Actor:${actor.name}:Effects`, error: String(e) });
  }

  // Pass 4: ActiveEffects embedded on Items (must be updated per-item).
  for (const item of actor.items ?? []) {
    if (!item.effects?.size && !item.effects?.length) continue;
    try {
      const updates = [];
      for (const eff of item.effects) {
        const current = eff.img ?? eff.icon;
        const next = _rewriteWithMappings(current, mappings);
        if (next == null) continue;
        const u = { _id: eff.id };
        if (eff.img !== undefined && eff.img !== null) u.img = next;
        else u.icon = next;
        updates.push(u);
      }
      if (updates.length) {
        await item.updateEmbeddedDocuments("ActiveEffect", updates);
        updated += updates.length;
      }
    } catch (e) {
      errors.push({ entity: `Actor:${actor.name}:Item:${item.name}:Effects`, error: String(e) });
    }
  }

  return { updated, errors };
}

async function _applyToJournal(journal, mappings) {
  let updated = 0;
  const errors = [];
  try {
    const newImg = _rewriteWithMappings(journal.img, mappings);
    if (newImg != null) {
      await journal.update({ img: newImg });
      updated++;
    }
  } catch (e) {
    errors.push({ entity: `Journal:${journal.name}`, error: String(e) });
  }
  try {
    const updates = [];
    for (const page of journal.pages ?? []) {
      const pageUpdate = { _id: page.id };
      let dirty = false;

      if (page.type === "image" || page.type === "video") {
        const newSrc = _rewriteWithMappings(page.src, mappings);
        if (newSrc != null) { pageUpdate.src = newSrc; dirty = true; updated++; }
      }
      if (page.type === "text" || (page.text && typeof page.text.content === "string")) {
        const { html, count } = _rewriteHtml(page.text?.content ?? "", mappings);
        if (count > 0) {
          pageUpdate["text.content"] = html;
          dirty = true;
          updated += count;
        }
      }
      if (dirty) updates.push(pageUpdate);
    }
    if (updates.length) await journal.updateEmbeddedDocuments("JournalEntryPage", updates);
  } catch (e) {
    errors.push({ entity: `Journal:${journal.name}:Pages`, error: String(e) });
  }
  return { updated, errors };
}

async function _applyToPlaylist(playlist, mappings) {
  let updated = 0;
  const errors = [];
  try {
    const updates = [];
    for (const sound of playlist.sounds ?? []) {
      const next = _rewriteWithMappings(sound.path, mappings);
      if (next == null) continue;
      updates.push({ _id: sound.id, path: next });
    }
    if (updates.length) {
      await playlist.updateEmbeddedDocuments("PlaylistSound", updates);
      updated += updates.length;
    }
  } catch (e) {
    errors.push({ entity: `Playlist:${playlist.name}`, error: String(e) });
  }
  return { updated, errors };
}

async function _applyToTable(table, mappings) {
  let updated = 0;
  const errors = [];
  try {
    const newImg = _rewriteWithMappings(table.img, mappings);
    if (newImg != null) {
      await table.update({ img: newImg });
      updated++;
    }
  } catch (e) {
    errors.push({ entity: `RollTable:${table.name}`, error: String(e) });
  }
  try {
    const updates = [];
    for (const result of table.results ?? []) {
      const next = _rewriteWithMappings(result.img, mappings);
      if (next == null) continue;
      updates.push({ _id: result.id, img: next });
    }
    if (updates.length) {
      await table.updateEmbeddedDocuments("TableResult", updates);
      updated += updates.length;
    }
  } catch (e) {
    errors.push({ entity: `RollTable:${table.name}:Results`, error: String(e) });
  }
  return { updated, errors };
}

export async function applyMappings(planOrMappings, scope, currentScene, progressCb) {
  if (!game.user?.isGM) throw new Error("beneos-asset-repair: GM required");

  // Normalize: callers can pass either a bare mappings array (legacy /
  // backward-compat) or a plan object { mappings, directReplacements }.
  let mappings;
  let directReplacements = [];
  if (Array.isArray(planOrMappings)) {
    mappings = planOrMappings;
  } else if (planOrMappings && typeof planOrMappings === "object") {
    mappings = planOrMappings.mappings ?? [];
    directReplacements = planOrMappings.directReplacements ?? [];
  } else {
    mappings = [];
  }
  if (!mappings.length && !directReplacements.length) {
    return { updated: 0, errors: [], perDocCounts: {} };
  }
  // Attach a Map<brokenPath, actualPath> to the array so the rewrite
  // helper can do O(1) exact-match lookups without changing its signature.
  if (directReplacements.length) {
    mappings._directMap = new Map(directReplacements.map(d => [d.brokenPath, d.actualPath]));
  }
  const report = (info) => { try { progressCb?.(info); } catch (e) {} };

  let updated = 0;
  const errors = [];
  const perDocCounts = {};

  if (scope === "scene") {
    if (!currentScene) {
      throw new Error("beneos-asset-repair: scene scope requires a scene");
    }
    report({ phase: "scene", current: 1, total: 1, docName: currentScene.name });
    const r = await _applyToScene(currentScene, mappings);
    updated += r.updated;
    errors.push(...r.errors);
    perDocCounts[`Scene:${currentScene.name}`] = r.updated;
    return { updated, errors, perDocCounts };
  }

  // World scope
  const passes = [
    { name: "Scene", coll: game.scenes ?? [], fn: _applyToScene },
    { name: "Actor", coll: game.actors ?? [], fn: _applyToActor },
    { name: "Journal", coll: game.journal ?? [], fn: _applyToJournal },
    { name: "Playlist", coll: game.playlists ?? [], fn: _applyToPlaylist },
    { name: "RollTable", coll: game.tables ?? [], fn: _applyToTable }
  ];

  const total = passes.reduce((sum, p) => sum + (p.coll.size ?? p.coll.length ?? 0), 0);
  let current = 0;

  for (const pass of passes) {
    for (const doc of pass.coll) {
      current++;
      report({ phase: "world", current, total, docName: `${pass.name}: ${doc.name}` });
      try {
        const r = await pass.fn(doc, mappings);
        if (r.updated) {
          updated += r.updated;
          perDocCounts[`${pass.name}:${doc.name}`] = r.updated;
        }
        if (r.errors.length) errors.push(...r.errors);
      } catch (e) {
        errors.push({ entity: `${pass.name}:${doc.name}`, error: String(e) });
      }
    }
  }

  // Items/Cards/Macros explicitly out of scope — surface in console for support.
  if ((game.items?.size ?? 0) > 0 || (game.cards?.size ?? 0) > 0 || (game.macros?.size ?? 0) > 0) {
    console.log("Beneos Asset Repair | Skipped: Items, Cards, Macros (out of scope for this feature)");
  }

  // Per-pass summary for easier diagnosis when the user reports
  // "world repair didn't touch scene X". Foundry document.update() is
  // supposed to work on inactive scenes too, so a zero-update line here
  // for an inactive scene means the scene's collections genuinely had
  // no matching paths.
  const counts = passes.reduce((acc, p) => {
    acc[p.name] = { total: p.coll.size ?? p.coll.length ?? 0, updated: 0 };
    return acc;
  }, {});
  for (const key of Object.keys(perDocCounts)) {
    const passName = key.split(":")[0];
    if (counts[passName]) counts[passName].updated++;
  }
  console.log("Beneos Asset Repair | World-scope apply summary:", counts);

  return { updated, errors, perDocCounts };
}

/* ============================================================== */
/*  Reference source lookup (Phase E "still missing")               */
/* ============================================================== */
/*
 * After applyMappings runs and Phase D verifies, some paths may still be
 * unreachable on disk. For Phase E, we need to tell the user WHERE each
 * still-missing path is referenced (which Scene's Tile, which Actor's
 * Item, etc.) so they can pick an action (Delete entity / Remove asset /
 * Ignore). We compute this lazily — only after Phase D — to avoid
 * scanning the whole world twice for the common case where everything
 * resolves cleanly.
 */
export async function findReferenceSources(paths) {
  if (!Array.isArray(paths) || !paths.length) return new Map();
  const wanted = new Set(paths);
  const result = new Map();
  for (const p of paths) result.set(p, []);

  // Lazy-import watcher to avoid a top-level circular dep (path-repair
  // is loaded before watcher in module.json; watcher imports us). Inside
  // an async function the cycle is harmless.
  const watcher = await import("./beneos-asset-watcher.js");
  const collections = [
    { coll: game.scenes ?? [],    fn: watcher.collectSceneRefs },
    { coll: game.actors ?? [],    fn: watcher.collectActorRefs },
    { coll: game.journal ?? [],   fn: watcher.collectJournalRefs },
    { coll: game.playlists ?? [], fn: watcher.collectPlaylistRefs },
    { coll: game.tables ?? [],    fn: watcher.collectTableRefs }
  ];
  for (const spec of collections) {
    for (const doc of spec.coll) {
      try {
        _weltStellenEintragen(spec.fn(doc), wanted, result);
      } catch (e) {
        console.warn(`Beneos Asset Repair | findReferenceSources(${doc?.name}) failed:`, e);
      }
    }
  }

  // Die Kompendien dazu, und das ist der Punkt dieses Zusatzes.
  //
  // Die fuenf Sammlungen oben sind Weltsammlungen. Eine installierte Beneos
  // Kreatur steht aber NICHT in der Welt, sie steht in
  // `world.beneos_module_actors` und Geschwistern (`beneos_cloud.js`,
  // `importTokenToCompendium`). Fehlt in einer Download-Welt eine oertliche
  // Datei dieser Kreatur, fand dieses Fenster die Stelle nicht und zeigte
  // "nichts zu reparieren". Gemeldet und gemessen als `OP-PRJ-192`.
  //
  // KEINE TORADRESSE KOMMT HIER AN, und das ist kein Mangel: `isBeneosPath()`
  // weist jede absolute Adresse ab (`beneos-asset-watcher.js`), mit einer
  // gemessenen Begruendung vom 12.08.2026. Dieses Fenster ist fuer oertliche
  // Dateien, und genau fuer die gilt die Luecke.
  await _kompendiumStellenSammeln(watcher, wanted, result);
  return result;
}

/**
 * Die Stellen in den Beneos-Kompendien sammeln und in `result` eintragen.
 *
 * Eigene Funktion, weil `findReferenceSources` damit sonst ueber dem
 * Richtwert `CQ-R-01` liegt: gemessen 70 Zeilen und Blocktiefe 4 gegen 60
 * und 3.
 *
 * Gesammelt wird mit DENSELBEN Sammlern, die auch ueber die Welt laufen.
 * Eine eigene Leseart haette dieselbe Feldliste zweimal, und die eine waere
 * irgendwann die alte.
 *
 * @param {object} watcher das geladene Waechtermodul
 * @param {Set<string>} wanted die gesuchten Pfade
 * @param {Map<string,Array>} result wird ergaenzt, nicht ersetzt
 */
async function _kompendiumStellenSammeln(watcher, wanted, result) {
  for (const fam of await _kompendienMitOertlichenPfaden(watcher, wanted)) {
    const sammler = watcher[SAMMLER_JE_DOKUMENTTYP[fam.name] ?? ""];
    // Fuer `Item` gibt es keinen Sammler, auch nicht fuer die Welt: der
    // Waechter laeuft ueber Szenen, Akteure, Journale, Playlists und
    // Tabellen, `game.items` ist nicht darunter. Die Gegenstands- und
    // Zauberkompendien bleiben damit aussen vor, so wie die Weltgegenstaende
    // es schon sind. Als eigener Punkt notiert, nicht hier mitgebaut.
    if (typeof sammler !== "function") continue;
    for (const doc of (fam.coll ?? [])) {
      try {
        _stellenEintragen(sammler(doc), fam, wanted, result);
      } catch (e) {
        console.warn(`Beneos Asset Repair | findReferenceSources(${fam.id}:${doc?.name}) failed:`, e);
      }
    }
  }
}

/**
 * Die gesuchten Stellen eines WELTdokuments eintragen.
 *
 * Herausgezogen, damit `findReferenceSources` den Richtwert `CQ-R-01` haelt:
 * mit dem Lauf im Rumpf stand sie bei Blocktiefe 4 gegen erlaubte 3, und das
 * schon im Bestand.
 */
function _weltStellenEintragen(stellen, wanted, result) {
  for (const ref of stellen) {
    if (!wanted.has(ref.path)) continue;
    result.get(ref.path).push(ref);
  }
}

/**
 * Die gesuchten Stellen eines Dokuments eintragen, als Kompendiumstellen.
 *
 * `ohneAktion` traegt im Dialog die Zeile ohne Knoepfe. Begruendung dort, bei
 * `_renderSourceRow()`: die Aktionen loesen ihr Dokument ueber
 * `game.actors?.get(...)` auf, und fuer eine Kompendiumkennung liefert das
 * still nichts.
 */
function _stellenEintragen(stellen, fam, wanted, result) {
  for (const ref of stellen) {
    if (!wanted.has(ref.path)) continue;
    result.get(ref.path).push({
      ...ref,
      kompendium: fam.pack?.metadata?.label ?? fam.id,
      ohneAktion: true
    });
  }
}

// Welcher Sammler des Waechters zu welchem Dokumenttyp gehoert. Die Namen sind
// die Ausfuhrnamen aus `beneos-asset-watcher.js`.
const SAMMLER_JE_DOKUMENTTYP = {
  Actor: "collectActorRefs",
  JournalEntry: "collectJournalRefs"
};

// Der Ordner, in den der Kreaturen-Installer schreibt, in beiden Formen.
//
// `beneos_cloud.js` schreibt nach `beneos_assets/cloud/tokens/<schluessel>/`
// (`:182`, `:407`), `cloud/items/` (`:2461`) und `cloud/spells/` (`:2657`).
// Die Autorenform `beneos_assets/beneos_tokens/` und ihre Geschwister stehen
// in einer Welt, die vor dem Umbau auf `cloud/` installiert hat; der
// Installer ersetzt sie heute beim Schreiben (`:2494`, `:2690`), eine alte
// Welt kann sie aber noch tragen. Beide Formen gehoeren also hierher.
const BENEOS_INSTALLORDNER_RE =
  /beneos_assets\/(?:cloud\/(?:tokens|items|spells)|beneos_(?:tokens|items|spells))\//i;

/**
 * Die Beneos-Kompendien, in denen eine gesuchte Datei ueberhaupt stehen kann.
 *
 * WARUM NICHT EINFACH ALLE VIER LADEN: `getDocuments()` kostet am Teststand
 * 30003 gemessen 79,6 Sekunden fuer alle vier, bei 239 Kreaturen und 233
 * Journalen. Dieses Fenster laeuft zwar nur, wenn wirklich eine Datei fehlt,
 * aber achtzig Sekunden Wartezeit, nur um festzustellen, dass die fehlende
 * Datei eine Karte war, sind achtzig Sekunden zu viel.
 *
 * ZWEI FUEHLER, UND BEIDE KOSTEN NICHTS.
 *
 * Erstens die GESUCHTEN PFADE. Steht unter ihnen keiner im Installordner der
 * Kreaturen, Gegenstaende oder Zauber, kann in diesen Kompendien nichts
 * davon stehen, und kein einziges wird geoeffnet. Das ist der haeufige Fall:
 * eine fehlende Kartendatei fuehrt `beneos_battlemaps/` im Pfad.
 *
 * Zweitens der INDEX, aber nur dort, wo er etwas weiss. Der Index liegt ohne
 * Ladevorgang vor und traegt `img`. Am 06.11.2026 gemessen: im
 * Kreaturenkompendium fuehren 239 von 239 Zeilen einen oertlichen
 * Beneos-Pfad in `img`, naemlich das Avatarbild, das nach Betreibervorgabe
 * vom 02.11.2026 nie gestreamt wird.
 *
 * DAS JOURNALKOMPENDIUM HAT DIESEN FUEHLER NICHT, und das ist gemessen und
 * nicht vermutet: 233 Zeilen, NULL davon mit `img`, denn ein `JournalEntry`
 * fuehrt kein solches Feld. Ein Fuehler, der nur auf `img` schaut, haette
 * dieses Kompendium nie geoeffnet, und das Journalbild einer Kreatur waere
 * genau die Datei, um die es geht. Deshalb gilt: traegt KEINE Indexzeile ein
 * `img`, weiss der Index nichts, und es entscheidet allein der erste
 * Fuehler. Ein leeres Kompendium faellt davor schon heraus.
 *
 * WARUM DER SCHLUESSELNACHZUG KEINEN VON BEIDEN HAT: der sucht TORADRESSEN,
 * und davon traegt der Index null, am selben Tag gemessen. Derselbe Index,
 * zwei Fragen, zwei Antworten.
 *
 * `BENEOS_KOMPENDIEN` steht weiter unten in dieser Datei. Gelesen wird die
 * Liste erst beim Aufruf, also lange nach dem Auswerten des Moduls.
 *
 * @param {object} watcher das geladene Waechtermodul, fuer `isBeneosPath`
 * @param {Set<string>} gesucht die Pfade, um die es geht
 * @returns {Promise<Array>} je Kompendium `{ id, name, pack, coll }`
 */
async function _kompendienMitOertlichenPfaden(watcher, gesucht) {
  let imInstallordner = false;
  for (const pfad of (gesucht ?? [])) {
    if (BENEOS_INSTALLORDNER_RE.test(pfad)) { imInstallordner = true; break; }
  }
  if (!imInstallordner) return [];

  const familien = [];
  for (const spec of BENEOS_KOMPENDIEN) {
    const pack = game.packs?.get(spec.id);
    if (!pack) continue;
    const typ = pack.metadata?.type;
    if (typ && typ !== spec.name) continue;
    const index = [...(pack.index ?? [])];
    if (!index.length) continue;
    const kenntImg = index.some((e) => typeof e?.img === "string" && e.img);
    if (kenntImg && !index.some((e) => watcher.isBeneosPath?.(e?.img))) continue;
    try {
      familien.push({ ...spec, pack, coll: await pack.getDocuments() });
    } catch (e) {
      console.warn(`Beneos Asset Repair | ${spec.id} nicht lesbar:`, e);
    }
  }
  return familien;
}

/* ============================================================== */
/*  Bilder im Journaltext einer gestreamten Welt                    */
/* ============================================================== */

// Der installierte Praefix und seine Entsprechung im Manifest. Das Gate liefert
// unter dem Manifestschluessel, die Welt haelt den installierten Pfad.
const CLOUD_BM_PREFIX = "beneos_assets/cloud/battlemaps/";
const PACK_BM_PREFIX = "beneos_assets/beneos_battlemaps/";
// Alles, was der Installer aus fremden Baeumen umgesiedelt hat, traegt seinen
// Manifestschluessel unverändert hinter diesem Praefix.
const CLOUD_PACKAGED_PREFIX = "beneos_assets/cloud/packaged/";

/** Der Teil einer Gate-Adresse bis einschliesslich der Variante, oder null. */
function _gatePraefix(adresse) {
  if (typeof adresse !== "string") return null;
  const m = adresse.match(/^(https?:\/\/[^/]+\/a\/[^/]+\/[^/]+\/[^/]+\/)/);
  return m ? m[1] : null;
}

/** Vom installierten Pfad zurueck auf den Manifestschluessel. */
function _manifestSchluessel(installiert) {
  if (installiert.startsWith(CLOUD_BM_PREFIX)) {
    return PACK_BM_PREFIX + installiert.slice(CLOUD_BM_PREFIX.length);
  }
  if (installiert.startsWith(CLOUD_PACKAGED_PREFIX)) {
    return installiert.slice(CLOUD_PACKAGED_PREFIX.length);
  }
  return null;
}

/**
 * Bilder im Journaltext einer gestreamten Welt auf das Gate umbiegen.
 *
 * WOZU. Bis zum 25.08.2026 schrieb der Streaming-Installationsweg nur Adressen
 * um, die ALLEIN in einem Feldwert stehen. Ein Handout hat aber zwei Seiten: die
 * Bildseite traegt ihre Adresse in `page.src` und wurde umgeschrieben, die
 * Textseite daneben traegt sie im HTML und blieb auf dem lokalen Pfad stehen.
 * Genau diese zweite Seite deckt die Spielleitung den Spielern auf.
 *
 * Der Installationsweg ist repariert; das hier holt nach, was bereits in Welten
 * steht. Gemessen in der Pruefwelt: 256 von 282 Textseiten, 438 Adressen.
 *
 * ES WIRD NICHT GERATEN. Der Massstab ist eine Gate-Adresse, die dasselbe
 * Journal bereits traegt, meist aus seiner Bildseite. Daraus kommt der Praefix
 * mit Schluessel, Release und Variante. Ein Journal ohne einen solchen Massstab
 * wird benannt und uebersprungen, nicht mit einem fremden Release versehen.
 *
 * @return {Promise<{journale:number, seiten:number, adressen:number, ohneMassstab:string[]}>}
 */
export async function heileJournalGateAdressen({ trocken = false } = {}) {
  const bericht = { journale: 0, seiten: 0, adressen: 0, ohneMassstab: [] };
  if (!game.user?.isGM) return bericht;

  for (const journal of game.journal ?? []) {
    // Erst sehen, ob ueberhaupt etwas zu tun ist.
    let offen = false;
    for (const page of journal.pages) {
      const html = page.text?.content;
      if (typeof html !== "string" || !html.includes("src=")) continue;
      for (const treffer of html.matchAll(HTML_SRC_RE)) {
        if (_manifestSchluessel(stripLeadSlashLocal(treffer[2]))) { offen = true; break; }
      }
      if (offen) break;
    }
    if (!offen) continue;

    // Den Massstab suchen: irgendeine Gate-Adresse desselben Journals.
    let praefix = null;
    for (const page of journal.pages) {
      praefix = _gatePraefix(page.src);
      if (praefix) break;
      const html = page.text?.content;
      if (typeof html !== "string") continue;
      for (const treffer of html.matchAll(HTML_SRC_RE)) {
        praefix = _gatePraefix(treffer[2]);
        if (praefix) break;
      }
      if (praefix) break;
    }
    if (!praefix) { bericht.ohneMassstab.push(journal.name); continue; }

    const updates = [];
    for (const page of journal.pages) {
      const html = page.text?.content;
      if (typeof html !== "string" || !html.includes("src=")) continue;
      let getroffen = 0;
      const neu = html.replace(HTML_SRC_RE, (ganz, anfuehrung, src) => {
        const schluessel = _manifestSchluessel(stripLeadSlashLocal(src));
        if (!schluessel) return ganz;
        getroffen++;
        return ganz.replace(`${anfuehrung}${src}${anfuehrung}`, `${anfuehrung}${praefix}${schluessel}${anfuehrung}`);
      });
      if (!getroffen) continue;
      updates.push({ _id: page.id, "text.content": neu });
      bericht.seiten++;
      bericht.adressen += getroffen;
    }
    if (!updates.length) continue;
    bericht.journale++;
    if (!trocken) await journal.updateEmbeddedDocuments("JournalEntryPage", updates);
  }

  if (bericht.seiten) {
    console.log(`Beneos Stream | ${bericht.adressen} Bild(er) im Journaltext auf das Gate umgebogen, `
      + `${bericht.seiten} Seite(n) in ${bericht.journale} Journal(en)`);
  }
  if (bericht.ohneMassstab.length) {
    // Das ist in aller Regel KEIN Befund. Ein Journal ganz ohne Gate-Adresse
    // gehoert meist zu einem Release, das der Kunde herunterlädt statt streamt;
    // dann liegt die Datei wirklich unter dem lokalen Pfad und ein Umbiegen
    // waere der Fehler. Gemessen in der Pruefwelt am 25.08.2026: 97 solcher
    // Journale, und fuer jedes lag der Ordner tatsaechlich auf der Platte.
    console.log(`Beneos Stream | ${bericht.ohneMassstab.length} Journal(e) unberuehrt gelassen, weil sie `
      + `keine einzige Gate-Adresse tragen. Das ist der Normalfall fuer Releases, die auf der Platte `
      + `liegen. Namen stehen in ohneMassstab.`);
  }
  return bericht;
}

/** Lokale Kopie, damit diese Datei ohne Import aus dem Streaming-Zweig auskommt. */
function stripLeadSlashLocal(p) {
  return String(p ?? "").replace(/^\/+/, "");
}

/* ============================================================== */
/*  Den Streamschluessel in einer Welt nachziehen                   */
/* ============================================================== */

/**
 * Die Wurzel einer Toradresse samt ihrem Raum, sonst null.
 *
 * ZWEI RAEUME, NICHT EINER. `a` sind die Karten, `c` die Kreaturen. Bis zum
 * 2026-11-05 stand hier nur `a`, und das war richtig, solange nur Szenen
 * Toradressen trugen. Seit `OP-PRJ-131` schreibt der Kreaturen-Installer
 * `c`-Adressen dauerhaft in Kompendium und Weltkopie. Eine Wurzel, die dieser
 * Satz nicht erkennt, wird nach einem Schluesselwechsel weder gezaehlt noch
 * umgeschrieben, und der Bericht meldet "nichts nachzuziehen", waehrend das
 * Tor auf jede alte Adresse mit dem durchsichtigen Bildpunkt antwortet: die
 * Tokens sind auf der Leinwand weg, und nichts sagt warum. Genau dieser
 * Zustand ist am 2026-09-06 fuer Szenen entstanden (`TC-PRJ-STR-051`) und war
 * der Anlass fuer diesen ganzen Nachzug.
 *
 * Der Raum kommt mit zurueck, weil die ZIELwurzel ihn braucht: aus einer
 * `c`-Adresse darf keine `a`-Adresse werden.
 *
 * @returns {{wurzel: string, raum: string}|null}
 */
function _gateWurzel(adresse) {
  if (typeof adresse !== "string") return null;
  const m = adresse.match(/^(https?:\/\/[^/]+\/([ac])\/[^/]+\/)/);
  return m ? { wurzel: m[1], raum: m[2] } : null;
}

/**
 * Eine alte Adresswurzel ueberall in einem Wert ersetzen, beliebig tief.
 *
 * WARUM DAS HIER ERLAUBT IST, UND IN `applyMappings` NICHT
 *
 * `applyMappings` geht eine Feldliste ab, und das aus gutem Grund: seine
 * Muster sind Pfadanfaenge wie `beneos_assets/...`, und die stehen auch in
 * gewoehnlichem Text. Wer dort blind durch jedes Feld liefe, schriebe
 * irgendwann in einer Beschreibung herum.
 *
 * Hier ist das Muster eine VOLLSTAENDIGE Toradresswurzel, also
 * `https://<host>/a/<schluessel>/`. Ein solcher Text entsteht nicht aus
 * Versehen. Der tiefe Lauf ist deshalb sicher und ausserdem noetig: gemessen
 * am 2026-09-06 blieben nach einem Schluesselwechsel 802 Stellen stehen, weil
 * die Feldliste `thumb` und saemtliche Flaggen nicht kennt.
 *
 * Die Abbildung ist eine `Map` von alter auf neue Wurzel und keine Liste mit
 * einem gemeinsamen Ziel. Der Grund ist der Raumbuchstabe: eine Karte wird zu
 * `.../a/<neu>/` und eine Kreatur zu `.../c/<neu>/`. Ein gemeinsames Ziel
 * haette alle Kreaturenadressen in den Kartenraum gebogen, und das Tor
 * antwortet dort mit `404 wrong-space`.
 *
 * @param {*} wert
 * @param {Map<string,string>} abbildung alte Wurzel auf neue Wurzel
 * @returns {{wert: *, anzahl: number}} der neue Wert und wie oft ersetzt wurde
 */
function _wurzelTiefErsetzen(wert, abbildung) {
  if (typeof wert === "string") {
    let neu = wert;
    let n = 0;
    for (const [alteWurzel, zielWurzel] of abbildung) {
      if (!neu.includes(alteWurzel)) continue;
      n += neu.split(alteWurzel).length - 1;
      neu = neu.split(alteWurzel).join(zielWurzel);
    }
    return { wert: neu, anzahl: n };
  }
  if (Array.isArray(wert)) {
    let n = 0;
    const neu = wert.map(v => { const r = _wurzelTiefErsetzen(v, abbildung); n += r.anzahl; return r.wert; });
    return { wert: n ? neu : wert, anzahl: n };
  }
  if (wert && typeof wert === "object") {
    let n = 0;
    const neu = {};
    for (const k of Object.keys(wert)) {
      const r = _wurzelTiefErsetzen(wert[k], abbildung);
      neu[k] = r.wert;
      n += r.anzahl;
    }
    return { wert: n ? neu : wert, anzahl: n };
  }
  return { wert, anzahl: 0 };
}

/**
 * Die vier Beneos-Weltkompendien, als Dokumentfamilien mit Dokumenttyp.
 *
 * WARUM DIESE LISTE AUF MODULEBENE STEHT
 *
 * Sie wird an zwei Stellen gebraucht: vom Nachzug nach einem
 * Schluesselwechsel und, sobald `OP-PRJ-192` Schritt 4 gebaut ist, von
 * `findReferenceSources()`. Eine Liste im Rumpf einer Funktion kann die
 * zweite Stelle nicht lesen und muesste dort ein zweites Mal entstehen. Genau
 * das ist die Bauart, die beim naechsten Umbau eine der vier vergisst.
 *
 * `world.beneos_module_spells` fuehrt `Item` als Dokumenttyp, nicht `Spell`.
 * Zauber sind in diesem System Items; belegt in `beneos_utility.js`,
 * `createCompendiums()`, wo beide Beuteraeume mit `type: "Item"` entstehen.
 */
const BENEOS_KOMPENDIEN = [
  { id: "world.beneos_module_actors",  name: "Actor",        eingebettet: {} },
  { id: "world.beneos_module_journal", name: "JournalEntry", eingebettet: { pages: "JournalEntryPage" } },
  { id: "world.beneos_module_items",   name: "Item",         eingebettet: {} },
  { id: "world.beneos_module_spells",  name: "Item",         eingebettet: {} },
];

/**
 * Die vier Kompendien laden, Dokumente inbegriffen.
 *
 * WARUM ES SIE UEBERHAUPT BRAUCHT
 *
 * Der Kreaturen-Installer schreibt NICHT in die Welt. Er schreibt in diese
 * vier Kompendien (`beneos_cloud.js`, `importTokenToCompendium` und
 * Geschwister). Dort stehen seit dem Kreaturenstreaming Toradressen, und die
 * tragen den Schluessel im Pfad. Der Nachzug lief ueber `game.scenes`,
 * `game.actors`, `game.items`, `game.journal`, `game.playlists`,
 * `game.tables` und `game.macros`, also ausschliesslich ueber
 * Weltsammlungen. Ein Kompendium ist keine davon. `OP-PRJ-131` hat am
 * 05.11.2026 den Raumbuchstaben `c` nachgetragen, also die ERKENNUNG
 * erweitert, und die REICHWEITE dabei nicht.
 *
 * DER TYP WIRD GEPRUEFT UND NICHT ANGENOMMEN. Ein Kompendium, das einen
 * anderen Dokumenttyp fuehrt als diese Liste erwartet, wird uebergangen und
 * gemeldet. Ohne diese Pruefung waere die Annahme nur ein Kommentar: `name`
 * erreicht keine Foundry-Schnittstelle, die eingebetteten Typen kommen aus
 * `eingebettet`, und fuer drei der vier ist `eingebettet` leer. Ein falscher
 * Typ fiele also nirgends auf.
 *
 * DAS LADEN IST TEUER, und zwar gemessen am 06.11.2026 am Teststand 30003:
 * `getDocuments()` kostet 31.913 ms fuer 239 Kreaturen und 11.131 ms fuer
 * 233 Journale, waehrend das Durchsuchen der geladenen Dokumente 133 ms und
 * 35 ms braucht. Das Laden ist also rund 250-mal so teuer wie das Suchen.
 * Deshalb wird diese Funktion erst gerufen, wenn feststeht, dass es etwas zu
 * schreiben gibt, und nie im Erkennungslauf.
 *
 * @param {Array|null} fehler Sammelliste; ohne sie geht die Meldung in die Konsole
 * @returns {Promise<Array>} je lesbarem Kompendium eine Familie mit `pack` und `coll`
 */
async function _beneosKompendienFamilien(fehler = null, onProgress = null) {
  const melde = (id, text) => {
    if (fehler) fehler.push({ entity: id, error: text });
    else console.error(`Beneos Asset Repair | ${id}: ${text}`);
  };
  // GEMELDET WIRD VOR DEM LADEN, nicht danach, und das ist der ganze Zweck des
  // Rueckrufs an dieser Stelle. Gemessen am 06.11.2026: `getDocuments()` kostet
  // 31.913 ms fuer das Kreaturenkompendium und 11.131 ms fuer das
  // Journalkompendium. Eine Meldung NACH dem Laden kaeme nach der Wartezeit,
  // ueber die sie den Kunden unterrichten soll.
  const sageAn = (id, nr) => {
    try { onProgress?.({ phase: "kompendium-laden", current: nr, total: BENEOS_KOMPENDIEN.length, docName: id }); }
    catch (_e) { /* ein Fortschrittsrueckruf darf den Lauf nie anhalten */ }
  };
  const familien = [];
  let nr = 0;
  for (const spec of BENEOS_KOMPENDIEN) {
    nr += 1;
    const pack = game.packs?.get(spec.id);
    // Ein FEHLENDES Kompendium ist kein Fehler: eine Welt, in die noch nie
    // eine Kreatur installiert wurde, hat keines. Ein vorhandenes, das sich
    // nicht lesen laesst oder den falschen Typ fuehrt, ist einer.
    if (!pack) continue;
    const typ = pack.metadata?.type;
    if (typ && typ !== spec.name) {
      melde(spec.id, `fuehrt Dokumenttyp ${typ}, erwartet ${spec.name}, uebergangen`);
      continue;
    }
    try {
      sageAn(spec.id, nr);
      familien.push({ ...spec, pack, coll: await pack.getDocuments() });
    } catch (e) {
      melde(spec.id, `nicht lesbar: ${_ohneSchluessel(e)}`);
    }
  }
  return familien;
}

/**
 * Jede Toradresse in einem Text durch eine schluessellose Form ersetzen.
 *
 * WOZU: Fehlermeldungen von Foundry zitieren den Feldwert, der die
 * Validierung nicht bestanden hat, und ein Feldwert ist hier eine Toradresse
 * mit dem Streamschluessel im Pfad. Diese Meldungen landen in
 * `bericht.fehler`. Heute liest das niemand aus, aber ein Bericht ist dazu
 * da, angezeigt zu werden, und dann stuende der Schluessel in der
 * Oberflaeche. Maskiert wird deshalb dort, wo der Text ENTSTEHT, und nicht
 * dort, wo er ausgegeben wird.
 *
 * Es wird LOESCHEND maskiert: der Schluessel wird durch ein festes Wort
 * ersetzt, nicht gekuerzt und nicht verfremdet.
 */
function _ohneSchluessel(wert) {
  return String(wert).replace(/(https?:\/\/[^/\s]+\/[ac]\/)[^/\s]+/g, "$1<schluessel>");
}

/**
 * Jede Toradresswurzel dieser WELT sammeln, die nicht die heutige ist.
 *
 * ERKANNT WIRD TIEF, NICHT UEBER EINE FELDLISTE.
 *
 * Bis zum 2026-09-06 nahm das Erkennen dieselbe schmale Feldliste, die auch
 * `applyMappings` fuer das Schreiben nimmt. Das hatte zwei Folgen, und die
 * zweite ist die schlimmere:
 *
 *   Es wurden Stellen nicht gefunden, die es gibt (`thumb`, alle Flaggen).
 *   Und nach einem halben Lauf meldete der Nachzug "nichts nachzuziehen",
 *   waehrend 802 Adressen noch die alte Wurzel trugen. Wer ihn ein zweites
 *   Mal rief, um aufzuraeumen, bekam die Auskunft, es sei alles gut.
 *
 * Der tiefe Lauf ist so sicher wie beim Schreiben: gesucht wird eine
 * VOLLSTAENDIGE Toradresswurzel, kein Pfadanfang. Ein solcher Text entsteht
 * nicht aus Versehen in einer Beschreibung.
 *
 * DAS SAMMELN IST HIER EINGESCHLOSSEN, und das ist der Zweck dieser
 * Funktion. Rechnen, das zwischen zwei Sammelschritten steht, haengt an
 * deren Reihenfolge; eine eigene Funktion kann das nicht mehr passieren.
 * Der letzte Sammelschritt ist der Durchlauf ueber die `src=`-Attribute der
 * Journalseiten, und er steht unten.
 *
 * KOMPENDIEN SAMMELT SIE NICHT. Begruendung und Zahlen bei
 * `_geschwisterWurzeln()`.
 *
 * @param {(raum: string) => string} zielWurzelFuer heutige Wurzel je Raum
 * @returns {{abbildung: Map<string,string>, adressen: number}}
 */
/**
 * Der lebende Griff auf `BeneosUtility`.
 *
 * VIER WEGE, UND NUR EINER TRAEGT. Am 06.11.2026 am Teststand 30003 in der
 * Welt `v13-streaming` gemessen: `globalThis.BeneosUtility`,
 * `window.BeneosUtility` und `game.beneos.utility` sind alle drei
 * `undefined`; der Griff liegt auf `game.beneos.BeneosUtility`. Eine erste
 * Fassung dieser Datei las nur `globalThis` und hatte damit einen toten Zweig:
 * der Nachzug haette die Einstellung geschrieben und den Speicher stehen
 * lassen, und der naechste Installationslauf haette den alten Stand als Ganzes
 * zurueckgeschrieben.
 *
 * Die Reihenfolge ist die von `beneos_tours.js`, um `game.beneos.BeneosUtility`
 * ergaenzt. Alle vier bleiben stehen, weil keiner davon etwas kostet und die
 * Ablage zwischen Modulfassungen schon einmal gewandert ist.
 */
function _bu() {
  return globalThis.BeneosUtility
      ?? globalThis.window?.BeneosUtility
      ?? game.beneos?.BeneosUtility
      ?? game.beneos?.utility
      ?? null;
}

/** Die Welt-Einstellung, in der der Installer die Kreaturen fuehrt. */
const REGISTER_EINSTELLUNG = "beneos-json-tokenconfig";

/**
 * Das Kreaturenregister, das der Installer je Kreatur schreibt.
 *
 * ES IST DER KOSTENLOSE FUEHLER, den Schritt 5 gesucht hat, und es gab ihn
 * die ganze Zeit. Der Kopf von `_geschwisterWurzeln()` hat am 06.11.2026
 * festgehalten, es gebe keinen billigen Fuehler auf eine Welt mit NUR
 * Kreaturen, weil der Kompendiumsindex nur `img` traegt und `img` das
 * oertliche Portrait ist. Das stimmt fuer den Index und uebersieht diese
 * Einstellung: `beneos_cloud.js` legt je Variante `token`,
 * `prototypeToken.texture.src`, und `topDown` ab, und im Streambetrieb sind
 * das Toradressen. Eine Welt-Einstellung zu lesen kostet nichts.
 *
 * DER SPEICHER GEWINNT VOR DER EINSTELLUNG. `BeneosUtility.beneosTokens` ist
 * die Fassung, mit der der Installer arbeitet und die er beim naechsten
 * Schreiben als Ganzes zurueckschreibt. Wer nur die Einstellung aendert,
 * verliert die Aenderung beim naechsten Installieren.
 *
 * @returns {object|null} das Register oder null, wenn es nicht lesbar ist
 */
function _registerLesen() {
  const roh = _bu()?.beneosTokens;
  if (roh && typeof roh === "object") return roh;
  try {
    const text = game.settings.get(MODULE_ID, REGISTER_EINSTELLUNG);
    return (typeof text === "string" && text) ? JSON.parse(text) : null;
  } catch (e) {
    console.warn("Beneos Stream | Kreaturenregister nicht lesbar:", e);
    return null;
  }
}

/**
 * Die alten Wurzeln auch im Kreaturenregister nachziehen.
 *
 * WARUM DAS NICHT OPTIONAL IST. Das Register ist kein Dokument, also fasst es
 * weder `applyMappings` noch der tiefe Lauf an. Bliebe es stehen, haette der
 * Wechsel zwei Folgen, und beide treffen den Kunden:
 *
 *   1. `BeneosUtility.getTokenImageInfo()` liefert `topDown` mit der ALTEN
 *      Wurzel. Das Tor antwortet auf eine alte Wurzel mit 200 und einem
 *      42-Byte-GIF, also mit einem leeren Bild und ohne Fehler.
 *   2. Der naechste Wechsel findet die alte Wurzel hier wieder und laedt
 *      dafuer alle vier Kompendien, gemessen rund 80 Sekunden, um dann null
 *      Felder zu aendern.
 *
 * Geschrieben wird nur, wenn wirklich etwas zu ersetzen war.
 *
 * @param {Map<string,string>} abbildung alte Wurzel auf neue Wurzel
 * @returns {Promise<{geaendert: number, fehler: string[]}>}
 */
async function _registerNachziehen(abbildung) {
  const ergebnis = { geaendert: 0, fehler: [] };
  const alt = _registerLesen();
  if (!alt) return ergebnis;
  const r = _wurzelTiefErsetzen(alt, abbildung);
  if (!r.anzahl) return ergebnis;
  try {
    await game.settings.set(MODULE_ID, REGISTER_EINSTELLUNG, JSON.stringify(r.wert));
    // ERST DIE EINSTELLUNG, DANN DER SPEICHER. Scheitert das Schreiben, bleibt
    // der Speicher auf dem alten Stand und damit auf demselben wie die
    // Einstellung. Umgekehrt stuenden zwei verschiedene Staende da.
    const bu = _bu();
    if (bu) bu.beneosTokens = r.wert;
    ergebnis.geaendert = r.anzahl;
  } catch (e) {
    ergebnis.fehler.push(`Kreaturenregister: ${e?.message ?? e}`);
  }
  return ergebnis;
}

function _alteWurzelnSammeln(zielWurzelFuer) {
  const abbildung = new Map();
  let adressen = 0;

  const merke = (adresse) => {
    const teil = _gateWurzel(adresse);
    if (!teil) return;
    adressen++;
    const ziel = zielWurzelFuer(teil.raum);
    if (teil.wurzel !== ziel) abbildung.set(teil.wurzel, ziel);
  };
  const merkeTief = (wert) => {
    if (typeof wert === "string") { merke(wert); return; }
    if (Array.isArray(wert)) { for (const v of wert) merkeTief(v); return; }
    if (wert && typeof wert === "object") { for (const k of Object.keys(wert)) merkeTief(wert[k]); }
  };

  for (const coll of [game.scenes, game.actors, game.items, game.journal,
                      game.playlists, game.tables, game.macros]) {
    for (const doc of (coll ?? [])) {
      try { merkeTief(doc.toObject()); } catch (e) {}
    }
  }

  // DAS KREATURENREGISTER GEHOERT IN DEN SAMMELSCHRITT, nicht in das Rechnen
  // darunter. Es ist eine gefundene Quelle und keine abgeleitete: der
  // Installer hat diese Adressen wirklich geschrieben. Damit zaehlt sie der
  // Bericht unter `gefunden`, und die Probe auf "wechselte wirklich nur der
  // Schluessel" bleibt heil. Eine Welt mit NUR Kreaturen wird dadurch
  // ueberhaupt erst erreicht, und das ist Schritt 5 in `OP-PRJ-192`.
  const register = _registerLesen();
  if (register) merkeTief(register);

  // Der Text einer Journalseite traegt die Adresse in einem `src=`-Attribut.
  // Der tiefe Lauf oben sieht ihn als eine Zeichenkette; das reicht, um die
  // Wurzel zu erkennen, und das Umschreiben faengt ihn ohnehin.
  for (const journal of game.journal ?? []) {
    for (const page of journal.pages) {
      const html = page.text?.content;
      if (typeof html !== "string" || !html.includes("src=")) continue;
      for (const treffer of html.matchAll(HTML_SRC_RE)) merke(treffer[2]);
    }
  }

  return { abbildung, adressen };
}

/**
 * Zu jeder bekannten alten Wurzel die Wurzel des ANDEREN Raumes ergaenzen.
 *
 * WARUM DAS RECHNEN DAS SUCHEN ERSETZT
 *
 * Ein Konto hat EINEN Streamschluessel, und er steht in beiden Raeumen im
 * selben Pfadstueck. Wer eine alte Kartenwurzel `.../a/<alt>/` in der Welt
 * findet, weiss damit auch, dass `.../c/<alt>/` alt ist. Die Kreaturen
 * stehen in Kompendien, und die zu LESEN kostet Dutzende Sekunden; sie zu
 * ERRECHNEN kostet nichts.
 *
 * DIESE FUNKTION ERFINDET KEINE ARBEIT. Sie ergaenzt nur zu Wurzeln, die
 * wirklich in einem Dokument gefunden wurden. Eine Fassung vom 06.11.2026
 * setzte zwei Wurzeln aus einem mitgegebenen alten Schluessel unbedingt in
 * die Abbildung; damit war `abbildung.size` nach jedem Wechsel mindestens 2,
 * der Ausgang "nichts nachzuziehen" unerreichbar, und es lief der volle
 * Schreibteil mit `getDocuments()` ueber alle vier Kompendien. Gemessen:
 * 89.110 ms bei NULL geaenderten Feldern, und der Kunde liest dazu
 * "0 addresses were updated ... Your maps work as before".
 *
 * SIE GEHOERT HINTER DEN LETZTEN SAMMELSCHRITT. Reines Rechnen, das mitten
 * im Sammeln steht, haengt an der Reihenfolge der Sammelschritte: eine alte
 * Wurzel, die nur im `src=`-Attribut einer Journalseite steht, bekaeme sonst
 * kein Geschwister.
 *
 * DIE ZAHLEN, die das Rechnen gegen das Suchen entscheiden, gemessen am
 * 06.11.2026 am Teststand 30003 mit 239 Kreaturen und 233 Journalen:
 *
 *   getDocuments() auf das Kreaturenkompendium   31.913 ms
 *   getDocuments() auf das Journalkompendium     11.131 ms
 *   das Durchsuchen der geladenen Dokumente         133 ms und 35 ms
 *
 * WORAUF DIESES VERFAHREN ALLEIN NICHT KAM, und wie die Luecke geschlossen
 * wurde: eine Welt, in der keine einzige Kartenadresse steht und nur
 * Kreaturen installiert sind. Dort fand der Weltlauf nichts,
 * `schluesselNachziehen` kehrte mit "nichts nachzuziehen" um, und die
 * Kreaturen behielten die alte Wurzel.
 *
 * Der Kompendiumsindex taugt dafuer nicht. Er ist gratis geladen, traegt aber
 * nur `_id`, `folder`, `img`, `name`, `sort`, `type` und `uuid`, und `img` ist
 * das oertliche Portrait; am 06.11.2026 gemessen: NULL Toradressen im Index
 * beider Kompendien.
 *
 * Der Fuehler ist stattdessen das Kreaturenregister, also die Welt-Einstellung
 * `beneos-json-tokenconfig`, die der Installer ohnehin je Kreatur schreibt.
 * Sie zu lesen kostet nichts, und im Streambetrieb stehen dort Toradressen.
 * Gelesen wird sie im Sammelschritt, siehe `_registerLesen()`; das ist
 * Schritt 5 in `OP-PRJ-192` und seit dem 06.11.2026 gebaut.
 *
 * @param {Map<string,string>} abbildung wird ergaenzt
 * @param {(raum: string) => string} zielWurzelFuer liefert die heutige Wurzel je Raum
 * @returns {string[]} die ergaenzten Wurzeln
 */
function _geschwisterWurzeln(abbildung, zielWurzelFuer) {
  const ergaenzt = [];
  for (const alteWurzel of [...abbildung.keys()]) {
    const teil = _gateWurzel(alteWurzel);
    if (!teil) continue;
    const anderer = teil.raum === "a" ? "c" : "a";
    const geschwister = alteWurzel.replace(`/${teil.raum}/`, `/${anderer}/`);
    if (abbildung.has(geschwister)) continue;
    abbildung.set(geschwister, zielWurzelFuer(anderer));
    ergaenzt.push(geschwister);
  }
  return ergaenzt;
}

/**
 * Was an einem Dokument zu aendern waere, ohne etwas zu aendern.
 *
 * WARUM GETRENNT VOM SCHREIBEN: der Plan entscheidet, ob ein Kompendium
 * ueberhaupt entsperrt werden muss. Ein Kompendium, in dem nichts zu tun
 * ist, bleibt gesperrt, und das Fenster, in dem ein zweiter Browser
 * hineinschreiben koennte, entsteht gar nicht. Planen ist billig: 472
 * Dokumente in 168 ms, gemessen am 06.11.2026.
 */
function _dokumentPlan(doc, fam, abbildung) {
  const roh = doc.toObject();
  const plan = { patch: {}, einbettungen: [], anzahl: 0 };

  for (const k of Object.keys(roh)) {
    if (k === "_id" || k in fam.eingebettet) continue;
    const r = _wurzelTiefErsetzen(roh[k], abbildung);
    if (r.anzahl) { plan.patch[k] = r.wert; plan.anzahl += r.anzahl; }
  }

  for (const [feld, typ] of Object.entries(fam.eingebettet)) {
    const liste = Array.isArray(roh[feld]) ? roh[feld] : null;
    if (!liste?.length) continue;
    const { updates, anzahl } = _einbettungsPlan(liste, abbildung);
    plan.anzahl += anzahl;
    if (updates.length) plan.einbettungen.push({ typ, updates });
  }

  return plan;
}

/**
 * Was in einer eingebetteten Sammlung zu aendern waere.
 *
 * Je Eintrag nur die Felder, die sich wirklich aendern, und `_id` dazu. Ein
 * Eintrag ohne Treffer kommt NICHT in die Liste: `updateEmbeddedDocuments`
 * mit unveraenderten Eintraegen schreibt sonst Dokumente, die niemand
 * angefasst hat, und verteilt sie an alle Spieler.
 */
function _einbettungsPlan(liste, abbildung) {
  const updates = [];
  let anzahl = 0;
  for (const eintrag of liste) {
    const teil = {};
    for (const k of Object.keys(eintrag)) {
      if (k === "_id") continue;
      const r = _wurzelTiefErsetzen(eintrag[k], abbildung);
      if (r.anzahl) { teil[k] = r.wert; anzahl += r.anzahl; }
    }
    if (Object.keys(teil).length) updates.push({ _id: eintrag._id, ...teil });
  }
  return { updates, anzahl };
}

/**
 * Einen Plan schreiben.
 *
 * Eingebettete Sammlungen werden bewusst NICHT als ganzes Feld
 * zurueckgeschrieben. Ein `update({tiles: [...]})` ersetzt die Sammlung, und
 * ein Punktpfad mit Index ersetzt sogar das ganze Array; beides ist eine
 * bekannte Falle. Stattdessen geht je Sammlung ein `updateEmbeddedDocuments`
 * mit den Feldern, die sich wirklich geaendert haben.
 *
 * @returns {Promise<number>} wie viele Dokumente angefasst wurden
 */
async function _planSchreiben(doc, plan) {
  let dokumente = 0;
  if (Object.keys(plan.patch).length) {
    await doc.update(plan.patch);
    dokumente++;
  }
  for (const { typ, updates } of plan.einbettungen) {
    await doc.updateEmbeddedDocuments(typ, updates);
    dokumente += updates.length;
  }
  return dokumente;
}

/**
 * Der zweite Durchlauf des Schluesselwechsels: alles, was die Feldliste von
 * `applyMappings` nicht erreicht, und dazu die vier Kompendien.
 *
 * Ablauf je Familie: erst planen, dann entscheiden, ob ueberhaupt etwas zu
 * tun ist, erst dann eine Sperre loesen, schreiben, und die Sperre im
 * `finally` wieder setzen.
 *
 * @param {Map<string,string>} abbildung alte Wurzel auf neue Wurzel
 * @param {Array|null} kompendien bereits geladene Kompendiumfamilien
 */
async function _restlicheWurzelnNachziehen(abbildung, kompendien = null, onProgress = null) {
  const bericht = {
    geaendert: 0, dokumente: 0, fehler: [],
    kompendien: 0, kompendiumDokumente: 0,
    geaendertWelt: 0, geaendertKompendium: 0,
  };
  if (!abbildung?.size) return bericht;

  // Die Kompendien kommen als FAMILIEN dazu und nicht als Sonderfall, damit
  // der Schreibteil einer bleibt. Der Aufrufer gibt sie mit, wenn er sie
  // schon geladen hat; zweimal `getDocuments()` ist reine Wartezeit.
  const geladen = kompendien ?? await _beneosKompendienFamilien(bericht.fehler, onProgress);
  bericht.kompendien = geladen.length;
  bericht.kompendiumDokumente = geladen.reduce((n, f) => n + f.coll.length, 0);

  // JE FAMILIE EINE MELDUNG, nicht je Dokument. Der Schreibteil ist nach der
  // Messung vom 06.11.2026 der kurze Teil des Laufs: 168 ms Durchsuchen gegen
  // 43 Sekunden Laden. Eine Meldung je Dokument waere also viel Laerm fuer die
  // Strecke, auf der ohnehin nicht gewartet wird.
  const familien = [..._weltFamilien(), ...geladen];
  let nr = 0;
  for (const fam of familien) {
    nr += 1;
    try { onProgress?.({ phase: "familie", current: nr, total: familien.length, docName: fam.id ?? fam.name }); }
    catch (_e) { /* ein Fortschrittsrueckruf darf den Lauf nie anhalten */ }
    await _familieNachziehen(fam, abbildung, bericht);
  }
  return bericht;
}

/**
 * Die Dokumentfamilien der WELT, je mit ihren eingebetteten Sammlungen.
 *
 * Die Zuordnung steht ABSICHTLICH je Familie und nicht in einer gemeinsamen
 * Tabelle: `sounds` heisst bei einer Szene `AmbientSound` und bei einer
 * Playlist `PlaylistSound`. Eine gemeinsame Tabelle haette den einen Fall
 * still auf den anderen abgebildet, und `updateEmbeddedDocuments` haette dann
 * auf einen Typ gezeigt, den es dort nicht gibt.
 *
 * Sie entsteht je Aufruf, weil `game.scenes` und Geschwister erst nach dem
 * Weltstart stehen. Eine Konstante auf Modulebene waere beim Laden leer.
 */
function _weltFamilien() {
  return [
    { name: "Scene", coll: game.scenes, eingebettet: {
        tiles: "Tile", tokens: "Token", notes: "Note", sounds: "AmbientSound",
        drawings: "Drawing", walls: "Wall", lights: "AmbientLight",
        templates: "MeasuredTemplate", regions: "Region" } },
    { name: "Actor", coll: game.actors, eingebettet: {} },
    { name: "Item", coll: game.items, eingebettet: {} },
    { name: "JournalEntry", coll: game.journal, eingebettet: { pages: "JournalEntryPage" } },
    { name: "Playlist", coll: game.playlists, eingebettet: { sounds: "PlaylistSound" } },
    { name: "RollTable", coll: game.tables, eingebettet: { results: "TableResult" } },
    { name: "Macro", coll: game.macros, eingebettet: {} },
  ];
}

/**
 * Eine Familie nachziehen: planen, dann schreiben, und eine Sperre nur so
 * lange loesen, wie wirklich geschrieben wird.
 *
 * EIN GESPERRTES KOMPENDIUM NIMMT KEINE SCHREIBVORGAENGE AN, und es meldet
 * das je Dokument einzeln. Gemessen am 06.11.2026: alle vier
 * Beneos-Kompendien des Teststandes sind gesperrt. Ohne das Loesen waere der
 * Lauf dort eine Liste von Fehlern und am Ende ein Bestand mit alter Wurzel,
 * also genau der Zustand, den dieser Nachzug verhindern soll.
 *
 * ERST PLANEN, DANN ENTSPERREN. Eine Familie ohne Arbeit wird gar nicht
 * angefasst, und das Fenster, in dem ein zweiter Browser in ein offenes
 * Kompendium schreiben koennte, entsteht nur dort, wo es unvermeidlich ist.
 */
async function _familieNachziehen(fam, abbildung, bericht) {
  const wer = fam.id ?? fam.name;

  const plaene = [];
  for (const doc of (fam.coll ?? [])) {
    try {
      const plan = _dokumentPlan(doc, fam, abbildung);
      if (plan.anzahl) plaene.push({ doc, plan });
    } catch (e) {
      bericht.fehler.push({ entity: `${wer}:${doc.name}`, error: _ohneSchluessel(e) });
    }
  }
  if (!plaene.length) return;

  const warGesperrt = fam.pack?.locked === true;
  if (warGesperrt && !await _sperreSetzen(fam, wer, false, bericht)) return;

  try {
    for (const { doc, plan } of plaene) {
      await _planZaehlen(doc, plan, fam, bericht, wer);
    }
  } finally {
    if (warGesperrt) await _sperreSetzen(fam, wer, true, bericht);
  }
}

/**
 * Die Sperre eines Kompendiums setzen oder loesen.
 *
 * @returns {Promise<boolean>} true, wenn es geklappt hat
 */
async function _sperreSetzen(fam, wer, zu, bericht) {
  try {
    await fam.pack.configure({ locked: zu });
    return true;
  } catch (e) {
    const was = zu ? "nicht wiederhergestellt" : "nicht loesbar";
    bericht.fehler.push({ entity: wer, error: `Sperre ${was}: ${_ohneSchluessel(e)}` });
    return false;
  }
}

/**
 * Einen Plan schreiben und das Ergebnis zaehlen, Welt und Kompendium getrennt.
 *
 * Die Trennung ist nicht Zierwerk: eine gemeinsame Summe kann nicht
 * beantworten, ob die Kompendien wirklich mitgezogen wurden, und genau das
 * ist die Frage von `OP-PRJ-192`.
 */
async function _planZaehlen(doc, plan, fam, bericht, wer) {
  try {
    bericht.dokumente += await _planSchreiben(doc, plan);
    bericht.geaendert += plan.anzahl;
    if (fam.pack) bericht.geaendertKompendium += plan.anzahl;
    else bericht.geaendertWelt += plan.anzahl;
  } catch (e) {
    bericht.fehler.push({ entity: `${wer}:${doc.name}`, error: _ohneSchluessel(e) });
  }
}

/**
 * Die drei Schreiblaeufe fahren und den Bericht fuellen.
 *
 * WARUM DAS EINE EIGENE FUNKTION IST. Es sind drei Laeufe ueber drei
 * verschiedene Arten von Ablage, und keiner davon ersetzt einen anderen:
 * die Feldliste von `applyMappings` ueber die Welt, der tiefe Lauf ueber
 * Felder und Flaggen in Welt UND Kompendien, und das Kreaturenregister als
 * Welt-Einstellung. Die Begruendung je Lauf steht im Rumpf.
 *
 * `bericht` wird gefuellt und nicht ersetzt, denn der Sammelschritt hat dort
 * schon `gefunden`, `adressen` und moegliche Fehler hinterlegt.
 *
 * @param {Map<string,string>} abbildung alte Wurzel auf neue Wurzel
 * @param {object} bericht wird ergaenzt
 * @param {Function|null} onProgress
 * @returns {Promise<string>} die Zeile fuer das Protokoll
 */
async function _schreibenUndBerichten(abbildung, bericht, onProgress) {
  // DIE FELDLISTE ENTSTEHT HIER, nicht beim Aufrufer. Sie wird nur im
  // Schreibteil gebraucht, und der Trockenlauf kehrt vorher um. Eine erste
  // Fassung liess sie beim Aufrufer stehen; der echte Lauf am Teststand 30003
  // meldete dann "ReferenceError: mappings is not defined", und zwar erst im
  // echten Lauf, weil der Trockenlauf diese Zeile nie erreicht.
  const mappings = [...abbildung].map(([alteWurzel, zielWurzel]) => ({
    brokenPrefix: alteWurzel,
    actualPrefix: zielWurzel,
  }));

  const ergebnis = await applyMappings(mappings, "world", null, onProgress);
  bericht.geaendert = ergebnis.updated;
  // ANHAENGEN, NICHT SETZEN. Ein nicht lesbares Kompendium ist oben schon in
  // `bericht.fehler` gelandet, und ein `=` haette es stillschweigend geloescht.
  if (ergebnis.errors?.length) bericht.fehler = [...(bericht.fehler ?? []), ...ergebnis.errors];

  // ZWEITER DURCHLAUF, und ohne ihn ist der Wechsel unvollstaendig.
  //
  // `applyMappings` geht eine Feldliste ab. Sie kennt `thumb` nicht und keine
  // einzige Flagge, weder unsere eigenen noch die fremder Module. Gemessen am
  // 2026-09-06 nach einem echten Wechsel blieben deshalb 802 Stellen stehen:
  //
  //   227  thumb
  //   223  tiles[].flags.beneos-module.stream.partner
  //   223  tiles[].flags.beneos-module.stream.video
  //    66  flags.beneos-module.creatureInstaller.srdCreatures[].positions[].texture.src
  //    26  notes[].flags.pin-cushion.showImageExplicitSource
  //    16  flags.beneos-module.creatureInstaller.srdCreatures[].art
  //    11  tiles[].flags.monks-active-tiles.actions[].data.audiofile
  //    10  tiles[].flags.monks-active-tiles.files[].name
  //
  // Die 227 in `thumb` sind der sichtbare Teil: so viele Szenen stehen nach
  // einem Wechsel ohne Vorschaubild in der Leiste.
  //
  // Die frueheren Laeufe haben das nicht gesehen, weil ihre Nachzaehlung
  // dieselben Felder zaehlte, die der Eingriff anfasst. Eine Zaehlung, die den
  // Ausschnitt des Eingriffs uebernimmt, misst die eigene Annahme.
  const rest = await _restlicheWurzelnNachziehen(abbildung, null, onProgress);
  bericht.geaendert += rest.geaendert;

  // DRITTER DURCHLAUF, und er ist weder Welt noch Kompendium. Das
  // Kreaturenregister ist eine Welt-Einstellung, also fasst es keiner der
  // beiden Laeufe an. Die Begruendung samt den zwei Folgen steht bei
  // `_registerNachziehen()`.
  const reg = await _registerNachziehen(abbildung);
  bericht.geaendert += reg.geaendert;
  bericht.registerFelder = reg.geaendert;
  if (reg.fehler.length) bericht.fehler = [...(bericht.fehler ?? []), ...reg.fehler];
  bericht.tiefNachgezogen = rest.geaendert;
  bericht.tiefDokumente = rest.dokumente;
  // DER BERICHT MUSS NENNEN, WAS ANGEFASST WURDE, und nicht nur, was sich
  // geaendert hat. Am 06.11.2026 beim Messen aufgefallen: diese zwei Zahlen
  // standen in der Konsolenzeile, aber nicht im zurueckgegebenen Bericht, und
  // damit war von aussen nicht zu sehen, ob die Kompendien ueberhaupt gelesen
  // wurden. Ein Lauf, der 0 geaenderte Felder meldet, ist sonst nicht von
  // einem Lauf zu unterscheiden, der die Kompendien nie geoeffnet hat.
  bericht.kompendien = rest.kompendien;
  bericht.kompendiumDokumente = rest.kompendiumDokumente;
  // WELT UND KOMPENDIUM GETRENNT. `applyMappings` und der Weltteil des
  // tiefen Durchlaufs sind Welt, der Kompendiumteil ist es nicht. Eine
  // gemeinsame Summe kann nicht beantworten, ob die Kompendien wirklich
  // mitgezogen wurden, und genau das ist die Frage, die dieses Paket stellt.
  bericht.geaendertWelt = ergebnis.updated + rest.geaendertWelt;
  bericht.geaendertKompendium = rest.geaendertKompendium;
  if (rest.fehler.length) bericht.fehler = [...(bericht.fehler ?? []), ...rest.fehler];

  return (`Beneos Stream | Schluessel nachgezogen: ${bericht.geaendert} Feld(er), `
    + `davon ${bericht.geaendertWelt} in der Welt und ${bericht.geaendertKompendium} im Kompendium. `
    + `${bericht.gefunden.length} alte Adresswurzel(n) GEFUNDEN, ${bericht.abgeleitet} dazu ABGELEITET, `
    + `${bericht.adressen} Toradressen gesehen, ${rest.geaendert} im tiefen Durchlauf `
    + `ueber ${rest.dokumente} Dokument(e); ${rest.kompendien} Kompendium/Kompendien `
    + `mit ${rest.kompendiumDokumente} Dokument(en) gelesen; `
    + `${reg.geaendert} Feld(er) im Kreaturenregister`);
}

/**
 * Alle Toradressen dieser Welt auf den heutigen Schluessel umschreiben.
 *
 * WOZU, UND WARUM ERST JETZT.
 *
 * Der Schluessel steht im Pfad jeder Adresse, und der Installer schreibt die
 * Adresse so in die Dokumente. Ein Schluesselwechsel machte damit jede
 * installierte Szene stumm unbrauchbar: das Tor antwortet mit dem
 * durchsichtigen Bildpunkt, die Kachel bleibt leer, und nichts sagt warum.
 * Genau das war der Rest von OP-PRJ-047, dort seit dem 21.08.2026 als
 * "Wiederherstellungshilfe" geparkt, weil sie erst gebraucht wird, wenn zum
 * ersten Mal jemand gesperrt wird oder ein Schluessel getauscht werden muss.
 *
 * Am 03.09.2026 ist der Fall eingetreten (Aufgabe 157), und zugleich ist der
 * Preis eines Wechsels gefallen: Zusagenliste, Zwischenspeicher und der Index
 * der geteilten Dateien fuehren seither die Kennung statt der Adresse. Ein
 * Wechsel kostet also **keinen Offline-Vorrat** mehr. Uebrig blieb allein das
 * Umschreiben der Dokumente, und das ist diese Funktion.
 *
 * ES WIRD NICHTS NEU GESCHRIEBEN, WAS ES SCHON GIBT. Der Weltlauf ueber alle
 * fuenf Dokumentfamilien steht seit jeher in `applyMappings`, und er arbeitet
 * mit Praefix-Abbildungen. Der ganze Wechsel ist deshalb **eine Abbildung je
 * altem Schluessel**, nicht eine je Adresse.
 *
 * ERKANNT UND GESCHRIEBEN WIRD TIEF, seit dem 2026-09-06.
 *
 * Bis dahin nahmen beide Haelften dieselbe schmale Feldliste, die auch
 * `applyMappings` nimmt. Nach einem echten Wechsel blieben dadurch 802
 * Adressen stehen, 227 davon in `thumb`, der Rest in Flaggen. Schlimmer noch:
 * ein zweiter Aufruf meldete "nichts nachzuziehen", weil das Erkennen an
 * derselben Liste haengt wie das Schreiben. Wer aufraeumen wollte, bekam die
 * Auskunft, es sei bereits alles gut.
 *
 * Beides laeuft jetzt rekursiv ueber das ganze Dokument. Das ist hier
 * zulaessig, weil gesucht und ersetzt wird, was eine VOLLSTAENDIGE
 * Toradresswurzel ist, `https://<host>/a/<schluessel>/`. Ein solcher Text
 * entsteht nicht aus Versehen in einer Beschreibung.
 *
 * GRENZE, die bleibt: eine Adresse mit einem anderen Host wird als eigene
 * Wurzel erkannt und mitgezogen. Wechselt also die Basisadresse zusammen mit
 * dem Schluessel, landet auch sie auf der heutigen Basis. Das ist gewollt.
 *
 * @param {{trocken?: boolean, onProgress?: Function}} optionen
 * @return {Promise<{alteWurzeln: string[], gefunden: string[], abgeleitet: number,
 *   adressen: number, geaendert: number, geaendertWelt: number,
 *   geaendertKompendium: number, kompendien: number,
 *   kompendiumDokumente: number, grund: string}>}
 *   `gefunden` sind Wurzeln, die wirklich in einem Dokument standen,
 *   `abgeleitet` die daraus errechneten des anderen Raumes. `alteWurzeln`
 *   bleibt die gefundenen, damit die Probe die eigene Annahme nicht misst.
 */
export async function schluesselNachziehen({ trocken = false, onProgress = null } = {}) {
  const bericht = { alteWurzeln: [], gefunden: [], abgeleitet: 0, adressen: 0, geaendert: 0, grund: "" };
  if (!game.user?.isGM) { bericht.grund = "nicht die Spielleitung"; return bericht; }

  const { streamBase, streamKey } = await import("./stream/stream-settings.mjs");

  const schluessel = streamKey();
  if (!schluessel) { bericht.grund = "kein-schluessel"; return bericht; }
  const basis = streamBase().replace(/\/+$/, "");
  const zielWurzelFuer = (raum) => `${basis}/${raum}/${encodeURIComponent(schluessel)}/`;

  // Sammeln, rechnen, entscheiden: drei Schritte, und in dieser Reihenfolge.
  const gesammelt = _alteWurzelnSammeln(zielWurzelFuer);
  const abbildung = gesammelt.abbildung;
  bericht.adressen = gesammelt.adressen;

  // DIE ENTSCHEIDUNG FAELLT AUS GEFUNDENEN WURZELN, nicht aus gerechneten.
  // `alteWurzeln` ist nach dem JSDoc dieser Funktion die Probe darauf, ob
  // wirklich nur der Schluessel wechselte. Eine Probe, die auch Wurzeln
  // zaehlt, die nie in einem Dokument standen, misst die eigene Annahme.
  bericht.gefunden = [...abbildung.keys()];
  bericht.alteWurzeln = bericht.gefunden;
  if (!abbildung.size) { bericht.grund = "nichts nachzuziehen"; return bericht; }

  // Die Kompendien werden hier NICHT gelesen, sondern errechnet. Das Laden
  // kostet Dutzende Sekunden, das Rechnen nichts, und die gemessenen Zahlen
  // samt der Grenze dieses Verfahrens stehen bei `_geschwisterWurzeln()`.
  bericht.abgeleitet = _geschwisterWurzeln(abbildung, zielWurzelFuer).length;


  // Der Trockenlauf sagt, WAS geschehen wuerde, und schreibt nichts. Er ist
  // kein Luxus: die Zahl der GEFUNDENEN Wurzeln ist die Probe darauf, ob
  // wirklich nur der Schluessel wechselte und nicht versehentlich die halbe
  // Welt auf ein fremdes Release zeigt. Die abgeleiteten Wurzeln stehen
  // bewusst daneben und nicht darin: eine uebernommene Welt mit Adressen
  // eines fremden Kontos faellt sonst nicht mehr auf, denn die Ableitung
  // verdoppelt jede fremde Wurzel in den anderen Raum.
  if (trocken) { bericht.grund = "trockenlauf"; return bericht; }

  console.log(await _schreibenUndBerichten(abbildung, bericht, onProgress));
  return bericht;
}

globalThis.beneosAssetPathRepair = {
  getPrefix: beneosGetAssetPrefix,
  resolve: beneosResolvePath,
  heileJournalGateAdressen,
  schluesselNachziehen,
  repairScene: (scene) => _repairSceneTiles(scene ?? canvas.scene),
  repairPlaylist: _repairTutorialPlaylist,
  clearCache: () => { _cachedPrefix = null; },
  scanForMappings,
  applyMappings,
  findReferenceSources,
  openRepairDialog: (opts) =>
    import("./beneos-asset-repair-dialog.js").then(m => m.BeneosRepairDialog.open(opts ?? {}))
};
