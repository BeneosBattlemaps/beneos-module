/**
 * Beneos Install Report
 *
 * Transparent post-install report for the native battlemap installer. When any
 * asset or document fails to transfer, BeneosNativeBattlemapInstaller opens this
 * dialog so the user is told clearly WHAT failed, WHY (a classified category
 * with host-specific guidance), WHERE (the exact paths), and WHAT to do next
 * (retry, copy a diagnostic report, ask on Discord). Never a silent miss.
 *
 * Reuses the shared `.beneos-asset-watcher-dialog` styling (injected by
 * beneos-asset-watcher.js at init) so no extra CSS is needed.
 */

const DISCORD_URL = "https://discord.gg/R2yBH557Wk"
const FAQ_URL     = "https://beneos-battlemaps.com/pages/beneos-faq-black-screen-error"

// Asset impact priority (mirrors beneos-scenepacker.js): the battlemap video
// matters most, then static maps, then images, audio, pdf.
function priorityOf(path) {
  const p = String(path || "").toLowerCase()
  if (p.endsWith(".webm")) return 1
  if (p.endsWith(".webp")) return 2
  if (/\.(jpe?g|png|gif|svg)$/.test(p)) return 3
  if (/\.(ogg|mp3|m4a|wav)$/.test(p)) return 4
  if (p.endsWith(".pdf")) return 5
  return 9
}

// Order used to pick the dominant (most actionable) category on ties.
// "toolarge" leads: it is the only host failure whose exact cause and exact
// remedy we know, and it must never be hidden behind a vaguer category that
// happened to hit more files.
const CATEGORY_PRIORITY = ["toolarge", "permission", "quota", "signature", "server", "network", "timeout", "verify", "notfound", "unknown"]

function _l(key, fallback) {
  try { if (game.i18n?.has?.(key)) return game.i18n.localize(key) } catch (_) {}
  return fallback ?? key
}
function _f(key, data, fallback) {
  try { if (game.i18n?.has?.(key)) return game.i18n.format(key, data) } catch (_) {}
  let s = fallback ?? key
  for (const [k, v] of Object.entries(data || {})) s = s.split(`{${k}}`).join(String(v))
  return s
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
}

// Built-in English fallbacks so the report is meaningful even before i18n keys
// are localised (WIP: en-only for now). Keyed by failure category.
const HEADLINE_FALLBACK = {
  permission: "Your server blocked writing files to beneos_assets/cloud/battlemaps/.",
  toolarge:   "A proxy in front of your Foundry server rejected the files because they are too big (HTTP 413).",
  quota:      "Your server ran out of storage space (quota exceeded).",
  signature:  "Some download links expired during a very slow install.",
  server:     "Beneos Cloud returned temporary errors during the transfer.",
  network:    "The connection dropped while downloading some files.",
  timeout:    "Some downloads stalled and timed out.",
  notfound:   "Some files could not be found on Beneos Cloud.",
  verify:     "Some files were uploaded successfully, but your server does not hand them back.",
  unknown:    "Some files could not be installed.",
}
const GUIDANCE_FALLBACK = {
  permission: "Check that Foundry is allowed to write files (on The Forge: Assets settings; self-host: folder permissions / read-only mounts). Then click Retry.",
  toolarge:   "This is a setting of your own reverse proxy, not of Foundry and not of Beneos. Retrying cannot help until it is raised. nginx or Nginx Proxy Manager: set 'client_max_body_size 0;' for the Foundry site (in Nginx Proxy Manager it goes into the Advanced tab), then reload nginx. Caddy: 'request_body { max_size 0 }'. Apache: 'LimitRequestBody 0'. If your traffic also runs through a Cloudflare proxy or tunnel, note that Free and Pro cap uploads at 100 MB and that limit cannot be raised; almost all Beneos assets stay well below it, only a few HD bonus videos do not. Once the limit is raised, reopen the Beneos cloud window and install this release again; everything already on disk is kept and only the missing files are fetched.",
  quota:      "Free up disk space or raise your hosting storage quota, then click Retry.",
  signature:  "Just click Retry , the installer refreshes the download links automatically.",
  server:     "Wait a moment and click Retry. If it keeps happening, send us the report on Discord.",
  network:    "Check your internet connection and click Retry. Large packs on slow lines may need a second attempt.",
  timeout:    "Click Retry. On a very slow connection, a large battlemap video can take a while.",
  notfound:   "Please send us the copied report on Discord so we can fix the catalog entry.",
  verify:     "This is almost always another module rewriting uploads (an image optimizer such as Media Optimizer converts every .svg into a .webp), or a host that refuses to serve .svg as an image. Disable image optimizer modules, click Retry, then enable them again. If none are active, send us the copied report on Discord.",
  unknown:    "Click Retry. If it persists, send us the copied report on Discord.",
}

export class BeneosInstallReport {

  /**
   * @param {object} result   the installer result object
   * @param {object} [opts]
   * @param {Function} [opts.onRetry]  re-run the install (idempotent)
   */
  static show(result, opts = {}) {
    if (!result) return
    const assetFailures = Array.isArray(result.assetFailures) ? result.assetFailures.slice() : []
    const docFailures   = Array.isArray(result.docFailures) ? result.docFailures.slice() : []
    const dominant      = this.#dominantCategory(result)

    assetFailures.sort((a, b) => (priorityOf(a.target) - priorityOf(b.target)) || String(a.target).localeCompare(String(b.target)))

    const reportText = this.#buildReportText(result, assetFailures, docFailures, dominant)
    const content    = this.#buildContent(result, assetFailures, docFailures, dominant)

    const buttons = {}
    if (typeof opts.onRetry === "function" && !this.#retryIsPointless(result, assetFailures, docFailures)) {
      buttons.retry = {
        icon: '<i class="fas fa-rotate-right"></i>',
        label: _l("BENEOS.Cloud.Install.Report.Retry", "Retry install"),
        callback: () => { try { opts.onRetry() } catch (e) { console.warn("Beneos Install Report | retry failed", e) } },
      }
    }
    buttons.copy = {
      icon: '<i class="fas fa-copy"></i>',
      label: _l("BENEOS.Cloud.Install.Report.CopyReport", "Copy report"),
      callback: async () => {
        try {
          await navigator.clipboard.writeText(reportText)
          ui.notifications?.info(_l("BENEOS.Cloud.Install.Report.ReportCopied", "Report copied to clipboard."))
        } catch (e) { console.warn("Beneos Install Report | clipboard copy failed", e) }
      },
    }
    buttons.discord = {
      icon: '<i class="fab fa-discord"></i>',
      label: _l("BENEOS.Cloud.Install.Report.Discord", "Ask on Discord"),
      callback: () => { try { window.open(DISCORD_URL, "_blank", "noopener,noreferrer") } catch (_) {} },
    }
    buttons.close = {
      icon: '<i class="fas fa-xmark"></i>',
      label: _l("BENEOS.Cloud.Install.Report.Close", "Close"),
    }

    const dlg = new Dialog({
      title: _l("BENEOS.Cloud.Install.Report.Title", "Battlemap install report"),
      content,
      buttons,
      default: buttons.retry ? "retry" : "close",
    }, { classes: ["beneos-asset-watcher-dialog"], width: 560 })
    dlg.render(true)
    return dlg
  }

  /**
   * Hide Retry when every failure is a size refusal. Such a run cannot end any
   * other way until the user changes a server setting, so the button would only
   * spend the whole download again to arrive at the same report. Any other
   * failure alongside it keeps the button, because that one may well pass on a
   * second attempt.
   */
  static #retryIsPointless(result, assetFailures, docFailures) {
    if (result?.fatalCategory === "toolarge") return true   // pre-flight already proved it
    if (docFailures.length) return false
    if (!assetFailures.length) return false
    return assetFailures.every(f => f.category === "toolarge")
  }

  static #dominantCategory(result) {
    if (result.fatalCategory) return result.fatalCategory
    const counts = {}
    for (const f of (result.assetFailures || [])) counts[f.category] = (counts[f.category] || 0) + 1
    // Document failures count too, but only behind the asset ones: a transfer
    // that never delivered the bytes explains a document that never appeared,
    // and the reverse is not true. Only the whole-class failures carry a
    // category; per-document rejections are validation errors with no
    // transport cause to name.
    for (const f of (result.docFailures || [])) {
      if (f.category) counts[f.category] = (counts[f.category] || 0) + 1
    }
    const cats = Object.keys(counts)
    if (cats.length === 0) return "unknown"
    cats.sort((a, b) => (counts[b] - counts[a])
      || (CATEGORY_PRIORITY.indexOf(a) - CATEGORY_PRIORITY.indexOf(b)))
    return cats[0]
  }

  static #buildContent(result, assetFailures, docFailures, dominant) {
    const t = result.totals || {}
    const headline = _l(`BENEOS.Cloud.Install.Report.Headline.${dominant}`, HEADLINE_FALLBACK[dominant] || HEADLINE_FALLBACK.unknown)
    const guidance = _l(`BENEOS.Cloud.Install.Report.Guidance.${dominant}`, GUIDANCE_FALLBACK[dominant] || GUIDANCE_FALLBACK.unknown)

    const preflightBlock = (result.preflight && result.preflight.ok === false)
      ? `<p class="beneos-rd-forge-hint" style="background:rgba(245,201,146,0.12);border-left:3px solid #f5c992;padding:8px;border-radius:2px;">
           ${esc(_l("BENEOS.Cloud.Install.Report.PreflightAborted", "The install stopped before downloading because the server rejected a test write."))}
         </p>`
      : ""

    const summary = _f("BENEOS.Cloud.Install.Report.Summary",
      { ok: t.ok ?? 0, assets: t.assets ?? 0, repaired: t.repaired ?? 0, failed: assetFailures.length, docs: docFailures.length },
      "{ok}/{assets} assets installed ({repaired} repaired), {failed} asset(s) and {docs} document(s) failed.")

    // Info, not a failure: a third-party module (e.g. Media Optimizer)
    // converted uploads to another format; references were adjusted.
    const convertedBlock = (t.convertedUploads > 0)
      ? `<p style="background:rgba(146,201,245,0.10);border-left:3px solid #92c9f5;padding:8px;border-radius:2px;font-size:0.9em;">
           ${esc(_f("BENEOS.Cloud.Install.Report.ConvertedUploads", { count: t.convertedUploads },
             "{count} uploaded file(s) were converted to another format by a third-party module (such as Media Optimizer). Beneos adjusted all references automatically, this is not an error."))}
         </p>`
      : ""

    const catLabel = (c) => esc(_l(`BENEOS.Cloud.Install.Report.Cat.${c}`, c))

    const assetRows = assetFailures.map(f => {
      const name = String(f.target).split("/").pop()
      return `<li title="${esc(f.target)}${f.lastError ? "\n" + esc(f.lastError) : ""}">
          <span class="beneos-rd-kind">[${catLabel(f.category)}]</span>
          <code>${esc(name)}</code>
        </li>`
    }).join("")

    const assetBlock = assetFailures.length
      ? `<details open class="beneos-rd-missing">
           <summary>${esc(_f("BENEOS.Cloud.Install.Report.FailedAssets", { count: assetFailures.length }, "Failed assets ({count})"))}</summary>
           <ul class="beneos-aw-pathlist">${assetRows}</ul>
         </details>`
      : ""

    const docRows = docFailures.map(d =>
      `<li><span class="beneos-rd-kind">[${esc(d.type)}]</span> <code>${esc(d.id)}</code> , ${esc(d.error)}</li>`).join("")
    const docBlock = docFailures.length
      ? `<details class="beneos-rd-missing">
           <summary>${esc(_f("BENEOS.Cloud.Install.Report.FailedDocs", { count: docFailures.length }, "Failed documents ({count})"))}</summary>
           <ul class="beneos-aw-pathlist">${docRows}</ul>
         </details>`
      : ""

    const env = result.env || {}
    const envBlock = `<details class="beneos-rd-missing">
        <summary>${esc(_l("BENEOS.Cloud.Install.Report.Environment", "Environment"))}</summary>
        <ul class="beneos-aw-pathlist">
          <li>Foundry: <code>${esc(env.foundry)}</code></li>
          <li>System: <code>${esc(env.system)}</code></li>
          <li>Beneos: <code>${esc(env.module)}</code></li>
          <li>The Forge: <code>${esc(env.forge)}</code></li>
        </ul>
      </details>`

    return `
      <div class="beneos-rd-stillmissing">
        <p><strong>${esc(headline)}</strong></p>
        <p>${esc(guidance)}</p>
        ${preflightBlock}
        <p style="font-size:0.9em;color:#b8b6b3;">${esc(summary)}</p>
        ${convertedBlock}
        ${assetBlock}
        ${docBlock}
        ${envBlock}
        <p style="font-size:0.85em;color:#8d8b88;margin-top:6px;">
          ${esc(_l("BENEOS.Cloud.Install.Report.CopyHint", "Use Copy report before asking on Discord , it includes everything we need."))}
        </p>
      </div>`
  }

  static #buildReportText(result, assetFailures, docFailures, dominant) {
    const env = result.env || {}
    const t = result.totals || {}
    const lines = [
      "=== Beneos Battlemap Install Report ===",
      `Pack: ${result.label} (${result.packageId})`,
      "Environment:",
      `  Foundry: ${env.foundry}`,
      `  System: ${env.system}`,
      `  Beneos module: ${env.module}`,
      `  The Forge: ${env.forge}`,
      `  World: ${env.world}`,
      `Dominant issue: ${dominant}`,
      `Totals: assets ${t.assets ?? 0} (ok ${t.ok ?? 0}, repaired ${t.repaired ?? 0}, failed ${assetFailures.length}), documents failed ${docFailures.length}`,
    ]
    if (t.convertedUploads > 0) {
      lines.push(`Converted uploads: ${t.convertedUploads} file(s) rewritten by a third-party upload module (e.g. Media Optimizer); references adjusted automatically.`)
    }
    if (result.preflight && result.preflight.ok === false) {
      lines.push(`Pre-flight write check FAILED: ${result.preflight.category} , ${result.preflight.error || ""}`)
    }
    if (result.fatalError) lines.push(`Fatal: ${result.fatalError}`)
    if (assetFailures.length) {
      lines.push("", "Failed assets:")
      for (const f of assetFailures) lines.push(`  [${f.category}] ${f.target} (attempts ${f.attempts || 1}): ${f.lastError || ""}`)
    }
    if (docFailures.length) {
      lines.push("", "Failed documents:")
      for (const d of docFailures) lines.push(`  [${d.type}] ${d.id}: ${d.error || ""}`)
    }
    return lines.join("\n")
  }
}

globalThis.BeneosInstallReport = BeneosInstallReport
