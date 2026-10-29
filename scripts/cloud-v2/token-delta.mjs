/**
 * Teilt die Token-Updates eines Szenen-Updates so auf, dass Foundry V14 sie
 * annimmt.
 *
 * Ein verknuepftes Token traegt in der Welt `delta: null`. Kommt das Pack-delta
 * im selben Update mit, macht der Client daraus einen Diff ohne die leeren
 * Felder `system`, `items`, `effects`, `flags`, und der Server lehnt null gegen
 * Objekt mit "may not be undefined" ab. Das kippt die ganze Szene.
 *
 * Drei Faelle:
 * - Pack-Token verknuepft: delta faellt weg. Foundry verwirft delta an
 *   verknuepften Tokens ohnehin (`ActorDeltaField#_updateCommit`).
 * - Pack-Token unverknuepft, Welt-Token verknuepft (der Kunde hat es selbst
 *   verknuepft): erst ohne delta, damit das Token unverknuepft wird, dann das
 *   delta in einem zweiten Update. Das zweite trifft ein unverknuepftes Token,
 *   und das nimmt Foundry an.
 * - beide unverknuepft: unveraendert, dort traegt delta echte Abweichungen.
 *
 * Eigene Datei ohne Importe, damit `tools/scene-merge-token-bench` sie ohne
 * laufende Welt gegen den Foundry-Kern pruefen kann.
 *
 * @param {Array<object>} aktualisieren  Pack-Tokens, die in der Welt schon stehen
 * @param {(id: string) => boolean} weltVerknuepft  ob das Welt-Token verknuepft ist
 * @returns {{zuerst: Array<object>, danach: Array<object>}}  zwei Update-Laeufe in dieser Reihenfolge
 */
export function tokenUpdatesAufteilen(aktualisieren, weltVerknuepft) {
  const zuerst = [], danach = []
  for (const e of aktualisieren) {
    if (!("delta" in e)) { zuerst.push(e); continue }
    const kreuz = !e.actorLink && weltVerknuepft(String(e._id))
    if (!e.actorLink && !kreuz) { zuerst.push(e); continue }
    const { delta, ...ohne } = e
    zuerst.push(ohne)
    if (kreuz && delta) danach.push({ _id: e._id, delta })
  }
  return { zuerst, danach }
}
