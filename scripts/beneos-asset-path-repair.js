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
        for (const ref of spec.fn(doc)) {
          if (!wanted.has(ref.path)) continue;
          result.get(ref.path).push(ref);
        }
      } catch (e) {
        console.warn(`Beneos Asset Repair | findReferenceSources(${doc?.name}) failed:`, e);
      }
    }
  }
  return result;
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

/** Die Wurzel einer Toradresse: `<schema>://<host>/a/<schluessel>/`, sonst null. */
function _gateWurzel(adresse) {
  if (typeof adresse !== "string") return null;
  const m = adresse.match(/^(https?:\/\/[^/]+\/a\/[^/]+\/)/);
  return m ? m[1] : null;
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
 * @returns {{wert: *, anzahl: number}} der neue Wert und wie oft ersetzt wurde
 */
function _wurzelTiefErsetzen(wert, alteWurzeln, zielWurzel) {
  if (typeof wert === "string") {
    let neu = wert;
    let n = 0;
    for (const alt of alteWurzeln) {
      if (!neu.includes(alt)) continue;
      n += neu.split(alt).length - 1;
      neu = neu.split(alt).join(zielWurzel);
    }
    return { wert: neu, anzahl: n };
  }
  if (Array.isArray(wert)) {
    let n = 0;
    const neu = wert.map(v => { const r = _wurzelTiefErsetzen(v, alteWurzeln, zielWurzel); n += r.anzahl; return r.wert; });
    return { wert: n ? neu : wert, anzahl: n };
  }
  if (wert && typeof wert === "object") {
    let n = 0;
    const neu = {};
    for (const k of Object.keys(wert)) {
      const r = _wurzelTiefErsetzen(wert[k], alteWurzeln, zielWurzel);
      neu[k] = r.wert;
      n += r.anzahl;
    }
    return { wert: n ? neu : wert, anzahl: n };
  }
  return { wert, anzahl: 0 };
}

/**
 * Der zweite Durchlauf des Schluesselwechsels: alles, was die Feldliste von
 * `applyMappings` nicht erreicht.
 *
 * Eingebettete Sammlungen werden bewusst NICHT als ganzes Feld
 * zurueckgeschrieben. Ein `update({tiles: [...]})` ersetzt die Sammlung, und
 * ein Punktpfad mit Index ersetzt sogar das ganze Array; beides ist eine
 * bekannte Falle. Stattdessen geht je Sammlung ein
 * `updateEmbeddedDocuments` mit den Feldern, die sich wirklich geaendert
 * haben.
 */
async function _restlicheWurzelnNachziehen(alteWurzeln, zielWurzel) {
  const bericht = { geaendert: 0, dokumente: 0, fehler: [] };
  if (!alteWurzeln?.length) return bericht;

  // Die eingebetteten Sammlungen je Familie, mit ihrem Dokumenttyp.
  //
  // Die Zuordnung steht ABSICHTLICH je Familie und nicht in einer gemeinsamen
  // Tabelle: `sounds` heisst bei einer Szene `AmbientSound` und bei einer
  // Playlist `PlaylistSound`. Eine gemeinsame Tabelle haette den einen Fall
  // still auf den anderen abgebildet, und `updateEmbeddedDocuments` haette
  // dann auf einen Typ gezeigt, den es dort nicht gibt.
  const familien = [
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

  for (const fam of familien) {
    for (const doc of (fam.coll ?? [])) {
      try {
        const roh = doc.toObject();

        // 1. Das Dokument selbst, ohne seine eingebetteten Sammlungen.
        const patch = {};
        for (const k of Object.keys(roh)) {
          if (k === "_id" || k in fam.eingebettet) continue;
          const r = _wurzelTiefErsetzen(roh[k], alteWurzeln, zielWurzel);
          if (r.anzahl) { patch[k] = r.wert; bericht.geaendert += r.anzahl; }
        }
        if (Object.keys(patch).length) { await doc.update(patch); bericht.dokumente++; }

        // 2. Die eingebetteten Sammlungen, je Sammlung ein Aufruf.
        for (const [feld, typ] of Object.entries(fam.eingebettet)) {
          const liste = Array.isArray(roh[feld]) ? roh[feld] : null;
          if (!liste?.length) continue;
          const updates = [];
          for (const eintrag of liste) {
            const teil = {};
            for (const k of Object.keys(eintrag)) {
              if (k === "_id") continue;
              const r = _wurzelTiefErsetzen(eintrag[k], alteWurzeln, zielWurzel);
              if (r.anzahl) { teil[k] = r.wert; bericht.geaendert += r.anzahl; }
            }
            if (Object.keys(teil).length) updates.push({ _id: eintrag._id, ...teil });
          }
          if (updates.length) {
            await doc.updateEmbeddedDocuments(typ, updates);
            bericht.dokumente += updates.length;
          }
        }
      } catch (e) {
        bericht.fehler.push({ entity: `${fam.name}:${doc.name}`, error: String(e) });
      }
    }
  }
  return bericht;
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
 * @return {Promise<{alteWurzeln: string[], adressen: number, geaendert: number, grund: string}>}
 */
export async function schluesselNachziehen({ trocken = false, onProgress = null } = {}) {
  const bericht = { alteWurzeln: [], adressen: 0, geaendert: 0, grund: "" };
  if (!game.user?.isGM) { bericht.grund = "nicht die Spielleitung"; return bericht; }

  const { streamBase, streamKey } = await import("./stream/stream-settings.mjs");

  const schluessel = streamKey();
  if (!schluessel) { bericht.grund = "kein-schluessel"; return bericht; }
  const zielWurzel = `${streamBase().replace(/\/+$/, "")}/a/${encodeURIComponent(schluessel)}/`;

  const alte = new Set();
  const merke = (adresse) => {
    const wurzel = _gateWurzel(adresse);
    if (!wurzel) return;
    bericht.adressen++;
    if (wurzel !== zielWurzel) alte.add(wurzel);
  };

  // ERKANNT WIRD TIEF, NICHT UEBER EINE FELDLISTE.
  //
  // Hier stand bis zum 2026-09-06 derselbe schmale Durchlauf, den auch
  // `applyMappings` fuer das Schreiben nimmt: `streamAdressenVon` je Szene
  // plus die Journalseiten. Das hat zwei Folgen gehabt, und die zweite ist die
  // schlimmere:
  //
  //   Es wurden Stellen nicht gefunden, die es gibt (`thumb`, alle Flaggen).
  //   Und nach einem halben Lauf meldete die Funktion "nichts nachzuziehen",
  //   waehrend 802 Adressen noch die alte Wurzel trugen. Wer sie ein zweites
  //   Mal ruft, um aufzuraeumen, bekam also die Auskunft, es sei alles gut.
  //
  // Der tiefe Lauf ist hier so sicher wie beim Schreiben: gesucht wird eine
  // vollstaendige Toradresswurzel, kein Pfadanfang.
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
  // Der Text einer Journalseite traegt die Adresse in einem `src=`-Attribut.
  // Der Zaehler oben sieht ihn als eine Zeichenkette; das reicht, um die
  // Wurzel zu erkennen, und das Umschreiben faengt ihn ohnehin.
  for (const journal of game.journal ?? []) {
    for (const page of journal.pages) {
      const html = page.text?.content;
      if (typeof html !== "string" || !html.includes("src=")) continue;
      for (const treffer of html.matchAll(HTML_SRC_RE)) merke(treffer[2]);
    }
  }

  bericht.alteWurzeln = [...alte];
  if (!alte.size) { bericht.grund = "nichts nachzuziehen"; return bericht; }

  const mappings = bericht.alteWurzeln.map(wurzel => ({
    brokenPrefix: wurzel,
    actualPrefix: zielWurzel,
  }));

  // Der Trockenlauf sagt, WAS geschehen wuerde, und schreibt nichts. Er ist
  // kein Luxus: die Zahl der alten Wurzeln ist die Probe darauf, ob wirklich
  // nur der Schluessel wechselte und nicht versehentlich die halbe Welt auf
  // ein fremdes Release zeigt.
  if (trocken) { bericht.grund = "trockenlauf"; return bericht; }

  const ergebnis = await applyMappings(mappings, "world", null, onProgress);
  bericht.geaendert = ergebnis.updated;
  if (ergebnis.errors?.length) bericht.fehler = ergebnis.errors;

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
  const rest = await _restlicheWurzelnNachziehen(bericht.alteWurzeln, zielWurzel);
  bericht.geaendert += rest.geaendert;
  bericht.tiefNachgezogen = rest.geaendert;
  bericht.tiefDokumente = rest.dokumente;
  if (rest.fehler.length) bericht.fehler = [...(bericht.fehler ?? []), ...rest.fehler];

  console.log(`Beneos Stream | Schluessel nachgezogen: ${bericht.geaendert} Feld(er) in `
    + `${bericht.alteWurzeln.length} alte(n) Adresswurzel(n), ${bericht.adressen} Toradressen gesehen, `
    + `davon ${rest.geaendert} im tiefen Durchlauf ueber ${rest.dokumente} Dokument(e)`);
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
