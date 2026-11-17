/**
 * stream-flaggen.mjs - die einmalige Umstellung der eigenen Flags auf die
 * schluesselfreie Form (stre-T-122 E).
 *
 * WARUM. Seit stre-T-122 faltet das Schreibnetz (`stream-leinwand.mjs`,
 * `FLAGGEN_FELDER`) die eigenen Flags, die eine Adresse tragen: die
 * Videokachel unter `flags.beneos-module.stream` und die Kreaturenlade der
 * Szene unter `flags.beneos-module.creatureInstaller`. Was vor diesem Stand
 * gespeichert wurde, steht noch mit der Toradresse samt Schluessel in der Welt
 * und geht so in jeden Export. Dieser Lauf zieht diese Welten nach.
 *
 * WAS ER TUT. Je Szene der Welt: die Flaggenwerte der Szene und jeder Kachel
 * werden in einer Kopie gefaltet (`falteWerte`), geschrieben wird nur, was sich
 * aendert, als ganzer Wert `flags.beneos-module.<k>`. Die angezeigte Szene kommt
 * zuletzt: ihr Schreiben zeichnet die Leinwand neu, und das soll einmal am Ende
 * geschehen statt mitten im Lauf. Geschrieben wird ueber `update` und
 * `updateEmbeddedDocuments`, also durch das Netz.
 *
 * WAS ER NICHT TUT. Fremde Flags behalten die Toradresse (stre-T-128). Eine
 * Toradresse mit fremdem oder frueherem Host laesst `schluesselfreiAdresse`
 * stehen; sie wird als Rest gezaehlt. Kompendien fasst er nicht an.
 *
 * EINMAL JE WELT, unter dem Weltriegel des Adressnachzugs, mit dem Zweck des
 * Ruecklaufs (`RUECKLAUF_ZWECK`): ein Adressnachzug, der den Riegel besetzt
 * findet, wartet dann auf diesen Lauf, statt abzusagen. Den Riegel nimmt er
 * nur, wenn ein Zaehllauf vorab etwas fand. Die Marke
 * `SETTING.flaggenGefaltet` wird nur nach einem Lauf ohne Fehlschlag gesetzt.
 *
 * Die Zaehlzeile nennt nur Zahlen, keine Adresse und keinen Schluessel.
 * Pruefsatz: `stream-flaggen.test.mjs`.
 */
import { MODULE_ID, SETTING, streamKey,
         nachzugRiegelNehmen, nachzugRiegelLoesen, RUECKLAUF_ZWECK } from "./stream-settings.mjs"
import { falteWerte, FLAGGEN_FELDER } from "./stream-leinwand.mjs"

/** Ein Torsegment mit Schluessel, wie es die Journalheilung zaehlt. */
const SCHLUESSELSTELLE = /https?:\/\/[^/"'\s]+\/[acs]\/[A-Za-z0-9_-]{16,64}\//gi

/** Was nach dem Falten noch einen Schluessel traegt: Rest, nicht geschrieben. */
function rest(art, daten, neu) {
  let zahl = 0
  for (const k of FLAGGEN_FELDER[art] ?? []) {
    const wert = neu[`flags.${MODULE_ID}.${k}`] ?? daten?.flags?.[MODULE_ID]?.[k]
    if (wert != null) zahl += JSON.stringify(wert).match(SCHLUESSELSTELLE)?.length ?? 0
  }
  return zahl
}

function markeGesetzt() {
  try { return game.settings.get(MODULE_ID, SETTING.flaggenGefaltet) === true }
  catch (_e) { return false }
}

async function markeSetzen(bericht) {
  try { await game.settings.set(MODULE_ID, SETTING.flaggenGefaltet, true) }
  catch (_e) { bericht.fehler++ }
}

/** Die Szenen, die angezeigte zuletzt. */
function szenenFolge() {
  const alle = [...(globalThis.game?.scenes ?? [])]
  const angezeigt = globalThis.game?.scenes?.viewed ?? globalThis.canvas?.scene ?? null
  const i = angezeigt ? alle.indexOf(angezeigt) : -1
  if (i >= 0) alle.push(...alle.splice(i, 1))
  return alle
}

async function durchlaufen(bericht, trocken) {
  for (const szene of szenenFolge()) {
    // Gemeldet wird die Kennung, nie der Fehlertext: der kann eine Adresse tragen.
    const wer = `Scene ${szene?.id ?? "?"}`
    try {
      const quelle = szene.toObject()
      const eigen = falteWerte("Scene", quelle)
      bericht.rest += rest("Scene", quelle, eigen)
      const kacheln = []
      for (const kachel of Array.isArray(quelle.tiles) ? quelle.tiles : []) {
        const neu = falteWerte("Tile", kachel)
        bericht.rest += rest("Tile", kachel, neu)
        if (!Object.keys(neu).length) continue
        if (!kachel?._id) {
          bericht.fehler++
          console.warn(`Beneos Stream | Eigene Flags: ${wer}, Kachel ohne Kennung nicht geschrieben`)
          continue
        }
        kacheln.push({ _id: kachel._id, ...neu })
      }
      const hatEigen = Object.keys(eigen).length > 0
      bericht.dokumente += (hatEigen ? 1 : 0) + kacheln.length
      if (trocken || (!hatEigen && !kacheln.length)) continue
      if (hatEigen) await szene.update(eigen)
      if (kacheln.length) await szene.updateEmbeddedDocuments("Tile", kacheln)
    } catch (_e) {
      bericht.fehler++
      console.warn(`Beneos Stream | Eigene Flags: ${wer} nicht geschrieben`)
    }
  }
}

/**
 * Die Umstellung. Nur fuer die Spielleitung, nur mit Schluessel, einmal je Welt.
 *
 * @param {{trocken?: boolean}} optionen trocken: nur zaehlen, nichts schreiben
 * @returns {Promise<{dokumente:number, rest:number, fehler:number, trocken:boolean, grund:string}>}
 */
export async function flaggenUmstellen({ trocken = false } = {}) {
  const bericht = { dokumente: 0, rest: 0, fehler: 0, trocken, grund: "" }
  if (!globalThis.game?.user?.isGM) { bericht.grund = "kein gm"; return bericht }
  if (!streamKey()) { bericht.grund = "ohne schluessel"; return bericht }
  if (markeGesetzt()) { bericht.grund = "erledigt"; return bericht }

  if (trocken) {
    await durchlaufen(bericht, true)
  } else {
    // Erst ohne Riegel zaehlen; der Riegel wartet bis zu 1500 ms, und der
    // Weltstart wartet auf diesen Lauf. Nichts gefunden: nur die Marke.
    const vorab = { dokumente: 0, rest: 0, fehler: 0 }
    await durchlaufen(vorab, true)
    if (vorab.dokumente === 0) {
      bericht.rest = vorab.rest
      bericht.fehler = vorab.fehler
      if (vorab.fehler === 0) await markeSetzen(bericht)
    } else {
      const marke = await nachzugRiegelNehmen(RUECKLAUF_ZWECK)
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
  console.log(`Beneos Stream | Eigene Flags${trocken ? " (trocken)" : ""}: ${bericht.dokumente} Dokumente `
    + `schluesselfrei, ${bericht.rest} Stellen belassen, ${bericht.fehler} Fehler`)
  return bericht
}
