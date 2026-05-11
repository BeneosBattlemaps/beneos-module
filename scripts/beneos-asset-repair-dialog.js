/**
 * Beneos Asset Repair Dialog
 *
 * Dynamic-imported by:
 *   - beneos-asset-watcher.js::showDialog          (Repair button)
 *   - beneos-scenepacker.js::showInstallProblemDialog / showPostInstallDialog
 *   - beneos-asset-watcher.js::init via registerMenu (settings entry)
 *
 * Phases:
 *   A. Scope picker (skipped when initialScope is "scene"/"world")
 *   B. Scan      — runs scanAllEntities (world) or scanSceneSilent (scene)
 *                  + scanForMappings, both with a visible progress bar
 *   C. Preview   — lists resolved mappings + unresolved entries, Apply gate
 *   D. Apply     — calls applyMappings with progress, post-scan verification
 *   E. Result    — summary + per-path source list with three action buttons
 *                  per source (Delete entity / Remove asset / Ignore) +
 *                  Discord link + Troubleshooting Report copy
 *
 * No CSS injection — reuses `.beneos-asset-watcher-dialog` from
 * beneos-asset-watcher.js which is loaded at module init.
 */
import {
  scanSceneSilent,
  scanAllEntities,
  collectBeneosRefs
} from "./beneos-asset-watcher.js";
import {
  scanForMappings,
  applyMappings,
  findReferenceSources,
  _parseBrokenPath as _parseBrokenPathInternal
} from "./beneos-asset-path-repair.js";

const MODULE_ID = "beneos-module";
const FLAG_DISMISSED = "dismissedMissingAssets";
const BENEOS_DISCORD_URL = "https://discord.gg/R2yBH557Wk";
const DEFAULT_ITEM_ICON = "icons/svg/item-bag.svg";
const DEFAULT_TOKEN_ICON = "icons/svg/mystery-man.svg";
const DEFAULT_EFFECT_ICON = "icons/svg/aura.svg";
const PROGRESS_BAR_ID = "beneos-repair-progress";

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const _l = (key, fallback) => {
  if (game.i18n.has?.(key)) return game.i18n.localize(key);
  return fallback ?? key;
};

const _kindLabel = (kind) =>
  _l(`BENEOS.AssetWatcher.Dialog.Kind.${kind}`, kind);

const _entityTypeLabel = (type) =>
  _l(`BENEOS.AssetWatcher.Dialog.EntityType.${type}`, type);

const _scopeLabel = (scope) =>
  scope === "scene"
    ? _l("BENEOS.AssetWatcher.Repair.ScopeValueScene", "this scene")
    : _l("BENEOS.AssetWatcher.Repair.ScopeValueWorld", "entire world");

// HTML snippet for the progress bar; the caller is responsible for
// re-rendering current/total via `_updateProgress`. Three outputs:
// a label, a <progress> bar, a small status line, and an optional
// long-running-hint paragraph (hidden until _showProgressHint flips it).
const PROGRESS_HINT_ID = `${PROGRESS_BAR_ID}-hint`;
const _renderProgressBar = (label) => `
  <p class="beneos-rd-progress-label">${escapeHtml(label)}</p>
  <progress id="${PROGRESS_BAR_ID}" max="100" value="0" style="width:100%;height:14px;"></progress>
  <p id="${PROGRESS_BAR_ID}-text" class="beneos-rd-progress-text" style="margin:4px 0 0;font-size:0.9em;color:#b8b6b3;">…</p>
  <p id="${PROGRESS_HINT_ID}" class="beneos-rd-progress-hint" style="display:none;margin:6px 0 0;font-size:0.85em;color:#f5c992;font-style:italic;"></p>
`;

const _updateProgress = (current, total, statusText) => {
  try {
    const bar = document.getElementById(PROGRESS_BAR_ID);
    const txt = document.getElementById(`${PROGRESS_BAR_ID}-text`);
    if (bar && total > 0) {
      bar.max = total;
      bar.value = current;
    }
    if (txt) txt.textContent = statusText;
  } catch (e) {}
};

const _showProgressHint = (hintText) => {
  try {
    const el = document.getElementById(PROGRESS_HINT_ID);
    if (!el) return;
    el.textContent = hintText;
    el.style.display = "block";
  } catch (e) {}
};

export class BeneosRepairDialog {
  static async open({
    scene = null,
    missingPaths = [],
    missingRefs = [],
    initialScope = "ask"
  } = {}) {
    if (!game.user?.isGM) {
      ui.notifications?.warn(_l("BENEOS.AssetWatcher.Repair.NotGM"));
      return;
    }
    if (initialScope === "scene" || initialScope === "world") {
      return this._runScan({ scene, missingPaths, missingRefs, scope: initialScope });
    }
    return this._renderScopePicker({ scene, missingPaths, missingRefs });
  }

  /* ------------------------------------------------------------ */
  /*  Phase A — Scope picker                                       */
  /* ------------------------------------------------------------ */
  static _renderScopePicker({ scene, missingPaths, missingRefs }) {
    const hasScene = !!scene;
    const sceneCount = missingPaths.length;
    const sceneLabel = game.i18n.format("BENEOS.AssetWatcher.Repair.ScopeThisScene", {
      count: sceneCount
    });
    const worldLabel = _l("BENEOS.AssetWatcher.Repair.ScopeEntireWorld");
    const intro = _l("BENEOS.AssetWatcher.Repair.ScopeIntro");

    const sceneRow = hasScene
      ? `<label class="beneos-aw-report-row">
           <input type="radio" name="beneos-repair-scope" value="scene" checked>
           <span>${escapeHtml(sceneLabel)}</span>
         </label>`
      : "";
    const worldRow = `<label class="beneos-aw-report-row">
        <input type="radio" name="beneos-repair-scope" value="world" ${hasScene ? "" : "checked"}>
        <span>${escapeHtml(worldLabel)}</span>
      </label>`;

    const content = `
      <p>${escapeHtml(intro)}</p>
      <p><strong>${escapeHtml(_l("BENEOS.AssetWatcher.Repair.ScopeChoose"))}</strong></p>
      ${sceneRow}
      ${worldRow}
    `;

    const dlg = new Dialog({
      title: _l("BENEOS.AssetWatcher.Repair.ScopeDialogTitle"),
      content,
      buttons: {
        scan: {
          icon: '<i class="fas fa-search"></i>',
          label: _l("BENEOS.AssetWatcher.Repair.ButtonScan"),
          callback: (html) => {
            const root = html?.jquery ? html[0] : html;
            const picked = root?.querySelector?.('input[name="beneos-repair-scope"]:checked');
            const scope = picked?.value ?? (hasScene ? "scene" : "world");
            this._runScan({ scene, missingPaths, missingRefs, scope });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: _l("BENEOS.AssetWatcher.Repair.ButtonCancel")
        }
      },
      default: "scan"
    }, { classes: ["beneos-asset-watcher-dialog"] });
    dlg.render(true);
  }

  /* ------------------------------------------------------------ */
  /*  Phase B — Scan with progress                                */
  /* ------------------------------------------------------------ */
  static async _runScan({ scene, missingPaths, missingRefs, scope }) {
    if (scope === "scene" && !scene) {
      ui.notifications?.warn(_l("BENEOS.AssetWatcher.Repair.MenuNoScene"));
      return;
    }

    const scanning = new Dialog({
      title: _l("BENEOS.AssetWatcher.Repair.ScopeDialogTitle"),
      content: _renderProgressBar(_l("BENEOS.AssetWatcher.Repair.Scanning")),
      buttons: {}
    }, { classes: ["beneos-asset-watcher-dialog"] });
    scanning.render(true);

    // Wait one frame so the progress DOM exists before we start updating it.
    await new Promise(r => setTimeout(r, 50));

    let allMissing = Array.isArray(missingPaths) ? [...missingPaths] : [];
    let allMissingRefs = Array.isArray(missingRefs) ? [...missingRefs] : [];

    try {
      if (scope === "scene") {
        _updateProgress(0, 1, scene.name);
        const r = await scanSceneSilent(scene);
        // Always overwrite with fresh scan results — the cached missingRefs
        // from the watcher dialog may be stale by now (especially after the
        // user clicked Repair and then cancelled mid-flow once before).
        allMissing = r.missing ?? [];
        allMissingRefs = r.missingRefs ?? [];
        _updateProgress(1, 1, scene.name);
      } else if (scope === "world") {
        const summary = await scanAllEntities((p) => {
          _updateProgress(p.current, p.total, p.label);
        });
        allMissing = summary?.missing ?? [];
        allMissingRefs = summary?.missingRefs ?? [];
      }
    } catch (e) {
      console.warn("Beneos Asset Repair | scan failed:", e);
    }

    if (!allMissing.length) {
      try { scanning.close(); } catch (e) {}
      ui.notifications?.info(_l("BENEOS.AssetWatcher.Repair.NothingToRepair"));
      return;
    }

    // Mapping resolution — also show progress for big multi-pack worlds.
    // Has three phases internally: tier1 (sibling probe), index (recursive
    // moulinette walk if tier1 leaves any group unresolved), tier2 (basename
    // lookup for those leftover groups). Distinct labels keep the user
    // oriented for the long index step.
    let result;
    try {
      _updateProgress(0, 1, _l("BENEOS.AssetWatcher.Repair.MappingProgress"));
      let hintShown = false;
      result = await scanForMappings(allMissing, (p) => {
        if (p.phase === "index") {
          if (!hintShown) {
            _showProgressHint(_l("BENEOS.AssetWatcher.Repair.DeepScanningHint"));
            hintShown = true;
          }
          _updateProgress(
            p.dirsScanned,
            p.dirsScanned + p.queueLength,
            game.i18n.format("BENEOS.AssetWatcher.Repair.DeepScanning", {
              dirs: p.dirsScanned,
              dir: p.currentDir || "/"
            })
          );
        } else if (p.phase === "tier2") {
          _updateProgress(p.current, p.total, `${_l("BENEOS.AssetWatcher.Repair.ScanTier2Reason")}: ${p.currentPrefix}`);
        } else {
          _updateProgress(p.current, p.total, p.currentPrefix);
        }
      });
    } catch (e) {
      console.error("Beneos Asset Repair | scanForMappings failed:", e);
      result = {
        mappings: [],
        directReplacements: [],
        unresolved: [],
        stats: { groupsProbed: 0, mappingsFound: 0, directReplacementsFound: 0, unresolvedCount: 0, totalPaths: allMissing.length }
      };
    }

    try { scanning.close(); } catch (e) {}
    this._renderPreview({
      scene,
      scope,
      allMissing,
      missingRefs: allMissingRefs,
      ...result
    });
  }

  /* ------------------------------------------------------------ */
  /*  Phase C — Preview                                           */
  /* ------------------------------------------------------------ */
  static _renderPreview({ scene, scope, allMissing, missingRefs, mappings, directReplacements = [], unresolved, stats }) {
    const totalFixCount = (mappings.length ? mappings.reduce((s, m) => s + (m.count ?? 0), 0) : 0) + directReplacements.length;
    const intro = totalFixCount
      ? game.i18n.format("BENEOS.AssetWatcher.Repair.PreviewIntro", { count: mappings.length + directReplacements.length })
      : _l("BENEOS.AssetWatcher.Repair.PreviewNoMappings");

    const mappingItems = mappings.map(m => `
      <li>
        <code>${escapeHtml(m.brokenPrefix)}</code>
        <span class="beneos-rd-arrow"> → </span>
        <code>${escapeHtml(m.actualPrefix)}</code>
        <br><small>${escapeHtml(game.i18n.format("BENEOS.AssetWatcher.Repair.PreviewMappingLine", {
          count: m.count,
          pct: Math.round((m.confidence ?? 0) * 100)
        }))}${m.tier === 2 ? ` · <em>${escapeHtml(_l("BENEOS.AssetWatcher.Repair.ScanTier2Reason"))}</em>` : ""}</small>
      </li>
    `).join("");

    const directBlock = directReplacements.length ? `
      <details>
        <summary>${escapeHtml(game.i18n.format("BENEOS.AssetWatcher.Repair.PreviewDirectReplacements", { count: directReplacements.length }))}</summary>
        <ul class="beneos-aw-pathlist">
          ${directReplacements.map(d => {
            const fileName = (d.brokenPath ?? "").split("/").pop();
            const actualDir = (d.actualPath ?? "").split("/").slice(0, -1).join("/") + "/";
            return `<li title="${escapeHtml(d.brokenPath)}\n→\n${escapeHtml(d.actualPath)}"><code>${escapeHtml(fileName)}</code> → <code>${escapeHtml(actualDir)}</code></li>`;
          }).join("")}
        </ul>
      </details>
    ` : "";

    const _unresolvedReasonLabel = (reason) =>
      _l(`BENEOS.AssetWatcher.Repair.UnresolvedReason.${reason}`, reason);

    const unresolvedBlock = unresolved.length ? `
      <details>
        <summary>${escapeHtml(game.i18n.format("BENEOS.AssetWatcher.Repair.PreviewUnresolvedSummary", { count: unresolved.length }))}</summary>
        <ul class="beneos-aw-pathlist">
          ${unresolved.map(u => `<li><code>${escapeHtml(u.brokenPrefix)}</code> — ${escapeHtml(_unresolvedReasonLabel(u.reason))} (${u.count})</li>`).join("")}
        </ul>
      </details>
    ` : "";

    const scopeLine = `<p><strong>${escapeHtml(_l("BENEOS.AssetWatcher.Repair.ScopeLabel"))}:</strong> ${escapeHtml(_scopeLabel(scope))}</p>`;

    const content = `
      <p>${escapeHtml(intro)}</p>
      ${mappings.length ? `<ul class="beneos-aw-pathlist">${mappingItems}</ul>` : ""}
      ${directBlock}
      ${unresolvedBlock}
      ${scopeLine}
    `;

    const report = this._buildReport({ scope, mappings, directReplacements, unresolved, stats });

    const buttons = {};
    const hasFixes = mappings.length > 0 || directReplacements.length > 0;
    if (hasFixes) {
      buttons.apply = {
        icon: '<i class="fas fa-wrench"></i>',
        label: _l("BENEOS.AssetWatcher.Repair.ButtonApply"),
        callback: () => this._runApply({ scene, scope, mappings, directReplacements, allMissing, missingRefs, unresolved, stats })
      };
    }
    buttons.copy = {
      icon: '<i class="fas fa-copy"></i>',
      label: _l("BENEOS.AssetWatcher.Repair.ButtonCopyReport"),
      callback: async () => {
        try {
          await navigator.clipboard.writeText(report);
          ui.notifications?.info(_l("BENEOS.AssetWatcher.Repair.ReportCopied"));
        } catch (e) {
          console.warn("Beneos Asset Repair | clipboard copy failed:", e);
        }
      }
    };
    buttons.cancel = {
      icon: '<i class="fas fa-times"></i>',
      label: _l("BENEOS.AssetWatcher.Repair.ButtonCancel")
    };

    const dlg = new Dialog({
      title: _l("BENEOS.AssetWatcher.Repair.PreviewTitle"),
      content,
      buttons,
      default: hasFixes ? "apply" : "cancel"
    }, { classes: ["beneos-asset-watcher-dialog"] });
    dlg.render(true);
  }

  static _buildReport({ scope, mappings, directReplacements = [], unresolved, stats }) {
    const lines = [
      "Beneos repair report",
      `Scope: ${scope}`,
      `Groups probed: ${stats?.groupsProbed ?? 0}`,
      `Mappings: ${mappings.length}, direct replacements: ${directReplacements.length}, unresolved: ${unresolved.length}, total paths: ${stats?.totalPaths ?? 0}`,
      `Tier-2 index scanned ${stats?.tier2IndexDirs ?? 0} folder(s)`,
      "",
      "Resolved mappings:"
    ];
    for (const m of mappings) {
      const tier = m.tier === 2 ? " [tier-2/deep]" : "";
      lines.push(`  ${m.brokenPrefix} -> ${m.actualPrefix}  [${m.count} refs, conf ${Math.round((m.confidence ?? 0) * 100)}%${tier}]`);
    }
    if (directReplacements.length) {
      lines.push("", "Direct replacements (deep search):");
      for (const d of directReplacements) {
        lines.push(`  ${d.brokenPath} -> ${d.actualPath}`);
      }
    }
    if (unresolved.length) {
      lines.push("", "Unresolved:");
      for (const u of unresolved) {
        lines.push(`  ${u.brokenPrefix}  [${u.count} refs, reason: ${u.reason}${u.confidence != null ? `, conf ${Math.round(u.confidence * 100)}%` : ""}]`);
      }
    }
    return lines.join("\n");
  }

  /* ------------------------------------------------------------ */
  /*  Phase D — Apply with progress                               */
  /* ------------------------------------------------------------ */
  static async _runApply({ scene, scope, mappings, directReplacements = [], allMissing, missingRefs, unresolved, stats }) {
    const progress = new Dialog({
      title: _l("BENEOS.AssetWatcher.Repair.PreviewTitle"),
      content: _renderProgressBar(_l("BENEOS.AssetWatcher.Repair.ResultTitle")),
      buttons: {}
    }, { classes: ["beneos-asset-watcher-dialog"] });
    progress.render(true);
    await new Promise(r => setTimeout(r, 50));

    const progressCb = (info) => {
      _updateProgress(info.current, info.total, info.docName);
    };

    let result;
    try {
      result = await applyMappings({ mappings, directReplacements }, scope, scope === "scene" ? scene : null, progressCb);
    } catch (e) {
      console.error("Beneos Asset Repair | applyMappings failed:", e);
      try { progress.close(); } catch (er) {}
      ui.notifications?.error(String(e));
      return;
    }

    // Post-apply verification. Use the same broad scan as Phase B so we
    // catch leftover refs in Actors/Journals/etc., not just Scenes.
    let stillMissingPaths = [];
    let stillMissingRefs = [];
    try {
      if (scope === "scene" && scene) {
        const r = await scanSceneSilent(scene);
        stillMissingPaths = r.missing ?? [];
        stillMissingRefs = r.missingRefs ?? [];
      } else if (scope === "world") {
        const summary = await scanAllEntities();
        stillMissingPaths = summary?.missing ?? [];
        stillMissingRefs = summary?.missingRefs ?? [];
      }
    } catch (e) {
      console.warn("Beneos Asset Repair | post-apply scan failed:", e);
    }

    try { progress.close(); } catch (e) {}

    ui.notifications?.info(game.i18n.format("BENEOS.AssetWatcher.Repair.AppliedToast", { count: result.updated }));
    this._renderResult({
      scene,
      scope,
      result,
      stillMissingPaths,
      stillMissingRefs,
      mappings,
      directReplacements,
      unresolved,
      stats
    });
  }

  /* ------------------------------------------------------------ */
  /*  Phase E — Result + still-missing actions                    */
  /* ------------------------------------------------------------ */
  static _renderResult({ scene, scope, result, stillMissingPaths, stillMissingRefs, mappings, directReplacements = [], unresolved, stats }) {
    const docs = Object.keys(result.perDocCounts ?? {}).length;
    const updatedLine = escapeHtml(game.i18n.format("BENEOS.AssetWatcher.Repair.ResultUpdated", {
      count: result.updated,
      docs
    }));
    const errLine = result.errors.length
      ? `<li>${escapeHtml(game.i18n.format("BENEOS.AssetWatcher.Repair.ResultErrors", { count: result.errors.length }))}</li>`
      : "";

    const stillMissingCount = stillMissingRefs.length || stillMissingPaths.length;
    const missingLine = stillMissingCount > 0
      ? escapeHtml(game.i18n.format("BENEOS.AssetWatcher.Repair.ResultStillMissing", { count: stillMissingCount }))
      : escapeHtml(_l("BENEOS.AssetWatcher.Repair.ResultAllFixed"));

    const errorsPanel = result.errors.length ? `
      <details>
        <summary>${escapeHtml(_l("BENEOS.AssetWatcher.Repair.ResultShowErrors"))}</summary>
        <pre>${escapeHtml(result.errors.map(e => `${e.entity}: ${e.error}`).join("\n"))}</pre>
      </details>
    ` : "";

    const forgeBlock = (typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge)
      ? `<p class="beneos-rd-forge-hint" style="background:rgba(245,201,146,0.1);border-left:3px solid #f5c992;padding:8px;border-radius:2px;">⚠ ${escapeHtml(_l("BENEOS.AssetWatcher.Repair.ForgeHint"))}</p>`
      : "";

    const stillMissingBlock = stillMissingCount > 0
      ? this._renderStillMissingBlock(stillMissingRefs.length ? stillMissingRefs : stillMissingPaths)
      : "";

    const educationBlock = stillMissingCount > 0
      ? `
        <details open class="beneos-rd-education">
          <summary><strong>${escapeHtml(_l("BENEOS.AssetWatcher.Repair.StillMissingEducationHeader"))}</strong></summary>
          <p>${escapeHtml(_l("BENEOS.AssetWatcher.Repair.StillMissingEducation"))}</p>
          <p>${escapeHtml(_l("BENEOS.AssetWatcher.Repair.StillMissingDiscord"))}</p>
        </details>`
      : "";

    const content = `
      <ul>
        <li>${updatedLine}</li>
        ${errLine}
        <li>${missingLine}</li>
      </ul>
      ${errorsPanel}
      ${forgeBlock}
      ${educationBlock}
      ${stillMissingBlock}
    `;

    const buttons = {};
    if (scope === "scene" && scene && canvas?.scene?.id === scene.id) {
      buttons.reload = {
        icon: '<i class="fas fa-rotate-right"></i>',
        label: _l("BENEOS.AssetWatcher.Repair.ButtonReloadScene"),
        callback: () => { try { canvas.draw(); } catch (e) {} }
      };
    }
    if (stillMissingCount > 0) {
      buttons.discord = {
        icon: '<i class="fab fa-discord"></i>',
        label: _l("BENEOS.AssetWatcher.Repair.ButtonDiscord"),
        callback: () => {
          try { window.open(BENEOS_DISCORD_URL, "_blank", "noopener,noreferrer"); }
          catch (e) {}
        }
      };
      buttons.report = {
        icon: '<i class="fas fa-file-export"></i>',
        label: _l("BENEOS.AssetWatcher.Repair.ButtonTroubleshootingReport"),
        callback: async () => {
          try {
            const report = this._buildTroubleshootingReport({
              scope, mappings, directReplacements, unresolved, stats, result,
              stillMissingRefs: stillMissingRefs.length ? stillMissingRefs : stillMissingPaths.map(p => ({ path: p }))
            });
            await navigator.clipboard.writeText(report);
            ui.notifications?.info(_l("BENEOS.AssetWatcher.Repair.TroubleshootingReportCopied"));
          } catch (e) {
            console.warn("Beneos Asset Repair | clipboard copy failed:", e);
          }
        }
      };
    }
    buttons.close = {
      icon: '<i class="fas fa-times"></i>',
      label: _l("BENEOS.AssetWatcher.Repair.ButtonClose")
    };

    const dlg = new Dialog({
      title: _l("BENEOS.AssetWatcher.Repair.ResultTitle"),
      content,
      buttons,
      default: buttons.reload ? "reload" : "close",
      render: (html) => {
        const root = html?.jquery ? html[0] : html;
        this._wireActionHandlers(root, dlg, { scene, scope });
      }
    }, { classes: ["beneos-asset-watcher-dialog"] });

    dlg.render(true);
  }

  static _renderStillMissingBlock(refsOrPaths) {
    // Build a path → refs[] map. If the caller passed plain strings (we
    // only have paths, no refs), wrap them in synthetic refs so the
    // renderer can still produce something useful, but without action
    // buttons (no entity context = nothing to delete).
    const byPath = new Map();
    for (const item of refsOrPaths) {
      const ref = (typeof item === "string") ? { path: item, _stub: true } : item;
      const arr = byPath.get(ref.path) ?? [];
      arr.push(ref);
      byPath.set(ref.path, arr);
    }
    const blocks = [];
    for (const [path, refs] of byPath) {
      const fileName = refs[0]?.fileName || _basename(path);
      const sourceRows = refs.map((ref, idx) => this._renderSourceRow(ref, path, idx)).join("");
      blocks.push(`
        <details open class="beneos-rd-missing">
          <summary>
            <code>${escapeHtml(fileName)}</code>
            <button type="button" class="beneos-aw-copy beneos-rd-show-path" data-path="${escapeHtml(path)}" title="${escapeHtml(_l("BENEOS.AssetWatcher.Repair.StillMissingShowPath"))}">
              <i class="fas fa-link"></i>
            </button>
          </summary>
          <div class="beneos-rd-path" style="font-size:0.85em;color:#8d8b88;padding:0.25em 0 0.5em;word-break:break-all;">${escapeHtml(path)}</div>
          ${sourceRows}
        </details>
      `);
    }
    return `
      <div class="beneos-rd-stillmissing">
        <h3>${escapeHtml(game.i18n.format("BENEOS.AssetWatcher.Repair.StillMissingTitle", { count: refsOrPaths.length }))}</h3>
        ${blocks.join("")}
      </div>`;
  }

  static _renderSourceRow(ref, path, idx) {
    if (ref._stub || !ref.entityType) {
      return `
        <div class="beneos-rd-source beneos-rd-source-stub">
          <em>${escapeHtml(_l("BENEOS.AssetWatcher.Repair.NothingToRepair"))}</em>
        </div>`;
    }
    const ownerLine = ref.ownerName
      ? game.i18n.format("BENEOS.AssetWatcher.Repair.SourceLineWithChild", {
          type: _entityTypeLabel(ref.ownerType),
          name: ref.ownerName,
          childType: _entityTypeLabel(ref.entityType),
          childName: ref.entityName || "—"
        })
      : game.i18n.format("BENEOS.AssetWatcher.Repair.SourceLine", {
          type: _entityTypeLabel(ref.entityType),
          name: ref.entityName || "—"
        });
    const kindLine = _kindLabel(ref.kind);

    const actionData = {
      path,
      kind: ref.kind,
      entityType: ref.entityType,
      entityId: ref.entityId ?? "",
      entityName: ref.entityName ?? "",
      field: ref.field ?? "",
      fileName: ref.fileName ?? "",
      ownerType: ref.ownerType ?? "",
      ownerId: ref.ownerId ?? "",
      ownerName: ref.ownerName ?? ""
    };
    // HTML data-* attributes are lowercased by the parser; the dataset
    // API maps dash-case to camelCase. Without this conversion,
    // `data-entityType="..."` lands as `data-entitytype` in the DOM and
    // `btn.dataset.entityType` returns undefined — which is what broke
    // every action handler ("entity not found: undefined:undefined").
    const _toDashCase = (s) => s.replace(/([A-Z])/g, "-$1").toLowerCase();
    const ds = Object.entries(actionData)
      .map(([k, v]) => `data-${_toDashCase(k)}="${escapeHtml(String(v))}"`)
      .join(" ");

    const actions = this._actionsForRef(ref);
    const buttons = actions.map(a => `
      <button type="button" class="beneos-rd-action" data-action="${a.id}" ${ds}>
        <i class="fas ${a.icon}"></i> ${escapeHtml(a.label)}
      </button>
    `).join("");

    return `
      <div class="beneos-rd-source" data-source-idx="${idx}">
        <div class="beneos-rd-source-line">${escapeHtml(ownerLine)} — <span class="beneos-rd-kind">${escapeHtml(kindLine)}</span></div>
        <div class="beneos-rd-source-actions">${buttons}</div>
      </div>`;
  }

  // For each ref kind, pick the three appropriate actions. The middle
  // action ("Remove asset") varies most: embedded docs get deleted, Scene
  // fields get cleared, Item/Effect icons get reset to a default.
  static _actionsForRef(ref) {
    const delIgnore = () => [
      { id: "delete-entity", icon: "fa-trash-alt", label: this._deleteEntityLabel(ref) },
      { id: "remove-asset",  icon: "fa-eraser",   label: _l("BENEOS.AssetWatcher.Repair.Action.RemoveAsset") },
      { id: "ignore",        icon: "fa-eye-slash", label: _l("BENEOS.AssetWatcher.Repair.Action.Ignore") }
    ];
    const itemEffect = () => [
      { id: "delete-entity", icon: "fa-trash-alt", label: _l("BENEOS.AssetWatcher.Repair.Action.DeleteActor") },
      { id: "reset-icon",    icon: "fa-undo",      label: _l("BENEOS.AssetWatcher.Repair.Action.ResetIcon") },
      { id: "ignore",        icon: "fa-eye-slash", label: _l("BENEOS.AssetWatcher.Repair.Action.Ignore") }
    ];
    switch (ref.kind) {
      case "item-img":
      case "effect-icon":
      case "item-effect-icon":
        return itemEffect();
      default:
        return delIgnore();
    }
  }

  static _deleteEntityLabel(ref) {
    const parent = ref.ownerType || ref.entityType;
    switch (parent) {
      case "Scene":        return _l("BENEOS.AssetWatcher.Repair.Action.DeleteScene");
      case "Actor":        return _l("BENEOS.AssetWatcher.Repair.Action.DeleteActor");
      case "JournalEntry": return _l("BENEOS.AssetWatcher.Repair.Action.DeleteJournal");
      case "Playlist":     return _l("BENEOS.AssetWatcher.Repair.Action.DeletePlaylist");
      case "RollTable":    return _l("BENEOS.AssetWatcher.Repair.Action.DeleteTable");
      default:             return _l("BENEOS.AssetWatcher.Repair.Action.DeleteScene");
    }
  }

  /* ------------------------------------------------------------ */
  /*  Action handlers                                             */
  /* ------------------------------------------------------------ */
  static _wireActionHandlers(root, dialog, ctx) {
    if (!root) return;

    // Path-copy buttons inside summaries
    root.querySelectorAll(".beneos-rd-show-path").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const p = btn.dataset.path;
        if (!p) return;
        try {
          await navigator.clipboard.writeText(p);
          const old = btn.innerHTML;
          btn.innerHTML = `<i class="fas fa-check"></i>`;
          setTimeout(() => { btn.innerHTML = old; }, 1200);
        } catch (e) {}
      });
    });

    // Action buttons
    root.querySelectorAll(".beneos-rd-action").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const action = btn.dataset.action;
        const data = { ...btn.dataset };
        const sourceEl = btn.closest(".beneos-rd-source");
        try {
          const handled = await this._handleAction(action, data, ctx);
          if (!handled) return;
          // Live-refresh: remove this source row. If the parent <details>
          // has no remaining rows, remove it too.
          const parentDetails = sourceEl?.closest("details.beneos-rd-missing");
          sourceEl?.remove();
          if (parentDetails && !parentDetails.querySelector(".beneos-rd-source")) {
            parentDetails.remove();
          }
          // If nothing left at all → swap in "All clean now."
          const container = root.querySelector(".beneos-rd-stillmissing");
          if (container && !container.querySelector(".beneos-rd-source")) {
            container.innerHTML = `<p><i class="fas fa-check"></i> ${escapeHtml(_l("BENEOS.AssetWatcher.Repair.AllClean"))}</p>`;
          }
        } catch (e) {
          console.error("Beneos Asset Repair | action failed:", e);
          ui.notifications?.error(game.i18n.format("BENEOS.AssetWatcher.Repair.ActionFailed", { error: String(e) }));
        }
      });
    });
  }

  // Returns true iff the action succeeded (so the caller removes the row).
  static async _handleAction(action, data, ctx) {
    switch (action) {
      case "delete-entity": return await this._actionDeleteEntity(data);
      case "remove-asset":  return await this._actionRemoveAsset(data);
      case "reset-icon":    return await this._actionResetIcon(data);
      case "ignore":        return await this._actionIgnore(data);
      default:              return false;
    }
  }

  static async _confirm(messageKey, vars, icon = "fa-question") {
    return new Promise(resolve => {
      const dlg = new Dialog({
        title: _l("BENEOS.AssetWatcher.Repair.ConfirmTitle"),
        content: `<p><i class="fas ${icon}"></i> ${game.i18n.format(messageKey, vars ?? {})}</p>`,
        buttons: {
          yes: {
            icon: '<i class="fas fa-check"></i>',
            label: _l("BENEOS.AssetWatcher.Repair.ConfirmYes"),
            callback: () => resolve(true)
          },
          no: {
            icon: '<i class="fas fa-times"></i>',
            label: _l("BENEOS.AssetWatcher.Repair.ConfirmNo"),
            callback: () => resolve(false)
          }
        },
        default: "no",
        close: () => resolve(false)
      }, { classes: ["beneos-asset-watcher-dialog"] });
      dlg.render(true);
    });
  }

  static _ownerOrSelf(data) {
    // For embedded refs (Tile/Token/Item/Effect/etc.), "delete the
    // containing entity" means delete the owner (Scene or Actor); for
    // top-level refs (Scene.background, Actor.img), delete the entity
    // itself.
    if (data.ownerId && data.ownerType) {
      return { type: data.ownerType, id: data.ownerId, name: data.ownerName };
    }
    return { type: data.entityType, id: data.entityId, name: data.entityName };
  }

  static _resolveDoc(type, id) {
    if (!id) return null;
    switch (type) {
      case "Scene":        return game.scenes?.get(id);
      case "Actor":        return game.actors?.get(id);
      case "JournalEntry": return game.journal?.get(id);
      case "Playlist":     return game.playlists?.get(id);
      case "RollTable":    return game.tables?.get(id);
      default:             return null;
    }
  }

  static async _actionDeleteEntity(data) {
    const target = this._ownerOrSelf(data);
    const doc = this._resolveDoc(target.type, target.id);
    if (!doc) {
      ui.notifications?.warn(`Beneos Asset Repair | entity not found: ${target.type}:${target.id}`);
      return false;
    }
    const confirmKey = `BENEOS.AssetWatcher.Repair.ConfirmDelete${target.type === "JournalEntry" ? "Journal" : target.type}`;
    const ok = await this._confirm(confirmKey, { name: target.name }, "fa-trash-alt");
    if (!ok) return false;
    await doc.delete();
    ui.notifications?.info(game.i18n.format("BENEOS.AssetWatcher.Repair.ActionDoneDelete", { name: target.name }));
    return true;
  }

  static async _actionRemoveAsset(data) {
    // For embedded docs on a Scene (Tile, Token, Note, AmbientSound), the
    // "asset" is the doc itself — delete the embedded document. For
    // Scene-level fields (background/foreground/firstLevelBg), clear the
    // path string. For Journal pages, delete the page.
    const sceneId = data.ownerType === "Scene" ? data.ownerId : (data.entityType === "Scene" ? data.entityId : null);
    if (data.entityType === "Tile" || data.entityType === "Token" || data.entityType === "Note" || data.entityType === "AmbientSound") {
      const scene = game.scenes?.get(sceneId);
      if (!scene) {
        ui.notifications?.warn(`Beneos Asset Repair | scene not found: ${sceneId}`);
        return false;
      }
      const ok = await this._confirm("BENEOS.AssetWatcher.Repair.ConfirmRemoveAsset", {
        kind: _kindLabel(data.kind),
        fileName: data.fileName,
        parentName: data.ownerName || scene.name,
        parentType: _entityTypeLabel(data.ownerType || "Scene")
      }, "fa-eraser");
      if (!ok) return false;
      await scene.deleteEmbeddedDocuments(data.entityType, [data.entityId]);
      ui.notifications?.info(game.i18n.format("BENEOS.AssetWatcher.Repair.ActionDoneRemove", { fileName: data.fileName }));
      return true;
    }
    if (data.entityType === "Scene") {
      const scene = game.scenes?.get(data.entityId);
      if (!scene) return false;
      const ok = await this._confirm("BENEOS.AssetWatcher.Repair.ConfirmClearField", {
        kind: _kindLabel(data.kind),
        parentName: scene.name,
        parentType: _entityTypeLabel("Scene")
      }, "fa-eraser");
      if (!ok) return false;
      // Clear the specific field stored in data.field
      const update = { [data.field]: "" };
      await scene.update(update);
      ui.notifications?.info(game.i18n.format("BENEOS.AssetWatcher.Repair.ActionDoneRemove", { fileName: data.fileName }));
      return true;
    }
    if (data.entityType === "JournalEntryPage") {
      const journal = game.journal?.get(data.ownerId);
      if (!journal) return false;
      const ok = await this._confirm("BENEOS.AssetWatcher.Repair.ConfirmRemoveAsset", {
        kind: _kindLabel(data.kind),
        fileName: data.fileName,
        parentName: data.ownerName || journal.name,
        parentType: _entityTypeLabel("JournalEntry")
      }, "fa-eraser");
      if (!ok) return false;
      await journal.deleteEmbeddedDocuments("JournalEntryPage", [data.entityId]);
      ui.notifications?.info(game.i18n.format("BENEOS.AssetWatcher.Repair.ActionDoneRemove", { fileName: data.fileName }));
      return true;
    }
    if (data.entityType === "PlaylistSound") {
      const playlist = game.playlists?.get(data.ownerId);
      if (!playlist) return false;
      const ok = await this._confirm("BENEOS.AssetWatcher.Repair.ConfirmRemoveAsset", {
        kind: _kindLabel(data.kind),
        fileName: data.fileName,
        parentName: data.ownerName || playlist.name,
        parentType: _entityTypeLabel("Playlist")
      }, "fa-eraser");
      if (!ok) return false;
      await playlist.deleteEmbeddedDocuments("PlaylistSound", [data.entityId]);
      ui.notifications?.info(game.i18n.format("BENEOS.AssetWatcher.Repair.ActionDoneRemove", { fileName: data.fileName }));
      return true;
    }
    if (data.entityType === "TableResult") {
      const table = game.tables?.get(data.ownerId);
      if (!table) return false;
      const ok = await this._confirm("BENEOS.AssetWatcher.Repair.ConfirmRemoveAsset", {
        kind: _kindLabel(data.kind),
        fileName: data.fileName,
        parentName: data.ownerName || table.name,
        parentType: _entityTypeLabel("RollTable")
      }, "fa-eraser");
      if (!ok) return false;
      await table.deleteEmbeddedDocuments("TableResult", [data.entityId]);
      ui.notifications?.info(game.i18n.format("BENEOS.AssetWatcher.Repair.ActionDoneRemove", { fileName: data.fileName }));
      return true;
    }
    if (data.entityType === "Actor") {
      // For actor.img / prototypeToken — clear the field to default.
      const actor = game.actors?.get(data.entityId);
      if (!actor) return false;
      const ok = await this._confirm("BENEOS.AssetWatcher.Repair.ConfirmClearField", {
        kind: _kindLabel(data.kind),
        parentName: actor.name,
        parentType: _entityTypeLabel("Actor")
      }, "fa-eraser");
      if (!ok) return false;
      // actor.img and prototypeToken.texture.src both fall back to the
      // generic token placeholder. If we later need a distinct fallback
      // for the portrait vs the token, branch here.
      await actor.update({ [data.field]: DEFAULT_TOKEN_ICON });
      ui.notifications?.info(game.i18n.format("BENEOS.AssetWatcher.Repair.ActionDoneRemove", { fileName: data.fileName }));
      return true;
    }
    ui.notifications?.warn(`Beneos Asset Repair | unsupported entity type for Remove Asset: ${data.entityType}`);
    return false;
  }

  static async _actionResetIcon(data) {
    if (!data.ownerId || !data.entityId) return false;
    const ok = await this._confirm("BENEOS.AssetWatcher.Repair.ConfirmResetIcon", {
      name: data.entityName,
      kind: _kindLabel(data.kind)
    }, "fa-undo");
    if (!ok) return false;

    if (data.kind === "item-img") {
      const actor = game.actors?.get(data.ownerId);
      const item = actor?.items?.get(data.entityId);
      if (!item) return false;
      await item.update({ img: DEFAULT_ITEM_ICON });
    } else if (data.kind === "effect-icon") {
      const actor = game.actors?.get(data.ownerId);
      const eff = actor?.effects?.get(data.entityId);
      if (!eff) return false;
      const field = data.field === "img" ? "img" : "icon";
      await eff.update({ [field]: DEFAULT_EFFECT_ICON });
    } else if (data.kind === "item-effect-icon") {
      // ownerType is Item in this case; we need the Actor → Item → Effect chain.
      // Source data didn't include the Actor — find by scanning game.actors.
      for (const actor of game.actors ?? []) {
        const item = actor.items?.get(data.ownerId);
        if (!item) continue;
        const eff = item.effects?.get(data.entityId);
        if (!eff) continue;
        const field = data.field === "img" ? "img" : "icon";
        await eff.update({ [field]: DEFAULT_EFFECT_ICON });
        break;
      }
    }
    ui.notifications?.info(game.i18n.format("BENEOS.AssetWatcher.Repair.ActionDoneRemove", { fileName: data.fileName }));
    return true;
  }

  static async _actionIgnore(data) {
    const target = this._ownerOrSelf(data);
    const ok = await this._confirm("BENEOS.AssetWatcher.Repair.ConfirmIgnore", {
      fileName: data.fileName,
      parentType: _entityTypeLabel(target.type)
    }, "fa-eye-slash");
    if (!ok) return false;
    // For scene-rooted refs, persist on the scene flag (watcher's mechanism).
    // For non-scene refs we have no per-entity dismiss yet — silently accept
    // and rely on the user being aware.
    const sceneId = (target.type === "Scene") ? target.id : null;
    if (sceneId) {
      try {
        const scene = game.scenes?.get(sceneId);
        if (scene) {
          const existing = scene.getFlag(MODULE_ID, FLAG_DISMISSED) ?? [];
          const merged = Array.from(new Set([...existing, data.path]));
          await scene.setFlag(MODULE_ID, FLAG_DISMISSED, merged);
        }
      } catch (e) {
        console.warn("Beneos Asset Repair | could not persist ignore flag:", e);
      }
    }
    ui.notifications?.info(game.i18n.format("BENEOS.AssetWatcher.Repair.ActionDoneIgnore", { fileName: data.fileName }));
    return true;
  }

  /* ------------------------------------------------------------ */
  /*  Troubleshooting report                                      */
  /* ------------------------------------------------------------ */
  static _buildTroubleshootingReport({ scope, mappings, directReplacements = [], unresolved, stats, result, stillMissingRefs }) {
    const lines = [
      "=== Beneos Asset Repair — Troubleshooting Report ===",
      `Generated: ${new Date().toISOString()}`,
      "",
      "Environment:",
      `  Foundry: ${game.version ?? "?"}`,
      `  System: ${game.system?.id ?? "?"}@${game.system?.version ?? "?"}`,
      `  Beneos module: ${game.modules?.get("beneos-module")?.version ?? "?"}`,
      `  ScenePacker: ${game.modules?.get("scene-packer")?.version ?? "not installed"}`,
      `  Moulinette: ${game.modules?.get("moulinette")?.version ?? "not installed"}`,
      `  Forge: ${(typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge) ? "yes" : "no"}`,
      `  World: ${game.world?.id ?? "?"}`,
      "",
      `Repair run:`,
      `  Scope: ${scope}`,
      `  Groups probed: ${stats?.groupsProbed ?? 0}`,
      `  Tier-2 index scanned ${stats?.tier2IndexDirs ?? 0} folder(s)`,
      `  Mappings resolved: ${mappings.length}`
    ];
    for (const m of mappings) {
      const tierTag = m.tier === 2 ? " [tier-2/deep]" : "";
      lines.push(`    - ${m.brokenPrefix} -> ${m.actualPrefix}  [${m.count} refs, conf ${Math.round((m.confidence ?? 0) * 100)}%${tierTag}]`);
    }
    lines.push(`  Direct replacements (deep search): ${directReplacements.length}`);
    for (const d of directReplacements) {
      lines.push(`    - ${d.brokenPath} -> ${d.actualPath}`);
    }
    lines.push(`  Unresolved: ${unresolved.length}`);
    for (const u of unresolved) {
      lines.push(`    - ${u.brokenPrefix}  [${u.count} refs, reason: ${u.reason}]`);
    }
    lines.push(`  Total rewritten: ${result?.updated ?? 0}`);
    lines.push(`  Errors during apply: ${result?.errors?.length ?? 0}`);
    lines.push(`  Still missing after repair: ${stillMissingRefs.length}`);
    for (const ref of stillMissingRefs) {
      const owner = ref.ownerName ? ` (in ${ref.ownerType}: ${ref.ownerName} → ${ref.entityType}: ${ref.entityName})` : (ref.entityType ? ` (in ${ref.entityType}: ${ref.entityName})` : "");
      lines.push(`    - ${ref.path}${owner}`);
    }
    // Identified packs (heuristic from world segment in broken-prefix
    // OR from the parsed broken-path of each direct replacement).
    const packs = new Set();
    for (const m of mappings) {
      const parsed = _parseBrokenPathInternal?.(`${m.brokenPrefix}placeholder`);
      if (parsed?.world) packs.add(parsed.world);
    }
    for (const d of directReplacements) {
      const parsed = _parseBrokenPathInternal?.(d.brokenPath ?? "");
      if (parsed?.world) packs.add(parsed.world);
    }
    for (const u of unresolved) {
      const parsed = _parseBrokenPathInternal?.(`${u.brokenPrefix}placeholder`);
      if (parsed?.world) packs.add(parsed.world);
    }
    if (packs.size) {
      lines.push("", "Identified packs:");
      for (const p of packs) lines.push(`  - ${p}`);
    }
    return lines.join("\n");
  }
}

const _basename = (p) => {
  if (typeof p !== "string" || !p) return "";
  return p.replace(/\\/g, "/").split("/").pop() || p;
};

/* ============================================================== */
/*  Settings menu hull — invoked via game.settings.registerMenu()  */
/* ============================================================== */
export class BeneosRepairMenuApp extends FormApplication {
  render() {
    BeneosRepairMenuApp.openChooser();
    return this;
  }

  static openChooser() {
    if (!game.user?.isGM) {
      ui.notifications?.warn(_l("BENEOS.AssetWatcher.Repair.NotGM"));
      return;
    }
    const hasScene = !!canvas?.scene;
    const intro = _l("BENEOS.AssetWatcher.Repair.MenuIntro");

    const content = `<p>${escapeHtml(intro)}</p>`;

    const buttons = {};
    if (hasScene) {
      buttons.scene = {
        icon: '<i class="fas fa-map"></i>',
        label: _l("BENEOS.AssetWatcher.Repair.MenuButtonScene"),
        callback: () => BeneosRepairDialog.open({
          scene: canvas.scene,
          missingPaths: [],
          initialScope: "scene"
        })
      };
    }
    buttons.world = {
      icon: '<i class="fas fa-globe"></i>',
      label: _l("BENEOS.AssetWatcher.Repair.MenuButtonWorld"),
      callback: () => BeneosRepairDialog.open({
        scene: null,
        missingPaths: [],
        initialScope: "world"
      })
    };
    buttons.cancel = {
      icon: '<i class="fas fa-times"></i>',
      label: _l("BENEOS.AssetWatcher.Repair.MenuButtonCancel")
    };

    const dlg = new Dialog({
      title: _l("BENEOS.AssetWatcher.Repair.MenuTitle"),
      content,
      buttons,
      default: hasScene ? "scene" : "world"
    }, { classes: ["beneos-asset-watcher-dialog"] });
    dlg.render(true);
  }
}
