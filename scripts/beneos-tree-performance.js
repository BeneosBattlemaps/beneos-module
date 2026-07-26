/**
 * Sidebar folder tree performance for large worlds.
 *
 * Foundry rebuilds a collection's entire folder tree on every change to a
 * top-level document of that collection. See DirectoryCollectionMixin in
 * foundry.mjs:
 *
 *     _onModifyContents(action, documents, result, operation, user) {
 *       if ( !operation.parent ) this.initializeTree();
 *
 * Embedded documents (tokens, tiles, drawings, journal pages) are exempt, but
 * every scene.update() and every scene.setFlag() triggers a full rebuild.
 *
 * The core builder is O(folders x entries): #classifyFolderContent re-partitions
 * the complete remaining folder and entry arrays once per folder, allocating two
 * fresh arrays each time, and sorts the contents with localeCompare.
 *
 * Measured in the Beneos Universe world (2124 scenes in 1206 folders, 5856
 * journal entries in 342 folders):
 *
 *     game.scenes.initializeTree()    1035 to 1129 ms
 *     game.journal.initializeTree()   1112 to 1135 ms
 *
 * Activating a scene writes a scene document, and deactivating the previous one
 * writes a second, so a plain scene switch froze the interface for about two
 * seconds. Recording the same world at the network layer showed HEAD responses
 * that the server answered in 3 ms arriving in JavaScript 1.4 to 2.3 seconds
 * later, which is that rebuild blocking the main thread.
 *
 * This file replaces the builder with an equivalent grouping pass that indexes
 * folders and entries by their parent once, then walks the tree, which is
 * O(folders + entries). The resulting tree is structurally identical to the one
 * the core builder produces, including the less obvious details:
 *
 *   - folders whose parent is missing, and folders below maxFolderDepth, are
 *     never linked into the tree, yet they still consume their entries, so those
 *     entries vanish from the sidebar rather than falling back to the root
 *   - the deepest allowed level receives entries but no children
 *   - each node sorts by its own folder's sorting mode, and the root is then
 *     re-sorted by the collection's sorting mode
 *
 * Correctness is not asserted, it is checked: game.beneos.treePerf.verify()
 * builds both trees on the live world and deep-compares them.
 *
 * Two safety valves keep the risk contained. Small collections stay on the core
 * builder untouched, and any unexpected shape or thrown error falls back to the
 * core builder for that call.
 *
 * A direct prototype patch is used rather than libWrapper because the target is
 * a mixin-produced prototype that has no stable dotted path, and because the
 * accessor `tree` has to be replaced together with the method that fills it.
 */

const MODULE_ID = "beneos-module";

/** Where the replacement tree is parked. The `tree` accessor prefers it. */
const FAST_TREE = Symbol("beneosFastTree");

/** Marks the prototype as patched so a double import cannot stack wrappers. */
const PATCHED = Symbol("beneosTreePatched");

/**
 * Below this many folder-times-entry comparisons the core builder costs well
 * under a millisecond, so it is left alone and small worlds keep stock
 * behaviour exactly.
 */
const MIN_WORK = 20000;

const state = {
  enabled: true,
  core: null
};

const warn = (...args) => console.warn(`${MODULE_ID} | tree-performance |`, ...args);

/* -------------------------------------------- */

/**
 * The parent folder id a document is filed under, or null for the root.
 *
 * Mirrors the core #classifyFolderContent matcher, which accepts a Folder
 * document, a raw id string, or nothing at all:
 *
 *     if ( entry.folder?._id ) return entry.folder._id === folder?._id;
 *     return (entry.folder === folder) || (entry.folder === folder?._id);
 *
 * @param {object} doc
 * @returns {string|null}
 */
function parentKey(doc) {
  const folder = doc.folder;
  if (folder?._id) return folder._id;
  if ((folder === null) || (folder === undefined)) return null;
  return (typeof folder === "string") ? folder : null;
}

/**
 * Whether every document can be grouped by a plain key. Anything else would have
 * to be matched by object identity, which the core builder does but grouping
 * cannot, so those collections stay on the core builder.
 * @param {object[]} docs
 * @returns {boolean}
 */
function isGroupable(docs) {
  for (const doc of docs) {
    const folder = doc.folder;
    if ((folder === null) || (folder === undefined)) continue;
    if (typeof folder === "string") continue;
    if ((typeof folder === "object") && folder._id) continue;
    return false;
  }
  return true;
}

function pushInto(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/* -------------------------------------------- */

/**
 * Build the folder tree in O(folders + entries).
 * @param {DocumentCollection} collection
 * @param {Folder[]} folders            Same input the core builder receives.
 * @param {object[]} entries            Same input the core builder receives.
 * @returns {object}                    A tree node structure identical to core's.
 */
export function buildFastTree(collection, folders, entries) {
  const cls = collection.constructor;
  const sortAlphabetical = cls._sortAlphabetical;
  const sortStandard = cls._sortStandard;
  const maxFolderDepth = collection.maxFolderDepth;

  // Single indexing pass. This is what replaces the repeated partitioning.
  const foldersByParent = new Map();
  const entriesByFolder = new Map();
  for (const folder of folders) pushInto(foldersByParent, parentKey(folder), folder);
  for (const entry of entries) pushInto(entriesByFolder, parentKey(entry), entry);

  const createNode = (root, folder, depth) => ({ root, folder, depth, visible: false, children: [], entries: [] });
  const tree = createNode(true, null, 0);

  // Breadth-first by depth, mirroring the core loop bound of maxFolderDepth + 1
  // and its `handled` guard against folder cycles.
  const handled = new Set();
  const claimedFolders = new Set();
  const claimedEntries = new Set();
  let level = [tree];

  for (let depth = 1; depth <= maxFolderDepth + 1; depth++) {
    if (!level.length) break;
    const allowChildren = depth <= maxFolderDepth;
    const next = [];

    for (const node of level) {
      if (!node.root) {
        if (handled.has(node.folder.id)) continue;
        handled.add(node.folder.id);
      }
      const key = node.root ? null : node.folder._id;
      const sort = (node.folder?.sorting === "a") ? sortAlphabetical : sortStandard;

      const contents = entriesByFolder.get(key);
      if (contents) {
        node.entries = contents.slice().sort(sort);
        for (const entry of contents) claimedEntries.add(entry);
      }

      if (allowChildren) {
        const subfolders = foldersByParent.get(key);
        if (subfolders) {
          const sorted = subfolders.slice().sort(sort);
          node.children = sorted.map(folder => createNode(false, folder, depth));
          for (const folder of sorted) claimedFolders.add(folder);
          next.push(...node.children);
        }
      }
    }
    level = next;
  }

  // Folders the walk never reached: their parent is gone, or they sit below the
  // depth limit. Core creates a throwaway node for each, lets it swallow its
  // entries, and then drops the node without linking it in. Those entries are
  // therefore absent from the sidebar, and that is reproduced here deliberately
  // so the two builders agree.
  for (const folder of folders) {
    if (claimedFolders.has(folder)) continue;
    const contents = entriesByFolder.get(folder._id);
    if (contents) for (const entry of contents) claimedEntries.add(entry);
  }

  // Whatever is still unclaimed belongs to the root.
  const leftovers = [];
  for (const entry of entries) if (!claimedEntries.has(entry)) leftovers.push(entry);
  if (leftovers.length) tree.entries.push(...leftovers);

  // The root is re-sorted by the collection's mode, not by a folder's.
  const rootSort = (collection.sortingMode === "a") ? sortAlphabetical : sortStandard;
  tree.entries.sort(rootSort);
  tree.children.sort((a, b) => rootSort(a.folder, b.folder));

  // Identical to core: prune invisible branches bottom-up and stamp the folder
  // documents that the sidebar templates read.
  const isGM = game.user.isGM;
  const filterChildren = node => {
    node.children = node.children.filter(child => {
      filterChildren(child);
      return child.visible;
    });
    node.visible = node.root || isGM || ((node.children.length + node.entries.length) > 0);
    if (node.folder) {
      node.folder.displayed = node.visible;
      node.folder.depth = node.depth;
      node.folder.children = node.children;
    }
  };
  filterChildren(tree);

  return tree;
}

/* -------------------------------------------- */

/** Walk up from an object until the prototype that owns `initializeTree`. */
function locatePrototype() {
  const seeds = [
    globalThis.foundry?.documents?.collections?.Scenes?.prototype,
    globalThis.foundry?.documents?.collections?.Journal?.prototype,
    globalThis.Scenes?.prototype
  ];
  for (const seed of seeds) {
    let proto = seed;
    while (proto) {
      if (Object.prototype.hasOwnProperty.call(proto, "initializeTree")) return proto;
      proto = Object.getPrototypeOf(proto);
    }
  }
  return null;
}

function install() {
  const proto = locatePrototype();
  if (!proto) {
    warn("could not locate the collection prototype, leaving core behaviour in place");
    return false;
  }
  if (proto[PATCHED]) return true;

  const coreInitializeTree = proto.initializeTree;
  const coreTreeDescriptor = Object.getOwnPropertyDescriptor(proto, "tree");
  if ((typeof coreInitializeTree !== "function") || (typeof coreTreeDescriptor?.get !== "function")) {
    warn("unexpected shape of initializeTree or the tree accessor, leaving core behaviour in place");
    return false;
  }

  Object.defineProperty(proto, "tree", {
    configurable: true,
    enumerable: coreTreeDescriptor.enumerable,
    get() {
      const fast = this[FAST_TREE];
      return (fast !== undefined) ? fast : coreTreeDescriptor.get.call(this);
    }
  });

  proto.initializeTree = function () {
    let folders;
    let entries;
    try {
      folders = this.folders?.contents ?? [];
      entries = this._getVisibleTreeContents();
    } catch (err) {
      delete this[FAST_TREE];
      return coreInitializeTree.call(this);
    }

    const worthIt = state.enabled && ((folders.length * entries.length) >= MIN_WORK);
    if (!worthIt || !isGroupable(folders) || !isGroupable(entries)) {
      delete this[FAST_TREE];
      return coreInitializeTree.call(this);
    }

    try {
      this[FAST_TREE] = buildFastTree(this, folders, entries);
    } catch (err) {
      console.error(`${MODULE_ID} | tree-performance | fast build failed, falling back to core:`, err);
      delete this[FAST_TREE];
      coreInitializeTree.call(this);
    }
  };

  proto[PATCHED] = true;
  state.core = { proto, initializeTree: coreInitializeTree, tree: coreTreeDescriptor };
  return true;
}

/* -------------------------------------------- */

/** Reduce a tree to the parts that have to match: shape, order and visibility. */
function snapshot(node) {
  return {
    depth: node.depth,
    folder: node.folder?.id ?? null,
    visible: node.visible,
    entries: node.entries.map(entry => entry.id ?? entry._id ?? null),
    children: node.children.map(snapshot)
  };
}

/**
 * Build both trees for every collection and compare them. This is the evidence
 * that the replacement is equivalent on real data, not an assertion that it is.
 * @param {object} [options]
 * @param {boolean} [options.log=true]
 * @returns {object[]}
 */
export function verify({ log = true } = {}) {
  if (!state.core) {
    warn("not installed, nothing to verify");
    return [];
  }
  const report = [];

  for (const collection of game.collections) {
    let folders;
    let entries;
    try {
      folders = collection.folders?.contents ?? [];
      entries = collection._getVisibleTreeContents();
    } catch (err) {
      continue;
    }
    if (!folders.length && !entries.length) continue;
    if (!isGroupable(folders) || !isGroupable(entries)) {
      report.push({ collection: collection.documentName, skipped: "not groupable" });
      continue;
    }

    // Core first, because both builders stamp folder.displayed / depth / children
    // and the fast run has to leave the final state behind.
    const coreStart = performance.now();
    state.core.initializeTree.call(collection);
    const coreMs = performance.now() - coreStart;
    const coreSnapshot = snapshot(state.core.tree.get.call(collection));

    const fastStart = performance.now();
    const fast = buildFastTree(collection, folders, entries);
    const fastMs = performance.now() - fastStart;
    collection[FAST_TREE] = fast;
    const fastSnapshot = snapshot(fast);

    report.push({
      collection: collection.documentName,
      folders: folders.length,
      entries: entries.length,
      coreMs: Number(coreMs.toFixed(1)),
      fastMs: Number(fastMs.toFixed(1)),
      speedup: Number((coreMs / Math.max(fastMs, 0.01)).toFixed(1)),
      identical: JSON.stringify(coreSnapshot) === JSON.stringify(fastSnapshot)
    });
  }

  if (log) console.table(report);
  return report;
}

/** Hand every collection back to the core builder. */
export function disable() {
  state.enabled = false;
  if (!state.core) return;
  for (const collection of game.collections) {
    delete collection[FAST_TREE];
    try { state.core.initializeTree.call(collection); } catch (err) { /* collection has no tree */ }
  }
}

/** Re-enable the fast builder and rebuild every tree with it. */
export function enable() {
  state.enabled = true;
  for (const collection of game.collections) {
    try { collection.initializeTree(); } catch (err) { /* collection has no tree */ }
  }
}

/* -------------------------------------------- */

const installed = install();

Hooks.once("ready", () => {
  if (!installed) return;
  game.beneos = game.beneos ?? {};
  game.beneos.treePerf = { verify, enable, disable, buildFastTree, state };
});
