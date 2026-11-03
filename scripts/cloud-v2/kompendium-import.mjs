/**
 * Legt ein Dokument im Kompendium an, ohne ueber
 * `CompendiumCollection.prototype.importDocument` zu gehen.
 *
 * Grund: Monk's Enhanced Journal 14.02 ersetzt genau diese Methode und ruft
 * darin `fixType(this.object)` auf. Auf einem Kompendium ist `this.object`
 * undefiniert, also wirft jeder Aufruf "Cannot set properties of undefined
 * (setting 'type')", fuer Actors, Items und Journale gleich. Nachgestellt am
 * 2026-11-03 auf V14 Build 367, siehe OP-CLD-196 und SR-2026-0009.
 *
 * Der Inhalt ist der des Kerns, nur ohne den gepatchten Einstieg:
 * - V14 legt die Logik in `DocumentCollection#importDocument` (behaelt die ID,
 *   ersetzt ein vorhandenes Dokument gleicher ID). Das Kompendium reicht dort
 *   nur durch und haengt `_prepareImportDocument` an, das ueber `this` weiter
 *   greift. Erkennbar daran, dass das Kompendium `_prepareImportDocument`
 *   selbst fuehrt.
 * - V13 fuehrt alles in `CompendiumCollection#importDocument` und hat kein
 *   `_prepareImportDocument`. Dort steht die Logik hier nachgebaut, Zeile fuer
 *   Zeile wie im Kern (Build 351).
 *
 * Eigene Datei ohne Importe, damit ein Prüfstand sie ohne laufende Welt laden kann.
 *
 * @param {CompendiumCollection} pack
 * @param {foundry.abstract.Document} doc
 * @param {object} [options]
 * @returns {Promise<foundry.abstract.Document>}
 */
export function insKompendiumImportieren(pack, doc, options = {}) {
  const opts = { ...(options ?? {}) }
  const Kompendium = foundry.documents.collections.CompendiumCollection
  if (Object.hasOwn(Kompendium.prototype, "_prepareImportDocument")) {
    const Basis = Object.getPrototypeOf(Kompendium.prototype)
    return Basis.importDocument.call(pack, doc, opts)
  }
  opts.clearOwnership = opts.clearOwnership ?? (pack.metadata.packageType === "world")
  const data = doc.toCompendium(pack, opts)
  return doc.constructor.create(data, { pack: pack.collection })
}
