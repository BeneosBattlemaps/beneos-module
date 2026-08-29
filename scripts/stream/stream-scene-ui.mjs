/**
 * Offline schalten, und sehen was offline liegt: der Rechtsklick auf eine
 * Szene und die Markierung in der Szenenliste.
 *
 * WARUM EIN EIGENER HOOK NEBEN DEM VORHANDENEN
 *
 * `beneos_module.js` registriert bereits `getSceneContextOptions` fuer die
 * Umschaltung zwischen statischer und animierter Karte. Foundry erlaubt
 * mehrere Registrierungen auf dasselbe Ereignis, und eine eigene haelt alles
 * Streaming-bezogene an einem Ort, statt es in eine 5.000-Zeilen-Datei zu
 * legen, die mit dem Vorhaben nichts zu tun hat.
 *
 * ZWEI EIGENHEITEN VON FOUNDRY, DIE DEN AUFBAU BESTIMMEN
 *
 * Erstens fragt das Kontextmenue seine `condition` synchron, und die
 * Szenenliste wartet beim Zeichnen auf niemanden. Welche Karte zu einer Szene
 * gehoert, braucht dagegen das Manifest, also einen Abruf. Deshalb liest beides
 * hier nur aus dem vorgewaermten Zustand (`zustandAusCache`) und stoesst
 * niemals selbst einen Abruf an.
 *
 * Zweitens zeichnet Foundry die Szenenliste IMMER vollstaendig neu und kennt
 * kein Zeichnen einzelner Eintraege: jede Aenderung an einem Szenendokument
 * rendert die ganze App. Eine ins DOM geschriebene Klasse ist danach weg,
 * also wird sie bei jedem Zeichnen neu gesetzt.
 */

import { streamEnabled } from "./stream-settings.mjs"
import { zustandAusCache, schalteKarte, warmeZustaende } from "./stream-offline.mjs"

const KLASSE = "beneos-offline-held"

/**
 * Die Kennung der Szene am Menueeintrag.
 *
 * Die Navigationsleiste markiert ihr Element mit `data-scene-id`, die
 * Seitenleiste mit `data-entry-id`. ContextMenu laeuft ab Foundry 13 ohne
 * jQuery, und in Version 15 verschwindet es ganz, also wird direkt am Element
 * gelesen. Dasselbe tut `beneosSceneIdFromMenuTarget` in `beneos_module.js`;
 * die Doppelung ist Absicht, damit diese Datei ohne jenen Modulteil laeuft.
 */
function szeneAusMenue(li) {
  const el = (li instanceof HTMLElement) ? li : li?.[0]
  if (!el) return null
  return el.dataset?.sceneId || el.dataset?.entryId
    || el.closest?.("[data-scene-id]")?.dataset?.sceneId
    || el.closest?.("[data-entry-id]")?.dataset?.entryId
    || null
}

function localize(key, fallback) {
  try { const t = game.i18n.localize(key); return (t && t !== key) ? t : fallback }
  catch (_) { return fallback }
}

let stilGesetzt = false

/**
 * Die Markierung, in der Zustandsfarbe des Hauses.
 *
 * Ein Streifen links statt eines Rahmens: die Zeilen der Seitenleiste stehen
 * dicht, und ein umlaufender Rahmen laesst eine markierte Zeile groesser
 * wirken als ihre Nachbarn, was die Liste beim Blaettern unruhig macht. Der
 * Farbton ist derselbe, den das Cloud-Fenster fuer installierte Zeilen
 * benutzt (`beneos-cloud.css`, `.bc-bundle-member.is-installed`).
 */
function ensureStyle() {
  if (stilGesetzt) return
  stilGesetzt = true
  const style = document.createElement("style")
  style.textContent = `
    .${KLASSE} {
      box-shadow: inset 3px 0 0 0 rgba(111, 207, 82, 0.85);
      background: rgba(111, 207, 82, 0.07);
    }
    .${KLASSE} .entry-name::after,
    .${KLASSE} .scene-name::after {
      content: "";
      display: inline-block;
      width: 6px; height: 6px;
      margin-left: 6px;
      vertical-align: 1px;
      border-radius: 50%;
      background: rgba(111, 207, 82, 0.9);
    }
  `
  document.head.appendChild(style)
}

/**
 * Die Markierung an allen Eintraegen setzen, die dieser Aufruf sieht.
 *
 * Bewusst tolerant gegenueber der Form des zweiten Hook-Arguments: Foundry
 * reicht es je nach Fassung und App als Element, als jQuery-Objekt oder gar
 * nicht durch. Fehlt es, wird das ganze Dokument abgesucht, was bei einer
 * Handvoll Listeneintraegen nicht ins Gewicht faellt.
 */
function markiere(html) {
  if (!streamEnabled()) return
  ensureStyle()
  const wurzel = (html instanceof HTMLElement) ? html
    : (html?.[0] instanceof HTMLElement) ? html[0]
    : document
  for (const li of wurzel.querySelectorAll?.("[data-entry-id], [data-scene-id]") ?? []) {
    const id = li.dataset?.entryId || li.dataset?.sceneId
    if (!id) continue
    const z = zustandAusCache(id)
    li.classList.toggle(KLASSE, Boolean(z?.zugesagt))
  }
}

export function installStreamSceneUi() {
  Hooks.on("getSceneContextOptions", (app, options) => {
    // Nur der Spielleiter, und nur mit Schluessel. Ein Spieler kann nichts
    // offline nehmen: das Kontingent haengt am Konto des Weltbesitzers.
    if (!game.user?.isGM) return options

    const zustandVon = li => zustandAusCache(szeneAusMenue(li))

    const eintrag = (schluessel, ersatz, icon, wennZugesagt) => ({
      name: localize(schluessel, ersatz),
      label: localize(schluessel, ersatz),
      icon: `<i class="${icon}"></i>`,
      condition: li => {
        if (!streamEnabled()) return false
        const z = zustandVon(li)
        return Boolean(z?.bekannt) && Boolean(z.zugesagt) === wennZugesagt
      },
      callback: li => {
        const id = szeneAusMenue(li)
        if (id) schalteKarte(id)
      },
    })

    options.push(
      eintrag("BENEOS.Stream.Offline.Keep", "Keep offline", "fa-regular fa-hard-drive", false),
      eintrag("BENEOS.Stream.Offline.Release", "Stream again", "fa-regular fa-cloud", true),
    )
    return options
  })

  // Die Markierung bei jedem Zeichnen neu setzen. Beide Orte, weil dieselbe
  // Szene in der Seitenleiste und in der Navigationszeile steht.
  Hooks.on("renderSceneDirectory", (app, html) => markiere(html))
  Hooks.on("renderSceneNavigation", (app, html) => markiere(html))

  // Nach einer Installation kann eine Szene dazugekommen sein, die das Modul
  // noch nicht kennt. Der Warmlauf fasst mehrere Aufrufe selbst zusammen.
  Hooks.on("beneos.releaseInstalled", () => {
    warmeZustaende().then(() => { try { ui.scenes?.render() } catch (_) { } }).catch(() => { })
  })
}
