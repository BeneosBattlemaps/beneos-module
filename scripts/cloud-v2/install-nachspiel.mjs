/**
 * install-nachspiel.mjs
 *
 * What follows a finished battlemap install, the same for every way in: the
 * cloud window, its bundle runs, the delegated release install (POI, journal),
 * the manual ZIP import, and the report's Retry for each of them.
 *
 *  1. The cloud window the customer has open redraws its release cards, so the
 *     installed-marker appears without a reload.
 *  2. `beneos.releaseInstalled` goes out (static-switch probe cache, Getting
 *     Started tour bridge).
 *
 * Passed to BeneosNativeBattlemapInstaller.install() as `nachLauf`; install()
 * runs it only after a run that reached its end (MO-012, MO-020). Before this
 * module the follow-up lived inside the cloud window's install handler, so the
 * ZIP import had none (MO-021), and it refreshed the window instance that
 * started the install, which on the delegated path was never shown (MO-022).
 * Tested by install-nachspiel.test.mjs.
 */

/** The cloud window currently on screen, or null when none is open. */
export function offenesCloudFenster() {
  const w = globalThis.game?.beneos?.cloudWindowV2
  return (w && w.rendered && typeof w.render === "function") ? w : null
}

/**
 * Follow-up for one release install.
 * @param {object} release  { releaseDir, displayName, scope, variant }
 * @returns {(fertig: object) => Promise<void>} gets the finished installer
 */
export function releaseNachLauf({ releaseDir, displayName = "", scope = "release", variant = "" }) {
  return async (fertig) => {
    // A "results" re-render reruns buildReleaseCards, which reads the install
    // state fresh. Looked up at call time: a Retry can come long after the
    // window that started the install was closed and reopened. Not awaited,
    // as before: install() and each bundle round do not wait for the redraw.
    try { Promise.resolve(offenesCloudFenster()?.render({ parts: ["results"] })).catch(() => {}) } catch (_) {}
    try {
      Hooks.callAll("beneos.releaseInstalled", {
        releaseDir,
        displayName,
        scope,
        variant,
        // The scenes this run imported. releaseDir is the catalog key
        // ("bm_0113"), NOT the on-disk asset folder ("113_arasek_stockyard"),
        // so it cannot be matched against asset paths. The scene ids can, and
        // they let the static-switch probe cache refresh just this release.
        sceneIds: (fertig?._importedScenes || []).map(s => String(s.id)).filter(Boolean),
      })
    } catch (_) {}
  }
}
