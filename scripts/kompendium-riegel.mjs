/**
 * Der gemeinsame Riegel ueber die vier Welt-Kompendien (stre-T-233).
 *
 * WARUM ES IHN GIBT. Zwei Sperrzyklen liefen ohne gemeinsamen Riegel auf
 * denselben Kompendien: die Pruefung beim Start
 * (`BeneosUtility.verifySettingsAgainstCompendium`) und die Installation.
 * Die eine sperrte der anderen die Kompendien unter den Fuessen zu, oder sie
 * loeschte ein Dokument, das die andere gerade ersetzt hatte. Folge: "does
 * not exist" beim Loeschen, items und spells blieben entsperrt, die Registry
 * war halb bereinigt, oder die Installation scheiterte an einem gesperrten
 * Kompendium.
 *
 * ZWEI TEILE, und beide werden gebraucht:
 *
 *   - Die KETTE ordnet die Auftraege: Installationen (ueber
 *     `BeneosCloud.enqueueInstall`) und der Schreibteil von verify laufen
 *     nacheinander, nie ineinander.
 *   - Der ZAEHLER je Kompendium entscheidet, wann gesperrt wird. Die
 *     Sammelinstallation haelt die Kompendien ueber viele Auftraege offen; ein
 *     Auftrag, der dazwischen faellt, darf sie ihr nicht zusperren. Erst die
 *     erste Entsperrung entsperrt, erst die letzte Sperrung sperrt.
 *
 * Kein Teil davon wartet auf die Kette, wenn er aus einem Auftrag heraus
 * gerufen wird. `entsperre` und `sperre` laufen deshalb NICHT ueber die Kette:
 * ein Auftrag, der auf die Kette wartet, wartet auf sich selbst.
 *
 * Das Modul nennt keine Foundry-Globale, damit der Bench
 * (`tools/kompendium-riegel-bench`) es ohne Foundry fahren kann.
 */

let kette = Promise.resolve()

/**
 * Haengt einen Auftrag an die gemeinsame Kette und gibt sein Ergebnis zurueck.
 * Die Kette reisst nie ab: der Fehler eines Auftrags erreicht seinen Aufrufer,
 * der naechste Auftrag laeuft trotzdem.
 */
export function inDerKette(job) {
  const glied = kette.then(job)
  kette = glied.catch(() => { })
  return glied
}

const offen = new Map()
const oeffnend = new Map()
const schluessel = (pack) => pack.collection ?? pack.metadata?.id

/**
 * Entsperrt jedes Kompendium, das noch niemand offen haelt, und zaehlt mit.
 *
 * Scheitert ein Entsperren, nimmt der Aufruf seine Zaehlung fuer dieses
 * Kompendium zurueck, gibt die schon geoeffneten wieder frei und wirft. Sonst
 * stuende der Zaehler auf 1 bei gesperrtem Kompendium, und kein spaeteres
 * Entsperren versuchte es je wieder. Gezaehlt wird VOR dem await, damit ein
 * gleichzeitiger Aufrufer die Zaehlung sieht; ein solcher wartet auf das
 * laufende Oeffnen, statt in ein noch gesperrtes Kompendium zu schreiben.
 */
export async function entsperre(packs) {
  const geoeffnet = []
  for (const pack of packs) {
    if (!pack) continue
    const k = schluessel(pack)
    const n = offen.get(k) ?? 0
    offen.set(k, n + 1)
    try {
      if (n === 0) {
        const auf = pack.configure({ locked: false })
        oeffnend.set(k, auf)
        try {
          await auf
        } finally {
          if (oeffnend.get(k) === auf) oeffnend.delete(k)
        }
      } else if (oeffnend.has(k)) {
        await oeffnend.get(k)
      }
    } catch (fehler) {
      const jetzt = (offen.get(k) ?? 1) - 1
      if (jetzt <= 0) offen.delete(k)
      else offen.set(k, jetzt)
      await sperre(geoeffnet).catch(() => { })
      throw fehler
    }
    geoeffnet.push(pack)
  }
}

/**
 * Gibt eine Entsperrung zurueck und sperrt erst, wenn niemand mehr offen haelt.
 * Ein Sperren ohne vorheriges Entsperren sperrt sofort: lieber zu als offen.
 * Scheitert ein Kompendium, werden die uebrigen trotzdem gesperrt, und erst
 * danach wird der erste Fehler geworfen; sonst blieben sie offen und gezaehlt.
 */
export async function sperre(packs) {
  let ersterFehler = null
  for (const pack of packs) {
    if (!pack) continue
    const k = schluessel(pack)
    const n = offen.get(k) ?? 0
    if (n > 1) {
      offen.set(k, n - 1)
      continue
    }
    offen.delete(k)
    try {
      await pack.configure({ locked: true })
    } catch (fehler) {
      ersterFehler ??= fehler
    }
  }
  if (ersterFehler) throw ersterFehler
}

/** Foundry meldet ein schon fehlendes Dokument mit diesem Wortlaut. */
export function istFehlend(fehler) {
  return /does not exist/i.test(String(fehler?.message ?? fehler))
}

/**
 * Der Schreibteil von verify, als ein Auftrag in der Kette.
 *
 * `eintraege`: je Registry-Eintrag, den die Pruefung verwerfen will,
 *   `{ registry, key, stand, loesche }`. `registry` ist ein Getter auf das
 *   Registry-Objekt (es kann zwischen Pruefung und Schreibteil neu gelesen
 *   werden), `stand` der Eintrag als JSON zur Zeit der Pruefung, `loesche`
 *   optional das Loeschen des zugehoerigen Kompendium-Dokuments.
 *
 * Verworfen wird nur, was sich seit der Pruefung nicht geaendert hat. Eine
 * Kreatur, die waehrend der rund 17 s Pruefung neu installiert wurde, behaelt
 * Dokument und Eintrag. Ein schon fehlendes Dokument zaehlt als geloescht.
 *
 * Bei jedem anderen Fehler endet die Schleife. Aus der Registry faellt dann
 * genau, was bis dahin erledigt ist (Dokument geloescht oder keines noetig),
 * damit kein Eintrag auf ein schon geloeschtes Dokument zeigt; was danach kam,
 * bleibt unberuehrt. `nachher` (Speichern, Meldung) laeuft auch dann, noch in
 * der Kette, und erst danach wird der Fehler weitergeworfen.
 */
export function verwirfImRiegel({ packs, eintraege, nachher }) {
  return inDerKette(async () => {
    const gueltig = eintraege.filter((e) => JSON.stringify(e.registry()[e.key]) === e.stand)
    const erledigt = []
    let abbruch = null
    await entsperre(packs)
    try {
      for (const e of gueltig) {
        if (e.loesche) {
          try {
            await e.loesche()
          } catch (fehler) {
            if (!istFehlend(fehler)) {
              abbruch = fehler
              break
            }
          }
        }
        erledigt.push(e)
      }
    } finally {
      // Ein Fehler beim Wiedersperren darf die Bereinigung des schon
      // Geloeschten nicht verdraengen; er wird nach ihr geworfen.
      await sperre(packs).catch((fehler) => { abbruch ??= fehler })
    }
    for (const e of erledigt) delete e.registry()[e.key]
    if (nachher && erledigt.length > 0) await nachher(erledigt.length)
    if (abbruch) throw abbruch
    return erledigt.length
  })
}
