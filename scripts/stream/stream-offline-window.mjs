/**
 * Das Fenster, das den Offline-Vorrat zeigt.
 *
 * WARUM EIN EIGENES FENSTER UND KEINE LEISTE IN DER SEITENLEISTE
 *
 * Die Seitenleiste gehoert dem Spielleiter, nicht uns. Foundry-Nutzer
 * reagieren empfindlich auf Module, die sich dort ungefragt festsetzen, und
 * die Flaeche ist ohnehin umkaempft. Der laufende Stand steht deshalb im
 * Tooltip des Punktes, den das Modul ohnehin schon zeichnet; wer es genauer
 * wissen will, oeffnet dieses Fenster.
 *
 * Erreichbar ueber die Moduleinstellungen, also dort, wo ein Foundry-Nutzer
 * nach so etwas sucht.
 */

import { MODULE_ID, streamEnabled } from "./stream-settings.mjs"
import { alleKarten, vorratsstand, verfallsstand, kontingent, VERFALL_TAGE,
         karteLoesen, pruefeVorrat, vorratHeilen, ziehKarteNach } from "./stream-offline.mjs"
import { speicherLage } from "./stream-fetch.mjs"

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications?.api ?? {}

function gb(n) { return (Number(n || 0) / 1073741824).toFixed(2) }
function mb(n) { return Math.round(Number(n || 0) / 1048576) }

/**
 * Das Aussehen bringt das Fenster selbst mit, wie es der Verbindungspunkt
 * schon tut. Das spart einen Eintrag in der `module.json` und damit einen
 * Auslieferungsschritt fuer etwas, das nur dieses eine Fenster betrifft.
 *
 * Der Gruenton ist derselbe wie an der Szenenliste und im Cloud-Fenster fuer
 * installierte Zeilen; er ist die Zustandsfarbe des Hauses und keine neue.
 */
let stilGesetzt = false
function ensureStyle() {
  if (stilGesetzt) return
  stilGesetzt = true
  const style = document.createElement("style")
  style.textContent = `
    .beneos-ov { display: flex; flex-direction: column; gap: 12px; padding: 4px 2px; }
    .beneos-ov section { display: flex; flex-direction: column; gap: 6px; }
    .beneos-ov p { margin: 0; line-height: 1.45; }

    .beneos-ov-zahlen { display: flex; align-items: baseline; gap: 6px; }
    .beneos-ov-gross { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .beneos-ov-klein { opacity: 0.75; }
    .beneos-ov-rechts { margin-left: auto; opacity: 0.75; font-variant-numeric: tabular-nums; }

    .beneos-ov-balken {
      height: 9px; border-radius: 2px; overflow: hidden;
      background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(0, 0, 0, 0.35);
    }
    .beneos-ov-balken > span {
      display: block; height: 100%;
      background: rgba(111, 207, 82, 0.85);
      transition: width .25s ease;
    }

    .beneos-ov-frist { border-left: 3px solid rgba(128, 128, 128, 0.5); padding-left: 9px; }
    .beneos-ov-frist.ist-knapp { border-left-color: #e0a33a; }
    .beneos-ov-frist.ist-abgelaufen { border-left-color: #c9503f; }

    .beneos-ov-fehlend { border-left: 3px solid #c9503f; padding-left: 9px; gap: 8px; }
    .beneos-ov-fehlend button { align-self: flex-start; }

    .beneos-ov-liste { list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 2px; max-height: 320px; overflow-y: auto; }
    .beneos-ov-liste > li {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 6px; border-radius: 3px;
      background: rgba(111, 207, 82, 0.07);
      box-shadow: inset 3px 0 0 0 rgba(111, 207, 82, 0.7);
    }
    .beneos-ov-liste > li.fehlt {
      background: rgba(201, 80, 63, 0.09);
      box-shadow: inset 3px 0 0 0 rgba(201, 80, 63, 0.8);
    }
    .beneos-ov-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .beneos-ov-marke {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
      border: 1px solid #c9503f; color: #c9503f; border-radius: 3px;
      padding: 0 4px; margin-left: 6px; vertical-align: 1px;
    }
    .beneos-ov-groesse { opacity: 0.7; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .beneos-ov-weg { flex: none; width: 26px; height: 26px; line-height: 1; padding: 0; }

    .beneos-ov-leer { opacity: 0.85; }
    .beneos-ov-hinweis { font-size: 0.92em; opacity: 0.8; }
    .beneos-ov-fuss { border-top: 1px solid rgba(128, 128, 128, 0.3); padding-top: 9px;
      font-size: 0.88em; opacity: 0.75; }
  `
  document.head.appendChild(style)
}

export class BeneosOfflineWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "beneos-offline-vorrat",
    tag: "section",
    classes: ["beneos-offline-window"],
    window: { title: "Beneos: Offline Maps", icon: "fa-regular fa-hard-drive", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      releaseMap: BeneosOfflineWindow._onRelease,
      repairMissing: BeneosOfflineWindow._onRepair,
    },
  }

  static PARTS = { body: { template: "modules/beneos-module/templates/stream/offline-vorrat.hbs" } }

  static #instanz = null

  static async open() {
    if (!this.#instanz) this.#instanz = new BeneosOfflineWindow()
    ensureStyle()
    return this.#instanz.render(true)
  }

  async _onRender(...args) {
    ensureStyle()
    return super._onRender?.(...args)
  }

  async _prepareContext() {
    const vorrat = vorratsstand()
    const grenze = kontingent()
    const frist = verfallsstand()
    const stand = await pruefeVorrat()
    const lage = await speicherLage()

    const fehlendeIds = new Set(stand.fehlend.map(e => `${e.release}|${e.variant}|${e.karte}`))
    const karten = alleKarten()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(e => ({
        release: e.release, variant: e.variant, karte: e.karte,
        name: e.name,
        mb: mb(e.bytes),
        fehlt: fehlendeIds.has(`${e.release}|${e.variant}|${e.karte}`),
      }))

    return {
      leer: karten.length === 0,
      karten,
      belegtGB: gb(vorrat.bytes),
      grenzeGB: gb(grenze),
      anteil: Math.min(100, Math.round((vorrat.bytes / Math.max(1, grenze)) * 100)),
      anzahl: vorrat.karten,
      fehlend: stand.fehlend.length,
      fehlendMB: mb(stand.bytesFehlend),
      // Die Frist. `nie` heisst, dass noch keine Berechtigung gesehen wurde,
      // und das ist kein Verfall, sondern ein frischer Anfang.
      fristNie: frist.nie,
      fristTage: frist.tageOffen,
      fristKnapp: frist.warnen,
      fristAbgelaufen: frist.abgelaufen,
      verfallTage: VERFALL_TAGE,
      // Was der Browser dazu sagt. Ohne Zusage darf er bei Plattenknappheit
      // raeumen, und der Kunde soll das wissen statt es zu erfahren.
      zusage: lage.kontingent ? null : undefined,
      browserGB: gb(lage.kontingent),
      browserBelegtGB: gb(lage.belegtGesamt),
    }
  }

  static async _onRelease(event, target) {
    const { release, variant, karte } = target.dataset
    if (!release || !karte) return
    await karteLoesen(release, variant || "", karte)
    await ziehKarteNach({ release, variant: variant || "", karte })
    try { ui.scenes?.render(); ui.nav?.render() } catch (_) { }
    return this.render()
  }

  static async _onRepair() {
    const stand = await pruefeVorrat()
    if (!stand.fehlend.length) return this.render()
    ui.notifications?.info(`Beneos: fetching ${stand.fehlend.length} map(s)...`)
    const summe = await vorratHeilen(stand.fehlend)
    ui.notifications?.info(`Beneos: ${summe.karten} of ${stand.fehlend.length} map(s) restored.`)
    return this.render()
  }
}

/**
 * Im Einstellungsmenue eintragen, damit das Fenster auffindbar ist.
 *
 * `restricted` steht auf wahr: das Kontingent haengt am Konto des
 * Weltbesitzers, ein Spieler kann darin nichts entscheiden.
 */
export function registerOfflineWindow() {
  if (!ApplicationV2) return
  try {
    game.settings.registerMenu(MODULE_ID, "beneos-offline-vorrat", {
      name: "Beneos: Offline Maps",
      label: "Open",
      hint: "Which maps are kept for offline play, how much of your quota they use, "
          + "and how long they stay without a connection.",
      icon: "fa-regular fa-hard-drive",
      type: BeneosOfflineWindow,
      restricted: true,
    })
  } catch (err) {
    console.warn("Beneos Stream | Offline-Fenster nicht registrierbar", err)
  }
}
