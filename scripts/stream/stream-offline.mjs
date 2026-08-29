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

import { MODULE_ID, SETTING, streamEnabled, assetUrl } from "./stream-settings.mjs"
import { offlineGehalten, offlineHalten, offlineFreigeben } from "./stream-fetch.mjs"
import { streamAdressenVon } from "./stream-online.mjs"
import { loadStreamManifest } from "./stream-install.mjs"

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

/**
 * Das Kontingent, solange das Tor keines nennt.
 *
 * Betreiberentscheidung vom 29.08.2026: drei Gigabyte zu Beginn, plus ein
 * halbes je vollem Monat Mitgliedschaft, gedeckelt bei sieben. Berechnet wird
 * das in der Cloud beim Bau des Berechtigungssatzes; bis das steht, gilt hier
 * der Startwert fuer alle.
 *
 * Sieben Gigabyte sind nicht willkuerlich: es ist der Anteil des gemessenen
 * Browserkontingents von rund zehn, den die Hausordnung in `stream-fetch.mjs`
 * fuer offline gehaltene Dateien reserviert.
 */
export const KONTINGENT_VORGABE = 3 * 1024 * 1024 * 1024
export const KONTINGENT_DECKEL = 7 * 1024 * 1024 * 1024

/**
 * Wie viel dieser Kunde offline halten darf.
 *
 * Liest den Wert aus dem Berechtigungssatz, sobald das Tor ihn mitliefert, und
 * faellt sonst auf den Startwert zurueck. Die Trennung steht hier und nicht
 * beim Aufrufer, damit spaeter genau eine Stelle zu aendern ist.
 */
export function kontingent() {
  try {
    const b = Number(globalThis.BeneosStream?._offlineBytes)
    if (b > 0) return Math.min(b, KONTINGENT_DECKEL)
  } catch (_) { }
  return KONTINGENT_VORGABE
}

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

// ---- Von der Szene zur Karte ------------------------------------------

/**
 * Die Manifeste dieser Sitzung, damit ein Rechtsklick nicht jedes Mal das Tor
 * fragt. Ein Manifest ist wenige hundert Kilobyte und aendert sich waehrend
 * einer Sitzung nicht; die Karte einer Szene aendert sich nie.
 */
const manifestCache = new Map()

async function manifestVon(release, variant) {
  const id = `${release}|${variant}`
  if (manifestCache.has(id)) return manifestCache.get(id)
  try {
    const m = await loadStreamManifest(release, variant)
    manifestCache.set(id, m)
    return m
  } catch (_) {
    manifestCache.set(id, null)   // auch ein Fehlschlag wird gemerkt, sonst haemmert jeder Klick
    return null
  }
}

/**
 * Release, Variante und Dateipfad aus einer Toradresse zurueckgewinnen.
 *
 * Form: `<tor>/a/<schluessel>/<release>/<variante>/<pfad...>`. Der Pfad ist
 * beim Bauen je Abschnitt kodiert worden, also wird er je Abschnitt wieder
 * entschluesselt.
 */
function zerlegeAdresse(url) {
  try {
    const u = new URL(url)
    const teile = u.pathname.replace(/^\/+/, "").split("/")
    if (teile[0] !== "a" || teile.length < 5) return null
    return {
      release: decodeURIComponent(teile[2]),
      variant: decodeURIComponent(teile[3]),
      pfad: teile.slice(4).map(decodeURIComponent).join("/"),
    }
  } catch (_) { return null }
}

/**
 * Welche Karte gehoert zu dieser Szene?
 *
 * NICHT ueber die Szenen-Kennung aus dem Paket. Die steht zwar im Manifest,
 * aber ob sie den Import in eine Welt unveraendert uebersteht, haengt am
 * Packer und ist damit eine Annahme. Die Dateipfade dagegen stehen in den
 * Toradressen der Szene selbst und sind genau das, was ausgeliefert wurde.
 *
 * Gibt `null` zurueck, wenn die Szene nichts Gestreamtes traegt, wenn das
 * Manifest nicht erreichbar ist, oder wenn es noch kein `places` fuehrt. Der
 * dritte Fall ist waehrend der Umstellung der Normalfall: die ausgelieferten
 * Manifeste tragen das Feld erst nach ihrer Neuerzeugung.
 */
export async function karteZuSzene(scene) {
  const adressen = streamAdressenVon(scene)
  if (!adressen.length) return null
  const erste = zerlegeAdresse(adressen[0])
  if (!erste) return null

  const m = await manifestVon(erste.release, erste.variant)
  if (!m?.places?.length) return null

  // Die Pfade dieser Szene, damit der Vergleich nicht ueber ganze Adressen
  // laeuft: der Schluessel darin kann sich drehen, der Pfad nicht.
  const pfade = new Set(adressen.map(a => zerlegeAdresse(a)?.pfad).filter(Boolean))

  for (const platz of m.places) {
    if (!(platz.files || []).some(f => pfade.has(f))) continue
    return {
      release: erste.release,
      variant: erste.variant,
      karte: platz.id,
      name: platz.name || platz.id,
      kind: platz.kind || "",
      // Die vollen Adressen ALLER Dateien der Karte, nicht nur der dieser
      // Szene: eine Karte ist Battlemap und Szenerie zusammen, und wer nur die
      // eine haelt, hat beim Umschalten auf die andere doch wieder ein Loch.
      urls: (platz.files || []).map(f => assetUrl(erste.release, erste.variant, f)),
      bytes: 0,
    }
  }
  return null
}

/** Der Zustand einer Szene fuer die Oberflaeche, in einem Aufruf. */
export async function szenenzustand(scene) {
  const karte = await karteZuSzene(scene)
  if (!karte) return { bekannt: false }
  return {
    bekannt: true, karte,
    zugesagt: istZugesagt(karte.release, karte.variant, karte.karte),
  }
}

/**
 * Der vorgewaermte Zustand je Szene, damit die Oberflaeche synchron antworten
 * kann.
 *
 * Foundrys Kontextmenue fragt seine `condition` synchron, und das Zeichnen der
 * Szenenliste wartet auf niemanden. Die Karte einer Szene zu ermitteln braucht
 * dagegen das Manifest, also einen Abruf. Beides geht nur zusammen, wenn der
 * Zustand vorher dasteht.
 *
 * Dasselbe Verfahren benutzt das Modul seit laengerem fuer die Umschaltung
 * zwischen statischer und animierter Karte (`warmStaticSwitchCache`), und aus
 * demselben Grund.
 */
const zustandCache = new Map()
let warmlaufLaeuft = false

/** Synchron, fuer Kontextmenue und Listenmarkierung. Unbekannt heisst: noch nicht gewaermt. */
export function zustandAusCache(sceneId) {
  return zustandCache.get(String(sceneId)) || null
}

/**
 * Den Zustand aller Szenen ermitteln, die etwas Gestreamtes tragen.
 *
 * Mehrere Aufrufe gleichzeitig werden zusammengefasst: das Zeichnen der
 * Seitenleiste feuert bei jeder Dokumentaenderung, und ein Warmlauf je
 * Tastendruck waere teurer als der Nutzen.
 */
export async function warmeZustaende() {
  if (warmlaufLaeuft) return { uebersprungen: true }
  if (!streamEnabled()) return { uebersprungen: "kein-streaming" }
  warmlaufLaeuft = true
  let gefunden = 0
  try {
    for (const scene of game.scenes ?? []) {
      const zustand = await szenenzustand(scene)
      if (!zustand.bekannt) { zustandCache.delete(String(scene.id)); continue }
      zustandCache.set(String(scene.id), zustand)
      gefunden++
    }
  } catch (err) {
    console.warn("Beneos Stream | Warmlauf der Offline-Zustaende abgebrochen", err)
  } finally {
    warmlaufLaeuft = false
  }
  return { gefunden, szenen: game.scenes?.size ?? 0 }
}

/**
 * Den Zustand einer einzelnen Szene nachziehen, nach einer Aenderung.
 *
 * Billiger als ein voller Warmlauf und genau das, was nach einem Zusagen oder
 * Loesen gebraucht wird.
 */
export async function ziehZustandNach(sceneId) {
  const scene = game.scenes?.get(String(sceneId))
  if (!scene) return null
  const zustand = await szenenzustand(scene)
  if (zustand.bekannt) zustandCache.set(String(sceneId), zustand)
  else zustandCache.delete(String(sceneId))
  return zustand
}

/**
 * Alle Szenen einer Karte nachziehen, nicht nur die angeklickte.
 *
 * Eine Karte ist Battlemap und Szenerie zusammen. Wer nur die angeklickte
 * Zeile nachzieht, laesst die Schwesterszene mit dem alten Zustand stehen, und
 * die Markierung in der Liste widerspricht sich selbst.
 */
export async function ziehKarteNach(karte) {
  const betroffen = []
  for (const [sceneId, z] of zustandCache) {
    if (z?.karte?.release === karte.release && z?.karte?.variant === karte.variant
      && z?.karte?.karte === karte.karte) betroffen.push(sceneId)
  }
  for (const id of betroffen) await ziehZustandNach(id)
  return betroffen.length
}

/**
 * Was der Rechtsklick auslöst: zusagen oder lösen, je nach Zustand.
 *
 * Alles, was danach stimmen muss, passiert hier und nicht beim Aufrufer:
 * der Zustand aller Szenen dieser Karte, die Szenenliste, die Navigationszeile.
 * Foundry zeichnet die Liste immer vollstaendig neu und kennt kein Zeichnen
 * einzelner Eintraege, also ist ein Neuzeichnen ohnehin unvermeidlich.
 */
export async function schalteKarte(sceneId) {
  const scene = game.scenes?.get(String(sceneId))
  if (!scene) return { ok: false, grund: "keine-szene" }
  const zustand = await szenenzustand(scene)
  if (!zustand.bekannt) return { ok: false, grund: "keine-karte" }
  const k = zustand.karte

  let ergebnis
  if (zustand.zugesagt) {
    ergebnis = await karteLoesen(k.release, k.variant, k.karte)
    if (ergebnis.ok) {
      ui.notifications?.info(game.i18n.format("BENEOS.Stream.Offline.Released", { name: k.name })
        || `"${k.name}" is streamed again.`)
    }
  } else {
    ui.notifications?.info(game.i18n.format("BENEOS.Stream.Offline.Fetching1", { name: k.name })
      || `Fetching "${k.name}" for offline use...`)
    ergebnis = await karteZusagen({ ...k, name: k.name })
    if (ergebnis.ok) {
      const mb = Math.round((ergebnis.ergebnis?.bytes || 0) / 1048576)
      ui.notifications?.info(game.i18n.format("BENEOS.Stream.Offline.Kept", { name: k.name, mb })
        || `"${k.name}" is available offline (${mb} MB).`)
    } else if (ergebnis.grund === "deckel") {
      ui.notifications?.warn(game.i18n.localize("BENEOS.Stream.Offline.QuotaFull")
        || "Your offline storage is full. Release a map before keeping another one.")
    } else {
      ui.notifications?.error(game.i18n.format("BENEOS.Stream.Offline.KeepFailed", { name: k.name })
        || `"${k.name}" could not be fetched completely and was not kept.`)
    }
  }

  await ziehKarteNach(k)
  try { ui.scenes?.render(); ui.nav?.render() } catch (_) { /* Anzeige ist Beiwerk */ }
  return ergebnis
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
