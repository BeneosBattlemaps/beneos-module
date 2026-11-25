/**
 * Der Hinweis an den Kunden, wenn ein Schreibweg hinter einem laufenden
 * Auftrag der Kompendium-Kette warten muss (stre-T-485). Getrennt vom Riegel,
 * weil `scripts/kompendium-riegel.mjs` keine Foundry-Globale nennt, damit der
 * Bench es ohne Foundry fahren kann.
 *
 * Gerufen ueber `inDerKette(job, { beimWarten: wartehinweis })`. Der Riegel
 * kennt die Art des laufenden Auftrags nicht (Installation, Entfernen,
 * Startpruefung, Nachzug), also nennt der Text keine. Steht der laufende
 * Auftrag in einem Dialog, der auf den Kunden wartet, sagt der Hinweis das,
 * denn dann wartet der Kunde in Wahrheit auf sich selbst.
 */
export function wartehinweis({ dialogOffen } = {}) {
  const schluessel = dialogOffen
    ? "BENEOS.Cloud.Notification.WaitingForDialog"
    : "BENEOS.Cloud.Notification.WaitingForTask"
  ui.notifications?.info?.(game.i18n.localize(schluessel))
}

/**
 * Ein Hinweis je Kundenvorgang. Ein Vorgang aus mehreren Kettenaufrufen
 * (Entfernen: Kreatur und Journal; Nachzug: eine Familie je Kompendium)
 * reicht denselben Geber an jeden Aufruf weiter und zeigt hoechstens einen.
 */
export function einmalHinweis(zeige = wartehinweis) {
  let gezeigt = false
  return (info) => {
    if (gezeigt) return
    gezeigt = true
    zeige(info)
  }
}
