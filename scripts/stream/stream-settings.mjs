/**
 * Settings for streaming.
 *
 * All world-scoped, all hidden from the settings sheet, all GM-only, following
 * the pattern of `beneos-cloud-base-url` in beneos_utility.js. Hidden because
 * the delivery model is not a customer choice, and world-scoped because the
 * addresses live in that world's documents.
 *
 * DER HAUPTSCHALTER STEHT SEIT DEM 2026-09-03 AUF AN.
 *
 * Vorher stand er auf aus, und keine Stelle setzte ihn: Streaming lief nur in
 * Welten, in denen jemand ihn von Hand umgelegt hatte. Das war die Betaform.
 * Jetzt haengt die Auslieferung an der Modulfassung. Wer dieses Modul faehrt,
 * streamt, und der Schalter bleibt nur deshalb bestehen, weil ein Betreiber
 * eine einzelne Welt zurueckstellen koennen muss, ohne das Modul zu tauschen.
 *
 * Der Schalter allein liefert nichts aus. `streamEnabled()` verlangt zusaetzlich
 * einen Schluessel, und den holt der Weltstart selbst.
 */

export const MODULE_ID = "beneos-module"

export const SETTING = {
  mode: "beneos-stream-mode",
  key: "beneos-stream-key",
  base: "beneos-stream-base",
  localCache: "beneos-stream-local-cache",
  // Ob diese Welt die einmalige Erklaerung der Auslieferung schon gesehen hat.
  // Bewusst ein NEUER Schluessel: der alte hiess -backup-acknowledged und war
  // die Zustimmung zu einer Beta. Wer die gegeben hat, hat damit nichts ueber
  // das neue Modell erfahren und bekommt die Erklaerung einmal zu sehen.
  introSeen: "beneos-stream-intro-seen",
  // Kennzeichnet eine Welt als Pruefstand des Hauses. Siehe die Anmeldung
  // weiter unten und `stream-report.mjs`.
  bench: "beneos-stream-bench",
  pinStills: "beneos-stream-pin-stills",
  installMode: "beneos-stream-install-mode",
  budgetImage: "beneos-stream-budget-image",
  budgetCreature: "beneos-stream-budget-creature",
  budgetVideo: "beneos-stream-budget-video",
  budgetAudio: "beneos-stream-budget-audio",
  budgetDraw: "beneos-stream-budget-draw",
  maxConcurrent: "beneos-stream-max-concurrent",
  // Das Verzeichnis der offline zugesagten Karten, und der Zeitpunkt der
  // letzten gueltigen Berechtigung. Siehe stream-offline.mjs.
  offlineHeld: "beneos-stream-offline-held",
  offlineSeen: "beneos-stream-offline-last-seen",
  // Wie viele Verfallswarnungen diese Frist schon ausgesprochen hat. Siehe
  // stream-offline.mjs, `verfallsstand`.
  offlineWarnungen: "beneos-stream-offline-warnungen",
  // Der Gemeinschaftsvorrat: die geteilten Dateien, die mehrere Karten
  // brauchen. Sie liegen einmal und zaehlen einmal. Siehe stream-offline.mjs.
  offlineGeteilt: "beneos-stream-offline-shared",
}

const DEFAULT_BASE = "https://gate.beneos.stream"

/** Dieselbe Vorgabe fuer den Pruefsatz. Siehe `stream-basis.test.mjs`. */
export const GATE_DEFAULT_BASE = DEFAULT_BASE

/**
 * Die Zone, in der ein Tor liegen darf.
 *
 * DIE BASIS KOMMT VOM SERVER, UND DESHALB BRAUCHT SIE EINE ERLAUBNISLISTE.
 * `ensureStreamKey` uebernimmt das Feld `base` aus der Antwort, und `assetUrl`
 * baut jede Toradresse darauf. Ohne diese Pruefung biegt eine einzige
 * geaenderte Zeichenkette in der Antwort alle Karten- und Kreaturenadressen
 * auf einen fremden Ursprung um, ohne dass sich eine Codezeile aendert, und
 * der Streamschluessel geht in der Adresse mit. Die Dokumente behalten den
 * Wert dauerhaft, ein Rueckbau der Modulfassung heilt das also nicht.
 *
 * Geprueft wird die ZONE und nicht ein einzelner Name: ein zweites Tor des
 * Hauses soll ohne Modulfassung erreichbar bleiben. Alles ausserhalb der Zone
 * wird abgelehnt, ebenso alles ohne Verschluesselung.
 *
 * Siehe `OP-PRJ-176`.
 */
const GATE_ZONE = "beneos.stream"

/**
 * Gibt die Basis zurueck, wenn sie erlaubt ist, sonst eine leere Zeichenkette.
 *
 * Die leere Zeichenkette ist das Signal fuer "abgelehnt". Sie ist bewusst kein
 * Wurf: der Aufrufer entscheidet, ob er die Vorgabe nimmt oder gar nichts tut.
 */
export function erlaubteBasis(wert) {
  const sauber = String(wert == null ? "" : wert).trim().replace(/\/+$/, "")
  if (!sauber) return ""
  let adresse
  try { adresse = new URL(sauber) } catch (_) { return "" }
  if (adresse.protocol !== "https:") return ""
  if (adresse.username || adresse.password) return ""
  const host = adresse.hostname.toLowerCase()
  if (host !== GATE_ZONE && !host.endsWith("." + GATE_ZONE)) return ""
  return sauber
}

/** What an installation does with the files the manifest lists. */
export const INSTALL_MODE = { stream: "stream", download: "download" }

// Seconds, not milliseconds: these are numbers an operator reads and changes at
// a table, and a value in milliseconds invites a factor-of-a-thousand mistake.
// GEMESSEN, NICHT GERATEN, und darum stehen hier zwei Bildwerte statt einem.
//
// Bis zum 05.11.2026 lief ein Kreaturenbild durch `image` und damit durch ein
// Budget, das fuer das Standbild einer Karte gesetzt war. Das sind zwei
// verschiedene Dinge: ein Standbild ist 4K und mehrere Megabyte, ein
// Kreaturenbild liegt zwischen 60 und 450 Kilobyte.
//
// Gemessen am 05.11.2026 in der Testinstanz, 40 Abrufe ueber das Tor auf
// 20 Dateien, kalter und warmer Rand getrennt: der Mittelwert liegt kalt bei
// 361 ms und warm bei 65 ms, das neunte Zehntel kalt bei 693 ms, der
// schlechteste Einzelabruf bei 4229 ms. Zwoelf Kreaturen gleichzeitig durch
// PIXI waren nach 1141 ms vollstaendig, warm nach 412 ms.
//
// DIE AUSREISSER SIND LASTWERTE, und das ist der Teil, der die Zahl traegt.
// Derselbe Messaufbau mit 150 ms Pause zwischen den Abrufen blieb bei 16 von
// 16 unter 551 ms. Ohne Pause riss die Leitung einmal ganz,
// `ERR_QUIC_PROTOCOL_ERROR` auf ein Standbild. Ein Budget darf also nicht am
// Mittelwert haengen: Druck auf der Leitung ist der Normalfall eines Kunden
// mit schmaler Anbindung, nicht ein Messfehler.
//
// `creature` steht deshalb auf 10 Sekunden: das 2,4-fache des schlechtesten
// Abrufs unter Last und das 28-fache des Mittelwerts ohne Last. Gleichzeitig
// ist es ein Drittel der Zeit, die ein Kunde heute auf ein leeres Feld starrt,
// bevor ueberhaupt etwas geschieht.
//
// `image` bleibt bei 30, und das ist kein Versehen. Derselbe Wert traegt die
// Standbilder der Karten, und die sind 0,5 bis 2,5 MB statt 0,06 bis 0,45.
// Unter demselben Lastdruck brauchte eines davon 8027 ms. Ein gemeinsamer
// engerer Wert haette es abgeschnitten, und ein Standbild ist das Bild, das
// den Ausfall eines Videos auffangen soll.
const DEFAULT_BUDGET = { image: 30, creature: 10, video: 120, audio: 60, draw: 45 }

// Foundry never sets one, so every asset of a scene starts at once. On a wide
// line that is right; on a narrow one it makes each single file slower and
// bursts the budget on a line that would have sufficed.
const DEFAULT_MAX_CONCURRENT = 6

// Exportiert, seit `stream-offline` einen Platz ohne Video erkennen muss.
// Eine dritte Fassung derselben Endungsliste haette frueher oder spaeter eine
// andere Antwort auf dieselbe Datei gegeben.
export const VIDEO_EXT = /\.(webm|mp4|ogv|m4v)(\?|$)/i
const AUDIO_EXT = /\.(ogg|mp3|wav|flac|opus|m4a)(\?|$)/i

export function registerStreamSettings() {
  const world = { scope: "world", config: false, restricted: true }

  game.settings.register(MODULE_ID, SETTING.mode, {
    name: "Beneos Stream mode",
    hint: "Installs scenes without their heavy media and fetches it at play time.",
    ...world, type: Boolean, default: true,
  })

  game.settings.register(MODULE_ID, SETTING.key, {
    name: "Beneos Stream key",
    hint: "The delivery key of this world. Without it nothing is delivered.",
    ...world, type: String, default: "",
  })

  game.settings.register(MODULE_ID, SETTING.base, {
    name: "Beneos Stream gate",
    hint: "Address of the delivery gate.",
    ...world, type: String, default: DEFAULT_BASE,
  })

  game.settings.register(MODULE_ID, SETTING.localCache, {
    name: "Keep streamed media in the browser store",
    hint: "Speeds up a second visit and survives a short loss of connection.",
    ...world, type: Boolean, default: true,
  })

  // Merkt sich, dass die einmalige Erklaerung der Auslieferung gezeigt wurde.
  // Sie entscheidet nichts, sie informiert, siehe stream-intro.mjs.
  game.settings.register(MODULE_ID, SETTING.introSeen, {
    name: "Delivery explained",
    ...world, type: Boolean, default: false,
  })

  // DER PRUEFSTAND MUSS SICH SELBST BENENNEN.
  //
  // GEMESSEN am 02.09.2026: alle 35 Meldungen unter /reports aus 72 Stunden
  // stammten aus den eigenen Pruefstaenden. Ohne ein Merkmal ersaeuft das
  // erste echte Kundensignal im eigenen Rauschen, und niemand kann es
  // nachtraeglich trennen: Weltname und Foundry-Fassung reichen nicht, weil
  // eine Kundenwelt genauso heissen darf.
  //
  // Bewusst eine ausdrueckliche Einstellung und keine Erkennung. Jede
  // Erkennung, die aus Adresse, Weltnamen oder Hostname raet, faellt beim
  // ersten Kunden falsch aus, der zufaellig dasselbe Muster trifft. Wer einen
  // Pruefstand betreibt, weiss es und traegt es ein; die Vorgabe ist `false`,
  // eine Kundenwelt aendert sich also nicht.
  game.settings.register(MODULE_ID, SETTING.bench, {
    name: "This world is a Beneos test bench",
    hint: "Marks reports from this world so they can be kept out of the customer figures.",
    ...world, type: Boolean, default: false,
  })

  // Welche Karten der Kunde offline zugesagt hat. Das ist NICHT dasselbe wie
  // "was liegt im Speicher": genau die Differenz zwischen beidem ist der
  // Schaden, den die Pruefung beim Weltstart meldet. Siehe stream-offline.mjs.
  game.settings.register(MODULE_ID, SETTING.offlineHeld, {
    name: "Offline held maps",
    ...world, type: Object, default: {},
  })

  // Wann das Modul zuletzt eine GUELTIGE Berechtigung gesehen hat. Nicht "wann
  // war es zuletzt online": wer Verbindung hat, aber abgewiesen wird, fuer den
  // laeuft die Uhr weiter. Daran haengt der Verfall nach vierzehn Tagen.
  game.settings.register(MODULE_ID, SETTING.offlineSeen, {
    ...world, type: Number, default: 0,
  })

  // WARUM DIE WARNUNGEN GEZAEHLT WERDEN MUESSEN.
  //
  // Die Warnung haengt an Weltstarts, der Verfall an Tagen. Ohne Zaehler sieht
  // ein Spielleiter, der taeglich startet, jede Warnung erneut, und die
  // Vorgabe des Betreibers lautete zwei. Der Zaehler faellt auf null zurueck,
  // sobald eine gueltige Berechtigung gesehen wurde: dann beginnt eine neue
  // Frist, und sie verdient ihre eigenen Warnungen.
  game.settings.register(MODULE_ID, SETTING.offlineWarnungen, {
    ...world, type: Number, default: 0,
  })

  // DER GEMEINSCHAFTSVORRAT, UND WARUM ER EIN EIGENES VERZEICHNIS BRAUCHT.
  //
  // Eine Szene besteht nicht nur aus ihrer Karte. Sie zieht ausserdem geteilte
  // Dateien aus `map_assets/`, also Symbole wie den Kompass und die Leiste am
  // unteren Rand. Der Kartenvorrat holt sie nicht, denn eine Karte ist im
  // Manifest ein Ort mit seinen Videos und Standbildern.
  //
  // Gemessen am 31.08.2026 in der V14-Pruefwelt: 170 von 219 gestreamten
  // Szenen tragen solche Dateien, 117 verschiedene insgesamt, zusammen 13,85
  // MB. Die Szenenwache fragt nach ALLEN Dateien einer Szene, also lehnte sie
  // 78 Prozent der Karten auch dann ab, wenn ihre Videos vollstaendig im
  // Speicher lagen. Das Offline-Versprechen war fuer die meisten Karten
  // wirkungslos.
  //
  // Sie gehoeren nicht in den Kartenvorrat, weil sie sonst je Karte erneut
  // zaehlten: dieselben paar Symbole bei zwanzig Karten waeren das Zwanzigfache
  // derselben Bytes. Betreiberentscheidung vom 31.08.2026: einmal holen, einmal
  // zaehlen.
  //
  // Form: { "<adresse>": { bytes, karten: ["<release>|<variant>|<karte>"] } }
  // Die Kartenliste ist die Verweiszaehlung. Faellt die letzte Karte weg, wird
  // die Datei freigegeben.
  game.settings.register(MODULE_ID, SETTING.offlineGeteilt, {
    name: "Offline shared assets",
    ...world, type: Object, default: {},
  })

  // Installs the pictures a scene needs in order to draw at all, which the
  // manifest marks per file with `pin`: the scene background, the tile images
  // and the still of every video in those places.
  //
  // AN SEIT DEM 29.10.2026, Betreiberentscheid. Bis dahin aus, und der Grund
  // dafuer war das Messen: die reine Form sollte gemessen werden, bevor ein
  // Kompromiss gemacht wird, und der Schalter machte den Vergleich zu einem
  // Neuladen statt zu einer neuen Veroeffentlichung. Das Messen ist vorbei.
  //
  // UMGESTELLT WURDE ER WEGEN EINES WIDERSPRUCHS, nicht wegen eines Wunsches.
  // Die Erklaerung beim ersten Weltstart sagt woertlich "Every scene carries a
  // still picture, so a lost connection costs motion and nothing else"
  // (BENEOS.Stream.Intro.Cost). Mit dem Schalter auf aus war das Standbild
  // selbst eine Toradresse, der Satz also nur wahr, solange der
  // Zwischenspeicher sie noch hielt. Eine Szene, die noch nie offen war,
  // zeichnete ohne Verbindung GAR NICHTS, und der Manifestbauer sagt das auch
  // so: "Die Szene zeichnet nichts, bis das Video ankommt"
  // (tools/generate-stream-manifest.php, sm_pins).
  //
  // WAS ES KOSTET, am Ursprung gemessen am 29.10.2026 und nicht geschaetzt:
  //
  //   bm_0119, 4K, 29 Szenen     21,6 MB Standbilder gegen 811,8 MB Video
  //   dieselbe Variante in HD    21,5 MB, praktisch gleich
  //   Stichprobe 12 Releases    110,1 MB gegen 6.192,7 MB, also 1,78 Prozent
  //   Spanne je Release          0,8 MB bei 3 Szenen bis 21,6 MB bei 29
  //
  // WIRKT ERST BEI DER NAECHSTEN INSTALLATION. buildStreamPack() liest den
  // Schalter, waehrend es die Dateiliste baut; ein bereits installiertes
  // Release wird davon nicht beruehrt. Wer seine alten Releases auch lokal
  // haben will, installiert sie neu oder haelt sie offline.
  game.settings.register(MODULE_ID, SETTING.pinStills, {
    name: "Install the pictures a scene needs to draw",
    hint: "On keeps scene backgrounds and video stills on your disk, so a scene still "
        + "draws without a connection. Costs about two percent of a release. "
        + "Off streams those too. Applies to the next install, not to what is already there.",
    ...world, type: Boolean, default: true,
  })

  // Not a streaming setting at all, and that is the point.
  //
  // In `download` the same bucket serves an ordinary installation: every file is
  // fetched and written into the world exactly as the cloud route does it, and
  // nothing stays an address. That turns the beta into a measuring instrument
  // for a question that has been open since June, namely whether the object
  // store delivers a release faster than the origin does. Both routes then differ
  // in one thing only, where the bytes come from, which is what makes the
  // comparison worth anything.
  //
  // It also matters for a customer report from Australia: 45 minutes for an
  // install that used to take fifteen. The origin sits in Gravelines with two
  // hours of edge lifetime, the gate holds thirty days and fills one edge entry
  // for all customers at once.
  game.settings.register(MODULE_ID, SETTING.installMode, {
    name: "Beneos Stream, what an install does",
    hint: "stream keeps media remote. download fetches everything, like an ordinary install.",
    ...world, type: String, default: INSTALL_MODE.stream,
    choices: { [INSTALL_MODE.stream]: "Stream", [INSTALL_MODE.download]: "Download" },
  })

  for (const [what, seconds] of Object.entries(DEFAULT_BUDGET)) {
    game.settings.register(MODULE_ID, SETTING[`budget${what[0].toUpperCase()}${what.slice(1)}`], {
      name: `Beneos Stream budget, ${what} (seconds)`,
      hint: "0 switches the deadline off, which is what Foundry does by itself.",
      ...world, type: Number, default: seconds,
    })
  }

  game.settings.register(MODULE_ID, SETTING.maxConcurrent, {
    name: "Beneos Stream, parallel requests per scene",
    hint: "0 leaves it to Foundry, which starts every asset of a scene at once.",
    ...world, type: Number, default: DEFAULT_MAX_CONCURRENT,
  })
}

const read = (key, fallback) => {
  try { return game.settings.get(MODULE_ID, key) } catch (_) { return fallback }
}

/** Is streaming switched on AND usable? A mode without a key delivers nothing. */
export function streamEnabled() {
  return Boolean(read(SETTING.mode, false)) && Boolean(read(SETTING.key, ""))
}

/** Ist diese Welt als Pruefstand des Hauses gekennzeichnet? */
export function istPruefstand() {
  return Boolean(read(SETTING.bench, false))
}

/**
 * Nur der Schalter, ohne die Frage nach dem Schluessel.
 *
 * Gebraucht an genau einer Stelle: dort, wo der Schluessel geholt wird. An
 * `streamEnabled()` gehaengt liefe das ins Leere, denn diese Pruefung verlangt
 * bereits einen Schluessel, und eine Welt ohne kaeme nie dazu, sich einen zu
 * besorgen.
 */
export function streamMode() {
  return Boolean(read(SETTING.mode, false))
}

export function streamKey() {
  return String(read(SETTING.key, "") || "").trim()
}

let basisGemeldet = false

/**
 * DIE PRUEFUNG LIEGT AM LESEN UND NICHT NUR AM SCHREIBEN. Eine Welt, deren
 * Einstellung schon einen fremden Ursprung traegt, heilt damit beim naechsten
 * Lesen und braucht keinen Nachzug. Gemeldet wird einmal je Sitzung, sonst
 * schreibt die Leinwand die Konsole voll.
 */
export function streamBase() {
  const roh = String(read(SETTING.base, DEFAULT_BASE) || DEFAULT_BASE).replace(/\/+$/, "")
  const sauber = erlaubteBasis(roh)
  if (sauber) return sauber
  if (!basisGemeldet) {
    basisGemeldet = true
    console.warn(`Beneos Stream | Basis dieser Welt liegt nicht in der erlaubten Zone und wird nicht benutzt: ${roh.slice(0, 120)}`)
  }
  return DEFAULT_BASE
}

/* ------------------------------------------------- den Schluessel besorgen */

/**
 * Die Kennung dieser Welt: SHA-256 ueber `game.world.id`, 64 Zeichen Hex.
 *
 * Bewusst dieselbe Bildung wie in der Telemetrie (`beneos_analytics.js`), aber
 * hier noch einmal in vier Zeilen statt ueber deren Klasse. Grund: die
 * Telemetrie schaltet sich ab, sobald das Streaming laeuft
 * (`beneos_analytics.js:177`, die Zeile `if (globalThis.BeneosStream?.enabled())
 * return false` in `isEnabled()`; bis zum 07.11.2026 stand hier `:111`, und das
 * ist eine Fahne des Tour-Einbaus ohne Bezug zum Streaming).
 * Wer sich auf sie stuetzte, haette eine
 * Abhaengigkeit auf etwas, das in genau diesem Fall nicht arbeitet.
 */
async function weltKennung() {
  try {
    const roh = new TextEncoder().encode(String(game.world?.id || ""))
    const buf = await crypto.subtle.digest("SHA-256", roh)
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
  } catch (_) {
    return ""
  }
}

/**
 * Nach einem Schluesselwechsel jede Adresse dieser Welt mitziehen.
 *
 * WARUM DAS NICHT WARTEN DARF
 *
 * Der Schluessel steht im Pfad jeder gestreamten Adresse, und die Adressen
 * stehen in den Szenendokumenten auf der Platte. Wird er getauscht und bleiben
 * die Dokumente stehen, antwortet das Tor auf jede alte Adresse mit dem
 * durchsichtigen Bildpunkt: die Karten bleiben schwarz, die Vorschaubilder
 * fehlen, und NICHTS sagt warum. Genau dieser Zustand ist am 2026-09-06 beim
 * Fahren von TC-PRJ-STR-051 entstanden.
 *
 * Der Wechsel selbst wird ab jetzt vom Server allein ausgeloest, wenn eine
 * zurueckgenommene Zeile neu belegt wird (Aufgabe 193). Der Nutzer erfaehrt
 * davon sonst nichts, also muss der Nachzug im selben Atemzug laufen.
 *
 * ER KOSTET NICHTS AUSSER ZEIT. Zusagenliste, Zwischenspeicher und der Index
 * der geteilten Dateien fuehren seit Aufgabe 164 die Kennung statt der Adresse;
 * ein Wechsel kostet also keinen Offline-Vorrat. Gemessen an einer echten Welt:
 * 487 Dokumente in 12,6 Sekunden.
 *
 * Der Einbau ist bewusst nachsichtig: schlaegt der Nachzug fehl, wird das
 * gesagt und der Weltstart laeuft weiter. Ein halb umgeschriebener Bestand ist
 * schlechter als ein ganz alter, aber ein abgebrochener Weltstart ist am
 * schlechtesten.
 *
 * ER LAEUFT NIE ZWEIMAL NEBENEINANDER, und der Riegel ist nicht theoretisch.
 * Am 2026-09-06 auf 14.367 gemessen: der Lauf des Weltstarts arbeitete noch
 * (6.735 Felder, mehrere Sekunden), als ein zweiter dazukam. Beide schrieben,
 * beide meldeten eine eigene Zahl, und der Nutzer sah zwei Erfolgsmeldungen
 * mit verschiedenen Werten fuer ein und dasselbe Ereignis. Im Betrieb reichen
 * dafuer zwei gleichzeitig angemeldete Spielleitungen; die Bedingung
 * `isGM` schliesst nur Spieler aus, nicht die zweite Leitung.
 */
let _nachzugLaeuft = null

async function adressenNachziehen() {
  if (_nachzugLaeuft) return _nachzugLaeuft
  _nachzugLaeuft = _adressenNachziehen().finally(() => { _nachzugLaeuft = null })
  return _nachzugLaeuft
}

async function _adressenNachziehen() {
  try {
    const { schluesselNachziehen } = await import("../beneos-asset-path-repair.js")
    ui.notifications?.info(game.i18n.localize("BENEOS.Stream.KeyRotated.Running"))
    const bericht = await schluesselNachziehen({})
    if (bericht?.grund === "nichts nachzuziehen") {
      console.log("Beneos Stream | Schluessel gewechselt, es stand keine alte Adresse in der Welt")
      return
    }
    ui.notifications?.info(game.i18n.format("BENEOS.Stream.KeyRotated.Done", {
      count: Number(bericht?.geaendert || 0),
    }))
  } catch (e) {
    console.error("Beneos Stream | Adressen nach dem Schluesselwechsel nicht nachgezogen:", e)
    ui.notifications?.error(game.i18n.localize("BENEOS.Stream.KeyRotated.Failed"))
  }
}

/**
 * Holt den Streaming-Schluessel dieser Welt bei der Cloud und legt ihn ab.
 *
 * DAS MODUL WECHSELT IHN NIE VON SICH AUS
 *
 * Steht schon einer da, wird er als `vorhanden` mitgeschickt und behalten. Der
 * Schluessel steckt im Pfad jeder gestreamten Adresse und damit in jedem
 * Szenendokument auf der Platte; ein neuer machte jede installierte Szene
 * unsichtbar. Das Mitschicken dient nur dazu, dass die Cloud den bis dahin
 * handgetippten Schluessel in ihre Verwaltung uebernehmen kann.
 *
 * DIE CLOUD DARF IHN WECHSELN, und seit Aufgabe 193 tut sie das auch: war der
 * bisherige Wert zurueckgenommen, bekommt die Welt einen frischen, denn ein
 * zurueckgenommener Wert wird nie wieder ausgegeben. Kommt also ein anderer
 * Wert zurueck als der mitgeschickte, werden die Adressen dieser Welt im selben
 * Lauf nachgezogen (`adressenNachziehen`). Ohne diesen Nachzug waere der
 * Wechsel genau das, wogegen der Absatz darueber schuetzen soll.
 *
 * WARUM NICHT HINTER streamEnabled()
 *
 * Diese Pruefung verlangt einen nicht leeren Schluessel. Eine Welt ohne
 * Schluessel kaeme also nie dazu, sich einen zu holen. Aufgerufen wird deshalb
 * am Modus allein.
 *
 * Die Anmeldung laeuft wie ueberall gegen `api-scenepacker.php`: `s=` traegt
 * die `beneos-cloud-foundry-id`, und `credentials` bleibt aus, weil der Rand
 * `Access-Control-Allow-Origin: *` schickt und der Browser das mit
 * Anmeldedaten ablehnt.
 *
 * @returns {Promise<string>} der gueltige Schluessel, oder "" wenn es nicht ging
 */
export async function ensureStreamKey() {
  const vorhanden = streamKey()

  const welt = await weltKennung()
  if (!welt) {
    console.warn("Beneos Stream | Weltkennung nicht bildbar, Schluessel wird nicht geholt")
    return vorhanden
  }

  let sid = ""
  try { sid = String(game.settings.get(MODULE_ID, "beneos-cloud-foundry-id") || "") } catch (_) { sid = "" }
  if (!sid) {
    // Ohne Anmeldung gibt es keinen Schluessel. Das ist kein Fehler, sondern
    // der Zustand vor dem ersten Cloud-Login.
    console.log("Beneos Stream | noch keine Cloud-Anmeldung, Schluessel wird spaeter geholt")
    return vorhanden
  }

  // DER GRIFF MUSS `game.beneos` MITNEHMEN, sonst zeigt diese Adresse immer
  // auf die Produktionswolke. `globalThis.BeneosUtility` wird im ganzen Modul
  // NIE gesetzt; das Einzige, was es gibt, ist `game.beneos.BeneosUtility`
  // aus dem `init`-Haken in `beneos_module.js`. Der Oder-Zweig fing das still
  // auf, und damit war die versteckte Welt-Einstellung
  // `beneos-cloud-base-url` fuer den Schluesselabruf ohne Wirkung, also genau
  // der Zweck, fuer den sie da ist.
  //
  // Am 06.11.2026 am Teststand 30003 gemessen, mit der Einstellung auf
  // `https://dev.beneos.invalid`:
  //
  //   cloudBase() ueber game.beneos        https://dev.beneos.invalid
  //   was dieser Code vorher nahm          https://beneos.cloud
  //   was er jetzt nimmt                   https://dev.beneos.invalid
  //
  // Dieselbe Kette steht in `cloud-v2/services/whats-new-api.mjs`, dort war
  // sie von Anfang an vollstaendig.
  const basis = (globalThis.BeneosUtility?.cloudBase?.()
    ?? game.beneos?.BeneosUtility?.cloudBase?.()
    ?? "https://beneos.cloud").replace(/\/+$/, "")
  const body = new URLSearchParams({
    s: sid,
    a: "get_stream_key",
    world_hash: welt,
    label: String(game.world?.title || "").slice(0, 96),
  })
  if (vorhanden) body.set("vorhanden", vorhanden)

  try {
    const antwort = await fetch(`${basis}/api-scenepacker.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      credentials: "omit",
    })
    const daten = await antwort.json()
    if (daten?.status !== "ok" || !daten?.stream_key) {
      console.warn("Beneos Stream | Schluessel nicht erhalten:", daten?.message || antwort.status)
      return vorhanden
    }

    // DIE BASIS ZUERST, DANN DER SCHLUESSEL. Beide bilden zusammen die Wurzel
    // jeder Toradresse. Der Nachzug unten baut sein Ziel aus dem, was in den
    // Einstellungen steht; stuende die Basis noch auf dem alten Wert, schriebe
    // er die halbe Welt auf eine Wurzel, die es nicht mehr gibt.
    if (daten.base) {
      const sauber = erlaubteBasis(daten.base)
      if (!sauber) {
        console.warn(`Beneos Stream | Basis des Servers abgelehnt, sie liegt nicht in der erlaubten Zone: ${String(daten.base).slice(0, 120)}`)
      } else if (sauber !== streamBase()) {
        await game.settings.set(MODULE_ID, SETTING.base, sauber)
      }
    }

    // DER AUSLIEFERUNGSWEG KOMMT VOM SERVER, NICHT AUS DER WELT.
    //
    // Streaming ist der Normalfall. Es gibt aber Aufbauten, die es bauartbedingt
    // nicht bedienen kann: gemeldet am 2026-09-16 zwei Rechner an einem Switch,
    // ganz ohne Internet. Dort ist die Leitung nicht langsam, dort gibt es
    // keine. Ein solches Konto wird beim Betreiber auf `download` gestellt und
    // installiert seine Karten danach wieder vollstaendig auf die Platte.
    //
    // DIE VORGABE DES SERVERS GEWINNT, auch gegen eine von Hand gesetzte
    // Einstellung. Sonst wuesste hinterher niemand mehr, welche Welt auf
    // welchem Weg laeuft, und der Betreiber koennte eine Freischaltung nicht
    // zurueckholen. Wer die Einstellung ueber die Konsole umlegt, hat sie bis
    // zum naechsten Weltstart.
    //
    // FEHLT DAS FELD, WIRD NICHTS ANGEFASST. Ein aelterer Server schickt es
    // nicht mit, und eine Welt darf durch eine Aussage, die niemand getroffen
    // hat, nicht den Weg wechseln. Das ist auch die Reihenfolge fuer die
    // Auslieferung: erst der Server, dann das Modul.
    const gewuenscht = String(daten.install_mode || "").trim().toLowerCase()
    if (gewuenscht === INSTALL_MODE.stream || gewuenscht === INSTALL_MODE.download) {
      if (gewuenscht !== installMode()) {
        await game.settings.set(MODULE_ID, SETTING.installMode, gewuenscht)
        // Die Erklaerung wird wieder faellig, und zwar in BEIDE Richtungen.
        // Der Dialog hat je Weg einen eigenen Text, und `introSeen` ist ein
        // einzelnes Haekchen. Ohne diese Zeile bekaeme ein frisch
        // freigeschalteter Kunde weiterhin nur den Streaming-Text zu sehen,
        // also genau den, der fuer ihn in jedem Satz falsch ist.
        await game.settings.set(MODULE_ID, SETTING.introSeen, false)
        console.log(`Beneos Stream | Auslieferungsweg vom Server: ${gewuenscht}, `
          + `die Erklaerung wird einmal erneut gezeigt`)
      }
    } else if (gewuenscht !== "") {
      // Ein Wert, den dieses Modul nicht kennt, wird NICHT uebernommen und auch
      // nicht verschwiegen. Uebernaehme es ihn, stuende in der Welt ein Modus,
      // den kein Zweig des Installers behandelt.
      console.warn(`Beneos Stream | Unbekannter Auslieferungsweg "${gewuenscht}" vom Server, `
        + `es bleibt bei ${installMode()}`)
    }

    if (daten.stream_key !== vorhanden) {
      // Nur schreiben, wenn sich wirklich etwas aendert. Eine Einstellung zu
      // setzen ist in Foundry ein Weltschreibvorgang und wird an alle Spieler
      // verteilt; das bei jedem Weltstart zu tun waere Laerm ohne Anlass.
      await game.settings.set(MODULE_ID, SETTING.key, String(daten.stream_key))
      console.log(`Beneos Stream | Schluessel ${vorhanden ? "ersetzt" : "erhalten"}, Spiegel: ${daten.spiegel || "ueber den Takt"}`)
      if (vorhanden) await adressenNachziehen()
    }
    return String(daten.stream_key)
  } catch (e) {
    // Ein Netzfehler darf den Weltstart nicht aufhalten. Ohne Schluessel
    // bleibt das Streaming schlicht aus, und der naechste Start versucht es
    // wieder.
    console.warn("Beneos Stream | Schluessel konnte nicht geholt werden:", e?.message || e)
    return vorhanden
  }
}

export function localCacheEnabled() {
  return Boolean(read(SETTING.localCache, true))
}

/** Host of the gate, used to decide which requests this module may touch. */
export function streamHost() {
  try { return new URL(streamBase()).host } catch (_) { return "" }
}

/**
 * Liegen die Bilder einer Szene oertlich, oder kommen sie vom Tor?
 *
 * DER RUECKFALLWERT IST DERSELBE WIE DIE VORGABE BEI DER REGISTRIERUNG, und
 * das war er bis zum 06.11.2026 nicht. Dort stand `true`, hier `false`. Der
 * Rueckfall greift nur, wenn `game.settings.get` wirft, also solange der
 * Schalter nicht registriert ist; heute ruft ihn niemand so frueh, der Schaden
 * war also keiner. Zwei Vorgaben fuer einen Schalter sind trotzdem eine Falle,
 * die beim naechsten frueheren Aufruf zuschnappt.
 *
 * `true` ist dabei die vorsichtige Seite: ein Standbild auf der Platte laesst
 * eine Szene ohne Verbindung zeichnen. `false` haette sie gestreamt, und ohne
 * Netz bliebe die Flaeche leer.
 *
 * WARUM `streamEnabled()` daneben anders aussieht: dort steht bei der
 * Registrierung `true` und im Lesesatz `false`, und das bleibt so. Ein nicht
 * lesbarer Schalter heisst dort "nicht streamen", und das ist die Seite, auf
 * der nichts kaputtgeht. Hier ist die vorsichtige Seite die andere.
 */
export function pinStillsEnabled() {
  return Boolean(read(SETTING.pinStills, true))
}

/** `stream` or `download`. Anything unreadable counts as `stream`. */
export function installMode() {
  const value = String(read(SETTING.installMode, INSTALL_MODE.stream) || "").trim()
  return value === INSTALL_MODE.download ? INSTALL_MODE.download : INSTALL_MODE.stream
}

export function downloadMode() {
  return installMode() === INSTALL_MODE.download
}

/**
 * Liefert dieser Lauf TORADRESSEN oder DATEIEN?
 *
 * Die Frage gehoert hierher, neben `installMode()`, weil jeder
 * Installationsweg sie stellt: der Kartenweg in `stream-install.mjs`, der
 * Kreaturen-Installer in `beneos_cloud.js`, und mit `OP-PRJ-140` kommen
 * Gegenstaende und Zauber dazu. Bis zum 2026-11-05 hatte sie drei
 * verschiedene Formen im Bestand, und eine vierte war eingeladen.
 *
 * DREI BEDINGUNGEN MUESSEN ZUSAMMEN STIMMEN, nicht eine. Ohne Schluessel
 * waere die Toradresse unbrauchbar, und ein Dokument mit unbrauchbarer
 * Adresse ist schlimmer als eine heruntergeladene Datei: es ueberlebt den
 * Rueckbau der Modulfassung. Heute verlangt `streamEnabled()` den Schluessel
 * schon selbst, aber darauf darf sich diese Antwort nicht stuetzen.
 *
 * Wirft nie. Sind die Einstellungen noch nicht registriert, faellt der
 * Zweifel zugunsten der Datei auf der Platte aus.
 */
export function lieferungStreamt() {
  try {
    return !downloadMode() && streamEnabled() && !!streamKey()
  } catch (_e) {
    return false
  }
}

const seconds = (key, fallback) => {
  const value = Number(read(key, fallback))
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

/** How long this one file may take, in milliseconds. 0 means no deadline. */
export function budgetFor(url) {
  const path = String(url || "").split("#")[0]
  if (VIDEO_EXT.test(path)) return seconds(SETTING.budgetVideo, DEFAULT_BUDGET.video) * 1000
  if (AUDIO_EXT.test(path)) return seconds(SETTING.budgetAudio, DEFAULT_BUDGET.audio) * 1000
  // Die ROUTE entscheidet, nicht die Dateiendung. Ein Kreaturenbild und das
  // Standbild einer Karte heissen beide `.webp`, und ihre Groessen liegen um
  // den Faktor zehn auseinander. Fuer alles, was keine Toradresse ist, bleibt
  // es beim Bildbudget: eine Datei auf der eigenen Platte hat keinen Rand,
  // der sie verzoegert, und ein fremdes Bild gehoert uns nicht.
  if (zerlegeAdresse(path)?.raum === "kreatur") {
    return seconds(SETTING.budgetCreature, DEFAULT_BUDGET.creature) * 1000
  }
  return seconds(SETTING.budgetImage, DEFAULT_BUDGET.image) * 1000
}

/** How long a whole scene may take to draw before the watchdog steps in. */
export function drawBudget() {
  return seconds(SETTING.budgetDraw, DEFAULT_BUDGET.draw) * 1000
}

export function maxConcurrent() {
  return seconds(SETTING.maxConcurrent, DEFAULT_MAX_CONCURRENT)
}

/**
 * ZWEI ADRESSFORMEN, UND DER PRAEFIX ENTSCHEIDET.
 *
 * Eine Karte liegt unter `/a/<schluessel>/<release>/<variante>/<pfad>`, eine
 * Kreatur unter `/c/<schluessel>/<release>/<pfad>`. Der Unterschied ist nicht
 * Geschmack: eine Karte gibt es in 4K und HD, eine Kreatur nicht. Was es nicht
 * gibt, bekommt auch kein leeres Pfadstueck.
 *
 * Die Zuordnung haengt am Namen des Releases und an nichts sonst. Genauso
 * entscheidet es das Tor, dort heisst dieselbe Pruefung `istKreatur` und
 * bewacht zwei Stellen: den Lesezugriff auf `/a/` und den SCHREIBENDEN
 * Zugriff auf `/offline/`. Zwei Seiten, eine Regel; weicht eine ab, bekommt
 * ein Kunde entweder nichts oder zu viel.
 */
export const KREATUR_PRAEFIX = "beneos_ct_"

/** Gehoert dieses Release in den Kreaturenraum? Nur der Praefix zaehlt. */
export function istKreatur(release) {
  return String(release || "").startsWith(KREATUR_PRAEFIX)
}

/**
 * The address of one asset of one release variant.
 *
 * Fuer eine Kreatur wird `variant` NICHT verwendet. Der Kreaturenraum kennt
 * keine Varianten im Pfad, und ein Aufrufer, der hier eine mitgibt, bekommt
 * sie stillschweigend nicht in die Adresse. Das ist gewollt: die Alternative
 * waere, jede der Aufrufstellen wissen zu lassen, in welchem Raum sie gerade
 * arbeitet, und genau diese Kenntnis soll an einer Stelle liegen.
 */
export function assetUrl(release, variant, path) {
  const clean = String(path).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")
  const kopf = `${streamBase()}`
  const schluessel = encodeURIComponent(streamKey())
  if (istKreatur(release)) {
    return `${kopf}/c/${schluessel}/${encodeURIComponent(release)}/${clean}`
  }
  return `${kopf}/a/${schluessel}/${encodeURIComponent(release)}/${encodeURIComponent(variant)}/${clean}`
}

/**
 * Die Umkehrung von `assetUrl`: aus einer Toradresse die Identitaet lesen.
 *
 * Steht hier und nicht bei einem der Aufrufer, weil sie mit `assetUrl` ein Paar
 * bildet. Aendert sich die Form der Adresse, muessen beide zugleich mitgehen,
 * und zwei Kopien in zwei Dateien gehen erfahrungsgemaess nicht zugleich mit.
 * Bis zum 03.09.2026 lag eine private Kopie in `stream-offline.mjs`.
 *
 * Der Schluessel im Pfad wird ABSICHTLICH nicht zurueckgegeben. Er ist kein
 * Bestandteil der Identitaet einer Datei, sondern die Eintrittskarte des
 * Augenblicks, und wer ihn mitnimmt, baut sich die naechste Bindung an ihn.
 *
 * BEIDE ADRESSFORMEN, UND DER BUCHSTABE WIRD GEPRUEFT UND NICHT WEGGELASSEN.
 *
 * Die naheliegende Erweiterung waere, die Pruefung auf den Buchstaben zu
 * lockern und einfach ab dem dritten Teil zu lesen. Sie ist falsch: dieselbe
 * Exaktheit traegt nachweislich den Fremdschutz, denn sie ist der Grund, dass
 * eine fremde Adresse `null` bekommt und unangetastet bleibt. Eine Form, die
 * fast alles annimmt, nimmt auch das an, was nicht uns gehoert.
 *
 * SIE PRUEFT DIE FORM UND NICHT DEN HOST, und das ist eine Arbeitsteilung und
 * kein Versehen. Den Host prueft `ours()` in der Abrufschicht; diese Funktion
 * bekommt nur Adressen, die das schon hinter sich haben. Geprueft am
 * 05.11.2026: eine fremde Adresse in unserer Form wird zerlegt. Ein Host-Test
 * hier waere trotzdem falsch, denn er wuerde jeden Vorratseintrag
 * unlesbar machen, der unter einer FRUEHEREN Basisadresse angelegt wurde, und
 * genau diese Eintraege soll der Umzug beim Lesen retten.
 *
 * Eine Kreatur bekommt `variant: ""`, und das ist kein Platzhalter fuer einen
 * fehlenden Wert, sondern die Aussage "dieser Raum hat keine Varianten". Der
 * Vorratsschluessel `release|variant|pfad` traegt das ohne Formatwechsel, und
 * ein Zusammenstoss mit einer Karte ist ausgeschlossen, weil der Releasename
 * selbst den Raum nennt.
 *
 * @returns {{raum: string, release: string, variant: string, pfad: string}|null}
 */
export function zerlegeAdresse(url) {
  try {
    const u = new URL(url)
    const teile = u.pathname.replace(/^\/+/, "").split("/")
    // /a/<schluessel>/<release>/<variante>/<pfad...>, also mindestens fuenf.
    if (teile[0] === "a" && teile.length >= 5) {
      return {
        raum: "karte",
        release: decodeURIComponent(teile[2]),
        variant: decodeURIComponent(teile[3]),
        pfad: teile.slice(4).map(decodeURIComponent).join("/"),
      }
    }
    // /c/<schluessel>/<release>/<pfad...>, also mindestens vier.
    if (teile[0] === "c" && teile.length >= 4) {
      return {
        raum: "kreatur",
        release: decodeURIComponent(teile[2]),
        variant: "",
        pfad: teile.slice(3).map(decodeURIComponent).join("/"),
      }
    }
    return null
  } catch (_) { return null }
}
