/**
 * Das Verzeichnis der offline zugesagten Karten, und die Pruefung, ob sie
 * wirklich noch da sind.
 *
 * WARUM ES DIESES VERZEICHNIS UEBERHAUPT GIBT
 *
 * Der Speicher des Browsers weiss, welche DATEIEN er haelt. Er weiss nicht,
 * welche KARTEN der Kunde zugesagt bekommen hat, wie sie heissen und was sie
 * gekostet haben. Genau diese Differenz ist der Schaden, wenn der Speicher
 * geraeumt wird, und ohne ein Verzeichnis waere sie nicht feststellbar: eine
 * verschwundene Datei hinterlaesst keine Spur, sie ist einfach nicht mehr da.
 *
 * DIE ENTSCHEIDUNG DAHINTER
 *
 * Der Browser raeumt selten, aber er raeumt. Chrome tut es nur, wenn alle
 * Urspruenge zusammen achtzig Prozent der Platte belegen oder die Platte knapp
 * wird, und dann nach Zuletzt-benutzt ueber ganze Urspruenge. Die
 * Chrome-Entwickler halten fest, dass Daten sehr selten geloescht werden.
 *
 * Das eigentliche Risiko ist nicht technisch: es ist der Kunde, der auf Rat
 * aus der Foundry-Gemeinde seine Websitedaten leert, ein Aufraeumprogramm, und
 * der Wechsel zwischen `localhost` und der Netzwerkadresse desselben Rechners,
 * die zwei getrennte Vorraete sind.
 *
 * Deshalb steht dieses Netz darunter, und ohne das Netz waere der
 * Browserspeicher als Ablage nicht vertretbar. Es verhindert den Verlust
 * nicht. Es sorgt dafuer, dass der Spielleiter ihn ZU HAUSE MIT VERBINDUNG
 * bemerkt, wo er zwei Klicks kostet, statt am Spieltisch ohne Verbindung, wo
 * er den Abend kostet.
 */

import { MODULE_ID, SETTING, streamEnabled } from "./stream-settings.mjs"
import { offlineGehalten, offlineHalten, offlineFreigeben } from "./stream-fetch.mjs"

/**
 * Vierzehn Tage ohne gueltige Berechtigung, dann fallen die Zusagen.
 *
 * Sieben waren erwogen und sind verworfen: eine Gruppe mit zweiwoechigem
 * Rhythmus, deren Spielleiter die Welt nur zum Spielen oeffnet, staende damit
 * an JEDEM Termin ohne Vorrat da, obwohl sie durchgehend zahlt. Dazu
 * Sommerpause, Krankheit, Reisewochen. Eine kurze Frist trifft treue Kunden
 * haerter als Abgreifer, denn wer wirklich abgreifen will, schaltet das Modul
 * ab und ist von keiner Frist erreichbar.
 *
 * Nach Ablauf laufen die Dateien in die gewoehnliche Frist von 72 Stunden,
 * werden also nicht sofort geloescht. Effektiv sind es siebzehn Tage.
 */
export const VERFALL_TAGE = 14
const TAG_MS = 24 * 60 * 60 * 1000

/** Zwei Warnungen, bevor es soweit ist. */
const WARNUNG_AB_TAGEN = 3

// ---- Das Verzeichnis ---------------------------------------------------

function lies() {
  try { return game.settings.get(MODULE_ID, SETTING.offlineHeld) || {} }
  catch (_) { return {} }
}

async function schreib(alle) {
  try { await game.settings.set(MODULE_ID, SETTING.offlineHeld, alle) }
  catch (e) { console.warn("Beneos Stream | Offline-Verzeichnis nicht schreibbar", e) }
}

/** Die Kennung einer Karte, eindeutig ueber alle Releases und Varianten. */
export function karteId(release, variant, karte) {
  return `${release}|${variant}|${karte}`
}

/** Alle zugesagten Karten, als Liste. */
export function alleKarten() {
  return Object.values(lies()).filter(e => e && typeof e === "object")
}

/** Was die zugesagten Karten zusammen wiegen, und wie viele es sind. */
export function vorratsstand() {
  const liste = alleKarten()
  return { karten: liste.length, bytes: liste.reduce((s, e) => s + (Number(e.bytes) || 0), 0) }
}

/** Ist diese Karte zugesagt? Reine Frage an das Verzeichnis, nicht an den Speicher. */
export function istZugesagt(release, variant, karte) {
  return Boolean(lies()[karteId(release, variant, karte)])
}

/**
 * Eine Karte zusagen: erst holen, dann eintragen.
 *
 * Die Reihenfolge ist bindend. Ein Eintrag, dessen Dateien nicht liegen, waere
 * genau die Luege, die dieses Verzeichnis aufdecken soll.
 */
export async function karteZusagen({ release, variant, karte, name, urls, onProgress }) {
  if (!streamEnabled()) return { ok: false, grund: "kein-streaming" }
  const liste = [...new Set((urls || []).filter(Boolean))]
  if (!liste.length) return { ok: false, grund: "keine-dateien" }

  const ergebnis = await offlineHalten(liste, onProgress)
  if (ergebnis.deckelErreicht) return { ok: false, grund: "deckel", ergebnis }
  if (ergebnis.fehlgeschlagen > 0) {
    // Halb gehalten ist schlechter als gar nicht: die Karte belegt Platz und
    // zeichnet trotzdem nicht. Also zuruecknehmen, was schon liegt.
    await offlineFreigeben(liste)
    return { ok: false, grund: "unvollstaendig", ergebnis }
  }

  const alle = lies()
  alle[karteId(release, variant, karte)] = {
    release, variant, karte,
    name: String(name || karte),
    urls: liste,
    bytes: Number(ergebnis.bytes) || 0,
    seit: Date.now(),
  }
  await schreib(alle)
  return { ok: true, ergebnis }
}

/** Eine Zusage zuruecknehmen. Die Bytes bleiben zunaechst liegen. */
export async function karteLoesen(release, variant, karte) {
  const alle = lies()
  const id = karteId(release, variant, karte)
  const eintrag = alle[id]
  if (!eintrag) return { ok: false, grund: "nicht-zugesagt" }
  await offlineFreigeben(eintrag.urls || [])
  delete alle[id]
  await schreib(alle)
  return { ok: true }
}

// ---- Die Berechtigungsuhr ---------------------------------------------

/**
 * Festhalten, dass eine GUELTIGE Berechtigung gesehen wurde.
 *
 * Nicht "wir waren online": wer Verbindung hat, aber abgewiesen wird oder
 * keinen gueltigen Schluessel traegt, fuer den laeuft die Uhr weiter. Genau
 * das ist der Unterschied, an dem der Verfall haengt.
 */
export async function berechtigungGesehen() {
  try { await game.settings.set(MODULE_ID, SETTING.offlineSeen, Date.now()) }
  catch (_) { /* eine nicht schreibbare Einstellung darf den Start nicht anhalten */ }
}

/**
 * Wie es um die Frist steht.
 *
 * `nie` bedeutet, dass noch keine Berechtigung gesehen wurde. Das ist KEIN
 * Verfall: eine frisch eingeschaltete Welt hat noch keine gesehen, und ihr den
 * Vorrat zu nehmen, bevor sie einen hat, waere absurd.
 */
export function verfallsstand() {
  let zuletzt = 0
  try { zuletzt = Number(game.settings.get(MODULE_ID, SETTING.offlineSeen)) || 0 } catch (_) { }
  if (!zuletzt) return { nie: true, tageOffen: VERFALL_TAGE, abgelaufen: false, warnen: false }
  const vergangen = (Date.now() - zuletzt) / TAG_MS
  const tageOffen = Math.max(0, Math.ceil(VERFALL_TAGE - vergangen))
  return {
    nie: false, zuletzt, tageOffen,
    abgelaufen: vergangen >= VERFALL_TAGE,
    warnen: !!(tageOffen <= WARNUNG_AB_TAGEN && tageOffen > 0),
  }
}

// ---- Die Pruefung -----------------------------------------------------

/**
 * Was das Verzeichnis verspricht, gegen das, was der Speicher haelt.
 *
 * Bewusst streng je Karte: eine fehlende Datei macht die ganze Karte
 * unvollstaendig. Eine halb gezeichnete Karte ist schlechter als eine
 * ehrliche Ansage, denn sie sieht aus wie ein Fehler und nicht wie eine
 * Auskunft.
 */
export async function pruefeVorrat() {
  const liste = alleKarten()
  const fehlend = []
  for (const e of liste) {
    if (await offlineGehalten(e.urls || [])) continue
    fehlend.push(e)
  }
  return {
    zugesagt: liste.length,
    vollstaendig: liste.length - fehlend.length,
    fehlend,
    bytesFehlend: fehlend.reduce((s, e) => s + (Number(e.bytes) || 0), 0),
  }
}

/**
 * Die fehlenden Karten neu holen.
 *
 * Getrennt von der Pruefung, weil das Holen Zeit und Leitung kostet und der
 * Kunde es entscheiden soll. Wer offline ist, bekommt hier nichts, und das
 * ist richtig: dann ist ohnehin nichts zu holen.
 */
export async function vorratHeilen(fehlend, onProgress) {
  const summe = { geholt: 0, fehlgeschlagen: 0, karten: 0 }
  for (const e of fehlend || []) {
    const r = await offlineHalten(e.urls || [], onProgress)
    summe.geholt += r.geholt + r.gehalten
    summe.fehlgeschlagen += r.fehlgeschlagen
    if (!r.fehlgeschlagen) summe.karten++
  }
  return summe
}

/**
 * Der ganze Ablauf beim Weltstart, in der Reihenfolge, die er haben muss.
 *
 * Erst die Uhr, dann der Verfall, dann die Pruefung. Die Reihenfolge ist
 * nicht beliebig: wer erst prueft und dann verfallen laesst, meldet dem Kunden
 * einen Schaden, den anschliessend eine Regel erzeugt haette.
 *
 * Gemeldet wird nur, was den Kunden angeht. Ein vollstaendiger Vorrat
 * erscheint im Protokoll und sonst nirgends; eine Meldung bei jedem Weltstart
 * waere nach der dritten Woche Rauschen.
 */
export async function beimWeltstart({ berechtigt }) {
  if (!streamEnabled()) return { uebersprungen: "kein-streaming" }
  if (!alleKarten().length) {
    // Nichts zugesagt, nichts zu pruefen. Die Uhr laeuft trotzdem mit, damit
    // sie nicht bei der ersten Zusage schon abgelaufen ist.
    if (berechtigt) await berechtigungGesehen()
    return { uebersprungen: "nichts-zugesagt" }
  }

  if (berechtigt) await berechtigungGesehen()

  const frist = verfallsstand()
  if (frist.abgelaufen) {
    const v = await vorratVerfallen()
    console.log(`Beneos Stream | Offline-Vorrat verfallen: ${v.gefallen} Karten, `
      + `seit ${VERFALL_TAGE} Tagen keine gueltige Berechtigung`)
    return { verfallen: v.gefallen, frist }
  }

  const stand = await pruefeVorrat()
  const vorrat = vorratsstand()
  console.log(`Beneos Stream | Offline-Vorrat: ${stand.vollstaendig} von ${stand.zugesagt} Karten `
    + `vollstaendig, ${Math.round(vorrat.bytes / 1048576)} MB zugesagt, `
    + (frist.nie ? "Frist laeuft noch nicht" : `noch ${frist.tageOffen} Tage`))

  return { stand, frist, vorrat }
}

// ---- Was der Kunde davon sieht ----------------------------------------

const DialogV2 = () => foundry.applications?.api?.DialogV2

function localize(key, fallback) {
  try { const t = game.i18n.localize(key); return (t && t !== key) ? t : fallback }
  catch (_) { return fallback }
}

/**
 * Fehlende Karten melden, und zwar mit Namen.
 *
 * "Drei Karten fehlen" ist eine Auskunft, mit der niemand etwas anfangen kann.
 * Erst die Namen sagen dem Spielleiter, ob es die Karten des naechsten Abends
 * betrifft oder etwas, das er ohnehin nicht mehr braucht.
 */
export async function meldeFehlendenVorrat(bericht) {
  const fehlend = bericht?.stand?.fehlend || []
  if (!fehlend.length) return false
  const D = DialogV2()
  const namen = fehlend.slice(0, 8).map(e => foundry.utils.escapeHTML(String(e.name))).join(", ")
  const rest = fehlend.length > 8 ? ` and ${fehlend.length - 8} more` : ""
  const mb = Math.round((bericht.stand.bytesFehlend || 0) / 1048576)

  const text = `<p>${localize("BENEOS.Stream.Offline.MissingIntro",
      "Some of your offline maps are no longer in this browser's storage.")}</p>`
    + `<p><strong>${namen}${rest}</strong></p>`
    + `<p>${localize("BENEOS.Stream.Offline.MissingWhy",
      "This usually happens when browser data was cleared, or when the world is opened "
      + "from a different address than before. Your membership is unaffected.")}</p>`
    + `<p>${localize("BENEOS.Stream.Offline.MissingAsk",
      "Fetch them again now?")} (${mb} MB)</p>`

  if (!D) {
    ui.notifications?.warn(`Beneos: ${fehlend.length} offline map(s) missing from browser storage.`)
    return false
  }
  const ja = await D.confirm({
    window: { title: localize("BENEOS.Stream.Offline.MissingTitle", "Offline maps are missing") },
    content: text,
    yes: { label: localize("BENEOS.Stream.Offline.FetchNow", "Fetch now"), default: true },
    no: { label: localize("BENEOS.Stream.Offline.Later", "Later"), default: false },
    rejectClose: false,
  }).catch(() => false)
  if (ja !== true) return false

  ui.notifications?.info(localize("BENEOS.Stream.Offline.Fetching", "Fetching your offline maps..."))
  const summe = await vorratHeilen(fehlend)
  if (summe.fehlgeschlagen) {
    ui.notifications?.warn(`Beneos: ${summe.karten} of ${fehlend.length} map(s) restored, `
      + `${summe.fehlgeschlagen} file(s) could not be fetched.`)
  } else {
    ui.notifications?.info(`Beneos: ${summe.karten} offline map(s) restored.`)
  }
  return true
}

/** Der Verfall wird gemeldet, nicht stillschweigend vollzogen. */
export async function meldeVerfall(anzahl) {
  ui.notifications?.warn(game.i18n.format("BENEOS.Stream.Offline.Expired",
    { count: anzahl, days: VERFALL_TAGE })
    || `Beneos: ${anzahl} offline map(s) expired after ${VERFALL_TAGE} days without a `
     + `membership check. Open this world while online to keep them next time.`)
  return true
}

/**
 * Alle Zusagen fallen lassen, weil die Frist abgelaufen ist.
 *
 * Das Verzeichnis wird dabei GELEERT, nicht nur der Speicher freigegeben.
 * Sonst meldete die naechste Pruefung lauter fehlende Karten und behauptete
 * einen Schaden, wo eine Regel gegriffen hat.
 */
export async function vorratVerfallen() {
  const liste = alleKarten()
  for (const e of liste) {
    try { await offlineFreigeben(e.urls || []) } catch (_) { /* weiter */ }
  }
  await schreib({})
  return { gefallen: liste.length }
}
