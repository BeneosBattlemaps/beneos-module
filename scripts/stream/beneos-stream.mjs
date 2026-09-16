/**
 * Entry point of Beneos Stream.
 *
 * Everything hangs in the `init` hook, and it has to. Settings are readable
 * there, and it is the last hook that is reliably ahead of the first texture.
 *
 * Korrektur vom 22.08.2026: hier stand, die Leinwand zeichne NACH `ready`.
 * Gemessen auf Foundry 14.365 ist die Reihenfolge init, setup, canvasInit,
 * canvasReady, ready, und zwischen den letzten beiden liegen fuenf
 * Millisekunden. Die erste Szene ist fertig, bevor `ready` feuert. Wer den
 * Einbau nach `ready` verschiebt, verliert sie.
 *
 * This is the ONLY streaming file referenced from module.json. With the main
 * switch off, `installStreamFetch` returns immediately, nothing is patched, and
 * the module behaves as if streaming did not exist. That is what lets a single
 * world be put back on the local route without swapping the module.
 */

import { registerStreamSettings, streamEnabled, streamKey, streamBase, streamHost, pinStillsEnabled, installMode, downloadMode, streamMode, ensureStreamKey } from "./stream-settings.mjs"
import { installStreamFetch, storeStatus, clearStore, prewarm, diagnose, resetDiagnosis, abortAll, sichereSpeicher, streamFetchInstalled,
         offlineHalten, offlineFreigeben, offlineGehalten, offlineBestand, alleZusagenLoesen,
         speicherLage, raumSchaffen, speicherAusfallStand, gehalteneAdressen } from "./stream-fetch.mjs"
import { installStreamCanvas, drawStatus, videoTilesOf } from "./stream-canvas.mjs"
import { installStreamOnline, onlineStatus, streamState, isOffline, hasStreamedContent } from "./stream-online.mjs"
import { installStreamIndicator } from "./stream-indicator.mjs"
import { installStreamSceneUi } from "./stream-scene-ui.mjs"
import { registerOfflineWindow, BeneosOfflineWindow } from "./stream-offline-window.mjs"
import { explainOnce } from "./stream-intro.mjs"
import { loadStreamManifest, buildStreamPack, applyStreamAddresses, streamUrlsOf, releaseFromPackage, listReleases } from "./stream-install.mjs"
import { rebuildScenesForStream, stillPathFor } from "./stream-scenes.mjs"
import { reportedSoFar } from "./stream-report.mjs"
import { beimWeltstart, meldeFehlendenVorrat, meldeVerfall, karteZusagen, karteLoesen,
         istZugesagt, alleKarten, vorratsstand, verfallsstand, pruefeVorrat, VERFALL_TAGE,
         karteZuSzene, szenenzustand, zustandAusCache, warmeZustaende, ziehZustandNach,
         schalteKarte, verwaisteLoesen, geteilteLuecken, geteilteWaisen, geteilterStand, indexVergessen,
         vorratHeilen, warnungGezaehlt } from "./stream-offline.mjs"

Hooks.once("init", () => {
  registerStreamSettings()

  // Das Fenster mit dem Offline-Vorrat, erreichbar ueber die
  // Moduleinstellungen. Muss im init stehen, weil registerMenu dort erwartet
  // wird; es kostet nichts, solange niemand es oeffnet.
  registerOfflineWindow()

  // Only patch when the switch is on. A world with streaming turned off must
  // pay nothing for it, not even a wrapped fetch.
  //
  // Am Modus, nicht an streamEnabled(). Gemessen am 22.08.2026 auf The Forge:
  // eine Welt, die ihren Schluessel erst im ready-Hook bekommt, hatte in genau
  // dieser Sitzung keinen fetch-Ersatz, keinen Wachhund, keine Leinwandhilfe
  // und keine Anzeige. Der Speicher blieb bei null Eintraegen, ohne dass etwas
  // darauf hingewiesen haette. Erst der naechste Weltstart haengte alles ein.
  //
  // Nachruesten nach `ready` scheidet aus: dieselbe Messung ergab die
  // Reihenfolge init, setup, canvasInit, canvasReady, ready, mit nur fuenf
  // Millisekunden zwischen den letzten beiden. Die erste Szene ist gezeichnet,
  // bevor `ready` feuert. Der Kommentar oben in dieser Datei behauptete das
  // Gegenteil und ist damit widerlegt.
  //
  // Ohne Schluessel bleiben alle vier untaetig: jede von ihnen prueft in ihren
  // Behandlern weiterhin auf streamEnabled().
  if (streamMode()) {
    installStreamFetch()
    installStreamOnline()
    installStreamCanvas()
    installStreamIndicator()
    // Rechtsklick und Markierung. Haengen sich nur an Hooks und lesen
    // ausschliesslich aus dem vorgewaermten Zustand, kosten also nichts,
    // solange niemand eine Szenenliste zeichnet.
    installStreamSceneUi()

    // Der Index der geteilten Dateien wird zwischengespeichert, weil er sonst
    // im Warmlauf ueber alle Szenen einmal je Szene entstuende. Er haengt
    // ausschliesslich an den Szenendokumenten, also wird er genau dann
    // vergessen, wenn sich eines aendert. Ein veralteter Index wuerde eine
    // Karte zu Unrecht als unvollstaendig melden, und das ist die Sorte
    // Meldung, die hier gerade abgeschafft wird.
    for (const haken of ["createScene", "updateScene", "deleteScene"]) {
      Hooks.on(haken, () => indexVergessen())
    }
  }

  // The installer reaches for this rather than importing the stream modules
  // directly, so the rest of the module keeps no hard import into scripts/stream.
  //
  // `mayRun` ist am 2026-09-03 weggefallen. Es hiess "eingeschaltet UND die
  // Beta-Zustimmung liegt vor". Die Zustimmung gibt es nicht mehr, damit waere
  // es eine zweite Schreibweise fuer `enabled()` gewesen, und zwei Namen fuer
  // dieselbe Frage laden dazu ein, sie unterschiedlich zu beantworten.
  const api = {
    enabled: () => streamEnabled(),
    host: () => streamHost(),
    base: () => streamBase(),
    releaseFromPackage,
    loadStreamManifest,
    buildStreamPack,
    applyStreamAddresses,
    // Seit dem 2026-08-23 rechnet das Modul den Szenenumbau selbst, statt ihn
    // vorgekocht aus dem Paket zu nehmen. `restoreLocalVideos` ist damit weg:
    // es gibt nichts mehr zurueckzubauen, weil im Download-Modus gar nichts
    // umgebaut wird.
    rebuildScenesForStream,
    stillPathFor,
    installMode: () => installMode(),
    downloadMode: () => downloadMode(),
    streamUrlsOf,
    listReleases,
    prewarm,
    storeStatus,
    clearStore,
    // Das Offline-Kontingent. Halten, freigeben, nachsehen, zaehlen, und der
    // Verfall beim Ende der Berechtigung. Die Szenendokumente bleiben dabei
    // unangetastet; gehalten wird im Speicher des Browsers.
    offlineHalten,
    offlineFreigeben,
    offlineGehalten,
    offlineBestand,
    alleZusagenLoesen,
    // Die Hausordnung im Speicher: was liegt wo, und Platz schaffen, ohne eine
    // gehaltene Karte anzufassen.
    speicherLage,
    raumSchaffen,
    // Was der Speicher haelt, und was davon zu keiner Zusage mehr gehoert.
    // `speicherAusfallStand` beantwortet die Frage, die vorher niemand stellen
    // konnte: laeuft das Modul gerade ganz ohne Vorrat, weil der Browser seinen
    // Speicher nicht hergibt.
    speicherAusfallStand,
    gehalteneAdressen,
    verwaisteLoesen,
    // Derselbe Abgleich in der Gegenrichtung: ein Verzeichniseintrag, dessen
    // Datei nicht mehr liegt. Die beiden gehoeren zusammen, denn Verzeichnis
    // und Speicher koennen in BEIDE Richtungen auseinanderlaufen.
    geteilteLuecken,
    // Und der dritte Abgleich: ein Eintrag, auf den keine Zusage mehr zeigt.
    // Er steht im Weltstart vorn, weil er sonst als Deckung mitzaehlt.
    geteilteWaisen,
    geteilterStand,
    vorratHeilen,
    // Das Verzeichnis der zugesagten Karten und die Frist. Der Speicher weiss,
    // welche DATEIEN er haelt; erst das Verzeichnis weiss, welche KARTEN
    // zugesagt sind und wie sie heissen. Die Differenz ist der Schaden.
    karteZusagen,
    karteLoesen,
    istZugesagt,
    alleKarten,
    vorratsstand,
    verfallsstand,
    pruefeVorrat,
    verfallTage: () => VERFALL_TAGE,
    // Von der Szene zur Karte, und der vorgewaermte Zustand, den Kontextmenue
    // und Listenmarkierung synchron lesen muessen.
    karteZuSzene,
    szenenzustand,
    zustandAusCache,
    warmeZustaende,
    ziehZustandNach,
    schalteKarte,
    /** Das Fenster mit dem Offline-Vorrat oeffnen. */
    offlineFenster: () => BeneosOfflineWindow.open(),
    diagnose,
    resetDiagnosis,
    reportedSoFar,
    // Connection and watchdog, the parts the test programme reads
    state: () => streamState(),
    offline: () => isOffline(),
    onlineStatus,
    drawStatus,
    videoTilesOf,
    hasStreamedContent,
    abortAll,
    pinStills: () => pinStillsEnabled(),
  }
  globalThis.BeneosStream = api
  game.beneos = game.beneos || {}
  game.beneos.stream = api
})

Hooks.once("ready", async () => {
  // Am Modus, nicht an streamEnabled(): letzteres verlangt bereits einen
  // Schluessel, und eine frisch eingeschaltete Welt hat noch keinen. Sie kaeme
  // sonst nie dazu, sich einen zu holen.
  if (!streamMode()) return
  if (!game.user?.isGM) return

  // Der Schluessel dieser Welt. Holt ihn beim ersten Mal, uebernimmt einen
  // handgetippten und laesst ihn danach in Ruhe.
  await ensureStreamKey()

  if (!streamEnabled()) {
    console.log("Beneos Stream | Modus an, aber kein Schluessel. Es wird nichts ausgeliefert.")
    return
  }

  // Der Modus laesst sich auch mitten in einer Sitzung umlegen, und dann ist
  // `init` laengst vorbei. Ohne diese Zeile liefe die Welt genau wie vor dem
  // Fix vom 22.08.2026 weiter: Szenen zeichnen, Speicher bleibt leer, nichts
  // sagt etwas. Ein Fehler, der keine Spur hinterlaesst, wird nicht gefunden.
  if (!streamFetchInstalled()) {
    const text = "Beneos Stream | Der Speicher ist NICHT eingehaengt. Der Modus wurde vermutlich "
      + "waehrend dieser Sitzung eingeschaltet. Bitte die Welt neu laden, sonst wird nichts "
      + "zwischengespeichert und jede Szene kommt in jeder Sitzung erneut ueber die Leitung."
    console.warn(text)
    ui.notifications?.warn(text)
  }

  // Einmal je Welt erklaeren, was mit den schweren Dateien passiert. Danach nie
  // wieder, und der Weltstart laeuft unabhaengig vom Ausgang weiter.
  await explainOnce()

  // Direkt nach dem Dialog um die Speicherzusage bitten. Die Reihenfolge ist
  // kein Zufall: eine Nutzerhandlung unmittelbar davor erhoeht die Aussicht,
  // dass Chrome zusagt. Ohne Zusage darf der Browser den Cache bei
  // Plattenknappheit raeumen, und genau daran haengt das Offline-Versprechen.
  //
  // Im Download-Betrieb entfaellt die Bitte. Der Zwischenspeicher ist dort
  // ausgehaengt (`stream-fetch.mjs`, `measuring`), es liegt also nichts darin,
  // was der Browser raeumen koennte. Eine Zusage zu erbitten, die nichts
  // schuetzt, kostet den Kunden einen Browserdialog fuer nichts.
  let zusage = { zugesagt: null }
  if (downloadMode()) {
    console.log("Beneos Stream | Keine Speicherzusage erbeten: Download-Betrieb, "
      + "der Zwischenspeicher ist ausgehaengt")
  } else {
    zusage = await sichereSpeicher()
  }

  const store = await storeStatus()
  console.log(
    `Beneos Stream | active | gate ${streamBase()} | key ${streamKey() ? "set" : "MISSING"} | ` +
    `${streamState()} | install ${installMode()} | pin-stills ${pinStillsEnabled() ? "on" : "off"} | ` +
    `store ${store.entries} entries, ${store.usageMB} MB of ${store.quotaGB} GB, persisted=${store.persisted}`
  )
  // Getrennt protokolliert, weil es eine Aussage ueber die HALTBARKEIT ist und
  // nicht ueber den Fuellstand. Wer beides in eine Zeile schreibt, liest die
  // wichtigere Zahl irgendwann ueber.
  // Alle drei als gewoehnliche Zeile, keine Warnung.
  //
  // Die Ablehnung ist nach eigener Messung der NORMALFALL und nicht die
  // Ausnahme: Chrome entscheidet nach Nutzungsverlauf, und eine frisch
  // eingerichtete Welt hat keinen. Eine gelbe Zeile bei fast jedem Weltstart
  // ist keine Warnung mehr, sondern Rauschen, und ein Foundry-Nutzer, der sein
  // Log durchsieht, haelt sie fuer einen Defekt des Moduls.
  //
  // Der Sachverhalt bleibt vollstaendig protokolliert, nur eben in der Farbe,
  // die ihm zusteht. Wer das Offline-Versprechen pruefen will, liest
  // `storeStatus().persisted`.
  // Bilder im Journaltext, die vor dem 25.08.2026 installiert wurden, zeigen
  // noch auf die Platte statt auf das Gate. Einmal geradeziehen; danach findet
  // der Lauf nichts mehr und kostet einen Durchlauf ueber die Journale.
  try {
    await globalThis.beneosAssetPathRepair?.heileJournalGateAdressen?.()
  } catch (err) {
    console.log(`Beneos Stream | Journalheilung uebersprungen: ${String(err).slice(0, 140)}`)
  }

  // Der Offline-Vorrat: Uhr stellen, Verfall pruefen, Fehlendes melden.
  //
  // `berechtigt` heisst hier ausdruecklich mehr als "wir haben Internet". Es
  // heisst, dass das Tor auf die Sonde geantwortet hat UND ein Schluessel
  // gesetzt ist. Wer online ist, aber abgewiesen wird, hat keine gueltige
  // Berechtigung gesehen, und fuer den soll die Frist weiterlaufen.
  try {
    const bericht = await beimWeltstart({ berechtigt: streamState() === "online" && !!streamKey() })
    // Die Bedingung fragt jetzt den Melder, nicht die Rohliste: er entscheidet
    // zwischen Dialog, kurzer Meldung mit Grund und Schweigen. Gesperrtes muss
    // durch, sonst faellt der Fall "es fehlt etwas, geht aber gerade nicht"
    // still unter den Tisch.
    if (bericht?.stand?.fehlend?.length || bericht?.heilbar?.gesperrt?.length) {
      await meldeFehlendenVorrat(bericht)
    }
    else if (bericht?.verfallen) await meldeVerfall(bericht.verfallen)
    else if (bericht?.frist?.warnen) {
      ui.notifications?.warn(game.i18n.format("BENEOS.Stream.Offline.FristKnapp",
        { days: bericht.frist.tageOffen })
        || `Beneos: your offline maps expire in ${bericht.frist.tageOffen} day(s). `
         + `Open this world while online to renew them.`)
      // Erst sprechen, dann zaehlen. Andersherum verlöre ein Kunde eine seiner
      // zwei Warnungen, wenn das Schreiben der Einstellung scheitert.
      await warnungGezaehlt()
    }
  } catch (err) {
    console.warn("Beneos Stream | Offline-Pruefung uebersprungen", err)
  }

  // Den Zustand je Szene vorwaermen, damit Kontextmenue und Listenmarkierung
  // synchron antworten koennen. Ohne await: die Welt soll nicht auf ein
  // Manifest warten, und bis der Spielleiter das erste Mal rechtsklickt,
  // vergehen Sekunden.
  warmeZustaende().then(r => {
    if (r?.gefunden) console.log(`Beneos Stream | Offline-Zustand fuer ${r.gefunden} von ${r.szenen} Szenen bereit`)
  }).catch(() => { })

  // Nur im Streaming-Betrieb. Im Download-Betrieb wurde oben gar nicht gefragt,
  // und der Grund steht dort schon in einer eigenen Zeile. Ohne diese Klammer
  // fiele der Fall in den letzten Zweig und meldete "dieser Browser kennt die
  // Schnittstelle nicht", also eine Ursache, die es hier nicht gibt.
  if (!downloadMode()) {
    if (zusage.zugesagt === true) {
      console.log("Beneos Stream | Speicher ist dauerhaft, der Browser raeumt ihn nicht von selbst")
    } else if (zusage.zugesagt === false) {
      console.log(
        "Beneos Stream | Keine Speicherzusage des Browsers. Der Offline-Bestand darf bei " +
        "Plattenknappheit verworfen werden; Offline gilt, solange der Browser ihn haelt."
      )
    } else {
      console.log("Beneos Stream | Speicherzusage nicht erfragbar, dieser Browser kennt die Schnittstelle nicht")
    }
  }
})
