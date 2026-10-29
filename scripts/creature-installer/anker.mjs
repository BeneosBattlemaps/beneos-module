/**
 * anker.mjs
 *
 * Wohin das Wiederherstellungslogo der Kreaturenlade gehoert, wohin seine
 * Hinweis-Sprechblase gehoert, und wie lange die Blase steht.
 *
 * Diese Datei kennt weder Foundry noch das DOM, genau wie `alternativen.mjs`
 * daneben. Jeder Wert, den eine Rechnung hier liest, kommt als Parameter
 * herein, auch die Fenstermasse und die Uhr. Der Grund ist nicht Reinheit um
 * ihrer selbst willen: ohne diese Trennung steckt die einzige Rechnung der
 * Verankerung im DOM-Schreiber, und dann ist sie nur mit laufendem Foundry
 * pruefbar. Mit ihr ist sie eine Zahl, die man ausrechnen kann.
 *
 * Die Gegenprobe dazu liegt in `anker.test.mjs`.
 */

/**
 * Kantenlaenge von `.bci-restore`, wie sie in
 * `css/beneos-creature-installer.css` steht.
 *
 * NUR RUECKFALL. Der gelebte Wert wird am Knopf gemessen, denn eine Zahl, die
 * an zwei Orten dasselbe behauptet, laeuft irgendwann auseinander. Gebraucht
 * wird der Rueckfall nur, solange der Knopf noch kein Layout hat.
 */
export const RESTORE_SIZE_FALLBACK = 36;

/** Abstand der linken Logokante von der linken Kante der Makroleiste. */
export const RESTORE_OFFSET = 52;

/** Abstand zwischen Logo-Oberkante und Pfeilspitze der Blase. */
export const HINT_GAP = 8;

/** Mindestabstand zu jedem Bildschirmrand. */
export const EDGE_MARGIN = 8;

/**
 * Wie lange die Blase steht, bevor sie von selbst geht.
 */
export const HINT_MS = 5000;

/**
 * Wohin Logo und Blase gehoeren.
 *
 * @param {{left: number, bottom: number}} hotbar Rechteck der Makroleiste
 * @param {{width: number, height: number}} viewport Fenstermasse
 * @param {number} logoSize gemessene Kantenlaenge von `.bci-restore`
 * @returns {{logoLeft: number, logoBottom: number, hintRight: number, hintBottom: number}}
 */
export function restoreAnchor(hotbar, viewport, logoSize) {
  const logoLeft = Math.max(EDGE_MARGIN, Math.round(hotbar.left - RESTORE_OFFSET));
  const logoBottom = Math.max(EDGE_MARGIN, Math.round(viewport.height - hotbar.bottom));
  return {
    logoLeft,
    logoBottom,
    // Die Blase haengt mit ihrer RECHTEN Kante an der rechten Kante des Logos.
    // So waechst sie nach links in freien Bildschirm statt ueber die
    // Makroplaetze, und die Pfeilspitze landet unter der Logomitte, ohne dass
    // irgendwer die Breite der Blase messen muss.
    hintRight: Math.max(EDGE_MARGIN, Math.round(viewport.width - (logoLeft + logoSize))),
    hintBottom: logoBottom + logoSize + HINT_GAP
  };
}

/**
 * Steht diese Blase noch?
 *
 * Die Uhr kommt als Parameter herein, damit die Frist ohne Warten pruefbar ist.
 * Sie ist der Guertel zum Hosentraeger des Zeitgebers: ein Tab im Hintergrund
 * drosselt Zeitgeber und kommt mit abgelaufener Blase zurueck.
 *
 * @param {{deadline: number}|null|undefined} hint
 * @param {number} now
 * @returns {boolean}
 */
export function hintIsLive(hint, now) {
  return !!hint && now < hint.deadline;
}
