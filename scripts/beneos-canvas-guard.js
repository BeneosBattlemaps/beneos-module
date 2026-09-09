/**
 * Beneos Canvas Guard
 *
 * Foundry's canvas can fail to draw for reasons that have nothing to do with
 * Beneos, and when it does, the whole board stays black. `Canvas#draw` chains
 * on `#drawing.finally(...)`, so a single rejection is replayed on every later
 * draw: one failure poisons the rest of the session, scene switches included.
 * The customer sees "no map is showing anymore" and, because this tends to
 * surface right after installing content, asks us.
 *
 * A Discord report on 2026-09-09 read exactly like that:
 *   Failed drawing primary canvas group: Scene is not a valid embedded
 *   Document within the Scene Document
 * The module registers no canvas layer at all in that version, so it could not
 * have been us. It still cost the customer an evening and us two rounds of
 * questions, because nothing on screen said where to look.
 *
 * This dialog says it. It is deliberately a HINT, not a verdict: the package
 * name comes from Foundry's own stack attribution, which can point at the
 * wrong one in a libWrapper chain. So it names what it actually is, the
 * packages whose code appears in the stack.
 *
 * Kept apart from beneos_analytics.js on purpose: a measuring point must not
 * open windows. Analytics records the same failure, this file explains it.
 *
 * On `Dialog`: deprecated since v13 and gone in v16, and used here anyway.
 * Measured in V14.367 (`client/client.mjs:170`), it is still a global. The
 * whole module is ApplicationV1 and the styling this reuses
 * (`.beneos-asset-watcher-dialog`) targets V1 markup, so a single V2 window
 * here would buy nothing and cost its own CSS. It migrates with the rest.
 */

// The location alone is NOT enough. Foundry files two different failures under
// it (`client/canvas/board.mjs`, measured in V14): the group draw at :1219 and
// texture loading at :1193. Only the first one is safe to call "not ours" -
// the second fires on a file that will not load, which is exactly what a
// broken Beneos asset produces. Telling that customer we are innocent would be
// the worst thing this dialog could do, so the message has to match too.
const CANVAS_DRAW_LOCATION = "Canvas#draw"
const GROUP_DRAW_MESSAGE = /^Failed drawing .+ canvas group/

export class BeneosCanvasGuard {

  /** Shown at most once per session, see #warnOnce. */
  static _warned = false

  /** Kept so the listener can be taken back off again, see destroy(). */
  static _hookId = null

  static init() {
    try {
      this._hookId = Hooks.on("error", (location, err) => {
        try {
          if (String(location || "") !== CANVAS_DRAW_LOCATION) return
          if (!GROUP_DRAW_MESSAGE.test(String(err?.message || ""))) return
          this.#warnOnce(err)
        } catch (_) { /* a guard must never become the failure */ }
      })
    } catch (_) { /* swallow */ }
  }

  static destroy() {
    try {
      if (this._hookId !== null) Hooks.off("error", this._hookId)
    } catch (_) { /* swallow */ }
    this._hookId = null
  }

  /**
   * Foundry repeats this error on every draw attempt for the rest of the
   * session. A dialog per attempt would be worse than the bug it reports, so
   * the first one is the only one.
   *
   * Players are skipped: nothing in the dialog is actionable without module
   * management, and a black canvas is confusing enough without a message
   * naming things they cannot reach.
   */
  static #warnOnce(err) {
    if (this._warned) return
    if (!game.user?.isGM) return
    this._warned = true

    const packages = this.#packagesFromMessage(err?.message)
    console.warn(`Beneos Canvas Guard | Foundry could not draw the canvas. The draw is abandoned before any image is loaded, so Beneos assets are not the trigger.${packages ? ` Packages named in the stack: ${packages}` : ""}`, err)

    // The named case is the EXCEPTION, not the rule: the attribution comes
    // from libWrapper and only appears when the error passed through a wrapper
    // it manages. So the unnamed branch carries the instructions that always
    // work, and the named one adds a pointer on top.
    const packageLine = packages
      ? this.#p(this.#f("BENEOS.CanvasGuard.Packages",
          "Some code in the stack belongs to: {packages}. That is a pointer, not a verdict, and it is not always complete.",
          { packages: this.#esc(packages) }))
      : ""

    const content = [
      this.#p(`<b>${this.#l("BENEOS.CanvasGuard.Headline", "Foundry could not draw the canvas.")}</b> ${this.#l("BENEOS.CanvasGuard.NotAssets", "Your Beneos maps are not the trigger: Foundry abandons the draw <i>before</i> it loads a single image, so no map, in any resolution, can cause this.")}`),
      packageLine,
      this.#p(this.#l("BENEOS.CanvasGuard.Session", "Foundry then repeats this failure for the rest of the session, including after a scene change. That is why every map looks broken and not just one. <b>Reloading the page (F5) gives you a working canvas again.</b>")),
      this.#p(this.#l("BENEOS.CanvasGuard.Find", "To find the cause: disable every module except Beneos and its dependencies, reload, and open a map. If it draws, re-enable half of the rest and repeat."), "font-size:0.9em;opacity:0.85;"),
    ].filter(Boolean).join("")

    try {
      new Dialog({
        title: this.#l("BENEOS.CanvasGuard.Title", "Beneos: Foundry could not draw the canvas"),
        content,
        buttons: {
          close: { icon: '<i class="fas fa-xmark"></i>', label: this.#l("BENEOS.CanvasGuard.Close", "Close") },
        },
        default: "close",
      }, { classes: ["beneos-asset-watcher-dialog"], width: 520 }).render(true)
    } catch (e) {
      console.warn("Beneos Canvas Guard | could not open the dialog", e)
    }
  }

  /**
   * libWrapper appends this attribution, for example
   * "[Detected 2 packages: levels(3.2.0), beneos-module(14.4.8)]". Not Foundry:
   * grep finds it in neither V13 nor V14 core. It therefore appears only when
   * the error travelled through a wrapper libWrapper manages, and its absence
   * proves nothing.
   *
   * Two patterns, closed and already-truncated, the same pair
   * `BeneosAnalytics._splitStackPackages` uses. A cut list is common enough
   * that reading only the closed form would drop the answer in exactly the
   * long-message cases where it is most wanted.
   */
  static #packagesFromMessage(message) {
    const s = String(message || "")
    const m = s.match(/\[Detected [^\]]*\]/) || s.match(/\[Detected .*$/)
    if (!m) return ""
    return m[0].replace(/^\[Detected\s*/, "").replace(/\]$/, "").replace(/^\d+\s+packages?:\s*/, "").trim()
  }

  static #p(html, style = "") {
    return html ? `<p${style ? ` style="${style}"` : ""}>${html}</p>` : ""
  }

  /** i18n with an English fallback, same shape as BeneosInstallReport uses. */
  static #l(key, fallback) {
    try { if (game.i18n?.has?.(key)) return game.i18n.localize(key) } catch (_) {}
    return fallback
  }

  static #f(key, fallback, data) {
    try { if (game.i18n?.has?.(key)) return game.i18n.format(key, data) } catch (_) {}
    let s = fallback
    for (const [k, v] of Object.entries(data || {})) s = s.split(`{${k}}`).join(String(v))
    return s
  }

  static #esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
  }
}

Hooks.once("init", () => BeneosCanvasGuard.init())
globalThis.BeneosCanvasGuard = BeneosCanvasGuard
