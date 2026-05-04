/**
 * Beneos ScenePacker Integration
 *
 * Gère l'importation de packages ScenePacker depuis le serveur Beneos
 * via l'objet MoulinetteImporter de ScenePacker.
 *
 * Utilise le Foundry ID de Beneos Cloud pour l'authentification.
 *
 * Battlemap Install Hardening (H1, see docs/battlemap-install-hardening.md):
 * after Scene-Packer finishes a Moulinette import, we listen on its
 * "import complete" hook and re-use the existing asset-watcher's silent
 * per-scene scan to verify every Beneos asset reference on the freshly
 * imported scene actually resolves on disk. Misses → toast + dialog so
 * the GM finds out at install-time instead of later when the scene 404s.
 */

import { scanSceneSilent, headCheck, isBeneosPath } from "./beneos-asset-watcher.js";
import { BeneosUtility } from "./beneos_utility.js";

export class BeneosScenePackerManager {
    constructor() {
        this.serverUrl = 'https://beneos.cloud';
        this.apiEndpoint = `${this.serverUrl}/api-scenepacker.php`;
        this.sessionId = null; // En fait c'est le foundryId, mais on garde le nom pour compatibilité avec le code
    }

    /**
     * Initialise le manager avec le Foundry ID depuis les settings Beneos
     */
    async initialize() {
        console.log('BeneosScenePackerManager | Initializing...');
        
        // Récupérer le Foundry ID depuis les settings Beneos
        try {
            const foundryId = game.settings.get('beneos-module', 'beneos-cloud-foundry-id');
            if (foundryId && foundryId !== '') {
                this.sessionId = foundryId;
                console.log('BeneosScenePackerManager | Foundry ID retrieved from Beneos settings');
                return true;
            }
        } catch (e) {
            console.warn('BeneosScenePackerManager | Could not retrieve Foundry ID from Beneos settings:', e);
        }
        
        console.warn('BeneosScenePackerManager | No Foundry ID available - please connect to Beneos Cloud');
        return false;
    }

    /**
     * Liste tous les packages ScenePacker disponibles
     * @returns {Promise<Array>} Liste des packages
     */
    async listPackages() {
        if (!this.sessionId) {
            throw new Error('No Foundry ID available. Please connect to Beneos Cloud first.');
        }

        try {
            console.log('BeneosScenePackerManager | Fetching packages with Foundry ID:', this.sessionId);
            
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    's': this.sessionId,
                    'a': 'list_packages'
                })
            });

            console.log('BeneosScenePackerManager | Response status:', response.status);
            console.log('BeneosScenePackerManager | Response ok:', response.ok);
            
            const data = await response.json();
            console.log('BeneosScenePackerManager | Response data:', data);
            
            if (data.status !== 'ok') {
                throw new Error(data.message || 'Failed to list packages');
            }

            console.log('BeneosScenePackerManager | Found packages:', data.packages.length);
            return data.packages;
            
        } catch (error) {
            console.error('BeneosScenePackerManager | Error listing packages:', error);
            throw error;
        }
    }

    /**
     * Récupère le packInfo pour un package spécifique
     * @param {string} packageId - ID du package
     * @returns {Promise<Object>} Le packInfo
     */
    async getPackInfo(packageId) {
        if (!this.sessionId) {
            throw new Error('No Foundry ID available. Please connect to Beneos Cloud first.');
        }

        try {
            console.log('BeneosScenePackerManager | Fetching packInfo for:', packageId);
            
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    's': this.sessionId,
                    'a': 'get_packinfo',
                    'package': packageId
                })
            });

            const data = await response.json();
            
            if (data.status !== 'ok') {
                throw new Error(data.message || 'Failed to get packInfo');
            }

            // Ajouter le session ID à toutes les URLs du packInfo
            const packInfo = this.addSessionToUrls(data.packInfo);
            
            console.log('BeneosScenePackerManager | PackInfo retrieved with', Object.keys(packInfo).length, 'files');
            return packInfo;
            
        } catch (error) {
            console.error('BeneosScenePackerManager | Error getting packInfo:', error);
            throw error;
        }
    }

    /**
     * Ajoute le session ID à toutes les URLs du packInfo
     * @param {Object} packInfo - Le packInfo original
     * @returns {Object} Le packInfo avec session ID ajouté aux URLs
     */
    addSessionToUrls(packInfo) {
        const result = {};
        
        for (const [key, url] of Object.entries(packInfo)) {
            // Ajouter le paramètre session ID à l'URL
            const separator = url.includes('?') ? '&' : '?';
            result[key] = `${url}${separator}s=${this.sessionId}`;
        }
        
        return result;
    }

    /**
     * Importe un package ScenePacker en utilisant MoulinetteImporter
     * @param {string} packageId - ID du package à importer
     * @param {Object} options - Options d'import (sceneID, actorID, etc.)
     * @returns {Promise<void>}
     */
    async importPackage(packageId, options = {}) {
        if (!this.sessionId) {
            throw new Error('No Foundry ID available. Please connect to Beneos Cloud first.');
        }

        try {
            // Vérifier que ScenePacker est installé
            if (!game.modules.get('scene-packer')?.active) {
                throw new Error('ScenePacker module is not installed or not active');
            }

            // Récupérer le packInfo
            const packInfo = await this.getPackInfo(packageId);
            
            // Vérifier que mtte.json est présent
            if (!packInfo['mtte.json']) {
                throw new Error('Invalid package: mtte.json not found');
            }

            console.log('BeneosScenePackerManager | Launching MoulinetteImporter...');

            // Charger dynamiquement MoulinetteImporter depuis ScenePacker
            const MoulinetteImporter = (await import('/modules/scene-packer/scripts/export-import/moulinette-importer.js')).default;

            // Créer les options pour MoulinetteImporter
            const importOptions = {
                packInfo: packInfo,
                sceneID: options.sceneID || '',
                actorID: options.actorID || ''
            };

            // Créer et afficher l'importer
            const importer = new MoulinetteImporter(importOptions);
            importer.render(true);
            
            console.log('BeneosScenePackerManager | MoulinetteImporter launched successfully');
            
        } catch (error) {
            console.error('BeneosScenePackerManager | Error importing package:', error);
            ui.notifications.error(`Failed to import package: ${error.message}`);
            throw error;
        }
    }

    /**
     * Affiche un dialogue pour sélectionner et importer un package
     */
    async showPackageSelector() {
        try {
            // Récupérer la liste des packages
            const packages = await this.listPackages();
            
            if (packages.length === 0) {
                ui.notifications.info('No ScenePacker packages available');
                return;
            }

            // Construire le HTML pour le dialogue
            const packagesHtml = packages.map(pkg => `
                <div class="package-item" data-package-id="${pkg.id}">
                    <h3>${pkg.name}</h3>
                    ${pkg.cover_image ? `<img src="${this.serverUrl}/scenepacker-files.php?package=${pkg.id}&file=${pkg.cover_image}&s=${this.sessionId}" alt="${pkg.name}" style="max-width: 200px;">` : ''}
                    <p><strong>Author:</strong> ${pkg.author}</p>
                    <p><strong>Version:</strong> ${pkg.version}</p>
                    <p><strong>System:</strong> ${pkg.system}</p>
                    ${pkg.description ? `<p>${pkg.description}</p>` : ''}
                    <button class="import-package" data-package-id="${pkg.id}">Import</button>
                </div>
            `).join('<hr>');

            // Afficher le dialogue
            new Dialog({
                title: 'Beneos ScenePacker - Import Package',
                content: `
                    <div style="max-height: 600px; overflow-y: auto;">
                        ${packagesHtml}
                    </div>
                `,
                buttons: {
                    close: {
                        label: 'Close',
                        callback: () => {}
                    }
                },
                render: (html) => {
                    // Attacher les événements aux boutons d'import
                    html.find('.import-package').on('click', async (event) => {
                        const packageId = event.currentTarget.dataset.packageId;
                        try {
                            await this.importPackage(packageId);
                        } catch (error) {
                            console.error('Error importing package:', error);
                        }
                    });
                }
            }).render(true);
            
        } catch (error) {
            console.error('BeneosScenePackerManager | Error showing package selector:', error);
            ui.notifications.error('Failed to load packages');
        }
    }
}

// Instance globale
let beneosScenePackerManager = null;

// Hook d'initialisation
Hooks.once('ready', async () => {
    console.log('BeneosScenePackerManager | Module ready');

    // Créer l'instance globale
    const beneosScenePackerManager = new BeneosScenePackerManager();

    // Initialiser
    const initialized = await beneosScenePackerManager.initialize();

    if (initialized) {
        console.log('BeneosScenePackerManager | Ready to import packages');

        // Exposer dans le scope global pour accès facile
        window.BeneosScenePacker = beneosScenePackerManager;

        // Commande de console pour tester
        console.log('BeneosScenePackerManager | Use window.BeneosScenePacker.showPackageSelector() to import packages');

        // Ajouter un bouton dans l'interface Moulinette (si disponible)
        // TODO: Intégrer dans l'UI Moulinette existante
    } else {
        console.warn('BeneosScenePackerManager | Not initialized - authentication required');
    }
});

/* =================================================================== */
/*  Post-install manifest scan (H1, Battlemap Install Hardening Wave 1) */
/*  + Empty-install detection (Wave 1.5)                                */
/* =================================================================== */

// Hook string is hardcoded — corresponds to the constant
// `CONSTANTS.HOOKS_IMPORTED_MOULINETTE_COMPLETE` defined in
// modules/scene-packer/scripts/constants.js (currently
// "ScenePacker.importMoulinetteComplete"). We resolve via string literal
// rather than `import { CONSTANTS }` so a Scene-Packer rename only requires
// a one-line update here, not a build-time module import that could fail
// if Scene-Packer itself is missing or downgraded.
const POSTINSTALL_HOOK = "ScenePacker.importMoulinetteComplete";
const POSTINSTALL_FAQ_URL = "https://beneos-battlemaps.com/pages/beneos-faq-black-screen-error";

// Beneos-pack URL fingerprints. The renderMoulinetteImporter listener uses
// these to decide whether to engage the install-verification path (= "this
// is our content, we should police it") or stay silent (= third-party
// Moulinette pack, not our concern).
const BENEOS_PACK_URL_FINGERPRINTS = ["beneos-battlemaps", "beneos.cloud", "beneosbattlemaps"];

// HTML escape helper — local copy keeps this file self-contained without
// pulling beneos_utility.js in for one tiny utility.
const escapeHTMLPI = (s) => String(s).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

/* ---- Pre-install bookkeeping ---- */

// Singleton slot — at any one moment Foundry is running zero or one Moulinette
// importer modally. The render hook fills this; the complete hook consumes it.
// If a second render hook fires while the first is still pending (rare race),
// the newer snapshot replaces the older one — that's fine, the older install
// would be stale anyway.
let _pendingInstall = null;

// Flag consumed once by the Setup Tour's _runAutoInstall.onInstallDone so the
// tour-level retry dialog is suppressed when the empty-install dialog has
// already taken over. See _runAutoInstall in beneos_tours.js.
let _emptyInstallFlag = false;

// Cross-file API for the tour to read+reset the flag in one shot.
globalThis.BeneosInstallTracker = {
  consumeEmptyInstallFlag() {
    const v = _emptyInstallFlag;
    _emptyInstallFlag = false;
    return v;
  },
  // Returns a snapshot of the current MoulinetteImporter render context so the
  // Setup Tour's spinner-bug workaround can re-instantiate the importer with
  // the same pack details. Not consumed — multiple reads return the same data
  // until renderMoulinetteImporter fires again with a different pack.
  getCachedPackInfo() {
    if (!_pendingInstall) return null;
    return {
      packInfo: _pendingInstall.packInfo,
      sceneID: _pendingInstall.sceneID,
      actorID: _pendingInstall.actorID
    };
  }
};

// Sniff packInfo URLs for Beneos fingerprints. ScenePacker's MoulinetteImporter
// holds the manifest as `app.packInfo` — a {filename: url} map. One match is
// enough to engage the verification path; we don't need to verify every URL.
function isBeneosPackInfo(packInfo) {
  if (!packInfo || typeof packInfo !== "object") return false;
  for (const url of Object.values(packInfo)) {
    if (typeof url !== "string") continue;
    const lower = url.toLowerCase();
    if (BENEOS_PACK_URL_FINGERPRINTS.some(fp => lower.includes(fp))) return true;
  }
  return false;
}

// Pre-install hook: ScenePacker's importer just rendered. If this is a
// Beneos pack, snapshot the world's entity IDs so the post-install hook
// can compute the diff (= entities created by this install) and walk
// their asset references for verification. Also caches the manifest +
// scene/actor IDs so the spinner-bug workaround in `_runAutoInstall` can
// re-instantiate with the same arguments.
Hooks.on("renderMoulinetteImporter", async (app, html, data) => {
  if (!game.user?.isGM) return;
  const packInfo = app?.packInfo ?? null;
  if (!isBeneosPackInfo(packInfo)) {
    BeneosUtility?.debugMessage?.("BeneosScenePacker | renderMoulinetteImporter: non-Beneos pack, skipping verification");
    return;
  }
  // Re-rendering the importer (e.g. progress updates, spinner workaround)
  // would otherwise overwrite the original snapshot — keep the first one.
  if (_pendingInstall && _pendingInstall.appId === app?.appId) {
    return;
  }
  _pendingInstall = {
    appId: app?.appId ?? null,
    timestamp: Date.now(),
    packInfo: app.packInfo,
    sceneID: app.sceneID ?? "",
    actorID: app.actorID ?? "",
    entityIdsBefore: takeEntityIdSnapshot()
  };
  BeneosUtility?.debugMessage?.(
    `BeneosScenePacker | Pre-install snapshot: appId=${_pendingInstall.appId} ` +
    `scenes=${_pendingInstall.entityIdsBefore.scenes.size} ` +
    `actors=${_pendingInstall.entityIdsBefore.actors.size} ` +
    `journals=${_pendingInstall.entityIdsBefore.journals.size}`
  );
});

/* ------------------------------------------------------------------ */
/*  Per-file install verification + selective self-healing             */
/* ------------------------------------------------------------------ */

// Patron-impact priority for asset extensions. WebM maps and intros drive
// 85% of breakage reports, WebP handouts another 13%, everything else ~2%.
// Higher priority sorts first in the missing-files list shown to the user
// so the most-impactful misses are immediately visible.
const ASSET_PRIORITY = {
  ".webm": 1,
  ".webp": 2,
  ".jpg":  3, ".jpeg": 3, ".png": 3,
  ".ogg":  4, ".mp3":  4, ".m4a": 4, ".wav": 4,
  ".pdf":  5
};
function assetPriorityOf(p) {
  const m = String(p).toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? (ASSET_PRIORITY[m[0]] ?? 99) : 99;
}

/* ------------------------------------------------------------------ */
/*  Entity ID snapshot — diff before/after install to find new docs   */
/* ------------------------------------------------------------------ */

// Snapshot the ID set of every world-document collection that ScenePacker
// might create entities in. Taking before-install and after-install
// snapshots, then diffing, gives us exactly the documents this specific
// install just produced — no flag-tagging required, no false positives
// from user-modified content.
function takeEntityIdSnapshot() {
  const snap = (coll) => new Set(coll ? [...coll].map(d => d.id) : []);
  return {
    scenes:    snap(game.scenes),
    actors:    snap(game.actors),
    journals:  snap(game.journal),
    playlists: snap(game.playlists),
    items:     snap(game.items),
    tables:    snap(game.tables)
  };
}

function diffEntitySnapshots(before, after) {
  const newDocs = { scenes: [], actors: [], journals: [], playlists: [], items: [], tables: [] };
  for (const type of Object.keys(newDocs)) {
    if (!after?.[type]) continue;
    for (const id of after[type]) {
      if (!before?.[type]?.has(id)) newDocs[type].push(id);
    }
  }
  return newDocs;
}

/* ------------------------------------------------------------------ */
/*  Per-entity-type asset-path extraction                              */
/* ------------------------------------------------------------------ */

// Each iterator yields every asset path the entity references — exactly as
// stored in the document AFTER ScenePacker's path-rewrite. That's what
// Foundry will actually try to load when the canvas opens, so it's the
// authoritative target of the verification.
function* iterateScenePaths(scene) {
  if (scene.background?.src) yield scene.background.src;
  const fg = typeof scene.foreground === "string" ? scene.foreground : scene.foreground?.src;
  if (fg) yield fg;
  if (scene.firstLevel?.background?.src) yield scene.firstLevel.background.src;
  for (const t of scene.tiles ?? [])  if (t.texture?.src) yield t.texture.src;
  for (const t of scene.tokens ?? []) if (t.texture?.src) yield t.texture.src;
  for (const n of scene.notes ?? [])  { if (n.texture?.src) yield n.texture.src; if (n.icon) yield n.icon; }
  for (const s of scene.sounds ?? []) if (s.path) yield s.path;
}
function* iterateActorPaths(actor) {
  if (actor.img) yield actor.img;
  if (actor.prototypeToken?.texture?.src) yield actor.prototypeToken.texture.src;
}
function* iterateJournalPaths(journal) {
  if (journal.img) yield journal.img;
  for (const page of journal.pages ?? []) {
    if (page.src) yield page.src;
    const html = page.text?.content;
    if (typeof html === "string" && html.length > 0) {
      // Pull <img>/<video>/<source>/<audio> src attributes out of journal
      // HTML — these are commonly handouts and embedded videos.
      const re = /<(?:img|video|source|audio)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
      let m;
      while ((m = re.exec(html)) !== null) yield m[1];
    }
  }
}
function* iteratePlaylistPaths(playlist) {
  for (const s of playlist.sounds ?? []) if (s.path) yield s.path;
}
function* iterateTablePaths(table) {
  for (const r of table.results ?? []) if (r.img) yield r.img;
}

// Walk every newly-created document and collect the union of asset paths
// they reference, filtered to Beneos-relevant paths only (`isBeneosPath`
// from beneos-asset-watcher.js skips http(s):// URLs and matches our
// canonical Beneos folder regex). Same path referenced by multiple docs
// shows up once.
function collectPathsFromNewEntities(newDocs) {
  const paths = new Set();
  const push = (p) => { if (isBeneosPath(p)) paths.add(p); };
  for (const id of newDocs.scenes)    { const d = game.scenes?.get(id);    if (d) for (const p of iterateScenePaths(d))    push(p); }
  for (const id of newDocs.actors)    { const d = game.actors?.get(id);    if (d) for (const p of iterateActorPaths(d))    push(p); }
  for (const id of newDocs.journals)  { const d = game.journal?.get(id);   if (d) for (const p of iterateJournalPaths(d))  push(p); }
  for (const id of newDocs.playlists) { const d = game.playlists?.get(id); if (d) for (const p of iteratePlaylistPaths(d)) push(p); }
  for (const id of newDocs.tables)    { const d = game.tables?.get(id);    if (d) for (const p of iterateTablePaths(d))    push(p); }
  return [...paths];
}

// HEAD-fetch each path and split into present / missing. Bulk-parallel for
// speed (paths are independent). On the missing side, attach the priority
// so the caller can sort.
async function checkPathsOnDisk(paths) {
  const results = await Promise.all(paths.map(async (p) => {
    const r = await headCheck(p);
    return { path: p, ok: r.ok, status: r.status };
  }));
  const missing = results
    .filter(r => !r.ok)
    .map(r => ({ path: r.path, priority: assetPriorityOf(r.path) }));
  missing.sort((a, b) => a.priority - b.priority);
  return { missing, checked: results.length };
}

/* ------------------------------------------------------------------ */
/*  Install-problem notification dialog                                */
/* ------------------------------------------------------------------ */

// Honest disclosure of an incomplete install. The detection layer found
// Beneos asset paths referenced by entities the install just created which
// don't resolve on disk — i.e. some files didn't make it through the
// Moulinette pipeline. The module itself can't repair this: Moulinette
// doesn't overwrite existing scenes/journals/assets, and re-running the
// importer just dedups against whatever is already on disk. The patron's
// only reliable fix is to delete the partial install and re-install via
// Moulinette manually.
//
// This dialog says exactly that. It does NOT offer a "try again" button
// because that would imply automatic recovery we can't deliver. It DOES
// offer a one-click clipboard copy of the affected paths so the patron
// can drop the list into the Beneos Discord support channel if needed,
// plus an "Open Moulinette" button to take them straight to the manual
// reinstall path.
const showInstallProblemDialog = (packLabel, missing, totalCount) => {
  const items = missing
    .map(e => `<li><code>[p${e.priority}] ${escapeHTMLPI(e.path)}</code></li>`)
    .join("");

  const intro = game.i18n.format("BENEOS.Cloud.InstallVerify.DialogIntro", {
    pack: packLabel,
    missing: missing.length,
    total: totalCount
  });
  const guidance = game.i18n.localize("BENEOS.Cloud.InstallVerify.DialogGuidance");
  const showLabel = game.i18n.localize("BENEOS.Cloud.InstallVerify.DialogShowList");

  const content = `
    <p>${intro}</p>
    <p>${guidance}</p>
    <details>
      <summary>${showLabel}</summary>
      <ul class="beneos-aw-pathlist">${items}</ul>
    </details>
  `;

  // Clipboard payload for the support flow — pack name first, then one line
  // per path with priority tag so the Beneos team can scan-read.
  const clipboardText = `Pack: ${packLabel}\n` +
    missing.map(e => `[p${e.priority}] ${e.path}`).join("\n");

  const dlg = new Dialog({
    title: game.i18n.localize("BENEOS.Cloud.InstallVerify.DialogTitle"),
    content,
    buttons: {
      reopen: {
        icon: '<i class="fas fa-rotate-right"></i>',
        label: game.i18n.localize("BENEOS.Cloud.InstallVerify.DialogActionReopenMoulinette"),
        callback: () => {
          try { game.modules.get("moulinette")?.browser?.render?.(true); }
          catch (e) {}
        }
      },
      copy: {
        icon: '<i class="fas fa-copy"></i>',
        label: game.i18n.localize("BENEOS.Cloud.InstallVerify.DialogActionCopyPaths"),
        callback: async () => {
          try {
            await navigator.clipboard.writeText(clipboardText);
            ui.notifications.info(game.i18n.localize("BENEOS.Cloud.InstallVerify.CopyConfirm"));
          } catch (e) {
            console.warn("[Beneos] clipboard copy failed:", e);
          }
        }
      },
      close: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("BENEOS.Cloud.InstallVerify.DialogActionClose")
      }
    },
    default: "reopen"
  }, { classes: ["beneos-asset-watcher-dialog"] });
  dlg.render(true);
};



const showPostInstallDialog = (scene, missing) => {
  const sceneName = escapeHTMLPI(scene?.name ?? "");
  const items = missing.map(p => `<li><code>${escapeHTMLPI(p)}</code></li>`).join("");
  const intro = game.i18n.format("BENEOS.AssetWatcher.PostInstall.DialogIntro", {
    count: missing.length,
    scene: sceneName
  });

  const content = `
    <p>${intro}</p>
    <ul class="beneos-aw-pathlist">${items}</ul>
    <p>${game.i18n.localize("BENEOS.AssetWatcher.PostInstall.DialogHint")}</p>
  `;

  const dlg = new Dialog({
    title: game.i18n.localize("BENEOS.AssetWatcher.PostInstall.DialogTitle"),
    content,
    buttons: {
      faq: {
        icon: '<i class="fas fa-book"></i>',
        label: game.i18n.localize("BENEOS.AssetWatcher.PostInstall.DialogActionRetry"),
        callback: () => {
          // Stub — opens the troubleshooting FAQ for now. H6 will rewire
          // this to re-launch the Moulinette window prefilled with the
          // same packId so the GM can rerun the install in one click.
          try { window.open(POSTINSTALL_FAQ_URL, "_blank", "noopener,noreferrer"); }
          catch (e) {}
        }
      },
      close: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("BENEOS.AssetWatcher.PostInstall.DialogActionDismiss")
      }
    },
    default: "faq"
  }, { classes: ["beneos-asset-watcher-dialog"] });

  dlg.render(true);
};

Hooks.on(POSTINSTALL_HOOK, async (payload = {}) => {
  // Only the GM ran the install (and only the GM can act on the result),
  // so suppress this for player-clients that happen to receive the hook.
  if (!game.user?.isGM) return;

  // ---- Entity-diff verification ----
  // Compute the set of documents this install actually created and walk
  // their asset references against disk. This avoids the manifest-vs-disk
  // path-rewrite confusion of older approaches: we verify exactly what
  // the entities ended up referencing, which is what Foundry will load
  // when the scene opens.
  const pending = _pendingInstall;
  _pendingInstall = null;
  if (pending && pending.entityIdsBefore) {
    // Give ScenePacker a moment to flush its final document writes. The
    // complete hook fires before all entities are necessarily committed
    // to game.scenes / game.journal / etc.
    await new Promise(r => setTimeout(r, 1500));

    const idsAfter = takeEntityIdSnapshot();
    const newDocs = diffEntitySnapshots(pending.entityIdsBefore, idsAfter);
    const newCount = newDocs.scenes.length + newDocs.actors.length + newDocs.journals.length
                   + newDocs.playlists.length + newDocs.tables.length + newDocs.items.length;

    BeneosUtility?.debugMessage?.(
      `BeneosScenePacker | Entity diff: scenes=${newDocs.scenes.length} actors=${newDocs.actors.length} ` +
      `journals=${newDocs.journals.length} playlists=${newDocs.playlists.length} tables=${newDocs.tables.length}`
    );

    if (newCount === 0) {
      // No new entities — install may have been a no-op (already-imported
      // pack). Nothing to verify; treat as success.
      BeneosUtility?.debugMessage?.("BeneosScenePacker | No new entities created; verification skipped");
      return;
    }

    const beneosPaths = collectPathsFromNewEntities(newDocs);
    if (beneosPaths.length === 0) {
      // New entities were created but they reference no Beneos paths —
      // this could be an unusual pack. Nothing to verify.
      BeneosUtility?.debugMessage?.("BeneosScenePacker | New entities have no Beneos paths to verify");
      return;
    }

    const { missing, checked } = await checkPathsOnDisk(beneosPaths);

    if (missing.length === 0) {
      BeneosUtility?.debugMessage?.(
        `BeneosScenePacker | Install verified: all ${checked} Beneos paths resolve on disk`
      );
      return; // Happy path — silent success, no toast, no dialog.
    }

    // Some Beneos paths don't resolve on disk. Surface this honestly: the
    // module can detect the problem and tell the user what's broken, but it
    // can't reinstall via Moulinette (Moulinette doesn't overwrite existing
    // documents). The patron has to delete the affected pack/scenes and
    // re-install manually. We don't pretend otherwise.
    const packLabel = payload?.info?.name
      ?? game.i18n.localize("BENEOS.Cloud.InstallVerify.FallbackPackName");

    _emptyInstallFlag = true; // Tell the Setup Tour's auto-install path to
                              // step aside — we own the recovery UX now.

    // Loud console log so the GM can verify what we flagged without
    // enabling beneosDebug. Priority tags (p1=webm, p2=webp, …) show at a
    // glance what kinds of files are affected.
    console.warn(
      `[Beneos] Incomplete install detected for "${packLabel}": ` +
      `${missing.length} of ${checked} Beneos paths missing on disk`,
      missing.map(m => `[p${m.priority}] ${m.path}`)
    );

    showInstallProblemDialog(packLabel, missing, checked);
    return;
  }

  // ---- Per-scene asset reference check (fallback when no manifest) ----
  const sceneId = payload.sceneID;
  // Asset/actor-only imports come through this hook too with empty sceneID —
  // the asset-watcher's existing canvasReady pipeline already covers those
  // when the user opens any scene that uses them. Skip here.
  if (!sceneId) return;

  const scene = game.scenes?.get?.(sceneId);
  if (!scene) return;

  let result;
  try { result = await scanSceneSilent(scene); }
  catch (e) {
    console.warn("[Beneos] PostInstall scan failed:", e);
    return;
  }

  const { paths = [], missing = [] } = result ?? {};
  if (!paths.length) {
    // Scene has no Beneos asset references at all — nothing to verify,
    // nothing to report. (Could happen if a non-Beneos pack was imported.)
    return;
  }

  if (!missing.length) {
    // All-OK case is debug-level only — no notification, no dialog.
    BeneosUtility?.debugMessage?.(
      `BeneosScenePacker | PostInstall scan: all ${paths.length} files OK on scene "${scene.name}"`
    );
    return;
  }

  // Misses: toast warning + actionable dialog. The toast surfaces the
  // count even if the user dismisses the dialog without reading it.
  ui.notifications.warn(
    game.i18n.format("BENEOS.AssetWatcher.PostInstall.MissingN", {
      count: missing.length,
      scene: scene.name ?? ""
    })
  );

  showPostInstallDialog(scene, missing);
});
