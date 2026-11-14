/**
 * Das Fenster zur Umstellung einer Bestandswelt aufs Tor, stre-T-064.
 *
 * Verdrahtet den Kern (stream-umstellung.mjs) und die Planung
 * (stream-umstellung-plan.mjs) mit der echten Welt: Register, Kompendium
 * world.beneos_module_actors, Kartenvermerk, Katalog, Einstellungen. Nur fuer
 * die Spielleitung (restricted), und nur in einer Welt, die streamt.
 *
 * Beim Oeffnen zaehlt das Fenster trocken: wie viele Kreaturen und Karten, wie
 * viele Stellen, was lokal bleibt und warum. Geschrieben wird erst auf Start.
 */

import { umstellen, zurueckstellen } from "./stream-umstellung.mjs"
import { buildStreamPack, loadStreamManifest } from "./stream-install.mjs"
import {
  assetUrl, downloadMode, KREATUR_PRAEFIX, lieferungStreamt, MODULE_ID, riegelEntscheid, SETTING,
} from "./stream-settings.mjs"

// Posen, Vermerk und Planung werden erst geladen, wenn das Fenster zaehlt.
// Dieses Modul haengt schon in `init` am Menue, und ein statischer Import von
// beneos-install-state.mjs zoege beneos_utility.js in die Ladekette des
// Streamkerns.
const spaeter = () => Promise.all([
  import("./stream-umstellung-plan.mjs"),
  import("./stream-posen.mjs"),
  import("../cloud-v2/beneos-install-state.mjs"),
])

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications?.api ?? {}

const PAKET = "world.beneos_module_actors"
const REGISTER = "beneos-json-tokenconfig"
const T = (k) => game.i18n.localize(`BENEOS.Stream.Umstellung.${k}`)

/** Wie lange auf die Verteilung der eigenen Riegelmarke gewartet wird, wie beim Nachzug. */
const RIEGEL_WARTE_MS = 1500

function lies(name, vorgabe) {
  try { return game.settings.get(MODULE_ID, name) } catch (_) { return vorgabe }
}

function bu() {
  return globalThis.BeneosUtility ?? game.beneos?.BeneosUtility
}

/**
 * Die Umgebung des Kerns aus der echten Welt.
 *
 * DER RIEGEL SAGT AB, WENN ER NICHT STEHT. Anders als beim Adressnachzug, der
 * ohne Riegel laeuft: dort ist ein Lauf zu viel harmlos, hier schrieben zwei
 * Laeufe dieselben Flaggen und Registerwerte durcheinander. Die Marke wird nach
 * jeder Einheit erneuert, damit ein langer Lauf nicht nach der Frist von
 * `riegelEntscheid` als abgelaufen gilt.
 */
function umgebungAusWelt({ signal = null, trocken = false, nachEinheit = null } = {}) {
  let marke = ""
  const zufall = String(foundry.utils?.randomID?.(8) || Math.random().toString(36).slice(2, 10))
  const neueMarke = () => `${game.userId || "?"}|${Date.now()}|${zufall}`
  let packWarZu = false
  return {
    trocken, signal, abruf: (url, opt) => globalThis.fetch(url, opt),
    fortschritt: {
      lesen: async () => { try { return JSON.parse(lies(SETTING.umstellung, "") || "null") } catch (_) { return null } },
      schreiben: async (s) => game.settings.set(MODULE_ID, SETTING.umstellung, JSON.stringify(s)),
    },
    riegel: {
      nehmen: async () => {
        try {
          if (riegelEntscheid(lies(SETTING.umstellungRiegel, "")) === "besetzt") return false
          marke = neueMarke()
          await game.settings.set(MODULE_ID, SETTING.umstellungRiegel, marke)
          await new Promise((fertig) => setTimeout(fertig, RIEGEL_WARTE_MS))
          return lies(SETTING.umstellungRiegel, "") === marke
        } catch (e) {
          console.warn("Beneos Stream | Umstellung: Riegel nicht setzbar, Lauf abgesagt:", e?.message || e)
          return false
        }
      },
      geben: async () => {
        try {
          if (lies(SETTING.umstellungRiegel, "") === marke) await game.settings.set(MODULE_ID, SETTING.umstellungRiegel, "")
        } catch (e) { console.warn("Beneos Stream | Umstellung: Riegel nicht geloest:", e?.message || e) }
      },
    },
    paket: {
      oeffnen: async () => {
        const p = game.packs.get(PAKET)
        packWarZu = p?.locked === true
        if (packWarZu) await p.configure({ locked: false })
      },
      schliessen: async () => {
        const p = game.packs.get(PAKET)
        if (packWarZu) await p?.configure({ locked: true })
      },
    },
    register: {
      lesen: async () => {
        const roh = bu()?.beneosTokens
        if (roh && typeof roh === "object") return structuredClone(roh)
        try { const t = game.settings.get(MODULE_ID, REGISTER); return t ? JSON.parse(t) : {} } catch (_) { return {} }
      },
      // Erst die Einstellung, dann der Speicher, wie `_registerNachziehen`.
      schreiben: async (r) => {
        await game.settings.set(MODULE_ID, REGISTER, JSON.stringify(r))
        if (bu()) bu().beneosTokens = r
      },
    },
    nachEinheit: (e, erg) => {
      // Die Marke erneuern, solange sie unsere ist.
      if (marke && lies(SETTING.umstellungRiegel, "") === marke) {
        marke = neueMarke()
        game.settings.set(MODULE_ID, SETTING.umstellungRiegel, marke).catch(() => {})
      }
      nachEinheit?.(e, erg)
    },
  }
}

/** Alle Einheiten dieser Welt, mit den Gruenden fuer das, was lokal bleibt. */
async function einheitenAusWelt() {
  const [{ planeKreaturen, planeKarten }, { posenliste, tokenbildImSpiegel }, { BeneosInstallState, paketKennungAus }] = await spaeter()
  const pack = game.packs.get(PAKET)
  const packActors = pack ? await pack.getDocuments() : []
  const register = await umgebungAusWelt().register.lesen()
  const kreaturen = await planeKreaturen({
    register, packActors,
    weltActors: game.actors?.contents ?? [], szenen: game.scenes?.contents ?? [],
    posenliste, tokenbildImSpiegel,
    adresse: (k, f) => assetUrl(`${KREATUR_PRAEFIX}${k}`, "", f),
  })
  let katalog = null
  const karten = await planeKarten({
    vermerke: BeneosInstallState.getAll(),
    paketFuer: async (releaseDir, variant) => {
      try {
        if (!katalog) {
          if (!window.BeneosScenePacker?.listReleases && typeof window.ensureBeneosScenePacker === "function") {
            await window.ensureBeneosScenePacker()
          }
          katalog = await window.BeneosScenePacker?.listReleases?.() ?? []
        }
        return paketKennungAus(katalog, releaseDir, variant)
      } catch (_) { return null }
    },
    ladeManifest: loadStreamManifest,
    baueStreamPack: buildStreamPack,
    findDocs: (r, v) => BeneosInstallState.findDocs(r, v),
    sceneIds: (r) => BeneosInstallState.installedSceneIds(r),
    dokument: (art, id) => (art === "Scene" ? game.scenes.get(id) : game.playlists.get(id)) ?? null,
  })
  return { kreaturen, karten, alle: [...kreaturen.einheiten, ...karten.einheiten] }
}

/** Alle Dokumente, die eine Umstellungsflagge tragen koennen: fuer den Rueckweg. */
async function dokumenteAusWelt() {
  const pack = game.packs.get(PAKET)
  return [
    ...(pack ? await pack.getDocuments() : []),
    ...(game.actors?.contents ?? []),
    ...(game.scenes?.contents ?? []),
    ...(game.playlists?.contents ?? []),
  ]
}

const LEER = { einheiten: [], lokal: { untauglich: 0, nichtAmTor: 0, schonStream: 0, shared: 0, video: 0, manifest: 0, unbekannt: 0 } }

function lokalZeilen(kreaturen, karten, gruende = {}) {
  const z = [
    ["ReasonName", kreaturen.lokal.untauglich],
    ["ReasonMissing", kreaturen.lokal.nichtAmTor + karten.lokal.manifest],
    ["ReasonShared", karten.lokal.shared],
    ["ReasonVideo", karten.lokal.video],
    ["ReasonUnknown", karten.lokal.unbekannt],
    ["ReasonDenied", (gruende.abgewiesen || 0) + (gruende.stummel || 0) + (gruende.falsch || 0)],
  ]
  return z.filter(([, n]) => n > 0).map(([k, n]) => ({ text: T(k), n }))
}

/**
 * Das Aussehen bringt das Fenster selbst mit, wie das Offline-Fenster, mit
 * denselben Hausvariablen (--bc-*) und ohne eigene Farbe.
 */
let stilGesetzt = false
function stilSetzen() {
  if (stilGesetzt) return
  stilGesetzt = true
  const style = document.createElement("style")
  style.textContent = `
    .beneos-umstellung-window .window-content { padding: 12px 14px; }
    .beneos-um { display: flex; flex-direction: column; gap: 10px; }
    .beneos-um p { margin: 0; }
    .beneos-um-zahlen { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; margin: 0; }
    .beneos-um-zahlen dt { color: var(--bc-text-muted); }
    .beneos-um-zahlen dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
    .beneos-um-lokal h3 { margin: 0 0 4px; font-size: 1em; }
    .beneos-um-lokal ul { margin: 0; padding-left: 18px; }
    .beneos-um-lauf { color: var(--bc-text-muted); }
    .beneos-um-knoepfe { display: flex; gap: 8px; justify-content: flex-end;
      border-top: 1px solid var(--bc-border); padding-top: 9px; }
  `
  document.head.appendChild(style)
}

export class BeneosUmstellungWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "beneos-stream-umstellung",
    tag: "section",
    classes: ["beneos-umstellung-window"],
    window: { title: "BENEOS.Stream.Umstellung.Title", icon: "fa-solid fa-cloud-arrow-down", resizable: true },
    position: { width: 480, height: "auto" },
    actions: {
      start: BeneosUmstellungWindow._onStart,
      stop: BeneosUmstellungWindow._onStop,
      revert: BeneosUmstellungWindow._onRevert,
    },
  }

  static PARTS = { body: { template: "modules/beneos-module/templates/stream/umstellung.hbs" } }

  static #instanz = null

  static async open() {
    if (!this.#instanz) this.#instanz = new BeneosUmstellungWindow()
    this.#instanz.stand = null
    return this.#instanz.render(true)
  }

  stand = null
  laeuft = false
  steuerung = null
  fortschritt = { done: 0, total: 0 }
  gruende = {}

  async _onRender(...args) {
    stilSetzen()
    return super._onRender?.(...args)
  }

  async _prepareContext() {
    if (!this.stand) {
      // Ohne streamende Lieferung gibt es keinen Schluessel, und jede
      // geplante Adresse waere ohne ihn gebildet. Dann wird nichts geplant.
      if (!lieferungStreamt()) {
        this.stand = { kreaturen: LEER, karten: LEER, alle: [], stellen: 0 }
      } else {
        const welt = await einheitenAusWelt()
        const zahl = await umstellen(welt.alle, umgebungAusWelt({ trocken: true }))
        this.stand = { ...welt, stellen: zahl.stellen }
      }
    }
    const { kreaturen, karten, stellen } = this.stand
    return {
      kreaturen: kreaturen.einheiten.length,
      karten: karten.einheiten.length,
      stellen,
      lokal: lokalZeilen(kreaturen, karten, this.gruende),
      laeuft: this.laeuft,
      fortschritt: this.laeuft
        ? game.i18n.format("BENEOS.Stream.Umstellung.Progress", { done: this.fortschritt.done, total: this.fortschritt.total })
        : "",
      kannStarten: !this.laeuft && stellen > 0,
    }
  }

  static async _onStart() {
    if (this.laeuft || !lieferungStreamt() || !this.stand?.alle.length) return
    this.laeuft = true
    this.steuerung = new AbortController()
    this.fortschritt = { done: 0, total: this.stand.alle.length }
    this.render()
    try {
      const erg = await umstellen(this.stand.alle, umgebungAusWelt({
        signal: this.steuerung.signal,
        nachEinheit: () => { this.fortschritt.done++; this.render() },
      }))
      this.gruende = erg.gruende || {}
      if (erg.verweigert) ui.notifications.warn(T("Busy"))
      else if (erg.offline) ui.notifications.error(T("Offline"))
      else ui.notifications.info(game.i18n.format("BENEOS.Stream.Umstellung.Done", { count: erg.umgestellt }))
    } catch (e) {
      console.error("Beneos Stream | Umstellung gescheitert:", e)
      ui.notifications.error(T("Offline"))
    } finally {
      this.laeuft = false
      this.stand = null
      this.render()
    }
  }

  static _onStop() {
    this.steuerung?.abort()
  }

  static async _onRevert() {
    if (this.laeuft) return
    this.laeuft = true
    this.render()
    try {
      const erg = await zurueckstellen(await dokumenteAusWelt(), umgebungAusWelt())
      if (erg.verweigert) ui.notifications.warn(T("Busy"))
      else ui.notifications.info(game.i18n.format("BENEOS.Stream.Umstellung.Reverted", { count: erg.zurueck }))
    } finally {
      this.laeuft = false
      this.stand = null
      this.render()
    }
  }
}

/**
 * Der Menueeintrag. Nur in einer Welt, die streamt, wie beim Offline-Fenster
 * mit einem Neuladen Verspaetung: in `init` steht der Schluessel aus
 * `ensureStreamKey` noch nicht fest, also fragt der Eintrag den Betrieb ab
 * (`downloadMode`). Ob die Lieferung wirklich streamt, prueft der Start.
 */
export function registerUmstellungWindow() {
  if (!ApplicationV2) return
  if (downloadMode()) return
  try {
    game.settings.registerMenu(MODULE_ID, "beneos-stream-umstellung-menu", {
      name: "BENEOS.Stream.Umstellung.MenuName",
      label: "BENEOS.Stream.Umstellung.MenuLabel",
      hint: "BENEOS.Stream.Umstellung.MenuHint",
      icon: "fa-solid fa-cloud-arrow-down",
      type: BeneosUmstellungWindow,
      restricted: true,
    })
  } catch (err) {
    console.warn("Beneos Stream | Umstellungsfenster nicht registrierbar", err)
  }
}

/** Fuer die API: oeffnet das Fenster nur, wenn die Lieferung streamt. */
export function umstellungOeffnen() {
  if (!game.user?.isGM || !lieferungStreamt()) return null
  return BeneosUmstellungWindow.open()
}
