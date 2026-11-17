/**
 * stream-fremdflaggen.mjs - der einmalige Ruecklauf der fremden Flags auf die
 * Toradresse (stre-T-128).
 *
 * WARUM. Zwischen stre-T-102 und stre-T-128 schrieb der Installer auch unter
 * `flags.<fremdes Modul>` die schluesselfreie Form `beneos://`. Ein fremdes
 * Modul, etwa monks-active-tiles mit seinem `audiofile`, spielt die
 * Zeichenkette so, wie sie dort steht, und `beneos://` kann kein Browser laden.
 * Die Regel beim Einbau steht seit stre-T-128 in `applyStreamAddresses`
 * (`stream-install.mjs`); dieser Lauf zieht Welten nach, die in der Zeit davor
 * eingebaut wurden.
 *
 * WAS ER TUT. Je Dokument der Weltsammlungen und je eingebettetem Dokument
 * eine Ebene tief: unter jedem Flag, dessen Namensraum nicht dieses Modul ist,
 * wird jeder GANZE Wert `beneos://...` zur Toradresse mit dem Schluessel von
 * heute (`leinwandAdresse`). Geschrieben wird der ganze oberste Wert
 * `flags.<x>`, damit Listen wie die Aktionen von monks-active-tiles als Ganzes
 * ersetzt werden und nicht nach Index verschmelzen.
 *
 * WAS ER NICHT TUT. `beneos://` mitten in einem Text (HTML) bleibt stehen und
 * wird als Rest gezaehlt: dort entscheidet nicht eine Zeichenkette, und ein
 * Umbau des Textes gehoert nicht in einen stillen Startlauf. Kompendien und
 * eingebettete Dokumente zweiter Tiefe fasst er nicht an.
 *
 * EINMAL JE WELT. Die Marke `SETTING.fremdflaggenZurueck` wird nur nach einem
 * Lauf ohne Fehlschlag gesetzt, sonst versucht der naechste Start den Rest.
 * Gegen zwei gleichzeitige Spielleitungen laeuft er unter dem Weltriegel des
 * Adressnachzugs; findet er ihn besetzt, laeuft er beim naechsten Start. Den
 * Riegel nimmt er nur, wenn ein Zaehllauf vorab etwas umzustellen fand: der
 * Riegel wartet bis zu 1500 ms, und der Weltstart wartet auf diesen Lauf.
 *
 * Die Zaehlzeile nennt nur Zahlen, keine Adresse und keinen Schluessel.
 * Pruefsatz: `stream-fremdflaggen.test.mjs`.
 */
import { MODULE_ID, SETTING, streamKey, istPlatzhalter, leinwandAdresse,
         nachzugRiegelNehmen, nachzugRiegelLoesen } from "./stream-settings.mjs"

/** Faltet einen Wert: jeder ganze `beneos://`-Wert wird Toradresse. */
function falteZurueck(wert, zahl) {
  if (typeof wert === "string") {
    if (istPlatzhalter(wert)) {
      const tor = leinwandAdresse(wert)
      if (tor !== wert) { zahl.adressen++; return tor }
      zahl.rest++
      return wert
    }
    if (wert.toLowerCase().includes("beneos://")) zahl.rest++
    return wert
  }
  if (Array.isArray(wert)) return wert.map((w) => falteZurueck(w, zahl))
  if (wert && typeof wert === "object") {
    const kopie = {}
    for (const [k, v] of Object.entries(wert)) kopie[k] = falteZurueck(v, zahl)
    return kopie
  }
  return wert
}

/** Die Aenderung fuer die fremden Flags eines Quellobjekts, oder null. */
function flaggenAenderung(quelle, bericht) {
  const flags = quelle?.flags
  if (!flags || typeof flags !== "object") return null
  let aenderung = null
  for (const [ns, wert] of Object.entries(flags)) {
    if (ns === MODULE_ID) continue
    const zahl = { adressen: 0, rest: 0 }
    const neu = falteZurueck(wert, zahl)
    bericht.rest += zahl.rest
    if (!zahl.adressen) continue
    bericht.adressen += zahl.adressen
    aenderung ??= {}
    aenderung[`flags.${ns}`] = neu
  }
  return aenderung
}

function markeGesetzt() {
  try { return game.settings.get(MODULE_ID, SETTING.fremdflaggenZurueck) === true }
  catch (_e) { return false }
}

/** Setzt die Marke; ein Fehlschlag zaehlt als Fehler, der naechste Start versucht es wieder. */
async function markeSetzen(bericht) {
  try { await game.settings.set(MODULE_ID, SETTING.fremdflaggenZurueck, true) }
  catch (_e) { bericht.fehler++ }
}

async function durchlaufen(bericht, trocken) {
  const g = globalThis.game
  const sammlungen = [g.journal, g.actors, g.items, g.tables, g.cards, g.messages,
    g.scenes, g.playlists, g.macros]
  for (const sammlung of sammlungen) {
    for (const doc of sammlung ?? []) {
      try {
        const quelle = doc.toObject()
        const eingebettet = doc.constructor?.metadata?.embedded ?? {}
        const eigen = flaggenAenderung(quelle, bericht)
        const kinder = []
        for (const [klasse, feld] of Object.entries(eingebettet)) {
          const teile = []
          for (const kind of Array.isArray(quelle[feld]) ? quelle[feld] : []) {
            const a = flaggenAenderung(kind, bericht)
            if (!a) continue
            if (!kind?._id) { bericht.fehler++; continue }
            teile.push({ ...a, _id: kind._id })
          }
          if (teile.length) kinder.push([klasse, teile])
        }
        if (!eigen && !kinder.length) continue
        bericht.dokumente++
        if (trocken) continue
        if (eigen) await doc.update(eigen)
        for (const [klasse, teile] of kinder) await doc.updateEmbeddedDocuments(klasse, teile)
      } catch (_e) {
        bericht.fehler++
      }
    }
  }
}

/**
 * Der Ruecklauf. Nur fuer die Spielleitung, nur mit Schluessel, einmal je Welt.
 *
 * @param {{trocken?: boolean}} optionen trocken: nur zaehlen, nichts schreiben
 * @returns {Promise<{dokumente:number, adressen:number, rest:number, fehler:number,
 *   trocken:boolean, grund:string}>}
 */
export async function fremdflaggenZurueck({ trocken = false } = {}) {
  const bericht = { dokumente: 0, adressen: 0, rest: 0, fehler: 0, trocken, grund: "" }
  if (!globalThis.game?.user?.isGM) { bericht.grund = "kein gm"; return bericht }
  if (!streamKey()) { bericht.grund = "ohne schluessel"; return bericht }
  if (markeGesetzt()) { bericht.grund = "erledigt"; return bericht }

  if (trocken) {
    await durchlaufen(bericht, true)
  } else {
    // Erst ohne Riegel zaehlen. Der Riegel wartet bis zu 1500 ms, und der
    // Weltstart wartet auf diesen Lauf. In einer Welt ohne fremde Adresse
    // setzt er darum nur die Marke und nimmt den Riegel gar nicht erst.
    const vorab = { dokumente: 0, adressen: 0, rest: 0, fehler: 0 }
    await durchlaufen(vorab, true)
    if (vorab.adressen === 0 && vorab.fehler === 0) {
      bericht.rest = vorab.rest
      await markeSetzen(bericht)
    } else {
      const marke = await nachzugRiegelNehmen()
      if (!marke) { bericht.grund = "riegel"; return bericht }
      try {
        await durchlaufen(bericht, false)
        if (bericht.fehler === 0) await markeSetzen(bericht)
      } finally {
        await nachzugRiegelLoesen(marke)
      }
    }
  }
  bericht.grund = "gelaufen"
  console.log(`Beneos Stream | Fremde Flags${trocken ? " (trocken)" : ""}: ${bericht.dokumente} Dokumente, `
    + `${bericht.adressen} Adressen auf das Tor, ${bericht.rest} Stellen belassen, ${bericht.fehler} Fehler`)
  return bericht
}
